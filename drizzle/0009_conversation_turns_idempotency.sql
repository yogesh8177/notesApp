ALTER TABLE "conversation_turns"
  ADD COLUMN IF NOT EXISTS "idempotency_key" text;

CREATE UNIQUE INDEX IF NOT EXISTS "conversation_turns_idempotency_key_unique"
  ON "conversation_turns" ("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
