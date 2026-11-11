/**
 * Editor E2E (frontend plan §357; Phase 4 exit check). Runs against a fresh local database
 * (hirevine_e2e), a local API on :8100 and the manager app on :3100. Auth is real Supabase
 * sign-in with the test manager in .env.e2e.local (E2E_MANAGER_EMAIL / E2E_MANAGER_PASSWORD).
 *
 *   pnpm --filter @hirevine/manager e2e
 */
import { readFileSync } from "node:fs";

import { defineConfig } from "@playwright/test";

function loadEnv(file: string): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(file, "utf8")
        .split("\n")
        .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
    );
  } catch {
    return {};
  }
}

const local = loadEnv(".env.local");
Object.assign(process.env, loadEnv(".env.e2e.local"), { ...process.env });

export const API = "http://127.0.0.1:8100";
export const APP = "http://localhost:3100";
/** The candidate app, started only when a candidate test account is configured (.env.e2e.local). */
export const CANDIDATE_APP = "http://localhost:3200";
const withCandidate = !!process.env.E2E_CANDIDATE_EMAIL && !!process.env.E2E_CANDIDATE_PASSWORD;
export const E2E_DB = "hirevine_e2e";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: APP, trace: "retain-on-failure" },
  webServer: [
    {
      command: "uv run uvicorn app.main:app --port 8100",
      cwd: "../api",
      url: `${API}/healthz`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        APP_ENV: "test",
        DATABASE_URL: `postgresql://hirevine_api:dev@localhost:5432/${E2E_DB}`,
        SUPABASE_URL: local.NEXT_PUBLIC_SUPABASE_URL ?? "",
        CORS_ORIGINS: JSON.stringify([APP, CANDIDATE_APP]),
      },
    },
    {
      command: "pnpm exec next dev -p 3100",
      url: `${APP}/sign-in`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { NEXT_PUBLIC_API_URL: API, NEXT_DIST_DIR: ".next-e2e" },
    },
    ...(withCandidate
      ? [{
          command: "pnpm exec next dev -p 3200",
          cwd: "../candidate",
          url: `${CANDIDATE_APP}/sign-in`,
          reuseExistingServer: false,
          timeout: 180_000,
          env: { NEXT_PUBLIC_API_URL: API, NEXT_DIST_DIR: ".next-e2e", NEXT_PUBLIC_OTHER_APP_URL: APP },
        }]
      : []),
  ],
});
