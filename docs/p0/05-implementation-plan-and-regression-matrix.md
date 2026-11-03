# P0.5 Implementation Plan, Unified Regression Matrix and P0 Handoff

**Status:** P0 planning contract ready for Muse / Nguyen review. **No P1–P5 runtime implementation in this PR.** The five P0 specifications are:
1. [01 Reader Data Contract](./01-reader-data-contract.md)
2. [02 Reader Publication Contract](./02-reader-publication-contract.md)
3. [03 V3 Production Wiring](./03-v3-production-wiring.md)
4. [04 Reader Context and Memory Contract](./04-reader-context-memory-contract.md)
5. This implementation plan and test matrix.

**Authority:** D1–D10 were **signed by Nguyen**. Do not mark them tentative. Work = novel, World = settings/characters, reader session = isolated history; the AI writes prose at choice/read time, no preauthored branch execution, GM, quests, inventory, combat, levels or forced ending. Local IndexedDB is the MVP persistence choice; no cross-device sync claim. The reader UI/stage is P6 and release-long-run checks are P7, both out of scope of this P0 delivery.

## 1. Dependency graph and build order

```text
P0 signed contracts
  |
  +--> P1: Vietnamese literary/latency/cost baseline + preapproved D10 thresholds
  |       |
  |       +------------------------------+
  |                                      |
  +--> P2: nine tables + migration + registry/restore + immutable Canon capture
          |
          +--> P3: effective lineage + reader Gateway + memory/readiness
                  |
                  +--> P4: reader durable prose + V3 wrapper + final-prose choice AI/verifier
                          |
                          +--> P5: atomic publication coordinator + CAS + receipt + saga recovery
```

P1 can run as an **offline/isolated evaluation harness** without reader DB write authority, but P4 cannot claim production acceptance until P1 quality gate and budget limits are approved. P3 may use a seeded synthetic reader history without calling the model; P5 can begin contract-level mocks in parallel with P4, but end-to-end acceptance depends on real P4 candidate/evidence artifacts. Do not introduce the current chapter editor as a temporary reader runtime.

**Within each implementation part:** finish its assigned changes, then perform one consolidated verification pass for that part per AGENTS.md and Nguyen's work rhythm. At the end of P5/P7 perform comprehensive CI/E2E. P0 itself changes docs only, so documentation/GitHub diff verification is appropriate; do not claim runtime tests passed.

## 2. File-level work breakdown, verified source versus new proposals

All `src/lib/reader/*` paths below are **NEW PROPOSED FILES**, not existing repository APIs. Existing source paths in the second column were inspected in P0 evidence, or identified in the prior verified contract traces. Names of new registrations and tests are proposals, not deployed declarations.

