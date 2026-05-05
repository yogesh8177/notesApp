import { describe, it, expect } from "vitest";
import {
  noteCreateSchema,
  noteUpdateSchema,
  noteShareSchema,
  notesListQuerySchema,
  historyQuerySchema,
} from "@/lib/notes/schemas";

const VALID_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("noteCreateSchema", () => {
  const base = {
    orgId: VALID_UUID,
    title: "Hello",
    content: "body",
    visibility: "org" as const,
    tags: [],
  };

  it("accepts a valid note", () => {
    expect(noteCreateSchema.safeParse(base).success).toBe(true);
  });

  it("rejects empty title", () => {
    const r = noteCreateSchema.safeParse({ ...base, title: "" });
    expect(r.success).toBe(false);
  });

  it("rejects title over 200 chars", () => {
    const r = noteCreateSchema.safeParse({ ...base, title: "a".repeat(201) });
    expect(r.success).toBe(false);
  });

  it("rejects content over 100 000 chars", () => {
    const r = noteCreateSchema.safeParse({ ...base, content: "x".repeat(100_001) });
    expect(r.success).toBe(false);
  });

  it("rejects invalid visibility", () => {
    const r = noteCreateSchema.safeParse({ ...base, visibility: "public" });
    expect(r.success).toBe(false);
  });

  it("rejects more than 20 tags", () => {
    const r = noteCreateSchema.safeParse({ ...base, tags: Array(21).fill("tag") });
    expect(r.success).toBe(false);
  });

  it("rejects a tag over 64 chars", () => {
    const r = noteCreateSchema.safeParse({ ...base, tags: ["a".repeat(65)] });
    expect(r.success).toBe(false);
  });

  it("defaults content to empty string when omitted", () => {
    const { content: _, ...withoutContent } = base;
    const r = noteCreateSchema.safeParse(withoutContent);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.content).toBe("");
  });
});

describe("noteUpdateSchema", () => {
  it("accepts a partial update (title only)", () => {
    const r = noteUpdateSchema.safeParse({ title: "New title" });
    expect(r.success).toBe(true);
  });

  it("accepts an empty object (no fields)", () => {
    const r = noteUpdateSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it("rejects an empty title when supplied", () => {
    const r = noteUpdateSchema.safeParse({ title: "" });
    expect(r.success).toBe(false);
  });
});

describe("noteShareSchema", () => {
  it("accepts view permission", () => {
    const r = noteShareSchema.safeParse({ sharedWithUserId: VALID_UUID, permission: "view" });
    expect(r.success).toBe(true);
  });

  it("accepts edit permission", () => {
    const r = noteShareSchema.safeParse({ sharedWithUserId: VALID_UUID, permission: "edit" });
    expect(r.success).toBe(true);
  });

  it("rejects invalid permission", () => {
    const r = noteShareSchema.safeParse({ sharedWithUserId: VALID_UUID, permission: "admin" });
    expect(r.success).toBe(false);
  });

  it("rejects non-uuid sharedWithUserId", () => {
    const r = noteShareSchema.safeParse({ sharedWithUserId: "not-a-uuid", permission: "view" });
    expect(r.success).toBe(false);
  });
});

describe("notesListQuerySchema", () => {
  it("defaults limit to 25", () => {
    const r = notesListQuerySchema.safeParse({ orgId: VALID_UUID });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(25);
  });

  it("rejects limit > 100", () => {
    const r = notesListQuerySchema.safeParse({ orgId: VALID_UUID, limit: "101" });
    expect(r.success).toBe(false);
  });

  it("rejects missing orgId", () => {
    expect(notesListQuerySchema.safeParse({}).success).toBe(false);
  });
});

describe("historyQuerySchema", () => {
  it("accepts no fields", () => {
    expect(historyQuerySchema.safeParse({}).success).toBe(true);
  });

  it("coerces string version to number", () => {
    const r = historyQuerySchema.safeParse({ version: "3" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.version).toBe(3);
  });

  it("rejects version 0 (must be positive)", () => {
    expect(historyQuerySchema.safeParse({ version: "0" }).success).toBe(false);
  });
});
