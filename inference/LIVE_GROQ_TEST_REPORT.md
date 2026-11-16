# Live Groq local test — 16 November 2026

Branch: `codex/groq-bylaw-backend`. Provider: Groq. Model: `qwen/qwen3.8-27b`. User confirmed Free tier and Zero Data Retention. No paid upgrade, production database access, deployment, merge or push occurred.

## Configuration and security

The gateway used a private environment file outside the GitHub repository in the user's LocalAppData/BenhaBylaw directory. The directory is restricted to the Windows user, SYSTEM and Administrators. A 32-byte cryptographic random gateway secret was generated without printing it. The user entered the provider key locally; no key or gateway secret appears in this report. The gateway bound to `127.0.0.1:8787`; an unauthenticated POST returned HTTP 401.

## Corrected final runs

Synthetic Computer Science record only: CS101 A, CS141 B, CGPA 3.35. Context program was derived from the engine record. Actual academic tools executed locally; real Groq completions requested and explained their results.

| Language | Calls | Input tokens | Output tokens | Total tokens | Sum of call elapsed times | End-to-end with pacing |
|---|---:|---:|---:|---:|---:|---:|
| English | 4 | 6,028 | 266 | 6,294 | 1.986 seconds | 185.031 seconds |
| Arabic | 4 | 7,008 | 365 | 7,373 | 3.782 seconds | 186.833 seconds |

Call elapsed times include local gateway/network/provider work; they are not isolated model-generation times. The diagnostic deliberately waits 61 seconds between rounds to preserve the unchanged Free-tier minute budgets. Final-run total: 13,667 provider-reported tokens. Across all attempts in this session, successful responses reported 35,177 tokens; rejected/failed calls supplied no usage, so that figure is not a billing audit. No billing dashboard was inspected; Free status was confirmed by the user.

Both final answers gave maximum Spring registration of **18 hours** and cited **Art. 9-c**. The English answer also gave the correct minimum of 9 hours and stated that no graduation exception applied. Arabic gave the correct CGPA and referenced the July 2019 bylaw. Its possible-newer-bylaw caveat matches the engine's `bylaw_version.status`: synthetic enrollment 2024–2025 is 5+ years after 2019–2020. These are successful checks for these questions, not proof of correctness for every academic topic.

## Errors and fixes observed

- Three early attempts hit local HTTP 429 because multiple rounds exceeded conservative minute reservations. Limits were not raised or cleared. Added pacing to the diagnostic, not the production UI.
- One corrected Arabic attempt returned HTTP 503/unavailable after 10.620 seconds without usage. The later Arabic-only retry succeeded. The gateway's generic response does not identify whether the cause was network or provider infrastructure.
- The original smoke test context incorrectly named Scientific Computing while the synthetic engine used Computer Science. The model flagged it. The harness now reads the program from the engine, and both languages were rerun.
- The model requested extra rule lookups. Clarified that completed evidence satisfies the tool requirement; the existing final pass still bounds the interaction. Further optimization is needed before public activation.
- Added safe per-call timings/token counts and optional `--language=ar` or `--language=en` to rerun a failed case without repeating both languages.

## Remaining activation work

1. Improve or schedule interactive multi-round requests so the website does not frequently exhaust Free-minute quotas; the diagnostic pacing is not implemented in the UI.
2. Evaluate other academic topics and Arabic phrasing against all existing tools using synthetic records. The offline suite covers all eight tools, but live testing here focused on credit limits and supporting bylaw/record lookups.
3. Select an approved secure HTTPS gateway host with persistent quota storage. No GPU is required for hosted Groq inference. GitHub Pages cannot host the Node gateway; hosted Supabase cannot reach local loopback.
4. Configure approved staging Edge secrets, deploy only `bylaw-assistant` after approval, and verify real Supabase authentication and RLS with synthetic accounts. Local smoke authentication is a synthetic stub, not a live Supabase login test.
5. Resolve the selected model's preview status and agree operating limits/hosting before production approval. Then deploy the gateway and Edge Function through the approved process. No SQL migration or account recreation is needed.

See `GROQ_SETUP.md` for commands. The development files remain local and unmerged.
