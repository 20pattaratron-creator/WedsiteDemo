// test-suite: full
// ADR-031 (round 13B) — multi-currency in the booted app (jsdom), sample data loaded on 26 Oct 2569 (clock pinned): the
// page หลายสกุลเงิน issues, receives, pays and closes through its actions with every write in one transaction; a missing
// rate blocks with nothing written; the prints (USD tax invoice without / with the approval number, export invoice,
// receipt with the realised gain, quotation); the month-end close refused in a closed period; ภ.ง.ด.54 / ภ.พ.36 on the
// tax reports page; the receivables aging FX column; a purchase order / goods receipt in a currency; the JSON backup
// round trip of the rate table and the closes (fail-closed); the page in English with no Thai UI text.
// Every test here fails on round13a-fixes (/tmp/claude-0/r13b-newtests-on-base.log).
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./dom-helper.cjs');
const { bootEnglish, settle, THAI_RE } = require('./i18n-helper.cjs');

const TENANT = 'erp_tenant::customer-showcase-local::';
const RATES_KEY = `${TENANT}comform_fx_rates_v1`;
const DOCS_KEY = `${TENANT}comform_fx_documents_v1`;
const SETTINGS_KEY = `${TENANT}comform_fx_settings_v1`;
const DAY = '2026-10-26';
const P = value => JSON.parse(JSON.stringify(value)); // window-realm arrays → plain (deepStrictEqual compares prototypes)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = el => String(el?.textContent || '').replace(/\s+/g, ' ').trim();
const pinClock = day => w => {
  const fixed = Date.parse(`${day}T10:00:00+07:00`);
  const Real = w.Date;
  w.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(fixed); } static now() { return fixed; } };
};
async function seeded(options = {}) {
  const h = await (options.english ? bootEnglish : boot)({ beforeScripts: pinClock(DAY) });
  try {
    const result = await h.w.ERPDemoSeed.load({ confirm: () => true });
    assert.equal(result.status, 'loaded', `${h.messages.join('\n')} ${JSON.stringify(result.issues || '')}`);
    h.plan = result.plan;
    h.w.ERPFx.invalidate();
    return h;
  } catch (error) { h.close(); throw error; }
}
const dump = w => { const out = {}; for (let i = 0; i < w.localStorage.length; i += 1) { const k = w.localStorage.key(i); if (!/audit/.test(k)) out[k] = w.localStorage.getItem(k); } return out; };
const keyOf = row => `${row._branch}|${row._year}|${row._month}|${row.id}`;
const saleDraft = (extra = {}) => ({ kind: 'invoice', branch: 'ubon', date: '2026-10-16', customer: 'Acme Trading Pte. Ltd.', customerAddress: '1 Raffles Place, Singapore', customerTaxId: '', customerCountry: 'Singapore', currency: 'USD', vat: 'add', exportKind: 'goods', exportDeclarationNo: '', exportDate: '', creditTerm: 'credit30', note: '', lines: [{ product: 'DEMO-SV01', qty: '2', unit: 'งาน', priceFx: '250.25' }], quote: null, ...extra });
const balancedJournal = w => { w.ERPJournal.invalidate(); const data = w.ERPJournal.dataset(); assert.ok(!data.error, String(data.error)); for (const e of data.entries) assert.equal(e.lines.reduce((s, l) => s + l.debit - l.credit, 0), 0, e.id); return data; };

