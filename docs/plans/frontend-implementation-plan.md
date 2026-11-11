# Hirevine AI: Frontend Implementation Plan

This plan is for building the Hirevine frontend: a pnpm + Turborepo monorepo with two Next.js apps, `apps/manager` and `apps/candidate`, and three shared packages. It turns the *Hirevine AI: Product & Engineering Document* (the "product doc") into a build-ready plan. Section references such as "§4" point to that doc. Every endpoint named here is defined in [backend-implementation-plan.md §7](./backend-implementation-plan.md#7-api-surface).

Libraries the product doc does not name are marked **(chosen here)**. Each one can be swapped without changing the architecture.

---

## 1. Scope and principles

| Rule | What it means in the frontend |
| --- | --- |
| The apps never query the database | Supabase JS is used **only** for auth sessions. Every read and write goes through the generated API client to FastAPI. File uploads are the one exception: they go straight to Supabase Storage through a signed URL the API issues |
| The server decides visibility | The UI renders the candidate-facing status the API returns (`received`, `in_review`, `action_required`, `outcome_released`). It never works out pass, fail or rank on the client. The release rule lives in RLS |
| Humans decide | There is no auto-reject control anywhere. Recommendations are always labeled **Suggested**. Completing a campaign is an explicit, confirmed, irreversible action |
| One edit path | Panel forms and the chat drawer both produce **patch objects**. The editor shows a diff from `/workflow/preview` and applies with `/workflow/apply`. Nothing mutates the workflow locally except as a preview |
| Evidence everywhere | Any score shown has its citations next to it: a resume line, a quiz answer or an interview turn |
| Light candidate app | React Flow and Recharts are never imported in `apps/candidate`. Candidates are often on mid-range phones in India (§2) |

Out of scope for v1 (§3): voice interviews, team roles, payments, ATS integrations, calendar integrations, and microfrontends (ADR 15).

---

## 2. Stack

| Concern | Choice | Source |
| --- | --- | --- |
| Monorepo | pnpm workspaces + Turborepo | doc |
| Framework | Next.js (App Router, React Server Components where useful) + TypeScript `strict` | doc (Next.js), App Router chosen here |
| Workflow canvas | React Flow (`@xyflow/react`), manager app only | doc |
| Charts | Recharts, manager app only | doc |
| Auth | Supabase Auth via `@supabase/ssr` (cookie sessions, middleware refresh) | doc |
| API client | `openapi-typescript` (types) + `openapi-fetch` (runtime), generated from FastAPI's `openapi.json` | doc requires a generated typed client; tools chosen here |
| Server state | TanStack Query v5 | chosen here |
| Forms and validation | React Hook Form + Zod (schemas mirror the backend Pydantic models) | chosen here |
| Local UI state | Zustand, only for the editor's selection, drawer and pending-patch state | chosen here |
| Styling and components | Tailwind CSS + shadcn/ui (Radix primitives) in `packages/ui` | chosen here |
| Icons | `lucide-react` | chosen here |
| Dates | `date-fns` (deadlines, relative times) | chosen here |
| Tests | Vitest + Testing Library, MSW for API mocks, Playwright for E2E | chosen here |
| Errors | Sentry (`@sentry/nextjs`), a pilot checklist item | chosen here |
| Lint and format | ESLint (shared config), Prettier | chosen here |

---

## 3. Repository layout

```
hirevine/
├─ apps/
│  ├─ manager/                       # manager.hirevine.app
│  │  ├─ app/
│  │  │  ├─ (auth)/sign-in/page.tsx, sign-up/page.tsx
│  │  │  ├─ (app)/layout.tsx         # shell: sidebar, top bar, QueryProvider
│  │  │  ├─ (app)/page.tsx           # home: jobs + campaigns overview
│  │  │  ├─ (app)/jobs/new/page.tsx              # job chat
│  │  │  ├─ (app)/jobs/[jobId]/page.tsx          # job overview
│  │  │  ├─ (app)/jobs/[jobId]/workflow/page.tsx # React Flow editor
│  │  │  ├─ (app)/campaigns/[campaignId]/page.tsx              # monitor
│  │  │  ├─ (app)/campaigns/[campaignId]/candidates/[appId]/page.tsx
│  │  │  ├─ (app)/campaigns/[campaignId]/final/page.tsx        # ranked list + complete
│  │  │  ├─ (app)/campaigns/[campaignId]/analytics/page.tsx
│  │  │  ├─ (app)/analytics/page.tsx              # cross-campaign trends
│  │  │  └─ (app)/settings/page.tsx
│  │  ├─ features/                   # job-chat/, workflow-editor/, campaign/, final-list/, analytics/
│  │  ├─ middleware.ts
│  │  └─ next.config.ts
│  └─ candidate/                     # jobs.hirevine.app
│     ├─ app/
│     │  ├─ (auth)/sign-in, sign-up
│     │  ├─ (public)/jobs/page.tsx, jobs/[jobId]/page.tsx, a/[slug]/page.tsx
│     │  ├─ (public)/privacy, terms, ai-evaluation   # consent and policy pages
│     │  ├─ (app)/applications/page.tsx              # tracker
│     │  ├─ (app)/applications/[appId]/page.tsx      # detail + next action
│     │  ├─ (app)/applications/[appId]/quiz/page.tsx
│     │  ├─ (app)/applications/[appId]/interview/page.tsx
│     │  ├─ (app)/applications/[appId]/feedback/page.tsx
│     │  ├─ (app)/apply/[jobId]/page.tsx
│     │  ├─ (app)/analytics/page.tsx
│     │  └─ (app)/account/page.tsx                   # notifications, export, delete
│     ├─ features/                   # apply/, tracker/, quiz-runner/, interview/, feedback/, analytics/
│     └─ middleware.ts
├─ packages/
│  ├─ ui/              # design tokens, shadcn components, AppShell, layouts, forms, toasts,
│  │                   # StatusBadge, EvidenceList, CitationChip, Countdown, EmptyState, ProcessingState
│  ├─ api-client/      # generated schema.d.ts, createApiClient(), query keys, error helpers, SSE reader
│  └─ config/          # tsconfig bases, eslint config, tailwind preset, prettier
├─ turbo.json
└─ pnpm-workspace.yaml
```

**Turbo pipeline.** `gen:api` (regenerates `packages/api-client/src/schema.d.ts` from `apps/api/openapi.json`) feeds `typecheck`, `lint`, `test` and `build`. Each app depends on `^build` of the packages. Remote caching is optional.

**Import boundaries.** An ESLint `no-restricted-imports` rule blocks `@xyflow/react` and `recharts` inside `apps/candidate`, and blocks `@supabase/*` data methods (`.from(`) in both apps. Supabase is for auth and storage only.

---

## 4. Auth and role routing

| Piece | Behavior |
| --- | --- |
| Sign-up | Each app has its own page. The manager page asks for the organization name. Supabase `signUp` with `options.data.role`, then `POST /v1/me/profile` (idempotent), which creates the profile and, for managers, the org. The candidate page includes an 18+ confirmation |
| Sign-in | Email + password and magic link (Supabase). After sign-in: `GET /v1/me` |
| `middleware.ts` | Refreshes the session cookie via `@supabase/ssr`. Unauthenticated users on `(app)` routes are redirected to `/sign-in?next=…`. Signed-in users whose role does not match the app are redirected to the other app's URL (`NEXT_PUBLIC_OTHER_APP_URL`) |
| API calls | The `openapi-fetch` middleware attaches `Authorization: Bearer <access_token>` from the Supabase session. On a 401 it refreshes once and retries. On a 403 `wrong_app` it redirects to the other app |
| Security note | Redirects are for user experience only. The API's role-guarded route groups and RLS enforce access (§8) |

---

## 5. API client conventions (`packages/api-client`)

```ts
// createApiClient.ts
export function createApiClient(getToken: () => Promise<string | null>) {
  const client = createClient<paths>({ baseUrl: process.env.NEXT_PUBLIC_API_URL });
  client.use({ async onRequest({ request }) { /* bearer */ }, async onResponse({ response }) { /* 401 / wrong_app */ } });
  return client;
}

// queryKeys.ts
export const qk = {
  jobs: () => ["jobs"] as const,
  workflow: (jobId: string) => ["workflow", jobId] as const,
  campaign: (id: string) => ["campaign", id] as const,
  application: (id: string) => ["application", id] as const,
  myApplications: () => ["my-applications"] as const,
  // ...
};
```

| Convention | Detail |
| --- | --- |
| Error envelope | `{error:{code,message,details}}` → `ApiError`. `toastForError()` maps codes to plain-language messages |
| Special codes | `stale_base_version` (409): open the conflict dialog, refetch the workflow, offer to re-preview the same patches. `ai_paused` (503): banner. `rate_limited` (429): inline message with the retry time. `stage_closed` (409): send the candidate back to the application page |
| Async work | Background jobs run on Inngest and start as soon as they are triggered. The API reports their status from its `job_runs` table. Endpoints that return `202 {status: "processing" | "queued_budget"}` use the `ProcessingState` component and poll with `refetchInterval` (5 s while processing, stopping when the status changes). `queued_budget` shows "Queued, will process tomorrow" (§10) |
| Streaming | `readSSE(response, onToken)` in the package, used by the interview page (`fetch` + `ReadableStream`, with `AbortController` on unmount) |
| Types for forms | Zod schemas in `packages/api-client/src/zod/` are written to match the OpenAPI component schemas. A type test asserts `z.infer<…>` is assignable to the generated type, so they cannot drift silently |

---

## 6. Shared UI package (`packages/ui`)

| Component | Used for |
| --- | --- |
| `AppShell`, `PageHeader`, `Sidebar` | Layout for both apps (manager: sidebar; candidate: top bar + bottom nav on mobile) |
| `StatusBadge` | One mapping from the API's status enums to labels and colors, shared so both apps word things the same way |
| `EvidenceList`, `CitationChip` | A criterion row: name, weight, score, rationale and quoted line. A chip scrolls to and highlights the cited resume line, quiz question or interview turn. Shows `no_evidence`, `must_have_missing` and `possible_injection` flags |
| `ResumeViewer` | Redacted resume text with line numbers and highlight targets |
| `TranscriptView` | Interview turns, numbered, highlightable |
| `Countdown` | Shows the time left until a server-given `deadline_at`. It never relies on the client clock alone: it re-syncs on each server response |
| `ProcessingState`, `EmptyState`, `ErrorState` | Standard async states |
| `ConfirmDialog` | Destructive and irreversible confirmations (typed confirmation for completing a campaign) |
| `DiffView` | Renders the workflow diff returned by `/workflow/preview` |
| `Toaster`, form fields (RHF-bound inputs, selects, sliders, switches) | General |

Design tokens are CSS variables in a Tailwind preset, with light and dark themes. Contrast is AA, focus rings are always visible, and nothing relies on color alone (every status has a text label and an icon).

---

## 7. Manager app (`apps/manager`)

### 7.1 Home `/`
- Lists jobs (draft, published, closed) and open campaigns with per-campaign counts: applicants, awaiting action, needs review. Includes a "New job" call to action.

### 7.2 Job chat `/jobs/new` (§4 step 1)
- A chat thread UI. Each send calls `POST /v1/manager/jobs/chat {thread_id?, message}`.
- The response carries `assistant_message`, `missing_fields[]` (rendered as quick-reply chips: seniority, must-have skills, location, quiz length) and `summary` once nothing is missing.
- The summary card shows the role, seniority, location, must-haves, and the proposed rubric with weights. Protected-characteristic **warnings** are shown on the affected criteria. The manager can confirm or keep chatting.
- Confirm calls `POST /jobs/chat/{thread_id}/confirm`, then redirects to `/jobs/{id}/workflow`.
- `thread_id` lives in the URL (`?t=`), so a refresh resumes the chat (the backend checkpoints it).
- Each send can take several seconds (LLM). Show a typing state, disable send while one is in flight, and allow cancel.

### 7.3 Workflow editor `/jobs/[jobId]/workflow` (§4 steps 2–3, §6)

**Layout.** The React Flow canvas fills the main area. The config side panel sits on the right. A toolbar holds version, undo, history, "Edit by chat" and Publish.

**Canvas**
- Custom node components `ScreeningNode`, `QuizNode`, `InterviewNode` and `FinalNode`. Each shows its key settings (cutoff, number of questions, turn cap, notify toggle) and an enabled/disabled state.
- The chain is fixed (screening → quiz → interview → final). There is no free-form edge drawing, and the nodes are not draggable into new orders. `nodesConnectable={false}`. Positions are auto-laid out left to right, and dragging only moves positions visually (not saved).
- Quiz and interview show a switch that emits `toggle_node`. Screening and final cannot be disabled.

**Side panel.** One form per node type, built with React Hook Form + Zod.

| Node | Form fields | Emits |
| --- | --- | --- |
| Screening | Cutoff slider (0–100). Criteria table: name, weight (1–5), must-have; add, remove, reorder | `set_cutoff`, `add_criterion`, `update_criterion`, `remove_criterion` |
| Quiz | Pass mark, time limit, "Generate questions" (calls `/quiz/generate`, then polls), question list with an editor per question (prompt, options, correct option radio, explanation, difficulty) | `set_pass_mark`, `add_quiz_question`, `replace_quiz_question`, `remove_quiz_question` |
| Interview | Prompt additions (textarea with the note "added inside a fixed wrapper that keeps the interview fair and on-topic"), themes, rubric items with weights, turn cap (3–10), pass threshold | `edit_interview_prompt`, `update_interview_rubric`, `set_turn_cap`, `set_pass_mark` |
| Final | Notify-on-complete switch, ranking rule (display only in v1) | `set_notify` |

**Patch flow** (the same for panel and chat):
1. A form submit runs `diffFormToPatches(baseDefinition, formValues)`, a pure function that turns the edit into a minimal patch list.
2. Call `POST /workflow/preview {base_version, patches}`.
3. The `DiffView` modal shows what changes. If `affects_running_campaign` is true, it shows the banner: *"This campaign is running. The change applies only to candidates who have not reached this stage yet."* plus `affected_stage_note`.
4. On confirm, `POST /workflow/apply {base_version, patches, source}`, then invalidate `qk.workflow(jobId)` and show a toast with **Undo**, which calls `POST /workflow/undo`.
5. On a 409, the conflict dialog refetches the workflow and re-previews the same patches against the new base.

**Chat override drawer**
- Free text such as "raise the cutoff to 70 and make the quiz harder" calls `POST /workflow/chat`.
- It returns `{patches, explanation}`. It shows the explanation and a patch list in plain language, then joins the same preview → apply flow.
- The drawer never applies anything directly.

**Version history.** `GET /workflow/versions` opens a sheet listing each version with its source (panel, chat, undo), author and time. Selecting one shows a read-only diff against the current version.

**Publish.** A confirm dialog explains that the version is frozen for this campaign and that a shareable apply link is created. Calls `POST /jobs/{id}/publish`, then shows the share link with a copy button.

**Editor state (Zustand).** `selectedNodeId`, `drawerOpen`, `pendingPatches`. The workflow definition itself always comes from TanStack Query, so the server is the source of truth.

### 7.4 Campaign monitor `/campaigns/[campaignId]` (§4 step 5)
- Header: job title, status, applicants, notify toggle, AI pause (kill switch) toggle, share link.
- Stage strip: one card per enabled node with counts (pending, in progress, passed, failed, needs review).
- Tabs: **All**, **Processing**, **Needs attention** (`needs_review`, `no_evidence`, `possible_injection`, `must_have_missing`, `unreadable`) and **Awaiting scoring** (budget-deferred, with a "Score now" action).
- Table: candidate (redacted label, for example "Candidate #A7F2", plus the display name if the backend returns it), current stage, status, match %, flags, and last update.
- Polling every 15 s while the campaign is open.
- Row actions: open the candidate, retry (`/retry`), and manual score (a dialog with a score per criterion and a note, `/manual-score`).

### 7.5 Candidate detail `/campaigns/[campaignId]/candidates/[appId]`
- A two-column layout:
  - **Left:** the stage timeline, plus a section per stage. Screening shows `EvidenceList` (criterion, weight, score, rationale, quoted line) and the match %. The quiz shows per-question correctness and the explanations. The interview shows rubric scores with turn citations.
  - **Right:** `ResumeViewer` or `TranscriptView`, synced to the selected citation.
- The flags banner is at the top.
- Feedback panel: the AI draft (read-only, shown as "AI draft"), an editable text area (`edited_text`), a **Suggested** recommendation selector, a manager note and an exclude switch. Autosave is debounced (1 s) to `PATCH …/feedback`, with a "saved" indicator.

### 7.6 Final list and completion `/campaigns/[campaignId]/final` (§4 steps 6–7)
- Ranked table: rank, candidate, overall score, stage scores, flags, suggested recommendation, feedback status (draft / edited) and excluded state. Each row expands to show the evidence summary and links to the detail page.
- Filters: recommendation, flags, edited or not.
- Bulk view: a feedback preview for each candidate, so the manager can review and edit everything before release.
- **Complete campaign**: a `ConfirmDialog` that states:
  - It is irreversible.
  - Outcomes and feedback are released to all N candidates.
  - It shows the notify toggle state (editable in the dialog).
  - It counts candidates whose feedback is still an unedited AI draft.

  The manager must type the job title to confirm. Calls `POST /campaigns/{id}/complete`, then the page becomes read-only with a "Released on …" banner.

### 7.7 Analytics (§12)

| View | Chart (Recharts) | Endpoint |
| --- | --- | --- |
| Funnel by stage | Horizontal bars per stage (reached → passed), drop-off % labeled between them | `/analytics/campaigns/{id}` |
| Score distribution | Histogram of match % and quiz score (10-point bins) with the cutoff as a reference line | same |
| Cutoff impact | Small table: candidates passing at cutoff −10, −5, current, +5, +10 | same |
| Time per stage | Bars of median hours per stage | same |
| Time to shortlist | Stat with the trend | `/analytics/overview` |
| Feedback acceptance, recommendation agreement | Two stat tiles with percentages | both |
| Trends | Line: applications per week per job. Bars: campaigns completed per month | `/analytics/overview` |
| Model usage | Bars: requests and fallbacks per campaign | same |

Build order (§12): funnel and score distribution first. Charts are lazy-loaded (`next/dynamic`) so the editor bundle stays small. Each chart has a table toggle for accessibility.

### 7.8 Settings `/settings`
- Organization name, account, and the default notify-on-complete preference.
- The per-campaign AI pause stays on the campaign page.
- Links to the privacy and AI-evaluation pages.

---

## 8. Candidate app (`apps/candidate`)

### 8.1 Browse and apply (§5)
- **`/jobs`**: search box + filters (location, seniority) calling `GET /v1/public/jobs`. Server-rendered for the first page (good for sharing and SEO), with infinite scroll after that. Works signed out.
- **`/jobs/[jobId]`**: description, stages the candidate will go through (screening, quiz with its time limit, AI interview with its turn cap), and an Apply button.
- **`/a/[slug]`**: resolves the share link via `/public/share/{slug}`, then redirects to the job page.
- **`/apply/[jobId]`**, a 3-step form (sign-in required, with a redirect back afterwards):
  1. **Resume.** Pick a PDF or DOCX ≤ 5 MB, checked on the client. Then `POST /candidate/applications/upload-url`, then upload with `PUT` directly to the signed Supabase Storage URL with a progress bar. The file never passes through the API (4.5 MB body limit, §8).
  2. **Questions.** Any screening questions for the job.
  3. **Consent.** A plain-language explanation of what is scored, that an AI assists, that only redacted text reaches model providers, and which processors handle their data (the list the API returns: model hosts, plus Inngest for background jobs), and that a person makes the decision. A link to `/ai-evaluation`. Required checkboxes: consent and the 18+ confirmation.

  Submit calls `POST /candidate/applications`, then goes to the tracker with a "Application received" toast.

### 8.2 Application tracker `/applications`
- A card per application: job, company, the status badge from the API, the **next action** button (Take quiz or Start interview) with its deadline, and the last update.
- Sort: actions due first.
- Statuses are rendered exactly as the API sends them. A candidate who failed a cutoff sees **In review**, the same as everyone waiting for final results (§5).
- Polling every 30 s while any application is `received` and processing. The in-app notifications bell uses `/candidate/notifications`.

### 8.3 Application detail `/applications/[appId]`
- The stage list with neutral states (done, next step, upcoming). There are no scores before release.
- Next-step instructions, the deadline, and a link to feedback once it is released.

### 8.4 Quiz runner `/applications/[appId]/quiz`
1. **Pre-start screen.** Number of questions, time limit, one attempt, and the fact that answers autosave. "Start quiz" calls `POST …/quiz/start`, which returns the questions (no answers) and `deadline_at`.
2. **Runner.** One question per screen on mobile and a list on desktop. A question navigator. A `Countdown` to `deadline_at`. Answers autosave (debounced at 800 ms plus on each navigation) with `PUT …/quiz/answers`.
3. **Resume.** Reopening the page re-calls `start`, which returns the existing attempt with the saved answers. The timer continues from the server deadline.
4. **Submit.** Confirm, then `POST …/quiz/submit`. At the deadline the client auto-submits, and the server also closes the attempt.
5. **After submit.** "Submitted. You'll be told about next steps." No score is shown.

Offline handling: if a save fails, show a "reconnecting" banner and keep the answers in memory plus `sessionStorage` (wrapped in try/catch). Retry with backoff.

### 8.5 AI interview `/applications/[appId]/interview`
1. **Pre-start disclosure** (required, §5): "This interview is conducted by an AI." It also shows the number of questions (turn cap), the time limit, one attempt, and what is evaluated. A Start button calls `POST …/interview/start`.
2. **Chat UI.** AI questions and candidate answers, a turn counter ("Question 3 of 6"), a `Countdown`, and an answer box (≤ 2,000 chars with a counter). Send calls `POST …/interview/turn`, and the next question **streams** in through `readSSE`. Input is disabled while a reply streams.
3. **Resume** (§5): on load, `GET …/interview` restores the transcript, turns left and the deadline.
4. **End.** After the last turn, or with "Finish interview", call `POST …/interview/finish`. Shows "Thanks. Your responses are being reviewed."
5. **Budget pause.** If the API reports the session is paused (daily cap), show "We'll let you know when you can continue." The session resumes from where it stopped.

### 8.6 Feedback `/applications/[appId]/feedback`
Available only after release. The API returns 404 before release, and the page then shows "Feedback is not available yet."

The page shows:
- The outcome and match score.
- The personalized feedback text.
- The evidence sections:
  - their resume lines, with `CitationChip` jumping to the highlighted line of their own redacted resume
  - their quiz answers with the explanations
  - their interview moments, as quoted turns
- A "Was this feedback useful?" 1–5 rating (a pilot measure). Its endpoint is to be added to the backend with the pilot checklist.

### 8.7 Personal analytics `/analytics` (§12)
- Applications over time (weekly counts), how far each application progressed, the score trend across **released** applications only, time to outcome, and stage completion rate.
- **No Recharts.** Use simple SVG components in `apps/candidate/features/analytics/` (bar list, sparkline, progress bars). This keeps the bundle small, and the data volumes are tiny.

### 8.8 Account and privacy `/account`, `/privacy`, `/terms`, `/ai-evaluation`
- Notifications, a data export request (`POST /candidate/privacy/export`, which emails or shows a download link when ready), and a deletion request (`POST /candidate/privacy/delete` with a typed confirmation and an explanation of what is deleted).
- The static policy pages are linked from the consent step and the footer. The privacy notice names every processor, including Inngest for background jobs (product doc §11). Their copy needs legal review before the pilot (§11).

### 8.9 Performance budget
- First-load JS of 150 KB gzip or less on `/jobs` and `/applications`, checked in CI with `@next/bundle-analyzer` output plus a size-limit script.
- Interactive-ready (LCP) of 2.5 s or less on Moto G-class throttling, using Lighthouse CI on preview deploys.
- Images are `next/image`. There are no heavy client libraries, and the quiz and interview routes are code-split.

---

## 9. Shared UX states and accessibility

| State | Where | UI |
| --- | --- | --- |
| Loading | Everywhere | Skeletons, not spinners, for lists and tables |
| Processing | Resume screening, quiz generation, report drafting | `ProcessingState`: "Processing, this usually takes a minute or two", plus polling. Jobs start right away, with no queue wait, so a status still `queued` after 5 minutes shows "Taking longer than usual" |
| Queued for tomorrow | Daily model budget exhausted | "Queued, will process tomorrow" with an info tooltip explaining free-tier limits |
| Needs review | Manager only | Amber flag + reason + retry or manual-score actions |
| AI paused | Manager campaign page, candidate next steps | A banner on the manager side. Candidates see "Next step is temporarily unavailable" |
| Empty | Lists | `EmptyState` with the primary action |
| Error | Everywhere | `ErrorState` with retry. Sentry captures it |

Accessibility:
- Every editor action is reachable without the canvas: the side panel and a node list are keyboard-navigable, and nodes are focusable buttons.
- Dialogs trap focus and restore it on close.
- Streamed interview text goes into an `aria-live="polite"` region.
- Countdowns announce at 5 min and 1 min left.
- Charts have table alternatives.

Mobile:
- The candidate app is designed mobile-first.
- The manager app targets desktop and tablet. On narrow screens the editor falls back to the node list + panel without the canvas.

---

## 10. Testing

| Layer | Tooling | Covers |
| --- | --- | --- |
| Unit | Vitest | `diffFormToPatches` for each node type (form edits → minimal, correct patches), status-badge mapping, countdown math, SSE reader, error-code mapping |
| Parity | Vitest | **The same change through the panel and through a mocked chat response produces identical patch lists**, which mirrors the Phase 4 exit check |
| Component | Testing Library + MSW | Editor preview/apply/undo/409 flow, the complete-campaign dialog, the apply wizard including upload failure, quiz autosave + resume, interview resume |
| Type contract | `tsc` + type tests | Zod schemas assignable to the generated OpenAPI types; `gen:api` drift fails CI |
| E2E | Playwright against local Supabase + the API with a stubbed LLM | Manager creates a job via chat, then edits by panel and by chat, then publishes. Candidate applies, then takes the quiz, then completes the interview. **The candidate's feedback page shows "not available yet" until completion.** Manager edits feedback and completes. The candidate sees the outcome and citations |
| Accessibility | `@axe-core/playwright` on key pages | No serious violations |
| Performance | Lighthouse CI + size-limit (candidate app) | §8.9 budgets |

---

## 11. Deployment

- **Two Vercel projects** from the monorepo. Root Directory is `apps/manager` and `apps/candidate`. The build command is `turbo run build --filter=<app>...`, and the "ignored build step" uses `turbo-ignore`.
- **Domains**, for example `manager.hirevine.app` and `jobs.hirevine.app`. The API is the third Vercel project, for example `api.hirevine.app`, and its `CORS_ORIGINS` lists both app origins.
- **Previews**: per-PR preview deploys point at a staging API and Supabase project.

| Env var | Manager | Candidate |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✓ | ✓ |
| `NEXT_PUBLIC_API_URL` | ✓ | ✓ |
| `NEXT_PUBLIC_OTHER_APP_URL` | candidate URL | manager URL |
| `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN` | ✓ | ✓ |
| `NEXT_PUBLIC_DEMO_MODE` | ✓ (shows the "pre-run synthetic campaign" banner) | ✓ |

**CI** (GitHub Actions), in order:
1. `pnpm install --frozen-lockfile`
2. Download the API's `openapi.json` artifact, then `turbo gen:api`
3. `turbo typecheck lint test`
4. Playwright on main
5. Lighthouse CI + size-limit on candidate previews

---

## 12. Build phases (§15)

The frontend work for each phase. A phase is done when its exit check passes.

| # | Phase | Frontend tasks | Exit check |
| --- | --- | --- | --- |
| 1 | Foundations | Monorepo, `packages/config`, `packages/ui` (tokens, shell, base components), `packages/api-client` generation, both apps with sign-in/sign-up, middleware role redirect, `/me` call, three Vercel projects, CI | Doc: two users in different orgs cannot read each other's rows. **Frontend:** a manager signing into the candidate app is redirected, and both apps call the API with a bearer token |
| 2 | LLM layer | `ProcessingState` and `queued_budget` UI components, polling helper | Doc: smoke test + budget counter + an Inngest function that retries a failed step without repeating finished ones. **Frontend:** the processing and queued states render from mocked 202 responses |
| 3 | Workflow model | Zod mirrors of the workflow and patch schemas, `diffFormToPatches`, `DiffView` | Doc: property tests on patches/undo. **Frontend:** unit tests show each form edit yields the minimal valid patch list |
| 4 | Job creation and editing | Job chat page, React Flow editor with custom nodes, side panels, chat override drawer, preview/apply/undo, version history, conflict dialog, publish | Doc: chat and hand edits produce identical patches; the patch agent meets its eval target. **Frontend:** the parity test passes and the editor E2E (edit → preview → apply → undo) is green |
| 5 | Applications and screening | Candidate job browse/detail/share link, apply wizard with direct upload and consent, manager campaign monitor, candidate detail with `EvidenceList` + `ResumeViewer` | Doc: screening evals + injection. **Frontend:** a synthetic application shows up in the monitor with evidence and flags, and every citation highlights its line |
| 6 | Quiz | Manager quiz editor + generate, candidate quiz runner with autosave, resume and the deadline | Doc: quiz validity + exact grading. **Frontend:** the quiz resume test passes after a forced reload, and auto-submit at the deadline works |
| 7 | AI interview | Interview disclosure, streamed chat, turn counter, resume, finish; manager transcript view with turn citations | Doc: scoring consistency. **Frontend:** a reconnect in the middle of the interview restores the transcript and the remaining turns |
| 8 | Final report and completion | Final ranked list, feedback editor with autosave, recommendation selector, exclude/note, complete dialog with the notify toggle | Doc: a candidate cannot see outcomes or feedback before release. **Frontend:** the E2E asserts the feedback page shows "not available yet" before completion |
| 9 | Candidate portal | Tracker, application detail, notifications, feedback view with citations, account/export/delete, policy pages | Doc: the end-to-end test runs from job creation to released feedback (the Playwright suite) |
| 10 | Analytics | Manager dashboards (funnel and distribution first), candidate SVG analytics | Doc: dashboard numbers match hand-computed values on a fixed synthetic campaign (a Playwright check against the seeded campaign) |
| 11 | Hardening and delivery | Accessibility pass, performance budgets, the demo-mode banner on the pre-run synthetic campaign, Sentry, the error and empty state audit, README screenshots | Doc: the README reports real eval numbers and the demo runs from the deployed app |

Phase 9 can overlap with phases 6–7 once applications exist (§15).

---

**As built (Phase 5):** `/jobs` (search + location), `/jobs/[jobId]` (stages from `/public/jobs/{id}`), `/a/[slug]`, the apply page (direct XHR upload with progress → consent with the processor list and version from `/v1/public/consent` → submit), tracker cards with status badges, and `/applications/[appId]`. Manager: `/campaigns/[campaignId]` (stage strip, tabs All / Needs review / Possible injection / Passed screening, 15 s polling, retry) and the candidate page with `EvidenceList` ↔ `ResumeViewer` citation sync. Shared: `StatusBadge`, `FlagBadges`, `EvidenceList`, `CitationChip`, `ResumeViewer` in `packages/ui/blocks`. Deferred: the job board is client-rendered (no SSR first page or infinite scroll yet), there is no screening-questions step (workflows have no questions yet), and manual scoring and the AI-pause toggle arrive with their endpoints. E2E `monitor.spec.ts` is the exit check.

**As built (Phase 6):** Manager: the quiz panel's "Generate from the job and rubric" box (count, difficulty, replace) starts a run and polls it every 3 s; questions arrive as a new version with a toast, and failures show the run's error. It is disabled while the panel has unsaved edits. The candidate page shows a Quiz card with per-question results (`QuizResults`). Candidate: `/applications/[appId]/quiz` with an intro (count, time, one attempt), then `QuizRunner` (`packages/ui/blocks/quiz-runner.tsx`): autosave 600 ms after a change, a countdown from the server deadline corrected for clock skew, flush-then-submit, and auto-submit at zero. If the server's deadline job submitted first, the page shows the submitted state. Exit check: `e2e/candidate-quiz.spec.ts` (reload resumes the attempt; auto-submit at the deadline) runs the candidate app on :3200 when `E2E_CANDIDATE_EMAIL` / `E2E_CANDIDATE_PASSWORD` are set in `apps/manager/.env.e2e.local`, and is skipped otherwise. `packages/ui/test/quiz-runner.test.tsx` covers the same behaviour without an account; `e2e/quiz.spec.ts` covers the manager side. `StatusBadge` takes an optional `stage`, so a failed quiz reads "Below pass mark".

## 13. Open items

| Item | Notes |
| --- | --- |
| Visual design language | Tokens and component styling in `packages/ui`. Settle before Phase 4 so the editor and the candidate app share one look |
| Candidate identity in the manager UI | Does the manager see real names before completion, or redacted labels? The plan assumes the API decides and the UI shows whatever it returns. Confirm with the backend |
| Feedback usefulness rating | Needs a backend endpoint (pilot measure, §2). Not in the backend v1 endpoint table yet |
| Email notification copy | Needed for stage invites and release (pilot) |
| Vercel project limits on Hobby | Three projects from one repo. Check the current limits (§16) |
| Consent and privacy copy | Legal review before real data (§11). It must name Inngest as a processor alongside the model hosts |
