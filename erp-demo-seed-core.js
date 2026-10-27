// ============================================================================
// erp-demo-seed-core.js — pure generator of the one-click demo sample data
// ERP DEMO 4.3.1 · ADR-013
// ----------------------------------------------------------------------------
// Builds ~4 months of realistic Thai SME history (quotations, invoices in every
// payment state, receipts incl. 3% WHT, a combined billing payment, credit notes,
// a debit note, expenses incl. payer-side withholding with its 50 ทวิ — ADR-024) from a given business date.
// Two clocks (R9.1, ADR-013 "Dates"): the old unpaid invoices are dated RELATIVE to `today` (≥ 62 days back), so
// "overdue" and the aging buckets mean the same thing whenever the demo runs; everything of the last two closed
// months is pinned to the CALENDAR of the story month (the latest closed month before `today`), so its ภ.พ.30 /
// ภ.ง.ด. / ใบเพิ่มหนี้ / 50 ทวิ figures are identical whatever day the sample is loaded.
//
// Rules this module keeps:
// - DOM/storage free and deterministic: the same `today` + `numberStart` always
//   gives the same plan (no Date.now(), no Math.random()).
// - Every record goes through the app's OWN pure builders and validators
//   (calculateVatSummary, calculateWhtSummary, plan*DocumentAction,
//   buildBillingAction, planBillingPaymentAction, buildPaymentReceiptDrafts,
//   validateCreditNote + buildCreditNoteRecord, validateDebitNote + buildDebitNoteRecord,
//   planExpenseWhtFields (inside planExpenseDocumentAction) + buildWhtCertificate). Totals are never typed by hand.
// - Every record carries `demoSeed: true` + `demoSeedBatch`, so the load / reset prompts can
//   tell sample data from what the user typed, and Trial usage limits ignore sample data.
// - demoResetStorageKeys() is the one definition of "this app's data keys" that
//   "ล้างข้อมูลสาธิตทั้งหมด (รีเซ็ต)" removes (never another tenant's or another app's keys).
// - Document numbers use the app's running-number format (PREFIX + BE yy + mm +
//   2-digit sequence; BL/PAY as in erp-order-flow.js) and continue after the
//   highest number already stored (`numberStart`), so they never collide.
// ============================================================================
import { vatRateNotice, roundMoneyValue, buyerBranchFromContact, calculateVatSummary, calculateWhtSummary, unitPriceForVatMode, addBusinessCalendarDays, parseBusinessDate, businessDaysBetween, GENERAL_CUSTOMER_NAME, TAX_INVOICE_FORM_FULL, TAX_INVOICE_FORM_ABBREVIATED } from './erp-shared-core.js';
import { toBEYear, withThaiCalendarMeta } from './erp-date-core.js';
import { SERVICE_PERIOD_WARNING, planQuoteDocumentAction, planInvoiceDocumentAction, planReceiptDocumentAction, planExpenseDocumentAction, buildBillingAction, planBillingPaymentAction, buildPaymentReceiptDrafts } from './erp-document-finance-core.js';
import { validateCreditNote, buildCreditNoteRecord, creditNoteBuyerBranchLabel } from './erp-credit-note-core.js';
import { validateDebitNote, buildDebitNoteRecord, debitNoteBuyerBranchOf } from './erp-debit-note-core.js';
import { buildWhtCertificate, whtCertificateBookOf, nextWhtCertificateNumber, whtPayeeEntityOf } from './erp-payer-wht-core.js';
import { applyDocumentCancel, cancelReasonText } from './erp-document-cancel-core.js';
import { addTaxPeriods, taxPeriodOfDate, taxPeriodLastDay, taxPeriodFirstDay, TAX_CORE_TEXT, planGoodsReceiptVatFields } from './erp-tax-reports-core.js';
import { invoiceTermDueDate } from './erp-receivables-core.js';
import { validateProductMasterRecord } from './erp-master-data-core.js';
import { DEMO_HISTORY_SCHEMA_VERSION, DEMO_HISTORY_KIND, DEMO_HISTORY_COLUMNS, isMonthKey, parseMonthKey, monthIndex, monthRange, addMonths } from './erp-analytics-core.js';
import { planProductionDocumentAction } from './erp-document-finance-core.js';
import { buildCostingMovements, runCosting, normalizeCostingSettings, defaultCostingSettings, productSkuKey } from './erp-costing-core.js';
import { listJobs, normalizeJobStore, buildJobCostSheets } from './erp-job-costing-core.js';
import { fxRateRow, planFxRateEntry, fxRateDateFor, lookupFxRate, fxRateFieldsOf, planFxReceipt, fxReceiptRecord, fxInvoiceOpenItem, fxSatangToBaht, toMinorUnits, convertToSatang, minorToMajor, planFxPayment, fxPaymentRecord, normalizeFxPayments, planFxMonthEnd, normalizeFxSettings, defaultFxSettings, emptyFxRateStore, normalizeFxRateStore, normalizeFxDocuments, emptyFxDocuments } from './erp-fx-core.js';
import { PRODUCT_EXPERIENCE_MODE_KEY, NAV_COLLAPSED_SECTIONS_KEY, LEGACY_ORDER_FLOW_STORE_KEY, COMPANY_PROFILE_KEY, COMPANY_LOGO_KEY, COMPANY_BRANCH_SETTING_KEY, SALES_TARGETS_KEY, DELIVERY_TARGETS_KEY, SALES_TARGET_PERIODS_KEY, DELIVERY_TARGET_PERIODS_KEY, UI_LANGUAGE_KEY, JOURNAL_SETTINGS_KEY, PROMPTPAY_SETTINGS_KEY } from './erp-storage-contracts.js';

export const DEMO_SEED_CORE_VERSION = '1.5.0'; // 1.4.0 (R9.1): story month pinned to the calendar · 1.5.0 (ADR-028): costing story
export const DEMO_SEED_BATCH_ID = 'demo-seed-v2';
// Shown as "created by" on credit notes / billing activity, so nobody mistakes
// a sample document for one a real user issued.
export const DEMO_SEED_ACTOR = 'ข้อมูลตัวอย่าง (โหลดอัตโนมัติ)';
// Numeric ids like the app's Date.now() ids (list sorting and the inline
// onclick handlers expect numbers), but in a range no live save can produce
// (1,000,000,000,000 ms = September 2001).
const DEMO_SEED_ID_BASE = 1000000000000;
const COMMISSION_PERCENT = 3;

// ---------------------------------------------------------------- tagging
export function isDemoSeedRecord(row) {
  return !!row && typeof row === 'object' && row.demoSeed === true;
}
function tag(record) {
  return { ...record, demoSeed: true, demoSeedBatch: DEMO_SEED_BATCH_ID };
}

// ----------------------------------------------------------- master data
// Customer-agency fields exactly as app.js getCustomerAgencyFromForm() stores
// them for a name its prefix rules classify (tests compare with the app).
const AGENCY = Object.freeze({
  limited_company: { group: 'private_company', groupLabel: 'บริษัทเอกชน', type: 'limited_company', typeLabel: 'บริษัทจำกัด', prefix: 'บจก.' },
  limited_partnership: { group: 'private_company', groupLabel: 'บริษัทเอกชน', type: 'limited_partnership', typeLabel: 'ห้างหุ้นส่วนจำกัด', prefix: 'หจก.' },
  public_company: { group: 'private_company', groupLabel: 'บริษัทเอกชน', type: 'public_company', typeLabel: 'บริษัทมหาชนจำกัด', prefix: 'บมจ.' },
  hospital: { group: 'hospital', groupLabel: 'โรงพยาบาล', type: 'hospital', typeLabel: 'โรงพยาบาล', prefix: 'รพ.' },
  school: { group: 'school', groupLabel: 'โรงเรียน', type: 'school', typeLabel: 'โรงเรียน', prefix: 'รร.' }
});
function agencyFields(kind, customerName) {
  const agency = AGENCY[kind];
  if (agency) {
    return {
      customerAgencyGroup: agency.group,
      customerAgencyGroupLabel: agency.groupLabel,
      customerAgencyType: agency.type,
      customerAgencyTypeLabel: agency.typeLabel,
      customerPrefix: agency.prefix,
      customerAgencyDetectedFrom: 'customer-name-prefix',
      customerAgencyConfidence: 'classified'
    };
  }
  // Unclassified name (or the walk-in form with an empty name field).
  return {
    customerAgencyGroup: 'other',
    customerAgencyGroupLabel: 'อื่น ๆ / ไม่ระบุ',
    customerAgencyType: 'other',
    customerAgencyTypeLabel: 'อื่น ๆ / ไม่ระบุ',
    customerPrefix: '',
    customerAgencyDetectedFrom: customerName ? 'manual-required' : 'empty-customer',
    customerAgencyConfidence: 'unknown'
  };
}

// Fictitious businesses. Tax IDs are 13 digits with a valid check digit
// (นิติบุคคล start with 0; the sole proprietor uses a personal-ID style number).
// branchCode/branchName: the buyer's สำนักงานใหญ่ (00000, the default) or สาขา, as in Customer Master.
const CUSTOMERS = Object.freeze([
  { key: 'C1', id: 'demo-seed-c01', name: 'บจก. อุบลไอที โซลูชั่น', agency: 'limited_company', taxId: '0345559001012', address: '118/9 ถนนชยางกูร ตำบลในเมือง อำเภอเมืองอุบลราชธานี จังหวัดอุบลราชธานี', postalCode: '34000', contactPerson: 'คุณกมลพร (จัดซื้อ)', phone: '045-240-118', email: 'purchase@ubon-it.example', creditTerm: 'credit30', salesPerson: 'สมชาย ใจดี' },
  { key: 'C2', id: 'demo-seed-c02', name: 'บจก. สยามเกษตรอุบล', agency: 'limited_company', taxId: '0345561002128', address: '55 หมู่ 7 ตำบลแจระแม อำเภอเมืองอุบลราชธานี จังหวัดอุบลราชธานี', postalCode: '34000', contactPerson: 'คุณประเสริฐ (ผู้จัดการ)', phone: '045-312-550', email: 'account@siam-agri.example', creditTerm: 'credit60', salesPerson: 'สมชาย ใจดี' },
  { key: 'C3', id: 'demo-seed-c03', name: 'รพ.รวมแพทย์อุบล', agency: 'hospital', taxId: '0345562003233', address: '9 ถนนสรรพสิทธิ์ ตำบลในเมือง อำเภอเมืองอุบลราชธานี จังหวัดอุบลราชธานี', postalCode: '34000', contactPerson: 'คุณนภา (ฝ่ายไอที)', phone: '045-255-900', email: 'it@ruamphaet.example', creditTerm: 'credit30', salesPerson: 'ธนพล มั่งมี' },
  { key: 'C4', id: 'demo-seed-c04', name: 'หจก. ขอนแก่นรุ่งเรืองก่อสร้าง', agency: 'limited_partnership', taxId: '0405558004343', address: '202 ถนนมิตรภาพ ตำบลในเมือง อำเภอเมืองขอนแก่น จังหวัดขอนแก่น', postalCode: '40000', contactPerson: 'คุณสุรชัย (หุ้นส่วนผู้จัดการ)', phone: '043-221-202', email: 'office@kk-rungruang.example', creditTerm: 'credit30', salesPerson: 'วิภาวดี ศรีสุข' },
  { key: 'C5', id: 'demo-seed-c05', name: 'บจก. อีสานโลจิสติกส์ เอ็กซ์เพรส', agency: 'limited_company', taxId: '0405560005459', address: '88/1 ถนนเลี่ยงเมือง ตำบลศิลา อำเภอเมืองขอนแก่น จังหวัดขอนแก่น', postalCode: '40000', contactPerson: 'คุณอรุณี (บัญชี)', phone: '043-306-881', email: 'ap@isan-logistics.example', creditTerm: 'credit30', salesPerson: 'วิภาวดี ศรีสุข' },
  { key: 'C6', id: 'demo-seed-c06', name: 'รร.ศรีขอนแก่นวิทยา', agency: 'school', taxId: '0994000606567', address: '1 ถนนศรีจันทร์ ตำบลในเมือง อำเภอเมืองขอนแก่น จังหวัดขอนแก่น', postalCode: '40000', contactPerson: 'คุณครูวรรณา (งานพัสดุ)', phone: '043-236-001', email: 'supply@srikk-school.example', creditTerm: 'credit30', salesPerson: 'วิภาวดี ศรีสุข' },
  { key: 'C7', id: 'demo-seed-c07', name: 'บจก. มูลมั่งมี วัสดุภัณฑ์', agency: 'limited_company', taxId: '0345563007674', address: '310 ถนนอุปราช ตำบลในเมือง อำเภอวารินชำราบ จังหวัดอุบลราชธานี', postalCode: '34190', contactPerson: 'คุณวิไล (จัดซื้อ)', phone: '045-321-310', email: 'buy@moonmangmee.example', creditTerm: 'credit30', salesPerson: 'ธนพล มั่งมี' },
  // A Bangkok-registered public company buying for its Khon Kaen factory = a buyer BRANCH (สาขาที่ 00003).
  { key: 'C8', id: 'demo-seed-c08', name: 'บมจ. แก่นนคร ฟู้ดส์', agency: 'public_company', taxId: '0107537008786', branchCode: '00003', branchName: 'โรงงานขอนแก่น', address: '99 หมู่ 3 ถนนมะลิวัลย์ ตำบลบ้านทุ่ม อำเภอเมืองขอนแก่น จังหวัดขอนแก่น', postalCode: '40000', contactPerson: 'คุณธีรวัฒน์ (IT Manager)', phone: '043-009-999', email: 'it@kaennakorn-foods.example', creditTerm: 'credit60', salesPerson: 'วิภาวดี ศรีสุข' },
  { key: 'C9', id: 'demo-seed-c09', name: 'สำนักงานบัญชีวรรณาการบัญชี', agency: '', entityType: 'individual', taxId: '3409900123451', address: '17 ถนนพโลรังฤทธิ์ ตำบลในเมือง อำเภอเมืองอุบลราชธานี จังหวัดอุบลราชธานี', postalCode: '34000', contactPerson: 'คุณวรรณา', phone: '081-000-4417', email: 'wanna.acc@example.com', creditTerm: 'credit30', salesPerson: 'สมชาย ใจดี' }
]);
const WALK_IN = Object.freeze({ key: 'WALKIN', name: GENERAL_CUSTOMER_NAME, agency: '', taxId: '', address: '', contactPerson: '', phone: '', email: '', creditTerm: '', salesPerson: '' });

// ADR-023: fictitious VAT-registered suppliers (Supplier Master, role 'supplier') whose full tax invoices
// the sample expenses carry — 13-digit tax IDs with a valid check digit, head office (00000) or a branch.
// The stationery shop issues only abbreviated tax invoices (ภาษีซื้อต้องห้าม, 82/5).
const SUPPLIERS = Object.freeze([
  { key: 'S_UL', vatRegistered: 'yes', id: 'demo-seed-s01', name: 'บจก. อุบลแลนด์', entityType: 'company', taxId: '0345556001011', branchCode: '00000', branchName: 'สำนักงานใหญ่', address: '45 ถนนแจ้งสนิท ตำบลในเมือง อำเภอเมืองอุบลราชธานี จังหวัดอุบลราชธานี 34000', phone: '045-311-450' },
  { key: 'S_KP', vatRegistered: 'yes', id: 'demo-seed-s02', name: 'บจก. ขอนแก่นพร็อพเพอร์ตี้', entityType: 'company', taxId: '0405557002029', branchCode: '00000', branchName: 'สำนักงานใหญ่', address: '77 ถนนประชาสโมสร ตำบลในเมือง อำเภอเมืองขอนแก่น จังหวัดขอนแก่น 40000', phone: '043-224-077' },
  { key: 'S_NET', vatRegistered: 'yes', id: 'demo-seed-s03', name: 'บจก. อีสานไฟเบอร์เน็ต', entityType: 'company', taxId: '0345560003031', branchCode: '00002', branchName: 'สาขาอุบลราชธานี', address: '9/1 ถนนชยางกูร ตำบลในเมือง อำเภอเมืองอุบลราชธานี จังหวัดอุบลราชธานี 34000', phone: '045-200-009' },
  { key: 'S_IT', vatRegistered: 'yes', id: 'demo-seed-s04', name: 'บจก. ไอทีซัพพลาย อีสาน', entityType: 'company', taxId: '0105558004044', branchCode: '00000', branchName: 'สำนักงานใหญ่', address: '210 ถนนพหลโยธิน แขวงสามเสนใน เขตพญาไท กรุงเทพมหานคร 10400', phone: '02-279-0210' },
  { key: 'S_OFF', vatRegistered: 'yes', id: 'demo-seed-s05', name: 'บจก. ออฟฟิศพลัส เซ็นเตอร์', entityType: 'company', taxId: '0345562005058', branchCode: '00002', branchName: 'สาขาวารินชำราบ', address: '18 ถนนสถลมาร์ค ตำบลวารินชำราบ อำเภอวารินชำราบ จังหวัดอุบลราชธานี 34190', phone: '045-322-018' },
  { key: 'S_PUMP', vatRegistered: 'yes', id: 'demo-seed-s06', name: 'หจก. วารินปิโตรเลียม', entityType: 'company', taxId: '0345559006065', branchCode: '00000', branchName: 'สำนักงานใหญ่', address: '300 ถนนสถลมาร์ค ตำบลแสนสุข อำเภอวารินชำราบ จังหวัดอุบลราชธานี 34190', phone: '045-321-300' },
  { key: 'S_SHOP', vatRegistered: 'yes', id: 'demo-seed-s07', name: 'ร้านเครื่องเขียนมิตรภาพ', entityType: 'person', taxId: '3109900543215', branchCode: '00000', branchName: 'สำนักงานใหญ่', address: '12 ถนนพโลรังฤทธิ์ ตำบลในเมือง อำเภอเมืองอุบลราชธานี จังหวัดอุบลราชธานี 34000', phone: '045-254-012' },
  { key: 'S_CLOUD', vatRegistered: 'yes', id: 'demo-seed-s08', name: 'บจก. คลาวด์โซลูชั่น ไทย', entityType: 'company', taxId: '0105561007075', branchCode: '00000', branchName: 'สำนักงานใหญ่', address: '88 ถนนสีลม แขวงสุริยวงศ์ เขตบางรัก กรุงเทพมหานคร 10500', phone: '02-233-0088', whtIncomeType: 'service' },
  // ADR-024: payees of the payer-side withholding story — an individual landlord (ภ.ง.ด.3) and a small
  // non-VAT transport partnership (ภ.ง.ด.53). Their receipts are not tax invoices (no input VAT).
  { key: 'S_LAND', vatRegistered: 'no', id: 'demo-seed-s09', name: 'นายสมศักดิ์ ใจงาม', entityType: 'person', taxId: '3340100123459', branchCode: '00000', branchName: 'สำนักงานใหญ่', address: '25 ถนนเทพโยธี ตำบลในเมือง อำเภอเมืองอุบลราชธานี จังหวัดอุบลราชธานี 34000', phone: '081-555-0125', whtIncomeType: 'rent' },
  // r13#MED-7: payees of the added withholding — a sole-proprietor carrier (1 %), a subcontract electrician (3 %) and a
  // crane-with-operator hire (3 %), none VAT-registered (their receipts are not tax invoices).
  { key: 'S_EXP', vatRegistered: 'no', id: 'demo-seed-s11', name: 'ขนส่งด่วนอีสาน', entityType: 'person', taxId: '3400100234560', branchCode: '00000', branchName: 'สำนักงานใหญ่', address: '51 ถนนมิตรภาพ ตำบลในเมือง อำเภอเมืองขอนแก่น จังหวัดขอนแก่น 40000', phone: '086-211-0457', whtIncomeType: 'transport' },
  { key: 'S_SUB', vatRegistered: 'no', id: 'demo-seed-s12', name: 'นายวิชัย ช่างไฟฟ้า', entityType: 'person', taxId: '3409900345674', branchCode: '00000', branchName: 'สำนักงานใหญ่', address: '8 ถนนสรรพสิทธิ์ ตำบลในเมือง อำเภอเมืองอุบลราชธานี จังหวัดอุบลราชธานี 34000', phone: '089-622-0108', whtIncomeType: 'hire_of_work' },
  { key: 'S_CRANE', vatRegistered: 'no', id: 'demo-seed-s13', name: 'บจก. อีสานเครนเซอร์วิส', entityType: 'company', taxId: '0405559012129', branchCode: '00000', branchName: 'สำนักงานใหญ่', address: '199 ถนนเลี่ยงเมือง ตำบลศิลา อำเภอเมืองขอนแก่น จังหวัดขอนแก่น 40000', phone: '043-306-199', whtIncomeType: 'hire_of_work' },
  { key: 'S_TRANS', vatRegistered: 'no', id: 'demo-seed-s10', name: 'หจก. อุบลขนส่งด่วน', entityType: 'company', taxId: '0343559008881', branchCode: '00000', branchName: 'สำนักงานใหญ่', address: '140 ถนนเลี่ยงเมือง ตำบลแจระแม อำเภอเมืองอุบลราชธานี จังหวัดอุบลราชธานี 34000', phone: '045-210-140', whtIncomeType: 'transport' }
]);

