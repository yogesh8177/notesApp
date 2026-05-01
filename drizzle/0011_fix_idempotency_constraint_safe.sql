-- Idempotent repair: handles all possible DB states from 0009/0010.
-- Drop constraint first (if it exists), then index (if it exists), then re-add cleanly.
ALTER TABLE "conversation_turns"
  DROP CONSTRAINT IF EXISTS "conversation_turns_idempotency_key_unique";

DROP INDEX IF EXISTS "conversation_turns_idempotency_key_unique";

ALTER TABLE "conversation_turns"
  ADD CONSTRAINT "conversation_turns_idempotency_key_unique"
  UNIQUE ("idempotency_key");
