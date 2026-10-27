// ADR-026 — the pure core of the TH / EN switch (erp-i18n-core.js): the stored setting, t(key), Gregorian dates
// and THB for English, the phrase translator (exact entries, patterns, splits, the user-data rule) and
// englishBahtText() (the English amount in words printed next to the Thai bahtText()).
// The dictionaries themselves: tests/i18n-dictionary.test.cjs. The booted app in English: tests/i18n-*.test.cjs (full suite).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const imp = file => import(pathToFileURL(path.join(ROOT, file)).href);

test('i18n-core#1 englishBahtText: the amounts of the brief, in words', async () => {
  const { englishBahtText } = await imp('erp-i18n-core.js');
  assert.equal(englishBahtText(0), 'Zero baht only');
  assert.equal(englishBahtText(1), 'One baht only');
  assert.equal(englishBahtText(11), 'Eleven baht only');
  assert.equal(englishBahtText(21), 'Twenty-one baht only');
  assert.equal(englishBahtText(100), 'One hundred baht only');
  assert.equal(englishBahtText(1000001), 'One million one baht only');
  assert.equal(englishBahtText(0.5), 'Fifty satang');
  assert.equal(englishBahtText(1234.56), 'One thousand two hundred thirty-four baht and fifty-six satang');
  assert.equal(englishBahtText(99999999.99), 'Ninety-nine million nine hundred ninety-nine thousand nine hundred ninety-nine baht and ninety-nine satang');
});

test('i18n-core#2 englishBahtText: more amounts, rounding to the satang, numeric strings', async () => {
  const { englishBahtText, englishIntegerText, ENGLISH_BAHT_TEXT_MAX } = await imp('erp-i18n-core.js');
  assert.equal(englishBahtText(10), 'Ten baht only');
  assert.equal(englishBahtText(19), 'Nineteen baht only');
  assert.equal(englishBahtText(20), 'Twenty baht only');
  assert.equal(englishBahtText(101), 'One hundred one baht only');
  assert.equal(englishBahtText(110), 'One hundred ten baht only');
  assert.equal(englishBahtText(1000), 'One thousand baht only');
  assert.equal(englishBahtText(1001000), 'One million one thousand baht only');
  assert.equal(englishBahtText(2000000000), 'Two billion baht only');
  assert.equal(englishBahtText(0.01), 'One satang');
  assert.equal(englishBahtText(0.1), 'Ten satang');
  assert.equal(englishBahtText(107), 'One hundred seven baht only');
  assert.equal(englishBahtText(1070.5), 'One thousand seventy baht and fifty satang');
  assert.equal(englishBahtText(0.004), 'Zero baht only', 'below half a satang rounds to zero');
  assert.equal(englishBahtText(0.005), 'One satang', 'half a satang rounds up, as in bahtText()');
  assert.equal(englishBahtText(2.999), 'Three baht only', 'rounding can carry into the baht');
  assert.equal(englishBahtText('1,234.56'), 'One thousand two hundred thirty-four baht and fifty-six satang');
  assert.equal(englishBahtText(' 42 '), 'Forty-two baht only');
  assert.equal(englishIntegerText(999999), 'nine hundred ninety-nine thousand nine hundred ninety-nine');
  assert.equal(englishIntegerText(ENGLISH_BAHT_TEXT_MAX), 'nine hundred ninety-nine trillion nine hundred ninety-nine billion nine hundred ninety-nine million nine hundred ninety-nine thousand nine hundred ninety-nine');
  assert.equal(englishBahtText(ENGLISH_BAHT_TEXT_MAX).endsWith('baht only'), true);
});

