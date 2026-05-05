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
 * Remove a node and all its relationships from Neo4j.
 * Safe to call even when Neo4j is unavailable — returns early without throwing.
 */
export async function deleteNode(
  type: GraphNodeType,
  id: string
): Promise<void> {
  const driver = getDriver();
  if (!driver) return;

  const session = driver.session();
  try {
    await session.executeWrite((tx) =>
      tx.run(`MATCH (n:${type} {id: $id}) DETACH DELETE n`, { id })
    );
  } catch (err) {
    log.error({ err, type, id }, "graph.delete.error");
    throw err;
  } finally {
    await session.close();
  }
}

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
      case "Note":             await syncNote(session, id, orgId);             break;
      case "AgentSession":     await syncAgentSession(session, id, orgId);     break;
      case "ConversationTurn": await syncConversationTurn(session, id, orgId); break;
      case "AuditEvent":       await syncAuditEvent(session, id, orgId);       break;
      case "User":             await syncUser(session, id, orgId);             break;
      case "Tag":              await syncTag(session, id, orgId);              break;
      default:                 log.warn({ type, id }, "graph.sync.unknown_type");
    }
  } catch (err) {
    log.error({ err, type, id, orgId }, "graph.sync.error");
    throw err;
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

  // Parallel Postgres reads
  const [author, noteTagnLinks, shares, sessions, auditEvents] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, note.authorId) }),
    db.select({ tagId: noteTags.tagId, tagName: tags.name })
      .from(noteTags)
      .innerJoin(tags, eq(tags.id, noteTags.tagId))
      .where(eq(noteTags.noteId, noteId)),
    db.query.noteShares.findMany({ where: eq(noteShares.noteId, noteId) }),
    db.query.agentSessions.findMany({
      where: and(eq(agentSessions.noteId, noteId), eq(agentSessions.orgId, orgId)),
    }),
    db.select()
      .from(auditLog)
      .where(and(eq(auditLog.resourceId, noteId), eq(auditLog.orgId, orgId)))
      .limit(20),
  ]);

  const sharedUserIds = shares.map((s) => s.sharedWithUserId);
  const sharedUsers = sharedUserIds.length > 0
    ? await db.select().from(users).where(inArray(users.id, sharedUserIds))
    : [];
  const sharedUserMap = new Map(sharedUsers.map((u) => [u.id, u]));

  const syncedAt = new Date().toISOString();

  await session.executeWrite(async (tx) => {
    // Note node
    await tx.run(
      `MERGE (n:Note {id: $id})
       SET n.orgId = $orgId, n.title = $title, n.visibility = $visibility,
           n.currentVersion = $currentVersion, n.createdAt = $createdAt,
           n.updatedAt = $updatedAt, n.syncedAt = $syncedAt`,
      {
        id: note.id, orgId: note.orgId, title: note.title, visibility: note.visibility,
        currentVersion: note.currentVersion, createdAt: note.createdAt.toISOString(),
        updatedAt: note.updatedAt.toISOString(), syncedAt,
      }
    );

    // Author — User nodes are cross-org; no orgId stored to avoid last-writer-wins corruption.
    if (author) {
      await tx.run(
        `MERGE (u:User {id: $id})
         SET u.email = $email, u.displayName = $displayName, u.syncedAt = $syncedAt`,
        { id: author.id, email: author.email, displayName: author.displayName ?? "", syncedAt }
      );
      await tx.run(
        `MATCH (u:User {id: $userId}), (n:Note {id: $noteId}) MERGE (u)-[:AUTHORED]->(n)`,
        { userId: author.id, noteId: note.id }
      );
    }

    // Tags: clear stale relationships first, then rebuild current state with UNWIND
    await tx.run(
      `MATCH (n:Note {id: $noteId})-[r:HAS_TAG]->() DELETE r`,
      { noteId: note.id }
    );
    if (noteTagnLinks.length > 0) {
      await tx.run(
        `UNWIND $tags AS tag
         MERGE (t:Tag {id: tag.id})
         SET t.orgId = tag.orgId, t.name = tag.name, t.syncedAt = $syncedAt`,
        { tags: noteTagnLinks.map(({ tagId, tagName }) => ({ id: tagId, orgId, name: tagName })), syncedAt }
      );
      await tx.run(
        `UNWIND $tags AS tag
         MATCH (n:Note {id: $noteId}), (t:Tag {id: tag.id})
         MERGE (n)-[:HAS_TAG]->(t)`,
        { tags: noteTagnLinks.map(({ tagId }) => ({ id: tagId })), noteId: note.id }
      );
    }

    // Shares: clear stale relationships first, then rebuild current state with UNWIND
    await tx.run(
      `MATCH (n:Note {id: $noteId})-[r:SHARED_WITH]->() DELETE r`,
      { noteId: note.id }
    );
    const sharedData = shares
      .map((share) => {
        const u = sharedUserMap.get(share.sharedWithUserId);
        return u
          ? { userId: u.id, email: u.email, displayName: u.displayName ?? "", permission: share.permission }
          : null;
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    if (sharedData.length > 0) {
      await tx.run(
        `UNWIND $shares AS s
         MERGE (u:User {id: s.userId})
         SET u.email = s.email, u.displayName = s.displayName, u.syncedAt = $syncedAt`,
        { shares: sharedData, syncedAt }
      );
      await tx.run(
        `UNWIND $shares AS s
         MATCH (n:Note {id: $noteId}), (u:User {id: s.userId})
         MERGE (n)-[r:SHARED_WITH]->(u) SET r.permission = s.permission`,
        { shares: sharedData, noteId: note.id }
      );
    }

    // Agent sessions — batched with UNWIND
    if (sessions.length > 0) {
      await tx.run(
        `UNWIND $sessions AS s
         MERGE (a:AgentSession {id: s.id})
         SET a.orgId = s.orgId, a.noteId = s.noteId, a.agentId = s.agentId,
             a.repo = s.repo, a.branch = s.branch, a.createdAt = s.createdAt, a.syncedAt = $syncedAt`,
        {
          sessions: sessions.map((s) => ({
            id: s.id, orgId: s.orgId, noteId: s.noteId, agentId: s.agentId,
            repo: s.repo, branch: s.branch, createdAt: s.createdAt.toISOString(),
          })),
          syncedAt,
        }
      );
      await tx.run(
        `UNWIND $sessions AS s
         MATCH (a:AgentSession {id: s.id}), (n:Note {id: $noteId})
         MERGE (a)-[:SESSION_FOR]->(n)`,
        { sessions: sessions.map((s) => ({ id: s.id })), noteId: note.id }
      );
    }

    // Audit events — batched with UNWIND
    if (auditEvents.length > 0) {
      await tx.run(
        `UNWIND $events AS e
         MERGE (ae:AuditEvent {id: e.id})
         SET ae.orgId = e.orgId, ae.action = e.action, ae.resourceType = e.resourceType,
             ae.resourceId = e.resourceId, ae.createdAt = e.createdAt, ae.syncedAt = $syncedAt`,
        {
          events: auditEvents.map((e) => ({
            id: String(e.id), orgId: e.orgId ?? orgId, action: e.action,
            resourceType: e.resourceType ?? "", resourceId: e.resourceId ?? "",
            createdAt: e.createdAt.toISOString(),
          })),
          syncedAt,
        }
      );
      await tx.run(
        `UNWIND $events AS e
         MATCH (ae:AuditEvent {id: e.id}), (n:Note {id: $noteId})
         MERGE (ae)-[:ACTED_ON]->(n)`,
        { events: auditEvents.map((e) => ({ id: String(e.id) })), noteId: note.id }
      );

      const eventsWithUser = auditEvents.filter((e) => e.userId);
      if (eventsWithUser.length > 0) {
        await tx.run(
          `UNWIND $events AS e
           MATCH (u:User {id: e.userId}), (ae:AuditEvent {id: e.eventId})
           MERGE (u)-[:PERFORMED]->(ae)`,
          { events: eventsWithUser.map((e) => ({ userId: e.userId, eventId: String(e.id) })) }
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

  const [sessionNote, turns] = await Promise.all([
    db.query.notes.findFirst({ where: eq(notes.id, s.noteId) }),
    db.select()
      .from(conversationTurns)
      .where(and(eq(conversationTurns.sessionNoteId, s.noteId), eq(conversationTurns.orgId, orgId)))
      .limit(20),
  ]);

  const syncedAt = new Date().toISOString();

  await session.executeWrite(async (tx) => {
    await tx.run(
      `MERGE (a:AgentSession {id: $id})
       SET a.orgId = $orgId, a.noteId = $noteId, a.agentId = $agentId,
           a.repo = $repo, a.branch = $branch, a.createdAt = $createdAt, a.syncedAt = $syncedAt`,
      {
        id: s.id, orgId: s.orgId, noteId: s.noteId, agentId: s.agentId,
        repo: s.repo, branch: s.branch, createdAt: s.createdAt.toISOString(), syncedAt,
      }
    );

    if (sessionNote) {
      await tx.run(
        `MERGE (n:Note {id: $id})
         SET n.orgId = $orgId, n.title = $title, n.visibility = $visibility,
             n.currentVersion = $currentVersion, n.createdAt = $createdAt,
             n.updatedAt = $updatedAt, n.syncedAt = $syncedAt`,
        {
          id: sessionNote.id, orgId: sessionNote.orgId, title: sessionNote.title,
          visibility: sessionNote.visibility, currentVersion: sessionNote.currentVersion,
          createdAt: sessionNote.createdAt.toISOString(), updatedAt: sessionNote.updatedAt.toISOString(), syncedAt,
        }
      );
      await tx.run(
        `MATCH (a:AgentSession {id: $sessionId}), (n:Note {id: $noteId}) MERGE (a)-[:SESSION_FOR]->(n)`,
        { sessionId: s.id, noteId: sessionNote.id }
      );
    }

    // Conversation turns — batched with UNWIND
    if (turns.length > 0) {
      await tx.run(
        `UNWIND $turns AS t
         MERGE (ct:ConversationTurn {id: t.id})
         SET ct.orgId = t.orgId, ct.sessionNoteId = t.sessionNoteId,
             ct.turnIndex = t.turnIndex, ct.role = t.role,
             ct.createdAt = t.createdAt, ct.contentPreview = t.contentPreview, ct.syncedAt = $syncedAt`,
        {
          turns: turns.map((t) => ({
            id: t.id, orgId: t.orgId, sessionNoteId: t.sessionNoteId,
            turnIndex: t.turnIndex, role: t.role,
            createdAt: t.createdAt.toISOString(), contentPreview: t.content.slice(0, 200),
          })),
          syncedAt,
        }
      );
      await tx.run(
        `UNWIND $turns AS t
         MATCH (ct:ConversationTurn {id: t.id}), (a:AgentSession {id: $sessionId})
         MERGE (ct)-[:TURN_IN]->(a)`,
        { turns: turns.map((t) => ({ id: t.id })), sessionId: s.id }
      );

      // Flatten noteRefs across all turns for a single batched REFERENCES pass
      const allNoteRefs = turns.flatMap((t) =>
        ((t.noteRefs ?? []) as { noteId: string; title?: string }[]).map((ref) => ({
          turnId: t.id,
          noteId: ref.noteId,
          title: ref.title ?? "",
        }))
      );

      if (allNoteRefs.length > 0) {
        await tx.run(
          `UNWIND $refs AS ref
           MERGE (n:Note {id: ref.noteId})
           ON CREATE SET n.orgId = $orgId, n.title = ref.title`,
          { refs: allNoteRefs, orgId }
        );
        await tx.run(
          `UNWIND $refs AS ref
           MATCH (ct:ConversationTurn {id: ref.turnId}), (n:Note {id: ref.noteId})
           MERGE (ct)-[:REFERENCES]->(n)`,
          { refs: allNoteRefs }
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

  const syncedAt = new Date().toISOString();

  await session.executeWrite(async (tx) => {
    await tx.run(
      `MERGE (ct:ConversationTurn {id: $id})
       SET ct.orgId = $orgId, ct.sessionNoteId = $sessionNoteId,
           ct.turnIndex = $turnIndex, ct.role = $role,
           ct.createdAt = $createdAt, ct.contentPreview = $contentPreview, ct.syncedAt = $syncedAt`,
      {
        id: turn.id, orgId: turn.orgId, sessionNoteId: turn.sessionNoteId,
        turnIndex: turn.turnIndex, role: turn.role,
        createdAt: turn.createdAt.toISOString(), contentPreview: turn.content.slice(0, 200), syncedAt,
      }
    );

    if (sessionNote) {
      await tx.run(
        `MERGE (n:Note {id: $id})
         SET n.orgId = $orgId, n.title = $title, n.visibility = $visibility,
             n.currentVersion = $currentVersion, n.createdAt = $createdAt,
             n.updatedAt = $updatedAt, n.syncedAt = $syncedAt`,
        {
          id: sessionNote.id, orgId: sessionNote.orgId, title: sessionNote.title,
          visibility: sessionNote.visibility, currentVersion: sessionNote.currentVersion,
          createdAt: sessionNote.createdAt.toISOString(), updatedAt: sessionNote.updatedAt.toISOString(), syncedAt,
        }
      );

      // Look up the owning session so we can wire TURN_IN
      const s = await db.query.agentSessions.findFirst({
        where: and(eq(agentSessions.noteId, turn.sessionNoteId), eq(agentSessions.orgId, orgId)),
      });
      if (s) {
        await tx.run(
          `MERGE (a:AgentSession {id: $sessionId})
           SET a.orgId = $orgId, a.noteId = $noteId, a.agentId = $agentId,
               a.repo = $repo, a.branch = $branch, a.createdAt = $createdAt, a.syncedAt = $syncedAt`,
          {
            sessionId: s.id, orgId: s.orgId, noteId: s.noteId, agentId: s.agentId,
            repo: s.repo, branch: s.branch, createdAt: s.createdAt.toISOString(), syncedAt,
          }
        );
        await tx.run(
          `MATCH (ct:ConversationTurn {id: $turnId}), (a:AgentSession {id: $sessionId}) MERGE (ct)-[:TURN_IN]->(a)`,
          { turnId: turn.id, sessionId: s.id }
        );
      }
    }

    // noteRefs — batched with UNWIND
    const noteRefs = (turn.noteRefs ?? []) as { noteId: string; version?: number; title?: string }[];
    if (noteRefs.length > 0) {
      await tx.run(
        `UNWIND $refs AS ref
         MERGE (n:Note {id: ref.noteId})
         ON CREATE SET n.orgId = $orgId, n.title = ref.title`,
        { refs: noteRefs.map((ref) => ({ noteId: ref.noteId, title: ref.title ?? "" })), orgId }
      );
      await tx.run(
        `UNWIND $refs AS ref
         MATCH (ct:ConversationTurn {id: $turnId}), (n:Note {id: ref.noteId})
         MERGE (ct)-[:REFERENCES]->(n)`,
        { refs: noteRefs.map((ref) => ({ noteId: ref.noteId })), turnId: turn.id }
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

  // Parallel Postgres reads — must happen outside the Neo4j transaction
  const [actor, relatedNote] = await Promise.all([
    event.userId
      ? db.query.users.findFirst({ where: eq(users.id, event.userId) })
      : Promise.resolve(null),
    event.resourceType === "note" && event.resourceId
      ? db.query.notes.findFirst({ where: eq(notes.id, event.resourceId) })
      : Promise.resolve(null),
  ]);

  const syncedAt = new Date().toISOString();

  await session.executeWrite(async (tx) => {
    await tx.run(
      `MERGE (ae:AuditEvent {id: $id})
       SET ae.orgId = $orgId, ae.action = $action, ae.resourceType = $resourceType,
           ae.resourceId = $resourceId, ae.createdAt = $createdAt, ae.syncedAt = $syncedAt`,
      {
        id: String(event.id), orgId: event.orgId ?? orgId, action: event.action,
        resourceType: event.resourceType ?? "", resourceId: event.resourceId ?? "",
        createdAt: event.createdAt.toISOString(), syncedAt,
      }
    );

    if (actor) {
      await tx.run(
        `MERGE (u:User {id: $id})
         SET u.email = $email, u.displayName = $displayName, u.syncedAt = $syncedAt`,
        { id: actor.id, email: actor.email, displayName: actor.displayName ?? "", syncedAt }
      );
      await tx.run(
        `MATCH (u:User {id: $userId}), (ae:AuditEvent {id: $eventId}) MERGE (u)-[:PERFORMED]->(ae)`,
        { userId: actor.id, eventId: String(event.id) }
      );
    }

    if (relatedNote) {
      await tx.run(
        `MERGE (n:Note {id: $id})
         SET n.orgId = $orgId, n.title = $title, n.visibility = $visibility,
             n.currentVersion = $currentVersion, n.createdAt = $createdAt,
             n.updatedAt = $updatedAt, n.syncedAt = $syncedAt`,
        {
          id: relatedNote.id, orgId: relatedNote.orgId, title: relatedNote.title,
          visibility: relatedNote.visibility, currentVersion: relatedNote.currentVersion,
          createdAt: relatedNote.createdAt.toISOString(), updatedAt: relatedNote.updatedAt.toISOString(), syncedAt,
        }
      );
      await tx.run(
        `MATCH (ae:AuditEvent {id: $eventId}), (n:Note {id: $noteId}) MERGE (ae)-[:ACTED_ON]->(n)`,
        { eventId: String(event.id), noteId: relatedNote.id }
      );
    }
  });
}

async function syncUser(session: Neo4jSession, userId: string, orgId: string): Promise<void> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return;

  const syncedAt = new Date().toISOString();
  await session.executeWrite(async (tx) => {
    await tx.run(
      `MERGE (u:User {id: $id})
       SET u.email = $email, u.displayName = $displayName, u.syncedAt = $syncedAt`,
      { id: user.id, email: user.email, displayName: user.displayName ?? "", syncedAt }
    );
  });
}

async function syncTag(session: Neo4jSession, tagId: string, orgId: string): Promise<void> {
  const tag = await db.query.tags.findFirst({
    where: and(eq(tags.id, tagId), eq(tags.orgId, orgId)),
  });
  if (!tag) return;

  const syncedAt = new Date().toISOString();
  await session.executeWrite(async (tx) => {
    await tx.run(
      `MERGE (t:Tag {id: $id}) SET t.orgId = $orgId, t.name = $name, t.syncedAt = $syncedAt`,
      { id: tag.id, orgId: tag.orgId, name: tag.name, syncedAt }
    );
  });
}
