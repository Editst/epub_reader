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

    // Check epub:type for backlink
    if (epubType.includes('backlink') || epubType.includes('noteref') === false && epubType.includes('note')) return false;

    // Check role
    if (role.includes('doc-backlink')) return true;

    // Check class
    if (/\b(backlink|footnote-backref|back-ref|noteref-back|fn-back|back)\b/i.test(cls)) return true;

    // Check href for back-reference patterns
    if (/^#(fnref|noteref|backref|back_ref|src_|return)/i.test(href)) return true;

    // Common back-link text patterns: ↩, ←, [back], 返回
    if (/^[↩←⏎↲\u21A9\u2190]$/.test(text)) return true;
    if (/^(返回|back)$/i.test(text)) return true;

    return false;
  },

  /**
   * Check if a link element is a footnote/endnote reference
   * @param {HTMLElement} link - The <a> element
   * @returns {boolean}
   */
  isFootnoteLink(link) {
    // First check: if it's a back-link, never treat as footnote
    if (this.isBackLink(link)) return false;

    // Check epub:type attribute
    const epubType = link.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ||
                     link.getAttribute('epub:type') || '';
    if (epubType.includes('noteref') || epubType.includes('note')) return true;

    // Check role attribute (DPUB-ARIA)
    const role = link.getAttribute('role') || '';
    if (role.includes('doc-noteref')) return true;

    // Check href pattern for common footnote patterns
    const href = link.getAttribute('href') || '';
    if (/^#(fn|note|footnote|endnote|annotation|ref|cite)/i.test(href)) return true;
    // Also match filepos patterns (Kindle-style)
    if (/#filepos\d+/i.test(href) || /\bfilepos\d+/i.test(href)) return true;

    // Check class names
    const cls = link.className || '';
    if (/\b(footnote|noteref|note-ref|endnote|annotation)\b/i.test(cls)) return true;

    // Check if it's a superscript number link (common pattern)
    const parent = link.parentElement;
    if (parent && parent.tagName.toLowerCase() === 'sup') {
      const text = link.textContent.trim();
      if (/^[\[\(]?\d+[\]\)]?$/.test(text) || /^[*†‡§‖¶]$/.test(text)) return true;
    }

    // Check if anchor text is just a number in brackets
    const text = link.textContent.trim();
    if (/^[\[\(]\d+[\]\)]$/.test(text)) return true;

    return false;
  },

  /**
   * Check if a link is actually a back-link from a footnote to the main text
   * @param {Element} link - The a tag
   * @returns {boolean}
   */
  isBackLink(link) {
    const href = link.getAttribute('href') || '';
    const cls = link.className || '';
    const rel = link.getAttribute('rel') || '';
    const role = link.getAttribute('role') || '';

    if (cls.includes('footnote-backref') || cls.includes('back-link') || cls.includes('return-link')) return true;
    if (role.includes('doc-backlink')) return true;
    if (href.includes('backref') || href.includes('fnref')) return true;
    
    const text = link.textContent.trim();
    if (text.match(/^[↑^]$/)) return true;
    
    // Chinese or common explicit back-link texts
    if (/返回|回到正文|跳回|Back|Return/i.test(text)) return true;

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
      let displayHref = href; // The reliable loc to pass to rendition.display()

      if (href.startsWith('#')) {
        // Same-document reference
        targetId = href.substring(1);
        // Try to find in current document
        const doc = contents.document;
        const target = doc.getElementById(targetId);
        if (target) {
          try {
            // Use CFI for perfect reliability within the same document
            displayHref = contents.cfiFromNode(target);
          } catch(e) {
            console.warn("Could not generate CFI for target", e);
          }
          if (!displayHref && this.book && this.rendition) {
            // Fallback to absolute spine href if CFI fails
            try {
              const currentSpineHref = this.rendition.currentLocation().start.href.split('#')[0];
              displayHref = `${currentSpineHref}#${targetId}`;
            } catch (e) {}
          }
          this._displayContent(target.innerHTML, displayHref || href);
          return true;
        }
      } else if (href.includes('#')) {
        // Cross-document reference: "chapter.xhtml#note1"
        const parts = href.split('#');
        sectionHref = parts[0];
        targetId = parts[1];
      } else {
        sectionHref = href;
      }

      // Try to load from another section in the book
      // _loadFromBook now returns an object { html, href } to guarantee we have the absolute spine target
      const result = await this._loadFromBook(sectionHref, targetId);
      if (result && result.html) {
        displayHref = targetId ? `${result.href}#${targetId}` : result.href;
        this._displayContent(result.html, displayHref);
        return true;
      }

      return false;
    } catch (err) {
      console.warn('Annotation: failed to resolve footnote', href, err);
      return false;
    }
  },

  /**
   * Load content from a book section
   */
  async _loadFromBook(sectionHref, targetId) {
    if (!this.book) return null;

    try {
      // Find the section in the spine
      let section = null;
      if (sectionHref) {
        section = this.book.spine.get(sectionHref);
        if (!section) {
          // Try to find by partial match
          this.book.spine.each((s) => {
            if (s.href && s.href.includes(sectionHref)) {
              section = s;
            }
          });
        }
      }

      if (!section && targetId) {
        // Search all sections for the target ID
        for (let i = 0; i < this.book.spine.length; i++) {
          const s = this.book.spine.get(i);
          if (s) {
            const loaded = await s.load(this.book.load.bind(this.book));
            const el = loaded.querySelector('#' + CSS.escape(targetId));
            if (el) {
              const html = el.innerHTML;
              s.unload();
              return { html, href: s.href };
            }
            s.unload();
          }
        }
        return null;
      }

      if (section) {
        const loaded = await section.load(this.book.load.bind(this.book));
        if (targetId) {
          const el = loaded.querySelector('#' + CSS.escape(targetId));
          if (el) {
            const html = el.innerHTML;
            section.unload();
            return { html, href: section.href };
          }
        }
        // Return a portion of the section content
        const html = loaded.querySelector('body')?.innerHTML || loaded.innerHTML;
        section.unload();
        return { html, href: section.href };
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
    jumpLink.querySelector('a').addEventListener('click', (e) => {
      e.preventDefault();
      this.close();
      if (this.rendition && href) {
        this.rendition.display(href);
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
            const handled = await this.showFootnote(footnoteHref, contents);
            // Do NOT navigate if handled as footnote - user can use "jump to" link
            if (!handled) {
              // If not resolved as footnote, navigate normally
              rendition.display(footnoteHref);
            }
          }, true); // capture phase
        }
      });
    });
  }
};
