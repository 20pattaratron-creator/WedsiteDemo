// ADR-023 (round 8, stage C) — pure rules of erp-tax-reports-core.js: รายงานภาษีขาย (AC1.1–1.8), รายงานภาษีซื้อ and the
// expense purchase-tax fields (AC2.1–2.6), ภ.พ.30 lines / carry-forward / due dates (AC3.1–3.5), vatReturns snapshots,
// the output-VAT engine with debit notes, and the hand-worked ภ.พ.30 of the sample data's September 2569.
// The booted page (render, print, Excel, filing, backup, reset, single-branch mode): tests/tax-reports.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const imp = file => import(pathToFileURL(path.join(ROOT, file)).href);
const plain = value => JSON.parse(JSON.stringify(value));

// Invoice / credit note / debit note records in the shape the app stores (amounts from calculateVatSummary).
async function makers() {
  const shared = await imp('erp-shared-core.js');
  let id = 1;
  const invoice = (fields = {}) => {
    const useVat = fields.useVat ?? 1, vat = shared.calculateVatSummary(fields.amount ?? 10000, useVat);
    return { id: id++, no: fields.no || `INV6909${String(id).padStart(2, '0')}`, date: fields.date || '2026-09-10', branch: fields.branch || 'ubon', taxInvoiceForm: fields.taxInvoiceForm || 'full', customer: fields.customer ?? 'บจก. ลูกค้า', customerTaxId: fields.customerTaxId ?? '0105558004044', customerBranchCode: fields.customerBranchCode ?? '00000', customerBranchName: '', subtotal: vat.subtotal, vatAmt: vat.vatAmt, total: vat.total, useVat, vatMode: vat.vatMode, ...(fields.extra || {}) };
  };
  const note = (fields = {}) => ({ id: id++, no: fields.no || 'CN690901', date: fields.date || '2026-09-20', branch: fields.branch || 'ubon', customer: 'บจก. ลูกค้า', customerTaxId: '0105558004044', customerBranch: fields.customerBranch ?? 'สำนักงานใหญ่', vatMode: fields.vatMode || 'add', invoiceNos: fields.invoiceNos || ['INV690901'], lines: (fields.invoiceNos || ['INV690901']).map(no => ({ invoiceNo: no, invoiceBranch: fields.branch || 'ubon' })), subtotal: fields.subtotal ?? 1000, vatAmt: fields.vatAmt ?? 70, total: fields.total ?? 1070, status: fields.voided ? 'voided' : 'issued', voided: !!fields.voided, createdAt: fields.createdAt || `${fields.date || '2026-09-20'}T03:00:00.000Z` });
  return { invoice, note };
}
const sales = (core, period, sources, extra = {}) => core.buildSalesTaxReport({ period, sources, entryDate: () => '', ...extra });

// ================================================================ รายงานภาษีขาย
test('tax#1 AC1.1 / AC1.3 / AC1.4 invoice + credit note (negative, issue month); cancelled invoice 0.00 "ยกเลิก"; cancelled CN omitted', async () => {
  const core = await imp('erp-tax-reports-core.js');
  const { invoice, note } = await makers();
  const a = invoice({ no: 'INV690901', amount: 10000, date: '2026-09-30' });
  const cancelled = invoice({ no: 'INV690902', amount: 5000, extra: { voided: true, status: 'cancelled', voidReason: 'ออกซ้ำ' } });
  const cn = note({ no: 'CN690901', subtotal: 1000, vatAmt: 70, total: 1070 });
  const cnVoid = note({ no: 'CN690902', voided: true });
  const sept = sales(core, '2026-09', [{ branch: 'ubon', invoices: [a, cancelled], creditNotes: [cn, cnVoid] }]);
  const rows = sept.rows.map(r => [r.no, r.value, r.vat, r.note]);
  assert.deepEqual(rows, [['INV690902', 0, 0, 'ยกเลิก – ออกซ้ำ'], ['CN690901', -1000, -70, 'ใบลดหนี้ อ้างอิง INV690901'], ['INV690901', 10000, 700, '']]);
  assert.deepEqual(plain(sept.totals), { value: 9000, vat: 630, total: 9630 }, 'AC1.1 footer 9,000.00 / 630.00');
  assert.ok(!sept.rows.some(r => r.no === 'CN690902'), 'AC1.3 cancelled credit note omitted');
  // AC1.4: the invoice of 30 Sept is in September; its credit note of 2 Oct belongs to October (its own pack).
  const septOnly = sales(core, '2026-09', [{ branch: 'ubon', invoices: [a], creditNotes: [] }]);
  const oct = sales(core, '2026-10', [{ branch: 'ubon', invoices: [], creditNotes: [note({ no: 'CN691001', date: '2026-10-02' })] }]);
  assert.deepEqual([septOnly.totals.vat, oct.totals.vat, oct.rows[0].no], [700, -70, 'CN691001']);
  // A document stored in the wrong month's pack is reported AND flagged (never silently moved).
  const wrongPack = sales(core, '2026-09', [{ branch: 'ubon', invoices: [], creditNotes: [note({ no: 'CN691009', date: '2026-10-02' })] }]);
  assert.match(wrongPack.warnings.outsidePeriod.join(' '), /CN691009/);
});

