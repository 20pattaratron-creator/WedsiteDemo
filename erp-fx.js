// ============================================================================
// erp-fx.js — page "หลายสกุลเงิน" (Multi-currency, ADR-031, round 13B) + the settings card on ตั้งค่าบริษัท
// ERP DEMO 4.3.1
// ----------------------------------------------------------------------------
// Seven tabs (simple mode): อัตราแลกเปลี่ยน (the rate table: manual entry with evidence, corrections as new versions, CSV
// import with a preview, "which rate will a document dated … use") · เอกสารขาย (quotation / proforma and tax invoice /
// export invoice in a currency) · รับชำระ (receipts in the invoice currency, partial, realised exchange difference) ·
// เจ้าหนี้ต่างประเทศ (supplier invoices abroad and their payments: ภ.ง.ด.54, ภ.พ.36, gross-up) · ใบลด/เพิ่มหนี้ (in the
// invoice currency at the invoice's own rate) · ปิดเดือน (export values of goods + revaluation of open items, reversed on
// day 1) · ตั้งค่า (functional currency THB fixed, allowed currencies, the rate type chosen once, the approval to issue tax
// invoices in a currency, the ภ.ง.ด.54 rates — "ต้องยืนยัน").
// Rules are in erp-fx-core.js (pure); every baht amount of a document is computed ONCE by the document planners of
// erp-document-finance-core.js and stored. Reads are strict (a damaged store says so and stops); every write goes through
// ONE ERPIntegrity.transaction and is refused BEFORE anything is written when its date lies in a closed period or in a
// month already closed for foreign currencies. No network: the BOT adapter is a documented stub (erp-fx-core.js).
// Every text comes from i18n/en-fx.js (Thai and English); user data is escaped and marked data-no-i18n.
// ============================================================================
import {
  FX_CORE_VERSION, CURRENCIES, FOREIGN_CURRENCY_CODES, FX_RATE_TYPES, SALES_RATE_TYPES, RECEIPT_RATE_TYPES, LIABILITY_RATE_TYPE, FX_RATE_PERS, PND54_INCOME_TYPES, FX_SOURCE_NOTE_MIN,
  currencyInfo, isFxDocument, fxText, fxDateText, rateTypeLabel, normalizeFxSettings, planFxSettingsChange, normalizeFxRateStore, emptyFxRateStore, normalizeFxDocuments, emptyFxDocuments,
  planFxRateEntry, latestFxRates, lookupFxRate, fxRateFieldsOf, fxRateDateFor, planFxCsvImport, fxCsvTemplate, createUnavailableBotAdapter,
  planFxSalesAmounts, fxReceiptRecord, toMinorUnits, minorToMajor, formatMinor, formatFx, formatSatang, bahtToSatang, fxSatangToBaht, convertToSatang, divRoundHalfUp,
  fxInvoiceOpenItem, planFxReceipt, fxPayableOpenItem, planFxPayment, fxPaymentRecord, normalizeFxPayments, buildPnd54Report, buildPp36Report, fxForeignTable,
  planFxMonthEnd, postedFxClose, fxCloseCovering, VAT_PERCENT
} from './erp-fx-core.js';
import { FX_KEYS } from './i18n/en-fx.js';
import { translateKey } from './erp-i18n-core.js';
import { escapeHtml, localDateISO, roundMoneyValue } from './erp-shared-core.js';
import { planInvoiceDocumentAction, planQuoteDocumentAction, planReceiptDocumentAction, planExpenseDocumentAction, parseFinancialDocumentPackForWrite } from './erp-document-finance-core.js';
import { validateCreditNote, buildCreditNoteRecord, CREDIT_NOTE_REASONS } from './erp-credit-note-core.js';
import { validateDebitNote, buildDebitNoteRecord, DEBIT_NOTE_REASONS } from './erp-debit-note-core.js';
import { invoiceTermDueDate } from './erp-receivables-core.js';
import { withThaiCalendarMeta } from './erp-date-core.js';
import { taxCsvText, taxPeriodOfDate, addTaxPeriods, taxPeriodLastDay, planGoodsReceiptVatFields } from './erp-tax-reports-core.js';
import { liveBranchState, liveBranchLabel, BRANCH_IDS, HEAD_OFFICE_BRANCH_ID } from './erp-branches-core.js';
import { FX_SETTINGS_KEY, FX_RATES_KEY, FX_DOCUMENTS_KEY, STORAGE_WRITTEN_EVENT, COMPANY_PROFILE_CHANGED_EVENT } from './erp-storage-contracts.js';
import { withDemoWriteLease, SALES_LEDGER_WRITE_LEASE } from './erp-demo-concurrency.js';
import { icon } from './erp-icons.js';
import { toQm, toUc, valueOfQty } from './erp-costing-core.js';

const PANEL_ID = 'fx';
const ROOT_ID = 'fx-root';
const SETTINGS_PANEL_ID = 'saas-admin';
const CARD_ID = 'fx-settings-card';
const TABS = Object.freeze(['rates', 'sales', 'receipts', 'payables', 'adjust', 'monthEnd', 'settings']);
const EXPENSE_CATEGORIES = Object.freeze(['ค่าเช่าสถานที่', 'ค่าการตลาด', 'ค่าซ่อมบำรุง', 'ค่าขนส่ง/จัดส่ง', 'ค่าอุปกรณ์สำนักงาน', 'ค่าซื้อสินค้า/วัสดุของบริษัท', 'ภาษี/ค่าธรรมเนียม', 'อื่น ๆ']);
const ui = { tab: 'rates', rateCurrency: '', rateType: '', rateForm: null, lookup: null, csv: null, sale: null, receipt: null, expense: null, payment: null, adjust: null, purchase: null, receiveDate: '', period: '', message: null };
const $ = id => document.getElementById(id);
const esc = value => escapeHtml(String(value ?? ''));
const storageKey = base => window.ComformTenant?.storageKey?.(base) || base;
let todayOverride = '';
let cached = null;

// ---------------------------------------------------------------- language / formatting
const lang = () => (window.ERPI18n?.isEnglish?.() ? 'en' : 'th');
const t = (key, params = {}) => fxText(key, params, lang());
const MONEY = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = baht => MONEY.format(Number(baht) || 0);
const userText = value => `<span data-no-i18n>${esc(value)}</span>`;
const todayIso = () => todayOverride || localDateISO();
const dateText = iso => fxDateText(iso, lang());
const branchLabel = id => liveBranchLabel(id, id === HEAD_OFFICE_BRANCH_ID ? 'สำนักงานใหญ่' : 'สาขาที่ 00001');
const branchesOnScreen = () => { const state = liveBranchState(); return Array.isArray(state?.ids) && state.ids.length ? state.ids : [...BRANCH_IDS]; };
const actor = () => window.CurrentUser?.displayName || window.CurrentUser?.email || 'Local user';
const nowIso = () => new Date().toISOString();
const say = (message, type = 'info', ms) => window.notify?.(message, type, ms);
const monthLabel = period => { const [y, m] = String(period).split('-').map(Number); return y && m ? (lang() === 'en' ? `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}` : `${['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'][m - 1]} ${y + 543}`) : String(period); };
const errorText = error => (error?.name === 'FxError' ? t(error.key, error.params) : error?.details?.fxKey ? t(error.details.fxKey, error.details.fxParams || {}) : String(error?.message || error || ''));

// ---------------------------------------------------------------- strict reads
function readRaw(base) {
  try { return localStorage.getItem(storageKey(base)); }
  catch (error) { throw Object.assign(new Error(t('error.storage')), { fx: true }); }
}
const readSettings = () => normalizeFxSettings(readRaw(FX_SETTINGS_KEY));
const readRates = () => normalizeFxRateStore(readRaw(FX_RATES_KEY));
const readDocuments = () => normalizeFxDocuments(readRaw(FX_DOCUMENTS_KEY));
function readArray(base) {
  const raw = readRaw(base);
  if (raw === null || raw === undefined) return [];
  let rows;
  try { rows = JSON.parse(raw); } catch (error) { throw Object.assign(new Error(t('error.store', { what: base })), { fx: true }); }
  if (!Array.isArray(rows)) throw Object.assign(new Error(t('error.store', { what: base })), { fx: true });
  return rows;
}
// Everything the page shows, read strictly (a damaged store or month stops the page with the reason).
function compute() {
  const settings = readSettings();
  const rates = readRates();
  const documents = readDocuments();
  const integrity = window.ERPIntegrity;
  if (!integrity?.packs) throw Object.assign(new Error(t('error.notReady')), { fx: true });
  const packs = integrity.packs();
  const business = integrity.business();
  const expenses = [];
  for (const pack of packs) for (const row of Array.isArray(pack.data.expenses) ? pack.data.expenses : []) if (row && typeof row === 'object') expenses.push({ ...row, branch: pack.branch, _branch: pack.branch, _year: pack.year, _month: pack.month });
  const grKey = window.ERPProductionCore?.KEYS?.goodsReceipts;
  const goodsReceipts = grKey ? readArray(grKey).filter(row => row && typeof row === 'object') : [];
  for (const row of [...expenses, ...goodsReceipts]) if (isFxDocument(row)) normalizeFxPayments(row.fxPayments, String(row.no || row.docNo || row.id));
  const invoices = business.invoices.filter(row => row._type === 'invoices');
  return { settings, rates, documents, packs, business, invoices, expenses, goodsReceipts, today: todayIso(), error: null };
}
function dataset() {
  if (cached && cached.today === todayIso()) return cached;
  let out;
  try { out = compute(); }
  catch (error) {
    if (!error?.fx && error?.name !== 'FxError' && !window.ERPIntegrity?.isReadError?.(error)) throw error;
    out = { today: todayIso(), error };
  }
  cached = out;
  const drop = () => { if (cached === out) cached = null; };
  if (typeof queueMicrotask === 'function') queueMicrotask(drop); else Promise.resolve().then(drop);
  return out;
}
function errorHtml(error) {
  if (window.ERPIntegrity?.isReadError?.(error)) return window.ERPIntegrity.readErrorHtml(error);
  return `<div class="afc-box afc-box-error" role="alert"><b>${esc(t('error.title'))}</b> <span data-no-i18n>${esc(errorText(error))}</span></div>`;
}

// ---------------------------------------------------------------- the document collections in a currency
const live = row => !!row && !row.voided && !row.cancelled && !row.reversed && row.status !== 'cancelled' && row.status !== 'voided';
const keyOfInvoice = row => `${row._branch}|${row._year}|${row._month}|${row.id}`;
const keyOfExpense = row => `exp|${row._branch}|${row._year}|${row._month}|${row.id}`;
const keyOfGr = row => `gr|${row.id}`;
function fxInvoices(data) { return data.invoices.filter(row => isFxDocument(row)); }
function fxQuotes(data) { return data.business.quotes.filter(row => isFxDocument(row)); }
function relatedOf(data, invoice) {
  const integrity = window.ERPIntegrity;
  const receipts = data.business.receipts.filter(row => integrity.receiptMatches(row, invoice));
  const match = list => list.filter(note => (Array.isArray(note.lines) ? note.lines : []).some(line => integrity.creditNoteMatches(line, note, invoice)));
  return { receipts, creditNotes: match(data.business.creditNotes), debitNotes: match(data.business.debitNotes) };
}
function openInvoices(data) {
  return fxInvoices(data).filter(live).map(invoice => ({ invoice, open: fxInvoiceOpenItem(invoice, relatedOf(data, invoice)) })).filter(row => row.open.openFx > 0);
}
// AR aging (erp-receivables.js): the open currency amount of each multi-currency invoice, keyed branch|id. Read from
// the same dataset as this page so the aging and the receipt form never disagree.
let openFxCache = null;
function openFxOf(invoice) {
  if (!isFxDocument(invoice)) return null;
  const data = dataset();
  if (data.error) return null;
  if (!openFxCache || openFxCache.data !== data) {
    const map = new Map();
    for (const invoiceRow of fxInvoices(data).filter(live)) {
      const open = fxInvoiceOpenItem(invoiceRow, relatedOf(data, invoiceRow));
      map.set(`${invoiceRow._branch}|${invoiceRow.id}`, { currency: open.currency, openFx: open.openFx, openText: formatMinor(open.openFx, open.currency), totalText: formatMinor(open.totalFx, open.currency) });
    }
    openFxCache = { data, map };
  }
  return openFxCache.map.get(`${invoice._branch || invoice.branch}|${invoice.id}`) || null;
}
function fxPayables(data) {
  return [
    ...data.expenses.filter(row => isFxDocument(row) && live(row) && row.deleted !== true).map(record => ({ kind: 'expense', key: keyOfExpense(record), record, open: fxPayableOpenItem(record, 'expense') })),
    ...data.goodsReceipts.filter(row => isFxDocument(row) && !row.reversed).map(record => ({ kind: 'gr', key: keyOfGr(record), record, open: fxPayableOpenItem(record, 'gr') }))
  ];
}
function usedRateIds(data) {
  const counts = new Map();
  const count = id => { if (id) counts.set(id, (counts.get(id) || 0) + 1); };
  for (const list of [data.invoices, data.business.quotes, data.business.receipts, data.business.creditNotes, data.business.debitNotes, data.expenses, data.goodsReceipts]) for (const row of list) {
    if (isFxDocument(row)) count(row.fxRateId);
    for (const payment of Array.isArray(row.fxPayments) ? row.fxPayments : []) count(payment.fxRateId);
  }
  for (const close of data.documents.closes) for (const row of [...close.rows, ...close.exportValues]) count(row.rateId);
  return counts;
}

// ---------------------------------------------------------------- writes
const newId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// A write session over the month packs: every changed pack and the multi-currency stores go out in ONE transaction.
function packSession() {
  const packs = new Map();
  const dirty = new Set();
  const keyOf = (branch, year, month) => storageKey(`biz2_${branch}_${year}_${String(Number(month) + 1).padStart(2, '0')}`);
  return {
    get(branch, year, month) {
      const key = keyOf(branch, year, month);
      if (!packs.has(key)) packs.set(key, parseFinancialDocumentPackForWrite(localStorage.getItem(key)));
      return packs.get(key);
    },
    mark(branch, year, month) { dirty.add(keyOf(branch, year, month)); },
    writes() { return [...dirty].map(key => [key, JSON.stringify(packs.get(key))]); }
  };
}
function commit(writes, audit = {}) {
  window.ERPIntegrity.transaction(writes);
  cached = null;
  window.ERPIntegrity.changed?.();
  window.ERPJournal?.invalidate?.();
  window.ERPCosting?.invalidate?.();
  try { window.ERPProductionCore?.audit?.(audit.action || 'update', 'multi_currency', audit.ref || '', audit.text || '', { branch: audit.branch || '' }); }
  catch (error) { console.warn('[FX] audit log write failed (data already saved)', error); }
  for (const name of ['renderIList', 'renderRList', 'renderQList', 'renderDash', 'renderEList']) { try { window[name]?.(); } catch (error) { console.warn(`[FX] ${name} refresh failed`, error); } }
}
function refuse(message) {
  ui.message = { type: 'error', text: message };
  say(message, 'error', 8000);
  scheduleRender();
  return { ok: false, message };
}
function done(message, extra = {}) {
  ui.message = { type: 'success', text: message };
  say(message, 'success');
  scheduleRender();
  return { ok: true, message, ...extra };
}
// The closed-period text of a date (sales or purchase scope), '' when open.
function lockText(scope, branch, date, action) {
  return window.ERPGovernance?.periodLockRefusal?.({ scope, branch, date, action }) || '';
}
function closedFxMonth(data, date) {
  const close = fxCloseCovering(data.documents, date);
  return close ? t('error.fxClosed', { period: monthLabel(close.period) }) : '';
}
// Next running number like app.js getNextDocumentNumber(): PREFIX + พ.ศ. yy + mm + 2 digits.
function nextNumber(data, prefix, date, collections, allPeriods = false) {
  const [year, month] = date.split('-').map(Number);
  const head = `${prefix}${String(year + 543).slice(-2)}${String(month).padStart(2, '0')}`;
  let max = 0;
  for (const pack of data.packs) {
    if (!allPeriods && !(pack.year === year && pack.month === month - 1)) continue;
    for (const collection of collections) for (const row of Array.isArray(pack.data[collection]) ? pack.data[collection] : []) {
      const no = String(row?.no || '').trim().toUpperCase();
      if (no.startsWith(head) && /^\d+$/.test(no.slice(head.length))) max = Math.max(max, Number(no.slice(head.length)));
    }
  }
  return `${head}${String(max + 1).padStart(2, '0')}`;
}
function nextPaymentNo(data, date) {
  const [year, month] = date.split('-').map(Number);
  const head = `FXP${String(year + 543).slice(-2)}${String(month).padStart(2, '0')}`;
  let max = 0;
  for (const row of [...data.expenses, ...data.goodsReceipts]) for (const payment of Array.isArray(row.fxPayments) ? row.fxPayments : []) {
    const no = String(payment.no || '');
    if (no.startsWith(head) && /^\d+$/.test(no.slice(head.length))) max = Math.max(max, Number(no.slice(head.length)));
  }
  return `${head}${String(max + 1).padStart(2, '0')}`;
}
const periodOf = date => { const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(date || '')); return match ? { year: Number(match[1]), month: Number(match[2]) - 1 } : null; };
const productRows = () => (typeof window.productMasterRows === 'function' ? window.productMasterRows() : []) || [];
function productOf(text) {
  const value = String(text || '').trim().toLowerCase();
  if (!value) return null;
  return productRows().find(row => String(row.code || '').trim().toLowerCase() === value || String(row.name || '').trim().toLowerCase() === value) || null;
}

// ---------------------------------------------------------------- rate table actions
function saveRate(input = {}) {
  const data = dataset();
  if (data.error) return refuse(errorText(data.error));
  const plan = planFxRateEntry(data.rates, input, { today: todayIso(), at: nowIso(), by: actor() });
  if (!plan.ok) return refuse(t(plan.key, plan.params));
  try { commit([[storageKey(FX_RATES_KEY), plan.store]], { action: input.correct ? 'update' : 'create', ref: plan.row.id, text: `${plan.row.currency} ${plan.row.type} ${plan.row.date} = ${plan.row.rate}/${plan.row.per}` }); }
  catch (error) { return refuse(t('error.save', { detail: errorText(error) })); }
  ui.rateForm = null;
  return done(t(input.correct ? 'rate.corrected' : 'rate.saved', { currency: plan.row.currency, date: plan.row.date, value: plan.row.rate, version: plan.row.version }), { row: plan.row });
}
function previewCsv(content, fileName = '', allowCorrections = false) {
  const data = dataset();
  if (data.error) return refuse(errorText(data.error));
  const plan = planFxCsvImport(data.rates, content, { today: todayIso(), at: nowIso(), by: actor(), allowCorrections });
  ui.csv = { content, fileName, allowCorrections, plan };
  ui.tab = 'rates';
  scheduleRender();
  return plan;
}
function commitCsv() {
  const csv = ui.csv;
  if (!csv) return refuse(t('csv.nothing'));
  const fresh = previewCsv(csv.content, csv.fileName, csv.allowCorrections);
  if (fresh.headerError) return refuse(t(fresh.headerError.key, fresh.headerError.params));
  if (fresh.counts.error) return refuse(t('csv.hasErrors', { n: fresh.counts.error }));
  if (!fresh.counts.add && !fresh.counts.correct) return refuse(t('csv.nothingNew'));
  try { commit([[storageKey(FX_RATES_KEY), fresh.store]], { action: 'import', ref: csv.fileName, text: t('csv.audit', { add: fresh.counts.add, correct: fresh.counts.correct }) }); }
  catch (error) { return refuse(t('error.save', { detail: errorText(error) })); }
  ui.csv = null;
  return done(t('csv.imported', { add: fresh.counts.add, correct: fresh.counts.correct, skip: fresh.counts.skip }));
}

