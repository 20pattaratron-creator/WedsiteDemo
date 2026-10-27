// ============================================================================
// erp-i18n.js — the TH / EN switch on screen (ADR-026)
// ERP DEMO 4.3.1 · round 9
// ----------------------------------------------------------------------------
// Thai stays the default and the source of every screen. When English is chosen this module translates
// what the app draws, in place, without touching the code that draws it:
//   - text nodes and the attributes placeholder, title, aria-label, alt (and value of input buttons) in the
//     whole document (<title> included), through the phrase translator of erp-i18n-core.js;
//   - new and changed content through one MutationObserver, batched per animation frame (before the paint,
//     so Thai never flashes), guarded against re-entrancy: the module remembers the text it wrote for each
//     node (WeakMap) and drops its own mutation records, and a node rewritten over and over is left alone;
//   - confirm / alert / prompt messages (window wrappers; Thai mode passes them through unchanged);
//   - <html lang>.
// NEVER translated: input / textarea values, contenteditable content and anything inside an element marked
// data-no-i18n (user data: names, addresses, notes, document numbers). data-no-i18n="doc" marks a commercial
// document preview: it stays Thai like the print and gets the English secondary labels of erp-i18n-print.js;
// data-no-i18n="form" marks a government form (50 Tawi), which stays Thai only. Switching back to Thai puts
// every original text back.
// The switch: "TH | EN" in the header (two buttons with aria-pressed) and an item in the Demo menu. The choice
// is a per-tenant preference (UI_LANGUAGE_KEY), part of backups, kept by the demo reset.
// Public API: window.ERPI18n (see the end of the file).
// ============================================================================
import { UI_LANGUAGE_KEY, STORAGE_WRITTEN_EVENT } from './erp-storage-contracts.js';
import { hasThai, normalizePhrase, parseUiLanguageSetting, serializeUiLanguageSetting, normalizeUiLanguage, createPhraseTranslator, translateKey, englishBahtText, localizeDatesEn, beYearToAd, taxMonthLabelEn } from './erp-i18n-core.js';
import { SHELL_EN, SHELL_EN_PATTERNS } from './i18n/en-shell.js';
import { SALES_EN, SALES_EN_PATTERNS } from './i18n/en-sales.js';
import { PURCHASE_STOCK_EN, PURCHASE_STOCK_EN_PATTERNS } from './i18n/en-purchase-stock.js';
import { TAX_EN, TAX_EN_PATTERNS } from './i18n/en-tax.js';
import { SETTINGS_BACKUP_EN, SETTINGS_BACKUP_EN_PATTERNS } from './i18n/en-settings-backup.js';
import { MESSAGES_EN, MESSAGES_EN_PATTERNS } from './i18n/en-messages.js';
import { UI_KEYS } from './i18n/en-keys.js';
import { TAX_HELP_EN, TAX_HELP_FOOTER, TAX_CALENDAR_EN } from './i18n/en-tax-help.js';
import { annotateDocument, removeAnnotations, bilingualDocumentHtml } from './erp-i18n-print.js';
import { icon } from './erp-icons.js';

export const LANGUAGE_CHANGED_EVENT = 'erp:language-changed';
const TRANSLATED_ATTRIBUTES = Object.freeze(['placeholder', 'title', 'aria-label', 'alt']);
const BUTTON_VALUE_TYPES = Object.freeze(['button', 'submit', 'reset']);
// Text in these never changes: user data, scripts / styles, form values (a <textarea>'s text is its value)
// and anything the user is editing.
const TEXT_SKIP_SELECTOR = '[data-no-i18n],script,style,noscript,textarea,[contenteditable]:not([contenteditable="false"])';
const ATTR_SKIP_SELECTOR = '[data-no-i18n],[contenteditable]:not([contenteditable="false"])';
// A bare Buddhist-Era year as the whole text of an <option> (the year selects): shown as the Gregorian year.
const OPTION_BE_YEAR_RE = /^(\s*)(2[456]\d{2})(\s*)$/;
// Commercial document previews (quotation, tax invoice, receipt, credit / debit note): bilingual in English.
const DOC_ZONE_SELECTOR = '[data-no-i18n="doc"]';
// Loop guard: a text node — or an element whose text keeps being replaced by new nodes — rewritten in more than
// NODE_REWRITE_LIMIT different batches within LOOP_WINDOW_MS is left as it is (another script keeps putting its
// Thai text back). A loop runs a batch every frame (~60/s) and is stopped within half a second; a person typing
// (a hint updated per keystroke) stays far below it. The counters are visible through ERPI18n.stats().
const NODE_REWRITE_LIMIT = 30;
const LOOP_WINDOW_MS = 2000;
// Panels re-drawn after a switch (lists, reports, dashboards). Forms and document editors are never
// re-drawn: their labels are translated in place and nothing the user typed is touched.
const RERENDER_PANELS = Object.freeze(['dashboard', 'analytics', 'quote-list', 'invoice-list', 'receipt-list', 'issued-invoice-list', 'issued-receipt-list', 'expense-list', 'production-list', 'linked-flow', 'credit-note-list', 'debit-note-list', 'work-home', 'approval-center', 'order-flow']);

