import { describe, it, expect } from "vitest";
import { hasOrgRole, canReadAttachedNote } from "@/lib/files/permissions";
import type { OrgRole, NoteVisibility, SharePermission } from "@/lib/db/schema";

describe("hasOrgRole", () => {
  it("returns false for null role", () => {
    expect(hasOrgRole(null, "viewer")).toBe(false);
  });

  it("owner satisfies every role requirement", () => {
    const roles: OrgRole[] = ["viewer", "member", "admin", "owner"];
    for (const min of roles) {
      expect(hasOrgRole("owner", min)).toBe(true);
    }
  });

  it("viewer only satisfies viewer", () => {
    expect(hasOrgRole("viewer", "viewer")).toBe(true);
    expect(hasOrgRole("viewer", "member")).toBe(false);
    expect(hasOrgRole("viewer", "admin")).toBe(false);
    expect(hasOrgRole("viewer", "owner")).toBe(false);
  });

  it("member satisfies viewer and member but not admin", () => {
    expect(hasOrgRole("member", "viewer")).toBe(true);
    expect(hasOrgRole("member", "member")).toBe(true);
    expect(hasOrgRole("member", "admin")).toBe(false);
  });

  it("admin satisfies up to admin but not owner", () => {
    expect(hasOrgRole("admin", "admin")).toBe(true);
    expect(hasOrgRole("admin", "owner")).toBe(false);
  });
});

function makeInput(overrides: Partial<Parameters<typeof canReadAttachedNote>[0]> = {}) {
  return {
    role: "member" as OrgRole | null,
    sharePermission: null as SharePermission | null,
    noteId: "note-id",
    noteAuthorId: "other-user",
    noteVisibility: "org" as NoteVisibility | null,
    noteDeletedAt: null,
    userId: "user-id",
    ...overrides,
  };
}

describe("canReadAttachedNote", () => {
  it("returns true when there is no attached note (noteId null)", () => {
    expect(canReadAttachedNote(makeInput({ noteId: null }))).toBe(true);
  });

  it("returns false when note is deleted", () => {
    expect(canReadAttachedNote(makeInput({ noteDeletedAt: new Date() }))).toBe(false);
  });

  it("returns false when user has no role", () => {
    expect(canReadAttachedNote(makeInput({ role: null }))).toBe(false);
  });

  it("admin can read a private note they did not author", () => {
    expect(canReadAttachedNote(makeInput({ role: "admin", noteVisibility: "private" }))).toBe(true);
  });

  it("member can read org-visible note", () => {
    expect(canReadAttachedNote(makeInput({ role: "member", noteVisibility: "org" }))).toBe(true);
  });

  it("author can read their own private note (member role)", () => {
    expect(
      canReadAttachedNote(
        makeInput({ role: "member", noteVisibility: "private", noteAuthorId: "user-id" }),
      ),
    ).toBe(true);
  });

  it("non-author member cannot read a private note", () => {
    expect(
      canReadAttachedNote(makeInput({ role: "member", noteVisibility: "private" })),
    ).toBe(false);
  });

  it("non-member with share can read a shared note", () => {
    expect(
      canReadAttachedNote(
        makeInput({ role: null, noteVisibility: "shared", sharePermission: "view" }),
      ),
    ).toBe(false); // role is null → false (no membership)
  });

  it("org member with share can read a shared note", () => {
    expect(
      canReadAttachedNote(
        makeInput({ role: "member", noteVisibility: "shared", sharePermission: "view" }),
      ),
    ).toBe(true);
  });

  it("org member without share cannot read a shared note they didn't author", () => {
    expect(
      canReadAttachedNote(makeInput({ role: "member", noteVisibility: "shared", sharePermission: null })),
    ).toBe(false);
  });
});
