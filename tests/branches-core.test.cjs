// ADR-022 — 1 or 2 establishments: the pure rules of erp-branches-core.js (setting, labels from the
// company profile, the branch-2 census and the refusal / warning texts), the one-branch sample data
// of erp-demo-seed-core.js and the backup / storage hooks of erp-company-profile-core.js.
// The booted app (screens, money rule, backup round trip): tests/branch-mode.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const imp = file => import(pathToFileURL(path.join(ROOT, file)).href);
const plain = value => JSON.parse(JSON.stringify(value));
const SETTING_KEY = 'comform_company_branch_setting_v1';
const PROFILE = {
  schemaVersion: 1, nameTh: 'บริษัท สยามตัวอย่าง จำกัด', nameEn: '', taxId: '0105568123453', addressTh: '99/9 ถนนพระราม 9 กรุงเทพมหานคร 10310',
  phone: '02-123-4567', email: '', website: '',
  branches: { ubon: { code: '00000', label: '', addressTh: '' }, khonkaen: { code: '00003', label: 'สาขาขอนแก่น', addressTh: '' } }, updatedAt: '2026-10-03T10:00:00.000Z'
};
function memoryStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return { get length() { return map.size; }, key: i => [...map.keys()][i] ?? null, getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, removeItem: k => { map.delete(k); }, map };
}

test('branches#1 setting: absent / damaged = 2 branches, only 1 or 2 accepted, unknown fields refused', async () => {
  const b = await imp('erp-branches-core.js');
  const c = await imp('erp-storage-contracts.js');
  assert.equal(c.COMPANY_BRANCH_SETTING_KEY, SETTING_KEY);
  assert.deepEqual([...b.BRANCH_IDS], ['ubon', 'khonkaen']);
  assert.equal(b.DEFAULT_BRANCH_COUNT, 2);
  assert.equal(b.readBranchSetting(memoryStorage()).count, 2, 'never chosen = 2 (no behaviour change)');
  assert.equal(b.readBranchSetting(null).count, 2);
  const one = b.readBranchSetting(memoryStorage({ [SETTING_KEY]: JSON.stringify({ schemaVersion: 1, count: 1, updatedAt: '2026-10-04T00:00:00.000Z' }) }));
  assert.deepEqual(plain(one.record), { schemaVersion: 1, count: 1, updatedAt: '2026-10-04T00:00:00.000Z' });
  assert.equal(one.count, 1);
  for (const raw of ['{bad json', JSON.stringify({ schemaVersion: 1, count: 3 }), JSON.stringify({ schemaVersion: 1, count: '1' }), JSON.stringify({ schemaVersion: 2, count: 1 }), JSON.stringify([1])]) {
    const read = b.readBranchSetting(memoryStorage({ [SETTING_KEY]: raw }));
    assert.equal(read.count, 2, `a damaged setting shows MORE, never less: ${raw}`);
    assert.ok(read.error, raw);
  }
  assert.throws(() => b.normalizeBranchSetting({ schemaVersion: 1, count: 1, hidden: true }), /field ที่ไม่รู้จัก/);
  assert.throws(() => b.branchSettingRecord(0), /1 \(สำนักงานใหญ่อย่างเดียว\) หรือ 2/);
  const keyed = b.readBranchSetting(memoryStorage({ [`erp_tenant::t1::${SETTING_KEY}`]: JSON.stringify({ schemaVersion: 1, count: 1 }) }), key => `erp_tenant::t1::${key}`);
  assert.equal(keyed.count, 1, 'read through the tenant prefix');
});

