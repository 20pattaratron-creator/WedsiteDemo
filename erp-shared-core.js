// ============================================================================
// erp-shared-core.js — deterministic shared primitives for ERP runtime
// DEMO 4.2.0
// ============================================================================

export const SHARED_CORE_VERSION = '1.0.0';
export const DEFAULT_VAT_RATE = 0.07;
export const DEFAULT_VAT_DIVISOR = 1 + DEFAULT_VAT_RATE;
const DAY_MS = 86400000;

export function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function roundMoneyValue(value) {
  return Math.round((safeNumber(value) + Number.EPSILON) * 100) / 100;
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
