// ============================================================================
// erp-fx-core.js — multi-currency rules (ADR-031, round 13B) · ERP DEMO 4.3.1
// Pure: no DOM, no storage, no clock, no network (dates and "today" are passed in).
// ----------------------------------------------------------------------------
// Sources (audit report /home/claude/reports/ตรวจบัญชีและภาษีรอบ13.md §5, ADR-031):
// - A tax invoice is in baht; another currency needs the Director-General's approval (ป.86/2542 ข้อ 8, ประกาศฯ VAT
//   ฉบับที่ 92). With approval the invoice shows the rate used (ประกาศฯ ฉบับที่ 77 / 186).
// - ป.132/2548: VAT of a tax invoice converts at the commercial-bank BUYING rate or the BOT average BUYING rate of the
//   day the liability arises; the rate the BOT announces on a day reflects the previous business day; the method chosen
//   is used consistently. Exports of goods: actual baht when the currency is sold in the month, else the BOT average
//   buying rate of the month's last business day. Later exchange gains / losses are not a VAT base. Withholding tax:
//   the SELLING rate of the payment day. Period end: assets at the average buying rate, liabilities at the average
//   selling rate.
// - Payments abroad: withholding under s.70 (ภ.ง.ด.54, within 7 days after the month paid; rates from general knowledge —
//   "ต้องยืนยัน", a double-tax agreement may lower them) and VAT on imported services (ภ.พ.36, 7 %, claimable the next
//   month). When the payer bears the tax the income is grossed up (as WHT condition 2).
// Money: THB in satang (integers), foreign amounts in the currency's MINOR units (integers; JPY has none). Every
// conversion is exact (BigInt) and rounds half-up to the satang ONCE; the document stores the result, which is never
// recomputed (a corrected rate is a new version used only by new documents).
// Messages are keys of i18n/en-fx.js (Thai + English); FxError carries the key and the parameters for the screen.
// ============================================================================
import { taxHolidayName, taxHolidayYearStatus, taxPeriodOfDate, taxPeriodLastDay, taxPeriodFirstDay, addTaxPeriods, parseTaxPeriod, rollTaxDueDate, taxRolledHolidays, taxThaiDate, taxCsvText } from './erp-tax-reports-core.js';
import { calculateWht } from './erp-payer-wht-core.js';
import { parseBusinessDate, businessDateOrdinal, DEFAULT_VAT_RATE, thaiIntegerText, roundMoneyValue } from './erp-shared-core.js';
import { translateKey, ENGLISH_MONTHS_ABBR, englishIntegerText } from './erp-i18n-core.js';
import { FX_KEYS } from './i18n/en-fx.js';

export const FX_CORE_VERSION = '1.0.0';
export const FX_SCHEMA_VERSION = 1;
export const FUNCTIONAL_CURRENCY = 'THB';

// ---------------------------------------------------------------- currencies (ISO 4217 codes)
// minor = decimals of the currency. ISO 4217 lists LAK and MMK with 2 minor units, but neither has a coin in use; the
// owner's brief sets them (and VND, KRW, JPY) to 0, as amounts are written in whole units (ADR-031 "decisions").
// quotePer = the unit the Bank of Thailand quotes the rate for (JPY per 100 yen); a rate row stores its own `per`.
const currency = (code, minor, th, en, minorTh, quotePer = 1) => Object.freeze({ code, minor, th, en, minorTh, quotePer });
export const CURRENCIES = Object.freeze([
  currency('THB', 2, 'บาท', 'Thai baht', 'สตางค์'),
  currency('USD', 2, 'ดอลลาร์สหรัฐ', 'US dollar', 'เซนต์'),
  currency('EUR', 2, 'ยูโร', 'Euro', 'เซนต์'),
  currency('JPY', 0, 'เยน', 'Japanese yen', '', 100),
  currency('CNY', 2, 'หยวน', 'Chinese yuan', 'เฟิน'),
  currency('SGD', 2, 'ดอลลาร์สิงคโปร์', 'Singapore dollar', 'เซนต์'),
  currency('GBP', 2, 'ปอนด์สเตอร์ลิง', 'Pound sterling', 'เพนนี'),
  currency('MYR', 2, 'ริงกิต', 'Malaysian ringgit', 'เซน'),
  currency('LAK', 0, 'กีบ', 'Lao kip', ''),
  currency('MMK', 0, 'จั๊ต', 'Myanmar kyat', ''),
  currency('VND', 0, 'ด่ง', 'Vietnamese dong', ''),
  currency('KRW', 0, 'วอน', 'South Korean won', ''),
  currency('AUD', 2, 'ดอลลาร์ออสเตรเลีย', 'Australian dollar', 'เซนต์'),
  currency('HKD', 2, 'ดอลลาร์ฮ่องกง', 'Hong Kong dollar', 'เซนต์'),
  currency('CHF', 2, 'ฟรังก์สวิส', 'Swiss franc', 'ซองตีม')
]);
const CURRENCY_MAP = new Map(CURRENCIES.map(row => [row.code, row]));
export const FOREIGN_CURRENCY_CODES = Object.freeze(CURRENCIES.filter(row => row.code !== FUNCTIONAL_CURRENCY).map(row => row.code));
export function currencyInfo(code) {
  return CURRENCY_MAP.get(String(code ?? '').trim().toUpperCase()) || null;
}
// A document is a foreign-currency document when it names a known currency other than THB.
export function isFxDocument(record) {
  const code = String(record?.currency ?? '').trim().toUpperCase();
  return !!code && code !== FUNCTIONAL_CURRENCY && CURRENCY_MAP.has(code);
}

// ---------------------------------------------------------------- rate types (report §5 rule 2)
// bot_avg_buying / bot_avg_selling: the BOT weighted-average interbank rates; bank_buying: a commercial bank's buying
// rate; actual: the rate actually obtained (bank slip). Sales documents use the company's chosen type (buying);
// liabilities, withholding tax and ภ.พ.36 use the BOT average SELLING rate.
export const FX_RATE_TYPES = Object.freeze(['bot_avg_buying', 'bot_avg_selling', 'bank_buying', 'actual']);
export const BOT_RATE_TYPES = Object.freeze(['bot_avg_buying', 'bot_avg_selling']);
export const SALES_RATE_TYPES = Object.freeze(['bot_avg_buying', 'bank_buying']); // the company chooses ONE (rule 3)
export const RECEIPT_RATE_TYPES = Object.freeze(['bot_avg_buying', 'bank_buying', 'actual']);
export const LIABILITY_RATE_TYPE = 'bot_avg_selling';
export const FX_RATE_PERS = Object.freeze([1, 100, 1000]);
export const FX_RATE_SOURCES = Object.freeze(['manual', 'csv', 'demo', 'bot_api']);
// The future server adapter's source id is reserved; this demo never fetches (no network, no key, terms unconfirmed).
export const FX_REVALUATION_METHODS = Object.freeze(['reverse']);
// ภ.ง.ด.54 income types and their DEFAULT rates (s.70; general knowledge, to be confirmed — a DTA may lower them).
export const PND54_INCOME_TYPES = Object.freeze(['service', 'royalty', 'interest', 'dividend', 'other']);
export const PND54_DEFAULT_RATES = Object.freeze({ service: 15, royalty: 15, interest: 15, dividend: 10, other: 15 });
export const FX_PAYMENT_DUE_DAY = 7; // ภ.ง.ด.54 / ภ.พ.36: within 7 days after the month of payment
export const VAT_PERCENT = Math.round(DEFAULT_VAT_RATE * 100); // 7

// ---------------------------------------------------------------- messages
const fxStr = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const fxIsObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const fxHasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
export function fxDateText(iso, lang = 'th') {
  const parts = parseBusinessDate(fxStr(iso).slice(0, 10));
  if (!parts) return fxStr(iso);
  return lang === 'en' ? `${parts.day} ${ENGLISH_MONTHS_ABBR[parts.month - 1]} ${parts.year}` : taxThaiDate(iso);
}
// Parameters whose name ends in "Date" are ISO dates shown in the language's format; the rest are used as given.
export function fxText(key, params = {}, lang = 'th') {
  const shown = {};
  for (const [name, value] of Object.entries(params || {})) shown[name] = /Date$/.test(name) ? fxDateText(value, lang) : value;
  // A rate-type label travels in the message's language (the params carry the Thai label made where the error arose).
  if (shown.typeLabel !== undefined && FX_RATE_TYPES.includes(params.type)) shown.typeLabel = rateTypeLabel(params.type, lang);
  return translateKey(FX_KEYS, lang, key, shown);
}
export class FxError extends Error {
  constructor(key, params = {}) {
    super(fxText(key, params, 'th'));
    this.name = 'FxError';
    this.code = 'fx_error';
    this.key = key;
    this.params = { ...params };
  }
}
const fail = (key, params) => { throw new FxError(key, params); };
export function rateTypeLabel(type, lang = 'th') {
  return fxText(`rateType.${FX_RATE_TYPES.includes(type) ? type : 'actual'}`, {}, lang);
}

// ---------------------------------------------------------------- exact decimal arithmetic (BigInt)
const TEN = 10n;
const pow10 = n => TEN ** BigInt(n);
// Half-up division (away from zero on .5) of two BigInts, d > 0.
export function divRoundHalfUp(n, d) {
  if (d <= 0n) throw new RangeError('divRoundHalfUp: divisor must be positive');
  if (n < 0n) return -divRoundHalfUp(-n, d);
  return (2n * n + d) / (2n * d);
}
// A decimal text → { digits: BigInt (value × 10^scale), scale } with at most `maxScale` decimals; null when invalid.
// Accepts "1,234.5" (grouping commas), a leading minus only when `allowNegative`.
export function parseDecimal(value, maxScale, options = {}) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    value = value.toFixed(Math.min(20, Math.max(0, maxScale + 2))).replace(/0+$/, '').replace(/\.$/, '');
  }
  const raw = fxStr(value).replace(/,/g, '');
  const match = /^(-)?(\d{1,15})(?:\.(\d+))?$/.exec(raw);
  if (!match) return null;
  if (match[1] && !options.allowNegative) return null;
  const decimals = match[3] || '';
  if (decimals.length > maxScale) return null;
  const digits = BigInt(match[2] + decimals.padEnd(maxScale, '0'));
  return { digits: match[1] ? -digits : digits, scale: maxScale };
}
const toSafeNumber = big => {
  const value = Number(big);
  if (!Number.isSafeInteger(value)) throw new RangeError('fx: amount out of range');
  return value;
};

// ---------------------------------------------------------------- amounts in a currency
// Major amount (number or text) → minor units (integer). More decimals than the currency has → null (never rounded
// silently: "JPY has no decimals").
export function toMinorUnits(amount, code) {
  const info = currencyInfo(code);
  if (!info) return null;
  const parsed = parseDecimal(amount, info.minor);
  return parsed ? toSafeNumber(parsed.digits) : null;
}
export function minorToMajor(minor, code) {
  const info = currencyInfo(code);
  const decimals = info ? info.minor : 2;
  return Number((Number(minor) / 10 ** decimals).toFixed(decimals));
}
const GROUP = new Intl.NumberFormat('en-US');
// "1,234.50" (the currency's own decimals).
export function formatMinor(minor, code) {
  const info = currencyInfo(code);
  const decimals = info ? info.minor : 2;
  const negative = Number(minor) < 0;
  const abs = BigInt(Math.abs(Math.trunc(Number(minor))));
  const whole = abs / pow10(decimals);
  const frac = decimals ? `.${String(abs % pow10(decimals)).padStart(decimals, '0')}` : '';
  return `${negative ? '-' : ''}${GROUP.format(whole)}${frac}`;
}
// "USD 1,234.50"
export function formatFx(minor, code) {
  return `${String(code || '').toUpperCase()} ${formatMinor(minor, code)}`;
}
export const formatSatang = satang => formatMinor(satang, FUNCTIONAL_CURRENCY);
export const fxSatangToBaht = satang => Number((Number(satang) / 100).toFixed(2));
export function bahtToSatang(value) {
  const parsed = parseDecimal(value, 2, { allowNegative: true });
  if (parsed) return toSafeNumber(parsed.digits);
  // Stored baht numbers may carry float noise (e.g. 0.1 + 0.2): half-up to the satang through the 8-place snap.
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.round(n * 100 * 1e8) / 1e8);
}

