// ADR-027 — erp-analytics-core.js (pure): periods and dates, the measure split into lines, series, comparisons,
// top movers, ABC, reorder point, the demo history. Every expected number is worked by hand in the comment beside it.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const load = name => import(pathToFileURL(path.join(ROOT, name)).href);
const core = () => load('erp-analytics-core.js');
const close = (actual, expected, eps = 1e-9, what = '') => assert.ok(Math.abs(actual - expected) <= eps, `${what} ${actual} ≠ ${expected}`);

test('ac#1 % change: "—" (null) on a zero base, |base| for a negative base, never Infinity/NaN', async () => {
  const c = await core();
  assert.equal(c.percentChange(0, 0), null);
  assert.equal(c.percentChange(50, 0), null);
  assert.equal(c.percentChange(50, 100), -50);
  assert.equal(c.percentChange(150, 100), 50);
  assert.equal(c.percentChange(-20, -40), 50, '(−20 − −40) / 40 = +50 %: less negative is up');
  assert.equal(c.percentChange(NaN, 10), null);
  assert.equal(c.percentChange(10, Infinity), null);
  // 49,700 against 135,000 → −63.185…% (the shape of the brief's sentence "ซื้อลดลง 42%").
  close(c.percentChange(49700, 135000), -63.18518518518518, 1e-12);
});

