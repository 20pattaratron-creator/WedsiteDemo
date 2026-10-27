// ============================================================================
// erp-debit-note-core.js — pure Debit Note (ใบเพิ่มหนี้, มาตรา 86/9) rules
// ERP DEMO 4.3.1 · ADR-024 (round 8, stage D) — DOM / storage free, unit-testable.
// ----------------------------------------------------------------------------
// Legal basis (docs/TAX_FEATURES_SPEC.md §4): มาตรา 82/9 — the value of goods / services sold rises after
// the tax invoice was issued (more goods than agreed, price calculated too low, service beyond the agreed
// scope, service price calculated too low, or another case the Director-General allows). มาตรา 86/9 — the
// seller issues a ใบเพิ่มหนี้ in the tax month the event occurs, showing: (ก) the words "ใบเพิ่มหนี้";
// (ข) the issuer's name, address and tax ID; (ค) the buyer's name and address; (ง) the date; (จ) the
// original tax invoice number, the original value, the correct value, the difference and the VAT charged in
// addition; (ฉ) a short reason. The seller adds that VAT to ภาษีขาย in the month the debit note is issued.
//
// Mirror of erp-credit-note-core.js (ADR-008), sharing its helpers instead of copying them:
//   * the invoice money basis (creditNoteInvoiceBasis) and the invoice lookup (findCreditNoteInvoice);
//   * the per-invoice summation of adjustment-note lines (creditedByInvoice — a debit-note line has the
//     same fields, positive amounts: differenceAmount / difference / vatOnDifference / total);
//   * the largest-remainder split (creditNoteAllocate) of the document VAT, computed ONCE on the
//     document difference with calculateVatSummary (ADR-002, RD "total-first");
//   * the live / cancel rule (isCreditNoteLive), the backup merge (mergeCreditNoteCopies).
// The math runs on POSITIVE increases (never on negated credit-note figures): roundMoneyValue() rounds a
// half satang upward for positive values only, so a sign flip would not be symmetric.
//
// "original value" of a referenced invoice (spec §4c rule 2) = the invoice + earlier live debit notes −
// earlier live credit notes on it, so repeated adjustments chain correctly (AC4.7).
// Every user-visible text is in DEBIT_NOTE_TEXT (the English stage translates it). Top-level names carry a
// dn / debitNote / DEBIT_NOTE prefix: the vm-based tests load several modules into one lexical scope.
// ============================================================================
import { roundMoneyValue, calculateVatSummary, parseBusinessDate, compareBusinessDates, fmt, effectiveTaxInvoiceForm, taxInvoiceLacksBuyer, buyerBranchLabel, normalizeBuyerBranchCode, RECONCILE_TOLERANCE } from './erp-shared-core.js';
import { creditNoteInvoiceBasis, creditNoteVatModeOf, creditNoteInvoiceLive, creditNoteParseAmount, creditedByInvoice, findCreditNoteInvoice, isCreditNoteLive, creditNoteAllocate, creditNoteTotals, mergeCreditNoteCopies, creditNotesMissingFrom, creditNoteBuyerBranchLabel, adjustmentOtherReasonCheck, ADJUSTMENT_REASON_TEXT, adjustmentCurrencyError, adjustmentFxSingleError } from './erp-credit-note-core.js';

export const DEBIT_NOTE_CORE_VERSION = '1.0.0';
export const DEBIT_NOTE_NUMBER_PREFIX = 'DN';
export const DEBIT_NOTE_COLLECTION = 'debitNotes';
export const DEBIT_NOTE_KIND = 'debit-note';
export const DEBIT_NOTE_OTHER_REASON = 'other';

