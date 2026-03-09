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
    
    // Listen to click outside inside iframe
    _rendition.on('click', (e) => {
       // Issue 2: If we click anything, we check if it's the toolbar
       // But 'click' on rendition is inside iframe. Toolbar is in parent.
       // Usually clicking inside iframe should close parent toolbars UNLESS it's a specific interaction.
       if (_activeHighlightCfi || _currentCfiRange) {
         // If there's an active selection or highlight being edited, 
         // we might want to close if clicking away.
         closeToolbar();
         closeNotePopup();
       }
    });
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
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      
      // CRITICAL FIX (Optimization 3): Use the iframe's current rect in the main window
      // contents.element is the iframe (or its wrapper). In paginated mode, its left changes!
      const iframeRect = contents.element.getBoundingClientRect();

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
        const view = _rendition.manager.views._views.find(v => v.document.contains(target));
        const viewRect = view ? view.element.getBoundingClientRect() : { top: 0, left: 0 };

        const top = viewRect.top + rect.bottom + 10; // below highlight
        const left = viewRect.left + rect.left + (rect.width / 2);

        toolbar.style.top = `${top}px`;
        toolbar.style.left = `${left}px`;
        toolbar.classList.add('show');

        // Optimization 1: If note exists, show the note popup too!
        if (hl.note) {
          setTimeout(() => showNotePopup(hl, toolbar.getBoundingClientRect()), 50);
        }
     }
  }

  function showNotePopup(hl, anchorRect) {
      noteTextarea.value = hl.note || '';
      notePopup.style.top = `${anchorRect.top}px`;
      notePopup.style.left = `${anchorRect.left}px`;
      
      toolbar.classList.remove('show');
      notePopup.classList.add('show');
      noteTextarea.focus();
  }

  // Remove highlight
  btnClearHl.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (_activeHighlightCfi) {
          _rendition.annotations.remove(_activeHighlightCfi, "highlight");
          highlights = highlights.filter(h => h.cfi !== _activeHighlightCfi);
          await EpubStorage.saveHighlights(_bookId, highlights);
      }
      closeToolbar();
  });

  // Open note popup
  btnAddNote.addEventListener('click', (e) => {
      e.stopPropagation();
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
        let className = "";
        if (hl.color === 'transparent') {
            className = "epubjs-hl-note-only";
        } else if (hl.note) {
            className = "epubjs-hl-with-note";
        }

        _rendition.annotations.highlight(
            hl.cfi, 
            {}, 
            (e) => handleHighlightClick(e, hl.cfi), 
            className, 
            { "fill": hl.color, "fill-opacity": "0.4" }
        );
    } catch (e) {
        console.warn("Could not render highlight, possibly CFI invalid in current view", e);
    }
  }

  function reRenderHighlight(cfi) {
    try {
      _rendition.annotations.remove(cfi, "highlight");
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
           const win = views[0].document.defaultView;
           if (win.getSelection) win.getSelection().removeAllRanges();
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

  return {
    init: init,
    setBookDetails: setBookDetails,
    closePanels: function() {
       closeToolbar();
       closeNotePopup();
    }
  };
})();
