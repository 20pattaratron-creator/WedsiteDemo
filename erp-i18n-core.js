// ============================================================================
// erp-i18n-core.js — pure core of the TH / EN language switch (ADR-026)
// ERP DEMO 4.3.1 · round 9
// ----------------------------------------------------------------------------
// Thai is the source language of the whole app: every screen is written in Thai and stays exactly as it
// was. English is a second layer on top:
//   - the language setting (UI_LANGUAGE_KEY in erp-storage-contracts.js, 'th' | 'en', default 'th');
//   - t(key, params) for new code (KEYS tables with both languages, i18n/en-keys.js);
//   - a phrase translator for the existing Thai text: an exact dictionary (TH → EN, matched on trimmed,
//     whitespace-normalised text) plus a short ordered list of pattern rules whose placeholders capture the
//     dynamic parts (numbers, dates, names, counts) and insert them unchanged in the English text;
//   - Gregorian dates for English (dd/mm/2569 → dd/mm/2026, "12 ต.ค. 2569" → "12 Oct 2026");
//   - englishBahtText(): an amount in English words, next to the Thai bahtText() on bilingual prints.
// No DOM, no storage access, no module state that matters (the jsdom harness gives every importer its own
// copy of a module): the DOM layer (erp-i18n.js) owns the live state and passes data in.
//
// USER-DATA RULE (ADR-026): the translator only ever replaces text that matches the dictionary or a
// pattern. Customer / product / company names, addresses, notes and document numbers are rendered inside
// elements marked data-no-i18n, which the DOM layer never touches. A user value that happens to equal a
// dictionary phrase exactly (say a product literally named "ค่าขนส่ง") could still be translated outside
// such a cell; that is acceptable and rare, and the coverage test lists every residual.
// ============================================================================

export const UI_LANGUAGES = Object.freeze(['th', 'en']);
export const DEFAULT_UI_LANGUAGE = 'th';
export const UI_LANGUAGE_SCHEMA_VERSION = 1;

// U+0E00–U+0E7F: the Thai block ([฀-๿]), the same range the coverage audit looks for.
const THAI_CHAR_RE = /[฀-๿]/;
const THAI_CHAR_GLOBAL_RE = /[฀-๿]/g;
// Whitespace the screens use between words, including no-break, figure, narrow and zero-width spaces.
const PHRASE_SPACE_RE = /[\s   ​﻿]+/g;

export function hasThai(value) {
  return THAI_CHAR_RE.test(String(value ?? ''));
}

export function thaiCharCount(value) {
  return (String(value ?? '').match(THAI_CHAR_GLOBAL_RE) || []).length;
}

// One phrase key: whitespace runs → one space, trimmed. Used for both dictionary keys and screen text.
export function normalizePhrase(value) {
  return String(value ?? '').replace(PHRASE_SPACE_RE, ' ').trim();
}

// ---------------------------------------------------------------- the setting
export function normalizeUiLanguage(value) {
  return String(value ?? '').trim().toLowerCase() === 'en' ? 'en' : DEFAULT_UI_LANGUAGE;
}

// The stored value → 'th' | 'en'. Fail-safe: anything missing, damaged or unknown is Thai (the default),
// never an error — a preference must not stop the app from starting. Accepted: the record
// { schemaVersion: 1, language, updatedAt } (written by serializeUiLanguageSetting), and the bare words
// 'th' / 'en' (e.g. a JSON backup restore of the parsed record's language).
export function parseUiLanguageSetting(raw) {
  if (raw === null || raw === undefined) return DEFAULT_UI_LANGUAGE;
  let value = raw;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return DEFAULT_UI_LANGUAGE;
    if (text === 'th' || text === 'en') return text;
    try {
      value = JSON.parse(text);
    } catch (_) {
      return DEFAULT_UI_LANGUAGE; // damaged value: Thai, the default
    }
  }
  if (typeof value === 'string') return normalizeUiLanguage(value);
  if (value && typeof value === 'object' && !Array.isArray(value)) return normalizeUiLanguage(value.language);
  return DEFAULT_UI_LANGUAGE;
}

