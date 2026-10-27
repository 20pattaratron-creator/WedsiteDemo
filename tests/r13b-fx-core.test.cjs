// ADR-031 (round 13B) — multi-currency, pure cores: erp-fx-core.js (currencies, the rate table, the rate-date rule,
// conversion once to the satang, receipts / payments abroad, ภ.ง.ด.54 / ภ.พ.36, month end), its use in
// erp-journal-core.js and erp-tax-reports-core.js, and the sample story of erp-demo-seed-core.js. Every amount is worked
// by hand in the comments. Every test here fails on round13a-fixes (no erp-fx-core.js:
// /tmp/claude-0/r13b-newtests-on-base.log).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const imp = file => import(pathToFileURL(path.join(ROOT, file)).href);
const FX = () => imp('erp-fx-core.js');
const AT = '2026-10-26T03:00:00.000Z';
const BY = 'tester';
// A rate store with the given rows [currency, date, type, rate] (per = the currency's quote unit).
async function storeOf(rows) {
  const fx = await FX();
  let store = fx.emptyFxRateStore();
  for (const [currency, date, type, rate] of rows) {
    const result = fx.planFxRateEntry(store, { currency, date, type, rate, sourceNote: 'bot.or.th ตารางอัตราแลกเปลี่ยน (ทดสอบ)' }, { today: '2026-10-26', at: AT, by: BY });
    assert.ok(result.ok, `${currency} ${date} ${type}: ${result.key}`);
    store = result.store;
  }
  return store;
}
// A USD invoice draft as the screen builds it before the planner.
function usdDraft(fx, lookup, extra = {}) {
  return {
    id: 1, no: 'INV690901', date: '2026-10-16', branch: 'ubon', customer: 'Acme Ltd.', customerTaxId: '', currency: 'USD', ...fx.fxRateFieldsOf(lookup),
    items: [{ product: 'Router', qty: 3, priceFx: '333.335', costTotal: 0 }], useVat: 1, vatMode: 'add', taxInvoiceForm: 'full', ...extra
  };
}
const plain = value => JSON.parse(JSON.stringify(value));
const balanced = journal => { for (const entry of journal.entries) { const dr = entry.lines.reduce((s, l) => s + l.debit, 0), cr = entry.lines.reduce((s, l) => s + l.credit, 0); assert.equal(dr, cr, entry.id); } };
// Lines of an account given by its default CODE (the journal stores the account role; the chart maps role → code).
let ROLE_OF = null;
const linesOf = (entry, code) => entry.lines.filter(line => line.account === ROLE_OF[code]).map(line => [line.debit, line.credit]);
test.before(async () => { const j = await imp('erp-journal-core.js'); ROLE_OF = Object.fromEntries(j.DEFAULT_ACCOUNTS.map(row => [row.code, row.role])); });
// The sample plan's documents (as the packs hold them: _branch / _year / _month).
const docs = (plan, collection) => plan.documents.filter(d => d.collection === collection).map(d => ({ ...d.record, _branch: d.branch, _year: d.year, _month: d.month }));

test('r13b#1 a USD invoice on a Friday uses Thursday\'s rate (the BOT rate published on a day is the previous business day\'s); Saturday too', async () => {
  const fx = await FX();
  // Fri 16 Oct 2569: published that day = the average of Thu 15 Oct. Sat 17 Oct: the Friday announcement → Thu 15 again.
  assert.deepEqual(plain(fx.fxRateDateFor('2026-10-16', 'bot_avg_buying')), { rateDate: '2026-10-15', publishedOn: '2026-10-16', rolled: false, holidayTable: 'official' });
  assert.equal(fx.fxRateDateFor('2026-10-17', 'bot_avg_selling').rateDate, '2026-10-15');
  // A bank's own buying rate / the actual rate are of the day itself (previous business day on a weekend).
  assert.equal(fx.fxRateDateFor('2026-10-16', 'bank_buying').rateDate, '2026-10-16');
  assert.equal(fx.fxRateDateFor('2026-10-18', 'actual').rateDate, '2026-10-16');
  const store = await storeOf([['USD', '2026-10-15', 'bot_avg_buying', '32.6543'], ['USD', '2026-10-16', 'bot_avg_buying', '40']]);
  const lookup = fx.lookupFxRate(store, { currency: 'USD', date: '2026-10-16', type: 'bot_avg_buying' });
  assert.deepEqual([lookup.ok, lookup.rate, lookup.rateDate, lookup.id], [true, '32.6543', '2026-10-15', 'fxr-USD-2026-10-15-bot_avg_buying-v1']);
  // 3 × 333.335 = 1,000.005 → USD 1,000.01 (half-up to the cent) · baht = 1,000.01 × 32.6543 = 32,654.626543 → 32,654.63
  // · VAT 7 % of the baht subtotal = 2,285.8241 → 2,285.82 · total 34,940.45. The currency VAT 70.0007 → USD 70.00.
  const record = fx.applyFxToSalesDraft(usdDraft(fx, lookup), {});
  assert.deepEqual([record.fxSubtotal, record.subtotal, record.vatAmt, record.total, record.fxVat, record.amountFx, record.amountThb], [1000.01, 32654.63, 2285.82, 34940.45, 70, 1070.01, 34940.45]);
  assert.deepEqual([record.items[0].amountFx, record.items[0].amountThb, record.items[0].saleTotal], [1000.01, 32654.63, 32654.63]);
  // The same draft dated Friday with Friday's own row (40) as its rate is refused: the rule says Thursday.
  const wrong = { ...usdDraft(fx, lookup), fxRateDate: '2026-10-16', fxRateId: 'fxr-USD-2026-10-16-bot_avg_buying-v1', fxRate: '40' };
  assert.throws(() => fx.applyFxToSalesDraft(wrong, {}), error => error.key === 'rate.ruleDate' && error.params.expectedDate === '2026-10-15');
});

