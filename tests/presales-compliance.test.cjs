// ADR-021 (round 8, stage 1) through the real app (jsdom boot):
//   r8a#5 printed buyer establishment: branch / HQ / none on the full tax invoice (all copies, print window),
//         absent on the abbreviated invoice, on the receipt, credit note picks it up
//   r8a#6 invoice / receipt form control: master autofill, 5-digit validation, HQ, untouched fallback, abbreviated
//   r8a#7 cancel instead of delete: reason required, refusals (closed period, live receipt / credit note),
//         kept record + audit row, stock back, excluded from AR / aging / dashboard / analytics / council,
//         number not reused, list badge + filter, print stamp, no edit / delete afterwards
//   r8a#8 sample targets: seeded with the data, typed targets survive reset, empty store has no target
//   r8a#9 Excel export loads SheetJS from the local vendor file and writes rows
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { boot } = require('./dom-helper.cjs');

const ROOT = path.resolve(__dirname, '..');
const imp = file => import(pathToFileURL(path.join(ROOT, file)).href + '?t=' + Date.now() + Math.random());
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = el => String(el?.textContent || '').replace(/\s+/g, ' ').trim();
const TENANT_KEY = base => `erp_tenant::customer-showcase-local::${base}`;
const BRANCH_BUYER = 'บมจ. แก่นนคร ฟู้ดส์';
async function waitFor(check, tries = 200) { for (let i = 0; i < tries && !check(); i++) await sleep(25); return check(); }
async function bootWithSample() {
  const h = await boot();
  assert.equal(await waitFor(() => !!h.w.ERPDemoSeed && !!h.w.ERPDocumentCancel && !!h.w.ERPProductExperience), true, 'app ready');
  assert.equal((await h.w.ERPDemoSeed.load()).status, 'loaded', h.messages.join('\n'));
  await sleep(250);
  return h;
}
// app.js toasts go to #app-toast-container (its notify is module-local); modules call window.notify (h.messages).
const said = h => `${h.messages.join('\n')}\n${[...h.w.document.querySelectorAll('#app-toast-container .app-toast-msg')].map(text).join('\n')}`;
const quiet = h => { h.messages.length = 0; const box = h.w.document.getElementById('app-toast-container'); if (box) box.innerHTML = ''; };
function parse(w, html) { const box = w.document.createElement('div'); box.innerHTML = html; return box; }
const liveInvoices = w => w.ERPIntegrity.business().invoices.filter(i => i._type === 'invoices' && w.ERPIntegrity.live(i));

