// ============================================================================
// erp-payer-wht.js — payer-side withholding tax (ADR-024, round 8 stage D)
// ERP DEMO 4.3.1
// ----------------------------------------------------------------------------
// 1. Expense form › "หักภาษี ณ ที่จ่าย (50 ทวิ)": payee type (ภ.ง.ด.3 / 53), income type, rate, payer condition,
//    base (= the pre-VAT amount unless typed), the 1,000-baht rule with its override, the payee's TIN / branch /
//    address (Supplier Master autofill) and a live preview. erp-tax-forms.js adds expenseDraft() to the draft it
//    already returns; erp-document-finance-core.js plans the fields with planExpenseWhtFields() (pure core).
// 2. The 50 ทวิ certificate: created in the SAME write session as the expense (app.js commit hook calls
//    attachCertificate), numbered เล่มที่ (พ.ศ. year) / เลขที่ per payer establishment, stored in the
//    `whtCertificates` collection of the payment month's pack. Printed as ฉบับที่ 1 + ฉบับที่ 2 (every value
//    escaped). Cancel-not-delete: a reason, the number kept, an audit row; refused before any question when
//    the period is closed or a ภ.ง.ด. filing of that month lists it.
// 3. ภ.ง.ด.3 / ภ.ง.ด.53 data + filings (comform_wht_filings_v1, append-only snapshots like vatReturns) for the
//    "รายงานภาษี" page (erp-tax-reports.js draws the tabs), JSON-backup hooks and the post-import ledger check.
// 4. Expense delete guard (app.js delDoc asks deleteRefusal BEFORE its confirmation): a claim month that is
//    locked or whose ภ.พ.30 is filed, or a live 50 ทวิ, refuses the delete (D3 item 1).
// WHT that customers deduct from US (receipts, erp-shared-core calculateWhtSummary) is a different thing and is
// never added to any figure here. Every text is in WHT_UI_TEXT.
// ============================================================================
import { escapeHtml, fmt, parseMoney, localDateISO, calculateVatSummary } from './erp-shared-core.js';
import { WHT_TEXT, WHT_INCOME_TYPES, WHT_RATE_CHOICES, WHT_THRESHOLD_BAHT, WHT_VAT_BASES, whtPreVatOf, whtPaymentDateOf, planExpenseWhtFields, whtIncomeType, whtPayeeEntityOf, whtFormOf, isWhtCertificateLive, whtCertificateBookOf, nextWhtCertificateNumber, whtCertificateDisplayNo, buildWhtCertificate, applyWhtCertificateVoid, whtCertificateLedgerIssues, buildWhtFormReport, whtCertificateSequence, whtDueDates, parseWhtFilingsStore, normalizeWhtFilingsStore, mergeWhtFilingsStores, buildWhtFilingSnapshot, whtFilingsFor, latestWhtFiling } from './erp-payer-wht-core.js';
import { normalizeTaxIdText, isThirteenDigitTaxId, taxIdCheckDigitOk, supplierEstablishmentOf, parseTaxPeriod, taxPeriodOfDate, taxPeriodShort, taxPeriodLastDay, taxThaiDate, parseVatReturnsStore, companyTaxIdNotice, EXPENSE_TAX_INVOICE_DOC_TYPES } from './erp-tax-reports-core.js';
import { runDocumentAction, documentActionFeedback, FinanceActionError, FINANCE_ACTION_ERROR_CODES } from './erp-document-finance-core.js';
import { WHT_FILINGS_KEY, VAT_RETURNS_KEY } from './erp-storage-contracts.js';
import { savedProfileOf, liveBranchCode, liveBranchLabel } from './erp-branches-core.js';
import { withDemoWriteLease } from './erp-demo-concurrency.js';
import { icon } from './erp-icons.js';
import { trapDialog } from './erp-ui-menu.js';