test('r13b#2 a document dated on a holiday: วันปิยมหาราช (Fri 23 Oct 2569) → Thursday\'s announcement → Wednesday\'s rate; the missing rate names that date', async () => {
  const fx = await FX();
  const rule = fx.fxRateDateFor('2026-10-23', 'bot_avg_buying');
  assert.deepEqual([rule.publishedOn, rule.rateDate, rule.rolled], ['2026-10-22', '2026-10-21', true]);
  // Mon 26 Oct: published Monday = the last business day before it = Thu 22 Oct (Fri 23 holiday, weekend).
  assert.equal(fx.fxRateDateFor('2026-10-26', 'bot_avg_selling').rateDate, '2026-10-22');
  // Month end 31 Jul 2569 (Fri) after the 28–30 Jul holidays: announcement of Fri 31 → the rate of Mon 27 Jul.
  assert.equal(fx.fxRateDateFor('2026-07-31', 'bot_avg_buying').rateDate, '2026-07-27');
  const missing = fx.lookupFxRate(fx.emptyFxRateStore(), { currency: 'USD', date: '2026-10-23', type: 'bot_avg_buying' });
  assert.deepEqual([missing.ok, missing.key, missing.params.rateDate], [false, 'rate.missing', '2026-10-21']);
  assert.match(fx.fxText(missing.key, missing.params, 'th'), /21/);
  assert.ok(fx.fxSkippedDays('2026-10-21', '2026-10-23').length >= 1, 'the screen can name the days in between');
});

test('r13b#3 export of goods (ป.132/2548): sold in the month → actual baht; not sold → BOT buying of the last business day; partly → mixed (the sample: 99,100.00)', async () => {
  const fx = await FX();
  const tax = await imp('erp-tax-reports-core.js');
  // Sep 2569: last day Wed 30 Sep → announcement of the 30th = the rate of Tue 29 Sep (33.0000).
  const store = await storeOf([['USD', '2026-09-09', 'bot_avg_buying', '32.6543'], ['USD', '2026-09-29', 'bot_avg_buying', '33'], ['USD', '2026-09-20', 'actual', '33.1'], ['USD', '2026-09-18', 'actual', '33.1']]);
  const lookup = fx.lookupFxRate(store, { currency: 'USD', date: '2026-09-10', type: 'bot_avg_buying' });
  const invoice = (id, amount) => ({ ...fx.applyFxToSalesDraft({ id, no: `INV69090${id}`, date: '2026-09-10', branch: 'ubon', _branch: 'ubon', customer: 'Mekong', currency: 'USD', ...fx.fxRateFieldsOf(lookup), items: [{ product: 'CCTV', qty: 1, priceFx: amount }], useVat: 2, vatMode: 'none', vatCategory: 'zero', exportKind: 'goods', exportDate: '2026-09-10', taxInvoiceForm: 'full' }, {}), _branch: 'ubon' });
  const sold = invoice(1, '1000'), unsold = invoice(2, '1000'), part = invoice(3, '3000');
  // 1,000 × 32.6543 = 32,654.30 baht in the books for each 1,000.
  assert.deepEqual([sold.total, unsold.total, part.total], [32654.3, 32654.3, 97962.9]);
  const receiptOf = (inv, date, amountFx, rate) => {
    const l = fx.lookupFxRate(store, { currency: 'USD', date, type: 'actual' });
    assert.equal(l.rate, rate);
    const plan = fx.planFxReceipt({ invoice: inv, related: { receipts: [] }, date, amountFx, ...fx.fxRateFieldsOf(l) });
    return { ...fx.fxReceiptRecord(inv, plan, l, { id: `r${inv.id}`, no: `REC${inv.id}`, date }), _branch: 'ubon' };
  };
  const receipts = [receiptOf(sold, '2026-09-20', '1000', '33.1'), receiptOf(part, '2026-09-18', '1000', '33.1')];
  const plan = fx.planFxMonthEnd({ period: '2026-09', invoices: [sold, unsold, part], receipts, rates: store });
  assert.deepEqual(plan.missing, []);
  const byNo = Object.fromEntries(plan.exportValues.map(row => [row.invoiceNo, [row.basis, row.thb, row.bookThb]]));
  // sold: 33,100.00 actual · unsold: 1,000 × 33 = 33,000.00 · part: 33,100.00 + 2,000 × 33 = 99,100.00.
  assert.deepEqual(byNo, { INV690901: ['actual', 33100, 32654.3], INV690902: ['month_end_rate', 33000, 32654.3], INV690903: ['mixed', 99100, 97962.9] });
  // Before the close the VAT report flags the provisional value; after it, ภ.พ.30 line 2 (0 %) uses the export values.
  const pending = tax.buildSalesTaxReport({ period: '2026-09', sources: [{ branch: 'ubon', invoices: [sold, unsold, part] }] });
  assert.equal(pending.warnings.exportPending.length, 3);
  assert.equal(pending.warnings.missingBuyerTaxId.length, 0, 'a foreign buyer of an export has no Thai tax ID');
  const fixed = [sold, unsold, part].map(inv => ({ ...inv, exportVat: plan.exportValues.find(row => row.invoiceNo === inv.no) }));
  const report = tax.buildSalesTaxReport({ period: '2026-09', sources: [{ branch: 'ubon', invoices: fixed }] });
  assert.deepEqual(report.rows.map(row => row.value), [33100, 33000, 99100]);
  assert.equal(report.warnings.exportPending.length, 0);
  const pp30 = tax.buildPp30Summary({ sales: report, purchases: { totals: { value: 0, vat: 0 } } });
  assert.deepEqual([pp30.lines[1], pp30.lines[2], pp30.lines[5]], [165200, 165200, 0]);
  assert.match(report.rows[2].note, /USD 3,000 .*ส่วนที่ขายได้ใช้ยอดบาทจริง/);
});

