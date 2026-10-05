// ADR-022 — 1 or 2 establishments in the booted app (jsdom): the setting in ตั้งค่าบริษัท, single-branch
// screens (no branch-2 control / tab / filter / label on any panel), forms that save to the head office,
// sample data at the head office, the money rule (switch refused while branch 2 holds data; imported
// branch-2 data shown + counted, never hidden), labels from the company profile in both modes, backup
// round trip. Pure rules: tests/branches-core.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { boot } = require('./dom-helper.cjs');

const ROOT = path.resolve(__dirname, '..');
const imp = file => import(pathToFileURL(path.join(ROOT, file)).href);
const TENANT = 'erp_tenant::customer-showcase-local::';
const SETTING_KEY = `${TENANT}comform_company_branch_setting_v1`;
const PROFILE_KEY = `${TENANT}comform_company_profile_v1`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = el => String(el?.textContent || '').replace(/\s+/g, ' ').trim();
const plain = value => JSON.parse(JSON.stringify(value));
const money = value => Math.round(Number(value) * 100);
const PROFILE = {
  schemaVersion: 1, nameTh: 'บริษัท สยามตัวอย่าง จำกัด', nameEn: '', taxId: '0105568123453', addressTh: '99/9 ถนนพระราม 9 กรุงเทพมหานคร 10310', phone: '02-123-4567', email: '', website: '',
  branches: { ubon: { code: '00000', label: '', addressTh: '' }, khonkaen: { code: '00003', label: 'สาขาขอนแก่น', addressTh: '' } }, updatedAt: '2026-10-03T10:00:00.000Z'
};
const store = ({ count = null, profile = null } = {}) => ({ beforeScripts: w => {
  if (count) w.localStorage.setItem(SETTING_KEY, JSON.stringify({ schemaVersion: 1, count, updatedAt: '2026-10-04T00:00:00.000Z' }));
  if (profile) w.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
} });

// Visible = no ancestor with [hidden], [data-erp-branch-hidden] or an inline display:none (jsdom has no CSS).
function visible(el) {
  for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
    if (e.hidden || e.hasAttribute('data-erp-branch-hidden') || e.style?.display === 'none' || ['SCRIPT', 'STYLE', 'TEMPLATE'].includes(e.tagName)) return false;
  }
  return true;
}
// Every panel through go() (as a user opens it), then everything branch-2 that could still be seen or used
// in that panel — and once in what is outside the panels (header, sidebar, banners).
const BRANCH_TWO_TEXT = /สาขาที่ 00001|สาขา 00001|Opening 00001|2 สาขา|สองสาขา|khonkaen/;
function scanBranchTwo(w, root, where, found) {
  const walker = w.document.createTreeWalker(root, 4);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const owner = node.parentElement;
    if (where === 'outside panels' && owner.closest('.panel')) continue;
    if (BRANCH_TWO_TEXT.test(node.textContent) && visible(owner)) found.add(`${where}: "${node.textContent.trim().slice(0, 70)}"`);
  }
  for (const option of root.querySelectorAll('option[value="khonkaen"]')) if (!option.hidden && !option.disabled && visible(option.parentElement)) found.add(`${where}: option in #${option.parentElement.id}`);
  for (const el of root.querySelectorAll('[onclick*="khonkaen"], [data-branch="khonkaen"], [data-linked-branch="khonkaen"], #dt-kk, .bc.kk, .dash-tabs')) if (visible(el)) found.add(`${where}: control ${el.id || el.className}`);
}
async function branchTwoLeftovers(w) {
  const found = new Set();
  for (const panel of w.document.querySelectorAll('.panel')) {
    w.go(panel.id.replace('panel-', ''), null);
    await sleep(70);
    scanBranchTwo(w, panel, panel.id, found);
  }
  scanBranchTwo(w, w.document.body, 'outside panels', found);
  return [...found];
}
const branchTwoRecords = w => packKeys(w, 'khonkaen').reduce((n, key) => n + Object.values(JSON.parse(w.localStorage.getItem(key) || '{}')).filter(Array.isArray).reduce((m, rows) => m + rows.length, 0), 0);
const settingsForm = w => w.document.getElementById('company-profile-form');
async function chooseBranchCount(w, count) {
  w.go('saas-admin', null);
  const radio = settingsForm(w).querySelector(`input[name="cp-branch-count"][value="${count}"]`);
  radio.checked = true;
  radio.dispatchEvent(new w.Event('change', { bubbles: true }));
  settingsForm(w).querySelector('[data-cp-action="save"]').click();
  await sleep(120);
}
const dashTotal = w => Number(text(w.document.querySelector('#metrics-total .mc .val')).replace(/,/g, ''));
const packKeys = (w, branch) => Object.keys(w.localStorage).filter(key => key.startsWith(`${TENANT}biz2_${branch}_`));
function arOutstanding(w) {
  const I = w.ERPIntegrity;
  return I.business().invoices.filter(I.live).reduce((sum, inv) => sum + Number(I.paymentSummary(inv).outstanding || 0), 0);
}

