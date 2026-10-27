// ============================================================================
// erp-tax-forms.js — the form controls of ADR-023 (round 8, stage C)
// ERP DEMO 4.3.1
// ----------------------------------------------------------------------------
// 1. Expense form › "ภาษีซื้อ (ใบกำกับภาษี)": shown only when the evidence type is a tax invoice
//    (ใบกำกับภาษีเต็มรูป / ใบเสร็จรับเงิน-ใบกำกับภาษี / ใบกำกับภาษีอย่างย่อ) so a simple non-VAT expense
//    keeps the simple form. Supplier Master autofill (TIN, establishment, address), VAT mode, invoice /
//    received dates, claim month, "ขอใช้สิทธิ์ภาษีซื้อ" or a 82/5 reason, live VAT split preview.
//    app.js reads window.ERPTaxForms.expenseDraft() at save; the rules (split, 6-month window, …)
//    are in erp-tax-reports-core.js planExpenseVatFields(), run by the finance planner.
// 2. Supplier Master › สำนักงานใหญ่ / สาขาที่ + ชื่อสาขา (G5) and the TIN check-digit warning.
// 3. Invoice form › for "ไม่มี VAT": ยกเว้น VAT or อัตราร้อยละ 0 (vatCategory, G4) + r13: the export entry number of a
//    0 % sale (MED-4), "ออกใบกำกับภาษีเมื่อได้รับชำระ" for services (MED-6, ม.78/1), the service period (LOW-5) and the
//    "ออกแทนใบกำกับภาษีเลขที่ …" reference of a replacement invoice (MED-3, ข้อหารือ กค 0702(กม.05)/1041).
// 4. r13: Supplier Master "จดทะเบียน VAT" (MED-1), the late-claim reason (LOW-3), the tax-invoice duplicate guard
//    across expenses AND goods receipts (HIGH-2), the tax point of a service receipt (MED-6).
// Every control is created here (texts in TAX_FORMS_TEXT); app.js only calls window.ERPTaxForms.
// ============================================================================
import { escapeHtml, fmt, calculateVatSummary, parseMoney } from './erp-shared-core.js';
import { WHT_TEXT, WHT_INCOME_TYPES } from './erp-payer-wht-core.js';
import { GR_TAX_TEXT, GOODS_RECEIPT_VAT_MODES, planGoodsReceiptVatFields, planGoodsReceiptTaxInvoice } from './erp-tax-reports-core.js';
import { TAX_CORE_TEXT, EXPENSE_TAX_INVOICE_DOC_TYPES, NON_CLAIMABLE_REASON_CODES, PURCHASE_VAT_MODES, LATE_CLAIM_REASON_CODES, parseSupplierBranchInput, supplierEstablishmentOf, expenseTaxInvoiceKey, expenseHasVatData, expenseVatIncomplete, normalizeTaxIdText, isThirteenDigitTaxId, taxIdCheckDigitOk, taxPeriodOfDate, parseTaxPeriod, taxPeriodShort, taxThaiDate, invoiceTaxPointAtPayment, paymentTaxPoints } from './erp-tax-reports-core.js';
import { FinanceActionError, FINANCE_ACTION_ERROR_CODES } from './erp-document-finance-core.js';

const TAX_FORMS_TEXT = Object.freeze({
  sectionTitle: 'ภาษีซื้อ (ข้อมูลจากใบกำกับภาษีของผู้ขาย)',
  sectionHelp: 'กรอกตามใบกำกับภาษีที่ได้รับ — ใช้ทำรายงานภาษีซื้อและ ภ.พ.30 · ยอด "จำนวนเงิน" ด้านบนยังเป็นยอดค่าใช้จ่ายรวมเหมือนเดิม',
  notReceived: 'ยังไม่ได้รับใบกำกับภาษี — บันทึกค่าใช้จ่ายได้ตามปกติ แต่ยังไม่นำไปทำรายงานภาษีซื้อ (รายการจะมีป้าย "ข้อมูล VAT ไม่ครบ") · เมื่อได้รับใบกำกับภาษีแล้ว ให้เลือกสถานะ "ได้รับใบกำกับภาษีแล้ว" แล้วกรอกข้อมูลภาษีซื้อ',
  supplierPick: 'เลือกผู้ขายจากทะเบียนผู้จำหน่าย',
  supplierNone: '— ไม่เลือก (กรอกเอง) —',
  supplierHelp: 'เลือกแล้วระบบเติมชื่อ เลขผู้เสียภาษี สาขา และที่อยู่ให้',
  vendorTaxId: 'เลขประจำตัวผู้เสียภาษีของผู้ขาย (13 หลัก)',
  vendorBranch: 'สถานประกอบการของผู้ขาย',
  headOffice: 'สำนักงานใหญ่',
  branchNo: 'สาขาที่',
  branchCodePlaceholder: 'เช่น 00001',
  vendorAddress: 'ที่อยู่ผู้ขาย (ตามใบกำกับภาษี)',
  vatMode: 'ยอด "จำนวนเงิน" ด้านบนเป็นยอดแบบไหน',
  invoiceDate: 'วันที่ในใบกำกับภาษี',
  receivedDate: 'วันที่ได้รับใบกำกับภาษี',
  claimPeriod: 'ใช้สิทธิ์ภาษีซื้อในเดือนภาษี',
  claimHelp: 'ปกติ = เดือนที่ได้รับใบกำกับภาษี · เลื่อนไปเดือนถัดไปได้ แต่ไม่เกิน 6 เดือนนับจากเดือนในใบกำกับภาษี (มาตรา 82/3)',
  claimable: 'ขอใช้สิทธิ์ภาษีซื้อ (นำไปหักในรายงานภาษีซื้อและ ภ.พ.30)',
  reason: 'เหตุผลที่ไม่ขอใช้สิทธิ์ (ภาษีซื้อต้องห้าม มาตรา 82/5)',
  reasonPick: '— เลือกเหตุผล —',
  abbreviatedNote: 'ใบกำกับภาษีอย่างย่อใช้เป็นภาษีซื้อไม่ได้ — VAT ของเอกสารนี้นับเป็นต้นทุนค่าใช้จ่าย และแสดงในรายการภาษีซื้อต้องห้าม',
  fuelHint: 'ค่าน้ำมัน / เช่า / ซ่อม รถยนต์นั่งไม่เกิน 10 ที่นั่ง เป็นภาษีซื้อต้องห้าม — เอาเครื่องหมายถูก "ขอใช้สิทธิ์" ออกแล้วเลือกเหตุผล',
  entertainmentHint: 'ค่ารับรองเป็นภาษีซื้อต้องห้าม — เอาเครื่องหมายถูก "ขอใช้สิทธิ์" ออกแล้วเลือกเหตุผล',
  splitTitle: 'ระบบคำนวณจากยอดที่กรอก',
  splitValue: 'มูลค่าก่อน VAT',
  splitVat: 'VAT 7%',
  splitTotal: 'บันทึกเป็นค่าใช้จ่ายรวม',
  splitNoAmount: 'กรอกจำนวนเงินด้านบนเพื่อดูการแยก VAT',
  splitNotClaimed: 'VAT นี้ไม่นำไปหัก (ภาษีซื้อต้องห้าม) — เป็นต้นทุน',
  taxIdBad: 'เลข 13 หลักนี้หลักสุดท้ายไม่ตรงกับเลขตรวจสอบ — ตรวจกับใบกำกับภาษีอีกครั้ง (บันทึกได้)',
  taxIdLength: 'ต้องเป็นตัวเลข 13 หลัก',
  taxIdOk: 'เลขตรวจสอบถูกต้อง',
  supplierBranchKind: 'สำนักงานใหญ่ / สาขา',
  supplierBranchUnset: 'ไม่ระบุ',
  supplierBranchCode: 'เลขที่สาขา (5 หลัก)',
  supplierBranchName: 'ชื่อสาขา (ถ้ามี)',
  supplierBranchNamePlaceholder: 'เช่น สาขาวารินชำราบ',
  supplierWhtType: 'หัก ณ ที่จ่ายเป็นประจำ (ประเภทเงินได้)',
  supplierVat: 'จดทะเบียนภาษีมูลค่าเพิ่ม (VAT)',
  supplierVatUnknown: 'ไม่ทราบ',
  supplierVatYes: 'จด VAT',
  supplierVatNo: 'ไม่ได้จด VAT',
  supplierContract: 'จ่ายตามสัญญาต่อเนื่อง (เช่น ค่าเช่ารายเดือน)',
  supplierContractTotal: 'ยอดเงินทั้งสัญญา (บาท)',
  lateReason: 'เหตุที่ใช้สิทธิ์ในเดือนหลัง (ประกาศอธิบดีฯ VAT ฉบับที่ 4)',
  lateReasonPick: '— เลือกเหตุผล —',
  lateNote: 'ระบุเหตุผล',
  taxPoint: 'ออกใบกำกับภาษีเมื่อได้รับชำระ (ค่าบริการ — มาตรา 78/1)',
  taxPointHelp: 'พิมพ์เป็น "ใบแจ้งหนี้" (ยังไม่ใช่ใบกำกับภาษี) · ใบเสร็จแต่ละใบเป็นใบเสร็จรับเงิน/ใบกำกับภาษี และภาษีขายเข้ารายงานตามวันที่รับเงิน · ใช้ได้เฉพาะรายการบริการ',
  exportDecl: 'เลขที่ใบขนสินค้าขาออก (ถ้าส่งออกสินค้า)',
  servicePeriod: 'ระยะเวลาให้บริการ (ถ้าครอบคลุมหลายเดือน)',
  servicePeriodHelp: 'เช่น MA 1 ปี หรือไลเซนส์รายปี — ชุดปิดเดือนจะคำนวณรายได้รับล่วงหน้าแบบเส้นตรงให้นักบัญชีพิจารณา (ไม่ลงบัญชีอัตโนมัติ)',
  servicePeriodFrom: 'ตั้งแต่',
  servicePeriodTo: 'ถึง',
  replaces: (no, date) => `ออกแทนใบกำกับภาษีเลขที่ ${no}${date ? ` ลงวันที่ ${date}` : ''} (ยกเลิกแล้ว) — วันที่ตั้งตามจุดความรับผิดเดิม เปลี่ยนได้ถ้าส่งมอบจริงวันอื่น`,
  replacesClear: 'ไม่ใช่ฉบับแทน',
  replacePrepared: no => `เปิดฟอร์มใบกำกับภาษีฉบับใหม่แทน ${no} แล้ว — ตรวจรายการและวันที่ แล้วกดบันทึก (ได้เลขที่ใหม่)`,
  replaceNotFound: 'ไม่พบใบกำกับภาษีที่ยกเลิก',
  replaceLive: 'ใบกำกับภาษีนี้ยังไม่ได้ยกเลิก — ยกเลิกก่อนแล้วจึงออกฉบับใหม่แทน',
  supplierWhtNone: 'ไม่หัก / เลือกตอนจ่าย',
  supplierTaxIdWarn: taxId => `เลขประจำตัวผู้เสียภาษี ${taxId} หลักสุดท้ายไม่ตรงกับเลขตรวจสอบ — ตรวจอีกครั้ง`,
  supplierTaxIdLengthWarn: taxId => `เลขประจำตัวผู้เสียภาษี "${taxId}" ไม่ใช่ตัวเลข 13 หลัก — ใบกำกับภาษีที่ใช้สิทธิ์ภาษีซื้อได้ต้องมีเลข 13 หลัก`,
  invoiceCategory: 'ยอดขายไม่มี VAT นี้เป็นแบบ',
  categoryExempt: 'ได้รับยกเว้น VAT (มาตรา 81)',
  categoryZero: 'อัตราร้อยละ 0 — ส่งออก (มาตรา 80/1)',
  categoryHelp: 'ใช้แยกบรรทัด 2 / 3 ของ ภ.พ.30 · อัตราร้อยละ 0 แสดงในรายงานภาษีขาย ยกเว้นไม่แสดง',
  badgeClaim: period => `ภาษีซื้อ ${period}`,
  badgeForbidden: 'ภาษีซื้อต้องห้าม',
  badgeIncomplete: TAX_CORE_TEXT.incompleteBadge,
  detailVatMode: 'วิธีคิด VAT (ภาษีซื้อ)',
  detailValue: 'มูลค่าก่อน VAT',
  detailVat: 'ภาษีซื้อ (VAT)',
  detailVendorTaxId: 'เลขประจำตัวผู้เสียภาษีผู้ขาย',
  detailVendorBranch: 'สถานประกอบการผู้ขาย',
  detailTaxInvoice: 'ใบกำกับภาษี (เลขที่ · วันที่)',
  detailReceived: 'วันที่ได้รับใบกำกับภาษี',
  detailClaim: 'ใช้สิทธิ์ภาษีซื้อ',
  detailClaimMonth: period => `เดือนภาษี ${period}`,
  detailForbidden: reason => `ไม่ใช้สิทธิ์ — ${reason}`,
  detailIncomplete: 'ข้อมูลภาษีซื้อ'
});

