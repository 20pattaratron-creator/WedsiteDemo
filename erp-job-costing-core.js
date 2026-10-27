// ============================================================================
// erp-job-costing-core.js — job costing (ต้นทุนงาน) and profit per job / customer / product / month (ADR-028)
// ERP DEMO 4.3.1 · round 11 · pure: no DOM, no storage, no clock
// ----------------------------------------------------------------------------
// A JOB (งาน) is the app's existing production order (pack `productions`, key `${branch}|${id}`), already linked to its
// quotation (sourceQuote*), its sales order (sourceSalesOrderId) and to the invoices that deliver it (invoice
// sourceProductionId / sourceProductionNo). Nothing parallel is invented. Per job:
//   materials  = stock issued to the job (inventory movement kind 'job_issue', costed by erp-costing-core.js on the
//                issue date with the company's method) − materials returned ('job_return', at their issue cost)
//   labour     = Σ hours × rate of the labour entries (rate fixed on the entry: the person's rate, else the
//                company's default)
//   overhead   = Σ hours × the predetermined overhead rate fixed on each labour entry (OpenStax, Principles of
//                Managerial Accounting ch. 4: rate = estimated overhead ÷ estimated activity base, here labour hours)
//   other      = subcontract / other direct costs (pre-VAT)
//   good qty and scrap qty on completion; the cost of scrap stays in the job (it raises the cost per good unit).
// On completion the cost goes either to finished goods (a 'job_completion' stock movement valued at the job cost)
// or, for made-to-order goods delivered to the customer, to cost of sales with the job's invoices.
// Revenue of a job = the analytics sales measure (erp-analytics-core.js packSalesRows: invoice ex VAT, credit notes
// −, debit notes +, each in its own month; a legacy production order without a sales order counts itself) on the
// rows linked to the job — so profit per job always adds up to the same sales figure as the analytics page.
// Money is satang (integers); hours and quantities are thousandths (erp-costing-core.js toQm).
// ============================================================================
import { toQm, toSatang, mulDivRound, unitCostOf, QTY_SCALE, isIsoDate, dateNumber, productSkuKey, isStockTrackedProduct, createProductResolver, overheadRateSatang } from './erp-costing-core.js';
import { salesRowValue, salesLinesOfRows, monthOfDate } from './erp-analytics-core.js';

export const JOB_COSTING_CORE_VERSION = '1.0.0';
export const JOB_COSTING_SCHEMA_VERSION = 1;
export const JOB_ENTRY_KINDS = Object.freeze(['labour', 'other', 'completion']);
export const OTHER_COST_CATEGORIES = Object.freeze(['subcontract', 'other']);
export const COMPLETION_DESTINATIONS = Object.freeze(['cost_of_sales', 'finished_goods']);
export const COST_CATEGORIES = Object.freeze(['materials', 'labour', 'overhead', 'other']);
const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const ID_RE = /^[\w.:-]{1,120}$/;
const BRANCHES = Object.freeze(['ubon', 'khonkaen']);
const finiteNonNegative = value => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0;

// ---------------------------------------------------------------- jobs (production orders)
export function jobKeyOf(production) {
  const branch = text(production?._branch || production?.branch);
  const id = text(production?.id);
  return branch && id ? `${branch}|${id}` : '';
}
const isLive = row => !!(row && !row.voided && !row.cancelled && !row.reversed && row.status !== 'cancelled');
// productions: business().productions (with _branch). → [job] sorted by date then number (newest last).
export function listJobs(productions = []) {
  const jobs = [];
  const seen = new Set();
  for (const production of Array.isArray(productions) ? productions : []) {
    if (!isLive(production)) continue;
    const key = jobKeyOf(production);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const items = Array.isArray(production.items) ? production.items : [];
    jobs.push({
      key,
      branch: text(production._branch || production.branch),
      id: text(production.id),
      no: text(production.no),
      date: text(production.date).slice(0, 10),
      customer: text(production.customer),
      name: text(production.job),
      items,
      plannedQm: items.reduce((sum, item) => sum + Math.max(0, toQm(item?.qty)), 0),
      legacy: !text(production.sourceSalesOrderId),
      sourceSalesOrderId: text(production.sourceSalesOrderId),
      sourceSalesOrderNo: text(production.sourceSalesOrderNo),
      sourceQuote: text(production.sourceQuoteId) || text(production.sourceQuoteNo) ? { branch: text(production.sourceQuoteBranch) || text(production._branch || production.branch), id: text(production.sourceQuoteId), no: text(production.sourceQuoteNo) } : null,
      // The production order's own cost columns (what the maker charges / the cost estimated when ordering, pre-VAT).
      estimate: toSatang(production.costSubtotal ?? production.costTotal ?? 0),
      demoSeed: production.demoSeed === true
    });
  }
  jobs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.no < b.no ? -1 : a.no > b.no ? 1 : 0));
  return jobs;
}
// Invoice → job key (the app's own link: sourceProductionId, else sourceProductionNo, in the production's branch).
export function createJobLinker(jobs = []) {
  const byId = new Map();
  const byNo = new Map();
  for (const job of jobs) {
    byId.set(job.key, job);
    if (job.no) byNo.set(`${job.branch}|${job.no}`, job);
  }
  return invoice => {
    if (!invoice) return null;
    const branch = text(invoice.sourceProductionBranch || invoice.branch || invoice._branch);
    const id = text(invoice.sourceProductionId);
    if (id && byId.has(`${branch}|${id}`)) return byId.get(`${branch}|${id}`);
    const no = text(invoice.sourceProductionNo);
    if (no && byNo.has(`${branch}|${no}`)) return byNo.get(`${branch}|${no}`);
    return null;
  };
}

