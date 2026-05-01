#!/usr/bin/env node
const { detectContext, readStdin, saveSession, saveCurrentSession, api } = require("./_lib");

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
      repoUrl: ctx.repoUrl,
      source,
    });

    const payload = res.data;
    saveSession(sessionId, { sessionNoteId: payload.sessionNoteId, ...ctx });
    saveCurrentSession(sessionId);

    const epochs = Array.isArray(payload.epochSummaries) ? payload.epochSummaries : [];
    const epochBlock = epochs.length > 0
      ? "PRIOR EPOCHS (compacted history, oldest first):\n" +
        epochs.map((e) => `## Epoch v${e.epochStart}–v${e.epochEnd}\n${e.content}`).join("\n\n---\n\n") +
        "\n"
      : null;

    const convSummaries = Array.isArray(payload.recentConversation) ? payload.recentConversation : [];
    const convBlock = convSummaries.length > 0
      ? "RECENT CONVERSATION SUMMARIES (oldest first):\n" +
        convSummaries.map((s) => `## Turns ${s.turnStart}–${s.turnEnd}\n${s.content}`).join("\n\n---\n\n") +
        "\n"
      : null;

    const tail = Array.isArray(payload.tailTurns) ? payload.tailTurns : [];
    const tailBlock = tail.length > 0
      ? "RECENT TURNS (unsummarized, oldest first):\n" +
        tail.map((t) => `[${t.role}] (turn ${t.turnIndex}) ${t.content}`).join("\n")
      : null;

    const text = [
      "ORG GUIDELINES:",
      payload.guidelines || "(none)",
      "",
      epochBlock,
      convBlock,
      tailBlock,
      "RESUME CHECKPOINT:",
      payload.latestCheckpoint || "(no prior checkpoint)",
    ].filter(Boolean).join("\n");

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
