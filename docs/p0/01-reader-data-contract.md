# P0.1 Reader Data Contract v1.0

Status: proposed implementation contract, for Muse review. Product decisions D1-D10 approved by Nguyen. Source baseline: `feat/import-storyforge-longform` at imported StoryForge Long Form commit `704f4e1`. No runtime code is changed by this document.

## 0. Evidence and constraints

- `AGENTS.md`: Work owns novel, World owns settings/characters, Project owns workspace. Registries must precede new tables, fields and sources; do not alter author confirmation.
- `src/lib/db/schema.ts`: `STORYFORGE_DATABASE_NAME = 'evobr-longform'`, version 13; all existing writer tables are chapter/work scoped, with numeric `++id` keys.
- `src/lib/registry/project-tables.ts`: `PROJECT_TABLES` governs table lifecycle/ownership/export/remap. `narrativeModules` owned by work and `narrativeBeats`/ `narrativeChoices` use parent locator.
- `src/lib/registry/types.ts`: domain owner `parent` locator is available, separate from physical owner `project`; refs and exportRemap are distinct contracts.
- `src/lib/registry/adoption-schema.ts`: composite identity and FK checks exist. `src/lib/registry/adopt.ts`: one target per call; generic record hash CAS available.
- Evidence packs 1/2/adopt trace: no reader/session history, narrative blueprint passive; authoring chapter chain cannot represent alternative histories. Existing post-adoption writes chapter-owned memory.
- D1/D4/D5/D9: fork creates a new session, published turns immutable, Canon baseline pinned, MVP local IndexedDB.

The reader tables are new and must not write or migrate existing `chapters`, `temporalFacts`, `knowledgeLedger`, `narrativeSummaryNodes`, or `retrievalChunks` for reader events.

## 1. Identity and semantics

All `id` and FK fields below are numeric local Dexie keys. `requestKey`, `choiceKey`, `contentHash`, and `canonBaselineHash` are strings. Do not conflate DB IDs with portable export IDs. Each record has `projectId` for physical project ownership; child records also have `sessionId` for recursive domain ownership. A trusted coordinator, not model text, supplies owner IDs.

A **session** is one mutable head pointer and one immutable lineage. A **turn** is immutable once published; one selected decision from a source turn can produce one child turn in the active session. A **fork** creates another session with `parentSessionId` and `forkTurnId`; it references shared published ancestors and writes new turns only under the child session. Nested forks are permitted, subject to acyclic ancestry. The session's visible history comprises ancestor sessions truncated at each fork boundary, then its own turns through its head.

A turn belongs to its creation session permanently. A child session may refer to an ancestor turn via `parentTurnId`; this is a controlled cross-session FK that MUST be validated against lineage and fork boundary, not rejected solely for a different `sessionId`.

## 2. Nine tables (proposed logical record contracts)

Required fields include `id` after insertion, `projectId`, `createdAt`; `updatedAt` only for mutable projections. Nullable is explicit, not inferred from missing values.

