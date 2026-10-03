// ============================================================================
// erp-receivables-core.js — pure receivable (AR) and management-report rules
// ERP DEMO 4.3.1 — DOM/storage free, unit-testable (see ADR-010 / ADR-011).
//
// What this module owns:
//   * the ONE due-date rule for customer invoices (explicit due date → credit
//     term → "due on the invoice date" for cash / walk-in / no-term invoices),
//   * open-item AR aging with the standard buckets used by the governance
//     aging (current / 1–30 / 31–60 / 61–90 / over 90 days past due),
//   * the per-customer aging summary, the overdue alert summary and its CSV,
//   * how a credit note (ใบลดหนี้) is spread over customers / products /
//     salespeople for the sales breakdowns, and the cost of returned goods,
//   * branch gross-profit / margin figures (no division by zero).
//
// What it deliberately does NOT own: "how much is still owed" on an invoice.
// That is ERPIntegrity.paymentSummary() (erp-integrity.js): credit notes,
// WHT receipts (settle the full total), billing-payment allocations and the
// RECONCILE_TOLERANCE rounding-dust rule all live there. Callers pass it in as
// `summarize`, so every report reads the same outstanding balance.
// ============================================================================
import { roundMoneyValue, localDateISO, parseBusinessDate, businessDaysBetween, addBusinessCalendarDays, isAbbreviatedTaxInvoice, isGeneralCustomerName, GENERAL_CUSTOMER_NAME, RECONCILE_TOLERANCE } from './erp-shared-core.js';
import { isoDateCEFromValue, toCEYear } from './erp-date-core.js';
import { isCreditNoteLive, isCreditNoteReturnReason, creditNoteProductKey } from './erp-credit-note-core.js';
import { agingBucket } from './erp-governance-core.js';

export const RECEIVABLES_CORE_VERSION = '1.0.0';

// Same term codes as the invoice form select #i-credit-term.
export const INVOICE_CREDIT_TERM_DAYS = Object.freeze({ cash: 0, deposit50: 0, credit30: 30, credit60: 60, credit90: 90, credit120: 120, credit150: 150, credit180: 180 });
// "ใกล้ครบกำหนด" window used by the dashboard alert and the analytics AR table.
export const AR_DUE_SOON_DAYS = 7;
export const WALK_IN_CUSTOMER_KEY = '__walk_in__';
export const WALK_IN_CUSTOMER_LABEL = `${GENERAL_CUSTOMER_NAME} (รวมทุกบิลหน้าร้าน)`;
export const UNKNOWN_CUSTOMER_LABEL = 'ไม่ระบุลูกค้า';

// Bucket keys are the governance-core keys (agingBucket) plus `undated` for an
// invoice whose own date is unusable, so no amount silently disappears.
export const AR_AGING_BUCKETS = Object.freeze([
  Object.freeze({ key: 'current', label: 'ยังไม่ถึงกำหนด' }),
  Object.freeze({ key: '1_30', label: '1–30 วัน' }),
  Object.freeze({ key: '31_60', label: '31–60 วัน' }),
  Object.freeze({ key: '61_90', label: '61–90 วัน' }),
  Object.freeze({ key: 'over_90', label: 'เกิน 90 วัน' }),
  Object.freeze({ key: 'undated', label: 'ไม่ระบุวันครบกำหนด' })
]);

export const DUE_BASIS_LABELS = Object.freeze({
  explicit: 'ตามวันครบกำหนดในบิล',
  term: 'คำนวณจากเครดิตการชำระ',
  cash_sale: 'ขายเงินสดหน้าร้าน — ครบกำหนดวันที่ออกบิล',
  no_term: 'ไม่ระบุเครดิต — ถือว่าครบกำหนดวันที่ออกบิล',
  none: 'ไม่มีวันที่บิลที่ถูกต้อง'
});

