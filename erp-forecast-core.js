// ============================================================================
// erp-forecast-core.js — monthly sales forecasting (ADR-027, round 10)
// ERP DEMO 4.3.1 · pure: no DOM, no storage, no clock, no randomness
// ----------------------------------------------------------------------------
// One engine for every sales forecast the app shows (the page "วิเคราะห์และคาดการณ์", the dashboard
// "คาดการณ์" tab and the Quant views all call forecastSeries()). Input: one number per CLOSED month,
// oldest first, with months without sales already filled with 0 by the caller (erp-analytics-core.js
// buildMonthlySeries). The current, incomplete month is never part of the input.
//
// Method by the number of months n (all choices are deterministic):
//   n < 6           → no forecast ("ข้อมูลยังไม่พอคาดการณ์").
//   6 ≤ n < 27      → Holt's linear trend; simple exponential smoothing (SES) replaces it when SES has the
//                     lower error on the holdout ("the trend makes it worse").
//   n ≥ 27          → additive Holt-Winters (season 12) against the Holt/SES winner on the holdout; the
//                     lower error wins. Holt-Winters needs two full seasons (24 months) to initialise and
//                     at least 3 test months, hence 27 (24–26 months: Holt/SES, and the result says why).
// Holdout = the last H months: H = min(6, n − 24) when n ≥ 27, otherwise clamp(floor(n / 4), 3, 6).
// Each candidate is fitted on the first n − H months (smoothing constants by grid search minimising the
// one-step-ahead SSE) and forecasts the H test months 1…H steps ahead, post-processed exactly like a real
// forecast (clamped at 0, capped at 3 × the training maximum). Error = MAPE, or sMAPE when a test actual
// is 0 or negative (MAPE divides by it). Ties keep the simpler rule's choice (Holt over SES only when SES is
// not strictly better; Holt-Winters only when strictly better).
// The chosen method is then refitted on all n months (same grid) for the forecast.
//
// Initial states (documented; scripts/forecast-reference.py reproduces them with numpy):
//   SES          ℓ₁ = y₁; for t = 2…n: ŷₜ = ℓₜ₋₁, ℓₜ = ℓₜ₋₁ + α(yₜ − ŷₜ). Forecast ℓₙ.
//   Holt         ℓ₂ = y₂, b₂ = y₂ − y₁; for t = 3…n: ŷₜ = ℓₜ₋₁ + bₜ₋₁,
//                ℓₜ = α yₜ + (1 − α)(ℓₜ₋₁ + bₜ₋₁), bₜ = β(ℓₜ − ℓₜ₋₁) + (1 − β) bₜ₋₁. Forecast ℓₙ + h·bₙ.
//   Holt-Winters b₁₂ = (mean(y₁₃…y₂₄) − mean(y₁…y₁₂)) / 12, ℓ₁₂ = mean(y₁…y₁₂) + 5.5·b₁₂ (the first season's mean
//                sits at its centre, month 6.5), sⱼ = yⱼ − (mean(y₁…y₁₂) + (j − 6.5)·b₁₂) (j = 1…12, sum 0);
//                for t = 13…n: ŷₜ = ℓₜ₋₁ + bₜ₋₁ + sₜ₋₁₂, ℓₜ = α(yₜ − sₜ₋₁₂) + (1 − α)(ℓₜ₋₁ + bₜ₋₁),
//                bₜ = β(ℓₜ − ℓₜ₋₁) + (1 − β) bₜ₋₁, sₜ = γ(yₜ − ℓₜ) + (1 − γ) sₜ₋₁₂. Forecast ℓₙ + h·bₙ + sₙ₊ₕ₋₁₂.
// The SSE of each fit is the sum of the one-step errors of the t-ranges above.
//
// Prediction interval (~80 %): point ± 1.2816 · σ · √h, σ = root mean square of the final fit's one-step
// residuals (needs ≥ 3 of them), clamped to [0, cap]. √h widening assumes independent monthly errors; it
// is an approximation, not a guarantee — the result also reports how many holdout actuals fell inside the
// band the training fit would have drawn (coverage).
// Safety rails: a negative forecast becomes 0 (flag `clamped`); a forecast above 3 × the largest monthly
// value of the history is cut to that cap (flag `capped`). Months whose one-step residual exceeds 3 × the
// RMS of all other residuals are reported as unusual (`outliers`); they are never removed.
// ============================================================================

