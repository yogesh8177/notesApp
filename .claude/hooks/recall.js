#!/usr/bin/env node
/**
 * UserPromptSubmit hook — semantic recall.
 *
 * Fires before Claude reads the user's prompt. Searches the notes app for
 * notes relevant to the prompt and injects the top hits as additionalContext
 * so the model has prior memory in scope when it formulates a response.
 *
 * Failure is silent (stderr only) — recall is an enhancement, not a
 * requirement. If the backend is down or the token is unset, the user's
 * prompt still reaches the model unmodified.
 */
const { readStdin, api } = require("./_lib");

const MAX_QUERY_LEN = 200;
const TOP_K = 5;
const MIN_PROMPT_LEN = 8;

function buildContext(results) {
  if (!results.length) return null;
  const lines = ["RELEVANT MEMORY (from your notes app):"];
  for (const r of results) {
    const date = (r.updatedAt || "").slice(0, 10);
    const snippet = (r.snippet || "").replace(/\s+/g, " ").trim().slice(0, 200);
    lines.push(`- [${date}] ${r.title}`);
    lines.push(`  id=${r.id}  snippet="${snippet}"`);
  }
  lines.push(
    "",
    "Use get_note via the notes-app MCP server to fetch full content for any of these.",
  );
  return lines.join("\n");
}

(async () => {
  const input = readStdin();
  const prompt = (input.prompt || "").trim();
  if (prompt.length < MIN_PROMPT_LEN) return;

  // Drop slash-command prompts — they're tool invocations, not queries.
  if (prompt.startsWith("/")) return;

  const q = prompt.slice(0, MAX_QUERY_LEN);

  try {
    const response = await api("POST", "/agent/search", { q, limit: TOP_K });
    const results = response?.data?.results ?? [];
    const additionalContext = buildContext(results);
    if (!additionalContext) return;

    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext,
        },
      }),
    );
  } catch (err) {
    process.stderr.write(`[recall] ${err.message}\n`);
  }
})();
