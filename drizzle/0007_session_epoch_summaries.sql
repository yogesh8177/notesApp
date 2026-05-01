CREATE TABLE IF NOT EXISTS "session_epoch_summaries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "note_id" uuid NOT NULL REFERENCES "notes"("id") ON DELETE CASCADE,
  "org_id" uuid NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "epoch_start" integer NOT NULL,
  "epoch_end" integer NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "session_epoch_summaries_note_idx"
  ON "session_epoch_summaries" ("note_id");

CREATE UNIQUE INDEX "session_epoch_summaries_note_epoch_unique"
  ON "session_epoch_summaries" ("note_id", "epoch_end");
