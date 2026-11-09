-- Applications and per-stage results.

create table applications (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references campaigns (id) on delete cascade,
  candidate_id  uuid not null references profiles (id) on delete cascade,
  workflow_id   uuid not null references workflows (id),   -- the version this candidate is judged by
  status        text not null default 'active' check (status in ('active', 'withdrawn')),
  current_node  text,
  resume_path   text,
  consent_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (campaign_id, candidate_id)
);
create index applications_candidate_idx on applications (candidate_id);

create table consents (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references applications (id) on delete cascade,
  candidate_id    uuid not null references profiles (id) on delete cascade,
  text_version    text not null,
  providers       jsonb not null default '[]',
  ip_hash         text,
  created_at      timestamptz not null default now()
);
create index consents_application_idx on consents (application_id);

create table resume_texts (
  application_id   uuid primary key references applications (id) on delete cascade,
  raw_text         text not null,
  redacted_text    text not null,
  redacted_lines   jsonb not null default '[]',
  parser           text not null,
  injection_flags  jsonb not null default '[]',
  fts              tsvector generated always as (to_tsvector('english', redacted_text)) stored,
  created_at       timestamptz not null default now()
);
create index resume_texts_fts_idx on resume_texts using gin (fts);
create index resume_texts_trgm_idx on resume_texts using gin (redacted_text gin_trgm_ops);

create table screening_answers (
  application_id  uuid not null references applications (id) on delete cascade,
  question_id     text not null,
  answer          text not null,
  primary key (application_id, question_id)
);

create table stage_results (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references applications (id) on delete cascade,
  node_id         text not null,
  status          text not null default 'pending'
                    check (status in ('pending', 'in_progress', 'passed', 'failed', 'needs_review')),
  score           numeric(5, 1),
  evidence        jsonb not null default '[]',
  flags           text[] not null default '{}',
  prompt_version  text,
  model_id        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (application_id, node_id)       -- idempotency key for transitions
);