test('branches#2 labels: from the company profile ("สาขาที่ 00003 · สาขาขอนแก่น"), else the screen\'s own text; markup never passes', async () => {
  const b = await imp('erp-branches-core.js');
  assert.equal(b.branchLabelFromProfile(PROFILE, 'ubon'), 'สำนักงานใหญ่');
  assert.equal(b.branchLabelFromProfile(PROFILE, 'khonkaen'), 'สาขาที่ 00003 · สาขาขอนแก่น');
  const named = { branches: { ubon: { code: '00000', label: 'สำนักงานใหญ่ อุบลราชธานี' }, khonkaen: { code: '00007', label: 'สาขาที่ 00007' } } };
  assert.equal(b.branchLabelFromProfile(named, 'ubon'), 'สำนักงานใหญ่ อุบลราชธานี', 'a name that already says it is kept as typed');
  assert.equal(b.branchLabelFromProfile(named, 'khonkaen'), 'สาขาที่ 00007');
  assert.equal(b.branchLabelFromProfile({ branches: { khonkaen: { code: '00002', label: '<img src=x onerror=alert(1)>"\'`' } } }, 'khonkaen'), 'สาขาที่ 00002 · img src=x onerror=alert(1)');
  assert.equal(b.branchLabelFromProfile({ branches: { khonkaen: { code: '12' } } }, 'khonkaen'), '', 'invalid code → not from the profile');
  // No profile: each screen keeps the text it always showed.
  assert.equal(b.branchDisplayLabel('khonkaen', {}), 'สาขาที่ 00001');
  assert.equal(b.branchDisplayLabel('ubon', {}), 'สาขาสำนักงานใหญ่');
  assert.equal(b.branchDisplayLabel('ubon', { fallback: 'สำนักงานใหญ่' }), 'สำนักงานใหญ่');
  assert.equal(b.branchDisplayLabel('ubon', { count: 1 }), 'สำนักงานใหญ่', 'one establishment: the legal name, not "สาขา…"');
  assert.equal(b.branchDisplayLabel('khonkaen', { profile: PROFILE, fallback: 'สาขา 00001' }), 'สาขาที่ 00003 · สาขาขอนแก่น', 'the profile wins over the fallback');
  assert.equal(b.branchCodeOf(PROFILE, 'khonkaen'), '00003');
  assert.equal(b.branchCodeOf(null, 'khonkaen'), '00001');
  assert.equal(b.branchScopeAllLabel(true, 'รวมทั้ง 2 สาขา'), 'รวมทั้ง 2 สาขา');
  assert.equal(b.branchScopeAllLabel(false, 'รวมทั้ง 2 สาขา'), 'ทั้งบริษัท');

  // Live map: values follow window.CurrentUser + the stored setting at read time; keys stay the 2 ids.
  const storage = memoryStorage();
  const win = { localStorage: storage, CurrentUser: {} };
  const map = b.branchLabelMap({ ubon: 'สาขาสำนักงานใหญ่', khonkaen: 'สาขาที่ 00001' }, win);
  assert.deepEqual(Object.keys(map), ['ubon', 'khonkaen']);
  assert.deepEqual({ ...map }, { ubon: 'สาขาสำนักงานใหญ่', khonkaen: 'สาขาที่ 00001' });
  win.CurrentUser = { companyProfile: { customProfile: true, custom: PROFILE } };
  assert.deepEqual({ ...map }, { ubon: 'สำนักงานใหญ่', khonkaen: 'สาขาที่ 00003 · สาขาขอนแก่น' });
  assert.equal(map.other, undefined, 'unknown ids stay unknown (validity checks keep working)');
  const api = b.createBranchesApi(win);
  assert.equal(api.count(), 2);
  assert.equal(api.multi(), true);
  storage.setItem(SETTING_KEY, JSON.stringify({ schemaVersion: 1, count: 1 }));
  api.invalidate();
  assert.equal(api.count(), 1);
  assert.deepEqual([...api.uiBranches()], ['ubon']);
  assert.equal(api.allLabel('รวมทุกสาขา'), 'ทั้งบริษัท');
  assert.equal(api.code('khonkaen'), '00003');
});

