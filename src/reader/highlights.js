/**
 * EPUB Reader - Highlights and Annotations Module
 * Handles text selection, colored highlights, and custom note taking.
 */
window.Highlights = (function () {
  let _rendition = null;
  let _bookId = '';
  let _fileName = '';
  let _currentCfiRange = null;
  let _activeHighlightCfi = null;
  let _renderedHighlightCfis = new Set();
  let _boundDocument = null;
  let _contextSeq = 0;
  const _hookedRenditions = new WeakSet();
  const _hookedContentDocuments = new WeakSet();

  const toolbar = document.getElementById('selection-toolbar');
  const btnAddNote = document.getElementById('btn-add-note');
  const btnClearHl = document.getElementById('btn-clear-hl');
  const colorBtns = toolbar.querySelectorAll('.color-btn');

  let _pendingCfi = null; // Store CFI for note-taking before highlight is created
  let _internalAction = false; // v1.2.0: Strict sync lock to prevent panel persistence

  const notePopup = document.getElementById('note-popup');
  const noteTextarea = document.getElementById('note-textarea');
  const btnCancelNote = document.getElementById('btn-cancel-note');
  const btnSaveNote = document.getElementById('btn-save-note');

  let highlights = [];

  function isCurrentContext(contextSeq, bookId, rendition) {
    return contextSeq === _contextSeq && bookId === _bookId && (!rendition || rendition === _rendition);
  }

  function saveHighlightsSafely(bookId, nextHighlights) {
    let write;
    try {
      write = EpubStorage.saveHighlights(bookId, nextHighlights);
    } catch (e) {
      write = Promise.reject(e);
    }
    return Promise.resolve(write).catch((e) => {
      console.warn('[Highlights] save highlights failed:', e);
    });
  }

  function isNoteOnlyHighlight(hl) {
    return hl && hl.color === 'transparent';
  }

  function resolveHighlightColor(color) {
    const safeColor = Utils.sanitizeColor(color);
    return safeColor && safeColor !== 'transparent' ? safeColor : '#ffeb3b';
  }

  function init() {
    if (_boundDocument === document) return;
    _boundDocument = document;

    // FIX P0-C: Both the window-level mousedown handler and the btnShowToolbar
    // click handler were previously registered inside setBookDetails(), which is
    // called every time a book is opened AND every time the layout is switched.
    // Because anonymous functions cannot be removed with removeEventListener,
    // each call stacked one more handler, leading to N+1 closePanels() calls on
    // the next user click.  By moving them here — called exactly once on startup
    // — the accumulation is eliminated entirely.

    // Handler: close panels when the user clicks anywhere outside toolbar/popup
    // on the main (host) page.  Clicks inside the epub.js iframe are handled by
    // the per-contents mousedown hook registered in setBookDetails.
    window.addEventListener('mousedown', _onWindowMouseDown);

    // Handler: "Modify Highlight" button inside the note popup.
    // Only one button exists in the DOM, so one registration is enough.
    const btnShowToolbar = document.getElementById('btn-show-toolbar');
    if (btnShowToolbar) {
      btnShowToolbar.addEventListener('click', _onShowToolbarClick);
    }
  }

  // Named handler — can be reasoned about and will never be duplicated.
  function _onWindowMouseDown(e) {
    if (!toolbar.contains(e.target) && !notePopup.contains(e.target)) {
      if (e.target.closest('#header-bar') || e.target.closest('#sidebar') || e.target.closest('.bottom-bar')) {
        return;
      }
      closePanels();
    }
  }

  // Named handler for the "Modify Highlight" button.
  function _onShowToolbarClick(e) {
    e.stopPropagation();
    _internalAction = true;
    setTimeout(() => _internalAction = false, 50);

    const targetCfi = _activeHighlightCfi || _pendingCfi;
    if (targetCfi) {
      const rect = notePopup.getBoundingClientRect();
      _activeHighlightCfi = targetCfi;
      closeNotePopup();
      toolbar.style.top  = `${rect.top}px`;
      toolbar.style.left = `${rect.left + (rect.width / 2)}px`;
      const hl = highlights.find(h => h.cfi === targetCfi);
      if (hl) {
        colorBtns.forEach(b => {
          b.classList.toggle('active', b.dataset.color === hl.color);
        });
      }
      btnClearHl.classList.remove('is-hidden');
      toolbar.classList.add('show');
    }
  }

  async function setBookDetails(bookId, fileName, rendition) {
    // FIX P1-2: Remove the old 'selected' listener before re-registering.
    // setBookDetails is called both in openBook and (after P0-4 fix) in
    // setLayout. Without this guard, each call stacks another handleSelection
    // onto the same rendition, causing duplicate highlights and toolbar flicker.
    if (_rendition) {
      try { _rendition.off('selected', handleSelection); } catch (_) {}
      clearRenderedHighlights();
    }

    const contextSeq = ++_contextSeq;
    _bookId = bookId;
    _fileName = fileName;
    _rendition = rendition;
    
    // Load existing highlights
    let loadedHighlights = [];
    try {
      loadedHighlights = await EpubStorage.getHighlights(bookId) || [];
    } catch (e) {
      console.warn('[Highlights] load highlights failed:', e);
    }
    if (!isCurrentContext(contextSeq, bookId, rendition)) return;
    highlights = loadedHighlights;
    renderAllHighlights();

    // Listen to selection event from epub.js
    _rendition.on('selected', handleSelection);
    
    // CRITICAL: Fallback for selection and click stability inside epub.js iframes.
    // Register once per rendition; epub.js will invoke this callback for each new
    // contents document, so re-registering it on every setBookDetails duplicates
    // iframe mousedown handlers.
    if (!_hookedRenditions.has(_rendition)) {
      _hookedRenditions.add(_rendition);
      _rendition.hooks.content.register((contents) => {
        bindContentMouseDown(contents);
      });
    }

    if (typeof _rendition.getContents === 'function') {
      _rendition.getContents().forEach(bindContentMouseDown);
    }
  }

  function bindContentMouseDown(contents) {
    const doc = contents && contents.document;
    if (!doc || _hookedContentDocuments.has(doc)) return;
    _hookedContentDocuments.add(doc);

    // v1.2.3: Use mousedown (not click) — iframe focus can swallow click events.
    doc.addEventListener('mousedown', () => {
      setTimeout(() => {
        if (toolbar.classList.contains('show') || notePopup.classList.contains('show')) {
          if (!_internalAction) closePanels();
          return;
        }

        const selection = contents.window && contents.window.getSelection
          ? contents.window.getSelection()
          : null;
        if (selection && !selection.isCollapsed) {
          // A selection is active; the 'selected' event will handle toolbar display.
        } else {
          if (_internalAction) return;
          closePanels();
        }
      }, 10);
    });
  }

  function handleSelection(cfiRange, contents) {
    _currentCfiRange = cfiRange;
    _pendingCfi = cfiRange; // Track this for note-taking
    _activeHighlightCfi = null;
    
    // Clear active color state
    colorBtns.forEach(b => b.classList.remove('active'));
    btnClearHl.classList.add('is-hidden');

    // Position toolbar above selection
    const selection = contents.window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      
      // FIX (v1.1.3): More robust iframe rect lookup
      // contents is a Contents object. contents.element is the body/wrapper.
      // contents.window.frameElement is the actual <iframe>.
      const iframe = contents.window.frameElement;
      const iframeRect = iframe ? iframe.getBoundingClientRect() : { top: 0, left: 0 };

      const top = iframeRect.top + rect.top - 10;
      const left = iframeRect.left + rect.left + (rect.width / 2);

      toolbar.style.top = `${top}px`;
      toolbar.style.left = `${left}px`;
      toolbar.classList.add('show');
    }
  }

  // Handle color selection
  colorBtns.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const color = btn.dataset.color;
      const contextSeq = _contextSeq;
      const bookId = _bookId;
      const rendition = _rendition;
      
      if (_activeHighlightCfi) {
        // Change color of existing
        updateHighlightData(_activeHighlightCfi, { color });
        reRenderHighlight(_activeHighlightCfi);
        await saveHighlightsSafely(bookId, highlights);
      } else if (_currentCfiRange) {
        const cfiRange = _currentCfiRange;
        // Issue 6: Prevent duplicate highlights
        const existingIdx = highlights.findIndex(h => h.cfi === cfiRange);
        if (existingIdx !== -1) {
          highlights[existingIdx].color = color;
          reRenderHighlight(cfiRange);
        } else {
          // Create new highlight
          const text = await getCfiText(cfiRange, rendition);
          if (!isCurrentContext(contextSeq, bookId, rendition)) return;
          const newHl = {
            cfi: cfiRange,
            text: text,
            color: color,
            note: '',
            timestamp: Date.now()
          };
          highlights.push(newHl);
          renderHighlight(newHl);
        }
        if (!isCurrentContext(contextSeq, bookId, rendition)) return;
        await saveHighlightsSafely(bookId, highlights);
        clearNativeSelection();
      }
      closeToolbar();
    });
  });

  // Handle click on existing highlight
  function handleHighlightClick(e, cfiRange) {
     e.stopPropagation();
     
     // v1.2.0: Lock internal action so doc click listener ignores this
     _internalAction = true;
     setTimeout(() => _internalAction = false, 50);

     _activeHighlightCfi = cfiRange;
     _currentCfiRange = null;

     const hl = highlights.find(h => h.cfi === cfiRange);
     if (hl) {
        // Indicate active color
        colorBtns.forEach(b => {
           if (b.dataset.color === hl.color) b.classList.add('active');
           else b.classList.remove('active');
        });
        btnClearHl.classList.remove('is-hidden');
        
        // Position below cursor or target
        const target = e.target;
        const rect = target.getBoundingClientRect();
        
        // Use the view container to get reliable coordinates
        const iframe = target.ownerDocument.defaultView.frameElement;
        const iframeRect = iframe ? iframe.getBoundingClientRect() : { top: 0, left: 0 };

        let top = iframeRect.top + rect.bottom + 10; // below highlight
        let left = iframeRect.left + rect.left + (rect.width / 2);

        // v1.2.0 Bounds Checking: Prevent toolbar offscreen bottom
        if (top + 50 > window.innerHeight) {
            top = iframeRect.top + rect.top - 60; // Flip above
        }

        toolbar.style.top = `${top}px`;
        toolbar.style.left = `${left}px`;
        toolbar.classList.add('show');

        // Optimization 1: If note exists, show the note popup too!
        if (hl.note) {
          // Provide bounds-checked coordinates for the note
          const anchorRect = { top: top, left: left };
          setTimeout(() => showNotePopup(hl, anchorRect), 50);
        }
     }
  }

  function showNotePopup(hl, anchorRect) {
      noteTextarea.value = hl.note || '';
      
      let top = anchorRect.top;
      let left = anchorRect.left;

      // v1.2.3 Bounds Checking: Dynamically apply .flip class if the upper space is insufficient for the growing popup.
      // The popup grows upwards (-100% translateY) by about 150px.
      if (top < 200) {
          top = anchorRect.top + 60; // Push down below selection
          notePopup.classList.add('flip');
      } else {
          notePopup.classList.remove('flip');
      }

      notePopup.style.top = `${top}px`;
      notePopup.style.left = `${left}px`;
      
      toolbar.classList.remove('show');
      notePopup.classList.add('show');
      noteTextarea.focus();
  }

  // Remove highlight
  btnClearHl.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (_activeHighlightCfi) {
          const contextSeq = _contextSeq;
          const bookId = _bookId;
          const rendition = _rendition;
          const activeCfi = _activeHighlightCfi;
          rendition.annotations.remove(activeCfi, "highlight");
          rendition.annotations.remove(activeCfi, "underline");
          _renderedHighlightCfis.delete(activeCfi);
          highlights = highlights.filter(h => h.cfi !== activeCfi);
          await saveHighlightsSafely(bookId, highlights);
          if (!isCurrentContext(contextSeq, bookId, rendition)) return;
          _activeHighlightCfi = null;
          _pendingCfi = null;
      }
      closeToolbar();
  });

  // Open note popup
  btnAddNote.addEventListener('click', (e) => {
      e.stopPropagation();
      _internalAction = true;
      setTimeout(() => _internalAction = false, 50);

      const targetCfi = _activeHighlightCfi || _currentCfiRange;
      if (!targetCfi) return;

      const hl = highlights.find(h => h.cfi === targetCfi);
      const tbRect = toolbar.getBoundingClientRect();
      showNotePopup(hl || { note: '' }, tbRect);
  });

  // Save note
  btnSaveNote.addEventListener('click', async () => {
      const targetCfi = _activeHighlightCfi || _pendingCfi;
      if (!targetCfi) {
          closeNotePopup();
          return;
      }

      const note = noteTextarea.value.trim();
      const contextSeq = _contextSeq;
      const bookId = _bookId;
      const rendition = _rendition;
      
      let hl = highlights.find(h => h.cfi === targetCfi);
      if (hl) {
          hl.note = note;
          updateHighlightData(targetCfi, { note });
          reRenderHighlight(targetCfi); // v1.2.2 Fix: Trigger UI redraw to show newly added note underline
      } else if (targetCfi) {
          // Issue 4: Save note even without highlight
          const text = await getCfiText(targetCfi, rendition);
          if (!isCurrentContext(contextSeq, bookId, rendition)) return;
          hl = {
              cfi: targetCfi,
              text: text,
              color: 'transparent', // Use transparent for note-only
              note: note,
              timestamp: Date.now()
          };
          highlights.push(hl);
          renderHighlight(hl);
          clearNativeSelection();
      }

      if (!isCurrentContext(contextSeq, bookId, rendition)) return;
      await saveHighlightsSafely(bookId, highlights);
      closeNotePopup();
  });

  btnCancelNote.addEventListener('click', closeNotePopup);

  async function getCfiText(cfiRange, rendition = _rendition) {
    if (!rendition || !rendition.book) return '';
    try {
      const range = await rendition.book.getRange(cfiRange);
      return range ? range.toString().trim() : '';
    } catch(e) {
      console.warn("Text extraction failed", e);
      return '';
    }
  }

  function renderAllHighlights() {
    highlights.forEach(hl => renderHighlight(hl));
  }

  function renderHighlight(hl) {
    let rendered = false;
    try {
        // 1. Always render the base highlight if it has a color
        if (!isNoteOnlyHighlight(hl)) {
            // D-1-H: sanitize color before passing to epub.js SVG fill attribute
            const safeColor = resolveHighlightColor(hl.color);
            _rendition.annotations.highlight(
                hl.cfi,
                {},
                (e) => handleHighlightClick(e, hl.cfi),
                "epubjs-hl-base",
                { "fill": safeColor, "fill-opacity": "0.4" }
            );
            rendered = true;
        }

        // 2. If it has a note, render a dashed underline
        if (hl.note) {
            const className = isNoteOnlyHighlight(hl) ? "epubjs-hl-note-only" : "epubjs-hl-with-note";
            _rendition.annotations.underline(
                hl.cfi,
                {},
                (e) => handleHighlightClick(e, hl.cfi),
                className,
                {} // Styles handled by CSS class
            );
            rendered = true;
        }
        if (rendered) {
            _renderedHighlightCfis.add(hl.cfi);
        }
    } catch (e) {
        console.warn("Could not render highlight, possibly CFI invalid in current view", e);
    }
  }

  function clearRenderedHighlights() {
    if (!_rendition || !_rendition.annotations) {
      _renderedHighlightCfis.clear();
      return;
    }

    _renderedHighlightCfis.forEach(cfi => {
      try {
        _rendition.annotations.remove(cfi, "highlight");
        _rendition.annotations.remove(cfi, "underline");
      } catch (_) {}
    });
    _renderedHighlightCfis.clear();
  }

  function reRenderHighlight(cfi) {
    try {
      _rendition.annotations.remove(cfi, "highlight");
      _rendition.annotations.remove(cfi, "underline");
      _renderedHighlightCfis.delete(cfi);
      const hl = highlights.find(h => h.cfi === cfi);
      if (hl) renderHighlight(hl);
    } catch (e) { console.warn('[Highlights] reRenderHighlight failed for cfi:', cfi, e); }
  }

  function updateHighlightData(cfi, data) {
      const idx = highlights.findIndex(h => h.cfi === cfi);
      if (idx !== -1) {
          if (data.color) highlights[idx].color = data.color;
          if (data.note !== undefined) highlights[idx].note = data.note;
      }
  }

  function clearNativeSelection() {
     if (_rendition && _rendition.manager) {
        const views = _rendition.manager.views;
        if (views && views.length > 0) {
           // v1.2.0 Fix: Clear selection in ALL views for multi-column layouts
           views.forEach(v => {
               const win = v?.document?.defaultView;
               if (win && win.getSelection) {
                   win.getSelection().removeAllRanges();
               }
           });
        }
     }
  }

  function closeToolbar() {
    toolbar.classList.remove('show');
    // Don't clear _currentCfiRange immediately to allow note-taking
    // It will be cleared when a new selection happens or explicitly if needed
  }
  
  function closeNotePopup() {
    notePopup.classList.remove('show');
    _pendingCfi = null;
  }

  function closePanels() {
     closeToolbar();
     closeNotePopup();
     // v1.2.0: Atomically destroy CFI state locking so panel refuses to repoen
     _activeHighlightCfi = null;
     _currentCfiRange = null;
  }

  function mount(context) {
    if (!context) return;
    setBookDetails(context.bookId, context.fileName, context.rendition);
  }

  function unmount() {
    _contextSeq++;
    if (_rendition) {
      try { _rendition.off('selected', handleSelection); } catch (_) {}
    }
    clearRenderedHighlights();
    closePanels();
    highlights = [];
    _bookId = '';
    _fileName = '';
    _rendition = null;
  }

  return {
    init: init,
    setBookDetails: setBookDetails,
    closePanels: closePanels,
    mount: mount,
    unmount: unmount
  };
})();