export function uiLanguageRecord(language, updatedAt = '') {
  return { schemaVersion: UI_LANGUAGE_SCHEMA_VERSION, language: normalizeUiLanguage(language), updatedAt: String(updatedAt || '') };
}

export function serializeUiLanguageSetting(language, updatedAt = '') {
  return JSON.stringify(uiLanguageRecord(language, updatedAt));
}

// ---------------------------------------------------------------- dates (Thai B.E. → Gregorian for English)
export const THAI_MONTHS_FULL = Object.freeze(['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']);
export const THAI_MONTHS_ABBR = Object.freeze(['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']);
export const ENGLISH_MONTHS_FULL = Object.freeze(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);
export const ENGLISH_MONTHS_ABBR = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);

const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Longest first, so "มีนาคม" is not read as a shorter name and "มี.ค." wins over nothing shorter.
const MONTH_NAME_SOURCE = [...THAI_MONTHS_FULL, ...THAI_MONTHS_ABBR].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|');
const thaiMonthIndex = name => {
  const full = THAI_MONTHS_FULL.indexOf(name);
  return full >= 0 ? { index: full, full: true } : { index: THAI_MONTHS_ABBR.indexOf(name), full: false };
};

// A Buddhist-Era year (2400–2699) → the Gregorian year; anything else is returned unchanged.
export function beYearToAd(year) {
  const y = Number(year);
  return Number.isInteger(y) && y >= 2400 && y <= 2699 ? y - 543 : y;
}

// dd/mm/25yy or dd-mm-25yy (formatThaiDate / formatDate) → dd/mm/20yy. Not inside a longer token
// (document numbers such as INV-12-10-2569 stay as they are).
const NUMERIC_BE_DATE_RE = /(^|[^\w/.-])(\d{1,2})([/-])(\d{1,2})\3(2[456]\d{2})(?![\w/-])/g;
// mm/25yy (a month + year, e.g. "ปิดงวดเดือน 09/2569") → mm/20yy.
const NUMERIC_BE_MONTH_RE = /(^|[^\w/.-])(\d{1,2})\/(2[456]\d{2})(?![\w/-])/g;
// "12 ต.ค. 2569", "12 ตุลาคม 2569", "ต.ค. 2569", "ตุลาคม 2569", "12 ต.ค. 69" (two-digit year only after an abbreviation with a day).
const THAI_DAY_MONTH_YEAR_RE = new RegExp(`(^|[^\\d])(\\d{1,2})\\s*(${MONTH_NAME_SOURCE})(?:\\s*(2[456]\\d{2}|\\d{2})(?!\\d))?`, 'g');
const THAI_MONTH_YEAR_RE = new RegExp(`(${MONTH_NAME_SOURCE})\\s*(?:พ\\.ศ\\.\\s*)?(2[456]\\d{2})(?!\\d)`, 'g');
const BE_ERA_YEAR_RE = /พ\.ศ\.\s*(2[456]\d{2})(?!\d)/g;
// The first three letters of a month name (chart axes) — not inside a longer Thai word.
export const THAI_MONTH_PREFIXES = Object.freeze(THAI_MONTHS_FULL.map(name => name.slice(0, 3)));
const THAI_ABBR_SHORT_YEAR_RE = new RegExp(`(^|[^\\u0E00-\\u0E7F\\d])(${THAI_MONTHS_ABBR.map(escapeRegExp).join('|')}) (\\d{2})(?!\\d)`, 'g');
const THAI_PREFIX_SHORT_YEAR_RE = new RegExp(`(^|[^\\u0E00-\\u0E7F\\d])(${THAI_MONTH_PREFIXES.map(escapeRegExp).join('|')}) (\\d{2})(?!\\d)`, 'g');

