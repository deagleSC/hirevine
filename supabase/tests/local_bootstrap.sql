-- LOCAL / TEST ONLY. Stubs the parts of Supabase the migrations depend on, so the
-- same migration files run on a plain Postgres. Never apply this to Supabase.
create schema if not exists auth;
create table if not exists auth.users (
  id    uuid primary key,
  email text unique
);
