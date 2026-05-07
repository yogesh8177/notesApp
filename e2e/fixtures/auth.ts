/**
 * Playwright auth helpers — sign in via the password tab, then save
 * storageState so subsequent tests reuse the session without repeating login.
 */
import { Page } from "@playwright/test";
import { TestUser } from "./db";

export async function signIn(page: Page, user: TestUser) {
  await page.goto("/sign-in");
  // Switch to the Password tab
  await page.getByRole("tab", { name: "Password" }).click();
  await page.getByLabel("Email").last().fill(user.email);
  await page.getByRole("textbox", { name: "Password" }).fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Successful sign-in redirects to /orgs
  await page.waitForURL("**/orgs**", { timeout: 15_000 });
}

export async function signOut(page: Page) {
  await page.goto("/orgs");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("**/sign-in**", { timeout: 8_000 });
}