// ---------------------------------------------------------------- texts (i18n-ready)
export const DEBIT_NOTE_TEXT = Object.freeze({
  title: 'ใบเพิ่มหนี้',
  titleEn: 'DEBIT NOTE',
  reasons: Object.freeze({
    goods_over_quantity: 'เพิ่มราคาสินค้าที่ขายเนื่องจากสินค้าเกินกว่าจำนวนที่ตกลงซื้อขายกัน',
    goods_price_undercharged: 'คำนวณราคาสินค้าผิดพลาดต่ำกว่าที่เป็นจริง',
    service_over_scope: 'เพิ่มราคาค่าบริการเนื่องจากให้บริการเกินกว่าข้อกำหนดที่ตกลงกัน',
    service_price_undercharged: 'คำนวณราคาค่าบริการผิดพลาดต่ำกว่าที่เป็นจริง',
    other: 'เหตุอื่นตามที่อธิบดีกำหนด (โปรดระบุรายละเอียด)'
  }),
  vatModes: Object.freeze({ extract: 'ราคารวม VAT แล้ว — แยกภาษี', add: 'ราคายังไม่รวม VAT — บวกเพิ่ม 7%', none: 'ไม่มี VAT' }),
  statusLive: 'ใช้งาน',
  statusVoided: 'ยกเลิกแล้ว',
  errNo: 'กรุณาระบุเลขที่ใบเพิ่มหนี้',
  errNoTaken: no => `เลขที่ใบเพิ่มหนี้ ${no} มีอยู่แล้ว (รวมฉบับที่ยกเลิก) กรุณาใช้เลขใหม่`,
  errDate: 'กรุณาระบุวันที่ใบเพิ่มหนี้ให้ถูกต้อง',
  errBranch: 'กรุณาเลือกสาขาที่ออกใบเพิ่มหนี้',
  errReason: 'กรุณาเลือกสาเหตุการเพิ่มหนี้',
  errReasonUnknown: 'สาเหตุการเพิ่มหนี้ไม่ถูกต้อง',
  errReasonText: 'กรุณาอธิบายสาเหตุการเพิ่มหนี้ (กรณีเหตุอื่น)',
  errNoLines: 'กรุณาเลือกใบกำกับภาษีที่ต้องการเพิ่มหนี้อย่างน้อย 1 ใบ',
  errInvoiceMissing: label => `ไม่พบใบกำกับภาษีเลขที่ ${label} ในสาขาที่อ้างอิง`,
  errInvoiceTwice: no => `อ้างอิงใบกำกับภาษี ${no} ซ้ำในใบเพิ่มหนี้เดียวกัน`,
  voidCredited: (no, invoiceNo, credited, allowed) => `ยกเลิกใบเพิ่มหนี้ ${no} ไม่ได้ — ใบลดหนี้ที่ยังใช้งานของใบกำกับภาษี ${invoiceNo} ลดไปแล้ว ${fmt(credited)} บาท ซึ่งเกินมูลค่าที่เหลือหลังยกเลิก (${fmt(allowed)} บาท) เพราะใช้ยอดที่ใบเพิ่มหนี้นี้เพิ่มขึ้น — ยกเลิกใบลดหนี้นั้นก่อน`,
  errInvoiceCancelled: no => `ใบกำกับภาษี ${no} ถูกยกเลิกแล้ว ไม่สามารถออกใบเพิ่มหนี้อ้างอิงได้`,
  errAbbreviated: no => `ใบกำกับภาษี ${no} เป็นใบกำกับภาษีอย่างย่อ — ใบเพิ่มหนี้ (มาตรา 86/9) ต้องมีชื่อและที่อยู่ผู้ซื้อ จึงออกอ้างอิงใบกำกับภาษีอย่างย่อในเดโมนี้ไม่ได้ (ออกใบกำกับภาษีเต็มรูปแทน)`,
  errBranches: 'ใบกำกับภาษีที่อ้างอิงต้องอยู่สาขาเดียวกันทั้งหมด',
  errBranchMismatch: 'สาขาของใบเพิ่มหนี้ต้องตรงกับสาขาของใบกำกับภาษีที่อ้างอิง',
  errCustomers: 'ใบเพิ่มหนี้หนึ่งฉบับต้องอ้างอิงใบกำกับภาษีของลูกค้ารายเดียวกัน',
  errCustomerName: 'ชื่อลูกค้าในใบเพิ่มหนี้ไม่ตรงกับใบกำกับภาษีที่อ้างอิง',
  errVatModes: 'ใบกำกับภาษีที่อ้างอิงใช้รูปแบบ VAT ต่างกัน (รวม VAT / แยก VAT / ไม่มี VAT) กรุณาออกใบเพิ่มหนี้แยกฉบับ',
  errDateBeforeInvoice: (date, no, invoiceDate) => `วันที่ใบเพิ่มหนี้ (${date}) ต้องไม่ก่อนวันที่ใบกำกับภาษี ${no} (${invoiceDate})`,
  errAmountMissing: no => `กรุณาระบุมูลค่าที่ถูกต้อง หรือยอดที่เพิ่มขึ้นของใบกำกับภาษี ${no}`,
  // AC4.3 — the exact wording of the spec.
  errNotHigher: 'มูลค่าที่ถูกต้องต้องมากกว่ามูลค่าเดิม',
  errNotHigherDetail: (no, original) => `ใบกำกับภาษี ${no}: มูลค่าเดิม ${fmt(original)} บาท`,
  errVoidedEdit: 'ใบเพิ่มหนี้นี้ถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้',
  warnAddress: 'ยังไม่ได้ระบุที่อยู่ผู้ซื้อ — ใบเพิ่มหนี้ตามมาตรา 86/9 ต้องมีชื่อและที่อยู่ของผู้ซื้อ',
  warnNoTaxId: 'ไม่มีเลขประจำตัวผู้เสียภาษีของผู้ซื้อ — ต้องระบุเมื่อผู้ซื้อจดทะเบียน VAT',
  duplicateNumber: (no, count, ids) => `เลขที่ใบเพิ่มหนี้ ${no} ถูกใช้ซ้ำ ${count} ฉบับ (รหัส ${ids}) — เลขที่ใบเพิ่มหนี้ต้องไม่ซ้ำ รวมฉบับที่ยกเลิก`,
  exportHeader: Object.freeze(['สาขา', 'ปี', 'เดือน', 'เลขที่ใบเพิ่มหนี้', 'วันที่', 'ลูกค้า', 'เลขประจำตัวผู้เสียภาษี', 'สถานประกอบการผู้ซื้อ', 'ใบกำกับภาษีเดิม', 'วันที่ใบกำกับภาษี', 'มูลค่าตามใบกำกับภาษีเดิม', 'มูลค่าที่ถูกต้อง', 'ผลต่าง (ก่อน VAT)', 'ภาษีที่เรียกเก็บเพิ่ม', 'รวมเพิ่มหนี้', 'สาเหตุ', 'รายละเอียดสาเหตุ', 'รูปแบบ VAT', 'สถานะ', 'เหตุผลที่ยกเลิก', 'หมายเหตุ'])
});

