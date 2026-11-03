# P0.2 Reader Publication Contract v1.0

Status: design contract for Muse review; no executable reader runtime is implemented. Depends on [P0.1](./01-reader-data-contract.md). Nguyen approved D1-D10. This contract specifies *what* P4/P5 must enforce, not a claim that existing chapter adoption already supports reader publication.

## 0. Code-grounded boundaries

- `src/lib/registry/adopt.ts:64`: `adopt(input)` takes one `target`. `replaceAdoptedCollection` (`:157-197`) demonstrates ambient caller-owned Dexie transaction, rollback on short `written` result. CAS variants compare field hashes and can **skip**, so a caller must inspect return values rather than treating resolved promises as committed.
- `src/lib/registry/adoption-schema.ts`, `field-registry.ts`, `project-tables.ts`: target/field/type, collection identity/FK, and project/domain ownership must be registered. Model-supplied owner IDs are not trusted.
- `src/lib/agent/run/prose-generation-durable.ts`: generation persists candidate and evidence; chapter commit assumes author confirmation and writes `chapters`. Do **not** call `commitProseGenerationAdoptionV1` for a reader turn as if it were target-neutral.
- `src/lib/agent/run/prose-semantic-durable.ts` and `prose-semantic-review.ts`: existing V3 semantic cycle is real, with injected `review`/`revise` callbacks and hashed review artifacts. The editor's production caller currently passes `semanticReview:false`; toggling it alone breaks adoption because there is no production prose review executor wiring (evidence V3 trace).
- `src/lib/workspace/scope.ts:97-99`: `scopeTransactionTables` adds project/world/work tables needed by scope checks. Readers must include further FK targets in the outer transaction.
- Chapter post-adoption durable workflow is an event-ledger saga, not a multi-target atomic publication. Reader auxiliary memory may adopt a recovery saga *after* the atomic publication.

## 1. One turn, one deterministic public result

A reader request is a typed immutable intent:

```ts
type ReaderTurnIntentV1 =
  | { kind: 'opening'; sessionId: number; requestKey: string; expectedRevision: number }
  | { kind: 'choice'; sessionId: number; sourceTurnId: number; choiceId: number; requestKey: string; expectedRevision: number };
```

Additional trusted metadata: project/work scope, Canon baseline ref/hash, input fingerprint and expected head. These are resolved by the coordinator from storage, not accepted from AI text. `requestKey` is generated before the model call and reused exactly on network retry; the same key with different intent fingerprint is an error.

**Opening exception (D6 is not an opening):** `kind:'opening'` requires a new, empty session with `headTurnId:null`, `revision:0`, no `sourceTurnId` and no `readerDecisions` write. It atomically commits the opening `readerTurns`, any choices, session head/revision and `readerPublicationRuns` receipt. A second opening of a nonempty session is rejected except an idempotent replay of the same committed request.

**Continue decision (D6):** model output choices are encoded with an explicit `kind:'branch'|'continue'` field on `readerChoices`; `choiceKey` remains stable in its source turn. When no usable branch choices remain after validation, the publishing coordinator adds exactly one `kind:'continue'` choice with localized text `Đọc tiếp`. It has a real numeric choice ID and follows the normal `kind:'choice'` intent + `readerDecisions` path. No magic sentinel ID. Normal `continue` is not a forced ending, and publication cannot leave an active turn with zero usable choices. This updates the physical schema proposal in P0.1: add a required `kind` field to `readerChoices` and keep `status:'available'` only. A terminal/ending is not auto-inferred from the absence of choices.

To avoid a mutable choice status and protect D4, publication never disables or changes an already-published choice. An old choice may become non-actionable because its source turn is no longer the active head; this is runtime eligibility, not mutation of `readerChoices`.

## 2. Reader output contract

AI may propose a structured payload: `{ prose, choices, sceneHints? }`. `prose` is a nonempty complete Vietnamese narrative passage. `choices` is an ordered array of `{choiceKey,text,kind:'branch'}` (no AI-issued `continue` privileged action). Coordinator validates syntax, count/length caps and stable unique keys, then creates a trusted `continue` option only when zero eligible branch choices remain after validation, not merely when the raw array is empty. A structurally malformed root output fails closed; individually rejected branch entries are excluded from the published set. `sceneHints` is optional and non-authoritative. Exact limits belong to the P4 adapter policy and are versioned; not guessed in this specification.

The model cannot provide `sessionId`, table IDs, `status`, Canon authority, publication receipt or confirmed fact rows. All persisted `readerDecisions` and `readerPublicationRuns` fields are derived from trusted inputs and verified candidate artifacts.

No reader candidate is rendered as *published* before atomic commit. The stream may display a loading/progress indicator only in MVP.

## 3. Ordered pipeline and fail-closed controls