const state = {
  language: 'th',
  translator: null,
  observer: null,
  scheduled: 0,
  flushing: false,
  pending: new Set(),
  // node → the original (Thai) text / attribute values, and what this module wrote.
  textOriginal: new WeakMap(),
  textApplied: new WeakMap(),
  textInfo: new WeakMap(),
  attrState: new WeakMap(),
  rewrites: new WeakMap(),
  unstable: new WeakSet(),
  stats: { flushes: 0, textNodes: 0, attributes: 0, loopsStopped: 0, switches: 0, lastFlushNodes: 0 },
  toggle: null,
  wrapped: false
};

// ---------------------------------------------------------------- setting
const storageKey = () => window.ComformTenant?.storageKey?.(UI_LANGUAGE_KEY) || UI_LANGUAGE_KEY;

function readStoredLanguage() {
  try {
    return parseUiLanguageSetting(localStorage.getItem(storageKey()));
  } catch (error) {
    console.warn('[ERPI18n] language setting unreadable; using Thai', error);
    return 'th';
  }
}

function writeStoredLanguage(language) {
  try {
    localStorage.setItem(storageKey(), serializeUiLanguageSetting(language, new Date().toISOString()));
    return true;
  } catch (error) {
    console.warn('[ERPI18n] language setting not saved (this page still switches)', error);
    return false;
  }
}

// ---------------------------------------------------------------- translator
function translator() {
  if (!state.translator) {
    state.translator = createPhraseTranslator({
      entries: [...SHELL_EN, ...SALES_EN, ...PURCHASE_STOCK_EN, ...TAX_EN, ...SETTINGS_BACKUP_EN, ...MESSAGES_EN],
      patterns: [...MESSAGES_EN_PATTERNS, ...TAX_EN_PATTERNS, ...SALES_EN_PATTERNS, ...PURCHASE_STOCK_EN_PATTERNS, ...SETTINGS_BACKUP_EN_PATTERNS, ...SHELL_EN_PATTERNS],
      strict: false,
      onError: error => console.error('[ERPI18n] dictionary entry skipped:', error.message)
    });
  }
  return state.translator;
}

const isEnglish = () => state.language === 'en';

// A message for the user (toast, dialog): English when English is on, else the same string.
function message(text) {
  const source = String(text ?? '');
  return isEnglish() && (hasThai(source) || /\d/.test(source)) ? translator().phrase(source) : source;
}

function t(key, params = {}) {
  return translateKey(UI_KEYS, state.language, key, params);
}

// ---------------------------------------------------------------- one node
function skipText(node) {
  const parent = node.parentElement;
  return !parent || !!parent.closest(TEXT_SKIP_SELECTOR);
}

// Counts one rewrite of `key` in the current batch; false when `key` has been rewritten in too many batches.
function countRewrite(key, now) {
  const batch = state.stats.flushes;
  const seen = state.rewrites.get(key);
  if (!seen || now - seen.since > LOOP_WINDOW_MS) {
    state.rewrites.set(key, { since: now, count: 1, batch });
    return true;
  }
  if (seen.batch === batch) return true; // several nodes of one element in one batch count once
  seen.batch = batch;
  seen.count += 1;
  return seen.count <= NODE_REWRITE_LIMIT;
}

function noteRewrite(node) {
  const now = Date.now();
  const parent = node.parentElement;
  const nodeOk = countRewrite(node, now);
  const parentOk = parent ? countRewrite(parent, now) : true;
  if (nodeOk && parentOk) return true;
  state.unstable.add(nodeOk ? parent : node);
  state.stats.loopsStopped += 1;
  console.warn('[ERPI18n] a text keeps changing back; leaving it as it is', parent?.outerHTML?.slice(0, 160) || '');
  return false;
}

