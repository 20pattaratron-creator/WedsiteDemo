// Round 5 review fixes (ADR-018) — one regression test per confirmed finding, named `r5fix#<n>: …`.
// Each test fails on the round 5 part C snapshot and passes after the fix. Pure CSS items (#3 layout,
// #11 touch target) are checked here on the stylesheet text (jsdom loads no stylesheet and does no
// layout); the rendered sizes are measured in Chromium (Playwright), see ADR-018.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { JSDOM } = require('jsdom');
const { boot } = require('./dom-helper.cjs');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = el => String(el?.textContent || '').replace(/\s+/g, ' ').trim();
const money = value => Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const imp = file => import(pathToFileURL(path.join(ROOT, file)).href);
const plain = value => JSON.parse(JSON.stringify(value)); // jsdom-realm arrays → Node arrays for deepEqual
async function waitFor(check, tries = 200) {
  for (let i = 0; i < tries && !check(); i++) await sleep(25);
  return check();
}

async function bootWithSample(options = {}) {
  const h = await boot(options);
  const { w } = h;
  assert.equal(await waitFor(() => !!w.ERPDemoSeed && !!w.ERPProductExperience && !!w.document.getElementById('erp-dashboard-views') && !!w.ERPUiMenu?.getMenu('erp-demo')), true, 'app ready');
  assert.equal((await w.ERPDemoSeed.load()).status, 'loaded');
  await sleep(300);
  return h;
}
const toastText = (h) => `${h.messages.join('\n')}\n${text(h.w.document.getElementById('app-toast-container'))}`;
const rowCell = (d, selector, match) => [...d.querySelectorAll(`${selector} .erp-rowact`)].find(cell => match(JSON.parse(cell.dataset.rowFacts)));
const primaryOf = cell => cell?.querySelector('.erp-rowact-primary')?.dataset.rowAction ?? null;
const menuItems = d => [...(d.querySelector('.erp-menu.erp-rowact-menu:not([hidden])')?.querySelectorAll('[role="menuitem"]') || [])];
function chooseRowItem(d, cell, label) {
  cell.querySelector('[data-row-menu]').click();
  const item = menuItems(d).find(element => text(element).endsWith(label));
  assert.ok(item, `menu item "${label}" in [${menuItems(d).map(text).join(', ')}]`);
  item.click();
}

// ------------------------------------------------------------------ #1
test('r5fix#1: one shared "quote moved on" rule — by Sales Order id (number only for legacy rows), branch-scoped, live orders only', async () => {
  const shared = await imp('erp-shared-core.js');
  assert.equal(typeof shared.quoteMovedOnMatcher, 'function');
  const movedOn = shared.quoteMovedOnMatcher([
    { id: 'so1', sourceQuoteId: 42, sourceQuoteNo: 'QT1', branch: 'khonkaen', sourceQuoteBranch: 'khonkaen', status: 'confirmed' },
    { id: 'so2', sourceQuoteNo: 'QT9', branch: 'ubon' },                       // legacy order: number only
    { id: 'so3', sourceQuoteId: 7, sourceQuoteNo: 'QT7', branch: 'ubon', status: 'cancelled' }
  ]);
  assert.equal(movedOn({ id: 42, no: 'QT1', _branch: 'khonkaen' }), true, 'by id');
  assert.equal(movedOn({ id: 42, no: 'QT1', branch: 'ubon' }), false, 'same id, other branch');
  assert.equal(movedOn({ id: 43, no: 'QT1', branch: 'khonkaen' }), false, 'another quote with the same number: the id decides');
  assert.equal(movedOn({ no: 'QT1', branch: 'khonkaen' }), true, 'legacy quote without id: the number decides');
  assert.equal(movedOn({ id: 1, no: 'QT9', branch: 'ubon' }), true, 'legacy order without id: the number decides');
  assert.equal(movedOn({ id: 1, no: 'QT9', branch: 'khonkaen' }), false, 'legacy number, other branch');
  assert.equal(movedOn({ id: 7, no: 'QT7', branch: 'ubon' }), false, 'a cancelled Sales Order does not count');
  assert.equal(movedOn({ id: 8, productionNo: 'PD-1' }), true, 'production / invoice stamp');
  // One copy only: the Decision Council and the work queues import it instead of keeping their own.
  for (const file of ['erp-decision-council-core.js', 'erp-product-experience-core.js', 'erp-order-flow.js', 'app.js']) {
    assert.match(read(file), /quoteMovedOnMatcher/, file);
  }
  assert.doesNotMatch(read('erp-order-flow.js'), /quoteConverted/);
});

