// ADR-028 — erp-costing-core.js + erp-job-costing-core.js (pure). Every expected number is worked by hand in the
// comment beside it (money in satang: 1 baht = 100; quantities in thousandths: 1 unit = 1,000).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const load = name => import(pathToFileURL(path.join(ROOT, name)).href);
const costing = () => load('erp-costing-core.js');
const jobs = () => load('erp-job-costing-core.js');
const stock = (code, extra = {}) => ({ code, name: `สินค้า ${code}`, flowType: 'inventory', fulfillmentType: 'stock', standardCost: 0, openingStockUbon: 0, openingStockKhonkaen: 0, ...extra });
const mv = (id, kind, qty, date, extra = {}) => ({ id, kind, qty, date, productCode: 'A', branch: 'ubon', unitCost: 0, createdAt: `2026-01-01T00:00:${String(id).padStart(2, '0').slice(-2)}Z`, ...extra });
const run = (c, input, method = 'moving_average') => {
  const built = c.buildCostingMovements(input);
  assert.deepEqual(built.issues, [], 'no data issues');
  return c.runCosting(built.groups, { settings: { method }, fallbackUc: built.fallbackUc });
};
const rowsOf = (result, sku = 'code:a', branch = 'ubon') => result.bySku.get(sku).get(branch);
const values = rows => rows.map(r => [r.kind, r.value, r.balanceQm, r.balanceValue]);

test('cost#1 moving average = (qty on hand × average + qty received × cost) ÷ (qty on hand + qty received), across receipts, issues and returns', async () => {
  const c = await costing();
  const result = run(c, {
    products: [stock('A', { openingStockUbon: 10, standardCost: 100 })],
    stockMovements: [mv(1, 'receipt', 10, '2026-01-05', { unitCost: 130, refId: 'GR1' }), mv(2, 'receipt', 5, '2026-01-20', { unitCost: 121, refId: 'GR2' })],
    invoices: [{ id: 1, no: 'INV1', branch: 'ubon', date: '2026-01-10', items: [{ productCode: 'A', qty: 5 }] }, { id: 2, no: 'INV2', branch: 'ubon', date: '2026-01-25', items: [{ productCode: 'A', qty: 22 }] }],
    creditNotes: [{ id: 9, no: 'CN1', branch: 'ubon', date: '2026-01-12', reasonCode: 'returned_goods', returnItems: [{ productCode: 'A', qty: 2, invoiceId: 1, invoiceBranch: 'ubon' }] }]
  });
  assert.deepEqual(values(rowsOf(result)), [
    ['opening', 100000, 10000, 100000], // 10 × 100.00 = 1,000.00
    ['receipt', 130000, 20000, 230000], // (10 × 100 + 10 × 130) ÷ 20 = 115.00 average; value 2,300.00
    ['sale', -57500, 15000, 172500], // 5 × 115 = 575.00
    ['sale_return', 23000, 17000, 195500], // 2 back at the cost they left with: 2 × 115 = 230.00
    ['receipt', 60500, 22000, 256000], // (17 × 115 + 5 × 121) ÷ 22 = 2,560 ÷ 22 = 116.3636…
    ['sale', -256000, 0, 0] // the last 22 units take the whole 2,560.00 (no residue)
  ]);
  assert.equal(rowsOf(result)[4].unitCost, 121);
  assert.equal(rowsOf(result)[4].averageUc, 1163636, 'average carried to 4 decimals: 116.3636');
  // Cost of each invoice line (cost of goods sold).
  const cogs = c.cogsByInvoiceLine(result);
  assert.deepEqual([cogs.get('ubon|1|0').value, cogs.get('ubon|2|0').value], [57500, 256000]);
});

