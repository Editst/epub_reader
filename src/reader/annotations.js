/**
 * Annotations Module — EPUB Reader Chrome Extension
 * Detects footnote/endnote links and shows them in a popup (Kindle/Calibre style).
 *
 * ── Architecture ──────────────────────────────────────────────────────────────
 *
 *  Per section load (hookRendition → hooks.content callback):
 *    Phase 0  _buildDocContext()  Scan document ONCE; cache into WeakSets.
 *    Phase 1  isBackLink()        Is this link a "return to text" anchor?
 *    Phase 2  isFootnoteLink()    Is this link a forward footnote reference?
 *    Stamp    removeAttribute / onclick=null / data-footnote-href / CSS class
 *    Guard    doc-level capture handler → showFootnote() on click
 *    Cleanup  contents 'destroy' → cancel token + remove listener
 *
 * ── Key design decisions ──────────────────────────────────────────────────────
 *
 *  epub.js onclick conflict
 *    epub.js hooks.content runs BEFORE ours (registered in Rendition constructor).
 *    It sets link.onclick = function(){ rendition.display(href) } for every a[href].
 *    onclick is an IDL attribute, not an addEventListener listener — it cannot be
 *    stopped by stopImmediatePropagation(). We null it explicitly after stamping.
 *
 *  Why only contents 'destroy' for cleanup, NOT rendition 'relocated'
 *    epub.js fires 'relocated' on every page turn within a chapter AND on initial
 *    layout completion — not only on chapter transitions. Binding cancelToken to
 *    'relocated' caused it to die the moment the section finished rendering,
 *    making all subsequent clicks silently no-op.
 *    'destroy' fires exactly once, when the iframe is torn down.
 *
 *  isBackLink / isFootnoteLink symmetry for numeric markers
 *    Calibre-generated books have no epub:type markup, so pre-indexed footnote
 *    section WeakSets are always empty. Both functions therefore use the same
 *    structural heuristic independently:
 *      no-<sup> + is-block-start  →  backlink (NOT a forward reference)
 *    isBackLink also requires block-has-more-text (strong signal).
 *    isFootnoteLink rejects no-<sup>+block-start regardless of extra-text length
 *    (conservative: prefer false-negative over false-positive).
 *
 * ── Memory model ──────────────────────────────────────────────────────────────
 *
 *  WeakSet for DOM node caches — GC-friendly when iframe is destroyed.
 *  One shared document-level capture handler per section load (not per link).
 *  cancelToken aborts in-flight async lookups when section unloads.
 */

