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
  setup:   "Interactively configure .env from .env.example",
  migrate: "Run database migrations (npm run db:migrate)",
  seed:    "Seed development data (npm run seed)",
  dev:     "Start the development server (npm run dev)",
  start:   "Start the production server (npm run start)",
  help:    "Show this help",
};

function help() {
  console.log("\nUsage: npx notes-app <command>\n");
  for (const [cmd, desc] of Object.entries(COMMANDS)) {
    console.log(`  ${cmd.padEnd(10)} ${desc}`);
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

switch (command) {
  case "setup":   setup().catch((e) => { console.error(e); process.exit(1); }); break;
  case "migrate": run("db:migrate"); break;
  case "seed":    run("seed"); break;
  case "dev":     run("dev"); break;
  case "start":   run("start"); break;
  case "help":
  case undefined: help(); break;
  default:
    console.error(`Unknown command: ${command}`);
    help();
    process.exit(1);
}
