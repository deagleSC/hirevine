/**
 * Phase 7 exit check (frontend plan §12): a reconnect in the middle of the interview restores the
 * transcript and the remaining turns. Runs in the candidate app (:3200) as the test candidate, with
 * questions streamed by the fake OpenRouter (apps/api/scripts/fake_openrouter.py, slow chunks).
 * Skipped unless E2E_CANDIDATE_EMAIL / E2E_CANDIDATE_PASSWORD are set in .env.e2e.local.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { STATE } from "./global-setup";

const DB = "hirevine_e2e";
const CANDIDATE_APP = "http://localhost:3200";

function sql(input: string, vars: Record<string, string> = {}): string {
  const args = ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-h", "localhost", "-d", DB];
  for (const [k, v] of Object.entries(vars)) args.push("-v", `${k}=${v}`);
  return execFileSync("psql", args, { encoding: "utf8", input }).trim();
}

test.skip(!process.env.E2E_CANDIDATE_EMAIL || !process.env.E2E_CANDIDATE_PASSWORD,
  "Set E2E_CANDIDATE_EMAIL and E2E_CANDIDATE_PASSWORD to run candidate-app specs");

test("a reconnect mid-interview restores the transcript and remaining turns", async ({ page }) => {
  const { orgId, candidateId } = JSON.parse(readFileSync(STATE, "utf8")) as { orgId: string; candidateId: string };
  const workflow = {
    schema_version: 1,
    nodes: [
      { type: "screening", id: "screening", config: { cutoff: 60, criteria: [{ id: "c1", name: "Python", weight: 5, must_have: true }] } },
      { type: "interview", id: "interview", enabled: true, config: {
        prompt_additions: "", themes: ["APIs", "Testing"], turn_cap: 3, pass_threshold: 60,
        rubric: [{ id: "r1", name: "System design", weight: 3, description: "" }, { id: "r2", name: "Testing", weight: 1, description: "" }],
      } },
      { type: "final", id: "final", config: { notify_on_complete: true, ranking: "weighted_mean" } },
    ],
    edges: [["screening", "interview"], ["interview", "final"]],
  };
  const appId = sql(
    `with j as (insert into jobs (org_id, title, location, seniority, status)
              values (:'org', 'Interview Engineer', 'Remote', 'mid', 'published') returning id),
w as (insert into workflows (job_id, version, definition) select id, 1, :'wf'::jsonb from j returning id, job_id),
c as (insert into campaigns (job_id, workflow_id, status) select job_id, id, 'open' from w returning id, workflow_id),
a as (insert into applications (campaign_id, candidate_id, workflow_id, current_node, resume_path, consent_at)
      select id, :'cand', workflow_id, 'interview', :'cand' || '/i.pdf', now() from c returning id)
select id from a;`,
    { org: orgId, cand: candidateId, wf: JSON.stringify(workflow) },
  );
  sql(`insert into stage_results (application_id, node_id, status, score) values
       (:'app', 'screening', 'passed', 80), (:'app', 'interview', 'pending', null);`, { app: appId });
  const transcriptLength = () => sql(`select jsonb_array_length(transcript) from interview_sessions where application_id = :'app'`, { app: appId });

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${CANDIDATE_APP}/sign-in?next=${encodeURIComponent(`/applications/${appId}/interview`)}`);
  await page.getByLabel("Email").fill(process.env.E2E_CANDIDATE_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_CANDIDATE_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("This interview is conducted by an AI", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("3 questions, one at a time")).toBeVisible();
  await expect(page.getByText(/assessed on: System design, Testing/)).toBeVisible();

  // Start: the first question streams in.
  await page.getByRole("button", { name: "Start interview" }).click();
  await expect(page.getByText("Question 1: tell me about a project where you used this skill?")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Question 1 of 3")).toBeVisible();
  const deadline = sql(`select deadline_at from interview_sessions where application_id = :'app'`, { app: appId });

  // Answer, and reload while question 2 is still streaming.
  await page.getByLabel("Your answer").fill("I built a FastAPI service with a Postgres ledger.");
  await page.getByRole("button", { name: /Send answer/ }).click();
  await expect(page.getByText(/^Question 2:/)).toBeVisible();
  await expect(page.getByText("Question 2: tell me about a project where you used this skill?")).toHaveCount(0);
  await page.reload();

  // Restored: the saved answer, the counter and the clock; the interrupted question is asked again, once.
  await expect(page.getByText("I built a FastAPI service with a Postgres ledger.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Question 2: tell me about a project where you used this skill?")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Question 2 of 3")).toBeVisible();
  await expect(page.getByLabel("Your answer")).toBeEnabled();
  expect(sql(`select deadline_at from interview_sessions where application_id = :'app'`, { app: appId })).toBe(deadline);
  expect(transcriptLength()).toBe("3"); // Q1, A1, Q2: the interrupted stream stored nothing twice
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/candidate-interview.png`, fullPage: true });

  // Finish the remaining turns; the last answer ends the interview.
  await page.getByLabel("Your answer").fill("Pytest against a real database, plus contract tests.");
  await page.getByRole("button", { name: /Send answer/ }).click();
  await expect(page.getByText("Question 3: tell me about a project where you used this skill?")).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Your answer").fill("I would add rate limiting and better tracing.");
  await page.getByRole("button", { name: /Send answer/ }).click();
  await expect(page.getByText("Thanks. Your responses are being reviewed.")).toBeVisible({ timeout: 20_000 });
  expect(sql(`select turn_count || ' ' || (finished_at is not null) from interview_sessions where application_id = :'app'`, { app: appId }))
    .toBe("3 true");
  expect(transcriptLength()).toBe("6");
  expect(errors).toEqual([]);
});