test('r13b#4 realised difference on a partial receipt: USD 1,000 of 3,000 at 33.1000 → gain 445.70 (4210); the last receipt clears the baht exactly', async () => {
  const fx = await FX();
  const j = await imp('erp-journal-core.js');
  const seed = await imp('erp-demo-seed-core.js');
  const plan = seed.buildDemoSeedPlan({ today: '2026-10-05' });
  const e = plan.fx.expected;
  // 3,000 × 32.6543 = 97,962.90 · first: 1,000 × 33.1 = 33,100.00 − 97,962.90 × 1/3 (= 32,654.30) = 445.70
  // · last: 2,000 × 32.8 = 65,600.00 − the remaining 65,308.60 = 291.40.
  // Fri 26 Jun 2569 (4 days before the month end) → the rate of Thu 25 Jun.
  assert.deepEqual([e.invoice.amountFx, e.invoice.total, e.invoice.date, e.invoice.rateDate], [3000, 97962.9, '2026-06-26', '2026-06-25']);
  assert.deepEqual(e.receipts.map(r => [r.amountFx, r.amountThb, r.settledThb, r.realisedThb]), [[1000, 33100, 32654.3, 445.7], [2000, 65600, 65308.6, 291.4]]);
  const invoices = docs(plan, 'invoices'), receipts = docs(plan, 'receipts');
  const invoice = invoices.find(row => row.no === e.invoice.no);
  const open = fx.fxInvoiceOpenItem(invoice, { receipts: receipts.filter(row => row.currency) });
  assert.deepEqual([open.openFx, open.openThb], [0, 0]);
  const journal = j.buildJournal({ invoices, receipts });
  balanced(journal);
  const first = journal.entries.find(entry => entry.kind === 'receipt' && entry.docNo === e.receipts[0].no);
  assert.deepEqual(linesOf(first, '4210'), [[0, 44570]]);
  assert.deepEqual(linesOf(first, '1130'), [[0, 3265430]]);
  assert.equal(first.lines.reduce((s, l) => s + (l.account !== ROLE_OF['1130'] && l.account !== ROLE_OF['4210'] ? l.debit : 0), 0), 3310000, 'the bank gets 33,100.00');
  // A partial receipt over the open amount is refused.
  const l = { rate: '33.1', per: 1, type: 'actual', rateDate: '2026-06-30', id: 'fxr-USD-2026-06-30-actual-v1', source: 'demo', sourceNote: 'x' };
  assert.throws(() => fx.planFxReceipt({ invoice, related: { receipts: [] }, date: '2026-06-30', amountFx: '3000.01', ...fx.fxRateFieldsOf(l) }), err => err.key === 'receipt.over');
  // … and a receipt dated before the invoice.
  assert.throws(() => fx.planFxReceipt({ invoice, related: { receipts: [] }, date: '2026-06-25', amountFx: '10', ...fx.fxRateFieldsOf({ ...l, rateDate: '2026-06-25' }) }), err => err.key === 'receipt.beforeInvoice');
});

test('r13b#5 month-end revaluation with reversal: open USD 2,000 × 33.0000 − carrying 65,308.60 = 691.40 on 30 Jun (Dr 1130 / Cr 4220), reversed on 1 Jul', async () => {
  const j = await imp('erp-journal-core.js');
  const seed = await imp('erp-demo-seed-core.js');
  const plan = seed.buildDemoSeedPlan({ today: '2026-10-05' });
  assert.deepEqual(plan.fx.expected.close.rows, [{ kind: 'ar', no: 'INV690601', openFx: 2000, carryingThb: 65308.6, revaluedThb: 66000, diffThb: 691.4 }]);
  const journal = j.buildJournal({ invoices: docs(plan, 'invoices'), receipts: docs(plan, 'receipts'), fxCloses: plan.fx.documents.closes });
  balanced(journal);
  const reval = journal.entries.find(entry => entry.kind === 'fx_revaluation');
  const reverse = journal.entries.find(entry => entry.kind === 'fx_revaluation_reverse');
  assert.deepEqual([reval.date, reverse.date], ['2026-06-30', '2026-07-01']);
  assert.deepEqual([linesOf(reval, '1130'), linesOf(reval, '4220')], [[[69140, 0]], [[0, 69140]]]);
  assert.deepEqual([linesOf(reverse, '1130'), linesOf(reverse, '4220')], [[[0, 69140]], [[69140, 0]]]);
  // No VAT line anywhere in the revaluation.
  assert.ok(![...reval.lines, ...reverse.lines].some(line => ['input_vat', 'input_vat_undue', 'output_vat', 'vat_payable'].includes(line.account)));
  // A payable revalues at the SELLING rate: diff = carrying − revalued (a dearer currency is a loss).
  const fx = await FX();
  const store = await storeOf([['JPY', '2026-09-29', 'bot_avg_selling', '23'], ['JPY', '2026-09-04', 'bot_avg_selling', '22.3456']]);
  const expense = { id: 'e1', _branch: 'ubon', branch: 'ubon', date: '2026-09-07', docNo: 'X-1', vendor: 'Sakura', currency: 'JPY', amountFx: 120000, amount: 26814.72, fxPayments: [] };
  const m = fx.planFxMonthEnd({ period: '2026-09', expenses: [expense], rates: store });
  // 1,200 × 23 = 27,600.00 → loss 26,814.72 − 27,600.00 = −785.28.
  assert.deepEqual(m.rows.map(row => [row.kind, row.rateType, row.revaluedThb, row.diffThb]), [['ap', 'bot_avg_selling', 27600, -785.28]]);
  assert.deepEqual([m.totals.gain, m.totals.loss, m.date, m.reverseDate], [0, -785.28, '2026-09-30', '2026-10-01']);
  // The month-end store accepts one posted close per month only (fail-closed).
  const close = { ...plan.fx.documents.closes[0] };
  assert.throws(() => fx.normalizeFxDocuments({ schemaVersion: 1, closes: [close, { ...close, id: 'other' }] }), err => err.key === 'store.closes');
});

