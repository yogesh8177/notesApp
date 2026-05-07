/**
 * e2e — Notes CRUD golden path
 *
 * Covers: create, view, edit (content change), no-op save guard, delete.
 * Runs as a single member user inside one org.
 *
 * Note: createNoteAction redirects to the note detail page after creation,
 * so tests proceed from the detail page rather than waiting for a list link.
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
  user = await createTestUser("notes-crud");
  org = await createTestOrg(user.id, "notes-crud");
});

test.afterAll(async () => {
  await deleteTestOrg(org.id);
  await deleteTestUser(user.id);
  await closeSql();
});

test.beforeEach(async ({ page }) => {
  await signIn(page, user);
});

/** Fill and submit the create note form, wait for redirect to detail page. */
async function createNote(page: import("@playwright/test").Page, orgId: string, title: string, content: string, visibility = "org") {
  await page.goto(`/orgs/${orgId}/notes`);
  await page.getByPlaceholder("Sprint retro").fill(title);
  await page.locator("textarea[name=content]").fill(content);
  await page.locator("form:has(textarea[name=content])").locator("select[name=visibility]").selectOption(visibility);
  await page.getByRole("button", { name: "Create note" }).click();
  // Action redirects to detail page
  await page.waitForURL(`**/orgs/${orgId}/notes/**`, { timeout: 10_000 });
}

test("notes list page loads for org member", async ({ page }) => {
  await page.goto(`/orgs/${org.id}/notes`);
  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create note" })).toBeVisible();
});

test("create a note and see it in the list", async ({ page }) => {
  const title = `E2E Note ${Date.now()}`;
  await createNote(page, org.id, title, "Hello from Playwright.");

  // Redirected to detail — heading confirms creation
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  // Navigate back to list and confirm the note appears as a link
  await page.goto(`/orgs/${org.id}/notes`);
  await expect(page.getByRole("link", { name: title })).toBeVisible({ timeout: 10_000 });
});

test("open note detail page", async ({ page }) => {
  const title = `Detail Note ${Date.now()}`;
  await createNote(page, org.id, title, "Detail content.");

  // Already on detail page after creation
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("version 1")).toBeVisible();
});

test("edit note content bumps version", async ({ page }) => {
  const title = `Edit Note ${Date.now()}`;
  await createNote(page, org.id, title, "Original body.");

  // Already on detail page — edit directly
  await page.locator("textarea[name=content]").fill("Updated body — changed.");
  await page.getByRole("button", { name: "Save changes" }).click();

  // Action redirects to same page with ?message= — wait for that before asserting version
  await page.waitForURL(/\?message=/, { timeout: 10_000 });
  await expect(page.getByText("version 2")).toBeVisible();
});

test("saving without changes keeps version the same (no-op guard)", async ({ page }) => {
  const title = `Noop Note ${Date.now()}`;
  await createNote(page, org.id, title, "Unchanged body.");

  // Already on detail page — Save changes should be disabled
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
});

test("delete note removes it from list", async ({ page }) => {
  const title = `Delete Note ${Date.now()}`;
  await createNote(page, org.id, title, "To be deleted.");

  // Already on detail page — delete
  await page.getByRole("button", { name: "Delete note" }).click();

  // Should redirect back to list and note link is gone
  await page.waitForURL(`**/orgs/${org.id}/notes**`, { timeout: 10_000 });
  await expect(page.getByRole("link", { name: title })).not.toBeVisible();
});