test('i18n-core#3 englishBahtText: negative, empty, non-finite and too-large amounts are refused', async () => {
  const { englishBahtText, englishIntegerText, ENGLISH_BAHT_TEXT_MAX } = await imp('erp-i18n-core.js');
  for (const bad of [-1, -0.01, -0, -1234.56, '-5', NaN, Infinity, -Infinity, null, undefined, '', 'abc', true, false, {}, ENGLISH_BAHT_TEXT_MAX + 1, 1e20]) {
    assert.throws(() => englishBahtText(bad), RangeError, `refused: ${String(bad)}`);
  }
  for (const bad of [-1, 1.5, NaN, ENGLISH_BAHT_TEXT_MAX + 1]) assert.throws(() => englishIntegerText(bad), RangeError, `refused: ${bad}`);
});

test('i18n-core#4 englishBahtText agrees with the Thai bahtText(): same baht and satang, "only" exactly when "ถ้วน"', async () => {
  const { englishBahtText } = await imp('erp-i18n-core.js');
  const { bahtText } = await imp('erp-shared-core.js');
  const amounts = [0, 0.01, 0.1, 0.5, 0.99, 1, 1.005, 1.5, 2.675, 10.1, 99.995, 100, 107, 1070, 1234.56, 999999.99, 1000001, 12345678.9, 99999999.99];
  for (let i = 1; i <= 400; i += 1) amounts.push(Math.round(((i * 7919.37) % 250000) * 1000) / 1000);
  for (const amount of amounts) {
    const th = bahtText(amount);
    const en = englishBahtText(amount);
    assert.equal(th.endsWith('ถ้วน'), en.endsWith('baht only'), `${amount}: ${th} / ${en}`);
    const cents = Math.round(amount * 100);
    const satang = cents % 100;
    const baht = Math.floor(cents / 100);
    assert.equal(en.endsWith(' satang'), satang > 0, `${amount}: satang written exactly when there are satang`);
    assert.equal(th.includes('สตางค์'), satang > 0, `${amount}: the Thai text agrees`);
    if (baht === 0) assert.equal(/baht/.test(en), !satang, `${amount}: zero baht is written only when there are no satang`);
    if (baht === 1234 && satang) assert.match(en, /^One thousand two hundred thirty-four baht and /);
  }
});

test('i18n-core#5 the setting: Thai by default, damaged values are Thai, the record round-trips', async () => {
  const c = await imp('erp-i18n-core.js');
  const contracts = await imp('erp-storage-contracts.js');
  assert.equal(contracts.UI_LANGUAGE_KEY, 'comform_ui_language_v1', 'ADR-003 key name');
  assert.deepEqual([...c.UI_LANGUAGES], ['th', 'en']);
  assert.equal(c.DEFAULT_UI_LANGUAGE, 'th');
  for (const raw of [null, undefined, '', '   ', 'xx', '{', '[]', '42', 'null', '{"language":"fr"}', '{"language":5}', JSON.stringify(['en'])]) {
    assert.equal(c.parseUiLanguageSetting(raw), 'th', `fail-safe Thai for ${String(raw)}`);
  }
  assert.equal(c.parseUiLanguageSetting('en'), 'en');
  assert.equal(c.parseUiLanguageSetting('th'), 'th');
  assert.equal(c.parseUiLanguageSetting('"en"'), 'en');
  assert.equal(c.parseUiLanguageSetting({ language: 'EN' }), 'en');
  const stored = c.serializeUiLanguageSetting('en', '2026-10-13T00:00:00.000Z');
  assert.deepEqual(JSON.parse(stored), { schemaVersion: 1, language: 'en', updatedAt: '2026-10-13T00:00:00.000Z' });
  assert.equal(c.parseUiLanguageSetting(stored), 'en');
  assert.equal(c.parseUiLanguageSetting(c.serializeUiLanguageSetting('de')), 'th', 'unknown language is stored as Thai');
});

