// ============================================================================
// finance action core — pure Billing / Payment / Receipt action plans
// ERP DEMO 4.3.1 — Document / Finance Action Core
// Pure business planner: runtime side effects live in orchestration modules.
// ============================================================================

export const FINANCE_ACTION_ERROR_CODES = Object.freeze({
  VALIDATION: 'validation_error',
  CONFLICT: 'conflict_error',
  DEPENDENCY: 'dependency_error',
  PERMISSION: 'permission_error',
  STORAGE: 'storage_error',
  SYNC: 'sync_error',
  UNKNOWN: 'unknown_error'
});

export class FinanceActionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FinanceActionError';
    this.code = code || FINANCE_ACTION_ERROR_CODES.VALIDATION;
    this.details = details;
  }
}

const financeActionKnownCodes = new Set(Object.values(FINANCE_ACTION_ERROR_CODES));
// Codes raised by other modules that map onto a finance-action category. A closed
// accounting period (GovernanceError 'period_locked' from assertPeriodOpen) is a
// system lock, not an unknown failure; its Thai message (which period, how to
// proceed) is passed through unchanged.
const financeActionCodeAliases = Object.freeze({ period_locked: FINANCE_ACTION_ERROR_CODES.PERMISSION });

export function normalizeDocumentActionError(error, context = {}) {
  const rawCode = String(error?.code || '').trim();
  const alias = Object.prototype.hasOwnProperty.call(financeActionCodeAliases, rawCode) ? financeActionCodeAliases[rawCode] : '';
  let code = financeActionKnownCodes.has(rawCode) ? rawCode : (alias || FINANCE_ACTION_ERROR_CODES.UNKNOWN);
  if (code === FINANCE_ACTION_ERROR_CODES.UNKNOWN && (error?.name === 'QuotaExceededError' || error?.code === 22 || error?.code === 1014)) {
    code = FINANCE_ACTION_ERROR_CODES.STORAGE;
  }
  const message = String(error?.message || error || 'เกิดข้อผิดพลาดที่ไม่คาดคิด').trim() || 'เกิดข้อผิดพลาดที่ไม่คาดคิด';
  return Object.freeze({
    code,
    message,
    stage: String(context.stage || error?.stage || 'unknown'),
    action: String(context.action || error?.action || 'erp_action'),
    details: error?.details && typeof error.details === 'object' ? { ...error.details } : {},
    name: String(error?.name || 'Error')
  });
}

export function documentActionFeedback(input = {}) {
  if (input?.ok) return Object.freeze({ type: 'success', title: 'สำเร็จ', message: '', guidance: '', text: '' });
  const normalized = input?.code ? input : normalizeDocumentActionError(input, input);
  const committed = !!input?.committed;
  const catalog = {
    [FINANCE_ACTION_ERROR_CODES.VALIDATION]: ['ข้อมูลยังไม่ครบหรือไม่ถูกต้อง', 'ตรวจช่องกรอกและยอดเงินที่ระบุ แล้วลองใหม่'],
    [FINANCE_ACTION_ERROR_CODES.CONFLICT]: ['ข้อมูลปัจจุบันไม่ตรงกับรายการที่กำลังบันทึก', 'เปิดเอกสารหรือรายการอ้างอิงใหม่ แล้วตรวจยอด/สถานะล่าสุดก่อนบันทึกอีกครั้ง'],
    [FINANCE_ACTION_ERROR_CODES.DEPENDENCY]: ['ไม่พบข้อมูลต้นทางที่จำเป็น', 'ตรวจเอกสารอ้างอิงหรือ Workflow ต้นทาง แล้วเลือกข้อมูลใหม่'],
    [FINANCE_ACTION_ERROR_CODES.PERMISSION]: ['รายการนี้ถูกล็อกตามกติกาของระบบ', 'ใช้ขั้นตอนยกเลิก/ย้อนรายการที่เกี่ยวข้องก่อนแก้ไขเอกสารนี้'],
    [FINANCE_ACTION_ERROR_CODES.STORAGE]: ['ไม่สามารถยืนยันการบันทึกข้อมูลในเครื่องได้', 'ระบบหยุดเพื่อป้องกันข้อมูลสูญหาย กรุณาสำรองข้อมูลและตรวจพื้นที่จัดเก็บก่อนลองใหม่'],
    [FINANCE_ACTION_ERROR_CODES.SYNC]: ['ข้อมูลในเครื่องบันทึกแล้ว แต่การซิงก์ยังไม่สมบูรณ์', 'อย่าทำรายการซ้ำ ให้ตรวจสถานะ Cloud/เครือข่าย แล้วใช้ข้อมูลในเครื่องเป็นหลักจนกว่าจะซิงก์สำเร็จ'],
    [FINANCE_ACTION_ERROR_CODES.UNKNOWN]: ['เกิดข้อผิดพลาดที่ระบบยังจำแนกไม่ได้', 'อย่าทำรายการซ้ำทันที กรุณาตรวจข้อมูลล่าสุดหรือรีเฟรชก่อนลองอีกครั้ง']
  };
  const [title, guidance] = catalog[normalized.code] || catalog[FINANCE_ACTION_ERROR_CODES.UNKNOWN];
  const prefix = committed ? 'ข้อมูลหลักถูกบันทึกแล้ว แต่ขั้นตอนหลังบันทึกไม่สมบูรณ์' : title;
  const type = committed ? 'warning' : 'error';
  const text = [prefix, normalized.message, guidance].filter(Boolean).join('\n');
  return Object.freeze({ type, title: prefix, message: normalized.message, guidance, text, code: normalized.code, stage: normalized.stage, committed });
}

async function runDocumentAction(input = {}) {
  const action = String(input.action || 'erp_action');
  let stage = 'validate';
  let value = input.context;
  let committed = false;
  try {
    if (typeof input.validate === 'function') {
      const next = await input.validate(value);
      if (next !== undefined) value = next;
    }
    stage = 'plan';
    if (typeof input.plan === 'function') {
      const next = await input.plan(value);
      if (next !== undefined) value = next;
    }
    stage = 'commit';
    if (typeof input.commit === 'function') {
      const next = await input.commit(value);
      if (next !== undefined) value = next;
    }
    committed = true;
    stage = 'after_commit';
    if (typeof input.afterCommit === 'function') {
      const next = await input.afterCommit(value);
      if (next !== undefined) value = next;
    }
    return Object.freeze({ ok: true, action, stage: 'completed', committed: true, value });
  } catch (error) {
    const normalized = normalizeDocumentActionError(error, { action, stage });
    return Object.freeze({ ok: false, action, stage, committed, ...normalized });
  }
}

export { runDocumentAction };

