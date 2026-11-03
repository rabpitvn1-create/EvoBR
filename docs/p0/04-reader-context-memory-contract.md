# P0.4 Reader Context and Memory Contract v1.0

Status: architecture contract for Muse review. Depends on [P0.1](./01-reader-data-contract.md), [P0.2](./02-reader-publication-contract.md) and [P0.3](./03-v3-production-wiring.md). D1–D10 are signed by Nguyen. **No reader runtime is implemented by this document.**

## 0. The central correctness threat

A prompt-level instruction to "remember only this reader session" is **not** an isolation boundary. Existing StoryForge chapter and memory sources are indexed by project/World/Work/chapter, not an interactive session lineage. A reader must not call ordinary authoring `prepareProseGatewayAssemblyV1` and hope that `sessionId` in the prompt filters its existing Work-wide reads.

Verified repository anchors (branch `feat/import-storyforge-longform`):

- `src/lib/prose/gateway-context.ts`, `prepareProseGatewayAssemblyV1`: `readOwnedRows(... 'chapters'|'temporalFacts'|'knowledgeLedger'|'stateCards'|'itemLedger'|'storyTimelineEvents', { owner: 'work' })`; uses canonical outline/chapter ordering. This is an authoring pathway, **not** session-aware.
- `src/lib/registry/assemble-context.ts:137+`: `assembleContext` resolves project/world/work scope, selects `CONTEXT_SOURCES`, reads them, handles budgets and source hashes. `prepareContinuityContext` is entered for chapter-specific sources when `chapterId` is supplied.
- `src/lib/registry/context-sources.ts`: `worldRelease` is protected L0 but has `enabled:() => false` by default and is only opened via a frozen resource session. `writtenChapters`, `previousChapterEnding`, `chapterContinuityHandoff`, `recentChapterSummaries`, `characterKnowledge`, `currentFacts`, `retrievedPassages`, `ragSelection` and `searchResults` are not proven reader-lineage-aware.
- `src/lib/ai/chapter-memory/run-chapter-memory.ts`: writes chapter summary/handoff through `adopt({target:'chapters', compareAndSet:{kind:'chapter-source-text-hash',...}})`. Do not use as reader memory writer.
- `src/lib/context-gateway/canon-provider.ts` uses `PROJECT_TABLES` resource projections and scope/hash verification; `src/lib/context-gateway/provider-cache.ts` keys cache requests using `scope` and provider request identity and invalidates on Dexie mutations. A session identifier that is **not present** in the request identity does not magically partition this cache.
- `src/lib/world-engine/releases.ts` has immutable/canonical release hashing and filtered confirmed semantic rows; it is a plausible source of baseline mechanisms, but a release of World semantics is **not yet proven** to include every Work authoring-intent field required by the reader.
- `src/lib/context-gateway/attempt-evidence.ts` binds context packet, source refs, manifest and hashes to durable run evidence. Reader must reuse these invariants instead of inventing an evidence-free prompt string.

## 1. Immutable reader baseline (D5): MVP decision

**Choose a reader-owned immutable snapshot of the exact permitted World/Work baseline**, not a live pointer to the current Work. The snapshot is captured at **root session creation**, before any first generation. A fork inherits the *same exact bytes/hash* from its parent baseline. If the baseline does not exist or fails verification, opening/next-turn generation is rejected before model calls.

To honor the agreed **nine-table model** without depending on unproven availability/retention of `worldReleases`, add `readerSessions.canonBaselineSnapshotJson:string` to the P0.1 table contract, alongside its existing `canonBaselineRef` and `canonBaselineHash`. This field contains canonical serialized, versioned, *confirmed-only* baseline content, **not a mutable Work resource locator**. `canonBaselineRef` is a portable content-addressed identity derived from the snapshot hash/version; the hash is validated against the exact stored JSON on every reader preflight. Snapshot fields are trusted coordinator-owned and immutable for the lifetime of the session. Fork may duplicate the snapshot (MVP storage cost) to guarantee standalone export/restore of sessions. Future deduplication requires its own migration/retention contract.

Snapshot contents:
- selected authoritative World resources: world rules, confirmed characters/relations, setting, geography, story core and relevant constraints;
- confirmed Work-level creative intent/style/rules needed for reader, including the signed language policy; only author-approved authoritative records, not model candidate or unconfirmed author drafts;
- provenance for every row/field: source table, stable portable identity, revision/content hash, selection policy version, authority tier and confirmation status where applicable;
- baseline schema version and Work identity; no source chapter narrative memory, runtime reader facts, unconfirmed knowledge or leaked private metadata.

