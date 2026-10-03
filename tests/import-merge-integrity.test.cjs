// JSON backup import (merge / replace) must never corrupt issued credit notes
// (ใบลดหนี้ — tax documents), and every storage write must drop app.js's
// per-render business() cache. Regression tests for review round 4 (fix4#1, #2, #4).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { boot } = require('./dom-helper.cjs');

const ROOT = path.resolve(__dirname, '..');
const imp = file => import(pathToFileURL(path.join(ROOT, file)).href + '?t=' + Date.now() + Math.random());
const MONTH_TH = 'กันยายน';
const uiInvoice = (id, no, over = {}) => ({ id, no, branch: 'ubon', date: '2026-09-05', customer: 'ลูกค้าทดสอบ', customerTaxId: '0105555555555', subtotal: 1000, total: 1070, vatAmt: 70, useVat: 1, vatMode: 'add', items: [{ product: 'สินค้าทดสอบ', productCode: 'CN-P', qty: 10, unit: 'ชิ้น', priceUnit: 100, saleTotal: 1000, costTotal: 0 }], paymentManaged: true, ...over });

async function creditNoteFor(invoice, id, no, differenceAmount) {
  const c = await imp('erp-credit-note-core.js');
  const calc = c.calculateCreditNote({ lines: [{ invoice: { ...invoice, _year: 2026, _month: 8 }, differenceAmount }] });
  return { id, no, date: '2026-09-15', branch: 'ubon', customer: invoice.customer, reasonCode: 'price_overcharge', reasonLabel: 'x', lines: calc.lines, invoiceNos: [invoice.no], subtotal: calc.subtotal, vatAmt: calc.vatAmt, total: calc.total, vatMode: 'add', status: 'issued', voided: false };
}
const backupFile = data => ({ text: async () => JSON.stringify({ meta: { app: 'comform-esan', backupType: 'month' }, data }) });
async function importBackup(w, data, mode) {
  w.document.getElementById('import-mode').value = mode;
  await w.importJSON({ target: { files: [backupFile(data)], value: 'x' } });
  return w.document.getElementById('import-json-status').textContent;
}
// jsdom arrays belong to another realm: compare plain copies with deepStrictEqual.
const plain = value => JSON.parse(JSON.stringify(value));
// Lets ERPIntegrity.changed() (queued reconcilePayments) finish before a snapshot is taken.
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const cnState = w => plain(w.loadFor('ubon', 2026, 8).creditNotes).map(r => ({ id: r.id, no: r.no, voided: !!r.voided, status: r.status, voidReason: r.voidReason, total: r.total }));

test('fix4#1: merge-import of an older backup keeps a voided credit note voided (void is one-way, void fields kept)', async () => {
  const h = await boot(); const { w } = h;
  try {
    const invoice = uiInvoice(301, 'INV-BK');
    const d = w.loadFor('ubon', 2026, 8); d.invoices = [invoice]; d.creditNotes = [await creditNoteFor(invoice, 9301, 'CN690901', 1000)]; w.saveFor('ubon', 2026, 8, d);
    const backup = w.testApp.collectBackupData({ year: 2026, month: 8, branch: 'ubon', includeEmpty: true });
    assert.equal(await w.ERPCreditNotes.voidCreditNote('ubon', 2026, 8, 9301, 'ออกผิด'), true);
    const voided = w.loadFor('ubon', 2026, 8).creditNotes[0];
    const status = await importBackup(w, backup, 'merge');
    const after = w.loadFor('ubon', 2026, 8).creditNotes;
    assert.equal(after.length, 1, status);
    for (const field of ['voided', 'status', 'voidReason', 'voidedAt', 'voidedBy']) assert.deepEqual(after[0][field], voided[field], field);
    assert.equal(w.ERPIntegrity.paymentSummary({ ...invoice }).credited, 0);
  } finally { h.close(); }
});

test('fix4#1: merge-import keeps the device copy of an issued credit note, but a void in the backup is applied', async () => {
  const h = await boot(); const { w } = h;
  try {
    const invoice = uiInvoice(302, 'INV-KP');
    const device = await creditNoteFor(invoice, 9302, 'CN690902', 100);
    const d = w.loadFor('ubon', 2026, 8); d.invoices = [invoice]; d.creditNotes = [device]; w.saveFor('ubon', 2026, 8, d);
    const backup = w.testApp.collectBackupData({ year: 2026, month: 8, branch: 'ubon', includeEmpty: true });
    // Backup copy of the same note with different financial fields: the issued device copy must win.
    const tampered = await creditNoteFor(invoice, 9302, 'CN690902', 500);
    backup[2026].ubon[MONTH_TH].creditNotes = [{ ...tampered, date: '2026-09-20', note: 'จาก backup' }];
    await importBackup(w, backup, 'merge');
    let stored = w.loadFor('ubon', 2026, 8).creditNotes;
    assert.equal(stored.length, 1);
    assert.deepEqual([stored[0].total, stored[0].date, stored[0].lines[0].differenceAmount], [device.total, device.date, 100]);
    // The backup copy is voided (voided on another device): the void is propagated, amounts still the device's.
    backup[2026].ubon[MONTH_TH].creditNotes = [{ ...tampered, voided: true, status: 'voided', voidReason: 'ยกเลิกจากอีกเครื่อง', voidedAt: '2026-09-21T00:00:00.000Z', voidedBy: 'other@x' }];
    await importBackup(w, backup, 'merge');
    stored = w.loadFor('ubon', 2026, 8).creditNotes;
    assert.equal(stored.length, 1);
    assert.deepEqual([stored[0].voided, stored[0].status, stored[0].voidReason, stored[0].voidedBy, stored[0].total], [true, 'voided', 'ยกเลิกจากอีกเครื่อง', 'other@x', device.total]);
  } finally { h.close(); }
});