export function localizeDatesEn(text) {
  let out = String(text ?? '');
  if (!/\d/.test(out)) return out;
  out = out.replace(NUMERIC_BE_DATE_RE, (_, lead, d, _sep, m, y) => `${lead}${d}/${m}/${beYearToAd(y)}`);
  out = out.replace(NUMERIC_BE_MONTH_RE, (whole, lead, m, y) => (Number(m) >= 1 && Number(m) <= 12 ? `${lead}${m}/${beYearToAd(y)}` : whole));
  out = out.replace(THAI_DAY_MONTH_YEAR_RE, (whole, lead, d, name, y) => {
    const { index, full } = thaiMonthIndex(name);
    if (index < 0) return whole;
    const month = full ? ENGLISH_MONTHS_FULL[index] : ENGLISH_MONTHS_ABBR[index];
    if (!y) return `${lead}${d} ${month}`;
    if (y.length === 2) return full ? whole : `${lead}${d} ${month} ${beYearToAd(2500 + Number(y))}`;
    return `${lead}${d} ${month} ${beYearToAd(y)}`;
  });
  out = out.replace(THAI_MONTH_YEAR_RE, (whole, name, y) => {
    const { index, full } = thaiMonthIndex(name);
    if (index < 0) return whole;
    return `${full ? ENGLISH_MONTHS_FULL[index] : ENGLISH_MONTHS_ABBR[index]} ${beYearToAd(y)}`;
  });
  out = out.replace(BE_ERA_YEAR_RE, (_, y) => `${beYearToAd(y)}`);
  // Chart labels: "ก.ย. 69" → "Sep 2026"; the 3-letter form "กัน 69" → "Sep 26".
  out = out.replace(THAI_ABBR_SHORT_YEAR_RE, (whole, lead, name, yy) => {
    const index = THAI_MONTHS_ABBR.indexOf(name);
    return index < 0 ? whole : `${lead}${ENGLISH_MONTHS_ABBR[index]} ${beYearToAd(2500 + Number(yy))}`;
  });
  out = out.replace(THAI_PREFIX_SHORT_YEAR_RE, (whole, lead, name, yy) => {
    const index = THAI_MONTH_PREFIXES.indexOf(name);
    return index < 0 ? whole : `${lead}${ENGLISH_MONTHS_ABBR[index]} ${String(beYearToAd(2500 + Number(yy)) % 100).padStart(2, '0')}`;
  });
  return out;
}