const financeNum = value => Number.isFinite(Number(value)) ? Number(value) : 0;
// Round-half-up to 2 decimals per Thai Revenue Department Order Por.86/2542,
// snapping to 8 decimal places first to erase binary floating-point
// representation noise (see erp-shared-core.js#roundMoneyValue for the same
// fix and rationale — duplicated here since this module is kept import-free).
export const roundFinanceMoney = value => {
  const cents = financeNum(value) * 100;
  const correctedCents = Math.round(cents * 1e8) / 1e8;
  return Math.round(correctedCents) / 100;
};
// Reconciliation tolerance: a receipt/billing request within a satang or two
// of the outstanding balance is settled, not an overpayment exception.
const FINANCE_RECONCILE_TOLERANCE = 0.01;
const financeNorm = value => String(value ?? '').trim().toLowerCase();
const financeLive = record => !!record && !record.voided && !record.cancelled && !record.reversed && record.status !== 'cancelled' && record.documentStatus !== 'cancelled';
const financeBranchOf = record => String(record?.branch ?? record?._branch ?? record?.invoiceBranch ?? '').trim();
const financeIdOf = record => String(record?.invoiceId ?? record?.id ?? '').trim();
const financeNoOf = record => String(record?.invoiceNo ?? record?.invNo ?? record?.no ?? '').trim();
// Same rule as erp-shared-core.js#normalizeTaxInvoiceForm (kept local because
// this module is import-free): anything but 'abbreviated' is a full-form invoice.
const financeTaxInvoiceForm = record => (record?.taxInvoiceForm === 'abbreviated' ? 'abbreviated' : 'full');
const financeVatModeOf = record => {
  if (['add', 'extract', 'none'].includes(record?.vatMode)) return record.vatMode;
  const useVat = financeNum(record?.useVat);
  return useVat === 1 ? 'add' : useVat === 2 ? 'none' : 'extract';
};
// Same as erp-shared-core.js#effectiveTaxInvoiceForm: an 'abbreviated' record
// that is not VAT-inclusive (it bypassed the planner, e.g. an old JSON import)
// is really a full-form invoice — its stored amounts are kept as they are.
const financeEffectiveTaxInvoiceForm = record =>
  (financeTaxInvoiceForm(record) === 'abbreviated' && financeVatModeOf(record) === 'extract' ? 'abbreviated' : 'full');
// Same text as erp-shared-core.js GENERAL_CUSTOMER_NAME / isGeneralCustomerName.
const FINANCE_GENERAL_CUSTOMER_NAME = 'ลูกค้าทั่วไป / เงินสด';
const financeIsGeneralCustomer = name => {
  const text = String(name ?? '').replace(/\s+/g, ' ').trim();
  return !text || text === FINANCE_GENERAL_CUSTOMER_NAME;
};

// Restore/import normalization: an abbreviated invoice whose VAT mode is not
// VAT-inclusive becomes taxInvoiceForm 'full' (amounts untouched), so print,
// edit and the books agree. Returns the same pack object when nothing changes.
export function normalizeInvoiceTaxFormsInPack(pack) {
  if (!pack || typeof pack !== 'object') return pack;
  let changed = false;
  const fix = rows => (Array.isArray(rows) ? rows.map(row => {
    if (!row || financeTaxInvoiceForm(row) !== 'abbreviated' || financeEffectiveTaxInvoiceForm(row) === 'abbreviated') return row;
    changed = true;
    return { ...row, taxInvoiceForm: 'full' };
  }) : rows);
  const out = { ...pack, invoices: fix(pack.invoices), issuedInvoices: fix(pack.issuedInvoices) };
  if (pack.invoices === undefined) delete out.invoices;
  if (pack.issuedInvoices === undefined) delete out.issuedInvoices;
  return changed ? out : pack;
}

export function financeInvoiceRef(record = {}) {
  return Object.freeze({
    id: financeIdOf(record),
    no: financeNoOf(record),
    branch: financeBranchOf(record),
    year: record?.year ?? record?._year ?? record?.invoiceYear ?? '',
    month: record?.month ?? record?._month ?? record?.invoiceMonth ?? ''
  });
}

export function sameFinanceInvoice(a = {}, b = {}) {
  const ar = financeInvoiceRef(a), br = financeInvoiceRef(b);
  if (ar.branch && br.branch && ar.branch !== br.branch) return false;
  if (ar.id && br.id && ar.id === br.id) return true;
  return !!ar.no && !!br.no && ar.no === br.no;
}

function financeRequireText(value, message) {
  const text = String(value ?? '').trim();
  if (!text) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, message);
  return text;
}

function financeRequirePositiveMoney(value, message) {
  const amount = roundFinanceMoney(value);
  if (!(amount > 0)) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, message);
  return amount;
}

function financeAssertSingleBranchCustomer(invoices) {
  const branchKeys = new Set(invoices.map(financeBranchOf));
  if (branchKeys.size !== 1 || branchKeys.has('')) {
    throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, 'ใบวางบิลต้องอ้างอิง Invoice จากสาขาเดียวกัน');
  }
  const customers = new Set(invoices.map(row => financeNorm(row.customer)));
  if (customers.size !== 1 || customers.has('')) {
    throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, 'ใบวางบิลต้องเป็น Invoice ของลูกค้ารายเดียวกัน');
  }
}

function financeActiveBillingContainsInvoice(note, invoice) {
  if (!financeLive(note) || ['paid'].includes(String(note.status || '').toLowerCase())) return false;
  return (note.lines || []).some(line => sameFinanceInvoice(line, invoice));
}

