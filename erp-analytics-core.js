// ============================================================================
// erp-analytics-core.js — the sales measure, periods, comparisons, ABC and reorder maths (ADR-027)
// ERP DEMO 4.3.1 · round 10 · pure: no DOM, no storage, no clock (every "today" is passed in)
// ----------------------------------------------------------------------------
// 1. THE SALES MEASURE — defined once, here, and used by the dashboard KPIs (app.js metricFromData /
//    branchStats) and by the page "วิเคราะห์และคาดการณ์", so the two can never disagree:
//      sales of a branch-month pack = live tax invoices (pre-VAT, invoiceNetSales) + live legacy production
//      orders that no invoice delivered yet (productionNetSalesValue; an invoice delivering one is not counted
//      twice) − live credit notes + live debit notes, each note in ITS OWN month (ADR-023 / ADR-024), spread over
//      the original invoice's items (erp-receivables-core.js buildCreditNoteSalesAdjustments).
//    Cancelled / voided documents count 0. Receipts are payments of those invoices, never sales a second time.
//    The functions resolveVatMode … dedupeRecords were moved here unchanged from app.js (round 10).
// 2. Monthly lines → series, comparisons (this period / previous period / same period last year), top movers.
// 3. ABC classification. 4. Reorder point and suggested order. 5. The demo monthly sales history (ADR-013 +
//    ADR-027): summarised months of sample data, used ONLY for a branch-month with no sales document.
// ============================================================================
import { roundMoneyValue, DEFAULT_VAT_DIVISOR, isGeneralCustomerName } from './erp-shared-core.js';
import { buildCreditNoteSalesAdjustments, itemSharesForRow, salesItemValue, UNKNOWN_CUSTOMER_LABEL } from './erp-receivables-core.js';

export const ANALYTICS_CORE_VERSION = '1.0.0';
// Keys for things that are not a stored name (shown through the UI text table, never as data).
export const UNKNOWN_PRODUCT_KEY = '__unknown_product__';
export const ADJUSTMENT_PRODUCT_KEY = '__document_adjustment__';
export const UNKNOWN_CUSTOMER_KEY = '__unknown_customer__';
export const ANALYTICS_WALK_IN_KEY = '__walk_in__';
export const OTHER_CATEGORY_KEY = '__other_category__';
export const ANALYTICS_DIMENSIONS = Object.freeze(['product', 'customer', 'branch', 'category']);
export const PERIOD_TYPES = Object.freeze(['month', 'quarter', 'year']);
const ANALYTICS_BRANCH_IDS = Object.freeze(['ubon', 'khonkaen']);
const analyticsNum = n => (Number.isFinite(Number(n)) ? Number(n) : 0);
const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const keyText = value => text(value).toLowerCase();

// ---------------------------------------------------------------- 1. the measure (moved from app.js)
export function resolveVatMode(doc = {}) {
  if (doc.vatMode === 'add' || doc.vatMode === 'extract' || doc.vatMode === 'none') return doc.vatMode;
  if (Number(doc.vatAmt || 0) > 0) return Number(doc.useVat || 0) === 1 ? 'add' : 'extract';
  return 'none';
}

export function invoiceNetSales(doc = {}) {
  // Dashboard must use sales value excluding VAT, matching the invoice report.
  const hasNumber = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  if (hasNumber(doc.subtotal)) return roundMoneyValue(Number(doc.subtotal));
  const itemSale = hasNumber(doc.itemSaleTotal) ? Number(doc.itemSaleTotal) : null;
  const rawSale = hasNumber(doc.saleTotal) ? Number(doc.saleTotal) : null;
  const grandTotal = hasNumber(doc.total) ? Number(doc.total) : null;
  const mode = resolveVatMode(doc);
  if (mode === 'extract') {
    const gross = itemSale ?? rawSale ?? grandTotal ?? 0;
    return roundMoneyValue(gross / DEFAULT_VAT_DIVISOR);
  }
  if (mode === 'add') {
    if (itemSale !== null) return roundMoneyValue(itemSale);
    if (rawSale !== null) return roundMoneyValue(rawSale);
    if (grandTotal !== null) return roundMoneyValue(grandTotal / DEFAULT_VAT_DIVISOR);
  }
  if (itemSale !== null) return roundMoneyValue(itemSale);
  if (rawSale !== null) return roundMoneyValue(rawSale);
  return roundMoneyValue(grandTotal ?? 0);
}

export function productionNetSalesValue(record = {}) {
  const subtotal = analyticsNum(record.subtotal);
  if (subtotal) return subtotal;
  if (record.schemaVersion === 2) return 0;
  return analyticsNum(record.total || record.saleTotal || record.itemSaleTotal);
}

