#!/usr/bin/env node
"use strict";

const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const ROOT = path.resolve(__dirname, "..");
const ENV_FILE = path.join(ROOT, ".env");
const ENV_EXAMPLE = path.join(ROOT, ".env.example");

const [, , command, ...args] = process.argv;

const COMMANDS = {
  setup:         "Interactively configure .env from .env.example",
  "hooks-setup": "Wire Claude Code hooks + MCP into this project",
  migrate:       "Run database migrations (npm run db:migrate)",
  seed:          "Seed development data (npm run seed)",
  dev:           "Start the development server (npm run dev)",
  start:         "Start the production server (npm run start)",
  help:          "Show this help",
};

function help() {
  console.log("\nUsage: npx notes-app <command>\n");
  for (const [cmd, desc] of Object.entries(COMMANDS)) {
    console.log(`  ${cmd.padEnd(14)} ${desc}`);
  }
  console.log();
}

function run(script) {
  const child = spawn("npm", ["run", script], {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

async function setup() {
  if (!fs.existsSync(ENV_EXAMPLE)) {
    console.error("No .env.example found at", ENV_EXAMPLE);
    process.exit(1);
  }

  const example = fs.readFileSync(ENV_EXAMPLE, "utf8");
  const lines = example.split("\n");

  // Parse existing .env if present
  const existing = {};
  if (fs.existsSync(ENV_FILE)) {
    const current = fs.readFileSync(ENV_FILE, "utf8");
    for (const line of current.split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) existing[m[1]] = m[2];
    }
    console.log("\nFound existing .env — press Enter to keep current values.\n");
  } else {
    console.log("\nNo .env found — creating from .env.example.\n");
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  const out = [];
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) { out.push(line); continue; }
    const [, key, exampleVal] = m;
    const current = existing[key] ?? exampleVal;
    const display = current ? ` [${current}]` : "";
    const answer = await ask(`${key}${display}: `);
    out.push(`${key}=${answer.trim() || current}`);
  }

  rl.close();
  fs.writeFileSync(ENV_FILE, out.join("\n") + "\n");
  console.log("\n.env written. Run: npx notes-app migrate\n");
}

// ---------------------------------------------------------------------------
// hooks-setup
// ---------------------------------------------------------------------------

const CLAUDE_DIR    = path.join(ROOT, ".claude");
const HOOKS_SRC     = path.join(CLAUDE_DIR, "hooks");
const SETTINGS_PATH = path.join(CLAUDE_DIR, "settings.json");
const MCP_PATH      = path.join(ROOT, ".mcp.json");

const REQUIRED_HOOKS = [
  "_lib.js", "bootstrap.js", "recall.js", "checkpoint.js", "event.js", "log.js",
];

const SETTINGS_TEMPLATE = {
  hooks: {
    SessionStart: [
      { hooks: [{ type: "command", command: "node .claude/hooks/bootstrap.js" }] },
    ],
    UserPromptSubmit: [
      { hooks: [{ type: "command", command: "node .claude/hooks/recall.js" }] },
      { hooks: [{ type: "command", command: "node .claude/hooks/prompt.js" }] },
    ],
    PostToolUse: [
      {
        matcher: "Bash",
        if: "Bash(git commit *)",
        hooks: [{ type: "command", command: "node .claude/hooks/checkpoint.js" }],
      },
      {
        matcher: "mcp__notes-app__.*",
        hooks: [{ type: "command", command: "node .claude/hooks/event.js" }],
      },
    ],
    SubagentStart: [{ hooks: [{ type: "command", command: "node .claude/hooks/event.js" }] }],
    SubagentStop:  [{ hooks: [{ type: "command", command: "node .claude/hooks/event.js" }] }],
    PreCompact:    [{ hooks: [{ type: "command", command: "node .claude/hooks/checkpoint.js" }] }],
    SessionEnd:    [{ hooks: [{ type: "command", command: "node .claude/hooks/checkpoint.js" }] }],
  },
};

function mcpTemplate(appUrl) {
  return {
    mcpServers: {
      "notes-app": {
        type: "http",
        url: `${appUrl}/mcp`,
        headers: { Authorization: "Bearer ${MEMORY_AGENT_TOKEN}" },
      },
    },
  };
}

function readEnvVars() {
  const vals = {};
  if (!fs.existsSync(ENV_FILE)) return vals;
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) vals[m[1]] = m[2];
  }
  return vals;
}

function writeEnvKey(key, value) {
  let content = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : "";
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(content)) {
    content = content.replace(re, `${key}=${value}`);
  } else {
    content = content.trimEnd() + `\n${key}=${value}\n`;
  }
  fs.writeFileSync(ENV_FILE, content);
}

async function hooksSetup() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║        Claude Code hooks + MCP setup — notes-app            ║
╚══════════════════════════════════════════════════════════════╝

This wizard wires Claude Code lifecycle hooks into your project
so every agent session is automatically checkpointed and recalled.

Steps:
  1. Verify hook scripts exist in .claude/hooks/
  2. Write .claude/settings.json  (hook event registrations)
  3. Write .mcp.json              (notes-app MCP server entry)
  4. Configure agent token in .env
