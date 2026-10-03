// ERP 4.3.1 Step 2B — Master Data pure core
// DOM/storage/cloud independent helpers for Customer/Supplier/Product master data.
// Mutation helpers return new arrays so callers can decide when/how to persist.
import { roundMoneyValue, unitPriceForVatMode } from './erp-shared-core.js';

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isoNow(now) {
  if (typeof now === 'function') return String(now());
  if (now instanceof Date) return now.toISOString();
  if (typeof now === 'string' && now) return now;
  return new Date().toISOString();
}

// Default selling price (ราคาขายมาตรฐาน) is stored PRE-VAT (ก่อน VAT), the same
// basis as standardCost and the Business Rules suggested price. An empty value
// means "no default price" (null) and is different from a real price of 0.
//
// parseProductDefaultPrice returns { value, error }:
//   * empty (null/undefined/blank text)  → { value: null, error: '' }
//   * a finite number ≥ 0 (stored data)   → rounded half-up to satang
//   * text typed in the form or a CSV cell must be a plain amount: digits, or
//     digits with proper thousands groups ("25,900", "1,500.50"), optionally
//     after "฿". Malformed groups ("1,2,3"), spaces inside ("1 000"), signs,
//     exponents, "Infinity", Thai digits … → error 'invalid_defaultPrice'.
//   * text with more than 2 decimals ("12.345") is NOT rounded silently:
//     error 'invalid_defaultPrice_decimals'.
const PRICE_TEXT_PLAIN = /^\d+(?:\.\d+)?$/;
const PRICE_TEXT_GROUPED = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
export function parseProductDefaultPrice(value) {
  const invalid = { value: null, error: 'invalid_defaultPrice' };
  if (value === null || value === undefined) return { value: null, error: '' };
  if (typeof value === 'boolean') return invalid;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? { value: roundMoneyValue(value), error: '' } : invalid;
  }
  const text = String(value).trim().replace(/^฿\s*/, '');
  if (text === '' && String(value).trim() === '') return { value: null, error: '' };
  if (!PRICE_TEXT_PLAIN.test(text) && !PRICE_TEXT_GROUPED.test(text)) return invalid;
  const decimals = text.includes('.') ? text.split('.')[1].length : 0;
  if (decimals > 2) return { value: null, error: 'invalid_defaultPrice_decimals' };
  const n = Number(text.replace(/,/g, ''));
  return Number.isFinite(n) ? { value: roundMoneyValue(n), error: '' } : invalid;
}

// Accepts numbers and form/CSV text such as "1,500" or "฿ 1,500.50"; anything
// else returns null (validateProductMasterRecord reports non-empty invalid text).
export function normalizeProductDefaultPrice(value) {
  return parseProductDefaultPrice(value).value;
}

export function normalizeProductKey(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function defaultProductFlowType(row = {}) {
  if (String(row.category || '').includes('บริการ')) return 'service';
  return 'non_inventory';
}

export function defaultProductFulfillment(row = {}) {
  const flow = row.flowType || defaultProductFlowType(row);
  if (flow === 'service') return 'service';
  if (flow === 'non_inventory') return 'made_to_order';
  return 'stock';
}

export function contactHasRole(row, role) {
  return row?.role === role || row?.role === 'both';
}

export function selectContactRows(rows = [], options = {}) {
  const source = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const visible = options.includeArchived ? source : source.filter(row => row.active !== false);
  return [...visible].sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), 'th'));
}

export function findContactRow(rows = [], name, role = 'customer') {
  const key = normalizeProductKey(name);
  if (!key) return null;
  return selectContactRows(rows).find(row => normalizeProductKey(row?.name) === key && contactHasRole(row, role)) || null;
}

export function validateContactMasterRecord(record = {}) {
  const errors = [];
  if (!String(record.name || '').trim()) errors.push('name_required');
  const role = record.role || 'customer';
  if (!['customer', 'supplier', 'both'].includes(role)) errors.push('invalid_role');
  const creditDays = record.creditDays;
  if (creditDays !== undefined && creditDays !== '' && (!Number.isFinite(Number(creditDays)) || Number(creditDays) < 0)) errors.push('invalid_credit_days');
  if (record.supplierLeadDays !== undefined && !Array.isArray(record.supplierLeadDays)) errors.push('invalid_supplier_lead_days');
  return { valid: errors.length === 0, errors };
}