// Product master rows in the same shape as app.js saveProductMasterLocal().
// Inventory items carry opening stock per branch so seeded sales never make stock negative.
// leadTimeDays (ADR-027, optional; 7 when missing): days from ordering to receiving — imported notebooks take three
// weeks, consumables from the local distributor a few days. The reorder point of "วิเคราะห์และคาดการณ์" uses it.
const PRODUCTS = Object.freeze([
  { code: 'DEMO-NB01', name: 'โน้ตบุ๊กธุรกิจ 14 นิ้ว (Core i5 / RAM 16GB)', category: 'คอมพิวเตอร์และอุปกรณ์', unit: 'เครื่อง', flowType: 'inventory', fulfillmentType: 'stock', openingStockUbon: 15, openingStockKhonkaen: 10, reorderPoint: 3, standardCost: 19500, defaultPrice: 24900, defaultSupplier: 'ดิสทริบิวเตอร์ไอทีตัวอย่าง จำกัด', leadTimeDays: 21 },
  { code: 'DEMO-MN01', name: 'จอมอนิเตอร์ 24 นิ้ว IPS', category: 'คอมพิวเตอร์และอุปกรณ์', unit: 'เครื่อง', flowType: 'inventory', fulfillmentType: 'stock', openingStockUbon: 30, openingStockKhonkaen: 20, reorderPoint: 5, standardCost: 3200, defaultPrice: 4290, defaultSupplier: 'ดิสทริบิวเตอร์ไอทีตัวอย่าง จำกัด', leadTimeDays: 10 },
  { code: 'DEMO-UP01', name: 'เครื่องสำรองไฟ UPS 1000VA', category: 'ไฟฟ้าและสำรองไฟ', unit: 'เครื่อง', flowType: 'inventory', fulfillmentType: 'stock', openingStockUbon: 20, openingStockKhonkaen: 15, reorderPoint: 4, standardCost: 2650, defaultPrice: 3590, defaultSupplier: 'ดิสทริบิวเตอร์ไอทีตัวอย่าง จำกัด', leadTimeDays: 7 },
  { code: 'DEMO-NW01', name: 'ชุดอุปกรณ์เครือข่ายสำนักงาน (Switch + Access Point)', category: 'ระบบเครือข่าย', unit: 'ชุด', flowType: 'non_inventory', fulfillmentType: 'made_to_order', openingStockUbon: 0, openingStockKhonkaen: 0, reorderPoint: 0, standardCost: 9800, defaultPrice: 13500, defaultSupplier: 'ดิสทริบิวเตอร์ไอทีตัวอย่าง จำกัด' },
  { code: 'DEMO-PR01', name: 'เครื่องพิมพ์เลเซอร์มัลติฟังก์ชัน (พิมพ์/สแกน/ถ่ายเอกสาร)', category: 'คอมพิวเตอร์และอุปกรณ์', unit: 'เครื่อง', flowType: 'inventory', fulfillmentType: 'stock', openingStockUbon: 8, openingStockKhonkaen: 6, reorderPoint: 2, standardCost: 6900, defaultPrice: 8990, defaultSupplier: 'ดิสทริบิวเตอร์ไอทีตัวอย่าง จำกัด', leadTimeDays: 14 },
  { code: 'DEMO-TN01', name: 'ตลับหมึกเลเซอร์ (ของแท้) สำหรับ DEMO-PR01', category: 'วัสดุสิ้นเปลือง', unit: 'ตลับ', flowType: 'inventory', fulfillmentType: 'stock', openingStockUbon: 40, openingStockKhonkaen: 30, reorderPoint: 10, standardCost: 1650, defaultPrice: 2290, defaultSupplier: 'ดิสทริบิวเตอร์ไอทีตัวอย่าง จำกัด', leadTimeDays: 5 },
  { code: 'DEMO-KB01', name: 'ชุดคีย์บอร์ดและเมาส์ไร้สาย', category: 'คอมพิวเตอร์และอุปกรณ์', unit: 'ชุด', flowType: 'inventory', fulfillmentType: 'stock', openingStockUbon: 25, openingStockKhonkaen: 20, reorderPoint: 5, standardCost: 690, defaultPrice: 990, defaultSupplier: 'ดิสทริบิวเตอร์ไอทีตัวอย่าง จำกัด', leadTimeDays: 5 },
  { code: 'DEMO-CC01', name: 'ชุดกล้องวงจรปิด IP 4 ตัว พร้อมเครื่องบันทึก', category: 'ระบบรักษาความปลอดภัย', unit: 'ชุด', flowType: 'non_inventory', fulfillmentType: 'made_to_order', openingStockUbon: 0, openingStockKhonkaen: 0, reorderPoint: 0, standardCost: 11800, defaultPrice: 16500, defaultSupplier: 'ดิสทริบิวเตอร์ไอทีตัวอย่าง จำกัด' },
  { code: 'DEMO-SW01', name: 'Microsoft 365 Business Standard (1 ปี)', category: 'ซอฟต์แวร์และลิขสิทธิ์', unit: 'ชุด', flowType: 'non_inventory', fulfillmentType: 'made_to_order', openingStockUbon: 0, openingStockKhonkaen: 0, reorderPoint: 0, standardCost: 4200, defaultPrice: 5390, defaultSupplier: 'ดิสทริบิวเตอร์ไอทีตัวอย่าง จำกัด' },
  { code: 'DEMO-SV01', name: 'บริการติดตั้งและตั้งค่าระบบเครือข่าย', category: 'บริการ', unit: 'งาน', flowType: 'service', fulfillmentType: 'service', openingStockUbon: 0, openingStockKhonkaen: 0, reorderPoint: 0, standardCost: 3000, defaultPrice: 6500, defaultSupplier: '' },
  { code: 'DEMO-SV02', name: 'บริการบำรุงรักษาระบบรายเดือน (MA)', category: 'บริการ', unit: 'ครั้ง', flowType: 'service', fulfillmentType: 'service', openingStockUbon: 0, openingStockKhonkaen: 0, reorderPoint: 0, standardCost: 1800, defaultPrice: 4500, defaultSupplier: '' },
  { code: 'DEMO-TR01', name: 'บริการอบรมการใช้งานระบบบัญชี', category: 'บริการ', unit: 'ครั้ง', flowType: 'service', fulfillmentType: 'service', openingStockUbon: 0, openingStockKhonkaen: 0, reorderPoint: 0, standardCost: 1500, defaultPrice: 3500, defaultSupplier: '' }
]);

// ------------------------------------------------------------- scenario
// Every row says WHEN it happened in one of three ways (R9.1 — "the story month" S = the latest fully closed
// calendar month before `today`, the ภ.พ.30 / ภ.ง.ด. the presenter files now; in January it is December of the year before):
// - `offset: n`   n calendar days before `today` (n < 0). Only for rows at least 62 days old (RELATIVE_MIN_AGE_DAYS:
//                 S never starts more than 61 days before `today`), so they can never fall into S — and for open
//                 quotations, which are in no tax figure. The aging story lives here: U0 / K1 / U3 / U2 are exactly
//                 100 / 62 / 45 / 10 days late on every load date.
// - `recent: n`   n days before `today` but never before the 1st of today's month (the last walk-in sales: on the
//                 1st of a month they are dated that day, so they never leak into S).
// - `monthDay: n` / `monthEnd: n` (+ `storyMonth: -1` for the month before S; default 0 = S) — pinned to the calendar
//                 of S: day n of the month (1–28), or n days before its last day (0–27), so a row never leaves its
//                 month. Rule used throughout: a day ≤ 14 of the canonical load (5 Oct 2569: S = September, the
//                 month before = August) counts from the 1st, a later day counts back from the month end, so the
//                 last-day rows stay on the last day and the rows keep their order in a 28-day February. On
//                 5 Oct 2569 every date is the same as before R9.1 (the hand-worked figures of tests/tax-reports-core.test.cjs).
// No row is ever dated after `today`; buildDemoSeedPlan() checks all of this and throws otherwise.
// useVat follows the form: 1 = บวก VAT, 0 = ราคารวม VAT แล้ว (แยกภาษี), 2 = ไม่มี VAT.
const QUOTES = Object.freeze([
  { key: 'Q1', branch: 'ubon', customer: 'C1', offset: -84, useVat: 1, approved: true, lines: [['DEMO-NB01', 5], ['DEMO-SV01', 1]], note: 'ราคารวมติดตั้ง ยืนราคา 30 วัน' },
  { key: 'Q5', branch: 'ubon', customer: 'C7', offset: -60, useVat: 1, approved: false, lines: [['DEMO-UP01', 10]], note: 'ลูกค้าขอเปรียบเทียบราคา (ยังไม่อนุมัติ)' },
  // Converted into K6 (dated in S): pinned to S too, so it is always approved before the invoice is issued.
  { key: 'Q2', branch: 'khonkaen', customer: 'C8', monthDay: 11, useVat: 1, approved: true, lines: [['DEMO-NB01', 2], ['DEMO-SW01', 2]], note: 'ส่งของภายใน 7 วันหลังอนุมัติ' },
  { key: 'Q3', branch: 'ubon', customer: 'C2', offset: -6, useVat: 1, approved: false, lines: [['DEMO-NB01', 10], ['DEMO-SV01', 1]], note: 'โครงการเปลี่ยนเครื่องทั้งสำนักงาน — รอผู้บริหารอนุมัติ' },
  { key: 'Q4', branch: 'khonkaen', customer: 'C5', offset: -3, useVat: 1, approved: false, lines: [['DEMO-SV02', 12]], note: 'สัญญาบำรุงรักษารายปี 12 ครั้ง' }
]);
// Payment story (with `today` = T; "late" = days past the due date):
// U0 late 100 (over 90) · K1 late 62 (61–90) · U3 price-adjusted, late 45 (31–60) ·
// U2 partly paid then goods returned, late 10 (1–30) — these four on every load date ·
// U4 overdue on every load date (due in S; 17 days late on the canonical load, 31–60 late in some months) ·
// U5 VAT-inclusive full invoice, due 30 days after the 10th of S (canonical load: "in 5 days") · U6 (credit note
// issued then voided) · U8 no-VAT · K8 — 30-day bills of S that fall due during today's month ·
// K6 (from quotation Q2, buyer BRANCH 00003, 60 days) never due in today's month ·
// U1 (from quotation Q1) / K2 paid · K3 paid with 3% WHT · K4+K5 settled
// by one billing payment · K9 fully credited (training cancelled) · U7/K7 walk-in cash
// sales (abbreviated tax invoices). paymentSummary statuses: paid / partially_paid /
// pending / credited all occur.
// VAT modes: useVat 1 (บวก VAT) on most full invoices, 0 (ราคารวม VAT) on U5 and the
// walk-in sales, 2 (ไม่มี VAT) on U8.
// Canonical dates (load 5 Oct 2569) in brackets after each pinned row.
const INVOICES = Object.freeze([
  { key: 'U0', branch: 'ubon', customer: 'C7', offset: -130, useVat: 1, lines: [['DEMO-PR01', 2], ['DEMO-TN01', 10]], note: 'ส่งของครบแล้ว ลูกค้าแจ้งรออนุมัติจ่าย' },
  { key: 'K1', branch: 'khonkaen', customer: 'C4', offset: -92, useVat: 1, lines: [['DEMO-NB01', 4], ['DEMO-MN01', 4]], note: 'ส่งมอบพร้อมติดตั้งที่หน้างาน' },
  { key: 'U1', branch: 'ubon', customer: 'C1', offset: -80, useVat: 1, lines: [['DEMO-NB01', 5], ['DEMO-SV01', 1]], quote: 'Q1' },
  { key: 'U3', branch: 'ubon', customer: 'C3', offset: -75, useVat: 1, lines: [['DEMO-NW01', 1], ['DEMO-SV01', 2]] },
  { key: 'U2', branch: 'ubon', customer: 'C2', offset: -70, useVat: 1, lines: [['DEMO-NB01', 3], ['DEMO-UP01', 3]] },
  { key: 'K2', branch: 'khonkaen', customer: 'C4', offset: -66, useVat: 1, lines: [['DEMO-CC01', 1], ['DEMO-UP01', 4], ['DEMO-SV01', 1]], note: 'ติดตั้งกล้องวงจรปิดและ UPS ที่สำนักงานหน้างาน' },
  { key: 'K4', branch: 'khonkaen', customer: 'C6', storyMonth: -1, monthEnd: 15, useVat: 1, lines: [['DEMO-MN01', 6], ['DEMO-KB01', 6]] }, // [16 Aug]
  { key: 'U4', branch: 'ubon', customer: 'C7', storyMonth: -1, monthEnd: 12, useVat: 1, lines: [['DEMO-MN01', 6], ['DEMO-UP01', 2]] }, // [19 Aug]
  { key: 'K5', branch: 'khonkaen', customer: 'C6', storyMonth: -1, monthEnd: 9, useVat: 1, lines: [['DEMO-SW01', 6], ['DEMO-TR01', 1]] }, // [22 Aug]
  { key: 'K3', branch: 'khonkaen', customer: 'C5', storyMonth: -1, monthEnd: 5, useVat: 1, lines: [['DEMO-SV02', 2], ['DEMO-SV01', 1]], servicePeriodMonths: 2 }, // [26 Aug] r13#LOW-5: MA over 2 months
  { key: 'K9', branch: 'khonkaen', customer: 'C6', storyMonth: -1, monthEnd: 0, useVat: 1, lines: [['DEMO-TR01', 1]], note: 'อบรมเจ้าหน้าที่พัสดุ (โรงเรียนแจ้งยกเลิกภายหลัง)' }, // [31 Aug]
  { key: 'U5', branch: 'ubon', customer: 'C1', monthDay: 10, useVat: 0, lines: [['DEMO-SW01', 10]], note: 'ราคาตามใบเสนอราคาเป็นราคารวมภาษีมูลค่าเพิ่มแล้ว', servicePeriodMonths: 12 }, // [10 Sep]
  { key: 'K6', branch: 'khonkaen', customer: 'C8', monthEnd: 15, useVat: 1, lines: [['DEMO-NB01', 2], ['DEMO-SW01', 2]], quote: 'Q2' }, // [15 Sep]
  { key: 'U8', branch: 'ubon', customer: 'C9', monthEnd: 7, useVat: 2, lines: [['DEMO-TR01', 1]], note: 'รายการไม่มีภาษีมูลค่าเพิ่ม (ตัวอย่างเอกสารไม่มี VAT)' }, // [23 Sep]
  { key: 'U6', branch: 'ubon', customer: 'C3', monthEnd: 3, useVat: 1, lines: [['DEMO-SV02', 3]] }, // [27 Sep]
  { key: 'K8', branch: 'khonkaen', customer: 'C5', monthEnd: 0, useVat: 1, lines: [['DEMO-SV02', 2]] }, // [30 Sep]
  { key: 'U7', branch: 'ubon', customer: 'WALKIN', recent: -2, useVat: 0, taxInvoiceForm: TAX_INVOICE_FORM_ABBREVIATED, lines: [['DEMO-MN01', 1], ['DEMO-TN01', 2]], note: 'ขายหน้าร้าน ชำระเงินสด' },
  { key: 'K7', branch: 'khonkaen', customer: 'WALKIN', recent: -1, useVat: 0, taxInvoiceForm: TAX_INVOICE_FORM_ABBREVIATED, lines: [['DEMO-UP01', 1], ['DEMO-KB01', 1]], note: 'ขายหน้าร้าน ชำระเงินสด' },
  // ADR-023 — the VAT story of the last closed tax month (S, the ภ.พ.30 the presenter files now). Three walk-in
  // abbreviated invoices on one day (one line in รายงานภาษีขาย), a full tax invoice cancelled for a wrong buyer
  // establishment and its replacement under a NEW number (ADR-021). All on the month's last day, after every other
  // invoice of that month, so the running numbers of the earlier sample invoices do not move.
  { key: 'A1', branch: 'ubon', customer: 'WALKIN', monthEnd: 0, useVat: 0, taxInvoiceForm: TAX_INVOICE_FORM_ABBREVIATED, lines: [['DEMO-KB01', 1]], note: 'ขายหน้าร้าน ชำระเงินสด' },
  { key: 'A2', branch: 'ubon', customer: 'WALKIN', monthEnd: 0, useVat: 0, taxInvoiceForm: TAX_INVOICE_FORM_ABBREVIATED, lines: [['DEMO-TN01', 1]], note: 'ขายหน้าร้าน ชำระเงินสด' },
  { key: 'A3', branch: 'ubon', customer: 'WALKIN', monthEnd: 0, useVat: 0, taxInvoiceForm: TAX_INVOICE_FORM_ABBREVIATED, lines: [['DEMO-KB01', 2]], note: 'ขายหน้าร้าน ชำระเงินสด' },
  { key: 'X1', branch: 'ubon', customer: 'C2', monthEnd: 0, useVat: 1, lines: [['DEMO-SV01', 1]], note: 'ติดตั้งเครือข่ายสำนักงานแปลงเกษตร', cancel: { code: 'wrong_details', text: 'ระบุสถานประกอบการของผู้ซื้อผิด ออกฉบับใหม่แทน' } },
  { key: 'X2', branch: 'ubon', customer: 'C2', monthEnd: 0, useVat: 1, lines: [['DEMO-SV01', 1]], note: 'ออกแทนใบกำกับภาษีที่ยกเลิก (ระบุสถานประกอบการของผู้ซื้อผิด)', replaces: 'X1' }
]);
// R1 / R2 / R3 pay invoices dated 80 / 70 / 66 days back (U1 / U2 / K2). In the month before S, day 14 is at most
// 78 days before `today` and 5 / 3 days before the month end at most 67 / 65 days, so each receipt always follows
// its invoice (buildReceipt throws otherwise; tests/r91-seed-dates.test.cjs loads every day of a long window).
const RECEIPTS = Object.freeze([
  { key: 'R1', invoice: 'U1', storyMonth: -1, monthDay: 14, kind: 'full', note: 'โอนเข้าบัญชีธนาคาร' }, // [14 Aug]
  { key: 'R3', invoice: 'K2', storyMonth: -1, monthEnd: 3, kind: 'full', note: 'รับเช็คธนาคาร' }, // [28 Aug]
  { key: 'R2', invoice: 'U2', storyMonth: -1, monthEnd: 5, kind: 'partial', amount: 40000, note: 'ลูกค้าแบ่งชำระงวดแรก' }, // [26 Aug]
  { key: 'R4', invoice: 'K3', monthEnd: 4, kind: 'full', whtRate: 3, whtCertReceived: true, note: 'ลูกค้าหักภาษี ณ ที่จ่าย 3% (ค่าบริการ)' }, // [26 Sep]
  { key: 'R5', invoice: 'U7', recent: -2, kind: 'full', note: 'เงินสดหน้าร้าน' },
  { key: 'R6', invoice: 'K7', recent: -1, kind: 'full', note: 'เงินสดหน้าร้าน' },
  { key: 'RA1', invoice: 'A1', monthEnd: 0, kind: 'full', note: 'เงินสดหน้าร้าน' },
  { key: 'RA2', invoice: 'A2', monthEnd: 0, kind: 'full', note: 'เงินสดหน้าร้าน' },
  { key: 'RA3', invoice: 'A3', monthEnd: 0, kind: 'full', note: 'เงินสดหน้าร้าน' }
]);
const CREDIT_NOTES = Object.freeze([
  { key: 'CN2', invoice: 'U2', monthDay: 5, reasonCode: 'returned_goods', returns: [['DEMO-UP01', 1]], note: 'ลูกค้าคืน UPS 1 เครื่อง (สินค้าเกินความต้องการ) รับกลับเข้าสต็อก' }, // [5 Sep]
  { key: 'CN1', invoice: 'U3', monthDay: 10, reasonCode: 'price_overcharge', difference: 1500, note: 'ปรับค่าติดตั้งให้ตรงราคาที่ตกลงในใบเสนอราคา' }, // [10 Sep]
  { key: 'CN4', invoice: 'K9', monthDay: 2, reasonCode: 'service_cancelled', difference: 3500, note: 'โรงเรียนยกเลิกการอบรมก่อนวันจัด — ลดหนี้เต็มจำนวน (ยังไม่มีการชำระเงิน)' }, // [2 Sep]
  // Voided the next day (`voidedOn` = when, on the same clock as the note itself).
  { key: 'CN3', invoice: 'U6', monthEnd: 1, reasonCode: 'service_cancelled', difference: 4500, note: 'ลดค่าบริการ MA 1 ครั้ง', voidedOn: { monthEnd: 0 }, voidReason: 'ออกใบลดหนี้ผิด — ลูกค้าใช้บริการครบทุกครั้ง จึงยกเลิกและเก็บเลขที่ไว้' } // [29 Sep, voided 30 Sep]
]);
// ADR-024 — ใบเพิ่มหนี้ (มาตรา 86/9) in the tax-month story: the replacement invoice X2 under-charged the
// installation (an extra access-point run the customer approved on site), so 1,500.00 + VAT 7% is billed on top.
// Collected with X2 (paymentSummary.debited), shown in รายงานภาษีขาย / ภ.พ.30 of its own month.
const DEBIT_NOTES = Object.freeze([
  { key: 'DN1', invoice: 'X2', monthEnd: 0, reasonCode: 'service_price_undercharged', increase: 1500, note: 'ติดตั้งจุดกระจายสัญญาณเพิ่ม 1 จุดตามที่ลูกค้าอนุมัติหน้างาน — เรียกเก็บค่าติดตั้งเพิ่ม' }
]);
// Billed and paid in S, after K4 / K5 of the month before: [17 Sep] / [28 Sep].
const BILLING = Object.freeze({ key: 'BL1', invoices: ['K4', 'K5'], billed: Object.freeze({ monthEnd: 13 }), paid: Object.freeze({ monthEnd: 2 }), method: 'โอนเงิน', recipient: 'งานการเงิน โรงเรียน', note: 'วางบิลรวม 2 ใบกำกับภาษี' });
// branchPremises: rent / internet of the second branch's own building — left out when the company has
// one establishment (ADR-022), because that building does not exist then.
// tax (ADR-023): the full tax invoice the supplier issued — VAT split of the gross `amount` (`vatMode`),
// the supplier's TIN / establishment from SUPPLIERS, invoice and received date = the expense date unless
// given, claimed in the month received unless `claimNextMonth`; `claimable: false` + `reason` = ภาษีซื้อต้องห้าม.
// In 'add' mode `amount` is the pre-VAT amount typed, as on the form (the stored amount is the total).
// The online-ads expense keeps no VAT data on purpose: an expense recorded before ADR-023 ("ข้อมูล VAT ไม่ครบ").
// R9.1: the supplier's own numbers / the month in a description follow the row's date (storyText: {yy} {mm} {dd}
// {bey} {ady} {month}), so a December load does not show "เดือนกันยายน"; on the canonical load they read as before.
const EXPENSES = Object.freeze([
  { branch: 'khonkaen', offset: -88, cat: 'ค่าเช่าสถานที่', vendor: 'บจก. ขอนแก่นพร็อพเพอร์ตี้', desc: 'ค่าเช่าอาคารสาขาขอนแก่น', amount: 9000, docType: 'tax_invoice', taxStatus: 'received', docNo: 'KP-6801', purpose: 'company', branchPremises: true, tax: { supplier: 'S_KP', vatMode: 'extract' }, wht: { supplier: 'S_KP', incomeType: 'rent' } },
  { branch: 'ubon', offset: -86, cat: 'ค่าเช่าสถานที่', vendor: 'บจก. อุบลแลนด์', desc: 'ค่าเช่าอาคารสำนักงานใหญ่', amount: 12000, docType: 'tax_invoice', taxStatus: 'received', docNo: 'UL-6801', purpose: 'company', tax: { supplier: 'S_UL', vatMode: 'extract' }, wht: { supplier: 'S_UL', incomeType: 'rent' } },
  { branch: 'ubon', storyMonth: -1, monthDay: 8, cat: 'ค่าเช่าสถานที่', vendor: 'บจก. อุบลแลนด์', desc: 'ค่าเช่าอาคารสำนักงานใหญ่', amount: 12000, docType: 'tax_invoice', taxStatus: 'received', docNo: 'UL-6802', purpose: 'company', tax: { supplier: 'S_UL', vatMode: 'extract' }, wht: { supplier: 'S_UL', incomeType: 'rent' } }, // [8 Aug]
  { branch: 'ubon', storyMonth: -1, monthDay: 11, cat: 'ค่าสาธารณูปโภค', vendor: 'บจก. อีสานไฟเบอร์เน็ต', desc: 'ค่าอินเทอร์เน็ตและโทรศัพท์สำนักงานใหญ่', amount: 4850, docType: 'receipt_tax_invoice', taxStatus: 'received', docNo: 'NET-2291', purpose: 'company', tax: { supplier: 'S_NET', vatMode: 'extract' } }, // [11 Aug]
  { branch: 'khonkaen', storyMonth: -1, monthDay: 9, cat: 'ค่าเช่าสถานที่', vendor: 'บจก. ขอนแก่นพร็อพเพอร์ตี้', desc: 'ค่าเช่าอาคารสาขาขอนแก่น', amount: 9000, docType: 'tax_invoice', taxStatus: 'received', docNo: 'KP-6802', purpose: 'company', branchPremises: true, tax: { supplier: 'S_KP', vatMode: 'extract' }, wht: { supplier: 'S_KP', incomeType: 'rent' } }, // [9 Aug]
  { branch: 'khonkaen', storyMonth: -1, monthEnd: 10, cat: 'ค่าขนส่ง/จัดส่ง', vendor: 'ขนส่งด่วนอีสาน', desc: 'ค่าส่งจอมอนิเตอร์ให้โรงเรียน', amount: 1200, docType: 'receipt', taxStatus: 'not_required', docNo: 'TR-0457', purpose: 'delivery', wht: { supplier: 'S_EXP', incomeType: 'transport', vatBasis: 'none' } }, // [21 Aug] r13#MED-7: 1 %
  // r13#MED-7 / LOW-6: the subcontract costs charged to jobs J1 / J3 are paid (with withholding) — each expense clears the
  // job's accrued cost (jobEntryId, linked after the costing story is built), so the job is not costed twice.
  { branch: 'ubon', offset: -75, cat: 'ค่าแรงงาน', vendor: 'นายวิชัย ช่างไฟฟ้า', desc: 'ค่าจ้างช่วงเดินรางเก็บสายบนฝ้า (งานติดตั้งเครือข่าย)', amount: 1500, docType: 'receipt', taxStatus: 'not_required', docNo: 'SUB-{yy}{mm}{dd}', purpose: 'customer_job', job: { key: 'J1', text: 'จ้างเดินรางเก็บสายบนฝ้า' }, wht: { supplier: 'S_SUB', incomeType: 'hire_of_work', vatBasis: 'none' } },
  { branch: 'khonkaen', storyMonth: -1, monthEnd: 5, cat: 'อื่น ๆ', vendor: 'บจก. อีสานเครนเซอร์วิส', desc: 'ค่าเช่ารถกระเช้าพร้อมผู้ควบคุม ติดตั้งสายบนที่สูง (งานคลังสินค้า)', amount: 1600, docType: 'receipt', taxStatus: 'not_required', docNo: 'CR-{yy}{mm}-118', purpose: 'customer_job', job: { key: 'J3', text: 'เช่ารถกระเช้าติดตั้งสายบนที่สูง' }, wht: { supplier: 'S_CRANE', incomeType: 'hire_of_work', vatBasis: 'none' } }, // [26 Aug]
  { branch: 'ubon', monthDay: 2, cat: 'ค่าน้ำมันเชื้อเพลิง', vendor: 'ปั๊มน้ำมันตัวอย่าง', desc: 'ค่าน้ำมันรถติดตั้งหน้างาน', amount: 1500, docType: 'receipt', taxStatus: 'requested', docNo: '', purpose: 'customer_job' }, // [2 Sep]
  { branch: 'ubon', monthDay: 7, cat: 'ค่าเช่าสถานที่', vendor: 'บจก. อุบลแลนด์', desc: 'ค่าเช่าอาคารสำนักงานใหญ่', amount: 12000, docType: 'tax_invoice', taxStatus: 'received', docNo: 'UL-6803', purpose: 'company', tax: { supplier: 'S_UL', vatMode: 'extract' }, wht: { supplier: 'S_UL', incomeType: 'rent' } }, // [7 Sep]
  { branch: 'khonkaen', monthDay: 8, cat: 'ค่าเช่าสถานที่', vendor: 'บจก. ขอนแก่นพร็อพเพอร์ตี้', desc: 'ค่าเช่าอาคารสาขาขอนแก่น', amount: 9000, docType: 'tax_invoice', taxStatus: 'received', docNo: 'KP-6803', purpose: 'company', branchPremises: true, tax: { supplier: 'S_KP', vatMode: 'extract' }, wht: { supplier: 'S_KP', incomeType: 'rent' } }, // [8 Sep]
  { branch: 'ubon', monthEnd: 10, cat: 'ค่าการตลาด', vendor: 'บจก. โฆษณาออนไลน์ตัวอย่าง', desc: 'โฆษณาออนไลน์แคมเปญโน้ตบุ๊ก', amount: 8000, docType: 'tax_invoice', taxStatus: 'requested', docNo: '', purpose: 'company' }, // [20 Sep]
  { branch: 'khonkaen', monthEnd: 5, cat: 'ค่าสาธารณูปโภค', vendor: 'บจก. อีสานไฟเบอร์เน็ต', desc: 'ค่าอินเทอร์เน็ตสาขาขอนแก่น', amount: 3200, docType: 'receipt_tax_invoice', taxStatus: 'received', docNo: 'NET-4410', purpose: 'company', branchPremises: true, tax: { supplier: 'S_NET', vatMode: 'extract' } }, // [25 Sep]
  // The tax month's purchases (S; same day rule as above — the earlier `monthEnd: 20 / 18` of days 10 / 12 now count
  // from the 1st, the same date on the canonical load).
  { branch: 'ubon', monthDay: 10, cat: 'ค่าซื้อสินค้า/วัสดุของบริษัท', vendor: 'บจก. ไอทีซัพพลาย อีสาน', desc: 'อะไหล่และอุปกรณ์สำหรับงานติดตั้ง (สวิตช์ สายแลน หัวต่อ)', amount: 21400, docType: 'tax_invoice', taxStatus: 'received', docNo: 'ITS-{yy}{mm}-0172', purpose: 'customer_job', tax: { supplier: 'S_IT', vatMode: 'extract' } },
  { branch: 'ubon', monthDay: 12, cat: 'ค่าอุปกรณ์สำนักงาน', vendor: 'ร้านเครื่องเขียนมิตรภาพ', desc: 'เครื่องเขียนและกระดาษ (ใบกำกับภาษีอย่างย่อ)', amount: 535, docType: 'abbreviated_tax_invoice', taxStatus: 'received', docNo: 'AB-1188', purpose: 'company', tax: { supplier: 'S_SHOP', vatMode: 'extract' } },
  { branch: 'ubon', monthEnd: 15, cat: 'ค่าอุปกรณ์สำนักงาน', vendor: 'บจก. ออฟฟิศพลัส เซ็นเตอร์', desc: 'หมึกพิมพ์และอุปกรณ์สำนักงาน', amount: 3000, docType: 'tax_invoice', taxStatus: 'received', docNo: 'OP-{bey}{mm}{dd}', purpose: 'company', tax: { supplier: 'S_OFF', vatMode: 'add' } },
  { branch: 'ubon', monthEnd: 14, cat: 'ค่าน้ำมันเชื้อเพลิง', vendor: 'หจก. วารินปิโตรเลียม', desc: 'น้ำมันรถยนต์นั่งของผู้บริหาร (รถเก๋ง 5 ที่นั่ง)', amount: 1070, docType: 'receipt_tax_invoice', taxStatus: 'received', docNo: 'WP-{mm}1677', purpose: 'company', tax: { supplier: 'S_PUMP', vatMode: 'extract', claimable: false, reason: 'passenger_car' } },
  // ADR-024 `wht`: the company withheld tax when paying (payment date = expense date), issued a 50 ทวิ and
  // reports it in ภ.ง.ด.53 (juristic payee) / ภ.ง.ด.3 (individual) of that month; payee from Supplier Master.
  { branch: 'ubon', monthEnd: 5, cat: 'อื่น ๆ', vendor: 'บจก. คลาวด์โซลูชั่น ไทย', desc: 'ค่าบริการคลาวด์และสำรองข้อมูล (ใบกำกับภาษีมาถึงปลายเดือน — ใช้สิทธิ์เดือนถัดไป)', amount: 5350, docType: 'tax_invoice', taxStatus: 'received', docNo: 'CS-{ady}-{mm}{dd}', purpose: 'company', tax: { supplier: 'S_CLOUD', vatMode: 'extract', received: { monthEnd: 2 }, claimNextMonth: true }, wht: { supplier: 'S_CLOUD', incomeType: 'service' } },
  { branch: 'ubon', monthDay: 10, cat: 'ค่าเช่าสถานที่', vendor: 'นายสมศักดิ์ ใจงาม', desc: 'ค่าเช่าห้องเก็บสินค้า เดือน{month} (ผู้ให้เช่าเป็นบุคคลธรรมดา)', amount: 6000, docType: 'receipt', taxStatus: 'not_required', docNo: 'RC-{mm}{dd}', purpose: 'company', wht: { supplier: 'S_LAND', incomeType: 'rent', vatBasis: 'none' } },
  { branch: 'ubon', monthEnd: 10, cat: 'ค่าขนส่ง/จัดส่ง', vendor: 'หจก. อุบลขนส่งด่วน', desc: 'ค่าขนส่งสินค้าไปหน้างานลูกค้า (รอบเดือน{month})', amount: 2500, docType: 'receipt', taxStatus: 'not_required', docNo: 'UT-{yy}{mm}-031', purpose: 'delivery', wht: { supplier: 'S_TRANS', incomeType: 'transport', vatBasis: 'none' } }
]);

