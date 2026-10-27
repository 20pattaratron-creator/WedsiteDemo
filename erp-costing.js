// ============================================================================
// erp-costing.js — page "ต้นทุนและกำไรต่องาน" (Inventory & job costing, ADR-028, round 11)
// ERP DEMO 4.3.1
// ----------------------------------------------------------------------------
// Six tabs (simple mode): ต้นทุนงาน (job list, the job cost sheet ใบต้นทุนงาน with budget vs actual and margin, quick
// entry: material issue / return, labour hours, other costs, completion, budget) · กำไร (by job / customer / product /
// month, branch and period filters, Excel / CSV) · การ์ดสินค้า (stock card: qty / cost / value running balance) ·
// มูลค่าคงเหลือ (valuation at a date + NRV report and Excel) · โสหุ้ย (predetermined rate, over / under-applied) ·
// ตั้งค่าต้นทุน (method + lock, labour rates, overhead estimate and categories, opening costs).
// The numbers come from two pure cores: erp-costing-core.js (moving average / FIFO) and erp-job-costing-core.js
// (job sheets, gross-profit lines on the analytics sales measure). Reads are strict (a damaged store is said, never
// shown as zeros). Every write goes through one ERPIntegrity.transaction and is refused BEFORE anything is written when
// its date — or any cost it would recompute — lies in a closed period (the same Thai text as every period lock).
// Also: window.ERPCosting for the analytics page (gross profit with coverage), the dashboard card, the production list
// row action "ใบต้นทุนงาน", the stock-posting guards of erp-production-core.js and the JSON backup.
// Every text comes from i18n/en-costing.js (Thai and English); user data is escaped and marked data-no-i18n.
// ============================================================================
import { COSTING_CORE_VERSION, COSTING_METHODS, buildCostingMovements, computeInventoryCosting, valuationAt, valuationTotal, stockCard, buildNrvReport, lockedCostChanges, isMethodLocked, planMethodChange, currentMethodOf, normalizeCostingSettings, productSkuKey, isStockTrackedProduct, createProductResolver, overheadRateSatang, ucToBaht, unitCostOf, qmToQty, toQm, toSatang, dateNumber, isIsoDate } from './erp-costing-core.js';
import { listJobs, normalizeJobStore, buildJobCostSheets, completionValuesFrom, buildGrossProfitLines, profitReport, summarizeLines, overheadVarianceReport, planMaterialIssue, planMaterialReturn, planLabourEntry, planOtherCost, planCompletion, overheadRateBaht, PROFIT_DIMENSIONS, OTHER_COST_CATEGORIES, COMPLETION_DESTINATIONS, COST_CATEGORIES } from './erp-job-costing-core.js';
import { packSalesRows, monthKey, addMonths, monthRange, monthLabel, periodAllMonths, listPeriods, periodLabel, displayDate, lastClosedMonthKey, currentMonthKey, UNKNOWN_CUSTOMER_KEY, ANALYTICS_WALK_IN_KEY, ADJUSTMENT_PRODUCT_KEY, UNKNOWN_PRODUCT_KEY } from './erp-analytics-core.js';
import { COSTING_KEYS } from './i18n/en-costing.js';
import { translateKey } from './erp-i18n-core.js';
import { escapeHtml, localDateISO } from './erp-shared-core.js';
import { liveBranchState, liveBranchLabel, BRANCH_IDS } from './erp-branches-core.js';
import { taxCsvText, taxSafeSheetName } from './erp-tax-reports-core.js';
import { STORAGE_WRITTEN_EVENT, COMPANY_PROFILE_CHANGED_EVENT, COSTING_SETTINGS_KEY, JOB_COSTING_KEY, notifyStorageWritten } from './erp-storage-contracts.js';
import { icon } from './erp-icons.js';

const PANEL_ID = 'job-costing';
const ROOT_ID = 'jc-root';
const TABS = Object.freeze(['jobs', 'profit', 'stock', 'valuation', 'overhead', 'settings']);
const PERIOD_CHOICES = Object.freeze(['month', 'quarter', 'year', 'all']);
const ui = { tab: 'jobs', branch: 'all', jobKey: '', dimension: 'job', periodType: 'all', period: '', stockSku: '', stockBranch: 'all', stockFrom: '', stockTo: '', valuationDate: '', search: '' };
const $ = id => document.getElementById(id);
const esc = value => escapeHtml(String(value ?? ''));
const storageKey = base => window.ComformTenant?.storageKey?.(base) || base;
let todayOverride = '';
let cached = null;
let current = null;

// ---------------------------------------------------------------- language / formatting
const lang = () => (window.ERPI18n?.isEnglish?.() ? 'en' : 'th');
const t = (key, params = {}) => translateKey(COSTING_KEYS, lang(), key, params);
const NUMBER_2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NUMBER_4 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const NUMBER_Q = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
const MINUS = '−';
// Money from satang (integers): "฿1,234.50" in Thai, "THB 1,234.50" in English.
function money(satang) {
  if (satang === null || satang === undefined || !Number.isFinite(Number(satang))) return '—';
  const value = Number(satang) / 100;
  const sign = value < 0 && Math.abs(value) >= 0.005 ? MINUS : '';
  const body = NUMBER_2.format(Math.abs(value));
  return lang() === 'en' ? `${sign}THB ${body}` : `${sign}฿${body}`;
}
function unitMoney(uc) {
  if (uc === null || uc === undefined || !Number.isFinite(Number(uc))) return '—';
  const value = ucToBaht(uc);
  const body = NUMBER_4.format(Math.abs(value));
  return `${value < 0 ? MINUS : ''}${lang() === 'en' ? 'THB ' : '฿'}${body}`;
}
const qty = qm => (qm === null || qm === undefined || !Number.isFinite(Number(qm)) ? '—' : `${Number(qm) < 0 ? MINUS : ''}${NUMBER_Q.format(Math.abs(qmToQty(Number(qm))))}`);
const pct = value => (value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : `${Number(value) < 0 ? MINUS : ''}${Math.abs(Number(value)).toFixed(1)}%`);
const userText = value => `<span data-no-i18n>${esc(value)}</span>`;
const say = (message, type = 'info', ms) => (typeof window.notify === 'function' ? window.notify(message, type, ms) : console.info('[Costing]', message));
const todayIso = () => todayOverride || localDateISO();
const dateText = iso => (iso ? displayDate(iso, lang()) : t('label.opening'));
// Margin colour: ≥ 20 % good, 0–20 % thin, < 0 loss (the same thresholds everywhere on the page).
const marginClass = margin => (margin === null || margin === undefined ? '' : margin < 0 ? 'jc-loss' : margin < 20 ? 'jc-thin' : 'jc-good');
function branchLabel(id) {
  return liveBranchLabel(id, undefined, window) || id;
}

// ---------------------------------------------------------------- strict reads
function readStore(base, normalize) {
  let raw = null;
  try { raw = localStorage.getItem(storageKey(base)); }
  catch (error) { throw Object.assign(new Error(t('error.storage')), { costing: true, cause: error }); }
  try { return normalize(raw); }
  catch (error) { throw Object.assign(new Error(error.message), { costing: true, key: base }); }
}
const readSettings = () => readStore(COSTING_SETTINGS_KEY, normalizeCostingSettings);
const readJobStore = () => readStore(JOB_COSTING_KEY, normalizeJobStore);
function movementKey() {
  const base = window.ERPProductionCore?.KEYS?.inventoryMovements;
  if (!base) throw Object.assign(new Error(t('error.notReady')), { costing: true });
  return base;
}
function readMovements() {
  const base = movementKey();
  const raw = localStorage.getItem(storageKey(base));
  if (raw === null || raw === undefined) return [];
  let rows;
  try { rows = JSON.parse(raw); } catch (error) { throw Object.assign(new Error(t('error.movements')), { costing: true, key: base, cause: error }); }
  if (!Array.isArray(rows)) throw Object.assign(new Error(t('error.movements')), { costing: true, key: base });
  return rows;
}
function productRows() {
  return typeof window.productMasterRows === 'function' ? window.productMasterRows() : [];
}

// ---------------------------------------------------------------- the computation (once per storage change)
// input overrides (for "what would this change do" checks): { settings, movements, invoices, store, products }
function compute(overrides = {}) {
  const integrity = window.ERPIntegrity;
  const packs = integrity.packs();
  const business = integrity.business();
  const products = overrides.products || productRows();
  const settings = overrides.settings || readSettings();
  const store = overrides.store || readJobStore();
  const movements = overrides.movements || readMovements();
  // Stock follows app.js productEstimatedStock: the invoices of each month pack (not the printed copies).
  const invoices = overrides.invoices || packs.flatMap(pack => (pack.data.invoices || []).filter(integrity.live).map(row => ({ ...row, branch: pack.branch, _branch: pack.branch })));
  const creditNotes = packs.flatMap(pack => (pack.data.creditNotes || []).filter(integrity.live).map(row => ({ ...row, branch: pack.branch, _branch: pack.branch })));
  const jobs = listJobs(business.productions);
  const quotes = new Map();
  for (const job of jobs) {
    if (!job.sourceQuote) continue;
    const quote = business.quotes.find(q => q._branch === job.sourceQuote.branch && ((job.sourceQuote.id && String(q.id) === job.sourceQuote.id) || (job.sourceQuote.no && q.no === job.sourceQuote.no)));
    if (quote) quotes.set(job.key, quote);
  }
  const built = buildCostingMovements({ products, stockMovements: movements, invoices, creditNotes, openingCosts: settings.openingCosts });
  const costing = computeInventoryCosting(built.groups, { settings, fallbackUc: built.fallbackUc, completionValuesOf: result => completionValuesFrom(buildJobCostSheets({ jobs, store, costing: result })) });
  const sheets = buildJobCostSheets({ jobs, store, costing, quotes });
  const options = { live: integrity.live, legacyProductions: business.productions || [], resolveInvoice: ref => integrity.resolveInvoice(ref, business) };
  const measureRows = [];
  for (const pack of packs) {
    const period = monthKey(pack.year, pack.month + 1);
    for (const row of packSalesRows(pack.data, { branch: pack.branch, year: pack.year, month: pack.month }, options)) measureRows.push({ row, branch: pack.branch, period });
  }
  const gp = buildGrossProfitLines({ measureRows, products, costing, sheets, jobs, invoices });
  const periods = gp.lines.map(line => line.period).filter(Boolean).sort();
  return { today: todayIso(), products, settings, store, movements, invoices, creditNotes, business, jobs, quotes, built, costing, sheets, gp, firstMonth: periods[0] || '', locked: isMethodLocked(built.movements), method: currentMethodOf(settings) };
}
function dataset() {
  if (cached && cached.today === todayIso()) return cached;
  let out;
  try { out = compute(); out.error = null; }
  catch (error) {
    if (!error?.costing && !window.ERPIntegrity?.isReadError?.(error)) throw error;
    out = { today: todayIso(), error };
  }
  cached = out;
  const drop = () => { if (cached === out) cached = null; };
  if (typeof queueMicrotask === 'function') queueMicrotask(drop); else Promise.resolve().then(drop);
  return out;
}
function errorHtml(error) {
  if (window.ERPIntegrity?.isReadError?.(error)) return window.ERPIntegrity.readErrorHtml(error);
  return `<div class="afc-box afc-box-error" role="alert">${esc(error?.message || t('error.storage'))}</div>`;
}

