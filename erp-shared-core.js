// ============================================================================
// erp-shared-core.js — deterministic shared primitives for ERP runtime
// DEMO 4.3.1
// ============================================================================

export const SHARED_CORE_VERSION = '1.5.0';
export const DEFAULT_VAT_RATE = 0.07;
export const DEFAULT_VAT_DIVISOR = 1 + DEFAULT_VAT_RATE;
// Reconciliation tolerance shared by invoice/receipt/billing matching:
// small rounding drift (a satang or two) between independently-rounded
// documents should be treated as settled, not flagged as an exception.
export const RECONCILE_TOLERANCE = 0.01;
const DAY_MS = 86400000;

// ---------------------------------------------------------------------------
// Pure document presentation primitives
// Centralized in Step 3B-1 so quotation / delivery-tax / receipt controllers
// do not carry independent copies of deterministic formatting behavior.
// These helpers are intentionally DOM/storage-free.
// ---------------------------------------------------------------------------
export function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[ch]));
}

// <option> list for an item-row unit <select>. A saved unit that is not in the
// fixed list (e.g. "คัน" from an import) is added as its own selected option,
// so restoring a document never silently shows the first unit instead.
export function unitOptionsHtml(units = [], value = '') {
  const unit = String(value ?? '').trim();
  const list = unit && !units.includes(unit) ? [...units, unit] : units;
  return list.map(u => `<option${u === unit ? ' selected' : ''}>${escapeHtml(u)}</option>`).join('');
}

export function parseMoney(value) {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function fmt(value) {
  return Number(value || 0).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function formatDate(value) {
  if (!value) return '';
  const [y, m, d] = String(value).split('-');
  return y && m && d ? `${d}-${m}-${Number(y) + 543}` : value;
}

export function thaiIntegerText(num) {
  const digits = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const positions = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
  const n = Math.floor(Math.abs(Number(num) || 0));
  if (n === 0) return 'ศูนย์';
  if (n >= 1000000) {
    const high = Math.floor(n / 1000000);
    const low = n % 1000000;
    return `${thaiIntegerText(high)}ล้าน${low ? thaiIntegerText(low) : ''}`;
  }
  const text = String(n).padStart(6, '0');
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    const digit = Number(text[i]);
    if (!digit) continue;
    const pos = 5 - i;
    if (pos === 1 && digit === 1) out += '';
    else if (pos === 1 && digit === 2) out += 'ยี่';
    else if (pos === 0 && digit === 1 && n > 10) out += 'เอ็ด';
    else out += digits[digit];
    out += positions[pos];
  }
  return out;
}

export function bahtText(value) {
  const amount = Math.round((Number(value) || 0) * 100) / 100;
  const baht = Math.floor(amount);
  const satang = Math.round((amount - baht) * 100);
  const bahtPart = `${thaiIntegerText(baht)}บาท`;
  return satang ? `${bahtPart}${thaiIntegerText(satang)}สตางค์` : `${bahtPart}ถ้วน`;
}

export function safeFilename(value) {
  return String(value).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 120);
}

// Generic object + storage-period primitives extracted in Step 3B-2.
// Keep these helpers deterministic and free of DOM/storage side effects.
export function getNestedValue(obj, path) {
  return path.split('.').reduce((cur, key) => cur?.[key], obj) ?? '';
}

export function setNestedValue(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  keys.slice(0, -1).forEach(key => {
    if (!cur[key] || typeof cur[key] !== 'object') cur[key] = {};
    cur = cur[key];
  });
  cur[keys[keys.length - 1]] = value;
}


// Context-free document row primitives extracted in Step 3B-3 after
// behavior-equivalence checks across delivery-tax and receipt controllers.
// Keep these independent from controller state, DOM, pagination budgets and storage.
export function createDocumentLineItem() {
  return {
    productCode: '',
    product: '',
    unit: 'ชิ้น',
    qty: 1,
    priceUnit: 0
  };
}

export function estimateDocumentItemRowUnits(item, wrapAt = 42, maxUnits = 4) {
  const text = `${item?.productCode || ''} ${item?.product || ''}`.trim();
  const explicitLines = String(text || '').split(/\r?\n/);
  const width = Math.max(1, Number(wrapAt) || 42);
  const cap = Math.max(1, Number(maxUnits) || 4);
  const wrappedLines = explicitLines.reduce((total, line) => total + Math.max(1, Math.ceil(String(line).length / width)), 0);
  return Math.max(1, Math.min(cap, wrappedLines));
}

