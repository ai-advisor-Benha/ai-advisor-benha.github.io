# Final local Groq benchmark and pilot readiness

16 November 2026; branch `codex/groq-bylaw-backend`. No production deployment, database modification, email change or paid service was performed.

## Credentials and connection

The owner confirmed revocation of the exposed key, replacement saved in the private environment file outside Git, Free billing and Zero Data Retention. Revocation and billing status are owner-confirmed, not independently audited. Only the configured replacement was used; no secret was printed. The real `qwen/qwen3.8-27b` connection succeeded through the local gateway.

## Measured results

All records are synthetic. The real browser orchestration, Edge handler and existing academic tools ran locally; the harness substitutes authentication. Times below are individual successful attempts, excluding earlier failures and cooldowns.

| Question | API calls | Input tokens | Output tokens | Total | Wall seconds |
|---|---:|---:|---:|---:|---:|
| English maximum credits | 1 | 409 | 147 | 556 | 0.851 |
| Arabic maximum credits | 1 | 411 | 142 | 553 | 1.022 |
| English CS142 eligibility/prerequisites | 2 | 2303 | 239 | 2542 | 3.273 |
| Arabic CS142 eligibility/prerequisites | 2 | 2050 | 248 | 2298 | 8.188 |
| English CGPA | 2 | 2235 | 175 | 2410 | 3.284 |
| Arabic CGPA, after wording correction | 2 | 2299 | 113 | 2412 | 0.927 |

Verified facts: Spring maximum 18 credits, minimum 9, CGPA 3.35, Art. 9-c; CS142 eligible after passed CS141, Art. 9-e; CGPA 3.35 and grading Arts. 14/15. Values came from actual deterministic tool executions, not model calculations. The original academic engine is unchanged.

The original credit questions used four calls each: English 6028 input + 266 output = 6294 tokens, 185.031 seconds; Arabic 7008 + 365 = 7373 tokens, 186.833 seconds. Measured optimized credit tokens fell 91.2% / 92.5%, and calls fell 75%. Original wall times included fixed pacing waits; this is not a pure model-speed comparison. Five successful rows above preceded the final small grade-translation instruction change; only Arabic CGPA was live-rechecked after that change to limit Free usage.

Across this session: 16 gateway requests, 13 successful model completions with 14,686 reported tokens. Errors do not report token usage, so this is not a complete provider billing/account total. One Arabic course attempt returned 503 and passed on one manual retry. Arabic CGPA encountered two 429 responses (23 and 60 second retry suggestions); cooldowns were respected without clearing quotas or raising limits. Successful latency rows exclude those interrupted attempts.

Human review caught an Arabic qualitative-grade error despite correct numerical GPA and citations: the model said `ممتاز جداً` for engine grade `Very Good`. The prompt now specifies `جيد جداً`, and the benchmark rejects the erroneous classification. The targeted live retest returned the correct grade. This is prompt mitigation, not a general semantic guarantee. That retest omitted the supplied newer-bylaw warning, despite the instruction to preserve it: the structured evidence remains authoritative, and this omission is a pilot limitation requiring supervisor review. Do not advertise these tests as proof that every generated statement is correct.

## Verification and limitations

- Complete offline suite after the wording fix: **80 passed, zero failed**. Includes all eight academic tools, authentication/roles, privacy filtering, persistent quotas/token reconciliation, queue overflow, Retry-After, cancellation/timeouts, invalid completions and service outages. No real student records were sent.
- The running gateway returned HTTP 401 to a real unauthenticated request. Live 429 responses propagated to the harness without hanging. Bilingual student busy messages are covered offline, not through a deployed browser session.
- Supabase authentication was exercised with mocked Edge dependencies. Actual deployed Deno execution, production/staging RLS and login end-to-end remain unverified. No production accounts were used or altered.
- Tool evidence is computed from caller-supplied local academic data. It is not authenticated university SIS evidence and must never issue official academic approval.
- Citation validation checks membership in supplied evidence, not semantic entailment. Arabic terminology, bylaw-version caveats and additional model statements still need human review. Six positive cases are a smoke benchmark, not broad accuracy certification.
- Existing SQL migrations, academic rules, roster matching, approval and Brevo code were not changed.