export const DEBIT_NOTE_REASONS = Object.freeze(Object.entries(DEBIT_NOTE_TEXT.reasons).map(([code, label]) => Object.freeze({ code, label })));
const DN_VAT_USE = Object.freeze({ add: 1, extract: 0, none: 2 });

const dnFinite = value => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
const dnMoney = value => roundMoneyValue(dnFinite(value));
const dnText = value => String(value ?? '').trim();
const dnNorm = value => dnText(value).toLowerCase();
const dnBranchOf = record => dnText(record?.branch ?? record?._branch ?? '');
const DN_TOLERANCE = RECONCILE_TOLERANCE;
const dnVatMode = mode => (mode === 'add' || mode === 'extract' || mode === 'none' ? mode : 'none');

export function debitNoteReasonLabel(code) {
  return Object.prototype.hasOwnProperty.call(DEBIT_NOTE_TEXT.reasons, code) ? DEBIT_NOTE_TEXT.reasons[code] : '';
}
// Live = issued and not cancelled — the same rule as a credit note (one definition).
export function isDebitNoteLive(record) {
  return isCreditNoteLive(record);
}
export function debitNoteStatusLabel(record) {
  return isDebitNoteLive(record) ? DEBIT_NOTE_TEXT.statusLive : DEBIT_NOTE_TEXT.statusVoided;
}
// The buyer's establishment text printed on the debit note: the invoice's snapshot (ADR-021) first.
export function debitNoteBuyerBranchOf(invoice = {}, master = null) {
  const code = normalizeBuyerBranchCode(invoice?.customerBranchCode);
  if (code) return { code, label: creditNoteBuyerBranchLabel({ branchCode: code, branchName: invoice?.customerBranchName }) || buyerBranchLabel(code) };
  // Customer Master may hold a short code ("3" → "00003"), as buyerBranchFromContact() pads it.
  const raw = String(master?.branchCode ?? '').replace(/\D/g, '');
  const masterCode = /^\d{1,5}$/.test(raw) ? raw.padStart(5, '0') : '';
  return { code: masterCode, label: master ? creditNoteBuyerBranchLabel(master) : '' };
}