const arNum = value => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const arMoney = value => roundMoneyValue(arNum(value));
const arCents = value => Math.round(arMoney(value) * 100);
const arFromCents = cents => (cents === 0 ? 0 : cents / 100);
const arText = value => String(value ?? '').trim();
const arList = value => (Array.isArray(value) ? value : []);
const arObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const arHasNumber = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const arDefaultLive = record => !!record && !record.voided && !record.cancelled && !record.reversed && record.status !== 'cancelled';
const arFiniteDays = days => days !== null && days !== undefined && Number.isFinite(Number(days));

// A calendar date as 'YYYY-MM-DD' (CE), or '' when the value is not a real
// date. Accepts ISO, BE years and DD/MM/YYYY through the business-date core, so
// no raw `new Date(string)` timezone parsing is involved.
export function arBusinessIso(value) {
  if (value === null || value === undefined || value === '') return '';
  const iso = isoDateCEFromValue(value);
  if (!parseBusinessDate(iso)) return '';
  const date = String(iso).slice(0, 10);
  // isoDateCEFromValue() lets JavaScript roll an impossible day over (2026-02-30 → 2026-03-02).
  // Such a date is a typo: treat it as missing (undated) instead of silently moving it.
  const typed = arTypedDateParts(value);
  if (typed && arIsoFromParts(typed) !== date) return '';
  return date;
}

function arIsoFromParts(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

// The year/month/day exactly as typed (ISO or DD/MM/YYYY, CE or BE), or null for other shapes.
function arTypedDateParts(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  const isoMatch = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) return { year: toCEYear(Number(isoMatch[1])), month: Number(isoMatch[2]), day: Number(isoMatch[3]) };
  const dmyMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmyMatch) return { year: toCEYear(Number(dmyMatch[3])), month: Number(dmyMatch[2]), day: Number(dmyMatch[1]) };
  return null;
}

export function invoiceTermDueDate(invoiceDate, creditTerm) {
  const term = arText(creditTerm);
  if (!Object.prototype.hasOwnProperty.call(INVOICE_CREDIT_TERM_DAYS, term)) return '';
  const date = arBusinessIso(invoiceDate);
  return date ? addBusinessCalendarDays(date, INVOICE_CREDIT_TERM_DAYS[term]) : '';
}

export function isWalkInCustomerName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim() === GENERAL_CUSTOMER_NAME;
}

// Abbreviated (§86/6) invoices saved without a buyer are walk-in cash sales.
export function isWalkInInvoice(invoice) {
  return isWalkInCustomerName(invoice?.customer) || (isAbbreviatedTaxInvoice(invoice) && isGeneralCustomerName(invoice?.customer));
}

// The single due-date rule. Old records may lack dueDate / creditTerm: an
// invoice without any credit term is due on its own date (due on receipt,
// the same convention as the governance AR aging).
export function invoiceDueDateInfo(invoice = {}) {
  const explicit = arBusinessIso(invoice?.dueDate) || arBusinessIso(invoice?.paymentDueDate);
  if (explicit) return { dueDate: explicit, basis: 'explicit' };
  const byTerm = invoiceTermDueDate(invoice?.date, invoice?.creditTerm);
  if (byTerm) return { dueDate: byTerm, basis: 'term' };
  const issued = arBusinessIso(invoice?.date);
  if (!issued) return { dueDate: '', basis: 'none' };
  return { dueDate: issued, basis: isWalkInInvoice(invoice) ? 'cash_sale' : 'no_term' };
}

export function invoiceDueDate(invoice = {}) {
  return invoiceDueDateInfo(invoice || {}).dueDate;
}

// daysPastDue: positive = overdue by that many days, 0 = due today,
// negative = not yet due, null = no usable due date.
export function receivableState(daysPastDue) {
  if (!arFiniteDays(daysPastDue)) return { state: 'none', text: 'ไม่ระบุวันครบกำหนด' };
  const days = Math.trunc(Number(daysPastDue));
  if (days > 0) return { state: 'overdue', text: `เกินกำหนด ${days} วัน` };
  if (days === 0) return { state: 'dueToday', text: 'ครบกำหนดวันนี้' };
  if (-days <= AR_DUE_SOON_DAYS) return { state: 'soon', text: `ใกล้ครบกำหนด ${-days} วัน` };
  return { state: 'normal', text: `ยังไม่ครบกำหนด (อีก ${-days} วัน)` };
}

