// ADR-029 (round 12) — erp-promptpay-core.js (EMVCo / Thai QR Payment payload) and erp-qr-core.js (offline QR encoder),
// pure. Known-answer CRC-16/CCITT-FALSE vectors; the published payloads of the php-promptpay-qr README (packagist
// kittinan/php-promptpay-qr) and the Thai QR Payment guide (thai-qr-payment) reproduced field by field; the payloads of
// an independent Python reference (docs/decisions/ADR-029 appendix A, written apart from the JS) matched exactly; amount
// formatting; invalid IDs refused; every QR the encoder draws decodes back (tests/qr-reader-helper.cjs, own ISO tables:
// finder / timing / format / version information, every Reed–Solomon block) to the same payload — also from the SVG.
// Every test here fails on round11-cost (the modules do not exist: /tmp/claude-0/r12-newtests-on-base.log).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { readQr, matrixFromSvg } = require('./qr-reader-helper.cjs');

const ROOT = path.resolve(__dirname, '..');
const imp = file => import(pathToFileURL(path.join(ROOT, file)).href);
const P = () => imp('erp-promptpay-core.js');
const Q = () => imp('erp-qr-core.js');

test('pp#1 CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection, no final XOR): known answers', async () => {
  const p = await P();
  // The catalogue check value of CRC-16/CCITT-FALSE: "123456789" → 0x29B1.
  assert.equal(p.crcHex('123456789'), '29B1');
  assert.equal(p.crc16CcittFalse(''), 0xffff, 'nothing processed = the init value');
  assert.equal(p.crcHex('A'), 'B915');
  // Four hex digits, upper case, zero-padded.
  assert.match(p.crcHex('0002010102116304'), /^[0-9A-F]{4}$/);
});

test('pp#2 the published examples are reproduced exactly (php-promptpay-qr README; Thai QR Payment cross-border guide)', async () => {
  const p = await P();
  // php-promptpay-qr README, example 1: target 0899999999, no amount (its tag order: 00 01 29 58 53 63).
  const ex1 = '00020101021129370016A000000677010111011300668999999995802TH53037646304FE29';
  assert.equal(p.tlvPayload([['00', '01'], ['01', '11'], ['29', p.tlv('00', p.PROMPTPAY_AID) + p.tlv('01', p.normalizeMobile('089-999-9999'))], ['58', 'TH'], ['53', '764']]), ex1);
  // Example 2: 089-999-9999, amount 420 → dynamic (01 = 12), tag 54 "420.00".
  const ex2 = '00020101021229370016A000000677010111011300668999999995802TH53037645406420.006304CF9E';
  assert.equal(p.tlvPayload([['00', '01'], ['01', '12'], ['29', p.tlv('00', p.PROMPTPAY_AID) + p.tlv('01', '0066899999999')], ['58', 'TH'], ['53', '764'], ['54', p.formatAmount(420)]]), ex2);
  for (const payload of [ex1, ex2, '00020101021230550016A0000006770120060115099400016550100021212345678901253037645406100.005802TH63049D1C']) {
    const parsed = p.parsePayload(payload);
    assert.equal(parsed.crcOk, true, payload);
    assert.equal(parsed.fields.map(f => `${f.id}${String(f.value.length).padStart(2, '0')}${f.value}`).join(''), payload, 'TLV parse round trip');
  }
  // Our own builder puts the tags in ascending order (00 01 29 53 54 58 63, as EMVCo lists them); the fields are the
  // published ones — only their order differs — and the CRC is recomputed over our order.
  const ours = p.buildPromptPayPayload({ type: 'mobile', id: '089-999-9999', amount: 420 });
  assert.equal(ours.payload, '00020101021229370016A00000067701011101130066899999999530376454064' + '20.005802TH6304' + p.crcHex('00020101021229370016A0000006770101110113006689999999953037645406420.005802TH6304'));
  const fields = Object.fromEntries(p.parsePayload(ours.payload).fields.map(f => [f.id, f.value]));
  const theirs = Object.fromEntries(p.parsePayload(ex2).fields.map(f => [f.id, f.value]));
  for (const id of ['00', '01', '29', '53', '54', '58']) assert.equal(fields[id], theirs[id], `tag ${id}`);
});