export const FORECAST_CORE_VERSION = '1.1.0'; // 1.1.0 (round 11): compareForecastLevels (category vs product level)
export const FORECAST_MIN_MONTHS = 6;
export const SEASON_LENGTH = 12;
export const HW_MIN_TRAIN_MONTHS = 2 * SEASON_LENGTH;
export const HOLDOUT_MIN_MONTHS = 3;
export const HOLDOUT_MAX_MONTHS = 6;
export const HW_MIN_MONTHS = HW_MIN_TRAIN_MONTHS + HOLDOUT_MIN_MONTHS;
// Φ⁻¹(0.90): a two-sided 80 % normal band.
export const INTERVAL_Z80 = 1.2816;
export const INTERVAL_MIN_RESIDUALS = 3;
export const CAP_MULTIPLE = 3;
export const OUTLIER_SIGMAS = 3;
export const OUTLIER_MIN_RESIDUALS = 4;
// Accuracy labels: < 15 % good · 15–30 % fair · > 30 % caution (the error of the chosen method on the holdout).
export const ACCURACY_GOOD_BELOW = 15;
export const ACCURACY_FAIR_UP_TO = 30;
export const FORECAST_HORIZONS = Object.freeze([3, 6]);
// Small deterministic grids (literal values, so every platform sees exactly the same numbers).
export const SES_ALPHAS = Object.freeze([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]);
export const HOLT_ALPHAS = SES_ALPHAS;
export const HOLT_BETAS = Object.freeze([0.05, 0.1, 0.2, 0.3]);
export const HW_ALPHAS = SES_ALPHAS;
export const HW_BETAS = Object.freeze([0.05, 0.1, 0.2]);
export const HW_GAMMAS = Object.freeze([0.05, 0.1, 0.3]);
export const FORECAST_METHODS = Object.freeze(['ses', 'holt', 'hw']);

// ---------------------------------------------------------------- input checks
// A series is usable when it is an array of finite numbers. Negative months are allowed (net credit notes can
// exceed sales in a month); the forecast itself is clamped at 0 afterwards.
export function isUsableSeries(values) {
  return Array.isArray(values) && values.every(value => typeof value === 'number' && Number.isFinite(value));
}

// Holdout length H for a series of n months (see the header).
export function holdoutLength(n) {
  const count = Math.floor(Number(n));
  if (!Number.isFinite(count) || count < FORECAST_MIN_MONTHS) return 0;
  if (count >= HW_MIN_MONTHS) return Math.min(HOLDOUT_MAX_MONTHS, count - HW_MIN_TRAIN_MONTHS);
  return Math.min(HOLDOUT_MAX_MONTHS, Math.max(HOLDOUT_MIN_MONTHS, Math.floor(count / 4)));
}

// ---------------------------------------------------------------- the three recursions
// Each fit returns the final state, the one-step residuals and their SSE. Fits that cannot run return null.
export function sesFit(y, alpha) {
  if (!Array.isArray(y) || y.length < 2) return null;
  let level = y[0];
  const residuals = [];
  let sse = 0;
  for (let t = 1; t < y.length; t += 1) {
    const error = y[t] - level;
    residuals.push(error);
    sse += error * error;
    level += alpha * error;
  }
  return { method: 'ses', params: { alpha }, level, trend: 0, season: null, n: y.length, residuals, sse };
}

export function holtFit(y, alpha, beta) {
  if (!Array.isArray(y) || y.length < 3) return null;
  let level = y[1];
  let trend = y[1] - y[0];
  const residuals = [];
  let sse = 0;
  for (let t = 2; t < y.length; t += 1) {
    const predicted = level + trend;
    const error = y[t] - predicted;
    residuals.push(error);
    sse += error * error;
    const nextLevel = alpha * y[t] + (1 - alpha) * predicted;
    trend = beta * (nextLevel - level) + (1 - beta) * trend;
    level = nextLevel;
  }
  return { method: 'holt', params: { alpha, beta }, level, trend, season: null, n: y.length, residuals, sse };
}