test('tax#2 AC1.2 abbreviated invoices: one row per day (sum of stored values), or one row per invoice on request', async () => {
  const core = await imp('erp-tax-reports-core.js');
  const { invoice } = await makers();
  const abbr = (no, amount) => invoice({ no, amount, useVat: 0, taxInvoiceForm: 'abbreviated', customer: 'ลูกค้าทั่วไป / เงินสด', customerTaxId: '', customerBranchCode: '', date: '2026-09-05' });
  const list = [abbr('INV690903', 107), abbr('INV690901', 214), abbr('INV690902', 53.5)];
  assert.deepEqual(list.map(i => [i.subtotal, i.vatAmt]), [[100, 7], [200, 14], [50, 3.5]]);
  const cancelledAbbr = { ...abbr('INV690904', 107), voided: true, status: 'cancelled', voidReason: 'ทอนผิด' };
  const daily = sales(core, '2026-09', [{ branch: 'ubon', invoices: [...list, cancelledAbbr] }]);
  assert.equal(daily.rows.length, 1);
  const row = daily.rows[0];
  assert.deepEqual([row.kind, row.date, row.no, row.party, row.taxId, row.branchCode, row.value, row.vat, row.total], ['abbreviated_day', '2026-09-05', 'INV690901 – INV690904', 'ใบกำกับภาษีอย่างย่อ', '', '', 350, 24.5, 374.5]);
  assert.match(row.note, /สรุปใบกำกับภาษีอย่างย่อประจำวัน \(3 ฉบับ\).*ยกเลิกในช่วงเลขที่นี้: INV690904/);
  const table = core.taxReportTable(daily, 'sales');
  assert.equal(table.body[0][1], '05/09/2569', 'printed date in พ.ศ.');
  const each = sales(core, '2026-09', [{ branch: 'ubon', invoices: list }], { abbreviatedMode: 'each' });
  assert.deepEqual(each.rows.map(r => [r.no, r.value, r.vat]), [['INV690901', 200, 14], ['INV690902', 50, 3.5], ['INV690903', 100, 7]]);
  assert.deepEqual(plain(each.totals), plain(daily.totals), 'same footer either way');
});

test('tax#3 AC1.5 no-VAT sales: legacy → absent + warning box (exempt in ภ.พ.30); exempt → info; 0 % → reported with VAT 0', async () => {
  const core = await imp('erp-tax-reports-core.js');
  const finance = await imp('erp-document-finance-core.js');
  const { invoice } = await makers();
  const legacy = invoice({ no: 'INV690901', amount: 3500, useVat: 2 });
  const exempt = invoice({ no: 'INV690902', amount: 1000, useVat: 2, extra: { vatCategory: 'exempt' } });
  const zero = invoice({ no: 'INV690903', amount: 20000, useVat: 2, extra: { vatCategory: 'zero' } });
  const standard = invoice({ no: 'INV690904', amount: 10000 });
  const report = sales(core, '2026-09', [{ branch: 'ubon', invoices: [legacy, exempt, zero, standard] }]);
  assert.deepEqual(report.rows.map(r => [r.no, r.value, r.vat, r.note]), [['INV690903', 20000, 0, 'อัตราร้อยละ 0'], ['INV690904', 10000, 700, '']]);
  assert.deepEqual(report.warnings.legacyNoVat.map(r => r.no), ['INV690901']);
  assert.deepEqual(report.warnings.exemptSales.map(r => r.no), ['INV690902']);
  assert.deepEqual([report.zeroValue, report.exemptValue], [20000, 4500]);
  const pp30 = core.buildPp30Summary({ sales: report, purchases: { totals: { value: 0, vat: 0 } } });
  assert.deepEqual([1, 2, 3, 4, 5].map(l => pp30.lines[l]), [34500, 20000, 4500, 10000, 700]);
  // G4: the invoice save stores the category — 'standard' for VAT, the choice for no VAT ('exempt' by default).
  const plan = (useVat, vatCategory) => finance.planInvoiceDocumentAction({ draft: { ...invoice({ amount: 100, useVat }), items: [{ product: 'x', qty: 1 }], vatCategory } }).record.vatCategory;
  assert.deepEqual([plan(1, 'zero'), plan(0, ''), plan(2, 'zero'), plan(2, ''), plan(2, 'bogus')], ['standard', 'standard', 'zero', 'exempt', 'exempt']);
});

