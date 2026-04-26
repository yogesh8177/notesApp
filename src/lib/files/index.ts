import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { assertCanWriteNote } from "@/lib/auth/permissions";
import { getMembership } from "@/lib/auth/org";
import { db } from "@/lib/db/client";
import {
  files,
  memberships,
  notes,
  noteShares,
  users,
  type NoteVisibility,
  type OrgRole,
  type SharePermission,
} from "@/lib/db/schema";
import { audit } from "@/lib/log/audit";
import { createServiceClient } from "@/lib/supabase/service";
import { FILE_DOWNLOAD_URL_TTL_SECONDS, FILES_BUCKET } from "./constants";
import { FilesError } from "./errors";
import { canReadAttachedNote, hasOrgRole } from "./permissions";
import type { FileListItem } from "./types";

interface OrgFilesAccess {
  orgId: string;
  userId: string;
  role: OrgRole;
}

interface CreateUploadInput extends OrgFilesAccess {
  noteId?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

interface FileAccessRecord {
  id: string;
  orgId: string;
  noteId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  uploadedBy: string;
  createdAt: Date;
  role: OrgRole | null;
  noteAuthorId: string | null;
  noteVisibility: NoteVisibility | null;
  noteDeletedAt: Date | null;
  sharePermission: SharePermission | null;
}

export async function listFilesForOrg(access: OrgFilesAccess): Promise<FileListItem[]> {
  const rows = await db
    .select({
      file: {
        id: files.id,
        orgId: files.orgId,
        noteId: files.noteId,
        fileName: files.fileName,
        mimeType: files.mimeType,
        sizeBytes: files.sizeBytes,
        storagePath: files.storagePath,
        uploadedBy: files.uploadedBy,
        createdAt: files.createdAt,
      },
      uploader: {
        email: users.email,
        displayName: users.displayName,
      },
      note: {
        id: notes.id,
        title: notes.title,
        authorId: notes.authorId,
        visibility: notes.visibility,
        deletedAt: notes.deletedAt,
      },
      sharePermission: noteShares.permission,
    })
    .from(files)
    .leftJoin(users, eq(users.id, files.uploadedBy))
    .leftJoin(notes, eq(notes.id, files.noteId))
    .leftJoin(
      noteShares,
      and(eq(noteShares.noteId, files.noteId), eq(noteShares.sharedWithUserId, access.userId)),
    )
    .where(and(eq(files.orgId, access.orgId), isNull(files.deletedAt)))
    .orderBy(desc(files.createdAt));

  return rows.flatMap((row) => {
    const canRead = canReadAttachedNote({
      role: access.role,
      sharePermission: row.sharePermission,
      noteId: row.file.noteId,
      noteAuthorId: row.note?.authorId ?? null,
      noteVisibility: row.note?.visibility ?? null,
      noteDeletedAt: row.note?.deletedAt ?? null,
      userId: access.userId,
    });
    if (!canRead) {
      return [];
    }

    return [
      {
        id: row.file.id,
        orgId: row.file.orgId,
        noteId: row.file.noteId,
        noteTitle: row.note?.title ?? null,
        fileName: row.file.fileName,
        mimeType: row.file.mimeType,
        sizeBytes: row.file.sizeBytes,
        uploadedByLabel: row.uploader.displayName ?? row.uploader.email ?? "Unknown user",
        createdAt: row.file.createdAt.toISOString(),
        canDelete: row.file.uploadedBy === access.userId || hasOrgRole(access.role, "admin"),
      },
    ];
  });
}

export async function createUpload(access: CreateUploadInput) {
  if (!hasOrgRole(access.role, "member")) {
    throw new FilesError("FORBIDDEN", "You need member access to upload files");
  }

  if (access.noteId) {
    const [note] = await db
      .select({
        id: notes.id,
        orgId: notes.orgId,
        deletedAt: notes.deletedAt,
      })
      .from(notes)
      .where(eq(notes.id, access.noteId))
      .limit(1);

    if (!note || note.deletedAt) {
      throw new FilesError("NOT_FOUND", "Note not found");
    }
    if (note.orgId !== access.orgId) {
      throw new FilesError("FORBIDDEN", "That note does not belong to this organisation");
    }

    await assertCanWriteNote(access.noteId, access.userId);
  }

  const fileId = randomUUID();
  const safeFileName = sanitizeFileName(access.fileName);
  const storagePath = buildStoragePath(access.orgId, fileId, safeFileName);
  const storage = createServiceClient().storage.from(FILES_BUCKET);

  const { data, error } = await storage.createSignedUploadUrl(storagePath);
  if (error) {
    throw new FilesError("UPSTREAM", "Could not create a signed upload URL");
  }

  const token = data?.token;
  if (!token) {
    throw new FilesError("UPSTREAM", "Signed upload token was missing");
  }

  await db.insert(files).values({
    id: fileId,
    orgId: access.orgId,
    noteId: access.noteId ?? null,
    uploadedBy: access.userId,
    storagePath,
    fileName: safeFileName,
    mimeType: access.mimeType,
    sizeBytes: access.sizeBytes,
  });

  await audit({
    action: "file.upload",
    orgId: access.orgId,
    userId: access.userId,
    resourceType: "file",
    resourceId: fileId,
    metadata: {
      noteId: access.noteId ?? null,
      fileName: safeFileName,
      mimeType: access.mimeType,
      sizeBytes: access.sizeBytes,
      flow: "signed-upload",
    },
  });

  return {
    fileId,
    storagePath,
    fileName: safeFileName,
    uploadToken: token,
  };
}

export async function createDownloadUrl(fileId: string, userId: string) {
  const file = await getFileAccess(fileId, userId);
  if (!file) {
    throw new FilesError("NOT_FOUND", "File not found");
  }
  if (!file.role) {
    throw new FilesError("FORBIDDEN", "You do not have access to this file");
  }

  const canRead = canReadAttachedNote({
    role: file.role,
    sharePermission: file.sharePermission,
    noteId: file.noteId,
    noteAuthorId: file.noteAuthorId,
    noteVisibility: file.noteVisibility,
    noteDeletedAt: file.noteDeletedAt,
    userId,
  });
  if (!canRead) {
    throw new FilesError("FORBIDDEN", "You do not have access to this file");
  }

  const { data, error } = await createServiceClient()
    .storage.from(FILES_BUCKET)
    .createSignedUrl(file.storagePath, FILE_DOWNLOAD_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    throw new FilesError("UPSTREAM", "Could not create a signed download URL");
  }

  await audit({
    action: "file.download",
    orgId: file.orgId,
    userId,
    resourceType: "file",
    resourceId: file.id,
    metadata: { storagePath: file.storagePath },
  });

  return data.signedUrl;
}

export async function deleteFile(fileId: string, userId: string) {
  const file = await getFileAccess(fileId, userId);
  if (!file) {
    throw new FilesError("NOT_FOUND", "File not found");
  }
  if (!file.role) {
    throw new FilesError("FORBIDDEN", "You do not have access to this file");
  }

  const canDelete = file.uploadedBy === userId || hasOrgRole(file.role, "admin");
  if (!canDelete) {
    throw new FilesError("FORBIDDEN", "Only the uploader or an admin can delete files");
  }

  const { error } = await createServiceClient().storage.from(FILES_BUCKET).remove([file.storagePath]);
  if (error) {
    throw new FilesError("UPSTREAM", "Could not remove the file from storage");
  }

  await db
    .update(files)
    .set({ deletedAt: new Date() })
    .where(and(eq(files.id, file.id), isNull(files.deletedAt)));

  await audit({
    action: "file.delete",
    orgId: file.orgId,
    userId,
    resourceType: "file",
    resourceId: file.id,
    metadata: { storagePath: file.storagePath },
  });
}

export async function requireOrgFilesAccess(
  orgId: string,
  userId: string,
  minRole: OrgRole = "viewer",
) {
  const membership = await getMembership(orgId, userId);
  if (!membership) {
    throw new FilesError("FORBIDDEN", "You do not belong to this organisation");
  }
  if (!hasOrgRole(membership.role, minRole)) {
    throw new FilesError("FORBIDDEN", `Requires ${minRole} access in this organisation`);
  }
  return membership.role;
}

function sanitizeFileName(fileName: string): string {
  const leaf = fileName.split(/[\\/]/).pop()?.trim() ?? "file";
  const cleaned = leaf.replace(/\s+/g, " ").replace(/[^A-Za-z0-9._ -]/g, "-");
  const collapsed = cleaned.replace(/-+/g, "-").slice(0, 120).trim();
  return collapsed.length > 0 ? collapsed : "file";
}

function buildStoragePath(orgId: string, fileId: string, fileName: string): string {
  return `${orgId}/${fileId}/${fileName}`;
}

async function getFileAccess(fileId: string, userId: string): Promise<FileAccessRecord | null> {
  const [row] = await db
    .select({
      file: {
        id: files.id,
        orgId: files.orgId,
        noteId: files.noteId,
        fileName: files.fileName,
        mimeType: files.mimeType,
        sizeBytes: files.sizeBytes,
        storagePath: files.storagePath,
        uploadedBy: files.uploadedBy,
        createdAt: files.createdAt,
      },
      membershipRole: memberships.role,
      note: {
        authorId: notes.authorId,
        visibility: notes.visibility,
        deletedAt: notes.deletedAt,
      },
      sharePermission: noteShares.permission,
    })
    .from(files)
    .leftJoin(
      memberships,
      and(eq(memberships.orgId, files.orgId), eq(memberships.userId, userId)),
    )
    .leftJoin(notes, eq(notes.id, files.noteId))
    .leftJoin(
      noteShares,
      and(eq(noteShares.noteId, files.noteId), eq(noteShares.sharedWithUserId, userId)),
    )
    .where(and(eq(files.id, fileId), isNull(files.deletedAt)))
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    id: row.file.id,
    orgId: row.file.orgId,
    noteId: row.file.noteId,
    fileName: row.file.fileName,
    mimeType: row.file.mimeType,
    sizeBytes: row.file.sizeBytes,
    storagePath: row.file.storagePath,
    uploadedBy: row.file.uploadedBy,
    createdAt: row.file.createdAt,
    role: row.membershipRole,
    noteAuthorId: row.note?.authorId ?? null,
    noteVisibility: row.note?.visibility ?? null,
    noteDeletedAt: row.note?.deletedAt ?? null,
    sharePermission: row.sharePermission,
  };
}
