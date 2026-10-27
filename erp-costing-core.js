// ============================================================================
// erp-costing-core.js — inventory costing: moving weighted average (default) and FIFO (ADR-028, round 11)
// ERP DEMO 4.3.1 · pure: no DOM, no storage, no clock (every date is passed in)
// ----------------------------------------------------------------------------
// Sources (docs/decisions/ADR-028-inventory-and-job-costing.md, research report "ระยะ 1" 1.1):
//   * TFRS for NPAEs: specific identification, FIFO or weighted average; no LIFO; inventory at the lower of
//     cost and net realisable value (PwC pocket guide 2014).
//   * Revenue Code s.65 ทวิ (6): inventory at cost or market, whichever is lower; the valuation method may be
//     changed only with the approval of the Director-General (rd.go.th/5939).
//   * Moving average: new average = (qty on hand × average + qty received × unit cost) ÷ (qty on hand + qty
//     received) — the report's formula, applied after every inflow.
//
// Units (integers only, so every total is exact and reproducible):
//   * quantity  → "qm" = thousandths of a unit (QTY_SCALE 1,000; the app's quantities have ≤ 2 decimals)
//   * money     → satang (1/100 baht)
//   * unit cost → "uc" = baht × 10,000 (UNIT_COST_SCALE: 4 decimals carried internally)
//   Rounding is half away from zero ("half-up" on the magnitude), once per movement total. A FIFO movement that
//   touches k layers rounds each partly-used layer once (its remaining value stays exact). A movement that empties
//   the stock takes the whole remaining value, so zero quantity always means zero value, and the stock value is
//   always the exact sum of its layers.
//
// Ordering (deterministic): per product, every branch together, by date, then by a fixed rank of the movement kind
// within the day (stock in before stock out; a transfer leaves its branch before it arrives at the other), then by
// a stable text key built from document ids. Storage order never matters. A back-dated movement is simply placed
// at its date and everything after it is recomputed (the engine always recomputes from the opening balance).
//
// Negative stock: the app refuses issues beyond the stock available when they are posted (invoice stock check,
// adjustment, transfer, goods-receipt reversal), but a BACK-DATED document can make the running balance negative
// at an earlier date. Such an outflow is costed at the last known unit cost (average / last FIFO layer; with no
// history the product's standard cost) and flagged `negative`. When stock arrives, the units owed are re-valued at
// the cost of the arriving goods; the difference is a `correction` (+ = more cost of sales) on that receipt, in the
// receipt's own period — earlier (possibly closed) periods are never restated.
// ============================================================================

export const COSTING_CORE_VERSION = '1.0.0';
export const COSTING_METHODS = Object.freeze(['moving_average', 'fifo']);
export const DEFAULT_COSTING_METHOD = 'moving_average';
export const QTY_SCALE = 1000;
export const UNIT_COST_SCALE = 10000;
export const BRANCH_IDS = Object.freeze(['ubon', 'khonkaen']);

// Movement kinds the engine understands, with their rank inside one day.
export const MOVEMENT_RANK = Object.freeze({
  opening: 0,
  receipt: 10,
  sale_return: 20,
  job_return: 21,
  job_completion: 22,
  adjust_in: 30,
  transfer_out: 40,
  transfer_in: 41,
  receipt_reversal: 50,
  job_issue: 60,
  sale: 70,
  adjust_out: 80
});
const RANK_OF = new Map(Object.entries(MOVEMENT_RANK));
const INFLOW_KINDS = Object.freeze(['opening', 'receipt', 'sale_return', 'job_return', 'job_completion', 'adjust_in', 'transfer_in']);
const OUTFLOW_KINDS = Object.freeze(['transfer_out', 'receipt_reversal', 'job_issue', 'sale', 'adjust_out']);
export function isInflowKind(kind) {
  return INFLOW_KINDS.includes(kind);
}
export function isOutflowKind(kind) {
  return OUTFLOW_KINDS.includes(kind);
}
// Period-lock scope of a costed movement: sales issues and their returns belong to the sales period; everything
// else (receipts, adjustments, transfers, job issues / returns / completions) to the purchase / stock period.
export function lockScopeOfKind(kind) {
  return kind === 'sale' || kind === 'sale_return' ? 'sales' : 'purchase';
}

// ---------------------------------------------------------------- integer arithmetic
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
function assertInteger(value, what) {
  if (!Number.isSafeInteger(value)) throw new Error(`costing: ${what} is not a safe integer (${value})`);
  return value;
}
// round(a × b ÷ c), half away from zero, for integers a, b and c ≠ 0 (BigInt when the product is not exact).
export function mulDivRound(a, b, c) {
  assertInteger(a, 'a');
  assertInteger(b, 'b');
  assertInteger(c, 'c');
  return mulDiv(a, b, c);
}
// The same without the argument checks, for the engine's inner loop (its operands are integers by construction:
// they come from toScaled and from earlier results of this function).
function mulDiv(a, b, c) {
  if (c === 0) throw new Error('costing: division by zero');
  const product = a * b;
  if (Math.abs(product) <= MAX_SAFE) {
    const negative = (product < 0) !== (c < 0);
    const num = Math.abs(product);
    const den = Math.abs(c);
    const quotient = Math.floor(num / den);
    const remainder = num - quotient * den;
    const rounded = remainder * 2 >= den ? quotient + 1 : quotient;
    return negative ? -rounded : rounded;
  }
  const bigProduct = BigInt(a) * BigInt(b);
  const bigDen = BigInt(c);
  const negative = (bigProduct < 0n) !== (bigDen < 0n);
  const num = bigProduct < 0n ? -bigProduct : bigProduct;
  const den = bigDen < 0n ? -bigDen : bigDen;
  let quotient = num / den;
  if ((num % den) * 2n >= den) quotient += 1n;
  const result = Number(negative ? -quotient : quotient);
  return assertInteger(result, 'mulDivRound result');
}
// A decimal number (baht, units, a typed string with commas) → integer at `scale`, half away from zero. The 1e-6
// 15-significant-digit step removes binary noise first (2.135 × 100 = 213.49999999999997 → 213.5 → 214 satang,
// as ป.86/2542 expects).
export function toScaled(value, scale) {
  const n = typeof value === 'string' ? Number(value.replace(/,/g, '').trim()) : Number(value);
  if (!Number.isFinite(n)) return 0;
  const scaled = Number((n * scale).toPrecision(15));
  const magnitude = Math.floor(Math.abs(scaled) + 0.5);
  return assertInteger(scaled < 0 ? -magnitude : magnitude, 'scaled value');
}
export const toQm = value => toScaled(value, QTY_SCALE);
export const toSatang = value => toScaled(value, 100);
export const toUc = value => toScaled(value, UNIT_COST_SCALE);
export const qmToQty = qm => qm / QTY_SCALE;
export const satangToBaht = satang => satang / 100;
export const ucToBaht = uc => uc / UNIT_COST_SCALE;
// Unit cost (uc) of `value` satang for `qm`: value / 100 baht ÷ (qm / 1,000) units × 10,000.
const UC_FACTOR = (UNIT_COST_SCALE * QTY_SCALE) / 100;
export function unitCostOf(value, qm) {
  if (!qm) return 0;
  return mulDiv(value, UC_FACTOR, qm);
}
// Value in satang of `qm` at unit cost `uc`.
export function valueOfQty(qm, uc) {
  return mulDiv(qm, uc, UC_FACTOR);
}
// The satang share of `total` that `part` out of `whole` units carries (exact when part === whole).
export function shareOf(total, part, whole) {
  if (part === whole) return total;
  return mulDiv(total, part, whole);
}

