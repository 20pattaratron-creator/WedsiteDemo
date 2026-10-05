// ADR-016 (round 5 part B, UI declutter) in the booted app: every list table shows at most one
// primary button + "⋯" per row, the primary follows the row's state, the "⋯" menu lists the other
// actions (destructive last) and runs the SAME handler with the SAME arguments as the old per-row
// buttons, deletes still ask first, and menus behave (keyboard, Escape, outside click, one open,
// re-rendered tables leave no orphan menu and no extra listener).
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./dom-helper.cjs');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = el => String(el?.textContent || '').replace(/\s+/g, ' ').trim();
const NOW = new Date();
const YEAR = NOW.getFullYear();
const MONTH = NOW.getMonth();
const TODAY = `${YEAR}-${String(MONTH + 1).padStart(2, '0')}-${String(NOW.getDate()).padStart(2, '0')}`;

// Counts document-level listeners by type, to prove re-rendering adds none.
function countDocumentListeners(w) {
  const counts = {};
  const add = w.document.addEventListener.bind(w.document);
  w.document.addEventListener = (type, listener, options) => {
    counts[type] = (counts[type] || 0) + 1;
    return add(type, listener, options);
  };
  w.__listenerCounts = counts;
}

async function bootWithSamples() {
  const h = await boot({ beforeScripts: countDocumentListeners });
  const { w } = h;
  // erp-production-core.js boots on a timer (navigation hook for the PO / GR pages).
  for (let i = 0; i < 80 && !w.__ERP_PRODCORE_NAV_HOOK__; i++) await sleep(25);
  assert.equal(w.__ERP_PRODCORE_NAV_HOOK__, true);
  assert.equal((await w.ERPDemoSeed.load()).status, 'loaded');
  // Rows the sample data does not have: a production order, POs in several states, goods receipts,
  // business-rule overrides.
  const pack = w.loadFor('ubon', YEAR, MONTH);
  pack.productions = [...(pack.productions || []), { id: 990001, no: 'PD-T1', date: TODAY, customer: 'ลูกค้าทดสอบ', maker: 'โรงงาน', job: 'งานทดสอบ', items: [], subtotal: 1000, total: 1070 }];
  // Printed ("issued", locked) copies: the lists show a single "ดู".
  pack.issuedInvoices = [...(pack.issuedInvoices || []), { id: 990002, no: 'INV-P1', date: TODAY, customer: 'ลูกค้าทดสอบ', subtotal: 100, vatAmt: 7, total: 107 }];
  pack.issuedReceipts = [...(pack.issuedReceipts || []), { id: 990003, no: 'RC-P1', date: TODAY, invNo: 'INV-P1', customer: 'ลูกค้าทดสอบ', total: 107 }];
  w.saveFor('ubon', YEAR, MONTH, pack);
  const po = (id, status) => ({ id, no: id.toUpperCase(), date: TODAY, branch: 'ubon', supplier: 'ผู้ขายทดสอบ', status, items: [{ product: 'สินค้า', productCode: 'T-1', qty: 1, unitCost: 10 }], subtotal: 10 });
  w.ERPProductionCore.importData({
    purchaseOrders: [po('po_draft', 'draft'), po('po_ordered', 'ordered'), po('po_cancelled', 'cancelled')],
    goodsReceipts: [
      { id: 'gr_live', no: 'GR-LIVE', date: TODAY, branch: 'ubon', poId: 'po_x', poNo: 'PO-X', supplier: 'ผู้ขายทดสอบ', items: [], subtotal: 0, status: 'posted' },
      { id: 'gr_rev', no: 'GR-REV', date: TODAY, branch: 'ubon', poId: 'po_x', poNo: 'PO-X', supplier: 'ผู้ขายทดสอบ', items: [], subtotal: 0, status: 'posted', reversed: true }
    ]
  }, { replace: true });
  const rules = w.BusinessRulesService.read();
  w.BusinessRulesService.save({ ...rules, productRules: [{ key: 'SKU-A', label: 'SKU-A', pricingMethod: 'margin', rate: 30 }], customerRules: [{ key: 'ลูกค้า ก', label: 'ลูกค้า ก', discountPercent: 5 }] });
  w.BusinessRulesService.render();
  return h;
}

