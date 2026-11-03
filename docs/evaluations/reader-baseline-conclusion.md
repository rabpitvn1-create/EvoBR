# P1 Vietnamese Prose Baseline: conclusion and Muse voice-selection verdict

**Status:** P1 real-provider literary selection completed and reported by Muse on 2026-11-03. This document records **Muse's reported real execution and sealed blind assessment**. The assistant did not independently run the 80 provider requests or receive/verify the underlying per-turn reports, score files or organizer mapping. Do not confuse this provenance with mocked measurements or independent reproduction.

## 1. Reproducible experiment and transport disclosure

- Scenario: fixed `evobr-p1-cao-minh-level0-v1`, featuring Cao Minh in Backrooms Level 0.
- Four versioned system-prompt voice profiles from `scripts/quality-evals/reader-voice-profiles.mjs`. Each profile generated **20 consecutive Vietnamese prose turns**, with each following turn receiving prior published text. **4 × 20 = 80 real provider calls** in the reported run.
- Provider-reported model: `gemini-3.8-flash`. The spelling is taken from the provider's own response body, as reported by Muse, not independently inferred from the proxy or model configuration.
- Generation parameters: `temperature: 0.8`, `maxTokens: 1400`.
- Transport, in order: **repository's genuine `src/lib/ai/client.ts::chat` inside Chromium → local path-only relay → Nguyen's existing premium proxy (`POST /chat`) → real provider**. The premium proxy supplies model/credentials server-side. Muse reports the relay only changes the route, the request/response body is unchanged, and token usage comes from the provider's `usage` field.
- There was no API key in Muse's client configuration. Neither a proxy key, relay address nor organizer secret is committed here. This is a **transparent real-provider route**, not a pretend direct provider call and not a mock.
- The premium proxy has a reported **55-second timeout**. This is a relevant potential source of request failure for future D2 design, but **was not observed as an error in this 80-call run**.
- The four source voice directives, and the exact winning prompt, are versioned in `reader-voice-profiles.mjs`. The sealed selection-result artifact (including actual computed prompt hashes) remains with the organizer; **no unprovided hash is fabricated or copied into this conclusion**.

### Two harness-specific Vite corrections

Muse's first real run found two dev-server transport mismatches, fixed in the tracked P1 harness:

1. `/__vite_ping` returned HTTP **404** under the repo's locked Vite version. Both the startup readiness probe and initial `page.goto` now use `/`, the real serving route. Lengthening timeouts was not used as a workaround.
2. The application Vite configuration uses `base: '/storyforge/'`, whereas the harness dynamically imports `/src/lib/ai/client.ts`. The harness's **own** Vite subprocess now passes `--base /`; the application's `vite.config`, editor, runtime and Chinese chapter guard remain unchanged.

These fixes affect local dev-server routing only, not sampling, request payload, model usage tracking or the underlying StoryForge model client.

## 2. Measured aggregate distribution, as reported by Muse

| Metric | Observed |
| --- | ---: |
| Real linked prose turns | **80/80** |
| Actual model calls | **80** |
| Request errors | **0** |
| Retries | **0** |
| Input tokens, provider usage | **451,347** |
| Output tokens, provider usage | **38,489** |
| Total measured input + output | **489,836** |
| Per-call latency p50 | **6,410 ms** |
| Per-call latency p95 | **9,983 ms** |
| Estimated USD cost | **null**: no supported token price was supplied |

The aggregate p50/p95 are per-call timings across **all 80 real requests**, not a separately observed per-profile distribution. **Per-profile token/latency/cost breakdowns were not supplied in this handoff; do not invent them.** The reported win/loss scores are literary scores, not model performance metrics.

These metrics cover **prose-only P1 generation**. They do **not** establish the future P4 six-call pipeline's latency, token usage, retry budget, total price or V3 correctness.

## 3. Pre-registered Muse literary gates and sealed blind results

The fixed rules preceding evaluation were: mean across all six axes and 20 turns **≥ 4.0/5**; every axis mean **≥ 3.5/5**; mean `voice` **≥ 4.0/5**; **zero confirmed severe Canon incidents** (invented named Canon, contradiction of published history, forced ending). Winner is the highest eligible overall mean; an exact overall tie is broken by voice.