| Table | Identity / indexed fields | Payload and invariants |
| --- | --- | --- |
| `readerSessions` | `++id`; `[projectId+workId]`, `parentSessionId`, `forkTurnId`, `[projectId+status]` | `workId`, `parentSessionId?:number|null`, `forkTurnId?:number|null`, `headTurnId?:number|null`, `revision:number`, `status:'active'|'paused'|'archived'`, `canonBaselineRef:string`, `canonBaselineHash:string`, `canonBaselineSnapshotJson:string`, `memoryReadyThroughTurnId?:number|null`. Snapshot JSON is immutable and hash-verified, captured at root session creation and inherited at fork (P0.4). Root has neither parent session nor fork turn; fork requires both and a verified reachable fork turn. Head cannot move backwards. |
| `readerTurns` | `++id`; `[sessionId+turnOrdinal]` unique, `[sessionId+parentTurnId]`, `contentHash` | `sessionId`, `parentTurnId?:number|null`, `turnOrdinal:number`, `content:string`, `contentHash:string`, `status:'published'`, `sceneHintsJson?:string|null`. The single status value is intentional: rows exist only after atomic publication; pending prose lives in durable candidates. Publication never edits text/hash; `turnOrdinal` is session-local, not global. |
| `readerChoices` | `++id`; `&[turnId+choiceKey]`, `sessionId`, `turnId` | `turnId:number`, `choiceKey:string`, `kind:'branch'|'continue'`, `text:string`, `order:number`, `status:'available'`; at most one deterministic `continue` action is allowed when no substantive choices are provided (D6). Choice is immutable after publication; there is no post-publication disable transition. A temporarily ineligible option is not emitted as a published choice. |
| `readerDecisions` | `++id`; `&[sessionId+requestKey]`, `sourceTurnId`, `choiceId`, `resultTurnId` | `requestKey:string`, `sourceTurnId:number`, `choiceId:number`, `resultTurnId:number`. Exactly one committed decision per request key; referenced choice must belong to the source turn and source must be the active head at commit time. |
| `readerFacts` | `++id`; `sessionId`, `originTurnId`, `[sessionId+status]` | `predicate:string`, `subjectRef:string`, `valueJson:string`, `evidenceQuote:string`, `originTurnId:number`, `status:'candidate'|'confirmed'|'retracted'`, `sourceHash:string`. Not Work Canon. Confirmed requires provenance from a published turn. |
| `readerKnowledge` | `++id`; `sessionId`, `characterId`, `originTurnId` | `knowledgeKey:string`, `statement:string`, `originTurnId:number`, `sourceQuote:string`, `status:'candidate'|'confirmed'|'retracted'`. Identity and supersession rules must prevent contradictory active assertions. |
| `readerMemory` | `++id`; `&[sessionId+throughTurnId]`, `[sessionId+status]` | `throughTurnId:number`, `summary:string`, `continuityJson:string`, `sourceTextHash:string`, `status:'ready'|'stale'|'failed'`, `lineageFingerprint:string`, `summaryPolicyVersion:string`, `processingRunId?:number|null`. Memory is only reusable for a verified effective-lineage prefix. A memory is derived, never Canon; ready only when its source hash matches the exact eligible lineage text. |
| `readerRetrievalChunks` | `++id`; `sessionId`, `sourceTurnId`, `[sessionId+sourceTurnId]` | `content:string`, `contentHash:string`, `sourceQuote:string`. Retrieval eligibility must be checked against effective lineage, not merely sessionId. |
| `readerPublicationRuns` | `++id`; `&[sessionId+requestKey]`, `runId`, `resultTurnId` | `requestKey:string`, `runId:number`, `candidateHash:string`, `requestFingerprint:string`, `contextManifestHash:string`, `semanticArtifactHash:string`, `expectedSessionRevision:number`, `resultTurnId:number`, `receiptJson:string`, `status:'committed'`. This is an atomic publication receipt, not the earlier durable candidate itself. |

**P0.2 refinement:** `readerTurns` does not store a required publicationRunId to avoid a turn-to-receipt FK cycle. `readerPublicationRuns.resultTurnId` is the authoritative publication link; `readerChoices.kind` is a real `branch|continue` action and `requestFingerprint` distinguishes same-key conflicts. See [P0.2](./02-reader-publication-contract.md).

**Reservation:** An attempt/pending candidate is held in the existing durable run ledger, not in an uncommitted `readerPublicationRuns` row. For recovery, distinguish durable attempt evidence from atomic publication receipt. `readerPublicationRuns` is written only on successful publication transaction.

**Opening turn:** A session's first text is an opening publication without `readerDecisions` (no prior choice). It still has a committed turn, choices, session head and publication receipt in one transaction. Later turns require a decision. This exception must be explicit in the publication contract.

## 3. Invariants and constraints

1. Exactly one current head per session, protected by CAS on `readerSessions.revision` and `headTurnId` within the same publication transaction. No competing successful commits from the same expected revision.
2. `readerTurns.content`, `contentHash`, `readerChoices`, `readerDecisions`, and committed publication receipts are append-only. No later editing or silent replacement (D4).
3. Source turn must be reachable in effective lineage and be the current head for a new decision. `readerDecisions.choiceId` points to a choice on exactly that source turn. On fork the first new turn may point to an ancestor source turn.
4. An idempotent `requestKey` is stable across retries of the *same* operation; a different payload with the same key is rejected, not replayed.
5. No reader facts, knowledge or retrieval item is loaded merely because it matches `workId`; it must have a published origin turn reachable within the effective lineage and not beyond any fork cutoff. Only `readerFacts` and `readerKnowledge` rows with `status:'confirmed'` may enter generation Context Gateway; `candidate` rows remain review-pipeline evidence only, and `retracted` rows must not be treated as active truths. A missing confirmation must fail closed, never be promoted implicitly.
6. The pinned Canon baseline must be reconstructable, not just hash-comparable. An unavailable baseline prevents **generation as well as publication**; no model call, candidate streaming, or silent switch to newest World/Work state is allowed (D5).
7. The next turn requires **verified continuity through the current head**. It may use the exact full published path plus decisions when they fit input budget, even while summary/indexing is pending; when compression is necessary, a ready summary covering an exact authorized prefix plus the remaining exact suffix is mandatory. Missing/stale summary then blocks generation. Auxiliary indexing may settle asynchronously with named partial states. See P0.4.
8. Deletes cannot remove ancestor turns referenced by descendant sessions; archive or controlled cascade of whole dependency tree is required. All remap pointers must be validated on restore.

## 4. Registry, lifecycle and migrations

