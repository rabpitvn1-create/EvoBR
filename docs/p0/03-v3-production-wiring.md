# P0.3 V3 Production Wiring and Final-Prose Choice Contract

Status: proposed engineering contract for Muse review. No P1–P5 runtime code is implemented here. Supersedes any P0.2 wording suggesting generation produces prose and choices in one immutable model response. References [P0.1](./01-reader-data-contract.md) and [P0.2](./02-reader-publication-contract.md). Nguyen approved D1–D10.

## 1. Verified implementation boundary

The relevant imported StoryForge source was read at branch `feat/import-storyforge-longform`:

| Existing path | Observed fact | Consequence |
| --- | --- | --- |
| `src/lib/agent/run/prose-generation-durable.ts` | `buildProseGenerationRunContractV1` includes `chapterId`, `chapterIds:[chapterId]`, `writeTargets:[{table:'chapters',...}]`, and an `author-confirmed` acceptance criterion. `ProseGenerationCandidateV1` includes `chapterId`, `contentRevision` and `expectedContentHash`. | Reader must not claim this exact chapter run/candidate/adoption contract is reader-neutral. |
| `src/lib/agent/run/prose-semantic-durable.ts` | `runDurableProseSemanticReviewV1` requires `chapterId:number`, `chapterTitle`, `generationAssembled`, `informationBoundary`, `review` and `revise` callbacks. Review and revision use *the same* generation assembly; context manifest boundary contains `chapterId`. | Adapt the durable **wrapper and bound manifest identity** to reader turn/session, not by supplying a fabricated chapter ID. |
| `src/lib/agent/prose-semantic-review.ts` | `runProseSemanticReviewCycleV1` operates on a **string** `originalText` and returns `outputText`, `status:'passed'|'blocked'`, review/revision artifacts. One revision then rereview maximum; revision's caller-injected validator handles deterministic information-boundary errors. | Reuse the pure semantic cycle against **prose only**, after reader scope and information boundary are frozen. |
| `src/lib/agent/prose-semantic-review.ts` | Review prompt takes `chapterTitle`, `candidateText` and assembled context. Evidence is verbatim quotations from candidate and registered context; unsupported blocking evidence is rejected. Prompt is Chinese but assesses prose semantics rather than locale. | Reader must supply a reader-oriented title/scene label and versioned Vietnamese prompts, preserving evidence parsing/hash rules. Do not automatically mutate authoring prompt behavior. |
| `src/lib/agent/formal-ai-entry.ts` and `src/lib/agent/ai-entry-registry.json` | Formal entry bindings validate skill/category/allowedCallers/writeTargets. Current `prose.chapter.generate` caller is `src/lib/generation/chapter-generation-node.ts` and adoption target is `chapters`. | Reader generation and choice generation require governed, explicitly registered AI entry bindings; do not reuse a chapter entry under an unauthorized caller. |
| `src/lib/agent/run/prose-semantic-durable.ts` | Review/revision callbacks are caller-injected `(messages:ChatMessage[])=>Promise<string>`; no prose production caller currently injects provider-backed callbacks. | Add reader production callbacks through existing AI client/AI entry governance and frozen provider routing, not an independent transport. |

The V3 evidence trace confirms the production editor passes `semanticReview:false` in `ChapterEditor.tsx:1394`; V3 tests run the true path with mocked callbacks and fail-closed evidence checks. **Do not flip this flag in the editor.** The V3 contract version is not itself proof that semantic review is enabled; require the specific acceptance criterion `prose-generation.semantic-review` and verifier evidence.

## 2. Decision: options are generated AFTER final V3 prose (Muse review item 2, strategy C)

The reader turn is a **two-stage model product** with one immutable publication candidate envelope:

