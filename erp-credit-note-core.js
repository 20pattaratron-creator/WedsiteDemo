// ============================================================================
// erp-credit-note-core.js — pure Credit Note (ใบลดหนี้) business rules
// ERP DEMO 4.3.1 — DOM/storage free, unit-testable.
//
// Legal basis (Revenue Code §86/10 and RD Order Por.80/2542): a VAT-registered
// seller that already issued a tax invoice may issue a credit note when the
// value decreases (defective / non-conforming goods, price overcharge, goods
// returned under a trade agreement, service cancelled because of deficient
// service, or another case the Director-General allows). The credit note must
// show the original tax invoice number(s), the original value, the correct
// value, the difference and the VAT on the difference, plus a short reason.
// One credit note may reference several tax invoices of the same customer. It
// belongs to the tax month in which it is issued (its own date), not to the
// month of the original invoice.
//
// Amount conventions used throughout this module:
//   * "value"  = pre-VAT money (มูลค่าก่อนภาษี) — what §86/10 prints per invoice.
//   * "amount" = money in the ORIGINAL invoice's price basis, i.e. the number
//                the user sees on that invoice: pre-VAT for vatMode 'add' and
//                'none', VAT-inclusive for vatMode 'extract'. Keeping the same
//                basis as the original invoice means the credit note re-uses
//                exactly the calculateVatSummary() mode the invoice used.
//   * "total"  = VAT-inclusive money (what the customer owes / is owed).
//
// The authoritative user input per referenced invoice is `differenceAmount`
// (the reduction, in the invoice's price basis). The "correct value" is derived
// from it. Storing the reduction (not the correct value) means that if another
// credit note is issued against the same invoice in the meantime, re-validation
// flags the now-excessive cumulative reduction instead of silently changing how
// much this document reduces.
//
// VAT on the difference is computed ONCE from the document-level difference
// (RD "total-first" practice, same as calculateDocumentTotals()), and then
// allocated back to each referenced invoice with the largest-remainder method
// so that the per-invoice rows always sum exactly to the document totals.
// ============================================================================
import { roundMoneyValue, calculateVatSummary, parseBusinessDate, compareBusinessDates, fmt, RECONCILE_TOLERANCE, taxInvoiceLacksBuyer, isGeneralCustomerName } from './erp-shared-core.js';

export const CREDIT_NOTE_CORE_VERSION = '1.0.0';
export const CREDIT_NOTE_NUMBER_PREFIX = 'CN';
export const CREDIT_NOTE_COLLECTION = 'creditNotes';
export const CREDIT_NOTE_RETURN_REASON = 'returned_goods';
export const CREDIT_NOTE_OTHER_REASON = 'other';

export const CREDIT_NOTE_REASONS = Object.freeze([
  Object.freeze({ code: 'defective_goods', label: 'สินค้าชำรุดเสียหาย / ขาดจำนวน / ไม่ตรงตามตัวอย่างหรือคุณภาพที่ตกลงกัน' }),
  Object.freeze({ code: 'price_overcharge', label: 'คำนวณราคาสินค้าหรือค่าบริการผิดพลาดสูงกว่าที่เป็นจริง' }),
  Object.freeze({ code: CREDIT_NOTE_RETURN_REASON, label: 'รับคืนสินค้าตามข้อตกลงทางการค้า' }),
  Object.freeze({ code: 'service_cancelled', label: 'ยกเลิกสัญญาบริการ / ลดค่าบริการเนื่องจากบริการบกพร่องหรือไม่ครบถ้วน' }),
  Object.freeze({ code: CREDIT_NOTE_OTHER_REASON, label: 'เหตุอื่น (โปรดระบุรายละเอียด)' })
]);

export const CREDIT_NOTE_VAT_MODE_LABELS = Object.freeze({
  extract: 'ราคารวม VAT แล้ว — แยกภาษี',
  add: 'ราคายังไม่รวม VAT — บวกเพิ่ม 7%',
  none: 'ไม่มี VAT'
});

// Shared tolerance: a satang of rounding drift between independently rounded
// documents is not a real over-credit.
const CREDIT_NOTE_TOLERANCE = RECONCILE_TOLERANCE;
const CREDIT_NOTE_VAT_USE = Object.freeze({ add: 1, extract: 0, none: 2 });

const creditNoteFinite = value => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const creditNoteMoney = value => roundMoneyValue(creditNoteFinite(value));
const creditNoteText = value => String(value ?? '').trim();
const creditNoteNorm = value => creditNoteText(value).toLowerCase();
const creditNoteBranchOf = record => creditNoteText(record?.branch ?? record?._branch ?? '');

// Parses a user-entered money value. Unlike creditNoteMoney() an empty or
// non-numeric entry is NaN (missing), never 0 — a blank field must not be read
// as "reduce by nothing" or "correct value is zero".
export function creditNoteParseAmount(value) {
  if (value === null || value === undefined) return NaN;
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const text = String(value).replace(/,/g, '').trim();
  if (!text) return NaN;
  const n = Number(text);
  return Number.isFinite(n) ? n : NaN;
}

export function creditNoteReasonLabel(code) {
  const row = CREDIT_NOTE_REASONS.find(reason => reason.code === code);
  return row ? row.label : '';
}

export function isCreditNoteReturnReason(code) {
  return code === CREDIT_NOTE_RETURN_REASON;
}

export function isCreditNoteLive(record) {
  return !!record && !record.voided && !record.cancelled && record.status !== 'voided' && record.status !== 'cancelled';
}

export function creditNoteStatusLabel(record) {
  return isCreditNoteLive(record) ? 'ใช้งาน' : 'ยกเลิกแล้ว';
}

// A tax invoice that still counts (not voided / cancelled / reversed) — also used by the VAT
// reports (erp-tax-reports-core.js), so "live" means the same thing in every output-VAT figure.
export function creditNoteInvoiceLive(invoice) {
  return !!invoice && !invoice.voided && !invoice.cancelled && !invoice.reversed && invoice.status !== 'cancelled' && invoice.documentStatus !== 'cancelled';
}

// Same resolution rule as app.js resolveVatMode(): explicit vatMode wins,
// otherwise infer from the stored VAT amount / useVat flag.
export function creditNoteVatModeOf(invoice = {}) {
  if (invoice.vatMode === 'add' || invoice.vatMode === 'extract' || invoice.vatMode === 'none') return invoice.vatMode;
  if (creditNoteFinite(invoice.vatAmt) > 0) return Number(invoice.useVat || 0) === 1 ? 'add' : 'extract';
  return 'none';
}

function creditNoteNormalizeVatMode(mode) {
  return mode === 'add' || mode === 'extract' || mode === 'none' ? mode : 'none';
}

// The money of an original invoice in every basis the credit note needs.
export function creditNoteInvoiceBasis(invoice = {}) {
  const vatMode = creditNoteVatModeOf(invoice);
  const has = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const total = creditNoteMoney(has(invoice.total) ? invoice.total : has(invoice.saleTotal) ? invoice.saleTotal : invoice.subtotal);
  let value;
  if (has(invoice.subtotal)) value = creditNoteMoney(invoice.subtotal);
  else if (vatMode === 'none') value = total;
  else value = creditNoteMoney(total - creditNoteMoney(invoice.vatAmt));
  const amount = vatMode === 'extract' ? total : value;
  return { vatMode, amount, value, vat: creditNoteMoney(total - value), total };
}

