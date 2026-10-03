// ADR-016 (round 5 part B, UI declutter): the pure core of erp-row-actions.js — one action list
// per table row drives both the visible primary button and the "⋯" menu. No app boot (fast suite).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
let core;
test.before(async () => {
  core = await import(pathToFileURL(path.join(ROOT, 'erp-row-actions.js')).href + '?v=' + Date.now());
});

const ids = actions => actions.map(action => action.id);
const kinds = actions => Object.fromEntries(actions.map(action => [action.id, action.kind]));
const primaryOf = actions => core.splitRowActions(actions).primary;
const menuOf = actions => core.splitRowActions(actions).menu;
const REF = { b: 'ubon', y: 2026, m: 8, id: 123, no: 'DOC-1' };

// One representative row per list and state (every list id must appear here).
const SAMPLES = {
  quote: [{ ...REF, approved: false }, { ...REF, approved: true, converted: false }, { ...REF, approved: true, converted: true }],
  invoice: [{ ...REF, settled: false }, { ...REF, settled: true }],
  receipt: [{ ...REF, voided: false }, { ...REF, voided: true }],
  issuedInvoice: [REF],
  issuedReceipt: [REF],
  expense: [{ ...REF, id: 'e-1' }],
  production: [{ ...REF, linked: false, historical: false }, { ...REF, linked: true }, { ...REF, historical: true }],
  creditNote: [{ ...REF, id: '7', live: true }, { ...REF, id: '7', live: false }],
  purchaseOrder: ['draft', 'ordered', 'partial', 'received', 'cancelled'].map(status => ({ id: 'po_1', no: 'PO-1', status })),
  goodsReceipt: [{ id: 'gr_1', no: 'GR-1', reversed: false }, { id: 'gr_1', no: 'GR-1', reversed: true }],
  contact: [{ id: 'c1', role: 'customer', name: 'ลูกค้า ก' }, { id: 's1', role: 'supplier', name: 'ผู้ขาย ข' }],
  product: [{ key: 'SKU-1', name: 'สินค้า', seed: false }, { key: 'SKU-2', name: 'สินค้าตัวอย่าง', seed: true }],
  salesOrder: [{ id: 'so_1', no: 'SO-1' }],
  billing: ['draft', 'submitted', 'partially_paid', 'paid', 'cancelled'].map(status => ({ id: 'bill_1', no: 'BN-1', status })),
  payment: [{ id: 'pay_1', no: 'PAY-1', voided: false }, { id: 'pay_1', no: 'PAY-1', voided: true }],
  productRule: [{ key: 'SKU-1', name: 'SKU-1' }, { key: 'SKU-1', name: 'SKU-1', draft: true }],
  customerRule: [{ key: 'ลูกค้า ก', name: 'ลูกค้า ก' }, { key: 'ลูกค้า ก', name: 'ลูกค้า ก', draft: true }]
};

test('every list: menu order view → edit → create → other → destructive, at most one primary, never a destructive primary, frozen results', () => {
  assert.deepEqual([...core.ROW_ACTION_LIST_IDS].sort(), Object.keys(SAMPLES).sort(), 'the samples cover every list');
  for (const [listId, rows] of Object.entries(SAMPLES)) {
    for (const facts of rows) {
      const actions = core.rowActions(listId, facts);
      const ranks = actions.map(action => core.ROW_ACTION_GROUPS.indexOf(action.group));
      assert.ok(ranks.every(rank => rank >= 0), `${listId}: known groups`);
      assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), `${listId}: ordered by group`);
      assert.ok(actions.filter(action => action.kind === 'primary').length <= 1, `${listId}: one primary at most`);
      for (const action of actions) {
        assert.ok(Object.isFrozen(action), `${listId}.${action.id} frozen`);
        assert.equal(action.kind === 'danger', action.group === 'danger', `${listId}.${action.id}: danger kind ⇔ danger group`);
        assert.ok(!!action.call !== !!action.dataset, `${listId}.${action.id}: exactly one of call / dataset`);
        assert.ok(action.label && action.icon, `${listId}.${action.id}: label and icon`);
      }
      assert.equal(new Set(ids(actions)).size, actions.length, `${listId}: unique ids`);
    }
  }
});

test('invoice: outstanding → "รับชำระ" (issueReceiptFromInvoice) is the primary; settled → the document; the menu keeps the rest in order, delete last', () => {
  const open = core.rowActions('invoice', { ...REF, settled: false });
  assert.equal(primaryOf(open).id, 'receipt');
  assert.equal(primaryOf(open).primaryLabel, 'รับชำระ');
  assert.equal(primaryOf(open).label, 'ออกใบเสร็จ');
  assert.deepEqual(ids(menuOf(open)), ['doc', 'detail', 'edit', 'credit-note', 'delete']);
  const settled = core.rowActions('invoice', { ...REF, settled: true });
  assert.equal(primaryOf(settled).id, 'doc');
  assert.deepEqual(ids(menuOf(settled)), ['detail', 'edit', 'receipt', 'credit-note', 'delete']);
  assert.equal(menuOf(settled).at(-1).kind, 'danger');
});

