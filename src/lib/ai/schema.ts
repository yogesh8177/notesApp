import { z } from "zod";

export const summaryFieldSchema = z.enum([
  "tldr",
  "keyPoints",
  "actionItems",
  "entities",
]);

export type SummaryField = z.infer<typeof summaryFieldSchema>;

export const summaryShape = z.object({
  tldr: z.string().max(280),
  keyPoints: z.array(z.string().max(200)).max(8),
  actionItems: z
    .array(
      z.object({
        text: z.string().max(200),
        owner: z.string().max(120).nullable(),
      }),
    )
    .max(10),
  entities: z
    .array(
      z.object({
        name: z.string(),
        kind: z.enum(["person", "org", "project", "date", "other"]),
      }),
    )
    .max(20),
});

export const acceptedSummaryShape = summaryShape.partial();

export type SummaryShape = z.infer<typeof summaryShape>;
export type AcceptedSummaryShape = z.infer<typeof acceptedSummaryShape>;

export function pickAcceptedSummaryFields(
  summary: SummaryShape,
  fields: SummaryField[],
): AcceptedSummaryShape {
  const accepted: AcceptedSummaryShape = {};

  for (const field of fields) {
    accepted[field] = summary[field];
  }

  return accepted;
}