| Stage | Existing anchors to integrate, not overwrite | New or changed files, ownership, deliverable |
| --- | --- | --- |
| **P1 Quality and budgets** | `scripts/quality-evals/longform-choice-questionnaire.mjs`; `src/lib/ai/client.ts`; `src/lib/agent/formal-ai-entry.ts`; `src/lib/ai/adapters/prompt-guards.ts` | **NEW PROPOSED** `scripts/quality-evals/reader-vietnamese-baseline.mjs`, `docs/evaluations/reader-baseline-protocol.md`; owner literary evaluation + provider integration. Test a sequence of 20 prose turns on a fixed scenario with six blind-rated dimensions and logged run costs. Do not change chapter-language guard. |
| **P2 Types and schema** | `src/lib/db/schema.ts`; `src/lib/types/index.ts` or existing type exports (confirm exact export style while implementing) | **NEW PROPOSED** `src/lib/types/reader.ts`: nine record types, ids/status/choice kind, immutable baseline, source provenance; register nine Dexie `Table` properties, indexes and additive schema version from 13. |
| **P2 Table governance** | `src/lib/registry/project-tables.ts`; `src/lib/registry/types.ts`; `src/lib/registry/field-registry.ts`; `src/lib/registry/adoption-schema.ts`; `src/lib/workspace/scope.ts` | Register nine reader tables, parent-locator owners, all reverse refs, FK checks, `exportRemap`, `exportIdField`, AI/coordinator writable fields and exact adoption identities. Reader ownership is **additional policy**, not a new `WorkspaceScope` taxonomy. |
| **P2 Portable lifecycle** | `src/lib/export/registry-export.ts`; `src/lib/export/registry-import.ts`; `src/lib/workspace/lifecycle.ts`; `src/lib/export/backup-trust.ts` | Prefer **metadata-only** registrations. **IMPLEMENTATION PROOF:** nullable pointer cycles `readerSessions.headTurnId/forkTurnId` ↔ `readerTurns.sessionId`; confirm `deferImport` and self-tree behavior on a real nested-fork backup. Modify importer only if the tested supported metadata cannot represent the required dependency without loss. Never silently drop a required FK. |
| **P2 Canon freeze** | `src/lib/world-engine/releases.ts`; `src/lib/context-gateway/canon-provider.ts`; `src/lib/registry/project-tables.ts` | **NEW PROPOSED** `src/lib/reader/baseline.ts`: capture one consistent registered, confirmed-only World + Work intent allowlist; canonical versioned `readerSessions.canonBaselineSnapshotJson`, ref and hash; inherit at fork. Fail closed on missing/oversize required material; hard snapshot limit selected from actual data, not invented here. |
| **P3 Lineage** | `src/lib/registry/project-tables.ts`; `src/lib/db/schema.ts` | **NEW PROPOSED** `src/lib/reader/lineage.ts`: ordered ancestor/cutoff resolver, foreign-work checks, deterministic lineage fingerprint; no sibling or post-fork data. |
| **P3 Gateway** | `src/lib/registry/context-sources.ts`; `src/lib/registry/assemble-context.ts`; `src/lib/context-gateway/selector.ts`; `src/lib/context-gateway/execution.ts`; `src/lib/context-gateway/attempt-evidence.ts`; `src/lib/context-gateway/provider-cache.ts`; `src/lib/prose/gateway-context.ts` | **NEW PROPOSED** `src/lib/reader/context.ts`, `src/lib/reader/resources.ts`: reader-only allowlist, frozen `ReaderContextScopeV1`, single assembled packet shared by generation/V3/choices, provenance/hash, mandatory anchor/budget checks. Reader-specific resource provider is permitted if existing provider cannot enforce session predicates. **Never** call the chapter assembly unfiltered. |
| **P3 Reader memory** | `src/lib/ai/chapter-memory/run-chapter-memory.ts` (read algorithm, **do not call as reader writer**); `src/lib/registry/field-registry.ts`; `src/lib/registry/adoption-schema.ts` | **NEW PROPOSED** `src/lib/reader/memory.ts`, `src/lib/reader/knowledge.ts`: full-text continuity floor, optional verified-prefix summary, confirmed-only facts/knowledge, provenance and supersession, hash-scoped retrieval, idempotent post-commit saga states. No chapter/Work ledger writes from reader. |
| **P4 Reader prose adapter** | `src/lib/ai/adapters/chapter-adapter.ts`; `src/lib/ai/adapters/prompt-guards.ts`; `src/lib/agent/formal-ai-entry.ts`; `src/lib/ai/client.ts`; `src/lib/agent/skill-registry.ts`; `src/lib/agent/ai-entry-registry.json`; `src/lib/agent/execution-binding.ts` | **NEW PROPOSED** `src/lib/reader/generation.ts`, `src/lib/reader/adapter.ts`, `src/lib/reader/run-contract.ts`: governed reader-targeted prose-only generation, Vietnamese prompt, frozen binding/model/budget, durable candidate keyed to session/lineage; no fake chapter. Update tool catalog fingerprint **only if** catalog changes. |
| **P4 V3 wrapper** | `src/lib/agent/prose-semantic-review.ts`; `src/lib/agent/run/prose-semantic-durable.ts`; `src/lib/agent/run/prose-generation-durable.ts`; `src/lib/agent/run/event-store.ts`; `src/lib/agent/run/context-manifest.ts` | **NEW PROPOSED** `src/lib/reader/semantic-review.ts`: reader boundary discriminator, callback wiring through registered entry/client, same immutable assembled context, review/revise/rereview artifacts, no fabricated `chapterId` and no change to editor `semanticReview:false`. |
| **P4 Post-V3 choices** | `src/lib/agent/formal-ai-entry.ts`; `src/lib/agent/skill-registry.ts`; `src/lib/agent/prose-semantic-review.ts` (evidence patterns only) | **NEW PROPOSED** `src/lib/reader/choices.ts`: freeze `finalProseHash`, then governed choice generation, exact `sourceQuote`, separate read-only semantic coherence verifier, finite per-choice retry and Continue fallback, sceneHints never block. |
| **P5 Publication** | `src/lib/registry/adopt.ts` (`adopt`, `replaceAdoptedCollection`, generic hash CAS); `src/lib/workspace/scope.ts`; `src/lib/agent/run/event-store.ts`; `src/lib/context-gateway/attempt-evidence.ts` | **NEW PROPOSED** `src/lib/reader/publication.ts`, `src/lib/reader/commit.ts`: validate evidence before transaction, then **one Dexie transaction** over targets and read dependencies; invoke each registered `adopt`, assert every write, CAS head/revision, persist turn+choices+decision (except opening)+receipt; rollback on any skip. Mark optimistic loser stale; idempotent re-read after dropped response. |
| **P5 Recovery** | `src/lib/agent/run/event-store.ts`; existing chapter saga precedent, not chapter target | **NEW PROPOSED** `src/lib/reader/recovery.ts`: distinguish attempt from committed receipt; replay same key without model call after confirmed commit; derived memory saga has named partial state and idempotent source identity. |