test('branches#3 census: every branch-2 record counts once (cancelled too), other branches / tenants never; unreadable = data', async () => {
  const b = await imp('erp-branches-core.js');
  const census = b.branchDataCensus({
    packs: [
      { branch: 'khonkaen', data: { invoices: [{ id: 1, no: 'INV1' }, { id: 2, no: 'INV2', status: 'cancelled', voided: true }], issuedInvoices: [{ id: 1, no: 'INV1' }], receipts: [], quotes: [{ id: 'q' }], expenses: [{ id: 'e1' }, { id: 'e2' }] } },
      { branch: 'ubon', data: { invoices: [{ id: 9 }] } },
      { branch: 'khonkaen', data: null }
    ],
    flow: { salesOrders: [{ id: 's1', branch: 'khonkaen' }, { id: 's2', branch: 'ubon' }], billingNotes: [{ id: 'b1', lines: [{ invoiceBranch: 'khonkaen' }] }], payments: [{ id: 'p1', allocations: [{ branch: 'khonkaen' }] }], reservations: [] },
    production: { purchaseOrders: [{ id: 'po', branch: 'khonkaen' }], goodsReceipts: [], inventoryMovements: [{ branch: 'khonkaen', voided: true }, { branch: 'ubon' }] },
    products: [{ code: 'P1', openingStockKhonkaen: 5 }, { code: 'P2', openingStockKhonkaen: 0 }, { code: 'P3', openingStockUbon: 9 }]
  });
  assert.deepEqual(plain(census.counts), { quotes: 1, productions: 0, invoices: 2, receipts: 0, creditNotes: 0, expenses: 2, salesOrders: 1, billingNotes: 1, payments: 1, reservations: 0, purchaseOrders: 1, goodsReceipts: 0, inventoryMovements: 1, openingStock: 1, unreadable: 1 });
  assert.equal(census.total, 12);
  assert.equal(b.describeBranchCensus(census), 'ใบเสนอราคา 1 · ใบส่งสินค้า/ใบกำกับภาษี 2 · ค่าใช้จ่าย 2 · ใบสั่งขาย 1 · ใบวางบิล 1 · รายการรับชำระ 1 · ใบสั่งซื้อ (PO) 1 · รายการเคลื่อนไหวสต็อก 1 · สินค้าที่มียอดตั้งต้นของสาขานี้ 1 · ชุดข้อมูลที่อ่านไม่ได้ 1');
  assert.equal(b.branchDataCensus({ packs: [{ branch: 'khonkaen', data: { invoices: [], receipts: [] } }] }).total, 0, 'an empty pack is not data');
  assert.deepEqual([...b.uiBranchIdsFor(1, { total: 0 })], ['ubon']);
  assert.deepEqual([...b.uiBranchIdsFor(1, census)], ['ubon', 'khonkaen'], 'branch-2 data → both branches on screen');
  assert.deepEqual([...b.uiBranchIdsFor(2, { total: 0 })], ['ubon', 'khonkaen']);
  assert.match(b.singleBranchRefusal(census, 'สาขาที่ 00003 · สาขาขอนแก่น'), /^เปลี่ยนเป็น "สำนักงานใหญ่อย่างเดียว" ไม่ได้ — สาขาที่ 00003 · สาขาขอนแก่น ยังมีข้อมูล: ใบเสนอราคา 1 · ใบส่งสินค้า\/ใบกำกับภาษี 2 .*ล้างข้อมูลสาธิตทั้งหมด/);
  assert.equal(b.singleBranchRefusal({ total: 0, items: [] }), '');
  assert.match(b.singleBranchDataWarning(1, census), /แสดง 2 สาขาและรวมยอดของทุกสาขา/);
  assert.equal(b.singleBranchDataWarning(2, census), '');
  assert.equal(b.singleBranchDataWarning(1, { total: 0 }), '');

  // From storage: this tenant's packs only; a damaged pack / store counts (fail-closed).
  const T = 'erp_tenant::t1::';
  const storage = memoryStorage({
    [`${T}biz2_khonkaen_2026_09`]: JSON.stringify({ invoices: [{ id: 1, no: 'X' }] }),
    [`${T}biz2_khonkaen_2026_10`]: '{broken',
    [`${T}biz2_ubon_2026_09`]: JSON.stringify({ invoices: [{ id: 2 }] }),
    'erp_tenant::other::biz2_khonkaen_2026_09': JSON.stringify({ invoices: [{ id: 3 }, { id: 4 }] }),
    [`${T}example_erp_order_flow_v3`]: JSON.stringify({ salesOrders: [{ id: 's', branch: 'khonkaen' }] }),
    [`${T}comform_product_master_v1`]: JSON.stringify([{ code: 'P', openingStockKhonkaen: 2 }])
  });
  const keyFor = key => `${T}${key}`, unwrap = key => (key.startsWith(T) ? key.slice(T.length) : '');
  const read = b.readBranchDataCensus(storage, keyFor, unwrap, 'khonkaen', () => ({ purchaseOrders: [{ branch: 'khonkaen' }] }));
  assert.deepEqual(plain(read.items.map(item => [item.kind, item.count])), [['invoices', 1], ['salesOrders', 1], ['purchaseOrders', 1], ['openingStock', 1], ['unreadable', 1]]);
  const failing = b.readBranchDataCensus(memoryStorage(), keyFor, unwrap, 'khonkaen', () => { throw new Error('corrupt'); });
  assert.equal(failing.counts.unreadable, 1, 'a production store that cannot be read is not "nothing there"');
  assert.equal(b.readBranchDataCensus(memoryStorage({ [`${T}example_erp_order_flow_v3`]: '[]' }), keyFor, unwrap).counts.unreadable, 1);
});