export function buildBillingAction(input = {}) {
  const invoices = Array.isArray(input.invoices) ? input.invoices : [];
  if (!invoices.length) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, 'กรุณาเลือก Invoice อย่างน้อย 1 ใบ');
  if (invoices.some(row => !financeLive(row))) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, 'มี Invoice ที่ยกเลิกหรือไม่พร้อมใช้งาน');
  financeAssertSingleBranchCustomer(invoices);

  const seen = [];
  for (const invoice of invoices) {
    if (seen.some(old => sameFinanceInvoice(old, invoice))) {
      throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, `พบ Invoice ซ้ำในคำขอวางบิล: ${financeNoOf(invoice) || financeIdOf(invoice)}`);
    }
    seen.push(invoice);
  }

  const no = financeRequireText(input.no, 'กรุณาระบุเลขใบวางบิล');
  const existing = Array.isArray(input.existingBillingNotes) ? input.existingBillingNotes : [];
  if (existing.some(row => financeNorm(row.no) === financeNorm(no))) {
    throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, 'เลขใบวางบิลซ้ำ');
  }
  for (const invoice of invoices) {
    if (existing.some(note => financeActiveBillingContainsInvoice(note, invoice))) {
      throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, `Invoice ${financeNoOf(invoice) || financeIdOf(invoice)} อยู่ในใบวางบิลที่ยังไม่ปิดแล้ว`);
    }
  }

  const requested = Array.isArray(input.requestedAmounts) ? input.requestedAmounts : [];
  const lines = invoices.map((invoice, index) => {
    const outstanding = roundFinanceMoney(Math.max(0, financeNum(invoice.outstanding)));
    const requestedAmount = requested[index] === undefined ? outstanding : roundFinanceMoney(requested[index]);
    if (!(requestedAmount > 0)) return null;
    if (requestedAmount > outstanding + FINANCE_RECONCILE_TOLERANCE) {
      throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, `ยอดวางบิลของ ${financeNoOf(invoice) || financeIdOf(invoice)} เกินยอดคงค้าง`);
    }
    const total = roundFinanceMoney(invoice.total ?? invoice.saleTotal);
    return {
      invoiceId: invoice.id,
      invoiceNo: invoice.no,
      branch: financeBranchOf(invoice),
      year: invoice.year ?? invoice._year ?? '',
      month: invoice.month ?? invoice._month ?? '',
      invoiceDate: invoice.date || '',
      originalAmount: total,
      outstandingAmount: outstanding,
      receiptPaidAtCreation: roundFinanceMoney(invoice.receiptPaidAtCreation),
      billedAmount: requestedAmount
    };
  }).filter(Boolean);
  if (!lines.length) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, 'ยอดวางบิลต้องมากกว่า 0');

  const createdAt = String(input.createdAt || new Date().toISOString());
  return {
    id: financeRequireText(input.id, 'ไม่สามารถสร้างรหัสใบวางบิลได้'),
    no,
    customer: String(invoices[0].customer || '').trim(),
    branch: financeBranchOf(invoices[0]),
    billingDate: financeRequireText(input.billingDate, 'กรุณาระบุวันที่วางบิล'),
    appointmentDate: String(input.appointmentDate || ''),
    dueDate: String(input.dueDate || invoices.map(row => row.dueDate).filter(Boolean).sort().slice(-1)[0] || ''),
    recipient: String(input.recipient || '').trim(),
    note: String(input.note || '').trim(),
    lines,
    totalBilled: roundFinanceMoney(lines.reduce((sum, line) => sum + line.billedAmount, 0)),
    paidAmount: 0,
    outstandingAmount: roundFinanceMoney(lines.reduce((sum, line) => sum + line.billedAmount, 0)),
    paymentStatus: 'pending',
    status: 'draft',
    documentStatus: 'draft',
    createdAt,
    updatedAt: createdAt
  };
}

export function planBillingPaymentAction(input = {}) {
  const billing = input.billing;
  if (!billing || !financeLive(billing)) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, 'ไม่พบใบวางบิลที่รับชำระได้');
  const lines = Array.isArray(billing.lines) ? billing.lines : [];
  if (!lines.length) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, 'ใบวางบิลไม่มีรายการ Invoice');

  const amount = financeRequirePositiveMoney(input.amount, 'ยอดรับชำระต้องมากกว่า 0');
  const no = financeRequireText(input.no, 'กรุณาระบุเลข Payment');
  const payments = Array.isArray(input.existingPayments) ? input.existingPayments : [];
  if (payments.some(row => financeNorm(row.no) === financeNorm(no))) {
    throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, 'เลข Payment ซ้ำ');
  }
  const invoiceStates = Array.isArray(input.invoiceStates) ? input.invoiceStates : [];
  let left = amount;
  const allocations = [];

  for (const line of lines) {
    const invoice = invoiceStates.find(row => sameFinanceInvoice(row, line));
    if (!invoice || !financeLive(invoice)) continue;
    const lineOutstanding = roundFinanceMoney(Math.max(0, financeNum(line.outstandingAmount ?? line.billedAmount)));
    const invoiceOutstanding = roundFinanceMoney(Math.max(0, financeNum(invoice.outstanding)));
    const available = Math.min(lineOutstanding, invoiceOutstanding);
    const value = roundFinanceMoney(Math.min(left, available));
    if (value > 0) {
      allocations.push({
        invoiceId: invoice.id,
        invoiceNo: invoice.no,
        branch: financeBranchOf(invoice),
        year: invoice.year ?? invoice._year ?? '',
        month: invoice.month ?? invoice._month ?? '',
        amount: value
      });
      left = roundFinanceMoney(left - value);
    }
    if (left <= 0) break;
  }

  if (left > 0.001) {
    throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, 'ยอดรับเกินยอดค้างปัจจุบัน กรุณาเปิดหน้ารับเงินใหม่');
  }
  if (!allocations.length) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, 'ไม่พบยอดคงค้างที่สามารถรับชำระได้');

  const createdAt = String(input.createdAt || new Date().toISOString());
  const payment = {
    id: financeRequireText(input.id, 'ไม่สามารถสร้างรหัส Payment ได้'),
    no,
    date: financeRequireText(input.date, 'กรุณาระบุวันที่รับเงิน'),
    branch: financeBranchOf(billing),
    customer: String(billing.customer || '').trim(),
    billingId: billing.id,
    billingNo: billing.no,
    method: String(input.method || 'โอนเงิน'),
    amount,
    allocations,
    createdAt
  };

  const currentOutstanding = roundFinanceMoney(lines.reduce((sum, line) => sum + Math.max(0, financeNum(line.outstandingAmount ?? line.billedAmount)), 0));
  const nextOutstanding = roundFinanceMoney(Math.max(0, currentOutstanding - amount));
  return {
    payment,
    billingPatch: {
      paidAmount: roundFinanceMoney(financeNum(billing.paidAmount) + amount),
      outstandingAmount: nextOutstanding,
      paymentStatus: nextOutstanding === 0 ? 'paid' : 'partially_paid',
      status: nextOutstanding === 0 ? 'paid' : 'partially_paid',
      updatedAt: createdAt
    }
  };
}

