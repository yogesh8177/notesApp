import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";

const MODEL = "claude-haiku-4-5-20251001";
const REQUEST_TIMEOUT_MS = 30_000;

export interface CompactResult {
  content: string;
  model: string;
}

export async function compactCheckpoints(versions: { version: number; content: string }[]): Promise<CompactResult> {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const blocks = versions
    .map((v) => `### Version ${v.version}\n${v.content}`)
    .join("\n\n---\n\n");

  const prompt = [
    "You are compacting a sequence of agent session checkpoints into a single synthesized checkpoint.",
    "Rules:",
    "- Aggregate all unique Done items into a single ### Done list",
    "- Keep only Issues that were never resolved across the window; drop resolved ones",
    "- Use the latest Next list verbatim",
    "- Keep meaningful Decisions (drop trivial or superseded ones)",
    "- Write a concise ### Summary (3-5 sentences) describing what happened across this window",
    "- Preserve the Repo / branch / Agent / Last commit header lines from the LAST checkpoint verbatim",
    "- Output ONLY the synthesized checkpoint markdown — no preamble, no explanation",
    "",
    "Checkpoints to compact (oldest first):",
    "<checkpoints>",
    blocks,
    "</checkpoints>",
  ].join("\n");

  const response = await Promise.race([
    client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("compact timeout")), REQUEST_TIMEOUT_MS),
    ),
  ]);

  const text = (response as Awaited<ReturnType<typeof client.messages.create>>)
    .content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  return { content: text.trim(), model: MODEL };
}