// What earlier live notes did to one invoice: { credited, debited } (creditedByInvoice shape each).
// `excludeDebitNoteId` leaves out the debit note being validated again (re-check of a stored note).
export function debitNotePriorAdjustments(invoice = {}, creditNotes = [], debitNotes = [], options = {}) {
  return {
    credited: creditedByInvoice(invoice, creditNotes, { matches: options.matches }),
    debited: creditedByInvoice(invoice, debitNotes, { excludeCreditNoteId: options.excludeDebitNoteId, matches: options.matches })
  };
}

// lines: [{ invoice, increaseAmount | correctAmount, priorCredited, priorDebited }] — amounts in the
// ORIGINAL invoice's price basis (pre-VAT for 'add' / 'none', VAT-inclusive for 'extract'), like a credit
// note. vatMode: optional; defaults to the first referenced invoice's mode.
export function calculateDebitNote(input = {}) {
  const rawLines = Array.isArray(input.lines) ? input.lines : [];
  const prepared = rawLines.map(line => {
    const invoice = line?.invoice || {};
    const basis = creditNoteInvoiceBasis(invoice);
    const credited = line?.priorCredited || {};
    const debited = line?.priorDebited || {};
    const pc = { amount: dnMoney(credited.amount), value: dnMoney(credited.value), vat: dnMoney(credited.vat ?? (dnFinite(credited.total) - dnFinite(credited.value))), total: dnMoney(credited.total) };
    const pd = { amount: dnMoney(debited.amount), value: dnMoney(debited.value), vat: dnMoney(debited.vat ?? (dnFinite(debited.total) - dnFinite(debited.value))), total: dnMoney(debited.total) };
    // §4c rule 2: the invoice as it stands after the earlier debit / credit notes.
    const originalAmount = dnMoney(basis.amount + pd.amount - pc.amount);
    const originalValue = dnMoney(basis.value + pd.value - pc.value);
    let increase = creditNoteParseAmount(line?.increaseAmount);
    if (!Number.isFinite(increase)) {
      const correct = creditNoteParseAmount(line?.correctAmount);
      increase = Number.isFinite(correct) ? correct - originalAmount : NaN;
    }
    const missing = !Number.isFinite(increase);
    return {
      invoiceId: dnText(invoice.id),
      invoiceNo: dnText(invoice.no),
      invoiceBranch: dnBranchOf(invoice),
      invoiceYear: invoice._year ?? invoice.year ?? '',
      invoiceMonth: invoice._month ?? invoice.month ?? '',
      invoiceDate: dnText(invoice.date),
      vatMode: basis.vatMode,
      invoiceAmount: basis.amount,
      invoiceValue: basis.value,
      invoiceVat: basis.vat,
      invoiceTotal: basis.total,
      priorCreditedAmount: pc.amount, priorCreditedValue: pc.value, priorCreditedVat: pc.vat, priorCreditedTotal: pc.total,
      priorDebitedAmount: pd.amount, priorDebitedValue: pd.value, priorDebitedVat: pd.vat, priorDebitedTotal: pd.total,
      originalAmount,
      originalValue,
      differenceAmount: missing ? 0 : dnMoney(increase),
      missing
    };
  });
  const vatMode = dnVatMode(input.vatMode || prepared[0]?.vatMode || 'none');
  // VAT once on the document increase (calculateVatSummary, ADR-002), then split back by largest remainder:
  // 'extract' — the typed figures are VAT-inclusive, so each row's total is exact and the pre-VAT value is the
  // shared figure; 'add' / 'none' — the value is exact and the VAT-inclusive total is the shared figure.
  // Only positive increases take part; a non-positive draft row is shown as typed and refused by validation.
  const positive = prepared.map(line => (!line.missing && line.differenceAmount > 0 ? line.differenceAmount : 0));
  const documentIncrease = dnMoney(positive.reduce((sum, amount) => sum + amount, 0));
  const summary = calculateVatSummary(documentIncrease, DN_VAT_USE[vatMode]);
  const shared = documentIncrease > 0 ? creditNoteAllocate(vatMode === 'extract' ? summary.subtotal : summary.total, positive) : positive.map(() => 0);
  const lines = prepared.map((line, index) => {
    const { missing, ...rest } = line;
    const amount = positive[index];
    const value = vatMode === 'extract' ? shared[index] : amount;
    const total = vatMode === 'extract' ? amount : shared[index];
    return {
      ...rest,
      correctAmount: missing ? null : dnMoney(line.originalAmount + line.differenceAmount),
      correctValue: missing ? null : dnMoney(line.originalValue + value),
      difference: dnMoney(value),
      vatOnDifference: dnMoney(total - value),
      total: dnMoney(total)
    };
  });
  const subtotal = dnMoney(lines.reduce((sum, line) => sum + line.difference, 0));
  const vatAmt = dnMoney(lines.reduce((sum, line) => sum + line.vatOnDifference, 0));
  return {
    vatMode,
    lines,
    originalValue: dnMoney(lines.reduce((sum, line) => sum + line.originalValue, 0)),
    correctValue: dnMoney(lines.reduce((sum, line) => sum + (line.correctValue ?? line.originalValue), 0)),
    differenceAmount: dnMoney(prepared.reduce((sum, line) => sum + line.differenceAmount, 0)),
    subtotal,
    vatAmt,
    total: dnMoney(subtotal + vatAmt),
    missingInput: prepared.some(line => line.missing)
  };
}

