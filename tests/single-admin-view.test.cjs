// Single Admin view (ADR-014): the per-role "มุมมอง" selector (ผู้บริหาร / ฝ่ายขาย / จัดซื้อ / คลัง /
// บัญชี / Admin) is removed. Everyone sees the full Admin experience; only the โหมดง่าย / โหมดขั้นสูง
// toggle still hides the advanced screens. A role left in localStorage by the old selector
// (e.g. 'warehouse') must change nothing and is removed on startup.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./dom-helper.cjs');

const TENANT_PREFIX = 'erp_tenant::customer-showcase-local::';
const STALE_ROLE_KEY = `${TENANT_PREFIX}erp_product_experience_role_v1`;
const PRODUCT_MASTER_KEY = `${TENANT_PREFIX}comform_product_master_v1`;
// Working screens the former default role (ผู้บริหาร) and most other roles hid — by their menu entry
// (ADR-015: one entry per document type, opening the list; the forms have no entry of their own).
const WORKING_PANELS = ['invoice-list', 'receipt-list', 'credit-note-list', 'expense-list', 'goods-receipt', 'production-list'];
// saas-admin left the list in ADR-020: customers must reach ตั้งค่าบริษัท (company / logo) in โหมดง่าย.
const ADVANCED = ['analytics', 'business-rules', 'audit-log', 'files'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, tries = 120) {
  for (let i = 0; i < tries && !check(); i++) await sleep(25);
  return check();
}
const text = el => String(el?.textContent || '').replace(/\s+/g, ' ').trim();
const navItems = w => [...w.document.querySelectorAll('.sidebar .nav-item')];
const navFor = (w, panel) => navItems(w).find(item => item.dataset.pePanel === panel);

// Boots the app as a browser that still holds the old selector's choice.
async function bootWithStaleRole(role) {
  const h = await boot({ beforeScripts: w => w.localStorage.setItem(STALE_ROLE_KEY, role) });
  const ready = await waitFor(() => !!h.w.ERPProductExperience && !!h.w.document.getElementById('pe-mode-toggle'));
  assert.equal(ready, true, 'product experience layer booted');
  return h;
}

