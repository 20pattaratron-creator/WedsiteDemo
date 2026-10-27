// ADR-024 (round 8, stage D) — pure rules of erp-debit-note-core.js (ใบเพิ่มหนี้, มาตรา 86/9): spec §4e AC4.1–AC4.7,
// the chain with credit notes in both directions, numbering kept when voided, the output-VAT engine, export rows and the
// sample-data debit note. The booted app (form from the invoice "⋯", print, list, AR, backup): tests/debit-note.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const imp = file => import(pathToFileURL(path.join(ROOT, file)).href);
const plain = value => JSON.parse(JSON.stringify(value));

async function kit() {
  const dn = await imp('erp-debit-note-core.js');
  const cn = await imp('erp-credit-note-core.js');
  const shared = await imp('erp-shared-core.js');
  let id = 100;
  const invoice = (fields = {}) => {
    const useVat = fields.useVat ?? 1, vat = shared.calculateVatSummary(fields.amount ?? 10000, useVat);
    return { id: fields.id ?? id++, no: fields.no || 'INV690901', date: fields.date || '2026-09-10', branch: fields.branch || 'ubon', _branch: fields.branch || 'ubon', _year: 2026, _month: 8, taxInvoiceForm: fields.taxInvoiceForm || 'full', customer: fields.customer ?? 'บจก. ลูกค้า', customerAddress: '1 ถนนทดสอบ', customerTaxId: '0105558004044', customerBranchCode: '00000', subtotal: vat.subtotal, vatAmt: vat.vatAmt, total: vat.total, useVat, vatMode: vat.vatMode, ...(fields.extra || {}) };
  };
  const draft = (invoices, lines, fields = {}) => ({ no: fields.no || 'DN690901', date: fields.date || '2026-09-20', branch: fields.branch || 'ubon', customer: invoices[0]?.customer, reasonCode: fields.reasonCode || 'service_price_undercharged', reasonText: fields.reasonText || '', lines: lines.map(([inv, value, key = 'correctAmount']) => ({ invoiceId: inv.id, invoiceNo: inv.no, invoiceBranch: inv.branch, [key]: value })) });
  const issue = (d, invoices, existing = [], creditNotes = [], fields = {}) => {
    const validation = dn.validateDebitNote(d, invoices, existing, creditNotes);
    assert.ok(validation.ok, validation.errors.join(' / '));
    return { ...dn.buildDebitNoteRecord(d, validation, { id: fields.id ?? id++, at: '2026-09-20T03:00:00.000Z', createdBy: 'test' }), _branch: d.branch };
  };
  return { dn, cn, shared, invoice, draft, issue };
}

test('dn#1 AC4.1 add-VAT invoice 10,000 / 700, correct value 10,500 → difference 500.00, VAT 35.00, total 535.00; September output VAT +35.00', async () => {
  const { dn, invoice, draft, issue } = await kit();
  const tax = await imp('erp-tax-reports-core.js');
  const inv = invoice({ amount: 10000 });
  const record = issue(draft([inv], [[inv, 10500]]), [inv]);
  assert.deepEqual([record.documentKind, record.vatMode, record.originalValue, record.correctValue, record.subtotal, record.vatAmt, record.total], ['debit-note', 'add', 10000, 10500, 500, 35, 535]);
  assert.deepEqual([record.lines[0].originalValue, record.lines[0].correctValue, record.lines[0].difference, record.lines[0].vatOnDifference, record.lines[0].total], [10000, 10500, 500, 35, 535]);
  // The same note typed as "increase by" instead of "correct value".
  const byIncrease = issue(draft([inv], [[inv, 500, 'increaseAmount']], { no: 'DN690902' }), [inv]);
  assert.deepEqual([byIncrease.subtotal, byIncrease.vatAmt, byIncrease.total], [500, 35, 535]);
  // Output VAT of September: +35.00 in the issue month (stage C engine), a positive row in รายงานภาษีขาย.
  const cnCore = await imp('erp-credit-note-core.js');
  const before = cnCore.summarizeOutputVat({ invoices: [inv], creditNotes: [], debitNotes: [] });
  const after = cnCore.summarizeOutputVat({ invoices: [inv], creditNotes: [], debitNotes: [record] });
  assert.deepEqual([before.netOutputVat, after.netOutputVat, after.debitVat, after.netSalesValue], [700, 735, 35, 10500]);
  const report = tax.buildSalesTaxReport({ period: '2026-09', sources: [{ branch: 'ubon', invoices: [inv], creditNotes: [], debitNotes: [record] }], entryDate: () => '' });
  const row = report.rows.find(r => r.no === 'DN690901');
  assert.deepEqual([row.kind, row.value, row.vat, row.note], ['debit_note', 500, 35, 'ใบเพิ่มหนี้ อ้างอิง INV690901']);
  assert.deepEqual(plain(report.totals), { value: 10500, vat: 735, total: 11235 });
  assert.equal(dn.isDebitNoteLive(record), true);
});