test('r13b#6 ภ.ง.ด.54 / ภ.พ.36 with gross-up: JPY 120,000 at 22.5011 → cash 27,001.32, income 31,766.26, tax 4,764.94, PP.36 2,223.64 claimed next month; due by the 7th (rolled)', async () => {
  const fx = await FX();
  const j = await imp('erp-journal-core.js');
  const tax = await imp('erp-tax-reports-core.js');
  const seed = await imp('erp-demo-seed-core.js');
  const plan = seed.buildDemoSeedPlan({ today: '2026-10-05' });
  // cash 1,200 × 22.5011 = 27,001.32 · income 27,001.32 × 100 ÷ 85 = 31,766.2588 → 31,766.26 · tax 4,764.94 (borne, 5410)
  // · realised 26,814.72 − 27,001.32 = −186.60 (5420) · VAT 7 % × 31,766.26 = 2,223.6382 → 2,223.64 · claim 2026-07.
  assert.deepEqual(plan.fx.expected.expense, { docNo: 'SCS-INV-202606-118', date: '2026-06-05', amountFx: 120000, amount: 26814.72 });
  assert.deepEqual(plan.fx.expected.payment, { no: 'FXP690601', date: '2026-06-15', cashThb: 27001.32, settledThb: 26814.72, realisedThb: -186.6, incomeThb: 31766.26, whtThb: 4764.94, borneThb: 4764.94, pp36VatThb: 2223.64, claimPeriod: '2026-07' });
  const expenses = docs(plan, 'expenses');
  const pnd54 = fx.buildPnd54Report({ period: '2026-06', sources: [{ branch: 'ubon', expenses }] });
  assert.deepEqual([pnd54.rows.length, pnd54.totals.incomeThb, pnd54.totals.whtThb, pnd54.rows[0].grossUp, pnd54.rows[0].rate, pnd54.due.due], [1, 31766.26, 4764.94, true, 15, '2026-07-07']);
  const pp36 = fx.buildPp36Report({ period: '2026-06', sources: [{ branch: 'ubon', expenses }] });
  assert.deepEqual([pp36.totals.baseThb, pp36.totals.vatThb, pp36.rows[0].claimPeriod], [31766.26, 2223.64, '2026-07']);
  // The 7th of Feb 2569 is a Saturday → Mon 9 Feb.
  assert.deepEqual([fx.fxForeignDueDate('2026-01').due, fx.fxForeignDueDate('2026-01').rolled], ['2026-02-09', true]);
  // ภ.พ.36 input VAT in the purchase VAT report of the CLAIM month, not of the payment month.
  assert.equal(tax.buildPurchaseTaxReport({ period: '2026-06', sources: [{ branch: 'ubon', expenses }] }).rows.filter(row => row.kind === 'pp36').length, 0);
  const july = tax.buildPurchaseTaxReport({ period: '2026-07', sources: [{ branch: 'ubon', expenses }] });
  assert.deepEqual(july.rows.filter(row => row.kind === 'pp36').map(row => [row.value, row.vat]), [[31766.26, 2223.64]]);
  // Books: Dr 2111 26,814.72 · Dr 5410 4,764.94 · Dr 5420 186.60 / Cr 2133 4,764.94 · Cr bank 27,001.32; PP.36 Dr 1155 / Cr 2142;
  // 1 Jul: 1155 → 1154.
  const journal = j.buildJournal({ expenses });
  balanced(journal);
  const pay = journal.entries.find(entry => entry.kind === 'fx_payment');
  assert.deepEqual([linesOf(pay, '2111'), linesOf(pay, '5410'), linesOf(pay, '5420'), linesOf(pay, '2133'), linesOf(pay, '1155'), linesOf(pay, '2142')], [[[2681472, 0]], [[476494, 0]], [[18660, 0]], [[0, 476494]], [[222364, 0]], [[0, 222364]]]);
  const claim = journal.entries.find(entry => entry.kind === 'pp36_claim');
  assert.deepEqual([claim.date, linesOf(claim, '1154'), linesOf(claim, '1155')], ['2026-07-01', [[222364, 0]], [[0, 222364]]]);
  // Deducted (not grossed up): 15 % withheld in the currency JPY 18,000 → sent JPY 102,000 = 22,951.12 · tax on the income
  // 27,001.32 × 15 % = 4,050.198 → 4,050.20 · realised 26,814.72 − 22,951.12 − 4,050.20 = −186.60.
  const lookup = { rate: '22.5011', per: 100, type: 'bot_avg_selling', rateDate: '2026-06-12', id: 'fxr-JPY-2026-06-12-bot_avg_selling-v1', source: 'demo', sourceNote: 'x' };
  const record = { id: 'e', date: '2026-06-05', currency: 'JPY', amountFx: 120000, amount: 26814.72, fxPayments: [] };
  const deducted = fx.planFxPayment({ record, date: '2026-06-15', amountFx: '120000', ...fx.fxRateFieldsOf(lookup), wht: { enabled: true, incomeType: 'service', rate: 15, grossUp: false, payeeName: 'Sakura', payeeCountry: 'JP' } });
  assert.deepEqual([deducted.cashFxMinor, deducted.cashSatang, deducted.whtSatang, deducted.realisedSatang], [102000, 2295112, 405020, -18660]);
});