export function buildPaymentReceiptDrafts(input = {}) {
  const payment = input.payment;
  if (!payment || !Array.isArray(payment.allocations) || !payment.allocations.length) {
    throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, 'Payment ไม่มีรายการจัดสรร Invoice');
  }
  const branches = new Set(payment.allocations.map(row => String(row.branch || '').trim()));
  if (branches.size !== 1 || branches.has('')) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, 'การรับเงินหนึ่งครั้งต้องอยู่ในสาขาเดียวกัน');
  const invoiceStates = Array.isArray(input.invoiceStates) ? input.invoiceStates : [];
  const prefix = financeRequireText(input.receiptPrefix, 'ไม่สามารถสร้างเลขใบเสร็จได้');
  let sequence = Math.max(0, Math.trunc(financeNum(input.startingSequence)));
  const idSeed = Number.isFinite(Number(input.idSeed)) ? Number(input.idSeed) : Date.now();
  const createdAt = String(input.createdAt || new Date().toISOString());
  const year = Number(input.year);
  const month = Number(input.month);
  const receipts = payment.allocations.map((allocation, index) => {
    const invoice = invoiceStates.find(row => sameFinanceInvoice(row, allocation));
    if (!invoice || !financeLive(invoice)) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.DEPENDENCY, 'ไม่พบ Invoice สำหรับรับเงิน');
    const received = financeRequirePositiveMoney(allocation.amount, 'ยอดจัดสรร Payment ต้องมากกว่า 0');
    const total = Math.max(roundFinanceMoney(invoice.total ?? invoice.saleTotal), 0.01);
    const invoiceNet = roundFinanceMoney(invoice.subtotal ?? (total - financeNum(invoice.vatAmt)));
    const net = roundFinanceMoney(received * (invoiceNet / total));
    const vat = roundFinanceMoney(received - net);
    const no = `${prefix}${String(++sequence).padStart(2, '0')}`;
    return {
      id: idSeed + index,
      no,
      date: payment.date,
      branch: branches.values().next().value,
      year,
      month,
      customer: invoice.customer,
      customerAddress: invoice.customerAddress || '',
      customerTaxId: invoice.customerTaxId || '',
      contact: invoice.contact || '',
      phone: invoice.phone || '',
      email: invoice.email || '',
      salesPerson: invoice.salesPerson || '',
      invNo: invoice.no,
      invoiceId: invoice.id,
      invoiceBranch: branches.values().next().value,
      invoiceYear: invoice.year ?? invoice._year ?? '',
      invoiceMonth: invoice.month ?? invoice._month ?? '',
      paymentId: payment.id,
      paymentNo: payment.no,
      paymentManaged: true,
      receivedAmount: received,
      items: [{ product: `รับชำระ${received < total ? 'บางส่วน ' : ' '}ตามบิล ${invoice.no}`, qty: 1, unit: 'ครั้ง', priceUnit: received, saleTotal: received, costUnit: 0 }],
      itemSaleTotal: received,
      saleTotal: received,
      subtotal: net,
      total: received,
      vatAmt: vat,
      vatMode: vat > 0 ? 'extract' : 'none',
      useVat: vat > 0 ? 0 : 2,
      commAmt: 0,
      costTotal: 0,
      profit: 0,
      note: `รับเงิน ${payment.no} / ${payment.method}`,
      attachments: [],
      createdAt
    };
  });
  return {receipts, nextSequence: sequence};
}

export function assertIdempotentPaymentReceipts(payment, existingReceipts = []) {
  const rows = (Array.isArray(existingReceipts) ? existingReceipts : []).filter(row => String(row.paymentId || '') === String(payment?.id || ''));
  if (!rows.length) return [];
  const allocations = Array.isArray(payment?.allocations) ? payment.allocations : [];
  const consistent = rows.length === allocations.length && allocations.every(allocation => {
    const matches = rows.filter(row => sameFinanceInvoice(row, allocation));
    return matches.length === 1 && Math.abs(roundFinanceMoney(matches[0].receivedAmount ?? matches[0].total) - roundFinanceMoney(allocation.amount)) <= 0.001;
  });
  if (!consistent) {
    throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, 'พบใบเสร็จของ Payment เดิมไม่ครบหรือยอดไม่ตรง ระบบหยุดเพื่อป้องกันการสร้างเอกสารซ้ำ');
  }
  return rows.slice();
}


// ============================================================================
// Step 2E — Invoice / Receipt action plans
// These helpers are pure and deliberately do not touch browser persistence or cloud.
// ============================================================================

export const DOCUMENT_PACK_COLLECTIONS = Object.freeze([
  'quotes','invoices','receipts','issuedInvoices','issuedReceipts','expenses','productions','creditNotes'
]);

export function emptyFinancialDocumentPack() {
  return Object.fromEntries(DOCUMENT_PACK_COLLECTIONS.map(key => [key, []]));
}

export function parseFinancialDocumentPackForWrite(raw) {
  if (raw === null || raw === undefined || raw === '') return emptyFinancialDocumentPack();
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (error) {
    throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.STORAGE, 'ข้อมูลเอกสารในเครื่องเสียหาย ระบบหยุดบันทึกเพื่อป้องกันข้อมูลสูญหาย', { operation: 'parse', cause: String(error?.message || error) });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.STORAGE, 'โครงสร้างข้อมูลเอกสารในเครื่องไม่ถูกต้อง ระบบหยุดบันทึกเพื่อป้องกันข้อมูลสูญหาย', { operation: 'shape' });
  }
  const out = { ...parsed };
  for (const key of DOCUMENT_PACK_COLLECTIONS) {
    if (parsed[key] !== undefined && !Array.isArray(parsed[key])) {
      throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.STORAGE, `โครงสร้าง ${key} ไม่ถูกต้อง ระบบหยุดบันทึก`, { operation: 'shape', collection: key });
    }
    out[key] = Array.isArray(parsed[key]) ? parsed[key] : [];
  }
  return normalizeInvoiceTaxFormsInPack(out);
}

