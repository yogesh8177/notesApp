# Module: files

> Worktree branch: `agent/files`
> Read root `CLAUDE.md` first.

## Scope

File upload + download + delete. Files attach to an org (always) and
optionally to a note. Permissions: org member can list; uploader/admin can
delete; download requires read on the org (and the note, if attached).

## Files you own

- `src/lib/files/**` — server actions, signed-URL helpers, MIME validation.
- `src/app/orgs/[orgId]/files/**` — org file list page, upload widget.
- `src/app/api/files/**` — upload route handler (multipart), download
  redirector that issues signed URLs.

## Frozen — DO NOT MODIFY

- Bucket `notes-files` is private (`public = false`). Don't make it public.
- Storage path layout: `${orgId}/${fileId}/${fileName}`. The first segment
  is the org ID — storage RLS uses it. Don't change the layout.
- Storage RLS policies are in `drizzle/0003_storage_policies.sql`.

## Required behavior

### Upload

- Route handler at `src/app/api/files/upload/route.ts` (POST, multipart).
- Steps:
  1. `requireUser` and `requireOrgRole(orgId, "member")`.
  2. If `note_id` supplied: `assertCanWriteNote(noteId, userId)`.
  3. Validate MIME type against allow-list (images, pdf, docx, txt, csv,
     md, json, code-text). Reject executables / disk images.
  4. Validate size (≤ 25 MB or `next.config.ts` limit, whichever lower).
  5. Stream into Supabase Storage with the service-role client at the
     `${orgId}/${fileId}/${origName}` path. Why service-role? RLS on
     `storage.objects` checks org membership, but we want to be able to
     fail loudly with a clear message before the upload starts.
  6. Insert `files` row via the user's Supabase client (so RLS enforces
     `org_id` membership and `note_id` write).
  7. `audit({ action: "file.upload", orgId, userId, resourceId: fileId, metadata: { fileName, mimeType, sizeBytes } })`.
  8. Return `Result<{ id, url }>` where `url` is a freshly-signed URL.

### Download

- Server action `getDownloadUrl(fileId)`:
  1. SELECT file via user's Supabase client (RLS filters).
  2. If returned, request a signed URL (60s TTL) via service-role client.
  3. `audit({ action: "file.download", orgId, userId, resourceId: fileId })`.
- Never return the storage path directly to the client. Always signed.

### Delete

- Soft-delete `files.deleted_at` first (so audit can resolve metadata).
- Then call storage delete via service-role.
- `audit({ action: "file.delete" })`.

## Things to test

- Upload to org A while a member of org B only — must 403.
- Upload with `note_id` belonging to a note user can't write — must 403.
- List files: only see your org's. Note-attached files only listed if you
  can read the note.
- Download: signed URL works for 60s, then expires.
- Delete by uploader: ok. Delete by random org member: 403. Delete by org
  admin: ok.

## Audit events

`file.upload`, `file.download`, `file.delete`. Metadata: `{ fileName, mimeType, sizeBytes, noteId? }`.

## Commit conventions

- `feat(files): upload route handler with MIME + size guards`
- `feat(files): signed-URL download helper`
- `feat(files): org file list page`
- `feat(files): note attachments UI`
- `fix(files): reject upload before opening stream when MIME invalid`