const $ = id => document.getElementById(id);
const value = id => String($(id)?.value ?? '').trim();
const state = { claimTouched: false, receivedTouched: false, invoiceDateTouched: false };

// ---------------------------------------------------------------- Supplier Master rows
function supplierRows() {
  const rows = typeof window.contactMasterRows === 'function' ? window.contactMasterRows() : [];
  return (Array.isArray(rows) ? rows : []).filter(row => row && row.active !== false && ['supplier', 'both'].includes(row.role));
}
function supplierById(id) {
  return supplierRows().find(row => String(row.id) === String(id)) || null;
}

// ---------------------------------------------------------------- 1. expense form
function reasonOptions() {
  return `<option value="">${escapeHtml(TAX_FORMS_TEXT.reasonPick)}</option>${NON_CLAIMABLE_REASON_CODES.filter(code => code !== 'abbreviated').map(code => `<option value="${code}">${escapeHtml(TAX_CORE_TEXT.nonClaimable[code])}</option>`).join('')}`;
}
function expenseSectionHtml() {
  return `<div class="tax-exp-head"><b>${escapeHtml(TAX_FORMS_TEXT.sectionTitle)}</b><small>${escapeHtml(TAX_FORMS_TEXT.sectionHelp)}</small></div>
  <div class="tax-note tax-note-info" id="e-tax-not-received" hidden>${escapeHtml(TAX_FORMS_TEXT.notReceived)}</div>
  <div class="tax-exp-grid" id="e-tax-grid">
    <div class="ff tax-exp-wide"><label for="e-tax-supplier">${escapeHtml(TAX_FORMS_TEXT.supplierPick)}</label><select id="e-tax-supplier"></select><small class="tax-help">${escapeHtml(TAX_FORMS_TEXT.supplierHelp)}</small></div>
    <div class="ff"><label for="e-tax-vendor-tax-id">${escapeHtml(TAX_FORMS_TEXT.vendorTaxId)}</label><input id="e-tax-vendor-tax-id" inputmode="numeric" autocomplete="off" maxlength="17" placeholder="0000000000000" aria-describedby="e-tax-vendor-tax-id-hint"><small class="tax-help" id="e-tax-vendor-tax-id-hint" aria-live="polite"></small></div>
    <div class="ff"><span class="tax-label" id="e-tax-branch-label">${escapeHtml(TAX_FORMS_TEXT.vendorBranch)}</span><div class="tax-branch-row" role="group" aria-labelledby="e-tax-branch-label"><select id="e-tax-vendor-branch-kind" aria-label="${escapeHtml(TAX_FORMS_TEXT.vendorBranch)}"><option value="hq">${escapeHtml(TAX_FORMS_TEXT.headOffice)}</option><option value="branch">${escapeHtml(TAX_FORMS_TEXT.branchNo)}</option></select><input id="e-tax-vendor-branch-code" inputmode="numeric" maxlength="5" placeholder="${escapeHtml(TAX_FORMS_TEXT.branchCodePlaceholder)}" aria-label="${escapeHtml(TAX_FORMS_TEXT.supplierBranchCode)}" hidden></div></div>
    <div class="ff tax-exp-wide"><label for="e-tax-vendor-address">${escapeHtml(TAX_FORMS_TEXT.vendorAddress)}</label><input id="e-tax-vendor-address" maxlength="300"></div>
    <div class="ff"><label for="e-tax-vat-mode">${escapeHtml(TAX_FORMS_TEXT.vatMode)}</label><select id="e-tax-vat-mode">${PURCHASE_VAT_MODES.map(mode => `<option value="${mode}">${escapeHtml(TAX_CORE_TEXT.vatModes[mode])}</option>`).join('')}</select></div>
    <div class="ff"><label for="e-tax-invoice-date">${escapeHtml(TAX_FORMS_TEXT.invoiceDate)}</label><input type="date" id="e-tax-invoice-date"></div>
    <div class="ff"><label for="e-tax-received-date">${escapeHtml(TAX_FORMS_TEXT.receivedDate)}</label><input type="date" id="e-tax-received-date"></div>
    <div class="ff tax-claim-only"><label for="e-tax-claim-period">${escapeHtml(TAX_FORMS_TEXT.claimPeriod)}</label><input type="month" id="e-tax-claim-period" placeholder="YYYY-MM" aria-describedby="e-tax-claim-help"><small class="tax-help" id="e-tax-claim-help">${escapeHtml(TAX_FORMS_TEXT.claimHelp)}</small></div>
    <div class="ff tax-claim-only" id="e-tax-late-field" hidden><label for="e-tax-late-reason">${escapeHtml(TAX_FORMS_TEXT.lateReason)}</label><select id="e-tax-late-reason"><option value="">${escapeHtml(TAX_FORMS_TEXT.lateReasonPick)}</option>${LATE_CLAIM_REASON_CODES.map(code => `<option value="${code}">${escapeHtml(TAX_CORE_TEXT.lateClaimReasons[code])}</option>`).join('')}</select><input id="e-tax-late-note" maxlength="200" placeholder="${escapeHtml(TAX_FORMS_TEXT.lateNote)}" hidden><small class="tax-help tax-hint-warn" id="e-tax-late-endorse" aria-live="polite"></small></div>
    <div class="ff tax-exp-wide tax-claim-switch"><label class="tax-check"><input type="checkbox" id="e-tax-claimable" checked> <span>${escapeHtml(TAX_FORMS_TEXT.claimable)}</span></label><small class="tax-help tax-hint-warn" id="e-tax-category-hint" aria-live="polite"></small></div>
    <div class="ff tax-exp-wide" id="e-tax-reason-field" hidden><label for="e-tax-reason">${escapeHtml(TAX_FORMS_TEXT.reason)}</label><select id="e-tax-reason">${reasonOptions()}</select></div>
    <div class="tax-note tax-exp-wide" id="e-tax-abbreviated-note" hidden>${escapeHtml(TAX_FORMS_TEXT.abbreviatedNote)}</div>
    <div class="tax-exp-split tax-exp-wide" id="e-tax-split" aria-live="polite"></div>
  </div>`;
}
function ensureExpenseSection() {
  if ($('e-tax-section')) return $('e-tax-section');
  const anchor = $('e-purpose')?.closest('.ff');
  if (!anchor) return null;
  const section = document.createElement('div');
  section.id = 'e-tax-section';
  section.className = 'ff-full tax-exp';
  section.hidden = true;
  section.innerHTML = expenseSectionHtml();
  anchor.after(section);
  bindExpenseSection(section);
  return section;
}
function isTaxDocType() {
  return EXPENSE_TAX_INVOICE_DOC_TYPES.includes(value('e-doc-type'));
}
// The purchase-tax fields are filled from the tax invoice in hand: only with "ได้รับใบกำกับภาษีแล้ว".
function taxInvoiceInHand() {
  return isTaxDocType() && value('e-tax-status') === 'received';
}
function fillSupplierOptions() {
  const select = $('e-tax-supplier');
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">${escapeHtml(TAX_FORMS_TEXT.supplierNone)}</option>${supplierRows().map(row => `<option value="${escapeHtml(String(row.id))}" data-no-i18n>${escapeHtml(row.name || '-')}${row.taxId ? ` · ${escapeHtml(normalizeTaxIdText(row.taxId))}` : ''}</option>`).join('')}`;
  select.value = [...select.options].some(option => option.value === current) ? current : '';
}
function setVendorBranch(code) {
  const kind = $('e-tax-vendor-branch-kind'), input = $('e-tax-vendor-branch-code');
  if (!kind || !input) return;
  const branch = /^\d{5}$/.test(code) && code !== '00000';
  kind.value = branch ? 'branch' : 'hq';
  input.value = branch ? code : '';
  input.hidden = !branch;
}
function applySupplier(id) {
  const row = supplierById(id);
  if (!row) return;
  const vendor = $('e-vendor');
  if (vendor) { vendor.value = row.name || ''; vendor.dispatchEvent(new Event('input', { bubbles: true })); }
  if ($('e-tax-vendor-tax-id')) $('e-tax-vendor-tax-id').value = normalizeTaxIdText(row.taxId);
  if ($('e-tax-vendor-address')) $('e-tax-vendor-address').value = String(row.address || '');
  setVendorBranch(supplierEstablishmentOf(row));
}
function taxIdHint() {
  const hint = $('e-tax-vendor-tax-id-hint');
  if (!hint) return;
  const taxId = normalizeTaxIdText(value('e-tax-vendor-tax-id'));
  hint.className = 'tax-help';
  if (!taxId) { hint.textContent = ''; return; }
  if (!isThirteenDigitTaxId(taxId)) { hint.textContent = TAX_FORMS_TEXT.taxIdLength; hint.classList.add('tax-hint-warn'); return; }
  const ok = taxIdCheckDigitOk(taxId);
  hint.textContent = ok ? TAX_FORMS_TEXT.taxIdOk : TAX_FORMS_TEXT.taxIdBad;
  hint.classList.add(ok ? 'tax-hint-ok' : 'tax-hint-warn');
}
function syncDefaults() {
  const expenseDate = value('e-date');
  const invoiceDate = $('e-tax-invoice-date'), received = $('e-tax-received-date'), claim = $('e-tax-claim-period');
  if (invoiceDate && !state.invoiceDateTouched && /^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) invoiceDate.value = expenseDate;
  if (received && !state.receivedTouched && invoiceDate?.value) received.value = invoiceDate.value;
  if (claim && !state.claimTouched) claim.value = taxPeriodOfDate(received?.value || invoiceDate?.value || '');
}
// Show / hide what applies to the chosen evidence type, VAT mode and claim choice, and the split.
function refreshExpenseSection() {
  const section = ensureExpenseSection();
  if (!section) return;
  const show = isTaxDocType();
  section.hidden = !show;
  if (!show) return;
  const inHand = taxInvoiceInHand();
  $('e-tax-not-received').hidden = inHand;
  $('e-tax-grid').hidden = !inHand;
  if (!inHand) return;
  const abbreviated = value('e-doc-type') === 'abbreviated_tax_invoice';
  const mode = value('e-tax-vat-mode') || 'extract';
  const noVat = mode === 'none';
  const claimable = !abbreviated && !noVat && !!$('e-tax-claimable')?.checked;
  section.querySelectorAll('.tax-claim-switch').forEach(el => { el.hidden = abbreviated || noVat; });
  section.querySelectorAll('.tax-claim-only').forEach(el => { el.hidden = !claimable; });
  $('e-tax-reason-field').hidden = abbreviated || noVat || claimable;
  $('e-tax-abbreviated-note').hidden = !abbreviated || noVat;
  $('e-tax-vendor-branch-code').hidden = value('e-tax-vendor-branch-kind') !== 'branch';
  // r13#LOW-3: a claim month after the received month needs a reason and the endorsement on the invoice.
  const received = taxPeriodOfDate(value('e-tax-received-date') || value('e-tax-invoice-date'));
  const late = claimable && !!value('e-tax-claim-period') && !!received && value('e-tax-claim-period') !== received;
  $('e-tax-late-field').hidden = !late;
  $('e-tax-late-note').hidden = !late || value('e-tax-late-reason') !== 'other';
  $('e-tax-late-endorse').textContent = late ? TAX_CORE_TEXT.lateClaimEndorse(taxPeriodShort(value('e-tax-claim-period'))) : '';
  const category = value('e-cat');
  const hint = $('e-tax-category-hint');
  if (hint) hint.textContent = category === 'ค่าน้ำมันเชื้อเพลิง' ? TAX_FORMS_TEXT.fuelHint : category === 'ค่าอาหาร/รับรอง' ? TAX_FORMS_TEXT.entertainmentHint : '';
  const amount = parseMoney(value('e-amount'));
  const split = $('e-tax-split');
  if (!split) return;
  if (!(amount > 0)) { split.innerHTML = `<span class="tax-help">${escapeHtml(TAX_FORMS_TEXT.splitNoAmount)}</span>`; return; }
  const vat = calculateVatSummary(amount, mode);
  split.innerHTML = `<b>${escapeHtml(TAX_FORMS_TEXT.splitTitle)}</b>
    <span>${escapeHtml(TAX_FORMS_TEXT.splitValue)} <strong data-tax-split="value">฿${fmt(vat.subtotal)}</strong></span>
    <span>${escapeHtml(TAX_FORMS_TEXT.splitVat)} <strong data-tax-split="vat">฿${fmt(vat.vatAmt)}</strong></span>
    <span>${escapeHtml(TAX_FORMS_TEXT.splitTotal)} <strong data-tax-split="total">฿${fmt(vat.total)}</strong></span>
    ${vat.vatAmt > 0 && !claimable ? `<em class="tax-hint-warn">${escapeHtml(TAX_FORMS_TEXT.splitNotClaimed)}</em>` : ''}`;
}
function bindExpenseSection(section) {
  section.addEventListener('change', event => {
    const id = event.target?.id;
    if (id === 'e-tax-supplier') applySupplier(event.target.value);
    if (id === 'e-tax-invoice-date') { state.invoiceDateTouched = true; syncDefaults(); }
    if (id === 'e-tax-received-date') { state.receivedTouched = true; syncDefaults(); }
    if (id === 'e-tax-claim-period') state.claimTouched = true;
    refreshExpenseSection();
  });
  section.addEventListener('input', event => {
    if (event.target?.id === 'e-tax-vendor-tax-id') taxIdHint();
    if (event.target?.id === 'e-tax-claim-period') state.claimTouched = true;
  });
  section.addEventListener('focusin', event => { if (event.target?.id === 'e-tax-supplier') fillSupplierOptions(); });
}
function onExpenseFormChange(event) {
  const id = event.target?.id;
  if (!['e-doc-type', 'e-tax-status', 'e-amount', 'e-date', 'e-cat', 'e-vendor'].includes(id)) return;
  if (id === 'e-doc-type' && isTaxDocType()) {
    // Choosing a tax-invoice type usually means it is in hand: the status follows (the user can change it back).
    const status = $('e-tax-status');
    if (status && status.value !== 'received') { status.value = 'received'; status.dispatchEvent(new Event('change', { bubbles: true })); }
    fillSupplierOptions(); syncDefaults();
  }
  if (id === 'e-date') syncDefaults();
  if (id === 'e-vendor') {
    // Typing a Supplier Master name exactly fills the tax fields once (an explicit pick always wins).
    const name = value('e-vendor'), select = $('e-tax-supplier');
    const row = supplierRows().find(item => String(item.name || '').trim() === name);
    if (row && select && !select.value && !value('e-tax-vendor-tax-id')) { fillSupplierOptions(); select.value = String(row.id); applySupplier(row.id); taxIdHint(); }
  }
  refreshExpenseSection();
}

