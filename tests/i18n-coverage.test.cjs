// test-suite: full
// ADR-026 coverage audit of the English UI (jsdom, sample data): every screen, tab, row menu and dialog the test
// can open is visited in English, and every piece of Thai text still on screen is collected — text nodes and the
// placeholder / title / aria-label / alt attributes, plus toasts and confirm / alert / prompt messages. Excluded:
// user data (elements marked data-no-i18n) and printed-document previews (data-no-i18n="doc", which stay Thai like
// the print). Stored user data shown elsewhere (a product name in a chart label) is reported as `unmarked`, not as a
// gap. The test fails on any untranslated UI text outside the short allowlist below; the report is written to
// I18N_COVERAGE_RESULTS.json at the project root.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { bootEnglish, settle, collectThai, userDataCorpus, isUserDataPiece, normalize, sleep, THAI_RE } = require('./i18n-helper.cjs');

const ROOT = path.resolve(__dirname, '..');
const REPORT = path.join(ROOT, 'I18N_COVERAGE_RESULTS.json');

// Justified exceptions: Thai shown on purpose next to (or instead of) English.
const ALLOW = [
  'ภาษา / Language', // the language switch names itself in both languages (aria-label)
  'ภาษาไทย' // the TH button's title: the language's own name
];

const first = (rows, test = () => true) => rows.find(test) || null;
const ref = row => [row._branch, row._year, row._month, String(row.id)];

