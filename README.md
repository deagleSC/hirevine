# Hirevine AI

AI does the screening work; people make the decisions. See [docs/plans](docs/plans) for the
frontend and backend implementation plans.

## Layout

| Path | What |
| --- | --- |
| `apps/manager` | Next.js app for hiring managers (port 3000) |
| `apps/candidate` | Next.js app for candidates (port 3001) |
| `apps/api` | FastAPI service: the only gateway to the database and the only caller of models (port 8000) |
| `packages/ui` | Design tokens and shared components |
| `packages/api-client` | Typed client generated from the API's OpenAPI document |
| `packages/config` | Shared TypeScript and ESLint config |
| `supabase/migrations` | Plain SQL migrations (schema, RLS) |

## Local setup

Requirements: Node 22, pnpm 9, [uv](https://docs.astral.sh/uv/), and a local PostgreSQL 15+.

```bash
pnpm install
cd apps/api && uv sync && cd ../..

# Fresh local database with all migrations (role hirevine_api, password "dev")
cd apps/api && uv run python scripts/db_local.py reset hirevine_dev && cd ../..

# Env files (fill in the Supabase URL and anon key for the apps)
cp apps/api/.env.example apps/api/.env
cp apps/manager/.env.example apps/manager/.env.local
cp apps/candidate/.env.example apps/candidate/.env.local

pnpm dev            # API + both apps
pnpm --filter @hirevine/api dev:jobs   # optional: Inngest dev server for background jobs (http://localhost:8288)
```

Background jobs run on Inngest. Locally the API talks to the Inngest dev server and needs no
Inngest keys; without the dev server running, queued jobs simply wait.

## LLM layer

Model calls go through OpenRouter (`OPENROUTER_API_KEY` in `apps/api/.env`). Every call is
cached, counted against a daily cap (`LLM_DAILY_CAP`, default 50 — OpenRouter's free limit),
and traced to Langfuse when its keys are set.

```bash
pnpm --filter @hirevine/api smoke                       # pick the primary model; report in apps/api/evals/reports/
cd apps/api && uv run python -m evals.smoke_test --models a,b --tasks patch   # a subset
```

The workflow editing agent has its own eval (40 requests, target 85% matching what a hand edit
produces). Request-path calls are limited to `LLM_SYNC_RPM_CAP` per minute, so raise it for the run:

```bash
cd apps/api && LLM_SYNC_RPM_CAP=15 uv run python -m evals.override_eval
```

After editing a prompt in `apps/api/app/llm/prompts/`, bump its `version` and run
`uv run python -m app.llm.prompts` to update the lock file (a test fails otherwise).

## Checks

```bash
pnpm turbo run lint typecheck test build   # everything
cd apps/api && uv run pytest -q            # backend only (creates the hirevine_test database)
cd apps/api && INNGEST_DEV_TESTS=1 uv run pytest tests/jobs   # + the Inngest dev-server test
pnpm --filter @hirevine/manager e2e        # editor E2E: local DB + API :8100 + app :3100
```

The E2E signs in with a real Supabase test manager. Put its credentials in
`apps/manager/.env.e2e.local` (gitignored):

```bash
E2E_MANAGER_EMAIL=...
E2E_MANAGER_PASSWORD=...
```

After changing API routes, regenerate the typed client: `pnpm gen:api`.