// ---------------------------------------------------------------- dates
function requireIsoDate(value) {
  const text = String(value || '').trim();
  const parts = parseBusinessDate(text);
  if (!parts || !/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`วันที่อ้างอิงของข้อมูลตัวอย่างไม่ถูกต้อง: ${value}`);
  return text;
}
function periodOf(isoDate) {
  const parts = parseBusinessDate(isoDate);
  return { year: parts.year, month: parts.month - 1 };
}
// R9.1 — the two clocks of the scenario (see "scenario" above).
// A row dated `offset` days back must be at least this old: S (below) starts at most 61 days before `today`
// (the 31st of a month, after a 31-day month), so such a row can never be part of S's tax figures.
export const RELATIVE_MIN_AGE_DAYS = 62;
// The story month S: the latest fully closed calendar month before `today` ('YYYY-MM'; January → December of
// the year before). Its ภ.พ.30 / ภ.ง.ด.3 / ภ.ง.ด.53 are the same on every load date.
export function demoSeedStoryPeriod(today) {
  return addTaxPeriods(taxPeriodOfDate(requireIsoDate(today)), -1);
}
const isInteger = value => typeof value === 'number' && Number.isInteger(value);
// Day of a calendar-pinned row: `monthDay` (1–28, from the 1st) or `monthEnd` (0–27 days before the last day) of
// month S + `storyMonth` (0 = S, −1 = the month before). Both ranges exist in every month, so the row never leaves it.
function storyMonthDate(today, anchor) {
  const storyMonth = anchor.storyMonth === undefined ? 0 : anchor.storyMonth;
  // 0 = S, −1 = the month before; −2 … −4 only for the multi-currency story (ADR-031), outside both tax months.
  if (![0, -1, -2, -3, -4].includes(storyMonth)) throw new Error(`ข้อมูลตัวอย่าง: storyMonth ต้องเป็น 0 ถึง -4 (${storyMonth})`);
  const period = addTaxPeriods(demoSeedStoryPeriod(today), storyMonth);
  const hasDay = anchor.monthDay !== undefined, hasEnd = anchor.monthEnd !== undefined;
  if (hasDay === hasEnd) throw new Error('ข้อมูลตัวอย่าง: ระบุ monthDay หรือ monthEnd อย่างใดอย่างหนึ่ง');
  if (hasDay) {
    if (!isInteger(anchor.monthDay) || anchor.monthDay < 1 || anchor.monthDay > 28) throw new Error(`ข้อมูลตัวอย่าง: monthDay ต้องเป็น 1–28 (${anchor.monthDay})`);
    return addBusinessCalendarDays(taxPeriodFirstDay(period), anchor.monthDay - 1);
  }
  if (!isInteger(anchor.monthEnd) || anchor.monthEnd < 0 || anchor.monthEnd > 27) throw new Error(`ข้อมูลตัวอย่าง: monthEnd ต้องเป็น 0–27 (${anchor.monthEnd})`);
  return addBusinessCalendarDays(taxPeriodLastDay(period), -anchor.monthEnd);
}
// `recent` rows: n days back, but never before the 1st of today's month (so never in S).
function recentDate(today, recent) {
  if (!isInteger(recent) || recent > 0) throw new Error(`ข้อมูลตัวอย่าง: recent ต้องเป็นจำนวนวันย้อนหลัง (${recent})`);
  const date = addBusinessCalendarDays(today, recent);
  const firstOfMonth = taxPeriodFirstDay(taxPeriodOfDate(today));
  return date < firstOfMonth ? firstOfMonth : date;
}
// Which clock a row uses: 'story' (pinned to S's calendar), 'recent' or 'relative' — exactly one per row.
function clockOf(spec) {
  const kinds = [spec.monthDay !== undefined || spec.monthEnd !== undefined ? 'story' : '', spec.recent !== undefined ? 'recent' : '', spec.offset !== undefined ? 'relative' : ''].filter(Boolean);
  if (kinds.length !== 1) throw new Error(`ข้อมูลตัวอย่าง ${spec.key || spec.docNo || spec.desc || ''}: ต้องมีวันที่แบบเดียว (offset / recent / monthDay / monthEnd)`);
  if (spec.storyMonth !== undefined && kinds[0] !== 'story') throw new Error(`ข้อมูลตัวอย่าง ${spec.key || spec.docNo || spec.desc || ''}: storyMonth ใช้กับ monthDay / monthEnd เท่านั้น`);
  return kinds[0];
}
// The business date of a scenario row (or of an anchor such as BILLING.paid / a credit note's voidedOn).
function specDate(spec, context) {
  const clock = clockOf(spec);
  if (clock === 'story') return storyMonthDate(context.today, spec);
  if (clock === 'recent') return recentDate(context.today, spec.recent);
  if (!isInteger(spec.offset) || spec.offset > 0) throw new Error(`ข้อมูลตัวอย่าง: offset ต้องเป็นจำนวนวันย้อนหลัง (${spec.offset})`);
  return context.dateAt(spec.offset);
}
// R9.1: supplier numbers / descriptions of the story rows name the row's own month (see EXPENSES).
function storyText(template, isoDate) {
  const parts = parseBusinessDate(isoDate);
  const pad = value => String(value).padStart(2, '0');
  const values = { yy: String(toBEYear(parts.year)).slice(-2), mm: pad(parts.month), dd: pad(parts.day), bey: String(toBEYear(parts.year)), ady: String(parts.year), month: TAX_CORE_TEXT.monthNames[parts.month - 1] };
  return String(template).replace(/\{(yy|mm|dd|bey|ady|month)\}/g, (match, name) => values[name]);
}
// Deterministic "created at" instant for a business date (10:00 Bangkok time).
function instantOf(isoDate) {
  return `${isoDate}T03:00:00.000Z`;
}

// ------------------------------------------------------------- numbering
// Same prefix as app.js documentNumberPrefix(): PREFIX + BE year (2 digits) + month (2 digits).
export function documentNumberPrefix(prefix, isoDate) {
  const { year, month } = periodOf(isoDate);
  return `${prefix}${String(toBEYear(year)).slice(-2)}${String(month + 1).padStart(2, '0')}`;
}

// Highest running number already stored per prefix-month, parsed with the same
// rules as the app: documents use PREFIX+yymm+digits (app.js documentNumberSequence),
// billing notes / payments use PREFIX+yymm[-]digits (erp-order-flow.js nextNumber).
const DOCUMENT_NUMBER_KINDS = Object.freeze([
  { collection: 'quotes', prefix: 'QT', separator: '' },
  { collection: 'invoices', prefix: 'INV', separator: '' },
  { collection: 'receipts', prefix: 'REC', separator: '' },
  { collection: 'creditNotes', prefix: 'CN', separator: '' },
  { collection: 'debitNotes', prefix: 'DN', separator: '' },
  { collection: 'billingNotes', prefix: 'BL', separator: '-' },
  { collection: 'payments', prefix: 'PAY', separator: '-' }
]);
export function collectNumberSequences(rowsByCollection = {}) {
  const highest = {};
  for (const kind of DOCUMENT_NUMBER_KINDS) {
    const pattern = kind.separator
      ? new RegExp(`^(${kind.prefix}\\d{4})-?(\\d+)$`, 'i')
      : new RegExp(`^(${kind.prefix}\\d{4})(\\d+)$`, 'i');
    for (const row of Array.isArray(rowsByCollection[kind.collection]) ? rowsByCollection[kind.collection] : []) {
      const match = pattern.exec(String(row?.no || row?.docNo || '').trim().toUpperCase());
      if (!match) continue;
      const key = match[1];
      highest[key] = Math.max(highest[key] || 0, Number(match[2]) || 0);
    }
  }
  return highest;
}

function createNumberAllocator(numberStart = {}) {
  const used = {};
  const current = key => Math.max(0, Math.trunc(Number(numberStart[key]) || 0)) + (used[key] || 0);
  return {
    // QT/INV/REC/CN/DN: 2-digit running number, like getNextDocumentNumber().
    document(prefix, isoDate) {
      const key = documentNumberPrefix(prefix, isoDate);
      used[key] = (used[key] || 0) + 1;
      return `${key}${String(current(key)).padStart(2, '0')}`;
    },
    // BL/PAY: "-0001" style, like erp-order-flow.js nextNumber().
    flow(prefix, isoDate) {
      const key = documentNumberPrefix(prefix, isoDate);
      used[key] = (used[key] || 0) + 1;
      return `${key}-${String(current(key)).padStart(4, '0')}`;
    },
    // Receipts created by buildPaymentReceiptDrafts() number themselves from a starting sequence.
    reserve(prefix, isoDate, count) {
      const key = documentNumberPrefix(prefix, isoDate);
      const start = current(key);
      used[key] = (used[key] || 0) + count;
      return { prefix: key, startingSequence: start };
    }
  };
}