test('quote: approved and not yet converted → "สั่งผลิต"; not approved, or already has a production order / invoice → the document', () => {
  assert.equal(primaryOf(core.rowActions('quote', { ...REF, approved: true, converted: false })).id, 'production');
  assert.equal(primaryOf(core.rowActions('quote', { ...REF, approved: true, converted: true })).id, 'doc');
  assert.equal(primaryOf(core.rowActions('quote', { ...REF, approved: false })).id, 'doc');
  assert.deepEqual(ids(core.rowActions('quote', { ...REF, approved: false })), ['doc', 'detail', 'edit', 'production', 'delete']);
});

test('voided / cancelled / locked rows: view only', () => {
  const voidedReceipt = core.rowActions('receipt', { ...REF, voided: true });
  assert.deepEqual(ids(voidedReceipt), ['doc', 'detail']);
  assert.equal(primaryOf(voidedReceipt).id, 'doc');
  assert.deepEqual(ids(core.rowActions('receipt', { ...REF, voided: false })), ['doc', 'detail', 'edit', 'delete']);
  assert.deepEqual(kinds(core.rowActions('creditNote', { ...REF, live: false })), { doc: 'primary' });
  assert.deepEqual(kinds(core.rowActions('creditNote', { ...REF, live: true })), { doc: 'primary', edit: 'normal', void: 'danger' });
  assert.deepEqual(ids(core.rowActions('issuedInvoice', REF)), ['detail']);
  assert.deepEqual(core.rowActions('payment', { id: 'p', voided: true }), []);
  assert.deepEqual(core.rowActions('goodsReceipt', { id: 'g', reversed: true }), []);
  assert.deepEqual(kinds(core.rowActions('billing', { id: 'b', status: 'cancelled' })), { print: 'primary' });
  assert.deepEqual(kinds(core.rowActions('billing', { id: 'b', status: 'paid' })), { print: 'primary' });
  assert.deepEqual(kinds(core.rowActions('billing', { id: 'b', status: 'submitted' })), { print: 'normal', receive: 'primary' });
});

test('conditions copied from the old renderers: production, purchase order, product master', () => {
  assert.deepEqual(kinds(core.rowActions('production', { ...REF, linked: false, historical: false })), { detail: 'normal', edit: 'normal', invoice: 'primary', delete: 'danger' });
  assert.deepEqual(kinds(core.rowActions('production', { ...REF, linked: true, historical: false })), { detail: 'primary', edit: 'normal', delete: 'danger' });
  assert.deepEqual(kinds(core.rowActions('production', { ...REF, linked: false, historical: true })), { detail: 'primary', delete: 'danger' });
  const po = status => kinds(core.rowActions('purchaseOrder', { id: 'po', status }));
  assert.deepEqual(po('draft'), { receive: 'primary', cancel: 'danger' });
  assert.deepEqual(po('ordered'), { receive: 'primary', cancel: 'danger' });
  assert.deepEqual(po('partial'), { receive: 'primary' });
  assert.deepEqual(po('received'), {});
  assert.deepEqual(po('cancelled'), {});
  assert.deepEqual(kinds(core.rowActions('product', { key: 'A', seed: true })), { edit: 'primary' });
  assert.deepEqual(kinds(core.rowActions('product', { key: 'A', seed: false })), { edit: 'primary', archive: 'danger' });
});