// ---------------------------------------------------------------- the job store (comform_job_costing_v1)
// { schemaVersion: 1, entries: [entry], budgets: { [jobKey]: budget } }
//   entry   { id, kind: labour | other | completion, jobKey, jobNo, branch, date, status: posted | voided, createdAt,
//             createdBy, voidedAt, voidedBy, voidReason, demoSeed?, demoSeedBatch?,
//             labour: person, hours, rate (baht/h), overheadRate (baht/h, fixed when posted)
//             other: category (subcontract | other), description, amount (baht, pre-VAT)
//             completion: goodQty, scrapQty, destination (cost_of_sales | finished_goods), productCode, movementId }
//   budget  { materials, labourHours, labour, overhead, other (baht), source: manual | quote, sourceRef, updatedAt }
// Read strictly: anything malformed throws (the page then says the job data cannot be read; nothing is half-used).
const ENTRY_FIELDS = Object.freeze(['id', 'kind', 'jobKey', 'jobNo', 'branch', 'date', 'status', 'createdAt', 'createdBy', 'voidedAt', 'voidedBy', 'voidReason', 'demoSeed', 'demoSeedBatch', 'person', 'hours', 'rate', 'overheadRate', 'category', 'description', 'amount', 'goodQty', 'scrapQty', 'destination', 'productCode', 'movementId']);
const BUDGET_FIELDS = Object.freeze(['materials', 'labourHours', 'labour', 'overhead', 'other', 'source', 'sourceRef', 'updatedAt']);
export function emptyJobStore() {
  return { schemaVersion: JOB_COSTING_SCHEMA_VERSION, entries: [], budgets: {} };
}
export function normalizeJobStore(raw) {
  const fail = detail => { throw new Error(`ข้อมูลต้นทุนงานไม่ถูกต้อง: ${detail} — ระบบหยุดเพื่อไม่ให้คิดต้นทุนผิด`); };
  if (raw === null || raw === undefined || raw === '') return emptyJobStore();
  let value = raw;
  if (typeof raw === 'string') { try { value = JSON.parse(raw); } catch (error) { fail(`อ่าน JSON ไม่ได้ (${error.message})`); } }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('ต้องเป็น object');
  for (const key of Object.keys(value)) if (!['schemaVersion', 'entries', 'budgets'].includes(key)) fail(`ช่อง ${key}`);
  if (value.schemaVersion !== JOB_COSTING_SCHEMA_VERSION) fail('schemaVersion');
  if (!Array.isArray(value.entries)) fail('entries');
  if (!value.budgets || typeof value.budgets !== 'object' || Array.isArray(value.budgets)) fail('budgets');
  const ids = new Set();
  const entries = value.entries.map((row, index) => {
    const at = `รายการที่ ${index + 1}`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) fail(at);
    for (const key of Object.keys(row)) if (!ENTRY_FIELDS.includes(key)) fail(`${at} ช่อง ${key}`);
    if (!ID_RE.test(String(row.id || ''))) fail(`${at} รหัส`);
    if (ids.has(row.id)) fail(`รหัสซ้ำ ${row.id}`);
    ids.add(row.id);
    if (!JOB_ENTRY_KINDS.includes(row.kind)) fail(`${at} ประเภท`);
    if (!/^(ubon|khonkaen)\|[\w.:-]{1,120}$/.test(String(row.jobKey || ''))) fail(`${at} งาน`);
    if (!BRANCHES.includes(row.branch) || String(row.jobKey).split('|')[0] !== row.branch) fail(`${at} สาขา`);
    if (!isIsoDate(row.date)) fail(`${at} วันที่`);
    if (!['posted', 'voided'].includes(row.status)) fail(`${at} สถานะ`);
    const base = { id: row.id, kind: row.kind, jobKey: row.jobKey, jobNo: text(row.jobNo), branch: row.branch, date: row.date, status: row.status, createdAt: String(row.createdAt || ''), createdBy: text(row.createdBy), voidedAt: String(row.voidedAt || ''), voidedBy: text(row.voidedBy), voidReason: text(row.voidReason) };
    if (row.demoSeed === true) Object.assign(base, { demoSeed: true, demoSeedBatch: String(row.demoSeedBatch || '') });
    if (row.kind === 'labour') {
      if (!text(row.person) || text(row.person).length > 120) fail(`${at} ผู้ทำงาน`);
      if (!(finiteNonNegative(row.hours) && Number(row.hours) > 0 && Number(row.hours) <= 10000)) fail(`${at} ชั่วโมง`);
      if (!finiteNonNegative(row.rate) || !finiteNonNegative(row.overheadRate)) fail(`${at} อัตรา`);
      return { ...base, person: text(row.person), hours: Number(row.hours), rate: Number(row.rate), overheadRate: Number(row.overheadRate) };
    }
    if (row.kind === 'other') {
      if (!OTHER_COST_CATEGORIES.includes(row.category)) fail(`${at} หมวด`);
      if (!text(row.description) || text(row.description).length > 300) fail(`${at} รายละเอียด`);
      if (!(finiteNonNegative(row.amount) && Number(row.amount) > 0)) fail(`${at} จำนวนเงิน`);
      return { ...base, category: row.category, description: text(row.description), amount: Number(row.amount) };
    }
    if (!finiteNonNegative(row.goodQty) || !finiteNonNegative(row.scrapQty) || !(Number(row.goodQty) > 0)) fail(`${at} จำนวนผลิตดี/ของเสีย`);
    if (!COMPLETION_DESTINATIONS.includes(row.destination)) fail(`${at} ปลายทางต้นทุน`);
    if (row.destination === 'finished_goods' && (!text(row.productCode) || !ID_RE.test(String(row.movementId || '')))) fail(`${at} สินค้าสำเร็จรูป`);
    return { ...base, goodQty: Number(row.goodQty), scrapQty: Number(row.scrapQty), destination: row.destination, productCode: text(row.productCode), movementId: String(row.movementId || '') };
  });
  const budgets = {};
  for (const [jobKey, budget] of Object.entries(value.budgets)) {
    if (!/^(ubon|khonkaen)\|[\w.:-]{1,120}$/.test(jobKey)) fail(`งบของ ${jobKey}`);
    if (!budget || typeof budget !== 'object' || Array.isArray(budget)) fail(`งบของ ${jobKey}`);
    for (const key of Object.keys(budget)) if (!BUDGET_FIELDS.includes(key)) fail(`งบของ ${jobKey} ช่อง ${key}`);
    for (const key of ['materials', 'labourHours', 'labour', 'overhead', 'other']) if (!finiteNonNegative(budget[key] ?? 0)) fail(`งบของ ${jobKey} ${key}`);
    if (!['manual', 'quote'].includes(budget.source)) fail(`งบของ ${jobKey} ที่มา`);
    budgets[jobKey] = { materials: Number(budget.materials || 0), labourHours: Number(budget.labourHours || 0), labour: Number(budget.labour || 0), overhead: Number(budget.overhead || 0), other: Number(budget.other || 0), source: budget.source, sourceRef: text(budget.sourceRef), updatedAt: String(budget.updatedAt || '') };
  }
  return { schemaVersion: JOB_COSTING_SCHEMA_VERSION, entries, budgets };
}
export function liveEntries(store) {
  return (store?.entries || []).filter(entry => entry.status === 'posted');
}

