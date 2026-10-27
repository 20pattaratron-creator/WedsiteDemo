// ============================================================================
// erp-journal.js — page "สมุดบัญชีและปิดเดือน" (Books & month-end, ADR-029, round 12) + the chart-of-accounts card
// ERP DEMO 4.3.1
// ----------------------------------------------------------------------------
// Six tabs (simple mode): สมุดรายวันทั่วไป (every derived entry of a month) · บัญชีแยกประเภท (one account, running
// balance) · งบทดลอง (per month and branch) · ชุดปิดเดือน (integrity checks, the one-click multi-sheet Excel pack for the
// accountant, the general journal CSV / Excel, the PEAK import file through an editable column mapping, the overhead close
// and the NRV write-down) · บันทึกบัญชีด้วยมือ (manual entries, cancel-not-delete) · ยอดยกมา (opening stock / AR / AP from a
// CSV with a preview before anything is written).
// The numbers come from erp-journal-core.js (derived on every read from the documents and the costing engine); reads are
// strict (a damaged store or month is said, never shown as zeros). A red banner says when anything does not balance.
// Every journal-producing change here is refused BEFORE anything is written when its date — or any derived entry it would
// change — lies in a closed period (the same Thai text as every period lock). ตั้งค่าบริษัท gets the card "ผังบัญชีและการ
// ลงบัญชีอัตโนมัติ" (codes / names of the accounts, custom accounts, expense categories, posting defaults).
// Every text comes from i18n/en-journal.js (Thai and English); user data is escaped and marked data-no-i18n.
// ============================================================================
import { JOURNAL_CORE_VERSION, buildJournal, normalizeJournalSettings, normalizeJournalDocuments, defaultJournalSettings, emptyJournalDocuments, effectiveChart, validateChart, trialBalance, generalLedger, accountBalances, entriesInRange, periodRange, movement, openItems, wipByJob, sheetWipAsOf, numberEntries, consolidateCogs, parseCsv, planOpeningImport, openingCsvTemplate, planManualEntry, nextManualNo, planOverheadClose, planNrvEntry, lockedJournalChanges, monthOf, monthLastDay, SETTLEMENT_KINDS, deferredRevenueRows, DEFAULT_ACCOUNTS, EXPENSE_ROLES, DEFAULT_CATEGORY_ROLES, POSTING_CHOICES, PEAK_FIELDS, PEAK_DATE_FORMATS, DEFAULT_PEAK_COLUMNS, ACCOUNT_TYPES, categoryRole, addDays } from './erp-journal-core.js';
import { buildSalesTaxReport, buildPurchaseTaxReport, buildPp30Summary, taxReportTable, taxCsvText, taxSafeSheetName, parseVatReturnsStore, goodsReceiptVatOf, GR_TAX_TEXT } from './erp-tax-reports-core.js';
import { buildWhtFormReport, whtReportTable, parseWhtFilingsStore } from './erp-payer-wht-core.js';
import { valuationAt, valuationTotal, buildNrvReport, productSkuKey, isStockTrackedProduct, createProductResolver, normalizeCostingSettings, UNIT_COST_SCALE } from './erp-costing-core.js';
import { receivableAgingBucket } from './erp-receivables-core.js';
import { normalizeProductKey } from './erp-master-data-core.js';
import { createMasterDataStore } from './erp-master-data-store.js';
import { JOURNAL_KEYS } from './i18n/en-journal.js';
import { translateKey } from './erp-i18n-core.js';
import { escapeHtml, localDateISO, businessDaysBetween, effectiveTaxInvoiceForm } from './erp-shared-core.js';
import { liveBranchState, liveBranchLabel, liveBranchCode, BRANCH_IDS, HEAD_OFFICE_BRANCH_ID, savedProfileOf } from './erp-branches-core.js';
import { STORAGE_WRITTEN_EVENT, COMPANY_PROFILE_CHANGED_EVENT, JOURNAL_SETTINGS_KEY, JOURNAL_DOCUMENTS_KEY, PRODUCT_MASTER_KEY, COSTING_SETTINGS_KEY, VAT_RETURNS_KEY, WHT_FILINGS_KEY, FX_DOCUMENTS_KEY } from './erp-storage-contracts.js';
import { normalizeFxDocuments, buildPnd54Report } from './erp-fx-core.js';
import { taxExportValueOf } from './erp-tax-reports-core.js';
import { icon } from './erp-icons.js';

const PANEL_ID = 'accounting';
const ROOT_ID = 'acc-root';
const SETTINGS_PANEL_ID = 'saas-admin';
const WRAP_ID = 'acc-settings-cards';
const COA_CARD_ID = 'acc-coa-card';
const TABS = Object.freeze(['journal', 'ledger', 'trial', 'pack', 'manual', 'opening']);
const AGING_BUCKETS = Object.freeze(['current', '1_30', '31_60', '61_90', 'over_90', 'undated']);
const ui = { tab: 'journal', branch: 'all', period: '', account: '', manual: null, opening: null };
const $ = id => document.getElementById(id);
const esc = value => escapeHtml(String(value ?? ''));
const storageKey = base => window.ComformTenant?.storageKey?.(base) || base;
let todayOverride = '';
let cached = null;
let current = null;

// ---------------------------------------------------------------- language / formatting
const lang = () => (window.ERPI18n?.isEnglish?.() ? 'en' : 'th');
const t = (key, params = {}) => translateKey(JOURNAL_KEYS, lang(), key, params);
const NUMBER_2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MINUS = '−';
function money(satang) {
  if (satang === null || satang === undefined || !Number.isFinite(Number(satang))) return '—';
  const value = Number(satang) / 100;
  const sign = value < 0 && Math.abs(value) >= 0.005 ? MINUS : '';
  return `${sign}${lang() === 'en' ? 'THB ' : '฿'}${NUMBER_2.format(Math.abs(value))}`;
}
const amount = satang => (satang ? NUMBER_2.format(satang / 100) : '');
const baht = satang => Math.round(Number(satang) || 0) / 100;
const todayIso = () => todayOverride || localDateISO();
const say = (message, type = 'info', ms) => (typeof window.notify === 'function' ? window.notify(message, type, ms) : console.info('[Journal]', message));
const userText = value => `<span data-no-i18n>${esc(value)}</span>`;
const MONTHS_TH = Object.freeze(['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']);
const MONTHS_EN = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
function monthLabel(period) {
  const [year, month] = String(period).split('-').map(Number);
  if (!year || !month) return String(period || '');
  return lang() === 'en' ? `${MONTHS_EN[month - 1]} ${year}` : `${MONTHS_TH[month - 1]} ${year + 543}`;
}
function dateText(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return String(iso || '');
  const [year, month, day] = iso.split('-');
  return lang() === 'en' ? `${day}/${month}/${year}` : `${day}/${month}/${Number(year) + 543}`;
}
// The establishment's label (the company profile's own when set), in English through the dictionary when it has one.
function branchLabel(id) {
  const label = liveBranchLabel(id, undefined, window) || id;
  return lang() === 'en' ? window.ERPI18n?.phrase?.(label) || label : label;
}
function branchesOnScreen() {
  const ids = liveBranchState(window).ids;
  return Array.isArray(ids) && ids.length ? ids : [HEAD_OFFICE_BRANCH_ID];
}
function accountName(acct) {
  if (!acct) return '';
  if (acct.name) return acct.name;
  return lang() === 'en' ? acct.en : acct.th;
}
// The account cell: code + name; a name the company typed is user data (never translated).
function accountHtml(acct, id) {
  if (!acct) return `<span class="acc-code">?</span> ${esc(id)}`;
  const name = acct.name ? userText(acct.name) : esc(accountName(acct));
  return `<span class="acc-code">${esc(acct.code)}</span> ${name}`;
}
// The entry text: the translated description (with formatted dates / months), then the party and the memo (user data).
function describe(entry) {
  const params = { ...entry.descParams };
  if (params.period) params.period = monthLabel(params.period);
  if (params.date) params.date = dateText(params.date);
  if (entry.descKey === 'desc.reversal') params.text = t(params.original || 'desc.manual', { ...params, period: params.period });
  return t(entry.descKey, params);
}
function describeHtml(entry) {
  return `${esc(describe(entry))}${entry.party ? ` · ${userText(entry.party)}` : ''}${entry.memo ? ` · ${userText(entry.memo)}` : ''}`;
}
function describeText(entry) {
  return `${describe(entry)}${entry.party ? ` · ${entry.party}` : ''}${entry.memo ? ` · ${entry.memo}` : ''}`;
}

// ---------------------------------------------------------------- strict reads
function readRaw(base) {
  try { return localStorage.getItem(storageKey(base)); }
  catch (error) { throw Object.assign(new Error(t('error.storage')), { journal: true, cause: error }); }
}
const readSettings = () => normalizeJournalSettings(readRaw(JOURNAL_SETTINGS_KEY));
const readDocuments = () => normalizeJournalDocuments(readRaw(JOURNAL_DOCUMENTS_KEY));
function readArray(base) {
  const raw = readRaw(base);
  if (raw === null || raw === undefined) return [];
  let rows;
  try { rows = JSON.parse(raw); } catch (error) { throw Object.assign(new Error(t('error.store', { what: base })), { journal: true }); }
  if (!Array.isArray(rows)) throw Object.assign(new Error(t('error.store', { what: base })), { journal: true });
  return rows;
}
// Every document the journal is made of, read strictly (a damaged month stops the page: ERPIntegrity read error).
function gatherSources() {
  const integrity = window.ERPIntegrity;
  const packs = integrity.packs();
  const out = { packs, invoices: [], creditNotes: [], debitNotes: [], expenses: [], certificates: [] };
  for (const pack of packs) {
    const tag = row => ({ ...row, _branch: pack.branch, branch: pack.branch, _year: pack.year, _month: pack.month });
    for (const [collection, target] of [['invoices', 'invoices'], ['creditNotes', 'creditNotes'], ['debitNotes', 'debitNotes'], ['expenses', 'expenses'], ['whtCertificates', 'certificates']]) {
      for (const row of Array.isArray(pack.data[collection]) ? pack.data[collection] : []) if (row && typeof row === 'object') out[target].push(tag(row));
    }
  }
  const business = integrity.business();
  out.business = business;
  // Receipts: the stored receipts of each month (a printed copy without its source is not a second receipt).
  out.receipts = packs.flatMap(pack => (Array.isArray(pack.data.receipts) ? pack.data.receipts : []).filter(row => row && typeof row === 'object').map(row => ({ ...row, _branch: pack.branch, branch: pack.branch, _year: pack.year, _month: pack.month })));
  out.issuedOnly = business.invoices.filter(row => row._type === 'issuedInvoices');
  const store = integrity.flow();
  out.payments = Array.isArray(store.payments) ? store.payments : [];
  out.store = store;
  const grKey = window.ERPProductionCore?.KEYS?.goodsReceipts;
  out.goodsReceipts = grKey ? readArray(grKey) : [];
  // r13#LOW-4: the filed returns (strict — a damaged store stops the page like any other source).
  try { out.vatReturns = parseVatReturnsStore(readRaw(VAT_RETURNS_KEY)).returns; out.whtFilings = parseWhtFilingsStore(readRaw(WHT_FILINGS_KEY)).filings; }
  catch (error) { throw Object.assign(new Error(error?.message || t('error.storage')), { journal: true }); }
  // ADR-031: the foreign-currency month-end closes (revaluation + its reversal), strict like every other source.
  try { out.fxCloses = normalizeFxDocuments(readRaw(FX_DOCUMENTS_KEY)).closes; }
  catch (error) { throw Object.assign(new Error(error?.message || t('error.storage')), { journal: true }); }
  return out;
}

// ---------------------------------------------------------------- the computation
// overrides (for "what would this change do"): { settings, documents, costing: overrides for ERPCosting.computeWith }
function compute(overrides = {}) {
  const settings = overrides.settings || readSettings();
  const documents = overrides.documents || readDocuments();
  const src = gatherSources();
  const costing = overrides.costing ? window.ERPCosting.computeWith(overrides.costing) : window.ERPCosting?.dataset?.();
  if (!costing) throw Object.assign(new Error(t('error.notReady')), { journal: true });
  if (costing.error) throw costing.error;
  const integrity = window.ERPIntegrity;
  const context = integrity.paymentContext(src.business, src.store);
  const legacyPaid = invoice => !!integrity.paymentSummary(invoice, context).legacy;
  const journal = buildJournal({ ...src, costing: costing.costing, sheets: costing.sheets, jobEntries: costing.store.entries, settings, documents, options: { legacyPaid, today: todayIso() } });
  const chart = effectiveChart(settings);
  return { today: todayIso(), settings, documents, chart, journal, entries: journal.entries, flags: journal.flags, src, costing, error: null };
}
function dataset() {
  if (cached && cached.today === todayIso()) return cached;
  let out;
  try { out = compute(); }
  catch (error) {
    if (!error?.journal && error?.code !== 'journal_store' && error?.code !== 'journal_unbalanced' && !error?.costing && !window.ERPIntegrity?.isReadError?.(error)) throw error;
    out = { today: todayIso(), error };
  }
  cached = out;
  const drop = () => { if (cached === out) cached = null; };
  if (typeof queueMicrotask === 'function') queueMicrotask(drop); else Promise.resolve().then(drop);
  return out;
}
function errorHtml(error) {
  if (window.ERPIntegrity?.isReadError?.(error)) return window.ERPIntegrity.readErrorHtml(error);
  if (error?.code === 'journal_unbalanced') return `<div class="afc-box afc-box-error acc-integrity" role="alert"><b>${esc(t('integrity.unbalanced'))}</b> <span data-no-i18n>${esc(error.message)}</span></div>`;
  if (error?.code === 'journal_store') return `<div class="afc-box afc-box-error" role="alert"><b>${esc(t('error.storeDamaged'))}</b> <span data-no-i18n>${esc(error.message)}</span></div>`;
  return `<div class="afc-box afc-box-error" role="alert">${esc(error?.message || t('error.storage'))}</div>`;
}

