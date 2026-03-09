/**
 * Annotations Module
 * Detects and displays footnotes/endnotes in a popup (Kindle/Calibre style)
 */
const Annotations = {
  overlay: null,
  popup: null,
  body: null,
  titleEl: null,
  book: null,
  rendition: null,
  _lastClickedHref: null, // Track what was clicked to prevent back-link popup

  init() {
    this.overlay = document.getElementById('annotation-overlay');
    this.popup = document.getElementById('annotation-popup');
    this.body = document.getElementById('annotation-body');
    this.titleEl = document.getElementById('annotation-title');

    // Close handlers
    document.getElementById('annotation-close').addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', () => this.close());

    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.popup.style.display !== 'none') {
        this.close();
      }
    });
  },

  /**
   * Set the current book reference for content retrieval
   * @param {object} book - epub.js Book object
   */
  setBook(book) {
    this.book = book;
  },

  /**
   * Check if a link element is a footnote back-link (returning from footnote to main text)
   * @param {HTMLElement} link
   * @returns {boolean}
   */
  isBackLink(link) {
    const href = link.getAttribute('href') || '';
    const cls = link.className || '';
    const text = link.textContent.trim();
    const epubType = link.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ||
                     link.getAttribute('epub:type') || '';
    const role = link.getAttribute('role') || '';
    const rel = link.getAttribute('rel') || '';

    // Check epub:type for backlink
    if (epubType.includes('backlink') || (epubType.includes('noteref') === false && epubType.includes('note'))) return false;

    // Check role
    if (role.includes('doc-backlink')) return true;

    // Check class
    if (/\b(backlink|footnote-backref|back-ref|noteref-back|fn-back|back|return-link)\b/i.test(cls)) return true;

    // v1.2.3 Fix: Removed overly aggressive regex ^#(fnref|noteref) which killed valid footnote links. 
    // Only check for explicit back-references or source returns.
    if (/^#(backref|back_ref|src_|return)/i.test(href)) return true;

    // Common back-link text patterns: ↩, ←, ↑, ^, [back], 返回
    if (/^[↩←⏎↲\u21A9\u2190↑^]$/.test(text)) return true;
    if (/^(返回|回到正文|跳回|back|return)$/i.test(text)) return true;

    // Structural Heuristic for handling symmetrical footnotes: 
    // If the link text is just a number/symbol, AND it appears at the EXACT BEGINNING 
    // of its container paragraph/block, it's highly likely to be the back-link inside the endnote/footnote itself!
    // (In contrast, footnote links in the main text are usually IN THE MIDDLE or END of a paragraph).
    if (/^[\[(【]?\d+[\])】]?$/.test(text) || /^[*†‡§‖¶]$/.test(text)) {
      // Find the parent block (p, div, li, dd)
      const blockBase = link.closest('p, div, li, dd') || link.parentElement;
      if (blockBase) {
        const blockText = blockBase.textContent.trim();
        // If the entire paragraph literally starts with this link's text (e.g., "[1] This is a note..."),
        // it serves as the return link for the footnote payload.
        if (blockText.startsWith(text)) {
          return true;
        }
      }
    }

    return false;
  },

  /**
   * Attempt to resolve and display a footnote
   * @param {string} href - The href from the link
   * @param {object} contents - epub.js contents object
   * @returns {boolean} - true if handled as footnote
   */
  async showFootnote(href, contents) {
    try {
      let targetId = '';
      let sectionHref = '';
      let displayHref = href;

      if (href.startsWith('#')) {
        // Same-document reference
        targetId = href.substring(1);
        const doc = contents.document;
        const target = this._findTarget(doc, targetId);
        if (target) {
          try {
            displayHref = contents.cfiFromNode(target);
          } catch(e) {
            try {
              const currentSpineHref = this.rendition.currentLocation().start.href.split('#')[0];
              displayHref = `${currentSpineHref}#${targetId}`;
            } catch (e2) {}
          }
          const html = this._extractContent(target);
          this._displayContent(html, displayHref || href);
          return true;
        }
      } else if (href.includes('#')) {
        const parts = href.split('#');
        sectionHref = parts[0];
        targetId = parts[1];
      } else {
        sectionHref = href;
      }

      // Try to load from another section in the book
      const result = await this._loadFromBook(sectionHref, targetId);
      if (result && result.html) {
        displayHref = targetId ? `${result.href}#${targetId}` : result.href;
        this._displayContent(result.html, displayHref);
        return true;
      }

      // FALLBACK: Even if content extraction completely failed, still show popup
      // Resolve the href for the jump link
      let resolvedHref = href;
      if (this.rendition) {
        try {
          const currentHref = this.rendition.currentLocation()?.start?.href || '';
          const currentDir = currentHref.substring(0, currentHref.lastIndexOf('/') + 1);
          const cleanHref = href.replace(/^(\.\.\/)+/, '');
          resolvedHref = currentDir + cleanHref;
        } catch(e) {}
      }
      this._displayContent('<p style="color:#888;text-align:center;">点击下方链接查看注释内容</p>', resolvedHref);
      return true;
    } catch (err) {
      console.warn('Annotation: failed to resolve footnote', href, err);
      return false;
    }
  },

  /**
   * Find a target element by id or name attribute (older EPUBs use <a name="...">) 
   */
  _findTarget(doc, targetId) {
    if (!doc || !targetId) return null;

    // In some epub.js environments or edge cases, doc might be just a string
    let searchDoc = doc;
    if (typeof doc === 'string') {
      try {
        searchDoc = new DOMParser().parseFromString(doc, "application/xhtml+xml");
      } catch (e) {
        return null;
      }
    }

    let el = null;
    // 1. Try getElementById safely
    if (typeof searchDoc.getElementById === 'function') {
      try { el = searchDoc.getElementById(targetId); } catch(e) {}
    }

    // 2. Fallback to querySelector for name attribute or if getElementById is missing
    if (!el && typeof searchDoc.querySelector === 'function') {
      try {
        el = searchDoc.querySelector('[id="' + CSS.escape(targetId) + '"]') ||
             searchDoc.querySelector('[name="' + CSS.escape(targetId) + '"]');
      } catch(e) {}
    }

    return el;
  },

  /**
   * Extract meaningful annotation content from a target element.
   * If the element is a small anchor/link, grab its containing block instead.
   */
  _extractContent(el) {
    if (!el) return '';
    // If element is an anchor or has very short content, get the parent block
    const tagName = el.tagName?.toLowerCase();
    if (tagName === 'a' || tagName === 'sup' || tagName === 'sub' || (el.textContent || '').trim().length < 5) {
      // Walk up to a block-level parent (p, div, li, aside, section, blockquote)
      let parent = el.parentElement || el.parentNode;
      while (parent && !['p', 'div', 'li', 'aside', 'section', 'blockquote', 'body'].includes(parent.tagName?.toLowerCase())) {
        parent = parent.parentElement || parent.parentNode;
        if (parent && parent.nodeType === 9) break; // Break if we hit the Document node
      }
      if (parent && parent.tagName && parent.tagName.toLowerCase() !== 'body') {
        return parent.innerHTML || new XMLSerializer().serializeToString(parent);
      }
    }
    return el.innerHTML || new XMLSerializer().serializeToString(el);
  },

  /**
   * Load content from a book section
   */
  async _loadFromBook(sectionHref, targetId) {
    if (!this.book) return null;

    try {
      let section = null;
      if (sectionHref) {
        // Method 1: Direct spine lookup
        section = this.book.spine.get(sectionHref);

        // Method 2: Resolve relative path against current section's directory
        if (!section && this.rendition) {
          try {
            const currentHref = this.rendition.currentLocation()?.start?.href || '';
            const currentDir = currentHref.substring(0, currentHref.lastIndexOf('/') + 1);
            const cleanHref = sectionHref.replace(/^(\.\.\/)+/, '');
            const resolved = currentDir + cleanHref;
            section = this.book.spine.get(resolved);
          } catch(e) {}
        }

        // Method 3: Match by filename across all spine items (robust fallback)
        if (!section) {
          const filename = sectionHref.split('/').pop().split('#')[0];
          for (let i = 0; i < this.book.spine.length; i++) {
            const s = this.book.spine.get(i);
            if (s && s.href && s.href.split('/').pop() === filename) {
              section = s;
              break;
            }
          }
        }
      }

      // If we found the section, load content
      if (section) {
        const loaded = await section.load(this.book.load.bind(this.book));
        if (targetId) {
          const el = this._findTarget(loaded, targetId);
          if (el) {
            const html = this._extractContent(el);
            section.unload();
            return { html, href: section.href };
          }
        }
        // Return a portion of the section content
        const bodyEl = loaded.querySelector ? loaded.querySelector('body') : null;
        const html = bodyEl ? (bodyEl.innerHTML || new XMLSerializer().serializeToString(bodyEl)) : '';
        section.unload();
        if (html) return { html, href: section.href };
      }

      // Brute-force: search ALL sections for target ID
      if (targetId) {
        for (let i = 0; i < this.book.spine.length; i++) {
          const s = this.book.spine.get(i);
          if (s) {
            try {
              const loaded = await s.load(this.book.load.bind(this.book));
              const el = this._findTarget(loaded, targetId);
              if (el) {
                const html = this._extractContent(el);
                s.unload();
                return { html, href: s.href };
              }
              s.unload();
            } catch(e) { /* skip unloadable sections */ }
          }
        }
      }
    } catch (err) {
      console.warn('Annotation: error loading from book', err);
    }

    return null;
  },

  /**
   * Display content in the annotation popup
   * @param {string} html - HTML content to display
   * @param {string} href - Original href for "jump to" link
   */
  _displayContent(html, href) {
    // Clean up footnote backlinks from content
    let content = html;
    content = content.replace(/<a[^>]*class="[^"]*\bfootnote-backref\b[^"]*"[^>]*>.*?<\/a>/gi, '');
    content = content.replace(/<a[^>]*href="#(fnref|noteref|backref)[^"]*"[^>]*>.*?<\/a>/gi, '');

    // Store the href for the jump link
    this._lastClickedHref = href;

    this.body.innerHTML = content;
    this.titleEl.textContent = '注释';

    // Add "jump to annotation" link at the bottom
    const jumpLink = document.createElement('div');
    jumpLink.className = 'annotation-jump-link';
    jumpLink.innerHTML = '<a href="javascript:void(0)">跳转到注释位置 →</a>';
    jumpLink.querySelector('a').addEventListener('click', async (e) => {
      e.preventDefault();
      this.close();
      if (this.rendition && href) {
        try {
          await this.rendition.display(href);
        } catch (_) {
          // If epub.js fails with "No Section Found", try the base section href
          try {
            const baseHref = href.split('#')[0];
            if (baseHref && baseHref !== href) {
              await this.rendition.display(baseHref);
            }
          } catch (__) {
            console.warn('Annotation: could not navigate to', href);
          }
        }
      }
    });
    this.body.appendChild(jumpLink);

    this.overlay.style.display = 'block';
    this.popup.style.display = 'flex';
  },

  close() {
    this.overlay.style.display = 'none';
    this.popup.style.display = 'none';
    this.body.innerHTML = '';
  },

  /**
   * Hook into epub.js rendition to intercept footnote link clicks
   * @param {object} rendition - epub.js rendition object
   */
  hookRendition(rendition) {
    this.rendition = rendition;

    rendition.hooks.content.register((contents) => {
      const doc = contents.document;
      const links = doc.querySelectorAll('a[href]');

      links.forEach((link) => {
        // Skip back-links explicitly
        if (this.isBackLink(link)) return;

        if (this.isFootnoteLink(link)) {
          // Store the original href and REMOVE it from the element
          // This is critical: epub.js has its own internal link handler that
          // checks for href and navigates. Removing href completely prevents
          // epub.js from intercepting the click and navigating.
          const href = link.getAttribute('href');
          link.setAttribute('data-footnote-href', href);
          link.removeAttribute('href');

          // Style as clickable
          link.style.cursor = 'pointer';
          link.style.textDecoration = 'none';
          link.style.borderBottom = '1px dotted';
          link.style.color = 'inherit';

          // Use capture phase + stopImmediatePropagation for maximum interception
          link.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            const footnoteHref = link.getAttribute('data-footnote-href');
            // showFootnote now ALWAYS shows a popup (even with fallback content)
            await this.showFootnote(footnoteHref, contents);
          }, true); // capture phase
        }
      });
    });
  }
};
