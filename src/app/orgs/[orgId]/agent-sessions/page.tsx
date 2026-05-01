import Link from "next/link";
import { and, desc, eq, ilike, isNull } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { notes, users } from "@/lib/db/schema";
import { parseCheckpoint } from "../notes/[noteId]/dashboard/page";
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

  const sessions = rows.map((row) => {
    const checkpoint = parseCheckpoint(row.content);
    return { ...row, checkpoint };
  });

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
              <th className="px-4 py-3">Session</th>
              <th className="px-4 py-3">Branch</th>
              <th className="px-4 py-3">Agent</th>
              <th className="px-4 py-3 text-center">Done</th>
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
    </div>
  );
}
