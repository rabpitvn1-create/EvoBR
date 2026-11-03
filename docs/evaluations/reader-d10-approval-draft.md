# P1 D10: Muse Voice Selection, preregistered rubric and fixed literary gates

> **D10 final verdict, 2026-11-03:** Muse has completed the real 80-turn run and blinded literary scoring under the preregistered thresholds in this document. **`restrained_intimate` wins**, with overall 4.458 and `voice` 4.65; `cinematic_minimal` fails the unchanged pace floor (3.40 < 3.50) despite its voice 4.95. See [reader-baseline-conclusion.md](./reader-baseline-conclusion.md) for all four score vectors, model transport and observed metrics. Statements below about 0/80, pending Muse scoring or missing results are preserved as the **pre-run preregistration state**, not the current verdict. No numerical thresholds below were changed after scoring.

**Authority changed 2026-11-03:** Nguyen delegated D10's literary verdict and winning voice selection to **Muse**. Nguyen does NOT need to sign each literary quality decision. The numerical literary gates below are **fixed by Nguyen's P1 reassignment, before any four-profile results were generated**. Muse must explicitly preregister/acknowledge the complete rubric **before seeing blinded review results**, and may not lower or revise thresholds based on scores. This document records the fixed policy and implementation; **it does not claim Muse has already scored or formally preregistered it**.

**Current evidence status:** 0/80 real profile turns generated in this assistant environment, 0 blind rating packets emitted from genuine reports, no voice winner and no latency/token/cost measurements. Node 24, Codex authenticated CLI and compatible real-provider settings remain unavailable here. No fake result is admissible.

## 1. Evaluation objective and four voice profiles

Every profile uses the **same fixed Cao Minh / Backrooms Level 0 opening**, the same no-quest/no-forced-ending/Canon constraints, the same model/provider/configuration and 20 consecutive turns with exact prior-turn history. **Only the Vietnamese system-prompt voice directive differs.** Profile catalog: `scripts/quality-evals/reader-voice-profiles.mjs`, `VOICE_PROFILES_V1` and exact prompt text are versioned; a profile is identified by its ID and SHA256. If the model changes, treat that as a separate secondary axis, with explicitly partitioned results, rather than silently mixing provider effects into voice rankings.

| Internal profile ID, organizer only | Literary direction | Distinct experiment |
| --- | --- | --- |
| `cinematic_minimal` | Lạnh, tối giản, điện ảnh | Concrete movement, spare syntax, restrained fear, controlled negative space |
| `sensory_urgent` | Giàu hình ảnh, nhịp dồn dập | Strong sensory detail, varied pace, active pressure without purple prose |
| `psychological_slow` | Chậm, ám ảnh tâm lý | Accumulating uncertainty and interior perception, never invented prehistory |
| `restrained_intimate` | Nội tâm tiết chế, giàu sức nặng | **Fourth candidate:** emotional depth from difficult, causally grounded decisions while still advancing events; balances commercial readability and literary restraint |

**Reason for the fourth profile:** It is not a blend created after seeing results. It tests whether grounded, emotionally intimate narration can outperform purely visual, sensory and slowly psychological styles on the six-axis rubric. Its prompt is frozen before generation and must be transferred byte-for-byte to P4 if selected.

No model-generated choices, reader DB updates, editor changes or Chinese-guard changes occur in P1. Rerunning a losing profile with a changed prompt is a **new, versioned round**, never a retroactive correction of its original score.

## 2. Six-dimensional blind rubric registered BEFORE outcomes

Muse rates **each of the 20 turns of each profile** on six dimensions from 1 to 5. Intermediate 2 and 4 mean between the corresponding anchors, not a different scoring system. A full submission is **20 × 6 numeric scores per profile**; `unknown` may be captured in draft but is NOT included in formal selection and must be resolved before ranking.

