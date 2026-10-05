// ADR-023 (round 8, stage C) in the booted app (jsdom): the รายงานภาษี page in โหมดง่าย (sales / purchase / ภาษีซื้อต้องห้าม /
// ภ.พ.30 for the sample data's September 2569), establishment + month switch, print HTML (official headers, page
// numbers, hostile values escaped), Excel with the vendored SheetJS (no network) and CSV, an expense with a tax invoice
// entered through the form (duplicate / 6-month window / closed claim month refused), the Supplier Master
// establishment, the invoice VAT category, ภ.พ.30 filing (snapshot, amendment, carry-forward, period lock), backup
// round trip, demo reset and one-branch mode. Pure rules: tests/tax-reports-core.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot } = require('./dom-helper.cjs');

const ROOT = path.resolve(__dirname, '..');
const TENANT = 'erp_tenant::customer-showcase-local::';
const RETURNS_KEY = `${TENANT}comform_vat_returns_v1`;
const SETTING_KEY = `${TENANT}comform_company_branch_setting_v1`;
const PROFILE_KEY = `${TENANT}comform_company_profile_v1`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = el => String(el?.textContent || '').replace(/\s+/g, ' ').trim();
// Messages of the modules (window.notify, replaced by the harness) and app.js toasts (its own notify).
const said = h => [...h.messages, ...[...h.w.document.querySelectorAll('.app-toast-msg')].map(el => el.textContent)].join('\n');
const clearSaid = h => { h.messages.length = 0; h.w.document.querySelectorAll('.app-toast').forEach(el => el.remove()); };
const plainOf = value => JSON.parse(JSON.stringify(value));
async function waitFor(check, tries = 120) { for (let i = 0; i < tries && !check(); i++) await sleep(25); return check(); }
const PROFILE = {
  schemaVersion: 1, nameTh: 'บริษัท สยามตัวอย่าง จำกัด', nameEn: '', taxId: '0105568123453', addressTh: '99/9 ถนนพระราม 9 กรุงเทพมหานคร 10310', phone: '02-123-4567', email: '', website: '',
  branches: { ubon: { code: '00000', label: '', addressTh: '' }, khonkaen: { code: '00001', label: 'สาขาขอนแก่น', addressTh: '' } }, updatedAt: '2026-10-03T10:00:00.000Z'
};

async function bootWithSample(options = {}) {
  const h = await boot(options);
  const result = await h.w.ERPDemoSeed.load({ today: '2026-10-04', confirm: () => true });
  assert.equal(result.status, 'loaded', said(h));
  return h;
}
const root = w => w.document.getElementById('tax-reports-root');
function change(w, id, value) {
  const el = w.document.getElementById(id);
  assert.ok(el, `missing #${id}`);
  el.value = value;
  el.dispatchEvent(new w.Event('change', { bubbles: true }));
}
async function openReport(w, { tab = 'sales', branch = 'ubon', month = '9', year = '2026' } = {}) {
  w.go('tax-reports', null);
  await sleep(30);
  root(w).querySelector(`[data-tax-tab="${tab}"]`).click();
  change(w, 'tax-rpt-month', month);
  change(w, 'tax-rpt-year', year);
  if (branch) change(w, 'tax-rpt-branch', branch);
  return w.ERPTaxReports.view();
}
const lineText = (w, line) => text(root(w).querySelector(`[data-pp30-line="${line}"]`));
function capturePrint(w) {
  const written = [];
  w.open = () => ({ document: { write: html => written.push(html), close() {} }, set opener(v) {} });
  return written;
}
const packKey = (branch, y, m) => `${TENANT}biz2_${branch}_${y}_${String(m).padStart(2, '0')}`;
function editPack(w, branch, y, m, edit) {
  const key = packKey(branch, y, m);
  const pack = JSON.parse(w.localStorage.getItem(key) || '{}');
  edit(pack);
  w.localStorage.setItem(key, JSON.stringify(pack));
  w.ERPIntegrity.changed?.();
}

