-- Quiz, interview, feedback and notifications.

create table quiz_attempts (
  id                  uuid primary key default gen_random_uuid(),
  application_id      uuid not null unique references applications (id) on delete cascade,
  questions_snapshot  jsonb not null,
  answers             jsonb not null default '{}',
  score               numeric(5, 1),
  started_at          timestamptz not null default now(),
  deadline_at         timestamptz not null,
  submitted_at        timestamptz
);

create table interview_sessions (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null unique references applications (id) on delete cascade,
  thread_id       text not null,
  transcript      jsonb not null default '[]',
  turn_count      int not null default 0,
  turn_cap        int not null check (turn_cap between 3 and 10),
  scores          jsonb,
  started_at      timestamptz not null default now(),
  deadline_at     timestamptz not null,
  finished_at     timestamptz
);

create table feedback (
  id                 uuid primary key default gen_random_uuid(),
  application_id     uuid not null unique references applications (id) on delete cascade,
  ai_draft           text,
  edited_text        text,
  recommendation     text check (recommendation in ('strong_yes', 'yes', 'maybe', 'no')),
  ai_recommendation  text check (ai_recommendation in ('strong_yes', 'yes', 'maybe', 'no')),
  manager_note       text,
  excluded           boolean not null default false,
  released           boolean not null default false,
  released_at        timestamptz,
  updated_at         timestamptz not null default now(),
  check (released = (released_at is not null))
);

create table notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles (id) on delete cascade,
  type        text not null,
  payload     jsonb not null default '{}',
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, created_at desc);