// ---------------------------------------------------------------- period locks
// A journal-producing change is refused when any lock (sales, purchase or all) covers its branch and date.
function lockText(branch, date) {
  const gov = window.ERPGovernance;
  if (!gov?.periodLockRefusal) return '';
  return gov.periodLockRefusal({ scope: 'sales', branch, date, action: 'journal' }) || gov.periodLockRefusal({ scope: 'purchase', branch, date, action: 'journal' }) || '';
}
const isLocked = (branch, date) => !!lockText(branch, date);
// The derived journals before / after a change; refused (the lock text of the first changed entry) when an entry inside a
// closed period would change.
function journalGuard(overrides) {
  let before;
  let after;
  try { before = compute(); after = compute(overrides); }
  catch (error) { return error?.message || t('error.storage'); }
  const conflicts = lockedJournalChanges(before.entries, after.entries, isLocked);
  if (!conflicts.length) return '';
  return lockText(conflicts[0].branch, conflicts[0].date) || t('error.locked');
}

// ---------------------------------------------------------------- writes
const newId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const nowIso = () => new Date().toISOString();
const actor = () => window.CurrentUser?.displayName || window.CurrentUser?.email || 'Local user';
function commit(writes, auditText, meta = {}) {
  window.ERPIntegrity.transaction(writes.map(([base, value]) => [storageKey(base), value]));
  cached = null;
  window.ERPCosting?.invalidate?.();
  window.ERPIntegrity.changed?.();
  window.ERPProductionCore?.audit?.(meta.action || 'update', 'journal', meta.ref || '', auditText, { branch: meta.branch || '' });
}
function refuse(message) {
  say(message, 'error', 7000);
  return { ok: false, message };
}
function done(message, extra = {}) {
  say(message, 'success');
  scheduleRender();
  return { ok: true, message, ...extra };
}
function withDocuments(data, mutate) {
  const next = JSON.parse(JSON.stringify(data.documents));
  mutate(next);
  return normalizeJournalDocuments(next);
}
// ---- settings (chart of accounts, categories, posting defaults, PEAK mapping, export option)
function saveSettings(patch = {}) {
  const data = dataset();
  if (data.error) return refuse(data.error.message);
  let next;
  try { next = normalizeJournalSettings({ ...data.settings, ...patch, schemaVersion: 1, updatedAt: nowIso() }); }
  catch (error) { return refuse(t('error.settings', { detail: error.message })); }
  const chartErrors = validateChart(effectiveChart(next), usedAccounts(data, next));
  if (chartErrors.length) { const chart = effectiveChart(next); return refuse(chartErrors.map(error => chartErrorText(error, chart)).join(' · ')); }
  const lock = journalGuard({ settings: next });
  if (lock) return refuse(lock);
  try { commit([[JOURNAL_SETTINGS_KEY, next]], t('audit.settings'), { ref: 'JOURNAL' }); }
  catch (error) { return refuse(t('error.save', { message: error.message })); }
  renderCoaCard();
  return done(t('done.settings'));
}
// The accounts the journals use (the roles of every derived line + the custom accounts of manual entries).
function usedAccounts(data, settings = data.settings) {
  const used = new Set();
  for (const entry of data.entries || []) for (const line of entry.lines) used.add(line.account);
  for (const doc of data.documents?.manual || []) for (const line of doc.lines) used.add(line.account);
  for (const category of Object.keys(settings.categories || {})) used.add(settings.categories[category]);
  return used;
}
// The account of a chart error by its default / own name (the id when it is not in the chart at all).
function chartErrorText(error, chart) {
  const name = id => { const acct = chart?.get(id); return acct ? accountName(acct) : String(id || ''); };
  return t(`chart.error.${error.code}`, { account: name(error.account), other: name(error.other), code: error.accountCode || '' });
}
// ---- manual entries
function saveManual(draft = {}) {
  const data = dataset();
  if (data.error) return refuse(data.error.message);
  const plan = planManualEntry(draft, data.chart);
  if (!plan.ok) return refuse(t(`manual.error.${plan.error}`, { line: plan.line || '', debit: amount(plan.debit), credit: amount(plan.credit) }));
  const lock = lockText(draft.branch, draft.date);
  if (lock) return refuse(lock);
  const doc = { id: newId('jv'), no: nextManualNo(data.documents.manual, draft.date), date: draft.date, branch: draft.branch, memo: plan.memo, lines: plan.lines, status: 'posted', createdAt: nowIso(), createdBy: actor() };
  let documents;
  try { documents = withDocuments(data, next => { next.manual.push(doc); }); } catch (error) { return refuse(error.message); }
  const guard = journalGuard({ documents });
  if (guard) return refuse(guard);
  try { commit([[JOURNAL_DOCUMENTS_KEY, documents]], t('audit.manual', { no: doc.no, amount: amount(plan.total) }), { action: 'create', ref: doc.no, branch: doc.branch }); }
  catch (error) { return refuse(t('error.save', { message: error.message })); }
  ui.manual = null;
  return done(t('done.manual', { no: doc.no }), { no: doc.no, id: doc.id });
}
// Cancel (never delete) a journal document: refused when its own date or the cancel date is in a closed period; the
// reversal is dated today.
function voidDocument(collection, id, reason = '', branchOf = doc => doc.branch) {
  const data = dataset();
  if (data.error) return refuse(data.error.message);
  const textReason = String(reason || '').trim();
  if (!textReason) return refuse(t('error.reason'));
  const doc = data.documents[collection].find(row => row.id === id);
  if (!doc || doc.status !== 'posted') return refuse(t('error.docMissing'));
  if (collection === 'opening' && doc.kind === 'stock') return refuse(t('opening.stockNoCancel'));
  const branches = collection === 'opening' ? [...new Set(doc.rows.map(row => row.branch))] : [branchOf(doc)];
  const today = todayIso();
  for (const branch of branches) for (const date of [doc.date, today]) { const lock = lockText(branch, date); if (lock) return refuse(lock); }
  let documents;
  try { documents = withDocuments(data, next => { const row = next[collection].find(item => item.id === id); Object.assign(row, { status: 'voided', voidDate: today < doc.date ? doc.date : today, voidedAt: nowIso(), voidedBy: actor(), voidReason: textReason }); }); }
  catch (error) { return refuse(error.message); }
  const guard = journalGuard({ documents });
  if (guard) return refuse(guard);
  try { commit([[JOURNAL_DOCUMENTS_KEY, documents]], t('audit.void', { what: doc.no || doc.id, reason: textReason }), { action: 'void', ref: doc.no || doc.id, branch: branches[0] }); }
  catch (error) { return refuse(t('error.save', { message: error.message })); }
  return done(t('done.voided'));
}
// ---- overhead close (one click per month and branch)
function closeOverhead({ branch, period } = {}) {
  const data = dataset();
  if (data.error) return refuse(data.error.message);
  if (!BRANCH_IDS.includes(branch) || !/^\d{4}-\d{2}$/.test(String(period))) return refuse(t('error.period'));
  const date = monthLastDay(period);
  const lock = lockText(branch, date);
  if (lock) return refuse(lock);
  const plan = planOverheadClose(data.entries, { branch, period, categories: data.costing.settings.overheadCategories, closes: data.documents.closes });
  if (!plan.ok) return refuse(t('close.nothing', { period: monthLabel(period), branch: branchLabel(branch) }));
  const doc = { id: newId('ohc'), date, branch, period, applied: plan.applied, actual: plan.actual, cogs: plan.cogs, status: 'posted', createdAt: nowIso(), createdBy: actor() };
  let documents;
  try { documents = withDocuments(data, next => { next.closes.push(doc); }); } catch (error) { return refuse(error.message); }
  const guard = journalGuard({ documents });
  if (guard) return refuse(guard);
  try { commit([[JOURNAL_DOCUMENTS_KEY, documents]], t('audit.close', { period: monthLabel(period), branch: branchLabel(branch), amount: amount(Math.abs(plan.cogs)) }), { action: 'create', ref: `OHC ${period}`, branch }); }
  catch (error) { return refuse(t('error.save', { message: error.message })); }
  return done(t('done.close', { period: monthLabel(period) }), { doc });
}
// ---- NRV write-down at a date (each branch of the scope): the allowance follows the costing page's NRV report
function nrvTarget(data, branch, date) {
  const rows = valuationAt(data.costing.costing, date, { branch });
  return buildNrvReport(rows, data.costing.settings.nrv, data.costing.products).totals.writeDown;
}
function postNrv({ date, branch = 'all' } = {}) {
  const data = dataset();
  if (data.error) return refuse(data.error.message);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return refuse(t('error.date'));
  const branches = branch === 'all' ? branchesOnScreen() : [branch];
  const docs = [];
  for (const id of branches) {
    if (!BRANCH_IDS.includes(id)) return refuse(t('error.branch'));
    const plan = planNrvEntry(data.entries, { branch: id, date, target: nrvTarget(data, id, date) });
    if (!plan.ok) continue;
    const lock = lockText(id, date);
    if (lock) return refuse(lock);
    // The products written down at the date (kept with the entry as its audit trail).
    const report = buildNrvReport(valuationAt(data.costing.costing, date, { branch: id }), data.costing.settings.nrv, data.costing.products);
    const rows = report.rows.filter(row => row.writeDown > 0).map(row => ({ sku: row.sku, writeDown: row.writeDown }));
    docs.push({ id: newId('nrv'), date, branch: id, target: plan.target, delta: plan.delta, rows, status: 'posted', createdAt: nowIso(), createdBy: actor() });
  }
  if (!docs.length) return refuse(t('nrv.nothing', { date: dateText(date) }));
  let documents;
  try { documents = withDocuments(data, next => { next.nrv.push(...docs); }); } catch (error) { return refuse(error.message); }
  const guard = journalGuard({ documents });
  if (guard) return refuse(guard);
  try { commit([[JOURNAL_DOCUMENTS_KEY, documents]], t('audit.nrv', { date: dateText(date), amount: amount(docs.reduce((sum, doc) => sum + doc.delta, 0)) }), { action: 'create', ref: `NRV ${date}`, branch: docs[0].branch }); }
  catch (error) { return refuse(t('error.save', { message: error.message })); }
  return done(t('done.nrv', { date: dateText(date) }), { docs });
}
// ---- opening balances (CSV → preview → commit)
function branchCodeMap() {
  const out = {};
  for (const id of branchesOnScreen()) out[liveBranchCode(id, window) || (id === HEAD_OFFICE_BRANCH_ID ? '00000' : '00001')] = id;
  return out;
}
function previewOpening(csvText, asOf, fileName = '') {
  const data = dataset();
  if (data.error) return refuse(data.error.message);
  let rows;
  try { rows = parseCsv(csvText); } catch (error) { return refuse(t('opening.error.csv')); }
  const products = data.costing.products;
  const resolve = createProductResolver(products);
  const plan = planOpeningImport(rows, { asOf, branchCodes: branchCodeMap(), resolveProduct: code => resolve({ productCode: code, product: code }), isStockProduct: isStockTrackedProduct });
  ui.opening = { plan, asOf, fileName };
  scheduleRender();
  return { ok: plan.ok, plan };
}
function commitOpening() {
  const data = dataset();
  if (data.error) return refuse(data.error.message);
  const pending = ui.opening;
  if (!pending?.plan?.ok) return refuse(t('opening.error.notReady'));
  const { plan, asOf } = pending;
  const today = todayIso();
  if (asOf > today) return refuse(t('opening.error.future'));
  // Locks first: the balance date of every branch in the file (sales lock for AR, purchase for AP, any for stock).
  for (const row of plan.rows) {
    const gov = window.ERPGovernance;
    const text = row.kind === 'ar' ? gov?.periodLockRefusal?.({ scope: 'sales', branch: row.branch, date: asOf, action: 'opening' }) : row.kind === 'ap' ? gov?.periodLockRefusal?.({ scope: 'purchase', branch: row.branch, date: asOf, action: 'opening' }) : lockText(row.branch, asOf);
    if (text) return refuse(text);
  }
  const stockRows = plan.rows.filter(row => row.kind === 'stock');
  const batches = [];
  for (const kind of ['ar', 'ap']) {
    const rows = plan.rows.filter(row => row.kind === kind);
    if (rows.length) batches.push({ id: newId(`open${kind}`), kind, date: asOf, rows: rows.map(row => ({ branch: row.branch, name: row.name, code: row.code, docNo: row.docNo, docDate: row.docDate, dueDate: row.dueDate, amount: row.amount })), total: rows.reduce((sum, row) => sum + row.amount, 0), status: 'posted', createdAt: nowIso(), createdBy: actor() });
  }
  if (stockRows.length) batches.push({ id: newId('openstock'), kind: 'stock', date: asOf, rows: stockRows.map(row => ({ branch: row.branch, code: row.product?.code || row.code, name: row.name, qtyMilli: row.qtyMilli, unitCost: row.unitCost })), total: 0, status: 'posted', createdAt: nowIso(), createdBy: actor() });
  let documents;
  try { documents = withDocuments(data, next => { next.opening.push(...batches); if (stockRows.length) next.openingDate = asOf; }); } catch (error) { return refuse(error.message); }
  const writes = [[JOURNAL_DOCUMENTS_KEY, documents]];
  let costingOverrides = null;
  if (stockRows.length) {
    // Opening stock = Product Master opening qty per branch × the opening cost of the costing settings (ADR-028).
    const store = createMasterDataStore({ keyResolver: storageKey });
    let stored;
    try { stored = store.readRows(PRODUCT_MASTER_KEY, { fallback: [] }); } catch (error) { return refuse(t('error.store', { what: PRODUCT_MASTER_KEY })); }
    const products = data.costing.products.map(product => ({ ...product }));
    const costingSettings = normalizeCostingSettings({ ...data.costing.settings });
    const openingCosts = { ...costingSettings.openingCosts };
    const nextStored = stored.map(row => ({ ...row }));
    // Each branch's opening quantity is written explicitly: openingStockUbon falls back to the legacy total openingStock
    // when it is missing (erp-master-data-core.js), so both fields are set and openingStock is their sum again.
    const applyQty = (target, field, qty) => {
      const ubon = Number(target.openingStockUbon ?? target.openingStock ?? 0) || 0;
      const khonkaen = Number(target.openingStockKhonkaen ?? 0) || 0;
      target.openingStockUbon = field === 'openingStockUbon' ? qty : ubon;
      target.openingStockKhonkaen = field === 'openingStockKhonkaen' ? qty : khonkaen;
      target.openingStock = target.openingStockUbon + target.openingStockKhonkaen;
    };
    for (const row of stockRows) {
      const product = row.product;
      const key = normalizeProductKey(product.code || product.name);
      const field = row.branch === 'khonkaen' ? 'openingStockKhonkaen' : 'openingStockUbon';
      const qty = row.qtyMilli / 1000;
      const merged = products.find(item => normalizeProductKey(item.code || item.name) === key);
      if (merged) applyQty(merged, field, qty);
      let storedRow = nextStored.find(item => normalizeProductKey(item.code || item.name) === key);
      if (!storedRow) { const { isSeed, ...copy } = product; storedRow = { ...copy }; nextStored.push(storedRow); }
      applyQty(storedRow, field, qty);
      storedRow.updatedAt = nowIso();
      openingCosts[productSkuKey(product)] = row.unitCost / 100;
    }
    const nextCosting = normalizeCostingSettings({ ...costingSettings, openingCosts, updatedAt: nowIso() });
    costingOverrides = { products, settings: nextCosting };
    const costingLock = window.ERPCosting?.recomputeRefusal?.(costingOverrides);
    if (costingLock) return refuse(costingLock);
    writes.push([PRODUCT_MASTER_KEY, nextStored], [COSTING_SETTINGS_KEY, nextCosting]);
  }
  const guard = journalGuard({ documents, ...(costingOverrides ? { costing: costingOverrides } : {}) });
  if (guard) return refuse(guard);
  try { commit(writes, t('audit.opening', { date: dateText(asOf), rows: plan.rows.length }), { action: 'import', ref: `OPENING ${asOf}`, branch: plan.rows[0]?.branch || '' }); }
  catch (error) { return refuse(t('error.save', { message: error.message })); }
  ui.opening = null;
  window.initProductMasterDatalist?.();
  window.renderMasterData?.();
  return done(t('done.opening', { rows: plan.rows.length }), { batches });
}

