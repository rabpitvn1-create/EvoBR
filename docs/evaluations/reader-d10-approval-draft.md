# P1 D10 Review Pack: Vietnamese Literary Rubric and Proposed Acceptance Thresholds

**Status: DRAFT FOR NGUYEN'S PERSONAL APPROVAL. NOT APPROVED. NOT AN ACCEPTANCE RESULT.**
This document is a proposed **decision ballot** for D10. It must be signed or amended by Nguyen **before formal blind ratings are opened or used for acceptance**. The existence of this file does not confer approval, even though D10's principle was signed in P0. Until approved, all ratings are exploratory, and no P1 literary pass can be declared.

## 1. Study identity and source discipline

Study design: **single-arm, blinded, within-story 20-turn evaluation**, not a randomized A/B comparison. The sole material is a genuine `status:'completed'` real-provider run from `reader-vietnamese-baseline.mjs`. No material exists until the provider is available and all 20 prose turns have been generated. The packet tool is `scripts/quality-evals/reader-blind-review.mjs`.

Scenario: Cao Minh awakens alone in Backrooms Level 0, with old yellow rooms, humming fluorescent tubes and damp carpet. No map, companions or established knowledge. Only the fixed prompt facts count as authoritative for this baseline. New sensations, uncertainties and inference by the protagonist are possible prose developments, not automatically Canon. A real author-controlled World Canon baseline must later be re-evaluated in P2–P4.

Blindness:
- Organizer retains `organizer-key.json` with run/provider identity, model settings and billing data. It is **never** shared with participants.
- Participants receive their own standalone HTML and JSON packet with anonymized series ID and hashes. They see exactly 20 turns in their original order, necessary for continuity; they do not see model, price, prompt, benchmark version, author name, evaluator identities or hidden outcomes.
- Every participant independently reads and scores. No feedback, discussion, AI-generated rating, prompt tuning or score-driven sample selection before results are closed.
- Follow the six-axis labels from `longform-choice-questionnaire.mjs`; `reader-blind-review.mjs` deliberately uses the **single-arm** format and makes no A/B preference claims.
- Participant response JSON is validated against the original packet ID and every turn's content hash. A reviewer may mark `unknown` rather than guess. Raw rating exports are retained separately from organizer mapping; no automatic quality pass logic lives in the packet generator.

## 2. Six-dimensional rubric, 1–5 anchored scale

Each dimension is scored **for each turn**. The reference meaning of 1, 3 and 5 is given below; 2 and 4 denote a defensible intermediate assessment. `unknown` is not a numeric score.

| Dimension ID | 1: clearly deficient | 3: readable, needs revision | 5: consistently convincing |
| --- | --- | --- | --- |
| `immersion` | Hard to visualize place or stakes; no reader curiosity | Scene understandable, atmosphere sporadic | Strong sensory presence, stakes, evolving anticipation without repetitive formulas |
| `causality` | Actions or events lack cause; Cao Minh behaves inconsistently | General logic works but motivations or transitions thin | Each decisive action arises from character knowledge/constraints and changes consequences credibly |
| `payoff` | Emotional setup abandoned or effect arbitrary | Some tension and acknowledgment, uneven follow-through | Meaningful emotional or perceptual payoff proportional to buildup, while maintaining an open future |
| `voice` | Translation-like/schematic Vietnamese, unconvincing inner perspective | Mostly natural but predictable AI cadence or flat interiority | Distinct, fluid Vietnamese narrative voice and nuanced Cao Minh reactions |
| `pace` | Endless repetition, static loops or abrupt unexplained jumps | Mixed active and repetitive passages; uneven escalation | Controlled alternation of tension, observation and movement; each turn meaningfully advances the story |
| `continuity` | Direct contradiction with prior published turns or fixed premise | Preserves major facts but loses minor positions, chronology or object states | Maintains precise causal, spatial and emotional continuity over the full preceding sequence |

Reviewers record `readTo`, `continuation` (yes/maybe/no/unknown), and all six axes for each turn. The organizer additionally records **critical Canon violations** as a separate evidence-backed audit; this is **not** the same as a low literary score.

## 3. Critical Canon incident: proposed closed definition

**Draft severity S0 (fatal for P1 acceptance):** at least one cited passage verifiably does any of these in the 20-turn chain:

1. Contradicts the fixed opening conditions without a narrated causal transition, e.g. Cao Minh suddenly has a companion from the outset, a map, or reliable prior knowledge when the premise says otherwise.
2. Invents a named NPC and reports that person as established prior canon or shared protagonist history without source authorization. A deliberately unnamed uncertainty or a new, properly introduced encounter is not automatically a Canon violation, though it may have other narrative issues.
3. Presents externally unsupported Level 0/Backrooms lore as an **authoritative known world law**, rather than as observed evidence, character hypothesis or ambiguous narration.
4. Introduces explicit game UI mechanics, inventory, quest progression, combat stat systems or a forced hard ending in place of the agreed ongoing novel.
5. Claims a previously published event, character, object or decision was different, without narrating an in-world reason, retroactively rewriting the immutable prose history.

