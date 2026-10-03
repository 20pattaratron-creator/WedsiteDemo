const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const moduleUrl = pathToFileURL(path.join(ROOT, 'erp-master-data-core.js')).href;
let corePromise;
function core() {
  if (!corePromise) corePromise = import(moduleUrl);
  return corePromise;
}

const T1 = '2026-09-14T01:00:00.000Z';
const T2 = '2026-09-14T02:00:00.000Z';

test('master-data core stays independent from DOM storage and cloud services', () => {
  const source = fs.readFileSync(path.join(ROOT, 'erp-master-data-core.js'), 'utf8');
  for (const forbidden of ['document.', 'localStorage', 'sessionStorage', 'window.', 'FirebaseService']) {
    assert.ok(!source.includes(forbidden), forbidden);
  }
});

test('master key normalization is stable across case and whitespace', async () => {
  const m = await core();
  assert.equal(m.normalizeProductKey('  IT-001   Notebook  '), 'it-001 notebook');
  assert.equal(m.normalizeProductKey(null), '');
});

test('contact selectors hide archived rows but retain them when explicitly requested', async () => {
  const m = await core();
  const rows = [
    { id: '1', name: 'Active', role: 'customer', active: true },
    { id: '2', name: 'Archived', role: 'customer', active: false }
  ];
  assert.deepEqual(m.selectContactRows(rows).map(r => r.id), ['1']);
  assert.deepEqual(new Set(m.selectContactRows(rows, { includeArchived: true }).map(r => r.id)), new Set(['1', '2']));
  assert.equal(m.findContactRow(rows, 'Archived', 'customer'), null);
});

test('upsert keeps unrelated archived contacts instead of silently deleting them', async () => {
  const m = await core();
  const rows = [
    { id: 'active-1', name: 'Alpha', role: 'customer', active: true, createdAt: T1, updatedAt: T1 },
    { id: 'archived-1', name: 'Old Customer', role: 'customer', active: false, archivedAt: T1, createdAt: T1, updatedAt: T1 }
  ];
  const result = m.upsertContactRows(rows, { id: 'active-1', name: 'Alpha', role: 'customer', phone: '02-000-0000' }, { now: T2 });
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows.find(r => r.id === 'archived-1').active, false);
  assert.equal(result.rows.find(r => r.id === 'active-1').phone, '02-000-0000');
});

test('saving a previously archived contact reactivates the same entity id', async () => {
  const m = await core();
  const rows = [{ id: 'archived-1', name: 'Customer A', role: 'customer', active: false, archivedAt: T1, createdAt: T1, updatedAt: T1 }];
  const result = m.upsertContactRows(rows, { name: 'Customer A', role: 'customer', phone: '000' }, { now: T2, idFactory: () => 'should-not-be-used' });
  assert.equal(result.reactivated, true);
  assert.equal(result.row.id, 'archived-1');
  assert.equal(result.row.active, true);
  assert.equal(result.rows.length, 1);
});

test('contact role merge preserves customer and supplier identity as both', async () => {
  const m = await core();
  const rows = [{ id: 'c1', name: 'Partner', role: 'customer', active: true, createdAt: T1, updatedAt: T1 }];
  const result = m.upsertContactRows(rows, { name: 'Partner', role: 'supplier' }, { now: T2 });
  assert.equal(result.row.role, 'both');
  assert.equal(m.contactHasRole(result.row, 'customer'), true);
  assert.equal(m.contactHasRole(result.row, 'supplier'), true);
});

test('archiving one role from a both-role contact keeps the remaining role active', async () => {
  const m = await core();
  const rows = [{ id: 'c1', name: 'Partner', role: 'both', active: true, createdAt: T1, updatedAt: T1 }];
  const result = m.archiveContactRows(rows, 'c1', 'customer', { now: T2 });
  assert.equal(result.changed, true);
  assert.equal(result.row.role, 'supplier');
  assert.equal(result.row.active, true);
  assert.equal(result.row.archivedAt, undefined);
});

test('archiving a single-role contact is non-destructive and timestamped', async () => {
  const m = await core();
  const rows = [{ id: 'c1', name: 'Customer', role: 'customer', active: true, createdAt: T1, updatedAt: T1 }];
  const result = m.archiveContactRows(rows, 'c1', 'customer', { now: T2 });
  assert.equal(result.row.active, false);
  assert.equal(result.row.archivedAt, T2);
  assert.equal(result.rows.length, 1);
});

test('master merge selects newest record and keeps inactive state when it is newer', async () => {
  const m = await core();
  const local = [{ id: 'c1', name: 'Customer', active: false, updatedAt: T2 }];
  const cloud = [{ id: 'c1', name: 'Customer', active: true, updatedAt: T1 }];
  const rows = m.mergeMasterRows(local, cloud, 'contact');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].active, false);
});

