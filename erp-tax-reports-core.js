// ============================================================================
// erp-tax-reports-core.js — pure Thai VAT rules: purchase-tax fields of an expense,
// รายงานภาษีขาย, รายงานภาษีซื้อ, ภาษีซื้อต้องห้าม, ภ.พ.30 (lines 1–12), due dates and the
// filed-return snapshots (vatReturns). ERP DEMO 4.3.1 · ADR-023 (round 8, stage C).
// ----------------------------------------------------------------------------
// DOM / storage free and deterministic: callers pass the documents they read (the stored
// pack of the tax month for sales, every expense of the establishment for purchases) and get
// plain data back. Print / Excel / screens live in erp-tax-reports.js; the expense / supplier /
// invoice form controls in erp-tax-forms.js.
//
// Sources (docs/TAX_FEATURES_SPEC.md §0–3, rd.go.th):
// - มาตรา 87(1)(2), 87/3; ประกาศอธิบดีฯ VAT ฉบับที่ 89 (rd.go.th/3374.html) — report form and entry
//   rules: full tax invoices one by one, ใบกำกับภาษีอย่างย่อ may be one line per day (ข้อ 7(2)),
//   ใบลดหนี้/ใบเพิ่มหนี้ one by one in the month issued (ข้อ 7(10)); input tax entered by the month
//   the tax invoice is received (ข้อ 8). ฉบับที่ 202 (rd.go.th/27985.html) — buyer / seller TIN and
//   สถานประกอบการ columns.
// - มาตรา 82/3 (rd.go.th/2596.html) — input tax claimed in the invoice month or within 6 months after
//   it ("claim month ≤ invoice month + 6", the counting convention is [unconfirmed]); มาตรา 82/5 —
//   ภาษีซื้อต้องห้าม (abbreviated tax invoice, passenger car ≤ 10 seats, entertainment, …).
// - ภ.พ.30 form 2568 (rd.go.th/fileadmin/tax_pdf/vat/2568/pp30_010968.pdf) — lines 1–16; มาตรา 83 —
//   due by the 15th of the next month; e-filing +8 days until 31 Jan 2570 (config, secondary sources).
//
// Money: every figure is a stored value of each record (never recomputed from items); sums are
// rounded half-up to the satang with roundMoneyValue() (ป.86/2542). Output VAT goes through
// summarizeOutputVat() of the credit-note core — the one output-VAT engine (ADR-002 / ADR-008).
// Every user-visible text of this module is in TAX_CORE_TEXT (the English stage translates it).
// Top-level names carry a tax / TAX_ prefix: the vm-based tests load several modules into one scope.
// ============================================================================
import { roundMoneyValue, calculateVatSummary, parseBusinessDate, businessDateOrdinal, normalizeBuyerBranchCode, effectiveTaxInvoiceForm, isGeneralCustomerName, GENERAL_CUSTOMER_NAME } from './erp-shared-core.js';
import { creditNoteInvoiceBasis, creditNoteVatModeOf, creditNoteInvoiceLive, isCreditNoteLive, summarizeOutputVat } from './erp-credit-note-core.js';
import { isValidThaiTaxId } from './erp-company-profile-core.js';

