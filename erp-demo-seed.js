// ============================================================================
// erp-demo-seed.js — "โหลดข้อมูลตัวอย่างสำหรับสาธิต" / "ล้างข้อมูลสาธิตทั้งหมด (รีเซ็ต)"
// ERP DEMO 4.3.1 · ADR-013
// ----------------------------------------------------------------------------
// Thin runtime layer around erp-demo-seed-core.js (pure data generation):
// - LOAD never mixes sample data with the user's own data and never overwrites it
//   silently:
//     * empty store                → loads straight away;
//     * only earlier sample data   → one confirmation, then the old sample set is
//                                    replaced by a fresh one dated from today;
//     * the user's own data exists → refuses and OFFERS the reset first (the user
//                                    must confirm twice before anything is deleted).
// - RESET removes exactly this app's data keys for the active tenant
//   (demoResetStorageKeys in the core) — never another tenant's or another app's
//   keys — after a confirmation (two when the user's own data would be lost).
// - reads the stored documents fail-closed (the same strict readers the save paths use),
// - refuses (with an explanation) when a seeded date falls in a locked period,
// - writes master data through BusinessRulesService.seedMasterData() and all
//   document packs + the order-flow store in ONE ERPIntegrity.transaction()
//   (STORAGE_WRITTEN_EVENT → render caches drop, same path as createPaymentReceipts()),
// - re-checks the written data with the app's own validators and rolls back if
//   anything disagrees, then reconciles payments like every save path does,
// - afterwards re-renders the page the user is on (through the app's own router).
// One window global: window.ERPDemoSeed. No inline handlers (event delegation).
// ============================================================================
import { ORDER_FLOW_STORE_KEY, STORAGE_WRITTEN_EVENT, notifyStorageWritten, SALES_TARGET_PERIODS_KEY, DELIVERY_TARGET_PERIODS_KEY, DEMO_SEED_TARGETS_KEY } from './erp-storage-contracts.js';
import { localDateISO } from './erp-shared-core.js';
import { withDemoWriteLease, SALES_LEDGER_WRITE_LEASE } from './erp-demo-concurrency.js';
import { assertIdempotentPaymentReceipts, DOCUMENT_PACK_COLLECTIONS } from './erp-document-finance-core.js';
import { creditNoteLedgerIssues } from './erp-credit-note-core.js';
import { normalizeProductKey } from './erp-master-data-core.js';
import { icon } from './erp-icons.js';
import { liveBranchCount } from './erp-branches-core.js';
import { buildDemoSeedPlan, collectNumberSequences, isDemoSeedRecord, demoSeedPeriods, demoResetStorageKeys, DEMO_SEED_BATCH_ID, buildDemoSeedTargets, mergeSeededTargets, stripSeededTargets } from './erp-demo-seed-core.js';

