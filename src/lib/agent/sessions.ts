import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agentSessions,
  noteVersions,
  notes,
} from "@/lib/db/schema";
import { audit } from "@/lib/log/audit";
import { log } from "@/lib/log";
import type { AgentPrincipal } from "./auth";
import type { BootstrapInput, CheckpointInput } from "./schemas";

const GUIDELINES_TITLE = "Agent Guidelines";

export interface BootstrapResult {
  sessionNoteId: string;
  guidelines: string;
  latestCheckpoint: string;
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
    },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  const [guidelines, latestCheckpoint] = await Promise.all([
    loadGuidelines(orgId),
    loadLatestCheckpoint(noteId),
  ]);

  return { sessionNoteId: noteId, guidelines, latestCheckpoint };
}

function renderCheckpoint(input: CheckpointInput): string {
  const ts = new Date().toISOString();
  const list = (xs: string[]) =>
    xs.length ? xs.map((x) => `- ${x}`).join("\n") : "_(none)_";
  return [
    `## ${ts} — ${input.event}`,
    "",
    `**Repo / branch:** \`${input.repo}\` @ \`${input.branch}\``,
    `**Agent:** \`${input.agentId}\``,
    input.lastCommit ? `**Last commit:** \`${input.lastCommit}\`` : null,
    "",
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

    const nextVersion = note.currentVersion + 1;

    await tx.insert(noteVersions).values({
      noteId: note.id,
      version: nextVersion,
      title: note.title,
      content: body,
      visibility: "org",
      changedBy: userId,
      changeSummary: `${input.event}${input.lastCommit ? ` @ ${input.lastCommit.slice(0, 8)}` : ""}`,
    });

    await tx
      .update(notes)
      .set({
        content: body,
        currentVersion: nextVersion,
        updatedAt: new Date(),
      })
      .where(eq(notes.id, note.id));

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
      version: result.version,
      doneCount: input.done.length,
      nextCount: input.next.length,
      issuesCount: input.issues.length,
      decisionsCount: input.decisions.length,
    },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return { ok: true, result: { sessionNoteId, version: result.version } };
}
