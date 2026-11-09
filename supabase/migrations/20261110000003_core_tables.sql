-- Tenants, people, jobs, workflows, campaigns.

create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 1 and 200),
  created_at  timestamptz not null default now()
);

create table profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  role          text not null check (role in ('manager', 'candidate')),
  org_id        uuid references organizations (id) on delete cascade,
  display_name  text not null check (length(display_name) between 1 and 200),
  adult_confirmed boolean not null default false,
  created_at    timestamptz not null default now(),
  check (role = 'candidate' or org_id is not null),
  check (role = 'manager' or org_id is null)
);
create index profiles_org_idx on profiles (org_id);

create table jobs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations (id) on delete cascade,
  title       text not null,
  description text not null default '',
  location    text,
  seniority   text,
  status      text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  search      tsvector generated always as (
                to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))
              ) stored,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index jobs_org_idx on jobs (org_id);
create index jobs_status_idx on jobs (status);
create index jobs_search_idx on jobs using gin (search);

create table job_share_links (
  slug        text primary key check (slug ~ '^[a-z0-9-]{6,64}$'),
  job_id      uuid not null references jobs (id) on delete cascade,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);
create index job_share_links_job_idx on job_share_links (job_id);

create table workflows (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references jobs (id) on delete cascade,
  version         int not null check (version >= 1),
  parent_version  int,
  definition      jsonb not null,
  schema_version  int not null default 1,
  created_by      uuid references profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (job_id, version)
);

create table campaigns (
  id                  uuid primary key default gen_random_uuid(),
  job_id              uuid not null references jobs (id) on delete cascade,
  workflow_id         uuid not null references workflows (id),
  status              text not null default 'draft' check (status in ('draft', 'open', 'completed')),
  notify_on_complete  boolean not null default true,
  ai_paused           boolean not null default false,
  created_at          timestamptz not null default now(),
  completed_at        timestamptz,
  check ((status = 'completed') = (completed_at is not null))
);
create index campaigns_job_idx on campaigns (job_id);