export function creditNoteLineMatchesInvoice(line = {}, creditNote = {}, invoice = {}) {
  const lineBranch = creditNoteText(line?.invoiceBranch || creditNote?.branch || '');
  const invoiceBranch = creditNoteBranchOf(invoice);
  if (lineBranch && invoiceBranch && lineBranch !== invoiceBranch) return false;
  const lineId = creditNoteText(line?.invoiceId);
  const invoiceId = creditNoteText(invoice?.id);
  if (lineId && invoiceId) return lineId === invoiceId;
  const lineNo = creditNoteText(line?.invoiceNo);
  const invoiceNo = creditNoteText(invoice?.no);
  return !!lineNo && !!invoiceNo && lineNo === invoiceNo;
}

// Finds the referenced invoice. An id reference is authoritative (a missing id
// never falls back to "any invoice with the same number"); a number-only
// reference must be unique inside the branch.
export function findCreditNoteInvoice(reference = {}, invoices = []) {
  const rows = Array.isArray(invoices) ? invoices : [];
  const branch = creditNoteText(reference?.invoiceBranch || reference?.branch || '');
  const id = creditNoteText(reference?.invoiceId);
  const no = creditNoteText(reference?.invoiceNo);
  const candidates = rows.filter(invoice => !branch || creditNoteBranchOf(invoice) === branch);
  if (id) {
    const byId = candidates.filter(invoice => creditNoteText(invoice?.id) === id);
    return byId.length === 1 ? byId[0] : null;
  }
  if (!no) return null;
  const byNo = candidates.filter(invoice => creditNoteText(invoice?.no) === no);
  return byNo.length === 1 ? byNo[0] : null;
}

// Total already credited against one invoice by live credit notes.
// `options.excludeCreditNoteId` removes the credit note being edited;
// `options.matches(line, creditNote, invoice)` lets the reconciliation layer use
// its alias-aware matcher while keeping one summation implementation.
export function creditedByInvoice(invoice = {}, creditNotes = [], options = {}) {
  const exclude = creditNoteText(options.excludeCreditNoteId);
  const matches = typeof options.matches === 'function' ? options.matches : creditNoteLineMatchesInvoice;
  let amount = 0, value = 0, vat = 0, total = 0;
  const documents = [];
  for (const creditNote of Array.isArray(creditNotes) ? creditNotes : []) {
    if (!isCreditNoteLive(creditNote)) continue;
    if (exclude && creditNoteText(creditNote.id) === exclude) continue;
    for (const line of Array.isArray(creditNote.lines) ? creditNote.lines : []) {
      if (!matches(line, creditNote, invoice)) continue;
      amount += creditNoteFinite(line.differenceAmount);
      value += creditNoteFinite(line.difference);
      vat += creditNoteFinite(line.vatOnDifference);
      total += creditNoteFinite(line.total);
      documents.push({ id: creditNote.id, no: creditNote.no || '', date: creditNote.date || '', total: creditNoteMoney(line.total) });
    }
  }
  return { amount: creditNoteMoney(amount), value: creditNoteMoney(value), vat: creditNoteMoney(vat), total: creditNoteMoney(total), count: documents.length, creditNotes: documents };
}

// Over-credit rule shared by validateCreditNote() (one new note) and
// creditNoteLedgerIssues() (the whole ledger after a backup import).
// Amounts are the user's own 2-decimal figures, so the basis check is exact;
// VAT-inclusive totals, pre-VAT values and VAT carry per-document rounding and
// get the satang tolerance. Only the figures present in `cumulative` are checked.
function creditNoteOverInvoice(cumulative, invoice) {
  const above = (key, tolerance) => cumulative[key] !== undefined && cumulative[key] > invoice[key] + tolerance;
  return { amount: above('amount', 0), total: above('total', CREDIT_NOTE_TOLERANCE), value: above('value', CREDIT_NOTE_TOLERANCE), vat: above('vat', CREDIT_NOTE_TOLERANCE) };
}

// Largest-remainder allocation of a document total (in satang) across rows so
// the rows always add up to the document figure exactly.
function creditNoteAllocate(total, weights) {
  const count = weights.length;
  if (!count) return [];
  // An all-negative draft (user typed a correct value above the original) is shown
  // symmetrically while typing; validation rejects it before anything is saved.
  if (creditNoteMoney(total) < 0 && weights.every(weight => creditNoteFinite(weight) <= 0)) {
    return creditNoteAllocate(-creditNoteMoney(total), weights.map(weight => -creditNoteFinite(weight))).map(share => (share === 0 ? 0 : -share));
  }
  const totalCents = Math.round(creditNoteMoney(total) * 100);
  const cleanWeights = weights.map(weight => Math.max(0, creditNoteFinite(weight)));
  const weightSum = cleanWeights.reduce((sum, weight) => sum + weight, 0);
  const cents = new Array(count).fill(0);
  if (!(weightSum > 0)) {
    cents[count - 1] = totalCents;
    return cents.map(cent => cent / 100);
  }
  const raw = cleanWeights.map(weight => totalCents * weight / weightSum);
  // Tiny epsilon before flooring absorbs binary noise such as 99.99999999998.
  raw.forEach((share, index) => { cents[index] = Math.floor(share + 1e-9); });
  let remainder = totalCents - cents.reduce((sum, cent) => sum + cent, 0);
  const order = raw.map((share, index) => ({ index, fraction: share - cents[index] }))
    .sort((a, b) => (b.fraction - a.fraction) || (a.index - b.index));
  for (let i = 0; remainder > 0 && i < order.length; i += 1, remainder -= 1) cents[order[i].index] += 1;
  return cents.map(cent => cent / 100);
}

function creditNoteInvoicePeriod(invoice = {}) {
  const year = invoice._year ?? invoice.year ?? '';
  const month = invoice._month ?? invoice.month ?? '';
  return { year: year === '' ? '' : Number(year), month: month === '' ? '' : Number(month) };
}

