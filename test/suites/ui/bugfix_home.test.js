'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// ────────────────────────────────────────────────────────────────────────────
// BUG-10: home.js fileInput not reset after upload
//
// After selecting a file, fileInput.value is never cleared. If the user
// tries to re-import the same file, the 'change' event won't fire.
// popup.js correctly does `fileInput.value = ''` but home.js does not.
// ────────────────────────────────────────────────────────────────────────────

test.describe('BUG-10: home.js fileInput is reset after file selection', () => {
  test.it('home.js fileInput change handler resets e.target.value', () => {
    const src = fs.readFileSync('src/home/home.js', 'utf8');

    // Find the fileInput change handler block
    const changeHandlerStart = src.indexOf("fileInput.addEventListener('change'");
    assert.ok(changeHandlerStart !== -1, 'fileInput change handler must exist');

    // Extract a reasonable chunk after the handler start
    const handlerBlock = src.slice(changeHandlerStart, changeHandlerStart + 400);

    assert.ok(
      handlerBlock.includes("target.value = ''") ||
      handlerBlock.includes("target.value=''") ||
      handlerBlock.includes("fileInput.value = ''") ||
      handlerBlock.includes("fileInput.value=''"),
      'fileInput change handler must reset value to empty string after processing'
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// BUG-11: home.js export uses escapeHtml in Markdown content
//
// The export writes .md files but applies Utils.escapeHtml() to book titles
// and author names, producing HTML entities like &amp; in raw Markdown.
// ────────────────────────────────────────────────────────────────────────────

test.describe('BUG-11: home.js Markdown export does not use escapeHtml', () => {
  test.it('export handler does not apply escapeHtml to title/author in Markdown output', () => {
    const src = fs.readFileSync('src/home/home.js', 'utf8');

    // Find the export section
    const exportStart = src.indexOf('btn-export-all');
    assert.ok(exportStart !== -1, 'export button handler must exist');

    const exportBlock = src.slice(exportStart, exportStart + 2000);

    // The Markdown output lines should not use escapeHtml
    // Look for the specific pattern: escapeHtml(book.title) or escapeHtml(book.author)
    const hasEscapeInMdOutput = /escapeHtml\(book\.(title|author|filename)\)/.test(exportBlock);
    assert.ok(
      !hasEscapeInMdOutput,
      'Markdown export must not use escapeHtml for title/author — HTML entities are meaningless in .md files'
    );
    assert.match(exportBlock, /finally \{\s*a\.remove\(\);\s*URL\.revokeObjectURL\(url\);\s*\}/,
      'Markdown download must revoke its Object URL even when click/append fails');
  });
});
