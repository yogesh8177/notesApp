#!/usr/bin/env node
/**
 * UserPromptSubmit hook — captures user prompts as conversation turns.
 * Fires before Claude reads the user's message. Silently logs the prompt
 * to the conversation_turns table via the agent API.
 */
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

  try {
    await api("POST", `/agent/sessions/${session.sessionNoteId}/turns`, {
      role: "user",
      content: prompt,
    });
  } catch (err) {
    process.stderr.write(`[prompt] ${err.message}\n`);
  }
})();