// ---------------------------------------------------------------- rates
export const RATE_MAX_INTEGER_DIGITS = 6;
export const RATE_MAX_DECIMALS = 8;
// A rate text ("32.6543", THB per `per` units) → { digits, scale } or null; must be > 0.
export function parseRate(value) {
  const raw = fxStr(value).replace(/,/g, '');
  if (!/^\d{1,6}(?:\.\d{1,8})?$/.test(raw)) return null;
  const parsed = parseDecimal(raw, RATE_MAX_DECIMALS);
  return parsed && parsed.digits > 0n ? parsed : null;
}
// The canonical text of a rate: no grouping, no trailing zeros after the point ("32.6500" → "32.65").
export function normalizeRateText(value) {
  const parsed = parseRate(value);
  if (!parsed) return '';
  const whole = parsed.digits / pow10(parsed.scale);
  const frac = String(parsed.digits % pow10(parsed.scale)).padStart(parsed.scale, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}
// Foreign minor units → satang at `rate` THB per `per` units: satang = minor ÷ 10^minor × rate ÷ per × 100, half-up.
export function convertToSatang(minor, code, rate, per = 1) {
  const info = currencyInfo(code);
  if (!info) fail('currency.unknown', { currency: code });
  if (info.code === FUNCTIONAL_CURRENCY) return toSafeNumber(BigInt(Math.trunc(Number(minor))));
  const parsed = parseRate(rate);
  if (!parsed) fail('rate.invalid', { value: fxStr(rate) });
  if (!FX_RATE_PERS.includes(Number(per))) fail('rate.per', {});
  const amount = BigInt(Math.trunc(Number(minor)));
  const numerator = amount * parsed.digits * 100n;
  const denominator = pow10(info.minor) * pow10(parsed.scale) * BigInt(per);
  return toSafeNumber(divRoundHalfUp(numerator, denominator));
}
// Integer split by weights (BigInt-exact largest remainder, ties by position) — the parts add up to `total` exactly.
export function allocateExact(total, weights) {
  const count = weights.length;
  if (!count) return [];
  const big = weights.map(weight => BigInt(Math.trunc(Number(weight) || 0)));
  const sum = big.reduce((acc, weight) => acc + weight, 0n);
  const target = BigInt(Math.trunc(Number(total)));
  if (sum === 0n) { const out = new Array(count).fill(0); out[0] = toSafeNumber(target); return out; }
  const sign = target < 0n ? -1n : 1n;
  const abs = target * sign;
  const parts = big.map(weight => (abs * weight) / sum);
  const remainders = big.map((weight, index) => ({ index, rem: (abs * weight) % sum }));
  let rest = abs - parts.reduce((acc, value) => acc + value, 0n);
  remainders.sort((a, b) => (a.rem === b.rem ? a.index - b.index : (b.rem > a.rem ? 1 : -1)));
  for (let i = 0; rest > 0n; i = (i + 1) % count, rest -= 1n) parts[remainders[i].index] += 1n;
  return parts.map(part => toSafeNumber(part * sign));
}

// ---------------------------------------------------------------- business days (the round-13A holiday table)
const FX_DAY_MS = 86400000;
const isoFromOrdinal = ordinal => new Date(ordinal * FX_DAY_MS).toISOString().slice(0, 10);
export function isFxBusinessDay(date) {
  const ordinal = businessDateOrdinal(date);
  if (!Number.isFinite(ordinal)) return false;
  const weekday = new Date(ordinal * FX_DAY_MS).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !taxHolidayName(isoFromOrdinal(ordinal));
}
// The business day on or before `date` ('' for an invalid date).
export function fxBusinessDayOnOrBefore(date) {
  let ordinal = businessDateOrdinal(date);
  if (!Number.isFinite(ordinal)) return '';
  for (let guard = 0; guard < 40 && !isFxBusinessDay(isoFromOrdinal(ordinal)); guard += 1) ordinal -= 1;
  return isoFromOrdinal(ordinal);
}
// The business day strictly before `date`.
export function previousFxBusinessDay(date) {
  const ordinal = businessDateOrdinal(date);
  if (!Number.isFinite(ordinal)) return '';
  return fxBusinessDayOnOrBefore(isoFromOrdinal(ordinal - 1));
}
// The holidays / weekend days between the rate date and the document date, for the "why this date" note.
export function fxSkippedDays(rateDate, date) {
  const start = businessDateOrdinal(rateDate), end = businessDateOrdinal(date);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  const out = [];
  for (let ordinal = start + 1; ordinal <= end; ordinal += 1) {
    const iso = isoFromOrdinal(ordinal);
    const name = taxHolidayName(iso);
    if (name) out.push({ date: iso, name });
  }
  return out;
}
// Report rule 3 — which rate a document dated `date` uses:
//   BOT averages: the rate the BOT ANNOUNCES on the liability day; an announcement reflects the previous business day,
//     so the table row is dated the business day BEFORE the announcement day. On a weekend / holiday the announcement
//     of the previous business day is used. A Friday invoice uses Thursday's rate; a Saturday or holiday document the
//     same as the business day before it.
//   bank_buying / actual: the bank's (or the actual) rate of the day itself, a weekend / holiday rolled back.
// The same rule serves the month end (`date` = the last calendar day): the announcement of the month's last business day.
// → { rateDate, publishedOn, rolled (the document date was not a business day), holidayTable ('official' | 'provisional' | '') }
export function fxRateDateFor(date, type) {
  const day = fxStr(date).slice(0, 10);
  if (!parseBusinessDate(day)) return { rateDate: '', publishedOn: '', rolled: false, holidayTable: '' };
  const publishedOn = fxBusinessDayOnOrBefore(day);
  const rateDate = BOT_RATE_TYPES.includes(type) ? previousFxBusinessDay(publishedOn) : publishedOn;
  return { rateDate, publishedOn, rolled: publishedOn !== day, holidayTable: taxHolidayYearStatus(rateDate) && taxHolidayYearStatus(day) ? (taxHolidayYearStatus(rateDate) === 'official' && taxHolidayYearStatus(day) === 'official' ? 'official' : 'provisional') : '' };
}

// ---------------------------------------------------------------- settings (comform_fx_settings_v1)
// { schemaVersion: 1, functionalCurrency: 'THB' (fixed), allowedCurrencies: [code], rateType: 'bot_avg_buying' |
//   'bank_buying' (chosen once; a change after the first foreign-currency document needs the Revenue Department's
//   approval number), rateTypeHistory: [{ rateType, effectiveFrom, approvalRef, at, by }], taxInvoiceApproval: { no,
//   date } (อนุมัติให้ออกใบกำกับภาษีเป็นเงินตราต่างประเทศ), revaluationMethod: 'reverse' (fixed: auto-reversed on day 1),
//   pnd54Rates: { incomeType: percent }, updatedAt }
export function defaultFxSettings() {
  return { schemaVersion: FX_SCHEMA_VERSION, functionalCurrency: FUNCTIONAL_CURRENCY, allowedCurrencies: [], rateType: 'bot_avg_buying', rateTypeHistory: [], taxInvoiceApproval: { no: '', date: '' }, revaluationMethod: 'reverse', pnd54Rates: { ...PND54_DEFAULT_RATES }, updatedAt: '' };
}
const FX_SETTINGS_FIELDS = Object.freeze(['schemaVersion', 'functionalCurrency', 'allowedCurrencies', 'rateType', 'rateTypeHistory', 'taxInvoiceApproval', 'revaluationMethod', 'pnd54Rates', 'updatedAt']);
const fxCleanLine = (value, max = 200) => String(value ?? '').replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const isIso = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !!parseBusinessDate(value);
const isInstant = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
// Strict reader (fail-closed): anything malformed throws FxError('store.settings'); null / '' = never saved → defaults.
export function normalizeFxSettings(raw) {
  const bad = detail => fail('store.settings', { detail });
  if (raw === null || raw === undefined || raw === '') return defaultFxSettings();
  let value = raw;
  if (typeof raw === 'string') { try { value = JSON.parse(raw); } catch (error) { bad('JSON'); } }
  if (!fxIsObject(value)) bad('object');
  for (const key of Object.keys(value)) if (!FX_SETTINGS_FIELDS.includes(key)) bad(key);
  if (value.schemaVersion !== FX_SCHEMA_VERSION) bad('schemaVersion');
  if (value.functionalCurrency !== FUNCTIONAL_CURRENCY) bad('functionalCurrency');
  if (!Array.isArray(value.allowedCurrencies) || value.allowedCurrencies.length > FOREIGN_CURRENCY_CODES.length) bad('allowedCurrencies');
  const allowed = [];
  for (const code of value.allowedCurrencies) {
    if (!FOREIGN_CURRENCY_CODES.includes(code) || allowed.includes(code)) bad('allowedCurrencies');
    allowed.push(code);
  }
  if (!SALES_RATE_TYPES.includes(value.rateType)) bad('rateType');
  if (!Array.isArray(value.rateTypeHistory) || value.rateTypeHistory.length > 50) bad('rateTypeHistory');
  const history = value.rateTypeHistory.map(row => {
    if (!fxIsObject(row) || !SALES_RATE_TYPES.includes(row.rateType) || (row.effectiveFrom !== '' && !isIso(row.effectiveFrom)) || typeof row.approvalRef !== 'string' || typeof row.at !== 'string' || typeof row.by !== 'string') bad('rateTypeHistory');
    for (const key of Object.keys(row)) if (!['rateType', 'effectiveFrom', 'approvalRef', 'at', 'by'].includes(key)) bad('rateTypeHistory');
    return { rateType: row.rateType, effectiveFrom: row.effectiveFrom, approvalRef: fxCleanLine(row.approvalRef, 80), at: fxCleanLine(row.at, 40), by: fxCleanLine(row.by, 80) };
  });
  const approval = value.taxInvoiceApproval;
  if (!fxIsObject(approval) || typeof approval.no !== 'string' || typeof approval.date !== 'string' || (approval.date && !isIso(approval.date))) bad('taxInvoiceApproval');
  for (const key of Object.keys(approval)) if (!['no', 'date'].includes(key)) bad('taxInvoiceApproval');
  if (!FX_REVALUATION_METHODS.includes(value.revaluationMethod)) bad('revaluationMethod');
  if (!fxIsObject(value.pnd54Rates)) bad('pnd54Rates');
  const rates = {};
  for (const type of PND54_INCOME_TYPES) {
    const rate = value.pnd54Rates[type];
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 30 || Math.round(rate * 100) !== rate * 100) bad('pnd54Rates');
    rates[type] = rate;
  }
  for (const key of Object.keys(value.pnd54Rates)) if (!PND54_INCOME_TYPES.includes(key)) bad('pnd54Rates');
  if (typeof value.updatedAt !== 'string' || (value.updatedAt && !isInstant(value.updatedAt))) bad('updatedAt');
  return { schemaVersion: FX_SCHEMA_VERSION, functionalCurrency: FUNCTIONAL_CURRENCY, allowedCurrencies: allowed, rateType: value.rateType, rateTypeHistory: history, taxInvoiceApproval: { no: fxCleanLine(approval.no, 80), date: approval.date }, revaluationMethod: value.revaluationMethod, pnd54Rates: rates, updatedAt: value.updatedAt };
}
// A settings change: the rate type is chosen ONCE (rule 3) — after the first foreign-currency document it changes only
// with the Revenue Department's approval reference. → { ok, settings } | { ok: false, key, params }
export function planFxSettingsChange(current, patch = {}, context = {}) {
  const base = normalizeFxSettings(current);
  const next = { ...base, ...patch, schemaVersion: FX_SCHEMA_VERSION, functionalCurrency: FUNCTIONAL_CURRENCY, revaluationMethod: 'reverse' };
  if (patch.functionalCurrency !== undefined && patch.functionalCurrency !== FUNCTIONAL_CURRENCY) return { ok: false, key: 'settings.functional', params: {} };
  if (patch.taxInvoiceApproval) next.taxInvoiceApproval = { no: fxCleanLine(patch.taxInvoiceApproval.no, 80), date: fxStr(patch.taxInvoiceApproval.date) };
  if (next.taxInvoiceApproval.no && !isIso(next.taxInvoiceApproval.date)) return { ok: false, key: 'settings.approvalDate', params: {} };
  if (!next.taxInvoiceApproval.no) next.taxInvoiceApproval = { no: '', date: '' };
  if (patch.rateType !== undefined && patch.rateType !== base.rateType) {
    if (!SALES_RATE_TYPES.includes(patch.rateType)) return { ok: false, key: 'settings.rateType', params: {} };
    const approvalRef = fxCleanLine(context.approvalRef, 80);
    if (context.documentsExist && !approvalRef) return { ok: false, key: 'settings.rateTypeLocked', params: { current: base.rateType } };
    next.rateTypeHistory = [...base.rateTypeHistory, { rateType: patch.rateType, effectiveFrom: isIso(context.effectiveFrom) ? context.effectiveFrom : '', approvalRef, at: fxCleanLine(context.at, 40), by: fxCleanLine(context.by, 80) }];
  }
  try { return { ok: true, settings: normalizeFxSettings({ ...next, updatedAt: isInstant(context.at) ? context.at : '' }) }; }
  catch (error) { return { ok: false, key: error.key || 'store.settings', params: error.params || {} }; }
}