test('i18n-core#6 t(key): language, parameters, missing keys and missing English', async () => {
  const c = await imp('erp-i18n-core.js');
  const keys = { hello: { th: 'สวัสดี {name}', en: 'Hello {name}' }, onlyTh: { th: 'ไทยเท่านั้น' } };
  assert.equal(c.translateKey(keys, 'th', 'hello', { name: 'A' }), 'สวัสดี A');
  assert.equal(c.translateKey(keys, 'en', 'hello', { name: 'A' }), 'Hello A');
  assert.equal(c.translateKey(keys, 'en', 'hello'), 'Hello {name}', 'a missing parameter stays visible');
  assert.equal(c.translateKey(keys, 'en', 'onlyTh'), 'ไทยเท่านั้น', 'no English: the Thai text');
  assert.equal(c.translateKey(keys, 'en', 'nope'), 'nope', 'unknown key: the key itself');
  assert.equal(c.translateKey(keys, 'en', 'toString'), 'toString', 'no prototype lookups');
  const { UI_KEYS } = await imp('i18n/en-keys.js');
  for (const [key, entry] of Object.entries(UI_KEYS)) {
    assert.ok(entry.th && entry.en, `${key} has both languages`);
    assert.deepEqual(c.englishPlaceholders(entry.en).sort(), c.englishPlaceholders(entry.th).sort(), `${key}: same parameters`);
  }
});

test('i18n-core#7 dates: Buddhist Era → Gregorian DD/MM/YYYY, Thai month names → English, document numbers untouched', async () => {
  const c = await imp('erp-i18n-core.js');
  assert.equal(c.localizeDatesEn('วันที่ 12/10/2569'), 'วันที่ 12/10/2026');
  assert.equal(c.localizeDatesEn('01-09-2569'), '01/09/2026');
  assert.equal(c.localizeDatesEn('ปิดงวดเดือน 09/2569'), 'ปิดงวดเดือน 09/2026');
  assert.equal(c.localizeDatesEn('12 ต.ค. 2569'), '12 Oct 2026');
  assert.equal(c.localizeDatesEn('12 ตุลาคม 2569'), '12 October 2026');
  assert.equal(c.localizeDatesEn('กันยายน 2569'), 'September 2026');
  assert.equal(c.localizeDatesEn('ปี พ.ศ. 2569'), 'ปี 2026');
  assert.equal(c.localizeDatesEn('ก.ย. 69'), 'Sep 2026');
  assert.equal(c.localizeDatesEn('กัน 69'), 'Sep 26');
  assert.equal(c.localizeDatesEn('INV-12-10-2569'), 'INV-12-10-2569', 'part of a document number');
  assert.equal(c.localizeDatesEn('12/10/2026'), '12/10/2026', 'already Gregorian');
  assert.equal(c.localizeDatesEn('1,234.50'), '1,234.50');
  assert.equal(c.beYearToAd(2569), 2026);
  assert.equal(c.beYearToAd(2026), 2026);
  assert.equal(c.taxMonthLabelEn(9, 2569), 'September 2026 (tax month)');
  assert.equal(c.taxMonthLabelEn(9, 2026), 'September 2026 (tax month)');
  assert.equal(c.taxMonthLabelEn(13, 2026), '');
  assert.equal(c.localizeMoneyEn('฿1,234.50'), 'THB 1,234.50');
  assert.equal(c.localizeMoneyEn('ยอด ฿ -5.00'), 'ยอด THB -5.00');
  assert.equal(c.localizeMoneyEn('ราคา (฿)'), 'ราคา (THB)');
});

