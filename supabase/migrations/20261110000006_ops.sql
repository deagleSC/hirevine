-- Job status, audit log, privacy requests, rate limits.

create table job_runs (
  id              uuid primary key default gen_random_uuid(),
  type            text not null,
  org_id          uuid references organizations (id) on delete cascade,
  application_id  uuid references applications (id) on delete cascade,
  campaign_id     uuid references campaigns (id) on delete cascade,
  job_id          uuid references jobs (id) on delete cascade,
  status          text not null default 'queued'
                    check (status in ('queued', 'running', 'deferred_budget', 'paused', 'done', 'failed')),
  attempts        int not null default 0,
  inngest_run_id  text,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index job_runs_application_idx on job_runs (application_id);
create index job_runs_status_idx on job_runs (status, updated_at);

-- Append-only: no update/delete grant or policy.
create table events (
  id          bigserial primary key,
  actor_id    uuid,
  org_id      uuid references organizations (id) on delete cascade,
  type        text not null,
  entity      text not null,
  entity_id   uuid,
  payload     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index events_org_idx on events (org_id, created_at);
create index events_entity_idx on events (entity, entity_id);

create table data_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles (id) on delete cascade,
  kind          text not null check (kind in ('export', 'delete')),
  status        text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  export_path   text,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);

create table rate_limits (
  key           text not null,
  window_start  timestamptz not null,
  count         int not null default 0,
  primary key (key, window_start)
);
