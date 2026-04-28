const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const API_URL = process.env.MEMORY_API_URL || "http://localhost:3000";
const TOKEN = process.env.MEMORY_AGENT_TOKEN;

function git(cmd) {
  try {
    return execSync(`git ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

function detectContext() {
  const remote = git("config --get remote.origin.url");
  const repo =
    (remote && remote.replace(/\.git$/, "").split(/[:/]/).slice(-2).join("/")) ||
    path.basename(process.cwd());
  const branch = git("rev-parse --abbrev-ref HEAD") || "detached";
  const lastCommit = git("rev-parse HEAD") || "";
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

function stateDir() {
  const dir = path.join(process.cwd(), ".claude", "state");
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
  saveSession,
  loadSession,
  api,
};