test('r13b#7 JPY has no decimals: amounts with sen are refused, conversions round half-up to the satang once', async () => {
  const fx = await FX();
  assert.deepEqual(['JPY', 'LAK', 'VND', 'KRW', 'MMK', 'USD', 'THB'].map(code => fx.currencyInfo(code).minor), [0, 0, 0, 0, 0, 2, 2]);
  assert.equal(fx.toMinorUnits('120000.5', 'JPY'), null);
  assert.equal(fx.toMinorUnits('120,000', 'JPY'), 120000);
  // JPY 1,001 at 21.54 per 100 yen = 215.6154 → 215.62 baht; JPY 999 → 215.1846 → 215.18.
  assert.equal(fx.convertToSatang(1001, 'JPY', '21.54', 100), 21562);
  assert.equal(fx.convertToSatang(999, 'JPY', '21.54', 100), 21518);
  // Lines: 3 × 333.5 = 1,000.5 → JPY 1,001 (half-up) · 1 × 0.4 = 0 → refused as an empty line? no: amount 0 is allowed only
  // inside a positive document; the baht split of the subtotal is exact (largest remainder).
  const plan = fx.planFxSalesAmounts({ currency: 'JPY', lines: [{ qty: 3, priceFx: '333.5' }, { qty: 1, priceFx: '1000' }], vatMode: 'add', rate: '21.54', per: 100 });
  // subtotal JPY 2,001 × 0.2154 = 431.0154 → 431.02 · VAT 30.1714 → 30.17 · split 1,001 / 1,000 of 431.02 = 215.62 / 215.40.
  assert.deepEqual([plan.subtotalFxMinor, plan.subtotalSatang, plan.vatSatang, plan.lines.map(l => l.amountThbSatang)], [2001, 43102, 3017, [21562, 21540]]);
  assert.equal(plan.lines.reduce((s, l) => s + l.amountThbSatang, 0), plan.subtotalSatang);
  assert.equal(fx.formatFx(120000, 'JPY'), 'JPY 120,000');
  assert.equal(fx.fxAmountWordsEn(120000, 'JPY'), 'JPY one hundred twenty thousand only');
});

test('r13b#8 stored baht is never recomputed: a corrected rate is a new version; the document keeps its rate and baht, the next one uses the correction', async () => {
  const fx = await FX();
  const j = await imp('erp-journal-core.js');
  let store = await storeOf([['USD', '2026-10-15', 'bot_avg_buying', '32.6543']]);
  const before = fx.lookupFxRate(store, { currency: 'USD', date: '2026-10-16', type: 'bot_avg_buying' });
  const invoice = { ...fx.applyFxToSalesDraft(usdDraft(fx, before), {}), _branch: 'ubon' };
  assert.equal(invoice.total, 34940.45);
  // A plain second entry of the same day / type is refused; a correction is version 2 that supersedes version 1.
  assert.equal(fx.planFxRateEntry(store, { currency: 'USD', date: '2026-10-15', type: 'bot_avg_buying', rate: '32.7', sourceNote: 'ตรวจใหม่' }, { today: '2026-10-26', at: AT, by: BY }).key, 'rate.duplicate');
  const corrected = fx.planFxRateEntry(store, { currency: 'USD', date: '2026-10-15', type: 'bot_avg_buying', rate: '32.7', sourceNote: 'ตรวจกับประกาศ ธปท. อีกครั้ง', correct: true }, { today: '2026-10-26', at: AT, by: BY });
  assert.ok(corrected.ok);
  store = corrected.store;
  assert.deepEqual([corrected.row.version, corrected.row.supersedes, store.rates.length], [2, 'fxr-USD-2026-10-15-bot_avg_buying-v1', 2]);
  assert.deepEqual(plain(store.rates[0]), plain(fx.normalizeFxRateStore(JSON.stringify(store)).rates[0]), 'version 1 is unchanged');
  const after = fx.lookupFxRate(store, { currency: 'USD', date: '2026-10-16', type: 'bot_avg_buying' });
  assert.deepEqual([after.rate, after.id], ['32.7', 'fxr-USD-2026-10-15-bot_avg_buying-v2']);
  // The issued invoice keeps 32.6543 / its baht; the journal posts the stored baht (no conversion in the journal).
  assert.deepEqual([invoice.fxRate, invoice.fxRateId, invoice.total], ['32.6543', 'fxr-USD-2026-10-15-bot_avg_buying-v1', 34940.45]);
  const entry = j.buildJournal({ invoices: [invoice] }).entries.find(e => e.kind === 'invoice');
  assert.deepEqual(linesOf(entry, '1130'), [[3494045, 0]]);
  const next = fx.applyFxToSalesDraft(usdDraft(fx, after, { id: 2, no: 'INV690902' }), {});
  // 1,000.01 × 32.7 = 32,700.327 → 32,700.33 (+ VAT 2,289.02).
  assert.deepEqual([next.subtotal, next.vatAmt], [32700.33, 2289.02]);
  // A damaged store (an edited row) stops every action (fail-closed).
  const broken = JSON.parse(JSON.stringify(store));
  broken.rates[0].rate = '30';
  broken.rates[0].id = 'x';
  assert.throws(() => fx.normalizeFxRateStore(broken), err => err.key === 'store.rates');
});

