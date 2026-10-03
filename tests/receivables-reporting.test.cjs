// Receivables (AR) & management reporting coverage — ADR-010.
//   Part A: every report reads one outstanding balance (ERPIntegrity.paymentSummary):
//     credit notes (voided ones ignored), WHT receipts, billing-payment allocations,
//     RECONCILE_TOLERANCE dust, walk-in cash sales; branch profit / breakdowns /
//     ABC / sales targets net of credit notes in the credit note's own month.
//   Part B: AR aging report, dashboard banner and navigation badge (jsdom), incl.
//     refresh after a real receipt save and a real credit-note save.
// Every assertion uses hand-computed figures (see the comments next to them).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { boot } = require('./dom-helper.cjs');

const ROOT = path.resolve(__dirname, '..');
const imp = file => import(pathToFileURL(path.join(ROOT, file)).href + '?t=' + Date.now() + Math.random());
const GENERAL = 'ลูกค้าทั่วไป / เงินสด';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function waitFor(check, tries = 80) { for (let i = 0; i < tries && !check(); i++) await new Promise(r => setTimeout(r, 25)); return check(); }
function fire(w, el, type = 'input') { el.dispatchEvent(new w.Event(type, { bubbles: true })); }
const text = el => String(el?.textContent || '').replace(/\s+/g, ' ').trim();
// Arrays/objects built inside the jsdom window belong to another realm; compare them as plain JSON data.
const plain = value => JSON.parse(JSON.stringify(value));

// Stores a record in the pack of its own business month (as the app does).
function put(w, branch, collection, row) {
  const [year, month] = String(row.date).split('-').map(Number);
  const pack = w.loadFor(branch, year, month - 1);
  pack[collection] = [...(pack[collection] || []), row];
  w.saveFor(branch, year, month - 1, pack);
}
const invoice = (id, no, date, over = {}) => ({
  id, no, branch: 'ubon', date, customer: 'บริษัท ลูกค้า ก จำกัด', salesPerson: 'สมชาย', subtotal: 1000, vatAmt: 70, total: 1070, useVat: 1, vatMode: 'add', creditTerm: 'credit30',
  items: [{ product: 'สินค้า A', productCode: 'A1', qty: 10, unit: 'ชิ้น', priceUnit: 100, saleTotal: 1000, costTotal: 600 }], costTotal: 600, paymentManaged: true, ...over
});
// A stored credit note exactly as erp-credit-note-core builds it.
function creditNote(core, inv, differenceAmount, over = {}) {
  const [year, month] = String(inv.date).split('-').map(Number);
  const calc = core.calculateCreditNote({ lines: [{ invoice: { ...inv, _year: year, _month: month - 1 }, differenceAmount }] });
  return { id: `CN-${inv.id}-${differenceAmount}`, no: `CN-${inv.no}-${differenceAmount}`, date: inv.date, branch: inv.branch, customer: inv.customer, reasonCode: 'price_overcharge', reasonLabel: 'x', lines: calc.lines, invoiceNos: [inv.no], subtotal: calc.subtotal, vatAmt: calc.vatAmt, total: calc.total, vatMode: calc.vatMode, returnItems: [], status: 'issued', voided: false, ...over };
}

// ================================================================ core: due dates
test('core: one due-date rule — stored due date, credit term, BE/DMY dates, walk-in and no-term invoices', async () => {
  const c = await imp('erp-receivables-core.js');
  assert.deepEqual(c.invoiceDueDateInfo({ date: '2026-08-15', creditTerm: 'credit30' }), { dueDate: '2026-09-14', basis: 'term' });
  assert.deepEqual(c.invoiceDueDateInfo({ date: '2569-08-15', creditTerm: 'credit60' }), { dueDate: '2026-10-14', basis: 'term' }, 'Buddhist-era year is read as CE');
  assert.deepEqual(c.invoiceDueDateInfo({ date: '15/08/2569', dueDate: '2026-09-30', creditTerm: 'credit90' }), { dueDate: '2026-09-30', basis: 'explicit' }, 'a stored due date wins');
  assert.deepEqual(c.invoiceDueDateInfo({ date: '2026-08-15', dueDate: '31/10/2569' }), { dueDate: '2026-10-31', basis: 'explicit' });
  assert.deepEqual(c.invoiceDueDateInfo({ date: '2026-09-01', creditTerm: 'cash' }), { dueDate: '2026-09-01', basis: 'term' });
  assert.deepEqual(c.invoiceDueDateInfo({ date: '2026-09-01', taxInvoiceForm: 'abbreviated', customer: GENERAL }), { dueDate: '2026-09-01', basis: 'cash_sale' });
  assert.deepEqual(c.invoiceDueDateInfo({ date: '2026-09-01', taxInvoiceForm: 'abbreviated', customer: '' }), { dueDate: '2026-09-01', basis: 'cash_sale' });
  assert.deepEqual(c.invoiceDueDateInfo({ date: '2026-09-01', taxInvoiceForm: 'abbreviated', customer: 'คุณสมศรี' }), { dueDate: '2026-09-01', basis: 'no_term' });
  assert.deepEqual(c.invoiceDueDateInfo({ date: '2026-09-01', creditTerm: 'credit45' }), { dueDate: '2026-09-01', basis: 'no_term' }, 'unknown term = due on the invoice date');
  assert.deepEqual(c.invoiceDueDateInfo({ date: '' }), { dueDate: '', basis: 'none' });
  assert.deepEqual(c.invoiceDueDateInfo({}), { dueDate: '', basis: 'none' });
  assert.equal(c.invoiceTermDueDate('2026-12-15', 'credit30'), '2027-01-14', 'crosses the year end without timezone drift');
  assert.equal(c.invoiceTermDueDate('2026-08-15', ''), '');
  assert.deepEqual(c.receivableState(3), { state: 'overdue', text: 'เกินกำหนด 3 วัน' });
  assert.deepEqual(c.receivableState(0), { state: 'dueToday', text: 'ครบกำหนดวันนี้' });
  assert.deepEqual(c.receivableState(-7), { state: 'soon', text: 'ใกล้ครบกำหนด 7 วัน' });
  assert.deepEqual(c.receivableState(-8), { state: 'normal', text: 'ยังไม่ครบกำหนด (อีก 8 วัน)' });
  assert.deepEqual(c.receivableState(null), { state: 'none', text: 'ไม่ระบุวันครบกำหนด' });
});

// ================================================================ core: aging
test('core: standard aging buckets, sort order, dust/voided/settled skipped and satang-exact customer totals', async () => {
  const c = await imp('erp-receivables-core.js');
  const row = (no, dueDate, outstanding, over = {}) => ({ id: no, no, branch: 'ubon', date: '2026-05-01', dueDate, customer: 'ลูกค้า X', outstanding, ...over });
  const items = c.buildReceivableItems([
    row('A', '2026-09-25', 100),            // -4 days → current / soon
    row('B', '2026-09-21', 200),            //  0 days → current / dueToday
    row('C', '2026-09-01', 0.1),            // 20 days → 1–30
    row('C2', '2026-09-01', 0.2),           // 20 days → 1–30 (0.1 + 0.2 must be exactly 0.30)
    row('D', '2026-08-01', 400.2, { customer: 'ลูกค้า Y' }),  // 51 → 31–60
    row('E', '2026-07-15', 500, { customer: 'ลูกค้า Y' }),    // 68 → 61–90
    row('F', '2026-06-01', 600, { customer: 'ลูกค้า Y' }),    // 112 → over 90
    row('G', '', 700, { date: 'ไม่ทราบ', customer: 'ลูกค้า Z' }), // no usable date → undated
    row('H', '2026-06-01', 0.01),           // rounding dust (≤ RECONCILE_TOLERANCE) is settled
    row('I', '2026-06-01', 999, { voided: true }),
    row('J', '2026-06-01', 0)
  ], { asOf: '2026-09-21' });
  assert.deepEqual(items.map(i => [i.no, i.daysPastDue, i.bucket, i.state]), [
    ['F', 112, 'over_90', 'overdue'], ['E', 68, '61_90', 'overdue'], ['D', 51, '31_60', 'overdue'], ['C2', 20, '1_30', 'overdue'], ['C', 20, '1_30', 'overdue'],
    ['B', 0, 'current', 'dueToday'], ['A', -4, 'current', 'soon'], ['G', null, 'undated', 'none']
  ]);
  const aging = c.summarizeReceivableAging(items);
  assert.deepEqual(aging.totals.buckets, { current: 300, '1_30': 0.3, '31_60': 400.2, '61_90': 500, over_90: 600, undated: 700 });
  assert.equal(aging.totals.total, 2500.5);
  assert.equal(aging.totals.overdue, 1500.5);
  assert.deepEqual([aging.totals.invoiceCount, aging.totals.customerCount, aging.hasUndated], [8, 3, true]);
  assert.deepEqual(aging.rows.map(r => [r.label, r.invoiceCount, r.total, r.overdue, r.oldestDaysPastDue]), [
    ['ลูกค้า Y', 3, 1500.2, 1500.2, 112], ['ลูกค้า X', 4, 300.3, 0.3, 20], ['ลูกค้า Z', 1, 700, 0, null]
  ]);
  assert.equal(aging.rows[1].buckets['1_30'], 0.3);
  const alert = c.receivableAlertSummary(items);
  assert.deepEqual([alert.overdueCount, alert.overdueTotal, alert.dueSoonCount, alert.dueSoonTotal, alert.oldestDaysPastDue], [5, 1500.5, 2, 300, 112]);
  // Counts + satang, then hashes of the overdue / due-soon invoice keys (review#5).
  assert.match(alert.signature, /^5\|150050\|2\|30000\|[0-9a-z]+\|[0-9a-z]+$/);
  // CSV: header, one row per invoice, grand total with the exact bucket sums.
  const csv = c.receivableAgingCsvRows(aging, { formatDate: v => `d:${v}` });
  assert.deepEqual(csv[0], ['ลูกค้า', 'เลขที่บิล', 'สาขา', 'วันที่บิล', 'วันครบกำหนด', 'เกณฑ์วันครบกำหนด', 'เกินกำหนด (วัน)', 'ยังไม่ถึงกำหนด', '1–30 วัน', '31–60 วัน', '61–90 วัน', 'เกิน 90 วัน', 'ไม่ระบุวันครบกำหนด', 'ค้างรับรวม']);
  assert.equal(csv.length, 10);
  assert.deepEqual(csv[1], ['ลูกค้า Y', 'F', 'ubon', 'd:2026-05-01', 'd:2026-06-01', 'ตามวันครบกำหนดในบิล', 112, 0, 0, 0, 0, 600, 0, 600]);
  assert.deepEqual(csv[9], ['รวมทั้งหมด', '', '', '', '', '', '', 300, 0.3, 400.2, 500, 600, 700, 2500.5]);
});

