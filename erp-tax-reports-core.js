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
import { roundMoneyValue, calculateVatSummary, parseBusinessDate, businessDateOrdinal, normalizeBuyerBranchCode, effectiveTaxInvoiceForm, isGeneralCustomerName, GENERAL_CUSTOMER_NAME, vatRateNotice } from './erp-shared-core.js';
import { creditNoteInvoiceBasis, creditNoteVatModeOf, creditNoteInvoiceLive, isCreditNoteLive, summarizeOutputVat } from './erp-credit-note-core.js';
import { isValidThaiTaxId, PLACEHOLDER_TAX_ID } from './erp-company-profile-core.js';

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
  cancelledShort: 'ยกเลิก',
  creditNoteNote: nos => `ใบลดหนี้ อ้างอิง ${nos.length ? nos.join(', ') : '-'}`,
  debitNoteNote: nos => `ใบเพิ่มหนี้ อ้างอิง ${nos.length ? nos.join(', ') : '-'}`,
  zeroRatedNote: 'อัตราร้อยละ 0',
  // ADR-031 (rule 4): the value of an export of goods in a currency (ป.132/2548) — fixed by the month-end close.
  exportValueNote: (currency, amount, basis) => `อัตราร้อยละ 0 · ส่งออก ${currency} ${amount} — มูลค่าตาม ป.132/2548: ${basis}`,
  exportBasis: Object.freeze({ actual: 'ขายเงินตราได้ในเดือน ใช้ยอดบาทที่ได้จริง', month_end_rate: 'อัตราซื้อถัวเฉลี่ย ธปท. วันทำการสุดท้ายของเดือน', mixed: 'ส่วนที่ขายได้ใช้ยอดบาทจริง ส่วนที่เหลือใช้อัตราซื้อถัวเฉลี่ย ธปท. วันทำการสุดท้ายของเดือน' }),
  exportPendingNote: 'อัตราร้อยละ 0 · ส่งออก — มูลค่ายังเป็นยอดบาทวันออกใบ (ชั่วคราว)',
  exportPendingWarning: no => `ใบ ${no} เป็นการส่งออกสินค้าเป็นเงินตราต่างประเทศ — มูลค่าใน ภ.พ.30 ยังเป็นยอดบาทวันออกใบ (ชั่วคราว) ให้ "ปิดเดือนสกุลต่างประเทศ" ที่หน้าหลายสกุลเงินก่อนยื่น ภ.พ.30 (ป.132/2548)`,
  // ADR-031 (rule 7): input VAT of an imported service self-assessed on ภ.พ.36, claimed the month after the payment.
  pp36No: no => `ภ.พ.36 ${no}`,
  pp36Note: (paymentNo, date) => `ภาษีซื้อตามใบเสร็จ ภ.พ.36 — บริการจากต่างประเทศ จ่ายเงิน ${paymentNo} วันที่ ${date}`,
  lateEntryNote: 'ลงรายการเกิน 3 วันทำการ',
  receivedNote: date => `ได้รับ ${date}`,
  invoiceMonthNote: period => `ใบกำกับภาษีเดือน ${period}`,
  creditNoteReceivedNote: 'ใบลดหนี้ที่ได้รับ',
  goodsReceiptNote: no => `รับสินค้า ${no}`,
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
  errClaimTooLate: (invoicePeriod, lastPeriod) => `เกินกำหนดใช้สิทธิ์ 6 เดือน — ใบกำกับภาษีเดือน ${invoicePeriod} ใช้สิทธิ์ได้ถึงเดือน ${lastPeriod} เท่านั้น (มาตรา 82/3)`,
  errReason: 'กรุณาเลือกเหตุผลที่ไม่ขอใช้สิทธิ์ภาษีซื้อ (ภาษีซื้อต้องห้าม มาตรา 82/5)',
  errDuplicateTaxInvoice: (no, taxId) => `ใบกำกับภาษีเลขที่ ${no} ของผู้ขายเลขประจำตัว ${taxId} ถูกบันทึกแล้ว — ใช้สิทธิ์ภาษีซื้อซ้ำไม่ได้`,
  warnVendorTaxIdCheck: taxId => `เลขประจำตัวผู้เสียภาษีของผู้ขาย ${taxId} หลักสุดท้ายไม่ตรงกับเลขตรวจสอบ — ตรวจกับใบกำกับภาษีอีกครั้ง`,
  warnClaimLater: (claim, received) => `ใช้สิทธิ์ภาษีซื้อเดือน ${claim} (ได้รับใบกำกับภาษีเดือน ${received})`,
  // r13#LOW-3 — ประกาศอธิบดีฯ VAT ฉบับที่ 4 ข้อ 1–2: a later month only for these reasons, and the invoice must be endorsed.
  lateClaimReasons: Object.freeze({ trade_custom: 'มีเหตุจำเป็นตามประเพณีทางการค้า (เช่น ได้รับใบกำกับภาษีหลังปิดบัญชีของเดือนแล้ว)', force_majeure: 'เหตุสุดวิสัย', other: 'เหตุอื่น (ระบุ — ต้องเป็นเหตุตามประกาศฯ ฉบับที่ 4)' }),
  errLateClaimReason: 'ใช้สิทธิ์ภาษีซื้อในเดือนหลังเดือนที่ได้รับใบกำกับภาษี — กรุณาเลือกเหตุผล (ประกาศอธิบดีฯ VAT ฉบับที่ 4)',
  errLateClaimNote: 'เลือก "เหตุอื่น" แล้ว — กรุณาระบุเหตุผลอย่างน้อย 10 ตัวอักษร',
  lateClaimEndorse: period => `เขียนบนใบกำกับภาษีตัวจริง: "ถือเป็นภาษีซื้อในเดือนภาษี ${period}" (ประกาศอธิบดีฯ VAT ฉบับที่ 4 ข้อ 2)`,
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
  dueDateHolidayNote: 'วันครบกำหนดเลื่อนพ้นวันเสาร์-อาทิตย์และวันหยุดราชการตามตารางในระบบ (ปี 2569 ตามประกาศวันหยุดราชการ · ปี 2570 ตามประกาศ ธปท. ที่ 37/2569 ยังรอมติ ครม.) — ตรวจปฏิทินภาษีของกรมสรรพากรอีกครั้ง',
  dueDateHolidayUnknown: 'ปีนี้ยังไม่มีตารางวันหยุดราชการในระบบ — วันครบกำหนดเลื่อนเฉพาะวันเสาร์-อาทิตย์ ตรวจปฏิทินภาษีของกรมสรรพากร',
  dueDateMovedHoliday: names => `เลื่อนเพราะวันหยุด: ${names.join(', ')}`,
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
// r13#LOW-1 — government holidays (วันหยุดราชการ) used by every due-date roll and the 3-working-day entry rule. A config
// table like TAX_DEADLINES: add the next year when the cabinet announces it (and re-check against the RD tax calendar).
// - 2569 (2026): the cabinet's government holidays as published (Thaiger 3 พ.ย. 2568, InfoQuest "วันหยุดประจำปี 2569"),
//   incl. the special holiday 2 ม.ค. 2569 (ครม.). Left out on purpose: 1 พ.ค. (Labour Day — banks / private only),
//   13 พ.ค. (Ploughing Day, not on every published government list) and 16 ต.ค. 2569 (ครม. 19 พ.ค. 2569: Bangkok
//   government offices only, IMF / World Bank meetings) — a doubtful day is left OUT, so a due date is never shown
//   later than the real one.
// - 2570 (2027): PROVISIONAL — ประกาศธนาคารแห่งประเทศไทย ที่ 37/2569 (17 ส.ค. 2569, ราชกิจจานุเบกษา 25 ส.ค. 2569), the
//   bank holidays of 2570 without 3 พ.ค. (Labour Day substitute). The cabinet's government list for 2570 is not out yet.
export const TAX_HOLIDAY_YEARS = Object.freeze({ 2026: 'official', 2027: 'provisional' });
export const TAX_PUBLIC_HOLIDAYS = Object.freeze([
  ['2026-01-01', 'วันขึ้นปีใหม่'], ['2026-01-02', 'วันหยุดราชการเพิ่มเป็นกรณีพิเศษ'], ['2026-03-03', 'วันมาฆบูชา'], ['2026-04-06', 'วันจักรี'],
  ['2026-04-13', 'วันสงกรานต์'], ['2026-04-14', 'วันสงกรานต์'], ['2026-04-15', 'วันสงกรานต์'], ['2026-05-04', 'วันฉัตรมงคล'],
  ['2026-06-01', 'วันหยุดชดเชยวันวิสาขบูชา'], ['2026-06-03', 'วันเฉลิมพระชนมพรรษาสมเด็จพระราชินี'], ['2026-07-28', 'วันเฉลิมพระชนมพรรษาพระบาทสมเด็จพระเจ้าอยู่หัว'],
  ['2026-07-29', 'วันอาสาฬหบูชา'], ['2026-07-30', 'วันเข้าพรรษา'], ['2026-08-12', 'วันแม่แห่งชาติ'], ['2026-10-13', 'วันนวมินทรมหาราช'],
  ['2026-10-23', 'วันปิยมหาราช'], ['2026-12-07', 'วันหยุดชดเชยวันพ่อแห่งชาติ'], ['2026-12-10', 'วันรัฐธรรมนูญ'], ['2026-12-31', 'วันสิ้นปี'],
  ['2027-01-01', 'วันขึ้นปีใหม่'], ['2027-02-22', 'วันหยุดชดเชยวันมาฆบูชา'], ['2027-04-06', 'วันจักรี'], ['2027-04-13', 'วันสงกรานต์'],
  ['2027-04-14', 'วันสงกรานต์'], ['2027-04-15', 'วันสงกรานต์'], ['2027-05-04', 'วันฉัตรมงคล'], ['2027-05-20', 'วันวิสาขบูชา'],
  ['2027-06-03', 'วันเฉลิมพระชนมพรรษาสมเด็จพระราชินี'], ['2027-07-19', 'วันหยุดชดเชยวันอาสาฬหบูชา'], ['2027-07-28', 'วันเฉลิมพระชนมพรรษาพระบาทสมเด็จพระเจ้าอยู่หัว'],
  ['2027-08-12', 'วันแม่แห่งชาติ'], ['2027-10-13', 'วันนวมินทรมหาราช'], ['2027-10-25', 'วันหยุดชดเชยวันปิยมหาราช'], ['2027-12-06', 'วันหยุดชดเชยวันพ่อแห่งชาติ'],
  ['2027-12-10', 'วันรัฐธรรมนูญ'], ['2027-12-31', 'วันสิ้นปี']
].map(([date, name]) => Object.freeze({ date, name })));
const TAX_HOLIDAY_MAP = new Map(TAX_PUBLIC_HOLIDAYS.map(row => [row.date, row.name]));
// The holiday name of an ISO date ('' = not a listed holiday).
export function taxHolidayName(value, holidays = TAX_HOLIDAY_MAP) {
  const key = taxText(value).slice(0, 10);
  return holidays instanceof Map ? holidays.get(key) || '' : '';
}
// 'official' | 'provisional' | '' (the year is not in the table: weekends only).
export function taxHolidayYearStatus(value) {
  const year = Number(taxText(value).slice(0, 4));
  return TAX_HOLIDAY_YEARS[year] || '';
}
const taxIsWorkingOrdinal = (ordinal, holidays) => { const day = taxWeekday(ordinal); return day !== 0 && day !== 6 && !taxHolidayName(taxIsoFromOrdinal(ordinal), holidays); };
// The date `days` working days (Mon–Fri, not a listed government holiday) after an ISO date.
export function addTaxWorkingDays(value, days, holidays = TAX_HOLIDAY_MAP) {
  let ordinal = businessDateOrdinal(value);
  if (!Number.isFinite(ordinal)) return '';
  let left = Math.max(0, Math.trunc(taxFinite(days)));
  while (left > 0) { ordinal += 1; if (taxIsWorkingOrdinal(ordinal, holidays)) left -= 1; }
  return taxIsoFromOrdinal(ordinal);
}
// Saturday / Sunday → the next Monday (weekends only — kept for callers that want exactly that).
export function rollTaxWeekend(value) {
  let ordinal = businessDateOrdinal(value);
  if (!Number.isFinite(ordinal)) return '';
  while ([0, 6].includes(taxWeekday(ordinal))) ordinal += 1;
  return taxIsoFromOrdinal(ordinal);
}
// A due date on a Saturday, Sunday or listed government holiday → the next working day (r13#LOW-1).
export function rollTaxDueDate(value, holidays = TAX_HOLIDAY_MAP) {
  let ordinal = businessDateOrdinal(value);
  if (!Number.isFinite(ordinal)) return '';
  for (let guard = 0; guard < 40 && !taxIsWorkingOrdinal(ordinal, holidays); guard += 1) ordinal += 1;
  return taxIsoFromOrdinal(ordinal);
}
// The holidays a roll passed over (names), for the "เลื่อนเพราะ…" note.
export function taxRolledHolidays(from, to, holidays = TAX_HOLIDAY_MAP) {
  const start = businessDateOrdinal(from), end = businessDateOrdinal(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  const names = [];
  for (let ordinal = start; ordinal < end; ordinal += 1) { const name = taxHolidayName(taxIsoFromOrdinal(ordinal), holidays); if (name) names.push(name); }
  return [...new Set(names)];
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
// The seller's / payer's own tax ID on a report or certificate (ADR-024, D3 item 4): '' = a usable 13-digit ID;
// 'sample' = still the sample number 0000000000000 (the untouched sample profile, or a saved one that kept it — a calm
// notice, the demo stays honest that it is a placeholder); 'invalid' = a number somebody entered that is not a valid
// 13-digit ID (a warning).
export function companyTaxIdNotice(taxId, customProfileSaved) {
  const id = normalizeTaxIdText(taxId);
  const usable = /^\d{13}$/.test(id) && id !== PLACEHOLDER_TAX_ID && isValidThaiTaxId(id);
  if (usable) return '';
  // Still the sample number (also in a saved profile that kept it) → the calm notice; a number somebody typed
  // that fails the 13-digit / check-digit rule → the warning. (`customProfileSaved` kept for the callers' context.)
  if (!id || id === PLACEHOLDER_TAX_ID || !customProfileSaved && !/^\d{13}$/.test(id)) return 'sample';
  return 'invalid';
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

// ---------------------------------------------------------------- tax point of services at payment (r13#MED-6)
// มาตรา 78/1(1): for a service the VAT liability arises when the price is RECEIVED — unless a tax invoice is issued
// earlier (78/1(2)). An invoice saved with taxPoint 'payment' is a ใบแจ้งหนี้ (not a tax invoice): nothing goes into
// รายงานภาษีขาย on its date; each receipt against it is the ใบเสร็จรับเงิน/ใบกำกับภาษี and reports its VAT share on
// the RECEIPT date. Only for a full-form invoice of services only, with VAT (planInvoiceDocumentAction enforces it).
export const TAX_POINT_TEXT = Object.freeze({
  receiptRowNote: invoiceNo => `ใบเสร็จรับเงิน/ใบกำกับภาษี (บริการ ม.78/1) ตามใบแจ้งหนี้ ${invoiceNo}`,
  deferredInvoice: (no, date) => `ใบแจ้งหนี้ค่าบริการ ${no} (${date}) ยังไม่ใช่ใบกำกับภาษี — ภาษีขายเกิดเมื่อได้รับชำระ (ม.78/1) จึงยังไม่อยู่ในรายงานเดือนนี้`,
  errGoodsLine: 'ออกใบกำกับภาษีเมื่อรับเงินได้เฉพาะค่าบริการ (มาตรา 78/1) — ใบนี้มีรายการสินค้า ให้ใช้ใบกำกับภาษีตามปกติ',
  errNeedsVat: 'ออกใบกำกับภาษีเมื่อรับเงินใช้กับค่าบริการที่มี VAT เท่านั้น',
  errAbbreviated: 'ใบกำกับภาษีอย่างย่อออกพร้อมรับเงินอยู่แล้ว — ไม่ต้องเลือกออกใบกำกับภาษีเมื่อรับเงิน',
  errHasPayments: 'ใบนี้มีการรับเงินหรือใบลด/เพิ่มหนี้แล้ว จึงเปลี่ยนจุดความรับผิดทางภาษีไม่ได้'
});
export function invoiceTaxPointAtPayment(invoice = {}) {
  return invoice?.taxPoint === 'payment' && creditNoteVatModeOf(invoice) !== 'none' && effectiveTaxInvoiceForm(invoice) !== 'abbreviated';
}
const taxReceiptLive = row => !!row && typeof row === 'object' && !row.voided && !row.cancelled && row.status !== 'cancelled' && row.status !== 'voided';
// The VAT share of every live receipt of a tax-point-at-payment invoice, in receipt order: cumulative rounding in satang
// (share k = round(VAT × paid up to k ÷ total) − round(VAT × paid up to k−1 ÷ total)), so the shares add up EXACTLY to the
// invoice VAT when it is paid in full. Amounts above the invoice total are ignored. → [{ receipt, date, total, vat, value }]
export function paymentTaxPoints(invoice = {}, receipts = []) {
  const basis = creditNoteInvoiceBasis(invoice);
  const totalSatang = Math.round(taxMoney(basis.total) * 100), vatSatang = Math.round(taxMoney(basis.vat) * 100);
  if (!(totalSatang > 0)) return [];
  const list = (Array.isArray(receipts) ? receipts : []).filter(taxReceiptLive)
    .map(receipt => ({ receipt, date: taxText(receipt.date).slice(0, 10), amount: Math.round(taxMoney(receipt.total ?? receipt.saleTotal ?? receipt.subtotal ?? 0) * 100) }))
    .filter(row => row.amount > 0 && parseBusinessDate(row.date))
    .sort((a, b) => (businessDateOrdinal(a.date) || 0) - (businessDateOrdinal(b.date) || 0) || taxText(a.receipt.no).localeCompare(taxText(b.receipt.no), 'en', { numeric: true }));
  const out = [];
  let paid = 0, vatSoFar = 0;
  for (const row of list) {
    if (paid >= totalSatang) break;
    const amount = Math.min(row.amount, totalSatang - paid);
    paid += amount;
    const vatCum = paid >= totalSatang ? vatSatang : Math.round(vatSatang * paid / totalSatang);
    const vat = vatCum - vatSoFar;
    vatSoFar = vatCum;
    out.push({ receipt: row.receipt, date: row.date, total: amount / 100, vat: vat / 100, value: (amount - vat) / 100 });
  }
  return out;
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
export const EXPENSE_VAT_FIELD_KEYS = Object.freeze(['vendorId', 'vendorTaxId', 'vendorBranchCode', 'vendorAddress', 'vatMode', 'subtotal', 'vatAmt', 'taxInvoiceNo', 'taxInvoiceDate', 'taxInvoiceReceivedDate', 'claimPeriod', 'inputVatClaimable', 'nonClaimableReason', 'vatCategory', 'lateClaimReason', 'lateClaimNote']);
export const LATE_CLAIM_REASON_CODES = Object.freeze(Object.keys(TAX_CORE_TEXT.lateClaimReasons));
// r13#LOW-3: the reason a claim month later than the received month needs ('' + no error when not late).
function taxLateClaimCheck(draft, claimPeriod, receivedPeriod) {
  if (!claimPeriod || claimPeriod === receivedPeriod) return { ok: true, reason: '', note: '' };
  const reason = taxText(draft.lateClaimReason);
  if (!LATE_CLAIM_REASON_CODES.includes(reason)) return { ok: false, error: TAX_CORE_TEXT.errLateClaimReason };
  const note = taxText(draft.lateClaimNote).replace(/\s+/g, ' ').slice(0, 200);
  if (reason === 'other' && note.length < 10) return { ok: false, error: TAX_CORE_TEXT.errLateClaimNote };
  return { ok: true, reason, note };
}

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
  let late = { reason: '', note: '' };
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
    late = taxLateClaimCheck(draft, claimPeriod, receivedPeriod);
    if (!late.ok) return { ok: false, error: late.error };
    if (late.reason) warnings.push(TAX_CORE_TEXT.lateClaimEndorse(taxPeriodShort(claimPeriod)));
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
    vatCategory: vatMode === 'none' ? 'exempt' : 'standard',
    lateClaimReason: late.reason,
    lateClaimNote: late.note
  };
  return { ok: true, fields, warnings };
}

// ---------------------------------------------------------------- goods-receipt purchase VAT (r13#HIGH-2, G15)
// A purchase order / goods receipt stores the PRE-VAT value of the goods (`subtotal` = Σ qty × unit cost — the cost the
// costing engine uses, unchanged). The supplier's VAT is planned here, with the same rules as an expense tax invoice
// (planExpenseVatFields: seller TIN / establishment, ม.82/3 6-month claim limit, ประกาศฯ ฉบับที่ 4 late-claim reason, the
// duplicate guard on seller TIN + number across expenses AND goods receipts):
//   vatMode 'add'  — the supplier is VAT-registered: VAT = round(subtotal × 7 %), AP = subtotal + VAT;
//   vatMode 'none' — the supplier is not VAT-registered (no VAT, AP = subtotal) — the receipt is as before r13.
//   taxStatus 'received' — the tax invoice is in hand: claimed in `claimPeriod` (default: the received month);
//   taxStatus 'pending'  — goods arrived before the tax invoice: the VAT is "not yet claimable" (GL 1155) until the
//                          invoice is recorded (recordGoodsReceiptTaxInvoice), then claimed in its claim month.
// A goods receipt cannot decline the claim (ภาษีซื้อต้องห้าม would change the stock cost the engine already used):
// a defective tax invoice stays pending until the supplier issues a correct one.
export const GOODS_RECEIPT_VAT_MODES = Object.freeze(['add', 'none']);
export const GOODS_RECEIPT_TAX_STATUSES = Object.freeze(['received', 'pending']);
export const GOODS_RECEIPT_VAT_FIELD_KEYS = Object.freeze(['vatMode', 'vatAmt', 'total', 'vendorTaxId', 'vendorBranchCode', 'vendorAddress', 'taxStatus', 'taxInvoiceNo', 'taxInvoiceDate', 'taxInvoiceReceivedDate', 'claimPeriod', 'inputVatClaimable', 'lateClaimReason', 'lateClaimNote', 'taxInvoiceRecordedAt']);
export const GR_TAX_TEXT = Object.freeze({
  vatModes: Object.freeze({ add: 'ผู้ขายจด VAT — ราคาในใบสั่งซื้อยังไม่รวม VAT (บวก VAT 7%)', none: 'ผู้ขายไม่ได้จด VAT — ไม่มี VAT' }),
  statuses: Object.freeze({ received: 'ได้รับใบกำกับภาษีพร้อมสินค้าแล้ว', pending: 'ยังไม่ได้รับใบกำกับภาษี (รอผู้ขายส่งตามมา)' }),
  errVatMode: 'กรุณาเลือกว่าผู้ขายจด VAT หรือไม่ (ใบสั่งซื้อ / ใบรับสินค้า)',
  errStatus: 'กรุณาเลือกสถานะใบกำกับภาษีของผู้ขาย',
  errValue: 'มูลค่าสินค้าที่รับต้องมากกว่า 0',
  pendingNote: 'ยังไม่ได้รับใบกำกับภาษี — VAT บันทึกเป็น "ภาษีซื้อยังไม่ถึงกำหนดใช้สิทธิ" และยังไม่อยู่ในรายงานภาษีซื้อ จนกว่าจะบันทึกใบกำกับภาษีที่ได้รับ',
  pendingBadge: 'รอใบกำกับภาษี',
  claimBadge: period => `ภาษีซื้อ ${period}`,
  noVatBadge: 'ไม่มี VAT',
  monthEndPending: (no, date, vat) => `ใบรับสินค้า ${no} (${date}) ยังไม่ได้รับใบกำกับภาษี — ภาษีซื้อ ${vat} บาทยังใช้สิทธิ์ไม่ได้ ตามใบกำกับภาษีจากผู้ขาย`,
  errAlreadyRecorded: no => `ใบรับสินค้า ${no} บันทึกใบกำกับภาษีแล้ว`,
  errNotPending: no => `ใบรับสินค้า ${no} ไม่มี VAT ที่รอใบกำกับภาษี`,
  errReceivedBeforeGoods: 'วันที่ได้รับใบกำกับภาษีต้องไม่ก่อนวันที่ในใบกำกับภาษี'
});
// The VAT part of a goods-receipt draft. Never throws: { ok, fields, warnings } | { ok: false, error }.
//   draft: { date (GR date), subtotal (pre-VAT goods value), supplier (name), vatMode, taxStatus, vendorTaxId, vendorBranchCode,
//            vendorAddress, taxInvoiceNo, taxInvoiceDate, taxInvoiceReceivedDate, claimPeriod, lateClaimReason, lateClaimNote }
export function planGoodsReceiptVatFields(draft = {}) {
  const vatMode = taxText(draft.vatMode);
  if (!GOODS_RECEIPT_VAT_MODES.includes(vatMode)) return { ok: false, error: GR_TAX_TEXT.errVatMode };
  const subtotal = taxMoney(draft.subtotal);
  if (!(subtotal > 0)) return { ok: false, error: GR_TAX_TEXT.errValue };
  const split = calculateVatSummary(subtotal, vatMode);
  const warnings = [];
  const notice = vatRateNotice(draft.taxInvoiceDate || draft.date);
  if (notice) warnings.push(notice);
  const base = { vatMode, vatAmt: split.vatAmt, total: split.total, vendorTaxId: '', vendorBranchCode: '', vendorAddress: taxText(draft.vendorAddress).slice(0, 300), taxStatus: '', taxInvoiceNo: '', taxInvoiceDate: '', taxInvoiceReceivedDate: '', claimPeriod: '', inputVatClaimable: false, lateClaimReason: '', lateClaimNote: '' };
  if (vatMode === 'none') return { ok: true, fields: base, warnings };
  const status = taxText(draft.taxStatus);
  if (!GOODS_RECEIPT_TAX_STATUSES.includes(status)) return { ok: false, error: GR_TAX_TEXT.errStatus };
  const vendorTaxId = normalizeTaxIdText(draft.vendorTaxId);
  if (vendorTaxId && !/^\d{13}$/.test(vendorTaxId)) return { ok: false, error: TAX_CORE_TEXT.errVendorTaxId };
  if (vendorTaxId && !isValidThaiTaxId(vendorTaxId)) warnings.push(TAX_CORE_TEXT.warnVendorTaxIdCheck(vendorTaxId));
  const vendorBranchCode = normalizeBuyerBranchCode(draft.vendorBranchCode);
  if (taxText(draft.vendorBranchCode) && !vendorBranchCode) return { ok: false, error: TAX_CORE_TEXT.errVendorBranch };
  Object.assign(base, { vendorTaxId, vendorBranchCode, taxStatus: status });
  if (status === 'pending') { warnings.push(GR_TAX_TEXT.pendingNote); return { ok: true, fields: base, warnings }; }
  const claim = planGoodsReceiptTaxInvoice({ ...draft, vendorTaxId, vendorBranchCode });
  if (!claim.ok) return claim;
  return { ok: true, fields: { ...base, ...claim.fields }, warnings: [...warnings, ...claim.warnings] };
}
// The tax-invoice part of a goods receipt (at the receipt, or later for a pending one).
export function planGoodsReceiptTaxInvoice(draft = {}) {
  const warnings = [];
  const vendor = taxText(draft.supplier || draft.vendor);
  const vendorTaxId = normalizeTaxIdText(draft.vendorTaxId);
  const vendorBranchCode = normalizeBuyerBranchCode(draft.vendorBranchCode);
  const taxInvoiceNo = taxText(draft.taxInvoiceNo);
  const taxInvoiceDate = taxText(draft.taxInvoiceDate).slice(0, 10);
  const receivedDate = taxText(draft.taxInvoiceReceivedDate).slice(0, 10) || taxInvoiceDate;
  if (!vendor) return { ok: false, error: TAX_CORE_TEXT.errVendorName };
  if (!/^\d{13}$/.test(vendorTaxId)) return { ok: false, error: TAX_CORE_TEXT.errVendorTaxId };
  if (!vendorBranchCode) return { ok: false, error: TAX_CORE_TEXT.errVendorBranch };
  if (!taxInvoiceNo) return { ok: false, error: TAX_CORE_TEXT.errTaxInvoiceNo };
  if (!parseBusinessDate(taxInvoiceDate)) return { ok: false, error: TAX_CORE_TEXT.errTaxInvoiceDate };
  if (!parseBusinessDate(receivedDate)) return { ok: false, error: TAX_CORE_TEXT.errReceivedDate };
  if (businessDateOrdinal(receivedDate) < businessDateOrdinal(taxInvoiceDate)) return { ok: false, error: GR_TAX_TEXT.errReceivedBeforeGoods };
  const receivedPeriod = taxPeriodOfDate(receivedDate), invoicePeriod = taxPeriodOfDate(taxInvoiceDate);
  const claimPeriod = taxText(draft.claimPeriod) || receivedPeriod;
  if (!parseTaxPeriod(claimPeriod)) return { ok: false, error: TAX_CORE_TEXT.errClaimPeriod };
  if (taxPeriodIndex(claimPeriod) < taxPeriodIndex(receivedPeriod)) return { ok: false, error: TAX_CORE_TEXT.errClaimBeforeReceived };
  if (taxPeriodIndex(claimPeriod) - taxPeriodIndex(invoicePeriod) > TAX_CLAIM_WINDOW_MONTHS) {
    return { ok: false, error: TAX_CORE_TEXT.errClaimTooLate(taxPeriodShort(invoicePeriod), taxPeriodShort(addTaxPeriods(invoicePeriod, TAX_CLAIM_WINDOW_MONTHS))) };
  }
  const late = taxLateClaimCheck(draft, claimPeriod, receivedPeriod);
  if (!late.ok) return { ok: false, error: late.error };
  if (claimPeriod !== receivedPeriod) warnings.push(TAX_CORE_TEXT.warnClaimLater(taxPeriodShort(claimPeriod), taxPeriodShort(receivedPeriod)), TAX_CORE_TEXT.lateClaimEndorse(taxPeriodShort(claimPeriod)));
  if (!isValidThaiTaxId(vendorTaxId)) warnings.push(TAX_CORE_TEXT.warnVendorTaxIdCheck(vendorTaxId));
  return { ok: true, warnings, fields: { vendorTaxId, vendorBranchCode, taxStatus: 'received', taxInvoiceNo, taxInvoiceDate, taxInvoiceReceivedDate: receivedDate, claimPeriod, inputVatClaimable: true, lateClaimReason: late.reason, lateClaimNote: late.note } };
}
// Does a stored goods receipt carry claimable / pending VAT?
export function goodsReceiptVatOf(gr = {}) {
  const vat = taxMoney(gr?.vatAmt);
  if (gr?.vatMode !== 'add' || !(vat > 0) || gr?.reversed === true) return { vat: 0, pending: false, claimable: false, claimPeriod: '' };
  const claimable = gr.taxStatus === 'received' && gr.inputVatClaimable === true && !!parseTaxPeriod(gr.claimPeriod);
  return { vat, value: taxMoney(gr.subtotal), pending: !claimable, claimable, claimPeriod: claimable ? gr.claimPeriod : '' };
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

// ADR-031 (rule 4): an export of GOODS invoiced in a currency is reported at its ป.132/2548 value — the actual baht when
// the currency was sold in the month, else the BOT average buying rate of the month's last business day — stored on the
// invoice by the month-end close (`exportVat`). Until then the invoice-day baht is used and the report says so. The
// books keep the invoice-day baht (the month-end checks show the difference). → { invoice (as reported), fixed, pending }
export function taxExportValueOf(invoice = {}) {
  const code = taxText(invoice?.currency).toUpperCase();
  if (!code || code === 'THB' || invoiceVatCategoryOf(invoice) !== 'zero' || invoice.exportKind !== 'goods') return { invoice, fixed: null, pending: false };
  const fixed = taxIsObject(invoice.exportVat) && Number.isFinite(Number(invoice.exportVat.thb)) ? invoice.exportVat : null;
  if (!fixed) return { invoice, fixed: null, pending: true };
  const thb = taxMoney(fixed.thb);
  return { invoice: { ...invoice, subtotal: thb, total: thb, vatAmt: 0, itemSaleTotal: thb, saleTotal: thb }, fixed, pending: false };
}
const taxGroup = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
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
  const warnings = { legacyNoVat: [], exemptSales: [], missingBuyerTaxId: [], lateEntries: [], outsidePeriod: [], integrity: [], deferredService: [], exportPending: [] };
  let skippedCopies = 0;
  const abbreviatedDays = new Map();
  const sources = Array.isArray(input.sources) ? input.sources : [];
  for (const source of sources) {
    const branch = taxText(source?.branch);
    for (const storedInvoice of Array.isArray(source?.invoices) ? source.invoices : []) {
      if (!storedInvoice || typeof storedInvoice !== 'object') continue;
      // §1c rule 10: a printed copy kept in the invoice pack (old data) is the same tax invoice.
      if (storedInvoice.documentKind === 'delivery-tax-invoice') { skippedCopies += 1; continue; }
      const exportView = taxExportValueOf(storedInvoice); // ADR-031: an export of goods in a currency at its ป.132/2548 value
      const invoice = exportView.invoice;
      const live = creditNoteInvoiceLive(invoice);
      const category = invoiceVatCategoryOf(invoice);
      const basis = creditNoteInvoiceBasis(invoice);
      if (period && taxPeriodOfDate(invoice.date) && taxPeriodOfDate(invoice.date) !== period) warnings.outsidePeriod.push(TAX_CORE_TEXT.dateOutsidePeriod(taxText(invoice.no), taxThaiDate(invoice.date)));
      // r13#MED-6: a ใบแจ้งหนี้ of services with the tax point at payment is not a tax invoice — its receipts report it.
      if (invoiceTaxPointAtPayment(invoice)) { if (live) warnings.deferredService.push({ branch, no: taxText(invoice.no), date: taxText(invoice.date).slice(0, 10), message: TAX_POINT_TEXT.deferredInvoice(taxText(invoice.no), taxThaiDate(invoice.date)) }); continue; }
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
        if (exportView.fixed) row.note = TAX_CORE_TEXT.exportValueNote(taxText(invoice.currency).toUpperCase(), taxGroup.format(taxFinite(exportView.fixed.totalFx)), TAX_CORE_TEXT.exportBasis[exportView.fixed.basis] || TAX_CORE_TEXT.exportBasis.month_end_rate);
        else if (exportView.pending) { row.note = TAX_CORE_TEXT.exportPendingNote; row.flags.push('exportPending'); warnings.exportPending.push({ branch, no: row.no, message: TAX_CORE_TEXT.exportPendingWarning(row.no) }); }
        // ADR-031: a foreign buyer of an export (0 %) has no Thai tax ID — not a missing detail.
        if (!abbreviated && !row.taxId && !(category === 'zero' && invoice.exportKind)) { row.flags.push('missingBuyerTaxId'); warnings.missingBuyerTaxId.push({ branch, no: row.no, customer: row.party }); }
      } else {
        // ADR-024 (D3 item 3): "ยกเลิก – <reason>" in the name column (the usual way to enter a cancelled tax invoice,
        // and visible without scrolling); the note column only repeats "ยกเลิก", so the row keeps a normal height.
        Object.assign(row, { party: TAX_CORE_TEXT.cancelledNote(taxText(invoice.voidReason || invoice.cancelReason)), taxId: '', branchCode: '', note: TAX_CORE_TEXT.cancelledShort });
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
  // r13#MED-6: receipts of tax-point-at-payment service invoices, on their receipt date (input.serviceReceipts: every live
  // receipt of the establishments, any month — the VAT share of each depends on the payments before it).
  const branchesInView = new Set(sources.map(source => taxText(source?.branch)));
  const pointTotals = { value: 0, vat: 0 };
  {
    const byInvoice = new Map();
    const lookup = typeof input.invoiceLookup === 'function' ? input.invoiceLookup : () => null;
    for (const receipt of Array.isArray(input.serviceReceipts) ? input.serviceReceipts : []) {
      if (!taxReceiptLive(receipt)) continue;
      const receiptBranch = taxText(receipt._branch || receipt.branch);
      const invoiceNo = taxText(receipt.invNo || receipt.sourceInvoiceNo || receipt.invoiceNo);
      if (!invoiceNo) continue;
      const invoiceBranch = taxText(receipt.invoiceBranch) || receiptBranch;
      if (!branchesInView.has(invoiceBranch)) continue;
      const invoice = lookup(invoiceBranch, invoiceNo);
      if (!invoice || !invoiceTaxPointAtPayment(invoice) || !creditNoteInvoiceLive(invoice)) continue;
      const key = `${invoiceBranch}|${invoiceNo}`;
      if (!byInvoice.has(key)) byInvoice.set(key, { branch: invoiceBranch, invoice, receipts: [] });
      byInvoice.get(key).receipts.push(receipt);
    }
    for (const group of byInvoice.values()) {
      for (const point of paymentTaxPoints(group.invoice, group.receipts)) {
        if (taxPeriodOfDate(point.date) !== period) continue;
        const row = taxRowBase(point.receipt, {
          kind: 'payment_tax_invoice', branch: group.branch, party: taxText(group.invoice.customer), taxId: normalizeTaxIdText(group.invoice.customerTaxId),
          branchCode: establishmentCodeOf(group.invoice.customerBranchCode, group.invoice.customerBranchName), value: taxMoney(point.value), vat: taxMoney(point.vat), total: taxMoney(point.total),
          note: TAX_POINT_TEXT.receiptRowNote(taxText(group.invoice.no)), refs: [taxText(point.receipt.no), taxText(group.invoice.no)]
        });
        if (!row.taxId) { row.flags.push('missingBuyerTaxId'); warnings.missingBuyerTaxId.push({ branch: group.branch, no: row.no, customer: row.party }); }
        pointTotals.value += row.value; pointTotals.vat += row.vat;
        rows.push(row);
      }
    }
  }
  taxSortRows(rows);
  rows.forEach((row, index) => { row.seq = index + 1; });
  // Footer through the one output-VAT engine (summarizeOutputVat) + the payment tax points; the rows must add up to it.
  const engine = summarizeOutputVat({ invoices: included.invoices, creditNotes: included.creditNotes, debitNotes: included.debitNotes });
  const totalValue = taxMoney(engine.netSalesValue + pointTotals.value), totalVat = taxMoney(engine.netOutputVat + pointTotals.vat);
  const totals = { value: totalValue, vat: totalVat, total: taxMoney(totalValue + totalVat) };
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

// input: { period, sources: [{ branch, expenses, goodsReceipts }] — every stored expense of the establishment (a claim
//   may sit in an earlier pack than its claim month) and every goods receipt of it (r13#HIGH-2), entryDate(record) }
export function buildPurchaseTaxReport(input = {}) {
  const period = taxText(input.period);
  const entryDate = typeof input.entryDate === 'function' ? input.entryDate : record => taxEntryDateOf(record);
  const rows = [], forbidden = [], incomplete = [], deferred = [], pendingReceipts = [];
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
    // ADR-031 (rule 7): ภ.พ.36 of imported services paid in a currency — input VAT of the claim month (the month after the
    // payment), one row per live payment of a live foreign expense of this establishment.
    for (const expense of Array.isArray(source?.expenses) ? source.expenses : []) {
      if (!expense || typeof expense !== 'object' || expense.voided === true || expense.deleted === true || !taxText(expense.currency) || taxText(expense.currency).toUpperCase() === 'THB') continue;
      for (const payment of Array.isArray(expense.fxPayments) ? expense.fxPayments : []) {
        if (!payment || payment.status === 'voided' || !taxIsObject(payment.pp36) || taxText(payment.pp36.claimPeriod) !== period) continue;
        const date = taxText(payment.date).slice(0, 10);
        rows.push({ branch, id: payment.id, date, no: TAX_CORE_TEXT.pp36No(taxText(payment.no)), party: taxText(payment.wht?.payeeName || expense.vendor), taxId: '', branchCode: '', receivedDate: date, flags: [], source: 'pp36', kind: 'pp36', value: taxMoney(payment.pp36.baseThb), vat: taxMoney(payment.pp36.vatThb), note: TAX_CORE_TEXT.pp36Note(taxText(payment.no), taxThaiDate(date)) });
      }
    }
    // r13#HIGH-2: the supplier tax invoices of goods receipts (stock purchases) — claimed in their claim month like an
    // expense; a receipt still waiting for its tax invoice is listed apart (it is NOT input tax yet).
    for (const gr of Array.isArray(source?.goodsReceipts) ? source.goodsReceipts : []) {
      if (!gr || typeof gr !== 'object') continue;
      const info = goodsReceiptVatOf(gr);
      if (!(info.vat > 0)) continue;
      const base = {
        branch, id: gr.id, date: taxText(gr.taxInvoiceDate || gr.date).slice(0, 10), no: taxText(gr.taxInvoiceNo || gr.no),
        party: taxText(gr.supplier), taxId: normalizeTaxIdText(gr.vendorTaxId), branchCode: normalizeBuyerBranchCode(gr.vendorBranchCode),
        receivedDate: taxText(gr.taxInvoiceReceivedDate || gr.date).slice(0, 10), flags: [], source: 'goods_receipt', receiptNo: taxText(gr.no)
      };
      if (info.pending) {
        if (taxPeriodOfDate(gr.date) && taxPeriodOfDate(gr.date) <= period) pendingReceipts.push({ ...base, date: taxText(gr.date).slice(0, 10), value: info.value, vat: info.vat });
        continue;
      }
      if (info.claimPeriod !== period) {
        if (taxPeriodOfDate(gr.taxInvoiceDate) === period || taxPeriodOfDate(gr.taxInvoiceReceivedDate) === period) deferred.push({ ...base, value: info.value, vat: info.vat, claimPeriod: info.claimPeriod });
        continue;
      }
      const notes = [TAX_CORE_TEXT.receivedNote(taxThaiDate(base.receivedDate)), TAX_CORE_TEXT.goodsReceiptNote(base.receiptNo)];
      const invoicePeriod = taxPeriodOfDate(gr.taxInvoiceDate);
      if (invoicePeriod && invoicePeriod !== period) notes.push(TAX_CORE_TEXT.invoiceMonthNote(taxPeriodShort(invoicePeriod)));
      const row = { ...base, kind: 'purchase', value: info.value, vat: info.vat, note: notes.join(' · ') };
      if (isLateTaxEntry(base.receivedDate, entryDate({ id: gr.id, createdAt: gr.taxInvoiceRecordedAt || gr.createdAt }))) { row.flags.push('lateEntry'); row.note += ` · ${TAX_CORE_TEXT.lateEntryNote}`; lateEntries.push({ branch, no: row.no }); }
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
    incomplete, deferred, pendingReceipts, pendingTotals: { value: sum(pendingReceipts, 'value'), vat: sum(pendingReceipts, 'vat') }, warnings: { lateEntries }
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
// extension lasts (else the 15th + "check the latest announcement"); BOTH moved past Saturday / Sunday.
export function pp30DueDates(period, deadlines = TAX_DEADLINES) {
  const next = addTaxPeriods(period, 1);
  if (!next) return null;
  const day = value => `${next}-${String(value).padStart(2, '0')}`;
  const paperBase = day(deadlines.pp30.paper);
  const extended = day(deadlines.pp30.efiling);
  const withinExtension = businessDateOrdinal(extended) <= businessDateOrdinal(deadlines.efilingExtensionUntil);
  const efilingBase = withinExtension ? extended : paperBase;
  // r8fix#A4: the paper date is moved past a weekend too (the same rule as ภ.ง.ด.3/53 whtDueDates) — the
  // overdue warning and a filed snapshot's dueDate use the moved date. r13#LOW-1: and past a listed government holiday
  // (ภ.พ.30 ก.ย. 2569 e-filing: Fri 23 ต.ค. = วันปิยมหาราช → Mon 26 ต.ค. 2569).
  return taxDueDatePair(paperBase, efilingBase, withinExtension);
}
// Both due dates of a return, rolled past weekends and holidays, with what moved them (shared by ภ.พ.30 and ภ.ง.ด.3/53).
export function taxDueDatePair(paperBase, efilingBase, withinExtension) {
  const paper = rollTaxDueDate(paperBase), efiling = rollTaxDueDate(efilingBase);
  return {
    paper, efiling, paperRolled: paper !== paperBase, efilingRolled: efiling !== efilingBase, efilingExtended: withinExtension, checkLatest: !withinExtension,
    paperHolidays: taxRolledHolidays(paperBase, paper), efilingHolidays: taxRolledHolidays(efilingBase, efiling),
    holidayStatus: taxHolidayYearStatus(efiling) && taxHolidayYearStatus(paper) ? (taxHolidayYearStatus(efiling) === 'official' && taxHolidayYearStatus(paper) === 'official' ? 'official' : 'provisional') : 'unknown'
  };
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
// r8fix#B4: filing history is append-only under BOTH import modes — a "replace" restore never drops a filed ภ.พ.30
// (a filed month must stay filed: it guards edits, cancels and deletes). The option is accepted and ignored.
export function mergeVatReturnsStores(current, incoming, options = {}) {
  void options;
  const next = normalizeVatReturnsStore(incoming);
  const base = normalizeVatReturnsStore(current);
  const ids = new Set(base.returns.map(row => row.id));
  const slots = new Set(base.returns.map(row => `${row.branchKey}|${row.period}|${row.amendment}`));
  const added = next.returns.filter(row => !ids.has(row.id) && !slots.has(`${row.branchKey}|${row.period}|${row.amendment}`));
  return normalizeVatReturnsStore({ schemaVersion: VAT_RETURN_SCHEMA_VERSION, returns: [...base.returns, ...added] });
}