test('ac#2 months, leap years and date arithmetic (UTC days; 2028 is a leap year, 2100 is not)', async () => {
  const c = await core();
  assert.equal(c.daysInMonth(2028, 2), 29);
  assert.equal(c.daysInMonth(2026, 2), 28);
  assert.equal(c.daysInMonth(2100, 2), 28);
  assert.equal(c.daysInMonth(2000, 2), 29);
  assert.equal(c.daysInMonthOf('2026-10'), 31);
  assert.equal(c.addDaysIso('2028-02-28', 1), '2028-02-29');
  assert.equal(c.addDaysIso('2028-02-29', 1), '2028-03-01');
  assert.equal(c.addDaysIso('2026-12-31', 1), '2027-01-01');
  assert.equal(c.addDaysIso('2026-10-14', 11), '2026-10-25');
  assert.equal(c.parseIsoDate('2026-02-29'), null, 'no 29 Feb in 2026');
  assert.deepEqual(c.parseIsoDate('2028-02-29'), { year: 2028, month: 2, day: 29 });
  assert.equal(c.currentMonthKey('2026-10-14'), '2026-10');
  assert.equal(c.lastClosedMonthKey('2026-10-14'), '2026-09');
  assert.equal(c.lastClosedMonthKey('2026-01-05'), '2025-12', 'January → previous December');
  assert.equal(c.addMonths('2026-01', -1), '2025-12');
  assert.equal(c.addMonths('2025-11', 14), '2027-01');
  assert.deepEqual(c.monthRange('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.deepEqual(c.monthRange('2026-02', '2025-11'), []);
  assert.equal(c.isMonthKey('2026-13'), false);
});

test('ac#3 labels: พ.ศ. in Thai, ค.ศ. in English', async () => {
  const c = await core();
  assert.equal(c.displayDate('2026-10-17', 'th'), '17/10/2569');
  assert.equal(c.displayDate('2026-10-17', 'en'), '17/10/2026');
  assert.equal(c.displayDate('2028-02-29', 'th'), '29/02/2571');
  assert.equal(c.monthLabel('2026-10', 'th'), 'ตุลาคม 2569');
  assert.equal(c.monthLabel('2026-10', 'en'), 'October 2026');
  assert.equal(c.monthLabel('2026-10', 'th', { short: true }), 'ต.ค. 69');
  assert.equal(c.monthLabel('2026-10', 'en', { short: true }), 'Oct 26');
  assert.equal(c.monthRangeLabel('2024-06', '2026-09', 'th'), 'มิ.ย. 2567 – ก.ย. 2569');
  assert.equal(c.monthRangeLabel('2024-06', '2026-09', 'en'), 'Jun 2024 – Sep 2026');
  assert.equal(c.periodLabel({ type: 'quarter', value: '2026-Q3' }, 'th'), 'ไตรมาส 3/2569');
  assert.equal(c.periodLabel({ type: 'quarter', value: '2026-Q3' }, 'en'), 'Q3 2026');
  assert.equal(c.periodLabel({ type: 'year', value: '2026' }, 'th'), 'ปี 2569');
  assert.equal(c.periodLabel({ type: 'year', value: '2026' }, 'en'), '2026');
});

test('ac#4 comparison windows: like for like, closed months only, January and partial quarters', async () => {
  const c = await core();
  const jan = c.comparisonWindows({ type: 'month', value: '2026-01' }, '2026-09');
  assert.deepEqual([jan.current, jan.previous, jan.lastYear], [['2026-01'], ['2025-12'], ['2025-01']]);
  const q3 = c.comparisonWindows({ type: 'quarter', value: '2026-Q3' }, '2026-08');
  assert.equal(q3.partial, true);
  assert.deepEqual(q3.current, ['2026-07', '2026-08'], 'September is not closed yet');
  assert.deepEqual(q3.previous, ['2026-04', '2026-05'], 'the same two months of Q2');
  assert.deepEqual(q3.lastYear, ['2025-07', '2025-08']);
  const year = c.comparisonWindows({ type: 'year', value: '2026' }, '2026-09');
  assert.equal(year.current.length, 9);
  assert.deepEqual(year.previous, year.lastYear, 'for a year, previous period = last year');
  assert.equal(c.comparisonWindows({ type: 'month', value: '2026-10' }, '2026-09').available, false, 'the current month is never compared');
  assert.equal(c.comparisonWindows({ type: 'month', value: 'x' }, '2026-09').available, false);
  assert.deepEqual(c.listPeriods('quarter', '2025-11', '2026-02').map(p => p.value), ['2026-Q1', '2025-Q4']);
});

test('ac#5 the measure split into lines adds up exactly; cancelled documents count 0', async () => {
  const c = await core();
  const pack = {
    invoices: [
      { id: 1, no: 'INV-1', date: '2026-09-03', customer: 'บจก. ทดสอบ', subtotal: 1000, items: [{ productCode: 'P1', product: 'A', qty: 2, saleTotal: 600 }, { productCode: 'P2', product: 'B', qty: 1, saleTotal: 400 }] },
      { id: 2, no: 'INV-2', date: '2026-09-04', customer: 'บจก. ทดสอบ', subtotal: 333.33, items: [{ productCode: 'P1', qty: 1, saleTotal: 100 }, { productCode: 'P1', qty: 1, saleTotal: 100 }, { productCode: 'P2', qty: 1, saleTotal: 100 }] },
      { id: 3, no: 'INV-3', date: '2026-09-05', customer: 'บจก. ทดสอบ', subtotal: 500, status: 'cancelled', items: [{ productCode: 'P1', qty: 5, saleTotal: 500 }] }
    ]
  };
  const rows = c.packSalesRows(pack, { branch: 'ubon', year: 2026, month: 8 }, {});
  assert.equal(rows.length, 2, 'the cancelled invoice is not a measure row');
  assert.equal(c.packSalesTotal(rows), 1333.33);
  assert.equal(c.packCancelledCount(pack), 1);
  assert.equal(c.packHasSalesDocuments(pack), true);
  assert.equal(c.packHasSalesDocuments({ quotes: [{}] }), false);
  const lines = c.salesLinesOfRows(rows, { branch: 'ubon', period: '2026-09' });
  const cents = lines.reduce((sum, line) => sum + Math.round(line.value * 100), 0);
  assert.equal(cents, 133333, 'Σ lines = Σ rows to the satang (333.33 split 111.11 / 111.11 / 111.11)');
  assert.ok(lines.every(line => line.branch === 'ubon' && line.period === '2026-09'));
  // 1,000 → 600 + 400 by the item values; the customer key is case/space-insensitive.
  assert.deepEqual(lines.slice(0, 2).map(line => [line.productKey, line.value]), [['code:p1', 600], ['code:p2', 400]]);
  assert.equal(c.customerIdentity('  บจก.  ทดสอบ ').customerKey, c.customerIdentity('บจก. ทดสอบ').customerKey);
  assert.equal(c.customerIdentity('').customerKey, c.UNKNOWN_CUSTOMER_KEY);
});

test('ac#6 monthly series: explicit zero months, nothing after the last closed month', async () => {
  const c = await core();
  const lines = [
    { period: '2026-01', value: 100, qty: 1 }, { period: '2026-03', value: 50, qty: 2 }, { period: '2026-03', value: 25.005, qty: 0.5 },
    { period: '2026-05', value: 999, qty: 9 }, { period: '2025-10', value: 0, qty: 0 }
  ];
  const totals = c.monthlyTotals(lines);
  const series = c.buildMonthlySeries(totals, { endKey: '2026-04' });
  assert.deepEqual(series.months, ['2026-01', '2026-02', '2026-03', '2026-04'], 'starts at the first non-zero month');
  assert.deepEqual(series.values, [100, 0, 75.01, 0]);
  assert.deepEqual(c.buildMonthlySeries(totals, { endKey: '2026-04', field: 'qty' }).values, [1, 0, 2.5, 0]);
  assert.deepEqual(c.buildMonthlySeries(new Map(), { endKey: '2026-04' }).values, []);
  assert.deepEqual(c.buildMonthlySeries(totals, { endKey: '2026-04', startKey: '2025-12' }).values, [0, 100, 0, 75.01, 0]);
  // Moving (window) sums: Q1 2026 = Jan + Feb + Mar = 100 + 0 + 75.005 → 175.01 (rounded once, at the end);
  // the same quarter a year earlier has no sales → % "—".
  const L = l => ({ ...l, branch: 'ubon', source: 'document', productKey: 'code:x', customerKey: 'c', category: 'x' });
  const q1 = c.compareByDimension(lines.map(L), 'product', c.comparisonWindows({ type: 'quarter', value: '2026-Q1' }, '2026-04'));
  assert.equal(q1.total.current, 175.01);
  assert.equal(q1.total.previous, 0, 'Q4 2025 (Oct 0 + Nov 0 + Dec 0)');
  assert.equal(q1.total.pctLastYear, null);
});

test('ac#7 comparisons and top movers: abs and %, "—" on a zero base, ties by key', async () => {
  const c = await core();
  const L = (period, customer, value) => ({ period, branch: 'ubon', source: 'document', ...c.customerIdentity(customer), productKey: 'code:x', category: 'c', qty: 1, value });
  const lines = [
    L('2026-09', 'A', 100), L('2025-09', 'A', 200), L('2026-08', 'A', 50),
    L('2026-09', 'B', 300), L('2025-09', 'B', 0),
    L('2025-09', 'C', 85300), L('2026-09', 'C', 0),
    L('2026-09', 'D', 10), L('2025-09', 'D', 20), L('2026-09', 'E', 10), L('2025-09', 'E', 20)
  ];
  const windows = c.comparisonWindows({ type: 'month', value: '2026-09' }, '2026-09');
  const { rows, total } = c.compareByDimension(lines, 'customer', windows);
  const byName = Object.fromEntries(rows.map(row => [row.sample.customer, row]));
  assert.equal(byName.A.changeLastYear, -100);
  assert.equal(byName.A.pctLastYear, -50);
  assert.equal(byName.A.changePrevious, 50);
  assert.equal(byName.A.pctPrevious, 100);
  assert.equal(byName.B.pctLastYear, null, 'new customer: % shown as —');
  assert.equal(byName.B.changeLastYear, 300);
  assert.equal(byName.C.pctLastYear, -100);
  assert.equal(total.current, 420);
  assert.equal(total.lastYear, 85540);
  const movers = c.topMovers(rows, 'lastYear', 5);
  assert.deepEqual(movers.growers.map(row => row.sample.customer), ['B']);
  assert.deepEqual(movers.decliners.map(row => row.sample.customer), ['C', 'A', 'D', 'E'], 'D and E tie at −10: by key');
});

test('ac#8 ABC: A until the item that crosses 80 %, B to 95 %, C the rest; ties share a class', async () => {
  const c = await core();
  // 50 starts at 0 % → A · 30 starts at 50 % → A (crosses 80) · 10 starts at 80 % → B · 5 at 90 % → B ·
  // 3 at 95 % → C · 2 at 98 % → C.
  const r = c.abcClassify([['f', 2], ['a', 50], ['e', 3], ['b', 30], ['d', 5], ['c', 10]].map(([key, value]) => ({ key, value })));
  assert.deepEqual(r.items.map(item => `${item.key}${item.abc}`), ['aA', 'bA', 'cB', 'dB', 'eC', 'fC']);
  assert.deepEqual([r.summary.A.count, r.summary.B.count, r.summary.C.count], [2, 2, 2]);
  assert.deepEqual([r.summary.A.share, r.summary.B.share, r.summary.C.share], [80, 15, 5]);
  assert.equal(r.total, 100);
  // A tie across the 80 % line: all four 10s share the class of the first one (it starts at 70 % → A).
  const tie = c.abcClassify([['x', 70], ['p', 10], ['q', 10], ['r', 10]].map(([key, value]) => ({ key, value })));
  assert.deepEqual(tie.items.map(item => item.abc), ['A', 'A', 'A', 'A']);
  // Same value: order by key, deterministic whatever the input order.
  const one = c.abcClassify([{ key: 'b', value: 5 }, { key: 'a', value: 5 }]);
  const two = c.abcClassify([{ key: 'a', value: 5 }, { key: 'b', value: 5 }]);
  assert.deepEqual(one.items.map(item => item.key), ['a', 'b']);
  assert.deepEqual(JSON.parse(JSON.stringify(one)), JSON.parse(JSON.stringify(two)));
  // No sales: "ไม่มีการขาย" for a stocked item with stock, C otherwise; never ranked.
  const zero = c.abcClassify([{ key: 's', value: 0, stocked: true, onHand: 4 }, { key: 't', value: 0, stocked: true, onHand: 0 }, { key: 'u', value: -5 }, { key: 'v', value: 1 }]);
  assert.deepEqual(zero.items.map(item => `${item.key}${item.abc}`), ['vA', 'snone', 'tC', 'uC']);
  assert.equal(zero.summary.none.count, 1);
  // Exact boundary in satang: 80.00 of 100.00 starts B (not A) — no floating drift.
  const exact = c.abcClassify([{ key: 'a', value: 0.8 }, { key: 'b', value: 0.15 }, { key: 'c', value: 0.05 }]);
  assert.deepEqual(exact.items.map(item => item.abc), ['A', 'B', 'C']);
});

test('ac#9 reorder point by hand: F = 31/month, σ = √31, L = 9 days, 95 % (z 1.65)', async () => {
  const c = await core();
  // d = 31 ÷ 31 = 1/day · σ_daily = √31 ÷ √31 = 1 · SS = 1.65 × 1 × √9 = 4.95 · ROP = 9 + 4.95 = 13.95 ·
  // order-up-to = 1 × (9 + 30) + 4.95 = 43.95 · suggested = ⌈43.95 − 20 − 5⌉ = ⌈18.95⌉ = 19 ·
  // days of cover = 20 ÷ 1 = 20 → stock-out 14/10 + 20 = 03/11/2026 · order by = 14/10 + ⌊(25 − 13.95) ÷ 1⌋ = 25/10/2026.
  const input = { monthlyForecast: 31, monthlySigma: Math.sqrt(31), daysInMonth: 31, leadTimeDays: 9, reviewDays: 30, serviceLevel: 95, onHand: 20, openPo: 5, today: '2026-10-14' };
  const p = c.reorderPlan(input);
  assert.equal(p.status, 'ok');
  close(p.dailyDemand, 1); close(p.sigmaDaily, 1, 1e-12); close(p.safetyStock, 4.95, 1e-12); close(p.reorderPoint, 13.95, 1e-12);
  close(p.orderUpTo, 43.95, 1e-12);
  assert.equal(p.suggestedQty, 19);
  assert.equal(p.daysOfCover, 20);
  assert.equal(p.stockoutDate, '2026-11-03');
  assert.equal(p.orderByDate, '2026-10-25');
  assert.equal(p.orderNow, false);
  assert.equal(p.alert, true);
  assert.equal(p.severity, 'medium');
  assert.equal(c.reorderPlan({ ...input, openPo: 0 }).suggestedQty, 24, 'without the open PO: ⌈23.95⌉');
  // 99 %: SS = 2.33 × 3 = 6.99 · 90 %: 1.28 × 3 = 3.84.
  close(c.reorderPlan({ ...input, serviceLevel: 99 }).safetyStock, 6.99, 1e-12);
  close(c.reorderPlan({ ...input, serviceLevel: 90 }).safetyStock, 3.84, 1e-12);
  // At or under the reorder point: order today, high severity.
  const low = c.reorderPlan({ ...input, onHand: 8, openPo: 0 });
  assert.equal(low.orderNow, true); assert.equal(low.orderByDate, '2026-10-14'); assert.equal(low.severity, 'high');
  // Plenty of stock: no order, no alert.
  const plenty = c.reorderPlan({ ...input, onHand: 100 });
  assert.equal(plenty.suggestedQty, 0); assert.equal(plenty.alert, false);
  // February of a leap year: 29 days → d = 29 ÷ 29.
  close(c.reorderPlan({ ...input, monthlyForecast: 29, monthlySigma: 0, daysInMonth: 29 }).dailyDemand, 1);
});

test('ac#10 reorder edge cases: no demand, negative stock, unknown σ, lead time defaults', async () => {
  const c = await core();
  const base = { monthlyForecast: 30, monthlySigma: 3, daysInMonth: 30, leadTimeDays: 7, onHand: 5, today: '2026-10-14' };
  assert.equal(c.reorderPlan({ ...base, monthlyForecast: 0 }).status, 'no-demand');
  assert.equal(c.reorderPlan({ ...base, monthlyForecast: 0 }).alert, false);
  assert.equal(c.reorderPlan({ ...base, monthlyForecast: null }).status, 'no-forecast');
  const negative = c.reorderPlan({ ...base, onHand: -2 });
  assert.equal(negative.status, 'negative-stock'); assert.equal(negative.alert, true); assert.equal(negative.suggestedQty, null);
  const noSigma = c.reorderPlan({ ...base, monthlySigma: null });
  assert.equal(noSigma.sigmaKnown, false); assert.equal(noSigma.safetyStock, 0);
  assert.equal(c.reorderPlan({ ...base, openPo: -9 }).openPo, 0, 'a negative open PO is ignored');
  assert.deepEqual(c.productLeadTime({}), { days: 7, isDefault: true });
  assert.deepEqual(c.productLeadTime({ leadTimeDays: '' }), { days: 7, isDefault: true });
  assert.deepEqual(c.productLeadTime({ leadTimeDays: 0 }), { days: 7, isDefault: true });
  assert.deepEqual(c.productLeadTime({ leadTimeDays: 21 }), { days: 21, isDefault: false });
  assert.equal(c.isStockTracked({ flowType: 'inventory', fulfillmentType: 'stock' }), true);
  assert.equal(c.isStockTracked({ flowType: 'service', fulfillmentType: 'service' }), false);
  assert.equal(c.isStockTracked({ flowType: 'inventory', fulfillmentType: 'made_to_order' }), false);
});

test('ac#11 demo history: strict reader, used only where no document exists, deterministic generator', async () => {
  const c = await core();
  const seed = await load('erp-demo-seed-core.js');
  const good = { schemaVersion: 1, kind: c.DEMO_HISTORY_KIND, demoSeed: true, columns: [...c.DEMO_HISTORY_COLUMNS], rows: [['2025-01', 'ubon', 'DEMO-NB01', 'ลูกค้าทั่วไป / เงินสด', 2, 31000], ['2025-01', 'khonkaen', 'DEMO-NB01', 'x', 1, 15500]] };
  assert.equal(c.parseDemoSalesHistory(JSON.stringify(good)).ok, true);
  assert.deepEqual(c.parseDemoSalesHistory(null), { ok: true, history: null });
  for (const bad of ['{x', '[]', JSON.stringify({ ...good, schemaVersion: 2 }), JSON.stringify({ ...good, rows: [['2025-01', 'bkk', 'X', '', 1, 1]] }), JSON.stringify({ ...good, rows: [['2025-13', 'ubon', 'X', '', 1, 1]] })]) {
    assert.equal(c.parseDemoSalesHistory(bad).ok, false, bad.slice(0, 40));
  }
  const covered = (branch, period) => branch === 'khonkaen' && period === '2025-01';
  const lines = c.historyLines(good, { covered });
  assert.equal(lines.length, 1, 'the Khon Kaen month has documents → its history row is not used');
  assert.equal(lines[0].customerKey, c.ANALYTICS_WALK_IN_KEY);
  assert.deepEqual(c.historyCoverage(good, covered), { months: 2, replaced: ['khonkaen|2025-01'] });
  const plan = seed.buildDemoSeedPlan({ today: '2026-10-14' });
  const one = seed.buildDemoSalesHistory(plan);
  const two = seed.buildDemoSalesHistory(seed.buildDemoSeedPlan({ today: '2026-10-14' }));
  assert.deepEqual(one, two, 'same date → byte-identical history');
  assert.equal(c.parseDemoSalesHistory(JSON.stringify(one)).ok, true);
  assert.equal(one.start, c.addMonths(one.storyPeriod, -27));
  assert.ok(JSON.stringify(one).length < 80000, 'summarised history stays small');
  const first = seed.demoSeedFirstSalesMonths(plan);
  for (const branch of ['ubon', 'khonkaen']) {
    const periods = one.rows.filter(row => row[1] === branch).map(row => row[0]);
    assert.ok(periods.every(period => period < first[branch]), `${branch}: history stops before the first sales document`);
  }
  // ADR-013 two clocks: on any load date the history follows the story month S (latest closed month): it starts
  // at S − 27 and meets the first sales document, so the analysis always has 28 closed months up to S.
  for (const [day, story] of [['2026-10-13', '2026-09'], ['2026-11-20', '2026-10'], ['2027-01-03', '2026-12'], ['2028-03-01', '2028-02']]) {
    const p = seed.buildDemoSeedPlan({ today: day });
    const h = seed.buildDemoSalesHistory(p);
    assert.deepEqual([h.storyPeriod, h.start], [story, c.addMonths(story, -27)], day);
    const f = seed.demoSeedFirstSalesMonths(p);
    for (const branch of ['ubon', 'khonkaen']) {
      const months = [...new Set(h.rows.filter(row => row[1] === branch).map(row => row[0]))].sort();
      assert.equal(months[0], h.start, `${day} ${branch} starts at S − 27`);
      assert.equal(months.at(-1), c.addMonths(f[branch], -1), `${day} ${branch}: no gap before the first document`);
    }
  }
  const single = seed.buildDemoSalesHistory(seed.buildDemoSeedPlan({ today: '2026-10-14', branchCount: 1 }));
  assert.ok(single.rows.every(row => row[1] === 'ubon'), 'one establishment: head office only (ADR-022)');
});

test('ac#12 performance: 200 products × 36 months × 2 branches aggregated and forecast in < 200 ms', async () => {
  const c = await core();
  const f = await load('erp-forecast-core.js');
  const months = c.monthRange('2023-10', '2026-09');
  const lines = [];
  for (let p = 0; p < 200; p += 1) {
    months.forEach((period, i) => {
      for (const branch of ['ubon', 'khonkaen']) lines.push({ period, branch, productKey: `code:p${p}`, customerKey: 'c', category: 'x', source: 'document', qty: 1 + ((p * 7 + i * 3) % 11), value: 100 + ((p * 13 + i * 17) % 97) + i * 2 });
    });
  }
  const run = () => {
    const byProduct = new Map();
    for (const line of lines) { if (!byProduct.has(line.productKey)) byProduct.set(line.productKey, []); byProduct.get(line.productKey).push(line); }
    let ok = 0;
    for (const productLines of byProduct.values()) {
      const series = c.buildMonthlySeries(c.monthlyTotals(productLines), { endKey: '2026-09', field: 'qty' });
      if (f.forecastSeries(series.values).status === 'ok') ok += 1;
    }
    c.abcClassify([...byProduct.keys()].map((key, i) => ({ key, value: i })));
    return ok;
  };
  run();
  const started = process.hrtime.bigint();
  const ok = run();
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.equal(ok, 200);
  assert.ok(ms < 200, `took ${ms.toFixed(1)} ms`);
});