// ---------------------------------------------------------------- period locks
function isLocked(branch, date, scope) {
  return !!lockText(branch, date, scope);
}
function lockText(branch, date, scope = 'purchase') {
  return window.ERPGovernance?.periodLockRefusal?.({ type: 'stock', scope, branch, date, action: 'costing' }) || '';
}
// "What would this change do": the costing recomputed with the change, compared with now. Refused (the period-lock
// text of the first changed date) when any cost inside a closed period would move. change: { settings, movements,
// invoices, store } (each optional: replaces the current input).
function recomputeRefusal(change = {}) {
  let before;
  let after;
  try {
    before = compute();
    after = compute(change);
  } catch (error) {
    return error?.message || t('error.storage');
  }
  const conflicts = lockedCostChanges(before.costing, after.costing, isLocked);
  if (!conflicts.length) return '';
  const first = conflicts[0];
  return lockText(first.branch, first.date, first.scope) || t('error.locked');
}
// The same check for an invoice about to be saved (erp-production-core.js stock guard of saveInvoice): the stored
// invoices with this one added (or replacing the edited one). Only the stock lines matter: date, branch, items' qty.
function invoiceRefusal({ branch, date, items = [], editId = '' } = {}) {
  if (!isIsoDate(date) || !BRANCH_IDS.includes(branch)) return '';
  const data = dataset();
  if (data.error) return '';
  const others = data.invoices.filter(row => !(editId && String(row.id) === String(editId) && row.branch === branch));
  const draft = { id: editId ? String(editId) : `pending-${date}`, no: '', branch, _branch: branch, date, items: (Array.isArray(items) ? items : []).map(item => ({ product: item.product, productCode: item.productCode, qty: item.qty })) };
  return recomputeRefusal({ invoices: [...others, draft] });
}

// ---------------------------------------------------------------- writes
const newId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const nowIso = () => new Date().toISOString();
const actor = () => window.CurrentUser?.displayName || window.CurrentUser?.email || 'Local user';
function commit(writes, auditText, meta = {}) {
  window.ERPIntegrity.transaction(writes.map(([base, value]) => [storageKey(base), value]));
  cached = null;
  window.ERPIntegrity.changed?.();
  notifyStorageWritten();
  window.ERPProductionCore?.audit?.(meta.action || 'update', 'job_costing', meta.ref || '', auditText, { branch: meta.branch || '' });
}
// Common refusal of a job write: the job must exist, the period of the date must be open.
function jobContext(jobKey) {
  const data = dataset();
  if (data.error) return { error: data.error.message };
  const job = data.jobs.find(row => row.key === jobKey);
  if (!job) return { error: t('error.jobMissing') };
  return { data, job, sheet: data.sheets.get(jobKey) };
}
const PLAN_ERRORS = Object.freeze({ job_missing: 'error.jobMissing', job_completed: 'error.jobCompleted', not_stock_item: 'error.notStock', invalid_date: 'error.date', before_job: 'error.beforeJob', invalid_qty: 'error.qty', not_enough_stock: 'error.stock', issue_missing: 'error.issueMissing', before_issue: 'error.beforeIssue', more_than_issued: 'error.moreThanIssued', person_required: 'error.person', invalid_hours: 'error.hours', invalid_rate: 'error.rate', invalid_category: 'error.category', description_required: 'error.description', invalid_amount: 'error.amount', invalid_destination: 'error.destination', finished_goods_not_stock: 'error.fgNotStock', before_last_cost: 'error.beforeLastCost' });
const planError = code => t(PLAN_ERRORS[code] || 'error.generic');
// Stock of a product at a branch that a back-dated issue may take: the lowest balance from that date on (an issue
// may never push any later day below zero), and never more than is available now (reservations of sales orders).
function availableForIssue(data, product, branch, date) {
  const costing = data.costing.bySku.get(productSkuKey(product));
  const rows = costing ? costing.get(branch) : [];
  const day = dateNumber(date);
  let before = 0;
  let lowest = Infinity;
  for (const row of rows) {
    if (row.dateNum <= day) before = row.balanceQm;
    else lowest = Math.min(lowest, row.balanceQm);
  }
  const floor = Math.min(before, lowest);
  const now = Number(window.ERPIntegrity?.availableStock?.(product, branch)) || 0;
  return Math.max(0, Math.min(qmToQty(floor), now));
}
function postMaterialIssue({ jobKey, productCode, qty: amount, date, note = '' } = {}) {
  const ctx = jobContext(jobKey);
  if (ctx.error) return refuse(ctx.error);
  const product = createProductResolver(ctx.data.products)({ productCode, product: productCode });
  const lock = lockText(ctx.job.branch, date);
  if (lock) return refuse(lock);
  const plan = planMaterialIssue({ job: ctx.job, sheet: ctx.sheet, product, qty: amount, date, available: product ? availableForIssue(ctx.data, product, ctx.job.branch, date) : 0 });
  if (!plan.ok) return refuse(planError(plan.error));
  const row = { id: newId('mvjob'), date, branch: ctx.job.branch, kind: 'job_issue', qty: -qmToQty(plan.qm), productCode: product.code || '', product: product.name || '', unit: product.unit || '', unitCost: 0, refType: 'job', refId: ctx.job.id, refNo: ctx.job.no, jobKey: ctx.job.key, jobNo: ctx.job.no, note: String(note || '').trim(), createdAt: nowIso(), updatedAtIso: nowIso() };
  return commitMovement(ctx, row, t('audit.issue', { qty: qty(plan.qm), product: product.name, job: ctx.job.no }));
}
function postMaterialReturn({ jobKey, issueMovementId, qty: amount, date, note = '' } = {}) {
  const ctx = jobContext(jobKey);
  if (ctx.error) return refuse(ctx.error);
  const lock = lockText(ctx.job.branch, date);
  if (lock) return refuse(lock);
  const sources = new Map(ctx.data.movements.filter(row => row.kind === 'job_return' && !row.voided).map(row => [String(row.id), String(row.sourceMovementId || '')]));
  const plan = planMaterialReturn({ job: ctx.job, sheet: ctx.sheet, issueMovementId: String(issueMovementId || ''), qty: amount, date, returnSources: sources });
  if (!plan.ok) return refuse(planError(plan.error));
  const issued = ctx.data.movements.find(row => String(row.id) === String(issueMovementId));
  const row = { id: newId('mvjob'), date, branch: ctx.job.branch, kind: 'job_return', qty: qmToQty(plan.qm), productCode: issued?.productCode || '', product: issued?.product || '', unit: issued?.unit || '', unitCost: 0, refType: 'job', refId: ctx.job.id, refNo: ctx.job.no, jobKey: ctx.job.key, jobNo: ctx.job.no, sourceMovementId: String(issueMovementId), note: String(note || '').trim(), createdAt: nowIso(), updatedAtIso: nowIso() };
  return commitMovement(ctx, row, t('audit.return', { qty: qty(plan.qm), product: issued?.product || '', job: ctx.job.no }));
}
function commitMovement(ctx, row, auditText) {
  const movements = [row, ...ctx.data.movements];
  const refusal = recomputeRefusal({ movements });
  if (refusal) return refuse(refusal);
  try { commit([[movementKey(), movements]], auditText, { action: 'create', ref: ctx.job.no, branch: ctx.job.branch }); }
  catch (error) { return refuse(t('error.save', { message: error.message })); }
  return done(t('done.saved'));
}
function storeWithEntry(store, entry) {
  return { ...store, entries: [...store.entries, entry] };
}
function postJobEntry(jobKey, kind, fields, auditText) {
  const ctx = jobContext(jobKey);
  if (ctx.error) return refuse(ctx.error);
  const lock = lockText(ctx.job.branch, fields.date);
  if (lock) return refuse(lock);
  const entry = { id: newId('je'), kind, jobKey: ctx.job.key, jobNo: ctx.job.no, branch: ctx.job.branch, status: 'posted', createdAt: nowIso(), createdBy: actor(), ...fields };
  const store = normalizeJobStore(storeWithEntry(ctx.data.store, entry));
  const writes = [[JOB_COSTING_KEY, store]];
  let movements = null;
  if (kind === 'completion' && entry.destination === 'finished_goods') {
    const product = createProductResolver(ctx.data.products)({ productCode: entry.productCode, product: entry.productCode });
    const row = { id: entry.movementId, date: entry.date, branch: ctx.job.branch, kind: 'job_completion', qty: entry.goodQty, productCode: product?.code || entry.productCode, product: product?.name || '', unit: product?.unit || '', unitCost: 0, refType: 'job', refId: ctx.job.id, refNo: ctx.job.no, jobKey: ctx.job.key, jobNo: ctx.job.no, note: '', createdAt: nowIso(), updatedAtIso: nowIso() };
    movements = [row, ...ctx.data.movements];
    writes.push([movementKey(), movements]);
  }
  const refusal = recomputeRefusal({ store, ...(movements ? { movements } : {}) });
  if (refusal) return refuse(refusal);
  try { commit(writes, auditText, { action: 'create', ref: ctx.job.no, branch: ctx.job.branch }); }
  catch (error) { return refuse(t('error.save', { message: error.message })); }
  return done(t('done.saved'));
}
function postLabour({ jobKey, person, hours, date, rate } = {}) {
  const ctx = jobContext(jobKey);
  if (ctx.error) return refuse(ctx.error);
  const plan = planLabourEntry({ job: ctx.job, sheet: ctx.sheet, person, hours, date, rate, settings: ctx.data.settings });
  if (!plan.ok) return refuse(planError(plan.error));
  const { kind, ...fields } = plan.entry;
  return postJobEntry(jobKey, kind, fields, t('audit.labour', { hours: plan.entry.hours, person: plan.entry.person, job: ctx.job.no }));
}
function postOtherCost({ jobKey, category, description, amount, date } = {}) {
  const ctx = jobContext(jobKey);
  if (ctx.error) return refuse(ctx.error);
  const plan = planOtherCost({ job: ctx.job, sheet: ctx.sheet, category, description, amount, date });
  if (!plan.ok) return refuse(planError(plan.error));
  const { kind, ...fields } = plan.entry;
  return postJobEntry(jobKey, kind, fields, t('audit.other', { amount: money(toSatang(plan.entry.amount)), job: ctx.job.no }));
}
function postCompletion({ jobKey, goodQty, scrapQty = 0, destination = 'cost_of_sales', productCode = '', date } = {}) {
  const ctx = jobContext(jobKey);
  if (ctx.error) return refuse(ctx.error);
  const product = productCode ? createProductResolver(ctx.data.products)({ productCode, product: productCode }) : null;
  const plan = planCompletion({ job: ctx.job, sheet: ctx.sheet, goodQty, scrapQty, destination, date, product });
  if (!plan.ok) return refuse(planError(plan.error));
  const { kind, ...fields } = plan.entry;
  if (fields.destination === 'finished_goods') fields.movementId = newId('mvjob');
  return postJobEntry(jobKey, kind, fields, t('audit.complete', { job: ctx.job.no }));
}
// Cancel (never delete) a labour / other / completion entry or a material issue / return of a job.
function voidCostEntry({ jobKey, id, reason = '' } = {}) {
  const ctx = jobContext(jobKey);
  if (ctx.error) return refuse(ctx.error);
  const text = String(reason || '').trim();
  if (!text) return refuse(t('error.reason'));
  const entry = ctx.data.store.entries.find(row => row.id === id && row.status === 'posted' && row.jobKey === jobKey);
  const movement = ctx.data.movements.find(row => String(row.id) === String(id) && !row.voided && row.jobKey === jobKey);
  if (!entry && !movement) return refuse(t('error.entryMissing'));
  const date = entry?.date || movement?.date;
  const lock = lockText(ctx.job.branch, date);
  if (lock) return refuse(lock);
  if (ctx.sheet.status === 'completed' && !(entry && entry.kind === 'completion')) return refuse(t('error.jobCompleted'));
  if (movement?.kind === 'job_issue' && ctx.data.movements.some(row => row.kind === 'job_return' && !row.voided && String(row.sourceMovementId) === String(movement.id))) return refuse(t('error.hasReturns'));
  // Reopening a job is refused while its revenue sits in a closed sales period (its cost of sales would move).
  if (entry?.kind === 'completion') {
    const lines = ctx.data.gp.byJob.get(jobKey)?.lines || [];
    const closed = lines.find(line => isLocked(line.branch, line.date, 'sales'));
    if (closed) return refuse(lockText(closed.branch, closed.date, 'sales'));
  }
  const stamp = { voidedAt: nowIso(), voidedBy: actor(), voidReason: text };
  const writes = [];
  let store = ctx.data.store;
  let movements = ctx.data.movements;
  if (entry) {
    store = normalizeJobStore({ ...store, entries: store.entries.map(row => (row.id === id ? { ...row, status: 'voided', ...stamp } : row)) });
    writes.push([JOB_COSTING_KEY, store]);
    if (entry.kind === 'completion' && entry.movementId) movements = movements.map(row => (String(row.id) === entry.movementId ? { ...row, voided: true, ...stamp, updatedAtIso: nowIso() } : row));
  } else movements = movements.map(row => (String(row.id) === String(id) ? { ...row, voided: true, ...stamp, updatedAtIso: nowIso() } : row));
  if (movements !== ctx.data.movements) writes.push([movementKey(), movements]);
  const refusal = recomputeRefusal({ store, movements });
  if (refusal) return refuse(refusal);
  try { commit(writes, t('audit.void', { job: ctx.job.no, reason: text }), { action: 'void', ref: ctx.job.no, branch: ctx.job.branch }); }
  catch (error) { return refuse(t('error.save', { message: error.message })); }
  return done(t('done.voided'));
}
function saveBudget({ jobKey, materials = 0, labourHours = 0, labour = 0, overhead = 0, other = 0 } = {}) {
  const ctx = jobContext(jobKey);
  if (ctx.error) return refuse(ctx.error);
  const values = { materials, labourHours, labour, overhead, other };
  for (const value of Object.values(values)) if (!(Number.isFinite(Number(value)) && Number(value) >= 0)) return refuse(t('error.amount'));
  let store;
  try { store = normalizeJobStore({ ...ctx.data.store, budgets: { ...ctx.data.store.budgets, [jobKey]: { ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Number(value)])), source: 'manual', sourceRef: '', updatedAt: nowIso() } } }); }
  catch (error) { return refuse(error.message); }
  try { commit([[JOB_COSTING_KEY, store]], t('audit.budget', { job: ctx.job.no }), { ref: ctx.job.no, branch: ctx.job.branch }); }
  catch (error) { return refuse(t('error.save', { message: error.message })); }
  return done(t('done.saved'));
}
// Settings: everything except the method is a plain save (rates apply to entries posted from now on; they are fixed
// on each entry). Opening costs recompute the whole history → refused while any stock period is closed.
function saveSettings(patch = {}) {
  const data = dataset();
  if (data.error) return refuse(data.error.message);
  let next;
  try { next = normalizeCostingSettings({ ...data.settings, ...patch, method: data.settings.method, methodHistory: data.settings.methodHistory, updatedAt: nowIso() }); }
  catch (error) { return refuse(error.message); }
  if (patch.openingCosts) {
    const refusal = recomputeRefusal({ settings: next });
    if (refusal) return refuse(refusal);
  }
  try { commit([[COSTING_SETTINGS_KEY, next]], t('audit.settings'), { ref: 'COSTING' }); }
  catch (error) { return refuse(t('error.save', { message: error.message })); }
  return done(t('done.saved'));
}
function changeMethod(change = {}) {
  const data = dataset();
  if (data.error) return refuse(data.error.message);
  const plan = planMethodChange(data.settings, change, { locked: data.locked, today: todayIso(), isLocked: date => BRANCH_IDS.some(branch => isLocked(branch, date, 'purchase') || isLocked(branch, date, 'sales')), at: nowIso(), by: actor() });
  if (!plan.ok) return refuse(t(`method.error.${plan.error}`));
  let next;
  try { next = normalizeCostingSettings({ ...plan.settings, updatedAt: nowIso() }); }
  catch (error) { return refuse(error.message); }
  const refusal = recomputeRefusal({ settings: next });
  if (refusal) return refuse(refusal);
  try { commit([[COSTING_SETTINGS_KEY, next]], t('audit.method', { method: t(`method.${next.method}`), ref: change.approvalRef || '—' }), { ref: 'COSTING' }); }
  catch (error) { return refuse(t('error.save', { message: error.message })); }
  return done(t('done.method'));
}
function refuse(message) {
  say(message, 'error', 7000);
  return { ok: false, message };
}
function done(message) {
  say(message, 'success');
  scheduleRender();
  return { ok: true, message };
}

