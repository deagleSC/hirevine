-- Phase 5: applications and screening (backend plan §4.2, §13, §18).

create extension if not exists vector;

-- Resume chunks (parent = application) and rubric criteria (parent = workflow version).
-- Written and read only by the screening job, so the table is system-only.
create table embeddings (
  id               uuid primary key default gen_random_uuid(),
  parent_id        uuid not null,
  kind             text not null check (kind in ('resume_chunk', 'criterion')),
  chunk_index      int not null check (chunk_index >= 0),
  text_hash        text not null,
  embedding        vector(384) not null,
  embedding_model  text not null,
  created_at       timestamptz not null default now(),
  unique (parent_id, kind, chunk_index)
);
create index embeddings_hnsw_idx on embeddings using hnsw (embedding vector_cosine_ops);

alter table embeddings enable row level security;
create policy embeddings_system on embeddings for all to hirevine_api
  using (app.is_role('system')) with check (app.is_role('system'));

-- Embeddings of an application go with it (no FK: parent_id may also be a workflow).
create or replace function app.delete_application_embeddings() returns trigger
  language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  delete from embeddings where parent_id = old.id and kind = 'resume_chunk';
  return old;
end
$$;
create trigger applications_delete_embeddings after delete on applications
  for each row execute function app.delete_application_embeddings();

-- Shortlist score from the prefilter (§13 step 5): orders work, never rejects.
alter table applications add column prefilter_score numeric(6, 4);
create index stage_results_status_idx on stage_results (node_id, status);

-- The public job board joins open campaigns (candidates could already read them).
create policy campaigns_public_read on campaigns for select to hirevine_api
  using (app.is_role('public') and status = 'open' and app.job_published(job_id));

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on embeddings from %I', r);
    end if;
  end loop;
end
$$;

-- Private resume bucket (Supabase only; plain Postgres has no storage schema).
-- No storage.objects policies: only signed URLs and the service key reach it (§18).
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('resumes', 'resumes', false, 5242880,
            array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
    on conflict (id) do nothing;
  end if;
end
$$;
