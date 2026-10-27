// ADR-027 — the page "วิเคราะห์และคาดการณ์" in the booted app (jsdom), with the sample data loaded on
// 14 Oct 2569 (the browser clock pinned like the presenter's laptop). Checks: the page is in the simple-mode menu;
// empty data says "not enough data" (TH and EN); the page totals equal the dashboard KPIs (company, head office,
// สาขาที่ 00001); the dashboard / Quant forecast is the page's forecast; the seeded figures of the demo scripts
// (SES since ADR-031 — Holt before —, MAPE 24.6%, the NB01 reorder alert, the มูลมั่งมี decline); filters; CSV and Excel (vendored SheetJS,
// network blocked); "สร้างใบสั่งซื้อ" pre-fills a draft PO and saves nothing; English shows no Thai UI text and
// A.D. dates; a damaged month pack fails closed on the page and on งานของฉัน.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot } = require('./dom-helper.cjs');
const { bootEnglish, settle, THAI_RE } = require('./i18n-helper.cjs');

const ROOT = path.resolve(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = el => String(el?.textContent || '').replace(/\s+/g, ' ').trim();
const plain = value => JSON.parse(JSON.stringify(value));
const pinClock = day => w => {
  const fixed = Date.parse(`${day}T10:00:00+07:00`);
  const Real = w.Date;
  w.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(fixed); } static now() { return fixed; } };
};
const DAY = '2026-10-14';
async function seeded(options = {}) {
  const h = await (options.english ? bootEnglish : boot)({ beforeScripts: pinClock(DAY) });
  try {
    const result = await h.w.ERPDemoSeed.load({ confirm: () => true });
    assert.equal(result.status, 'loaded', h.messages.join('\n'));
    h.w.ERPAnalytics.invalidate();
    return h;
  } catch (error) { h.close(); throw error; } // a failed start never leaves a window (and its timers) open
}
async function openPage(w, options = {}) {
  w.go('analytics-forecast', null);
  await sleep(20);
  return w.ERPAnalytics.select({ tab: 'compare', branch: 'all', periodType: 'month', period: '', search: '', focus: '', ...options });
}
// Thai text left in the page outside user data (data-no-i18n).
function thaiOutsideUserData(root) {
  const out = [];
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (THAI_RE.test(node.data) && !node.parentElement.closest('[data-no-i18n]')) out.push(node.data.trim());
  }
  for (const el of root.querySelectorAll('[title],[aria-label],[placeholder]')) {
    if (el.closest('[data-no-i18n]')) continue;
    for (const name of ['title', 'aria-label', 'placeholder']) if (THAI_RE.test(el.getAttribute(name) || '')) out.push(`@${name} ${el.getAttribute(name)}`);
  }
  return out;
}