// ---------------------------------------------------------------- views
function branchesOnScreen() {
  return liveBranchState(window).ids;
}
function branchFilterHtml(id, value) {
  const ids = branchesOnScreen();
  if (ids.length < 2) return '';
  const options = [`<option value="all"${value === 'all' ? ' selected' : ''}>${esc(t('filter.allBranches'))}</option>`].concat(ids.map(branch => `<option value="${esc(branch)}"${value === branch ? ' selected' : ''}>${esc(branchLabel(branch))}</option>`)).join('');
  return `<div><label for="${id}">${esc(t('filter.branch'))}</label><select id="${id}">${options}</select></div>`;
}
function tabButton(id) {
  const active = ui.tab === id;
  return `<button type="button" role="tab" id="jc-tab-${id}" class="afc-tab${active ? ' active' : ''}" data-jc-tab="${id}" aria-selected="${active}" aria-controls="jc-content" tabindex="${active ? 0 : -1}">${esc(t(`tab.${id}`))}</button>`;
}
function exportButtons(table) {
  return `<div class="afc-export" role="group" aria-label="${esc(t('export.group'))}"><button type="button" class="btn btn-secondary btn-sm" data-jc-export="xlsx" data-jc-table="${table}">${icon('download')}${esc(t('export.excel'))}</button><button type="button" class="btn btn-secondary btn-sm" data-jc-export="csv" data-jc-table="${table}">${icon('download')}${esc(t('export.csv'))}</button></div>`;
}
function methodBadge(data) {
  return `<span class="jc-method${data.locked ? ' jc-locked' : ''}">${icon(data.locked ? 'lock' : 'settings')}${esc(t('method.badge', { method: t(`method.${data.method}`) }))}${data.locked ? ` · ${esc(t('method.lockedShort'))}` : ''}</span>`;
}
function shellHtml(data) {
  return `<div class="afc-head jc-head"><div class="card-title"><span>${icon('factory')}${esc(t('page.title'))}</span>${methodBadge(data)}</div><p>${esc(t('page.intro'))}</p></div>
  <div class="afc-tabs" role="tablist" aria-label="${esc(t('page.tabs'))}">${TABS.map(tabButton).join('')}</div>
  <div id="jc-content" class="afc-content jc-content" role="tabpanel" aria-labelledby="jc-tab-${ui.tab}" tabindex="-1"></div>`;
}
function jobLabel(job) {
  return `<b data-no-i18n>${esc(job.no)}</b> <span data-no-i18n>${esc(job.name || '')}</span>`;
}
function statusBadge(sheet) {
  if (sheet.status === 'completed') return `<span class="afc-badge jc-badge-done">${esc(t(sheet.destination === 'finished_goods' ? 'status.toStock' : 'status.completed'))}</span>`;
  return `<span class="afc-badge jc-badge-open">${esc(t('status.open'))}</span>`;
}
// ---- tab: jobs
function buildJobsView(data) {
  const sheets = data.jobs.map(job => data.sheets.get(job.key)).filter(sheet => ui.branch === 'all' || sheet.job.branch === ui.branch);
  if (ui.jobKey && !data.sheets.has(ui.jobKey)) ui.jobKey = '';
  const selected = ui.jobKey ? data.sheets.get(ui.jobKey) : sheets[sheets.length - 1] || null;
  return { tab: 'jobs', sheets: sheets.slice().reverse(), selected };
}
function renderJobs(data) {
  const view = buildJobsView(data);
  current = view;
  if (!data.jobs.length) return `${emptyHtml(t('jobs.empty'))}`;
  const rows = view.sheets.map(sheet => {
    const job = sheet.job;
    const active = view.selected && view.selected.job.key === job.key;
    return `<tr${active ? ' class="jc-row-active"' : ''}><th scope="row">${jobLabel(job)}<small>${esc(displayDate(job.date, lang()))}${branchesOnScreen().length > 1 ? ` · ${esc(branchLabel(job.branch))}` : ''}</small></th><td>${userText(job.customer)}</td><td>${statusBadge(sheet)}</td><td class="num">${money(sheet.total)}</td><td class="num">${sheet.budget ? money(sheet.budget.total) : '—'}</td><td class="num">${sheet.revenue ? money(sheet.revenue) : '—'}</td><td class="num ${marginClass(sheet.margin)}">${sheet.profit === null ? '—' : money(sheet.profit)}</td><td class="num ${marginClass(sheet.margin)}">${pct(sheet.margin)}</td><td><button type="button" class="btn btn-secondary btn-sm" data-jc-open-job="${esc(job.key)}">${icon('table')}${esc(t('jobs.openSheet'))}</button></td></tr>`;
  }).join('');
  return `<div class="afc-controls">${branchFilterHtml('jc-branch', ui.branch)}</div>
  <section class="afc-card" aria-labelledby="jc-jobs-title"><div class="afc-card-head"><h3 id="jc-jobs-title">${esc(t('jobs.title'))}</h3>${exportButtons('jobs')}</div>
  <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('jobs.title'))}"><table class="afc-table jc-table"><thead><tr><th scope="col">${esc(t('jobs.job'))}</th><th scope="col">${esc(t('jobs.customer'))}</th><th scope="col">${esc(t('jobs.status'))}</th><th scope="col" class="num">${esc(t('jobs.cost'))}</th><th scope="col" class="num">${esc(t('jobs.budget'))}</th><th scope="col" class="num">${esc(t('jobs.revenue'))}</th><th scope="col" class="num">${esc(t('jobs.profit'))}</th><th scope="col" class="num">${esc(t('jobs.margin'))}</th><th scope="col"><span class="sr-only">${esc(t('jobs.openSheet'))}</span></th></tr></thead><tbody>${rows || `<tr><td colspan="9" class="afc-empty-cell">${esc(t('jobs.noneInBranch'))}</td></tr>`}</tbody></table></div>
  <p class="afc-note">${esc(t('jobs.note'))}</p></section>
  ${view.selected ? sheetHtml(data, view.selected) : ''}`;
}
function budgetCell(sheet, category) {
  const byCategory = sheet.budget?.byCategory;
  if (!byCategory) return '—';
  return money(byCategory[category]);
}
function varianceCell(sheet, category, actual) {
  const byCategory = sheet.budget?.byCategory;
  if (!byCategory) return '—';
  const diff = actual - byCategory[category];
  return `<span class="${diff > 0 ? 'jc-loss' : diff < 0 ? 'jc-good' : ''}">${diff > 0 ? '+' : ''}${money(diff)}</span>`;
}
function sheetHtml(data, sheet) {
  const job = sheet.job;
  const actual = { materials: sheet.materials.net, labour: sheet.labour.amount, overhead: sheet.overhead.amount, other: sheet.other.amount };
  const rows = COST_CATEGORIES.map(category => `<tr><th scope="row">${esc(t(`cat.${category}`))}${category === 'labour' || category === 'overhead' ? `<small>${esc(t('sheet.hours', { hours: qty(category === 'labour' ? sheet.labour.hoursQm : sheet.overhead.hoursQm) }))}</small>` : ''}</th><td class="num" data-label="${esc(t('sheet.budget'))}">${budgetCell(sheet, category)}</td><td class="num" data-label="${esc(t('sheet.actual'))}"><b>${money(actual[category])}</b></td><td class="num" data-label="${esc(t('sheet.variance'))}">${varianceCell(sheet, category, actual[category])}</td></tr>`).join('');
  const budgetTotal = sheet.budget ? money(sheet.budget.total) : '—';
  const totalDiff = sheet.budget ? sheet.total - sheet.budget.total : null;
  const budgetNote = sheet.budget ? t(`budget.source.${sheet.budget.source}`, { ref: sheet.budget.sourceRef || '—' }) : t('budget.none');
  const links = [job.sourceQuote ? t('sheet.fromQuote', { no: job.sourceQuote.no || job.sourceQuote.id }) : '', job.sourceSalesOrderNo ? t('sheet.fromSo', { no: job.sourceSalesOrderNo }) : '', job.legacy ? t('sheet.legacy') : ''].filter(Boolean).join(' · ');
  const margin = sheet.margin;
  const resultBox = sheet.status === 'completed'
    ? (sheet.destination === 'finished_goods'
      ? `<div class="afc-box afc-box-info">${esc(t('sheet.toStock', { unit: unitMoney(sheet.unitCost) }))}</div>`
      : `<div class="jc-result ${marginClass(margin)}"><div><small>${esc(t('sheet.revenue'))}</small><b>${money(sheet.revenue)}</b></div><div><small>${esc(t('sheet.cost'))}</small><b>${money(sheet.total)}</b></div><div><small>${esc(t('sheet.profit'))}</small><b>${sheet.profit === null ? '—' : money(sheet.profit)}</b></div><div><small>${esc(t('sheet.margin'))}</small><b>${pct(margin)}</b></div></div>${sheet.revenue ? '' : `<div class="afc-box afc-box-info">${esc(t('sheet.noRevenue'))}</div>`}`)
    : `<div class="afc-box afc-box-info">${esc(t('sheet.openNote', { revenue: money(sheet.revenue) }))}</div>`;
  const detailRows = [
    ...sheet.materials.issues.map(line => ({ date: line.date, what: `${t('detail.issue')} ${productNameOf(data, line.sku)}`, qm: line.qm, amount: line.value, id: line.movementId, negative: line.negative })),
    ...sheet.materials.returns.map(line => ({ date: line.date, what: `${t('detail.return')} ${productNameOf(data, line.sku)}`, qm: line.qm, amount: -line.value, id: line.movementId })),
    ...sheet.labour.entries.map(entry => ({ date: entry.date, what: t('detail.labour', { person: entry.person, rate: NUMBER_2.format(entry.rate), overhead: NUMBER_2.format(entry.overheadRate) }), qm: toQm(entry.hours), amount: entry.amountSatang + entry.overheadSatang, id: entry.id, user: entry.person })),
    ...sheet.other.entries.map(entry => ({ date: entry.date, what: `${t(`other.${entry.category}`)} — ${entry.description}`, qm: null, amount: entry.amountSatang, id: entry.id })),
    ...(sheet.completion ? [{ date: sheet.completion.date, what: t('detail.completion', { good: NUMBER_Q.format(sheet.completion.goodQty), scrap: NUMBER_Q.format(sheet.completion.scrapQty) }), qm: null, amount: null, id: sheet.completion.id }] : [])
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  // The void button's name is the row's date + amount (translated); the row's text (which may carry user data — product,
  // person, description) describes it through aria-describedby, so no user data sits in a translated attribute.
  const details = detailRows.map((row, index) => `<tr><td>${esc(displayDate(row.date, lang()))}</td><td data-no-i18n id="jc-detail-${index}">${esc(row.what)}${row.negative ? ` <span class="afc-badge jc-badge-warn">${esc(t('detail.negative'))}</span>` : ''}</td><td class="num">${row.qm === null ? '—' : qty(row.qm)}</td><td class="num">${row.amount === null ? '—' : money(row.amount)}</td><td><button type="button" class="btn btn-tertiary btn-sm jc-void" data-jc-void="${esc(row.id)}" data-jc-job="${esc(job.key)}" aria-label="${esc(t('detail.voidLabel', { what: `${displayDate(row.date, lang())}${row.amount === null ? '' : ` · ${money(row.amount)}`}` }))}" aria-describedby="jc-detail-${index}">${icon('cancel')}${esc(t('detail.void'))}</button></td></tr>`).join('');
  return `<section class="afc-card jc-sheet" id="jc-sheet" aria-labelledby="jc-sheet-title">
    <div class="afc-card-head"><h3 id="jc-sheet-title">${esc(t('sheet.title'))} · <span data-no-i18n>${esc(job.no)}</span></h3>${statusBadge(sheet)}</div>
    <dl class="jc-sheet-head"><div><dt>${esc(t('jobs.customer'))}</dt><dd data-no-i18n>${esc(job.customer || '—')}</dd></div><div><dt>${esc(t('jobs.job'))}</dt><dd data-no-i18n>${esc(job.name || '—')}</dd></div><div><dt>${esc(t('sheet.date'))}</dt><dd>${esc(displayDate(job.date, lang()))}</dd></div><div><dt>${esc(t('sheet.goodScrap'))}</dt><dd>${sheet.status === 'completed' ? `${qty(sheet.goodQm)} / ${qty(sheet.scrapQm)}` : '—'}</dd></div><div><dt>${esc(t('sheet.unitCost'))}</dt><dd>${unitMoney(sheet.unitCost)}</dd></div></dl>
    ${links ? `<p class="afc-note">${esc(links)}</p>` : ''}
    <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('sheet.title'))}"><table class="afc-table jc-sheet-table"><thead><tr><th scope="col">${esc(t('sheet.category'))}</th><th scope="col" class="num">${esc(t('sheet.budget'))}</th><th scope="col" class="num">${esc(t('sheet.actual'))}</th><th scope="col" class="num">${esc(t('sheet.variance'))}</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th scope="row">${esc(t('sheet.total'))}</th><td class="num" data-label="${esc(t('sheet.budget'))}">${budgetTotal}</td><td class="num" data-label="${esc(t('sheet.actual'))}"><b>${money(sheet.total)}</b></td><td class="num" data-label="${esc(t('sheet.variance'))}">${totalDiff === null ? '—' : `<span class="${totalDiff > 0 ? 'jc-loss' : 'jc-good'}">${totalDiff > 0 ? '+' : ''}${money(totalDiff)}</span>`}</td></tr></tfoot></table></div>
    <p class="afc-note">${esc(budgetNote)}</p>
    ${resultBox}
    ${entryFormsHtml(data, sheet)}
    <details class="jc-details"><summary>${esc(t('detail.title', { n: detailRows.length }))}</summary><div class="afc-scroll"><table class="afc-table"><thead><tr><th scope="col">${esc(t('detail.date'))}</th><th scope="col">${esc(t('detail.what'))}</th><th scope="col" class="num">${esc(t('detail.qty'))}</th><th scope="col" class="num">${esc(t('detail.amount'))}</th><th scope="col"><span class="sr-only">${esc(t('detail.void'))}</span></th></tr></thead><tbody>${details || `<tr><td colspan="5" class="afc-empty-cell">${esc(t('detail.none'))}</td></tr>`}</tbody></table></div></details>
  </section>`;
}
function stockOptions(data, selected = '') {
  return data.products.filter(isStockTrackedProduct).map(product => `<option value="${esc(product.code || product.name)}"${(product.code || product.name) === selected ? ' selected' : ''}>${esc(`${product.code ? `${product.code} · ` : ''}${product.name}`)}</option>`).join('');
}
function entryFormsHtml(data, sheet) {
  const job = sheet.job;
  const today = todayIso();
  if (sheet.status === 'completed') return `<div class="jc-forms"><p class="afc-note">${esc(t('form.completedNote'))}</p></div>`;
  const issueOptions = sheet.materials.issues.map(line => `<option value="${esc(line.movementId)}">${esc(`${displayDate(line.date, lang())} · ${productNameOf(data, line.sku)} · ${qty(line.qm)}`)}</option>`).join('');
  const people = (data.settings.personRates || []).map(row => `<option value="${esc(row.name)}"></option>`).join('');
  const rateNow = overheadRateBaht(data.settings);
  const field = (id, label, input) => `<div class="jc-field"><label for="${id}">${esc(label)}</label>${input}</div>`;
  const dateInput = id => `<input id="${id}" type="date" value="${esc(today)}" required>`;
  const budget = data.store.budgets[job.key] || {};
  return `<div class="jc-forms" data-jc-job-forms="${esc(job.key)}">
    <form class="jc-form" data-jc-form="issue" novalidate><h4>${icon('box')}${esc(t('form.issue'))}</h4>${field('jc-issue-product', t('form.product'), `<select id="jc-issue-product" data-no-i18n>${stockOptions(data)}</select>`)}${field('jc-issue-qty', t('form.qty'), '<input id="jc-issue-qty" type="number" inputmode="decimal" min="0" step="0.01" required>')}${field('jc-issue-date', t('form.date'), dateInput('jc-issue-date'))}<button type="submit" class="btn btn-primary">${icon('save')}${esc(t('form.saveIssue'))}</button></form>
    <form class="jc-form" data-jc-form="return" novalidate><h4>${icon('back')}${esc(t('form.return'))}</h4>${issueOptions ? `${field('jc-return-issue', t('form.fromIssue'), `<select id="jc-return-issue" data-no-i18n>${issueOptions}</select>`)}${field('jc-return-qty', t('form.qty'), '<input id="jc-return-qty" type="number" inputmode="decimal" min="0" step="0.01" required>')}${field('jc-return-date', t('form.date'), dateInput('jc-return-date'))}<button type="submit" class="btn btn-secondary">${icon('save')}${esc(t('form.saveReturn'))}</button>` : `<p class="afc-note">${esc(t('form.noIssues'))}</p>`}</form>
    <form class="jc-form" data-jc-form="labour" novalidate><h4>${icon('user')}${esc(t('form.labour'))}</h4>${field('jc-labour-person', t('form.person'), `<input id="jc-labour-person" list="jc-people" autocomplete="off" required><datalist id="jc-people" data-no-i18n>${people}</datalist>`)}${field('jc-labour-hours', t('form.hours'), '<input id="jc-labour-hours" type="number" inputmode="decimal" min="0" step="0.25" required>')}${field('jc-labour-date', t('form.date'), dateInput('jc-labour-date'))}<p class="afc-note">${esc(t('form.rates', { rate: NUMBER_2.format(Number(data.settings.labourRate || 0)), overhead: NUMBER_2.format(rateNow) }))}</p><button type="submit" class="btn btn-secondary">${icon('save')}${esc(t('form.saveLabour'))}</button></form>
    <form class="jc-form" data-jc-form="other" novalidate><h4>${icon('wallet')}${esc(t('form.other'))}</h4>${field('jc-other-category', t('form.category'), `<select id="jc-other-category">${OTHER_COST_CATEGORIES.map(id => `<option value="${id}">${esc(t(`other.${id}`))}</option>`).join('')}</select>`)}${field('jc-other-description', t('form.description'), '<input id="jc-other-description" autocomplete="off" required>')}${field('jc-other-amount', t('form.amount'), '<input id="jc-other-amount" type="number" inputmode="decimal" min="0" step="0.01" required>')}${field('jc-other-date', t('form.date'), dateInput('jc-other-date'))}<button type="submit" class="btn btn-secondary">${icon('save')}${esc(t('form.saveOther'))}</button></form>
    <form class="jc-form" data-jc-form="complete" novalidate><h4>${icon('check')}${esc(t('form.complete'))}</h4>${field('jc-complete-good', t('form.good'), `<input id="jc-complete-good" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(qmToQty(job.plannedQm) || '')}" required>`)}${field('jc-complete-scrap', t('form.scrap'), '<input id="jc-complete-scrap" type="number" inputmode="decimal" min="0" step="0.01" value="0">')}${field('jc-complete-destination', t('form.destination'), `<select id="jc-complete-destination">${COMPLETION_DESTINATIONS.map(id => `<option value="${id}">${esc(t(`destination.${id}`))}</option>`).join('')}</select>`)}${field('jc-complete-product', t('form.fgProduct'), `<select id="jc-complete-product" data-no-i18n><option value=""></option>${stockOptions(data)}</select>`)}${field('jc-complete-date', t('form.date'), dateInput('jc-complete-date'))}<button type="submit" class="btn btn-secondary">${icon('check')}${esc(t('form.saveComplete'))}</button></form>
    <form class="jc-form" data-jc-form="budget" novalidate><h4>${icon('table')}${esc(t('form.budget'))}</h4>${['materials', 'labour', 'overhead', 'other'].map(id => field(`jc-budget-${id}`, t(`cat.${id}`), `<input id="jc-budget-${id}" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(budget[id] ?? '')}">`)).join('')}${field('jc-budget-labourHours', t('form.budgetHours'), `<input id="jc-budget-labourHours" type="number" inputmode="decimal" min="0" step="0.25" value="${esc(budget.labourHours ?? '')}">`)}<button type="submit" class="btn btn-secondary">${icon('save')}${esc(t('form.saveBudget'))}</button></form>
  </div>`;
}
function emptyHtml(text) {
  return `<div class="afc-empty">${esc(text)}</div>`;
}
// ---- tab: profit
function periodMonths(data) {
  if (ui.periodType === 'all') return null;
  const last = lastClosedMonthKey(data.today);
  const periods = listPeriods(ui.periodType, data.firstMonth || last, currentMonthKey(data.today));
  if (!periods.some(row => row.value === ui.period)) ui.period = periods[0]?.value || '';
  return ui.period ? periodAllMonths({ type: ui.periodType, value: ui.period }) : [];
}
function buildProfitView(data) {
  const months = periodMonths(data);
  const report = profitReport(data.gp.lines, { dimension: ui.dimension, branch: ui.branch, months });
  return { tab: 'profit', months, report };
}
function dimensionLabel(dimension, line, data) {
  if (dimension === 'job') {
    const job = data.jobs.find(row => row.key === line.jobKey);
    return job ? `${job.no} ${job.name}`.trim() : line.jobKey;
  }
  if (dimension === 'customer') return line.customerKey === ANALYTICS_WALK_IN_KEY ? t('label.walkIn') : line.customerKey === UNKNOWN_CUSTOMER_KEY ? t('label.unknownCustomer') : line.customer;
  if (dimension === 'product') return line.productKey === ADJUSTMENT_PRODUCT_KEY ? t('label.adjustment') : line.productKey === UNKNOWN_PRODUCT_KEY ? t('label.unknownProduct') : `${line.productCode ? `${line.productCode} · ` : ''}${line.product}`;
  return monthLabel(line.period, lang());
}
function renderProfit(data) {
  const view = buildProfitView(data);
  current = view;
  const { report } = view;
  const total = report.total;
  const typeOptions = PERIOD_CHOICES.map(type => `<option value="${type}"${ui.periodType === type ? ' selected' : ''}>${esc(t(`period.${type}`))}</option>`).join('');
  const periods = ui.periodType === 'all' ? [] : listPeriods(ui.periodType, data.firstMonth || lastClosedMonthKey(data.today), currentMonthKey(data.today));
  const periodSelect = ui.periodType === 'all' ? '' : `<div><label for="jc-period">${esc(t('filter.period'))}</label><select id="jc-period">${periods.map(row => `<option value="${esc(row.value)}"${row.value === ui.period ? ' selected' : ''}>${esc(periodLabel(row, lang()))}</option>`).join('')}</select></div>`;
  const dimensionOptions = PROFIT_DIMENSIONS.map(id => `<option value="${id}"${ui.dimension === id ? ' selected' : ''}>${esc(t(`dimension.${id}`))}</option>`).join('');
  const label = row => (ui.dimension === 'month' ? esc(dimensionLabel('month', row.sample, data)) : userText(dimensionLabel(ui.dimension, row.sample, data)));
  // Round 12: "ยอดขายที่มีต้นทุน" next to sales, so every row (and the total) reads covered sales − cost = gross profit.
  const body = report.rows.map(row => `<tr><th scope="row">${label(row)}</th><td class="num">${money(row.sales)}</td><td class="num">${money(row.coveredSales)}</td><td class="num">${money(row.cost)}</td><td class="num ${marginClass(row.margin)}">${money(row.grossProfit)}</td><td class="num ${marginClass(row.margin)}">${pct(row.margin)}</td><td class="num">${pct(row.coverage)}</td></tr>`).join('');
  const coverageNote = total.coverage !== null && total.coverage < 99.995 ? `<div class="afc-box afc-box-info">${esc(t('profit.coverage', { pct: pct(total.coverage), uncovered: money(total.sales - total.coveredSales) }))}</div>` : '';
  return `<div class="afc-filters" role="group" aria-label="${esc(t('filter.group'))}">${branchFilterHtml('jc-branch', ui.branch)}<div><label for="jc-dimension">${esc(t('filter.dimension'))}</label><select id="jc-dimension">${dimensionOptions}</select></div><div><label for="jc-period-type">${esc(t('filter.periodType'))}</label><select id="jc-period-type">${typeOptions}</select></div>${periodSelect}</div>
  <section class="afc-card" aria-labelledby="jc-profit-title"><div class="afc-card-head"><h3 id="jc-profit-title">${esc(t(`profit.title.${ui.dimension}`))}</h3>${exportButtons('profit')}</div>
  <div class="afc-stats"><div class="afc-stat"><small>${esc(t('profit.sales'))}</small><b>${money(total.sales)}</b><span>${esc(t('profit.salesHint'))}</span></div><div class="afc-stat"><small>${esc(t('profit.cost'))}</small><b>${money(total.cost)}</b><span>${esc(t('profit.costHint'))}</span></div><div class="afc-stat ${marginClass(total.margin)}"><small>${esc(t('profit.gp'))}</small><b>${money(total.grossProfit)}</b><span>${esc(t('profit.margin', { pct: pct(total.margin) }))}</span></div><div class="afc-stat"><small>${esc(t('profit.coverageTitle'))}</small><b>${pct(total.coverage)}</b><span>${esc(t('profit.coverageHint'))}</span></div></div>
  ${coverageNote}
  <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t(`profit.title.${ui.dimension}`))}"><table class="afc-table jc-table"><thead><tr><th scope="col">${esc(t(`dimension.${ui.dimension}`))}</th><th scope="col" class="num">${esc(t('profit.sales'))}</th><th scope="col" class="num">${esc(t('profit.coveredSales'))}</th><th scope="col" class="num">${esc(t('profit.cost'))}</th><th scope="col" class="num">${esc(t('profit.gp'))}</th><th scope="col" class="num">${esc(t('profit.marginCol'))}</th><th scope="col" class="num">${esc(t('profit.coverageCol'))}</th></tr></thead><tbody>${body || `<tr><td colspan="7" class="afc-empty-cell">${esc(t('profit.none'))}</td></tr>`}</tbody><tfoot><tr><th scope="row">${esc(t('profit.total'))}</th><td class="num">${money(total.sales)}</td><td class="num">${money(total.coveredSales)}</td><td class="num">${money(total.cost)}</td><td class="num">${money(total.grossProfit)}</td><td class="num">${pct(total.margin)}</td><td class="num">${pct(total.coverage)}</td></tr></tfoot></table></div>
  <p class="afc-note">${esc(t('profit.note'))}</p></section>`;
}
// ---- tab: stock card
function stockProducts(data) {
  return data.products.filter(isStockTrackedProduct);
}
function buildStockView(data) {
  const products = stockProducts(data);
  const resolve = createProductResolver(products);
  let product = ui.stockSku ? resolve({ productCode: ui.stockSku, product: ui.stockSku }) : null;
  if (!product) product = products[0] || null;
  const from = isIsoDate(ui.stockFrom) ? ui.stockFrom : '';
  const to = isIsoDate(ui.stockTo) ? ui.stockTo : '';
  const card = product ? stockCard(data.costing, { sku: productSkuKey(product), branch: ui.stockBranch, from, to }) : null;
  return { tab: 'stock', product, from, to, card };
}
const KIND_KEYS = Object.freeze(['opening', 'receipt', 'receipt_reversal', 'adjust_in', 'adjust_out', 'transfer_in', 'transfer_out', 'sale', 'sale_return', 'job_issue', 'job_return', 'job_completion']);
function renderStock(data) {
  const view = buildStockView(data);
  current = view;
  if (!view.product) return emptyHtml(t('stock.noProducts'));
  const { card } = view;
  const rows = card.rows.map(row => `<tr${row.negative ? ' class="jc-row-warn"' : ''}><td>${esc(dateText(row.date))}</td><td>${esc(t(`kind.${row.kind}`))}${branchesOnScreen().length > 1 && ui.stockBranch === 'all' ? `<small>${esc(branchLabel(row.branch))}</small>` : ''}</td><td data-no-i18n>${esc(row.ref?.no || '')}</td><td class="num">${row.signedQm > 0 ? qty(row.qm) : ''}</td><td class="num">${row.signedQm < 0 ? qty(row.qm) : ''}</td><td class="num">${unitMoney(row.uc)}</td><td class="num">${money(row.value)}${row.correction ? `<small class="jc-loss">${esc(t('stock.correction', { amount: money(row.correction) }))}</small>` : ''}</td><td class="num">${qty(row.runQm)}</td><td class="num">${money(row.runValue)}</td><td>${row.negative ? `<span class="afc-badge jc-badge-warn">${esc(t('detail.negative'))}</span>` : ''}</td></tr>`).join('');
  return `<div class="afc-filters" role="group" aria-label="${esc(t('filter.group'))}"><div><label for="jc-stock-product">${esc(t('form.product'))}</label><select id="jc-stock-product" data-no-i18n>${stockOptions(data, view.product.code || view.product.name)}</select></div>${branchFilterHtml('jc-stock-branch', ui.stockBranch)}<div><label for="jc-stock-from">${esc(t('stock.from'))}</label><input id="jc-stock-from" type="date" value="${esc(view.from)}"></div><div><label for="jc-stock-to">${esc(t('stock.to'))}</label><input id="jc-stock-to" type="date" value="${esc(view.to)}"></div></div>
  <section class="afc-card" aria-labelledby="jc-stock-title"><div class="afc-card-head"><h3 id="jc-stock-title">${esc(t('stock.title'))} · <span data-no-i18n>${esc(view.product.name)}</span></h3>${exportButtons('stock')}</div>
  <div class="afc-stats"><div class="afc-stat"><small>${esc(t('stock.opening'))}</small><b>${qty(card.opening.qm)}</b><span>${money(card.opening.value)}</span></div><div class="afc-stat"><small>${esc(t('stock.in'))}</small><b>${qty(card.totals.inQm)}</b><span>${money(card.totals.inValue)}</span></div><div class="afc-stat"><small>${esc(t('stock.out'))}</small><b>${qty(card.totals.outQm)}</b><span>${money(card.totals.outValue)}</span></div><div class="afc-stat"><small>${esc(t('stock.closing'))}</small><b>${qty(card.closing.qm)}</b><span>${money(card.closing.value)}</span></div></div>
  <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('stock.title'))}"><table class="afc-table jc-table jc-stock-table"><thead><tr><th scope="col">${esc(t('detail.date'))}</th><th scope="col">${esc(t('stock.kind'))}</th><th scope="col">${esc(t('stock.ref'))}</th><th scope="col" class="num">${esc(t('stock.inQty'))}</th><th scope="col" class="num">${esc(t('stock.outQty'))}</th><th scope="col" class="num">${esc(t('stock.unitCost'))}</th><th scope="col" class="num">${esc(t('stock.value'))}</th><th scope="col" class="num">${esc(t('stock.balanceQty'))}</th><th scope="col" class="num">${esc(t('stock.balanceValue'))}</th><th scope="col"><span class="sr-only">${esc(t('stock.flag'))}</span></th></tr></thead><tbody><tr class="jc-row-opening"><td colspan="7">${esc(t('stock.openingRow'))}</td><td class="num">${qty(card.opening.qm)}</td><td class="num">${money(card.opening.value)}</td><td></td></tr>${rows}</tbody></table></div>
  <p class="afc-note">${esc(t('stock.note', { method: t(`method.${data.method}`) }))}</p></section>`;
}
// ---- tab: valuation + NRV
function buildValuationView(data) {
  const date = isIsoDate(ui.valuationDate) ? ui.valuationDate : data.today;
  const rows = valuationAt(data.costing, date, { branch: ui.branch });
  const merged = new Map();
  for (const row of rows) {
    const key = ui.branch === 'all' ? row.sku : `${row.sku}|${row.branch}`;
    const sum = merged.get(key) || { sku: row.sku, branch: ui.branch === 'all' ? 'all' : row.branch, qm: 0, value: 0 };
    sum.qm += row.qm;
    sum.value += row.value;
    merged.set(key, sum);
  }
  const valuation = [...merged.values()].map(row => ({ ...row, uc: row.qm > 0 ? unitCostOf(row.value, row.qm) : null }));
  const nrv = buildNrvReport(valuation, data.settings.nrv, data.products);
  return { tab: 'valuation', date, valuation, total: valuationTotal(valuation), nrv };
}
function productNameOf(data, sku) {
  const product = data.products.find(row => productSkuKey(row) === sku);
  return product ? `${product.code ? `${product.code} · ` : ''}${product.name}` : sku;
}
function renderValuation(data) {
  const view = buildValuationView(data);
  current = view;
  const rows = view.valuation.map(row => `<tr><th scope="row" data-no-i18n>${esc(productNameOf(data, row.sku))}</th><td class="num">${qty(row.qm)}</td><td class="num">${unitMoney(row.uc)}</td><td class="num">${money(row.value)}</td></tr>`).join('');
  const nrvRows = view.nrv.rows.map(row => `<tr${row.belowCost ? ' class="jc-row-warn"' : ''}><th scope="row" data-no-i18n>${esc(productNameOf(data, row.sku))}</th><td class="num">${qty(row.qm)}</td><td class="num">${money(row.cost)}</td><td class="num"><label class="sr-only" for="jc-nrv-price-${esc(row.sku)}">${esc(t('nrv.price'))}</label><input class="jc-nrv-input" id="jc-nrv-price-${esc(row.sku)}" data-jc-nrv-price="${esc(row.sku)}" type="number" inputmode="decimal" min="0" step="0.01" value="${esc((row.expectedPrice / 100).toFixed(2))}"><small>${esc(t(`nrv.source.${row.priceSource}`))}</small></td><td class="num"><label class="sr-only" for="jc-nrv-cost-${esc(row.sku)}">${esc(t('nrv.costToSell'))}</label><input class="jc-nrv-input" id="jc-nrv-cost-${esc(row.sku)}" data-jc-nrv-cost="${esc(row.sku)}" type="number" inputmode="decimal" min="0" step="0.01" value="${esc((row.costToSell / 100).toFixed(2))}"></td><td class="num">${money(row.nrvValue)}</td><td class="num ${row.writeDown ? 'jc-loss' : ''}">${row.writeDown ? money(row.writeDown) : '—'}</td></tr>`).join('');
  return `<div class="afc-filters" role="group" aria-label="${esc(t('filter.group'))}"><div><label for="jc-valuation-date">${esc(t('valuation.date'))}</label><input id="jc-valuation-date" type="date" value="${esc(view.date)}"></div>${branchFilterHtml('jc-branch', ui.branch)}</div>
  <section class="afc-card" aria-labelledby="jc-valuation-title"><div class="afc-card-head"><h3 id="jc-valuation-title">${esc(t('valuation.title', { date: displayDate(view.date, lang()) }))}</h3>${exportButtons('valuation')}</div>
  <div class="afc-stats"><div class="afc-stat"><small>${esc(t('valuation.total'))}</small><b>${money(view.total)}</b><span>${esc(t('valuation.method', { method: t(`method.${data.method}`) }))}</span></div><div class="afc-stat"><small>${esc(t('nrv.writeDown'))}</small><b class="${view.nrv.totals.writeDown ? 'jc-loss' : ''}">${money(view.nrv.totals.writeDown)}</b><span>${esc(t('nrv.lower', { amount: money(view.nrv.totals.lowerOfCostAndNrv) }))}</span></div></div>
  <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('valuation.titleShort'))}"><table class="afc-table jc-table"><thead><tr><th scope="col">${esc(t('form.product'))}</th><th scope="col" class="num">${esc(t('valuation.qty'))}</th><th scope="col" class="num">${esc(t('stock.unitCost'))}</th><th scope="col" class="num">${esc(t('valuation.value'))}</th></tr></thead><tbody>${rows || `<tr><td colspan="4" class="afc-empty-cell">${esc(t('valuation.none'))}</td></tr>`}</tbody><tfoot><tr><th scope="row">${esc(t('profit.total'))}</th><td></td><td></td><td class="num"><b>${money(view.total)}</b></td></tr></tfoot></table></div></section>
  <section class="afc-card" aria-labelledby="jc-nrv-title"><div class="afc-card-head"><h3 id="jc-nrv-title">${esc(t('nrv.title'))}</h3>${exportButtons('nrv')}</div>
  <p class="afc-note">${esc(t('nrv.intro'))}</p>
  ${view.nrv.missing.length ? `<div class="afc-box afc-box-warn">${esc(t('nrv.missing', { n: view.nrv.missing.length }))}</div>` : ''}
  <form data-jc-form="nrv" novalidate><div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('nrv.title'))}"><table class="afc-table jc-table jc-nrv-table"><thead><tr><th scope="col">${esc(t('form.product'))}</th><th scope="col" class="num">${esc(t('valuation.qty'))}</th><th scope="col" class="num">${esc(t('nrv.cost'))}</th><th scope="col" class="num">${esc(t('nrv.price'))}</th><th scope="col" class="num">${esc(t('nrv.costToSell'))}</th><th scope="col" class="num">${esc(t('nrv.value'))}</th><th scope="col" class="num">${esc(t('nrv.writeDownCol'))}</th></tr></thead><tbody>${nrvRows || `<tr><td colspan="7" class="afc-empty-cell">${esc(t('valuation.none'))}</td></tr>`}</tbody></table></div>
  <div class="jc-actions"><button type="submit" class="btn btn-secondary">${icon('save')}${esc(t('nrv.save'))}</button>${window.ERPJournal ? `<button type="button" class="btn btn-secondary" data-jc-nrv-post>${icon('table')}${esc(t('nrv.post'))}</button>` : ''}</div></form>
  <p class="afc-note">${esc(t('nrv.noPosting'))}</p></section>`;
}
// ---- tab: overhead
function buildOverheadView(data) {
  const end = currentMonthKey(data.today);
  const months = monthRange(addMonths(end, -5), end);
  const expenses = data.business.expenses || [];
  const report = overheadVarianceReport({ expenses, store: data.store, categories: data.settings.overheadCategories, months, branch: ui.branch });
  return { tab: 'overhead', months, report, rate: overheadRateSatang(data.settings.overhead) };
}
function renderOverhead(data) {
  const view = buildOverheadView(data);
  current = view;
  const est = data.settings.overhead;
  const rows = view.report.rows.map(row => `<tr><th scope="row">${esc(monthLabel(row.period, lang()))}</th><td class="num">${qty(row.hoursQm)}</td><td class="num">${money(row.applied)}</td><td class="num">${money(row.actual)}</td><td class="num ${row.variance < 0 ? 'jc-loss' : row.variance > 0 ? 'jc-good' : ''}">${money(row.variance)}</td><td>${esc(t(row.variance > 0 ? 'overhead.over' : row.variance < 0 ? 'overhead.under' : 'overhead.even'))}</td></tr>`).join('');
  const total = view.report.total;
  return `<div class="afc-controls">${branchFilterHtml('jc-branch', ui.branch)}</div>
  <section class="afc-card" aria-labelledby="jc-overhead-title"><div class="afc-card-head"><h3 id="jc-overhead-title">${esc(t('overhead.title'))}</h3>${exportButtons('overhead')}</div>
  <div class="jc-formula"><b>${esc(t('overhead.formula'))}</b><span>${esc(t('overhead.values', { overhead: money(toSatang(est.estimatedOverhead)), hours: NUMBER_Q.format(est.estimatedHours), rate: money(view.rate) }))}</span><small>${esc(t('overhead.source'))}</small></div>
  ${data.settings.overheadCategories.length ? `<p class="afc-note">${esc(t('overhead.categories'))} <span data-no-i18n>${esc(data.settings.overheadCategories.join(', '))}</span></p>` : `<div class="afc-box afc-box-warn">${esc(t('overhead.noCategories'))}</div>`}
  <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('overhead.title'))}"><table class="afc-table jc-table"><thead><tr><th scope="col">${esc(t('overhead.month'))}</th><th scope="col" class="num">${esc(t('overhead.hours'))}</th><th scope="col" class="num">${esc(t('overhead.applied'))}</th><th scope="col" class="num">${esc(t('overhead.actual'))}</th><th scope="col" class="num">${esc(t('overhead.variance'))}</th><th scope="col">${esc(t('overhead.meaning'))}</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th scope="row">${esc(t('profit.total'))}</th><td class="num">${qty(total.hoursQm)}</td><td class="num">${money(total.applied)}</td><td class="num">${money(total.actual)}</td><td class="num">${money(total.variance)}</td><td></td></tr></tfoot></table></div>
  <p class="afc-note">${esc(t('overhead.note'))}</p></section>`;
}
// ---- tab: settings
const EXPENSE_CATEGORIES = Object.freeze(['ค่าวัตถุดิบ', 'ค่าแรงงาน', 'ค่าสาธารณูปโภค', 'ค่าซ่อมบำรุง', 'ค่าเช่าสถานที่', 'ค่าน้ำมันเชื้อเพลิง', 'ค่าขนส่ง/จัดส่ง', 'ค่าอุปกรณ์สำนักงาน', 'อื่น ๆ']);
function renderSettings(data) {
  current = { tab: 'settings' };
  const s = data.settings;
  const methodRadios = COSTING_METHODS.map(id => `<label class="jc-radio"><input type="radio" name="jc-method" value="${id}"${data.method === id ? ' checked' : ''}><span>${esc(t(`method.${id}`))}</span></label>`).join('');
  const lockBox = data.locked
    ? `<div class="afc-box afc-box-warn jc-law"><b>${esc(t('method.lockedTitle'))}</b><p>${esc(t('method.law'))}</p></div>
       <div class="jc-form-grid"><div class="jc-field"><label for="jc-approval-ref">${esc(t('method.approvalRef'))}</label><input id="jc-approval-ref" autocomplete="off"></div><div class="jc-field"><label for="jc-approval-date">${esc(t('method.approvalDate'))}</label><input id="jc-approval-date" type="date"></div><div class="jc-field"><label for="jc-effective-from">${esc(t('method.effectiveFrom'))}</label><input id="jc-effective-from" type="date"></div><div class="jc-field"><label for="jc-method-note">${esc(t('method.note'))}</label><input id="jc-method-note" autocomplete="off"></div></div>`
    : `<p class="afc-note">${esc(t('method.unlocked'))}</p>`;
  const history = s.methodHistory.length > 1 ? `<ul class="jc-history">${s.methodHistory.slice(1).map(row => `<li>${esc(t('method.historyRow', { method: t(`method.${row.method}`), from: displayDate(row.effectiveFrom, lang()), ref: row.approvalRef, date: displayDate(row.approvalDate, lang()) }))}</li>`).join('')}</ul>` : '';
  const people = s.personRates.map((row, index) => `<div class="jc-person"><input aria-label="${esc(t('settings.personName'))}" data-jc-person-name="${index}" value="${esc(row.name)}" data-no-i18n><input aria-label="${esc(t('settings.personRate'))}" data-jc-person-rate="${index}" type="number" min="0" step="0.01" value="${esc(row.rate)}"></div>`).join('');
  const categories = [...new Set([...EXPENSE_CATEGORIES, ...s.overheadCategories, ...(data.business.expenses || []).map(row => String(row.cat || '').trim()).filter(Boolean)])].map(cat => `<label class="jc-check"><input type="checkbox" data-jc-overhead-cat="${esc(cat)}"${s.overheadCategories.includes(cat) ? ' checked' : ''}><span data-no-i18n>${esc(cat)}</span></label>`).join('');
  const opening = stockProducts(data).map(product => {
    const sku = productSkuKey(product);
    const value = Object.prototype.hasOwnProperty.call(s.openingCosts, sku) ? s.openingCosts[sku] : '';
    return `<tr><th scope="row" data-no-i18n>${esc(`${product.code ? `${product.code} · ` : ''}${product.name}`)}</th><td class="num">${esc(NUMBER_Q.format(Number(product.openingStockUbon ?? product.openingStock ?? 0) + Number(product.openingStockKhonkaen || 0)))}</td><td class="num"><label class="sr-only" for="jc-open-${esc(sku)}">${esc(t('settings.openingCost'))}</label><input class="jc-nrv-input" id="jc-open-${esc(sku)}" data-jc-opening="${esc(sku)}" type="number" min="0" step="0.0001" value="${esc(value)}" placeholder="${esc(NUMBER_2.format(Number(product.standardCost || 0)))}"></td></tr>`;
  }).join('');
  return `<section class="afc-card" aria-labelledby="jc-method-title"><div class="afc-card-head"><h3 id="jc-method-title">${esc(t('method.title'))}</h3></div>
    <form data-jc-form="method" novalidate><fieldset class="jc-radios"><legend>${esc(t('method.legend'))}</legend>${methodRadios}</fieldset><p class="afc-note">${esc(t('method.explain'))}</p>${lockBox}${history}<div class="jc-actions"><button type="submit" class="btn btn-secondary">${icon('save')}${esc(t(data.locked ? 'method.saveLocked' : 'method.save'))}</button></div></form></section>
  <section class="afc-card" aria-labelledby="jc-rates-title"><div class="afc-card-head"><h3 id="jc-rates-title">${esc(t('settings.ratesTitle'))}</h3></div>
    <form data-jc-form="rates" novalidate><div class="jc-form-grid"><div class="jc-field"><label for="jc-labour-rate">${esc(t('settings.labourRate'))}</label><input id="jc-labour-rate" type="number" min="0" step="0.01" value="${esc(s.labourRate)}"></div><div class="jc-field"><label for="jc-oh-estimate">${esc(t('settings.estimatedOverhead'))}</label><input id="jc-oh-estimate" type="number" min="0" step="0.01" value="${esc(s.overhead.estimatedOverhead)}"></div><div class="jc-field"><label for="jc-oh-hours">${esc(t('settings.estimatedHours'))}</label><input id="jc-oh-hours" type="number" min="0" step="0.25" value="${esc(s.overhead.estimatedHours)}"></div></div>
    <p class="afc-note">${esc(t('overhead.formula'))} = ${money(overheadRateSatang(s.overhead))} ${esc(t('settings.perHour'))}</p>
    <h4>${esc(t('settings.people'))}</h4><div class="jc-people">${people}<div class="jc-person"><input aria-label="${esc(t('settings.personName'))}" data-jc-person-name="new" placeholder="${esc(t('settings.newPerson'))}"><input aria-label="${esc(t('settings.personRate'))}" data-jc-person-rate="new" type="number" min="0" step="0.01"></div></div>
    <h4>${esc(t('settings.categories'))}</h4><div class="jc-checks">${categories}</div>
    <div class="jc-actions"><button type="submit" class="btn btn-secondary">${icon('save')}${esc(t('settings.save'))}</button></div></form></section>
  <section class="afc-card" aria-labelledby="jc-opening-title"><div class="afc-card-head"><h3 id="jc-opening-title">${esc(t('settings.openingTitle'))}</h3></div><p class="afc-note">${esc(t('settings.openingIntro'))}</p>
    <form data-jc-form="opening" novalidate><div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('settings.openingTitle'))}"><table class="afc-table jc-table"><thead><tr><th scope="col">${esc(t('form.product'))}</th><th scope="col" class="num">${esc(t('settings.openingQty'))}</th><th scope="col" class="num">${esc(t('settings.openingCost'))}</th></tr></thead><tbody>${opening || `<tr><td colspan="3" class="afc-empty-cell">${esc(t('stock.noProducts'))}</td></tr>`}</tbody></table></div><div class="jc-actions"><button type="submit" class="btn btn-secondary">${icon('save')}${esc(t('settings.saveOpening'))}</button></div></form></section>`;
}