// lines: [{ invoice, differenceAmount | correctAmount, priorCredited: {amount,value,total} }]
// vatMode: optional; defaults to the first referenced invoice's mode.
export function calculateCreditNote(input = {}) {
  const rawLines = Array.isArray(input.lines) ? input.lines : [];
  const prepared = rawLines.map(line => {
    const invoice = line?.invoice || {};
    const basis = creditNoteInvoiceBasis(invoice);
    const prior = line?.priorCredited || {};
    const priorCreditedAmount = creditNoteMoney(prior.amount);
    const priorCreditedValue = creditNoteMoney(prior.value);
    const priorCreditedTotal = creditNoteMoney(prior.total);
    // Older callers may pass only {amount,value,total}: VAT already credited = total − value.
    const priorCreditedVat = creditNoteMoney(prior.vat ?? (priorCreditedTotal - priorCreditedValue));
    const originalAmount = creditNoteMoney(basis.amount - priorCreditedAmount);
    const originalValue = creditNoteMoney(basis.value - priorCreditedValue);
    const originalVat = creditNoteMoney(basis.vat - priorCreditedVat);
    let reduction = creditNoteParseAmount(line?.differenceAmount);
    if (!Number.isFinite(reduction)) {
      const correct = creditNoteParseAmount(line?.correctAmount);
      reduction = Number.isFinite(correct) ? originalAmount - correct : NaN;
    }
    const missing = !Number.isFinite(reduction);
    const differenceAmount = missing ? 0 : creditNoteMoney(reduction);
    const period = creditNoteInvoicePeriod(invoice);
    return {
      invoiceId: creditNoteText(invoice.id),
      invoiceNo: creditNoteText(invoice.no),
      invoiceBranch: creditNoteBranchOf(invoice),
      invoiceYear: period.year,
      invoiceMonth: period.month,
      invoiceDate: creditNoteText(invoice.date),
      vatMode: basis.vatMode,
      invoiceAmount: basis.amount,
      invoiceValue: basis.value,
      invoiceVat: basis.vat,
      invoiceTotal: basis.total,
      priorCreditedAmount,
      priorCreditedValue,
      priorCreditedTotal,
      priorCreditedVat,
      originalAmount,
      originalValue,
      originalVat,
      differenceAmount,
      correctAmount: missing ? null : creditNoteMoney(originalAmount - differenceAmount),
      missing
    };
  });
  const vatMode = creditNoteNormalizeVatMode(input.vatMode || prepared[0]?.vatMode || 'none');
  const documentDifferenceAmount = creditNoteMoney(prepared.reduce((sum, line) => sum + line.differenceAmount, 0));
  // How the two rounding rules fit together:
  //  1. "Final" line — the reduction takes the invoice's WHOLE remaining amount.
  //     Its pre-VAT difference and VAT are pinned to exactly what is left on the
  //     invoice (value − value already credited, VAT − VAT already credited), so a
  //     full credit can never exceed the invoice by a satang and the last of many
  //     partial credit notes absorbs the per-note rounding drift of the earlier ones.
  //  2. All other lines — VAT is computed ONCE on their combined difference (RD
  //     total-first), then shared back by largest remainder and clamped so no line
  //     credits more pre-VAT value or more VAT than is left on its invoice.
  // Document totals are the sum of the lines; when no line is final and no clamp
  // bites (the normal case) that equals calculateVatSummary() of the document total.
  const isFinal = line => !line.missing && line.originalAmount > 0 && line.differenceAmount === line.originalAmount;
  const rest = prepared.map((line, index) => ({ line, index })).filter(({ line }) => !isFinal(line));
  const restAmount = creditNoteMoney(rest.reduce((sum, { line }) => sum + line.differenceAmount, 0));
  const restSummary = calculateVatSummary(restAmount, CREDIT_NOTE_VAT_USE[vatMode]);
  const weights = rest.map(({ line }) => line.differenceAmount);
  // 'extract': the user's amounts are VAT-inclusive, so the row total is exact and the
  // pre-VAT value is the shared figure. 'add'/'none': the value is exact and the
  // VAT-inclusive total is the shared figure.
  const shared = creditNoteAllocate(vatMode === 'extract' ? restSummary.subtotal : restSummary.total, weights);
  const bounds = rest.map(({ line }) => {
    if (!(line.differenceAmount > 0)) return null; // invalid draft: shown as-is, rejected by validation
    const remainingVat = Math.max(0, line.originalVat);
    if (vatMode === 'extract') {
      const hi = Math.min(line.differenceAmount, Math.max(0, line.originalValue));
      return { lo: Math.min(hi, creditNoteMoney(line.differenceAmount - remainingVat)), hi };
    }
    return { lo: line.differenceAmount, hi: creditNoteMoney(line.differenceAmount + (vatMode === 'none' ? 0 : remainingVat)) };
  });
  const clamped = creditNoteRebalance(shared, bounds);
  const figures = new Array(prepared.length);
  rest.forEach(({ line, index }, position) => {
    const sharedValue = clamped[position];
    figures[index] = vatMode === 'extract' ? { difference: sharedValue, total: line.differenceAmount } : { difference: line.differenceAmount, total: sharedValue };
  });
  prepared.forEach((line, index) => {
    if (!isFinal(line)) return;
    const vat = vatMode === 'none' ? 0 : line.originalVat;
    figures[index] = { difference: line.originalValue, total: creditNoteMoney(line.originalValue + vat) };
  });
  const lines = prepared.map((line, index) => {
    const { difference, total } = figures[index];
    const { missing, ...rest } = line;
    return {
      ...rest,
      correctValue: missing ? null : creditNoteMoney(line.originalValue - difference),
      difference: creditNoteMoney(difference),
      vatOnDifference: creditNoteMoney(total - difference),
      total: creditNoteMoney(total)
    };
  });
  const subtotal = creditNoteMoney(lines.reduce((sum, line) => sum + line.difference, 0));
  const vatAmt = creditNoteMoney(lines.reduce((sum, line) => sum + line.vatOnDifference, 0));
  return {
    vatMode,
    lines,
    originalValue: creditNoteMoney(lines.reduce((sum, line) => sum + line.originalValue, 0)),
    correctValue: creditNoteMoney(lines.reduce((sum, line) => sum + (line.correctValue ?? line.originalValue), 0)),
    differenceAmount: documentDifferenceAmount,
    subtotal,
    vatAmt,
    total: creditNoteMoney(subtotal + vatAmt),
    missingInput: prepared.some(line => line.missing)
  };
}

// Clamps each shared figure into its [lo, hi] satang range and moves the clipped
// satang to rows that still have room, so the rows keep their sum whenever that is
// feasible (null bounds = unconstrained row).
function creditNoteRebalance(values, bounds) {
  const cents = values.map(value => Math.round(creditNoteMoney(value) * 100));
  const lo = bounds.map(bound => (bound ? Math.round(bound.lo * 100) : -Infinity));
  const hi = bounds.map(bound => (bound ? Math.round(bound.hi * 100) : Infinity));
  let excess = 0;
  cents.forEach((cent, index) => {
    if (cent > hi[index]) { excess += cent - hi[index]; cents[index] = hi[index]; }
    else if (cent < lo[index]) { excess -= lo[index] - cent; cents[index] = lo[index]; }
  });
  for (let index = 0; excess > 0 && index < cents.length; index += 1) {
    const room = Math.min(excess, hi[index] - cents[index]);
    if (room > 0) { cents[index] += room; excess -= room; }
  }
  for (let index = 0; excess < 0 && index < cents.length; index += 1) {
    const room = Math.min(-excess, cents[index] - lo[index]);
    if (room > 0) { cents[index] -= room; excess += room; }
  }
  return cents.map(cent => cent / 100);
}

export function creditNoteProductKey(item = {}) {
  return creditNoteNorm(item.productCode || item.code || item.product || item.name);
}

function creditNoteLineKey(line = {}) {
  return `${creditNoteText(line.invoiceBranch)}|${creditNoteText(line.invoiceId) || `no:${creditNoteText(line.invoiceNo)}`}`;
}