test('cost#2 FIFO layers: partial consumption, and a back-dated insert recomputes everything after it', async () => {
  const c = await costing();
  const base = { products: [stock('A')], stockMovements: [mv(1, 'receipt', 10, '2026-01-01', { unitCost: 100, refId: 'GR1' }), mv(2, 'receipt', 10, '2026-01-10', { unitCost: 120, refId: 'GR2' })], invoices: [{ id: 20, no: 'INV20', branch: 'ubon', date: '2026-01-20', items: [{ productCode: 'A', qty: 15 }] }] };
  const before = run(c, base, 'fifo');
  // 15 units: the whole first layer 10 × 100 = 1,000.00 + 5 of the second × 120 = 600.00 → 1,600.00; left 5 × 120.
  assert.deepEqual(values(rowsOf(before)).slice(-1)[0], ['sale', -160000, 5000, 60000]);
  const layers = c.stateLayers(before.states.get('code:a').get('ubon'));
  assert.deepEqual(layers.map(l => [l.qm, l.value]), [[5000, 60000]], 'one partly-used layer remains');
  // A sale dated 5 Jan is entered later: it takes 4 of the first layer (400.00); the 20 Jan sale is recomputed:
  // 6 × 100 + 9 × 120 = 600 + 1,080 = 1,680.00; 1 unit of the second layer is left (120.00).
  const after = run(c, { ...base, invoices: [...base.invoices, { id: 5, no: 'INV05', branch: 'ubon', date: '2026-01-05', items: [{ productCode: 'A', qty: 4 }] }] }, 'fifo');
  assert.deepEqual(values(rowsOf(after)).map(r => r.slice(0, 2)), [['receipt', 100000], ['sale', -40000], ['receipt', 120000], ['sale', -168000]]);
  assert.equal(rowsOf(after).slice(-1)[0].balanceValue, 12000);
  // The same history with moving average: 5 Jan at 100 → 400.00; then (6 × 100 + 10 × 120) ÷ 16 = 112.50;
  // 15 × 112.50 = 1,687.50; 1 unit left at 112.50.
  const ma = run(c, { ...base, invoices: [...base.invoices, { id: 5, no: 'INV05', branch: 'ubon', date: '2026-01-05', items: [{ productCode: 'A', qty: 4 }] }] });
  assert.deepEqual(values(rowsOf(ma)).map(r => r[1]), [100000, -40000, 120000, -168750]);
  assert.equal(rowsOf(ma).slice(-1)[0].balanceValue, 11250);
  // Storage order never matters (deterministic): the same input reversed gives the same figures.
  const reversed = run(c, { ...base, stockMovements: base.stockMovements.slice().reverse(), invoices: [{ id: 5, no: 'INV05', branch: 'ubon', date: '2026-01-05', items: [{ productCode: 'A', qty: 4 }] }, ...base.invoices] }, 'fifo');
  assert.deepEqual(values(rowsOf(reversed)), values(rowsOf(after)));
});

test('cost#3 a transfer between branches moves the stock at its cost (the receiving branch gets the same value)', async () => {
  const c = await costing();
  const result = run(c, {
    products: [stock('A', { openingStockUbon: 10, standardCost: 100 })],
    stockMovements: [
      mv(1, 'receipt', 5, '2026-01-02', { branch: 'khonkaen', unitCost: 130, refId: 'GR1' }),
      mv(2, 'transfer_out', -4, '2026-01-03', { refNo: 'TRF1' }),
      mv(3, 'transfer_in', 4, '2026-01-03', { branch: 'khonkaen', refNo: 'TRF1', unitCost: 999 })
    ],
    invoices: [{ id: 7, no: 'INV7', branch: 'khonkaen', date: '2026-01-04', items: [{ productCode: 'A', qty: 9 }] }]
  });
  // Head office: 4 × 100.00 = 400.00 leaves; สาขา receives the same 400.00 (not the stored 999), so it holds
  // 5 × 130 + 400 = 1,050.00 for 9 units; the sale of 9 takes 1,050.00.
  assert.deepEqual(values(rowsOf(result, 'code:a', 'ubon')), [['opening', 100000, 10000, 100000], ['transfer_out', -40000, 6000, 60000]]);
  assert.deepEqual(values(rowsOf(result, 'code:a', 'khonkaen')), [['receipt', 65000, 5000, 65000], ['transfer_in', 40000, 9000, 105000], ['sale', -105000, 0, 0]]);
  assert.equal(rowsOf(result, 'code:a', 'khonkaen')[1].costSource, 'transfer');
  // Company valuation on 3 Jan = 600.00 + 1,050.00; the stock card for 'all' shows both legs (they cancel).
  const val = c.valuationAt(result, '2026-01-03');
  assert.equal(c.valuationTotal(val), 165000);
  const card = c.stockCard(result, { sku: 'code:a', branch: 'all', from: '2026-01-01', to: '2026-01-31' });
  assert.deepEqual([card.opening, card.closing], [{ qm: 10000, value: 100000 }, { qm: 6000, value: 60000 }]);
  assert.deepEqual(card.rows.map(r => [r.kind, r.branch, r.runQm, r.runValue]), [['receipt', 'khonkaen', 15000, 165000], ['transfer_out', 'ubon', 11000, 125000], ['transfer_in', 'khonkaen', 15000, 165000], ['sale', 'khonkaen', 6000, 60000]]);
});