test('product master combines seed and local override without mutating seed history', async () => {
  const m = await core();
  const seed = [{ code: 'P-001', name: 'Seed Item', category: 'สินค้า' }];
  const local = [{ id: 'local-1', code: 'P-001', name: 'Custom Item', category: 'สินค้า', flowType: 'inventory', fulfillmentType: 'stock', openingStockUbon: 3, openingStockKhonkaen: 2, standardCost: 10 }];
  const rows = m.buildProductMasterRows(seed, local);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Custom Item');
  assert.equal(rows[0].openingStock, 5);
  assert.equal(rows[0].standardCost, 10);
  assert.equal(rows[0].isSeed, false);
  assert.equal(seed[0].name, 'Seed Item');
});

test('archived local product suppresses matching seed product from active master', async () => {
  const m = await core();
  const seed = [{ code: 'P-001', name: 'Seed Item', category: 'สินค้า' }];
  const local = [{ id: 'local-1', code: 'P-001', name: 'Seed Item', active: false }];
  assert.equal(m.buildProductMasterRows(seed, local).length, 0);
});

test('product metadata and defaults preserve stock/service semantics', async () => {
  const m = await core();
  const rows = m.buildProductMasterRows([
    { code: 'SV-1', name: 'บริการติดตั้ง', category: 'บริการ' },
    { code: 'P-1', name: 'Stock', category: 'สินค้า', flowType: 'inventory', fulfillmentType: 'stock', openingStockUbon: 4 }
  ], []);
  const service = m.productMasterMetaFromRows(rows, 'บริการติดตั้ง');
  const stock = m.productMasterMetaFromRows(rows, '', 'P-1');
  assert.equal(service.flowType, 'service');
  assert.equal(service.fulfillmentType, 'service');
  assert.equal(stock.fulfillmentType, 'stock');
  assert.equal(stock.openingStockUbon, 4);
});

test('lead-day and customer-credit normalizers share deterministic business rules', async () => {
  const m = await core();
  assert.deepEqual(m.normalizeSupplierLeadDays('7, 3,7 / 14'), [3, 7, 14]);
  assert.equal(m.customerCreditDaysFromTerm('credit60'), 60);
  assert.equal(m.customerCreditDaysFromTerm('unknown'), 0);
  assert.equal(m.customerCreditTermFromDays(89), 'credit60');
  assert.equal(m.customerCreditTermFromDays(0), 'cash');
});

test('master validation rejects malformed records without throwing', async () => {
  const m = await core();
  assert.equal(m.validateContactMasterRecord({ name: '', role: 'customer' }).valid, false);
  assert.equal(m.validateContactMasterRecord({ name: 'A', role: 'invalid' }).valid, false);
  assert.equal(m.validateProductMasterRecord({ code: '', name: '' }).valid, false);
  assert.equal(m.validateProductMasterRecord({ code: 'P1', name: 'Item', flowType: 'inventory', fulfillmentType: 'stock' }).valid, true);
});

test('supplier seed does not resurrect or discard archived suppliers', async () => {
  const m = await core();
  const archived = [{ id: 's1', name: 'Old Supplier', role: 'supplier', active: false, archivedAt: T1 }];
  const result = m.ensureSupplierSeedRows(archived, [{ name: 'Seed Supplier', supplierCreditTerm: 'cash', leadDays: [7] }], { now: T2 });
  assert.equal(result.seeded, false);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].id, 's1');
  assert.equal(result.rows[0].active, false);
});

test('supplier seed initializes a truly empty supplier master only once', async () => {
  const m = await core();
  const result = m.ensureSupplierSeedRows(
    [{ id: 'c1', name: 'Customer', role: 'customer', active: true }],
    [{ name: 'Supplier A', supplierCreditTerm: 'credit30', leadDays: [14, 7, 14] }],
    { now: T2 }
  );
  assert.equal(result.seeded, true);
  assert.equal(result.added, 1);
  const supplier = result.rows.find(r => r.role === 'supplier');
  assert.equal(supplier.name, 'Supplier A');
  assert.deepEqual(supplier.supplierLeadDays, [7, 14]);
});

test('CSV contact merge preserves unrelated archived history', async () => {
  const m = await core();
  const rows = [
    { id: 'c1', name: 'Active A', role: 'customer', active: true, createdAt: T1, updatedAt: T1 },
    { id: 'c2', name: 'Archived B', role: 'customer', active: false, archivedAt: T1, createdAt: T1, updatedAt: T1 }
  ];
  const merged = m.mergeContactImportRows(rows, 'customer', [{ name: 'Active A', role: 'customer', phone: '123' }], 'merge', { now: T2 });
  assert.equal(merged.length, 2);
  assert.equal(merged.find(r => r.id === 'c2').active, false);
  assert.equal(merged.find(r => r.id === 'c1').phone, '123');
});

