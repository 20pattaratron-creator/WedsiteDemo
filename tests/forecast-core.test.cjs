// ADR-027 — erp-forecast-core.js (pure). Hand-worked recursions, and figures of an independent numpy implementation
// (scripts/forecast-reference.py, written from the ADR text: same initial states, grids, holdout rule and rails).
// Every "reference" number below was printed by `python3 -I scripts/forecast-reference.py` (numpy 2.4.4).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const load = () => import(pathToFileURL(path.join(ROOT, 'erp-forecast-core.js')).href);
const close = (actual, expected, eps = 1e-9, what = '') => assert.ok(Math.abs(actual - expected) <= eps, `${what} ${actual} ≠ ${expected}`);
// The 36-month seasonal fixture of the reference script: level 100, trend +2 / month, a fixed season, a wiggle.
const PATTERN = [-10, -8, -2, -25, -12, 0, 2, 4, 10, 12, 20, 9];
const SEASONAL36 = Array.from({ length: 36 }, (_, t) => 100 + 2 * t + PATTERN[t % 12] + ((t * 7) % 5 - 2));

test('fc#1 SES by hand: [10,12,11,13,12], α = 0.5 → residuals 2,0,2,0, SSE 8, forecast 12', async () => {
  const f = await load();
  const fit = f.sesFit([10, 12, 11, 13, 12], 0.5);
  // ℓ1 = 10; t2: e = 2, ℓ = 11; t3: e = 0; t4: e = 2, ℓ = 12; t5: e = 0.
  assert.deepEqual(fit.residuals, [2, 0, 2, 0]);
  assert.equal(fit.sse, 8);
  assert.equal(f.fitForecast(fit, 1), 12);
  assert.equal(f.fitForecast(fit, 3), 12, 'SES is flat');
  assert.equal(f.sesFit([5], 0.5), null, 'needs two months');
});

test('fc#2 Holt by hand: [10,12,15,14,18,20], α = 0.5, β = 0.2 (ℓ2 = 12, b2 = 2)', async () => {
  const f = await load();
  const fit = f.holtFit([10, 12, 15, 14, 18, 20], 0.5, 0.2);
  // t3: ŷ 14, e 1, ℓ 14.5, b 2.1 · t4: ŷ 16.6, e −2.6, ℓ 15.3, b 1.84 · t5: ŷ 17.14, e 0.86, ℓ 17.57, b 1.926 ·
  // t6: ŷ 19.496, e 0.504, ℓ 19.748, b 1.9764 (the numpy reference gives the same).
  [1, -2.6, 0.86, 0.504].forEach((value, i) => close(fit.residuals[i], value, 1e-12, `e${i + 3}`));
  close(fit.sse, 8.753616, 1e-12, 'sse');
  close(fit.level, 19.748, 1e-12, 'level');
  close(fit.trend, 1.9764, 1e-12, 'trend');
  close(f.fitForecast(fit, 2), 19.748 + 2 * 1.9764, 1e-12, 'h2');
  assert.equal(f.holtFit([1, 2], 0.5, 0.2), null, 'needs three months');
});

test('fc#3 Holt-Winters: initial state of a straight line is exact; fixed parameters match numpy', async () => {
  const f = await load();
  // y = 1…24: mean of season 1 = 6.5, season 2 = 18.5 → b = 1, ℓ12 = 6.5 + 5.5 × 1 = 12 = y12, every sⱼ = 0.
  const line = Array.from({ length: 30 }, (_, t) => t + 1);
  const fit = f.hwFit(line, 0.3, 0.1, 0.1);
  close(fit.sse, 0, 1e-18, 'a straight line has no one-step error');
  fit.season.forEach((value, j) => close(value, 0, 1e-12, `s${j}`));
  close(f.fitForecast(fit, 1), 31, 1e-9, 'continues the line');
  assert.equal(f.hwFit(line.slice(0, 23), 0.3, 0.1, 0.1), null, 'needs two full seasons');
  // Reference (numpy) on the 36-month seasonal fixture with α 0.3, β 0.1, γ 0.1.
  const w = f.hwFit(SEASONAL36, 0.3, 0.1, 0.1);
  close(w.level, 169.79160430797262, 1e-9, 'level');
  close(w.trend, 1.9805379609630007, 1e-9, 'trend');
  close(w.sse, 169.3102956437737, 1e-8, 'sse');
  [-11.299532911028663, -8.128522017341478, -0.037431018740196026, -25.620827109282104, -11.039640475741713, -1.3059325692228023, 1.843385750311444, 5.916839571521743, 9.31920471067353, 12.888984170649477, 18.613630542994162, 8.755818819675927]
    .forEach((value, j) => close(w.season[j], value, 1e-9, `s${j}`));
  [160.47260935790695, 165.62415821255715, 175.69578717212144].forEach((value, i) => close(f.fitForecast(w, i + 1), value, 1e-9, `h${i + 1}`));
});