export function hwFit(y, alpha, beta, gamma, m = SEASON_LENGTH) {
  if (!Array.isArray(y) || y.length < 2 * m) return null;
  let first = 0;
  let second = 0;
  for (let i = 0; i < m; i += 1) { first += y[i]; second += y[m + i]; }
  first /= m;
  second /= m;
  let trend = (second - first) / m;
  // The first season's mean is the level at its centre (index (m − 1) / 2); the level at its last month adds
  // the trend for the remaining (m − 1) / 2 months. Seasonal indices are measured from that trend line, so a
  // trend is not mistaken for seasonality (they sum to 0).
  const centre = (m - 1) / 2;
  let level = first + trend * centre;
  // season[j] belongs to every time index t with t % m === j (0-based), updated in place.
  const season = [];
  for (let j = 0; j < m; j += 1) season.push(y[j] - (first + trend * (j - centre)));
  const residuals = [];
  let sse = 0;
  for (let t = m; t < y.length; t += 1) {
    const slot = t % m;
    const seasonal = season[slot];
    const predicted = level + trend + seasonal;
    const error = y[t] - predicted;
    residuals.push(error);
    sse += error * error;
    const nextLevel = alpha * (y[t] - seasonal) + (1 - alpha) * (level + trend);
    trend = beta * (nextLevel - level) + (1 - beta) * trend;
    season[slot] = gamma * (y[t] - nextLevel) + (1 - gamma) * seasonal;
    level = nextLevel;
  }
  return { method: 'hw', params: { alpha, beta, gamma }, level, trend, season, n: y.length, residuals, sse };
}

// Point forecast h months after the last fitted month (h ≥ 1), before clamping / capping.
export function fitForecast(fit, h) {
  if (!fit || !Number.isInteger(h) || h < 1) return NaN;
  if (fit.method === 'ses') return fit.level;
  if (fit.method === 'holt') return fit.level + h * fit.trend;
  if (fit.method === 'hw') {
    const m = fit.season.length;
    // The month n − 1 + h (0-based) uses the latest seasonal state of its slot (h ≤ m: updated at n − 1 + h − m).
    return fit.level + h * fit.trend + fit.season[(fit.n - 1 + h) % m];
  }
  return NaN;
}

// Grid search: the smallest one-step SSE wins; the first combination in grid order wins a tie.
export function bestFit(method, y) {
  let best = null;
  const consider = fit => { if (fit && Number.isFinite(fit.sse) && (!best || fit.sse < best.sse)) best = fit; };
  if (method === 'ses') for (const alpha of SES_ALPHAS) consider(sesFit(y, alpha));
  else if (method === 'holt') for (const alpha of HOLT_ALPHAS) for (const beta of HOLT_BETAS) consider(holtFit(y, alpha, beta));
  else if (method === 'hw') for (const alpha of HW_ALPHAS) for (const beta of HW_BETAS) for (const gamma of HW_GAMMAS) consider(hwFit(y, alpha, beta, gamma));
  return best;
}

export function methodMinimumMonths(method) {
  if (method === 'ses') return 2;
  if (method === 'holt') return 3;
  if (method === 'hw') return HW_MIN_TRAIN_MONTHS;
  return Infinity;
}

// ---------------------------------------------------------------- error measures
// MAPE: mean |A − F| / |A| × 100 — undefined when an actual is 0, so the series then uses sMAPE.
// sMAPE: mean 2|A − F| / (|A| + |F|) × 100 (0 … 200); a month where both are 0 counts as 0.
export function errorMetricFor(actuals) {
  return (Array.isArray(actuals) ? actuals : []).some(value => !(value > 0)) ? 'smape' : 'mape';
}
export function mape(actuals, forecasts) {
  if (!Array.isArray(actuals) || !actuals.length || actuals.length !== forecasts?.length) return null;
  let total = 0;
  for (let i = 0; i < actuals.length; i += 1) {
    if (actuals[i] === 0) return null;
    total += Math.abs(actuals[i] - forecasts[i]) / Math.abs(actuals[i]);
  }
  return (total / actuals.length) * 100;
}
export function smape(actuals, forecasts) {
  if (!Array.isArray(actuals) || !actuals.length || actuals.length !== forecasts?.length) return null;
  let total = 0;
  for (let i = 0; i < actuals.length; i += 1) {
    const denominator = Math.abs(actuals[i]) + Math.abs(forecasts[i]);
    if (denominator > 0) total += (2 * Math.abs(actuals[i] - forecasts[i])) / denominator;
  }
  return (total / actuals.length) * 100;
}
export function forecastError(metric, actuals, forecasts) {
  return metric === 'mape' ? mape(actuals, forecasts) : smape(actuals, forecasts);
}
// Error figures of one holdout (actual − forecast), for the Quant views: WAPE = Σ|e| / Σ|A| × 100, bias % =
// Σe / Σ|A| × 100 (> 0: the forecast was too low), tracking signal = Σe / MAD. null when there is no holdout.
export function holdoutDiagnostics(actuals, forecasts) {
  if (!Array.isArray(actuals) || !actuals.length || !Array.isArray(forecasts) || actuals.length !== forecasts.length) return null;
  const errors = actuals.map((actual, index) => actual - forecasts[index]);
  const absActual = actuals.reduce((sum, actual) => sum + Math.abs(actual), 0);
  const absError = errors.reduce((sum, error) => sum + Math.abs(error), 0);
  const sumError = errors.reduce((sum, error) => sum + error, 0);
  const mae = absError / errors.length;
  return {
    n: errors.length,
    wape: absActual > 0 ? (absError / absActual) * 100 : null,
    biasPct: absActual > 0 ? (sumError / absActual) * 100 : null,
    trackingSignal: mae > 0 ? sumError / mae : 0,
    mae,
    rmse: Math.sqrt(errors.reduce((sum, error) => sum + error * error, 0) / errors.length)
  };
}
// 'good' | 'fair' | 'caution' | null (no error figure).
export function accuracyLabel(errorPercent) {
  if (errorPercent === null || errorPercent === undefined || !Number.isFinite(errorPercent)) return null;
  if (errorPercent < ACCURACY_GOOD_BELOW) return 'good';
  if (errorPercent <= ACCURACY_FAIR_UP_TO) return 'fair';
  return 'caution';
}