// ---------------------------------------------------------------- the rate table (comform_fx_rates_v1)
// { schemaVersion: 1, rates: [{ id, currency, date (the BOT / bank date of the rate), type, rate (text, THB per `per`),
//   per (1 | 100 | 1000), source ('manual' | 'csv' | 'demo' | 'bot_api'), sourceNote (evidence, e.g. "bot.or.th ตาราง
//   อัตราแลกเปลี่ยนเฉลี่ย 22/07/2569"), version (1, 2, …), supersedes ('' | id of the version it corrects), enteredAt,
//   enteredBy }] } — APPEND-ONLY: a row is never edited or deleted; a correction is a new version (the documents that used
//   the old version keep their stored rate and baht). The latest version of (currency, date, type) is the one looked up.
export const FX_RATE_ROW_FIELDS = Object.freeze(['id', 'currency', 'date', 'type', 'rate', 'per', 'source', 'sourceNote', 'version', 'supersedes', 'enteredAt', 'enteredBy', 'demoSeed', 'demoSeedBatch']);
export const FX_RATE_ID_RE = /^fxr-[A-Z]{3}-\d{4}-\d{2}-\d{2}-[a-z_]+-v\d{1,4}$/;
export const FX_SOURCE_NOTE_MIN = 5;
export const MAX_FX_RATES = 20000;
export function fxRateId(currencyCode, date, type, version) {
  return `fxr-${currencyCode}-${date}-${type}-v${version}`;
}
export function emptyFxRateStore() {
  return { schemaVersion: FX_SCHEMA_VERSION, rates: [] };
}
function normalizeRateRow(row, at) {
  const bad = field => fail('store.rates', { detail: `${at} ${field}` });
  if (!fxIsObject(row)) bad('row');
  for (const key of Object.keys(row)) if (!FX_RATE_ROW_FIELDS.includes(key)) bad(key);
  if (!FOREIGN_CURRENCY_CODES.includes(row.currency)) bad('currency');
  if (!isIso(row.date)) bad('date');
  if (!FX_RATE_TYPES.includes(row.type)) bad('type');
  if (typeof row.rate !== 'string' || normalizeRateText(row.rate) !== row.rate) bad('rate');
  if (!FX_RATE_PERS.includes(row.per)) bad('per');
  if (!FX_RATE_SOURCES.includes(row.source)) bad('source');
  if (typeof row.sourceNote !== 'string' || fxCleanLine(row.sourceNote, 300) !== row.sourceNote || row.sourceNote.length < FX_SOURCE_NOTE_MIN) bad('sourceNote');
  if (!Number.isInteger(row.version) || row.version < 1 || row.version > 9999) bad('version');
  if (row.id !== fxRateId(row.currency, row.date, row.type, row.version)) bad('id');
  if (typeof row.supersedes !== 'string' || (row.version === 1 ? row.supersedes !== '' : row.supersedes !== fxRateId(row.currency, row.date, row.type, row.version - 1))) bad('supersedes');
  if (!isInstant(row.enteredAt)) bad('enteredAt');
  if (typeof row.enteredBy !== 'string' || !row.enteredBy.trim() || row.enteredBy.length > 80) bad('enteredBy');
  if (fxHasOwn(row, 'demoSeed') && row.demoSeed !== true) bad('demoSeed');
  if (fxHasOwn(row, 'demoSeedBatch') && typeof row.demoSeedBatch !== 'string') bad('demoSeedBatch');
  return { ...row };
}
// Strict reader (fail-closed: a damaged table stops every foreign-currency action instead of guessing a rate).
export function normalizeFxRateStore(raw) {
  if (raw === null || raw === undefined || raw === '') return emptyFxRateStore();
  let value = raw;
  if (typeof raw === 'string') { try { value = JSON.parse(raw); } catch (error) { fail('store.rates', { detail: 'JSON' }); } }
  if (!fxIsObject(value) || value.schemaVersion !== FX_SCHEMA_VERSION || !Array.isArray(value.rates) || value.rates.length > MAX_FX_RATES) fail('store.rates', { detail: 'object' });
  for (const key of Object.keys(value)) if (!['schemaVersion', 'rates'].includes(key)) fail('store.rates', { detail: key });
  const ids = new Set();
  const rates = value.rates.map((row, index) => {
    const out = normalizeRateRow(row, `#${index + 1}`);
    if (ids.has(out.id)) fail('store.rates', { detail: `#${index + 1} id` });
    ids.add(out.id);
    return out;
  });
  // Every version > 1 corrects a version that exists (no gap in the chain).
  for (const row of rates) if (row.version > 1 && !ids.has(row.supersedes)) fail('store.rates', { detail: `${row.id} supersedes` });
  return { schemaVersion: FX_SCHEMA_VERSION, rates };
}
const tripleKey = (currencyCode, date, type) => `${currencyCode}|${date}|${type}`;
// The latest version of every (currency, date, type).
export function latestFxRates(store) {
  const map = new Map();
  for (const row of store?.rates || []) {
    const key = tripleKey(row.currency, row.date, row.type);
    const current = map.get(key);
    if (!current || row.version > current.version) map.set(key, row);
  }
  return map;
}
export function fxRateRow(store, currencyCode, date, type) {
  return latestFxRates(store).get(tripleKey(currencyCode, date, type)) || null;
}
// Plan one new rate (manual entry, CSV row, demo seed) or a correction (`correct: true`). today = the business date
// (a rate after today is refused). → { ok, row, store } | { ok: false, key, params }
export function planFxRateEntry(store, input = {}, context = {}) {
  const base = store && Array.isArray(store.rates) ? store : emptyFxRateStore();
  const code = fxStr(input.currency).toUpperCase();
  const type = fxStr(input.type);
  const date = fxStr(input.date).slice(0, 10);
  const no = key => ({ ok: false, key, params: { currency: code, type, date, value: fxStr(input.rate) } });
  if (!FOREIGN_CURRENCY_CODES.includes(code)) return no('currency.unknown');
  if (!isIso(date)) return no('rate.date');
  if (context.today && isIso(context.today) && date > context.today) return no('rate.future');
  if (!FX_RATE_TYPES.includes(type)) return no('rate.type');
  const rate = normalizeRateText(input.rate);
  if (!rate) return no('rate.invalid');
  const per = Number(input.per ?? currencyInfo(code).quotePer);
  if (!FX_RATE_PERS.includes(per)) return no('rate.per');
  const source = FX_RATE_SOURCES.includes(input.source) ? input.source : 'manual';
  if (source === 'bot_api') return no('rate.sourceApi'); // reserved for the future server adapter — never written here
  const sourceNote = fxCleanLine(input.sourceNote, 300);
  if (sourceNote.length < FX_SOURCE_NOTE_MIN) return no('rate.source');
  const enteredBy = fxCleanLine(context.by, 80);
  const enteredAt = fxStr(context.at);
  if (!enteredBy || !isInstant(enteredAt)) return no('rate.actor');
  const existing = fxRateRow(base, code, date, type);
  if (existing && !input.correct) return existing.rate === rate && existing.per === per ? { ok: false, key: 'rate.same', params: { currency: code, type, date, value: rate } } : no('rate.duplicate');
  if (!existing && input.correct) return no('rate.nothingToCorrect');
  if (existing && existing.rate === rate && existing.per === per) return { ok: false, key: 'rate.same', params: { currency: code, type, date, value: rate } };
  const version = existing ? existing.version + 1 : 1;
  const row = { id: fxRateId(code, date, type, version), currency: code, date, type, rate, per, source, sourceNote, version, supersedes: existing ? existing.id : '', enteredAt, enteredBy };
  if (input.demoSeed === true) Object.assign(row, { demoSeed: true, demoSeedBatch: fxStr(input.demoSeedBatch) || 'demo' });
  const next = { schemaVersion: FX_SCHEMA_VERSION, rates: [...base.rates, row] };
  if (next.rates.length > MAX_FX_RATES) return no('rate.tooMany');
  return { ok: true, row, store: next, corrected: existing || null };
}
// The rate a document uses (report rule 3). THB → rate 1. Missing → { ok: false } with the exact rate date to enter:
// the app NEVER falls back to another day's rate on its own ("no silent guessing").
export function lookupFxRate(store, { currency: code, date, type } = {}) {
  const info = currencyInfo(code);
  if (!info) return { ok: false, key: 'currency.unknown', params: { currency: fxStr(code) } };
  if (info.code === FUNCTIONAL_CURRENCY) return { ok: true, currency: FUNCTIONAL_CURRENCY, rate: '1', per: 1, type: 'actual', rateDate: fxStr(date).slice(0, 10), publishedOn: fxStr(date).slice(0, 10), id: '', version: 0, source: '', sourceNote: '' };
  if (!FX_RATE_TYPES.includes(type)) return { ok: false, key: 'rate.type', params: { type: fxStr(type) } };
  const rule = fxRateDateFor(date, type);
  if (!rule.rateDate) return { ok: false, key: 'rate.date', params: {} };
  const row = fxRateRow(store, info.code, rule.rateDate, type);
  const params = { currency: info.code, typeLabel: rateTypeLabel(type), type, rateDate: rule.rateDate, docDate: fxStr(date).slice(0, 10), publishedOnDate: rule.publishedOn };
  if (!row) return { ok: false, key: 'rate.missing', params, rule };
  return { ok: true, currency: info.code, rate: row.rate, per: row.per, type, rateDate: rule.rateDate, publishedOn: rule.publishedOn, rolled: rule.rolled, holidayTable: rule.holidayTable, skipped: fxSkippedDays(rule.rateDate, fxStr(date).slice(0, 10)), id: row.id, version: row.version, source: row.source, sourceNote: row.sourceNote };
}
// The stored rate fields of a document from a lookup.
export function fxRateFieldsOf(lookup) {
  return { fxRate: lookup.rate, fxPer: lookup.per, fxRateType: lookup.type, fxRateDate: lookup.rateDate, fxRateId: lookup.id, fxSource: `${lookup.source}: ${lookup.sourceNote}`.slice(0, 320) };
}

