-- Phase 4: agent threads and LangGraph checkpoints (backend plan §4.1 #0011, §12).
--
-- agent_threads records who owns each chat thread. The checkpoint tables hold the graph
-- state (chat history, drafts) and are system-only: the API checks thread ownership in
-- agent_threads first, then reads or writes checkpoints in system context.

create table agent_threads (
  thread_id   uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('jd', 'override')),
  org_id      uuid not null references organizations (id) on delete cascade,
  user_id     uuid not null references profiles (id) on delete cascade,
  job_id      uuid references jobs (id) on delete cascade,
  status      text not null default 'open' check (status in ('open', 'confirmed', 'closed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (kind = 'jd' or job_id is not null)
);
create index agent_threads_user_idx on agent_threads (user_id, kind, updated_at desc);

-- LangGraph checkpoint tables, as created by langgraph-checkpoint-postgres 3.2.0's
-- migrations 0–9 (indexes built non-concurrently since this runs in a transaction).
create table checkpoint_migrations (v integer primary key);

create table checkpoints (
  thread_id             text not null,
  checkpoint_ns         text not null default '',
  checkpoint_id         text not null,
  parent_checkpoint_id  text,
  type                  text,
  checkpoint            jsonb not null,
  metadata              jsonb not null default '{}',
  primary key (thread_id, checkpoint_ns, checkpoint_id)
);

create table checkpoint_blobs (
  thread_id      text not null,
  checkpoint_ns  text not null default '',
  channel        text not null,
  version        text not null,
  type           text not null,
  blob           bytea,
  primary key (thread_id, checkpoint_ns, channel, version)
);

create table checkpoint_writes (
  thread_id      text not null,
  checkpoint_ns  text not null default '',
  checkpoint_id  text not null,
  task_id        text not null,
  idx            integer not null,
  channel        text not null,
  type           text,
  blob           bytea not null,
  task_path      text not null default '',
  primary key (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);

create index checkpoints_thread_id_idx on checkpoints (thread_id);
create index checkpoint_blobs_thread_id_idx on checkpoint_blobs (thread_id);
create index checkpoint_writes_thread_id_idx on checkpoint_writes (thread_id);

-- Tell the library its schema is current, so it never runs DDL at runtime.
insert into checkpoint_migrations (v) select generate_series(0, 9);

-- ------------------------------------------------------------ RLS
alter table agent_threads          enable row level security;
alter table checkpoint_migrations  enable row level security;
alter table checkpoints            enable row level security;
alter table checkpoint_blobs       enable row level security;
alter table checkpoint_writes      enable row level security;

create policy agent_threads_own on agent_threads for all to hirevine_api
  using (app.is_role('manager') and user_id = app.current_user_id() and org_id = app.current_org_id())
  with check (app.is_role('manager') and user_id = app.current_user_id() and org_id = app.current_org_id());
create policy agent_threads_system on agent_threads for all to hirevine_api
  using (app.is_role('system')) with check (app.is_role('system'));

create policy checkpoint_migrations_system on checkpoint_migrations for all to hirevine_api
  using (app.is_role('system')) with check (app.is_role('system'));
create policy checkpoints_system on checkpoints for all to hirevine_api
  using (app.is_role('system')) with check (app.is_role('system'));
create policy checkpoint_blobs_system on checkpoint_blobs for all to hirevine_api
  using (app.is_role('system')) with check (app.is_role('system'));
create policy checkpoint_writes_system on checkpoint_writes for all to hirevine_api
  using (app.is_role('system')) with check (app.is_role('system'));

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on agent_threads, checkpoint_migrations, checkpoints, checkpoint_blobs,'
                     ' checkpoint_writes from %I', r);
    end if;
  end loop;
end
$$;