const WHT_UI_TEXT = Object.freeze({
  sectionToggle: 'หักภาษี ณ ที่จ่ายจากผู้รับเงิน (ออกหนังสือรับรอง 50 ทวิ)',
  sectionHelp: 'ใช้เมื่อจ่ายค่าบริการ ค่าจ้างทำของ ค่าเช่า ค่าโฆษณา ค่าขนส่ง ฯลฯ ตั้งแต่ 1,000 บาทขึ้นไป (นับยอดทั้งสัญญา) — วันที่จ่ายเงินกำหนดเดือนของ ภ.ง.ด. และวันที่บน 50 ทวิ · นี่คือภาษีที่ "เราหักจากผู้ขาย" ไม่ใช่ภาษีที่ลูกค้าหักเรา',
  paidDate: 'วันที่จ่ายเงินจริง (หัก ณ ที่จ่ายเมื่อจ่าย)',
  paidDateHelp: 'เว้นว่าง = วันที่ของค่าใช้จ่ายนี้ · ถ้าบันทึกใบแจ้งหนี้ก่อนแล้วจ่ายวันอื่น ให้ใส่วันจ่ายจริง (ภ.ง.ด. ยื่นตามเดือนที่จ่าย)',
  contract: 'จ่ายตามสัญญา (ค่าเช่ารายเดือน / ผ่อนจ่าย / งวดงาน)',
  contractTotal: 'ยอดเงินทั้งสัญญา (บาท ก่อน VAT)',
  contractRef: 'เลขที่ / ชื่อสัญญา (ถ้ามี)',
  contractHelp: 'เกณฑ์ 1,000 บาทใช้กับยอดตามสัญญา ไม่ใช่ยอดแต่ละครั้ง — สัญญาตั้งแต่ 1,000 บาทขึ้นไปต้องหักทุกงวดแม้งวดนั้นต่ำกว่า 1,000 บาท',
  supplierPick: 'เลือกผู้รับเงินจากทะเบียนผู้จำหน่าย',
  supplierNone: '— ไม่เลือก (กรอกเอง) —',
  entity: 'ผู้ถูกหักภาษีเป็น',
  entityPick: '— เลือก —',
  incomeType: 'ประเภทเงินได้',
  rate: 'อัตราภาษี (%)',
  ratePick: '— เลือกอัตรา —',
  rateFixed: rate => `${rate}% ตามคำสั่ง ท.ป.4/2528`,
  incomeText: 'ระบุประเภทเงินได้',
  incomeTextPlaceholder: 'เช่น ค่านายหน้าขายสินค้า',
  condition: 'เงื่อนไขการหักภาษี (ผู้จ่ายเงิน)',
  conditionUnsupported: '(ยังไม่รองรับ)',
  vatBasis: 'ยอดค่าใช้จ่ายนี้รวม VAT แล้วหรือไม่ (ยังไม่มีใบกำกับภาษี)',
  vatBasisHelp: 'ภาษีหัก ณ ที่จ่ายคิดจากยอดก่อน VAT เสมอ — ถ้ายอดรวม VAT ระบบถอด VAT ออกให้ (ยอด × 100 ÷ (100 + อัตรา VAT))',
  base: 'ยอดเงินได้ก่อน VAT ที่ใช้คำนวณ (บาท)',
  basePlaceholder: amount => `เว้นว่าง = ${amount}`,
  baseHelp: 'เว้นว่างให้ใช้ยอดก่อน VAT ของค่าใช้จ่ายนี้ — กรอกเองเมื่อหักเพียงบางส่วนของบิล (เช่น บิลที่มีค่าสินค้าปนค่าบริการ)',
  belowOverride: 'หักแม้ยอดต่ำกว่า 1,000 บาท',
  payeeName: 'ชื่อผู้ถูกหักภาษี',
  payeeTaxId: 'เลขประจำตัวผู้เสียภาษีผู้ถูกหัก (13 หลัก)',
  payeeBranch: 'สาขาของผู้ถูกหัก (นิติบุคคล)',
  payeeBranchPlaceholder: '00000 = สำนักงานใหญ่',
  payeeAddress: 'ที่อยู่ผู้ถูกหักภาษี (พิมพ์บนหนังสือรับรอง)',
  taxIdLength: 'ต้องเป็นตัวเลข 13 หลัก',
  taxIdOk: 'เลขตรวจสอบถูกต้อง',
  taxIdBad: 'หลักสุดท้ายไม่ตรงกับเลขตรวจสอบ — ตรวจอีกครั้ง (บันทึกได้)',
  previewTitle: 'ระบบคำนวณ',
  previewBase: 'เงินได้ที่จ่าย',
  previewTax: 'ภาษีหัก ณ ที่จ่าย',
  previewNet: 'จ่ายผู้รับเงินสุทธิ',
  previewForm: 'ยื่นในแบบ',
  previewDue: (paper, efiling) => `ยื่นภายใน ${paper} (กระดาษ) / ${efiling} (อินเทอร์เน็ต)`,
  previewNeedsAmount: 'กรอกจำนวนเงินด้านบนเพื่อดูยอดหัก ณ ที่จ่าย',
  // list badge / detail
  badge: (rate, amount, form) => `หัก ณ ที่จ่าย ${rate}% ฿${amount} · ${form}`,
  badgeVoided: '50 ทวิ ยกเลิกแล้ว',
  detailWht: 'หัก ณ ที่จ่าย (ผู้จ่ายเงิน)',
  detailWhtValue: (label, rate, base, tax, condition) => `${label} ${rate}% ของ ฿${base} = ฿${tax} · ${condition}`,
  detailPayee: 'ผู้ถูกหักภาษี',
  detailNet: 'จ่ายผู้รับเงินสุทธิ',
  detailCert: 'หนังสือรับรอง 50 ทวิ',
  detailCertVoided: no => `${no} — ยกเลิกแล้ว`,
  // certificate screen / print
  previewDialog: 'หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ)',
  tabCopy1: 'ฉบับที่ 1',
  tabCopy2: 'ฉบับที่ 2',
  printThis: 'พิมพ์ฉบับนี้',
  printBoth: 'พิมพ์ฉบับที่ 1 + 2',
  close: 'ปิด',
  voidStamp: 'ยกเลิก',
  sampleNotice: 'ตัวอย่างสาธิต — ข้อมูลผู้จ่ายเงินยังเป็นข้อมูลบริษัทตัวอย่าง (เลขประจำตัว 0000000000000) แก้ที่ ตั้งค่า › ตั้งค่าบริษัท ก่อนใช้จริง',
  invalidNotice: 'เลขประจำตัวผู้เสียภาษีของผู้จ่ายเงินไม่ถูกต้อง — แก้ที่ ตั้งค่า › ตั้งค่าบริษัท',
  issuedNote: (no, branch) => `${no} · ${branch}`,
  printedFrom: date => `พิมพ์จาก ERP DEMO (ข้อมูลในเครื่องนี้) เมื่อ ${date}`,
  // messages
  certNotFound: 'ไม่พบหนังสือรับรอง 50 ทวิ ของรายการนี้',
  expenseNotFound: 'ไม่พบรายการค่าใช้จ่ายนี้',
  popupBlocked: 'เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต Pop-up สำหรับเว็บไซต์นี้',
  voidPrompt: no => `ยกเลิกหนังสือรับรอง 50 ทวิ ${no}? เอกสารจะถูกเก็บไว้พร้อมสถานะ “ยกเลิก” (ไม่ลบเลขที่) และไม่อยู่ใน ภ.ง.ด. อีก\nกรุณาระบุเหตุผล:`,
  voidReason: 'กรุณาระบุเหตุผลการยกเลิกหนังสือรับรอง',
  voidAlready: 'หนังสือรับรองนี้ถูกยกเลิกไปแล้ว',
  voidFiled: (no, form, period) => `ยกเลิกหนังสือรับรอง ${no} ไม่ได้ — อยู่ใน ${form} เดือน ${period} ที่บันทึกว่ายื่นแล้ว (ตัวเลขในแบบที่ยื่นต้องตรงกับเอกสาร) ถ้าต้องแก้ ให้ยื่นเพิ่มเติมตามขั้นตอนของกรมสรรพากรร่วมกับผู้ทำบัญชี`,
  voided: no => `ยกเลิกหนังสือรับรอง ${no} แล้ว — ไม่อยู่ใน ภ.ง.ด. อีก (ค่าใช้จ่ายยังอยู่: ถ้าข้อมูลผิด ให้ลบรายการแล้วบันทึกใหม่)`,
  voidFailed: 'ยังยกเลิกหนังสือรับรองไม่ได้ กรุณาลองใหม่',
  auditCreate: (no, form, tax, payee) => `ออกหนังสือรับรอง 50 ทวิ ${no} · ${form} · ภาษี ${fmt(tax)} บาท · ${payee}`,
  auditVoid: reason => `ยกเลิกหนังสือรับรอง 50 ทวิ (เก็บเลขที่ไว้) · เหตุผล: ${reason}`,
  deleteLiveCert: no => `ค่าใช้จ่ายนี้มีหนังสือรับรองการหักภาษี ณ ที่จ่าย ${no} ที่ยังใช้งาน — ยกเลิกหนังสือรับรองก่อน (เมนู ⋯ › ยกเลิก 50 ทวิ) แล้วจึงลบรายการ`,
  deleteVatFiled: (period, branch) => `ลบไม่ได้ — ค่าใช้จ่ายนี้ใช้สิทธิ์ภาษีซื้อในเดือน ${period} และ ภ.พ.30 เดือนนั้นของ ${branch} บันทึกว่ายื่นแล้ว (ตัวเลขในแบบที่ยื่นต้องตรงกับเอกสาร) — ถ้าต้องแก้ ให้ปรึกษาผู้ทำบัญชีเรื่องการยื่นเพิ่มเติม`,
  deleteVatUnreadable: 'ลบไม่ได้ — อ่านข้อมูล ภ.พ.30 ที่บันทึกไว้ไม่ได้ จึงตรวจไม่ได้ว่าเดือนที่ใช้สิทธิ์ยื่นแล้วหรือยัง (กู้ข้อมูลจาก Backup ก่อน)',
  // filing (ภ.ง.ด.3 / 53)
  filingConfirm: (label, form, period, branch, count, paid, tax) => `${label} ${form} เดือน ${period}\n${branch}\n${count} ราย · เงินได้ที่จ่าย ${paid} บาท · ภาษีที่หักนำส่ง ${tax} บาท\n\nบันทึกไว้เป็นหลักฐานในระบบ (ไม่แก้ไขย้อนหลัง — ถ้าต้องแก้ ให้ยื่นเพิ่มเติม)\nเดโมนี้ไม่ได้ส่งข้อมูลไปกรมสรรพากร\n\nยืนยันหรือไม่?`,
  filingNormal: 'ยื่นปกติ',
  filingAmendment: n => `ยื่นเพิ่มเติมครั้งที่ ${n}`,
  filedOk: (label, form, period) => `บันทึกแล้ว: ${label} ${form} ${period}`,
  filingFailed: message => `บันทึกการยื่นไม่สำเร็จ: ${message}`,
  filingsUnreadable: 'ข้อมูลการยื่น ภ.ง.ด.3/53 ที่บันทึกไว้อ่านไม่ได้ — ยังบันทึกการยื่นเพิ่มไม่ได้จนกว่าจะกู้ข้อมูลจาก Backup',
  periodNotEnded: 'เดือนนี้ยังไม่สิ้นสุด — บันทึกการยื่นได้ตั้งแต่วันที่ 1 ของเดือนถัดไป',
  auditFiling: (label, form, branch, tax) => `${label} ${form} · ${branch} · ภาษี ${fmt(tax)} บาท`,
  offerLock: (period, date) => `ปิดงวดฝั่งซื้อ (ค่าใช้จ่าย / 50 ทวิ) เดือน ${period} ด้วยหรือไม่?\n\nค่าใช้จ่ายและหนังสือรับรองที่ลงวันที่ถึง ${date} จะเพิ่ม/ลบ/ยกเลิกไม่ได้ จนกว่าจะปลดล็อกพร้อมเหตุผล (ศูนย์ควบคุม › Period Lock)`,
  lockReason: (form, period, label) => `ยื่น ${form} เดือน ${period} แล้ว (${label})`,
  lockedOk: period => `ปิดงวดฝั่งซื้อเดือน ${period} แล้ว`,
  lockFailed: message => `บันทึกการยื่นแล้ว แต่ปิดงวดไม่สำเร็จ: ${message}`
});