Audit artifact must contain `turn`, exact quotation, contradiction source (scenario clause or earlier turn/hash), category and reviewer. **Uncertain allegations are flagged for Nguyen to adjudicate and must not be silently classified as proven severe Canon errors.** Proposed acceptance requires **zero verified S0 incidents**.

## 4. Proposed numerical gates, NOT approved

These are **initial candidate policy numbers for Nguyen to accept, change or reject**, not measurements derived from provider runs. They are deliberately separated from technical completion. D10 cannot pass while any required metric is unknown.

| Gate | Proposed threshold | Decision owner |
| --- | --- | --- |
| Blind rater count | At least **3 independent** completed reviews for the same 20-turn corpus | Nguyen |
| Review completion | Each included reviewer must answer **20/20 turns** across all six dimensions (explicit `unknown` is a valid declared response but not a numeric score); incomplete packets are not counted as completed reviews | Nguyen |
| Six-axis literary mean | Every axis has overall mean at least **3.7/5** across valid rated turns and reviewers | Nguyen |
| Continuity stricter gate | Continuity overall mean at least **4.0/5**, and no confirmed direct contradiction masked by a good average | Nguyen |
| Per-turn collapse | No more than **2/20 turns** have median under **3/5** on any axis; list each such passage | Nguyen |
| Willingness to continue | At least **70%** of non-unknown responses indicate yes or maybe; no forced ending | Nguyen |
| Critical Canon errors | **0 verified S0 incidents** (see §3) | Nguyen |
| Output language | **20/20 passages** substantive Vietnamese narrative; foreign names/terms allowed where context requires | Nguyen |
| Token ceiling for 20 turns | At most **200,000 measured input tokens** and **30,000 measured output tokens**; no inferred usage counted as observed | Nguyen |
| Latency ceiling | Successful call **p95 ≤ 60 seconds** and total wall-clock benchmark ≤ **25 minutes** (excluding human assessment) | Nguyen |
| Estimated cost ceiling | **≤ US$5.00** for 20 turns using documented real input/output token prices; if Codex subscription exposes no defensible per-token price, mark cost **unknown**, not zero | Nguyen |
| Repeatability | One complete unmodified reference run; no cherry-picked alternate run replaces a failed baseline | Nguyen |

**Interpretation note:** 20 turns are evaluated in a fixed story sequence and are not independent statistical samples. Report per-turn trajectory, six-axis distribution and disagreements; do not call means a population-level guarantee. The listed numbers require explicit Nguyen approval or amendment **before opening formal blind ratings**, regardless of how many drafts Muse or the assistant review.

## 5. Measurement and D2/V3 handoff

P1.2 must produce a real, complete 20-turn report with per-call and per-turn input/output tokens, duration, observed request phase, retry/error reason, p50/p95 and priced estimate when available. Empty `usage` is `null`, not zero. A dispatched call that failed might be billed, so any claimed total-cost figure must remain unknown in that situation until the provider can reconcile usage. `maxModelCalls:4` in existing chapter V3 does not cover the future reader pipeline: the P4 turn can require **up to six calls** before retries, and those must be measured separately.

Suggested D2 limit must be argued from observed error counts, latency distribution, retry effectiveness, and per-request billing exposure. **P1 does not choose a final D2 retry count by intuition.**

V3 smoke test is optional in P1, but **only a provider-backed actual callback execution qualifies**. If Node24, authenticated provider or reviewed resources are unavailable, explicitly report **not executed**.

## 6. Commands and artifacts

Once a real complete baseline report exists:

```bash
node scripts/quality-evals/reader-blind-review.mjs pack ./p1-results/baseline-RUN.json ./p1-blind rater01,rater02,rater03
```

Hand each person **only** their own file under `p1-blind/participants/`. They open the HTML offline, score each turn, and click the export button to produce `*-review.json`. The organizer key remains private to the study coordinator.

```bash
node scripts/quality-evals/reader-blind-review.mjs validate ./p1-blind/participants/rater01.json ./rater01-review.json
```

No fake participant ratings, no A/B packet reuse, no automated pass declaration. Validating identity and completeness does not evaluate the literary thresholds.

## 7. D10 explicit sign-off ballot (not yet signed)

Nguyen is asked to confirm or amend **the complete rubric and thresholds in §2–§4**, including what constitutes S0 and the token, p95 latency, total time and cost ceilings. Confirmation must be dated and recorded **before** formal packet results are opened. Until then the document's approval status remains **DRAFT / awaiting Nguyen**.

**Current run status at authoring:** No authenticated provider and Node24 in this assistant container; **0/20 real turns completed**, no literary ratings or V3 smoke available. The packet maker refuses partial runs. This section must be updated with concrete evidence, not wishful outcomes.
