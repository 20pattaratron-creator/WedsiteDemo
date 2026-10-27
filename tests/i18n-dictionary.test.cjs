// ADR-026 — the English dictionaries (i18n/en-*.js) as data: plain arrays, no conflicting duplicate Thai keys,
// no empty English, every pattern placeholder used in the English text, no Thai left in the English text
// (except a Thai term deliberately shown in parentheses, e.g. "Output VAT (ภาษีขาย)"), no baht sign (English
// shows THB), and the wording the brief fixes for the Thai tax terms.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const imp = file => import(pathToFileURL(path.join(ROOT, file)).href);
const THAI_RE = /[฀-๿]/;
// Same order as erp-i18n.js translator(): entries are merged into one map, patterns are tried in this order.
const DICTIONARIES = [
  ['i18n/en-shell.js', 'SHELL_EN'],
  ['i18n/en-sales.js', 'SALES_EN'],
  ['i18n/en-purchase-stock.js', 'PURCHASE_STOCK_EN'],
  ['i18n/en-tax.js', 'TAX_EN'],
  ['i18n/en-settings-backup.js', 'SETTINGS_BACKUP_EN'],
  ['i18n/en-messages.js', 'MESSAGES_EN']
];
const PATTERN_ORDER = ['MESSAGES_EN', 'TAX_EN', 'SALES_EN', 'PURCHASE_STOCK_EN', 'SETTINGS_BACKUP_EN', 'SHELL_EN'];
// Thai inside parentheses in an English text is a deliberate term shown for the reader ("(ภาษีขาย)", "(ธ.ก.ส.)").
const withoutParenthesisedThai = text => String(text).replace(/\([^()]*\)/g, part => (THAI_RE.test(part) ? '' : part));
// The switch names itself in both languages on purpose ("ภาษา / Language") and names Thai in its own script
// ("ภาษาไทย (Switch to Thai)"), as language pickers do; every other UI key is English.
const BILINGUAL_KEYS = new Set(['switch.group', 'switch.menuToThai']);

async function loadAll() {
  const out = { entries: [], patterns: {}, byFile: {} };
  for (const [file, name] of DICTIONARIES) {
    const mod = await imp(file);
    assert.ok(Array.isArray(mod[name]), `${file} exports ${name}`);
    assert.ok(Array.isArray(mod[`${name}_PATTERNS`]), `${file} exports ${name}_PATTERNS`);
    out.byFile[file] = mod[name];
    out.entries.push(...mod[name].map(pair => ({ file, pair })));
    out.patterns[name] = mod[`${name}_PATTERNS`];
  }
  return out;
}

test('i18n-dict#1 the dictionary files are plain data: no imports, only frozen arrays / objects of strings and numbers', async () => {
  const plainData = (value, where, top = false) => {
    if (typeof value === 'string' || typeof value === 'number') return;
    assert.ok(value && typeof value === 'object', `${where}: not data (${typeof value})`);
    if (top) assert.ok(Object.isFrozen(value), `${where}: not frozen`);
    for (const [key, child] of Object.entries(value)) plainData(child, `${where}.${key}`);
  };
  for (const [file] of DICTIONARIES.concat([['i18n/en-keys.js'], ['i18n/en-tax-help.js'], ['i18n/en-analytics.js']])) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.doesNotMatch(source, /^\s*import\b/m, `${file}: no imports`);
    assert.doesNotMatch(source, /^\s*(?:function|class|let|var)\b|^export (?!const )/m, `${file}: no code`);
    const mod = await imp(file);
    for (const [name, value] of Object.entries(mod)) if (typeof value !== 'string') plainData(value, `${file}:${name}`, true);
  }
});