export const TAX_REPORTS_CORE_VERSION = '1.0.0';
export const VAT_RETURN_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------- texts (i18n-ready)
export const TAX_CORE_TEXT = Object.freeze({
  monthNames: Object.freeze(['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']),
  salesTitle: 'รายงานภาษีขาย',
  purchaseTitle: 'รายงานภาษีซื้อ',
  forbiddenTitle: 'ภาษีซื้อต้องห้าม (ไม่นำไปหักในรายงานภาษีซื้อ)',
  pp30Title: 'สรุปรายการภาษีมูลค่าเพิ่ม ภ.พ.30',
  colSeq: 'ลำดับที่',
  colTaxInvoice: 'ใบกำกับภาษี',
  colDate: 'วัน เดือน ปี',
  colNo: 'เล่มที่/เลขที่',
  colBuyer: 'ชื่อผู้ซื้อสินค้า/ผู้รับบริการ',
  colBuyerTaxId: 'เลขประจำตัวผู้เสียภาษีอากรของผู้ซื้อสินค้า/ผู้รับบริการ',
  colSeller: 'ชื่อผู้ขายสินค้า/ผู้ให้บริการ',
  colSellerTaxId: 'เลขประจำตัวผู้เสียภาษีอากรของผู้ขายสินค้า/ผู้ให้บริการ',
  colEstablishment: 'สถานประกอบการ',
  colHeadOffice: 'สำนักงานใหญ่',
  colBranchNo: 'สาขาที่',
  colValue: 'มูลค่าสินค้าหรือบริการ',
  colVat: 'จำนวนเงินภาษีมูลค่าเพิ่ม',
  colTotal: 'รวม',
  colNote: 'หมายเหตุ',
  colReason: 'เหตุผลที่ต้องห้าม',
  totalLabel: 'รวม',
  headOfficeMark: '✓',
  abbreviatedParty: 'ใบกำกับภาษีอย่างย่อ',
  abbreviatedDayNote: count => `สรุปใบกำกับภาษีอย่างย่อประจำวัน (${count} ฉบับ)`,
  abbreviatedCancelledNote: nos => `ยกเลิกในช่วงเลขที่นี้: ${nos.join(', ')}`,
  cancelledNote: reason => `ยกเลิก – ${reason || 'ไม่ระบุเหตุผล'}`,
  creditNoteNote: nos => `ใบลดหนี้ อ้างอิง ${nos.length ? nos.join(', ') : '-'}`,
  debitNoteNote: nos => `ใบเพิ่มหนี้ อ้างอิง ${nos.length ? nos.join(', ') : '-'}`,
  zeroRatedNote: 'อัตราร้อยละ 0',
  lateEntryNote: 'ลงรายการเกิน 3 วันทำการ',
  receivedNote: date => `ได้รับ ${date}`,
  invoiceMonthNote: period => `ใบกำกับภาษีเดือน ${period}`,
  creditNoteReceivedNote: 'ใบลดหนี้ที่ได้รับ',
  debitNoteReceivedNote: 'ใบเพิ่มหนี้ที่ได้รับ',
  missingBuyerTaxId: 'ไม่มีเลขประจำตัวผู้เสียภาษีของผู้ซื้อ — ต้องระบุเมื่อผู้ซื้อจดทะเบียน VAT (ประกาศฯ ฉบับที่ 202)',
  dateOutsidePeriod: (no, date) => `เอกสาร ${no} ลงวันที่ ${date} แต่เก็บอยู่ในเดือนภาษีนี้ — ตรวจสอบข้อมูลนำเข้า`,
  footerMismatch: 'ยอดรวมท้ายรายงานไม่ตรงกับผลรวมรายการ — กรุณาแจ้งผู้ดูแลระบบ',
  // purchase-tax fields of an expense
  nonClaimable: Object.freeze({
    no_tax_invoice: 'ไม่มีใบกำกับภาษี / ยังไม่ได้รับ (82/5(1))',
    incomplete_invoice: 'ใบกำกับภาษีมีรายการไม่ครบหรือไม่ถูกต้อง (82/5(2))',
    not_business: 'ไม่เกี่ยวกับการประกอบกิจการ (82/5(3))',
    entertainment: 'ค่ารับรอง (82/5(4))',
    passenger_car: 'รถยนต์นั่ง/รถโดยสารไม่เกิน 10 ที่นั่ง — ซื้อ เช่า น้ำมัน ซ่อม (82/5(6))',
    abbreviated: 'ใบกำกับภาษีอย่างย่อ ใช้เป็นภาษีซื้อไม่ได้ (82/5(6))',
    seller_not_registered: 'ผู้ขายไม่ได้จดทะเบียน VAT (82/5(5))',
    other: 'อื่น ๆ ตามที่อธิบดีกำหนด'
  }),
  vatModes: Object.freeze({ extract: 'ยอดที่กรอกรวม VAT แล้ว (แยก VAT ออก)', add: 'ยอดที่กรอกยังไม่รวม VAT (บวก VAT 7%)', none: 'ไม่มี VAT / ผู้ขายไม่ได้จด VAT' }),
  errVatMode: 'กรุณาเลือกวิธีคิด VAT ของเอกสารซื้อ',
  errNeedsReceived: 'ใช้สิทธิ์ภาษีซื้อได้เมื่อได้รับใบกำกับภาษีแล้ว — เลือกสถานะ “ได้รับใบกำกับภาษีแล้ว” หรือเลือกไม่ขอใช้สิทธิ์พร้อมเหตุผล',
  errVendorName: 'กรุณาระบุชื่อผู้ขาย/ผู้ให้บริการตามใบกำกับภาษี',
  errVendorTaxId: 'เลขประจำตัวผู้เสียภาษีของผู้ขายต้องเป็นตัวเลข 13 หลัก (ใบกำกับภาษีเต็มรูปต้องมี — มาตรา 86/4)',
  errVendorBranch: 'กรุณาระบุสถานประกอบการของผู้ขาย: “สำนักงานใหญ่” หรือ “สาขาที่” + เลข 5 หลัก ตามใบกำกับภาษี',
  errTaxInvoiceNo: 'กรุณาระบุเลขที่ใบกำกับภาษี',
  errTaxInvoiceDate: 'กรุณาระบุวันที่ในใบกำกับภาษีให้ถูกต้อง',
  errReceivedDate: 'กรุณาระบุวันที่ได้รับใบกำกับภาษีให้ถูกต้อง',
  errReceivedBeforeInvoice: 'วันที่ได้รับใบกำกับภาษีต้องไม่ก่อนวันที่ในใบกำกับภาษี',
  errClaimPeriod: 'กรุณาเลือกเดือนที่ใช้สิทธิ์ภาษีซื้อ (เดือน/ปี)',
  errClaimBeforeReceived: 'เดือนที่ใช้สิทธิ์ต้องไม่ก่อนเดือนที่ได้รับใบกำกับภาษี',
  errClaimTooLate: (invoicePeriod, lastPeriod) => `เกินกำหนดใช้สิทธิ 6 เดือน — ใบกำกับภาษีเดือน ${invoicePeriod} ใช้สิทธิ์ได้ถึงเดือน ${lastPeriod} เท่านั้น (มาตรา 82/3)`,
  errReason: 'กรุณาเลือกเหตุผลที่ไม่ขอใช้สิทธิ์ภาษีซื้อ (ภาษีซื้อต้องห้าม มาตรา 82/5)',
  errDuplicateTaxInvoice: (no, taxId) => `ใบกำกับภาษีเลขที่ ${no} ของผู้ขายเลขประจำตัว ${taxId} ถูกบันทึกแล้ว — ใช้สิทธิ์ภาษีซื้อซ้ำไม่ได้`,
  warnVendorTaxIdCheck: taxId => `เลขประจำตัวผู้เสียภาษีของผู้ขาย ${taxId} หลักสุดท้ายไม่ตรงกับเลขตรวจสอบ — ตรวจกับใบกำกับภาษีอีกครั้ง`,
  warnClaimLater: (claim, received) => `ใช้สิทธิ์ภาษีซื้อเดือน ${claim} (ได้รับใบกำกับภาษีเดือน ${received})`,
  warnAbbreviated: 'ใบกำกับภาษีอย่างย่อใช้เป็นภาษีซื้อไม่ได้ — VAT ของเอกสารนี้บันทึกเป็นต้นทุนค่าใช้จ่าย',
  warnNonClaimable: 'VAT ของเอกสารนี้เป็นภาษีซื้อต้องห้าม — บันทึกรวมเป็นต้นทุนค่าใช้จ่าย ไม่อยู่ในรายงานภาษีซื้อ',
  incompleteBadge: 'ข้อมูล VAT ไม่ครบ',
  incompleteHint: 'บันทึกก่อนมีช่องข้อมูลภาษีซื้อ จึงไม่อยู่ในรายงานภาษีซื้อ — ถ้าจะใช้สิทธิ์ ให้ลบแล้วบันทึกใหม่พร้อมข้อมูลใบกำกับภาษี',
  // ภ.พ.30
  pp30Lines: Object.freeze({
    1: 'ยอดขายในเดือนนี้',
    2: 'ลบ ยอดขายที่เสียภาษีในอัตราร้อยละ 0 (ถ้ามี)',
    3: 'ลบ ยอดขายที่ได้รับยกเว้น (ถ้ามี)',
    4: 'ยอดขายที่ต้องเสียภาษี (1. − 2. − 3.)',
    5: 'ภาษีขายเดือนนี้',
    6: 'ยอดซื้อที่มีสิทธินำภาษีซื้อมาหักในการคำนวณภาษีเดือนนี้',
    7: 'ภาษีซื้อเดือนนี้ (ตามหลักฐานใบกำกับภาษีของยอดซื้อตาม 6.)',
    8: 'ภาษีที่ต้องชำระเดือนนี้ (ถ้า 5. มากกว่า 7.)',
    9: 'ภาษีที่ชำระเกินเดือนนี้ (ถ้า 5. น้อยกว่า 7.)',
    10: 'ภาษีที่ชำระเกินยกมา',
    11: 'ต้องชำระ (ถ้า 8. มากกว่า 10.)',
    12: 'ชำระเกิน (ถ้า 10. มากกว่า 8. หรือ 9. รวมกับ 10.)',
    13: 'เงินเพิ่ม',
    14: 'เบี้ยปรับ',
    15: 'รวมภาษี เงินเพิ่ม และเบี้ยปรับที่ต้องชำระ (11. + 13. + 14.)',
    16: 'รวมภาษีที่ชำระเกินหลังคำนวณเงินเพิ่มและเบี้ยปรับแล้ว (12. − 13. − 14.)'
  }),
  pp30NotComputed: 'ไม่คำนวณในเดโม',
  efilingCheckLatest: 'พ้นช่วงขยายเวลายื่นทางอินเทอร์เน็ต (ถึง 31 ม.ค. 2570) — ตรวจสอบประกาศกรมสรรพากรล่าสุด',
  dueDateHolidayNote: 'วันครบกำหนดยื่นทางอินเทอร์เน็ตเลื่อนเฉพาะวันเสาร์-อาทิตย์ ไม่ได้คิดวันหยุดนักขัตฤกษ์ — ตรวจปฏิทินกรมสรรพากรอีกครั้ง',
  errReturnsStore: 'ข้อมูล ภ.พ.30 ที่บันทึกไว้อ่านไม่ได้หรือไม่ถูกต้อง',
  errReturnField: field => `ข้อมูล ภ.พ.30 ช่อง ${field} ไม่ถูกต้อง`,
  errOverpaidAction: 'มียอดชำระเกิน (บรรทัด 12) — กรุณาเลือก “ขอคืนเป็นเงินสด” หรือ “ขอนำไปชำระในเดือนถัดไป”',
  errCarryForward: 'ภาษีที่ชำระเกินยกมา (บรรทัด 10) ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป'
});

// ---------------------------------------------------------------- constants
// Expense evidence types that carry a tax invoice: the expense form shows the tax fields for them.
export const EXPENSE_TAX_INVOICE_DOC_TYPES = Object.freeze(['tax_invoice', 'receipt_tax_invoice', 'abbreviated_tax_invoice']);
// Purchase documents the official input-tax report may list (§2c rule 1). The received debit /
// credit note types are accepted here for stage D; the expense form does not offer them yet.
export const PURCHASE_REPORT_DOC_TYPES = Object.freeze(['tax_invoice', 'receipt_tax_invoice', 'debit_note_received', 'credit_note_received']);
export const PURCHASE_VAT_MODES = Object.freeze(['extract', 'add', 'none']);
export const VAT_CATEGORIES = Object.freeze(['standard', 'zero', 'exempt']);
export const NON_CLAIMABLE_REASON_CODES = Object.freeze(Object.keys(TAX_CORE_TEXT.nonClaimable));
export const TAX_CLAIM_WINDOW_MONTHS = 6;
export const TAX_ENTRY_WORKING_DAYS = 3;
// ภ.พ.30 deadlines (§0.2): day of the month after the tax month; e-filing +8 days while the extension
// is in force. A config object, not law in code: change it when the Revenue Department announces.
export const TAX_DEADLINES = Object.freeze({ pp30: Object.freeze({ paper: 15, efiling: 23 }), efilingExtensionUntil: '2027-01-31' });
export const PP30_COMPUTED_LINES = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
export const PP30_OUT_OF_SCOPE_LINES = Object.freeze([13, 14, 15, 16]);
export const VAT_FILING_MODES = Object.freeze(['separate', 'combined']);
export const VAT_RETURN_CHANNELS = Object.freeze(['paper', 'efiling']);
export const VAT_OVERPAID_ACTIONS = Object.freeze(['refund', 'carry']);
// The combined (ยื่นรวมกัน) return / report view key, next to the branch ids ubon / khonkaen.
export const TAX_COMBINED_KEY = 'combined';