function translateTextNode(node) {
  if (state.unstable.has(node) || state.unstable.has(node.parentElement) || skipText(node)) return;
  const current = node.data;
  if (state.textApplied.get(node) === current) return; // our own text, unchanged since
  let next = current;
  let info = null;
  const parentTag = node.parentElement?.tagName;
  const year = parentTag === 'OPTION' ? OPTION_BE_YEAR_RE.exec(current) : null;
  if (year) {
    next = `${year[1]}${beYearToAd(Number(year[2]))}${year[3]}`;
  } else if (hasThai(current) || /2[456]\d{2}/.test(current)) {
    info = translator().translate(current);
    next = info.text;
  }
  if (next === current) {
    state.textOriginal.delete(node);
    state.textApplied.delete(node);
    if (info && info.residual.length) state.textInfo.set(node, info);
    else state.textInfo.delete(node);
    return;
  }
  if (!noteRewrite(node)) return;
  state.textOriginal.set(node, current);
  state.textApplied.set(node, next);
  if (info) state.textInfo.set(node, info);
  else state.textInfo.delete(node);
  node.data = next;
  state.stats.textNodes += 1;
}

function attributeNames(el) {
  const names = TRANSLATED_ATTRIBUTES.filter(name => el.hasAttribute(name));
  if (el.tagName === 'INPUT' && BUTTON_VALUE_TYPES.includes(String(el.getAttribute('type') || '').toLowerCase()) && el.hasAttribute('value')) names.push('value');
  return names;
}

function translateAttributes(el) {
  const names = attributeNames(el);
  if (!names.length || el.closest(ATTR_SKIP_SELECTOR)) return;
  let record = state.attrState.get(el);
  for (const name of names) {
    const current = el.getAttribute(name);
    const known = record?.[name];
    if (known && known.applied === current) continue;
    if (!hasThai(current) && !/2[456]\d{2}/.test(current)) {
      if (known) delete record[name];
      continue;
    }
    const next = translator().translate(current).text;
    if (next === current) continue;
    if (!record) {
      record = {};
      state.attrState.set(el, record);
    }
    record[name] = { original: current, applied: next };
    el.setAttribute(name, next);
    state.stats.attributes += 1;
  }
}

function translateTree(root) {
  if (!root) return;
  if (root.nodeType === 3) {
    translateTextNode(root);
    return;
  }
  if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
  const start = root.nodeType === 9 ? root.documentElement : root;
  if (!start) return;
  if (start.nodeType === 1) {
    if (start.closest?.('[data-no-i18n]')) return;
    translateAttributes(start);
  }
  const doc = start.ownerDocument || document;
  const walker = doc.createTreeWalker(start, 1 | 4, {
    acceptNode(node) {
      if (node.nodeType === 1) return node.hasAttribute('data-no-i18n') || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(node.tagName) ? 2 : 1; // 2 = reject subtree
      return 1;
    }
  });
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === 3) translateTextNode(node);
    else translateAttributes(node);
    node = walker.nextNode();
  }
}

// Thai back: every text / attribute this module changed and nobody changed since gets its original back.
function restoreTree(root) {
  const start = root?.nodeType === 9 ? root.documentElement : root;
  if (!start) return;
  const doc = start.ownerDocument || document;
  const walker = doc.createTreeWalker(start, 1 | 4);
  const restoreElement = el => {
    const record = state.attrState.get(el);
    if (!record) return;
    for (const [name, value] of Object.entries(record)) {
      if (el.getAttribute(name) === value.applied) el.setAttribute(name, value.original);
    }
    state.attrState.delete(el);
  };
  if (start.nodeType === 1) restoreElement(start);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === 3) {
      if (state.textApplied.has(node) && state.textApplied.get(node) === node.data) node.data = state.textOriginal.get(node);
      state.textApplied.delete(node);
      state.textOriginal.delete(node);
      state.textInfo.delete(node);
    } else {
      restoreElement(node);
    }
    node = walker.nextNode();
  }
}

// ---------------------------------------------------------------- observer, batched per frame
function flush() {
  state.scheduled = 0;
  if (!isEnglish() || state.flushing) return;
  state.flushing = true;
  const nodes = [...state.pending];
  state.pending.clear();
  try {
    for (const node of nodes) {
      if (!node.isConnected) continue;
      annotateDocumentZones(node);
      translateTree(node);
    }
    const roots = nodes.filter(node => node.isConnected);
    afterFlushHooks.forEach(hook => {
      try {
        hook(roots);
      } catch (error) {
        console.warn('[ERPI18n] after-translation hook failed', error);
      }
    });
  } finally {
    // Our own writes queued records too; they are not new content.
    state.observer?.takeRecords();
    state.flushing = false;
    state.stats.flushes += 1;
    state.stats.lastFlushNodes = nodes.length;
  }
}

