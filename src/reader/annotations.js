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

'use strict';

// ── Pre-compiled regexes (module-level, parsed once) ─────────────────────────
// /g flag only used with String.replace(), which resets lastIndex — safe.
const _RE = Object.freeze({
  // ── Positive: footnote reference signals ─────────────────────────────────
  noteSemanticPos : /\bnoteref\b|\bdoc-noteref\b|\bannoref\b/i,
  noteContainer   : /\b(footnote|endnote|rearnote)\b/i,
  noteCls         : /\b(fn|ft|note|footnote|endnote|annotation|ann)([-_]?(ref|link|mark))?\d*\b/i,
  noteFragPos     : /^(fn|ft|note|endnote|footnote|annotation|en|n|ref)\d+/i,
  // Classic footnote markers: [1], (iv), *, †, Unicode superscript digits
  noteTextMarker  : /^[\[(【]?(\d{1,4}|[ivxlcdmIVXLCDM]{1,6})[\])】]?$|^[*†‡§‖¶]{1,3}$|^[\u00B9\u00B2\u00B3\u2070-\u2079]+$/,
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

// ── Click handler factory ─────────────────────────────────────────────────────
// One function instance per section load, shared across all footnote links.
// Links are identified by their data attribute — zero false positives.
function _makeDocCaptureHandler(mod, contents, cancelToken) {
  return function _epubFnCaptureHandler(e) {
    if (cancelToken.cancelled) return;

    // e.target may be <sup> or other child inside the <a> — walk up
    const link = e.target.closest('a');
    if (!link) return;

    const href = link.getAttribute(_FN_DATA_ATTR);
    if (!href) return;

    // Fully intercept — no epub.js handler or browser default will fire
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    mod.showFootnote(href, contents, cancelToken);
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

  // ── Initialisation ──────────────────────────────────────────────────────────

  init() {
    this.overlay = document.getElementById('annotation-overlay');
    this.popup   = document.getElementById('annotation-popup');
    this.body    = document.getElementById('annotation-body');
    this.titleEl = document.getElementById('annotation-title');

    document.getElementById('annotation-close')
      .addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', () => this.close());
    this._onKeyDown = (e) => {
      if (e.key === 'Escape' && this.popup.classList.contains('is-visible')) this.close();
    };
    document.addEventListener('keydown', this._onKeyDown);
  },

  mount(context) {
    if (!context) return;
    this.setBook(context.book);
    this.hookRendition(context.rendition);
  },

  unmount() {
    this.book = null;
    this.rendition = null;
    if (this._onKeyDown) {
      document.removeEventListener('keydown', this._onKeyDown);
      this._onKeyDown = null;
    }
  },

  setBook(book) { this.book = book; },

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
   * A list qualifies when >= 60% of its direct <li> children contain an <a>
   * whose text is longer than 10 characters (chapter/section titles).
   * Called once per list, never per link.
   */
  _isTocList(listEl) {
    const items = listEl.querySelectorAll(':scope > li');
    if (items.length < 3) return false;
    let longLinked = 0;
    for (let i = 0; i < items.length; i++) {
      const a = items[i].querySelector('a');
      if (a && a.textContent.trim().length > 10) longLinked++;
    }
    return (longLinked / items.length) >= 0.6;
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
      const hasSup = link.closest('sup') !== null || link.querySelector('sup') !== null;
      if (!hasSup) {
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
    const fragment = href.split('#')[1] || '';

    // Definitive NO
    if (_RE.navCls.test(cls))                                            return false;
    if (text.length > 6 && _RE.chapterText.test(text))                  return false;
    if (_RE.structFragNeg.test(fragment))                                return false;
    if (ctx.hasFootnoteSections && ctx.footnoteSectionNodes.has(link))   return false;

    // Numeric/symbol marker — needs extra back-link guard.
    //
    // A numeric marker with no <sup> that sits at the start of its block is
    // almost certainly a "return to text" link (the mirror of isBackLink S3).
    // We reject it here regardless of block length — it is safer to miss a
    // rare in-text numeric ref than to intercept a back-link navigation.
    if (_RE.noteTextMarker.test(text)) {
      const hasSup = link.closest('sup') !== null || link.querySelector('sup') !== null;
      if (!hasSup) {
        const block = link.closest('p, li, div, dd, td') || link.parentElement;
        if (block && block.textContent.trim().startsWith(text)) return false;
      }
      return true;  // has <sup>, or not at block start → IS a footnote reference
    }

    if (_RE.filepos.test(href))                                          return true;
    if (_RE.noteCls.test(cls) || _RE.noteCls.test(link.id || ''))       return true;
    if (_RE.noteFragPos.test(fragment))                                  return true;

    // Stage 3: Structural DOM — only for links that remain ambiguous ──────────
    // Covers the bug-report pattern: <a href="..."><sup>[2]</sup></a>

    // <sup> is the strongest single structural signal for a forward reference
    if (link.parentElement?.tagName === 'SUP') return true;
    if (link.querySelector('sup') !== null)     return true;

    // <nav> containment — guarded to skip closest() when document has no navs
    if (ctx.hasNavBlocks && link.closest('nav')) return false;

    // Target element analysis — same-document only, single getElementById call
    if (href.startsWith('#') && ctx.doc) {
      const targetEl = this._findTarget(ctx.doc, fragment);
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
  async showFootnote(href, contents, cancelToken) {
    try {
      let targetId    = '';
      let sectionHref = '';
      let displayHref = href;

      if (href.startsWith('#')) {
        // Same-document fragment
        targetId = href.substring(1);
        const target = this._findTarget(contents.document, targetId);
        if (target) {
          try        { displayHref = contents.cfiFromNode(target); }
          catch (_)  {
            try {
              const cur = this.rendition.currentLocation().start.href.split('#')[0];
              displayHref = `${cur}#${targetId}`;
            } catch (_) {}
          }
          this._displayContent(this._extractContent(target), displayHref || href);
          return true;
        }
      } else if (href.includes('#')) {
        [sectionHref, targetId] = href.split('#');
      } else {
        sectionHref = href;
      }

      if (cancelToken?.cancelled) return false;

      const result = await this._loadFromBook(sectionHref, targetId, cancelToken);
      if (cancelToken?.cancelled) return false;

      if (result?.html) {
        displayHref = targetId ? `${result.href}#${targetId}` : result.href;
        this._displayContent(result.html, displayHref);
        return true;
      }

      // Last resort: popup with only the navigation link
      let resolvedHref = href;
      if (this.rendition) {
        try {
          const cur    = this.rendition.currentLocation()?.start?.href || '';
          const curDir = cur.substring(0, cur.lastIndexOf('/') + 1);
          resolvedHref = curDir + href.replace(/^(\.\.\/)+/, '');
        } catch (_) {}
      }
      this._displayContent(
        '<p style="color:var(--text-muted,#888);text-align:center;padding:8px 0;">点击下方链接查看注释内容</p>',
        resolvedHref
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
    const BLOCK = ['p', 'div', 'li', 'aside', 'section', 'blockquote'];

    if (tag === 'a' || tag === 'sup' || tag === 'sub' ||
        (el.textContent || '').trim().length < 5) {

      let p = el.parentElement || el.parentNode;
      while (p) {
        const t = p.tagName?.toLowerCase();
        if (!t || t === 'body' || t === 'html' || p.nodeType === 9) break;
        if (BLOCK.includes(t)) break;
        p = p.parentElement || p.parentNode;
      }

      if (p) {
        const t = p.tagName?.toLowerCase();
        if (t && BLOCK.includes(t))
          return p.innerHTML || new XMLSerializer().serializeToString(p);
      }
    }

    return el.innerHTML || new XMLSerializer().serializeToString(el);
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
  async _loadFromBook(sectionHref, targetId, cancelToken) {
    if (!this.book) return null;
    try {
      let section = null;

      if (sectionHref) {
        // Method 1
        section = this.book.spine.get(sectionHref);

        // Method 2
        if (!section && this.rendition) {
          try {
            const cur    = this.rendition.currentLocation()?.start?.href || '';
            const curDir = cur.substring(0, cur.lastIndexOf('/') + 1);
            section      = this.book.spine.get(
              curDir + sectionHref.replace(/^(\.\.\/)+/, '')
            );
          } catch (_) {}
        }

        // Method 3
        if (!section) {
          const filename = sectionHref.split('/').pop().split('#')[0];
          for (let i = 0; i < this.book.spine.length; i++) {
            const s = this.book.spine.get(i);
            if (s?.href?.split('/').pop() === filename) { section = s; break; }
          }
        }
      }

      if (section) {
        const loaded = await section.load(this.book.load.bind(this.book));
        if (cancelToken?.cancelled) { section.unload(); return null; }

        if (targetId) {
          const el = this._findTarget(loaded, targetId);
          if (el) {
            const html = this._extractContent(el);
            section.unload();
            return { html, href: section.href };
          }
        }

        const bodyEl = loaded.querySelector?.('body');
        const html   = bodyEl
          ? (bodyEl.innerHTML || new XMLSerializer().serializeToString(bodyEl))
          : '';
        section.unload();
        if (html) return { html, href: section.href };
      }

      // Method 4: brute-force
      if (targetId) {
        for (let i = 0; i < this.book.spine.length; i++) {
          if (cancelToken?.cancelled) return null;
          const s = this.book.spine.get(i);
          if (!s) continue;
          try {
            const loaded = await s.load(this.book.load.bind(this.book));
            if (cancelToken?.cancelled) { s.unload(); return null; }
            const el = this._findTarget(loaded, targetId);
            if (el) {
              const html = this._extractContent(el);
              s.unload();
              return { html, href: s.href };
            }
            s.unload();
          } catch (_) {}
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
  _displayContent(html, href) {
    // S-2 / P0-ANNOTATIONS-1: Strip inline event handlers and javascript: hrefs
    // before assigning to innerHTML.  EPUB content may embed on* attributes
    // (onclick, onmouseover, …) which execute in chrome-extension:// context
    // despite script-src 'self' CSP (inline handlers bypass script-src).
    const sanitized = html
      .replace(_RE.cleanBackref, '')
      .replace(_RE.cleanFnref,   '')
      .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '')
      .replace(/ href\s*=\s*(?:"[^"]*"|'[^']*')/gi, m => /javascript:/i.test(m) ? ' href="#"' : m);
    this.body.innerHTML = sanitized;

    this.titleEl.textContent = '注释';

    const jumpWrap = document.createElement('div');
    jumpWrap.className = 'annotation-jump-link';
    // Build jump link via DOM API — no innerHTML with string interpolation
    const anchor = document.createElement('a');
    anchor.href        = '#';
    anchor.textContent = '跳转到注释位置 →';
    anchor.addEventListener('click', async (e) => {
      e.preventDefault();
      this.close();
      if (!this.rendition || !href) return;
      try {
        await this.rendition.display(href);
        await this._compensatePaginationOffset(href);
      } catch (_) {
        try {
          const base = href.split('#')[0];
          if (base && base !== href) {
            await this.rendition.display(base);
            await this._compensatePaginationOffset(href);
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
  async _compensatePaginationOffset(href) {
    const fragment = href.includes('#') ? href.split('#').pop() : null;
    if (!fragment || !this.rendition) return;

    await new Promise(r => setTimeout(r, 100));   // let epub.js finish painting

    try {
      const contents = this.rendition.getContents?.()?.[0];
      if (!contents?.document) return;
      if (!this._findTarget(contents.document, fragment)) {
        await this.rendition.next?.();
      }
    } catch (_) {}
  },

  close() {
    this.overlay.classList.remove('is-visible');
    this.popup.classList.remove('is-visible');
    this.body.innerHTML        = '';
  },

  // ── Rendition hook ─────────────────────────────────────────────────────────

  /**
   * Register this module with an epub.js Rendition.
   * Call from reader.js after every rendition creation or rebuild.
   *
   * @param {Rendition} rendition
   */
  hookRendition(rendition) {
    this.rendition = rendition;

    rendition.hooks.content.register((contents) => {
      const doc = contents.document;

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
      const docCaptureHandler = _makeDocCaptureHandler(this, contents, cancelToken);
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
    });
  },
};