test('pp#3 payloads = the independent Python reference (ADR-029 appendix A), every ID type, static / dynamic, bill payment', async () => {
  const p = await P();
  const cases = [
    [{ type: 'mobile', id: '081-234-5678', amount: 50 }, '00020101021229370016A000000677010111011300668123456785303764540550.005802TH63045197'],
    [{ type: 'mobile', id: '+66 89 999 9999' }, '00020101021129370016A0000006770101110113006689999999953037645802TH63042195'],
    [{ type: 'tax_id', id: '0105561007075', amount: '1,234.50' }, '00020101021229370016A00000067701011102130105561007075530376454071234.505802TH63040D49'],
    [{ type: 'ewallet', id: '123456789012345', amount: 0.01 }, '00020101021229390016A0000006770101110315123456789012345530376454040.015802TH63045B91']
  ];
  for (const [input, expected] of cases) {
    const out = p.buildPromptPayPayload(input);
    assert.equal(out.ok, true, JSON.stringify(input));
    assert.equal(out.payload, expected, JSON.stringify(input));
    assert.equal(out.dynamic, input.amount !== undefined);
  }
  const bill = p.buildBillPaymentPayload({ billerId: '010556100707501', ref1: 'INV-6909/01', amount: 51284.97 });
  assert.equal(bill.payload, '00020101021230520016A00000067701011201150105561007075010209INV6909015303764540851284.975802TH630408F3');
  assert.deepEqual([bill.ref1, bill.ref2, bill.kind], ['INV690901', '', 'bill_payment']);
});

test('pp#4 amounts: two decimals, no separators; refused when ≤ 0, more than 2 decimals, not a number or too large', async () => {
  const p = await P();
  for (const [value, text] of [[420, '420.00'], ['1,234.5', '1234.50'], [0.1 + 0.2, '0.30'], [1234.56, '1234.56'], ['9999999999.99', '9999999999.99'], [19.999999999999996, '20.00']]) assert.equal(p.formatAmount(value), text, String(value));
  for (const bad of [0, -1, '1.005', 'abc', '', null, undefined, NaN, Infinity, 10000000000, '12.345']) assert.equal(p.amountToSatang(bad), null, String(bad));
  assert.equal(p.buildPromptPayPayload({ type: 'mobile', id: '0812345678', amount: '1.005' }).error, 'amount_invalid');
  assert.throws(() => p.formatAmount(0), /invalid amount/);
});

test('pp#5 invalid IDs are refused with the reason: mobile prefix / length, tax ID length / check digit, e-wallet, unknown type', async () => {
  const p = await P();
  assert.deepEqual(['0812345678', '0912345678', '0612345678', '+66812345678', '66812345678', '0066812345678', '081 234 5678'].map(p.normalizeMobile), Array(7).fill('').map((_, i) => ['0066812345678', '0066912345678', '0066612345678', '0066812345678', '0066812345678', '0066812345678', '0066812345678'][i]));
  for (const bad of ['0212345678', '081234567', '08123456789', '1812345678', 'abc', '', '0712345678']) assert.equal(p.promptPayIdField('mobile', bad).error, 'mobile_invalid', bad);
  assert.equal(p.promptPayIdField('tax_id', '010556100707').error, 'tax_id_length');
  assert.equal(p.promptPayIdField('tax_id', '0105561007076').error, 'tax_id_check', 'one digit off: the check digit fails');
  assert.equal(p.promptPayIdField('tax_id', '0-1055-61007-07-5').value, '0105561007075');
  assert.equal(p.promptPayIdField('ewallet', '12345678901234').error, 'ewallet_invalid');
  assert.equal(p.promptPayIdField('bank', '123').error, 'id_type');
  assert.equal(p.buildBillPaymentPayload({ billerId: '12345', ref1: 'A' }).error, 'biller_invalid');
  assert.equal(p.buildBillPaymentPayload({ billerId: '010556100707501', ref1: '---' }).error, 'ref1_required');
  assert.equal(p.buildBillPaymentPayload({ billerId: '010556100707501', ref1: 'A'.repeat(21) }).error, 'ref_too_long');
});