**Important:** build the snapshot from a single consistent source view and explicit allowlist derived from registered Canon resources. Do not assume `WorldRelease` in itself covers the entire Work style/intent. At P2 implementation, either compose verified frozen release content with a separately frozen author-intent slice or capture one consistent registered resource snapshot. When producing the snapshot, resolve all required originals first and fail closed if any mandatory resource is absent/ambiguous or the snapshot exceeds the configured hard limit. Do not silently trim Canon to fit a model budget; instead choose task-relevant extracts with explicit selection/truncation evidence while the source snapshot remains complete.

**Editorial evolution:** changes to live World/Work do not affect existing sessions. If Nguyen ever authorizes a new baseline, it creates a new history/session explicitly; no silent rewrite of a signed D5 session.

## 2. Scope and effective lineage

Define one trusted `ReaderContextScopeV1` for each operation (proposed, not an existing type):

```ts
type ReaderContextScopeV1 = {
  projectId: number; worldId: number; workId: number;
  sessionId: number; headTurnId: number | null; expectedRevision: number;
  canonBaselineHash: string;
  lineageFingerprint: string;
  selectionPolicyVersion: string;
};
```

`lineageFingerprint` is computed over the **ordered effective ancestry with fork cutoffs**, the visible published turn IDs/content hashes, and the session head/revision. It is never accepted from model text. Build the effective visible turn chain by walking parent sessions (reject cyclic/foreign-Work ancestors), truncating at each `forkTurnId`, then appending this session's published path. A turn in another session is eligible **only** when its creation session appears on that chain and it is on/before its allowed cutoff; a sibling session or a later parent turn is forbidden even if it shares `workId`.

A fork's first new turn may legitimately use an ancestor turn as its parent. Check lineage against the declared fork boundary, not simplistic equality of `readerTurns.sessionId`. All facts, knowledge, summaries and retrieval chunks likewise require origin-turn reachability.

The existing `WorkspaceScope` stays unchanged for World/Work registry ownership. `ReaderContextScopeV1` is a **strict additional reader policy** enforced by new reader source readers and context authorization. Do not force `sessionId` into `WorkspaceScope` or claim parent-locator alone enforces lineage. Parent locator proves Work ownership, **not** sibling isolation.

## 3. One frozen context packet, not a second truth

The reader context coordinator resolves baseline and effective lineage, then creates an immutable source snapshot and uses the **registered Context Gateway mechanisms** to assemble one packet and source evidence for the attempt.

Required invariants:

1. A *single* session-scoped Gateway assembly is constructed per reader attempt; its content, source hashes and `contextManifestHash` are frozen in the durable candidate.
2. Prose generation and the V3 semantic-review/revision/rereview path receive this **same assembly**. They may build different task prompts and declare different capability subsets, but may not independently re-read live World/Work or silently pick a second universe. If a second review step requires more facts, reject/restart the attempt with a new frozen assembly rather than mutate the packet mid-run.
3. Choice generation and choice-consistency verification use the **same original assembly** plus a separately frozen `finalProseHash` and selected decision. No untracked Work-wide retrieval or new mutable context read is allowed.
4. The packet carries `ReaderContextScopeV1`, baseline hash, lineage fingerprint, selected/omitted resources, source provenance and policy/budget decisions. Verify them on candidate persistence and again before commit. A changed session head/revision becomes a stale candidate; a change in the live authoring Work does **not** mutate an intentionally pinned baseline.
5. Mandatory scope, baseline and continuity anchors cannot be dropped by the context token budget. An omission of a required anchor must fail before model calls. Optional resources may be trimmed with omission evidence; original authoritative snapshot remains intact.
6. Every reader-capable resource lookup, including any bounded additional tool read, must check the reader lineage and immutable baseline. If that cannot be enforced through the existing resource provider's scope contract, do not register it as reader-readable until adapted.

**Implementation boundary:** `src/lib/registry/context-sources.ts` registers new reader sources; `src/lib/registry/assemble-context.ts` can remain the common assembly entry with a reader-specific adapter supplying registered, prevalidated sources. `src/lib/context-gateway/selector.ts` and the existing provider may be reused **only with enforced reader policy**. The exact adapter file path is for P0.5. Do not add a second free-form context constructor as an unrestricted fallback.

## 4. Explicit source eligibility

