# P1 Vietnamese prose baseline: protocol and harness operation

**Status:** P1 part 1, harness implementation submitted for Muse review. **No real-provider execution has been completed in this environment.** This document records the test protocol; literary rubric and numerical pass/fail thresholds are for Nguyen to approve at the P1 D10 gate, not for the harness author to choose after viewing results.

## 1. Scope and invariants

The executable harness is `scripts/quality-evals/reader-vietnamese-baseline.mjs`. It evaluates **20 consecutive linked Vietnamese prose turns** in a fixed Backrooms Level 0 scenario featuring Cao Minh. Every new prompt includes the **exact text and SHA256** of *all prior completed turns*. No choice generation, reader tables, chapter editor, Canon adoption, or fabricated NPC names as known Canon. No forced ending.

Scenario ID: `evobr-p1-cao-minh-level0-v1`. Fixed setting: Cao Minh awakens alone in yellow rooms with fluorescent hum and damp carpet, without a map or companions. The prompt permits subjective perceptions but forbids the model from asserting unsupported Backrooms Canon. Scenario, fixed system prompt and prior-turn history form a deterministic test *input*; stochastic model text is not predetermined.

The harness calls the **actual imported StoryForge `src/lib/ai/client.ts::chat` function through Vite in a fresh Playwright Chromium browser context**. It does not use a self-written OpenAI HTTP client, a fake transport, mock replies or a second backend. This P1-only offline harness does **not** claim a registered reader formal AI entry exists yet. Reader formal Skill/entry wiring remains P4, as agreed in P0.5. The client category is `reader.prose.baseline`, intentionally not registered for any reader mutation.

No source file under `src/` is changed by the harness. The language guard for chapter authoring remains Simplified Chinese. The evaluation prompt is explicitly Vietnamese and isolated from that guard. No IndexedDB reader table is opened or written by the harness. The browser's normal model-usage logging may use existing app telemetry/local storage, but it does not confer any adoption authority.

## 2. Running with a real provider

Prerequisites from `AGENTS.md`: **Node.js 24**, `npm ci`, Playwright Chromium installed and a real OpenAI-compatible provider reachable by the **browser** (including CORS). Start from repo root; this harness starts and stops a local Vite server automatically.

Required environment variables (set in the operator's terminal/runner, **not** committed to Git):

- `EVO_P1_PROVIDER`: existing `AIProvider` value such as `custom` or `gemini`, appropriate to the actual endpoint.
- `EVO_P1_MODEL`: configured real model ID.
- `EVO_P1_BASE_URL`: real OpenAI-compatible base URL, not `/chat/completions` path.
- `EVO_P1_API_KEY`: real API credential. For a deliberately authless local Ollama service only, `EVO_P1_PROVIDER=ollama` and `EVO_P1_ALLOW_EMPTY_KEY=1` permit an empty key.

Optional environment:

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

The harness refuses to run when provider details are missing, Node is unsupported, Vite cannot start, Chromium is unavailable or the real client cannot complete a turn. There is **no mock fallback**. On interruption it writes a partial report marked `blocked` or `failed`, not `completed`. Rerunning starts a new measured run and does not silently reuse a possibly billed attempt.

## 3. Output schema and measurements

Each run generates a local `baseline-<uuid>.json` report, including:

- Run ID, scenario ID/hash, prompt version, provider/model, hashed base URL, client transport kind, start/update time and status.
- For each of 20 linked turns: prior history length/hash, full generated prose and its hash, exact attempt count, measured wall-clock milliseconds, observed actual token input/output when returned by provider, finish reason, sanitized error class/status, retry counts and transport lifecycle.
- Aggregate successful/failed calls, error distribution, total input/output tokens when complete provider usage is available, **p50/p95 latency** across successful calls, total estimated USD using supplied prices, and missing-data status.
- A missing provider `usage` field is recorded as `null`, never copied from a tokenizer estimate and mislabeled as measured usage. Cost is `null` when usage or price is missing. If an error occurs, subsequent turns do not run; this is a partial baseline rather than an invented 20-turn success.

The report contains model output and scenario text, but **no API key, Authorization header or raw provider response body**. Keep reports outside tracked source and distribute only reviewed/appropriately redacted evaluation artifacts.

**Known limitations:** Browser CORS must permit the real client transport; an incompatible provider or missing account configuration is a *real blocked result*, not permission to use mocks. This harness benchmarks prose-only baseline calls. It does not measure the complete P4 six-call V3-plus-choices pipeline. If a separate genuine V3 smoke run is attempted in P1 part 2, it must have recorded real callbacks/evidence and be reported distinctly; otherwise mark V3 smoke as **not executed**.

## 4. Blind-review handoff to P1 part 3

The existing questionnaire `scripts/quality-evals/longform-choice-questionnaire.mjs` defines six axes: `immersion`, `causality`, `payoff`, `voice`, `pace`, `continuity`. It expects paired samples (`baseline` and `improved`) and emits participant-specific randomized A/B packs with the organizer mapping kept separately. **Do not falsely label one generated baseline as an A/B study.** A subsequent independent comparison must supply a genuine second version; otherwise create a versioned blind single-arm review pack using the same six-axis scoring semantics and neutral identifiers, explicitly documenting that it is not A/B.

The final D10 package must contain a proposed six-axis rubric, pass/fail thresholds, critical Canon-error criterion and token/latency/cost ceilings. **Nguyen must sign thresholds before formal review scores are revealed and used for acceptance**. P1 part 1 does not decide those values. Human ratings are not automatically inferred from model output.

## 5. Verification for this part

On the P1 branch, verify the new script and this document, ensure neither changes `src/lib/ai/adapters/prompt-guards.ts` or editor logic, and check that PR's base is the P0-merged `feat/import-storyforge-longform`. Where Node24/npm or real provider are absent, report that limitation rather than asserting a 20-turn run or green CI.
