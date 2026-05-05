import { count, desc, eq, sql } from "drizzle-orm";
import { agentSessions, auditLog, conversationTurns, noteVersions, notes } from "@/lib/db/schema";
import { db } from "@/lib/db/client";
import { sessionEpochSummaries } from "@/lib/db/schema";

export interface EpochSummary {
  id: string;
  epochStart: number;
  epochEnd: number;
  content: string;
  createdAt: Date;
}

export interface AgentSessionRow {
  id: string;
  noteId: string;
  noteTitle: string;
  agentId: string;
  repo: string;
  branch: string;
  createdAt: Date;
  lastSeenAt: Date;
}

export async function listAgentSessions(orgId: string, limit = 20): Promise<AgentSessionRow[]> {
  const rows = await db
    .select({
      id: agentSessions.id,
      noteId: agentSessions.noteId,
      noteTitle: notes.title,
      agentId: agentSessions.agentId,
      repo: agentSessions.repo,
      branch: agentSessions.branch,
      createdAt: agentSessions.createdAt,
      lastSeenAt: agentSessions.lastSeenAt,
    })
    .from(agentSessions)
    .innerJoin(notes, eq(notes.id, agentSessions.noteId))
    .where(eq(agentSessions.orgId, orgId))
    .orderBy(desc(agentSessions.lastSeenAt))
    .limit(limit);
  return rows;
}

export interface SessionStats {
  totalSubagents: number;
  totalTurns: number;
  /** UTC hour (0–23) with the most checkpoint activity, null if no versions exist. */
  peakHour: number | null;
  peakHourCount: number;
}

export async function getSessionStats(orgId: string, noteId: string): Promise<SessionStats> {
  const [subagentResult, turnResult, peakHourResult] = await Promise.all([
    // Distinct subagent IDs from subagent.start events on this session note
    db
      .select({ total: sql<string>`COUNT(DISTINCT ${auditLog.metadata}->>'agentId')` })
      .from(auditLog)
      .where(
        sql`${auditLog.orgId} = ${orgId}
          AND ${auditLog.resourceId} = ${noteId}
          AND ${auditLog.action} = 'agent.event.subagent.start'`,
      ),
    // Total conversation turns logged for this session
    db
      .select({ total: count(conversationTurns.id) })
      .from(conversationTurns)
      .where(eq(conversationTurns.sessionNoteId, noteId)),
    // Hour-of-day (UTC) with most checkpoint versions
    db
      .select({
        hour: sql<number>`EXTRACT(HOUR FROM ${noteVersions.createdAt} AT TIME ZONE 'UTC')::int`,
        cnt: count(noteVersions.id),
      })
      .from(noteVersions)
      .where(eq(noteVersions.noteId, noteId))
      .groupBy(sql`EXTRACT(HOUR FROM ${noteVersions.createdAt} AT TIME ZONE 'UTC')::int`)
      .orderBy(desc(count(noteVersions.id)))
      .limit(1),
  ]);

  return {
    totalSubagents: Number(subagentResult[0]?.total ?? 0),
    totalTurns: turnResult[0]?.total ?? 0,
    peakHour: peakHourResult[0] != null ? peakHourResult[0].hour : null,
    peakHourCount: peakHourResult[0]?.cnt ?? 0,
  };
}

export async function getEpochSummaries(noteId: string): Promise<EpochSummary[]> {
  const rows = await db
    .select({
      id: sessionEpochSummaries.id,
      epochStart: sessionEpochSummaries.epochStart,
      epochEnd: sessionEpochSummaries.epochEnd,
      content: sessionEpochSummaries.content,
      createdAt: sessionEpochSummaries.createdAt,
    })
    .from(sessionEpochSummaries)
    .where(eq(sessionEpochSummaries.noteId, noteId))
    .orderBy(desc(sessionEpochSummaries.epochEnd));

  return rows;
}
