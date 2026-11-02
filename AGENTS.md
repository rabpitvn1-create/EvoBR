# EvoBR Long Form

This repository imports StoryForge Long Form at the exact revision recorded in
`UPSTREAM.md`. Read that file and `docs/IMPORT.md` before changing boundaries.
The upstream engineering instructions and product contract are preserved in
`docs/upstream/` as provenance, rather than as instructions to restore excluded products.

## Boundaries

* Work owns the novel; World owns its settings and characters; Project is the workspace shell.
* `CONTEXT_SOURCES` and `assembleContext()` govern AI reads and Context Gateway evidence.
* `FIELD_REGISTRY`, AdoptionSchema and `adopt()` govern candidate adoption.
* `PROJECT_TABLES` governs export, import, deletion, ownership and reference remapping.
* Formal generation uses the existing Skills, Run Contracts and durable Harness.
* Unaccepted candidates never become Canon. Keep author confirmation, stale checks,
  versioned receipts, bounded retries and unknown-response handling intact.
* Do not reintroduce the independent game/adaptation products, quests, forced endings,
  fixed novel chapter limits, sample-game assets or a second writing backend.
* Backrooms, Snapshot selection, Game Master and combat are future work.

## Verification

Use Node.js 24 and `npm ci`. Before delivery, run `npm run ci`,
`npm run ci:e2e` and `git diff --check`. Browser tests use a frozen source snapshot
and isolated IndexedDB. Model HTTP is mocked in tests; production retains the real adapter.
Changes to the tool catalog require a new version and its computed fingerprint in
`src/lib/agent/execution-binding.ts`, verified by the profile regression test.

Update the registries before adding a table, context source or AI-writable field.
Exercise both successful and failing restore/adoption paths. Never expose credentials.
Use a feature branch, create a PR and leave merging to the repository owner.
