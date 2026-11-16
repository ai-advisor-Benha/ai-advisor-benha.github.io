# Groq backend: local pilot and deployment

Read FINAL_PILOT_READINESS.md for the latest real benchmark and activation blockers, and OPTIMIZATION_REPORT.md for queue design. Do not reuse the exposed key.

Prepared 16 November 2026 on `codex/groq-bylaw-backend`, from verified main `f33851f`. No production deployment or database change is part of this work. The existing UI, academic formulas, accounts, roster, approval and email code are unchanged.

## Provider configuration

`INFERENCE_PROVIDER=groq` selects the exact endpoint `https://api.groq.com/openai/v1/chat/completions`. It requires `ALLOW_REMOTE_INFERENCE=true` and a server-only `INFERENCE_API_KEY`. The configurable model defaults to `qwen/qwen3.8-27b`. Groq currently lists this model as **preview**, so use a pilot first and verify availability in your account before production approval.

The adapter sends `max_completion_tokens:1200`, `reasoning_effort:"none"`, tool definitions, `tool_choice`, `temperature:0.2` and `stream:false`. It does not send llama.cpp's `chat_template_kwargs`, the quota pseudonym, gateway secret, or Supabase JWT to Groq. `INFERENCE_PROVIDER=local` retains the previous llama.cpp-compatible path. There is no paid fallback or retry loop.