1. **Reader prose generation** produces only a Vietnamese prose string, under a reader-targeted generation Skill/Run Contract; no choice in this output has publication authority.
2. Apply deterministic prose checks (nonempty, language, scope/boundary) and V3 semantic review/revise/rereview to that prose only.
3. Freeze `finalProse` and its exact `finalProseHash` **after V3 passes**. If V3 blocks, there is no choice-generation call.
4. **Reader choice generation** is a *separate* governed AI step, given exactly frozen final prose, current decision, pinned canon/session packet and required choice-generation instruction. It returns branch choices, not new prose or side effects.
5. Validate choice output syntactically and semantically relative to **final prose**; persist the choice evidence with `finalProseHash`. A choice cannot be carried over from an earlier prose candidate. If no valid branch options remain, coordinator injects one real `kind:'continue'` choice with `Đọc tiếp`.
6. Compose the final publication candidate `{prose:finalProse, choices:validatedChoices, sceneHints?}` with evidence linking its components. Publication Gate checks `finalProseHash` against V3 final candidate hash and choice-step source hash, and only then authorizes the atomic transaction.

This is **strategy C**, not a claim V3 already reviews choices. It avoids stale choices when V3 revises the story, preserves existing V3 text-only machinery and applies D6 without a forced ending. It costs an additional governed model call when branches are needed; measure token/latency in P1/P4 and include it in the reader budget.

### Semantic alignment of choices to final prose

Merely generating choices later reduces staleness but does **not guarantee** they are narratively coherent. The choice-generator contract must require each proposed branch to carry an evidence `sourceQuote` excerpt **verbatim from the final prose**, with the concrete decision opportunity or unresolved situation it branches from. The deterministic reader parser rejects missing/non-verbatim source quotes, duplicate keys, invalid response shape, choices contradicting explicit hard rules, and options that introduce unauthorized named Canon entities. The `sourceQuote` is candidate evidence, not a persisted new branch fact.

A source quote is necessary but **not sufficient** semantic proof. Therefore a reader-specific choice-consistency check is required before publication, applied to the *frozen prose and candidate choices together*. P0.3 chooses a bounded **read-only semantic check** (Skill/evaluation binding must be registered as a governed model call; no `adopt` permission), in which a blocking verdict must cite (a) the exact candidate choice, (b) an exact quote from final prose or a registered context segment and (c) a closed issue code such as `unavailable-affordance` / `choice-prose-contradiction` / `scope-violation`. This is a **new reader-specific verifier** with provenance/hash/closed-schema checks, *not* an unclaimed feature of existing V3. A failed check removes offending choices or blocks publication according to versioned policy; if no validated branches remain the deterministic Continue action is admissible only if continuation itself does not violate hard narrative rules.

**Choice-stage retry/exhaustion contract:** Choice generation, parsing and consistency review use a finite separately configurable retry budget (D2), with a durable attempt receipt for each try. A choice-stage retry NEVER regenerates or changes V3-approved `finalProse` or `finalProseHash`. After exhaustion, coordinator publishes exactly one trusted `kind:'continue'` choice **only if** continuation passes all deterministic hard constraints for the frozen prose and session. If Continue is forbidden, the entire turn attempt fails with durable evidence and **no turn, choice, decision, or session progress is committed**. The exact retry count remains unassigned until the P1 baseline.

**Scene-hint non-blocking invariant (D8):** Missing, malformed, contradictory or otherwise rejected `sceneHints` are simply omitted from the final publication payload. A scene hint never blocks an otherwise publishable prose+choices turn, never gains Canon authority and is not part of the mandatory Publication Gate verdict. It may be regenerated later without changing published prose or choices.

No prose is silently revised after choice generation. If final prose must change again, choices and their verification evidence are invalidated and regenerated from the new `finalProseHash`. Scene hints are also produced/validated against frozen prose; hints never override prose/Canon.

**Schema consequence:** P0.1 `readerChoices` physical records need not store `sourceQuote`; reviewer evidence belongs to candidate/run artifacts. `readerPublicationRuns.receiptJson` (and its hash-verified contents) records the frozen prose hash, choice candidate hash, consistency verifier hash and their manifest. These are specified metadata, not fields the model can sign.

## 3. Contracts and governance: how to wire to a real provider

