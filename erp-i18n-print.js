// ============================================================================
// erp-i18n-print.js — bilingual printed commercial documents in English mode (ADR-026)
// ERP DEMO 4.3.1 · round 9
// ----------------------------------------------------------------------------
// LEGAL-LANGUAGE RULE: a printed document stays a Thai document. In English mode the quotation, delivery order /
// tax invoice (full and abbreviated), receipt, credit note and debit note keep every Thai text exactly as in Thai
// mode and get a small English label next to each Thai label that has no English yet (i18n/en-print.js), plus
// the amount in English words under the Thai amount in words (bahtText). Government forms — 50 Tawi, PP.30
// worksheet, PND.3 / PND.53 attachments — are never passed here and print in Thai only.
// Thai mode never calls into this module (erp-i18n.js checks the language first), so Thai prints, PDFs and
// previews are byte-identical to the documents before ADR-026 (render-golden audit + tests).
// The English is added with inline styles, so the same markup works in the on-screen preview, the html2canvas
// PDF stage and the print window (which loads only the document's own stylesheet).
// No module state: the functions work on the element / HTML they are given (idempotent — a second call adds
// nothing), so every importer can use its own copy.
// ============================================================================
import { hasThai, normalizePhrase, localizeDatesEn, compilePattern, englishBahtText, thaiBahtTextToAmount } from './erp-i18n-core.js';
import { bahtText } from './erp-shared-core.js';
import { PRINT_LABELS_EN, PRINT_AGENCY_LABELS_EN, PRINT_PREFIXES_EN, PRINT_PATTERNS_EN, PRINT_AMOUNT_WORDS_SELECTOR, PRINT_AMOUNT_WORDS_LABEL } from './i18n/en-print.js';

const LABEL_CLASS = 'erp-print-en';
const WORDS_CLASS = 'erp-print-en-words';
const INLINE_STYLE = 'font-size:.78em;font-weight:400;font-style:italic;color:#475569;margin-left:.3em;letter-spacing:0';
const BLOCK_STYLE = 'display:block;font-size:.78em;font-weight:400;font-style:italic;color:#475569;line-height:1.2;letter-spacing:0;margin:0';
const WORDS_STYLE = 'display:block;font-size:.8em;font-weight:600;font-style:italic;color:#334155;line-height:1.25;letter-spacing:0;margin-top:1px';
// Parents in which an exact label gets its English on its own line: table headers (the documents already put
// English under Thai there) and headings. Everywhere else the English follows on the same line, so a page grows
// as little as possible (the A4 pages have fixed heights — checked in Chromium, ADR-026).
const BLOCK_PARENTS = new Set(['TH', 'H2', 'H3', 'H4']);
// Fixed-height boxes of the Thai amount in words: the English words go on a line just above the box instead.
const WORDS_BOX_SELECTOR = '.dtd-doc-baht, .rcp-doc-baht';
const LATIN_WORD_RE = /[A-Za-z]{2,}/; // "No.", "P/O. No.", "Customer code"
// Leading decoration of a prefix label (" · เลขประจำตัวผู้เสียภาษี 0105…").
const PREFIX_LEAD_RE = /^[\s·•\-–—]*/;

const LABELS = new Map(PRINT_LABELS_EN.map(([th, en]) => [normalizePhrase(th), en]));
const AGENCY = new Map(PRINT_AGENCY_LABELS_EN.map(([th, en]) => [normalizePhrase(th), en]));
const PREFIXES = [...PRINT_PREFIXES_EN].sort((a, b) => b[0].length - a[0].length);
let PATTERNS = null;
function patterns() {
  if (!PATTERNS) PATTERNS = PRINT_PATTERNS_EN.map(([th, en]) => compilePattern(th, en));
  return PATTERNS;
}

// English for the whole text of a node: an exact label or a pattern (kept values shown with Gregorian dates).
export function printEnglishFor(text) {
  // A leading separator is not part of the label ("· สาขาสำนักงานใหญ่" after the company name).
  const whole = normalizePhrase(text);
  if (LABELS.has(whole)) return LABELS.get(whole);
  const key = whole.replace(PREFIX_LEAD_RE, '');
  if (!key || !hasThai(key)) return '';
  if (LABELS.has(key)) return LABELS.get(key);
  const agency = agencyEnglish(key);
  if (agency) return agency;
  const dated = normalizePhrase(localizeDatesEn(key));
  if (!hasThai(dated)) return dated; // r13#LANG-print: a Thai long date alone ("2 สิงหาคม พ.ศ. 2569" → "2 August 2026")
  for (const pattern of patterns()) {
    const m = pattern.re.exec(dated);
    if (!m) continue;
    const values = {};
    pattern.slots.forEach((slot, i) => { values[slot.name] = m[i + 1]; });
    return pattern.en.replace(/\{([A-Za-z_][\w]*)\}/g, (whole, name) => (Object.prototype.hasOwnProperty.call(values, name) ? values[name] : whole));
  }
  return '';
}

// The customer type of a quotation: a group / type label, or "group / type" (a group label may itself hold " / ").
function agencyEnglish(text) {
  if (AGENCY.has(text)) return AGENCY.get(text);
  const parts = text.split(' / ');
  for (let i = 1; i < parts.length; i += 1) {
    const left = parts.slice(0, i).join(' / '), right = parts.slice(i).join(' / ');
    if (AGENCY.has(left) && AGENCY.has(right)) return `${AGENCY.get(left)} / ${AGENCY.get(right)}`;
  }
  return '';
}