Official references checked: [Qwen model](https://console.groq.com/docs/model/qwen/qwen3.8-27b), [API compatibility](https://console.groq.com/docs/openai), [rate limits](https://console.groq.com/docs/rate-limits), [data controls](https://console.groq.com/docs/your-data).

## Before supplying a key

Create or select your own Groq organization and verify that its billing tier is **Free**. Do not upgrade, add paid fallback or purchase credits. Enable Zero Data Retention in its Data Controls. Create an API key and put it directly into the private environment file below, never chat, frontend code, Git or a command argument. The gateway cannot query/guarantee your billing tier: a key from an already-paid organization can incur costs. Quotas are usage bounds, not a substitute for Free account status.

Groq documents 30 requests/minute, 1,000/day, 8,000 tokens/minute and 200,000 tokens/day for this free model, subject to account-specific limits. The example uses lower request limits and one concurrent call. Token budgets reserve an estimated input count (UTF-8 request bytes divided by three, rounded up), plus 1,200 maximum output tokens and 256 framing allowance. This is an estimate, not Groq's tokenizer; upstream 429 responses remain possible. Validated provider usage reconciles token reservations; failed attempts retain reservations and request counts are never refunded. Large roadmap evidence may exceed the pilot budget and be rejected; compacting evidence or higher approved quotas would require separate validation. SQLite persists request/token counters on disk; all users share the global budgets. Do not run multiple gateway processes with independent quota databases.

## Run locally on Windows

Use Node 24+ with built-in `node:sqlite`. From the repository root:

```powershell
$privateDir = Join-Path $env:LOCALAPPDATA 'BenhaBylaw'
New-Item -ItemType Directory -Path $privateDir -Force | Out-Null
Copy-Item -LiteralPath './inference/groq.env.example' -Destination (Join-Path $privateDir 'gateway.env')
```

Do not overwrite an existing configured file. Edit `gateway.env` locally in a trusted editor. Set `INFERENCE_API_KEY` to the Groq key and `GATEWAY_SECRET` to a unique cryptographically random secret of at least 32 characters. Use a password manager's generator. Set `QUOTA_DB` to an absolute private path, for example `C:/Users/YOUR_USER/AppData/Local/BenhaBylaw/quota.sqlite`. The private directory must be accessible only to your account/administrators. The example contains placeholders and will refuse to start until replaced.

Start in the repository root:

```powershell
node --env-file="$env:LOCALAPPDATA/BenhaBylaw/gateway.env" inference/gateway.mjs
```

The gateway binds only `127.0.0.1:8787`. Starting it makes no inference calls. In another terminal, an unauthenticated request must return 401:

```powershell
curl.exe -i -X POST http://127.0.0.1:8787/infer
```

Run all offline tests (no Groq account or paid request needed):

```powershell
node --test tests/*.test.mjs
```

For an explicitly authorized live smoke test **after verifying Free billing**, keep the gateway running and run:

```powershell
$env:LIVE_GROQ_FREE_TIER_CONFIRMED='true'
node --env-file="$env:LOCALAPPDATA/BenhaBylaw/gateway.env" inference/groq-smoke.mjs --live
Remove-Item Env:LIVE_GROQ_FREE_TIER_CONFIRMED
```

The script uses only synthetic CS101/CS141 grades and runs paired English/Arabic credit-limit questions through the existing orchestration, Edge handler and gateway. The gateway queue now handles short waits and bounded retries; the diagnostic has no fixed 61-second waits. It stops on failure and checks tool execution, the expected 18-hour limit and exact bylaw article. It reports per-call elapsed time and provider token usage without credentials. The program context comes from the synthetic engine record. It prints the answer for human review. These checks do not prove the absence of additional false statements. It uses a synthetic local authentication stub; real Supabase Auth is tested separately by the mocked Edge-entry tests and must be verified in staging. This script is never included in the normal test runner and refuses network work without both opt-ins.

## Prepare the Supabase function

The existing function already authenticates the real user through Supabase Auth and reads only that caller's profile role under RLS. It uses a pseudonym for gateway quotas, not an inference-provider user ID. No service-role key is needed. Keep `verify_jwt=false` for this function because its handler performs Auth verification itself.

Use `supabase/functions/bylaw-assistant/.env.example` for staging secrets:

```text
BYLAW_GATEWAY_URL=https://YOUR_APPROVED_GATEWAY_HOST/infer
BYLAW_GATEWAY_SECRET=<same secret as gateway>
BYLAW_ALLOWED_ORIGINS=https://YOUR_APPROVED_STAGING_SITE
```

The hosted function cannot access your computer's loopback address. It requires an approved reachable HTTPS gateway. HTTP, credentials in URLs, query strings, fragments and non-`/infer` paths are rejected. The Groq key belongs only on the gateway; the Edge Function does not need it. The existing platform Supabase URL/public key supply Auth verification.

## Later secure-host deployment (approval required)

1. Select an approved existing host or separately approve hosting charges. A small Node CPU service with persistent disk is enough; no model GPU is needed. No hosting was purchased or configured here.
2. Install Node 24+, create an unprivileged `bylaw` account and private `/etc/bylaw` and `/var/lib/bylaw` directories. Copy `gateway.mjs`, `providers.mjs` and `queue.mjs` to `/opt/bylaw/inference/`. Keep production code and secrets outside GitHub Pages.
3. Store `/etc/bylaw/gateway.env` with owner-only permissions. Set `QUOTA_DB=/var/lib/bylaw/quota.sqlite`. Use a new production gateway secret. Review Free tier/ZDR and the model's preview status.
4. Use the existing `bylaw-gateway.service.example` as the systemd unit, adjusting the Node path, and `Caddyfile.example` for HTTPS. Use approved DNS; expose only 443 and keep ports 8787/8080 private. Do not enable request-body or Authorization logging.
5. Verify unauthenticated `/infer` returns 401, valid synthetic calls succeed, rate limits survive restarts, and provider outages fail safely. The service must not silently route to another provider.
6. With staging deployment approval, install/check the Supabase CLI and run `supabase --help`, `supabase secrets set --help`, and `supabase functions deploy --help`. CLI v3 changed hosted-target behavior, so select the approved staging project explicitly using that installed CLI's documented options. Load the private Edge secrets file and deploy **only `bylaw-assistant`**, bundling its existing shared imports. Never run `db push`/reset or deploy email functions for this feature.
7. Verify existing-role authentication, bilingual tools/articles, missing transcripts, cancellation, privacy and latency using synthetic accounts. Obtain separate explicit approval before production secrets/function deployment. No frontend rebuild is necessary.
8. Roll back by disabling this function or gateway service, leaving existing data and email services untouched.

## Verification scope

Automated tests use mocked Groq completions, actual loopback HTTP and the real unchanged academic engine. They cover English/Arabic evidence and citations, provider parameter isolation, invalid outputs, truncated/oversized responses, authentication, concurrency, persistent quotas, provider 429, bad keys, timeouts and outages. All eight original academic tools retain their synthetic engine tests. No live model accuracy or deployed Deno runtime is claimed until those pilots run. Prompt instructions and presence checks cannot guarantee factual correctness; review model statements against the displayed deterministic evidence before production activation.
