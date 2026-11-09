-- events is append-only for every app-facing role, including Supabase's service_role
-- (Supabase grants it full privileges on public tables by default).
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke update, delete, truncate on public.events from service_role;
  end if;
end $$;
