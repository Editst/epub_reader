(function () {
  'use strict';

  function createReaderState() {
    return {
      book: null,
      rendition: null,
      currentBookId: '',
      currentFileName: '',
      isBookLoaded: false,
      currentStableCfi: null,
      isResizing: false,
      navLock: false,
      readingTimer: null,
      activeReadingSeconds: 0,
      cachedSpeed: null,
      sessionStart: null,
      lastProgress: 0,
      posTimer: null,
      lastPercent: null,
      prefs: {
        theme: 'light',
        fontSize: 18,
        lineHeight: 1.8,
        fontFamily: '',
        layout: 'paginated',
        customBg: '#ffffff',
        customText: '#333333'
      }
    };
  }

  function resetReadingSession(state) {
    state.activeReadingSeconds = 0;
    state.cachedSpeed = null;
    state.sessionStart = null;
    state.lastProgress = 0;
    state.lastPercent = null;
    if (state.readingTimer) {
      clearInterval(state.readingTimer);
      state.readingTimer = null;
    }
  }

  window.ReaderState = {
    createReaderState,
    resetReadingSession
  };
})();