// A tax invoice a debit note may reference: live, full form, with a named buyer (spec §4c rule 4).
export function debitNoteInvoiceEligible(invoice = {}) {
  if (!creditNoteInvoiceLive(invoice)) return { ok: false, reason: 'cancelled' };
  if (effectiveTaxInvoiceForm(invoice) === 'abbreviated' || taxInvoiceLacksBuyer(invoice)) return { ok: false, reason: 'abbreviated' };
  return { ok: true, reason: '' };
}

// Full validation; recomputes everything from the invoices and the stored notes (never trusts derived
// numbers on the draft) and returns every problem at once.
//   draft: { id?, no, date, branch, customer, customerAddress, customerTaxId, reasonCode, reasonText,
//            lines: [{ invoiceId, invoiceNo, invoiceBranch, increaseAmount | correctAmount }] }
//   invoices: the invoices that may be referenced (with branch / _year / _month)
//   existingDebitNotes: every stored debit note (number uniqueness incl. cancelled ones, prior debits)
//   creditNotes: every stored credit note (prior credits)
//   options: { matches(line, note, invoice) }
export function validateDebitNote(draft = {}, invoices = [], existingDebitNotes = [], creditNotes = [], options = {}) {
  const errors = [];
  const warnings = [];
  const dn = draft && typeof draft === 'object' ? draft : {};
  const existing = Array.isArray(existingDebitNotes) ? existingDebitNotes : [];
  const selfId = dnText(dn.id);
  const isSelf = row => !!selfId && dnText(row?.id) === selfId;
  const no = dnText(dn.no);
  if (!no) errors.push(DEBIT_NOTE_TEXT.errNo);
  else if (existing.some(row => dnNorm(row?.no) === dnNorm(no) && !isSelf(row))) errors.push(DEBIT_NOTE_TEXT.errNoTaken(no));
  const dateValid = !!parseBusinessDate(dn.date) && /^\d{4}-\d{2}-\d{2}$/.test(dnText(dn.date));
  if (!dateValid) errors.push(DEBIT_NOTE_TEXT.errDate);
  if (!dnText(dn.branch)) errors.push(DEBIT_NOTE_TEXT.errBranch);
  const reasonCode = dnText(dn.reasonCode);
  if (!reasonCode) errors.push(DEBIT_NOTE_TEXT.errReason);
  else if (!debitNoteReasonLabel(reasonCode)) errors.push(DEBIT_NOTE_TEXT.errReasonUnknown);
  else if (reasonCode === DEBIT_NOTE_OTHER_REASON && !dnText(dn.reasonText)) errors.push(DEBIT_NOTE_TEXT.errReasonText);
  else if (reasonCode === DEBIT_NOTE_OTHER_REASON) { const check = adjustmentOtherReasonCheck(dn.reasonText, 'debit'); if (check.error) errors.push(check.error); warnings.push(...check.warnings); } // r13#MED-9

  const lines = Array.isArray(dn.lines) ? dn.lines : [];
  if (!lines.length) errors.push(DEBIT_NOTE_TEXT.errNoLines);
  const seen = new Set();
  const resolved = [];
  for (const line of lines) {
    const label = dnText(line?.invoiceNo) || dnText(line?.invoiceId) || '-';
    const invoice = findCreditNoteInvoice(line, invoices);
    if (!invoice) { errors.push(DEBIT_NOTE_TEXT.errInvoiceMissing(label)); continue; }
    const key = `${dnBranchOf(invoice)}|${dnText(invoice.id) || dnText(invoice.no)}`;
    if (seen.has(key)) { errors.push(DEBIT_NOTE_TEXT.errInvoiceTwice(invoice.no || label)); continue; }
    seen.add(key);
    const eligible = debitNoteInvoiceEligible(invoice);
    if (!eligible.ok) { errors.push(eligible.reason === 'cancelled' ? DEBIT_NOTE_TEXT.errInvoiceCancelled(invoice.no || label) : DEBIT_NOTE_TEXT.errAbbreviated(invoice.no || label)); continue; }
    if (invoice.taxPoint === 'payment') { errors.push(ADJUSTMENT_REASON_TEXT.errTaxPointInvoice(invoice.no || label)); continue; }
    const fxError = adjustmentCurrencyError(invoice, dn); // ADR-031
    if (fxError) { errors.push(fxError); continue; }
    resolved.push({ line, invoice });
  }
  { const single = adjustmentFxSingleError(dn, lines.length); if (single) errors.push(single); }

  let calculation = calculateDebitNote({ lines: [] });
  if (resolved.length) {
    const branches = new Set(resolved.map(row => dnBranchOf(row.invoice)));
    if (branches.size > 1) errors.push(DEBIT_NOTE_TEXT.errBranches);
    else if (dnText(dn.branch) && !branches.has(dnText(dn.branch))) errors.push(DEBIT_NOTE_TEXT.errBranchMismatch);
    const customers = new Set(resolved.map(row => dnNorm(row.invoice.customer)));
    if (customers.size > 1) errors.push(DEBIT_NOTE_TEXT.errCustomers);
    else if (dnText(dn.customer) && !customers.has(dnNorm(dn.customer))) errors.push(DEBIT_NOTE_TEXT.errCustomerName);
    const modes = new Set(resolved.map(row => creditNoteVatModeOf(row.invoice)));
    if (modes.size > 1) errors.push(DEBIT_NOTE_TEXT.errVatModes);
    if (dateValid) {
      for (const { invoice } of resolved) {
        if (parseBusinessDate(invoice.date) && compareBusinessDates(dn.date, invoice.date) < 0) errors.push(DEBIT_NOTE_TEXT.errDateBeforeInvoice(dn.date, invoice.no, invoice.date));
      }
    }
    calculation = calculateDebitNote({
      vatMode: creditNoteVatModeOf(resolved[0].invoice),
      lines: resolved.map(({ line, invoice }) => {
        const prior = debitNotePriorAdjustments(invoice, creditNotes, existing, { excludeDebitNoteId: selfId, matches: options.matches });
        return { invoice, increaseAmount: line?.increaseAmount, correctAmount: line?.correctAmount, priorCredited: prior.credited, priorDebited: prior.debited };
      })
    });
    calculation.lines.forEach(row => {
      const invoiceNo = row.invoiceNo || '-';
      if (row.correctAmount === null) { errors.push(DEBIT_NOTE_TEXT.errAmountMissing(invoiceNo)); return; }
      // AC4.3: correct value must be above the original value (spec wording, + which invoice).
      if (!(row.differenceAmount > 0)) errors.push(`${DEBIT_NOTE_TEXT.errNotHigher} (${DEBIT_NOTE_TEXT.errNotHigherDetail(invoiceNo, row.originalAmount)})`);
    });
    if (!dnText(dn.customerAddress ?? resolved[0].invoice.customerAddress)) warnings.push(DEBIT_NOTE_TEXT.warnAddress);
    if (!dnText(dn.customerTaxId ?? resolved[0].invoice.customerTaxId)) warnings.push(DEBIT_NOTE_TEXT.warnNoTaxId);
  }
  if (options.original && !isDebitNoteLive(options.original)) errors.push(DEBIT_NOTE_TEXT.errVoidedEdit);
  return { ok: errors.length === 0, errors, warnings, calculation, invoices: resolved.map(row => row.invoice) };
}