| Stage | Owner | Effect and failure rule |
| --- | --- | --- |
| A. Request lookup | Reader Coordinator (new) | Read committed receipt by `sessionId+requestKey` first. Same intent fingerprint replays committed result without model call; mismatch rejects. |
| B. Scope/lineage authorization | Reader Coordinator (new) | Validate session, Work, Canon baseline, source turn reachable in lineage and is head, chosen choice belongs to source turn; opening uses empty-session exception. |
| C. Readiness | Reader Context (new) | Reconstruct pinned Canon baseline **before any model request**; unavailable → stop generation. Verify required continuity memory ready. Only `confirmed` reader facts/knowledge on allowed lineage can be read. |
| D. Reservation and snapshot | Durable run + Reader Coordinator | Record attempt; freeze decision, revision, expected head, baseline, lineage, source provenance and context manifest. Distinct request keys from the same head may generate candidates concurrently (optimistic concurrency, no pre-generation head lease). Only commit-time CAS can select the winner; the losing candidate is stale conflict evidence and must never be reused to commit after the head advances. |
| E. Generation | Formal AI entry (existing), reader adapter (new) | Build Vietnamese messages and generate durable candidate. No writes to published reader tables. Output malformed/empty → not publishable. |
| F. Reader deterministic validation | New | Parse structured prose/choice output, reject extra owner/authority fields, invalid language/empty prose/duplicates, verify source choice contract and candidate text hash. |
| G. V3 semantic verification | Existing cycle + **new production wiring** | Run `runDurableProseSemanticReviewV1` with real injected review/revise callbacks, frozen reader packet and compatible information boundary. At most one local revision cycle. Revalidate structured payload and deterministic rules on the *final* revised output. `blocked` or evidence mismatch → no publication. |
| H. Precommit evidence | Publication Gate (new) | Verify final candidate/Gateway manifest hashes, V3 artifact/evidence, run/budget constraints and scope fingerprint. Reader-specific binding must not claim the chapter `commitProseGenerationAdoptionV1` is reusable unchanged. |
| I. Atomic commit | Reader Commit Coordinator (new) | In one Dexie transaction, re-read session head/revision/request key and lineage eligibility, CAS progress, write turn/choices/decision/receipt through registered targets; *any* skip/short write/conflict throws and rolls back. |
| J. Postcommit | Reader memory saga (new) | Start derived continuity/facts/retrieval settlement from the published turn. Partial states have named recovery and cannot rewrite published prose. Next generation waits for required memory readiness. |
| K. Reader presentation | Reader UI (P6) | Display only committed prose/choices read back by receipt. Retry/recovery is a reader-visible error, never a fabricated success. |

Precommit checks are insufficient for concurrency: Stage I MUST independently recheck head/revision and unique request identity within the same transaction. Model and review callbacks MUST execute outside it.

## 4. Atomic commit unit and ordering

Required atomic records: `readerTurns`, `readerChoices`, `readerDecisions` (except opening), `readerSessions` updated head/revision, `readerPublicationRuns` containing receipt. The transaction table set also includes FK check and scope target tables as necessary. The publication receipt is the source for committed idempotent replay.

Suggested commit choreography, to be validated against actual adoption results in P5:

1. Resolve runtime `WorkspaceScope` and precompute hashes **before** transaction; keep a consistent frozen request fingerprint.
2. Begin `db.transaction('rw', scopeTransactionTables(...reader tables, ...FK tables), async () => {...})`.
3. Re-read session and request key, fail on revision/head mismatch or conflicting replay. Check pinned baseline fingerprint is still resolvable and the source turn is eligible; no asynchronous network or dynamic import here.
4. Insert publication run/turn/choice/decision records through `adopt({target,...})` using registered schemas, respecting each generated numeric ID for later FKs. Because turn points to publicationRunId and receipt points back to turn, **break this cycle deliberately**: either delay nullable pointer patch within the transaction using registered record CAS or remove the redundant turn→run FK in P2. The P0 default is **remove `readerTurns.publicationRunId` as required FK**; receipt has `resultTurnId` and turn can be located by receipt. Documented in P0.1 as a proposed field, now superseded.
5. Validate `written` count and exact IDs/fields for each target. CAS `readerSessions` current head/revision via `record-fields-value-hash`; skip must throw. Receipt must contain final hashes, request fingerprint, source/head revision and committed IDs.
6. Return only after the outer transaction resolves. A crash after commit before network response is recovered by querying `readerPublicationRuns`; the client must not re-invoke model generation on identical retry.

**Atomicity nuance:** `adopt()` has single-target semantics and may silently skip an invalid row, so every target result requires explicit assertions. The ambient transaction sample `replaceAdoptedCollection` supports this technique but the exact cross-target CAS nesting still requires a P5 integration test; until that test passes, no claim of complete implementation atomicity.

## 5. Rejection, retry and recovery

