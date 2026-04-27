import type { OrgRole, NoteVisibility, SharePermission } from "@/lib/db/schema";

const ROLE_RANK: Record<OrgRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
};

interface AttachedNoteAccessInput {
  role: OrgRole | null;
  sharePermission: SharePermission | null;
  noteId: string | null;
  noteAuthorId: string | null;
  noteVisibility: NoteVisibility | null;
  noteDeletedAt: Date | null;
  userId: string;
}

export function hasOrgRole(role: OrgRole | null, minRole: OrgRole): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}

export function canReadAttachedNote(input: AttachedNoteAccessInput): boolean {
  if (!input.noteId) return true;
  if (!input.role || input.noteDeletedAt || !input.noteAuthorId || !input.noteVisibility) {
    return false;
  }

  const isAuthor = input.noteAuthorId === input.userId;
  if (hasOrgRole(input.role, "admin")) {
    return true;
  }

  switch (input.noteVisibility) {
    case "private":
      return isAuthor;
    case "org":
      return true;
    case "shared":
      return isAuthor || input.sharePermission !== null;
  }
}