// Pure document page-partition primitives extracted in Step 3B-6 after
// Step 3B-5 locked the existing Delivery/Tax + Receipt behavior in tests.
// They accept all runtime inputs explicitly and do not read controller state.
export function selectPrintableDocumentItems(items = []) {
  const rows = (Array.isArray(items) ? items : []).filter(
    item => item?.product || item?.productCode || parseMoney(item?.priceUnit) || parseMoney(item?.qty)
  );
  return rows.length ? rows : [createDocumentLineItem()];
}

export function paginateDocumentItems(items = [], options = {}) {
  const rowsToPaginate = Array.isArray(items) ? items : [];
  const unitsPerPage = Math.max(1, Number(options?.unitsPerPage) || 8);
  const rowUnits = typeof options?.rowUnits === 'function' ? options.rowUnits : estimateDocumentItemRowUnits;
  const createEmptyItem = typeof options?.createEmptyItem === 'function' ? options.createEmptyItem : createDocumentLineItem;
  const pages = [];
  let rows = [];
  let usedUnits = 0;
  rowsToPaginate.forEach(item => {
    const units = rowUnits(item);
    if (rows.length && usedUnits + units > unitsPerPage) {
      pages.push({ rows, usedUnits });
      rows = [];
      usedUnits = 0;
    }
    rows.push({ item, units });
    usedUnits += units;
  });
  if (rows.length || !pages.length) {
    pages.push({
      rows: rows.length ? rows : [{ item: createEmptyItem(), units: 1 }],
      usedUnits: usedUnits || 1
    });
  }
  return pages;
}

export function resolveStoragePeriod(dateValue, fallbackDate = new Date()) {
  const match = String(dateValue || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    if (Number.isFinite(year) && month >= 0 && month <= 11) return { year, month };
  }
  const now = fallbackDate instanceof Date ? fallbackDate : new Date(fallbackDate);
  if (!Number.isNaN(now.getTime())) return { year: now.getFullYear(), month: now.getMonth() };
  const safeNow = new Date();
  return { year: safeNow.getFullYear(), month: safeNow.getMonth() };
}


export function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Thai Revenue Department Order Por.86/2542: round money to 2 decimals by
// looking at the digit after the 2nd decimal place (the 3rd decimal digit) —
// below 5 rounds down, 5 or more rounds up ("round half up" to the nearest
// satang). Binary floating point cannot represent most decimal fractions
// exactly (e.g. 2.135 is actually stored as ~2.1349999999999998), so a naive
// Math.round(value*100)/100 silently rounds several exact half-satang values
// the wrong way. We first snap the cents value to 8 decimal places — far
// beyond any real monetary precision — to erase that representation noise,
// then apply the half-up rule.
export function roundMoneyValue(value) {
  const cents = safeNumber(value) * 100;
  const correctedCents = Math.round(cents * 1e8) / 1e8;
  return Math.round(correctedCents) / 100;
}

export function calculateVatSummary(rawSaleTotal, useVat) {
  const itemTotal = roundMoneyValue(rawSaleTotal);
  if (Number(useVat) === 2 || useVat === 'none') {
    return { itemTotal, subtotal: itemTotal, vatAmt: 0, total: itemTotal, vatMode: 'none' };
  }
  if (Number(useVat) === 1 || useVat === 'add') {
    const subtotal = itemTotal;
    const vatAmt = roundMoneyValue(subtotal * DEFAULT_VAT_RATE);
    return { itemTotal, subtotal, vatAmt, total: roundMoneyValue(subtotal + vatAmt), vatMode: 'add' };
  }
  const subtotal = roundMoneyValue(itemTotal / DEFAULT_VAT_DIVISOR);
  const vatAmt = roundMoneyValue(itemTotal - subtotal);
  return { itemTotal, subtotal, vatAmt, total: roundMoneyValue(subtotal + vatAmt), vatMode: 'extract' };
}

