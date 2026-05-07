/**
 * e2e — Full-text search
 *
 * Verifies that notes are indexed and retrievable via the search page.
 * Uses a unique term so results can't be confused with other test data.
 * Covers: FTS hit, tag-prefix search (#tag), no-results state.
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
  user = await createTestUser("search-e2e");
  org = await createTestOrg(user.id, "search-e2e");
});

test.afterAll(async () => {
  await deleteTestOrg(org.id);
  await deleteTestUser(user.id);
  await closeSql();
});

test.beforeEach(async ({ page }) => {
  await signIn(page, user);
});

async function createNote(page: import("@playwright/test").Page, orgId: string, title: string, content: string) {
  await page.goto(`/orgs/${orgId}/notes`);
  await page.getByPlaceholder("Sprint retro").fill(title);
  await page.locator("textarea[name=content]").fill(content);
  await page.locator("form:has(textarea[name=content])").locator("select[name=visibility]").selectOption("org");
  await page.getByRole("button", { name: "Create note" }).click();
  await page.waitForURL(`**/orgs/${orgId}/notes/**`, { timeout: 10_000 });
}

test("full-text search finds note by unique content term", async ({ page }) => {
  // Use a unique token that won't appear in any other note
  const uniqueToken = `xqz${Date.now()}`;
  const title = `Search Target ${Date.now()}`;
  await createNote(page, org.id, title, `This note contains the unique term ${uniqueToken}.`);

  await page.goto(`/orgs/${org.id}/search`);
  await page.getByLabel("Query").fill(uniqueToken);
  await page.getByRole("button", { name: /search/i }).click();

  // Result card shows the note title as a link
  await expect(page.getByRole("link", { name: title })).toBeVisible({ timeout: 10_000 });
});

test("search result links through to the note detail page", async ({ page }) => {
  const uniqueToken = `linktest${Date.now()}`;
  const title = `Linkthrough Note ${Date.now()}`;
  await createNote(page, org.id, title, `Content with ${uniqueToken} for linkthrough test.`);

  await page.goto(`/orgs/${org.id}/search`);
  await page.getByLabel("Query").fill(uniqueToken);
  await page.getByRole("button", { name: /search/i }).click();
  await expect(page.getByRole("link", { name: title })).toBeVisible({ timeout: 10_000 });

  await page.getByRole("link", { name: title }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
});

test("search with no matches shows empty state", async ({ page }) => {
  await page.goto(`/orgs/${org.id}/search`);
  await page.getByLabel("Query").fill("zzznomatchxxx999aaa");
  await page.getByRole("button", { name: /search/i }).click();

  await expect(page.getByText(/no readable notes matched/i)).toBeVisible({ timeout: 10_000 });
});

test("tag-prefix search finds note by tag", async ({ page }) => {
  // Create a note with a unique tag
  const tag = `e2etag${Date.now()}`;
  const title = `Tagged Note ${Date.now()}`;
  await page.goto(`/orgs/${org.id}/notes`);
  await page.getByPlaceholder("Sprint retro").fill(title);
  await page.locator("textarea[name=content]").fill("Tagged note content.");
  await page.locator("form:has(textarea[name=content])").locator("select[name=visibility]").selectOption("org");
  await page.locator("input[name=tags]").fill(tag);
  await page.getByRole("button", { name: "Create note" }).click();
  await page.waitForURL(`**/orgs/${org.id}/notes/**`, { timeout: 10_000 });

  // Search with #tag prefix
  await page.goto(`/orgs/${org.id}/search`);
  await page.getByLabel("Query").fill(`#${tag}`);
  await page.getByRole("button", { name: /search/i }).click();

  await expect(page.getByRole("link", { name: title })).toBeVisible({ timeout: 10_000 });
});