function creditNoteReturnedBefore(existing, exclude, reference, productKey, matches) {
  let qty = 0;
  for (const creditNote of existing) {
    if (!isCreditNoteLive(creditNote) || !isCreditNoteReturnReason(creditNote.reasonCode)) continue;
    if (exclude && creditNoteText(creditNote.id) === exclude) continue;
    for (const item of Array.isArray(creditNote.returnItems) ? creditNote.returnItems : []) {
      if (creditNoteProductKey(item) !== productKey) continue;
      if (matches({ invoiceId: item.invoiceId, invoiceNo: item.invoiceNo, invoiceBranch: item.invoiceBranch }, creditNote, reference)) qty += creditNoteFinite(item.qty);
    }
  }
  return qty;
}

// §86/10: a credit note must show the buyer's name. An abbreviated tax invoice
// (§86/6) issued to a walk-in customer stores no buyer (GENERAL_CUSTOMER_NAME),
// so the name cannot be copied from the invoice and must be entered on the
// credit note itself. Shared by validateCreditNote() and the form controller.
export function creditNoteRequiresBuyerName(invoices = []) {
  return (Array.isArray(invoices) ? invoices : []).some(invoice => taxInvoiceLacksBuyer(invoice));
}

// Full validation. Recomputes everything from the invoices and existing credit
// notes (never trusts derived numbers stored on the draft) and returns every
// problem at once as clear Thai messages.
//   creditNote: { id?, no, date, branch, customer, reasonCode, reasonText,
//                 lines:[{invoiceId, invoiceNo, invoiceBranch, differenceAmount}],
//                 returnItems?:[{invoiceId, invoiceNo, productCode, product, unit, qty}] }
//   invoices: every invoice (with branch/_year/_month) that may be referenced
//   existingCreditNotes: every stored credit note (the edited one is excluded by id)
//   receipts: optional, only used for the "customer already paid" warning
//   options: { paidByInvoice(invoice) → number, matches(line, cn, invoice) }
export function validateCreditNote(creditNote = {}, invoices = [], existingCreditNotes = [], receipts = [], options = {}) {
  const errors = [];
  const warnings = [];
  const cn = creditNote && typeof creditNote === 'object' ? creditNote : {};
  const existing = Array.isArray(existingCreditNotes) ? existingCreditNotes : [];
  const excludeId = creditNoteText(cn.id);
  const matches = typeof options.matches === 'function' ? options.matches : creditNoteLineMatchesInvoice;
  const no = creditNoteText(cn.no);
  // Only the note being edited (non-empty id) is excluded: a new note has no id,
  // and '' === '' must not let it reuse the number of a stored note that lacks one.
  const isSelf = row => !!excludeId && creditNoteText(row?.id) === excludeId;
  if (!no) errors.push('กรุณาระบุเลขที่ใบลดหนี้');
  else if (existing.some(row => creditNoteNorm(row?.no) === creditNoteNorm(no) && !isSelf(row))) errors.push(`เลขที่ใบลดหนี้ ${no} มีอยู่แล้ว (รวมฉบับที่ยกเลิก) กรุณาใช้เลขใหม่`);
  const dateValid = !!parseBusinessDate(cn.date);
  if (!dateValid) errors.push('กรุณาระบุวันที่ใบลดหนี้ให้ถูกต้อง');
  if (!creditNoteText(cn.branch)) errors.push('กรุณาเลือกสาขาที่ออกใบลดหนี้');
  const reasonCode = creditNoteText(cn.reasonCode);
  if (!reasonCode) errors.push('กรุณาเลือกสาเหตุการลดหนี้');
  else if (!creditNoteReasonLabel(reasonCode)) errors.push('สาเหตุการลดหนี้ไม่ถูกต้อง');
  else if (reasonCode === CREDIT_NOTE_OTHER_REASON && !creditNoteText(cn.reasonText)) errors.push('กรุณาอธิบายสาเหตุการลดหนี้ (กรณีเหตุอื่น)');

  const lines = Array.isArray(cn.lines) ? cn.lines : [];
  if (!lines.length) errors.push('กรุณาเลือกใบกำกับภาษีที่ต้องการลดหนี้อย่างน้อย 1 ใบ');
  const seen = new Set();
  const resolved = [];
  for (const line of lines) {
    const label = creditNoteText(line?.invoiceNo) || creditNoteText(line?.invoiceId) || '-';
    const invoice = findCreditNoteInvoice(line, invoices);
    if (!invoice) { errors.push(`ไม่พบใบกำกับภาษีเลขที่ ${label} ในสาขาที่อ้างอิง`); continue; }
    const key = `${creditNoteBranchOf(invoice)}|${creditNoteText(invoice.id) || creditNoteText(invoice.no)}`;
    if (seen.has(key)) { errors.push(`อ้างอิงใบกำกับภาษี ${invoice.no || label} ซ้ำในใบลดหนี้เดียวกัน`); continue; }
    seen.add(key);
    if (!creditNoteInvoiceLive(invoice)) { errors.push(`ใบกำกับภาษี ${invoice.no || label} ถูกยกเลิกแล้ว ไม่สามารถออกใบลดหนี้อ้างอิงได้`); continue; }
    resolved.push({ line, invoice });
  }

  let calculation = calculateCreditNote({ lines: [] });
  if (resolved.length) {
    const branches = new Set(resolved.map(row => creditNoteBranchOf(row.invoice)));
    if (branches.size > 1) errors.push('ใบกำกับภาษีที่อ้างอิงต้องอยู่สาขาเดียวกันทั้งหมด');
    else if (creditNoteText(cn.branch) && !branches.has(creditNoteText(cn.branch))) errors.push('สาขาของใบลดหนี้ต้องตรงกับสาขาของใบกำกับภาษีที่อ้างอิง');
    const customers = new Set(resolved.map(row => creditNoteNorm(row.invoice.customer)));
    // Walk-in abbreviated invoices carry no buyer: the typed buyer name is
    // required instead of being matched against the invoice customer.
    const buyerless = creditNoteRequiresBuyerName(resolved.map(row => row.invoice));
    if (customers.size > 1) errors.push('ใบลดหนี้หนึ่งฉบับต้องอ้างอิงใบกำกับภาษีของลูกค้ารายเดียวกัน');
    else if (buyerless) {
      // All walk-in invoices share the placeholder name, so the same-customer
      // check cannot tell different buyers apart: one invoice per credit note.
      if (resolved.length > 1) errors.push('ใบกำกับภาษีอย่างย่อที่ไม่มีชื่อผู้ซื้อ ต้องออกใบลดหนี้แยกฉบับละ 1 ใบกำกับภาษี (ไม่สามารถยืนยันได้ว่าเป็นผู้ซื้อรายเดียวกัน) กรุณาเลือกใบกำกับภาษีเพียงใบเดียว');
      if (isGeneralCustomerName(cn.customer)) errors.push('ใบกำกับภาษีอย่างย่อที่อ้างอิงไม่มีชื่อผู้ซื้อ — ใบลดหนี้ (มาตรา 86/10) ต้องระบุชื่อผู้ซื้อ กรุณากรอกชื่อผู้ซื้อ (ลูกค้า)');
      else if (!creditNoteText(cn.customerAddress)) warnings.push('ยังไม่ได้ระบุที่อยู่ผู้ซื้อ — ใบลดหนี้ตามมาตรา 86/10 ควรมีชื่อและที่อยู่ของผู้ซื้อ');
    } else if (creditNoteText(cn.customer) && !customers.has(creditNoteNorm(cn.customer))) errors.push('ชื่อลูกค้าในใบลดหนี้ไม่ตรงกับใบกำกับภาษีที่อ้างอิง');
    const modes = new Set(resolved.map(row => creditNoteVatModeOf(row.invoice)));
    if (modes.size > 1) errors.push('ใบกำกับภาษีที่อ้างอิงใช้รูปแบบ VAT ต่างกัน (รวม VAT / แยก VAT / ไม่มี VAT) กรุณาออกใบลดหนี้แยกฉบับ');
    if (dateValid) {
      for (const { invoice } of resolved) {
        if (parseBusinessDate(invoice.date) && compareBusinessDates(cn.date, invoice.date) < 0) errors.push(`วันที่ใบลดหนี้ (${cn.date}) ต้องไม่ก่อนวันที่ใบกำกับภาษี ${invoice.no} (${invoice.date})`);
      }
    }
    calculation = calculateCreditNote({
      vatMode: creditNoteVatModeOf(resolved[0].invoice),
      lines: resolved.map(({ line, invoice }) => ({
        invoice,
        differenceAmount: line?.differenceAmount,
        correctAmount: line?.correctAmount,
        priorCredited: creditedByInvoice(invoice, existing, { excludeCreditNoteId: excludeId, matches })
      }))
    });
    calculation.lines.forEach((row, index) => {
      const invoiceNo = row.invoiceNo || '-';
      const input = resolved[index].line;
      const explicit = creditNoteParseAmount(input?.differenceAmount);
      const correctInput = creditNoteParseAmount(input?.correctAmount);
      if (row.correctAmount === null) { errors.push(`กรุณาระบุมูลค่าที่ถูกต้อง หรือยอดที่ลดลงของใบกำกับภาษี ${invoiceNo}`); return; }
      if (!Number.isFinite(explicit) && Number.isFinite(correctInput) && correctInput < 0) { errors.push(`มูลค่าที่ถูกต้องของใบกำกับภาษี ${invoiceNo} ต้องไม่ติดลบ`); return; }
      if (!(row.differenceAmount > 0)) { errors.push(`ผลต่างของใบกำกับภาษี ${invoiceNo} ต้องมากกว่า 0 (มูลค่าที่ถูกต้องต้องน้อยกว่ามูลค่าเดิม ${fmt(row.originalAmount)} บาท)`); return; }
      const cumulativeAmount = creditNoteMoney(row.priorCreditedAmount + row.differenceAmount);
      const cumulativeTotal = creditNoteMoney(row.priorCreditedTotal + row.total);
      const over = creditNoteOverInvoice({ amount: cumulativeAmount, total: cumulativeTotal }, { amount: row.invoiceAmount, total: row.invoiceTotal });
      const overAmount = over.amount;
      if (!overAmount && !over.total) return;
      if (!overAmount) {
        errors.push(`ยอดลดหนี้รวม VAT สะสมของใบกำกับภาษี ${invoiceNo} (${fmt(cumulativeTotal)} บาท) เกินยอดรวม VAT ของใบกำกับภาษี (${fmt(row.invoiceTotal)} บาท) — ภาษีที่ลดไปแล้วเกินภาษีตามใบกำกับภาษี กรุณาตรวจสอบใบลดหนี้ก่อนหน้า`);
        return;
      }
      if (row.priorCreditedAmount > 0) {
        errors.push(`ยอดลดหนี้สะสมของใบกำกับภาษี ${invoiceNo} (${fmt(cumulativeAmount)} บาท) เกินมูลค่าใบกำกับภาษี (${fmt(row.invoiceAmount)} บาท) — ออกใบลดหนี้ไปแล้ว ${fmt(row.priorCreditedAmount)} บาท ลดได้อีกไม่เกิน ${fmt(Math.max(0, row.originalAmount))} บาท`);
      } else {
        errors.push(`มูลค่าที่ถูกต้องของใบกำกับภาษี ${invoiceNo} ต้องไม่ติดลบ (ยอดที่ลด ${fmt(row.differenceAmount)} บาท เกินมูลค่าใบกำกับภาษี ${fmt(row.invoiceAmount)} บาท)`);
      }
    });

    const paidByInvoice = typeof options.paidByInvoice === 'function' ? options.paidByInvoice : null;
    const receiptRows = Array.isArray(receipts) ? receipts : [];
    calculation.lines.forEach((row, index) => {
      const invoice = resolved[index].invoice;
      const paid = paidByInvoice ? creditNoteMoney(paidByInvoice(invoice)) : creditNoteMoney(receiptRows
        .filter(receipt => creditNoteInvoiceLive(receipt) && matches({ invoiceId: receipt.invoiceId || receipt.sourceInvoiceId, invoiceNo: receipt.invNo || receipt.sourceInvoiceNo || receipt.invoiceNo, invoiceBranch: receipt.invoiceBranch || creditNoteBranchOf(receipt) }, receipt, invoice))
        .reduce((sum, receipt) => sum + creditNoteFinite(receipt.total ?? receipt.saleTotal ?? receipt.subtotal), 0));
      const effectiveAfter = creditNoteMoney(row.invoiceTotal - row.priorCreditedTotal - row.total);
      const refund = creditNoteMoney(paid - Math.max(0, effectiveAfter));
      if (paid > 0 && refund > CREDIT_NOTE_TOLERANCE) warnings.push(`ลูกค้าชำระใบกำกับภาษี ${row.invoiceNo} แล้ว ${fmt(paid)} บาท — หลังลดหนี้จะมียอดต้องคืนเงิน/เครดิตให้ลูกค้า ${fmt(refund)} บาท`);
    });
  }

  const returnItems = Array.isArray(cn.returnItems) ? cn.returnItems : [];
  if (isCreditNoteReturnReason(reasonCode)) {
    if (!returnItems.length) warnings.push('ไม่ได้ระบุรายการสินค้าที่รับคืน ระบบจะไม่ปรับยอดสต็อก');
    const usage = new Map();
    returnItems.forEach((item, index) => {
      const label = creditNoteText(item?.product) || `รายการที่ ${index + 1}`;
      const qty = creditNoteParseAmount(item?.qty);
      if (!creditNoteText(item?.product) && !creditNoteText(item?.productCode)) { errors.push(`กรุณาเลือกสินค้าที่รับคืน (รายการที่ ${index + 1})`); return; }
      if (!Number.isFinite(qty) || qty <= 0) { errors.push(`จำนวนสินค้าที่รับคืน (${label}) ต้องมากกว่า 0`); return; }
      const owner = resolved.find(row => matches({ invoiceId: item.invoiceId, invoiceNo: item.invoiceNo, invoiceBranch: item.invoiceBranch }, cn, row.invoice));
      if (!owner) { errors.push(`สินค้าที่รับคืน (${label}) ต้องอ้างอิงใบกำกับภาษีที่อยู่ในใบลดหนี้นี้`); return; }
      const productKey = creditNoteProductKey(item);
      const invoiced = (Array.isArray(owner.invoice.items) ? owner.invoice.items : [])
        .filter(row => creditNoteProductKey(row) === productKey)
        .reduce((sum, row) => sum + creditNoteFinite(row.qty), 0);
      const usageKey = `${creditNoteLineKey({ invoiceBranch: creditNoteBranchOf(owner.invoice), invoiceId: owner.invoice.id, invoiceNo: owner.invoice.no })}|${productKey}`;
      const before = usage.has(usageKey) ? usage.get(usageKey) : creditNoteReturnedBefore(existing, excludeId, owner.invoice, productKey, matches);
      const after = before + qty;
      usage.set(usageKey, after);
      if (after > invoiced + 1e-9) errors.push(`จำนวนรับคืน ${label} รวม ${fmt(after)} เกินจำนวนในใบกำกับภาษี ${owner.invoice.no} (${fmt(invoiced)})`);
    });
  }

  if (options.original && !isCreditNoteLive(options.original)) errors.push('ใบลดหนี้นี้ถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้');
  return { ok: errors.length === 0, errors, warnings, calculation, invoices: resolved.map(row => row.invoice) };
}

