import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { sessionEpochSummaries } from "@/lib/db/schema";

export interface EpochSummary {
  id: string;
  epochStart: number;
  epochEnd: number;
  content: string;
  createdAt: Date;
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
