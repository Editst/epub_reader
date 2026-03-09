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

  const toolbar = document.getElementById('selection-toolbar');
  const btnAddNote = document.getElementById('btn-add-note');
  const btnClearHl = document.getElementById('btn-clear-hl');
  const colorBtns = toolbar.querySelectorAll('.color-btn');
  const btnCloseToolbar = document.createElement('button'); // New hidden close button or just refinement
  
  let _pendingCfi = null; // Store CFI for note-taking before highlight is created
  let _internalAction = false; // v1.2.0: Strict sync lock to prevent panel persistence

  const notePopup = document.getElementById('note-popup');
  const noteTextarea = document.getElementById('note-textarea');
  const btnCancelNote = document.getElementById('btn-cancel-note');
  const btnSaveNote = document.getElementById('btn-save-note');

  let highlights = [];

  function init() {}

  async function setBookDetails(bookId, fileName, rendition) {
    _bookId = bookId;
    _fileName = fileName;
    _rendition = rendition;
    
    // Load existing highlights
    highlights = await EpubStorage.getHighlights(bookId) || [];
    renderAllHighlights();

    // Listen to selection event from epub.js
    _rendition.on('selected', handleSelection);
    
    // CRITICAL: Fallback for selection and click stability
    _rendition.hooks.content.register((contents) => {
        const doc = contents.document;
        doc.addEventListener('click', (e) => {
            // Give a tiny delay for selection to be processed
            setTimeout(() => {
                const selection = contents.window.getSelection();
                if (selection && !selection.isCollapsed) {
                   // Selected event should fire, but if it doesn't, we can trigger manually
                   // Or just ensure we have the right context
                } else {
                   // Click away
                   if (!toolbar.classList.contains('show') && !notePopup.classList.contains('show')) return;
                   
                   // v1.2.0: If the click was part of our internal UI actions (like clicking a highlight), do not close.
                   if (_internalAction) return;

                   // If it's a genuine click on the blank page with no selection, NUKE everything.
                   closePanels();
                }
            }, 10);
        });
    });

    // Handle the "Modify Highlight" button in note popup
    const btnShowToolbar = document.getElementById('btn-show-toolbar');
    if (btnShowToolbar) {
        btnShowToolbar.addEventListener('click', (e) => {
            e.stopPropagation();
            _internalAction = true;
            setTimeout(() => _internalAction = false, 50);

            const targetCfi = _activeHighlightCfi || _pendingCfi;
            if (targetCfi) {
                // v1.2.0 Fix: Instead of recalculating via getRange (which crashes on page turns),
                // we simply reuse the notePopup's exact current physical position!
                const rect = notePopup.getBoundingClientRect();
                
                _activeHighlightCfi = targetCfi; // Ensure state is locked
                closeNotePopup(); // Hide note
                
                // Show toolbar at exactly the same place
                toolbar.style.top = `${rect.top}px`;
                toolbar.style.left = `${rect.left + (rect.width / 2)}px`; // Center align
                
                const hl = highlights.find(h => h.cfi === targetCfi);
                if (hl) {
                    colorBtns.forEach(b => {
                        if (b.dataset.color === hl.color) b.classList.add('active');
                        else b.classList.remove('active');
                    });
                }
                btnClearHl.style.display = 'flex';
                toolbar.classList.add('show');
            }
        });
    }

    // Global listener for clicking outside on the main window
    window.addEventListener('mousedown', (e) => {
        if (!toolbar.contains(e.target) && !notePopup.contains(e.target)) {
            closeToolbar();
            closeNotePopup();
            _activeHighlightCfi = null;
            _currentCfiRange = null;
        }
    });
  }

  // Deprecated in v1.2.0 in favor of direct rect inheritance for Modify Button,
  // but kept for potential future API use
  async function showToolbarForHighlight(cfiRange) {
     const hl = highlights.find(h => h.cfi === cfiRange);
     if (!hl) return;

     colorBtns.forEach(b => {
        if (b.dataset.color === hl.color) b.classList.add('active');
        else b.classList.remove('active');
     });
     btnClearHl.style.display = 'flex';

     // Find the element for coordinates using the CFI
     try {
         const range = await _rendition.book.getRange(cfiRange);
         if (range) {
             const rect = range.getBoundingClientRect();
             // Find which iframe contains this range
             const views = _rendition.manager.views;
             let iframeRect = { top: 0, left: 0 };
             
             // Try to find the iframe that matches the range context
             if (views && views.length > 0) {
                 const iframe = views[0].document.defaultView.frameElement;
                 if (iframe) iframeRect = iframe.getBoundingClientRect();
             }

             const top = iframeRect.top + rect.bottom + 10;
             const left = iframeRect.left + rect.left + (rect.width / 2);

             toolbar.style.top = `${top}px`;
             toolbar.style.left = `${left}px`;
             toolbar.classList.add('show');
         } else {
             // Fallback if range fails
             toolbar.classList.add('show');
         }
     } catch (e) {
         console.warn("Failed to get range for toolbar positioning", e);
         toolbar.classList.add('show');
     }
  }

  function handleSelection(cfiRange, contents) {
    _currentCfiRange = cfiRange;
    _pendingCfi = cfiRange; // Track this for note-taking
    _activeHighlightCfi = null;
    
    // Clear active color state
    colorBtns.forEach(b => b.classList.remove('active'));
    btnClearHl.style.display = 'none';

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
      
      if (_activeHighlightCfi) {
        // Change color of existing
        updateHighlightData(_activeHighlightCfi, { color });
        reRenderHighlight(_activeHighlightCfi);
        await EpubStorage.saveHighlights(_bookId, highlights);
      } else if (_currentCfiRange) {
        // Issue 6: Prevent duplicate highlights
        const existingIdx = highlights.findIndex(h => h.cfi === _currentCfiRange);
        if (existingIdx !== -1) {
          highlights[existingIdx].color = color;
          reRenderHighlight(_currentCfiRange);
        } else {
          // Create new highlight
          const text = await getCfiText(_currentCfiRange);
          const newHl = {
            cfi: _currentCfiRange,
            text: text,
            color: color,
            note: '',
            timestamp: Date.now()
          };
          highlights.push(newHl);
          renderHighlight(newHl);
        }
        await EpubStorage.saveHighlights(_bookId, highlights);
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
        btnClearHl.style.display = 'flex';
        
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

      // v1.2.0 Bounds Checking: If highlight is at the very top of screen, 
      // the note popup will overflow above viewport. Push it down.
      if (top < 10) {
          top = anchorRect.top + 60; // Push down below selection
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
          _rendition.annotations.remove(_activeHighlightCfi, "highlight");
          _rendition.annotations.remove(_activeHighlightCfi, "underline");
          highlights = highlights.filter(h => h.cfi !== _activeHighlightCfi);
          await EpubStorage.saveHighlights(_bookId, highlights);
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
      
      let hl = highlights.find(h => h.cfi === targetCfi);
      if (hl) {
          hl.note = note;
          updateHighlightData(targetCfi, { note });
      } else if (targetCfi) {
          // Issue 4: Save note even without highlight
          const text = await getCfiText(targetCfi);
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

      await EpubStorage.saveHighlights(_bookId, highlights);
      closeNotePopup();
  });

  btnCancelNote.addEventListener('click', closeNotePopup);

  async function getCfiText(cfiRange) {
    if (!_rendition || !_rendition.book) return '';
    try {
      const range = await _rendition.book.getRange(cfiRange);
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
    try {
        // 1. Always render the base highlight if it has a color
        if (hl.color !== 'transparent') {
            _rendition.annotations.highlight(
                hl.cfi, 
                {}, 
                (e) => handleHighlightClick(e, hl.cfi), 
                "epubjs-hl-base", 
                { "fill": hl.color, "fill-opacity": "0.4" }
            );
        }

        // 2. If it has a note, render a dashed underline
        if (hl.note) {
            const className = (hl.color === 'transparent') ? "epubjs-hl-note-only" : "epubjs-hl-with-note";
            _rendition.annotations.underline(
                hl.cfi,
                {},
                (e) => handleHighlightClick(e, hl.cfi),
                className,
                {} // Styles handled by CSS class
            );
        }
    } catch (e) {
        console.warn("Could not render highlight, possibly CFI invalid in current view", e);
    }
  }

  function reRenderHighlight(cfi) {
    try {
      _rendition.annotations.remove(cfi, "highlight");
      _rendition.annotations.remove(cfi, "underline");
      const hl = highlights.find(h => h.cfi === cfi);
      if (hl) renderHighlight(hl);
    } catch (e) {}
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

  return {
    init: init,
    setBookDetails: setBookDetails,
    closePanels: closePanels
  };
})();