// ---------------------------------------------------------------- checks (the red banner and the pack's cover)
// Each check: { id, level: 'ok' | 'fail' (does not balance) | 'diff' (differs from a report; explained) | 'na', values }
function taxSources(data, branch, period) {
  const [year, month] = period.split('-').map(Number);
  const packOf = data.src.packs.find(pack => pack.branch === branch && pack.year === year && pack.month === month - 1)?.data || {};
  const expenses = data.src.expenses.filter(row => row._branch === branch);
  const invoiceLookup = (b, no) => data.src.invoices.find(row => row._branch === b && String(row.no || '').trim() === no && row.documentKind !== 'delivery-tax-invoice') || null;
  const sales = buildSalesTaxReport({ period, sources: [{ branch, invoices: packOf.invoices || [], creditNotes: packOf.creditNotes || [], debitNotes: Array.isArray(packOf.debitNotes) ? packOf.debitNotes : [] }], invoiceLookup, entryDate: () => '', serviceReceipts: data.src.receipts });
  const purchases = buildPurchaseTaxReport({ period, sources: [{ branch, expenses, goodsReceipts: data.src.goodsReceipts.filter(row => row && row.branch === branch) }], entryDate: () => '' });
  const pp30 = buildPp30Summary({ period, sales, purchases });
  const certificates = data.src.certificates.filter(row => row._branch === branch);
  const pnd3 = buildWhtFormReport({ period, form: 'PND3', certificates });
  const pnd53 = buildWhtFormReport({ period, form: 'PND53', certificates });
  // ADR-031: payments abroad (ภ.ง.ด.54) and the export value of goods in a currency (ป.132/2548, PP.30 lines 1–2 ≠ the
  // book revenue of the invoice day — the difference is explained, not an error).
  const pnd54 = buildPnd54Report({ period, sources: [{ branch, expenses }] });
  const exportDiff = (packOf.invoices || []).reduce((sum, invoice) => { const view = taxExportValueOf(invoice); return view.fixed && !invoice.voided && invoice.status !== 'cancelled' ? sum + toSat(view.fixed.thb) - toSat(invoice.subtotal) : sum; }, 0);
  return { sales, purchases, pp30, pnd3, pnd53, pnd54, exportDiff };
}
const toSat = value => Math.round(Number(value || 0) * 100);
function buildChecks(data, period, branch) {
  const { from, to } = periodRange(period);
  const filter = { from, to, branch };
  const checks = [];
  const add = (id, level, values = {}) => checks.push({ id, level, values });
  add('entries', 'ok', { n: data.entries.length });
  const tb = trialBalance(data.entries, filter, data.chart);
  add('trial', tb.balanced ? 'ok' : 'fail', { debit: tb.totals.debit, credit: tb.totals.credit });
  let ledgerOk = true;
  for (const row of tb.rows) {
    const ledger = generalLedger(data.entries, filter, data.chart, row.code);
    if (ledger.debit !== row.debit || ledger.credit !== row.credit || ledger.closing !== row.closing) ledgerOk = false;
  }
  add('ledgers', ledgerOk ? 'ok' : 'fail', { n: tb.rows.length });
  const balances = accountBalances(data.entries, { to, branch });
  const glOf = ids => ids.reduce((sum, id) => sum + (balances.get(id)?.closing || 0), 0);
  if (data.journal.openingDate && to < data.journal.openingDate) add('inventory', 'na', {});
  else {
    const valuation = valuationTotal(valuationAt(data.costing.costing, to, { branch }));
    add('inventory', glOf(['inventory']) === valuation ? 'ok' : 'fail', { gl: glOf(['inventory']), report: valuation });
  }
  const sheetWip = [...sheetWipAsOf(data.costing.sheets, to)].filter(([key]) => branch === 'all' || key.startsWith(`${branch}|`)).reduce((sum, [, value]) => sum + value, 0);
  add('wip', glOf(['wip']) === sheetWip ? 'ok' : 'fail', { gl: glOf(['wip']), report: sheetWip });
  if (branch === 'all') add('interBranch', glOf(['inter_branch']) === 0 ? 'ok' : 'fail', { gl: glOf(['inter_branch']) });
  const chartErrors = validateChart(data.chart, usedAccounts(data));
  add('chart', chartErrors.length ? 'fail' : 'ok', { n: chartErrors.length, text: chartErrors.map(error => chartErrorText(error, data.chart)).join(' · ') });
  // Ties to the tax reports, per establishment (ภ.พ.30 is filed per establishment).
  for (const id of branch === 'all' ? branchesOnScreen() : [branch]) {
    const tax = taxSources(data, id, period);
    const f = { from, to, branch: id, excludeKinds: SETTLEMENT_KINDS }; // r13#LOW-4: the settlement of a filed return is after the return
    const out = -movement(data.entries, ['output_vat'], f);
    const input = movement(data.entries, ['input_vat'], f);
    const sales = -movement(data.entries, ['sales_goods', 'sales_service', 'sales_returns', 'sales_debit'], f);
    const pnd3 = -movement(data.entries, ['wht_pnd3'], f);
    const pnd53 = -movement(data.entries, ['wht_pnd53'], f);
    const pnd54 = -movement(data.entries, ['wht_pnd54'], f);
    const tie = (key, gl, report, extra = {}) => add(key, gl === report ? 'ok' : 'diff', { gl, report, branch: id, ...extra });
    tie('outputVat', out, toSat(tax.pp30.lines[5]));
    tie('inputVat', input, toSat(tax.pp30.lines[7]));
    if (tax.exportDiff) tie('salesExport', sales + tax.exportDiff, toSat(tax.pp30.lines[1]), { diff: tax.exportDiff, books: sales });
    else tie('sales', sales, toSat(tax.pp30.lines[1]));
    tie('pnd3', pnd3, toSat(tax.pnd3.totals.taxWithheld));
    tie('pnd53', pnd53, toSat(tax.pnd53.totals.taxWithheld));
    if (pnd54 || tax.pnd54.rows.length) tie('pnd54', pnd54, toSat(tax.pnd54.totals.whtThb));
  }
  // AR in the books today = the AR report of the app (credit sales; cash sales are posted to cash when sold).
  const integrity = window.ERPIntegrity;
  const context = integrity.paymentContext(data.src.business, data.src.store);
  let reportAr = 0;
  for (const invoice of data.src.business.invoices) {
    if (!integrity.live(invoice) || invoice._type === 'issuedInvoices') continue;
    if (branch !== 'all' && invoice._branch !== branch) continue;
    if (effectiveTaxInvoiceForm(invoice) === 'abbreviated') continue; // a cash sale: posted to cash, never owed
    const summary = integrity.paymentSummary(invoice, context);
    reportAr += toSat(summary.outstanding) - toSat(summary.refundDue);
  }
  const bookAr = openItems(data.entries, 'ar', { to: todayIso(), branch }).reduce((sum, item) => sum + item.balance, 0);
  add('ar', bookAr === reportAr ? 'ok' : 'diff', { gl: bookAr, report: reportAr });
  const periodFlags = data.flags.filter(flag => (!flag.date || (flag.date >= from && flag.date <= to)) && (branch === 'all' || !flag.branch || flag.branch === branch));
  add('flags', periodFlags.length ? 'diff' : 'ok', { n: periodFlags.length });
  return { checks, failed: checks.filter(check => check.level === 'fail'), tb, flags: periodFlags };
}

