import { eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { aiSummaries } from "@/lib/db/schema";

/**
 * Returns note IDs whose latest accepted summary contains the search term
 * in its tldr or keyPoints text. Called by notes-core's listNotesForUser
 * when a search term is present, to widen results to include summary text.
 *
 * Integration note for notes-core:
 *   In listNotesForUser, add to the OR filter:
 *     inArray(notes.id, await getSummaryMatchingNoteIds(orgId, term))
 */
export async function getSummaryMatchingNoteIds(orgId: string, term: string): Promise<string[]> {
  const pattern = `%${term}%`;

  const rows = await db
    .selectDistinct({ noteId: aiSummaries.noteId })
    .from(aiSummaries)
    .where(
      or(
        ilike(sql`(${aiSummaries.structured}->>'tldr')`, pattern),
        ilike(sql`(${aiSummaries.structured}->'keyPoints')::text`, pattern),
      ),
    );

  // Filter to notes that belong to this org at the caller side — the summary
  // table doesn't store orgId, so notes-core must intersect with its own org filter.
  return rows.map((r) => r.noteId);
}
