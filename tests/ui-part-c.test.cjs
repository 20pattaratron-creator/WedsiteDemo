// ADR-017 (round 5 part C of the UI declutter) in the booted app with the sample data:
//   1. button levels — at most one solid .btn-primary per visible area on every screen, no legacy
//      solid colour class left on a control, one definition of the levels in erp-ui.css;
//   2. one icon set — no emoji on any button / menu item / tab / sidebar entry, every line icon is
//      aria-hidden and points at a symbol of the erp-icons.js sprite;
//   3. the shorter executive dashboard — ภาพรวม holds only the page title, filters, tabs, 4 KPIs,
//      "สิ่งที่ต้องทำ" and 2 charts; every other block is in its own view; the duplicated header
//      buttons are gone; the KPIs are the same numbers as the underlying functions / other screens;
//   4. leftovers of parts A/B — delDoc refuses before asking, focus comes back to the row after a
//      re-render, the action column is sticky, unused CSS is gone.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot } = require('./dom-helper.cjs');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, tries = 200) {
  for (let i = 0; i < tries && !check(); i++) await sleep(25);
  return check();
}
const text = el => String(el?.textContent || '').replace(/\s+/g, ' ').trim();

// Emoji / pictographic symbols used as icons. A "→" inside a sentence ("คัดลอกเป้ายอดขาย → ยอดส่ง")
// is text, not an icon, and is allowed; "←" / "↻" / "⬇" / "＋" / "✓" / "✕" … are icons.
const EMOJI_RE = /[\p{Extended_Pictographic}←↑↓-⇿⌀-⏿■-◿☀-➿⬀-⯿️＋]/u;
const CONTROL_SELECTOR = 'button, [role="button"], [role="menuitem"], [role="tab"], a.btn, label.btn, .nav-item, summary';
// Out of scope (ADR-017): printed / PDF document pages, toast messages. Status badges and message
// text are not controls, so the selector above never reaches them.
const EXCLUDED = '#app-toast-container, .dtd-preview-card, .rcp-preview-card, .qdoc-preview-card, .doc-entry-preview-frame, .doc-preview-modal-body';
// An "area" of the one-primary rule: a dialog, a toolbar / footer, a card or section, else the page.
const AREA_SELECTOR = '[role="dialog"], .erp-menu, .export-box, .doc-entry-toolbar, .form-actions, .list-toolbar-actions, .dtd-toolbar, .rcp-toolbar, .qdoc-toolbar, .card, section, .panel';
const LEGACY_SOLID = ['btn-green', 'btn-purple', 'btn-red', 'btn-amber', 'btn-view'];

// jsdom loads no stylesheet: "visible" = on the active page (or outside any page), with no hidden /
// view-hidden ancestor and no inline display:none.
function visible(el) {
  for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
    if (node.hidden || node.classList.contains('erp-view-hidden') || node.style?.display === 'none') return false;
    if (node.classList.contains('panel') && !node.classList.contains('active')) return false;
  }
  return true;
}

async function bootWithSample() {
  const h = await boot();
  const { w } = h;
  assert.equal(await waitFor(() => !!w.ERPDemoSeed && !!w.ERPProductExperience && !!w.document.getElementById('erp-dashboard-views') && !!w.ERPUiMenu?.getMenu('erp-demo')), true, 'app ready');
  const result = await w.ERPDemoSeed.load();
  assert.equal(result.status, 'loaded');
  await sleep(300);
  return h;
}

function panelIds(w) {
  return [...w.document.querySelectorAll('.main > .panel')].map(panel => panel.id.replace(/^panel-/, ''));
}

async function eachPanel(w, visit) {
  const results = {};
  for (const id of panelIds(w)) {
    if (id === 'order-flow') w.ERPOrderFlow.open();
    else w.go(id);
    await sleep(40);
    results[id] = visit(w.document.getElementById(`panel-${id}`), id);
  }
  return results;
}