test('branches#4 sample data for one establishment: every document at the head office, same sales, coherent numbers / stock / targets', async () => {
  const seed = await imp('erp-demo-seed-core.js');
  const two = seed.buildDemoSeedPlan({ today: '2026-10-04' });
  assert.deepEqual(plain(seed.buildDemoSeedPlan({ today: '2026-10-04', branchCount: 2 })), plain(two), '2 branches: unchanged');
  assert.ok(two.documents.some(d => d.branch === 'khonkaen'));
  const one = seed.buildDemoSeedPlan({ today: '2026-10-04', branchCount: 1 });
  assert.equal(one.branchCount, 1);
  assert.doesNotMatch(JSON.stringify({ documents: one.documents, flow: one.flow, expected: one.expected }), /khonkaen/, 'no branch-2 id anywhere in the documents / billing / payment');
  assert.ok(one.documents.every(d => d.branch === 'ubon' && d.record.branch === 'ubon'));
  const sum = (plan, collection, field = 'total') => plan.documents.filter(d => d.collection === collection).reduce((s, d) => s + Number(d.record[field] || 0), 0);
  for (const collection of ['quotes', 'invoices', 'receipts', 'creditNotes']) {
    assert.equal(one.documents.filter(d => d.collection === collection).length, two.documents.filter(d => d.collection === collection).length, collection);
    assert.equal(Math.round(sum(one, collection) * 100), Math.round(sum(two, collection) * 100), `${collection} total`);
  }
  // The second branch's own building (rent, electricity) does not exist with one establishment.
  const expenses = one.documents.filter(d => d.collection === 'expenses');
  assert.equal(expenses.length, two.documents.filter(d => d.collection === 'expenses').length - 4);
  assert.ok(expenses.every(d => !/สาขาขอนแก่น/.test(d.record.desc)));
  assert.ok(expenses.some(d => d.record.desc === 'ค่าส่งจอมอนิเตอร์ให้โรงเรียน'), 'the delivery cost moves to the head office');
  // Running numbers: one sequence per prefix + month, unique, no gaps — exactly the two-branch set.
  const numbers = plan => plan.documents.map(d => d.record.no).filter(Boolean).sort();
  assert.deepEqual(numbers(one), numbers(two));
  assert.equal(new Set(numbers(one)).size, numbers(one).length);
  assert.deepEqual(plain(one.flow.billingNotes.map(x => x.no)), plain(two.flow.billingNotes.map(x => x.no)));
  // Stock: all opening stock at the head office, same total per product; seeded sales never exceed it.
  for (const product of one.products) {
    const original = two.products.find(p => p.code === product.code);
    assert.equal(product.openingStockKhonkaen, 0, product.code);
    assert.equal(product.openingStockUbon, original.openingStockUbon + original.openingStockKhonkaen, product.code);
    assert.equal(product.openingStock, original.openingStock, product.code);
  }
  const usage = seed.demoSeedStockUsage(one);
  assert.ok(Object.keys(usage).every(key => key.startsWith('ubon|')));
  // Expected balances: the same invoices with the same paid / credited / outstanding.
  for (const [key, row] of Object.entries(one.expected.invoices)) {
    assert.equal(row.branch, 'ubon', key);
    assert.deepEqual([row.no, row.total, row.paid, row.credited, row.outstanding], [two.expected.invoices[key].no, two.expected.invoices[key].total, two.expected.invoices[key].paid, two.expected.invoices[key].credited, two.expected.invoices[key].outstanding], key);
  }
  // Targets: company + head office only, and the company targets equal the two-branch company targets.
  const targets = seed.buildDemoSeedTargets(one), twoTargets = seed.buildDemoSeedTargets(two);
  for (const metric of ['sales', 'delivery']) {
    assert.ok(Object.keys(targets[metric]).length > 0, metric);
    assert.ok(Object.keys(targets[metric]).every(key => /^(all|ubon):/.test(key)), metric);
    const company = Object.fromEntries(Object.entries(targets[metric]).filter(([key]) => key.startsWith('all:')));
    assert.deepEqual(company, Object.fromEntries(Object.entries(twoTargets[metric]).filter(([key]) => key.startsWith('all:'))), metric);
    for (const [key, value] of Object.entries(company)) assert.equal(targets[metric][key.replace('all:', 'ubon:')], value, `${metric} ${key}: head office = company`);
  }
  assert.throws(() => seed.buildDemoSeedPlan({ today: '2026-10-04', branchCount: 3 }), /1 หรือ 2/);
  assert.ok(seed.DEMO_RESET_KEPT_BASE_KEYS.includes(SETTING_KEY), 'the reset keeps the setting');
});

