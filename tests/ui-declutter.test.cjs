// ADR-015 (round 5 part A, UI declutter) in the booted app: the header "Demo" menu replaces the green
// banner (same five actions, window.ERPDemoMenu registration), one slim notice, the grouped/collapsible
// sidebar with one entry per document type, form screens highlighting their document entry with a
// "← รายการ…" link, every go() route still resolving, and the ☰ drawer on phones.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot } = require('./dom-helper.cjs');

const ROOT = path.resolve(__dirname, '..');

const TENANT_PREFIX = 'erp_tenant::customer-showcase-local::';
const COLLAPSED_KEY = `${TENANT_PREFIX}erp_nav_collapsed_sections_v1`;
const MODE_KEY = `${TENANT_PREFIX}erp_product_experience_mode_v1`;
const ADVANCED = ['analytics', 'business-rules', 'audit-log', 'saas-admin', 'files'];
const SECTIONS = [
  ['home', 'หน้าหลัก', ['work-home', 'dashboard', 'approval-center']],
  ['sales', 'ขายและรับเงิน', ['quote-list', 'invoice-list', 'receipt-list', 'credit-note-list', 'order-flow']],
  ['operations', 'ซื้อ / ผลิต / คลัง', ['production-list', 'purchase-order', 'goods-receipt', 'inventory']],
  ['expenses', 'ค่าใช้จ่าย', ['expense-list']],
  ['data', 'ข้อมูลและรายงาน', ['master-data', 'linked-flow', 'analytics', 'customer-portal']],
  ['settings', 'ตั้งค่า', ['business-rules', 'audit-log', 'saas-admin', 'files']]
];
const ALL_ENTRIES = SECTIONS.flatMap(([, , panels]) => panels);
const SIMPLE_ENTRIES = ALL_ENTRIES.filter(panel => !ADVANCED.includes(panel));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, tries = 160) {
  for (let i = 0; i < tries && !check(); i++) await sleep(25);
  return check();
}
const text = el => String(el?.textContent || '').replace(/\s+/g, ' ').trim();
const navItems = w => [...w.document.querySelectorAll('.sidebar .nav-item')];
const entryOf = item => item.dataset.pePanel;
const activeEntries = w => navItems(w).filter(item => item.classList.contains('active')).map(entryOf);
// "Visible" in the menu: not hidden by the mode, its section shown, and not folded away by a
// collapsed section (a collapsed section still shows the active entry — CSS in erp-ui.css).
function visibleEntries(w) {
  return navItems(w).filter(item => {
    const group = item.closest('.nav-group');
    if (item.hidden || !group || group.hidden) return false;
    return !group.classList.contains('is-collapsed') || item.classList.contains('active');
  }).map(entryOf);
}
async function bootReady(options) {
  const h = await boot(options);
  const { w } = h;
  const ready = await waitFor(() => !!w.ERPProductExperience && !!w.document.querySelector('.sidebar .nav-group') && !!w.ERPUiMenu?.getMenu('erp-demo') && !!w.ERPDemoMenu?.has('health') && !!w.ERPDemoMenu.has('demo-seed-reset') && !!w.document.getElementById('local-demo-health-btn'));
  assert.equal(ready, true, 'product experience, sidebar sections and the complete Demo menu are ready');
  return h;
}