test('dn#2 AC4.2 VAT-inclusive invoice 10,700, correct 11,235 incl. → value 500.00, VAT 35.00; no-VAT invoice adds no VAT', async () => {
  const { invoice, draft, issue } = await kit();
  const inv = invoice({ amount: 10700, useVat: 0 });
  assert.deepEqual([inv.vatMode, inv.subtotal, inv.vatAmt, inv.total], ['extract', 10000, 700, 10700]);
  const record = issue(draft([inv], [[inv, 11235]]), [inv]);
  assert.deepEqual([record.vatMode, record.differenceAmount, record.subtotal, record.vatAmt, record.total], ['extract', 535, 500, 35, 535]);
  const none = invoice({ amount: 3500, useVat: 2, no: 'INV690903' });
  const exempt = issue(draft([none], [[none, 4000]], { no: 'DN690903' }), [none]);
  assert.deepEqual([exempt.vatMode, exempt.subtotal, exempt.vatAmt, exempt.total], ['none', 500, 0, 500]);
});

test('dn#3 AC4.3 a correct value not above the original → the spec wording; missing amount, bad reason, date before the invoice, duplicate number (also voided)', async () => {
  const { dn, invoice, draft } = await kit();
  const inv = invoice({ amount: 10000 });
  for (const value of [10000, 9999.99]) {
    const result = dn.validateDebitNote(draft([inv], [[inv, value]]), [inv], [], []);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(text => text.startsWith('มูลค่าที่ถูกต้องต้องมากกว่ามูลค่าเดิม')), result.errors.join(' / '));
  }
  const missing = dn.validateDebitNote(draft([inv], [[inv, '']]), [inv], [], []);
  assert.match(missing.errors.join(' '), /กรุณาระบุมูลค่าที่ถูกต้อง/);
  const other = dn.validateDebitNote({ ...draft([inv], [[inv, 10500]]), reasonCode: 'other' }, [inv], [], []);
  assert.match(other.errors.join(' '), /กรณีเหตุอื่น/);
  const unknown = dn.validateDebitNote({ ...draft([inv], [[inv, 10500]]), reasonCode: '__proto__' }, [inv], [], []);
  assert.match(unknown.errors.join(' '), /สาเหตุการเพิ่มหนี้ไม่ถูกต้อง/);
  const early = dn.validateDebitNote(draft([inv], [[inv, 10500]], { date: '2026-09-01' }), [inv], [], []);
  assert.match(early.errors.join(' '), /ต้องไม่ก่อนวันที่ใบกำกับภาษี INV690901/);
  const voided = { no: 'DN690901', voided: true, status: 'voided', lines: [] };
  const taken = dn.validateDebitNote(draft([inv], [[inv, 10500]]), [inv], [voided], []);
  assert.match(taken.errors.join(' '), /DN690901 มีอยู่แล้ว \(รวมฉบับที่ยกเลิก\)/);
  assert.deepEqual(dn.DEBIT_NOTE_REASONS.map(r => r.code), ['goods_over_quantity', 'goods_price_undercharged', 'service_over_scope', 'service_price_undercharged', 'other']);
  assert.equal(dn.debitNoteReasonLabel('goods_over_quantity'), 'เพิ่มราคาสินค้าที่ขายเนื่องจากสินค้าเกินกว่าจำนวนที่ตกลงซื้อขายกัน');
  assert.equal(dn.debitNoteReasonLabel('service_price_undercharged'), 'คำนวณราคาค่าบริการผิดพลาดต่ำกว่าที่เป็นจริง');
});

