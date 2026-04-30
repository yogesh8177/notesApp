#!/usr/bin/env node
const { detectContext, readStdin, saveSession, api } = require("./_lib");

(async () => {
  const input = readStdin();
  const sessionId = input.session_id || "default";
  const source = input.source || "startup";
  const ctx = detectContext();

  try {
    const res = await api("POST", "/agent/bootstrap", {
      repo: ctx.repo,
      branch: ctx.branch,
      agentId: ctx.agentId,
      source,
    });

    const payload = res.data;
    saveSession(sessionId, { sessionNoteId: payload.sessionNoteId, ...ctx });

    const text = [
      "ORG GUIDELINES:",
      payload.guidelines || "(none)",
      "",
      "RESUME CHECKPOINT:",
      payload.latestCheckpoint || "(no prior checkpoint)",
    ].join("\n");

    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: text,
        },
      }),
    );
  } catch (err) {
    process.stderr.write(`[bootstrap] ${err.message}\n`);
  }
})();
