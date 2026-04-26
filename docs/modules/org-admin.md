# Module: org-admin

> Worktree branch: `agent/org-admin`
> Read root `CLAUDE.md` first.

## Scope

Org creation, membership management, invites, role changes, member list,
leave-org. Org switcher in the header.

## Files you own

- `src/lib/orgs/**` — server actions for create / invite / accept / role.
- `src/app/orgs/new/**` — create org form.
- `src/app/orgs/invite/[token]/**` — accept-invite page.
- `src/app/orgs/[orgId]/settings/**` — org settings (name, slug, members,
  invites).

## Frozen — DO NOT MODIFY

- `orgs`, `memberships`, `org_invites` schemas.
- RLS policies on these tables.
- `requireOrgRole`, `listMyOrgs`, `getMembership` helpers.

## Required behavior

### Create org — `createOrg({ name, slug })`

- `requireUser`.
- Validate slug (`^[a-z0-9-]{2,40}$`), unique.
- Insert via service-role client (the user is not yet a member when creating
  the org, so RLS would block via the user's client).
- Insert membership row with `role='owner'` for the creator.
- Audit `org.create`.
- Return `Result<{ id }>`. Redirect to `/orgs/[id]/notes`.

### Invite member — `inviteMember(orgId, { email, role })`

- `requireOrgRole(orgId, "admin")`.
- Generate cryptographically random token (`crypto.randomUUID()` is fine).
- INSERT `org_invites` with `expires_at = now() + 7 days`.
- Send email with link `${APP_URL}/orgs/invite/${token}`. (For this build,
  it's OK to log the link to the audit log if email is not configured —
  but make this configurable, not hidden.)
- Audit `org.invite` with `metadata: { email, role }`.

### Accept invite — `/orgs/invite/[token]` page + action

- If unauthenticated, redirect to sign-in with `redirect_to` set.
- Look up token; verify not expired, not accepted.
- If invitee email matches signed-in user's email → INSERT membership,
  UPDATE invite `accepted_at`. Audit `org.invite.accept`.
- If email mismatch → show "this invite is for a different account" with
  sign-out option.

### Change role — `changeRole(orgId, userId, role)`

- `requireOrgRole(orgId, "admin")`.
- Cannot demote the last owner. Verify count(role='owner') > 0 after change.
- Cannot self-demote if you are the last owner.
- Audit `org.role.change` with `metadata: { from, to, targetUserId }`.

### Member list

- Joins `memberships` with `users` for display name.
- Filter by role; sort by join date.

### Org switcher

A dropdown component. On select, sets `active_org_id` cookie (informational
only — auth still derives org from URL) and navigates to `/orgs/[newId]/notes`.
Audit `org.switch`.

## Things to test

- Create org with duplicate slug → 409 CONFLICT envelope.
- Invite email that's already a member → no-op, friendly message.
- Accept invite while signed in as the wrong user → blocked.
- Demote last owner → 422 with clear message.
- Self-demote when not last owner → ok; user immediately sees reduced UI.

## Audit events

`org.create`, `org.invite`, `org.invite.accept`, `org.role.change`,
`org.switch`.

## Commit conventions

- `feat(org): create-org server action with slug uniqueness check`
- `feat(org): invite token generator + DB write`
- `feat(org): invite acceptance page + email match guard`
- `feat(org): role-change action w/ last-owner protection`
- `feat(org): member list page`
- `feat(org): header org switcher`
