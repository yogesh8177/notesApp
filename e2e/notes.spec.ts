/**
 * e2e — Notes CRUD golden path
 *
 * Covers: create, view, edit (content change), no-op save guard, delete.
 * Runs as a single member user inside one org.
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

test("notes list page loads for org member", async ({ page }) => {
  await page.goto(`/orgs/${org.id}/notes`);
  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create note" })).toBeVisible();
});

test("create a note and see it in the list", async ({ page }) => {
  await page.goto(`/orgs/${org.id}/notes`);

  const title = `E2E Note ${Date.now()}`;
  await page.getByPlaceholder("Sprint retro").fill(title);
  await page.locator("textarea[name=content]").fill("Hello from Playwright.");
  await page.getByRole("button", { name: "Create note" }).click();

  await expect(page.getByRole("link", { name: title })).toBeVisible({ timeout: 10_000 });
});

test("open note detail page", async ({ page }) => {
  await page.goto(`/orgs/${org.id}/notes`);
  const title = `Detail Note ${Date.now()}`;
  await page.getByPlaceholder("Sprint retro").fill(title);
  await page.locator("textarea[name=content]").fill("Detail content.");
  await page.getByRole("button", { name: "Create note" }).click();
  await expect(page.getByRole("link", { name: title })).toBeVisible({ timeout: 10_000 });

  await page.getByRole("link", { name: title }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("version 1")).toBeVisible();
});

test("edit note content bumps version", async ({ page }) => {
  await page.goto(`/orgs/${org.id}/notes`);
  const title = `Edit Note ${Date.now()}`;
  await page.getByPlaceholder("Sprint retro").fill(title);
  await page.locator("textarea[name=content]").fill("Original body.");
  await page.getByRole("button", { name: "Create note" }).click();
  await expect(page.getByRole("link", { name: title })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("link", { name: title }).click();

  await page.locator("textarea[name=content]").fill("Updated body — changed.");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText("version 2")).toBeVisible({ timeout: 8_000 });
});

test("saving without changes keeps version the same (no-op guard)", async ({ page }) => {
  await page.goto(`/orgs/${org.id}/notes`);
  const title = `Noop Note ${Date.now()}`;
  await page.getByPlaceholder("Sprint retro").fill(title);
  await page.locator("textarea[name=content]").fill("Unchanged body.");
  await page.getByRole("button", { name: "Create note" }).click();
  await expect(page.getByRole("link", { name: title })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("link", { name: title }).click();

  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
});

test("delete note removes it from list", async ({ page }) => {
  await page.goto(`/orgs/${org.id}/notes`);
  const title = `Delete Note ${Date.now()}`;
  await page.getByPlaceholder("Sprint retro").fill(title);
  await page.locator("textarea[name=content]").fill("To be deleted.");
  await page.getByRole("button", { name: "Create note" }).click();
  await expect(page.getByRole("link", { name: title })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("link", { name: title }).click();

  await page.getByRole("button", { name: "Delete note" }).click();

  await page.waitForURL(`**/orgs/${org.id}/notes**`, { timeout: 10_000 });
  await expect(page.getByRole("link", { name: title })).not.toBeVisible();
});