// ---------------------------------------------------------------- views
function periodOptions(data) {
  const months = new Set();
  for (const entry of data.entries) months.add(monthOf(entry.date));
  months.add(monthOf(todayIso()));
  return [...months].filter(Boolean).sort().reverse();
}
function defaultPeriod(data) {
  const current = monthOf(todayIso());
  const [year, month] = current.split('-').map(Number);
  const previous = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
  const options = periodOptions(data);
  return options.includes(previous) ? previous : options[0] || current;
}
function filtersHtml(data, extra = '') {
  const branches = branchesOnScreen();
  const periods = periodOptions(data);
  if (!periods.includes(ui.period)) ui.period = defaultPeriod(data);
  const branchSelect = branches.length > 1 ? `<div><label for="acc-branch">${esc(t('filter.branch'))}</label><select id="acc-branch"><option value="all"${ui.branch === 'all' ? ' selected' : ''}>${esc(t('filter.allBranches'))}</option>${branches.map(id => `<option value="${esc(id)}"${ui.branch === id ? ' selected' : ''}>${esc(branchLabel(id))}</option>`).join('')}</select></div>` : '';
  return `<div class="afc-filters" role="group" aria-label="${esc(t('filter.group'))}">${branchSelect}<div><label for="acc-period">${esc(t('filter.period'))}</label><select id="acc-period">${periods.map(period => `<option value="${esc(period)}"${period === ui.period ? ' selected' : ''}>${esc(monthLabel(period))}</option>`).join('')}</select></div>${extra}</div>`;
}
function scope() {
  if (ui.branch !== 'all' && !branchesOnScreen().includes(ui.branch)) ui.branch = 'all';
  return branchesOnScreen().length > 1 ? ui.branch : HEAD_OFFICE_BRANCH_ID;
}
function exportButtons(table, formats = ['xlsx', 'csv']) {
  return `<div class="afc-export" role="group" aria-label="${esc(t('export.group'))}">${formats.map(format => `<button type="button" class="btn btn-secondary btn-sm" data-acc-export="${format}" data-acc-table="${table}">${icon('download')}${esc(t(`export.${format}`))}</button>`).join('')}</div>`;
}
function integrityBanner(result) {
  if (!result.failed.length) return '';
  return `<div class="afc-box afc-box-error acc-integrity" role="alert"><b>${esc(t('integrity.title'))}</b><ul>${result.failed.map(check => `<li>${esc(checkText(check))}</li>`).join('')}</ul></div>`;
}
function checkText(check) {
  const v = check.values;
  const params = { n: v.n ?? '', gl: money(v.gl), report: money(v.report), debit: money(v.debit), credit: money(v.credit), branch: v.branch ? branchLabel(v.branch) : '', text: v.text || '', diff: money(v.diff), books: money(v.books) };
  return t(`check.${check.id}.${check.level === 'na' ? 'na' : check.level === 'ok' ? 'ok' : 'bad'}`, params);
}
function flagText(flag, chart) {
  const params = flag.params || {};
  const acct = params.account ? chart?.get(params.account) : null;
  return t(`flag.${flag.code}`, { account: acct ? `${acct.code} ${accountName(acct)}` : params.account || '', category: params.category || '', invoiceNo: params.invoiceNo || '—', first: params.first ? dateText(params.first) : '', cancelDate: params.cancelDate ? dateText(params.cancelDate) : '—' });
}
function kindLabel(kind) {
  return t(`kind.${kind}`);
}
// ---- tab: general journal
function journalView(data) {
  const branch = scope();
  const { from, to } = periodRange(ui.period);
  const entries = entriesInRange(data.entries, { from, to, branch });
  const numbers = numberEntries(entries);
  const totals = entries.reduce((sum, entry) => { for (const line of entry.lines) { sum.debit += line.debit; sum.credit += line.credit; } return sum; }, { debit: 0, credit: 0 });
  return { tab: 'journal', branch, from, to, entries, numbers, totals };
}
function renderJournal(data) {
  const view = journalView(data);
  current = view;
  const checks = buildChecks(data, ui.period, view.branch);
  const rows = view.entries.map(entry => entry.lines.map((line, index) => `<tr${index === 0 ? ' class="acc-entry-first"' : ''}>${index === 0 ? `<td>${esc(dateText(entry.date))}</td><td><b>${esc(view.numbers.get(entry.id))}</b><small>${esc(kindLabel(entry.kind))}${entry.reversalOf ? ` · ${esc(t('label.reversal'))}` : ''}</small></td><td data-no-i18n>${esc(entry.docNo)}</td><td class="acc-desc">${describeHtml(entry)}${entry.flags.length ? `<small class="acc-flags">${entry.flags.map(code => `<span class="afc-badge jc-badge-warn">${esc(t(`flagShort.${code}`))}</span>`).join(' ')}</small>` : ''}</td>` : '<td></td><td></td><td></td><td></td>'}<td>${accountHtml(data.chart.get(line.account), line.account)}${view.branch === 'all' && branchesOnScreen().length > 1 ? `<small>${esc(branchLabel(line.branch))}</small>` : ''}</td><td class="num">${amount(line.debit)}</td><td class="num">${amount(line.credit)}</td></tr>`).join('')).join('');
  return `${filtersHtml(data)}${integrityBanner(checks)}
  <section class="afc-card" aria-labelledby="acc-journal-title"><div class="afc-card-head"><h3 id="acc-journal-title">${esc(t('journal.title', { period: monthLabel(ui.period) }))}</h3>${exportButtons('journal')}</div>
  <div class="afc-stats"><div class="afc-stat"><small>${esc(t('journal.entries'))}</small><b>${view.entries.length}</b></div><div class="afc-stat"><small>${esc(t('journal.debit'))}</small><b>${money(view.totals.debit)}</b></div><div class="afc-stat"><small>${esc(t('journal.credit'))}</small><b>${money(view.totals.credit)}</b></div><div class="afc-stat ${view.totals.debit === view.totals.credit ? 'jc-good' : 'jc-loss'}"><small>${esc(t('journal.balance'))}</small><b>${esc(t(view.totals.debit === view.totals.credit ? 'journal.balanced' : 'journal.unbalanced'))}</b></div></div>
  <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('journal.titleShort'))}"><table class="afc-table acc-table acc-journal-table"><thead><tr><th scope="col">${esc(t('col.date'))}</th><th scope="col">${esc(t('col.entryNo'))}</th><th scope="col">${esc(t('col.docNo'))}</th><th scope="col">${esc(t('col.description'))}</th><th scope="col">${esc(t('col.account'))}</th><th scope="col" class="num">${esc(t('col.debit'))}</th><th scope="col" class="num">${esc(t('col.credit'))}</th></tr></thead><tbody>${rows || `<tr><td colspan="7" class="afc-empty-cell">${esc(t('journal.none'))}</td></tr>`}</tbody><tfoot><tr><th scope="row" colspan="5">${esc(t('col.total'))}</th><td class="num">${amount(view.totals.debit)}</td><td class="num">${amount(view.totals.credit)}</td></tr></tfoot></table></div>
  <p class="afc-note">${esc(t('journal.note'))}</p></section>`;
}
// ---- tab: ledger
function ledgerView(data) {
  const branch = scope();
  const { from, to } = periodRange(ui.period);
  const tb = trialBalance(data.entries, { from, to, branch }, data.chart);
  const codes = [...new Set([...data.chart.values()].map(acct => acct.code))].sort();
  if (!codes.includes(ui.account)) ui.account = tb.rows.find(row => row.debit || row.credit)?.code || codes[0] || '';
  const ledger = generalLedger(data.entries, { from, to, branch }, data.chart, ui.account);
  const numbers = numberEntries(entriesInRange(data.entries, { from, to, branch }));
  return { tab: 'ledger', branch, from, to, codes, ledger, numbers };
}
function accountByCode(data, code) {
  return [...data.chart.values()].find(acct => acct.code === code) || null;
}
function renderLedger(data) {
  const view = ledgerView(data);
  current = view;
  const select = `<div><label for="acc-account">${esc(t('filter.account'))}</label><select id="acc-account">${view.codes.map(code => { const acct = accountByCode(data, code); return `<option value="${esc(code)}"${code === ui.account ? ' selected' : ''}>${esc(code)} ${esc(accountName(acct))}</option>`; }).join('')}</select></div>`;
  const acct = accountByCode(data, ui.account);
  const rows = view.ledger.rows.map(row => `<tr><td>${esc(dateText(row.entry.date))}</td><td>${esc(view.numbers.get(row.entry.id) || '')}</td><td data-no-i18n>${esc(row.entry.docNo)}</td><td class="acc-desc">${describeHtml(row.entry)}</td><td class="num">${amount(row.line.debit)}</td><td class="num">${amount(row.line.credit)}</td><td class="num">${money(row.balance)}</td></tr>`).join('');
  return `${filtersHtml(data, select)}
  <section class="afc-card" aria-labelledby="acc-ledger-title"><div class="afc-card-head"><h3 id="acc-ledger-title">${esc(t('ledger.title'))} · ${accountHtml(acct, ui.account)}</h3>${exportButtons('ledger')}</div>
  <div class="afc-stats"><div class="afc-stat"><small>${esc(t('ledger.opening'))}</small><b>${money(view.ledger.opening)}</b></div><div class="afc-stat"><small>${esc(t('col.debit'))}</small><b>${money(view.ledger.debit)}</b></div><div class="afc-stat"><small>${esc(t('col.credit'))}</small><b>${money(view.ledger.credit)}</b></div><div class="afc-stat"><small>${esc(t('ledger.closing'))}</small><b>${money(view.ledger.closing)}</b></div></div>
  <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('ledger.title'))}"><table class="afc-table acc-table"><thead><tr><th scope="col">${esc(t('col.date'))}</th><th scope="col">${esc(t('col.entryNo'))}</th><th scope="col">${esc(t('col.docNo'))}</th><th scope="col">${esc(t('col.description'))}</th><th scope="col" class="num">${esc(t('col.debit'))}</th><th scope="col" class="num">${esc(t('col.credit'))}</th><th scope="col" class="num">${esc(t('col.balance'))}</th></tr></thead><tbody><tr class="jc-row-opening"><td colspan="6">${esc(t('ledger.openingRow'))}</td><td class="num">${money(view.ledger.opening)}</td></tr>${rows || `<tr><td colspan="7" class="afc-empty-cell">${esc(t('ledger.none'))}</td></tr>`}</tbody><tfoot><tr><th scope="row" colspan="4">${esc(t('ledger.closing'))}</th><td class="num">${amount(view.ledger.debit)}</td><td class="num">${amount(view.ledger.credit)}</td><td class="num">${money(view.ledger.closing)}</td></tr></tfoot></table></div>
  <p class="afc-note">${esc(t('ledger.note'))}</p></section>`;
}
// ---- tab: trial balance
const side = value => ({ debit: value > 0 ? value : 0, credit: value < 0 ? -value : 0 });
function renderTrial(data) {
  const branch = scope();
  const { from, to } = periodRange(ui.period);
  const checks = buildChecks(data, ui.period, branch);
  const tb = checks.tb;
  current = { tab: 'trial', branch, from, to, tb };
  const rows = tb.rows.map(row => { const acct = accountByCode(data, row.code); const o = side(row.opening); const c = side(row.closing); return `<tr><th scope="row"><button type="button" class="afc-linklike" data-acc-ledger="${esc(row.code)}">${accountHtml(acct, row.ids.join(','))}</button></th><td class="num">${amount(o.debit)}</td><td class="num">${amount(o.credit)}</td><td class="num">${amount(row.debit)}</td><td class="num">${amount(row.credit)}</td><td class="num">${amount(c.debit)}</td><td class="num">${amount(c.credit)}</td></tr>`; }).join('');
  const total = tb.totals;
  return `${filtersHtml(data)}${integrityBanner(checks)}
  <section class="afc-card" aria-labelledby="acc-trial-title"><div class="afc-card-head"><h3 id="acc-trial-title">${esc(t('trial.title', { period: monthLabel(ui.period) }))} <span class="afc-badge ${tb.balanced ? 'jc-badge-done' : 'jc-badge-warn'}">${esc(t(tb.balanced ? 'trial.balanced' : 'trial.unbalanced'))}</span></h3>${exportButtons('trial')}</div>
  <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('trial.titleShort'))}"><table class="afc-table acc-table acc-trial-table"><thead><tr><th scope="col" rowspan="2">${esc(t('col.account'))}</th><th scope="colgroup" colspan="2" class="num">${esc(t('trial.opening'))}</th><th scope="colgroup" colspan="2" class="num">${esc(t('trial.movement'))}</th><th scope="colgroup" colspan="2" class="num">${esc(t('trial.closing'))}</th></tr><tr>${['debit', 'credit', 'debit', 'credit', 'debit', 'credit'].map(key => `<th scope="col" class="num">${esc(t(`col.${key}`))}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="7" class="afc-empty-cell">${esc(t('journal.none'))}</td></tr>`}</tbody><tfoot><tr><th scope="row">${esc(t('col.total'))}</th><td class="num">${amount(total.openingDebit)}</td><td class="num">${amount(total.openingCredit)}</td><td class="num">${amount(total.debit)}</td><td class="num">${amount(total.credit)}</td><td class="num">${amount(total.closingDebit)}</td><td class="num">${amount(total.closingCredit)}</td></tr></tfoot></table></div>
  <p class="afc-note">${esc(t('trial.note'))}</p></section>`;
}
// ---- tab: month-end pack
function closePreview(data, branch) {
  return planOverheadClose(data.entries, { branch, period: ui.period, categories: data.costing.settings.overheadCategories, closes: data.documents.closes });
}
function renderPack(data) {
  const branch = scope();
  const checks = buildChecks(data, ui.period, branch);
  current = { tab: 'pack', branch, checks };
  const followBox = () => { const rows = followUps(data, branch, ui.period); return rows.length ? `<div class="afc-box afc-box-warn" role="note" data-acc-follow><b>${esc(t('follow.title'))}</b><ul>${rows.map(row => `<li data-follow="${esc(row.key)}">${esc(row.text)}</li>`).join('')}</ul></div>` : ''; };
  const icons = { ok: '✓', fail: '✗', diff: '!', na: '–' };
  const checkRows = checks.checks.map(check => `<li class="acc-check acc-check-${check.level}"><span class="acc-check-mark" aria-hidden="true">${icons[check.level]}</span><span>${esc(checkText(check))}</span></li>`).join('');
  const peak = data.settings.peak;
  const peakRows = peak.columns.map((column, index) => `<tr><td><label class="sr-only" for="acc-peak-h-${index}">${esc(t('peak.header'))}</label><input id="acc-peak-h-${index}" data-acc-peak-header="${index}" value="${esc(column.header)}" data-no-i18n></td><td><label class="sr-only" for="acc-peak-f-${index}">${esc(t('peak.field'))}</label><select id="acc-peak-f-${index}" data-acc-peak-field="${index}">${PEAK_FIELDS.map(field => `<option value="${field}"${field === column.field ? ' selected' : ''}>${esc(t(`peakField.${field}`))}</option>`).join('')}</select></td><td class="acc-peak-actions"><button type="button" class="btn btn-tertiary btn-sm" data-acc-peak-move="${index}:-1" aria-label="${esc(t('peak.up', { n: index + 1 }))}"${index === 0 ? ' disabled' : ''}>↑</button><button type="button" class="btn btn-tertiary btn-sm" data-acc-peak-move="${index}:1" aria-label="${esc(t('peak.down', { n: index + 1 }))}"${index === peak.columns.length - 1 ? ' disabled' : ''}>↓</button><button type="button" class="btn btn-tertiary btn-sm" data-acc-peak-remove="${index}" aria-label="${esc(t('peak.remove', { n: index + 1 }))}"${peak.columns.length < 2 ? ' disabled' : ''}>${icon('trash')}</button></td></tr>`).join('');
  const closeBranches = branch === 'all' ? branchesOnScreen() : [branch];
  const closeRows = closeBranches.map(id => {
    const plan = closePreview(data, id);
    const applied = plan.ok ? plan.applied : 0;
    const actual = plan.ok ? Object.values(plan.actual).reduce((sum, value) => sum + value, 0) : 0;
    return `<tr><th scope="row">${esc(branchLabel(id))}</th><td class="num">${money(applied)}</td><td class="num">${money(actual)}</td><td class="num ${plan.ok && plan.cogs > 0 ? 'jc-loss' : plan.ok && plan.cogs < 0 ? 'jc-good' : ''}">${plan.ok ? money(plan.cogs) : '—'}</td><td><button type="button" class="btn btn-secondary btn-sm" data-acc-close="${esc(id)}"${plan.ok ? '' : ' disabled'}>${icon('check')}${esc(t('close.button'))}</button></td></tr>`;
  }).join('');
  const docsOfPeriod = [...data.documents.closes.filter(doc => doc.period === ui.period).map(doc => ({ doc, kind: 'closes', label: t('close.doc', { period: monthLabel(doc.period) }), amount: doc.cogs })), ...data.documents.nrv.filter(doc => monthOf(doc.date) === ui.period).map(doc => ({ doc, kind: 'nrv', label: t('nrv.doc', { date: dateText(doc.date) }), amount: doc.delta }))].filter(row => branch === 'all' || row.doc.branch === branch);
  const docRows = docsOfPeriod.map(({ doc, kind, label, amount: value }) => `<li>${esc(label)} · ${esc(branchLabel(doc.branch))} · ${money(value)} · ${esc(t(doc.status === 'posted' ? 'status.posted' : 'status.voided'))}${doc.status === 'posted' ? ` <button type="button" class="btn btn-tertiary btn-sm" data-acc-void="${kind}" data-acc-id="${esc(doc.id)}">${icon('cancel')}${esc(t('action.cancel'))}</button>` : ''}</li>`).join('');
  const flags = checks.flags.slice(0, 200).map(flag => `<li><b data-no-i18n>${esc(flag.docNo || '—')}</b> ${flag.date ? `(${esc(dateText(flag.date))})` : ''} — ${esc(flagText(flag, data.chart))}</li>`).join('');
  return `${filtersHtml(data)}${integrityBanner(checks)}
  <section class="afc-card" aria-labelledby="acc-pack-title"><div class="afc-card-head"><h3 id="acc-pack-title">${esc(t('pack.title', { period: monthLabel(ui.period) }))}</h3></div>
    <p class="afc-note">${esc(t('pack.intro'))}</p>
    <ul class="acc-checks">${checkRows}</ul>
    <label class="jc-check acc-cogs-option"><input type="checkbox" id="acc-cogs-month-end"${data.settings.export.cogsMonthEnd ? ' checked' : ''}><span><b>${esc(t('pack.cogsOption'))}</b></span></label>
    <p class="afc-note acc-cogs-explain">${esc(t('pack.cogsExplain'))}</p>
    <div class="jc-actions"><button type="button" class="btn btn-primary" data-acc-export="xlsx" data-acc-table="pack">${icon('download')}${esc(t('pack.download'))}</button>${exportButtons('journal')}</div>
    <p class="afc-note">${esc(t('pack.contents'))}</p>
    ${followBox(data, branch)}
    <div class="afc-box afc-box-info" role="note" data-acc-checklist><b>${esc(t('checklist.title'))}</b><ul>${CHECKLIST_KEYS.map(key => `<li><label class="jc-check"><input type="checkbox" data-acc-checklist-item="${key}"> <span>${esc(t(`checklist.${key}`))}</span></label></li>`).join('')}</ul></div>
  </section>
  <section class="afc-card" aria-labelledby="acc-peak-title"><div class="afc-card-head"><h3 id="acc-peak-title">${esc(t('peak.title'))}</h3>${exportButtons('peak')}</div>
    <div class="afc-box afc-box-warn" role="note"><b>${esc(t('peak.mustCheck'))}</b>${lang() === 'en' ? ` <span lang="th" data-no-i18n>(${esc(translateKey(JOURNAL_KEYS, 'th', 'peak.mustCheck'))})</span>` : ''} ${esc(t('peak.why'))}</div>
    <form id="acc-peak-form" novalidate><div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('peak.title'))}"><table class="afc-table acc-peak-table"><thead><tr><th scope="col">${esc(t('peak.header'))}</th><th scope="col">${esc(t('peak.field'))}</th><th scope="col"><span class="sr-only">${esc(t('peak.order'))}</span></th></tr></thead><tbody>${peakRows}</tbody></table></div>
    <div class="jc-form-grid"><div class="jc-field"><label for="acc-peak-date">${esc(t('peak.dateFormat'))}</label><select id="acc-peak-date">${PEAK_DATE_FORMATS.map(format => `<option value="${format}"${format === peak.dateFormat ? ' selected' : ''}>${esc(t(`peakDate.${format}`))}</option>`).join('')}</select></div></div>
    <div class="jc-actions"><button type="button" class="btn btn-secondary" data-acc-peak-add>${icon('add')}${esc(t('peak.add'))}</button><button type="submit" class="btn btn-secondary">${icon('save')}${esc(t('peak.save'))}</button><button type="button" class="btn btn-tertiary" data-acc-peak-reset>${icon('reset')}${esc(t('peak.reset'))}</button></div></form>
  </section>
  <section class="afc-card" aria-labelledby="acc-close-title"><div class="afc-card-head"><h3 id="acc-close-title">${esc(t('close.title', { period: monthLabel(ui.period) }))}</h3></div>
    <p class="afc-note">${esc(t('close.intro'))}</p>
    <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('close.titleShort'))}"><table class="afc-table acc-table"><thead><tr><th scope="col">${esc(t('filter.branch'))}</th><th scope="col" class="num">${esc(t('close.applied'))}</th><th scope="col" class="num">${esc(t('close.actual'))}</th><th scope="col" class="num">${esc(t('close.cogs'))}</th><th scope="col"><span class="sr-only">${esc(t('close.button'))}</span></th></tr></thead><tbody>${closeRows}</tbody></table></div>
    <div class="jc-actions"><button type="button" class="btn btn-secondary" data-acc-nrv>${icon('table')}${esc(t('nrv.button', { date: dateText(monthLastDay(ui.period)) }))}</button></div>
    ${docRows ? `<ul class="acc-doc-list">${docRows}</ul>` : ''}
  </section>
  <section class="afc-card" aria-labelledby="acc-flags-title"><div class="afc-card-head"><h3 id="acc-flags-title">${esc(t('flags.title', { n: checks.flags.length }))}</h3></div>
    <p class="afc-note">${esc(t('flags.intro'))}</p>${flags ? `<ul class="acc-flag-list">${flags}</ul>` : `<p class="afc-note">${esc(t('flags.none'))}</p>`}</section>`;
}
// ---- tab: manual entries
function manualDraft(data) {
  if (!ui.manual) ui.manual = { date: todayIso(), branch: scope() === 'all' ? HEAD_OFFICE_BRANCH_ID : scope(), memo: '', lines: [{ account: '', debit: '', credit: '', memo: '', openItem: '' }, { account: '', debit: '', credit: '', memo: '', openItem: '' }] };
  return ui.manual;
}
function accountOptions(data, selected) {
  const rows = [...data.chart.values()].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return `<option value=""></option>${rows.map(acct => `<option value="${esc(acct.id)}"${acct.id === selected ? ' selected' : ''}>${esc(acct.code)} ${esc(accountName(acct))}</option>`).join('')}`;
}
function renderManual(data) {
  const draft = manualDraft(data);
  const branch = scope();
  const { from, to } = periodRange(ui.period);
  current = { tab: 'manual', draft };
  const openAr = openItems(data.entries, 'ar', { to: todayIso() });
  const openAp = openItems(data.entries, 'ap', { to: todayIso() });
  const itemOptions = (acct, selected) => {
    const items = acct === 'ar' ? openAr : acct === 'ap' ? openAp : [];
    if (!items.length) return '';
    return `<option value=""></option>${items.map(item => `<option value="${esc(item.key)}"${item.key === selected ? ' selected' : ''}>${esc(item.no || item.key)} · ${esc(item.party)} · ${esc(money(item.balance))}</option>`).join('')}`;
  };
  const lineRows = draft.lines.map((line, index) => `<tr data-acc-line="${index}"><td><label class="sr-only" for="acc-ml-a-${index}">${esc(t('col.account'))}</label><select id="acc-ml-a-${index}" data-acc-ml="account" data-index="${index}">${accountOptions(data, line.account)}</select>${(line.account === 'ar' || line.account === 'ap') && itemOptions(line.account, line.openItem) ? `<label class="acc-open-item"><span>${esc(t('manual.openItem'))}</span><select data-acc-ml="openItem" data-index="${index}" data-no-i18n>${itemOptions(line.account, line.openItem)}</select></label>` : ''}</td><td><label class="sr-only" for="acc-ml-d-${index}">${esc(t('col.debit'))}</label><input id="acc-ml-d-${index}" data-acc-ml="debit" data-index="${index}" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(line.debit)}"></td><td><label class="sr-only" for="acc-ml-c-${index}">${esc(t('col.credit'))}</label><input id="acc-ml-c-${index}" data-acc-ml="credit" data-index="${index}" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(line.credit)}"></td><td><label class="sr-only" for="acc-ml-m-${index}">${esc(t('manual.lineMemo'))}</label><input id="acc-ml-m-${index}" data-acc-ml="memo" data-index="${index}" value="${esc(line.memo)}" autocomplete="off" data-no-i18n></td><td><button type="button" class="btn btn-tertiary btn-sm" data-acc-ml-remove="${index}" aria-label="${esc(t('manual.removeLine', { n: index + 1 }))}"${draft.lines.length <= 2 ? ' disabled' : ''}>${icon('trash')}</button></td></tr>`).join('');
  const sum = key => draft.lines.reduce((total, line) => total + Math.round((Number(String(line[key] || '').replace(/,/g, '')) || 0) * 100), 0);
  const debit = sum('debit');
  const credit = sum('credit');
  const list = data.documents.manual.filter(doc => doc.date >= from && doc.date <= to && (branch === 'all' || doc.branch === branch)).map(doc => `<tr><td>${esc(dateText(doc.date))}</td><td><b data-no-i18n>${esc(doc.no)}</b></td><td data-no-i18n>${esc(doc.memo)}</td><td class="num">${amount(doc.lines.reduce((total, line) => total + line.debit, 0))}</td><td>${esc(t(doc.status === 'posted' ? 'status.posted' : 'status.voided'))}${doc.status === 'voided' ? `<small data-no-i18n>${esc(doc.voidReason)}</small>` : ''}</td><td>${doc.status === 'posted' ? `<button type="button" class="btn btn-tertiary btn-sm" data-acc-void="manual" data-acc-id="${esc(doc.id)}">${icon('cancel')}${esc(t('action.cancel'))}</button>` : ''}</td></tr>`).join('');
  const branchField = branchesOnScreen().length > 1 ? `<div class="jc-field"><label for="acc-m-branch">${esc(t('filter.branch'))}</label><select id="acc-m-branch">${branchesOnScreen().map(id => `<option value="${esc(id)}"${draft.branch === id ? ' selected' : ''}>${esc(branchLabel(id))}</option>`).join('')}</select></div>` : '';
  return `${filtersHtml(data)}
  <section class="afc-card" aria-labelledby="acc-manual-title"><div class="afc-card-head"><h3 id="acc-manual-title">${esc(t('manual.title'))}</h3></div>
    <p class="afc-note">${esc(t('manual.intro'))}</p>
    <form id="acc-manual-form" novalidate>
      <div class="jc-form-grid"><div class="jc-field"><label for="acc-m-date">${esc(t('col.date'))}</label><input id="acc-m-date" type="date" value="${esc(draft.date)}" required></div>${branchField}<div class="jc-field"><label for="acc-m-memo">${esc(t('manual.memo'))}</label><input id="acc-m-memo" value="${esc(draft.memo)}" autocomplete="off" data-no-i18n></div></div>
      <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('manual.lines'))}"><table class="afc-table acc-manual-table"><thead><tr><th scope="col">${esc(t('col.account'))}</th><th scope="col" class="num">${esc(t('col.debit'))}</th><th scope="col" class="num">${esc(t('col.credit'))}</th><th scope="col">${esc(t('manual.lineMemo'))}</th><th scope="col"><span class="sr-only">${esc(t('manual.remove'))}</span></th></tr></thead><tbody>${lineRows}</tbody><tfoot><tr><th scope="row">${esc(t('col.total'))}</th><td class="num">${amount(debit)}</td><td class="num">${amount(credit)}</td><td colspan="2" class="${debit === credit && debit > 0 ? 'jc-good' : 'jc-loss'}">${esc(debit === credit && debit > 0 ? t('manual.balanced') : t('manual.difference', { amount: money(debit - credit) }))}</td></tr></tfoot></table></div>
      <div class="jc-actions"><button type="button" class="btn btn-secondary" data-acc-ml-add>${icon('add')}${esc(t('manual.addLine'))}</button><button type="submit" class="btn btn-primary">${icon('save')}${esc(t('manual.save'))}</button></div>
    </form></section>
  <section class="afc-card" aria-labelledby="acc-manual-list-title"><div class="afc-card-head"><h3 id="acc-manual-list-title">${esc(t('manual.listTitle', { period: monthLabel(ui.period) }))}</h3></div>
    <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('manual.listTitleShort'))}"><table class="afc-table acc-table"><thead><tr><th scope="col">${esc(t('col.date'))}</th><th scope="col">${esc(t('col.docNo'))}</th><th scope="col">${esc(t('manual.memo'))}</th><th scope="col" class="num">${esc(t('manual.amount'))}</th><th scope="col">${esc(t('col.status'))}</th><th scope="col"><span class="sr-only">${esc(t('action.cancel'))}</span></th></tr></thead><tbody>${list || `<tr><td colspan="6" class="afc-empty-cell">${esc(t('manual.none'))}</td></tr>`}</tbody></table></div></section>`;
}
// ---- tab: opening balances
function renderOpening(data) {
  current = { tab: 'opening', pending: ui.opening };
  const pending = ui.opening;
  const asOf = pending?.asOf || addDays(data.journal.openingDate || todayIso(), 0);
  const errorList = codes => codes.map(code => esc(t(`opening.error.${code}`))).join(', ');
  const rows = pending ? pending.plan.rows.map(row => `<tr${row.errors.length ? ' class="jc-row-warn"' : ''}><td class="num">${row.line}</td><td>${esc(row.kind ? t(`opening.kind.${row.kind}`) : '?')}</td><td>${esc(row.branch ? branchLabel(row.branch) : row.branchCode)}</td><td data-no-i18n>${esc(row.code)}</td><td data-no-i18n>${esc(row.name)}</td><td data-no-i18n>${esc(row.docNo)}</td><td>${esc(dateText(row.docDate))}</td><td>${esc(dateText(row.dueDate))}</td><td class="num">${row.kind === 'stock' ? esc(NUMBER_2.format(row.qtyMilli / 1000)) : ''}</td><td class="num">${row.kind === 'stock' ? amount(row.unitCost) : ''}</td><td class="num">${row.kind === 'stock' ? amount(row.value) : amount(row.amount)}</td><td>${row.errors.length ? `<span class="jc-loss">${errorList(row.errors)}</span>` : `<span class="jc-good">${esc(t('opening.rowOk'))}</span>`}</td></tr>`).join('') : '';
  const totals = pending?.plan?.totals;
  const batches = data.documents.opening.map(doc => `<tr><td>${esc(dateText(doc.date))}</td><td>${esc(t(`opening.kind.${doc.kind}`))}</td><td class="num">${doc.rows.length}</td><td class="num">${doc.kind === 'stock' ? '—' : amount(doc.total)}</td><td>${esc(t(doc.status === 'posted' ? 'status.posted' : 'status.voided'))}</td><td>${doc.status === 'posted' && doc.kind !== 'stock' ? `<button type="button" class="btn btn-tertiary btn-sm" data-acc-void="opening" data-acc-id="${esc(doc.id)}">${icon('cancel')}${esc(t('action.cancel'))}</button>` : ''}</td></tr>`).join('');
  return `<section class="afc-card" aria-labelledby="acc-opening-title"><div class="afc-card-head"><h3 id="acc-opening-title">${esc(t('opening.title'))}</h3><div class="afc-export"><button type="button" class="btn btn-secondary btn-sm" data-acc-template>${icon('download')}${esc(t('opening.template'))}</button></div></div>
    <p class="afc-note">${esc(t('opening.intro'))}</p>
    <form id="acc-opening-form" novalidate><div class="jc-form-grid"><div class="jc-field"><label for="acc-o-date">${esc(t('opening.asOf'))}</label><input id="acc-o-date" type="date" value="${esc(asOf)}" required></div><div class="jc-field"><label for="acc-o-file">${esc(t('opening.file'))}</label><input id="acc-o-file" type="file" accept=".csv,text/csv"></div></div>
    <div class="jc-actions"><button type="submit" class="btn btn-primary"${pending?.plan?.ok ? '' : ' disabled'}>${icon('upload')}${esc(t('opening.commit'))}</button></div></form>
    ${pending ? `<div class="afc-box ${pending.plan.ok ? 'afc-box-info' : 'afc-box-error'}" role="status">${esc(pending.plan.ok ? t('opening.previewOk', { rows: pending.plan.rows.length, ar: money(totals.ar), ap: money(totals.ap), stock: money(totals.stockValue) }) : t('opening.previewBad', { errors: pending.plan.errors.length ? errorList(pending.plan.errors) : t('opening.rowErrors') }))}</div>
    <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('opening.preview'))}"><table class="afc-table acc-table acc-opening-table"><thead><tr>${['line', 'kind', 'branch', 'code', 'name', 'docNo', 'docDate', 'dueDate', 'qty', 'unitCost', 'amount', 'check'].map(key => `<th scope="col"${['line', 'qty', 'unitCost', 'amount'].includes(key) ? ' class="num"' : ''}>${esc(t(`opening.col.${key}`))}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>` : ''}
    <p class="afc-note">${esc(t('opening.note'))}</p></section>
  <section class="afc-card" aria-labelledby="acc-opening-list-title"><div class="afc-card-head"><h3 id="acc-opening-list-title">${esc(t('opening.history'))}</h3></div>
    <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('opening.history'))}"><table class="afc-table acc-table"><thead><tr><th scope="col">${esc(t('opening.asOf'))}</th><th scope="col">${esc(t('opening.col.kind'))}</th><th scope="col" class="num">${esc(t('opening.rows'))}</th><th scope="col" class="num">${esc(t('opening.col.amount'))}</th><th scope="col">${esc(t('col.status'))}</th><th scope="col"><span class="sr-only">${esc(t('action.cancel'))}</span></th></tr></thead><tbody>${batches || `<tr><td colspan="6" class="afc-empty-cell">${esc(t('opening.none'))}</td></tr>`}</tbody></table></div></section>`;
}

