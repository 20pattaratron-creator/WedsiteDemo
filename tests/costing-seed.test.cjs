// ADR-028 (round 11) — the costing story of the sample data (erp-demo-seed-core.js buildDemoCostingStory), pure:
// the four jobs, their materials / labour / overhead / other costs, budgets and revenue are the SAME on every load
// date (the ADR-013 two clocks: J1 follows its invoice U3, J2–J4 and the receipts are pinned to the calendar), the
// story never takes stock below zero, and the figures are the ones docs/DEMO_SCRIPT_TH.md / _EN.md state.
// Hand-worked (baht; overhead rate 180,000 ÷ 2,400 h = 75 / h; ช่างสมศักดิ์ 150 / h, ทีมติดตั้ง A 220 / h):
//   J1 U3 รพ.รวมแพทย์   materials RACK 4,800 + CAB6 4 × 3,200 + RJ45 2 × 650 + PATCH 2 × 900 = 20,700 − return CAB6 3,200
//                        = 17,500 · labour 24 h × 150 + 16 h × 220 = 7,120 · overhead 40 h × 75 = 3,000 · subcontract
//                        1,500 → 29,120; revenue 26,500 − CN 1,500 = 25,000 → GP −4,120 (−16.5 %); budget 13,400
//                        (materials 9,800: over by 7,700).
//   J2 U6 รพ.รวมแพทย์   CLEAN 3 × 350 = 1,050 · 12 h × 150 = 1,800 · 12 h × 75 = 900 → 3,750; 13,500 → 9,750 (72.2 %).
//   J3 K3 อีสานโลจิสติกส์ CAB6 at the สาขา average (5 × 3,200 + 10 × 3,350) ÷ 15 = 3,300 + RJ45 650 + PATCH 2 × 900 = 5,750
//                        · 24 h × 220 = 5,280 · 24 h × 75 = 1,800 · 1,600 → 14,430; 15,500 → 1,070 (6.9 %).
//   J4 K8 อีสานโลจิสติกส์ CLEAN 2 × 350 + RJ45 650 = 1,350 · 20 h × 220 = 4,400 · 20 h × 75 = 1,500 · 1,200 → 8,450;
//                        9,000 → 550 (6.1 %).  Customer อีสานโลจิสติกส์: 24,500 − 22,880 = 1,620 (6.6 %) — the low-margin one.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const load = name => import(pathToFileURL(path.join(ROOT, name)).href);
// Load dates: early / mid / late month, a month end, across the year end and the BE year, a leap day.
const DATES = ['2026-10-05', '2026-10-14', '2026-10-21', '2026-11-30', '2027-01-08', '2027-03-31', '2028-02-29', '2028-03-01'];
const EXPECTED = {
  J1: { invoice: 'U3', customer: 'รพ.รวมแพทย์อุบล', materials: 1750000, labour: 712000, overhead: 300000, other: 150000, total: 2912000, revenue: 2500000, budget: 1340000 },
  J2: { invoice: 'U6', customer: 'รพ.รวมแพทย์อุบล', materials: 105000, labour: 180000, overhead: 90000, other: 0, total: 375000, revenue: 1350000, budget: 390000 },
  J3: { invoice: 'K3', customer: 'บจก. อีสานโลจิสติกส์ เอ็กซ์เพรส', materials: 575000, labour: 528000, overhead: 180000, other: 160000, total: 1443000, revenue: 1550000, budget: 1210000 },
  J4: { invoice: 'K8', customer: 'บจก. อีสานโลจิสติกส์ เอ็กซ์เพรส', materials: 135000, labour: 440000, overhead: 150000, other: 120000, total: 845000, revenue: 900000, budget: 572000 }
};
const sheetsOf = (seed, plan) => {
  const out = {};
  const costs = seed.demoSeedJobCosts(plan);
  for (const [key, expected] of Object.entries(plan.expected.jobs)) {
    const job = costs.jobs.find(row => row.no === expected.no);
    out[key] = { job, sheet: costs.sheets.get(job.key) };
  }
  return { out, costs };
};
// Revenue of a job = its invoice before VAT − live credit notes on it (the analytics measure; no debit note on these).
const revenueOf = (plan, invoiceNo) => {
  const docs = plan.documents;
  const invoice = docs.find(d => d.collection === 'invoices' && d.record.no === invoiceNo).record;
  const credited = docs.filter(d => d.collection === 'creditNotes' && !d.record.voided && (d.record.invoiceNo === invoiceNo || (d.record.invoiceNos || []).includes(invoiceNo))).reduce((sum, d) => sum + d.record.subtotal, 0);
  return Math.round((invoice.subtotal - credited) * 100);
};

