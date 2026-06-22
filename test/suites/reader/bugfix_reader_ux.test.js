'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// ────────────────────────────────────────────────────────────────────────────
// BUG-4: setLayout missing 'image' CSS rule
//
// openBook sets themes.default with both 'img' and 'image' rules, but
// setLayout only sets 'img'.  After layout switch, SVG <image> elements
// may overflow.
// ────────────────────────────────────────────────────────────────────────────

test.describe('BUG-4: setLayout includes image CSS rule', () => {
  test.it('reader-runtime.js setLayout themes.default includes image rule', () => {
    const src = fs.readFileSync('src/reader/reader-runtime.js', 'utf8');
    // Find the setLayout function body
    const setLayoutStart = src.indexOf('async function setLayout');
    assert.ok(setLayoutStart !== -1, 'setLayout function must exist');
    const setLayoutBody = src.slice(setLayoutStart, src.indexOf('\n    }', setLayoutStart + 200) + 6);

    // themes.default in setLayout must contain 'image' rule (not just 'img')
    assert.ok(
      setLayoutBody.includes("'image'"),
      'setLayout themes.default must include an image rule for SVG <image> elements'
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// BUG-5: coverUrl Blob URL memory leak
//
// state.book.coverUrl() returns a Blob URL that is never revoked.
// After fix, URL.revokeObjectURL must be called.
// ────────────────────────────────────────────────────────────────────────────

test.describe('BUG-5: coverUrl Blob URL is revoked after use', () => {
  test.it('reader-runtime.js cover extraction calls revokeObjectURL', () => {
    const src = fs.readFileSync('src/reader/reader-runtime.js', 'utf8');
    // The cover extraction block should contain revokeObjectURL
    const coverSection = src.slice(
      src.indexOf('封面提取'),
      src.indexOf('metadata / title')
    );
    assert.ok(
      coverSection.includes('revokeObjectURL'),
      'Cover extraction must revoke the Blob URL to prevent memory leak'
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// BUG-6: TOC setActive matching is too broad
//
// toc.js L113: `href.includes(itemHref)` can match ch1.html against ch10.html
// because "ch10.html".includes("ch1") is true (when fragments are involved).
// ────────────────────────────────────────────────────────────────────────────

test.describe('BUG-6: TOC setActive uses precise href matching', () => {
  test.it('toc.js setActive does not use broad substring includes for matching', () => {
    const src = fs.readFileSync('src/reader/toc.js', 'utf8');
    const setActiveStart = src.indexOf('setActive(');
    const setActiveBody = src.slice(setActiveStart, src.indexOf('\n  },', setActiveStart) + 5);

    // The broad `href.includes(itemHref)` pattern should no longer exist
    assert.ok(
      !setActiveBody.includes('href.includes(itemHref)'),
      'setActive must not use href.includes(itemHref) — it causes false positives like ch1.html matching ch10.html'
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// BUG-7: TOC open() doesn't close sibling panels
//
// Bookmarks.togglePanel and Search.togglePanel close sibling panels before
// opening, but TOC.open() does not, allowing multiple panels simultaneously.
// ────────────────────────────────────────────────────────────────────────────

test.describe('BUG-7: TOC open() closes sibling panels', () => {
  test.it('toc.js open() references bookmarks-panel and search-panel', () => {
    const src = fs.readFileSync('src/reader/toc.js', 'utf8');
    const openStart = src.indexOf('open() {');
    // Find the open method body (it's between open() and close())
    const openBody = src.slice(openStart, src.indexOf('close() {', openStart));

    assert.ok(
      openBody.includes('bookmarks-panel') || openBody.includes('bookmarksPanel'),
      'TOC.open() must close the bookmarks panel'
    );
    assert.ok(
      openBody.includes('search-panel') || openBody.includes('searchPanel'),
      'TOC.open() must close the search panel'
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// BUG-8: highlights.js reRenderHighlight has empty catch
//
// Line 460: `} catch (e) {}` — silent failure makes debugging impossible.
// ────────────────────────────────────────────────────────────────────────────

test.describe('BUG-8: reRenderHighlight logs errors instead of swallowing', () => {
  test.it('highlights.js reRenderHighlight catch block contains console.warn', () => {
    const src = fs.readFileSync('src/reader/highlights.js', 'utf8');
    const reRenderStart = src.indexOf('function reRenderHighlight');
    const reRenderEnd = src.indexOf('\n  }', reRenderStart + 50) + 4;
    const reRenderBody = src.slice(reRenderStart, reRenderEnd);

    // The catch block must log something
    assert.ok(
      reRenderBody.includes('console.warn'),
      'reRenderHighlight catch block must log via console.warn, not silently swallow'
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// BUG-9: search.js renderPartialResults clears entire list on each call
//
// Line 200: `resultsList.innerHTML = ''` on every partial result batch
// causes DOM thrashing and visible flicker with many results.
// ────────────────────────────────────────────────────────────────────────────

test.describe('BUG-9: search uses incremental rendering', () => {
  test.it('search.js does not clear resultsList.innerHTML in the render loop', () => {
    const src = fs.readFileSync('src/reader/search.js', 'utf8');

    // After fix, there should be no `resultsList.innerHTML = ''` inside
    // the function that renders partial/incremental results.
    // The initial clear should happen only in doSearch before the loop starts.
    const renderFnStart = src.indexOf('function renderPartialResults') ||
                          src.indexOf('function renderNewResults') ||
                          src.indexOf('function appendResults');

    // If the function was renamed, the old renderPartialResults with innerHTML='' should be gone
    if (renderFnStart !== -1) {
      const renderFnBody = src.slice(renderFnStart, src.indexOf('\n  }', renderFnStart) + 4);
      assert.ok(
        !renderFnBody.includes("innerHTML = ''") && !renderFnBody.includes('innerHTML = ""'),
        'Incremental render function must not clear innerHTML — append only'
      );
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// BUG-12: persistence.mount() starts readingTimer before any book is loaded
//
// The timer fires every 1s doing nothing until a book is loaded.
// startReadingTimer should only be called from openBook, not mount.
// ────────────────────────────────────────────────────────────────────────────

test.describe('BUG-12: persistence.mount does not start reading timer', () => {
  test.it('reader-persistence.js mount() does not call startReadingTimer', () => {
    const src = fs.readFileSync('src/reader/reader-persistence.js', 'utf8');
    const mountStart = src.indexOf('function mount()');
    const mountEnd = src.indexOf('\n    }', mountStart) + 6;
    const mountBody = src.slice(mountStart, mountEnd);

    assert.ok(
      !mountBody.includes('startReadingTimer'),
      'persistence.mount() must NOT call startReadingTimer — it should only be called from openBook'
    );
  });
});
