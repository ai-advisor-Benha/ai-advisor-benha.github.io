-- AI Academic Advisor: private online student -> assigned-advisor request workflow.
-- Apply manually in Supabase SQL Editor AFTER reviewing the actual live advisor_profiles schema.
-- This migration does not change existing authentication, role or email tables.
-- The GitHub frontend update alone cannot install this migration.

begin;

create table if not exists public.advisor_student_assignments (
  student_id uuid primary key references public.advisor_profiles(id) on delete cascade,
  advisor_id uuid not null references public.advisor_profiles(id) on delete restrict,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  constraint advisor_assignment_not_self check (student_id <> advisor_id)
);

create index if not exists advisor_assignments_by_advisor
  on public.advisor_student_assignments (advisor_id, student_id);

-- One high-entropy routing code per registered advisor, not an authentication secret.
create table if not exists public.advisor_registration_codes (
  advisor_id uuid primary key references public.advisor_profiles(id) on delete cascade,
  code text not null unique check (code ~ '^ADV-[0-9A-F]{24}$'),
  issued_at timestamptz not null default now()
);
alter table public.advisor_registration_codes enable row level security;
revoke all on public.advisor_registration_codes from public, anon, authenticated;

create table if not exists public.advisor_plan_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.advisor_profiles(id) on delete cascade,
  advisor_id uuid not null references public.advisor_profiles(id) on delete restrict,
  student_name text not null default '',
  student_email text not null,
  term text not null,
  program text not null,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{16}$'),
  request jsonb not null,
  status text not null default 'pending'
    check (status in ('pending','approved','changes')),
  decision jsonb,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint advisor_plan_request_object check (jsonb_typeof(request) = 'object'),
  constraint advisor_plan_decision_object check (decision is null or jsonb_typeof(decision) = 'object')
);

-- Prevent duplicate PENDING requests without rewriting an advisor's saved decision.
create unique index if not exists advisor_plan_one_pending
  on public.advisor_plan_requests (student_id, fingerprint)
  where status = 'pending';
create index if not exists advisor_plan_advisor_recent
  on public.advisor_plan_requests (advisor_id, created_at desc);
create index if not exists advisor_plan_student_recent
  on public.advisor_plan_requests (student_id, created_at desc);

alter table public.advisor_student_assignments enable row level security;
alter table public.advisor_plan_requests enable row level security;
revoke all on public.advisor_student_assignments from public, anon, authenticated;
revoke all on public.advisor_plan_requests from public, anon, authenticated;
grant select on public.advisor_student_assignments to authenticated;
grant select on public.advisor_plan_requests to authenticated;

drop policy if exists advisor_assignment_select on public.advisor_student_assignments;
create policy advisor_assignment_select
  on public.advisor_student_assignments for select to authenticated
  using (
    student_id = (select auth.uid())
    or advisor_id = (select auth.uid())
    or exists (
      select 1 from public.advisor_profiles actor
      where actor.id = (select auth.uid()) and actor.role = 'admin'
    )
  );

drop policy if exists advisor_plan_select on public.advisor_plan_requests;
create policy advisor_plan_select
  on public.advisor_plan_requests for select to authenticated
  using (
    student_id = (select auth.uid())
    or (
      advisor_id = (select auth.uid())
      and exists (
        select 1 from public.advisor_student_assignments assignment
        where assignment.student_id = advisor_plan_requests.student_id
          and assignment.advisor_id = (select auth.uid())
      )
      and exists (
        select 1 from public.advisor_profiles actor
        where actor.id = (select auth.uid()) and actor.role in ('advisor','admin')
      )
    )
  );
-- No browser INSERT/UPDATE/DELETE policies. Writes happen only via validated RPCs.

-- Advisors create/retrieve their one persistent code. Students have no direct read access.
create or replace function public.advisor_get_my_code()
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_code text;
begin
  select role into v_role from public.advisor_profiles where id = v_actor;
  if v_actor is null or v_role not in ('advisor','admin') then
    raise exception 'Approved academic advisor account required.' using errcode = '42501';
  end if;
  insert into public.advisor_registration_codes(advisor_id, code)
    values(v_actor, upper('ADV-' || substr(replace(gen_random_uuid()::text,'-',''),1,24)))
    on conflict(advisor_id) do nothing;
  select code into v_code from public.advisor_registration_codes where advisor_id = v_actor;
  return v_code;
end;
$$;