// ---------------------------------------------------------------- exports
function exportTable(name) {
  const data = dataset();
  if (data.error || !current || current.tab !== (name === 'nrv' ? 'valuation' : name)) return null;
  const baht = satang => (satang === null || satang === undefined ? '' : Math.round(Number(satang)) / 100);
  const units = qm => (qm === null || qm === undefined ? '' : qmToQty(qm));
  const ucCell = uc => (uc === null || uc === undefined ? '' : ucToBaht(uc));
  if (name === 'jobs') {
    const header = [t('jobs.job'), t('jobs.name'), t('dimension.branch'), t('sheet.date'), t('jobs.customer'), t('jobs.status'), t('cat.materials'), t('cat.labour'), t('cat.overhead'), t('cat.other'), t('jobs.cost'), t('jobs.budget'), t('jobs.revenue'), t('jobs.profit'), t('jobs.margin')];
    const rows = current.sheets.map(sheet => [sheet.job.no, sheet.job.name, branchLabel(sheet.job.branch), sheet.job.date, sheet.job.customer, t(sheet.status === 'completed' ? 'status.completed' : 'status.open'), baht(sheet.materials.net), baht(sheet.labour.amount), baht(sheet.overhead.amount), baht(sheet.other.amount), baht(sheet.total), sheet.budget ? baht(sheet.budget.total) : '', baht(sheet.revenue), sheet.profit === null ? '' : baht(sheet.profit), sheet.margin === null ? '' : Math.round(sheet.margin * 10) / 10]);
    return { sheet: t('export.sheet.jobs'), file: `job-costs_${data.today}`, rows: [header, ...rows] };
  }
  if (name === 'profit') {
    const header = [t(`dimension.${ui.dimension}`), t('profit.sales'), t('profit.coveredSales'), t('profit.cost'), t('profit.gp'), t('profit.marginCol'), t('profit.coverageCol')];
    const rows = current.report.rows.map(row => [dimensionLabel(ui.dimension, row.sample, data), baht(row.sales), baht(row.coveredSales), baht(row.cost), baht(row.grossProfit), row.margin === null ? '' : Math.round(row.margin * 10) / 10, row.coverage === null ? '' : Math.round(row.coverage * 10) / 10]);
    const total = current.report.total;
    rows.push([t('profit.total'), baht(total.sales), baht(total.coveredSales), baht(total.cost), baht(total.grossProfit), total.margin === null ? '' : Math.round(total.margin * 10) / 10, total.coverage === null ? '' : Math.round(total.coverage * 10) / 10]);
    return { sheet: t('export.sheet.profit'), file: `profit-by-${ui.dimension}_${ui.period || 'all'}`, rows: [header, ...rows] };
  }
  if (name === 'stock') {
    const header = [t('detail.date'), t('stock.kind'), t('dimension.branch'), t('stock.ref'), t('stock.inQty'), t('stock.outQty'), t('stock.unitCost'), t('stock.value'), t('stock.correctionCol'), t('stock.balanceQty'), t('stock.balanceValue')];
    const rows = current.card.rows.map(row => [row.date || t('label.opening'), t(`kind.${row.kind}`), branchLabel(row.branch), row.ref?.no || '', row.signedQm > 0 ? units(row.qm) : '', row.signedQm < 0 ? units(row.qm) : '', ucCell(row.uc), baht(row.value), row.correction ? baht(row.correction) : '', units(row.runQm), baht(row.runValue)]);
    return { sheet: t('export.sheet.stock'), file: `stock-card_${current.product.code || 'product'}`, rows: [[t('form.product'), current.product.name], [t('stock.opening'), units(current.card.opening.qm), baht(current.card.opening.value)], header, ...rows], headerRows: 3 };
  }
  if (name === 'valuation') {
    const header = [t('export.code'), t('form.product'), t('valuation.qty'), t('stock.unitCost'), t('valuation.value')];
    const rows = current.valuation.map(row => [row.sku.replace(/^(code|name):/, ''), productNameOf(data, row.sku), units(row.qm), ucCell(row.uc), baht(row.value)]);
    rows.push([t('profit.total'), '', '', '', baht(current.total)]);
    return { sheet: t('export.sheet.valuation'), file: `stock-valuation_${current.date}`, rows: [[t('valuation.date'), current.date], header, ...rows], headerRows: 2 };
  }
  if (name === 'nrv') {
    const header = [t('export.code'), t('form.product'), t('valuation.qty'), t('nrv.cost'), t('nrv.price'), t('nrv.costToSell'), t('nrv.value'), t('nrv.writeDownCol'), t('nrv.priceSourceCol')];
    const rows = current.nrv.rows.map(row => [row.sku.replace(/^(code|name):/, ''), productNameOf(data, row.sku), units(row.qm), baht(row.cost), baht(row.expectedPrice), baht(row.costToSell), baht(row.nrvValue), baht(row.writeDown), t(`nrv.source.${row.priceSource}`)]);
    rows.push([t('profit.total'), '', '', baht(current.nrv.totals.cost), '', '', baht(current.nrv.totals.lowerOfCostAndNrv), baht(current.nrv.totals.writeDown), '']);
    return { sheet: t('export.sheet.nrv'), file: `nrv_${current.date}`, rows: [[t('valuation.date'), current.date], header, ...rows], headerRows: 2 };
  }
  if (name === 'overhead') {
    const header = [t('overhead.month'), t('overhead.hours'), t('overhead.applied'), t('overhead.actual'), t('overhead.variance')];
    const rows = current.report.rows.map(row => [row.period, units(row.hoursQm), baht(row.applied), baht(row.actual), baht(row.variance)]);
    return { sheet: t('export.sheet.overhead'), file: `overhead_${data.today}`, rows: [header, ...rows] };
  }
  return null;
}
function download(name, type, content) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
function exportCsv(name) {
  const table = exportTable(name);
  if (!table) { say(t('export.blocked'), 'error'); return null; }
  const content = taxCsvText(table.rows);
  download(`${table.file}.csv`, 'text/csv;charset=utf-8', content);
  return content;
}
function exportExcel(name) {
  const table = exportTable(name);
  if (!table) { say(t('export.blocked'), 'error'); return; }
  const run = () => {
    if (!window.XLSX) { say(t('export.excelMissing'), 'error'); return; }
    const book = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(book, window.XLSX.utils.aoa_to_sheet(table.rows), taxSafeSheetName(table.sheet, 'Costing'));
    window.XLSX.writeFile(book, `${table.file}.xlsx`);
  };
  if (window.XLSX) run();
  else if (typeof window.loadSheetJS === 'function') window.loadSheetJS(run);
  else say(t('export.excelMissing'), 'error');
}

