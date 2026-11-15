# Online Academic Advisor Inbox — Installation and Acceptance Plan

**Status:** Pull-request implementation; **NOT LIVE** until the database migration is reviewed/applied and the frontend is merged and tested.

## Purpose

Replace the mandatory manual handoff of student approval-request JSON with a secure, persistent student-to-assigned-advisor queue. Preserve the downloadable JSON backup, existing deterministic academic-rule checks, original staff/student role separation and existing Brevo notification service.

## Files

- `supabase/migrations/20261115_advisor_online_inbox.sql`: four protected tables and four authenticated, role-validated PostgreSQL RPCs.
- `advisor-inbox.js`: bilingual student request history, advisor inbox with pagination, admin assignment UI, periodic refresh.
- `index.html`: minimal integration hooks; existing parser, bylaw logic, course selection and file exchange remain in place.

## REQUIRED manual deployment (do not skip)

1. **Before any database changes**, obtain a verified backup of the current Supabase schema/data (especially `advisor_profiles` and `auth.users`). This repository does not contain a verified live database schema dump. Review the migration against the current production schema. It assumes `public.advisor_profiles(id uuid, email text, sid, role)` with student/advisor/admin roles.
2. In the existing Supabase project, run the SQL file in the SQL Editor using a trusted database administrator. No service-role API keys should be pasted into the browser or repository. Confirm the tables exist and RLS is enabled:
   - `public.advisor_student_assignments`
   - `public.advisor_plan_requests`
3. Confirm only `authenticated` can execute the RPCs `advisor_assign_student(text,text)`, `advisor_submit_plan(jsonb,text)`, `advisor_save_plan_decision(uuid,jsonb)`. Each function additionally verifies the caller's true server-side profile role.
4. Ensure there are properly registered **verified staff accounts** promoted to `advisor` in the real Supabase role table. Advisors cannot self-assign a staff role in the browser.
5. Once reviewed, merge this branch into `main` and let GitHub Pages publish `index.html` and `advisor-inbox.js` together (or deploy both on Vercel). The original `supabase-config.js` remains unchanged.
6. Log in as a trusted administrator. In **Assign students to academic advisors**, enter an existing student email and an approved advisor email; click **Save assignment**. For large cohorts, faculty IT should prepare audited assignments using a trusted bulk-import process instead of entering thousands manually.
7. Log in as that student, upload an Ibn Al-Haytham transcript, create a valid plan and click **Send for approval (.json)**. The JSON still downloads. The new panel should report that the request was saved in the advisor's inbox.
8. Log in as the assigned advisor. The request appears automatically in the new inbox. Click **Review request**; the original bylaw engine independently recomputes eligibility. Approve or request changes; the decision is saved in Supabase **before** the normal Brevo email is attempted. A JSON decision still downloads as backup.
9. Sign in as the student again (or use **Refresh status**). The online history shows the decision; if the student's currently loaded plan and fingerprint match, the decision also appears in the normal Step 5 decision panel. It will not be silently applied to a different plan.
10. Check the Brevo notification logs independently. Email acceptance does not guarantee delivery.

## Tests and operational limits

- Run the dependency-free browser-client smoke suite with `node --test tests/advisor-inbox.test.mjs`. It uses mock Supabase calls and does not touch real student data.
- The database RPC limits each student to 20 pending plans and 30 new submissions per hour; exact limits can be reviewed with faculty policy before rollout.
- The existing Brevo Edge Function independently limits email attempts to **30 per advisor per 24 hours**. Online decisions remain available even if this email quota is exceeded. Increase email throughput only after an approved operational review.
- This pull request has not executed tests against the real Supabase project. Database migration, RLS role tests and real student/advisor email notifications must be validated in a staging project before production.

## Security model

- The student uploads their approval-request JSON **intentionally**. This includes course-attempt and grade details necessary for an advisor's independent bylaw check. It is not a complete university SIS sync.
- Each student may SELECT only their own requests. Advisor registration codes are private, high-entropy routing tokens and cannot be used to bypass authentication or see unrelated transcripts. An advisor may SELECT only requests whose student is **currently assigned to that advisor**, with a database-verified advisor/admin role. The administrator assignment list is restricted by RLS.
- Frontend role selectors are never trusted for authorization. Database RPCs use `auth.uid()`, `advisor_profiles.role`, the assignment table, matching student ID/email, and decision/request matching checks.
- Browser clients have SELECT (RLS-scoped) only on the new tables; they cannot directly INSERT, UPDATE or DELETE rows. All writes go through guarded RPCs.
- Online demo requests are intentionally disabled: owner demo continues to use the established downloadable JSON flow. This prevents accidental upload of someone else's sample transcript.
- The student file/download workflow and advisor manual JSON workflow remain available if the migration is not yet installed, an advisor has not been assigned, or the network is unavailable.
- The current bylaw engine still runs in the browser. Advisor approval rechecks it in the advisor interface, but the new database RPC **does not independently reproduce the entire academic bylaw engine**. Server-side academic validation and a signed/audited decision protocol are recommended before official SIS-integrated deployment.
- The inbox polls about every 60 seconds; advisor notification email is attempted when a new request arrives, while the existing student decision email is attempted on approval/change. Neither is a guaranteed delivery. Enabling Supabase Realtime is a separate optional enhancement.

## Acceptance tests using anonymized pilot accounts