test('cost#4 negative stock (back-dated documents only): last known cost, flagged, corrected when stock arrives', async () => {
  const c = await costing();
  for (const method of ['moving_average', 'fifo']) {
    const result = run(c, {
      products: [stock('A', { standardCost: 80 })],
      stockMovements: [mv(1, 'receipt', 2, '2026-01-01', { unitCost: 50, refId: 'GR1' }), mv(2, 'receipt', 10, '2026-01-10', { unitCost: 60, refId: 'GR2' })],
      invoices: [{ id: 5, no: 'INV5', branch: 'ubon', date: '2026-01-05', items: [{ productCode: 'A', qty: 5 }] }]
    }, method);
    const rows = rowsOf(result);
    // Sale of 5 with 2 on hand: 2 × 50 + 3 owed at the last known cost 50 = 250.00, balance −3 / −150.00, flagged.
    assert.deepEqual([rows[1].value, rows[1].balanceQm, rows[1].balanceValue, rows[1].negative], [-25000, -3000, -15000, true], method);
    assert.deepEqual(rows[1].flags, ['negative_stock']);
    // The receipt of 10 × 60 covers the 3 owed at 60: 180.00 − 150.00 = +30.00 correction to cost of sales (on the
    // receipt's date); the 7 left are worth 7 × 60 = 420.00. Cost of sales in total = 250 + 30 = 280 = 2×50 + 3×60.
    assert.deepEqual([rows[2].value, rows[2].correction, rows[2].balanceQm, rows[2].balanceValue], [60000, 3000, 7000, 42000], method);
    assert.deepEqual(c.negativeStockCorrections(result).map(r => [r.date, r.value]), [['2026-01-10', 3000]]);
    assert.equal(result.negatives.length, 1);
  }
  // No cost history at all: the product's standard cost (80.00) is used and the source says so.
  const none = run(c, { products: [stock('A', { standardCost: 80 })], invoices: [{ id: 1, no: 'INV1', branch: 'ubon', date: '2026-01-05', items: [{ productCode: 'A', qty: 2 }] }] });
  assert.deepEqual([rowsOf(none)[0].value, rowsOf(none)[0].costSource], [-16000, 'standard']);
});

test('cost#5 rounding: half away from zero once per movement; the stock value is always the exact sum of the layers', async () => {
  const c = await costing();
  assert.deepEqual([c.toSatang(2.135), c.toSatang(-2.135), c.toSatang('1,234.565'), c.mulDivRound(5, 1, 2), c.mulDivRound(-5, 1, 2)], [214, -214, 123457, 3, -3]);
  assert.equal(c.mulDivRound(9007199254740991, 3, 3), 9007199254740991, 'BigInt path exact');
  for (const method of ['moving_average', 'fifo']) {
    const result = run(c, {
      products: [stock('A')],
      stockMovements: [mv(1, 'receipt', 3, '2026-01-01', { unitCost: 33.3333, refId: 'GR1' })],
      invoices: [1, 2, 3].map(n => ({ id: n, no: `INV${n}`, branch: 'ubon', date: `2026-01-0${n + 1}`, items: [{ productCode: 'A', qty: 1 }] }))
    }, method);
    const rows = rowsOf(result);
    // 3 × 33.3333 = 99.9999 → 100.00 (one rounding). Then 33.33 / 33.34 / 33.33: moving average 100.00 ÷ 3 =
    // 33.3333 → 33.33; 66.67 ÷ 2 = 33.335 → 33.34 (half up); the last unit takes the 33.33 left. FIFO: the same
    // shares of the one layer (10,000 × 1/3 = 3,333.33 → 3,333; 6,667 × 1/2 = 3,333.5 → 3,334; the rest 3,333).
    assert.deepEqual(rows.map(r => r.value), [10000, -3333, -3334, -3333], method);
    for (const row of rows) assert.ok(Number.isInteger(row.value) && Number.isInteger(row.balanceValue));
  }
  // A long mixed history: at every date the valuation equals the layers of the final state, and in + out = balance.
  const movements = [];
  for (let i = 1; i <= 60; i += 1) movements.push(mv(i, i % 3 ? 'receipt' : 'adjustment', i % 3 ? 7 : -5, `2026-02-${String(1 + (i % 28)).padStart(2, '0')}`, { unitCost: 17 + (i % 7) / 3, refId: `GR${i}` }));
  for (const method of ['moving_average', 'fifo']) {
    const result = run(c, { products: [stock('A')], stockMovements: movements }, method);
    const rows = rowsOf(result);
    const final = rows[rows.length - 1];
    const state = result.states.get('code:a').get('ubon');
    const layers = c.stateLayers(state);
    assert.equal(layers.reduce((s, l) => s + l.value, 0), final.balanceValue, `${method}: valuation = Σ layers`);
    assert.equal(layers.reduce((s, l) => s + l.qm, 0), final.balanceQm);
    assert.equal(rows.reduce((s, r) => s + r.value - r.correction, 0), final.balanceValue, 'Σ in − Σ out = balance');
    assert.equal(c.valuationTotal(c.valuationAt(result, '2026-12-31')), final.balanceValue);
  }
});

