// ============================================================================
// erp-demo-seed-core.js — pure generator of the one-click demo sample data
// ERP DEMO 4.3.1 · ADR-013
// ----------------------------------------------------------------------------
// Builds ~3 months of realistic Thai SME history (quotations, invoices in every
// payment state, receipts incl. 3% WHT, a combined billing payment, credit notes,
// expenses) RELATIVE to a given business date, so "overdue" and the aging buckets
// mean the same thing whenever the demo runs.
//
// Rules this module keeps:
// - DOM/storage free and deterministic: the same `today` + `numberStart` always
//   gives the same plan (no Date.now(), no Math.random()).
// - Every record goes through the app's OWN pure builders and validators
//   (calculateVatSummary, calculateWhtSummary, plan*DocumentAction,
//   buildBillingAction, planBillingPaymentAction, buildPaymentReceiptDrafts,
//   validateCreditNote + buildCreditNoteRecord). Totals are never typed by hand.
// - Every record carries `demoSeed: true` + `demoSeedBatch`, so the load / reset prompts can
//   tell sample data from what the user typed, and Trial usage limits ignore sample data.
// - demoResetStorageKeys() is the one definition of "this app's data keys" that
//   "ล้างข้อมูลสาธิตทั้งหมด (รีเซ็ต)" removes (never another tenant's or another app's keys).
// - Document numbers use the app's running-number format (PREFIX + BE yy + mm +
//   2-digit sequence; BL/PAY as in erp-order-flow.js) and continue after the
//   highest number already stored (`numberStart`), so they never collide.
// ============================================================================
import { roundMoneyValue, buyerBranchFromContact, calculateVatSummary, calculateWhtSummary, unitPriceForVatMode, addBusinessCalendarDays, parseBusinessDate, businessDaysBetween, GENERAL_CUSTOMER_NAME, TAX_INVOICE_FORM_FULL, TAX_INVOICE_FORM_ABBREVIATED } from './erp-shared-core.js';
import { toBEYear, withThaiCalendarMeta } from './erp-date-core.js';
import { planQuoteDocumentAction, planInvoiceDocumentAction, planReceiptDocumentAction, planExpenseDocumentAction, buildBillingAction, planBillingPaymentAction, buildPaymentReceiptDrafts } from './erp-document-finance-core.js';
import { validateCreditNote, buildCreditNoteRecord, creditNoteBuyerBranchLabel } from './erp-credit-note-core.js';
import { applyDocumentCancel, cancelReasonText } from './erp-document-cancel-core.js';
import { addTaxPeriods, taxPeriodOfDate, taxPeriodLastDay, taxPeriodFirstDay } from './erp-tax-reports-core.js';
import { invoiceTermDueDate } from './erp-receivables-core.js';
import { validateProductMasterRecord } from './erp-master-data-core.js';
import { PRODUCT_EXPERIENCE_MODE_KEY, NAV_COLLAPSED_SECTIONS_KEY, LEGACY_ORDER_FLOW_STORE_KEY, COMPANY_PROFILE_KEY, COMPANY_LOGO_KEY, COMPANY_BRANCH_SETTING_KEY, SALES_TARGETS_KEY, DELIVERY_TARGETS_KEY, SALES_TARGET_PERIODS_KEY, DELIVERY_TARGET_PERIODS_KEY } from './erp-storage-contracts.js';

export const DEMO_SEED_CORE_VERSION = '1.2.0';
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
  { key: 'S_UL', id: 'demo-seed-s01', name: 'บจก. อุบลแลนด์', entityType: 'company', taxId: '0345556001011', branchCode: '00000', branchName: 'สำนักงานใหญ่', address: '45 ถนนแจ้งสนิท ตำบลในเมือง อำเภอเมืองอุบลราชธานี จังหวัดอุบลราชธานี 34000', phone: '045-311-450' },
  { key: 'S_KP', id: 'demo-seed-s02', name: 'บจก. ขอนแก่นพร็อพเพอร์ตี้', entityType: 'company', taxId: '0405557002029', branchCode: '00000', branchName: 'สำนักงานใหญ่', address: '77 ถนนประชาสโมสร ตำบลในเมือง อำเภอเมืองขอนแก่น จังหวัดขอนแก่น 40000', phone: '043-224-077' },
  { key: 'S_NET', id: 'demo-seed-s03', name: 'บจก. อีสานไฟเบอร์เน็ต', entityType: 'company', taxId: '0345560003031', branchCode: '00002', branchName: 'สาขาอุบลราชธานี', address: '9/1 ถนนชยางกูร ตำบลในเมือง อำเภอเมืองอุบลราชธานี จังหวัดอุบลราชธานี 34000', phone: '045-200-009' },
  { key: 'S_IT', id: 'demo-seed-s04', name: 'บจก. ไอทีซัพพลาย อีสาน', entityType: 'company', taxId: '0105558004044', branchCode: '00000', branchName: 'สำนักงานใหญ่', address: '210 ถนนพหลโยธิน แขวงสามเสนใน เขตพญาไท กรุงเทพมหานคร 10400', phone: '02-279-0210' },
  { key: 'S_OFF', id: 'demo-seed-s05', name: 'บจก. ออฟฟิศพลัส เซ็นเตอร์', entityType: 'company', taxId: '0345562005058', branchCode: '00002', branchName: 'สาขาวารินชำราบ', address: '18 ถนนสถลมาร์ค ตำบลวารินชำราบ อำเภอวารินชำราบ จังหวัดอุบลราชธานี 34190', phone: '045-322-018' },
  { key: 'S_PUMP', id: 'demo-seed-s06', name: 'หจก. วารินปิโตรเลียม', entityType: 'company', taxId: '0345559006065', branchCode: '00000', branchName: 'สำนักงานใหญ่', address: '300 ถนนสถลมาร์ค ตำบลแสนสุข อำเภอวารินชำราบ จังหวัดอุบลราชธานี 34190', phone: '045-321-300' },
  { key: 'S_SHOP', id: 'demo-seed-s07', name: 'ร้านเครื่องเขียนมิตรภาพ', entityType: 'person', taxId: '3109900543215', branchCode: '00000', branchName: 'สำนักงานใหญ่', address: '12 ถนนพโลรังฤทธิ์ ตำบลในเมือง อำเภอเมืองอุบลราชธานี จังหวัดอุบลราชธานี 34000', phone: '045-254-012' },
  { key: 'S_CLOUD', id: 'demo-seed-s08', name: 'บจก. คลาวด์โซลูชั่น ไทย', entityType: 'company', taxId: '0105561007075', branchCode: '00000', branchName: 'สำนักงานใหญ่', address: '88 ถนนสีลม แขวงสุริยวงศ์ เขตบางรัก กรุงเทพมหานคร 10500', phone: '02-233-0088' }
]);

