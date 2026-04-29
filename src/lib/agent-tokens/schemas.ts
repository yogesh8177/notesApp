import { z } from "zod";

export const createTokenSchema = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
});
export type CreateTokenInput = z.infer<typeof createTokenSchema>;

export const revokeTokenSchema = z.object({
  orgId: z.string().uuid(),
  tokenId: z.string().uuid(),
});
export type RevokeTokenInput = z.infer<typeof revokeTokenSchema>;