test('cost#6 the worked job: 100 units, materials 8,200 + labour 3,200 + overhead 40 h × 50 = 2,000 → 13,400; sold for 20,000 → gross profit 6,600 (33.0%)', async () => {
  const c = await costing();
  const j = await jobs();
  const analytics = await load('erp-analytics-core.js');
  const settings = { labourRate: 80, personRates: [], overhead: { estimatedOverhead: 60000, estimatedHours: 1200 } };
  // Overhead rate = estimated overhead ÷ estimated labour hours = 60,000 ÷ 1,200 = 50.00 per hour.
  assert.equal(c.overheadRateSatang(settings.overhead), 5000);
  assert.equal(j.overheadRateBaht(settings), 50);
  const production = { id: 501, no: 'PD690901', branch: 'ubon', _branch: 'ubon', date: '2026-09-01', customer: 'ลูกค้า ก', job: 'ผลิต 100 หน่วย', sourceSalesOrderId: 'so-1', items: [{ product: 'ชิ้นงาน X', qty: 100, saleTotal: 20000 }], subtotal: 20000 };
  const products = [stock('RM1', { openingStockUbon: 150, standardCost: 82 })];
  const job = j.listJobs([production])[0];
  assert.equal(job.key, 'ubon|501');
  const built = c.buildCostingMovements({ products, stockMovements: [mv(1, 'job_issue', -100, '2026-09-02', { productCode: 'RM1', jobKey: 'ubon|501', refType: 'job' })] });
  const result = c.runCosting(built.groups, { settings: { method: 'moving_average' } });
  const labour = j.planLabourEntry({ job, sheet: null, person: 'ทีมช่าง A', hours: 40, date: '2026-09-05', settings });
  assert.equal(labour.ok, true);
  assert.deepEqual([labour.amount, labour.overhead], [320000, 200000], '40 h × 80 = 3,200.00; 40 h × 50 = 2,000.00');
  const store = j.normalizeJobStore({ schemaVersion: 1, budgets: {}, entries: [
    { id: 'je1', kind: 'labour', jobKey: 'ubon|501', jobNo: 'PD690901', branch: 'ubon', date: '2026-09-05', status: 'posted', person: 'ทีมช่าง A', hours: 40, rate: 80, overheadRate: 50 },
    { id: 'je2', kind: 'completion', jobKey: 'ubon|501', jobNo: 'PD690901', branch: 'ubon', date: '2026-09-06', status: 'posted', goodQty: 100, scrapQty: 0, destination: 'cost_of_sales' }
  ] });
  const sheets = j.buildJobCostSheets({ jobs: [job], store, costing: result });
  const sheet = sheets.get('ubon|501');
  assert.deepEqual([sheet.materials.net, sheet.labour.amount, sheet.overhead.amount, sheet.other.amount, sheet.total], [820000, 320000, 200000, 0, 1340000]);
  assert.equal(c.ucToBaht(sheet.unitCost), 134, '13,400 ÷ 100 good units = 134.00');
  // Sold for 20,000.00 before VAT on an invoice that delivers the job; the analytics measure gives the revenue.
  const invoice = { id: 601, no: 'INV690901', branch: 'ubon', date: '2026-09-10', customer: 'ลูกค้า ก', sourceProductionId: '501', sourceSalesOrderId: 'so-1', items: [{ product: 'ชิ้นงาน X', qty: 100, priceUnit: 200, saleTotal: 20000 }], subtotal: 20000, vatAmt: 1400, total: 21400, vatMode: 'add', useVat: 1 };
  const pack = { productions: [production], invoices: [invoice] };
  const rows = analytics.packSalesRows(pack, { branch: 'ubon', year: 2026, month: 8 }, { legacyProductions: [production] });
  const gp = j.buildGrossProfitLines({ measureRows: rows.map(row => ({ row, branch: 'ubon', period: '2026-09' })), products, costing: result, sheets, jobs: [job], invoices: [invoice] });
  assert.deepEqual([sheet.revenue, sheet.profit], [2000000, 660000]);
  assert.equal(sheet.margin.toFixed(1), '33.0');
  const report = j.profitReport(gp.lines, { dimension: 'job' });
  assert.deepEqual([report.rows[0].sales, report.rows[0].cost, report.rows[0].grossProfit, report.rows[0].margin.toFixed(1), report.rows[0].coverage], [2000000, 1340000, 660000, '33.0', 100]);
});