// ---------------------------------------------------------------- CSV import of rates
// Columns (Thai or English header): วันที่ | date (YYYY-MM-DD or DD/MM/YYYY พ.ศ./ค.ศ.), สกุลเงิน | currency, ประเภทอัตรา |
// type, อัตรา | rate, ต่อหน่วย | per, แหล่งที่มา | source. Every row is checked; nothing is written until the preview
// is confirmed. A row equal to the stored rate is skipped; a different value of a stored rate is a CORRECTION and is
// imported only when the user ticks "import as corrections" (otherwise the row is an error).
export const FX_CSV_HEADER_TH = Object.freeze(['วันที่', 'สกุลเงิน', 'ประเภทอัตรา', 'อัตรา', 'ต่อหน่วย', 'แหล่งที่มา']);
export const FX_CSV_HEADER_EN = Object.freeze(['date', 'currency', 'type', 'rate', 'per', 'source']);
export const FX_CSV_MAX_ROWS = 2000;
export const FX_CSV_PLAUSIBLE_CHANGE = 0.2; // ±20 % against the latest earlier rate of the same currency and type → a warning
export function fxCsvTemplate() {
  return taxCsvText([[...FX_CSV_HEADER_TH], ['2026-07-09', 'USD', 'bot_avg_buying', '32.4513', '1', 'bot.or.th อัตราถัวเฉลี่ยซื้อ 09/07/2569'], ['2026-07-09', 'JPY', 'bot_avg_selling', '21.2280', '100', 'bot.or.th อัตราถัวเฉลี่ยขาย 09/07/2569']]);
}
// A minimal RFC 4180 reader (quotes, "" escapes, CRLF), BOM stripped.
export function parseFxCsv(content) {
  const source = String(content ?? '').replace(/^﻿/, '');
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && source[i + 1] === '\n') i += 1; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(cells => cells.some(value => fxStr(value) !== ''));
}
export function parseFxCsvDate(value) {
  const raw = fxStr(value);
  if (isIso(raw)) return raw;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (!match) return '';
  let year = Number(match[3]);
  if (year > 2400) year -= 543;
  const iso = `${year}-${String(match[2]).padStart(2, '0')}-${String(match[1]).padStart(2, '0')}`;
  return isIso(iso) ? iso : '';
}
// → { rows: [{ line, ok, action: 'add' | 'correct' | 'skip', input, error: { key, params }, warning: { key, params } }],
//     counts: { add, correct, skip, error }, store (the table after the importable rows), errors }
export function planFxCsvImport(store, content, context = {}) {
  const table = parseFxCsv(content);
  const result = { rows: [], counts: { add: 0, correct: 0, skip: 0, error: 0 }, store: store && Array.isArray(store.rates) ? store : emptyFxRateStore(), headerError: null };
  if (!table.length) { result.headerError = { key: 'csv.empty', params: {} }; return result; }
  const header = table[0].map(cell => fxStr(cell).toLowerCase());
  const thai = FX_CSV_HEADER_TH.every((name, index) => header[index] === name.toLowerCase());
  const english = FX_CSV_HEADER_EN.every((name, index) => header[index] === name);
  if (!thai && !english) { result.headerError = { key: 'csv.header', params: { header: FX_CSV_HEADER_TH.join(', ') } }; return result; }
  if (table.length - 1 > FX_CSV_MAX_ROWS) { result.headerError = { key: 'csv.tooMany', params: { max: FX_CSV_MAX_ROWS } }; return result; }
  const seen = new Set();
  let working = result.store;
  table.slice(1).forEach((cells, index) => {
    const line = index + 2;
    const input = { date: parseFxCsvDate(cells[0]), rawDate: fxStr(cells[0]), currency: fxStr(cells[1]).toUpperCase(), type: fxStr(cells[2]), rate: fxStr(cells[3]), per: fxStr(cells[4]) === '' ? undefined : Number(fxStr(cells[4])), sourceNote: fxStr(cells[5]), source: 'csv', correct: false };
    const record = { line, ok: false, action: '', input, error: null, warning: null };
    result.rows.push(record);
    const triple = tripleKey(input.currency, input.date, input.type);
    if (!input.date) { record.error = { key: 'rate.date', params: { value: input.rawDate } }; result.counts.error += 1; return; }
    if (seen.has(triple)) { record.error = { key: 'csv.duplicateRow', params: { currency: input.currency, date: input.date, type: input.type } }; result.counts.error += 1; return; }
    seen.add(triple);
    const existing = fxRateRow(working, input.currency, input.date, input.type);
    if (existing && existing.rate === normalizeRateText(input.rate) && existing.per === Number(input.per ?? existing.per)) { record.ok = true; record.action = 'skip'; result.counts.skip += 1; return; }
    if (existing && !context.allowCorrections) { record.error = { key: 'csv.differs', params: { currency: input.currency, date: input.date, type: input.type, stored: existing.rate, value: normalizeRateText(input.rate) || input.rate } }; result.counts.error += 1; return; }
    const plan = planFxRateEntry(working, { ...input, correct: !!existing }, context);
    if (!plan.ok) { record.error = { key: plan.key, params: plan.params }; result.counts.error += 1; return; }
    working = plan.store;
    record.ok = true;
    record.action = existing ? 'correct' : 'add';
    result.counts[record.action] += 1;
    // Plausibility: against the latest earlier rate of the same currency and type (per 1 unit).
    const earlier = [...latestFxRates(working).values()].filter(row => row.currency === input.currency && row.type === input.type && row.date < input.date).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    if (earlier) {
      const now = Number(plan.row.rate) / plan.row.per, before = Number(earlier.rate) / earlier.per;
      if (before > 0 && Math.abs(now - before) / before > FX_CSV_PLAUSIBLE_CHANGE) record.warning = { key: 'csv.implausible', params: { currency: input.currency, date: input.date, value: plan.row.rate, previous: earlier.rate, previousDate: earlier.date } };
    }
  });
  result.store = working;
  return result;
}

// ---------------------------------------------------------------- the fetch adapter (future backend only)
// A server-side job would fetch the BOT Exchange Rates API (apiportal.bot.or.th) once a day after 18:00, store each
// value as an immutable row with source 'bot_api' and its date, and flag a failed day for manual entry. The terms of the
// API (registration, cost, the 29 currencies removed on 1 Apr 2568, one year of history) are NOT confirmed, and this
// static demo has no server and no key — so the only adapter here refuses, and nothing in this module touches the network.
// Contract of an adapter: { id, label, available: boolean, reason, fetchRates({ currency, type, from, to }) →
//   Promise<[{ currency, date, type, rate, per, sourceNote }]> } — the caller passes every row through planFxRateEntry.
export const FX_FETCH_ADAPTER_CONTRACT = Object.freeze(['id', 'label', 'available', 'reason', 'fetchRates']);
export function createUnavailableBotAdapter() {
  return Object.freeze({
    id: 'bot_api',
    label: 'Bank of Thailand Exchange Rates API',
    available: false,
    reason: fxText('adapter.unavailable'),
    fetchRates: () => Promise.reject(new FxError('adapter.unavailable', {}))
  });
}