const T = WHT_UI_TEXT;
const esc = escapeHtml;
const $ = id => document.getElementById(id);
const value = id => String($(id)?.value ?? '').trim();
const storageKey = base => window.ComformTenant?.storageKey?.(base) || base;
const say = (message, type = 'info', ms) => (typeof window.notify === 'function' ? window.notify(message, type, ms) : console.info('[PayerWHT]', message));
const ALL_MONTHS = Array.from({ length: 12 }, (_, index) => index);
const touched = new Set(); // WHT payee fields the user typed (autofill never overwrites them)
let payeeVat = ''; // r13#MED-1: the chosen payee's VAT registration from Supplier Master ('yes' | 'no' | '')
const actorLabel = () => String(window.ComformAuth?.getCurrentProfile?.()?.email || window.CurrentUser?.email || window.CurrentUser?.displayName || 'Local user');
const branchName = branch => liveBranchLabel(branch, undefined, window);

// ---------------------------------------------------------------- payer (our company)
function payerInfo(branch) {
  const user = window.CurrentUser || {};
  const saved = savedProfileOf(user);
  const profile = user.companyProfile || {};
  const branchProfile = saved?.branches?.[branch] || profile.branches?.[branch] || {};
  const name = String(saved?.nameTh || profile.nameTh || profile.companyNameTh || user.companyName || '').trim();
  const address = String(branchProfile.addressTh || saved?.addressTh || profile.addressTh || '').trim();
  const taxId = normalizeTaxIdText(saved?.taxId || profile.taxId || '');
  return { name, address, taxId, branchCode: liveBranchCode(branch, window), notice: companyTaxIdNotice(taxId, !!saved) };
}

// ---------------------------------------------------------------- Supplier Master
function supplierRows() {
  const rows = typeof window.contactMasterRows === 'function' ? window.contactMasterRows() : [];
  return (Array.isArray(rows) ? rows : []).filter(row => row && row.active !== false && ['supplier', 'both'].includes(row.role));
}