test('branch#1 a store that never chose keeps 2 branches and today\'s screens exactly', async () => {
  const h = await boot(); const { w } = h;
  try {
    await sleep(80);
    assert.equal(w.localStorage.getItem(SETTING_KEY), null);
    assert.equal(w.ERPCompanyProfile.read().branchCount, 2);
    assert.equal(w.ERPBranches.multi(), true);
    for (const panel of w.document.querySelectorAll('.panel')) w.go(panel.id.replace('panel-', ''), null);
    await sleep(80);
    assert.deepEqual([...w.document.querySelectorAll('[data-erp-branch-hidden]')].map(el => el.id || el.className), [], 'nothing hidden');
    assert.equal(w.document.getElementById('erp-branch-warning'), null);
    assert.deepEqual(['dt-all', 'dt-ub', 'dt-kk'].map(id => text(w.document.getElementById(id))), ['รวมทั้ง 2 สาขา', 'สาขาสำนักงานใหญ่', 'สาขาที่ 00001']);
    assert.deepEqual([...w.document.getElementById('il-br').options].map(o => o.textContent), ['ทุกสาขา', 'สาขาสำนักงานใหญ่', 'สาขาที่ 00001']);
    assert.deepEqual([...w.document.getElementById('po-branch').options].map(o => o.textContent), ['สำนักงานใหญ่', 'สาขาที่ 00001'], 'each screen keeps its own wording');
    assert.equal(text(w.document.getElementById('i-br-kk')), 'สาขาที่ 00001');
    assert.equal(settingsForm(w).querySelector('input[name="cp-branch-count"]:checked').value, '2');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('branch#2 empty store → "สำนักงานใหญ่อย่างเดียว" → sample data at the head office passes the seed checks; no branch-2 anywhere', async () => {
  const h = await boot(); const { w } = h;
  try {
    await chooseBranchCount(w, 1);
    assert.equal(JSON.parse(w.localStorage.getItem(SETTING_KEY)).count, 1, h.messages.join('\n'));
    assert.equal(w.localStorage.getItem(PROFILE_KEY), null, 'only the count changed: the company stays the sample profile (documents unchanged)');
    assert.equal(text(w.document.getElementById('cp-badge')), 'ยังเป็นข้อมูลตัวอย่าง');
    assert.match(h.messages.join('\n'), /สำนักงานใหญ่อย่างเดียว/);
    const result = await w.ERPDemoSeed.load();
    assert.equal(result.status, 'loaded', h.messages.join('\n'));
    assert.equal(result.plan.branchCount, 1);
    assert.equal(branchTwoRecords(w), 0, 'no branch-2 record');
    const I = w.ERPIntegrity, data = I.business(), flow = I.flow();
    const seeded = rows => rows.filter(r => r.demoSeed === true);
    assert.deepEqual([seeded(data.invoices).length, seeded(data.receipts).length, seeded(data.creditNotes).length, seeded(data.quotes).length, seeded(data.expenses).length], [23, 11, 4, 5, 12]); // ADR-023 tax-month story (was 18 / 8 / 4 / 5 / 7)
    assert.ok(Object.values(data).flat().every(row => row._branch === 'ubon' && row.branch === 'ubon'));
    assert.doesNotMatch(JSON.stringify(flow), /khonkaen/);
    // The same checks as the two-branch sample (demo-seed.test.cjs): balances, statuses, credit-note ledger, stock.
    const statuses = {};
    for (const inv of seeded(data.invoices)) {
      const expected = Object.values(result.plan.expected.invoices).find(x => x.no === inv.no);
      const s = I.paymentSummary(inv);
      assert.deepEqual(plain([s.total, s.paid, s.credited, s.outstanding]), plain([expected.total, expected.paid, expected.credited, expected.outstanding]), inv.no);
      statuses[s.status] = (statuses[s.status] || 0) + 1;
    }
    assert.deepEqual(plain(statuses), { paid: 10, partially_paid: 1, pending: 10, credited: 1, cancelled: 1 }); // ADR-023 story
    const cnCore = await imp('erp-credit-note-core.js');
    assert.deepEqual(plain(cnCore.creditNoteLedgerIssues(data.invoices, data.creditNotes, { matches: I.creditNoteMatches })), []);
    for (const p of result.plan.products.filter(x => x.flowType === 'inventory' && x.fulfillmentType === 'stock')) {
      assert.ok(Number(w.productEstimatedStock(p, 'ubon')) >= 0, p.code);
      assert.equal(Number(w.productEstimatedStock(p, 'khonkaen')), 0, p.code);
    }
    assert.equal(w.ERPCompanyProfile.read().branchCount, 1);
    assert.deepEqual(await branchTwoLeftovers(w), []);
    // Dashboard wording: the company, not "2 สาขา".
    w.go('dashboard', null); w.renderDash();
    await sleep(120); // the AR report refreshes after erp:dashboard-rendered
    assert.equal(text(w.document.querySelector('#metrics-total .mc .lbl')), 'ยอดขายรวมก่อน VAT (ข้อมูลหลัก)');
    assert.equal(w.ERPReceivables.scopeLabel(''), 'ทั้งบริษัท');
    assert.match(text(w.document.getElementById('ar-aging-report')), /ทั้งบริษัท/);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('branch#3 single mode: forms pick the head office themselves and save there; totals = every live document', async () => {
  const h = await boot(store({ count: 1 })); const { w, set } = h;
  try {
    assert.equal((await w.ERPDemoSeed.load()).status, 'loaded', h.messages.join('\n'));
    const shared = await imp('erp-shared-core.js');
    for (let i = 0; i < 100 && !w.saveInvoice?.__stockGuard; i++) await sleep(20);
    // Invoice through the real save path WITHOUT choosing a branch (the choice is hidden).
    w.go('invoice-form', null); w.resetF('invoice');
    assert.equal(w.document.getElementById('i-br-ub').className, 'br-opt ub-sel', 'reset selects the head office');
    set('i-date', shared.localDateISO()); set('i-cust', 'ลูกค้าหน้าเดียว'); set('i-address', '1 ถนนจริง'); set('i-sales', 'ผู้ใช้'); set('i-vat', '1');
    w.document.getElementById('i-items-body').innerHTML = '';
    w.addIItem({ product: 'งานติดตั้ง', qty: 1, unit: 'งาน', priceUnit: 2500 });
    await w.saveInvoice();
    const saved = w.ERPIntegrity.business().invoices.find(i => i.customer === 'ลูกค้าหน้าเดียว');
    assert.ok(saved, h.messages.join('\n'));
    assert.equal(saved._branch, 'ubon');
    assert.equal(branchTwoRecords(w), 0);
    // Credit note form: head office without a choice.
    w.go('credit-note-form', null);
    await sleep(40);
    assert.match(w.document.getElementById('cn-br-ub').className, /ub-sel/);
    assert.ok(w.document.getElementById('cn-br-ub').closest('[data-erp-branch-hidden]'), 'the choice itself is hidden');
    // Document editor (ใบกำกับภาษี A4 page): starts at the head office, its branch choice is hidden.
    w.go('delivery-tax-doc', null);
    await sleep(40);
    const editor = w.document.getElementById('delivery-tax-app');
    assert.equal(editor.querySelector('.dtd-branch-option.active')?.dataset.branch, 'ubon');
    assert.ok(editor.querySelector('.dtd-branch-options').closest('[data-erp-branch-hidden]'));
    // Totals: dashboard KPI = both data ids (nothing filtered by the screen mode); AR = every live invoice.
    w.go('dashboard', null); w.renderDash();
    const year = Number(w.document.getElementById('dash-year').value);
    assert.equal(money(dashTotal(w)), money(w.testApp.branchStats('ubon', year, -1).st + w.testApp.branchStats('khonkaen', year, -1).st));
    const snap = w.ERPReceivables.snapshot('');
    assert.equal(money(snap.aging.totals.total), money(arOutstanding(w)));
    assert.deepEqual([...w.ERPReceivables.scopeBranches('')], ['ubon', 'khonkaen'], 'aging / council read both data ids');
    assert.equal(w.ERPReceivables.selectedBranch(), '', 'the dashboard scope is the whole company');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('branch#4 money rule: switching to one establishment is refused while branch 2 holds data, allowed after the demo reset', async () => {
  const h = await boot(); const { w } = h;
  try {
    assert.equal((await w.ERPDemoSeed.load()).status, 'loaded', h.messages.join('\n'));
    h.messages.length = 0;
    await chooseBranchCount(w, 1);
    assert.equal(w.localStorage.getItem(SETTING_KEY), null, 'nothing saved');
    const error = w.document.getElementById('cp-branch-count-error');
    assert.equal(error.hidden, false);
    assert.match(text(error), /^เปลี่ยนเป็น "สำนักงานใหญ่อย่างเดียว" ไม่ได้ — สาขาที่ 00001 ยังมีข้อมูล: ใบเสนอราคา 2 · ใบส่งสินค้า\/ใบกำกับภาษี 9 · ใบเสร็จรับเงิน 5 · ใบลดหนี้ 1 · ค่าใช้จ่าย 5 · ใบวางบิล 1 · รายการรับชำระ 1 · สินค้าที่มียอดตั้งต้นของสาขานี้ 6 · ระบบไม่ซ่อน/);
    assert.match(h.messages.join('\n'), /ไม่ได้ — สาขาที่ 00001 ยังมีข้อมูล/);
    assert.equal(w.ERPBranches.multi(), true);
    assert.deepEqual([...w.document.querySelectorAll('[data-erp-branch-hidden]')].filter(el => !el.closest('#company-profile-form')).map(el => el.id || el.className), [], 'screens unchanged (the form only previews the unsaved choice)');
    // Reset clears the sample data (and keeps the setting key rules) → now allowed.
    assert.equal((await w.ERPDemoSeed.reset({ confirm: () => true })).status, 'reset');
    await chooseBranchCount(w, 1);
    assert.equal(JSON.parse(w.localStorage.getItem(SETTING_KEY)).count, 1, h.messages.join('\n'));
    assert.equal(w.document.getElementById('cp-branch-count-error').hidden, true);
    assert.equal(w.ERPBranches.multi(), false);
    assert.ok(w.document.querySelector('#panel-dashboard .dash-tabs').hasAttribute('data-erp-branch-hidden'));
    // A later reset keeps the choice (a setting, not sample data).
    assert.equal((await w.ERPDemoSeed.reset({ confirm: () => true })).status, 'reset');
    assert.equal(JSON.parse(w.localStorage.getItem(SETTING_KEY)).count, 1);
    // Back to 2 branches is always allowed.
    await chooseBranchCount(w, 2);
    assert.equal(JSON.parse(w.localStorage.getItem(SETTING_KEY)).count, 2);
    assert.equal(w.document.querySelectorAll('[data-erp-branch-hidden]').length, 0);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('branch#5 single mode + imported branch-2 data: shown with a warning and counted in every total — never hidden', async () => {
  const h = await boot(store({ count: 1 })); const { w } = h;
  try {
    await sleep(80);
    assert.equal(w.ERPBranches.multi(), false);
    const invoice = { id: 7001, no: 'INV6909-77', branch: 'khonkaen', date: '2026-09-05', dueDate: '2026-10-05', customer: 'ลูกค้าสาขาเดิม', customerTaxId: '0105555555555', subtotal: 10000, total: 10700, vatAmt: 700, useVat: 1, vatMode: 'add', items: [{ product: 'งานสาขาเดิม', qty: 1, unit: 'งาน', priceUnit: 10000, saleTotal: 10000, total: 10000 }] };
    w.document.getElementById('import-mode').value = 'merge';
    await w.importJSON({ target: { files: [{ text: async () => JSON.stringify({ meta: { app: 'comform-esan', backupType: 'month' }, data: { 2026: { khonkaen: { 'กันยายน': { invoices: [invoice] } } } } }) }], value: 'x' } });
    await sleep(120);
    assert.ok(packKeys(w, 'khonkaen').length, h.messages.join('\n'));
    assert.equal(JSON.parse(w.localStorage.getItem(SETTING_KEY)).count, 1, 'the setting is not silently changed');
    assert.equal(w.ERPBranches.multi(), true, 'the screens show both branches again');
    const banner = w.document.getElementById('erp-branch-warning');
    assert.ok(banner && visible(banner));
    assert.match(text(banner), /ตั้งค่าไว้เป็น "สำนักงานใหญ่อย่างเดียว" แต่พบข้อมูลของ สาขาที่ 00001: ใบส่งสินค้า\/ใบกำกับภาษี 1 .*แสดง 2 สาขาและรวมยอดของทุกสาขา/);
    for (const id of ['dt-kk', 'il-br', 'i-br-kk']) assert.ok(visible(w.document.getElementById(id)), id);
    // Totals include it: dashboard, AR, invoice list.
    w.go('dashboard', null); w.renderDash();
    const year = 2026, kk = w.testApp.branchStats('khonkaen', year, -1).st;
    assert.equal(money(kk), money(10000));
    assert.equal(money(dashTotal(w)), money(w.testApp.branchStats('ubon', year, -1).st + kk));
    assert.equal(money(w.ERPReceivables.snapshot('').aging.totals.total), money(arOutstanding(w)));
    assert.ok(arOutstanding(w) >= 10700);
    w.go('invoice-list', null); w.document.getElementById('il-year').value = '2026'; w.renderIList();
    assert.match(text(w.document.getElementById('panel-invoice-list')), /INV6909-77/);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('branch#6 labels follow the company profile in both modes (menus, filters, tabs, list badges, scope labels)', async () => {
  {
    const h = await boot(store({ profile: PROFILE })); const { w } = h;
    try {
      await sleep(80);
      assert.deepEqual(['dt-all', 'dt-ub', 'dt-kk'].map(id => text(w.document.getElementById(id))), ['รวมทั้ง 2 สาขา', 'สำนักงานใหญ่', 'สาขาที่ 00003 · สาขาขอนแก่น']);
      assert.deepEqual([...w.document.getElementById('il-br').options].map(o => o.textContent), ['ทุกสาขา', 'สำนักงานใหญ่', 'สาขาที่ 00003 · สาขาขอนแก่น']);
      assert.deepEqual([...w.document.getElementById('po-branch').options].map(o => o.textContent), ['สำนักงานใหญ่', 'สาขาที่ 00003 · สาขาขอนแก่น']);
      assert.equal(text(w.document.getElementById('i-br-kk')), 'สาขาที่ 00003 · สาขาขอนแก่น');
      assert.equal(text(w.document.querySelector('#dash-combined .bc.kk .bname')), 'สาขาที่ 00003 · สาขาขอนแก่น');
      assert.equal(w.ERPReceivables.scopeLabel('khonkaen'), 'สาขาที่ 00003 · สาขาขอนแก่น');
      assert.equal((await w.ERPDemoSeed.load()).status, 'loaded', h.messages.join('\n'));
      w.go('quote-list', null); w.renderQLList();
      const badges = [...w.document.querySelectorAll('#panel-quote-list .badge.b-kk')].map(text);
      assert.ok(badges.length && badges.every(t => t === 'สาขาที่ 00003 · สาขาขอนแก่น'), badges.join('|'));
      // A label change applies at once (no reload).
      w.localStorage.setItem(PROFILE_KEY, JSON.stringify({ ...PROFILE, branches: { ...PROFILE.branches, khonkaen: { code: '00004', label: 'สาขามหาสารคาม', addressTh: '' } }, updatedAt: '2026-10-04T11:00:00.000Z' }));
      w.ERPCompanyProfile.refresh();
      await sleep(80);
      assert.equal(text(w.document.getElementById('dt-kk')), 'สาขาที่ 00004 · สาขามหาสารคาม');
      assert.deepEqual(h.errors, []);
    } finally { h.close(); }
  }
  {
    const h = await boot(store({ profile: PROFILE, count: 1 })); const { w } = h;
    try {
      await sleep(80);
      assert.equal(text(w.document.getElementById('i-br-ub')), 'สำนักงานใหญ่');
      assert.equal(w.ERPReceivables.scopeLabel(''), 'ทั้งบริษัท');
      assert.equal(w.ERPBranches.label('khonkaen'), 'สาขาที่ 00003 · สาขาขอนแก่น');
      w.go('saas-admin', null);
      assert.ok(settingsForm(w).querySelector('[data-cp-branch="khonkaen"]').hasAttribute('data-erp-branch-hidden'), 'the second branch card is not shown');
      assert.deepEqual([...w.document.querySelectorAll('#cp-preview [data-cp-preview-branch]')].map(el => el.dataset.cpPreviewBranch), ['ubon']);
      assert.deepEqual(h.errors, []);
    } finally { h.close(); }
  }
});

test('branch#7 backup round trip keeps the setting; an old backup leaves it alone', async () => {
  let exported;
  {
    const h = await boot(store({ count: 1 })); const { w } = h;
    try {
      const master = w.testApp.collectLocalMasterBackup();
      assert.equal(master.companyProfile.branchSetting.count, 1);
      assert.equal(master.companyProfile.profile, null);
      exported = JSON.parse(JSON.stringify(await w.ERPBackup.portable({ meta: { app: 'comform-esan', backupType: 'all' }, data: {}, masterData: master })));
      assert.equal((await w.ERPBackup.verifyPortable(exported)).verified, true);
      assert.ok('comform_company_branch_setting_v1' in w.ERPBackup.capture(), 'local auto-snapshots carry it');
      const tampered = JSON.parse(JSON.stringify(exported));
      tampered.masterData.companyProfile.branchSetting.count = 7;
      assert.throws(() => w.ERPBackup.validate(tampered), /ข้อมูลบริษัท\/โลโก้ใน Backup ไม่ถูกต้อง/);
    } finally { h.close(); }
  }
  {
    const h = await boot(); const { w } = h;
    try {
      w.testApp.restoreLocalMasterBackup({ contacts: [] }, { replace: true });
      assert.equal(w.localStorage.getItem(SETTING_KEY), null, 'an old backup leaves the setting alone');
      w.ERPBackup.validate(exported);
      w.testApp.restoreLocalMasterBackup(exported.masterData, { replace: true });
      await sleep(120);
      assert.equal(JSON.parse(w.localStorage.getItem(SETTING_KEY)).count, 1);
      assert.equal(w.ERPBranches.multi(), false);
      assert.ok(w.document.querySelector('#panel-dashboard .dash-tabs').hasAttribute('data-erp-branch-hidden'), 'the screens follow the restore');
      w.go('saas-admin', null);
      assert.equal(settingsForm(w).querySelector('input[name="cp-branch-count"]:checked').value, '1', 'the form follows the restore');
      assert.deepEqual(h.errors, []);
    } finally { h.close(); }
  }
});
