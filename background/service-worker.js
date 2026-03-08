// EPUB Reader - Service Worker (Manifest V3)
// Handles extension lifecycle events

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('EPUB Reader extension installed.');
  }
});

// Open reader page when extension icon is clicked (fallback if popup is disabled)
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.create({
    url: chrome.runtime.getURL('reader/reader.html')
  });
});
