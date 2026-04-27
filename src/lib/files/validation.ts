import { z } from "zod";

const optionalUuid = z
  .string()
  .uuid()
  .optional()
  .or(z.literal(""))
  .transform((value) => value || undefined);

export const filesListQuerySchema = z.object({
  orgId: z.string().uuid(),
});

export const noteFilesQuerySchema = z.object({
  noteId: z.string().uuid(),
});

export const createUploadSchema = z.object({
  orgId: z.string().uuid(),
  noteId: optionalUuid,
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255).default("application/octet-stream"),
  sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

export const deleteFileParamsSchema = z.object({
  fileId: z.string().uuid(),
});
