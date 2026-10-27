// Shared helpers for the English-UI tests (ADR-026): boot the app in English (jsdom), wait for the translator,
// and collect every piece of Thai text that is still on screen — text nodes and the translated attributes —
// outside user data (data-no-i18n) and outside document previews (data-no-i18n="doc": commercial documents, Thai
// with English secondary labels; data-no-i18n="form": government forms, Thai only).
// Not a test file itself (no .test. in the name); it loads dom-helper.cjs, so the files using it run in the full suite.
const fs = require('node:fs');
const path = require('node:path');
const { boot } = require('./dom-helper.cjs');

const TENANT = 'erp_tenant::customer-showcase-local::';
const LANGUAGE_KEY = `${TENANT}comform_ui_language_v1`;
const THAI_RE = /[฀-๿]/;
const ATTRIBUTES = ['placeholder', 'title', 'aria-label', 'alt'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const normalize = value => String(value ?? '').replace(/[\s ​]+/g, ' ').trim();

function englishSetting() {
  return JSON.stringify({ schemaVersion: 1, language: 'en', updatedAt: '2026-10-12T00:00:00.000Z' });
}

// Boots with English chosen (as a returning browser would have it). Dialog messages (confirm / alert / prompt,
// after the app's own translation) are recorded in h.dialogs; prompts answer `promptAnswer`.
async function bootEnglish(options = {}) {
  const dialogs = [];
  const before = options.beforeScripts;
  const h = await boot({
    ...options,
    beforeScripts(w) {
      w.localStorage.setItem(LANGUAGE_KEY, englishSetting());
      w.confirm = message => { dialogs.push({ type: 'confirm', message: String(message) }); return options.confirmAnswer !== false; };
      w.alert = message => { dialogs.push({ type: 'alert', message: String(message) }); };
      w.prompt = message => { dialogs.push({ type: 'prompt', message: String(message) }); return options.promptAnswer ?? 'ทดสอบ'; };
      if (typeof before === 'function') before(w);
    }
  });
  h.dialogs = dialogs;
  return h;
}

// Lets pending renders, timers and the translator's animation-frame batch run, then translates synchronously.
async function settle(w, ms = 40) {
  await sleep(ms);
  w.ERPI18n?.translateNow?.();
}

function describe(el) {
  const parts = [];
  for (let node = el; node && node.nodeType === 1 && parts.length < 4; node = node.parentElement) {
    parts.unshift(node.id ? `#${node.id}` : `${node.tagName.toLowerCase()}${node.classList?.length ? `.${[...node.classList].slice(0, 2).join('.')}` : ''}`);
    if (node.id) break;
  }
  return parts.join(' > ');
}

// The Thai left in a translated text once the values a pattern inserted unchanged (names, numbers) are removed.
function leftoverThai(text, kept) {
  let rest = String(text);
  for (const value of [...kept].sort((a, b) => b.length - a.length)) if (value) rest = rest.split(value).join(' ');
  return THAI_RE.test(rest) ? normalize(rest) : '';
}

// Every Thai text on the page (outside user data / document previews), with where it is.
// Returns { untranslated: [{ text, original, where, kind }], kept: [{ value, where, userData }], noI18n: [{ text, where }],
// unmarked: [{ text, where }] }.
//   untranslated — UI text left in Thai: the failures of the coverage audit.
//   unmarked     — stored user data (a customer / product name …) shown outside a data-no-i18n cell, whole or as
//                  the untranslated part of a composite label ("September · <product> · THB 0.00"). A piece counts
//                  as user data only if it is part of one stored value AND is not a dictionary phrase (a UI text
//                  that also happens to be stored somewhere would have been translated).
//   kept         — values a pattern inserted unchanged, with whether they are user data (should be).
function collectThai(w, { allow = [], corpus = userDataCorpus(w) } = {}) {
  const d = w.document;
  const untranslated = [];
  const kept = [];
  const noI18n = [];
  const unmarked = [];
  const allowed = new Set(allow.map(normalize));
  // Whole stored values (a product category, a supplier name) are user data wherever they come from. A leftover
  // fragment of a translated composite is excused only when it is not written in the app's own source (outside
  // the sample-data files): a status note that a record also stores is still UI text and must be translated.
  const isData = piece => isUserDataPiece(w, piece, corpus);
  const isFragment = piece => !isUiSourceText(piece) && isStoredFragment(w, piece, corpus);
  // A text whose Thai is all whole stored values (after the values a pattern kept are taken out) shows user data.
  const classify = (rest, entry) => {
    if (isData(rest)) unmarked.push({ text: entry.text, where: entry.where });
    else untranslated.push(entry);
  };
  const walker = d.createTreeWalker(d.body, 4);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || !THAI_RE.test(node.data)) continue;
    if (parent.closest('script,style,noscript,template')) continue;
    const zone = parent.closest('[data-no-i18n]');
    if (zone) {
      if (!['doc', 'form'].includes(zone.getAttribute('data-no-i18n'))) noI18n.push({ text: normalize(node.data), where: describe(parent) });
      continue;
    }
    if (parent.closest('textarea,[contenteditable]:not([contenteditable="false"])')) continue;
    const info = w.ERPI18n.inspectText(node);
    for (const value of info.kept) if (THAI_RE.test(value)) kept.push({ value: normalize(value), where: describe(parent), userData: isData(normalize(value)) });
    const rest = leftoverThai(node.data, info.kept);
    if (!rest || allowed.has(normalize(node.data))) continue;
    const entry = { text: normalize(node.data), original: normalize(info.original), where: describe(parent), kind: 'text' };
    // A composite the translator handled part by part ("Cancelled – <reason> — <user note>"): what it left is fine
    // when every leftover piece comes from one stored value and is not a phrase the dictionary knows.
    if (info.translated && info.residual.length && info.residual.every(isFragment)) unmarked.push({ text: entry.text, where: entry.where });
    else classify(rest, entry);
  }
  for (const el of d.body.querySelectorAll(ATTRIBUTES.map(a => `[${a}]`).join(','))) {
    if (el.closest('[data-no-i18n],[contenteditable]:not([contenteditable="false"])')) continue;
    for (const name of ATTRIBUTES) {
      const value = el.getAttribute(name);
      if (!value || !THAI_RE.test(value) || allowed.has(normalize(value))) continue;
      const original = normalize(w.ERPI18n.inspectAttribute(el, name).original);
      const result = w.ERPI18n.translateResult(original);
      const rest = leftoverThai(value, result.kept);
      if (!rest) continue;
      const entry = { text: normalize(value), original, where: `${describe(el)} @${name}`, kind: name };
      if (result.translated && result.residual.length && result.residual.every(isFragment)) unmarked.push({ text: entry.text, where: entry.where });
      else classify(rest, entry);
    }
  }
  const title = normalize(d.title);
  if (THAI_RE.test(title) && !allowed.has(title)) {
    classify(title, { text: title, original: title, where: 'title', kind: 'title' });
  }
  return { untranslated, kept, noI18n, unmarked };
}