test('i18n-core#8 translator: exact phrases, patterns with kept values, splits, decorations', async () => {
  const c = await imp('erp-i18n-core.js');
  const tr = c.createPhraseTranslator({
    entries: [['บันทึก', 'Save'], ['ยกเลิก', 'Cancel'], ['ลูกค้า', 'Customer'], ['ยอดรวม', 'Total'], ['ภาษีมูลค่าเพิ่ม', 'VAT']],
    patterns: [['พบ {n:num} รายการ', '{n} items found'], ['ยกเลิก – {r:t}', 'Cancelled – {r}'], ['ปี พ.ศ. {y:be}', 'Year {y}'], ['ลูกค้า {name}', 'Customer {name}']]
  });
  assert.equal(tr.phrase('บันทึก'), 'Save');
  assert.equal(tr.phrase('  บันทึก\n '), '  Save\n ', 'surrounding whitespace kept');
  assert.equal(tr.phrase('พบ 1,234 รายการ'), '1,234 items found');
  assert.equal(tr.phrase('ปี พ.ศ. 2569'), 'Year 2026');
  assert.equal(tr.phrase('ยกเลิก – ยกเลิก'), 'Cancelled – Cancel');
  assert.equal(tr.phrase('ยอดรวม · ภาษีมูลค่าเพิ่ม'), 'Total · VAT');
  assert.equal(tr.phrase('ยอดรวม:'), 'Total:');
  assert.equal(tr.phrase('• ลูกค้า *'), '• Customer *');
  assert.equal(tr.phrase('ยอดรวม ฿1,000.00'), 'Total THB 1,000.00');
  const kept = tr.translate('ลูกค้า บริษัท ก จำกัด');
  assert.equal(kept.text, 'Customer บริษัท ก จำกัด', 'a pattern keeps the name as it is');
  assert.deepEqual(kept.kept, ['บริษัท ก จำกัด']);
  assert.equal(tr.has('บันทึก'), true);
  assert.equal(tr.size(), 5);
  assert.equal(tr.patternCount(), 4);
});

test('i18n-core#9 translator: user data is never translated word by word (all-or-nothing runs)', async () => {
  const c = await imp('erp-i18n-core.js');
  const tr = c.createPhraseTranslator({ entries: [['พิมพ์', 'Print'], ['ยอดรวม', 'Total']], patterns: [] });
  const name = 'เครื่องพิมพ์ (พิมพ์/สแกน)';
  const r = tr.translate(name);
  assert.equal(r.text, name, 'a product name containing a dictionary word stays whole');
  assert.equal(r.translated, false);
  assert.ok(r.residual.length > 0);
  assert.equal(tr.phrase('บริษัท สยามพิมพ์ดี จำกัด'), 'บริษัท สยามพิมพ์ดี จำกัด');
  const composite = tr.translate('ยอดรวม · สมชาย ใจดี');
  assert.equal(composite.text, 'Total · สมชาย ใจดี', 'composite label: the UI part translated, the name kept');
  assert.deepEqual(composite.residual, ['สมชาย ใจดี']);
  assert.equal(tr.phrase('12/10/2569 สมชาย'), '12/10/2026 สมชาย', 'untranslated text still gets Gregorian dates');
});

test('i18n-core#10 translator: bad entries and patterns throw when strict, are skipped (and reported) when not', async () => {
  const c = await imp('erp-i18n-core.js');
  assert.throws(() => c.createPhraseTranslator({ entries: [['ก', 'A'], ['ก', 'B']] }), /conflicting/);
  assert.throws(() => c.createPhraseTranslator({ entries: [['ก', '  ']] }), /empty/);
  assert.throws(() => c.createPhraseTranslator({ patterns: [['ยอด {a}', 'Total']] }), /drops \{a\}/);
  assert.throws(() => c.createPhraseTranslator({ patterns: [['ยอด {a}', 'Total {a} {b}']] }), /unknown \{b\}/);
  assert.throws(() => c.createPhraseTranslator({ patterns: [['{a} — {b}', '{a} — {b}']] }), /no Thai/);
  assert.throws(() => c.createPhraseTranslator({ patterns: [['ยอด {a} {a}', '{a}']] }), /repeats/);
  assert.throws(() => c.createPhraseTranslator({ patterns: [['ยอดรวม', 'Total']] }), /no placeholder/);
  const errors = [];
  const tr = c.createPhraseTranslator({ entries: [['ก', 'A'], ['ก', 'B'], ['ข', 'B']], patterns: [['{a} — {b}', '{a} — {b}']], strict: false, onError: e => errors.push(e.message) });
  assert.equal(errors.length, 2);
  assert.equal(tr.phrase('ข'), 'B', 'the good entries still work');
});