// The same document saved locally and synced back (same firebaseId / id / number + date) is one document.
export function sameBusinessDoc(a, b) {
  if (!a || !b) return false;
  if (a.firebaseId && b.firebaseId && String(a.firebaseId) === String(b.firebaseId)) return true;
  if (a.id !== undefined && b.id !== undefined && String(a.id) === String(b.id)) return true;
  const aNo = a.no || a.invNo || '';
  const bNo = b.no || b.invNo || '';
  if (aNo && bNo && a.date && b.date && String(aNo) === String(bNo) && String(a.date) === String(b.date)) {
    const aBranch = a.branch || '';
    const bBranch = b.branch || '';
    return !aBranch || !bBranch || aBranch === bBranch;
  }
  return false;
}

export function mergeBusinessDoc(oldDoc, newDoc) {
  // ใช้รวมรายการ localStorage กับรายการเดียวกันที่ sync กลับมาจาก Firebase
  // เครื่องที่กรอกข้อมูลจะมี local row ก่อน แล้ว cloud row ตามมา จึงต้องรวมให้เหลือแถวเดียว
  const merged = { ...oldDoc, ...newDoc };
  merged.firebaseId = newDoc.firebaseId || oldDoc.firebaseId || merged.firebaseId;
  merged.branch = newDoc.branch || oldDoc.branch || merged.branch;
  merged._m = Number.isFinite(Number(newDoc._m)) ? Number(newDoc._m) : oldDoc._m;
  merged._y = Number.isFinite(Number(newDoc._y)) ? Number(newDoc._y) : oldDoc._y;
  return merged;
}

export function dedupeRecords(rows) {
  const result = [];
  (rows || []).forEach(row => {
    const idx = result.findIndex(existing => sameBusinessDoc(existing, row));
    if (idx >= 0) result[idx] = mergeBusinessDoc(result[idx], row);
    else result.push(row);
  });
  return result;
}

// The live-document rule of erp-integrity.js (ERPIntegrity.live): cancelled, voided and reversed rows count 0.
export function isLiveDocument(row) {
  return !!(row && !row.voided && !row.cancelled && !row.reversed && row.status !== 'cancelled');
}

// Pre-VAT sales value of one measure row (invoice, legacy production, credit / debit-note adjustment row).
export function salesRowValue(row) {
  if (row?._type === 'invoices' || row?._type === 'receipts' || row?._type === 'issuedInvoices' || row?._type === 'issuedReceipts') return invoiceNetSales(row);
  if (row?._type === 'quotes' || row?._type === 'creditNotes' || row?._type === 'debitNotes') return analyticsNum(row.subtotal || row.saleTotal || row.total);
  return productionNetSalesValue(row);
}

// Live legacy production orders (not from a Sales Order) count as sales; an invoice that delivered one of them
// (same branch, sourceProductionId / sourceProductionNo) is then not counted again. New Sales Order production is
// work in progress: its invoices count when delivered. options.legacyProductions = every production order of every
// month (business().productions, with _branch); options.live = the live rule (default isLiveDocument).
export function primarySalesRows(data = {}, options = {}) {
  const live = typeof options.live === 'function' ? options.live : isLiveDocument;
  const prods = (data.productions || []).filter(live).filter(p => !p.sourceSalesOrderId);
  const allProds = (Array.isArray(options.legacyProductions) ? options.legacyProductions : []).filter(live).filter(p => !p.sourceSalesOrderId);
  const direct = (data.invoices || []).filter(live).filter(i => !allProds.some(p => p._branch === (i.branch || i._branch) && ((i.sourceProductionId && String(i.sourceProductionId) === String(p.id)) || (i.sourceProductionNo && i.sourceProductionNo === p.no))));
  return [...prods, ...direct.map(i => ({ ...i, _type: 'invoices' }))];
}

// Every measure row of one branch-month pack. meta = { branch, year, month (0–11) } of the pack.
// options.resolveInvoice(ref) finds a note's original invoice (ERPIntegrity.resolveInvoice over business()).
export function packSalesRows(pack = {}, meta = {}, options = {}) {
  const branch = meta.branch;
  const tag = row => ({ ...row, branch: branch || row.branch || row._branch });
  const primary = primarySalesRows({ productions: dedupeRecords(pack.productions || []).map(tag), invoices: dedupeRecords(pack.invoices || []).map(tag) }, options);
  const period = Object.fromEntries(Object.entries({ branch, _branch: branch, _year: meta.year, _month: meta.month }).filter(([, value]) => value !== undefined && value !== null && value !== ''));
  const notes = [...(Array.isArray(pack.creditNotes) ? pack.creditNotes : []), ...(Array.isArray(pack.debitNotes) ? pack.debitNotes : [])];
  const resolve = typeof options.resolveInvoice === 'function' ? options.resolveInvoice : () => null;
  const adjustments = buildCreditNoteSalesAdjustments(notes.map(note => ({ ...note, ...period })), ref => resolve(ref));
  return [...primary, ...adjustments];
}