### Explicit new registrations to create, not already present

**Nine new tables:** `readerSessions`, `readerTurns`, `readerChoices`, `readerDecisions`, `readerFacts`, `readerKnowledge`, `readerMemory`, `readerRetrievalChunks`, `readerPublicationRuns`. Every table is registered in schema + `PROJECT_TABLES`, with appropriate fields in `FIELD_REGISTRY` and collections in `ADOPTION_SCHEMAS` where adoption is used. Trusted coordinator metadata (`projectId/workId/sessionId`, CAS revision, receipts, status, hashes) must not be accepted as model-supplied authority.

**New proposed Context source keys**, names not yet registered: `reader.baseline`, `reader.published-history`, `reader.decisions`, `reader.confirmed-facts`, `reader.confirmed-knowledge`, `reader.continuity`, `reader.retrieval`. Register in `CONTEXT_SOURCES` and satisfy the existing `ContextSource`/Skill policy contract. Mandatory baseline/history/decision anchors must be protected and fail closed when omission would create incomplete continuity. No implicit use of `writtenChapters`, `currentFacts`, `characterKnowledge`, `retrievedPassages`, `ragSelection` or `searchResults`.

**New proposed Skill IDs**, exact spelling subject to existing `skill-registry.ts` parser/domain rules: `reader.prose.generate`, `reader.prose.review`, `reader.prose.revise`, `reader.choices.generate`, `reader.choices.review`. `reader.prose.review` is used for both initial review and rereview. These may be implemented by extending existing prose Skill registrations instead of creating duplicates **only if** frozen read capabilities/allowed caller checks and the reader session boundary remain enforceable; no weakening chapter permissions. Confirm `skill-registry.ts` allows the proposed domain/mode; do not assume new IDs parse without code changes.

**New proposed formal entry IDs**, exact registration not deployed: `reader.prose.generate`, `reader.prose.review`, `reader.prose.revise`, `reader.choices.generate`, `reader.choices.review`. Formal registry `src/lib/agent/ai-entry-registry.json` requires registered Skill, caller/category, candidate kind, execution boundary and adoption target consistency. Review/revise/choice-verifier are **read-only for adoption**, and publication authority belongs to the coordinator. A reader prose generation entry must have a formally declared candidate/adoption boundary appropriate to the existing registry validator; P4 must prove its precise Skill write-target representation, not invent a permissive `adoptAllowed` value to bypass registration. New category/task policy keys may require updates in `src/lib/agent/context-policy.ts`, with corresponding validation/CI fixtures; treat this as a planned dependency, not a confirmed existing category.

