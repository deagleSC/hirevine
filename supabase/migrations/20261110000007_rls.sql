-- Row Level Security. Every policy targets the hirevine_api role only, so Supabase's
-- anon/authenticated roles (PostgREST) match no policy and see nothing.
--
-- Lookup helpers are SECURITY DEFINER so a policy on one table can check a related
-- table without being blocked by that table's own RLS (for example, a candidate has
-- no access to campaigns, but the release rule needs the campaign's status).

-- ---------------------------------------------------------------- helpers
create or replace function app.job_org(p_job_id uuid) returns uuid
  language sql stable security definer set search_path = public, pg_temp
as $$ select org_id from jobs where id = p_job_id $$;

create or replace function app.job_published(p_job_id uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp
as $$ select coalesce((select status = 'published' from jobs where id = p_job_id), false) $$;

create or replace function app.campaign_org(p_campaign_id uuid) returns uuid
  language sql stable security definer set search_path = public, pg_temp
as $$ select j.org_id from campaigns c join jobs j on j.id = c.job_id where c.id = p_campaign_id $$;

create or replace function app.application_org(p_application_id uuid) returns uuid
  language sql stable security definer set search_path = public, pg_temp
as $$
  select j.org_id
  from applications a join campaigns c on c.id = a.campaign_id join jobs j on j.id = c.job_id
  where a.id = p_application_id
$$;

create or replace function app.application_candidate(p_application_id uuid) returns uuid
  language sql stable security definer set search_path = public, pg_temp
as $$ select candidate_id from applications where id = p_application_id $$;

-- The release rule: outcomes are visible to a candidate only once the campaign is completed.
create or replace function app.application_released(p_application_id uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce((
    select c.status = 'completed'
    from applications a join campaigns c on c.id = a.campaign_id
    where a.id = p_application_id), false)
$$;

-- A candidate may write quiz/interview rows only while their current stage is open.
create or replace function app.candidate_stage_open(p_application_id uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from applications a
    join campaigns c on c.id = a.campaign_id
    join stage_results s on s.application_id = a.id and s.node_id = a.current_node
    where a.id = p_application_id
      and c.status = 'open'
      and s.status in ('pending', 'in_progress'))
$$;

-- A manager can see a candidate's profile only if that candidate applied to their org.
create or replace function app.candidate_applied_to_org(p_candidate_id uuid, p_org_id uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from applications a join campaigns c on c.id = a.campaign_id join jobs j on j.id = c.job_id
    where a.candidate_id = p_candidate_id and j.org_id = p_org_id)
$$;

create or replace function app.is_role(p_role text) returns boolean
  language sql stable
as $$ select app.current_role() is not distinct from p_role $$;

-- ------------------------------------------------- profile creation (sign-up)
-- Creates the caller's profile (and organization, for managers). Idempotent.
-- Errors: Z1001 role_conflict, Z1002 adult_required, Z1003 org_name_required, 42501 not authenticated.
create or replace function app.create_profile(
  p_role text, p_display_name text, p_org_name text default null, p_adult boolean default false
) returns profiles
  language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.current_user_id();
  v_existing profiles;
  v_org uuid;
  v_new profiles;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_existing from profiles where id = v_uid;
  if found then
    if v_existing.role <> p_role then
      raise exception 'role_conflict' using errcode = 'Z1001';
    end if;
    return v_existing;
  end if;

  if p_role = 'manager' then
    if coalesce(btrim(p_org_name), '') = '' then
      raise exception 'org_name_required' using errcode = 'Z1003';
    end if;
    insert into organizations (name) values (btrim(p_org_name)) returning id into v_org;
  elsif p_role = 'candidate' then
    if not coalesce(p_adult, false) then
      raise exception 'adult_required' using errcode = 'Z1002';
    end if;
  else
    raise exception 'invalid role' using errcode = '22023';
  end if;

  insert into profiles (id, role, org_id, display_name, adult_confirmed)
  values (v_uid, p_role, v_org, btrim(p_display_name), coalesce(p_adult, false))
  returning * into v_new;

  insert into events (actor_id, org_id, type, entity, entity_id, payload)
  values (v_uid, v_org, 'profile.created', 'profile', v_uid, jsonb_build_object('role', p_role));

  return v_new;
end
$$;

grant execute on all functions in schema app to hirevine_api;

-- ------------------------------------------------------------ enable RLS
alter table organizations      enable row level security;
alter table profiles           enable row level security;
alter table jobs               enable row level security;
alter table job_share_links    enable row level security;
alter table workflows          enable row level security;
alter table campaigns          enable row level security;
alter table applications       enable row level security;
alter table consents           enable row level security;
alter table resume_texts       enable row level security;
alter table screening_answers  enable row level security;
alter table stage_results      enable row level security;
alter table quiz_attempts      enable row level security;
alter table interview_sessions enable row level security;
alter table feedback           enable row level security;
alter table notifications      enable row level security;
alter table job_runs           enable row level security;
alter table events             enable row level security;
alter table data_requests      enable row level security;
alter table rate_limits        enable row level security;

-- The audit log is append-only for the API role.
revoke update, delete, truncate on events from hirevine_api;

-- Supabase exposes public tables to anon/authenticated through PostgREST. Remove that.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke all on all functions in schema app from %I', r);
    end if;
  end loop;
end
$$;

-- ------------------------------------------------------------- policies
-- Background jobs run as role 'system' (claims set by the API, never by clients).
-- Each table gets an explicit system policy so every access path is visible here.

-- organizations
create policy org_manager_read on organizations for select to hirevine_api
  using (app.is_role('manager') and id = app.current_org_id());
create policy org_manager_update on organizations for update to hirevine_api
  using (app.is_role('manager') and id = app.current_org_id())
  with check (id = app.current_org_id());
create policy org_system on organizations for all to hirevine_api
  using (app.is_role('system')) with check (app.is_role('system'));

-- profiles (inserts go through app.create_profile)
create policy profiles_self_read on profiles for select to hirevine_api
  using (id = app.current_user_id());
create policy profiles_manager_read on profiles for select to hirevine_api
  using (app.is_role('manager')
         and (org_id = app.current_org_id()
              or app.candidate_applied_to_org(id, app.current_org_id())));
create policy profiles_system on profiles for all to hirevine_api
  using (app.is_role('system')) with check (app.is_role('system'));

-- jobs
create policy jobs_manager_all on jobs for all to hirevine_api
  using (app.is_role('manager') and org_id = app.current_org_id())
  with check (app.is_role('manager') and org_id = app.current_org_id());
create policy jobs_public_read on jobs for select to hirevine_api
  using ((app.is_role('candidate') or app.is_role('public')) and status = 'published');
create policy jobs_system on jobs for all to hirevine_api
  using (app.is_role('system')) with check (app.is_role('system'));

-- job_share_links
create policy share_manager_all on job_share_links for all to hirevine_api
  using (app.is_role('manager') and app.job_org(job_id) = app.current_org_id())
  with check (app.is_role('manager') and app.job_org(job_id) = app.current_org_id());
create policy share_public_read on job_share_links for select to hirevine_api
  using ((app.is_role('candidate') or app.is_role('public'))
         and revoked_at is null and app.job_published(job_id));
create policy share_system on job_share_links for all to hirevine_api
  using (app.is_role('system')) with check (app.is_role('system'));

-- workflows (manager only)
create policy workflows_manager_all on workflows for all to hirevine_api
  using (app.is_role('manager') and app.job_org(job_id) = app.current_org_id())
  with check (app.is_role('manager') and app.job_org(job_id) = app.current_org_id());
create policy workflows_system on workflows for all to hirevine_api
  using (app.is_role('system')) with check (app.is_role('system'));

-- campaigns: managers in org; candidates may read open campaigns of published jobs (to apply)
create policy campaigns_manager_all on campaigns for all to hirevine_api
  using (app.is_role('manager') and app.job_org(job_id) = app.current_org_id())
  with check (app.is_role('manager') and app.job_org(job_id) = app.current_org_id());
create policy campaigns_candidate_read on campaigns for select to hirevine_api
  using (app.is_role('candidate') and status = 'open' and app.job_published(job_id));
create policy campaigns_system on campaigns for all to hirevine_api
  using (app.is_role('system')) with check (app.is_role('system'));

-- applications
create policy applications_manager_read on applications for select to hirevine_api
  using (app.is_role('manager') and app.campaign_org(campaign_id) = app.current_org_id());
create policy applications_candidate_read on applications for select to hirevine_api
  using (app.is_role('candidate') and candidate_id = app.current_user_id());
create policy applications_candidate_insert on applications for insert to hirevine_api
  with check (app.is_role('candidate') and candidate_id = app.current_user_id());
create policy applications_system on applications for all to hirevine_api
  using (app.is_role('system')) with check (app.is_role('system'));

-- consents, screening_answers: candidate writes own, manager reads org
create policy consents_manager_read on consents for select to hirevine_api
  using (app.is_role('manager') and app.application_org(application_id) = app.current_org_id());
create policy consents_candidate_rw on consents for all to hirevine_api
  using (app.is_role('candidate') and candidate_id = app.current_user_id())
  with check (app.is_role('candidate') and candidate_id = app.current_user_id()
              and app.application_candidate(application_id) = app.current_user_id());
create policy consents_system on consents for all to hirevine_api
  using (app.is_role('system')) with check (app.is_role('system'));

create policy answers_manager_read on screening_answers for select to hirevine_api
  using (app.is_role('manager') and app.application_org(application_id) = app.current_org_id());
create policy answers_candidate_rw on screening_answers for all to hirevine_api
  using (app.is_role('candidate') and app.application_candidate(application_id) = app.current_user_id())
  with check (app.is_role('candidate') and app.application_candidate(application_id) = app.current_user_id());
create policy answers_system on screening_answers for all to hirevine_api
  using (app.is_role('system')) with check (app.is_role('system'));

-- resume_texts: written by jobs only
create policy resume_manager_read on resume_texts for select to hirevine_api
  using (app.is_role('manager') and app.application_org(application_id) = app.current_org_id());
create policy resume_candidate_read on resume_texts for select to hirevine_api
  using (app.is_role('candidate') and app.application_candidate(application_id) = app.current_user_id());
create policy resume_system on resume_texts for all to hirevine_api
  using (app.is_role('system')) with check (app.is_role('system'));

-- stage_results: candidates see their own only after release
create policy stage_manager_read on stage_results for select to hirevine_api
  using (app.is_role('manager') and app.application_org(application_id) = app.current_org_id());
create policy stage_candidate_released on stage_results for select to hirevine_api
  using (app.is_role('candidate')
         and app.application_candidate(application_id) = app.current_user_id()
         and app.application_released(application_id));
create policy stage_system on stage_results for all to hirevine_api
  using (app.is_role('system')) with check (app.is_role('system'));

-- quiz_attempts, interview_sessions: candidate writes own only while the stage is open
create policy quiz_manager_read on quiz_attempts for select to hirevine_api
  using (app.is_role('manager') and app.application_org(application_id) = app.current_org_id());
create policy quiz_candidate_read on quiz_attempts for select to hirevine_api
  using (app.is_role('candidate') and app.application_candidate(application_id) = app.current_user_id());
create policy quiz_candidate_insert on quiz_attempts for insert to hirevine_api
  with check (app.is_role('candidate') and app.application_candidate(application_id) = app.current_user_id()
              and app.candidate_stage_open(application_id));
create policy quiz_candidate_update on quiz_attempts for update to hirevine_api
  using (app.is_role('candidate') and app.application_candidate(application_id) = app.current_user_id()
         and app.candidate_stage_open(application_id))
  with check (app.application_candidate(application_id) = app.current_user_id());
create policy quiz_system on quiz_attempts for all to hirevine_api
  using (app.is_role('system')) with check (app.is_role('system'));

create policy interview_manager_read on interview_sessions for select to hirevine_api
  using (app.is_role('manager') and app.application_org(application_id) = app.current_org_id());
create policy interview_candidate_read on interview_sessions for select to hirevine_api
  using (app.is_role('candidate') and app.application_candidate(application_id) = app.current_user_id());
create policy interview_candidate_insert on interview_sessions for insert to hirevine_api
  with check (app.is_role('candidate') and app.application_candidate(application_id) = app.current_user_id()
              and app.candidate_stage_open(application_id));
create policy interview_candidate_update on interview_sessions for update to hirevine_api
  using (app.is_role('candidate') and app.application_candidate(application_id) = app.current_user_id()
         and app.candidate_stage_open(application_id))
  with check (app.application_candidate(application_id) = app.current_user_id());
create policy interview_system on interview_sessions for all to hirevine_api
  using (app.is_role('system')) with check (app.is_role('system'));

-- feedback: manager edits in org; candidate reads own only where released
create policy feedback_manager_read on feedback for select to hirevine_api
  using (app.is_role('manager') and app.application_org(application_id) = app.current_org_id());
create policy feedback_manager_update on feedback for update to hirevine_api
  using (app.is_role('manager') and app.application_org(application_id) = app.current_org_id())
  with check (app.application_org(application_id) = app.current_org_id());
create policy feedback_candidate_released on feedback for select to hirevine_api
  using (app.is_role('candidate') and released
         and app.application_candidate(application_id) = app.current_user_id());
create policy feedback_system on feedback for all to hirevine_api
  using (app.is_role('system')) with check (app.is_role('system'));

-- notifications, data_requests: own rows
create policy notifications_own_read on notifications for select to hirevine_api
  using (user_id = app.current_user_id());
create policy notifications_own_update on notifications for update to hirevine_api
  using (user_id = app.current_user_id()) with check (user_id = app.current_user_id());
create policy notifications_system on notifications for all to hirevine_api
  using (app.is_role('system')) with check (app.is_role('system'));

create policy data_requests_own on data_requests for select to hirevine_api
  using (user_id = app.current_user_id());
create policy data_requests_own_insert on data_requests for insert to hirevine_api
  with check (user_id = app.current_user_id());
create policy data_requests_system on data_requests for all to hirevine_api
  using (app.is_role('system')) with check (app.is_role('system'));

-- job_runs: managers read their org's; candidates get status only through the API
create policy job_runs_manager_read on job_runs for select to hirevine_api
  using (app.is_role('manager') and org_id = app.current_org_id());
create policy job_runs_system on job_runs for all to hirevine_api
  using (app.is_role('system')) with check (app.is_role('system'));

-- events: managers read their org's; anyone authenticated may append their own action
create policy events_manager_read on events for select to hirevine_api
  using (app.is_role('manager') and org_id = app.current_org_id());
create policy events_insert_own on events for insert to hirevine_api
  with check (actor_id = app.current_user_id()
              and (org_id is null or org_id = app.current_org_id()));
create policy events_system on events for select to hirevine_api
  using (app.is_role('system'));
create policy events_system_insert on events for insert to hirevine_api
  with check (app.is_role('system'));

-- rate_limits: system only (the API checks limits in system context)
create policy rate_limits_system on rate_limits for all to hirevine_api
  using (app.is_role('system')) with check (app.is_role('system'));