export function packSalesTotal(rows) {
  return roundMoneyValue((Array.isArray(rows) ? rows : []).reduce((sum, row) => sum + salesRowValue(row), 0));
}

// Does a pack hold any sales document at all (any status)? Such a branch-month is "covered by documents":
// the demo history is never used for it.
export function packHasSalesDocuments(pack = {}) {
  return ['invoices', 'productions', 'creditNotes', 'debitNotes'].some(collection => Array.isArray(pack[collection]) && pack[collection].length > 0);
}

// Cancelled / voided sales documents in a pack (not counted; reported so the user knows they exist).
export function packCancelledCount(pack = {}) {
  let count = 0;
  for (const collection of ['invoices', 'productions', 'creditNotes', 'debitNotes']) {
    for (const row of Array.isArray(pack[collection]) ? pack[collection] : []) if (row && !isLiveDocument(row)) count += 1;
  }
  return count;
}

// ---------------------------------------------------------------- months and periods
export const THAI_MONTHS = Object.freeze(['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']);
export const THAI_MONTHS_SHORT = Object.freeze(['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']);
export const EN_MONTHS = Object.freeze(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);
export const EN_MONTHS_SHORT = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
const MONTH_KEY_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// 'YYYY-MM' (Gregorian year, month 1–12) — storage and query keys stay in C.E. like the rest of the app.
export function monthKey(year, month) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}
export function parseMonthKey(key) {
  const match = MONTH_KEY_RE.exec(String(key ?? ''));
  return match ? { year: Number(match[1]), month: Number(match[2]) } : null;
}
export function isMonthKey(key) {
  return parseMonthKey(key) !== null;
}
export function monthIndex(key) {
  const parts = parseMonthKey(key);
  return parts ? parts.year * 12 + parts.month - 1 : NaN;
}
export function monthKeyFromIndex(index) {
  return monthKey(Math.floor(index / 12), (index % 12) + 1);
}
export function addMonths(key, count) {
  return monthKeyFromIndex(monthIndex(key) + count);
}
export function monthRange(startKey, endKey) {
  const start = monthIndex(startKey);
  const end = monthIndex(endKey);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return [];
  const out = [];
  for (let index = start; index <= end; index += 1) out.push(monthKeyFromIndex(index));
  return out;
}
export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
export function daysInMonth(year, month) {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
export function daysInMonthOf(key) {
  const parts = parseMonthKey(key);
  return parts ? daysInMonth(parts.year, parts.month) : NaN;
}
export function parseIsoDate(iso) {
  const match = ISO_DATE_RE.exec(String(iso ?? '').slice(0, 10));
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}
// The month a business date belongs to ('2026-09-30' → '2026-09').
export function monthOfDate(iso) {
  const parts = parseIsoDate(iso);
  return parts ? monthKey(parts.year, parts.month) : '';
}
// The current (incomplete) month and the latest closed month for a business date.
export function currentMonthKey(todayIso) {
  return monthOfDate(todayIso);
}
export function lastClosedMonthKey(todayIso) {
  const current = currentMonthKey(todayIso);
  return current ? addMonths(current, -1) : '';
}
// Calendar arithmetic on date-only values (UTC days, so no time-zone or DST drift).
export function addDaysIso(iso, days) {
  const parts = parseIsoDate(iso);
  if (!parts || !Number.isFinite(days)) return '';
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + Math.trunc(days)));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
// dd/mm/yyyy: พ.ศ. in Thai, ค.ศ. in English.
export function displayDate(iso, lang = 'th') {
  const parts = parseIsoDate(iso);
  if (!parts) return '';
  const year = lang === 'en' ? parts.year : parts.year + 543;
  return `${String(parts.day).padStart(2, '0')}/${String(parts.month).padStart(2, '0')}/${year}`;
}
export function monthLabel(key, lang = 'th', options = {}) {
  const parts = parseMonthKey(key);
  if (!parts) return '';
  if (lang === 'en') return options.short ? `${EN_MONTHS_SHORT[parts.month - 1]} ${String(parts.year).slice(-2)}` : `${EN_MONTHS[parts.month - 1]} ${parts.year}`;
  const be = parts.year + 543;
  return options.short ? `${THAI_MONTHS_SHORT[parts.month - 1]} ${String(be).slice(-2)}` : `${THAI_MONTHS[parts.month - 1]} ${be}`;
}
export function monthRangeLabel(startKey, endKey, lang = 'th') {
  if (!isMonthKey(startKey) || !isMonthKey(endKey)) return '';
  const short = key => {
    const parts = parseMonthKey(key);
    return lang === 'en' ? `${EN_MONTHS_SHORT[parts.month - 1]} ${parts.year}` : `${THAI_MONTHS_SHORT[parts.month - 1]} ${parts.year + 543}`;
  };
  return startKey === endKey ? short(startKey) : `${short(startKey)} – ${short(endKey)}`;
}

