// ============================================================================
// erp-branches-core.js — the company's establishments: 1 (สำนักงานใหญ่อย่างเดียว) or 2 (+ 1 สาขา) (ADR-022)
// ERP DEMO 4.3.1 · round 8
// ----------------------------------------------------------------------------
// One source of truth for "which branches exist" and "what are they called" on screen:
//   - setting: COMPANY_BRANCH_SETTING_KEY { schemaVersion, count: 1 | 2, updatedAt }; absent = 2
//   - labels: from the customer's company profile (ADR-020: code + optional name), else the labels
//     the screens always showed ("สาขาสำนักงานใหญ่" / "สาขาที่ 00001")
//   - census: what branch 2 (internal id `khonkaen`) still holds — documents, order flow, stock
// Internal ids stay `ubon` (head office) / `khonkaen` (branch 2): document packs are keyed by them.
//
// MONEY RULE. The branch list used for DATA (totals, reports, numbering, backup) never shrinks here:
// app.js tenantActiveBranchIds() & co. keep reading both ids. This module only decides what the UI
// SHOWS. The UI is single-branch only while the setting is 1 AND branch 2 holds nothing; as soon as
// anything exists for branch 2 (an imported backup, a CSV import) the UI shows both branches again
// and a warning — so a figure can never sit in a total the user cannot open.
//
// Pure functions take their inputs; the `live*` helpers read window.CurrentUser / localStorage at call
// time (no module state: the jsdom harness gives every importer its own copy of a module). The census
// is cached for one synchronous task only (queueMicrotask) and dropped by invalidateBranchState().
// ============================================================================
import { COMPANY_BRANCH_SETTING_KEY, ORDER_FLOW_STORE_KEY, PRODUCT_MASTER_KEY } from './erp-storage-contracts.js';
import { escapeHtml } from './erp-shared-core.js';

export const BRANCH_SETTING_SCHEMA_VERSION = 1;
export const HEAD_OFFICE_BRANCH_ID = 'ubon';
export const SECOND_BRANCH_ID = 'khonkaen';
export const BRANCH_IDS = Object.freeze([HEAD_OFFICE_BRANCH_ID, SECOND_BRANCH_ID]);
// Every store before ADR-022 (and a brand-new one): head office + 1 branch, so nothing changes until
// the customer chooses otherwise in ตั้งค่าบริษัท.
export const DEFAULT_BRANCH_COUNT = 2;
// The on-screen labels used while no company profile is saved (unchanged from before ADR-022).
export const DEFAULT_BRANCH_LABELS = Object.freeze({ ubon: 'สาขาสำนักงานใหญ่', khonkaen: 'สาขาที่ 00001' });
// "All branches" wording in single-branch mode: there is only the company.
export const SINGLE_BRANCH_SCOPE_LABEL = 'ทั้งบริษัท';
const BRANCH_CORE_PACK_KEY_RE = /^biz2_(ubon|khonkaen)_(\d{4})_(\d{2})$/;
const BRANCH_CORE_CACHE_PROP = '__erpBranchCensusCache';

const branchCoreIsObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const branchCoreCleanLabel = value => String(value ?? '').replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '').replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();

// ---------------------------------------------------------------- setting
export function isValidBranchCount(value) {
  return value === 1 || value === 2;
}

// A stored / restored setting record → normalized copy, or throws a Thai message.
export function normalizeBranchSetting(value) {
  if (!branchCoreIsObject(value)) throw new Error('การตั้งค่าจำนวนสาขาต้องเป็น object');
  const version = Number(value.schemaVersion);
  if (!Number.isInteger(version) || version < 1 || version > BRANCH_SETTING_SCHEMA_VERSION) throw new Error('การตั้งค่าจำนวนสาขาเป็นเวอร์ชันที่ระบบนี้ไม่รองรับ');
  for (const key of Object.keys(value)) if (!['schemaVersion', 'count', 'updatedAt'].includes(key)) throw new Error(`การตั้งค่าจำนวนสาขามี field ที่ไม่รู้จัก (${key})`);
  if (!isValidBranchCount(value.count)) throw new Error('จำนวนสาขาต้องเป็น 1 (สำนักงานใหญ่อย่างเดียว) หรือ 2 (สำนักงานใหญ่ + 1 สาขา)');
  const updatedAt = typeof value.updatedAt === 'string' && !Number.isNaN(Date.parse(value.updatedAt)) ? value.updatedAt : '';
  return { schemaVersion: BRANCH_SETTING_SCHEMA_VERSION, count: value.count, updatedAt };
}