// Money: "฿1,234.50" → "THB 1,234.50" (the baht sign is in the Thai block; English readers expect the code);
// a lone "฿" (an input prefix, "· ฿") → "THB".
const BAHT_AMOUNT_RE = /฿\s?(?=[-+−]?\d|\{)/g;
const BAHT_SIGN_RE = /฿/g;
export function localizeMoneyEn(text) {
  const value = String(text ?? '');
  if (!value.includes('฿')) return value;
  return value.replace(BAHT_AMOUNT_RE, 'THB ').replace(BAHT_SIGN_RE, 'THB');
}

// Everything language-independent an English screen changes: Gregorian dates and the currency code.
export function localizeEn(text) {
  return localizeMoneyEn(localizeDatesEn(text));
}

// "September 2026 (tax month)" — the English name of a tax month (month 1–12, year in either era).
export function taxMonthLabelEn(month, year) {
  const m = Number(month);
  const y = beYearToAd(Number(year));
  if (!Number.isInteger(m) || m < 1 || m > 12 || !Number.isFinite(y)) return '';
  return `${ENGLISH_MONTHS_FULL[m - 1]} ${y} (tax month)`;
}

// ---------------------------------------------------------------- t(key, params)
// keys: { key: { th, en } }. A missing key returns the key itself (visible in tests, never a crash);
// a missing English text falls back to the Thai one.
export function interpolate(template, params = {}) {
  return String(template ?? '').replace(/\{([A-Za-z_][\w]*)\}/g, (whole, name) => (Object.prototype.hasOwnProperty.call(params, name) ? String(params[name] ?? '') : whole));
}

export function translateKey(keys, language, key, params = {}) {
  const entry = keys && Object.prototype.hasOwnProperty.call(keys, key) ? keys[key] : null;
  if (!entry) return String(key);
  const template = normalizeUiLanguage(language) === 'en' && entry.en ? entry.en : entry.th;
  return interpolate(template, params);
}

// ---------------------------------------------------------------- patterns
// A pattern is [thaiTemplate, englishTemplate]. Placeholders: {name} (any text, kept unchanged),
// {name:num} (a number such as 1,234.50 / -3 / 12%), {name:t} (text translated again through the
// dictionary when it can be, else kept), {name:be} (a Buddhist-Era year shown as the Gregorian year).
// The English template uses each placeholder once by its plain name: "{amount}".
const PLACEHOLDER_RE = /\{([A-Za-z_][\w]*)(?::(num|t|be))?\}/g;
const PLACEHOLDER_SOURCE = {
  any: '(.+?)',
  t: '(.+?)',
  num: '([-+]?\\d[\\d,]*(?:\\.\\d+)?%?)',
  be: '(2[456]\\d{2})'
};

export function patternPlaceholders(template) {
  return [...String(template ?? '').matchAll(PLACEHOLDER_RE)].map(m => ({ name: m[1], type: m[2] || 'any' }));
}

export function englishPlaceholders(template) {
  return [...String(template ?? '').matchAll(/\{([A-Za-z_][\w]*)\}/g)].map(m => m[1]);
}

export function compilePattern(thaiTemplate, englishTemplate) {
  // Screen text has its era years converted before matching ("พ.ศ. 2569" → "2026"), so a template's
  // "พ.ศ. {y}" / "พ.ศ. {y:be}" becomes a plain number slot.
  const th = normalizePhrase(localizeEn(String(thaiTemplate ?? '').replace(/พ\.ศ\.\s*\{([A-Za-z_][\w]*)(?::(?:be|num))?\}/g, '{$1:num}')));
  const en = String(englishTemplate ?? '');
  const slots = [];
  let source = '';
  let last = 0;
  for (const m of th.matchAll(PLACEHOLDER_RE)) {
    source += escapeRegExp(th.slice(last, m.index));
    const type = m[2] || 'any';
    source += PLACEHOLDER_SOURCE[type];
    slots.push({ name: m[1], type });
    last = m.index + m[0].length;
  }
  source += escapeRegExp(th.slice(last));
  if (!slots.length) throw new Error(`pattern has no placeholder: ${thaiTemplate}`);
  const names = slots.map(s => s.name);
  if (new Set(names).size !== names.length) throw new Error(`pattern repeats a placeholder: ${thaiTemplate}`);
  const used = englishPlaceholders(en);
  for (const name of names) if (!used.includes(name)) throw new Error(`English text drops {${name}}: ${thaiTemplate}`);
  for (const name of used) if (!names.includes(name)) throw new Error(`English text has unknown {${name}}: ${thaiTemplate}`);
  // A pattern must say something fixed besides its placeholders (else it would match everything).
  if (!hasThai(th.replace(PLACEHOLDER_RE, ''))) throw new Error(`pattern has no Thai text: ${thaiTemplate}`);
  return { th, en, slots, re: new RegExp(`^${source}$`, 'u') };
}

// ---------------------------------------------------------------- the phrase translator
// Tried in this order when no entry or pattern matches a whole phrase; a split is used only when every part
// with Thai in it translates completely. (Line breaks are handled before, line by line.)
const SPLITTERS = Object.freeze([' · ', ' — ', ' – ', ' | ', ' / ', ': ', ', ', ' • ', ' → ', ' ']);
// Decorations around a phrase that are not part of it: leading marks / bullets / emoji, trailing colon,
// ellipsis, asterisk (required field) and similar.
const LEAD_DECOR_RE = /^[^\p{L}\p{N}(“"'[{<฿$#@-]+/u;
const TRAIL_DECOR_RE = /[\s:：*…!?.,;]+$/u;
// A count or percentage after a label ("ลูกค้า 9", "ค่าขนส่ง 1%", "ค่าขนส่ง (1%)"): kept, the label translated.
const TRAIL_NUMBER_RE = /\s+\(?[-+]?\d[\d,.]*%?\)?[\s:：*…!?.,;]*$/u;
// A Thai run: Thai letters, with dots inside (ภ.พ.30 → "ภ.พ.") and single spaces between Thai words.
const THAI_RUN_RE = /[฀-๿](?:[฀-๿.]|[ ](?=[฀-๿]))*/gu;
const MAX_DEPTH = 4;
const CACHE_LIMIT = 20000;

function emptyResult(text) {
  return { text, translated: false, residual: [], kept: [] };
}

// entries: [[thai, english], …] (several lists concatenated); patterns: [[thaiTemplate, englishTemplate], …].
// Returns { translate(text) → { text, translated, residual: [Thai fragments left], kept: [placeholder values
// inserted unchanged] }, phrase(text) → English string, has(thai), size }.
// strict (default): a bad entry or pattern throws (the dictionary tests use this). strict: false (the screen)
// skips it and reports it through onError, so one broken entry can never stop the English screen.
export function createPhraseTranslator({ entries = [], patterns = [], strict = true, onError = null } = {}) {
  const fail = error => {
    if (strict) throw error;
    if (typeof onError === 'function') onError(error);
  };
  const exact = new Map();
  for (const pair of entries) {
    try {
      if (!Array.isArray(pair) || pair.length !== 2) throw new Error('dictionary entry must be [thai, english]');
      const key = normalizePhrase(localizeEn(pair[0]));
      const value = String(pair[1] ?? '');
      if (!key || !value.trim()) throw new Error(`empty dictionary entry: ${pair[0]}`);
      if (exact.has(key) && exact.get(key) !== value) throw new Error(`conflicting dictionary entries for: ${key}`);
      exact.set(key, value);
    } catch (error) {
      fail(error);
    }
  }
  const compiled = [];
  for (const pair of patterns) {
    try {
      if (!Array.isArray(pair) || pair.length !== 2) throw new Error('pattern must be [thai, english]');
      compiled.push(compilePattern(pair[0], pair[1]));
    } catch (error) {
      fail(error);
    }
  }
  const cache = new Map();

  function lookupExact(key) {
    return exact.has(key) ? exact.get(key) : null;
  }

  function applyPatterns(key, depth) {
    for (const pattern of compiled) {
      const m = pattern.re.exec(key);
      if (!m) continue;
      const values = {};
      const kept = [];
      const residual = [];
      pattern.slots.forEach((slot, i) => {
        let value = m[i + 1];
        if (slot.type === 't') {
          const inner = translateCore(value, depth + 1);
          if (inner.translated || !hasThai(value)) {
            value = inner.text;
            kept.push(...inner.kept);
            residual.push(...inner.residual);
          } else {
            kept.push(value);
          }
        } else if (slot.type === 'be') {
          value = String(beYearToAd(Number(value)));
        } else {
          kept.push(value);
        }
        values[slot.name] = value;
      });
      const text = pattern.en.replace(/\{([A-Za-z_][\w]*)\}/g, (whole, name) => (Object.prototype.hasOwnProperty.call(values, name) ? values[name] : whole));
      return { text, translated: true, residual, kept };
    }
    return null;
  }

  function withDecorations(key, depth) {
    const lead = (key.match(LEAD_DECOR_RE) || [''])[0];
    const rest = key.slice(lead.length);
    for (const trailRe of [TRAIL_DECOR_RE, TRAIL_NUMBER_RE]) {
      const trail = (rest.match(trailRe) || [''])[0];
      const core = rest.slice(0, rest.length - trail.length).trim();
      if (!core || core === key || !hasThai(core)) continue;
      const inner = translateWhole(core, depth + 1);
      if (inner) return { ...inner, text: `${lead}${inner.text}${trail}` };
    }
    return null;
  }

  // Exact → pattern → the same without decorations. null when nothing matches the whole phrase.
  function translateWhole(key, depth) {
    const hit = lookupExact(key);
    if (hit !== null) return { text: hit, translated: true, residual: [], kept: [] };
    const byPattern = applyPatterns(key, depth);
    if (byPattern) return byPattern;
    if (depth < MAX_DEPTH) return withDecorations(key, depth);
    return null;
  }

  function splitTranslate(key, depth) {
    for (const sep of SPLITTERS) {
      if (!key.includes(sep)) continue;
      const parts = key.split(sep);
      const out = [];
      let ok = true;
      const kept = [];
      for (const part of parts) {
        const trimmed = sep === '\n' ? part : part.trim();
        if (!hasThai(trimmed)) { out.push(part); continue; }
        const inner = translateCore(trimmed, depth + 1);
        if (!inner.translated || inner.residual.length) { ok = false; break; }
        kept.push(...inner.kept);
        out.push(sep === '\n' ? inner.text : part.replace(trimmed, inner.text));
      }
      if (ok) return { text: out.join(sep), translated: true, residual: [], kept };
    }
    // Composite labels ("September · <product name> · THB 0.00", "INV1 | <customer> | …") mix UI words with user data: the parts that
    // translate are translated, the others stay as they are and are reported (the audit accepts them only
    // when they are stored user data).
    const composite = [' · ', ' | ', ' — '].find(sep => key.includes(sep));
    if (composite) {
      const residual = [];
      const kept = [];
      let any = false;
      const text = key.split(composite).map(part => {
        const trimmed = part.trim();
        if (!hasThai(trimmed)) return part;
        const inner = translateCore(trimmed, depth + 1);
        if (inner.translated) {
          // A part may itself be a composite translated in part ("INV1 | <customer> | Paid"): keep what it left.
          any = true;
          kept.push(...inner.kept);
          residual.push(...inner.residual);
          return part.replace(trimmed, inner.text);
        }
        residual.push(trimmed);
        return part;
      }).join(composite);
      if (any) return { text, translated: true, residual, kept };
    }
    return null;
  }

  // Last resort: every Thai run (Thai words joined by single spaces, so a name such as "บริษัท ก จำกัด" stays
  // one run and is never translated word by word) must itself be a dictionary phrase; then each is replaced.
  // All or nothing: if any run is unknown the text stays exactly as it was (residual reported), so a user value
  // such as a product name is never half-translated ("เครื่องพิมพ์ (พิมพ์/สแกน)" keeps its "พิมพ์").
  function runTranslate(key) {
    const residual = [];
    let any = false;
    const text = key.replace(THAI_RUN_RE, (run, offset, whole) => {
      // A run may end with a full stop that is not part of the phrase ("แล้ว."); "ภ.พ." keeps its dots.
      let phrase = run;
      let hit = lookupExact(phrase);
      if (hit === null && /\.$/.test(run)) {
        phrase = run.replace(/\.+$/, '');
        hit = phrase ? lookupExact(phrase) : null;
      }
      if (hit === null) {
        residual.push(run);
        return run;
      }
      any = true;
      const tail = run.slice(phrase.length);
      const before = offset > 0 ? whole[offset - 1] : '';
      const after = whole[offset + run.length] || '';
      // Thai needs no space next to a number or a Latin word; English does.
      const lead = /[A-Za-z0-9)\]%]/.test(before) && /^[A-Za-z0-9(]/.test(hit) ? ' ' : '';
      const trail = !tail && /^[A-Za-z0-9(]/.test(after) && /[A-Za-z0-9)]$/.test(hit) ? ' ' : '';
      return `${lead}${hit}${tail}${trail}`;
    });
    if (residual.length) return { text: key, translated: false, residual, kept: [] };
    return { text, translated: any, residual, kept: [] };
  }

  function translateCore(raw, depth = 0) {
    const key = normalizePhrase(raw);
    if (!hasThai(key)) return emptyResult(key);
    const whole = translateWhole(key, depth);
    if (whole) return whole;
    if (depth < MAX_DEPTH) {
      const split = splitTranslate(key, depth);
      if (split) return split;
    }
    return runTranslate(key);
  }

  // A message with line breaks (confirm / alert / prompt text, toasts): line by line, blank lines kept.
  function translateLines(text) {
    const kept = [];
    const residual = [];
    let any = false;
    const lines = text.split('\n').map(line => {
      if (!hasThai(line)) return line;
      const lead = (line.match(/^\s*/) || [''])[0];
      const inner = translateCore(line, 0);
      if (!inner.translated) {
        residual.push(...(inner.residual.length ? inner.residual : [normalizePhrase(line)]));
        return line;
      }
      any = true;
      kept.push(...inner.kept);
      residual.push(...inner.residual);
      return `${lead}${inner.text}`;
    });
    return { text: lines.join('\n'), translated: any, residual, kept };
  }

  // Public: dates first (language-independent), then the phrase. Leading / trailing whitespace of the
  // original is kept so text nodes keep their spacing. Text with line breaks is first tried as one phrase
  // (HTML source wraps long text nodes), then line by line; the result with fewer residual pieces wins.
  function translate(text) {
    const source = String(text ?? '');
    if (cache.has(source)) return cache.get(source);
    const lead = (source.match(/^\s*/) || [''])[0];
    const trail = lead.length === source.length ? '' : (source.match(/\s*$/) || [''])[0];
    const dated = localizeEn(source);
    let result;
    if (!hasThai(dated)) {
      result = { text: dated, translated: dated !== source, residual: [], kept: [] };
    } else {
      let core = translateCore(dated, 0);
      const body = dated.trim();
      if (body.includes('\n') && (!core.translated || core.residual.length)) {
        const byLine = translateLines(body);
        if (byLine.translated && (!core.translated || byLine.residual.length < core.residual.length)) core = byLine;
      }
      if (core.translated) result = { ...core, text: `${lead}${singularizeCounts(core.text)}${trail}` };
      // Not translated: the dates and money are still shown the English way (they are language-independent).
      else result = { text: dated, translated: dated !== source, residual: core.residual.length ? core.residual : [normalizePhrase(dated)], kept: [] };
    }
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(source, result);
    return result;
  }

  return Object.freeze({
    translate,
    phrase: text => translate(text).text,
    has: thai => exact.has(normalizePhrase(localizeEn(thai))),
    size: () => exact.size,
    patternCount: () => compiled.length
  });
}

// ---------------------------------------------------------------- English plural after the count 1 (r13#LANG-plural)
// The dictionaries translate a Thai counter ("ใบ", "รายการ", "บิล", "ราย", "เดือน") with one fixed English plural, so a
// count of 1 read "1 documents". One rule on the translated text fixes every pattern: a stand-alone "1" (not part of
// 11, 21, 1.5 or 1,000) followed by one of these plurals takes the singular. 0, 2, 11, 21 … keep the plural.
const SINGULAR_OF = Object.freeze({ documents: 'document', items: 'item', invoices: 'invoice', customers: 'customer', suppliers: 'supplier', payees: 'payee', months: 'month', days: 'day', files: 'file', images: 'image', PDFs: 'PDF', rows: 'row', jobs: 'job', entries: 'entry', hours: 'hour', times: 'time', rounds: 'round', scenarios: 'scenario', lines: 'line', issues: 'issue', receipts: 'receipt', notes: 'note', orders: 'order', products: 'product', certificates: 'certificate', branches: 'branch', units: 'unit', pages: 'page', sheets: 'sheet', accounts: 'account' });
const SINGULAR_RE = new RegExp(`(^|[^\\w.,])1 (${Object.keys(SINGULAR_OF).join('|')})\\b`, 'g');
export function singularizeCounts(text) {
  return String(text ?? '').replace(SINGULAR_RE, (match, before, plural) => `${before}1 ${SINGULAR_OF[plural]}`);
}

// ---------------------------------------------------------------- English amount in words
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];
// Largest amount accepted: below one quadrillion baht, so satang stay exact in a double.
export const ENGLISH_BAHT_TEXT_MAX = 999999999999999;

function wordsBelowThousand(n) {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts = [];
  if (hundreds) parts.push(`${ONES[hundreds]} hundred`);
  if (rest) parts.push(rest < 20 ? ONES[rest] : `${TENS[Math.floor(rest / 10)]}${rest % 10 ? `-${ONES[rest % 10]}` : ''}`);
  return parts.join(' ');
}

// A whole number (0 … ENGLISH_BAHT_TEXT_MAX) in English words, US style without "and": 1,234 → "one thousand
// two hundred thirty-four".
export function englishIntegerText(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || n > ENGLISH_BAHT_TEXT_MAX) throw new RangeError(`englishIntegerText: not a whole number in range: ${value}`);
  if (n === 0) return ONES[0];
  const groups = [];
  let rest = n;
  while (rest > 0) {
    groups.push(rest % 1000);
    rest = Math.floor(rest / 1000);
  }
  const words = [];
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    if (!groups[i]) continue;
    words.push(SCALES[i] ? `${wordsBelowThousand(groups[i])} ${SCALES[i]}` : wordsBelowThousand(groups[i]));
  }
  return words.join(' ');
}

