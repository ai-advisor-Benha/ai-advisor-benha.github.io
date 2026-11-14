# Advisor decision email notifications — deployment steps

The existing academic advising page **downloads a decision JSON** when an advisor clicks **Approve plan** or **Request changes**. This change keeps that download as a backup and also attempts a transactional email to the registered student. A request for changes **requires a comment**, and the email includes that comment.

**No emails will be sent until the server function and Brevo API key below are configured.** The button displays accepted/failed status and does not confuse Brevo's accepted status with inbox delivery.

## One-time setup

1. In **Supabase SQL Editor**, run [advisor_decision_email_log.sql](./migrations/advisor_decision_email_log.sql). This creates a private audit table and prevents repeat notifications.
2. In **Brevo → SMTP & API → API keys & MCP**, create a **new API key** (different from the SMTP key used for password recovery) restricted to **Transactional Email: All**. Save it privately.
3. In **Supabase → Edge Functions → Secrets**, add:
   - `BREVO_API_KEY` — your new Brevo transactional API key
   - `BREVO_SENDER_EMAIL` — your verified sender email (currently `mfibmm1@gmail.com` for testing)
   **Never put these secrets in GitHub or `supabase-config.js`.**
4. In **Supabase → Edge Functions → Deploy a new function → Via Editor**, create **`advisor-decision-email`** and paste [index.ts](./functions/advisor-decision-email/index.ts). Deploy with JWT verification **enabled**. Alternatively use Supabase CLI: `supabase functions deploy advisor-decision-email` (with `verify_jwt=true` from `supabase/config.toml`).
5. Merge this pull request to deploy its `index.html` on GitHub Pages.
6. For an end-to-end test, use a verified registered student account, generate their plan request JSON, review it as an approved advisor, then click **Approve plan** or **Request changes** with a comment. Inspect Brevo's **Transactional → Email → Logs** and the student mailbox.

## Safeguards and scope

- Sending is limited to authenticated database-approved `advisor` and `admin` accounts.
- A non-demo recipient must be a **verified Supabase student account** whose email and student ID match the uploaded plan request.
- A mismatched-ID admin demo can email **only the designated owner admin account** (`mfibmm1@gmail.com`); it will not contact a real student.
- The server checks the plan fingerprint, rejects requests with invalid details, avoids duplicate sends and limits each advisor to 30 unique notification requests in 24 hours.
- No entire transcript or grades are transmitted to Brevo. The email includes decision, semester, course codes, and comments.
- This is an **email notification only**. The original JSON decision remains the mechanism for importing a decision into a student's local browser; email acceptance does not update the university's student information system.
- A 16-character fingerprint is useful for matching the same plan but is **not** a student-authored cryptographic signature. A production university integration should include authenticated submissions and server-side approval records.
