// ============================================================================
// erp-journal-core.js — automatic journal entries, ledgers, trial balance and the accountant's month-end figures
// (ADR-029, round 12) · ERP DEMO 4.3.1 · pure: no DOM, no storage, no clock (dates are passed in)
// ----------------------------------------------------------------------------
// Journals are DERIVED: every call recomputes them from the documents (invoices, receipts, credit / debit notes,
// payments, expenses, goods receipts and every costed stock movement of erp-costing-core.js, job cost entries) plus
// the journal's own documents (manual entries, overhead closes, NRV write-downs, opening balances). Nothing is stored,
// nothing is edited by hand, so the books always agree with the documents and with the tax reports built from them.
// Money is satang (integers). Every entry is balanced per establishment (an inter-branch line balances a document
// whose lines sit in two branches) and buildJournal() THROWS when any entry is not (JournalBalanceError).
// A cancelled document keeps its entry and gets a reversing entry dated on the cancel date. Stock and job costs follow
// the costing engine (ADR-028): a voided stock movement / cost entry is not costed at all (only possible in an open
// period; the engine refuses any change of a cost inside a closed period), so those entries follow it.
// Chart of accounts: a default Thai SME chart, codes 1xxx–5xxx. The numbering is a convention of Thai accounting
// software vendors (research report 1.3), NOT a legal requirement — each company maps / renames the accounts.
// ============================================================================
import { toSatang, costRows, isIsoDate, dateNumber } from './erp-costing-core.js';
import { allocateSatang, labourAmountSatang, liveEntries } from './erp-job-costing-core.js';
import { creditNoteInvoiceLive, creditNoteInvoiceBasis, isCreditNoteLive } from './erp-credit-note-core.js';
import { isDebitNoteLive } from './erp-debit-note-core.js';
import { expenseHasVatData, PURCHASE_REPORT_DOC_TYPES, goodsReceiptVatOf, invoiceTaxPointAtPayment, paymentTaxPoints } from './erp-tax-reports-core.js';
import { isWhtCertificateLive, whtPaymentDateOf } from './erp-payer-wht-core.js';
import { effectiveTaxInvoiceForm } from './erp-shared-core.js';
import { invoiceDueDate } from './erp-receivables-core.js';
import { isFxDocument, fxRealisedSatangOf } from './erp-fx-core.js';

export const JOURNAL_CORE_VERSION = '1.0.0';
export const JOURNAL_SCHEMA_VERSION = 1;
export const BRANCHES = Object.freeze(['ubon', 'khonkaen']);
export const ACCOUNT_TYPES = Object.freeze(['asset', 'liability', 'equity', 'revenue', 'expense']);

// ---------------------------------------------------------------- default chart of accounts
// role = the stable id the generator posts to; code / Thai / English name = the default the company may change.
const account = (role, code, type, th, en) => Object.freeze({ role, code, type, th, en });
export const DEFAULT_ACCOUNTS = Object.freeze([
  account('cash', '1111', 'asset', 'เงินสด', 'Cash on hand'),
  account('bank', '1112', 'asset', 'เงินฝากธนาคาร', 'Bank deposits'),
  account('cheque', '1113', 'asset', 'เช็ครับรอนำฝาก', 'Cheques on hand'),
  account('ar', '1130', 'asset', 'ลูกหนี้การค้า', 'Trade receivables'),
  account('wht_prepaid', '1151', 'asset', 'ภาษีเงินได้ถูกหัก ณ ที่จ่าย', 'Withholding tax deducted by customers'),
  account('input_vat', '1154', 'asset', 'ภาษีซื้อ', 'Input VAT'),
  account('input_vat_undue', '1155', 'asset', 'ภาษีซื้อยังไม่ถึงกำหนดใช้สิทธิ', 'Input VAT not yet claimable'),
  account('vat_receivable', '1156', 'asset', 'ภาษีมูลค่าเพิ่มชำระเกิน (ขอคืน / ยกไปเดือนถัดไป)', 'VAT overpaid (refund / carried forward)'),
  account('inventory', '1161', 'asset', 'สินค้าคงเหลือ', 'Inventory'),
  account('inventory_allowance', '1162', 'asset', 'ค่าเผื่อการลดมูลค่าสินค้า (NRV)', 'Allowance for inventory write-down (NRV)'),
  account('wip', '1163', 'asset', 'งานระหว่างทำ', 'Work in progress'),
  account('inter_branch', '1190', 'asset', 'บัญชีระหว่างสาขา', 'Inter-branch account'),
  account('ap', '2111', 'liability', 'เจ้าหนี้การค้า', 'Trade payables'),
  account('wht_pnd3', '2131', 'liability', 'ภาษีหัก ณ ที่จ่ายค้างจ่าย (ภ.ง.ด.3)', 'Withholding tax payable (PND.3)'),
  account('wht_pnd53', '2132', 'liability', 'ภาษีหัก ณ ที่จ่ายค้างจ่าย (ภ.ง.ด.53)', 'Withholding tax payable (PND.53)'),
  // ADR-031 (round 13B): payments abroad — withholding under s.70 and VAT on imported services.
  account('wht_pnd54', '2133', 'liability', 'ภาษีหัก ณ ที่จ่ายค้างจ่าย (ภ.ง.ด.54)', 'Withholding tax payable (PND.54)'),
  account('vat_payable', '2141', 'liability', 'ภาษีมูลค่าเพิ่มค้างชำระ (ภ.พ.30)', 'VAT payable (PP.30)'),
  account('vat_pp36_payable', '2142', 'liability', 'ภาษีมูลค่าเพิ่มค้างนำส่ง (ภ.พ.36)', 'VAT payable on imported services (PP.36)'),
  account('output_vat', '2154', 'liability', 'ภาษีขาย', 'Output VAT'),
  account('output_vat_undue', '2155', 'liability', 'ภาษีขายยังไม่ถึงกำหนดชำระ (บริการ รอรับเงิน)', 'Output VAT not yet due (services, until paid)'),
  account('job_cost_accrued', '2181', 'liability', 'ค่าใช้จ่ายของงานค้างจ่าย (ค่าจ้างช่วง / ค่าใช้จ่ายตรง)', 'Accrued job costs (subcontract / direct costs)'),
  account('suspense', '2190', 'liability', 'บัญชีพักรอตรวจสอบ', 'Suspense (to be checked)'),
  account('opening_equity', '3900', 'equity', 'บัญชีพักยอดยกมา', 'Opening balance clearing'),
  account('sales_goods', '4110', 'revenue', 'รายได้จากการขายสินค้า', 'Sales of goods'),
  account('sales_service', '4120', 'revenue', 'รายได้จากการให้บริการ', 'Service revenue'),
  account('sales_returns', '4130', 'revenue', 'รับคืนสินค้าและส่วนลด (ใบลดหนี้)', 'Sales returns and allowances (credit notes)'),
  account('sales_debit', '4140', 'revenue', 'รายได้เพิ่มตามใบเพิ่มหนี้', 'Additional revenue (debit notes)'),
  // ADR-031: exchange differences — realised when money is received / paid, unrealised at a month end (reversed on day 1).
  account('fx_gain', '4210', 'revenue', 'กำไรจากอัตราแลกเปลี่ยนที่เกิดขึ้นแล้ว', 'Realised foreign exchange gain'),
  account('fx_unrealised_gain', '4220', 'revenue', 'กำไรจากอัตราแลกเปลี่ยนที่ยังไม่เกิดขึ้น', 'Unrealised foreign exchange gain'),
  account('cogs', '5110', 'expense', 'ต้นทุนขาย', 'Cost of sales'),
  account('stock_adjustment', '5120', 'expense', 'ผลต่างจากการตรวจนับและปรับปรุงสินค้า', 'Stock count and adjustment differences'),
  account('nrv_loss', '5130', 'expense', 'ขาดทุนจากการลดมูลค่าสินค้า', 'Loss on inventory write-down'),
  account('labour_applied', '5141', 'expense', 'ค่าแรงทางตรงโอนเข้างาน', 'Direct labour applied to jobs'),
  account('overhead_applied', '5142', 'expense', 'โสหุ้ยการผลิตปันเข้างาน', 'Manufacturing overhead applied'),
  account('job_other_applied', '5143', 'expense', 'ค่าจ้างช่วงและค่าใช้จ่ายตรงโอนเข้างาน', 'Subcontract and direct costs applied to jobs'),
  account('exp_materials', '5210', 'expense', 'ค่าวัสดุและสินค้า (ไม่ผ่านคลัง)', 'Materials and goods (not through stock)'),
  account('exp_wages', '5220', 'expense', 'ค่าแรงและเงินเดือน', 'Wages and salaries'),
  account('exp_rent', '5230', 'expense', 'ค่าเช่า', 'Rent'),
  account('exp_utilities', '5240', 'expense', 'ค่าสาธารณูปโภค', 'Utilities'),
  account('exp_fuel', '5250', 'expense', 'ค่าน้ำมันเชื้อเพลิง', 'Fuel'),
  account('exp_freight', '5260', 'expense', 'ค่าขนส่ง', 'Freight and delivery'),
  account('exp_travel', '5270', 'expense', 'ค่าเดินทางและที่พัก', 'Travel and accommodation'),
  account('exp_entertainment', '5280', 'expense', 'ค่ารับรอง', 'Meals and entertainment'),
  account('exp_office', '5310', 'expense', 'ค่าวัสดุและอุปกรณ์สำนักงาน', 'Office supplies and equipment'),
  account('exp_repair', '5320', 'expense', 'ค่าซ่อมแซมบำรุงรักษา', 'Repairs and maintenance'),
  account('exp_marketing', '5330', 'expense', 'ค่าโฆษณาและการตลาด', 'Advertising and marketing'),
  account('exp_fees', '5340', 'expense', 'ภาษีและค่าธรรมเนียม', 'Taxes and fees'),
  account('exp_other', '5390', 'expense', 'ค่าใช้จ่ายอื่น', 'Other expenses'),
  account('exp_wht_borne', '5410', 'expense', 'ภาษีหัก ณ ที่จ่ายที่บริษัทออกแทน', 'Withholding tax borne by the company'),
  account('fx_loss', '5420', 'expense', 'ขาดทุนจากอัตราแลกเปลี่ยนที่เกิดขึ้นแล้ว', 'Realised foreign exchange loss'),
  account('fx_unrealised_loss', '5430', 'expense', 'ขาดทุนจากอัตราแลกเปลี่ยนที่ยังไม่เกิดขึ้น', 'Unrealised foreign exchange loss')
]);
export const DEFAULT_ACCOUNT_ROLES = Object.freeze(DEFAULT_ACCOUNTS.map(row => row.role));
const DEFAULT_BY_ROLE = new Map(DEFAULT_ACCOUNTS.map(row => [row.role, row]));
export const EXPENSE_ROLES = Object.freeze(DEFAULT_ACCOUNTS.filter(row => row.role.startsWith('exp_') && row.role !== 'exp_wht_borne').map(row => row.role));
// The expense categories of the expense form (index.html #e-cat) → their default account.
export const DEFAULT_CATEGORY_ROLES = Object.freeze({
  'ค่าน้ำมันเชื้อเพลิง': 'exp_fuel',
  'ค่าซื้อสินค้า/วัสดุของบริษัท': 'exp_materials',
  'ค่าวัตถุดิบ': 'exp_materials',
  'ค่าอุปกรณ์สำนักงาน': 'exp_office',
  'ค่าขนส่ง/จัดส่ง': 'exp_freight',
  'ค่าเดินทาง/ที่พัก': 'exp_travel',
  'ค่าอาหาร/รับรอง': 'exp_entertainment',
  'ค่าสาธารณูปโภค': 'exp_utilities',
  'ค่าซ่อมบำรุง': 'exp_repair',
  'ค่าเช่าสถานที่': 'exp_rent',
  'ค่าแรงงาน': 'exp_wages',
  'ค่าการตลาด': 'exp_marketing',
  'ภาษี/ค่าธรรมเนียม': 'exp_fees',
  'อื่น ๆ': 'exp_other'
});
// Posting choices the documents do not determine (which cash / bank account): configurable, and every entry that
// used one is flagged so the accountant can check it.
export const POSTING_CHOICES = Object.freeze({
  receiptAccount: Object.freeze(['bank', 'cash', 'cheque']),
  cashSaleAccount: Object.freeze(['cash', 'bank']),
  expensePaidFrom: Object.freeze(['cash', 'bank', 'ap']),
  refundAccount: Object.freeze(['cash', 'bank'])
});
export const DEFAULT_POSTING = Object.freeze({ receiptAccount: 'bank', cashSaleAccount: 'cash', expensePaidFrom: 'bank', refundAccount: 'cash' });
// Payment method of an order-flow payment (erp-order-flow.js "วิธีชำระ") → its account.
export const PAYMENT_METHOD_ROLES = Object.freeze({ 'โอนเงิน': 'bank', 'เงินสด': 'cash', 'เช็ค': 'cheque' });

// ---------------------------------------------------------------- PEAK journal import (column mapping)
// The real PEAK template ("Excel Format PEAK", บัญชีรายวัน) can be downloaded only inside PEAK Pro Plus (research report
// 1.3): these columns are a BEST GUESS that the accountant must check against the real template before use. Each
// column = a header text the user can change + the field it takes from the journal.
export const PEAK_FIELDS = Object.freeze(['date', 'entryNo', 'docNo', 'description', 'accountCode', 'accountName', 'debit', 'credit', 'branchCode', 'party', 'kind', 'blank']);
export const PEAK_DATE_FORMATS = Object.freeze(['dmy-ad', 'dmy-be', 'iso']);
export const DEFAULT_PEAK_COLUMNS = Object.freeze([
  Object.freeze({ header: 'วันที่เอกสาร', field: 'date' }),
  Object.freeze({ header: 'เลขที่เอกสาร', field: 'entryNo' }),
  Object.freeze({ header: 'อ้างอิง', field: 'docNo' }),
  Object.freeze({ header: 'คำอธิบาย', field: 'description' }),
  Object.freeze({ header: 'รหัสบัญชี', field: 'accountCode' }),
  Object.freeze({ header: 'ชื่อบัญชี', field: 'accountName' }),
  Object.freeze({ header: 'เดบิต', field: 'debit' }),
  Object.freeze({ header: 'เครดิต', field: 'credit' }),
  Object.freeze({ header: 'สาขา', field: 'branchCode' })
]);

