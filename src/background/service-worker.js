// EPUB Reader - Service Worker (Manifest V3)
// Handles extension lifecycle events.
//
// D-1-D: Removed the chrome.action.onClicked listener that was dead code.
// When manifest.json specifies action.default_popup, Chrome opens the popup
// on icon click and the onClicked event is NEVER fired (MV3 spec).
// Keeping it misled maintainers into thinking two entry points were active.

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('EPUB Reader extension installed.');
  }
});