// A period chosen on the page: { type: 'month', value: 'YYYY-MM' } · { type: 'quarter', value: 'YYYY-Qn' } ·
// { type: 'year', value: 'YYYY' }.
export function parsePeriod(spec = {}) {
  const type = PERIOD_TYPES.includes(spec?.type) ? spec.type : '';
  const value = String(spec?.value ?? '');
  if (type === 'month' && isMonthKey(value)) return { type, value, year: parseMonthKey(value).year };
  if (type === 'quarter') {
    const match = /^(\d{4})-Q([1-4])$/.exec(value);
    if (match) return { type, value, year: Number(match[1]), quarter: Number(match[2]) };
  }
  if (type === 'year' && /^\d{4}$/.test(value)) return { type, value, year: Number(value) };
  return null;
}
export function periodOfMonth(type, key) {
  const parts = parseMonthKey(key);
  if (!parts) return null;
  if (type === 'month') return { type, value: key };
  if (type === 'quarter') return { type, value: `${parts.year}-Q${Math.floor((parts.month - 1) / 3) + 1}` };
  if (type === 'year') return { type, value: String(parts.year) };
  return null;
}
// Every month of a period (closed or not).
export function periodAllMonths(spec) {
  const period = parsePeriod(spec);
  if (!period) return [];
  if (period.type === 'month') return [period.value];
  if (period.type === 'quarter') {
    const first = (period.quarter - 1) * 3 + 1;
    return [0, 1, 2].map(offset => monthKey(period.year, first + offset));
  }
  return Array.from({ length: 12 }, (_, i) => monthKey(period.year, i + 1));
}
export function periodLabel(spec, lang = 'th') {
  const period = parsePeriod(spec);
  if (!period) return '';
  if (period.type === 'month') return monthLabel(period.value, lang);
  if (period.type === 'quarter') return lang === 'en' ? `Q${period.quarter} ${period.year}` : `ไตรมาส ${period.quarter}/${period.year + 543}`;
  return lang === 'en' ? String(period.year) : `ปี ${period.year + 543}`;
}
// Periods of a type from the month `firstKey` to the latest closed month, newest first.
export function listPeriods(type, firstKey, lastClosedKey) {
  const months = monthRange(firstKey, lastClosedKey);
  const seen = new Set();
  const out = [];
  for (let i = months.length - 1; i >= 0; i -= 1) {
    const period = periodOfMonth(type, months[i]);
    if (period && !seen.has(period.value)) { seen.add(period.value); out.push(period); }
  }
  return out;
}
// The months compared, like for like. Only closed months count: a quarter / year still running is compared on
// its closed months ("to date") against the same months of the previous period and of the year before.
// For a year, "previous period" IS the year before (same months), so previous === lastYear.
export function comparisonWindows(spec, lastClosedKey) {
  const period = parsePeriod(spec);
  if (!period || !isMonthKey(lastClosedKey)) return { available: false, current: [], previous: [], lastYear: [], partial: false };
  const closed = periodAllMonths(period).filter(key => monthIndex(key) <= monthIndex(lastClosedKey));
  if (!closed.length) return { available: false, current: [], previous: [], lastYear: [], partial: false, period };
  const length = { month: 1, quarter: 3, year: 12 }[period.type];
  const lastYear = closed.map(key => addMonths(key, -12));
  const previous = period.type === 'year' ? lastYear.slice() : closed.map(key => addMonths(key, -length));
  return { available: true, period, current: closed, previous, lastYear, partial: closed.length < length, sameAsLastYear: period.type === 'year' };
}