test('cost#7 profit per job agrees with the analytics sales measure for the same filter (legacy orders, notes, services)', async () => {
  const c = await costing();
  const j = await jobs();
  const analytics = await load('erp-analytics-core.js');
  const products = [stock('S1', { openingStockUbon: 10, standardCost: 1000 }), { code: 'SV', name: 'บริการติดตั้ง', flowType: 'service', fulfillmentType: 'service' }];
  // A legacy production order (no sales order: the order itself is the sale), its invoice, a stock sale with a
  // service, a credit note returning 1 unit and a debit note.
  const legacy = { id: 1, no: 'PD1', branch: 'ubon', _branch: 'ubon', date: '2026-09-02', customer: 'C1', job: 'งาน 1', items: [{ product: 'บริการติดตั้ง', productCode: 'SV', qty: 1, saleTotal: 5000 }], subtotal: 5000 };
  const invLegacy = { id: 10, no: 'INV10', branch: 'ubon', date: '2026-09-05', customer: 'C1', sourceProductionId: '1', items: [{ product: 'บริการติดตั้ง', productCode: 'SV', qty: 1, saleTotal: 5000 }], subtotal: 5000, vatMode: 'add' };
  const inv = { id: 11, no: 'INV11', branch: 'ubon', date: '2026-09-06', customer: 'C2', items: [{ productCode: 'S1', product: 'สินค้า S1', qty: 3, saleTotal: 4500 }, { productCode: 'SV', product: 'บริการติดตั้ง', qty: 1, saleTotal: 1500 }], subtotal: 6000, vatMode: 'add' };
  const cn = { id: 20, no: 'CN1', branch: 'ubon', date: '2026-09-08', reasonCode: 'returned_goods', subtotal: 1500, total: 1605, lines: [{ invoiceId: 11, invoiceNo: 'INV11', invoiceBranch: 'ubon', difference: 1500 }], returnItems: [{ productCode: 'S1', product: 'สินค้า S1', qty: 1, invoiceId: 11, invoiceBranch: 'ubon' }] };
  const dn = { id: 21, no: 'DN1', branch: 'ubon', date: '2026-09-09', documentKind: 'debit-note', subtotal: 700, total: 749, lines: [{ invoiceId: 10, invoiceNo: 'INV10', invoiceBranch: 'ubon', difference: 700 }] };
  const pack = { productions: [legacy], invoices: [invLegacy, inv], creditNotes: [cn], debitNotes: [dn] };
  const invoices = [invLegacy, inv];
  const resolveInvoice = ref => invoices.find(i => String(i.id) === String(ref.invoiceId)) || null;
  const rows = analytics.packSalesRows(pack, { branch: 'ubon', year: 2026, month: 8 }, { legacyProductions: [legacy], resolveInvoice });
  const measure = analytics.packSalesTotal(rows);
  // Measure: legacy order 5,000 (its invoice is not counted again) + 6,000 − 1,500 + 700 = 10,200.00.
  assert.equal(measure, 10200);
  const jobList = j.listJobs([legacy]);
  const built = c.buildCostingMovements({ products, invoices, creditNotes: [cn] });
  const result = c.runCosting(built.groups, {});
  const store = j.normalizeJobStore({ schemaVersion: 1, budgets: {}, entries: [{ id: 'l1', kind: 'labour', jobKey: 'ubon|1', jobNo: 'PD1', branch: 'ubon', date: '2026-09-03', status: 'posted', person: 'ช่าง', hours: 10, rate: 150, overheadRate: 50 }, { id: 'c1', kind: 'completion', jobKey: 'ubon|1', jobNo: 'PD1', branch: 'ubon', date: '2026-09-04', status: 'posted', goodQty: 1, scrapQty: 0, destination: 'cost_of_sales' }] });
  const sheets = j.buildJobCostSheets({ jobs: jobList, store, costing: result });
  const gp = j.buildGrossProfitLines({ measureRows: rows.map(row => ({ row, branch: 'ubon', period: '2026-09' })), products, costing: result, sheets, jobs: jobList, invoices });
  const all = j.summarizeLines(gp.lines);
  assert.equal(all.sales, 1020000, 'the lines add up to the measure exactly');
  // Job: 5,000 + DN 700 = 5,700 revenue; cost 10 h × (150 + 50) = 2,000 → profit 3,700.
  const byJob = j.profitReport(gp.lines, { dimension: 'job' });
  assert.deepEqual([byJob.rows[0].sales, byJob.rows[0].cost, byJob.rows[0].grossProfit], [570000, 200000, 370000]);
  // Stock line 3 × 1,000 = 3,000 cost; the return gives back 1 × 1,000; the service line of INV11 has no cost
  // (no job): covered = 5,700 (job) + 4,500 − 1,500 (stock) = 8,700 of 10,200 → 85.29 %; cost 2,000 + 3,000 − 1,000.
  assert.deepEqual([all.coveredSales, all.cost], [870000, 400000]);
  assert.equal(all.coverage.toFixed(2), '85.29');
  const byCustomer = j.profitReport(gp.lines, { dimension: 'customer' });
  assert.equal(byCustomer.rows.reduce((s, r) => s + r.sales, 0), all.sales, 'by customer adds up to the measure');
  assert.equal(j.profitReport(gp.lines, { dimension: 'month' }).rows[0].sales, Math.round(measure * 100));
});

