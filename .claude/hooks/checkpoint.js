#!/usr/bin/env node
const { execSync } = require("child_process");
const { detectContext, readStdin, loadSession, api } = require("./_lib");

function classify(input) {
  switch (input.hook_event_name) {
    case "PreCompact":
      return "compact";
    case "SessionEnd":
    case "Stop":
      return "stop";
    case "PostToolUse":
      return "commit";
    default:
      return null;
  }
}

(async () => {
  const input = readStdin();
  const event = classify(input);
  if (!event) return;

  const sessionId = input.session_id || "default";
  const session = loadSession(sessionId);
  if (!session?.sessionNoteId) {
    process.stderr.write(`[checkpoint] no session note for ${sessionId}\n`);
    return;
  }

  const ctx = detectContext();
  const done = [];
  if (event === "commit") {
    try {
      const subject = execSync("git log -1 --pretty=%s", {
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
      if (subject) done.push(subject);
    } catch {}
  }

  try {
    await api("POST", `/agent/sessions/${session.sessionNoteId}/checkpoint`, {
      event,
      repo: ctx.repo,
      branch: ctx.branch,
      agentId: ctx.agentId,
      lastCommit: ctx.lastCommit,
      done,
      next: [],
      issues: [],
      decisions: [],
    });
  } catch (err) {
    process.stderr.write(`[checkpoint] ${err.message}\n`);
  }
})();