// ---------------------------------------------------------------- lines (the measure split by product / customer)
// lookupProduct({ code, name }) → the Product Master row (or null); used for the canonical code / name / category.
function productIdentity(item, lookupProduct) {
  const code = text(item?.productCode || item?.code);
  const name = text(item?.product || item?.name);
  const master = typeof lookupProduct === 'function' ? lookupProduct({ code, name }) : null;
  const canonicalCode = text(master?.code || code);
  const canonicalName = text(master?.name || name);
  if (!canonicalCode && !canonicalName) return { productKey: UNKNOWN_PRODUCT_KEY, productCode: '', product: '', category: OTHER_CATEGORY_KEY, unit: text(item?.unit) };
  const category = text(master?.category || item?.productCategory || item?.category);
  return {
    productKey: canonicalCode ? `code:${keyText(canonicalCode)}` : `name:${keyText(canonicalName)}`,
    productCode: canonicalCode,
    product: canonicalName || canonicalCode,
    category: !category || category === 'อื่น ๆ' ? OTHER_CATEGORY_KEY : category,
    unit: text(master?.unit || item?.unit)
  };
}
export function customerIdentity(name) {
  const value = text(name);
  if (!value || value === UNKNOWN_CUSTOMER_LABEL) return { customerKey: UNKNOWN_CUSTOMER_KEY, customer: '' };
  if (isGeneralCustomerName(value)) return { customerKey: ANALYTICS_WALK_IN_KEY, customer: '' };
  return { customerKey: `name:${keyText(value)}`, customer: value };
}
// One line per item of every measure row; the line values of a row add up to the row's pre-VAT value exactly
// (itemSharesForRow: scaled shares, or raw lines + one "document adjustment" line).
export function salesLinesOfRows(rows, context = {}) {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const rowTotal = salesRowValue(row);
    const items = Array.isArray(row.items) && row.items.length ? row.items : [{ product: row.product || row.job || '', qty: row.qty || 0, unit: row.unit || '', saleTotal: rowTotal }];
    const plan = itemSharesForRow(rowTotal, items.map(salesItemValue));
    const customer = customerIdentity(row.customer || row.customerName || row.client);
    const base = { source: 'document', branch: context.branch || row.branch || row._branch || '', period: context.period || '', docType: row._type || 'productions', ...customer };
    items.forEach((item, index) => {
      out.push({ ...base, ...productIdentity(item, context.lookupProduct), qty: analyticsNum(item.qty), value: plan.shares[index] ?? 0 });
    });
    if (plan.remainder) out.push({ ...base, productKey: ADJUSTMENT_PRODUCT_KEY, productCode: '', product: '', category: OTHER_CATEGORY_KEY, unit: '', qty: 0, value: plan.remainder });
  }
  return out;
}