// What app.js stores with the expense (only for a tax invoice in hand; {} otherwise = the expense as before
// ADR-023, shown with "ข้อมูล VAT ไม่ครบ" when it is a tax-invoice type).
function expenseDraft() {
  ensureExpenseSection();
  // ADR-024: the payer-side withholding part (50 ทวิ) of the same payment — its own keys (wht*, payee*).
  const wht = window.ERPPayerWht?.expenseDraft?.() || {};
  if (!taxInvoiceInHand()) return wht;
  const kind = value('e-tax-vendor-branch-kind');
  const branchInput = parseSupplierBranchInput(kind, value('e-tax-vendor-branch-code'));
  const supplier = supplierById(value('e-tax-supplier'));
  const abbreviated = value('e-doc-type') === 'abbreviated_tax_invoice';
  const claimable = !abbreviated && !!$('e-tax-claimable')?.checked;
  return {
    vatMode: value('e-tax-vat-mode') || 'extract',
    vendorId: supplier && String(supplier.name || '').trim() === value('e-vendor') ? String(supplier.id) : '',
    vendorTaxId: normalizeTaxIdText(value('e-tax-vendor-tax-id')),
    // an invalid branch number is passed as typed so the planner refuses it with its message
    vendorBranchCode: branchInput.ok ? branchInput.code : (value('e-tax-vendor-branch-code') || 'x'),
    vendorAddress: value('e-tax-vendor-address'),
    taxInvoiceDate: value('e-tax-invoice-date'),
    taxInvoiceReceivedDate: value('e-tax-received-date'),
    claimPeriod: claimable ? value('e-tax-claim-period') : '',
    inputVatClaimable: claimable,
    nonClaimableReason: claimable ? '' : value('e-tax-reason'),
    lateClaimReason: claimable ? value('e-tax-late-reason') : '',
    lateClaimNote: claimable ? value('e-tax-late-note') : '',
    ...wht
  };
}
// A claim month that is already closed (ERPGovernance period lock, scope ซื้อ/ภาษีซื้อ) refuses the save.
function assertClaimPeriodOpen(branch, draft = {}) {
  // r13#HIGH-2: the same supplier tax invoice (seller TIN + number) may be claimed only once — across goods receipts too.
  if (draft.vatMode && draft.vatMode !== 'none') {
    const key = expenseTaxInvoiceKey(draft.vendorTaxId, value('e-doc-no'));
    const hit = key && goodsReceiptRows().find(row => !row.reversed && expenseTaxInvoiceKey(row.vendorTaxId, row.taxInvoiceNo) === key);
    if (hit) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, `${TAX_CORE_TEXT.errDuplicateTaxInvoice(value('e-doc-no'), normalizeTaxIdText(draft.vendorTaxId))} (ใบรับสินค้า ${hit.no})`);
  }
  if (!draft.vatMode || draft.vatMode === 'none' || draft.inputVatClaimable !== true) return;
  const period = draft.claimPeriod || taxPeriodOfDate(draft.taxInvoiceReceivedDate || draft.taxInvoiceDate);
  if (!parseTaxPeriod(period)) return; // the planner reports the missing month
  window.ERPGovernance?.assertPeriodOpen?.({ branch, date: `${period}-01`, scope: 'purchase', action: 'expense_claim' });
}
function goodsReceiptRows() {
  const key = window.ERPProductionCore?.KEYS?.goodsReceipts;
  if (!key) return [];
  try { const rows = JSON.parse(localStorage.getItem(window.ComformTenant?.storageKey?.(key) || key) || '[]'); return Array.isArray(rows) ? rows : []; } catch { return []; }
}
function resetExpense() {
  Object.assign(state, { claimTouched: false, receivedTouched: false, invoiceDateTouched: false });
  if ($('e-tax-late-reason')) $('e-tax-late-reason').value = '';
  if ($('e-tax-late-note')) $('e-tax-late-note').value = '';
  window.ERPPayerWht?.resetExpense?.();
  const section = ensureExpenseSection();
  if (!section) return;
  ['e-tax-vendor-tax-id', 'e-tax-vendor-address', 'e-tax-invoice-date', 'e-tax-received-date', 'e-tax-claim-period', 'e-tax-vendor-branch-code'].forEach(id => { if ($(id)) $(id).value = ''; });
  if ($('e-tax-supplier')) $('e-tax-supplier').value = '';
  if ($('e-tax-vendor-branch-kind')) $('e-tax-vendor-branch-kind').value = 'hq';
  if ($('e-tax-vat-mode')) $('e-tax-vat-mode').value = 'extract';
  if ($('e-tax-claimable')) $('e-tax-claimable').checked = true;
  if ($('e-tax-reason')) $('e-tax-reason').value = '';
  taxIdHint();
  syncDefaults();
  refreshExpenseSection();
}