// ---------------------------------------------------------------- dates
// 'YYYY-MM-DD' (the first 10 characters) → YYYYMMDD as a number when it is a real calendar day, else NaN. Read
// character by character (no regular expression, no string hashing: it runs once per movement). The opening uses 0.
const DIGIT_0 = 48;
const MONTH_DAYS = Object.freeze([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
function digitsAt(text, from, count) {
  let value = 0;
  for (let i = from; i < from + count; i += 1) {
    const code = text.charCodeAt(i) - DIGIT_0;
    if (code < 0 || code > 9) return -1;
    value = value * 10 + code;
  }
  return value;
}
export function dateNumber(iso) {
  const text = typeof iso === 'string' ? iso : String(iso ?? '');
  if (text.length < 10 || text.charCodeAt(4) !== 45 || text.charCodeAt(7) !== 45) return NaN;
  const year = digitsAt(text, 0, 4);
  const month = digitsAt(text, 5, 2);
  const day = digitsAt(text, 8, 2);
  if (year < 0 || month < 1 || month > 12 || day < 1) return NaN;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = month === 2 && leap ? 29 : MONTH_DAYS[month - 1];
  if (day > days) return NaN;
  return year * 10000 + month * 100 + day;
}
export function isIsoDate(iso) {
  return Number.isFinite(dateNumber(iso)) && String(iso).length === 10;
}

// ---------------------------------------------------------------- product identity
const norm = value => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
// The key of a product in every costing result: its code when it has one, else its name (normalised).
export function productSkuKey(product = {}) {
  const code = norm(product.code ?? product.productCode);
  if (code) return `code:${code}`;
  const name = norm(product.name ?? product.product);
  return name ? `name:${name}` : '';
}
export function isStockTrackedProduct(product = {}) {
  return product?.flowType === 'inventory' && product?.fulfillmentType === 'stock';
}
// Resolves a document line ({ productCode, product }) to a Product Master row with the rule app.js uses for stock
// (productSoldQty): a line with a code matches the product with that code; a product without a code matches by name.
export function createProductResolver(products = []) {
  const byCode = new Map();
  const byNameNoCode = new Map();
  const byName = new Map();
  for (const product of Array.isArray(products) ? products : []) {
    if (!product || typeof product !== 'object') continue;
    const code = norm(product.code);
    const name = norm(product.name);
    if (code && !byCode.has(code)) byCode.set(code, product);
    if (name && !byName.has(name)) byName.set(name, product);
    if (!code && name && !byNameNoCode.has(name)) byNameNoCode.set(name, product);
  }
  return item => {
    const code = norm(item?.productCode ?? item?.code);
    const name = norm(item?.product ?? item?.name);
    if (code) return byCode.get(code) || (name ? byNameNoCode.get(name) : null) || null;
    return name ? byName.get(name) || null : null;
  };
}

// ---------------------------------------------------------------- settings: method timeline
// settings.methodHistory = [{ method, effectiveFrom: '' | 'YYYY-MM-DD', approvalRef, approvalDate, note, at, by }]
// The first entry (effectiveFrom '') is the method chosen before any costed movement. Each later entry is a change
// approved by the Revenue Department (s.65 ทวิ (6)), effective from its date: movements dated on or after it use
// the new method; the stock is carried over at its value (no restatement of earlier periods).
export function normalizeMethod(method) {
  return COSTING_METHODS.includes(method) ? method : DEFAULT_COSTING_METHOD;
}
export function methodTimeline(settings = {}) {
  const history = Array.isArray(settings?.methodHistory) ? settings.methodHistory : [];
  const steps = [];
  for (const row of history) {
    if (!row || typeof row !== 'object' || !COSTING_METHODS.includes(row.method)) continue;
    const from = row.effectiveFrom ? dateNumber(row.effectiveFrom) : 0;
    if (!Number.isFinite(from)) continue;
    steps.push({ method: row.method, from });
  }
  if (!steps.length || steps[0].from !== 0) steps.unshift({ method: normalizeMethod(settings?.method), from: 0 });
  steps.sort((a, b) => a.from - b.from);
  return steps;
}
function methodAtFactory(timeline) {
  return dateNum => {
    let method = timeline[0].method;
    for (const step of timeline) {
      if (step.from <= dateNum) method = step.method;
      else break;
    }
    return method;
  };
}

// ---------------------------------------------------------------- building movements from the app's records
// input: {
//   products,            Product Master rows (stock-tracked rows are costed)
//   stockMovements,      rows of comform_inventory_movements_v1 (voided rows are skipped)
//   invoices,            live tax invoices of every branch: { id, no, branch, date, items }
//   creditNotes,         live credit notes: { id, no, branch, date, reasonCode, returnItems }
//   openingCosts         { [skuKey]: baht per unit } — the opening balance's cost (else the standard cost)
// }
// → { movements: [normalized], issues: [{ code, ref }] }
const RETURN_REASON = 'returned_goods';
// One normalized movement. Every movement has the same fields in the same order (one object shape), which keeps the
// engine's inner loop fast. qm > 0 always; the kind says the direction. d = the date as YYYYMMDD (0 = opening).
export class CostMovement {
  constructor(id, sku, branch, date, kind, qm, uc, tie, ref) {
    this.id = id;
    this.sku = sku;
    this.branch = branch;
    this.date = date;
    this.d = date ? dateNumber(date) : 0;
    this.kind = kind;
    this.qm = qm;
    this.uc = uc;
    this.tie = tie;
    this.ref = ref;
    this.source = '';
    this.sources = null;
    this.pairKey = '';
  }
}
export function buildCostingMovements(input = {}) {
  const products = Array.isArray(input.products) ? input.products : [];
  const resolve = createProductResolver(products);
  const openingCosts = input.openingCosts && typeof input.openingCosts === 'object' ? input.openingCosts : {};
  const movements = [];
  const groups = new Map();
  const issues = [];
  // Product of a line → its sku key when it is stock-tracked, else ''. Memoised per (code, name) pair.
  const skuMemo = new Map();
  const stockSku = (code, name) => {
    const memoKey = `${code ?? ''}\u0000${name ?? ''}`;
    let sku = skuMemo.get(memoKey);
    if (sku === undefined) {
      const product = resolve({ productCode: code, product: name });
      sku = product && isStockTrackedProduct(product) ? productSkuKey(product) : '';
      skuMemo.set(memoKey, sku);
    }
    return sku;
  };
  // Opening balance per stock product and branch (Product Master openingStockUbon / openingStockKhonkaen).
  const openedSkus = new Set();
  for (const product of products) {
    if (!product || !isStockTrackedProduct(product)) continue;
    const sku = productSkuKey(product);
    if (!sku) continue;
    // Two master rows with the same code: the resolver uses the first, so only the first has an opening balance.
    if (openedSkus.has(sku)) { issues.push({ code: 'duplicate_product', ref: sku }); continue; }
    openedSkus.add(sku);
    const openingUc = toUc(Object.prototype.hasOwnProperty.call(openingCosts, sku) ? openingCosts[sku] : product.standardCost);
    const perBranch = { ubon: product.openingStockUbon ?? product.openingStock, khonkaen: product.openingStockKhonkaen };
    for (const branch of BRANCH_IDS) {
      const qm = toQm(perBranch[branch]);
      if (qm <= 0) continue;
      movements.push(new CostMovement(`opening|${branch}|${sku}`, sku, branch, '', 'opening', qm, openingUc, `opening|${sku}`, { type: 'opening' }));
    }
  }
  // Stored stock movements (goods receipts and their reversals, adjustments, transfers, job issues / returns /
  // completions). The stored qty is signed (+ in, − out).
  const transferPairs = new Map();
  const receiptOf = new Map();
  const reversals = [];
  for (const row of Array.isArray(input.stockMovements) ? input.stockMovements : []) {
    if (!row || typeof row !== 'object' || row.voided) continue;
    const sku = stockSku(row.productCode, row.product);
    if (!sku) continue;
    const rowId = String(row.id ?? '');
    const branch = row.branch;
    if (branch !== 'ubon' && branch !== 'khonkaen') { issues.push({ code: 'unknown_branch', ref: rowId }); continue; }
    const date = typeof row.date === 'string' ? row.date.slice(0, 10) : '';
    if (!(dateNumber(date) > 0)) { issues.push({ code: 'invalid_date', ref: rowId }); continue; }
    const signed = toQm(row.qty);
    if (!signed) continue;
    const kind = row.kind;
    let costKind = '';
    if (kind === 'receipt' && signed > 0) costKind = 'receipt';
    else if (kind === 'receipt_reversal' && signed < 0) costKind = 'receipt_reversal';
    else if (kind === 'adjustment') costKind = signed > 0 ? 'adjust_in' : 'adjust_out';
    else if (kind === 'transfer_out' && signed < 0) costKind = 'transfer_out';
    else if (kind === 'transfer_in' && signed > 0) costKind = 'transfer_in';
    else if (kind === 'job_issue' && signed < 0) costKind = 'job_issue';
    else if (kind === 'job_return' && signed > 0) costKind = 'job_return';
    else if (kind === 'job_completion' && signed > 0) costKind = 'job_completion';
    if (!costKind) { issues.push({ code: 'unknown_kind', ref: rowId }); continue; }
    const ref = { type: String(row.refType || kind || ''), id: String(row.refId ?? ''), no: String(row.refNo ?? ''), movementId: rowId, jobKey: String(row.jobKey ?? '') };
    const movement = new CostMovement(`mv|${rowId}`, sku, branch, date, costKind, Math.abs(signed), toUc(row.unitCost), `mv|${String(row.createdAt ?? '')}|${rowId}`, ref);
    if (costKind === 'receipt' && ref.id) {
      const key = `${ref.id}|${sku}`;
      if (!receiptOf.has(key)) receiptOf.set(key, movement.id);
    } else if (costKind === 'receipt_reversal') reversals.push(movement);
    else if (costKind === 'transfer_out' || costKind === 'transfer_in') {
      movement.pairKey = `${ref.no}|${sku}`;
      if (costKind === 'transfer_out') transferPairs.set(movement.pairKey, (transferPairs.get(movement.pairKey) || 0) + 1);
    } else if (costKind === 'job_return' && row.sourceMovementId) movement.source = `mv|${row.sourceMovementId}`;
    movements.push(movement);
  }
  // A receipt reversal points at the receipt movement of the same goods receipt and product.
  for (const movement of reversals) movement.source = receiptOf.get(`${movement.ref.id}|${movement.sku}`) || '';
  for (const movement of movements) {
    if (movement.kind === 'transfer_in' && !transferPairs.has(movement.pairKey)) issues.push({ code: 'transfer_without_pair', ref: movement.ref.movementId });
  }
  // Sales: every line of a live invoice that is a stock-tracked product (the same lines app.js deducts from stock).
  const saleLines = new Map();
  for (const invoice of Array.isArray(input.invoices) ? input.invoices : []) {
    if (!invoice || typeof invoice !== 'object') continue;
    const branch = String(invoice.branch || invoice._branch || '');
    const date = typeof invoice.date === 'string' ? invoice.date.slice(0, 10) : '';
    if (!BRANCH_IDS.includes(branch) || !(dateNumber(date) > 0)) { issues.push({ code: 'invoice_unplaced', ref: String(invoice.no || invoice.id || '') }); continue; }
    const invoiceId = String(invoice.id);
    const invoiceNo = String(invoice.no || '');
    (Array.isArray(invoice.items) ? invoice.items : []).forEach((item, index) => {
      const sku = stockSku(item?.productCode ?? item?.code, item?.product ?? item?.name);
      if (!sku) return;
      const qm = toQm(item?.qty);
      if (qm <= 0) return;
      const id = `sale|${branch}|${invoiceId}|${index}`;
      movements.push(new CostMovement(id, sku, branch, date, 'sale', qm, 0, `sale|${invoiceNo}|${invoiceId}|${String(index).padStart(4, '0')}`, { type: 'invoice', id: invoiceId, no: invoiceNo, line: index }));
      const key = `${branch}|${invoiceId}|${sku}`;
      const list = saleLines.get(key);
      if (list) list.push(id); else saleLines.set(key, [id]);
    });
  }
  // Returned goods on a live credit note (reason "รับคืนสินค้า") come back at the cost they left with.
  for (const note of Array.isArray(input.creditNotes) ? input.creditNotes : []) {
    if (!note || typeof note !== 'object' || note.reasonCode !== RETURN_REASON) continue;
    const branch = String(note._branch || note.branch || '');
    const date = typeof note.date === 'string' ? note.date.slice(0, 10) : '';
    if (!BRANCH_IDS.includes(branch) || !(dateNumber(date) > 0)) { issues.push({ code: 'credit_note_unplaced', ref: String(note.no || note.id || '') }); continue; }
    const noteId = String(note.id);
    const noteNo = String(note.no || '');
    (Array.isArray(note.returnItems) ? note.returnItems : []).forEach((item, index) => {
      const sku = stockSku(item?.productCode ?? item?.code, item?.product ?? item?.name);
      if (!sku) return;
      const qm = toQm(item?.qty);
      if (qm <= 0) return;
      const movement = new CostMovement(`return|${branch}|${noteId}|${index}`, sku, branch, date, 'sale_return', qm, 0, `return|${noteNo}|${noteId}|${String(index).padStart(4, '0')}`, { type: 'credit_note', id: noteId, no: noteNo, line: index, invoiceId: String(item.invoiceId ?? '') });
      movement.sources = saleLines.get(`${String(item.invoiceBranch || branch)}|${String(item.invoiceId ?? '')}|${sku}`) || [];
      movements.push(movement);
    });
  }
  for (const movement of movements) {
    const list = groups.get(movement.sku);
    if (list) list.push(movement); else groups.set(movement.sku, [movement]);
  }
  // With no cost history at all (a back-dated sale before the first receipt), an outflow uses the standard cost.
  const fallbackUc = new Map();
  for (const product of products) {
    if (!product || !isStockTrackedProduct(product)) continue;
    const sku = productSkuKey(product);
    if (sku && !fallbackUc.has(sku)) fallbackUc.set(sku, toUc(product.standardCost));
  }
  return { movements, groups, issues, fallbackUc };
}

// ---------------------------------------------------------------- the engine
// options: { settings (method / methodHistory), completionValues: Map(movementId → satang), fallbackUc: Map(sku → uc) }
// → { method timeline, results: Map(id → result), bySku: Map(sku → Map(branch → [result…])), states, negatives, flags }
// Sorts one product's movements into the engine order. Fast path (any realistic data): one numeric key per movement
// = (date × 100 + kind rank) × 2^20 + its index, sorted as a Float64Array (exact: < 2^53); runs with the same date
// and rank are then ordered by their stable text key (`tie`, then id). → { list: [movement], dates: [dateNum] }
const INDEX_BITS = 1048576;
function compareTie(a, b) {
  if (a.tie !== b.tie) return a.tie < b.tie ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}
function sortMovements(list) {
  const n = list.length;
  const buffer = new Float64Array(n * 2);
  const dates = buffer.subarray(0, n);
  const keys = buffer.subarray(n, 2 * n);
  for (let i = 0; i < n; i += 1) {
    const movement = list[i];
    // CostMovement carries the date number (`d`); a plain object made by hand is parsed here.
    const d = typeof movement.d === 'number' ? movement.d : movement.date ? dateNumber(movement.date) : 0;
    if (d !== d) throw new Error(`costing: movement ${movement.id} has no valid date`);
    dates[i] = d;
    keys[i] = (d * 100 + RANK_OF.get(movement.kind)) * INDEX_BITS + i;
  }
  const sortedList = new Array(n);
  const sortedDates = new Array(n);
  if (n >= INDEX_BITS) {
    const order = Array.from({ length: n }, (_, i) => i);
    order.sort((a, b) => (Math.floor(keys[a] / INDEX_BITS) - Math.floor(keys[b] / INDEX_BITS)) || compareTie(list[a], list[b]));
    for (let i = 0; i < n; i += 1) { sortedList[i] = list[order[i]]; sortedDates[i] = dates[order[i]]; }
    return { list: sortedList, dates: sortedDates };
  }
  keys.sort();
  let runStart = 0;
  for (let i = 0; i <= n; i += 1) {
    const base = i < n ? Math.floor(keys[i] / INDEX_BITS) : NaN;
    if (i > runStart && (i === n || base !== Math.floor(keys[runStart] / INDEX_BITS))) {
      if (i - runStart === 1) {
        const only = keys[runStart] % INDEX_BITS;
        sortedList[runStart] = list[only];
        sortedDates[runStart] = dates[only];
      } else {
        const run = [];
        for (let j = runStart; j < i; j += 1) run.push(keys[j] % INDEX_BITS);
        run.sort((a, b) => compareTie(list[a], list[b]));
        for (let j = 0; j < run.length; j += 1) { sortedList[runStart + j] = list[run[j]]; sortedDates[runStart + j] = dates[run[j]]; }
      }
      runStart = i;
    }
  }
  return { list: sortedList, dates: sortedDates };
}
// One product-branch. Moving average: q / v = quantity and value on hand (q < 0 = units owed). FIFO: q / v = the sum
// of the layers from `head` on (kept up to date, so reading the balance never walks the layers); negQ / negV = units
// owed by a negative balance and their provisional value.
function newState(method) {
  return { method, q: 0, v: 0, layers: [], head: 0, negQ: 0, negV: 0, lastUc: null };
}
// Balance (qm, satang) of a state whatever its method.
function balanceQ(state) {
  return state.method === 'fifo' ? state.q - state.negQ : state.q;
}
function balanceV(state) {
  return state.method === 'fifo' ? state.v - state.negV : state.v;
}
function balanceOf(state) {
  return { q: balanceQ(state), v: balanceV(state) };
}
// Method change at a date: the stock is carried over at its value (one FIFO layer / one average).
function convertState(state, method) {
  if (state.method === method) return;
  const { q, v } = balanceOf(state);
  state.method = method;
  state.q = 0; state.v = 0; state.layers = []; state.head = 0; state.negQ = 0; state.negV = 0;
  if (method === 'fifo') {
    if (q > 0) { state.layers.push({ q, v, src: 'carried' }); state.q = q; state.v = v; }
    else if (q < 0) { state.negQ = -q; state.negV = -v; }
  } else {
    state.q = q; state.v = v;
  }
}
// Current unit cost of a state: the average (moving average) / the next FIFO layer; null when nothing is on hand.
function currentUc(state) {
  if (state.method === 'fifo') {
    const layer = state.layers[state.head];
    return layer ? unitCostOf(layer.v, layer.q) : null;
  }
  return state.q > 0 ? unitCostOf(state.v, state.q) : null;
}
// ---- inflow: value `v` for `q`. Units owed by an earlier negative balance are covered first, at the cost of the
// arriving goods; the difference against their provisional cost is the correction (+ = more cost of sales).
function inflow(state, q, v, src) {
  let correction = 0;
  let restQ = q;
  let restV = v;
  if (state.method === 'fifo') {
    if (state.negQ > 0) {
      const covered = Math.min(restQ, state.negQ);
      const provisional = shareOf(state.negV, covered, state.negQ);
      const actual = shareOf(restV, covered, restQ);
      correction = actual - provisional;
      state.negQ -= covered;
      state.negV -= provisional;
      restQ -= covered;
      restV -= actual;
    }
    if (restQ > 0) { state.layers.push({ q: restQ, v: restV, src }); state.q += restQ; state.v += restV; }
  } else {
    if (state.q < 0) {
      const owed = -state.q;
      const covered = Math.min(restQ, owed);
      const provisional = shareOf(-state.v, covered, owed);
      const actual = shareOf(restV, covered, restQ);
      correction = actual - provisional;
      state.q += covered;
      state.v += provisional;
      restQ -= covered;
      restV -= actual;
    }
    state.q += restQ;
    state.v += restV;
  }
  if (q > 0) state.lastUc = unitCostOf(v, q);
  return correction;
}
// ---- outflow of `q`: writes OUT = { value (satang ≥ 0), negative, costSource } (one shared holder, no allocation).
const OUT = { value: 0, negative: false, costSource: '' };
function setOut(value, negative, costSource) {
  OUT.value = value;
  OUT.negative = negative;
  OUT.costSource = costSource;
  return OUT;
}
function outflow(state, q, fallbackUc) {
  if (state.method === 'fifo') {
    let remaining = q;
    let value = 0;
    while (remaining > 0 && state.head < state.layers.length) {
      const layer = state.layers[state.head];
      if (layer.q <= remaining) {
        value += layer.v;
        remaining -= layer.q;
        state.q -= layer.q;
        state.v -= layer.v;
        state.lastUc = unitCostOf(layer.v, layer.q);
        state.head += 1;
      } else {
        const part = shareOf(layer.v, remaining, layer.q);
        state.lastUc = unitCostOf(layer.v, layer.q);
        value += part;
        layer.q -= remaining;
        layer.v -= part;
        state.q -= remaining;
        state.v -= part;
        remaining = 0;
      }
    }
    if (state.head > 64 && state.head * 2 > state.layers.length) { state.layers = state.layers.slice(state.head); state.head = 0; }
    let negative = false;
    let costSource = 'fifo';
    if (remaining > 0) {
      const uc = state.lastUc ?? fallbackUc;
      costSource = state.lastUc !== null ? 'last_known' : 'standard';
      const owedValue = valueOfQty(remaining, uc ?? 0);
      value += owedValue;
      state.negQ += remaining;
      state.negV += owedValue;
      negative = true;
    }
    return setOut(value, negative, costSource);
  }
  if (state.q >= q && state.q > 0) {
    const uc = unitCostOf(state.v, state.q);
    const value = q === state.q ? state.v : valueOfQty(q, uc);
    state.q -= q;
    state.v -= value;
    state.lastUc = uc;
    return setOut(value, false, 'average');
  }
  // Not enough on hand: what is there leaves at its value, the rest at the last known cost (else standard cost).
  const known = state.q > 0 ? unitCostOf(state.v, state.q) : state.lastUc;
  const uc = known ?? fallbackUc ?? 0;
  const value = state.q > 0 ? state.v + valueOfQty(q - state.q, uc) : valueOfQty(q, uc);
  state.q -= q;
  state.v -= value;
  if (known !== null) state.lastUc = known;
  return setOut(value, true, known !== null ? 'last_known' : 'standard');
}
// ---- a goods-receipt reversal: back out at the receipt's own cost.
//   moving average: q × the receipt's unit cost (the whole remaining value when it empties the stock); if that
//   would leave a negative value on positive stock (the average fell since), it leaves at the average instead.
//   FIFO: from the receipt's own layer first (its exact share), the rest in FIFO order.
function reversal(state, q, receiptUc, sourceId, fallbackUc) {
  if (state.method === 'fifo') {
    let value = 0;
    let remaining = q;
    for (let i = state.head; i < state.layers.length && remaining > 0; i += 1) {
      const layer = state.layers[i];
      if (layer.src !== sourceId || layer.q <= 0) continue;
      const take = Math.min(layer.q, remaining);
      const part = shareOf(layer.v, take, layer.q);
      layer.q -= take;
      layer.v -= part;
      state.q -= take;
      state.v -= part;
      value += part;
      remaining -= take;
      if (layer.q === 0) { state.layers.splice(i, 1); i -= 1; }
    }
    if (remaining > 0) {
      outflow(state, remaining, fallbackUc);
      return setOut(value + OUT.value, OUT.negative, OUT.negative ? OUT.costSource : 'receipt');
    }
    return setOut(value, false, 'receipt');
  }
  if (state.q >= q && state.q > 0) {
    if (q === state.q) {
      const value = state.v;
      state.q = 0;
      state.v = 0;
      return setOut(value, false, 'receipt');
    }
    const atReceipt = valueOfQty(q, receiptUc);
    if (state.v - atReceipt >= 0) {
      state.q -= q;
      state.v -= atReceipt;
      return setOut(atReceipt, false, 'receipt');
    }
  }
  outflow(state, q, fallbackUc);
  return setOut(OUT.value, OUT.negative, OUT.negative ? OUT.costSource : 'average');
}

// ---- results. The engine keeps one product's figures in typed arrays (600,000 movements cost no garbage); a row
// object is made only when someone reads it (stock card, cost of an invoice line, …) and then cached.
const COST_SOURCES = Object.freeze(['', 'opening', 'receipt', 'average', 'fifo', 'last_known', 'standard', 'transfer', 'original_issue', 'job', 'job_pending']);
const COST_SOURCE_CODE = new Map(COST_SOURCES.map((name, index) => [name, index]));
const [SRC_OPENING, SRC_RECEIPT, SRC_AVERAGE, SRC_FIFO, SRC_LAST_KNOWN, SRC_STANDARD, SRC_TRANSFER, SRC_ORIGINAL, SRC_JOB, SRC_JOB_PENDING] = COST_SOURCES.slice(1).map(name => COST_SOURCE_CODE.get(name));
const EMPTY_REF = Object.freeze({});
const INFLOW_RANKS = new Set(INFLOW_KINDS);
class CostResult {
  constructor(sku, index) {
    const m = sku.list[index];
    this.id = m.id;
    this.seq = index;
    this.sku = sku.sku;
    this.branch = m.branch;
    this.date = m.date;
    this.dateNum = sku.dates[index];
    this.kind = m.kind;
    this.method = sku.methods[index] === 1 ? 'fifo' : 'moving_average';
    this.qm = m.qm;
    this.signedQm = INFLOW_RANKS.has(m.kind) ? m.qm : -m.qm;
    this.value = sku.value[index];
    this.correction = sku.correction[index];
    this.balanceQm = sku.balQ[index];
    this.balanceValue = sku.balV[index];
    this.negative = sku.negative[index] === 1;
    this.costSource = COST_SOURCES[sku.source[index]];
    this.flags = sku.flagsAt.get(index) || null;
    this.ref = m.ref || EMPTY_REF;
  }
  get qty() { return qmToQty(this.qm); }
  get uc() { return unitCostOf(Math.abs(this.value), this.qm); }
  get unitCost() { return ucToBaht(this.uc); }
  get averageUc() { return this.balanceQm > 0 ? unitCostOf(this.balanceValue, this.balanceQm) : null; }
}
// One product's costing. get(branch) → that branch's rows in engine order (made on first use), like a Map.
class SkuCosting {
  constructor(sku, list, dates) {
    const n = list.length;
    this.sku = sku;
    this.list = list;
    this.dates = dates;
    // One buffer per kind of number (4 money/quantity columns, 3 small codes): two allocations per product.
    const numbers = new Float64Array(n * 4);
    const codes = new Uint8Array(n * 3);
    this.value = numbers.subarray(0, n);
    this.correction = numbers.subarray(n, 2 * n);
    this.balQ = numbers.subarray(2 * n, 3 * n);
    this.balV = numbers.subarray(3 * n, 4 * n);
    this.negative = codes.subarray(0, n);
    this.source = codes.subarray(n, 2 * n);
    this.methods = codes.subarray(2 * n, 3 * n);
    this.flagsAt = new Map();
    this.branchIndex = new Map();
    this.cache = null;
    this.branchRows = new Map();
  }
  flag(index, code) {
    const list = this.flagsAt.get(index);
    if (list) list.push(code); else this.flagsAt.set(index, [code]);
  }
  row(index) {
    if (!this.cache) this.cache = new Array(this.list.length);
    return this.cache[index] || (this.cache[index] = new CostResult(this, index));
  }
  get(branch) {
    let rows = this.branchRows.get(branch);
    if (!rows) {
      rows = (this.branchIndex.get(branch) || []).map(index => this.row(index));
      this.branchRows.set(branch, rows);
    }
    return rows;
  }
  branches() {
    return [...this.branchIndex.keys()];
  }
  *rows() {
    for (let index = 0; index < this.list.length; index += 1) yield this.row(index);
  }
}

export function runCosting(movementsInput, options = {}) {
  if (movementsInput instanceof Map) return runCostingGroups(movementsInput, options);
  const groups = new Map();
  for (const movement of Array.isArray(movementsInput) ? movementsInput : []) {
    if (!movement || !RANK_OF.has(movement.kind)) continue;
    const list = groups.get(movement.sku);
    if (list) list.push(movement); else groups.set(movement.sku, [movement]);
  }
  return runCostingGroups(groups, options);
}
// The same, for movements already grouped by product (Map sku → [CostMovement]) — what buildCostingMovements returns
// as `groups`, so a recompute does not have to group 600,000 movements again.
export function runCostingGroups(groups, options = {}) {
  const timeline = methodTimeline(options.settings || {});
  const methodAt = methodAtFactory(timeline);
  const singleMethod = timeline.length === 1 ? timeline[0].method : '';
  const completionValues = options.completionValues instanceof Map ? options.completionValues : new Map();
  const fallbackUc = options.fallbackUc instanceof Map ? options.fallbackUc : new Map();
  const bySku = new Map();
  const states = new Map();
  const negatives = [];
  const flags = [];
  const skus = [...groups.keys()].sort();
  for (const sku of skus) {
    const group = groups.get(sku);
    const sorted = sortMovements(group);
    const out = new SkuCosting(sku, sorted.list, sorted.dates);
    // Movements other movements point at (a credit-note return → its sale, a job return → its issue, a reversal →
    // its receipt); only those are kept in a lookup (id → index) while the product is costed.
    const wanted = new Set();
    for (const m of group) {
      if (m.source) wanted.add(m.source);
      if (m.sources) for (const id of m.sources) wanted.add(id);
    }
    const indexOf = new Map();
    const branchStates = new Map();
    const transferOut = new Map();
    const fallback = fallbackUc.get(sku) ?? null;
    const n = sorted.list.length;
    let lastBranch = null;
    let state = null;
    let indices = null;
    for (let i = 0; i < n; i += 1) {
      const m = sorted.list[i];
      const method = singleMethod || methodAt(sorted.dates[i]);
      if (m.branch !== lastBranch) {
        lastBranch = m.branch;
        state = branchStates.get(m.branch);
        if (!state) { state = newState(method); branchStates.set(m.branch, state); }
        indices = out.branchIndex.get(m.branch);
        if (!indices) { indices = []; out.branchIndex.set(m.branch, indices); }
      }
      if (state.method !== method) convertState(state, method);
      let value = 0;
      let correction = 0;
      let negative = false;
      let source = 0;
      if (m.kind === 'opening' || m.kind === 'receipt') {
        value = valueOfQty(m.qm, m.uc || 0);
        source = m.kind === 'opening' ? SRC_OPENING : SRC_RECEIPT;
        correction = inflow(state, m.qm, value, m.id);
      } else if (m.kind === 'adjust_in') {
        const now = currentUc(state);
        const uc = now ?? state.lastUc ?? (m.uc || fallback || 0);
        value = valueOfQty(m.qm, uc);
        source = now !== null ? (method === 'fifo' ? SRC_FIFO : SRC_AVERAGE) : state.lastUc !== null ? SRC_LAST_KNOWN : SRC_STANDARD;
        correction = inflow(state, m.qm, value, m.id);
      } else if (m.kind === 'transfer_in') {
        const queue = transferOut.get(m.pairKey);
        const pair = queue && queue.length ? queue.shift() : null;
        if (pair) {
          value = shareOf(pair.value, m.qm, pair.qm);
          source = SRC_TRANSFER;
        } else {
          const uc = currentUc(state) ?? state.lastUc ?? (m.uc || fallback || 0);
          value = valueOfQty(m.qm, uc);
          source = SRC_STANDARD;
          out.flag(i, 'transfer_pair_missing');
        }
        correction = inflow(state, m.qm, value, m.id);
      } else if (m.kind === 'sale_return' || m.kind === 'job_return') {
        const sources = m.kind === 'sale_return' ? (m.sources || []) : (m.source ? [m.source] : []);
        let srcQ = 0;
        let srcV = 0;
        for (const id of sources) {
          const at = indexOf.get(id);
          if (at === undefined) continue;
          srcQ += sorted.list[at].qm;
          srcV += -out.value[at];
        }
        if (srcQ > 0) {
          value = srcQ === m.qm ? srcV : valueOfQty(m.qm, unitCostOf(srcV, srcQ));
          source = SRC_ORIGINAL;
        } else {
          const uc = currentUc(state) ?? state.lastUc ?? fallback ?? 0;
          value = valueOfQty(m.qm, uc);
          source = SRC_AVERAGE;
          out.flag(i, 'return_source_missing');
        }
        correction = inflow(state, m.qm, value, m.id);
      } else if (m.kind === 'job_completion') {
        if (completionValues.has(m.id)) { value = completionValues.get(m.id); source = SRC_JOB; }
        else { value = 0; source = SRC_JOB_PENDING; out.flag(i, 'job_cost_pending'); }
        correction = inflow(state, m.qm, value, m.id);
      } else if (m.kind === 'receipt_reversal') {
        const at = m.source ? indexOf.get(m.source) : undefined;
        const receiptUc = at !== undefined ? unitCostOf(out.value[at], sorted.list[at].qm) : (m.uc || 0);
        reversal(state, m.qm, receiptUc, m.source || '', fallback);
        value = OUT.value ? -OUT.value : 0;
        negative = OUT.negative;
        source = COST_SOURCE_CODE.get(OUT.costSource) || 0;
      } else {
        outflow(state, m.qm, fallback);
        value = OUT.value ? -OUT.value : 0;
        negative = OUT.negative;
        source = COST_SOURCE_CODE.get(OUT.costSource) || 0;
        if (m.kind === 'transfer_out') {
          const queue = transferOut.get(m.pairKey);
          if (queue) queue.push({ qm: m.qm, value: OUT.value }); else transferOut.set(m.pairKey, [{ qm: m.qm, value: OUT.value }]);
        }
      }
      out.value[i] = value;
      out.correction[i] = correction;
      out.balQ[i] = balanceQ(state);
      out.balV[i] = balanceV(state);
      out.source[i] = source;
      out.methods[i] = method === 'fifo' ? 1 : 0;
      if (negative) { out.negative[i] = 1; out.flag(i, 'negative_stock'); }
      if (correction) out.flag(i, 'negative_stock_corrected');
      if (wanted.size && wanted.has(m.id)) indexOf.set(m.id, i);
      indices.push(i);
    }
    for (const index of out.flagsAt.keys()) {
      const row = out.row(index);
      flags.push(row);
      if (row.negative) negatives.push(row);
    }
    bySku.set(sku, out);
    states.set(sku, branchStates);
  }
  const result = { version: COSTING_CORE_VERSION, timeline, bySku, states, negatives, flags };
  // results: Map(id → row) of every movement, built on first use (most callers only read one product or the totals).
  let index = null;
  Object.defineProperty(result, 'results', { enumerable: true, get() {
    if (!index) {
      index = new Map();
      for (const row of costRows(result)) index.set(row.id, row);
    }
    return index;
  } });
  return result;
}
// Every costed row (product by product, in engine order).
export function* costRows(result) {
  for (const sku of result.bySku.values()) yield* sku.rows();
}

// Satang sum of the layers / average of one product-branch state — equal to its last result's balanceValue.
export function stateLayersValue(state) {
  return balanceOf(state).v;
}
export function stateLayers(state) {
  if (!state) return [];
  if (state.method === 'fifo') {
    const layers = state.layers.slice(state.head).map(layer => ({ qm: layer.q, value: layer.v, src: layer.src }));
    if (state.negQ > 0) layers.push({ qm: -state.negQ, value: -state.negV, src: 'owed' });
    return layers;
  }
  return state.q !== 0 || state.v !== 0 ? [{ qm: state.q, value: state.v, src: 'average' }] : [];
}

// ---------------------------------------------------------------- the whole computation (with job completions)
// Finished goods completed from a job are valued at the job's cost, and the job's cost comes from the materials the
// engine costs — so the engine runs, the job costs are computed (callback), and the engine runs again with those
// values, until nothing changes (normally one extra pass; at most MAX_PASSES).
export const MAX_COSTING_PASSES = 6;
export function computeInventoryCosting(movements, options = {}) {
  const lists = movements instanceof Map ? [...movements.values()] : [Array.isArray(movements) ? movements : []];
  const hasCompletions = lists.some(list => list.some(m => m?.kind === 'job_completion'));
  const completionValuesOf = typeof options.completionValuesOf === 'function' ? options.completionValuesOf : null;
  let values = options.completionValues instanceof Map ? options.completionValues : new Map();
  let result = runCosting(movements, { ...options, completionValues: values });
  if (!hasCompletions || !completionValuesOf) return { ...result, passes: 1, converged: true };
  for (let pass = 2; pass <= MAX_COSTING_PASSES; pass += 1) {
    const next = completionValuesOf(result);
    if (sameValueMap(next, values)) return { ...result, passes: pass - 1, converged: true };
    values = next;
    result = runCosting(movements, { ...options, completionValues: values });
  }
  const last = completionValuesOf(result);
  return { ...result, passes: MAX_COSTING_PASSES, converged: sameValueMap(last, values) };
}
function sameValueMap(a, b) {
  if (!(a instanceof Map) || !(b instanceof Map) || a.size !== b.size) return false;
  for (const [key, value] of a) if (b.get(key) !== value) return false;
  return true;
}

// ---------------------------------------------------------------- reading results
// Last index (in `indices`, engine order = date order) whose date is on or before `dateNum`; −1 when none.
function lastIndexOnOrBefore(dates, indices, dateNum) {
  let lo = 0;
  let hi = indices.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[indices[mid]] <= dateNum) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}
// Quantity and value of every product-branch at the end of `date` → [{ sku, branch, qm, qty, value, uc }]
export function valuationAt(result, date, options = {}) {
  const dateNum = dateNumber(date);
  if (!Number.isFinite(dateNum)) throw new Error('costing: valuation date is not a valid date');
  const branches = options.branch && options.branch !== 'all' ? [options.branch] : BRANCH_IDS;
  const out = [];
  for (const [sku, costing] of result.bySku) {
    for (const branch of branches) {
      const indices = costing.branchIndex.get(branch);
      if (!indices || !indices.length) continue;
      const at = lastIndexOnOrBefore(costing.dates, indices, dateNum);
      if (at < 0) continue;
      const i = indices[at];
      const qm = costing.balQ[i];
      const value = costing.balV[i];
      if (qm === 0 && value === 0) continue;
      out.push({ sku, branch, qm, qty: qmToQty(qm), value, uc: qm > 0 ? unitCostOf(value, qm) : null });
    }
  }
  out.sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : a.branch < b.branch ? -1 : a.branch > b.branch ? 1 : 0));
  return out;
}
export function valuationTotal(rows) {
  return (Array.isArray(rows) ? rows : []).reduce((sum, row) => sum + row.value, 0);
}
// The stock card (การ์ดสินค้า) of one product for one branch or the whole company ('all'), from..to inclusive:
// { opening: { qm, value }, rows: [{ …result, runQm, runValue }], closing: { qm, value }, totals: { inQm, inValue,
// outQm, outValue, correction } }. With 'all', a transfer between the branches shows both legs (they cancel out).
export function stockCard(result, options = {}) {
  const perBranch = result.bySku.get(options.sku);
  const branches = options.branch && options.branch !== 'all' ? [options.branch] : BRANCH_IDS;
  const from = options.from ? dateNumber(options.from) : 0;
  const to = options.to ? dateNumber(options.to) : 99991231;
  if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error('costing: stock card dates are not valid');
  const empty = { opening: { qm: 0, value: 0 }, rows: [], closing: { qm: 0, value: 0 }, totals: { inQm: 0, inValue: 0, outQm: 0, outValue: 0, correction: 0 } };
  if (!perBranch) return empty;
  const merged = [];
  let openQ = 0;
  let openV = 0;
  for (const branch of branches) {
    const rows = perBranch.get(branch) || [];
    for (const row of rows) {
      if (row.dateNum < from) {
        openQ += row.signedQm;
        openV += row.value - row.correction;
        continue;
      }
      if (row.dateNum > to) continue;
      merged.push(row);
    }
  }
  // The exact order the engine used (its sequence number within the product).
  merged.sort((a, b) => a.seq - b.seq);
  let runQ = openQ;
  let runV = openV;
  const totals = { inQm: 0, inValue: 0, outQm: 0, outValue: 0, correction: 0 };
  const rows = merged.map(row => {
    runQ += row.signedQm;
    runV += row.value - row.correction;
    if (row.signedQm > 0) { totals.inQm += row.qm; totals.inValue += row.value; } else { totals.outQm += row.qm; totals.outValue += -row.value; }
    totals.correction += row.correction;
    return { ...row, runQm: runQ, runValue: runV };
  });
  return { opening: { qm: openQ, value: openV }, rows, closing: { qm: runQ, value: runV }, totals };
}
// Cost of goods sold of every invoice line: Map(`${branch}|${invoiceId}|${line}` → { qm, value (satang > 0) }).
export function cogsByInvoiceLine(result) {
  const out = new Map();
  for (const row of costRows(result)) {
    if (row.kind !== 'sale') continue;
    out.set(`${row.branch}|${row.ref.id}|${row.ref.line}`, { qm: row.qm, value: -row.value, negative: row.negative });
  }
  return out;
}
// Cost of goods that came back on a credit note: Map(`${branch}|${creditNoteId}|${returnLine}` → satang > 0).
export function returnValueByCreditNoteLine(result) {
  const out = new Map();
  for (const row of costRows(result)) {
    if (row.kind !== 'sale_return') continue;
    out.set(`${row.branch}|${row.ref.id}|${row.ref.line}`, { qm: row.qm, value: row.value });
  }
  return out;
}
// Negative-stock corrections (cost of sales adjustments) with their date, branch and product.
export function negativeStockCorrections(result) {
  const out = [];
  for (const row of costRows(result)) if (row.correction) out.push({ id: row.id, sku: row.sku, branch: row.branch, date: row.date, value: row.correction });
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
  return out;
}

