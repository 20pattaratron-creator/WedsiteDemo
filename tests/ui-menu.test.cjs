// ADR-015 (round 5, UI declutter): the reusable dropdown menu (erp-ui-menu.js), the sidebar
// helpers of erp-product-experience-core.js and the static markup of index.html.
// Pure functions are imported directly; the DOM behaviour of the menu is exercised in a bare
// jsdom page (no app boot), so this file stays in the fast suite.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
let menuModule;
let navCore;
test.before(async () => {
  menuModule = await import(pathToFileURL(path.join(ROOT, 'erp-ui-menu.js')).href + '?v=' + Date.now());
  navCore = await import(pathToFileURL(path.join(ROOT, 'erp-product-experience-core.js')).href + '?v=' + Date.now());
});

// ------------------------------------------------------------------ pure menu helpers
test('normalizeMenuItems: drops unlabeled entries, orders by `order`, puts danger items last, keeps "disabled not managed" as null', () => {
  const onSelect = () => {};
  const items = menuModule.normalizeMenuItems([
    { key: 'reset', label: 'ล้างข้อมูล', danger: true },
    { key: 'backup', label: 'สำรองข้อมูล', order: 40 },
    null,
    { key: 'blank', label: '   ' },
    { key: 'health', label: ' ตรวจสถานะ ', order: 10, disabled: true, onSelect, dataset: { demoSeedAction: 'load' }, id: 'x-id', title: 'tip' },
    { label: 'ไม่มี key' }
  ]);
  assert.deepEqual(items.map(item => item.key), ['item-5', 'health', 'backup', 'reset']);
  const health = items.find(item => item.key === 'health');
  assert.equal(health.label, 'ตรวจสถานะ');
  assert.equal(health.disabled, true);
  assert.equal(health.onSelect, onSelect);
  assert.deepEqual(health.dataset, { demoSeedAction: 'load' });
  assert.equal(health.id, 'x-id');
  assert.equal(items.find(item => item.key === 'backup').disabled, null, 'not given = not managed by the caller');
  assert.equal(items.at(-1).danger, true);
  assert.deepEqual(menuModule.normalizeMenuItems(undefined), []);
  assert.deepEqual(menuModule.normalizeMenuItems('x'), []);
});

test('menuRows: one separator before the first danger item, none when there is nothing above it', () => {
  const rows = menuModule.menuRows(menuModule.normalizeMenuItems([{ label: 'a' }, { label: 'b' }, { label: 'x', danger: true }, { label: 'y', danger: true }]));
  assert.deepEqual(rows.map(row => row.type === 'separator' ? '---' : row.item.label), ['a', 'b', '---', 'x', 'y']);
  const onlyDanger = menuModule.menuRows(menuModule.normalizeMenuItems([{ label: 'x', danger: true }]));
  assert.deepEqual(onlyDanger.map(row => row.type), ['item']);
  assert.deepEqual(menuModule.menuRows([]), []);
});

test('nextEnabledIndex: wraps around, skips disabled items, starts from either end, -1 when nothing is enabled', () => {
  const flags = [false, true, false, false];
  assert.equal(menuModule.nextEnabledIndex(flags, -1, 1), 0, 'ArrowDown / Home from outside → first');
  assert.equal(menuModule.nextEnabledIndex(flags, -1, -1), 3, 'ArrowUp / End from outside → last');
  assert.equal(menuModule.nextEnabledIndex(flags, 0, 1), 2, 'skips the disabled item');
  assert.equal(menuModule.nextEnabledIndex(flags, 3, 1), 0, 'wraps to the top');
  assert.equal(menuModule.nextEnabledIndex(flags, 0, -1), 3, 'wraps to the bottom');
  assert.equal(menuModule.nextEnabledIndex(flags, 2, -1), 0, 'skips the disabled item upwards');
  assert.equal(menuModule.nextEnabledIndex([true, true], -1, 1), -1);
  assert.equal(menuModule.nextEnabledIndex([], -1, 1), -1);
  assert.equal(menuModule.nextEnabledIndex(flags, 99, 1), 0, 'an out-of-range start counts as outside');
});

