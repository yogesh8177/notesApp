CREATE TYPE "public"."ai_provider" AS ENUM('anthropic', 'openai');--> statement-breakpoint
CREATE TYPE "public"."ai_summary_status" AS ENUM('pending', 'completed', 'failed', 'accepted');--> statement-breakpoint
CREATE TYPE "public"."note_visibility" AS ENUM('private', 'org', 'shared');--> statement-breakpoint
CREATE TYPE "public"."org_role" AS ENUM('owner', 'admin', 'member', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."share_permission" AS ENUM('view', 'edit');--> statement-breakpoint
CREATE TABLE "auth"."users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "org_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "org_role" DEFAULT 'member' NOT NULL,
	"token" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"accepted_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"shared_with_user_id" uuid NOT NULL,
	"permission" "share_permission" DEFAULT 'view' NOT NULL,
	"shared_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note_tags" (
	"note_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "note_tags_note_id_tag_id_pk" PRIMARY KEY("note_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "note_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"visibility" "note_visibility" NOT NULL,
	"changed_by" uuid NOT NULL,
	"change_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"visibility" "note_visibility" DEFAULT 'org' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"search_vector" "tsvector",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"note_id" uuid,
	"uploaded_by" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"note_version" integer NOT NULL,
	"provider" "ai_provider" NOT NULL,
	"model" text NOT NULL,
	"status" "ai_summary_status" DEFAULT 'pending' NOT NULL,
	"raw_output" jsonb,
	"structured" jsonb,
	"accepted_fields" jsonb,
	"error_message" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid,
	"user_id" uuid,
	"action" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_invites" ADD CONSTRAINT "org_invites_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_invites" ADD CONSTRAINT "org_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_shares" ADD CONSTRAINT "note_shares_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_shares" ADD CONSTRAINT "note_shares_shared_with_user_id_users_id_fk" FOREIGN KEY ("shared_with_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_shares" ADD CONSTRAINT "note_shares_shared_by_users_id_fk" FOREIGN KEY ("shared_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_tags" ADD CONSTRAINT "note_tags_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_tags" ADD CONSTRAINT "note_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_versions" ADD CONSTRAINT "note_versions_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_versions" ADD CONSTRAINT "note_versions_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_summaries" ADD CONSTRAINT "ai_summaries_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_summaries" ADD CONSTRAINT "ai_summaries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_unique" ON "memberships" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_invites_token_unique" ON "org_invites" USING btree ("token");--> statement-breakpoint
CREATE INDEX "org_invites_org_email_idx" ON "org_invites" USING btree ("org_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "orgs_slug_unique" ON "orgs" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "note_shares_note_user_unique" ON "note_shares" USING btree ("note_id","shared_with_user_id");--> statement-breakpoint
CREATE INDEX "note_shares_user_idx" ON "note_shares" USING btree ("shared_with_user_id");--> statement-breakpoint
CREATE INDEX "note_tags_tag_idx" ON "note_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "note_versions_note_version_unique" ON "note_versions" USING btree ("note_id","version");--> statement-breakpoint
CREATE INDEX "note_versions_note_created_idx" ON "note_versions" USING btree ("note_id","created_at");--> statement-breakpoint
CREATE INDEX "notes_org_idx" ON "notes" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "notes_org_updated_idx" ON "notes" USING btree ("org_id","updated_at");--> statement-breakpoint
CREATE INDEX "notes_author_idx" ON "notes" USING btree ("author_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_org_name_unique" ON "tags" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "files_org_idx" ON "files" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "files_note_idx" ON "files" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "ai_summaries_note_idx" ON "ai_summaries" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "ai_summaries_status_idx" ON "ai_summaries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audit_log_org_created_idx" ON "audit_log" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_log_user_created_idx" ON "audit_log" USING btree ("user_id","created_at");