// ---------------------------------------------------------------- settings
function saveSettings(patch = {}, context = {}) {
  const data = dataset();
  if (data.error) return refuse(errorText(data.error));
  const documentsExist = data.invoices.some(isFxDocument) || data.business.quotes.some(isFxDocument) || data.expenses.some(isFxDocument);
  const plan = planFxSettingsChange(data.settings, patch, { ...context, documentsExist, at: nowIso(), by: actor() });
  if (!plan.ok) return refuse(t(plan.key, plan.params));
  try { commit([[storageKey(FX_SETTINGS_KEY), plan.settings]], { action: 'update', ref: 'fx-settings', text: t('settings.audit') }); }
  catch (error) { return refuse(t('error.save', { detail: errorText(error) })); }
  return done(t('settings.saved'), { settings: plan.settings });
}

// ---------------------------------------------------------------- sales documents (quotation / proforma, invoice)
function blankSale(data) {
  return { kind: 'invoice', branch: HEAD_OFFICE_BRANCH_ID, date: todayIso(), customer: '', customerAddress: '', customerTaxId: '', customerCountry: '', currency: data?.settings?.allowedCurrencies?.[0] || '', vat: 'zero', exportKind: 'goods', exportDeclarationNo: '', exportDate: '', creditTerm: 'credit30', note: '', lines: [{ product: '', qty: '1', unit: 'ชิ้น', priceFx: '' }], quote: null };
}
// The rate a sales document of `date` uses (the company's type) — or the missing-rate message.
function saleRate(data, draft) {
  if (!draft.currency) return { ok: false, key: 'sale.chooseCurrency', params: {} };
  return lookupFxRate(data.rates, { currency: draft.currency, date: draft.date, type: data.settings.rateType });
}
function saleItems(draft) {
  return draft.lines.filter(line => String(line.product || '').trim()).map(line => {
    const product = productOf(line.product);
    const qty = Number(line.qty);
    const costUnit = Number(product?.standardCost) || 0;
    return { product: product?.name || String(line.product).trim(), productCode: product?.code || '', productCategory: product?.category || '', flowType: product?.flowType || 'non_inventory', fulfillmentType: product?.fulfillmentType || 'made_to_order', qty, unit: line.unit || product?.unit || 'ชิ้น', priceFx: String(line.priceFx ?? '').trim(), costMode: 'unit', costValue: costUnit, costUnit, costLump: 0, costTotal: qty * costUnit, salesOrderLineId: '', costAllocation: null };
  });
}
// The stored record of a sales draft before the planner converts it (the planner computes every baht field).
function saleRecord(data, draft, lookup, no) {
  const vatMode = draft.vat === 'add' ? 'add' : 'none';
  const base = {
    id: Date.now(), no, date: draft.date, branch: draft.branch, customer: String(draft.customer).trim(), customerAddress: String(draft.customerAddress).trim(), customerTaxId: String(draft.customerTaxId).trim(),
    customerCountry: String(draft.customerCountry || '').trim(), contact: '', phone: '', email: '', customerAgencyGroup: 'other', customerAgencyGroupLabel: 'อื่น ๆ / ไม่ระบุ', customerAgencyType: 'other', customerAgencyTypeLabel: 'อื่น ๆ / ไม่ระบุ', customerPrefix: '',
    customerBranchCode: '', customerBranchName: '', salesPerson: '', items: saleItems(draft), useVat: vatMode === 'add' ? 1 : 2, vatMode, note: String(draft.note || '').trim(), attachments: [],
    currency: draft.currency, ...fxRateFieldsOf(lookup)
  };
  if (draft.kind === 'quote') return { ...base, approved: false };
  const record = { ...base, taxInvoiceForm: 'full', creditTerm: draft.creditTerm, dueDate: invoiceTermDueDate(draft.date, draft.creditTerm), vatCategory: draft.vat === 'zero' ? 'zero' : draft.vat === 'none' ? 'exempt' : 'standard', commMode: 'manual', commRate: 0, commAmt: 0, paymentManaged: true, createdAt: nowIso() };
  if (draft.vat === 'zero') Object.assign(record, { exportKind: draft.exportKind === 'service' ? 'service' : 'goods', exportDeclarationNo: String(draft.exportDeclarationNo || '').trim(), exportDate: String(draft.exportDate || '').trim() });
  if (draft.quote) Object.assign(record, { sourceQuoteId: draft.quote.id, sourceQuoteNo: draft.quote.no, sourceQuoteBranch: draft.quote.branch, sourceQuoteYear: draft.quote.year, sourceQuoteMonth: draft.quote.month });
  return record;
}
async function saveSale(draftInput = null) {
  return withDemoWriteLease(SALES_LEDGER_WRITE_LEASE, () => saveSaleUnlocked(draftInput));
}
function saveSaleUnlocked(draftInput) {
  const data = dataset();
  if (data.error) return refuse(errorText(data.error));
  const draft = draftInput || ui.sale;
  if (!draft) return refuse(t('sale.empty'));
  if (!data.settings.allowedCurrencies.includes(draft.currency)) return refuse(fxText('currency.notAllowed', { currency: draft.currency || '-' }, lang()));
  if (!periodOf(draft.date)) return refuse(t('sale.date'));
  if (draft.date > todayIso()) return refuse(t('sale.future'));
  if (!BRANCH_IDS.includes(draft.branch)) return refuse(t('sale.branch'));
  const kind = draft.kind === 'quote' ? 'quote' : 'invoice';
  if (kind === 'invoice') { const profile = window.ERPCompanyProfile?.issueRefusal?.(); if (profile) return refuse(profile); }
  const lock = kind === 'invoice' ? lockText('sales', draft.branch, draft.date, 'invoice_create') : '';
  if (lock) return refuse(lock);
  const closed = kind === 'invoice' ? closedFxMonth(data, draft.date) : '';
  if (closed) return refuse(closed);
  const lookup = saleRate(data, draft);
  if (!lookup.ok) return refuse(t(lookup.key, lookup.params));
  const no = kind === 'quote' ? nextNumber(data, 'QT', draft.date, ['quotes']) : nextNumber(data, 'INV', draft.date, ['invoices']);
  const { year, month } = periodOf(draft.date);
  let record;
  try {
    const fx = { allowedCurrencies: data.settings.allowedCurrencies, approval: data.settings.taxInvoiceApproval.no ? data.settings.taxInvoiceApproval : null };
    const draftRecord = saleRecord(data, draft, lookup, no);
    if (kind === 'quote') record = planQuoteDocumentAction({ draft: draftRecord, original: null, duplicateNumber: false, linkedDownstream: false, fx }).record;
    else {
      const stock = window.ERPProductionCore?.validateInvoiceStock?.(draft.branch, draftRecord.items, '', '');
      if (stock && !stock.ok) return refuse(stock.message);
      record = planInvoiceDocumentAction({ draft: draftRecord, original: null, duplicateNumber: false, paymentSummary: null, fx }).record;
      window.ERPIntegrity.validateDelivery(record, '');
    }
    record = withThaiCalendarMeta(record, year, month);
  } catch (error) { return refuse(errorText(error)); }
  const session = packSession();
  try {
    const pack = session.get(draft.branch, year, month);
    const collection = kind === 'quote' ? 'quotes' : 'invoices';
    pack[collection] = Array.isArray(pack[collection]) ? pack[collection] : [];
    pack[collection].push(record);
    session.mark(draft.branch, year, month);
    if (draft.quote && kind === 'invoice') {
      const quotePack = session.get(draft.quote.branch, draft.quote.year, draft.quote.month);
      const quote = (quotePack.quotes || []).find(row => String(row.id) === String(draft.quote.id));
      if (quote) { Object.assign(quote, { invoiceId: record.id, invoiceNo: record.no, invoiceStatus: 'created', workflowUpdatedAt: nowIso() }); session.mark(draft.quote.branch, draft.quote.year, draft.quote.month); }
    }
    commit(session.writes(), { action: 'create', ref: record.no, branch: draft.branch, text: `${record.no} ${record.currency} ${record.amountFx} = ${money(record.total)}` });
  } catch (error) { return refuse(t('error.save', { detail: errorText(error) })); }
  ui.sale = null;
  return done(t(kind === 'quote' ? 'sale.savedQuote' : 'sale.savedInvoice', { no: record.no, amount: formatFx(toMinorUnits(record.amountFx, record.currency), record.currency), thb: money(record.total) }), { record });
}
function saleFromQuote(data, quote) {
  const draft = blankSale(data);
  return { ...draft, kind: 'invoice', branch: quote._branch, customer: quote.customer || '', customerAddress: quote.customerAddress || '', customerTaxId: quote.customerTaxId || '', customerCountry: quote.customerCountry || '', currency: quote.currency, vat: quote.vatMode === 'add' ? 'add' : 'zero', lines: (quote.items || []).map(item => ({ product: item.productCode || item.product, qty: String(item.qty), unit: item.unit || 'ชิ้น', priceFx: String(item.priceFx ?? '') })), quote: { id: quote.id, no: quote.no, branch: quote._branch, year: quote._year, month: quote._month } };
}

// ---------------------------------------------------------------- receipts in a currency
function blankReceipt(data) {
  return { invoiceKey: '', date: todayIso(), amountFx: '', rateType: data?.settings?.rateType || 'bot_avg_buying', note: '' };
}
function receiptPlan(data, draft) {
  const invoice = fxInvoices(data).find(row => keyOfInvoice(row) === draft.invoiceKey);
  if (!invoice) return { error: t('receipt.chooseInvoice') };
  if (!RECEIPT_RATE_TYPES.includes(draft.rateType)) return { invoice, error: fxText('rate.type', { type: draft.rateType }, lang()) };
  const lookup = lookupFxRate(data.rates, { currency: invoice.currency, date: draft.date, type: draft.rateType });
  if (!lookup.ok) return { invoice, lookup, error: t(lookup.key, lookup.params) };
  try {
    const plan = planFxReceipt({ invoice, related: relatedOf(data, invoice), date: draft.date, amountFx: draft.amountFx, ...fxRateFieldsOf(lookup) });
    return { invoice, lookup, plan };
  } catch (error) { return { invoice, lookup, error: errorText(error) }; }
}
async function saveReceipt(draftInput = null) {
  return withDemoWriteLease(SALES_LEDGER_WRITE_LEASE, () => saveReceiptUnlocked(draftInput));
}
function saveReceiptUnlocked(draftInput) {
  const data = dataset();
  if (data.error) return refuse(errorText(data.error));
  const draft = draftInput || ui.receipt;
  if (!draft) return refuse(t('receipt.chooseInvoice'));
  if (!periodOf(draft.date)) return refuse(fxText('receipt.date', {}, lang()));
  if (draft.date > todayIso()) return refuse(t('sale.future'));
  const result = receiptPlan(data, draft);
  if (result.error) return refuse(result.error);
  const { invoice, plan, lookup } = result;
  const lock = lockText('sales', invoice._branch, draft.date, 'receipt_create');
  if (lock) return refuse(lock);
  const closed = closedFxMonth(data, draft.date);
  if (closed) return refuse(closed);
  const { year, month } = periodOf(draft.date);
  const record = withThaiCalendarMeta(fxReceiptRecord(invoice, plan, lookup, { id: Date.now(), no: nextNumber(data, 'REC', draft.date, ['receipts']), date: draft.date, note: String(draft.note || '').trim(), createdAt: nowIso() }), year, month);
  try {
    const summary = window.ERPIntegrity.paymentSummary(invoice, window.ERPIntegrity.paymentContext(data.business));
    planReceiptDocumentAction({ draft: record, original: null, duplicateNumber: false, referenceInvoice: invoice, paymentSummary: summary });
  } catch (error) { return refuse(errorText(error)); }
  const session = packSession();
  try {
    const pack = session.get(invoice._branch, year, month);
    pack.receipts = Array.isArray(pack.receipts) ? pack.receipts : [];
    pack.receipts.push(record);
    session.mark(invoice._branch, year, month);
    commit(session.writes(), { action: 'create', ref: record.no, branch: invoice._branch, text: `${record.no} ${record.currency} ${record.amountFx} · ${money(record.amountThb)} · ${money(record.fxRealisedThb)}` });
    window.ERPIntegrity.reconcilePayments?.();
  } catch (error) { return refuse(t('error.save', { detail: errorText(error) })); }
  ui.receipt = null;
  return done(t('receipt.saved', { no: record.no, amount: formatFx(plan.amountFxMinor, plan.currency), thb: money(record.amountThb), diff: money(record.fxRealisedThb) }), { record });
}

// ---------------------------------------------------------------- payables abroad (supplier invoices, payments)
function blankExpense(data) {
  return { branch: HEAD_OFFICE_BRANCH_ID, date: todayIso(), vendor: '', payeeCountry: '', payeeAddress: '', cat: 'อื่น ๆ', desc: '', docNo: '', currency: data?.settings?.allowedCurrencies?.[0] || '', amountFx: '' };
}
function expenseRate(data, draft) {
  if (!draft.currency) return { ok: false, key: 'sale.chooseCurrency', params: {} };
  return lookupFxRate(data.rates, { currency: draft.currency, date: draft.date, type: LIABILITY_RATE_TYPE });
}
function saveExpense(draftInput = null) {
  const data = dataset();
  if (data.error) return refuse(errorText(data.error));
  const draft = draftInput || ui.expense;
  if (!draft) return refuse(t('expense.empty'));
  if (!data.settings.allowedCurrencies.includes(draft.currency)) return refuse(fxText('currency.notAllowed', { currency: draft.currency || '-' }, lang()));
  if (!periodOf(draft.date)) return refuse(t('sale.date'));
  if (draft.date > todayIso()) return refuse(t('sale.future'));
  if (!BRANCH_IDS.includes(draft.branch)) return refuse(t('sale.branch'));
  const lock = lockText('purchase', draft.branch, draft.date, 'expense_create');
  if (lock) return refuse(lock);
  const closed = closedFxMonth(data, draft.date);
  if (closed) return refuse(closed);
  const lookup = expenseRate(data, draft);
  if (!lookup.ok) return refuse(t(lookup.key, lookup.params));
  const minor = toMinorUnits(draft.amountFx, draft.currency);
  if (minor === null) return refuse(fxText('amount.decimals', { currency: draft.currency, minor: currencyInfo(draft.currency).minor }, lang()));
  if (!(minor > 0)) return refuse(fxText('amount.invalid', {}, lang()));
  const amount = fxSatangToBaht(convertToSatang(minor, draft.currency, lookup.rate, lookup.per));
  const { year, month } = periodOf(draft.date);
  let record;
  try {
    const plan = planExpenseDocumentAction({ draft: { id: Date.now(), date: draft.date, branch: draft.branch, cat: draft.cat, desc: String(draft.desc || '').trim(), amount, vendor: String(draft.vendor || '').trim(), docType: 'invoice', taxStatus: 'not_required', purpose: 'company', docNo: String(draft.docNo || '').trim(), attachments: [], createdAt: nowIso() } });
    record = { ...plan.record, currency: draft.currency, ...fxRateFieldsOf(lookup), amountFx: minorToMajor(minor, draft.currency), amountThb: amount, payeeCountry: String(draft.payeeCountry || '').trim(), payeeAddress: String(draft.payeeAddress || '').trim(), fxPayments: [] };
    if (!record.vendor) return refuse(t('expense.vendor'));
  } catch (error) { return refuse(errorText(error)); }
  const session = packSession();
  try {
    const pack = session.get(draft.branch, year, month);
    pack.expenses = Array.isArray(pack.expenses) ? pack.expenses : [];
    pack.expenses.push(record);
    session.mark(draft.branch, year, month);
    commit(session.writes(), { action: 'create', ref: record.docNo || record.desc, branch: draft.branch, text: `${record.currency} ${record.amountFx} = ${money(record.amount)}` });
  } catch (error) { return refuse(t('error.save', { detail: errorText(error) })); }
  ui.expense = null;
  return done(t('expense.saved', { vendor: record.vendor, amount: formatFx(minor, record.currency), thb: money(record.amount) }), { record });
}
function blankPayment(data, payable = null) {
  const record = payable?.record || {};
  const rate = data?.settings?.pnd54Rates?.service ?? 15;
  return { targetKey: payable?.key || '', date: todayIso(), amountFx: payable ? String(minorToMajor(payable.open.openFx, payable.open.currency)) : '', wht: { enabled: payable?.kind === 'expense', incomeType: 'service', rate: String(rate), grossUp: false, payeeName: record.vendor || record.supplier || '', payeeCountry: record.payeeCountry || '', payeeAddress: record.payeeAddress || '', payeeTaxRef: '', dtaNote: '' }, pp36: { enabled: payable?.kind === 'expense' }, note: '' };
}
function paymentPlan(data, draft) {
  const payable = fxPayables(data).find(row => row.key === draft.targetKey);
  if (!payable) return { error: t('payment.choose') };
  const lookup = lookupFxRate(data.rates, { currency: payable.record.currency, date: draft.date, type: LIABILITY_RATE_TYPE });
  if (!lookup.ok) return { payable, lookup, error: t(lookup.key, lookup.params) };
  try {
    const plan = planFxPayment({ record: payable.record, kind: payable.kind, date: draft.date, amountFx: draft.amountFx, ...fxRateFieldsOf(lookup), wht: draft.wht?.enabled ? { ...draft.wht, enabled: true } : null, pp36: draft.pp36?.enabled ? { enabled: true } : null });
    return { payable, lookup, plan };
  } catch (error) { return { payable, lookup, error: errorText(error) }; }
}
function savePayment(draftInput = null) {
  const data = dataset();
  if (data.error) return refuse(errorText(data.error));
  const draft = draftInput || ui.payment;
  if (!draft) return refuse(t('payment.choose'));
  if (!periodOf(draft.date)) return refuse(fxText('payment.date', {}, lang()));
  if (draft.date > todayIso()) return refuse(t('sale.future'));
  const result = paymentPlan(data, draft);
  if (result.error) return refuse(result.error);
  const { payable, plan, lookup } = result;
  const branch = payable.record._branch || payable.record.branch;
  for (const date of [draft.date, plan.pp36 ? `${plan.pp36.claimPeriod}-01` : ''].filter(Boolean)) { const lock = lockText('purchase', branch, date, 'fx_payment'); if (lock) return refuse(lock); }
  const closed = closedFxMonth(data, draft.date);
  if (closed) return refuse(closed);
  const row = fxPaymentRecord(plan, { id: newId('fxp'), no: nextPaymentNo(data, draft.date), date: draft.date, branch, ...fxRateFieldsOf(lookup), note: draft.note, createdAt: nowIso(), createdBy: actor() });
  try {
    if (payable.kind === 'expense') {
      const session = packSession();
      const pack = session.get(branch, payable.record._year, payable.record._month);
      const stored = (pack.expenses || []).find(item => String(item.id) === String(payable.record.id));
      if (!stored) return refuse(t('payment.missing'));
      stored.fxPayments = [...(Array.isArray(stored.fxPayments) ? stored.fxPayments : []), row];
      normalizeFxPayments(stored.fxPayments, String(stored.docNo || stored.id));
      session.mark(branch, payable.record._year, payable.record._month);
      commit(session.writes(), { action: 'create', ref: row.no, branch, text: `${row.no} ${row.currency} ${row.amountFx} · ${money(row.cashThb)}` });
    } else {
      const key = window.ERPProductionCore?.KEYS?.goodsReceipts;
      const rows = readArray(key);
      const stored = rows.find(item => String(item.id) === String(payable.record.id));
      if (!stored) return refuse(t('payment.missing'));
      stored.fxPayments = [...(Array.isArray(stored.fxPayments) ? stored.fxPayments : []), row];
      normalizeFxPayments(stored.fxPayments, String(stored.no || stored.id));
      commit([[storageKey(key), rows]], { action: 'create', ref: row.no, branch, text: `${row.no} ${row.currency} ${row.amountFx}` });
    }
  } catch (error) { return refuse(t('error.save', { detail: errorText(error) })); }
  ui.payment = null;
  return done(t('payment.saved', { no: row.no, amount: formatFx(plan.amountFxMinor, plan.currency), thb: money(row.cashThb), wht: money(row.wht?.whtThb || 0), vat: money(row.pp36?.vatThb || 0) }), { row });
}
function voidPayment(targetKey, paymentId, reason = '') {
  const data = dataset();
  if (data.error) return refuse(errorText(data.error));
  const payable = fxPayables(data).find(row => row.key === targetKey);
  const payment = payable?.record.fxPayments?.find(row => row.id === paymentId);
  if (!payable || !payment || payment.status === 'voided') return refuse(t('payment.missing'));
  const branch = payable.record._branch || payable.record.branch;
  for (const date of [payment.date, todayIso()]) { const lock = lockText('purchase', branch, date, 'fx_payment_void'); if (lock) return refuse(lock); }
  const closed = closedFxMonth(data, payment.date);
  if (closed) return refuse(closed);
  const later = payable.record.fxPayments.filter(row => row.status !== 'voided' && row.id !== paymentId && (row.date > payment.date || (row.date === payment.date && String(row.no) > String(payment.no))));
  if (later.length) return refuse(t('payment.voidLater', { no: later[0].no }));
  const mark = row => (row.id === paymentId ? { ...row, status: 'voided', voidedAt: nowIso(), voidReason: String(reason || '').trim().slice(0, 200) } : row);
  try {
    if (payable.kind === 'expense') {
      const session = packSession();
      const pack = session.get(branch, payable.record._year, payable.record._month);
      const stored = (pack.expenses || []).find(item => String(item.id) === String(payable.record.id));
      stored.fxPayments = stored.fxPayments.map(mark);
      session.mark(branch, payable.record._year, payable.record._month);
      commit(session.writes(), { action: 'void', ref: payment.no, branch, text: reason });
    } else {
      const key = window.ERPProductionCore?.KEYS?.goodsReceipts;
      const rows = readArray(key);
      const stored = rows.find(item => String(item.id) === String(payable.record.id));
      stored.fxPayments = stored.fxPayments.map(mark);
      commit([[storageKey(key), rows]], { action: 'void', ref: payment.no, branch, text: reason });
    }
  } catch (error) { return refuse(t('error.save', { detail: errorText(error) })); }
  return done(t('payment.voided', { no: payment.no }));
}