// ---------------------------------------------------------------- 1. expense form section
function sectionHtml() {
  const types = WHT_INCOME_TYPES.map(row => `<option value="${row.code}">${esc(WHT_TEXT.incomeTypes[row.code])}${row.rate ? ` (${row.rate}%)` : ''}</option>`).join('');
  const conditions = [1, 2, 3, 4].map(code => `<option value="${code}"${code === 4 ? ' disabled' : ''}>(${code}) ${esc(WHT_TEXT.conditions[code])}${code === 4 ? ` ${esc(T.conditionUnsupported)}` : ''}</option>`).join('');
  return `<label class="tax-check wht-toggle"><input type="checkbox" id="e-wht-enabled"> <span><b>${esc(T.sectionToggle)}</b></span></label>
  <small class="tax-help">${esc(T.sectionHelp)}</small>
  <div class="tax-exp-grid" id="e-wht-grid" hidden>
    <div class="ff tax-exp-wide"><label for="e-wht-supplier">${esc(T.supplierPick)}</label><select id="e-wht-supplier"></select></div>
    <div class="ff"><label for="e-wht-entity">${esc(T.entity)}</label><select id="e-wht-entity"><option value="">${esc(T.entityPick)}</option><option value="company">${esc(WHT_TEXT.entityTypes.company)}</option><option value="person">${esc(WHT_TEXT.entityTypes.person)}</option></select></div>
    <div class="ff"><label for="e-wht-type">${esc(T.incomeType)}</label><select id="e-wht-type">${types}</select></div>
    <div class="ff"><label for="e-wht-rate">${esc(T.rate)}</label><select id="e-wht-rate"></select></div>
    <div class="ff" id="e-wht-income-text-field" hidden><label for="e-wht-income-text">${esc(T.incomeText)}</label><input id="e-wht-income-text" maxlength="80" placeholder="${esc(T.incomeTextPlaceholder)}"></div>
    <div class="ff"><label for="e-wht-condition">${esc(T.condition)}</label><select id="e-wht-condition">${conditions}</select></div>
    <div class="ff" id="e-wht-vat-basis-field"><label for="e-wht-vat-basis">${esc(T.vatBasis)}</label><select id="e-wht-vat-basis" aria-describedby="e-wht-vat-basis-help"><option value="">${esc(WHT_TEXT.vatBasisPick)}</option>${WHT_VAT_BASES.map(code => `<option value="${code}">${esc(WHT_TEXT.vatBases[code])}</option>`).join('')}</select><small class="tax-help" id="e-wht-vat-basis-help">${esc(T.vatBasisHelp)}</small></div>
    <div class="ff"><label for="e-wht-paid-date">${esc(T.paidDate)}</label><input type="date" id="e-wht-paid-date" aria-describedby="e-wht-paid-date-help"><small class="tax-help" id="e-wht-paid-date-help">${esc(T.paidDateHelp)}</small></div>
    <div class="ff tax-exp-wide"><label class="tax-check"><input type="checkbox" id="e-wht-contract"> <span>${esc(T.contract)}</span></label><small class="tax-help">${esc(T.contractHelp)}</small></div>
    <div class="ff" id="e-wht-contract-total-field" hidden><label for="e-wht-contract-total">${esc(T.contractTotal)}</label><input id="e-wht-contract-total" inputmode="decimal" maxlength="16"></div>
    <div class="ff" id="e-wht-contract-ref-field" hidden><label for="e-wht-contract-ref">${esc(T.contractRef)}</label><input id="e-wht-contract-ref" maxlength="80"></div>
    <div class="ff"><label for="e-wht-base">${esc(T.base)}</label><input id="e-wht-base" inputmode="decimal" aria-describedby="e-wht-base-help"><small class="tax-help" id="e-wht-base-help">${esc(T.baseHelp)}</small></div>
    <div class="ff tax-exp-wide"><label class="tax-check"><input type="checkbox" id="e-wht-below-override"> <span>${esc(T.belowOverride)}</span></label></div>
    <div class="ff"><label for="e-wht-payee-name">${esc(T.payeeName)}</label><input id="e-wht-payee-name" maxlength="200"></div>
    <div class="ff"><label for="e-wht-payee-tax-id">${esc(T.payeeTaxId)}</label><input id="e-wht-payee-tax-id" inputmode="numeric" maxlength="17" placeholder="0000000000000" aria-describedby="e-wht-payee-tax-id-hint"><small class="tax-help" id="e-wht-payee-tax-id-hint" aria-live="polite"></small></div>
    <div class="ff" id="e-wht-payee-branch-field"><label for="e-wht-payee-branch">${esc(T.payeeBranch)}</label><input id="e-wht-payee-branch" inputmode="numeric" maxlength="5" placeholder="${esc(T.payeeBranchPlaceholder)}"></div>
    <div class="ff tax-exp-wide"><label for="e-wht-payee-address">${esc(T.payeeAddress)}</label><input id="e-wht-payee-address" maxlength="300"></div>
    <div class="tax-exp-split tax-exp-wide" id="e-wht-preview" aria-live="polite"></div>
  </div>`;
}
function ensureSection() {
  if ($('e-wht-section')) return $('e-wht-section');
  const after = $('e-tax-section') || $('e-purpose')?.closest('.ff');
  if (!after) return null;
  const section = document.createElement('div');
  section.id = 'e-wht-section';
  section.className = 'ff-full tax-exp wht-exp';
  section.innerHTML = sectionHtml();
  after.after(section);
  section.addEventListener('change', onSectionEvent);
  section.addEventListener('input', onSectionEvent);
  section.addEventListener('focusin', event => { if (event.target?.id === 'e-wht-supplier') fillSupplierOptions(); });
  fillRateOptions();
  return section;
}
function fillSupplierOptions() {
  const select = $('e-wht-supplier');
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">${esc(T.supplierNone)}</option>${supplierRows().map(row => `<option value="${esc(String(row.id))}" data-no-i18n>${esc(row.name || '-')}${row.taxId ? ` · ${esc(normalizeTaxIdText(row.taxId))}` : ''}</option>`).join('')}`;
  select.value = [...select.options].some(option => option.value === current) ? current : '';
}
function fillRateOptions() {
  const select = $('e-wht-rate');
  if (!select) return;
  const type = whtIncomeType(value('e-wht-type')) || WHT_INCOME_TYPES[0];
  const current = select.value;
  if (type.rate) { select.innerHTML = `<option value="${type.rate}">${esc(T.rateFixed(type.rate))}</option>`; select.disabled = true; return; }
  select.disabled = false;
  select.innerHTML = `<option value="">${esc(T.ratePick)}</option>${WHT_RATE_CHOICES.map(rate => `<option value="${rate}">${rate}%</option>`).join('')}`;
  select.value = [...select.options].some(option => option.value === current) ? current : '';
}
const setIfUntouched = (id, next) => { const el = $(id); if (el && !touched.has(id) && next !== undefined && next !== null) el.value = String(next); };
// Fills the payee from a Supplier Master row (fields the user typed are kept).
function applySupplier(row) {
  if (!row) return;
  payeeVat = ['yes', 'no'].includes(row.vatRegistered) ? row.vatRegistered : '';
  if (Number(row.whtContractTotal) > 0 && !touched.has('e-wht-contract')) { $('e-wht-contract').checked = true; setIfUntouched('e-wht-contract-total', String(row.whtContractTotal)); }
  setIfUntouched('e-wht-payee-name', row.name || '');
  const entity = whtPayeeEntityOf(row);
  if (entity) setIfUntouched('e-wht-entity', entity);
  setIfUntouched('e-wht-payee-tax-id', normalizeTaxIdText(row.taxId));
  setIfUntouched('e-wht-payee-address', String(row.address || ''));
  setIfUntouched('e-wht-payee-branch', supplierEstablishmentOf(row) || '00000');
  if (row.whtIncomeType && whtIncomeType(row.whtIncomeType) && !touched.has('e-wht-type')) { $('e-wht-type').value = row.whtIncomeType; fillRateOptions(); }
}
function taxIdHint() {
  const hint = $('e-wht-payee-tax-id-hint');
  if (!hint) return;
  const taxId = normalizeTaxIdText(value('e-wht-payee-tax-id'));
  hint.className = 'tax-help';
  if (!taxId) { hint.textContent = ''; return; }
  if (!isThirteenDigitTaxId(taxId)) { hint.textContent = T.taxIdLength; hint.classList.add('tax-hint-warn'); return; }
  const ok = taxIdCheckDigitOk(taxId);
  hint.textContent = ok ? T.taxIdOk : T.taxIdBad;
  hint.classList.add(ok ? 'tax-hint-ok' : 'tax-hint-warn');
}
function enabled() { return !!$('e-wht-enabled')?.checked; }
// What the expense form sends (erp-tax-forms.js adds it to its draft) — {} when withholding is not ticked.
function expenseDraft() {
  ensureSection();
  if (!enabled()) return {};
  return {
    whtEnabled: true,
    payeeEntityType: value('e-wht-entity'),
    whtIncomeType: value('e-wht-type'),
    whtRate: value('e-wht-rate'),
    whtIncomeText: value('e-wht-income-text'),
    whtCondition: value('e-wht-condition') || '1',
    whtVatBasis: value('e-wht-vat-basis'),
    whtBaseInput: value('e-wht-base'),
    whtPaymentDate: value('e-wht-paid-date'),
    whtContract: !!$('e-wht-contract')?.checked,
    whtContractTotal: value('e-wht-contract-total'),
    whtContractRef: value('e-wht-contract-ref'),
    payeeVatRegistered: payeeVat,
    whtBelowThresholdOverride: !!$('e-wht-below-override')?.checked,
    payeeName: value('e-wht-payee-name') || value('e-vendor'),
    payeeTaxId: normalizeTaxIdText(value('e-wht-payee-tax-id')),
    payeeBranchCode: value('e-wht-payee-branch'),
    payeeAddress: value('e-wht-payee-address')
  };
}
// The expense money the preview uses: the purchase-VAT split when the tax-invoice section applies.
function expenseMoney() {
  const amount = parseMoney(value('e-amount'));
  const docType = value('e-doc-type');
  const inHand = EXPENSE_TAX_INVOICE_DOC_TYPES.includes(docType) && value('e-tax-status') === 'received';
  const mode = inHand ? (value('e-tax-vat-mode') || 'extract') : '';
  if (!mode) return { amount, docType };
  const split = calculateVatSummary(amount, mode);
  return { amount: split.total, docType, vatMode: mode, subtotal: split.subtotal, vatAmt: split.vatAmt };
}
function refreshSection() {
  const section = ensureSection();
  if (!section) return;
  const on = enabled();
  $('e-wht-grid').hidden = !on;
  if (!on) return;
  const type = whtIncomeType(value('e-wht-type'));
  $('e-wht-income-text-field').hidden = !(type && type.rate === null);
  $('e-wht-payee-branch-field').hidden = value('e-wht-entity') !== 'company';
  if (!touched.has('e-wht-payee-name') && !value('e-wht-payee-name')) $('e-wht-payee-name').value = value('e-vendor');
  const money = expenseMoney();
  // r8fix#A1: no VAT split (tax invoice not in hand) → the user states whether the amount includes VAT.
  $('e-wht-vat-basis-field').hidden = !!money.vatMode;
  $('e-wht-contract-total-field').hidden = !$('e-wht-contract').checked;
  $('e-wht-contract-ref-field').hidden = !$('e-wht-contract').checked;
  const preVat = whtPreVatOf({ ...money, whtVatBasis: value('e-wht-vat-basis'), payeeVatRegistered: payeeVat });
  const base = $('e-wht-base');
  if (base) base.placeholder = T.basePlaceholder(fmt(preVat.ok ? preVat.preVat : money.amount));
  const preview = $('e-wht-preview');
  if (!preview) return;
  if (!(money.amount > 0)) { preview.innerHTML = `<span class="tax-help">${esc(T.previewNeedsAmount)}</span>`; return; }
  const plan = planExpenseWhtFields({ ...money, ...expenseDraft(), vendor: value('e-vendor'), date: value('e-date') || localDateISO() });
  if (!plan.ok) { preview.innerHTML = `<em class="tax-hint-warn">${esc(plan.error)}</em>`; return; }
  const due = whtDueDates(taxPeriodOfDate(value('e-wht-paid-date') || value('e-date') || localDateISO()));
  const f = plan.fields;
  preview.innerHTML = f ? `<b>${esc(T.previewTitle)}</b>
    <span>${esc(T.previewBase)} <strong data-wht-preview="base">฿${fmt(f.whtBase)}</strong></span>
    <span>${esc(T.previewTax)} <strong data-wht-preview="tax">฿${fmt(f.whtAmount)}</strong></span>
    <span>${esc(T.previewNet)} <strong data-wht-preview="net">฿${fmt(f.netPaid)}</strong></span>
    <span>${esc(T.previewForm)} <strong data-wht-preview="form">${esc(WHT_TEXT.forms[f.whtForm])}</strong></span>
    ${due ? `<small class="tax-help">${esc(T.previewDue(taxThaiDate(due.paper), taxThaiDate(due.efiling)))}</small>` : ''}
    ${plan.warnings.map(text => `<em class="tax-hint-warn">${esc(text)}</em>`).join('')}`
    : plan.warnings.map(text => `<em class="tax-hint-warn">${esc(text)}</em>`).join('');
}
function onSectionEvent(event) {
  const id = event.target?.id || '';
  if (event.type === 'input' && /^e-wht-(payee-|entity|base)/.test(id)) touched.add(id);
  if (event.type === 'change' && ['e-wht-type', 'e-wht-entity', 'e-wht-contract'].includes(id)) touched.add(id);
  if (event.type === 'input' && id === 'e-wht-contract-total') touched.add(id);
  if (id === 'e-wht-supplier' && event.type === 'change') {
    const row = supplierRows().find(item => String(item.id) === event.target.value);
    ['e-wht-payee-name', 'e-wht-entity', 'e-wht-payee-tax-id', 'e-wht-payee-address', 'e-wht-payee-branch', 'e-wht-type', 'e-wht-contract', 'e-wht-contract-total'].forEach(key => touched.delete(key));
    if (!row) payeeVat = '';
    applySupplier(row);
  }
  if (id === 'e-wht-type') fillRateOptions();
  if (id === 'e-wht-payee-tax-id') taxIdHint();
  if (id === 'e-wht-enabled' && enabled()) { fillSupplierOptions(); autofillFromVendor(); }
  refreshSection();
}
function autofillFromVendor() {
  const name = value('e-vendor');
  const row = supplierRows().find(item => String(item.name || '').trim() === name);
  if (row) { applySupplier(row); taxIdHint(); }
}
function onExpenseFormChange(event) {
  const id = event.target?.id || '';
  if (id.startsWith('e-wht-')) return;
  if (id === 'e-vendor' || id === 'e-tax-supplier') autofillFromVendor();
  if (['e-vendor', 'e-amount', 'e-date', 'e-doc-type', 'e-tax-status', 'e-tax-vat-mode', 'e-tax-supplier'].includes(id)) refreshSection();
}
function resetSection() {
  touched.clear();
  if (!ensureSection()) return;
  ['e-wht-payee-name', 'e-wht-payee-tax-id', 'e-wht-payee-branch', 'e-wht-payee-address', 'e-wht-base', 'e-wht-income-text', 'e-wht-supplier', 'e-wht-entity', 'e-wht-paid-date', 'e-wht-contract-total', 'e-wht-contract-ref'].forEach(id => { if ($(id)) $(id).value = ''; });
  payeeVat = '';
  $('e-wht-contract').checked = false;
  $('e-wht-enabled').checked = false;
  $('e-wht-below-override').checked = false;
  $('e-wht-type').value = WHT_INCOME_TYPES[0].code;
  $('e-wht-condition').value = '1';
  $('e-wht-vat-basis').value = ''; // r13#MED-1: no default — answered, or derived from the payee / document type
  fillRateOptions();
  taxIdHint();
  refreshSection();
}

