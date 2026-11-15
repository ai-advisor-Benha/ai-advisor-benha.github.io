-- Verified Ibn Al-Haytham advisor roster matching, additive to online advisor inbox.
-- Student identity is checked by advisor_submit_plan (registered 14-digit ID and email).
-- Only minimum data needed for roster verification is stored: university student code and full name.
-- Uploaded phone numbers, GPAs, grades, personal email addresses and national IDs are NEVER persisted here.

create or replace function public.advisor_roster_norm(p_name text)
returns text language sql immutable security invoker set search_path = ''
as $fn$
  select lower(btrim(regexp_replace(
    translate(regexp_replace(coalesce(p_name,''), '[ًٌٍَُِّْٰـ]', '', 'g'), 'أإآٱىة', 'اااايه'),
    '[[:space:]]+', ' ', 'g')));
$fn$;

create table if not exists public.advisor_roster_batches (
  id uuid primary key default gen_random_uuid(),
  advisor_id uuid not null references public.advisor_profiles(id) on delete cascade,
  advisor_name text not null check (length(advisor_name) between 5 and 160),
  faculty_name text not null default '',
  program_name text not null default '',
  export_date text not null default '',
  student_count integer not null check (student_count between 1 and 1000),
  status text not null default 'pending' check (status in ('pending','approved','rejected','superseded')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null
);
create index if not exists advisor_roster_batches_by_advisor on public.advisor_roster_batches(advisor_id,created_at desc);
create index if not exists advisor_roster_batches_by_status on public.advisor_roster_batches(status,created_at desc);

create table if not exists public.advisor_roster_students (
  batch_id uuid not null references public.advisor_roster_batches(id) on delete cascade,
  student_number text not null check (student_number ~ '^[0-9]{5,20}$'),
  student_name text not null check (length(student_name) between 5 and 180),
  normalized_name text generated always as (public.advisor_roster_norm(student_name)) stored,
  primary key (batch_id,student_number)
);
create index if not exists advisor_roster_students_by_number on public.advisor_roster_students(student_number);
create index if not exists advisor_roster_students_by_name on public.advisor_roster_students(normalized_name);

alter table public.advisor_roster_batches enable row level security;
alter table public.advisor_roster_students enable row level security;
revoke all on public.advisor_roster_batches, public.advisor_roster_students from public,anon,authenticated;
grant select on public.advisor_roster_batches, public.advisor_roster_students to authenticated;

drop policy if exists advisor_roster_batches_private on public.advisor_roster_batches;
create policy advisor_roster_batches_private on public.advisor_roster_batches
for select to authenticated
using (
  advisor_id = (select auth.uid())
  or exists (
    select 1 from public.advisor_profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  )
);
drop policy if exists advisor_roster_students_private on public.advisor_roster_students;
create policy advisor_roster_students_private on public.advisor_roster_students
for select to authenticated
using (exists (
  select 1 from public.advisor_roster_batches b
  where b.id = batch_id
    and (
      b.advisor_id = (select auth.uid())
      or exists (
        select 1 from public.advisor_profiles p
        where p.id = (select auth.uid()) and p.role = 'admin'
      )
    )
));
-- No direct browser writes. All writes are transactional and role-checked RPCs.

create or replace function public.advisor_upload_official_roster(
  p_advisor_name text,
  p_faculty_name text,
  p_program_name text,
  p_export_date text,
  p_students jsonb
) returns uuid
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_batch uuid;
  v_count integer;
begin
  select role into v_role from public.advisor_profiles where id=v_actor;
  if v_role is null or v_role not in ('advisor','admin') then
    raise exception 'Only verified academic advisors may upload their own official roster.'
      using errcode='42501';
  end if;
  if jsonb_typeof(p_students) is distinct from 'array'
     or length(p_students::text) > 240000 then
    raise exception 'The roster must be an array of at most 240 KB.';
  end if;
  v_count := jsonb_array_length(p_students);
  if v_count < 1 or v_count > 1000 then
    raise exception 'Upload between 1 and 1000 students per official roster.';
  end if;
  if length(btrim(coalesce(p_advisor_name,''))) not between 5 and 160
     or length(coalesce(p_faculty_name,'')) > 160
     or length(coalesce(p_program_name,'')) > 120
     or length(coalesce(p_export_date,'')) > 80
  then raise exception 'Invalid advisor name, report heading or export date.'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_students) as x(item)
    where jsonb_typeof(item) is distinct from 'object'
       or (item->>'studentNumber') is null
       or (item->>'studentNumber') !~ '^[0-9]{5,20}$'
       or length(coalesce(item->>'studentName','')) not between 5 and 180
       or length(public.advisor_roster_norm(item->>'studentName')) < 5
  ) then raise exception 'The report has an invalid university student code or student name.'; end if;
  if exists (
    select 1 from (
      select item->>'studentNumber' as code
      from jsonb_array_elements(p_students) as x(item)
      group by item->>'studentNumber' having count(*)>1
    ) duplicates
  ) then raise exception 'Duplicate university student numbers in this roster.'; end if;
  insert into public.advisor_roster_batches(
    advisor_id,advisor_name,faculty_name,program_name,export_date,student_count
  ) values(v_actor,btrim(p_advisor_name),btrim(coalesce(p_faculty_name,'')),
    btrim(coalesce(p_program_name,'')),btrim(coalesce(p_export_date,'')),v_count)
  returning id into v_batch;
  insert into public.advisor_roster_students(batch_id,student_number,student_name)
  select v_batch, item->>'studentNumber', btrim(item->>'studentName')
  from jsonb_array_elements(p_students) as x(item);
  return v_batch;
