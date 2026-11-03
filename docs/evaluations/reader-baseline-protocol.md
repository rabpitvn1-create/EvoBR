# P1 Vietnamese prose baseline: protocol and harness operation

> **Post-run status, 2026-11-03:** Muse subsequently ran all four profiles (80 real requests) using the repository client, a local path-only relay and Nguyen's premium proxy, and completed the blind D10 review. The results and Vite transport fixes are documented in [reader-baseline-conclusion.md](./reader-baseline-conclusion.md). References below to **0/20**, missing model data or blocked execution describe the **assistant's earlier environment only**, not the final Muse-run outcome. The published benchmark records 0/80 request errors, 0 retries, and `restrained_intimate` as the winner. Cost remains unknown; do not overwrite historical environment evidence.

**Status:** P1 baseline harness has passed Muse's part-1 review; subsequent Codex opt-in and four-voice tournament additions await review. **No real-provider execution has been completed in this environment.** Nguyen delegated the D10 literary decision to Muse on 2026-11-03. The fixed literary thresholds are recorded in [reader-d10-approval-draft.md](./reader-d10-approval-draft.md) before outcomes; Muse preregisters them before rating. Operational token/latency/cost limits are determined by Muse only from real measurements.

## 1. Scope and invariants

The executable harness is `scripts/quality-evals/reader-vietnamese-baseline.mjs`. It evaluates **20 consecutive linked Vietnamese prose turns** in a fixed Backrooms Level 0 scenario featuring Cao Minh. Every new prompt includes the **exact text and SHA256** of *all prior completed turns*. No choice generation, reader tables, chapter editor, Canon adoption, or fabricated NPC names as known Canon. No forced ending.

Scenario ID: `evobr-p1-cao-minh-level0-v1`. Fixed setting: Cao Minh awakens alone in yellow rooms with fluorescent hum and damp carpet, without a map or companions. The prompt permits subjective perceptions but forbids the model from asserting unsupported Backrooms Canon. Scenario, fixed system prompt and prior-turn history form a deterministic test *input*; stochastic model text is not predetermined.

The single-run harness supports a versioned optional `EVO_P1_VOICE_PROFILE` from `scripts/quality-evals/reader-voice-profiles.mjs`. Four defined profiles change **only the system-prompt style directive**, not Cao Minh's scenario, prior-turn inclusion, Canon constraints or model settings. The four-run orchestration is `scripts/quality-evals/reader-voice-tournament.mjs generate`, which produces four independent, 20-turn histories and rejects mixed provider/model configs. No profile results exist yet.

The harness calls the **actual imported StoryForge `src/lib/ai/client.ts::chat` function through Vite in a fresh Playwright Chromium browser context**. It does not use a self-written OpenAI HTTP client, a fake transport, mock replies or a second backend. This P1-only offline harness does **not** claim a registered reader formal AI entry exists yet. Reader formal Skill/entry wiring remains P4, as agreed in P0.5. The client category is `reader.prose.baseline`, intentionally not registered for any reader mutation.

No source file under `src/` is changed by the harness. The language guard for chapter authoring remains Simplified Chinese. The evaluation prompt is explicitly Vietnamese and isolated from that guard. No IndexedDB reader table is opened or written by the harness. The browser's normal model-usage logging may use existing app telemetry/local storage, but it does not confer any adoption authority.

## 2. Running with a real provider

Prerequisites from `AGENTS.md`: **Node.js 24**, `npm ci`, Playwright Chromium installed and a real OpenAI-compatible provider reachable by the **browser** (including CORS). Start from repo root; this harness starts and stops a local Vite server automatically.