(function () {
'use strict';

// ── Pre-compiled regexes (module-level, parsed once) ─────────────────────────
// /g flag only used with String.replace(), which resets lastIndex — safe.
const _RE = Object.freeze({
  // ── Positive: footnote reference signals ─────────────────────────────────
  noteSemanticPos : /\bnoteref\b|\bdoc-noteref\b|\bannoref\b/i,
  noteContainer   : /\b(footnote|endnote|rearnote)\b/i,
  noteCls         : /\b(fn|ft|note|footnote|endnote|annotation|ann)([-_]?(ref|link|mark))?\d*\b/i,
  noteFragPos     : /^(fn|ft|note|endnote|footnote|annotation|en|n|ref)\d+/i,
  // Classic footnote markers: [1], (iv), *, †, Unicode superscript digits.
  // Numeric markers stay at 1-3 digits; 4-digit values are commonly years.
  noteTextMarker  : /^[\[(【]?(\d{1,3}|[ivxlcdmIVXLCDM]{1,6})[\])】]?$|^[*†‡§‖¶]{1,3}$|^[\u00B9\u00B2\u00B3\u2070-\u2079]+$/,
  // Kindle-style filepos anchors
  filepos         : /#filepos\d+/i,

  // ── Negative: navigation / structural signals ─────────────────────────────
  navCls          : /\b(toc|nav|contents?|chapter[-_]?link|catalog|index[-_]?entry)\b/i,
  chapterText     : /^(chapter|part|section|preface|appendix|附录|第.+[章节]|Part\s+[IVXLCDM]+)/i,
  structFragNeg   : /^(ch(ap(ter)?)?|sec(tion)?|part|fig(ure)?|tbl|table|img|image)\d*/i,

  // ── Negative: back-link signals ───────────────────────────────────────────
  backlinkSemantic: /\bbacklink\b|\bdoc-backlink\b/i,
  backlinkCls     : /\b(backlink|footnote-backref|back[-_]?ref|noteref[-_]?back|fn[-_]?back|return[-_]?link)\b/i,
  backlinkFrag    : /^#(backref|back_ref|fnref|noteref|src_|return)/i,
  backlinkGlyph   : /^[↩←⏎↲↑\u21A9\u2190^]$/,
  backlinkWord    : /^(\[back\]|返回|回到正文|跳回|back|return)$/i,

  // ── Popup content cleanup ─────────────────────────────────────────────────
  cleanBackref    : /<a[^>]*class="[^"]*\bfootnote-backref\b[^"]*"[^>]*>[\s\S]*?<\/a>/gi,
  cleanFnref      : /<a[^>]*href="#(fnref|noteref|backref)[^"]*"[^>]*>[\s\S]*?<\/a>/gi,
});

const _FN_DATA_ATTR = 'data-footnote-href';
const _FN_CSS_CLASS = '__epub-fn-ref';
const _FN_STYLE_ID  = '__epub-fn-styles';
const _FN_STYLE_CSS = `
  a.__epub-fn-ref {
    cursor: pointer !important;
    text-decoration: none !important;
    border-bottom: 1px dotted currentColor !important;
  }
`;
const _BLOCK_TAGS = new Set(['p', 'div', 'li', 'aside', 'section', 'blockquote']);
const _PAGINATION_SETTLE_MS = 100;
const _TOC_MIN_ITEMS = 3;
const _TOC_LINK_TEXT_MIN_LENGTH = 10;
const _TOC_LONG_LINK_RATIO = 0.6;
const _ISOLATED_LINK_MIN_LENGTH = 6;
const _ISOLATED_LINK_PARENT_RATIO = 0.8;
const _SUPLIKE_VERTICAL_ALIGN_VALUES = new Set(['super', 'sub', 'top', 'bottom']);
const _MAX_FOOTNOTE_TEXT = 2000;
const _FOOTNOTE_TRUNCATION_HINT = '… [内容过长，请点击原文]';
const _EMPTY_ANCHOR_BOUNDARY_TAGS = new Set(['hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const _FOOTNOTE_SECTION_CACHE_LIMIT = 50;
const _DOCUMENT_POSITION_DISCONNECTED = 1;
const _DOCUMENT_POSITION_PRECEDING = 2;

const _hookedRenditions = new WeakSet();
const _hookedContentDocuments = new WeakSet();

function _hasSup(link) {
  if (!link) return false;
  const hasAncestor = typeof link.closest === 'function' && link.closest('sup') !== null;
  const hasDescendant = typeof link.querySelector === 'function' && link.querySelector('sup') !== null;
  return hasAncestor || hasDescendant;
}

function _parseHref(href) {
  const raw = String(href || '');
  const hashIndex = raw.indexOf('#');
  if (hashIndex < 0) return { sectionHref: raw, fragmentId: '' };
  return {
    sectionHref: raw.slice(0, hashIndex),
    fragmentId: raw.slice(hashIndex + 1)
  };
}

function _normalizeInlineText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function _isFourDigitNumberMarker(text) {
  return /^[\[(【]?\d{4}[\])】]?$/.test(_normalizeInlineText(text));
}

function _isSameDocumentTargetBeforeSource(link, targetEl) {
  if (!link || !targetEl || typeof link.compareDocumentPosition !== 'function') return false;
  if (link.ownerDocument && targetEl.ownerDocument && link.ownerDocument !== targetEl.ownerDocument) {
    return false;
  }
  try {
    const position = link.compareDocumentPosition(targetEl);
    if (position & _DOCUMENT_POSITION_DISCONNECTED) return false;
    return !!(position & _DOCUMENT_POSITION_PRECEDING);
  } catch (_) {
    return false;
  }
}

function _escapeHtmlText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function _stripHtmlToText(html) {
  return _normalizeInlineText(String(html || '').replace(/<[^>]+>/g, ' '));
}

function _nodeText(node) {
  return String(node?.textContent ?? node?.nodeValue ?? '');
}

function _serializeNode(node) {
  if (!node) return '';
  if (node.nodeType === 3) return _escapeHtmlText(node.nodeValue ?? node.textContent ?? '');
  if (typeof node.outerHTML === 'string') return node.outerHTML;
  try {
    if (typeof XMLSerializer !== 'undefined') {
      return new XMLSerializer().serializeToString(node);
    }
  } catch (_) {}
  return _escapeHtmlText(_nodeText(node));
}

function _limitFootnoteHtml(html, plainText) {
  const text = _normalizeInlineText(plainText || _stripHtmlToText(html));
  if (text.length <= _MAX_FOOTNOTE_TEXT) return html;
  return `<p>${_escapeHtmlText(text.slice(0, _MAX_FOOTNOTE_TEXT))}${_FOOTNOTE_TRUNCATION_HINT}</p>`;
}

function _isEmptyAnchorBoundary(node) {
  if (!node || node.nodeType === 3) return false;
  const tag = node.tagName?.toLowerCase();
  if (_EMPTY_ANCHOR_BOUNDARY_TAGS.has(tag)) return true;
  if (tag !== 'a') return false;
  return !!(
    node.id ||
    node.name ||
    node.getAttribute?.('id') ||
    node.getAttribute?.('name')
  );
}

function _collectAfterEmptyAnchor(anchor) {
  if (!anchor || _normalizeInlineText(anchor.textContent).length > 0) return '';
  let html = '';
  let text = '';
  let node = anchor.nextSibling;

  while (node) {
    if (_isEmptyAnchorBoundary(node)) break;
    html += _serializeNode(node);
    text += ' ' + _nodeText(node);
    if (_normalizeInlineText(text).length > _MAX_FOOTNOTE_TEXT) break;
    node = node.nextSibling;
  }

  return html ? _limitFootnoteHtml(html, text) : '';
}

function _readVerticalAlign(el) {
  if (!el) return '';
  const view = el.ownerDocument?.defaultView;
  const getter = view?.getComputedStyle ||
    (typeof window !== 'undefined' ? window.getComputedStyle : null);
  if (typeof getter !== 'function') return '';
  try {
    return String(getter.call(view || window, el)?.verticalAlign || '').toLowerCase();
  } catch (_) {
    return '';
  }
}

function _hasSupLikeStyle(link) {
  return _SUPLIKE_VERTICAL_ALIGN_VALUES.has(_readVerticalAlign(link)) ||
    _SUPLIKE_VERTICAL_ALIGN_VALUES.has(_readVerticalAlign(link?.firstElementChild));
}

function _isIsolatedSourceLink(link, text) {
  const linkText = _normalizeInlineText(text);
  if (linkText.length <= _ISOLATED_LINK_MIN_LENGTH) return false;
  const block = link.closest?.('p, li, div, dd, td') || link.parentElement;
  const blockText = _normalizeInlineText(block?.textContent);
  return !!blockText && (linkText.length / blockText.length) >= _ISOLATED_LINK_PARENT_RATIO;
}

function _isUnsafeUrl(value) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F\s]+/g, '')
    .toLowerCase()
    .startsWith('javascript:');
}

