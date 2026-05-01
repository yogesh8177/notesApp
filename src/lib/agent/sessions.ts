import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agentSessions,
  conversationSummaries,
  noteVersions,
  notes,
  sessionEpochSummaries,
} from "@/lib/db/schema";
import { audit } from "@/lib/log/audit";
import { log } from "@/lib/log";
import { compactCheckpoints } from "@/lib/ai/compact";
import type { AgentPrincipal } from "./auth";
import type { BootstrapInput, CheckpointInput } from "./schemas";

const EPOCH_SIZE = 10;

const GUIDELINES_TITLE = "Agent Guidelines";

export interface EpochSummaryEntry {
  epochStart: number;
  epochEnd: number;
  content: string;
}

export interface ConversationSummaryEntry {
  turnStart: number;
  turnEnd: number;
  content: string;
}

export interface BootstrapResult {
  sessionNoteId: string;
  guidelines: string;
  latestCheckpoint: string;
  epochSummaries: EpochSummaryEntry[];
  recentConversation: ConversationSummaryEntry[];
}

export interface CheckpointResult {
  sessionNoteId: string;
  version: number;
}

/**
 * Find the org's `Agent Guidelines` note body, or empty string if absent.
 * Org admins author this through the regular notes UI; no schema change needed.
 */
async function loadGuidelines(orgId: string): Promise<string> {
  const [row] = await db
    .select({ content: notes.content })
    .from(notes)
    .where(
      and(
        eq(notes.orgId, orgId),
        eq(notes.title, GUIDELINES_TITLE),
        isNull(notes.deletedAt),
      ),
    )
    .limit(1);
  return row?.content ?? "";
}

async function loadEpochSummaries(noteId: string): Promise<EpochSummaryEntry[]> {
  const rows = await db
    .select({
      epochStart: sessionEpochSummaries.epochStart,
      epochEnd: sessionEpochSummaries.epochEnd,
      content: sessionEpochSummaries.content,
    })
    .from(sessionEpochSummaries)
    .where(eq(sessionEpochSummaries.noteId, noteId))
    .orderBy(sessionEpochSummaries.epochEnd)
    .limit(5);
  return rows;
}

async function loadConversationSummaries(noteId: string): Promise<ConversationSummaryEntry[]> {
  const rows = await db
    .select({
      turnStart: conversationSummaries.turnStart,
      turnEnd: conversationSummaries.turnEnd,
      content: conversationSummaries.content,
    })
    .from(conversationSummaries)
    .where(eq(conversationSummaries.sessionNoteId, noteId))
    .orderBy(conversationSummaries.turnEnd)
    .limit(5);
  return rows;
}

async function loadLatestCheckpoint(noteId: string): Promise<string> {
  const [row] = await db
    .select({ content: noteVersions.content })
    .from(noteVersions)
    .where(eq(noteVersions.noteId, noteId))
    .orderBy(desc(noteVersions.version))
    .limit(1);
  return row?.content ?? "";
}

/**
 * Bootstrap: upsert the (org, agentId, repo, branch) session note and return
 * org guidelines + latest checkpoint body. Idempotent — safe to call on every
 * SessionStart.
 */
