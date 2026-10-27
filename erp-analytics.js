// ============================================================================
// erp-analytics.js — page "วิเคราะห์และคาดการณ์" (Analysis & Forecast, ADR-027, round 10)
// ERP DEMO 4.3.1
// ----------------------------------------------------------------------------
// Four tabs, computed lazily (only the open tab is calculated; the read of the stored data is cached until
// STORAGE_WRITTEN_EVENT): เปรียบเทียบ (this period / previous period / same period last year by product,
// customer, branch, category; top 5 growers and decliners in one sentence each) · ABC · คาดการณ์ (total and per
// product: method chosen automatically, ~80 % band, backtest accuracy, chart) · จุดสั่งซื้อ (reorder point,
// days of cover, suggested order, "สร้างใบสั่งซื้อ" that pre-fills a PO draft).
// Also: the compact reorder card on "งานของฉัน" (renderWorkCard), the forecast card of the dashboard
// "คาดการณ์" tab and of วิเคราะห์ธุรกิจ (renderEmbeddedForecast), and the forecast the Quant views simulate
// (quantForecast) — one engine (erp-forecast-core.js) on one series, so the app never shows two different
// forecasts of the same thing.
// Money = the dashboard measure (erp-analytics-core.js), plus the demo monthly history for a branch-month that has
// no sales document — always shown as its own figure, never mixed silently.
// Reads are strict (ERPIntegrity.packs): a damaged month shows "อ่านข้อมูลเดือน … ไม่ได้", never zeros.
// Every text comes from i18n/en-analytics.js (Thai and English); user data is escaped and marked data-no-i18n.
// ============================================================================
import { ANALYTICS_CORE_VERSION, UNKNOWN_PRODUCT_KEY, ADJUSTMENT_PRODUCT_KEY, UNKNOWN_CUSTOMER_KEY, ANALYTICS_WALK_IN_KEY, OTHER_CATEGORY_KEY, packSalesRows, packHasSalesDocuments, packCancelledCount, salesLinesOfRows, parseDemoSalesHistory, historyLines, historyCoverage, monthlyTotals, buildMonthlySeries, comparisonWindows, compareByDimension, topMovers, abcClassify, reorderPlan, productLeadTime, isStockTracked, SERVICE_LEVEL_Z, DEFAULT_SERVICE_LEVEL, DEFAULT_REVIEW_DAYS, REVIEW_PERIOD_OPTIONS, monthKey, parseMonthKey, monthIndex, addMonths, monthRange, daysInMonthOf, lastClosedMonthKey, currentMonthKey, addDaysIso, displayDate, monthLabel, monthRangeLabel, periodLabel, periodAllMonths, listPeriods, parsePeriod, PERIOD_TYPES } from './erp-analytics-core.js';
import { forecastSeries, holdoutDiagnostics, compareForecastLevels, LEVEL_TEST_MONTHS, FORECAST_MIN_MONTHS, FORECAST_HORIZONS, HW_MIN_MONTHS } from './erp-forecast-core.js';
import { ANALYTICS_KEYS } from './i18n/en-analytics.js';
import { translateKey } from './erp-i18n-core.js';
import { escapeHtml, localDateISO } from './erp-shared-core.js';
import { liveBranchState, liveBranchLabel, HEAD_OFFICE_BRANCH_ID, BRANCH_IDS } from './erp-branches-core.js';
import { taxCsvText, taxSafeSheetName } from './erp-tax-reports-core.js';
import { STORAGE_WRITTEN_EVENT, DEMO_SALES_HISTORY_KEY, COMPANY_PROFILE_CHANGED_EVENT } from './erp-storage-contracts.js';
import { buildStockAvailability } from './erp-product-experience-core.js';
import { icon } from './erp-icons.js';

const PANEL_ID = 'analytics-forecast';
const ROOT_ID = 'afc-root';
const TABS = Object.freeze(['compare', 'abc', 'forecast', 'reorder']);
const DIMENSIONS = Object.freeze(['product', 'customer', 'branch', 'category']);
const ABC_WINDOWS = Object.freeze([3, 6, 12, 24]);
const TOTAL_FOCUS = '__total__';
const WORK_CARD_LIMIT = 3;
const ui = { tab: 'compare', branch: 'all', periodType: 'month', period: '', search: '', dimension: 'product', basis: 'lastYear', abcWindow: 12, horizon: 3, focus: TOTAL_FOCUS, serviceLevel: DEFAULT_SERVICE_LEVEL, reviewDays: DEFAULT_REVIEW_DAYS };
const $ = id => document.getElementById(id);
const esc = value => escapeHtml(String(value ?? ''));
const storageKey = base => window.ComformTenant?.storageKey?.(base) || base;
let todayOverride = '';
let cached = null;
let current = null; // the last computed view of the open tab (tests, exports)
let helpOpener = null;
let searchTimer = null;
let lastChartWidth = 0;

// ---------------------------------------------------------------- language / formatting
const lang = () => (window.ERPI18n?.isEnglish?.() ? 'en' : 'th');
const t = (key, params = {}) => translateKey(ANALYTICS_KEYS, lang(), key, params);
// The same text as HTML: the template is escaped; a parameter given as { html } is inserted as is (already escaped).
function th(key, params = {}) {
  const entry = ANALYTICS_KEYS[key];
  if (!entry) return esc(key);
  const template = lang() === 'en' && entry.en ? entry.en : entry.th;
  return String(template).split(/(\{[A-Za-z_][\w]*\})/).map(part => {
    const match = /^\{([A-Za-z_][\w]*)\}$/.exec(part);
    if (!match) return esc(part);
    if (!Object.prototype.hasOwnProperty.call(params, match[1])) return esc(part);
    const value = params[match[1]];
    return value && typeof value === 'object' && 'html' in value ? value.html : esc(value);
  }).join('');
}
const html = value => ({ html: value });
const NUMBER_2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NUMBER_Q = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const NUMBER_0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const MINUS = '−';
function money(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  const sign = number < 0 && Math.abs(number) >= 0.005 ? MINUS : '';
  const body = NUMBER_2.format(Math.abs(number));
  return lang() === 'en' ? `${sign}THB ${body}` : `${sign}฿${body}`;
}
function signedMoney(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return Number(value) >= 0.005 ? `+${money(value)}` : money(value);
}
function percent(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  const rounded = Math.abs(number).toFixed(1);
  if (rounded === '0.0') return '0.0%';
  return `${number > 0 ? '+' : MINUS}${rounded}%`;
}
const plainPercent = value => (value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : `${Math.abs(Number(value)).toFixed(1)}%`);
// In a plain sentence the % is whole ("ซื้อลดลง 42%"); below 1 % one decimal, so a small change never reads as 0%.
const sentencePercent = value => (value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : Math.abs(Number(value)) < 1 ? `${Math.abs(Number(value)).toFixed(1)}%` : `${Math.round(Math.abs(Number(value)))}%`);
const qty = value => (value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : `${Number(value) < 0 ? MINUS : ''}${NUMBER_Q.format(Math.abs(Number(value)))}`);
const qty1 = value => (value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : (Math.round(Number(value) * 10) / 10).toFixed(1));
function compactMoney(value) {
  const number = Math.abs(Number(value) || 0);
  if (number >= 1e6) return `${(number / 1e6).toFixed(number >= 1e7 ? 0 : 1)}M`;
  if (number >= 1e3) return `${NUMBER_0.format(number / 1e3)}k`;
  return NUMBER_0.format(number);
}
const userText = value => `<span data-no-i18n>${esc(value)}</span>`;
const say = (message, type = 'info', ms) => (typeof window.notify === 'function' ? window.notify(message, type, ms) : console.info('[Analytics]', message));
const todayIso = () => todayOverride || localDateISO();

// ---------------------------------------------------------------- labels of the things analysed
function branchLabel(id) {
  return liveBranchLabel(id, undefined, window) || id;
}
function productLabelHtml(line) {
  if (line.productKey === ADJUSTMENT_PRODUCT_KEY) return esc(t('label.adjustment'));
  if (line.productKey === UNKNOWN_PRODUCT_KEY || (!line.product && !line.productCode)) return esc(t('label.unknownProduct'));
  const code = line.productCode ? `<small class="afc-code">${esc(line.productCode)}</small>` : '';
  return `${code}${userText(line.product || line.productCode)}`;
}
function productLabelText(line) {
  if (line.productKey === ADJUSTMENT_PRODUCT_KEY) return t('label.adjustment');
  if (line.productKey === UNKNOWN_PRODUCT_KEY || (!line.product && !line.productCode)) return t('label.unknownProduct');
  return line.product || line.productCode;
}
function customerLabelText(line) {
  if (line.customerKey === ANALYTICS_WALK_IN_KEY) return t('label.walkIn');
  if (line.customerKey === UNKNOWN_CUSTOMER_KEY) return t('label.unknownCustomer');
  return line.customer;
}
function customerLabelHtml(line) {
  if (line.customerKey === ANALYTICS_WALK_IN_KEY || line.customerKey === UNKNOWN_CUSTOMER_KEY) return esc(customerLabelText(line));
  return userText(line.customer);
}
function categoryLabelText(line) {
  return line.category === OTHER_CATEGORY_KEY || !line.category ? t('label.otherCategory') : line.category;
}
function categoryLabelHtml(line) {
  return line.category === OTHER_CATEGORY_KEY || !line.category ? esc(t('label.otherCategory')) : userText(line.category);
}
function dimensionLabelHtml(dimension, line) {
  if (dimension === 'product') return productLabelHtml(line);
  if (dimension === 'customer') return customerLabelHtml(line);
  if (dimension === 'branch') return `<span class="afc-branch">${esc(branchLabel(line.branch))}</span>`;
  return categoryLabelHtml(line);
}
function dimensionLabelText(dimension, line) {
  if (dimension === 'product') return productLabelText(line);
  if (dimension === 'customer') return customerLabelText(line);
  if (dimension === 'branch') return branchLabel(line.branch);
  return categoryLabelText(line);
}
function searchMatches(textValue) {
  const needle = String(ui.search || '').trim().toLowerCase();
  return !needle || String(textValue || '').toLowerCase().includes(needle);
}