// ---------------------------------------------------------------- method lock
// The method is locked once anything has been costed (any movement exists). Changing it then needs the Revenue
// Department's approval (s.65 ทวิ (6)) and takes effect from a date in an open period — never retroactively.
export function isMethodLocked(movements) {
  return (Array.isArray(movements) ? movements : []).length > 0;
}
// change: { method, effectiveFrom, approvalRef, approvalDate, note }; context: { locked, today, isLocked(date) → bool,
// latestMovementDate } → { ok, error code, entry }
export function planMethodChange(settings = {}, change = {}, context = {}) {
  const current = currentMethodOf(settings);
  const method = change.method;
  if (!COSTING_METHODS.includes(method)) return { ok: false, error: 'invalid_method' };
  if (method === current) return { ok: false, error: 'same_method' };
  if (!context.locked) {
    return { ok: true, locked: false, settings: { ...settings, method, methodHistory: [{ method, effectiveFrom: '', approvalRef: '', approvalDate: '', note: String(change.note || '').trim(), at: String(context.at || ''), by: String(context.by || '') }] } };
  }
  const approvalRef = String(change.approvalRef || '').trim();
  const approvalDate = String(change.approvalDate || '').trim();
  const effectiveFrom = String(change.effectiveFrom || '').trim();
  if (!approvalRef || !isIsoDate(approvalDate)) return { ok: false, error: 'approval_required' };
  if (!isIsoDate(effectiveFrom)) return { ok: false, error: 'effective_date_required' };
  if (context.today && isIsoDate(context.today) && dateNumber(approvalDate) > dateNumber(context.today)) return { ok: false, error: 'approval_in_future' };
  if (dateNumber(effectiveFrom) < dateNumber(approvalDate)) return { ok: false, error: 'effective_before_approval' };
  const timeline = methodTimeline(settings);
  if (dateNumber(effectiveFrom) <= timeline[timeline.length - 1].from) return { ok: false, error: 'effective_before_previous_change' };
  if (typeof context.isLocked === 'function' && context.isLocked(effectiveFrom)) return { ok: false, error: 'period_locked' };
  const history = Array.isArray(settings.methodHistory) && settings.methodHistory.length ? settings.methodHistory.slice() : [{ method: current, effectiveFrom: '', approvalRef: '', approvalDate: '', note: '', at: '', by: '' }];
  const entry = { method, effectiveFrom, approvalRef, approvalDate, note: String(change.note || '').trim(), at: String(context.at || ''), by: String(context.by || '') };
  history.push(entry);
  return { ok: true, locked: true, entry, settings: { ...settings, method, methodHistory: history } };
}
export function currentMethodOf(settings = {}) {
  const timeline = methodTimeline(settings);
  return timeline[timeline.length - 1].method;
}