// ---------------------------------------------------------------------------
// Withholding tax (ภาษีหัก ณ ที่จ่าย) primitives.
// Thai customers commonly withhold tax when paying a services invoice and
// remit that amount to the Revenue Department on the seller's behalf,
// handing the seller a หนังสือรับรองการหักภาษี ณ ที่จ่าย (WHT certificate) as
// evidence. The withheld amount is a prepaid-tax-credit asset for the
// seller, not a discount and not lost revenue: cash received + WHT withheld
// must equal the invoice/receipt total for the document to be "fully paid".
// ---------------------------------------------------------------------------
export const WHT_RATE_PRESETS = Object.freeze([
  { value: 0, label: 'ไม่มีการหัก ณ ที่จ่าย' },
  { value: 1, label: '1% — ค่าขนส่ง' },
  { value: 2, label: '2% — ค่าโฆษณา' },
  { value: 3, label: '3% — ค่าบริการ/ค่าจ้างทำของ/วิชาชีพอิสระ' },
  { value: 5, label: '5% — ค่าเช่า' },
  { value: 10, label: '10% — เงินปันผล' }
]);

// WHT is calculated on the pre-VAT (service/goods) base amount, never on the
// VAT itself. `grandTotal` (subtotal + VAT, i.e. the invoice amount actually
// being settled) defaults to `baseAmount` when the document carries no VAT.
export function calculateWhtSummary(baseAmount, whtRate, grandTotal) {
  const base = roundMoneyValue(baseAmount);
  const rate = Math.max(0, safeNumber(whtRate));
  const total = roundMoneyValue(grandTotal ?? base);
  const whtAmount = rate > 0 ? roundMoneyValue(base * rate / 100) : 0;
  const cashReceived = roundMoneyValue(Math.max(0, total - whtAmount));
  return {
    whtRate: rate,
    whtBase: base,
    whtAmount,
    cashReceived,
    total,
    settledTotal: roundMoneyValue(cashReceived + whtAmount)
  };
}

// Context-free document totals boundary extracted in Step 3B-4.
// Accepts item rows plus VAT flags explicitly so controllers do not own
// duplicate arithmetic wrappers around calculateVatSummary().
export function calculateDocumentTotals(items = [], vatOptions = {}) {
  const rows = Array.isArray(items) ? items : [];
  const itemTotal = roundMoneyValue(rows.reduce(
    (sum, item) => sum + parseMoney(item?.qty) * parseMoney(item?.priceUnit),
    0
  ));
  const useVat = vatOptions?.vatNone ? 2 : (vatOptions?.vatEnabled ? 1 : 0);
  const summary = calculateVatSummary(itemTotal, useVat);
  return {
    itemTotal: summary.itemTotal,
    subtotal: summary.subtotal,
    vat: summary.vatAmt,
    grand: summary.total
  };
}

// ---------------------------------------------------------------------------
// Tax invoice form (รูปแบบใบกำกับภาษี).
// 'full'        = ใบกำกับภาษีเต็มรูป, Revenue Code §86/4 (default; also every
//                 legacy record that has no taxInvoiceForm field).
// 'abbreviated' = ใบกำกับภาษีอย่างย่อ, §86/6 — only VAT-registered retail
//                 businesses. Buyer name/address/tax ID are NOT required, and
//                 the document must state that the price includes VAT, so the
//                 invoice is always priced VAT-inclusive (useVat 0 / 'extract').
// ---------------------------------------------------------------------------
export const TAX_INVOICE_FORM_FULL = 'full';
export const TAX_INVOICE_FORM_ABBREVIATED = 'abbreviated';
export const ABBREVIATED_TAX_INVOICE_USE_VAT = 0;
// Customer name stored on an abbreviated invoice issued without a buyer name,
// so receipt/billing/analytics paths that key on `customer` keep working.
export const GENERAL_CUSTOMER_NAME = 'ลูกค้าทั่วไป / เงินสด';

export function normalizeTaxInvoiceForm(value) {
  return value === TAX_INVOICE_FORM_ABBREVIATED ? TAX_INVOICE_FORM_ABBREVIATED : TAX_INVOICE_FORM_FULL;
}

export function isAbbreviatedTaxInvoice(record) {
  return normalizeTaxInvoiceForm(record?.taxInvoiceForm) === TAX_INVOICE_FORM_ABBREVIATED;
}