// Expense list badge and detail rows.
function expenseBadgeHtml(expense = {}) {
  return vatBadgeHtml(expense) + (window.ERPPayerWht?.expenseBadgeHtml?.(expense) || ''); // ADR-024: + the 50 ทวิ badge
}
function vatBadgeHtml(expense = {}) {
  if (expenseVatIncomplete(expense)) return `<span class="tax-badge tax-badge-warn" title="${escapeHtml(TAX_CORE_TEXT.incompleteHint)}">${escapeHtml(TAX_FORMS_TEXT.badgeIncomplete)}</span>`;
  if (!expenseHasVatData(expense) || !(Number(expense.vatAmt) > 0)) return '';
  if (expense.inputVatClaimable === true) return `<span class="tax-badge tax-badge-ok">${escapeHtml(TAX_FORMS_TEXT.badgeClaim(taxPeriodShort(expense.claimPeriod)))}</span>`;
  return `<span class="tax-badge tax-badge-bad" title="${escapeHtml(TAX_CORE_TEXT.nonClaimable[expense.nonClaimableReason] || '')}">${escapeHtml(TAX_FORMS_TEXT.badgeForbidden)}</span>`;
}
function expenseDetailRows(doc = {}, dr, html) {
  if (typeof dr !== 'function') return '';
  return vatDetailRows(doc, dr, html) + (window.ERPPayerWht?.expenseDetailRows?.(doc, dr) || ''); // ADR-024: + withholding
}
function vatDetailRows(doc, dr, html) {
  if (expenseVatIncomplete(doc)) return dr(TAX_FORMS_TEXT.detailIncomplete, `${TAX_FORMS_TEXT.badgeIncomplete} — ${TAX_CORE_TEXT.incompleteHint}`);
  if (!expenseHasVatData(doc)) return '';
  const branch = doc.vendorBranchCode === '00000' ? TAX_FORMS_TEXT.headOffice : doc.vendorBranchCode ? `${TAX_FORMS_TEXT.branchNo} ${doc.vendorBranchCode}` : '-';
  const claim = Number(doc.vatAmt) > 0
    ? (doc.inputVatClaimable === true ? TAX_FORMS_TEXT.detailClaimMonth(taxPeriodShort(doc.claimPeriod)) : TAX_FORMS_TEXT.detailForbidden(TAX_CORE_TEXT.nonClaimable[doc.nonClaimableReason] || '-'))
    : '-';
  return dr(TAX_FORMS_TEXT.detailVatMode, TAX_CORE_TEXT.vatModes[doc.vatMode] || '-')
    + dr(TAX_FORMS_TEXT.detailValue, `฿${fmt(doc.subtotal)}`)
    + dr(TAX_FORMS_TEXT.detailVat, `฿${fmt(doc.vatAmt)}`)
    + dr(TAX_FORMS_TEXT.detailVendorTaxId, doc.vendorTaxId || '-')
    + dr(TAX_FORMS_TEXT.detailVendorBranch, branch)
    + dr(TAX_FORMS_TEXT.detailTaxInvoice, `${doc.taxInvoiceNo || doc.docNo || '-'} · ${taxThaiDate(doc.taxInvoiceDate) || '-'}`)
    + dr(TAX_FORMS_TEXT.detailReceived, taxThaiDate(doc.taxInvoiceReceivedDate) || '-')
    + dr(TAX_FORMS_TEXT.detailClaim, typeof html === 'function' ? html(vatBadgeHtml(doc) || escapeHtml(claim)) : claim);
}