test('one slim notice replaces the orange strip + green banner; the header has one "Demo" menu button', async () => {
  const h = await bootReady();
  const { w } = h;
  const d = w.document;
  try {
    assert.equal(d.querySelectorAll('#erp-trial-safety-banner').length, 1);
    const notice = d.getElementById('erp-trial-safety-banner');
    // The warning is still on the page: data stays in this browser, not a multi-user Production system.
    assert.equal(text(notice.querySelector('.erp-demo-notice-long')), 'DEMO 4.3.1 · ข้อมูลทดลองเก็บในเบราว์เซอร์นี้เท่านั้น · ยังไม่ใช่ระบบ Production หลายผู้ใช้');
    assert.equal(notice.getAttribute('role'), 'note');
    assert.equal(d.getElementById('local-demo-banner'), null, 'the green banner is gone');
    assert.equal(d.querySelector('.local-demo-banner, .local-demo-banner-actions'), null);
    assert.equal(d.getElementById('trial-banner').hidden, true, 'the trial banner stays hidden in Local Demo');
    const button = d.getElementById('erp-demo-menu-btn');
    assert.ok(button.closest('.comform-topbar'), 'in the header');
    assert.equal(button, d.querySelector('.comform-topbar').lastElementChild, 'last in the header');
    assert.equal(text(button), 'Demo');
    assert.equal(button.getAttribute('aria-haspopup'), 'menu');
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(button.getAttribute('aria-controls'), 'erp-demo-menu');
    // Buttons between the header and the page content: only the Demo button and the header's own controls.
    const headerButtons = [...d.querySelectorAll('.comform-topbar button')].map(b => b.id || b.className);
    assert.deepEqual(headerButtons, ['erp-global-search-btn', 'pe-mode-toggle', 'erp-demo-menu-btn']);
    // No former banner button is left anywhere on the page outside the menu.
    for (const id of ['local-demo-health-btn', 'local-demo-guide-btn', 'local-demo-backup-btn']) {
      assert.equal(d.querySelectorAll(`#${id}`).length, 1, id);
      assert.ok(d.getElementById(id).closest('#erp-demo-menu'), `${id} is a menu item`);
    }
    assert.deepEqual([...d.querySelectorAll('[data-demo-seed-action]')].filter(b => !b.closest('#erp-demo-menu, #erp-dashboard-empty')), []);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('Demo menu: five items once each, in order, reset last in red behind a separator; keyboard open / move / Escape / Tab and outside click', async () => {
  const h = await bootReady();
  const { w } = h;
  const d = w.document;
  const key = (element, name) => element.dispatchEvent(new w.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  try {
    const button = d.getElementById('erp-demo-menu-btn');
    const menu = d.getElementById('erp-demo-menu');
    const items = () => [...menu.querySelectorAll('[role="menuitem"]')];
    assert.equal(menu.getAttribute('role'), 'menu');
    assert.equal(menu.getAttribute('aria-label'), 'เมนู Demo');
    assert.deepEqual(items().map(text), ['ตรวจสถานะ Demo', 'โหลดข้อมูลตัวอย่างสำหรับสาธิต', 'วิธีเริ่มทดลอง', 'สำรองข้อมูล', 'ล้างข้อมูลสาธิตทั้งหมด (รีเซ็ต)']);
    assert.deepEqual(items().map(item => item.id || `[data-demo-seed-action=${item.dataset.demoSeedAction}]`), ['local-demo-health-btn', '[data-demo-seed-action=load]', 'local-demo-guide-btn', 'local-demo-backup-btn', '[data-demo-seed-action=reset]']);
    assert.ok(items()[4].classList.contains('is-danger'));
    assert.ok(items().slice(0, 4).every(item => !item.classList.contains('is-danger')));
    assert.equal(items()[4].previousElementSibling.getAttribute('role'), 'separator');
    assert.equal(menu.querySelectorAll('[role="separator"]').length, 1);
    assert.ok(items().every(item => item.querySelector('.erp-menu-icon svg')), 'every item has a line icon');
    // Click opens with focus on the first item; an outside click closes.
    button.click();
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.equal(menu.hidden, false);
    assert.equal(d.activeElement, items()[0]);
    d.querySelector('.main').click();
    assert.equal(menu.hidden, true, 'outside click closes');
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    // Keyboard: ArrowDown on the button opens, arrows move, Escape closes with focus back on the button.
    button.focus();
    key(button, 'ArrowDown');
    assert.equal(menu.hidden, false);
    assert.equal(d.activeElement, items()[0]);
    key(items()[0], 'ArrowDown');
    assert.equal(d.activeElement, items()[1]);
    key(items()[1], 'ArrowUp');
    key(items()[0], 'ArrowUp');
    assert.equal(d.activeElement, items()[4], 'wraps to the reset item');
    key(items()[4], 'Escape');
    assert.equal(menu.hidden, true, 'Escape closes');
    assert.equal(d.activeElement, button, 'focus back on the Demo button');
    // Tab leaves the menu (closed, focus continues from the button).
    key(button, 'ArrowUp');
    assert.equal(d.activeElement, items()[4]);
    key(items()[4], 'Tab');
    assert.equal(menu.hidden, true);
    assert.equal(d.activeElement, button);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('Demo menu items call the same handlers as the former banner buttons; reset keeps its confirmation', async () => {
  const h = await bootReady();
  const { w } = h;
  const d = w.document;
  try {
    const button = d.getElementById('erp-demo-menu-btn');
    const choose = selector => {
      button.click();
      d.querySelector(`#erp-demo-menu ${selector}`).click();
    };
    // ตรวจสถานะ Demo → LocalDemoHealth's dialog.
    choose('#local-demo-health-btn');
    assert.equal(await waitFor(() => !!d.querySelector('.demo-health-overlay #demo-health-body')), true);
    d.querySelector('[data-health-close]').click();
    // วิธีเริ่มทดลอง → TrialService.toggleOnboarding(false), called at the moment of the click.
    const guideCalls = [];
    const realToggle = w.TrialService.toggleOnboarding;
    w.TrialService.toggleOnboarding = (...args) => guideCalls.push(args);
    choose('#local-demo-guide-btn');
    assert.deepEqual(guideCalls, [[false]]);
    w.TrialService.toggleOnboarding = realToggle;
    // สำรองข้อมูล → window.exportAllJSON(); while it is missing, the same "loading" notice as before.
    let exported = 0;
    const realExport = w.exportAllJSON;
    w.exportAllJSON = (...args) => { exported += 1; assert.deepEqual(args, []); };
    choose('#local-demo-backup-btn');
    assert.equal(exported, 1);
    w.exportAllJSON = undefined;
    choose('#local-demo-backup-btn');
    assert.match(h.messages.at(-1), /ฟังก์ชัน Backup กำลังโหลด/);
    w.exportAllJSON = realExport;
    assert.equal(d.activeElement, button, 'focus back on the Demo button after an action');
    // โหลดข้อมูลตัวอย่าง → ERPDemoSeed load (data-demo-seed-action delegation; the harness answers confirm() with yes).
    choose('[data-demo-seed-action="load"]');
    assert.equal(await waitFor(() => w.ERPDemoSeed.isLoaded()), true, h.messages.join('\n'));
    assert.equal(await waitFor(() => !d.querySelector('#erp-demo-menu [data-demo-seed-action="load"]').disabled), true, 'enabled again after the action');
    // ล้างข้อมูล → still asks first: "no" keeps every document.
    const invoices = w.ERPIntegrity.business().invoices.length;
    assert.ok(invoices > 0);
    const questions = [];
    w.confirm = message => { questions.push(message); return false; };
    choose('[data-demo-seed-action="reset"]');
    assert.equal(await waitFor(() => questions.length === 1 && !d.querySelector('#erp-demo-menu [data-demo-seed-action="reset"]').disabled), true);
    assert.match(questions[0], /^ล้างข้อมูลสาธิตทั้งหมด \(รีเซ็ต\)\?/);
    assert.equal(w.ERPDemoSeed.isLoaded(), true, 'cancelled: sample data kept');
    assert.equal(w.ERPIntegrity.business().invoices.length, invoices);
    // "yes" resets.
    w.confirm = () => true;
    choose('[data-demo-seed-action="reset"]');
    assert.equal(await waitFor(() => !w.ERPDemoSeed.isLoaded()), true, h.messages.join('\n'));
    assert.equal(w.ERPIntegrity.business().invoices.length, 0);
    await sleep(900); // let the Trial usage refresh (700 ms after a change) finish before the page closes
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('ERPDemoMenu.register: a module adds its own item by key; registering again replaces it (no duplicates); danger items stay last', async () => {
  const h = await bootReady();
  const { w } = h;
  const d = w.document;
  try {
    const labels = () => [...d.querySelectorAll('#erp-demo-menu [role="menuitem"]')].map(text);
    const api = w.ERPDemoMenu;
    assert.equal(Object.isFrozen(api), true);
    assert.equal(api.has('health'), true);
    assert.equal(api.has('demo-seed-reset'), true);
    // The modules' own start-up code running again does not add anything.
    w.dispatchEvent(new w.Event('erp:storage-written'));
    w.document.dispatchEvent(new w.Event('erp:dashboard-rendered'));
    await sleep(700); // local-demo-health.js retries every 300 ms
    assert.equal(labels().length, 5);
    // A new item by key, placed by order; the same key again replaces it.
    let picked = 0;
    assert.equal(api.register({ key: 'extra', label: 'รายการทดสอบ', order: 25, onSelect: () => { picked += 1; } }), true);
    assert.equal(api.register({ key: 'extra', label: 'รายการทดสอบ (ใหม่)', order: 25, onSelect: () => { picked += 10; } }), true);
    assert.deepEqual(labels(), ['ตรวจสถานะ Demo', 'โหลดข้อมูลตัวอย่างสำหรับสาธิต', 'รายการทดสอบ (ใหม่)', 'วิธีเริ่มทดลอง', 'สำรองข้อมูล', 'ล้างข้อมูลสาธิตทั้งหมด (รีเซ็ต)']);
    // Another danger item also goes after the separator (danger items among themselves by order), never
    // above an ordinary item, even with a lower order.
    api.register({ id: 'extra-danger', label: 'ลบทดสอบ', order: 1, danger: true });
    assert.deepEqual(labels().slice(-2), ['ล้างข้อมูลสาธิตทั้งหมด (รีเซ็ต)', 'ลบทดสอบ']);
    const separator = d.querySelector('#erp-demo-menu [role="separator"]');
    assert.equal(text(separator.nextElementSibling), 'ล้างข้อมูลสาธิตทั้งหมด (รีเซ็ต)');
    assert.equal(d.querySelectorAll('#erp-demo-menu [role="separator"]').length, 1);
    assert.equal(d.getElementById('extra-danger').classList.contains('is-danger'), true, 'id doubles as key and DOM id');
    d.getElementById('erp-demo-menu-btn').click();
    [...d.querySelectorAll('#erp-demo-menu [role="menuitem"]')].find(item => text(item) === 'รายการทดสอบ (ใหม่)').click();
    assert.equal(picked, 10, 'only the latest registration runs');
    // Invalid registrations are refused, not rendered.
    const warnings = [];
    const realWarn = w.console.warn;
    w.console.warn = (...args) => warnings.push(args.join(' '));
    assert.equal(api.register({ label: 'no key' }), false);
    assert.equal(api.register({ key: 'no-label' }), false);
    w.console.warn = realWarn;
    assert.equal(warnings.length, 2);
    assert.equal(labels().length, 7);
    // open / close helpers.
    api.open();
    assert.equal(d.getElementById('erp-demo-menu').hidden, false);
    api.close();
    assert.equal(d.getElementById('erp-demo-menu').hidden, true);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('sidebar: six sections with headings, one entry per document type (no create/list pairs); โหมดง่าย hides the advanced entries and the section that has none left', async () => {
  const h = await bootReady();
  const { w } = h;
  const d = w.document;
  try {
    const groups = [...d.querySelectorAll('.sidebar .nav-group')];
    assert.deepEqual(groups.map(group => [group.dataset.navSection, text(group.querySelector('.nav-group-toggle'))]), SECTIONS.map(([id, label]) => [id, label]));
    for (const [id, , panels] of SECTIONS) {
      const group = d.querySelector(`.nav-group[data-nav-section="${id}"]`);
      assert.deepEqual([...group.querySelectorAll('.nav-item')].map(entryOf), panels, id);
      const toggle = group.querySelector('.nav-group-toggle');
      assert.equal(toggle.tagName, 'BUTTON');
      assert.equal(toggle.getAttribute('aria-controls'), group.querySelector('.nav-group-items').id);
    }
    assert.ok(navItems(w).every(item => item.closest('.nav-group')), 'every entry is in a section');
    const entries = navItems(w).map(entryOf);
    assert.equal(new Set(entries).size, entries.length, 'no duplicate entries');
    assert.deepEqual(entries.filter(panel => /-form$/.test(panel)), [], 'no "create" entries');
    assert.deepEqual(entries, ALL_ENTRIES);
    for (const [panel, label] of [['quote-list', 'ใบเสนอราคา'], ['invoice-list', 'ใบส่งสินค้า / ใบกำกับภาษี'], ['receipt-list', 'ใบเสร็จ / รับชำระ'], ['credit-note-list', 'ใบลดหนี้'], ['production-list', 'สั่งผลิต'], ['expense-list', 'ค่าใช้จ่าย'], ['order-flow', 'ศูนย์งานขาย & ลูกหนี้']]) {
      assert.match(text(navItems(w).find(item => entryOf(item) === panel)), new RegExp(`^${label.replace(/[/&()]/g, '\\$&')}`), panel);
    }
    // No old flat-list heading is left (they were .nav-sec divs).
    assert.equal(d.querySelectorAll('.sidebar .nav-sec:not(.nav-group-toggle)').length, 0);
    // One line icon per entry, no emoji icon spans left.
    assert.ok(navItems(w).every(item => item.querySelectorAll(':scope > svg').length === 1), 'one svg per entry');
    assert.equal(d.querySelector('.sidebar .pe-nav-icon, .sidebar .erp-flow-nav-icon'), null);
    const settings = d.querySelector('.nav-group[data-nav-section="settings"]');
    // โหมดง่าย: 16 entries; "ตั้งค่า" has only advanced screens, so its heading is hidden too.
    assert.deepEqual(visibleEntries(w), SIMPLE_ENTRIES);
    assert.equal(visibleEntries(w).length, 16);
    assert.deepEqual(navItems(w).filter(item => item.hidden).map(entryOf).sort(), [...ADVANCED].sort());
    assert.equal(settings.hidden, true, 'empty section hidden with its heading');
    assert.equal(d.querySelector('.nav-group[data-nav-section="data"]').hidden, false, 'a section with a visible entry stays');
    // โหมดขั้นสูง shows everything; back to โหมดง่าย hides the advanced entries again.
    d.getElementById('pe-mode-toggle').click();
    assert.deepEqual(navItems(w).filter(item => item.hidden), []);
    assert.equal(settings.hidden, false);
    assert.deepEqual(visibleEntries(w), ALL_ENTRIES);
    d.getElementById('pe-mode-toggle').click();
    assert.deepEqual(navItems(w).filter(item => item.hidden).map(entryOf).sort(), [...ADVANCED].sort());
    assert.equal(settings.hidden, true);
    // An advanced screen opened in โหมดง่าย still goes back to งานของฉัน (unchanged rule).
    w.go('files');
    await sleep(60);
    assert.equal(d.querySelector('.panel.active').id, 'panel-work-home');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('a form screen highlights its document entry, has "← รายการ…" back to the list, and is never bounced; list pages open the form with "+ สร้าง…"', async () => {
  const h = await bootReady();
  const { w } = h;
  const d = w.document;
  try {
    const activePanel = () => d.querySelector('.panel.active').id.replace('panel-', '');
    for (const [form, entry] of [['quote-form', 'quote-list'], ['invoice-form', 'invoice-list'], ['receipt-form', 'receipt-list'], ['credit-note-form', 'credit-note-list'], ['production-form', 'production-list'], ['expense-form', 'expense-list'], ['issued-invoice-list', 'invoice-list'], ['issued-receipt-list', 'receipt-list']]) {
      w.go(form);
      assert.deepEqual(activeEntries(w), [entry], form);
      assert.equal(navItems(w).find(item => entryOf(item) === entry).getAttribute('aria-current'), 'page', form);
      await sleep(60); // applyExperience runs 30 ms after erp:navigation
      assert.equal(activePanel(), form, `${form} is not redirected`);
    }
    // "← รายการ…": first thing on each form, named after the list page, and it opens that list.
    for (const [form, list, label] of [['quote-form', 'quote-list', 'รายการใบเสนอราคา'], ['invoice-form', 'invoice-list', 'รายการใบส่งสินค้า / ใบกำกับภาษี'], ['receipt-form', 'receipt-list', 'รายการใบเสร็จรับเงิน'], ['credit-note-form', 'credit-note-list', 'รายการใบลดหนี้'], ['production-form', 'production-list', 'รายการสั่งผลิตสินค้า'], ['expense-form', 'expense-list', 'รายการค่าใช้จ่ายองค์กร']]) {
      const links = d.querySelectorAll(`#panel-${form} .nav-back-link`);
      assert.equal(links.length, 1, form);
      assert.equal(d.getElementById(`panel-${form}`).firstElementChild, links[0], `${form}: at the top`);
      // ADR-017: the "←" became the back line icon (aria-hidden SVG); the text is the list's title.
      assert.equal(text(links[0]), label);
      assert.equal(links[0].querySelector('svg.erp-icon[aria-hidden="true"] use').getAttribute('href'), '#erp-i-back');
      w.go(form);
      links[0].click();
      assert.equal(activePanel(), list, `${form} → ${list}`);
      assert.deepEqual(activeEntries(w), [list]);
    }
    // Callers that look up the (former) form entry pass null now; app.js still opens the form. The row
    // button "🧾 ออกใบเสร็จ" calls issueReceiptFromInvoice() from an inline onclick (exposed on window in ADR-015).
    assert.equal((await w.ERPDemoSeed.load()).status, 'loaded');
    const invoice = w.ERPIntegrity.business().invoices.find(row => row.no && !row.voided);
    w.issueReceiptFromInvoice(invoice._branch || invoice.branch, invoice._year, invoice._month, invoice.id);
    assert.equal(activePanel(), 'receipt-form');
    assert.deepEqual(activeEntries(w), ['receipt-list']);
    // The list entry → the list; its "+ สร้าง…" → the form, still under the same entry. (jsdom does not
    // run inline onclick attributes by itself — same approach as ux-review.test.cjs.)
    const clickInline = element => {
      element.onclick = new w.Function('event', element.getAttribute('onclick'));
      element.click();
    };
    for (const [list, form] of [['quote-list', 'quote-form'], ['invoice-list', 'invoice-form'], ['receipt-list', 'receipt-form'], ['production-list', 'production-form'], ['expense-list', 'expense-form']]) {
      clickInline(navItems(w).find(item => entryOf(item) === list));
      assert.equal(activePanel(), list);
      const create = d.querySelector(`#panel-${list} .card-title .btn-primary`);
      assert.match(text(create), /^\+ /);
      clickInline(create);
      assert.equal(activePanel(), form, `${list}: + สร้าง… opens ${form}`);
      assert.deepEqual(activeEntries(w), [list]);
    }
    // Credit notes: the list's "+ ออกใบลดหนี้" is handled by erp-credit-note.js (data-cn-action="new").
    w.go('credit-note-list');
    d.querySelector('#panel-credit-note-list .card-title .btn-primary[data-cn-action="new"]').click();
    assert.equal(activePanel(), 'credit-note-form');
    assert.deepEqual(activeEntries(w), ['credit-note-list']);
    // Order-flow entry (created by erp-order-flow.js) highlights itself only.
    w.ERPOrderFlow.open();
    assert.deepEqual(activeEntries(w), ['order-flow']);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

// Every panel id the app navigates to with go() — inline onclick="go('…')", window.go?.('…'), data-ux-go /
// data-pe-go buttons, the work queue and workflow ribbon (panel: '…'), linked-flow list links, the "ทางลัด"
// list and the sidebar tables — must exist in the booted page and open with go().
function routesUsedInSources() {
  const runtime = fs.readdirSync(ROOT).filter(file => file.endsWith('.js') && file !== 'vite.config.js');
  const routes = new Map();
  const add = (route, file) => {
    if (!routes.has(route)) routes.set(route, new Set());
    routes.get(route).add(file);
  };
  const patterns = [
    /\bgo(?:\?\.)?\(\s*['"]([a-z0-9-]+)['"]/g,
    /data-(?:ux|pe)-go=\\?["']([a-z0-9-]+)\\?["']/g,
    /\bpanel\s*:\s*['"](?:panel-)?([a-z0-9-]+)['"]/g,
    /\bstep\(\s*'[^']*'\s*,\s*'([a-z0-9-]+)'/g,
    /\blinkedStage\(\s*'[^']*'\s*,[^,]+,\s*'[a-z-]+'\s*,\s*'([a-z0-9-]+)'/g,
    /^\s*\['([a-z0-9-]+)','[^']+'\],?$/gm
  ];
  for (const file of [...runtime, 'index.html']) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const pattern of patterns) for (const match of source.matchAll(pattern)) add(match[1], file);
  }
  return routes;
}

test('every go() route used in the app still resolves to an existing panel (tests, quick actions, work queue, search and links call them directly)', async () => {
  const routes = routesUsedInSources();
  // The scan must see the routes this change touched: the former menu targets of the merged pairs.
  for (const route of ['quote-form', 'invoice-form', 'receipt-form', 'production-form', 'expense-form', 'quote-list', 'invoice-list', 'receipt-list', 'credit-note-list', 'production-list', 'expense-list', 'order-flow', 'approval-center', 'work-home', 'delivery-tax-doc', 'receipt-doc', 'quotation-document']) {
    assert.ok(routes.has(route), `scan found ${route}`);
  }
  assert.ok(routes.size >= 25, `${routes.size} routes`);
  const h = await bootReady();
  const { w } = h;
  const d = w.document;
  try {
    d.getElementById('pe-mode-toggle').click(); // โหมดขั้นสูง: no screen is sent back to งานของฉัน
    const nav = await import('node:url').then(({ pathToFileURL }) => import(pathToFileURL(path.join(ROOT, 'erp-product-experience-core.js')).href));
    for (const panel of [...nav.NAV_SECTIONS.flatMap(section => section.panels), ...Object.keys(nav.NAV_ENTRY_FOR_PANEL)]) routes.set(panel, routes.get(panel) || new Set(['NAV_SECTIONS']));
    const missing = [...routes].filter(([route]) => !d.getElementById(`panel-${route}`)).map(([route, files]) => `${route} (${[...files].join(', ')})`);
    assert.deepEqual(missing, []);
    for (const route of routes.keys()) {
      w.go(route);
      assert.equal(d.querySelector('.panel.active').id, `panel-${route}`, route);
    }
    await sleep(60);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('every .panel is still reachable with go(): simple mode keeps each working screen, advanced mode keeps every screen', async () => {
  const h = await bootReady();
  const { w } = h;
  const d = w.document;
  try {
    assert.equal((await w.ERPDemoSeed.load()).status, 'loaded');
    const panels = [...d.querySelectorAll('.panel')].map(panel => panel.id.replace('panel-', ''));
    assert.ok(panels.length >= 30, `${panels.length} panels`);
    const activePanel = () => d.querySelector('.panel.active').id.replace('panel-', '');
    for (const advanced of [false, true]) {
      if (advanced) d.getElementById('pe-mode-toggle').click();
      for (const id of panels) {
        w.go(id);
        assert.equal(activePanel(), id, `go('${id}') shows it`);
        await sleep(45);
        const expected = !advanced && ADVANCED.includes(id) ? 'work-home' : id;
        assert.equal(activePanel(), expected, `${id} in ${advanced ? 'advanced' : 'simple'} mode`);
      }
    }
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('sections fold and are remembered per browser (tenant key, kept by the demo reset); the section of the page opened from elsewhere expands', async () => {
  let stored = null;
  let mode = null;
  {
    const h = await bootReady();
    const { w } = h;
    const d = w.document;
    try {
      const group = id => d.querySelector(`.nav-group[data-nav-section="${id}"]`);
      const toggle = id => group(id).querySelector('.nav-group-toggle');
      const collapsedStored = () => JSON.parse(w.localStorage.getItem(COLLAPSED_KEY) || '[]');
      w.go('work-home');
      toggle('data').click();
      toggle('operations').click();
      assert.equal(toggle('data').getAttribute('aria-expanded'), 'false');
      assert.ok(group('data').classList.contains('is-collapsed'));
      assert.deepEqual(collapsedStored(), ['data', 'operations']);
      assert.deepEqual(visibleEntries(w), SIMPLE_ENTRIES.filter(panel => !['master-data', 'linked-flow', 'customer-portal', 'production-list', 'purchase-order', 'goods-receipt', 'inventory'].includes(panel)));
      // Opening a page of a collapsed section from elsewhere (search, quick action, link) expands it, and that is remembered.
      w.go('goods-receipt');
      assert.equal(group('operations').classList.contains('is-collapsed'), false);
      assert.equal(toggle('operations').getAttribute('aria-expanded'), 'true');
      assert.deepEqual(collapsedStored(), ['data']);
      // A form opens the section of its document entry.
      toggle('sales').click();
      w.go('receipt-form');
      assert.equal(group('sales').classList.contains('is-collapsed'), false);
      // Folding the section of the page on screen is respected while the page re-renders itself
      // (same entry); only that page's entry stays visible in it.
      toggle('sales').click();
      w.go('receipt-list');
      w.go('receipt-form');
      assert.ok(group('sales').classList.contains('is-collapsed'));
      assert.deepEqual(visibleEntries(w).filter(panel => SECTIONS[1][2].includes(panel)), ['receipt-list']);
      assert.deepEqual(collapsedStored(), ['data', 'sales']);
      // The order-flow entry (added by erp-order-flow.js) expands its section too.
      w.go('work-home');
      w.ERPOrderFlow.open();
      assert.equal(group('sales').classList.contains('is-collapsed'), false);
      assert.deepEqual(collapsedStored(), ['data']);
      // A heading click only folds; it does not navigate.
      const before = d.querySelector('.panel.active').id;
      toggle('home').click();
      assert.equal(d.querySelector('.panel.active').id, before);
      toggle('home').click();
      d.getElementById('pe-mode-toggle').click();
      // The demo reset keeps both view preferences.
      assert.equal((await w.ERPDemoSeed.reset()).status, 'reset');
      stored = w.localStorage.getItem(COLLAPSED_KEY);
      mode = w.localStorage.getItem(MODE_KEY);
      assert.equal(stored, '["data"]');
      assert.equal(mode, 'advanced');
      await sleep(900); // Trial usage refresh after the reset
      assert.deepEqual(h.errors, []);
    } finally { h.close(); }
  }
  // "Reload": a new page with the same browser storage; a stored id this build does not know is ignored.
  const h = await bootReady({ beforeScripts: w => { w.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...JSON.parse(stored), 'tracking'])); w.localStorage.setItem(MODE_KEY, mode); } });
  const { w } = h;
  try {
    const data = w.document.querySelector('.nav-group[data-nav-section="data"]');
    assert.ok(data.classList.contains('is-collapsed'));
    assert.equal(data.querySelector('.nav-group-toggle').getAttribute('aria-expanded'), 'false');
    assert.deepEqual([...w.document.querySelectorAll('.sidebar .nav-group.is-collapsed')].map(group => group.dataset.navSection), ['data']);
    // The start page's section (หน้าหลัก) is open.
    assert.equal(w.document.querySelector('.nav-group[data-nav-section="home"]').classList.contains('is-collapsed'), false);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('phones / tablets (≤ 900 px): choosing any entry closes the ☰ drawer — also the entries added by modules — while a section heading only folds', async () => {
  const h = await bootReady({ beforeScripts: w => { Object.defineProperty(w, 'innerWidth', { configurable: true, get: () => 390 }); } });
  const { w } = h;
  const d = w.document;
  try {
    assert.equal(w.innerWidth, 390);
    const open = () => d.getElementById('mobile-menu-toggle').click();
    const isOpen = () => d.body.classList.contains('mobile-menu-open');
    for (const panel of ['work-home', 'approval-center', 'customer-portal', 'quote-list']) {
      open();
      assert.equal(isOpen(), true);
      const item = navItems(w).find(entry => entryOf(entry) === panel);
      if (item.getAttribute('onclick')) item.onclick = new w.Function('event', item.getAttribute('onclick'));
      item.click();
      assert.equal(await waitFor(() => !isOpen(), 40), true, `${panel} closes the drawer`);
      assert.equal(d.querySelector('.panel.active').id, `panel-${panel}`);
    }
    open();
    d.querySelector('.nav-group[data-nav-section="sales"] .nav-group-toggle').click();
    await sleep(150);
    assert.equal(isOpen(), true, 'a heading keeps the drawer open');
    assert.ok(d.querySelector('.nav-group[data-nav-section="sales"]').classList.contains('is-collapsed'));
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});