const TAX_HEAD_OFFICE = '00000';
const taxText = value => String(value ?? '').trim();
const taxFinite = value => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
const taxMoney = value => roundMoneyValue(taxFinite(value));
const taxIsObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const taxHasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

// ---------------------------------------------------------------- periods and dates
// 'YYYY-MM' of an ISO business date ('' when the date is not a real calendar date).
export function taxPeriodOfDate(value) {
  const parts = parseBusinessDate(taxText(value).slice(0, 10));
  return parts ? `${parts.year}-${String(parts.month).padStart(2, '0')}` : '';
}
// 'YYYY-MM' → { year, month (1–12) } or null.
export function parseTaxPeriod(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(taxText(value));
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]);
  if (year < 2000 || year > 2200 || month < 1 || month > 12) return null;
  return { year, month };
}
export function taxPeriodIndex(value) {
  const period = parseTaxPeriod(value);
  return period ? period.year * 12 + period.month - 1 : NaN;
}
export function taxPeriodFromIndex(index) {
  const year = Math.floor(index / 12), month = index - year * 12 + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}
export function addTaxPeriods(value, months) {
  const index = taxPeriodIndex(value);
  return Number.isFinite(index) ? taxPeriodFromIndex(index + Math.trunc(taxFinite(months))) : '';
}
// "กันยายน 2569"
export function taxPeriodLabel(value) {
  const period = parseTaxPeriod(value);
  return period ? `${TAX_CORE_TEXT.monthNames[period.month - 1]} ${period.year + 543}` : '';
}
// "09/2569"
export function taxPeriodShort(value) {
  const period = parseTaxPeriod(value);
  return period ? `${String(period.month).padStart(2, '0')}/${period.year + 543}` : '';
}
// Last calendar day of the tax month: '2026-09-30'.
export function taxPeriodLastDay(value) {
  const period = parseTaxPeriod(value);
  if (!period) return '';
  const day = new Date(Date.UTC(period.year, period.month, 0)).getUTCDate();
  return `${period.year}-${String(period.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
export function taxPeriodFirstDay(value) {
  return parseTaxPeriod(value) ? `${taxText(value)}-01` : '';
}
// dd/mm/yyyy (พ.ศ.), as on the official form; '' for an invalid date.
export function taxThaiDate(value) {
  const parts = parseBusinessDate(taxText(value).slice(0, 10));
  return parts ? `${String(parts.day).padStart(2, '0')}/${String(parts.month).padStart(2, '0')}/${parts.year + 543}` : '';
}
const taxIsoFromOrdinal = ordinal => {
  const date = new Date(ordinal * 86400000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
};
const taxWeekday = ordinal => new Date(ordinal * 86400000).getUTCDay(); // 0 = Sunday, 6 = Saturday
// The date `days` working days (Mon–Fri; public holidays not modelled) after an ISO date.
export function addTaxWorkingDays(value, days) {
  let ordinal = businessDateOrdinal(value);
  if (!Number.isFinite(ordinal)) return '';
  let left = Math.max(0, Math.trunc(taxFinite(days)));
  while (left > 0) { ordinal += 1; const day = taxWeekday(ordinal); if (day !== 0 && day !== 6) left -= 1; }
  return taxIsoFromOrdinal(ordinal);
}
// Saturday / Sunday → the next Monday (public holidays are not modelled).
export function rollTaxWeekend(value) {
  let ordinal = businessDateOrdinal(value);
  if (!Number.isFinite(ordinal)) return '';
  while ([0, 6].includes(taxWeekday(ordinal))) ordinal += 1;
  return taxIsoFromOrdinal(ordinal);
}
// The local calendar date a record was entered: createdAt (ISO instant) or a Date.now() style id;
// '' when unknown (the sample data's reserved 1e12 ids → 2001 never count as late).
export function taxEntryDateOf(record = {}, toLocalDate = instant => instant.toISOString().slice(0, 10)) {
  const created = taxText(record.createdAt);
  let instant = created && !Number.isNaN(Date.parse(created)) ? new Date(created) : null;
  if (!instant) {
    const id = Number(record.id);
    if (Number.isFinite(id) && id >= 1.5e12 && id < 4.1e12) instant = new Date(id);
  }
  return instant ? taxText(toLocalDate(instant)).slice(0, 10) : '';
}
// Entered more than 3 working days after the reference date (§1c rule 12 / §2a — informational).
export function isLateTaxEntry(referenceDate, entryDate) {
  const deadline = addTaxWorkingDays(referenceDate, TAX_ENTRY_WORKING_DAYS);
  const entry = businessDateOrdinal(entryDate);
  return !!deadline && Number.isFinite(entry) && entry > businessDateOrdinal(deadline);
}

// ---------------------------------------------------------------- tax IDs and establishments
export function normalizeTaxIdText(value) {
  return taxText(value).replace(/[\s-]/g, '');
}
export function isThirteenDigitTaxId(value) {
  return /^\d{13}$/.test(normalizeTaxIdText(value));
}
// Check digit (the company-profile validator, ADR-020).
export function taxIdCheckDigitOk(value) {
  return isValidThaiTaxId(normalizeTaxIdText(value));
}
// Establishment code from a stored code or a printed label ("สำนักงานใหญ่", "สาขาที่ 00003 (…)").
export function establishmentCodeOf(code, label) {
  const direct = normalizeBuyerBranchCode(code);
  if (direct) return direct;
  const text = taxText(label);
  if (!text) return '';
  const numbered = /สาขาที่\s*(\d{5})/.exec(text);
  if (numbered) return numbered[1];
  return /สำนักงานใหญ่|head\s*office/i.test(text) ? TAX_HEAD_OFFICE : '';
}
// Supplier master "สำนักงานใหญ่ / สาขาที่" input (G5), the same rule as the buyer branch (ADR-021):
// kind 'hq' → 00000; 'branch' → five digits ≠ 00000; '' → not stated. A 1–5 digit code typed in the
// master is padded like buyerBranchFromContact() does.
export function parseSupplierBranchInput(kind, code) {
  if (kind === 'hq') return { ok: true, code: TAX_HEAD_OFFICE };
  if (kind !== 'branch') return { ok: true, code: '' };
  const raw = taxText(code);
  const value = /^\d{1,5}$/.test(raw) ? raw.padStart(5, '0') : raw;
  if (!/^\d{5}$/.test(value) || value === TAX_HEAD_OFFICE) return { ok: false, error: TAX_CORE_TEXT.errVendorBranch };
  return { ok: true, code: value };
}
// A supplier-master row's establishment for the expense form (autofill): '00000' / five digits / ''.
export function supplierEstablishmentOf(contact = {}) {
  const raw = taxText(contact?.branchCode);
  if (/^\d{1,5}$/.test(raw)) return raw.padStart(5, '0');
  return establishmentCodeOf('', contact?.branchName);
}
// Duplicate key of a received tax invoice: seller TIN + tax-invoice number (§2c rule 6); '' when either
// part is missing (no tax-invoice duplicate check then, the older vendor + number check still runs).
export function expenseTaxInvoiceKey(vendorTaxId, taxInvoiceNo) {
  const taxId = normalizeTaxIdText(vendorTaxId), no = taxText(taxInvoiceNo).toUpperCase().replace(/\s+/g, '');
  return /^\d{13}$/.test(taxId) && no ? `${taxId}|${no}` : '';
}

// ---------------------------------------------------------------- VAT category (G4)
// 'standard' for any VAT invoice; for a no-VAT invoice the stored choice 'zero' (0 %, export) or
// 'exempt' — legacy no-VAT invoices without a choice are treated as exempt and flagged (§1c rule 6).
export function invoiceVatCategoryOf(record = {}) {
  if (creditNoteVatModeOf(record) !== 'none') return 'standard';
  return record.vatCategory === 'zero' ? 'zero' : 'exempt';
}
export function isLegacyNoVatInvoice(record = {}) {
  return creditNoteVatModeOf(record) === 'none' && record.vatCategory !== 'zero' && record.vatCategory !== 'exempt';
}
// What an invoice save stores: VAT modes 'add' / 'extract' are always 'standard'; 'none' keeps a
// valid choice ('zero' | 'exempt'), anything else becomes 'exempt' (the safe default: not reported as 0 %).
export function normalizeInvoiceVatCategory(vatMode, chosen) {
  if (vatMode === 'add' || vatMode === 'extract') return 'standard';
  return chosen === 'zero' ? 'zero' : 'exempt';
}

// ---------------------------------------------------------------- expense purchase-tax fields (G11)
export const EXPENSE_VAT_FIELD_KEYS = Object.freeze(['vendorId', 'vendorTaxId', 'vendorBranchCode', 'vendorAddress', 'vatMode', 'subtotal', 'vatAmt', 'taxInvoiceNo', 'taxInvoiceDate', 'taxInvoiceReceivedDate', 'claimPeriod', 'inputVatClaimable', 'nonClaimableReason', 'vatCategory']);

// Does a stored expense carry the purchase-VAT split (§2d)? Older expenses only have `amount`.
export function expenseHasVatData(expense = {}) {
  return PURCHASE_VAT_MODES.includes(expense?.vatMode)
    && Number.isFinite(Number(expense.subtotal)) && expense.subtotal !== '' && expense.subtotal !== null
    && Number.isFinite(Number(expense.vatAmt)) && expense.vatAmt !== '' && expense.vatAmt !== null;
}
// "ข้อมูล VAT ไม่ครบ": an expense that is (or says it has) a tax invoice but has no VAT split.
export function expenseVatIncomplete(expense = {}) {
  if (expenseHasVatData(expense)) return false;
  return EXPENSE_TAX_INVOICE_DOC_TYPES.includes(expense?.docType) || expense?.taxStatus === 'received';
}

// The purchase-tax part of an expense draft (the form sends vatMode + the fields below only for a
// tax-invoice evidence type). Never throws: { ok: false, error } or { ok: true, fields, warnings }.
// `fields` null = no tax fields to store (not a tax-invoice evidence type, or an older caller that sent
// no vatMode) — the expense is then exactly what it was before ADR-023.
// draft: { docType, taxStatus, docNo, vendor, amount (as typed), vatMode, vendorId, vendorTaxId,
//          vendorBranchCode, vendorAddress, taxInvoiceDate, taxInvoiceReceivedDate, claimPeriod,
//          inputVatClaimable, nonClaimableReason }
export function planExpenseVatFields(draft = {}) {
  const docType = taxText(draft.docType);
  if (!EXPENSE_TAX_INVOICE_DOC_TYPES.includes(docType) || !taxHasOwn(draft, 'vatMode')) return { ok: true, fields: null, warnings: [] };
  const vatMode = taxText(draft.vatMode);
  if (!PURCHASE_VAT_MODES.includes(vatMode)) return { ok: false, error: TAX_CORE_TEXT.errVatMode };
  const split = calculateVatSummary(taxFinite(draft.amount), vatMode);
  const abbreviated = docType === 'abbreviated_tax_invoice';
  const hasVat = split.vatAmt > 0;
  const warnings = [];
  const vendor = taxText(draft.vendor);
  const vendorTaxId = normalizeTaxIdText(draft.vendorTaxId);
  const vendorBranchCode = normalizeBuyerBranchCode(draft.vendorBranchCode);
  const taxInvoiceNo = taxText(draft.docNo);
  const taxInvoiceDate = taxText(draft.taxInvoiceDate).slice(0, 10);
  const receivedDate = taxText(draft.taxInvoiceReceivedDate).slice(0, 10) || taxInvoiceDate;
  // Only a full tax invoice with VAT can be claimed; the user may decline (with a 82/5 reason).
  const claimable = hasVat && !abbreviated && draft.inputVatClaimable !== false;
  let reason = '';
  if (hasVat && !claimable) {
    reason = abbreviated ? 'abbreviated' : taxText(draft.nonClaimableReason);
    if (!NON_CLAIMABLE_REASON_CODES.includes(reason)) return { ok: false, error: TAX_CORE_TEXT.errReason };
    warnings.push(abbreviated ? TAX_CORE_TEXT.warnAbbreviated : TAX_CORE_TEXT.warnNonClaimable);
  }
  if (taxInvoiceDate && !parseBusinessDate(taxInvoiceDate)) return { ok: false, error: TAX_CORE_TEXT.errTaxInvoiceDate };
  if (receivedDate && !parseBusinessDate(receivedDate)) return { ok: false, error: TAX_CORE_TEXT.errReceivedDate };
  if (taxInvoiceDate && receivedDate && businessDateOrdinal(receivedDate) < businessDateOrdinal(taxInvoiceDate)) return { ok: false, error: TAX_CORE_TEXT.errReceivedBeforeInvoice };
  if (vendorTaxId && !/^\d{13}$/.test(vendorTaxId)) return { ok: false, error: TAX_CORE_TEXT.errVendorTaxId };
  if (vendorTaxId && !isValidThaiTaxId(vendorTaxId)) warnings.push(TAX_CORE_TEXT.warnVendorTaxIdCheck(vendorTaxId));
  if (taxText(draft.vendorBranchCode) && !vendorBranchCode) return { ok: false, error: TAX_CORE_TEXT.errVendorBranch };
  let claimPeriod = '';
  if (claimable) {
    if (taxText(draft.taxStatus) !== 'received') return { ok: false, error: TAX_CORE_TEXT.errNeedsReceived };
    if (!vendor) return { ok: false, error: TAX_CORE_TEXT.errVendorName };
    if (!vendorTaxId) return { ok: false, error: TAX_CORE_TEXT.errVendorTaxId };
    if (!vendorBranchCode) return { ok: false, error: TAX_CORE_TEXT.errVendorBranch };
    if (!taxInvoiceNo) return { ok: false, error: TAX_CORE_TEXT.errTaxInvoiceNo };
    if (!taxInvoiceDate) return { ok: false, error: TAX_CORE_TEXT.errTaxInvoiceDate };
    if (!receivedDate) return { ok: false, error: TAX_CORE_TEXT.errReceivedDate };
    const receivedPeriod = taxPeriodOfDate(receivedDate), invoicePeriod = taxPeriodOfDate(taxInvoiceDate);
    claimPeriod = taxText(draft.claimPeriod) || receivedPeriod;
    if (!parseTaxPeriod(claimPeriod)) return { ok: false, error: TAX_CORE_TEXT.errClaimPeriod };
    if (taxPeriodIndex(claimPeriod) < taxPeriodIndex(receivedPeriod)) return { ok: false, error: TAX_CORE_TEXT.errClaimBeforeReceived };
    if (taxPeriodIndex(claimPeriod) - taxPeriodIndex(invoicePeriod) > TAX_CLAIM_WINDOW_MONTHS) {
      return { ok: false, error: TAX_CORE_TEXT.errClaimTooLate(taxPeriodShort(invoicePeriod), taxPeriodShort(addTaxPeriods(invoicePeriod, TAX_CLAIM_WINDOW_MONTHS))) };
    }
    if (claimPeriod !== receivedPeriod) warnings.push(TAX_CORE_TEXT.warnClaimLater(taxPeriodShort(claimPeriod), taxPeriodShort(receivedPeriod)));
  }
  const fields = {
    vendorId: taxText(draft.vendorId),
    vendorTaxId,
    vendorBranchCode,
    vendorAddress: taxText(draft.vendorAddress),
    vatMode,
    subtotal: split.subtotal,
    vatAmt: split.vatAmt,
    amount: split.total,
    taxInvoiceNo,
    taxInvoiceDate,
    taxInvoiceReceivedDate: receivedDate,
    claimPeriod,
    inputVatClaimable: claimable,
    nonClaimableReason: reason,
    vatCategory: vatMode === 'none' ? 'exempt' : 'standard'
  };
  return { ok: true, fields, warnings };
}

// ---------------------------------------------------------------- column definitions (§1b / §2b)
// One definition for screen, print, Excel and CSV (AC1.8): `group` = the two-row header of the form.
const taxCol = (key, label, group = '', money = false) => Object.freeze({ key, label, group, money });
export const SALES_REPORT_COLUMNS = Object.freeze([
  taxCol('seq', TAX_CORE_TEXT.colSeq),
  taxCol('date', TAX_CORE_TEXT.colDate, TAX_CORE_TEXT.colTaxInvoice),
  taxCol('no', TAX_CORE_TEXT.colNo, TAX_CORE_TEXT.colTaxInvoice),
  taxCol('party', TAX_CORE_TEXT.colBuyer),
  taxCol('taxId', TAX_CORE_TEXT.colBuyerTaxId),
  taxCol('headOffice', TAX_CORE_TEXT.colHeadOffice, TAX_CORE_TEXT.colEstablishment),
  taxCol('branchNo', TAX_CORE_TEXT.colBranchNo, TAX_CORE_TEXT.colEstablishment),
  taxCol('value', TAX_CORE_TEXT.colValue, '', true),
  taxCol('vat', TAX_CORE_TEXT.colVat, '', true),
  taxCol('total', TAX_CORE_TEXT.colTotal, '', true),
  taxCol('note', TAX_CORE_TEXT.colNote)
]);
export const PURCHASE_REPORT_COLUMNS = Object.freeze([
  taxCol('seq', TAX_CORE_TEXT.colSeq),
  taxCol('date', TAX_CORE_TEXT.colDate, TAX_CORE_TEXT.colTaxInvoice),
  taxCol('no', TAX_CORE_TEXT.colNo, TAX_CORE_TEXT.colTaxInvoice),
  taxCol('party', TAX_CORE_TEXT.colSeller),
  taxCol('taxId', TAX_CORE_TEXT.colSellerTaxId),
  taxCol('headOffice', TAX_CORE_TEXT.colHeadOffice, TAX_CORE_TEXT.colEstablishment),
  taxCol('branchNo', TAX_CORE_TEXT.colBranchNo, TAX_CORE_TEXT.colEstablishment),
  taxCol('value', TAX_CORE_TEXT.colValue, '', true),
  taxCol('vat', TAX_CORE_TEXT.colVat, '', true),
  taxCol('note', TAX_CORE_TEXT.colNote)
]);
export const FORBIDDEN_REPORT_COLUMNS = Object.freeze([
  taxCol('seq', TAX_CORE_TEXT.colSeq),
  taxCol('date', TAX_CORE_TEXT.colDate, TAX_CORE_TEXT.colTaxInvoice),
  taxCol('no', TAX_CORE_TEXT.colNo, TAX_CORE_TEXT.colTaxInvoice),
  taxCol('party', TAX_CORE_TEXT.colSeller),
  taxCol('taxId', TAX_CORE_TEXT.colSellerTaxId),
  taxCol('value', TAX_CORE_TEXT.colValue, '', true),
  taxCol('vat', TAX_CORE_TEXT.colVat, '', true),
  taxCol('note', TAX_CORE_TEXT.colReason)
]);

// ---------------------------------------------------------------- sales tax report (§1)
const taxSortRows = rows => rows.sort((a, b) => (businessDateOrdinal(a.date) || 0) - (businessDateOrdinal(b.date) || 0)
  || taxText(a.no).localeCompare(taxText(b.no), 'en', { numeric: true })
  || taxText(a.branch).localeCompare(taxText(b.branch)));
const taxRowBase = (record, extra) => ({ branch: '', date: taxText(record?.date).slice(0, 10), no: taxText(record?.no), party: '', taxId: '', branchCode: '', value: 0, vat: 0, total: 0, note: '', flags: [], refs: [], ...extra });
const taxNotesOf = record => (Array.isArray(record?.lines) ? record.lines : []).map(line => taxText(line?.invoiceNo)).filter(Boolean);
const taxRefNos = record => [...new Set([...(Array.isArray(record?.invoiceNos) ? record.invoiceNos.map(taxText) : []), ...taxNotesOf(record)].filter(Boolean))];

// The VAT category of a credit / debit note: by its own VAT mode, or (no VAT) by the invoices it adjusts.
function taxAdjustmentCategory(note, branch, invoiceLookup) {
  if (creditNoteVatModeOf(note) !== 'none' || taxFinite(note.vatAmt) !== 0) return 'standard';
  const lines = Array.isArray(note.lines) && note.lines.length ? note.lines : taxRefNos(note).map(invoiceNo => ({ invoiceNo }));
  const categories = lines.map(line => {
    const invoice = typeof invoiceLookup === 'function' ? invoiceLookup(taxText(line.invoiceBranch) || branch, taxText(line.invoiceNo)) : null;
    return invoice ? invoiceVatCategoryOf(invoice) : 'exempt';
  });
  return categories.includes('zero') ? 'zero' : 'exempt';
}

// input: { period: 'YYYY-MM', sources: [{ branch, invoices, creditNotes, debitNotes }] (the stored pack
//   of that tax month per establishment; one source = one establishment, several = combined view),
//   invoiceLookup(branch, invoiceNo) → invoice | null (no-VAT credit notes), abbreviatedMode 'daily' |
//   'each', entryDate(record) → 'YYYY-MM-DD' | '' (late-entry check) }
export function buildSalesTaxReport(input = {}) {
  const period = taxText(input.period);
  const abbreviatedMode = input.abbreviatedMode === 'each' ? 'each' : 'daily';
  const entryDate = typeof input.entryDate === 'function' ? input.entryDate : record => taxEntryDateOf(record);
  const rows = [];
  const included = { invoices: [], creditNotes: [], debitNotes: [] };
  const exempt = { invoices: [], creditNotes: [], debitNotes: [] };
  const zero = { invoices: [], creditNotes: [], debitNotes: [] };
  const warnings = { legacyNoVat: [], exemptSales: [], missingBuyerTaxId: [], lateEntries: [], outsidePeriod: [], integrity: [] };
  let skippedCopies = 0;
  const abbreviatedDays = new Map();
  const sources = Array.isArray(input.sources) ? input.sources : [];
  for (const source of sources) {
    const branch = taxText(source?.branch);
    for (const invoice of Array.isArray(source?.invoices) ? source.invoices : []) {
      if (!invoice || typeof invoice !== 'object') continue;
      // §1c rule 10: a printed copy kept in the invoice pack (old data) is the same tax invoice.
      if (invoice.documentKind === 'delivery-tax-invoice') { skippedCopies += 1; continue; }
      const live = creditNoteInvoiceLive(invoice);
      const category = invoiceVatCategoryOf(invoice);
      const basis = creditNoteInvoiceBasis(invoice);
      if (period && taxPeriodOfDate(invoice.date) && taxPeriodOfDate(invoice.date) !== period) warnings.outsidePeriod.push(TAX_CORE_TEXT.dateOutsidePeriod(taxText(invoice.no), taxThaiDate(invoice.date)));
      if (category === 'exempt') {
        if (!live) continue; // not a tax invoice: a cancelled no-VAT invoice is not reported anywhere
        exempt.invoices.push(invoice);
        const item = { branch, no: taxText(invoice.no), date: taxText(invoice.date).slice(0, 10), customer: taxText(invoice.customer), value: basis.value };
        (isLegacyNoVatInvoice(invoice) ? warnings.legacyNoVat : warnings.exemptSales).push(item);
        continue;
      }
      if (live) { included.invoices.push(invoice); if (category === 'zero') zero.invoices.push(invoice); }
      const abbreviated = effectiveTaxInvoiceForm(invoice) === 'abbreviated';
      if (abbreviated && abbreviatedMode === 'daily') {
        const key = `${branch}|${taxText(invoice.date).slice(0, 10)}`;
        if (!abbreviatedDays.has(key)) abbreviatedDays.set(key, { branch, date: taxText(invoice.date).slice(0, 10), live: [], cancelled: [] });
        abbreviatedDays.get(key)[live ? 'live' : 'cancelled'].push({ invoice, basis });
        continue;
      }
      const party = abbreviated && isGeneralCustomerName(invoice.customer) ? TAX_CORE_TEXT.abbreviatedParty : (taxText(invoice.customer) || GENERAL_CUSTOMER_NAME);
      const row = taxRowBase(invoice, { kind: live ? 'invoice' : 'cancelled', branch, party, taxId: abbreviated ? '' : normalizeTaxIdText(invoice.customerTaxId), branchCode: abbreviated ? '' : establishmentCodeOf(invoice.customerBranchCode, invoice.customerBranchName), refs: [taxText(invoice.no)] });
      if (live) {
        Object.assign(row, { value: basis.value, vat: basis.vat, total: basis.total, note: category === 'zero' ? TAX_CORE_TEXT.zeroRatedNote : '' });
        if (!abbreviated && !row.taxId) { row.flags.push('missingBuyerTaxId'); warnings.missingBuyerTaxId.push({ branch, no: row.no, customer: row.party }); }
      } else {
        row.note = TAX_CORE_TEXT.cancelledNote(taxText(invoice.voidReason || invoice.cancelReason));
      }
      if (live && isLateTaxEntry(row.date, entryDate(invoice))) { row.flags.push('lateEntry'); warnings.lateEntries.push({ branch, no: row.no }); }
      rows.push(row);
    }
    for (const [collection, sign, kind, noteOf] of [['creditNotes', -1, 'credit_note', TAX_CORE_TEXT.creditNoteNote], ['debitNotes', 1, 'debit_note', TAX_CORE_TEXT.debitNoteNote]]) {
      for (const note of Array.isArray(source?.[collection]) ? source[collection] : []) {
        if (!note || typeof note !== 'object' || !isCreditNoteLive(note)) continue; // a cancelled CN / DN is omitted (§1c rule 5)
        const category = taxAdjustmentCategory(note, branch, input.invoiceLookup);
        if (category === 'exempt') { exempt[collection].push(note); continue; }
        included[collection].push(note);
        if (category === 'zero') zero[collection].push(note);
        const refs = taxRefNos(note);
        const row = taxRowBase(note, {
          kind, branch, party: taxText(note.customer), taxId: normalizeTaxIdText(note.customerTaxId),
          branchCode: establishmentCodeOf(note.customerBranchCode, note.customerBranch),
          value: taxMoney(sign * taxFinite(note.subtotal)), vat: taxMoney(sign * taxFinite(note.vatAmt)), total: taxMoney(sign * taxFinite(note.total)),
          note: noteOf(refs), refs
        });
        if (period && taxPeriodOfDate(note.date) && taxPeriodOfDate(note.date) !== period) warnings.outsidePeriod.push(TAX_CORE_TEXT.dateOutsidePeriod(row.no, taxThaiDate(note.date)));
        if (isLateTaxEntry(row.date, entryDate(note))) { row.flags.push('lateEntry'); warnings.lateEntries.push({ branch, no: row.no }); }
        rows.push(row);
      }
    }
  }
  // §1c rule 2: abbreviated tax invoices → one line per day: "first – last", sum of stored values.
  for (const day of abbreviatedDays.values()) {
    const all = [...day.live, ...day.cancelled].sort((a, b) => taxText(a.invoice.no).localeCompare(taxText(b.invoice.no), 'en', { numeric: true }));
    const nos = all.map(entry => taxText(entry.invoice.no));
    const value = taxMoney(day.live.reduce((sum, entry) => sum + entry.basis.value, 0));
    const vat = taxMoney(day.live.reduce((sum, entry) => sum + entry.basis.vat, 0));
    const total = taxMoney(day.live.reduce((sum, entry) => sum + entry.basis.total, 0));
    const notes = [TAX_CORE_TEXT.abbreviatedDayNote(day.live.length)];
    if (day.cancelled.length) notes.push(TAX_CORE_TEXT.abbreviatedCancelledNote(day.cancelled.map(entry => taxText(entry.invoice.no))));
    rows.push(taxRowBase({ date: day.date }, {
      kind: 'abbreviated_day', branch: day.branch, no: nos.length > 1 ? `${nos[0]} – ${nos[nos.length - 1]}` : nos[0] || '',
      party: TAX_CORE_TEXT.abbreviatedParty, value, vat, total, note: notes.join(' · '), refs: nos
    }));
  }
  taxSortRows(rows);
  rows.forEach((row, index) => { row.seq = index + 1; });
  // Footer through the one output-VAT engine (summarizeOutputVat); the rows must add up to it.
  const engine = summarizeOutputVat({ invoices: included.invoices, creditNotes: included.creditNotes, debitNotes: included.debitNotes });
  const totals = { value: engine.netSalesValue, vat: engine.netOutputVat, total: taxMoney(engine.netSalesValue + engine.netOutputVat) };
  const rowSum = { value: taxMoney(rows.reduce((s, r) => s + r.value, 0)), vat: taxMoney(rows.reduce((s, r) => s + r.vat, 0)) };
  if (Math.abs(rowSum.value - totals.value) > 0.001 || Math.abs(rowSum.vat - totals.vat) > 0.001) warnings.integrity.push(TAX_CORE_TEXT.footerMismatch);
  const zeroSum = summarizeOutputVat(zero);
  const exemptSum = summarizeOutputVat(exempt);
  return {
    kind: 'sales', period, abbreviatedMode, rows, totals,
    zeroValue: zeroSum.netSalesValue,
    exemptValue: exemptSum.netSalesValue,
    engine, skippedCopies, warnings,
    counts: { invoices: included.invoices.length, creditNotes: included.creditNotes.length, debitNotes: included.debitNotes.length, exemptInvoices: exempt.invoices.length }
  };
}

// ---------------------------------------------------------------- purchase tax report (§2)
// The tax month an expense belongs to when it is NOT claimed: the month of its tax invoice, else
// the month of the expense itself.
export function expenseTaxMonth(expense = {}) {
  return taxText(expense.claimPeriod) || taxPeriodOfDate(expense.taxInvoiceDate) || taxPeriodOfDate(expense.date);
}

// input: { period, sources: [{ branch, expenses }] — every stored expense of the establishment (a claim
//   may sit in an earlier pack than its claim month), entryDate(record) }
export function buildPurchaseTaxReport(input = {}) {
  const period = taxText(input.period);
  const entryDate = typeof input.entryDate === 'function' ? input.entryDate : record => taxEntryDateOf(record);
  const rows = [], forbidden = [], incomplete = [], deferred = [];
  const lateEntries = [];
  for (const source of Array.isArray(input.sources) ? input.sources : []) {
    const branch = taxText(source?.branch);
    for (const expense of Array.isArray(source?.expenses) ? source.expenses : []) {
      if (!expense || typeof expense !== 'object' || expense.voided === true || expense.deleted === true) continue;
      if (!expenseHasVatData(expense)) {
        if (expenseVatIncomplete(expense) && taxPeriodOfDate(expense.date) === period) incomplete.push({ branch, id: expense.id, date: taxText(expense.date).slice(0, 10), vendor: taxText(expense.vendor), desc: taxText(expense.desc), docNo: taxText(expense.docNo), amount: taxMoney(expense.amount) });
        continue;
      }
      const vat = taxMoney(expense.vatAmt), value = taxMoney(expense.subtotal);
      if (!(vat > 0)) continue; // nothing to claim or to disallow
      const docType = taxText(expense.docType);
      const claimable = expense.inputVatClaimable === true && PURCHASE_REPORT_DOC_TYPES.includes(docType);
      const base = {
        branch, id: expense.id, date: taxText(expense.taxInvoiceDate || expense.date).slice(0, 10), no: taxText(expense.taxInvoiceNo || expense.docNo),
        party: taxText(expense.vendor), taxId: normalizeTaxIdText(expense.vendorTaxId), branchCode: normalizeBuyerBranchCode(expense.vendorBranchCode),
        receivedDate: taxText(expense.taxInvoiceReceivedDate || expense.taxInvoiceDate || expense.date).slice(0, 10), flags: []
      };
      if (!claimable) {
        if (expenseTaxMonth(expense) !== period) continue;
        const reason = docType === 'abbreviated_tax_invoice' ? 'abbreviated' : (NON_CLAIMABLE_REASON_CODES.includes(expense.nonClaimableReason) ? expense.nonClaimableReason : 'other');
        forbidden.push({ ...base, kind: 'forbidden', value, vat, reason, note: TAX_CORE_TEXT.nonClaimable[reason] });
        continue;
      }
      if (taxText(expense.claimPeriod) !== period) {
        if (taxPeriodOfDate(expense.taxInvoiceDate) === period || taxPeriodOfDate(expense.taxInvoiceReceivedDate) === period) deferred.push({ ...base, value, vat, claimPeriod: taxText(expense.claimPeriod) });
        continue;
      }
      const sign = docType === 'credit_note_received' ? -1 : 1;
      const notes = [TAX_CORE_TEXT.receivedNote(taxThaiDate(base.receivedDate))];
      if (docType === 'credit_note_received') notes.push(TAX_CORE_TEXT.creditNoteReceivedNote);
      if (docType === 'debit_note_received') notes.push(TAX_CORE_TEXT.debitNoteReceivedNote);
      const invoicePeriod = taxPeriodOfDate(expense.taxInvoiceDate);
      if (invoicePeriod && invoicePeriod !== period) notes.push(TAX_CORE_TEXT.invoiceMonthNote(taxPeriodShort(invoicePeriod)));
      const row = { ...base, kind: sign < 0 ? 'credit_note_received' : 'purchase', value: taxMoney(sign * value), vat: taxMoney(sign * vat), note: notes.join(' · ') };
      if (isLateTaxEntry(base.receivedDate, entryDate(expense))) { row.flags.push('lateEntry'); row.note += ` · ${TAX_CORE_TEXT.lateEntryNote}`; lateEntries.push({ branch, no: row.no }); }
      rows.push(row);
    }
  }
  // §2c rule 7: in the order the tax invoices were received.
  rows.sort((a, b) => (businessDateOrdinal(a.receivedDate) || 0) - (businessDateOrdinal(b.receivedDate) || 0) || (businessDateOrdinal(a.date) || 0) - (businessDateOrdinal(b.date) || 0) || a.no.localeCompare(b.no, 'en', { numeric: true }));
  rows.forEach((row, index) => { row.seq = index + 1; });
  forbidden.sort((a, b) => (businessDateOrdinal(a.date) || 0) - (businessDateOrdinal(b.date) || 0) || a.no.localeCompare(b.no, 'en', { numeric: true }));
  forbidden.forEach((row, index) => { row.seq = index + 1; });
  const sum = (list, key) => taxMoney(list.reduce((s, r) => s + r[key], 0));
  return {
    kind: 'purchase', period, rows,
    totals: { value: sum(rows, 'value'), vat: sum(rows, 'vat') },
    forbidden, forbiddenTotals: { value: sum(forbidden, 'value'), vat: sum(forbidden, 'vat') },
    incomplete, deferred, warnings: { lateEntries }
  };
}

// ---------------------------------------------------------------- table form (print / Excel / CSV)
// → { columns, header: [labels], groups: [{label, from, span}], body: [[cells]], footer: [cells] }
// Money cells stay numbers (Excel keeps them numeric); dates are พ.ศ. text as on the form.
export function taxReportTable(report = {}, kind = report.kind) {
  const columns = kind === 'sales' ? SALES_REPORT_COLUMNS : kind === 'forbidden' ? FORBIDDEN_REPORT_COLUMNS : PURCHASE_REPORT_COLUMNS;
  const list = kind === 'forbidden' ? report.forbidden || [] : report.rows || [];
  const totals = kind === 'forbidden' ? report.forbiddenTotals || {} : report.totals || {};
  const cell = (row, key) => {
    if (key === 'date') return taxThaiDate(row.date);
    if (key === 'headOffice') return row.branchCode === TAX_HEAD_OFFICE ? TAX_CORE_TEXT.headOfficeMark : '';
    if (key === 'branchNo') return row.branchCode && row.branchCode !== TAX_HEAD_OFFICE ? row.branchCode : '';
    if (key === 'total') return taxMoney(row.total);
    if (key === 'value' || key === 'vat') return taxMoney(row[key]);
    return row[key] ?? '';
  };
  const body = list.map(row => columns.map(column => cell(row, column.key)));
  const footer = columns.map((column, index) => {
    if (index === 0) return TAX_CORE_TEXT.totalLabel;
    if (column.key === 'value' || column.key === 'vat' || column.key === 'total') return taxMoney(totals[column.key]);
    return '';
  });
  const groups = [];
  columns.forEach((column, index) => {
    const last = groups[groups.length - 1];
    if (column.group && last && last.label === column.group && last.from + last.span === index) last.span += 1;
    else groups.push({ label: column.group || column.label, from: index, span: 1, grouped: !!column.group });
  });
  return { columns, header: columns.map(column => column.label), groups, body, footer };
}
// CSV text (UTF-8 BOM for Excel, CRLF, RFC 4180 quoting; formula-looking text is prefixed with ').
export function taxCsvText(rows = []) {
  const escape = value => {
    let text = typeof value === 'number' ? String(value) : String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text) && typeof value !== 'number') text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `﻿${rows.map(row => row.map(escape).join(',')).join('\r\n')}`;
}
// Excel sheet names: no / \ ? * [ ] : , not blank, at most 31 characters, no leading/trailing '.
export function taxSafeSheetName(name, fallback = 'Sheet1') {
  const text = String(name ?? '').replace(/[/\\?*[\]:]/g, '-').replace(/[\u0000-\u001f]/g, '').replace(/^'+|'+$/g, '').trim().slice(0, 31).trim();
  return text || fallback;
}

// ---------------------------------------------------------------- ภ.พ.30 (§3)
// Lines 1–12 from the two reports of the same establishment(s) and month — lines 5 / 7 ARE the
// report footers (single source). carryForwardIn = line 10.
export function buildPp30Summary(input = {}) {
  const sales = input.sales || {}, purchases = input.purchases || {};
  const salesTotals = sales.totals || {}, purchaseTotals = purchases.totals || {};
  const lines = {};
  lines[1] = taxMoney(taxFinite(salesTotals.value) + taxFinite(sales.exemptValue));
  lines[2] = taxMoney(sales.zeroValue);
  lines[3] = taxMoney(sales.exemptValue);
  lines[4] = taxMoney(lines[1] - lines[2] - lines[3]);
  lines[5] = taxMoney(salesTotals.vat);
  lines[6] = taxMoney(purchaseTotals.value);
  lines[7] = taxMoney(purchaseTotals.vat);
  lines[8] = taxMoney(Math.max(0, lines[5] - lines[7]));
  lines[9] = taxMoney(Math.max(0, lines[7] - lines[5]));
  lines[10] = taxMoney(Math.max(0, taxFinite(input.carryForwardIn)));
  lines[11] = taxMoney(Math.max(0, lines[8] - lines[10]));
  lines[12] = lines[9] > 0 ? taxMoney(lines[9] + lines[10]) : taxMoney(Math.max(0, lines[10] - lines[8]));
  return { period: taxText(input.period || sales.period || purchases.period), lines, payable: lines[11], overpaid: lines[12] };
}

// Due dates of a tax month (§0.2): paper the 15th of the next month; e-filing the 23rd while the
// extension lasts (else the 15th + "check the latest announcement"), moved past Saturday / Sunday.
export function pp30DueDates(period, deadlines = TAX_DEADLINES) {
  const next = addTaxPeriods(period, 1);
  if (!next) return null;
  const day = value => `${next}-${String(value).padStart(2, '0')}`;
  const paper = day(deadlines.pp30.paper);
  const extended = day(deadlines.pp30.efiling);
  const withinExtension = businessDateOrdinal(extended) <= businessDateOrdinal(deadlines.efilingExtensionUntil);
  const efilingBase = withinExtension ? extended : paper;
  return { paper, efiling: rollTaxWeekend(efilingBase), efilingRolled: rollTaxWeekend(efilingBase) !== efilingBase, efilingExtended: withinExtension, checkLatest: !withinExtension };
}

// ---------------------------------------------------------------- vatReturns snapshots (G6)
const TAX_RETURN_FIELDS = Object.freeze(['id', 'schemaVersion', 'branchKey', 'branches', 'period', 'filingMode', 'amendment', 'lines', 'carryForwardIn', 'carryForwardSource', 'overpaidAction', 'channel', 'dueDate', 'filedAt', 'filedBy', 'seller', 'counts', 'note', 'demoSeed', 'demoSeedBatch']);
const taxFail = field => { const error = new Error(TAX_CORE_TEXT.errReturnField(field)); error.code = 'validation_error'; throw error; };
const taxCleanLine = value => taxText(value).replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim();
// One stored snapshot, validated field by field (throws a Thai message; used fail-closed by the
// reader, the backup validator and the writer).
export function normalizeVatReturn(value) {
  if (!taxIsObject(value)) taxFail('record');
  for (const key of Object.keys(value)) if (!TAX_RETURN_FIELDS.includes(key)) taxFail(key);
  const id = taxText(value.id);
  if (!/^[\w.:-]{1,80}$/.test(id)) taxFail('id');
  if (Number(value.schemaVersion) !== VAT_RETURN_SCHEMA_VERSION) taxFail('schemaVersion');
  const branchKey = taxText(value.branchKey);
  if (!['ubon', 'khonkaen', TAX_COMBINED_KEY].includes(branchKey)) taxFail('branchKey');
  const branches = Array.isArray(value.branches) ? value.branches.map(taxText) : taxFail('branches');
  if (!branches.length || branches.some(branch => !['ubon', 'khonkaen'].includes(branch)) || new Set(branches).size !== branches.length) taxFail('branches');
  if (branchKey !== TAX_COMBINED_KEY && (branches.length !== 1 || branches[0] !== branchKey)) taxFail('branches');
  const period = taxText(value.period);
  if (!parseTaxPeriod(period)) taxFail('period');
  const filingMode = taxText(value.filingMode);
  if (!VAT_FILING_MODES.includes(filingMode)) taxFail('filingMode');
  if ((filingMode === 'combined') !== (branchKey === TAX_COMBINED_KEY)) taxFail('filingMode');
  const amendment = Number(value.amendment);
  if (!Number.isInteger(amendment) || amendment < 0 || amendment > 99) taxFail('amendment');
  if (!taxIsObject(value.lines)) taxFail('lines');
  const lines = {};
  for (const line of PP30_COMPUTED_LINES) {
    const raw = value.lines[line] ?? value.lines[String(line)];
    if (typeof raw !== 'number' || !Number.isFinite(raw) || Math.abs(raw) > 1e13) taxFail(`lines.${line}`);
    if (line >= 8 && raw < 0) taxFail(`lines.${line}`);
    lines[line] = taxMoney(raw);
  }
  const carryForwardIn = Number(value.carryForwardIn);
  if (!Number.isFinite(carryForwardIn) || carryForwardIn < 0 || taxMoney(carryForwardIn) !== lines[10]) taxFail('carryForwardIn');
  const carryForwardSource = taxText(value.carryForwardSource);
  if (!['previous', 'manual', 'none'].includes(carryForwardSource)) taxFail('carryForwardSource');
  const overpaidAction = taxText(value.overpaidAction);
  if (lines[12] > 0 ? !VAT_OVERPAID_ACTIONS.includes(overpaidAction) : overpaidAction !== '') taxFail('overpaidAction');
  const channel = taxText(value.channel);
  if (!VAT_RETURN_CHANNELS.includes(channel)) taxFail('channel');
  const dueDate = taxText(value.dueDate);
  if (!parseBusinessDate(dueDate) || dueDate.length !== 10) taxFail('dueDate');
  const filedAt = taxText(value.filedAt);
  if (!filedAt || Number.isNaN(Date.parse(filedAt))) taxFail('filedAt');
  const seller = taxIsObject(value.seller) ? value.seller : {};
  const counts = taxIsObject(value.counts) ? value.counts : {};
  const out = {
    id, schemaVersion: VAT_RETURN_SCHEMA_VERSION, branchKey, branches, period, filingMode, amendment, lines,
    carryForwardIn: lines[10], carryForwardSource, overpaidAction, channel, dueDate, filedAt,
    filedBy: taxCleanLine(value.filedBy).slice(0, 120),
    seller: { name: taxCleanLine(seller.name).slice(0, 200), taxId: normalizeTaxIdText(seller.taxId).slice(0, 13), branchCode: normalizeBuyerBranchCode(seller.branchCode) },
    counts: { salesRows: Math.max(0, Math.trunc(taxFinite(counts.salesRows))), purchaseRows: Math.max(0, Math.trunc(taxFinite(counts.purchaseRows))) },
    note: taxCleanLine(value.note).slice(0, 300)
  };
  if (value.demoSeed === true) Object.assign(out, { demoSeed: true, demoSeedBatch: taxText(value.demoSeedBatch).slice(0, 60) });
  return out;
}
// The stored collection { schemaVersion, returns } — absent = empty; anything damaged throws (fail-closed:
// a return list that cannot be read must never be silently replaced by an empty one).
export function normalizeVatReturnsStore(value) {
  if (value === null || value === undefined) return { schemaVersion: VAT_RETURN_SCHEMA_VERSION, returns: [] };
  if (!taxIsObject(value) || Number(value.schemaVersion) !== VAT_RETURN_SCHEMA_VERSION || !Array.isArray(value.returns)) {
    const error = new Error(TAX_CORE_TEXT.errReturnsStore); error.code = 'storage_error'; throw error;
  }
  for (const key of Object.keys(value)) if (!['schemaVersion', 'returns'].includes(key)) { const error = new Error(TAX_CORE_TEXT.errReturnsStore); error.code = 'storage_error'; throw error; }
  const returns = value.returns.map(normalizeVatReturn);
  const ids = new Set(), slots = new Set();
  for (const row of returns) {
    const slot = `${row.branchKey}|${row.period}|${row.amendment}`;
    if (ids.has(row.id) || slots.has(slot)) { const error = new Error(TAX_CORE_TEXT.errReturnsStore); error.code = 'storage_error'; throw error; }
    ids.add(row.id); slots.add(slot);
  }
  return { schemaVersion: VAT_RETURN_SCHEMA_VERSION, returns };
}
export function parseVatReturnsStore(raw) {
  if (raw === null || raw === undefined || raw === '') return normalizeVatReturnsStore(null);
  let parsed;
  try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { const error = new Error(TAX_CORE_TEXT.errReturnsStore); error.code = 'storage_error'; throw error; }
  return normalizeVatReturnsStore(parsed);
}
// Filed snapshots of one establishment key + month, oldest first (amendment 0 = ยื่นปกติ).
export function vatReturnsFor(returns = [], branchKey, period) {
  return (Array.isArray(returns) ? returns : []).filter(row => row.branchKey === branchKey && row.period === period).sort((a, b) => a.amendment - b.amendment);
}
export function latestVatReturn(returns, branchKey, period) {
  const list = vatReturnsFor(returns, branchKey, period);
  return list.length ? list[list.length - 1] : null;
}
// Line 10 (ภาษีที่ชำระเกินยกมา): the previous month's latest filed return decides — its line 12 when it
// chose "ขอนำไปชำระในเดือนถัดไป", else 0. With no filed previous return the user types it (manual).
export function resolveCarryForward(returns, branchKey, period) {
  const previous = latestVatReturn(returns, branchKey, addTaxPeriods(period, -1));
  if (!previous) return { source: 'manual', amount: 0, editable: true, previous: null };
  const amount = previous.overpaidAction === 'carry' ? taxMoney(previous.lines[12]) : 0;
  return { source: amount > 0 ? 'previous' : 'none', amount, editable: false, previous };
}
// The next snapshot to store (never overwrites: amendment = number already filed for the slot).
// input: { returns, id, branchKey, branches, period, filingMode, summary (buildPp30Summary),
//          carry (resolveCarryForward or { source:'manual', amount }), overpaidAction, channel, filedAt,
//          filedBy, seller, counts }
export function buildVatReturnSnapshot(input = {}) {
  const filed = vatReturnsFor(input.returns, input.branchKey, input.period);
  const summary = input.summary || {};
  const lines = summary.lines || {};
  if (lines[12] > 0 && !VAT_OVERPAID_ACTIONS.includes(input.overpaidAction)) { const error = new Error(TAX_CORE_TEXT.errOverpaidAction); error.code = 'validation_error'; throw error; }
  const due = pp30DueDates(input.period);
  const channel = VAT_RETURN_CHANNELS.includes(input.channel) ? input.channel : 'paper';
  const carry = input.carry || { source: 'manual', amount: 0 };
  return normalizeVatReturn({
    id: input.id, schemaVersion: VAT_RETURN_SCHEMA_VERSION, branchKey: input.branchKey, branches: input.branches, period: input.period,
    filingMode: input.filingMode, amendment: filed.length, lines: { ...lines },
    carryForwardIn: lines[10], carryForwardSource: carry.source === 'previous' || carry.source === 'none' ? carry.source : 'manual',
    overpaidAction: lines[12] > 0 ? input.overpaidAction : '', channel, dueDate: due ? due[channel] : '',
    filedAt: input.filedAt, filedBy: input.filedBy, seller: input.seller || {}, counts: input.counts || {}, note: input.note || ''
  });
}
// Backup merge (ADR-003 / ADR-020 style): a filed return is an immutable record — the device copy of
// the same id wins, rows only in the backup are added; replace = the backup's list. Both are fully
// validated (normalizeVatReturnsStore throws) before anything is written.
export function mergeVatReturnsStores(current, incoming, { replace = false } = {}) {
  const next = normalizeVatReturnsStore(incoming);
  if (replace) return next;
  const base = normalizeVatReturnsStore(current);
  const ids = new Set(base.returns.map(row => row.id));
  const slots = new Set(base.returns.map(row => `${row.branchKey}|${row.period}|${row.amendment}`));
  const added = next.returns.filter(row => !ids.has(row.id) && !slots.has(`${row.branchKey}|${row.period}|${row.amendment}`));
  return normalizeVatReturnsStore({ schemaVersion: VAT_RETURN_SCHEMA_VERSION, returns: [...base.returns, ...added] });
}