// ---------------------------------------------------------------- safety rails
export function seriesMaximum(values) {
  let max = -Infinity;
  for (const value of values) if (value > max) max = value;
  return Number.isFinite(max) ? max : 0;
}
// Cap = 3 × the largest monthly value (0 when the history has no positive month).
export function forecastCap(values) {
  const max = seriesMaximum(values);
  return max > 0 ? CAP_MULTIPLE * max : 0;
}
// Clamps one raw forecast into [0, cap] and says what happened.
export function guardForecast(raw, cap) {
  if (!Number.isFinite(raw)) return { value: null, clamped: false, capped: false };
  if (raw < 0) return { value: 0, clamped: true, capped: false };
  if (raw > cap) return { value: cap, clamped: false, capped: true };
  return { value: raw, clamped: false, capped: false };
}
export function residualSigma(residuals) {
  if (!Array.isArray(residuals) || residuals.length < INTERVAL_MIN_RESIDUALS) return null;
  let sum = 0;
  for (const value of residuals) sum += value * value;
  return Math.sqrt(sum / residuals.length);
}
// ~80 % band for step h around an already guarded point forecast, clamped to [0, cap].
export function intervalFor(point, sigma, h, cap) {
  if (point === null || !Number.isFinite(point) || sigma === null || !Number.isFinite(sigma) || !(h >= 1)) return { lower: null, upper: null };
  const half = INTERVAL_Z80 * sigma * Math.sqrt(h);
  const lower = Math.min(cap, Math.max(0, point - half));
  const upper = Math.min(cap, Math.max(0, point + half));
  return { lower, upper };
}
// One-step residual index i is unusual when |eᵢ| > 3 × RMS of all the other residuals.
export function residualOutliers(residuals) {
  if (!Array.isArray(residuals) || residuals.length < OUTLIER_MIN_RESIDUALS) return [];
  let total = 0;
  for (const value of residuals) total += value * value;
  const out = [];
  residuals.forEach((value, index) => {
    const others = (total - value * value) / (residuals.length - 1);
    const sigma = Math.sqrt(Math.max(0, others));
    if (Math.abs(value) > OUTLIER_SIGMAS * sigma && Math.abs(value) > 1e-9) out.push(index);
  });
  return out;
}
// Index (0-based, in the series) of the month each residual of a fit belongs to.
export function residualOffset(method) {
  if (method === 'ses') return 1;
  if (method === 'holt') return 2;
  if (method === 'hw') return SEASON_LENGTH;
  return 0;
}

