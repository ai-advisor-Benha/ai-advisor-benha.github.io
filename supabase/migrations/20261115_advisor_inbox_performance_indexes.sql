-- Index foreign keys used by assignment administration and Brevo audits.
-- All statements are additive and safe to rerun.
create index if not exists advisor_request_notice_by_advisor
  on public.advisor_request_notice_log(advisor_id);
create index if not exists advisor_assignment_by_assigner
  on public.advisor_student_assignments(assigned_by)
  where assigned_by is not null;
create index if not exists advisor_decision_email_log_by_recipient
  on public.advisor_decision_email_log(recipient_id);
