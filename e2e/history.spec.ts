/**
 * e2e — Version history page
 *
 * Verifies that after editing a note the history page shows:
 * - The "History" heading with current version in the subtitle
 * - A diff section "Comparing v2 against v1"
 * - Both versions listed in "All versions" with a "Compare to previous" button
 */
import { test, expect } from "@playwright/test";
import {
  createTestUser,
  createTestOrg,
  deleteTestOrg,
  deleteTestUser,
  closeSql,
  type TestUser,
  type TestOrg,
} from "./fixtures/db";
import { signIn } from "./fixtures/auth";

let user: TestUser;
let org: TestOrg;

test.beforeAll(async () => {
  user = await createTestUser("history-e2e");
  org = await createTestOrg(user.id, "history-e2e");
});

test.afterAll(async () => {
  await deleteTestOrg(org.id);
  await deleteTestUser(user.id);
  await closeSql();
});

test.beforeEach(async ({ page }) => {
  await signIn(page, user);
});

test("history page shows diff between v1 and v2 after an edit", async ({ page }) => {
  // Create a note
  await page.goto(`/orgs/${org.id}/notes`);
  const title = `History Note ${Date.now()}`;
  await page.getByPlaceholder("Sprint retro").fill(title);
  await page.locator("textarea[name=content]").fill("Version one body.");
  await page.locator("form:has(textarea[name=content])").locator("select[name=visibility]").selectOption("org");
  await page.getByRole("button", { name: "Create note" }).click();
  await page.waitForURL(`**/orgs/${org.id}/notes/**`, { timeout: 10_000 });

  // Edit to produce v2 — wait for React hydration before clicking save
  await page.locator("textarea[name=content]").fill("Version two body.");
  await expect(page.getByRole("button", { name: "Save changes" })).toBeEnabled({ timeout: 5_000 });
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(/\?message=/, { timeout: 10_000 });
  await page.waitForLoadState("load");

  // Navigate to history
  await page.getByRole("link", { name: "View history" }).click();
  await page.waitForURL(`**/history**`, { timeout: 8_000 });

  // Heading and subtitle
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
  await expect(page.getByText(/current version 2/)).toBeVisible();

  // Diff section title shows v2 vs v1
  await expect(page.getByText("Comparing v2 against v1")).toBeVisible();

  // Both versions appear in the "All versions" list
  await expect(page.getByText(/v2 ·/)).toBeVisible();
  await expect(page.getByText(/v1 ·/)).toBeVisible();

  // "Compare to previous" button exists for v2
  await expect(page.getByRole("link", { name: "Compare to previous" }).first()).toBeVisible();
});