| Reason | Public result | Durable state |
| --- | --- | --- |
| Missing baseline or not-ready memory | No model call; explain blocked state | No publish receipt |
| Unknown/unreachable choice; stale head or wrong session | Conflict; no model call if detected early | No publish receipt |
| Malformed generation/invalid Vietnamese or invalid choices | Reject candidate, bounded whole-turn retry if policy permits | Candidate failure evidence retained |
| V3 review blocks or fails parse/evidence | Reject candidate, bounded retry; never auto-accept | Review events retained |
| CAS skip, FK failure or incomplete adopt in transaction | Throw and rollback; retry with fresh state, not same candidate blindly | No committed publication receipt |
| Commit succeeded but response lost | Re-read receipt and return same committed result | Receipt is in same transaction as turn |
| Postcommit memory or retrieval failure | Published turn remains; record named partial memory state; block generation until required memory ready | Saga recovery evidence retained |

D2: retry budget is finite, configurable, and **no numeric default is prescribed until P1**. Each attempt has durable evidence. A retry of the same logical request after a recoverable transport problem must first look for receipt, then resume/resolve existing attempt when possible; a new model attempt is only allowed after establishing no commit.

Memory saga and retrieval indexing may be partial; the atomic publication unit may **not** be partial. Do not conflate V3 semantic acceptance with a literary quality score. Reviewer cannot overrule deterministic gate rules.

## 6. Implementation entrypoints and integration contract

| Code surface | P4/P5 change |
| --- | --- |
| `src/lib/ai/adapters/chapter-adapter.ts` / `src/lib/ai/adapters/prompt-guards.ts` | Extract/reuse suitable template/continuity principles; reader adapter enforces Vietnamese instead of `appendSimplifiedChineseOutputConstraint`. Do not modify editor authoring semantics. |
| `src/lib/agent/formal-ai-entry.ts` / `src/lib/ai/client.ts` | Preserve formal entry and provider transport; register reader usage according to existing registry policy. |
| `src/lib/agent/run/prose-generation-durable.ts` | Reuse generation/candidate event pattern, not chapter-specific adoption function. |
| `src/lib/agent/run/prose-semantic-durable.ts` | Wire injected real callbacks with frozen reader context. Precisely assess reader compatibility in P0.3 before P4 implementation. |
| `src/lib/registry/field-registry.ts`, `adoption-schema.ts`, `project-tables.ts` | Register reader fields/targets/owners before first write. Keep metadata/trusted-only fields out of model-controlled payload. |
| New `src/lib/reader/commit.ts` (proposed path) | Reader publication coordinator and atomic outer transaction. |
| New `src/lib/reader/publication.ts` (proposed path) | Typed intent, snapshot and publication gate; only reader module may authorize commit. |

Proposed paths are not claims of existing files. Existing authoring UI, manual confirmation and chapter post-adoption behavior remain untouched.

## 7. P5 acceptance and adversarial matrix

1. Opening creates turn + choices + receipt + head atomically with **no** decision. Repeated opening request replays receipt; different opening is rejected.
2. Empty branch-option output creates exactly one `kind:'continue'` choice, real numeric ID; clicking it follows normal choice/decision commit and does not end the work.
3. Existing published choice never transitions to disabled; a stale source turn is rejected by head/lineage rule.
4. Two simultaneous distinct requests from one session revision: exactly one committed head; other conflicts without leaked partial rows. Both candidates may consume model tokens; the loser is ineligible for any later commit.
5. After turn write, force choice adoption to skip: complete rollback including turn, session and receipt.
6. After all writes, force CAS skip: complete rollback.
7. After successful commit, simulate dropped response; retry same request returns *same* receipt with zero extra model calls.
8. Same request key but altered payload fingerprint: conflict; never replay wrong result.
9. Cross-session source turn not in ancestry, despite same Work: reject **before** model and at commit.
10. Missing Canon baseline: no model call and no candidate.
11. Candidate/retracted facts or knowledge: excluded from generation context.
12. Semantic V3 quote forgery, missing hash or final blocked verdict: no commit.
13. Memory settlement failure: turn remains committed, next generation blocked until required continuity ready; retry saga does not duplicate facts.
14. Refresh during any durable phase: no unauthorized visible published text and no duplicate receipt.
15. Imported/restored nested fork: parent lineage/choice/receipt references still resolve, otherwise restore rolls back.

## 8. Superseded/remaining P0 decisions

- This file supersedes P0.1's provisional `readerChoices` shape by adding required `kind:'branch'|'continue'`.
- This file supersedes P0.1's provisional required `readerTurns.publicationRunId` to remove an unnecessary circular FK. Receipt→turn is sufficient; exact physical schema must reflect this in P2.
- The `readerPublicationRuns` receipt must store the intent fingerprint; add a required `requestFingerprint` in the physical schema.
- P0.3 must prove the adaptation boundary for V3 semantic artifacts without a false `chapters` target. **Prose-choice coupling:** a revision can alter the scene and invalidate choices generated from the original prose. P0.3 must choose an enforceable strategy: review prose and choices together, independently review choices after revision, or generate choices only from final approved prose. Deterministic JSON validation alone cannot establish semantic alignment.
- P0.4 must choose Canon baseline snapshot representation, branch memory projection and source eligibility; no default to Work current-state is permitted.
- P0.5 must translate these contracts into an ordered file-level plan and tests, including deferred import pointer handling.

No production behavior is modified by this document.