// ---------------------------------------------------------------- foreign-currency SALES documents
// Line amounts: qty (≤ 3 decimals) × unit price in the currency (≤ 4 decimals) → the currency's minor units, half-up.
// Baht: the document's foreign SUBTOTAL converted once (half-up to the satang); the lines get their share by the largest
// remainder, so Σ lines = subtotal exactly. VAT on the baht subtotal (report rule: VAT is computed on THB): round(subtotal
// × 7 %), the same rule as calculateVatSummary 'add'. A VAT-inclusive ("extract") price is not offered in a currency.
// The foreign VAT (subtotal × 7 % in minor units) is information for the customer; the tax is the baht VAT.
export const FX_QTY_DECIMALS = 3;
export const FX_PRICE_DECIMALS = 4;
export function fxLineAmountMinor(qty, priceFx, code) {
  const info = currencyInfo(code);
  const q = parseDecimal(qty, FX_QTY_DECIMALS);
  const p = parseDecimal(priceFx, FX_PRICE_DECIMALS);
  if (!info || !q || !p || q.digits <= 0n || p.digits < 0n) return null;
  return toSafeNumber(divRoundHalfUp(q.digits * p.digits * pow10(info.minor), pow10(FX_QTY_DECIMALS + FX_PRICE_DECIMALS)));
}
// input: { currency, lines: [{ qty, priceFx }], vatMode: 'add' | 'none', rate, per }
// → { lines: [{ amountFxMinor, amountThbSatang }], subtotalFxMinor, vatFxMinor, totalFxMinor, subtotalSatang, vatSatang, totalSatang }
export function planFxSalesAmounts(input = {}) {
  const info = currencyInfo(input.currency);
  if (!info || info.code === FUNCTIONAL_CURRENCY) fail('currency.unknown', { currency: fxStr(input.currency) });
  if (!['add', 'none'].includes(input.vatMode)) fail('vat.extract', {});
  const rows = Array.isArray(input.lines) ? input.lines : [];
  if (!rows.length) fail('doc.noLines', {});
  const lines = rows.map((row, index) => {
    if (!parseDecimal(row?.qty, FX_QTY_DECIMALS) || !(Number(row.qty) > 0)) fail('qty.invalid', { line: index + 1 });
    if (!parseDecimal(row?.priceFx, FX_PRICE_DECIMALS)) fail('price.invalid', { line: index + 1, currency: info.code });
    return { amountFxMinor: fxLineAmountMinor(row.qty, row.priceFx, info.code) };
  });
  const subtotalFxMinor = lines.reduce((sum, line) => sum + line.amountFxMinor, 0);
  if (!(subtotalFxMinor > 0)) fail('doc.zero', {});
  const subtotalSatang = convertToSatang(subtotalFxMinor, info.code, input.rate, input.per);
  const shares = allocateExact(subtotalSatang, lines.map(line => line.amountFxMinor));
  lines.forEach((line, index) => { line.amountThbSatang = shares[index]; });
  const vatSatang = input.vatMode === 'add' ? toSafeNumber(divRoundHalfUp(BigInt(subtotalSatang) * BigInt(VAT_PERCENT), 100n)) : 0;
  const vatFxMinor = input.vatMode === 'add' ? toSafeNumber(divRoundHalfUp(BigInt(subtotalFxMinor) * BigInt(VAT_PERCENT), 100n)) : 0;
  return { lines, subtotalFxMinor, vatFxMinor, totalFxMinor: subtotalFxMinor + vatFxMinor, subtotalSatang, vatSatang, totalSatang: subtotalSatang + vatSatang };
}
// The fields of a stored foreign-currency sales document (invoice / quotation). Shape check only: the rate itself comes
// from the rate table through the screen; this checks it is a valid rate of the right TYPE and DATE for the document.
export const FX_DOC_FIELDS = Object.freeze(['currency', 'fxRate', 'fxPer', 'fxRateType', 'fxRateDate', 'fxRateId', 'fxSource', 'fxSubtotal', 'fxVat', 'amountFx', 'amountThb', 'fxPrintMode', 'fxApprovalNo', 'fxApprovalDate', 'exportKind', 'exportDate']);
export function fxRateFieldsError(record, expectedTypes) {
  const code = fxStr(record.currency).toUpperCase();
  if (!isFxDocument(record)) return { key: 'currency.unknown', params: { currency: code } };
  if (!normalizeRateText(record.fxRate) || normalizeRateText(record.fxRate) !== fxStr(record.fxRate)) return { key: 'rate.invalid', params: { value: fxStr(record.fxRate) } };
  if (!FX_RATE_PERS.includes(Number(record.fxPer))) return { key: 'rate.per', params: {} };
  if (!expectedTypes.includes(record.fxRateType)) return { key: 'rate.type', params: { type: fxStr(record.fxRateType) } };
  const rule = fxRateDateFor(record.date, record.fxRateType);
  if (!rule.rateDate || fxStr(record.fxRateDate) !== rule.rateDate) return { key: 'rate.ruleDate', params: { rateDate: fxStr(record.fxRateDate), expectedDate: rule.rateDate, docDate: fxStr(record.date).slice(0, 10) } };
  if (!FX_RATE_ID_RE.test(fxStr(record.fxRateId))) return { key: 'rate.id', params: {} };
  return null;
}
// Applies the conversion to a sales draft (invoice or quotation) — the ONLY place the baht of a foreign-currency sales
// document is computed. Each item must carry `priceFx`; qty is unchanged. Sets per item: priceFx, amountFx, amountThb,
// saleTotal (= amountThb), priceUnit (= amountThb ÷ qty, unrounded, so qty × priceUnit gives the stored baht line), and
// the document totals in baht (itemSaleTotal, subtotal, vatAmt, total, saleTotal) and in the currency.
// options: { rateTypes: allowed types, approval: { no, date } (the company setting at issue), kind: 'invoice' | 'quote' }
export function applyFxToSalesDraft(draft, options = {}) {
  const record = { ...draft };
  const code = fxStr(record.currency).toUpperCase();
  record.currency = code;
  record.fxRate = normalizeRateText(record.fxRate) || fxStr(record.fxRate);
  record.fxPer = Number(record.fxPer);
  const rateError = fxRateFieldsError(record, options.rateTypes || SALES_RATE_TYPES);
  if (rateError) fail(rateError.key, rateError.params);
  const vatMode = record.vatMode === 'add' || Number(record.useVat) === 1 ? 'add' : record.vatMode === 'none' || Number(record.useVat) === 2 ? 'none' : 'extract';
  if (vatMode === 'extract') fail('vat.extract', {});
  if (record.taxInvoiceForm === 'abbreviated') fail('doc.abbreviated', {});
  if (record.taxPoint === 'payment') fail('doc.taxPoint', {});
  const items = Array.isArray(record.items) ? record.items : [];
  const plan = planFxSalesAmounts({ currency: code, lines: items.map(item => ({ qty: item?.qty, priceFx: item?.priceFx })), vatMode, rate: record.fxRate, per: record.fxPer });
  record.items = items.map((item, index) => {
    const line = plan.lines[index];
    const amountThb = fxSatangToBaht(line.amountThbSatang);
    const qty = Number(item.qty);
    return { ...item, priceFx: Number(normalizeDecimalText(item.priceFx, FX_PRICE_DECIMALS)), amountFx: minorToMajor(line.amountFxMinor, code), amountThb, saleTotal: amountThb, priceUnit: qty > 0 ? amountThb / qty : 0 };
  });
  const subtotal = fxSatangToBaht(plan.subtotalSatang), vat = fxSatangToBaht(plan.vatSatang), total = fxSatangToBaht(plan.totalSatang);
  Object.assign(record, {
    useVat: vatMode === 'add' ? 1 : 2, vatMode,
    itemSaleTotal: subtotal, subtotal, vatAmt: vat, total, saleTotal: subtotal,
    fxSubtotal: minorToMajor(plan.subtotalFxMinor, code), fxVat: minorToMajor(plan.vatFxMinor, code), amountFx: minorToMajor(plan.totalFxMinor, code), amountThb: total
  });
  // Exports (0 %, rule 4): goods or services; the export date of goods.
  if (vatMode === 'none' && record.vatCategory === 'zero') {
    record.exportKind = record.exportKind === 'service' ? 'service' : 'goods';
    if (record.exportDate !== undefined && record.exportDate !== '' && !isIso(record.exportDate)) fail('export.date', {});
    if (!record.exportDate) delete record.exportDate;
  } else { delete record.exportKind; delete record.exportDate; }
  // Print mode (rule 1): a domestic tax invoice prints in baht (the currency only as "ข้อมูลประกอบ") unless the company had
  // the Director-General's approval when it was issued; an export invoice of goods (used instead of a tax invoice,
  // ป.132/2548 ข้อ 6) and a quotation / proforma print in the currency.
  const approval = fxIsObject(options.approval) && fxStr(options.approval.no) ? { no: fxCleanLine(options.approval.no, 80), date: fxStr(options.approval.date) } : null;
  if (options.kind === 'quote') { record.fxPrintMode = 'fx'; delete record.fxApprovalNo; delete record.fxApprovalDate; }
  else if (record.exportKind === 'goods') { record.fxPrintMode = 'fx'; delete record.fxApprovalNo; delete record.fxApprovalDate; }
  else if (approval) { record.fxPrintMode = 'fx'; record.fxApprovalNo = approval.no; record.fxApprovalDate = approval.date; }
  else { record.fxPrintMode = 'thb'; delete record.fxApprovalNo; delete record.fxApprovalDate; }
  return record;
}
export function normalizeDecimalText(value, scale) {
  const parsed = parseDecimal(value, scale);
  if (!parsed) return '';
  const whole = parsed.digits / pow10(scale);
  const frac = String(parsed.digits % pow10(scale)).padStart(scale, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}
// Foreign minor units of a stored sales document (its total incl. foreign VAT); 0 when not a foreign document.
export const fxTotalMinorOf = record => (isFxDocument(record) ? toMinorUnits(record.amountFx, record.currency) ?? 0 : 0);

// ---------------------------------------------------------------- receivables in a currency (report rule 5)
const fxIsLive = row => !!row && typeof row === 'object' && !row.voided && !row.cancelled && !row.reversed && row.status !== 'cancelled' && row.status !== 'voided';
const dateOf = row => fxStr(row?.date).slice(0, 10);
const byDateThenNo = (a, b) => (dateOf(a) < dateOf(b) ? -1 : dateOf(a) > dateOf(b) ? 1 : fxStr(a.no).localeCompare(fxStr(b.no), 'en', { numeric: true }));
// The open item of a foreign-currency invoice: its total in the currency and in baht, the live foreign receipts (and
// foreign credit / debit notes) up to `asOf`. The baht side equals ERPIntegrity.paymentSummary (receipt.total = the
// receivable baht it settled). → { currency, totalFx, totalThb (satang), settledFx, settledThb, openFx, openThb, receipts }
export function fxInvoiceOpenItem(invoice, related = {}, asOf = '') {
  const code = fxStr(invoice?.currency).toUpperCase();
  const inRange = row => !asOf || dateOf(row) <= asOf;
  const totalFx = fxTotalMinorOf(invoice);
  const totalThb = bahtToSatang(invoice?.total);
  let adjustFx = 0, adjustThb = 0;
  for (const [list, sign] of [[related.creditNotes, -1], [related.debitNotes, 1]]) {
    for (const note of Array.isArray(list) ? list : []) {
      if (!fxIsLive(note) || !inRange(note) || fxStr(note.currency).toUpperCase() !== code) continue;
      adjustFx += sign * (toMinorUnits(note.amountFx, code) ?? 0);
      adjustThb += sign * bahtToSatang(note.total);
    }
  }
  const receipts = (Array.isArray(related.receipts) ? related.receipts : []).filter(row => fxIsLive(row) && inRange(row) && fxStr(row.currency).toUpperCase() === code).sort(byDateThenNo);
  const settledFx = receipts.reduce((sum, row) => sum + (toMinorUnits(row.amountFx, code) ?? 0), 0);
  const settledThb = receipts.reduce((sum, row) => sum + bahtToSatang(row.total), 0);
  return { currency: code, totalFx: totalFx + adjustFx, totalThb: totalThb + adjustThb, settledFx, settledThb, openFx: totalFx + adjustFx - settledFx, openThb: totalThb + adjustThb - settledThb, receipts };
}
// The carrying baht settled by a payment of `amountFxMinor` against an open item: the remaining baht in proportion to
// the remaining currency (half-up); the payment that clears the currency clears the baht exactly.
export function fxSettledCarrying(openFx, openThb, amountFxMinor) {
  if (!(openFx > 0) || !(amountFxMinor > 0) || amountFxMinor > openFx) fail('settle.amount', {});
  if (amountFxMinor === openFx) return openThb;
  return toSafeNumber(divRoundHalfUp(BigInt(openThb) * BigInt(amountFxMinor), BigInt(openFx)));
}
// A receipt in the invoice's currency: the receivable it settles (carrying baht), the baht actually received at the
// receipt's rate, and the realised exchange difference (> 0 gain → 4210, < 0 loss → 5420). A partial receipt keeps
// the rest open. WHT on a foreign receipt is not supported (a foreign customer does not withhold Thai tax).
// input: { invoice, related (receipts / notes of the invoice), date, amountFx (major), rate lookup fields }
export function planFxReceipt(input = {}) {
  const invoice = input.invoice;
  if (!isFxDocument(invoice)) fail('receipt.notFx', {});
  if (!fxIsLive(invoice)) fail('receipt.cancelled', {});
  const code = fxStr(invoice.currency).toUpperCase();
  const date = fxStr(input.date).slice(0, 10);
  if (!isIso(date)) fail('receipt.date', {});
  if (date < dateOf(invoice)) fail('receipt.beforeInvoice', { docDate: dateOf(invoice) });
  if (Number(input.whtAmount) > 0) fail('receipt.wht', {});
  const amountFxMinor = toMinorUnits(input.amountFx, code);
  if (amountFxMinor === null) fail('amount.decimals', { currency: code, minor: currencyInfo(code).minor });
  if (!(amountFxMinor > 0)) fail('amount.invalid', {});
  const open = fxInvoiceOpenItem(invoice, input.related || {});
  if (amountFxMinor > open.openFx) fail('receipt.over', { open: formatFx(open.openFx, code) });
  const rateRecord = { currency: code, date, fxRate: fxStr(input.fxRate), fxPer: Number(input.fxPer), fxRateType: input.fxRateType, fxRateDate: input.fxRateDate, fxRateId: input.fxRateId };
  const rateError = fxRateFieldsError(rateRecord, RECEIPT_RATE_TYPES);
  if (rateError) fail(rateError.key, rateError.params);
  const settledSatang = fxSettledCarrying(open.openFx, open.openThb, amountFxMinor);
  const cashSatang = convertToSatang(amountFxMinor, code, rateRecord.fxRate, rateRecord.fxPer);
  return { currency: code, amountFxMinor, settledSatang, cashSatang, realisedSatang: cashSatang - settledSatang, final: amountFxMinor === open.openFx, openBefore: open, openAfterFx: open.openFx - amountFxMinor, openAfterThb: open.openThb - settledSatang };
}
// The stored receipt of a plan (screen and sample data build it here, the same way): `total` = the receivable baht it
// settles (so every balance report stays the invoice's own baht, VAT split in the invoice's proportion); the bank gets
// amountThb (the currency at the receipt's rate); fxRealisedThb = the difference. meta: { id, no, date, note, createdAt }.
export function fxReceiptRecord(invoice, plan, lookup, meta = {}) {
  const settled = fxSatangToBaht(plan.settledSatang);
  const invoiceTotal = Number(invoice.total) || 0;
  const net = invoiceTotal > 0 && Number(invoice.vatAmt) > 0 ? roundMoneyValue(settled * (Number(invoice.subtotal) || 0) / invoiceTotal) : settled;
  const vat = roundMoneyValue(settled - net);
  const amountFx = minorToMajor(plan.amountFxMinor, plan.currency);
  const label = `${plan.final ? 'รับชำระ' : 'รับชำระบางส่วน'}ตามบิล ${invoice.no} (${formatFx(plan.amountFxMinor, plan.currency)})`;
  const branch = invoice._branch ?? invoice.branch;
  return {
    id: meta.id, no: meta.no, date: meta.date, branch, customer: invoice.customer, customerAddress: invoice.customerAddress || '', customerTaxId: invoice.customerTaxId || '', customerBranchCode: invoice.customerBranchCode || '', customerBranchName: invoice.customerBranchName || '', contact: invoice.contact || '', phone: invoice.phone || '', email: invoice.email || '', salesPerson: invoice.salesPerson || '',
    invNo: invoice.no, invoiceId: invoice.id, invoiceBranch: branch, invoiceYear: invoice._year ?? invoice.year, invoiceMonth: invoice._month ?? invoice.month, creditTerm: invoice.creditTerm || '',
    items: [{ product: label, productCode: '', qty: 1, unit: 'ครั้ง', priceUnit: settled, saleTotal: settled, costUnit: 0 }], itemSaleTotal: settled, saleTotal: settled, subtotal: net, vatAmt: vat, total: settled, vatMode: vat > 0 ? 'extract' : 'none', useVat: vat > 0 ? 0 : 2,
    commAmt: 0, costTotal: 0, profit: 0, whtRate: 0, whtAmount: 0, cashReceived: fxSatangToBaht(plan.cashSatang),
    currency: plan.currency, ...fxRateFieldsOf(lookup), amountFx, amountThb: fxSatangToBaht(plan.cashSatang), fxSettledThb: settled, fxRealisedThb: fxSatangToBaht(plan.realisedSatang), fxFinal: plan.final,
    note: fxStr(meta.note), attachments: [], paymentManaged: true, createdAt: fxStr(meta.createdAt)
  };
}
// The realised difference stored on a foreign receipt (satang; 0 for any other receipt).
export function fxRealisedSatangOf(receipt) {
  if (!isFxDocument(receipt)) return 0;
  const value = Number(receipt.fxRealisedThb);
  return Number.isFinite(value) ? bahtToSatang(value) : 0;
}

// ---------------------------------------------------------------- payables in a currency and payments abroad
// A foreign expense (supplier invoice) or goods receipt is a payable in the currency: amountFx and the baht `amount`
// (expense) / goods value (receipt) at the liability day's SELLING rate. Payments are stored ON the record
// (`fxPayments`, append-only, cancel = status 'voided'), each computed once:
//   settledThb   carrying baht of the payable settled (proportional, the last payment clears it exactly)
//   cashFx/Thb   the currency sent and its baht at the payment day's selling rate
//   wht          ภ.ง.ด.54 (s.70) on the income: deducted from the payee, or borne by the company (gross-up, as WHT
//                condition 2: income = net ÷ (1 − r)) — baht at the SELLING rate of the payment day (report rule 7)
//   pp36         VAT on an imported service (7 % of the income incl. withholding), self-assessed on ภ.พ.36 and claimable
//                as input VAT the month after the payment
//   realisedThb  settledThb − cashThb − (withheld from payee) → > 0 gain (4210), < 0 loss (5420)
export const FX_PAYMENT_FIELDS = Object.freeze(['id', 'no', 'date', 'branch', 'currency', 'amountFx', 'fxRate', 'fxPer', 'fxRateType', 'fxRateDate', 'fxRateId', 'fxSource', 'settledThb', 'cashFx', 'cashThb', 'realisedThb', 'final', 'wht', 'pp36', 'note', 'status', 'voidedAt', 'voidReason', 'createdAt', 'createdBy', 'demoSeed', 'demoSeedBatch']);
export const FX_PAYMENT_WHT_FIELDS = Object.freeze(['incomeType', 'rate', 'grossUp', 'incomeThb', 'whtThb', 'borneThb', 'fromPayeeFx', 'payeeName', 'payeeCountry', 'payeeAddress', 'payeeTaxRef', 'dtaNote']);
export const FX_PAYMENT_PP36_FIELDS = Object.freeze(['baseThb', 'vatThb', 'claimPeriod']);
// The carrying total of a foreign payable in satang: expense `amount`; goods receipt: its goods value + VAT stored.
export function fxPayableTotals(record, kind = 'expense') {
  const code = fxStr(record?.currency).toUpperCase();
  const totalFx = toMinorUnits(record?.amountFx, code) ?? 0;
  const totalThb = kind === 'gr' ? bahtToSatang(record?.amountThb) : bahtToSatang(record?.amount);
  return { currency: code, totalFx, totalThb };
}
export function fxPayableOpenItem(record, kind = 'expense', asOf = '') {
  const totals = fxPayableTotals(record, kind);
  const payments = (Array.isArray(record?.fxPayments) ? record.fxPayments : []).filter(row => fxIsLive(row) && (!asOf || dateOf(row) <= asOf)).sort(byDateThenNo);
  const settledFx = payments.reduce((sum, row) => sum + (toMinorUnits(row.amountFx, totals.currency) ?? 0), 0);
  const settledThb = payments.reduce((sum, row) => sum + bahtToSatang(row.settledThb), 0);
  return { ...totals, settledFx, settledThb, openFx: totals.totalFx - settledFx, openThb: totals.totalThb - settledThb, payments };
}
// input: { record (expense / goods receipt), kind: 'expense' | 'gr', date, amountFx (major), rate fields (selling rate of
//   the payment day), wht: { enabled, incomeType, rate, grossUp, payeeName, payeeCountry, payeeAddress, payeeTaxRef,
//   dtaNote }, pp36: { enabled } }
export function planFxPayment(input = {}) {
  const record = input.record;
  const kind = input.kind === 'gr' ? 'gr' : 'expense';
  if (!isFxDocument(record)) fail('payment.notFx', {});
  if (!fxIsLive(record) || record.deleted === true) fail('payment.cancelled', {});
  const code = fxStr(record.currency).toUpperCase();
  const date = fxStr(input.date).slice(0, 10);
  if (!isIso(date)) fail('payment.date', {});
  if (date < dateOf(record)) fail('payment.beforeDocument', { docDate: dateOf(record) });
  const amountFxMinor = toMinorUnits(input.amountFx, code);
  if (amountFxMinor === null) fail('amount.decimals', { currency: code, minor: currencyInfo(code).minor });
  if (!(amountFxMinor > 0)) fail('amount.invalid', {});
  const open = fxPayableOpenItem(record, kind);
  if (amountFxMinor > open.openFx) fail('payment.over', { open: formatFx(open.openFx, code) });
  const rateRecord = { currency: code, date, fxRate: fxStr(input.fxRate), fxPer: Number(input.fxPer), fxRateType: input.fxRateType, fxRateDate: input.fxRateDate, fxRateId: input.fxRateId };
  const rateError = fxRateFieldsError(rateRecord, [LIABILITY_RATE_TYPE]);
  if (rateError) fail(rateError.key, rateError.params);
  const settledSatang = fxSettledCarrying(open.openFx, open.openThb, amountFxMinor);
  const whtIn = fxIsObject(input.wht) && input.wht.enabled ? input.wht : null;
  const pp36In = fxIsObject(input.pp36) && input.pp36.enabled;
  if ((whtIn || pp36In) && kind !== 'expense') fail('payment.whtGoods', {});
  let wht = null, cashFxMinor = amountFxMinor, cashSatang, incomeSatang, whtSatang = 0, borneSatang = 0;
  if (whtIn) {
    if (!PND54_INCOME_TYPES.includes(whtIn.incomeType)) fail('wht.incomeType', {});
    const rate = Number(whtIn.rate);
    if (!Number.isFinite(rate) || !(rate > 0) || rate >= 100 || Math.round(rate * 100) !== rate * 100) fail('wht.rate', {});
    const payeeName = fxCleanLine(whtIn.payeeName, 160);
    const payeeCountry = fxCleanLine(whtIn.payeeCountry, 80);
    if (!payeeName || !payeeCountry) fail('wht.payee', {});
    if (whtIn.grossUp) {
      // The payee receives the whole amount; the company bears the tax: income = cash ÷ (1 − r) (condition 2).
      cashSatang = convertToSatang(cashFxMinor, code, rateRecord.fxRate, rateRecord.fxPer);
      const grossed = calculateWht({ base: fxSatangToBaht(cashSatang), rate, condition: 2 });
      incomeSatang = bahtToSatang(grossed.amountPaid);
      whtSatang = bahtToSatang(grossed.whtAmount);
      borneSatang = whtSatang;
    } else {
      // Deducted: the income is the whole amount (selling rate of the payment day); the tax is withheld in the currency
      // (half-up in minor units) and the rest is sent.
      incomeSatang = convertToSatang(amountFxMinor, code, rateRecord.fxRate, rateRecord.fxPer);
      whtSatang = toSafeNumber(divRoundHalfUp(BigInt(incomeSatang) * BigInt(Math.round(rate * 100)), 10000n));
      const withheldFx = toSafeNumber(divRoundHalfUp(BigInt(amountFxMinor) * BigInt(Math.round(rate * 100)), 10000n));
      cashFxMinor = amountFxMinor - withheldFx;
      cashSatang = convertToSatang(cashFxMinor, code, rateRecord.fxRate, rateRecord.fxPer);
    }
    wht = { incomeType: whtIn.incomeType, rate, grossUp: !!whtIn.grossUp, incomeThb: fxSatangToBaht(incomeSatang), whtThb: fxSatangToBaht(whtSatang), borneThb: fxSatangToBaht(borneSatang), fromPayeeFx: minorToMajor(amountFxMinor - cashFxMinor, code), payeeName, payeeCountry, payeeAddress: fxCleanLine(whtIn.payeeAddress, 300), payeeTaxRef: fxCleanLine(whtIn.payeeTaxRef, 40), dtaNote: fxCleanLine(whtIn.dtaNote, 200) };
  } else {
    cashSatang = convertToSatang(cashFxMinor, code, rateRecord.fxRate, rateRecord.fxPer);
    incomeSatang = cashSatang;
  }
  let pp36 = null;
  if (pp36In) {
    // VAT base of an imported service = the money paid for it incl. the withholding tax (the income above).
    const vatSatang = toSafeNumber(divRoundHalfUp(BigInt(incomeSatang) * BigInt(VAT_PERCENT), 100n));
    pp36 = { baseThb: fxSatangToBaht(incomeSatang), vatThb: fxSatangToBaht(vatSatang), claimPeriod: addTaxPeriods(taxPeriodOfDate(date), 1) };
  }
  // Settled carrying − cash sent − tax withheld from the payee. With gross-up the borne tax is an expense of its own
  // (5410), not part of the exchange difference.
  const withheldFromPayee = whtIn && !whtIn.grossUp ? whtSatang : 0;
  const realisedSatang = settledSatang - cashSatang - withheldFromPayee;
  return { currency: code, amountFxMinor, settledSatang, cashFxMinor, cashSatang, whtSatang, borneSatang, incomeSatang, realisedSatang, final: amountFxMinor === open.openFx, wht, pp36, openBefore: open };
}
// The stored payment row of a plan.
export function fxPaymentRecord(plan, meta = {}) {
  const row = {
    id: fxStr(meta.id), no: fxStr(meta.no), date: fxStr(meta.date).slice(0, 10), branch: fxStr(meta.branch), currency: plan.currency,
    amountFx: minorToMajor(plan.amountFxMinor, plan.currency), fxRate: fxStr(meta.fxRate), fxPer: Number(meta.fxPer), fxRateType: LIABILITY_RATE_TYPE, fxRateDate: fxStr(meta.fxRateDate), fxRateId: fxStr(meta.fxRateId), fxSource: fxStr(meta.fxSource).slice(0, 320),
    settledThb: fxSatangToBaht(plan.settledSatang), cashFx: minorToMajor(plan.cashFxMinor, plan.currency), cashThb: fxSatangToBaht(plan.cashSatang), realisedThb: fxSatangToBaht(plan.realisedSatang), final: plan.final,
    wht: plan.wht ? { ...plan.wht } : null, pp36: plan.pp36 ? { ...plan.pp36 } : null,
    note: fxCleanLine(meta.note, 300), status: 'posted', createdAt: fxStr(meta.createdAt), createdBy: fxCleanLine(meta.createdBy, 80)
  };
  if (meta.demoSeed === true) Object.assign(row, { demoSeed: true, demoSeedBatch: fxStr(meta.demoSeedBatch) || 'demo' });
  return row;
}
// Strict check of the stored payments of a record (backup / import / reads): → the list or throws FxError('store.payments').
export function normalizeFxPayments(list, at = '') {
  if (list === undefined) return undefined;
  const bad = field => fail('store.payments', { detail: `${at} ${field}` });
  if (!Array.isArray(list) || list.length > 200) bad('list');
  const ids = new Set();
  return list.map((row, index) => {
    if (!fxIsObject(row)) bad(`#${index + 1}`);
    for (const key of Object.keys(row)) if (!FX_PAYMENT_FIELDS.includes(key)) bad(key);
    if (!/^[\w.:-]{1,80}$/.test(fxStr(row.id)) || ids.has(row.id)) bad('id');
    ids.add(row.id);
    if (!isIso(row.date) || !FOREIGN_CURRENCY_CODES.includes(row.currency)) bad('date/currency');
    for (const key of ['amountFx', 'settledThb', 'cashFx', 'cashThb', 'realisedThb']) if (typeof row[key] !== 'number' || !Number.isFinite(row[key])) bad(key);
    if (!normalizeRateText(row.fxRate) || !FX_RATE_PERS.includes(row.fxPer) || row.fxRateType !== LIABILITY_RATE_TYPE || !isIso(row.fxRateDate)) bad('rate');
    if (!['posted', 'voided'].includes(row.status)) bad('status');
    if (row.wht !== null && row.wht !== undefined) {
      if (!fxIsObject(row.wht)) bad('wht');
      for (const key of Object.keys(row.wht)) if (!FX_PAYMENT_WHT_FIELDS.includes(key)) bad(`wht.${key}`);
      for (const key of ['rate', 'incomeThb', 'whtThb', 'borneThb', 'fromPayeeFx']) if (typeof row.wht[key] !== 'number' || !Number.isFinite(row.wht[key])) bad(`wht.${key}`);
      if (!PND54_INCOME_TYPES.includes(row.wht.incomeType)) bad('wht.incomeType');
    }
    if (row.pp36 !== null && row.pp36 !== undefined) {
      if (!fxIsObject(row.pp36)) bad('pp36');
      for (const key of Object.keys(row.pp36)) if (!FX_PAYMENT_PP36_FIELDS.includes(key)) bad(`pp36.${key}`);
      if (typeof row.pp36.baseThb !== 'number' || typeof row.pp36.vatThb !== 'number' || !parseTaxPeriod(row.pp36.claimPeriod)) bad('pp36');
    }
    return { ...row };
  });
}

// ---------------------------------------------------------------- ภ.ง.ด.54 and ภ.พ.36 (monthly lists, report rule 7)
// Both are due within 7 days after the month of payment, moved past weekends and government holidays (round-13A table).
// The e-filing extension of ภ.ง.ด.54 / ภ.พ.36 is not modelled (to be confirmed).
export function fxForeignDueDate(period) {
  const next = addTaxPeriods(period, 1);
  if (!next) return null;
  const base = `${next}-${String(FX_PAYMENT_DUE_DAY).padStart(2, '0')}`;
  const due = rollTaxDueDate(base);
  return { base, due, rolled: due !== base, holidays: taxRolledHolidays(base, due), holidayStatus: taxHolidayYearStatus(due) || 'unknown' };
}
// Every live payment of the period of live foreign expenses of the establishment(s).
// sources: [{ branch, expenses }] → rows sorted by date and number.
function foreignPaymentRows(period, sources, pick) {
  const rows = [];
  for (const source of Array.isArray(sources) ? sources : []) {
    for (const expense of Array.isArray(source?.expenses) ? source.expenses : []) {
      if (!isFxDocument(expense) || !fxIsLive(expense) || expense.deleted === true) continue;
      for (const payment of Array.isArray(expense.fxPayments) ? expense.fxPayments : []) {
        if (!fxIsLive(payment) || taxPeriodOfDate(payment.date) !== period) continue;
        const row = pick(payment, expense, fxStr(source.branch));
        if (row) rows.push(row);
      }
    }
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : fxStr(a.paymentNo).localeCompare(fxStr(b.paymentNo), 'en', { numeric: true })));
  rows.forEach((row, index) => { row.seq = index + 1; });
  return rows;
}
export function buildPnd54Report({ period, sources } = {}) {
  const rows = foreignPaymentRows(period, sources, (payment, expense, branch) => (payment.wht ? {
    branch, date: payment.date, paymentNo: fxStr(payment.no), expenseNo: fxStr(expense.docNo), payeeName: payment.wht.payeeName, payeeCountry: payment.wht.payeeCountry, payeeAddress: payment.wht.payeeAddress, payeeTaxRef: payment.wht.payeeTaxRef,
    incomeType: payment.wht.incomeType, rate: payment.wht.rate, grossUp: payment.wht.grossUp, currency: payment.currency, amountFx: payment.amountFx, fxRate: payment.fxRate, fxPer: payment.fxPer, fxRateDate: payment.fxRateDate,
    incomeThb: payment.wht.incomeThb, whtThb: payment.wht.whtThb, borneThb: payment.wht.borneThb, dtaNote: payment.wht.dtaNote
  } : null));
  const sum = key => fxSatangToBaht(rows.reduce((acc, row) => acc + bahtToSatang(row[key]), 0));
  return { kind: 'pnd54', period, rows, totals: { count: rows.length, incomeThb: sum('incomeThb'), whtThb: sum('whtThb'), borneThb: sum('borneThb') }, due: fxForeignDueDate(period) };
}
export function buildPp36Report({ period, sources } = {}) {
  const rows = foreignPaymentRows(period, sources, (payment, expense, branch) => (payment.pp36 ? {
    branch, date: payment.date, paymentNo: fxStr(payment.no), expenseNo: fxStr(expense.docNo), payeeName: payment.wht?.payeeName || fxStr(expense.vendor), payeeCountry: payment.wht?.payeeCountry || '',
    description: fxStr(expense.desc), currency: payment.currency, amountFx: payment.amountFx, fxRate: payment.fxRate, fxPer: payment.fxPer, fxRateDate: payment.fxRateDate, baseThb: payment.pp36.baseThb, vatThb: payment.pp36.vatThb, claimPeriod: payment.pp36.claimPeriod
  } : null));
  const sum = key => fxSatangToBaht(rows.reduce((acc, row) => acc + bahtToSatang(row[key]), 0));
  return { kind: 'pp36', period, rows, totals: { count: rows.length, baseThb: sum('baseThb'), vatThb: sum('vatThb') }, due: fxForeignDueDate(period) };
}
// Table form (screen / Excel / CSV) of the two lists: { header: [labels], body: [[cells]], footer }.
export const PND54_COLUMNS = Object.freeze(['seq', 'date', 'payeeName', 'payeeCountry', 'incomeType', 'amountFx', 'rate', 'incomeThb', 'whtRate', 'whtThb', 'condition', 'paymentNo']);
export const PP36_COLUMNS = Object.freeze(['seq', 'date', 'payeeName', 'description', 'amountFx', 'rate', 'baseThb', 'vatThb', 'claimPeriod', 'paymentNo']);
export function fxForeignTable(report, lang = 'th') {
  const columns = report.kind === 'pnd54' ? PND54_COLUMNS : PP36_COLUMNS;
  const header = columns.map(column => fxText(`col.${column}`, {}, lang));
  const cell = (row, column) => {
    if (column === 'date') return lang === 'en' ? fxDateText(row.date, 'en') : taxThaiDate(row.date);
    if (column === 'amountFx') return `${row.currency} ${formatMinor(toMinorUnits(row.amountFx, row.currency) ?? 0, row.currency)}`;
    if (column === 'rate') return `${row.fxRate}${row.fxPer > 1 ? ` / ${row.fxPer}` : ''} (${lang === 'en' ? fxDateText(row.fxRateDate, 'en') : taxThaiDate(row.fxRateDate)})`;
    if (column === 'incomeType') return fxText(`income.${row.incomeType}`, {}, lang);
    if (column === 'whtRate') return row.rate;
    if (column === 'condition') return fxText(row.grossUp ? 'wht.grossUp' : 'wht.deduct', {}, lang);
    if (column === 'claimPeriod') return row.claimPeriod;
    if (['incomeThb', 'whtThb', 'baseThb', 'vatThb'].includes(column)) return row[column];
    return row[column] ?? '';
  };
  const body = report.rows.map(row => columns.map(column => cell(row, column)));
  const footer = columns.map((column, index) => (index === 0 ? fxText('col.total', {}, lang) : fxHasOwn(report.totals, column) ? report.totals[column] : ''));
  return { columns, header, body, footer };
}

