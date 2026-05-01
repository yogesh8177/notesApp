-- Replace partial unique index with a full unique constraint so ON CONFLICT works.
-- Postgres treats NULLs as distinct in unique indexes, so multiple NULL rows are fine.
DROP INDEX IF EXISTS "conversation_turns_idempotency_key_unique";

ALTER TABLE "conversation_turns"
  ADD CONSTRAINT "conversation_turns_idempotency_key_unique"
  UNIQUE ("idempotency_key");
