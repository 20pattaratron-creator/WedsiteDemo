// Round 8 review fixes (ADR-025) — pure-logic regressions, one test per confirmed finding (`r8fix#<id>`).
// Every test here fails on round8-stageD and passes now (/tmp/claude-0/r8fix-newtests-on-base.log).
// App-boot regressions of the same round are in tests/r8fix-app.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const imp = file => import(pathToFileURL(path.join(ROOT, file)).href);
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('r8fix#A5: bahtText reads a units 1 after ล้าน as เอ็ด (Royal Institute rule) — 1,000,001 → หนึ่งล้านเอ็ดบาทถ้วน', async () => {
  const { bahtText, thaiIntegerText } = await imp('erp-shared-core.js');
  assert.equal(bahtText(1000001), 'หนึ่งล้านเอ็ดบาทถ้วน');
  assert.equal(bahtText(1000011), 'หนึ่งล้านสิบเอ็ดบาทถ้วน');
  assert.equal(bahtText(2000001.11), 'สองล้านเอ็ดบาทสิบเอ็ดสตางค์');
  assert.equal(bahtText(101000001), 'หนึ่งร้อยเอ็ดล้านเอ็ดบาทถ้วน');
  assert.equal(bahtText(1000000), 'หนึ่งล้านบาทถ้วน');
  assert.equal(bahtText(11000000), 'สิบเอ็ดล้านบาทถ้วน');
  assert.equal(bahtText(10000001), 'สิบล้านเอ็ดบาทถ้วน');
  assert.equal(bahtText(1000101), 'หนึ่งล้านหนึ่งร้อยเอ็ดบาทถ้วน');
  assert.equal(bahtText(1000001000000), 'หนึ่งล้านเอ็ดล้านบาทถ้วน');
  // unchanged: a lone 1 (baht or satang) is หนึ่ง; 11 / 21 / 101 as before
  assert.equal(bahtText(1), 'หนึ่งบาทถ้วน');
  assert.equal(bahtText(1.01), 'หนึ่งบาทหนึ่งสตางค์');
  assert.equal(bahtText(21.25), 'ยี่สิบเอ็ดบาทยี่สิบห้าสตางค์');
  assert.equal(thaiIntegerText(101), 'หนึ่งร้อยเอ็ด');
  // a stray second argument (e.g. Array#map index) never switches the rule on
  assert.deepEqual([1, 1].map(thaiIntegerText), ['หนึ่ง', 'หนึ่ง']);
});

const WHT_PAYEE = { whtEnabled: true, payeeEntityType: 'company', whtIncomeType: 'service', whtCondition: '1', payeeName: 'บจก. คลาวด์โซลูชั่น ไทย', payeeTaxId: '0105561007075', payeeBranchCode: '00000', payeeAddress: '88 ถนนสีลม' };
const EXPENSE = { date: '2026-09-25', branch: 'ubon', cat: 'อื่น ๆ', desc: 'ค่าบริการติดตั้ง', vendor: 'บจก. คลาวด์โซลูชั่น ไทย' };

