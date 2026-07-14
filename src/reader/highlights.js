/**
 * EPUB Reader - Highlights and Annotations Module
 * Handles text selection, colored highlights, and custom note taking.
 */
(function () {
  'use strict';

  const INTERNAL_ACTION_LOCK_MS = 50;
  const IFRAME_CLICK_SETTLE_MS = 10;
  const FLOATING_UI_GAP_PX = 10;
  const NOTE_POPUP_FLIP_THRESHOLD_PX = 200;
  const NOTE_POPUP_FLIP_OFFSET_PX = 60;
  const TOOLBAR_ESTIMATED_HEIGHT_PX = 50;

  let _rendition = null;
  let _bookId = '';
  let _currentCfiRange = null;
  let _activeHighlightCfi = null;
  let _renderedHighlightCfis = new Set();
  let _boundDocument = null;
  let _contextSeq = 0;
  const _hookedRenditions = new WeakSet();
  const _hookedContentDocuments = new WeakSet();

  let toolbar = null;
  let btnAddNote = null;
  let btnClearHl = null;
  let colorBtns = [];

  let _pendingCfi = null;
  let _internalAction = false;
  let _internalActionSeq = 0;

  let notePopup = null;
  let noteTextarea = null;
  let btnCancelNote = null;
  let btnSaveNote = null;

  let highlights = [];

  function isCurrentContext(contextSeq, bookId, rendition) {
    return contextSeq === _contextSeq && bookId === _bookId && (!rendition || rendition === _rendition);
  }

  function beginInternalAction() {
    const actionSeq = ++_internalActionSeq;
    _internalAction = true;
    setTimeout(() => {
      if (actionSeq === _internalActionSeq) _internalAction = false;
    }, INTERNAL_ACTION_LOCK_MS);
  }

  function resetInternalAction() {
    _internalActionSeq++;
    _internalAction = false;
  }

  function saveHighlightsSafely(bookId, nextHighlights) {
    return Utils.safeWrite(
      () => EpubStorage.saveHighlights(bookId, nextHighlights),
      '[Highlights] save highlights failed:'
    );
  }

  function isNoteOnlyHighlight(hl) {
    return hl && hl.color === 'transparent';
  }

  function init() {
    if (_boundDocument === document) return;

    toolbar = document.getElementById('selection-toolbar');
    btnAddNote = document.getElementById('btn-add-note');
    btnClearHl = document.getElementById('btn-clear-hl');
    colorBtns = toolbar.querySelectorAll('.color-btn');
    notePopup = document.getElementById('note-popup');
    noteTextarea = document.getElementById('note-textarea');
    btnCancelNote = document.getElementById('btn-cancel-note');
    btnSaveNote = document.getElementById('btn-save-note');
    bindDomEvents();

    // 顶层监听只在 init 中绑定一次，避免切书或切换布局时重复累积。

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
    _boundDocument = document;
  }

  function _onWindowMouseDown(e) {
    if (!toolbar.contains(e.target) && !notePopup.contains(e.target)) {
      if (e.target.closest('#header-bar') || e.target.closest('#sidebar') || e.target.closest('.bottom-bar')) {
        return;
      }
      closePanels();
    }
  }

  function _onShowToolbarClick(e) {
    e.stopPropagation();
    beginInternalAction();

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

  async function setBookDetails(bookId, rendition) {
    // 切书或布局重建前移除旧 rendition 监听，避免重复选择处理和残留注解。
    if (_rendition) {
      try { _rendition.off('selected', handleSelection); } catch (_) {}
      clearRenderedHighlights();
    }

    const contextSeq = ++_contextSeq;
    _bookId = bookId;
    _rendition = rendition;
    resetInternalAction();
    
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
      const hookedRendition = _rendition;
      _rendition.hooks.content.register((contents) => {
        if (_rendition !== hookedRendition) return;
        bindContentMouseDown(contents, _contextSeq, _bookId, hookedRendition);
      });
    }

    if (typeof _rendition.getContents === 'function') {
      _rendition.getContents().forEach((contents) => {
        bindContentMouseDown(contents, contextSeq, bookId, rendition);
      });
    }
  }

  function bindContentMouseDown(contents, contextSeq, bookId, rendition) {
    const doc = contents && contents.document;
    if (!doc || _hookedContentDocuments.has(doc)) return;
    _hookedContentDocuments.add(doc);

    // iframe 获得焦点时可能吞掉 click，因此使用 mousedown 收口悬浮层状态。
    doc.addEventListener('mousedown', () => {
      if (!isCurrentContext(contextSeq, bookId, rendition)) return;
      setTimeout(() => {
        if (!isCurrentContext(contextSeq, bookId, rendition)) return;
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
      }, IFRAME_CLICK_SETTLE_MS);
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
      
      // contents.element 是正文包装层；frameElement 才是用于换算坐标的 iframe。
      const iframe = contents.window.frameElement;
      const iframeRect = iframe ? iframe.getBoundingClientRect() : { top: 0, left: 0 };

      const top = iframeRect.top + rect.top - FLOATING_UI_GAP_PX;
      const left = iframeRect.left + rect.left + (rect.width / 2);

      toolbar.style.top = `${top}px`;
      toolbar.style.left = `${left}px`;
      toolbar.classList.add('show');
    }
  }

  function bindDomEvents() {
    // Handle color selection
    colorBtns.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const color = btn.dataset.color;
        const contextSeq = _contextSeq;
        const bookId = _bookId;
        const rendition = _rendition;

        if (_activeHighlightCfi) {
          updateHighlightData(_activeHighlightCfi, { color });
          reRenderHighlight(_activeHighlightCfi);
          await saveHighlightsSafely(bookId, highlights);
        } else if (_currentCfiRange) {
          const cfiRange = _currentCfiRange;
          const existingIdx = highlights.findIndex(h => h.cfi === cfiRange);
          if (existingIdx !== -1) {
            highlights[existingIdx].color = color;
            reRenderHighlight(cfiRange);
          } else {
            const text = await getCfiText(cfiRange, rendition);
            if (!isCurrentContext(contextSeq, bookId, rendition)) return;
            const newHl = {
              cfi: cfiRange,
              text,
              color,
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

    btnClearHl.addEventListener('click', handleClearHighlight);
    btnAddNote.addEventListener('click', handleAddNote);
    btnSaveNote.addEventListener('click', handleSaveNote);
    btnCancelNote.addEventListener('click', closeNotePopup);
  }

  // Handle click on existing highlight
  function handleHighlightClick(e, cfiRange, context) {
     if (!isCurrentContext(context.seq, context.bookId, context.rendition)) return;
     e.stopPropagation();
     
     // 内部交互期间暂时阻止 iframe 空白点击关闭悬浮层。
     beginInternalAction();

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

        let top = iframeRect.top + rect.bottom + FLOATING_UI_GAP_PX;
        let left = iframeRect.left + rect.left + (rect.width / 2);

        if (top + TOOLBAR_ESTIMATED_HEIGHT_PX > window.innerHeight) {
            top = iframeRect.top + rect.top - NOTE_POPUP_FLIP_OFFSET_PX;
        }

        toolbar.style.top = `${top}px`;
        toolbar.style.left = `${left}px`;
        toolbar.classList.add('show');

        // Optimization 1: If note exists, show the note popup too!
        if (hl.note) {
          // Provide bounds-checked coordinates for the note
          const anchorRect = { top: top, left: left };
          setTimeout(() => {
            if (!isCurrentContext(context.seq, context.bookId, context.rendition)) return;
            showNotePopup(hl, anchorRect);
          }, 50);
        }
     }
  }

  function showNotePopup(hl, anchorRect) {
      noteTextarea.value = hl.note || '';
      
      let top = anchorRect.top;
      let left = anchorRect.left;

      // 上方空间不足时切换为向下展开。
      if (top < NOTE_POPUP_FLIP_THRESHOLD_PX) {
          top = anchorRect.top + NOTE_POPUP_FLIP_OFFSET_PX;
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

  async function handleClearHighlight(e) {
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
  }

  function handleAddNote(e) {
      e.stopPropagation();
      beginInternalAction();

      const targetCfi = _activeHighlightCfi || _currentCfiRange;
      if (!targetCfi) return;

      const hl = highlights.find(h => h.cfi === targetCfi);
      const tbRect = toolbar.getBoundingClientRect();
      showNotePopup(hl || { note: '' }, tbRect);
  }

  async function handleSaveNote() {
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
          reRenderHighlight(targetCfi); // 新增笔记后同步刷新虚线下划线
      } else if (targetCfi) {
          // 允许无可见高亮的纯笔记。
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
  }

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
    const clickContext = {
      seq: _contextSeq,
      bookId: _bookId,
      rendition: _rendition
    };
    try {
        // 1. Always render the base highlight if it has a color
        if (!isNoteOnlyHighlight(hl)) {
            // 进入 epub.js SVG fill 前保证颜色合法且可见。
            const safeColor = Utils.resolveDisplayColor(hl.color);
            _rendition.annotations.highlight(
                hl.cfi,
                {},
                (e) => handleHighlightClick(e, hl.cfi, clickContext),
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
                (e) => handleHighlightClick(e, hl.cfi, clickContext),
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
           // 多栏布局可能同时持有多个 view，必须逐一清除原生选区。
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
     // 原子清除 CFI 状态，避免已关闭面板被旧状态重新打开。
     _activeHighlightCfi = null;
     _currentCfiRange = null;
  }

  function mount(context) {
    if (!context) return;
    return setBookDetails(context.bookId, context.rendition);
  }

  function unmount() {
    _contextSeq++;
    resetInternalAction();
    if (_rendition) {
      try { _rendition.off('selected', handleSelection); } catch (_) {}
    }
    clearRenderedHighlights();
    closePanels();
    highlights = [];
    _bookId = '';
    _rendition = null;
  }

  const Highlights = {
    init: init,
    setBookDetails: setBookDetails,
    closePanels: closePanels,
    mount: mount,
    unmount: unmount
  };

  window.Highlights = Highlights;
})();
