-- RLS helper functions and the restricted API role.
-- Policies call these helpers instead of Supabase's auth.uid(), so moving off
-- Supabase only means changing how FastAPI sets `app.claims`.

create schema if not exists app;

-- Claims are set by FastAPI at the start of every transaction:
--   select set_config('app.claims', '{"sub": "...", "role": "...", "org_id": "..."}', true)
-- Clients never connect to the database directly, so they cannot set this.
create or replace function app.claims() returns jsonb
  language sql stable
as $$
  select coalesce(nullif(current_setting('app.claims', true), ''), '{}')::jsonb
$$;

create or replace function app.current_user_id() returns uuid
  language sql stable
as $$ select nullif(app.claims() ->> 'sub', '')::uuid $$;

-- 'manager' | 'candidate' | 'system' | 'public' | null (no profile yet)
create or replace function app.current_role() returns text
  language sql stable
as $$ select nullif(app.claims() ->> 'role', '') $$;

create or replace function app.current_org_id() returns uuid
  language sql stable
as $$ select nullif(app.claims() ->> 'org_id', '')::uuid $$;

-- Restricted login role used by the API. No BYPASSRLS, never the service role.
-- The password is set outside migrations:  alter role hirevine_api with login password '...';
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'hirevine_api') then
    create role hirevine_api nologin noinherit;
  end if;
end
$$;

grant usage on schema app to hirevine_api;
grant usage on schema public to hirevine_api;
grant execute on all functions in schema app to hirevine_api;

-- Tables created later by the migration owner are usable by the API role
-- (RLS still decides which rows).
alter default privileges in schema public
  grant select, insert, update, delete on tables to hirevine_api;
alter default privileges in schema public
  grant usage, select on sequences to hirevine_api;
alter default privileges in schema app
  grant execute on functions to hirevine_api;