// ---------------------------------------------------------------- the data (read once per storage change)
function productRows() {
  return typeof window.productMasterRows === 'function' ? window.productMasterRows() : [];
}
function productLookup(products) {
  const byCode = new Map();
  const byName = new Map();
  for (const product of products) {
    if (product?.code) byCode.set(String(product.code).trim().toLowerCase(), product);
    if (product?.name) byName.set(String(product.name).replace(/\s+/g, ' ').trim().toLowerCase(), product);
  }
  return ({ code, name }) => byCode.get(String(code || '').trim().toLowerCase()) || byName.get(String(name || '').replace(/\s+/g, ' ').trim().toLowerCase()) || null;
}
function readHistory() {
  let raw = null;
  try { raw = localStorage.getItem(storageKey(DEMO_SALES_HISTORY_KEY)); }
  catch (error) { return { ok: false, error: String(error?.message || error) }; }
  return parseDemoSalesHistory(raw);
}
// Everything the four tabs need, built from the stored documents. Kept only for the current task (like app.js
// renderBusiness): every interaction reads the store again, so a save made anywhere — even one that fires no
// event — is never shown stale.
function dataset() {
  if (cached && cached.today === todayIso()) return cached;
  const today = todayIso();
  const out = { today, lastClosed: lastClosedMonthKey(today), current: currentMonthKey(today), error: null, lines: [], cancelled: new Map(), coverage: { months: 0, replaced: [] }, history: { ok: true, used: false, error: '' }, products: [], firstMonth: '', branches: [] };
  try {
    const integrity = window.ERPIntegrity;
    const packs = integrity.packs();
    const business = integrity.business();
    const products = productRows();
    const lookup = productLookup(products);
    const options = { live: integrity.live, legacyProductions: business.productions || [], resolveInvoice: ref => integrity.resolveInvoice(ref, business) };
    const covered = new Set();
    for (const pack of packs) {
      const period = monthKey(pack.year, pack.month + 1);
      if (packHasSalesDocuments(pack.data)) covered.add(`${pack.branch}|${period}`);
      const cancelled = packCancelledCount(pack.data);
      if (cancelled) out.cancelled.set(`${pack.branch}|${period}`, cancelled);
      const rows = packSalesRows(pack.data, { branch: pack.branch, year: pack.year, month: pack.month }, options);
      out.lines.push(...salesLinesOfRows(rows, { branch: pack.branch, period, lookupProduct: lookup }));
    }
    const history = readHistory();
    if (!history.ok) out.history = { ok: false, used: false, error: history.error };
    else if (history.history) {
      const isCovered = (branch, period) => covered.has(`${branch}|${period}`);
      const lines = historyLines(history.history, { covered: isCovered, lookupProduct: lookup });
      out.lines.push(...lines);
      out.coverage = historyCoverage(history.history, isCovered);
      out.history = { ok: true, used: lines.length > 0, error: '' };
    }
    out.products = products;
    out.lookup = lookup;
    const periods = out.lines.map(line => line.period).filter(Boolean).sort();
    out.firstMonth = periods[0] || '';
    const screenIds = liveBranchState(window).ids;
    out.branches = BRANCH_IDS.filter(id => screenIds.includes(id) || out.lines.some(line => line.branch === id));
  } catch (error) {
    if (!window.ERPIntegrity?.isReadError?.(error)) throw error;
    out.error = error;
  }
  cached = out;
  const drop = () => { if (cached === out) cached = null; };
  if (typeof queueMicrotask === 'function') queueMicrotask(drop); else Promise.resolve().then(drop);
  return out;
}
// The branches the filter covers ('all' = every branch that has data or is on screen — data is never dropped).
function branchesOf(filter, data) {
  if (filter && filter !== 'all') return [filter];
  return data.branches.length ? data.branches : [HEAD_OFFICE_BRANCH_ID];
}
function branchPredicate(filter) {
  return filter && filter !== 'all' ? line => line.branch === filter : () => true;
}

// ---------------------------------------------------------------- periods
function defaultPeriod(type, data) {
  return listPeriods(type, data.firstMonth || data.lastClosed, data.lastClosed)[0]?.value || '';
}
function selectedPeriod(data) {
  const spec = { type: ui.periodType, value: ui.period };
  const available = listPeriods(ui.periodType, data.firstMonth || data.lastClosed, data.lastClosed);
  if (!parsePeriod(spec) || !available.some(row => row.value === spec.value)) return { type: ui.periodType, value: defaultPeriod(ui.periodType, data) };
  return spec;
}
// The last closed month of the selected period (the end of the ABC window and the "as of" month of a forecast).
function periodEnd(spec, data) {
  const months = periodAllMonths(spec).filter(key => monthIndex(key) <= monthIndex(data.lastClosed));
  return months.length ? months[months.length - 1] : data.lastClosed;
}
function sourceSplit(lines, months, filter) {
  const set = new Set(months);
  const inBranch = branchPredicate(filter);
  let documents = 0;
  let history = 0;
  for (const line of lines) {
    if (!set.has(line.period) || !inBranch(line)) continue;
    if (line.source === 'history') history += line.value; else documents += line.value;
  }
  return { documents: Math.round(documents * 100) / 100, history: Math.round(history * 100) / 100 };
}
function cancelledIn(data, months, filter) {
  const set = new Set(months);
  let count = 0;
  for (const [key, value] of data.cancelled) {
    const [branch, period] = key.split('|');
    if (set.has(period) && (filter === 'all' || filter === branch)) count += value;
  }
  return count;
}

// ---------------------------------------------------------------- help ("?") popovers
const HELP_TOPICS = Object.freeze(['compare', 'abc', 'forecast', 'accuracy', 'interval', 'reorder', 'history']);
function helpButton(topic) {
  return `<button type="button" class="afc-help" data-afc-help="${esc(topic)}" aria-haspopup="dialog" aria-expanded="false" aria-label="${esc(t(`help.${topic}.title`))}" title="${esc(t(`help.${topic}.title`))}">?</button>`;
}
function closeHelp({ restoreFocus = true } = {}) {
  const pop = $('afc-help-popover');
  if (!pop) return;
  pop.remove();
  if (helpOpener?.isConnected) {
    helpOpener.setAttribute('aria-expanded', 'false');
    if (restoreFocus) helpOpener.focus();
  }
  helpOpener = null;
}
function openHelp(button) {
  const topic = button?.dataset?.afcHelp;
  if (!HELP_TOPICS.includes(topic)) return;
  const same = helpOpener === button;
  closeHelp({ restoreFocus: false });
  if (same) return;
  const pop = document.createElement('div');
  pop.id = 'afc-help-popover';
  pop.className = 'afc-help-popover';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-modal', 'false');
  pop.setAttribute('aria-labelledby', 'afc-help-title');
  pop.tabIndex = -1;
  const paragraphs = ['what', 'data', 'limits'].map(part => `<p><b>${esc(t(`help.part.${part}`))}</b> ${esc(t(`help.${topic}.${part}`))}</p>`).join('');
  pop.innerHTML = `<div class="afc-help-head"><h3 id="afc-help-title">${esc(t(`help.${topic}.title`))}</h3><button type="button" class="afc-help-close" data-afc-help-close aria-label="${esc(t('help.close'))}">×</button></div>${paragraphs}`;
  document.body.append(pop);
  helpOpener = button;
  button.setAttribute('aria-expanded', 'true');
  const margin = 8;
  const width = Math.min(400, (window.innerWidth || 1024) - margin * 2);
  pop.style.width = `${width}px`;
  const rect = button.getBoundingClientRect?.() || { left: margin, bottom: margin, top: margin };
  pop.style.left = `${Math.round(Math.max(margin, Math.min(rect.left, (window.innerWidth || 1024) - width - margin)))}px`;
  pop.style.top = `${Math.round(Math.max(margin, rect.bottom + 6))}px`;
  pop.querySelector('[data-afc-help-close]')?.focus();
}

// ---------------------------------------------------------------- page shell
function tabButton(id) {
  const active = ui.tab === id;
  return `<button type="button" role="tab" id="afc-tab-${id}" class="afc-tab${active ? ' active' : ''}" data-afc-tab="${id}" aria-selected="${active}" aria-controls="afc-content" tabindex="${active ? 0 : -1}">${esc(t(`tab.${id}`))}</button>`;
}
function filtersHtml(data) {
  const ids = liveBranchState(window).ids;
  const dataBranches = data.branches.filter(id => !ids.includes(id));
  const branchIds = [...ids, ...dataBranches];
  const branchOptions = [`<option value="all"${ui.branch === 'all' ? ' selected' : ''}>${esc(branchIds.length > 1 ? t('filter.allBranches') : t('filter.company'))}</option>`]
    .concat(branchIds.length > 1 ? branchIds.map(id => `<option value="${esc(id)}"${ui.branch === id ? ' selected' : ''}>${esc(branchLabel(id))}</option>`) : []).join('');
  const periodHidden = ui.tab === 'reorder';
  const period = selectedPeriod(data);
  const periods = listPeriods(ui.periodType, data.firstMonth || data.lastClosed, data.lastClosed);
  const periodOptions = periods.map(row => `<option value="${esc(row.value)}"${row.value === period.value ? ' selected' : ''}>${esc(periodLabel(row, lang()))}</option>`).join('');
  const typeOptions = PERIOD_TYPES.map(type => `<option value="${type}"${ui.periodType === type ? ' selected' : ''}>${esc(t(`period.${type}`))}</option>`).join('');
  return `<div class="afc-filters" role="group" aria-label="${esc(t('filter.group'))}">
    <div><label for="afc-branch">${esc(t('filter.branch'))}</label><select id="afc-branch">${branchOptions}</select></div>
    ${periodHidden ? `<div class="afc-asof"><span>${esc(t('filter.dataUntil'))}</span><b>${esc(monthLabel(data.lastClosed, lang()))}</b></div>` : `<div><label for="afc-period-type">${esc(t('filter.periodType'))}</label><select id="afc-period-type">${typeOptions}</select></div>
    <div><label for="afc-period">${esc(ui.tab === 'forecast' ? t('filter.forecastAsOf') : ui.tab === 'abc' ? t('filter.abcEnd') : t('filter.period'))}</label><select id="afc-period">${periodOptions}</select></div>`}
    <div class="afc-search"><label for="afc-search">${esc(t('filter.search'))}</label><input id="afc-search" type="search" autocomplete="off" value="${esc(ui.search)}" placeholder="${esc(t('filter.searchPlaceholder'))}"></div>
  </div>`;
}
function shellHtml(data) {
  return `<div class="afc-head"><div class="card-title"><span>${icon('chart')}${esc(t('page.title'))}</span></div><p>${esc(t('page.intro'))}</p></div>
  <div class="afc-tabs" role="tablist" aria-label="${esc(t('page.tabs'))}">${TABS.map(tabButton).join('')}</div>
  ${filtersHtml(data)}
  <div id="afc-content" class="afc-content" role="tabpanel" aria-labelledby="afc-tab-${ui.tab}" tabindex="-1"></div>`;
}
function notices(data, months) {
  const out = [];
  if (!data.history.ok) out.push(`<div class="afc-box afc-box-warn" role="status">${esc(t('history.unreadable'))}</div>`);
  if (data.coverage.replaced.length) out.push(`<div class="afc-box afc-box-info">${esc(t('history.replaced', { count: data.coverage.replaced.length }))}</div>`);
  if (months && months.length) {
    const cancelled = cancelledIn(data, months, ui.branch);
    if (cancelled) out.push(`<div class="afc-box afc-box-info">${esc(t('note.cancelled', { count: cancelled }))}</div>`);
  }
  return out.join('');
}
function exportButtons(table) {
  return `<div class="afc-export" role="group" aria-label="${esc(t('export.group'))}"><button type="button" class="btn btn-secondary btn-sm" data-afc-export="xlsx" data-afc-table="${table}">${icon('download')}${esc(t('export.excel'))}</button><button type="button" class="btn btn-secondary btn-sm" data-afc-export="csv" data-afc-table="${table}">${icon('download')}${esc(t('export.csv'))}</button></div>`;
}
function emptyState(text) {
  return `<div class="afc-empty">${esc(text)}</div>`;
}

