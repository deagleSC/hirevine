/**
 * Phase 6 (manager side): generating questions runs in the background and reports back, and a
 * submitted attempt shows per-question results on the candidate page. The candidate's runner is
 * covered by packages/ui/test/quiz-runner.test.tsx (resume after reload, auto-submit at the deadline).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { STATE } from "./global-setup";

const DB = "hirevine_e2e";
const { jobId } = JSON.parse(readFileSync(STATE, "utf8")) as { jobId: string };

function sql(input: string, vars: Record<string, string> = {}): string {
  const args = ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-h", "localhost", "-d", DB];
  for (const [k, v] of Object.entries(vars)) args.push("-v", `${k}=${v}`);
  return execFileSync("psql", args, { encoding: "utf8", input }).trim();
}

async function signIn(page: Page, next: string) {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(process.env.E2E_MANAGER_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_MANAGER_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("generate questions: the run is polled until the questions arrive", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, `/jobs/${jobId}/workflow`);
  await expect(page.getByRole("heading", { name: "Frontend Engineer" })).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("stage-quiz").click();
  await expect(page.getByText("Generate from the job and rubric")).toBeVisible();
  await page.getByLabel("Questions", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Generate questions" }).click();

  // The job runs in the background (inline in e2e, against the fake model) and reports back.
  await expect(page.getByText(/Added 5 questions \(version \d+\)/)).toBeVisible({ timeout: 30_000 });
  const run = sql(`select params->>'count' || ' ' || (params->>'difficulty') || ' ' || status from job_runs
                   where job_id = :'job' and type = 'quiz_generate' order by created_at desc limit 1`, { job: jobId });
  expect(run).toBe("5 mixed done");
  await expect(page.getByRole("group", { name: "Questions (5)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate questions" })).toBeEnabled();
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/quiz-generate.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test("a submitted quiz shows per-question results", async ({ page }) => {
  const candidate = crypto.randomUUID();
  const results = [
    { question_id: "q1", prompt: "What does useMemo cache?", options: ["A computed value", "A DOM node", "A network response"],
      chosen: 0, answer_index: 0, correct: true, explanation: "useMemo caches a computed value between renders." },
    { question_id: "q2", prompt: "Which SQL clause filters groups?", options: ["WHERE", "HAVING", "ORDER BY"],
      chosen: 0, answer_index: 1, correct: false, explanation: "HAVING filters after GROUP BY." },
  ];
  const ids = sql(
    `update jobs set status = 'published' where id = :'job';
insert into auth.users (id, email) values (:'cand', :'cand' || '@e2e.test');
insert into profiles (id, role, display_name, adult_confirmed) values (:'cand', 'candidate', 'Quinn Quiz', true);
insert into campaigns (job_id, workflow_id, status)
  select :'job', id, 'open' from workflows where job_id = :'job'
  and not exists (select 1 from campaigns where job_id = :'job' and status = 'open')
  order by version desc limit 1;
with a as (insert into applications (campaign_id, candidate_id, workflow_id, current_node, resume_path, consent_at)
      select c.id, :'cand', c.workflow_id, 'final', :'cand' || '/x.pdf', now()
      from campaigns c where c.job_id = :'job' and c.status = 'open'
      order by c.created_at limit 1 returning id, campaign_id)
select campaign_id || ' ' || id from a;`,
    { job: jobId, cand: candidate },
  );
  const [campaignId, appId] = ids.split(" ") as [string, string];
  sql(
    `insert into stage_results (application_id, node_id, status, score) values (:'app', 'screening', 'passed', 80);
insert into stage_results (application_id, node_id, status, score, evidence) values (:'app', 'quiz', 'failed', 50, :'ev'::jsonb);
insert into quiz_attempts (application_id, questions_snapshot, answers, score, deadline_at, submitted_at)
values (:'app', '[]', '{"q1": 0, "q2": 0}', 50, now(), now());`,
    { app: appId, ev: JSON.stringify(results) },
  );

  await signIn(page, `/campaigns/${campaignId}/candidates/${appId}`);
  await expect(page.getByText("Quiz", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("50%")).toBeVisible();
  await expect(page.getByText("Correct", { exact: true })).toBeVisible();
  await expect(page.getByText("Incorrect", { exact: true })).toBeVisible();
  await expect(page.getByText("HAVING filters after GROUP BY.")).toBeVisible();
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/quiz-results.png`, fullPage: true });
});