export function assertIssuedDocumentMatchesCanonical(input = {}) {
  const kind = String(input.kind || '').trim();
  const draft = input.draft || {};
  const canonical = input.canonical || null;
  if (!['invoice','receipt'].includes(kind)) {
    throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, 'ประเภทเอกสารฉบับพิมพ์ไม่ถูกต้อง');
  }
  if (!canonical) {
    throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.DEPENDENCY, kind === 'invoice' ? 'ไม่พบ Invoice ต้นทาง กรุณาเปิดเอกสารจากรายการต้นทางใหม่' : 'ไม่พบใบเสร็จต้นทาง กรุณาเปิดเอกสารจากรายการต้นทางใหม่');
  }
  if (!financeLive(canonical)) {
    throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, kind === 'invoice' ? 'Invoice ต้นทางถูกยกเลิกแล้ว' : 'ใบเสร็จต้นทางถูกยกเลิกแล้ว');
  }
  const label = kind === 'invoice' ? 'Invoice' : 'ใบเสร็จ';
  if (financeNorm(draft.no) && financeNorm(canonical.no) && financeNorm(draft.no) !== financeNorm(canonical.no)) {
    throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, `เลขที่เอกสารฉบับพิมพ์ไม่ตรงกับ${label}ต้นทาง`);
  }
  if (financeNorm(draft.date) && financeNorm(canonical.date) && financeNorm(draft.date) !== financeNorm(canonical.date)) {
    throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, `วันที่เอกสารฉบับพิมพ์ไม่ตรงกับ${label}ต้นทาง`);
  }
  if (financeNorm(draft.branch) && financeNorm(canonical.branch) && financeNorm(draft.branch) !== financeNorm(canonical.branch)) {
    throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, `สาขาของเอกสารฉบับพิมพ์ไม่ตรงกับ${label}ต้นทาง`);
  }
  if (financeNorm(draft.customer) !== financeNorm(canonical.customer)) {
    throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, 'ชื่อลูกค้าในเอกสารฉบับพิมพ์ไม่ตรงกับข้อมูลต้นทาง');
  }
  const draftTotal = roundFinanceMoney(draft.total ?? draft.saleTotal ?? draft.subtotal);
  const canonicalTotal = roundFinanceMoney(canonical.total ?? canonical.saleTotal ?? canonical.subtotal);
  if (Math.abs(draftTotal - canonicalTotal) > 0.001) {
    throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, 'ยอดเงินในเอกสารฉบับพิมพ์ไม่ตรงกับข้อมูลต้นทาง');
  }
  const draftSubtotal = roundFinanceMoney(draft.subtotal);
  const canonicalSubtotal = roundFinanceMoney(canonical.subtotal);
  if (draft.subtotal !== undefined && canonical.subtotal !== undefined && Math.abs(draftSubtotal - canonicalSubtotal) > 0.01) {
    throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, 'ยอดก่อนภาษีในเอกสารฉบับพิมพ์ไม่ตรงกับข้อมูลต้นทาง');
  }
  const draftVat = roundFinanceMoney(draft.vatAmt);
  const canonicalVat = roundFinanceMoney(canonical.vatAmt);
  if (draft.vatAmt !== undefined && canonical.vatAmt !== undefined && Math.abs(draftVat - canonicalVat) > 0.01) {
    throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, 'ยอดภาษีในเอกสารฉบับพิมพ์ไม่ตรงกับข้อมูลต้นทาง');
  }
  const itemKey = row => JSON.stringify({
    productCode: String(row?.productCode || row?.code || '').trim(),
    product: String(row?.product || row?.name || '').trim(),
    unit: String(row?.unit || '').trim(),
    qty: roundFinanceMoney(row?.qty),
    priceUnit: roundFinanceMoney(row?.priceUnit ?? row?.saleValue)
  });
  const draftItems = Array.isArray(draft.items) ? draft.items : [];
  const canonicalItems = Array.isArray(canonical.items) ? canonical.items : [];
  if (draftItems.length !== canonicalItems.length || draftItems.some((row,index) => itemKey(row) !== itemKey(canonicalItems[index]))) {
    throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, 'รายการสินค้าในเอกสารฉบับพิมพ์ไม่ตรงกับข้อมูลต้นทาง');
  }
  if (kind === 'receipt') {
    const draftRef = financeInvoiceRef({ id: draft.invoiceId || draft.sourceInvoiceId, no: draft.invNo || draft.sourceInvoiceNo, branch: draft.invoiceBranch || draft.branch });
    const canonicalRef = financeInvoiceRef({ id: canonical.invoiceId || canonical.sourceInvoiceId, no: canonical.invNo || canonical.sourceInvoiceNo, branch: canonical.invoiceBranch || canonical.branch });
    if (draftRef.id && canonicalRef.id && draftRef.id !== canonicalRef.id) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, 'Invoice อ้างอิงของใบเสร็จฉบับพิมพ์ไม่ตรงกับใบเสร็จต้นทาง');
    if (draftRef.no && canonicalRef.no && draftRef.no !== canonicalRef.no) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, 'เลข Invoice อ้างอิงของใบเสร็จฉบับพิมพ์ไม่ตรงกับใบเสร็จต้นทาง');
  }
  return canonical;
}

function documentItemsFingerprint(items = []) {
  return (Array.isArray(items) ? items : []).map(row => ({
    product: String(row?.product || ''),
    productCode: String(row?.productCode || row?.code || ''),
    salesOrderLineId: String(row?.salesOrderLineId || ''),
    qty: roundFinanceMoney(row?.qty),
    unit: String(row?.unit || ''),
    priceUnit: roundFinanceMoney(row?.priceUnit),
    saleTotal: roundFinanceMoney(row?.saleTotal ?? row?.total),
    costTotal: roundFinanceMoney(row?.costTotal)
  }));
}


export function quoteCommercialFingerprint(record = {}) {
  return JSON.stringify({
    no: String(record.no || '').trim(),
    date: String(record.date || '').trim(),
    branch: financeBranchOf(record),
    customer: financeNorm(record.customer),
    customerAddress: financeNorm(record.customerAddress || record.address),
    customerTaxId: String(record.customerTaxId || '').replace(/\s+/g, ''),
    customerAgencyGroup: financeNorm(record.customerAgencyGroup || record.customerCategory || record.customerType),
    items: documentItemsFingerprint(record.items),
    subtotal: roundFinanceMoney(record.subtotal),
    vatAmt: roundFinanceMoney(record.vatAmt),
    total: roundFinanceMoney(record.total),
    useVat: financeNum(record.useVat),
    vatMode: String(record.vatMode || '')
  });
}

const QUOTE_APPROVAL_FIELDS = Object.freeze([
  'approved','approvedAt','approvedBy','approvedByEmail','approvalStatus','approvalNote'
]);
const QUOTE_LINEAGE_FIELDS = Object.freeze([
  'productionId','productionNo','productionStatus',
  'invoiceId','invoiceNo','invoiceStatus','workflowUpdatedAt'
]);

export function planQuoteDocumentAction(input = {}) {
  const draft = input.draft && typeof input.draft === 'object' ? { ...input.draft } : {};
  financeRequireText(draft.no, 'กรุณาระบุเลขที่ใบเสนอราคา');
  financeRequireText(draft.date, 'กรุณาระบุวันที่ใบเสนอราคา');
  financeRequireText(draft.customer, 'กรุณาระบุชื่อลูกค้า');
  financeRequireText(financeBranchOf(draft), 'กรุณาระบุสาขา');
  if (!Array.isArray(draft.items) || !draft.items.length) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, 'กรุณาเพิ่มรายการสินค้า');
  if (input.duplicateNumber) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, `เลขที่ใบเสนอราคา ${draft.no} มีอยู่แล้ว`);

  const original = input.original && typeof input.original === 'object' ? input.original : null;
  const locked = !!(original?.approved || input.linkedDownstream);
  if (original && locked && quoteCommercialFingerprint(original) !== quoteCommercialFingerprint(draft)) {
    const reason = original.approved ? 'ใบเสนอราคานี้อนุมัติแล้ว' : 'ใบเสนอราคานี้มีเอกสารต่อเนื่องแล้ว';
    throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, `${reason} จึงไม่อนุญาตให้แก้เลขที่ วันที่ ลูกค้า รายการสินค้า หรือยอดทางการค้า กรุณายกเลิก/ย้อน Workflow ก่อน`);
  }

  let record = { ...draft, approved: !!draft.approved };
  if (original) {
    record = preserveFields(record, original, QUOTE_APPROVAL_FIELDS);
    record = preserveFields(record, original, QUOTE_LINEAGE_FIELDS);
  }
  return { kind: 'quote', mode: original ? 'edit' : 'create', record };
}



function productionItemsFingerprint(items = []) {
  return (Array.isArray(items) ? items : []).map(row => ({
    product: String(row?.product || ''),
    productCode: String(row?.productCode || row?.code || ''),
    salesOrderLineId: String(row?.salesOrderLineId || ''),
    qty: roundFinanceMoney(row?.qty),
    unit: String(row?.unit || ''),
    fulfillmentType: String(row?.fulfillmentType || ''),
    costMode: String(row?.costMode || ''),
    costValue: roundFinanceMoney(row?.costValue ?? row?.costUnit ?? row?.costLump),
    costTotal: roundFinanceMoney(row?.costTotal),
    saleMode: String(row?.saleMode || ''),
    saleValue: roundFinanceMoney(row?.saleValue ?? row?.priceUnit ?? row?.saleLump),
    priceUnit: roundFinanceMoney(row?.priceUnit),
    saleTotal: roundFinanceMoney(row?.saleTotal ?? row?.total)
  }));
}

