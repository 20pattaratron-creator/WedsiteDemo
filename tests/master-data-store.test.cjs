const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const moduleUrl = pathToFileURL(path.join(ROOT, 'erp-master-data-store.js')).href;
const coreUrl = pathToFileURL(path.join(ROOT, 'erp-master-data-core.js')).href;
let modulesPromise;
function modules() {
  if (!modulesPromise) modulesPromise = Promise.all([import(moduleUrl), import(coreUrl)]).then(([store, core]) => ({ store, core }));
  return modulesPromise;
}

class MemoryStorage {
  constructor() { this.map = new Map(); this.failGet = false; this.failSetKey = ''; this.failSetOnce = false; }
  getItem(key) { if (this.failGet) throw new Error('blocked read'); return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) {
    if (this.failSetKey === key) {
      if (!this.failSetOnce || this.failSetOnce === true) {
        const once = this.failSetOnce;
        this.failSetOnce = once ? 'used' : false;
        if (once !== 'used') throw new Error('quota');
      }
    }
    this.map.set(key, String(value));
  }
  removeItem(key) { this.map.delete(key); }
}

function keys(tenant) { return base => `erp_tenant::${tenant}::${base}`; }

function fakeTimers() {
  let next = 1;
  const jobs = new Map();
  return {
    set(fn) { const id = next++; jobs.set(id, fn); return id; },
    clear(id) { jobs.delete(id); },
    async runAll() { const list = [...jobs.values()]; jobs.clear(); for (const fn of list) await fn(); },
    count() { return jobs.size; }
  };
}

test('master-data store module stays independent from DOM and UI notification code', () => {
  const source = fs.readFileSync(path.join(ROOT, 'erp-master-data-store.js'), 'utf8');
  for (const forbidden of ['document.', 'notify(', 'innerHTML', 'querySelector']) assert.ok(!source.includes(forbidden), forbidden);
});

test('missing Master key may return explicit fallback but malformed JSON fails closed', async () => {
  const { store: m } = await modules();
  const storage = new MemoryStorage();
  const data = m.createMasterDataStore({ storageProvider: () => storage, keyResolver: keys('A') });
  assert.deepEqual(data.readRows('x', { fallback: [{ id: 'seed' }] }), [{ id: 'seed' }]);
  storage.setItem(keys('A')('x'), '{broken');
  assert.throws(() => data.readRows('x', { fallback: [] }), error => error.code === 'storage_error' && error.operation === 'parse');
});

test('non-array Master payload and blocked storage reads never degrade to empty arrays', async () => {
  const { store: m } = await modules();
  const storage = new MemoryStorage();
  const data = m.createMasterDataStore({ storageProvider: () => storage, keyResolver: keys('A') });
  storage.setItem(keys('A')('x'), JSON.stringify({ rows: [] }));
  assert.throws(() => data.readRows('x'), error => error.code === 'storage_error' && error.operation === 'validate_read');
  storage.failGet = true;
  assert.throws(() => data.readRows('other'), error => error.code === 'storage_error' && error.operation === 'read');
});

test('tenant key resolver isolates Master rows between companies sharing one browser', async () => {
  const { store: m } = await modules();
  const storage = new MemoryStorage();
  let tenant = 'A';
  const data = m.createMasterDataStore({ storageProvider: () => storage, keyResolver: base => keys(tenant)(base) });
  data.writeRows('contacts', [{ id: 'A-1' }]);
  tenant = 'B';
  assert.deepEqual(data.readRows('contacts'), []);
  data.writeRows('contacts', [{ id: 'B-1' }]);
  tenant = 'A';
  assert.deepEqual(data.readRows('contacts').map(r => r.id), ['A-1']);
  tenant = 'B';
  assert.deepEqual(data.readRows('contacts').map(r => r.id), ['B-1']);
});

test('failed single-key write reports storage_error and preserves previous data', async () => {
  const { store: m } = await modules();
  const storage = new MemoryStorage();
  const keyResolver = keys('A');
  const data = m.createMasterDataStore({ storageProvider: () => storage, keyResolver });
  data.writeRows('contacts', [{ id: 'old' }]);
  storage.failSetKey = keyResolver('contacts');
  storage.failSetOnce = true;
  assert.throws(() => data.writeRows('contacts', [{ id: 'new' }]), error => error.code === 'storage_error');
  assert.deepEqual(data.readRows('contacts').map(r => r.id), ['old']);
});