// Product master rows in the same shape as app.js saveProductMasterLocal().
// Inventory items carry opening stock per branch so seeded sales never make stock negative.
const PRODUCTS = Object.freeze([
  { code: 'DEMO-NB01', name: 'โน้ตบุ๊กธุรกิจ 14 นิ้ว (Core i5 / RAM 16GB)', category: 'คอมพิวเตอร์และอุปกรณ์', unit: 'เครื่อง', flowType: 'inventory', fulfillmentType: 'stock', openingStockUbon: 15, openingStockKhonkaen: 10, reorderPoint: 3, standardCost: 19500, defaultPrice: 24900, defaultSupplier: 'ดิสทริบิวเตอร์ไอทีตัวอย่าง จำกัด' },
  { code: 'DEMO-MN01', name: 'จอมอนิเตอร์ 24 นิ้ว IPS', category: 'คอมพิวเตอร์และอุปกรณ์', unit: 'เครื่อง', flowType: 'inventory', fulfillmentType: 'stock', openingStockUbon: 30, openingStockKhonkaen: 20, reorderPoint: 5, standardCost: 3200, defaultPrice: 4290, defaultSupplier: 'ดิสทริบิวเตอร์ไอทีตัวอย่าง จำกัด' },
  { code: 'DEMO-UP01', name: 'เครื่องสำรองไฟ UPS 1000VA', category: 'ไฟฟ้าและสำรองไฟ', unit: 'เครื่อง', flowType: 'inventory', fulfillmentType: 'stock', openingStockUbon: 20, openingStockKhonkaen: 15, reorderPoint: 4, standardCost: 2650, defaultPrice: 3590, defaultSupplier: 'ดิสทริบิวเตอร์ไอทีตัวอย่าง จำกัด' },
  { code: 'DEMO-NW01', name: 'ชุดอุปกรณ์เครือข่ายสำนักงาน (Switch + Access Point)', category: 'ระบบเครือข่าย', unit: 'ชุด', flowType: 'non_inventory', fulfillmentType: 'made_to_order', openingStockUbon: 0, openingStockKhonkaen: 0, reorderPoint: 0, standardCost: 9800, defaultPrice: 13500, defaultSupplier: 'ดิสทริบิวเตอร์ไอทีตัวอย่าง จำกัด' },
  { code: 'DEMO-PR01', name: 'เครื่องพิมพ์เลเซอร์มัลติฟังก์ชัน (พิมพ์/สแกน/ถ่ายเอกสาร)', category: 'คอมพิวเตอร์และอุปกรณ์', unit: 'เครื่อง', flowType: 'inventory', fulfillmentType: 'stock', openingStockUbon: 8, openingStockKhonkaen: 6, reorderPoint: 2, standardCost: 6900, defaultPrice: 8990, defaultSupplier: 'ดิสทริบิวเตอร์ไอทีตัวอย่าง จำกัด' },
  { code: 'DEMO-TN01', name: 'ตลับหมึกเลเซอร์ (ของแท้) สำหรับ DEMO-PR01', category: 'วัสดุสิ้นเปลือง', unit: 'ตลับ', flowType: 'inventory', fulfillmentType: 'stock', openingStockUbon: 40, openingStockKhonkaen: 30, reorderPoint: 10, standardCost: 1650, defaultPrice: 2290, defaultSupplier: 'ดิสทริบิวเตอร์ไอทีตัวอย่าง จำกัด' },
  { code: 'DEMO-KB01', name: 'ชุดคีย์บอร์ดและเมาส์ไร้สาย', category: 'คอมพิวเตอร์และอุปกรณ์', unit: 'ชุด', flowType: 'inventory', fulfillmentType: 'stock', openingStockUbon: 25, openingStockKhonkaen: 20, reorderPoint: 5, standardCost: 690, defaultPrice: 990, defaultSupplier: 'ดิสทริบิวเตอร์ไอทีตัวอย่าง จำกัด' },
  { code: 'DEMO-CC01', name: 'ชุดกล้องวงจรปิด IP 4 ตัว พร้อมเครื่องบันทึก', category: 'ระบบรักษาความปลอดภัย', unit: 'ชุด', flowType: 'non_inventory', fulfillmentType: 'made_to_order', openingStockUbon: 0, openingStockKhonkaen: 0, reorderPoint: 0, standardCost: 11800, defaultPrice: 16500, defaultSupplier: 'ดิสทริบิวเตอร์ไอทีตัวอย่าง จำกัด' },
  { code: 'DEMO-SW01', name: 'Microsoft 365 Business Standard (1 ปี)', category: 'ซอฟต์แวร์และลิขสิทธิ์', unit: 'ชุด', flowType: 'non_inventory', fulfillmentType: 'made_to_order', openingStockUbon: 0, openingStockKhonkaen: 0, reorderPoint: 0, standardCost: 4200, defaultPrice: 5390, defaultSupplier: 'ดิสทริบิวเตอร์ไอทีตัวอย่าง จำกัด' },
  { code: 'DEMO-SV01', name: 'บริการติดตั้งและตั้งค่าระบบเครือข่าย', category: 'บริการ', unit: 'งาน', flowType: 'service', fulfillmentType: 'service', openingStockUbon: 0, openingStockKhonkaen: 0, reorderPoint: 0, standardCost: 3000, defaultPrice: 6500, defaultSupplier: '' },
  { code: 'DEMO-SV02', name: 'บริการบำรุงรักษาระบบรายเดือน (MA)', category: 'บริการ', unit: 'ครั้ง', flowType: 'service', fulfillmentType: 'service', openingStockUbon: 0, openingStockKhonkaen: 0, reorderPoint: 0, standardCost: 1800, defaultPrice: 4500, defaultSupplier: '' },
  { code: 'DEMO-TR01', name: 'บริการอบรมการใช้งานระบบบัญชี', category: 'บริการ', unit: 'ครั้ง', flowType: 'service', fulfillmentType: 'service', openingStockUbon: 0, openingStockKhonkaen: 0, reorderPoint: 0, standardCost: 1500, defaultPrice: 3500, defaultSupplier: '' }
]);

