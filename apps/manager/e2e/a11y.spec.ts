/**
 * Accessibility pass (frontend plan §10, Phase 11): axe on the main pages of both apps, failing on
 * serious or critical WCAG 2.1 A/AA violations. Pages are seeded with the analytics campaign so
 * tables, charts and evidence are populated.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { STATE } from "./global-setup";

const DB = "hirevine_e2e";
const CANDIDATE_APP = "http://localhost:3200";

function sql(input: string, vars: Record<string, string> = {}): string {
  const args = ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-h", "localhost", "-d", DB];
  for (const [k, v] of Object.entries(vars)) args.push("-v", `${k}=${v}`);
  return execFileSync("psql", args, { encoding: "utf8", input }).trim();
}

async function audit(page: Page, label: string) {
  const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const bad = res.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${label}: ${v.id} (${v.impact}) ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(bad, bad.join("\n")).toEqual([]);
}

async function signIn(page: Page, base: string, next: string, email: string, password: string) {
  await page.goto(`${base}/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("manager pages have no serious accessibility violations", async ({ page }) => {
  test.setTimeout(180_000);
  const { orgId } = JSON.parse(readFileSync(STATE, "utf8")) as { orgId: string };
  const campaignId = execFileSync("uv", ["run", "python", "scripts/seed_analytics.py", DB, orgId], {
    cwd: path.resolve(__dirname, "../../api"), encoding: "utf8",
  }).trim().split("\n").pop()!;
  const appId = sql(`select id from applications where campaign_id = :'c' order by created_at desc limit 1`, { c: campaignId });

  await signIn(page, "", "/", process.env.E2E_MANAGER_EMAIL!, process.env.E2E_MANAGER_PASSWORD!);
  await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible({ timeout: 60_000 });
  const pages: [string, string, RegExp | string][] = [
    ["jobs", "/", "Jobs"],
    ["campaign", `/campaigns/${campaignId}`, "Analytics Seed Role"],
    ["candidate", `/campaigns/${campaignId}/candidates/${appId}`, "Feedback"],
    ["final list", `/campaigns/${campaignId}/final`, "Ranked by overall score"],
    ["campaign analytics", `/campaigns/${campaignId}/analytics`, "Funnel"],
    ["overview", "/analytics", "Applications per week"],
    ["new job", "/jobs/new", /Describe the role|Start/],
  ];
  for (const [label, url, ready] of pages) {
    await page.goto(url);
    await expect(page.getByText(ready).first()).toBeVisible({ timeout: 30_000 });
    await audit(page, label);
  }
});

test("candidate pages have no serious accessibility violations", async ({ browser }) => {
  test.skip(!process.env.E2E_CANDIDATE_EMAIL, "needs the candidate test account");
  test.setTimeout(180_000);
  const page = await (await browser.newContext()).newPage();
  for (const [label, url, ready] of [
    ["privacy", "/privacy", "Privacy notice"],
    ["ai evaluation", "/ai-evaluation", "How AI evaluation works"],
    ["sign in", "/sign-in", "Sign in"],
  ] as const) {
    await page.goto(`${CANDIDATE_APP}${url}`);
    await expect(page.getByText(ready).first()).toBeVisible({ timeout: 60_000 });
    await audit(page, label);
  }
  await signIn(page, CANDIDATE_APP, "/jobs", process.env.E2E_CANDIDATE_EMAIL!, process.env.E2E_CANDIDATE_PASSWORD!);
  for (const [label, url, ready] of [
    ["jobs", "/jobs", "Browse jobs"],
    ["applications", "/applications", "My applications"],
    ["account", "/account", "Download your data"],
    ["my analytics", "/analytics", "My analytics"],
  ] as const) {
    await page.goto(`${CANDIDATE_APP}${url}`);
    await expect(page.getByText(ready).first()).toBeVisible({ timeout: 60_000 });
    await audit(page, label);
  }
});