test('taxui#1 โหมดง่าย: the menu entry, four tabs and the sample data\'s September 2569 (HQ, branch, combined) with the form header', async () => {
  const h = await bootWithSample(); const { w } = h;
  try {
    const entryOf = () => [...w.document.querySelectorAll('.sidebar .nav-item')].find(item => (item.getAttribute('onclick') || '').includes("go('tax-reports'"));
    assert.ok(await waitFor(() => entryOf()?.closest('.nav-group')), 'grouped sidebar arranged');
    const entry = entryOf();
    assert.ok(entry && !entry.hidden, 'visible in โหมดง่าย');
    assert.equal(entry.closest('.nav-group')?.dataset.navSection, 'data', 'reports group (ADR-015)');
    assert.equal(text(entry), 'รายงานภาษี');
    w.go('tax-reports', entry); // jsdom does not run the inline onclick
    await sleep(30);
    assert.ok(w.document.getElementById('panel-tax-reports').classList.contains('active'));
    assert.deepEqual([...root(w).querySelectorAll('[data-tax-tab]')].map(text), ['รายงานภาษีขาย', 'รายงานภาษีซื้อ', 'ภาษีซื้อต้องห้าม', 'ภ.พ.30']);
    // Sales, head office.
    await openReport(w, { tab: 'sales', branch: 'ubon' });
    const head = text(root(w).querySelector('.tax-form-head'));
    assert.match(head, /รายงานภาษีขาย/);
    assert.match(head, /เดือนภาษี กันยายน ปี 2569/);
    assert.match(head, /ชื่อผู้ประกอบการ\s*บริษัทตัวอย่างสำหรับทดลองระบบ จำกัด/);
    assert.match(head, /ชื่อสถานประกอบการ\s*บริษัทตัวอย่างสำหรับทดลองระบบ จำกัด \(สำนักงานใหญ่\)/);
    assert.match(head, /☑ สำนักงานใหญ่\s*☐ สาขาที่ \.\.\.\.\./, 'AC1.6 head office ticked');
    assert.match(head, /ค่าตัวอย่าง \(0000000000000\)/, 'placeholder seller TIN warned');
    const foot = [...root(w).querySelectorAll('.tax-rpt-table tfoot td')].map(text);
    assert.deepEqual(foot.slice(7, 10), ['74,070.00', '5,184.90', '79,254.90']);
    assert.equal(root(w).querySelectorAll('.tax-rpt-table tbody tr').length, 7);
    assert.match(text(root(w)), /ยอดขายที่ได้รับยกเว้น VAT.*INV690903/, 'exempt U8 listed, not in the report');
    // Branch switch (AC1.6): สาขาที่ 00001.
    change(w, 'tax-rpt-branch', 'khonkaen');
    assert.match(text(root(w).querySelector('.tax-form-head')), /☐ สำนักงานใหญ่\s*☑ สาขาที่ 00001/);
    assert.deepEqual([...root(w).querySelectorAll('.tax-rpt-table tfoot td')].map(text).slice(7, 9), ['66,080.00', '4,625.60']);
    // Combined view (data, not a filing) and month switch.
    change(w, 'tax-rpt-branch', 'combined');
    assert.match(text(root(w)), /มุมมองรวมทุกสถานประกอบการเป็นข้อมูลประกอบ/);
    assert.equal(w.ERPTaxReports.view().sales.totals.vat, 9810.5);
    change(w, 'tax-rpt-month', '10');
    assert.equal(w.ERPTaxReports.view().period, '2026-10');
    // Purchase / ภาษีซื้อต้องห้าม / ภ.พ.30 of the head office in September.
    await openReport(w, { tab: 'purchase', branch: 'ubon' });
    assert.deepEqual([...root(w).querySelectorAll('.tax-rpt-table tfoot td')].map(text).slice(7, 9), ['34,214.95', '2,395.05']);
    assert.match(text(root(w)), /ข้อมูล VAT ไม่ครบ — ไม่อยู่ในรายงานภาษีซื้อ.*บจก\. โฆษณาออนไลน์ตัวอย่าง/, 'AC2.6 legacy expense listed');
    assert.match(text(root(w)), /ใช้สิทธิ์เดือน 10\/2569/, 'the claim moved to October');
    await openReport(w, { tab: 'forbidden', branch: 'ubon' });
    assert.deepEqual([...root(w).querySelectorAll('.tax-rpt-table tbody tr')].map(tr => text(tr.cells[2])), ['AB-1188', 'WP-091677']);
    await openReport(w, { tab: 'pp30', branch: 'ubon' });
    assert.deepEqual([1, 3, 4, 5, 6, 7, 8, 11, 12].map(line => lineText(w, line)), ['77,570.00', '3,500.00', '74,070.00', '5,184.90', '34,214.95', '2,395.05', '2,789.85', '2,789.85', '0.00']);
    assert.match(text(root(w)), /ไม่คำนวณในเดโม/);
    assert.match(text(root(w)), /ยื่นแบบกระดาษ ภายใน 15\/10\/2569/);
    assert.match(text(root(w)), /ยื่นทางอินเทอร์เน็ต ภายใน 23\/10\/2569/);
    assert.match(text(root(w)), /เดโมนี้ไม่ได้ยื่นแบบหรือส่งข้อมูลไปกรมสรรพากร/);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('taxui#2 print: A4 landscape report with the official headers and page numbers, ภ.พ.30 worksheet; hostile values escaped', async () => {
  const h = await bootWithSample(); const { w } = h;
  try {
    const hostile = '<img src=x onerror="alert(1)">"&\'';
    editPack(w, 'ubon', 2026, 9, pack => {
      for (let i = 0; i < 16; i += 1) pack.invoices.push({ id: 1700000000000 + i, no: `INV6909${80 + i}`, date: '2026-09-15', branch: 'ubon', taxInvoiceForm: 'full', customer: i === 0 ? hostile : `ลูกค้า ${i}`, customerTaxId: i === 0 ? '<b>tin</b>' : '0105558004044', customerBranchCode: '00000', subtotal: 100, vatAmt: 7, total: 107, useVat: 1, vatMode: 'add', vatCategory: 'standard', items: [{ product: 'x', qty: 1 }], createdAt: '2026-09-15T03:00:00.000Z' });
    });
    const written = capturePrint(w);
    await openReport(w, { tab: 'sales', branch: 'ubon' });
    assert.equal(root(w).querySelectorAll('img[src="x"]').length, 0, 'screen: no markup from data');
    root(w).querySelector('[data-tax-action="print"]').click();
    assert.equal(written.length, 1);
    const html = written[0];
    assert.match(html, /@page\{size:A4 landscape/);
    for (const label of ['รายงานภาษีขาย', 'เดือนภาษี กันยายน ปี 2569', 'ชื่อผู้ประกอบการ', 'เลขประจำตัวผู้เสียภาษีอากร', 'ชื่อสถานประกอบการ', '☑ สำนักงานใหญ่', 'ลำดับที่', 'วัน เดือน ปี', 'เล่มที่/เลขที่', 'ชื่อผู้ซื้อสินค้า/ผู้รับบริการ', 'เลขประจำตัวผู้เสียภาษีอากรของผู้ซื้อสินค้า/ผู้รับบริการ', 'มูลค่าสินค้าหรือบริการ', 'จำนวนเงินภาษีมูลค่าเพิ่ม', 'หมายเหตุ']) assert.ok(html.includes(label), label);
    assert.ok(html.includes('แผ่นที่ 1 ในจำนวน 2 แผ่น') && html.includes('แผ่นที่ 2 ในจำนวน 2 แผ่น'), '23 rows → 2 sheets of 18');
    assert.equal((html.match(/<tfoot>/g) || []).length, 1, 'totals on the last sheet only');
    assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&quot;&amp;&#39;'), 'customer escaped');
    assert.ok(!html.includes('<img src=x') && !html.includes('<b>tin</b>'), 'no raw markup from data');
    assert.ok(html.includes('75,670.00') && html.includes('5,296.90'), 'footer: 74,070.00 + 16 × 100.00 / 5,184.90 + 16 × 7.00');
    // ภ.พ.30 worksheet (portrait, labels of the form, says it is not the official form).
    root(w).querySelector('[data-tax-tab="pp30"]').click();
    root(w).querySelector('[data-tax-action="print"]').click();
    const pp30 = written[1];
    assert.match(pp30, /@page\{size:A4 portrait/);
    for (const label of ['ยอดขายในเดือนนี้', 'ลบ ยอดขายที่เสียภาษีในอัตราร้อยละ 0 (ถ้ามี)', 'ภาษีขายเดือนนี้', 'ภาษีซื้อเดือนนี้ (ตามหลักฐานใบกำกับภาษีของยอดซื้อตาม 6.)', 'ภาษีที่ชำระเกินยกมา', 'ไม่ใช่แบบฟอร์มทางการ', '☑ ยื่นปกติ', '☑ แยกยื่นเป็นรายสถานประกอบการ', 'ไม่คำนวณในเดโม', 'ยื่นแบบกระดาษ ภายใน 15/10/2569']) assert.ok(pp30.includes(label), label);
    // The worksheet's lines 5 / 7 are the report footers.
    const view = w.ERPTaxReports.view();
    assert.deepEqual([view.pp30.lines[5], view.pp30.lines[7]], [view.sales.totals.vat, view.purchases.totals.vat]);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('taxui#3 Excel (vendored SheetJS, no network) and CSV keep the official column order; sheet names are valid', async () => {
  const h = await bootWithSample(); const { w } = h;
  try {
    w.fetch = () => { throw new Error('network blocked'); };
    await openReport(w, { tab: 'sales', branch: 'khonkaen' });
    const appended = [];
    const original = w.document.head.appendChild.bind(w.document.head);
    w.document.head.appendChild = node => { if (node.tagName === 'SCRIPT') appended.push(node); return original(node); };
    root(w).querySelector('[data-tax-action="excel"]').click();
    assert.equal(appended.length, 1, 'the lazy loader of app.js is reused');
    assert.equal(appended[0].getAttribute('src'), './vendor/xlsx-0.18.5.full.min.js');
    w.eval(fs.readFileSync(path.join(ROOT, 'vendor/xlsx-0.18.5.full.min.js'), 'utf8'));
    const books = [];
    w.XLSX.writeFile = (wb, file) => books.push({ wb, file });
    appended[0].onload();
    assert.equal(books.length, 1, said(h));
    const { wb, file } = books[0];
    assert.equal(file, 'VAT-sales-report_00001_2569-09.xlsx');
    assert.deepEqual(plainOf(wb.SheetNames), ['ภาษีขาย 09-2569']);
    // A round trip through the real file format.
    const back = w.XLSX.read(w.XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array' });
    const rows = plainOf(w.XLSX.utils.sheet_to_json(back.Sheets[back.SheetNames[0]], { header: 1, defval: '' }));
    assert.deepEqual(rows[0].slice(0, 1), ['รายงานภาษีขาย']);
    assert.match(rows[4].join(' '), /☐ สำนักงานใหญ่ {2}☑ สาขาที่ 00001/);
    assert.deepEqual(rows[6], ['ลำดับที่', 'ใบกำกับภาษี', '', 'ชื่อผู้ซื้อสินค้า/ผู้รับบริการ', 'เลขประจำตัวผู้เสียภาษีอากรของผู้ซื้อสินค้า/ผู้รับบริการ', 'สถานประกอบการ', '', 'มูลค่าสินค้าหรือบริการ', 'จำนวนเงินภาษีมูลค่าเพิ่ม', 'รวม', 'หมายเหตุ']);
    assert.deepEqual(rows[7], ['', 'วัน เดือน ปี', 'เล่มที่/เลขที่', '', '', 'สำนักงานใหญ่', 'สาขาที่', '', '', '', '']);
    const total = rows.at(-1);
    assert.deepEqual([total[0], total[7], total[8]], ['รวม', 66080, 4625.6], 'numbers stay numbers');
    assert.ok(rows.some(row => row[2] === 'INV690902' && row[6] === '00003'), 'buyer branch 00003 in its column');
    // PP30 workbook (second export: SheetJS already loaded).
    root(w).querySelector('[data-tax-tab="pp30"]').click();
    root(w).querySelector('[data-tax-action="excel"]').click();
    assert.equal(books[1].file, 'PP30_00001_2569-09.xlsx');
    assert.ok(books[1].wb.SheetNames.every(name => !/[/\\?*[\]:]/.test(name) && name.length <= 31));
    // CSV of the purchase report (BOM, the §2b header).
    root(w).querySelector('[data-tax-tab="purchase"]').click();
    let blob = null;
    w.URL.createObjectURL = value => { blob = value; return 'blob:x'; };
    w.URL.revokeObjectURL = () => {};
    const downloads = [];
    w.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); }; // jsdom cannot navigate
    root(w).querySelector('[data-tax-action="csv"]').click();
    const bytes = new Uint8Array(await new Promise(resolve => { const reader = new w.FileReader(); reader.onload = () => resolve(reader.result); reader.readAsArrayBuffer(blob); }));
    const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    assert.ok(csv.startsWith('﻿ลำดับที่,ใบกำกับภาษี - วัน เดือน ปี,ใบกำกับภาษี - เล่มที่/เลขที่,ชื่อผู้ขายสินค้า/ผู้ให้บริการ,'), csv.slice(0, 120));
    assert.deepEqual(downloads, ['VAT-purchase-report_00001_2569-09.csv']);
    assert.match(csv, /KP-6803,บจก\. ขอนแก่นพร็อพเพอร์ตี้,0405557002029,✓,,8411\.21,588\.79/);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('taxui#4 expense with a full tax invoice through the form → in รายงานภาษีซื้อ; duplicate, 6-month window and closed claim month refused', async () => {
  const h = await bootWithSample(); const { w } = h;
  const d = w.document;
  const fill = async (fields, choose = {}) => {
    w.go('expense-form', null); w.resetF('expense'); w.selBr('e', 'ubon');
    for (const [id, value] of Object.entries(fields)) change(w, id, value);
    if (choose.supplier) { const select = d.getElementById('e-tax-supplier'); select.dispatchEvent(new w.Event('focusin', { bubbles: true })); change(w, 'e-tax-supplier', [...select.options].find(o => o.textContent.includes(choose.supplier)).value); }
    for (const [id, value] of Object.entries(choose.after || {})) change(w, id, value);
    await w.LocalDemoHealth?.whenIdle?.('saveExpense'); // the double-click guard (local-demo-health.js)
    clearSaid(h);
    await w.saveExpense();
    await sleep(20);
    return said(h);
  };
  try {
    w.go('expense-form', null); w.resetF('expense');
    assert.equal(d.getElementById('e-tax-section').hidden, true, 'a simple receipt keeps the simple form');
    change(w, 'e-doc-type', 'tax_invoice');
    assert.equal(d.getElementById('e-tax-section').hidden, false);
    assert.equal(d.getElementById('e-tax-status').value, 'received', 'a tax invoice being entered is in hand');
    change(w, 'e-tax-status', 'requested');
    assert.deepEqual([d.getElementById('e-tax-grid').hidden, d.getElementById('e-tax-not-received').hidden], [true, false], 'not received yet → no tax fields, a note');
    assert.deepEqual(plainOf(w.ERPTaxForms.expenseDraft()), {});
    change(w, 'e-tax-status', 'received');
    assert.equal(d.getElementById('e-tax-grid').hidden, false);
    assert.ok(d.getElementById('e-tax-supplier').options.length >= 9, 'Supplier Master rows offered');
    // A tax invoice from the sample supplier: 2,140 incl. VAT, received 21 Sept.
    const base = { 'e-date': '2026-09-21', 'e-cat': 'ค่าอุปกรณ์สำนักงาน', 'e-desc': 'เก้าอี้สำนักงาน', 'e-amount': '2140', 'e-doc-type': 'tax_invoice', 'e-tax-status': 'received', 'e-doc-no': 'OP-UI-001' };
    let message = await fill(base, { supplier: 'ออฟฟิศพลัส' });
    assert.match(message, /บันทึกค่าใช้จ่ายเรียบร้อย/);
    const saved = w.ERPIntegrity.business().expenses.find(e => e.docNo === 'OP-UI-001');
    assert.deepEqual([saved.amount, saved.subtotal, saved.vatAmt, saved.vendor, saved.vendorTaxId, saved.vendorBranchCode, saved.claimPeriod, saved.taxInvoiceDate, saved.taxInvoiceReceivedDate, saved.inputVatClaimable], [2140, 2000, 140, 'บจก. ออฟฟิศพลัส เซ็นเตอร์', '0345562005058', '00002', '2026-09', '2026-09-21', '2026-09-21', true]);
    await openReport(w, { tab: 'purchase', branch: 'ubon' });
    const row = [...root(w).querySelectorAll('.tax-rpt-table tbody tr')].find(tr => text(tr.cells[2]) === 'OP-UI-001');
    assert.deepEqual([text(row.cells[3]), text(row.cells[4]), text(row.cells[5]), text(row.cells[6]), text(row.cells[7]), text(row.cells[8])], ['บจก. ออฟฟิศพลัส เซ็นเตอร์', '0345562005058', '', '00002', '2,000.00', '140.00']);
    assert.equal(w.ERPTaxReports.view().purchases.totals.vat, 2535.05, '2,395.05 + 140.00');
    // The expense list shows the claim month; a legacy one shows "ข้อมูล VAT ไม่ครบ".
    w.go('expense-list', null);
    d.getElementById('el-month').value = ''; d.getElementById('el-year').value = '2026'; w.renderEList();
    assert.match(text(d.getElementById('etbl')), /ภาษีซื้อ 09\/2569/);
    assert.match(text(d.getElementById('etbl')), /ข้อมูล VAT ไม่ครบ/);
    // AC2.4: the same seller TIN + tax-invoice number again (another expense date) → refused.
    const before = w.ERPIntegrity.business().expenses.length;
    message = await fill({ ...base, 'e-date': '2026-10-02' }, { supplier: 'ออฟฟิศพลัส' });
    assert.match(message, /ใบกำกับภาษีเลขที่ OP-UI-001 ของผู้ขายเลขประจำตัว 0345562005058 ถูกบันทึกแล้ว/);
    assert.equal(w.ERPIntegrity.business().expenses.length, before);
    // AC2.3: claimed more than 6 months after the invoice month.
    message = await fill({ ...base, 'e-doc-no': 'OP-UI-OLD', 'e-tax-invoice-date': '2026-02-10', 'e-tax-received-date': '2026-02-12' }, { supplier: 'ออฟฟิศพลัส', after: { 'e-tax-claim-period': '2026-09' } });
    assert.match(message, /เกินกำหนดใช้สิทธิ 6 เดือน/);
    // A closed claim month (period lock, purchases) refuses the claim even when the expense date is open.
    w.ERPGovernance.lockPeriod({ branch: 'ubon', scope: 'purchase', throughDate: '2026-09-30', reason: 'ยื่น ภ.พ.30 แล้ว' });
    message = await fill({ ...base, 'e-date': '2026-10-02', 'e-doc-no': 'OP-UI-002', 'e-tax-invoice-date': '2026-09-28', 'e-tax-received-date': '2026-09-29' }, { supplier: 'ออฟฟิศพลัส', after: { 'e-tax-claim-period': '2026-09' } });
    assert.match(message, /ถูกปิดถึง 2026-09-30/);
    message = await fill({ ...base, 'e-date': '2026-10-02', 'e-doc-no': 'OP-UI-002', 'e-tax-invoice-date': '2026-09-28', 'e-tax-received-date': '2026-09-29' }, { supplier: 'ออฟฟิศพลัส', after: { 'e-tax-claim-period': '2026-10' } });
    assert.match(message, /บันทึกค่าใช้จ่ายเรียบร้อย/, 'moved to the open month → saved');
    // ภาษีซื้อต้องห้าม through the form: untick the claim → a reason is required.
    w.go('expense-form', null); w.resetF('expense'); w.selBr('e', 'ubon');
    for (const [id, value] of Object.entries({ ...base, 'e-date': '2026-10-03', 'e-doc-no': 'FUEL-2', 'e-amount': '1070' })) change(w, id, value);
    d.getElementById('e-tax-claimable').checked = false; d.getElementById('e-tax-claimable').dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.equal(d.getElementById('e-tax-reason-field').hidden, false);
    change(w, 'e-tax-vendor-tax-id', '0345559006065');
    change(w, 'e-vendor', 'หจก. วารินปิโตรเลียม');
    await w.LocalDemoHealth?.whenIdle?.('saveExpense'); clearSaid(h); await w.saveExpense(); await sleep(20);
    assert.match(said(h), /เหตุผลที่ไม่ขอใช้สิทธิ์/);
    change(w, 'e-tax-reason', 'passenger_car');
    await w.LocalDemoHealth?.whenIdle?.('saveExpense'); clearSaid(h); await w.saveExpense(); await sleep(20);
    assert.match(said(h), /ภาษีซื้อต้องห้าม/);
    const fuel = w.ERPIntegrity.business().expenses.find(e => e.docNo === 'FUEL-2');
    assert.deepEqual([fuel.inputVatClaimable, fuel.nonClaimableReason, fuel.vatAmt, fuel.amount], [false, 'passenger_car', 70, 1070]);
    // A tax invoice not received yet is saved as before ADR-023 (no tax fields) and marked "ข้อมูล VAT ไม่ครบ".
    message = await fill({ 'e-date': '2026-10-03', 'e-cat': 'ค่าการตลาด', 'e-desc': 'โฆษณารอใบกำกับ', 'e-amount': '5000', 'e-doc-type': 'tax_invoice', 'e-tax-status': 'requested' });
    const waiting = w.ERPIntegrity.business().expenses.find(e => e.desc === 'โฆษณารอใบกำกับ');
    assert.ok(waiting, message);
    assert.equal('vatMode' in waiting, false);
    assert.match(w.ERPTaxForms.expenseBadgeHtml(waiting), /ข้อมูล VAT ไม่ครบ/);
    // A receipt without a tax invoice stores no tax fields at all.
    message = await fill({ 'e-date': '2026-10-03', 'e-cat': 'อื่น ๆ', 'e-desc': 'ค่าจอดรถ', 'e-amount': '40', 'e-doc-type': 'receipt', 'e-tax-status': 'not_required' });
    const parking = w.ERPIntegrity.business().expenses.find(e => e.desc === 'ค่าจอดรถ');
    assert.equal('vatMode' in parking, false, message);
    assert.ok(h.errors.every(line => /^\[ERP\] ค่าใช้จ่าย action failed/.test(line)), h.errors.join('\n')); // the refused saves above
  } finally { h.close(); }
});

test('taxui#5 ภ.พ.30 filing: snapshot (append-only), amendment ครั้งที่ 1, carry-forward into the next month, period lock offered', async () => {
  const h = await bootWithSample(); const { w } = h;
  try {
    // August 2569 at the head office gets a large claimed purchase → overpaid (line 9 / 12).
    editPack(w, 'ubon', 2026, 8, pack => {
      pack.expenses.push({ id: 1700000001000, date: '2026-08-20', branch: 'ubon', cat: 'ค่าซื้อสินค้า/วัสดุของบริษัท', vendor: 'บจก. ไอทีซัพพลาย อีสาน', desc: 'เครื่องแม่ข่าย', amount: 107000, by: '', docType: 'tax_invoice', taxStatus: 'received', docNo: 'ITS-6908-0900', purpose: 'company', note: '', attachments: [],
        vendorId: 'demo-seed-s04', vendorTaxId: '0105558004044', vendorBranchCode: '00000', vendorAddress: '', vatMode: 'extract', subtotal: 100000, vatAmt: 7000, taxInvoiceNo: 'ITS-6908-0900', taxInvoiceDate: '2026-08-20', taxInvoiceReceivedDate: '2026-08-20', claimPeriod: '2026-08', inputVatClaimable: true, nonClaimableReason: '', vatCategory: 'standard', createdAt: '2026-08-20T03:00:00.000Z' });
    });
    await openReport(w, { tab: 'pp30', branch: 'ubon', month: '8' });
    const aug = w.ERPTaxReports.view().pp30.lines;
    assert.ok(aug[9] > 0 && aug[12] === aug[9], JSON.stringify(aug));
    const asked = [];
    w.confirm = message => { asked.push(message); return !/ปิดงวด/.test(message); };
    // Line 12 > 0 needs the refund / carry choice first.
    clearSaid(h);
    root(w).querySelector('[data-tax-action="file"]').click(); await sleep(30);
    assert.match(said(h), /ขอนำไปชำระในเดือนถัดไป/);
    assert.equal(w.localStorage.getItem(RETURNS_KEY), null, 'nothing stored');
    const carry = root(w).querySelector('input[name="tax-pp30-overpaid"][value="carry"]');
    carry.checked = true; carry.dispatchEvent(new w.Event('change', { bubbles: true }));
    change(w, 'tax-pp30-channel', 'efiling');
    root(w).querySelector('[data-tax-action="file"]').click(); await sleep(60);
    const store = JSON.parse(w.localStorage.getItem(RETURNS_KEY));
    assert.equal(store.returns.length, 1, said(h));
    const first = store.returns[0];
    assert.deepEqual([first.branchKey, first.period, first.amendment, first.filingMode, first.channel, first.overpaidAction, first.dueDate, first.lines[12]], ['ubon', '2026-08', 0, 'separate', 'efiling', 'carry', '2026-09-23', aug[12]]);
    assert.match(asked[0], /ยื่นปกติ ภ.พ.30 เดือน สิงหาคม 2569/);
    assert.match(asked[1], /ปิดงวดภาษีเดือน 08\/2569/, 'lock offered (declined here)');
    assert.match(text(root(w)), /ยื่นปกติ · บันทึกเมื่อ/);
    assert.equal(text(root(w).querySelector('[data-tax-action="file"]')), 'บันทึกว่ายื่นเพิ่มเติมครั้งที่ 1 แล้ว');
    // Amendment: a new row, the first one untouched; this time the lock is accepted (sales + purchase).
    w.confirm = message => { asked.push(message); return true; };
    root(w).querySelector('[data-tax-action="file"]').click(); await sleep(60);
    const after = JSON.parse(w.localStorage.getItem(RETURNS_KEY)).returns;
    assert.deepEqual(after.map(r => r.amendment), [0, 1]);
    assert.deepEqual(after[0], first, 'never overwritten');
    assert.match(asked.at(-2), /ยื่นเพิ่มเติมครั้งที่ 1 ภ.พ.30 เดือน สิงหาคม 2569/);
    const locks = w.ERPGovernance.listPeriodLocks();
    assert.deepEqual(plainOf(locks.map(l => [l.branch, l.scope, l.throughDate])).sort(), [['ubon', 'purchase', '2026-08-31'], ['ubon', 'sales', '2026-08-31']]);
    assert.throws(() => w.ERPGovernance.assertPeriodOpen({ branch: 'ubon', date: '2026-08-15', scope: 'sales' }), /ถูกปิดถึง 2026-08-31/);
    // September takes August's line 12 as line 10 (not editable).
    change(w, 'tax-rpt-month', '9');
    const sept = w.ERPTaxReports.view();
    assert.equal(sept.pp30.lines[10], aug[12]);
    assert.equal(root(w).querySelector('#tax-pp30-carry'), null);
    assert.match(text(root(w)), /จาก ภ.พ.30 เดือน 08\/2569 ที่เลือก "ขอนำไปชำระในเดือนถัดไป"/);
    assert.equal(sept.pp30.lines[11], Math.max(0, Math.round((5184.9 - 2395.05 - aug[12]) * 100) / 100));
    // The branch has no previous return → line 10 typed by hand.
    change(w, 'tax-rpt-branch', 'khonkaen');
    const input = root(w).querySelector('#tax-pp30-carry');
    assert.ok(input);
    change(w, 'tax-pp30-carry', '1000');
    assert.deepEqual([w.ERPTaxReports.view().pp30.lines[10], w.ERPTaxReports.view().pp30.lines[11]], [1000, 2827.46]);
    // A month that has not ended cannot be marked as filed.
    change(w, 'tax-rpt-year', String(new Date().getFullYear()));
    change(w, 'tax-rpt-month', String(new Date().getMonth() + 1));
    assert.equal(root(w).querySelector('[data-tax-action="file"]').disabled, true);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('taxui#6 backup: vatReturns in the JSON backup, validated fail-closed, restored; reset removes them', async () => {
  const h = await bootWithSample(); const { w } = h;
  try {
    await openReport(w, { tab: 'pp30', branch: 'ubon' });
    w.confirm = message => !/ปิดงวด/.test(message);
    root(w).querySelector('[data-tax-action="file"]').click(); await sleep(60);
    const stored = JSON.parse(w.localStorage.getItem(RETURNS_KEY));
    assert.equal(stored.returns.length, 1, said(h));
    const backup = w.testApp.collectLocalMasterBackup();
    assert.deepEqual(JSON.parse(JSON.stringify(backup.vatReturns)), stored);
    // A tampered backup is refused before anything is written.
    const tampered = { meta: {}, masterData: { ...JSON.parse(JSON.stringify(backup)), vatReturns: { schemaVersion: 1, returns: [{ ...stored.returns[0], lines: { ...stored.returns[0].lines, 11: -5 } }] } } };
    assert.throws(() => w.ERPBackup.validate(tampered), /ภ.พ.30/);
    // Replace-restore after the store was emptied brings the snapshot back exactly.
    w.localStorage.removeItem(RETURNS_KEY);
    w.testApp.restoreLocalMasterBackup(JSON.parse(JSON.stringify(backup)), { replace: true });
    assert.deepEqual(JSON.parse(w.localStorage.getItem(RETURNS_KEY)), stored);
    // Merge keeps the device copy of the same id and adds rows that are new.
    const extra = { ...stored.returns[0], id: 'vatret_other', branchKey: 'khonkaen', branches: ['khonkaen'], filedBy: 'อีกเครื่อง' };
    w.testApp.restoreLocalMasterBackup({ vatReturns: { schemaVersion: 1, returns: [{ ...stored.returns[0], filedBy: 'แก้ในไฟล์' }, extra] } }, { replace: false });
    const merged = JSON.parse(w.localStorage.getItem(RETURNS_KEY)).returns;
    assert.deepEqual(merged.map(r => [r.id, r.filedBy]), [[stored.returns[0].id, stored.returns[0].filedBy], ['vatret_other', 'อีกเครื่อง']]);
    // An old backup without vatReturns leaves them alone.
    w.testApp.restoreLocalMasterBackup({ contacts: w.testApp.collectLocalMasterBackup().contacts }, { replace: false });
    assert.equal(JSON.parse(w.localStorage.getItem(RETURNS_KEY)).returns.length, 2);
    // A damaged store is never exported as "empty".
    w.localStorage.setItem(RETURNS_KEY, '{broken');
    assert.throws(() => w.testApp.collectLocalMasterBackup(), /ภ.พ.30/);
    await openReport(w, { tab: 'pp30', branch: 'ubon' });
    assert.match(text(root(w)), /ข้อมูล ภ.พ.30 ที่บันทึกไว้อ่านไม่ได้/);
    assert.equal(root(w).querySelector('[data-tax-action="file"]').disabled, true);
    w.localStorage.setItem(RETURNS_KEY, JSON.stringify(stored));
    const damagedLogs = h.errors.length;
    // Demo reset: the filed returns go with the documents they summarise; the company profile key is kept.
    w.localStorage.setItem(PROFILE_KEY, JSON.stringify(PROFILE));
    const reset = await w.ERPDemoSeed.reset({ confirm: () => true });
    assert.equal(reset.status, 'reset', said(h));
    assert.equal(w.localStorage.getItem(RETURNS_KEY), null);
    assert.ok(w.localStorage.getItem(PROFILE_KEY));
    await openReport(w, { tab: 'sales', branch: 'ubon' });
    assert.deepEqual([...root(w).querySelectorAll('.tax-rpt-table tfoot td')].map(text).slice(7, 9), ['0.00', '0.00']);
    assert.equal(h.errors.length, damagedLogs, 'no error after the damaged store was repaired');
    assert.ok(h.errors.every(line => /vat returns unreadable/.test(line)), h.errors.join('\n'));
  } finally { h.close(); }
});

test('taxui#7 one establishment (ADR-022): only the head office in every selector, ยื่นรวมกัน = head office only; a damaged month blocks the figures', async () => {
  const h = await boot({ beforeScripts: w => {
    w.localStorage.setItem(SETTING_KEY, JSON.stringify({ schemaVersion: 1, count: 1, updatedAt: '2026-10-04T00:00:00.000Z' }));
    w.localStorage.setItem(PROFILE_KEY, JSON.stringify({ ...PROFILE, vatFilingMode: 'combined' }));
  } });
  const { w } = h;
  try {
    const result = await w.ERPDemoSeed.load({ today: '2026-10-04', confirm: () => true });
    assert.equal(result.status, 'loaded', said(h));
    for (const tab of ['sales', 'purchase', 'forbidden']) {
      await openReport(w, { tab, branch: '' });
      assert.deepEqual([...w.document.getElementById('tax-rpt-branch').options].map(o => [o.value, o.textContent]), [['ubon', 'สำนักงานใหญ่']], tab);
      assert.doesNotMatch(text(root(w)), /สาขาที่ 00001|khonkaen/);
    }
    await openReport(w, { tab: 'pp30', branch: '' });
    assert.deepEqual([...w.document.getElementById('tax-rpt-branch').options].map(o => o.value), ['combined']);
    assert.match(text(root(w)), /วิธียื่น: ยื่นรวมกัน/);
    assert.deepEqual([lineText(w, 5), lineText(w, 7), lineText(w, 11)], ['9,810.50', '2,395.05', '7,415.45'], 'all sample documents are at the head office');
    assert.match(text(root(w).querySelector('.tax-form-head')), /บริษัท สยามตัวอย่าง จำกัด/);
    assert.match(text(root(w).querySelector('.tax-form-head')), /0105568123453/);
    assert.doesNotMatch(text(root(w).querySelector('.tax-form-head')), /ค่าตัวอย่าง/, 'a real TIN: no warning');
    // Fail-closed: a damaged month → no figures at all (never a silently smaller total).
    w.localStorage.setItem(packKey('ubon', 2026, 7), '{not json');
    await openReport(w, { tab: 'sales', branch: '' });
    assert.match(text(root(w)), /อ่านข้อมูลเอกสารบางเดือนไม่ได้/);
    assert.equal(root(w).querySelector('.tax-rpt-table'), null);
    assert.ok(h.errors.every(line => /07\/2569|ubon\/2026\/6/.test(line)), h.errors.join('\n'));
  } finally { h.close(); }
});

test('taxui#8 Supplier Master establishment + TIN warning (G5); invoice VAT category for no-VAT sales (G4) reaches the report', async () => {
  const h = await bootWithSample(); const { w } = h;
  const d = w.document;
  try {
    w.go('master-data', null);
    assert.ok(d.getElementById('md-s-branch-kind') && d.getElementById('md-s-branch-code') && d.getElementById('md-s-branch-name'));
    const save = () => { clearSaid(h); w.saveSupplierMaster(); return said(h); };
    d.getElementById('md-s-name').value = 'บจก. ทดสอบสาขา';
    d.getElementById('md-s-tax').value = '0105558004045';
    change(w, 'md-s-branch-kind', 'branch');
    d.getElementById('md-s-branch-code').value = '12a';
    assert.match(save(), /สาขาที่/);
    assert.equal(w.findContactMaster('บจก. ทดสอบสาขา', 'supplier'), null, 'refused → not saved');
    d.getElementById('md-s-branch-code').value = '7';
    d.getElementById('md-s-branch-name').value = 'สาขาบางนา';
    assert.match(save(), /หลักสุดท้ายไม่ตรงกับเลขตรวจสอบ/, 'check digit → warning, saved');
    const row = w.contactMasterRows().find(r => r.name === 'บจก. ทดสอบสาขา');
    assert.deepEqual([row.branchCode, row.branchName, row.role], ['00007', 'สาขาบางนา', 'supplier']);
    w.editContactMaster(row.id, 'supplier');
    assert.deepEqual([d.getElementById('md-s-branch-kind').value, d.getElementById('md-s-branch-code').value], ['branch', '00007']);
    w.resetSupplierMasterForm();
    assert.equal(d.getElementById('md-s-branch-kind').value, '');
    // Invoice form: the category control appears only for "ไม่มี VAT" and is stored on save.
    w.go('invoice-form', null); w.resetF('invoice'); w.selBr('i', 'ubon');
    assert.equal(d.getElementById('i-vat-category-field').hidden, true);
    change(w, 'i-vat', '2');
    assert.equal(d.getElementById('i-vat-category-field').hidden, false);
    change(w, 'i-vat-category', 'zero');
    w.document.getElementById('i-date').value = '2026-10-03';
    w.document.getElementById('i-cust').value = 'บจก. ผู้นำเข้าต่างประเทศ';
    w.document.getElementById('i-address').value = '1 Export Road, Singapore';
    w.addIItem({ product: 'บริการส่งออก', qty: 1, unit: 'งาน', priceUnit: 20000 });
    w.calcI();
    clearSaid(h);
    await w.saveInvoice(); await sleep(30);
    const exported = w.ERPIntegrity.business().invoices.find(i => i.customer === 'บจก. ผู้นำเข้าต่างประเทศ');
    assert.ok(exported, said(h));
    assert.deepEqual([exported.vatMode, exported.vatCategory, exported.subtotal, exported.vatAmt], ['none', 'zero', 20000, 0]);
    await openReport(w, { tab: 'pp30', branch: 'ubon', month: '10' });
    assert.equal(lineText(w, 2), '20,000.00', 'ภ.พ.30 line 2 (ร้อยละ 0)');
    root(w).querySelector('[data-tax-tab="sales"]').click();
    assert.match(text(root(w)), /บจก\. ผู้นำเข้าต่างประเทศ.*20,000\.00.*0\.00.*อัตราร้อยละ 0/);
    // Editing loads the stored category back.
    w.resetF('invoice');
    assert.equal(d.getElementById('i-vat-category').value, 'exempt');
    w.editInvoice('ubon', 2026, 9, exported.id);
    assert.equal(d.getElementById('i-vat-category').value, 'zero');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});