test('core: walk-in cash sales are one aggregated aging row and never a named customer', async () => {
  const c = await imp('erp-receivables-core.js');
  const items = c.buildReceivableItems([
    { id: 1, no: 'AB-1', date: '2026-09-18', taxInvoiceForm: 'abbreviated', customer: GENERAL, outstanding: 535 },
    { id: 2, no: 'AB-2', date: '2026-09-21', taxInvoiceForm: 'abbreviated', customer: '', outstanding: 214 },
    { id: 3, no: 'INV-3', date: '2026-09-01', creditTerm: 'credit30', customer: 'บริษัท เอ', outstanding: 1070 }
  ], { asOf: '2026-09-21' });
  assert.deepEqual(items.map(i => [i.no, i.walkIn, i.dueDate, i.dueBasis, i.daysPastDue]), [
    ['AB-1', true, '2026-09-18', 'cash_sale', 3], ['AB-2', true, '2026-09-21', 'cash_sale', 0], ['INV-3', false, '2026-10-01', 'term', -10]
  ]);
  const aging = c.summarizeReceivableAging(items);
  assert.deepEqual(aging.rows.map(r => [r.key, r.label, r.walkIn, r.invoiceCount, r.total, r.buckets.current, r.buckets['1_30']]), [
    [c.WALK_IN_CUSTOMER_KEY, c.WALK_IN_CUSTOMER_LABEL, true, 2, 749, 214, 535],
    ['บริษัท เอ', 'บริษัท เอ', false, 1, 1070, 1070, 0]
  ]);
  assert.deepEqual([aging.totals.customerCount, aging.totals.walkInInvoiceCount, aging.totals.total], [1, 2, 1819]);
});