**New tests, proposed locations:** `tests/regression/R-READER-*.test.ts`, `tests/e2e/reader-*.spec.ts` or the test directories actually used by Playwright on inspection. Retain existing V3 regression tests and editor semantics. New test names here are proposals.

## 3. Unified acceptance matrix: deduplicated from P0.1 §5, P0.2 §7, P0.3 §6, P0.4 §7

Each test has **one owning stage** and a type: U = unit, I = integration including fake-indexeddb, E = E2E browser, H = blinded human literary evaluation. Later-stage E2E may repeat a critical invariant, but the canonical obligation is listed only once here. This is a list of tests to **implement**, not a claim they currently exist.

| ID | Owner | Type | Scenario and expected assertion |
| --- | --- | --- | --- |
| Q01 | P1 | H | 20 linked Vietnamese narrative turns in a frozen scenario: six blind-rated dimensions, causal/continuity notes, preference and willingness to continue recorded before thresholds are evaluated. |
| Q02 | P1 | I | With measured model config, capture generation/review/choice/choice-verifier calls, token in/out, duration, billed or estimated price per call, total and failure/retry distribution; no fabricated model quality conclusion from mocks. |
| D01 | P2 | I | Additive v13→new schema opens old data intact, no accidental reader sessions or authoring edits. |
| D02 | P2 | I | Two same-Work sessions store contradictory confirmed facts independently; foreign-session turn parent or wrong Work is rejected. |
| D03 | P2 | I | Fork from published turn N: parent immutable, child inherits exact prefix through N, nested forks acyclic and deduplicated. |
| D04 | P2 | U | Published turn text/hash, choice key/order/kind and committed receipt cannot be edited or disabled after commit. |
| D05 | P2 | I | Deleting referenced ancestor cannot leave dangling turn/fork/choice/decision pointers; safe archive/cascade policy. |
| D06 | P2 | I | New backup export/import with nested fork, opening, decisions and receipts restores every FK; missing required parent aborts restore atomically. |
| D07 | P2 | I | Importer resolves nullable `headTurnId`/`forkTurnId`↔`sessionId` cycle and parentSessionId self-tree without dropping required records; if metadata alone fails, provide tested minimal importer extension. |
| D08 | P2 | I | Canon baseline source capture is consistent, confirmed-only, includes required World/Work intent, is content-addressed, fork-identical and immutable after live edits. |
| D09 | P2 | I | Baseline incomplete, missing or above configured hard snapshot cap fails creation/preflight, never silently truncates Canon. |
| C01 | P3 | U | Ancestor cutoff at N excludes parent N+1..N+3, sibling paths and foreign-work records even when Work IDs coincide. |
| C02 | P3 | I | Two sibling sessions with contradictory facts produce different reader context packets, not Work-wide fallback. |
| C03 | P3 | I | Only `confirmed` reader fact/knowledge with exact published-turn quote/hash and valid lineage enters context; candidate/retracted/missing-confirmation rows excluded. |
| C04 | P3 | I | Fact/knowledge provenance conflict or false rule override never becomes active confirmed context; idempotent supersession/retraction. |
| C05 | P3 | I | Missing or tampered pinned baseline blocks **before any** generation, V3 or choice model call; no candidate. |
| C06 | P3 | I | Live author edits after session start do not change the pinned reader packet; no implicit migration. |
| C07 | P3 | I | Generation, V3 review/revision and choice generation use the same base Gateway assembly/manifest; no alternate Work/CANON read. |
| C08 | P3 | I | Reader source/provider cache keyed only by Work fails isolation test; session + baseline + lineage + policy cache prevents cross-session hits, including cross-tab mutation. |
| C09 | P3 | U | Retrieval chunk with correct session ID but unreachable `sourceTurnId` is excluded; malformed source text/hash rejected. |
| C10 | P3 | I | Mandatory baseline or decision continuity omitted by context budget fails before model; optional trimming produces recorded omission. |
| C11 | P3 | I | Pending summary, full exact published path+decisions fits input window: generation allowed from verified text. |
| C12 | P3 | I | Compression required: ready summary covers verified contiguous prefix + exact suffix; absent/stale/failed summary blocks, never Work fallback. |
| C13 | P3 | U | Parent summary extends beyond child fork cutoff: reject; safe shorter prefix may be reused only with matching provenance and summary policy. |
| C14 | P3 | I | Postcommit memory saga failure followed by refresh/recovery cannot duplicate facts or alter published text. |
| V01 | P4 | I | V3 pass without revision binds original approved prose hash and starts choices **once afterward**. |
| V02 | P4 | I | V3 revises actors/scene/event: final prose hash changes; choices only from revised prose, never original options. |
| V03 | P4 | I | V3 blocking verdict, fake quoted evidence, malformed review artifact or failed deterministic revision: zero choice calls and zero publication eligibility. |
| V04 | P4 | I | Choice `sourceQuote` must exist verbatim in final prose; false quote rejects branch. |
| V05 | P4 | I | Quote genuine but choice contradicts scene: read-only choice coherence verifier blocks/rejects, evidence anchored to frozen prose. |
| V06 | P4 | I | All model branches invalid or choice-stage retries exhausted: exactly one Continue choice **if legal**; otherwise failed turn with evidence, no commit. A choice retry never regenerates frozen prose. |
| V07 | P4 | U | Invalid/missing `sceneHints` are omitted without vetoing valid prose/choices. |
| V08 | P4 | I | Reader caller attempting existing chapter-only formal entry is denied; valid registered reader entries respect frozen skill, task, caller and budget rules. |
| V09 | P4 | I | Provider failure/reviewer unavailable/budget exhaustion leaves durable failed attempt, no unverified pass or publication. |
| V10 | P4 | I | Reviewer and generator on same model record correlated-judge evidence; no false independence label. |
| V11 | P4 | I | Vietnamese reader generation passes language contract while existing ChapterEditor remains Chinese-guarded and unchanged. |
| V12 | P4 | I | Restored generation/review run with altered source snapshot, lineage or manifest hash is stale, no reuse. |
| V13 | P4 | I | Real provider smoke run exercises review/revise callbacks and evidence path, with token/cost/latency measured; mock-only tests do not satisfy this check. |
| P01 | P5 | I | Opening is atomic turn+choices+head+receipt with **no decision**; same request replay returns same outcome, second distinct opening rejected. |
| P02 | P5 | I | Published turn with zero valid branches has a real numeric `kind:'continue'` choice, selectable through ordinary decision flow, no forced ending. |
| P03 | P5 | I | Two different request keys from same head may both generate; exactly one commit CAS success, loser stale forever and no partial records. |
| P04 | P5 | I | Force `adopt(readerChoices)` short write after a turn write; outer transaction rolls back all rows and head/receipt. |
| P05 | P5 | I | Force CAS skip after writes; transaction rolls back, including receipt; resolved Promise is not success. |
| P06 | P5 | I | Commit succeeds then response drops: same key + same payload returns **same** receipt, no extra model call/turn. |
| P07 | P5 | I | Same request key with altered intent fingerprint conflicts and never replays a different committed result. |
| P08 | P5 | I | Session source choice not head/unreachable even if same Work: reject before model and recheck inside transaction. |
| P09 | P5 | I | Candidate from old revision/lineage after head advance or fork cannot publish; no stale candidate reuse. |
| P10 | P5 | I | Fail any FK, adoption result validation or receipt write: no half-commit turn/choice/decision/progress; committed receipt cannot point at absent turn. |
| P11 | P5 | I | Refresh during generation, review, post-V3 choice step or uncertain commit result recovers correct status without showing candidate as published. |
| P12 | P5 | I | After publication memory/retrieval saga may be partial; turn persists and continuation obeys C11/C12 full-text-or-summary readiness. |
| P13 | P5 | E | Browser refresh/restoration recovers session head, selected decision, published prose/choices and receipt exactly. |