test('r5fix#1: a quotation turned into a Sales Order shows เอกสาร/PDF as its primary; "สั่งผลิต" stays in "⋯"; a cancelled order brings it back', async () => {
  const h = await bootWithSample();
  const { w } = h;
  const d = w.document;
  try {
    w.go('quote-list');
    w.renderQLList();
    const plain = [...d.querySelectorAll('#qtbl .erp-rowact')].map(cell => JSON.parse(cell.dataset.rowFacts)).find(f => !f.converted);
    assert.ok(plain, 'the sample data has a quote without production order / invoice');
    w.toggleApprove(plain.b, plain.y, plain.m, plain.id, true);
    const cell = () => rowCell(d, '#qtbl', f => String(f.id) === String(plain.id));
    assert.equal(primaryOf(cell()), 'production', 'approved, nothing downstream → สั่งผลิต');
    const order = { id: 'so_r5fix1', no: 'SO-R5FIX1', orderDate: '2026-09-01', customer: 'x', branch: plain.b, sourceQuoteId: plain.id, sourceQuoteNo: plain.no, sourceQuoteBranch: plain.b, sourceQuoteYear: plain.y, sourceQuoteMonth: plain.m, status: 'confirmed', items: [] };
    w.ERPOrderFlow.importData({ salesOrders: [order] });
    w.renderQLList();
    assert.equal(primaryOf(cell()), 'doc', 'Sales Order created → the document is the next step');
    assert.equal(JSON.parse(cell().dataset.rowFacts).converted, true);
    chooseRowItem(d, cell(), 'สั่งผลิต');                                  // still reachable in "⋯"
    assert.equal(d.querySelector('.panel.active')?.id, 'panel-production-form');
    w.ERPOrderFlow.importData({ salesOrders: [{ ...order, status: 'cancelled' }] });
    w.go('quote-list');
    w.renderQLList();
    assert.equal(primaryOf(cell()), 'production', 'the order was cancelled → สั่งผลิต again');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

// ------------------------------------------------------------------ #2
test('r5fix#2: business-rule override delete works by key on the saved rules; an unsaved preset has no delete; the question names the row removed', async () => {
  const h = await bootWithSample();
  const { w } = h;
  const d = w.document;
  try {
    const rules = w.BusinessRulesService.read();
    w.BusinessRulesService.save({ ...rules, productRules: [{ key: 'AAA', label: 'AAA stored rule', pricingMethod: 'margin', rate: 30 }, { key: 'BBB', label: 'BBB stored rule', pricingMethod: 'margin', rate: 20 }] });
    w.go('business-rules');
    w.BusinessRulesService.render();
    const asked = [];
    w.confirm = message => { asked.push(message); return true; };
    // An unsaved preset on screen: its rows are not the saved ones → no delete, and a note says why.
    w.BusinessRulesService.loadPreset('made_to_order');
    const table = d.getElementById('br-product-rules-table');
    assert.ok(table.querySelectorAll('tbody tr').length > 0, 'the preset rows are shown');
    assert.equal(table.querySelectorAll('[data-row-menu], [data-del-product]').length, 0, 'no delete on an unsaved preset');
    assert.match(text(table), /ยังไม่ได้บันทึก/);
    // A stale delete button (rendered before the preset) deletes nothing and asks nothing.
    const stale = d.createElement('button');
    stale.dataset.delProduct = 'AAA';
    d.body.append(stale);
    stale.click();
    stale.remove();
    assert.deepEqual(asked, []);
    assert.deepEqual(plain(w.BusinessRulesService.read().productRules.map(r => r.key)), ['AAA', 'BBB']);
    // The saved rules again: delete the SECOND row → the question names it and exactly it is removed.
    w.BusinessRulesService.render();
    const cell = rowCell(d, '#br-product-rules-table', f => f.key === 'BBB');
    assert.ok(cell, 'rows carry their stable key');
    chooseRowItem(d, cell, 'ลบ Override');
    assert.equal(asked.length, 1);
    assert.match(asked[0], /“BBB stored rule”/);
    assert.deepEqual(plain(w.BusinessRulesService.read().productRules.map(r => r.key)), ['AAA']);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

// ------------------------------------------------------------------ #3
test('r5fix#3: dashboard ภาพรวม — the sales-vs-target chart spans the full width on desktop (no 760 px minimum there), the donut sits beside "สิ่งที่ต้องทำ"', () => {
  const css = read('erp-ui.css').replace(/\s+/g, ' ');
  const html = read('index.html');
  assert.match(html, /class="card executive-chart-card erp-dash-mix-card"[\s\S]*id="exec-agency-pie-chart"[\s\S]*class="card executive-chart-card erp-dash-target-card"[\s\S]*id="exec-sales-target-chart"/, 'DOM order = visual order: donut, then the chart');
  assert.match(css, /\.erp-dash-summary>\.erp-dash-target-card\{grid-column:1\/-1\}/, 'the chart card spans the row');
  assert.match(css, /@media\(min-width:901px\)\{ \.erp-dash-summary \.erp-dash-target-card \.exec-chart-svg\{min-width:0\}/, 'desktop: no sideways scrolling');
  assert.match(css, /@media\(min-width:1200px\)\{ \.erp-dash-summary\{grid-template-columns:minmax\(0,1\.7fr\) minmax\(0,1fr\)\}/, '≥ 1200 px: todo | donut');
  // Phones keep the readable 700 px chart in a scroll box that opens at the latest months.
  assert.ok(read('executive-charts.css').includes('.exec-chart-svg{min-width:700px}}'), 'phones: 700 px chart in its scroll box');
  assert.match(read('erp-customer-experience.js'), /function scrollTargetChartToLatest\(\)/);
});

// ------------------------------------------------------------------ #4
test('r5fix#4: every number on the default dashboard tab agrees for all branches, HQ and branch 00001 (KPI, Decision Review, work queue)', async () => {
  const h = await bootWithSample();
  const { w } = h;
  const d = w.document;
  try {
    w.go('dashboard');
    const seen = [];
    for (const branch of ['', 'ubon', 'khonkaen']) {
      w.switchDashTab(branch || 'all');
      await sleep(150);                                  // Decision Council refreshes 20 ms after erp:dashboard-rendered
      const snap = w.ERPReceivables.snapshot(branch);
      const overdueCount = snap.alert.overdueCount, overdueTotal = snap.aging.totals.overdue;
      // KPI "เกินกำหนดชำระ"
      assert.equal(text(d.querySelector('#dash-ar-kpis [data-ar-kpi="overdue"] .val')), money(overdueTotal), `KPI ${branch || 'all'}`);
      // Decision Review: report and card
      const report = w.ERPDecisionCouncil.getReport();
      assert.equal(report.branch, branch);
      const ar001 = report.reviews.flatMap(r => r.findings).find(f => f.ruleId === 'AR_001');
      assert.ok(ar001, `AR_001 for ${branch || 'all'}`);
      assert.equal(ar001.summary, `ลูกหนี้เกินกำหนด ${overdueCount} ใบ รวม ฿${money(overdueTotal)}`);
      const card = d.getElementById('erp-decision-council-card');
      assert.ok(text(card).includes(ar001.summary), 'the card shows the same figures');
      assert.equal(card.querySelector('[data-council-scope]').dataset.councilScope, branch || 'all');
      // Work queue
      const queue = d.getElementById('erp-flow-dashboard-queue');
      assert.equal(queue.dataset.scope, branch || 'all');
      const metric = label => Number(text([...queue.querySelectorAll('.erp-flow-queue-metric')].find(m => text(m.querySelector('span')) === label)?.querySelector('b')));
      assert.equal(metric('ลูกหนี้เกินกำหนด'), overdueCount, `queue overdue ${branch || 'all'}`);
      const ar002 = report.reviews.flatMap(r => r.findings).find(f => f.ruleId === 'AR_002');
      assert.equal(metric('Invoice ยังไม่วางบิล'), Number(/^(\d+)/.exec(ar002?.summary || '0')[1]), 'unbilled: queue = Decision Review');
      seen.push([branch || 'all', overdueCount, money(overdueTotal)]);
    }
    // The sample data really differs per branch (the test discriminates).
    assert.ok(new Set(seen.map(s => s[2])).size === 3, JSON.stringify(seen));
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

// ------------------------------------------------------------------ #5
test('r5fix#5: single-flight keeps the double-click protection, says it in plain Thai, and exposes isBusy / whenIdle (no timing guesses)', async () => {
  const dom = new JSDOM('<body></body>', { url: 'https://erp.test', runScripts: 'outside-only' });
  const w = dom.window;
  let saves = 0;
  const messages = [];
  w.saveInvoice = async () => { saves += 1; };
  w.notify = (...args) => messages.push(args.join(' '));
  try {
    w.eval(read('local-demo-health.js'));
    assert.equal(await waitFor(() => w.saveInvoice.__demoSingleFlight === true), true, 'guard installed');
    assert.equal(typeof w.LocalDemoHealth.whenIdle, 'function');
    assert.equal(w.LocalDemoHealth.isBusy('saveInvoice'), false);
    await Promise.all([w.saveInvoice(), w.saveInvoice()]);         // a fast double click
    assert.equal(saves, 1, 'the 2nd click is dropped — no duplicate document');
    assert.deepEqual(messages, ['กำลังบันทึกเอกสารก่อนหน้า กรุณารอสักครู่ info']);
    assert.doesNotMatch(messages.join(' '), /saveInvoice/, 'no internal function name in the message');
    assert.equal(w.LocalDemoHealth.isBusy('saveInvoice'), true, 'still in the anti double-click window');
    await w.LocalDemoHealth.whenIdle('saveInvoice');
    assert.equal(w.LocalDemoHealth.isBusy('saveInvoice'), false);
    await w.saveInvoice();
    assert.equal(saves, 2, 'the next intentional save works');
    await w.LocalDemoHealth.whenIdle('saveInvoice');
    assert.equal(await Promise.race([w.LocalDemoHealth.whenIdle('saveInvoice').then(() => 'idle'), sleep(50).then(() => 'timeout')]), 'idle', 'idle → resolves at once');
  } finally { w.close(); }
  // The two UI tests wait for the guard instead of sleeping 300 ms.
  const abbr = read('tests/abbreviated-invoice.test.cjs');
  assert.equal((abbr.match(/whenIdle\('saveInvoice'\)/g) || []).length, 2);
  assert.doesNotMatch(abbr, /setTimeout\(r, 300\)\); \/\/ pre-existing race/);
});

// ------------------------------------------------------------------ #6
test('r5fix#6: delete / void in a closed period is refused BEFORE any question with the period-lock message; an open period behaves as before', async () => {
  const h = await bootWithSample();
  const { w } = h;
  const d = w.document;
  try {
    const I = w.ERPIntegrity;
    const asked = [];
    w.confirm = message => { asked.push(message); return false; };
    w.prompt = message => { asked.push(message); return null; };
    const LOCK_TEXT = /ถูกปิดถึง/;
    const lockAll = scope => w.ERPGovernance.lockPeriod({ branch: 'all', scope, throughDate: '2099-12-31', reason: 'r5fix#6' });
    const unlock = lock => w.ERPGovernance.unlockPeriod(lock.lockId, 'r5fix#6 done');
    const count = (doc, type) => w.loadFor(doc._branch, doc._year, doc._month)[type].length;
    const refusedQuietly = async (label, action, check) => {
      asked.length = 0; h.messages.length = 0;
      const toastBox = d.getElementById('app-toast-container'); if (toastBox) toastBox.innerHTML = '';
      await action();
      assert.deepEqual(asked, [], `${label}: no question before the refusal`);
      assert.match(toastText(h), LOCK_TEXT, `${label}: the period-lock message`);
      assert.match(toastText(h), /รายการนี้ถูกล็อกตามกติกาของระบบ/, `${label}: same text as a refused save`);
      check();
    };
    const business = I.business();
    const invoice = business.invoices.find(inv => I.live(inv) && inv._type !== 'issuedInvoices' && I.paymentSummary({ ...inv, branch: inv._branch }).paid === 0 && !(I.paymentSummary({ ...inv, branch: inv._branch }).credited > 0));
    const receipt = business.receipts.find(r => I.live(r) && !r.paymentId && !r.voided);
    const expense = business.expenses.find(e => e && e.id);
    const quote = business.quotes.find(q => q && q.id);
    assert.ok(invoice && receipt && expense && quote, 'sample rows');

    let lock = lockAll('sales');
    let before = count(invoice, 'invoices');
    // ADR-021: issued invoices / receipts are cancelled ("⋯ › ยกเลิก…"), never deleted — the cancel action is refused first.
    await refusedQuietly('invoice', () => w.ERPDocumentCancel.open('invoices', invoice._branch, invoice._year, invoice._month, String(invoice.id)), () => { assert.equal(count(invoice, 'invoices'), before); assert.ok(!d.querySelector('.erp-cancel-overlay'), 'no reason dialog'); });
    before = count(receipt, 'receipts');
    await refusedQuietly('receipt', () => w.ERPDocumentCancel.open('receipts', receipt._branch, receipt._year, receipt._month, String(receipt.id)), () => { assert.equal(count(receipt, 'receipts'), before); assert.ok(!d.querySelector('.erp-cancel-overlay'), 'no reason dialog'); });
    // Payment void (and the receipts it created).
    const payment = w.ERPOrderFlow.getStore().payments.find(p => !p.voided);
    assert.ok(payment, 'sample payment');
    await refusedQuietly('payment', () => w.ERPOrderFlow.voidPayment(payment.id), () => assert.notEqual(w.ERPOrderFlow.getStore().payments.find(p => p.id === payment.id).voided, true));
    // Credit note void: refused before the reason prompt.
    w.go('credit-note-list');
    w.ERPCreditNotes.renderList();
    const cnCell = rowCell(d, '#cnltbl', f => f.live);
    assert.ok(cnCell, 'a live credit note');
    const cn = JSON.parse(cnCell.dataset.rowFacts);
    await refusedQuietly('credit note', () => chooseRowItem(d, cnCell, 'ยกเลิกใบลดหนี้'), () => assert.notEqual(w.ERPCreditNotes.allCreditNotes().find(x => String(x.id) === String(cn.id)).voided, true));
    // Scopes: a sales lock does not stop an expense; quotes are not posted to a period (their saves are not locked either).
    await w.delDoc(expense._branch, expense._year, expense._month, 'expenses', expense.id);
    assert.equal(asked.length, 1, 'expense (purchase) still asks under a sales lock');
    asked.length = 0;
    await w.delDoc(quote._branch, quote._year, quote._month, 'quotes', quote.id);
    assert.equal(asked.length, 1, 'quote still asks');
    unlock(lock);
    lock = lockAll('purchase');
    before = count(expense, 'expenses');
    await refusedQuietly('expense', () => w.delDoc(expense._branch, expense._year, expense._month, 'expenses', expense.id), () => assert.equal(count(expense, 'expenses'), before));
    unlock(lock);
    // Open period: the cancel action asks for its reason (dialog); delete of an issued invoice is refused outright (ADR-021).
    asked.length = 0;
    w.confirm = message => { asked.push(message); return true; };
    before = count(invoice, 'invoices');
    await w.delDoc(invoice._branch, invoice._year, invoice._month, 'invoices', invoice.id);
    assert.equal(asked.length, 0, 'delete of an issued invoice: refused without a question');
    assert.equal(count(invoice, 'invoices'), before, 'never deleted');
    if (!w.ERPDocumentCancel.blockersFor('invoices', invoice._branch, invoice._year, invoice._month, String(invoice.id)).length) { assert.equal(w.ERPDocumentCancel.open('invoices', invoice._branch, invoice._year, invoice._month, String(invoice.id)), true); assert.ok(d.querySelector('.erp-cancel-overlay [role="dialog"]'), 'open period: the reason dialog'); w.ERPDocumentCancel.close(); }
    asked.length = 0;
    w.ERPOrderFlow.voidPayment(payment.id);
    assert.equal(asked.length, 1);
    assert.equal(w.ERPOrderFlow.getStore().payments.find(p => p.id === payment.id).voided, true);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

// ------------------------------------------------------------------ #7
const HOSTILE = '"><img src=x onerror=window.__xss=1>';
const HOSTILE_JS = "x');window.__xss=1;//\"><svg onload=window.__xss=2>";
function injected(d) {
  return [...d.querySelectorAll('img[src="x"], [onerror], svg[onload], [onload]')].filter(el => !el.closest('script'));
}
test('r5fix#7: every list, the dashboard, the order-flow tabs and the detail views render hostile document numbers / names / notes as text', async () => {
  const h = await bootWithSample();
  const { w } = h;
  const d = w.document;
  try {
    const now = new Date();
    const Y = now.getFullYear(), M = now.getMonth();
    const date = `${Y}-${String(M + 1).padStart(2, '0')}-05`;
    const x = suffix => `${HOSTILE}${suffix}`;
    const item = { product: x('P'), productCode: x('C'), unit: x('U'), qty: 1, priceUnit: 100, total: 100, costUnit: 10 };
    const common = { date, customer: x('cust'), salesPerson: x('sp'), note: x('note'), customerAddress: x('addr'), customerTaxId: x('tax'), contact: x('ct'), phone: x('ph'), email: x('em'), items: [item], subtotal: 100, vatAmt: 7, total: 107 };
    for (const branch of ['ubon', 'khonkaen']) {
      const pack = w.loadFor(branch, Y, M);
      pack.quotes = [...(pack.quotes || []), { ...common, id: `${HOSTILE_JS}q`, no: x('QT'), approved: true }];
      pack.invoices = [...(pack.invoices || []), { ...common, id: `${HOSTILE_JS}i`, no: x('INV'), sourceProductionNo: x('PD'), creditTerm: 'credit30' }];
      pack.receipts = [...(pack.receipts || []), { ...common, id: `${HOSTILE_JS}r`, no: x('RC'), invNo: x('INVREF'), whtAmount: 1, whtRate: x('wht') }];
      pack.issuedInvoices = [...(pack.issuedInvoices || []), { ...common, id: `${HOSTILE_JS}oi`, no: x('OI') }];
      pack.issuedReceipts = [...(pack.issuedReceipts || []), { ...common, id: `${HOSTILE_JS}or`, no: x('OR'), invNo: x('OIREF') }];
      pack.productions = [...(pack.productions || []), { ...common, id: `${HOSTILE_JS}p`, no: x('PDN'), maker: x('maker'), makerAddress: x('maddr'), job: x('job') }];
      pack.expenses = [...(pack.expenses || []), { id: `${HOSTILE_JS}e`, date, cat: x('cat'), vendor: x('vendor'), desc: x('desc'), docNo: x('docno'), by: x('by'), note: x('enote'), amount: 50 }];
      // A credit note: a copy of a sample one with hostile number / customer / reason / note / invoice reference.
      const sampleCn = w.ERPCreditNotes.allCreditNotes().find(cn => cn.lines?.length);
      if (sampleCn) pack.creditNotes = [...(pack.creditNotes || []), { ...plain(sampleCn), id: `${HOSTILE_JS}cn${branch}`, no: x('CN'), date, branch, customer: x('cncust'), reasonText: x('reason'), note: x('cnnote'), invoiceNos: [x('CNINV')], lines: plain(sampleCn.lines).map(line => ({ ...line, invoiceNo: x('CNLINE') })), returnItems: [] }];
      w.saveFor(branch, Y, M, pack);
    }
    w.ERPOrderFlow.importData({
      salesOrders: [{ id: `${HOSTILE_JS}so`, no: x('SO'), orderDate: date, customer: x('socust'), branch: 'ubon', owner: x('owner'), note: x('sonote'), status: 'confirmed', items: [{ id: 'l1', product: x('soitem'), qty: 1, unit: x('sou'), priceUnit: 10 }] }],
      billingNotes: [{ id: `${HOSTILE_JS}bn`, no: x('BN'), customer: x('bncust'), branch: 'ubon', status: 'draft', dueDate: date, lines: [] }],
      payments: [{ id: `${HOSTILE_JS}pay`, no: x('PAY'), date, method: x('method'), amount: 1, allocations: [] }]
    });
    const master = w.MasterDataPersistence.readSnapshot();
    master.contacts = [...master.contacts, { id: `${HOSTILE_JS}c`, name: x('contact'), role: 'both', entityType: 'company', address: x('caddr'), taxId: x('ctax'), contactPerson: x('cp'), phone: x('cph'), email: x('cem'), note: x('cnote'), active: true }];
    master.products = [...master.products, { code: x('SKU'), name: x('product'), category: x('pcat'), unit: x('punit'), standardCost: 1, defaultPrice: 2, flowType: 'inventory', fulfillmentType: 'stock', active: true }];
    assert.equal(w.MasterDataPersistence.writeSnapshot(master), true);
    w.__xss = undefined;
    const check = where => {
      const bad = injected(d);
      assert.deepEqual(bad.map(el => el.outerHTML.slice(0, 120)), [], `${where}: injected element`);
      assert.equal(w.__xss, undefined, where);
    };
    const lists = [
      ['quote-list', () => w.renderQLList()], ['invoice-list', () => w.renderIList()], ['receipt-list', () => w.renderRList()],
      ['issued-invoice-list', () => w.renderIssuedInvoiceList()], ['issued-receipt-list', () => w.renderIssuedReceiptList()],
      ['expense-list', () => w.renderEList()], ['production-list', () => w.renderPList()],
      ['credit-note-list', () => w.ERPCreditNotes.renderList()], ['master-data', () => w.renderMasterData()]
    ];
    for (const [panel, render] of lists) {
      for (const id of ['ql', 'il', 'rl', 'oil', 'orl', 'el', 'pl']) { const month = d.getElementById(`${id}-month`); if (month) month.value = ''; }
      w.go(panel); render();
      assert.ok(d.querySelector('.panel.active').textContent.includes(HOSTILE), `${panel}: the hostile text is shown as text`);
      check(panel);
    }
    w.go('dashboard');
    for (const view of ['summary', 'receivables', 'sales']) { w.ERPCustomerExperience.selectDashboardView(view); w.renderDash(); await sleep(60); check(`dashboard ${view}`); }
    for (const tab of ['overview', 'sales-orders', 'billing', 'trace']) { w.ERPOrderFlow.openTab(tab); await sleep(20); check(`order flow ${tab}`); }
    for (const panel of ['work-home', 'approval-center', 'customer-portal']) { if (d.getElementById(`panel-${panel}`)) { w.go(panel); await sleep(80); check(panel); } }
    // Detail views of every document type.
    for (const [type, coll, suffix] of [['quote', 'quotes', 'q'], ['invoice', 'invoices', 'i'], ['receipt', 'receipts', 'r'], ['production', 'productions', 'p'], ['expense', 'expenses', 'e']]) {
      w.showDetailById(type, 'ubon', Y, M, `${HOSTILE_JS}${suffix}`);
      assert.ok(text(d.getElementById('modal-body')).includes(HOSTILE), `${type} detail shows the text`);
      check(`${type} detail`);
      assert.equal(w.loadFor('ubon', Y, M)[coll].some(r => r.id === `${HOSTILE_JS}${suffix}`), true);
    }
    w.showIssuedDocumentDetail('issuedInvoices', 'ubon', Y, M, `${HOSTILE_JS}oi`); check('issued detail');
    // Search (Ctrl+K) and Customer 360 list the same records.
    w.ERPCustomerExperience.openSearch('img src'); await sleep(30);
    assert.ok(d.querySelectorAll('.erp-search-result').length > 0, 'search finds the hostile records');
    check('search');
    w.ERPCustomerExperience.openCustomer360(x('cust')); await sleep(30); check('customer 360');
    // The approve / paid checkboxes pass the record id as a JS string literal, not raw code.
    w.go('quote-list'); w.renderQLList();
    const approve = [...d.querySelectorAll('#qtbl input[type="checkbox"]')].find(input => (input.getAttribute('onchange') || '').includes('window.__xss'));
    assert.ok(approve, 'hostile quote row');
    assert.match(approve.getAttribute('onchange'), /^toggleApprove\('(ubon|khonkaen)',\d+,\d+,"x'\);window\.__xss=1;\/\/\\"><svg onload=window\.__xss=2>q",this\.checked\)$/);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

// ------------------------------------------------------------------ #8
test('r5fix#8: menus close when focus leaves them or on page navigation; Escape closes a menu only while focus is in it or on its button', async () => {
  const h = await bootWithSample();
  const { w } = h;
  const d = w.document;
  try {
    const button = d.getElementById('erp-demo-menu-btn');
    const menu = () => d.getElementById('erp-demo-menu');
    const open = () => { button.click(); assert.equal(menu().hidden, false, 'opened'); assert.ok(menu().contains(d.activeElement), 'focus in the menu'); };
    // Focus moves to another control (Tab past the menu, Ctrl+K search …) → closed, focus stays there.
    open();
    const outside = d.querySelector('#dash-month') || d.querySelector('input, select');
    outside.focus();
    assert.equal(menu().hidden, true, 'focus left → closed');
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(d.activeElement, outside);
    // Escape while focus is elsewhere is not taken by the menu.
    open();
    d.activeElement.blur();
    const esc = new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    d.body.dispatchEvent(esc);
    assert.equal(esc.defaultPrevented, false, 'Escape left to the other handlers');
    assert.equal(menu().hidden, false, 'not this menu’s Escape');
    // Escape with focus in the menu: closes and returns focus to the button (unchanged).
    menu().querySelector('[role="menuitem"]').focus();
    d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(menu().hidden, true);
    assert.equal(d.activeElement, button);
    // go() navigation closes an open menu — the header menu and a row "⋯" menu alike.
    open();
    w.go('quote-list');
    assert.equal(menu().hidden, true, 'go() closes the Demo menu');
    w.renderQLList();
    const more = d.querySelector('#qtbl [data-row-menu]');
    more.click();
    assert.equal(more.getAttribute('aria-expanded'), 'true');
    w.go('invoice-list');
    assert.equal(more.getAttribute('aria-expanded'), 'false', 'go() closes a row menu');
    assert.equal(d.querySelectorAll('.erp-menu.erp-rowact-menu:not([hidden])').length, 0);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

// ------------------------------------------------------------------ #9
const COLLAPSED_KEY = 'erp_tenant::customer-showcase-local::erp_nav_collapsed_sections_v1';
test('r5fix#9: the remembered collapsed sidebar sections survive start-up and a visit to a page the mode hides; a real move still opens its section', async () => {
  const h = await boot({ beforeScripts: w => w.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(['home', 'data'])) });
  const { w } = h;
  const d = w.document;
  try {
    assert.equal(await waitFor(() => d.querySelector('#panel-work-home.active') !== null), true, 'start-up redirect to งานของฉัน done');
    await sleep(100);
    const collapsed = () => [...d.querySelectorAll('.sidebar .nav-group.is-collapsed')].map(g => g.dataset.navSection).sort();
    assert.deepEqual(JSON.parse(w.localStorage.getItem(COLLAPSED_KEY)).sort(), ['data', 'home'], 'start-up did not overwrite the choice');
    assert.deepEqual(collapsed(), ['data', 'home']);
    // Simple mode hides advanced-only pages (analytics): going there must not open / store a section.
    w.go('analytics');
    await sleep(60);
    assert.deepEqual(JSON.parse(w.localStorage.getItem(COLLAPSED_KEY)).sort(), ['data', 'home']);
    // A real move to an entry of a collapsed, visible section still opens it (unchanged behaviour).
    w.go('master-data');
    await sleep(60);
    const dataSection = d.querySelector('.nav-item.active')?.closest('.nav-group')?.dataset.navSection;
    assert.ok(dataSection);
    assert.equal(JSON.parse(w.localStorage.getItem(COLLAPSED_KEY)).includes(dataSection), false, `${dataSection} opened on a real move`);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

// ------------------------------------------------------------------ #10
test('r5fix#10: line-item remove buttons are labelled trash icons (quotation, invoice, receipt, PO) with an icon-button target (≥ 36 / ≥ 44 px, ADR-019)', async () => {
  const h = await bootWithSample();
  const { w } = h;
  const d = w.document;
  try {
    for (const [add, body] of [['addQItem', 'q-items-body'], ['addIItem', 'i-items-body'], ['addRItem', 'r-items-body'], ['pcAddPoItem', 'po-items-body']]) {
      w[add]({ product: 'สินค้า', qty: 1, unit: 'ชิ้น', priceUnit: 10 });
      const rows = d.getElementById(body).querySelectorAll('tr');
      const remove = rows[rows.length - 1].querySelector('button.erp-item-remove');
      assert.ok(remove, `${add}: remove button`);
      assert.equal(remove.getAttribute('aria-label'), 'ลบรายการ');
      assert.equal(remove.getAttribute('type'), 'button');
      assert.ok(remove.querySelector('svg.erp-icon use'), `${add}: line icon`);
      assert.equal(text(remove), '', `${add}: no "×" text`);
      // jsdom does not run inline handlers: the handler text is checked — same "remove the row, recalculate".
      assert.match(remove.getAttribute('onclick'), /^this\.closest\('tr'\)\.remove\(\);(calcQ|calcI|calcR|pcCalcPo)\(\)$/, `${add}: still removes the row`);
    }
    const css = read('erp-ui.css').replace(/\s+/g, ' ');
    // ADR-019: was a fixed 32 px; now the shared icon-button token (36 px, 44 px on ≤ 900 px — tests/ui-control-sizes.test.cjs).
    assert.match(css, /\.erp-item-remove\{[^}]*min-width:var\(--erp-icon-btn-size\);min-height:var\(--erp-icon-btn-size\)/);
    assert.match(css, /@media\(max-width:900px\)\{\.erp-item-remove\{min-width:var\(--erp-touch-target\);min-height:var\(--erp-touch-target\)\}\}/);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

// ------------------------------------------------------------------ #11
test('r5fix#11: on ≤ 900 px the KPI link "ดูรายงานอายุลูกหนี้" is a touch target (the phone rule comes after the desktop rule)', () => {
  const css = read('erp-ui.css');
  // ADR-019: the desktop rule was min-height:0 (an 18 px inline link); it is now a small-button-high link.
  const base = css.indexOf('.dash-ar-kpis .dash-ar-kpi-link{min-height:var(--erp-btn-height-sm)');
  assert.ok(base >= 0);
  // The last rule for the link is inside a max-width:900px block, after the desktop one.
  const last = css.lastIndexOf('.dash-ar-kpis .dash-ar-kpi-link{');
  assert.ok(last > base, 'a later rule exists');
  const media = css.lastIndexOf('@media', last);
  assert.match(css.slice(media, media + 30), /^@media\(max-width:900px\)\{/);
  assert.ok(css.indexOf('}\n}', media) > last || css.indexOf('}}', media) > last, 'inside that media block');
  assert.match(css.slice(last, css.indexOf('}', last)), /min-height:var\(--erp-touch-target\)/);
});

// ------------------------------------------------------------------ #12
test('r5fix#12: dashboard view tabs control role="tabpanel" blocks (aria-controls → ids, aria-labelledby → the tab)', async () => {
  const h = await bootWithSample();
  const { w } = h;
  const d = w.document;
  try {
    w.go('dashboard');
    w.renderDash();
    await sleep(80);
    const tabs = [...d.querySelectorAll('#erp-dashboard-views [role="tab"]')];
    assert.ok(tabs.length >= 3);
    for (const view of ['summary', 'receivables', 'sales']) {
      w.ERPCustomerExperience.selectDashboardView(view);
      const tab = d.getElementById(`erp-dashboard-view-${view}`);
      const ids = (tab.getAttribute('aria-controls') || '').split(/\s+/).filter(Boolean);
      assert.ok(ids.length > 0, `${view}: aria-controls`);
      for (const id of ids) {
        const panel = d.getElementById(id);
        assert.ok(panel, `${view}: #${id} exists`);
        assert.equal(panel.getAttribute('role'), 'tabpanel', `#${id} role`);
        assert.equal(panel.classList.contains('erp-view-hidden'), false, `#${id} shown in ${view}`);
        assert.ok(panel.getAttribute('aria-labelledby').split(' ').includes(tab.id), `#${id} labelled by its tab`);
      }
    }
    // A block's own heading label is kept; a live region keeps its role.
    assert.ok(d.getElementById('ar-aging-card').getAttribute('aria-labelledby').split(' ').includes('ar-aging-title'));
    assert.equal(d.getElementById('ar-overdue-banner')?.getAttribute('role') ?? 'status', 'status');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});