export function receivableAgingBucket(daysPastDue) {
  if (!arFiniteDays(daysPastDue)) return 'undated';
  return agingBucket(daysPastDue);
}

function arCustomerName(record = {}) {
  return arText(record.customer || record.customerName || record.client) || UNKNOWN_CUSTOMER_LABEL;
}

function arCustomerKey(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// One open item per invoice that still has money owed.
//   options.summarize(invoice) → { total, paid, credited, outstanding } — pass
//     ERPIntegrity.paymentSummary so credit notes / WHT / allocations /
//     tolerance are applied exactly once, in one place.
//   options.asOf  'YYYY-MM-DD' (default: today, local business date)
//   options.live(invoice) → false skips cancelled/voided invoices
export function buildReceivableItems(invoices = [], options = {}) {
  return buildReceivableLedger(invoices, options).items;
}

// Same walk as buildReceivableItems(), plus `credits`: invoices on which the seller owes money back
// (paymentSummary().refundDue — a credit note issued after payment). Credits are reported separately
// ("เครดิตค้างคืนลูกค้า") and never reduce the overdue buckets.
export function buildReceivableLedger(invoices = [], options = {}) {
  const summarize = typeof options.summarize === 'function'
    ? options.summarize
    : invoice => ({ total: invoice?.total, paid: invoice?.paidAmount, credited: 0, outstanding: invoice?.outstandingAmount ?? invoice?.outstanding ?? invoice?.total });
  const live = typeof options.live === 'function' ? options.live : arDefaultLive;
  const asOf = arBusinessIso(options.asOf) || localDateISO();
  const items = [];
  const credits = [];
  for (const invoice of arList(invoices)) {
    if (!arObject(invoice) || !live(invoice)) continue;
    const summary = summarize(invoice) || {};
    const outstanding = arMoney(summary.outstanding);
    const refundDue = arMoney(summary.refundDue);
    if (refundDue > RECONCILE_TOLERANCE) {
      const walkInCredit = isWalkInInvoice(invoice);
      const creditCustomer = walkInCredit ? GENERAL_CUSTOMER_NAME : arCustomerName(invoice);
      credits.push({
        id: arText(invoice.id),
        no: arText(invoice.no) || arText(invoice.id) || '-',
        branch: arText(invoice._branch || invoice.branch),
        customer: creditCustomer,
        customerKey: walkInCredit ? WALK_IN_CUSTOMER_KEY : arCustomerKey(creditCustomer),
        walkIn: walkInCredit,
        date: arBusinessIso(invoice.date),
        refundDue,
        source: invoice
      });
    }
    // Settled, fully credited or rounding dust (≤ RECONCILE_TOLERANCE) is not an open item.
    if (!(outstanding > RECONCILE_TOLERANCE)) continue;
    const due = invoiceDueDateInfo(invoice);
    const rawDays = due.dueDate ? businessDaysBetween(due.dueDate, asOf) : NaN;
    const daysPastDue = Number.isFinite(rawDays) ? rawDays : null;
    const status = receivableState(daysPastDue);
    const walkIn = isWalkInInvoice(invoice);
    const customer = walkIn ? GENERAL_CUSTOMER_NAME : arCustomerName(invoice);
    items.push({
      id: arText(invoice.id),
      no: arText(invoice.no) || arText(invoice.id) || '-',
      branch: arText(invoice._branch || invoice.branch),
      year: invoice._year ?? invoice.year ?? '',
      month: invoice._month ?? invoice.month ?? '',
      customer,
      customerKey: walkIn ? WALK_IN_CUSTOMER_KEY : arCustomerKey(customer),
      walkIn,
      date: arBusinessIso(invoice.date),
      dueDate: due.dueDate,
      dueBasis: due.basis,
      daysPastDue,
      bucket: receivableAgingBucket(daysPastDue),
      state: status.state,
      stateText: status.text,
      total: arMoney(summary.total ?? invoice.total),
      paid: arMoney(summary.paid),
      credited: arMoney(summary.credited),
      outstanding,
      source: invoice
    });
  }
  // Most overdue first; undated items last.
  const urgency = item => (item.daysPastDue === null ? -1e9 : item.daysPastDue);
  items.sort((a, b) => (urgency(b) - urgency(a)) || (b.outstanding - a.outstanding) || a.no.localeCompare(b.no));
  credits.sort((a, b) => (b.refundDue - a.refundDue) || a.no.localeCompare(b.no));
  return { items, credits };
}

function arEmptyBuckets() {
  return Object.fromEntries(AR_AGING_BUCKETS.map(bucket => [bucket.key, 0]));
}

function arBucketsFromCents(cents) {
  return Object.fromEntries(Object.entries(cents).map(([key, value]) => [key, arFromCents(value)]));
}

// Aging by customer. Walk-in cash sales are ONE aggregated row (never ranked
// as a named customer). Sums are done in satang so rows always add up exactly.
// `credits` (from buildReceivableLedger) add a separate refund-due figure per customer.
export function summarizeReceivableAging(items = [], credits = []) {
  const groups = new Map();
  const totalCents = arEmptyBuckets();
  let grandCents = 0;
  let overdueCents = 0;
  let refundCents = 0;
  let invoiceCount = 0;
  const groupFor = record => {
    const key = arText(record.customerKey) || arCustomerKey(record.customer) || UNKNOWN_CUSTOMER_LABEL;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label: record.walkIn ? WALK_IN_CUSTOMER_LABEL : (arText(record.customer) || UNKNOWN_CUSTOMER_LABEL),
        walkIn: !!record.walkIn,
        cents: arEmptyBuckets(),
        totalCents: 0,
        overdueCents: 0,
        refundCents: 0,
        oldestDaysPastDue: null,
        items: [],
        credits: []
      };
      groups.set(key, group);
    }
    return group;
  };
  for (const item of arList(items)) {
    if (!arObject(item)) continue;
    const cents = arCents(item.outstanding);
    if (cents <= 0) continue;
    const bucket = Object.prototype.hasOwnProperty.call(totalCents, item.bucket) ? item.bucket : 'undated';
    const group = groupFor(item);
    group.cents[bucket] += cents;
    group.totalCents += cents;
    totalCents[bucket] += cents;
    grandCents += cents;
    invoiceCount += 1;
    if (item.state === 'overdue') {
      group.overdueCents += cents;
      overdueCents += cents;
    }
    if (Number.isFinite(item.daysPastDue) && (group.oldestDaysPastDue === null || item.daysPastDue > group.oldestDaysPastDue)) {
      group.oldestDaysPastDue = item.daysPastDue;
    }
    group.items.push(item);
  }
  for (const credit of arList(credits)) {
    if (!arObject(credit)) continue;
    const cents = arCents(credit.refundDue);
    if (cents <= 0) continue;
    const group = groupFor(credit);
    group.refundCents += cents;
    refundCents += cents;
    group.credits.push(credit);
  }
  const rows = [...groups.values()]
    .map(group => ({
      key: group.key,
      label: group.label,
      walkIn: group.walkIn,
      invoiceCount: group.items.length,
      buckets: arBucketsFromCents(group.cents),
      total: arFromCents(group.totalCents),
      overdue: arFromCents(group.overdueCents),
      oldestDaysPastDue: group.oldestDaysPastDue,
      refundDue: arFromCents(group.refundCents),
      items: group.items,
      credits: group.credits
    }))
    .sort((a, b) => (b.overdue - a.overdue) || (b.total - a.total) || a.label.localeCompare(b.label, 'th'));
  return {
    rows,
    totals: {
      buckets: arBucketsFromCents(totalCents),
      total: arFromCents(grandCents),
      overdue: arFromCents(overdueCents),
      invoiceCount,
      // Customers who owe money (a refund-only row is not a debtor).
      customerCount: rows.filter(row => !row.walkIn && row.total > 0).length,
      walkInInvoiceCount: rows.filter(row => row.walkIn).reduce((sum, row) => sum + row.invoiceCount, 0),
      refundDue: arFromCents(refundCents)
    },
    hasUndated: totalCents.undated > 0,
    hasRefunds: refundCents > 0
  };
}

