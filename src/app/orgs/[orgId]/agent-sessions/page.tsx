import Link from "next/link";
import { and, desc, eq, ilike, inArray, isNull } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { noteVersions, notes, users } from "@/lib/db/schema";
import { parseCheckpoint } from "../notes/[noteId]/dashboard/parse-checkpoint";
import { HealthBadge } from "../notes/[noteId]/dashboard/health-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function formatRelativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Extract the short agent ID — last segment after the last "-". */
function shortAgentId(agentId: string | null): string {
  if (!agentId) return "—";
  const parts = agentId.split("-");
  return parts.at(-1) ?? agentId;
}

function buildSparklinePoints(
  checkpointCount: number,
  totalVersions: number,
): string {
  const W = 40;
  const H = 24;
  if (totalVersions === 0) return `0,${H} ${W},${H}`;
  const ratio = Math.min(1, checkpointCount / totalVersions);
  const endY = H - Math.round(ratio * H);
  return `0,${H} ${W},${endY}`;
}

export default async function AgentSessionsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  await requireUser(`/orgs/${orgId}/agent-sessions`);

  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      content: notes.content,
      updatedAt: notes.updatedAt,
      authorEmail: users.email,
      authorDisplayName: users.displayName,
    })
    .from(notes)
    .innerJoin(users, eq(users.id, notes.authorId))
    .where(
      and(
        eq(notes.orgId, orgId),
        isNull(notes.deletedAt),
        ilike(notes.title, "Agent:%"),
      ),
    )
    .orderBy(desc(notes.updatedAt))
    .limit(50);

  const noteIds = rows.map((r) => r.id);

  // Fetch last 10 versions per session note to compute sparkline data
  const versionRows =
    noteIds.length > 0
      ? await db
          .select({
            noteId: noteVersions.noteId,
            changeSummary: noteVersions.changeSummary,
          })
          .from(noteVersions)
          .where(inArray(noteVersions.noteId, noteIds))
          .orderBy(desc(noteVersions.version))
      : [];

  // Group versions by noteId and keep only last 10
  const versionsByNote = new Map<string, typeof versionRows>();
  for (const v of versionRows) {
    const list = versionsByNote.get(v.noteId) ?? [];
    if (list.length < 10) {
      list.push(v);
      versionsByNote.set(v.noteId, list);
    }
  }

  const sessions = rows.map((row) => {
    const checkpoint = parseCheckpoint(row.content);
    const versions = versionsByNote.get(row.id) ?? [];
    const checkpointCount = versions.filter(
      (v) =>
        v.changeSummary?.includes("commit @") ||
        v.changeSummary?.includes("stop @"),
    ).length;
    const sparklinePoints = buildSparklinePoints(checkpointCount, versions.length);
    return { ...row, checkpoint, checkpointCount, totalVersions: versions.length, sparklinePoints };
  });

  // ---------------------------------------------------------------------------
  // Weekly done aggregation — last 7 days, all sessions
  // ---------------------------------------------------------------------------
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentSessions = sessions.filter((s) => s.updatedAt > sevenDaysAgo);

  interface WeeklyEntry {
    title: string;
    items: string[];
  }
  const weeklyDone: WeeklyEntry[] = [];
  const globalSeen = new Set<string>();

  for (const session of recentSessions) {
    if (!session.checkpoint?.done || session.checkpoint.done.length === 0) continue;
    const deduped: string[] = [];
    for (const item of session.checkpoint.done) {
      if (!globalSeen.has(item)) {
        globalSeen.add(item);
        deduped.push(item);
      }
    }
    if (deduped.length > 0) {
      weeklyDone.push({ title: session.title, items: deduped });
    }
  }

  if (sessions.length === 0) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Agent Sessions</h1>
          <p className="text-sm text-muted-foreground">
            Notes written by Claude Code agent hooks across this organisation.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>No agent sessions found</CardTitle>
            <CardDescription>
              Agent session notes are created automatically when Claude Code runs in this org. They
              have titles starting with <span className="font-mono">Agent:</span>.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Agent Sessions</h1>
        <p className="text-sm text-muted-foreground">
          {sessions.length} session note{sessions.length !== 1 ? "s" : ""} — notes written by
          Claude Code agent hooks across this organisation.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-xs font-medium text-muted-foreground">
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Session</th>
              <th className="px-4 py-3">Branch</th>
              <th className="px-4 py-3">Agent</th>
              <th className="px-4 py-3 text-center">Done</th>
              <th className="px-4 py-3">Growth</th>
              <th className="px-4 py-3">Last Commit</th>
              <th className="px-4 py-3">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {sessions.map((session) => {
              const cp = session.checkpoint;
              return (
                <tr key={session.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <HealthBadge
                      lastUpdated={session.updatedAt}
                      issueCount={cp?.issues?.length ?? 0}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/orgs/${orgId}/notes/${session.id}/dashboard`}
                      className="font-medium hover:underline text-primary"
                    >
                      {session.title}
                    </Link>
                    {cp?.issues && cp.issues.length > 0 && (
                      <span className="ml-2 inline-flex items-center rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">
                        {cp.issues.length} issue{cp.issues.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {cp?.branch ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {shortAgentId(cp?.agent ?? null)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {cp ? (
                      <span className="inline-flex items-center rounded bg-muted px-2 py-0.5 text-xs font-medium">
                        {cp.done.length}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <svg
                      viewBox="0 0 40 24"
                      width={40}
                      height={24}
                      aria-label={`${session.checkpointCount} checkpoint${session.checkpointCount !== 1 ? "s" : ""} of ${session.totalVersions} versions`}
                      className="block"
                    >
                      <title>
                        {session.checkpointCount} checkpoint{session.checkpointCount !== 1 ? "s" : ""} out of {session.totalVersions} versions
                      </title>
                      <polyline
                        points={session.sparklinePoints}
                        fill="none"
                        stroke="hsl(var(--primary))"
                        strokeWidth={1.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={0.8}
                      />
                    </svg>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {cp?.lastCommit ? cp.lastCommit.slice(0, 8) : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    <time dateTime={session.updatedAt.toISOString()}>
                      {formatRelativeTime(session.updatedAt)}
                    </time>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Showing up to 50 most recently updated sessions. Click a session title to view its full
        agent dashboard.
      </p>

      {/* Weekly done aggregation */}
      {weeklyDone.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">This week&apos;s work</CardTitle>
            <CardDescription>
              Deduplicated done items from sessions updated in the last 7 days.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {weeklyDone.map((entry) => (
              <div key={entry.title}>
                <p className="mb-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide truncate">
                  {entry.title}
                </p>
                <ul className="space-y-1">
                  {entry.items.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="mt-0.5 text-emerald-600 shrink-0">&#10003;</span>
                      <span className="font-mono text-xs leading-5">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