// The stored record of a validated draft (spec §4b). `meta` = { id, at, createdAt, createdBy, user }.
export function buildDebitNoteRecord(draft = {}, validation = {}, meta = {}) {
  const calculation = validation.calculation || calculateDebitNote({ lines: [] });
  const first = (validation.invoices || [])[0] || {};
  const reasonCode = dnText(draft.reasonCode);
  const at = dnText(meta.at) || new Date().toISOString();
  const branchCode = normalizeBuyerBranchCode(draft.customerBranchCode ?? first.customerBranchCode);
  return {
    id: meta.id ?? draft.id,
    no: dnText(draft.no),
    date: dnText(draft.date),
    branch: dnText(draft.branch),
    documentKind: DEBIT_NOTE_KIND,
    customer: dnText(draft.customer || first.customer),
    customerAddress: dnText(draft.customerAddress ?? first.customerAddress ?? first.address),
    customerTaxId: dnText(draft.customerTaxId ?? first.customerTaxId),
    customerBranchCode: branchCode,
    customerBranch: dnText(draft.customerBranch) || buyerBranchLabel(branchCode),
    customerAgencyGroup: dnText(first.customerAgencyGroup),
    customerAgencyType: dnText(first.customerAgencyType),
    salesPerson: dnText(first.salesPerson),
    reasonCode,
    reasonLabel: debitNoteReasonLabel(reasonCode),
    reasonText: dnText(draft.reasonText),
    vatMode: calculation.vatMode,
    lines: calculation.lines,
    invoiceNos: calculation.lines.map(line => line.invoiceNo),
    originalValue: calculation.originalValue,
    correctValue: calculation.correctValue,
    differenceAmount: calculation.differenceAmount,
    subtotal: calculation.subtotal,
    vatAmt: calculation.vatAmt,
    total: calculation.total,
    note: dnText(draft.note),
    status: 'issued',
    voided: false,
    createdAt: dnText(meta.createdAt) || at,
    updatedAt: at,
    createdBy: dnText(meta.createdBy),
    updatedBy: dnText(meta.user)
  };
}

