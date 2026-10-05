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
// 3. Invoice form › for "ไม่มี VAT": ยกเว้น VAT or อัตราร้อยละ 0 (vatCategory, G4).
// Every control is created here (texts in TAX_FORMS_TEXT); app.js only calls window.ERPTaxForms.
// ============================================================================
import { escapeHtml, fmt, calculateVatSummary, parseMoney } from './erp-shared-core.js';
import { TAX_CORE_TEXT, EXPENSE_TAX_INVOICE_DOC_TYPES, NON_CLAIMABLE_REASON_CODES, PURCHASE_VAT_MODES, parseSupplierBranchInput, supplierEstablishmentOf, expenseTaxInvoiceKey, expenseHasVatData, expenseVatIncomplete, normalizeTaxIdText, isThirteenDigitTaxId, taxIdCheckDigitOk, taxPeriodOfDate, parseTaxPeriod, taxPeriodShort, taxThaiDate } from './erp-tax-reports-core.js';

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
  select.innerHTML = `<option value="">${escapeHtml(TAX_FORMS_TEXT.supplierNone)}</option>${supplierRows().map(row => `<option value="${escapeHtml(String(row.id))}">${escapeHtml(row.name || '-')}${row.taxId ? ` · ${escapeHtml(normalizeTaxIdText(row.taxId))}` : ''}</option>`).join('')}`;
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
  if (!taxInvoiceInHand()) return {};
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
    nonClaimableReason: claimable ? '' : value('e-tax-reason')
  };
}
// A claim month that is already closed (ERPGovernance period lock, scope ซื้อ/ภาษีซื้อ) refuses the save.
function assertClaimPeriodOpen(branch, draft = {}) {
  if (!draft.vatMode || draft.vatMode === 'none' || draft.inputVatClaimable !== true) return;
  const period = draft.claimPeriod || taxPeriodOfDate(draft.taxInvoiceReceivedDate || draft.taxInvoiceDate);
  if (!parseTaxPeriod(period)) return; // the planner reports the missing month
  window.ERPGovernance?.assertPeriodOpen?.({ branch, date: `${period}-01`, scope: 'purchase', action: 'expense_claim' });
}
function resetExpense() {
  Object.assign(state, { claimTouched: false, receivedTouched: false, invoiceDateTouched: false });
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
  if (expenseVatIncomplete(expense)) return `<span class="tax-badge tax-badge-warn" title="${escapeHtml(TAX_CORE_TEXT.incompleteHint)}">${escapeHtml(TAX_FORMS_TEXT.badgeIncomplete)}</span>`;
  if (!expenseHasVatData(expense) || !(Number(expense.vatAmt) > 0)) return '';
  if (expense.inputVatClaimable === true) return `<span class="tax-badge tax-badge-ok">${escapeHtml(TAX_FORMS_TEXT.badgeClaim(taxPeriodShort(expense.claimPeriod)))}</span>`;
  return `<span class="tax-badge tax-badge-bad" title="${escapeHtml(TAX_CORE_TEXT.nonClaimable[expense.nonClaimableReason] || '')}">${escapeHtml(TAX_FORMS_TEXT.badgeForbidden)}</span>`;
}
function expenseDetailRows(doc = {}, dr, html) {
  if (typeof dr !== 'function') return '';
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
    + dr(TAX_FORMS_TEXT.detailClaim, typeof html === 'function' ? html(expenseBadgeHtml(doc) || escapeHtml(claim)) : claim);
}

