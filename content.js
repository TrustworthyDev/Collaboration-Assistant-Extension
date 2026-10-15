// Shows a floating "Paste" button on the To / Subject / Message fields of an email
// composer, and an "Auto Fill" button in the composer's header that fills all three.
(() => {
  'use strict';

  // A newer copy of this script (extension reloaded or updated) replaces the old one.
  if (typeof globalThis.__presetPasteTeardown === 'function') {
    try { globalThis.__presetPasteTeardown(); } catch (_) { /* old copy already gone */ }
  }

  const { FIELDS, KEYS, merge, siteMatches, emailKey, listInfo } = globalThis.PresetPaste;
  const FIELD_NAMES = { to: 'To', subject: 'Subject', body: 'Message' };
  const TEXT_INPUT_TYPES = new Set(['text', 'email', 'search', 'url', 'tel']);
  const EDITABLE_SELECTOR =
    'input, textarea, [contenteditable]:not([contenteditable="false"])';
  const DESCRIBING_ATTRS = [
    'aria-label', 'placeholder', 'aria-placeholder', 'data-placeholder',
    'name', 'id', 'title', 'data-testid', 'data-test-id', 'data-test',
  ];
  const FIELD_BUTTON_TAG = 'preset-paste-button';
  const AUTOFILL_BUTTON_TAG = 'preset-autofill-button';
  const isTopFrame = window === window.top;

  let settings = merge({});
  let loaded = false;
  let siteDisabled = false;
  let alive = true;
  let autoFilling = false;
  const cleanups = [];

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
  }

  function teardown() {
    if (!alive) return;
    alive = false;
    hideFieldButton();
    if (field.ui) field.ui.remove();
    clearComposers();
    clearTimeout(scanTimer);
    for (const fn of cleanups.splice(0)) {
      try { fn(); } catch (_) { /* extension context may be gone */ }
    }
    if (globalThis.__presetPasteTeardown === teardown) delete globalThis.__presetPasteTeardown;
  }
  globalThis.__presetPasteTeardown = teardown;

  // False once the extension has been reloaded or removed; this copy is then orphaned.
  function extensionAlive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  }

  // ---------------------------------------------------------------- settings

  // Frames (e.g. an iframe-based message editor) follow the top-level site's setting.
  function topHostname() {
    try {
      return window.top.location.hostname;
    } catch (_) {
      const origins = location.ancestorOrigins;
      if (origins && origins.length) {
        try { return new URL(origins[origins.length - 1]).hostname; } catch (_) { /* fall through */ }
      }
      return location.hostname;
    }
  }

  function hasPresetText(type) {
    return String(settings.presets[type] || '').trim() !== '';
  }

  // To has something to paste when the email list has an unused address or the To preset is set.
  function hasPreset(type) {
    if (type === 'to' && listInfo(settings).next) return true;
    return hasPresetText(type);
  }

  // What a To paste inserts: the next address of the email list, else the To preset.
  function recipientToPaste() {
    const next = listInfo(settings).next;
    return next ? { text: next.text, listKey: next.key } : { text: presetText('to'), listKey: '' };
  }

  // Moves the email list on: this address now counts as used.
  function markListUsed(key) {
    if (settings.listUsed.includes(key)) return;
    const listUsed = [...settings.listUsed, key];
    settings = { ...settings, listUsed };
    try {
      chrome.storage.local.set({ listUsed }).catch(() => {});
    } catch (_) {
      // Extension reloaded; the new copy of this script takes over.
    }
  }

  // 'paste' when the field has preset text, 'setup' when nothing is set up yet (so the
  // button leads to the settings), '' to show nothing.
  function buttonMode(type) {
    if (hasPreset(type)) return 'paste';
    return FIELDS.some(hasPreset) ? '' : 'setup';
  }

  function applySettings(next) {
    settings = next;
    loaded = true;
    siteDisabled = siteMatches(topHostname(), settings.disabledSites);
    if (field.el && (siteDisabled || buttonMode(field.type) !== field.mode)) hideFieldButton();
    if (siteDisabled) clearComposers();
    else scheduleScan(0);
  }

  globalThis.PresetPaste.load().then((s) => alive && applySettings(s)).catch(() => {});

  const onStorageChanged = (changes, area) => {
    if (area !== 'local' || !alive) return;
    const next = { ...settings };
    for (const key of KEYS) {
      if (changes[key]) next[key] = changes[key].newValue;
    }
    applySettings(merge(next));
  };
  chrome.storage.onChanged.addListener(onStorageChanged);
  cleanups.push(() => chrome.storage.onChanged.removeListener(onStorageChanged));

  // ------------------------------------------------------- field detection

  // The editable element that owns `node`, or null if it is not a text field.
  function editableRoot(node) {
    if (!node || node.nodeType !== 1) return null;
    if (node.tagName === 'TEXTAREA') return node.disabled || node.readOnly ? null : node;
    if (node.tagName === 'INPUT') {
      if (!TEXT_INPUT_TYPES.has(node.type) || node.disabled || node.readOnly) return null;
      return node;
    }
    if (node.isContentEditable) {
      const body = node.ownerDocument.body;
      let root = node;
      while (root !== body && root.parentElement && root.parentElement.isContentEditable) {
        root = root.parentElement;
      }
      // designMode documents report <html> as editable; the editor is <body>.
      return root === node.ownerDocument.documentElement ? body : root;
    }
    return null;
  }

  function isMultiline(el) {
    return el.tagName === 'TEXTAREA' || el.isContentEditable;
  }

  function isTextControl(el) {
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
  }

  function fieldText(el) {
    return isTextControl(el) ? el.value : el.innerText || '';
  }

  function tokenize(text) {
    return String(text)
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  }

  // Accessible names and identifying attributes of the field.
  function descriptors(el) {
    const out = [];
    for (const attr of DESCRIBING_ATTRS) {
      const value = el.getAttribute(attr);
      if (value) out.push(value);
    }
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      for (const id of labelledBy.split(/\s+/)) {
        const label = id && el.ownerDocument.getElementById(id);
        if (label) out.push(label.textContent || '');
      }
    }
    if (el.labels) for (const label of el.labels) out.push(label.textContent || '');
    return out;
  }

  // Returns a field type, 'none' for fields that must be ignored (Cc, Bcc, search), or ''.
  function classifyByDescriptors(el) {
    const words = new Set();
    for (const text of descriptors(el)) for (const word of tokenize(text)) words.add(word);
    const has = (...list) => list.some((w) => words.has(w));

    if ([...words].some((w) => w.startsWith('subject'))) return 'subject';
    if (isMultiline(el) && has('body')) return 'body';
    if (has('cc', 'bcc', 'from', 'search')) return 'none';
    if (has('to', 'recipient', 'recipients')) return 'to';
    return '';
  }

  // Looks for a visible "To" / "Subject" label just before the field, e.g. <span>To</span><input>.
  function classifyByNearbyLabel(el) {
    let node = el;
    for (let depth = 0; depth < 4 && node && node.parentElement; depth++) {
      for (let sib = node.previousSibling; sib; sib = sib.previousSibling) {
        if (sib.nodeType === 1) {
          // Crossed into another field's territory: its label is not ours.
          if (sib.matches(EDITABLE_SELECTOR) || sib.querySelector(EDITABLE_SELECTOR)) return '';
        } else if (sib.nodeType !== 3) {
          continue;
        }
        const text = (sib.textContent || '').trim();
        if (!text || text.length > 24) continue;
        const match = /^(to|subject|cc|bcc)\s*:?$/i.exec(text);
        if (match) {
          const word = match[1].toLowerCase();
          return word === 'to' || word === 'subject' ? word : 'none';
        }
      }
      node = node.parentElement;
    }
    return '';
  }

  function classifyByCustomSelector(el) {
    for (const type of FIELDS) {
      const selector = String(settings.selectors[type] || '').trim();
      if (!selector) continue;
      try {
        if (el.matches(selector) || el.closest(selector)) return type;
      } catch (_) {
        // Invalid selector typed in the options page; ignore it.
      }
    }
    return '';
  }

  // The field's type judged from the field alone ('' if unknown or excluded).
  function classifyStrict(el) {
    const type =
      classifyByCustomSelector(el) || classifyByDescriptors(el) || classifyByNearbyLabel(el);
    return type === 'none' ? '' : type;
  }

  // Labelled fields of a document plus unlabelled rich-text editors ('richtext'),
  // cached briefly because focus and click arrive together.
  const fieldCache = new WeakMap();

  function typedFields(doc, fresh) {
    const now = Date.now();
    const cached = fieldCache.get(doc);
    if (!fresh && cached && now - cached.time < 500) return cached.fields;
    const fields = [];
    const seen = new Set();
    const candidates = doc.querySelectorAll(EDITABLE_SELECTOR);
    const limit = Math.min(candidates.length, 400);
    for (let i = 0; i < limit; i++) {
      const el = editableRoot(candidates[i]);
      if (!el || seen.has(el)) continue;
      seen.add(el);
      const type = classifyStrict(el) || (el.isContentEditable ? 'richtext' : '');
      if (type) fields.push({ el, type });
    }
    fieldCache.set(doc, { time: now, fields });
    return fields;
  }

  function sameForm(a, b) {
    const formA = a.closest('form');
    const formB = b.closest('form');
    return !formA || !formB || formA === formB;
  }

  // Whether field `f` shows that `el` (of `type`) sits in an email composer.
  function isPartner(type, el, f) {
    const rich = f.el.isContentEditable && (f.type === 'body' || f.type === 'richtext');
    if (type === 'to') return f.type === 'subject' || f.type === 'body' || rich;
    if (type === 'subject') return f.type === 'to' || rich;
    // Message box: a To box, or, for a rich-text editor, a Subject box. Mail apps often
    // collapse the To row into plain text once recipients are entered, so the To box
    // cannot be relied on.
    return f.type === 'to' || (el.isContentEditable && f.type === 'subject');
  }

  // The clicked field must belong to an email composer (in the same form when the page
  // uses forms). This keeps the button off look-alikes such as a flight search "To" box
  // or a contact form's "Subject" and message boxes.
  function inComposer(el, type) {
    const hasPartner = (fields, anchor) =>
      fields.some((f) => f.el !== anchor && f.el !== el && isPartner(type, el, f) && sameForm(anchor, f.el));
    if (hasPartner(typedFields(el.ownerDocument), el)) return true;

    // An editor inside a same-origin iframe (e.g. Proton) belongs to the page around it.
    let frame = null;
    try { frame = el.ownerDocument.defaultView.frameElement; } catch (_) { frame = null; }
    return !!frame && hasPartner(typedFields(frame.ownerDocument), frame);
  }

  function classify(el) {
    const forced = classifyByCustomSelector(el);
    if (forced) return forced;
    let type = classifyByDescriptors(el) || classifyByNearbyLabel(el);
    if (type === 'none') return '';
    // An unlabelled rich-text area in a composer is the message body.
    if (!type && isMultiline(el)) type = 'body';
    return type && inComposer(el, type) ? type : '';
  }

  // ------------------------------------------------------ floating buttons

  const NS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    paste:
      'M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z' +
      'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2',
    setup: 'M12 5v14M5 12h14',
    done: 'M20 6 9 17l-5-5',
    fill: 'M13 2 4 14h7l-1 8 9-12h-7z',
  };
  const CSS = `
    button {
      all: unset;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 5px;
      height: 26px;
      padding: 0 11px 0 9px;
      border-radius: 13px;
      font: 600 12px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      letter-spacing: .01em;
      color: #fff;
      background: #4f46e5;
      box-shadow: 0 1px 2px rgba(0,0,0,.3), 0 4px 14px rgba(79,70,229,.35);
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
      transition: background-color .12s, transform .12s;
      animation: pp-in .14s ease-out;
    }
    button:hover { background: #4338ca; }
    button:active { transform: scale(.96); }
    button:focus-visible { outline: 2px solid #a5b4fc; outline-offset: 2px; }
    button.setup { background: #475569; box-shadow: 0 1px 2px rgba(0,0,0,.3); }
    button.setup:hover { background: #334155; }
    button.done { background: #16a34a; box-shadow: 0 1px 2px rgba(0,0,0,.3); }
    svg {
      width: 14px; height: 14px; flex: none;
      fill: none; stroke: currentColor; stroke-width: 2;
      stroke-linecap: round; stroke-linejoin: round;
    }
    @keyframes pp-in { from { opacity: 0; transform: translateY(2px); } }
  `;
  const supportsPopover = typeof HTMLElement.prototype.showPopover === 'function';

  // Inside a modal <dialog> everything outside it is inert, so the button must live in it.
  function uiParentFor(el) {
    const dialog = el.closest('dialog');
    if (dialog && dialog.matches(':modal')) return dialog;
    return document.documentElement;
  }

  function createFloatingButton(tagName, onClick) {
    const host = document.createElement(tagName);
    host.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; z-index: 2147483647; display: none;';
    // As a popover the button lives in the top layer, above modal composers and
    // anything else the page stacks on top.
    if (supportsPopover) host.setAttribute('popover', 'manual');
    const root = host.attachShadow({ mode: 'closed' });

    // Built with DOM APIs and CSSOM so strict CSP / Trusted Types pages accept it.
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      root.adoptedStyleSheets = [sheet];
    } catch (_) {
      const style = document.createElement('style');
      style.textContent = CSS;
      root.appendChild(style);
    }

    const button = document.createElement('button');
    button.type = 'button';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(NS, 'path');
    svg.appendChild(path);
    const label = document.createElement('span');
    button.append(svg, label);
    root.appendChild(button);

    // Keep focus (and the caret) in the field while the button is pressed.
    for (const type of ['pointerdown', 'mousedown']) {
      button.addEventListener(type, (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    }
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });

    let pos = '';
    return {
      set(text, icon, variant, title) {
        label.textContent = text;
        path.setAttribute('d', ICONS[icon]);
        button.className = variant || '';
        if (title !== undefined) button.title = title;
      },
      variant: () => button.className,
      isShown: () => host.isConnected && host.style.display !== 'none',
      size: () => ({ w: button.offsetWidth || 80, h: button.offsetHeight || 26 }),
      show(parent) {
        if (host.parentNode !== parent) parent.appendChild(host);
        if (host.style.display !== 'none') return;
        pos = '';
        host.style.display = 'block';
        this.raise();
      },
      // Re-open the popover so it stacks above any top-layer element opened since.
      raise() {
        if (!supportsPopover) return;
        try {
          if (host.matches(':popover-open')) host.hidePopover();
          host.showPopover();
        } catch (_) { /* falls back to fixed positioning */ }
      },
      hide() {
        if (host.style.display === 'none') return;
        host.style.display = 'none';
        if (supportsPopover) {
          try { if (host.matches(':popover-open')) host.hidePopover(); } catch (_) { /* not open */ }
        }
      },
      moveTo(left, top, hidden) {
        const next = `${Math.round(left)},${Math.round(top)},${hidden}`;
        if (next === pos) return;
        pos = next;
        host.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
        host.style.visibility = hidden ? 'hidden' : 'visible';
      },
      remove: () => host.remove(),
    };
  }

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  // ---------------------------------------------------- per-field Paste button

  const field = { el: null, type: null, mode: null, ui: null, raf: 0, hideTimer: 0, flashTimer: 0 };

  function buttonTitle(type) {
    if (type === 'to') {
      const info = listInfo(settings);
      if (info.next) {
        return `Paste the next email from your list: ${info.next.text} (${info.used + 1} of ${info.entries.length})`;
      }
    }
    const text = String(settings.presets[type] || '').replace(/\s*[\r\n]+\s*/g, ' ⏎ ').trim();
    return `Paste preset ${FIELD_NAMES[type]}: ${text.length > 80 ? text.slice(0, 79) + '…' : text}`;
  }

  function showFieldButton(el, type, mode) {
    clearTimeout(field.hideTimer);
    if (field.ui && field.ui.isShown() && field.el === el && field.type === type && field.mode === mode) return;
    if (!field.ui) field.ui = createFloatingButton(FIELD_BUTTON_TAG, onFieldButtonClick);
    clearTimeout(field.flashTimer);
    field.el = el;
    field.type = type;
    field.mode = mode;
    if (mode === 'paste') {
      field.ui.set('Paste', 'paste', '', buttonTitle(type));
    } else {
      field.ui.set('Set up', 'setup', 'setup', 'Choose the text this button pastes');
    }
    field.ui.show(uiParentFor(el));
    field.ui.raise();
    cancelAnimationFrame(field.raf);
    trackField();
  }

  function hideFieldButton() {
    clearTimeout(field.hideTimer);
    clearTimeout(field.flashTimer);
    cancelAnimationFrame(field.raf);
    field.el = null;
    field.type = null;
    field.mode = null;
    if (field.ui) field.ui.hide();
  }

  // Follows the field every frame (composer animations, chips wrapping, scrolling).
  function trackField() {
    if (!field.el) return;
    if (!field.el.isConnected) {
      hideFieldButton();
      return;
    }
    placeFieldButton();
    field.raf = requestAnimationFrame(trackField);
  }

  function placeFieldButton() {
    const r = field.el.getBoundingClientRect();
    const { w, h } = field.ui.size();
    const pad = 6;

    let top;
    if (field.type === 'body' && r.height >= h + pad * 2) {
      // Top-right corner of the editor, staying visible while it scrolls.
      top = Math.min(Math.max(r.top + pad, pad), r.bottom - h - pad);
    } else {
      // Right end of a single-line field (or a still-empty, one-line editor), centred.
      top = r.top + (r.height - h) / 2;
    }
    const left = r.width >= w + pad * 2 ? r.right - w - pad : r.right + 4;
    const offscreen = r.bottom < 0 || r.top > window.innerHeight || (r.width === 0 && r.height === 0);
    field.ui.moveTo(
      clamp(left, 4, window.innerWidth - w - 4),
      clamp(top, 4, window.innerHeight - h - 4),
      offscreen,
    );
  }

  function onFieldButtonClick() {
    const { el, type, mode, ui } = field;
    if (!el || !el.isConnected || ui.variant() === 'done') return;
    if (mode === 'setup') {
      openSettings(type);
      hideFieldButton();
      return;
    }
    const { text, listKey } = type === 'to' ? recipientToPaste() : { text: presetText(type), listKey: '' };
    if (!text.trim()) {
      hideFieldButton();
      return;
    }
    insertText(el, type, text);
    if (listKey) markListUsed(listKey);
    ui.set('Pasted', 'done', 'done');
    clearTimeout(field.flashTimer);
    field.flashTimer = setTimeout(hideFieldButton, 700);
  }

  // ------------------------------------------------------------- inserting

  function snapshot(el) {
    return isTextControl(el) ? el.value : el.innerHTML;
  }

  function escapeHtml(text) {
    return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  // Lets the site's own paste handling run (recipient fields turn pasted addresses
  // into chips, rich editors keep line breaks). Returns true if the site handled it.
  function dispatchPaste(el, text) {
    let data;
    try {
      data = new DataTransfer();
      data.setData('text/plain', text);
      if (!isTextControl(el)) {
        data.setData('text/html', text.split(/\r?\n/).map(escapeHtml).join('<br>'));
      }
    } catch (_) {
      return false;
    }
    const before = snapshot(el);
    const event = new ClipboardEvent('paste', {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    el.dispatchEvent(event);
    return event.defaultPrevented || snapshot(el) !== before;
  }

  function setControlValue(el, text) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setValue = Object.getOwnPropertyDescriptor(proto, 'value').set;
    let start = el.value.length;
    let end = start;
    try {
      if (el.selectionStart != null) {
        start = el.selectionStart;
        end = el.selectionEnd;
      }
    } catch (_) {
      // type="email" has no selection API; append instead.
    }
    setValue.call(el, el.value.slice(0, start) + text + el.value.slice(end));
    try { el.setSelectionRange(start + text.length, start + text.length); } catch (_) { /* see above */ }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function insertIntoEditable(el, text) {
    const doc = el.ownerDocument;
    const selection = doc.getSelection();
    let range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !el.contains(range.commonAncestorContainer)) {
      range = doc.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }
    range.deleteContents();
    const fragment = doc.createDocumentFragment();
    text.split(/\r?\n/).forEach((line, i) => {
      if (i) fragment.appendChild(doc.createElement('br'));
      fragment.appendChild(doc.createTextNode(line));
    });
    const last = fragment.lastChild;
    range.insertNode(fragment);
    range.setStartAfter(last);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }

  function insertText(el, type, text) {
    if (!isFocused(el)) el.focus();
    if (type !== 'subject' && dispatchPaste(el, text)) return;

    // execCommand goes through the browser's editing pipeline, so frameworks
    // (React, ProseMirror, ...) see a normal input event and undo works.
    let inserted = false;
    try {
      inserted = el.ownerDocument.execCommand('insertText', false, text);
    } catch (_) {
      inserted = false;
    }
    if (inserted) return;

    if (isTextControl(el)) setControlValue(el, text);
    else insertIntoEditable(el, text);
  }

  function placeCaretAtStart(el) {
    if (!isFocused(el)) el.focus();
    if (isTextControl(el)) {
      try { el.setSelectionRange(0, 0); } catch (_) { /* no selection API */ }
      return;
    }
    const doc = el.ownerDocument;
    const range = doc.createRange();
    range.selectNodeContents(el);
    range.collapse(true);
    const selection = doc.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function presetText(type) {
    const raw = String(settings.presets[type] || '');
    if (type === 'to') return raw.replace(/\s*[\r\n]+\s*/g, ', ').replace(/^[,\s]+|[,\s]+$/g, '');
    if (type === 'subject') return raw.replace(/\s*[\r\n]+\s*/g, ' ').trim();
    return raw;
  }

  function openSettings(type) {
    try {
      chrome.runtime.sendMessage({ type: 'open-settings', field: type }).catch(() => {});
    } catch (_) {
      teardown();
    }
  }

  // ------------------------------------------------------------- Auto Fill

  // One "Auto Fill" button per open composer, keyed by the composer's Subject box.
  const composers = new Map();
  let composersRaf = 0;
  let scanTimer = 0;
  const CONTROL_LABEL = /\b(close|minimi[sz]e|maximi[sz]e|expand|full ?screen|pop ?out|restore|discard)\b/i;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const squash = (text) => String(text).replace(/\s+/g, ' ').trim().toLowerCase();

  function scheduleScan(delay = 400) {
    if (!isTopFrame || scanTimer || !alive) return;
    scanTimer = setTimeout(() => {
      scanTimer = 0;
      scanComposers();
    }, delay);
  }

  function scanComposers() {
    if (!alive || !loaded) return;
    if (siteDisabled) {
      clearComposers();
      return;
    }
    const inputs = document.querySelectorAll('input, textarea');
    const limit = Math.min(inputs.length, 300);
    for (let i = 0; i < limit; i++) {
      const el = editableRoot(inputs[i]);
      if (!el || composers.has(el) || classifyStrict(el) !== 'subject') continue;
      if (inComposer(el, 'subject')) composers.set(el, createComposerTracker(el));
    }
    if (composers.size && !composersRaf) composersRaf = requestAnimationFrame(trackComposers);
  }

  function createComposerTracker(subject) {
    const tracker = {
      subject, layout: null, layoutAt: 0, anchor: '',
      covered: false, coveredAt: 0, coveredAnchor: '', busy: false, resetTimer: 0,
    };
    tracker.ui = createFloatingButton(AUTOFILL_BUTTON_TAG, () => runAutoFill(tracker));
    setAutoFillIdle(tracker);
    return tracker;
  }

  function setAutoFillIdle(tracker) {
    tracker.ui.set('Auto Fill', 'fill', '', settings.useClipboard
      ? 'Fill To with the email address you copied, and Subject and Message with your presets'
      : 'Fill To, Subject and Message with your presets');
  }

  function removeComposerTracker(subject) {
    const tracker = composers.get(subject);
    if (!tracker) return;
    clearTimeout(tracker.resetTimer);
    tracker.ui.remove();
    composers.delete(subject);
  }

  function clearComposers() {
    for (const subject of [...composers.keys()]) removeComposerTracker(subject);
    cancelAnimationFrame(composersRaf);
    composersRaf = 0;
  }

  function trackComposers() {
    composersRaf = 0;
    if (!alive) return;
    for (const [subject, tracker] of composers) {
      if (!subject.isConnected) removeComposerTracker(subject);
      else placeAutoFill(tracker);
    }
    if (composers.size) composersRaf = requestAnimationFrame(trackComposers);
  }

  function placeAutoFill(tracker) {
    const s = tracker.subject.getBoundingClientRect();
    if (s.width === 0 && s.height === 0) {
      // Composer minimised or hidden.
      tracker.ui.hide();
      return;
    }

    // Reading the header is heavier than a frame's worth of work: redo it when the
    // composer moves, and a few times a second (the title follows the Subject text).
    const anchor = `${Math.round(s.left)},${Math.round(s.top)},${Math.round(s.width)}`;
    const now = performance.now();
    if (anchor !== tracker.coveredAnchor || now - tracker.coveredAt > 250) {
      tracker.covered = isCovered(tracker.subject, s);
      tracker.coveredAt = now;
      tracker.coveredAnchor = anchor;
    }
    if (tracker.covered) {
      tracker.ui.hide();
      return;
    }
    tracker.ui.show(uiParentFor(tracker.subject));

    const maxAge = tracker.layout && tracker.layout.fromHeader ? 300 : 1500;
    if (!tracker.layout || anchor !== tracker.anchor || now - tracker.layoutAt > maxAge) {
      tracker.layout = autoFillLayout(tracker.subject, s, tracker.ui.size());
      tracker.layoutAt = now;
      tracker.anchor = anchor;
    }
    const { w, h } = tracker.ui.size();
    const layout = tracker.layout;
    tracker.ui.moveTo(
      clamp(layout.left, 4, window.innerWidth - w - 4),
      clamp(layout.top, 4, window.innerHeight - h - 4),
      layout.top < -h,
    );
  }

  // Where the Auto Fill button goes: in the composer's header row, right after the
  // title and clear of the window controls (minimise / expand / close).
  function autoFillLayout(subject, s, { w, h }) {
    const header = findHeader(subject, s);
    if (header) {
      let left = header.titleRight ? header.titleRight + 16 : header.controlsLeft - w - 16;
      left = Math.min(left, header.controlsLeft - w - 12);
      left = Math.max(left, header.boxLeft + 8);
      return { left, top: header.centerY - h / 2, fromHeader: true };
    }
    // No recognisable header: just above the first field, right-aligned with the Subject box.
    const { to } = composerParts(subject);
    const firstTop = to ? Math.min(to.getBoundingClientRect().top, s.top) : s.top;
    return { left: s.right - w, top: firstTop - h - 8, fromHeader: false };
  }

  function windowControls(container, s) {
    const found = [];
    const candidates = container.querySelectorAll('button, [role="button"], [aria-label], [title], [data-tooltip]');
    for (const el of candidates) {
      const label = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('data-tooltip') || '';
      if (!CONTROL_LABEL.test(label)) continue;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.width > 80 || rect.height > 80) continue;
      // Window controls sit above the fields, on the right-hand side.
      if (rect.bottom > s.top - 4 || rect.left < s.left + s.width / 2) continue;
      found.push({ el, rect });
    }
    return found;
  }

  function findHeader(subject, s) {
    let node = subject.parentElement;
    for (let depth = 0; node && depth < 16; depth++, node = node.parentElement) {
      if (node === document.body || node === document.documentElement) break;
      const controls = windowControls(node, s);
      if (!controls.length) continue;
      // The header is the topmost row of controls.
      const topmost = controls.reduce((a, b) => (b.rect.top < a.rect.top ? b : a));
      const centerY = topmost.rect.top + topmost.rect.height / 2;
      const row = controls.filter((c) => Math.abs(c.rect.top + c.rect.height / 2 - centerY) < 12);
      const controlsLeft = Math.min(...row.map((c) => c.rect.left));
      return {
        centerY,
        controlsLeft,
        boxLeft: node.getBoundingClientRect().left,
        titleRight: titleRight(node, subject, centerY, controlsLeft, row),
      };
    }
    return null;
  }

  // Right edge of the header text (the composer title) left of the window controls.
  function titleRight(box, subject, centerY, controlsLeft, controls) {
    const doc = box.ownerDocument;
    const walker = doc.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    const range = doc.createRange();
    let right = 0;
    for (let node = walker.nextNode(), n = 0; node && n < 400; node = walker.nextNode(), n++) {
      // The header comes before the fields; stop at the Subject box.
      if (subject.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) break;
      if (!node.nodeValue.trim() || controls.some((c) => c.el.contains(node))) continue;
      range.selectNodeContents(node);
      const r = range.getBoundingClientRect();
      if (!r.width || Math.abs(r.top + r.height / 2 - centerY) > 14 || r.left >= controlsLeft) continue;
      // A long title is cut off (ellipsis) by its element; use the visible part.
      const visibleRight = Math.min(r.right, node.parentElement.getBoundingClientRect().right, controlsLeft);
      right = Math.max(right, visibleRight);
    }
    return right;
  }

  // Whether `el` belongs to the composer of `subject`: the smallest element holding both
  // must not also hold another composer's Subject box. Keeps Auto Fill out of other
  // composers left open on the page (e.g. one showing "Your message has been sent").
  function sameComposer(subject, el) {
    let box = subject.parentElement;
    while (box && !box.contains(el)) box = box.parentElement;
    if (!box) return false;
    return !typedFields(subject.ownerDocument)
      .some((f) => f.type === 'subject' && f.el !== subject && box.contains(f.el));
  }

  // True when this composer is hidden or something else, typically another composer
  // opened on top of it, covers its Subject box. The buttons float in the top layer, so
  // its Auto Fill button would otherwise sit over the other composer, and a click would
  // fill and focus the hidden one.
  function isCovered(subject, s) {
    if (typeof subject.checkVisibility === 'function' && !subject.checkVisibility({
      opacityProperty: true, visibilityProperty: true, checkOpacity: true, checkVisibilityCSS: true,
    })) return true;
    const x = s.left + Math.min(16, s.width / 2);
    const y = s.top + s.height / 2;
    if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return false;
    const hit = subject.ownerDocument.elementsFromPoint(x, y).find((node) => !isOwnButton(node));
    return !!hit && !sameComposer(subject, hit);
  }

  function treeDistance(from, target) {
    let distance = 0;
    for (let node = from; node; node = node.parentElement, distance++) {
      if (node.contains(target)) return distance;
    }
    return Infinity;
  }

  function nearestTo(subject, elements) {
    let best = null;
    let bestDistance = Infinity;
    for (const el of elements) {
      const distance = treeDistance(subject, el);
      if (distance < bestDistance) {
        best = el;
        bestDistance = distance;
      }
    }
    return best;
  }

  // A message editor inside a same-origin iframe (e.g. Proton).
  function iframeEditorNear(subject) {
    const editors = new Map();
    for (const frame of subject.ownerDocument.querySelectorAll('iframe')) {
      let doc = null;
      try { doc = frame.contentDocument; } catch (_) { doc = null; }
      if (!doc || !doc.body) continue;
      const editor = doc.body.isContentEditable
        ? doc.body
        : editableRoot(doc.querySelector('[contenteditable]:not([contenteditable="false"])'));
      if (editor && sameComposer(subject, frame)) editors.set(frame, editor);
    }
    const frame = nearestTo(subject, editors.keys());
    return frame ? editors.get(frame) : null;
  }

  // The To box and message editor that belong with this Subject box: the nearest ones
  // in its own composer, in case several composers are open.
  function composerParts(subject) {
    const fields = typedFields(subject.ownerDocument, true)
      .filter((f) => f.el !== subject && sameForm(subject, f.el) && sameComposer(subject, f.el));
    const to = nearestTo(subject, fields.filter((f) => f.type === 'to').map((f) => f.el));
    const body =
      nearestTo(subject, fields.filter((f) => f.type === 'body' || f.type === 'richtext').map((f) => f.el)) ||
      plainMessageBox(subject) ||
      iframeEditorNear(subject);
    return { to, body };
  }

  // A plain <textarea> message box without a "body" label, e.g. aria-label="Message".
  function plainMessageBox(subject) {
    const boxes = [...subject.ownerDocument.querySelectorAll('textarea')].filter((el) =>
      editableRoot(el) && sameForm(subject, el) && sameComposer(subject, el) && classify(el) === 'body');
    return nearestTo(subject, boxes);
  }

  // Everything shown before the Subject box in this composer (recipient chips or the
  // collapsed recipient line), including attribute values such as chip tooltips.
  function recipientsText(subject, parts) {
    let text = parts.to && isTextControl(parts.to) ? parts.to.value : '';
    let container = null;
    const other = parts.to || (parts.body && parts.body.ownerDocument === subject.ownerDocument ? parts.body : null);
    if (other) {
      for (let node = subject; node && !container; node = node.parentElement) {
        if (node.contains(other)) container = node;
      }
    }
    container = container || (subject.parentElement && subject.parentElement.parentElement);
    if (!container) return text.toLowerCase();

    const walker = subject.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(), n = 0; node && n < 3000; node = walker.nextNode(), n++) {
      if (node === subject || subject.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) break;
      if (node.nodeType === 3) text += ' ' + node.nodeValue;
      else for (const attr of node.attributes) text += ' ' + attr.value;
    }
    return text.toLowerCase();
  }

  function splitRecipients(text) {
    // Split on commas / semicolons that are not inside a quoted display name.
    return text.split(/[,;](?=(?:[^"]*"[^"]*")*[^"]*$)/).map((s) => s.trim()).filter(Boolean);
  }

  function readClipboard() {
    let request;
    try {
      request = chrome.runtime.sendMessage({ type: 'read-clipboard' })
        .then((reply) => (reply && typeof reply.text === 'string' ? reply.text : ''), () => '');
    } catch (_) {
      return Promise.resolve('');
    }
    return Promise.race([request, pause(2000).then(() => '')]);
  }

  // The email addresses you copied, e.g. "bob@example.com" or "Bob <bob@example.com>".
  // Each copied address is used once: if the clipboard still holds the address(es) the
  // last Auto Fill took from it, they were not copied anew and are ignored, so a
  // forgotten copy does not write to the same person twice.
  async function copiedRecipients() {
    if (!settings.useClipboard) return null;
    const text = (await readClipboard()).trim();
    // A long text (a whole email or page) was not copied as a recipient.
    if (!text || text.length > 1000) return null;
    const emails = [];
    const keys = [];
    for (const email of text.match(/[\w.%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi) || []) {
      const key = email.toLowerCase();
      if (keys.includes(key)) continue;
      keys.push(key);
      emails.push(email);
    }
    if (!emails.length) return null;
    const key = [...keys].sort().join(',');
    try {
      const { clipboardLast } = await chrome.storage.local.get('clipboardLast');
      if (clipboardLast === key) return null;
    } catch (_) {
      return null;
    }
    return { emails, key };
  }

  function markClipboardUsed(key) {
    try {
      chrome.storage.local.set({ clipboardLast: key }).catch(() => {});
    } catch (_) {
      // Extension reloaded; the new copy of this script takes over.
    }
  }

  // Recipients Auto Fill should add, given the composer's current recipients: a newly
  // copied address, else the next email-list address (unless the email is already
  // addressed to someone on the list), else the To preset entries not there yet.
  function recipientsToAdd(present, copied) {
    if (copied) {
      const missing = copied.emails.filter((email) => !present.includes(email.toLowerCase()));
      return { text: missing.join(', '), listKey: '', clipboardKey: copied.key };
    }
    const info = listInfo(settings);
    if (info.entries.length) {
      if (info.entries.some((e) => present.includes(e.key))) return { text: '', listKey: '' };
      if (info.next) return { text: info.next.text, listKey: info.next.key };
    }
    const missing = splitRecipients(presetText('to')).filter((r) => !present.includes(emailKey(r)));
    return { text: missing.join(', '), listKey: '', listFinished: info.entries.length > 0 };
  }

  // Mail apps often collapse the To row into a line of text once recipients are
  // entered. Click that line to reopen it, then wait for the To box to come back.
  async function expandRecipients(tracker) {
    const subject = tracker.subject;
    let row = subject;
    while (row.parentElement && !row.previousElementSibling) row = row.parentElement;
    const line = row.previousElementSibling;
    if (!line) return null;
    const r = line.getBoundingClientRect();
    const s = subject.getBoundingClientRect();
    const headerY = tracker.layout && tracker.layout.fromHeader ? tracker.layout.top + 26 : -Infinity;
    if (!r.width || !r.height || r.top < headerY || windowControls(line, s).length) return null;

    const x = r.left + Math.min(40, r.width / 2);
    const y = r.top + r.height / 2;
    // Only click the recipient line itself, never a window or toast lying over it.
    const hit = subject.ownerDocument.elementFromPoint(x, y);
    const target = hit && line.contains(hit) ? hit : line;
    const init = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0 };
    target.dispatchEvent(new PointerEvent('pointerdown', init));
    target.dispatchEvent(new MouseEvent('mousedown', init));
    target.dispatchEvent(new PointerEvent('pointerup', init));
    target.dispatchEvent(new MouseEvent('mouseup', init));
    target.dispatchEvent(new MouseEvent('click', init));

    for (let i = 0; i < 20; i++) {
      await pause(50);
      const { to } = composerParts(subject);
      if (to) return to;
    }
    return null;
  }

  // Fills what is missing and leaves the rest alone, so clicking twice is harmless:
  // only recipients not already present are added, the Subject is filled only when
  // empty, and the message goes above any existing text (such as a signature).
  async function autoFill(tracker) {
    const subject = tracker.subject;
    let filled = 0;

    const copied = await copiedRecipients();
    const parts = composerParts(subject);
    const add = recipientsToAdd(recipientsText(subject, parts), copied);
    let added = false;
    if (add.text) {
      const to = parts.to || (await expandRecipients(tracker));
      if (to) {
        insertText(to, 'to', add.text);
        if (add.listKey) markListUsed(add.listKey);
        added = true;
        filled++;
        await pause(80);
      }
    }
    // Already in the email counts as used too.
    if (add.clipboardKey && (added || !add.text)) markClipboardUsed(add.clipboardKey);

    if (hasPreset('subject') && !fieldText(subject).trim()) {
      insertText(subject, 'subject', presetText('subject'));
      filled++;
      await pause(80);
    }

    if (hasPreset('body')) {
      const { body } = composerParts(subject);
      const text = presetText('body');
      if (body && !squash(fieldText(body)).includes(squash(text).slice(0, 80))) {
        const hasContent = squash(fieldText(body)) !== '';
        placeCaretAtStart(body);
        insertText(body, 'body', hasContent ? text + '\n\n' : text);
        filled++;
      }
    }
    return { filled, listFinished: !!add.listFinished };
  }

  async function runAutoFill(tracker) {
    if (tracker.busy) return;
    const hasPresets = FIELDS.some(hasPreset);
    if (!hasPresets && !settings.useClipboard) {
      openSettings('to');
      return;
    }
    tracker.busy = true;
    clearTimeout(tracker.resetTimer);
    autoFilling = true;
    hideFieldButton();
    tracker.ui.set('Filling…', 'fill', '');

    let result = null;
    try {
      result = await autoFill(tracker);
    } catch (_) {
      result = null;
    } finally {
      autoFilling = false;
      hideFieldButton();
    }

    if (!result) tracker.ui.set('Could not fill', 'setup', 'setup');
    else if (result.listFinished) tracker.ui.set('Email list finished', 'setup', 'setup');
    else if (result.filled > 0) tracker.ui.set('Filled', 'done', 'done');
    else if (!hasPresets) tracker.ui.set('Copy an email first', 'setup', 'setup');
    else tracker.ui.set('Already filled', 'done', 'done');
    tracker.resetTimer = setTimeout(() => {
      tracker.busy = false;
      setAutoFillIdle(tracker);
    }, 1500);
  }

  // -------------------------------------------------------------- listeners

  function deepActiveElement(doc) {
    let active = doc.activeElement;
    while (active && active.shadowRoot && active.shadowRoot.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    return active;
  }

  function isFocused(el) {
    const active = deepActiveElement(el.ownerDocument);
    return !!active && (active === el || el.contains(active));
  }

  function isOwnButton(node) {
    return !!node && (node.tagName === 'PRESET-PASTE-BUTTON' || node.tagName === 'PRESET-AUTOFILL-BUTTON');
  }

  function onFieldInteraction(event) {
    if (!extensionAlive()) {
      teardown();
      return;
    }
    if (!loaded || siteDisabled || autoFilling) return;
    const target = event.composedPath ? event.composedPath()[0] : event.target;
    if (isOwnButton(target)) return;
    const el = editableRoot(target);
    if (!el) return;
    if (event.type === 'focusin') scheduleScan(0);
    const type = classify(el);
    const mode = type ? buttonMode(type) : '';
    if (mode) showFieldButton(el, type, mode);
    else if (field.el && field.el !== el) hideFieldButton();
  }

  // Focus covers tabbing in and auto-focused fields; click re-shows the button
  // on a field that was already focused (e.g. after pasting or pressing Esc).
  listen(window, 'focusin', onFieldInteraction, true);
  listen(window, 'click', onFieldInteraction, true);

  listen(window, 'focusout', () => {
    if (!field.el) return;
    clearTimeout(field.hideTimer);
    field.hideTimer = setTimeout(() => {
      if (field.el && !isFocused(field.el)) hideFieldButton();
    }, 150);
  }, true);

  listen(window, 'keydown', (event) => {
    if (event.key === 'Escape' && field.el) hideFieldButton();
  }, true);

  // Composers open without a page load; watch for them to add their Auto Fill button.
  if (isTopFrame) {
    const observer = new MutationObserver(() => scheduleScan());
    observer.observe(document.documentElement, { childList: true, subtree: true });
    cleanups.push(() => observer.disconnect());
  }
})();