// ---------------------------------------------------------------- summaries for other screens
// Gross profit of the analytics sales measure for some months (and a branch): only the sales that have a cost
// count in the margin; coverage = sales with a cost ÷ all sales (documents + extraSales, e.g. the demo history).
function grossProfitSummary({ months = null, branch = 'all', extraSales = 0 } = {}) {
  const data = dataset();
  if (data.error) return { error: data.error };
  const set = Array.isArray(months) ? new Set(months) : null;
  const lines = data.gp.lines.filter(line => (branch === 'all' || !branch || line.branch === branch) && (!set || set.has(line.period)));
  return { error: null, ...summarizeLines(lines, extraSales) };
}
function gpSummaryHtml(summary, scopeText) {
  if (!summary || summary.error) return '';
  if (!summary.coveredSales) return `<p class="afc-box afc-box-info jc-gp-note" data-jc-gp="none">${esc(t('gp.noCost'))}</p>`;
  return `<div class="afc-box afc-box-info jc-gp-note" data-jc-gp="known"><b>${esc(t('gp.title'))}</b> ${esc(t('gp.line', { gp: money(summary.grossProfit), margin: pct(summary.margin), covered: money(summary.coveredSales) }))} <span class="jc-coverage">${esc(t('gp.coverage', { pct: summary.coverage === null ? '—' : `${Math.round(summary.coverage)}%` }))}</span>${scopeText ? ` <small>${esc(scopeText)}</small>` : ''}</div>`;
}
function renderDashboardCard(host, { year, month, branch } = {}) {
  if (!host) return;
  const months = Number.isInteger(month) && month >= 0 ? [monthKey(year, month + 1)] : Array.from({ length: 12 }, (_, index) => monthKey(year, index + 1));
  const summary = grossProfitSummary({ months, branch: branch || 'all' });
  // No sales in the period (e.g. a new install) → nothing; a damaged costing store is said on the costing page itself.
  if (summary.error || !summary.sales) { host.innerHTML = ''; return; }
  host.innerHTML = gpSummaryHtml(summary, t('gp.dashboardScope'));
}
// The dashboard's month / year filter and branch tab (app.js renderDash) → the card under the KPIs.
function renderDashboardFromFilters() {
  const host = $('dash-gp');
  if (!host) return;
  const year = Number($('dash-year')?.value);
  const month = Number($('dash-month')?.value ?? -1);
  const tab = document.querySelector('.dash-tabs .dtab.active')?.id || 'dt-all';
  const branch = tab === 'dt-ub' ? 'ubon' : tab === 'dt-kk' ? 'khonkaen' : 'all';
  if (!Number.isInteger(year)) { host.innerHTML = ''; return; }
  renderDashboardCard(host, { year, month: Number.isInteger(month) && month >= 0 ? month : null, branch });
}
function openJobSheet(branch, id) {
  ui.tab = 'jobs';
  ui.jobKey = `${branch}|${id}`;
  ui.branch = 'all';
  window.go?.(PANEL_ID);
  render();
  $('jc-sheet')?.scrollIntoView?.({ block: 'start' });
  return current;
}
function openStockCard(code, branch = 'all') {
  ui.tab = 'stock';
  ui.stockSku = String(code || '');
  ui.stockBranch = BRANCH_IDS.includes(branch) ? branch : 'all';
  window.go?.(PANEL_ID);
  render();
  return current;
}