test('branches#5 company-profile storage + backup carry the setting; old backups leave it alone', async () => {
  const cp = await imp('erp-company-profile-core.js');
  const KEYS = { profile: 'comform_company_profile_v1', logo: 'comform_company_logo_v1', branchSetting: SETTING_KEY };
  const setting = { schemaVersion: 1, count: 1, updatedAt: '2026-10-04T00:00:00.000Z' };
  const storage = memoryStorage({ [KEYS.profile]: JSON.stringify(PROFILE) });
  // Only the setting: profile / logo untouched (undefined = leave as it is).
  cp.writeCompanyProfileStorage(storage, k => k, KEYS, { branchSetting: setting });
  assert.equal(storage.getItem(KEYS.profile), JSON.stringify(PROFILE));
  assert.equal(storage.getItem(SETTING_KEY), JSON.stringify(setting));
  // All-or-nothing: a failing third write rolls the first two back.
  const failing = memoryStorage({ [KEYS.profile]: 'old', [SETTING_KEY]: 'old-setting' });
  const setItem = failing.setItem;
  failing.setItem = (k, v) => { if (k === SETTING_KEY) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } setItem(k, v); };
  assert.throws(() => cp.writeCompanyProfileStorage(failing, k => k, KEYS, { profile: PROFILE, logo: null, branchSetting: setting }), /full/);
  assert.equal(failing.getItem(KEYS.profile), 'old');
  assert.equal(failing.getItem(SETTING_KEY), 'old-setting');

  assert.deepEqual(plain(cp.companyProfileBackupPayload({ profile: null, logo: null, branchSetting: setting })), { schemaVersion: 1, profile: null, logo: null, branchSetting: setting });
  assert.equal(cp.companyProfileBackupPayload({ profile: null, logo: null, branchSetting: null }), undefined);
  assert.deepEqual(plain(cp.companyProfileBackupPayload({ profile: PROFILE, logo: null })), { schemaVersion: 1, profile: PROFILE, logo: null }, 'no setting saved = the ADR-020 shape');
  assert.throws(() => cp.validateCompanyProfileBackup({ schemaVersion: 1, profile: null, logo: null, branchSetting: { schemaVersion: 1, count: 5 } }), /ระบบหยุดก่อนเขียนข้อมูล/);
  assert.deepEqual(Object.keys(cp.validateCompanyProfileBackup({ schemaVersion: 1, profile: null, logo: null })), ['profile', 'logo']);
  const payload = { schemaVersion: 1, profile: null, logo: null, branchSetting: setting };
  assert.deepEqual(plain(cp.companyProfileBackupWrites(payload, k => k, KEYS, {}, { replace: true }).filter(([k]) => k === SETTING_KEY)), [[SETTING_KEY, JSON.stringify(setting)]]);
  const newer = { ...setting, count: 2, updatedAt: '2026-10-05T00:00:00.000Z' };
  assert.equal(cp.companyProfileBackupWrites(payload, k => k, KEYS, { branchSetting: newer }, { replace: false }).some(([k]) => k === SETTING_KEY), false, 'merge keeps a newer local setting');
  assert.equal(cp.companyProfileBackupWrites(payload, k => k, KEYS, { branchSetting: newer }, { replace: true }).some(([k]) => k === SETTING_KEY), true, 'replace applies the backup');
  assert.equal(cp.companyProfileBackupWrites({ schemaVersion: 1, profile: PROFILE, logo: null }, k => k, KEYS, {}, { replace: true }).some(([k]) => k === SETTING_KEY), false, 'an old backup has none → the setting is left alone');
  // The settings-page preview shows the head office only for one establishment.
  assert.equal((cp.companyHeaderPreviewHtml(PROFILE, cp.DEFAULT_COMPANY_LOGO_URL).match(/data-cp-preview-branch=/g) || []).length, 2);
  assert.deepEqual(cp.companyHeaderPreviewHtml(PROFILE, cp.DEFAULT_COMPANY_LOGO_URL, { branchCount: 1 }).match(/data-cp-preview-branch="(\w+)"/g), ['data-cp-preview-branch="ubon"']);
});
