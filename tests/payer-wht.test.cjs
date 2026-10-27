// ADR-024 (round 8, stage D) in the booted app (jsdom): payer-side withholding — the expense form's "หักภาษี ณ ที่จ่าย"
// section (Supplier Master autofill, live preview, AC5.8 refusal), the 50 ทวิ issued in the same save (numbered per
// establishment and พ.ศ. book), its screen / print (ฉบับที่ 1 + 2, every value escaped), the ภ.ง.ด.3 / ภ.ง.ด.53 tabs of
// "รายงานภาษี" with the sample data's hand-worked September 2569, Excel (vendored SheetJS, no network) / CSV / print,
// filing snapshots + amendment + the purchase-side period lock, cancel rules, the expense delete guard (D3 item 1),
// backup round trip (fail-closed), reset and one-branch mode. Pure rules: tests/payer-wht-core.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot } = require('./dom-helper.cjs');

const ROOT = path.resolve(__dirname, '..');
const TENANT = 'erp_tenant::customer-showcase-local::';
const FILINGS_KEY = `${TENANT}comform_wht_filings_v1`;
const RETURNS_KEY = `${TENANT}comform_vat_returns_v1`;
const SETTING_KEY = `${TENANT}comform_company_branch_setting_v1`;
const PROFILE_KEY = `${TENANT}comform_company_profile_v1`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = el => String(el?.textContent || '').replace(/\s+/g, ' ').trim();
const plain = value => JSON.parse(JSON.stringify(value));
const said = h => [...h.messages, ...[...h.w.document.querySelectorAll('.app-toast-msg')].map(el => el.textContent)].join('\n');
const clearSaid = h => { h.messages.length = 0; h.w.document.querySelectorAll('.app-toast').forEach(el => el.remove()); };
const HOSTILE = '<img src=x onerror="alert(1)">"&\'';
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
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
  el.dispatchEvent(new w.Event('change', { bubbles: true }));
}
function tick(w, id, on = true) {
  const el = w.document.getElementById(id);
  el.checked = on;
  el.dispatchEvent(new w.Event('change', { bubbles: true }));
}
async function openReport(w, { tab = 'pnd53', branch = 'ubon', month = '9', year = '2026' } = {}) {
  w.go('tax-reports', null);
  await sleep(30);
  root(w).querySelector(`[data-tax-tab="${tab}"]`).click();
  change(w, 'tax-rpt-month', month);
  change(w, 'tax-rpt-year', year);
  if (branch) change(w, 'tax-rpt-branch', branch);
  return w.ERPTaxReports.view();
}
function capturePrint(w) {
  const written = [];
  w.open = () => ({ document: { write: html => written.push(html), close() {} }, set opener(v) {} });
  return written;
}
// Fills the expense form (head office) and saves; returns what the app said.
async function saveExpense(h, fields, wht = {}) {
  const { w } = h;
  w.go('expense-form', null); w.resetF('expense'); w.selBr('e', 'ubon');
  for (const [id, value] of Object.entries(fields)) change(w, id, value);
  if (wht.enabled !== false) tick(w, 'e-wht-enabled');
  // r8fix#A1: these fixtures pay payees that are not VAT-registered (no tax invoice) — the form now asks; say "ไม่มี VAT".
  if (wht.enabled !== false) change(w, 'e-wht-vat-basis', wht.vatBasis || 'none');
  if (wht.supplier) {
    const select = w.document.getElementById('e-wht-supplier');
    select.dispatchEvent(new w.Event('focusin', { bubbles: true }));
    change(w, 'e-wht-supplier', [...select.options].find(o => o.textContent.includes(wht.supplier)).value);
  }
  for (const [id, value] of Object.entries(wht.fields || {})) change(w, id, value);
  if (wht.beforeSave) wht.beforeSave(w);
  await w.LocalDemoHealth?.whenIdle?.('saveExpense');
  clearSaid(h);
  await w.saveExpense();
  await sleep(20);
  return said(h);
}
const expenseByDoc = (w, docNo) => w.ERPIntegrity.business().expenses.find(e => e.docNo === docNo);