// ---------------------------------------------------------------- JSON backup (masterData.costing)
function exportBackup() {
  return { settings: readSettings(), jobs: readJobStore() };
}
function validateBackup(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(t('error.backup'));
  return { settings: normalizeCostingSettings(value.settings ?? null), jobs: normalizeJobStore(value.jobs ?? null) };
}
// Merge keeps this device's entries and adds the file's new ones (by id); replace takes the file. Settings: the file
// wins on replace or when this device has none.
function backupWrites(value, options = {}) {
  const incoming = validateBackup(value);
  if (!incoming) return [];
  const writes = [];
  const settingsRaw = localStorage.getItem(storageKey(COSTING_SETTINGS_KEY));
  if (options.replace || settingsRaw === null) writes.push([storageKey(COSTING_SETTINGS_KEY), incoming.settings]);
  const here = readJobStore();
  const jobs = options.replace ? incoming.jobs : normalizeJobStore({ schemaVersion: 1, entries: [...here.entries, ...incoming.jobs.entries.filter(entry => !here.entries.some(row => row.id === entry.id))], budgets: { ...incoming.jobs.budgets, ...here.budgets } });
  writes.push([storageKey(JOB_COSTING_KEY), jobs]);
  return writes;
}

// ---------------------------------------------------------------- render
function contentHtml(data) {
  if (ui.tab === 'profit') return renderProfit(data);
  if (ui.tab === 'stock') return renderStock(data);
  if (ui.tab === 'valuation') return renderValuation(data);
  if (ui.tab === 'overhead') return renderOverhead(data);
  if (ui.tab === 'settings') return renderSettings(data);
  return renderJobs(data);
}
function render() {
  const root = $(ROOT_ID);
  if (!root) return null;
  const data = dataset();
  if (data.error) { root.innerHTML = `<div class="afc-head"><div class="card-title"><span>${icon('factory')}${esc(t('page.title'))}</span></div></div>${errorHtml(data.error)}`; current = null; return null; }
  root.innerHTML = shellHtml(data);
  const host = $('jc-content');
  if (host) host.innerHTML = contentHtml(data);
  return current;
}
let queued = false;
function scheduleRender() {
  if (queued || !$(`panel-${PANEL_ID}`)?.classList.contains('active')) return;
  queued = true;
  setTimeout(() => { queued = false; try { render(); } catch (error) { console.error('[Costing] render failed', error); } }, 0);
}