// ---------------------------------------------------------------- purchase orders / goods receipts in a currency
// A PO in a currency is a commitment: its baht is an ESTIMATE at the selling rate of the PO day (nothing is booked). The
// goods receipt is the liability: the selling rate of the RECEIPT day converts the currency subtotal ONCE (half-up), the
// lines get their share (largest remainder), and each line's baht unit cost (= its baht ÷ qty) goes to the stock movement
// the costing engine values. No Thai VAT on the supplier's document (VAT on imported goods is paid to Customs, outside this
// demo). The receipt is a payable in the currency, paid on the page "เจ้าหนี้ต่างประเทศ" (selling rate of the payment day).
const PO_KEY = 'comform_purchase_orders_v1', GR_KEY = 'comform_goods_receipts_v1', MOVE_KEY = 'comform_inventory_movements_v1';
function blankPurchase(data) {
  return { branch: HEAD_OFFICE_BRANCH_ID, date: todayIso(), supplier: '', supplierCountry: '', currency: data?.settings?.allowedCurrencies?.[0] || '', note: '', lines: [{ product: '', qty: '1', unit: 'ชิ้น', priceFx: '' }] };
}
function opsNo(rows, prefix, date) {
  const [year, month] = date.split('-').map(Number);
  const head = `${prefix}${String(year + 543).slice(-2)}${String(month).padStart(2, '0')}`;
  let max = 0;
  for (const row of rows) { const match = new RegExp(`^${head}(\\d{2,3})$`).exec(String(row?.no || '')); if (match) max = Math.max(max, Number(match[1])); }
  return `${head}${String(max + 1).padStart(2, '0')}`;
}
// Lines of a purchase draft → [{ product fields, qty, unit, priceFx }] (products from the product master when known).
function purchaseLines(draft) {
  return draft.lines.filter(line => String(line.product || '').trim()).map(line => {
    const product = productOf(line.product);
    return { productCode: product?.code || '', product: product?.name || String(line.product).trim(), fulfillmentType: product?.fulfillmentType || '', flowType: product?.flowType || '', qty: Number(line.qty), unit: line.unit || product?.unit || 'ชิ้น', priceFx: String(line.priceFx ?? '').trim() };
  });
}
// The baht of purchase lines at a selling-rate lookup (the same conversion as a sales document, without VAT).
function purchaseAmounts(lines, currency, lookup) {
  const plan = planFxSalesAmounts({ currency, lines: lines.map(line => ({ qty: line.qty, priceFx: line.priceFx })), vatMode: 'none', rate: lookup.rate, per: lookup.per });
  return { plan, items: lines.map((line, index) => { const amountThb = fxSatangToBaht(plan.lines[index].amountThbSatang); return { ...line, priceFx: Number(line.priceFx), amountFx: minorToMajor(plan.lines[index].amountFxMinor, currency), amountThb, unitCost: line.qty > 0 ? amountThb / line.qty : 0 }; }) };
}
function savePurchase(draftInput = null) {
  const data = dataset();
  if (data.error) return refuse(errorText(data.error));
  const draft = draftInput || ui.purchase;
  if (!draft) return refuse(t('purchase.empty'));
  if (!data.settings.allowedCurrencies.includes(draft.currency)) return refuse(fxText('currency.notAllowed', { currency: draft.currency || '-' }, lang()));
  if (!periodOf(draft.date)) return refuse(t('sale.date'));
  if (draft.date > todayIso()) return refuse(t('sale.future'));
  if (!BRANCH_IDS.includes(draft.branch)) return refuse(t('sale.branch'));
  const supplier = String(draft.supplier || '').trim();
  if (!supplier) return refuse(t('expense.vendor'));
  const lines = purchaseLines(draft);
  if (!lines.length) return refuse(fxText('doc.noLines', {}, lang()));
  const lookup = lookupFxRate(data.rates, { currency: draft.currency, date: draft.date, type: LIABILITY_RATE_TYPE });
  if (!lookup.ok) return refuse(t(lookup.key, lookup.params));
  let amounts;
  try { amounts = purchaseAmounts(lines, draft.currency, lookup); } catch (error) { return refuse(errorText(error)); }
  const rows = readArray(PO_KEY);
  const now = nowIso();
  const subtotal = fxSatangToBaht(amounts.plan.subtotalSatang);
  const po = { id: newId('po'), no: opsNo(rows, 'PO', draft.date), date: draft.date, branch: draft.branch, supplier, supplierAddress: '', supplierTaxId: '', supplierCountry: String(draft.supplierCountry || '').trim(), expectedDate: '', status: 'ordered',
    items: amounts.items.map(item => ({ ...item, total: item.amountThb })), subtotal, note: String(draft.note || '').trim(), createdAt: now, updatedAt: now, updatedAtIso: now,
    currency: draft.currency, ...fxRateFieldsOf(lookup), amountFx: minorToMajor(amounts.plan.subtotalFxMinor, draft.currency), amountThb: subtotal, fxEstimate: true };
  try { commit([[storageKey(PO_KEY), [po, ...rows]]], { action: 'create', ref: po.no, branch: po.branch, text: `${po.no} ${po.currency} ${po.amountFx} ≈ ${money(subtotal)}` }); }
  catch (error) { return refuse(t('error.save', { detail: errorText(error) })); }
  ui.purchase = null;
  return done(t('purchase.saved', { no: po.no, amount: formatFx(amounts.plan.subtotalFxMinor, po.currency), thb: money(subtotal) }), { record: po });
}
// Receives everything still outstanding on a PO in a currency, at the selling rate of `date`.
function receivePurchase(poId, date) {
  const data = dataset();
  if (data.error) return refuse(errorText(data.error));
  const pos = readArray(PO_KEY);
  const po = pos.find(row => row.id === poId);
  if (!po || !isFxDocument(po) || po.status === 'cancelled') return refuse(t('purchase.missing'));
  if (!periodOf(date) || date < po.date) return refuse(fxText('payment.beforeDocument', { docDate: po.date }, lang()));
  if (date > todayIso()) return refuse(t('sale.future'));
  const lock = window.ERPGovernance?.periodLockRefusal?.({ type: 'stock', scope: 'purchase', branch: po.branch, date, action: 'goods_receipt_post' }) || '';
  if (lock) return refuse(lock);
  const closed = closedFxMonth(data, date);
  if (closed) return refuse(closed);
  const grs = readArray(GR_KEY);
  const received = item => grs.filter(gr => gr.poId === po.id && !gr.reversed).reduce((sum, gr) => sum + (gr.items || []).filter(row => (row.productCode || row.product) === (item.productCode || item.product)).reduce((acc, row) => acc + Number(row.qty || 0), 0), 0);
  const open = (po.items || []).map(item => ({ ...item, qty: Math.max(0, Number(item.qty) - received(item)) })).filter(item => item.qty > 0);
  if (!open.length) return refuse(t('purchase.nothingOpen'));
  const lookup = lookupFxRate(data.rates, { currency: po.currency, date, type: LIABILITY_RATE_TYPE });
  if (!lookup.ok) return refuse(t(lookup.key, lookup.params));
  let amounts;
  try { amounts = purchaseAmounts(open.map(item => ({ productCode: item.productCode, product: item.product, fulfillmentType: item.fulfillmentType, flowType: item.flowType, qty: item.qty, unit: item.unit, priceFx: String(item.priceFx) })), po.currency, lookup); } catch (error) { return refuse(errorText(error)); }
  // The costing engine values qty × unit cost (4 decimals): each line must give back exactly its baht, so the stock
  // value, the payable and the journal agree to the satang (otherwise the user splits the line).
  for (const item of amounts.items) if (valueOfQty(toQm(item.qty), toUc(item.unitCost)) !== bahtToSatang(item.amountThb)) return refuse(t('purchase.unitCost', { product: item.product }));
  const subtotal = fxSatangToBaht(amounts.plan.subtotalSatang);
  const vat = planGoodsReceiptVatFields({ vatMode: 'none', subtotal, date });
  if (!vat.ok) return refuse(vat.error);
  const now = nowIso();
  const gr = { id: newId('gr'), no: opsNo(grs, 'GR', date), date, branch: po.branch, poId: po.id, poNo: po.no, supplier: po.supplier,
    items: amounts.items.map(item => ({ productCode: item.productCode, product: item.product, unit: item.unit, unitCost: item.unitCost, outstanding: item.qty, qty: item.qty, priceFx: item.priceFx, amountFx: item.amountFx, amountThb: item.amountThb })),
    subtotal, note: '', status: 'posted', createdAt: now, updatedAtIso: now, ...vat.fields,
    currency: po.currency, ...fxRateFieldsOf(lookup), amountFx: minorToMajor(amounts.plan.subtotalFxMinor, po.currency), amountThb: subtotal, payeeCountry: po.supplierCountry || '', fxPayments: [] };
  const moves = gr.items.map(item => ({ id: newId('mv'), date, branch: po.branch, kind: 'receipt', qty: item.qty, productCode: item.productCode, product: item.product, unit: item.unit, unitCost: item.unitCost, refType: 'goods_receipt', refId: gr.id, refNo: gr.no, poNo: po.no, note: `รับสินค้าจาก ${po.supplier}`, createdAt: now, updatedAtIso: now }));
  const allMoves = [...moves, ...readArray(MOVE_KEY)];
  const costLock = window.ERPCosting?.recomputeRefusal?.({ movements: allMoves }) || '';
  if (costLock) return refuse(costLock);
  const target = pos.find(row => row.id === po.id);
  Object.assign(target, { status: 'received', updatedAt: now, updatedAtIso: now });
  try { commit([[storageKey(GR_KEY), [gr, ...grs]], [storageKey(MOVE_KEY), allMoves], [storageKey(PO_KEY), pos]], { action: 'post', ref: gr.no, branch: gr.branch, text: `${gr.no} ${gr.currency} ${gr.amountFx} = ${money(subtotal)}` }); }
  catch (error) { return refuse(t('error.save', { detail: errorText(error) })); }
  window.ERPIntegrity?.changed?.();
  return done(t('purchase.received', { no: gr.no, amount: formatFx(amounts.plan.subtotalFxMinor, gr.currency), thb: money(subtotal), rate: lookup.rate }), { record: gr });
}
function purchaseHtml(data) {
  const draft = ui.purchase || (ui.purchase = blankPurchase(data));
  if (!draft.currency && data.settings.allowedCurrencies.length) draft.currency = data.settings.allowedCurrencies[0];
  const lookup = draft.currency ? lookupFxRate(data.rates, { currency: draft.currency, date: draft.date, type: LIABILITY_RATE_TYPE }) : null;
  let preview = '';
  if (lookup?.ok) { try { const amounts = purchaseAmounts(purchaseLines(draft), draft.currency, lookup); preview = `<p data-fx-purchase-thb>${esc(t('purchase.estimate', { amount: formatFx(amounts.plan.subtotalFxMinor, draft.currency), thb: money(fxSatangToBaht(amounts.plan.subtotalSatang)) }))}</p>`; } catch (error) { preview = ''; } }
  const lines = draft.lines.map((line, index) => `<tr><td><label class="sr-only" for="fx-ol-product-${index}">${esc(t('col.product'))}</label><input id="fx-ol-product-${index}" data-fx-ol="product" data-index="${index}" list="product-master-list" value="${esc(line.product)}" data-no-i18n></td><td><label class="sr-only" for="fx-ol-qty-${index}">${esc(t('col.qty'))}</label><input id="fx-ol-qty-${index}" data-fx-ol="qty" data-index="${index}" inputmode="decimal" value="${esc(line.qty)}"></td><td><label class="sr-only" for="fx-ol-unit-${index}">${esc(t('col.unit'))}</label><input id="fx-ol-unit-${index}" data-fx-ol="unit" data-index="${index}" value="${esc(line.unit)}" data-no-i18n></td><td><label class="sr-only" for="fx-ol-price-${index}">${esc(t('col.priceFx', { currency: draft.currency || '' }))}</label><input id="fx-ol-price-${index}" data-fx-ol="priceFx" data-index="${index}" inputmode="decimal" value="${esc(line.priceFx)}"></td><td><button type="button" class="btn btn-tertiary btn-sm" data-fx-ol-remove="${index}" aria-label="${esc(t('form.removeLine', { n: index + 1 }))}"${draft.lines.length < 2 ? ' disabled' : ''}>${icon('trash')}</button></td></tr>`).join('');
  const pos = readArray(PO_KEY).filter(row => isFxDocument(row));
  const grs = readArray(GR_KEY).filter(row => isFxDocument(row));
  const receiveDate = ui.receiveDate || todayIso();
  const rows = pos.map(po => { const gr = grs.find(row => row.poId === po.id && !row.reversed); return `<tr><td><b data-no-i18n>${esc(po.no)}</b><small>${esc(dateText(po.date))}</small></td><td>${userText(po.supplier)}</td><td class="num">${esc(formatFx(toMinorUnits(po.amountFx, po.currency) ?? 0, po.currency))}</td><td class="num">${money(po.amountThb)}<small>${esc(t('purchase.estimateShort'))}</small></td><td>${gr ? `<b data-no-i18n>${esc(gr.no)}</b> ${money(gr.amountThb)}<small>${esc(t('purchase.atRate', { rate: gr.fxRate, date: dateText(gr.fxRateDate) }))}</small>` : po.status === 'cancelled' ? esc(t('doc.cancelled')) : `<button type="button" class="btn btn-tertiary btn-sm" data-fx-po-receive="${esc(po.id)}">${esc(t('purchase.receive'))}</button>`}</td></tr>`; }).join('');
  return `<section class="afc-card" aria-labelledby="fx-purchase-title"><div class="afc-card-head"><h3 id="fx-purchase-title">${esc(t('purchase.title'))}</h3></div>
    <form id="fx-purchase-form" class="jc-form fx-form" novalidate><div class="jc-form-grid">
      <div class="jc-field"><label for="fx-o-branch">${esc(t('col.branch'))}</label><select id="fx-o-branch" data-fx-o="branch">${branchOptions(draft.branch)}</select></div>
      <div class="jc-field"><label for="fx-o-date">${esc(t('purchase.date'))}</label><input type="date" id="fx-o-date" data-fx-o="date" value="${esc(draft.date)}"></div>
      <div class="jc-field jc-field-wide"><label for="fx-o-supplier">${esc(t('expense.vendor'))}</label><input id="fx-o-supplier" data-fx-o="supplier" value="${esc(draft.supplier)}" data-no-i18n></div>
      <div class="jc-field"><label for="fx-o-country">${esc(t('sale.country'))}</label><input id="fx-o-country" data-fx-o="supplierCountry" value="${esc(draft.supplierCountry)}" data-no-i18n></div>
      <div class="jc-field"><label for="fx-o-currency">${esc(t('col.currency'))}</label><select id="fx-o-currency" data-fx-o="currency" class="fx-currency-select">${currencyOptions(draft.currency, data.settings.allowedCurrencies)}</select></div>
    </div>
    <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('sale.lines'))}"><table class="afc-table fx-lines-table"><thead><tr><th scope="col">${esc(t('col.product'))}</th><th scope="col">${esc(t('col.qty'))}</th><th scope="col">${esc(t('col.unit'))}</th><th scope="col">${esc(t('col.priceFx', { currency: draft.currency || '' }))}</th><th scope="col"><span class="sr-only">${esc(t('col.actions'))}</span></th></tr></thead><tbody>${lines}</tbody></table></div>
    <button type="button" class="btn btn-tertiary btn-sm" data-fx-ol-add>${esc(t('form.addLine'))}</button>
    ${draft.currency ? ratePanelHtml(lookup, draft.date) : ''}${preview}<p class="afc-note">${esc(t('purchase.note'))}</p>
    <div class="jc-actions"><button type="submit" class="btn btn-primary">${esc(t('purchase.save'))}</button></div></form>
    <div class="jc-form-grid"><div class="jc-field"><label for="fx-po-receive-date">${esc(t('purchase.receiveDate'))}</label><input type="date" id="fx-po-receive-date" value="${esc(receiveDate)}"></div></div>
    <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('purchase.listTitle'))}"><table class="afc-table fx-table" data-fx-purchases><thead><tr><th scope="col">${esc(t('col.docNo'))}</th><th scope="col">${esc(t('expense.vendor'))}</th><th scope="col" class="num">${esc(t('col.amountFx'))}</th><th scope="col" class="num">${esc(t('col.totalThb'))}</th><th scope="col">${esc(t('purchase.grColumn'))}</th></tr></thead><tbody>${rows || `<tr><td colspan="5" class="afc-empty-cell">${esc(t('purchase.none'))}</td></tr>`}</tbody></table></div></section>`;
}