// ---------------------------------------------------------------- amounts
// hours × rate, rounded once to the satang.
export function labourAmountSatang(hours, rateBaht) {
  return mulDivRound(toQm(hours), toSatang(rateBaht), QTY_SCALE);
}
// The rate of a person: their own rate when the company set one, else the default rate.
export function labourRateFor(settings = {}, person = '') {
  const name = text(person).toLowerCase();
  const own = (settings.personRates || []).find(row => text(row.name).toLowerCase() === name);
  return own ? Number(own.rate) : Number(settings.labourRate || 0);
}
// The company's predetermined overhead rate in baht per hour (estimated overhead ÷ estimated labour hours).
export function overheadRateBaht(settings = {}) {
  return overheadRateSatang(settings.overhead || {}) / 100;
}

// ---------------------------------------------------------------- the job cost sheet (ใบต้นทุนงาน)
// input: { jobs, store, costing (erp-costing-core.js result), quotes (Map jobKey → quote record) }
// → Map(jobKey → sheet)
export function buildJobCostSheets(input = {}) {
  const jobs = Array.isArray(input.jobs) ? input.jobs : [];
  const entries = liveEntries(input.store);
  const budgets = input.store?.budgets || {};
  const quotes = input.quotes instanceof Map ? input.quotes : new Map();
  const sheets = new Map();
  for (const job of jobs) sheets.set(job.key, emptySheet(job));
  // Materials: the costed stock movements that carry the job key.
  if (input.costing?.bySku) {
    for (const costing of input.costing.bySku.values()) {
      for (let index = 0; index < costing.list.length; index += 1) {
        const movement = costing.list[index];
        if (movement.kind !== 'job_issue' && movement.kind !== 'job_return') continue;
        const sheet = sheets.get(movement.ref?.jobKey);
        if (!sheet) continue;
        const row = costing.row(index);
        const line = { id: row.id, movementId: row.ref.movementId, date: row.date, sku: row.sku, qm: row.qm, value: Math.abs(row.value), negative: row.negative, kind: row.kind };
        if (row.kind === 'job_issue') { sheet.materials.issued += line.value; sheet.materials.issues.push(line); }
        else { sheet.materials.returned += line.value; sheet.materials.returns.push(line); }
      }
    }
  }
  for (const entry of entries) {
    const sheet = sheets.get(entry.jobKey);
    if (!sheet) continue;
    if (entry.kind === 'labour') {
      const amount = labourAmountSatang(entry.hours, entry.rate);
      const overhead = labourAmountSatang(entry.hours, entry.overheadRate);
      sheet.labour.hoursQm += toQm(entry.hours);
      sheet.labour.amount += amount;
      sheet.labour.entries.push({ ...entry, amountSatang: amount, overheadSatang: overhead });
      sheet.overhead.hoursQm += toQm(entry.hours);
      sheet.overhead.amount += overhead;
    } else if (entry.kind === 'other') {
      const amount = toSatang(entry.amount);
      sheet.other.amount += amount;
      sheet.other.entries.push({ ...entry, amountSatang: amount });
    } else if (entry.kind === 'completion') {
      // One live completion per job (the save path refuses a second one); the latest wins defensively.
      if (!sheet.completion || entry.date >= sheet.completion.date) sheet.completion = entry;
    }
  }
  for (const sheet of sheets.values()) {
    for (const list of [sheet.materials.issues, sheet.materials.returns, sheet.labour.entries, sheet.other.entries]) list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
    sheet.materials.net = sheet.materials.issued - sheet.materials.returned;
    sheet.total = sheet.materials.net + sheet.labour.amount + sheet.overhead.amount + sheet.other.amount;
    sheet.status = sheet.completion ? 'completed' : 'open';
    sheet.goodQm = sheet.completion ? toQm(sheet.completion.goodQty) : 0;
    sheet.scrapQm = sheet.completion ? toQm(sheet.completion.scrapQty) : 0;
    sheet.destination = sheet.completion ? sheet.completion.destination : '';
    // Cost per good unit (uc, 4 decimals): the scrap's cost is carried by the good units.
    sheet.unitCost = sheet.goodQm > 0 ? unitCostOf(sheet.total, sheet.goodQm) : null;
    sheet.budget = resolveBudget(sheet.job, budgets[sheet.job.key], quotes.get(sheet.job.key));
  }
  return sheets;
}
function emptySheet(job) {
  return {
    job,
    materials: { issued: 0, returned: 0, net: 0, issues: [], returns: [] },
    labour: { hoursQm: 0, amount: 0, entries: [] },
    overhead: { hoursQm: 0, amount: 0 },
    other: { amount: 0, entries: [] },
    completion: null,
    total: 0,
    status: 'open',
    goodQm: 0,
    scrapQm: 0,
    destination: '',
    unitCost: null,
    budget: null,
    revenue: 0,
    revenueLines: 0,
    profit: null,
    margin: null
  };
}
// The quotation's estimate: Σ qty × the standard cost captured when the quote was priced (pricingRuleSnapshot).
export function quoteEstimateSatang(quote) {
  if (!quote || !Array.isArray(quote.items)) return null;
  let total = 0;
  let found = false;
  for (const item of quote.items) {
    const cost = item?.pricingRuleSnapshot?.standardCost;
    if (cost === undefined || cost === null || cost === '' || !Number.isFinite(Number(cost))) continue;
    found = true;
    total += mulDivRound(toQm(item.qty), toSatang(cost), QTY_SCALE);
  }
  return found && total > 0 ? total : null;
}
// Budget for budget-vs-actual: the budget stored for the job (entered on the cost sheet, or taken from the quote's
// estimate by category); else the quote's estimate (total only); else the production order's own cost estimate.
export function resolveBudget(job, stored, quote) {
  if (stored) {
    const byCategory = { materials: toSatang(stored.materials), labour: toSatang(stored.labour), overhead: toSatang(stored.overhead), other: toSatang(stored.other) };
    return { source: stored.source === 'quote' ? 'quote' : 'manual', sourceRef: stored.sourceRef || '', byCategory, labourHoursQm: toQm(stored.labourHours), total: byCategory.materials + byCategory.labour + byCategory.overhead + byCategory.other };
  }
  const fromQuote = quoteEstimateSatang(quote);
  if (fromQuote !== null) return { source: 'quote_total', sourceRef: text(quote?.no), byCategory: null, labourHoursQm: 0, total: fromQuote };
  if (job?.estimate > 0) return { source: 'production', sourceRef: job.no, byCategory: null, labourHoursQm: 0, total: job.estimate };
  return null;
}
// Finished goods: the value of each completion movement = the job's total cost (Map movementId → satang), for
// erp-costing-core.js computeInventoryCosting.
export function completionValuesFrom(sheets) {
  const out = new Map();
  for (const sheet of sheets.values()) {
    if (sheet.completion?.destination === 'finished_goods' && sheet.completion.movementId) out.set(`mv|${sheet.completion.movementId}`, sheet.total);
  }
  return out;
}