// The Thai amount in words printed by bahtText() → the amount, or null when the text is not one
// ("หนึ่งพันหกร้อยห้าบาทถ้วน" → 1605, "( ศูนย์บาทถ้วน )" → 0, "สามพันแปดร้อยสี่สิบเอ็ดบาทสามสิบสตางค์" → 3841.3).
// Bilingual prints read the amount back from the Thai text they show, so the English words always say the same
// amount; the caller also checks bahtText(result) === the Thai text before printing them.
const THAI_DIGIT_WORDS = Object.freeze([['ศูนย์', 0], ['หนึ่ง', 1], ['เอ็ด', 1], ['สอง', 2], ['ยี่', 2], ['สาม', 3], ['สี่', 4], ['ห้า', 5], ['หก', 6], ['เจ็ด', 7], ['แปด', 8], ['เก้า', 9]]);
const THAI_UNIT_WORDS = Object.freeze([['สิบ', 10], ['ร้อย', 100], ['พัน', 1000], ['หมื่น', 10000], ['แสน', 100000]]);

function thaiWordsToInteger(words) {
  if (!words) return null;
  const million = words.lastIndexOf('ล้าน');
  if (million >= 0) {
    const high = thaiWordsToInteger(words.slice(0, million));
    const lowText = words.slice(million + 'ล้าน'.length);
    const low = lowText ? thaiWordsToInteger(lowText) : 0;
    return high === null || low === null || low >= 1000000 ? null : high * 1000000 + low;
  }
  if (words === 'ศูนย์') return 0;
  let total = 0;
  let digit = null;
  let lastUnit = Infinity;
  let rest = words;
  while (rest) {
    const d = THAI_DIGIT_WORDS.find(([word]) => rest.startsWith(word));
    if (d) {
      if (digit !== null || d[1] === 0) return null;
      digit = d[1];
      rest = rest.slice(d[0].length);
      continue;
    }
    const u = THAI_UNIT_WORDS.find(([word]) => rest.startsWith(word));
    if (!u || u[1] >= lastUnit) return null;
    total += (digit ?? 1) * u[1];
    lastUnit = u[1];
    digit = null;
    rest = rest.slice(u[0].length);
  }
  return total + (digit ?? 0);
}