// ---------------------------------------------------------------- exports
// The general journal: one row per line. Documented columns (ADR-029): ลำดับ, เลขที่รายการ, วันที่, สาขา (รหัส),
// ประเภทรายการ, เลขที่เอกสาร, คำอธิบาย, รหัสบัญชี, ชื่อบัญชี, เดบิต, เครดิต, งาน, ข้อสังเกต.
function exportEntries(data, branch, period) {
  const { from, to } = periodRange(period);
  const entries = entriesInRange(data.entries, { from, to, branch });
  return data.settings.export.cogsMonthEnd ? consolidateCogs(entries) : entries;
}
function journalTable(data, branch, period) {
  const entries = exportEntries(data, branch, period);
  const numbers = numberEntries(entries);
  const header = ['seq', 'entryNo', 'date', 'branch', 'kind', 'docNo', 'description', 'accountCode', 'accountName', 'debit', 'credit', 'job', 'flags'].map(key => t(`gj.${key}`));
  const rows = [];
  let seq = 0;
  for (const entry of entries) {
    for (const line of entry.lines) {
      seq += 1;
      const acct = data.chart.get(line.account);
      rows.push([seq, numbers.get(entry.id), entry.date, liveBranchCode(line.branch, window) || line.branch, kindLabel(entry.kind), entry.docNo, describeText(entry), acct?.code || line.account, accountName(acct), baht(line.debit), baht(line.credit), line.jobKey || '', entry.flags.map(code => t(`flagShort.${code}`)).join(', ')]);
    }
  }
  const debit = entries.reduce((sum, entry) => sum + entry.lines.reduce((s, line) => s + line.debit, 0), 0);
  const credit = entries.reduce((sum, entry) => sum + entry.lines.reduce((s, line) => s + line.credit, 0), 0);
  rows.push(['', '', '', '', '', '', t('col.total'), '', '', baht(debit), baht(credit), '', '']);
  return [header, ...rows];
}
function trialTable(data, branch, period) {
  const tb = trialBalance(data.entries, { ...periodRange(period), branch }, data.chart);
  const header = ['code', 'name', 'type', 'openingDebit', 'openingCredit', 'debit', 'credit', 'closingDebit', 'closingCredit'].map(key => t(`tb.${key}`));
  const rows = tb.rows.map(row => { const acct = accountByCode(data, row.code); const o = side(row.opening); const c = side(row.closing); return [row.code, accountName(acct), t(`type.${row.type}`), baht(o.debit), baht(o.credit), baht(row.debit), baht(row.credit), baht(c.debit), baht(c.credit)]; });
  const total = tb.totals;
  rows.push([t('col.total'), '', '', baht(total.openingDebit), baht(total.openingCredit), baht(total.debit), baht(total.credit), baht(total.closingDebit), baht(total.closingCredit)]);
  return [header, ...rows];
}
function ledgerTable(data, branch, period, code) {
  const ledger = generalLedger(data.entries, { ...periodRange(period), branch }, data.chart, code);
  const numbers = numberEntries(entriesInRange(data.entries, { ...periodRange(period), branch }));
  const header = ['date', 'entryNo', 'docNo', 'description', 'debit', 'credit', 'balance'].map(key => t(`gl.${key}`));
  const rows = [[t('ledger.openingRow'), '', '', '', '', '', baht(ledger.opening)], ...ledger.rows.map(row => [row.entry.date, numbers.get(row.entry.id) || '', row.entry.docNo, describeText(row.entry), baht(row.line.debit), baht(row.line.credit), baht(row.balance)])];
  rows.push([t('ledger.closing'), '', '', '', baht(ledger.debit), baht(ledger.credit), baht(ledger.closing)]);
  return [[t('gl.account'), code, accountName(accountByCode(data, code))], header, ...rows];
}
function peakDate(iso, format) {
  const [year, month, day] = iso.split('-');
  if (format === 'iso') return iso;
  return `${day}/${month}/${format === 'dmy-be' ? Number(year) + 543 : year}`;
}
// The PEAK import file: the columns of the mapping, one row per journal line (Thai account names — PEAK is Thai).
function peakTable(data, branch, period) {
  const entries = exportEntries(data, branch, period);
  const numbers = numberEntries(entries, 'JV');
  const { columns, dateFormat } = data.settings.peak;
  const thai = key => translateKey(JOURNAL_KEYS, 'th', key);
  const rows = [];
  for (const entry of entries) {
    const description = `${translateKey(JOURNAL_KEYS, 'th', entry.descKey, { ...entry.descParams, text: entry.descKey === 'desc.reversal' ? translateKey(JOURNAL_KEYS, 'th', entry.descParams.original || 'desc.manual', entry.descParams) : '' })}${entry.party ? ` · ${entry.party}` : ''}${entry.memo ? ` · ${entry.memo}` : ''}`;
    for (const line of entry.lines) {
      const acct = data.chart.get(line.account);
      const value = { date: peakDate(entry.date, dateFormat), entryNo: numbers.get(entry.id), docNo: entry.docNo, description, accountCode: acct?.code || line.account, accountName: acct ? (acct.name || acct.th) : line.account, debit: baht(line.debit), credit: baht(line.credit), branchCode: liveBranchCode(line.branch, window) || line.branch, party: entry.party, kind: thai(`kind.${entry.kind}`), blank: '' };
      rows.push(columns.map(column => value[column.field] ?? ''));
    }
  }
  return [columns.map(column => column.header), ...rows];
}
function openItemsTable(data, kind, branch, asOf) {
  const items = openItems(data.entries, kind, { to: asOf, branch });
  const header = ['party', 'docNo', 'date', 'dueDate', 'days', 'bucket', 'branch', 'amount'].map(key => t(`aging.${key}`));
  const totals = Object.fromEntries(AGING_BUCKETS.map(bucket => [bucket, 0]));
  const rows = items.map(item => {
    const days = businessDaysBetween(item.dueDate, asOf);
    const bucket = receivableAgingBucket(Number.isFinite(days) ? days : null);
    totals[bucket] += item.balance;
    return [item.party, item.no, item.date, item.dueDate, Number.isFinite(days) ? days : '', t(`bucket.${bucket}`), branchLabel(item.branch), baht(item.balance)];
  });
  const sum = items.reduce((total, item) => total + item.balance, 0);
  rows.push([t('col.total'), '', '', '', '', '', '', baht(sum)]);
  rows.push([]);
  for (const bucket of AGING_BUCKETS) rows.push([t(`bucket.${bucket}`), '', '', '', '', '', '', baht(totals[bucket])]);
  return { rows: [[t(kind === 'ar' ? 'pack.arTitle' : 'pack.apTitle', { date: dateText(asOf) })], header, ...rows], total: sum };
}
function valuationTable(data, branch, asOf) {
  const rows = valuationAt(data.costing.costing, asOf, { branch });
  const product = sku => data.costing.products.find(row => productSkuKey(row) === sku);
  const header = ['code', 'name', 'branch', 'qty', 'unitCost', 'value'].map(key => t(`val.${key}`));
  const body = rows.map(row => [product(row.sku)?.code || row.sku.replace(/^(code|name):/, ''), product(row.sku)?.name || '', branchLabel(row.branch), row.qty, row.uc === null ? '' : row.uc / UNIT_COST_SCALE, baht(row.value)]);
  body.push([t('col.total'), '', '', '', '', baht(valuationTotal(rows))]);
  return [[t('pack.valuationTitle', { date: dateText(asOf) })], header, ...body];
}
function wipTable(data, branch, asOf) {
  const gl = wipByJob(data.entries, { to: asOf, branch });
  const sheets = sheetWipAsOf(data.costing.sheets, asOf);
  const jobs = new Map(data.costing.jobs.map(job => [job.key, job]));
  const keys = [...new Set([...gl.map(row => row.jobKey), ...[...sheets.keys()].filter(key => branch === 'all' || key.startsWith(`${branch}|`))])].sort();
  const header = ['job', 'name', 'customer', 'branch', 'gl', 'sheet'].map(key => t(`wip.${key}`));
  const body = keys.map(key => { const job = jobs.get(key); return [job?.no || key, job?.name || '', job?.customer || '', branchLabel(job?.branch || key.split('|')[0]), baht(gl.find(row => row.jobKey === key)?.balance || 0), baht(sheets.get(key) || 0)]; });
  body.push([t('col.total'), '', '', '', baht(gl.reduce((sum, row) => sum + row.balance, 0)), baht(keys.reduce((sum, key) => sum + (sheets.get(key) || 0), 0))]);
  return [[t('pack.wipTitle', { date: dateText(asOf) })], header, ...body];
}
// ---- r13 follow-ups of the month (LOW-5, LOW-6, HIGH-2, MED-3): what the accountant must look at or adjust by hand.
//   → [{ key, text }] (key = the t() key family; text already translated)
function followUps(data, branch, period) {
  const { from, to } = periodRange(period);
  const out = [];
  const inScope = row => branch === 'all' || row === branch;
  for (const gr of data.src.goodsReceipts) {
    const info = goodsReceiptVatOf(gr);
    if (info.pending && inScope(gr.branch) && String(gr.date || '') <= to) out.push({ key: 'grPending', text: t('follow.grPending', { no: gr.no, date: dateText(gr.date), vat: money(Math.round(info.vat * 100)) }) });
  }
  // 2181 accrued job costs not paid by a linked expense (subcontract / direct costs) and 5141 applied labour without wages.
  const balances = accountBalances(data.entries, { to, branch });
  const accrued = -(balances.get('job_cost_accrued')?.closing || 0);
  if (accrued) out.push({ key: 'accrual', text: t('follow.accrual', { amount: money(accrued) }) });
  const f = { from, to, branch };
  const labour = -movement(data.entries, ['labour_applied'], f);
  const wages = movement(data.entries, ['exp_wages'], f);
  if (labour > 0 && wages <= 0) out.push({ key: 'labour', text: t('follow.labour', { amount: money(labour) }) });
  for (const row of deferredRevenueRows(data.src.invoices.filter(invoice => inScope(invoice._branch)), to)) out.push({ key: 'deferred', text: t('follow.deferred', { no: row.no, from: dateText(row.from), to: dateText(row.to), value: money(row.valueSatang), unearned: money(row.unearnedSatang), days: row.remainingDays }) });
  for (const flag of data.flags) if (flag.code === 'cancel_backdated' && flag.date >= from && flag.date <= to && inScope(flag.branch)) out.push({ key: 'backdated', text: t('follow.backdated', { no: flag.docNo, cancelled: dateText(flag.params?.cancelDate || '') }) });
  return out;
}
// 50 ทวิ that customers gave us (WHT they deducted on our receipts — a credit in ภ.ง.ด.50/51) in the month (LOW-7).
function whtReceivedTable(data, branch, period) {
  const { from, to } = periodRange(period);
  const header = ['date', 'receipt', 'customer', 'taxId', 'rate', 'wht', 'certNo', 'received'].map(key => t(`whtIn.${key}`));
  const rows = data.src.receipts.filter(row => (branch === 'all' || row._branch === branch) && !row.voided && row.status !== 'cancelled' && Number(row.whtAmount) > 0 && String(row.date || '') >= from && String(row.date || '') <= to)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.no).localeCompare(String(b.no)))
    .map(row => [row.date, row.no || '', row.customer || '', row.customerTaxId || '', Number(row.whtRate) || '', baht(Math.round(Number(row.whtAmount) * 100)), row.whtCertNo || '', t(row.whtCertReceived ? 'whtIn.yes' : 'whtIn.no')]);
  const total = rows.reduce((sum, row) => sum + Math.round(Number(String(row[5]).replace(/,/g, '')) * 100), 0);
  return [[t('whtIn.title', { period: monthLabel(period) })], header, ...rows, [t('col.total'), '', '', '', '', baht(total), '', '']];
}
// LOW-7: what the accountant also asks for each month — the app cannot produce these, so the pack lists them to tick.
const CHECKLIST_KEYS = Object.freeze(['bank', 'payroll', 'assets', 'whtReceived', 'taxPayments', 'purchaseInvoices', 'retention']);
function checklistTable() {
  return [[t('checklist.title')], [t('checklist.item'), t('checklist.status')], ...CHECKLIST_KEYS.map(key => [t(`checklist.${key}`), '☐'])];
}
// The one-click month-end pack: one Excel workbook, one sheet per report.
function packSheets(data, branch, period) {
  const { to } = periodRange(period);
  const checks = buildChecks(data, period, branch);
  const sheets = [];
  const user = window.CurrentUser || {};
  const company = String(savedProfileOf(user)?.nameTh || user.companyProfile?.nameTh || user.companyName || '').trim();
  const cover = [[t('pack.coverTitle')], [t('pack.company'), company], [t('pack.period'), monthLabel(period)], [t('pack.scope'), branch === 'all' ? t('filter.allBranches') : branchLabel(branch)], [t('pack.generated'), new Date().toISOString()], [t('pack.cogsMode'), t(data.settings.export.cogsMonthEnd ? 'pack.cogsModeOn' : 'pack.cogsModeOff')], [], [t('pack.checks')]];
  for (const check of checks.checks) cover.push([t(`checkLevel.${check.level}`), checkText(check)]);
  cover.push([], [t('pack.totals')]);
  const f = { ...periodRange(period), branch };
  for (const [key, ids, sign] of [['sales', ['sales_goods', 'sales_service', 'sales_returns', 'sales_debit'], -1], ['outputVat', ['output_vat'], -1], ['inputVat', ['input_vat'], 1], ['pnd3', ['wht_pnd3'], -1], ['pnd53', ['wht_pnd53'], -1], ['cogs', ['cogs'], 1]]) cover.push([t(`total.${key}`), baht(sign * movement(data.entries, ids, f))]);
  const balances = accountBalances(data.entries, { to, branch });
  for (const [key, id, sign] of [['ar', 'ar', 1], ['ap', 'ap', -1], ['inventory', 'inventory', 1], ['wip', 'wip', 1]]) cover.push([t(`total.${key}`), baht(sign * (balances.get(id)?.closing || 0))]);
  cover.push([], [t('pack.peakNote')], [t('pack.chartNote')]);
  sheets.push({ name: t('sheet.cover'), rows: cover });
  for (const id of branch === 'all' ? branchesOnScreen() : [branch]) {
    const tax = taxSources(data, id, period);
    const suffix = branchesOnScreen().length > 1 ? ` ${liveBranchCode(id, window) || id}` : '';
    const table = (report, kind) => { const out = taxReportTable(report, kind); return [out.header, ...out.body, out.footer]; };
    sheets.push({ name: `${t('sheet.sales')}${suffix}`, rows: table(tax.sales, 'sales') });
    sheets.push({ name: `${t('sheet.purchase')}${suffix}`, rows: table(tax.purchases, 'purchase') });
    sheets.push({ name: `${t('sheet.forbidden')}${suffix}`, rows: table(tax.purchases, 'forbidden') });
    for (const form of ['PND3', 'PND53']) { const report = whtReportTable(form === 'PND3' ? tax.pnd3 : tax.pnd53); sheets.push({ name: `${t(`sheet.${form.toLowerCase()}`)}${suffix}`, rows: [report.header, ...report.body, report.footer] }); }
  }
  sheets.push({ name: t('sheet.ar'), rows: openItemsTable(data, 'ar', branch, to).rows });
  sheets.push({ name: t('sheet.ap'), rows: openItemsTable(data, 'ap', branch, to).rows });
  sheets.push({ name: t('sheet.valuation'), rows: valuationTable(data, branch, to) });
  sheets.push({ name: t('sheet.wip'), rows: wipTable(data, branch, to) });
  sheets.push({ name: t('sheet.trial'), rows: trialTable(data, branch, period) });
  sheets.push({ name: t('sheet.journal'), rows: journalTable(data, branch, period) });
  sheets.push({ name: t('sheet.whtReceived'), rows: whtReceivedTable(data, branch, period) });
  const follow = followUps(data, branch, period);
  sheets.push({ name: t('sheet.followUp'), rows: [[t('follow.title')], ...(follow.length ? follow.map(row => [row.text]) : [[t('follow.none')]])] });
  sheets.push({ name: t('sheet.checklist'), rows: checklistTable() });
  return sheets;
}
function exportTable(name) {
  const data = dataset();
  if (data.error) return null;
  const branch = scope();
  const period = ui.period || defaultPeriod(data);
  if (name === 'journal') return { file: `general-journal_${period}`, sheets: [{ name: t('sheet.journal'), rows: journalTable(data, branch, period) }] };
  if (name === 'trial') return { file: `trial-balance_${period}`, sheets: [{ name: t('sheet.trial'), rows: trialTable(data, branch, period) }] };
  if (name === 'ledger') return { file: `ledger_${ui.account}_${period}`, sheets: [{ name: t('sheet.ledger'), rows: ledgerTable(data, branch, period, ui.account) }] };
  if (name === 'peak') return { file: `peak-journal-import_${period}`, sheets: [{ name: 'Journal', rows: peakTable(data, branch, period) }] };
  if (name === 'pack') return { file: `month-end-pack_${period}`, sheets: packSheets(data, branch, period) };
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
  if (!table || name === 'pack') { say(t('export.blocked'), 'error'); return null; }
  const content = taxCsvText(table.sheets[0].rows);
  download(`${table.file}.csv`, 'text/csv;charset=utf-8', content);
  return content;
}
function exportExcel(name) {
  const table = exportTable(name);
  if (!table) { say(t('export.blocked'), 'error'); return null; }
  const run = () => {
    if (!window.XLSX) { say(t('export.excelMissing'), 'error'); return; }
    const book = window.XLSX.utils.book_new();
    const used = new Set();
    for (const sheet of table.sheets) {
      let sheetName = taxSafeSheetName(sheet.name, 'Sheet');
      for (let n = 2; used.has(sheetName); n += 1) sheetName = taxSafeSheetName(`${sheet.name.slice(0, 27)} ${n}`, `Sheet${n}`);
      used.add(sheetName);
      window.XLSX.utils.book_append_sheet(book, window.XLSX.utils.aoa_to_sheet(sheet.rows), sheetName);
    }
    window.XLSX.writeFile(book, `${table.file}.xlsx`);
  };
  if (window.XLSX) run();
  else if (typeof window.loadSheetJS === 'function') window.loadSheetJS(run);
  else say(t('export.excelMissing'), 'error');
  return table;
}