// ---------------------------------------------------------------- 1. button levels
function primaryAreaViolations(panel) {
  const counts = new Map();
  for (const button of panel.querySelectorAll('.btn-primary')) {
    if (!visible(button)) continue;
    const area = button.parentElement.closest(AREA_SELECTOR) || panel;
    counts.set(area, [...(counts.get(area) || []), text(button)]);
  }
  return [...counts.values()].filter(labels => labels.length > 1);
}

test('button levels: every screen has at most one solid .btn-primary per visible area, and no legacy solid colour class', async () => {
  const h = await bootWithSample();
  const { w } = h;
  try {
    w.document.getElementById('pe-mode-toggle').click(); // โหมดขั้นสูง: the advanced screens too
    await sleep(60);
    const results = await eachPanel(w, panel => ({
      violations: primaryAreaViolations(panel),
      legacy: [...panel.querySelectorAll(LEGACY_SOLID.map(c => `.${c}`).join(','))].filter(visible).map(text),
      unleveledPrimary: [...panel.querySelectorAll('.btn-primary:not(.btn)')].filter(visible).map(text)
    }));
    for (const [id, result] of Object.entries(results)) {
      assert.deepEqual(result.violations, [], `${id}: more than one primary in one area`);
      assert.deepEqual(result.legacy, [], `${id}: legacy solid colour classes`);
      assert.deepEqual(result.unleveledPrimary, [], `${id}: .btn-primary without .btn`);
    }
    // Form toolbars: "บันทึก" is the one primary; preview / print / PDF are secondary.
    for (const form of ['quote-form', 'invoice-form', 'receipt-form']) {
      w.go(form);
      const toolbar = w.document.querySelector(`#panel-${form} .doc-entry-toolbar-actions`);
      assert.deepEqual([...toolbar.querySelectorAll('.btn-primary')].map(b => b.dataset.docToolbarAction), ['save'], form);
      assert.deepEqual([...toolbar.querySelectorAll('.btn-secondary')].map(b => b.dataset.docToolbarAction), ['preview', 'print', 'pdf'], form);
    }
    // List pages: "+ สร้าง…" is the one primary; Excel is tertiary; row primaries are secondary.
    w.go('invoice-list');
    const toolbar = w.document.querySelector('#panel-invoice-list .list-toolbar-actions');
    assert.equal(toolbar.querySelectorAll('.btn-primary').length, 1);
    assert.match(text(toolbar.querySelector('.btn-primary')), /^\+ /);
    assert.ok(toolbar.querySelector('[onclick^="exportXLSX"]').classList.contains('btn-tertiary'));
    const rowPrimaries = [...w.document.querySelectorAll('#panel-invoice-list .erp-rowact-primary')];
    assert.ok(rowPrimaries.length > 0);
    assert.ok(rowPrimaries.every(b => b.classList.contains('btn-secondary') && !b.classList.contains('btn-primary')));
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('button levels are defined once (erp-ui.css) and the old !important theme overrides are gone', () => {
  const ui = read('erp-ui.css');
  for (const token of ['--erp-btn-primary-bg', '--erp-btn-secondary-border', '--erp-btn-tertiary-fg', '--erp-btn-danger-fg', '--erp-btn-height', '--erp-btn-radius']) assert.match(ui, new RegExp(`${token}:`), token);
  for (const rule of ['.btn.btn-primary{', '.btn.btn-secondary', '.btn.btn-tertiary{', '.btn.btn-danger{', '.btn:focus-visible{', '.btn:disabled']) assert.ok(ui.includes(rule), rule);
  assert.match(ui, /@media\(max-width:900px\)\{\s*\.btn,\.btn\.btn-sm\{min-height:var\(--erp-touch-target\)\}/);
  const others = fs.readdirSync(ROOT).filter(f => f.endsWith('.css') && f !== 'erp-ui.css' && !f.endsWith('-document.css'));
  for (const file of others) {
    const css = read(file);
    assert.doesNotMatch(css, /\.btn-(?:primary|green|purple|red|amber|view|secondary)\b[^{}]*\{[^}]*background/, `${file}: no second definition of a level`);
    assert.doesNotMatch(css, /\.btn\b[^{}]*\{[^}]*(?:background|color)[^}]*!important/, `${file}: no !important colour on .btn`);
  }
  assert.doesNotMatch(read('style.css'), /#panel-receipt-form \.doc-entry-toolbar-actions \.btn-primary/);
  assert.doesNotMatch(read('erp-product-experience.css'), /data-pe-search\][^{]*\{[^}]*!important/);
});

// ---------------------------------------------------------------- 2. one icon set
function emojiControls(root) {
  return [...root.querySelectorAll(CONTROL_SELECTOR)]
    .filter(el => !el.closest(EXCLUDED))
    .map(el => text(el))
    .filter(label => EMOJI_RE.test(label));
}

test('icons: no emoji on any control of any screen, the header, the Demo menu, a row menu or the search; every line icon is aria-hidden and drawn from the sprite', async () => {
  const h = await bootWithSample();
  const { w } = h;
  const d = w.document;
  try {
    d.getElementById('pe-mode-toggle').click();
    await sleep(60);
    const found = await eachPanel(w, panel => emojiControls(panel));
    for (const [id, labels] of Object.entries(found)) assert.deepEqual(labels, [], id);
    assert.deepEqual(emojiControls(d.querySelector('.comform-topbar')), [], 'header');
    assert.deepEqual(emojiControls(d.querySelector('.sidebar')), [], 'sidebar');
    // Demo menu
    d.getElementById('erp-demo-menu-btn').click();
    assert.deepEqual(emojiControls(d.getElementById('erp-demo-menu')), [], 'Demo menu');
    d.getElementById('erp-demo-menu-btn').click();
    // A row "⋯" menu
    w.go('invoice-list');
    d.querySelector('#panel-invoice-list [data-row-menu]').click();
    const rowMenu = [...d.querySelectorAll('.erp-menu')].find(menu => !menu.hidden && menu.classList.contains('erp-rowact-menu'));
    assert.ok(rowMenu, 'row menu open');
    assert.deepEqual(emojiControls(rowMenu), [], 'row menu');
    assert.ok([...rowMenu.querySelectorAll('[role="menuitem"]')].every(item => item.querySelector('.erp-menu-icon svg.erp-icon')), 'every row menu item has a line icon');
    d.body.click();
    // Global search results
    w.ERPCustomerExperience.openSearch('INV');
    assert.ok(d.querySelectorAll('.erp-search-result').length > 0);
    assert.deepEqual(emojiControls(d.querySelector('.erp-search-overlay')), [], 'search');
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
    // Every icon: decorative and drawn from a symbol that exists.
    const sprite = d.getElementById(w.ERPIcons ? 'erp-icon-sprite' : '');
    assert.ok(sprite, 'the sprite is on the page');
    const symbols = new Set([...sprite.querySelectorAll('symbol')].map(s => `#${s.id}`));
    const icons = [...d.querySelectorAll('svg.erp-icon')];
    assert.ok(icons.length > 50, `${icons.length} icons`);
    for (const svg of icons) {
      assert.equal(svg.getAttribute('aria-hidden'), 'true');
      assert.equal(svg.getAttribute('focusable'), 'false');
      assert.ok(symbols.has(svg.querySelector('use')?.getAttribute('href')), svg.outerHTML.slice(0, 160));
    }
    // Sidebar and Demo menu use the same set (part A's drawings moved into erp-icons.js).
    assert.ok([...d.querySelectorAll('.sidebar .nav-item')].every(item => item.querySelector(':scope > svg.erp-icon use')));
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('icons: one module holds every drawing — no second copy of part A\'s icons, row actions use icon names', () => {
  const icons = read('erp-icons.js');
  for (const name of ['save', 'preview', 'print', 'download', 'document', 'edit', 'receipt', 'credit-note', 'search', 'refresh', 'add', 'table', 'trash', 'more', 'back', 'check', 'alert', 'settings', 'guide', 'health', 'chart', 'reset']) {
    assert.match(icons, new RegExp(`\\n  '?${name}'?: '`), name);
  }
  for (const file of ['local-demo-mode.js', 'erp-demo-seed.js', 'local-demo-health.js', 'erp-product-experience.js', 'index.html']) {
    assert.doesNotMatch(read(file), /<path d="M22 12h-4l-3 9L9 3l-3 9H2"|<path d="M3 3v18h18"\/><path d="M7 16v-4/, `${file}: no copy of a part A drawing`);
  }
  assert.doesNotMatch(read('erp-row-actions.js'), /[\p{Extended_Pictographic}]/u, 'no emoji left in the row action map');
});

// ---------------------------------------------------------------- 3. dashboard
const SUMMARY_BLOCKS = ['erp-dashboard-welcome', 'erp-dashboard-empty', 'erp-dash-controls', 'erp-dashboard-views', 'erp-dash-kpi-row', 'erp-dash-summary'];
const blockName = el => el.id || [...el.classList].find(c => c.startsWith('erp-dash') || c.startsWith('dash-')) || el.className;

test('dashboard: ภาพรวม holds only title, filters, tabs, 4 KPIs, "สิ่งที่ต้องทำ" and 2 charts; the rest is in its own view; duplicate header buttons are gone', async () => {
  const h = await bootWithSample();
  const { w } = h;
  const d = w.document;
  try {
    w.go('dashboard');
    w.renderDash();
    await sleep(120);
    const dash = d.getElementById('panel-dashboard');
    assert.equal(dash.dataset.dashboardView, 'summary');
    const shown = [...dash.children].filter(el => !el.classList.contains('erp-view-hidden')).map(blockName);
    assert.deepEqual(shown, SUMMARY_BLOCKS);
    // Contents of ภาพรวม
    // r5fix#3 (ADR-018): the donut sits beside "สิ่งที่ต้องทำ" and the 12-month chart spans the row below — DOM order = visual order.
    assert.deepEqual([...d.querySelectorAll('#erp-dash-summary .exec-chart-host')].map(el => el.id), ['exec-agency-pie-chart', 'exec-sales-target-chart']);
    const todo = d.getElementById('erp-dash-todo-body');
    assert.ok(todo.querySelector('#erp-flow-dashboard-queue') && todo.querySelector('#erp-decision-council-card'), 'สิ่งที่ต้องทำ = work queue + Decision Review');
    assert.equal(text(d.getElementById('erp-dash-todo-title')), 'สิ่งที่ต้องทำ');
    assert.equal(d.querySelectorAll('#dash-ar-kpis .mc').length, 2);
    // Duplicates of the sidebar / Demo menu / the card's own button are gone.
    assert.equal(d.querySelectorAll('#erp-dashboard-welcome button').length, 0);
    for (const label of ['+ สร้างใบเสนอราคา', 'ข้อมูลลูกค้าและสินค้า', 'วิธีเริ่มทดลอง', 'ตรวจ Decision Council', 'เปิดศูนย์งานขาย']) {
      assert.equal([...dash.querySelectorAll('button')].filter(b => text(b).includes(label)).length, 0, label);
    }
    assert.equal([...dash.querySelectorAll('[data-open-council]')].length, 1, 'one "เปิด Council"');
    // Each moved block is in the view it belongs to.
    const inView = async (view, selectors) => {
      w.ERPCustomerExperience.selectDashboardView(view);
      for (const selector of selectors) {
        const el = dash.querySelector(selector);
        assert.ok(el, selector);
        assert.equal(el.classList.contains('erp-view-hidden'), false, `${selector} in ${view}`);
      }
      assert.equal(d.getElementById('erp-dash-summary').classList.contains('erp-view-hidden'), true, `ภาพรวม blocks hidden in ${view}`);
    };
    await inView('receivables', ['#ar-aging-card', '#ar-overdue-banner']);
    await inView('sales', ['#dash-combined', '.erp-branch-detail', '.prodcore-dashboard-ops', '.dash-decision-section', '.monthly-target-planner', '.executive-visual-section', '.flow-section', '.dash-chart-grid', '#dash-recent']);
    assert.equal(d.getElementById('dash-ar-kpis').classList.contains('erp-view-hidden'), true);
    await inView('forecast', ['.forecast-section']);
    await inView('risk', ['.quant-section']);
    // Filters stay in every view.
    for (const view of ['summary', 'receivables', 'sales', 'forecast', 'risk']) {
      w.ERPCustomerExperience.selectDashboardView(view);
      assert.ok(visible(d.getElementById('dash-month')) && visible(d.getElementById('dash-year')) && visible(d.getElementById('dt-all')), view);
    }
    // Tabs pattern
    const tabs = [...d.querySelectorAll('#erp-dashboard-views [role="tab"]')];
    assert.equal(d.getElementById('erp-dashboard-views').getAttribute('role'), 'tablist');
    w.ERPCustomerExperience.selectDashboardView('summary');
    assert.deepEqual(tabs.map(t => t.getAttribute('aria-selected')), ['true', 'false', 'false', 'false', 'false']);
    assert.deepEqual(tabs.map(t => t.tabIndex), [0, -1, -1, -1, -1]);
    tabs[0].focus();
    tabs[0].dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(dash.dataset.dashboardView, 'receivables');
    assert.equal(d.activeElement, tabs[1]);
    tabs[1].dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    assert.equal(dash.dataset.dashboardView, 'summary');
    tabs[0].dispatchEvent(new w.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    const lastVisible = tabs.filter(t => !t.hidden).at(-1);
    assert.equal(d.activeElement, lastVisible, 'End = last visible tab (simple mode hides คาดการณ์ / ความเสี่ยง)');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('dashboard KPIs are the same numbers as renderDash\'s branch figures and the AR report / Decision Council', async () => {
  const h = await bootWithSample();
  const { w } = h;
  const d = w.document;
  try {
    const shared = await import(path.join(ROOT, 'erp-shared-core.js'));
    w.go('dashboard');
    const year = Number(d.getElementById('dash-year').value);
    d.getElementById('dash-month').value = '-1';
    w.switchDashTab('all');
    await sleep(120);
    const ub = w.testApp.branchStats('ubon', year, -1), kk = w.testApp.branchStats('khonkaen', year, -1);
    const cards = [...d.querySelectorAll('#metrics-total .mc')];
    assert.equal(cards.length, 5);
    // ภาพรวม shows card 1 (sales) and card 5 (net profit); erp-ui.css hides 2–4 in that view only.
    assert.equal(text(cards[0].querySelector('.val')), shared.fmt(ub.st + kk.st));
    assert.equal(text(cards[4].querySelector('.val')), shared.fmt(ub.net + kk.net));
    assert.match(read('erp-ui.css'), /\[data-dashboard-view="summary"\] :is\(#metrics-total,#metrics-single\)>\.mc:nth-child\(n\+2\):nth-child\(-n\+4\)/);
    // Receivables: the report's snapshot (same code as ลูกหนี้ค้างรับ) and the Decision Council agree.
    const totals = w.ERPReceivables.snapshot('').aging.totals;
    const tile = key => text(d.querySelector(`#dash-ar-kpis [data-ar-kpi="${key}"] .val`));
    assert.equal(await waitFor(() => tile('outstanding') !== ''), true);
    assert.equal(tile('outstanding'), shared.fmt(totals.total));
    assert.equal(tile('overdue'), shared.fmt(totals.overdue));
    assert.ok(totals.overdue > 0, 'the sample data has overdue invoices');
    const report = text(d.getElementById('ar-aging-report'));
    assert.ok(report.includes(`฿${tile('outstanding')}`) && report.includes(`฿${tile('overdue')}`), 'same figures as the report');
    const council = w.ERPDecisionCouncil.run();
    const ar = council.reviews.find(r => r.name === 'collections').findings.find(f => f.ruleId === 'AR_001');
    assert.match(ar.summary, new RegExp(totals.overdue.toLocaleString('th-TH', { maximumFractionDigits: 2 }).replace(/[.,]/g, '\\$&')));
    // A branch tab changes both kinds of KPI the same way as before.
    w.switchDashTab('ubon');
    await sleep(120);
    assert.equal(tile('outstanding'), shared.fmt(w.ERPReceivables.snapshot('ubon').aging.totals.total));
    assert.equal(text(d.querySelector('#metrics-single .mc .val')), shared.fmt(ub.st));
    // "ดูรายงานอายุลูกหนี้" on the overdue tile opens the ลูกหนี้ค้างรับ view.
    w.switchDashTab('all');
    d.querySelector('#dash-ar-kpis [data-ar-action="open-report"]').click();
    assert.equal(d.getElementById('panel-dashboard').dataset.dashboardView, 'receivables');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

// ---------------------------------------------------------------- 4. leftovers
test('delDoc: a paid or credited invoice is refused WITHOUT asking "ลบหรือไม่?" first; an eligible one still asks', async () => {
  // ADR-021: an issued invoice is never deleted — delDoc refuses every invoice without a question, and the
  // replacement action ("ยกเลิกใบกำกับภาษี") refuses a paid invoice before its dialog, naming what to void first,
  // while an eligible invoice still gets its question (the reason dialog).
  const h = await bootWithSample();
  const { w } = h;
  try {
    const I = w.ERPIntegrity;
    const invoices = I.business().invoices.filter(inv => I.live(inv) && inv._type !== 'issuedInvoices');
    const summary = inv => I.paymentSummary({ ...inv, branch: inv._branch || inv.branch });
    const paid = invoices.find(inv => summary(inv).paid > 0);
    const open = invoices.find(inv => summary(inv).paid === 0 && !(summary(inv).credited > 0) && !w.ERPDocumentCancel.blockersFor('invoices', inv._branch, inv._year, inv._month, String(inv.id)).length);
    assert.ok(paid && open, 'the sample data has a paid and an unpaid invoice');
    const asked = [];
    w.confirm = message => { asked.push(message); return false; };
    const count = inv => w.loadFor(inv._branch, inv._year, inv._month).invoices.length;
    const before = count(paid);
    h.messages.length = 0;
    await w.delDoc(paid._branch, paid._year, paid._month, 'invoices', paid.id);
    assert.deepEqual(asked, [], 'no confirmation before the refusal');
    // app.js calls its own notify() (a toast), so the refusal is read from the toast.
    let toast = text(w.document.getElementById('app-toast-container'));
    assert.match(toast, /ลบไม่ได้/);
    assert.equal(count(paid), before, 'nothing deleted');
    assert.equal(w.ERPDocumentCancel.open('invoices', paid._branch, paid._year, paid._month, String(paid.id)), false);
    assert.match(h.messages.join('|'), /ใบเสร็จรับเงินที่ยังใช้งาน|รายการรับชำระ/);
    assert.equal(w.document.querySelector('.erp-cancel-overlay'), null, 'no dialog for a paid invoice');
    const beforeOpen = count(open);
    await w.delDoc(open._branch, open._year, open._month, 'invoices', open.id);
    assert.equal(asked.length, 0, 'delete never asks: it is refused');
    assert.equal(w.ERPDocumentCancel.open('invoices', open._branch, open._year, open._month, String(open.id)), true, 'an eligible invoice gets the cancel dialog');
    assert.ok(w.document.querySelector('.erp-cancel-overlay [role="dialog"]'));
    w.ERPDocumentCancel.close();
    assert.equal(count(open), beforeOpen, 'kept');
  } finally { h.close(); }
});

test('focus: after a row action re-renders the list, the same row\'s "⋯" (or primary) button gets keyboard focus back', async () => {
  const h = await bootWithSample();
  const { w } = h;
  const d = w.document;
  try {
    w.go('quote-list');
    w.renderQLList();
    const cells = () => [...d.querySelectorAll('#panel-quote-list [data-row-actions="quote"]')];
    const target = cells()[1];
    const facts = JSON.parse(target.dataset.rowFacts);
    // The "แก้ไข" menu action runs editQuote(); here it only re-renders the list, like a save does.
    w.editQuote = () => { w.renderQLList(); };
    const more = target.querySelector('[data-row-menu]');
    more.focus();
    more.click();
    const item = [...d.querySelectorAll('.erp-rowact-menu [role="menuitem"]')].find(el => text(el).endsWith('แก้ไข'));
    assert.ok(item, 'menu item แก้ไข');
    item.click();
    assert.equal(more.isConnected, false, 'the list was re-rendered');
    assert.equal(await waitFor(() => d.activeElement?.matches?.('[data-row-menu]')), true, 'focus is back on a "⋯"');
    assert.equal(w.ERPRowActions.rowIdentity(JSON.parse(d.activeElement.closest('[data-row-actions]').dataset.rowFacts)), w.ERPRowActions.rowIdentity(facts), 'on the same row');
    // Primary button: same row, same kind of button.
    const row = cells().find(cell => w.ERPRowActions.rowIdentity(JSON.parse(cell.dataset.rowFacts)) === w.ERPRowActions.rowIdentity(facts));
    const primary = row.querySelector('[data-row-action]');
    w.openQuoteDocument = () => { w.renderQLList(); };
    w.useQuoteForProduction = () => { w.renderQLList(); };
    primary.focus();
    primary.click();
    assert.equal(await waitFor(() => d.activeElement?.matches?.('[data-row-action]')), true, 'focus is back on the primary');
    assert.equal(w.ERPRowActions.rowIdentity(JSON.parse(d.activeElement.closest('[data-row-actions]').dataset.rowFacts)), w.ERPRowActions.rowIdentity(facts));
    // An action that moves focus on purpose (a dialog, another page) keeps it there.
    w.editQuote = () => { w.renderQLList(); d.getElementById('dash-month').focus(); };
    const again = cells()[1].querySelector('[data-row-menu]');
    again.focus();
    again.click();
    [...d.querySelectorAll('.erp-rowact-menu [role="menuitem"]')].find(el => text(el).endsWith('แก้ไข')).click();
    await sleep(80);
    assert.equal(d.activeElement, d.getElementById('dash-month'));
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('wide lists: the action column (last cell) is sticky on the right with a shadow; unused CSS of parts A/B is removed', async () => {
  const ui = read('erp-ui.css');
  assert.match(ui, /\.tbl-wrap td\.erp-rowact-cell:last-child,\s*\.tbl-wrap table:has\(td\.erp-rowact-cell:last-child\)>thead>tr>th:last-child\{position:sticky;right:0;[^}]*box-shadow/);
  const h = await bootWithSample();
  const { w } = h;
  try {
    for (const [panel, render] of [['invoice-list', 'renderIList'], ['quote-list', 'renderQLList'], ['receipt-list', 'renderRList'], ['expense-list', 'renderEList']]) {
      w.go(panel);
      w[render]();
      const rows = [...w.document.querySelectorAll(`#panel-${panel} .tbl-wrap tbody tr`)].filter(tr => tr.querySelector('.erp-rowact-cell'));
      assert.ok(rows.length > 0, panel);
      assert.ok(rows.every(tr => tr.lastElementChild.classList.contains('erp-rowact-cell')), `${panel}: actions are the last column`);
    }
  } finally { h.close(); }
  const sources = fs.readdirSync(ROOT).filter(f => /\.(js|html)$/.test(f)).map(read).join('\n');
  const styles = fs.readdirSync(ROOT).filter(f => f.endsWith('.css') && !f.endsWith('-document.css')).map(read).join('\n');
  for (const cls of ['brules-delete', 'prodcore-actions', 'expense-evidence-view']) {
    assert.doesNotMatch(sources, new RegExp(`\\b${cls}\\b`), `${cls} unused in JS/HTML`);
    assert.doesNotMatch(styles, new RegExp(`\\.${cls}\\b`), `${cls} removed from CSS`);
  }
  assert.doesNotMatch(styles, /\.erp-row-actions\b/, '.erp-row-actions removed from CSS');
});