// The cancel action's fields (cancel-not-delete, ADR-021): the record keeps its number and figures.
export function applyDebitNoteVoid(record = {}, meta = {}) {
  const at = dnText(meta.at) || new Date().toISOString();
  return { ...record, voided: true, status: 'voided', voidedAt: at, voidedBy: dnText(meta.by), voidReason: dnText(meta.reason), updatedAt: at };
}

// r8fix#A3: a debit note may not be voided while live credit notes rely on the value it raised — after the
// void, every referenced invoice must still cover what its live credit notes took off (same exact-amount /
// satang-tolerance rule as validateCreditNote). → '' or the Thai refusal (first offending invoice).
//   invoices: every invoice the lines may reference; creditNotes / debitNotes: every stored note (any status).
export function debitNoteVoidCreditRefusal(record = {}, invoices = [], creditNotes = [], debitNotes = [], options = {}) {
  const exclude = dnText(record.id);
  for (const line of Array.isArray(record.lines) ? record.lines : []) {
    const invoice = findCreditNoteInvoice({ invoiceId: line.invoiceId, invoiceNo: line.invoiceNo, invoiceBranch: line.invoiceBranch || record.branch }, invoices);
    if (!invoice) continue;
    const basis = creditNoteInvoiceBasis(invoice);
    const credited = creditedByInvoice(invoice, creditNotes, { matches: options.matches });
    if (!credited.count) continue;
    const rest = creditedByInvoice(invoice, debitNotes, { excludeCreditNoteId: exclude, matches: options.matches });
    const allowedAmount = roundMoneyValue(basis.amount + rest.amount), allowedTotal = roundMoneyValue(basis.total + rest.total);
    if (credited.amount > allowedAmount || credited.total > allowedTotal + DN_TOLERANCE) return DEBIT_NOTE_TEXT.voidCredited(dnText(record.no), dnText(invoice.no), credited.amount, allowedAmount);
  }
  return '';
}