function schedule() {
  if (state.scheduled) return;
  const raf = typeof window.requestAnimationFrame === 'function' ? window.requestAnimationFrame.bind(window) : cb => setTimeout(cb, 16);
  state.scheduled = raf(flush) || 1;
}

function onMutations(records) {
  if (state.flushing || !isEnglish()) return;
  for (const record of records) {
    if (record.type === 'childList') record.addedNodes.forEach(node => state.pending.add(node));
    else state.pending.add(record.target);
  }
  if (state.pending.size) schedule();
}

function startObserver() {
  if (state.observer || typeof window.MutationObserver !== 'function') return;
  state.observer = new MutationObserver(onMutations);
  state.observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...TRANSLATED_ATTRIBUTES, 'value'] });
}

function stopObserver() {
  state.observer?.disconnect();
  state.observer = null;
  state.pending.clear();
}

// The document previews in or around `node` get their English secondary labels (idempotent).
function annotateDocumentZones(node) {
  const el = node.nodeType === 1 ? node : node.parentElement;
  if (!el) return;
  const zone = el.closest(DOC_ZONE_SELECTOR);
  if (zone) {
    annotateDocument(zone);
    return;
  }
  el.querySelectorAll(DOC_ZONE_SELECTOR).forEach(found => annotateDocument(found));
}

// Translate everything now (tests, the audit, after a switch) instead of waiting for the next frame.
function translateNow() {
  if (!isEnglish()) return;
  state.pending.add(document.documentElement);
  flush();
}

// ---------------------------------------------------------------- hooks other modules can add
// Run after each translated batch in English with the batch's changed nodes (e.g. tax help icons next to Thai
// tax concepts).
const afterFlushHooks = new Set();
function afterTranslate(hook) {
  if (typeof hook === 'function') afterFlushHooks.add(hook);
}

// ---------------------------------------------------------------- confirm / alert / prompt
// The app asks with the browser's own dialogs. In Thai the call goes through untouched (same arguments);
// in English only the message (first argument) is translated — a prompt's default value and every
// answer are returned exactly as the browser gives them.
function wrapDialog(name) {
  const native = window[name];
  if (typeof native !== 'function') return null;
  return function erpTranslatedDialog(...args) {
    if (isEnglish() && args.length) args[0] = message(args[0]);
    return native.apply(window, args);
  };
}

function wrapDialogs() {
  if (state.wrapped) return;
  state.wrapped = true;
  const confirmWrapped = wrapDialog('confirm');
  const alertWrapped = wrapDialog('alert');
  const promptWrapped = wrapDialog('prompt');
  if (confirmWrapped) window.confirm = confirmWrapped;
  if (alertWrapped) window.alert = alertWrapped;
  if (promptWrapped) window.prompt = promptWrapped;
}

// ---------------------------------------------------------------- the switch (header + Demo menu)
function updateSwitchUi() {
  const lang = state.language;
  state.toggle?.querySelectorAll('[data-erp-lang]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.erpLang === lang));
  });
  window.ERPDemoMenu?.register?.({
    key: 'language',
    id: 'local-demo-language-btn',
    order: 50,
    label: t(lang === 'en' ? 'switch.menuToThai' : 'switch.menuToEnglish'),
    title: t(lang === 'en' ? 'switch.menuTitleToThai' : 'switch.menuTitleToEnglish'),
    dataset: { noI18n: '' },
    iconSvg: icon('globe'),
    onSelect: () => setLanguage(lang === 'en' ? 'th' : 'en')
  });
}