// ---------------------------------------------------------------- month end: export values and revaluation (rules 4, 6)
// For a closed month P (only after it ended, never in a locked period — the screen checks the locks):
// 1. Export values of goods invoiced in P (ป.132/2548): Σ actual baht of the invoice's foreign receipts dated in P (the
//    currency sold in the month) + the rest at the BOT average BUYING rate announced on the month's last business day.
//    Stored on the invoice (`exportVat`) and used by รายงานภาษีขาย / ภ.พ.30 lines 1–2 instead of the invoice's baht; the
//    books keep the invoice-day baht (the difference is shown in the month-end checks). No effect on VAT (0 %).
// 2. Revaluation of every foreign open item at the end of P: receivables at the average BUYING rate, payables at the
//    average SELLING rate (rule 6, the method fixed in the settings: "reverse") → unrealised gain / loss on the last
//    day of P, reversed on day 1 of the next month (the carrying baht of every item stays the document's own).
//    The exchange difference is not a VAT base and changes no tax document.
// input: { period, invoices (with _branch), receipts, creditNotes, debitNotes, expenses, goodsReceipts, rates (store) }
// → { period, date, reverseDate, rows: [...], exportValues: [...], missing: [{ currency, type, rateDate }], totals }
export function planFxMonthEnd(input = {}) {
  const period = fxStr(input.period);
  if (!parseTaxPeriod(period)) fail('close.period', {});
  const date = taxPeriodLastDay(period);
  const reverseDate = taxPeriodFirstDay(addTaxPeriods(period, 1));
  const store = input.rates || emptyFxRateStore();
  const missing = new Map();
  const rateFor = (code, type) => {
    const lookup = lookupFxRate(store, { currency: code, date, type });
    if (!lookup.ok) { if (lookup.params?.rateDate) missing.set(`${code}|${type}|${lookup.params.rateDate}`, { currency: code, type, rateDate: lookup.params.rateDate }); return null; }
    return lookup;
  };
  const branchOf = row => fxStr(row?._branch || row?.branch);
  const receiptsOf = invoice => (input.receipts || []).filter(row => row && fxStr(row.invoiceBranch || row._branch || row.branch) === branchOf(invoice) && (fxStr(row.invoiceId) === fxStr(invoice.id) || (!fxStr(row.invoiceId) && fxStr(row.invNo) === fxStr(invoice.no))));
  const notesOf = (list, invoice) => (list || []).filter(note => fxIsLive(note) && (Array.isArray(note.lines) ? note.lines : []).some(line => fxStr(line.invoiceBranch || branchOf(note)) === branchOf(invoice) && (fxStr(line.invoiceId) === fxStr(invoice.id) || (!fxStr(line.invoiceId) && fxStr(line.invoiceNo) === fxStr(invoice.no)))));
  const rows = [];
  const exportValues = [];
  for (const invoice of input.invoices || []) {
    if (!isFxDocument(invoice) || !fxIsLive(invoice) || invoice.documentKind === 'delivery-tax-invoice' || dateOf(invoice) > date) continue;
    const code = fxStr(invoice.currency).toUpperCase();
    const related = { receipts: receiptsOf(invoice), creditNotes: notesOf(input.creditNotes, invoice), debitNotes: notesOf(input.debitNotes, invoice) };
    // 1. export value of goods invoiced in P
    if (taxPeriodOfDate(invoice.date) === period && invoice.vatCategory === 'zero' && invoice.exportKind === 'goods') {
      const sold = related.receipts.filter(row => fxIsLive(row) && taxPeriodOfDate(row.date) === period && fxStr(row.currency).toUpperCase() === code);
      const soldFx = sold.reduce((sum, row) => sum + (toMinorUnits(row.amountFx, code) ?? 0), 0);
      const soldThb = sold.reduce((sum, row) => sum + bahtToSatang(row.amountThb), 0);
      const totalFx = toMinorUnits(invoice.fxSubtotal ?? invoice.amountFx, code) ?? 0;
      const restFx = Math.max(0, totalFx - soldFx);
      const lookup = restFx > 0 ? rateFor(code, 'bot_avg_buying') : null;
      if (restFx === 0 || lookup) {
        const restThb = restFx > 0 ? convertToSatang(restFx, code, lookup.rate, lookup.per) : 0;
        exportValues.push({ branch: branchOf(invoice), invoiceId: fxStr(invoice.id), invoiceNo: fxStr(invoice.no), currency: code, totalFx: minorToMajor(totalFx, code), soldFx: minorToMajor(Math.min(soldFx, totalFx), code), soldThb: fxSatangToBaht(soldThb), restFx: minorToMajor(restFx, code), rate: lookup ? lookup.rate : '', per: lookup ? lookup.per : 1, rateDate: lookup ? lookup.rateDate : '', rateId: lookup ? lookup.id : '', thb: fxSatangToBaht(soldThb + restThb), bookThb: fxSatangToBaht(bahtToSatang(invoice.subtotal)), basis: restFx === 0 ? 'actual' : soldFx === 0 ? 'month_end_rate' : 'mixed' });
      }
    }
    // 2. revaluation of the open receivable
    const open = fxInvoiceOpenItem(invoice, related, date);
    if (!(open.openFx > 0)) continue;
    const lookup = rateFor(code, 'bot_avg_buying');
    if (!lookup) continue;
    const revalued = convertToSatang(open.openFx, code, lookup.rate, lookup.per);
    rows.push({ kind: 'ar', key: `inv|${branchOf(invoice)}|${fxStr(invoice.id) || fxStr(invoice.no)}`, branch: branchOf(invoice), docId: fxStr(invoice.id), no: fxStr(invoice.no), date: dateOf(invoice), party: fxStr(invoice.customer), currency: code, openFx: minorToMajor(open.openFx, code), carryingThb: fxSatangToBaht(open.openThb), rate: lookup.rate, per: lookup.per, rateType: 'bot_avg_buying', rateDate: lookup.rateDate, rateId: lookup.id, revaluedThb: fxSatangToBaht(revalued), diffThb: fxSatangToBaht(revalued - open.openThb) });
  }
  const payables = [...(input.expenses || []).map(row => ({ row, kind: 'expense' })), ...(input.goodsReceipts || []).map(row => ({ row, kind: 'gr' }))];
  for (const { row, kind } of payables) {
    if (!isFxDocument(row) || !fxIsLive(row) || row.deleted === true || dateOf(row) > date) continue;
    const code = fxStr(row.currency).toUpperCase();
    const open = fxPayableOpenItem(row, kind, date);
    if (!(open.openFx > 0)) continue;
    const lookup = rateFor(code, LIABILITY_RATE_TYPE);
    if (!lookup) continue;
    const revalued = convertToSatang(open.openFx, code, lookup.rate, lookup.per);
    const branch = branchOf(row);
    const id = fxStr(row.id) || `${dateOf(row)}|${fxStr(row.docNo)}`;
    // A payable: a larger baht value is a LOSS (diff < 0 = loss in the sign convention of `diffThb`: gain > 0).
    rows.push({ kind: 'ap', key: kind === 'gr' ? `gr|${branch}|${fxStr(row.id)}` : `exp|${branch}|${id}`, source: kind, branch, docId: fxStr(row.id), no: fxStr(row.no || row.docNo), date: dateOf(row), party: fxStr(row.supplier || row.vendor), currency: code, openFx: minorToMajor(open.openFx, code), carryingThb: fxSatangToBaht(open.openThb), rate: lookup.rate, per: lookup.per, rateType: LIABILITY_RATE_TYPE, rateDate: lookup.rateDate, rateId: lookup.id, revaluedThb: fxSatangToBaht(revalued), diffThb: fxSatangToBaht(open.openThb - revalued) });
  }
  rows.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'ar' ? -1 : 1) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || a.no.localeCompare(b.no, 'en', { numeric: true }));
  const sumDiff = (list, sign) => fxSatangToBaht(list.reduce((acc, row) => acc + (Math.sign(bahtToSatang(row.diffThb)) === sign ? bahtToSatang(row.diffThb) : 0), 0));
  return { period, date, reverseDate, rows, exportValues, missing: [...missing.values()], totals: { gain: sumDiff(rows, 1), loss: sumDiff(rows, -1), net: fxSatangToBaht(rows.reduce((acc, row) => acc + bahtToSatang(row.diffThb), 0)) } };
}

