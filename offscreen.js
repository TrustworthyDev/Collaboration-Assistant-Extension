// Offscreen document: reads the clipboard text for the background service worker by
// pasting it into a textarea (needs the "clipboardRead" permission).
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'offscreen-read-clipboard') return undefined;
  const box = document.getElementById('clipboard');
  box.value = '';
  box.focus();
  let text = '';
  try {
    if (document.execCommand('paste')) text = box.value;
  } catch (_) {
    text = '';
  }
  box.value = '';
  sendResponse(text);
  return undefined;
});