// ---------------------------------------------------------------- holdout comparison
// Fits `method` on the first n − H months and forecasts the H test months 1…H steps ahead.
export function holdoutCandidate(method, values, h, metric) {
  const train = values.slice(0, values.length - h);
  const actuals = values.slice(values.length - h);
  if (train.length < methodMinimumMonths(method)) return { method, eligible: false, reason: 'too-short', error: null, forecasts: [], actuals, lower: [], upper: [] };
  const fit = bestFit(method, train);
  if (!fit) return { method, eligible: false, reason: 'too-short', error: null, forecasts: [], actuals, lower: [], upper: [] };
  const cap = forecastCap(train);
  const sigma = residualSigma(fit.residuals);
  const forecasts = [];
  const lower = [];
  const upper = [];
  for (let step = 1; step <= h; step += 1) {
    const point = guardForecast(fitForecast(fit, step), cap).value;
    forecasts.push(point);
    const band = intervalFor(point, sigma, step, cap);
    lower.push(band.lower);
    upper.push(band.upper);
  }
  const error = forecasts.every(value => value !== null) ? forecastError(metric, actuals, forecasts) : null;
  return { method, eligible: error !== null, reason: error === null ? 'no-error' : '', error, params: fit.params, forecasts, actuals, lower, upper };
}

function coverageOf(candidate) {
  if (!candidate?.eligible || candidate.lower.some(value => value === null)) return null;
  let inside = 0;
  candidate.actuals.forEach((actual, index) => { if (actual >= candidate.lower[index] - 1e-9 && actual <= candidate.upper[index] + 1e-9) inside += 1; });
  return { inside, total: candidate.actuals.length };
}

// ---------------------------------------------------------------- the forecast
// values: closed months, oldest first. options.horizon: 3 (default) or 6.
// Returns a plain object; `status` is 'ok', 'insufficient' (fewer than 6 months) or 'invalid' (not numbers).
export function forecastSeries(values, options = {}) {
  const horizon = FORECAST_HORIZONS.includes(Number(options.horizon)) ? Number(options.horizon) : FORECAST_HORIZONS[0];
  const base = { version: FORECAST_CORE_VERSION, horizon, minMonths: FORECAST_MIN_MONTHS };
  if (!isUsableSeries(values)) return { ...base, status: 'invalid', n: 0, method: null, forecast: [] };
  const y = values.slice();
  const n = y.length;
  if (n < FORECAST_MIN_MONTHS) return { ...base, status: 'insufficient', reason: 'too-few-months', n, method: null, forecast: [] };
  // Nothing was ever sold (only zero / negative months): there is no level to forecast from.
  if (seriesMaximum(y) <= 0) return { ...base, status: 'insufficient', reason: 'no-sales', n, method: null, forecast: [] };
  const h = holdoutLength(n);
  const actuals = y.slice(n - h);
  const metric = errorMetricFor(actuals);
  const holt = holdoutCandidate('holt', y, h, metric);
  const ses = holdoutCandidate('ses', y, h, metric);
  // Holt is the default; SES replaces it only when it is strictly better on the holdout (or Holt cannot run).
  let trendWinner = holt;
  let reason = 'holt-default';
  if (!holt.eligible || (ses.eligible && ses.error < holt.error)) { trendWinner = ses; reason = 'trend-worse'; }
  let hw = null;
  let chosen = trendWinner;
  if (n >= HW_MIN_MONTHS) {
    hw = holdoutCandidate('hw', y, h, metric);
    if (hw.eligible && (!chosen.eligible || hw.error < chosen.error)) { chosen = hw; reason = 'hw-better'; }
    else reason = trendWinner === ses ? 'trend-worse-than-hw' : 'holt-better-than-hw';
  } else if (n >= HW_MIN_TRAIN_MONTHS) reason = trendWinner === ses ? 'trend-worse-hw-not-testable' : 'hw-not-testable';
  const fit = bestFit(chosen.method, y);
  if (!fit) return { ...base, status: 'insufficient', reason: 'too-few-months', n, method: null, forecast: [] };
  const cap = forecastCap(y);
  const sigma = residualSigma(fit.residuals);
  const forecast = [];
  for (let step = 1; step <= horizon; step += 1) {
    const raw = fitForecast(fit, step);
    const guarded = guardForecast(raw, cap);
    const band = intervalFor(guarded.value, sigma, step, cap);
    forecast.push({ h: step, raw, value: guarded.value, lower: band.lower, upper: band.upper, clamped: guarded.clamped, capped: guarded.capped });
  }
  const offset = residualOffset(fit.method);
  const outliers = residualOutliers(fit.residuals).map(index => index + offset);
  // An error figure needs real sales in the test months (all zeros → "cannot be judged", never "accurate").
  const testHasSales = actuals.some(value => value !== 0);
  const accuracyValue = testHasSales ? chosen.error : null;
  const candidates = [holt, ses, ...(hw ? [hw] : [])].map(candidate => ({ method: candidate.method, eligible: candidate.eligible, error: candidate.error, params: candidate.params || null, forecasts: candidate.forecasts, actuals: candidate.actuals }));
  return {
    ...base,
    status: 'ok',
    n,
    method: fit.method,
    params: fit.params,
    selection: { reason, metric, holdout: h, candidates, hwEligible: n >= HW_MIN_MONTHS },
    accuracy: { metric, value: accuracyValue, label: accuracyLabel(accuracyValue), months: h, coverage: coverageOf(chosen) },
    sigma,
    residualCount: fit.residuals.length,
    cap,
    histMax: seriesMaximum(y),
    forecast,
    outliers,
    flags: { capped: forecast.some(row => row.capped), clamped: forecast.some(row => row.clamped) }
  };
}

