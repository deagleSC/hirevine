-- Phase 8: final report and campaign completion (backend plan §16).

-- A manager's score for a stage that needed review: who scored it and why.
alter table stage_results add column scored_by uuid references profiles (id) on delete set null;
alter table stage_results add column manual_note text;

-- Evidence the feedback draft cites ("screening:c1", "quiz:q3", "interview:r2"), checked against
-- the stored evidence before saving.
alter table feedback add column citations jsonb not null default '[]';

-- notify-release may retry a batch: one release notification per candidate per application.
create unique index notifications_release_once on notifications (user_id, (payload ->> 'application_id'))
  where type = 'outcome_released';