test('fix4#1: void + reissue, then merge-import of the old backup does not credit the invoice twice', async () => {
  const h = await boot(); const { w } = h;
  try {
    const invoice = uiInvoice(303, 'INV-RI');
    const d = w.loadFor('ubon', 2026, 8); d.invoices = [invoice]; d.creditNotes = [await creditNoteFor(invoice, 9303, 'CN690901', 1000)]; w.saveFor('ubon', 2026, 8, d);
    const backup = w.testApp.collectBackupData({ year: 2026, month: 8, branch: 'ubon', includeEmpty: true });
    assert.equal(await w.ERPCreditNotes.voidCreditNote('ubon', 2026, 8, 9303, 'ออกผิด'), true);
    const cur = w.loadFor('ubon', 2026, 8); cur.creditNotes.push(await creditNoteFor(invoice, 9304, 'CN690902', 1000)); w.saveFor('ubon', 2026, 8, cur);
    await importBackup(w, backup, 'merge');
    const live = w.loadFor('ubon', 2026, 8).creditNotes.filter(r => !r.voided && r.status !== 'voided');
    assert.deepEqual(plain(live.map(r => r.no)), ['CN690902']);
    assert.equal(w.ERPIntegrity.creditedTotal({ ...invoice }), 1070);
  } finally { h.close(); }
});

test('fix4#1: an import that would over-credit an invoice or duplicate a credit-note number is rolled back with a clear message', async () => {
  const h = await boot(); const { w } = h;
  try {
    const invoice = uiInvoice(305, 'INV-OC');
    const d = w.loadFor('ubon', 2026, 8); d.invoices = [invoice]; d.creditNotes = [await creditNoteFor(invoice, 9305, 'CN690905', 1000)]; w.saveFor('ubon', 2026, 8, d);
    await settle();
    const before = JSON.stringify(w.loadFor('ubon', 2026, 8));
    // A backup from another device with a different full credit note for the same invoice.
    const other = { [2026]: { ubon: { [MONTH_TH]: { invoices: [invoice], creditNotes: [await creditNoteFor(invoice, 9306, 'CN690906', 1000)] } } } };
    let status = await importBackup(w, other, 'merge');
    assert.match(status, /นำเข้าไม่สำเร็จ/);
    assert.match(status, /INV-OC/); assert.match(status, /CN690905/); assert.match(status, /CN690906/);
    assert.equal(JSON.stringify(w.loadFor('ubon', 2026, 8)), before);
    assert.equal(w.ERPIntegrity.creditedTotal({ ...invoice }), 1070);
    // Same number, different id (a partial note, so only the number rule is broken).
    const dup = { [2026]: { ubon: { [MONTH_TH]: { invoices: [invoice], creditNotes: [{ ...(await creditNoteFor(invoice, 9307, 'CN690905', 1)), voided: true, status: 'voided' }] } } } };
    status = await importBackup(w, dup, 'merge');
    assert.match(status, /นำเข้าไม่สำเร็จ/); assert.match(status, /CN690905 ถูกใช้ซ้ำ/);
    assert.equal(JSON.stringify(w.loadFor('ubon', 2026, 8)), before);
    // Replace mode is checked too: CN690905 is voided and reissued next month as CN691001; restoring the
    // September backup (CN690905 still live) would leave two live full credit notes on the invoice.
    const oldSeptember = { [2026]: { ubon: { [MONTH_TH]: { invoices: [invoice], creditNotes: [await creditNoteFor(invoice, 9305, 'CN690905', 1000)] } } } };
    assert.equal(await w.ERPCreditNotes.voidCreditNote('ubon', 2026, 8, 9305, 'ออกผิดเดือน'), true);
    const nextMonth = w.loadFor('ubon', 2026, 9); nextMonth.creditNotes = [{ ...(await creditNoteFor(invoice, 9308, 'CN691001', 1000)), date: '2026-10-02' }]; w.saveFor('ubon', 2026, 9, nextMonth);
    await settle();
    const beforeReplace = JSON.stringify([w.loadFor('ubon', 2026, 8), w.loadFor('ubon', 2026, 9)]);
    status = await importBackup(w, oldSeptember, 'replace');
    assert.match(status, /นำเข้าไม่สำเร็จ/); assert.match(status, /CN690905/); assert.match(status, /CN691001/);
    assert.equal(JSON.stringify([w.loadFor('ubon', 2026, 8), w.loadFor('ubon', 2026, 9)]), beforeReplace);
    assert.equal(w.ERPIntegrity.creditedTotal({ ...invoice }), 1070);
  } finally { h.close(); }
});