### Existing reusable mechanisms

- Resolve configured model/provider by the existing AI config + task-routing path; freeze the provider/model and relevant request settings per attempt. Do not silently switch model at review/revision.
- Use `src/lib/agent/formal-ai-entry.ts` governed `executeRegisteredAIEntryV1` / `streamRegisteredAIEntryV1` (or the approved frozen equivalent) and `src/lib/ai/client.ts` for all generation/review/choice calls. No second fetch implementation.
- Use `src/lib/agent/run/prose-semantic-durable.ts` to guide the new reader durable wrapper's event sequence (`step.scheduled/started`, manifest, model request/output, budget, step completion/failure), retaining the pure cycle's evidence semantics.
- Register reader-specific entry IDs, skills, allowed caller paths, categories, candidate kinds and invocation boundaries in existing formal AI entry/skill registries. **Do not invent a concrete ID until registration is authored** in P4.
- Reviewer and reviser callbacks receive built `ChatMessage[]`; they must return the raw model text to `runProseSemanticReviewCycleV1`, not parse away evidence. The existing deterministic parser verifies exact quote/sourceKey and code closure.
- Preserve the choice-generator/reviewer authority separation: they cannot write reader tables. The Publication Gate alone gets commit authority after all verdicts pass.

### Reader wrapper instead of counterfeit chapter

**Proposed new adapter/wrapper** (`src/lib/reader/semantic-review.ts`, path not yet existing):

- Input boundary uses `{sessionId, sourceTurnId?, turnAttemptId, canonBaselineHash, lineageFingerprint, contextManifestHash, finalProseHash}`. The reader-oriented review evidence must bind the same generation assembly and source set as the prose generator.
- Map session/turn boundary to a new context manifest variant, **not** `chapterId = sessionId`, `chapterId = turnId` or an arbitrary chapter record.
- Reuse `runProseSemanticReviewCycleV1`, existing review artifact verification routines, skill execution binding construction and budget accounting. Because the current durable wrapper hardcodes `chapterId` into the context manifest, either extend it with an explicit discriminator union for reader boundary (retaining backward compatibility) or build a reader wrapper sharing the cycle and common evidence helpers. Prefer the latter initially to avoid changing editor behavior.
- Reader publication must have an independently typed acceptance criterion for V3 semantic pass and final candidate hash; the `chapter`-specific `commitProseGenerationAdoptionV1` and its author confirmation are **not** reused.
- The full reader contract includes generation, V3 reviewer, optional one revision and rereview, choice generation, and choice-consistency review **as separately counted calls**. Contract V3's existing `maxModelCalls:4` applies to chapter prose steps only; it must not be misrepresented as the total reader-turn budget.

### Provider errors and fail-closed handling

Provider timeout, malformed review JSON, forged evidence quote, missing manifest, exhausted budget, reviewer unavailable or V3 final `blocked` verdict must leave candidate uncommitted. The reader UI receives only an actionable error/progress state. No model error should be caught and converted to `pass` or to an invented choice.

If `review` and `revise` resolve to the same provider/model as generation, retain the `correlatedJudge` trace and expose it to evaluation. No claim of independent judgment if they are correlated.

## 4. Exact execution and evidence sequence

1. Coordinator validates requested session, choice and opening exception, resolves pinned baseline and reader memory readiness. Reject before any AI call if missing.
2. Freeze `generationAssembled`, session lineage fingerprint and reader information boundary; persist durable attempt intent/evidence.
3. Generate prose via registered formal entry; persist immutable `originalProseHash` candidate.
4. Pass prose through reader deterministic check.
5. Invoke V3 semantic cycle from the new reader durable wrapper, injecting provider-backed `review` and `revise`; track each review/revision/rereview step, hashes, budgets and manifest. The final `passed` result yields `finalProseHash`.
6. Generate branch choices **only now**, based on `finalProse`, with its hash included in the frozen choice request evidence.
7. Run deterministic choice checks, then the choice-specific semantic verifier on the exact final prose and surviving choices. Failing branches are not adopted.
8. If no usable branches remain, create one trusted `continue` choice. The hard rules for Continue remain enforced.
9. Build combined publication candidate and verified receipt intent; check all hashes and evidence before commit.
10. P5 atomic transaction rechecks head/revision/lineage, inserts turn/choices/decision/receipt and advances session via CAS. Candidate from losing optimistic attempt becomes stale, never reused.
11. Start reader-specific postcommit memory saga; next turn waits until mandatory memory readiness.