`);

  // ── Step 1: verify hooks ──────────────────────────────────────────────────
  console.log("── Step 1/4  Hook scripts ──────────────────────────────────────");
  const missing = REQUIRED_HOOKS.filter((f) => !fs.existsSync(path.join(HOOKS_SRC, f)));
  if (missing.length > 0) {
    console.error("\n  ERROR: The following hook files are missing from .claude/hooks/:\n");
    for (const f of missing) console.error(`    • ${f}`);
    console.error(`
  These scripts ship with the repo. If you cloned from GitHub they should
  already be present. Ensure your clone is complete and try again.\n`);
    rl.close();
    process.exit(1);
  }
  console.log("  ✓ All hook scripts present.\n");

  // ── Step 2: .claude/settings.json ────────────────────────────────────────
  console.log("── Step 2/4  .claude/settings.json ─────────────────────────────");
  if (fs.existsSync(SETTINGS_PATH)) {
    const ans = await ask("  settings.json already exists. Overwrite? [y/N] ");
    if (ans.trim().toLowerCase() !== "y") {
      console.log("  Skipped.\n");
    } else {
      fs.writeFileSync(SETTINGS_PATH, JSON.stringify(SETTINGS_TEMPLATE, null, 2) + "\n");
      console.log("  ✓ Written.\n");
    }
  } else {
    fs.mkdirSync(CLAUDE_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(SETTINGS_TEMPLATE, null, 2) + "\n");
    console.log("  ✓ Written.\n");
  }

  // ── Step 3: .mcp.json ────────────────────────────────────────────────────
  console.log("── Step 3/4  .mcp.json ─────────────────────────────────────────");
  const envVals = readEnvVars();
  const defaultUrl = envVals.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  let appUrl;
  if (fs.existsSync(MCP_PATH)) {
    const ans = await ask("  .mcp.json already exists. Overwrite? [y/N] ");
    if (ans.trim().toLowerCase() !== "y") {
      console.log("  Skipped.\n");
      appUrl = defaultUrl;
    } else {
      appUrl = (await ask(`  App base URL [${defaultUrl}]: `)).trim() || defaultUrl;
      fs.writeFileSync(MCP_PATH, JSON.stringify(mcpTemplate(appUrl), null, 4) + "\n");
      console.log("  ✓ Written.\n");
    }
  } else {
    appUrl = (await ask(`  App base URL [${defaultUrl}]: `)).trim() || defaultUrl;
    fs.writeFileSync(MCP_PATH, JSON.stringify(mcpTemplate(appUrl), null, 4) + "\n");
    console.log("  ✓ Written.\n");
  }

  // ── Step 4: agent token ───────────────────────────────────────────────────
  console.log("── Step 4/4  Agent token ───────────────────────────────────────");
  console.log(`
  The hooks authenticate to the notes-app API using a bearer token.
  There are two ways to obtain one:

  A) Via the app UI  (recommended for team use)
     ┌─────────────────────────────────────────────────────────┐
     │ 1. Start the app:                                       │
     │      npx notes-app dev                                  │
     │ 2. Sign in, open (or create) an org.                    │
     │ 3. Go to: Org Settings → Agent Tokens → "New token"     │
     │ 4. Copy the token — it starts with  nat_  and is        │
     │    shown only once.                                     │
     │ 5. Copy the Org ID and User ID shown on the same page.  │
     └─────────────────────────────────────────────────────────┘

  B) Env-var fallback  (single-user / no UI yet)
     Generate a random token and set it directly in .env:
       openssl rand -hex 32   ← paste output as MEMORY_AGENT_TOKEN
     Then also set MEMORY_AGENT_ORG_ID and MEMORY_AGENT_USER_ID
     to the org and user UUIDs you want the agent to act as.
     (The app falls back to this path when the token doesn't
      match the  nat_  token table.)

  Either way, all three variables must be set for the hooks to work.
`);

  const existingToken  = envVals.MEMORY_AGENT_TOKEN   || "";
  const existingOrgId  = envVals.MEMORY_AGENT_ORG_ID  || "";
  const existingUserId = envVals.MEMORY_AGENT_USER_ID  || "";

  const tokenHint  = existingToken  ? ` [${existingToken.slice(0, 8)}…]`  : "";
  const orgHint    = existingOrgId  ? ` [${existingOrgId}]`   : "";
  const userHint   = existingUserId ? ` [${existingUserId}]`  : "";

  const token  = (await ask(`  MEMORY_AGENT_TOKEN${tokenHint}: `)).trim()  || existingToken;
  const orgId  = (await ask(`  MEMORY_AGENT_ORG_ID${orgHint}: `)).trim()   || existingOrgId;
  const userId = (await ask(`  MEMORY_AGENT_USER_ID${userHint}: `)).trim() || existingUserId;

  rl.close();

  if (token)  writeEnvKey("MEMORY_AGENT_TOKEN",   token);
  if (orgId)  writeEnvKey("MEMORY_AGENT_ORG_ID",  orgId);
  if (userId) writeEnvKey("MEMORY_AGENT_USER_ID", userId);

  const allSet = token && orgId && userId;

  console.log(`
  ${allSet ? "✓" : "⚠"} Token env vars ${allSet ? "saved to .env." : "partially saved — fill in any blanks in .env before starting Claude Code."}

  IMPORTANT: .env is git-ignored. Never commit your token.
`);

  console.log(`── Done ────────────────────────────────────────────────────────

  Recommended next steps:
    npx notes-app migrate    Apply DB migrations
    npx notes-app dev        Start the dev server
    claude                   Open Claude Code — hooks fire automatically
`);
}

switch (command) {
  case "setup":        setup().catch((e) => { console.error(e); process.exit(1); }); break;
  case "hooks-setup":  hooksSetup().catch((e) => { console.error(e); process.exit(1); }); break;
  case "migrate":      run("db:migrate"); break;
  case "seed":         run("seed"); break;
  case "dev":          run("dev"); break;
  case "start":        run("start"); break;
  case "help":
  case undefined:      help(); break;
  default:
    console.error(`Unknown command: ${command}`);
    help();
    process.exit(1);
}
