import { desc, eq } from "drizzle-orm";
import { agentSessions, notes } from "@/lib/db/schema";
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