// ---------------------------------------------------------------- events
const value = id => $(id)?.value ?? '';
function onSubmit(event) {
  const form = event.target.closest?.('[data-jc-form]');
  if (!form) return;
  event.preventDefault();
  const kind = form.dataset.jcForm;
  const jobKey = form.closest('[data-jc-job-forms]')?.dataset.jcJobForms || ui.jobKey || current?.selected?.job?.key || '';
  if (kind === 'issue') postMaterialIssue({ jobKey, productCode: value('jc-issue-product'), qty: value('jc-issue-qty'), date: value('jc-issue-date') });
  else if (kind === 'return') postMaterialReturn({ jobKey, issueMovementId: value('jc-return-issue'), qty: value('jc-return-qty'), date: value('jc-return-date') });
  else if (kind === 'labour') postLabour({ jobKey, person: value('jc-labour-person'), hours: value('jc-labour-hours'), date: value('jc-labour-date') });
  else if (kind === 'other') postOtherCost({ jobKey, category: value('jc-other-category'), description: value('jc-other-description'), amount: value('jc-other-amount'), date: value('jc-other-date') });
  else if (kind === 'complete') postCompletion({ jobKey, goodQty: value('jc-complete-good'), scrapQty: value('jc-complete-scrap') || 0, destination: value('jc-complete-destination'), productCode: value('jc-complete-product'), date: value('jc-complete-date') });
  else if (kind === 'budget') saveBudget({ jobKey, materials: value('jc-budget-materials') || 0, labour: value('jc-budget-labour') || 0, overhead: value('jc-budget-overhead') || 0, other: value('jc-budget-other') || 0, labourHours: value('jc-budget-labourHours') || 0 });
  else if (kind === 'nrv') {
    const nrv = {};
    form.querySelectorAll('[data-jc-nrv-price]').forEach(input => {
      const sku = input.dataset.jcNrvPrice;
      const cost = form.querySelector(`[data-jc-nrv-cost="${CSS.escape(sku)}"]`)?.value || 0;
      nrv[sku] = { expectedPrice: Number(input.value || 0), costToSell: Number(cost || 0) };
    });
    saveSettings({ nrv: { ...dataset().settings.nrv, ...nrv } });
  } else if (kind === 'rates') {
    const people = [];
    form.querySelectorAll('[data-jc-person-name]').forEach(input => {
      const name = String(input.value || '').trim();
      const rate = form.querySelector(`[data-jc-person-rate="${input.dataset.jcPersonName}"]`)?.value;
      if (name) people.push({ name, rate: Number(rate || 0) });
    });
    const categories = [...form.querySelectorAll('[data-jc-overhead-cat]')].filter(input => input.checked).map(input => input.dataset.jcOverheadCat);
    saveSettings({ labourRate: Number(value('jc-labour-rate') || 0), overhead: { estimatedOverhead: Number(value('jc-oh-estimate') || 0), estimatedHours: Number(value('jc-oh-hours') || 0) }, personRates: people, overheadCategories: categories });
  } else if (kind === 'opening') {
    const openingCosts = {};
    form.querySelectorAll('[data-jc-opening]').forEach(input => { if (String(input.value).trim() !== '') openingCosts[input.dataset.jcOpening] = Number(input.value); });
    saveSettings({ openingCosts });
  } else if (kind === 'method') {
    const method = form.querySelector('input[name="jc-method"]:checked')?.value || '';
    if (method === dataset().method) { say(t('method.error.same_method'), 'info'); return; }
    if (dataset().locked && !window.confirm(t('method.confirm'))) return;
    changeMethod({ method, approvalRef: value('jc-approval-ref'), approvalDate: value('jc-approval-date'), effectiveFrom: value('jc-effective-from'), note: value('jc-method-note') });
  }
}
function onClick(event) {
  const tab = event.target.closest?.('[data-jc-tab]');
  if (tab) { ui.tab = TABS.includes(tab.dataset.jcTab) ? tab.dataset.jcTab : 'jobs'; render(); $(`jc-tab-${ui.tab}`)?.focus(); return; }
  const open = event.target.closest?.('[data-jc-open-job]');
  if (open) { ui.jobKey = open.dataset.jcOpenJob; render(); $('jc-sheet')?.scrollIntoView?.({ block: 'start' }); $('jc-sheet-title')?.focus?.(); return; }
  const voidButton = event.target.closest?.('[data-jc-void]');
  if (voidButton) {
    const reason = window.prompt(t('detail.voidPrompt'));
    if (reason === null) return;
    voidCostEntry({ jobKey: voidButton.dataset.jcJob, id: voidButton.dataset.jcVoid, reason });
    return;
  }
  // ADR-029: the NRV write-down of the shown date and branch into the books (Dr loss / Cr allowance, erp-journal.js).
  if (event.target.closest?.('[data-jc-nrv-post]')) { window.ERPJournal?.postNrv?.({ date: current?.date || todayIso(), branch: ui.branch }); return; }
  const exportButton = event.target.closest?.('[data-jc-export]');
  if (exportButton) { if (exportButton.dataset.jcExport === 'csv') exportCsv(exportButton.dataset.jcTable); else exportExcel(exportButton.dataset.jcTable); }
}
function onKeydown(event) {
  const tab = event.target.closest?.('[data-jc-tab]');
  if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const index = TABS.indexOf(tab.dataset.jcTab);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
  ui.tab = TABS[next];
  render();
  $(`jc-tab-${ui.tab}`)?.focus();
}
function onChange(event) {
  const id = event.target?.id;
  const val = event.target?.value;
  if (id === 'jc-branch') ui.branch = val === 'all' || BRANCH_IDS.includes(val) ? val : 'all';
  else if (id === 'jc-dimension') ui.dimension = PROFIT_DIMENSIONS.includes(val) ? val : 'job';
  else if (id === 'jc-period-type') { ui.periodType = PERIOD_CHOICES.includes(val) ? val : 'all'; ui.period = ''; }
  else if (id === 'jc-period') ui.period = val;
  else if (id === 'jc-stock-product') ui.stockSku = val;
  else if (id === 'jc-stock-branch') ui.stockBranch = val === 'all' || BRANCH_IDS.includes(val) ? val : 'all';
  else if (id === 'jc-stock-from') ui.stockFrom = val;
  else if (id === 'jc-stock-to') ui.stockTo = val;
  else if (id === 'jc-valuation-date') ui.valuationDate = val;
  else return;
  render();
  $(id)?.focus();
}