test('dn#4 AC4.4 two customers, an abbreviated or cancelled invoice, two branches, mixed VAT modes → refused', async () => {
  const { dn, invoice, draft } = await kit();
  const a = invoice({ no: 'INV690901' }), b = invoice({ no: 'INV690902', customer: 'บจก. อีกราย' });
  const two = dn.validateDebitNote(draft([a, b], [[a, 10500], [b, 10500]]), [a, b], [], []);
  assert.match(two.errors.join(' '), /ลูกค้ารายเดียวกัน/);
  const abbr = invoice({ no: 'INV690905', taxInvoiceForm: 'abbreviated', useVat: 0, amount: 107, customer: 'ลูกค้าทั่วไป / เงินสด', extra: { customerTaxId: '' } });
  const refused = dn.validateDebitNote(draft([abbr], [[abbr, 200]]), [abbr], [], []);
  assert.match(refused.errors.join(' '), /ใบกำกับภาษีอย่างย่อ/);
  assert.equal(dn.debitNoteInvoiceEligible(abbr).reason, 'abbreviated');
  const cancelled = invoice({ no: 'INV690906', extra: { voided: true, status: 'cancelled' } });
  assert.match(dn.validateDebitNote(draft([cancelled], [[cancelled, 10500]]), [cancelled], [], []).errors.join(' '), /ถูกยกเลิกแล้ว/);
  const kk = invoice({ no: 'INV690907', branch: 'khonkaen' });
  assert.match(dn.validateDebitNote(draft([a, kk], [[a, 10500], [kk, 10500]]), [a, kk], [], []).errors.join(' '), /สาขาเดียวกัน/);
  const inc = invoice({ no: 'INV690908', useVat: 0, amount: 10700 });
  assert.match(dn.validateDebitNote(draft([a, inc], [[a, 10500], [inc, 11235]]), [a, inc], [], []).errors.join(' '), /รูปแบบ VAT ต่างกัน/);
  // One customer, two invoices: VAT once on the document increase, split back to the lines.
  const c = invoice({ no: 'INV690909', amount: 333.33 });
  const ok = dn.validateDebitNote(draft([a, c], [[a, 100.01, 'increaseAmount'], [c, 100.01, 'increaseAmount']]), [a, c], [], []);
  assert.ok(ok.ok, ok.errors.join(' / '));
  assert.deepEqual([ok.calculation.subtotal, ok.calculation.vatAmt, ok.calculation.total], [200.02, 14, 214.02]);
  assert.equal(ok.calculation.lines.reduce((s, l) => s + l.vatOnDifference, 0).toFixed(2), '14.00');
});

test('dn#5 AC4.5 a voided debit note leaves รายงานภาษีขาย / ภ.พ.30, keeps its number, and is never reissued', async () => {
  const { dn, invoice, draft, issue } = await kit();
  const tax = await imp('erp-tax-reports-core.js');
  const inv = invoice({ amount: 10000 });
  const record = issue(draft([inv], [[inv, 10500]]), [inv]);
  const voided = dn.applyDebitNoteVoid(record, { at: '2026-09-21T03:00:00.000Z', by: 'test', reason: 'ออกผิด' });
  assert.deepEqual([voided.no, voided.voided, voided.status, voided.voidReason, voided.total], ['DN690901', true, 'voided', 'ออกผิด', 535]);
  assert.equal(dn.debitNoteStatusLabel(voided), 'ยกเลิกแล้ว');
  const report = tax.buildSalesTaxReport({ period: '2026-09', sources: [{ branch: 'ubon', invoices: [inv], creditNotes: [], debitNotes: [voided] }], entryDate: () => '' });
  assert.ok(!report.rows.some(row => row.no === 'DN690901'));
  const purchases = tax.buildPurchaseTaxReport({ period: '2026-09', sources: [] });
  assert.equal(tax.buildPp30Summary({ sales: report, purchases }).lines[5], 700);
  assert.deepEqual(plain(dn.debitNoteTotals([record, voided])), plain(dn.debitNoteTotals([record])), 'totals count live notes only');
  // The number stays taken.
  assert.equal(dn.validateDebitNote(draft([inv], [[inv, 10600]]), [inv], [voided], []).ok, false);
  // Prior debits count live notes only: the voided one does not raise the original value.
  const next = dn.validateDebitNote(draft([inv], [[inv, 10600]], { no: 'DN690902' }), [inv], [voided], []);
  assert.equal(next.calculation.lines[0].originalValue, 10000);
});