end;
$fn$;

create or replace function public.advisor_review_official_roster(
  p_batch_id uuid, p_approve boolean
) returns boolean
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_batch public.advisor_roster_batches%rowtype;
begin
  select role into v_role from public.advisor_profiles where id=v_actor;
  if v_role is distinct from 'admin' then
    raise exception 'Only administrators can approve or reject official roster imports.'
      using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(872612015);
  select * into v_batch from public.advisor_roster_batches where id=p_batch_id for update;
  if not found or v_batch.status <> 'pending' then
    raise exception 'Roster not found or already reviewed.';
  end if;
  if p_approve then
    -- A university code must not be simultaneously active under different advisors.
    if exists (
      select 1
      from public.advisor_roster_students candidate
      join public.advisor_roster_students active on active.student_number=candidate.student_number
      join public.advisor_roster_batches approved on approved.id=active.batch_id
      where candidate.batch_id=p_batch_id
        and approved.status='approved'
        and approved.advisor_id <> v_batch.advisor_id
    ) then
      raise exception 'At least one student code already appears in an approved roster of a different advisor. Review the conflicting assignment before approval.';
    end if;
    -- Complete replacement: old snapshot stays for audit but cannot match new submissions.
    update public.advisor_roster_batches set status='superseded'
    where advisor_id=v_batch.advisor_id and status='approved';
    update public.advisor_roster_batches
       set status='approved',reviewed_by=v_actor,reviewed_at=now()
     where id=p_batch_id;
  else
    update public.advisor_roster_batches
       set status='rejected',reviewed_by=v_actor,reviewed_at=now()
     where id=p_batch_id;
  end if;
  return true;
end;
$fn$;

-- Retain old RPC compatibility, but block all new requests for students who are
-- not on a current approved roster, unless a real administrator explicitly assigned them.
-- This guard runs on ALL insert paths, including direct calls to the legacy code RPC.
create or replace function public.advisor_plan_verify_official_roster()
returns trigger
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_assigned_by uuid;
  v_student_number text := btrim(coalesce(new.request->>'studentNumber',''));
  v_student_name text := public.advisor_roster_norm(new.request->>'studentName');
begin
  select a.assigned_by into v_assigned_by
  from public.advisor_student_assignments a
  where a.student_id=new.student_id and a.advisor_id=new.advisor_id;
  if not found then
    raise exception 'Your account is not assigned to the selected academic advisor.'
      using errcode='42501';
  end if;
  -- A manual, role-checked admin override remains available for exceptional cases.
  if v_assigned_by is not null and exists (
    select 1 from public.advisor_profiles admin
    where admin.id=v_assigned_by and admin.role='admin'
  ) then return new; end if;
  if v_student_number !~ '^[0-9]{5,20}$' or length(v_student_name)<5 then
    raise exception 'Your transcript must include a valid university student code and full name.'; end if;
  if not exists (
    select 1 from public.advisor_roster_students item
    join public.advisor_roster_batches b on b.id=item.batch_id
    where b.status='approved' and b.advisor_id=new.advisor_id
      and item.student_number=v_student_number
      and item.normalized_name=v_student_name
  ) then
    raise exception 'Your university student code and full name do not match your advisor''s approved Ibn Al-Haytham list. Contact your academic advisor or administrator; no request was sent.';
  end if;
  return new;