test('cost#8 method lock: free choice before the first costed movement; afterwards only with an RD approval, from an open date', async () => {
  const c = await costing();
  assert.equal(c.isMethodLocked([]), false);
  const unlocked = c.planMethodChange({ method: 'moving_average', methodHistory: [] }, { method: 'fifo' }, { locked: false });
  assert.equal(unlocked.ok, true);
  assert.equal(unlocked.settings.method, 'fifo');
  const settings = { method: 'moving_average', methodHistory: [] };
  const ctx = { locked: true, today: '2026-10-22', isLocked: date => date <= '2026-09-30' };
  assert.equal(c.planMethodChange(settings, { method: 'fifo' }, ctx).error, 'approval_required', 's.65 ทวิ (6): approval needed');
  assert.equal(c.planMethodChange(settings, { method: 'fifo', approvalRef: 'กค 0702/123', approvalDate: '2026-10-01' }, ctx).error, 'effective_date_required');
  assert.equal(c.planMethodChange(settings, { method: 'fifo', approvalRef: 'กค 0702/123', approvalDate: '2026-10-01', effectiveFrom: '2026-09-15' }, ctx).error, 'effective_before_approval');
  assert.equal(c.planMethodChange(settings, { method: 'fifo', approvalRef: 'x', approvalDate: '2026-09-01', effectiveFrom: '2026-09-15' }, ctx).error, 'period_locked');
  assert.equal(c.planMethodChange(settings, { method: 'fifo', approvalRef: 'x', approvalDate: '2026-11-01', effectiveFrom: '2026-11-01' }, ctx).error, 'approval_in_future');
  const ok = c.planMethodChange(settings, { method: 'fifo', approvalRef: 'กค 0702/123', approvalDate: '2026-10-01', effectiveFrom: '2026-10-01', note: 'อนุมัติแล้ว' }, ctx);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.settings.methodHistory.map(r => [r.method, r.effectiveFrom]), [['moving_average', ''], ['fifo', '2026-10-01']]);
  assert.doesNotThrow(() => c.normalizeCostingSettings({ ...c.defaultCostingSettings(), method: 'fifo', methodHistory: ok.settings.methodHistory }));
  // The change takes effect from its date: earlier movements keep moving average, later ones use FIFO, and the stock
  // is carried over at its value (no restatement). Receipts 10 @ 100 and 10 @ 130 in September → average 115;
  // 1 Oct: FIFO starts with one layer 20 @ 115; a receipt 10 @ 160 on 2 Oct; a sale of 25 on 3 Oct = 20 × 115 +
  // 5 × 160 = 2,300 + 800 = 3,100.00.
  const result = run(c, { products: [stock('A')], stockMovements: [mv(1, 'receipt', 10, '2026-09-01', { unitCost: 100, refId: 'G1' }), mv(2, 'receipt', 10, '2026-09-02', { unitCost: 130, refId: 'G2' }), mv(3, 'receipt', 10, '2026-10-02', { unitCost: 160, refId: 'G3' })], invoices: [{ id: 1, no: 'I1', branch: 'ubon', date: '2026-10-03', items: [{ productCode: 'A', qty: 25 }] }] });
  const switched = c.runCosting(c.buildCostingMovements({ products: [stock('A')], stockMovements: [mv(1, 'receipt', 10, '2026-09-01', { unitCost: 100, refId: 'G1' }), mv(2, 'receipt', 10, '2026-09-02', { unitCost: 130, refId: 'G2' }), mv(3, 'receipt', 10, '2026-10-02', { unitCost: 160, refId: 'G3' })], invoices: [{ id: 1, no: 'I1', branch: 'ubon', date: '2026-10-03', items: [{ productCode: 'A', qty: 25 }] }] }).groups, { settings: ok.settings });
  assert.equal(rowsOf(switched).slice(-1)[0].value, -310000);
  // Moving average all along instead: (2,300 + 1,600) ÷ 30 = 130.00 → 25 × 130 = 3,250.00.
  assert.equal(rowsOf(result).slice(-1)[0].value, -325000);
});

test('cost#9 period lock: a back-dated change that would alter a cost inside a closed period is refused', async () => {
  const c = await costing();
  const base = { products: [stock('A')], stockMovements: [mv(1, 'receipt', 10, '2026-08-01', { unitCost: 100, refId: 'G1' }), mv(2, 'receipt', 10, '2026-08-10', { unitCost: 120, refId: 'G2' }), mv(3, 'job_issue', -10, '2026-08-25', { jobKey: 'ubon|1' })] };
  const isLocked = (branch, date, scope) => branch === 'ubon' && scope === 'purchase' && date <= '2026-08-31';
  for (const method of ['fifo']) {
    const before = run(c, base, method);
    // A sale dated 5 Aug (the SALES period is open) takes the cheaper layer first, so the 25 Aug job issue — in the
    // closed purchase / stock period — would cost 6 × 100 + 4 × 120 = 1,080 instead of 1,000: refused.
    const after = run(c, { ...base, invoices: [{ id: 9, no: 'I9', branch: 'ubon', date: '2026-08-05', items: [{ productCode: 'A', qty: 4 }] }] }, method);
    const conflicts = c.lockedCostChanges(before, after, isLocked);
    assert.deepEqual(conflicts.map(x => [x.id, x.date, x.before, x.after]), [['mv|3', '2026-08-25', -100000, -108000]]);
  }
  // A sale dated after the closed period changes nothing inside it → allowed.
  const beforeMa = run(c, base);
  const afterMa = run(c, { ...base, invoices: [{ id: 9, no: 'I9', branch: 'ubon', date: '2026-09-05', items: [{ productCode: 'A', qty: 4 }] }] });
  assert.deepEqual(c.lockedCostChanges(beforeMa, afterMa, isLocked), []);
  // A new receipt dated inside the closed period is itself a locked change.
  const inside = run(c, { ...base, stockMovements: [...base.stockMovements, mv(4, 'receipt', 1, '2026-08-20', { unitCost: 500, refId: 'G4' })] });
  assert.ok(c.lockedCostChanges(beforeMa, inside, isLocked).some(x => x.id === 'mv|4'));
  // Changing an opening cost is a change before every period: refused while any stock period of the branch is closed.
  const opening = p => run(c, { products: [stock('B', { openingStockUbon: 5, standardCost: p })] });
  assert.equal(c.lockedCostChanges(opening(10), opening(11), isLocked).length, 1);
});

