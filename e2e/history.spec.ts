/**
 * e2e — Version history page
 *
 * Seeds two versions directly via DB fixtures (no UI save) and verifies that
 * the history page renders the diff section and version list correctly.
 */
import { test, expect } from "@playwright/test";
import {
  createTestUser,
  createTestOrg,
  createTestNote,
  addTestNoteVersion,
  deleteTestOrg,
  deleteTestUser,
  closeSql,
  type TestUser,
  type TestOrg,
  type TestNote,
} from "./fixtures/db";
import { signIn } from "./fixtures/auth";

let user: TestUser;
let org: TestOrg;
let note: TestNote;

test.beforeAll(async () => {
  user = await createTestUser("history-e2e");
  org = await createTestOrg(user.id, "history-e2e");
  note = await createTestNote(org.id, user.id, "History Test Note", "Version one body.");
  await addTestNoteVersion(note.id, user.id, 2, "Version two body.");
});

test.afterAll(async () => {
  await deleteTestOrg(org.id);
  await deleteTestUser(user.id);
  await closeSql();
});

test.beforeEach(async ({ page }) => {
  await signIn(page, user);
});

test("history page shows diff between v1 and v2", async ({ page }) => {
  await page.goto(`/orgs/${org.id}/notes/${note.id}/history`);

  // Heading visible
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();

  // Diff section title shows v2 vs v1
  await expect(page.getByText("Comparing v2 against v1")).toBeVisible();

  // Both versions appear somewhere on the page (diff header + All versions list)
  await expect(page.getByText(/v2 ·/).first()).toBeVisible();
  await expect(page.getByText(/v1 ·/).first()).toBeVisible();

  // "Compare to previous" button exists for v2
  await expect(page.getByRole("link", { name: "Compare to previous" }).first()).toBeVisible();
});
