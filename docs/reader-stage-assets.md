# U1.1 Reader artwork: verified measurements and release contract

The UI is a presentation layer only; it never changes the confirmed Canon or the reader publication transaction. **Muse owns a separate commit delivering the 16 measured WebP files.** This UI PR does not create, duplicate or embed art.

## Approved mobile asset slots

| Class | Name/IDs | Expected paths | Measured bytes |
| --- | --- | --- | ---: |
| LEVEL 0–6 | `level-0` through `level-6` | `public/reader-assets/levels/level-N.webp` | 156,170 total |
| Cao Minh | `cao-minh` | `public/reader-assets/characters/cao-minh.webp` | 138,348 |
| Entities (eight) | `smiler`, `clump`, `deathmoth`, `skin-stealer`, `wretch`, `duller`, `slenderman`, `hostile-faceling` | `public/reader-assets/entities/ID.webp` | 116,350 total |
| **Total** | **16 images** | **Asset files supplied by Muse separately** | **410,868** |

LEVEL file sizes as measured by Muse: 0: 22,284; 1: 24,334; 2: 20,752; 3: 22,872; 4: 9,024; 5: 53,636; 6: 3,268 bytes. Sources are landscape, exported 760×440 WebP. Default focus is 50%/50% for Levels 0–4 and 6; Level 5 is set to 50%/28% for U5 review because the source contains embedded “TERROR HOTEL” lettering at the lower edge. The 760×440 source and 380×220 frame have the same 19:11 ratio, so `object-position` alone may not displace that lettering meaningfully. Muse must inspect the new Level 5 screenshot before declaring this issue resolved; if still visible, the artwork remains unchanged and the crop decision stays with Muse.

Cao Minh uses a 438×780 WebP cut from a verified 1024×1536 RGBA Codex; alpha bbox was 850×1512, safely above the source 2× threshold. Image is 172×260 CSS px at the 412px viewport, right anchored, extending 40px above the stage. The character overlay is optional if loading unexpectedly fails, with no fabricated replacement.

All eight entity WebPs have original RGBA alpha. Display a **single priority-ranked entity** in a 110×110 contain box at bottom-left, extending 12px below the stage. Deathmoth is a wide alpha bbox and must stay `object-fit:contain`. Hound is excluded due to its 128×128 source; `hotel_corpse_lure` / `the_beast_of_level_5` duplicate one image, and `diep_minh` is a character, not an entity; none is admitted into the U1.1 manifest.

Canon alias `brownie → brownies` is confirmed by Muse (`ENTITY.BROWNIES` is the only entity). A canonical `brownies` **ID exists but has no approved image** in this tranche; its manifest value is an empty slot, so it is never shown. No art is copied from another repo or fabricated.

## Rendering rules and fallbacks

The active turn's *verified, committed* `readerTurns.sceneHintsJson` is used solely for illustrative decoration. The only permissible model payload has `levelId` and `entityIds`; a model-supplied URL or unlisted ID never resolves to an image. The choices-stage prompt must emit a `sceneHints` key: non-null only when the V3-approved final prose clearly identifies an allowlisted LEVEL, with allowlisted entity IDs only if present in that final prose. Otherwise `null`. Incorrect/malformed hints always normalize to `null` without blocking publication. Hints are not Canon facts.

Unknown LEVEL or null hint: **no stage box**. If a valid hint qualifies before initial render, the stage reserves exactly 380×220 CSS px at a 412px viewport. Background is rounded 20px and clipped; actors overflow their own layer, not the page. If an image fails after rendering, its image disappears but the reserved stage box **never collapses during that reading visit**, preventing layout shift. Prose of historical turns remains plain text; only the current head has the static illustration, immediately preceding its prose.

No animation, transition, combat, inventory, level-up or interactivity is introduced.

## Acceptance and evidence

* 412×915 viewport; `document.documentElement.scrollWidth <= 412`, 0px layout shift measured at the first paragraph's `offsetTop` before and after delayed asset load, touch targets >=44px, 0 animation.
* Capture seven screenshots (LEVEL 0–6) with **Muse's real WebPs** and the Cao Minh overlay; confirm level-identifying details remain visible with center focus. A failing crop is changed via `levelFocus` only after visual review, not by model.
* Real-provider visual-hints trial is owned by Muse. For 20 turns whose final prose clearly states an allowlisted LEVEL, target >=18 correct non-null hints; for 10 prose-negative and 10 unknown-level cases, require 0 false positive stage. Record actual numerator/denominator and failures; do not claim success solely from mocked CI.
* Mocked HTTP end-to-end tests still run the real Reader client, publication coordinator and receipt readback. Provider-real success is separately signed by Muse.

The manifest is located at `src/lib/reader/stage-assets.ts`. Reader presentation is implemented by `src/components/reader/ReaderStage.tsx`, `src/pages/ReaderPage.tsx` and `src/pages/reader.css`.