export function productionCommercialFingerprint(record = {}) {
  return JSON.stringify({
    no: String(record.no || '').trim(),
    date: String(record.date || '').trim(),
    branch: financeBranchOf(record),
    maker: financeNorm(record.maker),
    makerAddress: financeNorm(record.makerAddress),
    makerTaxId: String(record.makerTaxId || '').replace(/\s+/g, ''),
    customer: financeNorm(record.customer),
    job: financeNorm(record.job),
    items: productionItemsFingerprint(record.items),
    costSubtotal: roundFinanceMoney(record.costSubtotal),
    costVatAmt: roundFinanceMoney(record.costVatAmt),
    costGrandTotal: roundFinanceMoney(record.costGrandTotal),
    costTotal: roundFinanceMoney(record.costTotal),
    itemSaleTotal: roundFinanceMoney(record.itemSaleTotal),
    saleTotal: roundFinanceMoney(record.saleTotal),
    subtotal: roundFinanceMoney(record.subtotal),
    vatAmt: roundFinanceMoney(record.vatAmt),
    total: roundFinanceMoney(record.total),
    useVat: financeNum(record.useVat),
    vatMode: String(record.vatMode || ''),
    commMode: String(record.commMode || ''),
    commRate: roundFinanceMoney(record.commRate),
    commAmt: roundFinanceMoney(record.commAmt),
    deliveryLeadDays: financeNum(record.deliveryLeadDays ?? record.shippingLeadDays),
    deliveryDueDate: String(record.deliveryDueDate || record.estimatedDeliveryDate || ''),
    supplierCreditTerm: String(record.supplierCreditTerm || ''),
    supplierDueDate: String(record.supplierDueDate || '')
  });
}

const PRODUCTION_SETTLEMENT_FIELDS = Object.freeze([
  'supplierPaymentStatus','supplierPaidAt','supplierPaidBy'
]);
const PRODUCTION_LINEAGE_FIELDS = Object.freeze([
  'sourceQuoteId','sourceQuoteNo','sourceQuoteBranch','sourceQuoteYear','sourceQuoteMonth','sourceQuoteFirebaseId',
  'sourceSalesOrderId','sourceSalesOrderNo',
  'invoiceStatus','invoiceId','invoiceNo','invoiceCreatedAt'
]);

export function planProductionDocumentAction(input = {}) {
  const draft = input.draft && typeof input.draft === 'object' ? { ...input.draft } : {};
  financeRequireText(draft.no, 'กรุณาระบุเลขที่ใบสั่งผลิต');
  financeRequireText(draft.date, 'กรุณาระบุวันที่ใบสั่งผลิต');
  financeRequireText(draft.maker, 'กรุณาระบุผู้รับผลิต / ผู้ผลิต');
  financeRequireText(draft.customer, 'กรุณาระบุชื่อลูกค้า');
  financeRequireText(draft.job, 'กรุณาระบุชื่องาน');
  financeRequireText(financeBranchOf(draft), 'กรุณาระบุสาขา');
  if (!Array.isArray(draft.items) || !draft.items.length) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, 'กรุณาเพิ่มรายการสินค้าที่สั่งผลิต');
  if (input.duplicateNumber) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, `เลขที่ใบสั่งผลิต ${draft.no} มีอยู่แล้ว`);

  const original = input.original && typeof input.original === 'object' ? input.original : null;
  if (original?.historicalSalesImport) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.PERMISSION, 'รายการยอดขายย้อนหลังไม่อนุญาตให้แก้ผ่านใบสั่งผลิต');
  const invoiceLinked = !!(original?.invoiceId || original?.invoiceNo || ['created','issued'].includes(String(original?.invoiceStatus || '').toLowerCase()));
  const supplierSettled = ['partial','paid'].includes(String(original?.supplierPaymentStatus || '').toLowerCase()) || !!original?.supplierPaidAt;
  if (original && (invoiceLinked || supplierSettled) && productionCommercialFingerprint(original) !== productionCommercialFingerprint(draft)) {
    const reason = invoiceLinked ? 'ใบสั่งผลิตนี้เชื่อมกับ Invoice แล้ว' : 'ใบสั่งผลิตนี้เริ่มมีสถานะชำระผู้ผลิตแล้ว';
    throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, `${reason} จึงไม่อนุญาตให้แก้ผู้ผลิต ลูกค้า รายการสินค้า ต้นทุน ยอดขาย VAT หรือเงื่อนไขเครดิต กรุณายกเลิก/ย้อน Workflow ที่เกี่ยวข้องก่อน`);
  }

  let record = { ...draft };
  if (original) {
    record = preserveFields(record, original, PRODUCTION_SETTLEMENT_FIELDS);
    record = preserveFields(record, original, PRODUCTION_LINEAGE_FIELDS);
  } else {
    Object.assign(record, {
      supplierPaymentStatus: 'pending', supplierPaidAt: '', supplierPaidBy: '',
      invoiceStatus: record.invoiceStatus || 'pending', invoiceId: '', invoiceNo: ''
    });
  }
  return { kind: 'production', mode: original ? 'edit' : 'create', record };
}


const EXPENSE_DOC_TYPES = new Set(['receipt','tax_invoice','receipt_tax_invoice','abbreviated_tax_invoice','invoice','other','none']);
const EXPENSE_TAX_STATUSES = new Set(['requested','received','not_requested','not_required']);
const EXPENSE_PURPOSES = new Set(['company','customer_job','delivery','production','other']);
const EXPENSE_TAX_DOCUMENT_TYPES = new Set(['tax_invoice','receipt_tax_invoice','abbreviated_tax_invoice']);