// ---------------------------------------------------------------- small helpers
const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const branchOf = record => text(record?._branch || record?.branch);
export class JournalBalanceError extends Error {
  constructor(entry, debit, credit, branch = '') {
    super(`สมุดรายวันไม่สมดุล: ${entry.kind} ${entry.docNo || entry.id} (${entry.date}${branch ? ` · ${branch}` : ''}) เดบิต ${(debit / 100).toFixed(2)} ≠ เครดิต ${(credit / 100).toFixed(2)}`);
    this.name = 'JournalBalanceError';
    this.code = 'journal_unbalanced';
    this.entryId = entry.id;
    this.debit = debit;
    this.credit = credit;
  }
}
// An ISO instant (voidedAt / cancelledAt) → the business date in Thailand (UTC+7, no daylight saving), so the reversal
// date never depends on the device's time zone. '' when it cannot be read.
export function bangkokDateOf(instant) {
  const raw = text(instant);
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return isIsoDate(raw) ? raw : '';
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms + 7 * 3600 * 1000).toISOString().slice(0, 10);
}
export function monthOf(date) {
  return isIsoDate(date) ? date.slice(0, 7) : '';
}
export function monthFirstDay(period) {
  return `${period}-01`;
}
export function monthLastDay(period) {
  const [year, month] = String(period).split('-').map(Number);
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${period}-${String(day).padStart(2, '0')}`;
}
export function addDays(date, days) {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return new Date(ms + days * 86400000).toISOString().slice(0, 10);
}
const laterDate = (a, b) => (dateNumber(a) >= dateNumber(b) ? a : b);

// ---------------------------------------------------------------- settings (comform_journal_settings_v1)
// { schemaVersion: 1, accounts: { [role]: { code, name } } (overrides; name '' = the default name),
//   custom: [{ id, code, name, type }], categories: { [expense category]: role }, posting: { receiptAccount,
//   cashSaleAccount, expensePaidFrom, refundAccount }, peak: { columns: [{ header, field }], dateFormat },
//   export: { cogsMonthEnd }, updatedAt }
export function defaultJournalSettings() {
  return {
    schemaVersion: JOURNAL_SCHEMA_VERSION,
    accounts: {},
    custom: [],
    categories: {},
    posting: { ...DEFAULT_POSTING },
    peak: { columns: DEFAULT_PEAK_COLUMNS.map(column => ({ ...column })), dateFormat: 'dmy-ad' },
    export: { cogsMonthEnd: false },
    updatedAt: ''
  };
}
const SETTINGS_FIELDS = Object.freeze(['schemaVersion', 'accounts', 'custom', 'categories', 'posting', 'peak', 'export', 'updatedAt']);
const CODE_RE = /^[0-9A-Za-z][0-9A-Za-z.-]{0,11}$/;
const CUSTOM_ID_RE = /^cust-[a-z0-9]{1,24}$/;
const safeKey = key => typeof key === 'string' && key.length > 0 && key.length <= 120 && !['__proto__', 'prototype', 'constructor'].includes(key);
const cleanName = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
// Strict reader (fail-closed): anything malformed throws (code 'journal_store'); null / '' = never saved → defaults.
export function normalizeJournalSettings(raw) {
  const fail = detail => { throw Object.assign(new Error(`ข้อมูลผังบัญชีและการลงบัญชีไม่ถูกต้อง: ${detail} — ระบบหยุดเพื่อไม่ให้ลงบัญชีผิด`), { code: 'journal_store' }); };
  if (raw === null || raw === undefined || raw === '') return defaultJournalSettings();
  let value = raw;
  if (typeof raw === 'string') { try { value = JSON.parse(raw); } catch (error) { fail(`อ่าน JSON ไม่ได้ (${error.message})`); } }
  if (!isObject(value)) fail('ต้องเป็น object');
  for (const key of Object.keys(value)) if (!SETTINGS_FIELDS.includes(key)) fail(`ช่อง ${key}`);
  if (value.schemaVersion !== JOURNAL_SCHEMA_VERSION) fail('schemaVersion');
  const out = defaultJournalSettings();
  if (value.accounts !== undefined) {
    if (!isObject(value.accounts)) fail('accounts');
    for (const [role, row] of Object.entries(value.accounts)) {
      if (!DEFAULT_BY_ROLE.has(role) || !isObject(row)) fail(`accounts.${role}`);
      for (const key of Object.keys(row)) if (!['code', 'name'].includes(key)) fail(`accounts.${role}.${key}`);
      const code = text(row.code);
      const name = cleanName(row.name);
      if (!CODE_RE.test(code)) fail(`รหัสบัญชีของ ${role}`);
      if (name.length > 120) fail(`ชื่อบัญชีของ ${role}`);
      out.accounts[role] = { code, name };
    }
  }
  if (value.custom !== undefined) {
    if (!Array.isArray(value.custom) || value.custom.length > 300) fail('custom');
    const ids = new Set();
    out.custom = value.custom.map((row, index) => {
      if (!isObject(row)) fail(`custom ${index + 1}`);
      for (const key of Object.keys(row)) if (!['id', 'code', 'name', 'type'].includes(key)) fail(`custom ${index + 1}.${key}`);
      if (!CUSTOM_ID_RE.test(String(row.id)) || ids.has(row.id)) fail(`custom ${index + 1} id`);
      ids.add(row.id);
      const code = text(row.code);
      const name = cleanName(row.name);
      if (!CODE_RE.test(code) || !name || name.length > 120 || !ACCOUNT_TYPES.includes(row.type)) fail(`custom ${index + 1}`);
      return { id: row.id, code, name, type: row.type };
    });
  }
  if (value.categories !== undefined) {
    if (!isObject(value.categories)) fail('categories');
    for (const [category, role] of Object.entries(value.categories)) {
      if (!safeKey(category) || !EXPENSE_ROLES.includes(role)) fail(`categories.${category}`);
      out.categories[category] = role;
    }
  }
  if (value.posting !== undefined) {
    if (!isObject(value.posting)) fail('posting');
    for (const [key, choice] of Object.entries(value.posting)) {
      if (!hasOwn(POSTING_CHOICES, key) || !POSTING_CHOICES[key].includes(choice)) fail(`posting.${key}`);
      out.posting[key] = choice;
    }
  }
  if (value.peak !== undefined) {
    if (!isObject(value.peak)) fail('peak');
    for (const key of Object.keys(value.peak)) if (!['columns', 'dateFormat'].includes(key)) fail(`peak.${key}`);
    if (value.peak.columns !== undefined) {
      if (!Array.isArray(value.peak.columns) || !value.peak.columns.length || value.peak.columns.length > 40) fail('peak.columns');
      out.peak.columns = value.peak.columns.map((column, index) => {
        if (!isObject(column) || !PEAK_FIELDS.includes(column.field)) fail(`peak.columns ${index + 1}`);
        const header = cleanName(column.header);
        if (!header || header.length > 60) fail(`peak.columns ${index + 1} header`);
        return { header, field: column.field };
      });
    }
    if (value.peak.dateFormat !== undefined) {
      if (!PEAK_DATE_FORMATS.includes(value.peak.dateFormat)) fail('peak.dateFormat');
      out.peak.dateFormat = value.peak.dateFormat;
    }
  }
  if (value.export !== undefined) {
    if (!isObject(value.export)) fail('export');
    for (const [key, flag] of Object.entries(value.export)) {
      if (key !== 'cogsMonthEnd' || typeof flag !== 'boolean') fail(`export.${key}`);
      out.export.cogsMonthEnd = flag;
    }
  }
  out.updatedAt = String(value.updatedAt || '');
  return out;
}

// ---------------------------------------------------------------- the effective chart
// → Map(accountId → { id, code, name (the company's own name or ''), th, en (default names), type, custom })
export function effectiveChart(settings = defaultJournalSettings()) {
  const chart = new Map();
  for (const row of DEFAULT_ACCOUNTS) {
    const own = settings.accounts?.[row.role];
    chart.set(row.role, { id: row.role, code: own?.code || row.code, name: own?.name || '', th: row.th, en: row.en, type: row.type, custom: false });
  }
  for (const row of settings.custom || []) chart.set(row.id, { id: row.id, code: row.code, name: row.name, th: row.name, en: row.name, type: row.type, custom: true });
  return chart;
}
// Validation of a chart (every account that the journals use must be mapped to a code; one code = one account):
// → [{ code: 'missing' | 'duplicate_code' | 'type_conflict', account, other, accountCode }]
export function validateChart(chart, usedIds = null) {
  const errors = [];
  const byCode = new Map();
  for (const row of chart.values()) {
    if (!row.code || !CODE_RE.test(row.code)) {
      if (!usedIds || usedIds.has(row.id)) errors.push({ code: 'missing', account: row.id });
      continue;
    }
    const other = byCode.get(row.code);
    if (other) {
      if (other.type !== row.type) errors.push({ code: 'type_conflict', account: row.id, other: other.id, accountCode: row.code });
      else if ((row.name || row.th) !== (other.name || other.th)) errors.push({ code: 'duplicate_code', account: row.id, other: other.id, accountCode: row.code });
    } else byCode.set(row.code, row);
  }
  if (usedIds) for (const id of usedIds) if (!chart.has(id)) errors.push({ code: 'missing', account: id });
  return errors;
}
export function categoryRole(settings, category) {
  const key = text(category);
  if (settings?.categories && hasOwn(settings.categories, key)) return { role: settings.categories[key], known: true };
  if (hasOwn(DEFAULT_CATEGORY_ROLES, key)) return { role: DEFAULT_CATEGORY_ROLES[key], known: true };
  return { role: 'exp_other', known: false };
}

// ---------------------------------------------------------------- journal documents (comform_journal_documents_v1)
// { schemaVersion: 1, manual: [entry], closes: [overhead close], nrv: [write-down], opening: [import batch],
//   openingDate: '' | 'YYYY-MM-DD' } — all amounts in satang. Cancel-not-delete: status 'voided' + voidDate (the
// reversal's date, a business date), voidedAt, voidedBy, voidReason.
export function emptyJournalDocuments() {
  return { schemaVersion: JOURNAL_SCHEMA_VERSION, manual: [], closes: [], nrv: [], opening: [], openingDate: '' };
}
const DOC_ID_RE = /^[\w.:-]{1,80}$/;
const VOID_FIELDS = Object.freeze(['status', 'createdAt', 'createdBy', 'voidedAt', 'voidedBy', 'voidReason', 'voidDate']);
const isSatang = value => Number.isSafeInteger(value);
export function normalizeJournalDocuments(raw) {
  const fail = detail => { throw Object.assign(new Error(`ข้อมูลรายการบัญชีที่บันทึกไว้ไม่ถูกต้อง: ${detail} — ระบบหยุดเพื่อไม่ให้ลงบัญชีผิด`), { code: 'journal_store' }); };
  if (raw === null || raw === undefined || raw === '') return emptyJournalDocuments();
  let value = raw;
  if (typeof raw === 'string') { try { value = JSON.parse(raw); } catch (error) { fail(`อ่าน JSON ไม่ได้ (${error.message})`); } }
  if (!isObject(value)) fail('ต้องเป็น object');
  for (const key of Object.keys(value)) if (!['schemaVersion', 'manual', 'closes', 'nrv', 'opening', 'openingDate'].includes(key)) fail(`ช่อง ${key}`);
  if (value.schemaVersion !== JOURNAL_SCHEMA_VERSION) fail('schemaVersion');
  for (const key of ['manual', 'closes', 'nrv', 'opening']) if (value[key] !== undefined && !Array.isArray(value[key])) fail(key);
  if (value.openingDate !== undefined && value.openingDate !== '' && !isIsoDate(value.openingDate)) fail('openingDate');
  const ids = new Set();
  const base = (row, at, extra) => {
    if (!isObject(row)) fail(at);
    for (const key of Object.keys(row)) if (![...VOID_FIELDS, ...extra].includes(key)) fail(`${at} ช่อง ${key}`);
    if (!DOC_ID_RE.test(String(row.id || '')) || ids.has(row.id)) fail(`${at} รหัส`);
    ids.add(row.id);
    if (!['posted', 'voided'].includes(row.status)) fail(`${at} สถานะ`);
    if (!isIsoDate(row.date)) fail(`${at} วันที่`);
    if (row.status === 'voided' && !isIsoDate(row.voidDate)) fail(`${at} วันที่ยกเลิก`);
    return { id: row.id, status: row.status, date: row.date, createdAt: String(row.createdAt || ''), createdBy: cleanName(row.createdBy), voidedAt: String(row.voidedAt || ''), voidedBy: cleanName(row.voidedBy), voidReason: cleanName(row.voidReason), voidDate: row.status === 'voided' ? row.voidDate : '' };
  };
  const branchOk = branch => BRANCHES.includes(branch);
  const manual = (value.manual || []).map((row, index) => {
    const at = `รายการบัญชีด้วยมือ ${index + 1}`;
    const out = base(row, at, ['id', 'no', 'date', 'branch', 'memo', 'lines']);
    if (!branchOk(row.branch)) fail(`${at} สาขา`);
    if (!Array.isArray(row.lines) || row.lines.length < 2 || row.lines.length > 200) fail(`${at} บรรทัด`);
    let debit = 0;
    let credit = 0;
    const lines = row.lines.map((line, i) => {
      if (!isObject(line)) fail(`${at} บรรทัด ${i + 1}`);
      for (const key of Object.keys(line)) if (!['account', 'debit', 'credit', 'memo', 'openItem'].includes(key)) fail(`${at} บรรทัด ${i + 1} ช่อง ${key}`);
      if (!(DEFAULT_BY_ROLE.has(line.account) || CUSTOM_ID_RE.test(String(line.account)))) fail(`${at} บรรทัด ${i + 1} บัญชี`);
      if (!isSatang(line.debit) || !isSatang(line.credit) || line.debit < 0 || line.credit < 0 || (line.debit > 0) === (line.credit > 0)) fail(`${at} บรรทัด ${i + 1} จำนวนเงิน`);
      debit += line.debit;
      credit += line.credit;
      return { account: line.account, debit: line.debit, credit: line.credit, memo: cleanName(line.memo).slice(0, 200), openItem: text(line.openItem).slice(0, 160) };
    });
    if (debit !== credit || debit <= 0) fail(`${at} เดบิตไม่เท่าเครดิต`);
    return { ...out, no: text(row.no), branch: row.branch, memo: cleanName(row.memo).slice(0, 300), lines };
  });
  const closes = (value.closes || []).map((row, index) => {
    const at = `การปิดผลต่างโสหุ้ย ${index + 1}`;
    const out = base(row, at, ['id', 'date', 'branch', 'period', 'applied', 'actual', 'cogs']);
    if (!branchOk(row.branch) || !/^\d{4}-\d{2}$/.test(String(row.period)) || row.date !== monthLastDay(row.period)) fail(`${at} งวด`);
    if (!isSatang(row.applied) || !isSatang(row.cogs) || !isObject(row.actual)) fail(`${at} จำนวนเงิน`);
    let actual = 0;
    for (const [role, amount] of Object.entries(row.actual)) {
      if (!EXPENSE_ROLES.includes(role) || !isSatang(amount)) fail(`${at} ${role}`);
      actual += amount;
    }
    if (row.applied + row.cogs !== actual) fail(`${at} ไม่สมดุล`);
    return { ...out, branch: row.branch, period: row.period, applied: row.applied, actual: { ...row.actual }, cogs: row.cogs };
  });
  const nrv = (value.nrv || []).map((row, index) => {
    const at = `การลดมูลค่าสินค้า ${index + 1}`;
    const out = base(row, at, ['id', 'date', 'branch', 'target', 'delta', 'rows']);
    if (!branchOk(row.branch) || !isSatang(row.target) || !isSatang(row.delta) || row.target < 0 || !row.delta) fail(`${at}`);
    if (!Array.isArray(row.rows) || row.rows.length > 2000) fail(`${at} รายการสินค้า`);
    const rows = row.rows.map((item, i) => {
      if (!isObject(item) || !text(item.sku) || !isSatang(item.writeDown) || item.writeDown < 0) fail(`${at} สินค้า ${i + 1}`);
      return { sku: text(item.sku).slice(0, 300), writeDown: item.writeDown };
    });
    return { ...out, branch: row.branch, target: row.target, delta: row.delta, rows };
  });
  const opening = (value.opening || []).map((row, index) => {
    const at = `ยอดยกมา ${index + 1}`;
    const out = base(row, at, ['id', 'kind', 'date', 'rows', 'total']);
    if (!['ar', 'ap', 'stock'].includes(row.kind) || !Array.isArray(row.rows) || !row.rows.length || row.rows.length > 5000) fail(`${at}`);
    let total = 0;
    const rows = row.rows.map((item, i) => {
      if (!isObject(item) || !branchOk(item.branch)) fail(`${at} แถว ${i + 1}`);
      if (row.kind === 'stock') {
        if (!text(item.code) || !isSatang(item.qtyMilli) || item.qtyMilli < 0 || !isSatang(item.unitCost) || item.unitCost < 0) fail(`${at} แถว ${i + 1}`);
        return { branch: item.branch, code: text(item.code), name: text(item.name), qtyMilli: item.qtyMilli, unitCost: item.unitCost };
      }
      if (!text(item.name) || !isSatang(item.amount) || item.amount <= 0 || (item.docDate && !isIsoDate(item.docDate)) || (item.dueDate && !isIsoDate(item.dueDate))) fail(`${at} แถว ${i + 1}`);
      total += item.amount;
      return { branch: item.branch, name: text(item.name).slice(0, 200), code: text(item.code).slice(0, 60), docNo: text(item.docNo).slice(0, 60), docDate: item.docDate || '', dueDate: item.dueDate || '', amount: item.amount };
    });
    if (row.kind !== 'stock' && total !== row.total) fail(`${at} ยอดรวม`);
    return { ...out, kind: row.kind, rows, total: row.kind === 'stock' ? 0 : total };
  });
  return { schemaVersion: JOURNAL_SCHEMA_VERSION, manual, closes, nrv, opening, openingDate: value.openingDate || '' };
}

// ---------------------------------------------------------------- building entries
// entry = { id, date, branch, kind, docNo, docId, party, descKey, descParams, reversalOf, lines: [line], flags }
// line  = { account, branch, debit, credit (satang ≥ 0, one of them 0), ref (open item of AR / AP), jobKey, category }
export const ENTRY_KIND_ORDER = Object.freeze(['opening', 'opening_ar', 'opening_ap', 'goods_receipt', 'gr_vat', 'receipt_reversal', 'stock_adjust', 'transfer', 'invoice', 'cash_sale', 'debit_note', 'credit_note', 'cogs', 'cogs_return', 'job_material', 'job_labour', 'job_other', 'job_complete', 'job_finished', 'receipt', 'payment', 'vat_due', 'legacy_paid', 'expense', 'expense_payment', 'fx_payment', 'vat_reclass', 'pp36_claim', 'manual', 'nrv', 'overhead_close', 'fx_revaluation', 'fx_revaluation_reverse', 'vat_close', 'vat_payment', 'wht_remit']);
// r13#LOW-4: the settlement entries made from filed returns — excluded when the month's VAT / WHT accounts are tied to
// the returns (they move the balances to payable / receivable AFTER the return, so they are not part of the return).
export const SETTLEMENT_KINDS = Object.freeze(['vat_close', 'vat_payment', 'wht_remit']);
const KIND_RANK = new Map(ENTRY_KIND_ORDER.map((kind, index) => [kind, index]));
// party / memo are user data (a customer, supplier, a typed description): shown apart from the translated text.
function newEntry(fields) {
  return { id: fields.id, date: fields.date, branch: fields.branch, kind: fields.kind, docNo: text(fields.docNo), docId: text(fields.docId), party: text(fields.party), memo: text(fields.memo), descKey: fields.descKey || `desc.${fields.kind}`, descParams: fields.descParams || {}, reversalOf: '', lines: [], flags: [] };
}
// Posts `amount` satang to an account: positive = debit, negative = credit (zero is dropped later).
function post(entry, accountId, amount, extra = {}) {
  if (!Number.isSafeInteger(amount)) throw new Error(`journal: amount is not an integer (${entry.id} ${accountId} ${amount})`);
  if (!amount) return;
  entry.lines.push({ account: accountId, branch: extra.branch || entry.branch, debit: amount > 0 ? amount : 0, credit: amount < 0 ? -amount : 0, ref: extra.ref || null, jobKey: extra.jobKey || '', category: extra.category || '' });
}
// Drops zero lines, balances each establishment through the inter-branch account, then checks Σ debit = Σ credit
// for the entry and for every establishment in it (throws JournalBalanceError).
function finalize(entry) {
  entry.lines = entry.lines.filter(line => line.debit || line.credit);
  const net = new Map();
  for (const line of entry.lines) net.set(line.branch, (net.get(line.branch) || 0) + line.debit - line.credit);
  if (net.size > 1) {
    for (const [branch, amount] of net) if (amount) post(entry, 'inter_branch', -amount, { branch });
  }
  let debit = 0;
  let credit = 0;
  const perBranch = new Map();
  for (const line of entry.lines) {
    if (!Number.isSafeInteger(line.debit) || !Number.isSafeInteger(line.credit) || line.debit < 0 || line.credit < 0 || (line.debit && line.credit)) throw new JournalBalanceError(entry, line.debit, line.credit);
    debit += line.debit;
    credit += line.credit;
    const sum = perBranch.get(line.branch) || { debit: 0, credit: 0 };
    sum.debit += line.debit;
    sum.credit += line.credit;
    perBranch.set(line.branch, sum);
  }
  if (debit !== credit) throw new JournalBalanceError(entry, debit, credit);
  for (const [branch, sum] of perBranch) if (sum.debit !== sum.credit) throw new JournalBalanceError(entry, sum.debit, sum.credit, branch);
  return entry;
}
// The balance check of one entry, for callers that build entries themselves (and the tests): throws JournalBalanceError.
export function finalizeEntry(entry) {
  return finalize(entry);
}
// The reversing entry of a cancelled document: every line on the other side, dated on the cancel date.
function reversalOf(entry, date) {
  const out = { ...entry, id: `${entry.id}|rev`, date, reversalOf: entry.id, descKey: 'desc.reversal', descParams: { ...entry.descParams, original: entry.descKey }, flags: [], lines: entry.lines.map(line => ({ ...line, debit: line.credit, credit: line.debit })) };
  return out;
}
// The cancel date of a cancelled document (voidedAt / cancelledAt as a Bangkok business date), never before the
// document itself. '' + a flag when unknown (the reversal then sits on the document's own date).
function cancelDateOf(record, date) {
  const day = bangkokDateOf(record?.voidedAt || record?.cancelledAt || record?.voidDate || '');
  if (!day) return { date, known: false };
  return { date: laterDate(day, date), known: true };
}
// r13#MED-3: a cancelled TAX document (tax invoice, credit note, debit note) is reversed in ITS OWN tax month — the rule
// of รายงานภาษีขาย (a cancelled tax invoice shows 0 in its month, ป.86/2542 ข้อ 10–11: cancel and issue a correct new
// one), so the books and the sales tax report of every month agree. Cancelled in the same month → the cancel date; in a
// later month → the last day of the document's month (flagged `cancel_backdated`: if that month's ภ.พ.30 was filed, an
// amended return ยื่นเพิ่มเติม is needed — the cancel dialog asks for that confirmation, ADR-021).
function taxCancelDateOf(record, date) {
  const cancel = cancelDateOf(record, date);
  if (!cancel.known || monthOf(cancel.date) === monthOf(date)) return { ...cancel, backdated: false };
  return { date: monthLastDay(monthOf(date)), known: true, backdated: true, cancelDate: cancel.date };
}

// The invoice index: every stored invoice (cancelled ones too) by id and by number per branch — the same resolution
// as ERPIntegrity.resolveInvoice (id first, then number; only a unique match counts).
function invoiceIndex(invoices) {
  const byId = new Map();
  const byNo = new Map();
  const add = (map, key, invoice) => { const list = map.get(key); if (list) list.push(invoice); else map.set(key, [invoice]); };
  for (const invoice of invoices) {
    const branch = branchOf(invoice);
    if (text(invoice.id)) add(byId, `${branch}|${text(invoice.id)}`, invoice);
    if (text(invoice.no)) add(byNo, `${branch}|${text(invoice.no)}`, invoice);
  }
  return ({ branch, id, no }) => {
    const ids = id ? byId.get(`${branch}|${text(id)}`) || [] : [];
    if (ids.length === 1) return ids[0];
    const nos = no ? byNo.get(`${branch}|${text(no)}`) || [] : [];
    return nos.length === 1 ? nos[0] : null;
  };
}
// The open-item reference of an invoice on an AR line.
function arRef(invoice) {
  return { kind: 'ar', key: `inv|${branchOf(invoice)}|${text(invoice.id) || text(invoice.no)}`, no: text(invoice.no), date: text(invoice.date).slice(0, 10), dueDate: invoiceDueDate(invoice) || text(invoice.date).slice(0, 10), party: text(invoice.customer), branch: branchOf(invoice) };
}
const isCashSale = invoice => effectiveTaxInvoiceForm(invoice) === 'abbreviated';
const isServiceItem = item => item?.flowType === 'service' || item?.fulfillmentType === 'service';
// Revenue of an invoice by account: goods vs services, shared by the line values (largest remainder, exact).
function revenueSplit(invoice, value) {
  const items = Array.isArray(invoice.items) ? invoice.items : [];
  const weights = items.map(item => toSatang(item?.saleTotal ?? (Number(item?.qty) || 0) * (Number(item?.priceUnit) || 0)));
  const services = items.map(isServiceItem);
  if (!items.length || weights.some(weight => weight < 0) || weights.every(weight => weight === 0) || services.every(Boolean) || !services.some(Boolean)) {
    return [{ account: items.length && services.every(Boolean) ? 'sales_service' : 'sales_goods', amount: value }];
  }
  const shares = allocateSatang(value, weights);
  let goods = 0;
  let service = 0;
  shares.forEach((share, index) => { if (services[index]) service += share; else goods += share; });
  return [{ account: 'sales_goods', amount: goods }, { account: 'sales_service', amount: service }];
}

// ---------------------------------------------------------------- the generator
// input: {
//   invoices      every stored tax invoice (pack.invoices minus printed copies), each with _branch — the same list as the
//                 VAT reports; cancelled ones included (they get a reversal)
//   issuedOnly    printed copies with no invoice behind them (flagged, not posted: the VAT report skips them too)
//   receipts      receipts as ERPIntegrity.business() keeps them (form receipts + printed ones that match none)
//   creditNotes, debitNotes, expenses, certificates (whtCertificates), payments (order flow), goodsReceipts
//   costing       the costing engine's result (erp-costing-core.js), sheets (job cost sheets), jobEntries (job store)
//   settings      normalizeJournalSettings(), documents  normalizeJournalDocuments()
//   options       { legacyPaid(invoice) → bool (ERPIntegrity.paymentSummary(...).legacy), openingDate }
// }
// → { entries (sorted), flags, openingDate }
export function buildJournal(input = {}) {
  const settings = input.settings || defaultJournalSettings();
  const documents = input.documents || emptyJournalDocuments();
  const posting = { ...DEFAULT_POSTING, ...(settings.posting || {}) };
  const options = input.options || {};
  const entries = [];
  const flags = [];
  const flag = (entry, code, params = {}) => { const row = { code, entryId: entry?.id || '', docNo: entry?.docNo || params.docNo || '', date: entry?.date || params.date || '', branch: entry?.branch || params.branch || '', params }; flags.push(row); if (entry) entry.flags.push(code); };
  const add = entry => { entries.push(finalize(entry)); return entry; };
  // A printed copy kept in the invoice pack (old data) is the same tax invoice: skipped, as รายงานภาษีขาย does.
  const invoices = (Array.isArray(input.invoices) ? input.invoices : []).filter(row => row && typeof row === 'object' && row.documentKind !== 'delivery-tax-invoice');
  const findInvoice = invoiceIndex(invoices);
  const resolveRef = (branch, id, no) => findInvoice({ branch, id, no });
  const legacyPaid = typeof options.legacyPaid === 'function' ? options.legacyPaid : () => false;

  // ---- tax invoices (credit sale: Dr AR; abbreviated cash sale: Dr cash / bank)
  for (const invoice of invoices) {
    const branch = branchOf(invoice);
    const date = text(invoice.date).slice(0, 10);
    if (!BRANCHES.includes(branch) || !isIsoDate(date)) { flag(null, 'invalid_document', { docNo: text(invoice.no), branch, date }); continue; }
    const basis = creditNoteInvoiceBasis(invoice);
    const total = toSatang(basis.total);
    const vat = toSatang(basis.vat);
    const value = total - vat;
    const cash = isCashSale(invoice);
    // r13#MED-6: a service invoice whose tax point is the payment (ม.78/1(1)) is not a tax invoice yet: its VAT waits in
    // 2155 "ภาษีขายยังไม่ถึงกำหนดชำระ" and moves to 2154 when each payment is received (vat_due entries below).
    const deferred = !cash && invoiceTaxPointAtPayment(invoice);
    const entry = newEntry({ id: `inv|${branch}|${text(invoice.id) || text(invoice.no)}`, date, branch, kind: cash ? 'cash_sale' : 'invoice', docNo: invoice.no, docId: invoice.id, party: cash ? '' : invoice.customer, descParams: { no: text(invoice.no) } });
    if (cash) post(entry, posting.cashSaleAccount, total);
    else post(entry, 'ar', total, { ref: arRef(invoice) });
    for (const part of revenueSplit(invoice, value)) post(entry, part.account, -part.amount);
    post(entry, deferred ? 'output_vat_undue' : 'output_vat', -vat);
    add(entry);
    if (!creditNoteInvoiceLive(invoice)) {
      const cancel = taxCancelDateOf(invoice, date);
      const reversal = reversalOf(entry, cancel.date);
      if (!cancel.known) flag(reversal, 'void_date_unknown');
      if (cancel.backdated) flag(reversal, 'cancel_backdated', { cancelDate: cancel.cancelDate });
      add(reversal);
    } else if (!cash && legacyPaid(invoice)) {
      // Marked "paid" before receipts existed (no receipt / payment behind it): settled on its own date.
      const settle = newEntry({ id: `legacy|${branch}|${text(invoice.id) || text(invoice.no)}`, date, branch, kind: 'legacy_paid', docNo: invoice.no, docId: invoice.id, party: invoice.customer, descParams: { no: text(invoice.no) } });
      post(settle, posting.receiptAccount, total);
      post(settle, 'ar', -total, { ref: arRef(invoice) });
      flag(settle, 'legacy_paid');
      add(settle);
    }
  }
  for (const copy of Array.isArray(input.issuedOnly) ? input.issuedOnly : []) flag(null, 'issued_copy_only', { docNo: text(copy.no), branch: branchOf(copy), date: text(copy.date).slice(0, 10) });

  // ---- credit notes (Dr returns + output VAT / Cr AR) and debit notes (Dr AR / Cr revenue + output VAT)
  for (const [collection, sign, kind, revenue, live] of [['creditNotes', -1, 'credit_note', 'sales_returns', isCreditNoteLive], ['debitNotes', 1, 'debit_note', 'sales_debit', isDebitNoteLive]]) {
    for (const note of Array.isArray(input[collection]) ? input[collection] : []) {
      if (!note || typeof note !== 'object') continue;
      const branch = branchOf(note);
      const date = text(note.date).slice(0, 10);
      if (!BRANCHES.includes(branch) || !isIsoDate(date)) { flag(null, 'invalid_document', { docNo: text(note.no), branch, date }); continue; }
      const total = toSatang(note.total);
      const vat = toSatang(note.vatAmt);
      const entry = newEntry({ id: `${kind === 'credit_note' ? 'cn' : 'dn'}|${branch}|${text(note.id) || text(note.no)}`, date, branch, kind, docNo: note.no, docId: note.id, party: note.customer, descParams: { no: text(note.no), invoices: (Array.isArray(note.invoiceNos) ? note.invoiceNos : []).join(', ') } });
      if (toSatang(note.subtotal) + vat !== total) flag(entry, 'amounts_inconsistent');
      post(entry, revenue, -sign * (total - vat));
      post(entry, 'output_vat', -sign * vat);
      // The receivable side, per invoice line (line totals; a remainder goes to the first line).
      const lines = (Array.isArray(note.lines) ? note.lines : []).map(line => ({ line, invoice: resolveRef(text(line.invoiceBranch) || branch, line.invoiceId, line.invoiceNo), amount: toSatang(line.total) }));
      const cashOnly = lines.length > 0 && lines.every(row => row.invoice && isCashSale(row.invoice));
      if (cashOnly && sign < 0) {
        post(entry, posting.refundAccount, -total);
        flag(entry, 'refund_account');
      } else {
        let rest = total;
        lines.forEach((row, index) => {
          const share = index === lines.length - 1 ? rest : Math.min(rest, row.amount);
          rest -= share;
          if (!row.invoice) flag(entry, 'invoice_missing', { invoiceNo: text(row.line.invoiceNo) });
          post(entry, row.invoice ? 'ar' : 'suspense', sign * share, { branch: row.invoice ? branchOf(row.invoice) : branch, ref: row.invoice ? arRef(row.invoice) : null });
        });
        if (!lines.length) { post(entry, 'suspense', sign * total); flag(entry, 'invoice_missing', {}); }
      }
      add(entry);
      if (!live(note)) {
        const cancel = taxCancelDateOf(note, date);
        const reversal = reversalOf(entry, cancel.date);
        if (!cancel.known) flag(reversal, 'void_date_unknown');
        if (cancel.backdated) flag(reversal, 'cancel_backdated', { cancelDate: cancel.cancelDate });
        add(reversal);
      }
    }
  }

  // ---- receipts (Dr cash / bank + WHT deducted by the customer / Cr AR)
  const payments = (Array.isArray(input.payments) ? input.payments : []).filter(row => row && typeof row === 'object');
  const paymentIds = new Set(payments.map(row => String(row.id)));
  const liveRow = row => !!row && !row.voided && !row.cancelled && !row.reversed && row.status !== 'cancelled';
  for (const receipt of Array.isArray(input.receipts) ? input.receipts : []) {
    if (!receipt || typeof receipt !== 'object') continue;
    const branch = branchOf(receipt);
    const date = text(receipt.date).slice(0, 10);
    if (receipt.paymentId) {
      // A receipt printed for an order-flow payment is evidence: the payment carries the money (posted below).
      if (!paymentIds.has(String(receipt.paymentId))) flag(null, 'receipt_payment_missing', { docNo: text(receipt.no), branch, date });
      continue;
    }
    if (!BRANCHES.includes(branch) || !isIsoDate(date)) { flag(null, 'invalid_document', { docNo: text(receipt.no), branch, date }); continue; }
    const invoiceBranch = text(receipt.invoiceBranch) || branch;
    const invoice = receipt.invoiceId || receipt.invNo || receipt.sourceInvoiceNo || receipt.invoiceNo ? resolveRef(invoiceBranch, receipt.invoiceId || receipt.sourceInvoiceId, receipt.invNo || receipt.sourceInvoiceNo || receipt.invoiceNo) : null;
    // A cash sale (abbreviated invoice) was posted to cash when it was sold: its receipt is the slip, not new money.
    if (invoice && isCashSale(invoice)) continue;
    const total = toSatang(receipt.total ?? receipt.saleTotal ?? receipt.subtotal ?? 0);
    const wht = toSatang(receipt.whtAmount || 0);
    if (total <= 0) continue;
    const entry = newEntry({ id: `rcp|${branch}|${text(receipt.id) || text(receipt.no)}`, date, branch, kind: 'receipt', docNo: receipt.no, docId: receipt.id, party: receipt.customer, descParams: { no: text(receipt.no), invoice: text(invoice?.no || receipt.invNo) } });
    // ADR-031: a receipt in the invoice's currency settles the receivable at its carrying baht (`total`) while the bank
    // gets the baht at the receipt's rate (`amountThb`); the difference is the realised exchange gain (4210) / loss (5420).
    const realised = fxRealisedSatangOf(receipt);
    post(entry, posting.receiptAccount, total - wht + realised);
    post(entry, 'wht_prepaid', wht);
    if (invoice) post(entry, 'ar', -total, { branch: branchOf(invoice), ref: arRef(invoice) });
    else { post(entry, 'suspense', -total); flag(entry, receipt.invNo || receipt.invoiceId ? 'invoice_missing' : 'receipt_without_invoice'); }
    if (realised) post(entry, realised > 0 ? 'fx_gain' : 'fx_loss', -realised);
    if (realised && isFxDocument(receipt) && toSatang(receipt.amountThb) !== total + realised) flag(entry, 'amounts_inconsistent');
    flag(entry, 'default_receipt_account', { account: posting.receiptAccount });
    if (receipt.cashReceived !== undefined && receipt.cashReceived !== null && receipt.cashReceived !== '' && toSatang(receipt.cashReceived) !== total - wht + realised) flag(entry, 'amounts_inconsistent');
    add(entry);
    if (!liveRow(receipt)) {
      const cancel = cancelDateOf(receipt, date);
      const reversal = reversalOf(entry, cancel.date);
      if (!cancel.known) flag(reversal, 'void_date_unknown');
      add(reversal);
    }
  }

  // ---- order-flow payments (one billing payment can settle several invoices)
  for (const payment of payments) {
    const allocations = Array.isArray(payment.allocations) ? payment.allocations : [];
    const date = text(payment.date).slice(0, 10);
    const branch = text(payment.branch) || text(allocations[0]?.branch);
    if (!BRANCHES.includes(branch) || !isIsoDate(date) || !allocations.length) { flag(null, 'invalid_document', { docNo: text(payment.no), branch, date }); continue; }
    const method = text(payment.method);
    const known = hasOwn(PAYMENT_METHOD_ROLES, method);
    const entry = newEntry({ id: `pay|${text(payment.id) || text(payment.no)}`, date, branch, kind: 'payment', docNo: payment.no, docId: payment.id, party: payment.customer, descParams: { no: text(payment.no), billing: text(payment.billingNo) } });
    let total = 0;
    for (const allocation of allocations) {
      const amount = toSatang(allocation.amount);
      total += amount;
      const invBranch = text(allocation.branch) || branch;
      const invoice = resolveRef(invBranch, allocation.invoiceId, allocation.invoiceNo);
      if (invoice && !isCashSale(invoice)) post(entry, 'ar', -amount, { branch: branchOf(invoice), ref: arRef(invoice) });
      else { post(entry, 'suspense', -amount, { branch: invBranch }); flag(entry, invoice ? 'cash_sale_settlement' : 'invoice_missing', { invoiceNo: text(allocation.invoiceNo) }); }
    }
    post(entry, known ? PAYMENT_METHOD_ROLES[method] : posting.receiptAccount, total);
    if (!known) flag(entry, 'default_receipt_account', { account: posting.receiptAccount });
    if (payment.amount !== undefined && toSatang(payment.amount) !== total) flag(entry, 'amounts_inconsistent');
    add(entry);
    if (!liveRow(payment)) {
      const cancel = cancelDateOf(payment, date);
      const reversal = reversalOf(entry, cancel.date);
      if (!cancel.known) flag(reversal, 'void_date_unknown');
      add(reversal);
    }
  }

  // ---- r13#MED-6: output VAT of service invoices with the tax point at payment, moved from 2155 to 2154 on each
  // receipt (the receipt is the ใบเสร็จรับเงิน/ใบกำกับภาษี; the VAT share of every payment is paymentTaxPoints()).
  {
    const receiptsByInvoice = new Map();
    for (const receipt of Array.isArray(input.receipts) ? input.receipts : []) {
      if (!receipt || typeof receipt !== 'object' || !liveRow(receipt)) continue;
      const branch = branchOf(receipt);
      const invoice = receipt.invoiceId || receipt.invNo || receipt.sourceInvoiceNo || receipt.invoiceNo ? resolveRef(text(receipt.invoiceBranch) || branch, receipt.invoiceId || receipt.sourceInvoiceId, receipt.invNo || receipt.sourceInvoiceNo || receipt.invoiceNo) : null;
      if (!invoice || isCashSale(invoice) || !invoiceTaxPointAtPayment(invoice)) continue;
      const key = `${branchOf(invoice)}|${text(invoice.id) || text(invoice.no)}`;
      if (!receiptsByInvoice.has(key)) receiptsByInvoice.set(key, { invoice, receipts: [] });
      receiptsByInvoice.get(key).receipts.push(receipt);
    }
    for (const { invoice, receipts } of receiptsByInvoice.values()) {
      if (!creditNoteInvoiceLive(invoice)) continue;
      for (const point of paymentTaxPoints(invoice, receipts)) {
        const receipt = point.receipt;
        const branch = branchOf(invoice);
        const entry = newEntry({ id: `vatdue|${branch}|${text(receipt.id) || text(receipt.no)}`, date: point.date, branch, kind: 'vat_due', docNo: receipt.no, docId: receipt.id, party: invoice.customer, descParams: { no: text(receipt.no), invoice: text(invoice.no) } });
        post(entry, 'output_vat_undue', toSatang(point.vat));
        post(entry, 'output_vat', -toSatang(point.vat));
        add(entry);
      }
    }
  }

  // ---- expenses (Dr expense / input VAT / Cr cash or AP, WHT payable)
  const jobOtherIds = new Set(liveEntries({ entries: Array.isArray(input.jobEntries) ? input.jobEntries : [] }).filter(job => job.kind === 'other').map(job => text(job.id)));
  const certificates = (Array.isArray(input.certificates) ? input.certificates : []).filter(isWhtCertificateLive);
  const certificateFor = new Set(certificates.map(cert => `${branchOf(cert)}|${text(cert.sourceExpenseId)}`));
  for (const expense of Array.isArray(input.expenses) ? input.expenses : []) {
    if (!expense || typeof expense !== 'object' || expense.deleted === true) continue;
    const branch = branchOf(expense);
    const date = text(expense.date).slice(0, 10);
    if (expense.voided === true) { flag(null, 'expense_voided', { docNo: text(expense.docNo || expense.desc), branch, date }); continue; }
    if (!BRANCHES.includes(branch) || !isIsoDate(date)) { flag(null, 'invalid_document', { docNo: text(expense.docNo || expense.desc), branch, date }); continue; }
    const amount = toSatang(expense.amount);
    if (amount <= 0) { flag(null, 'invalid_document', { docNo: text(expense.docNo || expense.desc), branch, date }); continue; }
    const id = text(expense.id) || `${date}|${text(expense.docNo)}`;
    if (isFxDocument(expense)) { postFxExpense({ expense, branch, date, amount, id, settings, add, flag }); continue; }
    const docType = text(expense.docType);
    const hasVat = expenseHasVatData(expense);
    const vat = hasVat ? toSatang(expense.vatAmt) : 0;
    const claimable = hasVat && expense.inputVatClaimable === true && PURCHASE_REPORT_DOC_TYPES.includes(docType) && vat > 0;
    const sign = docType === 'credit_note_received' ? -1 : 1;
    const { role: categoryAccount, known } = categoryRole(settings, expense.cat);
    // r13#LOW-6: an expense that PAYS a job's direct cost (subcontract …, `jobEntryId` = the job's "other cost" entry) clears
    // the accrual that entry raised (2181) instead of being a second expense — the job already carries the cost.
    const jobLinked = text(expense.jobEntryId) && jobOtherIds.has(text(expense.jobEntryId));
    const role = jobLinked ? 'job_cost_accrued' : categoryAccount;
    const entry = newEntry({ id: `exp|${branch}|${id}`, date, branch, kind: 'expense', docNo: expense.docNo || '', docId: expense.id, party: expense.vendor, memo: expense.desc, descParams: {} });
    if (!known && !jobLinked) flag(entry, 'unknown_category', { category: text(expense.cat) });
    if (text(expense.jobEntryId) && !jobLinked) flag(entry, 'job_link_missing', { jobEntryId: text(expense.jobEntryId) });
    if (hasVat && toSatang(expense.subtotal) + vat !== amount) flag(entry, 'amounts_inconsistent');
    const claimPeriod = claimable ? (text(expense.claimPeriod) || monthOf(date)) : '';
    const vatAccount = claimable && claimPeriod !== monthOf(date) ? 'input_vat_undue' : 'input_vat';
    post(entry, role, sign * (claimable ? amount - vat : amount), { category: text(expense.cat) });
    if (claimable) post(entry, vatAccount, sign * vat);
    const wht = expense.whtEnabled === true ? toSatang(expense.whtAmount || 0) : 0;
    const borne = expense.whtEnabled === true ? toSatang(expense.whtPayerBorne || 0) : 0;
    const whtAccount = expense.whtForm === 'PND3' ? 'wht_pnd3' : expense.whtForm === 'PND53' ? 'wht_pnd53' : 'suspense';
    const paidFrom = posting.expensePaidFrom;
    // r13#MED-2: the money (and with it the withholding duty, the 50 ทวิ date and the ภ.ง.ด. month) is on the payment
    // date. Paid on the expense date → one entry as before; paid on another date → the expense is a payable (2111) on its
    // date and an "expense_payment" entry on the payment date settles it, withholds and pays.
    const paymentDate = expense.whtEnabled === true ? whtPaymentDateOf(expense) : date;
    const separatePayment = isIsoDate(paymentDate) && paymentDate !== date;
    const apRef = { kind: 'ap', key: `exp|${branch}|${id}`, no: text(expense.docNo), date, dueDate: separatePayment ? paymentDate : date, party: text(expense.vendor), branch };
    if (!separatePayment) {
      post(entry, 'exp_wht_borne', borne);
      if (wht && whtAccount === 'suspense') flag(entry, 'wht_form_unknown');
      post(entry, whtAccount, -wht);
      post(entry, paidFrom, -(sign * amount + borne - wht), paidFrom === 'ap' ? { ref: apRef } : {});
      flag(entry, 'default_payment_account', { account: paidFrom });
    } else {
      post(entry, 'ap', -sign * amount, { ref: apRef });
    }
    if (wht && !certificateFor.has(`${branch}|${text(expense.id)}`)) flag(entry, 'wht_certificate_missing');
    // The cash leaving the bank must be total + borne − withheld (r13#HIGH-1: cond 3 = total + first − (first + payee part)).
    if (expense.whtEnabled === true && expense.netPaid !== undefined && toSatang(expense.netPaid) !== sign * amount - wht + borne && toSatang(expense.netPaid) !== sign * amount) flag(entry, 'amounts_inconsistent');
    add(entry);
    if (separatePayment) {
      const pay = newEntry({ id: `exppay|${branch}|${id}`, date: paymentDate, branch, kind: 'expense_payment', docNo: expense.docNo || '', docId: expense.id, party: expense.vendor, memo: expense.desc, descParams: {} });
      const payFrom = paidFrom === 'ap' ? 'bank' : paidFrom;
      post(pay, 'ap', sign * amount, { ref: apRef });
      post(pay, 'exp_wht_borne', borne);
      if (wht && whtAccount === 'suspense') flag(pay, 'wht_form_unknown');
      post(pay, whtAccount, -wht);
      post(pay, payFrom, -(sign * amount + borne - wht));
      flag(pay, 'default_payment_account', { account: payFrom });
      if (paymentDate < date) flag(pay, 'paid_before_expense');
      add(pay);
    }
    // Input VAT claimed in another month (ม.82/3): moved from "not yet claimable" in the claim month, so the Input VAT
    // account of every month equals ภ.พ.30 line 7.
    if (vatAccount === 'input_vat_undue') {
      if (!/^\d{4}-\d{2}$/.test(claimPeriod)) flag(entry, 'invalid_document');
      else {
        const later = claimPeriod > monthOf(date);
        const reclass = newEntry({ id: `expvat|${branch}|${id}`, date: later ? monthFirstDay(claimPeriod) : monthLastDay(claimPeriod), branch, kind: 'vat_reclass', docNo: expense.docNo || '', docId: expense.id, party: expense.vendor, descParams: { period: claimPeriod } });
        post(reclass, 'input_vat', sign * vat);
        post(reclass, 'input_vat_undue', -sign * vat);
        if (!later) flag(reclass, 'claim_before_expense');
        add(reclass);
      }
    }
  }

  // ---- stock: every costed movement (erp-costing-core.js) → inventory ± its value, the counter account ∓ the value,
  // negative-stock corrections to cost of sales. Grouped per document and date.
  const counterOf = Object.freeze({ opening: 'opening_equity', receipt: 'ap', receipt_reversal: 'ap', adjust_in: 'stock_adjustment', adjust_out: 'stock_adjustment', transfer_out: 'inter_branch', transfer_in: 'inter_branch', sale: 'cogs', sale_return: 'cogs', job_issue: 'wip', job_return: 'wip', job_completion: 'wip' });
  const kindOf = Object.freeze({ opening: 'opening', receipt: 'goods_receipt', receipt_reversal: 'receipt_reversal', adjust_in: 'stock_adjust', adjust_out: 'stock_adjust', transfer_out: 'transfer', transfer_in: 'transfer', sale: 'cogs', sale_return: 'cogs_return', job_issue: 'job_material', job_return: 'job_material', job_completion: 'job_finished' });
  const goodsReceipts = new Map((Array.isArray(input.goodsReceipts) ? input.goodsReceipts : []).filter(Boolean).map(row => [text(row.id), row]));
  const stockEntries = new Map();
  const openingRows = [];
  if (input.costing?.bySku) {
    for (const row of costRows(input.costing)) {
      if (!hasOwn(counterOf, row.kind)) continue;
      if (row.kind === 'opening') { openingRows.push(row); continue; }
      const ref = row.ref || {};
      const refKey = row.kind === 'sale' || row.kind === 'sale_return' || row.kind === 'receipt' || row.kind === 'receipt_reversal' ? text(ref.id) || text(ref.no) : row.kind === 'job_issue' || row.kind === 'job_return' ? `${text(ref.jobKey)}|${row.kind}` : text(ref.no) || text(ref.movementId) || row.id;
      const key = `stk|${kindOf[row.kind]}|${row.branch}|${refKey}|${row.date}`;
      let entry = stockEntries.get(key);
      if (!entry) {
        const gr = row.kind === 'receipt' || row.kind === 'receipt_reversal' ? goodsReceipts.get(text(ref.id)) : null;
        entry = newEntry({ id: key, date: row.date, branch: row.branch, kind: kindOf[row.kind], docNo: ref.no || '', docId: ref.id || '', party: gr ? gr.supplier : '', descParams: { no: text(ref.no) } });
        entry.apRef = gr ? { kind: 'ap', key: `gr|${row.branch}|${text(ref.id)}`, no: text(gr.no || ref.no), date: text(gr.date).slice(0, 10), dueDate: text(gr.date).slice(0, 10), party: text(gr.supplier), branch: row.branch } : null;
        stockEntries.set(key, entry);
      }
      const value = row.value;
      const correction = row.correction || 0;
      const jobKey = text(ref.jobKey);
      post(entry, 'inventory', value - correction);
      post(entry, 'cogs', correction);
      const counter = counterOf[row.kind];
      post(entry, counter, -value, { ref: counter === 'ap' ? entry.apRef : null, jobKey: counter === 'wip' ? jobKey : '' });
      if (row.negative && !entry.flags.includes('negative_stock')) flag(entry, 'negative_stock');
      if (row.costSource === 'job_pending' && !entry.flags.includes('job_cost_pending')) flag(entry, 'job_cost_pending');
    }
  }
  for (const entry of stockEntries.values()) { delete entry.apRef; add(entry); }
  // ---- r13#HIGH-2: the supplier's VAT on a goods receipt (the stock entry above carries the pre-VAT cost the engine
  // used): Dr 1154 input VAT (claimed in the receipt month) or 1155 (claimed later / tax invoice not received yet) /
  // Cr 2111 AP — the same open item as the goods, so AP = the supplier's total incl. VAT. Claimed in another month →
  // moved 1155 → 1154 in the claim month (as expenses do). A pending receipt stays in 1155 (month-end pack lists it).
  for (const gr of goodsReceipts.values()) {
    const info = goodsReceiptVatOf(gr);
    const vatSatang = toSatang(info.vat);
    const branch = text(gr.branch);
    const date = text(gr.date).slice(0, 10);
    if (!(vatSatang > 0) || !BRANCHES.includes(branch) || !isIsoDate(date)) continue;
    const ref = { kind: 'ap', key: `gr|${branch}|${text(gr.id)}`, no: text(gr.no), date, dueDate: date, party: text(gr.supplier), branch };
    const now = info.claimable && info.claimPeriod === monthOf(date);
    const entry = newEntry({ id: `grvat|${branch}|${text(gr.id)}`, date, branch, kind: 'gr_vat', docNo: gr.no, docId: gr.id, party: gr.supplier, descParams: { no: text(gr.no), invoice: text(gr.taxInvoiceNo) } });
    post(entry, now ? 'input_vat' : 'input_vat_undue', vatSatang);
    post(entry, 'ap', -vatSatang, { ref });
    if (info.pending) flag(entry, 'gr_tax_invoice_pending');
    add(entry);
    if (info.claimable && !now) {
      const later = info.claimPeriod > monthOf(date);
      const reclass = newEntry({ id: `grvatc|${branch}|${text(gr.id)}`, date: later ? monthFirstDay(info.claimPeriod) : monthLastDay(info.claimPeriod), branch, kind: 'vat_reclass', docNo: gr.no, docId: gr.id, party: gr.supplier, descParams: { period: info.claimPeriod } });
      post(reclass, 'input_vat', vatSatang);
      post(reclass, 'input_vat_undue', -vatSatang);
      if (!later) flag(reclass, 'claim_before_expense');
      add(reclass);
    }
  }

  // ---- ADR-031: payments of goods receipts in a currency (the payable itself is the stock entry's AP above)
  for (const gr of goodsReceipts.values()) {
    if (!isFxDocument(gr)) continue;
    const branch = text(gr.branch);
    if (!BRANCHES.includes(branch)) continue;
    const ref = { kind: 'ap', key: `gr|${branch}|${text(gr.id)}`, no: text(gr.no), date: text(gr.date).slice(0, 10), dueDate: text(gr.date).slice(0, 10), party: text(gr.supplier), branch };
    postFxPayments({ record: gr, branch, ref, docNo: gr.no, party: gr.supplier, memo: '', add, flag });
  }
  // ---- ADR-031: month-end revaluation of foreign open items (unrealised, auto-reversed on day 1 of the next month)
  postFxRevaluations({ closes: Array.isArray(input.fxCloses) ? input.fxCloses : [], findInvoice, add, flag });

  // ---- job costs (labour + overhead applied, other direct costs, completion to cost of sales)
  const sheets = input.sheets instanceof Map ? input.sheets : new Map();
  for (const job of liveEntries({ entries: Array.isArray(input.jobEntries) ? input.jobEntries : [] })) {
    const sheet = sheets.get(job.jobKey);
    if (!sheet) { flag(null, 'job_missing', { docNo: job.jobNo, branch: job.branch, date: job.date }); continue; }
    const base = { date: job.date, branch: job.branch, docNo: job.jobNo, docId: job.id, party: sheet.job.customer, descParams: { no: text(job.jobNo) } };
    if (job.kind === 'labour') {
      const labour = labourAmountSatang(job.hours, job.rate);
      const overhead = labourAmountSatang(job.hours, job.overheadRate);
      const entry = newEntry({ ...base, id: `job|${job.id}`, kind: 'job_labour', descParams: { no: text(job.jobNo), hours: job.hours } });
      post(entry, 'wip', labour + overhead, { jobKey: job.jobKey });
      post(entry, 'labour_applied', -labour);
      post(entry, 'overhead_applied', -overhead);
      add(entry);
    } else if (job.kind === 'other') {
      // r13#LOW-6: a direct cost of the job (subcontract, materials bought for it, …) is owed to someone: Cr 2181 accrued job
      // costs (not a contra-expense with nothing behind it); the expense that pays it (jobEntryId) clears the accrual.
      const entry = newEntry({ ...base, id: `job|${job.id}`, kind: 'job_other' });
      const amount = toSatang(job.amount);
      post(entry, 'wip', amount, { jobKey: job.jobKey });
      post(entry, 'job_cost_accrued', -amount, { jobKey: job.jobKey });
      add(entry);
    } else if (job.kind === 'completion' && job.destination === 'cost_of_sales' && sheet.completion?.id === job.id) {
      // Delivered to the customer: the whole job cost to cost of sales (finished goods go through the costing engine).
      const entry = newEntry({ ...base, id: `jobdone|${job.id}`, kind: 'job_complete' });
      post(entry, 'cogs', sheet.total);
      post(entry, 'wip', -sheet.total, { jobKey: job.jobKey });
      add(entry);
    }
  }

  // ---- the journal's own documents: manual entries, overhead closes, NRV write-downs, opening AR / AP
  const voidable = (entry, doc) => {
    add(entry);
    if (doc.status === 'voided') add(reversalOf(entry, laterDate(doc.voidDate, entry.date)));
  };
  for (const doc of documents.manual) {
    const entry = newEntry({ id: `jv|${doc.id}`, date: doc.date, branch: doc.branch, kind: 'manual', docNo: doc.no, docId: doc.id, memo: doc.memo, descParams: { no: doc.no } });
    doc.lines.forEach((line, index) => post(entry, line.account, line.debit - line.credit, { ref: line.openItem ? { kind: line.account === 'ap' ? 'ap' : 'ar', key: line.openItem, no: doc.no, date: doc.date, dueDate: doc.date, party: line.memo, branch: doc.branch, manualLine: index } : null }));
    voidable(entry, doc);
  }
  for (const doc of documents.closes) {
    const entry = newEntry({ id: `ohc|${doc.id}`, date: doc.date, branch: doc.branch, kind: 'overhead_close', docId: doc.id, descParams: { period: doc.period } });
    post(entry, 'overhead_applied', doc.applied);
    for (const [role, amount] of Object.entries(doc.actual)) post(entry, role, -amount);
    post(entry, 'cogs', doc.cogs);
    voidable(entry, doc);
  }
  for (const doc of documents.nrv) {
    const entry = newEntry({ id: `nrv|${doc.id}`, date: doc.date, branch: doc.branch, kind: 'nrv', docId: doc.id, descParams: { date: doc.date } });
    post(entry, 'nrv_loss', doc.delta);
    post(entry, 'inventory_allowance', -doc.delta);
    voidable(entry, doc);
  }
  for (const doc of documents.opening) {
    if (doc.kind === 'stock') continue; // the stock opening is the costing engine's opening balance (below)
    const byBranch = new Map();
    doc.rows.forEach((row, index) => { const list = byBranch.get(row.branch) || []; list.push({ row, index }); byBranch.set(row.branch, list); });
    for (const [branch, rows] of byBranch) {
      const kind = doc.kind === 'ar' ? 'opening_ar' : 'opening_ap';
      const entry = newEntry({ id: `opening|${doc.id}|${branch}`, date: doc.date, branch, kind, docId: doc.id, descParams: { count: rows.length } });
      for (const { row, index } of rows) {
        const ref = { kind: doc.kind, key: `open|${doc.id}|${index}`, no: row.docNo, date: row.docDate || doc.date, dueDate: row.dueDate || row.docDate || doc.date, party: row.name, branch };
        post(entry, doc.kind, doc.kind === 'ar' ? row.amount : -row.amount, { ref });
        post(entry, 'opening_equity', doc.kind === 'ar' ? -row.amount : row.amount);
      }
      voidable(entry, doc);
    }
  }

  // ---- r13#LOW-4: settlement of FILED returns (the latest filing of each slot): ภ.พ.30 → close output / input VAT into
  // VAT payable (2141) or VAT overpaid (1156) on the tax month's last day, and pay 2141 on the filing date; ภ.ง.ด.3 / 53 →
  // pay the withholding payable on the filing date. Built only from the user's "บันทึกว่ายื่นแล้ว" snapshots.
  settleFiledReturns({ input, entries, add, flag, posting });

  // ---- opening stock: dated on the opening date (set by the opening import; else the day before the first entry)
  const firstDate = entries.reduce((min, entry) => (!min || dateNumber(entry.date) < dateNumber(min) ? entry.date : min), '');
  let openingDate = isIsoDate(documents.openingDate) ? documents.openingDate : isIsoDate(options.openingDate) ? options.openingDate : '';
  if (!openingDate) openingDate = firstDate ? addDays(firstDate, -1) : (isIsoDate(options.today) ? options.today : '');
  const openingByBranch = new Map();
  for (const row of openingRows) {
    let entry = openingByBranch.get(row.branch);
    if (!entry) { entry = newEntry({ id: `opening|stock|${row.branch}`, date: openingDate, branch: row.branch, kind: 'opening', descParams: {} }); openingByBranch.set(row.branch, entry); }
    post(entry, 'inventory', row.value - (row.correction || 0));
    post(entry, 'opening_equity', -row.value);
    post(entry, 'cogs', row.correction || 0);
  }
  for (const entry of openingByBranch.values()) {
    if (!isIsoDate(entry.date)) { flag(null, 'invalid_document', { branch: entry.branch }); continue; }
    if (firstDate && dateNumber(entry.date) > dateNumber(firstDate)) flag(entry, 'opening_after_first', { first: firstDate });
    add(entry);
  }

  entries.sort(compareEntries);
  return { entries, flags, openingDate };
}
// ---------------------------------------------------------------- ADR-031: foreign-currency payables
// A foreign expense (supplier invoice abroad): Dr the expense account / Cr 2111 AP at the liability day's baht (`amount`),
// an open item in the currency. No Thai VAT or Thai withholding on the document itself: both come with each payment.
// Each live payment (expense.fxPayments, erp-fx-core.js planFxPayment) on its own date:
//   Dr 2111 AP (carrying baht settled) · Dr 5410 tax borne (gross-up) · Cr bank (baht of the currency sent) ·
//   Cr 2133 ภ.ง.ด.54 (tax withheld / borne) · Cr 4210 gain / Dr 5420 loss (the realised difference) ·
//   ภ.พ.36: Dr 1155 input VAT not yet claimable / Cr 2142 VAT payable on imported services; on day 1 of the claim month
//   (the month after the payment, when the ภ.พ.36 receipt exists) 1155 → 1154 (`pp36_claim`, flagged: the ภ.พ.36 is
//   assumed paid by the 7th). A cancelled payment is reversed on its cancel date (claim included).
function postFxExpense({ expense, branch, date, amount, id, settings, add, flag }) {
  const { role, known } = categoryRole(settings, expense.cat);
  const entry = newEntry({ id: `exp|${branch}|${id}`, date, branch, kind: 'expense', docNo: expense.docNo || '', docId: expense.id, party: expense.vendor, memo: expense.desc, descParams: {} });
  if (!known) flag(entry, 'unknown_category', { category: text(expense.cat) });
  if (expenseHasVatData(expense) || expense.whtEnabled === true) flag(entry, 'amounts_inconsistent');
  const ref = { kind: 'ap', key: `exp|${branch}|${id}`, no: text(expense.docNo), date, dueDate: date, party: text(expense.vendor), branch };
  post(entry, role, amount, { category: text(expense.cat) });
  post(entry, 'ap', -amount, { ref });
  add(entry);
  postFxPayments({ record: expense, branch, ref, docNo: expense.docNo, party: expense.vendor, memo: expense.desc, add, flag });
}
function postFxPayments({ record, branch, ref, docNo, party, memo, add, flag }) {
  for (const payment of Array.isArray(record.fxPayments) ? record.fxPayments : []) {
    if (!payment || typeof payment !== 'object') continue;
    const date = text(payment.date).slice(0, 10);
    if (!isIsoDate(date)) { flag(null, 'invalid_document', { docNo: text(payment.no), branch, date }); continue; }
    const settled = toSatang(payment.settledThb);
    const cash = toSatang(payment.cashThb);
    const realised = toSatang(payment.realisedThb);
    const wht = payment.wht ? toSatang(payment.wht.whtThb) : 0;
    const borne = payment.wht && payment.wht.grossUp ? toSatang(payment.wht.borneThb) : 0;
    const entry = newEntry({ id: `fxpay|${branch}|${text(payment.id)}`, date, branch, kind: 'fx_payment', docNo: payment.no || docNo || '', docId: payment.id, party, memo, descParams: { no: text(payment.no), doc: text(docNo), currency: text(payment.currency) } });
    post(entry, 'ap', settled, { ref });
    post(entry, 'exp_wht_borne', borne);
    post(entry, 'wht_pnd54', -wht);
    post(entry, 'bank', -cash);
    if (realised) post(entry, realised > 0 ? 'fx_gain' : 'fx_loss', -realised);
    const vat = payment.pp36 ? toSatang(payment.pp36.vatThb) : 0;
    post(entry, 'input_vat_undue', vat);
    post(entry, 'vat_pp36_payable', -vat);
    flag(entry, 'default_payment_account', { account: 'bank' });
    add(entry);
    let claim = null;
    if (vat > 0) {
      const period = text(payment.pp36.claimPeriod);
      if (!/^\d{4}-\d{2}$/.test(period) || period <= monthOf(date)) flag(entry, 'invalid_document');
      else {
        claim = newEntry({ id: `pp36|${branch}|${text(payment.id)}`, date: monthFirstDay(period), branch, kind: 'pp36_claim', docNo: payment.no || docNo || '', docId: payment.id, party, descParams: { period, no: text(payment.no) } });
        post(claim, 'input_vat', vat);
        post(claim, 'input_vat_undue', -vat);
        flag(claim, 'pp36_claim_assumed');
        add(claim);
      }
    }
    if (payment.status === 'voided') {
      const cancel = cancelDateOf(payment, date);
      for (const original of [entry, claim].filter(Boolean)) {
        const reversal = reversalOf(original, laterDate(cancel.date, original.date));
        if (!cancel.known) flag(reversal, 'void_date_unknown');
        add(reversal);
      }
    }
  }
}
// Each POSTED month-end close (comform_fx_documents_v1): per establishment one entry on the month's last day — AR row:
// Dr / Cr 1130 the difference (same open item as the invoice), AP row: Dr / Cr 2111 — against 4220 unrealised gain /
// 5430 unrealised loss; and the same lines reversed on day 1 of the next month (method "reverse", rule 6).
function postFxRevaluations({ closes, findInvoice, add, flag }) {
  for (const close of closes) {
    if (!close || close.status !== 'posted' || !Array.isArray(close.rows)) continue;
    const byBranch = new Map();
    for (const row of close.rows) { const list = byBranch.get(row.branch) || []; list.push(row); byBranch.set(row.branch, list); }
    for (const [branch, rows] of byBranch) {
      if (!BRANCHES.includes(branch)) { flag(null, 'invalid_document', { docNo: `FX-${close.period}`, branch, date: close.date }); continue; }
      const entry = newEntry({ id: `fxreval|${branch}|${close.id}`, date: close.date, branch, kind: 'fx_revaluation', docNo: `FX-${close.period}`, docId: close.id, descParams: { period: close.period, count: rows.length } });
      for (const row of rows) {
        const diff = toSatang(row.diffThb);
        if (!diff) continue;
        let ref;
        if (row.kind === 'ar') {
          const invoice = findInvoice({ branch, id: row.docId, no: row.no });
          ref = invoice ? arRef(invoice) : { kind: 'ar', key: row.key, no: text(row.no), date: text(row.date), dueDate: text(row.date), party: text(row.party), branch };
          if (!invoice) flag(entry, 'invoice_missing', { invoiceNo: text(row.no) });
        } else ref = { kind: 'ap', key: row.key, no: text(row.no), date: text(row.date), dueDate: text(row.date), party: text(row.party), branch };
        post(entry, row.kind === 'ar' ? 'ar' : 'ap', diff, { ref });
        post(entry, diff > 0 ? 'fx_unrealised_gain' : 'fx_unrealised_loss', -diff);
      }
      if (!entry.lines.length) continue;
      add(entry);
      const reverse = { ...entry, id: `${entry.id}|rev`, date: close.reverseDate, kind: 'fx_revaluation_reverse', descKey: 'desc.fx_revaluation_reverse', flags: [], lines: entry.lines.map(line => ({ ...line, debit: line.credit, credit: line.debit })) };
      add(reverse);
    }
  }
}
// L5 output VAT, L7 input VAT, L8 payable before carry-forward, L9 overpaid, L10 carried in, L11 payable, L12 overpaid out.
//   Dr 2154 L5 · Cr 1154 L7 · L8 > 0: Cr 1156 (L8 − L11, the carry-forward used) + Cr 2141 L11 · L9 > 0: Dr 1156 L9.
// A combined return (ยื่นรวม) splits L5 / L7 per establishment by the books when the books add up to the return, else
// everything sits at the head office and the entry is flagged. Payment: Dr 2141 / Cr bank on the filing date (flagged).
function settleFiledReturns({ input, entries, add, flag, posting }) {
  const latest = (rows, key) => { const map = new Map(); for (const row of rows) { const k = key(row); const cur = map.get(k); if (!cur || row.amendment > cur.amendment) map.set(k, row); } return [...map.values()]; };
  const vatReturns = latest((Array.isArray(input.vatReturns) ? input.vatReturns : []).filter(row => row && row.lines && /^\d{4}-\d{2}$/.test(String(row.period))), row => `${row.branchKey}|${row.period}`);
  const filingDate = (row, period) => { const filed = bangkokDateOf(row.filedAt); const next = monthFirstDay(addMonth(period)); return isIsoDate(filed) ? laterDate(filed, next) : next; };
  const perBranch = (account, period) => { const map = new Map(); const range = periodRange(period); for (const entry of entries) { if (SETTLEMENT_KINDS.includes(entry.kind) || !inRange(entry.date, range.from, range.to)) continue; for (const line of entry.lines) if (line.account === account) map.set(line.branch, (map.get(line.branch) || 0) + line.debit - line.credit); } return map; };
  for (const ret of vatReturns) {
    const L = line => toSatang(ret.lines[line] ?? ret.lines[String(line)] ?? 0);
    const period = ret.period;
    const branches = (Array.isArray(ret.branches) ? ret.branches : []).filter(branch => BRANCHES.includes(branch));
    if (!branches.length) continue;
    const head = branches.includes('ubon') ? 'ubon' : branches[0];
    const entry = newEntry({ id: `vatclose|${ret.branchKey}|${period}`, date: monthLastDay(period), branch: head, kind: 'vat_close', docNo: `PP30-${period}`, docId: ret.id, descParams: { period, amendment: ret.amendment } });
    const split = (account, total, sign) => {
      const books = perBranch(account, period);
      const parts = branches.map(branch => [branch, sign * (books.get(branch) || 0)]);
      const fits = branches.length > 1 && parts.reduce((sum, [, amount]) => sum + amount, 0) === total && parts.every(([, amount]) => amount >= 0);
      if (fits) { for (const [branch, amount] of parts) post(entry, account, -sign * amount, { branch }); return; }
      if (branches.length > 1 && total) flag(entry, 'vat_close_split_unknown');
      post(entry, account, -sign * total, { branch: head });
    };
    split('output_vat', L(5), -1); // output VAT has a credit balance: Dr L5 closes it
    split('input_vat', L(7), 1);   // input VAT has a debit balance: Cr L7 closes it
    if (L(8) > 0) { post(entry, 'vat_receivable', -(L(8) - L(11))); post(entry, 'vat_payable', -L(11)); }
    if (L(9) > 0) post(entry, 'vat_receivable', L(9));
    if (ret.amendment > 0) flag(entry, 'vat_return_amended', { amendment: ret.amendment });
    add(entry);
    if (L(11) > 0) {
      const pay = newEntry({ id: `vatpay|${ret.branchKey}|${period}`, date: filingDate(ret, period), branch: head, kind: 'vat_payment', docNo: `PP30-${period}`, docId: ret.id, descParams: { period } });
      post(pay, 'vat_payable', L(11));
      post(pay, posting.expensePaidFrom === 'cash' ? 'cash' : 'bank', -L(11));
      flag(pay, 'default_payment_account', { account: posting.expensePaidFrom === 'cash' ? 'cash' : 'bank' });
      add(pay);
    }
  }
  const whtFilings = latest((Array.isArray(input.whtFilings) ? input.whtFilings : []).filter(row => row && row.totals && /^\d{4}-\d{2}$/.test(String(row.period)) && BRANCHES.includes(row.branch)), row => `${row.branch}|${row.period}|${row.form}`);
  for (const filing of whtFilings) {
    const tax = toSatang(filing.totals.taxWithheld);
    if (!(tax > 0)) continue;
    const entry = newEntry({ id: `whtremit|${filing.branch}|${filing.period}|${filing.form}`, date: filingDate(filing, filing.period), branch: filing.branch, kind: 'wht_remit', docNo: `${filing.form}-${filing.period}`, docId: filing.id, descParams: { period: filing.period, form: filing.form } });
    post(entry, filing.form === 'PND3' ? 'wht_pnd3' : 'wht_pnd53', tax);
    post(entry, posting.expensePaidFrom === 'cash' ? 'cash' : 'bank', -tax);
    flag(entry, 'default_payment_account', { account: posting.expensePaidFrom === 'cash' ? 'cash' : 'bank' });
    add(entry);
  }
}
// r13#LOW-5: straight-line deferred revenue of multi-period service invoices (servicePeriodFrom/To) at a date — a
// SUGGESTION for the accountant (TFRS for NPAEs: revenue by stage of completion); nothing is posted. Days are counted
// inclusively; unearned = pre-VAT value × days after `asOf` ÷ all days, in satang (half-up).
//   → [{ no, branch, customer, from, to, valueSatang, days, remainingDays, unearnedSatang }]
export function deferredRevenueRows(invoices = [], asOf = '') {
  const out = [];
  if (!isIsoDate(asOf)) return out;
  const dayNo = iso => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400000);
  for (const invoice of Array.isArray(invoices) ? invoices : []) {
    if (!invoice || typeof invoice !== 'object' || !creditNoteInvoiceLive(invoice)) continue;
    const from = text(invoice.servicePeriodFrom), to = text(invoice.servicePeriodTo);
    if (!isIsoDate(from) || !isIsoDate(to) || to < from || text(invoice.date).slice(0, 10) > asOf || to <= asOf) continue;
    const basis = creditNoteInvoiceBasis(invoice);
    const valueSatang = toSatang(basis.total) - toSatang(basis.vat);
    const days = dayNo(to) - dayNo(from) + 1;
    const remainingDays = Math.min(days, dayNo(to) - Math.max(dayNo(asOf), dayNo(from) - 1));
    if (!(valueSatang > 0) || !(remainingDays > 0)) continue;
    const unearnedSatang = Math.floor((valueSatang * remainingDays * 2 + days) / (2 * days)); // half-up of value × rem ÷ days
    out.push({ no: text(invoice.no), branch: branchOf(invoice), customer: text(invoice.customer), from, to, valueSatang, days, remainingDays, unearnedSatang });
  }
  return out.sort((a, b) => (a.no < b.no ? -1 : 1));
}
function addMonth(period) {
  const [year, month] = String(period).split('-').map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}
export function compareEntries(a, b) {
  const da = dateNumber(a.date);
  const db = dateNumber(b.date);
  if (da !== db) return da - db;
  const ka = KIND_RANK.get(a.kind) ?? 99;
  const kb = KIND_RANK.get(b.kind) ?? 99;
  if (ka !== kb) return ka - kb;
  if (a.docNo !== b.docNo) return a.docNo < b.docNo ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ---------------------------------------------------------------- reading the journal
// filter: { from, to ('YYYY-MM-DD', inclusive), branch ('all' | id) }
const inRange = (date, from, to) => (!from || dateNumber(date) >= dateNumber(from)) && (!to || dateNumber(date) <= dateNumber(to));
const branchMatch = (lineBranch, branch) => !branch || branch === 'all' || lineBranch === branch;
export function periodRange(period) {
  return { from: monthFirstDay(period), to: monthLastDay(period) };
}
// Entries with at least one line in the branch and dated in the range (their lines limited to the branch).
export function entriesInRange(entries, filter = {}) {
  const out = [];
  for (const entry of entries) {
    if (!inRange(entry.date, filter.from, filter.to)) continue;
    const lines = entry.lines.filter(line => branchMatch(line.branch, filter.branch));
    if (lines.length) out.push(lines.length === entry.lines.length ? entry : { ...entry, lines });
  }
  return out;
}
// Balance (Σ debit − Σ credit) of every account: before `from` (opening), within [from, to] (period debit / credit),
// closing. → Map(accountId → { opening, debit, credit, closing })
export function accountBalances(entries, filter = {}) {
  const out = new Map();
  const get = id => { let row = out.get(id); if (!row) { row = { opening: 0, debit: 0, credit: 0, closing: 0 }; out.set(id, row); } return row; };
  for (const entry of entries) {
    const n = dateNumber(entry.date);
    if (filter.to && n > dateNumber(filter.to)) continue;
    const before = filter.from && n < dateNumber(filter.from);
    for (const line of entry.lines) {
      if (!branchMatch(line.branch, filter.branch)) continue;
      const row = get(line.account);
      if (before) row.opening += line.debit - line.credit;
      else { row.debit += line.debit; row.credit += line.credit; }
    }
  }
  for (const row of out.values()) row.closing = row.opening + row.debit - row.credit;
  return out;
}
// The trial balance of a range, by the company's account CODE (several roles mapped to one code are one row):
// → { rows: [{ code, ids, type, opening, debit, credit, closing }], totals, balanced }
export function trialBalance(entries, filter = {}, chart = effectiveChart()) {
  const balances = accountBalances(entries, filter);
  const byCode = new Map();
  for (const [id, sum] of balances) {
    const acct = chart.get(id);
    const code = acct?.code || `?${id}`;
    let row = byCode.get(code);
    if (!row) { row = { code, ids: [], type: acct?.type || 'asset', opening: 0, debit: 0, credit: 0, closing: 0 }; byCode.set(code, row); }
    row.ids.push(id);
    row.opening += sum.opening;
    row.debit += sum.debit;
    row.credit += sum.credit;
    row.closing += sum.closing;
  }
  const rows = [...byCode.values()].filter(row => row.opening || row.debit || row.credit || row.closing).sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const totals = { openingDebit: 0, openingCredit: 0, debit: 0, credit: 0, closingDebit: 0, closingCredit: 0 };
  for (const row of rows) {
    if (row.opening >= 0) totals.openingDebit += row.opening; else totals.openingCredit -= row.opening;
    totals.debit += row.debit;
    totals.credit += row.credit;
    if (row.closing >= 0) totals.closingDebit += row.closing; else totals.closingCredit -= row.closing;
  }
  const balanced = totals.openingDebit === totals.openingCredit && totals.debit === totals.credit && totals.closingDebit === totals.closingCredit;
  return { rows, totals, balanced };
}
// The ledger of one account code: opening balance, the lines of the range with a running balance, closing.
export function generalLedger(entries, filter = {}, chart = effectiveChart(), code = '') {
  const ids = new Set([...chart.values()].filter(acct => acct.code === code).map(acct => acct.id));
  let opening = 0;
  const lines = [];
  let running = 0;
  for (const entry of entries) {
    const n = dateNumber(entry.date);
    if (filter.to && n > dateNumber(filter.to)) continue;
    const before = filter.from && n < dateNumber(filter.from);
    entry.lines.forEach((line, index) => {
      if (!ids.has(line.account) || !branchMatch(line.branch, filter.branch)) return;
      if (before) { opening += line.debit - line.credit; return; }
      lines.push({ entry, line, index });
    });
  }
  running = opening;
  const rows = lines.map(({ entry, line, index }) => { running += line.debit - line.credit; return { entry, line, index, balance: running }; });
  const debit = rows.reduce((sum, row) => sum + row.line.debit, 0);
  const credit = rows.reduce((sum, row) => sum + row.line.credit, 0);
  return { code, opening, rows, debit, credit, closing: opening + debit - credit };
}
// Movement of some accounts (ids) in a range and branch: Σ debit − Σ credit.
export function movement(entries, ids, filter = {}) {
  const set = new Set(ids);
  const skip = Array.isArray(filter.excludeKinds) ? new Set(filter.excludeKinds) : null;
  let sum = 0;
  for (const entry of entries) {
    if (!inRange(entry.date, filter.from, filter.to)) continue;
    if (skip && skip.has(entry.kind)) continue;
    for (const line of entry.lines) if (set.has(line.account) && branchMatch(line.branch, filter.branch)) sum += line.debit - line.credit;
  }
  return sum;
}
// Open items of AR or AP as of a date (from the ledger lines that carry a reference): one item per reference with a
// non-zero balance (AR: debit balance = owed to us; AP: credit balance = owed by us), plus lines without a reference.
export function openItems(entries, kind, filter = {}) {
  const account = kind === 'ap' ? 'ap' : 'ar';
  const items = new Map();
  for (const entry of entries) {
    if (filter.to && dateNumber(entry.date) > dateNumber(filter.to)) continue;
    entry.lines.forEach((line, index) => {
      if (line.account !== account || !branchMatch(line.branch, filter.branch)) return;
      const ref = line.ref;
      const key = ref?.key || `unref|${entry.id}|${index}`;
      let item = items.get(key);
      if (!item) { item = { key, no: ref?.no || entry.docNo, date: ref?.date || entry.date, dueDate: ref?.dueDate || ref?.date || entry.date, party: ref?.party || entry.party, branch: line.branch, balance: 0, linked: !!ref }; items.set(key, item); }
      item.balance += account === 'ar' ? line.debit - line.credit : line.credit - line.debit;
    });
  }
  return [...items.values()].filter(item => item.balance !== 0).sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.no < b.no ? -1 : 1));
}
// Work in progress by job as of a date (WIP ledger lines carry the job key).
export function wipByJob(entries, filter = {}) {
  const jobs = new Map();
  for (const entry of entries) {
    if (filter.to && dateNumber(entry.date) > dateNumber(filter.to)) continue;
    for (const line of entry.lines) {
      if (line.account !== 'wip' || !branchMatch(line.branch, filter.branch)) continue;
      const key = line.jobKey || '';
      jobs.set(key, (jobs.get(key) || 0) + line.debit - line.credit);
    }
  }
  return [...jobs.entries()].filter(([, balance]) => balance !== 0).map(([jobKey, balance]) => ({ jobKey, balance })).sort((a, b) => (a.jobKey < b.jobKey ? -1 : 1));
}
// WIP of each job as of a date computed from the job cost sheets (an independent path from the same data): materials
// issued / returned, labour, overhead and other costs dated on or before the date, less the completion when it is.
export function sheetWipAsOf(sheets, asOf) {
  const out = new Map();
  const upTo = date => dateNumber(date) <= dateNumber(asOf);
  for (const sheet of sheets instanceof Map ? sheets.values() : []) {
    let wip = 0;
    for (const line of sheet.materials.issues) if (upTo(line.date)) wip += line.value;
    for (const line of sheet.materials.returns) if (upTo(line.date)) wip -= line.value;
    for (const entry of sheet.labour.entries) if (upTo(entry.date)) wip += entry.amountSatang + entry.overheadSatang;
    for (const entry of sheet.other.entries) if (upTo(entry.date)) wip += entry.amountSatang;
    if (sheet.completion && upTo(sheet.completion.date)) wip -= sheet.total;
    if (wip) out.set(sheet.job.key, wip);
  }
  return out;
}

// ---------------------------------------------------------------- exports
// Accounting entry numbers of a set of entries (one export / one screen): <prefix><BE yy><mm>-<0001…> per month, in
// journal order — so a file always numbers its entries 1, 2, 3… (PEAK groups the lines of one entry by its number).
export function numberEntries(entries, prefix = 'GJ') {
  const counters = new Map();
  const out = new Map();
  for (const entry of entries) {
    const period = monthOf(entry.date);
    const n = (counters.get(period) || 0) + 1;
    counters.set(period, n);
    const [year, month] = period.split('-');
    out.set(entry.id, `${prefix}${String(Number(year) + 543).slice(-2)}${month}-${String(n).padStart(4, '0')}`);
  }
  return out;
}
// "ส่งเป็นรายการไม่นับสต็อก + ต้นทุนขายเป็นสมุดรายวันสิ้นเดือน": the per-invoice cost-of-sales entries (and returns) of
// each month and branch become ONE entry on the month's last day — the same amounts, so the receiving system (PEAK set to
// non-stock items / periodic) never computes a second cost of sales.
export function consolidateCogs(entries) {
  const merged = new Map();
  const out = [];
  for (const entry of entries) {
    if (entry.kind !== 'cogs' && entry.kind !== 'cogs_return') { out.push(entry); continue; }
    const period = monthOf(entry.date);
    const key = `${period}|${entry.branch}`;
    let target = merged.get(key);
    if (!target) {
      target = newEntry({ id: `cogsmonth|${key}`, date: monthLastDay(period), branch: entry.branch, kind: 'cogs', descKey: 'desc.cogsMonth', descParams: { period } });
      target.sums = new Map();
      merged.set(key, target);
      out.push(target);
    }
    for (const line of entry.lines) {
      const k = `${line.account}|${line.branch}`;
      target.sums.set(k, (target.sums.get(k) || 0) + line.debit - line.credit);
    }
  }
  for (const target of merged.values()) {
    for (const [k, amount] of target.sums) { const [acct, branch] = k.split('|'); post(target, acct, amount, { branch }); }
    delete target.sums;
    finalize(target);
  }
  return out.sort(compareEntries);
}
// RFC-4180 CSV reader (quotes, doubled quotes, CR / LF / CRLF, a UTF-8 BOM). → [[cell]]
export function parseCsv(textValue) {
  const source = String(textValue ?? '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') { quoted = true; continue; }
    if (ch === ',') { row.push(cell); cell = ''; continue; }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && source[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }
  if (quoted) throw Object.assign(new Error('CSV: an opening quote is never closed'), { code: 'csv_quote' });
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(cells => cells.some(value => String(value).trim() !== ''));
}

// ---------------------------------------------------------------- opening-balance import (CSV)
// One CSV: type (STOCK / AR / AP), branch code (00000 = head office, 00001 = the branch), code (product / customer /
// supplier code), name, document no, document date, due date (YYYY-MM-DD or DD/MM/YYYY พ.ศ. / ค.ศ.), qty, unit cost,
// amount. Header row = OPENING_CSV_HEADER (the Thai names; the English names are accepted too).
export const OPENING_CSV_HEADER = Object.freeze(['ประเภท', 'สาขา', 'รหัส', 'ชื่อ', 'เลขที่เอกสาร', 'วันที่เอกสาร', 'วันครบกำหนด', 'จำนวน', 'ต้นทุนต่อหน่วย', 'ยอดคงค้าง']);
export const OPENING_CSV_HEADER_EN = Object.freeze(['type', 'branch', 'code', 'name', 'doc_no', 'doc_date', 'due_date', 'qty', 'unit_cost', 'amount']);
export function openingCsvTemplate() {
  return [
    [...OPENING_CSV_HEADER],
    ['STOCK', '00000', 'DEMO-NB01', 'โน้ตบุ๊กธุรกิจ 14 นิ้ว', '', '', '', '5', '19500', ''],
    ['AR', '00000', 'C-001', 'บจก. ลูกค้าตัวอย่าง', 'INV-OLD-0001', '2026-08-15', '2026-09-14', '', '', '10700.00'],
    ['AP', '00000', 'S-001', 'บจก. ผู้ขายตัวอย่าง', 'PI-OLD-0042', '2026-08-20', '2026-09-19', '', '', '5350.00']
  ];
}
// A date written as YYYY-MM-DD, DD/MM/YYYY (ค.ศ.) or DD/MM/YYYY พ.ศ. (year ≥ 2400) → 'YYYY-MM-DD' | '' (blank) | null (bad).
export function parseImportDate(value) {
  const raw = text(value);
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return isIsoDate(raw) ? raw : null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (!m) return null;
  const year = Number(m[3]) >= 2400 ? Number(m[3]) - 543 : Number(m[3]);
  const iso = `${String(year).padStart(4, '0')}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return isIsoDate(iso) ? iso : null;
}
const parseNumber = value => {
  const raw = text(value).replace(/,/g, '');
  if (!raw) return null;
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return NaN;
  return Number(raw);
};
// rows: parsed CSV (header first); context: { asOf (the balance date), branchCodes: { '00000': 'ubon', … }, products,
// isStockProduct(product), resolveProduct(code) } → { rows: [{ line, kind, branch, …, errors: [code] }], errors (file
// level), totals: { ar, ap, stockValue }, ok }
export function planOpeningImport(rows, context = {}) {
  const fileErrors = [];
  const out = [];
  if (!Array.isArray(rows) || rows.length < 2) return { rows: [], errors: ['empty'], totals: { ar: 0, ap: 0, stockValue: 0, stockRows: 0 }, ok: false };
  const header = rows[0].map(cell => text(cell).toLowerCase());
  const want = OPENING_CSV_HEADER.map((th, i) => [th.toLowerCase(), OPENING_CSV_HEADER_EN[i]]);
  const column = want.map(([th, en]) => header.findIndex(cell => cell === th || cell === en));
  if (column.slice(0, 4).some(index => index < 0) || column[9] < 0) fileErrors.push('header');
  if (!isIsoDate(context.asOf)) fileErrors.push('as_of');
  if (fileErrors.length) return { rows: [], errors: fileErrors, totals: { ar: 0, ap: 0, stockValue: 0, stockRows: 0 }, ok: false };
  const branchCodes = context.branchCodes || { '00000': 'ubon', '00001': 'khonkaen' };
  const seenStock = new Set();
  const seenDoc = new Set();
  // The costing settings keep ONE opening cost per product (openingCosts[sku]): two branches of one product must agree.
  const costOfProduct = new Map();
  const totals = { ar: 0, ap: 0, stockValue: 0, stockRows: 0 };
  rows.slice(1).forEach((cells, index) => {
    const get = i => (column[i] >= 0 ? text(cells[column[i]]) : '');
    const errors = [];
    const type = get(0).toUpperCase();
    const kind = type === 'STOCK' ? 'stock' : type === 'AR' ? 'ar' : type === 'AP' ? 'ap' : '';
    if (!kind) errors.push('type');
    const branchCode = get(1).replace(/\D/g, '').padStart(5, '0');
    const branch = hasOwn(branchCodes, branchCode) ? branchCodes[branchCode] : '';
    if (!branch) errors.push('branch');
    const row = { line: index + 2, kind, branch, branchCode, code: get(2), name: get(3), docNo: get(4), docDate: '', dueDate: '', qtyMilli: 0, unitCost: 0, amount: 0, value: 0, product: null, errors };
    if (kind === 'stock') {
      const product = typeof context.resolveProduct === 'function' ? context.resolveProduct(row.code) : null;
      if (!product) errors.push('product_unknown');
      else if (typeof context.isStockProduct === 'function' && !context.isStockProduct(product)) errors.push('product_not_stock');
      row.product = product;
      if (product) row.name = text(product.name);
      const qty = parseNumber(get(7));
      const cost = parseNumber(get(8));
      if (qty === null || !Number.isFinite(qty) || qty < 0) errors.push('qty');
      else if (Math.round(qty * 1000) / 1000 !== qty) errors.push('qty');
      if (cost === null || !Number.isFinite(cost) || cost < 0) errors.push('unit_cost');
      if (qty !== null && Number.isFinite(qty) && qty >= 0) row.qtyMilli = Math.round(qty * 1000);
      if (cost !== null && Number.isFinite(cost) && cost >= 0) row.unitCost = toSatang(cost);
      if (cost !== null && Number.isFinite(cost) && toSatang(cost) / 100 !== cost) errors.push('unit_cost');
      const key = `${branch}|${text(product?.code || row.code).toLowerCase()}`;
      if (seenStock.has(key)) errors.push('duplicate');
      seenStock.add(key);
      const productKey = text(product?.code || row.code).toLowerCase();
      if (product && !errors.includes('unit_cost')) {
        if (costOfProduct.has(productKey) && costOfProduct.get(productKey) !== row.unitCost) errors.push('unit_cost_differs');
        else costOfProduct.set(productKey, row.unitCost);
      }
      row.value = Math.round(row.qtyMilli * row.unitCost / 1000);
      if (!errors.length) { totals.stockValue += row.value; totals.stockRows += 1; }
    } else if (kind) {
      if (!row.name) errors.push('name');
      const amount = parseNumber(get(9));
      if (amount === null || !Number.isFinite(amount) || amount <= 0 || toSatang(amount) / 100 !== amount) errors.push('amount');
      else row.amount = toSatang(amount);
      const docDate = parseImportDate(get(5));
      const dueDate = parseImportDate(get(6));
      if (docDate === null) errors.push('doc_date');
      else row.docDate = docDate;
      if (dueDate === null) errors.push('due_date');
      else row.dueDate = dueDate;
      if (row.docDate && dateNumber(row.docDate) > dateNumber(context.asOf)) errors.push('doc_after_as_of');
      const key = `${kind}|${branch}|${row.docNo.toLowerCase()}`;
      if (row.docNo && seenDoc.has(key)) errors.push('duplicate');
      if (row.docNo) seenDoc.add(key);
      if (!errors.length) totals[kind] += row.amount;
    }
    out.push(row);
  });
  if (!out.length) fileErrors.push('empty');
  const ok = !fileErrors.length && out.every(row => !row.errors.length);
  return { rows: out, errors: fileErrors, totals, ok };
}

