import { pgEnum } from "drizzle-orm/pg-core";

export const orgRole = pgEnum("org_role", ["owner", "admin", "member", "viewer"]);
export type OrgRole = (typeof orgRole.enumValues)[number];

export const noteVisibility = pgEnum("note_visibility", ["private", "org", "shared"]);
export type NoteVisibility = (typeof noteVisibility.enumValues)[number];

export const sharePermission = pgEnum("share_permission", ["view", "edit"]);
export type SharePermission = (typeof sharePermission.enumValues)[number];

export const aiProvider = pgEnum("ai_provider", ["anthropic", "openai"]);
export type AiProvider = (typeof aiProvider.enumValues)[number];

export const aiSummaryStatus = pgEnum("ai_summary_status", [
  "pending",
  "completed",
  "failed",
  "accepted",
]);
export type AiSummaryStatus = (typeof aiSummaryStatus.enumValues)[number];
