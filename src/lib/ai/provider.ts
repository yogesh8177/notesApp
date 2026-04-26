import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { AiProvider } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { buildSummaryPrompt } from "./prompt";
import { summaryShape, type SummaryShape } from "./schema";

const REQUEST_TIMEOUT_MS = 30_000;

export interface SummaryResult {
  provider: AiProvider;
  model: string;
  structured: SummaryShape;
  raw: unknown;
}

export type SummaryFailureKind = "timeout" | "upstream" | "parse";

export interface SummaryAttemptFailure {
  provider: AiProvider;
  model: string;
  kind: SummaryFailureKind;
  message: string;
}

export class SummarizeProvidersError extends Error {
  readonly code = "UPSTREAM";

  constructor(
    message: string,
    public readonly attempts: SummaryAttemptFailure[],
  ) {
    super(message);
    this.name = "SummarizeProvidersError";
  }
}

class ProviderParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderParseError";
  }
}

const anthropicClient = env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  : null;

const openAiClient = env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: env.OPENAI_API_KEY })
  : null;

export async function summarize(input: {
  content: string;
  title: string;
}): Promise<SummaryResult> {
  const prompt = buildSummaryPrompt(input);
  const failures: SummaryAttemptFailure[] = [];

  const anthropicResult = await callProviderWithParseRetry({
    provider: "anthropic",
    model: env.ANTHROPIC_MODEL,
    call: () => callAnthropic(prompt),
  });

  if ("result" in anthropicResult) {
    return anthropicResult.result;
  }

  failures.push(anthropicResult.failure);

  const openAiResult = await callProviderWithParseRetry({
    provider: "openai",
    model: env.OPENAI_MODEL,
    call: () => callOpenAI(prompt),
  });

  if ("result" in openAiResult) {
    return openAiResult.result;
  }

  failures.push(openAiResult.failure);

  throw new SummarizeProvidersError("Both summary providers failed", failures);
}

async function callProviderWithParseRetry(args: {
  provider: AiProvider;
  model: string;
  call: () => Promise<{ raw: unknown; text: string }>;
}): Promise<{ result: SummaryResult } | { failure: SummaryAttemptFailure }> {
  let lastParseError: ProviderParseError | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await args.call();
      const structured = parseStructuredResponse(response.text);
      return {
        result: {
          provider: args.provider,
          model: args.model,
          structured,
          raw: response.raw,
        },
      };
    } catch (error) {
      if (error instanceof ProviderParseError) {
        lastParseError = error;
        continue;
      }

      return {
        failure: {
          provider: args.provider,
          model: args.model,
          kind: isTimeoutError(error) ? "timeout" : "upstream",
          message: toErrorMessage(error),
        },
      };
    }
  }

  return {
    failure: {
      provider: args.provider,
      model: args.model,
      kind: "parse",
      message: lastParseError?.message ?? "Provider returned invalid structured output",
    },
  };
}

async function callAnthropic(prompt: string): Promise<{ raw: unknown; text: string }> {
  if (!anthropicClient) {
    throw new Error("Anthropic API key is not configured");
  }

  const response = await withTimeout(
    anthropicClient.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 900,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    }),
    REQUEST_TIMEOUT_MS,
    "anthropic",
    env.ANTHROPIC_MODEL,
  );

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (!text) {
    throw new ProviderParseError("Anthropic returned an empty response");
  }

  return {
    raw: response,
    text,
  };
}

async function callOpenAI(prompt: string): Promise<{ raw: unknown; text: string }> {
  if (!openAiClient) {
    throw new Error("OpenAI API key is not configured");
  }

  const response = await withTimeout(
    openAiClient.chat.completions.create({
      model: env.OPENAI_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
    REQUEST_TIMEOUT_MS,
    "openai",
    env.OPENAI_MODEL,
  );

  const text = response.choices[0]?.message?.content?.trim();
  if (!text) {
    throw new ProviderParseError("OpenAI returned an empty response");
  }

  return {
    raw: response,
    text,
  };
}

function parseStructuredResponse(text: string): SummaryShape {
  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(stripJsonFences(text));
  } catch (error) {
    throw new ProviderParseError(`Provider returned invalid JSON: ${toErrorMessage(error)}`);
  }

  const parsedSummary = summaryShape.safeParse(parsedJson);
  if (!parsedSummary.success) {
    throw new ProviderParseError(parsedSummary.error.message);
  }

  return parsedSummary.data;
}

function stripJsonFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  provider: AiProvider,
  model: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Timed out after ${timeoutMs}ms (${provider}:${model})`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isTimeoutError(error: unknown): boolean {
  return toErrorMessage(error).toLowerCase().includes("timed out");
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