function installSwitch() {
  if (state.toggle?.isConnected) return;
  const top = document.querySelector('.comform-topbar');
  if (!top) return;
  const group = document.createElement('div');
  group.className = 'erp-lang-switch';
  group.id = 'erp-lang-switch';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', t('switch.group'));
  group.setAttribute('data-no-i18n', '');
  group.innerHTML = '<button type="button" class="erp-lang-btn" data-erp-lang="th" lang="th" title="ภาษาไทย" aria-pressed="false">TH</button><span class="erp-lang-sep" aria-hidden="true">|</span><button type="button" class="erp-lang-btn" data-erp-lang="en" lang="en" title="English" aria-pressed="false">EN</button>';
  group.addEventListener('click', event => {
    const button = event.target.closest?.('[data-erp-lang]');
    if (button) setLanguage(button.dataset.erpLang);
  });
  // Before the Demo menu button, which stays last in the header (ADR-015).
  const demo = document.getElementById('erp-demo-menu-btn');
  if (demo && demo.parentElement === top) top.insertBefore(group, demo);
  else top.append(group);
  state.toggle = group;
  updateSwitchUi();
}

// ---------------------------------------------------------------- switching
function activePanelId() {
  const panel = document.querySelector('.panel.active');
  return panel?.id?.startsWith('panel-') ? panel.id.slice(6) : '';
}

function rerenderCurrentPage() {
  const id = activePanelId();
  if (!RERENDER_PANELS.includes(id) || typeof window.go !== 'function') return;
  const x = window.scrollX || 0;
  const y = window.scrollY || 0;
  try {
    window.go(id);
  } catch (error) {
    console.warn('[ERPI18n] page re-render after the language switch failed', error);
  }
  // go() scrolls phones to the top; a language switch should leave the reader where they were.
  setTimeout(() => {
    try {
      window.scrollTo(x, y);
    } catch (error) {
      console.warn('[ERPI18n] scroll position not restored', error);
    }
  }, 0);
}

function applyLanguage({ rerender = true } = {}) {
  const english = isEnglish();
  document.documentElement.setAttribute('lang', english ? 'en' : 'th');
  if (english) document.body?.classList.add('erp-lang-en');
  else if (document.body) removeClass(document.body, 'erp-lang-en');
  if (english) {
    startObserver();
    translateNow();
  } else {
    stopObserver();
    removeTaxHelp();
    document.querySelectorAll(DOC_ZONE_SELECTOR).forEach(zone => removeAnnotations(zone));
    restoreTree(document.documentElement);
  }
  updateSwitchUi();
  window.dispatchEvent(new CustomEvent(LANGUAGE_CHANGED_EVENT, { detail: { language: state.language } }));
  if (rerender) rerenderCurrentPage();
  if (english) translateNow();
}

function setLanguage(language, { persist = true } = {}) {
  const next = normalizeUiLanguage(language);
  if (persist) writeStoredLanguage(next);
  if (next === state.language) {
    updateSwitchUi();
    return state.language;
  }
  state.language = next;
  state.stats.switches += 1;
  applyLanguage();
  return state.language;
}

// A backup restore or another tab may change the stored preference.
function syncFromStorage() {
  const stored = readStoredLanguage();
  if (stored !== state.language) setLanguage(stored, { persist: false });
}

// ---------------------------------------------------------------- Thai tax explained ("?" buttons, English only)
// A "?" button after each Thai tax concept on screen opens a short English explanation (i18n/en-tax-help.js).
// Anchors are found by the ORIGINAL Thai text of a label / heading (so they follow the screens without touching
// their code) or by a selector. Thai mode shows no buttons: they are removed when switching back.
const HELP_BY_TEXT = Object.freeze({
  'รูปแบบใบกำกับภาษี': 'taxInvoiceForms',
  'สำนักงานใหญ่ / สาขาของผู้ซื้อ': 'branchCodes',
  'ภาษีมูลค่าเพิ่ม 7%': 'vat',
  'ใบลดหนี้ / Credit Note': 'creditNote',
  'ใบเพิ่มหนี้ / Debit Note': 'debitNote',
  'ภาษีซื้อ (ข้อมูลจากใบกำกับภาษีของผู้ขาย)': 'vat',
  'ใช้สิทธิ์ภาษีซื้อในเดือนภาษี': 'claimWindow',
  'เหตุผลที่ไม่ขอใช้สิทธิ์ (ภาษีซื้อต้องห้าม มาตรา 82/5)': 'nonClaimable',
  'หักภาษี ณ ที่จ่ายจากผู้รับเงิน (ออกหนังสือรับรอง 50 ทวิ)': 'wht',
  'การยื่น ภ.พ.30 (เมื่อมีมากกว่า 1 สถานประกอบการ)': 'pp30',
  'สาขาที่พิมพ์บนเอกสาร': 'branchCodes',
  'สถานประกอบการของผู้ขาย': 'branchCodes'
});
const HELP_BY_SELECTOR = Object.freeze([['#governance-controls > .card-title', 'periodLock']]);
const HELP_ANCHOR_SELECTOR = 'label, legend, .card-title, h2, h3, summary, .tax-exp-title, .wht-exp-title';
const HELP_SCOPE = '#app-content';