Muse reports independent blind scoring of all **80 turns** and complete Canon review of all four chains before opening the organizer key.

| Voice profile | Overall | Immersion | Causality | Payoff | Voice | Pace | Continuity | Verdict |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| **`restrained_intimate`** | **4.458** | 4.65 | 4.35 | 4.20 | 4.65 | 3.90 | 5.00 | **PASS, WINNER** |
| `psychological_slow` | 4.342 | 4.25 | 4.65 | 4.30 | 4.25 | 3.60 | 5.00 | PASS |
| `cinematic_minimal` | 4.358 | 4.70 | 4.15 | 3.95 | **4.95** | **3.40** | 5.00 | **FAIL: pace < 3.50** |
| `sensory_urgent` | 4.333 | 4.45 | 4.15 | 4.30 | 4.00 | 4.10 | 5.00 | PASS |

**Canon audit:** Muse reviewed 4/4 full narratives. **0 confirmed** serious incidents and **0 unresolved** incidents were reported.

### Why the highest-voice profile does not win

`cinematic_minimal` scored the highest **voice** (4.95/5), but its **pace = 3.40/5**, below the previously locked minimum 3.50. It is **ineligible despite** an overall 4.358 and excellent voice score. The floor was **not lowered after viewing ratings**. For commercially serialized long-form fiction, sustainable narrative momentum is an essential condition, rather than a weakness that may be compensated by stylistic beauty alone.

Among eligible profiles, `restrained_intimate` has the highest reported overall score (4.458), above `psychological_slow` (4.342) and `sensory_urgent` (4.333). It therefore wins **without invoking a tiebreak**.

## 4. Final P1 literary decision and binding P4 handoff

**Muse's winning reader voice: `restrained_intimate` v1.** This is the fourth candidate proposed in P1, characterized by intimate but restrained narration, causal clarity and emotional weight without stopping the story.

For P4:

1. Use the **exact versioned** `restrained_intimate` directive from `scripts/quality-evals/reader-voice-profiles.mjs`, through `buildVoiceSystemPromptV1('restrained_intimate')`, or an exact-byte equivalent of the sealed selection result. **Do not rewrite the winning directive based on this summary.**
2. Verify its system prompt hash against the organizer's sealed selection-result hash when that artifact is available. Do not substitute a newly composed phrase and assert the hashes match.
3. Keep the Reader's pinned Canon, session-specific history, context manifest, verified V3 workflow and post-revision choices rules from P0/P3–P4. The style winner is a **style policy**, not a dispensation from factual, lineage or publication gates.
4. Archive all four profiles' original score vectors and operational metrics with the organizer, including the ineligible `cinematic_minimal`; never report only the winner.

Muse's literary selection is final under Nguyen's delegated D10 authority. This does not claim operational P4 acceptance.

## 5. D2 evidence and explicit unknowns

- Observed errors/retries: **0 of 80 calls**, with baseline transport policy `transportRetryPolicy: 'none'` and no measured retry event.
- Latency: **p50 6,410 ms**, **p95 9,983 ms**, under this real proxy route and this 80-call corpus.
- A proxy timeout exists at 55 seconds, but 80 observed calls did not exercise it.
- This is an input to future bounded configurable D2 retry selection, **not enough to infer a statistically guaranteed error rate**, the provider's worst-case latency, or the optimal retry count. D2 limits are not fixed by this sample.
- No supplied per-token price: **USD cost remains unknown (null)**. Do not substitute zero because the premium proxy injects credentials.
- Real-provider V3 semantic smoke was not documented in this handoff. It remains **unverified**, not silently counted as passed.

## 6. Evidence custody and repository boundary

No organizer key, provider credentials, anonymous-to-profile mapping, raw 80-turn literary corpus, individual review forms or secret transport configuration are added to Git. The reported aggregate results and four six-axis score profiles above are suitable public conclusions; the underlying raw evidence remains with Muse, as the evaluator/operator.

This document faithfully records Muse's real-run report and verdict. The commit containing the harness-specific Vite corrections is the companion runtime-independent P1 fix. P2 Reader Persistence remains a separate branch and PR; this P1 conclusion neither implements nor claims any P2 behavior.