// ---------------------------------------------------------------- credit / debit notes in a currency
function blankAdjust() {
  return { kind: 'credit', invoiceKey: '', date: todayIso(), reasonCode: '', reasonText: '', differenceFx: '', note: '' };
}
function adjustPlan(data, draft) {
  const invoice = fxInvoices(data).find(row => keyOfInvoice(row) === draft.invoiceKey);
  if (!invoice) return { error: t('receipt.chooseInvoice') };
  const code = invoice.currency;
  const minor = toMinorUnits(draft.differenceFx, code);
  if (minor === null) return { invoice, error: fxText('amount.decimals', { currency: code, minor: currencyInfo(code).minor }, lang()) };
  if (!(minor > 0)) return { invoice, error: fxText('amount.invalid', {}, lang()) };
  // At the invoice's own rate: the note corrects that invoice's value (and its VAT) in baht.
  const thb = fxSatangToBaht(convertToSatang(minor, code, invoice.fxRate, invoice.fxPer));
  const vatFx = invoice.vatMode === 'add' ? Number(divRoundHalfUp(BigInt(minor) * BigInt(VAT_PERCENT), 100n)) : 0;
  return { invoice, minor, thb, vatFx };
}
function saveAdjust(draftInput = null) {
  return withDemoWriteLease(SALES_LEDGER_WRITE_LEASE, () => saveAdjustUnlocked(draftInput));
}
function saveAdjustUnlocked(draftInput) {
  const data = dataset();
  if (data.error) return refuse(errorText(data.error));
  const draft = draftInput || ui.adjust;
  if (!draft) return refuse(t('receipt.chooseInvoice'));
  const result = adjustPlan(data, draft);
  if (result.error) return refuse(result.error);
  const { invoice, minor, thb, vatFx } = result;
  if (!periodOf(draft.date)) return refuse(t('sale.date'));
  if (draft.date > todayIso()) return refuse(t('sale.future'));
  { const profile = window.ERPCompanyProfile?.issueRefusal?.(); if (profile) return refuse(profile); }
  const lock = lockText('sales', invoice._branch, draft.date, draft.kind === 'debit' ? 'debit_note_create' : 'credit_note_create');
  if (lock) return refuse(lock);
  const closed = closedFxMonth(data, draft.date);
  if (closed) return refuse(closed);
  const credit = draft.kind !== 'debit';
  const fxFields = { currency: invoice.currency, fxRate: invoice.fxRate, fxPer: invoice.fxPer, fxRateType: invoice.fxRateType, fxRateDate: invoice.fxRateDate, fxRateId: invoice.fxRateId, fxSource: invoice.fxSource };
  const no = nextNumber(data, credit ? 'CN' : 'DN', draft.date, [credit ? 'creditNotes' : 'debitNotes'], true);
  const line = { invoiceId: invoice.id, invoiceNo: invoice.no, invoiceBranch: invoice._branch, [credit ? 'differenceAmount' : 'increaseAmount']: thb };
  const note = { no, date: draft.date, branch: invoice._branch, customer: invoice.customer, customerAddress: invoice.customerAddress || '', customerTaxId: invoice.customerTaxId || '', reasonCode: draft.reasonCode, reasonText: String(draft.reasonText || '').trim(), note: String(draft.note || '').trim(), lines: [line], returnItems: [], ...fxFields };
  const integrity = window.ERPIntegrity;
  const invoices = data.invoices;
  const validation = credit
    ? validateCreditNote(note, invoices, data.business.creditNotes, data.business.receipts, { matches: integrity.creditNoteMatches, debitNotes: data.business.debitNotes })
    : validateDebitNote(note, invoices, data.business.debitNotes, data.business.creditNotes, { matches: integrity.creditNoteMatches });
  if (!validation.ok) return refuse(validation.errors.join('\n'));
  const meta = { id: Date.now(), at: nowIso(), createdBy: actor(), user: actor() };
  const base = credit ? buildCreditNoteRecord(note, validation, meta) : buildDebitNoteRecord(note, validation, meta);
  const { year, month } = periodOf(draft.date);
  const record = withThaiCalendarMeta({ ...base, ...fxFields, differenceFx: minorToMajor(minor, invoice.currency), fxVat: minorToMajor(vatFx, invoice.currency), amountFx: minorToMajor(minor + vatFx, invoice.currency), amountThb: base.total }, year, month);
  const session = packSession();
  try {
    const pack = session.get(invoice._branch, year, month);
    const collection = credit ? 'creditNotes' : 'debitNotes';
    pack[collection] = Array.isArray(pack[collection]) ? pack[collection] : [];
    pack[collection].push(record);
    session.mark(invoice._branch, year, month);
    commit(session.writes(), { action: 'create', ref: record.no, branch: invoice._branch, text: `${record.no} ${record.currency} ${record.amountFx} = ${money(record.total)}` });
    integrity.reconcilePayments?.();
  } catch (error) { return refuse(t('error.save', { detail: errorText(error) })); }
  ui.adjust = null;
  return done(t(credit ? 'adjust.savedCredit' : 'adjust.savedDebit', { no: record.no, amount: formatFx(minor + vatFx, invoice.currency), thb: money(record.total) }), { record });
}

// ---------------------------------------------------------------- month end (export values + revaluation)
function monthPlan(data, period) {
  return planFxMonthEnd({ period, invoices: fxInvoices(data), receipts: data.business.receipts, creditNotes: data.business.creditNotes, debitNotes: data.business.debitNotes, expenses: data.expenses.filter(isFxDocument), goodsReceipts: data.goodsReceipts.filter(isFxDocument), rates: data.rates });
}
function closablePeriods(data) {
  const current = taxPeriodOfDate(todayIso());
  const dates = [...fxInvoices(data), ...data.expenses.filter(isFxDocument), ...data.goodsReceipts.filter(isFxDocument)].map(row => String(row.date || '').slice(0, 10)).filter(Boolean).sort();
  const out = [];
  let period = dates.length ? taxPeriodOfDate(dates[0]) : addTaxPeriods(current, -1);
  for (let guard = 0; period && period < current && guard < 120; guard += 1) { out.push(period); period = addTaxPeriods(period, 1); }
  return out.reverse();
}
function closeMonth(period) {
  const data = dataset();
  if (data.error) return refuse(errorText(data.error));
  if (!period || period >= taxPeriodOfDate(todayIso())) return refuse(t('close.notEnded', { period: monthLabel(period) }));
  if (postedFxClose(data.documents, period)) return refuse(t('close.exists', { period: monthLabel(period) }));
  const later = data.documents.closes.find(close => close.status === 'posted' && close.period > period);
  if (later) return refuse(t('close.later', { period: monthLabel(later.period) }));
  const plan = monthPlan(data, period);
  if (plan.missing.length) return refuse(t('close.missing', { list: plan.missing.map(row => `${row.currency} ${rateTypeLabel(row.type, lang())} ${dateText(row.rateDate)}`).join(', ') }));
  for (const row of plan.rows) for (const date of [plan.date, plan.reverseDate]) { const lock = lockText(row.kind === 'ar' ? 'sales' : 'purchase', row.branch, date, 'fx_revaluation'); if (lock) return refuse(lock); }
  for (const row of plan.exportValues) { const lock = lockText('sales', row.branch, plan.date, 'fx_export_value'); if (lock) return refuse(lock); }
  const close = { id: `fxc-${period}-${Date.now().toString(36)}`, period, date: plan.date, reverseDate: plan.reverseDate, method: 'reverse', status: 'posted', createdAt: nowIso(), createdBy: actor(), rows: plan.rows, exportValues: plan.exportValues };
  const documents = normalizeFxDocuments({ ...data.documents, closes: [...data.documents.closes, close] });
  const session = packSession();
  try {
    for (const value of plan.exportValues) {
      const invoice = fxInvoices(data).find(row => row._branch === value.branch && String(row.id) === value.invoiceId);
      if (!invoice) continue;
      const pack = session.get(invoice._branch, invoice._year, invoice._month);
      const stored = (pack.invoices || []).find(row => String(row.id) === String(invoice.id));
      if (!stored) continue;
      stored.exportVat = { ...value, closeId: close.id, fixedAt: close.createdAt };
      session.mark(invoice._branch, invoice._year, invoice._month);
    }
    commit([...session.writes(), [storageKey(FX_DOCUMENTS_KEY), documents]], { action: 'post', ref: close.id, text: t('close.audit', { period: monthLabel(period), n: plan.rows.length, m: plan.exportValues.length, net: money(plan.totals.net) }) });
  } catch (error) { return refuse(t('error.save', { detail: errorText(error) })); }
  return done(t('close.saved', { period: monthLabel(period), gain: money(plan.totals.gain), loss: money(-plan.totals.loss), n: plan.exportValues.length }), { close });
}
function voidClose(closeId, reason = '') {
  const data = dataset();
  if (data.error) return refuse(errorText(data.error));
  const close = data.documents.closes.find(row => row.id === closeId && row.status === 'posted');
  if (!close) return refuse(t('close.none'));
  const later = data.documents.closes.find(row => row.status === 'posted' && row.period > close.period);
  if (later) return refuse(t('close.later', { period: monthLabel(later.period) }));
  for (const row of close.rows) for (const date of [close.date, close.reverseDate]) { const lock = lockText(row.kind === 'ar' ? 'sales' : 'purchase', row.branch, date, 'fx_revaluation_void'); if (lock) return refuse(lock); }
  for (const row of close.exportValues) { const lock = lockText('sales', row.branch, close.date, 'fx_export_value'); if (lock) return refuse(lock); }
  const documents = normalizeFxDocuments({ ...data.documents, closes: data.documents.closes.map(row => (row.id === closeId ? { ...row, status: 'voided', voidedAt: nowIso(), voidReason: String(reason || '').trim().slice(0, 200) } : row)) });
  const session = packSession();
  try {
    for (const invoice of fxInvoices(data)) {
      if (invoice.exportVat?.closeId !== closeId) continue;
      const pack = session.get(invoice._branch, invoice._year, invoice._month);
      const stored = (pack.invoices || []).find(row => String(row.id) === String(invoice.id));
      if (!stored) continue;
      delete stored.exportVat;
      session.mark(invoice._branch, invoice._year, invoice._month);
    }
    commit([...session.writes(), [storageKey(FX_DOCUMENTS_KEY), documents]], { action: 'void', ref: closeId, text: reason });
  } catch (error) { return refuse(t('error.save', { detail: errorText(error) })); }
  return done(t('close.voided', { period: monthLabel(close.period) }));
}

// ---------------------------------------------------------------- views: shared pieces
function currencyOptions(selected, allowed) {
  const codes = allowed.length ? allowed : FOREIGN_CURRENCY_CODES;
  return `<option value="">${esc(t('form.chooseCurrency'))}</option>${codes.map(code => { const info = currencyInfo(code); return `<option value="${esc(code)}"${code === selected ? ' selected' : ''}>${esc(code)} — ${esc(lang() === 'en' ? info.en : info.th)}</option>`; }).join('')}`;
}
function branchOptions(selected) {
  return branchesOnScreen().map(id => `<option value="${esc(id)}"${id === selected ? ' selected' : ''}>${esc(branchLabel(id))}</option>`).join('');
}
// The rate a draft will use: the looked-up row (read-only — the only way to change it is the rate table) or why not.
function ratePanelHtml(lookup, date) {
  if (!lookup) return '';
  if (!lookup.ok) return `<div class="afc-box afc-box-error fx-rate-panel" role="alert" data-fx-rate-missing><b>${esc(t('rate.blocked'))}</b> ${esc(t(lookup.key, lookup.params))} <button type="button" class="btn btn-secondary btn-sm" data-fx-goto-rate="${esc(lookup.params?.currency || '')}|${esc(lookup.params?.rateDate || '')}|${esc(lookup.params?.type || '')}">${esc(t('rate.enterNow'))}</button></div>`;
  const skipped = lookup.skipped?.length ? ` ${esc(t('rate.skipped', { names: lookup.skipped.map(row => row.name).join(', ') }))}` : '';
  return `<div class="afc-box afc-box-info fx-rate-panel" data-fx-rate-ok><b>${esc(t('rate.used'))}</b> ${esc(lookup.currency)} ${esc(lookup.rate)} ${esc(t('rate.bahtPer', { per: lookup.per, currency: lookup.currency }))} · ${esc(rateTypeLabel(lookup.type, lang()))} · ${esc(t('rate.ofDate', { rateDate: lookup.rateDate, publishedOnDate: lookup.publishedOn, docDate: date }))}${skipped}<br><small>${esc(t('rate.readOnly'))} · <span data-no-i18n>${esc(lookup.sourceNote)}</span> (v${esc(lookup.version)})</small></div>`;
}
function messageHtml() {
  const message = ui.message;
  if (!message) return '';
  ui.message = null;
  return `<div class="afc-box ${message.type === 'error' ? 'afc-box-error' : 'afc-box-info'} fx-message" role="${message.type === 'error' ? 'alert' : 'status'}">${esc(message.text).replace(/\n/g, '<br>')}</div>`;
}
const exportButtonsHtml = table => `<div class="afc-export"><button type="button" class="btn btn-tertiary btn-sm" data-fx-export="csv" data-fx-table="${esc(table)}">${icon('table')}${esc(t('export.csv'))}</button><button type="button" class="btn btn-tertiary btn-sm" data-fx-export="xlsx" data-fx-table="${esc(table)}">${icon('download')}${esc(t('export.xlsx'))}</button></div>`;

// ---------------------------------------------------------------- tab: rates
function rateRows(data) {
  const latest = latestFxRates(data.rates);
  return [...data.rates.rates].filter(row => (!ui.rateCurrency || row.currency === ui.rateCurrency) && (!ui.rateType || row.type === ui.rateType)).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.currency.localeCompare(b.currency) || a.type.localeCompare(b.type) || b.version - a.version)).map(row => ({ row, current: latest.get(`${row.currency}|${row.date}|${row.type}`)?.id === row.id }));
}
function renderRates(data) {
  const used = usedRateIds(data);
  const form = ui.rateForm || { date: todayIso(), currency: data.settings.allowedCurrencies[0] || 'USD', type: 'bot_avg_buying', rate: '', per: '', sourceNote: '', correct: false };
  const lookup = ui.lookup || { date: todayIso(), currency: data.settings.allowedCurrencies[0] || 'USD', type: data.settings.rateType };
  const lookupResult = lookup.currency ? lookupFxRate(data.rates, lookup) : null;
  const rule = lookup.currency ? fxRateDateFor(lookup.date, lookup.type) : null;
  const rows = rateRows(data).map(({ row, current }) => `<tr${current ? '' : ' class="fx-row-old"'}><td>${esc(dateText(row.date))}</td><td><b>${esc(row.currency)}</b></td><td>${esc(rateTypeLabel(row.type, lang()))}</td><td class="num"><b>${esc(row.rate)}</b>${row.per > 1 ? `<small>${esc(t('rate.perUnits', { per: row.per }))}</small>` : ''}</td><td>${userText(row.sourceNote)}<small>${esc(t(`source.${row.source}`))}</small></td><td class="num">v${esc(row.version)}${current ? '' : `<small>${esc(t('rate.superseded'))}</small>`}</td><td>${userText(row.enteredBy)}<small>${esc(dateText(row.enteredAt.slice(0, 10)))}</small></td><td class="num">${used.get(row.id) || 0}</td><td>${current ? `<button type="button" class="btn btn-tertiary btn-sm" data-fx-correct="${esc(row.id)}">${esc(t('rate.correct'))}</button>` : ''}</td></tr>`).join('');
  const adapter = createUnavailableBotAdapter();
  const csv = ui.csv?.plan;
  const csvHtml = csv ? `<div class="fx-csv-preview" data-fx-csv-preview>${csv.headerError ? `<div class="afc-box afc-box-error" role="alert">${esc(t(csv.headerError.key, csv.headerError.params))}</div>` : `<p>${esc(t('csv.summary', { add: csv.counts.add, correct: csv.counts.correct, skip: csv.counts.skip, error: csv.counts.error }))}</p>
    <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('csv.previewTitle'))}"><table class="afc-table fx-table"><thead><tr><th scope="col">${esc(t('csv.line'))}</th><th scope="col">${esc(t('col.rateDate'))}</th><th scope="col">${esc(t('col.currency'))}</th><th scope="col">${esc(t('col.rateType'))}</th><th scope="col" class="num">${esc(t('col.rateValue'))}</th><th scope="col">${esc(t('csv.result'))}</th></tr></thead><tbody>${csv.rows.map(row => `<tr class="${row.error ? 'jc-row-warn' : ''}"><td>${row.line}</td><td>${esc(row.input.date ? dateText(row.input.date) : row.input.rawDate)}</td><td>${esc(row.input.currency)}</td><td>${esc(row.input.type)}</td><td class="num">${esc(row.input.rate)}</td><td>${row.error ? `<b>${esc(t('csv.error'))}</b> ${esc(t(row.error.key, row.error.params))}` : esc(t(`csv.action.${row.action}`))}${row.warning ? `<small class="fx-warn">${esc(t(row.warning.key, row.warning.params))}</small>` : ''}</td></tr>`).join('')}</tbody></table></div>
    <label class="fx-check"><input type="checkbox" id="fx-csv-corrections"${ui.csv.allowCorrections ? ' checked' : ''}> ${esc(t('csv.allowCorrections'))}</label>
    <div class="jc-actions"><button type="button" class="btn btn-primary" data-fx-csv-commit${csv.counts.error || !(csv.counts.add + csv.counts.correct) ? ' disabled' : ''}>${esc(t('csv.commit', { n: csv.counts.add + csv.counts.correct }))}</button><button type="button" class="btn btn-tertiary" data-fx-csv-cancel>${esc(t('form.cancel'))}</button></div>`}</div>` : '';
  return `<div class="afc-box afc-box-info" role="note"><b>${esc(t('rates.ruleTitle'))}</b> ${esc(t('rates.rule'))}<br><small>${esc(fxText('adapter.unavailable', {}, lang()))}</small></div>
  <section class="afc-card" aria-labelledby="fx-rate-form-title"><div class="afc-card-head"><h3 id="fx-rate-form-title">${esc(t(form.correct ? 'rates.correctTitle' : 'rates.addTitle'))}</h3></div>
    <form id="fx-rate-form" class="jc-form fx-form" novalidate><div class="jc-form-grid">
      <div class="jc-field"><label for="fx-r-date">${esc(t('col.rateDate'))}</label><input type="date" id="fx-r-date" value="${esc(form.date)}"${form.correct ? ' readonly' : ''} required></div>
      <div class="jc-field"><label for="fx-r-currency">${esc(t('col.currency'))}</label><select id="fx-r-currency" class="fx-currency-select"${form.correct ? ' disabled' : ''}>${currencyOptions(form.currency, FOREIGN_CURRENCY_CODES)}</select></div>
      <div class="jc-field"><label for="fx-r-type">${esc(t('col.rateType'))}</label><select id="fx-r-type"${form.correct ? ' disabled' : ''}>${FX_RATE_TYPES.map(type => `<option value="${type}"${type === form.type ? ' selected' : ''}>${esc(rateTypeLabel(type, lang()))}</option>`).join('')}</select></div>
      <div class="jc-field"><label for="fx-r-rate">${esc(t('col.rateValue'))}</label><input id="fx-r-rate" inputmode="decimal" value="${esc(form.rate)}" placeholder="32.6543" required></div>
      <div class="jc-field"><label for="fx-r-per">${esc(t('col.per'))}</label><select id="fx-r-per">${FX_RATE_PERS.map(per => `<option value="${per}"${String(per) === String(form.per || currencyInfo(form.currency)?.quotePer || 1) ? ' selected' : ''}>${esc(t('rate.perUnits', { per }))}</option>`).join('')}</select></div>
      <div class="jc-field jc-field-wide"><label for="fx-r-source">${esc(t('col.source'))}</label><input id="fx-r-source" value="${esc(form.sourceNote)}" placeholder="${esc(t('rates.sourcePlaceholder'))}" minlength="${FX_SOURCE_NOTE_MIN}" required data-no-i18n></div>
    </div><div class="jc-actions"><button type="submit" class="btn btn-primary">${esc(t(form.correct ? 'rates.saveCorrection' : 'rates.save'))}</button>${form.correct ? `<button type="button" class="btn btn-tertiary" data-fx-rate-cancel>${esc(t('form.cancel'))}</button>` : ''}</div>
    ${form.correct ? `<p class="afc-note">${esc(t('rates.correctNote'))}</p>` : ''}</form></section>
  <section class="afc-card" aria-labelledby="fx-lookup-title"><div class="afc-card-head"><h3 id="fx-lookup-title">${esc(t('rates.lookupTitle'))}</h3></div>
    <div class="jc-form-grid"><div class="jc-field"><label for="fx-l-date">${esc(t('col.docDate'))}</label><input type="date" id="fx-l-date" value="${esc(lookup.date)}"></div><div class="jc-field"><label for="fx-l-currency">${esc(t('col.currency'))}</label><select id="fx-l-currency" class="fx-currency-select">${currencyOptions(lookup.currency, FOREIGN_CURRENCY_CODES)}</select></div><div class="jc-field"><label for="fx-l-type">${esc(t('col.rateType'))}</label><select id="fx-l-type">${FX_RATE_TYPES.map(type => `<option value="${type}"${type === lookup.type ? ' selected' : ''}>${esc(rateTypeLabel(type, lang()))}</option>`).join('')}</select></div></div>
    ${rule?.rateDate ? `<p data-fx-lookup-rule>${esc(t('rates.lookupRule', { docDate: lookup.date, publishedOnDate: rule.publishedOn, rateDate: rule.rateDate }))}</p>` : ''}${ratePanelHtml(lookupResult, lookup.date)}</section>
  <section class="afc-card" aria-labelledby="fx-csv-title"><div class="afc-card-head"><h3 id="fx-csv-title">${esc(t('csv.title'))}</h3><button type="button" class="btn btn-tertiary btn-sm" data-fx-csv-template>${icon('download')}${esc(t('csv.template'))}</button></div>
    <p class="afc-note">${esc(t('csv.help'))}</p><label for="fx-csv-file" class="btn btn-secondary fx-file">${icon('upload')}${esc(t('csv.choose'))}</label><input type="file" id="fx-csv-file" accept=".csv,text/csv" class="sr-only">${csvHtml}</section>
  <section class="afc-card" aria-labelledby="fx-rate-table-title"><div class="afc-card-head"><h3 id="fx-rate-table-title">${esc(t('rates.tableTitle'))}</h3>${exportButtonsHtml('rates')}</div>
    <div class="afc-filters"><div><label for="fx-f-currency">${esc(t('col.currency'))}</label><select id="fx-f-currency"><option value="">${esc(t('filter.all'))}</option>${FOREIGN_CURRENCY_CODES.map(code => `<option value="${code}"${code === ui.rateCurrency ? ' selected' : ''}>${code}</option>`).join('')}</select></div><div><label for="fx-f-type">${esc(t('col.rateType'))}</label><select id="fx-f-type"><option value="">${esc(t('filter.all'))}</option>${FX_RATE_TYPES.map(type => `<option value="${type}"${type === ui.rateType ? ' selected' : ''}>${esc(rateTypeLabel(type, lang()))}</option>`).join('')}</select></div></div>
    <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('rates.tableTitle'))}"><table class="afc-table fx-table" data-fx-rate-table><thead><tr><th scope="col">${esc(t('col.rateDate'))}</th><th scope="col">${esc(t('col.currency'))}</th><th scope="col">${esc(t('col.rateType'))}</th><th scope="col" class="num">${esc(t('col.rateValue'))}</th><th scope="col">${esc(t('col.source'))}</th><th scope="col" class="num">${esc(t('col.version'))}</th><th scope="col">${esc(t('col.enteredBy'))}</th><th scope="col" class="num">${esc(t('col.used'))}</th><th scope="col"><span class="sr-only">${esc(t('col.actions'))}</span></th></tr></thead><tbody>${rows || `<tr><td colspan="9" class="afc-empty-cell">${esc(t('rates.none'))}</td></tr>`}</tbody></table></div>
    <p class="afc-note">${esc(t('rates.tableNote'))}</p></section>`;
}

