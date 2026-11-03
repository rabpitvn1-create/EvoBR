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

The present P4 generator has optional non-authoritative `sceneHints`, but does **not** produce a persisted scene hint payload; the P5 commit currently does not populate `readerTurns.sceneHintsJson`. Therefore P6 only renders a stage for an already published turn carrying an explicitly stored, trusted hint. It does not infer LEVEL or entity presence by searching prose. A future separately reviewed producer/validation path is necessary before the real generated story can drive stage imagery. No P2–P5 contract is changed in this PR.

The Reader UI is entered from the Long Form library and stays scoped to the chosen Work. Generation uses the same persisted AI configuration and P5 publication coordinator. Browser refresh looks up any recorded pending request's receipt before offering another action and does not automatically reissue unknown model requests.