// Builds the stored record from a validated draft. `meta` carries id/time/user.
export function buildCreditNoteRecord(draft = {}, validation = {}, meta = {}) {
  const calculation = validation.calculation || calculateCreditNote({ lines: [] });
  const firstInvoice = (validation.invoices || [])[0] || {};
  const reasonCode = creditNoteText(draft.reasonCode);
  const returnItems = isCreditNoteReturnReason(reasonCode)
    ? (Array.isArray(draft.returnItems) ? draft.returnItems : []).map(item => ({
        invoiceId: creditNoteText(item.invoiceId),
        invoiceNo: creditNoteText(item.invoiceNo),
        invoiceBranch: creditNoteText(item.invoiceBranch || draft.branch),
        productCode: creditNoteText(item.productCode),
        product: creditNoteText(item.product),
        unit: creditNoteText(item.unit),
        qty: creditNoteFinite(creditNoteParseAmount(item.qty))
      }))
    : [];
  const at = creditNoteText(meta.at) || new Date().toISOString();
  return {
    id: meta.id ?? draft.id,
    no: creditNoteText(draft.no),
    date: creditNoteText(draft.date),
    branch: creditNoteText(draft.branch),
    documentKind: 'credit-note',
    customer: creditNoteText(draft.customer || firstInvoice.customer),
    customerAddress: creditNoteText(draft.customerAddress ?? firstInvoice.customerAddress ?? firstInvoice.address),
    customerTaxId: creditNoteText(draft.customerTaxId ?? firstInvoice.customerTaxId),
    customerBranch: creditNoteText(draft.customerBranch),
    customerAgencyGroup: creditNoteText(firstInvoice.customerAgencyGroup),
    customerAgencyType: creditNoteText(firstInvoice.customerAgencyType),
    salesPerson: creditNoteText(firstInvoice.salesPerson),
    reasonCode,
    reasonLabel: creditNoteReasonLabel(reasonCode),
    reasonText: creditNoteText(draft.reasonText),
    vatMode: calculation.vatMode,
    lines: calculation.lines,
    invoiceNos: calculation.lines.map(line => line.invoiceNo),
    originalValue: calculation.originalValue,
    correctValue: calculation.correctValue,
    differenceAmount: calculation.differenceAmount,
    subtotal: calculation.subtotal,
    vatAmt: calculation.vatAmt,
    total: calculation.total,
    returnItems,
    note: creditNoteText(draft.note),
    status: 'issued',
    voided: false,
    createdAt: creditNoteText(meta.createdAt) || at,
    updatedAt: at,
    createdBy: creditNoteText(meta.createdBy),
    updatedBy: creditNoteText(meta.user)
  };
}

