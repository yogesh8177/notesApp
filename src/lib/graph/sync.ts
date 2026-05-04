import { eq, and, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  notes,
  users,
  tags,
  noteTags,
  noteShares,
  agentSessions,
  conversationTurns,
  auditLog,
} from "@/lib/db/schema";
import { log } from "@/lib/log";
import { getDriver } from "./client";
import type { GraphNodeType } from "./types";

/**
 * Sync a node and its direct relationships from Postgres into Neo4j.
 * Safe to call even when Neo4j is unavailable — returns early without throwing.
 */
export async function syncNode(
  type: GraphNodeType,
  id: string,
  orgId: string
): Promise<void> {
  const driver = getDriver();
  if (!driver) return;

  const session = driver.session();
  try {
    switch (type) {
      case "Note":
        await syncNote(session, id, orgId);
        break;
      case "AgentSession":
        await syncAgentSession(session, id, orgId);
        break;
      case "ConversationTurn":
        await syncConversationTurn(session, id, orgId);
        break;
      case "AuditEvent":
        await syncAuditEvent(session, id, orgId);
        break;
      case "User":
        await syncUser(session, id, orgId);
        break;
      case "Tag":
        await syncTag(session, id, orgId);
        break;
      default:
        log.warn({ type, id }, "graph.sync.unknown_type");
    }
  } catch (err) {
    log.error({ err, type, id, orgId }, "graph.sync.error");
  } finally {
    await session.close();
  }
}

type Neo4jSession = ReturnType<ReturnType<typeof getDriver> extends null ? never : NonNullable<ReturnType<typeof getDriver>>["session"]>;

async function syncNote(session: Neo4jSession, noteId: string, orgId: string): Promise<void> {
  const note = await db.query.notes.findFirst({
    where: and(eq(notes.id, noteId), eq(notes.orgId, orgId)),
  });
  if (!note) return;

  const author = await db.query.users.findFirst({
    where: eq(users.id, note.authorId),
  });

  const noteTagnLinks = await db
    .select({ tagId: noteTags.tagId, tagName: tags.name })
    .from(noteTags)
    .innerJoin(tags, eq(tags.id, noteTags.tagId))
    .where(eq(noteTags.noteId, noteId));

  const shares = await db.query.noteShares.findMany({
    where: eq(noteShares.noteId, noteId),
  });

  const sessions = await db.query.agentSessions.findMany({
    where: and(eq(agentSessions.noteId, noteId), eq(agentSessions.orgId, orgId)),
  });

  const auditEvents = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.resourceId, noteId), eq(auditLog.orgId, orgId)))
    .limit(20);

  // Batch-load all shared users in one query instead of one query per share
  const sharedUserIds = shares.map((s) => s.sharedWithUserId);
  const sharedUsers =
    sharedUserIds.length > 0
      ? await db.select().from(users).where(inArray(users.id, sharedUserIds))
      : [];
  const sharedUserMap = new Map(sharedUsers.map((u) => [u.id, u]));

  await session.executeWrite(async (tx) => {
    // Merge Note node
    await tx.run(
      `MERGE (n:Note {id: $id})
       SET n.orgId = $orgId,
           n.title = $title,
           n.visibility = $visibility,
           n.currentVersion = $currentVersion,
           n.createdAt = $createdAt,
           n.updatedAt = $updatedAt`,
      {
        id: note.id,
        orgId: note.orgId,
        title: note.title,
        visibility: note.visibility,
        currentVersion: note.currentVersion,
        createdAt: note.createdAt.toISOString(),
        updatedAt: note.updatedAt.toISOString(),
      }
    );

    // Author
    if (author) {
      await tx.run(
        `MERGE (u:User {id: $id})
         SET u.orgId = $orgId, u.email = $email, u.displayName = $displayName`,
        {
          id: author.id,
          orgId: orgId,
          email: author.email,
          displayName: author.displayName ?? "",
        }
      );
      await tx.run(
        `MATCH (u:User {id: $userId}), (n:Note {id: $noteId})
         MERGE (u)-[:AUTHORED]->(n)`,
        { userId: author.id, noteId: note.id }
      );
    }

    // Tags
    for (const { tagId, tagName } of noteTagnLinks) {
      await tx.run(
        `MERGE (t:Tag {id: $id})
         SET t.orgId = $orgId, t.name = $name`,
        { id: tagId, orgId, name: tagName }
      );
      await tx.run(
        `MATCH (n:Note {id: $noteId}), (t:Tag {id: $tagId})
         MERGE (n)-[:HAS_TAG]->(t)`,
        { noteId: note.id, tagId }
      );
    }

    // Shares
    for (const share of shares) {
      const sharedUser = sharedUserMap.get(share.sharedWithUserId);
      if (sharedUser) {
        await tx.run(
          `MERGE (u:User {id: $id})
           SET u.orgId = $orgId, u.email = $email, u.displayName = $displayName`,
          {
            id: sharedUser.id,
            orgId,
            email: sharedUser.email,
            displayName: sharedUser.displayName ?? "",
          }
        );
        await tx.run(
          `MATCH (n:Note {id: $noteId}), (u:User {id: $userId})
           MERGE (n)-[r:SHARED_WITH]->(u)
           SET r.permission = $permission`,
          { noteId: note.id, userId: sharedUser.id, permission: share.permission }
        );
      }
    }

    // Sessions
    for (const s of sessions) {
      await tx.run(
        `MERGE (a:AgentSession {id: $id})
         SET a.orgId = $orgId, a.noteId = $noteId,
             a.agentId = $agentId, a.repo = $repo, a.branch = $branch,
             a.createdAt = $createdAt`,
        {
          id: s.id,
          orgId: s.orgId,
          noteId: s.noteId,
          agentId: s.agentId,
          repo: s.repo,
          branch: s.branch,
          createdAt: s.createdAt.toISOString(),
        }
      );
      await tx.run(
        `MATCH (a:AgentSession {id: $sessionId}), (n:Note {id: $noteId})
         MERGE (a)-[:SESSION_FOR]->(n)`,
        { sessionId: s.id, noteId: note.id }
      );
    }

    // Audit events
    for (const event of auditEvents) {
      await tx.run(
        `MERGE (ae:AuditEvent {id: $id})
         SET ae.orgId = $orgId, ae.action = $action,
             ae.resourceType = $resourceType, ae.resourceId = $resourceId,
             ae.createdAt = $createdAt`,
        {
          id: String(event.id),
          orgId: event.orgId ?? orgId,
          action: event.action,
          resourceType: event.resourceType ?? "",
          resourceId: event.resourceId ?? "",
          createdAt: event.createdAt.toISOString(),
        }
      );
      await tx.run(
        `MATCH (ae:AuditEvent {id: $eventId}), (n:Note {id: $noteId})
         MERGE (ae)-[:ACTED_ON]->(n)`,
        { eventId: String(event.id), noteId: note.id }
      );
      if (event.userId) {
        await tx.run(
          `MATCH (u:User {id: $userId}), (ae:AuditEvent {id: $eventId})
           MERGE (u)-[:PERFORMED]->(ae)`,
          { userId: event.userId, eventId: String(event.id) }
        );
      }
    }
  });
}

