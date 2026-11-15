# Verified Academic Advisor Assignment — Ibn Al-Haytham Exports

## Source actually examined (15 November 2026)

The supplied `StudentsData (1).xls` is an **HTML report** despite its `.xls` extension, with a `headerTbl` and a `ReportTbl`.

- The title explicitly says **تقرير طلاب المرشد الاكاديمي** and names **الاستاذ الدكتور محمد فوزي ابراهيم عيسي**.
- The report is associated with **كلية الحاسبات والذكاء الاصطناعي — حسابات علمية**.
- It contains **110 students with 110 unique university student codes**.
- Relevant columns: `اسم الطالب`, `كود الطالب`, `برنامج الطالب`. The file also contains system email, optional email, phone, supervision start date, GPA and level.
- **No 14-digit national IDs are present** in this advisor roster. Do not conflate the university student code with the registration ID.
- A student's individual Ibn Al-Haytham transcript has `Students Number`, `Student Name`, and `ID Number`. These provide the university code and name for matching plus the separate login-ID consistency check.
- Do **not** infer the academic advisor from `مستخرج البيان` in an individual transcript; it identifies the exporter, not necessarily the advisor.

## New workflow

1. Register an advisor (role `advisor` or `admin`) with a verified email; no public advisor directory or emails need to be exposed to students.
2. The advisor logs in and uploads **their own official export**, not a student-created list.
3. The client parses the HTML `.xls` or supported `.xlsx` export. It validates the explicit academic-advisor report heading, Arabic advisor name, relevant column headers, unique numeric student numbers and nonempty names.
4. Only **university student number and full name** per student are sent to the database. **Do not upload or retain phone numbers, GPA, email addresses or grades** from the roster.
5. The roster starts `pending`. The administrator verifies the report title, registered uploader identity and sample/full student roster, then chooses **Approve** or **Reject**. Approval atomically replaces the advisor's previous approved roster; cross-advisor overlaps are rejected. Old data remains for audit and requires institutional retention governance.
6. The student registers under their own, distinct 14-digit identity number and confirms their email. They upload their own Ibn Al-Haytham transcript, which must have the same 14-digit ID.
7. Clicking **Send for Approval** saves the backup JSON as before, then invokes `advisor_submit_verified_plan`. The server matches `studentNumber` **and** normalized full `studentName` from the plan with the **approved advisor roster**. If exactly one match exists, the student is assigned to that advisor and the request is saved in the advisor's inbox. Brevo is notified separately; the inbox remains authoritative.
8. If the code, name or roster is missing, the server refuses the request and displays a clear correction path. A guessed **registered advisor email, ADV code or manually altered browser interface is not enough**.
9. In exceptional cases, a true database administrator can use the existing **Assign students to academic advisors** form. This creates a recorded manual override, distinct from student-initiated self-assignment.

## Privacy and security notes

- The uploaded report is NOT an authenticated SIS API response or a cryptographically signed document. The administrator must independently verify the export and its association with the advisor before approving it.
- Matching university code and Arabic name **reduces wrong-advisor routing**, but alone does **not** prove a student is who they claim to be. For stronger identity assurance, add university SSO or a trusted SIS feed that binds the student's login to their unique university code and national ID. Do not treat this as official enrollment verification.
- Advisor rosters are private. RLS grants advisors access only to their own data, administrators to approved faculty management data, and students **no direct list access**.
- Admin approval is per **roster upload**, not per student. One approved roster can cover hundreds of students.
- Students do not enter or search for an advisor's email as an authorization mechanism.
- Review legal basis, institutional access policies, retention/deletion schedule, and Brevo sending rate limits before university-wide deployment.

## Deployment / acceptance checklist

1. Apply `supabase/migrations/20261115_verified_official_advisor_rosters.sql` to the correct Supabase project. This migration installs the roster schema, role-checked APIs and an all-path insert trigger for advisor plan requests.
2. Deploy the updated `advisor-inbox.js`, new `advisor-roster.js` and `index.html` together. **Do not enable backend validation until the website uses the new RPC**.
3. Advisor logs in, selects Academic Advisor workspace and uploads a fresh, genuine official `.xls`. Confirm it shows the correct advisor name and expected student count.
4. Admin opens Admin workspace, inspects the report uploader, actual owner email and student codes and approves it.
5. A real student with a matching university code, full name and registered identity can submit; confirm pending inbox and email attempt.
6. A wrong-name, wrong-number, unrelated-advisor, or unapproved-roster student is **blocked**, including through the legacy API.
7. Verify a student cannot read private rosters; advisors see only their own.
8. Approve a replacement export for the same advisor and confirm the previous list is superseded. Test a conflicting student code across two advisors is rejected for review.
9. Test both Brevo email flows and university identity verification; note backend SQL testing alone cannot validate real email delivery.

## Test records

The sample advisor report of 110 students is a private **user-supplied reference** only. It is *not* published to GitHub and must be uploaded by the authorized advisor into the secured workflow after administrative review. Do not use another person's university code and name with a made-up national ID to simulate full identity verification. Use institution-approved synthetic test accounts and test datasets.
