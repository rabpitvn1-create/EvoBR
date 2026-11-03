# P6 Reader static stage assets

P6 is a **presentation layer only**. The stage never selects a level, adds an entity to Canon, changes a session, or submits gameplay actions. It is completely static. UI output is only the committed Reader history. No assets are copied from StoryForge or another repository.

## Asset slots

The default manifest is `src/lib/reader/stage-assets.ts` (`READER_STAGE_ASSETS_V1`). The public web-root paths below are placeholders for **files to be supplied later**, not art included in this PR:

| Key | Public path | Required for stage |
| --- | --- | --- |
| `levels['level-0']` | `public/reader-assets/levels/level-0.webp` | yes |
| `protagonist` (Cao Minh) | `public/reader-assets/characters/cao-minh.webp` | yes |
| `entities['brownie']` | `public/reader-assets/entities/brownie.webp` | optional |

Add owned artwork to these paths without changing rendering code. For more LEVEL IDs or entities, add explicit keys in `READER_STAGE_ASSETS_V1`. Transparent portrait art with a lower ground shadow is recommended for overlays; no image binary or fictional placeholder is committed by P6.

The **only** supported P6 display hint is a JSON object persisted as `readerTurns.sceneHintsJson`, for example:

```json
{"levelId":"level-0","entityIds":["brownie"]}
```

The renderer accepts only registered level/entity keys. It does not permit free-form URLs, arbitrary strings, or model-supplied asset paths. The level and entity list must be verified by the upstream reader evidence boundary; the stage never authorizes them. Missing or malformed hints, unknown level, absent background or protagonist image hide the entire stage and leave prose visible. An absent entity image hides only that entity. If `entityIds` is absent/empty, no entity appears.

The background is contained by a rounded `overflow:hidden` viewport; Cao Minh and entity overlays are in a sibling `overflow:visible` layer. No animation, controls, or CSS transitions are used. Tests intercept these declared asset URLs with synthetic SVG response fixtures, not production game art.

## P4/P5 boundary

P4 collects optional `sceneHints` from its choices response **after V3** and binds an allowlisted, normalized value into the signed choices receipt and verified candidate. P5 prepares a deterministic `sceneHintsJson` string **before** opening the single Dexie publication transaction, then adopts it with the turn. Missing, malformed, unknown-level, or ill-typed hints become `null`; they never prevent publishing valid prose or choices. A hint remains non-authoritative presentation data, not evidence that a LEVEL/entity actually exists in Canon. The stage never infers a LEVEL from prose and never accepts a model-supplied image path. Real art is still absent until the declared slots are populated.

The Reader UI is entered from the Long Form library and stays scoped to the chosen Work. Generation uses the same persisted AI configuration and P5 publication coordinator. Browser refresh looks up any recorded pending request's receipt before offering another action and does not automatically reissue unknown model requests.