async function syncAgentSession(session: Neo4jSession, sessionId: string, orgId: string): Promise<void> {
  const s = await db.query.agentSessions.findFirst({
    where: and(eq(agentSessions.id, sessionId), eq(agentSessions.orgId, orgId)),
  });
  if (!s) return;

  const sessionNote = await db.query.notes.findFirst({
    where: eq(notes.id, s.noteId),
  });

  const turns = await db
    .select()
    .from(conversationTurns)
    .where(and(eq(conversationTurns.sessionNoteId, s.noteId), eq(conversationTurns.orgId, orgId)))
    .limit(20);

  await session.executeWrite(async (tx) => {
    // Merge session
    await tx.run(
      `MERGE (a:AgentSession {id: $id})
       SET a.orgId = $orgId, a.noteId = $noteId,
           a.agentId = $agentId, a.repo = $repo, a.branch = $branch,
           a.createdAt = $createdAt`,
      {
        id: s.id,
        orgId: s.orgId,
        noteId: s.noteId,
        agentId: s.agentId,
        repo: s.repo,
        branch: s.branch,
        createdAt: s.createdAt.toISOString(),
      }
    );

    if (sessionNote) {
      await tx.run(
        `MERGE (n:Note {id: $id})
         SET n.orgId = $orgId, n.title = $title, n.visibility = $visibility,
             n.currentVersion = $currentVersion, n.createdAt = $createdAt, n.updatedAt = $updatedAt`,
        {
          id: sessionNote.id,
          orgId: sessionNote.orgId,
          title: sessionNote.title,
          visibility: sessionNote.visibility,
          currentVersion: sessionNote.currentVersion,
          createdAt: sessionNote.createdAt.toISOString(),
          updatedAt: sessionNote.updatedAt.toISOString(),
        }
      );
      await tx.run(
        `MATCH (a:AgentSession {id: $sessionId}), (n:Note {id: $noteId})
         MERGE (a)-[:SESSION_FOR]->(n)`,
        { sessionId: s.id, noteId: sessionNote.id }
      );
    }

    for (const turn of turns) {
      const contentPreview = turn.content.slice(0, 200);
      await tx.run(
        `MERGE (ct:ConversationTurn {id: $id})
         SET ct.orgId = $orgId, ct.sessionNoteId = $sessionNoteId,
             ct.turnIndex = $turnIndex, ct.role = $role,
             ct.createdAt = $createdAt, ct.contentPreview = $contentPreview`,
        {
          id: turn.id,
          orgId: turn.orgId,
          sessionNoteId: turn.sessionNoteId,
          turnIndex: turn.turnIndex,
          role: turn.role,
          createdAt: turn.createdAt.toISOString(),
          contentPreview,
        }
      );
      await tx.run(
        `MATCH (ct:ConversationTurn {id: $turnId}), (a:AgentSession {id: $sessionId})
         MERGE (ct)-[:TURN_IN]->(a)`,
        { turnId: turn.id, sessionId: s.id }
      );

      // Note refs
      const noteRefs = (turn.noteRefs ?? []) as { noteId: string; version?: number; title?: string }[];
      for (const ref of noteRefs) {
        await tx.run(
          `MERGE (n:Note {id: $noteId})
           ON CREATE SET n.orgId = $orgId, n.title = $title`,
          { noteId: ref.noteId, orgId, title: ref.title ?? "" }
        );
        await tx.run(
          `MATCH (ct:ConversationTurn {id: $turnId}), (n:Note {id: $noteId})
           MERGE (ct)-[:REFERENCES]->(n)`,
          { turnId: turn.id, noteId: ref.noteId }
        );
      }
    }
  });
}

