import { requireUser } from "@/lib/auth/session";
import { getNoteDetailForUser } from "@/lib/notes";
import { SectionCard, formatTimestamp } from "../../components";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ToolUsageChart from "./tool-usage-chart";
import { ActivityChart } from "./activity-chart";
import { buildActivityBars } from "./build-activity-bars";
import { HealthBadge } from "./health-badge";
import { CompactButton } from "./compact-button";
import { getEpochSummaries } from "@/lib/agent/queries";

// ---------------------------------------------------------------------------
// Checkpoint parser
// ---------------------------------------------------------------------------

export interface CheckpointData {
  repo: string | null;
  branch: string | null;
  agent: string | null;
  lastCommit: string | null;
  repoUrl: string | null;
  summary: string | null;
  done: string[];
  next: string[];
  issues: string[];
  decisions: string[];
}

/**
 * Parse agent session checkpoint content.
 * Returns null if the content doesn't match the checkpoint format.
 */
export function parseCheckpoint(content: string): CheckpointData | null {
  // Must have the characteristic header line with Repo / branch
  if (!content.includes("**Repo / branch:**") || !content.includes("**Agent:**")) {
    return null;
  }

  function extractInline(label: string): string | null {
    const re = new RegExp(`\\*\\*${label}:\\*\\*\\s*\`?([^\`\n]+)\`?`);
    const m = content.match(re);
    return m ? m[1].trim() : null;
  }

  // Parse "repo @ branch" from "**Repo / branch:** `repo` @ `branch`"
  let repo: string | null = null;
  let branch: string | null = null;
  const repoBranchMatch = content.match(/\*\*Repo \/ branch:\*\*\s*`([^`]+)`\s*@\s*`([^`]+)`/);
  if (repoBranchMatch) {
    repo = repoBranchMatch[1].trim();
    branch = repoBranchMatch[2].trim();
  }

  const agent = extractInline("Agent");
  const lastCommit = extractInline("Last commit");
  const repoUrl = extractInline("Repo URL");

  // Extract a section's bullet list items (lines starting with "- ")
  function extractSection(header: string): string[] {
    const re = new RegExp(`###\\s+${header}\\s*\\n([\\s\\S]*?)(?=\\n###|$)`);
    const m = content.match(re);
    if (!m) return [];
    const block = m[1];
    // Return empty if the section contains only the "none" placeholder
    if (/^\s*_\(none\)_\s*$/.test(block.trim())) return [];
    return block
      .split("\n")
      .map((line) => line.replace(/^[-*]\s+/, "").trim())
      .filter((line) => line.length > 0 && !line.startsWith("_("));
  }

  // Extract free-text summary (not a bullet list)
  function extractSummaryText(): string | null {
    const re = /###\s+Summary\s*\n([\s\S]*?)(?=\n###|$)/;
    const m = content.match(re);
    if (!m) return null;
    const text = m[1].trim();
    if (!text || /^_\(none\)_$/.test(text)) return null;
    return text;
  }

  return {
    repo,
    branch,
    agent,
    lastCommit,
    repoUrl,
    summary: extractSummaryText(),
    done: extractSection("Done"),
    next: extractSection("Next"),
    issues: extractSection("Issues"),
    decisions: extractSection("Decisions"),
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function NoteAgentDashboardPage({
  params,
}: {
  params: Promise<{ orgId: string; noteId: string }>;
}) {
  const { orgId, noteId } = await params;
  const user = await requireUser(`/orgs/${orgId}/notes/${noteId}/dashboard`);

  const { note } = await getNoteDetailForUser(noteId, user.id);
  const checkpoint = parseCheckpoint(note.content);

  if (!checkpoint) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-muted-foreground">No agent session data</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This note does not contain agent session checkpoint data. Agent session notes are
            written automatically by Claude Code hooks and follow a specific format.
          </p>
        </CardContent>
      </Card>
    );
  }

  const recentHistory = note.history.slice(0, 10);
  const activityBars = buildActivityBars(recentHistory);
  const epochSummaries = await getEpochSummaries(noteId);
  const commitBaseUrl = checkpoint.repoUrl
    ?? (checkpoint.repo && /^[^/\s]+\/[^/\s]+$/.test(checkpoint.repo)
      ? `https://github.com/${checkpoint.repo}`
      : null);

  return (
    <div className="space-y-4">
      {/* Session info */}
      <SectionCard title="Session Info">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          {checkpoint.repo && (
            <>
              <dt className="font-medium text-muted-foreground">Repository</dt>
              <dd className="col-span-1 font-mono sm:col-span-2">{checkpoint.repo}</dd>
            </>
          )}
          {checkpoint.branch && (
            <>
              <dt className="font-medium text-muted-foreground">Branch</dt>
              <dd className="col-span-1 font-mono sm:col-span-2">{checkpoint.branch}</dd>
            </>
          )}
          {checkpoint.agent && (
            <>
              <dt className="font-medium text-muted-foreground">Agent</dt>
              <dd className="col-span-1 font-mono text-xs sm:col-span-2 break-all">{checkpoint.agent}</dd>
            </>
          )}
          {checkpoint.lastCommit && (
            <>
              <dt className="font-medium text-muted-foreground">Last Commit</dt>
              <dd className="col-span-1 font-mono sm:col-span-2">
                {commitBaseUrl ? (
                  <a
                    href={`${commitBaseUrl}/commit/${checkpoint.lastCommit}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                    title={checkpoint.lastCommit}
                  >
                    {checkpoint.lastCommit.slice(0, 8)}
                  </a>
                ) : (
                  <span title={checkpoint.lastCommit}>{checkpoint.lastCommit.slice(0, 8)}</span>
                )}
              </dd>
            </>
          )}
          <dt className="font-medium text-muted-foreground">Last Updated</dt>
          <dd className="col-span-1 sm:col-span-2 flex items-center gap-3">
            <span>{formatTimestamp(note.updatedAt)}</span>
            <HealthBadge
              lastUpdated={note.updatedAt}
              issueCount={checkpoint.issues.length}
            />
          </dd>
        </dl>
        {checkpoint.summary && (
          <p className="mt-3 text-sm text-muted-foreground border-t pt-3">{checkpoint.summary}</p>
        )}
      </SectionCard>

      {/* Done */}
      {checkpoint.done.length > 0 && (
        <SectionCard title="Done" description="Completed work items in this session">
          <ul className="space-y-1.5">
            {checkpoint.done.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 text-emerald-600">&#10003;</span>
                <span className="font-mono text-xs leading-5">{item}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {/* Decisions */}
      {checkpoint.decisions.length > 0 && (
        <SectionCard title="Decisions" description="Architectural or implementation choices made">
          <ul className="space-y-1.5">
            {checkpoint.decisions.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 text-sky-600">&#8227;</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {/* Issues */}
      {checkpoint.issues.length > 0 && (
        <SectionCard title="Issues" description="Problems or blockers encountered">
          <ul className="space-y-2">
            {checkpoint.issues.map((item, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
              >
                <span className="mt-0.5 font-bold text-amber-600">!</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {/* Tool Usage */}
      <SectionCard title="Tool Usage" description="MCP tool call counts for this session note">
        <ToolUsageChart orgId={orgId} noteId={noteId} />
      </SectionCard>

      {/* Checkpoint history */}
      {recentHistory.length > 0 && (
        <SectionCard
          title="Checkpoint History"
          description={`Last ${recentHistory.length} version${recentHistory.length !== 1 ? "s" : ""} of this session note`}
        >
          {/* Activity chart — shows checkpoint frequency over time */}
          <div className="mb-4 rounded-md border bg-muted/20 p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Checkpoint activity</p>
            <ActivityChart bars={activityBars} />
          </div>
          <div className="mb-3 flex justify-end">
            <CompactButton noteId={noteId} orgId={orgId} />
          </div>
          <ol className="space-y-2">
            {recentHistory.map((v) => {
              const isCompact = v.changeSummary?.startsWith("compact:");
              return (
              <li
                key={v.id}
                className={`flex items-start justify-between gap-4 rounded-md border p-3 text-sm ${isCompact ? "border-violet-200 bg-violet-50" : ""}`}
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-xs ${isCompact ? "border-violet-300 bg-violet-100 text-violet-700" : ""}`}>
                      v{v.version}
                    </span>
                    {v.changeSummary && (
                      <span className={`truncate text-xs ${isCompact ? "font-medium text-violet-600" : "text-muted-foreground"}`}>{v.changeSummary}</span>
                    )}
                  </div>
                </div>
                <time className="shrink-0 text-xs text-muted-foreground" dateTime={v.createdAt.toISOString()}>
                  {formatTimestamp(v.createdAt)}
                </time>
              </li>
              );
            })}
          </ol>
          {epochSummaries.length > 0 && (
            <div className="mt-4 border-t pt-4">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Auto-compacted epochs</p>
              <ol className="space-y-2">
                {epochSummaries.map((epoch) => (
                  <li
                    key={epoch.id}
                    className="rounded-md border border-violet-200 bg-violet-50 p-3 text-sm"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded border border-violet-300 bg-violet-100 px-1.5 py-0.5 font-mono text-xs text-violet-700">
                          v{epoch.epochStart}–{epoch.epochEnd}
                        </span>
                        <span className="text-xs text-muted-foreground">Epoch summary</span>
                      </div>
                      <time className="shrink-0 text-xs text-muted-foreground" dateTime={epoch.createdAt.toISOString()}>
                        {formatTimestamp(epoch.createdAt)}
                      </time>
                    </div>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                        Show summary
                      </summary>
                      <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-muted-foreground">
                        {epoch.content}
                      </pre>
                    </details>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
}