// [list id, panel, table root selector, how to render it]
const LISTS = [
  ['quote', 'quote-list', '#qtbl'],
  ['invoice', 'invoice-list', '#itbl'],
  ['receipt', 'receipt-list', '#rtbl'],
  ['creditNote', 'credit-note-list', '#cnltbl'],
  ['issuedInvoice', 'issued-invoice-list', '#oitbl'],
  ['issuedReceipt', 'issued-receipt-list', '#ortbl'],
  ['expense', 'expense-list', '#etbl'],
  ['production', 'production-list', '#ptbl'],
  ['purchaseOrder', 'purchase-order', '#po-list-table'],
  ['goodsReceipt', 'goods-receipt', '#gr-list-table'],
  ['contact', 'master-data', '#master-customer-table'],
  ['contact', 'master-data', '#master-supplier-table'],
  ['product', 'master-data', '#master-product-table'],
  ['productRule', 'business-rules', '#br-product-rules-table'],
  ['customerRule', 'business-rules', '#br-customer-rules-table']
];

function show(w, panel) {
  w.go(panel);
  if (panel === 'quote-list') w.renderQLList();
  if (panel === 'invoice-list') w.renderIList();
  if (panel === 'receipt-list') w.renderRList();
  if (panel === 'expense-list') w.renderEList();
  if (panel === 'production-list') w.renderPList();
  if (panel === 'credit-note-list') w.ERPCreditNotes.renderList();
  if (panel === 'master-data') w.renderMasterData();
}
const cellsIn = (d, selector) => [...d.querySelectorAll(`${selector} .erp-rowact`)];
const factsOf = cell => JSON.parse(cell.dataset.rowFacts);
const menuElements = d => [...d.querySelectorAll('.erp-menu.erp-rowact-menu')];
const openMenuItems = d => [...(menuElements(d)[0]?.querySelectorAll('[role="menuitem"]') || [])];
const itemLabels = d => openMenuItems(d).map(text);
function openMenu(w, cell) {
  const more = cell.querySelector('[data-row-menu]');
  assert.ok(more, 'row has a ⋯ button');
  more.click();
  assert.equal(more.getAttribute('aria-expanded'), 'true');
  return more;
}
function chooseItem(d, label) {
  const item = openMenuItems(d).find(element => text(element) === label || text(element).endsWith(label));
  assert.ok(item, `menu item "${label}" in [${itemLabels(d).join(', ')}]`);
  item.click();
}