test('whtui#1 expense with WHT through the form: Supplier Master autofill + preview, 50 ทวิ in the same save (next เลขที่), AC5.8 refusal, list badge and ⋯ actions', async () => {
  const h = await bootWithSample(); const { w } = h; const d = w.document;
  try {
    w.go('expense-form', null); w.resetF('expense');
    assert.ok(d.getElementById('e-wht-section'), 'section in the expense form');
    assert.equal(d.getElementById('e-wht-grid').hidden, true, 'closed until ticked');
    const base = { 'e-date': '2026-10-02', 'e-cat': 'ค่าขนส่ง/จัดส่ง', 'e-desc': 'ค่าขนส่งรอบต้นเดือน', 'e-amount': '3000', 'e-doc-type': 'receipt', 'e-tax-status': 'not_required', 'e-doc-no': 'UT-6910-001', 'e-vendor': 'หจก. อุบลขนส่งด่วน' };
    const message = await saveExpense(h, base, {
      supplier: 'อุบลขนส่งด่วน',
      beforeSave: win => {
        // Autofill from Supplier Master (entity, TIN, branch, address, its WHT income type → rate fixed 1 %) + preview.
        const v = id => win.document.getElementById(id).value;
        assert.deepEqual([v('e-wht-entity'), v('e-wht-payee-tax-id'), v('e-wht-payee-branch'), v('e-wht-type'), v('e-wht-rate')], ['company', '0343559008881', '00000', 'transport', '1']);
        assert.equal(win.document.getElementById('e-wht-rate').disabled, true);
        const preview = k => text(win.document.querySelector(`[data-wht-preview="${k}"]`));
        assert.deepEqual([preview('base'), preview('tax'), preview('net'), preview('form')], ['฿3,000.00', '฿30.00', '฿2,970.00', 'ภ.ง.ด.53']);
        // October payments: 7 Nov 2026 is a Saturday and 15 Nov a Sunday → both roll to the Monday.
        assert.match(text(win.document.getElementById('e-wht-preview')), /ยื่นภายใน 09\/11\/2569 \(กระดาษ\) \/ 16\/11\/2569 \(อินเทอร์เน็ต\)/);
      }
    });
    assert.match(message, /บันทึกค่าใช้จ่ายเรียบร้อย/);
    const saved = expenseByDoc(w, 'UT-6910-001');
    assert.deepEqual([saved.amount, saved.whtForm, saved.whtRate, saved.whtBase, saved.whtAmount, saved.netPaid, saved.payeeTaxId, saved.whtCertNo], [3000, 'PND53', 1, 3000, 30, 2970, '0343559008881', 'WHT2569-0008']); // r13#MED-7: HQ book 2569 already holds 0001–0007 (Jul–Sep rent 5 %, J1 subcontract, the September payments)
    const cert = w.ERPPayerWht.readCertificates({ branches: ['ubon'] }).find(c => c.no === 'WHT2569-0008');
    assert.deepEqual([cert.id, cert.date, cert._month, cert.sourceExpenseId, cert.taxWithheld, cert.payer.name], [`wht-${saved.id}`, '2026-10-02', 9, saved.id, 30, 'บริษัทตัวอย่างสำหรับทดลองระบบ จำกัด']);
    // AC5.8 through the form: no 13-digit TIN → refused, nothing saved, no certificate.
    const before = w.ERPIntegrity.business().expenses.length;
    const refused = await saveExpense(h, { ...base, 'e-doc-no': 'UT-6910-002', 'e-vendor': 'ผู้รับเงินไม่มีเลข' }, { fields: { 'e-wht-entity': 'person', 'e-wht-type': 'hire_of_work', 'e-wht-payee-name': 'ผู้รับเงินไม่มีเลข', 'e-wht-payee-tax-id': '' } });
    assert.match(refused, /ต้องมีเลขประจำตัวผู้เสียภาษี 13 หลัก/);
    assert.equal(w.ERPIntegrity.business().expenses.length, before);
    assert.equal(w.ERPPayerWht.readCertificates().length, 13); // r13#MED-7: 12 sample certificates (both establishments) + this one
    // Below 1,000 baht: saved without withholding (a note), no certificate.
    const small = await saveExpense(h, { ...base, 'e-doc-no': 'UT-6910-003', 'e-amount': '800' }, { supplier: 'อุบลขนส่งด่วน' });
    assert.match(small, /บันทึกค่าใช้จ่ายเรียบร้อย/);
    assert.equal(expenseByDoc(w, 'UT-6910-003').whtAmount, undefined);
    assert.equal(w.ERPPayerWht.readCertificates().length, 13); // r13#MED-7: 12 sample certificates (both establishments) + this one
    // Expense list: the badge and the ⋯ actions of a payment with withholding.
    w.go('expense-list', null);
    d.getElementById('el-month').value = ''; d.getElementById('el-year').value = '2026'; w.renderEList();
    assert.match(text(d.getElementById('etbl')), /หัก ณ ที่จ่าย 1% ฿30\.00 · ภ\.ง\.ด\.53/);
    const cell = [...d.querySelectorAll('#etbl .erp-rowact')].find(c => JSON.parse(c.dataset.rowFacts).id === String(saved.id));
    assert.equal(JSON.parse(cell.dataset.rowFacts).wht, true);
    cell.querySelector('[data-row-menu]').click();
    const items = [...d.querySelectorAll('.erp-menu.erp-rowact-menu [role="menuitem"]')].map(text);
    assert.ok(items.some(t => t.endsWith('หนังสือรับรอง 50 ทวิ')) && items.some(t => t.endsWith('ยกเลิก 50 ทวิ')), items.join(', '));
    [...d.querySelectorAll('.erp-menu.erp-rowact-menu [role="menuitem"]')].find(el => text(el).endsWith('หนังสือรับรอง 50 ทวิ')).click();
    const overlay = d.getElementById('doc-preview-modal-overlay');
    assert.ok(overlay?.classList.contains('wht-cert-overlay'), 'the 50 ทวิ screen opened from ⋯');
    assert.match(text(overlay), /เล่มที่ 2569 เลขที่ 0008/);
    overlay.remove();
    assert.ok(h.errors.every(line => /action failed/.test(line)), h.errors.join('\n'));
  } finally { h.close(); }
});

