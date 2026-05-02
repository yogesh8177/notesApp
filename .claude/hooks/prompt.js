#!/usr/bin/env node
/**
 * UserPromptSubmit hook — captures user prompts as conversation turns.
 * Uses a deterministic idempotency key so hook retries don't insert duplicates.
 */
const { createHash } = require("crypto");
const { readStdin, loadSession, api } = require("./_lib");

const MIN_LEN = 4;

(async () => {
  const input = readStdin();
  if (input.hook_event_name !== "UserPromptSubmit") return;

  const prompt = (input.prompt || "").trim();
  if (prompt.length < MIN_LEN || prompt.startsWith("/")) return;

  const sessionId = input.session_id || "default";
  const session = loadSession(sessionId);
  if (!session?.sessionNoteId) return;

  // Stable key: same prompt content in the same session always hashes identically,
  // so a hook retry is silently deduplicated by the server.
  const idempotencyKey = createHash("sha256")
    .update(`${session.sessionNoteId}:user:${prompt}`)
    .digest("hex")
    .slice(0, 64);

  try {
    await api("POST", `/agent/sessions/${session.sessionNoteId}/turns`, {
      role: "user",
      content: prompt,
      idempotencyKey,
    });
  } catch (err) {
    process.stderr.write(`[prompt] ${err.message}\n`);
  }

  // Inject a reminder so the model logs its own response via mcp__notes-app__log_turn
  // as a fallback in case the Stop hook misses a turn.
  process.stdout.write(JSON.stringify({
    hookSpecificPromptAppend:
      "After your final response this turn, call mcp__notes-app__log_turn to record your assistant message in the session log.",
  }));
})();