test('i18n-dict#2 entries: [thai, english], Thai key, English text, no conflicting duplicates across files', async () => {
  const { entries } = await loadAll();
  const { normalizePhrase, localizeEn } = await imp('erp-i18n-core.js');
  const seen = new Map();
  for (const { file, pair } of entries) {
    assert.ok(Array.isArray(pair) && pair.length === 2, `${file}: entry shape ${JSON.stringify(pair)}`);
    const [th, en] = pair;
    assert.equal(typeof th, 'string');
    assert.equal(typeof en, 'string');
    assert.ok(THAI_RE.test(th), `${file}: key without Thai: ${th}`);
    assert.ok(en.trim().length > 0, `${file}: empty English for ${th}`);
    assert.equal(en, en.trim(), `${file}: English with surrounding spaces for ${th}`);
    const key = normalizePhrase(localizeEn(th));
    if (seen.has(key)) assert.equal(en, seen.get(key).en, `conflicting English for "${key}" (${seen.get(key).file} / ${file})`);
    else seen.set(key, { en, file });
  }
  assert.ok(seen.size > 4000, `dictionary size ${seen.size}`);
});

test('i18n-dict#3 English texts: no Thai except a term in parentheses, no baht sign, no doubled spaces', async () => {
  const { entries, patterns } = await loadAll();
  const english = [...entries.map(({ file, pair }) => ({ file, en: pair[1], th: pair[0] }))];
  for (const [name, list] of Object.entries(patterns)) english.push(...list.map(pair => ({ file: name, en: pair[1], th: pair[0] })));
  for (const { file, en, th } of english) {
    assert.ok(!THAI_RE.test(withoutParenthesisedThai(en)), `${file}: Thai in English for "${th}": ${en}`);
    assert.ok(!en.includes('฿'), `${file}: baht sign in English (use THB) for "${th}"`);
    assert.doesNotMatch(en, / {2}/, `${file}: doubled space in "${en}"`);
  }
  const { UI_KEYS } = await imp('i18n/en-keys.js');
  for (const [key, entry] of Object.entries(UI_KEYS)) {
    if (BILINGUAL_KEYS.has(key)) continue;
    assert.ok(!THAI_RE.test(withoutParenthesisedThai(entry.en)), `UI key ${key}: Thai in English: ${entry.en}`);
  }
});

test('i18n-dict#4 patterns: valid, every placeholder appears in the English text, all compile in a strict translator', async () => {
  const { entries, patterns } = await loadAll();
  const core = await imp('erp-i18n-core.js');
  let count = 0;
  for (const name of PATTERN_ORDER) {
    for (const pair of patterns[name]) {
      assert.ok(Array.isArray(pair) && pair.length === 2, `${name}: pattern shape`);
      const [th, en] = pair;
      const thaiNames = core.patternPlaceholders(th).map(p => p.name).sort();
      const englishNames = core.englishPlaceholders(en).sort();
      assert.ok(thaiNames.length > 0, `${name}: pattern without placeholder: ${th}`);
      assert.deepEqual(englishNames, thaiNames, `${name}: placeholders of "${th}" → "${en}"`);
      assert.doesNotThrow(() => core.compilePattern(th, en), `${name}: ${th}`);
      count += 1;
    }
  }
  assert.ok(count > 0);
  // strict: throws on any conflicting entry, empty English or bad pattern, exactly as the screen would skip it.
  const tr = core.createPhraseTranslator({ entries: entries.map(e => e.pair), patterns: PATTERN_ORDER.flatMap(name => patterns[name]), strict: true });
  assert.equal(tr.patternCount(), count);
});

