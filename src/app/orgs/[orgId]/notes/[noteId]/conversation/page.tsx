import { requireUser } from "@/lib/auth/session";
import { assertCanReadNote } from "@/lib/auth/permissions";
import { getConversation } from "@/lib/agent/conversation";
import { SectionCard, formatTimestamp } from "../../components";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare, User, Bot, FileText } from "lucide-react";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ orgId: string; noteId: string }>;
}) {
  const { orgId, noteId } = await params;
  const user = await requireUser(`/orgs/${orgId}/notes/${noteId}/conversation`);

  try {
    await assertCanReadNote(noteId, user.id);
  } catch {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-muted-foreground">Access denied</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  const { turns, summaries } = await getConversation(noteId, 100);

  if (turns.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-muted-foreground">No conversation turns yet</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            User prompts are captured automatically. Assistant summaries are logged via the{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">log_turn</code> MCP tool.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Build a map of turnEnd → summary for inline display
  const summaryByTurnEnd = new Map(summaries.map((s) => [s.turnEnd, s]));

  // turns are desc; reverse for chronological display
  const chronological = [...turns].reverse();

  return (
    <div className="space-y-4">
      <SectionCard
        title="Conversation"
        description={`${turns.length} turns captured · ${summaries.length} auto-summaries`}
      >
        <ol className="space-y-3">
          {chronological.map((turn) => {
            const isUser = turn.role === "user";
            return (
              <li key={turn.id}>
                <div
                  className={`rounded-md border p-3 text-sm ${
                    isUser
                      ? "border-sky-200 bg-sky-50"
                      : "border-emerald-200 bg-emerald-50"
                  }`}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      {isUser ? (
                        <User className="h-3.5 w-3.5 text-sky-600" />
                      ) : (
                        <Bot className="h-3.5 w-3.5 text-emerald-600" />
                      )}
                      <span
                        className={`text-xs font-medium ${
                          isUser ? "text-sky-700" : "text-emerald-700"
                        }`}
                      >
                        {isUser ? "User" : "Assistant"} · turn {turn.turnIndex}
                      </span>
                    </div>
                    <time className="text-xs text-muted-foreground">
                      {formatTimestamp(turn.createdAt)}
                    </time>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{turn.content}</p>
                  {turn.noteRefs.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {turn.noteRefs.map((ref, i) => (
                        <a
                          key={i}
                          href={`/orgs/${orgId}/notes/${ref.noteId}/history${ref.version ? `?version=${ref.version}` : ""}`}
                          className="inline-flex items-center gap-1 rounded border bg-white px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:underline"
                        >
                          <FileText className="h-3 w-3" />
                          {ref.title ?? ref.noteId.slice(0, 8)}
                          {ref.version ? ` v${ref.version}` : ""}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
                {/* Show summary card immediately after its last turn */}
                {summaryByTurnEnd.has(turn.turnIndex) && (() => {
                  const summary = summaryByTurnEnd.get(turn.turnIndex)!;
                  return (
                    <div className="mt-2 rounded-md border border-violet-200 bg-violet-50 p-3">
                      <div className="mb-1 flex items-center gap-1.5">
                        <MessageSquare className="h-3.5 w-3.5 text-violet-600" />
                        <span className="text-xs font-medium text-violet-700">
                          Auto-summary · turns {summary.turnStart}–{summary.turnEnd}
                        </span>
                      </div>
                      <details>
                        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                          Show summary
                        </summary>
                        <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                          {summary.content}
                        </p>
                      </details>
                    </div>
                  );
                })()}
              </li>
            );
          })}
        </ol>
      </SectionCard>
    </div>
  );
}
