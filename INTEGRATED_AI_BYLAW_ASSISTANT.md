# Ask the Bylaw / اسأل اللائحة

For the hosted Groq adapter, private configuration, local testing and later deployment, see [inference/GROQ_SETUP.md](inference/GROQ_SETUP.md). The original self-hosted model option below remains available.

Implementation date: 15 November 2026. Local feature branch: `feature/integrated-ai-bylaw-assistant`.

The owner has now authorized publishing the website replacement. This release publishes the frontend and supporting source only. It does not deploy an inference service or Edge Function, purchase hosting, apply SQL, change accounts, or modify production records. Model activation still requires hosting and configuration. Do not run a database reset or push the existing migration directory for this feature.

## Architecture

```text
Signed-in website
  -> bylaw-assistant Edge Function: validate Supabase Auth JWT and existing profile role
  -> private HTTPS gateway: persistent per-user/global quotas and concurrency bound
  -> privately hosted Qwen3-8B through an OpenAI-compatible chat-completions endpoint
  <- allowlisted tool requests
Browser executes the EXISTING academic tools locally
  -> same authenticated path with filtered academic evidence
  <- explanation, displayed alongside deterministic evidence and bylaw articles
```

The Edge Function is an HTTP/authentication proxy, not a model host. Supabase currently documents 256 MB memory and 2 seconds of CPU per Edge request; Free workers have a 150-second wall-clock limit. These resources do not host an 8B language model. [Official Edge limits](https://supabase.com/docs/guides/functions/limits).

The existing academic engine remains authoritative. This change does not repair or change its curricula, GPA formulas, eligibility calculations, exceptions or approval logic. Known academic limitations identified in the earlier review remain; test and approve the engine separately before treating outputs as official university decisions.

### Files

| File | Purpose |
|---|---|
| `bylaw-assistant.js` | Bounded tool orchestration, authenticated fetch, privacy filtering, evidence labels |
| `supabase/functions/_shared/bylaw-protocol.js` | Shared fixed tool schemas, input limits, output allowlist, identifier filtering, bilingual errors |
| `supabase/functions/bylaw-assistant/index.ts` | Actual Auth/profile verification and HTTPS gateway transport |
| `supabase/functions/bylaw-assistant/handler.mjs` | Testable request handler, server-owned instructions and completion validation |
| `inference/gateway.mjs` | Dependency-free Node 24+ gateway with SQLite quotas and configurable model endpoint |
| `inference/*.example` | Secret-free configuration, TLS proxy and service examples |
| `index.html` | Integrated chat; existing tool implementations reused unchanged |
| `tests/bylaw-*.test.mjs` | Protocol, tool, privacy, actual Edge entry, real engine and local gateway tests |

No SQL migrations are required. Existing roster, assignment, approval and Brevo tables/functions are untouched. The new function reads only the caller's `advisor_profiles.role` under existing RLS. It does not require a service-role key.

## Model investigation and recommendation

Start with **Qwen3-8B**, preferably the official Q4_K_M GGUF on university-owned hardware. Qwen publishes the weights under Apache 2.0; Qwen3 supports Arabic among its multilingual coverage, function calling and a non-thinking mode. Suitability for Benha's Arabic academic terminology must still be evaluated on real questions. No model was downloaded or benchmarked during implementation. [Qwen3 announcement](https://qwenlm.github.io/blog/qwen3/), [Qwen3-8B model card](https://huggingface.co/Qwen/Qwen3-8B), [official GGUF distribution](https://huggingface.co/Qwen/Qwen3-8B-GGUF).

Use llama.cpp's OpenAI-compatible `/v1/chat/completions` interface with a tool-capable Jinja template. This is a protocol name; it does not require OpenAI or a paid API. The gateway can use another compatible local server or model by changing `INFERENCE_URL` and `INFERENCE_MODEL`. Smaller Qwen3 variants are possible if hardware is constrained, but need the same Arabic/tool-use acceptance tests. [llama.cpp server and function-calling documentation](https://github.com/ggml-org/llama.cpp/tree/master/tools/server).

The gateway sends `chat_template_kwargs: {enable_thinking:false}`, bounds generation to 1,200 tokens, and removes any `<think>` block returned in ordinary content. It does not display hidden reasoning. Pin the chosen llama.cpp release/build and model revision/checksum in the deployment inventory after a successful pilot; no untested binary version is claimed as validated here.

### Estimated resource budget, not a vendor quote

| Deployment | Planning estimate | Cost implications |
|---|---|---|
| Existing CPU workstation | 16–32 GB RAM, approximately 10–15 GB free disk including model/runtime; low concurrency | No external per-token fee. May exceed the 50-second inference timeout; benchmark before activation. |
| Existing GPU workstation, recommended pilot | Approximately 12–16 GB VRAM, 16–32 GB system RAM; Q4 weights plus KV cache/context overhead | No external API fee. Electricity, maintenance and institutional hosting remain. |
| BF16/unquantized 8B | Approximately 16.4 GB for weights alone; allow more for KV cache and runtime | Larger GPU needed; quantized hosting is usually more practical for a pilot. |
| Rented GPU | Depends on GPU, region, uptime and traffic | **Not authorized or provisioned.** Obtain an explicit price and approval first. |

These are engineering estimates, not measured requirements or performance guarantees. Context size and parallel slots can materially increase VRAM. The initial concurrency is two model calls. There is no claim of supporting 7,000 simultaneous students.

Cost calculation: monthly electricity = average kW × operating hours × local tariff. For an illustrative 0.25 kW machine running 8 hours/day for 30 days, consumption is 60 kWh; multiply by the actual tariff. Continuous operation at that assumed draw is 180 kWh/month. Hosted-GPU cost is quoted hourly rate × hours plus storage/network; do not assume free hosting. Each question takes 1–4 inference/Edge calls, usually two. Monitor Supabase's existing quota separately; no plan upgrade has been made.

## Security and privacy boundaries

- Students, advisors and administrators use their existing Supabase accounts. The new function calls Auth `/user`, requires a confirmed non-anonymous account and reads the actual database role. Browser-supplied roles are never trusted.
- The browser has no provider secret. Edge-to-gateway authentication uses a separate random secret. Optional inference-provider credentials exist only on the inference host.
- Full transcripts, attempts, national IDs, account email and roster data are never automatically included in model requests. Aggregate GPA/hours and results from requested tools can be included; these are still sensitive academic information.
- Known account/transcript identifiers and full student name are removed from question text locally. Email addresses, long numbers including Arabic/Persian digit forms, and URLs are filtered again at the server boundary. This is not universal PII detection: users must not type other people's names, addresses or obfuscated identifiers. The interface explains this before sending.
- Only the last two sanitized user questions are retained as follow-up context. Prior model answers are not reused as evidence. Chat is held in page memory, not stored in Supabase or localStorage. Logout cancels and clears it. Changed program/transcript/term assumptions invalidate an in-flight answer.
- Gateway quotas use an HMAC pseudonym of the Auth user ID. The pseudonym goes only to the gateway; it is stripped before inference. SQLite contains quota counters, not messages, emails, transcripts or grades. Old windows are pruned during subsequent traffic; arrange deletion of the quota file when decommissioning the service.
- Fixed tools are read-only. There is no SQL, browsing, arbitrary function execution, account modification, roster operation, approval or email tool. Arguments are schema-validated before execution. Documents/messages/evidence are explicitly untrusted data in a server-owned system instruction.
- Prompt injection and model hallucination cannot be eliminated by instructions. Answers without successful academic evidence are replaced with a clarification; actual engine evidence and article references are displayed separately. The existing decimal-number warning remains an additional heuristic, not a proof of correctness.
- Browser tool evidence is not a signed university record and may be manipulated by its user. This endpoint is decision support, never an authorization or SIS-validation service. It cannot approve a plan.
- The application, gateway and Edge code do not log prompts or credentials. Configure the TLS proxy and model runtime accordingly; do not enable prompt logging, and review any vendor retention policy before approving remote inference.

### Enforced limits

| Limit | Default |
|---|---:|
| Question | 1,200 characters |
| Edge request body | 48,000 bytes |
| Tool rounds | 3, then one final explanation call |
| Calls per round / total tool results | 4 / 12 |
| Hypothetical grades | 12 courses |
| Model output | 1,200 tokens; upstream response capped at 64 KB |
| Gateway concurrency | 2 |
| Per-user model calls | 12/minute and 80/day |
| All-user model calls | 240/day |
| Model / Edge relay / browser timeout | 50 / 55 / 65 seconds per call |

Minute/day quotas use UTC epoch windows. Failed upstream calls still consume quota. Limits count **model calls**, not questions. SQLite quotas are persistent and transactional for processes sharing the same local file. Use one gateway/model host initially; do not place independent SQLite files behind a load balancer and assume a shared global limit. Per-process concurrency applies; use one gateway process. Storage failure fails closed. Restarting the service preserves quotas if the same file is used; rotating the gateway secret changes per-user pseudonyms but does not reset the global counter.

## Activation procedure — future actions requiring authorization

### 1. Select and prepare an approved inference host

Choose existing university equipment first. Obtain approval before spending money. Install Node 24+ (built-in `node:sqlite` required), an approved llama.cpp build, and a TLS reverse proxy such as Caddy. Provision a dedicated unprivileged `bylaw` service user, `/opt/bylaw` for code, `/etc/bylaw` for secrets, and `/var/lib/bylaw` for private quota state. Do not put secrets or model weights in the GitHub Pages repository.

Download the official Qwen3-8B Q4_K_M GGUF to a private model directory; record the exact revision/checksum. Inspect the installed executable's `--help` before using the following example because llama.cpp CLI names/flags can evolve:

```sh
llama-server --help
llama-server -m /srv/models/Qwen3-8B-Q4_K_M.gguf \
  --alias Qwen3-8B --host 127.0.0.1 --port 8080 \
  --jinja --ctx-size 32768 --parallel 2 --n-gpu-layers 99
```

Some distributions expose the equivalent server as `llama serve`. Use that build's documented equivalent. The example's total context is split across two slots; confirm effective per-slot context and memory with the chosen build. Reduce GPU layers for partial offload or use CPU mode only after measuring latency. Never expose port 8080 publicly. Test that the server returns structured `message.tool_calls`, not a text imitation of a function call.

### 2. Configure and start the gateway

Copy `inference/gateway.mjs` to `/opt/bylaw/inference/gateway.mjs`. Copy the example environment file to `/etc/bylaw/gateway.env`, readable only by the service account/administrator. Generate a random secret of at least 32 characters using your approved password manager. Set:

```text
GATEWAY_SECRET=<random shared gateway secret>
INFERENCE_URL=http://127.0.0.1:8080/v1/chat/completions
INFERENCE_MODEL=Qwen3-8B
INFERENCE_API_KEY=<optional local inference authentication token>
ALLOW_REMOTE_INFERENCE=false
QUOTA_DB=/var/lib/bylaw/quota.sqlite
PORT=8787
MAX_CONCURRENT=2
USER_CALLS_PER_MINUTE=12
USER_CALLS_PER_DAY=80
GLOBAL_CALLS_PER_DAY=240
```

Use `inference/bylaw-gateway.service.example` as the systemd template, adjusting the Node binary path. For a supervised manual start:

```sh
node --env-file=/etc/bylaw/gateway.env /opt/bylaw/inference/gateway.mjs
```

Do not use `:memory:` for production quotas. Gateway startup defaults to loopback. Remote inference is rejected unless `ALLOW_REMOTE_INFERENCE=true`; enabling it is a separate operational/provider decision and does not constitute permission to use a paid API.

### 3. Publish only the private gateway endpoint over TLS

Use a university-controlled DNS name and `inference/Caddyfile.example`. Expose HTTPS port 443; keep 8787 and 8080 on loopback. The public `/infer` route rejects callers without the gateway secret. Configure platform/network abuse protections and no request-body/authorization logging. Confirm that an unauthenticated POST receives 401.

### 4. Configure the new Supabase function in staging first

Use an approved staging project with the existing profile schema/RLS. The application expects existing confirmed profiles; do not recreate production accounts or copy real rosters for testing.

In Supabase Edge Function secrets, add only:

```text
BYLAW_GATEWAY_URL=https://bylaw-model.example.edu/infer
BYLAW_GATEWAY_SECRET=<same gateway secret>
BYLAW_ALLOWED_ORIGINS=https://your-approved-staging-site.example
```

The existing platform `SUPABASE_URL`, publishable-key bundle or legacy anon key are used for caller verification. No service-role key needs to be added. Origins must match exactly, with scheme and port and without trailing slashes. The production GitHub Pages origin is already included. HTTPS is required for Edge-to-gateway transport.

After explicit deployment approval, inspect your installed Supabase CLI help and deploy **only** this function:

```sh
supabase functions deploy --help
supabase functions deploy bylaw-assistant --project-ref <approved-staging-project-ref>
```

`supabase/config.toml` sets `verify_jwt=false` for this function because the handler validates the JWT itself with Auth, as the existing email functions do. This is not anonymous access. Deploy through the CLI so the shared JavaScript modules are bundled together; pasting only `index.ts` into the editor is insufficient.

**Do not run `supabase db push`, reset the database, redeploy Brevo functions or reapply existing migrations.** This feature has no database migration.

### 5. Stage the frontend and run acceptance tests

Publish these together to the approved staging frontend:

- Updated `index.html`.
- `bylaw-assistant.js`.
- `supabase/functions/_shared/bylaw-protocol.js` at that exact public path.
- All existing application assets.

Use the staging Supabase public configuration in that staging deployment. No additional public AI configuration is necessary. Do not publish the inference host's environment or database files. The shared protocol file is intentionally public and contains no secret.

Test with approved synthetic/consenting accounts:

1. English and Arabic questions: summer limits, CS142 prerequisites, current GPA, hypothetical grades, suggested plan and graduation progress.
2. Confirm tool evidence and actual bylaw articles match the selected program and transcript. Test regular and special programs, especially IMI's caveats.
3. No transcript: request upload for personal answers; general `lookup_rule` remains available. No program: prompt for program selection.
4. Change program/transcript while waiting; verify the old answer is discarded. Stop/close the chat and log out; verify cancellation and chat clearing.
5. Inspect requests using synthetic identifiers: no raw transcript, national ID, personal contact details or roster data. Confirm no Supabase JWT is forwarded to inference.
6. Unauthenticated, unconfirmed and non-permitted accounts must fail. Verify minute/day/global quota and busy-server messages.
7. Stop the model/gateway and verify helpful unavailable messages; ordinary advising, matching, approval and Brevo workflows must remain usable.
8. Test malicious text, fabricated articles and unsupported topics. Human-review Arabic terminology and factual grounding; automated tests use mocked completions and do not establish model quality.
9. Measure per-call latency, context overflow, VRAM and concurrent load before raising quotas. Check existing Supabase request quotas.

### 6. Production activation only after explicit approval

After the pilot is accepted, obtain permission for the production secrets/function deployment and website release. Then configure the same three secrets for the approved production project, deploy only `bylaw-assistant`, and publish the reviewed feature assets through the normal release process. **The frontend release has now been authorized; publishing source does not configure a model or deploy the Edge Function.** Existing accounts and the approved 110-student roster require no migration or update.

Rollback: remove/disable the new function or its gateway secret to stop inference, or revert only the frontend feature release. Keep all existing academic data and services intact. Remove the gateway's quota state separately when the inference service is decommissioned.

## Validation and remaining work

Run dependency-free tests with Node 24+:

```sh
node --test tests/*.test.mjs
```

Tests include Arabic/English orchestration, existing-role authentication, the real Edge entry against mocked Auth responses, all eight requested tools against the real academic engine, PII filtering, unsupported tools, input limits, missing evidence, cancellation, safe failures, persistent quotas and a real loopback HTTP gateway with mocked inference. Existing inbox and roster tests remain included.

Latest result: **49 passed, 0 failed** (21 existing tests and 28 new tests). UI tests execute the actual chat functions with DOM stubs, including HTML escaping, Arabic errors, English questions in an Arabic interface, and clearing an in-flight session. These are not a visual browser test. The full existing `AGENT_TOOLS` implementation was also compared against HEAD and is unchanged. `git diff --check` passed.

Implemented: frontend/backend protocol, bilingual chat, existing academic tools, evidence rendering, authentication, quota gateway and deployment examples.

Requires configuration/validation: an approved inference host, actual model weights/runtime, DNS/TLS, gateway secrets, deployment of the new function and frontend, real-model Arabic/English evaluation and an authenticated staging browser pilot. No production records or model-generated live responses were used to validate this implementation. Deno/Supabase local runtime is not installed in the current workspace; Node tests exercise the entry/handler with runtime mocks, not a deployed Edge isolate.