// ---------------------------------------------------------------- 5. demo monthly sales history
export const DEMO_HISTORY_SCHEMA_VERSION = 1;
export const DEMO_HISTORY_KIND = 'demo-monthly-sales-history';
export const DEMO_HISTORY_COLUMNS = Object.freeze(['period', 'branch', 'productCode', 'customer', 'qty', 'value']);
// Strict reader: anything unexpected makes the whole history unusable (fail-closed; the page then says so and
// shows documents only) — a damaged history is never half-used.
export function parseDemoSalesHistory(raw) {
  if (raw === null || raw === undefined || raw === '') return { ok: true, history: null };
  let value;
  try { value = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch (error) { return { ok: false, error: `json: ${error?.message || error}` }; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'not-an-object' };
  if (value.schemaVersion !== DEMO_HISTORY_SCHEMA_VERSION || value.kind !== DEMO_HISTORY_KIND || value.demoSeed !== true) return { ok: false, error: 'schema' };
  if (JSON.stringify(value.columns) !== JSON.stringify(DEMO_HISTORY_COLUMNS) || !Array.isArray(value.rows)) return { ok: false, error: 'columns' };
  for (let i = 0; i < value.rows.length; i += 1) {
    const row = value.rows[i];
    const valid = Array.isArray(row) && row.length === 6 && isMonthKey(row[0]) && ANALYTICS_BRANCH_IDS.includes(row[1]) && typeof row[2] === 'string' && row[2].trim() !== ''
      && typeof row[3] === 'string' && typeof row[4] === 'number' && Number.isFinite(row[4]) && typeof row[5] === 'number' && Number.isFinite(row[5]);
    if (!valid) return { ok: false, error: `row ${i + 1}` };
  }
  return { ok: true, history: value };
}
// History lines for every branch-month that `covered(branch, period)` says has no sales document.
export function historyLines(history, context = {}) {
  const out = [];
  if (!history || !Array.isArray(history.rows)) return out;
  const covered = typeof context.covered === 'function' ? context.covered : () => false;
  for (const [period, branch, productCode, customerName, qty, value] of history.rows) {
    if (covered(branch, period)) continue;
    out.push({ source: 'history', branch, period, docType: 'history', ...customerIdentity(customerName), ...productIdentity({ productCode }, context.lookupProduct), qty, value });
  }
  return out;
}
// Branch-months a history covers, and how many of them documents replaced (reported on the page).
export function historyCoverage(history, covered = () => false) {
  const months = new Set();
  const replaced = new Set();
  for (const row of history?.rows || []) {
    const id = `${row[1]}|${row[0]}`;
    months.add(id);
    if (covered(row[1], row[0])) replaced.add(id);
  }
  return { months: months.size, replaced: [...replaced].sort() };
}

// ---------------------------------------------------------------- 2. aggregation, series, comparisons
export function lineDimensionKey(line, dimension) {
  if (dimension === 'product') return line.productKey;
  if (dimension === 'customer') return line.customerKey;
  if (dimension === 'branch') return line.branch;
  if (dimension === 'category') return line.category === OTHER_CATEGORY_KEY ? OTHER_CATEGORY_KEY : `cat:${keyText(line.category)}`;
  return '';
}
// Sum of value / qty per month (and per dimension key when `dimension` is given).
export function monthlyTotals(lines, predicate = () => true) {
  const map = new Map();
  for (const line of Array.isArray(lines) ? lines : []) {
    if (!predicate(line)) continue;
    const row = map.get(line.period) || { value: 0, qty: 0, documents: 0, history: 0 };
    row.value += line.value;
    row.qty += line.qty;
    if (line.source === 'history') row.history += line.value; else row.documents += line.value;
    map.set(line.period, row);
  }
  return map;
}
// The monthly series of `field` ('value' | 'qty') from the first month with a non-zero figure to `endKey`; months
// without a figure are explicit zeros. The series never includes months after endKey (the current month).
export function buildMonthlySeries(totals, options = {}) {
  const field = options.field === 'qty' ? 'qty' : 'value';
  const endKey = options.endKey;
  if (!isMonthKey(endKey)) return { months: [], values: [], start: '', end: '' };
  let start = isMonthKey(options.startKey) ? options.startKey : '';
  if (!start) {
    const keys = [...(totals instanceof Map ? totals.keys() : [])].filter(key => isMonthKey(key) && monthIndex(key) <= monthIndex(endKey) && Math.abs(totals.get(key)[field]) > 1e-9).sort();
    start = keys[0] || '';
  }
  if (!start) return { months: [], values: [], start: '', end: endKey };
  const months = monthRange(start, endKey);
  const values = months.map(key => {
    const value = totals instanceof Map && totals.has(key) ? totals.get(key)[field] : 0;
    return field === 'value' ? roundMoneyValue(value) : Math.round(value * 1e6) / 1e6;
  });
  return { months, values, start, end: endKey };
}
// % change: null (shown "—") when the base is 0 or not a number — never Infinity / NaN. A negative base (more
// credit notes than sales) uses its absolute value, so the sign still says up / down.
export function percentChange(current, base) {
  const c = Number(current);
  const b = Number(base);
  if (!Number.isFinite(c) || !Number.isFinite(b) || b === 0) return null;
  return ((c - b) / Math.abs(b)) * 100;
}
// Rows of one dimension for the comparison windows (comparisonWindows): value this period, the previous period
// and the same period last year, with absolute and % changes. Sorted by this period, then by key.
export function compareByDimension(lines, dimension, windows) {
  const sets = { current: new Set(windows?.current || []), previous: new Set(windows?.previous || []), lastYear: new Set(windows?.lastYear || []) };
  const map = new Map();
  const totals = { current: 0, previous: 0, lastYear: 0, currentQty: 0, documents: 0, history: 0 };
  for (const line of Array.isArray(lines) ? lines : []) {
    const inCurrent = sets.current.has(line.period), inPrevious = sets.previous.has(line.period), inLastYear = sets.lastYear.has(line.period);
    if (!inCurrent && !inPrevious && !inLastYear) continue;
    const key = lineDimensionKey(line, dimension);
    const row = map.get(key) || { key, dimension, sample: line, current: 0, previous: 0, lastYear: 0, currentQty: 0 };
    if (inCurrent) {
      row.current += line.value; row.currentQty += line.qty;
      totals.current += line.value; totals.currentQty += line.qty;
      if (line.source === 'history') totals.history += line.value; else totals.documents += line.value;
    }
    if (inPrevious) { row.previous += line.value; totals.previous += line.value; }
    if (inLastYear) { row.lastYear += line.value; totals.lastYear += line.value; }
    map.set(key, row);
  }
  const finish = row => {
    const current = roundMoneyValue(row.current), previous = roundMoneyValue(row.previous), lastYear = roundMoneyValue(row.lastYear);
    return { ...row, current, previous, lastYear, changePrevious: roundMoneyValue(current - previous), pctPrevious: percentChange(current, previous), changeLastYear: roundMoneyValue(current - lastYear), pctLastYear: percentChange(current, lastYear) };
  };
  const rows = [...map.values()].map(finish).sort((a, b) => (b.current - a.current) || (b.lastYear - a.lastYear) || String(a.key).localeCompare(String(b.key)));
  const total = finish({ key: '__total__', dimension, current: totals.current, previous: totals.previous, lastYear: totals.lastYear, currentQty: totals.currentQty });
  return { rows, total: { ...total, documents: roundMoneyValue(totals.documents), history: roundMoneyValue(totals.history) } };
}
const NOT_A_MOVER = new Set([UNKNOWN_PRODUCT_KEY, ADJUSTMENT_PRODUCT_KEY, UNKNOWN_CUSTOMER_KEY, '']);
// The 5 biggest increases and decreases in baht against `basis` ('lastYear' | 'previous'). Ties: by key.
export function topMovers(rows, basis = 'lastYear', count = 5) {
  const field = basis === 'previous' ? 'changePrevious' : 'changeLastYear';
  const candidates = (Array.isArray(rows) ? rows : []).filter(row => !NOT_A_MOVER.has(row.key) && Math.abs(row[field]) >= 0.005);
  const byKey = (a, b) => String(a.key).localeCompare(String(b.key));
  const growers = candidates.filter(row => row[field] > 0).sort((a, b) => (b[field] - a[field]) || byKey(a, b)).slice(0, count);
  const decliners = candidates.filter(row => row[field] < 0).sort((a, b) => (a[field] - b[field]) || byKey(a, b)).slice(0, count);
  return { basis, field, growers, decliners };
}

// ---------------------------------------------------------------- 3. ABC
// items: [{ key, value, stocked: bool, onHand: number }]. Positive sales are ranked (value desc, then key asc).
// Class by where an item STARTS on the cumulative curve: before 80 % → A, before 95 % → B, else C (so the item
// that crosses 80 % is still A). Equal values always get the same class (the class of the first of them).
// Value ≤ 0: "none" (ไม่มีการขาย) when the item is stocked and has stock on hand, else C. Integer satang
// arithmetic, so the 80 / 95 boundaries are exact.
export const ABC_THRESHOLDS = Object.freeze({ A: 80, B: 95 });
export function abcClassify(items) {
  const list = (Array.isArray(items) ? items : []).map(item => ({ ...item, cents: Math.round(analyticsNum(item.value) * 100) }));
  const ranked = list.filter(item => item.cents > 0).sort((a, b) => (b.cents - a.cents) || String(a.key).localeCompare(String(b.key)));
  const total = ranked.reduce((sum, item) => sum + item.cents, 0);
  const out = [];
  let before = 0;
  let tieClass = null;
  let tieCents = null;
  ranked.forEach((item, index) => {
    let cls;
    if (tieCents === item.cents) cls = tieClass;
    else if (before * 100 < total * ABC_THRESHOLDS.A) cls = 'A';
    else if (before * 100 < total * ABC_THRESHOLDS.B) cls = 'B';
    else cls = 'C';
    tieCents = item.cents;
    tieClass = cls;
    before += item.cents;
    out.push({ ...item, rank: index + 1, abc: cls, share: (item.cents / total) * 100, cumulative: (before / total) * 100 });
  });
  for (const item of list.filter(row => row.cents <= 0).sort((a, b) => String(a.key).localeCompare(String(b.key)))) {
    out.push({ ...item, rank: null, abc: item.stocked && analyticsNum(item.onHand) > 0 ? 'none' : 'C', share: 0, cumulative: null });
  }
  const summary = {};
  for (const cls of ['A', 'B', 'C', 'none']) {
    const members = out.filter(item => item.abc === cls);
    const cents = members.reduce((sum, item) => sum + Math.max(0, item.cents), 0);
    summary[cls] = { count: members.length, value: cents / 100, share: total ? (cents / total) * 100 : 0 };
  }
  return { items: out.map(({ cents, ...item }) => ({ ...item, value: cents / 100 })), total: total / 100, summary };
}

// ---------------------------------------------------------------- 4. reorder point
// z for a one-sided service level (standard normal table, rounded as the brief states: 95 % → 1.65).
export const SERVICE_LEVEL_Z = Object.freeze({ 90: 1.28, 95: 1.65, 99: 2.33 });
export const DEFAULT_SERVICE_LEVEL = 95;
export const DEFAULT_LEAD_TIME_DAYS = 7;
export const DEFAULT_REVIEW_DAYS = 30;
export const REVIEW_PERIOD_OPTIONS = Object.freeze([7, 14, 30, 60]);
export const MAX_LEAD_TIME_DAYS = 365;
// The product's lead time (days) — a new optional Product Master field; missing or invalid → 7 (isDefault).
export function productLeadTime(product = {}) {
  const raw = product?.leadTimeDays;
  const days = Number(raw);
  if (raw === undefined || raw === null || raw === '' || !Number.isFinite(days) || days <= 0 || days > MAX_LEAD_TIME_DAYS) return { days: DEFAULT_LEAD_TIME_DAYS, isDefault: true };
  return { days, isDefault: false };
}
export function isStockTracked(product = {}) {
  return product?.flowType === 'inventory' && product?.fulfillmentType === 'stock';
}
// input: { monthlyForecast (units, next month), monthlySigma (units, one-step residual RMS of the same model),
//          daysInMonth (of the forecast month), leadTimeDays, reviewDays, serviceLevel, onHand, openPo, today (ISO) }
// daily demand d = forecast ÷ days in month · σ_daily = σ_month ÷ √days (independent days) ·
// safety stock = z × σ_daily × √lead time · reorder point = d × lead time + safety stock ·
// days of cover = on hand ÷ d · suggested = max(0, d × (lead time + review) + safety stock − on hand − open PO),
// rounded up to whole units · order by = today + ⌊(on hand + open PO − reorder point) ÷ d⌋ days (today when ≤ 0).
export function reorderPlan(input = {}) {
  const z = SERVICE_LEVEL_Z[input.serviceLevel] ?? SERVICE_LEVEL_Z[DEFAULT_SERVICE_LEVEL];
  const leadTime = Number(input.leadTimeDays) > 0 ? Number(input.leadTimeDays) : DEFAULT_LEAD_TIME_DAYS;
  const review = Number(input.reviewDays) > 0 ? Number(input.reviewDays) : DEFAULT_REVIEW_DAYS;
  const onHand = analyticsNum(input.onHand);
  const openPo = Math.max(0, analyticsNum(input.openPo));
  const base = { serviceLevel: SERVICE_LEVEL_Z[input.serviceLevel] ? Number(input.serviceLevel) : DEFAULT_SERVICE_LEVEL, z, leadTimeDays: leadTime, reviewDays: review, onHand, openPo, position: onHand + openPo };
  const empty = { dailyDemand: null, sigmaDaily: null, safetyStock: null, leadTimeDemand: null, reorderPoint: null, orderUpTo: null, daysOfCover: null, suggestedQty: null, stockoutDate: '', orderByDate: '', orderNow: false };
  if (onHand < 0) return { ...base, ...empty, status: 'negative-stock', alert: true, severity: 'critical' };
  const forecast = input.monthlyForecast;
  if (forecast === null || forecast === undefined || !Number.isFinite(Number(forecast))) return { ...base, ...empty, status: 'no-forecast', alert: false, severity: 'none' };
  const days = Number(input.daysInMonth);
  if (!(days >= 28 && days <= 31)) return { ...base, ...empty, status: 'no-forecast', alert: false, severity: 'none' };
  if (!(Number(forecast) > 0)) return { ...base, ...empty, status: 'no-demand', alert: false, severity: 'none' };
  const dailyDemand = Number(forecast) / days;
  const sigma = Number(input.monthlySigma);
  const sigmaKnown = input.monthlySigma !== null && input.monthlySigma !== undefined && Number.isFinite(sigma) && sigma >= 0;
  const sigmaDaily = sigmaKnown ? sigma / Math.sqrt(days) : 0;
  const safetyStock = z * sigmaDaily * Math.sqrt(leadTime);
  const leadTimeDemand = dailyDemand * leadTime;
  const reorderPoint = leadTimeDemand + safetyStock;
  const orderUpTo = dailyDemand * (leadTime + review) + safetyStock;
  const suggestedRaw = Math.max(0, orderUpTo - onHand - openPo);
  const suggestedQty = Math.max(0, Math.ceil(suggestedRaw - 1e-9));
  const daysOfCover = onHand / dailyDemand;
  const orderNow = base.position <= reorderPoint + 1e-9;
  const daysUntilOrder = orderNow ? 0 : Math.floor((base.position - reorderPoint) / dailyDemand);
  const today = parseIsoDate(input.today) ? input.today : '';
  return {
    ...base,
    status: 'ok',
    sigmaKnown,
    dailyDemand,
    sigmaDaily,
    safetyStock,
    leadTimeDemand,
    reorderPoint,
    orderUpTo,
    daysOfCover,
    suggestedQty,
    stockoutDate: today ? addDaysIso(today, Math.floor(daysOfCover)) : '',
    orderByDate: today ? addDaysIso(today, daysUntilOrder) : '',
    daysUntilOrder,
    orderNow,
    alert: suggestedQty > 0,
    severity: suggestedQty > 0 ? (orderNow || daysOfCover <= leadTime ? 'high' : 'medium') : 'none'
  };
}
