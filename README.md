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
| `packages/config` | Shared TypeScript, ESLint and Tailwind presets |
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
```

## Checks

```bash
pnpm turbo run lint typecheck test build   # everything
cd apps/api && uv run pytest -q            # backend only (creates the hirevine_test database)
```

After changing API routes, regenerate the typed client: `pnpm gen:api`.
