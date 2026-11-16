# Ask the Bylaw optimization and deployment readiness

Historical optimization-stage report. See FINAL_PILOT_READINESS.md for the subsequent replacement-key live benchmark and current readiness decision.

Date: 16 November 2026. Branch: `codex/groq-bylaw-backend`. Changes are local only. No push, merge, deployment, paid billing, production SQL, account, roster, academic-calculation or email-function change was made.

## Credential status and live-test boundary

The user reported the Groq API key exposed. The old gateway was stopped and the key was replaced with a placeholder in the private LocalAppData/BenhaBylaw/gateway.env file, outside Git. No credential was displayed. The user subsequently elected not to change the key. Consequently **no live API requests were made in this optimization run** and the gateway remains stopped. Do not restore the exposed key from history. A replacement from the user's Free/ZDR organization is required before the opt-in live benchmark can run. Enter it directly in the private file, never chat or source control. Revoke the exposed key in Groq Console.

## Why the old flow needed four calls

The initial question required model tool selection. Subsequent requests resent all ten tool schemas plus the same long instructions, even after `credit_limit` had returned its result and article. The model asked for supporting/repeated `lookup_rule` calls and sometimes `get_student_record`. Only the fourth pass removed tools and forced an explanation. The diagnostic then waited 61 seconds between rounds. The prior roughly three-minute latency mostly measured those deliberate waits, not model generation. Provider failure and local rate limits were also observed in that session.

## Changes

- Narrow, fully matched English/Arabic credit-limit templates receive an authenticated deterministic tool plan, without invoking a model: `credit_limit` and `get_student_record`. Missing transcripts route to general `lookup_rule` only. Hypotheticals, multiple questions, graduation exceptions, ambiguous queries and follow-ups retain model planning. The router computes no academic result.
- Once independent results exist, the next pass contains evidence and no tools. General questions normally use a planning call and an explanation call. Course-name resolution retains a dependent `check_course` pass, so it can need three. The final-pass safety bound is preserved.
- All eight required academic tools, plus course search and improvement options, remain available. Their engine code is unchanged.
- Shortened system instructions retain authoritative tools, untrusted-input handling, privacy/approval boundaries, uncertainty and article requirements. For the narrow credit route only, the model receives the credit result plus program/bylaw-version caveats rather than unrelated student totals. The UI retains the full filtered deterministic evidence. Identical evidence records are deduplicated.
- Successful tool names are removed from subsequent planning schemas. Exact repeated tool requests are rejected. No automatic fallback model or provider is configured.
- Recognizable English/Arabic article citations are checked against supplied successful evidence. Missing citations when evidence has articles, or unknown citations, produce the safe unverified-answer message. This checks reference membership, not full factual entailment or authentic university records. Free-text semantic correctness still needs human/live evaluation.
- Public `lookup_rule` results are cached only inside a single question. They cannot cross transcript/program/account changes or users. Student records and generated answers are never cached. A bounded six-entry cache stores only immutable public routing plans, not question text or academic records.

## Queue and time limits

One FIFO is shared across all gateway callers. Default: one active call and four pending calls (MAX_CONCURRENT/MAX_PENDING). A saturated queue returns 429 with a suggested wait. Queued requests wait at most 12 seconds; queue plus inference/retries has a 45-second deadline. The browser bounds the entire question to 110 seconds, including all passes, and its individual network call retains a 65-second timeout. Cancellation removes pending jobs and aborts upstream fetches.

SQLite atomically reserves per-user/global requests and estimated input + maximum output tokens. Validated numeric provider usage reconciles token reservations in the original minute/day windows, including after a window changes. Request counts are never refunded. Failed/429 attempts retain their reservation. Token estimation is not the provider tokenizer; upstream remains authoritative.

Provider Retry-After supports seconds and HTTP dates. There is at most **one** automatic retry of a 429, only if its wait is at most 12 seconds and fits the total deadline. All users share the provider cooldown. Long waits/day exhaustion return promptly with a bilingual busy message and retry time; there is no background retry storm. Network failures/5xx/bad credentials are not retried automatically. Retry-After is propagated gateway → Edge → browser. The student can choose to try again later.

Run a **single gateway process/replica** initially. SQLite reservations are transactional, but the FIFO/concurrency/cooldown are process-local. Multi-replica hosting requires a shared external scheduler rather than independent queues. Quota counters survive restarts; the in-memory queue and cooldown do not. Requests in flight at restart fail safely rather than being replayed.

## Before/after comparison