// ---------------------------------------------------------------- gross-profit lines (the sales measure with cost)
// input: {
//   measureRows: [{ row, branch, period }]  — the rows of erp-analytics-core.js packSalesRows for every pack
//   products, costing (engine result), sheets (buildJobCostSheets), jobs, invoices (live invoices: legacy jobs'
//   stock lines take their cost from the invoices that delivered them)
// }
// → { lines: [line], byJob: Map(jobKey → { revenue, lines }) }
// line = salesLinesOfRows line (branch, period, product…, customer…, qty, value in baht) + valueSatang, cost (satang
// or null), status: 'stock' | 'job_done' | 'job_open' | 'none', jobKey, docType, docNo, source.
// Cost status (never a fake margin): stock lines are costed by the inventory engine; lines of a completed job share
// its cost; lines of a job still open, services and made-to-order lines without a job have no cost yet.
export function buildGrossProfitLines(input = {}) {
  const products = Array.isArray(input.products) ? input.products : [];
  const resolve = createProductResolver(products);
  const lookupProduct = ({ code, name }) => resolve({ productCode: code, product: name });
  const jobs = Array.isArray(input.jobs) ? input.jobs : [];
  const jobOf = createJobLinker(jobs);
  const sheets = input.sheets instanceof Map ? input.sheets : new Map();
  const skuOf = item => {
    const product = resolve(item);
    return product && isStockTrackedProduct(product) ? productSkuKey(product) : '';
  };
  // Engine figures: cost of each invoice line, cost of the goods each credit note took back (per product).
  const cogs = new Map();
  const returns = new Map();
  if (input.costing?.bySku) {
    for (const costing of input.costing.bySku.values()) {
      for (let index = 0; index < costing.list.length; index += 1) {
        const movement = costing.list[index];
        if (movement.kind === 'sale') cogs.set(`${movement.branch}|${movement.ref.id}|${movement.ref.line}`, -costing.value[index]);
        else if (movement.kind === 'sale_return') {
          const key = `${movement.branch}|${movement.ref.id}|${movement.sku}`;
          const sum = returns.get(key) || { qm: 0, value: 0 };
          sum.qm += movement.qm;
          sum.value += costing.value[index];
          returns.set(key, sum);
        }
      }
    }
  }
  // Invoice id → job (for credit / debit-note rows, which name the original invoice), and per job the stock cost of
  // the invoices that delivered it (legacy jobs count the production order itself as the sale).
  const invoiceJob = new Map();
  const deliveredStock = new Map();
  for (const invoice of Array.isArray(input.invoices) ? input.invoices : []) {
    const branch = text(invoice.branch || invoice._branch);
    const job = jobOf({ ...invoice, branch });
    if (!job) continue;
    invoiceJob.set(`${branch}|${text(invoice.id)}`, job.key);
    (Array.isArray(invoice.items) ? invoice.items : []).forEach((item, index) => {
      const sku = skuOf(item);
      const cost = sku ? cogs.get(`${branch}|${text(invoice.id)}|${index}`) : undefined;
      if (cost === undefined) return;
      const key = `${job.key}|${sku}`;
      const sum = deliveredStock.get(key) || { qm: 0, value: 0 };
      sum.qm += toQm(item.qty);
      sum.value += cost;
      deliveredStock.set(key, sum);
    });
  }
  const lines = [];
  const byJob = new Map();
  for (const { row, branch, period } of Array.isArray(input.measureRows) ? input.measureRows : []) {
    const rowLines = salesLinesOfRows([row], { branch, period, lookupProduct });
    const items = Array.isArray(row.items) && row.items.length ? row.items : null;
    const kind = row._creditAdjustment ? (row._debitAdjustment ? 'debit_note' : 'credit_note') : row._type === 'invoices' ? 'invoice' : 'production';
    let job = null;
    if (kind === 'invoice') job = jobOf({ ...row, branch });
    else if (kind === 'production') job = jobs.find(candidate => candidate.key === `${branch}|${text(row.id)}`) || null;
    else {
      const key = invoiceJob.get(`${text(row.invoiceBranch || branch)}|${text(row.invoiceId)}`);
      job = key ? jobs.find(candidate => candidate.key === key) || null : null;
    }
    const sheet = job ? sheets.get(job.key) : null;
    const jobStatus = sheet ? (sheet.status === 'completed' ? 'job_done' : 'job_open') : 'none';
    const date = text(row.date).slice(0, 10);
    rowLines.forEach((line, index) => {
      const item = items && index < items.length ? items[index] : null;
      const sku = item ? skuOf(item) : '';
      const out = { ...line, date, valueSatang: toSatang(line.value), cost: null, status: 'none', jobKey: '', docType: kind, docNo: text(row.no), docId: text(row.id), rowValue: salesRowValue(row) };
      if (kind === 'invoice') {
        if (sku) {
          const cost = cogs.get(`${branch}|${text(row.id)}|${index}`);
          if (cost !== undefined) { out.cost = cost; out.status = 'stock'; }
        } else if (job && item) { out.status = jobStatus; out.jobKey = job.key; }
      } else if (kind === 'production') {
        if (sku && job && item) {
          const delivered = deliveredStock.get(`${job.key}|${sku}`);
          const qm = toQm(item.qty);
          if (delivered && delivered.qm > 0 && qm > 0) { out.cost = mulDivRound(delivered.value, Math.min(qm, delivered.qm), delivered.qm); out.status = 'stock'; }
        } else if (job && item) { out.status = jobStatus; out.jobKey = job.key; }
      } else if (item) {
        // Credit / debit-note line: returned stock comes back at the cost it left with; a price-only change moves no
        // goods (cost 0) and is as well-costed as the invoice line it corrects.
        const qty = Number(item.qty) || 0;
        if (sku && qty < 0 && kind === 'credit_note') {
          const back = returns.get(`${branch}|${text(row.creditNoteId)}|${sku}`);
          const qm = toQm(-qty);
          if (back && back.qm > 0) { out.cost = -mulDivRound(back.value, Math.min(qm, back.qm), back.qm); out.status = 'stock'; }
        } else if (sku) { out.cost = 0; out.status = 'stock'; }
        else if (job) { out.cost = 0; out.status = jobStatus; out.jobKey = job.key; out.adjustment = true; }
      }
      // A document-rounding line carries no goods: cost 0, as well-costed as the rest of its document.
      if (!item && index > 0 && lines.length && rowLines.length > 1) {
        const prev = lines[lines.length - 1];
        if (prev.docId === out.docId && (prev.status === 'stock' || prev.status === 'job_done')) { out.cost = 0; out.status = prev.status; }
      }
      if (out.jobKey) {
        const entry = byJob.get(out.jobKey) || { revenue: 0, lines: [] };
        entry.revenue += out.valueSatang;
        entry.lines.push(out);
        byJob.set(out.jobKey, entry);
      }
      lines.push(out);
    });
  }
  // A job's cost goes to cost of sales with its sales lines, shared by their value (largest remainder, exact). Job
  // lines that are only corrections (credit / debit notes) take no share. A job completed into finished goods has
  // its cost in stock (it is costed again when the goods are sold); a job not yet completed has no final cost.
  for (const [jobKey, entry] of byJob) {
    const sheet = sheets.get(jobKey);
    const primary = entry.lines.filter(line => !line.adjustment && line.valueSatang > 0);
    if (!sheet || !primary.length) continue;
    const total = sheet.destination === 'finished_goods' ? 0 : sheet.total;
    const shares = allocateSatang(total, primary.map(line => line.valueSatang));
    primary.forEach((line, index) => { line.cost = shares[index]; });
    for (const line of entry.lines) if (line.cost === null) line.cost = 0;
    sheet.revenue = entry.revenue;
    sheet.revenueLines = entry.lines.length;
  }
  for (const sheet of sheets.values()) {
    const revenue = sheet.revenue;
    sheet.profit = revenue > 0 && sheet.status === 'completed' && sheet.destination !== 'finished_goods' ? revenue - sheet.total : null;
    sheet.margin = sheet.profit !== null ? sheet.profit / revenue * 100 : null;
  }
  return { lines, byJob };
}
// Integer satang split by weights, largest remainder (ties by position) — the parts add up to `total` exactly.
export function allocateSatang(total, weights) {
  const count = weights.length;
  if (!count) return [];
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  if (sum === 0) {
    const base = Math.trunc(total / count);
    const out = weights.map(() => base);
    let rest = total - base * count;
    for (let i = 0; rest !== 0; i += 1) { out[i % count] += Math.sign(rest); rest -= Math.sign(rest); }
    return out;
  }
  const floors = weights.map(weight => Math.floor(total * weight / sum));
  let rest = total - floors.reduce((acc, value) => acc + value, 0);
  const order = weights.map((weight, index) => ({ index, fraction: total * weight / sum - floors[index] })).sort((a, b) => (b.fraction - a.fraction) || (a.index - b.index));
  for (let i = 0; rest > 0; i = (i + 1) % count, rest -= 1) floors[order[i].index] += 1;
  return floors;
}
export const COVERED_STATUSES = Object.freeze(['stock', 'job_done']);
export function isCovered(line) {
  return COVERED_STATUSES.includes(line.status) && line.cost !== null;
}

