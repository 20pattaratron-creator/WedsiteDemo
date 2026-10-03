// Product master default selling price (ราคาขายมาตรฐาน) coverage:
//   * pure rules: normalization/validation (empty = none, 0 allowed, invalid
//     rejected), pre-VAT → row basis per VAT mode, the autofill decision,
//     seed/local merge, CSV import merge, message text
//   * seed data: every demo seed and trial preset product has a price and a
//     unit that the item-row unit selector can show
//   * jsdom flows: master form save/edit/clear/validate + list column, backup
//     round trip, CSV import, quote/invoice autofill that never overwrites a
//     user price, VAT re-base, unit fill, edit keeps stored prices
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { boot } = require('./dom-helper.cjs');

const ROOT = path.resolve(__dirname, '..');
const imp = file => import(pathToFileURL(path.join(ROOT, file)).href);
const PRODUCT = { id: 'DP-1', code: 'DP-1', name: 'สินค้าราคามาตรฐาน', category: 'ทดสอบ', unit: 'ชุด', flowType: 'non_inventory', fulfillmentType: 'made_to_order', defaultPrice: 1000 };
const NO_PRICE = { id: 'DP-2', code: 'DP-2', name: 'สินค้าไม่มีราคา', category: 'ทดสอบ', unit: 'งาน', flowType: 'service', fulfillmentType: 'service' };
const OTHER = { id: 'DP-3', code: 'DP-3', name: 'สินค้าราคาอื่น', category: 'ทดสอบ', unit: 'อัน', flowType: 'non_inventory', fulfillmentType: 'made_to_order', defaultPrice: 250.5 };
function fire(w, el, type = 'change') { el.dispatchEvent(new w.Event(type, { bubbles: true })); }
// app.js calls its own notify() (toast), not window.notify, so read both.
function notices(h) { return `${h.messages.join('\n')}\n${h.w.document.getElementById('app-toast-container')?.textContent || ''}`; }
function chooseProduct(w, row, name) { const input = row.querySelector('[data-field="product"]'); input.value = name; fire(w, input); return input; }

// ============================================================ pure rules
test('normalize/validate: empty means no price, 0 is a price, invalid text is rejected', async () => {
  const m = await imp('erp-master-data-core.js');
  for (const empty of [null, undefined, '', '   ']) assert.equal(m.normalizeProductDefaultPrice(empty), null);
  assert.equal(m.normalizeProductDefaultPrice(0), 0);
  assert.equal(m.normalizeProductDefaultPrice('0'), 0);
  assert.equal(m.normalizeProductDefaultPrice('1,500'), 1500);
  assert.equal(m.normalizeProductDefaultPrice('฿ 1,500.50'), 1500.5);
  assert.equal(m.normalizeProductDefaultPrice(1.005), 1.01, 'RD half-up rounding to satang');
  for (const bad of ['-5', -5, 'abc', '12abc', '1e3', '0x10', 'Infinity', NaN, Infinity, true]) assert.equal(m.normalizeProductDefaultPrice(bad), null, String(bad));
  const base = { code: 'A', name: 'B' };
  for (const ok of [undefined, null, '', 0, '0', 99.5, '1,200']) assert.equal(m.validateProductMasterRecord({ ...base, defaultPrice: ok }).valid, true, String(ok));
  for (const bad of ['-1', -1, 'abc', '1e3']) assert.deepEqual(m.validateProductMasterRecord({ ...base, defaultPrice: bad }).errors, ['invalid_defaultPrice'], String(bad));
  assert.equal(m.productMasterValidationMessage(['invalid_defaultPrice']), 'ราคาขายมาตรฐานต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป (หรือเว้นว่าง)');
  assert.equal(m.productMasterValidationMessage(['code_required', 'invalid_defaultPrice']), 'กรุณากรอกรหัสสินค้าและชื่อสินค้า');
  assert.equal(m.productMasterValidationMessage([]), '');
  assert.equal(m.productMasterValidationMessage(['invalid_standardCost']), 'ข้อมูลสินค้าไม่ถูกต้อง กรุณาตรวจตัวเลขที่กรอก');
});

test('pre-VAT master price converts to the row basis of each VAT mode', async () => {
  const s = await imp('erp-shared-core.js');
  assert.equal(s.unitPriceForVatMode(1000, 0), 1070, 'VAT-inclusive rows (ราคารวม VAT แล้ว)');
  assert.equal(s.unitPriceForVatMode(1000, '0'), 1070);
  assert.equal(s.unitPriceForVatMode(1000, 'extract'), 1070);
  assert.equal(s.unitPriceForVatMode(1000, 1), 1000, 'VAT-added rows take the pre-VAT price');
  assert.equal(s.unitPriceForVatMode(1000, 'add'), 1000);
  assert.equal(s.unitPriceForVatMode(1000, 2), 1000, 'non-VAT rows take the pre-VAT price');
  assert.equal(s.unitPriceForVatMode(1000, 'none'), 1000);
  assert.equal(s.unitPriceForVatMode(2390, 0), 2557.3);
  assert.equal(s.unitPriceForVatMode(0.05, 0), 0.05, '0.0535 rounds half-up to satang');
  for (const bad of [null, undefined, '', -1, 'x', NaN]) assert.ok(Number.isNaN(s.unitPriceForVatMode(bad, 0)), String(bad));
  // The filled VAT-inclusive price reproduces the master pre-VAT amount on the document.
  for (const price of [18500, 24900, 690, 2390, 1590, 850, 3990, 12500]) {
    const row = s.unitPriceForVatMode(price, 0);
    assert.equal(s.calculateVatSummary(row, 0).subtotal, price, String(price));
  }
});