Required environment variables (set in the operator's terminal/runner, **not** committed to Git):

- `EVO_P1_PROVIDER`: existing `AIProvider` value such as `custom`, `gemini` or `codex`. `codex` is the repo's authenticated local bridge, **not** an OpenAI-compatible HTTP endpoint.
- `EVO_P1_MODEL`: configured real model ID.
- `EVO_P1_BASE_URL`: real OpenAI-compatible base URL, not `/chat/completions` path; **not required for the explicitly opted-in `codex` route** because `src/lib/ai/client.ts` dispatches via `/storyforge/local-codex/v1`. The harness uses an ignored local placeholder in `AIConfig` for that route.
- `EVO_P1_API_KEY`: real API credential. For a deliberately authless local Ollama service, `EVO_P1_PROVIDER=ollama` and `EVO_P1_ALLOW_EMPTY_KEY=1` permit an empty key. **Codex route requires `EVO_P1_ALLOW_CODEX_LOGIN=1` explicitly and uses the authenticated Codex CLI session instead of an external key.** It preflights the actual bridge `/status` and `/models`, requiring `ready` and the requested model ID.

Optional environment:

- `EVO_P1_VOICE_PROFILE` selects one fixed style profile (`cinematic_minimal`, `sensory_urgent`, `psychological_slow`, `restrained_intimate`). The tournament sets it automatically; single-run mode may omit it for the original neutral baseline.
- `EVO_P1_TEMPERATURE` defaults to `0.8`.
- `EVO_P1_MAX_TOKENS` defaults to `1400`.
- `EVO_P1_CONTEXT_WINDOW` defaults to `65536`. It is an operator-declared limit, **not a provider capability verified by this document**. The client rejects prompts that cannot fit rather than silently trimming prior turns.
- `EVO_P1_MAX_RETRIES` defaults to `0` for unbiased baseline observations. An operator may opt in to a finite number of retries for explicit HTTP 429/503 responses. Unknown/dispatched-without-response errors are never automatically retried.
- `EVO_P1_INPUT_USD_PER_M` and `EVO_P1_OUTPUT_USD_PER_M`: **both** real operator-sourced USD prices per million tokens. Omission leaves estimated cost `null`; do not report it as zero.
- `EVO_P1_VITE_PORT` defaults to `41973`; operator may override if occupied.

Example invocation once all environment variables above have been securely configured:

```bash
node scripts/quality-evals/reader-vietnamese-baseline.mjs ./p1-results
```

The harness refuses to run when provider details are missing, Node is unsupported, Vite cannot start, Chromium is unavailable or the real client cannot complete a turn. The Codex route additionally fails when CLI is absent, the app-server login is not ready, the login isolation/version requirement is unmet, or the authenticated `/models` catalog excludes the requested model. There is **no mock fallback**. On interruption it writes a partial report marked `blocked` or `failed`, not `completed`. Rerunning starts a new measured run and does not silently reuse a possibly billed attempt.

## 3. Output schema and measurements

Each run generates a local `baseline-<uuid>.json` report, including:

- Run ID, scenario ID/hash, prompt version, provider/model, hashed base URL, client transport kind, start/update time and status.
- For each of 20 linked turns: prior history length/hash, full generated prose and its hash, exact attempt count, measured wall-clock milliseconds, observed actual token input/output when returned by provider, finish reason, sanitized error class/status, retry counts and transport lifecycle.
- Aggregate successful/failed calls, error distribution, total input/output tokens when complete provider usage is available, **p50/p95 latency** across successful calls, total estimated USD using supplied prices, and missing-data status.
- A missing provider `usage` field is recorded as `null`, never copied from a tokenizer estimate and mislabeled as measured usage. Cost is `null` when usage or price is missing. If an error occurs, subsequent turns do not run; this is a partial baseline rather than an invented 20-turn success.

The report contains model output and scenario text, but **no API key, Authorization header or raw provider response body**. Keep reports outside tracked source and distribute only reviewed/appropriately redacted evaluation artifacts.

**Known limitations:** Browser CORS must permit the ordinary HTTP model client transport; Codex uses the repo's loopback same-origin bridge and a local authenticated CLI rather than browser-to-provider CORS. an incompatible provider or missing account configuration is a *real blocked result*, not permission to use mocks. This harness benchmarks prose-only baseline calls. It does not measure the complete P4 six-call V3-plus-choices pipeline. If a separate genuine V3 smoke run is attempted in P1 part 2, it must have recorded real callbacks/evidence and be reported distinctly; otherwise mark V3 smoke as **not executed**.

## 4. Muse-led four-voice selection and fixed D10 preregistration

The upstream `scripts/quality-evals/longform-choice-questionnaire.mjs` defines six axes: `immersion`, `causality`, `payoff`, `voice`, `pace`, `continuity`. It assumes a genuine A/B pair and is **not** repurposed to claim fake comparative trials. `reader-blind-review.mjs` remains a single-arm tool. For the four-voice experiment the orchestrator uses the same six scoring dimensions and creates **four independent neutral blind packets** through `reader-voice-tournament.mjs pack`. Each packet contains a complete 20-turn history and no profile/provider labels; only the organizer retains the shuffled identity map.

Muse now owns D10 literary adjudication. Nguyen's fixed pre-result thresholds: **overall mean ≥ 4.0/5 across 20 turns × six axes; every axis ≥ 3.5; voice ≥ 4.0; zero confirmed severe Canon errors; winner highest overall, voice breaks a tie; no qualifying profile means a new round, never weaker limits.** Muse must preregister the rubric before seeing scores. Full canonical incident categories, rating anchors and detailed procedure are in [reader-d10-approval-draft.md](./reader-d10-approval-draft.md). Operational token/latency/cost ceilings are separate and must derive from real P1.2 metrics, not the previous unapproved numerical draft.

Run commands after all four real series are complete:

```bash
node scripts/quality-evals/reader-voice-tournament.mjs generate ./p1-voice-results
node scripts/quality-evals/reader-voice-tournament.mjs pack ./p1-voice-results ./p1-voice-blind Muse
```

Muse gets `participants/` only, never `organizer-key.json` before all reviews and Canon audits are sealed. Rank afterwards with `reader-voice-tournament.mjs rank` and preserve the scores and metrics of *all four* profiles, including losers. No mocked or partial report is accepted for blind selection.

## 5. Verification for this part

On the P1 branch, verify the new script and this document, ensure neither changes `src/lib/ai/adapters/prompt-guards.ts` or editor logic, and check that PR's base is the P0-merged `feat/import-storyforge-longform`. Where Node24/npm or real provider are absent, report that limitation rather than asserting a 20-turn run or green CI.


## 6. P1 part 2 environment evidence, 2026-11-03

This section records **execution environment availability**, not model benchmark outcomes:

- Container Node is `v22.16.0` at `/opt/nvm/versions/node/v22.16.0/bin/node`. Only Node 22 was present under `/opt/nvm/versions/node/`; the Node 24 requirement from AGENTS.md is not met. No cached Node 24 tarball was found under the installed nvm cache.
- `command -v codex` returned no executable. No local authenticated Codex CLI was available in this container. The bridge's `scripts/local-codex/runtime.mjs` invokes the `codex app-server` executable and consumes its **existing CLI login**; without that executable it cannot report a real authenticated model call.
- `git ls-remote https://github.com/rabpitvn1-create/EvoBR.git HEAD` failed with `Could not resolve host: github.com`; normal Git and package installation through public network were unavailable in the current container. GitHub connector access was sufficient to read, patch, commit and open the PR, but cannot provide this local CLI's authenticated process.
- Neither `EVO_P1_PROVIDER` nor `EVO_P1_MODEL`, `EVO_P1_BASE_URL`, `EVO_P1_API_KEY` was present. No model usage report exists. **20 real turns = 0/20 executed; V3 provider smoke = not executed; latency, token usage and cost = not measured.**
- Codex opt-in support was added in P1 part 2 for an appropriate external runner. This change by itself does **not** make an authenticated provider available in this environment.

To execute on a suitable machine, install Node 24/dependencies and authenticated Codex CLI, choose a model listed by the bridge, then set `EVO_P1_PROVIDER=codex`, `EVO_P1_MODEL=<verified model ID>` and `EVO_P1_ALLOW_CODEX_LOGIN=1`. Alternatively provide a real HTTP-compatible provider config through the operator's environment. In both cases the harness stays on StoryForge's `chat()` transport and never substitutes mock output.
