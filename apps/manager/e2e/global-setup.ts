/** Fresh e2e database, the test manager's profile, and one job with a known workflow. */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const API = "http://127.0.0.1:8100";
const DB = "hirevine_e2e";
const API_DIR = path.resolve(__dirname, "../../api");
export const STATE = path.resolve(__dirname, ".state.json");

export const WORKFLOW = {
  schema_version: 1,
  nodes: [
    { type: "screening", id: "screening", config: { cutoff: 60, criteria: [
      { id: "c1", name: "React", weight: 5, must_have: true },
      { id: "c2", name: "SQL", weight: 2, must_have: false },
    ] } },
    { type: "quiz", id: "quiz", enabled: true, config: { pass_mark: 60, time_limit_min: 20, questions: [] } },
    { type: "final", id: "final", config: { notify_on_complete: true, ranking: "weighted_mean" } },
  ],
  edges: [["screening", "quiz"], ["quiz", "final"]],
};

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (apps/manager/.env.e2e.local)`);
  return v;
}

async function signIn(): Promise<{ token: string; userId: string }> {
  const local = Object.fromEntries(
    readFileSync(path.resolve(__dirname, "../.env.local"), "utf8").split("\n").filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
  );
  const res = await fetch(`${local.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: local.NEXT_PUBLIC_SUPABASE_ANON_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ email: env("E2E_MANAGER_EMAIL"), password: env("E2E_MANAGER_PASSWORD") }),
  });
  if (!res.ok) throw new Error(`Supabase sign-in failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token: string; user: { id: string } };
  return { token: body.access_token, userId: body.user.id };
}


export default async function globalSetup() {
  execFileSync("uv", ["run", "python", "scripts/db_local.py", "reset", DB], { cwd: API_DIR, stdio: "inherit" });
  const { token, userId } = await signIn();
  // The local database has a stand-in auth.users table; mirror the real Supabase user into it.
  execFileSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", "localhost", "-d", DB, "-v", `uid=${userId}`,
    "-v", `email=${env("E2E_MANAGER_EMAIL")}`], { input: "insert into auth.users (id, email) values (:'uid', :'email');" });
  const me = await fetch(`${API}/v1/me/profile`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "manager", display_name: "Test Manager", org_name: "Test Org", adult_confirmed: true }),
  });
  if (!me.ok) throw new Error(`profile: ${me.status} ${await me.text()}`);
  const { org_id } = (await me.json()) as { org_id: string };
  // psql -c does not interpolate :vars, so pipe the statement through stdin instead.
  const jobId = execFileSync(
    "psql",
    ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-h", "localhost", "-d", DB, "-v", `org=${org_id}`, "-v", `wf=${JSON.stringify(WORKFLOW)}`],
    {
      encoding: "utf8",
      input: `with j as (insert into jobs (org_id, title, location, seniority) values (:'org', 'Frontend Engineer', 'Remote', 'senior') returning id),
w as (insert into workflows (job_id, version, definition) select id, 1, :'wf'::jsonb from j returning job_id)
select job_id from w;`,
    },
  ).trim();
  writeFileSync(STATE, JSON.stringify({ jobId, userId, token }));
}