// ---------------------------------------------------------------- the month-end store (comform_fx_documents_v1)
// { schemaVersion: 1, closes: [{ id, period, date, reverseDate, method: 'reverse', status: 'posted' | 'voided', voidedAt,
//   voidReason, createdAt, createdBy, rows: [revaluation rows], exportValues: [export rows], demoSeed? }] } — one posted
// close per month; a voided one stays (cancel-not-delete). The journal posts each posted close (erp-journal-core.js).
export const FX_CLOSE_FIELDS = Object.freeze(['id', 'period', 'date', 'reverseDate', 'method', 'status', 'voidedAt', 'voidReason', 'createdAt', 'createdBy', 'rows', 'exportValues', 'demoSeed', 'demoSeedBatch']);
const FX_CLOSE_ROW_FIELDS = Object.freeze(['kind', 'key', 'source', 'branch', 'docId', 'no', 'date', 'party', 'currency', 'openFx', 'carryingThb', 'rate', 'per', 'rateType', 'rateDate', 'rateId', 'revaluedThb', 'diffThb']);
const FX_EXPORT_ROW_FIELDS = Object.freeze(['branch', 'invoiceId', 'invoiceNo', 'currency', 'totalFx', 'soldFx', 'soldThb', 'restFx', 'rate', 'per', 'rateDate', 'rateId', 'thb', 'bookThb', 'basis']);
export function emptyFxDocuments() {
  return { schemaVersion: FX_SCHEMA_VERSION, closes: [] };
}
export function normalizeFxDocuments(raw) {
  if (raw === null || raw === undefined || raw === '') return emptyFxDocuments();
  let value = raw;
  if (typeof raw === 'string') { try { value = JSON.parse(raw); } catch (error) { fail('store.closes', { detail: 'JSON' }); } }
  const bad = detail => fail('store.closes', { detail });
  if (!fxIsObject(value) || value.schemaVersion !== FX_SCHEMA_VERSION || !Array.isArray(value.closes) || value.closes.length > 1200) bad('object');
  for (const key of Object.keys(value)) if (!['schemaVersion', 'closes'].includes(key)) bad(key);
  const ids = new Set();
  const postedPeriods = new Set();
  const closes = value.closes.map((close, index) => {
    const at = `#${index + 1}`;
    if (!fxIsObject(close)) bad(at);
    for (const key of Object.keys(close)) if (!FX_CLOSE_FIELDS.includes(key)) bad(`${at} ${key}`);
    if (!/^fxc-[\w.:-]{1,60}$/.test(fxStr(close.id)) || ids.has(close.id)) bad(`${at} id`);
    ids.add(close.id);
    if (!parseTaxPeriod(close.period) || close.date !== taxPeriodLastDay(close.period) || close.reverseDate !== taxPeriodFirstDay(addTaxPeriods(close.period, 1))) bad(`${at} period`);
    if (close.method !== 'reverse' || !['posted', 'voided'].includes(close.status)) bad(`${at} status`);
    if (close.status === 'posted') { if (postedPeriods.has(close.period)) bad(`${at} duplicate`); postedPeriods.add(close.period); }
    if (close.status === 'voided' && !isInstant(close.voidedAt)) bad(`${at} voidedAt`);
    if (!isInstant(close.createdAt) || typeof close.createdBy !== 'string') bad(`${at} createdAt`);
    if (!Array.isArray(close.rows) || !Array.isArray(close.exportValues) || close.rows.length > 5000 || close.exportValues.length > 5000) bad(`${at} rows`);
    for (const row of close.rows) {
      if (!fxIsObject(row) || !['ar', 'ap'].includes(row.kind) || !/^(inv|exp|gr)\|(ubon|khonkaen)\|/.test(fxStr(row.key)) || !FOREIGN_CURRENCY_CODES.includes(row.currency)) bad(`${at} row`);
      for (const key of Object.keys(row)) if (!FX_CLOSE_ROW_FIELDS.includes(key)) bad(`${at} row ${key}`);
      for (const key of ['openFx', 'carryingThb', 'revaluedThb', 'diffThb']) if (typeof row[key] !== 'number' || !Number.isFinite(row[key])) bad(`${at} row ${key}`);
      const sign = row.kind === 'ar' ? 1 : -1;
      if (bahtToSatang(row.diffThb) !== sign * (bahtToSatang(row.revaluedThb) - bahtToSatang(row.carryingThb))) bad(`${at} row diff`);
    }
    for (const row of close.exportValues) {
      if (!fxIsObject(row) || !FOREIGN_CURRENCY_CODES.includes(row.currency) || typeof row.thb !== 'number' || !Number.isFinite(row.thb)) bad(`${at} export`);
      for (const key of Object.keys(row)) if (!FX_EXPORT_ROW_FIELDS.includes(key)) bad(`${at} export ${key}`);
    }
    return JSON.parse(JSON.stringify(close));
  });
  return { schemaVersion: FX_SCHEMA_VERSION, closes };
}
export function postedFxClose(documents, period) {
  return (documents?.closes || []).find(close => close.period === period && close.status === 'posted') || null;
}
// The latest posted month-end close on or after a date's month: a foreign-currency document dated in or before a closed
// month changes that close's figures, so it is refused until the close is cancelled.
export function fxCloseCovering(documents, date) {
  const period = taxPeriodOfDate(date);
  return (documents?.closes || []).filter(close => close.status === 'posted' && close.period >= period).sort((a, b) => (a.period < b.period ? 1 : -1))[0] || null;
}
// What the stored export value of an invoice is ('' fields when not yet fixed by a month-end close).
export function exportVatOf(invoice) {
  return fxIsObject(invoice?.exportVat) && Number.isFinite(Number(invoice.exportVat.thb)) ? invoice.exportVat : null;
}

