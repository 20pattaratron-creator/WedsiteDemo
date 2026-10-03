// Regression tests for the "Backup Export Fail-Closed Gap" documented in
// CODEX_HANDOFF/STEP4B_WORK_IN_PROGRESS.md: collectBackupData(), ERPProductionCore.exportData()
// and ERPOrderFlow.exportData() used to tolerate a corrupted localStorage entry by silently
// substituting an empty array/object, which let a backup finish with a *valid checksum* while
// quietly missing a whole collection's worth of data. These tests assert the fixed, fail-closed
// behaviour: a key that was never written is still a legitimate empty result, but a key that
// exists and fails to parse (or has the wrong shape) must abort the export loudly instead.
const { boot } = require('./dom-helper.cjs');
const test = require('node:test'), assert = require('node:assert/strict');

async function withApp(fn) {
  const h = await boot();
  try { return await fn(h); } finally { h.close(); }
}

// 1. Corrupted business document pack (biz2_<branch>_<year>_<month>) -> backup abort.
test('collectBackupData aborts instead of silently dropping a corrupted month', () => withApp(async ({ w }) => {
  const a = w.testApp;
  const goodKey = a.keyFor('ubon', 2026, 5);
  const corruptKey = a.keyFor('ubon', 2026, 6);
  // A legitimately empty month (never written) must NOT throw.
  assert.doesNotThrow(() => a.collectBackupData({ year: 2026, month: 5, branch: 'ubon', includeEmpty: true }));
  w.localStorage.setItem(corruptKey, '{not valid json');
  assert.throws(
    () => a.collectBackupData({ year: 2026, month: 6, branch: 'ubon', includeEmpty: true }),
    err => /สำรองข้อมูลล้มเหลว/.test(err.message) && err.message.includes(corruptKey)
  );
}));

// 2. Corrupted Production/PO/GR/Inventory store -> backup abort, and names which key failed.
test('ERPProductionCore.exportData aborts on a corrupted purchase-order/goods-receipt/inventory/audit/trash store', () => withApp(async ({ w }) => {
  const keys = {
    purchaseOrders: 'comform_purchase_orders_v1',
    goodsReceipts: 'comform_goods_receipts_v1',
    inventoryMovements: 'comform_inventory_movements_v1',
    audit: 'comform_audit_log_v1',
    trash: 'comform_recycle_bin_v1'
  };
  // Valid (never written) state exports cleanly.
  assert.doesNotThrow(() => w.ERPProductionCore.exportData());
  for (const [subsystem, base] of Object.entries(keys)) {
    const scopedKey = w.ComformTenant.storageKey(base);
    const previous = w.localStorage.getItem(scopedKey);
    w.localStorage.setItem(scopedKey, '{"oops":');
    assert.throws(
      () => w.ERPProductionCore.exportData(),
      err => err.code === 'backup_storage_corrupt' && err.key === scopedKey,
      `expected exportData() to abort with a key-named error for ${subsystem}`
    );
    if (previous === null) w.localStorage.removeItem(scopedKey); else w.localStorage.setItem(scopedKey, previous);
  }
  assert.doesNotThrow(() => w.ERPProductionCore.exportData());
}));

// A wrong-shape (non-array) value must also abort, not just unparsable JSON.
test('ERPProductionCore.exportData aborts when a store key holds the wrong shape', () => withApp(async ({ w }) => {
  const scopedKey = w.ComformTenant.storageKey('comform_goods_receipts_v1');
  w.localStorage.setItem(scopedKey, JSON.stringify({ not: 'an-array' }));
  assert.throws(() => w.ERPProductionCore.exportData(), err => err.code === 'backup_storage_corrupt');
}));

