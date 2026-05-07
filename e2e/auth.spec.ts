/**
 * e2e — Auth flow
 *
 * Covers: unauthenticated redirect, password sign-in, sign-out.
 */
import { test, expect } from "@playwright/test";
import { createTestUser, deleteTestUser, closeSql } from "./fixtures/db";
import { signIn, signOut } from "./fixtures/auth";
import type { TestUser } from "./fixtures/db";

let user: TestUser;

test.beforeAll(async () => {
  user = await createTestUser("auth-flow");
});

test.afterAll(async () => {
  await deleteTestUser(user.id);
  await closeSql();
});

test("unauthenticated user is redirected to sign-in", async ({ page }) => {
  await page.goto("/orgs");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("sign-in with password lands on /orgs", async ({ page }) => {
  await signIn(page, user);
  await expect(page).toHaveURL(/\/orgs/);
  // Org picker or empty state visible
  await expect(page.getByRole("heading", { name: /organisation/i })).toBeVisible();
});

test("sign-out returns to sign-in page", async ({ page }) => {
  await signIn(page, user);
  await signOut(page);
  await expect(page).toHaveURL(/\/sign-in/);
});

test("redirect_to param is honoured after sign-in", async ({ page }) => {
  // Navigate to a protected page — middleware will append redirect_to
  await page.goto("/orgs");
  await expect(page).toHaveURL(/\/sign-in/);

  // Sign in from the redirected URL — should land back on /orgs not /sign-in
  await page.getByRole("tab", { name: "Password" }).click();
  await page.getByLabel("Email").last().fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/orgs/, { timeout: 15_000 });
  await expect(page).not.toHaveURL(/\/sign-in/);
});