// ---------------------------------------------------------------- reports
// Totals of a set of lines: sales (all), covered sales (with a cost), cost, gross profit and margin over the covered
// sales only, and coverage (covered ÷ all sales; null when sales ≤ 0). extraSales: sales without documents (the
// demo monthly history), always uncovered.
export function summarizeLines(lines, extraSales = 0) {
  let sales = toSatang(extraSales);
  let covered = 0;
  let cost = 0;
  for (const line of lines) {
    sales += line.valueSatang;
    if (isCovered(line)) { covered += line.valueSatang; cost += line.cost; }
  }
  const gp = covered - cost;
  return { sales, coveredSales: covered, cost, grossProfit: gp, margin: covered > 0 ? gp / covered * 100 : null, coverage: sales > 0 ? Math.max(0, Math.min(100, covered / sales * 100)) : null };
}
// Group lines by job / customer / product / month (and filter by branch and months). → rows sorted by sales.
export const PROFIT_DIMENSIONS = Object.freeze(['job', 'customer', 'product', 'month']);
export function profitReport(lines, options = {}) {
  const dimension = PROFIT_DIMENSIONS.includes(options.dimension) ? options.dimension : 'job';
  const months = Array.isArray(options.months) ? new Set(options.months) : null;
  const branch = options.branch && options.branch !== 'all' ? options.branch : '';
  const selected = lines.filter(line => (!branch || line.branch === branch) && (!months || months.has(line.period)));
  const groups = new Map();
  for (const line of selected) {
    let key;
    if (dimension === 'job') { if (!line.jobKey) continue; key = line.jobKey; }
    else if (dimension === 'customer') key = line.customerKey;
    else if (dimension === 'product') key = line.productKey;
    else key = line.period;
    const group = groups.get(key) || { key, sample: line, lines: [] };
    group.lines.push(line);
    groups.set(key, group);
  }
  const rows = [...groups.values()].map(group => ({ key: group.key, sample: group.sample, ...summarizeLines(group.lines) }));
  if (dimension === 'month') rows.sort((a, b) => (a.key < b.key ? -1 : 1));
  else rows.sort((a, b) => (b.sales - a.sales) || (a.key < b.key ? -1 : 1));
  const total = summarizeLines(dimension === 'job' ? selected.filter(line => line.jobKey) : selected);
  return { dimension, rows, total, all: summarizeLines(selected) };
}

