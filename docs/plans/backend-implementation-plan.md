# Hirevine AI: Backend Implementation Plan

This plan is for building the Hirevine backend. It covers a FastAPI service on Vercel's Python runtime Supabase for the database, auth, storage and embeddings, and Inngest for background jobs. It turns the *Hirevine AI: Product & Engineering Document* (the "product doc") into a build-ready plan. Section references such as "§6" point to that doc. The frontend plan, [frontend-implementation-plan.md](./frontend-implementation-plan.md), uses the API defined in [§7 API surface](#7-api-surface) of this file.

Libraries the product doc does not name are marked **(chosen here)**. Each one can be swapped without changing the architecture.

---

## 1. Scope and principles

The backend owns every rule, every database read and write, and every model call. Neither frontend app queries the database directly.

| Principle (product doc) | What it means in the backend |
| --- | --- |
| Humans decide, AI assists | No endpoint or job auto-rejects, auto-advances past `final`, or releases outcomes. Only `POST /campaigns/{id}/complete` releases them. |
| Models reason, code calculates | LLM output is per-criterion scores, quotes, and draft text. Match %, cutoffs, quiz grades, rankings and analytics are plain Python or SQL. |
| One edit path | Chat edits and panel edits both end at the same `apply_patches()` function. |
| No evidence, no score | Every model judgment carries a citation. `pipeline/citations.py` verifies it, and a failed check scores 0 with the flag `no_evidence`. |
| Cost-aware | All model calls go through `call_structured()`, which handles the cache, the budget, the throttle and the fallbacks. |
| Portable | Plain SQL migrations, RLS helpers in an `app` schema, thin `Storage`/`AuthProvider`/`Embedder`/`Notifier`/`JobDispatcher` interfaces, and a Dockerfile kept ready. |

Out of scope for v1 (§3): voice interviews, OCR, calendar integrations, team roles, payments, ATS integrations, and a general workflow engine.

---

## 2. Stack

| Concern | Choice | Source |
| --- | --- | --- |
| Language / runtime | Python 3.12 on Vercel Functions (Python runtime) | doc |
| Web framework | FastAPI + Pydantic v2 | doc |
| Package manager | `uv` with a lockfile, exported to `requirements.txt` for Vercel | chosen here |
| DB driver | `psycopg` 3 (async) + `psycopg_pool`, with `prepare_threshold=None` for the transaction-mode pooler | chosen here, **verify** (§8) |
| Migrations | Plain SQL in `supabase/migrations/`, applied with the Supabase CLI | doc |
| AI orchestration | LangGraph + `langgraph-checkpoint-postgres` | doc |
| LLM client | `openai` SDK pointed at `https://openrouter.ai/api/v1` (`langchain-openai` `ChatOpenAI` inside LangGraph graphs) | doc (OpenRouter), client chosen here |
| Parsing | PyMuPDF (`pymupdf`), `python-docx` | doc |
| Redaction | Regular expressions + spaCy `en_core_web_sm`, imported lazily | doc (model size chosen here) |
| Fuzzy / FTS | Postgres `pg_trgm` and `tsvector` (in the DB, not in Python) | doc |
| Embeddings | Supabase Edge Function using the built-in `gte-small` (384-d) | doc |
| Background jobs | Inngest durable functions (Python SDK, free Hobby plan) served from the FastAPI app, plus a `job_runs` status table. Fallback: a Postgres queue drained by Supabase Cron | doc |
| Tracing | Langfuse cloud (free) | doc |
| Errors | Sentry | chosen here (pilot checklist item) |
| Email | Resend behind a `Notifier` interface | chosen here, verify the free tier |
| Tests / evals | pytest, `pytest-asyncio`, `hypothesis` (property tests), scikit-learn (eval metrics) | doc + hypothesis chosen here |
| Lint / types | ruff, mypy (strict on `domain/` and `llm/`) | chosen here |

**Bundle discipline (500 MB uncompressed limit).** Keep spaCy and PyMuPDF as the only heavy imports. Do not add torch, transformers or fastembed to the Vercel bundle. CI measures the installed size (`du -sh` of the site-packages) and fails above 400 MB, which leaves headroom.

---

## 3. Repository layout

The backend lives in the pnpm/Turborepo monorepo beside the two Next.js apps. Turbo runs it through `package.json` script shims (`uv run ...`).

```
hirevine/
├─ apps/
│  ├─ manager/            # Next.js (frontend plan)
│  ├─ candidate/          # Next.js (frontend plan)
│  └─ api/
│     ├─ api/index.py     # Vercel entry: `from app.main import app`
│     ├─ app/
│     │  ├─ main.py               # FastAPI app, routers, middleware, OpenAPI
│     │  ├─ core/
│     │  │  ├─ config.py          # pydantic-settings; all env vars
│     │  │  ├─ auth.py            # JWT verify (JWKS), CurrentUser dependency, role guards
│     │  │  ├─ db.py              # pool, request transaction, set_config of claims
│     │  │  ├─ errors.py          # error envelope, exception handlers
│     │  │  └─ ratelimit.py       # per-user / per-IP limits (DB-backed)
│     │  ├─ api/routers/
│     │  │  ├─ manager/           # jobs.py, chat.py, workflows.py, campaigns.py, analytics.py, settings.py
│     │  │  ├─ candidate/         # jobs.py, applications.py, quiz.py, interview.py, feedback.py, analytics.py, privacy.py
│     │  │  ├─ public.py          # published job list/detail, share-link resolution (no auth)
│     │  │  └─ internal.py        # /internal/keepalive (+ /internal/drain only in the fallback)
│     │  ├─ domain/
│     │  │  ├─ workflow.py        # Workflow, Node configs (discriminated union), validators
│     │  │  ├─ patches.py         # Patch ops (discriminated union), apply, diff, undo
│     │  │  ├─ state_machine.py   # transition(), campaign lifecycle
│     │  │  ├─ scoring.py         # match %, must-have flag, cutoff, ranking
│     │  │  └─ quiz.py            # question validation, grading
│     │  ├─ llm/
│     │  │  ├─ wrapper.py         # get_llm(), call_structured()
│     │  │  ├─ cache.py           # llm_cache read/write
│     │  │  ├─ budget.py          # daily counter + RPM throttle
│     │  │  ├─ models.py          # role → model list from env; pilot allowlist
│     │  │  └─ prompts/           # one module per prompt: ID, VERSION, template, output schema
│     │  ├─ agents/
│     │  │  ├─ jd_agent.py        # JD chat → rubric + workflow v1
│     │  │  ├─ override_agent.py  # NL request → list[Patch]
│     │  │  ├─ screening.py       # score → verify → retry graph
│     │  │  ├─ interview.py       # turn loop + final scoring
│     │  │  └─ report.py          # feedback + suggested recommendation drafts
│     │  ├─ pipeline/
│     │  │  ├─ parse.py           # PDF/DOCX → text with line numbers
│     │  │  ├─ redact.py          # PII removal
│     │  │  ├─ injection.py       # instruction-like phrase scan
│     │  │  ├─ chunk.py           # line-aware chunking for embeddings
│     │  │  ├─ prefilter.py       # hybrid signals → shortlist score
│     │  │  └─ citations.py       # quote / turn / answer verification
│     │  ├─ jobs/
│     │  │  ├─ client.py          # inngest.Inngest(app_id="hirevine"); serve() mounted at /api/inngest
│     │  │  ├─ dispatcher.py      # JobDispatcher: InngestDispatcher, PgQueueDispatcher (fallback)
│     │  │  ├─ runs.py            # job_runs status writes
│     │  │  └─ functions/         # one module per Inngest function (§10.2)
│     │  ├─ services/
│     │  │  ├─ storage.py         # Storage interface + SupabaseStorage
│     │  │  ├─ auth_provider.py   # AuthProvider interface + SupabaseAuth (JWKS, admin delete)
│     │  │  ├─ embedder.py        # Embedder interface + EdgeFunctionEmbedder (+ stubs)
│     │  │  └─ notifier.py        # Notifier interface + InAppNotifier + ResendNotifier
│     │  └─ analytics/queries.py  # thin reads over SQL views
│     ├─ evals/                   # datasets/, runners/, reports/, smoke_test.py, bias_audit.py
│     ├─ tests/                   # unit/, property/, contract/, rls/, e2e/
│     ├─ pyproject.toml / uv.lock / requirements.txt
│     ├─ vercel.json
│     └─ Dockerfile               # fallback container (EC2 / other host)
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/                 # 0001_… plain SQL, ordered
│  ├─ seed.sql                    # synthetic dev data
│  └─ functions/embed/index.ts    # gte-small Edge Function
└─ packages/api-client/           # generated from apps/api OpenAPI (frontend plan)
```

---

## 4. Data model and migrations

Status, ownership and anything used to filter, join or decide permissions live in ordinary columns. Definitions, rubrics, evidence and transcripts live in JSONB, validated by Pydantic at the boundary (§9).

### 4.1 Migration order