test('fc#4 method choice and parameters equal the numpy reference on four series', async () => {
  const f = await load();
  const cases = [
    { name: 'seasonal 36 months → Holt-Winters', values: SEASONAL36, horizon: 6, method: 'hw', params: [0.1, 0.05, 0.3], holdout: 6, metric: 'mape', sigma: 2.243752400511574,
      errors: { holt: 4.229767513758124, ses: 10.492260479133327, hw: 1.221223964495427 },
      forecast: [[161.758256038287, 158.88266296179137, 164.6338491147826], [165.2866590816932, 161.21995635304688, 169.3533618103395], [175.36137605821102, 170.38070274782729, 180.34204936859476], [152.78232054882616, 147.0311343958349, 158.53350670181743], [168.35768094315628, 161.9276593484843, 174.78770253782827], [181.7645523095156, 174.72081656422122, 188.80828805481]] },
    { name: 'trend 8 months → Holt', values: [20, 22, 25, 24, 28, 30, 31, 35], horizon: 3, method: 'holt', params: [0.1, 0.05], holdout: 3, metric: 'mape', sigma: 1.1329480660129845,
      errors: { holt: 2.135429329877111, ses: 13.348856118791602 },
      forecast: [[35.91891502461686, 34.46692878321462, 37.3709012660191], [37.91595342857465, 35.86253479360447, 39.96937206354484], [39.912991832532455, 37.398077890532804, 42.42790577453211]] },
    { name: 'flat 12 months → SES (the trend made the holdout worse)', values: [50, 52, 48, 51, 49, 50, 53, 47, 50, 51, 49, 50], horizon: 3, method: 'ses', params: [0.1], holdout: 3, metric: 'mape', sigma: 1.736327308485424,
      errors: { holt: 1.7833471193231483, ses: 1.362147893338673 },
      forecast: [[49.958785621219995, 47.73350854266508, 52.18406269977491], [49.958785621219995, 46.811768596689646, 53.105802645750344], [49.958785621219995, 46.10449266024443, 53.81307858219556]] },
    { name: 'zero months → sMAPE', values: [5, 0, 3, 0, 4, 6, 0, 2, 5, 0], horizon: 3, method: 'ses', params: [0.2], holdout: 3, metric: 'smape', sigma: 2.9771029256248402,
      errors: { holt: 133.33333333333331, ses: 96.67311848500768 },
      forecast: [[2.60658176, 0, 6.422036869480795], [2.60658176, 0, 8.002450122453464], [2.60658176, 0, 9.21514386361901]] }
  ];
  for (const c of cases) {
    const r = f.forecastSeries(c.values, { horizon: c.horizon });
    assert.equal(r.status, 'ok', c.name);
    assert.equal(r.method, c.method, c.name);
    assert.deepEqual(Object.values(r.params), c.params, c.name);
    assert.equal(r.selection.holdout, c.holdout, c.name);
    assert.equal(r.selection.metric, c.metric, c.name);
    close(r.sigma, c.sigma, 1e-9, `${c.name} σ`);
    for (const [method, error] of Object.entries(c.errors)) close(r.selection.candidates.find(row => row.method === method).error, error, 1e-9, `${c.name} ${method}`);
    assert.equal(r.selection.candidates.length, Object.keys(c.errors).length, `${c.name}: Holt-Winters only from 27 months`);
    c.forecast.forEach(([value, lower, upper], i) => {
      close(r.forecast[i].value, value, 1e-9, `${c.name} h${i + 1}`);
      close(r.forecast[i].lower, lower, 1e-9, `${c.name} lower h${i + 1}`);
      close(r.forecast[i].upper, upper, 1e-9, `${c.name} upper h${i + 1}`);
    });
    assert.equal(r.accuracy.value, r.selection.candidates.find(row => row.method === c.method).error, `${c.name}: the accuracy shown is the chosen method's holdout error`);
  }
});