export function normalizeSupplierLeadDays(values = []) {
  const source = Array.isArray(values) ? values : String(values || '').split(/[,;|/\s]+/);
  return [...new Set(source.map(Number).filter(n => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
}

export function upsertContactRows(rows = [], record = {}, options = {}) {
  const validation = validateContactMasterRecord(record);
  if (!validation.valid) return { rows: Array.isArray(rows) ? [...rows] : [], row: null, created: false, reactivated: false, validation };

  // IMPORTANT: keep archived rows in the working set. Previous app.js logic used a
  // visible-only list and could silently erase archived history on the next save.
  const allRows = selectContactRows(rows, { includeArchived: true });
  const name = String(record.name || '').trim();
  const key = normalizeProductKey(name);
  const requestedRole = record.role || 'customer';
  const explicitId = record.id ? String(record.id) : '';
  let index = explicitId
    ? allRows.findIndex(row => String(row?.id || '') === explicitId)
    : allRows.findIndex(row => normalizeProductKey(row?.name) === key);

  const current = index >= 0 ? allRows[index] : {};
  let mergedRole = current.role || requestedRole;
  if (current.role && current.role !== requestedRole && current.role !== 'both') mergedRole = 'both';

  const timestamp = isoNow(options.now);
  const makeId = typeof options.idFactory === 'function'
    ? options.idFactory
    : () => `contact-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const reactivated = index >= 0 && current.active === false;
  const row = {
    id: current.id || record.id || makeId(),
    ...current,
    ...record,
    name,
    role: record.role === 'both' ? 'both' : mergedRole,
    active: record.active !== undefined ? record.active : true,
    updatedAt: timestamp,
    createdAt: current.createdAt || timestamp
  };
  if (reactivated && record.archivedAt === undefined) delete row.archivedAt;

  if (index >= 0) allRows[index] = row;
  else {
    allRows.push(row);
    index = allRows.length - 1;
  }
  return { rows: allRows, row, index, created: !current.id, reactivated, validation };
}

export function archiveContactRows(rows = [], id, role, options = {}) {
  const allRows = selectContactRows(rows, { includeArchived: true });
  const index = allRows.findIndex(row => String(row?.id || '') === String(id || ''));
  if (index < 0) return { rows: allRows, row: null, changed: false };

  const timestamp = isoNow(options.now);
  const row = { ...allRows[index] };
  if (row.role === 'both') {
    row.role = role === 'customer' ? 'supplier' : 'customer';
    row.active = row.active !== false;
  } else {
    row.active = false;
    row.archivedAt = timestamp;
  }
  row.updatedAt = timestamp;
  allRows[index] = row;
  return { rows: allRows, row, changed: true };
}

export function mergeMasterRows(localRows = [], cloudRows = [], kind = 'contact') {
  const keyOf = row => kind === 'product'
    ? normalizeProductKey(row?.code || row?.name)
    : String(row?.id || normalizeProductKey(row?.name));
  const map = new Map();
  [...(Array.isArray(localRows) ? localRows : []), ...(Array.isArray(cloudRows) ? cloudRows : [])].forEach(row => {
    if (!row) return;
    const key = keyOf(row);
    if (!key) return;
    const current = map.get(key);
    const currentTime = Date.parse(current?.updatedAt || current?.createdAt || 0) || 0;
    const rowTime = Date.parse(row?.updatedAt || row?.createdAt || 0) || 0;
    if (!current || rowTime >= currentTime) map.set(key, { ...current, ...row });
  });
  return [...map.values()];
}

export function buildProductMasterRows(seedRows = [], localRows = []) {
  const map = new Map();
  (Array.isArray(seedRows) ? seedRows : []).forEach((row, index) => {
    if (!row) return;
    const key = normalizeProductKey(row.code || row.name);
    if (!key) return;
    const flowType = row.flowType || defaultProductFlowType(row);
    const openingStockUbon = finiteNumber(row.openingStockUbon ?? row.openingStock);
    const openingStockKhonkaen = finiteNumber(row.openingStockKhonkaen);
    map.set(key, {
      id: `seed-${index + 1}`,
      ...row,
      unit: row.unit || 'ชิ้น',
      flowType,
      fulfillmentType: row.fulfillmentType || defaultProductFulfillment({ ...row, flowType }),
      openingStockUbon,
      openingStockKhonkaen,
      openingStock: openingStockUbon + openingStockKhonkaen,
      reorderPoint: finiteNumber(row.reorderPoint),
      standardCost: finiteNumber(row.standardCost),
      defaultPrice: normalizeProductDefaultPrice(row.defaultPrice),
      defaultSupplier: row.defaultSupplier || '',
      isSeed: true
    });
  });

  (Array.isArray(localRows) ? localRows : []).forEach(row => {
    if (!row) return;
    const key = normalizeProductKey(row.code || row.name);
    if (!key) return;
    const base = map.get(key) || {};
    const flowType = row.flowType || base.flowType || defaultProductFlowType(row);
    const openingStockUbon = finiteNumber(row.openingStockUbon ?? row.openingStock ?? base.openingStockUbon ?? base.openingStock);
    const openingStockKhonkaen = finiteNumber(row.openingStockKhonkaen ?? base.openingStockKhonkaen);
    map.set(key, {
      ...base,
      ...row,
      flowType,
      fulfillmentType: row.fulfillmentType || base.fulfillmentType || defaultProductFulfillment({ ...row, flowType }),
      unit: row.unit || base.unit || 'ชิ้น',
      openingStockUbon,
      openingStockKhonkaen,
      openingStock: openingStockUbon + openingStockKhonkaen,
      reorderPoint: finiteNumber(row.reorderPoint ?? base.reorderPoint),
      standardCost: finiteNumber(row.standardCost ?? base.standardCost),
      // A local row that explicitly clears the price (null) must override the seed.
      defaultPrice: normalizeProductDefaultPrice(Object.hasOwn(row, 'defaultPrice') ? row.defaultPrice : base.defaultPrice),
      isSeed: false
    });
  });

  return [...map.values()]
    .filter(row => row.active !== false)
    .sort((a, b) => String(a.code || a.name || '').localeCompare(String(b.code || b.name || ''), 'th'));
}

export function findProductMasterRow(rows = [], name = '', code = '') {
  const nameKey = normalizeProductKey(name);
  const codeKey = String(code || '').trim().toLowerCase();
  return (Array.isArray(rows) ? rows : []).find(row =>
    (nameKey && normalizeProductKey(row?.name) === nameKey) ||
    (codeKey && String(row?.code || '').toLowerCase() === codeKey)
  ) || null;
}

export function productMasterMetaFromRows(rows = [], name = '', code = '', category = '') {
  const found = findProductMasterRow(rows, name, code);
  const flowType = found?.flowType || 'non_inventory';
  return {
    productCode: code || found?.code || '',
    productCategory: category || found?.category || 'อื่น ๆ',
    productName: String(name || found?.name || '').trim(),
    flowType,
    fulfillmentType: found?.fulfillmentType || defaultProductFulfillment({ flowType }),
    unit: found?.unit || '',
    openingStock: finiteNumber(found?.openingStock),
    openingStockUbon: finiteNumber(found?.openingStockUbon ?? found?.openingStock),
    openingStockKhonkaen: finiteNumber(found?.openingStockKhonkaen),
    reorderPoint: finiteNumber(found?.reorderPoint),
    standardCost: finiteNumber(found?.standardCost),
    defaultPrice: normalizeProductDefaultPrice(found?.defaultPrice),
    defaultSupplier: found?.defaultSupplier || ''
  };
}

export function validateProductMasterRecord(record = {}) {
  const errors = [];
  if (!String(record.code || '').trim()) errors.push('code_required');
  if (!String(record.name || '').trim()) errors.push('name_required');
  if (record.flowType && !['inventory', 'non_inventory', 'service'].includes(record.flowType)) errors.push('invalid_flow_type');
  if (record.fulfillmentType && !['stock', 'made_to_order', 'service'].includes(record.fulfillmentType)) errors.push('invalid_fulfillment_type');
  for (const key of ['openingStockUbon', 'openingStockKhonkaen', 'reorderPoint', 'standardCost']) {
    if (record[key] !== undefined && record[key] !== '' && !Number.isFinite(Number(record[key]))) errors.push(`invalid_${key}`);
  }
  const priceError = parseProductDefaultPrice(record.defaultPrice).error;
  if (priceError) errors.push(priceError);
  return { valid: errors.length === 0, errors };
}

export function productMasterValidationMessage(errors = []) {
  const list = Array.isArray(errors) ? errors : [];
  if (list.includes('code_required') || list.includes('name_required')) return 'กรุณากรอกรหัสสินค้าและชื่อสินค้า';
  if (list.includes('invalid_defaultPrice')) return 'ราคาขายมาตรฐานต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป (หรือเว้นว่าง)';
  if (list.includes('invalid_defaultPrice_decimals')) return 'ราคาขายมาตรฐานมีทศนิยมได้ไม่เกิน 2 ตำแหน่ง (สตางค์) กรุณาแก้ไขตัวเลข';
  return list.length ? 'ข้อมูลสินค้าไม่ถูกต้อง กรุณาตรวจตัวเลขที่กรอก' : '';
}

// Decides whether choosing a product in a quote/invoice row may write the
// master default price into the row's unit-price cell.
//   * a truly empty cell is filled (a typed "0" is a price the user chose);
//   * a cell still holding the value this helper filled last time (the user
//     has not typed over it) follows the newly chosen product — and is cleared
//     if that product is in the master without a default price, so a stale
//     price never lingers;
//   * productFound === false (the name was edited to free text that is not in
//     the master) never changes the cell: there is no product to follow;
//   * any other value was typed (or set by the ⚙ ราคาแนะนำ button) and is kept.
//   * userOwned === true (the user typed in the cell, even the same number the
//     autofill wrote) makes a non-empty cell a user price: ownership comes from
//     the user's interaction, not from comparing numbers.
// The pre-VAT master price is converted to the form's VAT basis.
export function planProductDefaultPriceFill({ currentValue = '', lastAutoValue = '', defaultPrice = null, useVat = 0, productFound = true, userOwned = false } = {}) {
  const text = String(currentValue ?? '').replace(/,/g, '').trim();
  const current = Number(text);
  const last = String(lastAutoValue ?? '').trim() === '' ? NaN : Number(lastAutoValue);
  const empty = text === '';
  const stillAuto = !empty && userOwned !== true && Number.isFinite(current) && Number.isFinite(last) && roundMoneyValue(current) === roundMoneyValue(last);
  if (!empty && !stillAuto) return { fill: false, reason: 'user_price' };
  if (productFound === false) return { fill: false, reason: 'no_product' };
  const base = normalizeProductDefaultPrice(defaultPrice);
  const price = base === null || base <= 0 ? NaN : unitPriceForVatMode(base, useVat);
  if (!Number.isFinite(price)) return stillAuto ? { fill: true, value: '', base: null, reason: 'cleared' } : { fill: false, reason: 'no_default_price' };
  return { fill: true, value: price.toFixed(2), base, reason: stillAuto ? 'replaced_auto' : 'filled_empty' };
}

// ---------------------------------------------------------------- CSV import
// Header auto-mapping for the pre-VAT standard price. Only exact header names
// map (no substring guessing), and a header that looks VAT-inclusive or like a
// cost column is never taken, even if it matches an alias: importing
// "ราคาขายปลีก (รวม VAT)" or "cost price" as a pre-VAT selling price would
// overstate or understate every autofilled invoice.
export const PRODUCT_DEFAULT_PRICE_CSV_ALIASES = Object.freeze([
  'ราคาขายมาตรฐาน (ก่อน VAT)', 'ราคาขายมาตรฐาน', 'ราคาขาย',
  'default price', 'default_price', 'selling price', 'sale price'
]);
// Same normalization as app.js csvNormalizeHeader (lower case, no spaces/punctuation).
const csvHeaderKey = value => String(value ?? '').replace(/^\uFEFF/, '').toLowerCase().trim().replace(/[\s_\-\/().:]+/g, '');
const EXCLUDED_DEFAULT_PRICE_HEADER = /รวมvat|รวมภาษี|incl|cost|ทุน/;
// Alias priority (lower wins), independent of column order in the file:
//   0 — the template's explicit pre-VAT header;
//   1 — "standard / default price" names;
//   2 — generic "selling price" names. In Thai retail files a plain "ราคาขาย"
//       is often the VAT-inclusive shelf price, so it only maps when nothing
//       more explicit exists.
// Two or more columns at the best matching priority are ambiguous: the column
// is left unmapped (stored prices are kept) instead of guessing.
const PRODUCT_DEFAULT_PRICE_CSV_PRIORITY = Object.freeze({
  'ราคาขายมาตรฐาน (ก่อน VAT)': 0,
  'ราคาขายมาตรฐาน': 1, 'default price': 1, 'default_price': 1,
  'ราคาขาย': 2, 'selling price': 2, 'sale price': 2
});
export function findProductDefaultPriceCsvColumn(headers = []) {
  const rankByKey = new Map();
  for (const alias of PRODUCT_DEFAULT_PRICE_CSV_ALIASES) {
    const key = csvHeaderKey(alias), rank = PRODUCT_DEFAULT_PRICE_CSV_PRIORITY[alias] ?? 2;
    if (!rankByKey.has(key) || rank < rankByKey.get(key)) rankByKey.set(key, rank);
  }
  let best = Infinity, found = [];
  (Array.isArray(headers) ? headers : []).forEach((header, index) => {
    const key = csvHeaderKey(header);
    if (!rankByKey.has(key) || EXCLUDED_DEFAULT_PRICE_HEADER.test(key)) return;
    const rank = rankByKey.get(key);
    if (rank < best) { best = rank; found = [index]; }
    else if (rank === best) found.push(index);
  });
  return found.length === 1 ? found[0] : -1;
}

// The defaultPrice part of one CSV product row. A mapped column with a blank
// cell explicitly clears the price (null) so a merge can remove an old price;
// an unmapped column leaves the field out so the stored price is kept.
//   → { include: boolean, value: number|null, issue: '' | Thai message }
export function planProductCsvDefaultPrice({ mapped = false, text = '' } = {}) {
  if (!mapped) return { include: false, value: null, issue: '' };
  const parsed = parseProductDefaultPrice(String(text ?? '').trim());
  if (parsed.error) return { include: false, value: null, issue: productMasterValidationMessage([parsed.error]) };
  return { include: true, value: parsed.value, issue: '' };
}

export function customerCreditDaysFromTerm(term = '') {
  const map = { cash: 0, deposit50: 0, credit30: 30, credit60: 60, credit90: 90, credit120: 120, credit150: 150, credit180: 180 };
  return Object.prototype.hasOwnProperty.call(map, term) ? map[term] : 0;
}

export function customerCreditTermFromDays(days = 0) {
  const n = Number(days) || 0;
  return n >= 180 ? 'credit180'
    : n >= 150 ? 'credit150'
      : n >= 120 ? 'credit120'
        : n >= 90 ? 'credit90'
          : n >= 60 ? 'credit60'
            : n >= 30 ? 'credit30'
              : n === 0 ? 'cash' : '';
}


export function upsertProductRows(rows = [], record = {}, options = {}) {
  const validation = validateProductMasterRecord(record);
  if (!validation.valid) return { rows: Array.isArray(rows) ? [...rows] : [], row: null, created: false, reactivated: false, validation };
  const allRows = Array.isArray(rows) ? rows.filter(Boolean).map(row => ({ ...row })) : [];
  const key = normalizeProductKey(record.code || record.name);
  const explicitId = record.id ? String(record.id) : '';
  let index = explicitId
    ? allRows.findIndex(row => String(row?.id || '') === explicitId)
    : allRows.findIndex(row => normalizeProductKey(row.code || row.name) === key);
  const current = index >= 0 ? allRows[index] : {};
  const timestamp = isoNow(options.now);
  const makeId = typeof options.idFactory === 'function' ? options.idFactory : () => `product-${Date.now()}`;
  const reactivated = index >= 0 && current.active === false;
  const row = {
    ...current,
    ...record,
    id: current.id || record.id || makeId(),
    code: String(record.code || current.code || '').trim(),
    name: String(record.name || current.name || '').trim(),
    active: record.active !== undefined ? record.active : true,
    updatedAt: timestamp,
    createdAt: current.createdAt || record.createdAt || timestamp
  };
  if (reactivated && record.archivedAt === undefined) delete row.archivedAt;
  if (index >= 0) allRows[index] = row;
  else {
    allRows.push(row);
    index = allRows.length - 1;
  }
  return { rows: allRows, row, index, created: !current.id, reactivated, validation };
}

export function archiveProductRows(rows = [], codeOrName = '', fallbackRow = null, options = {}) {
  const allRows = Array.isArray(rows) ? rows.filter(Boolean).map(row => ({ ...row })) : [];
  const key = normalizeProductKey(codeOrName);
  let index = allRows.findIndex(row => normalizeProductKey(row.code || row.name) === key);
  let row = index >= 0 ? { ...allRows[index] } : (fallbackRow ? { ...fallbackRow } : null);
  if (!row) return { rows: allRows, row: null, changed: false };
  const timestamp = isoNow(options.now);
  delete row.isSeed;
  row.active = false;
  row.archivedAt = timestamp;
  row.updatedAt = timestamp;
  if (index >= 0) allRows[index] = row;
  else {
    allRows.push(row);
    index = allRows.length - 1;
  }
  return { rows: allRows, row, index, changed: true };
}

export function mergeProductImportRows(rows = [], records = [], mode = 'merge', options = {}) {
  let working = Array.isArray(rows) ? rows.filter(Boolean).map(row => ({ ...row })) : [];
  if (mode === 'replace') working = working.filter(row => row.active === false);
  const timestamp = isoNow(options.now);
  let createdIndex = 0;
  for (const record of (Array.isArray(records) ? records : [])) {
    if (!record || !normalizeProductKey(record.code || record.name)) continue;
    const result = upsertProductRows(working, record, {
      now: timestamp,
      idFactory: () => {
        const id = typeof options.idFactory === 'function'
          ? options.idFactory(createdIndex, record)
          : `product-import-${Date.now()}-${createdIndex}`;
        createdIndex += 1;
        return id;
      }
    });
    if (result.row) working = result.rows;
  }
  return working;
}

export function ensureSupplierSeedRows(rows = [], presets = [], options = {}) {
  const allRows = selectContactRows(rows, { includeArchived: true });
  // Seed only on a truly new supplier master. Archived suppliers count as existing
  // so a user who intentionally disabled all seed suppliers does not see them resurrected.
  if (allRows.some(row => contactHasRole(row, 'supplier'))) {
    return { rows: allRows, seeded: false, added: 0 };
  }
  const timestamp = isoNow(options.now);
  const seeds = (Array.isArray(presets) ? presets : []).filter(Boolean).map((preset, index) => ({
    id: `supplier-seed-${index + 1}`,
    name: String(preset.name || '').trim(),
    role: 'supplier',
    entityType: 'company',
    address: '',
    taxId: '',
    contactPerson: '',
    phone: '',
    email: '',
    supplierCreditTerm: preset.supplierCreditTerm || 'cash',
    supplierLeadDays: normalizeSupplierLeadDays(preset.leadDays || []),
    note: preset.note || '',
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp
  })).filter(row => row.name);
  return { rows: [...allRows, ...seeds], seeded: seeds.length > 0, added: seeds.length };
}

export function mergeContactImportRows(rows = [], type, records = [], mode = 'merge', options = {}) {
  let working = selectContactRows(rows, { includeArchived: true });
  const targetRole = type === 'supplier' ? 'supplier' : 'customer';

  if (mode === 'replace') {
    working = working.flatMap(row => {
      // Archived history is not part of the active replacement set and must survive.
      if (row.active === false) return [row];
      if (row.role === targetRole) return [];
      if (row.role === 'both') return [{ ...row, role: targetRole === 'customer' ? 'supplier' : 'customer' }];
      return [row];
    });
  }

  const timestamp = isoNow(options.now);
  let createdIndex = 0;
  for (const record of (Array.isArray(records) ? records : [])) {
    if (!record || !normalizeProductKey(record.name)) continue;
    const normalizedRecord = { ...record, role: record.role || targetRole };
    const result = upsertContactRows(working, normalizedRecord, {
      now: timestamp,
      idFactory: () => {
        const id = typeof options.idFactory === 'function'
          ? options.idFactory(createdIndex, normalizedRecord)
          : `contact-import-${Date.now()}-${createdIndex}`;
        createdIndex += 1;
        return id;
      }
    });
    working = result.rows;
  }
  return working;
}