// ---------------------------------------------------------------- tab 1: comparisons
function sentenceFor(row, dimension, basis) {
  const field = basis === 'previous' ? 'changePrevious' : 'changeLastYear';
  const pctField = basis === 'previous' ? 'pctPrevious' : 'pctLastYear';
  const base = basis === 'previous' ? row.previous : row.lastYear;
  const change = row[field];
  const name = dimension === 'branch' ? html(`<span class="afc-branch">${esc(branchLabel(row.sample.branch))}</span>`) : html(dimensionLabelHtml(dimension, row.sample));
  const against = t(basis === 'previous' ? 'compare.vsPrevious' : 'compare.vsLastYear');
  const amount = signedMoney(change);
  if (change > 0 && Math.abs(base) < 0.005) return th(`sentence.${dimension}.new`, { name, amount, against });
  // A net negative period (credit notes larger than the sales) is said as such, not as "bought 113% less".
  if (change < 0 && row.current < 0) return th(`sentence.${dimension}.negative`, { name, amount, against });
  const direction = change > 0 ? 'up' : 'down';
  return th(`sentence.${dimension}.${direction}`, { name, pct: sentencePercent(row[pctField]), amount, against });
}
function buildCompareView(data) {
  const spec = selectedPeriod(data);
  const windows = comparisonWindows(spec, data.lastClosed);
  const lines = data.lines.filter(branchPredicate(ui.branch));
  const view = { tab: 'compare', spec, windows, dimension: ui.dimension, basis: ui.basis, rows: [], total: null, movers: { growers: [], decliners: [] } };
  if (!windows.available) return view;
  const result = compareByDimension(lines, ui.dimension, windows);
  view.total = result.total;
  view.rows = result.rows.filter(row => searchMatches(dimensionLabelText(ui.dimension, row.sample)) || searchMatches(row.sample.productCode));
  const basis = windows.sameAsLastYear ? 'lastYear' : ui.basis;
  view.basis = basis;
  view.movers = topMovers(view.rows, basis, 5);
  view.split = { current: sourceSplit(data.lines, windows.current, ui.branch), previous: sourceSplit(data.lines, windows.previous, ui.branch), lastYear: sourceSplit(data.lines, windows.lastYear, ui.branch) };
  return view;
}
function moverListHtml(rows, view, kind) {
  if (!rows.length) return `<p class="afc-muted">${esc(t(kind === 'growers' ? 'compare.noGrowers' : 'compare.noDecliners'))}</p>`;
  return `<ol class="afc-movers">${rows.map(row => `<li class="${kind === 'growers' ? 'afc-up' : 'afc-down'}">${sentenceFor(row, view.dimension, view.basis)}</li>`).join('')}</ol>`;
}
function renderCompare(data) {
  const view = buildCompareView(data);
  current = view;
  if (!view.windows.available) return `${notices(data)}${emptyState(t('compare.noClosedMonths'))}`;
  const w = view.windows;
  const rangeLabel = months => (months.length ? monthRangeLabel(months[0], months[months.length - 1], lang()) : '—');
  const showPrevious = !w.sameAsLastYear;
  const dimensionOptions = DIMENSIONS.map(id => `<option value="${id}"${ui.dimension === id ? ' selected' : ''}>${esc(t(`dimension.${id}`))}</option>`).join('');
  const basisOptions = showPrevious ? `<div><label for="afc-basis">${esc(t('compare.basis'))}</label><select id="afc-basis"><option value="lastYear"${view.basis === 'lastYear' ? ' selected' : ''}>${esc(t('compare.basisLastYear'))}</option><option value="previous"${view.basis === 'previous' ? ' selected' : ''}>${esc(t('compare.basisPrevious'))}</option></select></div>` : '';
  const total = view.total;
  const split = view.split;
  const historyNote = split.current.history || split.previous.history || split.lastYear.history
    ? `<p class="afc-source">${th('compare.sourceSplit', { documents: money(split.current.documents), history: money(split.current.history) })} ${split.previous.history || split.lastYear.history ? esc(t('compare.historyInBase')) : ''} ${helpButton('history')}</p>`
    : `<p class="afc-source">${th('compare.sourceDocuments', { documents: money(split.current.documents) })}</p>`;
  const head = `<tr><th scope="col">${esc(t(`dimension.${view.dimension}`))}</th>${view.dimension === 'product' ? `<th scope="col" class="num">${esc(t('compare.qty'))}</th>` : ''}<th scope="col" class="num">${esc(t('compare.current'))}</th>${showPrevious ? `<th scope="col" class="num">${esc(t('compare.previous'))}</th><th scope="col" class="num">${esc(t('compare.change'))}</th><th scope="col" class="num">${esc(t('compare.changePct'))}</th>` : ''}<th scope="col" class="num">${esc(t('compare.lastYear'))}</th><th scope="col" class="num">${esc(t('compare.change'))}</th><th scope="col" class="num">${esc(t('compare.changePct'))}</th></tr>`;
  const cls = value => (value > 0.004 ? 'afc-pos' : value < -0.004 ? 'afc-neg' : '');
  const body = view.rows.map(row => `<tr><th scope="row">${dimensionLabelHtml(view.dimension, row.sample)}</th>${view.dimension === 'product' ? `<td class="num">${qty(row.currentQty)}</td>` : ''}<td class="num">${money(row.current)}</td>${showPrevious ? `<td class="num">${money(row.previous)}</td><td class="num ${cls(row.changePrevious)}">${signedMoney(row.changePrevious)}</td><td class="num ${cls(row.changePrevious)}">${percent(row.pctPrevious)}</td>` : ''}<td class="num">${money(row.lastYear)}</td><td class="num ${cls(row.changeLastYear)}">${signedMoney(row.changeLastYear)}</td><td class="num ${cls(row.changeLastYear)}">${percent(row.pctLastYear)}</td></tr>`).join('');
  const foot = `<tr><th scope="row">${esc(t('compare.total'))}</th>${view.dimension === 'product' ? '<td></td>' : ''}<td class="num">${money(total.current)}</td>${showPrevious ? `<td class="num">${money(total.previous)}</td><td class="num ${cls(total.changePrevious)}">${signedMoney(total.changePrevious)}</td><td class="num ${cls(total.changePrevious)}">${percent(total.pctPrevious)}</td>` : ''}<td class="num">${money(total.lastYear)}</td><td class="num ${cls(total.changeLastYear)}">${signedMoney(total.changeLastYear)}</td><td class="num ${cls(total.changeLastYear)}">${percent(total.pctLastYear)}</td></tr>`;
  return `${notices(data, [...w.current, ...w.previous, ...w.lastYear])}
  <section class="afc-card" aria-labelledby="afc-compare-title">
    <div class="afc-card-head"><h3 id="afc-compare-title">${esc(t('compare.title'))} ${helpButton('compare')}</h3>${exportButtons('compare')}</div>
    <div class="afc-controls"><div><label for="afc-dimension">${esc(t('compare.dimension'))}</label><select id="afc-dimension">${dimensionOptions}</select></div>${basisOptions}</div>
    <dl class="afc-periods"><div><dt>${esc(t('compare.current'))}</dt><dd>${esc(rangeLabel(w.current))}</dd></div>${showPrevious ? `<div><dt>${esc(t('compare.previous'))}</dt><dd>${esc(rangeLabel(w.previous))}</dd></div>` : ''}<div><dt>${esc(t('compare.lastYear'))}</dt><dd>${esc(rangeLabel(w.lastYear))}</dd></div></dl>
    ${w.partial ? `<p class="afc-note">${esc(t('compare.partial', { until: monthLabel(w.current[w.current.length - 1], lang()) }))}</p>` : ''}
    ${historyNote}
    <div class="afc-movers-grid">
      <div><h4>${esc(t('compare.growers', { basis: t(view.basis === 'previous' ? 'compare.basisPrevious' : 'compare.basisLastYear') }))}</h4>${moverListHtml(view.movers.growers, view, 'growers')}</div>
      <div><h4>${esc(t('compare.decliners', { basis: t(view.basis === 'previous' ? 'compare.basisPrevious' : 'compare.basisLastYear') }))}</h4>${moverListHtml(view.movers.decliners, view, 'decliners')}</div>
    </div>
    <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('compare.title'))}"><table class="afc-table"><thead>${head}</thead><tbody>${body || `<tr><td colspan="9" class="afc-empty-cell">${esc(t('compare.noRows'))}</td></tr>`}</tbody><tfoot>${foot}</tfoot></table></div>
    ${gpNoteHtml(w.current, split.current.history)}
  </section>`;
}
// ADR-028: gross profit of the current window from ต้นทุนและกำไรต่องาน (window.ERPCosting) — only the sales that have
// a cost count in the margin, and the coverage says how much of the sales that is (the summarised history has no
// cost: it counts in the sales, never in the covered part). No cost known → the old note. Never a made-up margin.
function gpNoteHtml(months, historySales) {
  const costing = window.ERPCosting;
  const noCost = `<p class="afc-box afc-box-info afc-gp-note">${esc(t('compare.noCost'))}</p>`;
  if (!costing || typeof costing.grossProfitSummary !== 'function') return noCost;
  const summary = costing.grossProfitSummary({ months, branch: ui.branch, extraSales: Number(historySales || 0) });
  if (summary.error || !summary.coveredSales) return noCost;
  return costing.gpSummaryHtml(summary, '');
}

// ---------------------------------------------------------------- tab 2: ABC
function onHandOf(product, branches) {
  if (typeof window.productEstimatedStock !== 'function') return 0;
  return branches.reduce((sum, branch) => sum + (Number(window.productEstimatedStock(product, branch)) || 0), 0);
}
function buildAbcView(data) {
  const spec = selectedPeriod(data);
  const end = periodEnd(spec, data);
  const months = monthRange(addMonths(end, -(ui.abcWindow - 1)), end);
  const set = new Set(months);
  const inBranch = branchPredicate(ui.branch);
  const branches = branchesOf(ui.branch, data);
  const values = new Map();
  let unassigned = 0;
  for (const line of data.lines) {
    if (!set.has(line.period) || !inBranch(line)) continue;
    if (line.productKey === ADJUSTMENT_PRODUCT_KEY || line.productKey === UNKNOWN_PRODUCT_KEY) { unassigned += line.value; continue; }
    const row = values.get(line.productKey) || { key: line.productKey, sample: line, value: 0, qty: 0 };
    row.value += line.value;
    row.qty += line.qty;
    values.set(line.productKey, row);
  }
  // Every active product of the Product Master is ranked too (no sales → C or "ไม่มีการขาย").
  for (const product of data.products) {
    if (!product?.code && !product?.name) continue;
    const key = product.code ? `code:${String(product.code).replace(/\s+/g, ' ').trim().toLowerCase()}` : `name:${String(product.name).replace(/\s+/g, ' ').trim().toLowerCase()}`;
    if (!values.has(key)) values.set(key, { key, sample: { productKey: key, productCode: product.code || '', product: product.name || product.code, category: product.category || OTHER_CATEGORY_KEY, unit: product.unit || '' }, value: 0, qty: 0 });
  }
  const items = [...values.values()].map(row => {
    const product = data.lookup?.({ code: row.sample.productCode, name: row.sample.product }) || null;
    const stocked = !!product && isStockTracked(product);
    return { key: row.key, value: row.value, qty: row.qty, sample: row.sample, product, stocked, onHand: stocked ? onHandOf(product, branches) : 0 };
  });
  const result = abcClassify(items);
  const rows = result.items.filter(item => searchMatches(productLabelText(item.sample)) || searchMatches(item.sample.productCode));
  return { tab: 'abc', spec, end, months, windowMonths: ui.abcWindow, result, rows, unassigned: Math.round(unassigned * 100) / 100, split: sourceSplit(data.lines, months, ui.branch) };
}
function renderAbc(data) {
  const view = buildAbcView(data);
  current = view;
  const summary = view.result.summary;
  const windowOptions = ABC_WINDOWS.map(n => `<option value="${n}"${ui.abcWindow === n ? ' selected' : ''}>${esc(t('abc.windowMonths', { n }))}</option>`).join('');
  const classCard = cls => `<div class="afc-stat afc-class-${cls}"><small>${esc(t(`abc.class.${cls}`))}</small><b>${NUMBER_0.format(summary[cls].count)} ${esc(t('abc.items'))}</b><span>${cls === 'none' ? esc(t('abc.noneHint')) : `${money(summary[cls].value)} · ${plainPercent(summary[cls].share)}`}</span></div>`;
  const body = view.rows.map(item => {
    const stockLink = item.stocked ? `<button type="button" class="btn btn-ghost btn-sm" data-afc-stock="${esc(item.sample.productCode || item.sample.product)}">${icon('inventory')}${esc(t('abc.stockCard'))}</button>` : `<span class="afc-muted">${esc(t('abc.notStocked'))}</span>`;
    return `<tr><td class="num">${item.rank ?? '—'}</td><th scope="row">${productLabelHtml(item.sample)}</th><td class="num">${money(item.value)}</td><td class="num">${item.rank ? plainPercent(item.share) : '—'}</td><td class="num">${item.cumulative === null ? '—' : plainPercent(item.cumulative)}</td><td><span class="afc-badge afc-class-${item.abc}">${esc(t(`abc.badge.${item.abc}`))}</span></td><td class="num">${item.stocked ? qty(item.onHand) : '—'}</td><td>${stockLink}</td></tr>`;
  }).join('');
  return `${notices(data, view.months)}
  <section class="afc-card" aria-labelledby="afc-abc-title">
    <div class="afc-card-head"><h3 id="afc-abc-title">${esc(t('abc.title'))} ${helpButton('abc')}</h3>${exportButtons('abc')}</div>
    <div class="afc-controls"><div><label for="afc-abc-window">${esc(t('abc.window'))}</label><select id="afc-abc-window">${windowOptions}</select></div><p class="afc-note">${esc(t('abc.range', { range: monthRangeLabel(view.months[0], view.months[view.months.length - 1], lang()) }))}</p></div>
    <div class="afc-stats">${['A', 'B', 'C', 'none'].map(classCard).join('')}</div>
    <p class="afc-source">${view.split.history ? `${th('compare.sourceSplit', { documents: money(view.split.documents), history: money(view.split.history) })} ${helpButton('history')}` : th('compare.sourceDocuments', { documents: money(view.split.documents) })}${Math.abs(view.unassigned) >= 0.005 ? ` ${esc(t('abc.unassigned', { amount: money(view.unassigned) }))}` : ''}</p>
    <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('abc.title'))}"><table class="afc-table"><thead><tr><th scope="col" class="num">${esc(t('abc.rank'))}</th><th scope="col">${esc(t('dimension.product'))}</th><th scope="col" class="num">${esc(t('abc.sales'))}</th><th scope="col" class="num">${esc(t('abc.share'))}</th><th scope="col" class="num">${esc(t('abc.cumulative'))}</th><th scope="col">${esc(t('abc.classCol'))}</th><th scope="col" class="num">${esc(t('abc.onHand'))}</th><th scope="col">${esc(t('abc.stockCol'))}</th></tr></thead><tbody>${body || `<tr><td colspan="8" class="afc-empty-cell">${esc(t('compare.noRows'))}</td></tr>`}</tbody></table></div>
  </section>`;
}