// Buyer head office / branch text for the §86/10 buyer block, from customer-master
// style data ({branchCode, branchName}). Returns '' when nothing is known (never invented).
export function creditNoteBuyerBranchLabel(source = {}) {
  const code = creditNoteText(source?.branchCode).replace(/\D/g, '');
  const name = creditNoteText(source?.branchName);
  if (code) {
    const label = Number(code) === 0 ? 'สำนักงานใหญ่' : `สาขาที่ ${code.padStart(5, '0')}`;
    return name && !label.includes(name) ? `${label} (${name})` : label;
  }
  return name;
}

// Printable A4 layout budget for credit-note-document.js, in "row units" (one plain
// table row ≈ 34 px at the PDF size 794×1123 px, 10.4 px font). Every page carries the
// header, buyer block, reason/totals box and signature boxes; `pageUnits` is the room
// left for the two tables. Calibrated in Chromium: that room is ≈ 565 px (≈ 16.6 units),
// so 15 units (headers counted as 2) leaves ≥ 70 px spare for a longer address/remark.
export const CREDIT_NOTE_PRINT_LAYOUT = Object.freeze({ linesPerPage: 8, pageUnits: 15, lineHeaderUnits: 2, returnHeaderUnits: 2, priorLineUnits: 3, returnCharsPerLine: 28 });

// A line showing "ตามใบกำกับภาษี … หักลดหนี้ก่อนหน้า …" wraps in its narrow column
// (measured ≈ 84 px, i.e. 2.5 units; counted as 3).
export function creditNoteLinePrintUnits(line = {}, layout = CREDIT_NOTE_PRINT_LAYOUT) {
  return Number(line?.priorCreditedValue) > 0 ? layout.priorLineUnits : 1;
}
// A long product name wraps inside the first column of the returned-goods table
// (Thai combining marks count as characters, so the estimate errs on the tall side).
export function creditNoteReturnPrintUnits(item = {}, layout = CREDIT_NOTE_PRINT_LAYOUT) {
  const label = [item?.productCode, item?.product].filter(Boolean).join(' · ');
  return Math.max(1, Math.ceil(String(label).length / layout.returnCharsPerLine));
}

