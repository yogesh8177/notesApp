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

    const tail = Array.isArray(payload.tailTurns) ? payload.tailTurns : [];
    const tailBlock = tail.length > 0
      ? "RECENT TURNS (oldest first):\n" +
        tail.map((t) => `[${t.role}] (turn ${t.turnIndex}) ${t.content}`).join("\n")
      : null;

    const projectNotes = Array.isArray(payload.projectNotes) ? payload.projectNotes : [];
    const projectNotesBlock = projectNotes.length > 0
      ? "PROJECT CONTEXT (tagged notes — call get_note for full content if relevant):\n" +
        projectNotes.map((n) => `- ${n.title} (id:${n.id})\n  ${n.excerpt.replace(/\n/g, " ").slice(0, 200)}…`).join("\n")
      : null;

    // Hotspots: title + id only — low token cost, agent fetches if needed
    const hotspots = Array.isArray(payload.graphHotspots) ? payload.graphHotspots : [];
    const hotspotsBlock = hotspots.length > 0
      ? "KNOWLEDGE HOTSPOTS (most-referenced notes across agent sessions — fetch if relevant):\n" +
        hotspots.map((h) => `- ${h.title} (id:${h.id}, refs:${h.refCount})`).join("\n")
      : null;

    const text = [
      "ORG GUIDELINES:",
      payload.guidelines || "(none)",
      "",
      projectNotesBlock,
      hotspotsBlock,
      epochBlock,
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
