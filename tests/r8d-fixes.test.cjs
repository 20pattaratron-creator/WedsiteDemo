// Round 8 stage D, D3 — fixes from the stage C review, in the booted app (jsdom):
//  #1 expense delete refusals before the question (also in tests/payer-wht.test.cjs whtui#4 / whtui#5);
//  #2 every column of the official reports fits a ≥ 1,280 px screen (fixed layout, per-column shares that add up),
//     phones scroll inside the card (the browser screenshots are the visual proof: /tmp/claude-0/r8d-*.png);
//  #3 a cancelled invoice is ONE normal row: "ยกเลิก – <reason>" in the name column, 0.00, note "ยกเลิก";
//  #4 the untouched sample company profile shows an amber notice; only a TIN the user entered and got wrong is red.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { boot } = require('./dom-helper.cjs');

const ROOT = path.resolve(__dirname, '..');
const imp = file => import(pathToFileURL(path.join(ROOT, file)).href);
const TENANT = 'erp_tenant::customer-showcase-local::';
const PROFILE_KEY = `${TENANT}comform_company_profile_v1`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = el => String(el?.textContent || '').replace(/\s+/g, ' ').trim();
const said = h => [...h.messages, ...[...h.w.document.querySelectorAll('.app-toast-msg')].map(el => el.textContent)].join('\n');
const PROFILE = {
  schemaVersion: 1, nameTh: 'บริษัท สยามตัวอย่าง จำกัด', nameEn: '', taxId: '0105568123453', addressTh: '99/9 ถนนพระราม 9 กรุงเทพมหานคร 10310', phone: '02-123-4567', email: '', website: '',
  branches: { ubon: { code: '00000', label: '', addressTh: '' }, khonkaen: { code: '00001', label: 'สาขาขอนแก่น', addressTh: '' } }, updatedAt: '2026-10-03T10:00:00.000Z'
};
const root = w => w.document.getElementById('tax-reports-root');
function change(w, id, value) {
  const el = w.document.getElementById(id);
  el.value = value;
  el.dispatchEvent(new w.Event('change', { bubbles: true }));
}
async function openSales(w, tab = 'sales') {
  w.go('tax-reports', null);
  await sleep(30);
  root(w).querySelector(`[data-tax-tab="${tab}"]`).click();
  for (const [id, value] of [['tax-rpt-month', '9'], ['tax-rpt-year', '2026'], ['tax-rpt-branch', 'ubon']]) change(w, id, value);
}