// One step = one thing a user can do; collect() runs after each.
function steps(w) {
  const d = w.document;
  const biz = () => w.ERPIntegrity.business();
  const click = selector => { const el = d.querySelector(selector); if (!el) throw new Error(`missing ${selector}`); el.click(); return el; };
  const key = (el, name) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  const closeOverlays = () => { d.querySelectorAll('.doc-preview-modal-close, .erp-cancel-dialog [data-cancel-close], .modal-overlay.open .modal-close').forEach(b => b.click()); d.getElementById('doc-preview-modal-overlay')?.remove(); };
  const list = [];
  const add = (name, run) => list.push({ name, run });

  add('dashboard views', async () => {
    w.go('dashboard');
    for (const tab of [...d.querySelectorAll('#panel-dashboard [role="tab"]')]) { tab.click(); await settle(w, 30); collectInto(w, `dashboard ${normalize(tab.textContent).slice(0, 24)}`); }
  });
  for (const panel of [...d.querySelectorAll('.panel')].map(p => p.id.slice(6))) add(`panel ${panel}`, async () => { w.go(panel); });
  add('tax reports: every tab, head office, September 2026', async () => {
    w.go('tax-reports');
    const set = (id, value) => { const el = d.getElementById(id); el.value = value; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
    for (const tab of [...d.querySelectorAll('#tax-reports-root [data-tax-tab]')].map(b => b.dataset.taxTab)) {
      for (const branch of ['ubon', 'khonkaen']) {
        d.querySelector(`#tax-reports-root [data-tax-tab="${tab}"]`).click();
        set('tax-rpt-month', '9'); set('tax-rpt-year', '2026');
        if (d.getElementById('tax-rpt-branch')) set('tax-rpt-branch', branch);
        await settle(w, 30);
        collectInto(w, `tax ${tab} ${branch}`); // every tab and branch is audited, not only the last one
      }
    }
  });
  // ADR-027: วิเคราะห์และคาดการณ์ — every tab for the company and each branch, every dimension and period type of
  // the comparisons, every "?" help card, the product view of the forecast, and the work-queue reorder card.
  add('analysis & forecast: every tab, branch, dimension, period type and help card', async () => {
    w.go('analytics-forecast');
    const A = w.ERPAnalytics;
    for (const branch of ['all', 'ubon', 'khonkaen']) {
      for (const tab of ['compare', 'abc', 'forecast', 'reorder']) {
        A.select({ tab, branch, period: '', focus: '' });
        await settle(w, 20);
        collectInto(w, `analysis ${tab} ${branch}`);
      }
    }
    for (const dimension of ['product', 'customer', 'branch', 'category']) for (const periodType of ['month', 'quarter', 'year']) {
      A.select({ tab: 'compare', branch: 'all', dimension, periodType, period: '', basis: periodType === 'month' ? 'previous' : 'lastYear' });
      await settle(w, 10);
      collectInto(w, `analysis compare ${dimension} ${periodType}`);
    }
    A.select({ tab: 'forecast', branch: 'all', focus: '' });
    A.select({ focus: A.view().products[0].key }); // the first product's own forecast
    await settle(w, 10);
    collectInto(w, 'analysis forecast product');
    for (const tab of ['compare', 'abc', 'forecast', 'reorder']) {
      A.select({ tab, branch: 'all', focus: '' });
      for (const button of [...d.querySelectorAll('#afc-root [data-afc-help]')]) {
        button.click();
        await settle(w, 5);
        collectInto(w, `analysis help ${button.dataset.afcHelp}`);
        d.querySelector('[data-afc-help-close]')?.click();
      }
    }
    w.go('work-home');
    await settle(w, 20);
  });
  // ADR-028 (round 11): ต้นทุนและกำไรต่องาน — every tab for the company and each branch, the four profit dimensions ×
  // the period types, every job's cost sheet with its entry forms, the stock card of every costed item, the dashboard card.
  add('job costing: every tab, branch, profit dimension and period type, each job sheet and stock card', async () => {
    w.go('job-costing');
    const C = w.ERPCosting;
    for (const branch of ['all', 'ubon', 'khonkaen']) {
      for (const tab of ['jobs', 'profit', 'stock', 'valuation', 'overhead', 'settings']) {
        C.select({ tab, branch, stockBranch: branch });
        await settle(w, 10);
        collectInto(w, `costing ${tab} ${branch}`);
      }
    }
    for (const dimension of ['job', 'customer', 'product', 'month']) for (const periodType of ['month', 'quarter', 'year', 'all']) {
      C.select({ tab: 'profit', branch: 'all', dimension, periodType, period: '' });
      await settle(w, 5);
      collectInto(w, `costing profit ${dimension} ${periodType}`);
    }
    for (const job of C.dataset().jobs) {
      C.select({ tab: 'jobs', branch: 'all', jobKey: job.key });
      await settle(w, 5);
      collectInto(w, `costing sheet ${job.no}`);
    }
    for (const product of C.dataset().products.filter(p => p.flowType === 'inventory' && p.fulfillmentType === 'stock')) {
      C.select({ tab: 'stock', stockSku: product.code, stockBranch: 'all' });
      await settle(w, 5);
      collectInto(w, `costing stock card ${product.code}`);
    }
    w.go('dashboard');
    await settle(w, 30);
    collectInto(w, 'dashboard gross-profit card');
  });
  // ADR-029 (round 12): สมุดบัญชีและปิดเดือน — every tab for the company and each branch, September and October, the
  // ledger of every account in use, a manual-entry line on AR (its open-item list), an opening import preview with
  // errors; ตั้งค่าบริษัท with the chart-of-accounts card (every section open) and the PromptPay card (on, bill payment).
  add('books & month-end: every tab, branch and period, every ledger, the manual / opening forms, the settings cards', async () => {
    w.go('accounting');
    const J = w.ERPJournal;
    for (const period of ['2026-09', '2026-10']) for (const branch of ['all', 'ubon', 'khonkaen']) for (const tab of ['journal', 'ledger', 'trial', 'pack', 'manual', 'opening']) {
      J.select({ tab, branch, period });
      await settle(w, 5);
      collectInto(w, `books ${tab} ${branch} ${period}`);
    }
    J.select({ tab: 'trial', branch: 'all', period: '2026-09' });
    for (const code of J.view().tb.rows.map(row => row.code)) {
      J.select({ tab: 'ledger', account: code });
      await settle(w, 2);
      collectInto(w, `books ledger ${code}`);
    }
    J.select({ tab: 'manual', manual: { date: '2026-10-20', branch: 'ubon', memo: '', lines: [{ account: 'ar', debit: '', credit: '1', memo: '', openItem: '' }, { account: 'bank', debit: '1', credit: '', memo: '', openItem: '' }] } });
    await settle(w, 5);
    collectInto(w, 'books manual AR line');
    J.select({ tab: 'opening' });
    J.previewOpening('ประเภท,สาขา,รหัส,ชื่อ,เลขที่เอกสาร,วันที่เอกสาร,วันครบกำหนด,จำนวน,ต้นทุนต่อหน่วย,ยอดคงค้าง\nXX,9,NOPE,,,bad,,-1,x,0\nAR,00000,C,ลูกค้า,D1,2026-05-01,,,,100', '2026-06-01');
    await settle(w, 20);
    collectInto(w, 'books opening preview');
    w.go('saas-admin');
    await settle(w, 30);
    d.querySelectorAll('#acc-coa-card details, #promptpay-card details').forEach(el => { el.open = true; });
    collectInto(w, 'settings chart of accounts + PromptPay off');
    w.ERPPromptPay.saveSettings({ ...w.ERPPromptPay.readSettings(), enabled: true, idType: 'mobile', promptPayId: '0812345678' });
    await settle(w, 20);
    collectInto(w, 'settings PromptPay on');
    w.ERPPromptPay.saveSettings({ ...w.ERPPromptPay.readSettings(), enabled: true, billPayment: { enabled: true, billerId: '010556100707501', ref2: '' } });
    await settle(w, 20);
    collectInto(w, 'settings PromptPay bill payment');
    w.ERPPromptPay.saveSettings({ ...w.ERPPromptPay.readSettings(), enabled: false, billPayment: { enabled: false, billerId: '', ref2: '' } });
    w.go('work-home');
    await settle(w, 20);
  });
  // ADR-031: หลายสกุลเงิน — every tab (the sample's June story month too), a missing-rate refusal, the payment form with
  // ภ.ง.ด.54 / ภ.พ.36, the CSV preview with errors, the purchase-order form, the settings card on ตั้งค่าบริษัท.
  add('multi-currency: every tab, the forms and refusals, the settings card', async () => {
    w.go('fx');
    const X = w.ERPFx;
    for (const period of ['2026-06', '2026-09']) for (const tab of ['rates', 'sales', 'receipts', 'payables', 'adjust', 'monthEnd', 'settings']) {
      X.select({ tab, period });
      await settle(w, 5);
      collectInto(w, `fx ${tab} ${period}`);
    }
    X.select({ tab: 'sales', sale: { kind: 'invoice', branch: 'ubon', date: '2026-10-23', customer: 'A', customerAddress: '', customerTaxId: '', customerCountry: '', currency: 'EUR', vat: 'add', exportKind: 'goods', exportDeclarationNo: '', exportDate: '', creditTerm: 'credit30', note: '', lines: [{ product: 'DEMO-SV01', qty: '1', unit: 'งาน', priceFx: '10' }], quote: null } });
    await settle(w, 5);
    collectInto(w, 'fx sale missing rate');
    await X.saveSale();
    await settle(w, 10);
    collectInto(w, 'fx sale refused');
    const payable = X.payables()[0];
    if (payable) { X.select({ tab: 'payables', payment: { targetKey: payable.key, date: '2026-10-26', amountFx: '1', wht: { enabled: true, incomeType: 'royalty', rate: '15', grossUp: true, payeeName: 'X', payeeCountry: 'Y', payeeAddress: '', payeeTaxRef: '', dtaNote: '' }, pp36: { enabled: true }, note: '' } }); await settle(w, 5); collectInto(w, 'fx payment form'); }
    X.previewCsv('date,currency,type,rate,per,source\n2026-13-01,XXX,nope,abc,7,\n2026-10-20,USD,bot_avg_buying,32.9,1,ธปท. 20/10', 'rates.csv', false);
    await settle(w, 10);
    collectInto(w, 'fx CSV preview with errors');
    X.select({ tab: 'monthEnd', period: '2026-07' });
    await settle(w, 5);
    collectInto(w, 'fx month end July (missing rate)');
    X.select({ tab: 'rates', rateForm: { date: '2026-10-22', currency: 'USD', type: 'bot_avg_buying', rate: '33', per: 1, sourceNote: '', correct: true } });
    await settle(w, 5);
    collectInto(w, 'fx rate correction form');
    w.go('saas-admin');
    await settle(w, 30);
    d.querySelectorAll('#fx-settings-card details').forEach(el => { el.open = true; });
    collectInto(w, 'settings multi-currency card');
    w.go('work-home');
    await settle(w, 20);
  });
  add('row "⋯" menus of every list', async () => {
    for (const panel of ['quote-list', 'invoice-list', 'receipt-list', 'credit-note-list', 'debit-note-list', 'production-list', 'expense-list', 'purchase-order', 'goods-receipt', 'master-data', 'issued-invoice-list', 'issued-receipt-list']) {
      w.go(panel);
      await settle(w, 20);
      const more = d.querySelector(`#panel-${panel} [data-row-menu]`);
      if (!more) continue;
      more.click();
      await settle(w, 20);
      collectInto(w, `menu ${panel}`);
      key(d.activeElement || more, 'Escape');
    }
  });
  add('detail dialogs', async () => {
    const b = biz();
    for (const [type, row] of [['quotes', first(b.quotes)], ['invoices', first(b.invoices)], ['receipts', first(b.receipts)], ['expenses', first(b.expenses, e => Number(e.whtAmount) > 0)], ['productions', first(b.productions)]]) {
      if (!row) continue;
      w.showDetailById(type, ...ref(row));
      await settle(w, 20);
      collectInto(w, `detail ${type}`);
      w.closeModal?.();
    }
  });
  add('cancel-invoice dialog', async () => {
    const inv = first(biz().invoices, i => !i.voided && i.status !== 'cancelled' && !(w.ERPIntegrity.paymentSummary(i).paid > 0));
    if (inv) w.ERPDocumentCancel.open('invoices', ...ref(inv));
    await settle(w, 20);
    collectInto(w, 'cancel dialog');
    w.ERPDocumentCancel.close?.();
  });
  add('credit / debit note viewers and 50 Tawi viewer', async () => {
    const cn = first(w.ERPCreditNotes.allCreditNotes());
    if (cn) { w.ERPCreditNotes.previewStored(cn._branch || cn.branch, cn._year, cn._month, cn.id); await settle(w, 20); collectInto(w, 'cn viewer'); closeOverlays(); }
    const dn = first(w.ERPDebitNotes.allDebitNotes());
    if (dn) { w.ERPDebitNotes.previewStored(dn._branch || dn.branch, dn._year, dn._month, dn.id); await settle(w, 20); collectInto(w, 'dn viewer'); closeOverlays(); }
    const cert = first(w.ERPPayerWht.readCertificates({ branches: ['ubon'] }));
    if (cert) { w.ERPPayerWht.openCertificate(cert); await settle(w, 20); collectInto(w, '50 Tawi viewer'); closeOverlays(); }
  });
  add('credit note and debit note forms from an invoice', async () => {
    const inv = first(biz().invoices, i => !i.voided && i.status !== 'cancelled' && i.vatMode !== 'none' && i.taxInvoiceForm !== 'abbreviated');
    if (inv) { w.ERPCreditNotes.startFromInvoice(...ref(inv)); await settle(w, 30); collectInto(w, 'credit note form'); }
    if (inv) { w.ERPDebitNotes.startFromInvoice(...ref(inv)); await settle(w, 30); collectInto(w, 'debit note form'); }
  });
  add('customer 360 and global search', async () => {
    const customer = first(biz().invoices)?.customer;
    if (customer) { w.ERPCustomerExperience.openCustomer360(customer); await settle(w, 20); collectInto(w, 'customer 360'); w.closeModal?.(); }
    w.ERPCustomerExperience.openSearch?.();
    await settle(w, 20);
    const input = d.querySelector('[role="dialog"] input[type="search"], .erp-search-input, #erp-global-search-input');
    if (input) { input.value = 'INV'; input.dispatchEvent(new w.Event('input', { bubbles: true })); await settle(w, 20); collectInto(w, 'search results'); input.value = 'ไม่มีทางพบ'; input.dispatchEvent(new w.Event('input', { bubbles: true })); await settle(w, 20); collectInto(w, 'search empty'); }
    key(d.activeElement || d.body, 'Escape');
  });
  add('order flow tabs', async () => {
    w.ERPOrderFlow.open();
    for (const tab of [...d.querySelectorAll('#panel-order-flow [data-flow-tab], #panel-order-flow [role="tab"]')]) { tab.click(); await settle(w, 20); collectInto(w, `order flow ${normalize(tab.textContent).slice(0, 20)}`); }
  });
  add('Demo menu, health dialog, getting-started guide', async () => {
    click('#erp-demo-menu-btn');
    await settle(w, 20);
    collectInto(w, 'demo menu');
    key(d.getElementById('erp-demo-menu'), 'Escape');
    w.LocalDemoHealth?.open?.();
    await settle(w, 120);
    collectInto(w, 'health dialog');
    d.querySelectorAll('.local-demo-health-modal [data-close], .local-demo-health-close').forEach(b => b.click());
    w.TrialService?.toggleOnboarding?.(false);
    await settle(w, 30);
    collectInto(w, 'onboarding');
  });
  add('empty-form validation messages', async () => {
    for (const [panel, save] of [['quote-form', 'saveQuote'], ['invoice-form', 'saveInvoice'], ['receipt-form', 'saveReceipt'], ['expense-form', 'saveExpense'], ['production-form', 'saveProduction']]) {
      w.go(panel);
      await settle(w, 20);
      try { await w[save]?.(); } catch (error) { /* the refusal is the point: it is shown as a toast */ void error; }
      await settle(w, 30);
      collectInto(w, `validation ${panel}`);
    }
    w.ERPCreditNotes.reset?.();
    try { await w.ERPCreditNotes.save(); } catch (error) { void error; }
    try { await w.ERPDebitNotes.save(); } catch (error) { void error; }
  });
  add('expense form: purchase VAT and withholding sections', async () => {
    w.go('expense-form');
    const set = (id, value) => { const el = d.getElementById(id); if (!el) return; el.value = value; el.dispatchEvent(new w.Event('change', { bubbles: true })); el.dispatchEvent(new w.Event('input', { bubbles: true })); };
    set('e-amount', '5350'); set('e-doc-type', 'tax_invoice'); set('e-tax-status', 'received');
    const wht = d.getElementById('e-wht-enabled') || d.querySelector('#panel-expense-form input[type="checkbox"][id*="wht"]');
    if (wht && !wht.checked) { wht.checked = true; wht.dispatchEvent(new w.Event('change', { bubbles: true })); }
    await settle(w, 30);
  });
  add('governance: period-lock refusal', async () => {
    w.go('audit-log');
    await settle(w, 20);
    d.getElementById('gov-lock-btn')?.click();
    await settle(w, 20);
  });
  add('company settings form errors', async () => {
    w.go('saas-admin');
    await settle(w, 30);
    const tax = d.querySelector('#panel-saas-admin input[name="taxId"], #cp-taxId, #cp-field-taxId');
    if (tax) { tax.value = '123'; tax.dispatchEvent(new w.Event('input', { bubbles: true })); }
    d.querySelector('#panel-saas-admin [data-cp-action="save"]')?.click();
    await settle(w, 30);
  });
  add('simple mode', async () => {
    d.getElementById('pe-mode-toggle')?.click();
    await settle(w, 30);
    w.go('work-home');
  });
  return list;
}

// Results shared by the steps.
let results = null;
function collectInto(w, where) {
  const found = collectThai(w, { allow: ALLOW, corpus: results.corpus });
  results.visits.push(where);
  for (const u of found.untranslated) if (!results.untranslated.has(u.text)) results.untranslated.set(u.text, { ...u, step: where });
  for (const u of found.unmarked) if (!results.unmarked.has(u.text)) results.unmarked.set(u.text, { ...u, step: where });
  for (const k of found.kept) if (!results.kept.has(k.value)) results.kept.set(k.value, { ...k, step: where });
  results.noI18n += found.noI18n.length;
}

function classifyMessage(w, text) {
  if (!THAI_RE.test(text)) return 'ok';
  const result = w.ERPI18n.translateResult(text);
  const shown = result.text;
  if (!THAI_RE.test(shown)) return 'ok';
  return isUserDataPiece(w, shown, results.corpus) ? 'user' : 'untranslated';
}

test('coverage audit: every screen, tab, menu and dialog in English has no untranslated Thai UI text (report: I18N_COVERAGE_RESULTS.json)', { timeout: 600000 }, async () => {
  const h = await bootEnglish();
  const { w } = h;
  const d = w.document;
  results = { visits: [], untranslated: new Map(), unmarked: new Map(), kept: new Map(), noI18n: 0, stepErrors: [], messages: [], corpus: [] };
  try {
    assert.equal(w.ERPI18n.lang(), 'en');
    assert.equal(d.documentElement.lang, 'en');
    // Module messages: the harness's window.notify recorder joins all arguments; keep only the message.
    const notes = [];
    w.notify = message => { notes.push(String(message ?? '')); };
    const seed = await w.ERPDemoSeed.load({ today: '2026-10-12', confirm: () => true });
    assert.equal(seed.status, 'loaded');
    await settle(w, 300);
    results.corpus = userDataCorpus(w);
    if (!d.body.classList.contains('pe-advanced')) d.getElementById('pe-mode-toggle')?.click(); // advanced mode shows every screen
    await settle(w, 60);
    collectInto(w, 'boot');
    for (const step of steps(w)) {
      try {
        await step.run();
      } catch (error) {
        results.stepErrors.push(`${step.name}: ${error.message}`);
      }
      await settle(w, 40);
      collectInto(w, step.name);
    }
    // Toasts and dialog texts: module messages (window.notify is the harness recorder; the app shows the same text
    // translated) and confirm / alert / prompt (already translated by the app's wrappers).
    const messageStatus = [];
    for (const message of notes) messageStatus.push({ text: w.ERPI18n.message(message), status: classifyMessage(w, w.ERPI18n.message(message)) });
    for (const dialog of h.dialogs) messageStatus.push({ text: dialog.message, status: classifyMessage(w, dialog.message) });
    for (const m of messageStatus) if (m.status === 'untranslated' && !results.untranslated.has(m.text)) results.untranslated.set(m.text, { text: m.text, where: 'message', kind: 'message', step: 'messages' });
    const stats = w.ERPI18n.stats();
    const report = {
      generatedBy: 'tests/i18n-coverage.test.cjs',
      language: 'en',
      sampleData: '2026-10-12',
      steps: results.visits.length,
      visits: results.visits,
      textNodesTranslated: stats.textNodes,
      attributesTranslated: stats.attributes,
      dictionaryEntries: stats.dictionarySize,
      messagesChecked: messageStatus.length,
      untranslatedCount: results.untranslated.size,
      untranslated: [...results.untranslated.values()],
      userDataOutsideNoI18nCount: results.unmarked.size,
      userDataOutsideNoI18nSamples: [...results.unmarked.values()].slice(0, 40),
      keptPlaceholderValues: [...results.kept.values()].slice(0, 60),
      keptNotUserData: [...results.kept.values()].filter(k => !k.userData).map(k => k.value),
      noI18nTextNodesSkipped: results.noI18n,
      allowlist: ALLOW,
      stepErrors: results.stepErrors,
      pageErrors: h.errors
    };
    fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
    assert.deepEqual(results.stepErrors, [], 'every step ran');
    assert.deepEqual([...results.untranslated.values()].map(u => `${u.text}  @${u.where}`), [], 'untranslated Thai UI text');
    assert.deepEqual(h.errors, []);
    assert.ok(results.visits.length >= 60, `${results.visits.length} visits`);
  } finally {
    h.close();
  }
});
