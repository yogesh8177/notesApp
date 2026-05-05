import { describe, it, expect } from "vitest";
import { buildVersionDiff } from "@/lib/notes/diff";

describe("buildVersionDiff", () => {
  it("reports no change when both title and content are identical", () => {
    const result = buildVersionDiff(
      { title: "Hello", content: "Body" },
      { title: "Hello", content: "Body" },
    );
    expect(result.titleChanged).toBe(false);
    expect(result.contentChanged).toBe(false);
    expect(result.title.every((l) => l.kind === "unchanged")).toBe(true);
    expect(result.content.every((l) => l.kind === "unchanged")).toBe(true);
  });

  it("marks titleChanged when only the title differs", () => {
    const result = buildVersionDiff(
      { title: "Old", content: "Same" },
      { title: "New", content: "Same" },
    );
    expect(result.titleChanged).toBe(true);
    expect(result.contentChanged).toBe(false);
  });

  it("marks contentChanged when only the content differs", () => {
    const result = buildVersionDiff(
      { title: "Same", content: "Old body" },
      { title: "Same", content: "New body" },
    );
    expect(result.titleChanged).toBe(false);
    expect(result.contentChanged).toBe(true);
  });

  it("includes added lines in content diff", () => {
    const result = buildVersionDiff(
      { title: "T", content: "line1" },
      { title: "T", content: "line1\nline2" },
    );
    const kinds = result.content.map((l) => l.kind);
    expect(kinds).toContain("added");
  });

  it("includes removed lines in content diff", () => {
    const result = buildVersionDiff(
      { title: "T", content: "line1\nline2" },
      { title: "T", content: "line1" },
    );
    const kinds = result.content.map((l) => l.kind);
    expect(kinds).toContain("removed");
  });

  it("handles empty strings without throwing", () => {
    const result = buildVersionDiff(
      { title: "", content: "" },
      { title: "", content: "" },
    );
    expect(result.titleChanged).toBe(false);
    expect(result.contentChanged).toBe(false);
  });

  it("handles content that was previously empty", () => {
    const result = buildVersionDiff(
      { title: "T", content: "" },
      { title: "T", content: "new content" },
    );
    expect(result.contentChanged).toBe(true);
    expect(result.content.some((l) => l.kind === "added")).toBe(true);
  });
});