test('d3#2 column fit: at ≥ 1,240 px the report tables use a fixed layout with per-column shares that add up to 100 %; every cell carries its column class', async () => {
  const css = fs.readFileSync(path.join(ROOT, 'erp-tax-reports.css'), 'utf8');
  const block = /@media\(min-width:1240px\)\{([\s\S]*?)\n\}/.exec(css)?.[1] || '';
  assert.match(block, /\.tax-rpt-scroll \.tax-rpt-table\{min-width:0;table-layout:fixed\}/);
  const share = {};
  for (const [, keys, width] of block.matchAll(/((?:\.tax-rpt-scroll \.tax-rpt-table \.col-[a-zA-Z]+,?)+)\{width:([\d.]+)%/g)) for (const [, key] of keys.matchAll(/\.col-([a-zA-Z]+)/g)) share[key] = Number(width);
  const tax = await imp('erp-tax-reports-core.js');
  const wht = await imp('erp-payer-wht-core.js');
  const sum = keys => Math.round(keys.reduce((s, key) => { assert.ok(share[key] > 0, `width of col-${key}`); return s + share[key]; }, 0) * 10) / 10;
  const salesKeys = tax.taxReportTable({ rows: [], totals: {} }, 'sales').columns.map(c => c.key);
  const purchaseKeys = tax.taxReportTable({ rows: [], totals: {} }, 'purchase').columns.map(c => c.key);
  assert.equal(sum(salesKeys), 100, 'รายงานภาษีขาย');
  assert.ok(sum(purchaseKeys) <= 100, 'รายงานภาษีซื้อ');
  assert.ok(sum(wht.PND53_COLUMNS.map(c => c.key)) <= 100, 'ภ.ง.ด.53');
  assert.ok(sum(wht.PND3_COLUMNS.map(c => c.key)) <= 100, 'ภ.ง.ด.3');
  // Narrow screens keep the scroll inside the card (the wrapper scrolls, not the page).
  assert.match(css, /\.tax-rpt-scroll\{[^}]*overflow-x:auto/);
});

test('d3#3 + d3#4 cancelled invoice = one normal-height row with the reason in the name column; sample profile → amber notice, invalid user TIN → red, valid → none', async () => {
  const h = await boot();
  const { w } = h;
  try {
    assert.equal((await w.ERPDemoSeed.load({ today: '2026-10-04', confirm: () => true })).status, 'loaded', said(h));
    await openSales(w);
    const row = [...root(w).querySelectorAll('.tax-rpt-table tbody tr')].find(tr => text(tr.querySelector('.col-no')) === 'INV690909');
    assert.ok(row);
    const reason = 'ยกเลิก – ออกผิด: ชื่อ/ที่อยู่/เลขผู้เสียภาษี/สาขาของผู้ซื้อ หรือรายการ/ยอดเงินไม่ถูกต้อง — ระบุสถานประกอบการของผู้ซื้อผิด ออกฉบับใหม่แทน';
    assert.equal(text(row.querySelector('.col-party')), reason);
    assert.equal(row.className, 'tax-row-cancelled');
    assert.equal(row.querySelector('.col-party .tax-clamp').getAttribute('title'), reason, 'the whole reason in the tooltip');
    const css = fs.readFileSync(path.join(ROOT, 'erp-tax-reports.css'), 'utf8');
    assert.match(css, /\.tax-row-cancelled \.tax-clamp\{display:-webkit-box;-webkit-line-clamp:2/, 'at most two lines (a normal row)');
    assert.deepEqual([text(row.querySelector('.col-taxId')), text(row.querySelector('.col-headOffice')), text(row.querySelector('.col-branchNo')), text(row.querySelector('.col-value')), text(row.querySelector('.col-vat')), text(row.querySelector('.col-note'))], ['', '', '', '0.00', '0.00', 'ยกเลิก']);
    assert.equal(row.querySelectorAll('br, small, .tax-cell-sub').length, 0, 'no extra line in the row');
    // #4: the untouched sample profile (TIN 0000000000000) → amber note, not the red alert.
    let note = root(w).querySelector('.tax-form-head').parentElement.querySelector('.tax-form-note-sample, .tax-form-note-warn');
    assert.ok(note && note.classList.contains('tax-form-note-sample') && note.getAttribute('role') === 'note', note?.outerHTML);
    assert.match(text(note), /ค่าตัวอย่าง \(0000000000000\) ของข้อมูลบริษัทสาธิต/);
    const tax = await imp('erp-tax-reports-core.js');
    assert.deepEqual([tax.companyTaxIdNotice('0000000000000', false), tax.companyTaxIdNotice('0000000000000', true), tax.companyTaxIdNotice('', true), tax.companyTaxIdNotice('0105568123454', true), tax.companyTaxIdNotice('0105568123454', false), tax.companyTaxIdNotice('12345', true), tax.companyTaxIdNotice('0105568123453', true), tax.companyTaxIdNotice('0105568123453', false)], ['sample', 'sample', 'sample', 'invalid', 'invalid', 'invalid', '', '']);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
  // A saved profile that kept the sample number → still amber; a correct number → no notice. (A wrong check digit is
  // refused by ตั้งค่าบริษัท, so the red case is proven with the core above and on the 50 ทวิ in payer-wht.test.cjs.)
  for (const [taxId, expected] of [['0000000000000', 'sample'], ['0105568123453', '']]) {
    const s = await boot({ beforeScripts: win => win.localStorage.setItem(PROFILE_KEY, JSON.stringify({ ...PROFILE, taxId })) });
    try {
      assert.equal((await s.w.ERPDemoSeed.load({ today: '2026-10-04', confirm: () => true })).status, 'loaded', said(s));
      await openSales(s.w);
      assert.equal(root(s.w).querySelector('.tax-form-note-warn'), null, `${taxId}: never red`);
      assert.equal(!!root(s.w).querySelector('.tax-form-note-sample'), expected === 'sample', taxId);
      if (expected === 'sample') assert.match(text(root(s.w).querySelector('.tax-form-head')), /บริษัท สยามตัวอย่าง จำกัด/, 'the saved profile is used');
    } finally { s.close(); }
  }
});
