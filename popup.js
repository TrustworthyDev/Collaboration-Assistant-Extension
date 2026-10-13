(async () => {
  'use strict';

  const P = globalThis.PresetPaste;
  const form = await globalThis.bindSettingsForm();
  const toggle = document.getElementById('site-toggle');
  const hostLabel = document.getElementById('site-host');

  document.getElementById('open-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  let hostname = '';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab && tab.url ? tab.url : '');
    if (url.protocol === 'http:' || url.protocol === 'https:') hostname = url.hostname;
  } catch (_) {
    hostname = '';
  }

  if (!hostname) {
    hostLabel.textContent = 'Not available on this page';
    return;
  }

  hostLabel.textContent = hostname;
  toggle.disabled = false;
  toggle.checked = !P.siteMatches(hostname, form.settings.disabledSites);

  toggle.addEventListener('change', () => {
    if (toggle.checked) {
      // Drop every entry that covers this host (the host itself or a parent domain).
      form.settings.disabledSites = form.settings.disabledSites.filter(
        (site) => !P.siteMatches(hostname, [site]),
      );
    } else {
      form.settings.disabledSites.push(hostname);
    }
    form.persist('disabledSites');
  });
})();
