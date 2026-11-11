/**
 * Phase 10 exit check (frontend plan §12): dashboard numbers match hand-computed values on a fixed
 * synthetic campaign (apps/api/scripts/seed_analytics.py, whose EXPECTED block lists them).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Locator } from "@playwright/test";

import { STATE } from "./global-setup";

const DB = "hirevine_e2e";

async function tableOf(card: Locator): Promise<string[][]> {
  await card.getByRole("button", { name: "Show table" }).click();
  const rows = card.locator("tbody tr");
  const out: string[][] = [];
  for (let i = 0; i < (await rows.count()); i++) out.push(await rows.nth(i).locator("td").allInnerTexts());
  return out;
}

test("campaign analytics match the hand-computed values", async ({ page }) => {
  const { orgId } = JSON.parse(readFileSync(STATE, "utf8")) as { orgId: string };
  const campaignId = execFileSync("uv", ["run", "python", "scripts/seed_analytics.py", DB, orgId], {
    cwd: path.resolve(__dirname, "../../api"), encoding: "utf8",
  }).trim().split("\n").pop()!;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(`/sign-in?next=${encodeURIComponent(`/campaigns/${campaignId}/analytics`)}`);
  await page.getByLabel("Email").fill(process.env.E2E_MANAGER_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_MANAGER_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Analytics Seed Role — analytics")).toBeVisible({ timeout: 60_000 });
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/analytics-campaign.png`, fullPage: true });

  const kpis = page.getByTestId("kpis");
  await expect(kpis).toContainText("Applications10");
  await expect(kpis).toContainText("Passed screening5 of 10");
  await expect(kpis).toContainText("AI drafts sent unedited67%");
  await expect(kpis).toContainText("of 6 released drafts");
  await expect(kpis).toContainText("Agreed with AI suggestion60%");

  const card = (title: string) => page.locator('[data-slot="card"]').filter({ has: page.getByText(title, { exact: true }) });
  expect(await tableOf(card("Funnel"))).toEqual([
    ["Screening", "10", "5", "4", "1", "0", "—"],
    ["Quiz", "5", "2", "1", "0", "2", "50%"],
    ["Final list", "2", "0", "0", "0", "2", "60%"],
  ]);
  expect((await tableOf(card("Screening scores"))).map((r) => r[1])).toEqual(["0", "0", "0", "1", "1", "2", "2", "1", "1", "1"]);
  expect((await tableOf(card("Quiz scores"))).map((r) => r[1])).toEqual(["0", "0", "0", "0", "0", "1", "0", "1", "0", "1"]);
  const impact = await card("Cutoff impact").locator("tbody tr").allInnerTexts();
  expect(impact.map((r) => r.split("\t").map((c) => c.trim()))).toEqual([
    ["50 (-10)", "7"], ["55 (-5)", "6"], ["60 (current)", "5"], ["65 (+5)", "4"], ["70 (+10)", "3"],
  ]);
  expect(await tableOf(card("Time per stage"))).toEqual([["Screening", "2.0 h", "9"], ["Quiz", "3.0 h", "3"]]);
  await expect(card("AI usage")).toContainText("model-a8");

  // The overview includes the seeded campaign (other specs add their own jobs, so only stable numbers).
  await page.goto("/analytics");
  await expect(page.getByText("Time to shortlist")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("8.1 days")).toBeVisible(); // 195 h, the only completed campaign
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/analytics-overview.png`, fullPage: true });
  expect(errors).toEqual([]);
});
