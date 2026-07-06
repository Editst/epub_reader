# AGENTS.md

## What This Repo Is
- Chrome MV3 extension, no framework and no build step; load `src/` as the unpacked extension.
- Runtime entrypoints are `src/manifest.json`, `src/reader/reader.html`, `src/home/home.html`, and `src/popup/popup.html`.
- Scripts are loaded directly by HTML, so script order is a dependency boundary; do not assume bundling, imports, or tree shaking.

## Commands
- Run all tests: `node test/run_tests.js`
- Run focused tests: `node --test-name-pattern="ReaderPersistence" test/run_tests.js`
- There is no package manager manifest, lint, formatter, typecheck, or CI workflow in this repo; use tests plus manual review.

## Test Harness Notes
- `test/run_tests.js` is the single test entry and auto-discovers nested `test/suites/**/*.test.js` files.
- The harness mocks `chrome.storage.local`, IndexedDB, minimal DOM, and wires `global.Utils`, `global.DbGateway`, and `global.EpubStorage`.
- Use `resetAll()` in tests that touch storage or mocked DB state.
- Browser-like module tests load files with `loadWindowScript()` from `test/helpers/browser_env.js`.

## Reader Architecture
- `src/reader/reader.js` is only the orchestrator; put behavior in the four layers it wires together: `reader-state.js`, `reader-runtime.js`, `reader-persistence.js`, `reader-ui.js`.
- `reader-runtime.js` owns epub.js lifecycle, `openBook()`, file loading, navigation, layout switching, and locations generation.
- `reader-persistence.js` owns reading position, time, speed, `relocated`, `visibilitychange`, and flush behavior.
- Feature modules (`annotations`, `toc`, `search`, `bookmarks`, `highlights`, `image-viewer`) are mounted by lifecycle context; add new reader modules to `reader.html` and `reader.js` lifecycle wiring.
- All reader modules use IIFE wrappers: `(function () { 'use strict'; ... window.XXX = XXX; })();`
- Module-level magic numbers should be extracted as named constants at the top of the IIFE.
- Shared helpers between `openBook` and `setLayout` live in `reader-runtime.js` as private functions (`_createRendition`, `_hookRenditionEvents`).
- Shared utilities between reader modules live in `reader-state.js` (`findTocItem`, `buildPrefsSignature`).

## Critical Loading Order
- In `reader.html`: libraries first (`jszip`, `epub`), then utils (`db-gateway`, `utils`, `storage`), then feature modules, then `reader-state`, `reader-runtime`, `reader-persistence`, `reader-ui`, and finally `reader.js`.
- `storage.js` depends on `db-gateway.js`; `reader.js` depends on all reader layers and feature module globals.

## Storage Rules
- All app persistence goes through `EpubStorage` in `src/utils/storage.js`; do not call `chrome.storage.local` or IndexedDB directly from page or reader modules.
- Binary EPUB files, covers, and locations live in IndexedDB via `DbGateway`; preferences, recent books, highlights, bookmarks, and `bookMeta_<bookId>` live in `chrome.storage.local`.
- `bookMeta_<bookId>` merges `pos`, `time`, and `speed`; same-book writes are serialized by `_enqueueBookMetaWrite` to avoid read-modify-write races.
- Book IDs are content-derived (`SHA-256(filename + first 64KB)`), not filename-only.

## Reading Position Gotchas
- v2.3 stores `pos.cfi` as a coarse `location.start.cfi` plus `pos.locator` (`epubjs-displayed-page-v1`) for displayed-page correction; do not revert to using `location.end.cfi` as the main restore anchor.
- During `openBook()` restore, `state.isRestoringPosition` must stay true until CFI display, font/render stabilization, and any one-page correction complete; intermediate `relocated` events must not write storage.
- `flushPositionSave()` should resample `rendition.currentLocation()` before saving so refresh/close does not persist stale in-memory CFI/locator.
- Locations generation is non-blocking: first render must proceed without waiting for `book.locations.generate()`.

## DOM, Security, And Style
- User/book content inserted into DOM must use `textContent` or `Utils.escapeHtml`; avoid `innerHTML` with unsanitized content.
- Runtime visibility should generally use CSS classes (`is-hidden`, `is-visible`, panel classes), not `style.display`; existing exceptions include dynamic image transforms and popup-specific constraints.
- Revoke `URL.createObjectURL()` results after cover/image use.

## Release And Docs
- Extension version is in `src/manifest.json`; version tests in `test/suites/system/sys_manifest.test.js` must match.
- Update `CHANGELOG.md`, `README.md`, `docs/architecture.md`, and `docs/modules.md` for behavior or version changes.
- Comments and docs in this repo commonly use Chinese; keep that style when adding explanatory comments near existing Chinese documentation.