create or replace function public.advisor_assign_student(
  p_student_email text, p_advisor_email text
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor_role text;
  v_student uuid;
  v_advisor uuid;
begin
  select role into v_actor_role
    from public.advisor_profiles where id = auth.uid();
  if v_actor_role is distinct from 'admin' then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  select id into v_student from public.advisor_profiles
    where lower(email) = lower(btrim(p_student_email)) and role = 'student';
  if v_student is null then
    raise exception 'A registered student with that email was not found.';
  end if;
  select id into v_advisor from public.advisor_profiles
    where lower(email) = lower(btrim(p_advisor_email)) and role in ('advisor','admin');
  if v_advisor is null then
    raise exception 'A verified advisor/admin profile with that email was not found.';
  end if;
  insert into public.advisor_student_assignments (student_id, advisor_id, assigned_by)
  values (v_student, v_advisor, auth.uid())
  on conflict (student_id) do update
    set advisor_id = excluded.advisor_id,
        assigned_by = excluded.assigned_by,
        assigned_at = now();
  -- A reassignment transfers outstanding requests; previously completed records
  -- remain in history but become invisible to the former advisor under RLS.
  update public.advisor_plan_requests
    set advisor_id = v_advisor
    where student_id = v_student and status = 'pending';
  return v_student;
end;
$$;

create or replace function public.advisor_submit_plan(
  p_request jsonb, p_advisor_code text default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_student uuid := auth.uid();
  v_email text;
  v_sid text;
  v_role text;
  v_advisor uuid;
  v_code_advisor uuid;
  v_code text := upper(btrim(coalesce(p_advisor_code,'')));
  v_id uuid;
  v_fp text;
begin
  select lower(email), sid::text, role into v_email, v_sid, v_role
    from public.advisor_profiles where id = v_student;
  if v_student is null or v_role is distinct from 'student' then
    raise exception 'Student login required.' using errcode = '42501';
  end if;
  if p_request is null or jsonb_typeof(p_request) <> 'object'
     or length(p_request::text) > 262144
     or p_request->>'type' <> 'ai-academic-advisor/request'
     or p_request->>'version' <> '1'
     or coalesce(p_request->>'demo','false') <> 'false'
     or lower(coalesce(p_request->>'email','')) <> v_email
     or coalesce(p_request->>'studentId','') <> v_sid
     or coalesce(p_request->>'term','') not in ('Fall','Spring','Summer')
     or length(coalesce(p_request->>'program','')) not between 1 and 64
     or length(coalesce(p_request->>'university','')) not between 1 and 64
     or jsonb_typeof(p_request->'plan') is distinct from 'array'
     or jsonb_typeof(p_request->'attempts') is distinct from 'array'
  then
    raise exception 'Invalid request, identity, or academic document.';
  end if;
  if jsonb_array_length(p_request->'plan') not between 1 and 30
     or jsonb_array_length(p_request->'attempts') > 600
     or exists (
       select 1 from jsonb_array_elements(p_request->'plan') as c(item)
       where jsonb_typeof(c.item) <> 'string'
          or length(trim(both '"' from c.item::text)) not between 2 and 30
     )
  then
    raise exception 'Plan or transcript size/format is unsupported.';
  end if;
  v_fp := p_request->>'fingerprint';
  if v_fp is null or v_fp !~ '^[0-9a-f]{16}$' then
    raise exception 'Plan fingerprint is invalid.';
  end if;
  select a.advisor_id into v_advisor
    from public.advisor_student_assignments a
    join public.advisor_profiles p on p.id = a.advisor_id
    where a.student_id = v_student and p.role in ('advisor','admin');
  if v_advisor is null then
    -- First submission can enroll by code. Conflict-safe: no reassignment by students.
    if v_code !~ '^ADV-[0-9A-F]{24}$' then
      raise exception 'Enter the unique academic advisor code given to you by your advisor.';
    end if;
    select codes.advisor_id into v_code_advisor
      from public.advisor_registration_codes codes
      join public.advisor_profiles p on p.id = codes.advisor_id
      where codes.code = v_code and p.role in ('advisor','admin');
    if v_code_advisor is null then
      raise exception 'Invalid advisor code. Check it with your academic advisor.';
    end if;
    insert into public.advisor_student_assignments(student_id,advisor_id,assigned_by)
      values(v_student,v_code_advisor,null)
      on conflict(student_id) do nothing;
    select advisor_id into v_advisor
      from public.advisor_student_assignments where student_id = v_student;
    if v_advisor is distinct from v_code_advisor then
      raise exception 'Your account is already assigned to a different advisor. Contact the administrator.';
    end if;
  elsif v_code <> '' then
    select codes.advisor_id into v_code_advisor
      from public.advisor_registration_codes codes where codes.code = v_code;
    if v_code_advisor is distinct from v_advisor then
      raise exception 'Another advisor is already assigned. Contact the administrator to change advisors.';
    end if;
  end if;
  -- Idempotent retry and modest per-student safeguards for enrollment peaks.
  select id into v_id from public.advisor_plan_requests
    where student_id = v_student and fingerprint = v_fp and status = 'pending'
    limit 1;
  if v_id is not null then return v_id; end if;
  if (select count(*) from public.advisor_plan_requests
      where student_id = v_student and status = 'pending') >= 20 then
    raise exception 'Too many pending plans. Contact your academic advisor before submitting more.';
  end if;
  if (select count(*) from public.advisor_plan_requests
      where student_id = v_student and created_at >= now() - interval '1 hour') >= 30 then
    raise exception 'Too many submissions. Please try again later.';
  end if;
  insert into public.advisor_plan_requests (
    student_id, advisor_id, student_name, student_email,
    term, program, fingerprint, request
  )
  values (
    v_student, v_advisor,
    left(coalesce(p_request->>'studentName',''), 120), v_email,
    p_request->>'term', p_request->>'program', v_fp, p_request
  )
  on conflict (student_id, fingerprint) where status = 'pending' do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.advisor_plan_requests
      where student_id = v_student and fingerprint = v_fp and status = 'pending'
      order by created_at desc limit 1;
  end if;
  if v_id is null then raise exception 'Unable to save the advising request.'; end if;
  return v_id;
end;
$$;

create or replace function public.advisor_save_plan_decision(
  p_request_id uuid, p_decision jsonb
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_actor_email text;
  v_plan public.advisor_plan_requests%rowtype;
begin
  select role, lower(email) into v_actor_role, v_actor_email
    from public.advisor_profiles where id = v_actor;
  if v_actor_role not in ('advisor','admin') or v_actor_role is null then
    raise exception 'Advisor role required.' using errcode = '42501';
  end if;
  select p.* into v_plan
    from public.advisor_plan_requests p
    join public.advisor_student_assignments a
      on a.student_id = p.student_id and a.advisor_id = p.advisor_id
    where p.id = p_request_id and p.advisor_id = v_actor
    for update of p;
  if not found then
    raise exception 'Request not found or no longer assigned to this advisor.'
      using errcode = '42501';
  end if;
  if v_plan.status <> 'pending' then
    raise exception 'This request was already reviewed.';
  end if;
  if p_decision is null or jsonb_typeof(p_decision) <> 'object'
     or length(p_decision::text) > 10000
     or p_decision->>'type' <> 'ai-academic-advisor/decision'
     or p_decision->>'version' <> '1'
     or (p_decision->>'decision') not in ('approved','changes')
     or p_decision->>'fingerprint' is distinct from v_plan.fingerprint
     or p_decision->>'studentId' is distinct from v_plan.request->>'studentId'
     or p_decision->>'term' is distinct from v_plan.term
     or p_decision->'plan' is distinct from v_plan.request->'plan'
     or lower(coalesce(p_decision->>'advisor','')) <> v_actor_email
     or length(coalesce(p_decision->>'comment','')) > 1800
  then
    raise exception 'The decision does not match the original student request.';
  end if;
  if p_decision->>'decision' = 'changes'
     and btrim(coalesce(p_decision->>'comment','')) = '' then
    raise exception 'A comment is required when requesting changes.';
  end if;
  update public.advisor_plan_requests
     set status = p_decision->>'decision',
         decision = p_decision,
         reviewed_at = now()
   where id = v_plan.id;
  return true;
end;
$$;

revoke all on function public.advisor_get_my_code() from public, anon;
revoke all on function public.advisor_assign_student(text,text) from public, anon;
revoke all on function public.advisor_submit_plan(jsonb,text) from public, anon;
revoke all on function public.advisor_save_plan_decision(uuid,jsonb) from public, anon;
grant execute on function public.advisor_get_my_code() to authenticated;
grant execute on function public.advisor_assign_student(text,text) to authenticated;
grant execute on function public.advisor_submit_plan(jsonb,text) to authenticated;
grant execute on function public.advisor_save_plan_decision(uuid,jsonb) to authenticated;

commit;