// ---------------------------------------------------------------- tab: sales
function renderSales(data) {
  const draft = ui.sale || (ui.sale = blankSale(data));
  if (!draft.currency && data.settings.allowedCurrencies.length) draft.currency = data.settings.allowedCurrencies[0];
  const lookup = draft.currency ? saleRate(data, draft) : null;
  let preview = '';
  if (lookup?.ok) {
    try {
      const plan = planFxSalesAmounts({ currency: draft.currency, lines: draft.lines.filter(line => String(line.product || '').trim()).map(line => ({ qty: line.qty, priceFx: line.priceFx })), vatMode: draft.vat === 'add' ? 'add' : 'none', rate: lookup.rate, per: lookup.per });
      preview = `<div class="afc-stats fx-totals" data-fx-sale-preview><div class="afc-stat"><small>${esc(t('sale.subtotalFx'))}</small><b>${esc(formatFx(plan.subtotalFxMinor, draft.currency))}</b></div><div class="afc-stat"><small>${esc(t('sale.subtotalThb'))}</small><b>${money(fxSatangToBaht(plan.subtotalSatang))}</b></div><div class="afc-stat"><small>${esc(t(draft.vat === 'add' ? 'sale.vatThb' : 'sale.vatZero'))}</small><b>${money(fxSatangToBaht(plan.vatSatang))}</b></div><div class="afc-stat"><small>${esc(t('sale.totalThb'))}</small><b>${money(fxSatangToBaht(plan.totalSatang))}</b></div></div>`;
    } catch (error) { preview = `<p class="afc-note" data-fx-sale-incomplete>${esc(errorText(error))}</p>`; }
  }
  const approval = data.settings.taxInvoiceApproval;
  const printNote = draft.kind === 'quote' ? t('sale.printQuote') : draft.vat === 'zero' && draft.exportKind === 'goods' ? t('sale.printExport') : approval.no ? t('sale.printApproved', { no: approval.no }) : t('sale.printThb');
  const lines = draft.lines.map((line, index) => `<tr><td><label class="sr-only" for="fx-sl-product-${index}">${esc(t('col.product'))}</label><input id="fx-sl-product-${index}" data-fx-sl="product" data-index="${index}" list="product-master-list" value="${esc(line.product)}" data-no-i18n></td><td><label class="sr-only" for="fx-sl-qty-${index}">${esc(t('col.qty'))}</label><input id="fx-sl-qty-${index}" data-fx-sl="qty" data-index="${index}" inputmode="decimal" value="${esc(line.qty)}"></td><td><label class="sr-only" for="fx-sl-unit-${index}">${esc(t('col.unit'))}</label><input id="fx-sl-unit-${index}" data-fx-sl="unit" data-index="${index}" value="${esc(line.unit)}" data-no-i18n></td><td><label class="sr-only" for="fx-sl-price-${index}">${esc(t('col.priceFx', { currency: draft.currency || '' }))}</label><input id="fx-sl-price-${index}" data-fx-sl="priceFx" data-index="${index}" inputmode="decimal" value="${esc(line.priceFx)}"></td><td><button type="button" class="btn btn-tertiary btn-sm" data-fx-sl-remove="${index}" aria-label="${esc(t('form.removeLine', { n: index + 1 }))}"${draft.lines.length < 2 ? ' disabled' : ''}>${icon('trash')}</button></td></tr>`).join('');
  const quotes = fxQuotes(data).filter(live).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const docs = [...fxInvoices(data), ...fxQuotes(data)].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.no).localeCompare(String(a.no)));
  const listRows = docs.map(row => { const isQuote = row._type === 'quotes'; const mode = isQuote ? 'fx' : row.fxPrintMode; return `<tr><td><b data-no-i18n>${esc(row.no)}</b><small>${esc(t(isQuote ? 'doc.quote' : row.vatCategory === 'zero' ? 'doc.export' : 'doc.invoice'))}${live(row) ? '' : ` · ${esc(t('doc.cancelled'))}`}</small></td><td>${esc(dateText(row.date))}</td><td>${userText(row.customer)}</td><td class="num">${esc(formatFx(toMinorUnits(row.amountFx, row.currency) ?? 0, row.currency))}</td><td class="num">${esc(row.fxRate)}${Number(row.fxPer) > 1 ? `/${esc(row.fxPer)}` : ''}<small>${esc(dateText(row.fxRateDate))}</small></td><td class="num"><b>${money(row.total)}</b></td><td>${esc(t(`print.${mode === 'fx' ? 'fx' : 'thb'}`))}</td><td class="afc-row-actions">${isQuote ? `<button type="button" class="btn btn-tertiary btn-sm" data-fx-quote-to-invoice="${esc(keyOfInvoice(row))}">${esc(t('sale.toInvoice'))}</button>` : `<button type="button" class="btn btn-tertiary btn-sm" data-fx-print-invoice="${esc(keyOfInvoice(row))}">${esc(t('doc.view'))}</button>`}</td></tr>`; }).join('');
  return `${messageHtml()}<section class="afc-card" aria-labelledby="fx-sale-title"><div class="afc-card-head"><h3 id="fx-sale-title">${esc(t('sale.title'))}</h3></div>
    <form id="fx-sale-form" class="jc-form fx-form" novalidate><div class="jc-form-grid">
      <div class="jc-field"><label for="fx-s-kind">${esc(t('sale.kind'))}</label><select id="fx-s-kind" data-fx-s="kind"><option value="invoice"${draft.kind === 'invoice' ? ' selected' : ''}>${esc(t('doc.invoice'))}</option><option value="quote"${draft.kind === 'quote' ? ' selected' : ''}>${esc(t('doc.quote'))}</option></select></div>
      <div class="jc-field"><label for="fx-s-branch">${esc(t('col.branch'))}</label><select id="fx-s-branch" data-fx-s="branch">${branchOptions(draft.branch)}</select></div>
      <div class="jc-field"><label for="fx-s-date">${esc(t('col.docDate'))}</label><input type="date" id="fx-s-date" data-fx-s="date" value="${esc(draft.date)}"></div>
      <div class="jc-field"><label for="fx-s-currency">${esc(t('col.currency'))}</label><select id="fx-s-currency" data-fx-s="currency" class="fx-currency-select">${currencyOptions(draft.currency, data.settings.allowedCurrencies)}</select></div>
      <div class="jc-field jc-field-wide"><label for="fx-s-customer">${esc(t('col.customer'))}</label><input id="fx-s-customer" data-fx-s="customer" value="${esc(draft.customer)}" data-no-i18n></div>
      <div class="jc-field jc-field-wide"><label for="fx-s-address">${esc(t('sale.address'))}</label><input id="fx-s-address" data-fx-s="customerAddress" value="${esc(draft.customerAddress)}" data-no-i18n></div>
      <div class="jc-field"><label for="fx-s-country">${esc(t('sale.country'))}</label><input id="fx-s-country" data-fx-s="customerCountry" value="${esc(draft.customerCountry)}" data-no-i18n></div>
      <div class="jc-field"><label for="fx-s-taxid">${esc(t('sale.taxId'))}</label><input id="fx-s-taxid" data-fx-s="customerTaxId" value="${esc(draft.customerTaxId)}" data-no-i18n></div>
      <div class="jc-field"><label for="fx-s-vat">${esc(t('sale.vat'))}</label><select id="fx-s-vat" data-fx-s="vat"><option value="zero"${draft.vat === 'zero' ? ' selected' : ''}>${esc(t('sale.vatZero'))}</option><option value="add"${draft.vat === 'add' ? ' selected' : ''}>${esc(t('sale.vatAdd'))}</option><option value="none"${draft.vat === 'none' ? ' selected' : ''}>${esc(t('sale.vatExempt'))}</option></select></div>
      ${draft.vat === 'zero' && draft.kind === 'invoice' ? `<div class="jc-field"><label for="fx-s-exportkind">${esc(t('sale.exportKind'))}</label><select id="fx-s-exportkind" data-fx-s="exportKind"><option value="goods"${draft.exportKind !== 'service' ? ' selected' : ''}>${esc(t('sale.exportGoods'))}</option><option value="service"${draft.exportKind === 'service' ? ' selected' : ''}>${esc(t('sale.exportService'))}</option></select></div>
      <div class="jc-field"><label for="fx-s-exportno">${esc(t('sale.exportNo'))}</label><input id="fx-s-exportno" data-fx-s="exportDeclarationNo" value="${esc(draft.exportDeclarationNo)}" data-no-i18n></div>
      <div class="jc-field"><label for="fx-s-exportdate">${esc(t('sale.exportDate'))}</label><input type="date" id="fx-s-exportdate" data-fx-s="exportDate" value="${esc(draft.exportDate)}"></div>` : ''}
      ${draft.kind === 'invoice' ? `<div class="jc-field"><label for="fx-s-term">${esc(t('sale.term'))}</label><select id="fx-s-term" data-fx-s="creditTerm">${['cash', 'credit30', 'credit60', 'credit90', 'credit120'].map(term => `<option value="${term}"${term === draft.creditTerm ? ' selected' : ''}>${esc(t(`term.${term}`))}</option>`).join('')}</select></div>` : ''}
      <div class="jc-field jc-field-wide"><label for="fx-s-note">${esc(t('col.note'))}</label><input id="fx-s-note" data-fx-s="note" value="${esc(draft.note)}" data-no-i18n></div>
    </div>
    ${draft.quote ? `<p class="afc-note">${esc(t('sale.fromQuote', { no: draft.quote.no }))}</p>` : ''}
    ${ratePanelHtml(lookup, draft.date)}
    <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('sale.lines'))}"><table class="afc-table fx-lines-table"><thead><tr><th scope="col">${esc(t('col.product'))}</th><th scope="col">${esc(t('col.qty'))}</th><th scope="col">${esc(t('col.unit'))}</th><th scope="col">${esc(t('col.priceFx', { currency: draft.currency || '' }))}</th><th scope="col"><span class="sr-only">${esc(t('col.actions'))}</span></th></tr></thead><tbody>${lines}</tbody></table></div>
    <button type="button" class="btn btn-tertiary btn-sm" data-fx-sl-add>${esc(t('form.addLine'))}</button>
    ${preview}<p class="afc-note" data-fx-print-note>${esc(printNote)}</p>
    <div class="jc-actions"><button type="submit" class="btn btn-primary">${esc(t(draft.kind === 'quote' ? 'sale.saveQuote' : 'sale.saveInvoice'))}</button><button type="button" class="btn btn-tertiary" data-fx-sale-reset>${esc(t('form.clear'))}</button>${quotes.length ? '' : ''}</div></form></section>
  <section class="afc-card" aria-labelledby="fx-sales-list-title"><div class="afc-card-head"><h3 id="fx-sales-list-title">${esc(t('sale.listTitle'))}</h3></div>
    <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('sale.listTitle'))}"><table class="afc-table fx-table" data-fx-sales-table><thead><tr><th scope="col">${esc(t('col.docNo'))}</th><th scope="col">${esc(t('col.docDate'))}</th><th scope="col">${esc(t('col.customer'))}</th><th scope="col" class="num">${esc(t('col.amountFx'))}</th><th scope="col" class="num">${esc(t('col.rate'))}</th><th scope="col" class="num">${esc(t('col.totalThb'))}</th><th scope="col">${esc(t('col.printMode'))}</th><th scope="col"><span class="sr-only">${esc(t('col.actions'))}</span></th></tr></thead><tbody>${listRows || `<tr><td colspan="8" class="afc-empty-cell">${esc(t('sale.none'))}</td></tr>`}</tbody></table></div>
    <p class="afc-note">${esc(t('sale.listNote'))}</p></section>`;
}

