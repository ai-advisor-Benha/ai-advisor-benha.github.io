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
4. In **Supabase → Edge Functions → Deploy a new function → Via Editor**, create **`advisor-decision-email`** and paste [index.ts](./functions/advisor-decision-email/index.ts). In the function's **Settings**, turn **Verify JWT with legacy secret OFF**, then save. The handler still requires a valid signed-in user's JWT and independently checks the advisor/admin role using Supabase Auth. Alternatively use Supabase CLI: `supabase functions deploy advisor-decision-email` (with `verify_jwt=true` from `supabase/config.toml`).
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

## Troubleshooting: "Unable to verify advisor account"

A previous version used a single privileged Supabase client for both user authorization and server-only operations. The fixed function in this branch:

- Validates the caller's Supabase Auth JWT.
- Reads the caller's **own** `public.advisor_profiles` row with a separate user-scoped client, matching the browser's established RLS model.
- Uses the secret service client only for recipient checks, audit logging, and sending.
- Prefers `SUPABASE_PUBLISHABLE_KEYS.default` and `SUPABASE_SECRET_KEYS.default`, with legacy keys as fallbacks.
- Logs structured database error codes and hints without logging JWTs, passwords or API secrets.

**Important:** merging the pull request updates GitHub source code only. It does not update a Supabase Edge Function already deployed manually. After merging, open Supabase Dashboard → Edge Functions → `advisor-decision-email` → Code, replace with the latest [function source](./functions/advisor-decision-email/index.ts), then **Deploy updates**. Keep **Verify JWT with legacy secret OFF** because the handler verifies the user's JWT itself.

After redeployment, sign out and back in to refresh the user token. From the Academic Advisor page, load an unchanged plan request JSON and retry one notification. If another error appears, inspect Supabase → Edge Functions → `advisor-decision-email` → Logs and check the `advisor-decision-email database failure` entry. Share only the error **code** and **message**, never tokens or API keys.

