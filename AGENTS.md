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
- In `annotations.js`, keep sup detection in `_hasSup()`, href fragment parsing in `_parseHref()`, block tags/timing thresholds as module-level constants, and fallback hint styling in `.annotation-fallback-hint`; do not reintroduce scattered `split('#')` parsing or inline fallback styles. CSS `vertical-align: super/sub/top/bottom` is a footnote signal only after cheap gates pass, isolated long links that dominate their parent block must remain excluded to avoid flat TOC false positives, and `_extractContent()` must keep the 2000-character safety valve plus empty-anchor sibling boundary scan. Cross-document footnote content caching must remain book-lifetime scoped, capped by `_FOOTNOTE_SECTION_CACHE_LIMIT`, and cleared on `setBook()` book changes and `unmount()`. Pure numeric note markers are limited to 1-3 digits; four-digit numbers are treated as year-like false-positive risks unless explicit EPUB semantics such as `epub:type="noteref"` already accepted them. Same-document and cross-document target-before-source checks must stay weak negative signals: use them to suppress class/fragment weak positives, not to override explicit semantics, superscript signals, or confirmed footnote containers. Cross-document topology must be derived from `contents.sectionIndex` plus book spine href indexes when available; missing spine context must fall back to old behavior. FB2/Calibre `body[name="notes"]` and `body[name="comments"]` must remain recognized as footnote containers for both section-link exclusion and same-document target analysis.
- In `search.js`, keep search result limits and timing thresholds as module-level constants. `_SEARCH_MAX_RESULTS` must cap results before each chapter batch is merged/rendered; a single chapter returning more than the limit must not render beyond the limit.

## Critical Loading Order
- In `reader.html`: libraries first (`jszip`, `epub`), then utils (`db-gateway`, `utils`, `storage`), then feature modules, then `reader-state`, `reader-ui`, `reader-persistence`, `reader-runtime`, and finally `reader.js`.
- `storage.js` depends on `db-gateway.js`; `reader.js` depends on all reader layers and feature module globals.

## Storage Rules
- All app persistence goes through `EpubStorage` in `src/utils/storage.js`; do not call `chrome.storage.local` or IndexedDB directly from page or reader modules.
- Binary EPUB files, covers, and locations live in IndexedDB via `DbGateway`; preferences, recent books, highlights, bookmarks, and `bookMeta_<bookId>` live in `chrome.storage.local`.
- `preferences` and `recentBooks` read-modify-write paths must use their internal queues; do not reintroduce naked `_get` → mutate → `_set` sequences for these shared keys.
- `bookMeta_<bookId>` merges `pos`, `time`, and `speed`; same-book full overwrite/patch/clear paths are serialized by the internal bookMeta queue to avoid read-modify-write races.
- `getBookMeta()` lazy migration from legacy `pos_` / `time_` keys must also run inside the same bookMeta queue; first-time patch creation should absorb legacy fields before applying the new patch.
- Automatic LRU cleanup (`enforceFileLRU`) must only evict IndexedDB `files` EPUB cache; preserve `recentBooks`, `bookMeta`, highlights, bookmarks, covers, and locations so re-importing the same book can recover reading progress and annotations. Explicit `removeBook()` remains the full cascade delete path.
- Book IDs are content-derived (`SHA-256(filename + first 64KB)`), not filename-only.

## Reading Position Gotchas
- v2.3 stores `pos.cfi` as a coarse `location.start.cfi` plus `pos.locator` (`epubjs-displayed-page-v1`) for displayed-page correction; do not revert to using `location.end.cfi` as the main restore anchor.
- During `openBook()` restore, `state.isRestoringPosition` must stay true until CFI display, font/render stabilization, and any one-page correction complete; intermediate `relocated` events must not write storage.
- `flushPositionSave()` should resample `rendition.currentLocation()` before saving so refresh/close does not persist stale in-memory CFI/locator.
- Locations generation is non-blocking: first render must proceed without waiting for `book.locations.generate()`.

## DOM, Security, And Style
- User/book content inserted into DOM must use `textContent` or `Utils.escapeHtml`; avoid `innerHTML` with unsanitized content. `Utils.escapeHtml` is only for element text context; do not use it inside quoted HTML attributes. Attribute values from EPUB/user data must be assigned through DOM properties or `setAttribute` after template construction.
- User/book colors entering inline style or CSS custom properties must be normalized first; only CSS-valid hex lengths (3/4/6/8 digits) or `transparent` are allowed, and alpha colors must not be built by appending string suffixes to arbitrary hex input.
- In `highlights.js`, only explicit `color === 'transparent'` is note-only; missing or invalid highlight colors must fall back to the default visible highlight color.
- In `home.js`, bookshelf card cover and `bookMeta` reads must be isolated per book; a single damaged cover/meta record should degrade that card to no cover/no progress, not fail the whole streaming bookshelf render or leave skeletons behind.
- Runtime visibility should generally use CSS classes (`is-hidden`, `is-visible`, panel classes), not `style.display`; existing exceptions include dynamic image transforms and popup-specific constraints.
- Revoke `URL.createObjectURL()` results after cover/image use.

## Release And Docs
- Extension version is in `src/manifest.json`; version tests in `test/suites/system/sys_manifest.test.js` must match.
- 修改代码后同步更新扩展版本号（`src/manifest.json`），并按需同步版本测试和发布文档。
- Update `CHANGELOG.md`, `README.md`, `docs/architecture.md` for behavior or version changes.
- Comments and docs in this repo commonly use Chinese; keep that style when adding explanatory comments near existing Chinese documentation.