// The prefix label at the start of a text followed by data: { lead, label, english } or null.
export function printPrefixFor(text) {
  const source = String(text ?? '');
  const lead = (source.match(PREFIX_LEAD_RE) || [''])[0];
  const rest = source.slice(lead.length);
  for (const [label, english] of PREFIXES) {
    if (!rest.startsWith(label)) continue;
    const after = rest.slice(label.length);
    if (!after.trim() || !/^\s/.test(after)) continue; // a whole label is an exact entry; "วันที่เสนอราคา" is not "วันที่"
    if (/^\s*\//.test(after)) return null; // already bilingual: "วันที่ / Date", "เลขประจำตัวผู้เสียภาษี / Tax ID :"
    return { lead, label, english };
  }
  return null;
}

// The English amount in words for a Thai bahtText() text, or '' when it is not one (or does not read back the same).
export function englishWordsForThai(thaiText) {
  const text = normalizePhrase(String(thaiText ?? '').replace(/^\(\s*|\s*\)$/g, ''));
  const amount = thaiBahtTextToAmount(text);
  if (amount === null || bahtText(amount) !== text) return '';
  try {
    return englishBahtText(amount);
  } catch (error) {
    console.warn('[ERPI18nPrint] amount in words not written', error);
    return '';
  }
}

// Whether a Thai label already carries English next to it ("รหัสลูกค้า<br><span>Customer code</span>",
// "<b>ผู้อนุมัติ</b><span>Authorized signature</span>", "ใบเสนอราคา" + "QUOTATION").
function hasEnglishAlready(node) {
  const parent = node.parentElement;
  if (!parent) return false;
  let outside = '';
  for (const child of parent.childNodes) if (child !== node) outside += child.textContent || '';
  if (LATIN_WORD_RE.test(outside)) return true;
  const next = parent.nextElementSibling;
  if (next && ['SPAN', 'EM', 'SMALL', 'DIV'].includes(next.tagName)) {
    const text = next.textContent || '';
    if (!hasThai(text) && LATIN_WORD_RE.test(text)) return true;
  }
  return false;
}

function englishSpan(doc, text, block) {
  const span = doc.createElement('span');
  span.className = LABEL_CLASS;
  span.setAttribute('lang', 'en');
  span.setAttribute('style', block ? BLOCK_STYLE : INLINE_STYLE);
  span.textContent = text;
  return span;
}

function annotateText(node) {
  const parent = node.parentElement;
  // [data-bilingual]: a block printed in Thai and English already (ADR-029 PromptPay box) gets no second label.
  if (!parent || parent.closest(`.${LABEL_CLASS}, .${WORDS_CLASS}, [data-bilingual]`)) return 0;
  const next = node.nextSibling;
  if (next?.nodeType === 1 && next.classList.contains(LABEL_CLASS)) return 0; // done before
  if (!hasThai(node.data)) return 0;
  const doc = node.ownerDocument;
  const whole = printEnglishFor(node.data);
  if (whole) {
    if (hasEnglishAlready(node)) return 0;
    const onlyChild = parent.childNodes.length === 1;
    node.after(englishSpan(doc, whole, onlyChild && BLOCK_PARENTS.has(parent.tagName)));
    return 1;
  }
  const prefix = printPrefixFor(node.data);
  if (prefix && !hasEnglishAlready(node)) {
    node.splitText(prefix.lead.length + prefix.label.length); // node = lead + label, then " data…" as it was
    node.after(englishSpan(doc, prefix.english, false));
    return 1;
  }
  return 0;
}

function annotateWords(el) {
  const box = el.closest(WORDS_BOX_SELECTOR);
  if (box ? box.previousElementSibling?.classList.contains(WORDS_CLASS) : el.querySelector(`.${WORDS_CLASS}`)) return 0;
  const english = englishWordsForThai(el.textContent);
  if (!english) return 0;
  const span = el.ownerDocument.createElement('span');
  span.className = WORDS_CLASS;
  span.setAttribute('lang', 'en');
  span.setAttribute('style', WORDS_STYLE);
  if (box) {
    span.textContent = `${PRINT_AMOUNT_WORDS_LABEL}: ${english}`;
    box.before(span);
  } else {
    span.textContent = el.matches('.qdoc-baht-text, .dtd-abbr-baht') ? `(${english})` : english;
    el.append(span);
  }
  return 1;
}

// Adds the English labels and the English amount in words inside `root` (an element or a fragment).
// Returns how many were added (0 when everything was already there).
export function annotateDocument(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return 0;
  const doc = root.ownerDocument || root;
  let added = 0;
  root.querySelectorAll(PRINT_AMOUNT_WORDS_SELECTOR).forEach(el => { added += annotateWords(el); });
  const walker = doc.createTreeWalker(root, 4);
  const texts = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node);
  for (const node of texts) {
    if (node.parentElement?.closest('script, style')) continue;
    added += annotateText(node);
  }
  return added;
}

// Removes what annotateDocument() added and joins the split texts again (back to the Thai markup).
export function removeAnnotations(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return 0;
  const added = root.querySelectorAll(`.${LABEL_CLASS}, .${WORDS_CLASS}`);
  const parents = new Set();
  added.forEach(el => { parents.add(el.parentNode); el.remove(); });
  parents.forEach(parent => parent?.normalize?.());
  return added.length;
}

// The same for an HTML string (print window, PDF stage): parsed in an inert <template>, annotated, serialised.
export function bilingualDocumentHtml(html, doc = document) {
  const template = doc.createElement('template');
  template.innerHTML = String(html ?? '');
  annotateDocument(template.content);
  return template.innerHTML;
}

export const PRINT_CLASSES = Object.freeze({ label: LABEL_CLASS, words: WORDS_CLASS });