## Free-tier capacity and decision

Groq publishes 30 requests/minute, 1000/day, 8000 tokens/minute and 200,000 tokens/day for this model; account limits prevail. At the measured successful six-question mix (~1795 tokens and 1.67 calls/question), token-only capacity is roughly 111 questions/day, but the configured 120-call global daily cap reduces this to about **72/day before retries**. Pure recognized credit questions are capped at 120/day; two-call questions at 60/day. The per-user limit is 40 model calls/day. Bursts can fail midway through a question, as observed. These are projections, not load-tested guarantees. [Groq limits](https://console.groq.com/docs/rate-limits).

Suitable for a **small supervised staging pilot**, with retry guidance and human review; not ready for unattended academic decisions or a broad launch. Production activation remains blocked on approved HTTPS hosting, staging end-to-end verification, and review of the caveat/semantic limitations above. Free tier has no demonstrated reliability guarantee in this benchmark.

## Reproduce locally

Keep the existing private file; never copy the example over it. In PowerShell at the repository root:

```powershell
node --env-file=C:/Users/MOHAMEDISSA/AppData/Local/BenhaBylaw/gateway.env inference/gateway.mjs
```

In a second terminal, only after confirming Free/ZDR and authorizing the small test budget:

```powershell
$env:LIVE_GROQ_FREE_TIER_CONFIRMED='true'
node --env-file=C:/Users/MOHAMEDISSA/AppData/Local/BenhaBylaw/gateway.env inference/groq-smoke.mjs --live --suite=academic
Remove-Item Env:LIVE_GROQ_FREE_TIER_CONFIRMED
```

Default `--live` runs only the two credit cases. Use `--case=cgpa-ar` (or credits-en, credits-ar, course-en, course-ar, cgpa-en) to resume just a failed case after its cooldown. The harness stops on failure; do not repeatedly rerun successful cases or bypass persistent quotas. Run offline with `node --test tests/*.test.mjs`.

## Hosting recommendation and activation steps

Recommend a Render paid 0.5 CPU / 512 MB service ($7/month) plus a 1 GB persistent disk ($0.25/month): approximately **$7.25/month**, before taxes or extra usage. No purchase made. [Pricing](https://render.com/pricing). Node 24 is supported (current default 24.22.1; pin a tested version), including the gateway's built-in SQLite runtime. [Node versions](https://render.com/docs/node-version). Persistent disks retain SQLite across restarts, are encrypted, require a paid service and constrain this design to one instance. Deployments with a disk have downtime. [Disk documentation](https://render.com/docs/disks).

Render supplies HTTPS, but its ingress requires binding `0.0.0.0` on its assigned PORT. The current entry point intentionally binds loopback, so it is **not yet directly Render-ready**. Before deployment, add and test an explicit host-binding option for the trusted platform proxy, or package a reverse proxy that forwards to the loopback gateway. Do not expose raw HTTP on an unmanaged host. [Web services](https://render.com/docs/web-services).

After separate hosting/deployment approval:

1. Choose host/region and approve cost. Pin Node 24+, run one process, persist `QUOTA_DB=/var/data/quota.sqlite`, and keep request/body/header logging disabled. Disable automatic deployment/PR previews until approved. Test the platform binding and HTTPS setup.
2. Store the Groq key and a separate strong production gateway secret in host secrets. Keep Free/ZDR enabled; never put either in GitHub Pages. Preserve queue and daily limits.
3. Approve a staging Supabase target. Following GROQ_SETUP.md and the installed CLI's help, set only `BYLAW_GATEWAY_URL`, `BYLAW_GATEWAY_SECRET` and approved origins; deploy only `bylaw-assistant` with its shared imports. No SQL migrations, account changes or email-function deployment are needed.
4. Test real student/advisor/admin authentication in staging, synthetic transcripts, both languages, missing data, caveats, rejected requests and restarts. Supervisor must compare generated narrative with deterministic evidence.
5. Obtain explicit production approval before merging/releasing frontend changes or configuring/deploying the production Edge Function. GitHub Pages alone cannot run this backend. Rollback can disable the assistant function/gateway without touching academic records.
