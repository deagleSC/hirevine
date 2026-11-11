/**
 * Phase 6 exit check (frontend plan §12): the quiz resumes after a forced reload, and auto-submits
 * at the deadline. Runs in the candidate app (:3200) as the test candidate; skipped unless
 * E2E_CANDIDATE_EMAIL / E2E_CANDIDATE_PASSWORD are set in .env.e2e.local.
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

const QUESTIONS = [
  { id: "q1", prompt: "Which hook memoizes a computed value?", options: ["useMemo", "useRef", "useId"], answer_index: 0, explanation: "", difficulty: "easy" },
  { id: "q2", prompt: "Which SQL clause filters groups?", options: ["WHERE", "HAVING", "LIMIT"], answer_index: 1, explanation: "", difficulty: "medium" },
  { id: "q3", prompt: "What does HTTP 409 mean?", options: ["Conflict", "Gone", "Too many requests"], answer_index: 0, explanation: "", difficulty: "easy" },
];

test.skip(!process.env.E2E_CANDIDATE_EMAIL || !process.env.E2E_CANDIDATE_PASSWORD,
  "Set E2E_CANDIDATE_EMAIL and E2E_CANDIDATE_PASSWORD to run candidate-app specs");

test("the quiz resumes after a reload and auto-submits at the deadline", async ({ page }) => {
  const { orgId, candidateId } = JSON.parse(readFileSync(STATE, "utf8")) as { orgId: string; candidateId: string };
  const workflow = {
    schema_version: 1,
    nodes: [
      { type: "screening", id: "screening", config: { cutoff: 60, criteria: [{ id: "c1", name: "React", weight: 5, must_have: true }] } },
      { type: "quiz", id: "quiz", enabled: true, config: { pass_mark: 60, time_limit_min: 10, questions: QUESTIONS } },
      { type: "final", id: "final", config: { notify_on_complete: true, ranking: "weighted_mean" } },
    ],
    edges: [["screening", "quiz"], ["quiz", "final"]],
  };
  const appId = sql(
    `with j as (insert into jobs (org_id, title, location, seniority, status)
              values (:'org', 'Quiz Engineer', 'Remote', 'mid', 'published') returning id),
w as (insert into workflows (job_id, version, definition) select id, 1, :'wf'::jsonb from j returning id, job_id),
c as (insert into campaigns (job_id, workflow_id, status) select job_id, id, 'open' from w returning id, workflow_id),
a as (insert into applications (campaign_id, candidate_id, workflow_id, current_node, resume_path, consent_at)
      select id, :'cand', workflow_id, 'quiz', :'cand' || '/x.pdf', now() from c returning id)
select id from a;`,
    { org: orgId, cand: candidateId, wf: JSON.stringify(workflow) },
  );
  sql(`insert into stage_results (application_id, node_id, status, score) values
       (:'app', 'screening', 'passed', 80), (:'app', 'quiz', 'pending', null);`, { app: appId });

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${CANDIDATE_APP}/sign-in?next=${encodeURIComponent(`/applications/${appId}/quiz`)}`);
  await page.getByLabel("Email").fill(process.env.E2E_CANDIDATE_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_CANDIDATE_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Before you start")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("3 multiple-choice questions")).toBeVisible();

  await page.getByRole("button", { name: "Start quiz" }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  await page.getByRole("radio", { name: "useMemo" }).click();
  await page.getByRole("radio", { name: "WHERE" }).click();
  await expect(page.getByText("Saved")).toBeVisible();
  const deadline = sql(`select deadline_at from quiz_attempts where application_id = :'app'`, { app: appId });

  // Forced reload: same attempt, same deadline, saved answers restored.
  await page.reload();
  await expect(page.getByRole("radio", { name: "useMemo" })).toBeChecked({ timeout: 30_000 });
  await expect(page.getByRole("radio", { name: "WHERE" })).toBeChecked();
  await expect(page.getByText("2 of 3 answered")).toBeVisible();
  expect(sql(`select deadline_at from quiz_attempts where application_id = :'app'`, { app: appId })).toBe(deadline);
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/candidate-quiz.png`, fullPage: true });

  // The deadline arrives (moved to 4 s from now); the page flushes the pending answer and submits itself.
  sql(`update quiz_attempts set deadline_at = now() + interval '4 seconds' where application_id = :'app'`, { app: appId });
  await page.reload();
  await page.getByRole("radio", { name: "Conflict" }).click();
  await expect(page.getByText("Answers submitted")).toBeVisible({ timeout: 20_000 });
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/candidate-quiz-done.png`, fullPage: true });

  // Graded on the server: q1 and q3 right, q2 wrong → 66.7 ≥ 60.
  expect(sql(`select score || ' ' || (submitted_at is not null) from quiz_attempts where application_id = :'app'`, { app: appId }))
    .toBe("66.7 true");
  expect(sql(`select status from stage_results where application_id = :'app' and node_id = 'quiz'`, { app: appId })).toBe("passed");
  // The candidate never sees the score.
  await expect(page.getByText("66.7")).toHaveCount(0);
  expect(errors).toEqual([]);
});