test('r8fix#A1: no VAT split (tax invoice not yet received) → WHT base = amount ÷ 1.07 by default (warned), never the VAT-inclusive amount; the 1,000-baht test is on that base; "ไม่มี VAT" uses the amount', async () => {
  const { planExpenseDocumentAction } = await imp('erp-document-finance-core.js');
  const core = await imp('erp-payer-wht-core.js');
  // Reviewer repro (wht-base.mjs): 10,000 + VAT 700 paid, tax invoice "requested" → was base 10,700 / WHT 321.00.
  // r13#MED-1: no silent default any more — a tax-invoice expense of a payee of unknown VAT status must state the basis.
  assert.throws(() => planExpenseDocumentAction({ draft: { ...EXPENSE, ...WHT_PAYEE, amount: 10700, docType: 'tax_invoice', taxStatus: 'requested', docNo: '' } }), /กรุณาเลือกว่ายอดค่าใช้จ่ายนี้รวม VAT แล้วหรือไม่/);
  const requested = planExpenseDocumentAction({ draft: { ...EXPENSE, ...WHT_PAYEE, amount: 10700, docType: 'tax_invoice', taxStatus: 'requested', docNo: '', whtVatBasis: 'included' } });
  const r = requested.record;
  assert.deepEqual([r.amount, r.whtVatBasis, r.whtAgreedBase, r.whtBase, r.whtAmount, r.netPaid], [10700, 'included', 10000, 10000, 300, 10400]);
  assert.ok(requested.warnings.some(text => /10,700\.00 ÷ 1\.07 = 10,000\.00/.test(text) && /ยอดนี้ไม่มี VAT/.test(text)), requested.warnings.join(' | '));
  // Same money once the tax invoice is in hand (extract split) gives the same figures — one answer either way.
  const received = planExpenseDocumentAction({ draft: { ...EXPENSE, ...WHT_PAYEE, amount: 10700, docType: 'tax_invoice', taxStatus: 'received', docNo: 'T-1', vatMode: 'extract', vendorTaxId: '0105561007075', vendorBranchCode: '00000', taxInvoiceDate: '2026-09-25', inputVatClaimable: true } }).record;
  assert.deepEqual([received.whtVatBasis, received.whtBase, received.whtAmount, received.netPaid], ['split', 10000, 300, 10400]);
  // Threshold on the pre-VAT base: 1,050 incl. VAT = 981.31 + 68.69 → below 1,000 → nothing withheld (was 31.50).
  const small = planExpenseDocumentAction({ draft: { ...EXPENSE, ...WHT_PAYEE, amount: 1050, docType: 'receipt', taxStatus: 'requested', docNo: '', whtVatBasis: 'included' } });
  assert.equal(small.record.whtAmount, undefined);
  assert.ok(small.warnings.some(text => /ยอดครั้งนี้ \(ก่อน VAT\) 981\.31 บาท ต่ำกว่า 1,000 บาท/.test(text)), small.warnings.join(' | '));
  // The user states "no VAT" (non-registered payee) → the amount is the base.
  const none = planExpenseDocumentAction({ draft: { ...EXPENSE, ...WHT_PAYEE, amount: 10700, docType: 'receipt', taxStatus: 'not_required', docNo: '', whtVatBasis: 'none' } });
  assert.deepEqual([none.record.whtVatBasis, none.record.whtBase, none.record.whtAmount, none.record.netPaid], ['none', 10700, 321, 10379]);
  assert.ok(!none.warnings.some(text => /÷ 1\.07/.test(text)));
  // A typed base may not exceed the derived pre-VAT amount; an unknown statement is refused.
  assert.match(core.planExpenseWhtFields({ ...WHT_PAYEE, date: '2026-09-25', amount: 10700, whtVatBasis: 'included', whtBaseInput: '10700' }).error, /ไม่เกินยอดก่อน VAT ของค่าใช้จ่ายนี้ \(10000\.00 บาท\)/);
  assert.equal(core.planExpenseWhtFields({ ...WHT_PAYEE, date: '2026-09-25', amount: 10700, whtVatBasis: 'maybe' }).error, core.WHT_TEXT.errVatBasis);
  assert.deepEqual(core.whtPreVatOf({ amount: 1070, whtVatBasis: 'included' }), { ok: true, basis: 'included', gross: 1070, preVat: 1000, derived: true, assumed: '' });
  // r13#MED-1: without a statement, a plain receipt (no tax invoice) has no VAT to take out; a tax-invoice type must be asked.
  assert.deepEqual(core.whtPreVatOf({ amount: 1070 }), { ok: true, basis: 'none', gross: 1070, preVat: 1070, derived: false, assumed: 'document' });
  assert.equal(core.whtPreVatOf({ amount: 1070, docType: 'tax_invoice' }).ok, false);
});

test('r8fix#A2: condition 3 (ออกให้ครั้งเดียว) taxes base + tax once — 10,000 @ 3 % → amount paid 10,300.00, WHT 309.00 (PEAK example); condition 2 gross-up stays exact for every base', async () => {
  const core = await imp('erp-payer-wht-core.js');
  const three = core.calculateWht({ base: 10000, rate: 3, condition: 3, total: 10700 });
  // r13#HIGH-1: the company bears 300 (not 309); the 9 of tax on the borne 300 is deducted → the payee receives 10,691.
  assert.deepEqual([three.amountPaid, three.whtAmount, three.payerBorne, three.netPaid], [10300, 309, 300, 10691]);
  const five = core.calculateWht({ base: 6000, rate: 5, condition: 3, total: 6000 });
  assert.deepEqual([five.amountPaid, five.whtAmount], [6300, 315]);
  // Through the planner, the certificate and ใบแนบ: what is reported is 10,300 / 309 with เงื่อนไข 3.
  const plan = core.planExpenseWhtFields({ ...WHT_PAYEE, whtCondition: 3, date: '2026-09-25', vatMode: 'add', subtotal: 10000, vatAmt: 700, amount: 10700 });
  assert.deepEqual([plan.fields.whtAgreedBase, plan.fields.whtBase, plan.fields.whtAmount, plan.fields.netPaid], [10000, 10300, 309, 10691]);
  const cert = core.buildWhtCertificate({ expense: { id: 1, ...plan.fields, date: '2026-09-25' }, branch: 'ubon', payer: {}, bookNo: '2569', certNo: '0001', id: 'wht-1', at: '2026-09-25T00:00:00.000Z' });
  const row = core.buildWhtFormReport({ period: '2026-09', form: 'PND53', certificates: [cert] }).rows[0];
  assert.deepEqual([row.amountPaid, row.taxWithheld, row.condition, cert.taxText], [10300, 309, 3, 'สามร้อยเก้าบาทถ้วน']);
  // Condition 2 (ออกให้ตลอดไป): amount paid − tax = base and tax = round(amount paid × r) for every satang base.
  for (const rate of [1, 2, 3, 5, 10, 15]) {
    for (let cents = 100000; cents <= 2000000; cents += 997) {
      const base = cents / 100;
      const two = core.calculateWht({ base, rate, condition: 2, total: base });
      assert.equal(Math.round((two.amountPaid - two.whtAmount) * 100), cents, `cond 2 ${base} @ ${rate}%`);
      assert.equal(two.whtAmount, Math.round(two.amountPaid * rate) / 100, `cond 2 tax ${base} @ ${rate}%`);
    }
  }
  assert.deepEqual(core.calculateWht({ base: 9700, rate: 3, condition: 2, total: 9700 }).amountPaid, 10000);
});