async function syncConversationTurn(session: Neo4jSession, turnId: string, orgId: string): Promise<void> {
  const turn = await db.query.conversationTurns.findFirst({
    where: and(eq(conversationTurns.id, turnId), eq(conversationTurns.orgId, orgId)),
  });
  if (!turn) return;

  const sessionNote = await db.query.notes.findFirst({
    where: eq(notes.id, turn.sessionNoteId),
  });

  await session.executeWrite(async (tx) => {
    const contentPreview = turn.content.slice(0, 200);
    await tx.run(
      `MERGE (ct:ConversationTurn {id: $id})
       SET ct.orgId = $orgId, ct.sessionNoteId = $sessionNoteId,
           ct.turnIndex = $turnIndex, ct.role = $role,
           ct.createdAt = $createdAt, ct.contentPreview = $contentPreview`,
      {
        id: turn.id,
        orgId: turn.orgId,
        sessionNoteId: turn.sessionNoteId,
        turnIndex: turn.turnIndex,
        role: turn.role,
        createdAt: turn.createdAt.toISOString(),
        contentPreview,
      }
    );

    if (sessionNote) {
      await tx.run(
        `MERGE (n:Note {id: $id})
         SET n.orgId = $orgId, n.title = $title, n.visibility = $visibility,
             n.currentVersion = $currentVersion, n.createdAt = $createdAt, n.updatedAt = $updatedAt`,
        {
          id: sessionNote.id,
          orgId: sessionNote.orgId,
          title: sessionNote.title,
          visibility: sessionNote.visibility,
          currentVersion: sessionNote.currentVersion,
          createdAt: sessionNote.createdAt.toISOString(),
          updatedAt: sessionNote.updatedAt.toISOString(),
        }
      );
      // Find session for this note
      const s = await db.query.agentSessions.findFirst({
        where: and(eq(agentSessions.noteId, turn.sessionNoteId), eq(agentSessions.orgId, orgId)),
      });
      if (s) {
        await tx.run(
          `MERGE (a:AgentSession {id: $sessionId})
           SET a.orgId = $orgId, a.noteId = $noteId, a.agentId = $agentId,
               a.repo = $repo, a.branch = $branch, a.createdAt = $createdAt`,
          {
            sessionId: s.id,
            orgId: s.orgId,
            noteId: s.noteId,
            agentId: s.agentId,
            repo: s.repo,
            branch: s.branch,
            createdAt: s.createdAt.toISOString(),
          }
        );
        await tx.run(
          `MATCH (ct:ConversationTurn {id: $turnId}), (a:AgentSession {id: $sessionId})
           MERGE (ct)-[:TURN_IN]->(a)`,
          { turnId: turn.id, sessionId: s.id }
        );
      }
    }

    // Note refs
    const noteRefs = (turn.noteRefs ?? []) as { noteId: string; version?: number; title?: string }[];
    for (const ref of noteRefs) {
      await tx.run(
        `MERGE (n:Note {id: $noteId})
         ON CREATE SET n.orgId = $orgId, n.title = $title`,
        { noteId: ref.noteId, orgId, title: ref.title ?? "" }
      );
      await tx.run(
        `MATCH (ct:ConversationTurn {id: $turnId}), (n:Note {id: $noteId})
         MERGE (ct)-[:REFERENCES]->(n)`,
        { turnId: turn.id, noteId: ref.noteId }
      );
    }
  });
}