test('cost#10 NRV: lower of cost and net realisable value at a date, with the write-down; Excel rows use the same figures', async () => {
  const c = await costing();
  const products = [stock('A', { openingStockUbon: 10, standardCost: 100, defaultPrice: 150 }), stock('B', { openingStockUbon: 4, standardCost: 50, defaultPrice: 40 }), stock('C', { openingStockUbon: 2, standardCost: 10 })];
  const result = run(c, { products });
  const rows = c.valuationAt(result, '2026-09-30');
  const report = c.buildNrvReport(rows, { 'code:a': { expectedPrice: 95, costToSell: 5 } }, products);
  // A: entered 95 − 5 = 90 < cost 100 → write down 10 × 10 = 100.00. B: default price 40 < cost 50 → 4 × 10 = 40.00.
  // C: no price at all → listed as missing, never guessed.
  assert.deepEqual(report.rows.map(r => [r.sku, r.cost, r.nrvValue, r.writeDown, r.priceSource]), [['code:a', 100000, 90000, 10000, 'entered'], ['code:b', 20000, 16000, 4000, 'defaultPrice']]);
  assert.deepEqual(report.totals, { cost: 120000, lowerOfCostAndNrv: 106000, writeDown: 14000 });
  assert.deepEqual(report.missing, ['code:c']);
  // Selling costs above the price: the write-down stops at the cost (inventory is never negative).
  assert.equal(c.buildNrvReport(rows, { 'code:a': { expectedPrice: 10, costToSell: 50 } }, products).rows[0].writeDown, 100000);
});

test('cost#11 stores are read fail-closed (settings and job entries); budgets resolve quote → production estimate', async () => {
  const c = await costing();
  const j = await jobs();
  assert.deepEqual(c.normalizeCostingSettings(null), c.defaultCostingSettings());
  for (const bad of ['{', '[]', JSON.stringify({ ...c.defaultCostingSettings(), method: 'lifo' }), JSON.stringify({ ...c.defaultCostingSettings(), extra: 1 }), JSON.stringify({ ...c.defaultCostingSettings(), labourRate: -1 }), JSON.stringify(c.defaultCostingSettings()).replace('"openingCosts":{}', '"openingCosts":{"__proto__":1}')]) {
    assert.throws(() => c.normalizeCostingSettings(bad), /ข้อมูลตั้งค่าต้นทุนไม่ถูกต้อง/, bad);
  }
  assert.deepEqual(j.normalizeJobStore(''), j.emptyJobStore());
  const entry = { id: 'e1', kind: 'labour', jobKey: 'ubon|1', jobNo: 'PD1', branch: 'ubon', date: '2026-09-01', status: 'posted', person: 'A', hours: 2, rate: 100, overheadRate: 50 };
  assert.equal(j.normalizeJobStore({ schemaVersion: 1, entries: [entry], budgets: {} }).entries.length, 1);
  for (const broken of [{ ...entry, hours: 0 }, { ...entry, kind: 'lifo' }, { ...entry, branch: 'khonkaen' }, { ...entry, date: '2026-02-30' }, { ...entry, id: 'a b' }, { ...entry, extra: 1 }]) {
    assert.throws(() => j.normalizeJobStore({ schemaVersion: 1, entries: [broken], budgets: {} }), /ข้อมูลต้นทุนงานไม่ถูกต้อง/);
  }
  assert.throws(() => j.normalizeJobStore({ schemaVersion: 1, entries: [entry, entry], budgets: {} }), /รหัสซ้ำ/);
  const job = { key: 'ubon|1', no: 'PD1', estimate: 1500000 };
  const quote = { no: 'QT1', items: [{ qty: 2, pricingRuleSnapshot: { standardCost: 4200 } }, { qty: 1, pricingRuleSnapshot: { standardCost: 1000.5 } }] };
  // 2 × 4,200 + 1 × 1,000.50 = 9,400.50.
  assert.deepEqual(j.resolveBudget(job, null, quote), { source: 'quote_total', sourceRef: 'QT1', byCategory: null, labourHoursQm: 0, total: 940050 });
  assert.equal(j.resolveBudget(job, null, null).source, 'production');
  assert.equal(j.resolveBudget(job, { materials: 100, labour: 20, overhead: 10, other: 0, labourHours: 1, source: 'quote' }, quote).total, 13000);
  assert.deepEqual(j.allocateSatang(1001, [1, 1, 1]), [334, 334, 333]);
  assert.equal(j.allocateSatang(1340000, [2000000, 70000]).reduce((a, b) => a + b, 0), 1340000);
});

