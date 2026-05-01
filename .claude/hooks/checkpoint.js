#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const { execSync } = require("child_process");
const { withLock, detectContext, readStdin, loadSession, saveSession, api } = require("./_lib");

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

// Handle all tool_response shapes Claude Code may emit:
//   string | { stdout: string } | { output: string } | { content: [{type:"text", text:string}] }
function extractOutput(toolResponse) {
  if (typeof toolResponse === "string") return toolResponse;
  if (typeof toolResponse?.stdout === "string") return toolResponse.stdout;
  if (typeof toolResponse?.output === "string") return toolResponse.output;
  const first = toolResponse?.content?.[0];
  if (first?.type === "text" && typeof first.text === "string") return first.text;
  return "";
}

// Handles double-quoted, single-quoted, and bare paths.
function extractCwd(command) {
  if (!command) return null;
  const m = command.match(/^cd\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*(?:&&|;)/);
  if (!m) return null;
  return (m[1] ?? m[2] ?? m[3]).trim();
}

// Parse git commit stdout: "[branch sha] subject" → { sha, subject }
// \S+ covers any branch name (slashes, hyphens, dots, merge formats, etc.)
function parseCommitOutput(output) {
  if (typeof output !== "string") return null;
  const m = output.match(/^\[(\S+)\s+([0-9a-f]+)\]\s+(.+)/m);
  if (!m) return null;
  return { sha: m[2], subject: m[3].trim() };
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

  let done = [];
  let ctx;
  let body = "";

  if (event === "commit") {
    const output = extractOutput(input.tool_response);
    const parsed = parseCommitOutput(output);
    // If the Bash output doesn't contain a git commit line, this hook fired
    // for a non-commit Bash call — skip to avoid spurious checkpoint writes.
    if (!parsed) return;

    const command = input.tool_input?.command ?? "";
    const worktreeCwd = extractCwd(command) || undefined;
    ctx = detectContext(worktreeCwd);
    ctx = { ...ctx, lastCommit: parsed.sha };

    body = gitInDir("log -1 --pretty=%b", worktreeCwd);

    // Accumulate under lock — concurrent hook processes on the same session
    // would otherwise race on the JSON read-modify-write and drop items.
    done = withLock(sessionId, () => {
      const fresh = loadSession(sessionId) ?? session;
      const accumulated = [...new Set([...(fresh.accumulatedDone ?? []), parsed.subject])];
      saveSession(sessionId, { ...fresh, accumulatedDone: accumulated });
      return accumulated;
    });
  } else {
    ctx = detectContext();
    // Drain accumulated items from session state.
    done = session.accumulatedDone ?? [];
  }

  const decisions = [...new Set(session.accumulatedDecisions ?? [])];
  const issues = [...new Set(session.accumulatedIssues ?? [])];
  done = [...new Set(done)];

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
      issues,
      decisions,
    });
  } catch (err) {
    process.stderr.write(`[checkpoint] ${err.message}\n`);
  }
})();