| # | File | Contents |
| --- | --- | --- |
| 0001 | `extensions.sql` | `vector`, `pg_trgm`, `pgcrypto` |
| 0002 | `app_schema.sql` | `app` schema, helper functions (4.3), DB roles (`hirevine_api`) |
| 0003 | `core_tables.sql` | `organizations`, `profiles`, `jobs`, `workflows`, `campaigns`, `job_share_links` |
| 0004 | `applications.sql` | `applications`, `consents`, `resume_texts`, `screening_answers`, `stage_results` |
| 0005 | `stages.sql` | `quiz_attempts`, `interview_sessions`, `feedback`, `notifications` |
| 0006 | `ai_infra.sql` | `llm_cache`, `llm_budget`, `llm_rpm`, `embeddings`, `skill_aliases` |
| 0007 | `ops.sql` | `job_runs`, `events`, `data_requests`, `rate_limits` |
| 0008 | `rls.sql` | `enable row level security` + every policy (4.4) |
| 0009 | `analytics_views.sql` | the views in §17 |
| 0010 | `pgqueue_fallback.sql` | **Not applied by default.** `jobs_queue` + `pg_cron`/`pg_net` drain schedule, used only if Inngest is swapped out (§10.6) |
| 0011 | `langgraph_checkpoints.sql` | checkpoint tables (generated once by `PostgresSaver.setup()`, then committed as SQL) |

**As built:** migrations are named `<timestamp>_<name>.sql` and numbered in the order the phases add them, so no file is ever inserted before one that is already applied. Phase 1 created `…01_extensions` through `…07_rls` (extensions, app schema, core tables, applications, stages, ops, RLS). The AI tables (`llm_*`, `embeddings` with pgvector, `skill_aliases`) come in Phase 2 as a new migration, and the analytics views in Phase 10.