| Dimension | 1: deficient | 3: readable but needs editing | 5: outstanding, commercially readable prose |
| --- | --- | --- | --- |
| `immersion` | No vivid location or reader anticipation | Scene recognizable, atmosphere uneven | Sustained presence, mounting curiosity and credible sensory stakes |
| `causality` | Actions/events appear without reasons | Main chain understandable, weak transitions | Every choice/action follows knowledge and constraints; consequences evolve |
| `payoff` | Setups never pay off or surprises arbitrary | Some emotional effects, uneven follow-through | Every meaningful tension arc yields proportionate emotional or narrative value, even in an open-ended story |
| `voice` | Mechanical Vietnamese, copied cadence or generic model texture | Legible but inconsistent narrator/character interiority | Distinct publishable Vietnamese narrative voice, varied but coherent sentence rhythm |
| `pace` | Repetitive loops, idle scene, unexplained jump | Some development but patchy momentum | Deliberate movement, alternation of pressure and relief; every turn adds a meaningful development |
| `continuity` | Contradicts earlier published text or fixed premise | Large facts consistent; local details drift | Spatial, causal, object, temporal and emotional continuity intact across all prior turns |

A Muse review MUST explicitly mark every turn, and a separate Muse Canon audit MUST be signed for **every anonymous series** before the organizer maps are revealed. There is no automatic score, no invented reviewer and no claim that this single-reviewer competition measures population reader preferences or predicts actual sales. "Bán chạy được" is a qualitative editorial goal, not a claim of sales data.

## 3. Fixed literary pass/fail rules, not adjustable after results

These are the exact Nguyen-directed D10 selection thresholds registered before review:

| Criterion | Fixed rule |
| --- | --- |
| Overall literary average | Across all **120 scores** for a profile, mean **≥ 4.0 / 5** |
| Minimum per dimension | Every dimension's mean across 20 turns **≥ 3.5 / 5** |
| Voice criterion | The `voice` dimension mean across 20 turns **≥ 4.0 / 5** |
| Serious Canon errors | **ZERO confirmed** severe Canon violations of the three preregistered categories below; unresolved/uncertain allegations block a passing verdict pending Muse review |
| Winning profile | Among qualifying profiles, choose the **highest overall 120-score mean**. Exact tie on overall → higher voice mean wins. Further exact tie → Muse must explicitly adjudicate; no hidden arbitrary tiebreak |
| No qualifying profile | **No winner**. Create a **new, versioned four-profile round** without lowering any thresholds or reusing unsuccessful outputs as a pass |
| Continuity evidence | Muse evaluates all 20 turns in sequence; no skipping bad turns, cherry picking or substituting a later edited variant |
| Fair comparison | Same scenario, generation constraints and model config. Only declared style directive differs |

Serious Canon error categories for the locked audit:

1. `named-canon`: A fabricated named NPC or named entity is presented as pre-existing established Canon/history without authorized source. Mere introduction of a new anonymous encounter is not automatically this error.
2. `history-contradiction`: The new prose rewrites or directly contradicts an earlier **published** event, location, object state, protagonist knowledge or the fixed opening premise without any in-world causal transition.
3. `forced-ending`: The narration asserts a final ending, closes the work involuntarily or denies the continuing-story contract.

Each claimed serious incident must cite the exact offending quote and comparison (fixed scenario clause or prior turn/hash) and have a Muse verdict `confirmed` or `uncertain`. The tool does not infer Canon from text or automatically declare zero incidents: Muse must set `reviewed:true` for each audit after inspecting the entire chain.

Other stylistic defects (unsupported sensory detail, unnatural prose, purple prose, incorrect game-like tone) should be scored and discussed, but must not secretly introduce new rejection thresholds after ratings. If a new structural hard-rule breach is discovered, record it separately for P4 rather than recoding the above three S0 categories post hoc.

## 4. Double-blind-enough package, no fake A/B claims

`reader-voice-tournament.mjs pack` randomly shuffles four completed real reports into neutral `sample-01` to `sample-04` identifiers. Muse sees only participant HTML/JSON, the prose and six-axis questions. Profile IDs, system prompts, model information, prices, scenario metadata, backend run IDs and mapping stay exclusively in `organizer-key.json` outside the participant folder until all scores **and** four Canon audits are sealed. Muse reads each 20-turn series **in narrative order** for valid continuity judgments. This is a **blinded four-arm literary voice selection**, **not** an A/B test.

