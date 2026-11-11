-- Pilot readiness: retention (backend plan §18). Candidate data is deleted RETENTION_DAYS after a
-- campaign completes; the campaign and job stay, marked with when their candidate data was purged.
alter table campaigns add column purged_at timestamptz;
create index campaigns_retention_idx on campaigns (completed_at) where status = 'completed' and purged_at is null;
