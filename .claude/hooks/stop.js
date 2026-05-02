#!/usr/bin/env node
/**
 * Stop hook — logs the last assistant response as a conversation turn.
 * Reads the last assistant text block from the session JSONL transcript,
 * then POSTs it as role:"assistant" via the turns API.
 * If no text is found, logs a sentinel so the turn is never silently missing.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { createHash } = require("crypto");
const { readStdin, loadCurrentSession, loadSession, api } = require("./_lib");

const MAX_CONTENT_LEN = 4000;

/** Derive the Claude project storage key from the working directory. */
function projectKey(cwd) {
  return (cwd || process.cwd()).replace(/\//g, "-");
}

/**
 * Walk the JSONL backwards to find the last assistant message with text.
 * Returns { text, uuid } where uuid is the message's UUID for idempotency.
 */
function getLastAssistantMessage(sessionId) {
  const cwd = process.cwd();
  const key = projectKey(cwd);
  const jsonlPath = path.join(os.homedir(), ".claude", "projects", key, `${sessionId}.jsonl`);
  if (!fs.existsSync(jsonlPath)) return null;

  const lines = fs.readFileSync(jsonlPath, "utf8").split("\n").filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i--) {
    let obj;
    try { obj = JSON.parse(lines[i]); } catch { continue; }
    if (obj.type !== "assistant") continue;

    const content = obj.message?.content;
    if (!Array.isArray(content)) continue;

    const textBlocks = content
      .filter((b) => b.type === "text" && typeof b.text === "string" && b.text.trim())
      .map((b) => b.text.trim());

    if (textBlocks.length > 0) {
      const joined = textBlocks.join("\n\n");
      return {
        text: joined.length > MAX_CONTENT_LEN
          ? joined.slice(0, MAX_CONTENT_LEN) + "\n…[truncated]"
          : joined,
        uuid: obj.uuid || null,
      };
    }
  }
  return null;
}

(async () => {
  const input = readStdin();
  if (!["Stop", "SessionEnd"].includes(input.hook_event_name)) return;

  const sessionId = input.session_id || "default";
  const current = loadCurrentSession();
  if (!current?.sessionId) return;

  const session = loadSession(current.sessionId);
  if (!session?.sessionNoteId) return;

  const result = getLastAssistantMessage(sessionId);
  const content = result?.text
    ?? "(no text response — model returned tool calls only or transcript unavailable)";

  // Per-turn idempotency: hash the content so retries are deduplicated,
  // but different turns with different content get their own record.
  const idempotencyKey = createHash("sha256")
    .update(`${session.sessionNoteId}:assistant:${result?.uuid ?? content.slice(0, 200)}`)
    .digest("hex")
    .slice(0, 64);

  try {
    await api("POST", `/agent/sessions/${session.sessionNoteId}/turns`, {
      role: "assistant",
      content,
      idempotencyKey,
    });
  } catch (err) {
    process.stderr.write(`[stop] ${err.message}\n`);
  }
})();