- `src/lib/db/schema.ts`: add nine Dexie tables, `Table<T,number>` declarations and a new schema version (13 to 14, subject to inspecting the actual schema migration strategy before code). No destructive rewrite of DB name.
- `src/lib/registry/project-tables.ts`: add nine `TableSpec` records with `owner:'project'`. `readerSessions` uses `domainOwner` locator `{kind:'field',owner:'work',field:'workId'}`. Eight child tables use `{kind:'parent',owner:'work',table:'readerSessions',field:'sessionId'}`. Each has required `memoryClassification` and a deliberate `exportable` decision, provisionally true for all nine.
- `readerSessions.exportIdField:true`; export ID mapping for `workId`, `parentSessionId`, `forkTurnId`, `headTurnId` and cross-table FKs. Self-tree applies ONLY to `parentSessionId`, while `forkTurnId` references `readerTurns` and may require deferred import because sessions and turns create a cycle. Declare `deferImport:true` only for nullable refs supported by the existing importer.
- Register the child `sessionId` FK with `exportRemap:{field:'sessionId',remapVia:'readerSessions',exportAs:'_sessionExportId',onUnmapped:'require'}`. Each other FK needs its own remap and deletion policy; avoid pretending selfTree resolves cross-table cycles.
- Register relevant AI writable fields and adopted targets in `FIELD_REGISTRY` and `ADOPTION_SCHEMAS` before implementing writes. Identity, `duplicatePolicy`, `fkChecks`, `autoStamps`, and `replaceScope` must be specified per table. The publication coordinator is trusted for scope/receipt; never allow the model to send owner ID or mark its own narrative facts confirmed.
- `PROJECT_TABLES.refs` are reverse deletion references, not the child's forward FK. Configure them on the referenced parent table and separately configure export remap on the child.
- Migration is additive and leaves existing authoring tables intact. Old backup import must not invent reader sessions. New backup round trip must preserve nested fork and all reader FKs or fail closed and rollback.

**Import-cycle decision:** `readerSessions.headTurnId` and `forkTurnId` together with `readerTurns.sessionId` form a nontrivial reference cycle. This design requires deferred nullable pointer remapping (or equivalent two-pass restore) already represented in `ExportRemapField`. P0 must resolve the exact supported importer behavior before P2; do not mark this solved merely because `selfTree` exists.

## 5. Data contract acceptance matrix (P2 target)

| Test | Expected result |
| --- | --- |
| Two sessions, same Work, contradictory facts | Stored and queried independently |
| Fork at ancestor turn, then continue both sessions | Parent unchanged; child sees ancestors only to fork |
| Child turn references a parent turn in an unrelated session | Rejected, even when both sessions belong to the same Work |
| Candidate reader fact/knowledge referenced by a generation context | Excluded; only confirmed lineage-visible rows may be used |
| Canon baseline unavailable before generation | No model call and no candidate created |
| Nested forks | Stable lineage without cycles |
| Duplicate request key with same payload | Exactly one committed result |
| Duplicate request key with different payload | Conflict, no additional write |
| Two concurrent decisions from same head | Exactly one CAS success |
| Edit published turn/choice | Rejected |
| Missing/changed Canon baseline | Publication blocked |
| Delete ancestor with live descendant | No dangling pointers |
| Export/import nested fork and receipts | IDs remapped, all links preserved |
| Import missing required parent ref | Transaction rollback |
| Refresh/restart after publication | Same head, choices, decision and receipt |

## 6. Settled P0 contracts and implementation proofs remaining

- **Settled in P0.4:** MVP uses a versioned immutable reader-owned `canonBaselineSnapshotJson` (hash verified) on `readerSessions`, not a live WorldRelease locator. Work authoring intent must be explicitly included from approved source data. P2 verifies consistent capture, backup and size bounds.
- **P2 implementation proof (P0.5):** Verify the importer resolves BOTH `headTurnId` and `forkTurnId` deferred pointers, plus nested `parentSessionId` self-tree; fail closed or add a tested minimal importer extension.
- **Settled by P0.2:** the opening turn is an explicit `kind:'opening'` intent with no decision; `Đọc tiếp` is a real, persisted `kind:'continue'` choice with a numeric ID, never a sentinel. Continue is injected when validated branch choices are empty. Do not reopen these decisions in P0.5.
- **Settled at contract level in P0.4:** Only lineage-visible confirmed and evidenced rows become reader context; candidate/retracted rows remain excluded. Full exact continuity can substitute pending summaries when within budget; otherwise require verified summary prefix and exact suffix. P3 must implement confirmation/supersession and measurable budget policy.
- **P2/P4 implementation proof (P0.5):** Register exact permitted reader fields and Skill write targets, preserving coordinator-only scope/receipt/status authority. Never indiscriminately make metadata model-writable.

No runtime or editor behavior is changed in P0.1.