export function thaiBahtTextToAmount(text) {
  const compact = String(text ?? '').replace(/[\s()]/g, '');
  const m = /^(.+?)บาท(?:ถ้วน|(.+)สตางค์)$/.exec(compact);
  if (!m) return null;
  const baht = thaiWordsToInteger(m[1]);
  const satang = m[2] ? thaiWordsToInteger(m[2]) : 0;
  if (baht === null || satang === null || satang > 99 || !Number.isSafeInteger(baht * 100 + satang)) return null;
  return (baht * 100 + satang) / 100;
}

// An amount in baht → English words, sentence case, rounded to the satang exactly like bahtText() in
// erp-shared-core.js (both texts are printed side by side and must agree):
//   1234.5 → "One thousand two hundred thirty-four baht and fifty satang"
//   1000   → "One thousand baht only"          (bahtText: "…บาทถ้วน")
//   0.5    → "Fifty satang"                    (bahtText: "ศูนย์บาทห้าสิบสตางค์")
//   0      → "Zero baht only"
// Negative, non-finite or too large amounts throw a RangeError (a document total is never negative).
export function englishBahtText(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') throw new RangeError(`englishBahtText: not an amount: ${value}`);
  const amount = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim());
  if (!Number.isFinite(amount)) throw new RangeError(`englishBahtText: not a finite amount: ${value}`);
  if (amount < 0 || Object.is(amount, -0)) throw new RangeError(`englishBahtText: negative amounts are not written in words: ${value}`);
  const cents = Math.round(amount * 100);
  const baht = Math.floor(cents / 100);
  const satang = cents - baht * 100;
  if (baht > ENGLISH_BAHT_TEXT_MAX) throw new RangeError(`englishBahtText: amount too large: ${value}`);
  let text;
  if (baht && satang) text = `${englishIntegerText(baht)} baht and ${englishIntegerText(satang)} satang`;
  else if (satang) text = `${englishIntegerText(satang)} satang`;
  else text = `${englishIntegerText(baht)} baht only`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