test('tax#4 AC1.6 / AC1.7 / AC1.8 buyer establishment columns, blank buyer TIN warned, official column order in every export', async () => {
  const core = await imp('erp-tax-reports-core.js');
  const { invoice, note } = await makers();
  const branchBuyer = invoice({ no: 'INV690901', customerBranchCode: '00003', customerTaxId: '0107537008786' });
  const noTin = invoice({ no: 'INV690902', customerTaxId: '', customerBranchCode: '' });
  const cn = note({ no: 'CN690901', customerBranch: 'สาขาที่ 00003 (โรงงานขอนแก่น)', invoiceNos: ['INV690901'] });
  const report = sales(core, '2026-09', [{ branch: 'khonkaen', invoices: [branchBuyer, noTin], creditNotes: [cn] }]);
  const table = core.taxReportTable(report, 'sales');
  const byNo = no => table.body.find(row => row[2] === no);
  assert.deepEqual(byNo('INV690901').slice(3, 7), ['บจก. ลูกค้า', '0107537008786', '', '00003'], 'AC1.7 สาขาที่ 00003');
  assert.deepEqual(byNo('CN690901').slice(5, 7), ['', '00003'], 'credit note: establishment read from its printed label');
  assert.deepEqual(byNo('INV690902').slice(4, 7), ['', '', '']);
  assert.deepEqual(report.warnings.missingBuyerTaxId.map(r => r.no), ['INV690902'], 'blank TIN → warning, report still generated');
  assert.equal(report.rows.length, 3);
  const hq = core.taxReportTable(sales(core, '2026-09', [{ branch: 'ubon', invoices: [invoice({ no: 'INV690909' })] }]), 'sales');
  assert.deepEqual(hq.body[0].slice(5, 7), ['✓', ''], 'buyer head office ✓');
  // AC1.8 — §1b order (two-row header: ใบกำกับภาษี and สถานประกอบการ are groups).
  assert.deepEqual(table.header, ['ลำดับที่', 'วัน เดือน ปี', 'เล่มที่/เลขที่', 'ชื่อผู้ซื้อสินค้า/ผู้รับบริการ', 'เลขประจำตัวผู้เสียภาษีอากรของผู้ซื้อสินค้า/ผู้รับบริการ', 'สำนักงานใหญ่', 'สาขาที่', 'มูลค่าสินค้าหรือบริการ', 'จำนวนเงินภาษีมูลค่าเพิ่ม', 'รวม', 'หมายเหตุ']);
  assert.deepEqual(plain(table.groups.map(g => [g.label, g.from, g.span, g.grouped])), [['ลำดับที่', 0, 1, false], ['ใบกำกับภาษี', 1, 2, true], ['ชื่อผู้ซื้อสินค้า/ผู้รับบริการ', 3, 1, false], ['เลขประจำตัวผู้เสียภาษีอากรของผู้ซื้อสินค้า/ผู้รับบริการ', 4, 1, false], ['สถานประกอบการ', 5, 2, true], ['มูลค่าสินค้าหรือบริการ', 7, 1, false], ['จำนวนเงินภาษีมูลค่าเพิ่ม', 8, 1, false], ['รวม', 9, 1, false], ['หมายเหตุ', 10, 1, false]]);
  assert.deepEqual(table.footer.slice(7, 10), [report.totals.value, report.totals.vat, report.totals.total]);
  assert.deepEqual(core.taxReportTable({ rows: [], totals: {} }, 'purchase').header, ['ลำดับที่', 'วัน เดือน ปี', 'เล่มที่/เลขที่', 'ชื่อผู้ขายสินค้า/ผู้ให้บริการ', 'เลขประจำตัวผู้เสียภาษีอากรของผู้ขายสินค้า/ผู้ให้บริการ', 'สำนักงานใหญ่', 'สาขาที่', 'มูลค่าสินค้าหรือบริการ', 'จำนวนเงินภาษีมูลค่าเพิ่ม', 'หมายเหตุ'], '§2b');
  const csv = core.taxCsvText([table.header, ...table.body, ['=cmd()', 'a"b', 'x,y']]);
  assert.ok(csv.startsWith('﻿ลำดับที่,วัน เดือน ปี,เล่มที่/เลขที่,'), 'BOM + header in order');
  assert.match(csv, /'=cmd\(\),"a""b","x,y"$/, 'quoting and formula guard');
  assert.equal(core.taxSafeSheetName('ภาษีขาย 09/2569 [สาขา]: *?'), 'ภาษีขาย 09-2569 -สาขา-- --');
  assert.equal(core.taxSafeSheetName('x'.repeat(40)).length, 31);
  assert.equal(core.taxSafeSheetName('///'), '---');
  assert.equal(core.taxSafeSheetName(''), 'Sheet1');
});

test('tax#5 dedupe printed copies, debit notes (stage D input) positive, late entry flag, combined vs separate (AC3.4)', async () => {
  const core = await imp('erp-tax-reports-core.js');
  const cnCore = await imp('erp-credit-note-core.js');
  const { invoice, note } = await makers();
  const a = invoice({ no: 'INV690901', amount: 10000, date: '2026-09-01' });
  const copy = { ...a, id: 999, documentKind: 'delivery-tax-invoice' };
  const dn = note({ no: 'DN690901', subtotal: 500, vatAmt: 35, total: 535 });
  const report = core.buildSalesTaxReport({ period: '2026-09', sources: [{ branch: 'ubon', invoices: [a, copy], creditNotes: [], debitNotes: [dn] }], entryDate: record => (record.no === 'INV690901' ? '2026-09-07' : '') });
  assert.equal(report.skippedCopies, 1);
  assert.deepEqual(report.rows.map(r => [r.no, r.value, r.vat, r.kind]), [['INV690901', 10000, 700, 'invoice'], ['DN690901', 500, 35, 'debit_note']]);
  assert.match(report.rows[1].note, /^ใบเพิ่มหนี้ อ้างอิง/);
  assert.deepEqual(report.rows[0].flags, ['lateEntry'], 'Tue 1 Sep + 3 working days = Fri 4 Sep < Mon 7 Sep');
  // The one engine: summarizeOutputVat nets DN and CN.
  const engine = cnCore.summarizeOutputVat({ invoices: [a], creditNotes: [note({ subtotal: 1000, vatAmt: 70, total: 1070 })], debitNotes: [dn, { ...dn, voided: true }] });
  assert.deepEqual([engine.netSalesValue, engine.netOutputVat, engine.debitNoteCount, engine.debitVat], [9500, 665, 1, 35]);
  // AC3.4: separate never mixes; combined = the sum.
  const kk = invoice({ no: 'INV690902', amount: 2000, branch: 'khonkaen' });
  const sepUbon = core.buildSalesTaxReport({ period: '2026-09', sources: [{ branch: 'ubon', invoices: [a] }] });
  const sepKk = core.buildSalesTaxReport({ period: '2026-09', sources: [{ branch: 'khonkaen', invoices: [kk] }] });
  const both = core.buildSalesTaxReport({ period: '2026-09', sources: [{ branch: 'ubon', invoices: [a] }, { branch: 'khonkaen', invoices: [kk] }] });
  assert.deepEqual([sepUbon.totals.vat, sepKk.totals.vat, both.totals.vat], [700, 140, 840]);
  assert.deepEqual(both.rows.map(r => r.branch), ['ubon', 'khonkaen']);
  assert.ok(sepUbon.rows.every(r => r.branch === 'ubon'));
  // working days and dates
  assert.deepEqual([core.addTaxWorkingDays('2026-09-04', 3), core.rollTaxWeekend('2026-08-23'), core.taxThaiDate('2026-09-05'), core.taxPeriodLabel('2026-09'), core.taxPeriodLastDay('2027-02')], ['2026-09-09', '2026-08-24', '05/09/2569', 'กันยายน 2569', '2027-02-28']);
  assert.equal(core.taxEntryDateOf({ id: 1000000000005 }), '', 'sample ids are never "late"');
  assert.equal(core.taxEntryDateOf({ createdAt: '2026-09-10T03:00:00.000Z' }), '2026-09-10');
});

// ================================================================ ภาษีซื้อ / expense fields
async function expensePlan(fields = {}) {
  const finance = await imp('erp-document-finance-core.js');
  const draft = { date: '2026-09-10', branch: 'ubon', cat: 'ค่าซื้อสินค้า/วัสดุของบริษัท', desc: 'อุปกรณ์', vendor: 'บจก. ไอทีซัพพลาย อีสาน', amount: 2140, docType: 'tax_invoice', taxStatus: 'received', docNo: 'TI-001', purpose: 'company', attachments: [{ name: 'a.pdf' }],
    vatMode: 'extract', vendorId: 's1', vendorTaxId: '0105558004044', vendorBranchCode: '00000', vendorAddress: 'กรุงเทพฯ', taxInvoiceDate: '2026-09-10', taxInvoiceReceivedDate: '2026-09-11', claimPeriod: '', inputVatClaimable: true, nonClaimableReason: '', ...fields };
  return finance.planExpenseDocumentAction({ draft, duplicateDocument: fields.__duplicate || false });
}
test('tax#6 AC2.1 / AC2.3 / AC2.4 VAT split (amount stays gross), 6-month claim window, duplicate seller TIN + number', async () => {
  const core = await imp('erp-tax-reports-core.js');
  const finance = await imp('erp-document-finance-core.js');
  const { record } = await expensePlan();
  assert.deepEqual([record.amount, record.subtotal, record.vatAmt, record.claimPeriod, record.inputVatClaimable, record.vatCategory, record.taxInvoiceNo], [2140, 2000, 140, '2026-09', true, 'standard', 'TI-001']);
  const add = (await expensePlan({ vatMode: 'add', amount: 3000 })).record;
  assert.deepEqual([add.amount, add.subtotal, add.vatAmt], [3210, 3000, 210], "'add': the typed amount is before VAT, the stored amount is the total");
  const purchase = core.buildPurchaseTaxReport({ period: '2026-09', sources: [{ branch: 'ubon', expenses: [record] }], entryDate: () => '' });
  assert.deepEqual(purchase.rows.map(r => [r.no, r.party, r.taxId, r.branchCode, r.value, r.vat, r.note]), [['TI-001', 'บจก. ไอทีซัพพลาย อีสาน', '0105558004044', '00000', 2000, 140, 'ได้รับ 11/09/2569']]);
  assert.deepEqual(plain(purchase.totals), { value: 2000, vat: 140 }, 'AC2.1');
  // AC2.3: invoice of 10 Feb 2026 — claim in Sept (+7 months) refused, Aug (+6) accepted.
  await assert.rejects(expensePlan({ taxInvoiceDate: '2026-02-10', taxInvoiceReceivedDate: '2026-02-12', claimPeriod: '2026-09' }), /เกินกำหนดใช้สิทธิ 6 เดือน — ใบกำกับภาษีเดือน 02\/2569 ใช้สิทธิ์ได้ถึงเดือน 08\/2569/);
  const late = await expensePlan({ taxInvoiceDate: '2026-02-10', taxInvoiceReceivedDate: '2026-02-12', claimPeriod: '2026-08' });
  assert.equal(late.record.claimPeriod, '2026-08');
  assert.match(late.warnings.join('\n'), /ใช้สิทธิ์ภาษีซื้อเดือน 08\/2569/);
  await assert.rejects(expensePlan({ taxInvoiceReceivedDate: '2026-10-02', claimPeriod: '2026-09' }), /ไม่ก่อนเดือนที่ได้รับ/);
  await assert.rejects(expensePlan({ taxInvoiceReceivedDate: '2026-09-01' }), /ไม่ก่อนวันที่ในใบกำกับภาษี/);
  // AC2.4: duplicate seller TIN + tax-invoice number (any year) → blocked with its own message.
  await assert.rejects(expensePlan({ __duplicate: 'tax_invoice' }), error => error.code === finance.FINANCE_ACTION_ERROR_CODES.CONFLICT && /ใบกำกับภาษีเลขที่ TI-001 ของผู้ขายเลขประจำตัว 0105558004044 ถูกบันทึกแล้ว/.test(error.message));
  assert.equal(core.expenseTaxInvoiceKey('0105-558004-044', ' ti-001 '), '0105558004044|TI-001');
  assert.equal(core.expenseTaxInvoiceKey('', 'TI-001'), '');
  // Required particulars of a claim (§86/4) and the check-digit warning.
  await assert.rejects(expensePlan({ vendorTaxId: '' }), /13 หลัก/);
  await assert.rejects(expensePlan({ vendorTaxId: '12345' }), /13 หลัก/);
  await assert.rejects(expensePlan({ vendorBranchCode: '' }), /สถานประกอบการของผู้ขาย/);
  await assert.rejects(expensePlan({ vendorBranchCode: '12' }), /สถานประกอบการของผู้ขาย/);
  await assert.rejects(expensePlan({ taxStatus: 'requested', docNo: '' }), /ได้รับใบกำกับภาษีแล้ว/);
  await assert.rejects(expensePlan({ vatMode: 'half' }), /วิธีคิด VAT/);
  assert.match((await expensePlan({ vendorTaxId: '0105558004045' })).warnings.join('\n'), /หลักสุดท้ายไม่ตรงกับเลขตรวจสอบ/);
  // A non-tax evidence type never stores half a set of tax fields (the form section is hidden then).
  const receipt = (await expensePlan({ docType: 'receipt', taxStatus: 'not_required', docNo: '' })).record;
  assert.deepEqual(core.EXPENSE_VAT_FIELD_KEYS.filter(key => key in receipt), []);
  assert.equal(receipt.amount, 2140);
});

test('tax#7 AC2.2 / AC2.5 / AC2.6 ภาษีซื้อต้องห้าม (abbreviated, passenger car) and legacy expenses: never in the report', async () => {
  const core = await imp('erp-tax-reports-core.js');
  const abbr = (await expensePlan({ docType: 'abbreviated_tax_invoice', docNo: 'AB-1' })).record;
  assert.deepEqual([abbr.inputVatClaimable, abbr.nonClaimableReason, abbr.vatAmt, abbr.amount, abbr.claimPeriod], [false, 'abbreviated', 140, 2140, '']);
  const fuel = (await expensePlan({ docNo: 'F-1', amount: 1070, inputVatClaimable: false, nonClaimableReason: 'passenger_car', docType: 'receipt_tax_invoice' })).record;
  assert.deepEqual([fuel.vatAmt, fuel.amount, fuel.inputVatClaimable], [70, 1070, false], 'AC2.5: VAT stays in the expense cost (amount = gross)');
  await assert.rejects(expensePlan({ inputVatClaimable: false, nonClaimableReason: '' }), /เหตุผลที่ไม่ขอใช้สิทธิ์/);
  const legacy = { id: 7, date: '2026-09-19', branch: 'ubon', vendor: 'บจก. โฆษณา', desc: 'โฆษณา', amount: 8000, docType: 'tax_invoice', taxStatus: 'requested', docNo: '' };
  const claimed = (await expensePlan()).record;
  const report = core.buildPurchaseTaxReport({ period: '2026-09', sources: [{ branch: 'ubon', expenses: [abbr, fuel, legacy, claimed] }], entryDate: () => '' });
  assert.deepEqual(report.rows.map(r => r.no), ['TI-001']);
  assert.deepEqual(report.forbidden.map(r => [r.no, r.reason, r.vat]), [['AB-1', 'abbreviated', 140], ['F-1', 'passenger_car', 70]]);
  assert.deepEqual(plain(report.forbiddenTotals), { value: 3000, vat: 210 });
  assert.deepEqual(report.incomplete.map(r => r.amount), [8000], 'AC2.6');
  assert.equal(core.expenseVatIncomplete(legacy), true);
  assert.equal(core.expenseVatIncomplete({ docType: 'receipt', taxStatus: 'not_required' }), false, 'a plain receipt is not "incomplete"');
  assert.deepEqual(core.taxReportTable(report, 'forbidden').header, ['ลำดับที่', 'วัน เดือน ปี', 'เล่มที่/เลขที่', 'ชื่อผู้ขายสินค้า/ผู้ให้บริการ', 'เลขประจำตัวผู้เสียภาษีอากรของผู้ขายสินค้า/ผู้ให้บริการ', 'มูลค่าสินค้าหรือบริการ', 'จำนวนเงินภาษีมูลค่าเพิ่ม', 'เหตุผลที่ต้องห้าม']);
  // A claim moved to October is not in September (listed as deferred) and is in October; a received credit note is negative.
  const moved = (await expensePlan({ docNo: 'TI-009', claimPeriod: '2026-10' })).record;
  const cnReceived = { ...claimed, id: 99, docType: 'credit_note_received', taxInvoiceNo: 'SCN-1', docNo: 'SCN-1', subtotal: 100, vatAmt: 7 };
  const sept = core.buildPurchaseTaxReport({ period: '2026-09', sources: [{ branch: 'ubon', expenses: [moved, cnReceived] }] });
  const oct = core.buildPurchaseTaxReport({ period: '2026-10', sources: [{ branch: 'ubon', expenses: [moved] }] });
  assert.deepEqual([sept.deferred.map(r => r.no), oct.rows.map(r => r.no)], [['TI-009'], ['TI-009']]);
  assert.deepEqual(sept.rows.map(r => [r.no, r.value, r.vat]), [['SCN-1', -100, -7]]);
  assert.match(oct.rows[0].note, /ใบกำกับภาษีเดือน 09\/2569/);
});

test('tax#8 supplier establishment (G5) and the company VAT filing mode (G7)', async () => {
  const core = await imp('erp-tax-reports-core.js');
  const profile = await imp('erp-company-profile-core.js');
  assert.deepEqual(plain([core.parseSupplierBranchInput('hq', ''), core.parseSupplierBranchInput('branch', '2'), core.parseSupplierBranchInput('', 'x')]), [{ ok: true, code: '00000' }, { ok: true, code: '00002' }, { ok: true, code: '' }]);
  assert.equal(core.parseSupplierBranchInput('branch', '00000').ok, false);
  assert.equal(core.parseSupplierBranchInput('branch', '12a').ok, false);
  assert.deepEqual([core.supplierEstablishmentOf({ branchCode: '3' }), core.supplierEstablishmentOf({ branchName: 'สำนักงานใหญ่' }), core.supplierEstablishmentOf({})], ['00003', '00000', '']);
  assert.deepEqual([core.establishmentCodeOf('', 'สาขาที่ 00007 (ขอนแก่น)'), core.establishmentCodeOf('00000', ''), core.establishmentCodeOf('', 'ไม่ระบุ')], ['00007', '00000', '']);
  const base = { nameTh: 'บริษัท สยามตัวอย่าง จำกัด', taxId: '0105568123453', addressTh: '99/9 ถนนพระราม 9', branches: { khonkaen: { code: '00001' } } };
  assert.equal('vatFilingMode' in profile.validateCompanyProfile(base).profile, false, 'separate (default) stores no field: older profiles keep their shape');
  assert.equal(profile.validateCompanyProfile({ ...base, vatFilingMode: 'combined' }).profile.vatFilingMode, 'combined');
  assert.ok(profile.validateCompanyProfile({ ...base, vatFilingMode: 'monthly' }).errors.vatFilingMode);
  assert.equal(profile.companyProfileFormValues({ ...base, vatFilingMode: 'combined' }).vatFilingMode, 'combined');
  assert.equal(profile.companyProfileFormValues(null, {}).vatFilingMode, 'separate');
});

// ================================================================ ภ.พ.30
test('tax#9 AC3.1–AC3.3 ภ.พ.30 lines; lines 5 / 7 are the report footers', async () => {
  const core = await imp('erp-tax-reports-core.js');
  const { invoice, note } = await makers();
  const salesReport = core.buildSalesTaxReport({ period: '2026-09', sources: [{ branch: 'ubon', invoices: [invoice({ no: 'INV690901', amount: 10000 })], creditNotes: [note({ subtotal: 1000, vatAmt: 70, total: 1070 })], debitNotes: [note({ no: 'DN690901', subtotal: 500, vatAmt: 35, total: 535 })] }] });
  const claimed = (await expensePlan()).record;
  const purchases = core.buildPurchaseTaxReport({ period: '2026-09', sources: [{ branch: 'ubon', expenses: [claimed] }] });
  const s1 = core.buildPp30Summary({ sales: salesReport, purchases });
  assert.deepEqual(plain(s1.lines), { 1: 9500, 2: 0, 3: 0, 4: 9500, 5: 665, 6: 2000, 7: 140, 8: 525, 9: 0, 10: 0, 11: 525, 12: 0 }, 'AC3.1');
  assert.deepEqual([s1.lines[5], s1.lines[6], s1.lines[7]], [salesReport.totals.vat, purchases.totals.value, purchases.totals.vat], 'single source');
  const bigPurchases = { totals: { value: 12857.14, vat: 900 } };
  assert.equal(core.buildPp30Summary({ sales: salesReport, purchases: bigPurchases }).lines[9], 235, 'AC3.2 L9');
  const s2 = core.buildPp30Summary({ sales: salesReport, purchases: bigPurchases, carryForwardIn: 100 });
  assert.deepEqual([s2.lines[9], s2.lines[10], s2.lines[11], s2.lines[12]], [235, 100, 0, 335], 'AC3.2 with carry 100 → L12 335.00');
  const s3 = core.buildPp30Summary({ sales: salesReport, purchases, carryForwardIn: 1000 });
  assert.deepEqual([s3.lines[8], s3.lines[10], s3.lines[11], s3.lines[12]], [525, 1000, 0, 475], 'AC3.3');
  const s4 = core.buildPp30Summary({ sales: salesReport, purchases, carryForwardIn: 200 });
  assert.deepEqual([s4.lines[11], s4.lines[12]], [325, 0]);
  assert.equal(core.buildPp30Summary({ sales: salesReport, purchases, carryForwardIn: -5 }).lines[10], 0);
});

test('tax#10 AC3.5 due dates (paper 15th, e-filing 23rd, weekend roll, extension config) ', async () => {
  const core = await imp('erp-tax-reports-core.js');
  assert.deepEqual(plain(core.pp30DueDates('2026-09')), { paper: '2026-10-15', efiling: '2026-10-23', efilingRolled: false, efilingExtended: true, checkLatest: false }, 'AC3.5 (23 Oct 2026 is a Friday)');
  assert.deepEqual([core.pp30DueDates('2026-07').efiling, core.pp30DueDates('2026-07').efilingRolled], ['2026-08-24', true], '23 Aug 2026 is a Sunday → Monday');
  assert.equal(core.pp30DueDates('2026-12').efiling, '2027-01-25', '23 Jan 2027 Saturday → Monday 25 (still inside the extension)');
  const after = core.pp30DueDates('2027-01');
  assert.deepEqual([after.paper, after.efiling, after.checkLatest], ['2027-02-15', '2027-02-15', true], 'after 31 Jan 2570 → the 15th + "check the latest announcement"');
  assert.equal(core.TAX_DEADLINES.efilingExtensionUntil, '2027-01-31');
  assert.equal(core.pp30DueDates('bad'), null);
});

test('tax#11 vatReturns: snapshot, amendment numbering (never overwrite), carry-forward, fail-closed store and backup merge', async () => {
  const core = await imp('erp-tax-reports-core.js');
  const summary = lines => ({ lines: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 100, 6: 0, 7: 400, 8: 0, 9: 300, 10: 0, 11: 0, 12: 300, ...lines } });
  const snap = (returns, extra = {}) => core.buildVatReturnSnapshot({ returns, id: `r${returns.length + 1}`, branchKey: 'ubon', branches: ['ubon'], period: '2026-08', filingMode: 'separate', summary: summary(), overpaidAction: 'carry', channel: 'efiling', filedAt: '2026-09-20T03:00:00.000Z', filedBy: 'บัญชี', seller: { name: 'บจก. ตัวอย่าง', taxId: '0105568123453', branchCode: '00000' }, ...extra });
  const first = snap([]);
  assert.deepEqual([first.amendment, first.dueDate, first.overpaidAction, first.lines[12]], [0, '2026-09-23', 'carry', 300]);
  const second = snap([first]);
  assert.equal(second.amendment, 1, 'ยื่นเพิ่มเติมครั้งที่ 1');
  assert.throws(() => snap([], { overpaidAction: '' }), /ขอคืนเป็นเงินสด/, 'line 12 > 0 needs a choice');
  const store = core.normalizeVatReturnsStore({ schemaVersion: 1, returns: [first, second] });
  assert.deepEqual(core.vatReturnsFor(store.returns, 'ubon', '2026-08').map(r => r.amendment), [0, 1]);
  // Carry-forward: September takes August's latest line 12 when it chose "ยกไปเดือนถัดไป"; refund → 0; none filed → manual.
  assert.deepEqual(plain(core.resolveCarryForward(store.returns, 'ubon', '2026-09')).amount, 300);
  assert.equal(core.resolveCarryForward(store.returns, 'ubon', '2026-09').editable, false);
  const refund = snap([], { overpaidAction: 'refund', id: 'rr' });
  assert.deepEqual([core.resolveCarryForward([refund], 'ubon', '2026-09').amount, core.resolveCarryForward([refund], 'ubon', '2026-09').source], [0, 'none']);
  assert.deepEqual([core.resolveCarryForward([], 'ubon', '2026-09').editable, core.resolveCarryForward(store.returns, 'khonkaen', '2026-09').editable], [true, true], 'other establishments never borrow it');
  // Fail-closed: damaged JSON / unknown fields / duplicate slot are refused, never read as empty.
  for (const bad of ['{x', JSON.stringify({ schemaVersion: 2, returns: [] }), JSON.stringify({ schemaVersion: 1, returns: [{ ...first, hack: 1 }] }), JSON.stringify({ schemaVersion: 1, returns: [first, { ...first, id: 'other' }] }), JSON.stringify({ schemaVersion: 1, returns: [{ ...first, lines: { ...first.lines, 11: -1 } }] }), JSON.stringify({ schemaVersion: 1, returns: [{ ...first, branchKey: 'combined' }] })]) {
    assert.throws(() => core.parseVatReturnsStore(bad), /ภ.พ.30/, bad.slice(0, 60));
  }
  assert.deepEqual(plain(core.parseVatReturnsStore(null)), { schemaVersion: 1, returns: [] });
  // Merge: device copy wins for the same id; new rows added; replace = the backup's list.
  const edited = { ...first, filedBy: 'แก้ในไฟล์' };
  const other = snap([], { id: 'k1', branchKey: 'khonkaen', branches: ['khonkaen'] });
  const merged = core.mergeVatReturnsStores({ schemaVersion: 1, returns: [first] }, { schemaVersion: 1, returns: [edited, other] });
  assert.deepEqual(merged.returns.map(r => [r.id, r.filedBy]), [['r1', 'บัญชี'], ['k1', 'บัญชี']]);
  assert.deepEqual(core.mergeVatReturnsStores({ schemaVersion: 1, returns: [first] }, { schemaVersion: 1, returns: [other] }, { replace: true }).returns.map(r => r.id), ['k1']);
  assert.throws(() => core.mergeVatReturnsStores(null, { schemaVersion: 1, returns: [{ ...first, period: '2026-13' }] }), /period/);
  // Text of the snapshot is cleaned (one line, no bidi controls).
  assert.equal(snap([], { filedBy: 'a‮b\nc' }).filedBy, 'a b c');
});

