import { CONTACT_MASTER_KEY, PRODUCT_MASTER_KEY } from './erp-storage-contracts.js';

// ============================================================================
// erp-master-data-store.js — tenant-aware persistence boundary for Master Data
// DEMO 4.3.1 / Step 2C
// ============================================================================
// Rules:
// 1) A missing key may use an explicit fallback.
// 2) Corrupted/unreadable storage must NEVER be converted to an empty array.
// 3) Snapshot writes validate/serialize everything before the first mutation.
// 4) A partial snapshot write is rolled back best-effort and reported as failure.
// 5) Cloud sync is allowed only after a successful cloud hydration handshake.

export class MasterDataStorageError extends Error {
  constructor(message, { operation = 'unknown', baseKey = '', resolvedKey = '', cause = null, rollbackFailed = false } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'MasterDataStorageError';
    this.code = 'storage_error';
    this.operation = operation;
    this.baseKey = baseKey;
    this.resolvedKey = resolvedKey;
    this.rollbackFailed = Boolean(rollbackFailed);
  }
}

export class MasterDataCloudError extends Error {
  constructor(message, { operation = 'unknown', cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'MasterDataCloudError';
    this.code = 'dependency_error';
    this.operation = operation;
  }
}

function defaultStorageProvider() {
  const storage = globalThis?.localStorage;
  if (!storage) throw new MasterDataStorageError('ไม่พบ localStorage สำหรับ Master Data', { operation: 'resolve_storage' });
  return storage;
}

export function defaultMasterTenantKey(baseKey) {
  const key = String(baseKey || '');
  return globalThis?.window?.ComformTenant?.storageKey?.(key) || key;
}

function cloneFallback(fallback) {
  return Array.isArray(fallback) ? fallback.slice() : [];
}

function assertRows(rows, label = 'Master Data') {
  if (!Array.isArray(rows)) throw new MasterDataStorageError(`${label} ต้องเป็นรายการ (Array)`, { operation: 'validate_rows' });
  return rows;
}

function serializeRows(rows, baseKey, resolvedKey) {
  assertRows(rows);
  try {
    return JSON.stringify(rows);
  } catch (cause) {
    throw new MasterDataStorageError('แปลง Master Data เป็น JSON ไม่สำเร็จ', { operation: 'serialize', baseKey, resolvedKey, cause });
  }
}

export function createMasterDataStore({
  storageProvider = defaultStorageProvider,
  keyResolver = defaultMasterTenantKey,
  contactKey = CONTACT_MASTER_KEY,
  productKey = PRODUCT_MASTER_KEY
} = {}) {
  const resolveKey = baseKey => String(keyResolver(String(baseKey || '')) || String(baseKey || ''));
  const storage = () => {
    let target;
    try { target = storageProvider(); }
    catch (cause) {
      if (cause instanceof MasterDataStorageError) throw cause;
      throw new MasterDataStorageError('เปิดพื้นที่จัดเก็บ Master Data ไม่สำเร็จ', { operation: 'resolve_storage', cause });
    }
    if (!target || typeof target.getItem !== 'function' || typeof target.setItem !== 'function') {
      throw new MasterDataStorageError('Storage adapter ของ Master Data ไม่ถูกต้อง', { operation: 'resolve_storage' });
    }
    return target;
  };

  function readRaw(baseKey) {
    const resolvedKey = resolveKey(baseKey);
    try {
      return { resolvedKey, raw: storage().getItem(resolvedKey) };
    } catch (cause) {
      if (cause instanceof MasterDataStorageError) throw cause;
      throw new MasterDataStorageError('อ่าน Master Data จากเครื่องไม่สำเร็จ', { operation: 'read', baseKey, resolvedKey, cause });
    }
  }

  function readRows(baseKey, { fallback = [] } = {}) {
    const { resolvedKey, raw } = readRaw(baseKey);
    if (raw === null) return cloneFallback(fallback);
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (cause) {
      throw new MasterDataStorageError('Master Data ในเครื่องเป็น JSON ที่เสียหรืออ่านไม่ได้', { operation: 'parse', baseKey, resolvedKey, cause });
    }
    if (!Array.isArray(parsed)) {
      throw new MasterDataStorageError('โครงสร้าง Master Data ในเครื่องไม่ใช่รายการ', { operation: 'validate_read', baseKey, resolvedKey });
    }
    return parsed;
  }

  function prepareRowsWrite(baseKey, rows) {
    const resolvedKey = resolveKey(baseKey);
    return { baseKey, resolvedKey, rows: assertRows(rows), serialized: serializeRows(rows, baseKey, resolvedKey) };
  }

  function writeRows(baseKey, rows) {
    const prepared = prepareRowsWrite(baseKey, rows);
    try { storage().setItem(prepared.resolvedKey, prepared.serialized); }
    catch (cause) {
      if (cause instanceof MasterDataStorageError) throw cause;
      throw new MasterDataStorageError('บันทึก Master Data ลงเครื่องไม่สำเร็จ', {
        operation: 'write', baseKey, resolvedKey: prepared.resolvedKey, cause
      });
    }
    return true;
  }

  function readSnapshot() {
    // Read both before returning anything so callers cannot mistake a partial
    // snapshot for a valid full snapshot.
    const contacts = readRows(contactKey, { fallback: [] });
    const products = readRows(productKey, { fallback: [] });
    return { contacts, products };
  }

  function writeSnapshot(snapshot = {}) {
    if (!snapshot || !Array.isArray(snapshot.contacts) || !Array.isArray(snapshot.products)) {
      throw new MasterDataStorageError('Master Data Snapshot ต้องมี contacts และ products เป็นรายการครบทั้งคู่', { operation: 'validate_snapshot' });
    }
    const contacts = prepareRowsWrite(contactKey, snapshot.contacts);
    const products = prepareRowsWrite(productKey, snapshot.products);
    const prepared = [contacts, products];
    const target = storage();
    const old = new Map();
    try {
      for (const item of prepared) old.set(item.resolvedKey, target.getItem(item.resolvedKey));
    } catch (cause) {
      throw new MasterDataStorageError('อ่านค่าก่อนบันทึก Snapshot ไม่สำเร็จ จึงยกเลิกการเขียน', { operation: 'snapshot_preflight', cause });
    }

    const changed = [];
    try {
      for (const item of prepared) {
        target.setItem(item.resolvedKey, item.serialized);
        changed.push(item.resolvedKey);
      }
      return true;
    } catch (cause) {
      let rollbackFailed = false;
      for (const key of changed.reverse()) {
        try {
          const previous = old.get(key);
          if (previous === null) target.removeItem(key);
          else target.setItem(key, previous);
        } catch (_) { rollbackFailed = true; }
      }
      throw new MasterDataStorageError(
        rollbackFailed
          ? 'บันทึก Master Data ไม่สำเร็จและย้อนกลับข้อมูลได้ไม่ครบ กรุณาหยุดทำรายการและกู้ Backup'
          : 'บันทึก Master Data Snapshot ไม่สำเร็จ ระบบย้อนกลับค่าก่อนหน้าแล้ว',
        { operation: 'snapshot_write', cause, rollbackFailed }
      );
    }
  }

  return Object.freeze({
    contactKey,
    productKey,
    resolveKey,
    readRaw,
    readRows,
    writeRows,
    prepareRowsWrite,
    readSnapshot,
    writeSnapshot
  });
}

function normalizeCloudSnapshot(cloud) {
  if (cloud === null || cloud === undefined) return {};
  if (typeof cloud !== 'object' || Array.isArray(cloud)) {
    throw new MasterDataCloudError('Cloud Master snapshot มีโครงสร้างไม่ถูกต้อง', { operation: 'validate_cloud_snapshot' });
  }
  for (const field of ['contacts', 'products']) {
    if (cloud[field] !== undefined && !Array.isArray(cloud[field])) {
      throw new MasterDataCloudError(`Cloud Master field ${field} ไม่ใช่รายการ`, { operation: 'validate_cloud_snapshot' });
    }
  }
  return cloud;
}

export function createMasterDataCloudBridge({
  store,
  mergeRows,
  serviceProvider = () => globalThis?.window?.FirebaseService,
  delayMs = 350,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = id => clearTimeout(id),
  onError = () => {}
} = {}) {
  if (!store?.readSnapshot || !store?.writeSnapshot) throw new TypeError('createMasterDataCloudBridge ต้องมี Master Data store');
  if (typeof mergeRows !== 'function') throw new TypeError('createMasterDataCloudBridge ต้องมี mergeRows');

  let ready = false;
  let timer = null;
  let lastHydratedAt = '';
  let lastSyncedAt = '';

  const service = () => {
    try { return serviceProvider?.() || null; }
    catch (cause) { throw new MasterDataCloudError('เปิด Cloud service ไม่สำเร็จ', { operation: 'resolve_cloud_service', cause }); }
  };

  async function pushSnapshot() {
    if (!ready) return { synced: false, reason: 'not_ready' };
    const target = service();
    if (!target?.configured || typeof target.saveMasterSnapshot !== 'function') {
      ready = false;
      return { synced: false, reason: 'unavailable' };
    }
    try {
      const snapshot = store.readSnapshot();
      await target.saveMasterSnapshot(snapshot);
      lastSyncedAt = new Date().toISOString();
      return { synced: true, snapshot };
    } catch (cause) {
      const error = cause instanceof MasterDataStorageError || cause instanceof MasterDataCloudError
        ? cause
        : new MasterDataCloudError('Sync Master Data ไป Cloud ไม่สำเร็จ', { operation: 'cloud_save', cause });
      onError(error);
      return { synced: false, reason: error.code || 'dependency_error', error };
    }
  }

  function scheduleSync() {
    if (!ready) return false;
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      void pushSnapshot();
    }, delayMs);
    return true;
  }

  async function hydrate() {
    let target;
    try { target = service(); }
    catch (error) { ready = false; onError(error); return { hydrated: false, reason: error.code, error }; }
    if (!target?.configured || typeof target.loadMasterSnapshot !== 'function') {
      ready = false;
      return { hydrated: false, reason: 'unavailable' };
    }
    try {
      // Fail closed: local snapshot MUST be readable before any cloud merge or
      // local/cloud write is allowed.
      const local = store.readSnapshot();
      const cloud = normalizeCloudSnapshot(await target.loadMasterSnapshot());
      const merged = {
        contacts: cloud.contacts === undefined ? local.contacts : mergeRows(local.contacts, cloud.contacts, 'contact'),
        products: cloud.products === undefined ? local.products : mergeRows(local.products, cloud.products, 'product')
      };
      store.writeSnapshot(merged);
      ready = true;
      lastHydratedAt = new Date().toISOString();
      scheduleSync();
      return { hydrated: true, snapshot: merged };
    } catch (cause) {
      ready = false;
      const error = cause instanceof MasterDataStorageError || cause instanceof MasterDataCloudError
        ? cause
        : new MasterDataCloudError('โหลด Master Data จาก Cloud ไม่สำเร็จ', { operation: 'cloud_load', cause });
      onError(error);
      return { hydrated: false, reason: error.code || 'dependency_error', error };
    }
  }

  function stop() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    ready = false;
  }

  function state() { return { ready, scheduled: timer !== null, lastHydratedAt, lastSyncedAt }; }

  return Object.freeze({ hydrate, scheduleSync, pushSnapshot, stop, state });
}