// The Thai text of an element as the app wrote it (nested elements included), whatever is translated now.
function originalTextOf(el) {
  const collect = parent => {
    let text = '';
    for (const node of parent.childNodes) {
      if (node.nodeType === 3) text += state.textOriginal.has(node) ? state.textOriginal.get(node) : node.data;
      else if (node.nodeType === 1 && !node.classList.contains('erp-tax-help') && !node.matches('svg, input, select, textarea, button')) text += collect(node);
    }
    return text;
  };
  return normalizePhrase(collect(el));
}

const escapeHelp = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function helpButtonHtml(concept) {
  const help = TAX_HELP_EN[concept];
  if (!help) return '';
  return `<button type="button" class="erp-tax-help" data-tax-help="${escapeHelp(concept)}" aria-haspopup="dialog" aria-expanded="false" aria-label="${escapeHelp(help.question)}" title="${escapeHelp(help.title)}">?</button>`;
}

function placeHelp(el, concept) {
  const next = el.tagName === 'LABEL' ? el.nextElementSibling : el.lastElementChild;
  if (next?.classList?.contains('erp-tax-help') && next.dataset.taxHelp === concept) return;
  const holder = document.createElement('span');
  holder.innerHTML = helpButtonHtml(concept);
  const button = holder.firstElementChild;
  if (!button) return;
  // A button may not sit inside a <label> (it is labelable itself): it goes right after it.
  if (el.tagName === 'LABEL') {
    el.classList.add('erp-has-tax-help');
    el.after(button);
  } else {
    el.append(button);
  }
}

// Only the parts of the page that changed in this batch are looked at (the whole page after a switch).
function placeTaxHelp(roots = [document.documentElement]) {
  if (!isEnglish()) return;
  const scope = document.querySelector(HELP_SCOPE) || document.body;
  const anchors = new Set();
  const selectorHits = [];
  for (const root of roots) {
    const el = root.nodeType === 1 ? root : root.parentElement;
    if (!el || (!scope.contains(el) && !el.contains(scope))) continue;
    const base = el.contains(scope) ? scope : el;
    const own = el.closest(HELP_ANCHOR_SELECTOR);
    if (own && scope.contains(own)) anchors.add(own);
    base.querySelectorAll(HELP_ANCHOR_SELECTOR).forEach(found => anchors.add(found));
    for (const [selector, concept] of HELP_BY_SELECTOR) {
      const hit = el.closest(selector);
      if (hit) selectorHits.push([hit, concept]);
      base.querySelectorAll(selector).forEach(found => selectorHits.push([found, concept]));
    }
  }
  for (const el of anchors) {
    if (el.closest('[data-no-i18n]')) continue;
    const concept = HELP_BY_TEXT[originalTextOf(el)];
    if (concept) placeHelp(el, concept);
  }
  for (const [el, concept] of selectorHits) placeHelp(el, concept);
}

// Takes a class this module added off again; an element that had no class attribute gets none back (Thai markup
// after a switch back is exactly the markup before).
function removeClass(el, name) {
  el.classList.remove(name);
  if (!el.classList.length && el.getAttribute('class') === '') el.removeAttribute('class');
}

function removeTaxHelp() {
  closeHelp({ restoreFocus: false });
  document.querySelectorAll('.erp-tax-help:not([data-keep])').forEach(button => button.remove());
  document.querySelectorAll('.erp-has-tax-help').forEach(el => removeClass(el, 'erp-has-tax-help'));
}

let helpOpener = null;
function closeHelp({ restoreFocus = true } = {}) {
  const pop = document.getElementById('erp-tax-help-popover');
  if (!pop) return;
  pop.remove();
  if (helpOpener?.isConnected) {
    helpOpener.setAttribute('aria-expanded', 'false');
    if (restoreFocus) helpOpener.focus();
  }
  helpOpener = null;
}