// ---------------------------------------------------------------- 2. Supplier Master establishment
function ensureSupplierFields() {
  if ($('md-s-branch-kind')) return true;
  const taxLabel = $('md-s-tax')?.closest('label');
  if (!taxLabel) return false;
  taxLabel.insertAdjacentHTML('afterend', `<label><span>${escapeHtml(TAX_FORMS_TEXT.supplierBranchKind)}</span><select id="md-s-branch-kind"><option value="">${escapeHtml(TAX_FORMS_TEXT.supplierBranchUnset)}</option><option value="hq">${escapeHtml(TAX_FORMS_TEXT.headOffice)}</option><option value="branch">${escapeHtml(TAX_FORMS_TEXT.branchNo)}</option></select></label>
    <label><span>${escapeHtml(TAX_FORMS_TEXT.supplierBranchCode)}</span><input id="md-s-branch-code" inputmode="numeric" maxlength="5" placeholder="${escapeHtml(TAX_FORMS_TEXT.branchCodePlaceholder)}" disabled></label>
    <label><span>${escapeHtml(TAX_FORMS_TEXT.supplierBranchName)}</span><input id="md-s-branch-name" maxlength="80" placeholder="${escapeHtml(TAX_FORMS_TEXT.supplierBranchNamePlaceholder)}"></label>
    <label><span>${escapeHtml(TAX_FORMS_TEXT.supplierWhtType)}</span><select id="md-s-wht-type"><option value="">${escapeHtml(TAX_FORMS_TEXT.supplierWhtNone)}</option>${WHT_INCOME_TYPES.map(row => `<option value="${row.code}">${escapeHtml(WHT_TEXT.incomeTypes[row.code])}${row.rate ? ` ${row.rate}%` : ''}</option>`).join('')}</select></label>
    <label><span>${escapeHtml(TAX_FORMS_TEXT.supplierVat)}</span><select id="md-s-vat"><option value="">${escapeHtml(TAX_FORMS_TEXT.supplierVatUnknown)}</option><option value="yes">${escapeHtml(TAX_FORMS_TEXT.supplierVatYes)}</option><option value="no">${escapeHtml(TAX_FORMS_TEXT.supplierVatNo)}</option></select></label>
    <label><span>${escapeHtml(TAX_FORMS_TEXT.supplierContractTotal)} · ${escapeHtml(TAX_FORMS_TEXT.supplierContract)}</span><input id="md-s-contract-total" inputmode="decimal" maxlength="16" placeholder="0.00"></label>`);
  $('md-s-branch-kind').addEventListener('change', () => { const code = $('md-s-branch-code'); code.disabled = value('md-s-branch-kind') !== 'branch'; if (code.disabled) code.value = ''; });
  return true;
}
function supplierTaxFromForm() {
  if (!ensureSupplierFields()) return { ok: true, branchCode: '', branchName: '', warnings: [] };
  const kind = value('md-s-branch-kind');
  const parsed = parseSupplierBranchInput(kind, value('md-s-branch-code'));
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const warnings = [];
  const taxId = normalizeTaxIdText(value('md-s-tax'));
  if (taxId && !isThirteenDigitTaxId(taxId)) warnings.push(TAX_FORMS_TEXT.supplierTaxIdLengthWarn(taxId));
  else if (taxId && !taxIdCheckDigitOk(taxId)) warnings.push(TAX_FORMS_TEXT.supplierTaxIdWarn(taxId));
  const name = value('md-s-branch-name').replace(/\s+/g, ' ').slice(0, 80);
  // ADR-024: the payee's usual withholding income type (pre-selects the expense form's 50 ทวิ section).
  const whtIncomeType = WHT_INCOME_TYPES.some(row => row.code === value('md-s-wht-type')) ? value('md-s-wht-type') : '';
  const vatRegistered = ['yes', 'no'].includes(value('md-s-vat')) ? value('md-s-vat') : '';
  const contractTotal = parseMoney(value('md-s-contract-total'));
  return { ok: true, branchCode: parsed.code, branchName: name || (parsed.code === '00000' ? TAX_FORMS_TEXT.headOffice : ''), whtIncomeType, vatRegistered, whtContractTotal: contractTotal > 0 ? Math.round(contractTotal * 100) / 100 : 0, warnings };
}
function setSupplierBranch(row = {}) {
  if (!ensureSupplierFields()) return;
  const code = supplierEstablishmentOf(row);
  $('md-s-branch-kind').value = code === '00000' ? 'hq' : code ? 'branch' : '';
  $('md-s-branch-code').value = code && code !== '00000' ? code : '';
  $('md-s-branch-code').disabled = $('md-s-branch-kind').value !== 'branch';
  $('md-s-branch-name').value = String(row.branchName || '');
  $('md-s-wht-type').value = WHT_INCOME_TYPES.some(type => type.code === row.whtIncomeType) ? row.whtIncomeType : '';
  $('md-s-vat').value = ['yes', 'no'].includes(row.vatRegistered) ? row.vatRegistered : '';
  $('md-s-contract-total').value = Number(row.whtContractTotal) > 0 ? String(row.whtContractTotal) : '';
}
function resetSupplierBranch() {
  if (!ensureSupplierFields()) return;
  $('md-s-branch-kind').value = '';
  $('md-s-branch-code').value = '';
  $('md-s-branch-code').disabled = true;
  $('md-s-branch-name').value = '';
  $('md-s-wht-type').value = '';
  $('md-s-vat').value = '';
  $('md-s-contract-total').value = '';
}