test('cseed#1 the four jobs cost the same on every load date; revenue, profit and margin are the demo-script figures', async () => {
  const seed = await load('erp-demo-seed-core.js');
  for (const today of DATES) {
    const plan = seed.buildDemoSeedPlan({ today });
    const { out, costs } = sheetsOf(seed, plan);
    assert.deepEqual(costs.issues, [], `${today}: no costing data issue`);
    assert.equal(costs.result.negatives.length, 0, `${today}: stock never below zero`);
    for (const [key, expected] of Object.entries(EXPECTED)) {
      const { job, sheet } = out[key];
      const where = `${today} ${key} ${job.no}`;
      assert.equal(plan.expected.jobs[key].invoice, plan.expected.invoices[expected.invoice].no, where);
      assert.equal(job.customer, expected.customer, where);
      assert.deepEqual([sheet.materials.net, sheet.labour.amount, sheet.overhead.amount, sheet.other.amount, sheet.total], [expected.materials, expected.labour, expected.overhead, expected.other, expected.total], where);
      assert.equal(sheet.status, 'completed', where);
      assert.equal(sheet.budget.total, expected.budget, where);
      assert.equal(revenueOf(plan, plan.expected.invoices[expected.invoice].no), expected.revenue, where);
      // Every cost row of the job lies between its order date and its invoice, in the invoice's month.
      const invoiceDate = plan.documents.find(d => d.collection === 'invoices' && d.record.no === plan.expected.invoices[expected.invoice].no).record.date;
      const rows = [...plan.costing.jobStore.entries.filter(e => e.jobKey === job.key), ...plan.costing.movements.filter(m => m.jobKey === job.key)];
      assert.ok(rows.length >= 3, where);
      for (const row of rows) assert.ok(row.date >= job.date && row.date <= invoiceDate && row.date.slice(0, 7) === invoiceDate.slice(0, 7), `${where} ${row.kind} ${row.date}`);
    }
    // J1 lost money because its materials ran 7,700 over the 9,800 budget.
    assert.equal(out.J1.sheet.materials.net - out.J1.sheet.budget.byCategory.materials, 770000);
  }
});

test('cseed#2 the story: one very profitable job, one loss from materials, one low-margin customer (hand-worked %)', async () => {
  const seed = await load('erp-demo-seed-core.js');
  const plan = seed.buildDemoSeedPlan({ today: '2026-10-21' });
  const pct = (gp, revenue) => Math.round(gp / revenue * 1000) / 10;
  const gp = key => EXPECTED[key].revenue - EXPECTED[key].total;
  assert.deepEqual(['J1', 'J2', 'J3', 'J4'].map(key => [gp(key), pct(gp(key), EXPECTED[key].revenue)]), [[-412000, -16.5], [975000, 72.2], [107000, 6.9], [55000, 6.1]]);
  const c5 = { revenue: EXPECTED.J3.revenue + EXPECTED.J4.revenue, cost: EXPECTED.J3.total + EXPECTED.J4.total };
  assert.deepEqual([c5.revenue, c5.cost, c5.revenue - c5.cost, pct(c5.revenue - c5.cost, c5.revenue)], [2450000, 2288000, 162000, 6.6]);
  // The settings of the story: 75 baht / h overhead (OpenStax predetermined rate), the people and their rates.
  const job = await load('erp-job-costing-core.js');
  assert.equal(job.overheadRateBaht(plan.costing.settings), 75);
  assert.deepEqual(plan.costing.settings.personRates.map(p => [p.name, p.rate]), [['ช่างสมศักดิ์', 150], ['ทีมติดตั้ง A', 220]]);
  assert.equal(plan.costing.settings.method, 'moving_average');
  // NRV: the 9U rack expected to sell for 4,500 less 300 to sell = 4,200 < cost 4,800 → write-down 600 per rack; one is
  // left at each branch (HQ 2 − 1 for J1, สาขา 1) → 1,200. Every other item sells above its cost (no write-down).
  const costing = await load('erp-costing-core.js');
  const { result } = seed.demoSeedJobCosts(plan);
  const products = [...plan.products, ...plan.costing.products];
  const report = costing.buildNrvReport(costing.valuationAt(result, '2026-10-21'), plan.costing.settings.nrv, products);
  const rack = report.rows.filter(row => row.sku === 'code:rm-rack').map(row => [row.branch, row.qty, row.cost, row.nrvValue, row.writeDown, row.priceSource]).sort();
  assert.deepEqual(rack, [['khonkaen', 1, 480000, 420000, 60000, 'entered'], ['ubon', 1, 480000, 420000, 60000, 'entered']]);
  assert.equal(report.totals.writeDown, 120000);
  assert.equal(report.totals.cost - report.totals.lowerOfCostAndNrv, 120000);
  assert.deepEqual(report.missing, []);
});

test('cseed#3 one establishment: everything at the head office; J1 / J2 unchanged, J3 / J4 take the pooled average (documented)', async () => {
  const seed = await load('erp-demo-seed-core.js');
  for (const today of ['2026-10-05', '2027-01-08']) {
    const plan = seed.buildDemoSeedPlan({ today, branchCount: 1 });
    const { out, costs } = sheetsOf(seed, plan);
    assert.equal(costs.result.negatives.length, 0);
    assert.ok([...plan.costing.movements, ...plan.costing.purchaseOrders, ...plan.costing.goodsReceipts, ...plan.costing.jobStore.entries].every(row => row.branch === 'ubon'));
    assert.equal(out.J1.sheet.total, EXPECTED.J1.total);
    assert.equal(out.J2.sheet.total, EXPECTED.J2.total);
    // J3: CAB6 at the head office = 13 opening at 3,200 − 4 + 1 for J1 = 10 at 3,200; then the receipt of 10 at 3,350
    // (day −9 of the month before S). J3 takes 1 on day −8, BEFORE the receipt of 10 at 3,410 (day −7):
    // (10 × 3,200 + 10 × 3,350) ÷ 20 = 3,275 → materials 3,275 + 650 + 2 × 900 = 5,725 → total 14,405 (two branches: 14,430).
    assert.equal(out.J3.sheet.materials.net, 572500);
    assert.equal(out.J3.sheet.total, 1440500);
  }
});