// ------------------------------------------------------------ line items
function productByCode(code) {
  const product = PRODUCTS.find(row => row.code === code);
  if (!product) throw new Error(`ไม่พบสินค้าตัวอย่าง ${code}`);
  return product;
}
// Invoice row exactly as app.js getIItems() reads it (cost typed per unit).
function invoiceItem(code, qty, useVat) {
  const product = productByCode(code);
  const priceUnit = unitPriceForVatMode(product.defaultPrice, useVat);
  const costValue = product.standardCost;
  return {
    product: product.name,
    productCode: product.code,
    productCategory: product.category,
    flowType: product.flowType,
    fulfillmentType: product.fulfillmentType,
    qty,
    unit: product.unit,
    costMode: 'unit',
    costValue,
    salesOrderLineId: '',
    costAllocation: null,
    costUnit: costValue,
    costLump: 0,
    priceUnit,
    saleTotal: qty * priceUnit,
    costTotal: qty * costValue
  };
}
// Quotation row as getQItems() builds it (no pricing-rule snapshot for sample data).
function quoteItem(code, qty, useVat) {
  const product = productByCode(code);
  const priceUnit = unitPriceForVatMode(product.defaultPrice, useVat);
  return {
    product: product.name,
    productCode: product.code,
    productCategory: product.category,
    qty,
    unit: product.unit,
    priceUnit,
    total: qty * priceUnit,
    flowType: product.flowType,
    fulfillmentType: product.fulfillmentType,
    pricingRuleSnapshot: null
  };
}
// Receipt row as getRItems() reads a row copied from the invoice by fillFromInv().
function receiptItemFromInvoice(item) {
  return {
    product: item.product,
    productCode: item.productCode,
    productCategory: item.productCategory,
    qty: item.qty,
    unit: item.unit,
    priceUnit: item.priceUnit,
    saleTotal: item.qty * item.priceUnit,
    costUnit: item.costUnit,
    flowType: item.flowType,
    fulfillmentType: item.fulfillmentType
  };
}

// ------------------------------------------------------------- builders
function customerOf(key) {
  if (key === WALK_IN.key) return WALK_IN;
  const customer = CUSTOMERS.find(row => row.key === key);
  if (!customer) throw new Error(`ไม่พบลูกค้าตัวอย่าง ${key}`);
  return customer;
}
function customerFields(customer) {
  return {
    customer: customer.name,
    customerAddress: customer.address,
    customerTaxId: customer.taxId,
    contact: customer.contactPerson,
    phone: customer.phone,
    email: customer.email
  };
}
function agencyOf(customer) {
  return agencyFields(customer.agency, customer === WALK_IN ? '' : customer.name);
}
// R9.1: the invoice a receipt / credit note / debit note / billing refers to must already be issued on its date
// (events run in date order) — a scenario row dated before its invoice is refused, never a TypeError.
function issuedInvoiceState(context, invoiceKey, by) {
  const state = context.invoices.get(invoiceKey);
  if (!state) throw new Error(`ข้อมูลตัวอย่าง ${by}: ใบกำกับภาษี ${invoiceKey} ยังไม่ได้ออก ณ วันที่ของเอกสารนี้`);
  return state;
}
// { total, paid, credited, debited } → what the customer still owes (VAT-inclusive); a cancelled invoice owes
// nothing. A debit note raises the invoice's balance (ADR-024, ERPIntegrity.paymentSummary `debited`).
function outstandingOf(state) {
  if (state.cancelled) return 0;
  return roundMoneyValue(Math.max(0, state.total + (state.debited || 0) - state.credited - state.paid));
}

function buildQuote(spec, context) {
  const customer = customerOf(spec.customer);
  const date = specDate(spec, context);
  const { year, month } = periodOf(date);
  const items = spec.lines.map(([code, qty]) => quoteItem(code, qty, spec.useVat));
  const raw = items.reduce((sum, item) => sum + item.total, 0);
  const vat = calculateVatSummary(raw, spec.useVat);
  const version = context.businessRuleVersion;
  let record = {
    id: context.nextId(),
    no: context.numbers.document('QT', date),
    date,
    branch: spec.branch,
    ...customerFields(customer),
    ...agencyOf(customer),
    salesPerson: customer.salesPerson,
    items,
    subtotal: vat.subtotal,
    useVat: spec.useVat,
    vatMode: vat.vatMode,
    vatAmt: vat.vatAmt,
    total: vat.total,
    note: spec.note || '',
    attachments: [],
    approved: spec.approved,
    businessRuleVersion: version,
    businessRuleCode: `BR-${String(version).padStart(3, '0')}`
  };
  record = planQuoteDocumentAction({ draft: record, original: null, duplicateNumber: false, linkedDownstream: false }).record;
  return withThaiCalendarMeta(record, year, month);
}

function buildInvoice(spec, context) {
  const customer = customerOf(spec.customer);
  const date = specDate(spec, context);
  const { year, month } = periodOf(date);
  const taxInvoiceForm = spec.taxInvoiceForm || TAX_INVOICE_FORM_FULL;
  const items = spec.lines.map(([code, qty]) => invoiceItem(code, qty, spec.useVat));
  const rawSaleTotal = items.reduce((sum, item) => sum + item.saleTotal, 0);
  const costTotal = items.reduce((sum, item) => sum + item.costTotal, 0);
  const vat = calculateVatSummary(rawSaleTotal, spec.useVat);
  const walkIn = customer === WALK_IN;
  const commRate = walkIn ? 0 : COMMISSION_PERCENT;
  // Same (unrounded) commission / profit arithmetic as saveInvoiceUnlocked().
  const commAmt = vat.subtotal * commRate / 100;
  const creditTerm = customer.creditTerm;
  // A converted quotation is linked with the same fields the app's invoice save writes
  // (sourceQuote* on the invoice; the quote gets its invoiceId/invoiceNo stamp below).
  const quote = spec.quote ? context.quotes.get(spec.quote) : null;
  let record = {
    id: context.nextId(),
    no: context.numbers.document('INV', date),
    date,
    taxInvoiceForm,
    ...customerFields(customer),
    ...agencyOf(customer),
    // ADR-021: buyer สำนักงานใหญ่ / สาขาที่ copied from Customer Master exactly as the invoice form does
    // (buyerBranchFromContact: only with a tax ID; walk-in and abbreviated invoices store '').
    ...seedBuyerBranch(customer, walkIn || taxInvoiceForm !== TAX_INVOICE_FORM_FULL),
    salesPerson: customer.salesPerson,
    creditTerm,
    dueDate: invoiceTermDueDate(date, creditTerm),
    items,
    itemSaleTotal: vat.itemTotal,
    subtotal: vat.subtotal,
    useVat: spec.useVat,
    vatMode: vat.vatMode,
    vatAmt: vat.vatAmt,
    total: vat.total,
    saleTotal: vat.itemTotal,
    costTotal,
    commMode: 'percent',
    commRate,
    commAmt,
    profit: vat.subtotal - costTotal - commAmt,
    sourceProductionId: '',
    sourceProductionNo: '',
    sourceProductionBranch: '',
    sourceProductionYear: '',
    sourceProductionMonth: '',
    sourceProductionRawCostTotal: 0,
    sourceQuoteId: quote ? quote.id : '',
    sourceQuoteNo: quote ? quote.no : '',
    sourceQuoteBranch: quote ? quote.branch : '',
    sourceQuoteYear: quote ? quote.year : '',
    sourceQuoteMonth: quote ? quote.month : '',
    sourceQuoteFirebaseId: '',
    note: spec.note || '',
    attachments: [],
    costReviewRequired: false
  };
  Object.assign(record, { branch: spec.branch, sourceSalesOrderId: '', sourceSalesOrderNo: '', paymentManaged: true });
  // r13#LOW-5: a multi-month service period (the month-end pack's deferred-revenue suggestion).
  if (spec.servicePeriodMonths) Object.assign(record, { servicePeriodFrom: date, servicePeriodTo: addBusinessCalendarDays(seedAddMonths(date, spec.servicePeriodMonths), -1) });
  // r13#MED-3: the replacement prints "ออกแทนใบกำกับภาษีเลขที่ … ลงวันที่ …" (ข้อหารือ กค 0702(กม.05)/1041).
  if (spec.replaces) { const original = context.invoices.get(spec.replaces)?.record; if (!original || original.voided !== true) throw new Error(`ใบกำกับภาษีตัวอย่าง ${spec.key}: ฉบับที่ออกแทน ${spec.replaces} ต้องถูกยกเลิกก่อน`); Object.assign(record, { replacesNo: original.no, replacesDate: original.date, replacesId: String(original.id) }); }
  record = withThaiCalendarMeta(record, year, month);
  const plan = planInvoiceDocumentAction({ draft: record, original: null, duplicateNumber: false, paymentSummary: null });
  plan.warnings = plan.warnings.filter(text => text !== SERVICE_PERIOD_WARNING && text !== vatRateNotice(record.date)); // sample data on a late load date: the notice is the app's, not a seed error
  if (plan.warnings.length) throw new Error(`ใบกำกับภาษีตัวอย่าง ${spec.key} ไม่ผ่านการตรวจรูปแบบ: ${plan.warnings.join(' / ')}`);
  if (quote) {
    if (quote.branch !== spec.branch || quote.customer !== record.customer || !quote.approved) throw new Error(`ใบเสนอราคาตัวอย่าง ${spec.quote} ไม่ตรงกับใบกำกับภาษี ${spec.key}`);
    // Same stamp as the app's quote link (linkQuoteToChild / invoice save): the quote list shows "🚚 INV…".
    Object.assign(quote, { invoiceId: plan.record.id, invoiceNo: plan.record.no, invoiceStatus: 'created', workflowUpdatedAt: instantOf(date) });
  }
  if (spec.cancel) {
    // Cancelled the day it was issued, with the fields the cancel action writes (ADR-021): kept for the
    // number sequence, reported as "ยกเลิก – reason" with 0.00 in รายงานภาษีขาย.
    const reason = cancelReasonText('invoices', spec.cancel.code, spec.cancel.text);
    if (!reason.ok) throw new Error(`เหตุผลยกเลิกของใบกำกับภาษีตัวอย่าง ${spec.key} ไม่ถูกต้อง: ${reason.error}`);
    return applyDocumentCancel(plan.record, { at: instantOf(date), by: DEMO_SEED_ACTOR, reason: reason.reason, code: reason.code });
  }
  return plan.record;
}

