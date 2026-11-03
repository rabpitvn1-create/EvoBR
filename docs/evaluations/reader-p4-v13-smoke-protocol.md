# P4 Reader V13: real-provider smoke handoff and acceptance

Status: **pending external real-provider execution by Muse**. The implementation is on PR #6; this document is not a passing test report.

## Production transport to exercise

Use the repository's **actual** `executeFrozenFormalAIEntryV1` through `src/lib/reader/model.ts`, which invokes `src/lib/ai/client.ts`. On a Node 24 browser environment with an already configured provider route, invoke `generateReaderTurnCandidateV1` on an isolated root `readerSession` from P2 with a verified P3 frozen Gateway packet. Do not replace transport with a fake or custom HTTP client. Apply the configured provider/model once per attempt. The model response must be real; the test fixture may supply the session and pinned baseline.

Run one pass case and, where the provider genuinely returns eligible blocking evidence, one review/revise/rereview callback case. Do not doctor the provider answer to claim a real revision. If that case is not naturally reached, report the review-only case and leave revision-smoke **unproven**. No Reader published turn or receipt should be written by this P4 harness: P5 owns publication.

## Evidence required before V13 may pass

1. Repository commit SHA, sessionId, expectedRevision, lineageFingerprint, pinned baseline hash and shared `contextManifestHash`, with sensitive content redacted.
2. Six-step topology log in exact order: Reader prose, V3 review, optional V3 revision, optional rereview, post-V3 choice generation, choice-consistency verification. Confirm **zero** choices before V3 passes.
3. Exact registered entry/Skill IDs, real provider name and model name as returned by provider when available, and frozen request settings, omitting keys, endpoint secrets and full prompts.
4. For each dispatched call: input/output usage **as reported by provider**, requestLifecycle, latency, error, retry count; report null for absent usage, and do not guess missing costs or prices.
5. Original and final prose hashes, semantic issue and revision artifact hashes, choice evidence hash, exact verified quote membership, correlatedJudge=true (same provider/model is **not** an independent judge), and negative evidence checks.
6. Confirm candidate remains uncommitted after generation and survives repeat artifact integrity verification. Verify an altered manifest/head is rejected.
7. If the real route is unavailable, record the actual transport error and mark V13 pending, rather than counting mocked CI as provider acceptance.

## Retry recommendation for Muse (D2)

Default **zero transport retries and zero choice-generation retries**. This is deliberately conservative because P1 had 0 errors in 80 real calls, a six-call normal reader topology, and a previously observed proxy timeout limit. The implementation accepts a configurable choice retry count 0..2 but enforces six overall model calls; remaining budget is the hard ceiling. Any nonzero retry default needs measured data and Muse approval; do not infer a 0% failure probability from 80 successes.

## CI boundary

V01–V12 and the V13 **setup/authorization** check in `tests/regression/R-READER-P4-generation-v3.test.ts` use deterministic mocked provider responses while keeping real Dexie, formal registries, frozen context and AgentRun events. They cannot, alone, satisfy V13.
