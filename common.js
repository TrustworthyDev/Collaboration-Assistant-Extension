// Shared settings helpers, loaded by the content script, popup and options page.
globalThis.PresetPaste = (() => {
  'use strict';

  const FIELDS = ['to', 'subject', 'body'];
  const KEYS = ['presets', 'disabledSites', 'selectors', 'emailList', 'listUsed'];
  const EMAIL = /[^\s<>,;"']+@[^\s<>,;"']+/;

  const DEFAULTS = {
    presets: { to: '', subject: '', body: '' },
    // Sites where the Paste button is switched off. Subdomains match too.
    disabledSites: [],
    // Optional CSS selectors that force a field type when auto-detection misses.
    selectors: { to: '', subject: '', body: '' },
    // Recipients to work through, one per line; each email written uses the next one.
    emailList: '',
    // Keys (lower-case addresses) of list entries already used, oldest first.
    listUsed: [],
  };

  function merge(stored) {
    return {
      presets: { ...DEFAULTS.presets, ...(stored.presets || {}) },
      disabledSites: Array.isArray(stored.disabledSites) ? stored.disabledSites : [],
      selectors: { ...DEFAULTS.selectors, ...(stored.selectors || {}) },
      emailList: typeof stored.emailList === 'string' ? stored.emailList : '',
      listUsed: Array.isArray(stored.listUsed) ? stored.listUsed : [],
    };
  }

  async function load() {
    return merge(await chrome.storage.local.get(KEYS));
  }

  function save(partial) {
    return chrome.storage.local.set(partial);
  }

  // "Bob <Bob@Example.com>" -> "bob@example.com"
  function emailKey(entry) {
    const match = EMAIL.exec(entry);
    return (match ? match[0] : String(entry).trim()).toLowerCase();
  }

  // The email list: one recipient per line, e.g. "bob@example.com" or "Bob <bob@example.com>".
  // Lines without an address are skipped, repeated addresses count once.
  function listInfo(settings) {
    const used = new Set(settings.listUsed);
    const seen = new Set();
    const entries = [];
    let invalid = 0;
    for (const line of settings.emailList.split(/\r?\n/)) {
      const text = line.trim();
      if (!text) continue;
      if (!EMAIL.test(text)) {
        invalid++;
        continue;
      }
      const key = emailKey(text);
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ text, key, used: used.has(key) });
    }
    return {
      entries,
      invalid,
      used: entries.filter((e) => e.used).length,
      next: entries.find((e) => !e.used) || null,
    };
  }

  // "https://Mail.Example.com:8080/inbox" -> "mail.example.com"; "*.example.com" -> "example.com"
  function normalizeSite(value) {
    let s = String(value || '').trim().toLowerCase();
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
    s = s.split(/[/?#]/)[0];
    s = s.replace(/:\d+$/, '');
    s = s.replace(/^\*\./, '');
    return s;
  }

  function siteMatches(hostname, sites) {
    const host = String(hostname || '').toLowerCase();
    if (!host) return false;
    return sites.some((site) => {
      const s = normalizeSite(site);
      return s && (host === s || host.endsWith('.' + s));
    });
  }

  return { FIELDS, KEYS, DEFAULTS, merge, load, save, emailKey, listInfo, normalizeSite, siteMatches };
})();