// ---------------------------------------------------------------- 3. invoice VAT category
function ensureInvoiceCategory() {
  if ($('i-vat-category')) return true;
  const anchor = $('i-vat')?.closest('.ff');
  if (!anchor) return false;
  anchor.insertAdjacentHTML('afterend', `<div class="ff" id="i-vat-category-field" hidden><label for="i-vat-category">${escapeHtml(TAX_FORMS_TEXT.invoiceCategory)}</label><select id="i-vat-category" aria-describedby="i-vat-category-help"><option value="exempt">${escapeHtml(TAX_FORMS_TEXT.categoryExempt)}</option><option value="zero">${escapeHtml(TAX_FORMS_TEXT.categoryZero)}</option></select><small class="tax-help" id="i-vat-category-help">${escapeHtml(TAX_FORMS_TEXT.categoryHelp)}</small></div>
    <div class="ff" id="i-export-decl-field" hidden><label for="i-export-decl">${escapeHtml(TAX_FORMS_TEXT.exportDecl)}</label><input id="i-export-decl" maxlength="40"></div>
    <div class="ff ff-full" id="i-tax-point-field"><label class="tax-check"><input type="checkbox" id="i-tax-point"> <span>${escapeHtml(TAX_FORMS_TEXT.taxPoint)}</span></label><small class="tax-help">${escapeHtml(TAX_FORMS_TEXT.taxPointHelp)}</small></div>
    <div class="ff ff-full" id="i-service-period-field"><span class="tax-label">${escapeHtml(TAX_FORMS_TEXT.servicePeriod)}</span><div class="tax-branch-row"><input type="date" id="i-service-from" aria-label="${escapeHtml(TAX_FORMS_TEXT.servicePeriodFrom)}"><input type="date" id="i-service-to" aria-label="${escapeHtml(TAX_FORMS_TEXT.servicePeriodTo)}"></div><small class="tax-help">${escapeHtml(TAX_FORMS_TEXT.servicePeriodHelp)}</small></div>
    <div class="ff ff-full tax-note tax-note-info" id="i-replaces-field" hidden><span id="i-replaces-text"></span> <button type="button" class="btn btn-tertiary btn-sm" id="i-replaces-clear">${escapeHtml(TAX_FORMS_TEXT.replacesClear)}</button><input type="hidden" id="i-replaces-no"><input type="hidden" id="i-replaces-date"><input type="hidden" id="i-replaces-id"></div>`);
  $('i-replaces-clear').addEventListener('click', () => { ['i-replaces-no', 'i-replaces-date', 'i-replaces-id'].forEach(id => { $(id).value = ''; }); refreshInvoiceCategory(); });
  return true;
}
function refreshInvoiceCategory() {
  if (!ensureInvoiceCategory()) return;
  $('i-vat-category-field').hidden = value('i-vat') !== '2';
  $('i-export-decl-field').hidden = value('i-vat') !== '2' || value('i-vat-category') !== 'zero';
  const abbreviated = value('i-tax-form') === 'abbreviated';
  $('i-tax-point-field').hidden = value('i-vat') === '2' || abbreviated;
  if ($('i-tax-point-field').hidden) $('i-tax-point').checked = false;
  const replaces = value('i-replaces-no');
  $('i-replaces-field').hidden = !replaces;
  $('i-replaces-text').textContent = replaces ? TAX_FORMS_TEXT.replaces(replaces, taxThaiDate(value('i-replaces-date'))) : '';
}
// The r13 fields of the invoice being saved (app.js spreads them into the record; the finance planner validates them).
function invoiceTaxFields() {
  if (!ensureInvoiceCategory()) return {};
  const out = {};
  if (!$('i-tax-point-field').hidden && $('i-tax-point').checked) out.taxPoint = 'payment';
  if (!$('i-export-decl-field').hidden && value('i-export-decl')) out.exportDeclarationNo = value('i-export-decl');
  if (value('i-service-from') || value('i-service-to')) Object.assign(out, { servicePeriodFrom: value('i-service-from'), servicePeriodTo: value('i-service-to') });
  if (value('i-replaces-no')) Object.assign(out, { replacesNo: value('i-replaces-no'), replacesDate: value('i-replaces-date'), replacesId: value('i-replaces-id') });
  return out;
}
function setInvoiceTaxFields(invoice = {}) {
  if (!ensureInvoiceCategory()) return;
  $('i-tax-point').checked = invoice?.taxPoint === 'payment';
  $('i-export-decl').value = String(invoice?.exportDeclarationNo || '');
  $('i-service-from').value = String(invoice?.servicePeriodFrom || '');
  $('i-service-to').value = String(invoice?.servicePeriodTo || '');
  $('i-replaces-no').value = String(invoice?.replacesNo || '');
  $('i-replaces-date').value = String(invoice?.replacesDate || '');
  $('i-replaces-id').value = String(invoice?.replacesId || '');
}
function invoiceVatCategory() {
  if (!ensureInvoiceCategory()) return '';
  return value('i-vat') === '2' ? (value('i-vat-category') === 'zero' ? 'zero' : 'exempt') : 'standard';
}
function setInvoiceVatCategory(invoice = {}) {
  if (!ensureInvoiceCategory()) return;
  $('i-vat-category').value = invoice?.vatCategory === 'zero' ? 'zero' : 'exempt';
  setInvoiceTaxFields(invoice);
  refreshInvoiceCategory();
}
function resetInvoiceVatCategory() {
  if (!ensureInvoiceCategory()) return;
  $('i-vat-category').value = 'exempt';
  setInvoiceTaxFields({});
  refreshInvoiceCategory();
}
// r13#MED-3 (ก): "ออกฉบับใหม่แทน" — a NEW invoice from a cancelled one: its lines and buyer, the date = the original tax
// point (changeable), a new number, and replacesNo / replacesDate printed as "ออกแทนใบกำกับภาษีเลขที่ … ลงวันที่ …".
// ป.86/2542 ข้อ 10–11 (cancel and issue a correct new one); ข้อหารือ กค 0702(กม.05)/1041 also allows the old number
// and date — this demo keeps a NEW number (one record per number, ADR-021) and references the original.
function prepareReplacement(branch, year, month, id) {
  const pack = typeof window.loadFor === 'function' ? window.loadFor(branch, Number(year), Number(month)) : {};
  const original = (pack.invoices || []).find(row => String(row.id) === String(id));
  if (!original) { window.notify?.(TAX_FORMS_TEXT.replaceNotFound, 'error'); return false; }
  if (window.ERPIntegrity?.live?.(original)) { window.notify?.(TAX_FORMS_TEXT.replaceLive, 'error'); return false; }
  window.resetF?.('invoice');
  window.selBr?.('i', branch);
  const set = (key, val) => { const el = $(key); if (el) el.value = val ?? ''; };
  set('i-date', original.date); set('i-cust', original.customer); set('i-address', original.customerAddress || original.address || ''); set('i-tax-id', original.customerTaxId || '');
  set('i-contact', original.contact || ''); set('i-phone', original.phone || ''); set('i-email', original.email || ''); set('i-sales', original.salesPerson || ''); set('i-note', original.note || '');
  set('i-credit-term', original.creditTerm || ''); set('i-due-date', original.dueDate || '');
  window.ERPSalesFormAssist?.setBuyerBranch?.('i', original);
  set('i-vat', Number(original.useVat || 0));
  window.ERPSalesFormAssist?.setInvoiceTaxForm?.(original.taxInvoiceForm === 'abbreviated' ? 'abbreviated' : 'full', { restoreVat: false, recalc: false, convertPrices: false });
  const body = $('i-items-body');
  if (body) { body.innerHTML = ''; (original.items || []).forEach(item => window.addIItem?.(item)); }
  window.calcI?.();
  setInvoiceVatCategory({ ...original, replacesNo: original.no, replacesDate: original.date, replacesId: String(original.id), taxPoint: original.taxPoint });
  window.refreshAutoDocumentNumber?.('invoice', true);
  window.go?.('invoice-form');
  window.notify?.(TAX_FORMS_TEXT.replacePrepared(original.no), 'info');
  return true;
}
// r13#MED-6: the tax-invoice figures of a receipt that settles a "tax point at payment" service invoice (null otherwise;
// { pending: true } when it settles nothing more). The same paymentTaxPoints() as the sales report and the journal.
function receiptTaxPoint(receipt = {}, branch = '') {
  const integrity = window.ERPIntegrity;
  if (!integrity?.business || !integrity?.resolveInvoice) return null;
  const invoiceNo = receipt.invNo || receipt.sourceInvoiceNo || receipt.invoiceNo;
  if (!invoiceNo) return null;
  const data = integrity.business();
  const invoiceBranch = receipt.invoiceBranch || receipt.branch || branch;
  const invoice = integrity.resolveInvoice({ branch: invoiceBranch, invoiceId: receipt.invoiceId || receipt.sourceInvoiceId, invoiceNo }, data);
  if (!invoice || !invoiceTaxPointAtPayment(invoice)) return null;
  const receipts = data.receipts.filter(row => !String(row._type || '').startsWith('issued') && String(row.invNo || row.sourceInvoiceNo || row.invoiceNo || '') === String(invoice.no) && (row.invoiceBranch || row.branch) === (invoice.branch || invoiceBranch));
  const point = paymentTaxPoints(invoice, receipts).find(row => (receipt.id && String(row.receipt.id) === String(receipt.id)) || (receipt.no && row.receipt.no === receipt.no));
  return point ? { invoiceNo: invoice.no, invoiceDate: invoice.date, value: point.value, vat: point.vat, total: point.total } : { invoiceNo: invoice.no, invoiceDate: invoice.date, pending: true };
}