test('r8a#5 the printed full tax invoice shows the buyer สำนักงานใหญ่ / สาขาที่ next to the tax ID (all copies, print window); none for old records and abbreviated invoices', async () => {
  const h = await bootWithSample(); const { w } = h;
  try {
    const doc = w.ComformDeliveryTaxDocument;
    const invoices = liveInvoices(w);
    const branchInv = invoices.find(i => i.customer === BRANCH_BUYER);
    const hqInv = invoices.find(i => i.customerBranchCode === '00000' && i.taxInvoiceForm === 'full');
    const abbr = invoices.find(i => i.taxInvoiceForm === 'abbreviated');
    assert.ok(branchInv && hqInv && abbr);
    const labelOf = (inv, page) => [...parse(w, doc.buildInlineHtml(inv, { b: inv._branch }, page)).querySelectorAll('.dtd-doc-buyer-branch')].map(text);
    for (const page of ['original', 'copy', 'delivery-copy']) {
      assert.deepEqual(labelOf(branchInv, page), ['สาขาที่ 00003'], page);
      assert.deepEqual(labelOf(hqInv, page), ['สำนักงานใหญ่'], page);
    }
    const bottom = parse(w, doc.buildInlineHtml(branchInv, { b: branchInv._branch }, 'original')).querySelector('.dtd-doc-party-box .dtd-doc-party-bottom');
    assert.equal(text(bottom), `เลขประจำตัวผู้เสียภาษี ${branchInv.customerTaxId}สาขาที่ 00003`);
    // A record saved before ADR-021 (no field) prints exactly the old line — no empty label.
    const old = { ...hqInv }; delete old.customerBranchCode; delete old.customerBranchName;
    const oldBox = parse(w, doc.buildInlineHtml(old, { b: old._branch }, 'original'));
    assert.equal(oldBox.querySelectorAll('.dtd-doc-buyer-branch').length, 0);
    assert.equal(oldBox.querySelector('.dtd-doc-party-box .dtd-doc-party-bottom').innerHTML, `<b>เลขประจำตัวผู้เสียภาษี</b> ${old.customerTaxId}`);
    // Abbreviated (§86/6) layout unchanged even with a code on the record.
    const abbrHtml = doc.buildInlineHtml({ ...abbr, customerBranchCode: '00003' }, { b: abbr._branch }, 'original');
    assert.match(abbrHtml, /ใบกำกับภาษีอย่างย่อ/);
    assert.doesNotMatch(abbrHtml, /สาขาที่ 00003|dtd-doc-buyer-branch/);
    // Print window from the invoice list (openDeliveryDocumentFromInvoice → loadFromInvoice → print): 3 copies,
    // each with the buyer's own tax ID and branch (loadFromInvoice used to keep the previous draft's buyer).
    const written = [];
    w.open = () => ({ opener: w, document: { write: html => written.push(html), close() {} } });
    w.openDeliveryDocumentFromInvoice(hqInv._branch, hqInv._year, hqInv._month, String(hqInv.id));
    w.openDeliveryDocumentFromInvoice(branchInv._branch, branchInv._year, branchInv._month, String(branchInv.id));
    doc.print('all');
    assert.equal(written.length, 1);
    const printed = parse(w, written[0].replace(/^[\s\S]*<body>|<\/body>[\s\S]*$/g, ''));
    assert.deepEqual([...printed.querySelectorAll('.dtd-doc-buyer-branch')].map(text), ['สาขาที่ 00003', 'สาขาที่ 00003', 'สาขาที่ 00003']);
    assert.ok([...printed.querySelectorAll('.dtd-doc-party-bottom')].filter(el => text(el).startsWith('เลขประจำตัวผู้เสียภาษี')).every(el => text(el).includes(branchInv.customerTaxId)));
    // Receipt: printed next to the tax ID as on the invoice.
    const receipt = w.ERPIntegrity.business().receipts.find(r => r.customerBranchCode === '00000');
    assert.ok(receipt, 'seeded receipt with the buyer head office');
    const rBox = parse(w, w.ComformReceiptDocument.buildInlineHtml(receipt, { b: receipt._branch }, 'original'));
    assert.deepEqual([...rBox.querySelectorAll('.rcp-doc-buyer-branch')].map(text), ['สำนักงานใหญ่']);
    const rBranch = parse(w, w.ComformReceiptDocument.buildInlineHtml({ ...receipt, customerBranchCode: '00012' }, { b: receipt._branch }, 'original'));
    assert.deepEqual([...rBranch.querySelectorAll('.rcp-doc-buyer-branch')].map(text), ['สาขาที่ 00012']);
    // Credit note (§86/10) of the branch buyer's invoice names the same establishment.
    w.ERPCreditNotes.startFromInvoice(branchInv._branch, branchInv._year, branchInv._month, String(branchInv.id));
    assert.equal(w.document.getElementById('cn-buyer-branch').value, 'สาขาที่ 00003 (โรงงานขอนแก่น)');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('r8a#6 the invoice form fills the buyer establishment from Customer Master, validates 5 digits, saves HQ / branch / none', async () => {
  const h = await bootWithSample(); const { w, set } = h;
  const $ = id => w.document.getElementById(id);
  try {
    await waitFor(() => w.saveInvoice?.__stockGuard);
    const shared = await imp('erp-shared-core.js');
    const prepare = (customer, apply = true) => {
      w.go('invoice-form', null); w.resetF('invoice'); w.selBr('i', 'ubon');
      set('i-date', shared.localDateISO()); set('i-cust', customer); set('i-sales', 'ทดสอบ'); set('i-vat', '1');
      if (apply) w.applyCustomerMasterToForm('i', customer);
      $('i-items-body').innerHTML = '';
      w.addIItem({ product: 'บริการทดสอบสาขา', qty: 1, unit: 'งาน', priceUnit: 1000 });
    };
    const count = () => w.ERPIntegrity.business().invoices.length;
    // Master autofill: the branch buyer → "สาขาที่" 00003, enabled code box.
    prepare(BRANCH_BUYER);
    assert.deepEqual([$('i-buyer-branch-kind').value, $('i-buyer-branch-code').value, $('i-buyer-branch-code').disabled], ['branch', '00003', false]);
    // Invalid number → refused with the 5-digit message, nothing saved.
    set('i-buyer-branch-code', '12');
    const before = count();
    quiet(h);
    await w.saveInvoice(); await w.LocalDemoHealth?.whenIdle?.('saveInvoice');
    assert.equal(count(), before);
    assert.match(said(h), /5 หลัก/);
    set('i-buyer-branch-code', '00007');
    await w.saveInvoice(); await w.LocalDemoHealth?.whenIdle?.('saveInvoice');
    let saved = w.ERPIntegrity.business().invoices.find(i => i.customer === BRANCH_BUYER && i.items?.[0]?.product === 'บริการทดสอบสาขา');
    assert.ok(saved, h.messages.join('\n'));
    assert.deepEqual([saved.customerBranchCode, saved.customerBranchName], ['00007', ''], 'a typed number wins; the master branch name is not kept for another branch');
    // Head office chosen explicitly.
    prepare(BRANCH_BUYER); set('i-buyer-branch-kind', 'hq'); $('i-buyer-branch-kind').dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.equal($('i-buyer-branch-code').disabled, true);
    await w.saveInvoice(); await w.LocalDemoHealth?.whenIdle?.('saveInvoice');
    saved = w.ERPIntegrity.business().invoices.filter(i => i.customer === BRANCH_BUYER && i.items?.[0]?.product === 'บริการทดสอบสาขา').at(-1);
    assert.equal(saved.customerBranchCode, '00000');
    // A buyer filled without the master autofill (e.g. from a Sales Order): copied from Customer Master at save.
    prepare(BRANCH_BUYER, false); set('i-tax-id', '0107537008786');
    await w.saveInvoice(); await w.LocalDemoHealth?.whenIdle?.('saveInvoice');
    saved = w.ERPIntegrity.business().invoices.filter(i => i.customer === BRANCH_BUYER && i.items?.[0]?.product === 'บริการทดสอบสาขา').at(-1);
    assert.deepEqual([saved.customerBranchCode, saved.customerBranchName], ['00003', 'โรงงานขอนแก่น']);
    // A buyer without a tax ID: optional, nothing stored.
    prepare('ร้านทดสอบไม่มีเลขภาษี', false);
    await w.saveInvoice(); await w.LocalDemoHealth?.whenIdle?.('saveInvoice');
    saved = w.ERPIntegrity.business().invoices.find(i => i.customer === 'ร้านทดสอบไม่มีเลขภาษี');
    assert.equal(saved.customerBranchCode, '');
    // Editing an invoice shows its stored value.
    w.editInvoice(saved._branch, saved._year, saved._month, String(w.ERPIntegrity.business().invoices.find(i => i.customer === BRANCH_BUYER && i.customerBranchCode === '00007').id));
    assert.deepEqual([$('i-buyer-branch-kind').value, $('i-buyer-branch-code').value], ['branch', '00007']);
    // Abbreviated: control disabled, nothing stored.
    w.resetF('invoice');
    assert.equal(w.ERPSalesFormAssist.buyerBranchFromForm('i', { taxInvoiceForm: 'abbreviated' }).customerBranchCode, '');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('r8a#7 cancelling an issued tax invoice: reason required, refusals, kept with stamp + audit, stock back, excluded everywhere, number not reused', async () => {
  const h = await bootWithSample(); const { w } = h;
  const $ = id => w.document.getElementById(id);
  try {
    const shared = await imp('erp-shared-core.js');
    const today = shared.localDateISO();
    const I = w.ERPIntegrity;
    const findInv = no => I.business().invoices.find(i => i.no === no && i._type === 'invoices');
    const target = liveInvoices(w).find(i => i.customer === BRANCH_BUYER);
    const ref = [target._branch, target._year, target._month, String(target.id)];
    const outstanding = I.paymentSummary(target).outstanding;
    assert.ok(outstanding > 0 && target.sourceQuoteNo, 'unpaid, made from a quotation');
    const product = w.productMasterRows().find(p => p.code === 'DEMO-NB01');
    const stockBefore = w.productEstimatedStock(product, target._branch);
    const arBefore = w.ERPReceivables.snapshot('').aging.totals.total;
    const agingBefore = w.ERPGovernance.agingSnapshot(today).ar.total;
    const statsBefore = w.testApp.branchStats(target._branch, target._year, target._month);

    // Reason required (core path) — nothing changes.
    assert.equal((await w.ERPDocumentCancel.cancel('invoices', ...ref, { code: '', text: '' })).ok, false);
    assert.equal(I.live(findInv(target.no)), true);
    // Closed period: refused before any question, same message as the other locked-period refusals.
    const lock = w.ERPGovernance.lockPeriod({ branch: target._branch, scope: 'sales', throughDate: target.date, reason: 'r8a#7' });
    const expected = w.ERPGovernance.periodLockRefusal({ type: 'invoices', branch: target._branch, date: target.date, action: 'invoices_cancel' });
    assert.match(expected, /ถูกปิดถึง/);
    assert.equal(w.ERPDocumentCancel.open('invoices', ...ref), false);
    assert.equal(h.messages.at(-1).startsWith(expected), true, h.messages.at(-1));
    assert.equal($('erp-cancel-title'), null, 'no dialog');
    assert.equal((await w.ERPDocumentCancel.cancel('invoices', ...ref, { code: 'duplicate', text: '' })).ok, false, 'the write re-checks the lock');
    w.ERPGovernance.unlockPeriod(lock.lockId, 'r8a#7 done');
    // Live receipt / live credit note on other invoices: refused, naming the document to void first.
    const data = I.business();
    const withReceipt = liveInvoices(w).find(i => data.receipts.some(r => I.live(r) && I.receiptMatches(r, i)) && !(I.paymentSummary(i).credited > 0));
    const receiptNo = data.receipts.find(r => I.live(r) && I.receiptMatches(r, withReceipt)).no;
    assert.equal(w.ERPDocumentCancel.open('invoices', withReceipt._branch, withReceipt._year, withReceipt._month, String(withReceipt.id)), false);
    assert.match(h.messages.at(-1), new RegExp(`ใบเสร็จรับเงินที่ยังใช้งาน: [^\\n]*${receiptNo}`));
    const withCredit = liveInvoices(w).find(i => I.paymentSummary(i).credited > 0);
    const cnNo = data.creditNotes.find(cn => !cn.voided && (cn.lines || []).some(l => I.creditNoteMatches(l, cn, withCredit))).no;
    assert.equal((await w.ERPDocumentCancel.cancel('invoices', withCredit._branch, withCredit._year, withCredit._month, String(withCredit.id), { code: 'duplicate' })).ok, false);
    assert.match(h.messages.at(-1), new RegExp(`ใบลดหนี้ที่ยังใช้งาน: [^\\n]*${cnNo}`));
    assert.equal(I.live(findInv(withCredit.no)), true);

    // Through the UI: "⋯" item → dialog → reason → confirm.
    w.go('invoice-list'); w.renderIList();
    const cell = [...w.document.querySelectorAll('#itbl [data-row-facts]')].find(el => JSON.parse(el.dataset.rowFacts).no === target.no);
    assert.ok(cell, 'row');
    w.ERPDocumentCancel.open('invoices', ...ref);
    const dialog = w.document.querySelector('.erp-cancel-overlay [role="dialog"]');
    assert.ok(dialog);
    dialog.querySelector('[data-cancel-dialog="confirm"]').click();
    await sleep(20);
    assert.match(text(dialog.querySelector('.erp-cancel-error')), /กรุณาเลือกเหตุผล/);
    dialog.querySelector('input[value="wrong_details"]').checked = true;
    dialog.querySelector('#erp-cancel-text').value = 'เลขที่สาขาผู้ซื้อผิด ออกฉบับใหม่แทน';
    dialog.querySelector('[data-cancel-dialog="confirm"]').click();
    assert.equal(await waitFor(() => !I.live(findInv(target.no))), true, h.messages.join('\n'));
    await waitFor(() => !w.document.querySelector('.erp-cancel-overlay'));

    // Kept, with status, reason, who and when.
    const kept = findInv(target.no);
    assert.deepEqual([kept.status, kept.voided, kept.voidReasonCode, kept.total], ['cancelled', true, 'wrong_details', target.total]);
    assert.match(kept.voidReason, /เลขที่สาขาผู้ซื้อผิด/);
    assert.ok(kept.voidedAt && kept.voidedBy);
    const auditRow = w.ERPProductionCore.exportData().audit.find(r => r.action === 'void' && r.ref === target.no);
    assert.ok(auditRow, 'audit log row');
    assert.match(auditRow.detail, /ยกเลิกใบกำกับภาษี[\s\S]*เลขที่สาขาผู้ซื้อผิด/);
    assert.equal(auditRow.meta.cancelledAt, kept.voidedAt);
    // Source quotation released for the replacement.
    const quote = I.business().quotes.find(q => q.no === target.sourceQuoteNo);
    assert.deepEqual([quote.invoiceNo, quote.invoiceStatus, [...quote.cancelledInvoiceNos]], ['', 'cancelled', [target.no]]);
    // Stock returned (the invoice sold 2 × DEMO-NB01).
    assert.equal(w.productEstimatedStock(product, target._branch), stockBefore + 2);
    // Excluded from AR, aging, dashboard, analytics, council.
    assert.equal(Math.round((arBefore - w.ERPReceivables.snapshot('').aging.totals.total) * 100) / 100, outstanding);
    assert.equal(Math.round((agingBefore - w.ERPGovernance.agingSnapshot(today).ar.total) * 100) / 100, outstanding);
    const statsAfter = w.testApp.branchStats(target._branch, target._year, target._month);
    assert.equal(Math.round((statsBefore.st - statsAfter.st) * 100) / 100, target.subtotal);
    assert.equal(statsBefore.ic - statsAfter.ic, 1);
    const analytics = w.testApp.collectAnalyticsData({ year: target._year, month: '', branch: '', agencyGroup: '', agencyType: '' });
    assert.ok(!analytics.invoices.some(i => i.no === target.no));
    assert.doesNotMatch(JSON.stringify(w.ERPDecisionCouncil.run()), new RegExp(target.no));
    assert.equal(I.paymentSummary(kept).status, 'cancelled');
    // Number stays taken: the next auto number of that month is a new one.
    w.go('invoice-form', null); w.resetF('invoice'); w.selBr('i', target._branch);
    $('i-date').value = target.date;
    const next = w.refreshAutoDocumentNumber('invoice', true);
    assert.notEqual(next, target.no);
    assert.ok(next.slice(0, 7) !== target.no.slice(0, 7) || Number(next.slice(7)) > Number(target.no.slice(7)), `${next} after ${target.no}`);
    // List: badge + filter.
    w.go('invoice-list'); $('il-year').value = String(target._year); $('il-paystatus').value = 'cancelled'; w.renderIList();
    const rows = [...w.document.querySelectorAll('#itbl tr')].map(text);
    assert.ok(rows.length >= 1 && rows.every(r => /ยกเลิก/.test(r)) && rows.some(r => r.includes(target.no)), rows.join('\n'));
    $('il-paystatus').value = 'outstanding'; w.renderIList();
    assert.ok(![...w.document.querySelectorAll('#itbl tr')].some(tr => text(tr).includes(target.no)));
    $('il-paystatus').value = ''; w.renderIList();
    const facts = JSON.parse([...w.document.querySelectorAll('#itbl [data-row-facts]')].find(el => JSON.parse(el.dataset.rowFacts).no === target.no).dataset.rowFacts);
    assert.equal(facts.cancelled, true);
    // Print / preview carry the stamp with the reason.
    const stampHtml = w.ComformDeliveryTaxDocument.buildInlineHtml(kept, { b: kept._branch }, 'copy');
    assert.match(stampHtml, /ยกเลิก \/ CANCELLED/);
    assert.match(stampHtml, /เลขที่สาขาผู้ซื้อผิด/);
    // No delete, no edit, no second cancel.
    const countBefore = w.loadFor(...ref.slice(0, 3)).invoices.length;
    quiet(h);
    await w.delDoc(target._branch, target._year, target._month, 'invoices', target.id);
    assert.equal(w.loadFor(...ref.slice(0, 3)).invoices.length, countBefore);
    assert.match(said(h), /ลบไม่ได้/);
    quiet(h);
    w.editInvoice(...ref);
    assert.match(said(h), /ถูกยกเลิกแล้ว/);
    assert.equal(w.ERPDocumentCancel.open('invoices', ...ref), false);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('r8a#7 a receipt is cancelled (kept) instead of deleted; its invoice becomes outstanding again', async () => {
  const h = await bootWithSample(); const { w } = h;
  try {
    const I = w.ERPIntegrity;
    const receipt = I.business().receipts.find(r => I.live(r) && !r.paymentId && !r.whtAmount && r._type === 'receipts');
    const inv = I.resolveInvoice({ branch: receipt.invoiceBranch || receipt._branch, id: receipt.invoiceId, no: receipt.invNo });
    const before = I.paymentSummary(inv).outstanding;
    const result = await w.ERPDocumentCancel.cancel('receipts', receipt._branch, receipt._year, receipt._month, String(receipt.id), { code: 'duplicate' });
    assert.equal(result.ok, true, h.messages.join('\n'));
    const kept = I.business().receipts.find(r => r.no === receipt.no);
    assert.deepEqual([kept.status, kept.voided], ['cancelled', true]);
    assert.equal(Math.round((I.paymentSummary(inv).outstanding - before) * 100) / 100, receipt.total);
    assert.match(w.ComformReceiptDocument.buildInlineHtml(kept, { b: kept._branch }, 'original'), /ยกเลิก \/ CANCELLED/);
    // A payment receipt is voided with its payment.
    const paymentReceipt = I.business().receipts.find(r => I.live(r) && r.paymentId);
    assert.equal(w.ERPDocumentCancel.open('receipts', paymentReceipt._branch, paymentReceipt._year, paymentReceipt._month, String(paymentReceipt.id)), false);
    assert.match(h.messages.at(-1), /ยกเลิกรายการรับเงินที่หน้าใบวางบิล/);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('r8a#8 sample targets: no target on an empty store; seeded with the sample data; reset keeps the targets the user typed', async () => {
  const h = await boot(); const { w } = h;
  try {
    const shared = await imp('erp-shared-core.js');
    assert.equal(await waitFor(() => !!w.ERPDemoSeed && !!w.document.getElementById('exec-sales-target-summary')), true);
    // Empty store.
    assert.equal(w.testApp.buildSalesTargetDashboard().target, 0);
    w.renderDash();
    await waitFor(() => /ยังไม่ได้ตั้งเป้า/.test(text(w.document.getElementById('exec-sales-target-summary'))));
    assert.match(text(w.document.getElementById('exec-sales-target-summary')), /ยังไม่ได้ตั้งเป้า/);
    // The user typed a target for this month before loading the sample.
    const today = shared.localDateISO(), thisMonth = `all:${today.slice(0, 7)}`;
    const salesKey = TENANT_KEY('comform_sales_target_period_overrides_v1');
    w.localStorage.setItem(salesKey, JSON.stringify({ [thisMonth]: 555555 }));
    const { plan } = await w.ERPDemoSeed.load();
    const seed = await imp('erp-demo-seed-core.js');
    const expected = seed.buildDemoSeedTargets(plan);
    let stored = JSON.parse(w.localStorage.getItem(salesKey));
    assert.equal(stored[thisMonth], 555555, 'a typed target is never overwritten');
    const closedKeys = Object.keys(expected.sales).filter(k => k.startsWith('all:') && k < thisMonth);
    assert.ok(closedKeys.length >= 2);
    for (const key of closedKeys) assert.equal(stored[key], expected.sales[key], key);
    assert.ok(Object.keys(JSON.parse(w.localStorage.getItem(TENANT_KEY('comform_delivery_target_period_overrides_v1')))).length > 0);
    // Dashboard target chart: closed months are counted, some hit and some miss.
    const year = Number(closedKeys[0].slice(4, 8));
    const yearSel = w.document.getElementById('dash-year');
    if (![...yearSel.options].some(o => o.value === String(year))) yearSel.add(new w.Option(String(year), String(year)));
    yearSel.value = String(year); w.document.getElementById('dash-month').value = '-1';
    w.renderDash();
    const summary = text(w.document.getElementById('exec-sales-target-summary'));
    const m = /ทำได้ถึง\/เกินเป้า (\d+)\/(\d+) เดือน/.exec(summary);
    assert.ok(m && Number(m[1]) > 0 && Number(m[1]) < Number(m[2]), summary);
    // The user edits one seeded month, then resets: typed targets stay, the other seeded ones go.
    stored[closedKeys[0]] = 123456;
    w.localStorage.setItem(salesKey, JSON.stringify(stored));
    assert.equal((await w.ERPDemoSeed.reset({ confirm: () => true })).status, 'reset');
    stored = JSON.parse(w.localStorage.getItem(salesKey));
    assert.deepEqual(stored, { [thisMonth]: 555555, [closedKeys[0]]: 123456 });
    assert.equal(w.localStorage.getItem(TENANT_KEY('comform_delivery_target_period_overrides_v1')), null, 'only seeded delivery targets → removed');
    assert.equal(w.localStorage.getItem(TENANT_KEY('comform_demo_seed_targets_v1')), null);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('r8a#9 Excel export loads SheetJS from the local vendor file (no CDN) and writes the rows', async () => {
  const h = await bootWithSample(); const { w } = h;
  try {
    const appended = [];
    const original = w.document.head.appendChild.bind(w.document.head);
    w.document.head.appendChild = node => { if (node.tagName === 'SCRIPT') appended.push(node); return original(node); };
    w.exportXLSX('invoices');
    assert.equal(appended.length, 1);
    assert.equal(appended[0].getAttribute('src'), './vendor/xlsx-0.18.5.full.min.js');
    // jsdom does not run <script src>: evaluate the vendored bundle, then fire its load event.
    w.eval(fs.readFileSync(path.join(ROOT, 'vendor/xlsx-0.18.5.full.min.js'), 'utf8'));
    let book = null, name = '';
    w.XLSX.writeFile = (wb, file) => { book = wb; name = file; };
    appended[0].onload();
    assert.ok(book, said(h));
    assert.match(name, /\.xlsx$/);
    const rows = w.XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1 });
    assert.ok(rows.length > 18, `rows: ${rows.length}`);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});