test('r13b#9 a missing rate blocks issuing (no silent fallback); a future rate, an empty evidence note and the BOT API source are refused', async () => {
  const fx = await FX();
  const finance = await imp('erp-document-finance-core.js');
  const store = await storeOf([['USD', '2026-10-14', 'bot_avg_buying', '32.6']]);
  // Wednesday's rate exists, Thursday's (the one Friday needs) does not → missing, never "the closest one".
  const lookup = fx.lookupFxRate(store, { currency: 'USD', date: '2026-10-16', type: 'bot_avg_buying' });
  assert.deepEqual([lookup.ok, lookup.key, lookup.params.rateDate, lookup.params.currency], [false, 'rate.missing', '2026-10-15', 'USD']);
  assert.match(fx.fxText(lookup.key, lookup.params, 'th'), /USD/);
  // A draft without valid rate fields cannot be planned into an invoice.
  assert.throws(() => finance.planInvoiceDocumentAction({ draft: { id: 1, no: 'INV690901', date: '2026-10-16', branch: 'ubon', customer: 'X', currency: 'USD', items: [{ product: 'A', qty: 1, priceFx: '10' }], useVat: 1 }, original: null, duplicateNumber: false, fx: { allowedCurrencies: ['USD'] } }), err => err.code === 'validation_error');
  // A currency the company has not allowed is refused too.
  const ok = fx.lookupFxRate(await storeOf([['USD', '2026-10-15', 'bot_avg_buying', '32.6']]), { currency: 'USD', date: '2026-10-16', type: 'bot_avg_buying' });
  assert.throws(() => finance.planInvoiceDocumentAction({ draft: usdDraft(fx, ok), original: null, duplicateNumber: false, fx: { allowedCurrencies: ['EUR'] } }), err => err.details?.fxKey === 'currency.notAllowed');
  const ctx = { today: '2026-10-26', at: AT, by: BY };
  assert.equal(fx.planFxRateEntry(store, { currency: 'USD', date: '2026-10-27', type: 'bot_avg_buying', rate: '32', sourceNote: 'ประกาศ ธปท.' }, ctx).key, 'rate.future');
  assert.equal(fx.planFxRateEntry(store, { currency: 'USD', date: '2026-10-20', type: 'bot_avg_buying', rate: '32', sourceNote: 'abc' }, ctx).key, 'rate.source');
  assert.equal(fx.planFxRateEntry(store, { currency: 'USD', date: '2026-10-20', type: 'bot_avg_buying', rate: '32', sourceNote: 'api api', source: 'bot_api' }, ctx).key, 'rate.sourceApi');
  assert.equal(fx.planFxRateEntry(store, { currency: 'XXX', date: '2026-10-20', type: 'bot_avg_buying', rate: '32', sourceNote: 'abcdef' }, ctx).key, 'currency.unknown');
  // The BOT adapter of this static demo never touches the network: it refuses.
  const adapter = fx.createUnavailableBotAdapter();
  assert.equal(adapter.available, false);
  await assert.rejects(adapter.fetchRates({ currency: 'USD' }), err => err.key === 'adapter.unavailable');
  // CSV import: every row checked before anything is written; a different value of a stored rate needs "corrections".
  const csv = 'วันที่,สกุลเงิน,ประเภทอัตรา,อัตรา,ต่อหน่วย,แหล่งที่มา\n14/10/2569,USD,bot_avg_buying,32.7,1,ธปท. ตาราง 14/10\n2026-10-13,JPY,bot_avg_selling,22.1,100,ธปท. ตาราง 13/10\n2026-10-13,USD,bot_avg_buying,abc,1,ธปท.';
  const preview = fx.planFxCsvImport(store, csv, ctx);
  assert.deepEqual(plain(preview.counts), { add: 1, correct: 0, skip: 0, error: 2 });
  const withCorrections = fx.planFxCsvImport(store, csv, { ...ctx, allowCorrections: true });
  assert.deepEqual(plain(withCorrections.counts), { add: 1, correct: 1, skip: 0, error: 1 });
});

test('r13b#10 the approval-number gate: a domestic tax invoice prints in baht (currency as ข้อมูลประกอบ) unless the approval number is set; exports and quotations print in the currency', async () => {
  const fx = await FX();
  const store = await storeOf([['USD', '2026-10-15', 'bot_avg_buying', '32.6543']]);
  const lookup = fx.lookupFxRate(store, { currency: 'USD', date: '2026-10-16', type: 'bot_avg_buying' });
  const without = fx.applyFxToSalesDraft(usdDraft(fx, lookup), {});
  assert.deepEqual([without.fxPrintMode, without.fxApprovalNo], ['thb', undefined]);
  const withApproval = fx.applyFxToSalesDraft(usdDraft(fx, lookup), { approval: { no: 'กค 0702/1234', date: '2026-01-15' } });
  assert.deepEqual([withApproval.fxPrintMode, withApproval.fxApprovalNo, withApproval.fxApprovalDate], ['fx', 'กค 0702/1234', '2026-01-15']);
  // The VAT is the baht VAT either way (ประกาศฯ 77/186: the baht VAT is shown on an approved foreign-currency invoice).
  assert.equal(withApproval.vatAmt, without.vatAmt);
  const exportInvoice = fx.applyFxToSalesDraft(usdDraft(fx, lookup, { useVat: 2, vatMode: 'none', vatCategory: 'zero', exportKind: 'goods', exportDate: '2026-10-16' }), {});
  assert.deepEqual([exportInvoice.fxPrintMode, exportInvoice.vatAmt, exportInvoice.exportKind], ['fx', 0, 'goods']);
  const quote = fx.applyFxToSalesDraft(usdDraft(fx, lookup), { kind: 'quote' });
  assert.equal(quote.fxPrintMode, 'fx');
  const info = fx.fxPrintInfo(without);
  assert.deepEqual([info.mode, info.rate, info.rateDate, info.totalFx, info.totalWordsEn], ['thb', '32.6543', '2026-10-15', '1,070.01', 'USD one thousand seventy and 01/100 only']);
  // A VAT-inclusive price and an abbreviated tax invoice are not offered in a currency.
  assert.throws(() => fx.applyFxToSalesDraft(usdDraft(fx, lookup, { useVat: 0, vatMode: 'extract' }), {}), err => err.key === 'vat.extract');
  assert.throws(() => fx.applyFxToSalesDraft(usdDraft(fx, lookup, { taxInvoiceForm: 'abbreviated' }), {}), err => err.key === 'doc.abbreviated');
  // Settings: functional currency THB fixed; the rate type is chosen once (a change after documents needs an approval ref).
  const settings = fx.normalizeFxSettings({ ...fx.defaultFxSettings(), allowedCurrencies: ['USD'] });
  assert.equal(fx.planFxSettingsChange(settings, { functionalCurrency: 'USD' }).key, 'settings.functional');
  assert.equal(fx.planFxSettingsChange(settings, { rateType: 'bank_buying' }, { documentsExist: true }).key, 'settings.rateTypeLocked');
  assert.ok(fx.planFxSettingsChange(settings, { rateType: 'bank_buying' }, { documentsExist: true, approvalRef: 'กค 0702/9', at: AT, by: BY }).ok);
  assert.equal(fx.planFxSettingsChange(settings, { taxInvoiceApproval: { no: 'กค 1', date: '' } }).key, 'settings.approvalDate');
  assert.throws(() => fx.normalizeFxSettings({ ...settings, extra: 1 }), err => err.key === 'store.settings');
});