// Figures for the dashboard banner / navigation badge.
// Short stable hash (djb2) so the dismiss signature stays compact for many invoices.
function arHash(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

export function receivableAlertSummary(items = []) {
  const overdueKeys = [];
  const dueSoonKeys = [];
  let overdueCount = 0;
  let overdueCents = 0;
  let dueSoonCount = 0;
  let dueSoonCents = 0;
  let oldestDaysPastDue = 0;
  for (const item of arList(items)) {
    if (!arObject(item)) continue;
    const cents = arCents(item.outstanding);
    if (cents <= 0) continue;
    const invoiceKey = `${arText(item.branch)}|${arText(item.id)}|${arText(item.no)}`;
    if (item.state === 'overdue') {
      overdueCount += 1;
      overdueCents += cents;
      overdueKeys.push(invoiceKey);
      if (Number.isFinite(item.daysPastDue) && item.daysPastDue > oldestDaysPastDue) oldestDaysPastDue = item.daysPastDue;
    } else if (item.state === 'dueToday' || item.state === 'soon') {
      dueSoonCount += 1;
      dueSoonCents += cents;
      dueSoonKeys.push(invoiceKey);
    }
  }
  return {
    overdueCount,
    overdueTotal: arFromCents(overdueCents),
    dueSoonCount,
    dueSoonTotal: arFromCents(dueSoonCents),
    oldestDaysPastDue,
    // Changes whenever any alert figure OR the set of overdue / due-soon invoices changes, so a
    // dismissed banner reappears for a genuinely new overdue invoice even if the totals are equal.
    signature: `${overdueCount}|${overdueCents}|${dueSoonCount}|${dueSoonCents}|${arHash(overdueKeys.sort().join(','))}|${arHash(dueSoonKeys.sort().join(','))}`
  };
}

// CSV (UTF-8 via downloadCsvText): one row per open invoice + a grand total.
export function receivableAgingCsvRows(summary = {}, options = {}) {
  const formatDate = typeof options.formatDate === 'function' ? options.formatDate : value => value;
  const branchLabel = typeof options.branchLabel === 'function' ? options.branchLabel : value => value;
  const buckets = AR_AGING_BUCKETS.filter(bucket => bucket.key !== 'undated' || summary?.hasUndated);
  const refunds = !!summary?.hasRefunds;
  const refundColumn = value => (refunds ? [value] : []);
  const header = ['ลูกค้า', 'เลขที่บิล', 'สาขา', 'วันที่บิล', 'วันครบกำหนด', 'เกณฑ์วันครบกำหนด', 'เกินกำหนด (วัน)', ...buckets.map(bucket => bucket.label), 'ค้างรับรวม', ...refundColumn('เครดิตค้างคืนลูกค้า')];
  const rows = [header];
  for (const row of arList(summary?.rows)) {
    for (const item of arList(row.items)) {
      rows.push([
        row.label,
        item.no,
        branchLabel(item.branch),
        item.date ? formatDate(item.date) : '',
        item.dueDate ? formatDate(item.dueDate) : '',
        DUE_BASIS_LABELS[item.dueBasis] || '',
        item.daysPastDue !== null && item.daysPastDue > 0 ? item.daysPastDue : 0,
        ...buckets.map(bucket => (item.bucket === bucket.key ? item.outstanding : 0)),
        item.outstanding,
        ...refundColumn(0)
      ]);
    }
    // Refund-due invoices: only the refund column carries money.
    for (const credit of arList(row.credits)) {
      rows.push([row.label, credit.no, branchLabel(credit.branch), credit.date ? formatDate(credit.date) : '', '', 'เครดิตค้างคืนลูกค้า', 0, ...buckets.map(() => 0), 0, ...refundColumn(credit.refundDue)]);
    }
  }
  const totals = summary?.totals?.buckets || arEmptyBuckets();
  rows.push(['รวมทั้งหมด', '', '', '', '', '', '', ...buckets.map(bucket => arMoney(totals[bucket.key])), arMoney(summary?.totals?.total), ...refundColumn(arMoney(summary?.totals?.refundDue))]);
  return rows;
}

// Largest-remainder split of `total` (money) in proportion to `weights`; the
// parts always add up to roundMoneyValue(total) exactly (in satang). Weights
// may be signed (a legacy discount line is a negative item); when they sum to
// zero the total is split equally.
export function allocateMoneyByWeights(total, weights = []) {
  const list = arList(weights);
  const count = list.length;
  if (!count) return [];
  const totalCents = arCents(total);
  const clean = list.map(arNum);
  const weightSum = clean.reduce((sum, weight) => sum + weight, 0);
  const usable = Number.isFinite(weightSum) && Math.abs(weightSum) > 1e-12;
  const raw = usable ? clean.map(weight => totalCents * weight / weightSum) : clean.map(() => totalCents / count);
  // Tiny epsilon before flooring absorbs binary noise such as 99.99999999998.
  const cents = raw.map(share => Math.floor(share + 1e-9));
  let remainder = totalCents - cents.reduce((sum, cent) => sum + cent, 0);
  const order = raw
    .map((share, index) => ({ index, fraction: share - cents[index] }))
    .sort((a, b) => (b.fraction - a.fraction) || (a.index - b.index));
  // Hand the leftover satang to the largest fractions (or take them back from the smallest).
  for (let i = 0; remainder > 0; i = (i + 1) % count, remainder -= 1) cents[order[i].index] += 1;
  for (let i = count - 1; remainder < 0; i = (i + count - 1) % count, remainder += 1) cents[order[i].index] -= 1;
  return cents.map(cent => (cent === 0 ? 0 : cent / 100));
}

// Shares of a document's pre-VAT sales (`rowTotal`) across its item lines, for the analytics
// product breakdown. Item totals are scaled to the pre-VAT figure only when that is safe: every
// line has the same sign and the scale factor is sane (0 < factor ≤ 2; VAT-inclusive lines give
// a factor just below 1, a document discount < 1). Otherwise (e.g. items 1,000 and a −990 discount on a 50
// document, factor 5) the raw line values are kept and `remainder` carries the difference, so the
// product figures still add up to the document without inflating any line.
export function itemSharesForRow(rowTotal, values = []) {
  const list = arList(values).map(arNum);
  const total = arMoney(rowTotal);
  const explicitTotal = list.reduce((sum, value) => sum + value, 0);
  if (!list.length) return { shares: [], remainder: total };
  if (explicitTotal === 0) return { shares: allocateMoneyByWeights(total, list.map(() => 1)), remainder: 0 };
  if (total === 0) return { shares: list.map(value => arMoney(value)), remainder: 0 };
  const sameSign = list.every(value => value >= 0) || list.every(value => value <= 0);
  const factor = total / explicitTotal;
  if (sameSign && factor > 0 && factor <= 2) return { shares: allocateMoneyByWeights(total, list), remainder: 0 };
  const shares = list.map(value => arMoney(value));
  const remainder = arMoney(total - shares.reduce((sum, value) => sum + value, 0));
  return { shares, remainder };
}

// Keeps only credit-note rows whose ORIGINAL invoice is linked to a live production order, i.e. to
// sales the production-based sales target actually counted (see the credit-note rows'
// sourceProduction* / sourceSalesOrderId fields). A note on a direct invoice never reduces it.
export function creditRowsOnProductionSales(creditRows = [], productions = []) {
  const live = arList(productions).filter(arObject).filter(arDefaultLive);
  return arList(creditRows).filter(row => live.some(production => {
    if (arText(production._branch || production.branch) !== arText(row.invoiceBranch || row._branch || row.branch)) return false;
    if (row.sourceProductionId && arText(production.id) === arText(row.sourceProductionId)) return true;
    if (row.sourceProductionNo && arText(production.no) === arText(row.sourceProductionNo)) return true;
    return !!row.sourceSalesOrderId && arText(production.sourceSalesOrderId) === arText(row.sourceSalesOrderId);
  }));
}

// Same per-item sales figure the analytics item breakdown uses.
export function salesItemValue(item = {}) {
  return arNum(item.saleTotal || item.total || (arNum(item.qty) * arNum(item.priceUnit || item.saleValue || item.price)));
}

function arItemUnitCost(item = {}) {
  const qty = arNum(item.qty);
  if (arHasNumber(item.costTotal) && qty > 0) return arNum(item.costTotal) / qty;
  return arNum(item.costUnit);
}

function arReturnMatchesLine(returnItem = {}, line = {}, creditNote = {}) {
  const returnBranch = arText(returnItem.invoiceBranch);
  const lineBranch = arText(line.invoiceBranch || creditNote.branch);
  if (returnBranch && lineBranch && returnBranch !== lineBranch) return false;
  const returnId = arText(returnItem.invoiceId);
  const lineId = arText(line.invoiceId);
  if (returnId && lineId) return returnId === lineId;
  const returnNo = arText(returnItem.invoiceNo);
  const lineNo = arText(line.invoiceNo);
  return !!returnNo && returnNo === lineNo;
}

// Spreads one credit-note line (pre-VAT `value`) over the invoice's items.
//   * "returned goods" notes with return items: weight = returned qty × the
//     invoice unit price of that product, so the credit lands on the returned
//     products, and the returned qty × invoice unit cost is reversed from cost;
//   * any other note: weight = each item's share of the invoice value.
function arCreditItems(invoice, creditNote, line, value) {
  const items = arList(invoice?.items).filter(arObject);
  if (!items.length) return { items: [], returnedCost: 0 };
  // Returned quantity per product key for THIS invoice line.
  const returnedByKey = new Map();
  if (isCreditNoteReturnReason(creditNote.reasonCode)) {
    for (const returnItem of arList(creditNote.returnItems)) {
      if (!arObject(returnItem) || !arReturnMatchesLine(returnItem, line, creditNote)) continue;
      const key = creditNoteProductKey(returnItem);
      if (key) returnedByKey.set(key, (returnedByKey.get(key) || 0) + Math.max(0, arNum(returnItem.qty)));
    }
  }
  // Hand the returned quantity to invoice items of the same product, in order, never more than each item's qty.
  const returned = items.map(item => {
    const key = creditNoteProductKey(item);
    const left = returnedByKey.get(key) || 0;
    const take = Math.min(left, Math.max(0, arNum(item.qty)));
    if (take > 0) returnedByKey.set(key, left - take);
    return take;
  });
  const values = items.map(salesItemValue);
  const returnWeights = items.map((item, index) => {
    const qty = arNum(item.qty);
    return returned[index] > 0 && qty > 0 ? returned[index] * (values[index] / qty) : 0;
  });
  const useReturns = returnWeights.some(weight => weight > 0);
  const shares = allocateMoneyByWeights(value, useReturns ? returnWeights : values);
  let returnedCost = 0;
  const out = [];
  items.forEach((item, index) => {
    const cost = returned[index] * arItemUnitCost(item);
    returnedCost += cost;
    if (!shares[index] && !(returned[index] > 0)) return;
    out.push({
      product: arText(item.product || item.name) || 'ไม่ระบุสินค้า',
      productCode: arText(item.productCode || item.code),
      productCategory: arText(item.productCategory || item.category),
      unit: arText(item.unit),
      qty: returned[index] > 0 ? -returned[index] : 0,
      saleTotal: shares[index] ? -shares[index] : 0,
      costTotal: cost > 0 ? -arMoney(cost) : 0
    });
  });
  return { items: out, returnedCost: arMoney(returnedCost) };
}

const AR_AGENCY_FIELDS = Object.freeze(['customerAgencyGroup', 'customerAgencyType', 'customerAgencyGroupLabel', 'customerAgencyTypeLabel', 'customerPrefix']);

// Negative "sales rows" that net live credit notes out of the customer /
// product / salesperson / agency breakdowns — in the credit note's OWN period
// (callers pass notes that carry _branch/_year/_month of the pack they were
// read from), consistent with the dashboard tiles. The document's pre-VAT
// `subtotal` (the figure the tiles subtract) is split over its invoice lines by
// each line's difference, so the rows always add up to the tiles exactly.
// Each row is attributed to the ORIGINAL invoice's customer and salesperson
// (a walk-in note nets against the walk-in row even if a buyer name was typed).
//   resolveInvoice({branch, invoiceId, invoiceNo}, creditNote) → invoice | null
export function buildCreditNoteSalesAdjustments(creditNotes = [], resolveInvoice = () => null) {
  const rows = [];
  for (const creditNote of arList(creditNotes)) {
    if (!arObject(creditNote) || !isCreditNoteLive(creditNote)) continue;
    const documentValue = arMoney(creditNote.subtotal);
    if (!documentValue) continue;
    const lines = arList(creditNote.lines).filter(arObject);
    const targets = lines.length ? lines : [{}];
    const shares = allocateMoneyByWeights(documentValue, lines.length ? lines.map(line => arNum(line.difference)) : [1]);
    targets.forEach((line, index) => {
      const value = shares[index];
      if (!value) return;
      const hasReference = !!(arText(line.invoiceId) || arText(line.invoiceNo));
      const found = hasReference
        ? resolveInvoice({ branch: arText(line.invoiceBranch || creditNote.branch || creditNote._branch), invoiceId: arText(line.invoiceId), invoiceNo: arText(line.invoiceNo) }, creditNote)
        : null;
      const invoice = arObject(found) ? found : null;
      const spread = arCreditItems(invoice, creditNote, line, value);
      const agencySource = invoice || creditNote;
      const agency = {};
      AR_AGENCY_FIELDS.forEach(field => {
        if (arText(agencySource[field])) agency[field] = agencySource[field];
      });
      const branch = arText(creditNote._branch || creditNote.branch);
      rows.push({
        ...agency,
        _type: 'creditNotes',
        _creditAdjustment: true,
        id: `${arText(creditNote.id) || arText(creditNote.no)}#${index}`,
        no: arText(creditNote.no),
        creditNoteId: arText(creditNote.id),
        invoiceNo: arText(line.invoiceNo || invoice?.no),
        invoiceId: arText(line.invoiceId || invoice?.id),
        invoiceBranch: arText(invoice?._branch || invoice?.branch || line.invoiceBranch || branch),
        // Links of the original invoice to the production / sales order it delivered.
        sourceProductionId: arText(invoice?.sourceProductionId),
        sourceProductionNo: arText(invoice?.sourceProductionNo),
        sourceSalesOrderId: arText(invoice?.sourceSalesOrderId),
        reasonCode: arText(creditNote.reasonCode),
        date: arText(creditNote.date),
        branch,
        _branch: branch,
        _year: creditNote._year ?? '',
        _month: creditNote._month ?? '',
        customer: arText(invoice?.customer) || arText(creditNote.customer) || UNKNOWN_CUSTOMER_LABEL,
        salesPerson: arText(invoice?.salesPerson) || arText(creditNote.salesPerson),
        product: arText(invoice?.product),
        job: arText(invoice?.job),
        items: spread.items,
        subtotal: -value,
        total: -value,
        costTotal: spread.returnedCost ? -spread.returnedCost : 0,
        commAmt: 0,
        // Revenue given back, partly offset by the cost of goods that came back to stock.
        profit: arMoney(spread.returnedCost - value)
      });
    });
  }
  return rows;
}

// Branch P&L figures for the dashboard comparison. Gross profit = sales − cost
// of goods (commission and expenses are operating costs below gross profit).
// Margins are null (shown as "—") when sales are not positive.
export function branchProfitSummary(input = {}) {
  const sales = arMoney(input.sales);
  const cost = arMoney(input.cost);
  const commission = arMoney(input.commission);
  const expenses = arMoney(input.expenses);
  const grossProfit = arMoney(sales - cost);
  const net = arMoney(sales - cost - commission - expenses);
  const ratio = value => (sales > 0 ? roundMoneyValue(value / sales * 100) : null);
  return { sales, cost, commission, expenses, grossProfit, grossMargin: ratio(grossProfit), net, netMargin: ratio(net) };
}

export function formatMarginPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return `${Number(value).toFixed(1)}%`;
}