// 3. Corrupted Order Flow store -> backup abort.
test('ERPOrderFlow.exportData aborts instead of silently returning a blank Sales Order / Billing / Payment store', () => withApp(async ({ w }) => {
  const scopedKey = w.ComformTenant.storageKey('example_erp_order_flow_v3');
  assert.doesNotThrow(() => w.ERPOrderFlow.exportData());
  w.localStorage.setItem(scopedKey, '{"salesOrders": not-json');
  assert.throws(
    () => w.ERPOrderFlow.exportData(),
    err => err.code === 'storage_error' && String(err.message).includes(scopedKey)
  );
  w.localStorage.removeItem(scopedKey);
  assert.doesNotThrow(() => w.ERPOrderFlow.exportData());
}));

// 4. A backup failure must not produce an artifact that looks like a success: no file download
// is triggered and the user is told the export failed, for every corrupted subsystem.
test('a corrupted store blocks exportAllJSON from downloading a backup file', () => withApp(async ({ w, set }) => {
  set('ex-branch', 'ubon');
  const scopedKey = w.ComformTenant.storageKey('comform_goods_receipts_v1');
  w.localStorage.setItem(scopedKey, '{corrupt');
  let downloadCalls = 0;
  const originalCreateObjectURL = w.URL.createObjectURL;
  w.URL.createObjectURL = (...args) => { downloadCalls++; return typeof originalCreateObjectURL === 'function' ? originalCreateObjectURL.apply(w.URL, args) : 'blob:mock'; };
  try {
    await w.testApp.exportAllJSON();
  } finally {
    w.URL.createObjectURL = originalCreateObjectURL;
  }
  assert.equal(downloadCalls, 0, 'no backup file blob should be created when the export aborts');
  const toastText = [...w.document.querySelectorAll('.app-toast-msg')].map(el => el.textContent).join(' | ');
  assert.ok(toastText.includes('สำรองข้อมูลไม่สำเร็จ'), toastText);
  w.localStorage.removeItem(scopedKey);
}));

// 5. The error must name the subsystem/key that could not be read.
test('backup abort errors identify which storage key failed to parse', () => withApp(async ({ w }) => {
  const a = w.testApp;
  const scopedKey = a.keyFor('khonkaen', 2025, 0);
  w.localStorage.setItem(scopedKey, '][');
  try {
    a.collectBackupData({ year: 2025, month: 0, branch: 'khonkaen', includeEmpty: true });
    assert.fail('expected collectBackupData to throw for corrupted data');
  } catch (err) {
    assert.ok(err.message.includes(scopedKey), err.message);
    assert.equal(err.code, 'backup_storage_corrupt');
    assert.equal(err.branch, 'khonkaen');
  }
  w.localStorage.removeItem(scopedKey);
}));

// 6. A genuinely valid backup must still produce a verifiable checksum end-to-end.
test('a valid backup still produces a verifiable checksum and restores', () => withApp(async ({ w }) => {
  const d = w.loadFor('ubon', 2026, 2);
  d.invoices = [{ id: 1, no: 'INV-BACKUP-OK', branch: 'ubon', date: '2026-03-05', customer: 'ลูกค้าทดสอบ', subtotal: 100, total: 107, vatAmt: 7, useVat: 1, items: [{ product: 'สินค้า', qty: 1, priceUnit: 100, saleTotal: 100 }] }];
  w.saveFor('ubon', 2026, 2, d);
  const payload = {
    meta: { app: 'comform-esan', backupType: 'month', branch: 'ubon', year: 2026, month: 3, exportedAt: new Date().toISOString() },
    data: w.testApp.collectBackupData({ year: 2026, month: 2, branch: 'ubon', includeEmpty: true }),
    masterData: w.testApp.collectLocalMasterBackup()
  };
  const finished = await w.ERPBackup.portable(payload);
  assert.ok(/^[a-f0-9]{64}$/i.test(finished.meta.contentSha256));
  const verified = await w.ERPBackup.verifyPortable(finished);
  assert.equal(verified.ok, true);
  assert.equal(verified.verified, true);
}));