// ---------------------------------------------------------------- tab: receipts
function renderReceipts(data) {
  const draft = ui.receipt || (ui.receipt = blankReceipt(data));
  const open = openInvoices(data);
  if (!draft.invoiceKey && open.length) draft.invoiceKey = keyOfInvoice(open[0].invoice);
  const result = draft.invoiceKey ? receiptPlan(data, draft) : null;
  const plan = result?.plan;
  const invoice = result?.invoice;
  const code = invoice?.currency || '';
  const preview = plan ? `<div class="afc-stats fx-totals" data-fx-receipt-preview><div class="afc-stat"><small>${esc(t('receipt.cash'))}</small><b>${money(fxSatangToBaht(plan.cashSatang))}</b></div><div class="afc-stat"><small>${esc(t('receipt.settled'))}</small><b>${money(fxSatangToBaht(plan.settledSatang))}</b></div><div class="afc-stat ${plan.realisedSatang >= 0 ? 'jc-good' : 'jc-loss'}"><small>${esc(t(plan.realisedSatang >= 0 ? 'receipt.gain' : 'receipt.loss'))}</small><b>${money(fxSatangToBaht(plan.realisedSatang))}</b></div><div class="afc-stat"><small>${esc(t('receipt.openAfter'))}</small><b>${esc(formatFx(plan.openAfterFx, code))}</b></div></div>` : result?.error && draft.amountFx !== '' ? `<p class="afc-box afc-box-warn" role="note" data-fx-receipt-error>${esc(result.error)}</p>` : '';
  const options = open.map(({ invoice: row, open: item }) => `<option value="${esc(keyOfInvoice(row))}"${keyOfInvoice(row) === draft.invoiceKey ? ' selected' : ''}>${esc(row.no)} · ${esc(row.customer)} · ${esc(formatFx(item.openFx, row.currency))}</option>`).join('');
  const receipts = data.business.receipts.filter(isFxDocument).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.no).localeCompare(String(a.no)));
  const openRows = open.map(({ invoice: row, open: item }) => `<tr><td><b data-no-i18n>${esc(row.no)}</b></td><td>${userText(row.customer)}</td><td>${esc(dateText(row.date))}</td><td class="num">${esc(formatFx(item.totalFx, row.currency))}</td><td class="num"><b>${esc(formatFx(item.openFx, row.currency))}</b></td><td class="num">${money(fxSatangToBaht(item.openThb))}</td><td><button type="button" class="btn btn-tertiary btn-sm" data-fx-receive="${esc(keyOfInvoice(row))}">${esc(t('receipt.receive'))}</button></td></tr>`).join('');
  const rows = receipts.map(row => `<tr><td><b data-no-i18n>${esc(row.no)}</b>${live(row) ? '' : `<small>${esc(t('doc.cancelled'))}</small>`}</td><td>${esc(dateText(row.date))}</td><td data-no-i18n>${esc(row.invNo)}</td><td class="num">${esc(formatFx(toMinorUnits(row.amountFx, row.currency) ?? 0, row.currency))}</td><td class="num">${esc(row.fxRate)}<small>${esc(rateTypeLabel(row.fxRateType, lang()))} · ${esc(dateText(row.fxRateDate))}</small></td><td class="num">${money(row.amountThb)}</td><td class="num">${money(row.fxSettledThb ?? row.total)}</td><td class="num ${Number(row.fxRealisedThb) >= 0 ? 'afc-pos' : 'afc-neg'}"><b>${money(row.fxRealisedThb)}</b></td><td><button type="button" class="btn btn-tertiary btn-sm" data-fx-print-receipt="${esc(keyOfInvoice(row))}">${esc(t('doc.view'))}</button></td></tr>`).join('');
  return `${messageHtml()}<section class="afc-card" aria-labelledby="fx-receipt-title"><div class="afc-card-head"><h3 id="fx-receipt-title">${esc(t('receipt.title'))}</h3></div>
    ${open.length ? `<form id="fx-receipt-form" class="jc-form fx-form" novalidate><div class="jc-form-grid">
      <div class="jc-field jc-field-wide"><label for="fx-rc-invoice">${esc(t('receipt.invoice'))}</label><select id="fx-rc-invoice" data-fx-rc="invoiceKey" data-no-i18n>${options}</select></div>
      <div class="jc-field"><label for="fx-rc-date">${esc(t('receipt.dateLabel'))}</label><input type="date" id="fx-rc-date" data-fx-rc="date" value="${esc(draft.date)}"></div>
      <div class="jc-field"><label for="fx-rc-amount">${esc(t('receipt.amount', { currency: code }))}</label><input id="fx-rc-amount" data-fx-rc="amountFx" inputmode="decimal" value="${esc(draft.amountFx)}"></div>
      <div class="jc-field"><label for="fx-rc-type">${esc(t('col.rateType'))}</label><select id="fx-rc-type" data-fx-rc="rateType">${RECEIPT_RATE_TYPES.map(type => `<option value="${type}"${type === draft.rateType ? ' selected' : ''}>${esc(rateTypeLabel(type, lang()))}</option>`).join('')}</select></div>
      <div class="jc-field jc-field-wide"><label for="fx-rc-note">${esc(t('col.note'))}</label><input id="fx-rc-note" data-fx-rc="note" value="${esc(draft.note)}" data-no-i18n></div>
    </div>${ratePanelHtml(result?.lookup, draft.date)}${preview}<p class="afc-note">${esc(t('receipt.note'))}</p>
    <div class="jc-actions"><button type="submit" class="btn btn-primary">${esc(t('receipt.save'))}</button></div></form>` : `<p class="afc-empty">${esc(t('receipt.noneOpen'))}</p>`}</section>
  <section class="afc-card" aria-labelledby="fx-open-ar-title"><div class="afc-card-head"><h3 id="fx-open-ar-title">${esc(t('receipt.openTitle'))}</h3></div>
    <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('receipt.openTitle'))}"><table class="afc-table fx-table" data-fx-open-ar><thead><tr><th scope="col">${esc(t('col.docNo'))}</th><th scope="col">${esc(t('col.customer'))}</th><th scope="col">${esc(t('col.docDate'))}</th><th scope="col" class="num">${esc(t('col.totalFx'))}</th><th scope="col" class="num">${esc(t('col.openFx'))}</th><th scope="col" class="num">${esc(t('col.carryingThb'))}</th><th scope="col"><span class="sr-only">${esc(t('col.actions'))}</span></th></tr></thead><tbody>${openRows || `<tr><td colspan="7" class="afc-empty-cell">${esc(t('receipt.noneOpen'))}</td></tr>`}</tbody></table></div></section>
  <section class="afc-card" aria-labelledby="fx-receipts-title"><div class="afc-card-head"><h3 id="fx-receipts-title">${esc(t('receipt.listTitle'))}</h3></div>
    <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('receipt.listTitle'))}"><table class="afc-table fx-table" data-fx-receipts-table><thead><tr><th scope="col">${esc(t('col.docNo'))}</th><th scope="col">${esc(t('receipt.dateLabel'))}</th><th scope="col">${esc(t('receipt.invoice'))}</th><th scope="col" class="num">${esc(t('col.amountFx'))}</th><th scope="col" class="num">${esc(t('col.rate'))}</th><th scope="col" class="num">${esc(t('receipt.cash'))}</th><th scope="col" class="num">${esc(t('receipt.settled'))}</th><th scope="col" class="num">${esc(t('receipt.diff'))}</th><th scope="col"><span class="sr-only">${esc(t('col.actions'))}</span></th></tr></thead><tbody>${rows || `<tr><td colspan="9" class="afc-empty-cell">${esc(t('receipt.none'))}</td></tr>`}</tbody></table></div></section>`;
}

// ---------------------------------------------------------------- tab: payables abroad
function renderPayables(data) {
  const draft = ui.expense || (ui.expense = blankExpense(data));
  if (!draft.currency && data.settings.allowedCurrencies.length) draft.currency = data.settings.allowedCurrencies[0];
  const lookup = draft.currency ? expenseRate(data, draft) : null;
  const minor = draft.currency ? toMinorUnits(draft.amountFx, draft.currency) : null;
  const thb = lookup?.ok && minor > 0 ? fxSatangToBaht(convertToSatang(minor, draft.currency, lookup.rate, lookup.per)) : null;
  const payables = fxPayables(data);
  const payment = ui.payment;
  const paymentResult = payment ? paymentPlan(data, payment) : null;
  const p = paymentResult?.plan;
  const payableRows = payables.map(row => `<tr><td><b data-no-i18n>${esc(row.record.docNo || row.record.no || '-')}</b><small>${esc(t(row.kind === 'gr' ? 'payable.gr' : 'payable.expense'))}</small></td><td>${userText(row.record.vendor || row.record.supplier)}</td><td>${esc(dateText(row.record.date))}</td><td class="num">${esc(formatFx(row.open.totalFx, row.open.currency))}</td><td class="num"><b>${esc(formatFx(row.open.openFx, row.open.currency))}</b></td><td class="num">${money(fxSatangToBaht(row.open.openThb))}</td><td>${row.open.openFx > 0 ? `<button type="button" class="btn btn-tertiary btn-sm" data-fx-pay="${esc(row.key)}">${esc(t('payable.pay'))}</button>` : esc(t('payable.paid'))}</td></tr>`).join('');
  const paymentRows = payables.flatMap(row => (row.record.fxPayments || []).map(item => ({ row, item }))).sort((a, b) => String(b.item.date).localeCompare(String(a.item.date))).map(({ row, item }) => `<tr${item.status === 'voided' ? ' class="fx-row-old"' : ''}><td><b>${esc(item.no)}</b>${item.status === 'voided' ? `<small>${esc(t('doc.cancelled'))}</small>` : ''}</td><td>${esc(dateText(item.date))}</td><td>${userText(row.record.vendor || row.record.supplier)}</td><td class="num">${esc(formatFx(toMinorUnits(item.amountFx, item.currency) ?? 0, item.currency))}</td><td class="num">${esc(item.fxRate)}<small>${esc(dateText(item.fxRateDate))}</small></td><td class="num">${money(item.cashThb)}</td><td class="num">${item.wht ? `${money(item.wht.whtThb)}<small>${esc(t(item.wht.grossUp ? 'wht.grossUp' : 'wht.deduct'))} ${esc(item.wht.rate)}%</small>` : '–'}</td><td class="num">${item.pp36 ? money(item.pp36.vatThb) : '–'}</td><td class="num ${Number(item.realisedThb) >= 0 ? 'afc-pos' : 'afc-neg'}">${money(item.realisedThb)}</td><td>${item.status === 'voided' ? '' : `<button type="button" class="btn btn-tertiary btn-sm" data-fx-pay-void="${esc(row.key)}|${esc(item.id)}">${esc(t('payable.void'))}</button>`}</td></tr>`).join('');
  const paymentForm = payment ? `<section class="afc-card fx-payment-card" aria-labelledby="fx-payment-title"><div class="afc-card-head"><h3 id="fx-payment-title">${esc(t('payment.title', { doc: paymentResult?.payable?.record?.docNo || paymentResult?.payable?.record?.no || '' }))}</h3></div>
    <form id="fx-payment-form" class="jc-form fx-form" novalidate><div class="jc-form-grid">
      <div class="jc-field"><label for="fx-p-date">${esc(t('payment.dateLabel'))}</label><input type="date" id="fx-p-date" data-fx-p="date" value="${esc(payment.date)}"></div>
      <div class="jc-field"><label for="fx-p-amount">${esc(t('payment.amount', { currency: paymentResult?.payable?.record?.currency || '' }))}</label><input id="fx-p-amount" data-fx-p="amountFx" inputmode="decimal" value="${esc(payment.amountFx)}"></div>
      <div class="jc-field jc-field-wide"><label for="fx-p-note">${esc(t('col.note'))}</label><input id="fx-p-note" data-fx-p="note" value="${esc(payment.note)}" data-no-i18n></div>
    </div>
    ${paymentResult?.payable?.kind === 'expense' ? `<fieldset class="fx-fieldset"><legend>${esc(t('wht.title'))}</legend><label class="fx-check"><input type="checkbox" data-fx-pw="enabled"${payment.wht.enabled ? ' checked' : ''}> ${esc(t('wht.enable'))}</label>
      ${payment.wht.enabled ? `<div class="jc-form-grid"><div class="jc-field"><label for="fx-pw-type">${esc(fxText('col.incomeType', {}, lang()))}</label><select id="fx-pw-type" data-fx-pw="incomeType">${PND54_INCOME_TYPES.map(type => `<option value="${type}"${type === payment.wht.incomeType ? ' selected' : ''}>${esc(fxText(`income.${type}`, {}, lang()))}</option>`).join('')}</select></div>
      <div class="jc-field"><label for="fx-pw-rate">${esc(t('wht.rateLabel'))}</label><input id="fx-pw-rate" data-fx-pw="rate" inputmode="decimal" value="${esc(payment.wht.rate)}"><small class="fx-warn">${esc(t('wht.confirm'))}</small></div>
      <div class="jc-field"><label for="fx-pw-cond">${esc(fxText('col.condition', {}, lang()))}</label><select id="fx-pw-cond" data-fx-pw="grossUp"><option value="0"${payment.wht.grossUp ? '' : ' selected'}>${esc(fxText('wht.deduct', {}, lang()))}</option><option value="1"${payment.wht.grossUp ? ' selected' : ''}>${esc(fxText('wht.grossUp', {}, lang()))}</option></select></div>
      <div class="jc-field"><label for="fx-pw-name">${esc(fxText('col.payeeName', {}, lang()))}</label><input id="fx-pw-name" data-fx-pw="payeeName" value="${esc(payment.wht.payeeName)}" data-no-i18n></div>
      <div class="jc-field"><label for="fx-pw-country">${esc(fxText('col.payeeCountry', {}, lang()))}</label><input id="fx-pw-country" data-fx-pw="payeeCountry" value="${esc(payment.wht.payeeCountry)}" data-no-i18n></div>
      <div class="jc-field jc-field-wide"><label for="fx-pw-dta">${esc(t('wht.dta'))}</label><input id="fx-pw-dta" data-fx-pw="dtaNote" value="${esc(payment.wht.dtaNote)}" data-no-i18n></div></div>` : ''}</fieldset>
    <fieldset class="fx-fieldset"><legend>${esc(t('pp36.title'))}</legend><label class="fx-check"><input type="checkbox" data-fx-pp36${payment.pp36.enabled ? ' checked' : ''}> ${esc(t('pp36.enable'))}</label></fieldset>` : ''}
    ${ratePanelHtml(paymentResult?.lookup, payment.date)}
    ${p ? `<div class="afc-stats fx-totals" data-fx-payment-preview><div class="afc-stat"><small>${esc(t('payment.cashFx'))}</small><b>${esc(formatFx(p.cashFxMinor, p.currency))}</b></div><div class="afc-stat"><small>${esc(t('payment.cashThb'))}</small><b>${money(fxSatangToBaht(p.cashSatang))}</b></div>${p.wht ? `<div class="afc-stat"><small>${esc(t('payment.income'))}</small><b>${money(p.wht.incomeThb)}</b></div><div class="afc-stat"><small>${esc(t('payment.wht'))}</small><b>${money(p.wht.whtThb)}</b></div>` : ''}${p.pp36 ? `<div class="afc-stat"><small>${esc(t('payment.pp36'))}</small><b>${money(p.pp36.vatThb)}</b></div>` : ''}<div class="afc-stat ${p.realisedSatang >= 0 ? 'jc-good' : 'jc-loss'}"><small>${esc(t(p.realisedSatang >= 0 ? 'receipt.gain' : 'receipt.loss'))}</small><b>${money(fxSatangToBaht(p.realisedSatang))}</b></div></div>` : paymentResult?.error ? `<p class="afc-box afc-box-warn" role="note">${esc(paymentResult.error)}</p>` : ''}
    <p class="afc-note">${esc(t('payment.note'))}</p>
    <div class="jc-actions"><button type="submit" class="btn btn-primary">${esc(t('payment.save'))}</button><button type="button" class="btn btn-tertiary" data-fx-pay-cancel>${esc(t('form.cancel'))}</button></div></form></section>` : '';
  return `${messageHtml()}${paymentForm}<section class="afc-card" aria-labelledby="fx-expense-title"><div class="afc-card-head"><h3 id="fx-expense-title">${esc(t('expense.title'))}</h3></div>
    <form id="fx-expense-form" class="jc-form fx-form" novalidate><div class="jc-form-grid">
      <div class="jc-field"><label for="fx-e-branch">${esc(t('col.branch'))}</label><select id="fx-e-branch" data-fx-e="branch">${branchOptions(draft.branch)}</select></div>
      <div class="jc-field"><label for="fx-e-date">${esc(t('expense.date'))}</label><input type="date" id="fx-e-date" data-fx-e="date" value="${esc(draft.date)}"></div>
      <div class="jc-field jc-field-wide"><label for="fx-e-vendor">${esc(t('expense.vendor'))}</label><input id="fx-e-vendor" data-fx-e="vendor" value="${esc(draft.vendor)}" data-no-i18n></div>
      <div class="jc-field"><label for="fx-e-country">${esc(t('sale.country'))}</label><input id="fx-e-country" data-fx-e="payeeCountry" value="${esc(draft.payeeCountry)}" data-no-i18n></div>
      <div class="jc-field"><label for="fx-e-docno">${esc(t('expense.docNo'))}</label><input id="fx-e-docno" data-fx-e="docNo" value="${esc(draft.docNo)}" data-no-i18n></div>
      <div class="jc-field"><label for="fx-e-cat">${esc(t('expense.category'))}</label><select id="fx-e-cat" data-fx-e="cat">${EXPENSE_CATEGORIES.map(cat => `<option value="${esc(cat)}"${cat === draft.cat ? ' selected' : ''}>${esc(cat)}</option>`).join('')}</select></div>
      <div class="jc-field jc-field-wide"><label for="fx-e-desc">${esc(t('expense.desc'))}</label><input id="fx-e-desc" data-fx-e="desc" value="${esc(draft.desc)}" data-no-i18n></div>
      <div class="jc-field"><label for="fx-e-currency">${esc(t('col.currency'))}</label><select id="fx-e-currency" data-fx-e="currency" class="fx-currency-select">${currencyOptions(draft.currency, data.settings.allowedCurrencies)}</select></div>
      <div class="jc-field"><label for="fx-e-amount">${esc(t('expense.amount', { currency: draft.currency || '' }))}</label><input id="fx-e-amount" data-fx-e="amountFx" inputmode="decimal" value="${esc(draft.amountFx)}"></div>
    </div>${ratePanelHtml(lookup, draft.date)}${thb !== null ? `<p data-fx-expense-thb>${esc(t('expense.thb', { thb: money(thb) }))}</p>` : ''}<p class="afc-note">${esc(t('expense.note'))}</p>
    <div class="jc-actions"><button type="submit" class="btn btn-primary">${esc(t('expense.save'))}</button></div></form></section>
  <section class="afc-card" aria-labelledby="fx-payables-title"><div class="afc-card-head"><h3 id="fx-payables-title">${esc(t('payable.title'))}</h3></div>
    <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('payable.title'))}"><table class="afc-table fx-table" data-fx-payables><thead><tr><th scope="col">${esc(t('col.docNo'))}</th><th scope="col">${esc(t('expense.vendor'))}</th><th scope="col">${esc(t('col.docDate'))}</th><th scope="col" class="num">${esc(t('col.totalFx'))}</th><th scope="col" class="num">${esc(t('col.openFx'))}</th><th scope="col" class="num">${esc(t('col.carryingThb'))}</th><th scope="col"><span class="sr-only">${esc(t('col.actions'))}</span></th></tr></thead><tbody>${payableRows || `<tr><td colspan="7" class="afc-empty-cell">${esc(t('payable.none'))}</td></tr>`}</tbody></table></div></section>
  <section class="afc-card" aria-labelledby="fx-payments-title"><div class="afc-card-head"><h3 id="fx-payments-title">${esc(t('payment.listTitle'))}</h3></div>
    <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('payment.listTitle'))}"><table class="afc-table fx-table" data-fx-payments><thead><tr><th scope="col">${esc(t('col.docNo'))}</th><th scope="col">${esc(t('payment.dateLabel'))}</th><th scope="col">${esc(t('expense.vendor'))}</th><th scope="col" class="num">${esc(t('col.amountFx'))}</th><th scope="col" class="num">${esc(t('col.rate'))}</th><th scope="col" class="num">${esc(t('payment.cashThb'))}</th><th scope="col" class="num">${esc(t('payment.wht'))}</th><th scope="col" class="num">${esc(t('payment.pp36'))}</th><th scope="col" class="num">${esc(t('receipt.diff'))}</th><th scope="col"><span class="sr-only">${esc(t('col.actions'))}</span></th></tr></thead><tbody>${paymentRows || `<tr><td colspan="10" class="afc-empty-cell">${esc(t('payment.none'))}</td></tr>`}</tbody></table></div>
    <p class="afc-note">${esc(t('payment.reportsNote'))}</p></section>${purchaseHtml(data)}`;
}

