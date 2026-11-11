-- Phase 9: account deletion (backend plan §18).

-- The event log stays append-only. The one change allowed is erasing who did something when that
-- person deletes their account: this function, callable only from system jobs.
create or replace function app.anonymize_actor(p_user_id uuid) returns integer
  language plpgsql security definer set search_path = public, pg_temp
as $$
declare n integer;
begin
  if not app.is_role('system') then
    raise exception 'anonymize_actor is for system jobs only' using errcode = '42501';
  end if;
  update events set actor_id = null where actor_id = p_user_id;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function app.anonymize_actor(uuid) from public;
grant execute on function app.anonymize_actor(uuid) to hirevine_api;