**As built (Phase 2):** `…09_ai_infra` adds `llm_cache`, `llm_budget`, `llm_rpm` and `skill_aliases`. The `embeddings` table moves to Phase 5 with the pipeline that writes it, so local development needs pgvector only from then. `llm_budget` keeps a `model_id = '*'` row per day that enforces `LLM_DAILY_CAP` across all models (OpenRouter's free cap is per account); per-model rows record which model actually served each call. Every HTTP request to OpenRouter, including the validation retry, counts against the cap.

### 4.2 Tables

The product doc's tables (§9), with the columns and constraints this plan adds:

| Table | Key columns | Constraints and notes |
| --- | --- | --- |
| `organizations` | `id uuid pk`, `name`, `created_at` | One manager per org in v1 |
| `profiles` | `id uuid pk → auth.users`, `role text check in ('manager','candidate')`, `org_id → organizations null`, `display_name`, `birth_year_confirmed_adult bool`, `created_at` | `check (role = 'candidate' or org_id is not null)` |
| `jobs` | `id`, `org_id`, `title`, `description`, `location`, `seniority`, `status check in ('draft','published','closed')`, `search tsvector generated` | GIN on `search` |
| `job_share_links` | `slug text pk`, `job_id`, `created_at`, `revoked_at` | Shareable apply link (§5) |
| `workflows` | `id`, `job_id`, `version int`, `definition jsonb`, `schema_version int`, `parent_version int`, `created_by`, `created_at` | `unique (job_id, version)` |
| `campaigns` | `id`, `job_id`, `workflow_id` (pinned at publish), `status check in ('draft','open','completed')`, `notify_on_complete bool`, `ai_paused bool default false`, `completed_at` | Kill switch = `ai_paused` |
| `applications` | `id`, `campaign_id`, `candidate_id`, `workflow_id` (the version this candidate is judged by), `status`, `current_node`, `resume_path`, `consent_at`, `created_at` | `unique (campaign_id, candidate_id)` |
| `consents` | `id`, `application_id`, `candidate_id`, `text_version`, `providers jsonb`, `ip_hash`, `created_at` | Every consent logged (§11) |
| `resume_texts` | `application_id pk`, `raw_text`, `redacted_text`, `redacted_lines jsonb`, `parser`, `injection_flags jsonb`, `fts tsvector` | Raw text never leaves the DB; only `redacted_text` goes to models. GIN on `fts`, trigram GIN on `redacted_text` |
| `screening_answers` | `application_id`, `question_id`, `answer` | Optional job questions |
| `stage_results` | `id`, `application_id`, `node_id`, `status check in ('pending','in_progress','passed','failed','needs_review')`, `score numeric`, `evidence jsonb`, `flags text[]`, `prompt_version`, `model_id`, `updated_at` | **`unique (application_id, node_id)`**, which is the idempotency key |
| `quiz_attempts` | `id`, `application_id unique`, `questions_snapshot jsonb`, `answers jsonb`, `score`, `started_at`, `deadline_at`, `submitted_at` | Timed by the server |
| `interview_sessions` | `id`, `application_id unique`, `thread_id`, `transcript jsonb`, `turn_count`, `turn_cap`, `scores jsonb`, `started_at`, `deadline_at`, `finished_at` | One attempt per application |
| `feedback` | `id`, `application_id unique`, `ai_draft`, `edited_text`, `recommendation`, `ai_recommendation`, `manager_note`, `excluded bool`, `released bool`, `released_at` | Release rule (4.4) |
| `notifications` | `id`, `user_id`, `type`, `payload`, `read_at`, `created_at` | In-app notifications |
| `llm_cache` | `key_hash pk`, `response jsonb`, `model_id`, `prompt_id`, `prompt_version`, `created_at` | |
| `llm_budget` | `(day, model_id) pk`, `requests_used int` | |
| `llm_rpm` | `(minute_bucket) pk`, `requests int` | RPM guard for synchronous calls (chats, interview turns). Inngest throttles background calls |
| `embeddings` | `id`, `parent_id`, `kind check in ('resume_chunk','criterion')`, `chunk_index`, `text_hash`, `embedding vector(384)`, `embedding_model` | HNSW index (`vector_cosine_ops`); RLS inherits from the parent |
| `skill_aliases` | `alias text pk`, `canonical text` | "ReactJS", "React.js" → "react" |
| `job_runs` | `id`, `type`, ref ids (`application_id`, `campaign_id`, `job_id`, all nullable), `status check in ('queued','running','deferred_budget','paused','done','failed')`, `attempts`, `inngest_run_id`, `last_error`, `updated_at` | Status the UI shows (§8). Index `(application_id)`, `(status, updated_at)` |
| `events` | `id bigserial`, `actor_id`, `org_id`, `type`, `entity`, `entity_id`, `payload`, `created_at` | Append-only (4.4) |
| `data_requests` | `id`, `user_id`, `kind check in ('export','delete')`, `status`, `created_at`, `completed_at`, `export_path` | |
| `rate_limits` | `(key, window_start) pk`, `count` | Per user and per IP |

### 4.3 RLS helper functions and DB role

```sql
create schema if not exists app;

-- Claims are set by FastAPI per transaction (never by clients).
create or replace function app.claims() returns jsonb
  language sql stable as $$
  select coalesce(nullif(current_setting('app.claims', true), ''), '{}')::jsonb
$$;

create or replace function app.current_user_id() returns uuid
  language sql stable as $$ select (app.claims() ->> 'sub')::uuid $$;

create or replace function app.current_role() returns text
  language sql stable as $$ select app.claims() ->> 'role' $$;

create or replace function app.current_org_id() returns uuid
  language sql stable as $$ select (app.claims() ->> 'org_id')::uuid $$;

-- Restricted login role used by the API. No BYPASSRLS. Never the service role.
create role hirevine_api login password :'api_password' noinherit;
grant usage on schema public, app to hirevine_api;
grant select, insert, update, delete on all tables in schema public to hirevine_api;
revoke update, delete on public.events from hirevine_api;
```

When moving off Supabase, only these helpers and the connection string change (§8, portability rules).

### 4.4 RLS policy matrix (§9)

| Table | Manager | Candidate |
| --- | --- | --- |
| `jobs` | all where `org_id = app.current_org_id()` | select where `status = 'published'` |
| `workflows`, `campaigns` | all within org (via `jobs.org_id`) | none |
| `applications` | select within org | select/insert own (`candidate_id = app.current_user_id()`) |
| `resume_texts`, `consents` | select within org (redacted text only through a view) | select own |
| `stage_results` | select within org | select own **only when the campaign is `completed`** |
| `quiz_attempts`, `interview_sessions` | select within org | select/insert/update own, **only while that stage is open** (`stage_results.status = 'in_progress'`) |
| `feedback` | all within org | select own **only where `released = true`** |
| `events` | select within org | none |
| `notifications`, `data_requests` | own | own |
| `job_runs` | select within org | none (the API maps it into the candidate-facing status) |
| `llm_*` | none (system context only) | none |

The release rule as SQL:

```sql
create policy feedback_candidate_read on feedback for select
  using (
    app.current_role() = 'candidate'
    and released
    and exists (select 1 from applications a
                where a.id = feedback.application_id
                  and a.candidate_id = app.current_user_id())
  );

create policy stage_results_candidate_read on stage_results for select
  using (
    app.current_role() = 'candidate'
    and exists (select 1 from applications a
                join campaigns c on c.id = a.campaign_id
                where a.id = stage_results.application_id
                  and a.candidate_id = app.current_user_id()
                  and c.status = 'completed')
  );
```

**System context for jobs.** Inngest functions have no end user. It runs with claims `{"role":"system"}`, and every table gets an explicit `system` policy (`using (app.current_role() = 'system')`). It does **not** use a BYPASSRLS role. That keeps every access path visible in the policies.

---

## 5. Database access and request context

```python
# core/db.py
pool = AsyncConnectionPool(
    settings.database_url,           # Supavisor pooler, transaction mode (port 6543)
    kwargs={"prepare_threshold": None, "autocommit": False},
    min_size=0, max_size=5, open=False,
)

@asynccontextmanager
async def user_tx(user: CurrentUser):
    async with pool.connection() as conn, conn.transaction():
        await conn.execute(
            "select set_config('app.claims', %s, true)",   # true = local to the transaction
            (json.dumps({"sub": str(user.id), "role": user.role, "org_id": str(user.org_id or "")}),),
        )
        yield conn
```

- Every request handler gets a connection through `Depends(db_for_user)`, which wraps `user_tx`. One transaction per request.
- `set_config(..., true)` is the SET LOCAL equivalent, so it is safe under transaction pooling.
- `user_tx` keeps a list of after-commit callbacks. `JobDispatcher.enqueue` uses it to send Inngest events only once the transaction has committed (§10.4). A rollback drops them.
- **Verify in Phase 1:** run psycopg 3 against Supavisor transaction mode with `prepare_threshold=None`, and add a test that two concurrent requests never see each other's claims.
- Set the Vercel function region to match the Supabase region (for example `bom1` for `ap-south-1`) in `vercel.json`. Vercel defaults to `iad1`.

---

## 6. Auth

- **Token verification.** The `CurrentUser` dependency reads `Authorization: Bearer`, verifies the Supabase JWT against the project's JWKS (cached in memory for 10 minutes), and checks `aud`, `exp` and `iss`.
- **Role and org.** Loaded from `profiles` in the same transaction (one indexed lookup). Optionally move it into a Supabase custom access-token hook later, to save the query.
- **Sign-up.** The frontend signs up through Supabase Auth with `role` in the user metadata. `POST /v1/me/profile` (idempotent) creates the `profiles` row. For managers it also creates the `organizations` row. The role cannot be changed later through the API.
- **Router guards.** `require_role("manager")` on `/v1/manager/*` and `require_role("candidate")` on `/v1/candidate/*`. A wrong role gets a 403 with code `wrong_app`, which the frontend uses to redirect.
- **Inngest endpoint.** `/api/inngest` is mounted by `inngest.fast_api.serve()`. In production it verifies every request's signature with `INNGEST_SIGNING_KEY`, so only Inngest's cloud can invoke functions.
- **Internal routes.** `/internal/keepalive` (and `/internal/drain` in the fallback) require `X-Hirevine-Cron: <secret>`, compared in constant time.
- **AuthProvider interface.** `verify(token) -> Claims` and `delete_user(user_id)`, used by the deletion flow.

---

## 7. API surface

All routes are versioned under `/v1`. FastAPI's OpenAPI document is exported in CI to `apps/api/openapi.json`, and that file is the contract for `packages/api-client`.

### 7.1 Conventions

- **Error envelope.** `{"error": {"code": "stale_base_version", "message": "...", "details": {...}}}`.
- **Status codes.**
  - 401: unauthenticated.
  - 403 `wrong_app` / `forbidden`.
  - 404.
  - 409 `stale_base_version` (patches) / `already_completed` / `stage_closed`.
  - 422: validation.
  - 429 `rate_limited`.
  - 503 `ai_paused`.
- **Long-running work** returns `202` with `{"status": "processing" | "queued_budget", "eta_hint": "..."}`. The status is read from `job_runs`. `queued_budget` means "queued, will process tomorrow". Jobs start as soon as their event is sent, so `processing` usually begins within seconds.
- **Pagination.** Cursor-based (`?cursor=&limit=`).
- **Candidate-facing statuses** are computed server-side (7.4), so the frontend never works out visibility.

### 7.2 Manager routes (`/v1/manager`)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/jobs/chat` | Start or continue the job-creation chat (`thread_id`, `message`). Returns the assistant message, missing fields, and a summary draft when complete |
| POST | `/jobs/chat/{thread_id}/confirm` | Confirm the summary → create `jobs` + `workflows` v1 (JD agent output) |
| GET | `/jobs`, `/jobs/{id}` | List and detail |
| PATCH | `/jobs/{id}` | Title, description, location (non-workflow fields) |
| GET | `/jobs/{id}/workflow` | Current version + definition |
| GET | `/jobs/{id}/workflow/versions` | Version history |
| POST | `/jobs/{id}/workflow/preview` | `{base_version, patches[]}` → `{diff, resulting_definition, affects_running_campaign, affected_stage_note}`. Writes nothing |
| POST | `/jobs/{id}/workflow/apply` | `{base_version, patches[], source: "panel"|"chat"}` → new version. 409 if the base version is stale |
| POST | `/jobs/{id}/workflow/undo` | Restore the previous version as a new version |
| POST | `/jobs/{id}/workflow/chat` | NL override → `{patches[], explanation}` from the override agent. Applies nothing |
| POST | `/jobs/{id}/quiz/generate` | Send `quiz/generate.requested` (202) |
| POST | `/jobs/{id}/publish` | Freeze the version, create the campaign (`open`), publish the job, create a share link |
| GET | `/campaigns/{id}` | Monitor: counts per node and status, processing, needs-review |
| GET | `/campaigns/{id}/applications` | Filterable list (node, status, flags) |
| GET | `/campaigns/{id}/applications/{app_id}` | Full detail: stage results, evidence with citations, quiz answers, transcript, feedback |
| GET | `/campaigns/{id}/final` | Ranked eligible list |
| PATCH | `/campaigns/{id}/applications/{app_id}/feedback` | `edited_text`, `recommendation`, `excluded`, `manager_note` |
| POST | `/campaigns/{id}/applications/{app_id}/manual-score` | Manual scoring path when AI is paused or an item needs review |
| POST | `/campaigns/{id}/applications/{app_id}/retry` | Re-send the job event for a `needs_review` item (new `job_runs` row) |
| PATCH | `/campaigns/{id}` | `notify_on_complete`, `ai_paused` |
| POST | `/campaigns/{id}/complete` | Terminal. Releases outcomes (§16) |
| GET | `/analytics/overview`, `/analytics/campaigns/{id}` | Dashboards (§17) |

### 7.3 Candidate routes (`/v1/candidate`) and public routes (`/v1/public`)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/public/jobs?q=&location=&seniority=&cursor=` | Browse published jobs (FTS) |
| GET | `/public/jobs/{id}`, `/public/share/{slug}` | Detail and share-link resolution |
| POST | `/candidate/applications/upload-url` | `{job_id, filename, content_type, size}` → signed upload URL + `resume_path`. Validates the type (pdf/docx) and size (≤ 5 MB) |
| POST | `/candidate/applications` | `{job_id, resume_path, consent{text_version}, adult_confirmed, screening_answers}` → application, then send `application/submitted` |
| GET | `/candidate/applications` | Tracker: stage, next action, deadline, candidate status |
| GET | `/candidate/applications/{id}` | Detail |
| POST | `/candidate/applications/{id}/quiz/start` | Creates the attempt, sends `quiz/started` (for the deadline), and returns the questions without answers + `deadline_at` |
| PUT | `/candidate/applications/{id}/quiz/answers` | Autosave (allowed before `deadline_at`) |
| POST | `/candidate/applications/{id}/quiz/submit` | Grade in code and transition |
| POST | `/candidate/applications/{id}/interview/start` | Creates the session, returns the disclosure, `turn_cap` and the first question |
| POST | `/candidate/applications/{id}/interview/turn` | `{message}` → **streamed** next question (`text/event-stream`) |
| GET | `/candidate/applications/{id}/interview` | Resume: the transcript so far, turns left, `deadline_at` |
| POST | `/candidate/applications/{id}/interview/finish` | Ends early or at the cap, then sends `interview/finished` |
| GET | `/candidate/applications/{id}/feedback` | Released feedback with citations (404 before release, enforced by RLS) |
| GET | `/candidate/analytics` | Personal metrics |
| GET | `/candidate/notifications`, POST `/candidate/notifications/{id}/read` | In-app notifications |
| POST | `/candidate/privacy/export`, `/candidate/privacy/delete` | Data requests |
| POST | `/me/profile`, GET `/me` | Shared by both apps: create/read the profile and role |

### 7.4 Candidate-facing status (computed server-side)

| Internal state | Candidate sees |
| --- | --- |
| Application received, parsing or screening | `received` / `in_review` |
| Passed screening, quiz invited | `action_required: quiz` (+ deadline) |
| Passed quiz, interview invited | `action_required: interview` (+ deadline) |
| Failed any cutoff, or waiting for final | `in_review` (no score, no rank) |
| Campaign completed and feedback released | `outcome_released` |

### 7.5 Internal routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET/PUT/POST | `/api/inngest` | Inngest serve endpoint: function sync and step invocation (signed) |
| POST | `/internal/keepalive` | Trivial query, so the Supabase project does not pause (also hit by an outside uptime monitor) |
| POST | `/internal/drain` | **Fallback only** (§10.6) |

---

## 8. Workflow domain and patch schema (§6)

### 8.1 Definition

```json
{
  "schema_version": 1,
  "nodes": [
    {"id": "n1", "type": "screening", "config": {"cutoff": 65, "criteria": [{"id": "c1", "name": "React experience", "weight": 3, "must_have": true}]}},
    {"id": "n2", "type": "quiz", "enabled": true, "config": {"pass_mark": 60, "time_limit_min": 20, "questions": []}},
    {"id": "n3", "type": "interview", "enabled": true, "config": {"prompt_additions": "", "themes": [], "turn_cap": 6, "rubric": [], "pass_threshold": 60}},
    {"id": "n4", "type": "final", "config": {"notify_on_complete": true, "ranking": "weighted_mean"}}
  ],
  "edges": [["n1", "n2"], ["n2", "n3"], ["n3", "n4"]]
}
```

### 8.2 Pydantic models

```python
class Criterion(BaseModel):
    id: str; name: str; weight: conint(ge=1, le=5); must_have: bool = False

class QuizQuestion(BaseModel):
    id: str; prompt: str; options: conlist(str, min_length=3, max_length=5)
    answer_index: int; explanation: str; difficulty: Literal["easy","medium","hard"]
    @model_validator(mode="after")
    def one_correct(self): assert 0 <= self.answer_index < len(self.options); return self

class ScreeningNode(BaseModel):  type: Literal["screening"]; id: str; config: ScreeningConfig
class QuizNode(BaseModel):       type: Literal["quiz"]; id: str; enabled: bool = True; config: QuizConfig
class InterviewNode(BaseModel):  type: Literal["interview"]; id: str; enabled: bool = True; config: InterviewConfig
class FinalNode(BaseModel):      type: Literal["final"]; id: str; config: FinalConfig

Node = Annotated[ScreeningNode | QuizNode | InterviewNode | FinalNode, Field(discriminator="type")]

class Workflow(BaseModel):
    schema_version: Literal[1]; nodes: list[Node]; edges: list[tuple[str, str]]
    # validators: exactly one screening + one final; quiz/interview at most one each;
    # edges form the linear chain screening → [quiz] → [interview] → final; weights > 0; ids unique.
```

### 8.3 Patch operations

| Op | Payload | Validation |
| --- | --- | --- |
| `set_cutoff` | `node`, `value` 0–100 | node is screening |
| `set_pass_mark` | `node`, `value` 0–100 | quiz or interview node |
| `add_criterion` / `update_criterion` / `remove_criterion` | `node`, `criterion` / `criterion_id`, fields | at least one criterion remains; warn when the name matches the protected-characteristic list |
| `add_quiz_question` / `replace_quiz_question` / `remove_quiz_question` | `node`, `question` / `question_id` | `QuizQuestion` valid; no duplicates (normalized prompt) |
| `edit_interview_prompt` | `node`, `prompt_additions` (≤ 2,000 chars) | text is inserted into the fixed wrapper only |
| `update_interview_rubric` | `node`, `rubric[]` | weights > 0 |
| `set_turn_cap` | `node`, `value` 3–10 | |
| `toggle_node` | `node`, `enabled` | only quiz or interview |
| `set_notify` | `value` bool | final node; mirrored to `campaigns.notify_on_complete` |

```python
Patch = Annotated[SetCutoff | SetPassMark | AddCriterion | ... | SetNotify, Field(discriminator="op")]

def apply_patches(base: Workflow, patches: list[Patch]) -> tuple[Workflow, Diff]:
    """Pure function: copy, apply each op, re-validate Workflow, compute a JSON diff."""
```

**As built (Phase 3):**
- Two ops beyond the table, because the editor forms have these fields: `set_time_limit` (quiz, 5–120 min) and `set_interview_themes` (≤ 10).
- Values the plan left open: interview rubric items are `{id, name, weight 1–5, description}`; quiz questions ≤ 30, 3–5 distinct options, `difficulty` defaults to `medium`; criteria 1–20.
- Diffs are keyed by node and item id (`n1.criteria[c2].weight`), not array index, so they read well and survive reordering. Reordering has no op in v1.
- `apply_patches` validates after every op, so a 422 names the first op that breaks the workflow.
- The protected-characteristic keyword list (`domain/protected.py`) warns on `add_criterion` and on renames via `update_criterion`.

### 8.4 Applier service

`WorkflowService.apply(job_id, base_version, patches, source, actor)` runs in one transaction:

1. `select ... for update` the latest `workflows` row for the job. If `latest.version != base_version`, raise 409 `stale_base_version`.
2. `apply_patches()`, which is pure. A validation error returns 422 with the failing patch index.
3. Insert `workflows(version = base_version + 1, parent_version = base_version)`.
4. Insert `events` rows (`workflow.patch_applied`, one per patch, with `source`).
5. If a campaign is open, the new version applies to applications whose `current_node` comes before the earliest changed node. Update `applications.workflow_id` for those rows and record `workflow.repinned` events. The preview endpoint computes and returns `affected_stage_note` with the same logic, so the UI can warn before confirming.

**Undo** = apply the parent's definition as a new version (`source: "undo"`). History is never rewritten.

**As built (Phase 3):** step 5 also moves the open campaign's `workflow_id` to the new version (and mirrors `set_notify` to `campaigns.notify_on_complete`), so new applicants get the current version. The workflow endpoints from §7.2 (`GET workflow`, `versions`, `preview`, `apply`, `undo`) are in place; `/workflow/chat` comes with the override agent in Phase 4.

---

## 9. Pipeline state machine

```
per application, per node:   pending → in_progress → passed | failed | needs_review
                                               needs_review → in_progress (retry / manual score)
campaign:                    draft → open → completed   (terminal)
```

```python
async def transition(conn, application_id, node_id, result: StageOutcome) -> None:
    """One transaction. Idempotent on (application_id, node_id)."""
    # 1. upsert stage_results ... on conflict (application_id, node_id) do update
    #    where stage_results.status in ('pending','in_progress','needs_review')  -- terminal rows never change
    # 2. if no row changed: return (a retried job is a no-op)
    # 3. passed → next enabled node from the application's pinned workflow:
    #       set applications.current_node, insert stage_results(next, 'pending'),
    #       JobDispatcher.enqueue(next job): job_runs row now, Inngest event after commit (§10.4)
    #       (quiz/interview invite → application/stage_invited; final → application/reached_final)
    #    failed → current_node stays; no invite; candidate status stays in_review
    # 4. insert events('stage.transition', {from, to, score})
```

- Pass rules (§6): screening is `match ≥ cutoff`, quiz is `score ≥ pass_mark`, interview is `rubric score ≥ pass_threshold`. `final` never auto-passes, because only completion closes it.
- Disabled nodes are skipped when the next node is computed.
- `ai_paused` campaigns: functions check the flag in a step and wait for `campaign/resumed` (`step.wait_for_event`, 7-day timeout). Unpausing sends that event. Manual scoring calls `transition()` with `source = "manual"`.

---

## 10. Background jobs (Inngest)

Background work runs as Inngest durable functions on Inngest's free Hobby plan (§8). The FastAPI app serves the functions at `/api/inngest`. Inngest's cloud decides when each step runs and calls that endpoint over HTTP, so no worker runs on Vercel. Jobs start as soon as their event is sent, with no cron wait. A `job_runs` table in Postgres records each run's status, and the UI reads status from there.

### 10.1 Rules every function follows

| Rule | Why |
| --- | --- |
| Events and step outputs carry **IDs only** (`application_id`, `campaign_id`, `job_run_id`): never resume text, answers, transcripts or scores | Inngest's cloud stores run data and is a data processor (§11). Events are capped at 256 KiB |
| Each step must fit in one 300 s call. A step passes `deadline = step_start + 240 s` to `call_structured` | Vercel Hobby limit. The run as a whole can be longer |
| Side effects happen only inside `step.run`. Step IDs and order are the same on every replay, and a loop never generates step IDs | The function body is re-executed once per step |
| Steps are idempotent (DB writes are upserts keyed on application + node; embeddings and LLM results are cached) | A step that timed out after writing can run again |
| Every function updates `job_runs` (running, deferred, done). `on_failure` marks it `failed` and the stage `needs_review` | The interface shows status from `job_runs`, not from Inngest |
| Function bodies call plain async functions in `pipeline/` and `agents/`. They never put logic in the wrapper | The same code runs under the Postgres-queue fallback (10.6) |

### 10.2 Functions

| Function | Trigger | Steps | Settings |
| --- | --- | --- | --- |
| `screen-application` | event `application/submitted` | `mark_running`, `check_paused`, `parse_redact`, `embed`, `prefilter`, `score`, `verify_citations`, `compute_and_transition` | throttle 10/min, concurrency 2, retries 3 |
| `generate-quiz` | `quiz/generate.requested` | `generate`, `validate_and_patch` | throttle 2/min, concurrency 1 |
| `quiz-deadline` | `quiz/started` | `sleep_until(deadline_at + 30 s)`, `auto_submit_if_open` | — |
| `interview-deadline` | `interview/started` | `sleep_until(deadline_at)`, `finish_if_open` | — |
| `score-interview` | `interview/finished` | `score`, `verify_turns`, `transition` | throttle 3/min, concurrency 1 |
| `draft-report` | `application/reached_final` | `draft`, `save` | throttle 3/min, concurrency 1 |
| `notify-stage` | `application/stage_invited` | `in_app`, `email` (pilot only) | — |
| `notify-release` | `campaign/completed` | one step per batch of 50 applications | — |
| `data-export`, `data-delete` | `privacy/export.requested`, `privacy/delete.requested` | per §18 | concurrency 1 |
| `retention-purge` | cron `0 3 * * *` | `select_expired`, then purge in batches | — |
| `housekeeping` | cron `*/30 * * * *` | `ping_db` (Supabase keep-alive), `resend_stuck_runs`, `resume_budget_deferred` (after 00:00 UTC) | — |

The scheduled functions replace pg_cron entirely, so Supabase Cron is not used on the main path.

### 10.3 Example function

```python
# jobs/client.py
inngest_client = inngest.Inngest(app_id="hirevine", is_production=settings.app_env != "dev")

# app/main.py
inngest.fast_api.serve(app, inngest_client, ALL_FUNCTIONS)   # mounts /api/inngest, verifies signatures

# jobs/functions/screening.py
@inngest_client.create_function(
    fn_id="screen-application",
    trigger=inngest.TriggerEvent(event="application/submitted"),
    throttle=inngest.Throttle(limit=10, period=timedelta(minutes=1)),
    concurrency=[inngest.Concurrency(limit=2)],
    retries=3,
    on_failure=mark_run_failed_and_needs_review,
)
async def screen_application(ctx: inngest.Context, step: inngest.Step) -> None:
    app_id, run_id = ctx.event.data["application_id"], ctx.event.data["job_run_id"]   # IDs only
    await step.run("mark_running", runs.mark_running, run_id, ctx.run_id)
    campaign_id = await step.run("check_paused", campaigns.paused_campaign_id, app_id)  # None if not paused
    if campaign_id:
        await step.wait_for_event("wait_resume", event="campaign/resumed",
                                  if_exp=f"async.data.campaign_id == '{campaign_id}'",
                                  timeout=timedelta(days=7))
    await step.run("parse_redact", pipeline.parse_and_redact, app_id)   # writes resume_texts, returns None
    await step.run("embed", pipeline.embed_resume, app_id)
    await step.run("prefilter", pipeline.prefilter, app_id)
    outcome = await step.run("score", agents.screening.score, app_id)   # "ok" | "deferred_budget"
    if outcome == "deferred_budget":
        await step.run("mark_deferred", runs.mark_deferred_budget, run_id)
        return                                   # housekeeping re-sends the event after 00:00 UTC
    await step.run("verify_citations", pipeline.verify_screening_citations, app_id)
    await step.run("compute_and_transition", screening_service.finalize, app_id)
    await step.run("mark_done", runs.mark_done, run_id)
```

**As built (Phase 2):** pinned `inngest==0.5.20` and the dev server `inngest-cli@1.50.0`. In this SDK the handler takes a single `ctx: inngest.Context` and steps are `ctx.step.run(...)`, not `(ctx, step)` as in the example above. The `selftest` function (dev/test only) is the Phase 2 exit check: `tests/jobs/test_inngest_dev_server.py`.

Pin the Inngest SDK version. Check the exact signatures (`Context`/`Step`, `if_exp`, `Throttle`) against the pinned version's reference, because the doc notes some features are TypeScript-only.

### 10.4 Sending events (after commit)

`JobDispatcher.enqueue(conn, type, refs)` does two things:
1. It inserts `job_runs(status='queued')` inside the caller's transaction.
2. It registers an after-commit callback on the request transaction (`core/db.py`). After commit, the callback calls `inngest_client.send(Event(name=…, id=str(job_run_id), data={**refs, "job_run_id": …}))`.

- The event `id` is the `job_run_id`, so Inngest drops duplicate sends.
- If a send fails or the function instance dies after commit, `housekeeping.resend_stuck_runs` re-sends events for runs still `queued` after 5 minutes.
- An event is never sent before its rows are committed. This is why the product doc's "transition sends the Inngest event" is implemented as an after-commit send.

### 10.5 Throttling and budgets

- **Rate limit (20 requests/min).** Inngest's throttle is configured per function, so the limit is split across functions: screening 10, quiz 2, interview scoring 3, report 3. That leaves about 2/min for the synchronous paths (job chat, override chat, interview turns), which are guarded by the `llm_rpm` bucket (§11). The wrapper still backs off on 429s and empty responses.
- **Concurrency.** The Hobby plan allows 5 concurrent steps. The settings above total 5: screening 2, the other model-calling functions 1 each.
- **Daily cap (50 requests/day).** Enforced by `call_structured`'s budget counter, unchanged. A step that hits it returns `deferred_budget` (10.3) and the candidate sees "queued, will process tomorrow".
- **Executions (50,000/month).** An execution is a run plus each of its steps. Screening costs about 10. A candidate who goes through every stage costs about 30 (screening, quiz deadline, interview deadline, interview scoring, report, notifications). `housekeeping` costs about 4 × 1,440 ≈ 5,800/month. At free-model limits (~1,500 model requests/month) the LLM cap binds long before the execution quota. Alert at 80% of monthly executions.

### 10.6 Fallback: Postgres queue

If Inngest does not fit (quota, privacy, SDK gaps), `PgQueueDispatcher` replaces `InngestDispatcher` behind the same `JobDispatcher` interface. Function bodies stay unchanged.

- Migration `0010_pgqueue_fallback.sql`, not applied by default:
  - a `jobs_queue` table (`type`, `payload`, `status`, `attempts`, `run_after`, `locked_at`, `done_steps text[]`)
  - pg_cron + pg_net calling `/internal/drain` every minute, with the shared secret kept in Supabase Vault
- `/internal/drain` claims work and runs a job's steps in order, skipping those in `done_steps`. It stops about 30 s before the 300 s limit.

```sql
update jobs_queue set status = 'running', locked_at = now(), attempts = attempts + 1
where id = (select id from jobs_queue
            where status in ('queued','deferred') and run_after <= now()
            order by run_after for update skip locked limit 1)
returning *;
```

- The trade-off is about one minute of job latency and retry bookkeeping done by hand.

---

## 11. LLM layer (§10)

### 11.1 Model configuration

```
LLM_STRUCTURED_MODELS=google/gemma-4-31b-it:free,poolside/laguna-s-2.1:free,nvidia/nemotron-3-super-120b-a12b:free
LLM_BULK_MODELS=nvidia/nemotron-3.5-lightning:free
LLM_PILOT_MODE=false
LLM_PILOT_ALLOWLIST=google/gemma-4-31b-it:free,...        # only hosts that do not train on prompts
LLM_DAILY_CAP=50
LLM_RPM_CAP=20
```

`models.py` resolves role → ordered model list. In pilot mode it removes any model not on the allowlist and fails startup if the list is empty. Model IDs come from the product doc's October 14, 2026 snapshot. Re-check them on OpenRouter before pinning.

### 11.2 `call_structured`

```python
async def call_structured(
    role: Literal["structured", "bulk"],
    prompt_id: str,
    input: BaseModel,
    schema: type[T],
    *,
    deadline: float,
    cache: bool = True,
) -> StructuredResult[T]:          # .value, .model_id, .prompt_version, .cached, .attempts
    prompt = PROMPTS[prompt_id]                              # has VERSION, render(), tool spec from schema
    key = sha256(prompt_id, prompt.VERSION, models_for(role), canonical_json(input))
    if cache and (hit := await llm_cache.get(key)): return hit
    await budget.reserve(model_list)                         # atomic; raises BudgetExhausted
    if sync_path: await budget.throttle()                    # llm_rpm bucket for request-path calls; Inngest throttles background ones
    messages = prompt.render(input)                          # untrusted data wrapped in <candidate_data> delimiters
    for attempt in (1, 2):
        ensure_time(deadline)                                # raises TimeBudgetExceeded → Inngest retries the step
        resp = await client.chat.completions.create(
            model=model_list[0],
            extra_body={"models": model_list, "provider": provider_prefs()},  # OpenRouter fallback + privacy
            messages=messages, tools=[tool_from(schema)], tool_choice={"type": "function", ...},
            timeout=min(60, remaining(deadline)),
        )
        try:
            value = schema.model_validate_json(resp.tool_call_args())
            await llm_cache.put(key, value, resp.model, prompt.VERSION)
            return StructuredResult(value, resp.model, prompt.VERSION, ...)
        except ValidationError as e:
            messages += retry_message(e)                     # one retry with the validation error
    raise NeedsReview(prompt_id, last_error)
```

- **Budget.** `insert into llm_budget ... on conflict do update set requests_used = requests_used + 1 where requests_used < cap returning requests_used`. No row returned means `BudgetExhausted`. The reservation counts against the first model. Fallbacks that OpenRouter serves are logged from `resp.model`.
- **Throttle.** Background calls are throttled by each Inngest function's `throttle` setting (§10.5). Synchronous calls (chats, interview turns) use the `llm_rpm` minute bucket, with the same upsert pattern. A 429 or an empty response triggers backoff and `RateLimited(retry_after)`, which fails the step so Inngest retries it.
- **Tracing.** A Langfuse span per call (prompt id and version, model, latency, attempts, cached, fallback used). Inputs are the redacted text only.
- **`get_llm(role)`** returns a configured `ChatOpenAI` for LangGraph nodes. Graph nodes still call `call_structured` for any structured step, so budget and cache always apply.

### 11.3 Prompt registry

Each module in `llm/prompts/` exports `ID`, `VERSION`, `SYSTEM`, `render(input)`, and `OUTPUT` (a Pydantic model). There are prompts for:

- `jd_extract`, `jd_rubric`
- `override_patches`
- `screen_score`
- `quiz_generate`
- `interview_next`, `interview_score`
- `report_draft`

Any edit bumps `VERSION`, and CI fails if a prompt's text hash changed without a version bump.

### 11.4 Smoke test

`uv run python -m evals.smoke_test --models a,b,c --tasks screen,quiz,patch` reports the valid-output rate, citation validity and p50/p95 latency for each model, using the cached eval inputs. Phase 2 uses it to pick the primary model.

---

## 12. Agents (LangGraph)

LangGraph is used only where reasoning needs tools, retries or state. **No graph has a tool with side effects.** Graphs return values, and services write them.

| Graph | Nodes | Output | Checkpointed |
| --- | --- | --- | --- |
| `jd_agent` | `extract` (role, seniority, skills, location, quiz length) → `ask_missing` loop → `build_rubric` → `protected_check` → `assemble_workflow` | `JobSummary` + `Workflow` v1 | Yes, by `thread_id` (one HTTP request per chat turn) |
| `override_agent` | `interpret` → tool calls (one tool per patch op, each returning a `Patch`) → `validate` (dry-run `apply_patches`) | `list[Patch]` + explanation | Yes, by `thread_id` |
| `screening` | `score` (one packed call over all criteria) → `verify_citations` → `retry_unsupported` (once, only failed criteria) → `finalize` | `ScreeningResult` | No (one job) |
| `interview` | `next_question` (themes + transcript, fixed wrapper) → wait for the candidate (graph interrupt) → … until the cap | Transcript | Yes, by `interview_sessions.thread_id` |
| `report` | `draft_feedback` (from stage results + evidence) → `suggest_recommendation` | `FeedbackDraft` | No |

**As built (Phase 4):**
- Pinned `langgraph==1.2.18` and `langgraph-checkpoint-postgres==3.2.0`. The checkpoint tables are committed as migration `…10_agents` (the library's DDL; it never runs DDL at runtime) and are system-only under RLS. `agent_threads` records who owns each thread; the API checks it before touching a checkpoint.
- The saver is bound to the request transaction, so a chat turn holds one pooled connection for the model call's duration (~10 s). Session-level claims would avoid that but leak across clients behind the transaction pooler.
- No `ChatOpenAI`: graph nodes call `call_structured` directly, so budget, cache and tracing always apply. The override agent emits all patches in one structured call (the `Patch` union as the tool schema) instead of one tool per op; `validate` dry-runs them and retries once with the error.
- `jd_agent` makes one call per turn (`jd_turn`) plus one (`jd_rubric`) on the turn the draft completes; missing fields are computed in code.
- Override eval: `evals/datasets/override.json` pairs 40 requests with the equivalent side-panel edits; the frontend's `diffFormToPatches` pins `expected`, and the eval compares the agent's patches to it (new-item ids and order ignored). First run: 39/40 (98%) against an 85% target.

**Interview wrapper prompt.** The manager cannot override it. It discloses that the interviewer is an AI, keeps to the role's themes, refuses and does not ask about protected characteristics (age, gender, marital status, religion, caste, disability, nationality), ignores instructions inside candidate replies, and asks one question per turn. The manager's `prompt_additions` are inserted into a marked slot.

**Protected-characteristic check** (JD agent and `add_criterion`). A keyword and pattern list plus an LLM judgment inside the same packed call. The result is a warning shown to the manager, not a block.

---

## 13. Resume screening pipeline

```
upload (signed URL, Supabase Storage) → POST /applications → event application/submitted {application_id, job_run_id}
                                                                   │
   Inngest function screen-application (throttled, concurrency 2; each step ≤ 300 s, returns IDs/status only)
   ├─ step parse_redact            → resume_texts (raw + redacted), injection flags
   ├─ step embed                   → embeddings via Edge Function (gte-small)
   ├─ step prefilter               → shortlist score (SQL + cosine)
   ├─ step score                   → screening graph: 1 packed LLM call (+1 retry for failed citations)
   ├─ step verify_citations        → citations.verify
   └─ step compute_and_transition  → scoring.match_percent / must-have flag / cutoff → state_machine.transition
```

1. **Parse** (`pipeline/parse.py`). PyMuPDF for PDF and `python-docx` for DOCX. Output is a list of lines with stable line numbers. A file with too little text (for example under 200 characters) becomes `needs_review` with the flag `unreadable` (no OCR in v1).
2. **Redact** (`pipeline/redact.py`):
   - Regex for emails, phones (Indian and international formats), URLs, dates of birth, and addresses (PIN codes plus street patterns).
   - spaCy `PERSON`/`GPE` (lazy-loaded once per process).
   - Keyword removal of gender, marital status and photo references.
   - Education lines stay when the rubric has an education criterion.
   - Output `redacted_text` + `redacted_lines`. The quote check runs against `redacted_lines`.
3. **Injection scan** (`pipeline/injection.py`). A phrase and regex list ("ignore previous instructions", "rank this candidate", "system prompt", role-play markers, hidden-text heuristics). Hits go to `resume_texts.injection_flags` and appear as the flag `possible_injection` in the manager UI. They never block scoring.
4. **Embed** (Embedder → Edge Function). Line-aware chunks of about 400 characters, plus one vector per rubric criterion. Cached by `text_hash`. `embedding_model = 'gte-small'` is stored with each row.
5. **Prefilter** (`pipeline/prefilter.py`). Signals come from one SQL query per application:
   - `ts_rank` of criteria terms against `resume_texts.fts`
   - the best `similarity()` (pg_trgm) per criterion term after alias normalization through `skill_aliases`
   - the max cosine similarity between each criterion vector and the resume chunks

   The combined score = a weighted sum, with weights in config. The prefilter **only orders and narrows the pool for scoring when the daily budget is short**. It never rejects. Candidates below the shortlist line stay `pending` with a visible "awaiting scoring" state, and the manager can force-score them.
6. **Score** (one packed call). For each criterion it returns `{criterion_id, score 0–4, rationale ≤ 40 words, quote}`.
7. **Verify citations** (`pipeline/citations.py`). Normalize whitespace and case, then require the exact substring in `redacted_text`. On failure, retry once for only the failing criteria. If it fails again, score 0 and flag `no_evidence`.
8. **Compute** (`domain/scoring.py`):

```python
def match_percent(scores: dict[str, int], criteria: list[Criterion], s_max: int = 4) -> float:
    total_w = sum(c.weight for c in criteria)
    return round(100 * sum(c.weight * scores.get(c.id, 0) for c in criteria) / (s_max * total_w), 1)

def must_have_flags(scores, criteria) -> list[str]:
    return [c.id for c in criteria if c.must_have and scores.get(c.id, 0) == 0]   # visible flag, not a reject
```

   The cutoff applies to the weighted score only. Then `transition()` is called with the evidence JSON: `[{criterion_id, weight, score, rationale, quote, line_no, verified}]`.

**As built (Phase 5):**
- Migration `…11_screening`: `embeddings` (pgvector, HNSW, system-only, deleted with their application by trigger), `applications.prefilter_score`, a `public` read policy on open campaigns (the job board joins them), and the private `resumes` bucket (created only where the `storage` schema exists). Local Postgres needs pgvector built against it.
- PyMuPDF is pinned below 2.0: 2.x pulls `pymupdf4llm` → `onnxruntime`/`numpy`, which the bundle budget cannot afford.
- File type is sniffed from bytes. PDF white/tiny text and DOCX hidden/white runs are collected as hidden text and flagged `hidden_text`. Hidden PDF text also appears in the extracted lines, so the phrase scan sees it too.
- spaCy NER runs only if spaCy and `en_core_web_sm` are installed; the regex and keyword rules always run. Phones need 10–15 digits so year ranges survive. The first three lines lose a bare name, but not a job title.
- Screening is plain async code (`agents/screening.py`), not a LangGraph graph: the Inngest steps already persist between `score` and `verify_citations`, and there is no conversation to checkpoint. The draft scores sit on the open `stage_results` row (`evidence = {"draft": …}`) between the two steps; the detail endpoint never shows drafts.
- Quotes are matched after normalising case, whitespace and punctuation, so a quote may cross a line break; placeholder-only and very short quotes never verify.
- Model errors in a step: budget → run `deferred_budget` and the function ends (housekeeping re-sends after 00:00 UTC); rate limit → `RetryAfterError`; invalid output twice or no model → stage `needs_review` with `model_failed`.
- Inngest event ids: the run id until the run first starts, then `run_id:attempts`. Before this, a run resumed after a budget deferral reused its id and could be dropped by Inngest's 24 h de-duplication.
- Dev/test use `MemoryStorage` and a hashing embedder when `SUPABASE_SERVICE_KEY` / `EMBED_FUNCTION_URL` are unset; production refuses to start the job without them.
- Not yet: the prefilter only records `prefilter_score` (shortlisting when the budget is short is not wired), and the screening evals (rank agreement, precision, citation validity) need a labelled dataset.

---

## 14. Quiz

- **Generation.** The `quiz_generate` prompt runs once per job (the whole paper in one call) from the rubric and the requested length and difficulty. `domain/quiz.validate()` checks that `answer_index` is in range, that all options are distinct, that question prompts are deduplicated by normalized text, and that the count is right. Invalid questions are dropped and logged. If too few remain, it retries once. The result lands in the workflow as `add_quiz_question` patches, through the applier and with an event.
- **Attempt.** `start` snapshots the questions (without answers) into `quiz_attempts.questions_snapshot` and sets `deadline_at = now() + time_limit`. Autosave is accepted until `deadline_at` plus a 30 s grace. `submit` (or the deadline passing, handled by the `quiz-deadline` function, which sleeps until `deadline_at` + grace and auto-submits if still open) grades in code: `score = 100 × correct / total`. Then `transition()`.
- **Feedback material.** Per-question correctness and the stored `explanation` from the answer key. It is never regenerated by a model.
- **Limits.** One attempt per application. A resumed session returns the same snapshot and saved answers.

**As built (Phase 6):** `domain/quiz.py` (validate, snapshot, grade), prompt `quiz_generate` v1, `agents/quiz.py` (one call, one retry for the shortfall), `services/quiz.py`, routes `POST /v1/manager/jobs/{id}/quiz/generate` (202, body `count` 1–30, `difficulty` easy/medium/hard/mixed, `replace`) and `GET …/quiz/generate/{run_id}`, and the candidate routes `GET …/quiz`, `POST …/quiz/start`, `PUT …/quiz/answers`, `POST …/quiz/submit`. Migration 12 adds `job_runs.params` (request settings; events still carry IDs only). Differences from the text above:
- `generate-quiz` runs one step (`generate`): the model output contains the answer key, so it never becomes a step output. The model call happens outside any transaction; the patches and `job_runs.status = 'done'` commit together, so a retried step cannot add twice. Patches are applied with `source: "agent"` and the requesting manager as the actor.
- Grading reads the key from the workflow version the application is pinned to (it is not re-pinned once at the quiz). Per-question results are stored as the quiz stage's `evidence`, which candidates cannot read; `quiz_attempts.score` is written but never returned by the candidate API.
- The deadline is server time. Autosave is accepted until `deadline_at` + 30 s; `quiz-deadline` sleeps until then and grades the saved answers with the flag `auto_submitted`. Its run is excluded from the monitor's "processing" count.
- A live workflow must be runnable: publishing, or saving a version while a campaign is open, fails with 422 `quiz_has_no_questions` if the quiz is enabled and empty. A candidate who still reaches an empty quiz gets `quiz_not_ready`.
- `quiz_generate` is at v2: the output accepts `question` or `text` for the question field, because a real run with `google/gemma-4-31b-it` used `question` and v1 rejected the whole paper. That real run produced 6 valid questions in 65 s; it labelled all of them `medium` when asked for a mix.

---

## 15. Interview

- **Start.** Requires `stage_results(n3).status = 'pending'` and no existing session. It creates `interview_sessions` (`thread_id`, `turn_cap` from the pinned workflow, `deadline_at`, for example 30 min) and returns the disclosure text and the first question.
- **Turn.** It validates that the session is open, `turn_count < turn_cap` and `now() < deadline_at`. It appends the candidate reply (≤ 2,000 chars, treated as data), resumes the graph from its checkpoint, and **streams** the next question with `StreamingResponse` (SSE). Then it persists the transcript and increments the turn count. Streaming keeps the response clear of the 4.5 MB body limit and makes the reply feel immediate.
  - **Budget tension:** each turn is one model request. Turn generation goes through `call_structured`-style budget accounting (`budget.reserve`), with no cache. If the budget runs out mid-interview, the session pauses with a "continue later" state rather than failing.
- **Finish.** At the cap, on candidate finish, or on deadline expiry (the `interview-deadline` function sleeps until `deadline_at`, then finishes the session if still open), it sends `interview/finished`, which runs `score-interview`.
- **Scoring.** One `interview_score` call over the full transcript returns per-rubric-item `{score, rationale, turns: [int]}`. `citations.verify_turns` checks that each turn exists and was a candidate turn. An unsupported item scores 0 with the flag `no_evidence`. Then the rubric's weighted score → `transition()`.
- **Resume.** `GET /interview` returns the transcript and the remaining turns and time. The graph resumes from its Postgres checkpoint, so there is no in-memory state.

---

## 16. Final report and campaign completion

- **Final list.** For applications whose `current_node = final` and that are not excluded, rank by the configured rule. The default is the mean of the enabled stage scores, weighted equally, with ties broken by screening match. Show the stage scores, flags, and a `suggested` recommendation (`strong_yes | yes | maybe | no`, always labeled "suggested").
- **Drafts.** The `draft-report` function writes `feedback.ai_draft` and `ai_recommendation`. The prompt input is the stored evidence (quotes, quiz explanations, turn excerpts), and the draft must cite them. Manager edits go to `edited_text` and `recommendation`, and each edit writes `feedback.edited` events.
- **Candidates who failed earlier** get a feedback draft too (from the evidence of the stage where they stopped), so everyone gets an outcome on release.
- **Complete** (`POST /campaigns/{id}/complete`) runs in one transaction:
  1. `select ... for update` the campaign and require `status = 'open'` (otherwise 409 `already_completed`).
  2. Set `status = 'completed'`, `completed_at = now()`, and `jobs.status = 'closed'`.
  3. Set `feedback.released = true` and `released_at = now()` for every application in the campaign (if no draft exists, insert a neutral template). Excluded candidates also get a release with their own feedback.
  4. Insert the `campaign.completed` and `feedback.released` events.
  5. Register an after-commit send of `campaign/completed`. If `notify_on_complete` is on, `notify-release` fans out in steps of 50 applications, which saves executions.

  After commit, RLS opens `stage_results` and `feedback` to the candidates. No other code path can do this.

---

## 17. Analytics (§12)

Plain SQL views over `events`, `stage_results`, `quiz_attempts`, `feedback`, `applications` and `llm_budget`. Views are `security_invoker = true`, so RLS applies to the caller.

| View | Metric |
| --- | --- |
| `v_campaign_funnel` | reached / passed / failed per node, plus drop-off |
| `v_score_distribution` | match % and quiz score buckets (10-pt) per campaign |
| `v_time_per_stage` | median of invite → completion per node (from `stage.transition` events) |
| `v_time_to_shortlist` | hours from the first application to `campaign.completed` |
| `v_cutoff_impact` | count passing at cutoff ±5, ±10 |
| `v_feedback_acceptance` | share released with `edited_text is null` |
| `v_recommendation_agreement` | share where `recommendation = ai_recommendation` |
| `v_manager_trends` | applications per job per week, campaigns completed per month |
| `v_model_usage` | requests and fallbacks per campaign (from `llm.call` events) |
| `v_candidate_applications` | applications per week and current status |
| `v_candidate_progression` | furthest node per application |
| `v_candidate_scores` | match % and quiz score per application, **only for completed campaigns** |
| `v_candidate_time_to_outcome` | days from application → `released_at` |
| `v_candidate_completion` | invited stages completed / invited |

Materialize only if a query goes over about 300 ms at demo scale.

---

## 18. Privacy, safety and pilot readiness (§11, §15)

| Item | Implementation |
| --- | --- |
| Consent | `consents` row at apply time: text version, providers list, hashed IP. Apply is rejected without it |
| Adults only | `adult_confirmed` required. Stored on the profile |
| Export | `data_export` job builds a JSON (+ resume file) into a private bucket and returns a signed URL valid for 24 h |
| Deletion | `data_delete` job removes the resume file, `resume_texts`, embeddings, transcripts, quiz answers and feedback, and anonymizes `events.actor_id`. Then `AuthProvider.delete_user` |
| Retention | The daily scheduled Inngest function `retention-purge` deletes candidate data older than `RETENTION_DAYS` after campaign completion |
| Kill switch | `campaigns.ai_paused`. Functions wait for `campaign/resumed`, and the manual-score endpoint is the fallback path |
| Rate limits | Applications per candidate (for example 10 per day) and per IP. One interview attempt. Upload-URL requests capped. All counted in `rate_limits` |
| Uploads | pdf/docx only, ≤ 5 MB, MIME sniffed in the `parse_redact` step. The bucket is private, and only signed URLs are used |
| Model data policy | Synthetic data only until the pilot. `LLM_PILOT_MODE=true` enforces the allowlist + OpenRouter provider `data_collection: "deny"` (**verify the option name**) |
| Traces | Langfuse receives redacted text only. Unit test: `redact()` output has no email or phone patterns |
| Job service as a processor | Inngest's cloud receives events and step outputs. They carry IDs only (enforced by a test). Resume text stays in Supabase. The Python SDK's encryption middleware is on as a second layer (**verify which features it covers in Python**). The privacy notice names Inngest as a processor |
| Monitoring | Sentry on the API. Inngest failure alerts plus `on_failure` handlers. Alerts on `job_runs` queued for more than 10 min, the daily model budget at 80%, and monthly Inngest executions at 80% of 50,000 |
| Backups | A scheduled `pg_dump` (GitHub Action) to storage, with a restore tested once. Verify Supabase plan coverage |

---

## 19. Testing and evals (§13)

### 19.1 Test layers

| Layer | Where | Covers |
| --- | --- | --- |
| Unit | `tests/unit` | `match_percent`, must-have flags, quiz grading, `apply_patches` per op, undo, `transition()` idempotency, citation checker, redaction, injection scan |
| Property | `tests/property` (hypothesis) | Any sequence of valid patches → valid `Workflow`. Undo after N patches restores version N−1. The applier never accepts a stale base |
| Contract | `tests/contract` | Each prompt's `OUTPUT` schema against recorded responses in `fixtures/llm/` (valid, malformed JSON, missing fields, wrong quotes), so the retry and `needs_review` paths are exercised without calling a model |
| RLS / security | `tests/rls` | Real Postgres (Supabase local). Connect as `hirevine_api` with claims for manager A, manager B, candidate X and candidate Y. Assert cross-org reads return 0 rows. **The candidate reads feedback and stage_results before completion → 0 rows, after → visible.** Events update/delete is denied |
| Jobs | `tests/jobs`, against the Inngest local dev server | A failed step retries without repeating finished steps. Throttling holds under the 20/min rate limit. Event and step payloads contain only IDs (schema assertion on every `send` and step return). An after-commit send never fires on rollback |
| API | `tests/api` | httpx `AsyncClient` against the app with the LLM stubbed (`FakeLLM` replaying fixtures) |
| End-to-end | `tests/e2e` | Create a job via chat (stubbed), publish, apply with a synthetic resume, pass screening, take the quiz, run the interview, draft, complete, read feedback |

CI (GitHub Actions) does the following:
1. Starts Supabase local and the Inngest dev server.
2. Applies the migrations.
3. Runs ruff, mypy and pytest.
4. Exports `openapi.json` as an artifact.
5. Checks the bundle size.

### 19.2 Eval harness (`evals/`)

| Eval | Dataset (synthetic, generated offline with Claude, human spot-check) | Metric |
| --- | --- | --- |
| Screening | ~30 labeled resume × JD pairs | Spearman rank agreement, precision@k, citation validity |
| Quiz generation | ~10 JDs | % exactly one correct, duplicate rate, answerability |
| Interview scoring | ~10 labeled transcripts × 3 runs | Run-to-run std dev, agreement with labels |
| Override agent | ~40 NL instructions → expected patches | Exact-match rate |
| Structured output | All of the above | Valid on first try / after retry, per model |
| Bias audit | ~20 resumes × name/gender swaps | Distribution of score deltas, % over the tolerance (tolerance set from the noise baseline) |
| Injection | ~15 resumes with planted instructions | % that change a score, % flagged |
| Cost | Full synthetic campaign | Requests and fallbacks per candidate |
| Prefilter ablation | Screening set | Recall of good resumes at the shortlist: keyword only / embeddings only / both |

Runs go through `call_structured` with the cache on, so reruns only pay for what changed. Each report writes `evals/reports/<eval>_<model>_<prompt_version>.json`, and the README table is generated from these files.

---

## 20. Deployment

### 20.1 Vercel (backend project, Root Directory `apps/api`)

```json
{
  "functions": { "api/index.py": { "maxDuration": 300, "memory": 2048 } },
  "regions": ["bom1"],
  "rewrites": [{ "source": "/(.*)", "destination": "/api/index.py" }]
}
```

### 20.2 Environment variables

| Name | Purpose |
| --- | --- |
| `DATABASE_URL` | Supavisor transaction-mode URL, user `hirevine_api` |
| `SUPABASE_URL`, `SUPABASE_JWKS_URL`, `SUPABASE_JWT_AUD` | Token verification |
| `SUPABASE_SERVICE_KEY` | **Only** inside `SupabaseStorage` (signed URLs) and `SupabaseAuth.delete_user`. Never used for DB access |
| `EMBED_FUNCTION_URL`, `EMBED_FUNCTION_KEY` | Edge Function |
| `OPENROUTER_API_KEY`, `LLM_*` | §11.1 |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST` | Tracing |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Sending events; verifying Inngest's calls to `/api/inngest` |
| `INNGEST_ENCRYPTION_KEY` | Encryption middleware (second layer) |
| `CRON_SECRET` | `/internal/keepalive` (and `/internal/drain` in the fallback) |
| `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_ENABLED` | Pilot email |
| `SENTRY_DSN` | Errors |
| `CORS_ORIGINS` | Manager and candidate app origins |
| `RETENTION_DAYS`, `APP_ENV` | Policy, environment |

### 20.3 Edge Function `supabase/functions/embed/index.ts`

```ts
const session = new Supabase.ai.Session("gte-small");
Deno.serve(async (req) => {
  // verify the shared key header
  const { inputs } = await req.json();                    // string[] (≤ 32 per call)
  const vectors = await Promise.all(inputs.map((t: string) =>
    session.run(t, { mean_pool: true, normalize: true })));
  return Response.json({ model: "gte-small", dim: 384, vectors });
});
```

Deploy with `supabase functions deploy embed`. Check the Edge Function free-tier invocation limits.

### 20.4 Fallback container

A `Dockerfile` (python:3.12-slim, `uv sync --frozen`, `uvicorn app.main:app`) is built in CI on every merge, so the EC2 path stays working. Switching hosts only changes the serve URL synced to the Inngest app.

---

## 21. Build phases (§15)

Each phase is done when its exit check passes. There are no dates.

| # | Phase | Backend tasks | Exit check (product doc) |
| --- | --- | --- | --- |
| 1 | Foundations | Monorepo `apps/api` skeleton, config, error envelope, `/healthz`. Supabase project + migrations 0001–0005, 0007–0008. `app` helpers, `hirevine_api` role. JWT auth, `/me/profile`. `db.user_tx` + pooler verification. Dockerfile. CI. Vercel deploy, measure bundle and cold start. Create the Inngest app, mount `/api/inngest`, and sync it to the deployed backend. Synthetic data generated offline | Automated tests show two users in different organizations cannot read each other's rows |
| 2 | LLM layer | Migration 0006. `models.py`, `call_structured`, cache, budget, `llm_rpm`, Langfuse. Inngest client, `JobDispatcher` with after-commit send, `job_runs`, function throttle and concurrency settings, `housekeeping`. Smoke test | The smoke test picks the primary model with recorded numbers, the budget counter blocks calls at the limit, and an Inngest function runs a queued item to completion and retries a failed step without repeating finished ones |
| 3 | Workflow model | `domain/workflow.py`, `patches.py`, `WorkflowService` (apply, preview, undo, versions), `state_machine.py` skeleton | Property tests show any valid patch sequence produces a valid workflow and undo restores the earlier version |
| 4 | Job creation and editing | `jd_agent`, `/jobs/chat` + confirm, workflow endpoints, `override_agent` + `/workflow/chat`, publish | The same change made by chat and by hand produces identical patches, and the patch agent meets its eval target |
| 5 | Applications and screening | Upload URL, apply + consent, `screen-application` function: parse, redact, injection scan, Edge Function + `embed`, prefilter, screening graph, citations, match, cutoff, transition | Screening evals report rank agreement, precision and citation validity, and an injection sample cannot change a score unflagged |
| 6 | Quiz | `generate_quiz`, quiz patches, start/autosave/submit, grading, `quiz-deadline` function | Generated quizzes pass the validity checks and grading matches the answer key exactly |
| 7 | AI interview | Wrapper prompt, interview graph + checkpoints, start/turn (SSE)/resume/finish, `interview-deadline` and `score-interview` functions, turn citations | Scoring is consistent across repeated runs within the measured tolerance |
| 8 | Final report and completion | Ranking, `draft-report` function, feedback editing, manual score, complete transaction, notify, release-rule RLS tests | A test confirms a candidate cannot see outcomes or feedback before release |
| 9 | Candidate portal | Public job routes + FTS, tracker statuses (7.4), notifications, feedback endpoint, privacy export and delete | The end-to-end test runs from job creation to released feedback |
| 10 | Analytics | Migration 0009 views, analytics endpoints | Dashboard numbers match hand-computed values on a fixed synthetic campaign |
| 11 | Hardening and delivery | Bias audit, injection set, full evals, trace review, RLS review, behavior at the request cap, pre-run demo campaign, README with ADRs and measured results, pilot checklist items (§18) | The README reports real eval numbers, and the demo runs from the deployed app |

These are the product doc's 11 phases in its order. Phase 9 can overlap with 6–7 once applications exist.

---

## 22. Open questions and verify list

| Item | How to settle it | Phase |
| --- | --- | --- |
| Primary and fallback models | Smoke test + screening eval on 2–3 candidates | 2 |
| psycopg 3 behind Supavisor transaction mode | Concurrency test of claims isolation and prepared statements disabled | 1 |
| Python bundle size and cold start on Vercel | Measure after the first deploy. If over the limit or too slow, use the EC2 container | 1 |
| OpenRouter free limits (20 RPM / 50 per day) and the privacy setting name | Check OpenRouter's limits and privacy pages before pinning | 2 / pilot |
| Edge Function free-tier limits for `gte-small` | Supabase pricing page + a load test on 100 resumes | 5 |
| Supabase idle pause | `housekeeping` pings the DB every 30 min, plus an outside uptime monitor. Observe over 7+ days | 1 |
| Inngest free plan fit (50,000 executions/month, 5 concurrent steps, 256 KiB events) | Count executions per synthetic campaign. If it does not fit, switch to the Postgres-queue fallback (§10.6) | 2 |
| Inngest Python SDK: exact signatures, encryption middleware coverage (some features are TypeScript-only) | Check against the pinned SDK version's reference. Throttle and concurrency are already confirmed by the product doc | 2 |
| Inngest named as a processor in the privacy notice | Part of the pilot legal review | Pilot |
| Vercel Hobby non-commercial rule for the pilot | Read the fair use guidelines. Pro is $20/month if needed | Pilot |
| Email provider free tier | Resend limits (or an alternative behind `Notifier`) | Pilot |
