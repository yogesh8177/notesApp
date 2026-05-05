/**
 * Unit tests for the AI summary provider — Anthropic primary, OpenAI fallback.
 *
 * Both SDK clients are mocked; no real API calls are made.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock factories are hoisted above variable declarations; use vi.hoisted so
// the mock functions exist when the factory runs.
const { mockAnthropicCreate, mockOpenAICreate } = vi.hoisted(() => ({
  mockAnthropicCreate: vi.fn(),
  mockOpenAICreate:    vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(function(this: unknown) {
    return { messages: { create: mockAnthropicCreate } };
  }),
}));

vi.mock("openai", () => ({
  default: vi.fn(function(this: unknown) {
    return { chat: { completions: { create: mockOpenAICreate } } };
  }),
}));

vi.mock("@/lib/env", () => ({
  env: {
    ANTHROPIC_API_KEY: "test-anthropic-key",
    OPENAI_API_KEY:    "test-openai-key",
    ANTHROPIC_MODEL:   "claude-haiku-4-5-20251001",
    OPENAI_MODEL:      "gpt-4o-mini",
  },
}));

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { summarize, SummarizeProvidersError } from "@/lib/ai/provider";

const VALID_SUMMARY = {
  tldr: "A short summary.",
  keyPoints: ["point one"],
  actionItems: [],
  entities: [],
};

function anthropicResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

function openAIResponse(text: string) {
  return { choices: [{ message: { content: text } }] };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("summarize", () => {
  it("returns an anthropic result when Anthropic succeeds", async () => {
    mockAnthropicCreate.mockResolvedValue(anthropicResponse(JSON.stringify(VALID_SUMMARY)));

    const result = await summarize({ title: "Test", content: "body" });
    expect(result.provider).toBe("anthropic");
    expect(result.structured.tldr).toBe("A short summary.");
    expect(mockOpenAICreate).not.toHaveBeenCalled();
  });

  it("falls back to OpenAI when Anthropic throws a network error", async () => {
    mockAnthropicCreate.mockRejectedValue(new Error("network failure"));
    mockOpenAICreate.mockResolvedValue(openAIResponse(JSON.stringify(VALID_SUMMARY)));

    const result = await summarize({ title: "Test", content: "body" });
    expect(result.provider).toBe("openai");
    expect(mockOpenAICreate).toHaveBeenCalledOnce();
  });

  it("falls back to OpenAI when Anthropic returns invalid JSON (both retries)", async () => {
    mockAnthropicCreate.mockResolvedValue(anthropicResponse("not valid json {{"));
    mockOpenAICreate.mockResolvedValue(openAIResponse(JSON.stringify(VALID_SUMMARY)));

    const result = await summarize({ title: "Test", content: "body" });
    expect(result.provider).toBe("openai");
  });

  it("succeeds on Anthropic retry when first response is bad JSON", async () => {
    mockAnthropicCreate
      .mockResolvedValueOnce(anthropicResponse("bad json"))
      .mockResolvedValueOnce(anthropicResponse(JSON.stringify(VALID_SUMMARY)));

    const result = await summarize({ title: "Test", content: "body" });
    expect(result.provider).toBe("anthropic");
    expect(mockAnthropicCreate).toHaveBeenCalledTimes(2);
  });

  it("throws SummarizeProvidersError when both providers fail", async () => {
    mockAnthropicCreate.mockRejectedValue(new Error("anthropic down"));
    mockOpenAICreate.mockRejectedValue(new Error("openai down"));

    await expect(summarize({ title: "T", content: "b" })).rejects.toBeInstanceOf(
      SummarizeProvidersError,
    );
  });

  it("SummarizeProvidersError carries failure records for both providers", async () => {
    mockAnthropicCreate.mockRejectedValue(new Error("anthropic down"));
    mockOpenAICreate.mockRejectedValue(new Error("openai down"));

    const err = await summarize({ title: "T", content: "b" }).catch((e) => e);
    expect(err).toBeInstanceOf(SummarizeProvidersError);
    expect(err.attempts).toHaveLength(2);
    expect(err.attempts[0].provider).toBe("anthropic");
    expect(err.attempts[1].provider).toBe("openai");
  });

  it("strips JSON fences from the response before parsing", async () => {
    const fenced = "```json\n" + JSON.stringify(VALID_SUMMARY) + "\n```";
    mockAnthropicCreate.mockResolvedValue(anthropicResponse(fenced));

    const result = await summarize({ title: "Test", content: "body" });
    expect(result.structured.tldr).toBe("A short summary.");
  });

  it("rejects when Anthropic returns an empty text block", async () => {
    mockAnthropicCreate.mockResolvedValue({ content: [{ type: "text", text: "" }] });
    mockOpenAICreate.mockResolvedValue(openAIResponse(JSON.stringify(VALID_SUMMARY)));

    // Should fall back to OpenAI and succeed
    const result = await summarize({ title: "T", content: "b" });
    expect(result.provider).toBe("openai");
  });

  it("classifies timed-out errors as kind=timeout in the failure record", async () => {
    mockAnthropicCreate.mockRejectedValue(new Error("Timed out after 30000ms (anthropic:claude-haiku)"));
    mockOpenAICreate.mockRejectedValue(new Error("network down"));

    const err = await summarize({ title: "T", content: "b" }).catch((e) => e);
    expect(err.attempts[0].kind).toBe("timeout");
    expect(err.attempts[1].kind).toBe("upstream");
  });
});