// ---------------------------------------------------------------- 5. purchase order / goods receipt VAT (r13#HIGH-2)
const GR_FORM_TEXT = Object.freeze({
  poVat: 'VAT ของผู้ขาย',
  poVatPick: '— เลือก (ผู้ขายจด VAT หรือไม่) —',
  poVatTotal: (vat, total) => `VAT 7% ฿${vat} · รวมที่ต้องจ่ายผู้ขาย ฿${total}`,
  section: 'ใบกำกับภาษีของผู้ขาย (ภาษีซื้อของสินค้าที่รับ)',
  sectionHelp: 'มูลค่าในใบรับสินค้าเป็นยอดก่อน VAT (ต้นทุนสินค้า) — VAT ที่ผู้ขายเรียกเก็บเป็นภาษีซื้อ ใช้สิทธิ์ได้เมื่อได้รับใบกำกับภาษี (มาตรา 82/3) และเข้ารายงานภาษีซื้อ / ภ.พ.30 ของเดือนที่ใช้สิทธิ์',
  mode: 'ผู้ขายเรียกเก็บ VAT หรือไม่',
  status: 'สถานะใบกำกับภาษี',
  no: 'เลขที่ใบกำกับภาษีของผู้ขาย',
  date: 'วันที่ในใบกำกับภาษี',
  received: 'วันที่ได้รับใบกำกับภาษี',
  claim: 'ใช้สิทธิ์ภาษีซื้อในเดือนภาษี',
  vendorTaxId: 'เลขประจำตัวผู้เสียภาษีของผู้ขาย (13 หลัก)',
  vendorBranch: 'สถานประกอบการของผู้ขาย (00000 = สำนักงานใหญ่)',
  preview: (value, vat, total) => `มูลค่าก่อน VAT ฿${value} · VAT ฿${vat} · เจ้าหนี้ผู้ขาย ฿${total}`,
  duplicate: (no, where) => `ใบกำกับภาษีเลขที่ ${no} ของผู้ขายรายนี้ถูกบันทึกแล้ว (${where}) — ใช้สิทธิ์ภาษีซื้อซ้ำไม่ได้`,
  dialogTitle: no => `บันทึกใบกำกับภาษีที่ได้รับ — ${no}`,
  save: 'บันทึกใบกำกับภาษี',
  cancel: 'ยกเลิก',
  saved: (no, period) => `บันทึกใบกำกับภาษีของ ${no} แล้ว — ใช้สิทธิ์ภาษีซื้อเดือน ${period}`,
  saveFailed: message => `บันทึกไม่สำเร็จ: ${message}`,
  reverseClaimed: no => `ใบรับสินค้า ${no} บันทึกใบกำกับภาษีและใช้สิทธิ์ภาษีซื้อแล้ว — กลับรายการไม่ได้ ให้ขอใบลดหนี้จากผู้ขายและปรึกษานักบัญชี`
});
function supplierByName(name) {
  const key = String(name || '').trim();
  return supplierRows().find(row => String(row.name || '').trim() === key) || null;
}
const vatModeFromSupplier = row => (row?.vatRegistered === 'no' ? 'none' : row?.vatRegistered === 'yes' ? 'add' : '');
function ensurePoVat() {
  if ($('po-vat-mode')) return true;
  const anchor = $('po-supplier-tax')?.closest('label');
  if (!anchor) return false;
  anchor.insertAdjacentHTML('afterend', `<label><span>${escapeHtml(GR_FORM_TEXT.poVat)}</span><select id="po-vat-mode"><option value="">${escapeHtml(GR_FORM_TEXT.poVatPick)}</option>${GOODS_RECEIPT_VAT_MODES.map(mode => `<option value="${mode}">${escapeHtml(GR_TAX_TEXT.vatModes[mode])}</option>`).join('')}</select></label>`);
  $('po-total')?.insertAdjacentHTML('afterend', '<small id="po-vat-total" class="tax-help"></small>');
  $('po-supplier')?.addEventListener('change', () => { $('po-vat-mode').value = vatModeFromSupplier(supplierByName(value('po-supplier'))); refreshPoVat(); });
  $('po-vat-mode').addEventListener('change', refreshPoVat);
  $('po-items-body')?.addEventListener('input', refreshPoVat);
  return true;
}
function poSubtotal() {
  return [...document.querySelectorAll('#po-items-body tr')].reduce((sum, tr) => sum + parseMoney(tr.querySelector('[data-f="qty"]')?.value) * parseMoney(tr.querySelector('[data-f="cost"]')?.value), 0);
}
function refreshPoVat() {
  if (!ensurePoVat()) return;
  const mode = value('po-vat-mode'), box = $('po-vat-total');
  if (!box) return;
  const split = mode ? calculateVatSummary(poSubtotal(), mode) : null;
  box.textContent = split && split.vatAmt > 0 ? GR_FORM_TEXT.poVatTotal(fmt(split.vatAmt), fmt(split.total)) : '';
}
// → { vatMode, vatAmt, total } | { error } for savePo().
function poVatFields(subtotal) {
  if (!ensurePoVat()) return {};
  const mode = value('po-vat-mode');
  if (!GOODS_RECEIPT_VAT_MODES.includes(mode)) return { error: GR_TAX_TEXT.errVatMode };
  const split = calculateVatSummary(Math.round(Number(subtotal || 0) * 100) / 100, mode);
  return { vatMode: mode, vatAmt: split.vatAmt, total: split.total };
}
function resetPoVat() { if (ensurePoVat()) { $('po-vat-mode').value = ''; refreshPoVat(); } }
const grLateOptions = () => `<option value="">${escapeHtml(TAX_FORMS_TEXT.lateReasonPick)}</option>${LATE_CLAIM_REASON_CODES.map(code => `<option value="${code}">${escapeHtml(TAX_CORE_TEXT.lateClaimReasons[code])}</option>`).join('')}`;
function grInvoiceFieldsHtml(prefix) {
  return `<label><span>${escapeHtml(GR_FORM_TEXT.no)}</span><input id="${prefix}-no" maxlength="40"></label>
    <label><span>${escapeHtml(GR_FORM_TEXT.date)}</span><input type="date" id="${prefix}-date"></label>
    <label><span>${escapeHtml(GR_FORM_TEXT.received)}</span><input type="date" id="${prefix}-received"></label>
    <label><span>${escapeHtml(GR_FORM_TEXT.claim)}</span><input type="month" id="${prefix}-claim"></label>
    <label><span>${escapeHtml(GR_FORM_TEXT.vendorTaxId)}</span><input id="${prefix}-vendor-tax-id" inputmode="numeric" maxlength="17"></label>
    <label><span>${escapeHtml(GR_FORM_TEXT.vendorBranch)}</span><input id="${prefix}-vendor-branch" inputmode="numeric" maxlength="5" placeholder="00000"></label>
    <label class="prodcore-span-2" id="${prefix}-late-field" hidden><span>${escapeHtml(TAX_FORMS_TEXT.lateReason)}</span><select id="${prefix}-late-reason">${grLateOptions()}</select><input id="${prefix}-late-note" maxlength="200" placeholder="${escapeHtml(TAX_FORMS_TEXT.lateNote)}"></label>`;
}
function ensureGrVat() {
  if ($('gr-vat-section')) return $('gr-vat-section');
  const anchor = $('gr-note')?.closest('.prodcore-form-grid');
  if (!anchor) return null;
  const section = document.createElement('div');
  section.id = 'gr-vat-section';
  section.className = 'tax-exp gr-vat';
  section.innerHTML = `<div class="tax-exp-head"><b>${escapeHtml(GR_FORM_TEXT.section)}</b><small>${escapeHtml(GR_FORM_TEXT.sectionHelp)}</small></div>
  <div class="prodcore-form-grid">
    <label><span>${escapeHtml(GR_FORM_TEXT.mode)}</span><select id="gr-vat-mode"><option value="">${escapeHtml(GR_FORM_TEXT.poVatPick)}</option>${GOODS_RECEIPT_VAT_MODES.map(mode => `<option value="${mode}">${escapeHtml(GR_TAX_TEXT.vatModes[mode])}</option>`).join('')}</select></label>
    <label id="gr-tax-status-field"><span>${escapeHtml(GR_FORM_TEXT.status)}</span><select id="gr-tax-status">${Object.entries(GR_TAX_TEXT.statuses).map(([code, label]) => `<option value="${code}">${escapeHtml(label)}</option>`).join('')}</select></label>
  </div>
  <div class="prodcore-form-grid" id="gr-tax-invoice-fields">${grInvoiceFieldsHtml('gr-tax')}</div>
  <div class="tax-exp-split" id="gr-vat-preview" aria-live="polite"></div>`;
  anchor.after(section);
  section.addEventListener('change', refreshGrVat);
  section.addEventListener('input', refreshGrVat);
  $('gr-items-body')?.addEventListener('input', refreshGrVat);
  return section;
}
function grSubtotal() {
  return [...document.querySelectorAll('#gr-items-body tr')].reduce((sum, tr) => sum + parseMoney(tr.querySelector('[data-f="receive"]')?.value) * parseMoney(tr.dataset.cost), 0);
}
function grDraft(prefix = 'gr-tax') {
  return { vatMode: value('gr-vat-mode'), taxStatus: value('gr-tax-status'), taxInvoiceNo: value(`${prefix}-no`), taxInvoiceDate: value(`${prefix}-date`), taxInvoiceReceivedDate: value(`${prefix}-received`), claimPeriod: value(`${prefix}-claim`), vendorTaxId: normalizeTaxIdText(value(`${prefix}-vendor-tax-id`)), vendorBranchCode: value(`${prefix}-vendor-branch`), lateClaimReason: value(`${prefix}-late-reason`), lateClaimNote: value(`${prefix}-late-note`) };
}
function refreshLate(prefix) {
  const received = taxPeriodOfDate(value(`${prefix}-received`) || value(`${prefix}-date`));
  const late = !!value(`${prefix}-claim`) && !!received && value(`${prefix}-claim`) !== received;
  if ($(`${prefix}-late-field`)) $(`${prefix}-late-field`).hidden = !late;
}
function refreshGrVat() {
  if (!ensureGrVat()) return;
  const mode = value('gr-vat-mode');
  $('gr-tax-status-field').hidden = mode !== 'add';
  $('gr-tax-invoice-fields').hidden = mode !== 'add' || value('gr-tax-status') !== 'received';
  if (!value('gr-tax-date') && value('gr-date')) $('gr-tax-date').value = value('gr-date');
  if (!value('gr-tax-received') && value('gr-tax-date')) $('gr-tax-received').value = value('gr-tax-date');
  if (!value('gr-tax-claim') && value('gr-tax-received')) $('gr-tax-claim').value = taxPeriodOfDate(value('gr-tax-received'));
  refreshLate('gr-tax');
  const box = $('gr-vat-preview');
  const split = mode ? calculateVatSummary(Math.round(grSubtotal() * 100) / 100, mode) : null;
  box.textContent = split ? GR_FORM_TEXT.preview(fmt(split.subtotal), fmt(split.vatAmt), fmt(split.total)) : '';
}
// Loading a PO into the receipt form: its VAT mode (older POs: from Supplier Master) and the supplier's TIN / branch.
function setGoodsReceiptFromPo(po) {
  if (!ensureGrVat()) return;
  const supplier = supplierByName(po?.supplier);
  $('gr-vat-mode').value = GOODS_RECEIPT_VAT_MODES.includes(po?.vatMode) ? po.vatMode : vatModeFromSupplier(supplier);
  $('gr-tax-status').value = 'received';
  ['gr-tax-no', 'gr-tax-date', 'gr-tax-received', 'gr-tax-claim', 'gr-tax-late-note'].forEach(id => { $(id).value = ''; });
  $('gr-tax-late-reason').value = '';
  $('gr-tax-vendor-tax-id').value = normalizeTaxIdText(po?.supplierTaxId || supplier?.taxId || '');
  $('gr-tax-vendor-branch').value = supplierEstablishmentOf(supplier || {}) || '00000';
  refreshGrVat();
}
function resetGoodsReceipt() { if (ensureGrVat()) setGoodsReceiptFromPo(null); }
// The tax-invoice duplicate key against every expense and every other goods receipt (seller TIN + number, §2c rule 6).
function duplicateTaxInvoice(vendorTaxId, taxInvoiceNo, selfId = '') {
  const key = expenseTaxInvoiceKey(vendorTaxId, taxInvoiceNo);
  if (!key) return '';
  const expenses = window.ERPIntegrity?.business?.().expenses || [];
  const expense = expenses.find(row => expenseTaxInvoiceKey(row.vendorTaxId, row.taxInvoiceNo || row.docNo) === key);
  if (expense) return GR_FORM_TEXT.duplicate(taxInvoiceNo, `ค่าใช้จ่าย ${expense.docNo || expense.desc || ''}`);
  const gr = goodsReceiptRows().find(row => String(row.id) !== String(selfId) && !row.reversed && expenseTaxInvoiceKey(row.vendorTaxId, row.taxInvoiceNo) === key);
  return gr ? GR_FORM_TEXT.duplicate(taxInvoiceNo, `ใบรับสินค้า ${gr.no}`) : '';
}
function claimLockRefusal(branch, period) {
  return /^\d{4}-\d{2}$/.test(period || '') ? window.ERPGovernance?.periodLockRefusal?.({ type: 'goods_receipt', scope: 'purchase', branch, date: `${period}-01`, action: 'goods_receipt_claim' }) || '' : '';
}
// postGoodsReceipt(): the VAT fields of the receipt being posted → { ok, fields, warnings } | { ok: false, error }.
function goodsReceiptVatDraft(gr = {}) {
  if (!ensureGrVat()) return { ok: true, fields: null, warnings: [] };
  const plan = planGoodsReceiptVatFields({ ...grDraft('gr-tax'), date: gr.date, subtotal: gr.subtotal, supplier: gr.supplier });
  if (!plan.ok) return plan;
  if (plan.fields.taxStatus === 'received') {
    const duplicate = duplicateTaxInvoice(plan.fields.vendorTaxId, plan.fields.taxInvoiceNo, gr.id);
    if (duplicate) return { ok: false, error: duplicate };
    const lock = claimLockRefusal(gr.branch, plan.fields.claimPeriod);
    if (lock) return { ok: false, error: lock };
    plan.fields.taxInvoiceRecordedAt = new Date().toISOString();
  }
  return plan;
}
// A pending receipt's tax invoice arrived: dialog → validated like the expense invoice → written with an audit row.
function recordGoodsReceiptTaxInvoice(id) {
  const key = window.ERPProductionCore?.KEYS?.goodsReceipts;
  const rows = goodsReceiptRows();
  const gr = rows.find(row => String(row.id) === String(id));
  if (!gr || !key) { window.notify?.(TAX_FORMS_TEXT.replaceNotFound, 'error'); return null; }
  if (gr.vatMode !== 'add' || gr.reversed) { window.notify?.(GR_TAX_TEXT.errNotPending(gr.no), 'error'); return null; }
  if (gr.taxStatus === 'received') { window.notify?.(GR_TAX_TEXT.errAlreadyRecorded(gr.no), 'info'); return null; }
  document.getElementById('gr-tax-dialog')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'gr-tax-dialog';
  overlay.className = 'doc-preview-modal-overlay';
  overlay.innerHTML = `<div class="doc-preview-modal gr-tax-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(GR_FORM_TEXT.dialogTitle(gr.no))}"><div class="doc-preview-modal-head"><div class="doc-preview-modal-title">${escapeHtml(GR_FORM_TEXT.dialogTitle(gr.no))}</div></div>
    <div class="doc-preview-modal-body"><div class="prodcore-form-grid">${grInvoiceFieldsHtml('grd')}</div><div class="tax-exp-split" id="grd-error" role="alert"></div>
    <div class="form-actions"><button type="button" class="btn btn-primary" data-grd="save">${escapeHtml(GR_FORM_TEXT.save)}</button><button type="button" class="btn btn-secondary" data-grd="cancel">${escapeHtml(GR_FORM_TEXT.cancel)}</button></div></div></div>`;
  document.body.appendChild(overlay);
  const supplier = supplierByName(gr.supplier);
  $('grd-vendor-tax-id').value = normalizeTaxIdText(gr.vendorTaxId || supplier?.taxId || '');
  $('grd-vendor-branch').value = gr.vendorBranchCode || supplierEstablishmentOf(supplier || {}) || '00000';
  overlay.addEventListener('input', () => refreshLate('grd'));
  overlay.addEventListener('change', () => { if (!value('grd-received') && value('grd-date')) $('grd-received').value = value('grd-date'); if (!value('grd-claim') && value('grd-received')) $('grd-claim').value = taxPeriodOfDate(value('grd-received')); refreshLate('grd'); });
  overlay.addEventListener('click', event => {
    const action = event.target.closest('[data-grd]')?.dataset.grd;
    if (action === 'cancel' || event.target === overlay) { overlay.remove(); return; }
    if (action !== 'save') return;
    const draft = { ...grDraft('grd'), supplier: gr.supplier };
    const plan = planGoodsReceiptTaxInvoice(draft);
    const fail = message => { $('grd-error').textContent = message; };
    if (!plan.ok) return fail(plan.error);
    const duplicate = duplicateTaxInvoice(plan.fields.vendorTaxId, plan.fields.taxInvoiceNo, gr.id);
    if (duplicate) return fail(duplicate);
    const lock = claimLockRefusal(gr.branch, plan.fields.claimPeriod);
    if (lock) return fail(lock);
    const fresh = goodsReceiptRows();
    const target = fresh.find(row => String(row.id) === String(id));
    if (!target || target.taxStatus === 'received') return fail(GR_TAX_TEXT.errAlreadyRecorded(gr.no));
    Object.assign(target, plan.fields, { taxInvoiceRecordedAt: new Date().toISOString(), updatedAtIso: new Date().toISOString() });
    try {
      const scoped = window.ComformTenant?.storageKey?.(key) || key;
      window.ERPIntegrity.transaction([[scoped, fresh]]);
    } catch (error) { return fail(GR_FORM_TEXT.saveFailed(error?.message || String(error))); }
    try { window.ERPProductionCore?.audit?.('update', 'goods_receipt', gr.no, `บันทึกใบกำกับภาษี ${plan.fields.taxInvoiceNo} · ใช้สิทธิ์ ${taxPeriodShort(plan.fields.claimPeriod)}`, { branch: gr.branch }); } catch (error) { console.warn('[TaxForms] audit', error); }
    window.ERPIntegrity?.changed?.();
    overlay.remove();
    window.notify?.([GR_FORM_TEXT.saved(gr.no, taxPeriodShort(plan.fields.claimPeriod)), ...plan.warnings].join('\n⚠️ '), plan.warnings.length ? 'info' : 'success');
    window.pcRenderGoodsReceipts?.();
  });
  $('grd-no').focus();
  return overlay;
}
function goodsReceiptBadge(gr = {}) {
  if (gr.vatMode !== 'add' || !(Number(gr.vatAmt) > 0)) return gr.vatMode === 'none' ? `<span class="badge b-gray">${escapeHtml(GR_TAX_TEXT.noVatBadge)}</span>` : '';
  return gr.taxStatus === 'received' ? `<span class="badge b-blue">${escapeHtml(GR_TAX_TEXT.claimBadge(taxPeriodShort(gr.claimPeriod)))}</span>` : `<span class="badge b-amber">${escapeHtml(GR_TAX_TEXT.pendingBadge)}</span>`;
}

