-- Server-only data access for the new verified advisor email function.
-- This does not grant any new permissions to browsers, anonymous or student roles.
grant select on table public.advisor_student_assignments to service_role;
grant select on table public.advisor_plan_requests to service_role;
grant select, insert, update on table public.advisor_request_notice_log to service_role;
