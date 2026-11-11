-- Email notifications (Resend): each in-app notification is emailed once; emailed_at makes the
-- sender idempotent across retries.
alter table notifications add column emailed_at timestamptz;
create index notifications_pending_email_idx on notifications (created_at) where emailed_at is null;