// ---------------------------------------------------------------- period-lock check of a recompute
// A change (a back-dated document, a new opening cost, a method change) recomputes everything after it. It is
// refused when any costed movement in a CLOSED period would change: compare the results before and after.
// isLocked(branch, date, scope) → true when that period is closed. → [{ id, branch, date, kind, scope, before, after }]
// The opening balance has no date: it is checked as of OPENING_LOCK_DATE, before any real document, so every lock of its
// branch covers it. 2 Jan 1970 (not earlier): erp-governance-core.js only accepts dates with a positive day ordinal.
export const OPENING_LOCK_DATE = '1970-01-02';
export function lockedCostChanges(before, after, isLocked) {
  if (typeof isLocked !== 'function') return [];
  const conflicts = [];
  const seen = new Set();
  const check = (id, a, b) => {
    const row = a || b;
    // The opening balance is before every period: it is inside any closed stock period of its branch.
    const date = row.date || OPENING_LOCK_DATE;
    if (!isLocked(row.branch, date, lockScopeOfKind(row.kind))) return;
    const same = a && b && a.value === b.value && a.qm === b.qm && a.correction === b.correction && a.kind === b.kind && a.branch === b.branch && a.date === b.date;
    if (!same) conflicts.push({ id, branch: row.branch, date, kind: row.kind, scope: lockScopeOfKind(row.kind), before: a ? a.value : null, after: b ? b.value : null });
  };
  for (const [id, a] of before.results) { seen.add(id); check(id, a, after.results.get(id)); }
  for (const [id, b] of after.results) if (!seen.has(id)) check(id, null, b);
  conflicts.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.id < y.id ? -1 : 1));
  return conflicts;
}