**E2E ownership note:** P5's `P13` tests the persistence/publication seam with a minimal harness; full user-facing mobile reader, visual stage, long-run multi-session, release CI and GitHub Pages/APK presentation remain P6/P7.

## 4. Budget, D2 and D10 acceptance gates

The **worst-case planned reader AI call topology without whole-turn retries** is:

| Operation | Max calls in one normal reader attempt | Evidence / cost metrics |
| --- | ---: | --- |
| Reader prose generation | 1 | Input/output tokens, latency, provider/model, response status |
| V3 initial review | 1 | Input/output tokens, latency, blocking/uncertain evidence |
| V3 directed revision | 1 when permitted | Input/output tokens, latency, changed prose hash |
| V3 rereview | 1 when revised | Input/output tokens, latency, final verdict |
| Choices from frozen final prose | 1 | Input/output tokens, latency, choice count and rejected fraction |
| Read-only choice-coherence check | 1 | Input/output tokens, latency, rejected choices/evidence |
| **Worst case** | **6** | Sum plus actual billing/estimated cost and p50/p95 latency |

This is a **topology count**, not a fixed per-turn budget or upper bound including D2 retries. No-revision path uses fewer calls. Every whole-turn retry and each bounded choice-only retry increments total calls, tokens, elapsed time and cost; the request contract must enforce separate limits and show exhausted reasons. Additional Gateway planning calls, if activated by a Skill, count in full end-to-end cost, not invisibly outside the dashboard. Never assert `maxModelCalls:4` from existing chapter V3 applies to the reader total.

