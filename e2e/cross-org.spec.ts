/**
 * e2e — Cross-org boundary enforcement
 *
 * Verifies that a user cannot read notes belonging to an org they are not a
 * member of. requireOrgRole() redirects non-members to /orgs; the test
 * asserts that redirect happens and content is not accessible.
 *
 * Scenarios:
 *   1. User B (not in org A) requests org A's notes list → redirected to /orgs.
 *   2. User B directly navigates to a known note URL in org A → redirected to /orgs.
 *   3. User A (in org A only) cannot reach org B's notes list → redirected to /orgs.
 *   4. Accessing another org's page does not break access to the user's own org.
 */
import { test, expect, Browser } from "@playwright/test";
import {
  createTestUser,
  createTestOrg,
  createTestNote,
  deleteTestOrg,
  deleteTestUser,
  closeSql,
  type TestUser,
  type TestOrg,
  type TestNote,
} from "./fixtures/db";
import { signIn } from "./fixtures/auth";

let userA: TestUser;
let userB: TestUser;
let orgA: TestOrg;
let orgB: TestOrg;
let noteInOrgA: TestNote;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  userA = await createTestUser("cross-org-a");
  userB = await createTestUser("cross-org-b");
  orgA = await createTestOrg(userA.id, "cross-org-a");
  orgB = await createTestOrg(userB.id, "cross-org-b");
  noteInOrgA = await createTestNote(orgA.id, userA.id, "Secret Note", "Private content", "private");
});

test.afterAll(async () => {
  await deleteTestOrg(orgA.id);
  await deleteTestOrg(orgB.id);
  await deleteTestUser(userA.id);
  await deleteTestUser(userB.id);
  await closeSql();
});

test("non-member cannot access org notes list — redirected to /orgs", async ({ page }) => {
  await signIn(page, userB);
  await page.goto(`/orgs/${orgA.id}/notes`);
  // requireOrgRole redirects non-members to /orgs
  await expect(page).toHaveURL(/\/orgs$/, { timeout: 8_000 });
});

test("non-member direct note URL is redirected to /orgs", async ({ page }) => {
  await signIn(page, userB);
  await page.goto(`/orgs/${orgA.id}/notes/${noteInOrgA.id}`);
  await expect(page).toHaveURL(/\/orgs$/, { timeout: 8_000 });
  // Confirm the protected content was never rendered
  await expect(page.getByText("Private content")).not.toBeVisible();
});

test("member of org A cannot access org B notes list — redirected to /orgs", async ({ page }) => {
  await signIn(page, userA);
  await page.goto(`/orgs/${orgB.id}/notes`);
  await expect(page).toHaveURL(/\/orgs$/, { timeout: 8_000 });
});

test("cross-org attempt does not break access to own org", async ({ page }) => {
  await signIn(page, userA);
  // Attempt cross-org access first
  await page.goto(`/orgs/${orgB.id}/notes`);
  await expect(page).toHaveURL(/\/orgs$/, { timeout: 8_000 });
  // userA IS a member of orgA — should still work
  await page.goto(`/orgs/${orgA.id}/notes`);
  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();
});