test('same handler, same arguments as the old per-row buttons (quoted ids → String, unquoted → raw value)', () => {
  const calls = (listId, facts) => Object.fromEntries(core.rowActions(listId, facts).map(action => [action.id, action.call ? [action.call.fn, ...action.call.args] : action.dataset]));
  // Old: onclick="openDeliveryDocumentFromInvoice('ubon',2026,8,'123')" … delDoc('ubon',2026,8,'invoices',123)
  assert.deepEqual(calls('invoice', { ...REF, settled: false }), {
    doc: ['openDeliveryDocumentFromInvoice', 'ubon', 2026, 8, '123'],
    detail: ['showDetailById', 'invoice', 'ubon', 2026, 8, '123'],
    edit: ['editInvoice', 'ubon', 2026, 8, '123'],
    receipt: ['issueReceiptFromInvoice', 'ubon', 2026, 8, '123'],
    'credit-note': ['ERPCreditNotes.startFromInvoice', 'ubon', 2026, 8, '123'],
    delete: ['delDoc', 'ubon', 2026, 8, 'invoices', 123]
  });
  assert.deepEqual(calls('quote', REF), {
    doc: ['openQuoteDocument', 'ubon', 2026, 8, '123'],
    detail: ['showDetailById', 'quote', 'ubon', 2026, 8, '123'],
    edit: ['editQuote', 'ubon', 2026, 8, '123'],
    production: ['useQuoteForProduction', 'ubon', 2026, 8, '123'],
    delete: ['delDoc', 'ubon', 2026, 8, 'quotes', 123]
  });
  assert.deepEqual(calls('receipt', REF), {
    doc: ['openReceiptDocumentFromReceipt', 'ubon', 2026, 8, '123'],
    detail: ['showDetailById', 'receipt', 'ubon', 2026, 8, '123'],
    edit: ['editReceipt', 'ubon', 2026, 8, '123'],
    delete: ['delDoc', 'ubon', 2026, 8, 'receipts', 123]
  });
  assert.deepEqual(calls('expense', { ...REF, id: 'e-9' }), {
    detail: ['showDetailById', 'expense', 'ubon', 2026, 8, 'e-9'],
    delete: ['delDoc', 'ubon', 2026, 8, 'expenses', 'e-9']
  });
  assert.deepEqual(calls('production', REF), {
    detail: ['showDetailById', 'production', 'ubon', 2026, 8, '123'],
    edit: ['editProduction', 'ubon', 2026, 8, '123'],
    invoice: ['useProductionForInvoice', 'ubon', 2026, 8, '123'],
    delete: ['delDoc', 'ubon', 2026, 8, 'productions', 123]
  });
  assert.deepEqual(calls('issuedReceipt', REF), { detail: ['showIssuedDocumentDetail', 'issuedReceipts', 'ubon', 2026, 8, '123'] });
  assert.deepEqual(calls('contact', { id: 'c1', role: 'supplier' }), { edit: ['editContactMaster', 'c1', 'supplier'], archive: ['archiveContactMaster', 'c1', 'supplier'] });
  assert.deepEqual(calls('product', { key: 'SKU "1"' }), { edit: ['editProductMasterLocal', 'SKU "1"'], archive: ['archiveProductMasterLocal', 'SKU "1"'] });
  // data-* actions: exactly the attributes of the old buttons (the owning module's listener runs them).
  assert.deepEqual(calls('creditNote', { b: 'khonkaen', y: 2026, m: 3, id: '55', live: true }), {
    doc: { cnAction: 'preview-saved', branch: 'khonkaen', year: '2026', month: '3', id: '55' },
    edit: { cnAction: 'edit', branch: 'khonkaen', year: '2026', month: '3', id: '55' },
    void: { cnAction: 'void', branch: 'khonkaen', year: '2026', month: '3', id: '55' }
  });
  assert.deepEqual(calls('purchaseOrder', { id: 'po_7', status: 'draft' }), { receive: { prodcoreAction: 'use-po', recordId: 'po_7' }, cancel: { prodcoreAction: 'cancel-po', recordId: 'po_7' } });
  assert.deepEqual(calls('goodsReceipt', { id: 'gr_7' }), { reverse: { prodcoreAction: 'reverse-gr', recordId: 'gr_7' } });
  assert.deepEqual(calls('billing', { id: 'b1', status: 'draft' }), { print: { orderAction: 'print-billing', recordId: 'b1' }, receive: { orderAction: 'receive-payment', recordId: 'b1' } });
  assert.deepEqual(calls('payment', { id: 'p1' }), { void: { orderAction: 'void-payment', recordId: 'p1' } });
  assert.deepEqual(calls('salesOrder', { id: 'so1' }), { open: { orderAction: 'open-order', recordId: 'so1' } });
  // r5fix#2: rows are identified by their stable rule key, not by their position in the table (was { index }).
  assert.deepEqual(calls('productRule', { key: 'SKU-3' }), { delete: { delProduct: 'SKU-3' } });
  assert.deepEqual(calls('customerRule', { key: 'ลูกค้า ก' }), { delete: { delCustomer: 'ลูกค้า ก' } });
});