test('CSV replace replaces active target role but keeps archived audit history and other roles', async () => {
  const m = await core();
  const rows = [
    { id: 'c-active', name: 'Old Customer', role: 'customer', active: true },
    { id: 'both', name: 'Both Partner', role: 'both', active: true },
    { id: 'archived', name: 'Archived Customer', role: 'customer', active: false, archivedAt: T1 },
    { id: 'supplier', name: 'Supplier Only', role: 'supplier', active: true }
  ];
  const replaced = m.mergeContactImportRows(rows, 'customer', [{ name: 'New Customer', role: 'customer' }], 'replace', {
    now: T2,
    idFactory: () => 'new-customer'
  });
  assert.equal(replaced.some(r => r.id === 'c-active'), false);
  assert.equal(replaced.find(r => r.id === 'both').role, 'supplier');
  assert.equal(replaced.find(r => r.id === 'archived').active, false);
  assert.equal(replaced.some(r => r.id === 'supplier'), true);
  assert.equal(replaced.some(r => r.name === 'New Customer' && r.active === true), true);
});

test('app master-data orchestration uses archive-safe paths for backup restore seed and CSV', () => {
  const source = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  assert.match(source, /const snapshot=localMasterSnapshot\(\)/);
  assert.match(source, /contacts:snapshot\.contacts,products:snapshot\.products/);
  assert.match(source, /masterDataStore\.prepareRowsWrite\(CONTACT_MASTER_KEY,merge\(snapshot\.contacts,masterData\.contacts/);
  assert.match(source, /ensureSupplierSeedRows\(readLocalMaster\(CONTACT_MASTER_KEY,\[\]\),PRODUCTION_MAKER_PRESETS\)/);
  assert.match(source, /mergeContactImportRows\(readLocalMaster\(CONTACT_MASTER_KEY,\[\]\),type,records,mode\)/);
  assert.match(source, /mergeProductImportRows\(readLocalMaster\(PRODUCT_MASTER_LOCAL_KEY,\[\]\),records,mode\)/);
  assert.match(source, /upsertProductRows\(rows,/);
  assert.match(source, /archiveProductRows\(local,code,fallback\)/);
});

test('product upsert reactivates archived product with the same id and clears stale archive timestamp', async () => {
  const m = await core();
  const rows = [{ id: 'p1', code: 'P-001', name: 'Old Product', active: false, archivedAt: T1, createdAt: T1, updatedAt: T1 }];
  const result = m.upsertProductRows(rows, { code: 'P-001', name: 'Old Product', flowType: 'inventory', fulfillmentType: 'stock' }, { now: T2, idFactory: () => 'unused' });
  assert.equal(result.reactivated, true);
  assert.equal(result.row.id, 'p1');
  assert.equal(result.row.active, true);
  assert.equal(Object.prototype.hasOwnProperty.call(result.row, 'archivedAt'), false);
});

test('archiving a seed-only product creates a local inactive tombstone without deleting history', async () => {
  const m = await core();
  const fallback = { id: 'seed-1', code: 'P-001', name: 'Seed Product', isSeed: true, active: true };
  const result = m.archiveProductRows([], 'P-001', fallback, { now: T2 });
  assert.equal(result.changed, true);
  assert.equal(result.rows.length, 1);
  assert.equal(result.row.active, false);
  assert.equal(result.row.archivedAt, T2);
  assert.equal(Object.prototype.hasOwnProperty.call(result.row, 'isSeed'), false);
});

test('CSV product replace keeps archived product tombstones and replaces only active product set', async () => {
  const m = await core();
  const rows = [
    { id: 'active', code: 'A', name: 'Active', active: true },
    { id: 'archived', code: 'B', name: 'Archived', active: false, archivedAt: T1 }
  ];
  const replaced = m.mergeProductImportRows(rows, [{ code: 'C', name: 'New', flowType: 'inventory', fulfillmentType: 'stock' }], 'replace', {
    now: T2,
    idFactory: () => 'new-product'
  });
  assert.equal(replaced.some(r => r.id === 'active'), false);
  assert.equal(replaced.find(r => r.id === 'archived').active, false);
  assert.equal(replaced.some(r => r.code === 'C' && r.active === true), true);
});

test('CSV product import can intentionally reactivate an archived matching SKU', async () => {
  const m = await core();
  const rows = [{ id: 'archived', code: 'B', name: 'Archived', active: false, archivedAt: T1 }];
  const merged = m.mergeProductImportRows(rows, [{ code: 'B', name: 'Restored', flowType: 'inventory', fulfillmentType: 'stock' }], 'merge', { now: T2 });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'archived');
  assert.equal(merged[0].active, true);
  assert.equal(Object.prototype.hasOwnProperty.call(merged[0], 'archivedAt'), false);
});

test('product upsert follows explicit id when SKU code is edited and does not duplicate the row', async () => {
  const m = await core();
  const rows = [{ id: 'p1', code: 'OLD', name: 'Product', active: true, createdAt: T1, updatedAt: T1 }];
  const result = m.upsertProductRows(rows, { id: 'p1', code: 'NEW', name: 'Product', flowType: 'inventory', fulfillmentType: 'stock' }, { now: T2 });
  assert.equal(result.rows.length, 1);
  assert.equal(result.row.id, 'p1');
  assert.equal(result.row.code, 'NEW');
});