test('dn#6 AC4.7 credit note 1,000 then debit note 300 → original value 9,000.00; a credit note after it may go up to the raised value', async () => {
  const { dn, cn, invoice, draft, issue } = await kit();
  const inv = invoice({ amount: 10000 });
  const cnDraft = { no: 'CN690901', date: '2026-09-15', branch: 'ubon', customer: inv.customer, reasonCode: 'price_overcharge', lines: [{ invoiceId: inv.id, invoiceNo: inv.no, invoiceBranch: 'ubon', differenceAmount: 1000 }] };
  const cnValidation = cn.validateCreditNote(cnDraft, [inv], [], []);
  assert.ok(cnValidation.ok, cnValidation.errors.join(' / '));
  const credit = { ...cn.buildCreditNoteRecord(cnDraft, cnValidation, { id: 900, at: '2026-09-15T03:00:00.000Z' }), _branch: 'ubon' };
  const debit = issue(draft([inv], [[inv, 300, 'increaseAmount']]), [inv], [], [credit]);
  assert.deepEqual([debit.lines[0].originalValue, debit.lines[0].correctValue, debit.subtotal, debit.vatAmt, debit.total], [9000, 9300, 300, 21, 321]);
  assert.deepEqual([debit.lines[0].priorCreditedValue, debit.lines[0].priorDebitedValue], [1000, 0]);
  // A second debit note chains on the first.
  const second = issue(draft([inv], [[inv, 9500]], { no: 'DN690902' }), [inv], [debit], [credit]);
  assert.deepEqual([second.lines[0].originalValue, second.subtotal], [9300, 200]);
  // Credit notes see the debit notes: crediting the whole raised value (9,500) is allowed, one baht more is not.
  const prior = cn.creditNoteNetPrior(inv, [credit], [debit, second]);
  assert.deepEqual([prior.value, prior.total], [500, 535], 'credited 1,000 − debited 500 (net 500 / 535 incl. VAT)');
  const full = { ...cnDraft, no: 'CN690902', date: '2026-09-25', lines: [{ ...cnDraft.lines[0], differenceAmount: 9500 }] };
  assert.ok(cn.validateCreditNote(full, [inv], [credit], [], { debitNotes: [debit, second] }).ok);
  const over = { ...full, lines: [{ ...full.lines[0], differenceAmount: 9501 }] };
  assert.equal(cn.validateCreditNote(over, [inv], [credit], [], { debitNotes: [debit, second] }).ok, false);
  // Without debit notes the credit-note rule is unchanged (byte-identical result).
  assert.deepEqual(plain(cn.creditNoteNetPrior(inv, [credit], [])), plain(cn.creditedByInvoice(inv, [credit])));
});