test('cost#12 over / under-applied overhead: actual overhead expenses (pre-VAT when claimable) vs hours × rate applied', async () => {
  const j = await jobs();
  const store = j.normalizeJobStore({ schemaVersion: 1, budgets: {}, entries: [
    { id: 'a', kind: 'labour', jobKey: 'ubon|1', jobNo: 'P1', branch: 'ubon', date: '2026-09-03', status: 'posted', person: 'A', hours: 100, rate: 80, overheadRate: 50 },
    { id: 'b', kind: 'labour', jobKey: 'ubon|1', jobNo: 'P1', branch: 'ubon', date: '2026-09-04', status: 'voided', person: 'A', hours: 999, rate: 80, overheadRate: 50 }
  ] });
  const expenses = [
    { cat: 'ค่าไฟฟ้าโรงงาน', date: '2026-09-10', amount: 5350, subtotal: 5000, inputVatClaimable: true, branch: 'ubon' },
    { cat: 'ค่าไฟฟ้าโรงงาน', date: '2026-09-11', amount: 1070, subtotal: 1000, inputVatClaimable: false, branch: 'ubon' },
    { cat: 'ค่าการตลาด', date: '2026-09-12', amount: 9999, branch: 'ubon' }
  ];
  const report = j.overheadVarianceReport({ expenses, store, categories: ['ค่าไฟฟ้าโรงงาน'], months: ['2026-09'] });
  // Actual = 5,000 (claimable VAT is not a cost) + 1,070 (VAT not claimable: part of the cost) = 6,070.00.
  // Applied = 100 h × 50 = 5,000.00 (the voided entry does not count). Under-applied by 1,070.00.
  assert.deepEqual([report.rows[0].actual, report.rows[0].applied, report.rows[0].variance], [607000, 500000, -107000]);
});

test('cost#13 performance and determinism: 300 SKUs × 2,000 movements each (600,000) recompute under 300 ms in Node', async () => {
  const c = await costing();
  const v8 = require('node:v8');
  const vm = require('node:vm');
  v8.setFlagsFromString('--expose_gc');
  const gc = vm.runInNewContext('gc');
  const iso = n => new Date(Date.UTC(2023, 0, 1 + n)).toISOString().slice(0, 10);
  const products = [];
  const rows = [];
  // ~2 movements a day over three years per product, both branches; receipts, adjustments out and job issues.
  for (let s = 0; s < 300; s += 1) {
    products.push(stock(`P${s}`, { openingStockUbon: 100, standardCost: 100 }));
    for (let i = 0; i < 1999; i += 1) {
      const kind = ['receipt', 'adjustment', 'receipt', 'job_issue', 'adjustment'][i % 5];
      const q = kind === 'receipt' ? 4 : 1 + (i % 3);
      rows.push({ id: `m${s}-${i}`, productCode: `P${s}`, branch: i % 7 ? 'ubon' : 'khonkaen', date: iso(Math.floor(i * 0.55)), kind, qty: kind === 'receipt' ? q : -q, unitCost: 100 + (i % 13), createdAt: '2023', refId: `GR${s}-${i}` });
    }
  }
  const built = c.buildCostingMovements({ products, stockMovements: rows });
  assert.equal(built.movements.length, 600000);
  const times = { moving_average: [], fifo: [] };
  let reference = null;
  for (const method of ['moving_average', 'fifo', 'moving_average', 'fifo', 'moving_average', 'fifo']) {
    gc();
    const started = performance.now();
    const result = c.runCosting(built.groups, { settings: { method } });
    times[method].push(performance.now() - started);
    const total = c.valuationTotal(c.valuationAt(result, '2026-12-31'));
    if (method === 'moving_average') { if (reference === null) reference = total; assert.equal(total, reference, 'same input, same result'); }
  }
  const best = Object.fromEntries(Object.entries(times).map(([method, list]) => [method, Math.min(...list)]));
  console.log(`[cost#13] best of 3: moving average ${best.moving_average.toFixed(0)} ms, FIFO ${best.fifo.toFixed(0)} ms`);
  assert.ok(best.moving_average < 300, `moving average ${best.moving_average} ms`);
  assert.ok(best.fifo < 300, `FIFO ${best.fifo} ms`);
});