The before data are real successful Groq results from LIVE_GROQ_TEST_REPORT.md. After data are offline tests using the actual academic engine and actual payload builder with mocked model responses. The optimized benchmark uses natural-language equivalents of the same Spring credit-limit question rather than explicit tool-name instructions.

| Metric | Before English | Before Arabic | Optimized offline |
|---|---:|---:|---|
| Model calls | 4 | 4 | 1 per recognized credit-limit question; general path tested at 2 |
| Actual total tokens | 6,294 | 7,373 | Not measured live |
| Input request size | Repeated schemas/instructions | Repeated schemas/instructions | 1,935 / 1,956 UTF-8 bytes |
| Estimated input tokens | Actual input 6,028 | Actual input 7,008 | 645 / 652 using bytes÷3; not a tokenizer measurement |
| API call time sum | 1.986 seconds | 3.782 seconds | Pending live measurement; do not use mocked wall time |
| Whole question | 185.031 seconds | 186.833 seconds | No fixed 61-second waits; actual latency pending |
| Deterministic facts | 18 h, CGPA 3.35, Art. 9-c | Same | Same tools/results preserved and asserted |
| Real model answer quality | Passed those credit-limit cases | Passed with bylaw-version caveat | Pending replacement key and live evaluation |

At the documented 200,000 tokens/day, old consumption implied roughly 27–31 questions/day. If actual optimized total usage becomes 800–1,100 tokens/question, the token allowance would imply about 180–250 questions/day. **That is a projection, not a measured capacity.** The current example's lower 120 global model calls/day caps recognized one-call questions at 120/day, and two-call questions at 60/day; mixed workloads, retries and per-user caps reduce this. At most 40 model calls/day per user in the example. Keep the account on Free: quota settings do not prevent charges if someone upgrades its billing tier.

The published account/model limits must be verified in the user's console before activation. Sources: [Groq rate limits](https://console.groq.com/docs/rate-limits), [current model](https://console.groq.com/docs/model/qwen/qwen3.8-27b). Qwen remains preview in the checked documentation.

## Tests and reproducibility

Offline commands (no key, no network provider):

```powershell
node --test tests/*.test.mjs
node inference/benchmark-offline.mjs
```

Latest result: **79 tests passed, 0 failed**, including existing login/roster/approval regressions, all eight academic tools, fast-path boundaries, compound-question fallback, course-name dependency, bylaw caveat preservation, unsupported citations, request-local cache isolation, stalled-client timeout, FIFO/cancellation/overflow, short bounded retries, shared cooldown, minute/day limits and durable token reconciliation. Existing UI and engine bodies were preserved except the assistant's error display now includes Retry-After.

After a new key is securely saved and the owner confirms revocation/rotation, use the existing GROQ_SETUP.md startup command and run groq-smoke.mjs --live with LIVE_GROQ_FREE_TIER_CONFIRMED=true. The updated script removes artificial pacing, runs only the two synthetic bilingual questions, prints safe per-call timing/usage/provider attempt counts and stops on errors. Do not bypass quotas or repeatedly run it to force success. A long Retry-After should be respected before any manual retry. No new live benchmark has run yet.

## Readiness decision

**Suitable architecture for a small supervised Free-tier pilot, conditional on live revalidation; not ready for unrestricted production.** The new model behavior and short-retry path need testing against the real provider using the replacement key. Use synthetic/consenting pilot accounts, verify missing transcripts, other programs, course eligibility, GPA simulations and graduation scenarios, and human-review Arabic phrasing and evidence. Tests do not establish correctness of every existing bylaw algorithm.

Hosting needs: one always-running Node 24+ CPU process, private persistent SQLite disk, outbound HTTPS to Groq, and a trusted HTTPS reverse proxy. A planning starting point is 0.5–1 vCPU, 512 MB RAM and 1 GB persistent disk; this is an engineering estimate, not a measured requirement or vendor quote. No GPU is needed. Reuse approved institutional hardware if available; any purchased hosting still needs approval. GitHub Pages cannot run this service. Keep gateway port on loopback, secrets outside source/web roots, and request-body/credential logging disabled.

Deploy gateway.mjs, providers.mjs **and queue.mjs** together. The Edge function now also imports planning.mjs; deploy through the CLI to bundle it and the shared protocol. After separate staging approval, set the existing gateway secrets and deploy only bylaw-assistant, then test actual Supabase authentication. Update the browser adapter/shared protocol/error display together only after frontend-release approval. Production launch requires explicit approval; there are no SQL migrations or account/roster/email changes.
