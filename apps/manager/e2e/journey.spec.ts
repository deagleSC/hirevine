/**
 * Phase 9 exit check (backend plan §21, frontend plan §12): one run from job creation to released
 * feedback, through the real UI and the real pipeline. Background jobs run inline in the API
 * (JOB_DISPATCHER=inline), the model is the fake OpenRouter, uploads go to the API's dev store.
 *
 *   manager: job chat → create → publish
 *   candidate: browse → apply with a resume (upload) → screened → reaches the final list
 *   manager: the AI draft arrives → complete (typed title)
 *   candidate: notification → feedback with the cited resume lines
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

const DB = "hirevine_e2e";
const CANDIDATE_APP = "http://localhost:3200";
const TITLE = "E2E Backend Engineer";

function sql(input: string, vars: Record<string, string> = {}): string {
  const args = ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-h", "localhost", "-d", DB];
  for (const [k, v] of Object.entries(vars)) args.push("-v", `${k}=${v}`);
  return execFileSync("psql", args, { encoding: "utf8", input }).trim();
}

async function signIn(page: Page, base: string, next: string, email: string, password: string) {
  await page.goto(`${base}/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** A text PDF the parser can read, made with the API's own PDF library. */
function resumePdf(): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "hv-e2e-")), "resume.pdf");
  const text = [
    "Jordan Example - Backend Engineer",
    "jordan@example.com, +1 555 0100",
    "Experience",
    "Senior Engineer, Ledgerly 2019-2025",
    "Built Python services on PostgreSQL handling 2k requests per second.",
    "Designed PostgreSQL schemas and tuned slow queries with indexes.",
    "Skills: Python, PostgreSQL, Docker, Git",
  ].join("\n");
  execFileSync("uv", ["run", "python", "-c",
    "import sys,pymupdf;d=pymupdf.open();p=d.new_page();p.insert_text((50,60),sys.argv[2],fontsize=11);d.save(sys.argv[1])",
    file, text], { cwd: path.resolve(__dirname, "../../api") });
  return file;
}

test.skip(!process.env.E2E_CANDIDATE_EMAIL || !process.env.E2E_CANDIDATE_PASSWORD,
  "Set E2E_CANDIDATE_EMAIL and E2E_CANDIDATE_PASSWORD to run candidate-app specs");

test("from job creation to released feedback", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`manager: ${e.message}`));

  // Manager: describe the role, create the job, publish it.
  await signIn(page, "", "/jobs/new", process.env.E2E_MANAGER_EMAIL!, process.env.E2E_MANAGER_PASSWORD!);
  await page.getByLabel("Message").fill("A mid-level backend engineer, remote, strong in Python and PostgreSQL.", { timeout: 60_000 });
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { name: "Create job and open editor" }).click({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]+\/workflow/, { timeout: 30_000 });
  await page.getByRole("button", { name: "Publish" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Candidates can apply now.")).toBeVisible({ timeout: 15_000 });
  const jobId = page.url().match(/jobs\/([0-9a-f-]+)\/workflow/)![1]!;
  const campaignId = sql(`select id from campaigns where job_id = :'job'`, { job: jobId });

  // Candidate: find the job and apply with a resume.
  const cand = await (await browser.newContext()).newPage();
  cand.on("pageerror", (e) => errors.push(`candidate: ${e.message}`));
  await signIn(cand, CANDIDATE_APP, "/jobs", process.env.E2E_CANDIDATE_EMAIL!, process.env.E2E_CANDIDATE_PASSWORD!);
  await cand.getByRole("link", { name: TITLE }).first().click({ timeout: 60_000 });
  await cand.getByRole("link", { name: "Apply" }).click();
  await cand.locator('input[type="file"]').setInputFiles(resumePdf());
  await expect(cand.getByText("Resume uploaded")).toBeVisible({ timeout: 30_000 });
  await cand.getByLabel("I agree to my application being assessed as described above.").check();
  await cand.getByLabel("I confirm I am 18 or older.").check();
  await cand.getByRole("button", { name: "Submit application" }).click();
  await expect(cand).toHaveURL(/\/applications$/, { timeout: 30_000 });
  const appId = sql(`select a.id from applications a join campaigns c on c.id = a.campaign_id where c.job_id = :'job'`,
    { job: jobId });

  // The pipeline runs: screening passes, the application reaches the final list, a draft is written.
  await expect.poll(() => sql(`select status from stage_results where application_id = :'app' and node_id = 'screening'`,
    { app: appId }), { timeout: 60_000 }).toBe("passed");
  await expect.poll(() => sql(`select coalesce(ai_draft, '') <> '' from feedback where application_id = :'app'`,
    { app: appId }), { timeout: 60_000 }).toBe("t");

  // Manager: the finalist is ranked with an AI draft; complete the campaign.
  await page.goto(`/campaigns/${campaignId}/final`);
  const row = page.getByTestId(`final-row-${appId}`);
  await expect(row.getByText("AI draft")).toBeVisible({ timeout: 30_000 });
  await expect(row.getByRole("cell").nth(1)).toHaveText("1");
  await page.getByRole("button", { name: "Complete campaign" }).click();
  await page.getByLabel(/to confirm/).fill(TITLE);
  await page.getByRole("button", { name: /Complete and release/ }).click();
  await expect(page.getByText(/^Released on/)).toBeVisible({ timeout: 15_000 });

  // Candidate: notified, and the feedback shows the outcome and the cited resume lines.
  await cand.goto(`${CANDIDATE_APP}/account`);
  const note = cand.getByRole("link", { name: `The outcome for ${TITLE} is ready.` });
  await expect(note).toBeVisible({ timeout: 30_000 });
  await note.click();
  await expect(cand.getByText("Shortlisted")).toBeVisible({ timeout: 30_000 });
  await expect(cand.getByText(/Your Python and PostgreSQL experience came through clearly/)).toBeVisible();
  await expect(cand.getByText("From your resume")).toBeVisible();
  await expect(cand.getByText(/Built Python services on PostgreSQL/).first()).toBeVisible();
  // Redacted before any model saw it: the email, the phone, and the name on a line shared with a title.
  await expect(cand.getByText("jordan@example.com")).toHaveCount(0);
  await expect(cand.getByText(/\+1 555 0100/)).toHaveCount(0);
  await expect(cand.getByText(/Jordan Example/)).toHaveCount(0);
  await expect(cand.getByText("[NAME] - Backend Engineer")).toBeVisible();
  if (process.env.E2E_SHOTS) await cand.screenshot({ path: `${process.env.E2E_SHOTS}/journey-feedback.png`, fullPage: true });
  expect(errors).toEqual([]);
});