function openHelp(button) {
  const concept = button?.dataset?.taxHelp;
  const help = TAX_HELP_EN[concept];
  if (!help) return;
  const same = helpOpener === button;
  closeHelp({ restoreFocus: false });
  if (same) return; // a second click on the same "?" closes it
  const pop = document.createElement('div');
  pop.id = 'erp-tax-help-popover';
  pop.className = 'erp-tax-help-popover';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-labelledby', 'erp-tax-help-title');
  pop.setAttribute('lang', 'en');
  pop.setAttribute('data-no-i18n', '');
  pop.tabIndex = -1;
  pop.innerHTML = `<div class="erp-tax-help-head"><h3 id="erp-tax-help-title">${escapeHelp(help.title)}</h3><button type="button" class="erp-tax-help-close" data-tax-help-close aria-label="${escapeHelp(t('help.close'))}">×</button></div>${help.paragraphs.map(text => `<p>${escapeHelp(text)}</p>`).join('')}<p class="erp-tax-help-footer">${escapeHelp(TAX_HELP_FOOTER)}</p>`;
  document.body.append(pop);
  helpOpener = button;
  button.setAttribute('aria-expanded', 'true');
  positionHelp(pop, button);
  pop.querySelector('[data-tax-help-close]')?.focus();
}

function positionHelp(pop, button) {
  const margin = 8;
  const width = Math.min(380, (window.innerWidth || 1024) - margin * 2);
  pop.style.width = `${width}px`;
  const rect = button.getBoundingClientRect?.() || { left: margin, bottom: margin, top: margin };
  const left = Math.max(margin, Math.min(rect.left, (window.innerWidth || 1024) - width - margin));
  const below = rect.bottom + 6;
  const height = pop.offsetHeight || 0;
  const top = below + height > (window.innerHeight || 768) - margin && rect.top - height - 6 > margin ? rect.top - height - 6 : below;
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(Math.max(margin, top))}px`;
}

function onHelpClick(event) {
  const button = event.target.closest?.('[data-tax-help]');
  if (button) {
    event.preventDefault();
    openHelp(button);
    return;
  }
  if (event.target.closest?.('[data-tax-help-close]')) { closeHelp(); return; }
  if (helpOpener && !event.target.closest?.('#erp-tax-help-popover')) closeHelp({ restoreFocus: false });
}

function onHelpKey(event) {
  if (event.key === 'Escape' && document.getElementById('erp-tax-help-popover')) {
    event.stopPropagation();
    closeHelp();
  }
}

// The "?" buttons for a list of concepts (the tax reports page puts them under its title, English only).
function taxHelpRowHtml(concepts = []) {
  const buttons = concepts.filter(concept => TAX_HELP_EN[concept]).map(concept => `<span class="erp-tax-help-item">${helpButtonHtml(concept)}<span>${escapeHelp(TAX_HELP_EN[concept].title)}</span></span>`).join('');
  return buttons ? `<div class="erp-tax-help-row" lang="en">${buttons}</div>` : '';
}

// ---------------------------------------------------------------- Thai tax calendar (tax reports page, English only)
const WEEKDAYS_EN = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
function calendarDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return '—';
  const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay();
  return `${m[3]}/${m[2]}/${m[1]} (${WEEKDAYS_EN[day]})`;
}

// info: { period: 'YYYY-MM', pp30: pp30DueDates(), wht: whtDueDates() } (both from the tax cores).
function taxCalendarHtml(info = {}) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(info.period || ''));
  if (!m) return '';
  const year = Number(m[1]);
  const month = Number(m[2]);
  const monthLabel = `${taxMonthLabelEn(month, year)} · B.E. ${year + 543}`;
  const dates = [info.wht, info.pp30];
  // r13#LOW-1: a date moved past a government holiday says so (the Thai holiday names stay on the Thai page).
  const cell = (date, rolled, holidays = []) => `${escapeHelp(calendarDate(date))}${rolled ? ` <small>${escapeHelp(holidays.length ? t('calendar.movedHoliday') : t('calendar.moved'))}</small>` : ''}`;
  const rows = TAX_CALENDAR_EN.rows.map((row, index) => {
    const due = dates[index] || {};
    return `<tr><th scope="row">${escapeHelp(row.form)} ${helpButtonHtml(index === 0 ? 'wht' : 'pp30')}<small>${escapeHelp(row.meaning)}</small></th><td>${cell(due.paper, due.paperRolled, due.paperHolidays)}</td><td>${cell(due.efiling, due.efilingRolled, due.efilingHolidays)}</td></tr>`;
  }).join('');
  const late = dates.some(due => due?.checkLatest) ? `<p class="erp-tax-calendar-note">${escapeHelp(t('calendar.checkLatest'))}</p>` : '';
  return `<section class="card erp-tax-calendar" lang="en" aria-labelledby="erp-tax-calendar-title"><h3 id="erp-tax-calendar-title">${escapeHelp(TAX_CALENDAR_EN.title)}</h3><p>${escapeHelp(TAX_CALENDAR_EN.intro)} <b>${escapeHelp(t('calendar.month', { month: monthLabel }))}</b></p><div class="tbl-wrap"><table class="erp-tax-calendar-table"><thead><tr><th scope="col">${escapeHelp(t('calendar.form'))}</th><th scope="col">${escapeHelp(t('calendar.paper'))}</th><th scope="col">${escapeHelp(t('calendar.online'))}</th></tr></thead><tbody>${rows}</tbody></table></div><p class="erp-tax-calendar-note">${escapeHelp(TAX_CALENDAR_EN.weekendNote)} ${escapeHelp(TAX_CALENDAR_EN.extensionNote)}</p>${late}</section>`;
}

// ---------------------------------------------------------------- debugging / tests / audit
// What happened to one text node: its original, whether it was translated, the Thai left over and the
// placeholder values inserted unchanged.
function inspectText(node) {
  const info = state.textInfo.get(node);
  return {
    original: state.textOriginal.has(node) ? state.textOriginal.get(node) : node?.data,
    translated: state.textApplied.has(node),
    residual: info?.residual ? [...info.residual] : [],
    kept: info?.kept ? [...info.kept] : []
  };
}

// The same for an attribute: its original (Thai) value when this module translated it.
function inspectAttribute(el, name) {
  const known = el ? state.attrState.get(el)?.[name] : null;
  const current = el?.getAttribute?.(name) ?? null;
  return { original: known && known.applied === current ? known.original : current, translated: !!(known && known.applied === current) };
}

function boot() {
  state.language = readStoredLanguage();
  afterTranslate(placeTaxHelp);
  document.addEventListener('click', onHelpClick);
  document.addEventListener('keydown', onHelpKey, true);
  wrapDialogs();
  installSwitch();
  if (isEnglish()) applyLanguage({ rerender: false });
  else updateSwitchUi();
  // The Demo menu button is created by local-demo-mode.js; if this module ran first, place the switch again.
  window.addEventListener('comform-auth-ready', installSwitch);
  window.addEventListener(STORAGE_WRITTEN_EVENT, syncFromStorage);
  window.addEventListener('storage', event => {
    if (!event.key || event.key === storageKey()) syncFromStorage();
  });
}

window.ERPI18n = Object.freeze({
  lang: () => state.language,
  isEnglish,
  setLanguage: language => setLanguage(language),
  t,
  phrase: text => (isEnglish() ? translator().phrase(text) : String(text ?? '')),
  message,
  // Always English (bilingual prints need the English label also when asked for explicitly).
  englishPhrase: text => translator().phrase(text),
  translateResult: text => translator().translate(text),
  englishBahtText,
  // Bilingual commercial documents (ADR-026 legal-language rule): Thai → the HTML / element unchanged.
  bilingualHtml: html => (isEnglish() ? bilingualDocumentHtml(html) : html),
  prepareDocumentStage: el => {
    if (!isEnglish() || !el) return el;
    el.setAttribute('data-no-i18n', 'doc');
    annotateDocument(el);
    return el;
  },
  // Excel / CSV exports: in English the first `headerRows` rows (column headers) are English; data rows are
  // never translated (they are the records as stored). Thai: the same array.
  exportRows: (rows, headerRows = 1) => (isEnglish() && Array.isArray(rows) ? rows.map((row, index) => (index < headerRows && Array.isArray(row) ? row.map(cell => (typeof cell === 'string' && hasThai(cell) ? translator().phrase(cell) : cell)) : row)) : rows),
  // Excel sheet names: at most 31 characters, none of \ / ? * [ ] :
  exportSheetName: name => (isEnglish() ? translator().phrase(String(name ?? '')).replace(/[\\/?*[\]:]/g, '-').slice(0, 31) : name),
  localizeDatesEn,
  taxMonthLabelEn,
  taxHelpRowHtml,
  taxCalendarHtml,
  helpButtonHtml,
  normalizePhrase,
  translateNow,
  afterTranslate,
  inspectText,
  inspectAttribute,
  stats: () => ({ ...state.stats, language: state.language, observing: !!state.observer, pending: state.pending.size, dictionarySize: state.translator?.size() || 0 }),
  EVENT: LANGUAGE_CHANGED_EVENT
});

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
