/** Editor E2E (Phase 4 exit check): edit → preview → apply → undo, plus the 409 conflict path. */
import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { STATE } from "./global-setup";

const API = "http://127.0.0.1:8100";
const { jobId, token } = JSON.parse(readFileSync(STATE, "utf8")) as { jobId: string; token: string };

async function signIn(page: Page) {
  await page.goto(`/sign-in?next=/jobs/${jobId}/workflow`);
  await page.getByLabel("Email").fill(process.env.E2E_MANAGER_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_MANAGER_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Frontend Engineer" })).toBeVisible();
}

/** E2E_SHOTS=<dir> saves screenshots for a visual check. */
async function shot(page: Page, name: string) {
  if (!process.env.E2E_SHOTS) return;
  await page.waitForTimeout(400); // let dialog animations finish
  await page.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png`, fullPage: true });
}

const version = (page: Page, n: number) => expect(page.getByText(`Version ${n}`, { exact: true }).first()).toBeVisible();

test("edit → preview → apply → undo", async ({ page }) => {
  await signIn(page);
  await version(page, 1);

  // Panel edit: SQL weight 2 → 5.
  await page.getByLabel("Criterion 2 weight").fill("5");
  await page.getByRole("button", { name: "Review changes" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Criterion 'SQL' · weight")).toBeVisible();
  await expect(dialog.getByText("Update criterion c2: weight → 5")).toBeVisible();
  await shot(page, "diff-dialog");
  await dialog.getByRole("button", { name: "Apply changes" }).click();
  await expect(page.getByText("Saved as version 2.")).toBeVisible();
  await version(page, 2);

  // Canvas toggle: skip the quiz.
  await page.getByRole("switch", { name: "Disable Quiz" }).click();
  await expect(dialog.getByText("Disable the quiz step")).toBeVisible();
  await dialog.getByRole("button", { name: "Apply changes" }).click();
  await version(page, 3);
  await expect(page.getByTestId("stage-quiz").getByText("Skipped")).toBeVisible();

  // Only the latest save's toast is shown; its Undo restores version 2's definition as version 4.
  const toasts = page.locator("[data-sonner-toast]");
  await expect(toasts).toHaveCount(1);
  await toasts.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Restored the previous version (now version 4).")).toBeVisible();
  await version(page, 4);
  await expect(page.getByTestId("stage-quiz").getByText("Skipped")).toHaveCount(0);
  await expect(page.getByLabel("Criterion 2 weight")).toHaveValue("5");
  await page.getByTestId("stage-quiz").click();
  await shot(page, "editor-quiz-panel");

  await page.getByRole("button", { name: "Edit by chat" }).click();
  await expect(page.getByRole("button", { name: "Skip the quiz" })).toBeVisible();
  await shot(page, "chat-drawer");
  await page.keyboard.press("Escape");
});

test("a stale edit opens the conflict dialog and re-previews against the latest version", async ({ page, request }) => {
  await signIn(page);
  const before = await (await request.get(`${API}/v1/manager/jobs/${jobId}/workflow`, { headers: { Authorization: `Bearer ${token}` } })).json();

  await page.getByLabel("Criterion 1 weight").fill("4");

  // Someone else saves a new version while the panel is open.
  const res = await request.post(`${API}/v1/manager/jobs/${jobId}/workflow/apply`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { base_version: before.version, patches: [{ op: "set_notify", value: false }], source: "panel" },
  });
  expect(res.ok()).toBeTruthy();

  await page.getByRole("button", { name: "Review changes" }).click();
  await expect(page.getByRole("heading", { name: "The pipeline changed" })).toBeVisible();
  await page.getByRole("button", { name: "Review against latest" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Update criterion c1: weight → 4")).toBeVisible();
  await dialog.getByRole("button", { name: "Apply changes" }).click();
  await expect(page.getByText(`Saved as version ${before.version + 2}.`)).toBeVisible();
});