end;
$fn$;
drop trigger if exists advisor_verify_roster_on_submission on public.advisor_plan_requests;
create trigger advisor_verify_roster_on_submission
before insert on public.advisor_plan_requests
for each row execute function public.advisor_plan_verify_official_roster();

-- A student no longer has to type or know the advisor email or secret routing code.
create or replace function public.advisor_submit_verified_plan(
  p_request jsonb
) returns uuid
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_student uuid := auth.uid();
  v_student_role text;
  v_number text := btrim(coalesce(p_request->>'studentNumber',''));
  v_name text := public.advisor_roster_norm(p_request->>'studentName');
  v_matched_advisor uuid;
  v_existing_advisor uuid;
  v_existing_assigner uuid;
  v_nmatches integer;
begin
  select role into v_student_role from public.advisor_profiles where id=v_student;
  if v_student_role is distinct from 'student' then
    raise exception 'A registered student login is required.' using errcode='42501'; end if;
  select advisor_id,assigned_by into v_existing_advisor,v_existing_assigner
  from public.advisor_student_assignments where student_id=v_student;
  if v_existing_advisor is not null and v_existing_assigner is not null
     and exists(select 1 from public.advisor_profiles p
       where p.id=v_existing_assigner and p.role='admin') then
     return public.advisor_submit_plan(p_request,null);
  end if;
  if v_number !~ '^[0-9]{5,20}$' or length(v_name)<5 then
    raise exception 'Your uploaded Ibn Al-Haytham transcript must contain your university student code and full name.'; end if;
  select count(distinct b.advisor_id), min(b.advisor_id::text)::uuid
    into v_nmatches,v_matched_advisor
  from public.advisor_roster_students item
  join public.advisor_roster_batches b on b.id=item.batch_id
  join public.advisor_profiles p on p.id=b.advisor_id and p.role in ('admin','advisor')
  where b.status='approved' and item.student_number=v_number
    and item.normalized_name=v_name;
  if v_nmatches=0 then
    raise exception 'Your student number and name were not found in any approved academic advisor roster. Ask your advisor to upload their Ibn Al-Haytham student list for administrator approval.'; end if;
  if v_nmatches<>1 then
    raise exception 'Your student appears under more than one advisor; ask the administrator to resolve the official assignment.'; end if;
  if v_existing_advisor is not null and v_existing_advisor<>v_matched_advisor then
    raise exception 'This account is linked to a different advisor. The administrator must verify and correct the assignment.'; end if;
  insert into public.advisor_student_assignments(student_id,advisor_id,assigned_by)
    values(v_student,v_matched_advisor,null)
    on conflict(student_id) do nothing;
  return public.advisor_submit_plan(p_request,null);
end;
$fn$;

revoke all on function public.advisor_roster_norm(text) from public,anon;
revoke all on function public.advisor_upload_official_roster(text,text,text,text,jsonb) from public,anon;
revoke all on function public.advisor_review_official_roster(uuid,boolean) from public,anon;
revoke all on function public.advisor_submit_verified_plan(jsonb) from public,anon;
revoke all on function public.advisor_plan_verify_official_roster() from public,anon,authenticated;
grant execute on function public.advisor_roster_norm(text) to authenticated;
grant execute on function public.advisor_upload_official_roster(text,text,text,text,jsonb) to authenticated;
grant execute on function public.advisor_review_official_roster(uuid,boolean) to authenticated;
grant execute on function public.advisor_submit_verified_plan(jsonb) to authenticated;


-- Students can contact only their OWN assigned advisor; no public directory or roster listing.
create or replace function public.advisor_my_linked_advisor()
returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare
  v_student uuid := auth.uid();
  v_role text;
  v_email text;
  v_name text;
  v_advisor uuid;
begin
  select role into v_role from public.advisor_profiles where id=v_student;
  if v_role is distinct from 'student' then
    raise exception 'Student sign-in required.' using errcode='42501';
  end if;
  select a.advisor_id,p.email into v_advisor,v_email
    from public.advisor_student_assignments a
    join public.advisor_profiles p on p.id=a.advisor_id and p.role in ('advisor','admin')
    where a.student_id=v_student;
  if v_advisor is null then return null; end if;
  select b.advisor_name into v_name from public.advisor_roster_batches b
  where b.advisor_id=v_advisor and b.status='approved'
  order by b.reviewed_at desc limit 1;
  return jsonb_build_object('name',coalesce(v_name,''),'email',coalesce(v_email,''));
end;
$fn$;
revoke all on function public.advisor_my_linked_advisor() from public,anon;
grant execute on function public.advisor_my_linked_advisor() to authenticated;