test('autofill decision: fill empty, follow its own value, never overwrite a user price', async () => {
  const m = await imp('erp-master-data-core.js');
  const plan = over => m.planProductDefaultPriceFill({ defaultPrice: 1000, useVat: 1, ...over });
  assert.deepEqual(plan({ currentValue: '' }), { fill: true, value: '1000.00', base: 1000, reason: 'filled_empty' });
  // review#9: a typed 0 is a price the user chose (free item) — only a truly empty cell is filled.
  assert.deepEqual(plan({ currentValue: '0' }), { fill: false, reason: 'user_price' });
  assert.deepEqual(plan({ currentValue: '0.00', useVat: 0 }), { fill: false, reason: 'user_price' });
  assert.deepEqual(plan({ currentValue: '  ', useVat: 0 }), { fill: true, value: '1070.00', base: 1000, reason: 'filled_empty' });
  assert.deepEqual(plan({ currentValue: '999' }), { fill: false, reason: 'user_price' });
  assert.deepEqual(plan({ currentValue: '999', lastAutoValue: '1000.00' }), { fill: false, reason: 'user_price' });
  assert.deepEqual(plan({ currentValue: '-5' }), { fill: false, reason: 'user_price' });
  assert.deepEqual(plan({ currentValue: '250.50', lastAutoValue: '250.50' }), { fill: true, value: '1000.00', base: 1000, reason: 'replaced_auto' });
  assert.deepEqual(plan({ currentValue: '250.50', lastAutoValue: '250.50', defaultPrice: null }), { fill: true, value: '', base: null, reason: 'cleared' });
  assert.deepEqual(plan({ currentValue: '', defaultPrice: null }), { fill: false, reason: 'no_default_price' });
  assert.deepEqual(plan({ currentValue: '', defaultPrice: 0 }), { fill: false, reason: 'no_default_price' }, 'a 0 master price does not write 0.00 into the row');
  assert.deepEqual(m.planProductDefaultPriceFill(), { fill: false, reason: 'no_default_price' });
});

test('seed/local merge, meta lookup and CSV import merge keep or clear the price deliberately', async () => {
  const m = await imp('erp-master-data-core.js');
  const seed = [{ code: 'S-1', name: 'Seed', defaultPrice: 500, unit: 'ชุด' }, { code: 'S-2', name: 'Seed2' }];
  let rows = m.buildProductMasterRows(seed, []);
  assert.deepEqual(rows.map(r => [r.code, r.defaultPrice, r.unit]), [['S-1', 500, 'ชุด'], ['S-2', null, 'ชิ้น']]);
  rows = m.buildProductMasterRows(seed, [{ code: 'S-1', name: 'Seed', standardCost: 300 }]);
  assert.equal(rows[0].defaultPrice, 500, 'a local row saved before the feature (no field) keeps the seed price');
  rows = m.buildProductMasterRows(seed, [{ code: 'S-1', name: 'Seed', defaultPrice: null }]);
  assert.equal(rows[0].defaultPrice, null, 'an explicit clear overrides the seed');
  rows = m.buildProductMasterRows(seed, [{ code: 'S-1', name: 'Seed', defaultPrice: '750' }, { code: 'L-1', name: 'Local', defaultPrice: 'junk' }]);
  assert.deepEqual(rows.map(r => r.defaultPrice), [null, 750, null], 'stored text is normalized; junk becomes no price');
  assert.equal(m.productMasterMetaFromRows(rows, 'Seed').defaultPrice, 750);
  assert.equal(m.productMasterMetaFromRows(rows, 'ไม่มี').defaultPrice, null);
  const merged = m.mergeProductImportRows([{ id: 'x', code: 'S-1', name: 'Seed', defaultPrice: 750 }], [{ code: 'S-1', name: 'Seed', standardCost: 1 }, { code: 'N-1', name: 'New', defaultPrice: 99 }], 'merge', { now: '2026-09-14T00:00:00.000Z', idFactory: i => `n${i}` });
  assert.deepEqual(merged.map(r => [r.code, r.defaultPrice]), [['S-1', 750], ['N-1', 99]], 'a CSV row without a price keeps the stored one');
});