// ------------------------------------------------------------- scenario
// Offsets are calendar days relative to `today` (never positive: no future documents).
// useVat follows the form: 1 = บวก VAT, 0 = ราคารวม VAT แล้ว (แยกภาษี), 2 = ไม่มี VAT.
const QUOTES = Object.freeze([
  { key: 'Q1', branch: 'ubon', customer: 'C1', offset: -84, useVat: 1, approved: true, lines: [['DEMO-NB01', 5], ['DEMO-SV01', 1]], note: 'ราคารวมติดตั้ง ยืนราคา 30 วัน' },
  { key: 'Q5', branch: 'ubon', customer: 'C7', offset: -60, useVat: 1, approved: false, lines: [['DEMO-UP01', 10]], note: 'ลูกค้าขอเปรียบเทียบราคา (ยังไม่อนุมัติ)' },
  { key: 'Q2', branch: 'khonkaen', customer: 'C8', offset: -24, useVat: 1, approved: true, lines: [['DEMO-NB01', 2], ['DEMO-SW01', 2]], note: 'ส่งของภายใน 7 วันหลังอนุมัติ' },
  { key: 'Q3', branch: 'ubon', customer: 'C2', offset: -6, useVat: 1, approved: false, lines: [['DEMO-NB01', 10], ['DEMO-SV01', 1]], note: 'โครงการเปลี่ยนเครื่องทั้งสำนักงาน — รอผู้บริหารอนุมัติ' },
  { key: 'Q4', branch: 'khonkaen', customer: 'C5', offset: -3, useVat: 1, approved: false, lines: [['DEMO-SV02', 12]], note: 'สัญญาบำรุงรักษารายปี 12 ครั้ง' }
]);
// Payment story (with `today` = T; "late" = days past the due date):
// U0 late 100 (over 90) · K1 late 62 (61–90) · U3 price-adjusted, late 45 (31–60) ·
// U4 late 17 (1–30) · U2 partly paid then goods returned, late 10 (1–30) ·
// U5 VAT-inclusive full invoice, due in 5 days · U6 not yet due (credit note issued then
// voided) · U8 no-VAT, not yet due · K6 (from quotation Q2, buyer BRANCH 00003) / K8
// not yet due · U1 (from quotation Q1) / K2 paid · K3 paid with 3% WHT · K4+K5 settled
// by one billing payment · K9 fully credited (training cancelled) · U7/K7 walk-in cash
// sales (abbreviated tax invoices). paymentSummary statuses: paid / partially_paid /
// pending / credited all occur.
// VAT modes: useVat 1 (บวก VAT) on most full invoices, 0 (ราคารวม VAT) on U5 and the
// walk-in sales, 2 (ไม่มี VAT) on U8.
const INVOICES = Object.freeze([
  { key: 'U0', branch: 'ubon', customer: 'C7', offset: -130, useVat: 1, lines: [['DEMO-PR01', 2], ['DEMO-TN01', 10]], note: 'ส่งของครบแล้ว ลูกค้าแจ้งรออนุมัติจ่าย' },
  { key: 'K1', branch: 'khonkaen', customer: 'C4', offset: -92, useVat: 1, lines: [['DEMO-NB01', 4], ['DEMO-MN01', 4]], note: 'ส่งมอบพร้อมติดตั้งที่หน้างาน' },
  { key: 'U1', branch: 'ubon', customer: 'C1', offset: -80, useVat: 1, lines: [['DEMO-NB01', 5], ['DEMO-SV01', 1]], quote: 'Q1' },
  { key: 'U3', branch: 'ubon', customer: 'C3', offset: -75, useVat: 1, lines: [['DEMO-NW01', 1], ['DEMO-SV01', 2]] },
  { key: 'U2', branch: 'ubon', customer: 'C2', offset: -70, useVat: 1, lines: [['DEMO-NB01', 3], ['DEMO-UP01', 3]] },
  { key: 'K2', branch: 'khonkaen', customer: 'C4', offset: -66, useVat: 1, lines: [['DEMO-CC01', 1], ['DEMO-UP01', 4], ['DEMO-SV01', 1]], note: 'ติดตั้งกล้องวงจรปิดและ UPS ที่สำนักงานหน้างาน' },
  { key: 'K4', branch: 'khonkaen', customer: 'C6', offset: -50, useVat: 1, lines: [['DEMO-MN01', 6], ['DEMO-KB01', 6]] },
  { key: 'U4', branch: 'ubon', customer: 'C7', offset: -47, useVat: 1, lines: [['DEMO-MN01', 6], ['DEMO-UP01', 2]] },
  { key: 'K5', branch: 'khonkaen', customer: 'C6', offset: -44, useVat: 1, lines: [['DEMO-SW01', 6], ['DEMO-TR01', 1]] },
  { key: 'K3', branch: 'khonkaen', customer: 'C5', offset: -40, useVat: 1, lines: [['DEMO-SV02', 2], ['DEMO-SV01', 1]] },
  { key: 'K9', branch: 'khonkaen', customer: 'C6', offset: -35, useVat: 1, lines: [['DEMO-TR01', 1]], note: 'อบรมเจ้าหน้าที่พัสดุ (โรงเรียนแจ้งยกเลิกภายหลัง)' },
  { key: 'U5', branch: 'ubon', customer: 'C1', offset: -25, useVat: 0, lines: [['DEMO-SW01', 10]], note: 'ราคาตามใบเสนอราคาเป็นราคารวมภาษีมูลค่าเพิ่มแล้ว' },
  { key: 'K6', branch: 'khonkaen', customer: 'C8', offset: -20, useVat: 1, lines: [['DEMO-NB01', 2], ['DEMO-SW01', 2]], quote: 'Q2' },
  { key: 'U8', branch: 'ubon', customer: 'C9', offset: -12, useVat: 2, lines: [['DEMO-TR01', 1]], note: 'รายการไม่มีภาษีมูลค่าเพิ่ม (ตัวอย่างเอกสารไม่มี VAT)' },
  { key: 'U6', branch: 'ubon', customer: 'C3', offset: -8, useVat: 1, lines: [['DEMO-SV02', 3]] },
  { key: 'K8', branch: 'khonkaen', customer: 'C5', offset: -5, useVat: 1, lines: [['DEMO-SV02', 2]] },
  { key: 'U7', branch: 'ubon', customer: 'WALKIN', offset: -2, useVat: 0, taxInvoiceForm: TAX_INVOICE_FORM_ABBREVIATED, lines: [['DEMO-MN01', 1], ['DEMO-TN01', 2]], note: 'ขายหน้าร้าน ชำระเงินสด' },
  { key: 'K7', branch: 'khonkaen', customer: 'WALKIN', offset: -1, useVat: 0, taxInvoiceForm: TAX_INVOICE_FORM_ABBREVIATED, lines: [['DEMO-UP01', 1], ['DEMO-KB01', 1]], note: 'ขายหน้าร้าน ชำระเงินสด' },
  // ADR-023 — the VAT story of the last closed tax month (the month before `today`, the ภ.พ.30 the
  // presenter files now): `monthEnd` = days before its last day. Three walk-in abbreviated invoices on one
  // day (one line in รายงานภาษีขาย), a full tax invoice cancelled for a wrong buyer establishment and its
  // replacement under a NEW number (ADR-021). All on the month's last day, after every offset-dated
  // invoice of that month, so the running numbers of the earlier sample invoices do not move.
  { key: 'A1', branch: 'ubon', customer: 'WALKIN', monthEnd: 0, useVat: 0, taxInvoiceForm: TAX_INVOICE_FORM_ABBREVIATED, lines: [['DEMO-KB01', 1]], note: 'ขายหน้าร้าน ชำระเงินสด' },
  { key: 'A2', branch: 'ubon', customer: 'WALKIN', monthEnd: 0, useVat: 0, taxInvoiceForm: TAX_INVOICE_FORM_ABBREVIATED, lines: [['DEMO-TN01', 1]], note: 'ขายหน้าร้าน ชำระเงินสด' },
  { key: 'A3', branch: 'ubon', customer: 'WALKIN', monthEnd: 0, useVat: 0, taxInvoiceForm: TAX_INVOICE_FORM_ABBREVIATED, lines: [['DEMO-KB01', 2]], note: 'ขายหน้าร้าน ชำระเงินสด' },
  { key: 'X1', branch: 'ubon', customer: 'C2', monthEnd: 0, useVat: 1, lines: [['DEMO-SV01', 1]], note: 'ติดตั้งเครือข่ายสำนักงานแปลงเกษตร', cancel: { code: 'wrong_details', text: 'ระบุสถานประกอบการของผู้ซื้อผิด ออกฉบับใหม่แทน' } },
  { key: 'X2', branch: 'ubon', customer: 'C2', monthEnd: 0, useVat: 1, lines: [['DEMO-SV01', 1]], note: 'ออกแทนใบกำกับภาษีที่ยกเลิก (ระบุสถานประกอบการของผู้ซื้อผิด)' }
]);
const RECEIPTS = Object.freeze([
  { key: 'R1', invoice: 'U1', offset: -52, kind: 'full', note: 'โอนเข้าบัญชีธนาคาร' },
  { key: 'R3', invoice: 'K2', offset: -38, kind: 'full', note: 'รับเช็คธนาคาร' },
  { key: 'R2', invoice: 'U2', offset: -40, kind: 'partial', amount: 40000, note: 'ลูกค้าแบ่งชำระงวดแรก' },
  { key: 'R4', invoice: 'K3', offset: -9, kind: 'full', whtRate: 3, whtCertReceived: true, note: 'ลูกค้าหักภาษี ณ ที่จ่าย 3% (ค่าบริการ)' },
  { key: 'R5', invoice: 'U7', offset: -2, kind: 'full', note: 'เงินสดหน้าร้าน' },
  { key: 'R6', invoice: 'K7', offset: -1, kind: 'full', note: 'เงินสดหน้าร้าน' },
  { key: 'RA1', invoice: 'A1', monthEnd: 0, kind: 'full', note: 'เงินสดหน้าร้าน' },
  { key: 'RA2', invoice: 'A2', monthEnd: 0, kind: 'full', note: 'เงินสดหน้าร้าน' },
  { key: 'RA3', invoice: 'A3', monthEnd: 0, kind: 'full', note: 'เงินสดหน้าร้าน' }
]);
const CREDIT_NOTES = Object.freeze([
  { key: 'CN2', invoice: 'U2', offset: -30, reasonCode: 'returned_goods', returns: [['DEMO-UP01', 1]], note: 'ลูกค้าคืน UPS 1 เครื่อง (สินค้าเกินความต้องการ) รับกลับเข้าสต็อก' },
  { key: 'CN1', invoice: 'U3', offset: -25, reasonCode: 'price_overcharge', difference: 1500, note: 'ปรับค่าติดตั้งให้ตรงราคาที่ตกลงในใบเสนอราคา' },
  { key: 'CN4', invoice: 'K9', offset: -33, reasonCode: 'service_cancelled', difference: 3500, note: 'โรงเรียนยกเลิกการอบรมก่อนวันจัด — ลดหนี้เต็มจำนวน (ยังไม่มีการชำระเงิน)' },
  { key: 'CN3', invoice: 'U6', offset: -6, reasonCode: 'service_cancelled', difference: 4500, note: 'ลดค่าบริการ MA 1 ครั้ง', voidOffset: -5, voidReason: 'ออกใบลดหนี้ผิด — ลูกค้าใช้บริการครบทุกครั้ง จึงยกเลิกและเก็บเลขที่ไว้' }
]);
const BILLING = Object.freeze({ key: 'BL1', invoices: ['K4', 'K5'], billingOffset: -18, paymentOffset: -7, method: 'โอนเงิน', recipient: 'งานการเงิน โรงเรียน', note: 'วางบิลรวม 2 ใบกำกับภาษี' });
// branchPremises: rent / internet of the second branch's own building — left out when the company has
// one establishment (ADR-022), because that building does not exist then.
// tax (ADR-023): the full tax invoice the supplier issued — VAT split of the gross `amount` (`vatMode`),
// the supplier's TIN / establishment from SUPPLIERS, invoice and received date = the expense date unless
// given, claimed in the month received unless `claimNextMonth`; `claimable: false` + `reason` = ภาษีซื้อต้องห้าม.
// In 'add' mode `amount` is the pre-VAT amount typed, as on the form (the stored amount is the total).
// The online-ads expense keeps no VAT data on purpose: an expense recorded before ADR-023 ("ข้อมูล VAT ไม่ครบ").
const EXPENSES = Object.freeze([
  { branch: 'khonkaen', offset: -88, cat: 'ค่าเช่าสถานที่', vendor: 'บจก. ขอนแก่นพร็อพเพอร์ตี้', desc: 'ค่าเช่าอาคารสาขาขอนแก่น', amount: 9000, docType: 'tax_invoice', taxStatus: 'received', docNo: 'KP-6801', purpose: 'company', branchPremises: true, tax: { supplier: 'S_KP', vatMode: 'extract' } },
  { branch: 'ubon', offset: -86, cat: 'ค่าเช่าสถานที่', vendor: 'บจก. อุบลแลนด์', desc: 'ค่าเช่าอาคารสำนักงานใหญ่', amount: 12000, docType: 'tax_invoice', taxStatus: 'received', docNo: 'UL-6801', purpose: 'company', tax: { supplier: 'S_UL', vatMode: 'extract' } },
  { branch: 'ubon', offset: -58, cat: 'ค่าเช่าสถานที่', vendor: 'บจก. อุบลแลนด์', desc: 'ค่าเช่าอาคารสำนักงานใหญ่', amount: 12000, docType: 'tax_invoice', taxStatus: 'received', docNo: 'UL-6802', purpose: 'company', tax: { supplier: 'S_UL', vatMode: 'extract' } },
  { branch: 'ubon', offset: -55, cat: 'ค่าสาธารณูปโภค', vendor: 'บจก. อีสานไฟเบอร์เน็ต', desc: 'ค่าอินเทอร์เน็ตและโทรศัพท์สำนักงานใหญ่', amount: 4850, docType: 'receipt_tax_invoice', taxStatus: 'received', docNo: 'NET-2291', purpose: 'company', tax: { supplier: 'S_NET', vatMode: 'extract' } },
  { branch: 'khonkaen', offset: -57, cat: 'ค่าเช่าสถานที่', vendor: 'บจก. ขอนแก่นพร็อพเพอร์ตี้', desc: 'ค่าเช่าอาคารสาขาขอนแก่น', amount: 9000, docType: 'tax_invoice', taxStatus: 'received', docNo: 'KP-6802', purpose: 'company', branchPremises: true, tax: { supplier: 'S_KP', vatMode: 'extract' } },
  { branch: 'khonkaen', offset: -45, cat: 'ค่าขนส่ง/จัดส่ง', vendor: 'ขนส่งด่วนอีสาน', desc: 'ค่าส่งจอมอนิเตอร์ให้โรงเรียน', amount: 1200, docType: 'receipt', taxStatus: 'not_required', docNo: 'TR-0457', purpose: 'delivery' },
  { branch: 'ubon', offset: -33, cat: 'ค่าน้ำมันเชื้อเพลิง', vendor: 'ปั๊มน้ำมันตัวอย่าง', desc: 'ค่าน้ำมันรถติดตั้งหน้างาน', amount: 1500, docType: 'receipt', taxStatus: 'requested', docNo: '', purpose: 'customer_job' },
  { branch: 'ubon', offset: -28, cat: 'ค่าเช่าสถานที่', vendor: 'บจก. อุบลแลนด์', desc: 'ค่าเช่าอาคารสำนักงานใหญ่', amount: 12000, docType: 'tax_invoice', taxStatus: 'received', docNo: 'UL-6803', purpose: 'company', tax: { supplier: 'S_UL', vatMode: 'extract' } },
  { branch: 'khonkaen', offset: -27, cat: 'ค่าเช่าสถานที่', vendor: 'บจก. ขอนแก่นพร็อพเพอร์ตี้', desc: 'ค่าเช่าอาคารสาขาขอนแก่น', amount: 9000, docType: 'tax_invoice', taxStatus: 'received', docNo: 'KP-6803', purpose: 'company', branchPremises: true, tax: { supplier: 'S_KP', vatMode: 'extract' } },
  { branch: 'ubon', offset: -15, cat: 'ค่าการตลาด', vendor: 'บจก. โฆษณาออนไลน์ตัวอย่าง', desc: 'โฆษณาออนไลน์แคมเปญโน้ตบุ๊ก', amount: 8000, docType: 'tax_invoice', taxStatus: 'requested', docNo: '', purpose: 'company' },
  { branch: 'khonkaen', offset: -10, cat: 'ค่าสาธารณูปโภค', vendor: 'บจก. อีสานไฟเบอร์เน็ต', desc: 'ค่าอินเทอร์เน็ตสาขาขอนแก่น', amount: 3200, docType: 'receipt_tax_invoice', taxStatus: 'received', docNo: 'NET-4410', purpose: 'company', branchPremises: true, tax: { supplier: 'S_NET', vatMode: 'extract' } },
  // The tax month's purchases (monthEnd = days before the last day of the month before `today`).
  { branch: 'ubon', monthEnd: 20, cat: 'ค่าซื้อสินค้า/วัสดุของบริษัท', vendor: 'บจก. ไอทีซัพพลาย อีสาน', desc: 'อะไหล่และอุปกรณ์สำหรับงานติดตั้ง (สวิตช์ สายแลน หัวต่อ)', amount: 21400, docType: 'tax_invoice', taxStatus: 'received', docNo: 'ITS-6909-0172', purpose: 'customer_job', tax: { supplier: 'S_IT', vatMode: 'extract' } },
  { branch: 'ubon', monthEnd: 18, cat: 'ค่าอุปกรณ์สำนักงาน', vendor: 'ร้านเครื่องเขียนมิตรภาพ', desc: 'เครื่องเขียนและกระดาษ (ใบกำกับภาษีอย่างย่อ)', amount: 535, docType: 'abbreviated_tax_invoice', taxStatus: 'received', docNo: 'AB-1188', purpose: 'company', tax: { supplier: 'S_SHOP', vatMode: 'extract' } },
  { branch: 'ubon', monthEnd: 15, cat: 'ค่าอุปกรณ์สำนักงาน', vendor: 'บจก. ออฟฟิศพลัส เซ็นเตอร์', desc: 'หมึกพิมพ์และอุปกรณ์สำนักงาน', amount: 3000, docType: 'tax_invoice', taxStatus: 'received', docNo: 'OP-25690915', purpose: 'company', tax: { supplier: 'S_OFF', vatMode: 'add' } },
  { branch: 'ubon', monthEnd: 14, cat: 'ค่าน้ำมันเชื้อเพลิง', vendor: 'หจก. วารินปิโตรเลียม', desc: 'น้ำมันรถยนต์นั่งของผู้บริหาร (รถเก๋ง 5 ที่นั่ง)', amount: 1070, docType: 'receipt_tax_invoice', taxStatus: 'received', docNo: 'WP-091677', purpose: 'company', tax: { supplier: 'S_PUMP', vatMode: 'extract', claimable: false, reason: 'passenger_car' } },
  { branch: 'ubon', monthEnd: 5, cat: 'อื่น ๆ', vendor: 'บจก. คลาวด์โซลูชั่น ไทย', desc: 'ค่าบริการคลาวด์และสำรองข้อมูล (ใบกำกับภาษีมาถึงปลายเดือน — ใช้สิทธิ์เดือนถัดไป)', amount: 5350, docType: 'tax_invoice', taxStatus: 'received', docNo: 'CS-2026-0925', purpose: 'company', tax: { supplier: 'S_CLOUD', vatMode: 'extract', receivedMonthEnd: 2, claimNextMonth: true } }
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
// ADR-023: the sample's tax-month story is dated in the last closed tax month (the month before `today`):
// `monthEnd` = calendar days before that month's last day (≤ 20, so it exists in every month).
function lastClosedMonthDay(today, daysBeforeEnd) {
  const lastDay = taxPeriodLastDay(addTaxPeriods(taxPeriodOfDate(today), -1));
  return addBusinessCalendarDays(lastDay, -Math.trunc(Number(daysBeforeEnd) || 0));
}
// The business date of a scenario row: `offset` days from today, or `monthEnd` (above).
function specDate(spec, context) {
  return spec.monthEnd !== undefined ? lastClosedMonthDay(context.today, spec.monthEnd) : context.dateAt(spec.offset);
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
    // QT/INV/REC/CN: 2-digit running number, like getNextDocumentNumber().
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
// { total, paid, credited } → what the customer still owes (VAT-inclusive); a cancelled invoice owes nothing.
function outstandingOf(state) {
  if (state.cancelled) return 0;
  return roundMoneyValue(Math.max(0, state.total - state.credited - state.paid));
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
  record = withThaiCalendarMeta(record, year, month);
  const plan = planInvoiceDocumentAction({ draft: record, original: null, duplicateNumber: false, paymentSummary: null });
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

function buildReceipt(spec, context) {
  const invoiceState = context.invoices.get(spec.invoice);
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
  const invoiceState = context.invoices.get(spec.invoice);
  const invoice = invoiceState.record;
  const date = context.dateAt(spec.offset);
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
    paidByInvoice: row => context.invoices.get(context.invoiceKeyById.get(String(row.id))).paid
  });
  if (!validation.ok) throw new Error(`ใบลดหนี้ตัวอย่าง ${spec.key} ไม่ผ่านการตรวจ: ${validation.errors.join(' / ')}`);
  const at = instantOf(date);
  const base = buildCreditNoteRecord(draft, validation, { id: context.nextId(), at, createdBy: DEMO_SEED_ACTOR, user: DEMO_SEED_ACTOR });
  let record = withThaiCalendarMeta({ ...base, editCount: 0 }, year, month);
  if (spec.voidOffset !== undefined) {
    // Same fields the credit-note void action writes (erp-credit-note.js voidUnlocked()).
    const voidAt = instantOf(context.dateAt(spec.voidOffset));
    record = { ...record, voided: true, status: 'voided', voidedAt: voidAt, voidedBy: DEMO_SEED_ACTOR, voidReason: spec.voidReason, updatedAt: voidAt };
  } else {
    invoiceState.credited = roundMoneyValue(invoiceState.credited + record.total);
  }
  context.creditNotes.push({ ...record, branch: record.branch, _branch: record.branch });
  return record;
}

// Invoice view the billing / payment builders expect (financeInvoiceSnapshot in erp-order-flow.js).
function financeSnapshot(state) {
  const invoice = state.record;
  return { ...invoice, branch: invoice.branch, year: invoice.year, month: invoice.month, outstanding: outstandingOf(state), receiptPaidAtCreation: roundMoneyValue(state.paid) };
}

function buildBillingAndPayment(spec, context) {
  const states = spec.invoices.map(key => context.invoices.get(key));
  const billingDate = context.dateAt(spec.billingOffset);
  const paymentDate = context.dateAt(spec.paymentOffset);
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
  const received = spec.tax.receivedMonthEnd !== undefined ? lastClosedMonthDay(context.today, spec.tax.receivedMonthEnd) : date;
  const claimable = spec.tax.claimable !== false && spec.docType !== 'abbreviated_tax_invoice';
  const receivedPeriod = taxPeriodOfDate(received);
  return {
    vatMode: spec.tax.vatMode, vendorId: supplier.id, vendorTaxId: supplier.taxId, vendorBranchCode: supplier.branchCode, vendorAddress: supplier.address,
    taxInvoiceDate: date, taxInvoiceReceivedDate: received,
    claimPeriod: claimable ? (spec.tax.claimNextMonth ? addTaxPeriods(receivedPeriod, 1) : receivedPeriod) : '',
    inputVatClaimable: claimable, nonClaimableReason: claimable ? '' : (spec.tax.reason || '')
  };
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
    desc: spec.desc,
    amount: spec.amount,
    by: 'ฝ่ายบัญชี',
    docType: spec.docType,
    taxStatus: spec.taxStatus,
    docNo: spec.docNo,
    purpose: spec.purpose,
    note: '',
    attachments: [],
    ...expenseTaxDraft(spec, date, context)
  }, year, month);
  return planExpenseDocumentAction({ draft: record, duplicateDocument: false }).record;
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

// --------------------------------------------------------------- plan
// options: { today: 'YYYY-MM-DD' (business date), numberStart: collectNumberSequences(...),
//            businessRuleVersion: number, branchCount: 1 | 2 (ADR-022, default 2) }
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
  // Event order key (days relative to today) of a scenario row, also for monthEnd-dated rows.
  const offsetOf = spec => (spec.monthEnd !== undefined ? businessDaysBetween(today, lastClosedMonthDay(today, spec.monthEnd)) : spec.offset);
  // Rows of the tax-month story (ADR-023) say so: they follow the calendar month, not `today` − n days.
  const story = (spec, record) => (spec.monthEnd !== undefined ? { ...record, demoSeedStory: 'tax-month' } : record);
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
    creditNotes: []
  };
  const documents = [];
  const flow = { billingNotes: [], payments: [], activity: [] };
  const push = (collection, record) => {
    const tagged = tag(record);
    documents.push({ collection, branch: tagged.branch, year: tagged.year, month: tagged.month, record: tagged });
    return tagged;
  };

  // Every event in date order, so running numbers and ids follow the calendar and
  // each receipt / credit note / payment sees the balances of the days before it.
  const events = [
    ...quoteSpecs.map(spec => ({ offset: offsetOf(spec), order: 0, run: () => { context.quotes.set(spec.key, push('quotes', buildQuote(spec, context))); } })),
    ...invoiceSpecs.map(spec => ({ offset: offsetOf(spec), order: 1, run: () => {
      const record = push('invoices', story(spec, buildInvoice(spec, context)));
      context.invoices.set(spec.key, { record, total: record.total, paid: 0, credited: 0, cancelled: record.voided === true });
      context.invoiceKeyById.set(String(record.id), spec.key);
    } })),
    ...CREDIT_NOTES.map(spec => ({ offset: offsetOf(spec), order: 2, run: () => { push('creditNotes', buildCreditNote(spec, context)); } })),
    ...RECEIPTS.map(spec => ({ offset: offsetOf(spec), order: 3, run: () => { push('receipts', story(spec, buildReceipt(spec, context))); } })),
    { offset: BILLING.paymentOffset, order: 4, run: () => {
      const result = buildBillingAndPayment(BILLING, context);
      flow.billingNotes.push(tag(result.billing));
      flow.payments.push(tag(result.payment));
      flow.activity.push(tag(result.activity));
      result.receipts.forEach(receipt => push('receipts', receipt));
    } },
    ...expenseSpecs.map(spec => ({ offset: offsetOf(spec), order: 5, run: () => { push('expenses', story(spec, buildExpense(spec, context))); } }))
  ];
  events.sort((a, b) => a.offset - b.offset || a.order - b.order).forEach(event => event.run());

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
      outstanding: outstandingOf(state),
      dueDate,
      daysPastDue: businessDaysBetween(dueDate, today)
    };
  }
  const plan = { version: DEMO_SEED_CORE_VERSION, batchId: DEMO_SEED_BATCH_ID, today, documents, flow, contacts: demoSeedContacts(), suppliers: demoSeedSuppliers(), products: demoSeedProducts(branchCount), branchCount, expected };
  assertSeedStockWithinOpening(plan);
  return plan;
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
  const rows = plan.documents.map(({ collection, branch, record }) => ({ branch, date: record.date, scope: collection === 'expenses' ? 'purchase' : 'sales', no: record.no || record.docNo || record.desc }));
  // ADR-023: an input-tax claim belongs to its claim month too — a closed claim month refuses the load.
  plan.documents.filter(({ collection, record }) => collection === 'expenses' && record.claimPeriod).forEach(({ branch, record }) => rows.push({ branch, date: taxPeriodFirstDay(record.claimPeriod), scope: 'purchase', no: record.docNo || record.desc }));
  plan.flow.payments.forEach(payment => rows.push({ branch: payment.branch, date: payment.date, scope: 'sales', no: payment.no }));
  return rows;
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
export const DEMO_RESET_KEPT_BASE_KEYS = Object.freeze([PRODUCT_EXPERIENCE_MODE_KEY, NAV_COLLAPSED_SECTIONS_KEY, COMPANY_PROFILE_KEY, COMPANY_LOGO_KEY, COMPANY_BRANCH_SETTING_KEY, SALES_TARGETS_KEY, DELIVERY_TARGETS_KEY, SALES_TARGET_PERIODS_KEY, DELIVERY_TARGET_PERIODS_KEY]);
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
// Actuals follow the dashboard: sales = invoice value before VAT − live credit notes in their own month
// (analyticsPrimarySalesRows + creditAdjustmentRows); delivery = invoice value before VAT.
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