test('fc#5 thresholds: < 6 months no forecast, nothing ever sold, invalid input; holdout lengths', async () => {
  const f = await load();
  const five = f.forecastSeries([1, 2, 3, 4, 5]);
  assert.equal(five.status, 'insufficient');
  assert.equal(five.reason, 'too-few-months');
  assert.deepEqual(five.forecast, []);
  assert.equal(f.forecastSeries([1, 2, 3, 4, 5, 6]).status, 'ok', 'six months are enough');
  const zeros = f.forecastSeries([0, 0, 0, 0, 0, 0, 0]);
  assert.equal(zeros.status, 'insufficient');
  assert.equal(zeros.reason, 'no-sales', 'never a confident 0 from nothing');
  for (const bad of [[1, 2, 3, 4, 5, NaN], [1, 2, 3, 4, 5, Infinity], [1, 2, 3, 4, 5, '6'], [1, 2, 3, 4, 5, null], 'abc', null]) assert.equal(f.forecastSeries(bad).status, 'invalid');
  const expected = { 6: 3, 11: 3, 12: 3, 15: 3, 16: 4, 20: 5, 23: 5, 24: 6, 26: 6, 27: 3, 28: 4, 29: 5, 30: 6, 36: 6, 60: 6 };
  for (const [n, h] of Object.entries(expected)) assert.equal(f.holdoutLength(Number(n)), h, `n = ${n}`);
  assert.equal(f.holdoutLength(5), 0);
  // 24–26 months: Holt-Winters is named as not testable; 27: it competes.
  const r24 = f.forecastSeries(SEASONAL36.slice(0, 24));
  assert.match(r24.selection.reason, /hw-not-testable/);
  assert.equal(r24.selection.hwEligible, false);
  const r27 = f.forecastSeries(SEASONAL36.slice(0, 27));
  assert.equal(r27.selection.hwEligible, true);
  assert.ok(r27.selection.candidates.some(row => row.method === 'hw'));
});

test('fc#6 the ~80% band widens with √h and is clamped at 0; the 3× cap; negative forecasts → 0', async () => {
  const f = await load();
  const r = f.forecastSeries([20, 22, 25, 24, 28, 30, 31, 35], { horizon: 3 });
  const half = h => r.forecast[h - 1].upper - r.forecast[h - 1].value;
  close(half(1), f.INTERVAL_Z80 * r.sigma, 1e-12, 'h1 half width');
  close(half(2) / half(1), Math.SQRT2, 1e-12, '√2');
  close(half(3) / half(1), Math.sqrt(3), 1e-12, '√3');
  close(r.forecast[0].value - r.forecast[0].lower, half(1), 1e-12, 'symmetric when not clamped');
  // Lower edge clamped at 0 (sales cannot be negative).
  const z = f.forecastSeries([5, 0, 3, 0, 4, 6, 0, 2, 5, 0]);
  assert.ok(z.forecast.every(row => row.lower === 0 && row.upper > row.value));
  // A trend that would pass 3 × the highest month is cut there and flagged. Net-negative months (returns) then a
  // steady rise: max 10 → cap 30; the line continues 20, 30, 40, … → h ≥ 3 are capped at 30.
  const steep = f.forecastSeries([-50, -40, -30, -20, -10, 0, 10], { horizon: 6 });
  assert.equal(steep.method, 'holt');
  assert.equal(steep.cap, 30);
  close(steep.forecast[0].value, 20, 1e-9, 'h1');
  close(steep.forecast[2].raw, 40, 1e-9, 'raw h3');
  assert.equal(steep.forecast[2].value, 30);
  assert.equal(steep.forecast[2].capped, true);
  assert.equal(steep.flags.capped, true);
  assert.ok(steep.forecast.every(row => row.value <= 30 && row.upper <= 30));
  // A falling straight line reaches 0 and would go below: shown as 0, flagged.
  const falling = f.forecastSeries([100, 90, 80, 70, 60, 50, 40, 30, 20, 10], { horizon: 3 });
  assert.equal(falling.flags.clamped, true);
  assert.ok(falling.forecast.every(row => row.value >= 0 && row.lower >= 0));
  close(falling.forecast[1].raw, -10, 1e-9, 'raw h2');
  assert.equal(falling.forecast[1].value, 0);
  // guardForecast / intervalFor directly.
  assert.deepEqual(f.guardForecast(-5, 100), { value: 0, clamped: true, capped: false });
  assert.deepEqual(f.guardForecast(150, 100), { value: 100, clamped: false, capped: true });
  assert.deepEqual(f.guardForecast(NaN, 100), { value: null, clamped: false, capped: false });
  assert.deepEqual(f.intervalFor(10, 10, 4, 100), { lower: 0, upper: 10 + f.INTERVAL_Z80 * 10 * 2 });
  assert.deepEqual(f.intervalFor(10, null, 1, 100), { lower: null, upper: null });
  assert.equal(f.forecastCap([3, 7, 5]), 21);
  assert.equal(f.forecastCap([0, -2]), 0);
});