test('menuPosition: below the button with right edges aligned, clamped to the viewport, flipped above near the bottom, scrolls when too tall', () => {
  const viewport = { width: 1000, height: 800 };
  const size = { width: 240, height: 200 };
  // Header button at the top right: below it, right edges aligned.
  assert.deepEqual(menuModule.menuPosition({ top: 20, bottom: 56, left: 880, right: 980 }, size, viewport),
    { top: 60, left: 740, placement: 'bottom', maxHeight: null });
  // 'start' aligns left edges; a button at the far left is clamped to the 8 px margin.
  assert.equal(menuModule.menuPosition({ top: 20, bottom: 56, left: 100, right: 130 }, size, viewport, { align: 'start' }).left, 100);
  assert.equal(menuModule.menuPosition({ top: 20, bottom: 56, left: 0, right: 30 }, size, viewport).left, 8);
  // Near the right edge with align start: kept inside (1000 - 8 - 240).
  assert.equal(menuModule.menuPosition({ top: 20, bottom: 56, left: 900, right: 930 }, size, viewport, { align: 'start' }).left, 752);
  // A row button near the bottom of the screen: the menu opens above it.
  assert.deepEqual(menuModule.menuPosition({ top: 700, bottom: 730, left: 500, right: 540 }, size, viewport),
    { top: 496, left: 300, placement: 'top', maxHeight: null });
  // Taller than the room on the larger side: it scrolls (maxHeight) instead of leaving the screen.
  const tall = menuModule.menuPosition({ top: 300, bottom: 330, left: 500, right: 540 }, { width: 240, height: 900 }, viewport);
  assert.equal(tall.placement, 'bottom');
  assert.equal(tall.top, 334);
  assert.equal(tall.maxHeight, 800 - 330 - 4 - 8);
  // A very short screen: the whole viewport height, from the top margin.
  const tiny = menuModule.menuPosition({ top: 40, bottom: 70, left: 10, right: 40 }, { width: 200, height: 300 }, { width: 320, height: 150 });
  assert.equal(tiny.placement, 'viewport');
  assert.equal(tiny.top, 8);
  assert.equal(tiny.maxHeight, 134);
});

