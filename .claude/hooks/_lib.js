const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const API_URL = process.env.MEMORY_API_URL || "http://localhost:3000";
const TOKEN = process.env.MEMORY_AGENT_TOKEN;

/**
 * Cross-process file lock. Uses O_EXCL (wx flag) for atomic acquisition.
 * Writes pid + timestamp so stale locks from crashed processes are cleaned up.
 * Safe for concurrent Node processes (one hook invocation = one process).
 */
function withLock(name, fn, { timeout = 5000, retryMs = 20 } = {}) {
  // stateDir() cannot be called here directly without triggering a recursive
  // dependency, so we resolve it inline using the same logic.
  let base;
  try {
    const commonGit = execSync("git rev-parse --git-common-dir", {
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
    base = path.join(commonGit, "..", ".claude");
  } catch {
    base = path.join(__dirname, "..");
  }
  const dir = path.join(base, "state");
  fs.mkdirSync(dir, { recursive: true });

  const lockPath = path.join(dir, `${name}.lock`);
  const deadline = Date.now() + timeout;

  while (true) {
    try {
      fs.writeFileSync(lockPath, `${process.pid}\n${Date.now()}`, { flag: "wx" });
      break; // acquired
    } catch (e) {
      if (e.code !== "EEXIST") throw e;

      // Remove stale lock left by a crashed process (held longer than timeout).
      try {
        const [, ts] = fs.readFileSync(lockPath, "utf8").split("\n");
        if (Date.now() - Number(ts) > timeout) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch { /* lock removed between our stat and read — retry */ }

      if (Date.now() > deadline) throw new Error(`Lock timeout: ${name}`);
      // Tight spin — lock is held for <1 ms (a JSON read + write).
      const until = Date.now() + Math.min(retryMs, deadline - Date.now());
      while (Date.now() < until) { /* spin */ }
    }
  }

  try {
    return fn();
  } finally {
    try { fs.unlinkSync(lockPath); } catch { /* already gone */ }
  }
}

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
  // Always resolve state from the MAIN repo, not a worktree.
  // git rev-parse --git-common-dir returns the shared .git dir; one level up
  // is the main repo root regardless of which worktree we're in.
  let base;
  try {
    const commonGit = execSync("git rev-parse --git-common-dir", {
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
    base = path.join(commonGit, "..", ".claude");
  } catch {
    base = path.join(__dirname, "..");
  }
  const dir = path.join(base, "state");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function saveSession(sessionId, data) {
  fs.writeFileSync(
    path.join(stateDir(), `${sessionId}.json`),
    JSON.stringify(data),
  );
}

/**
 * Return a per-branch key so each worktree agent has its own session pointer.
 * Falls back to "current" (the global file) when branch can't be determined.
 */
function branchSessionKey() {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
    if (!branch || branch === "HEAD") return "current";
    return `current_${branch.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  } catch {
    return "current";
  }
}

function saveCurrentSession(sessionId) {
  const key = branchSessionKey();
  withLock("current_meta", () => {
    // Branch-scoped pointer — correct session for this worktree agent.
    fs.writeFileSync(
      path.join(stateDir(), `${key}.json`),
      JSON.stringify({ sessionId }),
    );
    // Global fallback for the main-branch session and backwards compat.
    fs.writeFileSync(
      path.join(stateDir(), "current.json"),
      JSON.stringify({ sessionId }),
    );
  });
}

function loadCurrentSession() {
  const key = branchSessionKey();
  const dir = stateDir();
  // Prefer branch-scoped pointer so worktree agents find their own session.
  for (const name of [key, "current"]) {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8"));
    } catch { /* try next */ }
  }
  return null;
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
  withLock,
  detectContext,
  readStdin,
  subagentContext,
  saveSession,
  saveCurrentSession,
  loadCurrentSession,
  loadSession,
  api,
};