test('seed data: demo and trial preset products have prices and selectable units', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const units = JSON.parse(src.match(/const UNITS=(\[[^\]]+\]);/)[1].replace(/'/g, '"'));
  const seedBlock = src.match(/const PRODUCT_MASTER=\[([\s\S]*?)\n\];/)[1];
  const seeds = [...seedBlock.matchAll(/\{code:'([^']+)',name:'[^']+',category:'[^']+',unit:'([^']+)',defaultPrice:(\d+(?:\.\d+)?)\}/g)];
  assert.equal(seeds.length, seedBlock.split('\n').filter(line => line.includes('{code:')).length, 'every seed row carries unit + defaultPrice');
  for (const [, code, unit, price] of seeds) {
    assert.ok(units.includes(unit), `${code} unit ${unit} is selectable`);
    assert.ok(Number(price) > 0, `${code} has a positive price`);
  }
  const rules = fs.readFileSync(path.join(ROOT, 'business-rules.js'), 'utf8');
  const presetProducts = [...rules.matchAll(/\{id:'trial-p-[^}]+\}/g)].map(m => m[0]);
  assert.equal(presetProducts.length, 6);
  for (const row of presetProducts) {
    const cost = Number(row.match(/standardCost:(\d+)/)[1]), price = Number(row.match(/defaultPrice:(\d+)/)?.[1]);
    assert.ok(price > cost, `${row.slice(0, 40)} sells above standard cost`);
    assert.ok(units.includes(row.match(/unit:'([^']+)'/)[1]));
  }
});

// ============================================================ jsdom
test('UI: product master form saves, edits, validates and clears the default price; list and backup carry it', async () => {
  const h = await boot(); const { w, set } = h;
  try {
    const $ = id => w.document.getElementById(id);
    w.go('master-data', null);
    w.resetProductMasterForm();
    assert.equal($('md-p-default-price').value, '');
    set('md-p-code', 'DP-UI'); set('md-p-name', 'สินค้าจากฟอร์ม'); set('md-p-unit', 'ชุด'); set('md-p-default-price', '-1');
    w.saveProductMasterLocal();
    assert.match(notices(h), /ราคาขายมาตรฐานต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป/);
    assert.equal(w.productMasterRows().some(r => r.code === 'DP-UI'), false, 'invalid price is not saved');
    set('md-p-default-price', '2500.5');
    w.saveProductMasterLocal();
    let row = w.productMasterRows().find(r => r.code === 'DP-UI');
    assert.equal(row.defaultPrice, 2500.5);
    assert.equal($('md-p-default-price').value, '', 'form resets after save');
    w.renderMasterData();
    assert.match($('master-product-table').innerHTML, /ราคาขายมาตรฐาน \(ก่อน VAT\)/);
    assert.match($('master-product-table').textContent, /฿2,500\.50/);
    w.editProductMasterLocal('DP-UI');
    assert.equal($('md-p-default-price').value, '2500.5', 'edit restores the price');
    // Clearing a seed product's price is stored as "no price" (not the seed value).
    const seed = w.productMasterRows().find(r => r.code === 'IT-001');
    assert.equal(seed.defaultPrice, 18500);
    w.editProductMasterLocal('IT-001');
    assert.equal($('md-p-default-price').value, '18500');
    set('md-p-default-price', '');
    w.saveProductMasterLocal();
    assert.equal(w.productMasterRows().find(r => r.code === 'IT-001').defaultPrice, null);
    w.renderMasterData();
    const it001 = [...$('master-product-table').querySelectorAll('tr')].find(tr => tr.textContent.includes('IT-001'));
    assert.ok(it001);
    // Backup round trip keeps both the value and the explicit clear.
    const backup = w.testApp.collectLocalMasterBackup();
    assert.equal(backup.products.find(r => r.code === 'DP-UI').defaultPrice, 2500.5);
    assert.equal(backup.products.find(r => r.code === 'IT-001').defaultPrice, null);
    const h2 = await boot();
    try {
      h2.w.testApp.restoreLocalMasterBackup(JSON.parse(JSON.stringify(backup)));
      assert.equal(h2.w.productMasterRows().find(r => r.code === 'DP-UI').defaultPrice, 2500.5);
      assert.equal(h2.w.productMasterRows().find(r => r.code === 'IT-001').defaultPrice, null);
      assert.deepEqual(h2.errors, []);
    } finally { h2.close(); }
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('UI: CSV template imports default prices; invalid prices are rejected per row', async () => {
  const h = await boot(); const { w } = h;
  try {
    const template = fs.readFileSync(path.join(ROOT, 'csv-templates/product-master-template.csv'), 'utf8');
    assert.match(template.split(/\r?\n/)[0], /ต้นทุนมาตรฐาน,ราคาขายมาตรฐาน \(ก่อน VAT\),จุดสั่งซื้อซ้ำ/);
    const csv = `${template.trimEnd()}\r\nBAD-1,ราคาผิด,ทดสอบ,ชิ้น,Service,บริการ,0,0,0,abc,0,\r\n`;
    // jsdom's File has no arrayBuffer(); the importer only needs name + arrayBuffer.
    const bytes = new TextEncoder().encode(csv);
    const file = { name: 'products.csv', arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    await w.handleCsvImportFile({ target: { files: [file] } });
    assert.match(w.document.getElementById('csv-import-status').textContent, /อ่านไฟล์สำเร็จ 4 แถว/);
    w.commitCsvImport();
    const rows = w.productMasterRows();
    assert.equal(rows.find(r => r.code === 'ST-001')?.defaultPrice, 9900, notices(h));
    assert.equal(rows.find(r => r.code === 'MTO-001')?.defaultPrice, null, 'empty price column = no price');
    assert.equal(rows.find(r => r.code === 'SV-001')?.defaultPrice, 1500);
    assert.equal(rows.some(r => r.code === 'BAD-1'), false, 'row with an invalid price is skipped');
    assert.match(notices(h), /ข้าม 1 แถว/);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('UI: invoice rows autofill price and unit from the master without overwriting user prices', async () => {
  const h = await boot(); const { w, set } = h;
  try {
    const $ = id => w.document.getElementById(id);
    w.testApp.restoreLocalMasterBackup({ products: [PRODUCT, NO_PRICE, OTHER] });
    w.go('invoice-form', null); w.resetF('invoice'); w.selBr('i', 'ubon');
    assert.equal($('i-vat').value, '0', 'invoice default is VAT-inclusive');
    $('i-items-body').innerHTML = '';
    w.addIItem();
    const row = $('i-items-body').lastElementChild, price = row.querySelector('[data-field="priceUnit"]'), unit = row.querySelector('[data-field="unit"]');
    row.querySelector('[data-field="qty"]').value = '2';
    chooseProduct(w, row, PRODUCT.name);
    assert.equal(price.value, '1070.00', 'pre-VAT 1,000 shown VAT-inclusive');
    assert.equal(unit.value, 'ชุด');
    assert.equal($('i-grand-total').value, '2,140.00', 'recalculated');
    assert.equal($('i-st').value, '2,000.00');
    // VAT mode change re-bases a price the autofill wrote.
    set('i-vat', '1'); fire(w, $('i-vat'));
    assert.equal(price.value, '1000.00');
    assert.equal($('i-grand-total').value, '2,140.00');
    // Abbreviated form locks VAT-inclusive and re-bases too.
    set('i-tax-form', 'abbreviated'); fire(w, $('i-tax-form'));
    assert.equal(price.value, '1070.00');
    set('i-tax-form', 'full'); fire(w, $('i-tax-form'));
    assert.equal(price.value, '1000.00');
    // Choosing another product replaces the auto price; a product without a price clears it.
    chooseProduct(w, row, OTHER.name);
    assert.equal(price.value, '250.50');
    assert.equal(unit.value, 'อัน', 'a master-filled unit follows the product');
    chooseProduct(w, row, NO_PRICE.name);
    assert.equal(price.value, '', 'stale auto price removed');
    assert.equal(unit.value, 'งาน');
    // A user-typed price is never overwritten — by product change or VAT change.
    price.value = '777'; fire(w, price, 'input');
    chooseProduct(w, row, PRODUCT.name);
    assert.equal(price.value, '777');
    set('i-vat', '0'); fire(w, $('i-vat'));
    assert.equal(price.value, '777');
    // A unit the user picked is kept.
    unit.value = 'กล่อง'; fire(w, unit);
    chooseProduct(w, row, OTHER.name);
    assert.equal(unit.value, 'กล่อง');
    assert.equal(price.value, '777');
    // Free text that is not in the master changes nothing.
    w.addIItem();
    const row2 = $('i-items-body').lastElementChild;
    chooseProduct(w, row2, 'สินค้าพิมพ์เอง');
    assert.equal(row2.querySelector('[data-field="priceUnit"]').value, '');
    assert.equal(row2.querySelector('[data-field="unit"]').value, 'กล่อง', 'first option still shown');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('UI: saved invoices and quotes keep their stored prices on edit; quote rows autofill too', async () => {
  const h = await boot(); const { w, set } = h;
  try {
    const $ = id => w.document.getElementById(id);
    w.testApp.restoreLocalMasterBackup({ products: [{ ...PRODUCT, standardCost: 800 }] });
    // Quote: default VAT mode is "ไม่มี VAT" → pre-VAT price as-is.
    w.go('quote-form', null); w.resetF('quote'); w.selBr('q', 'ubon');
    $('q-items-body').innerHTML = ''; w.addQItem();
    const qRow = $('q-items-body').lastElementChild, qPrice = qRow.querySelector('[data-field="price-unit"]');
    qRow.querySelector('input[type=number]').value = '3';
    set('q-vat', '2'); fire(w, $('q-vat'));
    chooseProduct(w, qRow, PRODUCT.name);
    assert.equal(qPrice.value, '1000.00');
    assert.equal(qRow.querySelector('select').value, 'ชุด');
    assert.equal($('q-total').value, '3,000.00');
    set('q-vat', '0'); fire(w, $('q-vat'));
    assert.equal(qPrice.value, '1070.00', 'quote re-base on VAT-inclusive');
    assert.equal($('q-total').value, '3,210.00');
    // The ⚙ Business Rules suggestion is an explicit user action: it overrides the
    // autofill and is then kept by VAT changes and by re-choosing the product.
    // (jsdom runs no inline onclick attributes, so call the handler the button uses.)
    w.applySuggestedQuotePrice(qRow.querySelector('.quote-price-rule-btn'));
    const suggested = qPrice.value;
    // review#11: the suggestion is pre-VAT (800 + 25% = 1,000) and the quote is VAT-inclusive here.
    assert.equal(suggested, '1070.00', 'standard cost 800 + company default markup 25%, shown VAT-inclusive');
    set('q-vat', '1'); fire(w, $('q-vat'));
    assert.equal(qPrice.value, suggested);
    chooseProduct(w, qRow, PRODUCT.name);
    assert.equal(qPrice.value, suggested);
    // Editing a saved invoice rebuilds rows programmatically: no autofill, stored price kept.
    const d = w.loadFor('ubon', 2026, 8);
    d.invoices = [{ id: 901, no: 'INV-DP-1', branch: 'ubon', date: '2026-09-05', customer: 'ลูกค้า ก', items: [{ product: PRODUCT.name, productCode: PRODUCT.code, qty: 1, unit: 'ชิ้น', priceUnit: 500, saleTotal: 500, costTotal: 0 }], itemSaleTotal: 500, subtotal: 500, vatAmt: 35, total: 535, useVat: 1, vatMode: 'add', paymentManaged: true }];
    w.saveFor('ubon', 2026, 8, d);
    w.editInvoice('ubon', 2026, 8, 901);
    const iRow = $('i-items-body').lastElementChild;
    assert.equal(iRow.querySelector('[data-field="priceUnit"]').value, '500');
    assert.equal(iRow.querySelector('[data-field="unit"]').value, 'ชิ้น', 'stored unit shown (ชิ้น is now a selectable unit)');
    // Re-choosing the product on an edited row keeps the stored (user) price and unit.
    chooseProduct(w, iRow, PRODUCT.name);
    assert.equal(iRow.querySelector('[data-field="priceUnit"]').value, '500');
    assert.equal(iRow.querySelector('[data-field="unit"]').value, 'ชิ้น');
    w.cancelDocumentEdit('invoice');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('UI: loading a trial preset seeds products with default prices that autofill invoices', async () => {
  const h = await boot(); const { w } = h;
  try {
    const $ = id => w.document.getElementById(id);
    for (const [preset, code, price] of [['made_to_order', 'MTO-001', 24000], ['stock_it', 'IT-TRIAL-01', 26900], ['service', 'SV-TRIAL-02', 5000]]) {
      w.BusinessRulesService.loadPreset(preset, { seed: true });
      assert.equal(w.productMasterRows().find(r => r.code === code)?.defaultPrice, price, `${preset} → ${code}`);
    }
    const seed = w.productMasterRows().find(r => r.code === 'IT-001');
    assert.deepEqual([seed.defaultPrice, seed.unit, seed.isSeed], [18500, 'เครื่อง', true]);
    w.go('invoice-form', null); w.resetF('invoice');
    $('i-items-body').innerHTML = ''; w.addIItem();
    const row = $('i-items-body').lastElementChild;
    chooseProduct(w, row, 'Notebook Business Series');
    assert.equal(row.querySelector('[data-field="priceUnit"]').value, '28783.00', '26,900 + 7% VAT');
    assert.equal(row.querySelector('[data-field="unit"]').value, 'เครื่อง');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

// ============================================================ review fixes
// jsdom's File has no arrayBuffer(); the importer only needs name + arrayBuffer.
async function importCsv(w, csv) {
  const bytes = new TextEncoder().encode(csv);
  const file = { name: 'products.csv', arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  await w.handleCsvImportFile({ target: { files: [file] } });
  w.commitCsvImport();
}

test('review#5: the master price field validates typed text instead of silently clearing it', async () => {
  const h = await boot(); const { w, set } = h;
  try {
    const $ = id => w.document.getElementById(id);
    assert.equal($('md-p-default-price').type, 'text');
    assert.equal($('md-p-default-price').getAttribute('inputmode'), 'decimal');
    w.go('master-data', null); w.resetProductMasterForm();
    set('md-p-code', 'R5-1'); set('md-p-name', 'สินค้าราคาหลักพัน'); set('md-p-default-price', '25,900');
    w.saveProductMasterLocal();
    assert.equal(w.productMasterRows().find(r => r.code === 'R5-1')?.defaultPrice, 25900, notices(h));
    w.resetProductMasterForm();
    set('md-p-code', 'R5-2'); set('md-p-name', 'สินค้าราคาผิด'); set('md-p-default-price', '25.900,50');
    w.saveProductMasterLocal();
    assert.match(notices(h), /ราคาขายมาตรฐานต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป/);
    assert.equal(w.productMasterRows().some(r => r.code === 'R5-2'), false, 'not saved as "no price"');
    set('md-p-default-price', '12.345');
    w.saveProductMasterLocal();
    assert.match(notices(h), /ทศนิยมได้ไม่เกิน 2 ตำแหน่ง/);
    assert.equal(w.productMasterRows().some(r => r.code === 'R5-2'), false);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('review#6: CSV auto-mapping never takes a VAT-inclusive or cost column as the pre-VAT price', async () => {
  const h = await boot(); const { w } = h;
  try {
    await importCsv(w, '﻿รหัสสินค้า,ชื่อสินค้า,ราคาขายปลีก (รวม VAT)\r\nR6-1,สินค้าราคารวม VAT,1070\r\n');
    await importCsv(w, '﻿รหัสสินค้า,ชื่อสินค้า,cost price\r\nR6-2,สินค้าราคาทุน,800\r\n');
    const rows = w.productMasterRows();
    assert.equal(rows.find(r => r.code === 'R6-1')?.defaultPrice, null, notices(h));
    assert.equal(rows.find(r => r.code === 'R6-2')?.defaultPrice, null);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
  const m = await imp('erp-master-data-core.js');
  const template = fs.readFileSync(path.join(ROOT, 'csv-templates/product-master-template.csv'), 'utf8').split(/\r?\n/)[0].split(',');
  assert.equal(m.findProductDefaultPriceCsvColumn(template), 9, 'template header still maps');
  for (const header of ['ราคาขายมาตรฐาน', 'ราคาขาย', 'Default Price', 'selling_price']) assert.equal(m.findProductDefaultPriceCsvColumn(['code', header]), 1, header);
  for (const header of ['ราคาขายปลีก (รวม VAT)', 'ราคาขาย (รวมภาษี)', 'price incl. VAT', 'cost price', 'ราคาทุน', 'price', 'Price']) assert.equal(m.findProductDefaultPriceCsvColumn(['code', header]), -1, header);
});

test('review#7: a CSV merge with a blank mapped price clears it; an unmapped price column keeps it', async () => {
  const h = await boot(); const { w } = h;
  try {
    w.testApp.restoreLocalMasterBackup({ products: [{ ...PRODUCT, id: 'R7-1', code: 'R7-1', name: 'สินค้าล้างราคา' }, { ...PRODUCT, id: 'R7-2', code: 'R7-2', name: 'สินค้าคงราคา' }] });
    assert.deepEqual(['R7-1', 'R7-2'].map(code => w.productMasterRows().find(r => r.code === code)?.defaultPrice), [1000, 1000]);
    await importCsv(w, '﻿รหัสสินค้า,ชื่อสินค้า,ราคาขายมาตรฐาน (ก่อน VAT)\r\nR7-1,สินค้าล้างราคา,\r\n');
    await importCsv(w, '﻿รหัสสินค้า,ชื่อสินค้า,หน่วย\r\nR7-2,สินค้าคงราคา,ชุด\r\n');
    const rows = w.productMasterRows();
    assert.equal(rows.find(r => r.code === 'R7-1')?.defaultPrice, null, 'blank mapped cell clears the stored price');
    assert.equal(rows.find(r => r.code === 'R7-2')?.defaultPrice, 1000, 'no price column keeps the stored price');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
  const m = await imp('erp-master-data-core.js');
  assert.deepEqual(m.planProductCsvDefaultPrice({ mapped: true, text: '' }), { include: true, value: null, issue: '' });
  assert.deepEqual(m.planProductCsvDefaultPrice({ mapped: false, text: '' }), { include: false, value: null, issue: '' });
  assert.deepEqual(m.planProductCsvDefaultPrice({ mapped: true, text: '1,500' }), { include: true, value: 1500, issue: '' });
});

test('review#8: the price parser rejects malformed numbers and more than 2 decimals', async () => {
  const m = await imp('erp-master-data-core.js');
  for (const bad of ['1,2,3', '1 000', '12,34', '1,0000', ',100', '100,', '.5', '12.']) {
    assert.equal(m.normalizeProductDefaultPrice(bad), null, bad);
    assert.deepEqual(m.validateProductMasterRecord({ code: 'A', name: 'B', defaultPrice: bad }).errors, ['invalid_defaultPrice'], bad);
  }
  assert.equal(m.normalizeProductDefaultPrice('12.345'), null, 'not silently rounded');
  assert.deepEqual(m.validateProductMasterRecord({ code: 'A', name: 'B', defaultPrice: '12.345' }).errors, ['invalid_defaultPrice_decimals']);
  assert.match(m.productMasterValidationMessage(['invalid_defaultPrice_decimals']), /ทศนิยมได้ไม่เกิน 2 ตำแหน่ง/);
  for (const [ok, value] of [['25,900', 25900], ['1,234,567.5', 1234567.5], ['1234', 1234], ['12.34', 12.34], ['฿ 1,500.50', 1500.5], [' 99 ', 99]]) assert.equal(m.normalizeProductDefaultPrice(ok), value, ok);
  for (const bad of ['1e3', '12abc', '-5', 'Infinity', '๑๒๓', '0x10']) assert.equal(m.normalizeProductDefaultPrice(bad), null, bad);
});

test('review#9: a typed 0 is kept, and editing the product to free text keeps the price', async () => {
  const m = await imp('erp-master-data-core.js');
  assert.deepEqual(m.planProductDefaultPriceFill({ currentValue: '0', defaultPrice: 1000, useVat: 1 }), { fill: false, reason: 'user_price' });
  assert.deepEqual(m.planProductDefaultPriceFill({ currentValue: '1000.00', lastAutoValue: '1000.00', defaultPrice: undefined, productFound: false }), { fill: false, reason: 'no_product' });
  const h = await boot(); const { w } = h;
  try {
    const $ = id => w.document.getElementById(id);
    w.testApp.restoreLocalMasterBackup({ products: [PRODUCT] });
    w.go('invoice-form', null); w.resetF('invoice'); w.selBr('i', 'ubon');
    $('i-items-body').innerHTML = '';
    w.addIItem();
    const row = $('i-items-body').lastElementChild, price = row.querySelector('[data-field="priceUnit"]');
    price.value = '0'; fire(w, price, 'input');
    chooseProduct(w, row, PRODUCT.name);
    assert.equal(price.value, '0', 'typed 0 (free item) is not overwritten');
    w.addIItem();
    const row2 = $('i-items-body').lastElementChild, price2 = row2.querySelector('[data-field="priceUnit"]');
    chooseProduct(w, row2, PRODUCT.name);
    assert.equal(price2.value, '1070.00');
    chooseProduct(w, row2, `${PRODUCT.name} รุ่นพิเศษ`);
    assert.equal(price2.value, '1070.00', 'free text keeps the current price');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('review#10: restored rows keep a unit that is not in the fixed list', async () => {
  const h = await boot(); const { w } = h;
  try {
    const $ = id => w.document.getElementById(id);
    w.testApp.restoreLocalMasterBackup({ products: [PRODUCT] });
    w.go('invoice-form', null); w.resetF('invoice');
    $('i-items-body').innerHTML = '';
    w.addIItem({ product: 'รถยก', qty: 1, unit: 'คัน', priceUnit: 100 });
    const unit = $('i-items-body').lastElementChild.querySelector('[data-field="unit"]');
    assert.equal(unit.value, 'คัน');
    // The restored unit counts as chosen: picking a product does not replace it.
    chooseProduct(w, $('i-items-body').lastElementChild, PRODUCT.name);
    assert.equal(unit.value, 'คัน');
    w.go('quote-form', null); w.resetF('quote');
    $('q-items-body').innerHTML = '';
    w.addQItem({ product: 'รถยก', qty: 1, unit: 'คัน<b>', priceUnit: 100 });
    const qUnit = $('q-items-body').lastElementChild.querySelector('select');
    assert.equal(qUnit.value, 'คัน<b>', 'value kept, markup escaped');
    assert.equal(qUnit.querySelector('b'), null);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('review#11: ⚙ ราคาแนะนำ converts the pre-VAT suggestion like the autofill does', async () => {
  const h = await boot(); const { w, set } = h;
  try {
    const $ = id => w.document.getElementById(id);
    w.testApp.restoreLocalMasterBackup({ products: [{ ...PRODUCT, standardCost: 800 }] });
    w.go('quote-form', null); w.resetF('quote'); w.selBr('q', 'ubon');
    $('q-items-body').innerHTML = ''; w.addQItem();
    const row = $('q-items-body').lastElementChild, price = row.querySelector('[data-field="price-unit"]');
    const input = row.querySelector('[data-field="product"]'); input.value = PRODUCT.name; w.applyProductMasterToInput(input);
    for (const [vat, expected] of [['0', '1070.00'], ['1', '1000.00'], ['2', '1000.00']]) {
      set('q-vat', vat);
      w.applySuggestedQuotePrice(row.querySelector('.quote-price-rule-btn'));
      assert.equal(price.value, expected, `q-vat ${vat}`);
      price.value = '';
      chooseProduct(w, row, PRODUCT.name);
      assert.equal(price.value, expected, `autofill agrees for q-vat ${vat}`);
      price.value = '';
    }
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

// ============================================================ fix5 (review B)
test('fix5#4: CSV auto-mapping prefers the explicit pre-VAT column and never guesses between equal generic columns', async () => {
  const m = await imp('erp-master-data-core.js');
  assert.equal(m.findProductDefaultPriceCsvColumn(['รหัสสินค้า', 'ราคาขาย', 'ราคาขายมาตรฐาน (ก่อน VAT)']), 2, 'explicit pre-VAT header wins over an earlier generic one');
  assert.equal(m.findProductDefaultPriceCsvColumn(['รหัสสินค้า', 'ราคาขายมาตรฐาน (ก่อน VAT)', 'ราคาขาย']), 1);
  assert.equal(m.findProductDefaultPriceCsvColumn(['code', 'selling price', 'ราคาขายมาตรฐาน']), 2, '"standard" beats generic');
  assert.equal(m.findProductDefaultPriceCsvColumn(['code', 'sale price', 'Default Price']), 2);
  assert.equal(m.findProductDefaultPriceCsvColumn(['code', 'ราคาขาย', 'selling price']), -1, 'two generic columns: ambiguous, left unmapped');
  assert.equal(m.findProductDefaultPriceCsvColumn(['code', 'ราคาขาย', 'ราคาขาย']), -1);
  assert.equal(m.findProductDefaultPriceCsvColumn(['code', 'ราคาขายมาตรฐาน', 'default price']), -1);
  assert.equal(m.findProductDefaultPriceCsvColumn(['code', 'ราคาขาย', 'ราคาขาย', 'ราคาขายมาตรฐาน (ก่อน VAT)']), 3, 'an explicit column resolves generic duplicates');
  assert.equal(m.findProductDefaultPriceCsvColumn(['code', 'ราคาขายปลีก (รวม VAT)', 'ราคาขาย']), 2, 'excluded VAT-inclusive header does not count');
  assert.equal(m.findProductDefaultPriceCsvColumn(['code', 'ราคาขาย']), 1, 'a single generic column still maps');
  assert.equal(m.findProductDefaultPriceCsvColumn([]), -1);
  assert.equal(m.findProductDefaultPriceCsvColumn(null), -1);
  const h = await boot(); const { w } = h;
  try {
    await importCsv(w, '﻿รหัสสินค้า,ชื่อสินค้า,ราคาขาย,ราคาขายมาตรฐาน (ก่อน VAT)\r\nF4-1,สินค้าสองราคา,1070,1000\r\n');
    assert.equal(w.productMasterRows().find(r => r.code === 'F4-1')?.defaultPrice, 1000, notices(h));
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('fix5#5: a price the user retypes with the autofilled value becomes the user price', async () => {
  const m = await imp('erp-master-data-core.js');
  assert.deepEqual(m.planProductDefaultPriceFill({ currentValue: '1070', lastAutoValue: '1070.00', defaultPrice: 250.5, userOwned: true }), { fill: false, reason: 'user_price' });
  assert.deepEqual(m.planProductDefaultPriceFill({ currentValue: '', lastAutoValue: '1070.00', defaultPrice: 250.5, useVat: 1, userOwned: true }), { fill: true, value: '250.50', base: 250.5, reason: 'filled_empty' }, 'an emptied cell is filled again');
  assert.deepEqual(m.planProductDefaultPriceFill({ currentValue: '1070', lastAutoValue: '1070.00', defaultPrice: 250.5, useVat: 1 }), { fill: true, value: '250.50', base: 250.5, reason: 'replaced_auto' }, 'without user interaction the autofill still follows the product');
  const h = await boot(); const { w, set } = h;
  try {
    const $ = id => w.document.getElementById(id);
    w.testApp.restoreLocalMasterBackup({ products: [PRODUCT, OTHER] });
    w.go('invoice-form', null); w.resetF('invoice'); w.selBr('i', 'ubon');
    $('i-items-body').innerHTML = '';
    w.addIItem();
    const row = $('i-items-body').lastElementChild, price = row.querySelector('[data-field="priceUnit"]');
    row.querySelector('[data-field="qty"]').value = '1';
    chooseProduct(w, row, PRODUCT.name);
    assert.equal(price.value, '1070.00');
    // Programmatic changes (VAT re-base) keep the autofill's ownership.
    set('i-vat', '1'); fire(w, $('i-vat'));
    assert.equal(price.value, '1000.00');
    set('i-vat', '0'); fire(w, $('i-vat'));
    assert.equal(price.value, '1070.00');
    chooseProduct(w, row, OTHER.name);
    assert.equal(price.value, '268.04', 'still autofilled → follows the product');
    // The user confirms the price by typing the same number.
    price.value = '268.04'; fire(w, price, 'input');
    chooseProduct(w, row, PRODUCT.name);
    assert.equal(price.value, '268.04', 'typed price kept on product change');
    set('i-vat', '1'); fire(w, $('i-vat'));
    assert.equal(price.value, '268.04', 'typed price kept on VAT change');
    // Emptying the cell hands it back to the autofill.
    price.value = ''; fire(w, price, 'input');
    chooseProduct(w, row, PRODUCT.name);
    assert.equal(price.value, '1000.00');
    chooseProduct(w, row, OTHER.name);
    assert.equal(price.value, '250.50', 'autofilled again after the refill');
    // Quote rows follow the same rule.
    w.go('quote-form', null); w.resetF('quote'); w.selBr('q', 'ubon');
    $('q-items-body').innerHTML = ''; w.addQItem();
    const qRow = $('q-items-body').lastElementChild, qPrice = qRow.querySelector('[data-field="price-unit"]');
    set('q-vat', '2'); fire(w, $('q-vat'));
    chooseProduct(w, qRow, PRODUCT.name);
    assert.equal(qPrice.value, '1000.00');
    qPrice.value = '1000.00'; fire(w, qPrice, 'input');
    chooseProduct(w, qRow, OTHER.name);
    assert.equal(qPrice.value, '1000.00');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});
