// Binds the controls of the popup and options page to storage. Every edit is saved
// immediately, so closing the popup never loses text.

// Tabs: [role="tab"] buttons whose aria-controls names their panel. The last tab used
// is remembered per page.
function initTabs() {
  'use strict';

  const tabs = [...document.querySelectorAll('[role="tab"]')];
  if (!tabs.length) return;
  const storageKey = 'tab:' + location.pathname;

  function select(tab, focus) {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    }
    if (focus) tab.focus();
    try { localStorage.setItem(storageKey, tab.id); } catch (_) { /* storage blocked */ }
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      const step = event.key === 'ArrowRight' ? 1 : -1;
      select(tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length], true);
    });
  }

  let saved = null;
  try { saved = localStorage.getItem(storageKey); } catch (_) { saved = null; }
  select(tabs.find((t) => t.id === saved) || tabs[0]);
}

globalThis.bindSettingsForm = async function bindSettingsForm() {
  'use strict';

  initTabs();

  const P = globalThis.PresetPaste;
  const settings = await P.load();
  const status = document.querySelector('[data-status]');
  let statusTimer = 0;

  function flashSaved() {
    if (!status) return;
    status.textContent = 'Saved';
    status.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => status.classList.remove('show'), 1200);
  }

  async function persist(key) {
    await P.save({ [key]: settings[key] });
    flashSaved();
  }

  const presetInputs = [...document.querySelectorAll('[data-preset]')];
  const selectorInputs = [...document.querySelectorAll('[data-selector]')];
  const sitesInput = document.querySelector('[data-disabled-sites]');
  const listInput = document.querySelector('[data-email-list]');

  function setText(selector, text) {
    for (const el of document.querySelectorAll(selector)) el.textContent = text;
  }

  // Next address, progress and button states of the email list.
  function renderList() {
    const info = P.listInfo(settings);
    const total = info.entries.length;
    setText('[data-list-next]', info.next ? info.next.text : total ? 'All emails used' : 'No emails yet');
    setText('[data-list-progress]', total ? `${info.used} of ${total} used` : 'Add addresses below, one per line');
    setText('[data-list-count]', total ? String(total - info.used) : '');
    setText('[data-list-invalid]', info.invalid
      ? `${info.invalid} line${info.invalid === 1 ? '' : 's'} without an email address will be skipped.`
      : '');
    for (const note of document.querySelectorAll('[data-to-note]')) {
      note.textContent = info.next
        ? `To comes from your email list (next: ${info.next.text}). This box is used once the list runs out.`
        : '';
      note.hidden = !info.next;
    }
    for (const button of document.querySelectorAll('[data-list-action]')) {
      button.disabled = button.dataset.listAction === 'skip' ? !info.next : settings.listUsed.length === 0;
    }
  }

  function render() {
    for (const el of presetInputs) {
      if (el !== document.activeElement) el.value = settings.presets[el.dataset.preset] || '';
    }
    for (const el of selectorInputs) {
      if (el !== document.activeElement) el.value = settings.selectors[el.dataset.selector] || '';
    }
    if (sitesInput && sitesInput !== document.activeElement) {
      sitesInput.value = settings.disabledSites.join('\n');
    }
    if (listInput && listInput !== document.activeElement) listInput.value = settings.emailList;
    renderList();
  }

  for (const el of presetInputs) {
    el.addEventListener('input', () => {
      settings.presets[el.dataset.preset] = el.value;
      persist('presets');
    });
  }
  for (const el of selectorInputs) {
    el.addEventListener('input', () => {
      settings.selectors[el.dataset.selector] = el.value.trim();
      persist('selectors');
    });
  }
  if (sitesInput) {
    sitesInput.addEventListener('input', () => {
      settings.disabledSites = sitesInput.value.split('\n').map(P.normalizeSite).filter(Boolean);
      persist('disabledSites');
    });
    sitesInput.addEventListener('blur', render);
  }
  if (listInput) {
    listInput.addEventListener('input', () => {
      settings.emailList = listInput.value;
      persist('emailList');
      renderList();
    });
  }

  for (const button of document.querySelectorAll('[data-list-action]')) {
    button.addEventListener('click', () => {
      const next = P.listInfo(settings).next;
      const action = button.dataset.listAction;
      if (action === 'skip' && next) settings.listUsed = [...settings.listUsed, next.key];
      else if (action === 'undo') settings.listUsed = settings.listUsed.slice(0, -1);
      else if (action === 'reset') settings.listUsed = [];
      persist('listUsed');
      renderList();
    });
  }

  // Keep the popup and options page in sync with each other and with the mail tab,
  // which moves the email list on as addresses are used.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const current = {};
    for (const key of P.KEYS) current[key] = changes[key] ? changes[key].newValue : settings[key];
    Object.assign(settings, P.merge(current));
    render();
  });

  render();

  // Opened from the in-page "Set up" button: show and focus the field that was clicked.
  try {
    const { focusField } = await chrome.storage.session.get('focusField');
    if (focusField) {
      await chrome.storage.session.remove('focusField');
      const target = presetInputs.find((el) => el.dataset.preset === focusField);
      const panel = target && target.closest('[role="tabpanel"]');
      if (panel && panel.hidden) document.querySelector(`[role="tab"][aria-controls="${panel.id}"]`).click();
      if (target) target.focus();
    }
  } catch (_) {
    // Session storage unavailable; nothing to focus.
  }

  return { settings, persist, render };
};