async function syncAuditEvent(session: Neo4jSession, eventIdStr: string, orgId: string): Promise<void> {
  const eventId = parseInt(eventIdStr, 10);
  if (isNaN(eventId)) return;

  const events = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.id, eventId), eq(auditLog.orgId, orgId)));
  const event = events[0];
  if (!event) return;

  // Resolve related records outside the Neo4j transaction (Postgres lookups
  // must not interleave with the Neo4j write transaction).
  const actor = event.userId
    ? await db.query.users.findFirst({ where: eq(users.id, event.userId) })
    : null;

  const relatedNote =
    event.resourceType === "note" && event.resourceId
      ? await db.query.notes.findFirst({ where: eq(notes.id, event.resourceId) })
      : null;

  await session.executeWrite(async (tx) => {
    await tx.run(
      `MERGE (ae:AuditEvent {id: $id})
       SET ae.orgId = $orgId, ae.action = $action,
           ae.resourceType = $resourceType, ae.resourceId = $resourceId,
           ae.createdAt = $createdAt`,
      {
        id: String(event.id),
        orgId: event.orgId ?? orgId,
        action: event.action,
        resourceType: event.resourceType ?? "",
        resourceId: event.resourceId ?? "",
        createdAt: event.createdAt.toISOString(),
      }
    );

    if (actor) {
      await tx.run(
        `MERGE (u:User {id: $id})
         SET u.orgId = $orgId, u.email = $email, u.displayName = $displayName`,
        { id: actor.id, orgId, email: actor.email, displayName: actor.displayName ?? "" }
      );
      await tx.run(
        `MATCH (u:User {id: $userId}), (ae:AuditEvent {id: $eventId})
         MERGE (u)-[:PERFORMED]->(ae)`,
        { userId: actor.id, eventId: String(event.id) }
      );
    }

    if (relatedNote) {
      await tx.run(
        `MERGE (n:Note {id: $id})
         SET n.orgId = $orgId, n.title = $title, n.visibility = $visibility,
             n.currentVersion = $currentVersion, n.createdAt = $createdAt, n.updatedAt = $updatedAt`,
        {
          id: relatedNote.id,
          orgId: relatedNote.orgId,
          title: relatedNote.title,
          visibility: relatedNote.visibility,
          currentVersion: relatedNote.currentVersion,
          createdAt: relatedNote.createdAt.toISOString(),
          updatedAt: relatedNote.updatedAt.toISOString(),
        }
      );
      await tx.run(
        `MATCH (ae:AuditEvent {id: $eventId}), (n:Note {id: $noteId})
         MERGE (ae)-[:ACTED_ON]->(n)`,
        { eventId: String(event.id), noteId: relatedNote.id }
      );
    }
  });
}

async function syncUser(session: Neo4jSession, userId: string, orgId: string): Promise<void> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return;

  await session.executeWrite(async (tx) => {
    await tx.run(
      `MERGE (u:User {id: $id})
       SET u.orgId = $orgId, u.email = $email, u.displayName = $displayName`,
      { id: user.id, orgId, email: user.email, displayName: user.displayName ?? "" }
    );
  });
}

async function syncTag(session: Neo4jSession, tagId: string, orgId: string): Promise<void> {
  const tag = await db.query.tags.findFirst({
    where: and(eq(tags.id, tagId), eq(tags.orgId, orgId)),
  });
  if (!tag) return;

  await session.executeWrite(async (tx) => {
    await tx.run(
      `MERGE (t:Tag {id: $id})
       SET t.orgId = $orgId, t.name = $name`,
      { id: tag.id, orgId: tag.orgId, name: tag.name }
    );
  });
}