test('fc#7 MAPE vs sMAPE: zero (or negative) actuals switch to sMAPE; hand-worked values; labels', async () => {
  const f = await load();
  assert.equal(f.errorMetricFor([5, 3, 2]), 'mape');
  assert.equal(f.errorMetricFor([5, 0, 2]), 'smape');
  assert.equal(f.errorMetricFor([5, -1, 2]), 'smape');
  close(f.mape([100, 200], [110, 180]), 10, 1e-12, '(10% + 10%) / 2');
  assert.equal(f.mape([100, 0], [100, 0]), null, 'MAPE cannot divide by 0');
  close(f.smape([0, 10], [0, 0]), 100, 1e-12, '0 (both zero) + 200 → 100');
  close(f.smape([100], [50]), 2 * 50 / 150 * 100, 1e-12, 'sMAPE');
  // All-zero test months: the error exists for choosing, but accuracy is "not measurable", never "good".
  const r = f.forecastSeries([4, 6, 5, 7, 6, 5, 0, 0, 0]);
  assert.equal(r.status, 'ok');
  assert.equal(r.accuracy.metric, 'smape');
  assert.equal(r.accuracy.value, null);
  assert.equal(r.accuracy.label, null);
  assert.equal(f.accuracyLabel(14.999), 'good');
  assert.equal(f.accuracyLabel(15), 'fair');
  assert.equal(f.accuracyLabel(30), 'fair');
  assert.equal(f.accuracyLabel(30.0001), 'caution');
  assert.equal(f.accuracyLabel(null), null);
  assert.equal(f.accuracyLabel(NaN), null);
  // Holdout diagnostics (Quant views): errors −10 and +20 on actuals 100 / 200.
  const d = f.holdoutDiagnostics([100, 200], [110, 180]);
  close(d.wape, 10, 1e-12, 'WAPE 30 / 300');
  close(d.biasPct, 10 / 3, 1e-12, 'bias 10 / 300');
  close(d.mae, 15, 1e-12, 'MAE');
  close(d.trackingSignal, 10 / 15, 1e-12, 'TS');
  assert.equal(f.holdoutDiagnostics([], []), null);
});

test('fc#8 coverage, outliers kept (never removed), determinism, no mutation', async () => {
  const f = await load();
  const spike = [10, 11, 10, 12, 11, 10, 11, 12, 10, 90, 11, 10, 11, 12];
  const copy = spike.slice();
  const a = f.forecastSeries(spike);
  const b = f.forecastSeries(spike);
  assert.deepEqual(a, b, 'same input → same output');
  assert.deepEqual(spike, copy, 'input not changed');
  assert.deepEqual(a.outliers, [9], 'the 90 of month 10 is reported');
  assert.equal(a.n, 14, 'every month, spike included, is used');
  assert.ok(a.accuracy.coverage.total === a.selection.holdout && a.accuracy.coverage.inside >= 0);
  assert.deepEqual(f.residualOutliers([1, -1, 1, -1, 40, 1]), [4]);
  assert.deepEqual(f.residualOutliers([1, 2, 3]), [], 'too few residuals to judge');
});

test('fc#9 performance: 200 product series × 36 months forecast in < 200 ms', async () => {
  const f = await load();
  let seed = 42;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const series = Array.from({ length: 200 }, (_, p) => Array.from({ length: 36 }, (_, t) => Math.max(0, Math.round(20 + p % 7 + 0.3 * t + 6 * Math.sin((t % 12) / 12 * 2 * Math.PI) + (random() - 0.5) * 8))));
  let best = Infinity;
  for (let run = 0; run < 3; run += 1) {
    const started = process.hrtime.bigint();
    for (const values of series) f.forecastSeries(values, { horizon: 3 });
    best = Math.min(best, Number(process.hrtime.bigint() - started) / 1e6);
  }
  assert.ok(best < 200, `took ${best.toFixed(1)} ms`);
});