| Test | Expected result |
|---|---|
| Anonymous access to both tables | Denied |
| Student can read another student's request ID | Denied by RLS |
| Advisor A tries to read Advisor B's assigned student | Denied by RLS |
| Student tries to call the admin assignment RPC | Denied |
| Student tries to call the advisor decision RPC | Denied |
| Advisor tries to decide a request assigned to another advisor | Denied |
| Real student request email/ID differs from registered profile | Rejected by database RPC |
| Student has no advisor assigned | Helpful failure notice; JSON file remains |
| Admin assigns a student to an approved advisor | Subsequent submissions route to the advisor |
| Reassign a student with a pending request | Pending request transfers to new advisor; old advisor loses read access |
| Student sends same pending plan twice | Same pending request, no duplicate row |
| Advisor approves eligible plan | Database stores decision; student can see approval |
| Advisor requests changes without a comment | Rejected |
| Advisor tries to review already decided request again | Rejected by database RPC |
| Advisor changes student/term/plan in saved decision | Rejected |
| Advisor submits an academically ineligible plan | Browser refuses approval, allowing 'Request changes' |
| Student changes the current plan after approval | Old decision is not shown as a match |
| Missing migration or network failure | Download JSON remains available, error shown |
| Owner-only Student Demo Mode | Manual JSON only; no sample upload |
| Language switch / Arabic RTL | Inbox, statuses, assignments remain legible |
| 51+ assigned requests | Advisor can page through results; none lost |
| Logout and subsequent login | Queue persists in Supabase; polling is stopped on logout |

## Deployment constraints / rollback

- A GitHub merge **does not automatically apply SQL migrations**. Without this migration, the new online panels show a configuration error; the original manual JSON functions still work.
- Use a small, anonymized faculty pilot before student-wide deployment. Verify Supabase database capacity, Auth email limits, browser privacy, Retention Policy, RLS and university authorization separately.
- To roll back the new frontend, revert the PR commit / GitHub Pages deployment. Keep database tables intact initially to avoid losing requests; only remove backend schema after a controlled data export and institutional approval.


## ADDITION: First-time advisor code and notification email (2026-11-15 update)

**This PR includes the complete code changes, but is NOT active on the live website.** Apply the SQL migration first, then deploy the new Edge Function and test with anonymized accounts before merging the frontend.

### Code assignment
- Each verified advisor receives **one unique persistent code** in their advisor inbox, generated on first login by `advisor_get_my_code()`. Its format is `ADV-` followed by 24 uppercase hexadecimal digits.
- The first time a student clicks **Send for approval**, a JSON backup downloads as before. If the student has no assignment, a form appears requesting the advisor code. The database validates the code and saves both the advisor assignment **and** request atomically.
- The student's status becomes **Pending approval**. Once the advisor opens the request and approves/requests changes, the student status changes to **Approved** or **Changes requested**, showing the advisor comment.
- Subsequent student submissions go automatically to that advisor. Students cannot switch advisors with a second code; only a verified administrator can reassign them.
- The advisor's own code is never exposed to students via an API lookup or anonymous table read. Authorized advisors share their code out of band with their own students. A code is **not** a login credential.
- The advisor inbox supports **All requests**, **Pending approval**, **Approved**, and **Changes requested**, with pagination, course-by-course academic review, and preserved decision history.

### Email notifications
- **New request:** `supabase/functions/advisor-request-notify/index.ts` sends a minimal email to the verified assigned advisor through Brevo. It does not include any transcript, grades, or national ID. The new database table `advisor_request_notice_log` deduplicates requests and limits repeated emails.
- **Advisor decision:** The already-existing `advisor-decision-email` Edge Function sends the student an approval/change email after an online decision is saved. Brevo acceptance does not guarantee inbox delivery.
- **Required separate deployment:** deploy the new function in Supabase, set the existing server-only `BREVO_API_KEY` and `BREVO_SENDER_EMAIL` secrets, and add `ALLOWED_WEB_ORIGINS` (comma-separated domains) only if using another trusted frontend host besides GitHub Pages. `supabase/config.toml` includes the new function configuration. Do **not** put secrets in GitHub/frontend JS.
- Email failure never removes the request or its decision from the Supabase inbox. A warning is displayed instead. Brevo plans have independent sending limits; peak semester demand must be capacity-tested.

### Files to inspect in this PR
- `index.html` and `advisor-inbox.js`: UI, status tracking, code entry, routing and inbox.
- `supabase/migrations/20261115_advisor_online_inbox.sql`: role-checked RPCs and private assignment, code, request and email-log tables.
- `supabase/functions/advisor-request-notify/index.ts` and `supabase/config.toml`: advisor new-request notifications.
- `tests/advisor-inbox.test.mjs`: mocked client tests (run `node --test tests/advisor-inbox.test.mjs`).

### Additional required acceptance tests
- Student with no assignment sees code form; a valid code saves request and assignment atomically.
- Invalid/unrecognized code is rejected, with no account or assignment change.
- An already-assigned student cannot switch advisor via a different code.
- Every advisor sees only their assigned students under RLS and gets one stable personal code across sessions.
- Unauthorized users cannot read other advisor codes or unrelated requests.
- Student sees Pending immediately after DB commit, then Approved/Changes requested after advisor decision.
- Decision history persists across devices and login sessions; mismatched plan fingerprints cannot auto-apply.
- The advisor email is sent only to the verified assigned advisor. Failures leave inbox requests intact.
- The existing student decision email arrives if configured; email is not proof of official SIS registration.
- Validate email quotas and rate limits under an estimated 7,000 students before rollout.

**Known limitation:** Academic bylaw checks remain in the existing browser engine, with advisor-side re-evaluation, and are NOT independently recomputed by the SQL RPC. This remains a pilot decision-support workflow, not authorized SIS registration.