test('i18n-dict#5 the Thai tax terms read as the brief fixes them (Latin form + short explanation)', async () => {
  const { entries, patterns } = await loadAll();
  const core = await imp('erp-i18n-core.js');
  const tr = core.createPhraseTranslator({ entries: entries.map(e => e.pair), patterns: PATTERN_ORDER.flatMap(name => patterns[name]) });
  assert.equal(tr.phrase('สำนักงานใหญ่'), 'Head office');
  assert.equal(tr.phrase('สำนักงานใหญ่ (00000)'), 'Head office (00000)');
  assert.equal(tr.phrase('สาขาที่ 00003'), 'Branch no. 00003');
  assert.equal(tr.phrase('หนังสือรับรอง 50 ทวิ'), '50 Tawi (withholding-tax certificate)');
  assert.equal(tr.phrase('ภ.ง.ด.3 / ภ.ง.ด.53'), 'PND.3 / PND.53');
  assert.equal(tr.phrase('ภ.พ.30'), 'PP.30');
  assert.equal(tr.phrase('ภาษีซื้อต้องห้าม'), 'Non-claimable input VAT');
  assert.equal(tr.phrase('รายงานภาษีขาย'), 'Output VAT report');
  assert.equal(tr.phrase('รายงานภาษีซื้อ'), 'Input VAT report');
  const { UI_KEYS } = await imp('i18n/en-keys.js');
  assert.equal(UI_KEYS['tax.tab.pp30'].en, 'PP.30 (monthly VAT return)');
  assert.equal(UI_KEYS['tax.tab.wht'].en, '50 Tawi (withholding-tax certificates)');
  assert.match(UI_KEYS['tax.tab.pnd3'].en, /^PND\.3 \(/);
  assert.match(UI_KEYS['tax.tab.pnd53'].en, /^PND\.53 \(/);
  // The Thai side of every tab key is the tab text the Thai screen shows (erp-tax-reports.js).
  const source = fs.readFileSync(path.join(ROOT, 'erp-tax-reports.js'), 'utf8');
  for (const id of ['sales', 'purchase', 'forbidden', 'pp30', 'pnd3', 'pnd53', 'wht']) assert.ok(source.includes(`${id}: '${UI_KEYS[`tax.tab.${id}`].th}'`), `tab ${id}`);
});

test('i18n-dict#6 tax help: every concept has a title, a question and English paragraphs; the footer recommends a Thai accountant', async () => {
  const { TAX_HELP_EN, TAX_HELP_FOOTER, TAX_CALENDAR_EN } = await imp('i18n/en-tax-help.js');
  const required = ['vat', 'taxInvoiceForms', 'branchCodes', 'creditNote', 'debitNote', 'pp30', 'nonClaimable', 'claimWindow', 'wht', 'periodLock'];
  assert.deepEqual(Object.keys(TAX_HELP_EN).sort(), [...required].sort());
  for (const [concept, help] of Object.entries(TAX_HELP_EN)) {
    assert.ok(help.title && help.question && help.paragraphs.length >= 2, concept);
    for (const text of [help.title, help.question, ...help.paragraphs]) assert.ok(!THAI_RE.test(withoutParenthesisedThai(text)), `${concept}: Thai outside parentheses: ${text}`);
  }
  assert.match(TAX_HELP_FOOTER, /Thai accountant/);
  const all = JSON.stringify(TAX_HELP_EN);
  for (const fact of ['7%', '86/10', '86/9', '82/5', '82/3', '15th', '23rd', 'PND.3', 'PND.53', '50 Tawi', '00000', 'abbreviated', 'conditions: 1', '6 months']) assert.ok(all.includes(fact), `tax help mentions ${fact}`);
  assert.deepEqual(TAX_CALENDAR_EN.rows.map(r => [r.form, r.paperDay, r.onlineDay]), [['PND.3 / PND.53', 7, 15], ['PP.30', 15, 23]]);
});

// ADR-027: the page "วิเคราะห์และคาดการณ์" renders its own text in the chosen language from ANALYTICS_KEYS
// ({ key: { th, en } }). Every key the page asks for exists; the English is English (THB, no Thai, no baht sign);
// both languages carry the same {placeholders}.
test('i18n-dict#7 analytics keys: complete, English is English, same placeholders, every key used by the page exists', async () => {
  const { ANALYTICS_KEYS } = await imp('i18n/en-analytics.js');
  const names = text => [...String(text).matchAll(/\{([A-Za-z_]\w*)\}/g)].map(m => m[1]).sort();
  for (const [key, entry] of Object.entries(ANALYTICS_KEYS)) {
    assert.deepEqual(Object.keys(entry).sort(), ['en', 'th'], key);
    assert.ok(entry.th.trim() && entry.en.trim(), `${key}: empty text`);
    assert.ok(!THAI_RE.test(withoutParenthesisedThai(entry.en)), `${key}: Thai in English: ${entry.en}`);
    assert.ok(!entry.en.includes('฿'), `${key}: baht sign in English`);
    assert.doesNotMatch(entry.en, / {2}/, `${key}: doubled space`);
    assert.deepEqual(names(entry.en), names(entry.th), `${key}: placeholders differ`);
  }
  const source = fs.readFileSync(path.join(ROOT, 'erp-analytics.js'), 'utf8');
  const used = new Set([...source.matchAll(/\bth?\('([a-zA-Z][\w.]*)'/g)].map(m => m[1]));
  assert.ok(used.size > 100, `found ${used.size} keys`);
  for (const key of used) assert.ok(ANALYTICS_KEYS[key], `missing key ${key}`);
  // Keys built from a list of ids: every id of every list has its key.
  const families = { 'tab.': ['compare', 'abc', 'forecast', 'reorder'], 'dimension.': ['product', 'customer', 'branch', 'category'], 'method.': ['ses', 'holt', 'hw'], 'metric.': ['mape', 'smape'], 'abc.badge.': ['A', 'B', 'C', 'none'], 'abc.class.': ['A', 'B', 'C', 'none'], 'accuracy.label.': ['good', 'fair', 'caution'], 'period.': ['month', 'quarter', 'year'], 'reason.': ['holt-default', 'trend-worse', 'hw-better', 'trend-worse-than-hw', 'holt-better-than-hw', 'trend-worse-hw-not-testable', 'hw-not-testable'] };
  for (const id of ['category', 'product', 'tie', 'single']) assert.ok(ANALYTICS_KEYS[`levels.better.${id}`], `missing key levels.better.${id}`); // round 11
  for (const topic of ['compare', 'abc', 'forecast', 'accuracy', 'interval', 'reorder', 'history']) for (const part of ['title', 'what', 'data', 'limits']) assert.ok(ANALYTICS_KEYS[`help.${topic}.${part}`], `missing help.${topic}.${part}`);
  for (const part of ['what', 'data', 'limits']) assert.ok(ANALYTICS_KEYS[`help.part.${part}`], `missing help.part.${part}`);
  for (const [prefix, ids] of Object.entries(families)) for (const id of ids) assert.ok(ANALYTICS_KEYS[prefix + id], `missing key ${prefix}${id}`);
});

// ADR-028 (round 11): the page "ต้นทุนและกำไรต่องาน" renders its own text from COSTING_KEYS ({ key: { th, en } }), the
// same contract as i18n-dict#7: complete, English is English, the same {placeholders}, every key the page asks for
// exists — the keys built from lists (tabs, movement kinds, methods, categories, errors…) included.
test('i18n-dict#8 costing keys: complete, English is English, same placeholders, every key used by the page exists', async () => {
  const { COSTING_KEYS } = await imp('i18n/en-costing.js');
  const core = await imp('erp-costing-core.js');
  const job = await imp('erp-job-costing-core.js');
  const names = text => [...String(text).matchAll(/\{([A-Za-z_]\w*)\}/g)].map(m => m[1]).sort();
  for (const [key, entry] of Object.entries(COSTING_KEYS)) {
    assert.deepEqual(Object.keys(entry).sort(), ['en', 'th'], key);
    assert.ok(entry.th.trim() && entry.en.trim(), `${key}: empty text`);
    assert.ok(!THAI_RE.test(withoutParenthesisedThai(entry.en)), `${key}: Thai in English: ${entry.en}`);
    assert.ok(!entry.en.includes('฿'), `${key}: baht sign in English`);
    assert.doesNotMatch(entry.en, / {2}/, `${key}: doubled space`);
    assert.deepEqual(names(entry.en), names(entry.th), `${key}: placeholders differ`);
  }
  const source = fs.readFileSync(path.join(ROOT, 'erp-costing.js'), 'utf8');
  const used = new Set([...source.matchAll(/\bt\('([a-zA-Z][\w.]*)'/g)].map(m => m[1]));
  assert.ok(used.size > 150, `found ${used.size} keys`);
  for (const key of used) assert.ok(COSTING_KEYS[key], `missing key ${key}`);
  const families = {
    'tab.': ['jobs', 'profit', 'stock', 'valuation', 'overhead', 'settings'],
    'kind.': ['opening', ...Object.keys(core.MOVEMENT_RANK)],
    'method.': core.COSTING_METHODS,
    'method.error.': ['invalid_method', 'same_method', 'approval_required', 'effective_date_required', 'approval_in_future', 'effective_before_approval', 'effective_before_previous_change', 'period_locked'],
    'cat.': job.COST_CATEGORIES,
    'other.': job.OTHER_COST_CATEGORIES,
    'destination.': job.COMPLETION_DESTINATIONS,
    'dimension.': job.PROFIT_DIMENSIONS,
    'profit.title.': job.PROFIT_DIMENSIONS,
    'period.': ['month', 'quarter', 'year', 'all'],
    'budget.source.': ['manual', 'quote', 'quote_total', 'production'],
    'nrv.source.': ['entered', 'defaultPrice']
  };
  for (const [prefix, ids] of Object.entries(families)) for (const id of ids) assert.ok(COSTING_KEYS[prefix + id], `missing key ${prefix}${id}`);
  // The law text of the method lock names the Revenue Code section (ประมวลรัษฎากร มาตรา 65 ทวิ (6)).
  assert.match(COSTING_KEYS['method.law'].th, /65 ทวิ \(6\)/);
  assert.match(COSTING_KEYS['method.law'].en, /section 65 bis \(6\)/);
});

// ADR-029 (round 12): the page "สมุดบัญชีและปิดเดือน", the chart-of-accounts card (JOURNAL_KEYS) and the PromptPay card
// (PROMPTPAY_KEYS): the same contract as i18n-dict#8 — complete, English is English, the same {placeholders}, every
// key the modules ask for exists, the keys built from lists (entry kinds, descriptions, flags, checks, PEAK fields,
// posting choices, account types, opening-import errors, ID types, banks, documents) included.
test('i18n-dict#9 journal and PromptPay keys: complete, English is English, same placeholders, every key used exists', async () => {
  const { JOURNAL_KEYS, PROMPTPAY_KEYS } = await imp('i18n/en-journal.js');
  const core = await imp('erp-journal-core.js');
  const pp = await imp('erp-promptpay-core.js');
  const names = text => [...String(text).matchAll(/\{([A-Za-z_]\w*)\}/g)].map(m => m[1]).sort();
  for (const keys of [JOURNAL_KEYS, PROMPTPAY_KEYS]) {
    for (const [key, entry] of Object.entries(keys)) {
      assert.deepEqual(Object.keys(entry).sort(), ['en', 'th'], key);
      assert.ok(entry.th.trim() && entry.en.trim(), `${key}: empty text`);
      assert.ok(!THAI_RE.test(withoutParenthesisedThai(entry.en)), `${key}: Thai in English: ${entry.en}`);
      assert.ok(!entry.en.includes('฿'), `${key}: baht sign in English`);
      assert.doesNotMatch(entry.en, / {2}/, `${key}: doubled space`);
      assert.deepEqual(names(entry.en), names(entry.th), `${key}: placeholders differ`);
    }
  }
  for (const [file, keys, min] of [['erp-journal.js', JOURNAL_KEYS, 180], ['erp-promptpay.js', PROMPTPAY_KEYS, 25]]) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const used = new Set([...source.matchAll(/\bt\('([a-zA-Z][\w.-]*)'/g)].map(m => m[1]));
    assert.ok(used.size > min, `${file}: found ${used.size} keys`);
    for (const key of used) assert.ok(keys[key], `${file}: missing key ${key}`);
  }
  const flagCodes = [...fs.readFileSync(path.join(ROOT, 'erp-journal-core.js'), 'utf8').matchAll(/flag\((?:null|entry|reversal|reclass|settle|entry), '([a-z_]+)'/g)].map(m => m[1]);
  assert.ok(flagCodes.length >= 20, `found ${flagCodes.length} flag calls`);
  const journal = {
    'tab.': ['journal', 'ledger', 'trial', 'pack', 'manual', 'opening'],
    'kind.': core.ENTRY_KIND_ORDER,
    'desc.': [...core.ENTRY_KIND_ORDER.filter(kind => kind !== 'opening_ar' && kind !== 'opening_ap'), 'opening_ar', 'opening_ap', 'cogsMonth', 'reversal'],
    'flag.': flagCodes,
    'flagShort.': flagCodes,
    'type.': core.ACCOUNT_TYPES,
    'posting.': Object.keys(core.POSTING_CHOICES),
    'peakField.': core.PEAK_FIELDS,
    'peakDate.': core.PEAK_DATE_FORMATS,
    'chart.error.': ['missing', 'duplicate_code', 'type_conflict'],
    'manual.error.': ['date', 'branch', 'lines', 'line_account', 'line_amount', 'unbalanced', 'zero'],
    'opening.error.': ['empty', 'header', 'as_of', 'type', 'branch', 'product_unknown', 'product_not_stock', 'qty', 'unit_cost', 'unit_cost_differs', 'duplicate', 'name', 'amount', 'doc_date', 'due_date', 'doc_after_as_of', 'csv', 'future', 'notReady'],
    'opening.kind.': ['stock', 'ar', 'ap'],
    'bucket.': ['current', '1_30', '31_60', '61_90', 'over_90', 'undated'],
    'checkLevel.': ['ok', 'fail', 'diff', 'na'],
    'export.': ['xlsx', 'csv'],
    'sheet.': ['cover', 'sales', 'purchase', 'forbidden', 'pnd3', 'pnd53', 'ar', 'ap', 'valuation', 'wip', 'trial', 'journal', 'ledger'],
    'total.': ['sales', 'outputVat', 'inputVat', 'pnd3', 'pnd53', 'cogs', 'ar', 'ap', 'inventory', 'wip']
  };
  for (const id of ['entries', 'trial', 'ledgers', 'inventory', 'wip', 'interBranch', 'chart', 'outputVat', 'inputVat', 'sales', 'pnd3', 'pnd53', 'ar', 'flags']) for (const level of ['ok', 'bad']) assert.ok(JOURNAL_KEYS[`check.${id}.${level}`], `missing check.${id}.${level}`);
  assert.ok(JOURNAL_KEYS['check.inventory.na']);
  for (const [prefix, ids] of Object.entries(journal)) for (const id of ids) assert.ok(JOURNAL_KEYS[prefix + id], `missing key ${prefix}${id}`);
  const promptpay = { 'idType.': pp.PROMPTPAY_ID_TYPES, 'doc.': pp.PROMPTPAY_DOCUMENT_KINDS, 'bank.': pp.PROMPTPAY_SCAN_TEST_BANKS, 'error.': ['id_type', 'mobile_invalid', 'tax_id_length', 'tax_id_check', 'ewallet_invalid', 'amount_invalid', 'biller_invalid', 'ref1_required', 'ref_too_long', 'off'] };
  for (const [prefix, ids] of Object.entries(promptpay)) for (const id of ids) assert.ok(PROMPTPAY_KEYS[prefix + id], `missing key ${prefix}${id}`);
  // The exact label the brief requires on the PEAK file, and the plain-Thai export option.
  assert.equal(JOURNAL_KEYS['peak.mustCheck'].th, 'ต้องตรวจกับเทมเพลตจริงของ PEAK ก่อนใช้');
  assert.equal(JOURNAL_KEYS['pack.cogsOption'].th, 'ส่งเป็นรายการไม่นับสต็อก + ต้นทุนขายเป็นสมุดรายวันสิ้นเดือน');
});
