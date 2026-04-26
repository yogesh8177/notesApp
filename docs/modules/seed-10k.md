# Module: seed-10k

> Worktree branch: `agent/seed-10k`
> Read root `CLAUDE.md` first.

## Scope

Realistic seed data at scale. Required for graders to test search at volume
and review tenant isolation.

## Files you own

- `scripts/seed/**`

## Frozen — DO NOT MODIFY

- Schema. Use the existing tables; don't add columns.
- RLS. Run via service-role / direct DB connection only.

## Required output

By default (`pnpm seed:large` → `SEED_NOTE_COUNT=10000`):

- **5 orgs** with varied names.
- **20 users** spread across orgs:
  - Most belong to 1–2 orgs.
  - At least 3 users belong to all 5 (to exercise the org switcher).
  - Roles distributed: ~1 owner per org, 1–2 admins, mix of members and viewers.
- **~10,000 notes** distributed roughly proportional to org size.
  - Visibility: ~10% private, ~70% org, ~20% shared.
  - Tags: per org, 15–30 tag values; each note gets 1–5 tags. Some tag names
    overlap across orgs (e.g. "roadmap", "todo", "meeting").
  - Versions: each note has 1–5 versions (most have 2–3).
  - Some titles repeat across orgs (search must isolate).
- **Note shares:** for the ~20% shared notes, share with 1–3 random members
  of the same org. Mix of `view` and `edit`.
- **Files:** ~100 files total. ~80% attached to a note, ~20% org-level.
  Mix of MIME types (pdf, png, txt, md). Use small placeholder bytes.

## Data Semantics (CRITICAL for AI Summary & Search)

**DO NOT USE `faker.lorem`, `faker.hacker.phrase`, or pure gibberish for note titles or content.** The reviewers will use this data to test the "AI Summary" and "Search" features. If the data is gibberish, the AI summarizer will fail.

- **Titles:** Must be realistic corporate events to guarantee semantic overlaps for search testing. Use combinations of small arrays. 
  - *Example arrays:* Prefixes (`URGENT:`, `Draft:`), Departments (`Engineering`, `HR`), and Topics (`Q3 Roadmap`, `Incident Report`).
  - *Result:* "URGENT: Engineering - Incident Report"
- **Content Bodies:** Must be structured like real wiki documents so the AI summarizer can extract meaningful action items.
  - Include an introductory sentence, a technical detail, and a markdown list of 1-3 specific action items.
  - *Example:* "Investigate high latency. - [ ] Roll back deployment."
  - **Tags:** Do not generate random dictionary words for tags. Create a strict array of 15-20 corporate tags (e.g., `Urgent`, `Planning`, `Q3`, `Infrastructure`, `Frontend`) and assign 1-3 of these to each note. This ensures the required overlapping tags across different orgs.
  - **Version State Changes:** The seed data must demonstrate visible state changes across versions. When generating a `note_versions` row for an update, explicitly instruct the generator to alter the body content slightly (e.g., change an action item from `[ ]` to `[x]`, or append a "Resolution" sentence).

## Constraints

- **Idempotent-ish:** `setFakerSeed(SEED_RNG)` so reruns are predictable.
- **Transactional batches:** insert in batches of 500–1000 notes; a failed
  batch should roll back cleanly.
- **Performance:** the full 10k seed should complete in under 90s on a
  laptop against a local Supabase. If you're slower, profile.
- **User passwords:** for testing, set every seeded user's password to
  `password123!` (already in the factory). Print 2–3 sample emails at the
  end so reviewers can sign in.
- **Print summary:** at the end, log row counts for each table.

## How to insert auth users

Supabase has no `INSERT` on `auth.users`. Use the admin API:

```ts
import { createServiceClient } from "@/lib/supabase/service";
const sb = createServiceClient();
const { data, error } = await sb.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { display_name },
});
```

The `on_auth_user_created` trigger will mirror the row into `public.users`.

## Things to test

- After running, sign in as a printed sample email + password.
- Search for a common term — must scope to the user's org.
- Open one note that has multiple versions — diff page works.
- Switch orgs — header reflects different org/role.

## Commit conventions

- `feat(seed): orgs + memberships generator`
- `feat(seed): users via supabase admin API`
- `feat(seed): notes with versions and tags (batched)`
- `feat(seed): note shares for shared-visibility notes`
- `feat(seed): file uploads (small placeholder bytes)`
- `chore(seed): summary printout + sample login`