export function planExpenseDocumentAction(input = {}) {
  const draft = input.draft && typeof input.draft === 'object' ? { ...input.draft } : {};
  financeRequireText(draft.date, 'กรุณาระบุวันที่ค่าใช้จ่าย');
  financeRequireText(financeBranchOf(draft), 'กรุณาระบุสาขา');
  financeRequireText(draft.cat, 'กรุณาระบุหมวดหมู่ค่าใช้จ่าย');
  financeRequireText(draft.desc, 'กรุณาระบุรายละเอียดค่าใช้จ่าย');
  draft.amount = financeRequirePositiveMoney(draft.amount, 'จำนวนเงินค่าใช้จ่ายต้องมากกว่า 0');
  const docType = String(draft.docType || 'receipt').trim();
  const taxStatus = String(draft.taxStatus || 'requested').trim();
  const purpose = String(draft.purpose || 'company').trim();
  if (!EXPENSE_DOC_TYPES.has(docType)) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, 'ประเภทเอกสารค่าใช้จ่ายไม่ถูกต้อง');
  if (!EXPENSE_TAX_STATUSES.has(taxStatus)) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, 'สถานะใบกำกับภาษีไม่ถูกต้อง');
  if (!EXPENSE_PURPOSES.has(purpose)) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, 'การใช้งานค่าใช้จ่ายไม่ถูกต้อง');
  const docNo = String(draft.docNo || '').trim();
  if (docType === 'none' && docNo) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, 'เลือก “ไม่มีเอกสาร” แล้วไม่ควรระบุเลขที่เอกสาร');
  if (taxStatus === 'received' && !EXPENSE_TAX_DOCUMENT_TYPES.has(docType)) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, 'สถานะ “ได้รับใบกำกับภาษีแล้ว” ต้องเลือกประเภทเอกสารที่เป็นใบกำกับภาษี');
  if (taxStatus === 'received' && !docNo) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, 'กรุณาระบุเลขที่ใบกำกับภาษีที่ได้รับ');
  if (input.duplicateDocument) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, `เลขที่เอกสาร ${docNo || '-'} ของร้านค้า/ผู้ขายนี้ถูกบันทึกแล้ว`);

  const attachments = Array.isArray(draft.attachments) ? draft.attachments.map(file => ({ ...file })) : [];
  const warnings = [];
  if (taxStatus === 'received' && !attachments.length) warnings.push('ได้รับใบกำกับภาษีแล้ว แต่ยังไม่มีไฟล์หลักฐานแนบ');
  const record = { ...draft, docType, taxStatus, purpose, docNo, attachments };
  return { kind: 'expense', mode: 'create', record, warnings };
}

export function invoiceFinancialFingerprint(record = {}) {
  return JSON.stringify({
    no: String(record.no || '').trim(),
    date: String(record.date || '').trim(),
    branch: financeBranchOf(record),
    customer: financeNorm(record.customer),
    // Effective form, so a normalized bad import ('abbreviated' + VAT added →
    // 'full') is not seen as a financial change of a paid invoice.
    taxInvoiceForm: financeEffectiveTaxInvoiceForm(record),
    items: documentItemsFingerprint(record.items),
    subtotal: roundFinanceMoney(record.subtotal),
    itemSaleTotal: roundFinanceMoney(record.itemSaleTotal),
    saleTotal: roundFinanceMoney(record.saleTotal),
    vatAmt: roundFinanceMoney(record.vatAmt),
    total: roundFinanceMoney(record.total),
    useVat: financeNum(record.useVat),
    vatMode: String(record.vatMode || ''),
    costTotal: roundFinanceMoney(record.costTotal),
    commMode: String(record.commMode || ''),
    commRate: roundFinanceMoney(record.commRate),
    commAmt: roundFinanceMoney(record.commAmt)
  });
}

const INVOICE_SETTLEMENT_FIELDS = Object.freeze([
  'paymentStatus','paid','isPaid','paidAt','paidBy','paidReceiptNo','paidReceiptId',
  'paidAmount','outstandingAmount','paymentManaged','legacyPaid'
]);
const INVOICE_LINEAGE_FIELDS = Object.freeze([
  'sourceProductionId','sourceProductionNo','sourceProductionBranch','sourceProductionYear','sourceProductionMonth',
  'sourceQuoteId','sourceQuoteNo','sourceQuoteBranch','sourceQuoteYear','sourceQuoteMonth','sourceQuoteFirebaseId',
  'sourceSalesOrderId','sourceSalesOrderNo'
]);

function preserveFields(target, source, fields) {
  const out = { ...target };
  for (const key of fields) if (source && Object.hasOwn(source, key)) out[key] = source[key];
  return out;
}

export function planInvoiceDocumentAction(input = {}) {
  const draft = input.draft && typeof input.draft === 'object' ? { ...input.draft } : {};
  financeRequireText(draft.no, 'กรุณาระบุเลขที่ใบส่งสินค้า / ใบกำกับภาษี');
  financeRequireText(draft.date, 'กรุณาระบุวันที่เอกสาร');
  financeRequireText(draft.customer, 'กรุณาระบุชื่อลูกค้า');
  financeRequireText(financeBranchOf(draft), 'กรุณาระบุสาขา');
  if (!Array.isArray(draft.items) || !draft.items.length) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, 'กรุณาเพิ่มรายการสินค้า');
  if (input.duplicateNumber) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, `เลขที่ใบส่งสินค้า / ใบกำกับภาษี ${draft.no} มีอยู่แล้ว`);
  if (draft.items.some(row => row?.costAllocation?.conflict)) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, 'ต้นทุนต้นทางต่ำกว่าที่จัดสรรไปแล้ว กรุณาตรวจงานผลิตก่อนบันทึก');
  // §86/6: an abbreviated tax invoice must state "ราคารวมภาษีมูลค่าเพิ่มแล้ว",
  // so it can only be priced VAT-inclusive (never VAT-added or non-VAT).
  if (financeTaxInvoiceForm(draft) === 'abbreviated' && financeVatModeOf(draft) !== 'extract') {
    throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, 'ใบกำกับภาษีอย่างย่อ (มาตรา 86/6) ต้องใช้ราคารวม VAT แล้วเท่านั้น กรุณาเลือก “ราคารวม VAT แล้ว — แยกภาษี” หรือเปลี่ยนเป็นใบกำกับภาษีเต็มรูป');
  }

  const original = input.original && typeof input.original === 'object' ? input.original : null;
  // §86/4: a full-form tax invoice must name the buyer; the walk-in placeholder
  // is only for abbreviated invoices. An existing record that was ALREADY a
  // full-form invoice with the placeholder (legacy data) may still be re-saved
  // with the same name. A walk-in abbreviated invoice always stores the
  // placeholder, so it must not use this exemption to become a full invoice.
  const keepsLegacyPlaceholder = !!original
    && financeEffectiveTaxInvoiceForm(original) === 'full'
    && financeIsGeneralCustomer(original.customer);
  if (financeTaxInvoiceForm(draft) === 'full' && financeIsGeneralCustomer(draft.customer) && !keepsLegacyPlaceholder) {
    throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, `ใบกำกับภาษีเต็มรูป (มาตรา 86/4) ต้องระบุชื่อผู้ซื้อจริง ไม่สามารถใช้ “${FINANCE_GENERAL_CUSTOMER_NAME}” ได้ กรุณากรอกชื่อผู้ซื้อ หรือเปลี่ยนเป็นใบกำกับภาษีอย่างย่อ`);
  }
  const paid = roundFinanceMoney(input.paymentSummary?.paid);
  if (original && paid > 0.001 && invoiceFinancialFingerprint(original) !== invoiceFinancialFingerprint(draft)) {
    throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, 'Invoice นี้มีการรับเงินจริงแล้ว จึงไม่อนุญาตให้แก้เลขที่ วันที่ ลูกค้า รายการสินค้า หรือยอดทางการเงิน กรุณายกเลิก/ปรับรายการรับเงินก่อน');
  }
  // A credit note (ใบลดหนี้) prints this invoice's number, date and value; changing
  // them afterwards would silently falsify the issued credit note.
  const credited = roundFinanceMoney(input.paymentSummary?.credited);
  if (original && credited > 0.001 && invoiceFinancialFingerprint(original) !== invoiceFinancialFingerprint(draft)) {
    throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, 'Invoice นี้มีใบลดหนี้อ้างอิงแล้ว จึงไม่อนุญาตให้แก้เลขที่ วันที่ ลูกค้า รายการสินค้า หรือยอดทางการเงิน กรุณายกเลิกใบลดหนี้ที่อ้างอิงก่อน');
  }

  let record = { ...draft };
  if (original) {
    record = preserveFields(record, original, INVOICE_SETTLEMENT_FIELDS);
    record = preserveFields(record, original, INVOICE_LINEAGE_FIELDS);
  } else {
    Object.assign(record, {
      paymentStatus: 'pending', paid: false, isPaid: false, paidAt: '', paidBy: '',
      paidAmount: 0, outstandingAmount: roundFinanceMoney(record.total), paymentManaged: record.paymentManaged ?? true
    });
  }
  return { kind: 'invoice', mode: original ? 'edit' : 'create', record, warnings: invoiceTaxFormWarnings(record) };
}