test('every list: each row shows only its primary button and "⋯" (no inline handlers), the primary follows the row state', async () => {
  const h = await bootWithSamples(), { w } = h, d = w.document;
  try {
    const seen = {};
    for (const [listId, panel, selector] of LISTS) {
      show(w, panel);
      const cells = cellsIn(d, selector);
      assert.ok(cells.length > 0, `${selector}: has rows`);
      seen[selector] = cells.length;
      for (const cell of cells) {
        assert.equal(cell.dataset.rowActions, listId);
        const row = cell.closest('tr');
        const buttons = [...row.querySelectorAll('button')];
        assert.ok(buttons.length <= 2, `${selector}: ${buttons.length} buttons in a row`);
        assert.ok(cell.querySelectorAll('.erp-rowact-primary').length <= 1);
        assert.ok(cell.querySelectorAll('[data-row-menu]').length <= 1);
        assert.equal(row.querySelectorAll('button[onclick]').length, 0, `${selector}: no inline onclick buttons`);
        const expected = w.ERPRowActions.rowActions(listId, factsOf(cell));
        const { primary, menu } = w.ERPRowActions.splitRowActions(expected);
        assert.equal(cell.querySelector('.erp-rowact-primary')?.dataset.rowAction ?? null, primary?.id ?? null, `${selector}: primary`);
        assert.equal(!!cell.querySelector('[data-row-menu]'), menu.length > 0, `${selector}: ⋯ only when the menu has items`);
      }
    }
    // Invoices: the primary follows the payment state computed by ERPIntegrity (paid / fully credited = settled).
    show(w, 'invoice-list');
    const invoices = w.ERPIntegrity.business().invoices;
    const states = new Set();
    for (const cell of cellsIn(d, '#itbl')) {
      const facts = factsOf(cell);
      const invoice = invoices.find(row => String(row.id) === String(facts.id) && (row._branch || row.branch) === facts.b);
      const status = w.ERPIntegrity.paymentSummary({ ...invoice, branch: facts.b }).status;
      const settled = ['paid', 'credited'].includes(status);
      states.add(settled);
      assert.equal(facts.settled, settled, `${facts.no}: ${status}`);
      const primary = cell.querySelector('.erp-rowact-primary');
      // ADR-017: icons are aria-hidden line SVGs (erp-icons.js), so the text is the label alone.
      // ADR-021: a cancelled invoice takes no payment — its primary is the document (the sample data has one since ADR-023).
      assert.equal(text(primary), settled || status === 'cancelled' ? 'เอกสาร/PDF' : 'รับชำระ', `${facts.no}: ${status}`);
    }
    assert.deepEqual([...states].sort(), [false, true], 'the sample data has paid and unpaid invoices');
    // Only the first line of a multi-line invoice carries the actions (as before).
    const rowsWithActions = new Set(cellsIn(d, '#itbl').map(cell => factsOf(cell).id));
    assert.equal(rowsWithActions.size, cellsIn(d, '#itbl').length, 'one action cell per invoice');
    // Credit notes: voided rows have the document only.
    show(w, 'credit-note-list');
    for (const cell of cellsIn(d, '#cnltbl')) {
      const { live } = factsOf(cell);
      assert.equal(!!cell.querySelector('[data-row-menu]'), !!live);
      assert.equal(cell.querySelector('.erp-rowact-primary').dataset.cnAction, 'preview-saved');
    }
    // Purchase orders: draft/ordered → รับสินค้า + ⋯ (ยกเลิก PO); cancelled → nothing.
    show(w, 'purchase-order');
    const po = Object.fromEntries(cellsIn(d, '#po-list-table').map(cell => [factsOf(cell).id, cell]));
    assert.equal(text(po.po_draft.querySelector('.erp-rowact-primary')), 'รับสินค้า'); // ADR-017: line icon, no emoji
    assert.ok(po.po_ordered.querySelector('[data-row-menu]'));
    assert.equal(po.po_cancelled, undefined, 'a cancelled PO has no action');
    // Goods receipts: a reversed one has no action; a live one only "⋯" (กลับรายการ is destructive).
    show(w, 'goods-receipt');
    const gr = cellsIn(d, '#gr-list-table');
    assert.deepEqual(gr.map(cell => factsOf(cell).id), ['gr_live']);
    assert.equal(gr[0].querySelector('.erp-rowact-primary'), null);
    // Order-flow centre: billing notes and payments.
    w.ERPOrderFlow.openTab('billing');
    const billing = [...d.querySelectorAll('#erp-flow-root .erp-rowact[data-row-actions="billing"]')];
    const payments = [...d.querySelectorAll('#erp-flow-root .erp-rowact[data-row-actions="payment"]')];
    assert.ok(billing.length > 0 && payments.length > 0, 'sample billing note and payment');
    for (const cell of billing) {
      const { status } = factsOf(cell);
      assert.equal(cell.querySelector('.erp-rowact-primary').dataset.orderAction, ['paid', 'cancelled'].includes(status) ? 'print-billing' : 'receive-payment', status);
    }
    for (const cell of payments) assert.equal(cell.querySelector('.erp-rowact-primary'), null, 'ยกเลิกรับเงิน is only in the menu');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('"⋯" menus: remaining actions in order with the destructive one last; each item calls the original handler with the row ids; dataset actions reach their module', async () => {
  const h = await bootWithSamples(), { w } = h, d = w.document;
  try {
    // Invoices: stub the global handlers and choose each menu item of an outstanding and of a settled invoice.
    show(w, 'invoice-list');
    const cells = cellsIn(d, '#itbl');
    const open = cells.find(cell => !factsOf(cell).settled);
    const settled = cells.find(cell => factsOf(cell).settled);
    const calls = [];
    const record = name => (...args) => { calls.push([name, ...args]); };
    const saved = {};
    for (const name of ['openDeliveryDocumentFromInvoice', 'showDetailById', 'editInvoice', 'issueReceiptFromInvoice', 'delDoc']) { saved[name] = w[name]; w[name] = record(name); }
    saved.ERPCreditNotes = w.ERPCreditNotes;
    w.ERPCreditNotes = { startFromInvoice: record('ERPCreditNotes.startFromInvoice') };
    saved.ERPDocumentCancel = w.ERPDocumentCancel; // ADR-021: "ยกเลิกใบกำกับภาษี" replaced "ลบ"
    w.ERPDocumentCancel = { open: record('ERPDocumentCancel.open') };
    const cancelLabel = cell => (factsOf(cell).vatNone ? 'ยกเลิกใบแจ้งหนี้' : 'ยกเลิกใบกำกับภาษี');
    try {
      const more = openMenu(w, open);
      assert.equal(more.getAttribute('aria-label'), `การทำงานเพิ่มเติม ${factsOf(open).no}`);
      assert.equal(more.getAttribute('aria-haspopup'), 'menu');
      // ADR-017: each item shows its line icon (aria-hidden SVG) and the label.
      assert.deepEqual(itemLabels(d), ['ต้นฉบับ/สำเนา/PDF', 'ดูรายละเอียด', 'แก้ไข', 'ลดหนี้', cancelLabel(open)]);
      assert.deepEqual(openMenuItems(d).map(item => item.querySelector('.erp-menu-icon use')?.getAttribute('href')), ['document', 'preview', 'edit', 'credit-note', 'cancel'].map(name => `#erp-i-${name}`));
      const menu = menuElements(d)[0];
      assert.equal(menu.parentElement, d.body, 'the menu lives in <body>, outside the table wrapper');
      assert.equal(menu.getAttribute('role'), 'menu');
      const separator = menu.querySelector('[role="separator"]');
      assert.ok(separator && separator.nextElementSibling === openMenuItems(d).at(-1), 'one separator, then the destructive item');
      assert.ok(openMenuItems(d).at(-1).classList.contains('is-danger'));
      more.click(); // close
      const f = factsOf(open), s = factsOf(settled);
      for (const [cell, label] of [[open, 'ต้นฉบับ/สำเนา/PDF'], [open, 'ดูรายละเอียด'], [open, 'แก้ไข'], [open, 'ลดหนี้'], [open, cancelLabel(open)], [settled, 'ออกใบเสร็จ']]) {
        openMenu(w, cell);
        chooseItem(d, label);
        assert.equal(menuElements(d).length, 0, 'choosing an item closes the menu');
      }
      // The primary button of the outstanding invoice: "รับชำระ" = issueReceiptFromInvoice.
      open.querySelector('.erp-rowact-primary').click();
      assert.deepEqual(calls, [
        ['openDeliveryDocumentFromInvoice', f.b, f.y, f.m, String(f.id)],
        ['showDetailById', 'invoice', f.b, f.y, f.m, String(f.id)],
        ['editInvoice', f.b, f.y, f.m, String(f.id)],
        ['ERPCreditNotes.startFromInvoice', f.b, f.y, f.m, String(f.id)],
        ['ERPDocumentCancel.open', 'invoices', f.b, f.y, f.m, String(f.id)],
        ['issueReceiptFromInvoice', s.b, s.y, s.m, String(s.id)],
        ['issueReceiptFromInvoice', f.b, f.y, f.m, String(f.id)]
      ]);
    } finally { Object.assign(w, saved); }

    // Real handlers: "ลดหนี้" opens the credit-note form for that invoice; "ออกใบเสร็จ" the receipt form.
    show(w, 'invoice-list');
    const target = cellsIn(d, '#itbl').find(cell => factsOf(cell).settled);
    const t = factsOf(target);
    openMenu(w, target);
    chooseItem(d, 'ลดหนี้');
    assert.ok(d.getElementById('panel-credit-note-form').classList.contains('active'));
    assert.equal(String(w.ERPCreditNotes.getFormState().lines[0].ref.id), String(t.id));
    show(w, 'invoice-list');
    openMenu(w, cellsIn(d, '#itbl').find(cell => factsOf(cell).id === t.id));
    chooseItem(d, 'ออกใบเสร็จ');
    assert.ok(d.getElementById('panel-receipt-form').classList.contains('active'));
    assert.equal(d.getElementById('r-inv-no').value, t.no);

    // Credit notes (data-cn-action, handled by erp-credit-note.js): "ยกเลิกใบลดหนี้" asks for a reason (askVoid);
    // declining changes nothing. "แก้ไข" loads it into the form.
    show(w, 'credit-note-list');
    const live = cellsIn(d, '#cnltbl').find(cell => factsOf(cell).live);
    const cn = factsOf(live);
    assert.deepEqual(itemLabelsOf(w, live), ['edit:แก้ไข', 'cancel:ยกเลิกใบลดหนี้']);
    const prompts = [];
    w.prompt = message => { prompts.push(message); return null; };
    openMenu(w, live);
    chooseItem(d, 'ยกเลิกใบลดหนี้');
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], new RegExp(`ยกเลิกใบลดหนี้ ${cn.no}`));
    const stored = w.ERPCreditNotes.allCreditNotes().find(row => String(row.id) === String(cn.id));
    assert.ok(!stored.voided && stored.status !== 'voided', 'declined: still live');
    show(w, 'credit-note-list');
    openMenu(w, cellsIn(d, '#cnltbl').find(cell => factsOf(cell).id === cn.id));
    chooseItem(d, 'แก้ไข');
    assert.ok(w.ERPCreditNotes.getFormState().edit, 'loaded for editing');

    // Payments (data-order-action): "ยกเลิกรับเงิน" → voidPayment asks first; declining keeps the payment.
    w.ERPOrderFlow.openTab('billing');
    const confirms = [];
    w.confirm = message => { confirms.push(message); return false; };
    const payment = d.querySelector('#erp-flow-root .erp-rowact[data-row-actions="payment"]');
    openMenu(w, payment);
    assert.deepEqual(itemLabels(d), ['ยกเลิกรับเงิน']); // ADR-017: line icon, no emoji
    chooseItem(d, 'ยกเลิกรับเงิน');
    assert.equal(confirms.length, 1);
    assert.match(confirms[0], /ยกเลิกรับเงินรายการนี้/);
    assert.ok(!w.ERPOrderFlow.getStore().payments.find(p => p.id === factsOf(payment).id).voided);
    // Purchase order: "ยกเลิก PO" → pcCancelPo asks first.
    w.go('purchase-order');
    const draft = cellsIn(d, '#po-list-table').find(cell => factsOf(cell).id === 'po_draft');
    openMenu(w, draft);
    chooseItem(d, 'ยกเลิก PO');
    assert.equal(confirms.length, 2);
    assert.match(confirms[1], /ยกเลิก PO_DRAFT/);
    // Master data: "ปิดใช้งาน" reaches archiveContactMaster (it was not on window before part B).
    assert.equal(typeof w.archiveContactMaster, 'function');
    assert.equal(typeof w.archiveProductMasterLocal, 'function');
    show(w, 'master-data');
    openMenu(w, cellsIn(d, '#master-customer-table')[0]);
    chooseItem(d, 'ปิดใช้งาน');
    assert.equal(confirms.length, 3);
    assert.match(confirms[2], /ปิดใช้งานข้อมูลนี้หรือไม่/);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

function itemLabelsOf(w, cell) {
  const actions = w.ERPRowActions.rowActions(cell.dataset.rowActions, JSON.parse(cell.dataset.rowFacts));
  // ADR-017: action.icon is now an erp-icons.js name (was an emoji); "name:label".
  return [...w.ERPRowActions.splitRowActions(actions).menu].map(action => `${action.icon}:${action.label}`);
}

test('delete keeps its confirmation: declined → nothing changes, accepted → deleted; business-rule overrides now ask too', async () => {
  const h = await bootWithSamples(), { w } = h, d = w.document;
  try {
    show(w, 'quote-list');
    const cell = cellsIn(d, '#qtbl')[0];
    const f = factsOf(cell);
    const count = () => w.loadFor(f.b, f.y, f.m).quotes.filter(q => String(q.id) === String(f.id)).length;
    assert.equal(count(), 1);
    const asked = [];
    w.confirm = message => { asked.push(message); return false; };
    openMenu(w, cell);
    chooseItem(d, 'ลบ');
    await sleep(20);
    assert.equal(asked.length, 1, 'asked exactly once (no second confirm added)');
    assert.match(asked[0], /ลบรายการนี้หรือไม่/);
    assert.equal(count(), 1, 'declined: the quote is still there');
    w.confirm = message => { asked.push(message); return true; };
    openMenu(w, cellsIn(d, '#qtbl').find(c => factsOf(c).id === f.id));
    chooseItem(d, 'ลบ');
    await sleep(20);
    assert.equal(asked.length, 2);
    assert.equal(count(), 0, 'accepted: deleted');
    assert.equal(cellsIn(d, '#qtbl').some(c => factsOf(c).id === f.id), false, 'the list re-rendered without it');

    // Business rules: the override delete had no confirmation; it asks now.
    w.go('business-rules');
    w.BusinessRulesService.render();
    w.confirm = message => { asked.push(message); return false; };
    openMenu(w, cellsIn(d, '#br-product-rules-table')[0]);
    assert.deepEqual(itemLabels(d), ['ลบ Override']); // ADR-017: line icon, no emoji
    chooseItem(d, 'ลบ Override');
    assert.equal(asked.length, 3);
    assert.match(asked[2], /ลบ Product Override “SKU-A”/);
    assert.equal(w.BusinessRulesService.read().productRules.length, 1, 'declined: kept');
    w.confirm = () => true;
    openMenu(w, cellsIn(d, '#br-product-rules-table')[0]);
    chooseItem(d, 'ลบ Override');
    assert.equal(w.BusinessRulesService.read().productRules.length, 0, 'accepted: removed');
    openMenu(w, cellsIn(d, '#br-customer-rules-table')[0]);
    chooseItem(d, 'ลบ Override');
    assert.equal(w.BusinessRulesService.read().customerRules.length, 0);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('menu behaviour: keyboard, Escape returns focus, outside click, one open at a time, re-rendering leaves no orphan menu, no duplicate items or listeners', async () => {
  const h = await bootWithSamples(), { w } = h, d = w.document;
  try {
    show(w, 'invoice-list');
    const [first, second] = cellsIn(d, '#itbl');
    const firstMore = first.querySelector('[data-row-menu]');
    const secondMore = second.querySelector('[data-row-menu]');
    const key = (element, name) => element.dispatchEvent(new w.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
    // ArrowDown on "⋯" opens with focus on the first item; ArrowUp on the last (destructive) one.
    firstMore.focus();
    key(firstMore, 'ArrowDown');
    assert.equal(firstMore.getAttribute('aria-expanded'), 'true');
    assert.equal(d.activeElement, openMenuItems(d)[0]);
    key(d.activeElement, 'ArrowDown');
    assert.equal(d.activeElement, openMenuItems(d)[1]);
    // Escape closes and returns focus to "⋯".
    key(d.activeElement, 'Escape');
    assert.equal(menuElements(d).length, 0);
    assert.equal(firstMore.getAttribute('aria-expanded'), 'false');
    assert.equal(d.activeElement, firstMore);
    key(firstMore, 'ArrowUp');
    assert.equal(d.activeElement, openMenuItems(d).at(-1));
    assert.ok(d.activeElement.classList.contains('is-danger'));
    // Opening another row's menu closes the first one: only one is open.
    secondMore.click();
    assert.equal(menuElements(d).length, 1);
    assert.equal(firstMore.getAttribute('aria-expanded'), 'false');
    assert.equal(secondMore.getAttribute('aria-expanded'), 'true');
    // A click outside closes it without moving focus to "⋯".
    d.querySelector('#panel-invoice-list .card-title').click();
    assert.equal(menuElements(d).length, 0);
    assert.equal(secondMore.getAttribute('aria-expanded'), 'false');
    // Re-rendering the table while a menu is open (filter, search, save): the menu goes away with its row.
    const itemCount = (openMenu(w, first), openMenuItems(d).length);
    w.renderIList();
    await sleep(0);
    assert.equal(menuElements(d).length, 0, 'no orphan menu after re-render');
    assert.equal(d.querySelectorAll('.erp-menu:not([hidden])').length, 0);
    // Re-render several times: same items, one menu, one delegated listener, the handler runs once.
    const listenersBefore = { ...w.__listenerCounts };
    for (let i = 0; i < 5; i++) w.renderIList();
    assert.deepEqual(w.__listenerCounts, listenersBefore, 'rendering adds no document listener');
    const again = cellsIn(d, '#itbl')[0];
    openMenu(w, again);
    assert.equal(openMenuItems(d).length, itemCount);
    assert.equal(menuElements(d).length, 1);
    again.querySelector('[data-row-menu]').click();
    assert.equal(menuElements(d).length, 0);
    assert.equal(again.querySelectorAll('[data-row-menu]').length, 1);
    const primary = again.querySelector('.erp-rowact-primary');
    const fn = w.ERPRowActions.rowActions('invoice', factsOf(again)).find(action => action.id === primary.dataset.rowAction).call.fn;
    let runs = 0;
    const original = w[fn];
    w[fn] = () => { runs += 1; };
    try { primary.click(); } finally { w[fn] = original; }
    assert.equal(runs, 1, 'one click → one call, however often the table was rendered');
    // Row menus reuse the part A component: no second menu system.
    assert.equal(w.document.querySelectorAll('.erp-menu').length, d.querySelectorAll('.erp-menu:not(.erp-rowact-menu)').length);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});
