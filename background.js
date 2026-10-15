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

// The service worker has no page to paste into, and a content script reading the
// clipboard would make the mail site ask for permission. An offscreen document of the
// extension reads it instead (see offscreen.js).
let creatingOffscreen = null;

async function ensureOffscreen() {
  const open = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (open.length) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: 'offscreen.html',
        reasons: ['CLIPBOARD'],
        justification: 'Auto Fill puts an email address you copied into the To box.',
      })
      .finally(() => { creatingOffscreen = null; });
  }
  await creatingOffscreen;
}

async function readClipboard() {
  await ensureOffscreen();
  const text = await chrome.runtime.sendMessage({ type: 'offscreen-read-clipboard' });
  return typeof text === 'string' ? text : '';
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'open-settings') openSettings(message.field, sender.tab);
  if (message && message.type === 'read-clipboard') {
    readClipboard().then((text) => sendResponse({ text }), () => sendResponse({ text: '' }));
    return true;
  }
  return undefined;
});