**P1 precondition (signed D10): Nguyen approves the six-dimensional blind-rating threshold rubric and all pass/fail cutoffs BEFORE the evaluation is run or its results are used for acceptance.** The six dimensions currently recorded by the StoryForge questionnaire are immersion, causality, payoff, voice, pace and continuity. Publish rubric version, blind pairing/randomization, sample selection, rater instructions, critical Canon error criteria and token/latency/cost ceilings before opening results. If Nguyen has not approved cutoffs, P1 can prepare harness and dry-run mechanics, but **cannot claim literary quality acceptance**. Do not set post-hoc cutoffs to make measured results pass.

P1 records a 20-turn baseline, six scores, confidence/dispersion, continuity failures, provider/model settings, per-call and per-turn input/output tokens, p50/p95 elapsed times, costs and reviewer/choice-verifier false-positive observations. P4 repeats measurements with the final reader durable pipeline using the **same instrumentation**. If cost or latency exceeds the approved ceiling, adjust context selection/prompt policy or obtain explicit Nguyen approval; do not silently weaken V3, choice checks, baseline or publication invariants. D2 choice-stage and whole-turn retry numerical limits remain configurable and set only from P1 evidence.

## 5. Remaining implementation proofs, each with owner and stop rule

| Proof / dependency | Owning stage | Evidence to produce, and decision if unsupported |
| --- | --- | --- |
| Nullable import cycle: `headTurnId`/`forkTurnId` to turns, turn/decision/receipt reverse references, nested session self-tree | **P2** | Fake-IndexedDB export/import plus missing-FK negative test. If `deferImport` metadata insufficient, minimal backward-compatible importer enhancement with full tests, not silent ref loss. |
| Registered reader sources can be selected through `CONTEXT_SOURCES` without Work-wide source fallback | **P3** | Captured selected/omitted source keys and adversarial sibling test. If selector lacks a strict denylist policy, add reader-specific policy enforcement while preserving authoring. |
| Reader identity in Context Gateway manifests/packet/provider calls | **P3** | Immutable session/baseline/lineage fingerprint survives catalog, cache, frozen source packet, durable resume and verification. If `FrozenResourceScopeV1` cannot encode it, add explicitly versioned reader discriminator; never overload `chapterId`. |
| Consistent snapshot capture including confirmed-only World and Work intent/style slice | **P2** | Mutate Work during capture in regression harness; snapshot either atomic version-consistent or capture fails/retries, never mixes revisions. |
| Hard size limit for full canonical snapshot and model context separation | **P1 parameterization / P2 enforcement** | Measure representative source sizes, Nguyen-approved/configured hard bound; fail closed if mandatory source exceeds bound. Context selection may omit *optional prompt material*, never mutate baseline snapshot content. |
| Reader Skill/formal-entry permission binding is supported without leaking chapter rights | **P4** | Registry parser, Skill read/write authority, frozen entry caller/category/budget and rejection tests; if new task kind needed, extend registered policy and tests explicitly. |
| V3 reviewer/reviser real-client callbacks and reader evidence binding are compatible | **P4** | Provider-backed smoke test plus mock forged-evidence tests; implement reader durable wrapper without dummy chapter IDs. |
| Cross-table ambient `adopt()` + CAS truly rolls back on short writes and skips | **P5** | Transaction integration tests P04/P05/P10 under IndexedDB; if runtime violates expected nesting, implement a registry-governed transaction primitive rather than claiming atomicity. |
| Finite retry count/budget and reader literary thresholds | **P1 decision gate / P4 enforcement** | Signed D10 rubric/ceilings before literary assessment; observed retry/cost curve sets D2 values. No invented default. |