// Sums of live debit notes — the credit-note summation (one implementation).
export function debitNoteTotals(debitNotes = []) {
  return creditNoteTotals(debitNotes);
}
// Backup merge / replace (an issued debit note is immutable; voiding is one-way) — the credit-note rule.
export function mergeDebitNoteCopies(currentRows = [], incomingRows = []) {
  return mergeCreditNoteCopies(currentRows, incomingRows);
}
export function debitNotesMissingFrom(currentRows = [], incomingRows = []) {
  return creditNotesMissingFrom(currentRows, incomingRows);
}

// Whole-ledger check after a backup import: one stored document per number (cancelled ones included).
export function debitNoteLedgerIssues(debitNotes = []) {
  const byNumber = new Map();
  for (const note of Array.isArray(debitNotes) ? debitNotes : []) {
    const key = dnNorm(note?.no);
    if (!key) continue;
    if (!byNumber.has(key)) byNumber.set(key, []);
    byNumber.get(key).push(note);
  }
  const issues = [];
  byNumber.forEach(rows => {
    if (rows.length < 2) return;
    const no = dnText(rows[0].no);
    issues.push({ type: 'duplicate_number', debitNoteNo: no, message: DEBIT_NOTE_TEXT.duplicateNumber(no, rows.length, rows.map(row => dnText(row.id) || '-').join(', ')) });
  });
  return issues;
}

// One Excel row per referenced invoice (document fields on every row, like the credit-note export).
export function debitNoteExportRows(debitNotes = [], context = {}) {
  const formatDate = typeof context.formatDate === 'function' ? context.formatDate : value => value;
  const branchLabel = typeof context.branchLabel === 'function' ? context.branchLabel : value => value;
  const rows = [];
  for (const note of Array.isArray(debitNotes) ? debitNotes : []) {
    const lines = Array.isArray(note.lines) && note.lines.length ? note.lines : [{}];
    const period = /^(\d{4})-(\d{2})/.exec(dnText(note.date));
    for (const line of lines) {
      rows.push([
        branchLabel(note._branch || note.branch || ''), period ? String(Number(period[1]) + 543) : '', period ? Number(period[2]) : '',
        note.no || '', formatDate(note.date), note.customer || '', note.customerTaxId || '', note.customerBranch || '',
        line.invoiceNo || '', formatDate(line.invoiceDate || ''),
        dnMoney(line.originalValue), dnMoney(line.correctValue), dnMoney(line.difference), dnMoney(line.vatOnDifference), dnMoney(line.total),
        note.reasonLabel || debitNoteReasonLabel(note.reasonCode), note.reasonText || '',
        DEBIT_NOTE_TEXT.vatModes[note.vatMode] || '', debitNoteStatusLabel(note), isDebitNoteLive(note) ? '' : (note.voidReason || ''), note.note || ''
      ]);
    }
  }
  return rows;
}