export async function bootstrap(
  principal: AgentPrincipal,
  input: BootstrapInput,
  meta: { ip: string | null; userAgent: string | null },
): Promise<BootstrapResult> {
  const { orgId, userId } = principal;

  const noteId = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: agentSessions.id, noteId: agentSessions.noteId })
      .from(agentSessions)
      .where(
        and(
          eq(agentSessions.orgId, orgId),
          eq(agentSessions.agentId, input.agentId),
          eq(agentSessions.repo, input.repo),
          eq(agentSessions.branch, input.branch),
        ),
      )
      .limit(1);

    if (existing) {
      await tx
        .update(agentSessions)
        .set({ lastSeenAt: new Date() })
        .where(eq(agentSessions.id, existing.id));
      return existing.noteId;
    }

    const title = `Agent: ${input.repo} @ ${input.branch}`;
    const initialContent = `_Session created. Awaiting first checkpoint._`;
    const [createdNote] = await tx
      .insert(notes)
      .values({
        orgId,
        authorId: userId,
        title,
        content: initialContent,
        visibility: "org",
        currentVersion: 1,
      })
      .returning({ id: notes.id });

    await tx.insert(noteVersions).values({
      noteId: createdNote.id,
      version: 1,
      title,
      content: initialContent,
      visibility: "org",
      changedBy: userId,
      changeSummary: `agent:${input.agentId} bootstrap (${input.source ?? "startup"})`,
    });

    await tx.insert(agentSessions).values({
      orgId,
      noteId: createdNote.id,
      agentId: input.agentId,
      repo: input.repo,
      branch: input.branch,
    });

    return createdNote.id;
  });

  await audit({
    action: "agent.session.bootstrap",
    orgId,
    userId,
    resourceType: "note",
    resourceId: noteId,
    metadata: {
      tokenId: principal.tokenId,
      tokenName: principal.tokenName,
      agentId: input.agentId,
      repo: input.repo,
      branch: input.branch,
      source: input.source ?? "startup",
      repoUrl: input.repoUrl,
    },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  // When source === "clear" the user explicitly reset their conversation
  // context (`/clear` in Claude Code). Resuming the prior checkpoint would
  // partly defeat that intent — the user wants a fresh prompt window, not
  // a re-injection of the last session's done/next/issues bag. Org
  // guidelines are different: they're static rules of engagement, not
  // per-session state, so they always come back.
  const skipCheckpoint = input.source === "clear";

  const [guidelines, latestCheckpoint, epochSummaries, recentConversation] = await Promise.all([
    loadGuidelines(orgId),
    skipCheckpoint ? Promise.resolve("") : loadLatestCheckpoint(noteId),
    skipCheckpoint ? Promise.resolve([]) : loadEpochSummaries(noteId),
    skipCheckpoint ? Promise.resolve([]) : loadConversationSummaries(noteId),
  ]);

  return { sessionNoteId: noteId, guidelines, latestCheckpoint, epochSummaries, recentConversation };
}

function renderCheckpoint(input: CheckpointInput): string {
  const ts = new Date().toISOString();
  const list = (xs: string[]) =>
    xs.length ? xs.map((x) => `- ${x}`).join("\n") : "_(none)_";
  return [
    `## ${ts} — ${input.event}`,
    "",
    `**Repo / branch:** \`${input.repo}\` @ \`${input.branch}\``,
    input.repoUrl ? `**Repo URL:** \`${input.repoUrl}\`` : null,
    `**Agent:** \`${input.agentId}\``,
    input.lastCommit ? `**Last commit:** \`${input.lastCommit}\`` : null,
    "",
    input.body ? "### Summary" : null,
    input.body ? input.body : null,
    input.body ? "" : null,
    "### Done",
    list(input.done),
    "",
    "### Next",
    list(input.next),
    "",
    "### Issues",
    list(input.issues),
    "",
    "### Decisions",
    list(input.decisions),
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/**
 * Checkpoint: append a new note_versions row and update the note's content
 * to the latest checkpoint body. Returns the new version number.
 *
 * Verifies the session note belongs to the principal's org — prevents a
 * compromised agentId from writing to another org's note even if it had a
 * stolen sessionNoteId.
 */
export type CheckpointOutcome =
  | { ok: true; result: CheckpointResult }
  | { ok: false; error: "NOT_FOUND" | "FORBIDDEN" };

export async function checkpoint(
  principal: AgentPrincipal,
  sessionNoteId: string,
  input: CheckpointInput,
  meta: { ip: string | null; userAgent: string | null },
): Promise<CheckpointOutcome> {
  const { orgId, userId } = principal;
  const body = renderCheckpoint(input);

  const result = await db.transaction(async (tx) => {
    const [note] = await tx
      .select({
        id: notes.id,
        orgId: notes.orgId,
        title: notes.title,
        currentVersion: notes.currentVersion,
        deletedAt: notes.deletedAt,
      })
      .from(notes)
      .where(eq(notes.id, sessionNoteId))
      .limit(1);

    if (!note || note.deletedAt) {
      return { kind: "error" as const, error: "NOT_FOUND" as const };
    }
    if (note.orgId !== orgId) {
      return { kind: "error" as const, error: "FORBIDDEN" as const };
    }

    // Atomically claim the next version number. PostgreSQL row-level locking
    // on this UPDATE serialises concurrent checkpoint calls that would otherwise
    // both read the same currentVersion and produce duplicate note_versions rows.
    const [updated] = await tx
      .update(notes)
      .set({
        content: body,
        currentVersion: sql`${notes.currentVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(notes.id, note.id))
      .returning({ nextVersion: notes.currentVersion });

    const nextVersion = updated.nextVersion;

    await tx.insert(noteVersions).values({
      noteId: note.id,
      version: nextVersion,
      title: note.title,
      content: body,
      visibility: "org",
      changedBy: userId,
      changeSummary: `${input.event}${input.lastCommit ? ` @ ${input.lastCommit.slice(0, 8)}` : ""}`,
    });

    // Touch lastSeenAt on the matching session row (best-effort — the note
    // is the source of truth, this is just for "which agent was active recently").
    await tx
      .update(agentSessions)
      .set({ lastSeenAt: new Date() })
      .where(
        and(
          eq(agentSessions.orgId, orgId),
          eq(agentSessions.noteId, note.id),
        ),
      );

    return { kind: "ok" as const, version: nextVersion };
  });

  if (result.kind === "error") {
    log.warn(
      { sessionNoteId, orgId, error: result.error },
      "agent.session.checkpoint.reject",
    );
    return { ok: false, error: result.error };
  }

  await audit({
    action: "agent.session.checkpoint",
    orgId,
    userId,
    resourceType: "note",
    resourceId: sessionNoteId,
    metadata: {
      tokenId: principal.tokenId,
      tokenName: principal.tokenName,
      event: input.event,
      agentId: input.agentId,
      repo: input.repo,
      branch: input.branch,
      lastCommit: input.lastCommit || undefined,
      repoUrl: input.repoUrl,
      version: result.version,
      doneCount: input.done.length,
      nextCount: input.next.length,
      issuesCount: input.issues.length,
      decisionsCount: input.decisions.length,
    },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  // Fire-and-forget: auto-compact every EPOCH_SIZE versions
  void maybeCompactEpoch(orgId, sessionNoteId, result.version);

  return { ok: true, result: { sessionNoteId, version: result.version } };
}

async function maybeCompactEpoch(
  orgId: string,
  noteId: string,
  version: number,
): Promise<void> {
  if (version % EPOCH_SIZE !== 0) return;

  const epochStart = version - EPOCH_SIZE + 1;
  const epochEnd = version;

  // Idempotent: skip if already compacted
  const [existing] = await db
    .select({ id: sessionEpochSummaries.id })
    .from(sessionEpochSummaries)
    .where(
      and(
        eq(sessionEpochSummaries.noteId, noteId),
        eq(sessionEpochSummaries.epochEnd, epochEnd),
      ),
    )
    .limit(1);
  if (existing) return;

  const rows = await db
    .select({ version: noteVersions.version, content: noteVersions.content })
    .from(noteVersions)
    .where(
      and(
        eq(noteVersions.noteId, noteId),
        sql`${noteVersions.version} >= ${epochStart}`,
        sql`${noteVersions.version} <= ${epochEnd}`,
      ),
    )
    .orderBy(noteVersions.version);

  if (rows.length === 0) return;

  try {
    const result = await compactCheckpoints(rows);
    await db.insert(sessionEpochSummaries).values({
      noteId,
      orgId,
      epochStart,
      epochEnd,
      content: result.content,
    }).onConflictDoNothing();

    log.info({ noteId, epochStart, epochEnd }, "agent.session.epoch.compacted");
  } catch (err) {
    log.error({ noteId, epochStart, epochEnd, err }, "agent.session.epoch.compact.failed");
  }
}