// VAT mode a stored invoice was actually priced in ('add' | 'extract' | 'none').
// Same rule as the finance core: vatMode wins, else useVat (1 add, 2 none, else extract).
export function invoiceVatModeOf(record) {
  if (['add', 'extract', 'none'].includes(record?.vatMode)) return record.vatMode;
  const useVat = Number(record?.useVat);
  return useVat === 1 ? 'add' : useVat === 2 ? 'none' : 'extract';
}

// The form an invoice can really be printed/edited as. The save planner only
// lets an abbreviated invoice be VAT-inclusive, but a record that bypassed it
// (old JSON import / restore) may say 'abbreviated' with VAT added or no VAT.
// Its stored amounts are what the books hold, so it is treated as full-form
// rather than silently re-read as VAT-inclusive.
export function effectiveTaxInvoiceForm(record) {
  if (!isAbbreviatedTaxInvoice(record)) return TAX_INVOICE_FORM_FULL;
  return invoiceVatModeOf(record) === 'extract' ? TAX_INVOICE_FORM_ABBREVIATED : TAX_INVOICE_FORM_FULL;
}

export function isGeneralCustomerName(name) {
  const text = String(name ?? '').replace(/\s+/g, ' ').trim();
  return !text || text === GENERAL_CUSTOMER_NAME;
}

// Customer name to store for an invoice: a typed name always wins; an
// abbreviated invoice without a buyer falls back to GENERAL_CUSTOMER_NAME;
// a full-form invoice without a name stays '' (validation rejects it).
export function invoiceCustomerName(taxInvoiceForm, typedName) {
  const text = String(typedName ?? '').trim();
  if (text) return text;
  return normalizeTaxInvoiceForm(taxInvoiceForm) === TAX_INVOICE_FORM_ABBREVIATED ? GENERAL_CUSTOMER_NAME : '';
}

// §86/10: a credit note must name the buyer. An abbreviated invoice issued to
// a walk-in customer has no buyer name, so the credit note must collect one.
export function taxInvoiceLacksBuyer(invoice) {
  return isAbbreviatedTaxInvoice(invoice) && isGeneralCustomerName(invoice?.customer);
}

// Converts a pre-VAT (ก่อน VAT) master price into the unit-price basis a
// quote/invoice row uses for the form's VAT mode: VAT-inclusive rows (useVat 0)
// get the price + 7% rounded to satang; 'add' (1) and 'none' (2) rows take the
// pre-VAT price as-is. Returns NaN for a missing/invalid/negative price.
// Gross (VAT-included) amount one unit of price stands for in a VAT mode:
// 'add' prices get 7% on top, 'extract' prices already include it, 'none'
// prices carry no VAT. Used to convert typed prices when the VAT mode changes
// so that the document total stays the same.
export function vatModeGrossFactor(useVat) {
  const mode = Number(useVat);
  return mode === 1 || useVat === 'add' ? DEFAULT_VAT_DIVISOR : 1;
}

// Re-expresses a unit price typed for one VAT mode in another mode so the
// gross amount is unchanged (e.g. 1000 "บวก VAT" → 1070 "ราคารวม VAT แล้ว"),
// rounded half-up to satang. Returns NaN for a missing/invalid price.
export function convertUnitPriceBetweenVatModes(price, fromUseVat, toUseVat) {
  if (price === null || price === undefined || String(price).trim() === '') return NaN;
  const value = Number(String(price).replace(/,/g, ''));
  if (!Number.isFinite(value) || value < 0) return NaN;
  return roundMoneyValue(value * vatModeGrossFactor(fromUseVat) / vatModeGrossFactor(toUseVat));
}

export function unitPriceForVatMode(preVatPrice, useVat) {
  if (preVatPrice === null || preVatPrice === undefined || preVatPrice === '') return NaN;
  const price = Number(preVatPrice);
  if (!Number.isFinite(price) || price < 0) return NaN;
  const mode = Number(useVat);
  if (mode === 1 || mode === 2 || useVat === 'add' || useVat === 'none') return roundMoneyValue(price);
  return roundMoneyValue(price * DEFAULT_VAT_DIVISOR);
}

export function localDateISO(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseBusinessDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return { year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate() };
  }
  const text = String(value ?? '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.slice(0, 10));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const check = new Date(year, month - 1, day);
  if (check.getFullYear() !== year || check.getMonth() !== month - 1 || check.getDate() !== day) return null;
  return { year, month, day };
}