All provider calls, hashing requiring I/O, UI messaging and callback injection happen **outside** the Dexie publication transaction. CAS and record validation are repeated inside it.

## 5. Real-code obstacles and required P4 adaptations

| Obstacle | Evidence | Resolution |
| --- | --- | --- |
| Chapter-bound generation contract/candidate | `prose-generation-durable.ts` uses `chapterId`, `contentRevision`, chapter `writeTargets`, `author-confirmed` criteria. | New reader contract/candidate based on the same durable Harness and event vocabulary, not a false chapter record. |
| Chapter-bound review manifest | `prose-semantic-durable.ts` requires `chapterId` in manifest boundary and a chapter information boundary. | New reader wrapper with session-aware manifest identity; reuse semantic cycle and verifiers where input shapes permit. |
| No review model client caller | `prose-semantic-durable.ts` takes callbacks, editor does not supply them. | Register authorized reader caller and inject provider-backed review/revise through existing client and task routing. |
| Prompt hardwired to author chapter | `agent/prose-semantic-review.ts` builds Chinese review prompt using chapter label and registered evidence. | Version reader review prompt without weakening exact evidence/verdict parsing. Keep editor prompt unchanged. |
| Existing formal entry authorized for chapter only | `formal-ai-entry.ts` validates allowed caller/category/skill and `ai-entry-registry.json` chapter target. | Register reader generation + choice generation/review with proper read/write authority; preserve frozen bindings and CI registry checks. |
| Choice/prose mismatch after revision | V3 edits only a string. | **Decided:** freeze final V3 prose, then generate choices and verify grounding/coherence; never carry forward pre-revision choices. |

## 6. P4/P5 regression obligations

| Case | Expected result |
| --- | --- |
| V3 passes without revision | Choices generated once from original approved prose hash |
| V3 revises event/location/actor | Choices generated only from **revised** prose; original scene choices never published |
| V3 review blocked or bad quote | Zero choice-generation calls, zero committed turns |
| Revision blocked by deterministic information boundary | Zero choice-generation calls; no publication |
| Choice sourceQuote not verbatim in final prose | Choice rejected, not published |
| Choice sourceQuote real but proposed option contradicts scene | Reader choice-consistency verifier blocks/removes it |
| All model choices invalid after validation | Exactly one `kind:'continue'` is injected if legal; no zero-choice active turn |
| Head changed during multi-call pipeline | Commit CAS conflicts; candidate marked stale; no reuse |
| A caller reuses chapter formal entry for reader | Registry authorization rejects it |
| Review budget exhausted halfway | No publication, durable failure evidence retained |
| Restored run has different lineage/context hash | Candidate stale and rejected |
| Reviewer/provider equals generator/provider | `correlatedJudge` trace true; no false independence claim |
| Reader prose is Vietnamese but editor chapter prompt remains Chinese | Reader passes language gate; editor behavior unchanged |

## 7. P0.4 and P0.5 handoff

**Resolved by [P0.4](./04-reader-context-memory-contract.md):** the identical frozen Gateway assembly reaches generation/V3/choice stages; lineage, provenance, Canon snapshot and conditional memory readiness are explicitly specified.

**Resolved by [P0.5](./05-implementation-plan-and-regression-matrix.md):** P4/P5 file owners, proposed Skill/formal entries, unified regression matrix and six-call worst-case instrumentation are assigned. The existing chapter V3 budget does not cover a whole reader turn.

No change to current editor, author-confirmed adoption or production model routing in P0.3.