test('pp#6 settings: default OFF, strict store (fail-closed); a document gets a payload only when enabled for its kind', async () => {
  const p = await P();
  const defaults = p.defaultPromptPaySettings();
  assert.equal(defaults.enabled, false, 'off by default: the prints do not change until the owner turns it on');
  assert.deepEqual(p.normalizePromptPaySettings(null), defaults);
  for (const bad of ['{', '[]', { schemaVersion: 2 }, { ...defaults, hacked: 1 }, { ...defaults, idType: 'bank' }, { ...defaults, documents: { invoice: 'yes', billing: true, receipt: true } }, { ...defaults, scanTests: { kbank: 'x' } }]) {
    assert.throws(() => p.normalizePromptPaySettings(bad), JSON.stringify(bad));
  }
  const on = p.normalizePromptPaySettings({ ...defaults, enabled: true, idType: 'tax_id', promptPayId: '0105561007075', documents: { invoice: true, billing: false, receipt: true } });
  assert.equal(p.payloadForDocument(defaults, 'invoice', { amount: 10 }).error, 'off');
  assert.equal(p.payloadForDocument(on, 'billing', { amount: 10 }).error, 'off');
  assert.equal(p.payloadForDocument(on, 'invoice', { amount: 10 }).payload, p.buildPromptPayPayload({ type: 'tax_id', id: '0105561007075', amount: 10 }).payload);
  assert.deepEqual(p.untestedBanks(on), p.PROMPTPAY_SCAN_TEST_BANKS);
  assert.deepEqual(p.untestedBanks({ scanTests: { kbank: '2026-10-23' } }), p.PROMPTPAY_SCAN_TEST_BANKS.filter(bank => bank !== 'kbank'));
});

test('pp#7 the QR encoder: every symbol it draws reads back (own reader: format, version info, every RS block) — v1–10, L/M/Q/H, all 8 masks', async () => {
  const q = await Q();
  const p = await P();
  // Block tables: every version / level fills its symbol exactly.
  for (const ecl of q.QR_EC_LEVELS) for (let v = 1; v <= 10; v += 1) assert.equal(q.blockSpec(v, ecl).totalCodewords, Math.floor(q.rawDataModules(v) / 8), `${v}${ecl}`);
  const texts = [p.buildPromptPayPayload({ type: 'tax_id', id: '0105561007075', amount: 51284.97 }).payload, p.buildPromptPayPayload({ type: 'mobile', id: '0812345678' }).payload, 'A', 'ทดสอบ ภาษาไทย UTF-8'];
  for (const text of texts) {
    for (const ecl of q.QR_EC_LEVELS) {
      for (let mask = 0; mask < 8; mask += 1) {
        const qr = q.encodeQr(text, { ecl, mask });
        const read = readQr(qr.modules);
        assert.deepEqual([read.text, read.version, read.ecl, read.mask], [text, qr.version, ecl, mask], `${ecl} mask ${mask}`);
      }
    }
  }
  // Long texts force versions 7–10 (version information blocks) — each still reads back.
  for (const length of [130, 160, 190, 213]) { // 213 bytes = the capacity of version 10 level M
    const text = 'X'.repeat(length);
    const qr = q.encodeQr(text, { ecl: 'M' });
    assert.ok(qr.version >= 7, `${length} → v${qr.version}`);
    assert.equal(readQr(qr.modules).text, text);
  }
  // The mask chosen automatically has the lowest penalty of the eight.
  const auto = q.encodeQr(texts[0], { ecl: 'M' });
  const penalties = [0, 1, 2, 3, 4, 5, 6, 7].map(mask => q.encodeQr(texts[0], { ecl: 'M', mask }).penalty);
  assert.equal(auto.penalty, Math.min(...penalties));
  assert.throws(() => q.encodeQr('X'.repeat(400), { ecl: 'H' }), /QR/);
});

test('pp#8 the SVG (what is printed) carries the same matrix with a 4-module quiet zone; the reader gets the payload back from it', async () => {
  const q = await Q();
  const p = await P();
  const payload = p.buildPromptPayPayload({ type: 'tax_id', id: '0105561007075', amount: '12,345.67' }).payload;
  const qr = q.encodeQr(payload, { ecl: 'M' });
  const svg = q.qrSvg(qr, { sizeMm: 24, label: 'PromptPay QR' });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 (\d+) \1" width="24mm" height="24mm"/);
  assert.match(svg, /role="img" aria-label="PromptPay QR"/);
  const { border, matrix } = matrixFromSvg(svg);
  assert.equal(border, 4);
  assert.deepEqual(matrix, qr.modules.map(row => Array.from(row, Boolean)));
  assert.equal(readQr(matrix).text, payload);
  assert.equal(p.parsePayload(readQr(matrix).text).crcOk, true);
  // No external reference, script or style URL: it prints offline.
  assert.doesNotMatch(svg, /href|<script|url\(/);
});
