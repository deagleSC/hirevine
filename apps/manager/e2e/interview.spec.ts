/**
 * Phase 7 (manager side): a scored interview shows rubric scores with turn citations, and a
 * citation selects its turn in the numbered transcript.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { STATE } from "./global-setup";

const DB = "hirevine_e2e";

function sql(input: string, vars: Record<string, string> = {}): string {
  const args = ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-h", "localhost", "-d", DB];
  for (const [k, v] of Object.entries(vars)) args.push("-v", `${k}=${v}`);
  return execFileSync("psql", args, { encoding: "utf8", input }).trim();
}

test("a scored interview shows rubric scores with turn citations", async ({ page }) => {
  const { orgId } = JSON.parse(readFileSync(STATE, "utf8")) as { orgId: string };
  const candidate = crypto.randomUUID();
  const workflow = {
    schema_version: 1,
    nodes: [
      { type: "screening", id: "screening", config: { cutoff: 60, criteria: [{ id: "c1", name: "Python", weight: 5, must_have: true }] } },
      { type: "interview", id: "interview", enabled: true, config: {
        prompt_additions: "", themes: [], turn_cap: 3, pass_threshold: 60,
        rubric: [{ id: "r1", name: "System design", weight: 3, description: "" }, { id: "r2", name: "Testing", weight: 1, description: "" }],
      } },
      { type: "final", id: "final", config: { notify_on_complete: true, ranking: "weighted_mean" } },
    ],
    edges: [["screening", "interview"], ["interview", "final"]],
  };
  const transcript = [
    { role: "interviewer", content: "Tell me about an API you designed.", at: null },
    { role: "candidate", content: "An append-only payments ledger in FastAPI.", at: null },
    { role: "interviewer", content: "How did you test it?", at: null },
    { role: "candidate", content: "Mostly by hand before releases.", at: null },
  ];
  const evidence = [
    { item_id: "r1", name: "System design", weight: 3, score: 3, rationale: "Clear ledger design.", turns: [2], verified: true },
    { item_id: "r2", name: "Testing", weight: 1, score: 0, rationale: "No structured testing.", turns: [], verified: false },
  ];
  const ids = sql(
    `insert into auth.users (id, email) values (:'cand', :'cand' || '@e2e.test');
insert into profiles (id, role, display_name, adult_confirmed) values (:'cand', 'candidate', 'Ivy Interview', true);
with j as (insert into jobs (org_id, title, location, seniority, status)
              values (:'org', 'Scored Interview Role', 'Remote', 'mid', 'published') returning id),
w as (insert into workflows (job_id, version, definition) select id, 1, :'wf'::jsonb from j returning id, job_id),
c as (insert into campaigns (job_id, workflow_id, status) select job_id, id, 'open' from w returning id, workflow_id),
a as (insert into applications (campaign_id, candidate_id, workflow_id, current_node, resume_path, consent_at)
      select id, :'cand', workflow_id, 'interview', :'cand' || '/i.pdf', now() from c returning id, campaign_id)
select campaign_id || ' ' || id from a;`,
    { org: orgId, cand: candidate, wf: JSON.stringify(workflow) },
  );
  const [campaignId, appId] = ids.split(" ") as [string, string];
  sql(
    `insert into stage_results (application_id, node_id, status, score) values (:'app', 'screening', 'passed', 80);
insert into stage_results (application_id, node_id, status, score, evidence, flags)
  values (:'app', 'interview', 'failed', 56.2, :'ev'::jsonb, '{no_evidence}');
insert into interview_sessions (application_id, thread_id, transcript, turn_count, turn_cap, deadline_at, finished_at)
  values (:'app', 't1', :'tr'::jsonb, 2, 3, now(), now());`,
    { app: appId, ev: JSON.stringify(evidence), tr: JSON.stringify(transcript) },
  );

  await page.goto(`/sign-in?next=${encodeURIComponent(`/campaigns/${campaignId}/candidates/${appId}`)}`);
  await page.getByLabel("Email").fill(process.env.E2E_MANAGER_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_MANAGER_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("AI interview", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("56.2%")).toBeVisible();
  await expect(page.getByText("Below threshold")).toBeVisible();
  await expect(page.getByText(/2 of 3 answered/)).toBeVisible();
  await expect(page.getByText("No supporting answer")).toBeVisible();

  await page.getByRole("button", { name: "T2", exact: true }).click();
  await expect(page.locator('[data-turn="2"]')).toHaveAttribute("data-active", "true");
  await expect(page.locator('[data-turn="2"]')).toContainText("An append-only payments ledger in FastAPI.");
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/interview-scores.png`, fullPage: true });
});