// ---------------------------------------------------------------- forecasting (shared by the tab, the cards and Quant)
function seriesFor(data, predicate, endKey, field = 'value') {
  const totals = monthlyTotals(data.lines, predicate);
  return { ...buildMonthlySeries(totals, { endKey, field }), totals };
}
function methodName(method) {
  return method ? t(`method.${method}`) : '—';
}
function paramsText(params) {
  if (!params) return '';
  const parts = [];
  if (params.alpha !== undefined) parts.push(`α = ${params.alpha}`);
  if (params.beta !== undefined) parts.push(`β = ${params.beta}`);
  if (params.gamma !== undefined) parts.push(`γ = ${params.gamma}`);
  return parts.join(' · ');
}
function accuracyText(result) {
  if (!result?.accuracy) return '—';
  const metric = t(`metric.${result.accuracy.metric}`);
  if (result.accuracy.value === null) return t('accuracy.noSales', { metric, months: result.accuracy.months });
  return t('accuracy.value', { metric, value: result.accuracy.value.toFixed(1), months: result.accuracy.months, label: t(`accuracy.label.${result.accuracy.label}`) });
}
function accuracyBadge(result) {
  const label = result?.accuracy?.label;
  if (!label) return `<span class="afc-badge afc-acc-none">${esc(t('accuracy.label.none'))}</span>`;
  return `<span class="afc-badge afc-acc-${label}">${esc(t(`accuracy.label.${label}`))}</span>`;
}
function reasonText(result) {
  const selection = result?.selection;
  if (!selection) return '';
  const errorOf = method => selection.candidates.find(row => row.method === method)?.error;
  const metric = t(`metric.${selection.metric}`);
  const fmtError = method => (Number.isFinite(errorOf(method)) ? `${errorOf(method).toFixed(1)}%` : '—');
  return t(`reason.${selection.reason}`, { metric, months: selection.holdout, holt: fmtError('holt'), ses: fmtError('ses'), hw: fmtError('hw'), hwMonths: HW_MIN_MONTHS, n: result.n });
}
function totalPredicate(filter) {
  return branchPredicate(filter);
}
function productPredicate(filter, productKey) {
  const inBranch = branchPredicate(filter);
  return line => line.productKey === productKey && inBranch(line);
}
function forecastFor(data, predicate, endKey, horizon, field = 'value') {
  const series = seriesFor(data, predicate, endKey, field);
  return { series, result: forecastSeries(series.values, { horizon }) };
}
// Products ranked by sales of the 12 months up to `endKey` (for the product list of the forecast tab).
function productsBySales(data, filter, endKey) {
  const months = new Set(monthRange(addMonths(endKey, -11), endKey));
  const inBranch = branchPredicate(filter);
  const map = new Map();
  for (const line of data.lines) {
    if (!inBranch(line) || line.productKey === ADJUSTMENT_PRODUCT_KEY || line.productKey === UNKNOWN_PRODUCT_KEY) continue;
    const row = map.get(line.productKey) || { key: line.productKey, sample: line, recent: 0 };
    if (months.has(line.period)) row.recent += line.value;
    map.set(line.productKey, row);
  }
  return [...map.values()].sort((a, b) => (b.recent - a.recent) || a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------- the chart (inline SVG)
function chartHtml(view) {
  const { series, result, data, endKey } = view;
  const width = Math.max(340, Math.min(1100, Math.round(lastChartWidth || 960)));
  const height = width < 560 ? 260 : 300;
  const pad = { left: width < 560 ? 44 : 58, right: 14, top: 16, bottom: 42 };
  const actualMonths = monthRange(series.start || endKey, data.lastClosed);
  const futureMonths = result.status === 'ok' ? result.forecast.map(row => addMonths(endKey, row.h)) : [];
  const showCurrent = monthIndex(data.current) > monthIndex(data.lastClosed);
  const months = [...new Set([...actualMonths, ...(showCurrent ? [data.current] : []), ...futureMonths])].sort((a, b) => monthIndex(a) - monthIndex(b));
  if (!months.length || !series.months.length) return '';
  const actualValue = key => {
    const row = series.totals.get(key);
    return row ? Math.round(row[view.field] * 100) / 100 : 0;
  };
  const values = [...actualMonths.map(actualValue), ...(showCurrent ? [actualValue(data.current)] : []), ...(result.status === 'ok' ? result.forecast.flatMap(row => [row.value, row.upper ?? row.value]) : [])].filter(Number.isFinite);
  const max = Math.max(1, ...values);
  const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
  const niceMax = Math.ceil(max / magnitude * 2) / 2 * magnitude;
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const x = key => pad.left + (months.length === 1 ? plotW / 2 : (months.indexOf(key) / (months.length - 1)) * plotW);
  const y = value => pad.top + plotH - (Math.max(0, value) / niceMax) * plotH;
  const fmtValue = value => (view.field === 'qty' ? qty(value) : money(value));
  const grid = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const value = niceMax * f;
    return `<line class="afc-grid" x1="${pad.left}" x2="${width - pad.right}" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}"/><text class="afc-axis" x="${pad.left - 6}" y="${(y(value) + 4).toFixed(1)}" text-anchor="end">${esc(view.field === 'qty' ? qty(value) : compactMoney(value))}</text>`;
  }).join('');
  const step = Math.max(1, Math.ceil(months.length / Math.max(4, Math.floor(plotW / 64))));
  // Round 11: the last label ends at its month (text-anchor end) so it is never cut at the right edge; a regular label
  // closer than half a step to it is left out so the two never overlap.
  const lastIndex = months.length - 1;
  const showLabel = index => index === lastIndex || (index % step === 0 && (lastIndex - index >= Math.ceil(step / 2) || months.length === 1));
  const labels = months.map((key, index) => (showLabel(index) ? `<text class="afc-axis" x="${x(key).toFixed(1)}" y="${height - pad.bottom + 18}" text-anchor="${index === lastIndex && months.length > 1 ? 'end' : 'middle'}">${esc(monthLabel(key, lang(), { short: true }))}</text>` : '')).join('');
  const actualPath = actualMonths.map((key, index) => `${index ? 'L' : 'M'}${x(key).toFixed(1)} ${y(actualValue(key)).toFixed(1)}`).join(' ');
  const dots = actualMonths.map(key => `<circle class="afc-dot" cx="${x(key).toFixed(1)}" cy="${y(actualValue(key)).toFixed(1)}" r="3"><title>${esc(`${monthLabel(key, lang())}: ${fmtValue(actualValue(key))}`)}</title></circle>`).join('');
  let forecastLayer = '';
  if (result.status === 'ok') {
    const anchor = { key: endKey, value: actualValue(endKey) };
    const points = [anchor, ...result.forecast.map(row => ({ key: addMonths(endKey, row.h), value: row.value, lower: row.lower, upper: row.upper }))];
    const band = result.forecast.every(row => row.lower !== null && row.upper !== null)
      ? `<path class="afc-band" d="M${x(anchor.key).toFixed(1)} ${y(anchor.value).toFixed(1)} ${result.forecast.map(row => `L${x(addMonths(endKey, row.h)).toFixed(1)} ${y(row.upper).toFixed(1)}`).join(' ')} ${result.forecast.slice().reverse().map(row => `L${x(addMonths(endKey, row.h)).toFixed(1)} ${y(row.lower).toFixed(1)}`).join(' ')} Z"/>` : '';
    const path = points.map((point, index) => `${index ? 'L' : 'M'}${x(point.key).toFixed(1)} ${y(point.value).toFixed(1)}`).join(' ');
    const fdots = points.slice(1).map(point => `<circle class="afc-dot-forecast" cx="${x(point.key).toFixed(1)}" cy="${y(point.value).toFixed(1)}" r="3.5"><title>${esc(`${monthLabel(point.key, lang())}: ${fmtValue(point.value)} (${t('chart.band')} ${point.lower === null ? '—' : fmtValue(point.lower)} – ${point.upper === null ? '—' : fmtValue(point.upper)})`)}</title></circle>`).join('');
    forecastLayer = `${band}<path class="afc-line-forecast" d="${path}"/>${fdots}`;
  }
  const currentLayer = showCurrent ? `<circle class="afc-dot-current" cx="${x(data.current).toFixed(1)}" cy="${y(actualValue(data.current)).toFixed(1)}" r="5"><title>${esc(`${t('chart.currentMonth')} ${monthLabel(data.current, lang())}: ${fmtValue(actualValue(data.current))}`)}</title></circle>` : '';
  const asOfLine = monthIndex(endKey) < monthIndex(data.lastClosed) ? `<line class="afc-asof-line" x1="${x(endKey).toFixed(1)}" x2="${x(endKey).toFixed(1)}" y1="${pad.top}" y2="${pad.top + plotH}"/>` : '';
  const title = t('chart.title', { what: view.focusLabel });
  const desc = result.status === 'ok'
    ? t('chart.desc', { start: monthLabel(series.start, lang()), end: monthLabel(endKey, lang()), next: fmtValue(result.forecast[0].value), method: methodName(result.method) })
    : t('chart.descNoForecast', { months: series.months.length });
  return `<figure class="afc-chart"><svg class="afc-svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-labelledby="afc-chart-title afc-chart-desc" focusable="false"><title id="afc-chart-title">${esc(title)}</title><desc id="afc-chart-desc">${esc(desc)}</desc>${grid}${asOfLine}${forecastLayer}<path class="afc-line-actual" d="${actualPath}"/>${dots}${currentLayer}${labels}</svg>
  <figcaption class="afc-legend"><span><i class="afc-key-actual"></i>${esc(t('chart.actual'))}</span><span><i class="afc-key-forecast"></i>${esc(t('chart.forecast'))}</span><span><i class="afc-key-band"></i>${esc(t('chart.band'))}</span>${showCurrent ? `<span><i class="afc-key-current"></i>${esc(t('chart.currentMonth'))}</span>` : ''}</figcaption></figure>`;
}

