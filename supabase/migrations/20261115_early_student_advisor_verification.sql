-- Read-only early advisor verification for a signed-in student.
-- Do not expose the advisor's private roster or other students' identities.
-- This is a preflight indication, NOT a substitute for the final approval-request guard.
create or replace function public.advisor_check_transcript_roster(
  p_student_id text,
  p_student_number text,
  p_student_name text
) returns jsonb
language plpgsql security definer set search_path = ''
as $verify$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_sid text;
  v_code text := btrim(coalesce(p_student_number,''));
  v_name text := public.advisor_roster_norm(p_student_name);
  v_assigned_advisor uuid;
  v_assigned_by uuid;
  v_verified_advisor uuid;
  v_verified_name text;
  v_matches integer;
begin
  select role,sid::text into v_role,v_sid
    from public.advisor_profiles where id=v_user;
  if v_user is null or v_role is distinct from 'student' then
    raise exception 'Signed-in student account required.' using errcode='42501';
  end if;
  if btrim(coalesce(p_student_id,'')) is distinct from v_sid then
    return jsonb_build_object('status','identity_mismatch');
  end if;
  if v_code !~ '^[0-9]{5,20}$' or length(v_name)<5 then
    return jsonb_build_object('status','missing_student_details');
  end if;

  select advisor_id,assigned_by into v_assigned_advisor,v_assigned_by
    from public.advisor_student_assignments where student_id=v_user;

  if v_assigned_advisor is not null and v_assigned_by is not null
    and exists (
      select 1 from public.advisor_profiles admin
      where admin.id=v_assigned_by and admin.role='admin'
    ) then
    select advisor_name into v_verified_name from public.advisor_roster_batches
    where advisor_id=v_assigned_advisor and status='approved'
    order by reviewed_at desc limit 1;
    return jsonb_build_object('status','verified','method','admin_override',
      'advisorName',coalesce(v_verified_name,''));
  end if;

  select count(*),min(matches.advisor_id::text)::uuid
    into v_matches,v_verified_advisor
  from (
    select distinct batch.advisor_id
    from public.advisor_roster_students item
    join public.advisor_roster_batches batch on batch.id=item.batch_id
    join public.advisor_profiles owner on owner.id=batch.advisor_id
      and owner.role in ('admin','advisor')
    where batch.status='approved'
      and item.student_number=v_code
      and item.normalized_name=v_name
  ) matches;

  if v_matches=0 then
    return jsonb_build_object('status','not_found');
  end if;
  if v_matches>1 then
    return jsonb_build_object('status','ambiguous');
  end if;
  if v_assigned_advisor is not null and v_assigned_advisor<>v_verified_advisor then
    return jsonb_build_object('status','assignment_conflict');
  end if;

  select advisor_name into v_verified_name from public.advisor_roster_batches
    where advisor_id=v_verified_advisor and status='approved'
    order by reviewed_at desc limit 1;
  return jsonb_build_object('status','verified','method','official_roster',
    'advisorName',coalesce(v_verified_name,''));
end;
$verify$;

revoke all on function public.advisor_check_transcript_roster(text,text,text)
  from public,anon,authenticated;
grant execute on function public.advisor_check_transcript_roster(text,text,text)
  to authenticated;