window.ERPCosting = Object.freeze({
  VERSION: COSTING_CORE_VERSION,
  render,
  select: (options = {}) => {
    for (const [key, val] of Object.entries(options)) if (Object.prototype.hasOwnProperty.call(ui, key)) ui[key] = val;
    return render();
  },
  state: () => ({ ...ui }),
  view: () => current,
  dataset: () => dataset(),
  setToday: iso => { todayOverride = String(iso || ''); cached = null; },
  invalidate: () => { cached = null; },
  recomputeRefusal,
  computeWith: overrides => compute(overrides),
  invoiceRefusal,
  postMaterialIssue,
  postMaterialReturn,
  postLabour,
  postOtherCost,
  postCompletion,
  voidCostEntry,
  saveBudget,
  saveSettings,
  changeMethod,
  grossProfitSummary,
  gpSummaryHtml,
  renderDashboardCard,
  openJobSheet,
  openStockCard,
  exportRows: name => exportTable(name),
  exportCsv,
  exportExcel,
  exportBackup,
  validateBackup,
  backupWrites,
  t
});

function boot() {
  const root = $(ROOT_ID);
  window.addEventListener(STORAGE_WRITTEN_EVENT, () => { cached = null; scheduleRender(); });
  window.addEventListener(COMPANY_PROFILE_CHANGED_EVENT, scheduleRender);
  document.addEventListener('erp:dashboard-rendered', () => { try { renderDashboardFromFilters(); } catch (error) { console.error('[Costing] dashboard card failed', error); } });
  if (!root) return;
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('submit', onSubmit);
  root.addEventListener('keydown', onKeydown);
  document.addEventListener('erp:navigation', event => { if (event.detail?.id === PANEL_ID) { try { render(); } catch (error) { console.error('[Costing] render failed', error); } } });
  window.addEventListener('erp:language-changed', () => { if (!root.childElementCount) return; try { render(); } catch (error) { console.error('[Costing] render failed', error); } });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