// ---------------------------------------------------------------- forecast level: category vs its products (round 11)
// Which level forecasts a category better: forecasting the category's monthly total directly ("top-down", one series)
// or adding up the forecasts of its products ("bottom-up")? Both are judged on the same last LEVEL_TEST_MONTHS closed
// months, fitted only on the months before them (forecastSeries, 1…3 steps ahead — exactly as a real forecast).
// A product whose own history is too short (or has no sales) adds the mean of its last up-to-3 training months
// (a naive forecast, flagged `naiveMembers`) — leaving it out would make the bottom-up total too low.
// Error = WAPE = Σ|actual − forecast| ÷ Σ|actual| × 100 (MAPE would divide by months without sales). Lower wins;
// a difference under LEVEL_TIE_POINTS percentage points is a tie (the simpler category level is then suggested).
// groupValues: the category's closed months, oldest first; memberValues: one array per product, same months.
export const LEVEL_TEST_MONTHS = 3;
export const LEVEL_TIE_POINTS = 0.5;
function naiveForecast(values) {
  const tail = values.slice(-Math.min(3, values.length));
  if (!tail.length) return 0;
  return Math.max(0, tail.reduce((sum, value) => sum + value, 0) / tail.length);
}
function wape(actuals, forecasts) {
  const denominator = actuals.reduce((sum, value) => sum + Math.abs(value), 0);
  if (!(denominator > 0)) return null;
  return actuals.reduce((sum, value, index) => sum + Math.abs(value - forecasts[index]), 0) / denominator * 100;
}
export function compareForecastLevels(groupValues, memberValues = []) {
  const h = LEVEL_TEST_MONTHS;
  const base = { testMonths: h, members: Array.isArray(memberValues) ? memberValues.length : 0 };
  if (!isUsableSeries(groupValues) || !Array.isArray(memberValues) || memberValues.some(values => !isUsableSeries(values) || values.length !== groupValues.length)) return { ...base, status: 'invalid' };
  const n = groupValues.length;
  const train = n - h;
  if (train < FORECAST_MIN_MONTHS) return { ...base, status: 'insufficient', n };
  const actuals = groupValues.slice(train);
  const top = forecastSeries(groupValues.slice(0, train), { horizon: h });
  if (top.status !== 'ok') return { ...base, status: 'insufficient', n };
  const topDown = top.forecast.map(row => row.value);
  const bottomUp = Array.from({ length: h }, () => 0);
  let naiveMembers = 0;
  for (const values of memberValues) {
    const history = values.slice(0, train);
    const result = forecastSeries(history, { horizon: h });
    if (result.status === 'ok') result.forecast.forEach((row, index) => { bottomUp[index] += row.value; });
    else {
      const level = naiveForecast(history);
      if (level > 0) naiveMembers += 1;
      for (let index = 0; index < h; index += 1) bottomUp[index] += level;
    }
  }
  const errorTop = wape(actuals, topDown);
  const errorBottom = wape(actuals, bottomUp);
  if (errorTop === null || errorBottom === null) return { ...base, status: 'no-sales', n, actuals, topDown, bottomUp };
  // One product: both levels are the same series ('single'), so there is nothing to choose.
  const better = memberValues.length === 1 ? 'single' : Math.abs(errorTop - errorBottom) < LEVEL_TIE_POINTS ? 'tie' : errorTop < errorBottom ? 'category' : 'product';
  return { ...base, status: 'ok', n, actuals, topDown, bottomUp, errorTop, errorBottom, better, naiveMembers, topMethod: top.method };
}
