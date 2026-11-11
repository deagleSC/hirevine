-- Phase 7: AI interview (backend plan §15).

-- Set while the interview is paused because the daily AI budget ran out mid-interview. The clock
-- stops: when the next question succeeds, deadline_at moves forward by the paused time.
alter table interview_sessions add column paused_at timestamptz;