// ---------------------------------------------------------------- 2. certificates
function knownYears() {
  const years = typeof window.allYears === 'function' ? window.allYears() : [];
  return [...new Set([...years, new Date().getFullYear()].map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
}
function readPack(branch, year, month, strict) {
  if (strict) return window.ComformDocumentWriteStore.loadForWrite(branch, year, month);
  return typeof window.loadFor === 'function' ? window.loadFor(branch, year, month) : {};
}
// Every certificate of the establishments (strict = the write / filing path: a damaged month stops it).
function readCertificates({ branches = ['ubon', 'khonkaen'], strict = false, years = knownYears() } = {}) {
  const rows = [];
  for (const branch of branches) for (const year of years) for (const month of ALL_MONTHS) {
    const pack = readPack(branch, year, month, strict);
    for (const cert of Array.isArray(pack?.whtCertificates) ? pack.whtCertificates : []) rows.push({ ...cert, branch, _branch: branch, _year: year, _month: month });
  }
  return rows;
}
// app.js expense commit hook: the 50 ทวิ goes into the same write session as the expense (all or nothing).
function attachCertificate(session, record, branch, year, month) {
  if (!record || !(Number(record.whtAmount) > 0)) return null;
  // r8fix#B6: a 50 ทวิ is never issued with the sample payer when the saved company profile is unreadable
  // (thrown inside the expense's write session → nothing of the expense is saved either).
  const profileRefusal = window.ERPCompanyProfile?.issueRefusal?.();
  if (profileRefusal) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.PERMISSION, profileRefusal);
  // r13#MED-2: numbered, dated and period-checked on the PAYMENT date (it may be another month than the expense).
  const paidOn = whtPaymentDateOf(record);
  window.ERPGovernance?.assertPeriodOpen?.({ branch, date: paidOn, scope: 'purchase', action: 'wht_certificate_create' });
  const bookNo = whtCertificateBookOf(paidOn);
  const existing = [];
  const payYear = Number(paidOn.slice(0, 4)) || Number(year);
  for (const y of [...new Set([Number(year), payYear - 1, payYear])]) for (const m of ALL_MONTHS) for (const cert of session.get(branch, y, m).whtCertificates || []) existing.push({ ...cert, branch });
  const certNo = nextWhtCertificateNumber(existing, branch, bookNo);
  const at = new Date().toISOString();
  // id derived from the expense's own (Date.now) id: one certificate per payment, never a reused id.
  const cert = buildWhtCertificate({ expense: record, branch, payer: payerInfo(branch), bookNo, certNo, id: `wht-${record.id}`, at, by: actorLabel() });
  const pack = session.get(branch, year, month);
  pack.whtCertificates = Array.isArray(pack.whtCertificates) ? pack.whtCertificates : [];
  pack.whtCertificates.push(cert);
  session.mark(branch, year, month);
  record.whtCertId = cert.id;
  record.whtCertNo = cert.no;
  try { window.ERPProductionCore?.audit?.('create', 'whtCertificate', cert.no, T.auditCreate(whtCertificateDisplayNo(cert), WHT_TEXT.forms[cert.form], cert.taxWithheld, cert.payee.name), { branch, entityId: String(cert.id) }); }
  catch (error) { console.warn('[PayerWHT] audit row not written', error); }
  return cert;
}
function findExpense(branch, year, month, id) {
  const pack = readPack(branch, Number(year), Number(month), false);
  const expense = (pack.expenses || []).find(row => String(row.id) === String(id));
  return expense ? { pack, expense } : null;
}
function certificateOf(pack, expense) {
  const rows = Array.isArray(pack?.whtCertificates) ? pack.whtCertificates : [];
  return rows.find(row => String(row.id) === String(expense?.whtCertId)) || rows.find(row => String(row.sourceExpenseId) === String(expense?.id)) || null;
}
function readFilingsSafe() {
  try { return { filings: readFilings().filings, error: '' }; } catch (error) { return { filings: [], error: T.filingsUnreadable }; }
}

// ---- the printable 50 ทวิ (every stored value escaped)
const CERT_COPIES = Object.freeze([{ id: 1, caption: () => WHT_TEXT.copy1, tab: T.tabCopy1 }, { id: 2, caption: () => WHT_TEXT.copy2, tab: T.tabCopy2 }]);
const box = on => (on ? '☑' : '☐');
const digits = taxId => esc(String(taxId || '').replace(/\D/g, '').split('').join(' ') || '-');
function partyHtml(title, party, branchCode) {
  return `<div class="wht-cert-party"><div class="wht-cert-party-title">${esc(title)}</div>
    <div class="wht-cert-line"><span>${esc(WHT_TEXT.taxId)}</span><b class="wht-cert-tin">${digits(party.taxId)}</b>${branchCode ? `<span>${esc(WHT_TEXT.branchNo)}</span><b class="wht-cert-tin">${esc(branchCode)}</b>` : ''}</div>
    <div class="wht-cert-line"><span>${esc(WHT_TEXT.name)}</span><b>${esc(party.name || '-')}</b></div>
    <div class="wht-cert-line"><span>${esc(WHT_TEXT.address)}</span><b>${esc(party.address || '-')}</b></div></div>`;
}
// One copy (copy 1 | 2) of a certificate; `seq` = ลำดับที่ในแบบ (whtCertificateSequence).
function certificateHtml(cert = {}, copy = 1, options = {}) {
  const copyInfo = CERT_COPIES.find(row => row.id === Number(copy)) || CERT_COPIES[0];
  const live = isWhtCertificateLive(cert);
  // r8fix#C2: a SAMPLE certificate (demoSeed) shows the payer from the CURRENT company profile — the demo data
  // was generated before the customer typed their company in. A real certificate is a legal record: it always
  // prints the payer snapshot stored when it was issued, whatever the profile says today.
  const payer = (cert.demoSeed === true && options.livePayer) ? options.livePayer : (cert.payer || {}), payee = cert.payee || {};
  const notice = companyTaxIdNotice(payer.taxId, !!options.customProfile);
  const formIndex = cert.form === 'PND3' ? 3 : 6; // positions in WHT_TEXT.formBoxes: ภ.ง.ด.3 / ภ.ง.ด.53
  const rows = [1, 2, 3, 4, 5, 6].map(row => {
    const mine = Number(cert.incomeRow) === row;
    const label = row === 5 && mine ? `${WHT_TEXT.incomeRows[5]} (${WHT_TEXT.specify}) ${cert.incomeLabel || ''}` : row === 6 && mine ? `${WHT_TEXT.incomeRows[6]} ${cert.incomeLabel || ''}` : WHT_TEXT.incomeRows[row];
    return `<tr${mine ? ' class="wht-cert-mine"' : ''}><td>${esc(label)}</td><td class="tc">${mine ? esc(taxThaiDate(cert.date)) : ''}</td><td class="tn">${mine ? esc(fmt(cert.amountPaid)) : ''}</td><td class="tn">${mine ? esc(fmt(cert.taxWithheld)) : ''}</td></tr>`;
  }).join('');
  return `<section class="wht-cert-page" data-wht-copy="${copyInfo.id}" data-cert-id="${esc(String(cert.id ?? ''))}">
    ${live ? '' : `<div class="wht-cert-void">${esc(T.voidStamp)}${cert.voidReason ? `<small>${esc(cert.voidReason)}</small>` : ''}</div>`}
    ${notice ? `<div class="wht-cert-notice wht-cert-notice-${notice}">${esc(notice === 'sample' ? T.sampleNotice : T.invalidNotice)}</div>` : ''}
    <div class="wht-cert-copy">${esc(copyInfo.caption())}</div>
    <div class="wht-cert-head"><div><h1>${esc(WHT_TEXT.certTitle)}</h1><div class="wht-cert-sub">${esc(WHT_TEXT.certSubtitle)}</div></div>
      <div class="wht-cert-no"><span>${esc(WHT_TEXT.bookNo)}</span><b>${esc(cert.bookNo || '-')}</b><span>${esc(WHT_TEXT.certNo)}</span><b>${esc(cert.certNo || '-')}</b></div></div>
    ${partyHtml(WHT_TEXT.payer, payer, payer.branchCode)}
    ${partyHtml(WHT_TEXT.payee, payee, cert.form === 'PND53' ? payee.branchCode : '')}
    <div class="wht-cert-forms"><span>${esc(WHT_TEXT.seqInForm)} <b class="wht-cert-seq">${esc(String(options.seq || '……'))}</b> ${esc(WHT_TEXT.inForm)}</span>${WHT_TEXT.formBoxes.map((label, index) => `<span>${box(index === formIndex)} (${index + 1}) ${esc(label)}</span>`).join('')}</div>
    <table class="wht-cert-table"><thead><tr><th>${esc(WHT_TEXT.incomeHead)}</th><th>${esc(WHT_TEXT.dateHead)}</th><th>${esc(WHT_TEXT.paidHead)}</th><th>${esc(WHT_TEXT.taxHead)}</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="2"><b>${esc(WHT_TEXT.totalRow)}</b></td><td class="tn"><b>${esc(fmt(cert.amountPaid))}</b></td><td class="tn"><b>${esc(fmt(cert.taxWithheld))}</b></td></tr></tfoot></table>
    <div class="wht-cert-words"><span>${esc(WHT_TEXT.totalWords)}</span><b>${esc(cert.taxText || '')}</b></div>
    <div class="wht-cert-funds">${esc(WHT_TEXT.funds)}</div>
    <div class="wht-cert-conditions"><span>${esc(WHT_TEXT.payerCondition)}</span>${[1, 2, 3, 4].map(code => `<span>${box(Number(cert.condition) === code)} (${code}) ${esc(WHT_TEXT.conditions[code])}</span>`).join('')}</div>
    <div class="wht-cert-sign"><p>${esc(WHT_TEXT.certify)}</p><p>${esc(WHT_TEXT.signature)}</p><p>${esc(WHT_TEXT.issueDate)} <b>${esc(taxThaiDate(cert.date))}</b></p><div class="wht-cert-seal">${esc(WHT_TEXT.seal)}</div></div>
    <div class="wht-cert-foot">${esc(T.issuedNote(cert.no || '', branchName(cert.branch || cert._branch || 'ubon')))}</div>
  </section>`;
}
const CERT_PRINT_CSS = `@page{size:A4 portrait;margin:10mm}*{box-sizing:border-box}body{margin:0;font-family:'Sarabun','TH Sarabun New','Noto Sans Thai',Tahoma,sans-serif;color:#111;font-size:12.5px}
.wht-cert-page{page-break-after:always;position:relative;border:1.5px solid #222;padding:10px 12px;min-height:270mm}.wht-cert-page:last-child{page-break-after:auto}
.wht-cert-copy{text-align:right;font-size:11.5px;font-weight:700}.wht-cert-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin:4px 0 8px}.wht-cert-head h1{margin:0;font-size:19px}.wht-cert-sub{font-size:13px}
.wht-cert-no{display:grid;grid-template-columns:auto auto;gap:2px 8px;font-size:13px}.wht-cert-party{border:1px solid #444;padding:6px 8px;margin-bottom:6px}.wht-cert-party-title{font-weight:700;margin-bottom:2px}
.wht-cert-line{display:flex;flex-wrap:wrap;gap:4px 10px;margin:2px 0}.wht-cert-line span{color:#333}.wht-cert-tin{letter-spacing:.08em;font-variant-numeric:tabular-nums}
.wht-cert-forms,.wht-cert-conditions{display:flex;flex-wrap:wrap;gap:4px 14px;margin:6px 0}.wht-cert-table{width:100%;border-collapse:collapse;margin:6px 0}.wht-cert-table th,.wht-cert-table td{border:1px solid #444;padding:4px 6px;vertical-align:top}
.wht-cert-table th{background:#f1f3f5}.wht-cert-table td.tn{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;width:24mm}.wht-cert-table td.tc{text-align:center;width:28mm;white-space:nowrap}.wht-cert-mine td{font-weight:700}
.wht-cert-words{display:flex;gap:10px;margin:4px 0}.wht-cert-funds{font-size:11.5px;color:#333;margin:4px 0}.wht-cert-sign{margin-top:12px;text-align:center}.wht-cert-sign p{margin:4px 0}.wht-cert-seal{display:inline-block;border:1px dashed #666;border-radius:50%;padding:18px 14px;font-size:11px;color:#555;margin-top:6px}
.wht-cert-foot{position:absolute;left:12px;bottom:6px;font-size:10.5px;color:#555}.wht-cert-void{position:absolute;top:40%;left:12%;right:12%;text-align:center;font-size:42px;font-weight:800;color:rgba(180,35,24,.35);border:4px solid rgba(180,35,24,.35);transform:rotate(-12deg)}.wht-cert-void small{display:block;font-size:14px}
.wht-cert-notice{border:1px solid #d97706;background:#fffbeb;color:#92400e;padding:4px 8px;font-size:11px;margin-bottom:4px}.wht-cert-notice-invalid{border-color:#b42318;background:#fef3f2;color:#b42318}`;
function certificateContext(cert) {
  const certificates = readCertificates({ branches: [cert.branch || cert._branch] });
  const { filings } = readFilingsSafe();
  return { seq: whtCertificateSequence(cert, certificates, filings), customProfile: !!savedProfileOf(window.CurrentUser), livePayer: cert.demoSeed === true ? payerInfo(cert.branch || cert._branch || 'ubon') : null };
}
function printCertificate(cert, copies = [1, 2]) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) { say(T.popupBlocked, 'error'); return false; }
  try { printWindow.opener = null; } catch (error) { console.warn('[PayerWHT] could not detach the print window', error); }
  const context = certificateContext(cert);
  printWindow.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(cert.no || 'WHT')}</title><style>${CERT_PRINT_CSS}</style></head><body>${copies.map(copy => certificateHtml(cert, copy, context)).join('')}<script>window.onload=()=>setTimeout(()=>window.print(),400)<\/script></body></html>`);
  printWindow.document.close();
  return true;
}
function openCertificate(cert) {
  if (!cert) { say(T.certNotFound); return null; }
  document.getElementById('doc-preview-modal-overlay')?.remove();
  const context = certificateContext(cert);
  let active = 1;
  const overlay = document.createElement('div');
  overlay.id = 'doc-preview-modal-overlay';
  overlay.className = 'doc-preview-modal-overlay wht-cert-overlay';
  overlay.innerHTML = `<div class="doc-preview-modal" role="dialog" aria-modal="true" aria-label="${esc(T.previewDialog)}">
    <div class="doc-preview-modal-head"><div class="doc-preview-modal-title">${esc(T.previewDialog)} · ${esc(whtCertificateDisplayNo(cert))}</div>
      <div class="cn-doc-preview-actions"><button type="button" class="btn btn-secondary btn-sm" data-wht-doc="print-current">${icon('print')}${esc(T.printThis)}</button><button type="button" class="btn btn-primary btn-sm" data-wht-doc="print-all">${icon('print')}${esc(T.printBoth)}</button><button type="button" class="doc-preview-modal-close" aria-label="${esc(T.close)}">${icon('close')}${esc(T.close)}</button></div></div>
    <div class="doc-preview-modal-tabs"></div><div class="doc-preview-modal-body"><div class="doc-preview-modal-page wht-cert-screen" data-no-i18n="form"></div></div></div>`;
  document.body.appendChild(overlay);
  const tabs = overlay.querySelector('.doc-preview-modal-tabs'), page = overlay.querySelector('.doc-preview-modal-page');
  const render = () => {
    tabs.innerHTML = CERT_COPIES.map(copy => `<button type="button" data-copy="${copy.id}" class="${copy.id === active ? 'active' : ''}" aria-pressed="${copy.id === active}">${esc(copy.tab)}</button>`).join('');
    page.innerHTML = certificateHtml(cert, active, context);
  };
  render();
  // r8fix#C3: modal semantics + focus in / trapped / restored, Escape closes (shared trapDialog).
  let trap = null;
  const onEsc = event => { if (event.key === 'Escape') close(); };
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onEsc); trap?.release(); };
  trap = trapDialog(overlay.querySelector('.doc-preview-modal'), { onClose: close, focus: overlay.querySelector('.doc-preview-modal-close') });
  tabs.addEventListener('click', event => { const button = event.target.closest('button[data-copy]'); if (!button) return; active = Number(button.dataset.copy); render(); tabs.querySelector(`[data-copy="${active}"]`)?.focus(); });
  overlay.addEventListener('click', event => {
    if (event.target === overlay || event.target.closest('.doc-preview-modal-close')) { close(); return; }
    const action = event.target.closest('[data-wht-doc]')?.dataset.whtDoc;
    if (action === 'print-current') printCertificate(cert, [active]);
    if (action === 'print-all') printCertificate(cert, [1, 2]);
  });
  document.addEventListener('keydown', onEsc);
  return overlay;
}
function openForExpense(branch, year, month, id) {
  const found = findExpense(branch, year, month, id);
  if (!found) { say(T.expenseNotFound); return null; }
  const cert = certificateOf(found.pack, found.expense);
  if (!cert) { say(T.certNotFound); return null; }
  return openCertificate({ ...cert, branch });
}

// ---- void (cancel-not-delete)
function filedRefusal(cert, filings) {
  const period = taxPeriodOfDate(cert.date);
  const filed = latestWhtFiling(filings, cert.branch, period, cert.form);
  if (filed && filed.rows.some(row => String(row.certId) === String(cert.id))) return T.voidFiled(cert.no, WHT_TEXT.forms[cert.form], taxPeriodShort(period));
  return '';
}
async function voidCertificateUnlocked(branch, year, month, certId, reason) {
  const result = await runDocumentAction({
    action: 'wht_certificate_void',
    context: {},
    validate: () => {
      const text = String(reason ?? '').trim();
      if (!text) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, T.voidReason);
      const session = window.ComformDocumentWriteStore.createSession();
      const pack = session.get(branch, Number(year), Number(month));
      const index = (pack.whtCertificates || []).findIndex(row => String(row.id) === String(certId));
      if (index < 0) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.DEPENDENCY, T.certNotFound);
      const cert = { ...pack.whtCertificates[index], branch };
      if (!isWhtCertificateLive(cert)) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, T.voidAlready);
      window.ERPGovernance?.assertPeriodOpen?.({ branch, date: cert.date, scope: 'purchase', action: 'wht_certificate_void' });
      const filings = readFilings().filings; // strict: an unreadable store refuses the void
      const filed = filedRefusal(cert, filings);
      if (filed) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.PERMISSION, filed);
      return { session, pack, index, cert, text };
    },
    commit: ctx => {
      ctx.pack.whtCertificates[ctx.index] = applyWhtCertificateVoid(ctx.pack.whtCertificates[ctx.index], { by: actorLabel(), reason: ctx.text });
      ctx.session.mark(branch, Number(year), Number(month));
      try { ctx.session.commit(); } catch (error) { throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.STORAGE, error?.message || T.voidFailed); }
      window.ERPIntegrity?.changed?.();
      return ctx;
    },
    afterCommit: ctx => {
      try { window.ERPProductionCore?.audit?.('void', 'whtCertificate', ctx.cert.no, T.auditVoid(ctx.text), { branch, entityId: String(ctx.cert.id) }); }
      catch (error) { console.warn('[PayerWHT] audit row not written (the certificate is voided)', error); }
      try { window.renderEList?.(); window.ERPTaxReports?.render?.(); } catch (error) { console.warn('[PayerWHT] refresh after void failed', error); }
      return ctx;
    }
  });
  if (!result.ok) { say(documentActionFeedback(result).text, 'error', 8000); return false; }
  say(T.voided(result.value.cert.no), 'success', 7000);
  return true;
}
// Refused before the reason question when the period is closed or a filed ภ.ง.ด. lists the certificate.
function askVoidCertificate(branch, year, month, certId) {
  const pack = readPack(branch, Number(year), Number(month), false);
  const stored = (pack.whtCertificates || []).find(row => String(row.id) === String(certId));
  if (!stored) { say(T.certNotFound); return false; }
  const cert = { ...stored, branch };
  if (!isWhtCertificateLive(cert)) { say(T.voidAlready, 'info'); return false; }
  const lock = window.ERPGovernance?.periodLockRefusal?.({ type: 'whtCertificates', branch, date: cert.date, action: 'wht_certificate_void' });
  if (lock) { say(lock, 'error', 8000); return false; }
  const { filings, error } = readFilingsSafe();
  if (error) { say(error, 'error', 8000); return false; }
  const filed = filedRefusal(cert, filings);
  if (filed) { say(filed, 'error', 8000); return false; }
  const reason = typeof window.prompt === 'function' ? window.prompt(T.voidPrompt(whtCertificateDisplayNo(cert))) : null;
  if (reason === null || reason === undefined) return false;
  return withDemoWriteLease('expense', () => voidCertificateUnlocked(branch, year, month, certId, reason)).catch(error => { console.warn('[PayerWHT] void lease', error); say(error?.message || T.voidFailed, 'error'); return false; });
}
function voidForExpense(branch, year, month, id) {
  const found = findExpense(branch, year, month, id);
  if (!found) { say(T.expenseNotFound); return false; }
  const cert = certificateOf(found.pack, found.expense);
  if (!cert) { say(T.certNotFound); return false; }
  return askVoidCertificate(branch, year, month, cert.id);
}

// ---------------------------------------------------------------- 3. ภ.ง.ด.3 / 53 data and filings
function readFilings() {
  return parseWhtFilingsStore(localStorage.getItem(storageKey(WHT_FILINGS_KEY)));
}
function reportFor(branch, period, form, { strict = true } = {}) {
  const target = parseTaxPeriod(period);
  const certificates = readCertificates({ branches: [branch], strict, years: target ? [target.year - 1, target.year] : knownYears() }); // r13#MED-2: a certificate is stored with its expense (paid up to a year later)
  return buildWhtFormReport({ period, form, certificates });
}
function certificatesFor(branch, period) {
  const target = parseTaxPeriod(period);
  if (!target) return [];
  return readCertificates({ branches: [branch], strict: true, years: [target.year - 1, target.year] })
    .filter(cert => taxPeriodOfDate(cert.date) === period)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.certNo).localeCompare(String(b.certNo), 'en', { numeric: true }));
}
function offerLock(branch, period, label, form) {
  const governance = window.ERPGovernance;
  if (!governance?.lockPeriod) return;
  const through = taxPeriodLastDay(period);
  try { governance.assertPeriodOpen({ branch, date: through, scope: 'purchase' }); } catch { return; } // already closed
  if (!window.confirm(T.offerLock(taxPeriodShort(period), taxThaiDate(through)))) return;
  try { governance.lockPeriod({ branch, scope: 'purchase', throughDate: through, reason: T.lockReason(WHT_TEXT.forms[form], taxPeriodShort(period), label) }); say(T.lockedOk(taxPeriodShort(period)), 'success'); }
  catch (error) { say(T.lockFailed(error?.message || String(error)), 'error', 8000); }
}
// "บันทึกว่ายื่นแล้ว" of one ภ.ง.ด.: { branch, period, form, channel } → the stored snapshot, or null.
async function fileReturn({ branch, period, form, channel = 'paper' } = {}) {
  let filings;
  try { filings = readFilings().filings; } catch (error) { say(T.filingsUnreadable, 'error', 8000); return null; }
  if (!(taxPeriodLastDay(period) < localDateISO())) { say(T.periodNotEnded, 'error'); return null; }
  let report;
  try { report = reportFor(branch, period, form); } catch (error) { say(T.filingFailed(error?.message || String(error)), 'error', 8000); return null; }
  if (!report.rows.length) { say(WHT_TEXT.errNothingToFile, 'error'); return null; }
  const amendment = whtFilingsFor(filings, branch, period, form).length;
  const label = amendment ? T.filingAmendment(amendment) : T.filingNormal;
  const formLabel = WHT_TEXT.forms[form];
  if (!window.confirm(T.filingConfirm(label, formLabel, taxPeriodShort(period), branchName(branch), report.totals.count, fmt(report.totals.amountPaid), fmt(report.totals.taxWithheld)))) return null;
  try {
    const snapshot = await withDemoWriteLease('wht-filing', () => {
      const store = readFilings(); // re-read inside the lease: another tab may have filed meanwhile
      const fresh = reportFor(branch, period, form);
      const payer = payerInfo(branch);
      const record = buildWhtFilingSnapshot({ filings: store.filings, id: `whtret_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, branch, period, form, report: fresh, channel, filedAt: new Date().toISOString(), filedBy: actorLabel(), payer: { name: payer.name, taxId: payer.taxId, branchCode: payer.branchCode } });
      const next = normalizeWhtFilingsStore({ ...store, filings: [...store.filings, record] });
      window.ERPIntegrity.transaction([[storageKey(WHT_FILINGS_KEY), next]]);
      return record;
    });
    const done = snapshot.amendment ? T.filingAmendment(snapshot.amendment) : T.filingNormal;
    try { window.ERPProductionCore?.audit?.('create', 'wht_filing', `${formLabel} ${taxPeriodShort(period)}`, T.auditFiling(done, formLabel, branchName(branch), snapshot.totals.taxWithheld), { branch, entityId: snapshot.id }); }
    catch (error) { console.warn('[PayerWHT] audit row not written (the filing is saved)', error); }
    say(T.filedOk(done, formLabel, taxPeriodShort(period)), 'success');
    offerLock(branch, period, done, form);
    return snapshot;
  } catch (error) {
    console.error('[PayerWHT] filing failed', error);
    say(T.filingFailed(error?.message || String(error)), 'error', 8000);
    return null;
  }
}
// JSON backup (app.js masterData.whtFilings): export throws on a damaged store (the backup then fails instead
// of silently dropping it); a restore is validated in full before any write.
function exportBackup() { return readFilings(); }
function backupWrites(value, options = {}) {
  if (value === undefined || value === null) return [];
  const current = localStorage.getItem(storageKey(WHT_FILINGS_KEY)) === null ? null : readFilings();
  return [[storageKey(WHT_FILINGS_KEY), mergeWhtFilingsStores(current, value, { replace: !!options.replace })]];
}
function ledgerIssues() {
  return whtCertificateLedgerIssues(readCertificates(), branchName);
}