export function businessDateOrdinal(value) {
  const p = parseBusinessDate(value);
  return p ? Math.floor(Date.UTC(p.year, p.month - 1, p.day) / DAY_MS) : NaN;
}

export function compareBusinessDates(a, b) {
  const aa = businessDateOrdinal(a);
  const bb = businessDateOrdinal(b);
  if (!Number.isFinite(aa) || !Number.isFinite(bb)) return NaN;
  return aa === bb ? 0 : aa < bb ? -1 : 1;
}

export function isBusinessDateBefore(value, reference = localDateISO()) {
  return compareBusinessDates(value, reference) < 0;
}

export function isBusinessDateAfter(value, reference = localDateISO()) {
  return compareBusinessDates(value, reference) > 0;
}

export function businessDaysBetween(a, b) {
  const aa = businessDateOrdinal(a);
  const bb = businessDateOrdinal(b);
  return Number.isFinite(aa) && Number.isFinite(bb) ? bb - aa : NaN;
}

export function addBusinessCalendarDays(value, days) {
  const p = parseBusinessDate(value);
  if (!p) return '';
  const d = new Date(p.year, p.month - 1, p.day);
  d.setDate(d.getDate() + Math.trunc(safeNumber(days)));
  return localDateISO(d);
}

export function cloneData(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(cloneData);
  const out = {};
  for (const [key, item] of Object.entries(value)) out[key] = cloneData(item);
  return out;
}

// ---------------------------------------------------------------------------
// Has a quotation moved on? One rule — quoteMovedOnMatcher — for the quote list's row actions
// (app.js), the work queues (erp-order-flow.js, erp-product-experience-core.js) and the Decision
// Council; they used to keep four slightly different copies.
// A quotation has moved on when the app stamped it with an invoice / production order
// (quoteLinkedDownstream) OR a LIVE Sales Order was created from it. A Sales Order points
// back with sourceQuoteId (authoritative) and sourceQuoteNo; the number decides only when one
// side has no id (legacy rows). Both are scoped by branch: the order's sourceQuoteBranch
// (else its branch) must equal the quote's branch when both are known — two branches can
// use the same quote number. Cancelled / void / deleted orders do not count.
// ---------------------------------------------------------------------------
const quoteRefText = value => (value === undefined || value === null ? '' : String(value).trim());
export function isLiveSalesOrder(order) {
  if (!order || typeof order !== 'object' || order.voided || order.deleted || order.cancelled) return false;
  return !['cancelled', 'void', 'reversed'].includes(String(order.status ?? '').trim().toLowerCase());
}
export function quoteLinkedDownstream(quote = {}) {
  return !!(quote && (quote.invoiceId || quote.invoiceNo || quote.productionId || quote.productionNo));
}
// orders → (quote) => true when a live Sales Order was created from that quote. Build it once
// per render and call it per quote.
export function quoteSalesOrderMatcher(orders = []) {
  const byId = new Map(), byNo = new Map();
  const remember = (map, key, ref) => { if (!map.has(key)) map.set(key, []); map.get(key).push(ref); };
  for (const order of Array.isArray(orders) ? orders : []) {
    if (!isLiveSalesOrder(order)) continue;
    const ref = { branch: quoteRefText(order.sourceQuoteBranch || order.branch), id: quoteRefText(order.sourceQuoteId) };
    const no = quoteRefText(order.sourceQuoteNo);
    if (ref.id) remember(byId, ref.id, ref);
    if (no) remember(byNo, no, ref);
  }
  return quote => {
    if (!quote || typeof quote !== 'object') return false;
    const branch = quoteRefText(quote._branch || quote.branch || quote.b);
    const id = quoteRefText(quote.id), no = quoteRefText(quote.no);
    const sameBranch = ref => !ref.branch || !branch || ref.branch === branch;
    if (id && (byId.get(id) || []).some(sameBranch)) return true;
    return !!no && (byNo.get(no) || []).some(ref => sameBranch(ref) && (!ref.id || !id));
  };
}
// orders → (quote) => true when the quote has moved on (downstream stamp or live Sales Order).
export function quoteMovedOnMatcher(orders = []) {
  const hasOrder = quoteSalesOrderMatcher(orders);
  return quote => quoteLinkedDownstream(quote) || hasOrder(quote);
}
