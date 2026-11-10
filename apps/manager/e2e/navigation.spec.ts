/** Leaving the New job page must not crash the app (effect cleanup regression). */
import { expect, test } from "@playwright/test";

test("New job → Jobs → New job → Jobs without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(process.env.E2E_MANAGER_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_MANAGER_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();

  await page.getByRole("link", { name: "New job" }).first().click();
  await expect(page.getByRole("button", { name: /senior React engineer/ })).toBeVisible(); // starter suggestion
  if (process.env.E2E_SHOTS) {
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${process.env.E2E_SHOTS}/new-job.png` });
  }
  await page.getByRole("link", { name: "Jobs" }).first().click();

  for (let i = 0; i < 2; i++) {
    await page.getByRole("link", { name: "New job" }).first().click();
    await expect(page.getByRole("heading", { name: "New job" })).toBeVisible();
    await page.getByRole("link", { name: "Jobs" }).first().click();
    await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
  }
  expect(errors).toEqual([]);
});
