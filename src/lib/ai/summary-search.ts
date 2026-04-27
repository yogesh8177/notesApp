import { and, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { aiSummaries, notes } from "@/lib/db/schema";

/**
 * Returns note IDs (scoped to `orgId`) whose latest summary contains the
 * search term in its tldr or keyPoints text.
 *
 * The org filter is enforced here via JOIN — callers must not rely on
 * intersecting the result with their own org filter for correctness.
 *
 * Integration note for notes-core's listNotesForUser:
 *   const summaryIds = term ? await getSummaryMatchingNoteIds(orgId, term) : [];
 *   // add to the OR condition alongside title/content ilike:
 *   summaryIds.length ? inArray(notes.id, summaryIds) : undefined,
 */
export async function getSummaryMatchingNoteIds(orgId: string, term: string): Promise<string[]> {
  const pattern = `%${term}%`;

  const rows = await db
    .selectDistinct({ noteId: aiSummaries.noteId })
    .from(aiSummaries)
    .innerJoin(notes, eq(notes.id, aiSummaries.noteId))
    .where(
      and(
        eq(notes.orgId, orgId),
        isNull(notes.deletedAt),
        or(
          ilike(sql`(${aiSummaries.structured}->>'tldr')`, pattern),
          ilike(sql`(${aiSummaries.structured}->'keyPoints')::text`, pattern),
        ),
      ),
    );

  return rows.map((r) => r.noteId);
}
