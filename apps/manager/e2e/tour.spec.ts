/**
 * Visual tour: screenshots every route of both apps at desktop and phone widths, for layout review.
 * Run after specs that seed data, e.g.
 *   UI_TOUR=/tmp/shots npx playwright test journey release candidate-quiz candidate-interview tour --project=chromium
 * Also checks that no page scrolls horizontally on a phone.
 */
import { execFileSync } from "node:child_process";

import { expect, test, type Browser } from "@playwright/test";

const DB = "hirevine_e2e";
const MANAGER = "http://localhost:3100";
const CANDIDATE = "http://localhost:3200";
const OUT = process.env.UI_TOUR;

test.skip(!OUT || !process.env.E2E_CANDIDATE_EMAIL, "Set UI_TOUR=<dir> and a candidate account to run the tour");

function sql(q: string): string[] {
  return execFileSync("psql", ["-X", "-q", "-At", "-h", "localhost", "-d", DB], { encoding: "utf8", input: q })
    .trim().split("\n").filter(Boolean);
}

const SIZES = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } } as const;

async function tour(browser: Browser, base: string, email: string, password: string, prefix: string, routes: [string, string][]) {
  const overflow: string[] = [];
  for (const [size, viewport] of Object.entries(SIZES)) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    await page.goto(`${base}/sign-in`);
    await page.screenshot({ path: `${OUT}/${prefix}-sign-in-${size}.png`, fullPage: true });
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
    for (const [name, route] of routes) {
      await page.goto(`${base}${route}`);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${prefix}-${name}-${size}.png`, fullPage: true });
      if (size === "phone") {
        const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (wide > 1) overflow.push(`${prefix} ${name}: ${wide}px`);
      }
    }
    await ctx.close();
  }
  return overflow;
}

test("tour every view", async ({ browser }) => {
  test.setTimeout(300_000);
  const [campaign] = sql("select id from campaigns order by created_at desc limit 1");
  const [job] = sql(`select job_id from campaigns where id = '${campaign}'`);
  const [app] = sql(`select a.id from applications a join profiles p on p.id = a.candidate_id
                     where p.role = 'candidate' order by a.created_at desc limit 1`);
  const pub = sql("select id from jobs where status = 'published' order by created_at limit 1")[0] ?? job;
  const [campApp] = sql(`select id from applications where campaign_id = '${campaign}' limit 1`);
  const quizApp = sql("select application_id from quiz_attempts limit 1")[0] ?? app;
  const ivApp = sql("select application_id from interview_sessions limit 1")[0] ?? app;

  const managerOverflow = await tour(browser, MANAGER, process.env.E2E_MANAGER_EMAIL!, process.env.E2E_MANAGER_PASSWORD!, "m", [
    ["home", "/"],
    ["analytics", "/analytics"],
    ["new-job", "/jobs/new"],
    ["workflow", `/jobs/${job}/workflow`],
    ["campaign", `/campaigns/${campaign}`],
    ["campaign-analytics", `/campaigns/${campaign}/analytics`],
    ["candidate", `/campaigns/${campaign}/candidates/${campApp}`],
    ["final", `/campaigns/${campaign}/final`],
  ]);
  const candidateOverflow = await tour(browser, CANDIDATE, process.env.E2E_CANDIDATE_EMAIL!, process.env.E2E_CANDIDATE_PASSWORD!, "c", [
    ["jobs", "/jobs"],
    ["job", `/jobs/${pub}`],
    ["apply", `/apply/${pub}`],
    ["applications", "/applications"],
    ["application", `/applications/${app}`],
    ["quiz", `/applications/${quizApp}/quiz`],
    ["interview", `/applications/${ivApp}/interview`],
    ["feedback", `/applications/${app}/feedback`],
    ["analytics", "/analytics"],
    ["account", "/account"],
    ["privacy", "/privacy"],
  ]);
  expect([...managerOverflow, ...candidateOverflow]).toEqual([]);
});