test('r13b#11 journals balance (fuzz): random foreign invoices, partial receipts, payments abroad (deducted / grossed up, PP.36), closes and the sample story — Dr = Cr per entry, foreign AR / AP cleared exactly', async () => {
  const fx = await FX();
  const j = await imp('erp-journal-core.js');
  const seed = await imp('erp-demo-seed-core.js');
  let seedRandom = 20261026;
  const rnd = () => { seedRandom = (seedRandom * 1103515245 + 12345) % 2147483648; return seedRandom / 2147483648; };
  const codes = ['USD', 'EUR', 'JPY', 'CNY', 'LAK', 'GBP'];
  for (let round = 0; round < 40; round += 1) {
    const code = codes[round % codes.length];
    const info = fx.currencyInfo(code);
    const rate = (info.quotePer === 100 ? 15 + rnd() * 10 : code === 'LAK' ? 0.0015 + rnd() * 0.001 : 3 + rnd() * 40).toFixed(4);
    const l = (date, type) => ({ ok: true, rate: fx.normalizeRateText(rate), per: info.quotePer, type, rateDate: fx.fxRateDateFor(date, type).rateDate, id: `fxr-${code}-${fx.fxRateDateFor(date, type).rateDate}-${type}-v1`, source: 'manual', sourceNote: 'fuzz test' });
    const branch = rnd() < 0.5 ? 'ubon' : 'khonkaen';
    const date = '2026-09-10';
    const lines = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => ({ product: 'P', qty: 1 + Math.floor(rnd() * 5), priceFx: (rnd() * 900 + 1).toFixed(info.minor ? 2 : 0) }));
    const vat = rnd() < 0.5;
    const invoice = { ...fx.applyFxToSalesDraft({ id: `i${round}`, no: `INV${round}`, date, branch, customer: 'C', currency: code, ...fx.fxRateFieldsOf(l(date, 'bot_avg_buying')), items: lines, useVat: vat ? 1 : 2, vatMode: vat ? 'add' : 'none', vatCategory: vat ? 'standard' : 'zero', exportKind: vat ? undefined : 'goods', taxInvoiceForm: 'full' }, {}), _branch: branch };
    const total = fx.toMinorUnits(invoice.amountFx, code);
    const receipts = [];
    let paid = 0;
    for (const [k, receiptDate] of ['2026-09-20', '2026-10-05'].entries()) {
      const amount = k === 1 ? total - paid : Math.max(1, Math.floor(total * rnd()));
      if (!(amount > 0) || paid + amount > total) continue;
      const lookup = l(receiptDate, 'actual');
      lookup.rate = fx.normalizeRateText((Number(rate) * (0.95 + rnd() * 0.1)).toFixed(4));
      const plan = fx.planFxReceipt({ invoice, related: { receipts }, date: receiptDate, amountFx: fx.minorToMajor(amount, code), ...fx.fxRateFieldsOf(lookup) });
      receipts.push({ ...fx.fxReceiptRecord(invoice, plan, lookup, { id: `r${round}-${k}`, no: `REC${round}-${k}`, date: receiptDate }), _branch: branch });
      paid += amount;
    }
    assert.equal(fx.fxInvoiceOpenItem(invoice, { receipts }).openThb, 0, `invoice ${round} clears in baht`);
    const amountFx = (rnd() * 5000 + 10).toFixed(info.minor ? 2 : 0);
    const expense = { id: `e${round}`, _branch: branch, branch, date: '2026-09-05', docNo: `X${round}`, vendor: 'V', cat: 'อื่น ๆ', currency: code, amountFx: Number(amountFx), amount: fx.fxSatangToBaht(fx.convertToSatang(fx.toMinorUnits(amountFx, code), code, rate, info.quotePer)), fxPayments: [] };
    const first = Math.max(1, Math.floor(fx.toMinorUnits(amountFx, code) * rnd()));
    for (const [k, part] of [first, fx.toMinorUnits(amountFx, code) - first].entries()) {
      if (!(part > 0)) continue;
      const lookup = l('2026-09-15', 'bot_avg_selling');
      lookup.rate = fx.normalizeRateText((Number(rate) * (0.95 + rnd() * 0.1)).toFixed(4));
      const plan = fx.planFxPayment({ record: expense, date: '2026-09-15', amountFx: fx.minorToMajor(part, code), ...fx.fxRateFieldsOf(lookup), wht: rnd() < 0.7 ? { enabled: true, incomeType: 'service', rate: 15, grossUp: rnd() < 0.5, payeeName: 'V', payeeCountry: 'X' } : null, pp36: { enabled: rnd() < 0.6 } });
      expense.fxPayments.push(fx.fxPaymentRecord(plan, { id: `p${round}-${k}`, no: `FXP${round}${k}`, date: '2026-09-15', branch, ...fx.fxRateFieldsOf(lookup), createdAt: AT, createdBy: BY }));
    }
    assert.equal(fx.fxPayableOpenItem(expense).openThb, 0, `expense ${round} clears in baht`);
    const store = await storeOf([[code, fx.fxRateDateFor('2026-09-30', 'bot_avg_buying').rateDate, 'bot_avg_buying', fx.normalizeRateText(rate)], [code, fx.fxRateDateFor('2026-09-30', 'bot_avg_selling').rateDate, 'bot_avg_selling', fx.normalizeRateText(rate)]]);
    const month = fx.planFxMonthEnd({ period: '2026-09', invoices: [invoice], receipts, expenses: [expense], rates: store });
    const close = { id: `fxc-fuzz-${round}`, period: '2026-09', date: month.date, reverseDate: month.reverseDate, method: 'reverse', status: 'posted', createdAt: AT, createdBy: BY, rows: month.rows, exportValues: month.exportValues };
    const journal = j.buildJournal({ invoices: [invoice], receipts, expenses: [expense], fxCloses: fx.normalizeFxDocuments({ schemaVersion: 1, closes: [close] }).closes });
    balanced(journal);
    // Per branch, AR of the invoice and AP of the expense end at zero after everything (revaluation reversed).
    const net = code => journal.entries.reduce((s, e) => s + e.lines.filter(x => x.account === ROLE_OF[code]).reduce((a, x) => a + x.debit - x.credit, 0), 0);
    assert.equal(net('1130'), 0, `round ${round} AR`);
    assert.equal(net('2111'), 0, `round ${round} AP`);
  }
  // The whole sample (both branches, every document incl. the story): every entry balances.
  for (const today of ['2026-10-05', '2026-10-26', '2027-01-03', '2028-02-29']) {
    const plan = seed.buildDemoSeedPlan({ today });
    const journal = j.buildJournal({ invoices: docs(plan, 'invoices'), receipts: docs(plan, 'receipts'), expenses: docs(plan, 'expenses'), creditNotes: docs(plan, 'creditNotes'), debitNotes: docs(plan, 'debitNotes'), fxCloses: plan.fx.documents.closes });
    balanced(journal);
  }
});