| Category | Reader generation policy |
| --- | --- |
| Pinned World/Work facts and rules | From **verified baseline snapshot only**; protected mandatory entries; no live mutation. |
| Work style and author intent | From the same immutable baseline slice; read-only. |
| Published reader prose | Exact effective lineage through the active head, with source turn IDs/hashes. |
| Reader decision history | Exact selected decisions on the effective path, including the triggering choice; not alternative sibling decisions. |
| `readerFacts` / `readerKnowledge` | Only `status:'confirmed'`, valid origin in lineage, evidence quote present in authorized published source text, no active superseding/retracted contradiction. Candidate/retracted rows are excluded and must never be promoted by context code. |
| `readerMemory` | `ready` only, `throughTurnId` reachable on path and `sourceTextHash` verified against the exact eligible source window and policy version. |
| `readerRetrievalChunks` | Eligible published `sourceTurnId` on path, hash matches source text and cache/request is session+lineage partitioned. |
| Work chapter sources: `writtenChapters`, `previousChapterEnding`, `recentChapterSummaries`, `chapterContinuityHandoff` | **Forbidden as live reader memory**. If author-approved authored passages are deliberately part of the frozen premise, include the approved excerpt in the baseline, not live chapter memory. |
| Work-wide `currentFacts`, `characterKnowledge`, `retrievedPassages`, `stateCards`, `itemLedger`, `storyTimeline` | **Forbidden live** in reader generation. Replace with approved baseline plus reader source counterparts. |
| `ragSelection` or `searchResults` | Do not enable the ordinary authoring/workspace reader path for reader. Any future reader RAG capability must be explicitly scoped and evidence-tested. |
| `activeNarrativeBlueprint` / node-authoring plan | Not a reader runtime or automatic choice source. May be included in baseline only if explicitly approved as author intent, never as preauthored branch execution. |

A missing required reader source is an **error**, never permission to fall back to Work-wide data. This applies to generation, V3, choice generation and post-adoption memory extraction.

## 5. Reader memory readiness and post-publication saga

A committed turn is immutable immediately after the P5 atomic transaction. Its memory projection is **derived**, and permitted to settle later through a durable saga with named partial outcomes. No reader postprocessor may call `runChapterMemoryTask` on a fabricated chapter or write the reader event into Work-owned `chapters`, `temporalFacts`, `knowledgeLedger` or `retrievalChunks`.

### Readiness rule

**Minimal mandatory continuity** for the next attempt is: the full published turn text and selected-decision history through the active head, both verified by hash and reachable in effective lineage. These are already committed together by P5, so they form the deterministic emergency floor; a model-derived summary is an optional *acceleration*, not the sole source of truth.

If the full eligible continuity fits in the model budget, the reader may proceed even if derived summary/retrieval sagas are pending. If it cannot fit, a `readerMemory.status:'ready'` summary that covers a **verified contiguous prefix** of the effective lineage is required, plus exact uncompressed recent turns and choice history after that prefix. Missing/stale/failed summary then blocks next generation; do **not** substitute a summary from a sibling or live Work. This clarifies P0.1's `memoryReadyThroughTurnId`: it is a **derived readiness marker**, not a blanket promise that every auxiliary task has completed. A canonical head-only full-text validation can be ready before derived memory settles.

Reader memory summaries must have a provenance window: session lineage hash/fingerprint, first/last effective turn, source content hashes, summarizer contract version and content hash. Existing P0.1 `sourceTextHash` alone is insufficient for forked paths; add `lineageFingerprint` and `summaryPolicyVersion` to the logical `readerMemory` contract, and `memoryReadyThroughTurnId` may advance only after the matching source window is verified. A session fork may reuse a parent summary **only** when its verified covered prefix lies entirely within the child's allowed ancestor prefix. Otherwise recalculate a child summary.

### Saga states

Proposed reader-specific states (NOT present in StoryForge): `reader_memory_pending`, `reader_memory_partial`, `reader_memory_failed`, `reader_memory_ready`. Failure of auxiliary facts/retrieval/consistency does not retract or overwrite the already-published turn. Recovery uses the publication receipt + verified source hash and idempotent task identity (`sessionId`, `turnId`, `taskKind`, `sourceHash`), not a second untracked adoption. If mandatory compressed continuity is unavailable when needed, block generation and expose a recoverable state; never silently bypass.

### Facts and knowledge promotion