test('rowActionsHtml: exactly one primary button + one "⋯" (a real button naming the row), facts round-trip, attributes escaped', () => {
  const { window } = new JSDOM('<table><tbody><tr><td id="cell"></td></tr></tbody></table>');
  const cell = window.document.getElementById('cell');
  const facts = { ...REF, no: `INV"<'&>`, settled: false };
  cell.innerHTML = core.rowActionsHtml('invoice', facts);
  const wrapper = cell.querySelector('.erp-rowact');
  assert.equal(wrapper.dataset.rowActions, 'invoice');
  assert.deepEqual(JSON.parse(wrapper.dataset.rowFacts), facts);
  const buttons = [...cell.querySelectorAll('button')];
  assert.equal(buttons.length, 2);
  const [primary, more] = buttons;
  assert.equal(primary.type, 'button');
  assert.equal(primary.dataset.rowAction, 'receipt');
  // ADR-017: icons are aria-hidden line SVGs (erp-icons.js), so the text is the label alone.
  assert.equal(primary.textContent, 'รับชำระ');
  assert.equal(primary.querySelector('svg.erp-icon use').getAttribute('href'), '#erp-i-receipt');
  assert.equal(primary.title, 'ออกใบเสร็จจากบิลนี้');
  assert.equal(primary.getAttribute('onclick'), null, 'no inline handler');
  assert.equal(more.type, 'button');
  assert.ok(more.hasAttribute('data-row-menu'));
  assert.equal(more.getAttribute('aria-haspopup'), 'menu');
  assert.equal(more.getAttribute('aria-expanded'), 'false');
  assert.equal(more.getAttribute('aria-label'), `การทำงานเพิ่มเติม INV"<'&>`);
  assert.equal(cell.querySelectorAll('script, [onclick]').length, 0);
  // A dataset action: the primary carries the old data-* attributes.
  cell.innerHTML = core.rowActionsHtml('creditNote', { b: 'ubon', y: 2026, m: 8, id: '7', no: 'CN-1', live: true });
  const cnPrimary = cell.querySelector('.erp-rowact-primary');
  assert.deepEqual({ ...cnPrimary.dataset }, { rowAction: 'doc', cnAction: 'preview-saved', branch: 'ubon', year: '2026', month: '8', id: '7' });
  // Only a menu (no primary): destructive-only rows; only a primary (no "⋯"): nothing else to offer.
  cell.innerHTML = core.rowActionsHtml('goodsReceipt', { id: 'g', no: 'GR-1' });
  assert.deepEqual([...cell.querySelectorAll('button')].map(button => button.className), ['erp-rowact-more']);
  cell.innerHTML = core.rowActionsHtml('issuedInvoice', REF);
  // ADR-017: a row's primary is a secondary-level button (lighter than the page's "+ สร้าง…").
  assert.deepEqual([...cell.querySelectorAll('button')].map(button => button.className), ['btn btn-secondary btn-sm erp-rowact-primary']);
  assert.equal(core.rowActionsHtml('payment', { id: 'p', voided: true }), '');
  window.close();
});

test('rowMenuItems: the non-primary actions in menu order; call actions get onSelect, data-* actions carry their attributes', () => {
  const ran = [];
  const items = core.rowMenuItems(core.rowActions('invoice', { ...REF, settled: true }), action => ran.push(action.id));
  assert.deepEqual(items.map(item => [item.key, item.danger]), [['detail', false], ['edit', false], ['receipt', false], ['credit-note', false], ['delete', true]]);
  assert.deepEqual(items.map(item => item.order), [0, 1, 2, 3, 4]);
  items[2].onSelect();
  assert.deepEqual(ran, ['receipt']);
  const cn = core.rowMenuItems(core.rowActions('creditNote', { b: 'ubon', y: 2026, m: 8, id: '7', live: true }), () => assert.fail('dataset actions are not run here'));
  assert.deepEqual(cn.map(item => item.key), ['edit', 'void']);
  assert.equal(cn[0].onSelect, undefined);
  assert.deepEqual(cn[1].dataset, { cnAction: 'void', branch: 'ubon', year: '2026', month: '8', id: '7', rowactId: 'void' });
});

test('resolveRowActionCall / rowActions input checks', () => {
  const owner = { startFromInvoice() { return this; } };
  const root = { ERPCreditNotes: owner, delDoc: () => 'x' };
  const nested = core.resolveRowActionCall('ERPCreditNotes.startFromInvoice', root);
  assert.equal(nested.owner, owner, 'called with its object as `this`');
  assert.equal(core.resolveRowActionCall('delDoc', root).fn(), 'x');
  assert.equal(core.resolveRowActionCall('missing', root), null);
  assert.equal(core.resolveRowActionCall('ERPCreditNotes.nope', root), null);
  assert.equal(core.resolveRowActionCall('Nope.startFromInvoice', root), null);
  assert.equal(core.resolveRowActionCall('', root), null);
  assert.throws(() => core.rowActions('invoices', REF), /unknown list/);
  assert.throws(() => core.rowActions('__proto__', REF), /unknown list/);
  assert.deepEqual(ids(core.rowActions('invoice', null)), ['doc', 'detail', 'edit', 'receipt', 'credit-note', 'delete'], 'missing facts do not crash');
  assert.equal(core.rowMenuLabel('invoice', { no: '' }), 'การทำงานเพิ่มเติม');
  assert.equal(core.rowMenuLabel('contact', { name: 'บจก. เอ' }), 'การทำงานเพิ่มเติม บจก. เอ');
});