test('r13b#12 tax reports use baht: the sample\'s S−3 sales report shows the export at 99,100.00 (0 %), ภ.พ.30 line 2; the THB tax story of S and S−1 is unchanged on several load dates', async () => {
  const tax = await imp('erp-tax-reports-core.js');
  const seed = await imp('erp-demo-seed-core.js');
  const sourcesOf = (plan, period, branch) => [{ branch, invoices: docs(plan, 'invoices').filter(r => r._branch === branch && tax.taxPeriodOfDate(r.date) === period), creditNotes: docs(plan, 'creditNotes').filter(r => r._branch === branch && tax.taxPeriodOfDate(r.date) === period), debitNotes: docs(plan, 'debitNotes').filter(r => r._branch === branch && tax.taxPeriodOfDate(r.date) === period), expenses: docs(plan, 'expenses').filter(r => r._branch === branch) }];
  const plan = seed.buildDemoSeedPlan({ today: '2026-10-05' });
  const sales = tax.buildSalesTaxReport({ period: '2026-06', sources: sourcesOf(plan, '2026-06', 'ubon') });
  const row = sales.rows.find(r => r.no === 'INV690601');
  assert.deepEqual([row.value, row.vat, row.total], [99100, 0, 99100]);
  const pp30 = tax.buildPp30Summary({ sales, purchases: tax.buildPurchaseTaxReport({ period: '2026-06', sources: sourcesOf(plan, '2026-06', 'ubon') }) });
  assert.ok(pp30.lines[2] >= 99100);
  // S and S−1 of the THB story: identical with and without the multi-currency story (the story is in S−3 / S−2).
  for (const today of ['2026-10-05', '2026-10-26', '2027-01-03', '2027-05-09']) {
    const p = seed.buildDemoSeedPlan({ today });
    const noFx = { ...p, documents: p.documents.filter(d => d.record.demoSeedStory !== 'fx-story') };
    for (const k of [0, -1]) {
      const period = tax.addTaxPeriods(p.storyPeriod, k);
      for (const branch of ['ubon', 'khonkaen']) {
        const a = tax.buildSalesTaxReport({ period, sources: sourcesOf(p, period, branch) }).totals;
        const b = tax.buildSalesTaxReport({ period, sources: sourcesOf(noFx, period, branch) }).totals;
        assert.deepEqual(a, b, `${today} ${period} ${branch} sales`);
        const c = tax.buildPurchaseTaxReport({ period, sources: sourcesOf(p, period, branch) }).totals;
        const d = tax.buildPurchaseTaxReport({ period, sources: sourcesOf(noFx, period, branch) }).totals;
        assert.deepEqual(c, d, `${today} ${period} ${branch} purchases`);
      }
    }
    assert.ok(p.documents.filter(d => d.record.demoSeedStory === 'fx-story').every(d => d.record.date < tax.taxPeriodFirstDay(tax.addTaxPeriods(p.storyPeriod, -1))), `${today}: the story is before S−1`);
  }
  // Two clocks (ADR-013): the hand-worked story figures hold on every load day around month ends (where the dates are
  // tightest), one or two establishments; no baht invoice is ever dated after the export invoice in its month.
  for (let y = 2026; y <= 2028; y += 1) for (let m = 0; m < 12; m += 1) for (const day of [1, 2, 3, 4, 28, 29, 30, 31]) {
    const at = new Date(Date.UTC(y, m, day));
    if (at.getUTCMonth() !== m) continue;
    const today = at.toISOString().slice(0, 10);
    for (const branchCount of [1, 2]) {
      const p = seed.buildDemoSeedPlan({ today, branchCount });
      const e = p.fx.expected;
      assert.deepEqual([e.invoice.total, e.receipts.map(r => r.realisedThb), e.close.rows.map(r => r.diffThb), e.close.exportValues.map(r => r.thb), e.payment.whtThb, e.payment.pp36VatThb], [97962.9, [445.7, 291.4], [691.4], [99100], 4764.94, 2223.64], `${today} ×${branchCount}`);
      const month = tax.taxPeriodOfDate(e.invoice.date);
      const later = p.documents.filter(d => d.collection === 'invoices' && d.record.demoSeedStory !== 'fx-story' && tax.taxPeriodOfDate(d.record.date) === month && d.record.date > e.invoice.date);
      assert.deepEqual(later.map(d => d.record.no), [], `${today} ×${branchCount}: a baht invoice after the export invoice`);
    }
  }
});