// ---------------------------------------------------------------- tab 3: forecast
function buildForecastView(data) {
  const spec = selectedPeriod(data);
  const endKey = periodEnd(spec, data);
  const ranked = productsBySales(data, ui.branch, endKey);
  const products = ranked.filter(row => searchMatches(productLabelText(row.sample)) || searchMatches(row.sample.productCode));
  if (ui.focus !== TOTAL_FOCUS && !ranked.some(row => row.key === ui.focus)) ui.focus = TOTAL_FOCUS;
  const focusRow = ranked.find(row => row.key === ui.focus) || null;
  const predicate = focusRow ? productPredicate(ui.branch, focusRow.key) : totalPredicate(ui.branch);
  const { series, result } = forecastFor(data, predicate, endKey, ui.horizon);
  const productRows = products.map(row => {
    const forecast = forecastFor(data, productPredicate(ui.branch, row.key), endKey, ui.horizon);
    return { key: row.key, sample: row.sample, recent: row.recent, series: forecast.series, result: forecast.result };
  });
  const historyMonths = series.months.filter(key => data.lines.some(line => line.source === 'history' && line.period === key && predicate(line))).length;
  const actualAfter = monthRange(addMonths(endKey, 1), data.lastClosed);
  return { tab: 'forecast', spec, endKey, field: 'value', data, series, result, focus: focusRow ? focusRow.key : TOTAL_FOCUS, focusLabel: focusRow ? productLabelText(focusRow.sample) : t('forecast.total'), focusRow, products: productRows, historyMonths, actualAfter, levels: forecastLevelRows(data, ui.branch, endKey) };
}
// Round 11: per category, which level forecasts it better — the category total itself or the sum of its products'
// forecasts (erp-forecast-core.js compareForecastLevels, the same last 3 closed months for both). Products only
// (the credit-note remainder and unknown items have no category).
function forecastLevelRows(data, filter, endKey) {
  const inBranch = branchPredicate(filter);
  const real = line => inBranch(line) && line.productKey !== ADJUSTMENT_PRODUCT_KEY && line.productKey !== UNKNOWN_PRODUCT_KEY;
  const categories = new Map();
  for (const line of data.lines) {
    if (!real(line) || monthIndex(line.period) > monthIndex(endKey)) continue;
    const key = line.category || OTHER_CATEGORY_KEY;
    const row = categories.get(key) || { key, sample: line, products: new Set() };
    row.products.add(line.productKey);
    categories.set(key, row);
  }
  const rows = [];
  for (const row of categories.values()) {
    const inCategory = line => real(line) && (line.category || OTHER_CATEGORY_KEY) === row.key;
    const series = seriesFor(data, inCategory, endKey);
    const members = [...row.products].sort().map(productKey => {
      const totals = monthlyTotals(data.lines, line => inCategory(line) && line.productKey === productKey);
      return series.months.map(key => Math.round((totals.get(key)?.value ?? 0) * 100) / 100);
    });
    rows.push({ key: row.key, sample: row.sample, products: row.products.size, months: series.months.length, comparison: compareForecastLevels(series.values, members) });
  }
  return rows.sort((a, b) => categoryLabelText(a.sample).localeCompare(categoryLabelText(b.sample), 'th'));
}
function levelsTableHtml(view) {
  const pctText = value => (Number.isFinite(value) ? `${value.toFixed(1)}%` : '—');
  const body = view.levels.map(row => {
    const c = row.comparison;
    const ok = c.status === 'ok';
    const verdict = ok ? `<b class="${c.better === 'product' ? 'afc-pos' : ''}">${esc(t(`levels.better.${c.better}`))}</b>${c.naiveMembers ? `<small>${esc(t('levels.naive', { n: c.naiveMembers }))}</small>` : ''}` : `<span class="afc-muted">${esc(t(c.status === 'no-sales' ? 'levels.noSales' : 'levels.notEnough', { min: FORECAST_MIN_MONTHS + LEVEL_TEST_MONTHS }))}</span>`;
    return `<tr><th scope="row">${categoryLabelHtml(row.sample)}</th><td class="num">${row.products}</td><td class="num">${row.months}</td><td class="num">${ok ? pctText(c.errorTop) : '—'}</td><td class="num">${ok ? pctText(c.errorBottom) : '—'}</td><td>${verdict}</td></tr>`;
  }).join('');
  return `<section class="afc-card" aria-labelledby="afc-levels-title">
    <div class="afc-card-head"><h3 id="afc-levels-title">${esc(t('levels.title'))}</h3>${exportButtons('levels')}</div>
    <p class="afc-note">${esc(t('levels.note', { months: LEVEL_TEST_MONTHS }))}</p>
    <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('levels.title'))}"><table class="afc-table afc-table-levels"><thead><tr><th scope="col">${esc(t('dimension.category'))}</th><th scope="col" class="num">${esc(t('levels.products'))}</th><th scope="col" class="num">${esc(t('forecast.monthsCol'))}</th><th scope="col" class="num">${esc(t('levels.errorCategory'))}</th><th scope="col" class="num">${esc(t('levels.errorProducts'))}</th><th scope="col">${esc(t('levels.better'))}</th></tr></thead><tbody>${body || `<tr><td colspan="6" class="afc-empty-cell">${esc(t('compare.noRows'))}</td></tr>`}</tbody></table></div>
  </section>`;
}
function forecastSummaryHtml(view) {
  const { result, series, endKey } = view;
  if (result.status !== 'ok') {
    const why = result.reason === 'no-sales' ? t('forecast.noSales') : t('forecast.notEnough', { min: FORECAST_MIN_MONTHS, n: series.months.length });
    return `<div class="afc-box afc-box-warn" role="status"><b>${esc(t('forecast.noForecast'))}</b> ${esc(why)}</div>`;
  }
  const next = result.forecast[0];
  const flags = [];
  if (result.flags.capped) flags.push(t('forecast.capped', { cap: money(result.cap) }));
  if (result.flags.clamped) flags.push(t('forecast.clamped'));
  if (result.outliers.length) flags.push(t('forecast.outliers', { months: result.outliers.map(index => monthLabel(series.months[index], lang())).join(', ') }));
  if (view.historyMonths) flags.push(t('forecast.historyUsed', { n: view.historyMonths }));
  const coverage = result.accuracy.coverage;
  return `<div class="afc-stats">
    <div class="afc-stat"><small>${esc(t('forecast.nextMonth', { month: monthLabel(addMonths(endKey, 1), lang()) }))}</small><b>${money(next.value)}</b><span>${esc(t('forecast.range80'))} ${money(next.lower)} – ${money(next.upper)}</span></div>
    <div class="afc-stat"><small>${esc(t('forecast.method'))} ${helpButton('forecast')}</small><b>${esc(methodName(result.method))}</b><span>${esc(paramsText(result.params))}</span></div>
    <div class="afc-stat"><small>${esc(t('forecast.accuracy'))} ${helpButton('accuracy')}</small><b>${accuracyBadge(result)}</b><span>${esc(accuracyText(result))}</span></div>
    <div class="afc-stat"><small>${esc(t('forecast.monthsUsed'))}</small><b>${esc(t('forecast.months', { n: result.n }))}</b><span>${esc(monthRangeLabel(series.start, endKey, lang()))}</span></div>
  </div>
  <p class="afc-note">${esc(reasonText(result))}</p>
  <p class="afc-note">${esc(t('forecast.intervalNote'))} ${helpButton('interval')}${coverage ? ` ${esc(t('forecast.coverage', { inside: coverage.inside, total: coverage.total }))}` : ''}</p>
  ${flags.length ? `<div class="afc-box afc-box-warn"><ul>${flags.map(text => `<li>${esc(text)}</li>`).join('')}</ul></div>` : ''}`;
}
function forecastTableHtml(view) {
  if (view.result.status !== 'ok') return '';
  const rows = view.result.forecast.map(row => {
    const key = addMonths(view.endKey, row.h);
    const actual = monthIndex(key) <= monthIndex(view.data.lastClosed) ? view.series.totals.get(key)?.value ?? 0 : null;
    return `<tr><th scope="row">${esc(monthLabel(key, lang()))}</th><td class="num">${money(row.lower)}</td><td class="num"><b>${money(row.value)}</b></td><td class="num">${money(row.upper)}</td>${view.actualAfter.length ? `<td class="num">${actual === null ? '—' : money(actual)}</td>` : ''}</tr>`;
  }).join('');
  return `<div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('forecast.tableTitle'))}"><table class="afc-table afc-table-narrow"><caption>${esc(t('forecast.tableTitle'))}</caption><thead><tr><th scope="col">${esc(t('forecast.month'))}</th><th scope="col" class="num">${esc(t('forecast.low'))}</th><th scope="col" class="num">${esc(t('forecast.point'))}</th><th scope="col" class="num">${esc(t('forecast.high'))}</th>${view.actualAfter.length ? `<th scope="col" class="num">${esc(t('forecast.actualLater'))}</th>` : ''}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
function renderForecast(data) {
  const view = buildForecastView(data);
  current = view;
  const focusOptions = [`<option value="${TOTAL_FOCUS}"${view.focus === TOTAL_FOCUS ? ' selected' : ''}>${esc(t('forecast.total'))}</option>`, ...view.products.map(row => `<option value="${esc(row.key)}"${view.focus === row.key ? ' selected' : ''}>${esc(`${row.sample.productCode ? `${row.sample.productCode} · ` : ''}${productLabelText(row.sample)}`)}</option>`)].join('');
  const horizonOptions = FORECAST_HORIZONS.map(n => `<option value="${n}"${ui.horizon === n ? ' selected' : ''}>${esc(t('forecast.horizonMonths', { n }))}</option>`).join('');
  const productBody = view.products.map(row => {
    const r = row.result;
    const next = r.status === 'ok' ? r.forecast[0] : null;
    const sum = r.status === 'ok' ? r.forecast.reduce((total, item) => total + item.value, 0) : null;
    return `<tr${row.key === view.focus ? ' class="afc-row-active"' : ''}><th scope="row"><button type="button" class="afc-linklike" data-afc-focus="${esc(row.key)}">${productLabelHtml(row.sample)}</button></th><td class="num">${r.n || row.series.months.length}</td><td>${r.status === 'ok' ? esc(methodName(r.method)) : `<span class="afc-muted">${esc(t('forecast.notEnoughShort'))}</span>`}</td><td class="num">${next ? money(next.value) : '—'}</td><td class="num">${next ? `${money(next.lower)} – ${money(next.upper)}` : '—'}</td><td class="num">${sum === null ? '—' : money(sum)}</td><td>${r.status === 'ok' ? accuracyBadge(r) : '—'}</td></tr>`;
  }).join('');
  const asOfNote = monthIndex(view.endKey) < monthIndex(data.lastClosed) ? `<p class="afc-box afc-box-info">${esc(t('forecast.asOfNote', { month: monthLabel(view.endKey, lang()) }))}</p>` : '';
  return `${notices(data, view.series.months)}
  <section class="afc-card" aria-labelledby="afc-forecast-title">
    <div class="afc-card-head"><h3 id="afc-forecast-title">${esc(t('forecast.title', { what: view.focusLabel }))} ${helpButton('forecast')}</h3>${exportButtons('forecast')}</div>
    <div class="afc-controls"><div><label for="afc-focus">${esc(t('forecast.focus'))}</label><select id="afc-focus" data-no-i18n>${focusOptions}</select></div><div><label for="afc-horizon">${esc(t('forecast.horizon'))}</label><select id="afc-horizon">${horizonOptions}</select></div></div>
    ${asOfNote}
    ${forecastSummaryHtml(view)}
    ${chartHtml(view)}
    ${forecastTableHtml(view)}
    ${monthIndex(data.current) > monthIndex(data.lastClosed) ? `<p class="afc-note">${esc(t('forecast.currentExcluded', { month: monthLabel(data.current, lang()) }))}</p>` : ''}
  </section>
  <section class="afc-card" aria-labelledby="afc-products-title">
    <div class="afc-card-head"><h3 id="afc-products-title">${esc(t('forecast.productsTitle', { n: ui.horizon }))}</h3></div>
    <p class="afc-note">${esc(t('forecast.productsNote'))}</p>
    <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('forecast.productsTitle', { n: ui.horizon }))}"><table class="afc-table"><thead><tr><th scope="col">${esc(t('dimension.product'))}</th><th scope="col" class="num">${esc(t('forecast.monthsCol'))}</th><th scope="col">${esc(t('forecast.method'))}</th><th scope="col" class="num">${esc(t('forecast.nextShort'))}</th><th scope="col" class="num">${esc(t('forecast.range80'))}</th><th scope="col" class="num">${esc(t('forecast.sumHorizon', { n: ui.horizon }))}</th><th scope="col">${esc(t('forecast.accuracy'))}</th></tr></thead><tbody>${productBody || `<tr><td colspan="7" class="afc-empty-cell">${esc(t('compare.noRows'))}</td></tr>`}</tbody></table></div>
  </section>
  ${levelsTableHtml(view)}`;
}

// ---------------------------------------------------------------- tab 4: reorder
// Outstanding PO quantity per product × branch: the work queue's own rule (buildStockAvailability "incoming": live
// POs not received / cancelled — drafts included — minus what goods receipts already brought in).
function openPurchaseRows(products, branches) {
  let ops;
  try { ops = window.ERPProductionCore?.exportData?.() || { purchaseOrders: [], goodsReceipts: [] }; }
  catch (error) { console.warn('[Analytics] purchase orders unreadable', error); return { rows: [], error }; }
  return { rows: buildStockAvailability({ products, branches, flow: {}, ops, onHand: () => 0 }), error: null };
}
// One row per stock-tracked product × branch (filter), with its quantity forecast and reorder plan.
// A damaged purchasing ledger stops the suggestions (fail-closed): open PO quantities would be unknown.
function buildReorderRows(data, filter, options = {}) {
  const branches = branchesOf(filter, data);
  const tracked = data.products.filter(isStockTracked);
  const purchases = openPurchaseRows(tracked, branches);
  if (purchases.error) return { rows: [], error: purchases.error };
  const incoming = new Map(purchases.rows.map(row => [`${row.branch}|${String(row.productCode || row.product).toLowerCase()}`, row.incoming]));
  const nextMonth = addMonths(data.lastClosed, 1);
  const rows = [];
  for (const product of tracked) {
    for (const branch of branches) {
      const productKey = product.code ? `code:${String(product.code).replace(/\s+/g, ' ').trim().toLowerCase()}` : `name:${String(product.name).replace(/\s+/g, ' ').trim().toLowerCase()}`;
      const forecast = forecastFor(data, line => line.branch === branch && line.productKey === productKey, data.lastClosed, FORECAST_HORIZONS[0], 'qty');
      const lead = productLeadTime(product);
      const onHand = typeof window.productEstimatedStock === 'function' ? Number(window.productEstimatedStock(product, branch)) || 0 : 0;
      const openPo = incoming.get(`${branch}|${String(product.code || product.name).toLowerCase()}`) || 0;
      const plan = reorderPlan({ monthlyForecast: forecast.result.status === 'ok' ? forecast.result.forecast[0].value : null, monthlySigma: forecast.result.status === 'ok' ? forecast.result.sigma : null, daysInMonth: daysInMonthOf(nextMonth), leadTimeDays: lead.days, reviewDays: options.reviewDays ?? ui.reviewDays, serviceLevel: options.serviceLevel ?? ui.serviceLevel, onHand, openPo, today: data.today });
      rows.push({ product, branch, productKey, lead, forecast, plan });
    }
  }
  const rank = { critical: 0, high: 1, medium: 2, none: 3 };
  rows.sort((a, b) => (rank[a.plan.severity] - rank[b.plan.severity]) || String(a.plan.orderByDate || '9999').localeCompare(String(b.plan.orderByDate || '9999')) || String(a.product.code || a.product.name).localeCompare(String(b.product.code || b.product.name)) || a.branch.localeCompare(b.branch));
  return { rows, error: null };
}
function unitHtml(product) {
  return product?.unit ? userText(product.unit) : esc(t('label.units'));
}
function alertSentence(row) {
  const name = html(`${userText(row.product.name || row.product.code)} <span class="afc-branch">(${esc(branchLabel(row.branch))})</span>`);
  const plan = row.plan;
  if (plan.status === 'negative-stock') return th('alert.negative', { name, qty: qty(plan.onHand), unit: html(unitHtml(row.product)) });
  const params = { name, days: NUMBER_0.format(Math.max(0, Math.floor(plan.daysOfCover))), qty: qty(plan.suggestedQty), unit: html(unitHtml(row.product)), date: displayDate(plan.orderByDate, lang()) };
  if (plan.onHand <= 0) return th('alert.outNow', params);
  return th(plan.orderNow ? 'alert.orderNow' : 'alert.orderBy', params);
}
function statusText(row) {
  const plan = row.plan;
  if (plan.status === 'negative-stock') return t('reorder.status.negative');
  if (plan.status === 'no-forecast') return t('reorder.status.noForecast', { min: FORECAST_MIN_MONTHS });
  if (plan.status === 'no-demand') return t('reorder.status.noDemand');
  if (!plan.alert) return t('reorder.status.ok');
  return plan.orderNow ? t('reorder.status.orderNow') : t('reorder.status.orderSoon');
}
function reorderActions(row) {
  const code = esc(row.product.code || row.product.name);
  const po = row.plan.alert && row.plan.status === 'ok' ? `<button type="button" class="btn btn-primary btn-sm" data-afc-po="${code}" data-afc-branch="${esc(row.branch)}">${icon('cart')}${esc(t('reorder.createPo'))}</button>` : '';
  return `<div class="afc-row-actions">${po}<button type="button" class="btn btn-ghost btn-sm" data-afc-stock="${code}" data-afc-branch="${esc(row.branch)}">${icon('inventory')}${esc(t('abc.stockCard'))}</button></div>`;
}
function renderReorder(data) {
  const built = buildReorderRows(data, ui.branch);
  if (built.error) { current = { tab: 'reorder', rows: [], alerts: [], error: built.error }; return `<div class="afc-box afc-box-error" role="alert">${esc(t('reorder.poUnreadable'))}</div>`; }
  const rows = built.rows.filter(row => searchMatches(row.product.name) || searchMatches(row.product.code));
  const alerts = rows.filter(row => row.plan.alert);
  current = { tab: 'reorder', rows, alerts };
  const levelOptions = Object.keys(SERVICE_LEVEL_Z).map(level => `<option value="${level}"${Number(level) === ui.serviceLevel ? ' selected' : ''}>${esc(t('reorder.serviceLevelOption', { level, z: SERVICE_LEVEL_Z[level] }))}</option>`).join('');
  const reviewOptions = REVIEW_PERIOD_OPTIONS.map(days => `<option value="${days}"${days === ui.reviewDays ? ' selected' : ''}>${esc(t('reorder.days', { n: days }))}</option>`).join('');
  const alertList = alerts.length ? `<ul class="afc-alerts">${alerts.map(row => `<li class="afc-alert afc-sev-${row.plan.severity}"><span>${alertSentence(row)}</span>${reorderActions(row)}</li>`).join('')}</ul>` : `<p class="afc-empty">${esc(t('reorder.noAlerts'))}</p>`;
  const body = rows.map(row => {
    const plan = row.plan;
    const r = row.forecast.result;
    const forecastCell = r.status === 'ok' ? `${qty1(r.forecast[0].value)}<small>${esc(methodName(r.method))} · ${accuracyBadge(r)}</small>` : `<span class="afc-muted">${esc(t('forecast.notEnoughShort'))}</span>`;
    return `<tr class="afc-sev-row-${plan.severity}"><th scope="row">${productLabelHtml({ productKey: row.productKey, productCode: row.product.code, product: row.product.name })}</th><td><span class="afc-branch">${esc(branchLabel(row.branch))}</span></td><td class="num${plan.onHand < 0 ? ' afc-neg' : ''}">${qty(plan.onHand)}</td><td class="num">${qty(plan.openPo)}</td><td class="num">${forecastCell}</td><td class="num">${plan.dailyDemand === null ? '—' : plan.dailyDemand.toFixed(2)}</td><td class="num">${qty(plan.leadTimeDays)}${row.lead.isDefault ? `<small>${esc(t('reorder.defaultLead'))}</small>` : ''}</td><td class="num">${plan.safetyStock === null ? '—' : qty1(plan.safetyStock)}</td><td class="num">${plan.reorderPoint === null ? '—' : qty1(plan.reorderPoint)}</td><td class="num">${plan.daysOfCover === null ? '—' : NUMBER_0.format(Math.floor(plan.daysOfCover))}</td><td class="num"><b>${plan.suggestedQty === null ? '—' : qty(plan.suggestedQty)}</b></td><td>${plan.orderByDate && plan.alert ? esc(displayDate(plan.orderByDate, lang())) : '—'}</td><td>${esc(statusText(row))}</td><td>${reorderActions(row)}</td></tr>`;
  }).join('');
  return `${notices(data)}
  <section class="afc-card" aria-labelledby="afc-reorder-title">
    <div class="afc-card-head"><h3 id="afc-reorder-title">${esc(t('reorder.title'))} ${helpButton('reorder')}</h3>${exportButtons('reorder')}</div>
    <div class="afc-controls"><div><label for="afc-service">${esc(t('reorder.serviceLevel'))}</label><select id="afc-service">${levelOptions}</select></div><div><label for="afc-review">${esc(t('reorder.review'))}</label><select id="afc-review">${reviewOptions}</select></div></div>
    <p class="afc-note">${esc(t('reorder.basis', { month: monthLabel(data.lastClosed, lang()), today: displayDate(data.today, lang()) }))}</p>
    <h4 class="afc-subtitle">${esc(t('reorder.alertsTitle', { n: alerts.length }))}</h4>
    ${alertList}
    <div class="afc-scroll" tabindex="0" role="region" aria-label="${esc(t('reorder.title'))}"><table class="afc-table afc-table-reorder"><thead><tr><th scope="col">${esc(t('dimension.product'))}</th><th scope="col">${esc(t('dimension.branch'))}</th><th scope="col" class="num">${esc(t('reorder.onHand'))}</th><th scope="col" class="num">${esc(t('reorder.openPo'))}</th><th scope="col" class="num">${esc(t('reorder.forecast'))}</th><th scope="col" class="num">${esc(t('reorder.daily'))}</th><th scope="col" class="num">${esc(t('reorder.lead'))}</th><th scope="col" class="num">${esc(t('reorder.safety'))}</th><th scope="col" class="num">${esc(t('reorder.rop'))}</th><th scope="col" class="num">${esc(t('reorder.cover'))}</th><th scope="col" class="num">${esc(t('reorder.suggested'))}</th><th scope="col">${esc(t('reorder.orderBy'))}</th><th scope="col">${esc(t('reorder.status'))}</th><th scope="col">${esc(t('reorder.actions'))}</th></tr></thead><tbody>${body || `<tr><td colspan="14" class="afc-empty-cell">${esc(t('reorder.noStocked'))}</td></tr>`}</tbody></table></div>
    <p class="afc-note">${esc(t('reorder.staticNote'))}</p>
  </section>`;
}

// ---------------------------------------------------------------- exports (Excel through the offline SheetJS loader, CSV)
function exportTable(name) {
  const data = dataset();
  if (data.error || !current || current.tab !== (name === 'levels' ? 'forecast' : name)) return null;
  const cell = value => (value === null || value === undefined || !Number.isFinite(Number(value)) ? '' : Math.round(Number(value) * 100) / 100);
  if (name === 'compare') {
    const view = current;
    const header = [t(`dimension.${view.dimension}`), t('export.code'), t('compare.current'), t('compare.previous'), t('compare.change'), t('compare.changePct'), t('compare.lastYear'), t('compare.change'), t('compare.changePct')];
    const rows = view.rows.map(row => [dimensionLabelText(view.dimension, row.sample), view.dimension === 'product' ? row.sample.productCode || '' : '', cell(row.current), cell(row.previous), cell(row.changePrevious), cell(row.pctPrevious), cell(row.lastYear), cell(row.changeLastYear), cell(row.pctLastYear)]);
    return { sheet: t('export.sheet.compare'), file: `analysis-compare_${view.spec.value}`, rows: [header, ...rows] };
  }
  if (name === 'abc') {
    const view = current;
    const header = [t('abc.rank'), t('export.code'), t('dimension.product'), t('abc.sales'), t('abc.share'), t('abc.cumulative'), t('abc.classCol'), t('abc.onHand')];
    const rows = view.rows.map(item => [item.rank ?? '', item.sample.productCode || '', productLabelText(item.sample), cell(item.value), item.rank ? cell(item.share) : '', item.cumulative === null ? '' : cell(item.cumulative), t(`abc.badge.${item.abc}`), item.stocked ? cell(item.onHand) : '']);
    return { sheet: t('export.sheet.abc'), file: `analysis-abc_${view.end}`, rows: [header, ...rows] };
  }
  if (name === 'forecast') {
    const view = current;
    const header = [t('forecast.month'), t('export.kind'), t('export.value'), t('forecast.low'), t('forecast.high'), t('forecast.method')];
    const rows = view.series.months.map((key, index) => [key, t('chart.actual'), cell(view.series.values[index]), '', '', '']);
    if (view.result.status === 'ok') view.result.forecast.forEach(row => rows.push([addMonths(view.endKey, row.h), t('chart.forecast'), cell(row.value), cell(row.lower), cell(row.upper), methodName(view.result.method)]));
    return { sheet: t('export.sheet.forecast'), file: `analysis-forecast_${view.endKey}`, rows: [[t('forecast.focus'), view.focusLabel], header, ...rows], headerRows: 2 };
  }
  if (name === 'levels') {
    const header = [t('dimension.category'), t('levels.products'), t('forecast.monthsCol'), t('levels.errorCategory'), t('levels.errorProducts'), t('levels.better')];
    const rows = current.levels.map(row => { const c = row.comparison; return [categoryLabelText(row.sample), row.products, row.months, c.status === 'ok' ? cell(c.errorTop) : '', c.status === 'ok' ? cell(c.errorBottom) : '', c.status === 'ok' ? t(`levels.better.${c.better}`) : t(c.status === 'no-sales' ? 'levels.noSales' : 'levels.notEnough', { min: FORECAST_MIN_MONTHS + LEVEL_TEST_MONTHS })]; });
    return { sheet: t('export.sheet.levels'), file: `analysis-forecast-levels_${current.endKey}`, rows: [header, ...rows] };
  }
  if (name === 'reorder') {
    const view = current;
    const header = [t('export.code'), t('dimension.product'), t('dimension.branch'), t('reorder.onHand'), t('reorder.openPo'), t('reorder.forecast'), t('reorder.daily'), t('reorder.lead'), t('reorder.safety'), t('reorder.rop'), t('reorder.cover'), t('reorder.suggested'), t('reorder.orderBy'), t('reorder.status')];
    const rows = view.rows.map(row => [row.product.code || '', row.product.name || '', branchLabel(row.branch), cell(row.plan.onHand), cell(row.plan.openPo), row.forecast.result.status === 'ok' ? cell(row.forecast.result.forecast[0].value) : '', row.plan.dailyDemand === null ? '' : Math.round(row.plan.dailyDemand * 1000) / 1000, row.plan.leadTimeDays, cell(row.plan.safetyStock), cell(row.plan.reorderPoint), row.plan.daysOfCover === null ? '' : Math.floor(row.plan.daysOfCover), row.plan.suggestedQty ?? '', row.plan.alert ? row.plan.orderByDate : '', statusText(row)]);
    return { sheet: t('export.sheet.reorder'), file: `analysis-reorder_${data.today}`, rows: [header, ...rows] };
  }
  return null;
}
function download(name, type, content) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
function exportCsv(name) {
  const table = exportTable(name);
  if (!table) { say(t('export.blocked'), 'error'); return null; }
  const textValue = taxCsvText(table.rows);
  download(`${table.file}.csv`, 'text/csv;charset=utf-8', textValue);
  return textValue;
}
function exportExcel(name) {
  const table = exportTable(name);
  if (!table) { say(t('export.blocked'), 'error'); return; }
  const run = () => {
    if (!window.XLSX) { say(t('export.excelMissing'), 'error'); return; }
    const book = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(book, window.XLSX.utils.aoa_to_sheet(table.rows), taxSafeSheetName(table.sheet, 'Analysis'));
    window.XLSX.writeFile(book, `${table.file}.xlsx`);
  };
  if (window.XLSX) run();
  else if (typeof window.loadSheetJS === 'function') window.loadSheetJS(run);
  else say(t('export.excelMissing'), 'error');
}

// ---------------------------------------------------------------- actions
function findProduct(code) {
  const key = String(code || '').trim().toLowerCase();
  return productRows().find(row => String(row.code || '').trim().toLowerCase() === key || String(row.name || '').trim().toLowerCase() === key) || null;
}
// "สร้างใบสั่งซื้อ": opens จัดซื้อ / PO with a DRAFT filled in (branch, product, suggested quantity, standard cost,
// default supplier, expected date = today + lead time). Nothing is saved until the user presses บันทึก.
function createPurchaseOrder(code, branch) {
  const product = findProduct(code);
  if (!product || typeof window.go !== 'function' || typeof window.pcAddPoItem !== 'function') { say(t('po.unavailable'), 'error'); return false; }
  const data = dataset();
  const row = data.error ? null : buildReorderRows(data, branch).rows.find(item => String(item.product.code || item.product.name) === String(product.code || product.name));
  const quantity = row?.plan?.suggestedQty > 0 ? row.plan.suggestedQty : 1;
  const lead = productLeadTime(product).days;
  window.go('purchase-order');
  window.pcResetPo?.();
  const set = (id, value) => { const el = $(id); if (el) el.value = value; };
  set('po-branch', BRANCH_IDS.includes(branch) ? branch : HEAD_OFFICE_BRANCH_ID);
  const body = $('po-items-body');
  if (body) body.innerHTML = '';
  window.pcAddPoItem({ product: product.name, qty: quantity, unitCost: product.standardCost || '' });
  if (product.defaultSupplier) { set('po-supplier', product.defaultSupplier); window.pcApplySupplierToPo?.(); }
  set('po-expected', addDaysIso(data.today || todayIso(), lead));
  set('po-note', t('po.note', { date: displayDate(data.today || todayIso(), lang()), qty: quantity }));
  window.pcCalcPo?.();
  say(t('po.prefilled', { qty: quantity, name: product.name }), 'success', 6000);
  $('po-supplier')?.focus?.();
  return true;
}
function openStockCard(code, branch) {
  if (typeof window.go !== 'function') return false;
  // ADR-028: the stock card with cost (qty / unit cost / value) of ต้นทุนและกำไรต่องาน when the page is there.
  if (typeof window.ERPCosting?.openStockCard === 'function' && document.getElementById('jc-root')) { window.ERPCosting.openStockCard(code, BRANCH_IDS.includes(branch) ? branch : 'all'); return true; }
  window.go('inventory');
  const set = (id, value) => { const el = $(id); if (el) el.value = value; };
  set('inv-branch-filter', BRANCH_IDS.includes(branch) ? branch : 'all');
  set('inv-search', String(code || ''));
  window.pcRenderInventory?.();
  return true;
}

// ---------------------------------------------------------------- render
function contentHtml(data) {
  if (ui.tab === 'abc') return renderAbc(data);
  if (ui.tab === 'forecast') return renderForecast(data);
  if (ui.tab === 'reorder') return renderReorder(data);
  return renderCompare(data);
}
function renderContent() {
  const host = $('afc-content');
  if (!host) return;
  const data = dataset();
  if (data.error) { host.innerHTML = window.ERPIntegrity.readErrorHtml(data.error); current = null; return; }
  host.innerHTML = contentHtml(data);
}
function render() {
  const root = $(ROOT_ID);
  if (!root) return null;
  closeHelp({ restoreFocus: false });
  const data = dataset();
  if (data.error) { root.innerHTML = `<div class="afc-head"><div class="card-title"><span>${icon('chart')}${esc(t('page.title'))}</span></div></div>${window.ERPIntegrity.readErrorHtml(data.error)}`; current = null; return null; }
  const searchFocused = document.activeElement?.id === 'afc-search';
  const caret = searchFocused ? document.activeElement.selectionStart : null;
  lastChartWidth = root.clientWidth ? root.clientWidth - 48 : lastChartWidth;
  root.innerHTML = shellHtml(data);
  renderContent();
  if (searchFocused) { const input = $('afc-search'); input?.focus(); if (caret !== null) input?.setSelectionRange?.(caret, caret); }
  return current;
}

// ---------------------------------------------------------------- compact cards for other screens
// The work queue ("งานของฉัน"): the reorder alerts of every branch, most urgent first.
function reorderAlerts(options = {}) {
  const data = dataset();
  if (data.error) return { error: data.error, alerts: [] };
  const built = buildReorderRows(data, 'all', options);
  return { error: built.error, alerts: built.rows.filter(row => row.plan.alert) };
}
function renderWorkCard(host) {
  if (!host) return;
  const { error, alerts } = reorderAlerts({ serviceLevel: DEFAULT_SERVICE_LEVEL, reviewDays: DEFAULT_REVIEW_DAYS });
  // A damaged ledger (month packs or purchase orders) is said, never shown as "nothing to order" (fail-closed).
  if (error) { host.innerHTML = `<section class="pe-work-section afc-work-card" aria-labelledby="afc-work-title"><div class="pe-section-head"><div><h2 id="afc-work-title">${esc(t('work.title'))}</h2></div></div><div class="afc-box afc-box-error" role="alert">${esc(t(window.ERPIntegrity?.isReadError?.(error) ? 'work.dataUnreadable' : 'reorder.poUnreadable'))}</div></section>`; return; }
  const items = alerts.slice(0, WORK_CARD_LIMIT).map(row => `<li class="afc-alert afc-sev-${row.plan.severity}"><span>${alertSentence(row)}</span>${row.plan.status === 'ok' ? `<button type="button" class="btn btn-secondary btn-sm" data-afc-po="${esc(row.product.code || row.product.name)}" data-afc-branch="${esc(row.branch)}">${icon('cart')}${esc(t('reorder.createPo'))}</button>` : ''}</li>`).join('');
  host.innerHTML = `<section class="pe-work-section afc-work-card" aria-labelledby="afc-work-title"><div class="pe-section-head"><div><h2 id="afc-work-title">${esc(t('work.title'))}</h2><p>${esc(t('work.subtitle'))}</p></div><span>${esc(t('work.count', { n: alerts.length }))}</span></div>${alerts.length ? `<ul class="afc-alerts">${items}</ul>` : `<div class="pe-empty-good">${esc(t('work.none'))}</div>`}<div class="afc-work-more"><button type="button" class="btn btn-ghost btn-sm" data-afc-open="reorder">${esc(t('work.openPage'))}</button></div></section>`;
}
// The forecast of a branch scope as of the latest closed month (the dashboard "คาดการณ์" tab, วิเคราะห์ธุรกิจ,
// Quant): the same function, the same numbers as the page's "ยอดขายรวม".
function forecastForBranches(branches, horizon = FORECAST_HORIZONS[0]) {
  const data = dataset();
  if (data.error) return { error: data.error, data };
  const list = Array.isArray(branches) && branches.length ? branches.filter(id => BRANCH_IDS.includes(id)) : branchesOf('all', data);
  const all = branchesOf('all', data);
  const covers = all.every(id => list.includes(id));
  const predicate = covers ? () => true : line => list.includes(line.branch);
  const { series, result } = forecastFor(data, predicate, data.lastClosed, horizon);
  return { error: null, data, branches: list, series, result };
}
function renderEmbeddedForecast(host, options = {}) {
  if (!host) return;
  const out = forecastForBranches(options.branches);
  if (out.error) { host.innerHTML = window.ERPIntegrity.readErrorHtml(out.error); return; }
  const { result, series, data } = out;
  const scope = out.branches.length === 1 && data.branches.length > 1 ? branchLabel(out.branches[0]) : t('filter.company');
  const body = result.status === 'ok'
    ? `<div class="afc-stats"><div class="afc-stat"><small>${esc(t('forecast.nextMonth', { month: monthLabel(addMonths(data.lastClosed, 1), lang()) }))}</small><b>${money(result.forecast[0].value)}</b><span>${esc(t('forecast.range80'))} ${money(result.forecast[0].lower)} – ${money(result.forecast[0].upper)}</span></div><div class="afc-stat"><small>${esc(t('forecast.method'))}</small><b>${esc(methodName(result.method))}</b><span>${esc(t('forecast.months', { n: result.n }))} · ${esc(monthRangeLabel(series.start, data.lastClosed, lang()))}</span></div><div class="afc-stat"><small>${esc(t('forecast.accuracy'))}</small><b>${accuracyBadge(result)}</b><span>${esc(accuracyText(result))}</span></div></div>
      <div class="afc-scroll"><table class="afc-table afc-table-narrow"><thead><tr><th scope="col">${esc(t('forecast.month'))}</th><th scope="col" class="num">${esc(t('forecast.low'))}</th><th scope="col" class="num">${esc(t('forecast.point'))}</th><th scope="col" class="num">${esc(t('forecast.high'))}</th></tr></thead><tbody>${result.forecast.map(row => `<tr><th scope="row">${esc(monthLabel(addMonths(data.lastClosed, row.h), lang()))}</th><td class="num">${money(row.lower)}</td><td class="num"><b>${money(row.value)}</b></td><td class="num">${money(row.upper)}</td></tr>`).join('')}</tbody></table></div>`
    : `<div class="afc-box afc-box-warn" role="status"><b>${esc(t('forecast.noForecast'))}</b> ${esc(result.reason === 'no-sales' ? t('forecast.noSales') : t('forecast.notEnough', { min: FORECAST_MIN_MONTHS, n: series.months.length }))}</div>`;
  host.innerHTML = `<div class="afc-embed-card"><p class="afc-note">${esc(t('embed.scope', { scope, month: monthLabel(data.lastClosed, lang()) }))}</p>${body}<p class="afc-note">${esc(t('embed.same'))}</p><button type="button" class="btn btn-secondary btn-sm" data-afc-open="forecast">${icon('chart')}${esc(t('embed.open'))}</button></div>`;
}
// The forecast in the shape the Quant views read (app.js buildSalesForecast). WAPE / bias / tracking signal are
// of the chosen method on the same holdout; σ (one-step residual RMS) is the error scale of the simulation.
function quantForecast(branches) {
  const out = forecastForBranches(branches, FORECAST_HORIZONS[1]);
  const empty = { ref: { year: 0, month: 0 }, branches: out.branches || [], history: [], future: [], next: null, current: null, band: null, model: { valid: false, selectedId: '', label: '', params: '', historyCount: 0, candidates: [], cv: { eligible: false, n: 0 } } };
  if (out.error) return { ...empty, error: out.error };
  const { result, series, data } = out;
  const ref = parseMonthKey(data.lastClosed);
  const rowOf = (key, value) => { const parts = parseMonthKey(key); return { year: parts.year, month: parts.month - 1, value, label: monthLabel(key, lang()) }; };
  const history = series.months.slice(-12).map((key, index, list) => rowOf(key, series.values[series.values.length - list.length + index]));
  if (result.status !== 'ok') return { ...empty, ref: { year: ref.year, month: ref.month - 1 }, history, current: series.values.at(-1) ?? null, model: { ...empty.model, historyCount: series.values.length, reason: result.reason || result.status } };
  const chosen = result.selection.candidates.find(row => row.method === result.method);
  const diagnostics = chosen ? holdoutDiagnostics(chosen.actuals, chosen.forecasts) : null;
  const cv = { id: result.method, label: methodName(result.method), eligible: !!diagnostics && diagnostics.wape !== null, n: diagnostics?.n || 0, wape: diagnostics?.wape ?? Infinity, biasPct: diagnostics?.biasPct ?? 0, trackingSignal: diagnostics?.trackingSignal ?? 0, mae: diagnostics?.mae ?? Infinity, rmse: result.sigma ?? NaN, smape: result.accuracy.metric === 'smape' ? result.accuracy.value : null, mape: result.accuracy.metric === 'mape' ? result.accuracy.value : null };
  const first = result.forecast[0];
  return {
    ref: { year: ref.year, month: ref.month - 1 },
    branches: out.branches,
    history,
    future: result.forecast.map(row => ({ ...rowOf(addMonths(data.lastClosed, row.h), row.value), lower: row.lower, upper: row.upper })),
    next: first.value,
    current: series.values.at(-1) ?? null,
    band: first.lower === null ? null : { p10: first.lower, p50: first.value, p90: first.upper, revenueAtRisk: Math.max(0, first.value - first.lower) },
    model: { valid: true, selectedId: result.method, label: methodName(result.method), params: paramsText(result.params), historyCount: result.n, candidates: [cv], cv, accuracy: result.accuracy }
  };
}

// ---------------------------------------------------------------- events
function onClick(event) {
  const tab = event.target.closest?.('[data-afc-tab]');
  if (tab) { ui.tab = TABS.includes(tab.dataset.afcTab) ? tab.dataset.afcTab : 'compare'; render(); $(`afc-tab-${ui.tab}`)?.focus(); return; }
  const focus = event.target.closest?.('[data-afc-focus]');
  if (focus) { ui.focus = focus.dataset.afcFocus; renderContent(); $('afc-focus')?.focus(); return; }
  const exportButton = event.target.closest?.('[data-afc-export]');
  if (exportButton) { if (exportButton.dataset.afcExport === 'csv') exportCsv(exportButton.dataset.afcTable); else exportExcel(exportButton.dataset.afcTable); }
}
function onKeydown(event) {
  const tab = event.target.closest?.('[data-afc-tab]');
  if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const index = TABS.indexOf(tab.dataset.afcTab);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
  ui.tab = TABS[next];
  render();
  $(`afc-tab-${ui.tab}`)?.focus();
}
function onChange(event) {
  const id = event.target?.id;
  const value = event.target?.value;
  if (id === 'afc-branch') ui.branch = value === 'all' || BRANCH_IDS.includes(value) ? value : 'all';
  else if (id === 'afc-period-type') { ui.periodType = PERIOD_TYPES.includes(value) ? value : 'month'; ui.period = ''; }
  else if (id === 'afc-period') ui.period = value;
  else if (id === 'afc-dimension') ui.dimension = DIMENSIONS.includes(value) ? value : 'product';
  else if (id === 'afc-basis') ui.basis = value === 'previous' ? 'previous' : 'lastYear';
  else if (id === 'afc-abc-window') ui.abcWindow = ABC_WINDOWS.includes(Number(value)) ? Number(value) : 12;
  else if (id === 'afc-horizon') ui.horizon = FORECAST_HORIZONS.includes(Number(value)) ? Number(value) : FORECAST_HORIZONS[0];
  else if (id === 'afc-focus') ui.focus = value || TOTAL_FOCUS;
  else if (id === 'afc-service') ui.serviceLevel = SERVICE_LEVEL_Z[value] ? Number(value) : DEFAULT_SERVICE_LEVEL;
  else if (id === 'afc-review') ui.reviewDays = REVIEW_PERIOD_OPTIONS.includes(Number(value)) ? Number(value) : DEFAULT_REVIEW_DAYS;
  else return;
  if (['afc-branch', 'afc-period-type', 'afc-period'].includes(id)) render();
  else { renderContent(); $(id)?.focus(); }
}
function onInput(event) {
  if (event.target?.id !== 'afc-search') return;
  ui.search = String(event.target.value || '').slice(0, 80);
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { searchTimer = null; renderContent(); }, 150);
}
// Delegated on the document: the buttons live on this page, on งานของฉัน and in the dashboard / analytics cards.
function onDocumentClick(event) {
  const helpButtonEl = event.target.closest?.('[data-afc-help]');
  if (helpButtonEl) { event.preventDefault(); openHelp(helpButtonEl); return; }
  if (event.target.closest?.('[data-afc-help-close]')) { closeHelp(); return; }
  if (helpOpener && !event.target.closest?.('#afc-help-popover')) closeHelp({ restoreFocus: false });
  const po = event.target.closest?.('[data-afc-po]');
  if (po) { createPurchaseOrder(po.dataset.afcPo, po.dataset.afcBranch); return; }
  const stock = event.target.closest?.('[data-afc-stock]');
  if (stock) { openStockCard(stock.dataset.afcStock, stock.dataset.afcBranch || (ui.branch === 'all' ? 'all' : ui.branch)); return; }
  const open = event.target.closest?.('[data-afc-open]');
  if (open) { ui.tab = TABS.includes(open.dataset.afcOpen) ? open.dataset.afcOpen : 'compare'; window.go?.(PANEL_ID); }
}
function onDocumentKey(event) {
  if (event.key === 'Escape' && $('afc-help-popover')) { event.stopPropagation(); closeHelp(); }
}
let queued = false;
function scheduleRender() {
  if (queued || !$(`panel-${PANEL_ID}`)?.classList.contains('active')) return;
  queued = true;
  setTimeout(() => { queued = false; try { render(); } catch (error) { console.error('[Analytics] render failed', error); } }, 0);
}
let resizeTimer = null;
function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const root = $(ROOT_ID);
    if (!root || ui.tab !== 'forecast' || !$(`panel-${PANEL_ID}`)?.classList.contains('active')) return;
    const width = root.clientWidth ? root.clientWidth - 48 : 0;
    if (Math.abs(width - lastChartWidth) < 40) return;
    lastChartWidth = width;
    try { renderContent(); } catch (error) { console.error('[Analytics] resize render failed', error); }
  }, 200);
}

window.ERPAnalytics = Object.freeze({
  VERSION: ANALYTICS_CORE_VERSION,
  render,
  select: (options = {}) => {
    for (const [key, value] of Object.entries(options)) if (Object.prototype.hasOwnProperty.call(ui, key)) ui[key] = value;
    return render();
  },
  state: () => ({ ...ui }),
  view: () => current,
  dataset: () => dataset(),
  setToday: iso => { todayOverride = String(iso || ''); cached = null; },
  invalidate: () => { cached = null; },
  exportRows: name => exportTable(name),
  exportCsv,
  exportExcel,
  createPurchaseOrder,
  openStockCard,
  reorderAlerts,
  renderWorkCard,
  renderEmbeddedForecast,
  forecastForBranches,
  quantForecast,
  t
});
function boot() {
  const root = $(ROOT_ID);
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onDocumentKey, true);
  window.addEventListener(STORAGE_WRITTEN_EVENT, () => { cached = null; scheduleRender(); });
  window.addEventListener(COMPANY_PROFILE_CHANGED_EVENT, scheduleRender);
  window.addEventListener('resize', onResize);
  if (!root) return;
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('input', onInput);
  root.addEventListener('keydown', onKeydown);
  document.addEventListener('erp:navigation', event => { if (event.detail?.id === PANEL_ID) { try { render(); } catch (error) { console.error('[Analytics] render failed', error); } } });
  window.addEventListener('erp:language-changed', () => { if (!root.childElementCount) return; try { render(); } catch (error) { console.error('[Analytics] render failed', error); } });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