test('fix4#2: replace-restore of a backup made before credit notes existed keeps the device credit notes', async () => {
  const h = await boot(); const { w } = h;
  try {
    const invoice = uiInvoice(310, 'INV-OLD');
    const d0 = w.loadFor('ubon', 2026, 8); d0.invoices = [invoice]; w.saveFor('ubon', 2026, 8, d0);
    const old = w.testApp.collectBackupData({ year: 2026, month: 8, branch: 'ubon', includeEmpty: true });
    delete old[2026].ubon[MONTH_TH].creditNotes; // pre-feature backup format
    const d = w.loadFor('ubon', 2026, 8); d.creditNotes = [await creditNoteFor(invoice, 9310, 'CN690910', 200)]; w.saveFor('ubon', 2026, 8, d);
    let asked = 0; w.confirm = () => { asked += 1; return true; };
    const status = await importBackup(w, old, 'replace');
    assert.match(status, /แทนที่/);
    assert.deepEqual(cnState(w).map(r => r.no), ['CN690910']);
    assert.equal(asked, 0);
    assert.equal(w.ERPIntegrity.creditedTotal({ ...invoice }), 214);
  } finally { h.close(); }
});

test('fix4#2: replace-restore that would remove issued credit notes asks first; declining changes nothing', async () => {
  const h = await boot(); const { w } = h;
  try {
    const invoice = uiInvoice(311, 'INV-RM');
    const d0 = w.loadFor('ubon', 2026, 8); d0.invoices = [invoice]; w.saveFor('ubon', 2026, 8, d0);
    const old = w.testApp.collectBackupData({ year: 2026, month: 8, branch: 'ubon', includeEmpty: true });
    assert.deepEqual(plain(old[2026].ubon[MONTH_TH].creditNotes), []);
    const d = w.loadFor('ubon', 2026, 8); d.creditNotes = [await creditNoteFor(invoice, 9311, 'CN690911', 100), { ...(await creditNoteFor(invoice, 9312, 'CN690912', 100)), voided: true, status: 'voided', voidReason: 'x' }]; w.saveFor('ubon', 2026, 8, d);
    await settle();
    const before = JSON.stringify(w.loadFor('ubon', 2026, 8));
    const prompts = [];
    w.confirm = text => { prompts.push(String(text)); return false; };
    const status = await importBackup(w, old, 'replace');
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /CN690911/); assert.match(prompts[0], /CN690912/);
    assert.match(status, /ยกเลิกการนำเข้า/);
    assert.equal(JSON.stringify(w.loadFor('ubon', 2026, 8)), before);
    // Confirming performs the replace the user asked for.
    w.confirm = () => true;
    await importBackup(w, old, 'replace');
    assert.deepEqual(cnState(w), []);
  } finally { h.close(); }
});

test('fix4#4: every storage write path drops the per-render business() cache', async () => {
  const h = await boot(); const { w } = h;
  try {
    const key = w.testApp.keyFor('ubon', 2026, 8);
    const invoiceNos = () => plain(w.testApp.renderBusiness().invoices.map(r => r.no)).sort();
    // ERPIntegrity.transaction (used by reconcilePayments, invoice month moves, order-flow and production-core writes).
    assert.deepEqual(invoiceNos(), []);
    w.ERPIntegrity.transaction([[key, JSON.stringify({ invoices: [uiInvoice(401, 'INV-TX')] })]]);
    assert.deepEqual(invoiceNos(), ['INV-TX']);
    // ERPBackup.restore
    const snapshot = w.ERPBackup.capture();
    w.ERPIntegrity.transaction([[key, JSON.stringify({ invoices: [uiInvoice(402, 'INV-TX2')] })]]);
    assert.deepEqual(invoiceNos(), ['INV-TX2']);
    w.ERPBackup.restore(snapshot);
    assert.deepEqual(invoiceNos(), ['INV-TX']);
    // Write-session rollback after a commit.
    const session = w.ComformDocumentWriteStore.createSession();
    session.get('ubon', 2026, 8).invoices.push(uiInvoice(403, 'INV-WS'));
    session.mark('ubon', 2026, 8);
    session.commit();
    assert.deepEqual(invoiceNos(), ['INV-TX', 'INV-WS']);
    session.rollback();
    assert.deepEqual(invoiceNos(), ['INV-TX']);
  } finally { h.close(); }
});