test('ap#1 in the simple-mode menu; empty data: every tab renders and the forecast says it needs 6 months (TH and EN)', async () => {
  for (const english of [false, true]) {
    const h = english ? await bootEnglish() : await boot();
    const { w } = h; const d = w.document;
    try {
      const find = () => [...d.querySelectorAll('.sidebar .nav-item')].find(el => el.dataset.pePanel === 'analytics-forecast' && el.closest('.nav-group'));
      for (let i = 0; i < 160 && !find(); i += 1) await sleep(25); // the sidebar sections are built after boot
      const item = find();
      assert.ok(item && !item.hidden && !item.closest('.nav-group').hidden, 'visible in simple mode');
      assert.equal(item.closest('.nav-group').dataset.navSection, 'data');
      await openPage(w);
      assert.ok(d.getElementById('panel-analytics-forecast').classList.contains('active'));
      assert.equal(d.querySelectorAll('#afc-root [role="tab"]').length, 4);
      for (const tab of ['compare', 'abc', 'forecast', 'reorder']) {
        w.ERPAnalytics.select({ tab });
        await settle(w, 10);
        assert.equal(w.ERPAnalytics.state().tab, tab);
        if (english) assert.deepEqual(thaiOutsideUserData(d.getElementById('afc-root')), [], `${tab}: no Thai UI text in English`);
      }
      w.ERPAnalytics.select({ tab: 'forecast' });
      await settle(w, 10);
      assert.match(text(d.getElementById('afc-root')), english ? /Not enough data to forecast \(at least 6 months are needed — there are 0\)/ : /ข้อมูลยังไม่พอคาดการณ์ \(ต้องมีอย่างน้อย 6 เดือน/);
      w.ERPAnalytics.select({ tab: 'reorder' });
      assert.equal(w.ERPAnalytics.view().alerts.length, 0, 'no demand → no alert');
      assert.deepEqual(h.errors, []);
    } finally { h.close(); }
  }
});

test('ap#2 agreement: the page total of each closed month = the dashboard KPI (company, head office, สาขาที่ 00001)', async () => {
  const h = await seeded(); const { w } = h;
  try {
    await openPage(w);
    for (const month of [7, 8, 9]) {
      const period = `2026-${String(month).padStart(2, '0')}`;
      const dash = { ubon: w.testApp.branchStats('ubon', 2026, month - 1).st, khonkaen: w.testApp.branchStats('khonkaen', 2026, month - 1).st };
      dash.all = Math.round((dash.ubon + dash.khonkaen) * 100) / 100;
      for (const branch of ['all', 'ubon', 'khonkaen']) {
        w.ERPAnalytics.select({ tab: 'compare', branch, periodType: 'month', period, dimension: 'product' });
        const total = w.ERPAnalytics.view().total;
        assert.equal(total.current, dash[branch], `${period} ${branch}`);
        assert.equal(total.history, 0, 'months with documents never use the demo history');
        // Every dimension splits the same total.
        for (const dimension of ['customer', 'branch', 'category']) {
          w.ERPAnalytics.select({ dimension });
          const view = w.ERPAnalytics.view();
          assert.equal(view.total.current, dash[branch]);
          assert.equal(Math.round(view.rows.reduce((s, r) => s + r.current, 0) * 100), Math.round(dash[branch] * 100), `${period} ${branch} ${dimension}: rows add up`);
        }
      }
    }
    // The figures of the demo scripts (ภ.พ.30 tests use the same months): September 2569.
    w.ERPAnalytics.select({ branch: 'all', period: '2026-09', dimension: 'product' });
    assert.deepEqual([w.ERPAnalytics.view().total.current, w.ERPAnalytics.view().total.previous, w.ERPAnalytics.view().total.lastYear], [145150, 242270, 266500]);
    // A quarter = the sum of its months.
    w.ERPAnalytics.select({ periodType: 'quarter', period: '2026-Q3' });
    assert.equal(w.ERPAnalytics.view().total.current, 274260 + 242270 + 145150);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('ap#3 one forecast everywhere: SES (α 0.1) on 28 months, MAPE 24.6% "พอใช้"; dashboard, วิเคราะห์ธุรกิจ and Quant show the same number', async () => {
  const h = await seeded(); const { w } = h; const d = w.document;
  try {
    await openPage(w, { tab: 'forecast' });
    const view = w.ERPAnalytics.view();
    const r = view.result;
    assert.equal(r.status, 'ok');
    // ADR-031: June 2569 gains the USD export sale (+97,962.90) — the backtest now prefers SES (was Holt α 0.4 β 0.2, MAPE 26.3 %).
    assert.deepEqual([r.method, plain(r.params), r.n, view.series.start, view.endKey], ['ses', { alpha: 0.1 }, 28, '2024-06', '2026-09']);
    assert.equal(r.accuracy.metric, 'mape'); assert.equal(r.accuracy.label, 'fair'); assert.equal(r.accuracy.months, 4);
    assert.equal(r.accuracy.value.toFixed(1), '24.6');
    assert.equal(r.selection.reason, 'trend-worse-than-hw');
    assert.deepEqual(plain(r.selection.candidates.map(c => [c.method, c.error.toFixed(1)])), [['holt', '26.0'], ['ses', '24.6'], ['hw', '28.9']]);
    assert.equal(r.forecast.length, 3);
    assert.equal(r.forecast[0].value.toFixed(2), '213662.38');
    assert.ok(r.forecast[0].lower < r.forecast[0].value && r.forecast[0].value < r.forecast[0].upper);
    assert.ok(r.forecast[2].upper - r.forecast[2].lower > r.forecast[0].upper - r.forecast[0].lower, 'the band widens');
    const root = text(d.getElementById('afc-root'));
    assert.match(root, /เดือนปัจจุบัน \(ยังไม่ครบเดือน\): ตุลาคม 2569/);
    assert.match(root, /฿213,662\.38/);
    const svg = d.querySelector('#afc-root svg.afc-svg');
    assert.ok(svg && svg.getAttribute('role') === 'img' && svg.querySelector('title'), 'accessible chart');
    // Horizon 6.
    w.ERPAnalytics.select({ horizon: 6 });
    assert.equal(w.ERPAnalytics.view().result.forecast.length, 6);
    w.ERPAnalytics.select({ horizon: 3 });
    // The same number on the dashboard tab, on วิเคราะห์ธุรกิจ and in the Quant views.
    w.renderSalesForecast();
    assert.match(text(d.getElementById('forecast-unified')), /฿213,662\.38/);
    w.renderDataAnalytics();
    assert.match(text(d.getElementById('analytics-forecast-summary')), /฿213,662\.38/);
    const q = w.testApp.buildSalesForecast(['ubon', 'khonkaen']);
    assert.equal(q.next.toFixed(2), '213662.38');
    assert.equal(q.model.selectedId, 'ses'); // ADR-031 (was holt)
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('ap#4 comparisons: the มูลมั่งมี decline sentence, % "—" for a new buyer, the gross-profit note with its coverage (ADR-028; was the no-cost note), search filter', async () => {
  const h = await seeded(); const { w } = h; const d = w.document;
  try {
    await openPage(w, { period: '2026-09', dimension: 'customer', basis: 'lastYear' });
    const view = w.ERPAnalytics.view();
    const first = view.movers.decliners[0];
    assert.equal(first.sample.customer, 'บจก. มูลมั่งมี วัสดุภัณฑ์');
    assert.deepEqual([first.current, first.lastYear, first.changeLastYear, first.pctLastYear], [0, 77980, -77980, -100]);
    const root = text(d.getElementById('afc-root'));
    assert.match(root, /ลูกค้า บจก\. มูลมั่งมี วัสดุภัณฑ์ ซื้อลดลง 100% เทียบปีก่อน \(−฿77,980\.00\)/);
    // ADR-028 (round 11): the sample now has costs (stock items at moving-average cost, the jobs J2 / J4 of September
    // completed) — the no-cost note gives way to the gross profit of the sales whose cost is known, with its coverage
    // (72,470 of 145,150 = 49.9 %). Sales without a cost never enter the margin.
    assert.doesNotMatch(root, /ยังไม่มีต้นทุนสินค้า/);
    assert.match(root, /กำไรขั้นต้น \(ต้นทุนจริง\): ฿20,200\.00 \(27\.9%\) จากยอดขายที่มีต้นทุน ฿72,470\.00 · มีต้นทุน 50% ของยอดขาย/);
    // A net-negative customer (credit note larger than the purchases) is said as such.
    assert.match(root, /รร\.ศรีขอนแก่นวิทยา ยอดสุทธิติดลบในงวดนี้/);
    // Every % of a zero base is "—", never Infinity.
    assert.ok(view.rows.filter(r => r.lastYear === 0).every(r => r.pctLastYear === null));
    assert.doesNotMatch(root, /Infinity|NaN/);
    // Search narrows the rows; the branch filter keeps its own data.
    w.ERPAnalytics.select({ search: 'มูลมั่งมี' });
    assert.deepEqual(plain(w.ERPAnalytics.view().rows.map(r => r.sample.customer)), ['บจก. มูลมั่งมี วัสดุภัณฑ์']);
    w.ERPAnalytics.select({ search: '', branch: 'khonkaen' });
    assert.ok(w.ERPAnalytics.view().rows.every(r => r.sample.branch === 'khonkaen'));
    // Period types: quarter (Q3 2569) and year (2569 to date: January – September).
    w.ERPAnalytics.select({ branch: 'all', periodType: 'year', period: '2026' });
    assert.equal(w.ERPAnalytics.view().windows.current.length, 9);
    assert.match(text(d.getElementById('afc-period')?.selectedOptions?.[0]), /2569/);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('ap#5 ABC and reorder: classes A/B/C; the NB01 alert at สาขาที่ 00001 on the page and on งานของฉัน; "สร้างใบสั่งซื้อ" pre-fills a draft', async () => {
  const h = await seeded(); const { w } = h; const d = w.document;
  try {
    await openPage(w, { tab: 'abc' });
    const abc = w.ERPAnalytics.view();
    assert.deepEqual([abc.months[0], abc.end], ['2025-10', '2026-09']);
    assert.deepEqual(plain(['A', 'B', 'C'].map(c => abc.result.summary[c].count)), [6, 3, 29]); // ADR-031: the USD export sale makes DEMO-CC01 (head office) an A item (was 5 / 3 / 30)
    assert.ok(abc.result.summary.A.share >= 80 && abc.result.summary.A.share < 95);
    w.ERPAnalytics.select({ tab: 'reorder' });
    const alerts = w.ERPAnalytics.view().alerts;
    assert.deepEqual(plain(alerts.map(r => [r.product.code, r.branch, r.plan.onHand, r.plan.openPo, r.plan.suggestedQty, r.plan.orderByDate, Math.floor(r.plan.daysOfCover), r.plan.leadTimeDays])), [['DEMO-NB01', 'khonkaen', 4, 0, 2, '2026-10-25', 52, 21]]);
    const sentence = /โน้ตบุ๊กธุรกิจ 14 นิ้ว \(Core i5 \/ RAM 16GB\) \(สาขาที่ 00001\) จะหมดในอีกประมาณ 52 วัน — ควรสั่ง 2 เครื่อง ภายใน 25\/10\/2569/;
    assert.match(text(d.getElementById('afc-root')), sentence);
    // Service level 99 % raises the safety stock (z 2.33 > 1.65).
    const ss95 = w.ERPAnalytics.view().rows.find(r => r.product.code === 'DEMO-NB01' && r.branch === 'khonkaen').plan.safetyStock;
    w.ERPAnalytics.select({ serviceLevel: 99 });
    const ss99 = w.ERPAnalytics.view().rows.find(r => r.product.code === 'DEMO-NB01' && r.branch === 'khonkaen').plan.safetyStock;
    assert.ok(Math.abs(ss99 / ss95 - 2.33 / 1.65) < 1e-9);
    w.ERPAnalytics.select({ serviceLevel: 95 });
    // Non-stock products (services) are not in the reorder table.
    assert.ok(w.ERPAnalytics.view().rows.every(r => r.product.flowType === 'inventory' && r.product.fulfillmentType === 'stock'));
    // The compact card on งานของฉัน.
    w.go('work-home', null);
    await sleep(30);
    const card = d.getElementById('pe-reorder-slot');
    assert.match(text(card), sentence);
    // "สร้างใบสั่งซื้อ": a draft PO, nothing saved.
    const before = w.ERPProductionCore.exportData().purchaseOrders.length;
    card.querySelector('[data-afc-po="DEMO-NB01"]').click();
    await sleep(20);
    assert.ok(d.getElementById('panel-purchase-order').classList.contains('active'));
    assert.equal(d.getElementById('po-branch').value, 'khonkaen');
    const rows = [...d.querySelectorAll('#po-items-body tr')];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].querySelector('[data-f="product"]').value, 'โน้ตบุ๊กธุรกิจ 14 นิ้ว (Core i5 / RAM 16GB)');
    assert.equal(rows[0].querySelector('[data-f="qty"]').value, '2');
    assert.equal(rows[0].dataset.productCode, 'DEMO-NB01');
    assert.equal(d.getElementById('po-expected').value, '2026-11-04', '14/10 + 21 days lead time');
    assert.ok(d.getElementById('po-supplier').value.trim(), 'the default supplier is filled in');
    assert.match(d.getElementById('po-note').value, /แนะนำ 2 หน่วย/);
    assert.equal(w.ERPProductionCore.exportData().purchaseOrders.length, before, 'nothing saved');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('ap#6 exports: CSV of each tab; Excel through the vendored SheetJS with the network blocked, valid sheet names', async () => {
  const h = await seeded(); const { w } = h; const d = w.document;
  try {
    w.fetch = () => { throw new Error('network blocked'); };
    const downloads = [];
    w.URL.createObjectURL = blob => { downloads.push(blob); return 'blob:test'; };
    w.URL.revokeObjectURL = () => {};
    await openPage(w, { period: '2026-09', dimension: 'customer' });
    const csv = w.ERPAnalytics.exportCsv('compare');
    const lines = csv.replace(/^﻿/, '').trim().split(/\r?\n/);
    assert.match(lines[0], /^ลูกค้า,/);
    assert.ok(lines.some(line => line.startsWith('บจก. มูลมั่งมี วัสดุภัณฑ์,') && line.includes('-77980')), 'decline row exported as a number');
    assert.equal(w.ERPAnalytics.exportCsv('abc'), null, 'another tab cannot be exported from this one');
    for (const tab of ['abc', 'forecast', 'reorder']) {
      w.ERPAnalytics.select({ tab });
      const table = w.ERPAnalytics.exportRows(tab);
      assert.ok(table.rows.length > 1, tab);
      assert.ok(table.sheet.length <= 31 && !/[\\/?*[\]:]/.test(table.sheet), `${tab}: valid sheet name ${table.sheet}`);
    }
    // Excel: the loader appends the local vendor script; nothing comes from the network.
    w.ERPAnalytics.select({ tab: 'reorder' });
    const appended = [];
    const original = d.head.appendChild.bind(d.head);
    d.head.appendChild = node => { if (node.tagName === 'SCRIPT') appended.push(node); return original(node); };
    d.querySelector('#afc-root [data-afc-export="xlsx"]').click();
    assert.equal(appended.length, 1);
    assert.equal(appended[0].getAttribute('src'), './vendor/xlsx-0.18.5.full.min.js');
    w.eval(fs.readFileSync(path.join(ROOT, 'vendor/xlsx-0.18.5.full.min.js'), 'utf8'));
    const books = [];
    w.XLSX.writeFile = (wb, file) => books.push({ wb, file });
    appended[0].onload();
    assert.equal(books.length, 1);
    assert.equal(books[0].file, 'analysis-reorder_2026-10-14.xlsx');
    const back = w.XLSX.read(w.XLSX.write(books[0].wb, { type: 'array', bookType: 'xlsx' }), { type: 'array' });
    assert.deepEqual(plain(back.SheetNames), ['จุดสั่งซื้อ']);
    const rows = plain(w.XLSX.utils.sheet_to_json(back.Sheets['จุดสั่งซื้อ'], { header: 1, defval: '' }));
    const nb = rows.find(row => row[0] === 'DEMO-NB01' && row[2] === 'สาขาที่ 00001');
    assert.ok(nb, 'NB01 at สาขาที่ 00001 exported');
    assert.equal(nb[11], 2);
    assert.equal(nb[12], '2026-10-25');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('ap#7 English: the same figures, A.D. months and dates, THB, no Thai UI text on any tab', async () => {
  const h = await seeded({ english: true }); const { w } = h; const d = w.document;
  try {
    for (const tab of ['compare', 'abc', 'forecast', 'reorder']) {
      await openPage(w, { tab, period: tab === 'compare' ? '2026-09' : '', dimension: 'customer' });
      await settle(w, 20);
      assert.deepEqual(thaiOutsideUserData(d.getElementById('afc-root')), [], `${tab}: no Thai UI text`);
      const root = text(d.getElementById('afc-root'));
      assert.doesNotMatch(root, /฿/, `${tab}: THB in English`);
      if (tab === 'compare') assert.match(root, /Customer บจก\. มูลมั่งมี วัสดุภัณฑ์ bought 100% less compared with last year \(−THB 77,980\.00\)/);
      if (tab === 'forecast') { assert.match(root, /October 2026/); assert.match(root, /THB 213,662\.38/); assert.match(root, /Simple exponential smoothing/); }
      if (tab === 'reorder') assert.match(root, /will run out in about 52 days — order 2 .* by 25\/10\/2026/);
    }
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('ap#8 a damaged month pack fails closed: the page and the งานของฉัน card say so instead of showing figures', async () => {
  const h = await seeded(); const { w } = h; const d = w.document;
  try {
    const key = Object.keys(w.localStorage).find(k => /biz2_khonkaen_2026_09$/.test(k));
    assert.ok(key);
    w.localStorage.setItem(key, '{broken');
    w.ERPAnalytics.invalidate();
    await openPage(w, { tab: 'reorder' });
    assert.ok(d.querySelector('#afc-root .erp-read-error'), 'read-error state on the page');
    assert.equal(w.ERPAnalytics.view(), null);
    const card = d.createElement('div');
    w.ERPAnalytics.renderWorkCard(card);
    assert.match(text(card), /อ่านข้อมูลการขายบางเดือนไม่ได้/);
    assert.equal(w.ERPAnalytics.reorderAlerts().alerts.length, 0);
  } finally { h.close(); }
});