// Every string value stored for the tenant (documents, master data, profile …) and the signed-in demo profile:
// the user data the screens show. Left out: system text the app itself writes (audit / activity logs, sync outbox,
// approval history) and snapshots of UI labels and statuses (fields named *Label, status, *Status) — those are
// UI wording, not user data, so they must be translated.
const SYSTEM_TEXT_KEYS = ['comform_governance_audit_v1', 'comform_sync_outbox_v1', 'comform_approval_history_v1', 'comform_auto_backup'];
const SYSTEM_FIELD_RE = /(?:Label|Status)$|^(?:status|label|audit|activity|trash)$/;
function userDataCorpus(w) {
  const values = new Set();
  const visit = (value, field = '') => {
    if (SYSTEM_FIELD_RE.test(field)) return;
    if (typeof value === 'string') { if (THAI_RE.test(value)) values.add(normalize(value)); return; }
    if (Array.isArray(value)) { value.forEach(item => visit(item, '')); return; }
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) visit(child, key);
  };
  for (let i = 0; i < w.localStorage.length; i += 1) {
    const key = w.localStorage.key(i);
    if (!key.startsWith(TENANT) || SYSTEM_TEXT_KEYS.some(base => key.slice(TENANT.length).startsWith(base))) continue;
    const raw = w.localStorage.getItem(key);
    try { visit(JSON.parse(raw)); } catch (_) { visit(raw); }
  }
  visit(w.CurrentUser);
  // Longest first, so a long value is removed before a shorter one inside it.
  return [...values].filter(value => (value.match(/[\u0E00-\u0E7F]/g) || []).length >= 3).sort((a, b) => b.length - a.length);
}

// A text is user data when its Thai is made up entirely of whole stored values ("1. <product name>",
// "<customer> (A)", "DEMO-CC01 · <product>") — a UI phrase that happens to be part of a stored note is not.
function isUserDataPiece(w, piece, corpus) {
  let text = normalize(piece);
  if (!THAI_RE.test(text)) return false;
  let found = false;
  for (const value of corpus) {
    if (!text.includes(value)) continue;
    text = text.split(value).join(' ');
    found = true;
    if (!THAI_RE.test(text)) break;
  }
  return found && !THAI_RE.test(text);
}

// The Thai written in the app's runtime source (index.html and the root *.js files), except the sample-data files
// whose strings are user data by definition (names, addresses, notes of the demo company's records).
const SAMPLE_DATA_FILES = new Set(['erp-demo-seed-core.js', 'erp-demo-seed.js']);
let uiSource = null;
function isUiSourceText(piece) {
  if (uiSource === null) {
    const root = path.resolve(__dirname, '..');
    const files = ['index.html', ...fs.readdirSync(root).filter(name => name.endsWith('.js') && !SAMPLE_DATA_FILES.has(name) && !name.endsWith('.config.js'))];
    uiSource = files.map(name => fs.readFileSync(path.join(root, name), 'utf8')).join('\n').replace(/[\s\u00a0\u200b]+/g, ' ');
  }
  const text = normalize(piece);
  return (text.match(/[\u0E00-\u0E7F]/g) || []).length >= 4 && uiSource.includes(text);
}

function isStoredFragment(w, piece, corpus) {
  const text = normalize(piece);
  if ((text.match(/[\u0E00-\u0E7F]/g) || []).length < 4) return false;
  const result = w.ERPI18n.translateResult(text);
  if (result.translated && !result.residual.length) return false;
  return corpus.some(value => value.includes(text));
}

module.exports = { isUiSourceText, TENANT, LANGUAGE_KEY, THAI_RE, englishSetting, bootEnglish, settle, collectThai, userDataCorpus, isUserDataPiece, normalize, sleep };
