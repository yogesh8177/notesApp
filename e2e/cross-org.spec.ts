/**
 * e2e — Cross-org boundary enforcement
 *
 * Verifies that a user cannot read or mutate notes/pages belonging to an org
 * they are not a member of. These tests exercise the Next.js middleware and
 * server-side permission checks — NOT just RLS (which is covered by integration
 * tests). The browser should be redirected or shown a 404/access-denied state.
 *
 * Scenarios:
 *   1. User B (not in org A) requests org A's notes list → redirected away.
 *   2. User B directly navigates to a known note URL in org A → 404 / not found.
 *   3. User A (in org A) cannot reach org B's notes list.
 */
import { test, expect, Browser } from "@playwright/test";
import {
  createTestUser,
  createTestOrg,
  deleteTestOrg,
  deleteTestUser,
  closeSql,
  getSql,
  type TestUser,
  type TestOrg,
} from "./fixtures/db";
import { signIn } from "./fixtures/auth";

let userA: TestUser;
let userB: TestUser;
let orgA: TestOrg;
let orgB: TestOrg;
let noteIdInOrgA: string;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  userA = await createTestUser("cross-org-a");
  userB = await createTestUser("cross-org-b");
  orgA = await createTestOrg(userA.id, "cross-org-a");
  orgB = await createTestOrg(userB.id, "cross-org-b");

  // Seed a note in org A via direct SQL (owned by userA)
  const sql = getSql();
  const [note] = await sql.unsafe(
    `INSERT INTO notes (org_id, author_id, title, content, visibility, current_version)
     VALUES ('${orgA.id}', '${userA.id}', 'Secret Note', 'Private content', 'private', 1)
     RETURNING id`,
  ) as Array<{ id: string }>;
  noteIdInOrgA = note.id;
  await sql.unsafe(
    `INSERT INTO note_versions (note_id, version, content, changed_by)
     VALUES ('${noteIdInOrgA}', 1, 'Private content', '${userA.id}')`,
  );
});

test.afterAll(async () => {
  const sql = getSql();
  await sql.unsafe(`DELETE FROM note_versions WHERE note_id = '${noteIdInOrgA}'`);
  await sql.unsafe(`DELETE FROM notes WHERE id = '${noteIdInOrgA}'`);
  await deleteTestOrg(orgA.id);
  await deleteTestOrg(orgB.id);
  await deleteTestUser(userA.id);
  await deleteTestUser(userB.id);
  await closeSql();
});

test("non-member cannot access org notes list", async ({ page }) => {
  // Sign in as userB who is NOT in orgA
  await signIn(page, userB);
  await page.goto(`/orgs/${orgA.id}/notes`);

  // Should be redirected away (to /orgs or /sign-in) or show an error — never the notes list
  const url = page.url();
  const isAllowed =
    url.includes(`/orgs/${orgA.id}/notes`) &&
    !url.includes("sign-in") &&
    !url.includes("error");

  // Also check that the "Notes" heading for orgA is NOT shown
  const hasNotesHeading = await page.getByRole("heading", { name: "Notes" }).isVisible().catch(() => false);

  // Either redirect happened OR notes heading is not displayed
  expect(isAllowed && hasNotesHeading).toBe(false);
});

test("non-member direct note URL returns not-found state", async ({ page }) => {
  await signIn(page, userB);
  await page.goto(`/orgs/${orgA.id}/notes/${noteIdInOrgA}`);

  // Expect either a redirect away from orgA or a not-found / access-denied message
  const currentUrl = page.url();
  const stillOnNote = currentUrl.includes(`/orgs/${orgA.id}/notes/${noteIdInOrgA}`);

  if (stillOnNote) {
    // Page rendered but should show an error state, not the note content
    await expect(page.getByText("Private content")).not.toBeVisible();
    // Should show an error or not-found indicator
    const hasError =
      (await page.getByText(/not found|unavailable|access/i).isVisible().catch(() => false)) ||
      (await page.getByText(/404/i).isVisible().catch(() => false));
    expect(hasError).toBe(true);
  } else {
    // Redirect happened — acceptable
    expect(currentUrl).not.toContain(`/orgs/${orgA.id}/notes/${noteIdInOrgA}`);
  }
});

test("member of org A cannot see org B notes list", async ({ page }) => {
  // Sign in as userA who is NOT in orgB
  await signIn(page, userA);
  await page.goto(`/orgs/${orgB.id}/notes`);

  const url = page.url();
  const isAllowed =
    url.includes(`/orgs/${orgB.id}/notes`) &&
    !url.includes("sign-in") &&
    !url.includes("error");

  const hasNotesHeading = await page.getByRole("heading", { name: "Notes" }).isVisible().catch(() => false);

  expect(isAllowed && hasNotesHeading).toBe(false);
});

test("org A owner can still access org A notes after cross-org attempt", async ({ page }) => {
  // userA IS a member of orgA — confirm they can access after the cross-org attempt above
  await signIn(page, userA);
  await page.goto(`/orgs/${orgA.id}/notes`);
  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();
});
