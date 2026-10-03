// Credit Note (ใบลดหนี้ — Revenue Code §86/10) coverage:
//   * pure core math for every VAT mode incl. RD total-first VAT and rounding
//   * every validation rule, multi-invoice notes and the cumulative limit
//   * reconciliation effects in erp-integrity.js (outstanding, credited, refund due)
//   * finance-core guards, backup/export/import inclusion, reports and stock
//   * one end-to-end jsdom form flow through tests/dom-helper.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { loadEsmLike } = require('./vm-esm-helper.cjs');
const { boot } = require('./dom-helper.cjs');

const ROOT = path.resolve(__dirname, '..');
const imp = file => import(pathToFileURL(path.join(ROOT, file)).href + '?t=' + Date.now() + Math.random());

// ---------------------------------------------------------------- fixtures
const invAdd = (over = {}) => ({ id: 'I1', no: 'INV690901', branch: 'ubon', customer: 'ลูกค้า ก', date: '2026-09-05', subtotal: 1000, vatAmt: 70, total: 1070, useVat: 1, vatMode: 'add', items: [{ product: 'สินค้า A', productCode: 'A1', qty: 10, unit: 'ชิ้น', priceUnit: 100 }], _year: 2026, _month: 8, ...over });
const invExtract = (over = {}) => invAdd({ subtotal: 1000, vatAmt: 70, total: 1070, useVat: 0, vatMode: 'extract', ...over });
const invNone = (over = {}) => invAdd({ subtotal: 500, vatAmt: 0, total: 500, useVat: 2, vatMode: 'none', ...over });
const draft = (over = {}) => ({ no: 'CN690901', date: '2026-09-10', branch: 'ubon', customer: 'ลูกค้า ก', reasonCode: 'price_overcharge', reasonText: '', lines: [{ invoiceId: 'I1', invoiceNo: 'INV690901', invoiceBranch: 'ubon', differenceAmount: 200 }], ...over });
// A stored credit note as the core would build it (used as "previously issued").
async function storedCreditNote(core, invoice, differenceAmount, over = {}) {
  const calc = core.calculateCreditNote({ lines: [{ invoice, differenceAmount }] });
  return { id: over.id || 'CN-OLD', no: over.no || 'CN690900', date: '2026-09-08', branch: invoice.branch, reasonCode: 'price_overcharge', lines: calc.lines, subtotal: calc.subtotal, vatAmt: calc.vatAmt, total: calc.total, status: 'issued', voided: false, ...over };
}

// ============================================================ core math
test('VAT-exclusive (add) invoice: difference, VAT on difference and total', async () => {
  const c = await imp('erp-credit-note-core.js');
  const r = c.calculateCreditNote({ lines: [{ invoice: invAdd(), correctAmount: 800 }] });
  assert.equal(r.vatMode, 'add');
  assert.deepEqual([r.subtotal, r.vatAmt, r.total], [200, 14, 214]);
  const [line] = r.lines;
  assert.equal(line.invoiceNo, 'INV690901');
  assert.deepEqual([line.originalValue, line.correctValue, line.difference, line.vatOnDifference, line.total], [1000, 800, 200, 14, 214]);
  assert.equal(line.differenceAmount, 200);
  assert.equal(line.correctAmount, 800);
});

test('VAT-inclusive (extract) invoice keeps the invoice price basis and extracts VAT from the difference', async () => {
  const c = await imp('erp-credit-note-core.js');
  // Correct gross value 856 → the customer is credited 214 incl. VAT = 200 + 14.
  const r = c.calculateCreditNote({ lines: [{ invoice: invExtract(), correctAmount: 856 }] });
  assert.equal(r.vatMode, 'extract');
  assert.deepEqual([r.differenceAmount, r.subtotal, r.vatAmt, r.total], [214, 200, 14, 214]);
  assert.deepEqual([r.lines[0].originalValue, r.lines[0].correctValue, r.lines[0].difference], [1000, 800, 200]);
  // Rounding edge: 100 gross → 100/1.07 = 93.457… → 93.46, VAT 6.54 (the pair always adds up).
  const edge = c.calculateCreditNote({ lines: [{ invoice: invExtract(), differenceAmount: 100 }] });
  assert.deepEqual([edge.subtotal, edge.vatAmt, edge.total], [93.46, 6.54, 100]);
});

test('non-VAT invoice credits the value only', async () => {
  const c = await imp('erp-credit-note-core.js');
  const r = c.calculateCreditNote({ lines: [{ invoice: invNone(), differenceAmount: 120.5 }] });
  assert.equal(r.vatMode, 'none');
  assert.deepEqual([r.subtotal, r.vatAmt, r.total], [120.5, 0, 120.5]);
  assert.equal(r.lines[0].vatOnDifference, 0);
});

test('VAT is computed once on the document difference (RD total-first) and allocated so rows add up exactly', async () => {
  const c = await imp('erp-credit-note-core.js');
  const three = ['I1', 'I2', 'I3'].map((id, i) => invAdd({ id, no: `INV${i + 1}` }));
  // Per-line VAT would be 3 × round(0.10 × 7%) = 3 × 0.01 = 0.03; document VAT is round(0.30 × 7%) = 0.02.
  const add = c.calculateCreditNote({ lines: three.map(invoice => ({ invoice, differenceAmount: 0.1 })) });
  assert.deepEqual([add.subtotal, add.vatAmt, add.total], [0.3, 0.02, 0.32]);
  assert.equal(Math.round(add.lines.reduce((s, l) => s + l.vatOnDifference, 0) * 100) / 100, 0.02);
  assert.equal(Math.round(add.lines.reduce((s, l) => s + l.total, 0) * 100) / 100, 0.32);
  // RD half-up: 0.50 × 7% = 0.035 → 0.04 (not banker's rounding / float-noise 0.03).
  const half = c.calculateCreditNote({ lines: [{ invoice: invAdd(), differenceAmount: 0.5 }] });
  assert.equal(half.vatAmt, 0.04);
  // Extract: 3 × 10 gross → 30/1.07 = 28.037… → 28.04 value allocated 9.35/9.35/9.34 by largest remainder.
  const ex = c.calculateCreditNote({ lines: three.map(i => ({ invoice: invExtract({ id: i.id, no: i.no }), differenceAmount: 10 })) });
  assert.deepEqual([ex.subtotal, ex.vatAmt, ex.total], [28.04, 1.96, 30]);
  assert.deepEqual(ex.lines.map(l => l.difference), [9.35, 9.35, 9.34]);
  assert.deepEqual(ex.lines.map(l => l.total), [10, 10, 10]);
  assert.deepEqual(ex.lines.map(l => l.vatOnDifference), [0.65, 0.65, 0.66]);
});

test('one credit note may reference several tax invoices of the same customer', async () => {
  const c = await imp('erp-credit-note-core.js');
  const invoices = [invAdd(), invAdd({ id: 'I2', no: 'INV690902', subtotal: 500, vatAmt: 35, total: 535, date: '2026-09-06' })];
  const v = c.validateCreditNote(draft({ lines: [
    { invoiceId: 'I1', invoiceNo: 'INV690901', invoiceBranch: 'ubon', differenceAmount: 100 },
    { invoiceId: 'I2', invoiceNo: 'INV690902', invoiceBranch: 'ubon', correctAmount: 450 }
  ] }), invoices, []);
  assert.equal(v.ok, true, v.errors.join('\n'));
  assert.deepEqual(v.calculation.lines.map(l => [l.invoiceNo, l.originalValue, l.correctValue, l.difference]), [['INV690901', 1000, 900, 100], ['INV690902', 500, 450, 50]]);
  assert.deepEqual([v.calculation.subtotal, v.calculation.vatAmt, v.calculation.total], [150, 10.5, 160.5]);
  const record = c.buildCreditNoteRecord(draft(), v, { id: 99, at: '2026-09-10T00:00:00.000Z' });
  assert.deepEqual(record.invoiceNos, ['INV690901', 'INV690902']);
  assert.equal(record.total, 160.5);
  assert.equal(record.reasonLabel, c.creditNoteReasonLabel('price_overcharge'));
  assert.equal(record.status, 'issued');
});

// ======================================================= validation rules
test('validation: every rule produces a clear Thai message', async () => {
  const c = await imp('erp-credit-note-core.js');
  const invoices = [invAdd(), invAdd({ id: 'I2', no: 'INV690902', customer: 'ลูกค้า ข' }), invAdd({ id: 'I3', no: 'INV690903', branch: 'khonkaen' }), invAdd({ id: 'I4', no: 'INV690904', voided: true }), invExtract({ id: 'I5', no: 'INV690905' })];
  const errorsOf = over => c.validateCreditNote(draft(over), invoices, []).errors.join('\n');
  assert.match(errorsOf({ lines: [] }), /กรุณาเลือกใบกำกับภาษีที่ต้องการลดหนี้อย่างน้อย 1 ใบ/);
  assert.match(errorsOf({ lines: [{ invoiceId: 'NOPE', invoiceNo: 'INV-X', invoiceBranch: 'ubon', differenceAmount: 1 }] }), /ไม่พบใบกำกับภาษีเลขที่ INV-X/);
  assert.match(errorsOf({ lines: [{ invoiceId: 'I1', invoiceBranch: 'ubon', differenceAmount: 1 }, { invoiceId: 'I2', invoiceBranch: 'ubon', differenceAmount: 1 }] }), /ลูกค้ารายเดียวกัน/);
  assert.match(errorsOf({ lines: [{ invoiceId: 'I1', invoiceBranch: 'ubon', differenceAmount: 1 }, { invoiceId: 'I3', invoiceBranch: 'khonkaen', differenceAmount: 1 }] }), /สาขาเดียวกันทั้งหมด/);
  assert.match(errorsOf({ branch: 'khonkaen' }), /สาขาของใบลดหนี้ต้องตรงกับสาขาของใบกำกับภาษี/);
  assert.match(errorsOf({ customer: 'คนอื่น' }), /ชื่อลูกค้าในใบลดหนี้ไม่ตรง/);
  assert.match(errorsOf({ date: '2026-09-04' }), /ต้องไม่ก่อนวันที่ใบกำกับภาษี INV690901 \(2026-09-05\)/);
  assert.equal(c.validateCreditNote(draft({ date: '2026-09-05' }), invoices, []).ok, true, 'same-day credit note is allowed');
  assert.match(errorsOf({ date: '10/09/2026' }), /วันที่ใบลดหนี้ให้ถูกต้อง/);
  assert.match(errorsOf({ lines: [{ invoiceId: 'I1', invoiceBranch: 'ubon', differenceAmount: 0 }] }), /ผลต่างของใบกำกับภาษี INV690901 ต้องมากกว่า 0/);
  assert.match(errorsOf({ lines: [{ invoiceId: 'I1', invoiceBranch: 'ubon', differenceAmount: -5 }] }), /ต้องมากกว่า 0/);
  assert.match(errorsOf({ lines: [{ invoiceId: 'I1', invoiceBranch: 'ubon', correctAmount: 1000 }] }), /ต้องมากกว่า 0/, 'correct value equal to original is no reduction');
  assert.match(errorsOf({ lines: [{ invoiceId: 'I1', invoiceBranch: 'ubon', correctAmount: -1 }] }), /มูลค่าที่ถูกต้องของใบกำกับภาษี INV690901 ต้องไม่ติดลบ/);
  assert.match(errorsOf({ lines: [{ invoiceId: 'I1', invoiceBranch: 'ubon', differenceAmount: 1000.01 }] }), /ต้องไม่ติดลบ \(ยอดที่ลด 1,000.01 บาท เกินมูลค่าใบกำกับภาษี 1,000.00 บาท\)/);
  assert.match(errorsOf({ lines: [{ invoiceId: 'I1', invoiceBranch: 'ubon', differenceAmount: '' }] }), /กรุณาระบุมูลค่าที่ถูกต้อง หรือยอดที่ลดลง/);
  assert.match(errorsOf({ lines: [{ invoiceId: 'I4', invoiceNo: 'INV690904', invoiceBranch: 'ubon', differenceAmount: 1 }] }), /INV690904 ถูกยกเลิกแล้ว/);
  assert.match(errorsOf({ lines: [{ invoiceId: 'I1', invoiceBranch: 'ubon', differenceAmount: 1 }, { invoiceId: 'I1', invoiceBranch: 'ubon', differenceAmount: 1 }] }), /ซ้ำในใบลดหนี้เดียวกัน/);
  assert.match(errorsOf({ lines: [{ invoiceId: 'I1', invoiceBranch: 'ubon', differenceAmount: 1 }, { invoiceId: 'I5', invoiceBranch: 'ubon', differenceAmount: 1 }] }), /รูปแบบ VAT ต่างกัน/);
  assert.match(errorsOf({ reasonCode: '' }), /กรุณาเลือกสาเหตุการลดหนี้/);
  assert.match(errorsOf({ reasonCode: 'made_up' }), /สาเหตุการลดหนี้ไม่ถูกต้อง/);
  assert.match(errorsOf({ reasonCode: 'other', reasonText: '  ' }), /กรุณาอธิบายสาเหตุการลดหนี้/);
  assert.equal(c.validateCreditNote(draft({ reasonCode: 'other', reasonText: 'ส่วนลดพิเศษหลังขาย' }), invoices, []).ok, true);
  assert.match(errorsOf({ no: ' ' }), /กรุณาระบุเลขที่ใบลดหนี้/);
});

