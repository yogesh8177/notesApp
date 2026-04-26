import { z } from "zod";

export const createOrgSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(80),
  slug: z
    .string()
    .regex(/^[a-z0-9-]{2,40}$/, "Slug must be 2–40 lowercase letters, numbers, or hyphens"),
});

export const inviteMemberSchema = z.object({
  email: z.string().email("Must be a valid email address"),
  role: z.enum(["admin", "member", "viewer"]),
});

export const changeRoleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["owner", "admin", "member", "viewer"]),
});

export type CreateOrgInput = z.infer<typeof createOrgSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;