// Soft (non-blocking) tax-form checks shown after an invoice is saved, like
// the expense planner's warnings. Only VAT documents are checked: a 'none'
// (ไม่มี VAT) invoice is not a tax invoice.
function invoiceTaxFormWarnings(record) {
  const warnings = [];
  if (financeVatModeOf(record) === 'none') return warnings;
  if (financeEffectiveTaxInvoiceForm(record) === 'full') {
    if (!financeNorm(record.customerAddress ?? record.address)) {
      warnings.push('ยังไม่ได้ระบุที่อยู่ผู้ซื้อ — ใบกำกับภาษีเต็มรูป (มาตรา 86/4) ต้องมีชื่อและที่อยู่ของผู้ซื้อ (และเลขประจำตัวผู้เสียภาษี/สาขา หากผู้ซื้อเป็นผู้ประกอบการจดทะเบียน VAT) กรุณาแก้ไขก่อนส่งเอกสารให้ลูกค้า');
    }
  } else if (financeNorm(record.customerTaxId)) {
    warnings.push('ระบุเลขประจำตัวผู้เสียภาษีของผู้ซื้อไว้ในใบกำกับภาษีอย่างย่อ — ผู้ซื้อที่จดทะเบียน VAT ใช้ใบกำกับภาษีอย่างย่อขอใช้เป็นภาษีซื้อไม่ได้ หากผู้ซื้อต้องการใช้สิทธิ์ภาษีซื้อ ควรออกใบกำกับภาษีเต็มรูป (มาตรา 86/4)');
  }
  return warnings;
}

function receiptReference(record = {}) {
  return {
    id: String(record.invoiceId || '').trim(),
    no: String(record.invNo || record.invoiceNo || '').trim(),
    branch: String(record.invoiceBranch || record.branch || '').trim(),
    year: record.invoiceYear ?? '',
    month: record.invoiceMonth ?? ''
  };
}

function sameReceiptReference(a = {}, b = {}) {
  const ar = receiptReference(a), br = receiptReference(b);
  if (ar.branch && br.branch && ar.branch !== br.branch) return false;
  if (ar.id && br.id) return ar.id === br.id;
  if (ar.no && br.no) return ar.no === br.no;
  return !ar.id && !ar.no && !br.id && !br.no;
}

export function planReceiptDocumentAction(input = {}) {
  const draft = input.draft && typeof input.draft === 'object' ? { ...input.draft } : {};
  financeRequireText(draft.no, 'กรุณาระบุเลขที่ใบเสร็จ');
  financeRequireText(draft.date, 'กรุณาระบุวันที่ใบเสร็จ');
  financeRequireText(draft.customer, 'กรุณาระบุชื่อลูกค้า');
  financeRequireText(financeBranchOf(draft), 'กรุณาระบุสาขา');
  if (!Array.isArray(draft.items) || !draft.items.length) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, 'กรุณาเพิ่มรายการสินค้า');
  if (!(roundFinanceMoney(draft.total ?? draft.saleTotal ?? draft.subtotal) > 0)) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, 'ยอดรับเงินต้องมากกว่า 0');
  if (input.duplicateNumber) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, `เลขที่ใบเสร็จ ${draft.no} มีอยู่แล้ว`);

  const original = input.original && typeof input.original === 'object' ? input.original : null;
  if (original?.paymentId) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.PERMISSION, 'ใบเสร็จนี้สร้างจากรายการรับเงิน กรุณายกเลิกรายการรับเงินแล้วบันทึกใหม่ที่หน้าใบวางบิล');
  if (original && !sameReceiptReference(original, draft)) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, 'ไม่อนุญาตให้เปลี่ยน Invoice อ้างอิงระหว่างแก้ไขใบเสร็จ');

  const requestedRef = receiptReference(draft);
  const hasReference = !!(requestedRef.id || requestedRef.no);
  const invoice = input.referenceInvoice || null;
  if (hasReference && !invoice) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.DEPENDENCY, 'ไม่พบบิลอ้างอิงในสาขาที่เลือก');
  if (invoice) {
    if (!financeLive(invoice)) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, 'บิลอ้างอิงถูกยกเลิกแล้ว');
    if (requestedRef.branch && financeBranchOf(invoice) && requestedRef.branch !== financeBranchOf(invoice)) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, 'บิลอ้างอิงอยู่คนละสาขา');
    if (requestedRef.id && String(invoice.id || '') && requestedRef.id !== String(invoice.id)) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, 'Invoice ID ไม่ตรงกับบิลที่เลือกอ้างอิง');
    if (requestedRef.no && financeNoOf(invoice) && requestedRef.no !== financeNoOf(invoice)) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, 'เลขบิลไม่ตรงกับบิลที่เลือกอ้างอิง');
    if (financeNorm(invoice.customer) !== financeNorm(draft.customer)) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, 'ลูกค้าในใบเสร็จไม่ตรงกับบิลอ้างอิง');
    const outstanding = roundFinanceMoney(input.paymentSummary?.outstanding);
    const received = roundFinanceMoney(draft.total ?? draft.saleTotal ?? draft.subtotal);
    if (received > outstanding + FINANCE_RECONCILE_TOLERANCE) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, `ยอดรับเงินเกินยอดค้างรับ ${outstanding.toFixed(2)} บาท — เกินยอดคงค้างเกินกว่าค่าความคลาดเคลื่อนที่ยอมรับได้ (±${FINANCE_RECONCILE_TOLERANCE.toFixed(2)} บาท) กรุณาตรวจสอบยอดหรือใบแจ้งหนี้อ้างอิง`);
  }

  let record = { ...draft, paymentManaged: true };
  if (original) {
    const ref = receiptReference(original);
    Object.assign(record, { invNo: ref.no, invoiceId: ref.id, invoiceBranch: ref.branch, invoiceYear: ref.year, invoiceMonth: ref.month });
  }
  return { kind: 'receipt', mode: original ? 'edit' : 'create', record };
}