// ---------------------------------------------------------------- chart-of-accounts card (ตั้งค่าบริษัท)
function coaCategories(data) {
  const set = new Set(Object.keys(DEFAULT_CATEGORY_ROLES));
  for (const key of Object.keys(data.settings.categories || {})) set.add(key);
  for (const row of data.src?.expenses || []) if (String(row.cat || '').trim()) set.add(String(row.cat).trim());
  return [...set];
}
function coaCardHtml() {
  const data = dataset();
  if (data.error) return `<div class="card-title"><span>${icon('table')}${esc(t('coa.title'))}</span></div>${errorHtml(data.error)}`;
  const chart = data.chart;
  const used = usedAccounts(data);
  const rows = DEFAULT_ACCOUNTS.map(row => { const acct = chart.get(row.role); return `<tr><th scope="row">${esc(lang() === 'en' ? row.en : row.th)}<small>${esc(t(`type.${row.type}`))}${used.has(row.role) ? ` · ${esc(t('coa.used'))}` : ''}</small></th><td><label class="sr-only" for="acc-coa-code-${row.role}">${esc(t('coa.code'))}</label><input id="acc-coa-code-${row.role}" data-acc-coa-code="${row.role}" value="${esc(acct.code)}" autocomplete="off" data-no-i18n></td><td><label class="sr-only" for="acc-coa-name-${row.role}">${esc(t('coa.name'))}</label><input id="acc-coa-name-${row.role}" data-acc-coa-name="${row.role}" value="${esc(acct.name)}" placeholder="${esc(lang() === 'en' ? row.en : row.th)}" autocomplete="off" data-no-i18n></td></tr>`; }).join('');
  const custom = data.settings.custom.map((row, index) => `<tr><td><input aria-label="${esc(t('coa.code'))}" data-acc-custom-code="${index}" value="${esc(row.code)}" data-no-i18n></td><td><input aria-label="${esc(t('coa.name'))}" data-acc-custom-name="${index}" value="${esc(row.name)}" data-no-i18n></td><td><select aria-label="${esc(t('coa.type'))}" data-acc-custom-type="${index}">${ACCOUNT_TYPES.map(type => `<option value="${type}"${type === row.type ? ' selected' : ''}>${esc(t(`type.${type}`))}</option>`).join('')}</select></td><td><label class="jc-check"><input type="checkbox" data-acc-custom-remove="${index}"${used.has(row.id) ? ' disabled' : ''}><span>${esc(t('coa.remove'))}</span></label></td></tr>`).join('');
  const expenseOptions = selected => EXPENSE_ROLES.map(role => { const acct = chart.get(role); return `<option value="${role}"${role === selected ? ' selected' : ''}>${esc(acct.code)} ${esc(accountName(acct))}</option>`; }).join('');
  const categories = coaCategories(data).map((category, index) => `<tr><th scope="row" data-no-i18n>${esc(category)}</th><td><label class="sr-only" for="acc-cat-${index}">${esc(t('coa.categoryAccount'))}</label><select id="acc-cat-${index}" data-acc-category="${esc(category)}">${expenseOptions(categoryRole(data.settings, category).role)}</select></td></tr>`).join('');
  const posting = Object.entries(POSTING_CHOICES).map(([key, choices]) => `<div class="jc-field"><label for="acc-post-${key}">${esc(t(`posting.${key}`))}</label><select id="acc-post-${key}" data-acc-posting="${key}">${choices.map(choice => { const acct = chart.get(choice); return `<option value="${choice}"${data.settings.posting[key] === choice ? ' selected' : ''}>${esc(acct.code)} ${esc(accountName(acct))}</option>`; }).join('')}</select></div>`).join('');
  return `<div class="card-title"><span id="acc-coa-card-title">${icon('table')}${esc(t('coa.title'))}</span></div>
    <p class="afc-note">${esc(t('coa.intro'))}</p>
    <div class="afc-box afc-box-warn" role="note">${esc(t('coa.vendorNote'))}</div>
    <form id="acc-coa-form" novalidate>
      <details class="jc-details" open><summary>${esc(t('coa.accounts'))}</summary><div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('coa.accounts'))}"><table class="afc-table acc-coa-table"><thead><tr><th scope="col">${esc(t('coa.default'))}</th><th scope="col">${esc(t('coa.code'))}</th><th scope="col">${esc(t('coa.name'))}</th></tr></thead><tbody>${rows}</tbody></table></div></details>
      <details class="jc-details"><summary>${esc(t('coa.custom'))}</summary><div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('coa.custom'))}"><table class="afc-table acc-coa-table"><thead><tr><th scope="col">${esc(t('coa.code'))}</th><th scope="col">${esc(t('coa.name'))}</th><th scope="col">${esc(t('coa.type'))}</th><th scope="col"><span class="sr-only">${esc(t('coa.remove'))}</span></th></tr></thead><tbody>${custom}<tr><td><input aria-label="${esc(t('coa.newCode'))}" id="acc-custom-new-code" placeholder="${esc(t('coa.newCode'))}" data-no-i18n></td><td><input aria-label="${esc(t('coa.newName'))}" id="acc-custom-new-name" placeholder="${esc(t('coa.newName'))}" data-no-i18n></td><td><select aria-label="${esc(t('coa.type'))}" id="acc-custom-new-type">${ACCOUNT_TYPES.map(type => `<option value="${type}">${esc(t(`type.${type}`))}</option>`).join('')}</select></td><td></td></tr></tbody></table></div></details>
      <details class="jc-details"><summary>${esc(t('coa.categories'))}</summary><div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('coa.categories'))}"><table class="afc-table acc-coa-table"><thead><tr><th scope="col">${esc(t('coa.category'))}</th><th scope="col">${esc(t('coa.categoryAccount'))}</th></tr></thead><tbody>${categories}</tbody></table></div></details>
      <details class="jc-details"><summary>${esc(t('coa.posting'))}</summary><p class="afc-note">${esc(t('coa.postingNote'))}</p><div class="jc-form-grid">${posting}</div></details>
      <div class="jc-actions"><button type="submit" class="btn btn-primary">${icon('save')}${esc(t('coa.save'))}</button><button type="button" class="btn btn-tertiary" data-acc-coa-reset>${icon('reset')}${esc(t('coa.reset'))}</button></div>
    </form>`;
}
function coaFormSettings() {
  const data = dataset();
  if (data.error) return null;
  const card = $(COA_CARD_ID);
  const accounts = {};
  for (const row of DEFAULT_ACCOUNTS) {
    const code = String(card.querySelector(`[data-acc-coa-code="${row.role}"]`)?.value ?? row.code).trim();
    const name = String(card.querySelector(`[data-acc-coa-name="${row.role}"]`)?.value ?? '').trim();
    if (code !== row.code || name) accounts[row.role] = { code, name };
  }
  const custom = [];
  data.settings.custom.forEach((row, index) => {
    if (card.querySelector(`[data-acc-custom-remove="${index}"]`)?.checked) return;
    custom.push({ id: row.id, code: String(card.querySelector(`[data-acc-custom-code="${index}"]`)?.value ?? row.code).trim(), name: String(card.querySelector(`[data-acc-custom-name="${index}"]`)?.value ?? row.name).trim(), type: card.querySelector(`[data-acc-custom-type="${index}"]`)?.value || row.type });
  });
  const newCode = String($('acc-custom-new-code')?.value || '').trim();
  const newName = String($('acc-custom-new-name')?.value || '').trim();
  if (newCode || newName) custom.push({ id: `cust-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, code: newCode, name: newName, type: $('acc-custom-new-type')?.value || 'expense' });
  const categories = {};
  card.querySelectorAll('[data-acc-category]').forEach(select => { const category = select.dataset.accCategory; if (select.value !== DEFAULT_CATEGORY_ROLES[category]) categories[category] = select.value; });
  const posting = {};
  card.querySelectorAll('[data-acc-posting]').forEach(select => { posting[select.dataset.accPosting] = select.value; });
  return { accounts, custom, categories, posting };
}
function mountCoaCard() {
  const panel = $(`panel-${SETTINGS_PANEL_ID}`);
  if (!panel) return null;
  let wrap = $(WRAP_ID);
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = WRAP_ID;
    wrap.className = 'acc-settings-cards';
    const saasCard = [...panel.children].find(el => el.classList.contains('card') && el.id !== 'company-profile-card');
    panel.insertBefore(wrap, saasCard || null);
  }
  let card = $(COA_CARD_ID);
  if (!card) {
    card = document.createElement('section');
    card.id = COA_CARD_ID;
    card.className = 'card acc-coa-card';
    card.setAttribute('aria-labelledby', 'acc-coa-card-title');
    wrap.prepend(card);
    card.addEventListener('submit', event => { if (event.target.id !== 'acc-coa-form') return; event.preventDefault(); const patch = coaFormSettings(); if (patch) saveSettings(patch); });
    card.addEventListener('click', event => {
      if (!event.target.closest?.('[data-acc-coa-reset]')) return;
      if (!window.confirm(t('coa.resetConfirm'))) return;
      const defaults = defaultJournalSettings();
      const data = dataset();
      saveSettings({ accounts: {}, custom: data.error ? [] : data.settings.custom, categories: {}, posting: defaults.posting });
    });
  }
  return card;
}
let coaStale = false;
function renderCoaCard() {
  coaStale = false;
  const card = mountCoaCard();
  if (!card) return null;
  card.innerHTML = coaCardHtml();
  return card;
}

// ---------------------------------------------------------------- JSON backup (masterData.accounting)
function exportBackup() {
  return { settings: readSettings(), documents: readDocuments() };
}
function validateBackup(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(t('error.backup'));
  return { settings: normalizeJournalSettings(value.settings ?? null), documents: normalizeJournalDocuments(value.documents ?? null) };
}
// Merge keeps this device's documents and adds the file's new ones (by id); replace takes the file. A document that the
// file adds or changes inside a closed period is refused (nothing is written); settings: the file wins on replace or when
// this device has none.
function backupWrites(value, options = {}) {
  const incoming = validateBackup(value);
  if (!incoming) return [];
  const writes = [];
  if (options.replace || readRaw(JOURNAL_SETTINGS_KEY) === null) writes.push([storageKey(JOURNAL_SETTINGS_KEY), incoming.settings]);
  const here = readDocuments();
  const merged = emptyJournalDocuments();
  const datesOf = doc => [doc.date, doc.voidDate].filter(Boolean);
  const branchesOf = doc => (doc.rows ? [...new Set(doc.rows.map(row => row.branch))] : [doc.branch]);
  for (const key of ['manual', 'closes', 'nrv', 'opening']) {
    const mine = new Map(here[key].map(doc => [doc.id, doc]));
    const theirs = new Map(incoming.documents[key].map(doc => [doc.id, doc]));
    const ids = options.replace ? [...new Set([...theirs.keys(), ...mine.keys()])] : [...new Set([...mine.keys(), ...theirs.keys()])];
    for (const id of ids) {
      const a = mine.get(id);
      const b = theirs.get(id);
      const keep = options.replace ? b : a || b;
      const changed = !a || !b || JSON.stringify(a) !== JSON.stringify(b);
      if (changed && (options.replace || !a)) {
        for (const doc of [a, b].filter(Boolean)) for (const branch of branchesOf(doc)) for (const date of datesOf(doc)) { const lock = lockText(branch, date); if (lock) throw new Error(t('error.backupLocked', { lock })); }
      }
      if (keep) merged[key].push(keep);
    }
  }
  merged.openingDate = options.replace ? incoming.documents.openingDate : here.openingDate || incoming.documents.openingDate;
  writes.push([storageKey(JOURNAL_DOCUMENTS_KEY), normalizeJournalDocuments(merged)]);
  return writes;
}

// ---------------------------------------------------------------- render
function shellHtml() {
  const tab = id => { const active = ui.tab === id; return `<button type="button" role="tab" id="acc-tab-${id}" class="afc-tab${active ? ' active' : ''}" data-acc-tab="${id}" aria-selected="${active}" aria-controls="acc-content" tabindex="${active ? 0 : -1}">${esc(t(`tab.${id}`))}</button>`; };
  return `<div class="afc-head"><div class="card-title"><span>${icon('table')}${esc(t('page.title'))}</span></div><p>${esc(t('page.intro'))}</p></div>
  <div class="afc-tabs" role="tablist" aria-label="${esc(t('page.tabs'))}">${TABS.map(tab).join('')}</div>
  <div id="acc-content" class="afc-content" role="tabpanel" aria-labelledby="acc-tab-${ui.tab}" tabindex="-1"></div>`;
}
function contentHtml(data) {
  if (ui.tab === 'ledger') return renderLedger(data);
  if (ui.tab === 'trial') return renderTrial(data);
  if (ui.tab === 'pack') return renderPack(data);
  if (ui.tab === 'manual') return renderManual(data);
  if (ui.tab === 'opening') return renderOpening(data);
  return renderJournal(data);
}
function render() {
  const root = $(ROOT_ID);
  if (!root) return null;
  const data = dataset();
  if (data.error) { root.innerHTML = `<div class="afc-head"><div class="card-title"><span>${icon('table')}${esc(t('page.title'))}</span></div></div>${errorHtml(data.error)}`; current = null; return null; }
  if (!ui.period) ui.period = defaultPeriod(data);
  root.innerHTML = shellHtml();
  const host = $('acc-content');
  if (host) host.innerHTML = contentHtml(data);
  return current;
}
let queued = false;
function scheduleRender() {
  if (queued || !$(`panel-${PANEL_ID}`)?.classList.contains('active')) return;
  queued = true;
  setTimeout(() => { queued = false; try { render(); } catch (error) { console.error('[Journal] render failed', error); } }, 0);
}

// ---------------------------------------------------------------- events
function readManualForm() {
  const draft = ui.manual;
  if (!draft) return;
  draft.date = $('acc-m-date')?.value || draft.date;
  draft.branch = $('acc-m-branch')?.value || draft.branch;
  draft.memo = $('acc-m-memo')?.value ?? draft.memo;
  document.querySelectorAll('#acc-manual-form [data-acc-ml]').forEach(el => { const line = draft.lines[Number(el.dataset.index)]; if (line) line[el.dataset.accMl] = el.value; });
}
function readPeakForm(data) {
  const columns = data.settings.peak.columns.map((column, index) => ({ header: $(`acc-peak-h-${index}`)?.value ?? column.header, field: $(`acc-peak-f-${index}`)?.value || column.field }));
  return { columns, dateFormat: $('acc-peak-date')?.value || data.settings.peak.dateFormat };
}
function onSubmit(event) {
  const form = event.target;
  if (!form?.id) return;
  if (form.id === 'acc-manual-form') { event.preventDefault(); readManualForm(); saveManual(ui.manual); }
  else if (form.id === 'acc-peak-form') { event.preventDefault(); const data = dataset(); if (!data.error) saveSettings({ peak: readPeakForm(data) }); }
  else if (form.id === 'acc-opening-form') { event.preventDefault(); commitOpening(); }
}
function onClick(event) {
  const target = event.target;
  const tab = target.closest?.('[data-acc-tab]');
  if (tab) { ui.tab = TABS.includes(tab.dataset.accTab) ? tab.dataset.accTab : 'journal'; render(); $(`acc-tab-${ui.tab}`)?.focus(); return; }
  const exportButton = target.closest?.('[data-acc-export]');
  if (exportButton) { if (exportButton.dataset.accExport === 'csv') exportCsv(exportButton.dataset.accTable); else exportExcel(exportButton.dataset.accTable); return; }
  const ledger = target.closest?.('[data-acc-ledger]');
  if (ledger) { ui.account = ledger.dataset.accLedger; ui.tab = 'ledger'; render(); $('acc-tab-ledger')?.focus(); return; }
  const close = target.closest?.('[data-acc-close]');
  if (close) { closeOverhead({ branch: close.dataset.accClose, period: ui.period }); return; }
  if (target.closest?.('[data-acc-nrv]')) { postNrv({ date: monthLastDay(ui.period), branch: scope() }); return; }
  const voidButton = target.closest?.('[data-acc-void]');
  if (voidButton) {
    const reason = window.prompt(t('action.cancelPrompt'));
    if (reason === null) return;
    voidDocument(voidButton.dataset.accVoid, voidButton.dataset.accId, reason);
    return;
  }
  if (target.closest?.('[data-acc-ml-add]')) { readManualForm(); ui.manual.lines.push({ account: '', debit: '', credit: '', memo: '', openItem: '' }); render(); return; }
  const remove = target.closest?.('[data-acc-ml-remove]');
  if (remove) { readManualForm(); ui.manual.lines.splice(Number(remove.dataset.accMlRemove), 1); render(); return; }
  if (target.closest?.('[data-acc-template]')) { download('opening-balance-template.csv', 'text/csv;charset=utf-8', taxCsvText(openingCsvTemplate())); return; }
  const data = dataset();
  if (data.error) return;
  if (target.closest?.('[data-acc-peak-add]')) { const peak = readPeakForm(data); peak.columns.push({ header: t('peak.newColumn'), field: 'blank' }); saveSettings({ peak }); return; }
  if (target.closest?.('[data-acc-peak-reset]')) { saveSettings({ peak: { columns: DEFAULT_PEAK_COLUMNS.map(column => ({ ...column })), dateFormat: 'dmy-ad' } }); return; }
  const move = target.closest?.('[data-acc-peak-move]');
  if (move) { const [index, step] = move.dataset.accPeakMove.split(':').map(Number); const peak = readPeakForm(data); const to = index + step; if (to >= 0 && to < peak.columns.length) { [peak.columns[index], peak.columns[to]] = [peak.columns[to], peak.columns[index]]; saveSettings({ peak }); } return; }
  const removeColumn = target.closest?.('[data-acc-peak-remove]');
  if (removeColumn) { const peak = readPeakForm(data); peak.columns.splice(Number(removeColumn.dataset.accPeakRemove), 1); if (peak.columns.length) saveSettings({ peak }); }
}
function onChange(event) {
  const target = event.target;
  const id = target?.id;
  if (id === 'acc-branch') { ui.branch = target.value === 'all' || BRANCH_IDS.includes(target.value) ? target.value : 'all'; render(); $(id)?.focus(); return; }
  if (id === 'acc-period') { ui.period = target.value; render(); $(id)?.focus(); return; }
  if (id === 'acc-account') { ui.account = target.value; render(); $(id)?.focus(); return; }
  if (id === 'acc-cogs-month-end') { saveSettings({ export: { cogsMonthEnd: target.checked } }); return; }
  if (target?.dataset?.accMl === 'account') { readManualForm(); render(); $(id)?.focus(); return; }
  if (id === 'acc-o-file' && target.files?.[0]) {
    const file = target.files[0];
    const asOf = $('acc-o-date')?.value || todayIso();
    const reader = new FileReader();
    reader.onload = () => previewOpening(String(reader.result || ''), asOf, file.name);
    reader.onerror = () => refuse(t('opening.error.csv'));
    reader.readAsText(file, 'utf-8');
    return;
  }
  if (id === 'acc-o-date' && ui.opening) { ui.opening.asOf = target.value; }
}
function onKeydown(event) {
  const tab = event.target.closest?.('[data-acc-tab]');
  if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const index = TABS.indexOf(tab.dataset.accTab);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
  ui.tab = TABS[next];
  render();
  $(`acc-tab-${ui.tab}`)?.focus();
}

window.ERPJournal = Object.freeze({
  VERSION: JOURNAL_CORE_VERSION,
  render,
  select: (options = {}) => {
    for (const [key, val] of Object.entries(options)) if (Object.prototype.hasOwnProperty.call(ui, key)) ui[key] = val;
    return render();
  },
  state: () => ({ ...ui }),
  view: () => current,
  dataset: () => dataset(),
  checks: (period, branch = 'all') => { const data = dataset(); return data.error ? { error: data.error } : buildChecks(data, period, branch); },
  setToday: iso => { todayOverride = String(iso || ''); cached = null; },
  invalidate: () => { cached = null; },
  saveSettings,
  saveManual,
  voidDocument,
  closeOverhead,
  postNrv,
  previewOpening,
  commitOpening,
  exportRows: name => exportTable(name),
  exportCsv,
  exportExcel,
  exportBackup,
  validateBackup,
  backupWrites,
  renderCoaCard,
  t
});

function boot() {
  const root = $(ROOT_ID);
  window.addEventListener(STORAGE_WRITTEN_EVENT, () => {
    cached = null;
    scheduleRender();
    const settingsOpen = $(`panel-${SETTINGS_PANEL_ID}`)?.classList.contains('active');
    if (settingsOpen && !$(COA_CARD_ID)?.contains(document.activeElement)) { try { renderCoaCard(); } catch (error) { console.error('[Journal] chart card failed', error); } } else coaStale = true;
  });
  window.addEventListener(COMPANY_PROFILE_CHANGED_EVENT, scheduleRender);
  window.addEventListener('erp:language-changed', () => {
    try { if (root?.childElementCount) render(); renderCoaCard(); } catch (error) { console.error('[Journal] render failed', error); }
  });
  document.addEventListener('erp:navigation', event => {
    const id = event.detail?.id;
    if (id === PANEL_ID) { try { render(); } catch (error) { console.error('[Journal] render failed', error); } }
    if (id === SETTINGS_PANEL_ID && (coaStale || !$(COA_CARD_ID)?.childElementCount)) { try { renderCoaCard(); } catch (error) { console.error('[Journal] chart card failed', error); } }
  });
  // The chart card mounts at once (empty) so the settings page keeps its order; it is drawn when the page is opened.
  mountCoaCard();
  coaStale = true;
  if (!root) return;
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('submit', onSubmit);
  root.addEventListener('keydown', onKeydown);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