test('r8fix#A3 (core): with the debit notes the UI now passes, the refund warning and the over-credit check use invoice + DN − CN', async () => {
  const cn = await imp('erp-credit-note-core.js');
  const invoice = { id: 'I1', no: 'INV1', branch: 'ubon', date: '2026-09-10', customer: 'บจก. ก', vatMode: 'add', subtotal: 6500, vatAmt: 455, total: 6955 };
  const dn = { id: 'D1', no: 'DN1', branch: 'ubon', status: 'issued', lines: [{ invoiceId: 'I1', invoiceNo: 'INV1', invoiceBranch: 'ubon', differenceAmount: 1500, difference: 1500, vatOnDifference: 105, total: 1605 }] };
  const draft = { no: 'CN1', date: '2026-10-03', branch: 'ubon', customer: 'บจก. ก', reasonCode: 'price_overcharge', lines: [{ invoiceId: 'I1', invoiceNo: 'INV1', invoiceBranch: 'ubon', differenceAmount: 1000 }] };
  // Paid in full incl. the DN (8,560): a 1,000 + VAT credit means 1,070.00 back, not 2,675.00.
  const paidAll = { paidByInvoice: () => 8560 };
  assert.match(cn.validateCreditNote(draft, [invoice], [], [], { ...paidAll, debitNotes: [dn] }).warnings.join(' '), /ยอดต้องคืนเงิน\/เครดิตให้ลูกค้า 1,070\.00 บาท/);
  assert.match(cn.validateCreditNote(draft, [invoice], [], [], paidAll).warnings.join(' '), /2,675\.00 บาท/, 'without the debit notes (the old UI call) the figure was wrong');
  const full = cn.validateCreditNote({ ...draft, lines: [{ ...draft.lines[0], differenceAmount: 8000 }] }, [invoice], [], [], { debitNotes: [dn] });
  assert.ok(full.ok, full.errors.join(' '));
  assert.deepEqual([full.calculation.originalValue, full.calculation.total, full.calculation.lines[0].priorDebitedValue], [8000, 8560, 1500]);
  const dnCore = await imp('erp-debit-note-core.js');
  const live = { ...cn.buildCreditNoteRecord(full.calculation ? { ...draft } : draft, full, { id: 'C1' }) };
  assert.match(dnCore.debitNoteVoidCreditRefusal(dn, [invoice], [live], [dn]), /ยกเลิกใบเพิ่มหนี้ DN1 ไม่ได้/);
  assert.equal(dnCore.debitNoteVoidCreditRefusal(dn, [invoice], [{ ...live, voided: true, status: 'voided' }], [dn]), '');
  // A credit note without any debit note is stored exactly as before (no new field).
  const plain = cn.validateCreditNote(draft, [invoice], [], [], {});
  assert.equal('priorDebitedValue' in plain.calculation.lines[0], false);
});

test('r8fix#A4: ภ.พ.30 paper due date is moved past a weekend like ภ.ง.ด. (15 Nov 2026 Sunday → Mon 16, 15 Aug 2026 Saturday → Mon 17) and the filed snapshot keeps the moved date', async () => {
  const core = await imp('erp-tax-reports-core.js');
  const oct = core.pp30DueDates('2026-10');
  assert.deepEqual([oct.paper, oct.paperRolled, oct.efiling, oct.efilingRolled], ['2026-11-16', true, '2026-11-23', false]);
  const jul = core.pp30DueDates('2026-07');
  assert.deepEqual([jul.paper, jul.paperRolled, jul.efiling], ['2026-08-17', true, '2026-08-24']);
  assert.equal(core.pp30DueDates('2026-09').paperRolled, false);
  // After the e-filing extension both channels fall back to the (rolled) 15th: 15 May 2027 Saturday → 17.
  const may = core.pp30DueDates('2027-04');
  assert.deepEqual([may.paper, may.efiling, may.checkLatest], ['2027-05-17', '2027-05-17', true]);
  const sales = core.buildSalesTaxReport({ period: '2026-10', branch: 'ubon', invoices: [], creditNotes: [] });
  const purchases = core.buildPurchaseTaxReport({ period: '2026-10', branch: 'ubon', expenses: [] });
  const snap = core.buildVatReturnSnapshot({ returns: [], id: 'r1', branchKey: 'ubon', branches: ['ubon'], period: '2026-10', filingMode: 'separate', summary: core.buildPp30Summary({ sales, purchases, period: '2026-10' }), channel: 'paper', filedAt: '2026-11-02T00:00:00.000Z', filedBy: 't' });
  assert.equal(snap.dueDate, '2026-11-16');
});