// ---------------------------------------------------------------- over / under-applied overhead
// Actual overhead = expenses of the period whose category the company tagged as manufacturing overhead (pre-VAT when
// the input VAT is claimable; the gross amount otherwise); applied = Σ labour hours × the rate fixed on each entry.
// Over-applied (applied > actual) and under-applied (applied < actual) are shown as information only (round 12 closes
// the difference to cost of sales with a journal).
export function expenseOverheadSatang(expense) {
  if (expense?.inputVatClaimable === true && expense.subtotal !== undefined && expense.subtotal !== null && Number.isFinite(Number(expense.subtotal))) return toSatang(expense.subtotal);
  return toSatang(expense?.amount);
}
export function overheadVarianceReport(input = {}) {
  const categories = new Set((input.categories || []).map(text));
  const months = Array.isArray(input.months) ? input.months.slice().sort() : [];
  const branch = input.branch && input.branch !== 'all' ? input.branch : '';
  const rows = months.map(period => ({ period, actual: 0, applied: 0, hoursQm: 0, expenses: 0 }));
  const byPeriod = new Map(rows.map(row => [row.period, row]));
  for (const expense of Array.isArray(input.expenses) ? input.expenses : []) {
    if (!isLive(expense) || !categories.has(text(expense.cat))) continue;
    const expenseBranch = text(expense._branch || expense.branch);
    if (branch && expenseBranch !== branch) continue;
    const row = byPeriod.get(monthOfDate(text(expense.date)));
    if (!row) continue;
    row.actual += expenseOverheadSatang(expense);
    row.expenses += 1;
  }
  for (const entry of liveEntries(input.store)) {
    if (entry.kind !== 'labour' || (branch && entry.branch !== branch)) continue;
    const row = byPeriod.get(monthOfDate(entry.date));
    if (!row) continue;
    row.applied += labourAmountSatang(entry.hours, entry.overheadRate);
    row.hoursQm += toQm(entry.hours);
  }
  for (const row of rows) row.variance = row.applied - row.actual;
  const total = rows.reduce((acc, row) => ({ actual: acc.actual + row.actual, applied: acc.applied + row.applied, hoursQm: acc.hoursQm + row.hoursQm, expenses: acc.expenses + row.expenses }), { actual: 0, applied: 0, hoursQm: 0, expenses: 0 });
  total.variance = total.applied - total.actual;
  return { rows, total };
}