test('tax#12 pure core: no DOM / storage globals; every text of each new module in one TEXT object (i18n-ready)', () => {
  const core = fs.readFileSync(path.join(ROOT, 'erp-tax-reports-core.js'), 'utf8');
  assert.doesNotMatch(core, /\bdocument\b|\blocalStorage\b|FirebaseService|\bwindow\b/);
  for (const file of ['erp-tax-reports.js', 'erp-tax-forms.js']) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.equal((src.match(/^const TAX_[A-Z_]*TEXT = Object\.freeze\(/gm) || []).length, 1, `${file}: one TEXT object`);
    // (escaping of user values is proven with hostile data in tests/tax-reports.test.cjs)
  }
  assert.match(core, /^export const TAX_CORE_TEXT = Object\.freeze\(/m);
});

// ================================================================ sample data (hand-worked)
// September 2569 with today = 4 Oct 2026 (both establishments). Hand-worked from the sample scenario:
// สำนักงานใหญ่ sales — CN2 −3,590.00/−251.30 (returned UPS) · U5 53,900.00/3,773.00 (VAT-inclusive 57,673.00) ·
//   CN1 −1,500.00/−105.00 · U6 13,500.00/945.00 · abbreviated A1–A3 on 30 Sept one line 990+2,290+1,980 = 5,260.00 /
//   69.30+160.30+138.60 = 368.20 · X1 cancelled 0.00 · X2 6,500.00/455.00 → footer 74,070.00 / 5,184.90;
//   U8 3,500.00 no VAT (exempt) → L1 77,570.00, L3 3,500.00, L4 74,070.00, L5 5,184.90.
// สำนักงานใหญ่ purchases claimed in 09 — rent UL-6803 12,000 incl. VAT → 11,214.95/785.05 · ITS 21,400 → 20,000.00/1,400.00
//   · office supplies 3,000 + 7 % → 3,000.00/210.00 → L6 34,214.95, L7 2,395.05 → L8 = L11 = 2,789.85.
//   Not claimed: abbreviated stationery 535 (500/35) + passenger-car fuel 1,070 (1,000/70) = ภาษีซื้อต้องห้าม 1,500.00/105.00;
//   cloud service 5,350 (5,000/350) moved to 10/2569; online ads 8,000 has no VAT data ("ข้อมูล VAT ไม่ครบ").
// สาขาที่ 00001 — K6 60,580.00/4,240.60 (buyer สาขาที่ 00003) · K8 9,000.00/630.00 · CN4 −3,500.00/−245.00 → 66,080.00 /
//   4,625.60; rent KP-6803 9,000 → 8,411.21/588.79 + internet 3,200 → 2,990.65/209.35 = 11,401.86/798.14 → L11 3,827.46.
function planSources(plan, period, branches) {
  const docs = plan.documents.filter(d => branches.includes(d.branch));
  const inPeriod = d => `${d.year}-${String(d.month + 1).padStart(2, '0')}` === period;
  return {
    sales: branches.map(branch => ({ branch, invoices: docs.filter(d => d.branch === branch && d.collection === 'invoices' && inPeriod(d)).map(d => d.record), creditNotes: docs.filter(d => d.branch === branch && d.collection === 'creditNotes' && inPeriod(d)).map(d => d.record) })),
    purchases: branches.map(branch => ({ branch, expenses: docs.filter(d => d.branch === branch && d.collection === 'expenses').map(d => d.record) }))
  };
}
test('tax#13 sample data: September 2569 ภ.พ.30 lines equal the hand-worked figures (HQ, branch, combined, one-branch mode)', async () => {
  const core = await imp('erp-tax-reports-core.js');
  const seed = await imp('erp-demo-seed-core.js');
  const plan = seed.buildDemoSeedPlan({ today: '2026-10-04' });
  const pp30 = branches => {
    const src = planSources(plan, '2026-09', branches);
    const s = core.buildSalesTaxReport({ period: '2026-09', sources: src.sales, entryDate: () => '' });
    const p = core.buildPurchaseTaxReport({ period: '2026-09', sources: src.purchases, entryDate: () => '' });
    return { s, p, lines: core.buildPp30Summary({ sales: s, purchases: p }).lines };
  };
  const hq = pp30(['ubon']);
  assert.deepEqual(hq.s.rows.map(r => [r.no, r.value, r.vat]), [['CN690902', -3590, -251.3], ['CN690903', -1500, -105], ['INV690901', 53900, 3773], ['INV690904', 13500, 945], ['INV690906 – INV690908', 5260, 368.2], ['INV690909', 0, 0], ['INV690910', 6500, 455]]);
  assert.match(hq.s.rows[5].note, /^ยกเลิก – /);
  assert.deepEqual(plain(hq.lines), { 1: 77570, 2: 0, 3: 3500, 4: 74070, 5: 5184.9, 6: 34214.95, 7: 2395.05, 8: 2789.85, 9: 0, 10: 0, 11: 2789.85, 12: 0 });
  assert.deepEqual(hq.p.rows.map(r => r.no), ['UL-6803', 'ITS-6909-0172', 'OP-25690915']);
  assert.deepEqual(hq.p.forbidden.map(r => [r.no, r.reason]), [['AB-1188', 'abbreviated'], ['WP-091677', 'passenger_car']]);
  assert.deepEqual(plain(hq.p.forbiddenTotals), { value: 1500, vat: 105 });
  assert.deepEqual(hq.p.deferred.map(r => [r.no, r.claimPeriod]), [['CS-2026-0925', '2026-10']]);
  assert.deepEqual(hq.p.incomplete.map(r => [r.vendor, r.amount]), [['บจก. โฆษณาออนไลน์ตัวอย่าง', 8000]]);
  const kk = pp30(['khonkaen']);
  assert.deepEqual(plain(kk.lines), { 1: 66080, 2: 0, 3: 0, 4: 66080, 5: 4625.6, 6: 11401.86, 7: 798.14, 8: 3827.46, 9: 0, 10: 0, 11: 3827.46, 12: 0 });
  assert.deepEqual(core.taxReportTable(kk.s, 'sales').body.find(r => r[2] === 'INV690902').slice(5, 7), ['', '00003'], 'buyer branch 00003');
  const both = pp30(['ubon', 'khonkaen']);
  assert.deepEqual([both.lines[1], both.lines[5], both.lines[6], both.lines[7], both.lines[11]], [143650, 9810.5, 45616.81, 3193.19, 6617.31], 'combined = sum of both');
  // October: the moved cloud-service claim.
  const oct = core.buildPurchaseTaxReport({ period: '2026-10', sources: planSources(plan, '2026-10', ['ubon']).purchases });
  assert.deepEqual(oct.rows.map(r => [r.no, r.value, r.vat]), [['CS-2026-0925', 5000, 350]]);
  // One establishment (ADR-022): every document at the head office; the branch's own rent / internet are not there.
  const single = seed.buildDemoSeedPlan({ today: '2026-10-04', branchCount: 1 });
  const src = planSources(single, '2026-09', ['ubon']);
  const s = core.buildSalesTaxReport({ period: '2026-09', sources: src.sales });
  const p = core.buildPurchaseTaxReport({ period: '2026-09', sources: src.purchases });
  assert.deepEqual(plain(core.buildPp30Summary({ sales: s, purchases: p }).lines), { 1: 143650, 2: 0, 3: 3500, 4: 140150, 5: 9810.5, 6: 34214.95, 7: 2395.05, 8: 7415.45, 9: 0, 10: 0, 11: 7415.45, 12: 0 });
  // Sample suppliers: valid TIN check digits, an establishment each; the expenses carry them.
  const suppliers = plan.suppliers;
  assert.equal(suppliers.length, 8);
  assert.ok(suppliers.every(row => core.taxIdCheckDigitOk(row.taxId) && /^\d{5}$/.test(row.branchCode) && row.role === 'supplier' && row.demoSeed === true));
  assert.ok(suppliers.some(row => row.branchCode !== '00000'), 'a supplier branch');
  const vatExpenses = plan.documents.filter(d => d.collection === 'expenses' && d.record.vatMode);
  assert.ok(vatExpenses.every(d => suppliers.some(row => row.id === d.record.vendorId && row.taxId === d.record.vendorTaxId && row.branchCode === d.record.vendorBranchCode)));
  // The cancelled invoice has the cancel action's fields; the period rows include the claim month.
  const x1 = plan.documents.find(d => d.record.no === 'INV690909').record;
  assert.deepEqual([x1.voided, x1.status, x1.voidReasonCode, plan.expected.invoices.X1.outstanding], [true, 'cancelled', 'wrong_details', 0]);
  assert.ok(seed.demoSeedPeriods(plan).some(row => row.scope === 'purchase' && row.date === '2026-10-01' && row.no === 'CS-2026-0925'));
});
