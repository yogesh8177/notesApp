# Module: notes-core

> Worktree branch: `agent/notes-core`
> Read root `CLAUDE.md` first — it has the frozen contracts and project rules.

## Scope

Owns notes CRUD, tagging, visibility/sharing, **and versioning + diff**.
Versioning is in this module (not separate) because every mutation should
write a version row in the same transaction — no other module needs to do that.

## Files you own

- `src/lib/notes/**` — server actions, repo functions, type re-exports.
- `src/app/orgs/[orgId]/notes/**` — list, detail, create, edit, history,
  diff pages.
- `src/app/api/notes/**` — only if you need a route handler (e.g. async
  things). Prefer server actions.
- Tests under `src/lib/notes/__tests__/**` if you write any.

Keep all your code under those paths. Don't reach into other modules' folders.

## Files you can READ but must NOT modify

- `src/lib/db/schema/**` — the schema is locked. If you need a column,
  surface it via `NOTES.md` first.
- `src/lib/auth/**` — call helpers; don't change them.
- `src/lib/log/**` — call `audit()`; don't extend it.
- `src/lib/validation/result.ts` — use the envelope; don't invent your own.

## Required behavior

### CRUD

- **Create** — input: `{ title, content, visibility, tagNames[] }`. Server
  action: `createNote(input)`.
  - Verify `requireOrgRole(orgId, "member")`.
  - Insert `notes` + first row in `note_versions` (version 1) in a
    transaction.
  - Resolve/insert tags (org-scoped, on conflict do nothing), then write
    `note_tags`.
  - `audit({ action: "note.create", orgId, userId, resourceType: "note", resourceId })`.
  - Return `Result<{ id }>`.

- **Update** — `updateNote(noteId, partial)`.
  - `assertCanWriteNote(noteId, userId)` — throws `PermissionError`.
  - In one transaction:
    1. SELECT note FOR UPDATE.
    2. INSERT new `note_versions` row (`version = current_version + 1`,
       full snapshot of new title/content/visibility, `changed_by = user`).
    3. UPDATE `notes` (set fields, `current_version = new`, `updated_at = now()`).
    4. Reconcile `note_tags` (delete removed, insert added).
  - `audit({ action: "note.update" })`.

- **Delete** — soft delete. `assertCanWriteNote` not enough — only author or
  org admin can delete. `assertCanDeleteNote` (write yourself or use the
  `canDelete` field of `getNotePermission`).

- **Read list** — `listNotes(orgId, filters)`. Always WHERE `org_id = $1`
  AND `deleted_at IS NULL`. Visibility is enforced by RLS, but you should
  also write the SQL conservatively.

- **Read detail** — `getNote(noteId)`. `assertCanReadNote` first.

### Tags

- Tag names are org-scoped; reuse via UPSERT on `(org_id, name)`.
- Tag list page: `/orgs/[orgId]/notes?tag=foo` filter.

### Visibility + sharing

- `visibility` enum: `private` (author only), `org` (all members), `shared`
  (per-user via `note_shares`).
- Share UI: pick org members, set `view` or `edit`.
- Removing share: `assertCanShareNote(noteId, userId)`. Audit
  `note.share` / `note.unshare` with metadata `{ targetUserId, permission }`.

### Versioning + diff

- Every UPDATE writes a new `note_versions` row in the same transaction.
- History page: `/orgs/[orgId]/notes/[id]/history` lists versions with
  changed_by, change_summary, created_at.
- Diff page: `/orgs/[orgId]/notes/[id]/diff?from=N&to=M` — use the `diff`
  npm package (already in deps) for word/line diff.
- **Permission rule:** can-read on a version requires `can_read_note(noteId)`
  *now* — not at version creation time. (Don't let revoked-share users see
  old versions.)
- Concurrency: use `SELECT ... FOR UPDATE` on the parent row before bumping
  version, OR use `INSERT INTO note_versions ... WHERE version = $current
  RETURNING` and detect conflict.

## Things to test before merging

- Create note in org A as user A; verify user from org B cannot read it
  (302/404 from page; 403 from action).
- `private` note: only author reads; even org admin? Per spec — admin can.
  Confirm with `can_read_note`.
- `shared` note: revoke a share, then try to read v1 of the version history
  as the revoked user — must fail.
- Version race: two concurrent updates — second must either succeed at v3
  (after the first's v2) or fail loudly.
- Tag rename across orgs: same tag name in two orgs is two distinct tag rows.

## Audit events you must emit

`note.create`, `note.update`, `note.delete`, `note.share`, `note.unshare`.
Use `audit()` — never INSERT directly into `audit_log`.

## Hand-off contract for other modules

- **search** module: searches against `notes.search_vector` + tags. You
  don't need to maintain anything for them; the GENERATED column updates
  itself.
- **ai-summary** module: reads notes via `getNote(noteId)`. They will call
  `assertCanReadNote` themselves. Don't worry about it.
- **files** module: attaches files via `files.note_id`. They call your
  `assertCanWriteNote` before creating the file row.

## Commit conventions

- `feat(notes): create-note server action with permission check`
- `feat(notes): note detail page`
- `feat(notes): version history page`
- `feat(notes): diff viewer`
- `feat(notes): tag input + autocomplete`
- `feat(notes): share dialog (members picker + view/edit toggle)`
- `fix(notes): preserve current_version on concurrent update`
- `test(notes): permission matrix`

Don't bundle. One concern per commit.