test('validation: document numbers are never reused, including numbers of voided credit notes', async () => {
  const c = await imp('erp-credit-note-core.js');
  const old = await storedCreditNote(c, invAdd(), 10, { no: 'CN690901', voided: true, status: 'voided' });
  assert.match(c.validateCreditNote(draft(), [invAdd()], [old]).errors.join('\n'), /เลขที่ใบลดหนี้ CN690901 มีอยู่แล้ว/);
  // Editing the same document keeps its own number.
  assert.equal(c.validateCreditNote(draft({ id: old.id }), [invAdd()], [{ ...old, voided: false, status: 'issued' }]).ok, true);
});

test('cumulative credits cannot exceed the invoice value; voided notes and the edited note are excluded', async () => {
  const c = await imp('erp-credit-note-core.js');
  const invoice = invAdd();
  const first = await storedCreditNote(c, invoice, 600, { id: 'CN-A', no: 'CN690801' });
  // 600 already credited → 400 left.
  const over = c.validateCreditNote(draft({ lines: [{ invoiceId: 'I1', invoiceBranch: 'ubon', differenceAmount: 450 }] }), [invoice], [first]);
  assert.equal(over.ok, false);
  assert.match(over.errors.join('\n'), /ยอดลดหนี้สะสมของใบกำกับภาษี INV690901 \(1,050.00 บาท\) เกินมูลค่าใบกำกับภาษี \(1,000.00 บาท\) — ออกใบลดหนี้ไปแล้ว 600.00 บาท ลดได้อีกไม่เกิน 400.00 บาท/);
  const exact = c.validateCreditNote(draft({ lines: [{ invoiceId: 'I1', invoiceBranch: 'ubon', differenceAmount: 400 }] }), [invoice], [first]);
  assert.equal(exact.ok, true, exact.errors.join('\n'));
  assert.deepEqual([exact.calculation.lines[0].originalValue, exact.calculation.lines[0].correctValue, exact.calculation.lines[0].priorCreditedValue], [400, 0, 600]);
  // A voided earlier note does not consume the invoice value.
  assert.equal(c.validateCreditNote(draft({ lines: [{ invoiceId: 'I1', invoiceBranch: 'ubon', differenceAmount: 1000 }] }), [invoice], [{ ...first, voided: true }]).ok, true);
  // Editing CN-A itself: its own 600 is excluded, so raising it to 900 is fine; 1,001 is not.
  assert.equal(c.validateCreditNote(draft({ id: 'CN-A', no: 'CN690801', lines: [{ invoiceId: 'I1', invoiceBranch: 'ubon', differenceAmount: 900 }] }), [invoice], [first]).ok, true);
  assert.equal(c.validateCreditNote(draft({ id: 'CN-A', no: 'CN690801', lines: [{ invoiceId: 'I1', invoiceBranch: 'ubon', differenceAmount: 1001 }] }), [invoice], [first]).ok, false);
  // Editing a voided note is refused.
  assert.match(c.validateCreditNote(draft({ id: 'CN-A', no: 'CN690801' }), [invoice], [first], [], { original: { ...first, voided: true } }).errors.join('\n'), /ถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้/);
});

test('credited-by-invoice helper sums only live notes for that invoice and branch', async () => {
  const c = await imp('erp-credit-note-core.js');
  const invoice = invAdd();
  const a = await storedCreditNote(c, invoice, 100, { id: 'A' });
  const b = await storedCreditNote(c, invoice, 50, { id: 'B' });
  const voided = await storedCreditNote(c, invoice, 300, { id: 'V', voided: true });
  const otherBranch = await storedCreditNote(c, { ...invoice, branch: 'khonkaen' }, 70, { id: 'K', branch: 'khonkaen' });
  const got = c.creditedByInvoice(invoice, [a, b, voided, otherBranch]);
  assert.deepEqual([got.amount, got.value, got.vat, got.total, got.count], [150, 150, 10.5, 160.5, 2]);
  assert.equal(c.creditedByInvoice(invoice, [a, b], { excludeCreditNoteId: 'A' }).total, 53.5);
});

test('returned goods: quantity cannot exceed the invoiced quantity across credit notes', async () => {
  const c = await imp('erp-credit-note-core.js');
  const invoice = invAdd();
  const item = qty => ({ invoiceId: 'I1', invoiceNo: 'INV690901', invoiceBranch: 'ubon', productCode: 'A1', product: 'สินค้า A', unit: 'ชิ้น', qty });
  const base = { reasonCode: 'returned_goods', lines: [{ invoiceId: 'I1', invoiceBranch: 'ubon', differenceAmount: 300 }] };
  assert.equal(c.validateCreditNote(draft({ ...base, returnItems: [item(3)] }), [invoice], []).ok, true);
  const prior = { ...(await storedCreditNote(c, invoice, 800, { id: 'R1' })), reasonCode: 'returned_goods', returnItems: [item(8)] };
  assert.match(c.validateCreditNote(draft({ ...base, returnItems: [item(3)] }), [invoice], [prior]).errors.join('\n'), /จำนวนรับคืน สินค้า A รวม 11.00 เกินจำนวนในใบกำกับภาษี INV690901 \(10.00\)/);
  assert.match(c.validateCreditNote(draft({ ...base, returnItems: [item(0)] }), [invoice], []).errors.join('\n'), /ต้องมากกว่า 0/);
  assert.match(c.validateCreditNote(draft({ ...base, returnItems: [{ qty: 1 }] }), [invoice], []).errors.join('\n'), /กรุณาเลือกสินค้าที่รับคืน/);
  assert.match(c.validateCreditNote(draft(base), [invoice], []).warnings.join('\n'), /ไม่ได้ระบุรายการสินค้าที่รับคืน/);
  // Returned items are dropped for other reasons (no stock effect).
  const v = c.validateCreditNote(draft({ returnItems: [item(3)] }), [invoice], []);
  assert.deepEqual(c.buildCreditNoteRecord(draft({ returnItems: [item(3)] }), v).returnItems, []);
  // Stock helper counts only live returned-goods notes.
  const stored = { ...prior, returnItems: [item(8)] };
  assert.equal(c.creditNoteReturnedQty([stored, { ...stored, voided: true }], row => row.productCode === 'A1'), 8);
});

test('refund warning when the customer already paid more than the credited value', async () => {
  const c = await imp('erp-credit-note-core.js');
  const v = c.validateCreditNote(draft(), [invAdd()], [], [], { paidByInvoice: () => 1070 });
  assert.equal(v.ok, true);
  assert.match(v.warnings.join('\n'), /ต้องคืนเงิน\/เครดิตให้ลูกค้า 214.00 บาท/);
  const receipts = [{ id: 'R', branch: 'ubon', invNo: 'INV690901', total: 1070 }];
  assert.match(c.validateCreditNote(draft(), [invAdd()], [], receipts).warnings.join('\n'), /214.00/);
});

test('output VAT summary subtracts credit notes; totals ignore voided notes', async () => {
  const c = await imp('erp-credit-note-core.js');
  const cn = await storedCreditNote(c, invAdd(), 200);
  const s = c.summarizeOutputVat({ invoices: [invAdd(), invExtract({ id: 'I9', total: 107, subtotal: 100, vatAmt: 7 })], creditNotes: [cn, { ...cn, id: 'X', voided: true }] });
  assert.deepEqual([s.salesValue, s.outputVat, s.creditValue, s.creditVat, s.netSalesValue, s.netOutputVat, s.creditNoteCount], [1100, 77, 200, 14, 900, 63, 1]);
  assert.deepEqual(c.creditNoteTotals([cn, { ...cn, status: 'voided' }]), { count: 1, subtotal: 200, vatAmt: 14, total: 214 });
  const rows = c.creditNoteExportRows([cn], { branchLabel: 'HQ', yearLabel: '2569', monthLabel: 'กันยายน' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].length, c.CREDIT_NOTE_EXPORT_HEADER.length);
  assert.deepEqual(rows[0].slice(7, 14), ['INV690901', '2026-09-05', 1000, 800, 200, 14, 214]);
});

