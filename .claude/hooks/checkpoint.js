#!/usr/bin/env node
const { execSync } = require("child_process");
const { detectContext, readStdin, loadSession, api } = require("./_lib");

function gitInDir(cmd, cwd) {
  try {
    return execSync(`git ${cmd}`, {
      stdio: ["ignore", "pipe", "ignore"],
      ...(cwd ? { cwd } : {}),
    }).toString().trim();
  } catch {
    return "";
  }
}

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

// Extract working directory from "cd /some/path && git commit ..."
function extractCwd(command) {
  const m = command?.match(/^cd\s+"?([^"&\n]+?)"?\s*&&/);
  return m ? m[1].trim() : null;
}

// Parse git commit stdout: "[branch sha] subject" → { sha, subject }
function parseCommitOutput(output) {
  if (typeof output !== "string") return null;
  const m = output.match(/^\[[\w/.\-]+\s+([0-9a-f]+)\]\s+(.+)/m);
  if (!m) return null;
  return { sha: m[1], subject: m[2].trim() };
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

  const done = [];
  let ctx;
  let body = "";

  if (event === "commit") {
    // Detect context from the worktree where the commit actually happened.
    const command = input.tool_input?.command ?? "";
    const worktreeCwd = extractCwd(command) || undefined;
    ctx = detectContext(worktreeCwd);

    // Pull subject + SHA from the Bash tool output — no extra git subprocess needed.
    const output = input.tool_response?.output ?? input.tool_response ?? "";
    const parsed = parseCommitOutput(typeof output === "string" ? output : "");
    if (parsed) {
      done.push(parsed.subject);
      ctx = { ...ctx, lastCommit: parsed.sha };
    }

    // Fetch the commit body (everything after the subject line).
    body = gitInDir("log -1 --pretty=%b", worktreeCwd);
  } else {
    ctx = detectContext();
  }

  try {
    await api("POST", `/agent/sessions/${session.sessionNoteId}/checkpoint`, {
      event,
      repo: ctx.repo,
      branch: ctx.branch,
      agentId: ctx.agentId,
      lastCommit: ctx.lastCommit,
      body,
      done,
      next: [],
      issues: [],
      decisions: [],
    });
  } catch (err) {
    process.stderr.write(`[checkpoint] ${err.message}\n`);
  }
})();