// ---------------------------------------------------------------- tab: credit / debit notes
function renderAdjust(data) {
  const draft = ui.adjust || (ui.adjust = blankAdjust());
  const invoices = fxInvoices(data).filter(live);
  if (!draft.invoiceKey && invoices.length) draft.invoiceKey = keyOfInvoice(invoices[0]);
  const result = draft.invoiceKey && draft.differenceFx !== '' ? adjustPlan(data, draft) : null;
  const reasons = draft.kind === 'debit' ? DEBIT_NOTE_REASONS : CREDIT_NOTE_REASONS;
  const notes = [...data.business.creditNotes.filter(isFxDocument).map(row => ({ row, kind: 'credit' })), ...data.business.debitNotes.filter(isFxDocument).map(row => ({ row, kind: 'debit' }))].sort((a, b) => String(b.row.date).localeCompare(String(a.row.date)));
  return `${messageHtml()}<section class="afc-card" aria-labelledby="fx-adjust-title"><div class="afc-card-head"><h3 id="fx-adjust-title">${esc(t('adjust.title'))}</h3></div>
    ${invoices.length ? `<form id="fx-adjust-form" class="jc-form fx-form" novalidate><div class="jc-form-grid">
      <div class="jc-field"><label for="fx-a-kind">${esc(t('adjust.kind'))}</label><select id="fx-a-kind" data-fx-a="kind"><option value="credit"${draft.kind !== 'debit' ? ' selected' : ''}>${esc(t('adjust.credit'))}</option><option value="debit"${draft.kind === 'debit' ? ' selected' : ''}>${esc(t('adjust.debit'))}</option></select></div>
      <div class="jc-field jc-field-wide"><label for="fx-a-invoice">${esc(t('receipt.invoice'))}</label><select id="fx-a-invoice" data-fx-a="invoiceKey" data-no-i18n>${invoices.map(row => `<option value="${esc(keyOfInvoice(row))}"${keyOfInvoice(row) === draft.invoiceKey ? ' selected' : ''}>${esc(row.no)} · ${esc(row.customer)} · ${esc(formatFx(toMinorUnits(row.amountFx, row.currency) ?? 0, row.currency))}</option>`).join('')}</select></div>
      <div class="jc-field"><label for="fx-a-date">${esc(t('col.docDate'))}</label><input type="date" id="fx-a-date" data-fx-a="date" value="${esc(draft.date)}"></div>
      <div class="jc-field"><label for="fx-a-amount">${esc(t('adjust.amount'))}</label><input id="fx-a-amount" data-fx-a="differenceFx" inputmode="decimal" value="${esc(draft.differenceFx)}"></div>
      <div class="jc-field jc-field-wide"><label for="fx-a-reason">${esc(t('adjust.reason'))}</label><select id="fx-a-reason" data-fx-a="reasonCode"><option value="">${esc(t('adjust.chooseReason'))}</option>${reasons.map(reason => `<option value="${esc(reason.code)}"${reason.code === draft.reasonCode ? ' selected' : ''}>${esc(reason.label)}</option>`).join('')}</select></div>
      <div class="jc-field jc-field-wide"><label for="fx-a-text">${esc(t('adjust.reasonText'))}</label><input id="fx-a-text" data-fx-a="reasonText" value="${esc(draft.reasonText)}" data-no-i18n></div>
    </div>${result?.error ? `<p class="afc-box afc-box-warn" role="note">${esc(result.error)}</p>` : result ? `<p data-fx-adjust-preview>${esc(t('adjust.preview', { amount: formatFx(result.minor, result.invoice.currency), rate: result.invoice.fxRate, thb: money(result.thb) }))}</p>` : ''}<p class="afc-note">${esc(t('adjust.note'))}</p>
    <div class="jc-actions"><button type="submit" class="btn btn-primary">${esc(t('adjust.save'))}</button></div></form>` : `<p class="afc-empty">${esc(t('sale.none'))}</p>`}</section>
  <section class="afc-card" aria-labelledby="fx-notes-title"><div class="afc-card-head"><h3 id="fx-notes-title">${esc(t('adjust.listTitle'))}</h3></div>
    <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('adjust.listTitle'))}"><table class="afc-table fx-table"><thead><tr><th scope="col">${esc(t('col.docNo'))}</th><th scope="col">${esc(t('col.docDate'))}</th><th scope="col">${esc(t('receipt.invoice'))}</th><th scope="col" class="num">${esc(t('col.amountFx'))}</th><th scope="col" class="num">${esc(t('col.totalThb'))}</th></tr></thead><tbody>${notes.map(({ row, kind }) => `<tr><td><b data-no-i18n>${esc(row.no)}</b><small>${esc(t(kind === 'debit' ? 'adjust.debit' : 'adjust.credit'))}</small></td><td>${esc(dateText(row.date))}</td><td data-no-i18n>${esc((row.invoiceNos || []).join(', '))}</td><td class="num">${esc(formatFx(toMinorUnits(row.amountFx, row.currency) ?? 0, row.currency))}</td><td class="num">${money(row.total)}</td></tr>`).join('') || `<tr><td colspan="5" class="afc-empty-cell">${esc(t('adjust.none'))}</td></tr>`}</tbody></table></div></section>`;
}

// ---------------------------------------------------------------- tab: month end
function renderMonthEnd(data) {
  const periods = closablePeriods(data);
  if (!periods.includes(ui.period)) ui.period = periods[0] || '';
  const period = ui.period;
  const posted = period ? postedFxClose(data.documents, period) : null;
  const plan = period ? monthPlan(data, period) : null;
  const view = posted || plan;
  const rows = (view?.rows || []).map(row => `<tr><td>${esc(t(row.kind === 'ar' ? 'close.ar' : 'close.ap'))}</td><td><b data-no-i18n>${esc(row.no)}</b><small>${esc(branchLabel(row.branch))}</small></td><td>${userText(row.party)}</td><td class="num">${esc(formatFx(toMinorUnits(row.openFx, row.currency) ?? 0, row.currency))}</td><td class="num">${money(row.carryingThb)}</td><td class="num">${esc(row.rate)}<small>${esc(rateTypeLabel(row.rateType, lang()))} · ${esc(dateText(row.rateDate))}</small></td><td class="num">${money(row.revaluedThb)}</td><td class="num ${row.diffThb >= 0 ? 'afc-pos' : 'afc-neg'}"><b>${money(row.diffThb)}</b></td></tr>`).join('');
  const exports = (view?.exportValues || []).map(row => `<tr><td><b data-no-i18n>${esc(row.invoiceNo)}</b></td><td class="num">${esc(formatFx(toMinorUnits(row.totalFx, row.currency) ?? 0, row.currency))}</td><td class="num">${esc(formatMinor(toMinorUnits(row.soldFx, row.currency) ?? 0, row.currency))} → ${money(row.soldThb)}</td><td class="num">${esc(formatMinor(toMinorUnits(row.restFx, row.currency) ?? 0, row.currency))}${row.rate ? ` × ${esc(row.rate)}` : ''}<small>${row.rateDate ? esc(dateText(row.rateDate)) : ''}</small></td><td class="num"><b>${money(row.thb)}</b></td><td class="num">${money(row.bookThb)}</td><td>${esc(t(`export.basis.${row.basis}`))}</td></tr>`).join('');
  const totals = plan?.totals || { gain: 0, loss: 0, net: 0 };
  const postedTotals = posted ? { gain: fxSatangToBaht(posted.rows.reduce((s, r) => s + Math.max(0, bahtToSatang(r.diffThb)), 0)), loss: fxSatangToBaht(posted.rows.reduce((s, r) => s + Math.min(0, bahtToSatang(r.diffThb)), 0)) } : null;
  const closes = data.documents.closes.slice().sort((a, b) => (a.period < b.period ? 1 : -1));
  return `${messageHtml()}<div class="afc-box afc-box-info" role="note">${esc(t('close.intro'))}</div>
  <section class="afc-card" aria-labelledby="fx-close-title"><div class="afc-card-head"><h3 id="fx-close-title">${esc(t('close.title', { period: period ? monthLabel(period) : '-' }))}</h3></div>
    <div class="afc-filters"><div><label for="fx-period">${esc(t('close.period'))}</label><select id="fx-period">${periods.map(item => `<option value="${item}"${item === period ? ' selected' : ''}>${esc(monthLabel(item))}${postedFxClose(data.documents, item) ? ` · ${esc(t('close.postedShort'))}` : ''}</option>`).join('') || `<option value="">${esc(t('close.noPeriods'))}</option>`}</select></div></div>
    ${posted ? `<div class="afc-box afc-box-info" data-fx-close-posted>${esc(t('close.posted', { at: dateText(posted.createdAt.slice(0, 10)), by: '\u0001', date: dateText(posted.date), reverse: dateText(posted.reverseDate) })).replace('\u0001', userText(posted.createdBy))}</div>` : plan?.missing.length ? `<div class="afc-box afc-box-error" role="alert" data-fx-close-missing><b>${esc(t('rate.blocked'))}</b> ${esc(t('close.missing', { list: plan.missing.map(row => `${row.currency} ${rateTypeLabel(row.type, lang())} ${dateText(row.rateDate)}`).join(', ') }))}</div>` : ''}
    <h4>${esc(t('close.exportTitle'))}</h4>
    <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('close.exportTitle'))}"><table class="afc-table fx-table" data-fx-export-values><thead><tr><th scope="col">${esc(t('col.docNo'))}</th><th scope="col" class="num">${esc(t('col.totalFx'))}</th><th scope="col" class="num">${esc(t('close.sold'))}</th><th scope="col" class="num">${esc(t('close.rest'))}</th><th scope="col" class="num">${esc(t('close.exportThb'))}</th><th scope="col" class="num">${esc(t('close.bookThb'))}</th><th scope="col">${esc(t('close.basis'))}</th></tr></thead><tbody>${exports || `<tr><td colspan="7" class="afc-empty-cell">${esc(t('close.noExports'))}</td></tr>`}</tbody></table></div>
    <h4>${esc(t('close.revalTitle'))}</h4>
    <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('close.revalTitle'))}"><table class="afc-table fx-table" data-fx-reval><thead><tr><th scope="col">${esc(t('close.side'))}</th><th scope="col">${esc(t('col.docNo'))}</th><th scope="col">${esc(t('close.party'))}</th><th scope="col" class="num">${esc(t('col.openFx'))}</th><th scope="col" class="num">${esc(t('col.carryingThb'))}</th><th scope="col" class="num">${esc(t('col.rate'))}</th><th scope="col" class="num">${esc(t('close.revalued'))}</th><th scope="col" class="num">${esc(t('close.diff'))}</th></tr></thead><tbody>${rows || `<tr><td colspan="8" class="afc-empty-cell">${esc(t('close.noOpen'))}</td></tr>`}</tbody></table></div>
    <div class="afc-stats"><div class="afc-stat jc-good"><small>${esc(t('close.gain'))}</small><b>${money(postedTotals ? postedTotals.gain : totals.gain)}</b></div><div class="afc-stat jc-loss"><small>${esc(t('close.loss'))}</small><b>${money(postedTotals ? -postedTotals.loss : -totals.loss)}</b></div></div>
    <p class="afc-note">${esc(t('close.note'))}</p>
    <div class="jc-actions">${posted ? `<button type="button" class="btn btn-secondary" data-fx-close-void="${esc(posted.id)}">${esc(t('close.void'))}</button>` : period ? `<button type="button" class="btn btn-primary" data-fx-close="${esc(period)}"${plan?.missing.length ? ' disabled' : ''}>${esc(t('close.post'))}</button>` : ''}</div></section>
  <section class="afc-card" aria-labelledby="fx-closes-title"><div class="afc-card-head"><h3 id="fx-closes-title">${esc(t('close.history'))}</h3></div>
    <ul class="acc-doc-list">${closes.map(close => `<li>${esc(monthLabel(close.period))} · ${esc(t(close.status === 'posted' ? 'close.postedShort' : 'close.voidedShort'))} · ${esc(dateText(close.createdAt.slice(0, 10)))} · ${userText(close.createdBy)}${close.voidReason ? ` · ${userText(close.voidReason)}` : ''}</li>`).join('') || `<li>${esc(t('close.noHistory'))}</li>`}</ul></section>`;
}

// ---------------------------------------------------------------- tab: settings (+ the card on ตั้งค่าบริษัท)
function settingsFormHtml(data, idPrefix) {
  const s = data.settings;
  return `<form id="${idPrefix}-settings-form" class="jc-form fx-form fx-settings-form" data-fx-settings-form novalidate>
    <p><b>${esc(t('settings.functionalLabel'))}</b> THB — ${esc(t('settings.functionalNote'))}</p>
    <fieldset class="fx-fieldset"><legend>${esc(t('settings.allowed'))}</legend><div class="fx-currency-grid">${FOREIGN_CURRENCY_CODES.map(code => { const info = currencyInfo(code); return `<label class="fx-check"><input type="checkbox" data-fx-allowed="${code}"${s.allowedCurrencies.includes(code) ? ' checked' : ''}> <b>${code}</b> ${esc(lang() === 'en' ? info.en : info.th)}<small>${esc(t('settings.minor', { n: info.minor }))}</small></label>`; }).join('')}</div></fieldset>
    <div class="jc-form-grid"><div class="jc-field"><label for="${idPrefix}-rate-type">${esc(t('settings.rateTypeLabel'))}</label><select id="${idPrefix}-rate-type" data-fx-setting="rateType">${SALES_RATE_TYPES.map(type => `<option value="${type}"${type === s.rateType ? ' selected' : ''}>${esc(rateTypeLabel(type, lang()))}</option>`).join('')}</select><small>${esc(t('settings.rateTypeNote'))}</small></div>
    <div class="jc-field"><label for="${idPrefix}-rate-ref">${esc(t('settings.rateTypeRef'))}</label><input id="${idPrefix}-rate-ref" data-fx-setting="approvalRef" value="" data-no-i18n></div>
    <div class="jc-field jc-field-wide"><label for="${idPrefix}-approval-no">${esc(t('settings.approvalNo'))}</label><input id="${idPrefix}-approval-no" data-fx-setting="approvalNo" value="${esc(s.taxInvoiceApproval.no)}" data-no-i18n><small>${esc(t('settings.approvalNote'))}</small></div>
    <div class="jc-field"><label for="${idPrefix}-approval-date">${esc(t('settings.approvalDateLabel'))}</label><input type="date" id="${idPrefix}-approval-date" data-fx-setting="approvalDate" value="${esc(s.taxInvoiceApproval.date)}"></div></div>
    <p><b>${esc(t('settings.revaluation'))}</b> ${esc(t('settings.revaluationNote'))}</p>
    <fieldset class="fx-fieldset"><legend>${esc(t('settings.pnd54'))}</legend><p class="fx-warn">${esc(t('wht.confirm'))}</p><div class="jc-form-grid">${PND54_INCOME_TYPES.map(type => `<div class="jc-field"><label for="${idPrefix}-pnd54-${type}">${esc(fxText(`income.${type}`, {}, lang()))}</label><input id="${idPrefix}-pnd54-${type}" data-fx-pnd54="${type}" inputmode="decimal" value="${esc(s.pnd54Rates[type])}"></div>`).join('')}</div></fieldset>
    ${s.rateTypeHistory.length ? `<p class="afc-note">${esc(t('settings.history'))}: ${s.rateTypeHistory.map(row => `${rateTypeLabel(row.rateType, lang())} (${row.approvalRef || '-'})`).map(esc).join(' · ')}</p>` : ''}
    <div class="jc-actions"><button type="submit" class="btn btn-primary">${esc(t('settings.save'))}</button></div></form>`;
}
function readSettingsForm(form) {
  const allowed = [...form.querySelectorAll('[data-fx-allowed]')].filter(el => el.checked).map(el => el.dataset.fxAllowed);
  const pnd54Rates = {};
  form.querySelectorAll('[data-fx-pnd54]').forEach(el => { pnd54Rates[el.dataset.fxPnd54] = Number(el.value); });
  const value = name => form.querySelector(`[data-fx-setting="${name}"]`)?.value ?? '';
  return { patch: { allowedCurrencies: allowed, rateType: value('rateType'), taxInvoiceApproval: { no: value('approvalNo'), date: value('approvalDate') }, pnd54Rates }, context: { approvalRef: value('approvalRef') } };
}
function renderSettings(data) {
  return `${messageHtml()}<section class="afc-card" aria-labelledby="fx-settings-title"><div class="afc-card-head"><h3 id="fx-settings-title">${esc(t('settings.title'))}</h3></div>${settingsFormHtml(data, 'fx-tab')}</section>`;
}
let cardStale = true;
function mountSettingsCard() {
  const panel = $(`panel-${SETTINGS_PANEL_ID}`);
  if (!panel) return null;
  let wrap = $('acc-settings-cards');
  if (!wrap) return null;
  let card = $(CARD_ID);
  if (!card) {
    card = document.createElement('section');
    card.id = CARD_ID;
    card.className = 'card fx-settings-card';
    wrap.appendChild(card);
    card.addEventListener('submit', onSubmit);
  }
  return card;
}
function renderSettingsCard() {
  const card = mountSettingsCard();
  if (!card) return;
  const data = dataset();
  cardStale = false;
  card.innerHTML = `<div class="card-title">${icon('globe')}${esc(t('settings.cardTitle'))}</div>${data.error ? errorHtml(data.error) : `<p>${esc(t('settings.cardIntro'))}</p><details><summary>${esc(t('settings.open'))}</summary>${settingsFormHtml(data, 'fx-card')}</details>`}`;
}

// ---------------------------------------------------------------- ภ.ง.ด.54 / ภ.พ.36 on the tax-reports page
function foreignReport(kind, branch, period) {
  const data = dataset();
  if (data.error) return { error: data.error };
  const sources = [{ branch, expenses: data.expenses.filter(row => row._branch === branch) }];
  return kind === 'pnd54' ? buildPnd54Report({ period, sources }) : buildPp36Report({ period, sources });
}
function foreignTabHtml(kind, branch, period) {
  const report = foreignReport(kind, branch, period);
  if (report.error) return errorHtml(report.error);
  const table = fxForeignTable(report, lang());
  const due = report.due;
  const head = `<div class="afc-box afc-box-info" role="note"><b>${esc(t(`${kind}.title`))}</b> ${esc(t(`${kind}.intro`))}${due ? `<br>${esc(t('due.date', { dueDate: due.due }))}${due.rolled ? ` ${esc(t('due.rolled', { names: due.holidays.join(', ') || t('due.weekend') }))}` : ''}` : ''}${kind === 'pnd54' ? `<br><span class="fx-warn">${esc(t('wht.confirm'))}</span>` : ''}</div>`;
  const body = table.body.map(row => `<tr>${row.map((cell, index) => `<td class="${typeof cell === 'number' ? 'num' : ''}"${['payeeName', 'description', 'payeeCountry', 'paymentNo'].includes(table.columns[index]) ? ' data-no-i18n' : ''}>${esc(typeof cell === 'number' && table.columns[index] !== 'whtRate' && table.columns[index] !== 'seq' ? money(cell) : cell)}</td>`).join('')}</tr>`).join('');
  const foot = `<tr>${table.footer.map(cell => `<th class="${typeof cell === 'number' ? 'num' : ''}">${esc(typeof cell === 'number' ? (cell === report.totals.count ? cell : money(cell)) : cell)}</th>`).join('')}</tr>`;
  return `${head}<div class="tax-rpt-actions"><button type="button" class="btn btn-tertiary" data-fx-foreign-export="xlsx" data-fx-foreign-kind="${kind}">${icon('download')}${esc(t('export.xlsx'))}</button><button type="button" class="btn btn-tertiary" data-fx-foreign-export="csv" data-fx-foreign-kind="${kind}">${icon('table')}${esc(t('export.csv'))}</button></div>
    <div class="tbl-wrap tax-rpt-scroll" tabindex="0" role="region" aria-label="${esc(t(`${kind}.title`))}"><table class="tax-table fx-foreign-table" data-fx-foreign="${kind}"><thead><tr>${table.header.map(label => `<th>${esc(label)}</th>`).join('')}</tr></thead><tbody>${body || `<tr><td colspan="${table.header.length}" class="tax-empty">${esc(t(`${kind}.none`))}</td></tr>`}</tbody><tfoot>${foot}</tfoot></table></div>
    <p class="tax-muted">${esc(t(`${kind}.note`))}</p>`;
}
function foreignRows(kind, branch, period) {
  const report = foreignReport(kind, branch, period);
  if (report.error) throw report.error;
  const table = fxForeignTable(report, lang());
  return [[t(`${kind}.title`)], [t('export.period', { period: monthLabel(period) }), branchLabel(branch)], [], table.header, ...table.body, table.footer];
}
function download(name, type, content) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
async function exportForeign(kind, branch, period, format = 'csv') {
  let rows;
  try { rows = foreignRows(kind, branch, period); } catch (error) { return refuse(errorText(error)); }
  const name = `${kind === 'pnd54' ? 'PND54' : 'PP36'}_${branch}_${period}`;
  if (format === 'csv') { download(`${name}.csv`, 'text/csv;charset=utf-8', taxCsvText(rows)); return { ok: true, rows }; }
  // app.js loadSheetJS(callback) loads the bundled SheetJS once (offline) and then calls back.
  if (!window.XLSX && typeof window.loadSheetJS === 'function') await new Promise(resolve => window.loadSheetJS(resolve));
  const XLSX = window.XLSX;
  if (!XLSX) return refuse(t('export.noExcel'));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), kind === 'pnd54' ? 'PND54' : 'PP36');
  XLSX.writeFile(wb, `${name}.xlsx`);
  return { ok: true, rows };
}
// The rate table / receipts / sales lists as rows (CSV / Excel of the page).
function tableRows(name) {
  const data = dataset();
  if (data.error) throw data.error;
  if (name === 'rates') return [[t('col.rateDate'), t('col.currency'), t('col.rateType'), t('col.rateValue'), t('col.per'), t('col.source'), t('col.version'), t('col.enteredBy'), 'enteredAt'], ...rateRows(data).map(({ row }) => [row.date, row.currency, row.type, row.rate, row.per, row.sourceNote, row.version, row.enteredBy, row.enteredAt])];
  return [];
}
async function exportTable(name, format) {
  let rows;
  try { rows = tableRows(name); } catch (error) { return refuse(errorText(error)); }
  if (format === 'csv') { download(`fx-${name}.csv`, 'text/csv;charset=utf-8', taxCsvText(rows)); return { ok: true, rows }; }
  // app.js loadSheetJS(callback) loads the bundled SheetJS once (offline) and then calls back.
  if (!window.XLSX && typeof window.loadSheetJS === 'function') await new Promise(resolve => window.loadSheetJS(resolve));
  const XLSX = window.XLSX;
  if (!XLSX) return refuse(t('export.noExcel'));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  XLSX.writeFile(wb, `fx-${name}.xlsx`);
  return { ok: true, rows };
}