// ---------------------------------------------------------------- boot
window.ERPTaxForms = Object.freeze({
  expenseDraft, assertClaimPeriodOpen, resetExpense, refreshExpense: refreshExpenseSection,
  taxInvoiceKey: expenseTaxInvoiceKey, expenseBadgeHtml, expenseDetailRows,
  supplierTaxFromForm, setSupplierBranch, resetSupplierBranch,
  invoiceVatCategory, setInvoiceVatCategory, resetInvoiceVatCategory, invoiceTaxFields, prepareReplacement, receiptTaxPoint,
  poVatFields, resetPoVat, setGoodsReceiptFromPo, resetGoodsReceipt, goodsReceiptVatDraft, recordGoodsReceiptTaxInvoice, goodsReceiptBadge, GR_TEXT: GR_FORM_TEXT,
  TEXT: TAX_FORMS_TEXT
});
function boot() {
  ensurePoVat();
  ensureGrVat();
  ensureExpenseSection();
  ensureSupplierFields();
  ensureInvoiceCategory();
  fillSupplierOptions();
  syncDefaults();
  refreshExpenseSection();
  refreshInvoiceCategory();
  const expensePanel = $('panel-expense-form');
  expensePanel?.addEventListener('change', onExpenseFormChange);
  expensePanel?.addEventListener('input', onExpenseFormChange);
  const invoicePanel = $('panel-invoice-form');
  invoicePanel?.addEventListener('change', refreshInvoiceCategory);
  invoicePanel?.addEventListener('click', () => setTimeout(refreshInvoiceCategory, 0));
  document.addEventListener('erp:navigation', event => {
    if (event.detail?.id === 'expense-form') { fillSupplierOptions(); syncDefaults(); refreshExpenseSection(); }
    if (event.detail?.id === 'invoice-form') refreshInvoiceCategory();
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
