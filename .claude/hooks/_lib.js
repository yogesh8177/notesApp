const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const API_URL = process.env.MEMORY_API_URL || "http://localhost:3000";
const TOKEN = process.env.MEMORY_AGENT_TOKEN;

function git(cmd, cwd) {
  try {
    return execSync(`git ${cmd}`, {
      stdio: ["ignore", "pipe", "ignore"],
      ...(cwd ? { cwd } : {}),
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

function detectContext(cwd) {
  const remote = git("config --get remote.origin.url", cwd);
  const repo =
    (remote && remote.replace(/\.git$/, "").split(/[:/]/).slice(-2).join("/")) ||
    path.basename(cwd || process.cwd());
  const branch = git("rev-parse --abbrev-ref HEAD", cwd) || "detached";
  const lastCommit = git("rev-parse HEAD", cwd) || "";
  const agentId =
    process.env.AGENT_ID || `claude-code-${os.hostname()}-${os.userInfo().username}`;
  return { repo, branch, lastCommit, agentId };
}

function readStdin() {
  try {
    const buf = fs.readFileSync(0, "utf8");
    return buf ? JSON.parse(buf) : {};
  } catch {
    return {};
  }
}

/**
 * Extract subagent context from a hook input. Per the Claude Code hooks
 * reference, `agent_id` and `agent_type` are populated only when a hook
 * fires inside a sub-agent (Task / Explore / Plan / custom agent). For the
 * primary session both fields are absent — we report `null` so the server
 * can distinguish "main agent" from "subagent named X".
 */
function subagentContext(input) {
  return {
    agentId: input.agent_id || null,
    agentType: input.agent_type || null,
  };
}

function stateDir() {
  // Use __dirname (hooks dir) not process.cwd() — when the Bash command starts
  // with `cd <worktree>`, the hook inherits that CWD and would look for the
  // state file in the wrong place.
  const dir = path.join(__dirname, "..", "state");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function saveSession(sessionId, data) {
  fs.writeFileSync(
    path.join(stateDir(), `${sessionId}.json`),
    JSON.stringify(data),
  );
}

function loadSession(sessionId) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(stateDir(), `${sessionId}.json`), "utf8"),
    );
  } catch {
    return null;
  }
}

async function api(method, urlPath, body) {
  if (!TOKEN) throw new Error("MEMORY_AGENT_TOKEN not set");
  const res = await fetch(`${API_URL}${urlPath}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${method} ${urlPath} → ${res.status}`);
  }
  return res.json();
}

module.exports = {
  detectContext,
  readStdin,
  subagentContext,
  saveSession,
  loadSession,
  api,
};