// ---------------------------------------------------------------- 2. Supplier Master establishment
function ensureSupplierFields() {
  if ($('md-s-branch-kind')) return true;
  const taxLabel = $('md-s-tax')?.closest('label');
  if (!taxLabel) return false;
  taxLabel.insertAdjacentHTML('afterend', `<label><span>${escapeHtml(TAX_FORMS_TEXT.supplierBranchKind)}</span><select id="md-s-branch-kind"><option value="">${escapeHtml(TAX_FORMS_TEXT.supplierBranchUnset)}</option><option value="hq">${escapeHtml(TAX_FORMS_TEXT.headOffice)}</option><option value="branch">${escapeHtml(TAX_FORMS_TEXT.branchNo)}</option></select></label>
    <label><span>${escapeHtml(TAX_FORMS_TEXT.supplierBranchCode)}</span><input id="md-s-branch-code" inputmode="numeric" maxlength="5" placeholder="${escapeHtml(TAX_FORMS_TEXT.branchCodePlaceholder)}" disabled></label>
    <label><span>${escapeHtml(TAX_FORMS_TEXT.supplierBranchName)}</span><input id="md-s-branch-name" maxlength="80" placeholder="${escapeHtml(TAX_FORMS_TEXT.supplierBranchNamePlaceholder)}"></label>`);
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
  return { ok: true, branchCode: parsed.code, branchName: name || (parsed.code === '00000' ? TAX_FORMS_TEXT.headOffice : ''), warnings };
}
function setSupplierBranch(row = {}) {
  if (!ensureSupplierFields()) return;
  const code = supplierEstablishmentOf(row);
  $('md-s-branch-kind').value = code === '00000' ? 'hq' : code ? 'branch' : '';
  $('md-s-branch-code').value = code && code !== '00000' ? code : '';
  $('md-s-branch-code').disabled = $('md-s-branch-kind').value !== 'branch';
  $('md-s-branch-name').value = String(row.branchName || '');
}
function resetSupplierBranch() {
  if (!ensureSupplierFields()) return;
  $('md-s-branch-kind').value = '';
  $('md-s-branch-code').value = '';
  $('md-s-branch-code').disabled = true;
  $('md-s-branch-name').value = '';
}

// ---------------------------------------------------------------- 3. invoice VAT category
function ensureInvoiceCategory() {
  if ($('i-vat-category')) return true;
  const anchor = $('i-vat')?.closest('.ff');
  if (!anchor) return false;
  anchor.insertAdjacentHTML('afterend', `<div class="ff" id="i-vat-category-field" hidden><label for="i-vat-category">${escapeHtml(TAX_FORMS_TEXT.invoiceCategory)}</label><select id="i-vat-category" aria-describedby="i-vat-category-help"><option value="exempt">${escapeHtml(TAX_FORMS_TEXT.categoryExempt)}</option><option value="zero">${escapeHtml(TAX_FORMS_TEXT.categoryZero)}</option></select><small class="tax-help" id="i-vat-category-help">${escapeHtml(TAX_FORMS_TEXT.categoryHelp)}</small></div>`);
  return true;
}
function refreshInvoiceCategory() {
  if (!ensureInvoiceCategory()) return;
  $('i-vat-category-field').hidden = value('i-vat') !== '2';
}
function invoiceVatCategory() {
  if (!ensureInvoiceCategory()) return '';
  return value('i-vat') === '2' ? (value('i-vat-category') === 'zero' ? 'zero' : 'exempt') : 'standard';
}
function setInvoiceVatCategory(invoice = {}) {
  if (!ensureInvoiceCategory()) return;
  $('i-vat-category').value = invoice?.vatCategory === 'zero' ? 'zero' : 'exempt';
  refreshInvoiceCategory();
}
function resetInvoiceVatCategory() {
  if (!ensureInvoiceCategory()) return;
  $('i-vat-category').value = 'exempt';
  refreshInvoiceCategory();
}

// ---------------------------------------------------------------- boot
window.ERPTaxForms = Object.freeze({
  expenseDraft, assertClaimPeriodOpen, resetExpense, refreshExpense: refreshExpenseSection,
  taxInvoiceKey: expenseTaxInvoiceKey, expenseBadgeHtml, expenseDetailRows,
  supplierTaxFromForm, setSupplierBranch, resetSupplierBranch,
  invoiceVatCategory, setInvoiceVatCategory, resetInvoiceVatCategory,
  TEXT: TAX_FORMS_TEXT
});
function boot() {
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