(() => {
  'use strict';
  if (window.ERPDemoSeed) return;
  const BRANCHES = ['ubon', 'khonkaen'];
  const PACK_KEY_PATTERN = /^biz2_(ubon|khonkaen)_(\d{4})_(\d{2})$/;
  // Purchasing / goods-receipt / stock-movement ledgers of erp-production-core.js: user work
  // that the sample data must not be mixed with (sample data never writes them).
  const OPERATION_KEYS = ['comform_purchase_orders_v1', 'comform_goods_receipts_v1', 'comform_inventory_movements_v1'];
  const COLLECTION_LABELS = { quotes: 'ใบเสนอราคา', invoices: 'ใบกำกับภาษี', receipts: 'ใบเสร็จ', creditNotes: 'ใบลดหนี้', expenses: 'ค่าใช้จ่าย' };
  const LOAD_LABEL = 'โหลดข้อมูลตัวอย่างสำหรับสาธิต';
  const RESET_LABEL = 'ล้างข้อมูลสาธิตทั้งหมด (รีเซ็ต)';
  const BACKUP_HINT = 'ถ้าต้องการเก็บข้อมูลไว้ ให้กด “สำรองข้อมูล” ในเมนู Demo ด้านบนก่อน';
  // Line icons of the two "Demo" menu items (the shared set of erp-icons.js, ADR-017).
  const LOAD_ICON = icon('chart');
  const RESET_ICON = icon('reset');
  let busy = false;

  const storageKey = base => window.ComformTenant?.storageKey?.(base) || String(base || '');
  const notifyUser = (message, type = 'info', ms) => {
    if (typeof window.notify === 'function') window.notify(message, type, ms);
    else console.warn('[DemoSeed]', message);
  };
  const plural = (count, label) => `${label} ${Number(count).toLocaleString('th-TH')} รายการ`;

  // ------------------------------------------------------------ reading
  // Every stored document pack, parsed with the strict write-path reader: a corrupted
  // month stops the action instead of being treated as empty and overwritten.
  function readPacks() {
    const packs = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      const raw = window.ComformTenant?.unwrapStorageKey?.(key) ?? key;
      const match = PACK_KEY_PATTERN.exec(raw || '');
      if (!match) continue;
      const branch = match[1], year = Number(match[2]), month = Number(match[3]) - 1;
      packs.push({ key, branch, year, month, data: window.ComformDocumentWriteStore.loadForWrite(branch, year, month) });
    }
    return packs;
  }
  // Rows of a production-core ledger. Unreadable JSON counts as one row of user data, so a
  // damaged ledger makes the store "not empty" (the user is asked) instead of being ignored.
  function operationRows(base) {
    const raw = localStorage.getItem(storageKey(base));
    if (raw === null) return [];
    try {
      const rows = JSON.parse(raw);
      return Array.isArray(rows) ? rows : [{ unreadable: true }];
    } catch (error) {
      console.warn('[DemoSeed] unreadable ledger treated as user data', base, error);
      return [{ unreadable: true }];
    }
  }
  function readSnapshot() {
    const flowKey = storageKey(ORDER_FLOW_STORE_KEY);
    const store = window.ERPOrderFlow?.getStoreForFinancialWrite?.();
    if (!store) throw new Error('โมดูล Billing / Payment ยังโหลดไม่เสร็จ กรุณารอสักครู่แล้วลองใหม่');
    const master = window.MasterDataPersistence?.readSnapshot?.() || { contacts: [], products: [] };
    const operations = OPERATION_KEYS.flatMap(operationRows);
    return { packs: readPacks(), flowKey, store, master, operations };
  }
  function rowsOf(snapshot, collection) {
    return snapshot.packs.flatMap(pack => (pack.data[collection] || []).map(row => ({ ...row, branch: pack.branch, _branch: pack.branch, _year: pack.year, _month: pack.month })));
  }
  function countDocuments(snapshot, predicate) {
    let count = 0;
    snapshot.packs.forEach(pack => DOCUMENT_PACK_COLLECTIONS.forEach(collection => { count += (pack.data[collection] || []).filter(predicate).length; }));
    ['salesOrders', 'billingNotes', 'payments'].forEach(field => { count += (snapshot.store[field] || []).filter(predicate).length; });
    return count;
  }
  // What the store holds, split into sample data (tagged demoSeed) and the user's own data.
  // Customers/products the user added count as user data; the supplier rows the app seeds on
  // first run, settings, targets, period locks and logs do not (they are not "documents").
  function storeContents(snapshot) {
    const sampleDocuments = countDocuments(snapshot, isDemoSeedRecord);
    const sampleMaster = snapshot.master.contacts.filter(isDemoSeedRecord).length + snapshot.master.products.filter(isDemoSeedRecord).length;
    const userDocuments = countDocuments(snapshot, row => !isDemoSeedRecord(row));
    const userMaster = snapshot.master.contacts.filter(row => !isDemoSeedRecord(row) && ['customer', 'both'].includes(row.role)).length
      + snapshot.master.products.filter(row => !isDemoSeedRecord(row)).length;
    const userOperations = snapshot.operations.filter(row => !isDemoSeedRecord(row)).length;
    return { sampleDocuments, sampleMaster, userDocuments, userMaster, userOperations, userData: userDocuments + userMaster + userOperations };
  }
  // Button state only (cheap): does any document pack / the order-flow store hold the tag?
  function hasSampleData() {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i) || '';
      const raw = window.ComformTenant?.unwrapStorageKey?.(key) ?? key;
      if (!PACK_KEY_PATTERN.test(raw || '') && raw !== ORDER_FLOW_STORE_KEY) continue;
      if (String(localStorage.getItem(key) || '').includes('"demoSeed":true')) return true;
    }
    return false;
  }

  // ------------------------------------------------------------ writing
  // All writes go through ERPIntegrity.transaction (atomic, fires STORAGE_WRITTEN_EVENT).
  // `before` keeps the raw previous values so a failed post-write check can roll back.
  function commit(writes) {
    const before = new Map(writes.map(([key]) => [key, localStorage.getItem(key)]));
    window.ERPIntegrity.transaction(writes);
    return before;
  }
  function rollback(before) {
    let failed = false;
    for (const [key, value] of before) {
      try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
      catch (error) { failed = true; console.error('[DemoSeed] rollback failed for', key, error); }
    }
    notifyStorageWritten();
    if (failed) throw new Error('ย้อนกลับข้อมูลไม่ครบ กรุณากู้ Backup ก่อนทำรายการต่อ');
  }
  function packKey(branch, year, month) {
    return storageKey(`biz2_${branch}_${year}_${String(Number(month) + 1).padStart(2, '0')}`);
  }
  function audit(action, detail) {
    try { window.ERPProductionCore?.audit?.(action, 'demo_seed', DEMO_SEED_BATCH_ID, detail, {}); }
    catch (error) { console.warn('[DemoSeed] audit log write failed (data already saved)', error); }
  }

  // ------------------------------------------------------- targets (ADR-021)
  // The per-month target maps the dashboard target UI reads. Unreadable JSON → null: the sample load then
  // leaves that map alone instead of overwriting what may be the user's targets.
  const TARGET_KEYS = { sales: SALES_TARGET_PERIODS_KEY, delivery: DELIVERY_TARGET_PERIODS_KEY };
  function readJsonObject(base) {
    const raw = localStorage.getItem(storageKey(base));
    if (raw === null) return {};
    try { const value = JSON.parse(raw); return value && typeof value === 'object' && !Array.isArray(value) ? value : null; }
    catch (error) { console.warn('[DemoSeed] unreadable target map left untouched', base, error); return null; }
  }
  // Writes that add the sample targets for months without one, plus the marker of what the sample owns.
  function targetWrites(plan) {
    const maps = { sales: readJsonObject(TARGET_KEYS.sales), delivery: readJsonObject(TARGET_KEYS.delivery) };
    const targets = buildDemoSeedTargets(plan);
    for (const metric of Object.keys(TARGET_KEYS)) if (maps[metric] === null) targets[metric] = {};
    const { maps: merged, written } = mergeSeededTargets({ sales: maps.sales || {}, delivery: maps.delivery || {} }, targets);
    const writes = Object.keys(TARGET_KEYS).filter(metric => maps[metric] !== null && Object.keys(written[metric]).length).map(metric => [storageKey(TARGET_KEYS[metric]), merged[metric]]);
    writes.push([storageKey(DEMO_SEED_TARGETS_KEY), { batch: DEMO_SEED_BATCH_ID, today: plan.today, sales: written.sales, delivery: written.delivery }]);
    return writes;
  }
  // Target maps without the sample's entries that still hold the seeded value (targets the user typed stay).
  function strippedTargetWrites() {
    const marker = readJsonObject(DEMO_SEED_TARGETS_KEY);
    if (!marker || (!marker.sales && !marker.delivery)) return [];
    const maps = { sales: readJsonObject(TARGET_KEYS.sales), delivery: readJsonObject(TARGET_KEYS.delivery) };
    const stripped = stripSeededTargets({ sales: maps.sales || {}, delivery: maps.delivery || {} }, marker);
    return Object.keys(TARGET_KEYS).filter(metric => maps[metric] !== null).map(metric => [storageKey(TARGET_KEYS[metric]), Object.keys(stripped[metric]).length ? JSON.stringify(stripped[metric]) : null]); // null: nothing left → key removed
  }

  // --------------------------------------------------------------- wipe
  // This app's data keys for the active tenant (one definition: demoResetStorageKeys).
  function appDataKeys() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) keys.push(localStorage.key(i));
    return demoResetStorageKeys(keys, window.ComformTenant?.getActiveTenantId?.());
  }
  // Removes `keys`; if any removal fails, puts every removed value back (all or nothing).
  // Then the app is brought to its first-run state in place: render caches drop
  // (STORAGE_WRITTEN_EVENT) and the Supplier Master seed is re-created like on a new install.
  function wipeAppData(keys) {
    const targets = strippedTargetWrites(); // ADR-021: sample targets out, the user's targets kept
    const before = new Map([...keys, ...targets.map(([key]) => key)].map(key => [key, localStorage.getItem(key)]));
    try {
      targets.forEach(([key, value]) => { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); });
      keys.forEach(key => localStorage.removeItem(key));
    } catch (error) {
      for (const [key, value] of before) {
        try { if (value !== null) localStorage.setItem(key, value); else localStorage.removeItem(key); }
        catch (restoreError) { console.error('[DemoSeed] restore after failed wipe failed for', key, restoreError); }
      }
      notifyStorageWritten();
      throw new Error(`ล้างข้อมูลไม่สำเร็จ ระบบคืนค่าข้อมูลเดิมแล้ว: ${error?.message || error}`);
    }
    notifyStorageWritten();
    try { window.initMasterData?.(); } catch (error) { console.warn('[DemoSeed] supplier seed after reset failed', error); }
    try { window.initProductMasterDatalist?.(); } catch (error) { console.warn('[DemoSeed] product list refresh after reset failed', error); }
    return keys.length;
  }
  function describeContents(contents) {
    const parts = [];
    if (contents.userDocuments) parts.push(plural(contents.userDocuments, 'เอกสารที่บันทึกเอง'));
    if (contents.userMaster) parts.push(plural(contents.userMaster, 'ลูกค้า/สินค้าที่เพิ่มเอง'));
    if (contents.userOperations) parts.push(plural(contents.userOperations, 'รายการจัดซื้อ/รับสินค้า/เคลื่อนไหวสต็อก'));
    if (contents.sampleDocuments) parts.push(plural(contents.sampleDocuments, 'เอกสารตัวอย่าง'));
    return parts.join(' · ') || 'การตั้งค่าและประวัติการใช้งาน';
  }
  // The second, explicit confirmation before the user's own data is deleted.
  function finalWipeMessage(contents, unreadable) {
    const what = unreadable ? 'ข้อมูลเอกสารบางเดือนอ่านไม่ได้ (อาจเสียหาย) ระบบจึงนับไม่ได้ว่ามีข้อมูลของคุณเท่าไร' : describeContents(contents);
    return `ยืนยันอีกครั้ง: ข้อมูลที่คุณบันทึกเองจะถูกลบถาวร\n\n${what}\n\nลบแล้วกู้คืนไม่ได้ นอกจากจากไฟล์สำรองข้อมูล (Backup JSON)\n${BACKUP_HINT}\n\nยืนยันลบหรือไม่?`;
  }

  // ---------------------------------------------------- period locks
  function lockedPeriods(rows) {
    const blocked = [];
    for (const row of rows) {
      try { window.ERPGovernance?.assertPeriodOpen?.({ branch: row.branch, date: row.date, scope: row.scope, action: 'demo_seed' }); }
      catch (error) { blocked.push({ ...row, message: error?.message || String(error) }); }
    }
    return blocked;
  }
  function explainLocks(blocked) {
    const first = blocked[0];
    notifyUser(`โหลดข้อมูลตัวอย่างไม่ได้ เพราะมีงวดบัญชีที่ปิดแล้ว (${blocked.length} เอกสาร เช่น ${first.no || '-'} วันที่ ${first.date})\n${first.message}\nระบบไม่ข้ามการปิดงวด — ปลดล็อกงวดพร้อมเหตุผลที่หน้า Audit Log หรือกด “${RESET_LABEL}” ก่อน แล้วลองใหม่`, 'error', 9000);
  }

  // ------------------------------------------------------ verification
  // Re-reads what was written and checks it with the app's own rules.
  function verifyLoaded(plan) {
    const integrity = window.ERPIntegrity;
    const data = integrity.business();
    const store = integrity.flow();
    const issues = [];
    data.receipts.filter(row => isDemoSeedRecord(row) && !row.paymentId).forEach(receipt => {
      try { integrity.validateReceipt(receipt, receipt.id); }
      catch (error) { issues.push(`${receipt.no}: ${error.message}`); }
    });
    (store.payments || []).filter(isDemoSeedRecord).forEach(payment => {
      try {
        const receipts = assertIdempotentPaymentReceipts(payment, data.receipts);
        if (receipts.length !== payment.allocations.length) issues.push(`${payment.no}: ใบเสร็จของการรับชำระไม่ครบ`);
      } catch (error) { issues.push(`${payment.no}: ${error.message}`); }
    });
    creditNoteLedgerIssues(data.invoices, data.creditNotes, { matches: integrity.creditNoteMatches }).forEach(issue => issues.push(issue.message));
    const context = integrity.paymentContext(data, store);
    for (const expected of Object.values(plan.expected.invoices)) {
      const invoice = data.invoices.find(row => isDemoSeedRecord(row) && row.no === expected.no && integrity.branch(row) === expected.branch);
      if (!invoice) { issues.push(`ไม่พบ ${expected.no} หลังบันทึก`); continue; }
      const summary = integrity.paymentSummary(invoice, context);
      if (Math.abs(summary.outstanding - expected.outstanding) > 0.001 || Math.abs(summary.credited - expected.credited) > 0.001) {
        issues.push(`${expected.no}: ยอดค้างรับ ${summary.outstanding} ไม่ตรงกับที่วางแผนไว้ ${expected.outstanding}`);
      }
    }
    for (const product of plan.products.filter(row => row.flowType === 'inventory' && row.fulfillmentType === 'stock')) {
      for (const branch of BRANCHES) {
        const stock = Number(window.productEstimatedStock?.(product, branch));
        if (Number.isFinite(stock) && stock < 0) issues.push(`${product.code}: สต็อกสาขา ${branch} ติดลบ (${stock})`);
      }
    }
    return issues;
  }

  // --------------------------------------------------------------- load
  function masterConflicts(snapshot, plan) {
    const conflicts = [];
    const userContacts = snapshot.master.contacts.filter(row => !isDemoSeedRecord(row));
    const userProducts = snapshot.master.products.filter(row => !isDemoSeedRecord(row));
    const builtInProducts = (window.productMasterRows?.() || []).filter(row => !isDemoSeedRecord(row));
    for (const contact of [...plan.contacts, ...(plan.suppliers || [])]) { // ADR-023: + sample suppliers
      if (userContacts.some(row => String(row.id) === contact.id || normalizeProductKey(row.name) === normalizeProductKey(contact.name))) conflicts.push(contact.name);
    }
    for (const product of plan.products) {
      const key = normalizeProductKey(product.code);
      if ([...userProducts, ...builtInProducts].some(row => normalizeProductKey(row.code || row.name) === key)) conflicts.push(product.code);
    }
    return conflicts;
  }
  function loadWrites(snapshot, plan) {
    const packs = new Map(snapshot.packs.map(pack => [pack.key, pack]));
    const touched = new Map();
    for (const { collection, branch, year, month, record } of plan.documents) {
      const key = packKey(branch, year, month);
      if (!touched.has(key)) {
        const pack = packs.get(key)?.data || window.ComformDocumentWriteStore.loadForWrite(branch, year, month);
        touched.set(key, pack);
      }
      touched.get(key)[collection].push(record);
    }
    const store = snapshot.store;
    store.schemaVersion = 2;
    store.billingNotes.push(...plan.flow.billingNotes);
    store.payments.push(...plan.flow.payments);
    // erp-order-flow.js keeps the newest activity first and at most 500 rows.
    store.activity = [...plan.flow.activity, ...(store.activity || [])].slice(0, 500);
    return [...touched.entries(), [snapshot.flowKey, store], ...targetWrites(plan)];
  }
  function planSummary(plan) {
    const counts = {};
    plan.documents.forEach(({ collection }) => { counts[collection] = (counts[collection] || 0) + 1; });
    return Object.entries(COLLECTION_LABELS).filter(([key]) => counts[key]).map(([key, label]) => `${label} ${counts[key]}`).join(' · ') + ` · ใบวางบิล/รับชำระรวม ${plan.flow.billingNotes.length}`;
  }
  // Asks what to do with a store that is not empty. Returns 'replace' or a result to stop with.
  function confirmReplace(contents, plan, confirmFn) {
    if (contents.userData > 0) {
      // Never mixed with, never written over: the user's data can only go through the reset.
      const offer = `โหลดข้อมูลตัวอย่างไม่ได้ ขณะที่เครื่องนี้มีข้อมูลของคุณอยู่\n(${describeContents(contents)})\n\n`
        + 'ระบบจะไม่ผสมข้อมูลตัวอย่างเข้ากับข้อมูลจริง (ตัวเลขรายงานจะปนกัน) และจะไม่เขียนทับข้อมูลของคุณ\n\n'
        + `ต้องการ “${RESET_LABEL}” ก่อน แล้วโหลดข้อมูลตัวอย่างหรือไม่?\n(${BACKUP_HINT})`;
      if (!confirmFn(offer)) {
        notifyUser(`ยังไม่ได้โหลดข้อมูลตัวอย่าง ข้อมูลของคุณยังอยู่ครบ — ${BACKUP_HINT} แล้วใช้ปุ่ม “${RESET_LABEL}” เมื่อพร้อม`, 'info', 7000);
        return { status: 'refused-user-data', contents };
      }
      if (!confirmFn(finalWipeMessage(contents, false))) {
        notifyUser('ยกเลิกแล้ว ข้อมูลของคุณยังอยู่ครบ', 'info');
        return { status: 'cancelled' };
      }
      return 'replace';
    }
    const message = `เครื่องนี้มีข้อมูลตัวอย่างชุดเดิมอยู่แล้ว (${describeContents(contents)})\n\n`
      + `ระบบจะล้างข้อมูลชุดเดิม (รวมการตั้งค่าที่ปรับระหว่างสาธิต) แล้วโหลดชุดใหม่ที่คำนวณวันที่จากวันนี้ (${plan.today}) — อายุลูกหนี้และวันครบกำหนดจะตรงกับวันนี้\n`
      + `${planSummary(plan)}\n\nต้องการโหลดใหม่หรือไม่?`;
    if (!confirmFn(message)) { notifyUser('ยังไม่ได้โหลดข้อมูลตัวอย่างใหม่', 'info'); return { status: 'cancelled' }; }
    return 'replace';
  }

  async function loadUnlocked(options) {
    const today = options.today || localDateISO();
    const confirmFn = typeof options.confirm === 'function' ? options.confirm : message => window.confirm(message);
    const businessRuleVersion = () => window.BusinessRulesService?.currentVersion?.() || 1;
    // ADR-022: 1 establishment (ตั้งค่าบริษัท) = every sample document at the head office; 2 = as always.
    const branchCount = liveBranchCount();
    let snapshot = readSnapshot();
    const contents = storeContents(snapshot);
    const empty = contents.userData === 0 && contents.sampleDocuments === 0 && contents.sampleMaster === 0;
    // Built before anything is changed: a generator error stops here with the store untouched.
    let plan = buildDemoSeedPlan({ today, businessRuleVersion: businessRuleVersion(), branchCount });
    if (!empty) {
      const decision = confirmReplace(contents, plan, confirmFn);
      if (decision !== 'replace') return decision;
      const removed = wipeAppData(appDataKeys());
      audit('delete', `${RESET_LABEL} ก่อนโหลดข้อมูลตัวอย่าง: ลบข้อมูล ${removed} คีย์ (${describeContents(contents)})`);
      snapshot = readSnapshot();
    }
    // Numbers continue after anything still stored (none in practice: documents mean "not empty").
    const allRows = collection => rowsOf(snapshot, collection);
    const numberStart = collectNumberSequences({
      quotes: allRows('quotes'), invoices: allRows('invoices'), receipts: [...allRows('receipts'), ...allRows('issuedReceipts')], creditNotes: allRows('creditNotes'),
      billingNotes: snapshot.store.billingNotes, payments: snapshot.store.payments
    });
    plan = buildDemoSeedPlan({ today, numberStart, businessRuleVersion: businessRuleVersion(), branchCount });
    const blocked = lockedPeriods(demoSeedPeriods(plan));
    if (blocked.length) { explainLocks(blocked); refreshScreens(); return { status: 'period-locked', blocked }; }
    const conflicts = masterConflicts(snapshot, plan);
    if (conflicts.length) {
      notifyUser(`โหลดข้อมูลตัวอย่างไม่ได้ เพราะมีลูกค้า/สินค้าชื่อหรือรหัสเดียวกันอยู่แล้ว: ${conflicts.join(', ')} — ระบบจะไม่เขียนทับข้อมูลของคุณ`, 'error', 9000);
      refreshScreens();
      return { status: 'master-conflict', conflicts };
    }
    // Master data first: stock and product lookups of the documents need the sample products.
    if (!window.BusinessRulesService?.seedMasterData?.({ contacts: [...plan.contacts, ...(plan.suppliers || [])], products: plan.products })) {
      notifyUser('บันทึกลูกค้า/สินค้าตัวอย่างไม่สำเร็จ จึงยังไม่ได้โหลดเอกสารตัวอย่าง', 'error');
      refreshScreens();
      return { status: 'failed', issues: ['master-data'] };
    }
    const removeSeedMaster = () => window.BusinessRulesService.removeMasterRows(row => isDemoSeedRecord(row));
    let before;
    try { before = commit(loadWrites(snapshot, plan)); }
    catch (error) {
      removeSeedMaster();
      notifyUser(`บันทึกข้อมูลตัวอย่างไม่สำเร็จ: ${error?.message || error}`, 'error');
      refreshScreens();
      return { status: 'failed', issues: [String(error?.message || error)] };
    }
    const issues = verifyLoaded(plan);
    if (issues.length) {
      rollback(before);
      removeSeedMaster();
      console.error('[DemoSeed] verification failed', issues);
      notifyUser(`ข้อมูลตัวอย่างไม่ผ่านการตรวจของระบบ จึงยกเลิกทั้งหมด:\n${issues.slice(0, 5).join('\n')}`, 'error', 9000);
      refreshScreens();
      return { status: 'failed', issues };
    }
    window.ERPIntegrity.reconcilePayments();
    window.ERPIntegrity.changed();
    audit('create', `โหลดข้อมูลตัวอย่าง ณ วันที่ ${plan.today}: ${planSummary(plan)} · ลูกค้า ${plan.contacts.length} · ผู้จำหน่าย ${(plan.suppliers || []).length} · สินค้า ${plan.products.length}`);
    refreshScreens();
    notifyUser(`โหลดข้อมูลตัวอย่างแล้ว: ${planSummary(plan)} — ล้างออกได้ด้วยปุ่ม “${RESET_LABEL}”`, 'success', 6000);
    return { status: 'loaded', plan, replaced: !empty };
  }

  // -------------------------------------------------------------- reset
  async function resetUnlocked(options) {
    const confirmFn = typeof options.confirm === 'function' ? options.confirm : message => window.confirm(message);
    const keys = appDataKeys();
    if (!keys.length) { notifyUser('ไม่พบข้อมูลของระบบในเครื่องนี้ — ไม่มีอะไรต้องล้าง', 'info'); return { status: 'nothing-to-reset' }; }
    // The counts are only for the confirmation: a damaged month must not block the reset
    // (it is exactly when a reset is needed), so it is reported instead of stopping.
    let contents = null;
    let unreadable = false;
    try { contents = storeContents(readSnapshot()); }
    catch (error) { unreadable = true; console.warn('[DemoSeed] stored data could not be read for the reset summary', error); }
    const userData = unreadable || contents.userData > 0;
    const message = `${RESET_LABEL}?\n\n`
      + `จะลบข้อมูลของระบบนี้ใน Browser เครื่องนี้ทั้งหมด: ${unreadable ? 'ข้อมูลเอกสาร (บางเดือนอ่านไม่ได้)' : describeContents(contents)}\n`
      + 'รวมลูกค้า/สินค้า การตั้งค่า เป้าขายของข้อมูลตัวอย่าง การปิดงวด และประวัติ Audit Log แล้วเริ่มต้นใหม่เหมือนติดตั้งครั้งแรก\n'
      + 'ข้อมูลของเว็บ/โปรแกรมอื่นใน Browser นี้ โหมดการแสดงผลที่เลือกไว้ ข้อมูลบริษัท/โลโก้ (ตั้งค่าบริษัท) และเป้าขาย/เป้ายอดส่งที่คุณตั้งเอง จะไม่ถูกแตะ\n\n'
      + (userData ? `⚠️ มีข้อมูลที่คุณบันทึกเอง — ${BACKUP_HINT}\n\n` : '')
      + 'ต้องการล้างข้อมูลหรือไม่?';
    if (!confirmFn(message)) { notifyUser('ยังไม่ได้ล้างข้อมูล', 'info'); return { status: 'cancelled' }; }
    if (userData && !confirmFn(finalWipeMessage(contents, unreadable))) { notifyUser('ยกเลิกแล้ว ข้อมูลของคุณยังอยู่ครบ', 'info'); return { status: 'cancelled' }; }
    const removed = wipeAppData(keys);
    window.ERPIntegrity.changed();
    audit('delete', `${RESET_LABEL}: ลบข้อมูล ${removed} คีย์ (${unreadable ? 'มีข้อมูลที่อ่านไม่ได้' : describeContents(contents)})`);
    refreshScreens();
    notifyUser(`ล้างข้อมูลแล้ว — เริ่มต้นใหม่เหมือนติดตั้งครั้งแรก กด “${LOAD_LABEL}” เพื่อเติมข้อมูลตัวอย่างได้ทันที`, 'success', 6000);
    return { status: 'reset', removedKeys: keys };
  }

  // ------------------------------------------------------------ refresh
  // Re-renders the page the user is on through the app's own router (go() runs the page's
  // renderer and fires erp:navigation for the modules that listen), after the year pickers
  // learned any new year. Everything is best-effort: the data is already saved.
  function refreshScreens() {
    try { window.onYearChange?.(false); } catch (error) { console.warn('[DemoSeed] year list refresh failed', error); }
    const active = document.querySelector('.panel.active')?.id?.replace(/^panel-/, '');
    try {
      if (active && typeof window.go === 'function') window.go(active);
      else window.renderDash?.();
    } catch (error) { console.warn(`[DemoSeed] re-render of "${active || 'dashboard'}" failed`, error); }
    try { window.ERPCreditNotes?.renderList?.(); } catch (error) { console.warn('[DemoSeed] credit-note list refresh failed', error); }
    try { window.BusinessRulesService?.render?.(); } catch (error) { console.warn('[DemoSeed] business rules refresh failed', error); }
    window.TrialService?.loadTrial?.({ force: true })?.catch?.(error => console.warn('[DemoSeed] trial usage refresh failed', error));
    updateUi();
  }

  // One action at a time, under the same lease as invoice / receipt / credit-note saves.
  async function run(task, options = {}) {
    if (busy) { notifyUser('กำลังดำเนินการกับข้อมูลตัวอย่างอยู่ กรุณารอสักครู่', 'info'); return { status: 'busy' }; }
    busy = true;
    updateUi();
    try { return await withDemoWriteLease(SALES_LEDGER_WRITE_LEASE, () => task(options)); }
    catch (error) {
      console.error('[DemoSeed] action failed', error);
      notifyUser(`ดำเนินการกับข้อมูลตัวอย่างไม่สำเร็จ: ${error?.message || error}`, 'error', 9000);
      return { status: 'failed', issues: [String(error?.message || error)] };
    } finally { busy = false; updateUi(); }
  }
  const load = (options = {}) => run(loadUnlocked, options);
  const reset = (options = {}) => run(resetUnlocked, options);

  // ------------------------------------------------------------------ UI
  // Both controls are items of the header "Demo" menu (window.ERPDemoMenu, local-demo-mode.js,
  // ADR-015; they were buttons in the former green banner): load second, reset last in red.
  // They keep their data-demo-seed-action attribute, so the click delegation in init() and
  // updateUi() still handle them (no onSelect). The dashboard empty state gets a load shortcut.
  function ensureUi() {
    const menu = window.ERPDemoMenu;
    if (menu && !menu.has('demo-seed-load')) {
      menu.register({ key: 'demo-seed-load', order: 20, label: LOAD_LABEL, iconSvg: LOAD_ICON, dataset: { demoSeedAction: 'load' }, title: 'เติมลูกค้า สินค้า และเอกสารย้อนหลังประมาณ 3 เดือน (วันที่คำนวณจากวันนี้) เพื่อให้รายงานมีตัวเลขทันที — ไม่ผสมกับข้อมูลจริง' });
      menu.register({ key: 'demo-seed-reset', danger: true, label: RESET_LABEL, iconSvg: RESET_ICON, dataset: { demoSeedAction: 'reset' }, title: 'ลบข้อมูลของระบบนี้ใน Browser เครื่องนี้ทั้งหมด (ถามยืนยันก่อน) — ไม่แตะข้อมูลของเว็บอื่น' });
    }
    const empty = document.getElementById('erp-dashboard-empty');
    if (empty && !empty.querySelector('[data-demo-seed-action]')) {
      empty.insertAdjacentHTML('beforeend', `<div class="demo-seed-empty-hint"><span>ต้องการเห็นรายงานที่มีตัวเลขทันที? โหลดลูกค้า สินค้า และเอกสารตัวอย่างย้อนหลังประมาณ 3 เดือน (ใบเสนอราคา ใบกำกับภาษี ใบเสร็จ ใบลดหนี้ ค่าใช้จ่าย) ล้างออกได้ภายหลังด้วยปุ่ม “${RESET_LABEL}”</span><button type="button" class="btn btn-primary btn-sm" data-demo-seed-action="load">${LOAD_ICON}${LOAD_LABEL}</button></div>`);
    }
    updateUi();
  }
  function updateUi() {
    const loaded = hasSampleData();
    document.querySelectorAll('[data-demo-seed-action]').forEach(button => {
      button.disabled = busy;
      button.setAttribute('aria-disabled', String(busy));
      if (button.dataset.demoSeedAction === 'load') button.dataset.demoSeedLoaded = String(loaded);
    });
  }
  let uiQueued = false;
  function scheduleUi() {
    if (uiQueued) return;
    uiQueued = true;
    queueMicrotask(() => {
      uiQueued = false;
      // Best-effort button refresh: never let it break the storage event that triggered it
      // (e.g. a page that is being closed no longer has localStorage).
      try { ensureUi(); } catch (error) { console.warn('[DemoSeed] button state refresh skipped', error); }
    });
  }
  function init() {
    document.addEventListener('click', event => {
      const button = event.target.closest?.('[data-demo-seed-action]');
      if (!button || button.disabled) return;
      if (button.dataset.demoSeedAction === 'load') load();
      else reset();
    });
    window.addEventListener(STORAGE_WRITTEN_EVENT, scheduleUi);
    window.addEventListener('erp-flow:changed', scheduleUi);
    document.addEventListener('erp:dashboard-rendered', scheduleUi);
    window.addEventListener('comform-app-ready', scheduleUi);
    ensureUi();
    // The dashboard empty state is created by erp-customer-experience.js ~120 ms after load.
    setTimeout(ensureUi, 300);
  }

  window.ERPDemoSeed = Object.freeze({ load, reset, isLoaded: hasSampleData, BATCH_ID: DEMO_SEED_BATCH_ID });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