// The same day n calendar months later (the 31st → the month's last day).
function seedAddMonths(iso, months) {
  const parts = parseBusinessDate(iso);
  const index = parts.year * 12 + parts.month - 1 + months;
  const year = Math.floor(index / 12), month = index - year * 12 + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(parts.day, last)).padStart(2, '0')}`;
}
function buildReceipt(spec, context) {
  const invoiceState = issuedInvoiceState(context, spec.invoice, spec.key);
  const invoice = invoiceState.record;
  const date = specDate(spec, context);
  const { year, month } = periodOf(date);
  const outstanding = outstandingOf(invoiceState);
  // Full payment copies the invoice rows (fillFromInv on an unpaid invoice); a partial
  // payment is one "รับชำระ" row, the same row fillFromInv uses once money was received.
  const partial = spec.kind === 'partial';
  const items = partial
    ? [{ product: `รับชำระบางส่วนตามบิล ${invoice.no}`, productCode: '', productCategory: 'อื่น ๆ', qty: 1, unit: 'ครั้ง', priceUnit: spec.amount, saleTotal: spec.amount, costUnit: 0, flowType: 'non_inventory', fulfillmentType: 'made_to_order' }]
    : invoice.items.map(receiptItemFromInvoice);
  const useVat = partial ? (Number(invoice.vatAmt) > 0 ? 0 : 2) : Number(invoice.useVat);
  const rawSaleTotal = items.reduce((sum, item) => sum + item.saleTotal, 0);
  const costTotal = items.reduce((sum, item) => sum + (item.costUnit || 0) * (item.qty || 0), 0);
  const vat = calculateVatSummary(rawSaleTotal, useVat);
  const commRate = partial ? 0 : Number(invoice.commRate) || 0;
  const commAmt = vat.subtotal * commRate / 100;
  const wht = calculateWhtSummary(vat.subtotal, spec.whtRate || 0, vat.total);
  const customer = customerOf(context.invoiceSpecs.get(spec.invoice).customer);
  let record = {
    id: context.nextId(),
    no: context.numbers.document('REC', date),
    date,
    invNo: invoice.no,
    invoiceId: invoice.id,
    invoiceBranch: invoice.branch,
    invoiceYear: invoice.year,
    invoiceMonth: invoice.month,
    // The receipt form always carries the invoice's customer name (also for walk-in sales).
    ...agencyFields(customer.agency, invoice.customer),
    salesPerson: invoice.salesPerson,
    customer: invoice.customer,
    customerAddress: invoice.customerAddress,
    customerTaxId: invoice.customerTaxId,
    customerBranchCode: invoice.customerBranchCode || '',
    customerBranchName: invoice.customerBranchName || '',
    contact: invoice.contact,
    phone: invoice.phone,
    email: invoice.email,
    items,
    itemSaleTotal: vat.itemTotal,
    subtotal: vat.subtotal,
    useVat,
    vatMode: vat.vatMode,
    vatAmt: vat.vatAmt,
    total: vat.total,
    saleTotal: vat.itemTotal,
    costTotal,
    commMode: 'percent',
    commRate,
    commAmt,
    profit: vat.subtotal - costTotal - commAmt,
    whtRate: wht.whtRate,
    whtBase: wht.whtBase,
    whtAmount: wht.whtAmount,
    cashReceived: wht.cashReceived,
    // Certificate number format of the payer's own book (เล่มที่/เลขที่), deterministic per date.
    whtCertNo: wht.whtAmount > 0 ? `${String(toBEYear(year))}/${String(month + 1).padStart(2, '0')}-0457` : '',
    whtCertReceived: wht.whtAmount > 0 ? !!spec.whtCertReceived : false,
    note: spec.note || '',
    attachments: []
  };
  record = withThaiCalendarMeta({ ...record, branch: invoice.branch, paymentManaged: true }, year, month);
  const plan = planReceiptDocumentAction({ draft: record, original: null, duplicateNumber: false, referenceInvoice: invoice, paymentSummary: { outstanding } });
  invoiceState.paid = roundMoneyValue(invoiceState.paid + record.total);
  return plan.record;
}

function buildCreditNote(spec, context) {
  const invoiceState = issuedInvoiceState(context, spec.invoice, spec.key);
  const invoice = invoiceState.record;
  const date = specDate(spec, context);
  const { year, month } = periodOf(date);
  const returnItems = (spec.returns || []).map(([code, qty]) => {
    const row = invoice.items.find(item => item.productCode === code);
    return { invoiceId: invoice.id, invoiceNo: invoice.no, invoiceBranch: invoice.branch, productCode: row.productCode, product: row.product, unit: row.unit, qty };
  });
  // Returned goods: reduce by the returned quantity at the invoice unit price
  // (the invoice's own VAT basis); other reasons carry an explicit difference.
  const differenceAmount = spec.returns
    ? roundMoneyValue(returnItems.reduce((sum, item) => sum + item.qty * invoice.items.find(row => row.productCode === item.productCode).priceUnit, 0))
    : spec.difference;
  const draft = {
    id: undefined,
    no: context.numbers.document('CN', date),
    date,
    branch: invoice.branch,
    customer: invoice.customer,
    customerAddress: invoice.customerAddress,
    customerTaxId: invoice.customerTaxId,
    // Buyer head office / branch exactly as the credit-note form fills it from Customer Master.
    customerBranch: creditNoteBuyerBranchLabel(contactOf(context.invoiceSpecs.get(spec.invoice).customer)),
    reasonCode: spec.reasonCode,
    reasonText: '',
    note: spec.note || '',
    lines: [{ invoiceId: invoice.id, invoiceNo: invoice.no, invoiceBranch: invoice.branch, differenceAmount }],
    returnItems
  };
  // Validated against every seeded invoice and credit note, like the save path does.
  const invoices = [...context.invoices.values()].map(state => ({ ...state.record, _branch: state.record.branch, _year: state.record.year, _month: state.record.month }));
  const validation = validateCreditNote(draft, invoices, context.creditNotes, [], {
    paidByInvoice: row => context.invoices.get(context.invoiceKeyById.get(String(row.id))).paid,
    debitNotes: context.debitNotes
  });
  if (!validation.ok) throw new Error(`ใบลดหนี้ตัวอย่าง ${spec.key} ไม่ผ่านการตรวจ: ${validation.errors.join(' / ')}`);
  const at = instantOf(date);
  const base = buildCreditNoteRecord(draft, validation, { id: context.nextId(), at, createdBy: DEMO_SEED_ACTOR, user: DEMO_SEED_ACTOR });
  let record = withThaiCalendarMeta({ ...base, editCount: 0 }, year, month);
  if (spec.voidedOn !== undefined) {
    // Same fields the credit-note void action writes (erp-credit-note.js voidUnlocked()).
    const voidDate = specDate(spec.voidedOn, context);
    if (voidDate < date) throw new Error(`ใบลดหนี้ตัวอย่าง ${spec.key} ถูกยกเลิกก่อนวันที่ออก (${voidDate} < ${date})`);
    const voidAt = instantOf(voidDate);
    record = { ...record, voided: true, status: 'voided', voidedAt: voidAt, voidedBy: DEMO_SEED_ACTOR, voidReason: spec.voidReason, updatedAt: voidAt };
  } else {
    invoiceState.credited = roundMoneyValue(invoiceState.credited + record.total);
  }
  context.creditNotes.push({ ...record, branch: record.branch, _branch: record.branch });
  return record;
}

// ADR-024: a debit note through the same validator / builder as the debit-note form (erp-debit-note.js).
function buildDebitNote(spec, context) {
  const invoiceState = issuedInvoiceState(context, spec.invoice, spec.key);
  const invoice = invoiceState.record;
  const date = specDate(spec, context);
  const { year, month } = periodOf(date);
  const buyer = debitNoteBuyerBranchOf(invoice, contactOf(context.invoiceSpecs.get(spec.invoice).customer));
  const draft = {
    no: context.numbers.document('DN', date),
    date,
    branch: invoice.branch,
    customer: invoice.customer,
    customerAddress: invoice.customerAddress,
    customerTaxId: invoice.customerTaxId,
    customerBranchCode: buyer.code,
    customerBranch: buyer.label,
    reasonCode: spec.reasonCode,
    reasonText: '',
    note: spec.note || '',
    lines: [{ invoiceId: invoice.id, invoiceNo: invoice.no, invoiceBranch: invoice.branch, increaseAmount: spec.increase }]
  };
  const invoices = [...context.invoices.values()].map(state => ({ ...state.record, _branch: state.record.branch, _year: state.record.year, _month: state.record.month }));
  const validation = validateDebitNote(draft, invoices, context.debitNotes, context.creditNotes);
  if (!validation.ok) throw new Error(`ใบเพิ่มหนี้ตัวอย่าง ${spec.key} ไม่ผ่านการตรวจ: ${validation.errors.join(' / ')}`);
  const at = instantOf(date);
  const record = withThaiCalendarMeta(buildDebitNoteRecord(draft, validation, { id: context.nextId(), at, createdBy: DEMO_SEED_ACTOR, user: DEMO_SEED_ACTOR }), year, month);
  invoiceState.debited = roundMoneyValue((invoiceState.debited || 0) + record.total);
  context.debitNotes.push({ ...record, branch: record.branch, _branch: record.branch });
  return record;
}

// Invoice view the billing / payment builders expect (financeInvoiceSnapshot in erp-order-flow.js).
function financeSnapshot(state) {
  const invoice = state.record;
  return { ...invoice, branch: invoice.branch, year: invoice.year, month: invoice.month, outstanding: outstandingOf(state), receiptPaidAtCreation: roundMoneyValue(state.paid) };
}

function buildBillingAndPayment(spec, context) {
  const states = spec.invoices.map(key => issuedInvoiceState(context, key, spec.key));
  const billingDate = specDate(spec.billed, context);
  const paymentDate = specDate(spec.paid, context);
  if (paymentDate < billingDate) throw new Error(`การรับชำระตัวอย่าง ${spec.key} ลงวันที่ก่อนใบวางบิล`);
  const billingCreatedAt = instantOf(billingDate);
  const billing = buildBillingAction({
    id: `bill_demo_seed_${spec.key.toLowerCase()}`,
    no: context.numbers.flow('BL', billingDate),
    billingDate,
    appointmentDate: '',
    dueDate: '',
    recipient: spec.recipient,
    note: spec.note,
    createdAt: billingCreatedAt,
    invoices: states.map(financeSnapshot),
    existingBillingNotes: []
  });
  const activity = { id: `act_demo_seed_${spec.key.toLowerCase()}`, action: 'billing_created', at: billingCreatedAt, billingId: billing.id, billingNo: billing.no };
  const amount = roundMoneyValue(states.reduce((sum, state) => sum + outstandingOf(state), 0));
  const plan = planBillingPaymentAction({
    billing,
    invoiceStates: states.map(financeSnapshot),
    existingPayments: [],
    amount,
    id: `pay_demo_seed_${spec.key.toLowerCase()}`,
    no: context.numbers.flow('PAY', paymentDate),
    date: paymentDate,
    method: spec.method,
    createdAt: instantOf(paymentDate)
  });
  const payment = plan.payment;
  Object.assign(billing, plan.billingPatch);
  // One printable receipt per settled invoice, numbered in the REC sequence of the payment month.
  const { year, month } = periodOf(paymentDate);
  const numbering = context.numbers.reserve('REC', paymentDate, payment.allocations.length);
  const firstId = context.nextId();
  for (let index = 1; index < payment.allocations.length; index += 1) context.nextId();
  const { receipts } = buildPaymentReceiptDrafts({
    payment,
    invoiceStates: states.map(financeSnapshot),
    receiptPrefix: numbering.prefix,
    startingSequence: numbering.startingSequence,
    idSeed: firstId,
    year,
    month,
    createdAt: instantOf(paymentDate)
  });
  payment.receiptNos = receipts.map(receipt => receipt.no);
  payment.allocations.forEach(allocation => {
    const state = states.find(row => String(row.record.id) === String(allocation.invoiceId));
    state.paid = roundMoneyValue(state.paid + allocation.amount);
  });
  return { billing, payment, activity, receipts };
}

function supplierOf(key) {
  const supplier = SUPPLIERS.find(row => row.key === key);
  if (!supplier) throw new Error(`ไม่พบผู้จำหน่ายตัวอย่าง ${key}`);
  return supplier;
}
// The purchase-tax fields the expense form sends for a tax-invoice expense (ADR-023), from Supplier Master.
function expenseTaxDraft(spec, date, context) {
  if (!spec.tax) return {};
  const supplier = supplierOf(spec.tax.supplier);
  if (supplier.name !== spec.vendor) throw new Error(`ผู้ขายของค่าใช้จ่ายตัวอย่าง ${spec.docNo} ไม่ตรงกับ Supplier Master`);
  const received = spec.tax.received !== undefined ? specDate(spec.tax.received, context) : date;
  if (received < date) throw new Error(`ใบกำกับภาษีซื้อตัวอย่าง ${spec.docNo} ได้รับก่อนวันที่ออก`);
  const claimable = spec.tax.claimable !== false && spec.docType !== 'abbreviated_tax_invoice';
  const receivedPeriod = taxPeriodOfDate(received);
  return {
    vatMode: spec.tax.vatMode, vendorId: supplier.id, vendorTaxId: supplier.taxId, vendorBranchCode: supplier.branchCode, vendorAddress: supplier.address,
    taxInvoiceDate: date, taxInvoiceReceivedDate: received,
    claimPeriod: claimable ? (spec.tax.claimNextMonth ? addTaxPeriods(receivedPeriod, 1) : receivedPeriod) : '',
    inputVatClaimable: claimable, nonClaimableReason: claimable ? '' : (spec.tax.reason || ''),
    // r13#LOW-3: a later claim month needs a reason of ประกาศฯ ฉบับที่ 4 (received at month end, books already closed).
    lateClaimReason: claimable && spec.tax.claimNextMonth ? 'trade_custom' : ''
  };
}
// ADR-024: the withholding fields the expense form sends (payee from Supplier Master, rate from the income type).
function expenseWhtDraft(spec) {
  if (!spec.wht) return {};
  const supplier = supplierOf(spec.wht.supplier);
  if (supplier.name !== spec.vendor) throw new Error(`ผู้รับเงินของค่าใช้จ่ายตัวอย่าง ${spec.docNo} ไม่ตรงกับ Supplier Master`);
  return {
    whtEnabled: true, whtIncomeType: spec.wht.incomeType, whtCondition: 1, payeeEntityType: whtPayeeEntityOf(supplier),
    // r8fix#A1: without a tax invoice the form asks whether the amount includes VAT — both payees are not VAT-registered.
    whtVatBasis: spec.wht.vatBasis || '',
    payeeName: supplier.name, payeeTaxId: supplier.taxId, payeeBranchCode: supplier.entityType === 'company' ? supplier.branchCode : '', payeeAddress: supplier.address
  };
}
// The 50 ทวิ of a seeded payment, numbered like ERPPayerWht.attachCertificate (per establishment + พ.ศ. book).
function buildSeedWhtCertificate(expense, context) {
  const bookNo = whtCertificateBookOf(expense.date);
  const certNo = nextWhtCertificateNumber(context.whtCertificates, expense.branch, bookNo);
  const cert = buildWhtCertificate({ expense, branch: expense.branch, payer: context.payer(expense.branch), bookNo, certNo, id: `wht-${expense.id}`, at: instantOf(expense.date), by: DEMO_SEED_ACTOR });
  context.whtCertificates.push(cert);
  return cert;
}
function buildExpense(spec, context) {
  const date = specDate(spec, context);
  const { year, month } = periodOf(date);
  const record = withThaiCalendarMeta({
    id: context.nextId(),
    date,
    branch: spec.branch,
    cat: spec.cat,
    vendor: spec.vendor,
    desc: storyText(spec.desc, date),
    amount: spec.amount,
    by: 'ฝ่ายบัญชี',
    docType: spec.docType,
    taxStatus: spec.taxStatus,
    docNo: storyText(spec.docNo, date),
    purpose: spec.purpose,
    note: '',
    attachments: [],
    ...expenseTaxDraft(spec, date, context),
    ...expenseWhtDraft(spec)
  }, year, month);
  const plan = planExpenseDocumentAction({ draft: record, duplicateDocument: false });
  if (spec.wht && !(Number(plan.record.whtAmount) > 0)) throw new Error(`ค่าใช้จ่ายตัวอย่าง ${spec.docNo} ไม่มียอดหักภาษี ณ ที่จ่าย`);
  return plan.record;
}

// ---------------------------------------------------------------- ADR-031: the multi-currency story
// Pinned to the calendar of S−3 / S−2 (three and two months before the story month S), so the ภ.พ.30 / ภ.ง.ด. story of S
// and of the month before S — and the receivables open today — do not change. The export invoice is dated 4 days before
// the last day of S−3 and its first receipt on the last day: the only baht invoice that can fall into S−3 (U0, 130 days
// back) is always earlier, so no baht document's running number moves (receipts / payments of S−3 are only these). Rates are SAMPLE rates (not real Bank of
// Thailand figures), stored in the rate table with source 'demo'. Hand-worked figures (tests/r13b-fx-app.test.cjs):
//   USD export invoice (0 %, goods): 5 × USD 600.00 = USD 3,000.00 at the BOT average buying rate 32.6543 of the business
//     day before the invoice day's announcement → 3,000 × 32.6543 = 97,962.90 baht (stored once; cost 5 × 11,800 = 59,000).
//   Partial receipt USD 1,000.00 at the bank's actual rate 33.1000 → 33,100.00 baht in the bank; carrying settled
//     97,962.90 × 1,000 ÷ 3,000 = 32,654.30 → realised gain 445.70 (4210). Open USD 2,000.00 carrying 65,308.60.
//   Month end of S−3: open USD 2,000.00 × 33.0000 (BOT average buying of the last business day) = 66,000.00 → unrealised
//     gain 691.40 on the month's last day (4220), reversed on day 1 of S−2. Export value (ป.132/2548, mixed): sold in the
//     month 33,100.00 + rest USD 2,000.00 × 33.0000 = 66,000.00 → 99,100.00 baht on ภ.พ.30 line 2 of S−3 (books keep 97,962.90).
//   Final receipt USD 2,000.00 at 32.8000 → 65,600.00; settles 65,308.60 → realised gain 291.40. Total realised
//     445.70 + 291.40 = 737.10 = (33,100.00 + 65,600.00) − 97,962.90.
//   JPY service from Japan: JPY 120,000 at the BOT average selling rate 22.3456 / 100 → 26,814.72 baht payable.
//   Payment of JPY 120,000 (selling 22.5011 / 100) with the tax borne by the company (gross-up, ภ.ง.ด.54 15 % — to be
//     confirmed; a tax treaty may lower it): cash 1,200 × 22.5011 = 27,001.32 · income 27,001.32 × 100 ÷ 85 = 31,766.26 ·
//     tax 4,764.94 (5410) · realised loss 26,814.72 − 27,001.32 = −186.60 (5420) · ภ.พ.36 VAT 7 % × 31,766.26 = 2,223.64,
//     claimed as input VAT in the month after the payment (S−2).
export const DEMO_FX_SOURCE_NOTE = 'ข้อมูลตัวอย่าง: อัตราสมมติเพื่อสาธิต ไม่ใช่อัตรา ธปท. จริง';
const DEMO_FX_ALLOWED = Object.freeze(['USD', 'EUR', 'JPY']);
// The rates of today's lookup day (a live sale / receipt / payment during the demo needs them).
const DEMO_FX_TODAY_RATES = Object.freeze([['USD', 'bot_avg_buying', '32.912'], ['USD', 'bot_avg_selling', '33.2846'], ['EUR', 'bot_avg_buying', '38.1025'], ['EUR', 'bot_avg_selling', '38.771'], ['JPY', 'bot_avg_buying', '21.953'], ['JPY', 'bot_avg_selling', '22.487']]);
const DEMO_FX_CUSTOMER = Object.freeze({ name: 'Mekong Digital Trading Co., Ltd.', address: 'Lane Xang Avenue, Chanthabouly District, Vientiane Capital, Lao PDR', country: 'สปป.ลาว' });
const DEMO_FX_SUPPLIER = Object.freeze({ name: 'Sakura Cloud Systems K.K.', address: '2-1 Marunouchi, Chiyoda-ku, Tokyo, Japan', country: 'ญี่ปุ่น' });
export const DEMO_FX_STORY = Object.freeze({
  invoice: Object.freeze({ key: 'FX1', branch: 'ubon', storyMonth: -3, monthEnd: 4, currency: 'USD', rate: '32.6543', lines: [['DEMO-CC01', 5, '600']], exportDeclarationNo: 'A001-{ady}{mm}-04512', creditTerm: 'credit30', note: 'ส่งออกชุดกล้องวงจรปิดไป สปป.ลาว (ราคา FOB หนองคาย)' }),
  receipts: Object.freeze([
    Object.freeze({ key: 'FXR1', storyMonth: -3, monthEnd: 0, amountFx: '1000', rate: '33.1', note: 'ลูกค้าโอน USD งวดแรก ธนาคารรับซื้อเงินตราตามอัตราจริง' }),
    Object.freeze({ key: 'FXR2', storyMonth: -2, monthDay: 10, amountFx: '2000', rate: '32.8', note: 'ลูกค้าโอน USD ส่วนที่เหลือ' })
  ]),
  monthEndRate: '33',
  expense: Object.freeze({ key: 'FXE1', branch: 'ubon', storyMonth: -3, monthDay: 5, currency: 'JPY', amountFx: '120000', rate: '22.3456', cat: 'อื่น ๆ', desc: 'ค่าบริการระบบคลาวด์สำรองข้อมูล (ผู้ให้บริการในญี่ปุ่น) รายปี', docNo: 'SCS-INV-{ady}{mm}-118' }),
  payment: Object.freeze({ key: 'FXP1', storyMonth: -3, monthDay: 15, amountFx: '120000', rate: '22.5011', incomeType: 'service', whtRate: 15, grossUp: true, note: 'โอนเงินไปญี่ปุ่น บริษัทออกภาษีหัก ณ ที่จ่ายให้ (ภ.ง.ด.54) และนำส่ง ภ.พ.36' })
});
// A sample rate row (append-only store, source 'demo'); the same (currency, date, type) twice must carry the same rate.
function demoFxAddRate(state, currency, type, date, rate) {
  const existing = fxRateRow(state.store, currency, date, type);
  if (existing) {
    if (existing.rate !== rate) throw new Error(`อัตราตัวอย่าง ${currency} ${type} ${date} ซ้ำกันแต่ค่าไม่ตรงกัน (${existing.rate} / ${rate})`);
    return existing;
  }
  const result = planFxRateEntry(state.store, { currency, type, date, rate, source: 'demo', sourceNote: DEMO_FX_SOURCE_NOTE, demoSeed: true, demoSeedBatch: DEMO_SEED_BATCH_ID }, { today: state.today, at: instantOf(date), by: DEMO_SEED_ACTOR });
  if (!result.ok) throw new Error(`อัตราตัวอย่าง ${currency} ${type} ${date}: ${result.key}`);
  state.store = result.store;
  return result.row;
}
// The rate a document of `date` looks up (the app's own rule), stored first when the sample has not stored it yet.
function demoFxLookup(state, currency, type, date, rate) {
  const rule = fxRateDateFor(date, type);
  if (!rule.rateDate) throw new Error(`ข้อมูลตัวอย่างหลายสกุลเงิน: หาวันที่ของอัตรา ${date} ไม่ได้`);
  demoFxAddRate(state, currency, type, rule.rateDate, rate);
  const lookup = lookupFxRate(state.store, { currency, date, type });
  if (!lookup.ok) throw new Error(`ข้อมูลตัวอย่างหลายสกุลเงิน: ไม่พบอัตรา ${currency} ${date}`);
  return lookup;
}
const demoFxRelated = (context, invoiceRecord) => ({ receipts: context.fxReceipts.filter(row => String(row.invoiceId) === String(invoiceRecord.id)), creditNotes: [], debitNotes: [] });
// The export invoice's date: 4 days before the end of S−3 — or, when a baht invoice dated from today (K1, 92 days back,
// on load days 1–3) falls later in that month but before its last day, that day (the export invoice is then numbered
// after it). So no baht invoice's running number ever moves. (If K1 is ON the last day, the export invoice stays 4 days
// before: it may not share the month-end rate day, which the revaluation needs.)
function demoFxInvoiceDate(spec, context) {
  const base = specDate(spec, context);
  const lastDay = taxPeriodLastDay(taxPeriodOfDate(base));
  const later = demoFxLaterBahtInvoices(base, context);
  return later.length && !demoFxSharesMonthEndRate(later[later.length - 1], lastDay) ? later[later.length - 1] : base;
}
// Dates of baht invoices dated from today that fall after `base` in its month.
function demoFxLaterBahtInvoices(base, context) {
  return [...context.invoiceSpecs.values()].filter(row => clockOf(row) === 'relative').map(row => specDate(row, context)).filter(date => date > base && taxPeriodOfDate(date) === taxPeriodOfDate(base)).sort();
}
// A sale on `date` would use the same BOT rate day as the month-end revaluation (no difference to show).
const demoFxSharesMonthEndRate = (date, lastDay) => date === lastDay || fxRateDateFor(date, 'bot_avg_buying').rateDate === fxRateDateFor(lastDay, 'bot_avg_buying').rateDate;
function buildDemoFxInvoice(spec, context, state) {
  const date = demoFxInvoiceDate(spec, context);
  const { year, month } = periodOf(date);
  const lookup = demoFxLookup(state, spec.currency, 'bot_avg_buying', date, spec.rate);
  const items = spec.lines.map(([code, qty, priceFx]) => {
    const product = productByCode(code);
    return { product: product.name, productCode: product.code, productCategory: product.category, flowType: product.flowType, fulfillmentType: product.fulfillmentType, qty, unit: product.unit, priceFx, costMode: 'unit', costValue: product.standardCost, costUnit: product.standardCost, costLump: 0, costTotal: qty * product.standardCost, salesOrderLineId: '', costAllocation: null };
  });
  // The same stored shape as the screen หลายสกุลเงิน → ขายเป็นเงินตราต่างประเทศ (erp-fx.js saleRecord) — then the invoice planner.
  const draft = withThaiCalendarMeta({
    id: context.nextId(), no: context.numbers.document('INV', date), date, branch: spec.branch,
    customer: DEMO_FX_CUSTOMER.name, customerAddress: DEMO_FX_CUSTOMER.address, customerTaxId: '', customerCountry: DEMO_FX_CUSTOMER.country, contact: '', phone: '', email: '',
    customerAgencyGroup: 'other', customerAgencyGroupLabel: 'อื่น ๆ / ไม่ระบุ', customerAgencyType: 'other', customerAgencyTypeLabel: 'อื่น ๆ / ไม่ระบุ', customerPrefix: '', customerBranchCode: '', customerBranchName: '', salesPerson: 'สมชาย ใจดี',
    items, useVat: 2, vatMode: 'none', note: spec.note, attachments: [], currency: spec.currency, ...fxRateFieldsOf(lookup),
    taxInvoiceForm: TAX_INVOICE_FORM_FULL, creditTerm: spec.creditTerm, dueDate: invoiceTermDueDate(date, spec.creditTerm), vatCategory: 'zero', commMode: 'manual', commRate: 0, commAmt: 0, paymentManaged: true, createdAt: instantOf(date),
    exportKind: 'goods', exportDeclarationNo: storyText(spec.exportDeclarationNo, date), exportDate: date,
    // Not from a quotation / production / Sales Order (the same empty links as every other sample invoice).
    sourceProductionId: '', sourceProductionNo: '', sourceProductionBranch: '', sourceProductionYear: '', sourceProductionMonth: '', sourceProductionRawCostTotal: 0,
    sourceQuoteId: '', sourceQuoteNo: '', sourceQuoteBranch: '', sourceQuoteYear: '', sourceQuoteMonth: '', sourceQuoteFirebaseId: '', sourceSalesOrderId: '', sourceSalesOrderNo: '', costReviewRequired: false
  }, year, month);
  const plan = planInvoiceDocumentAction({ draft, original: null, duplicateNumber: false, paymentSummary: null, fx: { allowedCurrencies: [...DEMO_FX_ALLOWED], approval: null } });
  const warnings = plan.warnings.filter(text => text !== vatRateNotice(date));
  if (warnings.length) throw new Error(`ใบกำกับสินค้าส่งออกตัวอย่าง ${spec.key} ไม่ผ่านการตรวจ: ${warnings.join(' / ')}`);
  return withThaiCalendarMeta(plan.record, year, month);
}
function buildDemoFxReceipt(spec, invoiceRecord, context, state) {
  const date = specDate(spec, context);
  const { year, month } = periodOf(date);
  const lookup = demoFxLookup(state, invoiceRecord.currency, 'actual', date, spec.rate);
  const plan = planFxReceipt({ invoice: invoiceRecord, related: demoFxRelated(context, invoiceRecord), date, amountFx: spec.amountFx, ...fxRateFieldsOf(lookup) });
  const record = withThaiCalendarMeta(fxReceiptRecord(invoiceRecord, plan, lookup, { id: context.nextId(), no: context.numbers.document('REC', date), date, note: spec.note, createdAt: instantOf(date) }), year, month);
  // The receipt planner of the receipt form checks it against the invoice's open baht (as the screen does).
  const opened = fxInvoiceOpenItem(invoiceRecord, demoFxRelated(context, invoiceRecord));
  planReceiptDocumentAction({ draft: record, original: null, duplicateNumber: false, referenceInvoice: invoiceRecord, paymentSummary: { outstanding: fxSatangToBaht(opened.openThb) } });
  return record;
}
function buildDemoFxExpense(spec, context, state) {
  const date = specDate(spec, context);
  const { year, month } = periodOf(date);
  const lookup = demoFxLookup(state, spec.currency, 'bot_avg_selling', date, spec.rate);
  const minor = toMinorUnits(spec.amountFx, spec.currency);
  const amount = fxSatangToBaht(convertToSatang(minor, spec.currency, lookup.rate, lookup.per));
  // As erp-fx.js saveExpense: a supplier invoice from abroad (no Thai tax invoice), payable in the currency.
  const plan = planExpenseDocumentAction({ draft: withThaiCalendarMeta({ id: context.nextId(), date, branch: spec.branch, cat: spec.cat, desc: spec.desc, amount, vendor: DEMO_FX_SUPPLIER.name, docType: 'invoice', taxStatus: 'not_required', purpose: 'company', docNo: storyText(spec.docNo, date), attachments: [], createdAt: instantOf(date) }, year, month), duplicateDocument: false });
  return { ...plan.record, currency: spec.currency, ...fxRateFieldsOf(lookup), amountFx: minorToMajor(minor, spec.currency), amountThb: amount, payeeCountry: DEMO_FX_SUPPLIER.country, payeeAddress: DEMO_FX_SUPPLIER.address, fxPayments: [] };
}
function buildDemoFxPayment(spec, expense, context, state) {
  const date = specDate(spec, context);
  const lookup = demoFxLookup(state, expense.currency, 'bot_avg_selling', date, spec.rate);
  const wht = { enabled: true, incomeType: spec.incomeType, rate: spec.whtRate, grossUp: spec.grossUp, payeeName: DEMO_FX_SUPPLIER.name, payeeCountry: DEMO_FX_SUPPLIER.country, payeeAddress: DEMO_FX_SUPPLIER.address, payeeTaxRef: '', dtaNote: 'อนุสัญญาภาษีซ้อนไทย–ญี่ปุ่น อาจลดอัตรา — ต้องยืนยันกับผู้เชี่ยวชาญ' };
  const plan = planFxPayment({ record: expense, kind: 'expense', date, amountFx: spec.amountFx, ...fxRateFieldsOf(lookup), wht, pp36: { enabled: true } });
  const { year, month } = periodOf(date);
  const no = `FXP${String(toBEYear(year)).slice(-2)}${String(month + 1).padStart(2, '0')}01`; // erp-fx.js nextPaymentNo: FXP + yymm + 2 digits
  const row = fxPaymentRecord(plan, { id: `fxp-demo-${spec.key.toLowerCase()}`, no, date, branch: expense.branch, ...fxRateFieldsOf(lookup), note: spec.note, createdAt: instantOf(date), createdBy: DEMO_SEED_ACTOR, demoSeed: true, demoSeedBatch: DEMO_SEED_BATCH_ID });
  expense.fxPayments = normalizeFxPayments([...expense.fxPayments, row], expense.docNo);
  return row;
}
// The month-end close of S−3 (export value + revaluation), as erp-fx.js closeMonth posts it.
function buildDemoFxClose(period, context, state) {
  const story = DEMO_FX_STORY;
  const lastDay = taxPeriodLastDay(period);
  // If the last days of the month are all non-business days the month-end rate day can be the invoice's rate day: the
  // stored rate of that day is then used (one rate per day and type — never two values).
  const rule = fxRateDateFor(lastDay, 'bot_avg_buying');
  if (!fxRateRow(state.store, story.invoice.currency, rule.rateDate, 'bot_avg_buying')) demoFxLookup(state, story.invoice.currency, 'bot_avg_buying', lastDay, story.monthEndRate);
  const invoices = [...context.fxInvoices];
  const plan = planFxMonthEnd({ period, invoices, receipts: context.fxReceipts.filter(row => row.date <= lastDay), creditNotes: [], debitNotes: [], expenses: context.fxExpenses, goodsReceipts: [], rates: state.store });
  if (plan.missing.length) throw new Error(`ข้อมูลตัวอย่างหลายสกุลเงิน: ขาดอัตราปิดเดือน ${plan.missing.map(row => `${row.currency} ${row.rateDate}`).join(', ')}`);
  const close = { id: `fxc-${period}-demo`, period, date: plan.date, reverseDate: plan.reverseDate, method: 'reverse', status: 'posted', createdAt: instantOf(plan.reverseDate), createdBy: DEMO_SEED_ACTOR, rows: plan.rows, exportValues: plan.exportValues, demoSeed: true, demoSeedBatch: DEMO_SEED_BATCH_ID };
  for (const value of plan.exportValues) {
    const invoice = invoices.find(row => String(row.id) === value.invoiceId);
    if (invoice) invoice.exportVat = { ...value, closeId: close.id, fixedAt: close.createdAt };
  }
  return { close, plan };
}
// The events of the story, merged into buildDemoSeedPlan's date-ordered event list.
// On the few load dates where a baht invoice dated from today falls in the last days of S−3 so late that a sale after it
// would share the month-end rate day (K1 on load days 1–3), the export sale, its first receipt and the close move one
// month earlier (S−4), so that baht invoice keeps its number (the second receipt stays in S−2).
function demoFxSalesStory(context) {
  const story = DEMO_FX_STORY;
  const base = specDate(story.invoice, context);
  const lastDay = taxPeriodLastDay(taxPeriodOfDate(base));
  const later = demoFxLaterBahtInvoices(base, context);
  const blocked = later.length > 0 && demoFxSharesMonthEndRate(later[later.length - 1], lastDay);
  if (!blocked) return { invoice: story.invoice, receipts: story.receipts };
  const earlier = spec => Object.freeze({ ...spec, storyMonth: spec.storyMonth - 1 });
  return { invoice: earlier(story.invoice), receipts: [earlier(story.receipts[0]), ...story.receipts.slice(1)] };
}
function demoFxEvents(context, state, offsetOf, place) {
  const story = { ...DEMO_FX_STORY, ...demoFxSalesStory(context) };
  const closeAnchor = { storyMonth: story.invoice.storyMonth, monthEnd: 0 };
  return [
    { offset: businessDaysBetween(context.today, demoFxInvoiceDate(story.invoice, context)), order: 1, run: () => { context.fxInvoices.push(place('invoices', story.invoice, buildDemoFxInvoice(story.invoice, context, state))); } },
    ...story.receipts.map(spec => ({ offset: offsetOf(spec), order: 3, run: () => { context.fxReceipts.push(place('receipts', spec, buildDemoFxReceipt(spec, context.fxInvoices[0], context, state))); } })),
    { offset: offsetOf(story.expense), order: 5, run: () => { context.fxExpenses.push(place('expenses', story.expense, buildDemoFxExpense(story.expense, context, state))); } },
    { offset: offsetOf(story.payment), order: 6, run: () => { state.payment = buildDemoFxPayment(story.payment, context.fxExpenses[0], context, state); } },
    // After every other row of the month's last day (the close reads the whole month).
    { offset: offsetOf(closeAnchor), order: 9, run: () => { const result = buildDemoFxClose(taxPeriodOfDate(specDate(closeAnchor, context)), context, state); state.close = result.close; state.closePlan = result.plan; } }
  ];
}
// The stores the loader writes (rate table, month-end closes, settings) and the figures it verifies after loading.
function demoFxResult(context, state) {
  // Today's rates of the three sample currencies (a live sale / payment during the demo finds its rate).
  for (const [currency, type, rate] of DEMO_FX_TODAY_RATES) {
    const rule = fxRateDateFor(context.today, type);
    if (rule.rateDate) demoFxAddRate(state, currency, type, rule.rateDate, rate);
  }
  const invoice = context.fxInvoices[0], expense = context.fxExpenses[0], payment = state.payment, close = state.close;
  if (!invoice || !expense || !payment || !close) throw new Error('ข้อมูลตัวอย่างหลายสกุลเงินไม่ครบ');
  return {
    settings: demoFxSettings(),
    rates: normalizeFxRateStore(state.store),
    documents: normalizeFxDocuments({ ...emptyFxDocuments(), closes: [close] }),
    expected: {
      invoice: { no: invoice.no, branch: invoice.branch, date: invoice.date, currency: invoice.currency, amountFx: invoice.amountFx, total: invoice.total, rateDate: invoice.fxRateDate },
      receipts: context.fxReceipts.map(row => ({ no: row.no, date: row.date, amountFx: row.amountFx, amountThb: row.amountThb, settledThb: row.total, realisedThb: row.fxRealisedThb })),
      close: { id: close.id, period: close.period, rows: close.rows.map(row => ({ kind: row.kind, no: row.no, openFx: row.openFx, carryingThb: row.carryingThb, revaluedThb: row.revaluedThb, diffThb: row.diffThb })), exportValues: close.exportValues.map(row => ({ invoiceNo: row.invoiceNo, thb: row.thb, bookThb: row.bookThb, basis: row.basis })) },
      expense: { docNo: expense.docNo, date: expense.date, amountFx: expense.amountFx, amount: expense.amount },
      payment: { no: payment.no, date: payment.date, cashThb: payment.cashThb, settledThb: payment.settledThb, realisedThb: payment.realisedThb, incomeThb: payment.wht.incomeThb, whtThb: payment.wht.whtThb, borneThb: payment.wht.borneThb, pp36VatThb: payment.pp36.vatThb, claimPeriod: payment.pp36.claimPeriod }
    }
  };
}
// The settings the sample needs (written only when this device has none: settings the user chose stay).
export function demoFxSettings() {
  return normalizeFxSettings({ ...defaultFxSettings(), allowedCurrencies: [...DEMO_FX_ALLOWED] });
}

// ------------------------------------------------------------ master rows
function contactRow(customer) {
  return tag({
    id: customer.id,
    name: customer.name,
    role: 'customer',
    entityType: customer.entityType || 'company',
    taxId: customer.taxId,
    branchName: customer.branchName || 'สำนักงานใหญ่',
    branchCode: customer.branchCode || '00000',
    address: customer.address,
    postalCode: customer.postalCode,
    contactPerson: customer.contactPerson,
    phone: customer.phone,
    email: customer.email,
    creditDays: Number(String(customer.creditTerm).replace(/\D/g, '')) || 0,
    agencyGroup: agencyOf(customer).customerAgencyGroup,
    agencyType: agencyOf(customer).customerAgencyType,
    note: 'ข้อมูลตัวอย่างสำหรับสาธิตระบบ (ลบได้ด้วยปุ่ม “ล้างข้อมูลสาธิตทั้งหมด (รีเซ็ต)”)',
    active: true
  });
}
function seedBuyerBranch(customer, none) {
  if (none || customer === WALK_IN) return { customerBranchCode: '', customerBranchName: '' };
  const { code, name } = buyerBranchFromContact(contactRow(customer));
  return { customerBranchCode: code, customerBranchName: name };
}
function contactOf(customerKey) {
  return contactRow(customerOf(customerKey));
}
export function demoSeedContacts() {
  return CUSTOMERS.map(contactRow);
}
// Supplier Master rows (ADR-023) in the shape of app.js saveSupplierMaster() + the establishment (G5).
export function demoSeedSuppliers() {
  return SUPPLIERS.map(supplier => tag({
    id: supplier.id,
    name: supplier.name,
    role: 'supplier',
    entityType: supplier.entityType,
    taxId: supplier.taxId,
    branchCode: supplier.branchCode,
    branchName: supplier.branchName,
    address: supplier.address,
    contactPerson: '',
    phone: supplier.phone,
    email: '',
    supplierCreditTerm: 'credit30',
    supplierLeadDays: [],
    whtIncomeType: supplier.whtIncomeType || '',
    vatRegistered: supplier.vatRegistered || '', // r13#MED-1
    note: 'ผู้จำหน่ายตัวอย่างสำหรับสาธิตภาษีซื้อ (ลบได้ด้วยปุ่ม “ล้างข้อมูลสาธิตทั้งหมด (รีเซ็ต)”)',
    active: true
  }));
}
// branchCount 1 (ADR-022): all opening stock sits at the head office (same total per product).
export function demoSeedProducts(branchCount = 2) {
  const single = Number(branchCount) === 1;
  return PRODUCTS.map((product, index) => {
    const row = {
      id: `demo-seed-p${String(index + 1).padStart(2, '0')}`,
      ...product,
      ...(single ? { openingStockUbon: product.openingStockUbon + product.openingStockKhonkaen, openingStockKhonkaen: 0 } : {}),
      openingStock: product.openingStockUbon + product.openingStockKhonkaen,
      active: true
    };
    const validation = validateProductMasterRecord(row);
    if (!validation.valid) throw new Error(`สินค้าตัวอย่าง ${product.code} ไม่ผ่านการตรวจ: ${validation.errors.join(', ')}`);
    return tag(row);
  });
}

// ------------------------------------------------------- costing story (ADR-028, round 11)
// The company also does installation / maintenance JOBS. Four of the existing sample invoices are delivered by a job
// (a production order, the app's own "งาน"), so the job story adds no sale, no tax figure and no AR figure: each job's
// production order is a LEGACY order (no sales order) with exactly the lines, value, cost estimate and commission of
// its invoice, in the same month — the analytics measure then counts the order instead of the invoice, with the
// same value, customer and products (r91 / analytics / dashboard figures unchanged). The costs are real: raw materials
// (RM-… stock items with opening stock at cost, purchase orders and goods receipts at their prices) issued to the
// jobs, labour hours at each person's rate, overhead at the predetermined rate, subcontract / other direct costs.
//   J1 U3 รพ.รวมแพทย์ — network job that LOST money: materials ran 7,700 over budget.
//   J2 U6 รพ.รวมแพทย์ — maintenance job, highly profitable.
//   J3 K3 + J4 K8 อีสานโลจิสติกส์ — the low-margin customer (6–7 %).
// Dates: J1 follows its invoice U3 (dated from `today`, ≥ 75 days back): the order 6 days before it (never before the
// 1st of its month), the costs in between, the completion on the invoice day — all ≥ 62 days back, never in S. J2–J4
// and the goods receipts are pinned to the calendar of S / the month before. Every receipt of a material J1 uses is
// dated after U3 on every load date (U3 is at most day 17 of the month before S; the receipts are ≥ day 19), so J1
// always takes its materials at the opening cost: the same figures on every load date.
const RAW_MATERIALS = Object.freeze([
  { code: 'RM-CAB6', name: 'สายแลน CAT6 (ม้วน 305 ม.)', category: 'วัสดุงานติดตั้ง', unit: 'ม้วน', flowType: 'inventory', fulfillmentType: 'stock', openingStockUbon: 8, openingStockKhonkaen: 5, reorderPoint: 0, standardCost: 3200, defaultPrice: 4200, defaultSupplier: 'บจก. ไอทีซัพพลาย อีสาน', leadTimeDays: 5 },
  { code: 'RM-RJ45', name: 'หัว RJ45 CAT6 (กล่อง 100 ตัว)', category: 'วัสดุงานติดตั้ง', unit: 'กล่อง', flowType: 'inventory', fulfillmentType: 'stock', openingStockUbon: 6, openingStockKhonkaen: 4, reorderPoint: 0, standardCost: 650, defaultPrice: 950, defaultSupplier: 'บจก. ไอทีซัพพลาย อีสาน', leadTimeDays: 5 },
  { code: 'RM-RACK', name: 'ตู้ Rack 9U พร้อมถาดและปลั๊กราง', category: 'วัสดุงานติดตั้ง', unit: 'ตู้', flowType: 'inventory', fulfillmentType: 'stock', openingStockUbon: 2, openingStockKhonkaen: 1, reorderPoint: 0, standardCost: 4800, defaultPrice: 6500, defaultSupplier: 'บจก. ไอทีซัพพลาย อีสาน', leadTimeDays: 7 },
  { code: 'RM-PATCH', name: 'สายแพตช์คอร์ด CAT6 (แพ็ก 10 เส้น)', category: 'วัสดุงานติดตั้ง', unit: 'แพ็ก', flowType: 'inventory', fulfillmentType: 'stock', openingStockUbon: 6, openingStockKhonkaen: 6, reorderPoint: 0, standardCost: 900, defaultPrice: 1290, defaultSupplier: 'บจก. ไอทีซัพพลาย อีสาน', leadTimeDays: 5 },
  { code: 'RM-CLEAN', name: 'ชุดวัสดุบำรุงรักษา (น้ำยา ผ้า ไส้กรองพัดลม)', category: 'วัสดุงานติดตั้ง', unit: 'ชุด', flowType: 'inventory', fulfillmentType: 'stock', openingStockUbon: 10, openingStockKhonkaen: 6, reorderPoint: 0, standardCost: 350, defaultPrice: 590, defaultSupplier: 'บจก. ไอทีซัพพลาย อีสาน', leadTimeDays: 5 }
]);
// Goods receipts of materials (purchase order 5 days before; PO price before VAT = the receipt cost).
const MATERIAL_RECEIPTS = Object.freeze([
  { key: 'GA', branch: 'ubon', storyMonth: -1, monthEnd: 7, lines: [['RM-CAB6', 10, 3410]] },
  { key: 'GB', branch: 'khonkaen', storyMonth: -1, monthEnd: 9, lines: [['RM-CAB6', 10, 3350]] },
  { key: 'GC', branch: 'ubon', monthDay: 6, lines: [['RM-RJ45', 10, 690]] }
]);
const COSTING_PEOPLE = Object.freeze([{ name: 'ช่างสมศักดิ์', rate: 150 }, { name: 'ทีมติดตั้ง A', rate: 220 }]);
const COSTING_SETTINGS_STORY = Object.freeze({ labourRate: 120, overhead: Object.freeze({ estimatedOverhead: 180000, estimatedHours: 2400 }), overheadCategories: Object.freeze(['ค่าสาธารณูปโภค', 'ค่าน้ำมันเชื้อเพลิง']) });
// Each job: its invoice, name, budget (what was planned when the job was accepted), material issues / returns, labour
// [person, hours], other direct costs [category, text, baht]. Dates: `at` = days before the invoice (J1, relative) or
// calendar anchors (J2–J4). `order` = the production order date.
const JOBS = Object.freeze([
  { key: 'J1', invoice: 'U3', name: 'ติดตั้งระบบเครือข่ายอาคารผู้ป่วยนอก (ตู้ Rack + เดินสาย)', budget: { materials: 9800, labourHours: 16, labour: 2400, overhead: 1200, other: 0 },
    order: { before: 6 }, issues: [{ before: 5, lines: [['RM-RACK', 1], ['RM-CAB6', 4], ['RM-RJ45', 2], ['RM-PATCH', 2]] }], returns: [{ before: 1, lines: [['RM-CAB6', 1]] }],
    labour: [{ before: 4, person: 'ช่างสมศักดิ์', hours: 24 }, { before: 2, person: 'ทีมติดตั้ง A', hours: 16 }], other: [{ before: 2, category: 'subcontract', text: 'จ้างเดินรางเก็บสายบนฝ้า', amount: 1500 }], complete: { before: 0 } },
  { key: 'J2', invoice: 'U6', name: 'บำรุงรักษาระบบเครือข่าย (MA) 3 ครั้ง', budget: { materials: 1200, labourHours: 12, labour: 1800, overhead: 900, other: 0 },
    order: { monthEnd: 10 }, issues: [{ monthEnd: 9, lines: [['RM-CLEAN', 3]] }], returns: [],
    labour: [{ monthEnd: 8, person: 'ช่างสมศักดิ์', hours: 6 }, { monthEnd: 6, person: 'ช่างสมศักดิ์', hours: 6 }], other: [], complete: { monthEnd: 4 } },
  { key: 'J3', invoice: 'K3', name: 'ติดตั้งจุดเครือข่ายคลังสินค้า + MA 2 ครั้ง', budget: { materials: 5200, labourHours: 20, labour: 4400, overhead: 1500, other: 1000 },
    order: { storyMonth: -1, monthEnd: 10 }, issues: [{ storyMonth: -1, monthEnd: 8, lines: [['RM-CAB6', 1], ['RM-RJ45', 1], ['RM-PATCH', 2]] }], returns: [],
    labour: [{ storyMonth: -1, monthEnd: 7, person: 'ทีมติดตั้ง A', hours: 12 }, { storyMonth: -1, monthEnd: 6, person: 'ทีมติดตั้ง A', hours: 12 }], other: [{ storyMonth: -1, monthEnd: 6, category: 'subcontract', text: 'เช่ารถกระเช้าติดตั้งสายบนที่สูง', amount: 1600 }], complete: { storyMonth: -1, monthEnd: 5 } },
  { key: 'J4', invoice: 'K8', name: 'บำรุงรักษาระบบเครือข่าย (MA) 2 ครั้ง', budget: { materials: 1000, labourHours: 16, labour: 3520, overhead: 1200, other: 0 },
    order: { monthEnd: 8 }, issues: [{ monthEnd: 7, lines: [['RM-CLEAN', 2], ['RM-RJ45', 1]] }], returns: [],
    labour: [{ monthEnd: 5, person: 'ทีมติดตั้ง A', hours: 10 }, { monthEnd: 3, person: 'ทีมติดตั้ง A', hours: 10 }], other: [{ monthEnd: 3, category: 'other', text: 'ค่าที่พักและเบี้ยเลี้ยงทีมช่าง', amount: 1200 }], complete: { monthEnd: 1 } }
]);
const JOB_MAKER = 'ทีมช่างติดตั้งของบริษัท (งานภายใน)';
function rawMaterialByCode(code) {
  const product = RAW_MATERIALS.find(row => row.code === code);
  if (!product) throw new Error(`ไม่พบวัตถุดิบตัวอย่าง ${code}`);
  return product;
}
export function demoSeedRawMaterials(branchCount = 2) {
  const single = Number(branchCount) === 1;
  return RAW_MATERIALS.map((product, index) => {
    const row = { id: `demo-seed-rm${String(index + 1).padStart(2, '0')}`, ...product, ...(single ? { openingStockUbon: product.openingStockUbon + product.openingStockKhonkaen, openingStockKhonkaen: 0 } : {}), openingStock: product.openingStockUbon + product.openingStockKhonkaen, active: true };
    const validation = validateProductMasterRecord(row);
    if (!validation.valid) throw new Error(`วัตถุดิบตัวอย่าง ${product.code} ไม่ผ่านการตรวจ: ${validation.errors.join(', ')}`);
    return tag(row);
  });
}
// A job row's date: `before` = n days before its invoice but never before the 1st of the invoice's month nor before
// the order; or a calendar anchor of S / the month before (storyMonthDate).
function jobDate(anchor, invoiceDate, floor, context) {
  if (anchor.before !== undefined) {
    if (!isInteger(anchor.before) || anchor.before < 0) throw new Error('ข้อมูลตัวอย่างต้นทุนงาน: before ต้องเป็นจำนวนวัน ≥ 0');
    const monthStart = taxPeriodFirstDay(taxPeriodOfDate(invoiceDate));
    const date = addBusinessCalendarDays(invoiceDate, -anchor.before);
    const low = floor && floor > monthStart ? floor : monthStart;
    return date < low ? low : date;
  }
  return storyMonthDate(context.today, anchor);
}
function buildDemoCostingStory(context, branchCount) {
  const atBranch = branch => (branchCount === 1 ? 'ubon' : branch);
  const products = demoSeedRawMaterials(branchCount);
  const documents = [];
  const purchaseOrders = [];
  const goodsReceipts = [];
  const movements = [];
  const entries = [];
  const budgets = {};
  const supplier = SUPPLIERS.find(row => row.key === 'S_IT');
  let serial = 0;
  const seq = prefix => `demo-seed-${prefix}${String(serial += 1).padStart(3, '0')}`;
  // Purchase orders and goods receipts of the materials (received in full).
  for (const spec of MATERIAL_RECEIPTS) {
    const branch = atBranch(spec.branch);
    const date = storyMonthDate(context.today, spec);
    const orderDate = addBusinessCalendarDays(date, -5);
    const items = spec.lines.map(([code, qty, unitCost]) => {
      const product = rawMaterialByCode(code);
      return { productCode: product.code, product: product.name, fulfillmentType: 'stock', flowType: 'inventory', qty, unit: product.unit, unitCost, total: roundMoneyValue(qty * unitCost) };
    });
    const subtotal = roundMoneyValue(items.reduce((sum, item) => sum + item.total, 0));
    // r13#HIGH-2: the supplier is VAT-registered — the PO price is before VAT (+7 %), the tax invoice comes with the goods
    // and is claimed in the month received (planned by the app's own goods-receipt VAT rules).
    const poVat = calculateVatSummary(subtotal, 'add');
    const po = tag({ id: seq('po'), no: context.numbers.document('PO', orderDate), date: orderDate, branch, supplier: supplier.name, supplierAddress: supplier.address, supplierTaxId: supplier.taxId, expectedDate: date, status: 'received', items, subtotal, vatMode: 'add', vatAmt: poVat.vatAmt, total: poVat.total, note: 'ซื้อวัสดุสำหรับงานติดตั้ง', createdAt: instantOf(orderDate), updatedAtIso: instantOf(date) });
    const [adYear, adMonth, adDay] = date.split('-');
    const grVat = planGoodsReceiptVatFields({ date, subtotal, supplier: supplier.name, vatMode: 'add', taxStatus: 'received', vendorTaxId: supplier.taxId, vendorBranchCode: supplier.branchCode, vendorAddress: supplier.address, taxInvoiceNo: `ITS-${String(Number(adYear) + 543).slice(-2)}${adMonth}-${String(100 + Number(adDay)).padStart(4, '0')}`, taxInvoiceDate: date, taxInvoiceReceivedDate: date });
    if (!grVat.ok) throw new Error(`ใบรับสินค้าตัวอย่าง ${spec.key}: ${grVat.error}`);
    const gr = tag({ id: seq('gr'), no: context.numbers.document('GR', date), date, branch, poId: po.id, poNo: po.no, supplier: supplier.name, items: items.map(item => ({ productCode: item.productCode, product: item.product, unit: item.unit, unitCost: item.unitCost, outstanding: item.qty, qty: item.qty })), subtotal, ...grVat.fields, taxInvoiceRecordedAt: instantOf(date), note: '', status: 'posted', createdAt: instantOf(date), updatedAtIso: instantOf(date) });
    purchaseOrders.push(po);
    goodsReceipts.push(gr);
    items.forEach(item => movements.push(tag({ id: seq('mv'), date, branch, kind: 'receipt', qty: item.qty, productCode: item.productCode, product: item.product, unit: item.unit, unitCost: item.unitCost, refType: 'goods_receipt', refId: gr.id, refNo: gr.no, poNo: po.no, note: `รับสินค้าจาก ${supplier.name}`, createdAt: instantOf(date), updatedAtIso: instantOf(date) })));
  }
  // The jobs: one legacy production order per invoice, identical in lines and value.
  const jobKeys = {};
  for (const spec of JOBS) {
    const state = context.invoices.get(spec.invoice);
    if (!state) throw new Error(`ข้อมูลตัวอย่างต้นทุนงาน ${spec.key}: ไม่พบใบกำกับภาษี ${spec.invoice}`);
    const invoice = state.record;
    if (invoice.voided) throw new Error(`ข้อมูลตัวอย่างต้นทุนงาน ${spec.key}: ใบกำกับภาษีถูกยกเลิก`);
    const branch = invoice.branch;
    const orderDate = jobDate(spec.order, invoice.date, '', context);
    const at = anchor => jobDate(anchor, invoice.date, orderDate, context);
    const { year, month } = periodOf(orderDate);
    if (taxPeriodOfDate(orderDate) !== taxPeriodOfDate(invoice.date) || orderDate > invoice.date) throw new Error(`ข้อมูลตัวอย่างต้นทุนงาน ${spec.key}: ใบสั่งผลิตต้องอยู่เดือนเดียวกับใบกำกับภาษีและไม่หลังใบกำกับ`);
    const customer = CUSTOMERS.find(row => row.name === invoice.customer);
    let production = {
      id: context.nextId(), schemaVersion: 3, no: context.numbers.document('PD', orderDate), date: orderDate, branch,
      maker: JOB_MAKER, makerAddress: '', makerTaxId: '', makerContact: '', makerPhone: '', makerEmail: '',
      customer: invoice.customer, ...(customer ? agencyOf(customer) : {}), salesPerson: invoice.salesPerson || '', job: spec.name,
      items: invoice.items.map(item => ({ ...item, costEntered: true, saleMode: 'unit', saleValue: item.priceUnit, saleEntered: true, saleLump: 0 })),
      sourceQuoteId: '', sourceQuoteNo: '', sourceQuoteBranch: '', sourceQuoteYear: '', sourceQuoteMonth: '', sourceQuoteFirebaseId: '', sourceSalesOrderId: '', sourceSalesOrderNo: '',
      qty: invoice.items.reduce((sum, item) => sum + item.qty, 0), unit: invoice.items.length === 1 ? invoice.items[0].unit : '', costMode: invoice.items.length === 1 ? 'unit' : 'mixed',
      costTotal: invoice.costTotal, costSubtotal: invoice.costTotal, costUseVat: 0, costVatMode: 'none', costVatAmt: 0, costGrandTotal: invoice.costTotal,
      saleMode: 'unit', itemSaleTotal: invoice.itemSaleTotal, saleTotal: invoice.saleTotal, subtotal: invoice.subtotal, useVat: invoice.useVat, vatMode: invoice.vatMode, vatAmt: invoice.vatAmt, total: invoice.total,
      commMode: invoice.commMode, commRate: invoice.commRate, commAmt: invoice.commAmt, profit: invoice.profit,
      deliveryLeadDays: '', deliveryDueDate: invoice.date, estimatedDeliveryDate: invoice.date, supplierCreditTerm: 'cash', supplierDueDate: orderDate,
      supplierPaymentStatus: 'paid', supplierPaymentNote: 'งานภายใน — ไม่มีค่าจ้างผู้รับผลิต (ต้นทุนจริงอยู่ในใบต้นทุนงาน)',
      note: `งานของใบกำกับภาษี ${invoice.no}`, attachments: []
    };
    production = withThaiCalendarMeta(planProductionDocumentAction({ draft: production, original: null, duplicateNumber: false }).record, year, month);
    // R9.1 two clocks: the order sits in its invoice's month, so it carries the invoice's story pin (S / the month before).
    production = tag(invoice.demoSeedStory ? { ...production, demoSeedStory: invoice.demoSeedStory } : production);
    documents.push({ collection: 'productions', branch, year, month, record: production });
    // The invoice now names the job that delivered it (the app's own link fields).
    Object.assign(invoice, { sourceProductionId: production.id, sourceProductionNo: production.no, sourceProductionBranch: branch, sourceProductionYear: year, sourceProductionMonth: month, sourceProductionRawCostTotal: invoice.costTotal });
    const jobKey = `${branch}|${production.id}`;
    jobKeys[spec.key] = jobKey;
    const common = { refType: 'job', refId: String(production.id), refNo: production.no, jobKey, jobNo: production.no };
    const issueIds = new Map();
    for (const issue of spec.issues) {
      const date = at(issue);
      for (const [code, qty] of issue.lines) {
        const product = rawMaterialByCode(code);
        const id = seq('mvjob');
        issueIds.set(code, id);
        movements.push(tag({ id, date, branch, kind: 'job_issue', qty: -qty, productCode: product.code, product: product.name, unit: product.unit, unitCost: 0, ...common, note: '', createdAt: instantOf(date), updatedAtIso: instantOf(date) }));
      }
    }
    for (const back of spec.returns) {
      const date = at(back);
      for (const [code, qty] of back.lines) {
        const product = rawMaterialByCode(code);
        movements.push(tag({ id: seq('mvjob'), date, branch, kind: 'job_return', qty, productCode: product.code, product: product.name, unit: product.unit, unitCost: 0, ...common, sourceMovementId: issueIds.get(code), note: 'เหลือจากหน้างาน', createdAt: instantOf(date), updatedAtIso: instantOf(date) }));
      }
    }
    const entry = (kind, date, fields) => entries.push({ id: seq('je'), kind, jobKey, jobNo: production.no, branch, date, status: 'posted', createdAt: instantOf(date), createdBy: DEMO_SEED_ACTOR, voidedAt: '', voidedBy: '', voidReason: '', demoSeed: true, demoSeedBatch: DEMO_SEED_BATCH_ID, ...fields });
    const overheadRate = COSTING_SETTINGS_STORY.overhead.estimatedOverhead / COSTING_SETTINGS_STORY.overhead.estimatedHours;
    for (const row of spec.labour) entry('labour', at(row), { person: row.person, hours: row.hours, rate: COSTING_PEOPLE.find(person => person.name === row.person).rate, overheadRate });
    for (const row of spec.other) entry('other', at(row), { category: row.category, description: row.text, amount: row.amount });
    entry('completion', at(spec.complete), { goodQty: production.qty, scrapQty: 0, destination: 'cost_of_sales', productCode: '', movementId: '' });
    budgets[jobKey] = { ...spec.budget, source: 'manual', sourceRef: '', updatedAt: instantOf(orderDate) };
    for (const row of [...entries.filter(e => e.jobKey === jobKey), ...movements.filter(m => m.jobKey === jobKey)]) {
      if (row.date < orderDate || row.date > invoice.date) throw new Error(`ข้อมูลตัวอย่างต้นทุนงาน ${spec.key}: วันที่ ${row.date} อยู่นอกช่วงงาน`);
    }
  }
  const openingCosts = Object.fromEntries(products.map(product => [productSkuKey(product), product.standardCost]));
  const nrv = { [productSkuKey(rawMaterialByCode('RM-RACK'))]: { expectedPrice: 4500, costToSell: 300 } };
  const settings = normalizeCostingSettings({ ...defaultCostingSettings(), ...COSTING_SETTINGS_STORY, overhead: { ...COSTING_SETTINGS_STORY.overhead }, overheadCategories: [...COSTING_SETTINGS_STORY.overheadCategories], personRates: COSTING_PEOPLE.map(row => ({ ...row })), openingCosts, nrv, updatedAt: instantOf(context.today) });
  const jobStore = normalizeJobStore({ schemaVersion: 1, entries, budgets });
  return { products, documents, purchaseOrders, goodsReceipts, movements, jobStore, settings, jobKeys };
}
// What the costing of the story gives (the job cost sheets), computed with the app's own costing cores — the loader
// and the tests compare the stored data with it. Also proves the story never makes stock negative on any day.
export function demoSeedJobCosts(plan) {
  const costing = plan.costing;
  const products = [...plan.products, ...costing.products];
  const invoices = plan.documents.filter(row => row.collection === 'invoices' && row.record.voided !== true).map(row => ({ ...row.record, branch: row.branch }));
  const creditNotes = plan.documents.filter(row => row.collection === 'creditNotes' && row.record.voided !== true).map(row => ({ ...row.record, branch: row.branch, _branch: row.branch }));
  const built = buildCostingMovements({ products, stockMovements: costing.movements, invoices, creditNotes, openingCosts: costing.settings.openingCosts });
  const result = runCosting(built.groups, { settings: costing.settings, fallbackUc: built.fallbackUc });
  const productions = plan.documents.filter(row => row.collection === 'productions').map(row => ({ ...row.record, _branch: row.branch }));
  const jobs = listJobs(productions);
  const sheets = buildJobCostSheets({ jobs, store: costing.jobStore, costing: result });
  return { result, issues: built.issues, jobs, sheets };
}

// --------------------------------------------------------------- plan
// options: { today: 'YYYY-MM-DD' (business date), numberStart: collectNumberSequences(...),
//            businessRuleVersion: number, branchCount: 1 | 2 (ADR-022, default 2),
//            payer: branch → { name, address, taxId, branchCode } — the ผู้มีหน้าที่หักภาษี printed on the
//            sample 50 ทวิ (ADR-024; the app passes the company profile, ERPPayerWht.payerInfo) }
// branchCount 1 = the company has one establishment: every document of the scenario is issued by the
// head office (`ubon`), the second branch's own rent / electricity is left out, and its opening stock
// moves to the head office. Numbering is per prefix + month (never per branch), so the running numbers,
// the billing / payment links and the receipts stay one coherent sequence.
// Returns { documents: [{collection, branch, year, month, record}], flow: {billingNotes,
// payments, activity}, contacts, products, expected: {invoices: {key: {...}}} }.
export function buildDemoSeedPlan(options = {}) {
  const today = requireIsoDate(options.today);
  const branchCount = Number(options.branchCount ?? 2);
  if (branchCount !== 1 && branchCount !== 2) throw new Error('จำนวนสาขาของข้อมูลตัวอย่างต้องเป็น 1 หรือ 2');
  const atHeadOffice = spec => (branchCount === 1 ? { ...spec, branch: 'ubon' } : spec);
  const quoteSpecs = QUOTES.map(atHeadOffice);
  const invoiceSpecs = INVOICES.map(atHeadOffice);
  const expenseSpecs = EXPENSES.filter(spec => branchCount === 2 || !spec.branchPremises).map(atHeadOffice);
  let serial = 0;
  const context = {
    today,
    dateAt: offset => addBusinessCalendarDays(today, offset),
    nextId: () => DEMO_SEED_ID_BASE + (serial += 1),
    numbers: createNumberAllocator(options.numberStart || {}),
    businessRuleVersion: Math.max(1, Math.trunc(Number(options.businessRuleVersion) || 1)),
    quotes: new Map(),
    invoices: new Map(),
    invoiceSpecs: new Map(invoiceSpecs.map(spec => [spec.key, spec])),
    invoiceKeyById: new Map(),
    creditNotes: [],
    debitNotes: [],
    whtCertificates: [],
    // ADR-031: the multi-currency story's own documents (outside the THB story above).
    fxInvoices: [],
    fxReceipts: [],
    fxExpenses: [],
    payer: branch => {
      const info = typeof options.payer === 'function' ? options.payer(branch) : null;
      return info && typeof info === 'object' ? info : { name: '', address: '', taxId: '', branchCode: branch === 'ubon' ? '00000' : '' };
    }
  };
  // R9.1: S (the story month), its first day, and the first day of today's month.
  const storyPeriod = demoSeedStoryPeriod(today);
  const storyStart = taxPeriodFirstDay(storyPeriod);
  const monthStart = taxPeriodFirstDay(taxPeriodOfDate(today));
  // Event order key: days from today to the row's date (≤ 0), the same for every clock.
  const offsetOf = spec => businessDaysBetween(today, specDate(spec, context));
  // Calendar-pinned rows say which month of the story they belong to: 'tax-month' (S, ADR-023/024 + R9.1) or
  // 'month-before' (the month before S); rows dated from `today` carry no tag.
  const story = (spec, record) => {
    if (clockOf(spec) !== 'story') return record;
    const storyMonth = spec.storyMonth || 0;
    return { ...record, demoSeedStory: storyMonth === 0 ? 'tax-month' : storyMonth === -1 ? 'month-before' : 'fx-story' };
  };
  // R9.1 invariants of one row (throws — a plan that breaks them is never loaded): never after today; a row dated
  // from today never falls into S (except open quotations, which are in no tax figure); a `recent` row stays in
  // today's month; a pinned row sits in its own month.
  const checkClock = (spec, record, collection) => {
    const date = String(record.date || '');
    const label = `${collection} ${record.no || record.docNo || spec.key || ''}`;
    if (!parseBusinessDate(date) || date > today) throw new Error(`ข้อมูลตัวอย่าง ${label} ลงวันที่หลังวันนี้หรือวันที่ไม่ถูกต้อง (${date})`);
    const clock = clockOf(spec);
    if (clock === 'relative' && collection !== 'quotes') {
      if (spec.offset > -RELATIVE_MIN_AGE_DAYS || date >= storyStart) throw new Error(`ข้อมูลตัวอย่าง ${label}: วันที่นับจากวันนี้ต้องย้อนหลังอย่างน้อย ${RELATIVE_MIN_AGE_DAYS} วัน (ก่อนเดือน ${storyPeriod})`);
    }
    if (clock === 'recent' && date < monthStart) throw new Error(`ข้อมูลตัวอย่าง ${label}: ต้องอยู่ในเดือนปัจจุบัน`);
    if (clock === 'story' && taxPeriodOfDate(date) !== addTaxPeriods(storyPeriod, spec.storyMonth || 0)) throw new Error(`ข้อมูลตัวอย่าง ${label}: ไม่อยู่ในเดือนของเรื่องเล่า`);
    return record;
  };
  const documents = [];
  const jobExpenses = [];
  const fxState = { today, store: emptyFxRateStore(), close: null, closePlan: null, payment: null };
  const flow = { billingNotes: [], payments: [], activity: [] };
  const push = (collection, record) => {
    const tagged = tag(record);
    documents.push({ collection, branch: tagged.branch, year: tagged.year, month: tagged.month, record: tagged });
    return tagged;
  };
  // A scenario row's record: date invariants checked, story tag added, stored. Returns the stored object (later
  // links — the quote's invoice stamp, the expense's 50 ทวิ — are written onto it).
  const place = (collection, spec, record) => push(collection, story(spec, checkClock(spec, record, collection)));

  // Every event in date order, so running numbers and ids follow the calendar and
  // each receipt / credit note / payment sees the balances of the days before it.
  const events = [
    ...quoteSpecs.map(spec => ({ offset: offsetOf(spec), order: 0, run: () => { context.quotes.set(spec.key, place('quotes', spec, buildQuote(spec, context))); } })),
    ...invoiceSpecs.map(spec => ({ offset: offsetOf(spec), order: 1, run: () => {
      const record = place('invoices', spec, buildInvoice(spec, context));
      context.invoices.set(spec.key, { record, total: record.total, paid: 0, credited: 0, debited: 0, cancelled: record.voided === true });
      context.invoiceKeyById.set(String(record.id), spec.key);
    } })),
    ...CREDIT_NOTES.map(spec => ({ offset: offsetOf(spec), order: 2, run: () => { place('creditNotes', spec, buildCreditNote(spec, context)); } })),
    ...DEBIT_NOTES.map(spec => ({ offset: offsetOf(spec), order: 2, run: () => { place('debitNotes', spec, buildDebitNote(spec, context)); } })),
    ...RECEIPTS.map(spec => ({ offset: offsetOf(spec), order: 3, run: () => { place('receipts', spec, buildReceipt(spec, context)); } })),
    { offset: offsetOf(BILLING.paid), order: 4, run: () => {
      const result = buildBillingAndPayment(BILLING, context);
      flow.billingNotes.push(tag(result.billing));
      flow.payments.push(tag(result.payment));
      flow.activity.push(tag(result.activity));
      result.receipts.forEach(receipt => place('receipts', BILLING.paid, receipt));
    } },
    ...expenseSpecs.map(spec => ({ offset: offsetOf(spec), order: 5, run: () => {
      const expense = place('expenses', spec, buildExpense(spec, context));
      if (spec.job) jobExpenses.push({ spec, expense });
      if (!spec.wht) return;
      // The certificate is issued with the payment and stored in the same month pack; the expense keeps its link.
      const cert = buildSeedWhtCertificate(expense, context);
      Object.assign(expense, { whtCertId: cert.id, whtCertNo: cert.no });
      place('whtCertificates', spec, cert);
    } })),
    // ADR-031: the multi-currency story (S−3 / S−2), in the same date order (running numbers follow the calendar).
    ...demoFxEvents(context, fxState, offsetOf, place)
  ];
  events.sort((a, b) => a.offset - b.offset || a.order - b.order).forEach(event => event.run());
  const fx = demoFxResult(context, fxState);
  // ADR-028: the costing story (jobs on four of the invoices, materials, purchase orders / receipts, labour).
  const costing = buildDemoCostingStory(context, branchCount);
  costing.documents.forEach(row => documents.push(row));
  // r13#LOW-6: each subcontract payment clears the accrued cost of ITS job entry (the same amount, never before it).
  for (const { spec, expense } of jobExpenses) {
    const entry = costing.jobStore.entries.find(row => row.kind === 'other' && row.jobKey === costing.jobKeys[spec.job.key] && row.description === spec.job.text);
    if (!entry || Number(entry.amount) !== Number(expense.amount) || entry.date > expense.date) throw new Error(`ค่าจ้างช่วงตัวอย่าง ${expense.docNo}: ไม่พบค่าใช้จ่ายของงาน ${spec.job.key} ที่ตรงกัน`);
    Object.assign(expense, { jobEntryId: entry.id, jobKey: entry.jobKey, jobNo: entry.jobNo });
  }

  const expected = { invoices: {} };
  for (const [key, state] of context.invoices) {
    const record = state.record;
    const dueDate = record.dueDate || record.date;
    expected.invoices[key] = {
      no: record.no,
      branch: record.branch,
      customer: record.customer,
      total: record.total,
      paid: state.paid,
      credited: state.credited,
      debited: state.debited,
      outstanding: outstandingOf(state),
      dueDate,
      daysPastDue: businessDaysBetween(dueDate, today)
    };
  }
  // ADR-031: the export invoice too (fully received in its currency: outstanding 0), so every check over the expected
  // invoices (load verification, tests) covers it.
  for (const record of context.fxInvoices) {
    const paid = roundMoneyValue(context.fxReceipts.filter(row => String(row.invoiceId) === String(record.id)).reduce((sum, row) => sum + row.total, 0));
    expected.invoices[DEMO_FX_STORY.invoice.key] = { no: record.no, branch: record.branch, customer: record.customer, total: record.total, paid, credited: 0, debited: 0, outstanding: roundMoneyValue(record.total - paid), dueDate: record.dueDate, daysPastDue: businessDaysBetween(record.dueDate, today) };
  }
  // storyPeriod (R9.1): the month whose ภ.พ.30 / ภ.ง.ด. tell the hand-worked story — the loader opens รายงานภาษี on it.
  const plan = { version: DEMO_SEED_CORE_VERSION, batchId: DEMO_SEED_BATCH_ID, today, storyPeriod, documents, flow, fx, contacts: demoSeedContacts(), suppliers: demoSeedSuppliers(), products: demoSeedProducts(branchCount), branchCount, expected,
    costing: { products: costing.products, purchaseOrders: costing.purchaseOrders, goodsReceipts: costing.goodsReceipts, movements: costing.movements, jobStore: costing.jobStore, settings: costing.settings } };
  assertSeedStockWithinOpening(plan);
  // The costing story never takes stock below zero on any day (else its costs would depend on the load date).
  const jobCosts = demoSeedJobCosts(plan);
  if (jobCosts.issues.length || jobCosts.result.negatives.length) throw new Error(`ข้อมูลตัวอย่างต้นทุนงานทำให้สต็อกติดลบหรือข้อมูลไม่ครบ (${jobCosts.result.negatives.map(row => row.id).join(', ')})`);
  plan.expected.jobs = Object.fromEntries(JOBS.map((spec, index) => {
    const sheet = jobCosts.sheets.get(jobCosts.jobs.find(job => job.no === costing.documents[index].record.no)?.key);
    return [spec.key, { no: sheet.job.no, invoice: plan.expected.invoices[spec.invoice].no, materials: sheet.materials.net, labour: sheet.labour.amount, overhead: sheet.overhead.amount, other: sheet.other.amount, total: sheet.total }];
  }));
  assertSeedNotAfterToday(plan);
  return plan;
}

// R9.1: nothing the sample writes happens after `today` — document dates, cancel / void instants, purchase tax
// invoices received, input-VAT claim months (the 82/3 "claimed next month" row claims in today's month), billing and
// payment dates. (Due dates may be later: they are when the customer has to pay.)
function assertSeedNotAfterToday(plan) {
  const today = plan.today;
  const fail = (what, value) => { throw new Error(`ข้อมูลตัวอย่าง ${what} ลงวันที่หลังวันนี้ (${value} > ${today})`); };
  const dayOf = value => String(value || '').slice(0, 10);
  for (const { collection, record } of plan.documents) {
    const what = `${collection} ${record.no || record.docNo || record.desc || ''}`;
    if (!(String(record.date || '') <= today)) fail(what, record.date);
    for (const field of ['voidedAt', 'cancelledAt', 'taxInvoiceReceivedDate', 'taxInvoiceDate']) if (record[field] && dayOf(record[field]) > today) fail(`${what} (${field})`, record[field]);
    if (record.claimPeriod && record.claimPeriod > taxPeriodOfDate(today)) fail(`${what} (claimPeriod)`, record.claimPeriod);
  }
  for (const billing of plan.flow.billingNotes) if (!(String(billing.billingDate || '') <= today)) fail(`billing ${billing.no}`, billing.billingDate);
  for (const payment of plan.flow.payments) if (!(String(payment.date || '') <= today)) fail(`payment ${payment.no}`, payment.date);
}

// Quantity of each stock item the plan sells per branch, net of returned goods.
export function demoSeedStockUsage(plan) {
  const usage = {};
  const add = (branch, code, qty) => {
    const key = `${branch}|${code}`;
    usage[key] = roundMoneyValue((usage[key] || 0) + qty);
  };
  for (const { collection, branch, record } of plan.documents) {
    // A cancelled invoice gives its goods back (ADR-021), so it never uses stock.
    if (collection === 'invoices' && record.voided !== true) record.items.forEach(item => add(branch, item.productCode, item.qty));
    if (collection === 'creditNotes' && !record.voided) record.returnItems.forEach(item => add(branch, item.productCode, -item.qty));
  }
  return usage;
}
function assertSeedStockWithinOpening(plan) {
  const usage = demoSeedStockUsage(plan);
  for (const product of plan.products) {
    if (product.flowType !== 'inventory' || product.fulfillmentType !== 'stock') continue;
    for (const [branch, opening] of [['ubon', product.openingStockUbon], ['khonkaen', product.openingStockKhonkaen]]) {
      if ((usage[`${branch}|${product.code}`] || 0) > opening) throw new Error(`ข้อมูลตัวอย่างขาย ${product.code} เกินสต็อกตั้งต้นของสาขา ${branch}`);
    }
  }
}

// Period (branch + date + governance scope) of every seeded document, for period-lock checks.
export function demoSeedPeriods(plan) {
  // Expenses and the 50 ทวิ issued with them are purchase-side (DOCUMENT_LOCK_SCOPE); everything else is sales.
  const rows = plan.documents.map(({ collection, branch, record }) => ({ branch, date: record.date, scope: collection === 'expenses' || collection === 'whtCertificates' ? 'purchase' : 'sales', no: record.no || record.docNo || record.desc }));
  // ADR-023: an input-tax claim belongs to its claim month too — a closed claim month refuses the load.
  plan.documents.filter(({ collection, record }) => collection === 'expenses' && record.claimPeriod).forEach(({ branch, record }) => rows.push({ branch, date: taxPeriodFirstDay(record.claimPeriod), scope: 'purchase', no: record.docNo || record.desc }));
  plan.flow.payments.forEach(payment => rows.push({ branch: payment.branch, date: payment.date, scope: 'sales', no: payment.no }));
  // ADR-028: the costing story's purchases, receipts, stock movements and job cost entries are purchase-side (stock).
  const costing = plan.costing || { purchaseOrders: [], goodsReceipts: [], movements: [], jobStore: { entries: [] } };
  [...costing.purchaseOrders, ...costing.goodsReceipts, ...costing.movements, ...costing.jobStore.entries].forEach(row => rows.push({ branch: row.branch, date: row.date, scope: 'purchase', no: row.no || row.refNo || row.jobNo }));
  return rows;
}

// ------------------------------------------------- monthly sales history (ADR-027)
// Two years of summarised monthly sales before the first sample document, so "วิเคราะห์และคาดการณ์" has a trend,
// a season and enough months for Holt-Winters. Not documents: one row per month × branch × product × customer
// (pre-VAT value = qty × the product's default price), stored under DEMO_SALES_HISTORY_KEY and read ONLY for a
// branch-month that has no sales document (erp-analytics-core.js historyLines), so every dashboard / tax / AR
// figure of the sample stays exactly as before. Deterministic: trend + calendar season + noise from a seeded
// PRNG (FNV-1a hash of product|branch|month → mulberry32 → Box–Muller); the same `today` gives the same rows.
// Months: from 27 months before the story month S up to the month before each branch's first sales document, so
// the analysis always has 28 closed months (S − 27 … S): ≥ 27 lets Holt-Winters be tested on a holdout.
export const DEMO_HISTORY_MONTHS_BEFORE_STORY = 27;
// Calendar season (Jan … Dec): a dip around Songkran (April), the government fiscal year-end in September and a
// year-end peak in Q4. Normalised to an average of 1.
const HISTORY_SEASON_RAW = Object.freeze([0.95, 0.95, 1.05, 0.7, 0.9, 1, 1, 1, 1.05, 1.1, 1.2, 1.3]);
const HISTORY_SEASON = Object.freeze(HISTORY_SEASON_RAW.map(value => value / (HISTORY_SEASON_RAW.reduce((sum, x) => sum + x, 0) / 12)));
// Units per month at the story month (before season and noise) per branch, yearly growth, noise (coefficient of
// variation) and the share bought by walk-in customers. One establishment (ADR-022): the head office gets both.
const HISTORY_PRODUCTS = Object.freeze({
  'DEMO-NB01': { ubon: 2.04, khonkaen: 3.4, growth: 0.15, cv: 0.35, walkIn: 0 },
  'DEMO-MN01': { ubon: 1.7, khonkaen: 2.55, growth: 0.05, cv: 0.3, walkIn: 0.25 },
  'DEMO-UP01': { ubon: 1.36, khonkaen: 1.36, growth: 0, cv: 0.35, walkIn: 0.2 },
  'DEMO-PR01': { ubon: 0.68, khonkaen: 0.42, growth: -0.1, cv: 0.4, walkIn: 0 },
  'DEMO-TN01': { ubon: 3.4, khonkaen: 1.7, growth: 0.03, cv: 0.3, walkIn: 0.4 },
  'DEMO-KB01': { ubon: 1.27, khonkaen: 2.12, growth: 0, cv: 0.35, walkIn: 0.5 },
  'DEMO-NW01': { ubon: 0.34, khonkaen: 0.26, growth: 0.2, cv: 0.4, walkIn: 0 },
  'DEMO-CC01': { ubon: 0.21, khonkaen: 0.3, growth: 0.25, cv: 0.4, walkIn: 0 },
  'DEMO-SW01': { ubon: 1.87, khonkaen: 2.04, growth: 0.15, cv: 0.3, walkIn: 0 },
  'DEMO-SV01': { ubon: 1.02, khonkaen: 0.68, growth: 0.1, cv: 0.35, walkIn: 0 },
  'DEMO-SV02': { ubon: 0.85, khonkaen: 1.19, growth: 0.2, cv: 0.3, walkIn: 0 },
  'DEMO-TR01': { ubon: 0.26, khonkaen: 0.42, growth: 0, cv: 0.4, walkIn: 0 }
});
// Business customers of each branch: [customer key, weight at S, yearly change of the weight]. บจก. มูลมั่งมี
// วัสดุภัณฑ์ (C7, the customer with the 100-day-late invoice) buys less every year — the decline the comparisons show;
// the hospital (C3) and the Khon Kaen factory (C8) grow.
const HISTORY_CUSTOMERS = Object.freeze({
  ubon: Object.freeze([['C1', 4, 0], ['C2', 3, 0], ['C3', 2, 0.3], ['C7', 3, -0.45], ['C9', 1, 0]]),
  khonkaen: Object.freeze([['C4', 3, 0], ['C5', 2, 0.1], ['C6', 2, 0], ['C8', 3, 0.15]])
});
function historyHash(value) {
  let hash = 0x811c9dc5;
  for (const ch of String(value)) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
function historyRandom(seedText) {
  let state = historyHash(seedText);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function historyNormal(random) {
  let u = random();
  while (u <= 0) u = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}
// The first month with a sales document (invoice / credit / debit note) per branch in the plan.
export function demoSeedFirstSalesMonths(plan) {
  const first = {};
  for (const { collection, branch, record } of plan.documents) {
    if (!['invoices', 'productions', 'creditNotes', 'debitNotes'].includes(collection)) continue;
    const month = String(record.date || '').slice(0, 7);
    if (!isMonthKey(month)) continue;
    if (!first[branch] || month < first[branch]) first[branch] = month;
  }
  return first;
}
export function buildDemoSalesHistory(plan) {
  const today = requireIsoDate(plan?.today);
  const story = plan.storyPeriod || demoSeedStoryPeriod(today);
  const start = addMonths(story, -DEMO_HISTORY_MONTHS_BEFORE_STORY);
  const single = Number(plan.branchCount) === 1;
  const branches = single ? ['ubon'] : ['ubon', 'khonkaen'];
  const firstSales = demoSeedFirstSalesMonths(plan);
  const customersByKey = new Map([...CUSTOMERS, WALK_IN].map(customer => [customer.key, customer.name]));
  const priceOf = new Map(PRODUCTS.map(product => [product.code, Number(product.defaultPrice) || 0]));
  const storyIndex = monthIndex(story);
  const rows = [];
  for (const branch of branches) {
    // History stops the month before the branch's first sales document (or at S when it has none).
    const end = firstSales[branch] ? addMonths(firstSales[branch], -1) : story;
    const customerList = single ? [...HISTORY_CUSTOMERS.ubon, ...HISTORY_CUSTOMERS.khonkaen] : HISTORY_CUSTOMERS[branch];
    for (const period of monthRange(start, end)) {
      const yearsFromStory = (monthIndex(period) - storyIndex) / 12;
      const season = HISTORY_SEASON[parseMonthKey(period).month - 1];
      const weights = customerList.map(([key, weight, change]) => [key, weight * Math.pow(1 + change, yearsFromStory)]);
      const weightTotal = weights.reduce((sum, [, weight]) => sum + weight, 0);
      for (const [code, profile] of Object.entries(HISTORY_PRODUCTS)) {
        const random = historyRandom(`${code}|${branch}|${period}`);
        const base = single ? profile.ubon + profile.khonkaen : profile[branch];
        const expected = base * Math.pow(1 + profile.growth, yearsFromStory) * season;
        const qty = Math.max(0, Math.round(expected * Math.max(0, 1 + profile.cv * historyNormal(random))));
        if (!qty) continue;
        // Each unit goes to a walk-in buyer (share `walkIn`) or to a business customer by the weights above.
        const units = new Map();
        for (let unit = 0; unit < qty; unit += 1) {
          let key = 'WALKIN';
          if (random() >= profile.walkIn) {
            let pick = random() * weightTotal;
            key = weights[weights.length - 1][0];
            for (const [candidate, weight] of weights) { if (pick < weight) { key = candidate; break; } pick -= weight; }
          }
          units.set(key, (units.get(key) || 0) + 1);
        }
        for (const [key, count] of [...units.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
          rows.push([period, branch, code, customersByKey.get(key), count, roundMoneyValue(count * priceOf.get(code))]);
        }
      }
    }
  }
  return { schemaVersion: DEMO_HISTORY_SCHEMA_VERSION, kind: DEMO_HISTORY_KIND, demoSeed: true, demoSeedBatch: DEMO_SEED_BATCH_ID, generatedFor: today, storyPeriod: story, start, columns: [...DEMO_HISTORY_COLUMNS], rows };
}

// ------------------------------------------------------ reset key scope
// Tenant base keys that only hold how the screen looks (โหมดง่าย / โหมดขั้นสูง, collapsed sidebar
// sections — ADR-015), not business data; a reset keeps them so the presenter's chosen layout
// survives (erp-product-experience.js). The customer's company profile and logo (ADR-020) are
// settings too: a reset of the sample data keeps them; ตั้งค่าบริษัท has its own reset. So is the number of
// establishments (ADR-022): reset, then load sample data, keeps a one-branch company one-branch.
// The retired per-role view key (ADR-014) is not kept: a reset removes it like any other tenant key.
// Sales / delivery targets (ADR-021) are kept as keys too: the reset removes only the entries the sample data
// wrote (stripSeededTargets below), so targets the user typed survive a reset.
// The screen language (ภาษาไทย / English, ADR-026) is a view preference like the mode: a reset keeps it.
export const DEMO_RESET_KEPT_BASE_KEYS = Object.freeze([PRODUCT_EXPERIENCE_MODE_KEY, NAV_COLLAPSED_SECTIONS_KEY, COMPANY_PROFILE_KEY, COMPANY_LOGO_KEY, COMPANY_BRANCH_SETTING_KEY, SALES_TARGETS_KEY, DELIVERY_TARGETS_KEY, SALES_TARGET_PERIODS_KEY, DELIVERY_TARGET_PERIODS_KEY, UI_LANGUAGE_KEY, JOURNAL_SETTINGS_KEY, PROMPTPAY_SETTINGS_KEY]);
// ADR-029: the chart of accounts / posting defaults and the PromptPay settings are company settings (kept, like the company
// profile); the journal documents (manual entries, closes, write-downs, opening balances) are business data (removed).
// Un-prefixed legacy key that erp-order-flow.js loadStore() still copies into an EMPTY store:
// left behind, it would bring old Sales Orders / billing back right after a reset.
const DEMO_RESET_LEGACY_KEYS = Object.freeze([LEGACY_ORDER_FLOW_STORE_KEY]);

// Of `keys` (every localStorage key), the ones "ล้างข้อมูลสาธิตทั้งหมด (รีเซ็ต)" removes for
// the active tenant: its erp_tenant:: keys (documents, master data, settings, logs, drafts,
// auto-backups) except the view preferences above, its trial:: checklist keys, the legacy
// business_rules:: key the former "ล้างข้อมูลทดลอง" button also removed, and the legacy
// order-flow key. Other tenants' keys, other apps' keys and the short-lived write-lease
// keys (erp_demo_write_lease_v1:*, held by the reset itself) are never returned.
export function demoResetStorageKeys(keys = [], tenantId = '') {
  const tenant = String(tenantId || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(tenant)) throw new Error('ไม่ทราบพื้นที่ข้อมูล (tenant) ของเครื่องนี้ จึงยังไม่ล้างข้อมูล');
  const tenantPrefix = `erp_tenant::${tenant}::`;
  const trialPrefix = `trial::${tenant}::`;
  const legacyRulesKey = `business_rules::${tenant}`;
  const selected = new Set();
  for (const raw of Array.isArray(keys) ? keys : []) {
    const key = String(raw ?? '');
    if (key.startsWith(tenantPrefix)) {
      if (!DEMO_RESET_KEPT_BASE_KEYS.includes(key.slice(tenantPrefix.length))) selected.add(key);
    } else if (key.startsWith(trialPrefix) || key === legacyRulesKey || key.startsWith(`${legacyRulesKey}::`) || DEMO_RESET_LEGACY_KEYS.includes(key)) {
      selected.add(key);
    }
  }
  return [...selected].sort();
}

// ----------------------------------------------------------- sample targets (ADR-021)
// Per-month sales / delivery targets that make the dashboard's target chart tell a believable story with
// the sample data: for each month of the seeded history the target sits near what was actually sold —
// some months beat it, some miss — and the current month and the rest of the year carry a typical
// target (the average of the last full months). Months before the history get none ("ยังไม่ได้ตั้งเป้า").
// Keys are app.js targetPeriodOverrideKey(): "<scope>:<YYYY>-<MM>", scope all | ubon | khonkaen.
// Actuals follow the dashboard: sales = invoice value before VAT − live credit notes + live debit notes in their
// own month (analyticsPrimarySalesRows + creditAdjustmentRows, ADR-024); delivery = invoice value before VAT.
const TARGET_PATTERN = Object.freeze({ sales: [0.9, 1.12, 0.94, 1.08, 0.92, 1.1], delivery: [1.1, 0.92, 1.06, 0.9, 1.12, 0.95] });
const targetMonthKey = (scope, year, month) => `${scope}:${year}-${String(month + 1).padStart(2, '0')}`;
function targetStep(value) { return value >= 100000 ? 10000 : 5000; }
export function buildDemoSeedTargets(plan) {
  const today = requireIsoDate(plan?.today);
  const current = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 };
  const index = (year, month) => year * 12 + month;
  const actual = { sales: new Map(), delivery: new Map() };
  const add = (metric, scope, year, month, value) => {
    const key = targetMonthKey(scope, year, month);
    actual[metric].set(key, roundMoneyValue((actual[metric].get(key) || 0) + value));
  };
  let first = index(current.year, current.month);
  for (const { collection, branch, year, month, record } of plan.documents) {
    if (collection === 'invoices' && !record.voided) {
      first = Math.min(first, index(year, month));
      for (const scope of ['all', branch]) { add('sales', scope, year, month, Number(record.subtotal) || 0); add('delivery', scope, year, month, Number(record.subtotal) || 0); }
    }
    if (collection === 'creditNotes' && !record.voided) for (const scope of ['all', branch]) add('sales', scope, year, month, -(Number(record.subtotal) || 0));
    if (collection === 'debitNotes' && !record.voided) for (const scope of ['all', branch]) add('sales', scope, year, month, Number(record.subtotal) || 0);
  }
  const out = { sales: {}, delivery: {} };
  for (const metric of ['sales', 'delivery']) {
    for (const scope of ['all', 'ubon', 'khonkaen']) {
      const past = [];
      for (let i = first; i < index(current.year, current.month); i += 1) past.push({ year: Math.floor(i / 12), month: i % 12, value: actual[metric].get(targetMonthKey(scope, Math.floor(i / 12), i % 12)) || 0 });
      // Past months with sales, newest first: alternate beat / miss so the chart is neither all green nor all red.
      past.filter(row => row.value > 0).reverse().forEach((row, position) => {
        const factor = TARGET_PATTERN[metric][position % TARGET_PATTERN[metric].length], step = targetStep(row.value);
        const target = factor < 1 ? Math.floor(row.value * factor / step) * step : Math.ceil(row.value * factor / step) * step;
        if (target > 0) out[metric][targetMonthKey(scope, row.year, row.month)] = target;
      });
      const recent = past.filter(row => row.value > 0).slice(-3);
      if (!recent.length) continue;
      const typical = Math.round(recent.reduce((sum, row) => sum + row.value, 0) / recent.length / 10000) * 10000;
      if (typical <= 0) continue;
      for (let month = current.month; month < 12; month += 1) out[metric][targetMonthKey(scope, current.year, month)] = typical;
    }
  }
  return out;
}
// Target maps after taking out the seeded entries that still hold their seeded value (a value the user
// changed — or a month the user set that the sample never wrote — is theirs and stays). Pure.
export function stripSeededTargets(maps = {}, seeded = {}) {
  const result = {};
  for (const metric of ['sales', 'delivery']) {
    const next = { ...(maps[metric] && typeof maps[metric] === 'object' ? maps[metric] : {}) };
    for (const [key, value] of Object.entries(seeded?.[metric] || {})) if (Object.prototype.hasOwnProperty.call(next, key) && Number(next[key]) === Number(value)) delete next[key];
    result[metric] = next;
  }
  return result;
}
// The seeded targets to write into the stored maps: only months without a target yet (never overwrites
// the user's). → { maps: {sales, delivery} (merged), written: {sales, delivery} (what the seed owns) }.
export function mergeSeededTargets(maps = {}, targets = {}) {
  const merged = {}, written = {};
  for (const metric of ['sales', 'delivery']) {
    merged[metric] = { ...(maps[metric] && typeof maps[metric] === 'object' ? maps[metric] : {}) };
    written[metric] = {};
    for (const [key, value] of Object.entries(targets[metric] || {})) {
      if (Object.prototype.hasOwnProperty.call(merged[metric], key)) continue;
      merged[metric][key] = value;
      written[metric][key] = value;
    }
  }
  return { maps: merged, written };
}