test('snapshot write rolls back first key if second key write fails', async () => {
  const { store: m } = await modules();
  const storage = new MemoryStorage();
  const keyResolver = keys('A');
  const data = m.createMasterDataStore({ storageProvider: () => storage, keyResolver, contactKey: 'contacts', productKey: 'products' });
  data.writeSnapshot({ contacts: [{ id: 'c-old' }], products: [{ id: 'p-old' }] });
  storage.failSetKey = keyResolver('products');
  storage.failSetOnce = true;
  assert.throws(() => data.writeSnapshot({ contacts: [{ id: 'c-new' }], products: [{ id: 'p-new' }] }), error => error.code === 'storage_error' && error.operation === 'snapshot_write');
  assert.deepEqual(data.readSnapshot(), { contacts: [{ id: 'c-old' }], products: [{ id: 'p-old' }] });
});

test('partial snapshot is rejected instead of silently clearing the missing Master collection', async () => {
  const { store: m } = await modules();
  const storage = new MemoryStorage();
  const data = m.createMasterDataStore({ storageProvider: () => storage, keyResolver: keys('A'), contactKey: 'contacts', productKey: 'products' });
  data.writeSnapshot({ contacts: [{ id: 'c-old' }], products: [{ id: 'p-old' }] });
  assert.throws(() => data.writeSnapshot({ contacts: [{ id: 'c-new' }] }), error => error.code === 'storage_error' && error.operation === 'validate_snapshot');
  assert.deepEqual(data.readSnapshot(), { contacts: [{ id: 'c-old' }], products: [{ id: 'p-old' }] });
});

test('snapshot keeps archived records exactly as persisted', async () => {
  const { store: m } = await modules();
  const storage = new MemoryStorage();
  const data = m.createMasterDataStore({ storageProvider: () => storage, keyResolver: keys('A'), contactKey: 'contacts', productKey: 'products' });
  const snapshot = { contacts: [{ id: 'c1', active: false, archivedAt: '2026-01-01' }], products: [{ id: 'p1', active: false }] };
  data.writeSnapshot(snapshot);
  assert.deepEqual(data.readSnapshot(), snapshot);
});

test('cloud hydration preserves newer local archive against older cloud active record', async () => {
  const { store: m, core } = await modules();
  const storage = new MemoryStorage();
  const data = m.createMasterDataStore({ storageProvider: () => storage, keyResolver: keys('A'), contactKey: 'contacts', productKey: 'products' });
  data.writeSnapshot({ contacts: [{ id: 'c1', name: 'Customer', active: false, updatedAt: '2026-09-14T02:00:00Z' }], products: [] });
  const service = {
    configured: true,
    async loadMasterSnapshot() { return { contacts: [{ id: 'c1', name: 'Customer', active: true, updatedAt: '2026-09-14T01:00:00Z' }], products: [] }; },
    async saveMasterSnapshot() {}
  };
  const timers = fakeTimers();
  const bridge = m.createMasterDataCloudBridge({ store: data, mergeRows: core.mergeMasterRows, serviceProvider: () => service, setTimer: fn => timers.set(fn), clearTimer: id => timers.clear(id) });
  const result = await bridge.hydrate();
  assert.equal(result.hydrated, true);
  assert.equal(data.readSnapshot().contacts[0].active, false);
  assert.equal(bridge.state().ready, true);
});

test('corrupted local Master blocks cloud hydration before cloud load/write/sync', async () => {
  const { store: m, core } = await modules();
  const storage = new MemoryStorage();
  const keyResolver = keys('A');
  storage.setItem(keyResolver('contacts'), '{bad');
  const data = m.createMasterDataStore({ storageProvider: () => storage, keyResolver, contactKey: 'contacts', productKey: 'products' });
  let loads = 0, saves = 0;
  const service = { configured: true, async loadMasterSnapshot() { loads++; return { contacts: [], products: [] }; }, async saveMasterSnapshot() { saves++; } };
  const timers = fakeTimers();
  const bridge = m.createMasterDataCloudBridge({ store: data, mergeRows: core.mergeMasterRows, serviceProvider: () => service, setTimer: fn => timers.set(fn), clearTimer: id => timers.clear(id) });
  const result = await bridge.hydrate();
  assert.equal(result.hydrated, false);
  assert.equal(result.reason, 'storage_error');
  assert.equal(loads, 0);
  assert.equal(saves, 0);
  assert.equal(timers.count(), 0);
  assert.equal(bridge.state().ready, false);
});