// ---------------------------------------------------------------- 4. expense delete guard (D3 item 1)
function vatReturnFiledFor(branch, period) {
  const store = parseVatReturnsStore(localStorage.getItem(storageKey(VAT_RETURNS_KEY)));
  return store.returns.some(row => row.period === period && row.branches.includes(branch));
}
function deleteRefusal(type, branch, record = {}) {
  if (type !== 'expenses' || !record) return '';
  const claim = record.inputVatClaimable === true && parseTaxPeriod(record.claimPeriod) ? record.claimPeriod : '';
  if (claim) {
    // The claim month is a purchase-tax period of its own: a closed one refuses with the SAME text as any lock.
    const lock = window.ERPGovernance?.periodLockRefusal?.({ type: 'expenses', branch, date: `${claim}-01`, action: 'expenses_delete' });
    if (lock) return lock;
    try { if (vatReturnFiledFor(branch, claim)) return T.deleteVatFiled(taxPeriodShort(claim), branchName(branch)); }
    catch (error) { console.warn('[PayerWHT] vat returns unreadable — delete refused', error); return T.deleteVatUnreadable; }
  }
  if (Number(record.whtAmount) > 0 || record.whtCertId) {
    const cert = readCertificates({ branches: [branch] }).find(row => isWhtCertificateLive(row) && (String(row.id) === String(record.whtCertId) || String(row.sourceExpenseId) === String(record.id)));
    if (cert) return T.deleteLiveCert(whtCertificateDisplayNo(cert));
  }
  return '';
}