// ================================================== reconciliation (vm)
function context() {
  const memory = new Map();
  const c = { console, Date, Intl, Math, Number, String, Map, Set, JSON, queueMicrotask: () => {}, setTimeout: () => 0, clearTimeout() {}, CustomEvent: class {}, addEventListener() {}, dispatchEvent() {}, notify() {}, confirm: () => true,
    localStorage: { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k), key: i => [...memory.keys()][i] ?? null, get length() { return memory.size; } },
    document: { readyState: 'loading', addEventListener() {}, getElementById: () => null, querySelectorAll: () => [], querySelector: () => null, body: { classList: { add() {}, remove() {} } } },
    ComformTenant: { storageKey: k => 'test::' + k, unwrapStorageKey: k => (k.startsWith('test::') ? k.slice(6) : ''), getActiveTenantId: () => 'test' }, memory };
  c.window = c; vm.createContext(c); c.__loadedModules = new Set();
  loadEsmLike(path.join(ROOT, 'erp-shared-core.js'), c, c.__loadedModules);
  loadEsmLike(path.join(ROOT, 'erp-integrity.js'), c, c.__loadedModules);
  c.put = (k, v) => c.localStorage.setItem(c.ComformTenant.storageKey(k), JSON.stringify(v));
  c.pack = (d, br = 'ubon', month = '09') => c.put(`biz2_${br}_2026_${month}`, d);
  return c;
}
const reconInvoice = (over = {}) => ({ id: 'INV1', no: 'INV690901', branch: 'ubon', customer: 'ลูกค้า ก', date: '2026-09-05', subtotal: 1000, total: 1070, vatAmt: 70, useVat: 1, vatMode: 'add', paymentManaged: true, items: [{ product: 'สินค้า', productCode: 'P1', qty: 10, priceUnit: 100 }], ...over });
const reconCreditNote = (total, over = {}) => ({ id: 'CN1', no: 'CN690901', date: '2026-09-10', branch: 'ubon', status: 'issued', voided: false, lines: [{ invoiceId: 'INV1', invoiceNo: 'INV690901', invoiceBranch: 'ubon', total }], total, ...over });

test('reconciliation: invoices without credit notes are unchanged', () => {
  const c = context(), i = reconInvoice();
  c.pack({ invoices: [i], receipts: [{ id: 'R1', invNo: i.no, customer: i.customer, total: 300 }] });
  const s = c.ERPIntegrity.paymentSummary(i);
  assert.deepEqual({ total: s.total, paid: s.paid, outstanding: s.outstanding, overpaid: s.overpaid, status: s.status, credited: s.credited, effectiveTotal: s.effectiveTotal, refundDue: s.refundDue }, { total: 1070, paid: 300, outstanding: 770, overpaid: 0, status: 'partially_paid', credited: 0, effectiveTotal: 1070, refundDue: 0 });
});

test('reconciliation: partial credit then payment of the credit-adjusted balance settles the invoice', () => {
  const c = context(), i = reconInvoice();
  c.pack({ invoices: [i], creditNotes: [reconCreditNote(214)] });
  let s = c.ERPIntegrity.paymentSummary(i);
  assert.deepEqual([s.total, s.credited, s.effectiveTotal, s.outstanding, s.status], [1070, 214, 856, 856, 'pending']);
  // A receipt above the credit-adjusted outstanding is rejected; exactly the balance is accepted.
  const receipt = { id: 'R1', branch: 'ubon', customer: i.customer, invNo: i.no, total: 1070 };
  assert.throws(() => c.ERPIntegrity.validateReceipt(receipt), /ยอดรับเงินเกินยอดค้างรับ 856.00 บาท/);
  assert.doesNotThrow(() => c.ERPIntegrity.validateReceipt({ ...receipt, total: 856 }));
  c.pack({ invoices: [i], creditNotes: [reconCreditNote(214)], receipts: [{ ...receipt, total: 856 }] });
  s = c.ERPIntegrity.paymentSummary(i);
  assert.deepEqual([s.paid, s.outstanding, s.status, s.refundDue], [856, 0, 'paid', 0]);
});

test('reconciliation: full payment then credit note → outstanding 0 and refund due (never negative)', () => {
  const c = context(), i = reconInvoice();
  c.pack({ invoices: [i], receipts: [{ id: 'R1', invNo: i.no, customer: i.customer, total: 1070 }], creditNotes: [reconCreditNote(214)] });
  const s = c.ERPIntegrity.paymentSummary(i);
  assert.deepEqual([s.paid, s.outstanding, s.status, s.refundDue, s.overpaid], [1070, 0, 'paid', 214, 0]);
  assert.throws(() => c.ERPIntegrity.validateReceipt({ id: 'R2', branch: 'ubon', customer: i.customer, invNo: i.no, total: 1 }), /ยอดรับเงินเกินยอดค้างรับ 0.00/);
});

test('reconciliation: fully credited invoice has status credited; paid-then-fully-credited owes the whole payment back', () => {
  const c = context(), i = reconInvoice();
  c.pack({ invoices: [i], creditNotes: [reconCreditNote(1070)] });
  let s = c.ERPIntegrity.paymentSummary(i);
  assert.deepEqual([s.outstanding, s.status, s.refundDue], [0, 'credited', 0]);
  c.ERPIntegrity.reconcilePayments();
  const stored = JSON.parse(c.localStorage.getItem('test::biz2_ubon_2026_09')).invoices[0];
  assert.deepEqual([stored.paymentStatus, stored.outstandingAmount, stored.paid], ['credited', 0, false]);
  c.pack({ invoices: [i], creditNotes: [reconCreditNote(1070)], receipts: [{ id: 'R1', invNo: i.no, customer: i.customer, total: 500 }] });
  s = c.ERPIntegrity.paymentSummary(i);
  assert.deepEqual([s.outstanding, s.status, s.refundDue], [0, 'credited', 500]);
});

test('reconciliation: voided credit notes and other-branch invoices with the same number are ignored', () => {
  const c = context(), i = reconInvoice();
  c.pack({ invoices: [i], creditNotes: [reconCreditNote(214, { voided: true, status: 'voided' })] });
  c.pack({ invoices: [{ ...i, branch: 'khonkaen' }], creditNotes: [reconCreditNote(500, { id: 'CNK', branch: 'khonkaen', lines: [{ invoiceId: 'INV1', invoiceNo: 'INV690901', invoiceBranch: 'khonkaen', total: 500 }] })] }, 'khonkaen');
  assert.equal(c.ERPIntegrity.paymentSummary(i).outstanding, 1070);
  assert.equal(c.ERPIntegrity.paymentSummary({ ...i, branch: 'khonkaen' }).outstanding, 570);
  // A credit note stored in a later month still reduces the invoice (it is matched by reference, not by month).
  c.pack({ creditNotes: [reconCreditNote(107, { id: 'CN10', date: '2026-10-02' })] }, 'ubon', '10');
  assert.equal(c.ERPIntegrity.paymentSummary(i).outstanding, 963);
});

test('reconciliation: a billing note issued before the credit note closes once the credit-adjusted balance is paid', () => {
  const c = context(), i = reconInvoice();
  c.pack({ invoices: [i], creditNotes: [reconCreditNote(214)], receipts: [{ id: 'R1', invNo: i.no, customer: i.customer, total: 856 }] });
  c.put('example_erp_order_flow_v3', { salesOrders: [], payments: [], billingNotes: [{ id: 'B1', no: 'BL1', branch: 'ubon', customer: i.customer, status: 'draft', createdAt: '2026-09-06T00:00:00.000Z', billingDate: '2026-09-06', lines: [{ invoiceId: 'INV1', invoiceNo: i.no, branch: 'ubon', originalAmount: 1070, outstandingAmount: 1070, billedAmount: 1070, receiptPaidAtCreation: 0 }] }] });
  c.ERPIntegrity.reconcilePayments();
  const note = JSON.parse(c.localStorage.getItem('test::example_erp_order_flow_v3')).billingNotes[0];
  assert.deepEqual([note.lines[0].paidAmount, note.lines[0].outstandingAmount, note.outstandingAmount, note.paymentStatus], [856, 0, 0, 'paid']);
});

// =============================================== finance core integration
test('finance core: credited invoices are locked against financial edits; packs carry creditNotes strictly', async () => {
  const f = await imp('erp-document-finance-core.js');
  const original = { id: 1, no: 'INV1', date: '2026-09-05', branch: 'ubon', customer: 'ก', items: [{ product: 'x', qty: 1, priceUnit: 100 }], subtotal: 100, total: 107, vatAmt: 7 };
  assert.throws(() => f.planInvoiceDocumentAction({ draft: { ...original, total: 200 }, original, paymentSummary: { paid: 0, credited: 10.7 } }), /มีใบลดหนี้อ้างอิงแล้ว/);
  assert.doesNotThrow(() => f.planInvoiceDocumentAction({ draft: { ...original, note: 'แก้หมายเหตุได้' }, original, paymentSummary: { paid: 0, credited: 10.7 } }));
  assert.doesNotThrow(() => f.planInvoiceDocumentAction({ draft: { ...original, total: 200 }, original, paymentSummary: { paid: 0, credited: 0 } }));
  assert.ok(f.DOCUMENT_PACK_COLLECTIONS.includes('creditNotes'));
  assert.deepEqual(f.parseFinancialDocumentPackForWrite('{"invoices":[]}').creditNotes, []);
  assert.throws(() => f.parseFinancialDocumentPackForWrite('{"creditNotes":{}}'), /creditNotes/);
});

// ============================================================ jsdom UI
const uiInvoice = (id, no, over = {}) => ({ id, no, branch: 'ubon', date: '2026-09-05', customer: 'ลูกค้าทดสอบ', customerAddress: '1 ถนนทดสอบ', customerTaxId: '0105555555555', subtotal: 1000, total: 1070, vatAmt: 70, useVat: 1, vatMode: 'add', items: [{ product: 'สินค้าทดสอบ', productCode: 'CN-P', qty: 10, unit: 'ชิ้น', priceUnit: 100, saleTotal: 1000, costTotal: 0 }], paymentManaged: true, ...over });
function fire(w, el, type = 'input') { el.dispatchEvent(new w.Event(type, { bubbles: true })); }