test('no role selector: stale "warehouse" is removed on startup and hides nothing; the mode toggle still hides only advanced screens', async () => {
  const h = await bootWithStaleRole('warehouse');
  const { w } = h;
  const $ = id => w.document.getElementById(id);
  try {
    assert.equal(w.ComformTenant.storageKey('erp_product_experience_role_v1'), STALE_ROLE_KEY, 'the test seeds the key the app used');
    assert.equal($('pe-role-select'), null, 'no role/persona dropdown');
    assert.equal(w.document.querySelector('.pe-role-controls, #pe-role-controls, .pe-role-pill'), null);
    assert.doesNotMatch(text(w.document.querySelector('.comform-topbar')), /มุมมอง/);
    assert.equal(w.localStorage.getItem(STALE_ROLE_KEY), null, 'the stale role value is removed on startup');
    assert.equal(w.document.body.dataset.erpRole, undefined);
    assert.equal('currentRole' in w.ERPProductExperience, false);
    assert.equal(text($('pe-mode-toggle')), 'โหมดง่าย');

    // โหมดง่าย: every non-advanced menu item is visible, advanced ones are hidden.
    const simpleHidden = navItems(w).filter(item => item.hidden).map(item => item.dataset.pePanel).sort();
    assert.deepEqual(simpleHidden, [...ADVANCED].sort());
    for (const panel of WORKING_PANELS) assert.equal(navFor(w, panel)?.hidden, false, `${panel} is visible`);
    for (const item of navItems(w).filter(x => !x.dataset.peAdvanced)) assert.equal(item.hidden, false, `${item.dataset.pePanel || text(item)} is visible`);

    // A role value written again later (e.g. by another tab running an old build) is never read.
    for (const role of ['sales', 'purchasing', 'warehouse', 'accounting', 'management']) {
      w.localStorage.setItem(STALE_ROLE_KEY, role);
      w.ERPProductExperience.applyExperience();
      assert.deepEqual(navItems(w).filter(item => item.hidden).map(item => item.dataset.pePanel).sort(), [...ADVANCED].sort(), role);
    }

    // โหมดขั้นสูง: everything is visible; back to โหมดง่าย hides the advanced screens again.
    $('pe-mode-toggle').click();
    assert.equal(text($('pe-mode-toggle')), 'โหมดขั้นสูง');
    assert.equal($('pe-mode-toggle').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(navItems(w).filter(item => item.hidden), []);
    $('pe-mode-toggle').click();
    assert.equal(text($('pe-mode-toggle')), 'โหมดง่าย');
    assert.deepEqual(navItems(w).filter(item => item.hidden).map(item => item.dataset.pePanel).sort(), [...ADVANCED].sort());
    assert.deepEqual(h.errors, []);
  } finally {
    h.close();
  }
});

test('งานของฉัน shows AR and stock work together, Admin KPIs / shortcuts, the overdue banner and badge; approval center has no role pill', async () => {
  const h = await bootWithStaleRole('warehouse');
  const { w } = h;
  const $ = id => w.document.getElementById(id);
  try {
    assert.equal((await w.ERPDemoSeed.load()).status, 'loaded');
    // Raise one stock product's reorder point so a stock item (formerly purchasing / warehouse only) is due.
    const master = JSON.parse(w.localStorage.getItem(PRODUCT_MASTER_KEY));
    const product = master.find(row => row.code === 'DEMO-KB01');
    assert.ok(product, 'sample stock product DEMO-KB01');
    product.reorderPoint = 100000;
    w.localStorage.setItem(PRODUCT_MASTER_KEY, JSON.stringify(master));

    w.go('work-home');
    await waitFor(() => w.document.querySelectorAll('#pe-work-home .pe-work-item').length > 0);
    const titles = [...w.document.querySelectorAll('#pe-work-home .pe-work-item b')].map(text);
    assert.ok(titles.some(t => /^ลูกหนี้เกินกำหนด \d+ ใบ$/.test(t)), `AR item (formerly accounting / management only): ${titles.join(' | ')}`);
    assert.ok(titles.some(t => /^สินค้าแตะ Reorder Point \d+ SKU\/สาขา$/.test(t)), `stock item (formerly purchasing / warehouse): ${titles.join(' | ')}`);
    assert.ok(titles.some(t => /^ใบเสนอราคารออนุมัติ \d+ ใบ$/.test(t)), 'quote approval (formerly sales / management)');
    assert.match(text(w.document.querySelector('#pe-work-home .pe-kicker')), /· Admin$/);
    assert.deepEqual([...w.document.querySelectorAll('#pe-work-home .pe-kpi-grid small')].map(text), ['ยอดลูกหนี้', 'Sales Order กำลังทำ', 'Open PO', 'Stock ต่ำ/เสี่ยง']);
    const shortcuts = () => [...w.document.querySelectorAll('#pe-work-home .pe-quick-actions [data-pe-go]')].map(b => b.dataset.peGo);
    assert.deepEqual(shortcuts(), ['dashboard', 'approval-center', 'order-flow', 'customer-portal'], 'simple mode offers no hidden screen');
    $('pe-mode-toggle').click();
    assert.deepEqual(shortcuts(), ['dashboard', 'approval-center', 'order-flow', 'customer-portal', 'analytics', 'audit-log']);
    $('pe-mode-toggle').click();

    // Overdue receivables banner (home + dashboard) and navigation badge, for everyone.
    assert.equal(await waitFor(() => !!$('ar-overdue-banner-home') && !$('ar-overdue-banner-home').hidden), true, 'banner on งานของฉัน');
    assert.match(text(w.document.querySelector('.ar-nav-badge')), /^\d+$/);
    w.go('dashboard');
    w.renderDash();
    assert.equal(await waitFor(() => !!$('ar-overdue-banner') && !$('ar-overdue-banner').hidden), true, 'banner on the dashboard');

    w.go('approval-center');
    await waitFor(() => !!w.document.querySelector('#pe-approval-center .pe-page-head'));
    assert.equal(w.document.querySelector('.pe-role-pill'), null);
    assert.equal(w.localStorage.getItem(STALE_ROLE_KEY), null);
    assert.deepEqual(h.errors, []);
  } finally {
    h.close();
  }
});