// ---------------------------------------------------------------- printing (delivery / tax invoice, receipt, quotation)
// The amount in Thai words in a currency: "หนึ่งพันเจ็ดสิบดอลลาร์สหรัฐถ้วน", "สิบยูโรห้าสิบเซนต์", "หนึ่งแสนเยนถ้วน".
export function fxAmountWordsTh(minor, code) {
  const info = currencyInfo(code);
  if (!info) return '';
  const abs = Math.abs(Math.trunc(Number(minor) || 0));
  const unit = 10 ** info.minor;
  const major = Math.floor(abs / unit), rest = abs - major * unit;
  const head = `${thaiIntegerText(major)}${info.th}`;
  return rest && info.minorTh ? `${head}${thaiIntegerText(rest)}${info.minorTh}` : `${head}ถ้วน`;
}
// The amount in English words, commercial-invoice style: "USD one thousand seventy only", "EUR ten and 50/100 only".
export function fxAmountWordsEn(minor, code) {
  const info = currencyInfo(code);
  if (!info) return '';
  const abs = Math.abs(Math.trunc(Number(minor) || 0));
  const unit = 10 ** info.minor;
  const major = Math.floor(abs / unit), rest = abs - major * unit;
  let words;
  try { words = englishIntegerText(major); } catch (error) { return ''; }
  return `${info.code} ${words}${rest ? ` and ${String(rest).padStart(info.minor, '0')}/${unit}` : ''} only`;
}
// Everything a printed foreign-currency document shows besides its baht figures; null for a baht document.
// mode 'thb': the baht columns are the document, the currency is a "ข้อมูลประกอบ" box (a tax invoice without the
// Director-General's approval); mode 'fx': the currency columns are the document with the rate and the baht VAT (an
// approved tax invoice, an export invoice of goods, a quotation / proforma).
export function fxPrintInfo(record) {
  if (!isFxDocument(record)) return null;
  const code = fxStr(record.currency).toUpperCase();
  const info = currencyInfo(code);
  const minorOf = value => toMinorUnits(value, code) ?? 0;
  const items = Array.isArray(record.items) ? record.items : [];
  return {
    mode: record.fxPrintMode === 'fx' ? 'fx' : 'thb', currency: code, currencyTh: info.th, currencyEn: info.en,
    rate: fxStr(record.fxRate), per: FX_RATE_PERS.includes(Number(record.fxPer)) ? Number(record.fxPer) : 1, rateType: fxStr(record.fxRateType), rateTypeTh: rateTypeLabel(record.fxRateType, 'th'), rateDate: fxStr(record.fxRateDate),
    approvalNo: fxStr(record.fxApprovalNo), approvalDate: fxStr(record.fxApprovalDate), exportKind: fxStr(record.exportKind), exportDate: fxStr(record.exportDate),
    lines: items.map(item => ({ priceFx: normalizeDecimalText(item.priceFx, FX_PRICE_DECIMALS) ? GROUP_DECIMALS.format(Number(normalizeDecimalText(item.priceFx, FX_PRICE_DECIMALS))) : '', amountFx: formatMinor(minorOf(item.amountFx), code) })),
    subtotalFx: formatMinor(minorOf(record.fxSubtotal ?? record.amountFx), code), vatFx: formatMinor(minorOf(record.fxVat ?? 0), code), totalFx: formatMinor(minorOf(record.amountFx), code),
    totalWordsTh: fxAmountWordsTh(minorOf(record.amountFx), code), totalWordsEn: fxAmountWordsEn(minorOf(record.amountFx), code), amountThb: Number(record.amountThb ?? record.total) || 0
  };
}
const GROUP_DECIMALS = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
// The print block of a foreign-currency receipt.
export function fxReceiptPrintInfo(receipt) {
  if (!isFxDocument(receipt)) return null;
  const code = fxStr(receipt.currency).toUpperCase();
  const info = currencyInfo(code);
  const minor = toMinorUnits(receipt.amountFx, code) ?? 0;
  return {
    currency: code, currencyTh: info.th, amountFx: formatMinor(minor, code), wordsTh: fxAmountWordsTh(minor, code), wordsEn: fxAmountWordsEn(minor, code), rate: fxStr(receipt.fxRate), per: FX_RATE_PERS.includes(Number(receipt.fxPer)) ? Number(receipt.fxPer) : 1,
    rateTypeTh: rateTypeLabel(receipt.fxRateType, 'th'), rateDate: fxStr(receipt.fxRateDate), cashThb: Number(receipt.amountThb) || 0, settledThb: Number(receipt.fxSettledThb ?? receipt.total) || 0, realisedThb: Number(receipt.fxRealisedThb) || 0, final: receipt.fxFinal === true
  };
}