function _sanitizePopupHtml(html) {
  const stripped = String(html || '')
    .replace(_RE.cleanBackref, '')
    .replace(_RE.cleanFnref, '');

  const template = document.createElement('template');
  if (!template || !('innerHTML' in template)) {
    return stripped
      .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '')
      .replace(/\s+(href|src|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/gi, (m, attr, dq, sq, bare) => {
        const value = dq ?? sq ?? bare ?? '';
        return _isUnsafeUrl(value) ? ` ${attr}="#"` : m;
      });
  }

  template.innerHTML = stripped;
  const root = template.content || template;
  root.querySelectorAll('*').forEach((el) => {
    Array.from(el.attributes || []).forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc') {
        el.removeAttribute(attr.name);
        return;
      }
      if ((name === 'href' || name === 'src' || name === 'xlink:href') && _isUnsafeUrl(attr.value)) {
        el.setAttribute(attr.name, '#');
      }
    });
  });
  return template.innerHTML;
}

// ── Click handler factory ─────────────────────────────────────────────────────
// One function instance per section load, shared across all footnote links.
// Links are identified by their data attribute — zero false positives.
function _makeDocCaptureHandler(mod, contents, cancelToken, context) {
  return function _epubFnCaptureHandler(e) {
    if (cancelToken.cancelled) return;
    if (!mod._isCurrentContext(context)) return;

    // e.target may be <sup> or other child inside the <a> — walk up
    const link = e.target.closest('a');
    if (!link) return;

    const href = link.getAttribute(_FN_DATA_ATTR);
    if (!href) return;

    // Fully intercept — no epub.js handler or browser default will fire
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    mod.showFootnote(href, contents, cancelToken, context);
  };
}

// ─────────────────────────────────────────────────────────────────────────────

