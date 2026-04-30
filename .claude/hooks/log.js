#!/usr/bin/env node
/**
 * Append a done item, decision, or issue to the current session's accumulated state.
 *
 * Usage:
 *   node .claude/hooks/log.js done "feat(notes): note creation via subagent"
 *   node .claude/hooks/log.js decision "Chose X over Y because Z"
 *   node .claude/hooks/log.js issue "Race condition in file upload handler"
 *
 * Use `done` to manually credit subagent work into the parent's done list,
 * since subagent commits accumulate into the subagent's own session, not the parent's.
 *
 * The entry surfaces in the next checkpoint (commit, stop, or compact).
 */
const { loadCurrentSession, loadSession, saveSession } = require("./_lib");

const [, , type, ...rest] = process.argv;
const text = rest.join(" ").trim();

if (!["done", "decision", "issue"].includes(type) || !text) {
  process.stderr.write("Usage: log.js <done|decision|issue> <text>\n");
  process.exit(1);
}

const current = loadCurrentSession();
if (!current?.sessionId) {
  process.stderr.write("[log] no current session found\n");
  process.exit(1);
}

const session = loadSession(current.sessionId);
if (!session?.sessionNoteId) {
  process.stderr.write(`[log] no session note for ${current.sessionId}\n`);
  process.exit(1);
}

const key = type === "done" ? "accumulatedDone" : type === "decision" ? "accumulatedDecisions" : "accumulatedIssues";
const accumulated = [...new Set([...(session[key] ?? []), text])];
saveSession(current.sessionId, { ...session, [key]: accumulated });

process.stdout.write(`[log] ${type} logged: ${text}\n`);