test('UI: fill the credit note form, save, and the invoice outstanding / list / audit update', async () => {
  const h = await boot(); const { w, set } = h;
  try {
    const invoice = uiInvoice(111, 'INV-CN-A');
    const d = w.loadFor('ubon', 2026, 8); d.invoices = [invoice]; w.saveFor('ubon', 2026, 8, d);
    w.go('credit-note-form', null);
    assert.ok(w.document.getElementById('panel-credit-note-form').classList.contains('active'));
    assert.match(w.document.getElementById('cn-no').value, /^CN\d{4}\d{2}$/, 'auto number with CN prefix');
    w.document.getElementById('cn-br-ub').click();
    set('cn-inv-filter-year', '2026'); fire(w, w.document.getElementById('cn-inv-filter-year'));
    const select = w.document.getElementById('cn-inv-ref');
    const option = [...select.options].find(o => o.textContent.includes('INV-CN-A'));
    assert.ok(option, 'invoice appears in the picker');
    select.value = option.value;
    w.document.querySelector('[data-cn-action="add-invoice"]').click();
    assert.equal(w.document.getElementById('cn-cust').value, 'ลูกค้าทดสอบ');
    assert.equal(w.document.getElementById('cn-tax-id').value, '0105555555555');
    assert.match(w.document.getElementById('cn-inv-chips').textContent, /INV-CN-A/);
    const correct = w.document.querySelector('[data-cn-line-field="correct"]');
    correct.value = '800'; fire(w, correct);
    assert.equal(w.document.querySelector('[data-cn-line-field="diff"]').value, '200.00');
    assert.equal(w.document.getElementById('cn-diff').value, '200.00');
    assert.equal(w.document.getElementById('cn-vat-amt').value, '14.00');
    assert.equal(w.document.getElementById('cn-total').value, '214.00');
    set('cn-date', '2026-09-12');
    set('cn-reason', 'defective_goods'); fire(w, w.document.getElementById('cn-reason'), 'change');
    set('cn-reason-text', 'สินค้าชำรุด 2 ชิ้น');
    assert.equal(w.ERPIntegrity.paymentSummary({ ...invoice }).outstanding, 1070);
    w.document.getElementById('cn-save-btn').click();
    for (let i = 0; i < 40 && !w.ERPCreditNotes.allCreditNotes().length; i++) await new Promise(r => setTimeout(r, 25));
    const saved = w.ERPCreditNotes.allCreditNotes();
    assert.equal(saved.length, 1, h.messages.join('\n'));
    assert.equal(saved[0]._month, 8, 'stored in the credit note month pack');
    assert.deepEqual([saved[0].subtotal, saved[0].vatAmt, saved[0].total, saved[0].reasonCode], [200, 14, 214, 'defective_goods']);
    const summary = w.ERPIntegrity.paymentSummary({ ...invoice });
    assert.deepEqual([summary.credited, summary.outstanding, summary.status], [214, 856, 'pending']);
    assert.equal(w.document.getElementById('cn-lines-body').textContent.includes('INV-CN-A'), false, 'form resets after save');
    w.onYearChange(false); set('il-year', '2026');
    w.go('invoice-list', null);
    assert.match(w.document.getElementById('itbl').innerHTML, /ลดหนี้ ฿214.00/);
    w.go('credit-note-list', null); set('cnl-year', '2026'); w.ERPCreditNotes.renderList();
    const listText = w.document.getElementById('cnltbl').textContent;
    assert.match(listText, /INV-CN-A/); assert.match(listText, /฿214.00/);
    assert.ok(w.ERPProductionCore.exportData().audit.some(row => row.entity === 'creditNote' && row.action === 'create' && row.ref === saved[0].no));
    // Printable document carries the §86/10 fields.
    const html = w.ComformCreditNoteDocument.buildHtml(saved[0], 'original');
    for (const needle of ['ใบลดหนี้', 'INV-CN-A', 'มูลค่าตามใบกำกับภาษีเดิม', 'มูลค่าที่ถูกต้อง', 'ผลต่าง', 'ภาษีมูลค่าเพิ่ม 7% ของผลต่าง', 'สินค้าชำรุด 2 ชิ้น', '0105555555555', 'สองร้อยสิบสี่บาทถ้วน']) assert.ok(html.includes(needle), needle);
    // Void: invoice balance is restored and the number is kept.
    assert.equal(await w.ERPCreditNotes.voidCreditNote('ubon', 2026, 8, saved[0].id, 'ออกผิดใบ'), true);
    assert.equal(w.ERPIntegrity.paymentSummary({ ...invoice }).outstanding, 1070);
    assert.equal(w.ERPCreditNotes.allCreditNotes()[0].voided, true);
    assert.ok(w.ERPProductionCore.exportData().audit.some(row => row.entity === 'creditNote' && row.action === 'void'));
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('UI: validation errors are shown and nothing is saved', async () => {
  const h = await boot(); const { w } = h;
  try {
    const d = w.loadFor('ubon', 2026, 8); d.invoices = [uiInvoice(111, 'INV-CN-B')]; w.saveFor('ubon', 2026, 8, d);
    w.go('credit-note-form', null);
    w.ERPCreditNotes.setBranch('ubon');
    assert.equal(await w.ERPCreditNotes.save(), false);
    assert.match(w.document.getElementById('cn-feedback').textContent, /กรุณาเลือกใบกำกับภาษี/);
    assert.match(w.document.getElementById('cn-feedback').textContent, /กรุณาเลือกสาเหตุ/);
    assert.equal(w.ERPCreditNotes.allCreditNotes().length, 0);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('reports: credit notes reduce net sales in their own month, not the invoice month', async () => {
  const h = await boot(); const { w } = h;
  try {
    const aug = w.loadFor('ubon', 2026, 7); aug.invoices = [uiInvoice(201, 'INV-AUG', { date: '2026-08-20' })]; w.saveFor('ubon', 2026, 7, aug);
    const before = { aug: w.testApp.branchStats('ubon', 2026, 7).st, sep: w.testApp.branchStats('ubon', 2026, 8).st, year: w.testApp.branchStats('ubon', 2026, -1).st };
    assert.equal(w.ERPCreditNotes.startFromInvoice('ubon', 2026, 7, 201), true);
    const diff = w.document.querySelector('[data-cn-line-field="diff"]');
    diff.value = '300'; fire(w, diff);
    w.document.getElementById('cn-date').value = '2026-09-03';
    w.document.getElementById('cn-reason').value = 'price_overcharge';
    const saved = await w.ERPCreditNotes.save();
    assert.ok(saved && saved.no, h.messages.join('\n'));
    assert.equal(w.testApp.branchStats('ubon', 2026, 7).st, before.aug, 'invoice month unchanged');
    assert.equal(w.testApp.branchStats('ubon', 2026, 8).st, before.sep - 300, 'credit note month reduced by the pre-VAT difference');
    assert.equal(w.testApp.branchStats('ubon', 2026, -1).st, before.year - 300);
    const sepPack = w.loadFor('ubon', 2026, 8);
    assert.equal(w.testApp.metricFromData(sepPack, 'sales', 2026, 8, 'ubon'), -300);
    // AR aging uses the credit-adjusted balance.
    const aging = w.testApp.buildReceivableAgingRows({ invoices: [{ ...w.loadFor('ubon', 2026, 7).invoices[0], branch: 'ubon' }], receipts: [] });
    assert.equal(aging[0].outstanding, 1070 - 321);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('backup/export: credit notes are included, fail closed when corrupted, restore through JSON import, and appear in XLSX', async () => {
  const h = await boot(); const { w } = h;
  try {
    const c = await imp('erp-credit-note-core.js');
    const invoice = uiInvoice(301, 'INV-BK');
    const calc = c.calculateCreditNote({ lines: [{ invoice: { ...invoice, _year: 2026, _month: 8 }, differenceAmount: 100 }] });
    const cn = { id: 9301, no: 'CN-BK-1', date: '2026-09-15', branch: 'ubon', customer: invoice.customer, reasonCode: 'price_overcharge', reasonLabel: 'x', lines: calc.lines, invoiceNos: ['INV-BK'], subtotal: calc.subtotal, vatAmt: calc.vatAmt, total: calc.total, vatMode: 'add', status: 'issued', voided: false };
    const d = w.loadFor('ubon', 2026, 8); d.invoices = [invoice]; d.creditNotes = [cn]; w.saveFor('ubon', 2026, 8, d);
    const backup = w.testApp.collectBackupData({ year: 2026, month: 8, branch: 'ubon', includeEmpty: true });
    assert.equal(backup[2026].ubon['กันยายน'].creditNotes.length, 1);
    // XLSX: a dedicated sheet with one row per referenced invoice.
    const sheets = [];
    w.XLSX = { utils: { book_new: () => ({}), aoa_to_sheet: rows => rows, book_append_sheet: (wb, rows, name) => sheets.push({ name, rows }) }, writeFile: () => {} };
    w.testApp.exportXLSX('creditNotes', { year: 2026, month: 8, branch: 'ubon' });
    const sheet = sheets.find(s => s.name === 'ใบลดหนี้');
    assert.ok(sheet, JSON.stringify(sheets.map(s => s.name)));
    assert.equal(sheet.rows.length, 2);
    assert.equal(sheet.rows[1][3], 'CN-BK-1');
    assert.equal(sheet.rows[1][13], 107);
    // Fail closed: a non-array creditNotes store aborts backup instead of exporting an empty collection.
    w.localStorage.setItem(w.testApp.keyFor('ubon', 2026, 9), JSON.stringify({ creditNotes: { broken: true } }));
    assert.throws(() => w.testApp.collectBackupData({ year: 2026, month: 9, branch: 'ubon', includeEmpty: true }), /สำรองข้อมูลล้มเหลว/);
    w.localStorage.removeItem(w.testApp.keyFor('ubon', 2026, 9));
    assert.throws(() => w.ERPBackup.validate({ data: { 2026: { ubon: { 'กันยายน': { creditNotes: {} } } } } }), /creditNotes ต้องเป็นรายการ/);
    // Restore: wipe the month, import the backup JSON, credit note and its effect come back.
    w.localStorage.removeItem(w.testApp.keyFor('ubon', 2026, 8));
    assert.equal(w.ERPIntegrity.paymentSummary({ ...invoice }).credited, 0);
    const file = { text: async () => JSON.stringify({ meta: { app: 'comform-esan', backupType: 'month' }, data: backup }) };
    await w.importJSON({ target: { files: [file], value: 'x' } });
    assert.equal(w.loadFor('ubon', 2026, 8).creditNotes.length, 1, w.document.getElementById('import-json-status').textContent);
    assert.equal(w.ERPIntegrity.paymentSummary({ ...invoice }).credited, 107);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('returned goods come back into stock; an invoice with credit notes cannot be deleted or re-priced', async () => {
  const h = await boot(); const { w } = h;
  try {
    const product = { id: 'CN-P', code: 'CN-P', name: 'สินค้าทดสอบ', flowType: 'inventory', fulfillmentType: 'stock', openingStockUbon: 20, unit: 'ชิ้น' };
    w.testApp.restoreLocalMasterBackup({ products: [product] });
    const d = w.loadFor('ubon', 2026, 8); d.invoices = [uiInvoice(401, 'INV-RT')]; w.saveFor('ubon', 2026, 8, d);
    assert.equal(w.productEstimatedStock(product, 'ubon'), 10);
    w.ERPCreditNotes.startFromInvoice('ubon', 2026, 8, 401);
    const diff = w.document.querySelector('[data-cn-line-field="diff"]');
    diff.value = '300'; fire(w, diff);
    const reason = w.document.getElementById('cn-reason'); reason.value = 'returned_goods'; fire(w, reason, 'change');
    assert.equal(w.document.getElementById('cn-return-section').hidden, false);
    w.document.querySelector('[data-cn-action="add-return"]').click();
    const productSelect = w.document.querySelector('[data-cn-return-field="product"]');
    productSelect.value = productSelect.options[1].value; fire(w, productSelect, 'change');
    const qty = w.document.querySelector('[data-cn-return-field="qty"]'); qty.value = '3'; fire(w, qty);
    w.document.getElementById('cn-date').value = '2026-09-20';
    const saved = await w.ERPCreditNotes.save();
    assert.ok(saved && saved.returnItems.length === 1, h.messages.join('\n'));
    assert.equal(w.productEstimatedStock(product, 'ubon'), 13);
    // Deleting the invoice would orphan the credit note.
    await w.delDoc('ubon', 2026, 8, 'invoices', 401);
    assert.equal(w.loadFor('ubon', 2026, 8).invoices.length, 1);
    // Re-pricing the invoice would falsify the printed credit note: the edit is refused.
    w.editInvoice('ubon', 2026, 8, 401);
    const price = w.document.querySelector('#i-items-body [data-field="priceUnit"]');
    assert.ok(price, 'invoice price field');
    price.value = 200; w.calcI(); await w.saveInvoice();
    assert.equal(w.loadFor('ubon', 2026, 8).invoices[0].total, 1070);
    assert.match(w.document.body.textContent, /มีใบลดหนี้อ้างอิงแล้ว/);
    w.cancelDocumentEdit('invoice');
    // Voiding the credit note removes the stock return again.
    await w.ERPCreditNotes.voidCreditNote('ubon', 2026, 8, saved.id, 'ทดสอบยกเลิก');
    assert.equal(w.productEstimatedStock(product, 'ubon'), 10);
    // The refused invoice save is logged by app.js (console.error) by design; nothing else may error.
    assert.deepEqual(h.errors.filter(message => !message.includes('ใบส่งสินค้า / ใบกำกับภาษี action failed')), []);
  } finally { h.close(); }
});

// ======================================================================
// Review fixes (regression tests — each failed on ../baseline-before-fixes)
// ======================================================================
async function saveFromInvoice(w, { branch = 'ubon', year = 2026, month = 8, id, diff, reason = 'price_overcharge', date = '2026-09-20', returnQty = null }) {
  assert.equal(w.ERPCreditNotes.startFromInvoice(branch, year, month, id), true);
  const input = w.document.querySelector('[data-cn-line-field="diff"]');
  input.value = String(diff); fire(w, input);
  const reasonEl = w.document.getElementById('cn-reason'); reasonEl.value = reason; fire(w, reasonEl, 'change');
  if (returnQty !== null) {
    w.document.querySelector('[data-cn-action="add-return"]').click();
    const product = w.document.querySelector('[data-cn-return-field="product"]');
    product.value = product.options[1].value; fire(w, product, 'change');
    const qty = w.document.querySelector('[data-cn-return-field="qty"]'); qty.value = String(returnQty); fire(w, qty);
  }
  w.document.getElementById('cn-date').value = date;
  return w.ERPCreditNotes.save();
}

test('fix#1: a full credit in VAT-inclusive mode is pinned to the invoice remaining value and VAT (no 0.01 over-credit)', async () => {
  const c = await imp('erp-credit-note-core.js');
  const a = invExtract({ id: 'A', no: 'INV-A', total: 1000.07, subtotal: 934.64, vatAmt: 65.43 });
  const b = invExtract({ id: 'B', no: 'INV-B', total: 5350, subtotal: 5000, vatAmt: 350 });
  const r = c.calculateCreditNote({ lines: [{ invoice: a, differenceAmount: 1000.07 }, { invoice: b, differenceAmount: 250.5 }] });
  assert.deepEqual([r.lines[0].difference, r.lines[0].vatOnDifference, r.lines[0].correctValue], [934.64, 65.43, 0]);
  assert.deepEqual([r.lines[1].difference, r.lines[1].vatOnDifference, r.lines[1].total], [234.11, 16.39, 250.5]);
  assert.deepEqual([r.subtotal, r.vatAmt, r.total], [1168.75, 81.82, 1250.57]);
  assert.ok(r.lines.every(line => line.correctValue >= 0));
  // Two 10.00 invoices (VAT 0.65 each) fully credited: VAT on the difference is exactly the original 1.30.
  const ten = id => invExtract({ id, no: id, total: 10, subtotal: 9.35, vatAmt: 0.65 });
  const both = c.calculateCreditNote({ lines: [{ invoice: ten('X'), differenceAmount: 10 }, { invoice: ten('Y'), differenceAmount: 10 }] });
  assert.deepEqual([both.subtotal, both.vatAmt, both.total], [18.7, 1.3, 20]);
  // A partial line is never given more pre-VAT value than is left on its invoice.
  const partial = c.calculateCreditNote({ lines: [{ invoice: a, differenceAmount: 1000.06 }] });
  assert.ok(partial.lines[0].difference <= 934.64 && partial.lines[0].vatOnDifference <= 65.43);
});

test('fix#2: the last of many partial credit notes absorbs the VAT rounding drift and is accepted', async () => {
  const c = await imp('erp-credit-note-core.js');
  const series = (invoice, amount, count) => {
    const notes = [];
    for (let i = 1; i <= count; i += 1) {
      const d = draft({ id: `N${i}`, no: `CN-D${i}`, lines: [{ invoiceId: invoice.id, invoiceBranch: 'ubon', differenceAmount: amount }] });
      const v = c.validateCreditNote(d, [invoice], notes);
      assert.equal(v.ok, true, `note ${i}: ${v.errors.join(' | ')}`);
      notes.push(c.buildCreditNoteRecord(d, v, { id: `N${i}` }));
    }
    return notes;
  };
  const tiny = invAdd({ subtotal: 1, vatAmt: 0.07, total: 1.07 });
  const tinyNotes = series(tiny, 0.1, 10);
  assert.equal(c.creditedByInvoice(tiny, tinyNotes).total, 1.07);
  assert.equal(c.creditedByInvoice(tiny, tinyNotes).vat, 0.07);
  const real = invAdd({ subtotal: 400.32, vatAmt: 28.02, total: 428.34 });
  const realNotes = series(real, 100.08, 4);
  assert.deepEqual(realNotes.map(n => n.total), [107.09, 107.09, 107.09, 107.07]);
  assert.equal(c.creditedByInvoice(real, realNotes).total, 428.34);
  // Legacy notes that already over-credited VAT are named as the real cause.
  const legacy = { id: 'L', no: 'CN-L', branch: 'ubon', status: 'issued', lines: [{ invoiceId: 'I1', invoiceBranch: 'ubon', differenceAmount: 0.9, difference: 0.9, vatOnDifference: 0.2, total: 1.1 }] };
  const v = c.validateCreditNote(draft({ lines: [{ invoiceId: 'I1', invoiceBranch: 'ubon', differenceAmount: 0.05 }] }), [tiny], [legacy]);
  assert.match(v.errors.join('\n'), /ยอดลดหนี้รวม VAT สะสม.*เกินยอดรวม VAT ของใบกำกับภาษี/);
  assert.doesNotMatch(v.errors.join('\n'), /\(1\.00 บาท\) เกินมูลค่าใบกำกับภาษี \(1\.00 บาท\)/);
});

test('fix#3: a legacy-paid invoice keeps its payment after a full credit note and after voiding it', () => {
  const c = context(), i = reconInvoice({ paymentManaged: false, paid: true, isPaid: true, paymentStatus: 'paid' });
  const pack = voided => ({ invoices: [JSON.parse(c.localStorage.getItem('test::biz2_ubon_2026_09') || 'null')?.invoices?.[0] || i], creditNotes: [reconCreditNote(1070, voided ? { voided: true, status: 'voided' } : {})] });
  c.pack(pack(false));
  let s = c.ERPIntegrity.paymentSummary(i);
  assert.deepEqual([s.paid, s.refundDue, s.status], [1070, 1070, 'credited']);
  c.ERPIntegrity.reconcilePayments();
  s = c.ERPIntegrity.paymentSummary(i);
  assert.deepEqual([s.paid, s.refundDue, s.status], [1070, 1070, 'credited'], 'reconcile must not erase the legacy payment');
  c.ERPIntegrity.reconcilePayments();
  c.pack(pack(true));
  c.ERPIntegrity.reconcilePayments();
  s = c.ERPIntegrity.paymentSummary(i);
  assert.deepEqual([s.paid, s.outstanding, s.status], [1070, 0, 'paid']);
  const stored = JSON.parse(c.localStorage.getItem('test::biz2_ubon_2026_09')).invoices[0];
  assert.deepEqual([stored.paid, stored.paymentStatus, stored.outstandingAmount], [true, 'paid', 0]);
});

test('fix#4: an issued credit note only allows non-financial edits, and numbers are never reissued', async () => {
  const h = await boot(); const { w } = h;
  try {
    const c = await imp('erp-credit-note-core.js');
    const original = { id: 1, no: 'CN1', date: '2026-09-10', branch: 'ubon', customer: 'ก', customerTaxId: '1', reasonCode: 'price_overcharge', reasonText: 'x', lines: [{ invoiceId: 'I1', invoiceNo: 'INV1', invoiceBranch: 'ubon', differenceAmount: 200 }], returnItems: [], note: '', customerAddress: 'เดิม' };
    const ok = c.applyCreditNoteEdit(original, { ...original, note: 'หมายเหตุใหม่', customerAddress: 'ที่อยู่ใหม่', customerBranch: 'สำนักงานใหญ่' }, { at: '2026-09-21T00:00:00.000Z' });
    assert.deepEqual(ok.errors, []);
    assert.deepEqual([ok.record.note, ok.record.customerAddress, ok.record.customerBranch, ok.record.lines, ok.record.no], ['หมายเหตุใหม่', 'ที่อยู่ใหม่', 'สำนักงานใหญ่', original.lines, 'CN1']);
    for (const change of [{ no: 'CN2' }, { date: '2026-10-01' }, { reasonCode: 'other' }, { reasonText: 'y' }, { lines: [{ ...original.lines[0], differenceAmount: 300 }] }, { lines: [] }, { returnItems: [{ productCode: 'A', qty: 1 }] }]) {
      assert.match(c.applyCreditNoteEdit(original, { ...original, ...change }).errors.join('\n'), /ยกเลิก.*ออกใบลดหนี้ใหม่/, JSON.stringify(change));
    }
    const d = w.loadFor('ubon', 2026, 8); d.invoices = [uiInvoice(501, 'INV-ED')]; w.saveFor('ubon', 2026, 8, d);
    const saved = await saveFromInvoice(w, { id: 501, diff: 200 });
    assert.ok(saved && saved.no, h.messages.join('\n'));
    assert.equal(w.ERPCreditNotes.edit('ubon', 2026, 8, saved.id), true);
    assert.equal(w.document.getElementById('cn-no').readOnly, true);
    assert.equal(w.document.getElementById('cn-date').readOnly, true);
    assert.equal(w.document.getElementById('cn-reason').disabled, true);
    assert.equal(w.document.querySelector('[data-cn-line-field="diff"]').disabled, true);
    assert.equal(w.document.querySelector('[data-cn-action="add-invoice"]').disabled, true);
    assert.match(w.document.getElementById('cn-edit-lock-hint').textContent, /ยกเลิก.*ออกใบลดหนี้ใหม่/);
    w.document.getElementById('cn-note').value = 'แก้หมายเหตุ';
    const edited = await w.ERPCreditNotes.save();
    assert.ok(edited, h.messages.join('\n'));
    let stored = w.ERPCreditNotes.allCreditNotes();
    assert.equal(stored.length, 1);
    assert.deepEqual([stored[0].note, stored[0].total, stored[0].no, stored[0].date], ['แก้หมายเหตุ', 214, saved.no, saved.date]);
    // Forcing a financial change through the locked form is refused by the save path itself.
    w.ERPCreditNotes.edit('ubon', 2026, 8, saved.id);
    w.document.getElementById('cn-date').value = '2026-10-05';
    assert.equal(await w.ERPCreditNotes.save(), false);
    stored = w.ERPCreditNotes.allCreditNotes();
    assert.deepEqual([stored.length, stored[0].date], [1, saved.date]);
    w.ERPCreditNotes.reset();
    // Next number skips a CN69xx number already used in any period (e.g. a note stored in another month).
    const oct = w.loadFor('ubon', 2026, 9); oct.creditNotes = [{ id: 777, no: 'CN690905', date: '2026-10-01', branch: 'ubon', lines: [], status: 'voided', voided: true }]; w.saveFor('ubon', 2026, 9, oct);
    w.document.getElementById('cn-date').value = '2026-09-15';
    assert.equal(w.refreshAutoDocumentNumber('creditNote', true), 'CN690906');
    assert.deepEqual(h.errors.filter(m => !/action failed/.test(m)), []);
  } finally { h.close(); }
});

test('fix#5: voiding a returned-goods credit note is blocked when the returned stock was resold', async () => {
  const h = await boot(); const { w } = h;
  try {
    const product = { id: 'CN-P', code: 'CN-P', name: 'สินค้าทดสอบ', flowType: 'inventory', fulfillmentType: 'stock', openingStockUbon: 10, unit: 'ชิ้น' };
    w.testApp.restoreLocalMasterBackup({ products: [product] });
    const d = w.loadFor('ubon', 2026, 8); d.invoices = [uiInvoice(601, 'INV-SOLD')]; w.saveFor('ubon', 2026, 8, d);
    assert.equal(w.productEstimatedStock(product, 'ubon'), 0);
    const saved = await saveFromInvoice(w, { id: 601, diff: 500, reason: 'returned_goods', returnQty: 5 });
    assert.ok(saved, h.messages.join('\n'));
    assert.equal(w.productEstimatedStock(product, 'ubon'), 5);
    const again = w.loadFor('ubon', 2026, 8); again.invoices.push(uiInvoice(602, 'INV-RESOLD', { subtotal: 500, total: 535, vatAmt: 35, items: [{ product: 'สินค้าทดสอบ', productCode: 'CN-P', qty: 5, unit: 'ชิ้น', priceUnit: 100, saleTotal: 500 }] })); w.saveFor('ubon', 2026, 8, again);
    assert.equal(w.productEstimatedStock(product, 'ubon'), 0);
    assert.equal(await w.ERPCreditNotes.voidCreditNote('ubon', 2026, 8, saved.id, 'ออกผิด'), false);
    assert.match(h.messages.join('\n'), /สต็อก.*ติดลบ|ติดลบ/);
    assert.equal(w.productEstimatedStock(product, 'ubon'), 0);
    assert.equal(w.ERPCreditNotes.allCreditNotes()[0].voided, false);
  } finally { h.close(); }
});

test('fix#6: a draft preview is stamped as DRAFT on every page, including print output', async () => {
  const h = await boot(); const { w } = h;
  try {
    const c = await imp('erp-credit-note-core.js');
    const invoices = Array.from({ length: 9 }, (_, i) => invAdd({ id: `I${i}`, no: `INV${i}` }));
    const calc = c.calculateCreditNote({ lines: invoices.map(invoice => ({ invoice, differenceAmount: 10 })) });
    const record = { id: 'p', no: 'CN-P1', date: '2026-09-10', branch: 'ubon', customer: 'ก', reasonCode: 'other', reasonText: 'x', vatMode: 'add', lines: calc.lines, subtotal: calc.subtotal, vatAmt: calc.vatAmt, total: calc.total };
    w.ComformCreditNoteDocument.openPreview(record, { previewOnly: true });
    const pages = w.document.querySelectorAll('.doc-preview-modal-page .cn-doc-page');
    assert.equal(pages.length, 2);
    assert.equal(w.document.querySelectorAll('.doc-preview-modal-page .cn-doc-draft-stamp').length, 2);
    assert.match(pages[1].textContent, /ตัวอย่าง \/ DRAFT – ยังไม่ออกเอกสาร/);
    const writes = []; w.open = () => ({ document: { write: html => writes.push(html), close() {} } });
    w.document.querySelector('[data-cn-doc="print-all"]').click();
    assert.equal((writes[0].match(/cn-doc-draft-stamp/g) || []).length, 4, 'original + copy × 2 pages');
    w.document.getElementById('doc-preview-modal-overlay').remove();
    assert.doesNotMatch(w.ComformCreditNoteDocument.buildHtml(record, 'original'), /cn-doc-draft-stamp/, 'issued notes carry no draft stamp');
  } finally { h.close(); }
});

test('fix#7: the buyer head office / branch from the customer master is printed on the credit note', async () => {
  const h = await boot(); const { w } = h;
  try {
    const c = await imp('erp-credit-note-core.js');
    assert.equal(c.creditNoteBuyerBranchLabel({ branchCode: '00000' }), 'สำนักงานใหญ่');
    assert.equal(c.creditNoteBuyerBranchLabel({ branchCode: '12', branchName: 'บางนา' }), 'สาขาที่ 00012 (บางนา)');
    assert.equal(c.creditNoteBuyerBranchLabel({}), '');
    w.testApp.restoreLocalMasterBackup({ contacts: [{ id: 'C1', name: 'ลูกค้าทดสอบ', role: 'customer', taxId: '0105555555555', branchCode: '00003', branchName: 'ขอนแก่น' }] });
    const d = w.loadFor('ubon', 2026, 8); d.invoices = [uiInvoice(701, 'INV-BR')]; w.saveFor('ubon', 2026, 8, d);
    w.ERPCreditNotes.startFromInvoice('ubon', 2026, 8, 701);
    assert.equal(w.document.getElementById('cn-buyer-branch').value, 'สาขาที่ 00003 (ขอนแก่น)');
    const saved = await saveFromInvoice(w, { id: 701, diff: 100 });
    assert.equal(saved.customerBranch, 'สาขาที่ 00003 (ขอนแก่น)');
    const party = new w.DOMParser().parseFromString(w.ComformCreditNoteDocument.buildHtml(saved, 'original'), 'text/html').querySelector('.cn-doc-party').textContent;
    assert.match(party, /สาขา.*สาขาที่ 00003 \(ขอนแก่น\)/);
    // Without branch data nothing is invented.
    assert.doesNotMatch(w.ComformCreditNoteDocument.buildHtml({ ...saved, customerBranch: '' }, 'original'), /สาขา \/ Branch/);
  } finally { h.close(); }
});

test('fix#8: Customer 360 nets credit notes, lists them on the timeline and shows the refund due', async () => {
  const h = await boot(); const { w } = h;
  try {
    const d = w.loadFor('ubon', 2026, 8); d.invoices = [uiInvoice(801, 'INV-C360')]; d.receipts = [{ id: 802, no: 'R-C360', branch: 'ubon', date: '2026-09-06', invNo: 'INV-C360', invoiceId: 801, customer: 'ลูกค้าทดสอบ', total: 1070, paymentManaged: true }]; w.saveFor('ubon', 2026, 8, d);
    const saved = await saveFromInvoice(w, { id: 801, diff: 200 });
    assert.ok(saved, h.messages.join('\n'));
    const snap = w.ERPCustomerExperience.customerSnapshot('ลูกค้าทดสอบ');
    assert.equal(snap.sales, 856);
    assert.equal(snap.refundDue, 214);
    assert.ok(snap.timeline.some(t => t.label === 'Credit Note' && t.no === saved.no && t.amount === -214));
    w.ERPCustomerExperience.openCustomer360('ลูกค้าทดสอบ');
    const text = w.document.querySelector('.erp-c360-dialog').textContent;
    assert.match(text, /ยอด Invoice.*856\.00/);
    assert.match(text, /ต้องคืน.*214\.00/);
    assert.match(text, /Credit Note/);
  } finally { h.close(); }
});

// ================================================= fix4 regressions (4.3.1 review)
test('fix4#3: a new credit note cannot reuse the number of a stored note that has no id', async () => {
  const c = await imp('erp-credit-note-core.js');
  const stored = { ...(await storedCreditNote(c, invAdd(), 100, { no: 'CN690901' })), id: undefined };
  delete stored.id;
  const fresh = draft({ no: 'CN690901', lines: [{ invoiceId: 'I1', invoiceNo: 'INV690901', invoiceBranch: 'ubon', differenceAmount: 50 }] });
  const v = c.validateCreditNote(fresh, [invAdd()], [stored], []);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => /CN690901 มีอยู่แล้ว/.test(e)), v.errors.join('\n'));
  // The note being edited (non-empty id) is still excluded from its own duplicate check.
  const own = await storedCreditNote(c, invAdd(), 100, { id: 'CN-OWN', no: 'CN690902' });
  const edited = c.validateCreditNote({ ...draft({ no: 'CN690902' }), id: 'CN-OWN' }, [invAdd()], [own], []);
  assert.ok(!edited.errors.some(e => /มีอยู่แล้ว/.test(e)), edited.errors.join('\n'));
});

test('fix4#5: invoice, receipt and credit-note writes share one write lease, so a credit note waits while an invoice/receipt save holds it', async () => {
  const h = await boot(); const { w } = h;
  try {
    const invoice = uiInvoice(501, 'INV-LS');
    const calc = (await imp('erp-credit-note-core.js')).calculateCreditNote({ lines: [{ invoice: { ...invoice, _year: 2026, _month: 8 }, differenceAmount: 100 }] });
    const d = w.loadFor('ubon', 2026, 8); d.invoices = [invoice]; d.creditNotes = [{ id: 9501, no: 'CN690951', date: '2026-09-15', branch: 'ubon', customer: invoice.customer, reasonCode: 'price_overcharge', lines: calc.lines, invoiceNos: ['INV-LS'], subtotal: calc.subtotal, vatAmt: calc.vatAmt, total: calc.total, vatMode: 'add', status: 'issued', voided: false }]; w.saveFor('ubon', 2026, 8, d);
    // Record which lease key each save path takes (observed at runtime, not from the source text).
    const leaseKeys = { invoice: new Set(), receipt: new Set(), creditNote: new Set() };
    let current = null;
    const original = w.Storage.prototype.setItem;
    w.Storage.prototype.setItem = function (key, value) { if (current && String(key).startsWith('erp_demo_write_lease_v1:')) leaseKeys[current].add(String(key)); return original.call(this, key, value); };
    try {
      current = 'invoice'; await w.saveInvoice();
      current = 'receipt'; await w.saveReceipt();
      current = 'creditNote'; await w.ERPCreditNotes.save(); await w.ERPCreditNotes.voidCreditNote('ubon', 2026, 8, 'missing-id', 'x');
    } finally { current = null; w.Storage.prototype.setItem = original; }
    const all = new Set([...leaseKeys.invoice, ...leaseKeys.receipt, ...leaseKeys.creditNote]);
    assert.equal(leaseKeys.invoice.size, 1, JSON.stringify([...all]));
    assert.equal(all.size, 1, `each flow must use the same lease: ${JSON.stringify(Object.fromEntries(Object.entries(leaseKeys).map(([k, v]) => [k, [...v]])))}`);
    // Another window is saving an invoice (holds the invoice lease): voiding a credit note must not interleave.
    const [invoiceLease] = leaseKeys.invoice;
    w.localStorage.setItem(invoiceLease, JSON.stringify({ owner: 'other-window', expiresAt: Date.now() + 60000 }));
    const voided = await w.ERPCreditNotes.voidCreditNote('ubon', 2026, 8, 9501, 'ทดสอบ');
    assert.equal(voided, false);
    assert.equal(w.loadFor('ubon', 2026, 8).creditNotes[0].voided, false);
    assert.match(h.messages.slice(-1)[0], /มีอีกหน้าต่างกำลังบันทึกเอกสารอยู่/);
    w.localStorage.removeItem(invoiceLease);
    assert.equal(await w.ERPCreditNotes.voidCreditNote('ubon', 2026, 8, 9501, 'ทดสอบ'), true);
  } finally { h.close(); }
});

test('fix4#6: a closed period (GovernanceError period_locked) is reported as a lock with its Thai message, not as an unclassified error', async () => {
  const f = await imp('erp-document-finance-core.js');
  const lockError = Object.assign(new Error('งวด ขาย/ภาษีขาย ถูกปิดถึง 2026-09-30 สำหรับ ทุกสาขา'), { name: 'GovernanceError', code: 'period_locked' });
  const normalized = f.normalizeDocumentActionError(lockError, { action: 'invoice_create', stage: 'validate' });
  assert.equal(normalized.code, f.FINANCE_ACTION_ERROR_CODES.PERMISSION);
  assert.equal(normalized.message, lockError.message);
  const feedback = f.documentActionFeedback({ ok: false, committed: false, ...normalized });
  assert.doesNotMatch(feedback.text, /ยังจำแนกไม่ได้/);
  assert.match(feedback.text, /ถูกปิดถึง 2026-09-30/);
  // Unknown foreign codes (incl. Object.prototype names) still fall back to "unknown".
  assert.equal(f.normalizeDocumentActionError({ code: 'constructor', message: 'x' }).code, f.FINANCE_ACTION_ERROR_CODES.UNKNOWN);
  // UI: voiding and issuing a credit note in a locked period show the lock message.
  const h = await boot(); const { w } = h;
  try {
    const invoice = uiInvoice(601, 'INV-PL');
    const calc = (await imp('erp-credit-note-core.js')).calculateCreditNote({ lines: [{ invoice: { ...invoice, _year: 2026, _month: 8 }, differenceAmount: 100 }] });
    const d = w.loadFor('ubon', 2026, 8); d.invoices = [invoice]; d.creditNotes = [{ id: 9601, no: 'CN690961', date: '2026-09-15', branch: 'ubon', customer: invoice.customer, reasonCode: 'price_overcharge', lines: calc.lines, invoiceNos: ['INV-PL'], subtotal: calc.subtotal, vatAmt: calc.vatAmt, total: calc.total, vatMode: 'add', status: 'issued', voided: false }]; w.saveFor('ubon', 2026, 8, d);
    w.ERPGovernance.lockPeriod({ branch: 'all', scope: 'sales', throughDate: '2026-09-30', reason: 'ปิดงวด' });
    assert.equal(await w.ERPCreditNotes.voidCreditNote('ubon', 2026, 8, 9601, 'ทดสอบ'), false);
    assert.equal(w.loadFor('ubon', 2026, 8).creditNotes[0].voided, false);
    let last = h.messages.slice(-1)[0];
    assert.doesNotMatch(last, /ยังจำแนกไม่ได้/); assert.match(last, /ถูกล็อก/); assert.match(last, /ถูกปิดถึง 2026-09-30/);
    w.ERPCreditNotes.startFromInvoice('ubon', 2026, 8, 601);
    w.document.getElementById('cn-date').value = '2026-09-20';
    const diff = w.document.querySelector('[data-cn-line-field="diff"]'); diff.value = '50'; diff.dispatchEvent(new w.Event('input', { bubbles: true }));
    w.document.getElementById('cn-reason').value = 'price_overcharge';
    assert.equal(await w.ERPCreditNotes.save(), false);
    assert.equal(w.loadFor('ubon', 2026, 8).creditNotes.length, 1);
    last = h.messages.slice(-1)[0];
    assert.doesNotMatch(last, /ยังจำแนกไม่ได้/); assert.match(last, /ถูกปิดถึง 2026-09-30/);
  } finally { h.close(); }
});

// ================================================= fix6 regressions (4.3.1 review 6)
const plainJson = value => JSON.parse(JSON.stringify(value));
test('fix6#1: a returned-goods note on an invoice whose product text has stray spaces keeps its return row on edit; the goods return to that product', async () => {
  const h = await boot(); const { w } = h;
  try {
    const product = { id: 'PA', code: '', name: 'สินค้า A ', flowType: 'inventory', fulfillmentType: 'stock', openingStockUbon: 20, unit: 'ชิ้น' };
    w.testApp.restoreLocalMasterBackup({ products: [product] });
    const inv = uiInvoice(111, 'INV-T', { customer: 'ลูกค้า', items: [{ product: 'สินค้า A ', productCode: '', qty: 10, unit: ' ชิ้น', priceUnit: 100, saleTotal: 1000 }] });
    const d = w.loadFor('ubon', 2026, 8); d.invoices = [inv]; w.saveFor('ubon', 2026, 8, d);
    const stock = () => w.productEstimatedStock(w.productMasterRows().find(p => p.id === 'PA') || product, 'ubon');
    assert.equal(stock(), 10);
    const saved = await saveFromInvoice(w, { id: 111, diff: 300, reason: 'returned_goods', returnQty: 3 });
    assert.ok(saved, h.messages.join('\n'));
    assert.deepEqual(plainJson(saved.returnItems.map(i => [i.product, i.unit, i.qty])), [['สินค้า A', 'ชิ้น', 3]]);
    assert.equal(stock(), 13, 'returned goods of "สินค้า A " come back to the stock of "สินค้า A "');
    w.ERPCreditNotes.edit('ubon', 2026, 8, saved.id);
    assert.equal(w.ERPCreditNotes.getFormState().returnItems.length, 1, 'the stored return row survives loading the note for edit');
    w.document.getElementById('cn-note').value = 'แก้หมายเหตุเท่านั้น';
    const edited = await w.ERPCreditNotes.save();
    assert.ok(edited, h.messages.slice(-1).join('\n'));
    assert.doesNotMatch(h.messages.join('\n'), /ไม่อนุญาตให้แก้ สินค้าที่รับคืน/);
    const stored = w.loadFor('ubon', 2026, 8).creditNotes[0];
    assert.equal(stored.note, 'แก้หมายเหตุเท่านั้น');
    assert.deepEqual(plainJson(stored.returnItems), plainJson(saved.returnItems));
    assert.equal(stock(), 13);
  } finally { h.close(); }
});

test('fix6#4: printed credit note paginates returned goods; no page exceeds its row budget and totals print once', async () => {
  const c = await imp('erp-credit-note-core.js');
  const L = c.CREDIT_NOTE_PRINT_LAYOUT;
  const line = prior => ({ invoiceNo: 'INV', priorCreditedValue: prior ? 10 : 0 });
  const ret = (i, long) => ({ product: long ? 'สินค้าชื่อยาวมาก '.repeat(6) : `สินค้า ${i}`, qty: 1 });
  const budget = page => (page.lines.length || !page.returnItems.length ? L.lineHeaderUnits : 0) + page.lines.reduce((s, x) => s + c.creditNoteLinePrintUnits(x), 0) + page.fillerRows
    + (page.returnItems.length ? L.returnHeaderUnits : 0) + page.returnItems.reduce((s, x) => s + c.creditNoteReturnPrintUnits(x), 0);
  for (const [nl, nr, prior, long] of [[8, 10, false, false], [8, 0, true, false], [8, 10, true, false], [1, 14, false, false], [0, 12, false, false], [3, 25, false, true], [20, 40, false, false], [0, 0, false, false]]) {
    const lines = Array.from({ length: nl }, () => line(prior)), items = Array.from({ length: nr }, (_, i) => ret(i, long));
    const pages = c.paginateCreditNoteDocument(lines, items);
    const label = `${nl} lines (prior=${prior}) + ${nr} returns (long=${long})`;
    assert.ok(pages.length >= 1, label);
    for (const page of pages) {
      assert.ok(page.lines.length <= L.linesPerPage, label);
      assert.equal(page.units, budget(page), `${label}: units bookkeeping`);
      assert.ok(page.units <= L.pageUnits, `${label}: page uses ${page.units} of ${L.pageUnits} units`);
    }
    // Every row printed exactly once, in order.
    assert.deepEqual(pages.flatMap(p => p.lines), lines, label);
    assert.deepEqual(pages.flatMap(p => p.returnItems), items, label);
    pages.forEach(p => { if (p.lines.length) assert.equal(p.lineStart, lines.indexOf(p.lines[0]), label); });
  }
  assert.equal(c.paginateCreditNoteDocument(Array.from({ length: 8 }, () => line(false)), Array.from({ length: 10 }, (_, i) => ret(i))).length, 2, '8 lines + 10 returns continue onto a second page');
  // Rendered: every page keeps the DRAFT and VOID stamps; money totals only on the final page.
  const h = await boot(); const { w } = h;
  try {
    const record = { no: 'CN-P', date: '2026-09-20', branch: 'ubon', customer: 'ลูกค้า', reasonCode: 'returned_goods', vatMode: 'add', status: 'voided', voided: true, previewOnly: true,
      lines: Array.from({ length: 8 }, (_, i) => ({ invoiceNo: `INV-${i}`, invoiceDate: '2026-09-01', originalValue: 1000, correctValue: 900, difference: 100 })),
      returnItems: Array.from({ length: 10 }, (_, i) => ({ invoiceNo: 'INV-0', product: `สินค้าคืน ${i}`, qty: 1, unit: 'ชิ้น' })),
      originalValue: 8000, correctValue: 7200, subtotal: 800, vatAmt: 56, total: 856.00 };
    const box = w.document.createElement('div'); box.innerHTML = w.ComformCreditNoteDocument.buildHtml(record, 'original');
    const pages = [...box.querySelectorAll('.cn-doc-page')];
    assert.equal(pages.length, 2);
    pages.forEach(p => { assert.ok(p.querySelector('.cn-doc-draft-stamp')); assert.ok(p.querySelector('.cn-doc-void-stamp')); });
    const returned = pages.map(p => p.querySelectorAll('.cn-doc-return-table tbody tr').length);
    assert.equal(returned[0] + returned[1], 10);
    assert.ok(returned[1] > 0, 'returned goods continue on page 2');
    assert.equal(pages[1].querySelector('.cn-doc-table:not(.cn-doc-return-table)'), null, 'continuation page carries only the returned goods');
    assert.equal(pages[0].querySelector('.cn-doc-grand strong').textContent, '');
    assert.equal(pages[1].querySelector('.cn-doc-grand strong').textContent, '856.00');
    assert.match(pages[0].textContent, /มีรายการต่อหน้าถัดไป \(2\/2\)/);
  } finally { h.close(); }
});

test('fix6#5: dedupeLocalYear keeps the first copy of a credit note and never revives a voided one', async () => {
  const h = await boot(); const { w } = h;
  try {
    const live = { id: 'CN-D', no: 'CN6909-D', date: '2026-09-10', branch: 'ubon', customer: 'ลูกค้า', reasonCode: 'price_overcharge', lines: [{ invoiceId: 1, invoiceNo: 'INV-1', total: 107 }], subtotal: 100, vatAmt: 7, total: 107, status: 'issued', voided: false };
    const voided = { ...live, status: 'voided', voided: true, voidedAt: '2026-09-12T00:00:00.000Z', voidReason: 'ออกผิด' };
    // Voided copy first (September), a stale live copy with other figures in another month (from a cloud write / legacy restore).
    const sep = w.loadFor('ubon', 2026, 8); sep.creditNotes = [voided]; w.saveFor('ubon', 2026, 8, sep);
    const oct = w.loadFor('ubon', 2026, 9); oct.creditNotes = [{ ...live, total: 999, subtotal: 933.64 }]; w.saveFor('ubon', 2026, 9, oct);
    w.dedupeLocalYear(2026);
    let all = [...Array(12).keys()].flatMap(m => w.loadFor('ubon', 2026, m).creditNotes || []);
    assert.equal(all.length, 1);
    assert.deepEqual([all[0].voided, all[0].status, all[0].total], [true, 'voided', 107], 'still voided, original figures');
    // Live first, voided copy second: the void (one-way) is applied, financial fields stay.
    const s2 = w.loadFor('ubon', 2026, 8); s2.creditNotes = [live]; w.saveFor('ubon', 2026, 8, s2);
    const o2 = w.loadFor('ubon', 2026, 9); o2.creditNotes = [{ ...voided, total: 5 }]; w.saveFor('ubon', 2026, 9, o2);
    w.dedupeLocalYear(2026);
    all = [...Array(12).keys()].flatMap(m => w.loadFor('ubon', 2026, m).creditNotes || []);
    assert.equal(all.length, 1);
    assert.deepEqual([all[0].voided, all[0].voidReason, all[0].total], [true, 'ออกผิด', 107]);
  } finally { h.close(); }
});

test('fix6#6: voiding a credit note of an earlier VAT month asks for explicit confirmation (ภ.พ.30 ยื่นเพิ่มเติม); declining changes nothing', async () => {
  const h = await boot(); const { w } = h;
  try {
    const sh = await imp('erp-shared-core.js');
    const today = sh.localDateISO();
    const [ty, tm] = today.split('-').map(Number);
    const py = tm === 1 ? ty - 1 : ty, pm = tm === 1 ? 11 : tm - 2;          // previous month (0-based)
    const date = `${py}-${String(pm + 1).padStart(2, '0')}-10`;
    const invoice = uiInvoice(661, 'INV-PREV', { date });
    const calc = (await imp('erp-credit-note-core.js')).calculateCreditNote({ lines: [{ invoice: { ...invoice, _year: py, _month: pm }, differenceAmount: 100 }] });
    const d = w.loadFor('ubon', py, pm); d.invoices = [invoice]; d.creditNotes = [{ id: 9661, no: 'CN-PREV', date, branch: 'ubon', customer: invoice.customer, reasonCode: 'price_overcharge', lines: calc.lines, subtotal: calc.subtotal, vatAmt: calc.vatAmt, total: calc.total, vatMode: 'add', status: 'issued', voided: false }]; w.saveFor('ubon', py, pm, d);
    const before = JSON.stringify(w.loadFor('ubon', py, pm).creditNotes);
    const asked = [];
    w.confirm = message => { asked.push(message); return false; };
    assert.equal(await w.ERPCreditNotes.voidCreditNote('ubon', py, pm, 9661, 'ออกผิด'), false);
    assert.equal(asked.length, 1);
    assert.match(asked[0], /ภ\.พ\.30/); assert.match(asked[0], /ยื่นแบบ ภ\.พ\.30 เพิ่มเติม|ยื่นเพิ่มเติม/); assert.match(asked[0], /CN-PREV/);
    assert.equal(JSON.stringify(w.loadFor('ubon', py, pm).creditNotes), before, 'declined: the note is unchanged');
    w.confirm = message => { asked.push(message); return true; };
    assert.equal(await w.ERPCreditNotes.voidCreditNote('ubon', py, pm, 9661, 'ออกผิด'), true);
    assert.equal(w.loadFor('ubon', py, pm).creditNotes[0].voided, true);
    // A note of the current month is voided without the extra question.
    const inv2 = uiInvoice(662, 'INV-NOW', { date: today });
    const calc2 = (await imp('erp-credit-note-core.js')).calculateCreditNote({ lines: [{ invoice: { ...inv2, _year: ty, _month: tm - 1 }, differenceAmount: 100 }] });
    const cur = w.loadFor('ubon', ty, tm - 1); cur.invoices = [...(cur.invoices || []), inv2]; cur.creditNotes = [...(cur.creditNotes || []), { id: 9662, no: 'CN-NOW', date: today, branch: 'ubon', customer: inv2.customer, reasonCode: 'price_overcharge', lines: calc2.lines, subtotal: calc2.subtotal, vatAmt: calc2.vatAmt, total: calc2.total, vatMode: 'add', status: 'issued', voided: false }]; w.saveFor('ubon', ty, tm - 1, cur);
    asked.length = 0;
    assert.equal(await w.ERPCreditNotes.voidCreditNote('ubon', ty, tm - 1, 9662, 'ออกผิด'), true);
    assert.equal(asked.length, 0);
  } finally { h.close(); }
});

test('fix6#7: the credit-note invoice picker uses one indexed payment context per refresh with identical option text', async () => {
  const h = await boot(); const { w } = h;
  try {
    const cnCore = await imp('erp-credit-note-core.js');
    const d = w.loadFor('ubon', 2026, 8);
    d.invoices = [uiInvoice(771, 'INV-P1'), uiInvoice(772, 'INV-P2'), uiInvoice(773, 'INV-P3'), uiInvoice(774, 'INV-P4')];
    d.receipts = [{ id: 781, no: 'RC-1', branch: 'ubon', date: '2026-09-06', invoiceId: 772, invNo: 'INV-P2', customer: 'ลูกค้าทดสอบ', total: 1070 }, { id: 782, no: 'RC-2', branch: 'ubon', date: '2026-09-06', invoiceId: 773, invNo: 'INV-P3', customer: 'ลูกค้าทดสอบ', total: 300 }];
    d.creditNotes = [{ ...(await storedCreditNote(cnCore, { ...uiInvoice(774, 'INV-P4'), _year: 2026, _month: 8 }, 1000)), id: 'CN-P4', no: 'CN-P4' }];
    w.saveFor('ubon', 2026, 8, d);
    w.go('credit-note-form'); w.ERPCreditNotes.reset(); w.ERPCreditNotes.setBranch('ubon');
    w.document.getElementById('cn-inv-filter-year').value = '2026';
    const I = w.ERPIntegrity, realContext = I.paymentContext, realSummary = I.paymentSummary;
    let contexts = 0, unindexed = 0, summaries = 0;
    I.paymentContext = (...a) => { contexts += 1; return realContext(...a); };
    I.paymentSummary = (inv, opts) => { summaries += 1; if (!opts?.index) unindexed += 1; return realSummary(inv, opts); };
    const refresh = () => { contexts = unindexed = summaries = 0; const s = w.document.getElementById('cn-inv-filter-search'); s.value = 'INV-P'; fire(w, s); return [...w.document.getElementById('cn-inv-ref').options].map(o => `${o.textContent}|${o.disabled}`); };
    try {
      const withContext = refresh();
      assert.equal(contexts, 1, 'one payment context per keystroke');
      assert.equal(unindexed, 0, 'every summary uses the index');
      assert.equal(summaries, 4);
      I.paymentContext = undefined;                                         // no context: per-row full scans
      const perRow = refresh();
      assert.deepEqual(withContext, perRow);
      assert.ok(withContext.some(t => /ชำระแล้ว/.test(t)) && withContext.some(t => /ชำระบางส่วน/.test(t)) && withContext.some(t => /ลดหนี้เต็มจำนวน/.test(t)), withContext.join('\n'));
    } finally { I.paymentContext = realContext; I.paymentSummary = realSummary; }
  } finally { h.close(); }
});

test('fix7#2: the credit-note print window cancels the app body padding that pushed an A4 page onto a blank extra sheet', async () => {
  const h = await boot(); const { w } = h;
  try {
    let written = '';
    w.open = () => ({ opener: w, document: { write: html => { written += html; }, close() {} } });
    const record = { no: 'CN-PRINT', date: '2026-09-20', branch: 'ubon', customer: 'ลูกค้า', reasonCode: 'price_overcharge', vatMode: 'add', status: 'issued',
      lines: [{ invoiceNo: 'INV-1', invoiceDate: '2026-09-01', originalValue: 1000, correctValue: 900, difference: 100 }],
      originalValue: 1000, correctValue: 900, subtotal: 100, vatAmt: 7, total: 107 };
    assert.equal(w.ComformCreditNoteDocument.print(record, 'current', 'original'), true);
    // style.css sets `body{padding-bottom:calc(76px + ...) !important}` for the mobile nav; the print
    // window reuses that stylesheet, so its own override must be !important and more specific.
    assert.match(written, /<body class="cn-doc-print-body">/);
    assert.match(written, /body\.cn-doc-print-body\{margin:0!important;padding:0!important\}/);
    assert.equal((written.match(/class="cn-doc-page"/g) || []).length, 1, 'one-line note prints exactly one page');
  } finally { h.close(); }
});