// ---------------------------------------------------------------- NRV (lower of cost and net realisable value)
// rows: valuation rows ({ sku, branch, qm, value }); inputs: { [sku]: { expectedPrice, costToSell } } (baht per unit,
// before VAT); products → names / default price. A product with no entered price uses its default selling price
// (marked `defaultPrice`) — the report says which. → { rows: [{ sku, branch, qty, cost, unitCost, expectedPrice,
// costToSell, nrvUnit, nrvValue, writeDown, priceSource }], totals: { cost, nrv, writeDown }, missing: [sku] }
export function buildNrvReport(valuationRows, inputs = {}, products = []) {
  const bySku = new Map();
  for (const product of Array.isArray(products) ? products : []) {
    const sku = productSkuKey(product);
    if (sku && !bySku.has(sku)) bySku.set(sku, product);
  }
  const rows = [];
  const missing = new Set();
  let costTotal = 0;
  let nrvTotal = 0;
  let writeDownTotal = 0;
  for (const row of Array.isArray(valuationRows) ? valuationRows : []) {
    if (row.qm <= 0) continue;
    const product = bySku.get(row.sku) || null;
    const entered = inputs && typeof inputs === 'object' ? inputs[row.sku] : null;
    const hasEntered = entered && entered.expectedPrice !== undefined && entered.expectedPrice !== null && entered.expectedPrice !== '' && Number.isFinite(Number(entered.expectedPrice));
    const defaultPrice = product && product.defaultPrice !== null && product.defaultPrice !== undefined && product.defaultPrice !== '' && Number.isFinite(Number(product.defaultPrice)) ? product.defaultPrice : null;
    if (!hasEntered && defaultPrice === null) { missing.add(row.sku); continue; }
    const priceSc = toSatang(hasEntered ? entered.expectedPrice : defaultPrice);
    const costToSellSc = toSatang(hasEntered ? entered.costToSell || 0 : 0);
    const nrvUnitSc = priceSc - costToSellSc;
    // NRV of the quantity = qty × (price − cost to sell), rounded once (qm × satang / 1,000).
    const nrvValue = mulDivRound(row.qm, nrvUnitSc, QTY_SCALE);
    // Inventory is never written below zero (a loss beyond its cost is a provision, not an inventory value).
    const writeDown = Math.min(row.value, Math.max(0, row.value - nrvValue));
    costTotal += row.value;
    nrvTotal += row.value - writeDown;
    writeDownTotal += writeDown;
    rows.push({ sku: row.sku, branch: row.branch, product, qm: row.qm, qty: qmToQty(row.qm), cost: row.value, unitCost: unitCostOf(row.value, row.qm), expectedPrice: priceSc, costToSell: costToSellSc, nrvUnit: nrvUnitSc, nrvValue, writeDown, belowCost: writeDown > 0, priceSource: hasEntered ? 'entered' : 'defaultPrice' });
  }
  return { rows, totals: { cost: costTotal, lowerOfCostAndNrv: nrvTotal, writeDown: writeDownTotal }, missing: [...missing].sort() };
}

