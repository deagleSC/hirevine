/**
 * Phase 8 exit check (frontend plan §12): the candidate's feedback page shows "not available yet"
 * until the manager completes the campaign; completing (typed title) releases the edited feedback.
 * The candidate half runs in the candidate app (:3200), so this is skipped without a candidate account.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { STATE } from "./global-setup";

const DB = "hirevine_e2e";
const CANDIDATE_APP = "http://localhost:3200";

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

test.skip(!process.env.E2E_CANDIDATE_EMAIL || !process.env.E2E_CANDIDATE_PASSWORD,
  "Set E2E_CANDIDATE_EMAIL and E2E_CANDIDATE_PASSWORD to run candidate-app specs");

test("feedback stays hidden until the campaign is completed, then the edited text is released", async ({ page, browser }) => {
  const { orgId, candidateId } = JSON.parse(readFileSync(STATE, "utf8")) as { orgId: string; candidateId: string };
  const workflow = {
    schema_version: 1,
    nodes: [
      { type: "screening", id: "screening", config: { cutoff: 60, criteria: [{ id: "c1", name: "Python", weight: 5, must_have: true }] } },
      { type: "final", id: "final", config: { notify_on_complete: true, ranking: "weighted_mean" } },
    ],
    edges: [["screening", "final"]],
  };
  const other = crypto.randomUUID();
  const ids = sql(
    `insert into auth.users (id, email) values (:'other', :'other' || '@e2e.test');
insert into profiles (id, role, display_name, adult_confirmed) values (:'other', 'candidate', 'Otto Other', true);
with j as (insert into jobs (org_id, title, location, seniority, status)
              values (:'org', 'Release Role', 'Remote', 'mid', 'published') returning id),
w as (insert into workflows (job_id, version, definition) select id, 1, :'wf'::jsonb from j returning id, job_id),
c as (insert into campaigns (job_id, workflow_id, status) select job_id, id, 'open' from w returning id, workflow_id),
a as (insert into applications (campaign_id, candidate_id, workflow_id, current_node, resume_path, consent_at)
      select id, :'cand', workflow_id, 'final', :'cand' || '/r.pdf', now() from c returning id, campaign_id),
b as (insert into applications (campaign_id, candidate_id, workflow_id, current_node, resume_path, consent_at)
      select id, :'other', workflow_id, 'screening', :'other' || '/r.pdf', now() from c returning id)
select a.campaign_id || ' ' || a.id || ' ' || b.id from a, b;`,
    { org: orgId, cand: candidateId, other, wf: JSON.stringify(workflow) },
  );
  const [campaignId, appId, otherApp] = ids.split(" ") as [string, string, string];
  sql(
    `insert into stage_results (application_id, node_id, status, score) values
       (:'app', 'screening', 'passed', 86), (:'app', 'final', 'pending', null), (:'oth', 'screening', 'failed', 31);
insert into feedback (application_id, ai_draft, ai_recommendation)
  values (:'app', 'Thank you for applying. Your Python services work stood out.', 'yes');`,
    { app: appId, oth: otherApp },
  );

  // Candidate, before release: not available yet.
  const candidate = await (await browser.newContext()).newPage();
  await signIn(candidate, CANDIDATE_APP, `/applications/${appId}/feedback`, process.env.E2E_CANDIDATE_EMAIL!,
    process.env.E2E_CANDIDATE_PASSWORD!);
  await expect(candidate.getByText("Feedback is not available yet.")).toBeVisible({ timeout: 60_000 });

  // Manager: the final list ranks the finalist first; edit the feedback (autosaves).
  await signIn(page, "", `/campaigns/${campaignId}/final`, process.env.E2E_MANAGER_EMAIL!, process.env.E2E_MANAGER_PASSWORD!);
  await expect(page.getByText("Release Role — final list")).toBeVisible({ timeout: 60_000 });
  const first = page.getByTestId(`final-row-${appId}`);
  await expect(first.getByRole("cell").nth(1)).toHaveText("1");
  await expect(first.getByText("Suggested:")).toBeVisible();
  await expect(page.getByTestId(`final-row-${otherApp}`).getByText("Stopped")).toBeVisible();
  await first.getByRole("link").click();
  const box = page.getByLabel("Feedback the candidate will see");
  await expect(box).toHaveValue(/Python services work stood out/, { timeout: 30_000 });
  await box.fill("Great work on the Python services. We'd like to talk about next steps.");
  await expect(page.getByText("Saved")).toBeVisible({ timeout: 10_000 });
  expect(sql(`select edited_text from feedback where application_id = :'app'`, { app: appId })).toContain("Great work");

  // Complete: irreversible, so the title must be typed.
  await page.goto(`/campaigns/${campaignId}/final`);
  await page.getByRole("button", { name: "Complete campaign" }).click();
  await expect(page.getByText(/released to all 2 candidates/)).toBeVisible();
  const go = page.getByRole("button", { name: /Complete and release/ });
  await expect(go).toBeDisabled();
  await page.getByLabel(/to confirm/).fill("Release Role");
  await go.click();
  await expect(page.getByText(/^Released on/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Complete campaign" })).toHaveCount(0);
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/final-released.png`, fullPage: true });

  // Candidate, after release: the outcome and the manager's edited text.
  await candidate.reload();
  await expect(candidate.getByText("Shortlisted")).toBeVisible({ timeout: 30_000 });
  await expect(candidate.getByText("Great work on the Python services. We'd like to talk about next steps.")).toBeVisible();
  await expect(candidate.getByText("86%")).toBeVisible();
  if (process.env.E2E_SHOTS) await candidate.screenshot({ path: `${process.env.E2E_SHOTS}/candidate-feedback.png`, fullPage: true });
});