// ---------------------------------------------------------------- JSON backup (masterData.fx)
function exportBackup() {
  return { settings: readSettings(), rates: readRates(), documents: readDocuments() };
}
function validateBackup(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(t('error.backup'));
  return { settings: normalizeFxSettings(value.settings ?? null), rates: normalizeFxRateStore(value.rates ?? null), documents: normalizeFxDocuments(value.documents ?? null) };
}
// Merge: rates are append-only (the union by id; a file row that differs from this device's row with the same id is
// refused), month-end closes by id (this device's version wins on merge; a close the file adds or changes inside a closed
// period is refused). Settings: the file wins on replace or when this device has none.
function backupWrites(value, options = {}) {
  const incoming = validateBackup(value);
  if (!incoming) return [];
  const writes = [];
  if (options.replace || readRaw(FX_SETTINGS_KEY) === null) writes.push([storageKey(FX_SETTINGS_KEY), incoming.settings]);
  const here = options.replace ? emptyFxRateStore() : readRates();
  const byId = new Map(here.rates.map(row => [row.id, row]));
  for (const row of incoming.rates.rates) {
    const mine = byId.get(row.id);
    if (mine && JSON.stringify(mine) !== JSON.stringify(row)) throw new Error(t('error.backupRate', { id: row.id }));
    if (!mine) byId.set(row.id, row);
  }
  writes.push([storageKey(FX_RATES_KEY), normalizeFxRateStore({ schemaVersion: 1, rates: [...byId.values()] })]);
  const docsHere = options.replace ? emptyFxDocuments() : readDocuments();
  const mine = new Map(docsHere.closes.map(close => [close.id, close]));
  const current = readDocuments();
  for (const close of incoming.documents.closes) {
    const before = current.closes.find(row => row.id === close.id);
    if (!before || JSON.stringify(before) !== JSON.stringify(close)) for (const row of [...close.rows, ...close.exportValues]) for (const date of [close.date, close.reverseDate]) { const lock = lockText(row.kind === 'ap' ? 'purchase' : 'sales', row.branch, date, 'restore'); if (lock) throw new Error(t('error.backupLocked', { lock })); }
    if (!mine.has(close.id)) mine.set(close.id, close);
  }
  writes.push([storageKey(FX_DOCUMENTS_KEY), normalizeFxDocuments({ schemaVersion: 1, closes: [...mine.values()] })]);
  return writes;
}

// ---------------------------------------------------------------- render + events
function shellHtml() {
  const tab = id => { const active = ui.tab === id; return `<button type="button" role="tab" id="fx-tab-${id}" class="afc-tab${active ? ' active' : ''}" data-fx-tab="${id}" aria-selected="${active}" aria-controls="fx-content" tabindex="${active ? 0 : -1}">${esc(t(`tab.${id}`))}</button>`; };
  return `<div class="afc-head"><div class="card-title"><span>${icon('globe')}${esc(t('page.title'))}</span></div><p>${esc(t('page.intro'))}</p></div>
  <div class="afc-tabs" role="tablist" aria-label="${esc(t('page.tabs'))}">${TABS.map(tab).join('')}</div>
  <div id="fx-content" class="afc-content" role="tabpanel" aria-labelledby="fx-tab-${ui.tab}" tabindex="-1"></div>`;
}
function contentHtml(data) {
  if (!data.settings.allowedCurrencies.length && !['settings', 'rates'].includes(ui.tab)) return `<div class="afc-box afc-box-warn" role="note">${esc(t('settings.noneAllowed'))} <button type="button" class="btn btn-secondary btn-sm" data-fx-tab="settings">${esc(t('tab.settings'))}</button></div>`;
  if (ui.tab === 'sales') return renderSales(data);
  if (ui.tab === 'receipts') return renderReceipts(data);
  if (ui.tab === 'payables') return renderPayables(data);
  if (ui.tab === 'adjust') return renderAdjust(data);
  if (ui.tab === 'monthEnd') return renderMonthEnd(data);
  if (ui.tab === 'settings') return renderSettings(data);
  return `${messageHtml()}${renderRates(data)}`;
}
function render() {
  const root = $(ROOT_ID);
  if (!root) return null;
  const data = dataset();
  if (data.error) { root.innerHTML = `<div class="afc-head"><div class="card-title"><span>${icon('globe')}${esc(t('page.title'))}</span></div></div>${errorHtml(data.error)}`; return null; }
  root.innerHTML = shellHtml();
  const host = $('fx-content');
  if (host) host.innerHTML = contentHtml(data);
  return data;
}
let queued = false;
function scheduleRender() {
  if (queued || !$(`panel-${PANEL_ID}`)?.classList.contains('active')) return;
  queued = true;
  setTimeout(() => { queued = false; try { render(); } catch (error) { console.error('[FX] render failed', error); } }, 0);
}
// Form reads (the screen keeps the drafts in `ui`, so a re-render never loses what was typed).
function readForm(attribute, target) {
  document.querySelectorAll(`#${ROOT_ID} [data-${attribute}]`).forEach(el => { const name = el.dataset[attribute.replace(/-([a-z])/g, (m, c) => c.toUpperCase())]; if (name) target[name] = el.type === 'checkbox' ? el.checked : el.value; });
}
function readSaleForm() {
  if (!ui.sale) return;
  readForm('fx-s', ui.sale);
  document.querySelectorAll(`#${ROOT_ID} [data-fx-sl]`).forEach(el => { const line = ui.sale.lines[Number(el.dataset.index)]; if (line) line[el.dataset.fxSl] = el.value; });
}
function readReceiptForm() { if (ui.receipt) readForm('fx-rc', ui.receipt); }
function readExpenseForm() { if (ui.expense) readForm('fx-e', ui.expense); }
function readAdjustForm() { if (ui.adjust) readForm('fx-a', ui.adjust); }
function readPurchaseForm() {
  if (!ui.purchase) return;
  readForm('fx-o', ui.purchase);
  document.querySelectorAll(`#${ROOT_ID} [data-fx-ol]`).forEach(el => { const line = ui.purchase.lines[Number(el.dataset.index)]; if (line) line[el.dataset.fxOl] = el.value; });
  const receive = $('fx-po-receive-date');
  if (receive) ui.receiveDate = receive.value;
}
function readPaymentForm() {
  const payment = ui.payment;
  if (!payment) return;
  readForm('fx-p', payment);
  document.querySelectorAll(`#${ROOT_ID} [data-fx-pw]`).forEach(el => { const name = el.dataset.fxPw; payment.wht[name] = el.type === 'checkbox' ? el.checked : name === 'grossUp' ? el.value === '1' : el.value; });
  const pp36 = document.querySelector(`#${ROOT_ID} [data-fx-pp36]`);
  if (pp36) payment.pp36.enabled = pp36.checked;
}
function readRateForm() {
  const form = ui.rateForm || {};
  return { ...form, date: $('fx-r-date')?.value || form.date, currency: $('fx-r-currency')?.value || form.currency, type: $('fx-r-type')?.value || form.type, rate: $('fx-r-rate')?.value ?? '', per: Number($('fx-r-per')?.value || 1), sourceNote: $('fx-r-source')?.value ?? '', source: 'manual', correct: !!form.correct };
}
function readAll() { readSaleForm(); readReceiptForm(); readExpenseForm(); readAdjustForm(); readPaymentForm(); readPurchaseForm(); }
async function onSubmit(event) {
  const form = event.target;
  if (!form?.id) return;
  event.preventDefault();
  if (form.matches?.('[data-fx-settings-form]')) { const { patch, context } = readSettingsForm(form); saveSettings(patch, context); try { renderSettingsCard(); } catch (error) { console.error('[FX] settings card failed', error); } return; }
  if (form.id === 'fx-rate-form') { ui.rateForm = readRateForm(); saveRate(ui.rateForm); return; }
  readAll();
  if (form.id === 'fx-sale-form') await saveSale();
  else if (form.id === 'fx-receipt-form') await saveReceipt();
  else if (form.id === 'fx-expense-form') saveExpense();
  else if (form.id === 'fx-payment-form') savePayment();
  else if (form.id === 'fx-adjust-form') await saveAdjust();
  else if (form.id === 'fx-purchase-form') savePurchase();
}
function onClick(event) {
  const target = event.target;
  const tab = target.closest?.('[data-fx-tab]');
  if (tab) { readAll(); ui.tab = TABS.includes(tab.dataset.fxTab) ? tab.dataset.fxTab : 'rates'; render(); $(`fx-tab-${ui.tab}`)?.focus(); return; }
  const data = dataset();
  if (data.error) return;
  const go = target.closest?.('[data-fx-goto-rate]');
  if (go) { const [currency, date, type] = go.dataset.fxGotoRate.split('|'); readAll(); ui.rateForm = { date, currency, type: FX_RATE_TYPES.includes(type) ? type : 'bot_avg_buying', rate: '', per: currencyInfo(currency)?.quotePer || 1, sourceNote: '', correct: false }; ui.tab = 'rates'; render(); $('fx-r-rate')?.focus(); return; }
  const correct = target.closest?.('[data-fx-correct]');
  if (correct) { const row = data.rates.rates.find(item => item.id === correct.dataset.fxCorrect); if (row) { ui.rateForm = { date: row.date, currency: row.currency, type: row.type, rate: row.rate, per: row.per, sourceNote: '', correct: true }; render(); $('fx-r-rate')?.focus(); } return; }
  if (target.closest?.('[data-fx-rate-cancel]')) { ui.rateForm = null; render(); return; }
  if (target.closest?.('[data-fx-csv-template]')) { download('fx-rates-template.csv', 'text/csv;charset=utf-8', fxCsvTemplate()); return; }
  if (target.closest?.('[data-fx-csv-commit]')) { commitCsv(); return; }
  if (target.closest?.('[data-fx-csv-cancel]')) { ui.csv = null; render(); return; }
  const exportButton = target.closest?.('[data-fx-export]');
  if (exportButton) { exportTable(exportButton.dataset.fxTable, exportButton.dataset.fxExport); return; }
  if (target.closest?.('[data-fx-sl-add]')) { readSaleForm(); ui.sale.lines.push({ product: '', qty: '1', unit: 'ชิ้น', priceFx: '' }); render(); return; }
  const removeLine = target.closest?.('[data-fx-sl-remove]');
  if (removeLine) { readSaleForm(); ui.sale.lines.splice(Number(removeLine.dataset.fxSlRemove), 1); render(); return; }
  if (target.closest?.('[data-fx-sale-reset]')) { ui.sale = blankSale(data); render(); return; }
  const toInvoice = target.closest?.('[data-fx-quote-to-invoice]');
  if (toInvoice) { const quote = fxQuotes(data).find(row => keyOfInvoice(row) === toInvoice.dataset.fxQuoteToInvoice); if (quote) { ui.sale = saleFromQuote(data, quote); ui.tab = 'sales'; render(); } return; }
  const printInvoice = target.closest?.('[data-fx-print-invoice]');
  if (printInvoice) { const invoice = fxInvoices(data).find(row => keyOfInvoice(row) === printInvoice.dataset.fxPrintInvoice); if (invoice) window.showDetailById?.('invoices', invoice._branch, invoice._year, invoice._month, String(invoice.id)); return; }
  const printReceipt = target.closest?.('[data-fx-print-receipt]');
  if (printReceipt) { const receipt = data.business.receipts.find(row => keyOfInvoice(row) === printReceipt.dataset.fxPrintReceipt); if (receipt) window.showDetailById?.('receipts', receipt._branch, receipt._year, receipt._month, String(receipt.id)); return; }
  const receive = target.closest?.('[data-fx-receive]');
  if (receive) { readAll(); ui.receipt = { ...blankReceipt(data), invoiceKey: receive.dataset.fxReceive }; ui.tab = 'receipts'; render(); $('fx-rc-amount')?.focus(); return; }
  const pay = target.closest?.('[data-fx-pay]');
  if (pay) { readAll(); ui.payment = blankPayment(data, fxPayables(data).find(row => row.key === pay.dataset.fxPay)); render(); $('fx-p-date')?.focus(); return; }
  if (target.closest?.('[data-fx-pay-cancel]')) { ui.payment = null; render(); return; }
  if (target.closest?.('[data-fx-ol-add]')) { readPurchaseForm(); ui.purchase.lines.push({ product: '', qty: '1', unit: 'ชิ้น', priceFx: '' }); render(); return; }
  const removePurchaseLine = target.closest?.('[data-fx-ol-remove]');
  if (removePurchaseLine) { readPurchaseForm(); ui.purchase.lines.splice(Number(removePurchaseLine.dataset.fxOlRemove), 1); render(); return; }
  const receivePo = target.closest?.('[data-fx-po-receive]');
  if (receivePo) { readPurchaseForm(); receivePurchase(receivePo.dataset.fxPoReceive, ui.receiveDate || todayIso()); return; }
  const voidPay = target.closest?.('[data-fx-pay-void]');
  if (voidPay) { const reason = window.prompt(t('payable.voidPrompt')); if (reason === null) return; const [key, id] = splitLast(voidPay.dataset.fxPayVoid); voidPayment(key, id, reason); return; }
  const close = target.closest?.('[data-fx-close]');
  if (close) { if (window.confirm(t('close.confirm', { period: monthLabel(close.dataset.fxClose) })) !== true) return; closeMonth(close.dataset.fxClose); return; }
  const voidClosing = target.closest?.('[data-fx-close-void]');
  if (voidClosing) { const reason = window.prompt(t('close.voidPrompt')); if (reason === null) return; voidClose(voidClosing.dataset.fxCloseVoid, reason); }
}
const splitLast = value => { const index = String(value).lastIndexOf('|'); return [value.slice(0, index), value.slice(index + 1)]; };
function onChange(event) {
  const target = event.target;
  const id = target?.id;
  if (id === 'fx-csv-file' && target.files?.[0]) {
    const file = target.files[0];
    const reader = new FileReader();
    reader.onload = () => previewCsv(String(reader.result || ''), file.name, false);
    reader.onerror = () => refuse(t('csv.read'));
    reader.readAsText(file, 'utf-8');
    return;
  }
  if (id === 'fx-csv-corrections' && ui.csv) { previewCsv(ui.csv.content, ui.csv.fileName, target.checked); return; }
  if (id === 'fx-f-currency') { ui.rateCurrency = target.value; render(); $(id)?.focus(); return; }
  if (id === 'fx-f-type') { ui.rateType = target.value; render(); $(id)?.focus(); return; }
  if (['fx-l-date', 'fx-l-currency', 'fx-l-type'].includes(id)) { ui.lookup = { date: $('fx-l-date')?.value || todayIso(), currency: $('fx-l-currency')?.value || '', type: $('fx-l-type')?.value || 'bot_avg_buying' }; render(); $(id)?.focus(); return; }
  if (id === 'fx-r-currency' && ui.rateForm?.correct !== true) { ui.rateForm = { ...readRateForm(), per: currencyInfo(target.value)?.quotePer || 1 }; render(); $(id)?.focus(); return; }
  if (id === 'fx-period') { ui.period = target.value; render(); $(id)?.focus(); return; }
  if (target?.closest?.('[data-fx-settings-form]')) return;
  if (target?.dataset && (target.dataset.fxS !== undefined || target.dataset.fxSl !== undefined || target.dataset.fxRc !== undefined || target.dataset.fxE !== undefined || target.dataset.fxA !== undefined || target.dataset.fxP !== undefined || target.dataset.fxPw !== undefined || target.dataset.fxPp36 !== undefined || target.dataset.fxO !== undefined || target.dataset.fxOl !== undefined)) { readAll(); render(); $(id)?.focus(); }
}
function onKeydown(event) {
  const tab = event.target.closest?.('[data-fx-tab][role="tab"]');
  if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const index = TABS.indexOf(tab.dataset.fxTab);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
  ui.tab = TABS[next];
  render();
  $(`fx-tab-${ui.tab}`)?.focus();
}

window.ERPFx = Object.freeze({
  VERSION: FX_CORE_VERSION,
  render,
  select: (options = {}) => { readAll(); for (const [key, value] of Object.entries(options)) if (Object.prototype.hasOwnProperty.call(ui, key)) ui[key] = value; return render(); },
  state: () => JSON.parse(JSON.stringify(ui)),
  dataset: () => dataset(),
  setToday: iso => { todayOverride = String(iso || ''); cached = null; },
  invalidate: () => { cached = null; },
  saveRate, previewCsv, commitCsv, saveSettings, saveSale, saveReceipt, saveExpense, savePayment, voidPayment, saveAdjust, closeMonth, voidClose, savePurchase, receivePurchase,
  monthPlan: period => { const data = dataset(); return data.error ? { error: data.error } : monthPlan(data, period); },
  openInvoices: () => { const data = dataset(); return data.error ? [] : openInvoices(data); },
  payables: () => { const data = dataset(); return data.error ? [] : fxPayables(data); },
  openFxOf,
  foreignReport, foreignTabHtml, foreignRows, exportForeign, exportTable,
  exportBackup, validateBackup, backupWrites,
  renderSettingsCard,
  t
});

function boot() {
  const root = $(ROOT_ID);
  window.addEventListener(STORAGE_WRITTEN_EVENT, () => {
    cached = null;
    scheduleRender();
    const settingsOpen = $(`panel-${SETTINGS_PANEL_ID}`)?.classList.contains('active');
    if (settingsOpen && !$(CARD_ID)?.contains(document.activeElement)) { try { renderSettingsCard(); } catch (error) { console.error('[FX] settings card failed', error); } } else cardStale = true;
  });
  window.addEventListener(COMPANY_PROFILE_CHANGED_EVENT, scheduleRender);
  window.addEventListener('erp:language-changed', () => {
    try { if (root?.childElementCount) render(); if ($(CARD_ID)) renderSettingsCard(); } catch (error) { console.error('[FX] render failed', error); }
  });
  document.addEventListener('erp:navigation', event => {
    const id = event.detail?.id;
    if (id === PANEL_ID) { try { render(); } catch (error) { console.error('[FX] render failed', error); } }
    if (id === SETTINGS_PANEL_ID && (cardStale || !$(CARD_ID)?.childElementCount)) { try { renderSettingsCard(); } catch (error) { console.error('[FX] settings card failed', error); } }
  });
  // The card mounts when the journal's settings wrapper exists (it is drawn when the settings page is opened).
  setTimeout(() => { try { mountSettingsCard(); } catch (error) { console.error('[FX] settings card mount failed', error); } }, 0);
  if (!root) return;
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('submit', onSubmit);
  root.addEventListener('keydown', onKeydown);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
