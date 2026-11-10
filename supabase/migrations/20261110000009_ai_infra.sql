-- Phase 2: LLM infrastructure (backend plan §4.2, §11).
-- llm_cache / llm_budget / llm_rpm are touched only by the API in system context.
-- skill_aliases is created now; its readers arrive in Phase 5. The embeddings table
-- (pgvector) is added in Phase 5 with the screening pipeline that writes it.

create table llm_cache (
  key_hash        text primary key,
  response        jsonb not null,
  model_id        text not null,
  prompt_id       text not null,
  prompt_version  int not null,
  created_at      timestamptz not null default now()
);
create index llm_cache_prompt_idx on llm_cache (prompt_id, prompt_version);

-- One row per UTC day and model. model_id '*' is the account-wide counter that
-- enforces LLM_DAILY_CAP (OpenRouter's free cap is per account, not per model);
-- the per-model rows record which model actually served each call.
create table llm_budget (
  day            date not null,
  model_id       text not null,
  requests_used  int not null default 0 check (requests_used >= 0),
  primary key (day, model_id)
);

-- Request-path calls only (chats, interview turns). Inngest throttles background calls.
create table llm_rpm (
  minute_bucket  timestamptz primary key,
  requests       int not null default 0 check (requests >= 0)
);

create table skill_aliases (
  alias      text primary key check (alias = lower(alias)),
  canonical  text not null check (canonical = lower(canonical))
);

-- ------------------------------------------------------------ RLS
alter table llm_cache      enable row level security;
alter table llm_budget     enable row level security;
alter table llm_rpm        enable row level security;
alter table skill_aliases  enable row level security;

create policy llm_cache_system on llm_cache for all to hirevine_api
  using (app.is_role('system')) with check (app.is_role('system'));
create policy llm_budget_system on llm_budget for all to hirevine_api
  using (app.is_role('system')) with check (app.is_role('system'));
create policy llm_rpm_system on llm_rpm for all to hirevine_api
  using (app.is_role('system')) with check (app.is_role('system'));

-- Reference data: any API context may read, only system may write.
create policy skill_aliases_read on skill_aliases for select to hirevine_api using (true);
create policy skill_aliases_system on skill_aliases for all to hirevine_api
  using (app.is_role('system')) with check (app.is_role('system'));

-- New tables pick up Supabase's default grants to anon/authenticated. Remove them.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on llm_cache, llm_budget, llm_rpm, skill_aliases from %I', r);
    end if;
  end loop;
end
$$;
