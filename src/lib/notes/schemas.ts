import { z } from "zod";

const visibilityValues = ["private", "org", "shared"] as const;
const sharePermissionValues = ["view", "edit"] as const;

export const notesListQuerySchema = z.object({
  orgId: z.string().uuid(),
  q: z.string().trim().max(200).optional(),
  visibility: z.enum(visibilityValues).optional(),
  authorId: z.string().uuid().optional(),
  tag: z.string().trim().max(64).optional(),
});

export const noteInputSchema = z.object({
  orgId: z.string().uuid(),
  title: z.string().trim().min(1, "Title is required").max(200),
  content: z.string().max(100_000).default(""),
  visibility: z.enum(visibilityValues),
  tags: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
  changeSummary: z.string().trim().max(280).optional(),
});

export const noteCreateSchema = noteInputSchema;

export const noteUpdateSchema = noteInputSchema.partial().extend({
  orgId: z.string().uuid().optional(),
});

export const noteShareSchema = z.object({
  sharedWithUserId: z.string().uuid(),
  permission: z.enum(sharePermissionValues),
});

export const historyQuerySchema = z.object({
  version: z.coerce.number().int().positive().optional(),
  compareTo: z.coerce.number().int().positive().optional(),
});

export type NotesListQuery = z.infer<typeof notesListQuerySchema>;
export type NoteCreateInput = z.infer<typeof noteCreateSchema>;
export type NoteUpdateInput = z.infer<typeof noteUpdateSchema>;
export type NoteShareInput = z.infer<typeof noteShareSchema>;
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
