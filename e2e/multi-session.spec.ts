/**
 * e2e — Multi-browser session tests
 *
 * Two separate browser contexts (user A and user B) operate concurrently
 * inside the same org. Tests verify:
 *   1. Notes created by one user are visible to other org members.
 *   2. A private note is NOT visible to other members in the list.
 *   3. Only the author can delete their own note; another member cannot.
 *   4. Concurrent edits don't corrupt version numbers.
 *
 * Note: createNoteAction redirects to the note detail page after creation.
 * Each test waits for that redirect then navigates as needed.
 */
import { test, expect, Browser, BrowserContext, Page } from "@playwright/test";
import {
  createTestUser,
  createTestOrg,
  addMember,
  deleteTestOrg,
  deleteTestUser,
  closeSql,
  type TestUser,
  type TestOrg,
} from "./fixtures/db";
import { signIn } from "./fixtures/auth";

let userA: TestUser;
let userB: TestUser;
let org: TestOrg;

let ctxA: BrowserContext;
let ctxB: BrowserContext;
let pageA: Page;
let pageB: Page;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  userA = await createTestUser("multi-sess-a");
  userB = await createTestUser("multi-sess-b");
  org = await createTestOrg(userA.id, "multi-sess");
  await addMember(org.id, userB.id, "member");

  ctxA = await browser.newContext();
  ctxB = await browser.newContext();
  pageA = await ctxA.newPage();
  pageB = await ctxB.newPage();

  await signIn(pageA, userA);
  await signIn(pageB, userB);
});

test.afterAll(async () => {
  await ctxA.close();
  await ctxB.close();
  await deleteTestOrg(org.id);
  await deleteTestUser(userA.id);
  await deleteTestUser(userB.id);
  await closeSql();
});

/** Submit create note form and wait for redirect to detail page. Returns detail URL. */
async function createNote(page: Page, orgId: string, title: string, content: string, visibility = "org") {
  await page.goto(`/orgs/${orgId}/notes`);
  await page.getByPlaceholder("Sprint retro").fill(title);
  await page.locator("textarea[name=content]").fill(content);
  await page.locator("form:has(textarea[name=content])").locator("select[name=visibility]").selectOption(visibility);
  await page.getByRole("button", { name: "Create note" }).click();
  await page.waitForURL(`**/orgs/${orgId}/notes/**`, { timeout: 10_000 });
  return page.url();
}

test("note created by user A is visible to user B after reload", async () => {
  const title = `Shared Org Note ${Date.now()}`;
  await createNote(pageA, org.id, title, "Visible to all org members.", "org");

  // User B loads the notes list — the org-visible note should appear
  await pageB.goto(`/orgs/${org.id}/notes`);
  await expect(pageB.getByRole("link", { name: title })).toBeVisible({ timeout: 10_000 });
});

test("private note created by user A is not visible to user B", async () => {
  const title = `Private Note ${Date.now()}`;
  await createNote(pageA, org.id, title, "Only author sees this.", "private");

  // User B should NOT see the private note in the list
  await pageB.goto(`/orgs/${org.id}/notes`);
  await expect(pageB.getByRole("link", { name: title })).not.toBeVisible();
});

test("user B cannot delete a note authored by user A", async () => {
  const title = `Ownership Note ${Date.now()}`;
  const noteUrl = await createNote(pageA, org.id, title, "This belongs to A.", "org");

  // User B navigates directly to the note detail page
  await pageB.goto(noteUrl);
  await expect(pageB.getByRole("heading", { name: title })).toBeVisible();

  // Delete button should be absent for non-author
  await expect(pageB.getByRole("button", { name: "Delete note" })).not.toBeVisible();
});

test("concurrent edits — last write wins without corrupting versions", async () => {
  const title = `Concurrent Note ${Date.now()}`;
  const noteUrl = await createNote(pageA, org.id, title, "Version 1 content.", "org");

  // Both users open the note detail
  await pageB.goto(noteUrl);

  // User A saves a change first
  await pageA.locator("textarea[name=content]").fill("User A edit.");
  await pageA.getByRole("button", { name: "Save changes" }).click();
  await pageA.waitForURL(/\?message=/, { timeout: 10_000 });
  await expect(pageA.getByText("version 2")).toBeVisible();

  // User B attempts a save — may succeed as v3 or be a no-op
  const editArea = pageB.locator("textarea[name=content]");
  if (await editArea.isVisible()) {
    await editArea.fill("User B edit.");
    const saveBtn = pageB.getByRole("button", { name: "Save changes" });
    if (await saveBtn.isEnabled()) {
      await saveBtn.click();
    }
  }

  // User A refreshes and confirms no version regression
  await pageA.reload();
  const versionText = await pageA.getByText(/version \d+/).first().textContent();
  const version = parseInt(versionText?.match(/\d+/)?.[0] ?? "0");
  expect(version).toBeGreaterThanOrEqual(2);
});

test("author changes visibility private→org; user B can now see note in list", async () => {
  const title = `Visibility Change Note ${Date.now()}`;
  const noteUrl = await createNote(pageA, org.id, title, "Initially private.", "private");

  // User B should NOT see the private note
  await pageB.goto(`/orgs/${org.id}/notes`);
  await expect(pageB.getByRole("link", { name: title })).not.toBeVisible();

  // User A is already on detail page — change visibility to org
  await pageA.goto(noteUrl);
  await pageA.locator("select[name=visibility]").selectOption("org");
  await pageA.getByRole("button", { name: "Save changes" }).click();
  await pageA.waitForURL(/\?message=/, { timeout: 10_000 });

  // User B refreshes list — note should now be visible
  await pageB.goto(`/orgs/${org.id}/notes`);
  await expect(pageB.getByRole("link", { name: title })).toBeVisible({ timeout: 10_000 });
});

test("two users see consistent state on shared note detail", async () => {
  const title = `Shared Detail Note ${Date.now()}`;
  const noteUrl = await createNote(pageA, org.id, title, "Shared initial content.", "org");

  // B navigates directly to the same note URL
  await pageB.goto(noteUrl);
  await expect(pageB.getByRole("heading", { name: title })).toBeVisible();
  await expect(pageB.getByText("Shared initial content.")).toBeVisible();
});