// ------------------------------------------------------------------ menu in a bare jsdom page
function menuPage(bodyHtml = '') {
  const dom = new JSDOM(`<!doctype html><html><body><button id="outside">outside</button>${bodyHtml}</body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://erp.test/' });
  const w = dom.window;
  // Same idea as tests/dom-helper.cjs: the browser module without its `export` keywords, in its own scope.
  const source = read('erp-ui-menu.js').replace(/^\s*export\s+(?=(?:async\s+)?(?:function|const|let|class)\b)/gm, '');
  w.eval(`(()=>{${source}\n})();`);
  return { w, d: w.document, close: () => w.close() };
}
const key = (w, element, name, extra = {}) => element.dispatchEvent(new w.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...extra }));
const menuItems = menu => [...menu.element.querySelectorAll('[role="menuitem"]')];

test('menu button: aria attributes, opens on click with focus on the first enabled item, closes on a second click', () => {
  const { w, d, close } = menuPage('<button id="demo">Demo</button>');
  try {
    const button = d.getElementById('demo');
    const menu = w.ERPUiMenu.attachMenu(button, { label: 'เมนู Demo', items: [{ key: 'a', label: 'A', disabled: true }, { key: 'b', label: 'B' }, { key: 'c', label: 'C', danger: true }] });
    assert.equal(button.getAttribute('aria-haspopup'), 'menu');
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(button.getAttribute('aria-controls'), menu.element.id);
    assert.equal(menu.element.getAttribute('role'), 'menu');
    assert.equal(menu.element.getAttribute('aria-label'), 'เมนู Demo');
    assert.equal(menu.element.hidden, true);
    assert.equal(menu.element.parentElement, d.body, 'lives in <body>, outside any overflow container');
    assert.deepEqual(menuItems(menu).map(item => [item.tagName, item.getAttribute('role'), item.tabIndex]), [['BUTTON', 'menuitem', -1], ['BUTTON', 'menuitem', -1], ['BUTTON', 'menuitem', -1]]);
    assert.equal(menu.element.querySelectorAll('[role="separator"]').length, 1);
    assert.ok(menuItems(menu)[2].classList.contains('is-danger'));
    button.click();
    assert.equal(menu.isOpen(), true);
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.equal(menu.element.hidden, false);
    assert.equal(d.activeElement, menuItems(menu)[1], 'the disabled first item is skipped');
    button.click();
    assert.equal(menu.isOpen(), false);
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(menu.element.hidden, true);
  } finally { close(); }
});

test('menu keyboard: arrows / Home / End move between enabled items, Escape closes and returns focus, Tab closes', () => {
  const { w, d, close } = menuPage('<button id="demo">Demo</button>');
  try {
    const button = d.getElementById('demo');
    const menu = w.ERPUiMenu.attachMenu(button, { items: [{ label: 'A' }, { label: 'B', disabled: true }, { label: 'C' }, { label: 'D', danger: true }] });
    const [a, , c, dItem] = menuItems(menu);
    button.focus();
    key(w, button, 'ArrowDown');
    assert.equal(menu.isOpen(), true, 'ArrowDown on the button opens the menu');
    assert.equal(d.activeElement, a);
    key(w, a, 'ArrowDown');
    assert.equal(d.activeElement, c, 'disabled B is skipped');
    key(w, c, 'ArrowDown');
    assert.equal(d.activeElement, dItem);
    key(w, dItem, 'ArrowDown');
    assert.equal(d.activeElement, a, 'wraps around');
    key(w, a, 'ArrowUp');
    assert.equal(d.activeElement, dItem);
    key(w, dItem, 'Home');
    assert.equal(d.activeElement, a);
    key(w, a, 'End');
    assert.equal(d.activeElement, dItem);
    // Escape: closed, focus back on the button, and other Escape handlers do not also run.
    let escapeSeenByPage = false;
    d.addEventListener('keydown', event => { if (event.key === 'Escape') escapeSeenByPage = true; });
    key(w, dItem, 'Escape');
    assert.equal(menu.isOpen(), false);
    assert.equal(d.activeElement, button);
    assert.equal(escapeSeenByPage, false);
    // ArrowUp on the button opens with the last item focused; Tab closes and goes back to the button.
    key(w, button, 'ArrowUp');
    assert.equal(d.activeElement, dItem);
    key(w, dItem, 'Tab');
    assert.equal(menu.isOpen(), false);
    assert.equal(d.activeElement, button);
  } finally { close(); }
});

test('menu: an outside click closes it without taking focus; choosing an item closes it, returns focus and runs onSelect once; disabled items do nothing', () => {
  const { w, d, close } = menuPage('<button id="demo">Demo</button>');
  try {
    const button = d.getElementById('demo');
    const calls = [];
    const delegated = [];
    // Document-level delegation (like erp-demo-seed.js with data-demo-seed-action) still sees the click.
    d.addEventListener('click', event => {
      const target = event.target.closest?.('[data-demo-seed-action]');
      if (target) delegated.push(target.dataset.demoSeedAction);
    });
    const menu = w.ERPUiMenu.attachMenu(button, { items: [
      { key: 'go', label: 'Go', onSelect: (event, item) => calls.push([item.key, event.type]) },
      { key: 'load', label: 'Load', dataset: { demoSeedAction: 'load' } },
      { key: 'off', label: 'Off', disabled: true, onSelect: () => calls.push(['off']) }
    ] });
    button.click();
    d.getElementById('outside').click();
    assert.equal(menu.isOpen(), false, 'outside click closes');
    assert.notEqual(d.activeElement, button, 'an outside click does not move focus to the button');
    button.click();
    menuItems(menu)[0].querySelector('.erp-menu-label').click();
    assert.equal(menu.isOpen(), false);
    assert.equal(d.activeElement, button);
    assert.deepEqual(calls, [['go', 'click']]);
    button.click();
    menuItems(menu)[1].click();
    assert.deepEqual(delegated, ['load'], 'the click bubbles to document-level handlers');
    assert.equal(menuItems(menu)[1].getAttribute('data-demo-seed-action'), 'load');
    button.click();
    menuItems(menu)[2].click();
    assert.deepEqual(calls, [['go', 'click']], 'a disabled item never runs');
    assert.equal(menu.isOpen(), true, 'clicking a disabled item keeps the menu open');
  } finally { close(); }
});

test('menu: only one menu is open at a time (also across copies of the module)', () => {
  const { w, d, close } = menuPage('<button id="one">1</button><button id="two">2</button>');
  try {
    const first = w.ERPUiMenu.attachMenu(d.getElementById('one'), { items: [{ label: 'A' }] });
    const second = w.ERPUiMenu.attachMenu(d.getElementById('two'), { items: [{ label: 'B' }] });
    d.getElementById('one').click();
    assert.equal(first.isOpen(), true);
    d.getElementById('two').click();
    assert.equal(second.isOpen(), true);
    assert.equal(first.isOpen(), false);
    // The signal is a document event, so a menu from another copy of the module closes too.
    d.dispatchEvent(new w.CustomEvent('erp-ui-menu:open', { detail: { menu: null } }));
    assert.equal(second.isOpen(), false);
  } finally { close(); }
});

test('menu: items keep a state another module set on them when the list is re-rendered; addItem / hasItem / getMenu', () => {
  const { w, d, close } = menuPage('<button id="demo">Demo</button>');
  try {
    const menu = w.ERPUiMenu.attachMenu(d.getElementById('demo'), { name: 'erp-test', items: [{ key: 'load', label: 'Load', order: 20 }] });
    assert.equal(w.ERPUiMenu.getMenu('erp-test'), menu);
    assert.equal(w.ERPUiMenu.getMenu('missing'), null);
    const load = menuItems(menu)[0];
    load.disabled = true; // e.g. erp-demo-seed.js while the sample data loads
    menu.addItem({ key: 'health', label: 'Health', order: 10 });
    menu.addItem({ key: 'reset', label: 'Reset', danger: true });
    assert.equal(menu.hasItem('health'), true);
    assert.equal(menu.hasItem('nope'), false);
    assert.deepEqual(menuItems(menu).map(item => item.textContent), ['Health', 'Load', 'Reset']);
    assert.equal(menuItems(menu)[1], load, 'same element reused');
    assert.equal(load.disabled, true, 'state kept');
    menu.addItem({ key: 'load', label: 'Load again', order: 20, disabled: false });
    assert.equal(menuItems(menu)[1].textContent, 'Load again');
    assert.equal(menuItems(menu)[1].disabled, false, 'an explicit disabled value wins');
  } finally { close(); }
});

test('row menus: openMenuFor toggles a menu that exists only while open, follows its button when a container scrolls, closes when the button leaves the screen or the row is re-rendered', () => {
  const { w, d, close } = menuPage('<div id="wrap" style="overflow:auto;height:100px"><table><tbody><tr><td><button id="row1" data-row-menu="1">⋯</button></td></tr></tbody></table></div>');
  try {
    const button = d.getElementById('row1');
    let rect = { top: 100, bottom: 130, left: 500, right: 530, width: 30, height: 30 };
    button.getBoundingClientRect = () => rect;
    const selected = [];
    // The pattern for table rows: one delegated handler for every "⋯" button.
    d.addEventListener('click', event => {
      const rowButton = event.target.closest?.('[data-row-menu]');
      if (rowButton) w.ERPUiMenu.openMenuFor(rowButton, { items: () => [{ key: 'edit', label: `แก้ไข ${rowButton.dataset.rowMenu}`, onSelect: () => selected.push('edit') }, { key: 'delete', label: 'ลบ', danger: true }] });
    });
    button.click();
    const menuElement = () => d.querySelector('.erp-menu');
    assert.ok(menuElement(), 'created on open');
    assert.equal(menuElement().style.top, '134px');
    assert.deepEqual([...menuElement().querySelectorAll('[role="menuitem"]')].map(item => item.textContent), ['แก้ไข 1', 'ลบ']);
    button.click();
    assert.equal(menuElement(), null, 'the second click closes it and removes the element');
    assert.equal(d.activeElement, button);
    button.click();
    // The table wrapper scrolls: the menu follows the button.
    rect = { top: 60, bottom: 90, left: 500, right: 530, width: 30, height: 30 };
    d.getElementById('wrap').dispatchEvent(new w.Event('scroll'));
    assert.equal(menuElement().style.top, '94px');
    // Scrolled off the screen: closed.
    rect = { top: -80, bottom: -50, left: 500, right: 530, width: 30, height: 30 };
    d.getElementById('wrap').dispatchEvent(new w.Event('scroll'));
    assert.equal(menuElement(), null);
    // Re-rendered row (button removed): the next scroll/resize closes the menu.
    rect = { top: 100, bottom: 130, left: 500, right: 530, width: 30, height: 30 };
    button.click();
    assert.ok(menuElement());
    [...menuElement().querySelectorAll('[role="menuitem"]')][0].click();
    assert.deepEqual(selected, ['edit']);
    button.click();
    button.closest('tr').remove();
    w.dispatchEvent(new w.Event('resize'));
    assert.equal(menuElement(), null);
  } finally { close(); }
});

// ------------------------------------------------------------------ sidebar helpers (pure)
test('sidebar sections: every entry once, forms map to their list entry, stored collapsed list is sanitised', () => {
  const panels = navCore.NAV_SECTIONS.flatMap(section => section.panels);
  assert.equal(new Set(panels).size, panels.length, 'no entry in two sections');
  assert.deepEqual(navCore.NAV_SECTIONS.map(section => [section.id, section.label, section.panels.length]), [
    ['home', 'หน้าหลัก', 3], ['sales', 'ขายและรับเงิน', 5], ['operations', 'ซื้อ / ผลิต / คลัง', 4],
    ['expenses', 'ค่าใช้จ่าย', 1], ['data', 'ข้อมูลและรายงาน', 5], ['settings', 'ตั้งค่า', 4] // data + รายงานภาษี (ADR-023)
  ]);
  assert.equal(panels.length, 22);
  for (const form of ['quote-form', 'invoice-form', 'receipt-form', 'credit-note-form', 'production-form', 'expense-form']) {
    assert.equal(panels.includes(form), false, `${form} has no entry of its own`);
    const entry = navCore.navEntryPanel(form);
    assert.ok(panels.includes(entry), `${form} → ${entry}`);
  }
  assert.equal(navCore.navEntryPanel('invoice-form'), 'invoice-list');
  assert.equal(navCore.navEntryPanel('issued-receipt-list'), 'receipt-list');
  assert.equal(navCore.navEntryPanel('dashboard'), 'dashboard');
  assert.equal(navCore.navEntryPanel(undefined), '');
  assert.equal(navCore.navSectionForPanel('receipt-form'), 'sales');
  assert.equal(navCore.navSectionForPanel('approval-center'), 'home');
  assert.equal(navCore.navSectionForPanel('expense-form'), 'expenses');
  assert.equal(navCore.navSectionForPanel('nope'), '');
  // "← รายการ…" links: every form, to its list; the issued-document lists are not forms.
  assert.deepEqual(navCore.navFormBackTargets(), [
    { form: 'quote-form', list: 'quote-list' }, { form: 'invoice-form', list: 'invoice-list' }, { form: 'receipt-form', list: 'receipt-list' },
    { form: 'credit-note-form', list: 'credit-note-list' }, { form: 'production-form', list: 'production-list' }, { form: 'expense-form', list: 'expense-list' }
  ]);
  // Retired ids (e.g. from an earlier build) and junk are dropped.
  assert.deepEqual(navCore.parseCollapsedNavSections('["data","nope","data",3,"settings","tracking"]'), ['data', 'settings']);
  assert.deepEqual(navCore.parseCollapsedNavSections('{bad json'), []);
  assert.deepEqual(navCore.parseCollapsedNavSections('{"a":1}'), []);
  assert.deepEqual(navCore.parseCollapsedNavSections(null), []);
  assert.deepEqual(navCore.parseCollapsedNavSections(['home']), ['home']);
});

// ------------------------------------------------------------------ static markup
test('index.html: one slim Local Demo notice, no form entries in the sidebar, line icons only, "+ สร้าง…" on every list page', () => {
  const html = read('index.html');
  const dom = new JSDOM(html);
  const d = dom.window.document;
  try {
    const notices = d.querySelectorAll('#erp-trial-safety-banner, #local-demo-banner, .local-demo-banner');
    assert.equal(notices.length, 1);
    const notice = d.getElementById('erp-trial-safety-banner');
    // Both warnings ("this browser only", "not Production") in the long line and in the phone line.
    assert.match(notice.querySelector('.erp-demo-notice-long').textContent, /^DEMO 4\.3\.1 · ข้อมูลทดลองเก็บในเบราว์เซอร์นี้เท่านั้น · ยังไม่ใช่ระบบ Production หลายผู้ใช้$/);
    const short = notice.querySelector('.erp-demo-notice-short');
    assert.equal(short.hidden, true, 'without the stylesheet only the long line shows');
    assert.match(short.textContent, /เบราว์เซอร์นี้.*ยังไม่ใช่ Production/);
    assert.match(notice.getAttribute('title'), /ยังไม่ใช่ระบบ Production หลายผู้ใช้/);
    assert.doesNotMatch(notice.getAttribute('style'), /sticky/, 'scrolls away with the page; the header stays');
    const sidebar = d.querySelector('.sidebar');
    const targets = [...sidebar.querySelectorAll('.nav-item')].map(item => item.getAttribute('onclick').match(/go\('([^']+)'/)[1]);
    assert.equal(new Set(targets).size, targets.length);
    assert.deepEqual(targets.filter(panel => /-form$/.test(panel)), []);
    assert.equal(sidebar.querySelectorAll('.nav-sec').length, 0, 'sections are built by erp-product-experience.js');
    for (const item of sidebar.querySelectorAll('.nav-item')) {
      assert.equal(item.querySelectorAll('svg').length, 1, targets.join());
      assert.doesNotMatch(item.textContent, /\p{Extended_Pictographic}/u);
    }
    const creates = { 'quote-list': 'quote-form', 'invoice-list': 'invoice-form', 'receipt-list': 'receipt-form', 'production-list': 'production-form', 'expense-list': 'expense-form' };
    for (const [list, form] of Object.entries(creates)) {
      const primary = [...d.querySelectorAll(`#panel-${list} .card-title .btn-primary`)];
      assert.equal(primary.length, 1, list);
      assert.match(primary[0].textContent, /^\+ /);
      assert.equal(primary[0].getAttribute('onclick'), `go('${form}')`);
    }
    const creditNote = [...d.querySelectorAll('#panel-credit-note-list .card-title .btn-primary')];
    assert.deepEqual(creditNote.map(button => [button.textContent, button.dataset.cnAction]), [['+ ออกใบลดหนี้', 'new']]);
  } finally { dom.window.close(); }
});