test('malformed cloud snapshot is rejected without mutating local Master', async () => {
  const { store: m, core } = await modules();
  const storage = new MemoryStorage();
  const data = m.createMasterDataStore({ storageProvider: () => storage, keyResolver: keys('A'), contactKey: 'contacts', productKey: 'products' });
  const original = { contacts: [{ id: 'c1', active: false }], products: [{ id: 'p1' }] };
  data.writeSnapshot(original);
  const service = { configured: true, async loadMasterSnapshot() { return { contacts: {}, products: [] }; }, async saveMasterSnapshot() { throw new Error('must not save'); } };
  const bridge = m.createMasterDataCloudBridge({ store: data, mergeRows: core.mergeMasterRows, serviceProvider: () => service });
  const result = await bridge.hydrate();
  assert.equal(result.hydrated, false);
  assert.equal(result.reason, 'dependency_error');
  assert.deepEqual(data.readSnapshot(), original);
  assert.equal(bridge.state().ready, false);
});

test('cloud save is scheduled only after successful hydrate and sends a full local snapshot', async () => {
  const { store: m, core } = await modules();
  const storage = new MemoryStorage();
  const data = m.createMasterDataStore({ storageProvider: () => storage, keyResolver: keys('A'), contactKey: 'contacts', productKey: 'products' });
  data.writeSnapshot({ contacts: [{ id: 'local-c' }], products: [{ id: 'local-p' }] });
  const saved = [];
  const service = { configured: true, async loadMasterSnapshot() { return { contacts: [], products: [] }; }, async saveMasterSnapshot(snapshot) { saved.push(snapshot); } };
  const timers = fakeTimers();
  const bridge = m.createMasterDataCloudBridge({ store: data, mergeRows: core.mergeMasterRows, serviceProvider: () => service, setTimer: fn => timers.set(fn), clearTimer: id => timers.clear(id) });
  assert.equal(bridge.scheduleSync(), false);
  assert.equal((await bridge.hydrate()).hydrated, true);
  assert.equal(timers.count(), 1);
  await timers.runAll();
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0], data.readSnapshot());
});

test('cloud load failure keeps sync bridge closed so later local writes cannot overwrite unknown cloud state', async () => {
  const { store: m, core } = await modules();
  const storage = new MemoryStorage();
  const data = m.createMasterDataStore({ storageProvider: () => storage, keyResolver: keys('A'), contactKey: 'contacts', productKey: 'products' });
  const service = { configured: true, async loadMasterSnapshot() { throw new Error('offline'); }, async saveMasterSnapshot() { throw new Error('must not run'); } };
  const bridge = m.createMasterDataCloudBridge({ store: data, mergeRows: core.mergeMasterRows, serviceProvider: () => service });
  const result = await bridge.hydrate();
  assert.equal(result.hydrated, false);
  assert.equal(bridge.state().ready, false);
  assert.equal(bridge.scheduleSync(), false);
});


test('app routes Master persistence through Step 2C store and cloud bridge', () => {
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  assert.match(app, /createMasterDataStore\(/);
  assert.match(app, /createMasterDataCloudBridge\(/);
  assert.match(app, /masterDataStore\.readRows\(key,\{fallback\}\)/);
  assert.match(app, /masterDataStore\.writeRows\(key,rows\)/);
  assert.match(app, /masterDataStore\.readSnapshot\(\)/);
  assert.match(app, /masterDataStore\.prepareRowsWrite\(CONTACT_MASTER_KEY/);
  assert.match(app, /masterDataStore\.prepareRowsWrite\(PRODUCT_MASTER_LOCAL_KEY/);
});

test('business rule preset uses Master store and cannot bypass cloud handshake with direct Firebase snapshot save', () => {
  const source = fs.readFileSync(path.join(ROOT, 'business-rules.js'), 'utf8');
  assert.match(source, /createMasterDataStore\(/);
  assert.match(source, /businessMasterStore\.readSnapshot\(\)/);
  assert.match(source, /businessMasterStore\.writeSnapshot\(next\)/);
  assert.match(source, /MasterDataPersistence\?\.scheduleCloudSync/);
  assert.ok(!source.includes('FirebaseService?.saveMasterSnapshot'));
});
