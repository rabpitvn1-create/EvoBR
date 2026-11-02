# Verification of the initial Long Form import

Source: `yuanbw2025/storyforge@9b4cb04be0605f51520fe8fa34eb4e94c2204cd3`.

## Local evidence

| Command or gate | Observed result |
| --- | --- |
| `npm ci --no-audit --no-fund` | Passed, 383 installed packages after dependency pruning. |
| `npm run ci` | Exit 0. Includes architecture, dependency graph, AI entry, required tables, generated AI manual, TypeScript, Codex bridge, regression and production build. |
| `check:dependencies` | 845 reachable files and 27 runtime packages; no orphan retained source. |
| `check:required-tables` | All 72 schema tables match the required table contract. |
| `check:ai-entry-registry` | 31 bindings, 37 call sites; 16 formal, 14 auxiliary and 1 experimental binding. |
| `test:codex-bridge` | 29 tests passed. |
| Browser upstream Long Form suite | 77 passed in the final local run. |
| EvoBR browser startup/reload test | 1 passed; no page errors; workspace screenshot inspected. |
| `git diff --cached --check` | Passed. |

The browser tests use real React screens, stores, IndexedDB, adapters, Harness,
request serialization and adoption. Only provider HTTP responses are intercepted.
No paid provider or literary-quality claim is made. Chromium 153 was supplied
externally for the local sandbox after the Playwright download mirror was unavailable;
it is not an EvoBR dependency. CI uses its normal Playwright Chromium installation.

## Acceptance paths covered

* Novel creation, character/world fields, chapters and scene fields.
* Real adapter requests, persisted candidates, explicit adoption/rejection and refresh recovery.
* Chapter Memory JSON extraction and hash-bound continuity handoff.
* Prior chapter memory in the actual subsequent generation request.
* Author style, detailed notes and task output limits in the actual provider wire request.
* No canonical writes before candidate acceptance; malformed output is retained as failure evidence.
* Storage failure rollback, stale/conflicting updates, explicit retry and preservation of saved prose.
* Registry-derived backup/restore, reference remapping, database reopen and rejection of foreign product data.

The mixed upstream registry/voice tests were scoped to retained Long Form behavior.
Two tests already skipped in the upstream regression suite remain skipped; no new
skip was introduced to suppress an import failure. See `docs/IMPORT.md` for the
separate offline Narrative World evaluation gates excluded with their historical corpora.

GitHub Actions is the final independent verification of the exact PR commit.
Its result must be read from the PR checks rather than inferred from this local record.