The optional `reader-blind-review.mjs` single-arm tool remains available for a non-comparative baseline study, but D10 selection uses `reader-voice-tournament.mjs` on four profiles.

The organizer must not open the identity map and tell Muse which sample is which before scoring is finished. The released final report reveals all profiles, winner or no winner, per-turn six-axis points and metrics **including losers**; the winner's exact `p4PromptDirective`, version and hash are the P4 handoff.

## 5. Operational thresholds separate from literary D10

**Muse sets token, latency and cost ceilings only from real P1.2 measurements.** They are operating-policy gates, not post-hoc changes to the predeclared literary rubric. Until actual usage, p50/p95 latency, provider price and retry distribution exist, no numerical operational ceiling is approved. Existing draft figures (200,000/30,000 tokens, 60 s p95, 25 minutes, US$5) are **withdrawn**, not secretly retained as D10 gates.

Report for every profile and the tournament: calls, per-call/turn tokens, p50/p95, elapsed time, retries and their causes, provider/model/version and exact model-price evidence where available. Missing usage/pricing is `null`, not zero. Failed dispatched calls may have unobserved billing. If the Codex subscription cannot provide a defensible USD-per-token price, cost remains unknown and is not misrepresented as free.

P4's eventual full pipeline has up to **six AI calls per normal turn** before retries, while P1 prose-only baseline calls one model per turn. These are different cost surfaces; do not extrapolate a P1 voice winner into unverified V3 correctness.

## 6. How to run, audit and rank

Prerequisites: Node 24, `npm ci`, Playwright Chromium, and a **real provider** configured for the existing `src/lib/ai/client.ts::chat`, or an authenticated `codex` CLI with explicit opt-in. No mock fallback.

```bash
node scripts/quality-evals/reader-voice-tournament.mjs generate ./p1-voice-results
```

This runs the four styles **sequentially**, each a separate real 20-turn chained narrative. Do not re-run a failed/ambiguous dispatched request under the same output directory. When all four reach `completed`:

```bash
node scripts/quality-evals/reader-voice-tournament.mjs pack ./p1-voice-results ./p1-voice-blind Muse
```

Give Muse **only** `p1-voice-blind/participants/`, not `organizer-key.json` and not profile-labelled reports. Muse fills the four HTML reviews and exports each response as `sample-XX-review.json`, then edits its corresponding `sample-XX-canon-template.json` to `sample-XX-canon.json`, setting `reviewed:true` after independent complete Canon review. Default `reviewed:false` is deliberate: empty incidents do not count as a verified zero until Muse certifies them.

After all scores and audits are sealed, the organizer runs:

```bash
node scripts/quality-evals/reader-voice-tournament.mjs rank ./p1-voice-blind ./sealed-muse-scores ./p1-voice-decision.json
```

The ranking step checks every packet hash, 20 × 6 numeric scores, Canon audit quote evidence and the exact preregistered thresholds. It outputs all four profiles, six dimension means, every turn's points, provider metrics, Canon incidents and the chosen P4 prompt directive if there is one. If no profile qualifies it explicitly returns `new-round-required` without altering standards.

## 7. Preregistration status and decision ownership

- Literary reviewer and final voice selector: **Muse** by Nguyen's delegated authority.
- The four style prompts and the thresholds in §3 are frozen in code/doc **before real results**. They may be reviewed for correctness and consistency before any inference/rating, but cannot be quietly altered after data has been seen.
- Muse must explicitly record their review of this preregistration in the conversation or GitHub **before scoring**. The mere existence of this file does not impersonate Muse's signature.
- No provider run, blind score, final winning voice or operational ceiling is claimed as of this document revision.
- Nguyen need not approve D10 literary scoring. The technical implementation may proceed through Muse review/merge rules, but a literary winner cannot be announced until the real experiment and sealed blind review exist.
