-- Run in Supabase SQL Editor once before enabling advisor email notifications.
-- Only a trusted Edge Function with a server-side key can access this table.
create table if not exists public.advisor_decision_email_log (
  id uuid primary key default gen_random_uuid(),
  advisor_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  recipient_email text not null,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{16}$'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  decision text not null check (decision in ('approved','changes')),
  demo boolean not null default false,
  status text not null check (status in ('pending','sent','failed')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  message_id text,
  error_message text,
  constraint advisor_decision_email_unique unique (advisor_id, recipient_id, fingerprint, content_hash)
);
create index if not exists advisor_decision_email_advisor_created on public.advisor_decision_email_log(advisor_id,created_at desc);
alter table public.advisor_decision_email_log enable row level security;
revoke all on table public.advisor_decision_email_log from anon, authenticated;