// ---------------------------------------------------------------- expense list badge / detail rows
function expenseBadgeHtml(expense = {}) {
  if (!(Number(expense.whtAmount) > 0)) return '';
  return `<span class="tax-badge tax-badge-wht" title="${esc(expense.whtIncomeLabel || '')}">${esc(T.badge(expense.whtRate, fmt(expense.whtAmount), WHT_TEXT.forms[expense.whtForm] || ''))}</span>`;
}
function expenseDetailRows(doc = {}, dr) {
  if (typeof dr !== 'function' || !(Number(doc.whtAmount) > 0)) return '';
  return dr(T.detailWht, T.detailWhtValue(doc.whtIncomeLabel || '', doc.whtRate, fmt(doc.whtBase), fmt(doc.whtAmount), WHT_TEXT.conditions[doc.whtCondition] || ''))
    + dr(T.detailPayee, `${doc.payeeName || '-'} · ${doc.payeeTaxId || '-'} · ${WHT_TEXT.forms[doc.whtForm] || ''}`)
    + dr(T.detailNet, `฿${fmt(doc.netPaid)}`)
    + dr(T.detailCert, doc.whtCertNo || '-');
}

// ---------------------------------------------------------------- boot
window.ERPPayerWht = Object.freeze({
  expenseDraft, resetExpense: resetSection, refreshExpense: refreshSection,
  attachCertificate, deleteRefusal, expenseBadgeHtml, expenseDetailRows,
  openForExpense, voidForExpense, openCertificate, askVoidCertificate, printCertificate, certificateHtml,
  readCertificates, certificatesFor, reportFor, readFilings, fileReturn, exportBackup, backupWrites, ledgerIssues, payerInfo,
  dueDates: whtDueDates, threshold: WHT_THRESHOLD_BAHT, formOf: whtFormOf,
  TEXT: WHT_UI_TEXT
});
function boot() {
  ensureSection();
  resetSection();
  const panel = $('panel-expense-form');
  panel?.addEventListener('change', onExpenseFormChange);
  panel?.addEventListener('input', onExpenseFormChange);
  document.addEventListener('erp:navigation', event => { if (event.detail?.id === 'expense-form') { fillSupplierOptions(); refreshSection(); } });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