test('whtui#2 50 ทวิ screen and print: both copies verbatim (AC5.9), Thai words, ☑ ภ.ง.ด.3 / ภ.ง.ด.53, ลำดับที่ = ใบแนบ row, condition box; hostile payee values escaped; sample-profile notice amber', async () => {
  const h = await bootWithSample(); const { w } = h; const d = w.document;
  try {
    const written = capturePrint(w);
    // A hostile payee typed by hand (not in Supplier Master).
    const message = await saveExpense(h, { 'e-date': '2026-10-02', 'e-cat': 'อื่น ๆ', 'e-desc': 'ค่าจ้างทำป้าย', 'e-amount': '2000', 'e-doc-type': 'receipt', 'e-tax-status': 'not_required', 'e-doc-no': 'HX-1', 'e-vendor': 'ร้านทำป้าย' }, { fields: { 'e-wht-entity': 'person', 'e-wht-type': 'hire_of_work', 'e-wht-payee-name': HOSTILE, 'e-wht-payee-tax-id': '3340100123459', 'e-wht-payee-address': `<script>alert(2)</script>${HOSTILE}` } });
    assert.match(message, /บันทึกค่าใช้จ่ายเรียบร้อย/);
    const saved = expenseByDoc(w, 'HX-1');
    assert.deepEqual([saved.whtForm, saved.whtAmount, saved.whtCertNo], ['PND3', 60, 'WHT2569-0008']);
    const overlay = w.ERPPayerWht.openForExpense('ubon', 2026, 9, String(saved.id));
    assert.equal(overlay.querySelectorAll('img[src="x"], script').length, 0, 'screen: no markup from data');
    assert.ok(text(overlay).includes(HOSTILE.replace(/\s+/g, ' ')), 'shown as text');
    assert.match(text(overlay), /ตัวอย่างสาธิต — ข้อมูลผู้จ่ายเงินยังเป็นข้อมูลบริษัทตัวอย่าง/);
    assert.ok(overlay.querySelector('.wht-cert-notice-sample') && !overlay.querySelector('.wht-cert-notice-invalid'), 'sample profile → amber, not red (D3 item 4)');
    overlay.querySelector('[data-wht-doc="print-all"]').click();
    assert.equal(written.length, 1);
    const html = written[0];
    assert.ok(!html.includes('<img src=x') && !html.includes('<script>alert(2)'), 'print: no raw markup from data');
    assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&quot;&amp;&#39;'), 'escaped');
    for (const label of ['ฉบับที่ 1 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย ใช้แนบพร้อมกับแบบแสดงรายการภาษี)', 'ฉบับที่ 2 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย เก็บไว้เป็นหลักฐาน)', 'หนังสือรับรองการหักภาษี ณ ที่จ่าย', 'ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร', 'ผู้มีหน้าที่หักภาษี ณ ที่จ่าย', 'ผู้ถูกหักภาษี ณ ที่จ่าย', 'หกสิบบาทถ้วน', 'ขอรับรองว่าข้อความและตัวเลขดังกล่าวข้างต้นถูกต้องตรงกับความจริงทุกประการ', 'ประทับตรานิติบุคคล (ถ้ามี)', '@page{size:A4 portrait']) assert.ok(html.includes(label), label);
    assert.equal((html.match(/data-wht-copy="/g) || []).length, 2, 'two copies');
    assert.match(html, /☑ \(4\) ภ\.ง\.ด\.3/);
    assert.match(html, /☐ \(7\) ภ\.ง\.ด\.53/);
    assert.match(html, /☑ \(1\) หัก ณ ที่จ่าย/);
    // ลำดับที่ ... ในแบบ = its row in ใบแนบ ภ.ง.ด.3 of October (the only one) — AC5.6.
    assert.match(html, /ลำดับที่ <b class="wht-cert-seq">1<\/b> ในแบบ/);
    const report = w.ERPPayerWht.reportFor('ubon', '2026-10', 'PND3');
    assert.deepEqual(plain(report.rows.map(r => [r.seq, r.certNo])), [[1, 'WHT2569-0008']]);
    // A real company profile: no notice; an invalid TIN typed in the profile: red.
    w.localStorage.setItem(PROFILE_KEY, JSON.stringify(PROFILE));
    const real = w.ERPPayerWht.certificateHtml({ ...w.ERPPayerWht.readCertificates().find(c => c.no === 'WHT2569-0008'), payer: { name: 'x', taxId: '0105568123453' } }, 1, { seq: 1, customProfile: true });
    assert.doesNotMatch(real, /wht-cert-notice/);
    const bad = w.ERPPayerWht.certificateHtml({ payer: { name: 'x', taxId: '0105568123454' } }, 2, { customProfile: true });
    assert.match(bad, /wht-cert-notice-invalid/);
    assert.match(bad, /data-wht-copy="2"/);
    assert.ok(h.errors.every(line => /action failed/.test(line)), h.errors.join('\n'));
  } finally { h.close(); }
});

test('whtui#3 รายงานภาษี › ภ.ง.ด.3 / ภ.ง.ด.53 / 50 ทวิ of September 2569 (hand-worked), due dates, print A4, Excel (no network) and CSV', async () => {
  const h = await bootWithSample(); const { w } = h;
  try {
    const cover = form => Object.fromEntries([...root(w).querySelectorAll(`[data-wht-cover="${form}"] [data-wht-total]`)].map(el => [el.dataset.whtTotal, text(el)]));
    await openReport(w, { tab: 'pnd3' });
    assert.deepEqual(cover('PND3'), { payees: '1', count: '1', amountPaid: '6,000.00', taxWithheld: '300.00' });
    const t3 = root(w).querySelector('table[data-tax-table="PND3"]');
    assert.deepEqual([...t3.querySelectorAll('thead th')].map(text), ['ลำดับที่', 'เลขประจำตัวผู้เสียภาษีอากร', 'ชื่อผู้มีเงินได้ / ที่อยู่ของผู้มีเงินได้', 'วัน เดือน ปี ที่จ่าย', 'ประเภทเงินได้', 'อัตราภาษีร้อยละ', 'จำนวนเงินที่จ่ายแต่ละประเภท', 'จำนวนเงินภาษีที่หักและนำส่ง', 'เงื่อนไข']);
    const cellText = td => text({ textContent: td.innerHTML.replace(/<br>/g, ' ').replace(/<[^>]+>/g, '') });
    assert.ok(t3.querySelector('tbody td.col-nameAddress br'), 'name and address on two lines of one cell');
    assert.deepEqual([...t3.querySelectorAll('tbody tr')].map(tr => [...tr.cells].map(cellText)), [['1', '3340100123459', 'นายสมศักดิ์ ใจงาม 25 ถนนเทพโยธี ตำบลในเมือง อำเภอเมืองอุบลราชธานี จังหวัดอุบลราชธานี 34000', '10/09/2569', 'ค่าเช่า', '5', '6,000.00', '300.00', '1']]);
    assert.match(text(root(w)), /ยื่นแบบกระดาษ ภายใน 07\/10\/2569/);
    assert.match(text(root(w)), /ยื่นทางอินเทอร์เน็ต ภายใน 15\/10\/2569/);
    assert.match(text(root(w)), /วันครบกำหนดเลื่อนพ้นวันเสาร์-อาทิตย์และวันหยุดราชการ/); // r13#LOW-1
    assert.match(text(root(w).querySelector('.tax-form-head')), /ชื่อผู้มีหน้าที่หักภาษี ณ ที่จ่าย/);
    await openReport(w, { tab: 'pnd53' });
    // r13#MED-7: + the head-office rent to the juristic landlord (11,214.95 × 5 % = 560.75).
    assert.deepEqual(cover('PND53'), { payees: '3', count: '3', amountPaid: '18,714.95', taxWithheld: '735.75' });
    const t53 = root(w).querySelector('table[data-tax-table="PND53"]');
    assert.deepEqual([...t53.querySelectorAll('tbody tr')].map(tr => [text(tr.cells[0]), text(tr.cells[1]), text(tr.cells[2]), text(tr.cells[7]), text(tr.cells[8])]), [['1', '0345556001011', '00000', '11,214.95', '560.75'], ['2', '0343559008881', '00000', '2,500.00', '25.00'], ['3', '0105561007075', '00000', '5,000.00', '150.00']]);
    assert.deepEqual([...t53.querySelectorAll('tfoot td')].map(text).slice(7, 9), ['18,714.95', '735.75'], 'footer = Σ rows (AC5.6)');
    // The register tab: the month's four certificates (r13#MED-7: + the rent 50 ทวิ; numbers continue the 2569 book).
    await openReport(w, { tab: 'wht' });
    assert.deepEqual([...root(w).querySelectorAll('.tax-wht-register tbody tr')].map(tr => text(tr.cells[0])), ['เล่มที่ 2569 เลขที่ 0004', 'เล่มที่ 2569 เลขที่ 0005', 'เล่มที่ 2569 เลขที่ 0006', 'เล่มที่ 2569 เลขที่ 0007']);
    // r13#MED-7: the branch withholds 5 % on its own building rent (ภ.ง.ด.53 8,411.21 / 420.56) but has no ภ.ง.ด.3 in
    // September: an empty ใบแนบ that says "nothing to file".
    await openReport(w, { tab: 'pnd53', branch: 'khonkaen' });
    assert.equal(text(root(w).querySelector('[data-wht-cover="PND53"] [data-wht-total="taxWithheld"]')), '420.56');
    await openReport(w, { tab: 'pnd3', branch: 'khonkaen' });
    assert.match(text(root(w)), /ไม่มีการหักภาษี ณ ที่จ่ายในเดือนนี้/);
    assert.equal(root(w).querySelector('[data-tax-action="file-wht"]').disabled, true);
    // Print: A4 landscape, payer header + cover + rows + signature line.
    const written = capturePrint(w);
    await openReport(w, { tab: 'pnd53' });
    root(w).querySelector('[data-tax-action="print"]').click();
    assert.equal(written.length, 1);
    for (const label of ['ใบแนบ ภ.ง.ด.53', 'สรุปรายการ ภ.ง.ด.53 (ใบปะหน้า)', 'เลขประจำตัวผู้เสียภาษีอากร', 'ชื่อและที่อยู่ของผู้มีเงินได้', 'แผ่นที่ 1 ในจำนวน 1 แผ่น', 'ผู้จ่ายเงิน', '18,714.95', '735.75', 'หจก. อุบลขนส่งด่วน']) assert.ok(written[0].includes(label), label);
    // Excel through the lazy vendored SheetJS (network blocked) and CSV with BOM.
    w.fetch = () => { throw new Error('network blocked'); };
    const appended = [];
    const original = w.document.head.appendChild.bind(w.document.head);
    w.document.head.appendChild = node => { if (node.tagName === 'SCRIPT') appended.push(node); return original(node); };
    root(w).querySelector('[data-tax-action="excel"]').click();
    assert.equal(appended.length, 1);
    assert.equal(appended[0].getAttribute('src'), './vendor/xlsx-0.18.5.full.min.js');
    w.eval(fs.readFileSync(path.join(ROOT, 'vendor/xlsx-0.18.5.full.min.js'), 'utf8'));
    const books = [];
    w.XLSX.writeFile = (wb, file) => books.push({ wb, file });
    appended[0].onload();
    assert.equal(books.length, 1, said(h));
    assert.ok(books[0].wb.SheetNames.every(name => !/[/\\?*[\]:]/.test(name) && name.length <= 31), plain(books[0].wb.SheetNames).join());
    const back = w.XLSX.read(w.XLSX.write(books[0].wb, { type: 'array', bookType: 'xlsx' }), { type: 'array' });
    const rows = plain(w.XLSX.utils.sheet_to_json(back.Sheets[back.SheetNames[0]], { header: 1, defval: '' }));
    assert.ok(rows.some(r => r[1] === '0105561007075' && r.includes(5000) && r.includes(150)), JSON.stringify(rows));
    assert.ok(rows.some(r => r.includes('รวม') && r.includes(18714.95) && r.includes(735.75)), 'numbers stay numbers');
    let blob = null;
    w.URL.createObjectURL = value => { blob = value; return 'blob:x'; };
    w.URL.revokeObjectURL = () => {};
    const downloads = [];
    w.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
    root(w).querySelector('[data-tax-action="csv"]').click();
    const bytes = new Uint8Array(await new Promise(resolve => { const reader = new w.FileReader(); reader.onload = () => resolve(reader.result); reader.readAsArrayBuffer(blob); }));
    const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    assert.ok(csv.startsWith('﻿ลำดับที่,'), csv.slice(0, 80));
    assert.match(csv, /0343559008881,00000,/);
    assert.equal(downloads.length, 1);
    assert.match(downloads[0], /\.csv$/);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('whtui#4 filing: snapshot (append-only) + amendment, purchase lock offered; a filed certificate cannot be cancelled; locks refuse before any question; customer WHT is not in ภ.ง.ด.', async () => {
  const h = await bootWithSample(); const { w } = h;
  try {
    const asked = [];
    w.confirm = message => { asked.push(message); return !/ปิดงวด/.test(message); };
    await openReport(w, { tab: 'pnd3' });
    w.document.getElementById('tax-wht-channel').value = 'efiling';
    w.document.getElementById('tax-wht-channel').dispatchEvent(new w.Event('change', { bubbles: true }));
    root(w).querySelector('[data-tax-action="file-wht"]').click(); await sleep(60);
    let store = JSON.parse(w.localStorage.getItem(FILINGS_KEY));
    assert.equal(store.filings.length, 1, said(h));
    const first = store.filings[0];
    assert.deepEqual([first.branch, first.period, first.form, first.amendment, first.channel, first.dueDate, first.totals.taxWithheld, first.rows[0].certNo], ['ubon', '2026-09', 'PND3', 0, 'efiling', '2026-10-15', 300, 'WHT2569-0005']);
    assert.match(asked[0], /ยื่นปกติ ภ\.ง\.ด\.3 เดือน 09\/2569/);
    assert.match(asked[1], /ปิดงวดฝั่งซื้อ/, 'lock offered (declined)');
    assert.match(text(root(w)), /ยื่นปกติ · บันทึกเมื่อ/);
    // The filed certificate cannot be cancelled (refused before the reason question).
    let prompted = 0;
    w.prompt = () => { prompted += 1; return 'x'; };
    const rent = w.ERPPayerWht.readCertificates().find(c => c.no === 'WHT2569-0005');
    clearSaid(h);
    assert.equal(w.ERPPayerWht.askVoidCertificate('ubon', 2026, 8, rent.id), false);
    assert.equal(prompted, 0);
    assert.match(said(h), /อยู่ใน ภ\.ง\.ด\.3 เดือน 09\/2569 ที่บันทึกว่ายื่นแล้ว/);
    // ภ.ง.ด.53: cancel the transport certificate (not filed) → out of the form, number kept; then file + amend.
    const transport = w.ERPPayerWht.readCertificates().find(c => c.no === 'WHT2569-0006');
    w.prompt = () => { prompted += 1; return 'จ่ายผิดราย'; };
    assert.equal(await w.ERPPayerWht.askVoidCertificate('ubon', 2026, 8, transport.id), true, said(h));
    assert.equal(prompted, 1);
    await openReport(w, { tab: 'pnd53' });
    assert.equal(text(root(w).querySelector('[data-wht-cover="PND53"] [data-wht-total="taxWithheld"]')), '710.75'); // r13#MED-7: 735.75 − the cancelled transport 25.00
    root(w).querySelector('[data-tax-action="file-wht"]').click(); await sleep(60);
    w.confirm = message => { asked.push(message); return true; };
    root(w).querySelector('[data-tax-action="file-wht"]').click(); await sleep(60);
    store = JSON.parse(w.localStorage.getItem(FILINGS_KEY));
    assert.deepEqual(store.filings.map(f => [f.form, f.amendment]), [['PND3', 0], ['PND53', 0], ['PND53', 1]]);
    assert.deepEqual(store.filings[0], first, 'never overwritten');
    assert.match(asked.at(-2), /ยื่นเพิ่มเติมครั้งที่ 1 ภ\.ง\.ด\.53/);
    assert.deepEqual(plain(w.ERPGovernance.listPeriodLocks().map(l => [l.branch, l.scope, l.throughDate])), [['ubon', 'purchase', '2026-09-30']]);
    // Locked: cancelling a certificate and deleting an expense of September are refused before any question.
    const cloud = w.ERPPayerWht.readCertificates().find(c => c.no === 'WHT2569-0007');
    prompted = 0; clearSaid(h);
    assert.equal(w.ERPPayerWht.askVoidCertificate('ubon', 2026, 8, cloud.id), false);
    assert.equal(prompted, 0);
    assert.match(said(h), /ถูกปิดถึง 2026-09-30/);
    let confirmed = 0;
    w.confirm = () => { confirmed += 1; return true; };
    const its = w.ERPIntegrity.business().expenses.find(e => e.docNo === 'ITS-6909-0172');
    clearSaid(h);
    await w.delDoc('ubon', 2026, 8, 'expenses', its.id);
    assert.equal(confirmed, 0);
    assert.match(said(h), /ถูกปิดถึง 2026-09-30/);
    assert.ok(w.ERPIntegrity.business().expenses.some(e => e.docNo === 'ITS-6909-0172'));
    // Customer WHT (receipt K3 −3 %) is receivable-side: never in our ภ.ง.ด.53.
    const k3 = w.ERPIntegrity.business().receipts.find(r => Number(r.whtAmount) > 0);
    assert.ok(k3);
    const all53 = w.ERPPayerWht.reportFor(k3.branch || 'khonkaen', k3.date.slice(0, 7), 'PND53');
    // r13#MED-7: the branch's own rent is in its ภ.ง.ด.53 — the customer's withholding is not.
    assert.equal(all53.rows.length, 1);
    assert.doesNotMatch(JSON.stringify(all53.rows), new RegExp(k3.no));
    assert.ok(!JSON.stringify(all53.rows).includes(k3.customer));
    assert.ok(h.errors.every(line => /action failed/.test(line)), h.errors.join('\n'));
  } finally { h.close(); }
});

test('whtui#5 D3 item 1: deleting an expense is refused BEFORE the question when its 50 ทวิ is live, or its claim month\'s ภ.พ.30 is filed; allowed after the certificate is cancelled', async () => {
  const h = await bootWithSample(); const { w } = h;
  try {
    let confirmed = 0;
    w.confirm = message => { confirmed += 1; return !/ปิดงวด/.test(message); };
    const del = async docNo => { const e = w.ERPIntegrity.business().expenses.find(x => x.docNo === docNo); clearSaid(h); confirmed = 0; await w.delDoc('ubon', Number(e.date.slice(0, 4)), Number(e.date.slice(5, 7)) - 1, 'expenses', e.id); return said(h); };
    // A live certificate.
    let message = await del('RC-0910');
    assert.equal(confirmed, 0);
    assert.match(message, /มีหนังสือรับรองการหักภาษี ณ ที่จ่าย เล่มที่ 2569 เลขที่ 0005 ที่ยังใช้งาน — ยกเลิกหนังสือรับรองก่อน/);
    // ภ.พ.30 of September filed (head office) → an expense claimed in September cannot be deleted.
    w.go('tax-reports', null); await sleep(20);
    root(w).querySelector('[data-tax-tab="pp30"]').click();
    for (const [id, value] of [['tax-rpt-month', '9'], ['tax-rpt-year', '2026'], ['tax-rpt-branch', 'ubon']]) change(w, id, value);
    root(w).querySelector('[data-tax-action="file"]').click(); await sleep(60);
    assert.equal(JSON.parse(w.localStorage.getItem(RETURNS_KEY)).returns.length, 1, said(h));
    message = await del('UL-6803');
    assert.equal(confirmed, 0, 'refused before the question');
    assert.match(message, /ภ\.พ\.30 เดือนนั้นของ สำนักงานใหญ่ บันทึกว่ายื่นแล้ว|ภ\.พ\.30 เดือนนั้นของ .* บันทึกว่ายื่นแล้ว/);
    // A damaged ภ.พ.30 store: refused (fail-closed), not "nothing filed".
    const kept = w.localStorage.getItem(RETURNS_KEY);
    w.localStorage.setItem(RETURNS_KEY, '{broken');
    message = await del('UL-6803');
    assert.match(message, /อ่านข้อมูล ภ\.พ\.30 ที่บันทึกไว้ไม่ได้/);
    w.localStorage.setItem(RETURNS_KEY, kept);
    // The rent certificate cancelled → the expense may be deleted (the question is asked now).
    w.prompt = () => 'ผู้ให้เช่าขอยกเลิกสัญญา';
    const rent = w.ERPPayerWht.readCertificates().find(c => c.no === 'WHT2569-0005');
    assert.equal(await w.ERPPayerWht.askVoidCertificate('ubon', 2026, 8, rent.id), true, said(h));
    message = await del('RC-0910');
    assert.equal(confirmed, 1, said(h));
    assert.ok(!w.ERPIntegrity.business().expenses.some(e => e.docNo === 'RC-0910'));
    assert.ok(w.ERPPayerWht.readCertificates().some(c => c.no === 'WHT2569-0005' && c.voided), 'the cancelled certificate keeps its number');
  } finally { h.close(); }
});

test('whtui#6 backup: whtFilings in the JSON backup, validated fail-closed, merged / replaced; certificates travel in the month packs; reset removes the filings', async () => {
  const h = await bootWithSample(); const { w } = h;
  try {
    w.confirm = message => !/ปิดงวด/.test(message);
    await openReport(w, { tab: 'pnd53' });
    root(w).querySelector('[data-tax-action="file-wht"]').click(); await sleep(60);
    const stored = JSON.parse(w.localStorage.getItem(FILINGS_KEY));
    assert.equal(stored.filings.length, 1, said(h));
    const backup = w.testApp.collectLocalMasterBackup();
    assert.deepEqual(plain(backup.whtFilings), stored);
    // Tampered snapshot (totals ≠ rows, or an injected key) → the whole backup is refused before anything is written.
    const tampered = { meta: {}, masterData: { ...plain(backup), whtFilings: { schemaVersion: 1, filings: [{ ...stored.filings[0], totals: { ...stored.filings[0].totals, taxWithheld: 1 } }] } } };
    assert.throws(() => w.ERPBackup.validate(tampered), /ภ\.ง\.ด/);
    const injected = { meta: {}, masterData: { ...plain(backup), whtFilings: { schemaVersion: 1, filings: [{ ...stored.filings[0], html: '<script>' }] } } };
    assert.throws(() => w.ERPBackup.validate(injected), /ภ\.ง\.ด/);
    // Replace-restore after the store was emptied brings the snapshot back exactly; merge keeps the device copy.
    w.localStorage.removeItem(FILINGS_KEY);
    w.testApp.restoreLocalMasterBackup(plain(backup), { replace: true });
    assert.deepEqual(JSON.parse(w.localStorage.getItem(FILINGS_KEY)), stored);
    const extra = { ...stored.filings[0], id: 'whtret_other', branch: 'khonkaen', filedBy: 'อีกเครื่อง', rows: stored.filings[0].rows.map(r => ({ ...r, branch: 'khonkaen' })) };
    w.testApp.restoreLocalMasterBackup({ whtFilings: { schemaVersion: 1, filings: [{ ...stored.filings[0], filedBy: 'แก้ในไฟล์' }, extra] } }, { replace: false });
    assert.deepEqual(JSON.parse(w.localStorage.getItem(FILINGS_KEY)).filings.map(f => [f.id, f.filedBy]), [[stored.filings[0].id, stored.filings[0].filedBy], ['whtret_other', 'อีกเครื่อง']]);
    // An old backup without whtFilings leaves them alone; a damaged store is never exported as "empty".
    w.testApp.restoreLocalMasterBackup({ contacts: w.testApp.collectLocalMasterBackup().contacts }, { replace: false });
    assert.equal(JSON.parse(w.localStorage.getItem(FILINGS_KEY)).filings.length, 2);
    const good = w.localStorage.getItem(FILINGS_KEY);
    w.localStorage.setItem(FILINGS_KEY, '{broken');
    assert.throws(() => w.testApp.collectLocalMasterBackup(), /ภ\.ง\.ด/);
    await openReport(w, { tab: 'pnd53' });
    assert.match(text(root(w)), /ข้อมูลการยื่น ภ\.ง\.ด\.3\/53 ที่บันทึกไว้อ่านไม่ได้/);
    assert.equal(root(w).querySelector('[data-tax-action="file-wht"]').disabled, true);
    w.localStorage.setItem(FILINGS_KEY, good);
    // Month backup: the certificates are in the pack.
    const month = w.testApp.collectBackupData({ year: 2026, month: 8, branch: 'ubon', includeEmpty: true });
    assert.deepEqual(plain(month[2026].ubon['กันยายน'].whtCertificates.map(c => c.no)), ['WHT2569-0004', 'WHT2569-0005', 'WHT2569-0006', 'WHT2569-0007']); // r13#MED-7
    // Reset: the filings go with the documents they summarise.
    const reset = await w.ERPDemoSeed.reset({ confirm: () => true });
    assert.equal(reset.status, 'reset', said(h));
    assert.equal(w.localStorage.getItem(FILINGS_KEY), null);
    assert.deepEqual(plain(w.ERPPayerWht.readCertificates()), []);
    await openReport(w, { tab: 'pnd53' });
    assert.equal(text(root(w).querySelector('[data-wht-cover="PND53"] [data-wht-total="count"]')), '0');
  } finally { h.close(); }
});

test('whtui#7 one establishment: the three sample 50 ทวิ at the head office, no สาขา in the WHT selectors; phone width keeps the tabs on one scrolling row', async () => {
  const h = await boot({ beforeScripts: w => w.localStorage.setItem(SETTING_KEY, JSON.stringify({ schemaVersion: 1, count: 1, updatedAt: '2026-10-04T00:00:00.000Z' })) });
  const { w } = h;
  try {
    assert.equal((await w.ERPDemoSeed.load({ today: '2026-10-04', confirm: () => true })).status, 'loaded', said(h));
    for (const tab of ['pnd3', 'pnd53', 'wht']) {
      await openReport(w, { tab, branch: '' });
      assert.deepEqual([...w.document.getElementById('tax-rpt-branch').options].map(o => o.value), ['ubon'], tab);
    }
    assert.equal(w.ERPPayerWht.readCertificates({ branches: ['khonkaen'] }).length, 0);
    await openReport(w, { tab: 'pnd53', branch: 'ubon' });
    assert.equal(text(root(w).querySelector('[data-wht-cover="PND53"] [data-wht-total="taxWithheld"]')), '735.75'); // r13#MED-7: + the head-office rent 560.75
    const css = fs.readFileSync(path.join(ROOT, 'erp-tax-reports.css'), 'utf8');
    assert.match(css, /@media\(max-width:900px\)\{[\s\S]*?\.tax-tabs\{flex-wrap:nowrap;overflow-x:auto/);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});