test('core: largest-remainder money allocation adds up exactly (signed weights, zero weights, negative totals)', async () => {
  const c = await imp('erp-receivables-core.js');
  assert.deepEqual(c.allocateMoneyByWeights(100, [1, 1, 1]), [33.34, 33.33, 33.33]);
  assert.deepEqual(c.allocateMoneyByWeights(-100, [1, 1, 1]), [-33.33, -33.33, -33.34]);
  assert.deepEqual(c.allocateMoneyByWeights(200, [600, 400]), [120, 80]);
  assert.deepEqual(c.allocateMoneyByWeights(900, [1000, -100]), [1000, -100], 'a legacy discount line stays negative');
  assert.deepEqual(c.allocateMoneyByWeights(10, [0, 0]), [5, 5]);
  assert.deepEqual(c.allocateMoneyByWeights(0.01, [1, 1, 1]), [0.01, 0, 0]);
  assert.deepEqual(c.allocateMoneyByWeights(5, []), []);
  const parts = c.allocateMoneyByWeights(1000, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(Math.round(parts.reduce((s, v) => s + v, 0) * 100), 100000);
});

test('core: credit notes become negative sales rows per product — pro-rata, returned goods with cost, multi-invoice, voided', async () => {
  const c = await imp('erp-receivables-core.js');
  const cn = await imp('erp-credit-note-core.js');
  const inv = { id: 'I1', no: 'INV-1', branch: 'ubon', date: '2026-09-01', customer: 'โรงพยาบาลทดสอบ', salesPerson: 'สุดา', customerAgencyGroup: 'hospital', subtotal: 1000, vatAmt: 70, total: 1070, useVat: 1, vatMode: 'add',
    items: [{ product: 'สินค้า A', productCode: 'A1', qty: 6, unit: 'ชิ้น', priceUnit: 100, saleTotal: 600, costTotal: 360 }, { product: 'สินค้า B', productCode: 'B1', qty: 4, unit: 'ชิ้น', priceUnit: 100, saleTotal: 400, costTotal: 240 }] };
  const inv2 = { id: 'I2', no: 'INV-2', branch: 'ubon', date: '2026-09-02', customer: 'โรงพยาบาลทดสอบ', salesPerson: 'สุดา', subtotal: 500, vatAmt: 35, total: 535, useVat: 1, vatMode: 'add', items: [{ product: 'สินค้า C', qty: 5, priceUnit: 100, saleTotal: 500, costTotal: 100 }] };
  const byId = { I1: inv, I2: inv2 };
  const resolve = ref => byId[ref.invoiceId] || null;
  const note = (lines, over = {}) => { const calc = cn.calculateCreditNote({ lines }); return { id: 'CN1', no: 'CN-1', date: '2026-09-20', branch: 'ubon', customer: 'ผู้ซื้อที่พิมพ์ในใบลดหนี้', reasonCode: 'price_overcharge', lines: calc.lines, subtotal: calc.subtotal, vatAmt: calc.vatAmt, total: calc.total, status: 'issued', voided: false, _branch: 'ubon', _year: 2026, _month: 8, ...over }; };

  // Price overcharge 200 → spread by item value 600:400 → A −120, B −80; no cost reversal.
  const [overcharge] = c.buildCreditNoteSalesAdjustments([note([{ invoice: inv, differenceAmount: 200 }])], resolve);
  assert.deepEqual([overcharge._type, overcharge._creditAdjustment, overcharge.subtotal, overcharge.costTotal, overcharge.profit, overcharge.customer, overcharge.salesPerson, overcharge.customerAgencyGroup, overcharge._year, overcharge._month, overcharge.date],
    ['creditNotes', true, -200, 0, -200, 'โรงพยาบาลทดสอบ', 'สุดา', 'hospital', 2026, 8, '2026-09-20']);
  assert.deepEqual(overcharge.items.map(i => [i.product, i.qty, i.saleTotal, i.costTotal]), [['สินค้า A', 0, -120, 0], ['สินค้า B', 0, -80, 0]]);

  // Returned goods: 2 × B returned for 200 → the whole credit lands on B; cost 2 × 60 = 120 reversed; profit −200 + 120 = −80.
  const [returned] = c.buildCreditNoteSalesAdjustments([note([{ invoice: inv, differenceAmount: 200 }], { reasonCode: 'returned_goods', returnItems: [{ invoiceId: 'I1', invoiceNo: 'INV-1', invoiceBranch: 'ubon', productCode: 'B1', product: 'สินค้า B', qty: 2 }] })], resolve);
  assert.deepEqual(returned.items.map(i => [i.product, i.qty, i.saleTotal, i.costTotal]), [['สินค้า B', -2, -200, -120]]);
  assert.deepEqual([returned.subtotal, returned.costTotal, returned.profit], [-200, -120, -80]);

  // One note for two invoices (same customer): 200 + 100 = 300 → one row per invoice line.
  const multi = c.buildCreditNoteSalesAdjustments([note([{ invoice: inv, differenceAmount: 200 }, { invoice: inv2, differenceAmount: 100 }])], resolve);
  assert.deepEqual(multi.map(r => [r.invoiceNo, r.subtotal, r.items.map(i => i.saleTotal).join('|')]), [['INV-1', -200, '-120|-80'], ['INV-2', -100, '-100']]);
  // Voided / cancelled notes never reduce anything.
  assert.deepEqual(c.buildCreditNoteSalesAdjustments([note([{ invoice: inv, differenceAmount: 200 }], { voided: true }), note([{ invoice: inv, differenceAmount: 50 }], { status: 'cancelled' })], resolve), []);
  // Unresolvable reference: the value still counts, attributed to the note's customer, no product lines.
  const [orphan] = c.buildCreditNoteSalesAdjustments([note([{ invoice: inv, differenceAmount: 200 }])], () => null);
  assert.deepEqual([orphan.subtotal, orphan.customer, orphan.items.length], [-200, 'ผู้ซื้อที่พิมพ์ในใบลดหนี้', 0]);
});

test('core: branch gross profit / margins never divide by zero', async () => {
  const c = await imp('erp-receivables-core.js');
  assert.deepEqual(c.branchProfitSummary({ sales: 800, cost: 480, commission: 0, expenses: 50 }), { sales: 800, cost: 480, commission: 0, expenses: 50, grossProfit: 320, grossMargin: 40, net: 270, netMargin: 33.75 });
  const empty = c.branchProfitSummary({ sales: 0, cost: 0 });
  assert.deepEqual([empty.grossMargin, empty.netMargin], [null, null]);
  assert.deepEqual([c.branchProfitSummary({ sales: -50 }).grossMargin, c.formatMarginPercent(null), c.formatMarginPercent(33.75), c.formatMarginPercent(NaN)], [null, '—', '33.8%', '—']);
});

// ================================================================ Part A (jsdom, real app + ERPIntegrity)
test('Part A: one outstanding balance everywhere — credit notes (voided ignored), WHT, combined payment, dust, walk-in', async () => {
  const h = await boot(); const { w } = h;
  try {
    const shared = await imp('erp-shared-core.js');
    const cnCore = await imp('erp-credit-note-core.js');
    const today = shared.localDateISO(), day = n => shared.addBusinessCalendarDays(today, n);
    const invCn = invoice(1001, 'INV-CN', day(-45));               // due day(-15) → 15 days overdue
    const invFull = invoice(1002, 'INV-FULL', day(-45));
    const invWht = invoice(1003, 'INV-WHT', day(-40));
    const invP1 = invoice(1004, 'INV-P1', day(-50));
    const invP2 = invoice(1005, 'INV-P2', day(-50), { subtotal: 2000, vatAmt: 140, total: 2140 }); // due day(-20)
    const invDust = invoice(1006, 'INV-DUST', day(-45));
    const walk1 = invoice(1007, 'INV-W1', day(-3), { taxInvoiceForm: 'abbreviated', customer: GENERAL, creditTerm: '', salesPerson: '', subtotal: 500, vatAmt: 35, total: 535, useVat: 0, vatMode: 'extract' });
    const walk2 = invoice(1008, 'INV-W2', today, { taxInvoiceForm: 'abbreviated', customer: '', creditTerm: '', salesPerson: '', subtotal: 200, vatAmt: 14, total: 214, useVat: 0, vatMode: 'extract' });
    for (const inv of [invCn, invFull, invWht, invP1, invP2, invDust, walk1, walk2]) put(w, 'ubon', 'invoices', inv);
    put(w, 'ubon', 'creditNotes', creditNote(cnCore, invCn, 200));                                   // 214 incl. VAT
    put(w, 'ubon', 'creditNotes', creditNote(cnCore, invCn, 100, { voided: true, status: 'voided' })); // must NOT reduce
    put(w, 'ubon', 'creditNotes', creditNote(cnCore, invFull, 1000));                                // 1070 → fully credited
    put(w, 'ubon', 'receipts', { id: 5003, no: 'RC-WHT', date: day(-10), invNo: 'INV-WHT', invoiceId: 1003, invoiceBranch: 'ubon', customer: invWht.customer, subtotal: 1000, vatAmt: 70, total: 1070, whtRate: 3, whtBase: 1000, whtAmount: 30, cashReceived: 1040, items: [{ product: 'รับชำระ', qty: 1, priceUnit: 1070, saleTotal: 1070 }] });
    put(w, 'ubon', 'receipts', { id: 5006, no: 'RC-DUST', date: day(-5), invNo: 'INV-DUST', invoiceId: 1006, invoiceBranch: 'ubon', customer: invDust.customer, subtotal: 999.99, vatAmt: 70, total: 1069.99, items: [{ product: 'รับชำระ', qty: 1, priceUnit: 1069.99, saleTotal: 1069.99 }] });
    // One billing payment of 2,070 settles INV-P1 (1,070) and part of INV-P2 (1,000); its printable receipts are evidence only.
    w.ERPOrderFlow.importData({ payments: [{ id: 'PAY-1', no: 'PAY-1', date: day(-8), branch: 'ubon', customer: invP1.customer, amount: 2070, method: 'โอนเงิน', createdAt: `${day(-8)}T10:00:00.000Z`,
      allocations: [{ invoiceId: 1004, invoiceNo: 'INV-P1', branch: 'ubon', amount: 1070 }, { invoiceId: 1005, invoiceNo: 'INV-P2', branch: 'ubon', amount: 1000 }] }] });
    put(w, 'ubon', 'receipts', { id: 5104, no: 'RC-P1', date: day(-8), paymentId: 'PAY-1', invNo: 'INV-P1', invoiceId: 1004, invoiceBranch: 'ubon', customer: invP1.customer, total: 1070, subtotal: 1000, items: [] });
    put(w, 'ubon', 'receipts', { id: 5105, no: 'RC-P2', date: day(-8), paymentId: 'PAY-1', invNo: 'INV-P2', invoiceId: 1005, invoiceBranch: 'ubon', customer: invP2.customer, total: 1000, subtotal: 934.58, items: [] });
    await tick();

    const I = w.ERPIntegrity, biz = I.business(), find = no => biz.invoices.find(i => i.no === no);
    const s = no => I.paymentSummary(find(no));
    assert.deepEqual(plain([s('INV-CN').credited, s('INV-CN').outstanding]), [214, 856], 'live credit note reduces, voided one does not');
    assert.deepEqual(plain([s('INV-FULL').status, s('INV-FULL').outstanding]), ['credited', 0]);
    assert.deepEqual(plain([s('INV-WHT').paid, s('INV-WHT').outstanding, s('INV-WHT').status]), [1070, 0, 'paid'], 'WHT receipt settles the full total');
    assert.deepEqual(plain([s('INV-P1').paid, s('INV-P1').outstanding]), [1070, 0]);
    assert.deepEqual(plain([s('INV-P2').paid, s('INV-P2').outstanding]), [1000, 1140], 'only its own allocation, not the whole payment');
    assert.deepEqual(plain([s('INV-DUST').paid, s('INV-DUST').outstanding, s('INV-DUST').status]), [1069.99, 0, 'paid'], '0.01 gap is rounding dust');

    // Dashboard-wide snapshot (erp-receivables.js) reads the same balances.
    const snap = w.ERPReceivables.snapshot('');
    assert.deepEqual(plain(snap.items.map(i => [i.no, i.outstanding, i.daysPastDue, i.bucket, i.state])), [
      ['INV-P2', 1140, 20, '1_30', 'overdue'], ['INV-CN', 856, 15, '1_30', 'overdue'], ['INV-W1', 535, 3, '1_30', 'overdue'], ['INV-W2', 214, 0, 'current', 'dueToday']
    ]);
    assert.deepEqual(plain(snap.aging.rows.map(r => [r.label, r.invoiceCount, r.total, r.overdue])), [['บริษัท ลูกค้า ก จำกัด', 2, 1996, 1996], ['ลูกค้าทั่วไป / เงินสด (รวมทุกบิลหน้าร้าน)', 2, 749, 535]]);
    assert.deepEqual(plain(snap.aging.totals.buckets), { current: 214, '1_30': 2531, '31_60': 0, '61_90': 0, over_90: 0, undated: 0 });
    assert.deepEqual(plain([snap.aging.totals.total, snap.aging.totals.customerCount, snap.alert.overdueCount, snap.alert.overdueTotal, snap.alert.dueSoonCount, snap.alert.dueSoonTotal, snap.alert.oldestDaysPastDue]), [2745, 1, 3, 2531, 1, 214, 20]);
    // Governance aging (Audit Log panel) uses the same due-date rule and balances.
    assert.equal(w.ERPGovernance.agingSnapshot(today).ar.total, 2745);

    // Analytics (period-scoped) AR table: invoices of the INV-CN month, balance after the live credit note only.
    const [y, m] = invCn.date.split('-').map(Number);
    const data = w.testApp.collectAnalyticsData({ branch: 'ubon', year: y, month: m - 1, agencyGroup: '', agencyType: '' });
    const ar = w.testApp.buildReceivableAgingRows(data);
    const rowCn = ar.find(r => r.docNo === 'INV-CN');
    assert.deepEqual(plain([rowCn.delivery, rowCn.paid, rowCn.credited, rowCn.outstanding, rowCn.state, rowCn.bucket]), [1070, 0, 214, 856, 'overdue', 'เกินกำหนด 15 วัน']);
    assert.equal(ar.some(r => ['INV-FULL', 'INV-WHT', 'INV-P1', 'INV-DUST'].includes(r.docNo)), false, 'settled / credited / dust invoices are not receivables');
    // Legacy call shape still works (plain invoice list, no cached summary).
    assert.equal(w.testApp.buildReceivableAgingRows({ invoices: [{ ...find('INV-CN') }], receipts: [] })[0].outstanding, 856);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('Part A: branch profit nets credit notes in their own month and reverses returned-goods cost', async () => {
  const h = await boot(); const { w } = h;
  try {
    const cnCore = await imp('erp-credit-note-core.js');
    const a = invoice(2001, 'INV-BP1', '2025-04-10', { creditTerm: '' });                       // ubon April: 1,000 sales / 600 cost (A: 10 × 60)
    const k = invoice(2002, 'INV-KK1', '2025-04-11', { branch: 'khonkaen', subtotal: 500, vatAmt: 35, total: 535, costTotal: 200, items: [{ product: 'สินค้า K', qty: 5, priceUnit: 100, saleTotal: 500, costTotal: 200 }] });
    const march = invoice(2003, 'INV-BP2', '2025-03-12', { subtotal: 300, vatAmt: 21, total: 321, costTotal: 100, items: [{ product: 'สินค้า B', productCode: 'B1', qty: 3, priceUnit: 100, saleTotal: 300, costTotal: 100 }] });
    put(w, 'ubon', 'invoices', a); put(w, 'khonkaen', 'invoices', k); put(w, 'ubon', 'invoices', march);
    // Returned goods: 2 × A back to stock, 200 pre-VAT (214 incl. VAT), issued in April.
    put(w, 'ubon', 'creditNotes', creditNote(cnCore, a, 200, { date: '2025-04-20', reasonCode: 'returned_goods', returnItems: [{ invoiceId: '2001', invoiceNo: 'INV-BP1', invoiceBranch: 'ubon', productCode: 'A1', product: 'สินค้า A', unit: 'ชิ้น', qty: 2 }] }));
    // Price overcharge on the March invoice, issued in May: May carries the −50, March is untouched.
    put(w, 'ubon', 'creditNotes', creditNote(cnCore, march, 50, { date: '2025-05-02' }));
    put(w, 'ubon', 'expenses', { id: 7001, date: '2025-04-25', amount: 50, desc: 'ค่าขนส่ง' });
    await tick();
    const stats = (br, month) => { const s = w.testApp.branchStats(br, 2025, month); return [s.st, s.ct, s.gp, s.gm, s.cm, s.ex, s.net, s.nm]; };
    // April ubon: sales 1000 − 200 = 800; cost 600 − 2 × 60 = 480; GP 320 (40%); net 320 − 50 = 270 (33.75%).
    assert.deepEqual(plain(stats('ubon', 3)), [800, 480, 320, 40, 0, 50, 270, 33.75]);
    assert.deepEqual(plain(stats('khonkaen', 3)), [500, 200, 300, 60, 0, 0, 300, 60]);
    assert.deepEqual(plain(stats('ubon', 2)), [300, 100, 200, 66.67, 0, 0, 200, 66.67], 'invoice month unchanged by a later credit note');
    assert.deepEqual(plain(stats('ubon', 4)), [-50, 0, -50, null, 0, 0, -50, null], 'credit-note month, no margin on non-positive sales');
    // Whole year: 1000 + 300 − 200 − 50 = 1050 sales; 600 + 100 − 120 = 580 cost; GP 470 (44.76%).
    assert.deepEqual(plain(stats('ubon', -1)), [1050, 580, 470, 44.76, 0, 50, 420, 40]);
    // Charts / analytics use the same figures as the tiles.
    const april = w.loadFor('ubon', 2025, 3);
    assert.equal(w.testApp.metricFromData(april, 'sales', 2025, 3, 'ubon'), 800);
    assert.equal(w.testApp.metricFromData(april, 'profit', 2025, 3, 'ubon'), 270);
    const k4 = w.testApp.buildAnalyticsKpis(w.testApp.collectAnalyticsData({ branch: 'ubon', year: 2025, month: 3, agencyGroup: '', agencyType: '' }), {});
    assert.deepEqual(plain([k4.sales, k4.cost, k4.grossProfit, k4.profit, k4.uncollected]), [800, 480, 320, 270, 856]);
    // Side-by-side dashboard comparison shows gross profit and margin per branch.
    const year = w.document.getElementById('dash-year');
    if (![...year.options].some(o => o.value === '2025')) year.add(new w.Option('2025', '2025'));
    year.value = '2025'; w.document.getElementById('dash-month').value = '3';
    w.switchDashTab('all');
    const ub = text(w.document.getElementById('dash-ub-rows')), kk = text(w.document.getElementById('dash-kk-rows'));
    assert.match(ub, /ยอดขายก่อน VAT \(หักใบลดหนี้\)฿800\.00/);
    assert.match(ub, /ต้นทุนขาย฿480\.00/);
    assert.match(ub, /กำไรขั้นต้น · อัตรากำไรขั้นต้น฿320\.00 · 40\.0%/);
    assert.match(ub, /กำไรสุทธิ · อัตรากำไรสุทธิ฿270\.00 · 33\.8%/);
    assert.match(kk, /กำไรขั้นต้น · อัตรากำไรขั้นต้น฿300\.00 · 60\.0%/);
    w.document.getElementById('dash-month').value = '4'; w.renderDash();
    assert.match(text(w.document.getElementById('dash-ub-rows')), /กำไรขั้นต้น · อัตรากำไรขั้นต้น฿-50\.00 · —/);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('Part A: customer / product / salesperson / agency breakdowns net credit notes like the tiles', async () => {
  const h = await boot(); const { w } = h;
  try {
    const cnCore = await imp('erp-credit-note-core.js');
    const hosp = invoice(3001, 'INV-BD1', '2025-06-05', { customer: 'โรงพยาบาลทดสอบ', salesPerson: 'สุดา', costTotal: 560,
      items: [{ product: 'สินค้า A', productCode: 'A1', qty: 6, unit: 'ชิ้น', priceUnit: 100, saleTotal: 600, costTotal: 360 }, { product: 'สินค้า B', productCode: 'B1', qty: 4, unit: 'ชิ้น', priceUnit: 100, saleTotal: 400, costTotal: 200 }] });
    const firm = invoice(3002, 'INV-BD2', '2025-06-06', { customer: 'บริษัท ข จำกัด', salesPerson: 'สุดา', subtotal: 500, vatAmt: 35, total: 535, costTotal: 300, items: [{ product: 'สินค้า A', productCode: 'A1', qty: 5, unit: 'ชิ้น', priceUnit: 100, saleTotal: 500, costTotal: 300 }] });
    put(w, 'ubon', 'invoices', hosp); put(w, 'ubon', 'invoices', firm);
    put(w, 'ubon', 'creditNotes', creditNote(cnCore, hosp, 200, { date: '2025-06-25' })); // price overcharge 200 → A −120, B −80
    await tick();
    const t = w.testApp;
    assert.equal(t.branchStats('ubon', 2025, 5).st, 1300);
    assert.deepEqual(plain(t.customerRows(2025, 5, ['ubon'], 'all', 'value').map(r => [r.label, r.value])), [['โรงพยาบาลทดสอบ', 800], ['บริษัท ข จำกัด', 500]]);
    assert.deepEqual(plain(t.customerRows(2025, 5, ['ubon'], 'invoices', 'value').map(r => [r.label, r.value])), [['โรงพยาบาลทดสอบ', 800], ['บริษัท ข จำกัด', 500]]);
    const products = t.buildDashboardProductCompare(2025, 5, ['ubon']);
    assert.deepEqual(plain(products.rows.map(r => [r.label, r.value, r.qty, r.count])), [['สินค้า A', 980, 11, 2], ['สินค้า B', 320, 4, 1]]);
    assert.equal(products.total, 1300);
    assert.equal(t.dashboardAgencyRows(2025, 5, ['ubon']).reduce((s, r) => s + r.value, 0), 1300);
    const leader = t.buildMonthlyCustomerLeaderRows(2025, ['ubon']).find(r => r.month === 5);
    assert.deepEqual(plain([leader.customer, leader.sales, leader.docs]), ['โรงพยาบาลทดสอบ', 800, 1]);
    // Analytics tables.
    const data = t.collectAnalyticsData({ branch: 'ubon', year: 2025, month: 5, agencyGroup: '', agencyType: '' });
    const customers = t.buildCustomerDeepRows(data);
    assert.deepEqual(plain(customers.map(r => [r.label, r.sales, r.count, r.profit, r.uncollected])), [['โรงพยาบาลทดสอบ', 800, 1, 240, 856], ['บริษัท ข จำกัด', 500, 1, 200, 535]]);
    assert.deepEqual(plain(t.buildProductDeepRows(data).map(r => [r.label, r.value, r.qty, r.count])), [['สินค้า A', 980, 11, 2], ['สินค้า B', 320, 4, 1]]);
    assert.deepEqual(plain(t.buildSalespersonRows(data).map(r => [r.label, r.sales, r.count, r.avgOrder, r.profit, r.customerCount])), [['สุดา', 1300, 2, 650, 440, 2]]);
    assert.equal(t.buildAgencyRows(data).reduce((s, r) => s + r.sales, 0), 1300);
    assert.equal(t.buildAgencyRows(data).reduce((s, r) => s + r.uncollected, 0), 1391);
    const k = t.buildAnalyticsKpis(data, {});
    assert.deepEqual(plain([k.sales, k.uncollected, k.customerCount, k.orderCount]), [1300, 1391, 2, 2]);
    // A voided credit note changes nothing.
    const pack = w.loadFor('ubon', 2025, 5); pack.creditNotes[0].voided = true; w.saveFor('ubon', 2025, 5, pack); await tick();
    assert.equal(t.branchStats('ubon', 2025, 5).st, 1500);
    assert.deepEqual(plain(t.buildProductDeepRows(t.collectAnalyticsData({ branch: 'ubon', year: 2025, month: 5, agencyGroup: '', agencyType: '' })).map(r => [r.label, r.value])), [['สินค้า A', 1100], ['สินค้า B', 400]]);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('Part A: walk-in cash sales are one row, not ranked as a customer (counts, ABC, leader, concentration insight)', async () => {
  const h = await boot(); const { w } = h;
  try {
    const walk = (id, no, date, over = {}) => invoice(id, no, date, { taxInvoiceForm: 'abbreviated', customer: GENERAL, creditTerm: '', subtotal: 500, vatAmt: 35, total: 535, useVat: 0, vatMode: 'extract', items: [{ product: 'สินค้า W', qty: 1, priceUnit: 535, saleTotal: 535 }], ...over });
    for (const inv of [walk(4001, 'AB-1', '2025-07-01'), walk(4002, 'AB-2', '2025-07-02'), walk(4003, 'AB-3', '2025-07-03'),
      invoice(4004, 'INV-C', '2025-07-04', { customer: 'บริษัท ค จำกัด', subtotal: 700, vatAmt: 49, total: 749, items: [{ product: 'สินค้า A', qty: 7, priceUnit: 100, saleTotal: 700 }] }),
      invoice(4005, 'INV-D', '2025-07-05', { customer: 'บริษัท ง จำกัด', subtotal: 200, vatAmt: 14, total: 214, items: [{ product: 'สินค้า A', qty: 2, priceUnit: 100, saleTotal: 200 }] }),
      invoice(4006, 'INV-E', '2025-07-06', { customer: 'บริษัท จ จำกัด', subtotal: 100, vatAmt: 7, total: 107, items: [{ product: 'สินค้า A', qty: 1, priceUnit: 100, saleTotal: 100 }] })]) put(w, 'ubon', 'invoices', inv);
    await tick();
    const t = w.testApp, data = t.collectAnalyticsData({ branch: 'ubon', year: 2025, month: 6, agencyGroup: '', agencyType: '' });
    const rows = t.buildCustomerDeepRows(data);
    // Walk-in 1,500 (60% of 2,500) is one aggregated row with no ABC class; named customers are ranked among themselves: 700/1000 = 70% A, 90% B, 100% C.
    assert.deepEqual(plain(rows.map(r => [r.label, r.sales, r.abc, r.cumulativePercent])), [[GENERAL, 1500, '-', null], ['บริษัท ค จำกัด', 700, 'A', 70], ['บริษัท ง จำกัด', 200, 'B', 90], ['บริษัท จ จำกัด', 100, 'C', 100]]);
    assert.equal(rows[0].contributionPercent, 60);
    assert.equal(t.buildAnalyticsKpis(data, {}).customerCount, 3, 'walk-in is not a distinct customer');
    const insights = t.buildAnalyticsInsights({ sales: 2500, netMargin: 50, deliveryRate: 100, delivery: 2500, collectionRate: 100 }, { total: 6, score: 100, issues: 0 }, { avg3: 0, current: null, volatility: 0 }, rows, {});
    assert.equal(insights.some(i => i.title === 'พึ่งพาลูกค้ารายใหญ่สูง'), false, 'walk-in cash sales are not "customer concentration"');
    const leader = t.buildMonthlyCustomerLeaderRows(2025, ['ubon']).find(r => r.month === 6);
    assert.deepEqual(plain([leader.customer, leader.sales]), ['บริษัท ค จำกัด', 700]);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('Part A: sales target actual is net of credit notes on their own date; cancelled production is ignored', async () => {
  const h = await boot(); const { w } = h;
  try {
    const cnCore = await imp('erp-credit-note-core.js');
    const d = w.loadFor('ubon', 2025, 7);
    d.productions = [{ id: 'PT-1', no: 'PT-1', date: '2025-08-05', customer: 'ลูกค้า', subtotal: 1000 }, { id: 'PT-X', no: 'PT-X', date: '2025-08-06', customer: 'ลูกค้า', subtotal: 900, status: 'cancelled' }];
    w.saveFor('ubon', 2025, 7, d);
    // The invoice delivers production PT-1, so its credit note reduces sales the target counted (review#1).
    const inv = invoice(5001, 'INV-T', '2025-08-10', { sourceProductionId: 'PT-1', sourceProductionNo: 'PT-1' });
    put(w, 'ubon', 'invoices', inv);
    put(w, 'ubon', 'creditNotes', creditNote(cnCore, inv, 200, { date: '2025-08-20' }));
    const year = w.document.getElementById('dash-year');
    if (![...year.options].some(o => o.value === '2025')) year.add(new w.Option('2025', '2025'));
    year.value = '2025'; w.document.getElementById('dash-month').value = '7';
    w.switchDashTab('all');
    const m = w.testApp.buildSalesTargetDashboard();
    assert.equal(m.actual, 800, '1000 production − 200 credit note; the cancelled 900 is not a sale');
    assert.equal(m.productions.length, 1);
    const aug20 = m.dayRows.find(r => r.date.getDate() === 20);
    const aug19 = m.dayRows.find(r => r.date.getDate() === 19);
    assert.deepEqual(plain([aug19.actual, aug20.actual]), [1000, 800], 'the credit note lowers the cumulative line on its own date');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

// ================================================================ Part B (jsdom UI)
test('Part B: dashboard banner, nav badge and AR aging report — totals, drill-down, CSV, dismiss, refresh after receipt and credit note saves', async () => {
  const h = await boot(); const { w } = h;
  try {
    const shared = await imp('erp-shared-core.js');
    const today = shared.localDateISO(), day = n => shared.addBusinessCalendarDays(today, n);
    const $ = id => w.document.getElementById(id);
    // erp-product-experience.js moves a fresh session from the dashboard to "งานของฉัน" ~380 ms after load; let that settle first.
    await waitFor(() => !!w.ERPProductExperience); await new Promise(r => setTimeout(r, 400));
    const u1 = invoice(6001, 'INV-U1', day(-45), { customer: 'บริษัท เอ จำกัด' });                                            // due day(-15) → 15 days, 1–30
    const u2 = invoice(6002, 'INV-U2', day(-70), { customer: 'บริษัท เอ จำกัด', subtotal: 2000, vatAmt: 140, total: 2140 });  // due day(-40) → 40 days, 31–60
    const u3 = invoice(6003, 'INV-U3', day(-25), { customer: 'บริษัท บี จำกัด', subtotal: 500, vatAmt: 35, total: 535 });     // due day(+5) → due soon
    for (const inv of [u1, u2, u3]) put(w, 'ubon', 'invoices', inv);
    w.renderDash();
    await waitFor(() => !!$('ar-overdue-banner') && !$('ar-overdue-banner').hidden);
    const banner = $('ar-overdue-banner');
    assert.equal(text(banner.querySelector('b')), 'มีใบแจ้งหนี้เกินกำหนด 2 ใบ รวม 3,210.00 บาท');
    assert.equal(text(banner.querySelector('small')), 'ค้างนานที่สุด 40 วัน · ครบกำหนดภายใน 7 วันอีก 1 ใบ (฿535.00)');
    assert.equal(banner.dataset.tone, 'danger');
    const badge = () => [...w.document.querySelectorAll('.sidebar .nav-item')].find(n => (n.getAttribute('onclick') || '').includes("go('dashboard'"))?.querySelector('.ar-nav-badge');
    assert.equal(badge()?.textContent, '2');
    assert.equal(w.ERPGovernance.agingSnapshot(today).ar.total, 3745, 'Audit Log aging agrees with the report');
    // The same banner is on the default "งานของฉัน" landing page.
    w.go('work-home'); await waitFor(() => !!$('ar-overdue-banner-home') && !$('ar-overdue-banner-home').hidden);
    assert.equal(text($('ar-overdue-banner-home').querySelector('b')), 'มีใบแจ้งหนี้เกินกำหนด 2 ใบ รวม 3,210.00 บาท');

    // Banner → the "ลูกหนี้ค้างรับ" view of the executive dashboard (visible in the default simple mode).
    $('ar-overdue-banner-home').querySelector('[data-ar-action="open-report"]').click();
    assert.equal($('panel-dashboard').classList.contains('active'), true);
    assert.equal($('panel-dashboard').dataset.dashboardView, 'receivables');
    assert.equal($('ar-aging-card').classList.contains('erp-view-hidden'), false);
    assert.equal($('dash-combined').classList.contains('erp-view-hidden'), true);
    await tick(); await new Promise(r => setTimeout(r, 80));
    assert.equal($('panel-dashboard').classList.contains('active'), true, 'not bounced away by the simple-mode navigation guard');
    const report = $('ar-aging-report');
    const head = [...report.querySelector('.ar-aging-table').tHead.rows[0].cells].map(text);
    assert.deepEqual(plain(head), ['ลูกค้า', 'บิลค้าง', 'ยังไม่ถึงกำหนด', '1–30 วัน', '31–60 วัน', '61–90 วัน', 'เกิน 90 วัน', 'รวมค้างรับ']);
    const customerRows = [...report.querySelectorAll('tr.ar-aging-customer')].map(tr => [text(tr.querySelector('button')), text(tr.querySelector('small')), ...[...tr.children].slice(1).map(text)]);
    // ADR-017: the ▸ / ▾ text became a chevron line icon (aria-hidden) turned by aria-expanded.
    assert.deepEqual(plain(customerRows), [
      ['บริษัท เอ จำกัด', 'ค้างนานสุด 40 วัน', '2', '–', '฿1,070.00', '฿2,140.00', '–', '–', '฿3,210.00'],
      ['บริษัท บี จำกัด', '', '1', '฿535.00', '–', '–', '–', '–', '฿535.00']
    ]);
    assert.deepEqual(plain([...report.querySelectorAll('tfoot th')].map(text)), ['รวมทั้งหมด', '3', '฿535.00', '฿1,070.00', '฿2,140.00', '฿0.00', '฿0.00', '฿3,745.00']);
    assert.deepEqual(plain([...report.querySelectorAll('.ar-aging-kpis b')].map(text)), ['฿3,745.00', '฿3,210.00', '฿0.00']);
    assert.deepEqual(plain([...report.querySelectorAll('.ar-aging-kpis span')].map(text)), ['3 บิล · 2 ราย', '85.7% ของลูกหนี้คงค้าง', 'ควรติดตามเป็นลำดับแรก']);
    // Drill-down to the customer's open invoices.
    const detail = report.querySelector('tr.ar-aging-detail');
    assert.equal(detail.hidden, true);
    report.querySelector('[data-ar-action="toggle"]').click();
    assert.equal(detail.hidden, false);
    assert.equal(report.querySelector('[data-ar-action="toggle"]').getAttribute('aria-expanded'), 'true');
    assert.deepEqual(plain([...detail.querySelector('table').tBodies[0].rows].map(tr => text(tr.children[0]) + ' | ' + text(tr.children[4]) + ' | ' + text(tr.children[7]))), ['INV-U2 ดูบิล | เกินกำหนด 40 วัน | ฿2,140.00', 'INV-U1 ดูบิล | เกินกำหนด 15 วัน | ฿1,070.00']);
    // CSV export through the app's CSV writer.
    const exported = [];
    w.downloadCsvText = (name, rows) => exported.push({ name, rows });
    report.querySelector('[data-ar-action="export"]').click();
    assert.equal(exported.length, 1);
    assert.equal(exported[0].name, `ar-aging-${today}.csv`);
    assert.equal(exported[0].rows.length, 5);
    assert.deepEqual(plain(exported[0].rows[4]), ['รวมทั้งหมด', '', '', '', '', '', '', 535, 1070, 2140, 0, 0, 3745]);
    // The report follows the dashboard branch tabs.
    w.switchDashTab('khonkaen'); await tick(); await tick();
    assert.match(text(report), /สาขาที่ 00001 .*ไม่มีลูกหนี้คงค้าง ณ วันนี้/);
    w.switchDashTab('all'); await tick(); await tick();
    assert.equal(report.querySelectorAll('tr.ar-aging-customer').length, 2);

    // Dismiss: hidden (on both pages) until the receivable figures change.
    banner.querySelector('[data-ar-action="dismiss"]').click();
    assert.deepEqual([banner.hidden, $('ar-overdue-banner-home').hidden], [true, true]);
    w.renderDash(); await tick(); await tick();
    assert.equal(banner.hidden, true, 'same figures → stays dismissed');

    // Save a real receipt for INV-U1 (1,070) → banner returns with the new figures, badge 1.
    w.go('receipt-form', null); w.resetF('receipt'); w.selBr('r', 'ubon');
    const [uy, um] = u1.date.split('-').map(Number);
    const ref = $('r-inv-ref'); ref.innerHTML = `<option value='${JSON.stringify({ b: 'ubon', y: uy, m: um - 1, id: 6001, no: 'INV-U1' })}'>x</option>`; ref.selectedIndex = 0;
    w.fillFromInv();
    $('r-no').value = 'RC-U1'; $('r-date').value = today;
    await w.saveReceipt();
    assert.equal(w.ERPIntegrity.paymentSummary(w.ERPIntegrity.business().invoices.find(i => i.no === 'INV-U1')).outstanding, 0, h.messages.join('\n'));
    assert.equal(await waitFor(() => !banner.hidden && /2,140\.00/.test(text(banner))), true, text(banner));
    assert.equal(text(banner.querySelector('b')), 'มีใบแจ้งหนี้เกินกำหนด 1 ใบ รวม 2,140.00 บาท');
    assert.equal(badge()?.textContent, '1');

    // Save a real credit note of 1,000 + VAT on INV-U2 → still overdue, balance 1,070.
    const [vy, vm] = u2.date.split('-').map(Number);
    assert.equal(w.ERPCreditNotes.startFromInvoice('ubon', vy, vm - 1, 6002), true);
    const diff = w.document.querySelector('[data-cn-line-field="diff"]');
    diff.value = '1000'; fire(w, diff);
    $('cn-date').value = today; $('cn-reason').value = 'price_overcharge';
    const saved = await w.ERPCreditNotes.save();
    assert.ok(saved && saved.no, text($('cn-feedback')) + h.messages.join('\n'));
    assert.equal(await waitFor(() => /1,070\.00/.test(text(banner.querySelector('b')))), true, text(banner));
    assert.equal(text(banner.querySelector('b')), 'มีใบแจ้งหนี้เกินกำหนด 1 ใบ รวม 1,070.00 บาท');
    // The report is rebuilt only while the dashboard is visible (review#3).
    w.go('dashboard'); await waitFor(() => /1,605\.00/.test(text($('ar-aging-report'))));
    assert.deepEqual(plain([...$('ar-aging-report').querySelectorAll('tfoot th')].map(text)), ['รวมทั้งหมด', '2', '฿535.00', '฿0.00', '฿1,070.00', '฿0.00', '฿0.00', '฿1,605.00']);

    // Credit the rest → no overdue left: badge removed, banner switches to the due-soon warning.
    w.go('dashboard'); await tick();
    assert.equal(w.ERPCreditNotes.startFromInvoice('ubon', vy, vm - 1, 6002), true);
    const diff2 = w.document.querySelector('[data-cn-line-field="diff"]');
    diff2.value = '1000'; fire(w, diff2);
    $('cn-date').value = today; $('cn-reason').value = 'price_overcharge';
    assert.ok(await w.ERPCreditNotes.save(), text($('cn-feedback')));
    assert.equal(await waitFor(() => !badge()), true);
    assert.equal(banner.dataset.tone, 'warning');
    assert.equal(text(banner.querySelector('b')), 'มีใบแจ้งหนี้ใกล้ครบกำหนดภายใน 7 วัน 1 ใบ รวม 535.00 บาท');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('Part B: no receivables → no banner, no badge, empty report message; user text is escaped', async () => {
  const h = await boot(); const { w } = h;
  try {
    const $ = id => w.document.getElementById(id);
    // erp-product-experience.js moves a fresh session from the dashboard to "งานของฉัน" ~380 ms after load; let that settle first.
    await waitFor(() => !!w.ERPProductExperience); await new Promise(r => setTimeout(r, 400));
    w.renderDash(); await tick(); await tick();
    assert.equal(!$('ar-overdue-banner') || $('ar-overdue-banner').hidden, true);
    assert.equal(w.document.querySelector('.ar-nav-badge'), null);
    w.go('dashboard'); await tick(); await tick();
    assert.match(text($('ar-aging-report')), /ไม่มีลูกหนี้คงค้าง ณ วันนี้/);
    const shared = await imp('erp-shared-core.js');
    put(w, 'ubon', 'invoices', invoice(8001, 'INV-<b>X</b>', shared.addBusinessCalendarDays(shared.localDateISO(), -40), { customer: '<img src=x onerror=alert(1)>' }));
    w.ERPReceivables.refresh();
    const report = $('ar-aging-report');
    assert.equal(report.querySelector('img'), null);
    assert.equal(report.querySelector('b b'), null);
    assert.match(report.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

// ================================================================ independent review fixes (review#N)
// Each test below fails on the pre-fix code (baseline-before-fixes-3) and passes after the fix.
const vm = require('node:vm');
const { loadEsmLike } = require('./vm-esm-helper.cjs');
// ERPIntegrity in a plain Node vm with an in-memory localStorage (fast; no jsdom).
function integrityContext() {
  const memory = new Map();
  const c = { console, Date, Intl, Math, Number, String, Map, Set, JSON, queueMicrotask: () => {}, setTimeout: () => 0, clearTimeout() {}, CustomEvent: class {}, addEventListener() {}, dispatchEvent() {}, notify() {},
    localStorage: { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k), key: i => [...memory.keys()][i] ?? null, get length() { return memory.size; } },
    document: { readyState: 'loading', addEventListener() {}, getElementById: () => null, querySelectorAll: () => [], querySelector: () => null },
    ComformTenant: { storageKey: k => 't::' + k, unwrapStorageKey: k => (k.startsWith('t::') ? k.slice(3) : '') } };
  c.window = c; vm.createContext(c);
  const loaded = new Set();
  loadEsmLike(path.join(ROOT, 'erp-shared-core.js'), c, loaded);
  loadEsmLike(path.join(ROOT, 'erp-integrity.js'), c, loaded);
  c.putPack = (branch, year, month, data) => memory.set(`t::biz2_${branch}_${year}_${String(month + 1).padStart(2, '0')}`, JSON.stringify(data));
  c.putFlow = data => memory.set('t::example_erp_order_flow_v3', JSON.stringify(data));
  return c;
}
// A realistic mixed data set: 2,000 invoices over 12 months and 2 branches, printed copies, partial/full
// receipts, WHT, billing payments with printable receipts, live and voided credit notes, a legacy paid invoice.
function seedLedger(c, count = 2000) {
  const packs = new Map();
  const pack = (branch, month) => { const k = `${branch}|${month}`; if (!packs.has(k)) packs.set(k, { branch, month, data: { invoices: [], issuedInvoices: [], receipts: [], creditNotes: [] } }); return packs.get(k).data; };
  const payments = [];
  for (let i = 0; i < count; i++) {
    const branch = i % 5 === 0 ? 'khonkaen' : 'ubon', month = i % 12, date = `2026-${String(month + 1).padStart(2, '0')}-${String(1 + (i % 27)).padStart(2, '0')}`;
    const d = pack(branch, month);
    const inv = { id: `I${i}`, no: `INV${i}`, customer: `ลูกค้า ${i % 60}`, date, subtotal: 1000, vatAmt: 70, total: 1070, paymentManaged: i % 97 !== 0, legacyPaid: i % 97 === 0 ? true : undefined, creditTerm: 'credit30' };
    d.invoices.push(inv);
    if (i % 11 === 0) d.issuedInvoices.push({ ...inv, id: `PR${i}`, sourceInvoiceId: inv.id });
    if (i % 3 === 0) d.receipts.push({ id: `R${i}`, invoiceId: inv.id, invNo: inv.no, customer: inv.customer, total: i % 2 ? 1070 : 500 });
    if (i % 13 === 0) d.receipts.push({ id: `W${i}`, invNo: inv.no, customer: inv.customer, total: 1070, whtAmount: 30, cashReceived: 1040 });
    if (i % 17 === 0) d.receipts.push({ id: `D${i}`, invoiceId: inv.id, customer: inv.customer, total: 1069.99 });
    if (i % 10 === 0) d.creditNotes.push({ id: `CN${i}`, no: `CN${i}`, lines: [{ invoiceId: inv.id, invoiceNo: inv.no, invoiceBranch: branch, total: 107, difference: 100 }], subtotal: 100, total: 107, voided: i % 20 === 0 });
    if (i % 19 === 0) { payments.push({ id: `P${i}`, allocations: [{ invoiceId: inv.id, invoiceNo: inv.no, branch, amount: 600 }] }); d.receipts.push({ id: `PR-R${i}`, paymentId: `P${i}`, invoiceId: inv.id, customer: inv.customer, total: 600 }); }
  }
  for (const { branch, month, data } of packs.values()) c.putPack(branch, 2026, month, data);
  c.putFlow({ salesOrders: [], billingNotes: [], payments });
}

test('review#3: prebuilt payment index gives identical paymentSummary figures and a 2,000-invoice ledger stays fast', async () => {
  const c = integrityContext();
  seedLedger(c, 2000);
  const I = c.ERPIntegrity;
  assert.equal(typeof I.paymentContext, 'function', 'ERPIntegrity.paymentContext() exists');
  const business = I.business(), store = I.flow();
  // Result equivalence: indexed vs. full scan, every invoice, every field.
  const context = I.paymentContext(business, store);
  const plainSummaries = business.invoices.map(inv => I.paymentSummary(inv, { business, store }));
  const indexedSummaries = business.invoices.map(inv => I.paymentSummary(inv, context));
  assert.equal(JSON.stringify(indexedSummaries), JSON.stringify(plainSummaries));
  assert.ok(plainSummaries.some(s => s.credited > 0) && plainSummaries.some(s => s.legacy) && plainSummaries.some(s => s.status === 'paid'), 'data set exercises credit notes, legacy and settled invoices');
  // dedupe(): same result as the former pairwise algorithm (printed copies, duplicate ids).
  const pairwise = (rows, type = 'Invoice') => {
    const out = rows.filter(r => !String(r._type || '').startsWith('issued'));
    rows.filter(r => String(r._type || '').startsWith('issued')).forEach(r => { if (!out.some(b => I.sameDoc(r, b, type))) out.push(r); });
    return out.filter((r, i) => out.findIndex(b => I.branch(b) === I.branch(r) && String(b.id || b.no) === String(r.id || r.no)) === i);
  };
  const raw = [];
  for (const k of [...Array(c.localStorage.length).keys()].map(i => c.localStorage.key(i)).filter(k => k.includes('biz2_'))) {
    const d = JSON.parse(c.localStorage.getItem(k)), branch = /biz2_(\w+?)_/.exec(k)[1];
    for (const type of ['invoices', 'issuedInvoices']) (d[type] || []).forEach(r => raw.push({ ...r, branch, _branch: branch, _type: type }));
  }
  raw.push({ ...raw[0] }); // an exact duplicate row
  assert.deepEqual(I.dedupe(raw).map(r => `${r._type}:${r.id}`), pairwise(raw).map(r => `${r._type}:${r.id}`));
  // Performance: business() + index + all 2,000 summaries + aging (the dashboard snapshot path).
  const core = await imp('erp-receivables-core.js');
  const started = Date.now();
  const b2 = I.business(), s2 = I.flow(), ctx2 = I.paymentContext(b2, s2);
  const ledger = core.buildReceivableLedger(b2.invoices, { asOf: '2026-12-31', live: I.live, summarize: inv => I.paymentSummary(inv, ctx2) });
  core.summarizeReceivableAging(ledger.items, ledger.credits);
  const elapsed = Date.now() - started;
  // Wall-clock is only a generous sanity bound (a busy CPU made 300 ms flaky); the deterministic
  // bound on rows examined / storage reads is asserted in 'fix6#8' below.
  assert.ok(elapsed < 5000, `2,000-invoice ledger took ${elapsed} ms (sanity bound 5,000 ms; full-scan version took several seconds)`);
});

test('review#3: bulk callers build business()/store once — branch stats, governance aging, work home, Customer 360', async () => {
  const h = await boot(); const { w } = h;
  try {
    const cnCore = await imp('erp-credit-note-core.js');
    for (const month of [1, 2, 3]) {
      const inv = invoice(9100 + month, `INV-M${month}`, `2025-0${month + 1}-05`);
      put(w, 'ubon', 'invoices', inv);
      put(w, 'ubon', 'creditNotes', creditNote(cnCore, inv, 100));
    }
    // Let the other modules' own post-save refresh timers finish; each count below is synchronous.
    await new Promise(r => setTimeout(r, 400));
    const I = w.ERPIntegrity, realBusiness = I.business;
    let calls = 0;
    I.business = (...args) => { calls += 1; return realBusiness(...args); };
    try {
      calls = 0; w.testApp.branchStats('ubon', 2025, -1);
      assert.ok(calls <= 1, `branchStats over 3 credit-note months read business() ${calls}× (was once per month)`);
      calls = 0; assert.equal(w.ERPGovernance.agingSnapshot('2025-12-31').ar.total, 3 * (1070 - 107));
      assert.ok(calls <= 1, `governance aging read business() ${calls}×`);
      calls = 0; w.ERPProductExperience.snapshot();
      assert.ok(calls <= 1, `work-home snapshot read business() ${calls}×`);
      calls = 0; w.ERPCustomerExperience.openCustomer360('บริษัท ลูกค้า ก จำกัด');
      assert.ok(calls <= 3, `Customer 360 read business() ${calls}× for 3 invoices`);
    } finally { I.business = realBusiness; }
  } finally { h.close(); }
});

test('review#1: sales-target actual only nets credit notes on production-backed sales', async () => {
  const h = await boot(); const { w } = h;
  try {
    const cnCore = await imp('erp-credit-note-core.js');
    const d = w.loadFor('ubon', 2025, 8);
    d.productions = [{ id: 'PT-9', no: 'PT-9', date: '2025-09-03', customer: 'ลูกค้า', subtotal: 1000 }];
    w.saveFor('ubon', 2025, 8, d);
    const direct = invoice(9201, 'INV-DIRECT', '2025-09-04');                                                  // no production order
    const linked = invoice(9202, 'INV-LINKED', '2025-09-05', { sourceProductionId: 'PT-9', sourceProductionNo: 'PT-9' });
    put(w, 'ubon', 'invoices', direct); put(w, 'ubon', 'invoices', linked);
    put(w, 'ubon', 'creditNotes', creditNote(cnCore, direct, 200, { date: '2025-09-20' }));
    put(w, 'ubon', 'creditNotes', creditNote(cnCore, linked, 100, { date: '2025-09-21' }));
    const year = w.document.getElementById('dash-year');
    if (![...year.options].some(o => o.value === '2025')) year.add(new w.Option('2025', '2025'));
    year.value = '2025'; w.document.getElementById('dash-month').value = '8';
    w.switchDashTab('all');
    // 1,000 production − 100 (note on the production-backed invoice); the 200 note on the direct invoice is not in this base.
    assert.equal(w.testApp.buildSalesTargetDashboard().actual, 900);
    // Only a direct invoice + its credit note: nothing counted, nothing subtracted (was −200).
    const d2 = w.loadFor('ubon', 2025, 9); w.saveFor('ubon', 2025, 9, d2);
    const lone = invoice(9203, 'INV-LONE', '2025-10-04');
    put(w, 'ubon', 'invoices', lone); put(w, 'ubon', 'creditNotes', creditNote(cnCore, lone, 200, { date: '2025-10-10' }));
    w.document.getElementById('dash-month').value = '9'; w.switchDashTab('all');
    assert.equal(w.testApp.buildSalesTargetDashboard().actual, 0);
  } finally { h.close(); }
});

test('review#2: CSV exports neutralise spreadsheet formulas (AR aging via csvEscapeCell, audit log)', async () => {
  const h = await boot(); const { w } = h;
  try {
    const csv = w.testApp.csvEscapeCell;
    assert.equal(csv('=HYPERLINK("http://x","c")'), `"'=HYPERLINK(""http://x"",""c"")"`);
    assert.equal(csv('=1+1'), "'=1+1");
    assert.equal(csv('+66 81 000'), "'+66 81 000");
    assert.equal(csv('-5'), "'-5", 'text that looks like a formula is quoted');
    assert.equal(csv('@SUM(A1)'), "'@SUM(A1)");
    assert.equal(csv('\tx'), "'\tx");
    assert.equal(csv('\rx'), `"'\rx"`);
    assert.equal(csv(-5), '-5', 'real numbers are left alone');
    assert.equal(csv(1070.5), '1070.5');
    assert.equal(csv('บริษัท เอ, จำกัด'), '"บริษัท เอ, จำกัด"');
    // The AR aging CSV goes through csvEscapeCell: a formula customer / invoice number is exported inert.
    const core = await imp('erp-receivables-core.js');
    const items = core.buildReceivableItems([{ id: 1, no: '=1+1', date: '2026-01-01', customer: '=HYPERLINK("http://x","c")', outstanding: 100 }], { asOf: '2026-09-21' });
    const line = core.receivableAgingCsvRows(core.summarizeReceivableAging(items))[1].map(csv);
    assert.deepEqual(line.slice(0, 2), [`"'=HYPERLINK(""http://x"",""c"")"`, "'=1+1"]);
    // Audit-log export (erp-production-core.js) has its own writer: same protection.
    const captured = [];
    w.Blob = class { constructor(parts) { captured.push(parts.join('')); } };
    w.URL.createObjectURL = () => 'blob:test'; w.URL.revokeObjectURL = () => {};
    w.HTMLAnchorElement.prototype.click = () => {};
    w.ERPProductionCore.audit('create', 'creditNote', '=cmd|/c calc', '@SUM(1+1)', {});
    w.pcExportAudit();
    assert.match(captured.join('\n'), /"'=cmd\|\/c calc"/);
    assert.match(captured.join('\n'), /"'@SUM\(1\+1\)"/);
  } finally { h.close(); }
});

// review#4 (banner / badge only for accounting / management roles) was replaced by
// tests/single-admin-view.test.cjs: single Admin view, the banner and badge are shown to everyone (ADR-014).

test('review#5: a different overdue invoice with the same count and total re-shows a dismissed banner', async () => {
  const c = await imp('erp-receivables-core.js');
  const item = no => ({ id: no, no, branch: 'ubon', dueDate: '2026-09-01', outstanding: 1070, customer: 'ลูกค้า' });
  const before = c.receivableAlertSummary(c.buildReceivableItems([item('INV-A')], { asOf: '2026-09-21' }));
  const after = c.receivableAlertSummary(c.buildReceivableItems([item('INV-B')], { asOf: '2026-09-21' }));
  assert.deepEqual([before.overdueCount, before.overdueTotal], [after.overdueCount, after.overdueTotal]);
  assert.notEqual(before.signature, after.signature);
  // Same invoices in another order → same signature (keys are sorted).
  const ab = c.receivableAlertSummary(c.buildReceivableItems([item('INV-A'), item('INV-B')], { asOf: '2026-09-21' }));
  const ba = c.receivableAlertSummary(c.buildReceivableItems([item('INV-B'), item('INV-A')], { asOf: '2026-09-21' }));
  assert.equal(ab.signature, ba.signature);
});

test('review#6: product lines are not inflated when item values nearly cancel (mixed signs)', async () => {
  const h = await boot(); const { w } = h;
  try {
    // Subtotal 50 from items 1,000 and a −990 discount line: raw lines + a 40 adjustment line (was 5,000 / −4,950).
    const rows = w.testApp.analyticsItemRows([{ _type: 'invoices', subtotal: 50, total: 53.5, customer: 'ลูกค้า', items: [{ product: 'X', qty: 1, saleTotal: 1000 }, { product: 'ส่วนลด', qty: 1, saleTotal: -990 }] }]);
    assert.deepEqual(plain(rows.map(r => [r.product, r.value])), [['X', 1000], ['ส่วนลด', -990], ['ส่วนต่างปรับยอดตามบิล', 40]]);
    // Same-sign VAT-inclusive lines are still scaled to the pre-VAT total.
    const vatRows = w.testApp.analyticsItemRows([{ _type: 'invoices', subtotal: 1000, total: 1070, customer: 'ลูกค้า', items: [{ product: 'A', qty: 1, saleTotal: 642 }, { product: 'B', qty: 1, saleTotal: 428 }] }]);
    assert.deepEqual(plain(vatRows.map(r => [r.product, r.value])), [['A', 600], ['B', 400]]);
  } finally { h.close(); }
  const c = await imp('erp-receivables-core.js');
  assert.deepEqual(c.itemSharesForRow(50, [1000, -990]), { shares: [1000, -990], remainder: 40 });
  assert.deepEqual(c.itemSharesForRow(1000, [2000, 3000]), { shares: [400, 600], remainder: 0 }, 'factor 0.2 (same sign) is scaled');
  assert.deepEqual(c.itemSharesForRow(900, [300, 100]), { shares: [300, 100], remainder: 500 }, 'factor 2.25 is not a sane scale');
  assert.deepEqual(c.itemSharesForRow(-200, [-120, -80]), { shares: [-120, -80], remainder: 0 }, 'credit-note rows (all negative)');
});

test('review#7: AR scope follows the tenant package — inactive branches are excluded', async () => {
  const h = await boot(); const { w } = h;
  try {
    const shared = await imp('erp-shared-core.js');
    put(w, 'ubon', 'invoices', invoice(9401, 'INV-HQ', shared.addBusinessCalendarDays(shared.localDateISO(), -45)));
    put(w, 'khonkaen', 'invoices', invoice(9402, 'INV-KK', shared.addBusinessCalendarDays(shared.localDateISO(), -45), { branch: 'khonkaen' }));
    assert.equal(w.ERPReceivables.snapshot('').alert.overdueCount, 2);
    w.SaaSService.isBranchActive = branch => branch === 'ubon';
    const snap = w.ERPReceivables.snapshot('');
    assert.deepEqual(plain(snap.items.map(i => i.no)), ['INV-HQ']);
    assert.deepEqual([snap.alert.overdueCount, snap.alert.overdueTotal], [1, 1070]);
  } finally { h.close(); }
});

test('review#8: "ดูบิล" opens printed-only (issued) invoices in the issued-document view', async () => {
  const h = await boot(); const { w } = h;
  try {
    const shared = await imp('erp-shared-core.js');
    const $ = id => w.document.getElementById(id);
    await waitFor(() => !!w.ERPProductExperience); await new Promise(r => setTimeout(r, 400));
    const date = shared.addBusinessCalendarDays(shared.localDateISO(), -45);
    put(w, 'ubon', 'issuedInvoices', invoice(9501, 'INV-PRINTED', date));
    const calls = [];
    w.showIssuedDocumentDetail = (...args) => calls.push(['issued', ...args]);
    w.showDetailById = (...args) => calls.push(['base', ...args]);
    w.go('dashboard'); await waitFor(() => /INV-PRINTED/.test($('ar-aging-report').innerHTML));
    $('ar-aging-report').querySelector('[data-ar-action="open-invoice"]').click();
    const [y, m] = date.split('-').map(Number);
    assert.deepEqual(plain(calls), [['issued', 'issuedInvoices', 'ubon', y, m - 1, '9501']]);
  } finally { h.close(); }
});

test('review#9: impossible calendar dates are undated, not rolled over to the next month', async () => {
  const c = await imp('erp-receivables-core.js');
  assert.equal(c.arBusinessIso('2026-02-30'), '');
  assert.equal(c.arBusinessIso('31/04/2569'), '');
  assert.equal(c.arBusinessIso('29/02/2567'), '2024-02-29', 'a real leap day in BE is kept');
  assert.equal(c.arBusinessIso('2026-02-28'), '2026-02-28');
  assert.deepEqual(c.invoiceDueDateInfo({ date: '2026-02-30', creditTerm: 'credit30' }), { dueDate: '', basis: 'none' });
  const [item] = c.buildReceivableItems([{ id: 1, no: 'X', date: '2026-02-30', outstanding: 500 }], { asOf: '2026-09-21' });
  assert.deepEqual([item.bucket, item.state, item.date], ['undated', 'none', '']);
});

test('review#10: aging, banner and badge roll over to the new business day on focus / visibility', async () => {
  const h = await boot(); const { w } = h;
  try {
    const shared = await imp('erp-shared-core.js');
    const $ = id => w.document.getElementById(id);
    await waitFor(() => !!w.ERPProductExperience); await new Promise(r => setTimeout(r, 400));
    put(w, 'ubon', 'invoices', invoice(9601, 'INV-TODAY', shared.localDateISO(), { creditTerm: 'cash' }));
    w.go('dashboard'); w.renderDash();
    await waitFor(() => !!$('ar-overdue-banner') && !$('ar-overdue-banner').hidden);
    assert.equal($('ar-overdue-banner').dataset.tone, 'warning', 'due today');
    // The clock passes midnight while the page stays open; the user comes back to the tab.
    const RealDate = w.Date;
    w.Date = class extends RealDate { constructor(...args) { if (args.length) super(...args); else super(RealDate.now() + 86400000); } static now() { return RealDate.now() + 86400000; } };
    try {
      w.dispatchEvent(new w.Event('focus'));
      assert.equal(await waitFor(() => $('ar-overdue-banner').dataset.tone === 'danger'), true);
      assert.equal(text($('ar-overdue-banner').querySelector('b')), 'มีใบแจ้งหนี้เกินกำหนด 1 ใบ รวม 1,070.00 บาท');
    } finally { w.Date = RealDate; }
  } finally { h.close(); }
});

test('review#11: refund due to customers (credited after payment) is shown separately and never reduces the buckets', async () => {
  const c = await imp('erp-receivables-core.js');
  // Invoice A: paid 1,070 then credited 214 → refund 214. Invoice B: 1,070 still owed, 20 days overdue.
  const summaries = { A: { total: 1070, paid: 1070, credited: 214, outstanding: 0, refundDue: 214 }, B: { total: 1070, paid: 0, credited: 0, outstanding: 1070, refundDue: 0 } };
  const ledger = c.buildReceivableLedger([{ id: 'A', no: 'INV-A', date: '2026-08-01', customer: 'บริษัท เอ' }, { id: 'B', no: 'INV-B', date: '2026-08-02', dueDate: '2026-09-01', customer: 'บริษัท เอ' }], { asOf: '2026-09-21', summarize: inv => summaries[inv.id] });
  assert.deepEqual(ledger.items.map(i => [i.no, i.outstanding, i.bucket]), [['INV-B', 1070, '1_30']]);
  assert.deepEqual(ledger.credits.map(r => [r.no, r.refundDue]), [['INV-A', 214]]);
  const aging = c.summarizeReceivableAging(ledger.items, ledger.credits);
  assert.deepEqual([aging.rows[0].total, aging.rows[0].overdue, aging.rows[0].buckets['1_30'], aging.rows[0].refundDue], [1070, 1070, 1070, 214]);
  assert.deepEqual([aging.totals.total, aging.totals.refundDue, aging.hasRefunds], [1070, 214, true]);
  const csvRows = c.receivableAgingCsvRows(aging);
  assert.equal(csvRows[0].at(-1), 'เครดิตค้างคืนลูกค้า');
  assert.deepEqual(csvRows.at(-1).slice(-2), [1070, 214]);
  // Screen: the dashboard report shows the column and the total.
  const h = await boot(); const { w } = h;
  try {
    const shared = await imp('erp-shared-core.js'), cnCore = await imp('erp-credit-note-core.js');
    const $ = id => w.document.getElementById(id);
    await waitFor(() => !!w.ERPProductExperience); await new Promise(r => setTimeout(r, 400));
    const paidInv = invoice(9701, 'INV-PAID', shared.addBusinessCalendarDays(shared.localDateISO(), -60));
    put(w, 'ubon', 'invoices', paidInv);
    put(w, 'ubon', 'receipts', { id: 9711, no: 'RC-PAID', date: paidInv.date, invoiceId: 9701, invNo: 'INV-PAID', invoiceBranch: 'ubon', customer: paidInv.customer, total: 1070, subtotal: 1000, items: [] });
    put(w, 'ubon', 'creditNotes', creditNote(cnCore, paidInv, 200));                                        // 214 incl. VAT back to the customer
    put(w, 'ubon', 'invoices', invoice(9702, 'INV-OPEN', shared.addBusinessCalendarDays(shared.localDateISO(), -50)));  // 20 days overdue
    w.go('dashboard'); await waitFor(() => /เครดิตค้างคืนลูกค้า/.test(text($('ar-aging-report'))));
    const report = $('ar-aging-report');
    const head = [...report.querySelector('.ar-aging-table').tHead.rows[0].cells].map(text);
    assert.equal(head.at(-1), 'เครดิตค้างคืนลูกค้า');
    const row = report.querySelector('tr.ar-aging-customer');
    assert.deepEqual(plain([...row.children].slice(1).map(text)), ['1', '–', '฿1,070.00', '–', '–', '–', '฿1,070.00', '฿214.00']);
    assert.deepEqual(plain([...report.querySelectorAll('tfoot th')].map(text)).slice(-2), ['฿1,070.00', '฿214.00']);
    assert.equal(w.ERPReceivables.snapshot('').alert.overdueTotal, 1070, 'the refund does not offset the overdue amount');
  } finally { h.close(); }
});

// ================================================= fix6 regressions (4.3.1 review 6)
test('fix6#3: Customer 360 nets a credit note against the ORIGINAL invoice customer and ignores voided invoices', async () => {
  const h = await boot(); const { w } = h;
  try {
    const cnCore = await imp('erp-credit-note-core.js'), sh = await imp('erp-shared-core.js');
    const date = sh.addBusinessCalendarDays(sh.localDateISO(), -20);
    const [y, m] = date.split('-').map(Number);
    // Walk-in abbreviated invoice; its credit note carries the typed buyer name "คุณสมชาย" (§86/10).
    const walkIn = invoice(7001, 'AB-7001', date, { customer: GENERAL, taxInvoiceForm: 'abbreviated', useVat: 0, vatMode: 'extract', creditTerm: '' });
    const named = invoice(7002, 'INV-7002', date);
    const voided = invoice(7003, 'INV-7003', date, { total: 5350, subtotal: 5000, vatAmt: 350, voided: true, status: 'cancelled' });
    // Paid then credited → refund due to บริษัท ลูกค้า ก จำกัด.
    const paid = invoice(7004, 'INV-7004', date);
    put(w, 'ubon', 'invoices', walkIn); put(w, 'ubon', 'invoices', named); put(w, 'ubon', 'invoices', voided); put(w, 'ubon', 'invoices', paid);
    put(w, 'ubon', 'receipts', { id: 7014, no: 'RC-7004', date, invoiceId: 7004, invNo: 'INV-7004', invoiceBranch: 'ubon', customer: paid.customer, total: 1070, subtotal: 1000, items: [] });
    const calc = cnCore.calculateCreditNote({ lines: [{ invoice: { ...walkIn, _year: y, _month: m - 1 }, differenceAmount: 200 }] });
    put(w, 'ubon', 'creditNotes', { id: 'CNW', no: 'CN-W', date, branch: 'ubon', customer: 'คุณสมชาย', reasonCode: 'price_overcharge', lines: calc.lines, subtotal: calc.subtotal, vatAmt: calc.vatAmt, total: calc.total, status: 'issued' });
    put(w, 'ubon', 'creditNotes', creditNote(cnCore, paid, 200));                                              // 214 incl. VAT
    await new Promise(r => setTimeout(r, 300));
    const C = w.ERPCustomerExperience;
    const gen = C.customerSnapshot(GENERAL), buyer = C.customerSnapshot('คุณสมชาย'), firm = C.customerSnapshot('บริษัท ลูกค้า ก จำกัด');
    assert.equal(calc.total, 200);
    // The note nets on the walk-in invoice's customer …
    assert.deepEqual([gen.credited, gen.sales, gen.ar], [200, 1070 - 200, 1070 - 200]);
    assert.ok(gen.timeline.some(t => t.label === 'Credit Note' && t.no === 'CN-W' && t.amount === -200));
    // … and never on the typed buyer, who has no invoices (was: ยอด Invoice −200).
    assert.deepEqual([buyer.sales, buyer.ar, buyer.credited, buyer.creditNotes.length], [0, 0, 0, 0]);
    assert.ok(!buyer.timeline.some(t => t.label === 'Credit Note'));
    // Voided invoice (5,350) is not sales nor receivable.
    assert.deepEqual([firm.sales, firm.ar, firm.refundDue, firm.credited], [1070 + 1070 - 214, 1070, 214, 214]);
    // Same figures as the AR report (walk-in row, customer row, refund column).
    const snap = w.ERPReceivables.snapshot('');
    const row = key => snap.aging.rows.find(r => r.key === key);
    assert.equal(row('__walk_in__').total, gen.ar);
    const firmRow = snap.aging.rows.find(r => r.label === 'บริษัท ลูกค้า ก จำกัด');
    assert.deepEqual([firmRow.total, firmRow.refundDue], [firm.ar, firm.refundDue]);
    w.ERPCustomerExperience.openCustomer360('คุณสมชาย');
    assert.match(text(w.document.querySelector('.erp-c360-dialog')), /ยอด Invoice\s*฿0\.00/);
  } finally { h.close(); }
});

test('fix6#7: invoice list builds one payment context per render and prints exactly the same rows as the per-row path', async () => {
  const h = await boot(); const { w } = h;
  try {
    const cnCore = await imp('erp-credit-note-core.js'), sh = await imp('erp-shared-core.js');
    const year = Number(sh.localDateISO().slice(0, 4));
    const d = (days) => sh.addBusinessCalendarDays(sh.localDateISO(), days);
    const rows = [
      invoice(7101, 'INV-OPEN', d(-50)), invoice(7102, 'INV-SOON', d(-27)), invoice(7103, 'INV-PAID', d(-40)),
      invoice(7104, 'INV-CRED', d(-10)), invoice(7105, 'INV-FULLCN', d(-5)), invoice(7106, 'INV-LEGACY', d(-3), { paymentManaged: false, legacyPaid: true }),
      invoice(7107, 'INV-PART', d(-2)), invoice(7108, 'INV-VOID', d(-1), { voided: true })
    ].filter(r => Number(r.date.slice(0, 4)) === year);
    rows.forEach(r => put(w, 'ubon', 'invoices', r));
    const byNo = no => rows.find(r => r.no === no);
    if (byNo('INV-PAID')) put(w, 'ubon', 'receipts', { id: 7113, no: 'RC-1', date: byNo('INV-PAID').date, invoiceId: 7103, invNo: 'INV-PAID', invoiceBranch: 'ubon', customer: 'x', total: 1070 });
    if (byNo('INV-PART')) put(w, 'ubon', 'receipts', { id: 7117, no: 'RC-2', date: byNo('INV-PART').date, invoiceId: 7107, invNo: 'INV-PART', invoiceBranch: 'ubon', customer: 'x', total: 500 });
    if (byNo('INV-CRED')) put(w, 'ubon', 'creditNotes', creditNote(cnCore, byNo('INV-CRED'), 100));
    if (byNo('INV-FULLCN')) put(w, 'ubon', 'creditNotes', creditNote(cnCore, byNo('INV-FULLCN'), 1000));
    await new Promise(r => setTimeout(r, 300));
    const yearSel = w.document.getElementById('il-year');
    if (![...yearSel.options].some(o => o.value === String(year))) yearSel.add(new w.Option(String(year), String(year)));
    yearSel.value = String(year); w.document.getElementById('il-month').value = ''; w.document.getElementById('il-br').value = '';
    // Spy on the window-level API app.js calls: contexts built and summaries computed per render.
    const I = w.ERPIntegrity, realContext = I.paymentContext, realSummary = I.paymentSummary;
    let contexts = 0, summaries = 0, unindexed = 0;
    I.paymentContext = (...a) => { contexts += 1; return realContext(...a); };
    I.paymentSummary = (inv, opts) => { summaries += 1; if (!opts?.index) unindexed += 1; return realSummary(inv, opts); };
    const render = (filter) => { w.document.getElementById('il-paystatus').value = filter; contexts = summaries = unindexed = 0; w.renderIList(); return { html: w.document.getElementById('itbl').innerHTML, contexts, summaries, unindexed }; };
    try {
      for (const filter of ['', 'outstanding', 'paid', 'dueSoon', 'overdue']) {
        const shared = render(filter);
        const spied = I.paymentContext; I.paymentContext = () => undefined;   // no context: each summary does its own full scan
        const perRow = render(filter);
        I.paymentContext = spied;
        assert.equal(shared.html, perRow.html, `filter "${filter}": identical output`);
        assert.equal(shared.contexts, 1, `filter "${filter}": one paymentContext per render`);
        assert.equal(shared.unindexed, 0, `filter "${filter}": every summary uses the shared index`);
        assert.ok(shared.summaries <= rows.length, `filter "${filter}": ${shared.summaries} summaries for ${rows.length} invoices`);
      }
      assert.match(render('').html, /ลดหนี้เต็มจำนวน/);
    } finally { I.paymentContext = realContext; I.paymentSummary = realSummary; }
  } finally { h.close(); }
});

test('fix6#8: the 2,000-invoice ledger is bounded by rows examined, not by wall-clock time', async () => {
  const c = integrityContext();
  seedLedger(c, 2000);
  const I = c.ERPIntegrity, core = await imp('erp-receivables-core.js');
  let reads = 0;
  const realGet = c.localStorage.getItem;
  c.localStorage.getItem = k => { reads += 1; return realGet(k); };
  // Count element reads of the receipt / credit-note lists (what a full scan per invoice would multiply).
  let touched = 0;
  const watch = list => new Proxy(list, { get(target, key, receiver) { if (typeof key === 'string' && /^\d+$/.test(key)) touched += 1; return Reflect.get(target, key, receiver); } });
  const started = Date.now();
  const b = I.business(), s = I.flow();
  const readsForSnapshot = reads;
  b.receipts = watch(b.receipts); b.creditNotes = watch(b.creditNotes);
  const ctx = I.paymentContext(b, s);
  const ledger = core.buildReceivableLedger(b.invoices, { asOf: '2026-12-31', live: I.live, summarize: inv => I.paymentSummary(inv, ctx) });
  core.summarizeReceivableAging(ledger.items, ledger.credits);
  const elapsed = Date.now() - started;
  const listSize = b.receipts.length + b.creditNotes.length;
  assert.equal(reads, readsForSnapshot, 'no storage read per invoice once the context is built');
  assert.ok(readsForSnapshot <= 2 * 12 + 1 + 2, `business()+flow() read storage ${readsForSnapshot}× (one per month pack + flow)`);
  assert.ok(touched <= 4 * listSize, `indexed ledger examined ${touched} receipt/credit-note rows for ${b.invoices.length} invoices (list size ${listSize})`);
  // The metric discriminates: ONE unindexed summary already walks every receipt.
  touched = 0; I.paymentSummary(b.invoices[0], { business: b, store: s });
  assert.ok(touched >= b.receipts.length, `an unindexed summary examined ${touched} rows`);
  assert.ok(elapsed < 5000, `sanity bound only: ${elapsed} ms`);
});

test('fix6#9: governance AR aging puts an invoice without a usable date in the same `undated` bucket as the AR report', async () => {
  const g = await imp('erp-governance-core.js'), c = await imp('erp-receivables-core.js');
  const invoices = [
    { id: 'A', no: 'A', date: '2026-08-01', creditTerm: 'credit30', customer: 'x', total: 100, outstanding: 100 },   // due 08-31 → 21 days
    { id: 'B', no: 'B', date: 'ไม่ทราบ', customer: 'x', total: 700, outstanding: 700 },                              // unusable date
    { id: 'C', no: 'C', date: '31/02/2569', customer: 'x', total: 50, outstanding: 50 },                              // impossible date
    { id: 'D', no: 'D', date: '2026-09-20', creditTerm: 'credit30', customer: 'x', total: 300, outstanding: 300 }    // not yet due
  ];
  const today = '2026-09-21';
  const gov = g.buildArAging(invoices, { today, dueDateOf: c.invoiceDueDate, undated: true });
  const report = c.summarizeReceivableAging(c.buildReceivableItems(invoices, { asOf: today }));
  assert.deepEqual(gov.buckets, report.totals.buckets);
  assert.deepEqual(gov.buckets, { current: 300, '1_30': 100, '31_60': 0, '61_90': 0, over_90: 0, undated: 750 });
  assert.equal(gov.total, report.totals.total);
  // AP aging and callers without the option keep their old shape.
  assert.equal('undated' in g.buildArAging(invoices, { today }).buckets, false);
  // Running app: ERPGovernance.agingSnapshot uses the undated treatment.
  const h = await boot(); const { w } = h;
  try {
    put(w, 'ubon', 'invoices', invoice(7201, 'INV-OK', '2026-08-01'));
    const p = w.loadFor('ubon', 2026, 7); p.invoices.push(invoice(7202, 'INV-NODATE', '2026-08-01', { date: 'ไม่ทราบ' })); w.saveFor('ubon', 2026, 7, p);
    // Both as of the same day: the AR report is always "as of today", so the governance aging is asked for that
    // same day (comparing it with a fixed 2026-09-21 made the 1–30 / 31–60 split depend on the real clock).
    const snap = w.ERPReceivables.snapshot('');
    const ar = w.ERPGovernance.agingSnapshot(snap.asOf).ar;
    assert.equal(ar.buckets.undated, 1070);
    assert.equal(snap.aging.totals.buckets.undated, 1070);
    assert.deepEqual(plain(ar.buckets), plain(snap.aging.totals.buckets));
  } finally { h.close(); }
});