// ---------------------------------------------------------------- planning entries (validation before a save)
// Material issue to a job: refused for a completed job, a quantity ≤ 0, a product that is not stock-tracked, or more
// than the stock available on the date (the app never lets stock go negative when a document is posted).
export function planMaterialIssue(input = {}) {
  const { job, sheet, product, qty, date, available } = input;
  if (!job) return { ok: false, error: 'job_missing' };
  if (sheet?.status === 'completed') return { ok: false, error: 'job_completed' };
  if (!product || !isStockTrackedProduct(product)) return { ok: false, error: 'not_stock_item' };
  if (!isIsoDate(date)) return { ok: false, error: 'invalid_date' };
  if (job.date && dateNumber(date) < dateNumber(job.date)) return { ok: false, error: 'before_job' };
  const qm = toQm(qty);
  if (!(qm > 0)) return { ok: false, error: 'invalid_qty' };
  if (toQm(available) < qm) return { ok: false, error: 'not_enough_stock' };
  return { ok: true, qm };
}
// Material return from a job: at most what the job still holds of that issue (issued − already returned).
export function planMaterialReturn(input = {}) {
  const { job, sheet, issueMovementId, qty, date } = input;
  if (!job || !sheet) return { ok: false, error: 'job_missing' };
  if (sheet.status === 'completed') return { ok: false, error: 'job_completed' };
  if (!isIsoDate(date)) return { ok: false, error: 'invalid_date' };
  const issue = sheet.materials.issues.find(line => line.movementId === issueMovementId);
  if (!issue) return { ok: false, error: 'issue_missing' };
  if (dateNumber(date) < dateNumber(issue.date)) return { ok: false, error: 'before_issue' };
  const returned = sheet.materials.returns.filter(line => input.returnSources?.get?.(line.movementId) === issueMovementId).reduce((sum, line) => sum + line.qm, 0);
  const qm = toQm(qty);
  if (!(qm > 0)) return { ok: false, error: 'invalid_qty' };
  if (qm > issue.qm - returned) return { ok: false, error: 'more_than_issued' };
  return { ok: true, qm, issue };
}
export function planLabourEntry(input = {}) {
  const { job, sheet, person, hours, date, settings } = input;
  if (!job) return { ok: false, error: 'job_missing' };
  if (sheet?.status === 'completed') return { ok: false, error: 'job_completed' };
  if (!text(person)) return { ok: false, error: 'person_required' };
  if (!isIsoDate(date)) return { ok: false, error: 'invalid_date' };
  if (job.date && dateNumber(date) < dateNumber(job.date)) return { ok: false, error: 'before_job' };
  const h = Number(hours);
  if (!(Number.isFinite(h) && h > 0 && h <= 10000)) return { ok: false, error: 'invalid_hours' };
  const rate = input.rate !== undefined && input.rate !== '' && input.rate !== null ? Number(input.rate) : labourRateFor(settings, person);
  if (!(Number.isFinite(rate) && rate >= 0)) return { ok: false, error: 'invalid_rate' };
  const overheadRate = overheadRateBaht(settings);
  return { ok: true, entry: { kind: 'labour', person: text(person), hours: h, rate, overheadRate, date }, amount: labourAmountSatang(h, rate), overhead: labourAmountSatang(h, overheadRate) };
}
export function planOtherCost(input = {}) {
  const { job, sheet, category, description, amount, date } = input;
  if (!job) return { ok: false, error: 'job_missing' };
  if (sheet?.status === 'completed') return { ok: false, error: 'job_completed' };
  if (!OTHER_COST_CATEGORIES.includes(category)) return { ok: false, error: 'invalid_category' };
  if (!text(description)) return { ok: false, error: 'description_required' };
  if (!isIsoDate(date)) return { ok: false, error: 'invalid_date' };
  const value = Number(amount);
  if (!(Number.isFinite(value) && value > 0)) return { ok: false, error: 'invalid_amount' };
  return { ok: true, entry: { kind: 'other', category, description: text(description), amount: toSatang(value) / 100, date } };
}
export function planCompletion(input = {}) {
  const { job, sheet, goodQty, scrapQty, destination, date, product } = input;
  if (!job || !sheet) return { ok: false, error: 'job_missing' };
  if (sheet.status === 'completed') return { ok: false, error: 'job_completed' };
  if (!isIsoDate(date)) return { ok: false, error: 'invalid_date' };
  if (job.date && dateNumber(date) < dateNumber(job.date)) return { ok: false, error: 'before_job' };
  const lastCost = [...sheet.materials.issues, ...sheet.materials.returns, ...sheet.labour.entries, ...sheet.other.entries].reduce((max, line) => (line.date > max ? line.date : max), '');
  if (lastCost && dateNumber(date) < dateNumber(lastCost)) return { ok: false, error: 'before_last_cost' };
  const good = Number(goodQty);
  const scrap = Number(scrapQty || 0);
  if (!(Number.isFinite(good) && good > 0) || !(Number.isFinite(scrap) && scrap >= 0)) return { ok: false, error: 'invalid_qty' };
  if (!COMPLETION_DESTINATIONS.includes(destination)) return { ok: false, error: 'invalid_destination' };
  if (destination === 'finished_goods' && (!product || !isStockTrackedProduct(product))) return { ok: false, error: 'finished_goods_not_stock' };
  return { ok: true, entry: { kind: 'completion', goodQty: good, scrapQty: scrap, destination, productCode: destination === 'finished_goods' ? text(product.code) : '', date } };
}