Extraction produces `candidate` rows with `originTurnId`, exact sourceQuote/sourceHash and character identity. A **reader-specific confirmation policy** checks exact quote membership, trusted origin turn, conflict/supersession against active path and World baseline, and that the fact does not claim World authority. Only validated rows become `confirmed`. Conflicts/ambiguities remain candidate or become retracted, and therefore invisible to Context Gateway. Reader can create legitimate *new session facts* without changing pinned World Canon; false claims that override explicit world rules are rejected.

For reader continuity, an event explicitly present in committed prose remains a historical truth even before structured extraction, so source full text is the fallback. A candidate ledger record cannot become a shortcut to a new fact. Confirmation policy is a **new implementation requirement** for P3, not a claim that chapter's human-confirmation ledger can be reused unchanged.

## 6. Cache and isolation

The existing provider cache uses request scope/request identity and cross-tab Dexie invalidation, but this does **not** prove reader isolation when ordinary provider scope is only Work. Therefore:

- Reader resource identity or request must include `sessionId`, pinned baseline hash, effective lineage fingerprint, selection policy version and the relevant head/turn cutoff.
- Never cache reader results under only `workId`, `worldId`, `chapterId` or a caller-supplied free-form query.
- Before returning a cached reader resource, verify effective lineage, current source hash and baseline against the frozen request. A global invalidation event is helpful but **not** a substitute for proper partitioning.
- Export/import and multi-tab resume invalidate or rekey reader caches; no stale sibling state may be served.
- If existing `CANON_RESOURCE_PROVIDER_V1` cannot represent these session predicates, register a separate **reader-owned resource provider** through existing Gateway governance instead of broadening authoring Canon provider with unsafe defaults.

## 7. P3 acceptance matrix

| Case | Required result |
| --- | --- |
| Two siblings same Work, mutually contradictory confirmed facts | Each context only includes its own visible facts; no Work-level fallback |
| Child fork from turn N, parent advances to N+3 | Child sees parent through N only; turn N+1..N+3 excluded |
| Nested fork with shared ancestor | Exactly eligible prefix; no duplication or omissions |
| Cross-session turn from unrelated session | Source rejected even if Work ID matches |
| Candidate/retracted readerFact or readerKnowledge | Never appears in prose or V3 context |
| Missing confirmation/provenance or quote mismatch | Reader fact/knowledge unavailable; cannot be elevated by model |
| Pinned baseline missing/hash altered | **Zero** AI calls; no candidate |
| Live World/Work edits after session creation | Existing session keeps baseline exact; no automatic migration |
| No summary yet, full path fits verified budget | Can generate from full published text with complete continuity |
| Summary needed but stale/failed | Blocks generation; no Work summary fallback |
| Parent summary covers prefix beyond child fork | Rejected; recompute or use safe shorter prefix |
| V3/choice generator sees a different context manifest than prose generator | Fail closed; no publish |
| Reader resource cache intentionally keyed only by Work | Isolation contract test must fail |
| Retrieval chunk has valid session ID but source turn is outside lineage | Excluded |
| Context budget omits mandatory baseline or decision continuity | Reject before model calls |
| Failed memory settlement then resumed after refresh | No duplicate facts; published turn unchanged |
| Cross-tab session progress changes during generation | Candidate stale at commit; no reuse |

## 8. P0.5 implementation dependencies and unresolved verification

The selected **baseline representation** is now a trusted immutable snapshot carried by `readerSessions` for the MVP; schema and registry changes are scoped to P2. This avoids assuming a World revision contains all Work author intent. P2 must still verify importer compatibility and decide snapshot size/retention limits, never silent truncation.

The following are implementation proofs, not product ambiguities:
1. Validate that a reader-specific `AssembleContextInput` adapter can enforce reader sources through existing `CONTEXT_SOURCES` without accidentally selecting Work sources; register exact source keys in P3.
2. Verify the `Context Gateway` tool-session/provider binding and manifest evidence can carry `ReaderContextScopeV1` without changing authoring behavior; otherwise add a backward-compatible reader scope discriminator.
3. Implement and test portable remapping for `readerSessions.headTurnId`/`forkTurnId` and the self-tree import cycle per P0.1.
4. Confirm strict capture of a consistent baseline resource snapshot and protect it against mutation and oversized input, including its Work style slice.
5. Define versioned prompt budgets and conditional memory summarization thresholds from P1 measurements; no guessed numeric token threshold is approved by this document.

No runtime or editor files were changed by this P0 document.