// ---------------------------------------------------------------- manual entries
// draft: { date, branch, memo, lines: [{ account, debit, credit (baht), memo, openItem }] } + chart → { ok, lines (satang),
// error } — errors: date, branch, lines, line_account, line_amount, unbalanced, zero.
export function planManualEntry(draft = {}, chart = effectiveChart()) {
  if (!isIsoDate(draft.date)) return { ok: false, error: 'date' };
  if (!BRANCHES.includes(draft.branch)) return { ok: false, error: 'branch' };
  const raw = (Array.isArray(draft.lines) ? draft.lines : []).filter(line => line && (text(line.account) || text(line.debit) || text(line.credit)));
  if (raw.length < 2) return { ok: false, error: 'lines' };
  const lines = [];
  for (const [index, line] of raw.entries()) {
    if (!chart.has(text(line.account))) return { ok: false, error: 'line_account', line: index + 1 };
    const debit = parseNumber(line.debit) ?? 0;
    const credit = parseNumber(line.credit) ?? 0;
    if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0 || (debit > 0) === (credit > 0) || toSatang(debit) / 100 !== debit || toSatang(credit) / 100 !== credit) return { ok: false, error: 'line_amount', line: index + 1 };
    lines.push({ account: text(line.account), debit: toSatang(debit), credit: toSatang(credit), memo: cleanName(line.memo).slice(0, 200), openItem: text(line.openItem).slice(0, 160) });
  }
  const debit = lines.reduce((sum, line) => sum + line.debit, 0);
  const credit = lines.reduce((sum, line) => sum + line.credit, 0);
  if (debit !== credit) return { ok: false, error: 'unbalanced', debit, credit };
  if (!debit) return { ok: false, error: 'zero' };
  return { ok: true, lines, total: debit, memo: cleanName(draft.memo).slice(0, 300) };
}
// Next manual-entry number of a month: JV + พ.ศ. yy + mm + "-" + 4 digits (never reused: cancelled ones count).
export function nextManualNo(manual, date) {
  const [year, month] = date.split('-');
  const prefix = `JV${String(Number(year) + 543).slice(-2)}${month}-`;
  const max = manual.reduce((top, doc) => (doc.no.startsWith(prefix) ? Math.max(top, Number(doc.no.slice(prefix.length)) || 0) : top), 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

// ---------------------------------------------------------------- overhead close and NRV write-down
// The month's over / under-applied overhead of one branch, closed to cost of sales (OpenStax, Principles of Managerial
// Accounting ch. 4): applied = the credit of "overhead applied" in the month; actual = the expense lines of the overhead
// categories (costing settings) in the month, per account; less what earlier live closes of the month already moved.
// → { ok, applied, actual: { role: satang }, cogs (actual − applied: + = under-applied), error 'nothing' }
export function planOverheadClose(entries, { branch, period, categories = [], closes = [] } = {}) {
  const { from, to } = periodRange(period);
  const cats = new Set(categories.map(text));
  let applied = 0;
  const actual = {};
  for (const entry of entries) {
    if (!inRange(entry.date, from, to) || entry.kind === 'overhead_close') continue;
    for (const line of entry.lines) {
      if (line.branch !== branch) continue;
      if (line.account === 'overhead_applied') applied += line.credit - line.debit;
      if (line.category && cats.has(line.category) && EXPENSE_ROLES.includes(line.account)) actual[line.account] = (actual[line.account] || 0) + line.debit - line.credit;
    }
  }
  for (const doc of closes) {
    if (doc.status !== 'posted' || doc.branch !== branch || doc.period !== period) continue;
    applied -= doc.applied;
    for (const [role, amount] of Object.entries(doc.actual)) actual[role] = (actual[role] || 0) - amount;
  }
  for (const role of Object.keys(actual)) if (!actual[role]) delete actual[role];
  const totalActual = Object.values(actual).reduce((sum, amount) => sum + amount, 0);
  if (!applied && !totalActual) return { ok: false, error: 'nothing' };
  return { ok: true, applied, actual, cogs: totalActual - applied, date: monthLastDay(period) };
}
// NRV write-down at a date for one branch: the allowance must equal the NRV report's write-down (target); the entry posts
// the difference from the allowance already booked (a fall in the write-down reverses part of it).
export function planNrvEntry(entries, { branch, date, target }) {
  const booked = 0 - movement(entries, ['inventory_allowance'], { to: date, branch }); // 0 − x: never −0
  const delta = target - booked;
  if (!delta) return { ok: false, error: 'nothing', booked };
  return { ok: true, delta, booked, target };
}

// ---------------------------------------------------------------- the period lock over derived journals
// Entries (before / after a change) that differ inside a closed period: isLocked(branch, date) → bool.
// → [{ id, date, branch }] (sorted) — a change is refused when this is not empty.
const entryFingerprint = entry => `${entry.date}|${entry.lines.map(line => `${line.account}:${line.branch}:${line.debit}:${line.credit}`).sort().join(',')}`;
export function lockedJournalChanges(before, after, isLocked) {
  if (typeof isLocked !== 'function') return [];
  const out = [];
  const after1 = new Map(after.map(entry => [entry.id, entry]));
  const seen = new Set();
  const check = (a, b) => {
    const entry = a || b;
    const same = a && b && entryFingerprint(a) === entryFingerprint(b);
    if (same) return;
    const touched = [a, b].filter(Boolean);
    for (const row of touched) {
      const branches = new Set(row.lines.map(line => line.branch));
      for (const branch of branches) if (isLocked(branch, row.date)) { out.push({ id: entry.id, date: row.date, branch }); return; }
    }
  };
  for (const a of before) { seen.add(a.id); check(a, after1.get(a.id)); }
  for (const b of after) if (!seen.has(b.id)) check(null, b);
  return out.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.id < y.id ? -1 : 1));
}