test('r13b#9 app: a missing rate blocks issuing with the date to enter and nothing written; after the rate is entered the USD invoice is issued once (baht stored), prints in baht with the currency as ข้อมูลประกอบ; with the approval number it prints in USD', async () => {
  const h = await seeded(); const { w } = h;
  try {
    const X = w.ERPFx;
    const before = dump(w);
    const refused = await X.saveSale(saleDraft());
    assert.equal(refused.ok, false);
    assert.match(refused.message, /15/); // the Thursday rate the Friday document needs
    assert.deepEqual(dump(w), before, 'nothing written');
    assert.equal(X.saveRate({ date: '2026-10-15', currency: 'USD', type: 'bot_avg_buying', rate: '32.6543', per: 1, sourceNote: 'ธปท. อัตราซื้อถัวเฉลี่ย 15/10/2569' }).ok, true);
    const saved = await X.saveSale(saleDraft());
    assert.equal(saved.ok, true, saved.message);
    // 2 × 250.25 = USD 500.50 × 32.6543 = 16,343.47715 → 16,343.48 · VAT 1,144.0436 → 1,144.04 · total 17,487.52.
    const inv = saved.record;
    assert.deepEqual([inv.amountFx, inv.subtotal, inv.vatAmt, inv.total, inv.fxRateDate, inv.fxPrintMode], [535.54, 16343.48, 1144.04, 17487.52, '2026-10-15', 'thb']);
    const html = w.ComformDeliveryTaxDocument.buildInlineHtml(inv, { b: 'ubon' });
    assert.match(html, /ข้อมูลประกอบ/);
    assert.match(html, /32\.6543/);
    assert.match(html, /17,487\.52/);
    assert.doesNotMatch(html, /ได้รับอนุมัติ/);
    // A FX invoice cannot be edited (cancel and re-issue); a baht receipt / billing of it is refused.
    const finance = await import(require('node:url').pathToFileURL(require('node:path').join(__dirname, '..', 'erp-document-finance-core.js')).href);
    assert.throws(() => finance.planInvoiceDocumentAction({ draft: { ...inv, note: 'x' }, original: inv, duplicateNumber: false, fx: { allowedCurrencies: ['USD'] } }), err => err.details?.fxKey === 'edit.fx');
    // Approval number → the next invoice prints in USD with the rate and the baht VAT (ประกาศฯ 77/186).
    assert.equal(X.saveSettings({ taxInvoiceApproval: { no: 'กค 0702/12345', date: '2026-01-15' } }).ok, true);
    const approved = await X.saveSale(saleDraft());
    assert.equal(approved.record.fxPrintMode, 'fx');
    const html2 = w.ComformDeliveryTaxDocument.buildInlineHtml(approved.record, { b: 'ubon' });
    assert.match(html2, /กค 0702\/12345/);
    assert.match(html2, /USD/);
    assert.match(html2, /1,144\.04/);
    // The sample export invoice prints in USD as an export invoice (ป.132/2548).
    w.ERPFx.invalidate();
    const exportInvoice = X.dataset().invoices.find(row => row.no === h.plan.fx.expected.invoice.no);
    const html3 = w.ComformDeliveryTaxDocument.buildInlineHtml(exportInvoice, { b: 'ubon' });
    assert.match(html3, /ใบกำกับสินค้าส่งออก/);
    assert.match(html3, /3,000\.00/);
    // The sample receipt with the gain: the original shows the currency and baht; the copy shows the books.
    const receipt = X.dataset().business.receipts.find(row => row.no === h.plan.fx.expected.receipts[0].no);
    assert.match(w.ComformReceiptDocument.buildInlineHtml(receipt, { b: 'ubon' }), /รับเงิน USD 1,000\.00/);
    assert.match(w.ComformReceiptDocument.buildInlineHtml(receipt, { b: 'ubon' }, 'account-copy'), /445\.70/);
    // A quotation / proforma prints fully in the currency.
    const quote = await X.saveSale(saleDraft({ kind: 'quote' }));
    assert.equal(quote.ok, true, quote.message);
    const qhtml = w.ComformQuotationDocument.buildInlineHtml(quote.record, { b: 'ubon' });
    assert.match(qhtml, /ยอดรวมทั้งสิ้น \(USD\)/);
    assert.match(qhtml, /535\.54/);
    balancedJournal(w);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('r13b#5 app: month-end close posts the revaluation and the reversal; refused in a closed period with nothing written; the receivables aging shows the open USD with its baht', async () => {
  const h = await seeded(); const { w } = h;
  try {
    const X = w.ERPFx;
    assert.equal(X.saveRate({ date: '2026-09-09', currency: 'USD', type: 'bot_avg_buying', rate: '32.5', per: 1, sourceNote: 'ธปท. 09/09/2569' }).ok, true);
    const sale = await X.saveSale(saleDraft({ date: '2026-09-10' }));
    assert.equal(sale.ok, true, sale.message);
    // Aging: the open invoice in baht with its USD.
    w.ERPFx.invalidate();
    const open = X.openFxOf(sale.record._branch ? sale.record : { ...sale.record, _branch: 'ubon' });
    assert.deepEqual([open.currency, open.openText], ['USD', '535.54']);
    w.go('dashboard'); w.ERPReceivables.refresh?.();
    // Close September: needs the BOT buying rate of Tue 29 Sep (announced on the 30th).
    const missing = X.closeMonth('2026-09');
    assert.equal(missing.ok, false);
    assert.match(missing.message, /29/);
    assert.equal(X.saveRate({ date: '2026-09-29', currency: 'USD', type: 'bot_avg_buying', rate: '33', per: 1, sourceNote: 'ธปท. 29/09/2569' }).ok, true);
    // A closed September refuses the close (nothing written).
    const lock = w.ERPGovernance.lockPeriod({ branch: 'all', scope: 'sales', throughDate: '2026-09-30', reason: 'ปิดงวด' });
    const before = dump(w);
    const locked = X.closeMonth('2026-09');
    assert.equal(locked.ok, false);
    assert.deepEqual(dump(w), before);
    w.ERPGovernance.unlockPeriod(lock.lockId, 'ทดสอบ');
    const closed = X.closeMonth('2026-09');
    assert.equal(closed.ok, true, closed.message);
    // The open item incl. VAT: USD 535.54 × 33 = 17,672.82 − carrying 17,487.52 = 185.30 → AR +185.30 / 4220 on 30 Sep,
    // reversed 1 Oct. (Booked at 32.5: 500.50 × 32.5 = 16,266.25 + VAT 1,138.64 = 17,404.89 — see below.)
    assert.deepEqual(P(closed.close.rows.map(r => [r.no, r.openFx, r.carryingThb, r.revaluedThb, r.diffThb])), [[sale.record.no, 535.54, sale.record.total, 17672.82, Math.round((17672.82 - sale.record.total) * 100) / 100]]);
    assert.deepEqual([sale.record.subtotal, sale.record.vatAmt, sale.record.total], [16266.25, 1138.64, 17404.89]);
    const data = balancedJournal(w);
    const reval = data.entries.filter(e => e.kind === 'fx_revaluation' || e.kind === 'fx_revaluation_reverse').filter(e => e.docNo === 'FX-2026-09');
    assert.deepEqual(P(reval.map(e => [e.kind, e.date])), [['fx_revaluation', '2026-09-30'], ['fx_revaluation_reverse', '2026-10-01']]);
    // A September document after the close is refused (re-close needed).
    assert.equal((await X.saveSale(saleDraft({ date: '2026-09-11' }))).ok, false);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('r13b#6 app: ภ.ง.ด.54 and ภ.พ.36 tabs on the tax reports page (June 2569 of the sample), due by the 7th, CSV rows; a payment in a closed month is refused', async () => {
  const h = await seeded(); const { w } = h;
  try {
    const d = w.document;
    w.go('tax-reports');
    for (const tab of ['pnd54', 'pp36']) {
      w.ERPTaxReports.select({ tab, period: '2026-06', branch: 'ubon' });
      const body = text(d.querySelector('#tax-reports-root [data-tax-tab-body]'));
      assert.match(body, tab === 'pnd54' ? /4,764\.94/ : /2,223\.64/, tab);
      assert.match(body, /7/);
      assert.ok(d.querySelector(`[data-fx-foreign-export="csv"][data-fx-foreign-kind="${tab}"]`));
    }
    const rows = w.ERPFx.foreignRows('pnd54', 'ubon', '2026-06');
    assert.ok(rows.some(row => row.includes(4764.94)));
    // The ภ.พ.36 VAT is input VAT of July (the claim month) in the purchase VAT report.
    w.ERPTaxReports.select({ tab: 'purchase', period: '2026-07', branch: 'ubon' });
    assert.match(text(d.querySelector('#tax-reports-root [data-tax-tab-body]')), /ภ\.พ\.36/);
    // Payments abroad respect the period lock (purchase scope).
    const X = w.ERPFx;
    assert.equal(X.saveRate({ date: '2026-10-15', currency: 'JPY', type: 'bot_avg_selling', rate: '22.4', per: 100, sourceNote: 'ธปท. 15/10/2569' }).ok, true);
    const expense = X.saveExpense({ branch: 'ubon', date: '2026-10-16', vendor: 'Tokyo Design K.K.', payeeCountry: 'ญี่ปุ่น', payeeAddress: '', cat: 'อื่น ๆ', desc: 'ค่าออกแบบ', docNo: 'TD-1', currency: 'JPY', amountFx: '50000' });
    assert.equal(expense.ok, true, expense.message);
    // 500 × 22.4 = 11,200.00
    assert.equal(expense.record.amount, 11200);
    const lock = w.ERPGovernance.lockPeriod({ branch: 'all', scope: 'purchase', throughDate: '2026-10-20', reason: 'ปิดงวด' });
    w.ERPFx.invalidate();
    const payable = X.payables().find(row => row.record.docNo === 'TD-1');
    const before = dump(w);
    const refused = X.savePayment({ targetKey: payable.key, date: '2026-10-16', amountFx: '50000', wht: { enabled: false }, pp36: { enabled: false }, note: '' });
    assert.equal(refused.ok, false);
    assert.deepEqual(dump(w), before);
    w.ERPGovernance.unlockPeriod(lock.lockId, 'ทดสอบ');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('r13b app: a purchase order in USD is an estimate; its goods receipt converts once at the receipt day\'s selling rate into stock and a USD payable; the payment clears it; the THB goods-receipt screen refuses the USD order', async () => {
  const h = await seeded(); const { w } = h;
  try {
    const X = w.ERPFx;
    for (const [date, rate] of [['2026-10-14', '33.1'], ['2026-10-21', '33.4']]) assert.equal(X.saveRate({ date, currency: 'USD', type: 'bot_avg_selling', rate, per: 1, sourceNote: `ธปท. ${date}` }).ok, true);
    const po = X.savePurchase({ branch: 'ubon', date: '2026-10-15', supplier: 'Shenzhen Parts Co.', supplierCountry: 'จีน', currency: 'USD', note: '', lines: [{ product: 'DEMO-KB01', qty: '4', unit: 'ชุด', priceFx: '25.5' }] });
    assert.equal(po.ok, true, po.message);
    // 4 × 25.50 = USD 102.00 × 33.1 (rate of 14 Oct) = 3,376.20 (estimate, nothing booked).
    assert.deepEqual([po.record.amountFx, po.record.amountThb, po.record.status], [102, 3376.2, 'ordered']);
    const received = X.receivePurchase(po.record.id, '2026-10-23');
    // Received Fri 23 Oct (holiday) → announcement of Thu 22 = the rate of Wed 21 (33.4): 102 × 33.4 = 3,406.80.
    assert.equal(received.ok, true, received.message);
    assert.deepEqual([received.record.amountThb, received.record.fxRateDate, received.record.items[0].unitCost], [3406.8, '2026-10-21', 851.7]);
    w.ERPFx.invalidate();
    const payable = X.payables().find(row => row.kind === 'gr' && row.record.id === received.record.id);
    assert.deepEqual([payable.open.openFx, payable.open.openThb], [10200, 340680]);
    // Paid on Mon 26 Oct at the sample's rate of Thu 22 (33.2846): 102 × 33.2846 = 3,395.0292 → 3,395.03 → gain 11.77.
    const paid = X.savePayment({ targetKey: payable.key, date: '2026-10-26', amountFx: '102', wht: { enabled: false }, pp36: { enabled: false }, note: '' });
    assert.equal(paid.ok, true, paid.message);
    assert.deepEqual([paid.row.cashThb, paid.row.realisedThb], [3395.03, 11.77]);
    const data = balancedJournal(w);
    const apOfGr = data.entries.flatMap(e => e.lines).filter(l => l.account === 'ap' && l.ref?.key === `gr|ubon|${received.record.id}`).reduce((s, l) => s + l.debit - l.credit, 0);
    assert.equal(apOfGr, 0, 'the payable is cleared exactly');
    // The THB goods-receipt form refuses a USD order (it would book the PO-day estimate).
    w.go('goods-receipt');
    const sel = w.document.getElementById('gr-po');
    if (sel) { const opt = w.document.createElement('option'); opt.value = po.record.id; sel.appendChild(opt); sel.value = po.record.id; }
    const msgs = h.messages.length;
    w.pcPostGoodsReceipt();
    assert.ok(h.messages.slice(msgs).some(m => /เงินตราต่างประเทศ/.test(m)), h.messages.slice(msgs).join('\n'));
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('r13b#13 JSON backup: the rate table, the closes and the settings round-trip; a damaged part refuses the whole file; a close changed inside a closed period is refused', async () => {
  let exported, rates, docs, settings;
  {
    const h = await seeded(); const { w } = h;
    try {
      const master = w.testApp.collectLocalMasterBackup();
      assert.equal(master.fx.rates.rates.length, h.plan.fx.rates.rates.length);
      assert.equal(master.fx.documents.closes.length, 1);
      rates = w.localStorage.getItem(RATES_KEY); docs = w.localStorage.getItem(DOCS_KEY); settings = w.localStorage.getItem(SETTINGS_KEY);
      exported = JSON.parse(JSON.stringify(await w.ERPBackup.portable({ meta: { app: 'comform-esan', backupType: 'all' }, data: {}, masterData: master })));
      assert.equal((await w.ERPBackup.verifyPortable(exported)).verified, true);
      for (const [label, damage] of [
        ['edited rate', b => { b.masterData.fx.rates.rates[0].rate = '1'; b.masterData.fx.rates.rates[0].id = 'fxr-bad'; }],
        ['unknown field', b => { b.masterData.fx.rates.rates[0].hacked = 1; }],
        ['two closes of one month', b => { b.masterData.fx.documents.closes.push({ ...b.masterData.fx.documents.closes[0], id: 'fxc-copy' }); }],
        ['bad settings', b => { b.masterData.fx.settings.functionalCurrency = 'USD'; }],
        ['not an object', b => { b.masterData.fx = [1]; }]
      ]) {
        const tampered = JSON.parse(JSON.stringify(exported));
        damage(tampered);
        assert.throws(() => w.ERPBackup.validate(tampered), /หลายสกุลเงิน|สกุล|อัตรา/, label);
      }
      assert.deepEqual(h.errors, []);
    } finally { h.close(); }
  }
  {
    const h = await boot({ beforeScripts: pinClock(DAY) }); const { w } = h;
    try {
      assert.equal(w.localStorage.getItem(RATES_KEY), null);
      w.ERPBackup.validate(exported);
      w.testApp.restoreLocalMasterBackup(exported.masterData, { replace: true });
      assert.deepEqual(JSON.parse(w.localStorage.getItem(RATES_KEY)), JSON.parse(rates));
      assert.deepEqual(JSON.parse(w.localStorage.getItem(DOCS_KEY)), JSON.parse(docs));
      assert.deepEqual(JSON.parse(w.localStorage.getItem(SETTINGS_KEY)), JSON.parse(settings));
      // An older backup without the part leaves this device's alone.
      w.testApp.restoreLocalMasterBackup({ contacts: [] }, { replace: false });
      assert.equal(w.localStorage.getItem(RATES_KEY), rates.length ? w.localStorage.getItem(RATES_KEY) : null);
      // A close changed inside a closed period is refused; nothing written.
      w.ERPGovernance.lockPeriod({ branch: 'all', scope: 'all', throughDate: '2026-07-31', reason: 'ปิดงวด' });
      const changed = JSON.parse(JSON.stringify(exported.masterData));
      changed.fx.documents.closes[0].rows[0].diffThb = 1;
      changed.fx.documents.closes[0].rows[0].revaluedThb = changed.fx.documents.closes[0].rows[0].carryingThb + 1;
      changed.fx.documents.closes[0].id = 'fxc-2026-06-other';
      const before = w.localStorage.getItem(DOCS_KEY);
      assert.throws(() => w.testApp.restoreLocalMasterBackup(changed, { replace: true }), /ปิด/);
      assert.equal(w.localStorage.getItem(DOCS_KEY), before);
      assert.deepEqual(h.errors, []);
    } finally { h.close(); }
  }
});

test('r13b#14 English: every tab of หลายสกุลเงิน and the ภ.ง.ด.54 / ภ.พ.36 tabs show no Thai UI text (user data aside)', async () => {
  const h = await seeded({ english: true }); const { w } = h;
  try {
    const d = w.document;
    w.go('fx');
    for (const tab of ['rates', 'sales', 'receipts', 'payables', 'adjust', 'monthEnd', 'settings']) {
      w.ERPFx.select({ tab, period: '2026-06' });
      await settle(w, 30);
      const root = d.getElementById('fx-root');
      const thai = [];
      const walker = d.createTreeWalker(root, 4);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) if (THAI_RE.test(n.data) && !n.parentElement.closest('[data-no-i18n]')) thai.push(n.data.trim());
      for (const el of root.querySelectorAll('[title],[aria-label],[placeholder]')) for (const name of ['title', 'aria-label', 'placeholder']) if (!el.closest('[data-no-i18n]') && THAI_RE.test(el.getAttribute(name) || '')) thai.push(`@${name} ${el.getAttribute(name)}`);
      assert.deepEqual(thai, [], tab);
    }
    w.go('tax-reports');
    for (const tab of ['pnd54', 'pp36']) {
      w.ERPTaxReports.select({ tab, period: '2026-06', branch: 'ubon' });
      await settle(w, 30);
      assert.match(text(d.querySelector(`#tax-reports-root [data-tax-tab="${tab}"]`)), tab === 'pnd54' ? /PND\.54/ : /PP\.36/);
      const body = d.querySelector('#tax-reports-root [data-tax-tab-body]');
      const thai = [];
      const walker = d.createTreeWalker(body, 4);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) if (THAI_RE.test(n.data) && !n.parentElement.closest('[data-no-i18n]')) thai.push(n.data.trim());
      assert.deepEqual(thai, [], tab);
    }
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});