// ---------------------------------------------------------------- settings store (comform_costing_settings_v1)
// { schemaVersion: 1, method, methodHistory: [...], labourRate (baht/hour), personRates: [{ name, rate }],
//   overhead: { estimatedOverhead, estimatedHours }, overheadCategories: [expense category], openingCosts: { sku: baht },
//   nrv: { sku: { expectedPrice, costToSell } }, updatedAt }
export const COSTING_SETTINGS_SCHEMA_VERSION = 1;
export function defaultCostingSettings() {
  return { schemaVersion: COSTING_SETTINGS_SCHEMA_VERSION, method: DEFAULT_COSTING_METHOD, methodHistory: [], labourRate: 0, personRates: [], overhead: { estimatedOverhead: 0, estimatedHours: 0 }, overheadCategories: [], openingCosts: {}, nrv: {}, updatedAt: '' };
}
const SETTINGS_FIELDS = Object.freeze(['schemaVersion', 'method', 'methodHistory', 'labourRate', 'personRates', 'overhead', 'overheadCategories', 'openingCosts', 'nrv', 'updatedAt']);
const finiteNonNegative = value => value !== '' && value !== null && Number.isFinite(Number(value)) && Number(value) >= 0;
const safeKey = key => typeof key === 'string' && key.length <= 300 && !['__proto__', 'prototype', 'constructor'].includes(key);
// Strict reader (fail-closed): anything malformed throws a Thai message; null / '' = never written → defaults.
export function normalizeCostingSettings(raw) {
  const fail = detail => { throw new Error(`ข้อมูลตั้งค่าต้นทุนไม่ถูกต้อง: ${detail} — ระบบหยุดเพื่อไม่ให้คิดต้นทุนผิด`); };
  if (raw === null || raw === undefined || raw === '') return defaultCostingSettings();
  let value = raw;
  if (typeof raw === 'string') { try { value = JSON.parse(raw); } catch (error) { fail(`อ่าน JSON ไม่ได้ (${error.message})`); } }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('ต้องเป็น object');
  for (const key of Object.keys(value)) if (!SETTINGS_FIELDS.includes(key)) fail(`ช่อง ${key}`);
  if (value.schemaVersion !== COSTING_SETTINGS_SCHEMA_VERSION) fail('schemaVersion');
  if (!COSTING_METHODS.includes(value.method)) fail('วิธีคิดต้นทุน');
  if (!Array.isArray(value.methodHistory)) fail('methodHistory');
  value.methodHistory.forEach((row, index) => {
    if (!row || typeof row !== 'object' || !COSTING_METHODS.includes(row.method)) fail(`methodHistory ${index + 1}`);
    if (index === 0 && row.effectiveFrom) fail('methodHistory 1 ต้องเริ่มตั้งแต่ต้น');
    if (index > 0 && (!isIsoDate(row.effectiveFrom) || !String(row.approvalRef || '').trim() || !isIsoDate(row.approvalDate))) fail(`methodHistory ${index + 1} ต้องมีวันที่มีผลและเลขที่หนังสืออนุมัติ`);
    if (index > 0 && dateNumber(row.effectiveFrom) <= (value.methodHistory[index - 1].effectiveFrom ? dateNumber(value.methodHistory[index - 1].effectiveFrom) : 0)) fail(`methodHistory ${index + 1} วันที่ต้องเรียงกัน`);
  });
  if (value.methodHistory.length && value.methodHistory[value.methodHistory.length - 1].method !== value.method) fail('method ไม่ตรงกับ methodHistory');
  if (!finiteNonNegative(value.labourRate)) fail('อัตราค่าแรง');
  if (!Array.isArray(value.personRates)) fail('personRates');
  const names = new Set();
  value.personRates.forEach((row, index) => {
    const name = String(row?.name || '').trim();
    if (!name || name.length > 120 || !finiteNonNegative(row?.rate)) fail(`personRates ${index + 1}`);
    if (names.has(name.toLowerCase())) fail(`ชื่อซ้ำ ${name}`);
    names.add(name.toLowerCase());
  });
  if (!value.overhead || typeof value.overhead !== 'object' || !finiteNonNegative(value.overhead.estimatedOverhead) || !finiteNonNegative(value.overhead.estimatedHours)) fail('ประมาณการโสหุ้ย');
  if (!Array.isArray(value.overheadCategories) || value.overheadCategories.some(cat => typeof cat !== 'string' || !cat.trim() || cat.length > 120)) fail('หมวดค่าใช้จ่ายโสหุ้ย');
  if (!value.openingCosts || typeof value.openingCosts !== 'object' || Array.isArray(value.openingCosts)) fail('openingCosts');
  for (const [key, cost] of Object.entries(value.openingCosts)) if (!safeKey(key) || !finiteNonNegative(cost)) fail(`ต้นทุนยกมา ${key}`);
  if (!value.nrv || typeof value.nrv !== 'object' || Array.isArray(value.nrv)) fail('nrv');
  for (const [key, row] of Object.entries(value.nrv)) {
    if (!safeKey(key) || !row || typeof row !== 'object' || !finiteNonNegative(row.expectedPrice) || !(row.costToSell === undefined || finiteNonNegative(row.costToSell))) fail(`NRV ${key}`);
  }
  return {
    schemaVersion: COSTING_SETTINGS_SCHEMA_VERSION,
    method: value.method,
    methodHistory: value.methodHistory.map(row => ({ method: row.method, effectiveFrom: String(row.effectiveFrom || ''), approvalRef: String(row.approvalRef || ''), approvalDate: String(row.approvalDate || ''), note: String(row.note || ''), at: String(row.at || ''), by: String(row.by || '') })),
    labourRate: Number(value.labourRate),
    personRates: value.personRates.map(row => ({ name: String(row.name).trim(), rate: Number(row.rate) })),
    overhead: { estimatedOverhead: Number(value.overhead.estimatedOverhead), estimatedHours: Number(value.overhead.estimatedHours) },
    overheadCategories: value.overheadCategories.map(cat => cat.trim()),
    openingCosts: Object.fromEntries(Object.entries(value.openingCosts).map(([key, cost]) => [key, Number(cost)])),
    nrv: Object.fromEntries(Object.entries(value.nrv).map(([key, row]) => [key, { expectedPrice: Number(row.expectedPrice), costToSell: Number(row.costToSell || 0) }])),
    updatedAt: String(value.updatedAt || '')
  };
}
// Predetermined overhead rate (OpenStax, Principles of Managerial Accounting ch. 4): estimated overhead ÷ estimated
// activity (direct labour hours) → satang per hour, rounded once; 0 when no hours are estimated.
export function overheadRateSatang(overhead = {}) {
  const overheadSatang = toSatang(overhead.estimatedOverhead);
  const hoursQm = toQm(overhead.estimatedHours);
  if (hoursQm <= 0) return 0;
  return mulDivRound(overheadSatang, QTY_SCALE, hoursQm);
}