const Annotations = {
  overlay  : null,
  popup    : null,
  body     : null,
  titleEl  : null,
  book     : null,
  rendition: null,
  _boundDocument: null,
  _contextSeq: 0,
  _sectionDocCache: new Map(),

  // ── Initialisation ──────────────────────────────────────────────────────────

  init() {
    this.overlay = document.getElementById('annotation-overlay');
    this.popup   = document.getElementById('annotation-popup');
    this.body    = document.getElementById('annotation-body');
    this.titleEl = document.getElementById('annotation-title');

    if (this._boundDocument === document) {
      this._bindGlobalEvents();
      return;
    }
    this._boundDocument = document;

    document.getElementById('annotation-close')
      ?.addEventListener('click', () => this.close());
    this.overlay?.addEventListener('click', () => this.close());
    this._onKeyDown = (e) => {
      if (e.key === 'Escape' && this.popup?.classList.contains('is-visible')) this.close();
    };
    this._isKeyDownBound = false;
    this._bindGlobalEvents();
  },

  mount(context) {
    if (!context) return;
    this._bindGlobalEvents();
    this.setBook(context.book);
    this.hookRendition(context.rendition);
  },

  unmount() {
    this._contextSeq++;
    this.book = null;
    this.rendition = null;
    this.close();
    this._clearSectionCache();
    if (this._onKeyDown) {
      document.removeEventListener('keydown', this._onKeyDown);
      this._isKeyDownBound = false;
    }
  },

  setBook(book) {
    if (this.book !== book) {
      this._contextSeq++;
      this.close();
      this._clearSectionCache();
    }
    this.book = book;
  },

  _currentContext() {
    return {
      seq: this._contextSeq,
      book: this.book,
      rendition: this.rendition
    };
  },

  _isCurrentContext(context) {
    return !!context &&
      context.seq === this._contextSeq &&
      context.book === this.book &&
      context.rendition === this.rendition;
  },

  _bindGlobalEvents() {
    if (!this._onKeyDown || this._isKeyDownBound) return;
    document.addEventListener('keydown', this._onKeyDown);
    this._isKeyDownBound = true;
  },

  _clearSectionCache() {
    this._sectionDocCache.clear();
  },

  _getCachedSectionDocument(cacheKey) {
    if (!cacheKey || !this._sectionDocCache.has(cacheKey)) return null;
    const loaded = this._sectionDocCache.get(cacheKey);
    this._sectionDocCache.delete(cacheKey);
    this._sectionDocCache.set(cacheKey, loaded);
    return loaded;
  },

  _rememberSectionDocument(cacheKey, loaded) {
    if (!cacheKey || !loaded) return;
    if (this._sectionDocCache.has(cacheKey)) this._sectionDocCache.delete(cacheKey);
    this._sectionDocCache.set(cacheKey, loaded);
    while (this._sectionDocCache.size > _FOOTNOTE_SECTION_CACHE_LIMIT) {
      const firstKey = this._sectionDocCache.keys().next().value;
      this._sectionDocCache.delete(firstKey);
    }
  },

  async _loadSectionDocument(section, activeLoad, cacheKey, cancelToken, context) {
    const key = cacheKey || section?.href || '';
    const cached = this._getCachedSectionDocument(key);
    if (cached) return { loaded: cached, shouldUnload: false };

    const loaded = await section.load(activeLoad);
    if (cancelToken?.cancelled || !this._isCurrentContext(context)) {
      try { section.unload(); } catch (_) {}
      return null;
    }
    this._rememberSectionDocument(key, loaded);
    return { loaded, shouldUnload: true };
  },

  // ── Phase 0: Document context (one scan per section) ───────────────────────

  /**
   * Scan the iframe document once and cache costly results.
   * Subsequent per-link checks use O(1) WeakSet lookups instead of DOM queries.
   *
   * @param  {Document} doc
   * @returns {DocContext}
   */
  _buildDocContext(doc) {
    const ctx = {
      doc,
      isGlobalTocDoc       : false,   // whole spine item is a nav/TOC file
      hasNavBlocks         : false,   // document contains <nav> elements
      tocLinkNodes         : new WeakSet(),
      hasTocLinks          : false,
      footnoteSectionNodes : new WeakSet(),  // links inside epub:type footnote sections
      hasFootnoteSections  : false,
    };

    if (!doc?.body) return ctx;

    ctx.isGlobalTocDoc =
      !!doc.querySelector('nav[epub\\:type~="toc"], nav[epub\\:type~="landmarks"]') ||
      _RE.navCls.test(doc.body.id)        ||
      _RE.navCls.test(doc.body.className);

    if (ctx.isGlobalTocDoc) return ctx;

    ctx.hasNavBlocks = !!doc.querySelector('nav');

    // Index links inside TOC-like lists so per-link checks are O(1)
    doc.querySelectorAll('ol, ul').forEach((list) => {
      if (!this._isTocList(list)) return;
      const anchors = list.querySelectorAll('a');
      for (let i = 0; i < anchors.length; i++) {
        ctx.tocLinkNodes.add(anchors[i]);
        ctx.hasTocLinks = true;
      }
    });

    // Index links inside semantically-marked footnote/endnote sections.
    // Only present in well-formed EPUB3 books; Calibre books won't populate this.
    // The structural heuristics in isBackLink/isFootnoteLink cover the Calibre case.
    try {
      const fnSections = doc.querySelectorAll(
        '[epub\\:type~="footnotes"], [epub\\:type~="endnotes"], ' +
        '.footnotes, .endnotes, aside[epub\\:type~="footnote"]'
      );
      for (let i = 0; i < fnSections.length; i++) {
        const anchors = fnSections[i].querySelectorAll('a[href]');
        for (let j = 0; j < anchors.length; j++) {
          ctx.footnoteSectionNodes.add(anchors[j]);
          ctx.hasFootnoteSections = true;
        }
      }
    } catch (_) {}

    return ctx;
  },

  /**
   * Heuristic: does this list look like a Table of Contents?
   * Thresholds follow the Calibre/KOReader-style "many long chapter links"
   * navigation-list signal and are evaluated once per list, never per link.
   * A list qualifies when >= 60% of its direct <li> children contain an <a>
   * whose text is longer than 10 characters (chapter/section titles).
   */
  _isTocList(listEl) {
    const items = listEl.querySelectorAll(':scope > li');
    if (items.length < _TOC_MIN_ITEMS) return false;
    let longLinked = 0;
    for (let i = 0; i < items.length; i++) {
      const a = items[i].querySelector('a');
      if (a && a.textContent.trim().length > _TOC_LINK_TEXT_MIN_LENGTH) longLinked++;
    }
    return (longLinked / items.length) >= _TOC_LONG_LINK_RATIO;
  },

  // ── Phase 1: Back-link detection (cheapest signals first) ──────────────────

  /**
   * Returns true if this link is a "return to text" anchor inside a footnote.
   *
   * Stage 0  epub:type / role attrs — O(1), authoritative
   * Stage 1  class / href fragment  — O(1)
   * Stage 2  glyph / keyword text   — O(1)
   * Stage 3  structural DOM         — one closest() call, only when needed
   *
   * @param  {HTMLElement} link
   * @param  {DocContext}  ctx
   * @returns {boolean}
   */
  isBackLink(link, ctx) {
    // Stage 0: Semantic attributes — definitive when present
    const epubType = link.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ||
                     link.getAttribute('epub:type') || '';
    if (_RE.backlinkSemantic.test(epubType)) return true;

    const role = link.getAttribute('role') || '';
    if (_RE.backlinkSemantic.test(role)) return true;

    // Stage 1: Class name and href fragment pattern
    if (_RE.backlinkCls.test(link.className || '')) return true;

    const href = link.getAttribute('href') || '';
    if (_RE.backlinkFrag.test(href)) return true;

    // Stage 2: Return glyph or keyword
    const text = link.textContent.trim();
    if (_RE.backlinkGlyph.test(text) || _RE.backlinkWord.test(text)) return true;

    // Stage 3: Structural — numeric/symbol marker at the start of a footnote block.
    //
    // Targets Calibre-generated books, which have no epub:type markup.
    // Typical pattern:
    //   <p><a href="maintext.html#ref2">2</a>This is the footnote text...</p>
    //
    // All four conditions must hold:
    //   (a) text matches noteTextMarker  (short number or symbol)
    //   (b) link has no <sup> ancestor or descendant
    //       -- forward references ALWAYS use superscript; back-links never do
    //   (c) the nearest block's text starts with the link's text
    //       -- link is the first visible content in the block
    //   (d) the block contains more text beyond the link
    //       -- the block is a footnote body, not a lone label
    //
    // Correctly excluded:
    //   <a><sup>[2]</sup></a>   fails (b)
    //   <a>2</a> mid-paragraph  fails (c)
    //   <a>2</a> alone in block fails (d)
    if (_RE.noteTextMarker.test(text)) {
      if (!_hasSup(link)) {
        const block = link.closest('p, li, div, dd, td') || link.parentElement;
        if (block) {
          const blockText = block.textContent.trim();
          if (blockText.startsWith(text) && blockText.length > text.length + 3) return true;
        }
      }
    }

    return false;
  },

  // ── Phase 2: Footnote link detection (four-stage pipeline) ─────────────────

  /**
   * Returns true if this link should open the annotation popup.
   *
   * Stage 0  Hard gates        — pure string ops, zero DOM
   * Stage 1  EPUB3 semantics   — authoritative, O(1) attr reads
   * Stage 2  Text/class/frag   — heuristic, O(1)
   * Stage 3  Structural DOM    — targeted queries, only for ambiguous cases
   *
   * @param  {HTMLElement} link
   * @param  {DocContext}  ctx
   * @returns {boolean}
   */
  isFootnoteLink(link, ctx) {
    // Stage 0: Hard gates — eliminate obviously non-footnote links ────────────
    const href = link.getAttribute('href') || '';
    if (!href)                                               return false;
    if (href.indexOf('#') === -1 && !_RE.filepos.test(href)) return false;
    if (/^(https?:|mailto:|javascript:)/i.test(href))       return false;
    if (ctx.isGlobalTocDoc)                                  return false;
    if (ctx.hasTocLinks && ctx.tocLinkNodes.has(link))       return false;

    const text = link.textContent.trim();
    if (text.length > 40) return false;   // chapter titles / prose links are never markers

    // Stage 1: EPUB3 semantics — trust epub:type and role when present ─────────
    const epubType = link.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ||
                     link.getAttribute('epub:type') || '';
    const role     = link.getAttribute('role') || '';
    if (_RE.noteSemanticPos.test(epubType) || _RE.noteSemanticPos.test(role)) return true;

    // Stage 2: Text / class / fragment heuristics ─────────────────────────────
    const cls      = link.className || '';
    const fragment = _parseHref(href).fragmentId;
    const sameDocTarget = href.startsWith('#') && ctx.doc
      ? this._findTarget(ctx.doc, fragment)
      : null;
    const isTargetBeforeSource = _isSameDocumentTargetBeforeSource(link, sameDocTarget);

    // Definitive NO
    if (_RE.navCls.test(cls))                                            return false;
    if (text.length > 6 && _RE.chapterText.test(text))                  return false;
    if (_RE.structFragNeg.test(fragment))                                return false;
    if (ctx.hasFootnoteSections && ctx.footnoteSectionNodes.has(link))   return false;
    if (_isIsolatedSourceLink(link, text))                                return false;
    if (_isFourDigitNumberMarker(text))                                   return false;

    // Numeric/symbol marker — needs extra back-link guard.
    //
    // A numeric marker with no <sup> that sits at the start of its block is
    // almost certainly a "return to text" link (the mirror of isBackLink S3).
    // We reject it here regardless of block length — it is safer to miss a
    // rare in-text numeric ref than to intercept a back-link navigation.
    if (_RE.noteTextMarker.test(text)) {
      if (!_hasSup(link)) {
        const block = link.closest('p, li, div, dd, td') || link.parentElement;
        if (block && block.textContent.trim().startsWith(text)) return false;
      }
      return true;  // has <sup>, or not at block start → IS a footnote reference
    }

    if (_RE.filepos.test(href))                                          return true;
    if (!isTargetBeforeSource && (
      _RE.noteCls.test(cls) || _RE.noteCls.test(link.id || '')
    ))                                                                  return true;
    if (!isTargetBeforeSource && _RE.noteFragPos.test(fragment))         return true;

    // Stage 3: Structural DOM — only for links that remain ambiguous ──────────
    // Covers the bug-report pattern: <a href="..."><sup>[2]</sup></a>

    // <sup> is the strongest single structural signal for a forward reference
    if (link.parentElement?.tagName === 'SUP') return true;
    if (_hasSup(link))                          return true;

    // <nav> containment — guarded to skip closest() when document has no navs
    if (ctx.hasNavBlocks && link.closest('nav')) return false;

    // Some EPUBs style note references as vertical-align: super instead of
    // using a literal <sup>. Read computed style only after cheap gates pass.
    if (_hasSupLikeStyle(link)) return true;

    // Target element analysis — same-document only, single getElementById call
    if (href.startsWith('#') && ctx.doc) {
      const targetEl = sameDocTarget;
      if (targetEl) {
        if (/^H[1-6]$/.test(targetEl.tagName)) return false; // heading = chapter anchor
        const tType = targetEl.getAttributeNS?.('http://www.idpf.org/2007/ops', 'type') ||
                      targetEl.getAttribute?.('epub:type') || '';
        if (_RE.noteContainer.test(tType))                                return true;
        if (_RE.noteCls.test(targetEl.className || ''))                   return true;
        if (targetEl.closest?.(
          '.footnotes, .endnotes, [epub\\:type~="footnotes"], [epub\\:type~="endnotes"]'
        ))                                                                return true;
      }
    }

    return false;
  },

  // ── Content resolution ─────────────────────────────────────────────────────

  /**
   * Resolve a footnote href, load the content, and open the popup.
   *
   * @param {string}   href         -- raw href from data-footnote-href
   * @param {Contents} contents     -- epub.js Contents for the current section
   * @param {object}   cancelToken  -- { cancelled: boolean }
   * @returns {Promise<boolean>}
   */
  async showFootnote(href, contents, cancelToken, context = this._currentContext()) {
    if (!this._isCurrentContext(context)) return false;
    try {
      let targetId    = '';
      let sectionHref = '';
      let displayHref = href;
      const parsedHref = _parseHref(href);

      if (!parsedHref.sectionHref && parsedHref.fragmentId) {
        // Same-document fragment
        targetId = parsedHref.fragmentId;
        const target = this._findTarget(contents.document, targetId);
        if (!this._isCurrentContext(context)) return false;
        if (target) {
          try        { displayHref = contents.cfiFromNode(target); }
          catch (_)  {
            try {
              const cur = _parseHref(context.rendition.currentLocation().start.href).sectionHref;
              displayHref = `${cur}#${targetId}`;
            } catch (_) {}
          }
          this._displayContent(this._extractContent(target), displayHref || href, context);
          return true;
        }
      } else {
        sectionHref = parsedHref.sectionHref;
        targetId = parsedHref.fragmentId;
      }

      if (cancelToken?.cancelled) return false;

      const result = await this._loadFromBook(sectionHref, targetId, cancelToken, context);
      if (cancelToken?.cancelled) return false;
      if (!this._isCurrentContext(context)) return false;

      if (result?.html) {
        displayHref = targetId ? `${result.href}#${targetId}` : result.href;
        this._displayContent(result.html, displayHref, context);
        return true;
      }

      // Last resort: popup with only the navigation link
      let resolvedHref = href;
      if (context.rendition) {
        try {
          const cur    = context.rendition.currentLocation()?.start?.href || '';
          const curDir = cur.substring(0, cur.lastIndexOf('/') + 1);
          resolvedHref = curDir + href.replace(/^(\.\.\/)+/, '');
        } catch (_) {}
      }
      this._displayContent(
        '<p class="annotation-fallback-hint">点击下方链接查看注释内容</p>',
        resolvedHref,
        context
      );
      return true;

    } catch (err) {
      if (!cancelToken?.cancelled) console.warn('Annotation: showFootnote failed', href, err);
      return false;
    }
  },

  /**
   * Find an element by id or name, accepting a Document or an XML string.
   *
   * @param  {Document|string} doc
   * @param  {string}          targetId
   * @returns {Element|null}
   */
  _findTarget(doc, targetId) {
    if (!doc || !targetId) return null;
    let d = doc;
    if (typeof d === 'string') {
      try { d = new DOMParser().parseFromString(d, 'application/xhtml+xml'); }
      catch (_) { return null; }
    }
    try { const el = d.getElementById(targetId); if (el) return el; } catch (_) {}
    try {
      return d.querySelector(`[id="${CSS.escape(targetId)}"]`) ||
             d.querySelector(`[name="${CSS.escape(targetId)}"]`);
    } catch (_) {}
    return null;
  },

  /**
   * Extract meaningful HTML from a target element.
   *
   * If the target is an inline element (<a>, <sup>, <sub>) or contains very
   * little text, walk up to the nearest block ancestor so the popup shows the
   * full footnote sentence rather than just the reference marker.
   *
   * The walk is strictly bounded: stops at <body>, <html>, or the document node.
   *
   * @param  {Element} el
   * @returns {string}
   */
  _extractContent(el) {
    if (!el) return '';
    const tag = el.tagName?.toLowerCase();

    if (tag === 'a') {
      const siblingContent = _collectAfterEmptyAnchor(el);
      if (siblingContent) return siblingContent;
    }

    if (tag === 'a' || tag === 'sup' || tag === 'sub' ||
        (el.textContent || '').trim().length < 5) {

      let p = el.parentElement || el.parentNode;
      while (p) {
        const t = p.tagName?.toLowerCase();
        if (!t || t === 'body' || t === 'html' || p.nodeType === 9) break;
        if (_BLOCK_TAGS.has(t)) break;
        p = p.parentElement || p.parentNode;
      }

      if (p) {
        const t = p.tagName?.toLowerCase();
        if (t && _BLOCK_TAGS.has(t))
          return _limitFootnoteHtml(
            p.innerHTML || new XMLSerializer().serializeToString(p),
            p.textContent
          );
      }
    }

    return _limitFootnoteHtml(
      el.innerHTML || new XMLSerializer().serializeToString(el),
      el.textContent
    );
  },

  /**
   * Load footnote content from a spine section (possibly not the current one).
   *
   * Resolution order:
   *   1. Direct spine.get(sectionHref)
   *   2. Relative path resolved against current section's directory
   *   3. Filename match (handles OPF path-prefix differences)
   *   4. Brute-force scan of every spine item for targetId
   *
   * cancelToken is checked before every async step so the scan aborts
   * immediately when the user navigates away.
   *
   * @param  {string} sectionHref
   * @param  {string} targetId
   * @param  {object} cancelToken
   * @returns {Promise<{html:string, href:string}|null>}
   */
  async _loadFromBook(sectionHref, targetId, cancelToken, context = this._currentContext()) {
    if (!this._isCurrentContext(context) || !context.book) return null;
    const activeBook = context.book;
    const activeRendition = context.rendition;
    const activeLoad = typeof activeBook.load === 'function' ? activeBook.load.bind(activeBook) : undefined;
    try {
      let section = null;

      if (sectionHref) {
        // Method 1
        section = activeBook.spine.get(sectionHref);

        // Method 2
        if (!section && activeRendition) {
          try {
            const cur    = activeRendition.currentLocation()?.start?.href || '';
            const curDir = cur.substring(0, cur.lastIndexOf('/') + 1);
            section      = activeBook.spine.get(
              curDir + sectionHref.replace(/^(\.\.\/)+/, '')
            );
          } catch (_) {}
        }

        // Method 3
        if (!section) {
          const filename = _parseHref(sectionHref).sectionHref.split('/').pop();
          for (let i = 0; i < activeBook.spine.length; i++) {
            const s = activeBook.spine.get(i);
            if (s?.href?.split('/').pop() === filename) { section = s; break; }
          }
        }
      }

      if (section) {
        const loadedResult = await this._loadSectionDocument(
          section,
          activeLoad,
          section.href || sectionHref,
          cancelToken,
          context
        );
        if (!loadedResult) return null;
        try {
          const loaded = loadedResult.loaded;
          if (targetId) {
            const el = this._findTarget(loaded, targetId);
            if (el) {
              const html = this._extractContent(el);
              return { html, href: section.href };
            }
          }

          const bodyEl = loaded.querySelector?.('body');
          const html   = bodyEl
            ? _limitFootnoteHtml(
                bodyEl.innerHTML || new XMLSerializer().serializeToString(bodyEl),
                bodyEl.textContent
              )
            : '';
          if (html) return { html, href: section.href };
        } finally {
          if (loadedResult.shouldUnload) {
            try { section.unload(); } catch (_) {}
          }
        }
      }

      // Method 4: brute-force
      if (targetId) {
        for (let i = 0; i < activeBook.spine.length; i++) {
          if (cancelToken?.cancelled) return null;
          if (!this._isCurrentContext(context)) return null;
          const s = activeBook.spine.get(i);
          if (!s) continue;
          let loadedResult = null;
          try {
            loadedResult = await this._loadSectionDocument(
              s,
              activeLoad,
              s.href || String(i),
              cancelToken,
              context
            );
            if (!loadedResult) return null;
            const loaded = loadedResult.loaded;
            const el = this._findTarget(loaded, targetId);
            if (el) {
              const html = this._extractContent(el);
              return { html, href: s.href };
            }
          } catch (_) {
          } finally {
            if (loadedResult?.shouldUnload) {
              try { s.unload(); } catch (__) {}
            }
          }
        }
      }
    } catch (err) {
      if (!cancelToken?.cancelled) console.warn('Annotation: _loadFromBook error', err);
    }
    return null;
  },

  // ── Display ────────────────────────────────────────────────────────────────

  /**
   * Render footnote content into the popup and make it visible.
   *
   * @param {string} html  -- footnote body HTML
   * @param {string} href  -- navigation target (CFI or path#fragment)
   */
  _displayContent(html, href, context = this._currentContext()) {
    if (!this._isCurrentContext(context)) return;
    // EPUB 注释内容来自书籍包内，进入宿主扩展页前必须逐属性清洗。
    this.body.innerHTML = _sanitizePopupHtml(html);

    this.titleEl.textContent = '注释';

    const jumpWrap = document.createElement('div');
    jumpWrap.className = 'annotation-jump-link';
    // Build jump link via DOM API — no innerHTML with string interpolation
    const anchor = document.createElement('a');
    anchor.href        = '#';
    anchor.textContent = '跳转到注释位置 →';
    anchor.addEventListener('click', async (e) => {
      e.preventDefault();
      if (!this._isCurrentContext(context)) return;
      this.close();
      if (!context.rendition || !href) return;
      try {
        await context.rendition.display(href);
        await this._compensatePaginationOffset(href, context);
      } catch (_) {
        try {
          const base = _parseHref(href).sectionHref;
          if (base && base !== href) {
            await context.rendition.display(base);
            await this._compensatePaginationOffset(href, context);
          }
        } catch (__) { console.warn('Annotation: navigate failed', href); }
      }
    });
    jumpWrap.appendChild(anchor);
    this.body.appendChild(jumpWrap);

    this.overlay.classList.add('is-visible');
    this.popup.classList.add('is-visible');
  },

  /**
   * After programmatic navigation, epub.js paginated mode sometimes lands on
   * the page before the target due to floating-point column-index rounding.
   * We check whether the target fragment is visible and advance one page if not.
   *
   * @param {string} href
   */
  async _compensatePaginationOffset(href, context = this._currentContext()) {
    const fragment = _parseHref(href).fragmentId;
    if (!fragment || !this._isCurrentContext(context) || !context.rendition) return;

    await new Promise(r => setTimeout(r, _PAGINATION_SETTLE_MS));
    if (!this._isCurrentContext(context)) return;

    try {
      const contents = context.rendition.getContents?.()?.[0];
      if (!contents?.document) return;
      if (!this._findTarget(contents.document, fragment)) {
        await context.rendition.next?.();
      }
    } catch (_) {}
  },

  close() {
    this.overlay?.classList.remove('is-visible');
    this.popup?.classList.remove('is-visible');
    if (this.body) this.body.innerHTML = '';
  },

  // ── Rendition hook ─────────────────────────────────────────────────────────

  /**
   * Register this module with an epub.js Rendition.
   * Call from reader.js after every rendition creation or rebuild.
   *
   * @param {Rendition} rendition
   */
  hookRendition(rendition) {
    if (this.rendition !== rendition) {
      this._contextSeq++;
      this.close();
    }
    this.rendition = rendition;
    if (!rendition) return;
    const context = this._currentContext();

    if (!_hookedRenditions.has(rendition)) {
      _hookedRenditions.add(rendition);
      rendition.hooks.content.register((contents) => this._hookContents(contents, context));
    }

    if (typeof rendition.getContents === 'function') {
      rendition.getContents().forEach((contents) => this._hookContents(contents, context));
    }
  },

  _hookContents(contents, context = this._currentContext()) {
    if (!this._isCurrentContext(context)) return;
    const doc = contents && contents.document;
    if (!doc ||
        typeof doc.addEventListener !== 'function' ||
        typeof doc.querySelectorAll !== 'function' ||
        _hookedContentDocuments.has(doc)) return;
    _hookedContentDocuments.add(doc);

    // Phase 0 ────────────────────────────────────────────────────────────────
    const ctx = this._buildDocContext(doc);
    if (ctx.isGlobalTocDoc) return;

    // Inject per-iframe styles ───────────────────────────────────────────────
    try {
      if (!doc.getElementById(_FN_STYLE_ID)) {
        const styleEl = doc.createElement('style');
        styleEl.id          = _FN_STYLE_ID;
        styleEl.textContent = _FN_STYLE_CSS;
        (doc.head || doc.documentElement).appendChild(styleEl);
      }
    } catch (_) {}

    // Cancel token (scoped to this section load) ─────────────────────────────
    const cancelToken = { cancelled: false };

    // Document-level capture handler ─────────────────────────────────────────
    // Capture phase fires before any element-level listener, and before
    // epub.js's own document-level delegation.
    const docCaptureHandler = _makeDocCaptureHandler(this, contents, cancelToken, context);
    doc.addEventListener('click', docCaptureHandler, true);

    // Stamp footnote reference links ─────────────────────────────────────────
    const links = doc.querySelectorAll('a[href]');
    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      if (this.isBackLink(link, ctx))      continue;
      if (!this.isFootnoteLink(link, ctx)) continue;

      const href = link.getAttribute('href');
      link.setAttribute(_FN_DATA_ATTR, href);
      link.removeAttribute('href');    // prevent browser default navigation

      // epub.js linksHandler set link.onclick = function(){ rendition.display(href) }
      // before our hook ran. The closure captured the original href, so removing
      // the attribute is not enough. We must null onclick directly.
      // stopImmediatePropagation() in our capture handler cannot block onclick
      // because onclick is an IDL attribute, not an addEventListener listener.
      link.onclick = null;

      link.classList.add(_FN_CSS_CLASS);
    }

    // Cleanup ─────────────────────────────────────────────────────────────────
    // 'destroy' fires exactly once when the iframe is torn down.
    // We do NOT use 'relocated': epub.js fires it on every page turn AND on
    // initial layout, which would kill cancelToken before the first click.
    const cleanup = () => {
      if (cancelToken.cancelled) return;
      cancelToken.cancelled = true;
      try { doc.removeEventListener('click', docCaptureHandler, true); } catch (_) {}
      ctx.doc = null;
    };

    try { contents.on('destroy', cleanup); } catch (_) {}
  },
  };

  window.Annotations = Annotations;
})();