test('dn#7 ledger, export rows, buyer branch snapshot, record fields of spec §4b', async () => {
  const { dn, invoice, draft, issue } = await kit();
  const inv = invoice({ amount: 10000, extra: { customerBranchCode: '00003', customerBranchName: 'โรงงานขอนแก่น' } });
  assert.deepEqual(plain(dn.debitNoteBuyerBranchOf(inv)), { code: '00003', label: 'สาขาที่ 00003 (โรงงานขอนแก่น)' });
  assert.deepEqual(plain(dn.debitNoteBuyerBranchOf({ customerBranchCode: '' }, { branchCode: '3', branchName: 'โรงงาน' })).code, '00003');
  const record = issue({ ...draft([inv], [[inv, 10500]]), customerBranchCode: '00003', customerBranch: 'สาขาที่ 00003 โรงงานขอนแก่น', note: 'n' }, [inv]);
  for (const key of ['id', 'no', 'date', 'branch', 'documentKind', 'customer', 'customerAddress', 'customerTaxId', 'customerBranchCode', 'customerBranch', 'reasonCode', 'reasonLabel', 'reasonText', 'vatMode', 'lines', 'invoiceNos', 'originalValue', 'correctValue', 'differenceAmount', 'subtotal', 'vatAmt', 'total', 'note', 'status', 'voided', 'createdAt', 'createdBy', 'updatedAt']) assert.ok(key in record, key);
  assert.deepEqual([record.customerBranchCode, record.customerBranch, record.lines[0].invoiceDate], ['00003', 'สาขาที่ 00003 โรงงานขอนแก่น', '2026-09-10']);
  const dup = { ...record, id: 'other' };
  assert.equal(dn.debitNoteLedgerIssues([record, dup]).length, 1);
  assert.match(dn.debitNoteLedgerIssues([record, dup])[0].message, /DN690901 ถูกใช้ซ้ำ 2 ฉบับ/);
  assert.deepEqual(dn.debitNoteLedgerIssues([record]), []);
  const rows = dn.debitNoteExportRows([record], { formatDate: d => d, branchLabel: b => b });
  assert.equal(rows.length, 1, 'one row per referenced invoice');
  assert.equal(rows[0].length, dn.DEBIT_NOTE_TEXT.exportHeader.length, 'row width = the header (DEBIT_NOTE_TEXT.exportHeader)');
  assert.deepEqual(rows[0].slice(0, 15), ['ubon', '2569', 9, 'DN690901', '2026-09-20', 'บจก. ลูกค้า', '0105558004044', 'สาขาที่ 00003 โรงงานขอนแก่น', 'INV690901', '2026-09-10', 10000, 10500, 500, 35, 535]);
  // Backup merge = the credit-note rule (an issued note is immutable, a void is one-way).
  assert.equal(dn.mergeDebitNoteCopies([record], [{ ...record, total: 1 }])[0].total, 535);
  assert.equal(dn.mergeDebitNoteCopies([record], [dn.applyDebitNoteVoid(record, { reason: 'x' })])[0].voided, true);
  assert.deepEqual(dn.debitNotesMissingFrom([record], []).map(r => r.no), ['DN690901']);
});

test('dn#8 sample data: DN690901 on INV690910 (30 Sept), 1,500.00 + 105.00, collected with the invoice; pure core, one TEXT object per module', async () => {
  const seed = await imp('erp-demo-seed-core.js');
  const plan = seed.buildDemoSeedPlan({ today: '2026-10-05' });
  const notes = plan.documents.filter(d => d.collection === 'debitNotes').map(d => d.record);
  assert.deepEqual(notes.map(n => [n.no, n.date, n.branch, n.invoiceNos.join(','), n.reasonCode, n.subtotal, n.vatAmt, n.total, n.customerBranch]), [['DN690901', '2026-09-30', 'ubon', 'INV690910', 'service_price_undercharged', 1500, 105, 1605, 'สำนักงานใหญ่']]);
  assert.deepEqual([plan.expected.invoices.X2.total, plan.expected.invoices.X2.debited, plan.expected.invoices.X2.outstanding], [6955, 1605, 8560]);
  assert.ok(seed.demoSeedPeriods(plan).some(row => row.no === 'DN690901' && row.scope === 'sales' && row.date === '2026-09-30'));
  // Next number continues after a stored DN.
  assert.deepEqual(seed.collectNumberSequences({ debitNotes: [{ no: 'DN690907' }] }), { DN6909: 7 });
  const core = fs.readFileSync(path.join(ROOT, 'erp-debit-note-core.js'), 'utf8');
  const code = core.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /\bdocument\.|\blocalStorage\b|\bwindow\.|Date\.now\(/);
  assert.equal((core.match(/^export const DEBIT_NOTE_TEXT = Object\.freeze\(/gm) || []).length, 1);
  const ui = fs.readFileSync(path.join(ROOT, 'erp-debit-note.js'), 'utf8');
  assert.equal((ui.match(/^const [A-Z_]*TEXT = Object\.freeze\(/gm) || []).length, 1, 'erp-debit-note.js: one TEXT object');
  const doc = fs.readFileSync(path.join(ROOT, 'credit-note-document.js'), 'utf8');
  assert.equal((doc.match(/const DEBIT_NOTE_DOC_TEXT = Object\.freeze\(/g) || []).length, 1);
});
