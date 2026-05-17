/**
 * Unit test for the parseProjectKey helper exposed by .claude/hooks/_lib.js.
 *
 * The recall hook injects projectKey into every prompt's relevant-memory
 * search, derived by parsing `git config --get remote.origin.url`. If this
 * parser silently returns null for a real remote, agents lose project-scoped
 * recall and fall back to org-wide noise. If it returns the wrong key,
 * results are filtered out entirely. Either failure is silent in production,
 * so we lock the parser down here.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";

// Use require so we pick up the CJS module without an extra build step.
const { parseProjectKey } = require(
  path.resolve(__dirname, "../../../.claude/hooks/_lib.js"),
);

describe("parseProjectKey", () => {
  it("parses HTTPS GitHub remote", () => {
    expect(parseProjectKey("https://github.com/yogesh8177/notesApp.git"))
      .toBe("yogesh8177/notesApp");
  });

  it("parses HTTPS GitHub remote without .git suffix", () => {
    expect(parseProjectKey("https://github.com/yogesh8177/notesApp"))
      .toBe("yogesh8177/notesApp");
  });

  it("parses SSH GitHub remote", () => {
    expect(parseProjectKey("git@github.com:yogesh8177/notesApp.git"))
      .toBe("yogesh8177/notesApp");
  });

  it("parses SSH GitLab remote with nested group", () => {
    // We take the LAST two path segments — sub-group + repo. The org-level
    // parent group is intentionally dropped to keep the key stable when
    // groups get renamed; downstream callers can pass a full key if they need
    // finer granularity.
    expect(parseProjectKey("git@gitlab.com:org/sub-group/repo.git"))
      .toBe("sub-group/repo");
  });

  it("parses SSH-style URL (ssh://)", () => {
    expect(parseProjectKey("ssh://git@host.example/owner/repo"))
      .toBe("owner/repo");
  });

  it("handles repos with dashes and dots in the name", () => {
    expect(parseProjectKey("https://github.com/yogesh8177/torquetrail-ios-app.git"))
      .toBe("yogesh8177/torquetrail-ios-app");
  });

  it("returns null for empty string", () => {
    expect(parseProjectKey("")).toBeNull();
  });

  it("returns null for null/undefined", () => {
    expect(parseProjectKey(null)).toBeNull();
    expect(parseProjectKey(undefined)).toBeNull();
  });

  it("returns null for non-string input", () => {
    expect(parseProjectKey(123 as unknown as string)).toBeNull();
    expect(parseProjectKey({} as unknown as string)).toBeNull();
  });

  it("returns null for a URL with no path", () => {
    expect(parseProjectKey("https://github.com")).toBeNull();
  });

  it("returns null for a single-segment path (no owner/repo shape)", () => {
    // Only "/repo" — no owner. We require both segments because the recall
    // server can't usefully filter by a key that collides across orgs.
    expect(parseProjectKey("https://example.com/repo")).toBeNull();
  });
});
