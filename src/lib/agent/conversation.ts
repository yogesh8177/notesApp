import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { conversationTurns, conversationSummaries, notes } from "@/lib/db/schema";
import { compactCheckpoints } from "@/lib/ai/compact";
import { log } from "@/lib/log";

const SUMMARY_WINDOW = 10;

export interface TurnNoteRef {
  noteId: string;
  version?: number;
  title?: string;
}

export interface ConversationTurnRow {
  id: string;
  turnIndex: number;
  role: string;
  content: string;
  noteRefs: TurnNoteRef[];
  createdAt: Date;
}

export interface ConversationSummaryRow {
  id: string;
  turnStart: number;
  turnEnd: number;
  content: string;
  createdAt: Date;
}

export async function addTurn(opts: {
  orgId: string;
  sessionNoteId: string;
  role: "user" | "assistant";
  content: string;
  noteRefs?: TurnNoteRef[];
}): Promise<{ turnIndex: number }> {
  // Verify note belongs to org
  const [note] = await db
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.id, opts.sessionNoteId), eq(notes.orgId, opts.orgId)))
    .limit(1);
  if (!note) throw new Error("NOT_FOUND");

  // Get next turn index atomically using a serializable-safe insert with
  // a subquery for the current max.
  const [row] = await db
    .insert(conversationTurns)
    .values({
      orgId: opts.orgId,
      sessionNoteId: opts.sessionNoteId,
      turnIndex: sql`(SELECT COALESCE(MAX(turn_index), -1) + 1 FROM conversation_turns WHERE session_note_id = ${opts.sessionNoteId})`,
      role: opts.role,
      content: opts.content,
      noteRefs: opts.noteRefs ?? [],
    })
    .onConflictDoUpdate({
      target: [conversationTurns.sessionNoteId, conversationTurns.turnIndex],
      set: {
        content: sql`excluded.content`,
        noteRefs: sql`excluded.note_refs`,
      },
    })
    .returning({ turnIndex: conversationTurns.turnIndex });

  void maybeCompactConversation(opts.orgId, opts.sessionNoteId, row.turnIndex);

  return { turnIndex: row.turnIndex };
}

export async function getConversation(
  sessionNoteId: string,
  limit = 50,
): Promise<{ turns: ConversationTurnRow[]; summaries: ConversationSummaryRow[] }> {
  const [turns, summaries] = await Promise.all([
    db
      .select({
        id: conversationTurns.id,
        turnIndex: conversationTurns.turnIndex,
        role: conversationTurns.role,
        content: conversationTurns.content,
        noteRefs: conversationTurns.noteRefs,
        createdAt: conversationTurns.createdAt,
      })
      .from(conversationTurns)
      .where(eq(conversationTurns.sessionNoteId, sessionNoteId))
      .orderBy(desc(conversationTurns.turnIndex))
      .limit(limit),
    db
      .select({
        id: conversationSummaries.id,
        turnStart: conversationSummaries.turnStart,
        turnEnd: conversationSummaries.turnEnd,
        content: conversationSummaries.content,
        createdAt: conversationSummaries.createdAt,
      })
      .from(conversationSummaries)
      .where(eq(conversationSummaries.sessionNoteId, sessionNoteId))
      .orderBy(desc(conversationSummaries.turnEnd)),
  ]);

  return {
    turns: turns.map((t) => ({ ...t, noteRefs: (t.noteRefs ?? []) as TurnNoteRef[] })),
    summaries,
  };
}

async function maybeCompactConversation(
  orgId: string,
  sessionNoteId: string,
  turnIndex: number,
): Promise<void> {
  if ((turnIndex + 1) % SUMMARY_WINDOW !== 0) return;

  const turnEnd = turnIndex;
  const turnStart = turnIndex - SUMMARY_WINDOW + 1;

  const [existing] = await db
    .select({ id: conversationSummaries.id })
    .from(conversationSummaries)
    .where(
      and(
        eq(conversationSummaries.sessionNoteId, sessionNoteId),
        eq(conversationSummaries.turnEnd, turnEnd),
      ),
    )
    .limit(1);
  if (existing) return;

  const rows = await db
    .select({ turnIndex: conversationTurns.turnIndex, role: conversationTurns.role, content: conversationTurns.content })
    .from(conversationTurns)
    .where(
      and(
        eq(conversationTurns.sessionNoteId, sessionNoteId),
        sql`${conversationTurns.turnIndex} >= ${turnStart}`,
        sql`${conversationTurns.turnIndex} <= ${turnEnd}`,
      ),
    )
    .orderBy(conversationTurns.turnIndex);

  if (rows.length === 0) return;

  try {
    // Re-use compactCheckpoints — it just needs {version, content} shape
    const result = await compactCheckpoints(
      rows.map((r) => ({ version: r.turnIndex, content: `[${r.role}] ${r.content}` })),
    );
    await db
      .insert(conversationSummaries)
      .values({ orgId, sessionNoteId, turnStart, turnEnd, content: result.content })
      .onConflictDoNothing();
    log.info({ sessionNoteId, turnStart, turnEnd }, "agent.conversation.compacted");
  } catch (err) {
    log.error({ sessionNoteId, turnStart, turnEnd, err }, "agent.conversation.compact.failed");
  }
}
