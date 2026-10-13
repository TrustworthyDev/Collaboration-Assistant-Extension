// Background service worker.

const CONTENT_FILES = ['common.js', 'content.js'];

// Chrome only injects content scripts into pages loaded after install, so mail tabs
// that are already open would show nothing until reloaded. Inject into them now.
async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map((tab) =>
      chrome.scripting
        .executeScript({ target: { tabId: tab.id, allFrames: true }, files: CONTENT_FILES })
        .catch(() => {
          // chrome:// pages, the Web Store, discarded tabs, ...: nothing to do.
        }),
    ),
  );
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install' || reason === 'update') injectIntoOpenTabs();
});

// The in-page "Set up" button asks for the settings; open the toolbar popup with the
// clicked field focused, or the options page if the popup cannot be opened.
async function openSettings(field, tab) {
  await chrome.storage.session.set({ focusField: field || '' });
  try {
    await chrome.action.openPopup(tab ? { windowId: tab.windowId } : {});
  } catch (_) {
    await chrome.runtime.openOptionsPage();
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message && message.type === 'open-settings') openSettings(message.field, sender.tab);
});