// Splits invoice lines (max `linesPerPage` per page, as before) and returned-goods
// rows over pages so no page holds more than `pageUnits` of table rows. Returned
// goods follow the last invoice lines and continue onto extra pages; the grand
// totals are printed on the final page only. A page without returned goods keeps the
// blank filler rows of the familiar 8-row grid, as far as its budget allows. Returns
// [{ lines, lineStart, returnItems, returnStart, fillerRows, units }] (units include
// the filler rows) — always at least one page.
export function paginateCreditNoteDocument(lines = [], returnItems = [], layout = CREDIT_NOTE_PRINT_LAYOUT) {
  const lineRows = Array.isArray(lines) ? lines : [];
  const returnRows = Array.isArray(returnItems) ? returnItems : [];
  const pages = [];
  let page = null;
  const openPage = () => { page = { lines: [], lineStart: 0, returnItems: [], returnStart: 0, fillerRows: 0, units: 0 }; pages.push(page); return page; };
  for (let index = 0; index < lineRows.length; index += 1) {
    const units = creditNoteLinePrintUnits(lineRows[index], layout);
    const header = page && page.lines.length ? 0 : layout.lineHeaderUnits;
    if (!page || page.lines.length >= layout.linesPerPage || page.units + header + units > layout.pageUnits) { openPage(); page.lineStart = index; }
    page.units += (page.lines.length ? 0 : layout.lineHeaderUnits) + units;
    page.lines.push(lineRows[index]);
  }
  for (let index = 0; index < returnRows.length; index += 1) {
    const units = creditNoteReturnPrintUnits(returnRows[index], layout);
    const header = page && page.returnItems.length ? 0 : layout.returnHeaderUnits;
    if (!page || page.units + header + units > layout.pageUnits) {
      openPage();
      page.lineStart = lineRows.length;
    }
    if (!page.returnItems.length) { page.returnStart = index; page.units += layout.returnHeaderUnits; }
    page.units += units;
    page.returnItems.push(returnRows[index]);
  }
  if (!pages.length) openPage();
  for (const row of pages) {
    if (row.returnItems.length) continue;
    const header = row.lines.length ? 0 : layout.lineHeaderUnits; // an empty grid still prints its header
    row.fillerRows = Math.max(0, Math.min(layout.linesPerPage - row.lines.length, Math.floor(layout.pageUnits - row.units - header)));
    row.units += header + row.fillerRows;
  }
  return pages;
}

// An issued credit note is a tax document: its number, date, referenced invoices,
// amounts/VAT, reason and returned goods can only change by voiding it and issuing a
// new note. Only non-financial text (remark, buyer address, buyer branch) may be edited.
const CREDIT_NOTE_LOCKED_FIELDS = Object.freeze([['no', 'เลขที่'], ['date', 'วันที่'], ['customer', 'ชื่อผู้ซื้อ'], ['customerTaxId', 'เลขประจำตัวผู้เสียภาษีผู้ซื้อ'], ['reasonCode', 'สาเหตุ'], ['reasonText', 'คำอธิบายสาเหตุ']]);
function creditNoteLinesSignature(lines) {
  return (Array.isArray(lines) ? lines : []).map(line => `${creditNoteText(line?.invoiceBranch)}|${creditNoteText(line?.invoiceId) || `no:${creditNoteText(line?.invoiceNo)}`}|${creditNoteMoney(creditNoteParseAmount(line?.differenceAmount))}`).join('\n');
}
function creditNoteReturnSignature(items) {
  return (Array.isArray(items) ? items : []).map(item => `${creditNoteText(item?.invoiceId) || creditNoteText(item?.invoiceNo)}|${creditNoteProductKey(item || {})}|${creditNoteFinite(creditNoteParseAmount(item?.qty))}`).sort().join('\n');
}
export function applyCreditNoteEdit(original = {}, draft = {}, meta = {}) {
  if (!isCreditNoteLive(original)) return { errors: ['ใบลดหนี้นี้ถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้'], record: null };
  const changed = CREDIT_NOTE_LOCKED_FIELDS.filter(([field]) => creditNoteText(draft[field]) !== creditNoteText(original[field])).map(([, label]) => label);
  if (creditNoteLinesSignature(draft.lines) !== creditNoteLinesSignature(original.lines)) changed.push('ใบกำกับภาษีที่อ้างอิง / ยอดลดหนี้');
  if (creditNoteReturnSignature(draft.returnItems) !== creditNoteReturnSignature(original.returnItems)) changed.push('สินค้าที่รับคืน');
  if (changed.length) return { errors: [`ใบลดหนี้ที่ออกแล้วแก้ไขได้เฉพาะหมายเหตุ ที่อยู่ และสาขาของผู้ซื้อ — ไม่อนุญาตให้แก้ ${changed.join(', ')} หากต้องแก้ไข กรุณายกเลิกใบลดหนี้นี้แล้วออกใบลดหนี้ใหม่`], record: null };
  const at = creditNoteText(meta.at) || new Date().toISOString();
  return {
    errors: [],
    record: {
      ...original,
      note: creditNoteText(draft.note),
      customerAddress: creditNoteText(draft.customerAddress),
      customerBranch: creditNoteText(draft.customerBranch),
      updatedAt: at,
      updatedBy: creditNoteText(meta.user) || original.updatedBy || '',
      editCount: Number(original.editCount || 0) + 1
    }
  };
}

// Fields the void path (erp-credit-note.js voidUnlocked) writes, plus `cancelled`,
// which isCreditNoteLive() also honours.
const CREDIT_NOTE_VOID_FIELDS = Object.freeze(['voided', 'cancelled', 'status', 'voidedAt', 'voidedBy', 'voidReason', 'updatedAt']);
const creditNoteIdentity = record => {
  const id = creditNoteText(record?.id);
  if (id) return `id:${id}`;
  const no = creditNoteNorm(record?.no);
  return no ? `no:${no}` : '';
};

// Merge-mode backup import of one pack's credit notes. Rule (kept deliberately
// simple): an issued credit note is an immutable tax document, so when the same
// note (same id; same number for rows without an id) is on the device and in the
// backup, the DEVICE copy is kept as-is — numbers, dates, lines, amounts, VAT,
// invoice references and returned goods never come from the backup. The single
// exception is voiding, which is one-way: if the backup copy is voided and the
// device copy is still live, the result is voided and carries the backup's void
// fields. A voided device copy is never revived. Notes only in the backup are added.
export function mergeCreditNoteCopies(currentRows = [], incomingRows = []) {
  const result = (Array.isArray(currentRows) ? currentRows : []).slice();
  for (const incoming of Array.isArray(incomingRows) ? incomingRows : []) {
    const identity = creditNoteIdentity(incoming);
    const index = identity ? result.findIndex(row => creditNoteIdentity(row) === identity) : -1;
    if (index < 0) { result.push(incoming); continue; }
    const current = result[index];
    if (!isCreditNoteLive(current) || isCreditNoteLive(incoming)) continue;
    const voidFields = CREDIT_NOTE_VOID_FIELDS.filter(field => Object.prototype.hasOwnProperty.call(incoming, field));
    result[index] = { ...current, ...Object.fromEntries(voidFields.map(field => [field, incoming[field]])) };
  }
  return result;
}

// Replace-mode restore: the stored notes (live or voided) that replacing the pack
// with `incomingRows` would remove, so the caller can ask before deleting them.
export function creditNotesMissingFrom(currentRows = [], incomingRows = []) {
  const kept = new Set((Array.isArray(incomingRows) ? incomingRows : []).map(creditNoteIdentity).filter(Boolean));
  return (Array.isArray(currentRows) ? currentRows : []).filter(row => !kept.has(creditNoteIdentity(row)));
}