export function branchSettingRecord(count, now = new Date()) {
  return normalizeBranchSetting({ schemaVersion: BRANCH_SETTING_SCHEMA_VERSION, count, updatedAt: now.toISOString() });
}

// { count, record, raw, error }. Missing → the default (2). A damaged value also falls back to 2 —
// the setting that shows MORE, never less — and is reported in `error`.
export function readBranchSetting(storage, keyFor = key => key) {
  const out = { count: DEFAULT_BRANCH_COUNT, record: null, raw: null, error: '' };
  try { out.raw = storage?.getItem?.(keyFor(COMPANY_BRANCH_SETTING_KEY)) ?? null; } catch (error) { out.error = String(error?.message || error); return out; }
  if (out.raw === null || out.raw === 'null') return out;
  try { out.record = normalizeBranchSetting(JSON.parse(out.raw)); out.count = out.record.count; } catch (error) { out.error = String(error?.message || error); }
  return out;
}

// ---------------------------------------------------------------- labels
// The legal wording (Revenue Code): สำนักงานใหญ่ / สาขาที่ xxxxx (same rule as erp-company-profile-core.js).
export function legalBranchName(code) {
  return code === '00000' ? 'สำนักงานใหญ่' : `สาขาที่ ${code}`;
}

// Label of one branch from a saved company profile (ADR-020 record: branches[id] = { code, label }):
// "สำนักงานใหญ่", "สาขาที่ 00003 · สาขาขอนแก่น"; '' when the profile has no such branch.
export function branchLabelFromProfile(profile, branchId) {
  const row = branchCoreIsObject(profile?.branches) ? profile.branches[branchId] : null;
  if (!branchCoreIsObject(row)) return '';
  const code = branchId === HEAD_OFFICE_BRANCH_ID ? '00000' : String(row.code || '').trim();
  if (!/^\d{5}$/.test(code)) return '';
  const legal = legalBranchName(code);
  // Labels go into many screen templates: characters that could open markup / attributes are dropped
  // (a branch name never needs them; the printed documents keep their own escaped copy, ADR-020).
  const name = branchCoreCleanLabel(row.label).replace(/[<>"'`]/g, '').trim();
  if (!name || name === legal) return legal;
  return name.includes(legal) ? name : `${legal} · ${name}`;
}

// The saved (validated) profile on CurrentUser, or null while the demo profile applies.
export function savedProfileOf(user) {
  const companyProfile = user?.companyProfile;
  return companyProfile?.customProfile === true && branchCoreIsObject(companyProfile.custom) ? companyProfile.custom : null;
}

// Screen label of a branch. `fallback` = the text the calling screen showed before ADR-022 (some say
// "สำนักงานใหญ่", most "สาขาสำนักงานใหญ่"), used while no profile is saved and 2 branches are set up.
export function branchDisplayLabel(branchId, { profile = null, count = DEFAULT_BRANCH_COUNT, fallback } = {}) {
  const fromProfile = profile ? branchLabelFromProfile(profile, branchId) : '';
  if (fromProfile) return fromProfile;
  if (count === 1 && branchId === HEAD_OFFICE_BRANCH_ID) return 'สำนักงานใหญ่';
  if (fallback !== undefined && fallback !== null && fallback !== '') return String(fallback);
  return DEFAULT_BRANCH_LABELS[branchId] || String(branchId ?? '');
}

// "All branches" wording: the screen's own text with 2 branches on screen, "ทั้งบริษัท" otherwise.
export function branchScopeAllLabel(multi, twoBranchText = 'รวมทั้ง 2 สาขา') {
  return multi ? twoBranchText : SINGLE_BRANCH_SCOPE_LABEL;
}

// ---------------------------------------------------------------- census (what branch 2 holds)
export const BRANCH_DATA_KINDS = Object.freeze([
  Object.freeze({ kind: 'quotes', label: 'ใบเสนอราคา' }),
  Object.freeze({ kind: 'productions', label: 'ใบสั่งผลิต' }),
  Object.freeze({ kind: 'invoices', label: 'ใบส่งสินค้า/ใบกำกับภาษี' }),
  Object.freeze({ kind: 'receipts', label: 'ใบเสร็จรับเงิน' }),
  Object.freeze({ kind: 'creditNotes', label: 'ใบลดหนี้' }),
  Object.freeze({ kind: 'expenses', label: 'ค่าใช้จ่าย' }),
  Object.freeze({ kind: 'salesOrders', label: 'ใบสั่งขาย' }),
  Object.freeze({ kind: 'billingNotes', label: 'ใบวางบิล' }),
  Object.freeze({ kind: 'payments', label: 'รายการรับชำระ' }),
  Object.freeze({ kind: 'reservations', label: 'การจองสต็อก' }),
  Object.freeze({ kind: 'purchaseOrders', label: 'ใบสั่งซื้อ (PO)' }),
  Object.freeze({ kind: 'goodsReceipts', label: 'ใบรับสินค้า (GR)' }),
  Object.freeze({ kind: 'inventoryMovements', label: 'รายการเคลื่อนไหวสต็อก' }),
  Object.freeze({ kind: 'openingStock', label: 'สินค้าที่มียอดตั้งต้นของสาขานี้' }),
  Object.freeze({ kind: 'unreadable', label: 'ชุดข้อมูลที่อ่านไม่ได้' })
]);
// Printed copies (issuedInvoices / issuedReceipts) count with their document, once per id / number.
const BRANCH_CORE_PACK_KIND = Object.freeze({ quotes: 'quotes', productions: 'productions', invoices: 'invoices', issuedInvoices: 'invoices', receipts: 'receipts', issuedReceipts: 'receipts', creditNotes: 'creditNotes', expenses: 'expenses' });

// Every branch a record names: its own field, or (billing notes / payments) the invoices it covers.
function branchCoreRecordBranches(row) {
  if (!branchCoreIsObject(row)) return [];
  const out = [row.branch, row._branch, row.invoiceBranch, row.sourceQuoteBranch];
  for (const list of [row.lines, row.allocations, row.invoices, row.items]) if (Array.isArray(list)) for (const item of list) if (branchCoreIsObject(item)) out.push(item.branch, item.invoiceBranch);
  return out.filter(value => typeof value === 'string' && value);
}

// Everything that exists for `branchId`. Every record counts, cancelled ones too (a cancelled tax
// invoice is still numbered tax evidence). Inputs:
//   packs: [{ branch, data }] (document packs; data = null for a pack that could not be parsed)
//   flow: { salesOrders, billingNotes, payments, reservations } · production: { purchaseOrders,
//   goodsReceipts, inventoryMovements } · products: product master rows · unreadable: extra count
// → { branch, total, counts: { kind: n }, items: [{ kind, label, count }] } (items: only counts > 0).
export function branchDataCensus({ packs = [], flow = {}, production = {}, products = [], unreadable = 0 } = {}, branchId = SECOND_BRANCH_ID) {
  const counts = Object.fromEntries(BRANCH_DATA_KINDS.map(({ kind }) => [kind, 0]));
  const seen = Object.fromEntries(Object.values(BRANCH_CORE_PACK_KIND).map(kind => [kind, new Set()]));
  counts.unreadable += Math.max(0, Math.trunc(Number(unreadable) || 0));
  for (const pack of Array.isArray(packs) ? packs : []) {
    if (pack?.branch !== branchId) continue;
    if (!branchCoreIsObject(pack.data)) { counts.unreadable += 1; continue; }
    for (const [collection, kind] of Object.entries(BRANCH_CORE_PACK_KIND)) {
      const rows = pack.data[collection];
      if (!Array.isArray(rows)) continue;
      rows.forEach((row, index) => {
        const identity = branchCoreIsObject(row) && (row.id || row.no || row.docNo) ? String(row.id || row.no || row.docNo) : `${collection}#${index}#${seen[kind].size}`;
        seen[kind].add(identity);
      });
    }
  }
  for (const kind of Object.values(BRANCH_CORE_PACK_KIND)) counts[kind] = seen[kind].size;
  const own = rows => (Array.isArray(rows) ? rows : []).filter(row => branchCoreRecordBranches(row).includes(branchId)).length;
  for (const kind of ['salesOrders', 'billingNotes', 'payments', 'reservations']) counts[kind] += own(flow?.[kind]);
  for (const kind of ['purchaseOrders', 'goodsReceipts', 'inventoryMovements']) counts[kind] += own(production?.[kind]);
  const openingField = branchId === SECOND_BRANCH_ID ? 'openingStockKhonkaen' : 'openingStockUbon';
  counts.openingStock = (Array.isArray(products) ? products : []).filter(product => branchCoreIsObject(product) && Number(product[openingField] || 0) !== 0).length;
  const items = BRANCH_DATA_KINDS.filter(({ kind }) => counts[kind] > 0).map(({ kind, label }) => ({ kind, label, count: counts[kind] }));
  return { branch: branchId, total: items.reduce((sum, item) => sum + item.count, 0), counts, items };
}

export function describeBranchCensus(census) {
  return (census?.items || []).map(item => `${item.label} ${item.count.toLocaleString('th-TH')}`).join(' · ');
}

// Reads the census from browser storage. Any value that cannot be parsed counts as "unreadable"
// (it might hold branch-2 data) — fail-closed, never "nothing there". `readProduction()` returns the
// PO / GR / stock-movement rows (erp-production-core.js owns those keys: window.ERPProductionCore
// .exportData); it may throw (a damaged store → unreadable) or return null (not loaded yet → none).
export function readBranchDataCensus(storage, keyFor = key => key, unwrapKey = key => key, branchId = SECOND_BRANCH_ID, readProduction = () => null) {
  const packs = [];
  let unreadable = 0;
  const length = Number(storage?.length) || 0;
  for (let i = 0; i < length; i += 1) {
    const key = storage.key(i);
    const raw = unwrapKey(key) ?? key;
    const match = BRANCH_CORE_PACK_KEY_RE.exec(raw || '');
    if (!match || match[1] !== branchId) continue;
    let data = null;
    try { const parsed = JSON.parse(storage.getItem(key) || '{}'); data = branchCoreIsObject(parsed) ? parsed : null; } catch { data = null; }
    packs.push({ branch: match[1], data });
  }
  const readJson = (baseKey, fallback) => {
    let raw = null;
    try { raw = storage.getItem(keyFor(baseKey)); } catch { unreadable += 1; return fallback; }
    if (raw === null || raw === undefined || raw === '') return fallback;
    try { return JSON.parse(raw); } catch { unreadable += 1; return fallback; }
  };
  const flowValue = readJson(ORDER_FLOW_STORE_KEY, {});
  const flow = branchCoreIsObject(flowValue) ? flowValue : (unreadable += 1, {});
  const list = baseKey => { const value = readJson(baseKey, []); if (Array.isArray(value)) return value; unreadable += 1; return []; };
  let production = {};
  try { production = readProduction() || {}; } catch { unreadable += 1; production = {}; }
  return branchDataCensus({ packs, flow, production, products: list(PRODUCT_MASTER_KEY), unreadable }, branchId);
}

// The branch ids the UI shows: 1 only when the setting is 1 AND branch 2 holds nothing.
export function uiBranchIdsFor(count, census) {
  return count === 1 && !(census?.total > 0) ? [HEAD_OFFICE_BRANCH_ID] : [...BRANCH_IDS];
}

// Thai refusal shown when switching to 1 branch while branch 2 still holds data ('' = allowed).
export function singleBranchRefusal(census, branchLabel = DEFAULT_BRANCH_LABELS.khonkaen) {
  if (!(census?.total > 0)) return '';
  return `เปลี่ยนเป็น "สำนักงานใหญ่อย่างเดียว" ไม่ได้ — ${branchLabel} ยังมีข้อมูล: ${describeBranchCensus(census)}`
    + ' · ระบบไม่ซ่อนข้อมูลที่เกี่ยวกับเงินและภาษี จึงใช้แบบ 2 สาขาต่อไป'
    + ' (ถ้าเป็นข้อมูลตัวอย่าง ล้างได้ที่ ⚙ Demo › ล้างข้อมูลสาธิตทั้งหมด (รีเซ็ต) แล้วค่อยเปลี่ยน)';
}

// Banner text when the setting says 1 but branch 2 holds data ('' = no warning).
export function singleBranchDataWarning(count, census, branchLabel = DEFAULT_BRANCH_LABELS.khonkaen) {
  if (count !== 1 || !(census?.total > 0)) return '';
  return `ตั้งค่าไว้เป็น "สำนักงานใหญ่อย่างเดียว" แต่พบข้อมูลของ ${branchLabel}: ${describeBranchCensus(census)}`
    + ' — ระบบจึงแสดง 2 สาขาและรวมยอดของทุกสาขาไว้ เพื่อไม่ให้ข้อมูลถูกซ่อน';
}

// ---------------------------------------------------------------- live (window) helpers
const branchCoreWindow = () => (typeof window !== 'undefined' ? window : null);
const branchCoreKeyFor = win => key => win?.ComformTenant?.storageKey?.(key) || key;
const branchCoreUnwrap = win => key => win?.ComformTenant?.unwrapStorageKey?.(key) ?? key;
const branchCoreStorage = win => { try { return win?.localStorage || null; } catch { return null; } };

export function liveBranchCount(win = branchCoreWindow()) {
  return readBranchSetting(branchCoreStorage(win), branchCoreKeyFor(win)).count;
}

export function invalidateBranchState(win = branchCoreWindow()) {
  if (win) win[BRANCH_CORE_CACHE_PROP] = null;
}

// Branch-2 census, computed at most once per synchronous task (and fresh with { fresh: true }).
export function liveBranchCensus(win = branchCoreWindow(), { fresh = false } = {}) {
  if (!win) return branchDataCensus();
  if (!fresh && win[BRANCH_CORE_CACHE_PROP]) return win[BRANCH_CORE_CACHE_PROP];
  const census = readBranchDataCensus(branchCoreStorage(win), branchCoreKeyFor(win), branchCoreUnwrap(win), SECOND_BRANCH_ID, () => win.ERPProductionCore?.exportData?.() || null);
  win[BRANCH_CORE_CACHE_PROP] = census;
  const clear = () => { if (win[BRANCH_CORE_CACHE_PROP] === census) win[BRANCH_CORE_CACHE_PROP] = null; };
  if (typeof queueMicrotask === 'function') queueMicrotask(clear); else Promise.resolve().then(clear);
  return census;
}

// { count, multi, ids, census, warning } — the census is only read when the setting is 1.
export function liveBranchState(win = branchCoreWindow()) {
  const count = liveBranchCount(win);
  const census = count === 1 ? liveBranchCensus(win) : null;
  const ids = uiBranchIdsFor(count, census);
  const profile = savedProfileOf(win?.CurrentUser);
  const secondLabel = branchDisplayLabel(SECOND_BRANCH_ID, { profile, count: 2 });
  return { count, multi: ids.length > 1, ids, census, warning: singleBranchDataWarning(count, census, secondLabel) };
}

export function isMultiBranchUi(win = branchCoreWindow()) {
  return liveBranchState(win).multi;
}

// The 5-digit code of a branch (column headers such as "Opening 00001"): the saved profile's, else the
// built-in one (00000 / 00001).
export function branchCodeOf(profile, branchId) {
  if (branchId === HEAD_OFFICE_BRANCH_ID) return '00000';
  const code = String(profile?.branches?.[branchId]?.code || '').trim();
  return /^\d{5}$/.test(code) && code !== '00000' ? code : '00001';
}
export function liveBranchCode(branchId, win = branchCoreWindow()) {
  return branchCodeOf(savedProfileOf(win?.CurrentUser), branchId);
}

export function liveBranchLabel(branchId, fallback, win = branchCoreWindow()) {
  return branchDisplayLabel(branchId, { profile: savedProfileOf(win?.CurrentUser), count: liveBranchCount(win), fallback });
}

// An object { ubon, khonkaen } whose values are always the current labels (enumerable getters), for
// the label maps the modules used to hard-code: `MAP[branch]` and `Object.keys(MAP)` work as before.
export function branchLabelMap(fallbacks = DEFAULT_BRANCH_LABELS, win) {
  const map = {};
  for (const id of BRANCH_IDS) Object.defineProperty(map, id, { enumerable: true, get: () => liveBranchLabel(id, fallbacks?.[id], win === undefined ? branchCoreWindow() : win) });
  return Object.freeze(map);
}

export function liveBranchAllLabel(twoBranchText = 'รวมทั้ง 2 สาขา', win = branchCoreWindow()) {
  return branchScopeAllLabel(isMultiBranchUi(win), twoBranchText);
}

// window.ERPBranches (installed by local-demo-mode.js) for plain scripts that cannot import.
export function createBranchesApi(win = branchCoreWindow()) {
  return Object.freeze({
    ids: BRANCH_IDS,
    count: () => liveBranchCount(win),
    state: () => liveBranchState(win),
    multi: () => isMultiBranchUi(win),
    uiBranches: () => liveBranchState(win).ids,
    label: (branchId, fallback) => liveBranchLabel(branchId, fallback, win),
    code: branchId => liveBranchCode(branchId, win),
    labelMap: fallbacks => branchLabelMap(fallbacks, win),
    allLabel: twoBranchText => liveBranchAllLabel(twoBranchText, win),
    census: options => liveBranchCensus(win, options),
    invalidate: () => invalidateBranchState(win)
  });
}

// ---------------------------------------------------------------- A4 document editors
// The branch of the A4 editors (delivery-tax-document.js `dtd`, receipt-document.js `rcp`): with one
// establishment a new / kept draft is the head office; with 2 the editors keep their default (branch 2).
export function documentEditorDefaultBranch(win = branchCoreWindow()) {
  return isMultiBranchUi(win) ? SECOND_BRANCH_ID : HEAD_OFFICE_BRANCH_ID;
}
// A branch the editor may use now: branch 2 becomes the head office while the screens are single-branch.
export function documentEditorBranch(branch, win = branchCoreWindow()) {
  return branch === SECOND_BRANCH_ID && !isMultiBranchUi(win) ? HEAD_OFFICE_BRANCH_ID : branch;
}
// A draft kept in the browser from 2-branch days: in a one-branch company it opens at the head office
// (its branch-2 company block is dropped, so the head office block is printed).
export function documentEditorDraft(saved, win = branchCoreWindow()) {
  if (!branchCoreIsObject(saved) || documentEditorBranch(saved.branch, win) === saved.branch) return saved;
  return { ...saved, branch: HEAD_OFFICE_BRANCH_ID, company: undefined };
}
// Their "เลือกสาขา" field (same markup both editors had, with the current labels). Hidden with one
// establishment. `lockedLabel` = the editor's own label of a user's fixed branch.
export function documentEditorBranchFieldHtml(prefix, { branch = '', locked = '', lockedLabel = '' } = {}, win = branchCoreWindow()) {
  const option = (id, dot, small, fallback) => `
            <button type="button" class="${prefix}-branch-option ${branch === id ? 'active' : ''}" data-action="set-branch" data-branch="${id}" ${locked && locked !== id ? 'disabled' : ''}>
              <span class="${prefix}-branch-dot ${dot}"></span><b>${escapeHtml(liveBranchLabel(id, fallback, win))}</b><small>${small}</small>
            </button>`;
  return `<div class="${prefix}-field ${prefix}-span-2"${isMultiBranchUi(win) ? '' : ' data-erp-branch-hidden'}>
          <span>เลือกสาขา *</span>
          <div class="${prefix}-branch-options" role="group" aria-label="เลือกสาขาสำหรับออกเอกสาร">${option(HEAD_OFFICE_BRANCH_ID, 'ub', 'HEAD OFFICE', DEFAULT_BRANCH_LABELS.ubon)}${option(SECOND_BRANCH_ID, 'kk', `BRANCH ${escapeHtml(liveBranchCode(SECOND_BRANCH_ID, win))}`, DEFAULT_BRANCH_LABELS.khonkaen)}
          </div>
          ${locked ? `<small class="${prefix}-branch-lock-note">บัญชีนี้ถูกกำหนดให้ใช้งาน ${escapeHtml(lockedLabel || locked)}</small>` : `<small class="${prefix}-branch-lock-note">Admin สามารถเลือกสาขาก่อนออกเอกสารได้</small>`}
        </div>`;
}