## 6. Cross-document supersession and final invariants

This section is normative for implementation when earlier provisional fields or wording differ:

1. **P0.1 → P0.2:** `readerChoices.kind:'branch'|'continue'` is required, `disabled` is removed, `readerTurns.publicationRunId` is removed, `readerPublicationRuns.requestFingerprint` is required. Opening has no decision. Continue is a persisted choice with numeric ID; no sentinel.
2. **P0.2 → P0.3:** Generation produces **prose only**. V3 passes/revises and freezes final prose **before** a separately governed choice-generation and read-only choice-consistency step; a raw `{prose,choices}` AI response is not the public contract. Choice retries never regenerate prose; exhausted choices fall back to a legal Continue or fail the whole turn. Bad/missing scene hints are non-blocking.
3. **P0.1/P0.2 → P0.4:** Canon baseline is an immutable **verified snapshot inside readerSessions**, not a mutable WorldRelease pointer; readerMemory gains `lineageFingerprint` and `summaryPolicyVersion`. Continuity readiness is satisfied by verified **full published history + decisions when within budget**, otherwise a verified ready summary for an exact prefix + full suffix is mandatory. This is not a bypass of missing history.
4. **Publication invariant unchanged:** one outer Dexie transaction atomically writes turn, choices, decision (except opening), session CAS and publication receipt; memory/retrieval after commit may be recoverable saga. The existing `adopt()` is single-target; skip is not success.
5. **Concurrency invariant unchanged:** optimistic competing candidates can consume tokens; at most one wins CAS and every losing candidate becomes permanently stale.
6. **Isolation invariant unchanged:** parent locator proves Work ownership but **does not prove sibling-session isolation**. Every reader context and retrieval read enforces effective ancestry cutoff and confirmed-only provenance; no Work-wide fallback.
7. **V3 compatibility invariant unchanged:** the pure semantic cycle is reusable, the chapter-bound durable wrapper is not a reader API. No fake `chapterId`; no editor changes.
8. **Governance invariant unchanged:** D1–D10 signed, no reset of player saves, no auto-merge PR #1/#2, no hidden provider or unregistered AI write path.

## 7. P0 deliverable and PR state

P0 delivers exactly these five documents and an ordered, evidence-linked implementation plan. **P0 does not** modify runtime/editor code, migrate IndexedDB, call a paid model, set unapproved numerical D10 quality thresholds, implement P1–P5, build Android APK, run production end-to-end, merge PR #1, or merge its own PR #2.

After writing and reconciling documentation, perform **one final P0 consistency/diff check**: five files present; revised terms in Sections 1–6 agree; source-only diff restricted to `docs/p0/`; PR #2 base remains `feat/import-storyforge-longform`, branch `docs/p0-reader-contracts`, Draft/open/unmerged. Record exact commit and any missing runtime verification honestly. Do not claim CI is green unless CI actually ran.

**Next authorization point:** Muse reviews P0.5 and Nguyen chooses when to merge. P1 implementation begins only under the next assignment, using the D10 preapproval gate.