// Whole-ledger check (used after a backup import): every credit-note number
// belongs to exactly one stored document (voided ones included), and the live
// credit notes of every invoice stay within that invoice's value, VAT and total —
// the same cumulative rule validateCreditNote() applies to a single new note.
// `options.matches(line, creditNote, invoice)` = the reconciliation matcher.
// Returns [{ type: 'duplicate_number' | 'over_credit', message, ... }].
export function creditNoteLedgerIssues(invoices = [], creditNotes = [], options = {}) {
  const notes = Array.isArray(creditNotes) ? creditNotes : [];
  const issues = [];
  const byNumber = new Map();
  for (const creditNote of notes) {
    const key = creditNoteNorm(creditNote?.no);
    if (!key) continue;
    if (!byNumber.has(key)) byNumber.set(key, []);
    byNumber.get(key).push(creditNote);
  }
  byNumber.forEach(rows => {
    if (rows.length < 2) return;
    const no = creditNoteText(rows[0].no);
    issues.push({ type: 'duplicate_number', creditNoteNo: no, message: `เลขที่ใบลดหนี้ ${no} ถูกใช้ซ้ำ ${rows.length} ฉบับ (รหัส ${rows.map(row => creditNoteText(row.id) || '-').join(', ')}) — เลขที่ใบลดหนี้ต้องไม่ซ้ำ รวมฉบับที่ยกเลิก` });
  });
  if (!notes.some(isCreditNoteLive)) return issues;
  for (const invoice of Array.isArray(invoices) ? invoices : []) {
    const credited = creditedByInvoice(invoice, notes, { matches: options.matches });
    if (!credited.count) continue;
    const basis = creditNoteInvoiceBasis(invoice);
    const over = creditNoteOverInvoice(credited, basis);
    if (!over.amount && !over.total && !over.value && !over.vat) continue;
    const invoiceNo = creditNoteText(invoice.no) || creditNoteText(invoice.id) || '-';
    const creditNoteNos = [...new Set(credited.creditNotes.map(row => creditNoteText(row.no) || creditNoteText(row.id)))];
    issues.push({ type: 'over_credit', invoiceNo, creditNoteNos, message: `ใบกำกับภาษี ${invoiceNo} ถูกลดหนี้รวม ${fmt(credited.total)} บาท (มูลค่า ${fmt(credited.value)} + VAT ${fmt(credited.vat)}) เกินยอดใบกำกับภาษี ${fmt(basis.total)} บาท (มูลค่า ${fmt(basis.value)} + VAT ${fmt(basis.vat)}) — ใบลดหนี้ที่ใช้งาน: ${creditNoteNos.join(', ')}` });
  }
  return issues;
}

// Sums live credit notes (value / VAT / total). Period filtering is done by the
// caller, which reads the storage pack of the credit note's OWN month.
export function creditNoteTotals(creditNotes = []) {
  let subtotal = 0, vatAmt = 0, total = 0, count = 0;
  for (const creditNote of Array.isArray(creditNotes) ? creditNotes : []) {
    if (!isCreditNoteLive(creditNote)) continue;
    subtotal += creditNoteFinite(creditNote.subtotal);
    vatAmt += creditNoteFinite(creditNote.vatAmt);
    total += creditNoteFinite(creditNote.total);
    count += 1;
  }
  return { count, subtotal: creditNoteMoney(subtotal), vatAmt: creditNoteMoney(vatAmt), total: creditNoteMoney(total) };
}

// Output VAT (ภาษีขาย) of one period: tax invoices issued in the period, plus debit notes
// (ใบเพิ่มหนี้, §86/9) and minus credit notes (ใบลดหนี้, §86/10) issued in the period. The one
// output-VAT engine: the credit-note list, รายงานภาษีขาย and ภ.พ.30 lines 1 / 5 all use it (ADR-023).
// `debitNotes` have the credit-note record shape (subtotal / vatAmt / total, positive amounts);
// stage D stores them — an empty list until then.
export function summarizeOutputVat({ invoices = [], creditNotes = [], debitNotes = [] } = {}) {
  let salesValue = 0, outputVat = 0, invoiceCount = 0;
  for (const invoice of Array.isArray(invoices) ? invoices : []) {
    if (!creditNoteInvoiceLive(invoice)) continue;
    const basis = creditNoteInvoiceBasis(invoice);
    salesValue += basis.value;
    outputVat += basis.vat;
    invoiceCount += 1;
  }
  const credit = creditNoteTotals(creditNotes);
  const debit = creditNoteTotals(debitNotes);
  salesValue = creditNoteMoney(salesValue);
  outputVat = creditNoteMoney(outputVat);
  return {
    invoiceCount,
    salesValue,
    outputVat,
    creditNoteCount: credit.count,
    creditValue: credit.subtotal,
    creditVat: credit.vatAmt,
    debitNoteCount: debit.count,
    debitValue: debit.subtotal,
    debitVat: debit.vatAmt,
    netSalesValue: creditNoteMoney(salesValue + debit.subtotal - credit.subtotal),
    netOutputVat: creditNoteMoney(outputVat + debit.vatAmt - credit.vatAmt)
  };
}

// Quantity returned to stock by live "returned goods" credit notes.
export function creditNoteReturnedQty(creditNotes = [], matchesItem = () => false) {
  let qty = 0;
  for (const creditNote of Array.isArray(creditNotes) ? creditNotes : []) {
    if (!isCreditNoteLive(creditNote) || !isCreditNoteReturnReason(creditNote.reasonCode)) continue;
    for (const item of Array.isArray(creditNote.returnItems) ? creditNote.returnItems : []) {
      if (matchesItem(item)) qty += creditNoteFinite(item.qty);
    }
  }
  return qty;
}

export const CREDIT_NOTE_EXPORT_HEADER = Object.freeze(['สาขา', 'ปี', 'เดือน', 'เลขที่ใบลดหนี้', 'วันที่', 'ลูกค้า', 'เลขประจำตัวผู้เสียภาษี', 'ใบกำกับภาษีเดิม', 'วันที่ใบกำกับภาษี', 'มูลค่าตามใบกำกับภาษีเดิม', 'มูลค่าที่ถูกต้อง', 'ผลต่าง (ก่อน VAT)', 'VAT ของผลต่าง', 'รวมลดหนี้', 'สาเหตุ', 'รายละเอียดสาเหตุ', 'รูปแบบ VAT', 'สถานะ', 'หมายเหตุ']);

// One XLSX row per referenced invoice; document-level fields on every row so
// the sheet can be filtered by invoice without losing context.
export function creditNoteExportRows(creditNotes = [], context = {}) {
  const formatDate = typeof context.formatDate === 'function' ? context.formatDate : value => value;
  const rows = [];
  for (const creditNote of Array.isArray(creditNotes) ? creditNotes : []) {
    const lines = Array.isArray(creditNote.lines) && creditNote.lines.length ? creditNote.lines : [{}];
    for (const line of lines) {
      rows.push([
        context.branchLabel || creditNote.branch || '', context.yearLabel ?? '', context.monthLabel ?? '',
        creditNote.no || '', formatDate(creditNote.date), creditNote.customer || '', creditNote.customerTaxId || '',
        line.invoiceNo || '', formatDate(line.invoiceDate || ''),
        creditNoteMoney(line.originalValue), creditNoteMoney(line.correctValue), creditNoteMoney(line.difference), creditNoteMoney(line.vatOnDifference), creditNoteMoney(line.total),
        creditNote.reasonLabel || creditNoteReasonLabel(creditNote.reasonCode), creditNote.reasonText || '',
        CREDIT_NOTE_VAT_MODE_LABELS[creditNote.vatMode] || '', creditNoteStatusLabel(creditNote), creditNote.note || ''
      ]);
    }
  }
  return rows;
}
