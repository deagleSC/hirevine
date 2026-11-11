-- Phase 6: quiz (backend plan §14).

-- Request settings for a job (e.g. quiz generation's count and difficulty). Events carry IDs only
-- (§10.1), so a function reads its settings from the run row.
alter table job_runs add column params jsonb not null default '{}';

-- The deadline function's run sleeps for the whole attempt; monitors look runs up by type.
create index job_runs_type_idx on job_runs (application_id, type);
