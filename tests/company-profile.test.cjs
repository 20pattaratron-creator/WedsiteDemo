// ADR-020 — the customer's own company profile + logo in the booted app (jsdom):
// boot merge before the documents render, every document type (quotation, delivery / tax invoice,
// abbreviated tax invoice, receipt, credit note) with the custom name / address / tax ID / branch
// code / logo and back to the exact default HTML after a reset, header + toolbars, the settings
// form (inline validation, save, logo upload through the real file input with a stub canvas,
// quota error), JSON backup export / restore (old backups untouched), demo reset, unsaved-changes
// guard and hostile values. Pure rules: tests/company-profile-core.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { boot } = require('./dom-helper.cjs');

const ROOT = path.resolve(__dirname, '..');
const TENANT = 'erp_tenant::customer-showcase-local::';
const PROFILE_KEY = `${TENANT}comform_company_profile_v1`;
const LOGO_KEY = `${TENANT}comform_company_logo_v1`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, tries = 200) { for (let i = 0; i < tries && !check(); i++) await sleep(25); return check(); }
const text = el => String(el?.textContent || '').replace(/\s+/g, ' ').trim();

const b64 = (signature, length) => { let body = signature + 'A'.repeat(Math.max(0, length - signature.length)); while (body.length % 4) body += 'A'; return body; };
const PNG_URL = `data:image/png;base64,${b64('iVBORw0KGgo', 2000)}`;
const PROFILE = {
  schemaVersion: 1, nameTh: 'บริษัท สยามตัวอย่าง จำกัด', nameEn: 'SIAM TUAYANG CO., LTD.', taxId: '0105568123453',
  addressTh: '99/9 ถนนพระราม 9 แขวงห้วยขวาง เขตห้วยขวาง กรุงเทพมหานคร 10310', phone: '02-123-4567', email: 'info@siamtuayang.co.th', website: 'www.siamtuayang.co.th',
  branches: { ubon: { code: '00000', label: '', addressTh: '' }, khonkaen: { code: '00002', label: 'สาขาขอนแก่น', addressTh: '12 ถนนมิตรภาพ ตำบลในเมือง อำเภอเมืองขอนแก่น จังหวัดขอนแก่น 40000' } },
  updatedAt: '2026-10-03T10:00:00.000Z'
};
const LOGO = { schemaVersion: 1, dataUrl: PNG_URL, mime: 'image/png', width: 600, height: 300, updatedAt: '2026-10-03T10:00:00.000Z' };
const seeded = (profile = PROFILE, logo = LOGO) => ({ beforeScripts: w => { if (profile) w.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); if (logo) w.localStorage.setItem(LOGO_KEY, JSON.stringify(logo)); } });

const ITEMS = [{ productCode: 'P-1', product: 'โต๊ะทำงาน', unit: 'ตัว', qty: 2, priceUnit: 4500, saleTotal: 9000, total: 9000 }];
const QUOTE = { id: 'Q1', no: 'QT2610-01', date: '2026-10-01', branch: 'khonkaen', customer: 'บริษัท ลูกค้า จำกัด', items: ITEMS, subtotal: 9000, useVat: 1, vatAmt: 630, total: 9630 };
const INVOICE = { id: 'I1', no: 'INV2610-01', date: '2026-10-01', dueDate: '2026-10-31', branch: 'khonkaen', customer: 'บริษัท ลูกค้า จำกัด', customerAddress: '1 ถนนลูกค้า', customerTaxId: '0105558012349', taxInvoiceForm: 'full', useVat: 1, items: ITEMS };
const ABBR = { id: 'I2', no: 'INV2610-02', date: '2026-10-01', branch: 'ubon', customer: 'ลูกค้าทั่วไป / เงินสด', taxInvoiceForm: 'abbreviated', useVat: 0, vatMode: 'extract', items: [{ product: 'สินค้าหน้าร้าน', qty: 2, unit: 'ชิ้น', priceUnit: 535 }], subtotal: 1000, vatAmt: 70, total: 1070 };
const RECEIPT = { id: 'R1', no: 'REC2610-01', date: '2026-10-02', branch: 'khonkaen', customer: 'บริษัท ลูกค้า จำกัด', useVat: 1, items: ITEMS };
let creditNoteRecord;
test.before(async () => {
  const c = await import(pathToFileURL(path.join(ROOT, 'erp-credit-note-core.js')).href);
  const invoice = { id: 8001, no: 'INV2609-0001', date: '2026-09-05', branch: 'ubon', year: 2026, month: 8, customer: 'บริษัท ลูกค้า จำกัด', customerAddress: '1 ถนนลูกค้า', customerTaxId: '0105558012349', useVat: 1, vatMode: 'add', subtotal: 10000, vatAmt: 700, total: 10700 };
  const calculation = c.calculateCreditNote({ lines: [{ invoice, differenceAmount: 1000 }] });
  creditNoteRecord = c.buildCreditNoteRecord({ no: 'CN2610-01', date: '2026-10-02', branch: 'ubon', customer: invoice.customer, customerAddress: invoice.customerAddress, customerTaxId: invoice.customerTaxId, reasonCode: 'price_overcharge', reasonText: 'ลดราคา', note: '' }, { calculation, invoices: [invoice] }, { id: 7001, at: '2026-10-02T00:00:00.000Z' });
});

function renderDocuments(w) {
  return {
    quotation: w.ComformQuotationDocument.buildInlineHtml(QUOTE, { b: 'khonkaen' }),
    quotationHead: w.ComformQuotationDocument.buildInlineHtml({ ...QUOTE, branch: 'ubon' }, { b: 'ubon' }),
    taxInvoice: w.ComformDeliveryTaxDocument.buildInlineHtml(INVOICE, { b: 'khonkaen' }),
    abbreviated: w.ComformDeliveryTaxDocument.buildInlineHtml(ABBR, { b: 'ubon' }),
    receipt: w.ComformReceiptDocument.buildInlineHtml(RECEIPT, { b: 'khonkaen' }),
    creditNote: w.ComformCreditNoteDocument.buildHtml(creditNoteRecord, 'original')
  };
}
const header = w => ({ title: text(w.document.getElementById('tenant-company-title')), logo: w.document.querySelector('.comform-topbar .company-logo').getAttribute('src'), docTitle: w.document.title });
const form = w => w.document.getElementById('company-profile-form');
function setField(w, field, value) {
  const el = form(w).querySelector(`[data-cp-field="${field}"]`);
  el.value = value;
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
  el.dispatchEvent(new w.Event('focusout', { bubbles: true }));
}
const clickSave = w => form(w).querySelector('[data-cp-action="save"]').click();

// jsdom has no canvas / image decoder: a stub that "draws" and encodes a PNG of a chosen length.
function stubCanvas(w, { pngLength = 9000, transparent = true } = {}) {
  const drawn = [];
  w.createImageBitmap = async blob => ({ width: 1200, height: 600, type: blob.type, close() {} });
  w.HTMLCanvasElement.prototype.getContext = function () {
    const canvas = this;
    return { clearRect() {}, drawImage: (image, x, y, width, height) => drawn.push({ width, height, canvas: [canvas.width, canvas.height] }), getImageData: (x, y, width, height) => { const data = new Uint8ClampedArray(width * height * 4).fill(255); if (transparent) data[3] = 0; return { data }; } };
  };
  w.HTMLCanvasElement.prototype.toDataURL = function (type = 'image/png') { return type === 'image/jpeg' ? `data:image/jpeg;base64,${b64('/9j/', pngLength)}` : `data:image/png;base64,${b64('iVBORw0KGgo', pngLength)}`; };
  return drawn;
}
async function upload(w, bytes, name, type) {
  const input = w.document.getElementById('cp-logo-file');
  const file = new w.File([bytes], name, { type });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new w.Event('change', { bubbles: true }));
  await waitFor(() => text(w.document.getElementById('cp-logo-status')) !== 'กำลังเตรียมโลโก้…');
  await sleep(30);
  return { status: text(w.document.getElementById('cp-logo-status')), error: w.document.getElementById('cp-logo-error').hidden ? '' : text(w.document.getElementById('cp-logo-error')) };
}

test('company#boot1 nothing saved: demo header / documents unchanged; save applies; reset returns the exact default HTML', async () => {
  const h = await boot();
  const { w } = h;
  try {
    assert.deepEqual(h.errors, []);
    const before = renderDocuments(w);
    const headerBefore = header(w);
    assert.deepEqual(headerBefore, { title: 'ERP Business Platform · Local Demo', logo: './logo.png', docTitle: 'ERP Local Demo — Customer Showcase' });
    for (const [kind, html] of Object.entries(before)) {
      assert.ok(html.includes('https://erp.test/logo.png'), `${kind}: default logo file`);
      assert.doesNotMatch(html, /erp-logo=custom|สยามตัวอย่าง/, kind);
    }
    assert.match(before.taxInvoice, /บริษัทตัวอย่างสำหรับทดลองระบบ จำกัด/);
    assert.equal(text(w.document.getElementById('cp-badge')), 'ยังเป็นข้อมูลตัวอย่าง');
    assert.equal(w.localStorage.getItem(PROFILE_KEY), null);
    // the form starts from the demo profile; the placeholder tax ID may stay while unchanged
    assert.equal(form(w).querySelector('[data-cp-field="taxId"]').value, '0000000000000');
    setField(w, 'nameTh', PROFILE.nameTh);
    setField(w, 'taxId', '0105568123453');
    setField(w, 'addressTh', PROFILE.addressTh);
    clickSave(w);
    await sleep(50);
    assert.ok(w.localStorage.getItem(PROFILE_KEY), 'saved');
    assert.equal(header(w).title, PROFILE.nameTh);
    assert.match(renderDocuments(w).taxInvoice, /บริษัท สยามตัวอย่าง จำกัด \(สาขาที่ 00001\)/);
    assert.ok(h.messages.some(m => /บันทึกข้อมูลบริษัทและโลโก้แล้ว.*success/.test(m)), h.messages.join('\n'));
    // "กลับไปใช้ข้อมูลตัวอย่าง" → keys gone, every document byte-identical to before, header back
    const resetButton = form(w).querySelector('[data-cp-action="reset-all"]');
    assert.equal(resetButton.hidden, false);
    resetButton.click();
    await sleep(50);
    assert.equal(w.localStorage.getItem(PROFILE_KEY), null);
    assert.equal(w.localStorage.getItem(LOGO_KEY), null);
    assert.deepEqual(renderDocuments(w), before);
    assert.deepEqual(header(w), headerBefore);
    assert.equal(w.CurrentUser.tenantName, 'บริษัทตัวอย่างสำหรับทดลองระบบ');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('company#boot2 a saved profile + logo is merged at boot and every document type prints it', async () => {
  const h = await boot(seeded());
  const { w } = h;
  try {
    assert.deepEqual(h.errors, []);
    assert.equal(w.CurrentUser.companyProfile.customProfile, true);
    assert.equal(w.CurrentUser.tenantName, PROFILE.nameTh);
    const head = header(w);
    assert.equal(head.title, PROFILE.nameTh);
    assert.equal(head.docTitle, `${PROFILE.nameTh} — ERP Local Demo`);
    assert.ok(head.logo.startsWith('data:image/png;erp-logo=custom;base64,iVBORw0KGgo'));
    assert.match(text(w.document.getElementById('tenant-company-subtitle')), /^Local Demo · /);
    const docs = renderDocuments(w);
    const marked = head.logo;
    for (const [kind, html] of Object.entries(docs)) {
      assert.ok(html.includes(`src="${marked}"`), `${kind}: custom logo`);
      assert.doesNotMatch(html, /logo\.png/, `${kind}: no default logo left`);
      assert.ok(html.includes('0105568123453'), `${kind}: tax ID`);
      assert.doesNotMatch(html, /บริษัทตัวอย่างสำหรับทดลองระบบ|บริษัท ตัวอย่าง จำกัด|Example Rd|ข้อมูลตัวอย่าง —/, `${kind}: no demo company left`);
    }
    // branch code / address per document
    assert.match(docs.taxInvoice, /บริษัท สยามตัวอย่าง จำกัด \(สาขาที่ 00002\)/);
    assert.match(docs.taxInvoice, /SIAM TUAYANG CO\., LTD\. \(BRANCH 00002\)/);
    assert.match(docs.taxInvoice, /12 ถนนมิตรภาพ/);
    assert.match(docs.taxInvoice, /Tel: 02-123-4567 {3}Email: info@siamtuayang\.co\.th/);
    assert.match(docs.abbreviated, /บริษัท สยามตัวอย่าง จำกัด \(สำนักงานใหญ่\)/);
    assert.match(docs.abbreviated, /99\/9 ถนนพระราม 9/);
    assert.match(docs.receipt, /บริษัท สยามตัวอย่าง จำกัด \(สาขาที่ 00002\)/);
    assert.match(docs.quotation, /qdoc-branch-pill">สาขาที่ 00002 \(สาขาขอนแก่น\)</);
    assert.match(docs.quotation, /โทร\. 02-123-4567 · อีเมล info@siamtuayang\.co\.th/);
    assert.match(docs.quotationHead, /qdoc-branch-pill">สำนักงานใหญ่</);
    assert.match(docs.creditNote, /cn-doc-company-th">บริษัท สยามตัวอย่าง จำกัด</);
    assert.match(docs.creditNote, /เลขประจำตัวผู้เสียภาษี 0105568123453 · สำนักงานใหญ่/);
    // the receipt print window gets the "don't tint a customer logo" CSS; the page has it too
    assert.ok(w.document.getElementById('erp-custom-logo-css'));
    // toolbars: document-entry forms (app.js) and the quotation screen
    const entryLogos = [...w.document.querySelectorAll('.doc-entry-brand img')].map(img => img.getAttribute('src'));
    assert.ok(entryLogos.length >= 3 && entryLogos.every(src => src === marked), entryLogos.join(','));
    assert.ok([...w.document.querySelectorAll('.doc-entry-brand small')].every(el => text(el) === PROFILE.nameTh));
    assert.equal(w.document.querySelector('.qdoc-toolbar-brand img')?.getAttribute('src'), marked);
    assert.equal(text(w.document.getElementById('cp-badge')), 'ใช้ข้อมูลบริษัทของคุณ');
    assert.equal(form(w).querySelector('[data-cp-field="branches.khonkaen.code"]').value, '00002');
    // PDF mode uses the custom image (no fetch of logo.png)
    w.ComformDeliveryTaxDocument.loadFromInvoice(INVOICE, { b: 'khonkaen' });
    await sleep(30);
    assert.equal(w.ComformDeliveryTaxDocument.getState().company.companyNameTh, 'บริษัท สยามตัวอย่าง จำกัด (สาขาที่ 00002)');
  } finally { h.close(); }
});

test('company#boot3 settings form: inline validation, save → storage + CurrentUser + open screens; unsaved-change guard', async () => {
  const h = await boot();
  const { w } = h;
  try {
    // default โหมดง่าย: ตั้งค่าบริษัท is reachable without switching modes (ADR-020)
    w.go('saas-admin');
    await sleep(60);
    assert.ok(w.document.getElementById('panel-saas-admin').classList.contains('active'));
    setField(w, 'nameTh', '');
    setField(w, 'taxId', '0105568123454');
    setField(w, 'email', 'info@');
    setField(w, 'branches.khonkaen.code', '1');
    const errorOf = field => { const el = form(w).querySelector(`[data-cp-field="${field}"]`); const box = w.document.getElementById(`${el.id}-error`); return { invalid: el.getAttribute('aria-invalid') === 'true', message: box.hidden ? '' : text(box) }; };
    assert.match(errorOf('nameTh').message, /กรุณากรอกชื่อบริษัท/);
    assert.match(errorOf('taxId').message, /เลขตรวจสอบ/);
    assert.equal(errorOf('taxId').invalid, true);
    assert.match(errorOf('email').message, /อีเมล/);
    assert.match(errorOf('branches.khonkaen.code').message, /5 หลัก/);
    clickSave(w);
    await sleep(30);
    assert.equal(w.localStorage.getItem(PROFILE_KEY), null, 'invalid → nothing saved');
    assert.equal(w.document.activeElement?.dataset?.cpField, 'nameTh', 'focus on the first invalid field');
    assert.match(text(w.document.getElementById('cp-save-state')), /ยังบันทึกไม่ได้/);
    // the live preview follows the typing before any save
    setField(w, 'nameTh', 'บริษัท พรีวิว จำกัด');
    await sleep(120);
    assert.match(text(w.document.getElementById('cp-preview')), /บริษัท พรีวิว จำกัด \(สำนักงานใหญ่\)/);
    assert.equal(header(w).title, 'ERP Business Platform · Local Demo', 'not applied before save');
    // leaving with unsaved edits asks; OK returns to the form
    let asked = '';
    w.confirm = message => { asked = message; return true; };
    w.go('dashboard');
    await sleep(120);
    assert.match(asked, /ยังไม่ได้บันทึก/);
    assert.ok(w.document.getElementById('panel-saas-admin').classList.contains('active'));
    // valid values → saved and applied everywhere
    setField(w, 'nameTh', PROFILE.nameTh);
    setField(w, 'nameEn', PROFILE.nameEn);
    setField(w, 'taxId', '0-1055-68123-45-3');
    setField(w, 'email', PROFILE.email);
    setField(w, 'website', PROFILE.website);
    setField(w, 'phone', PROFILE.phone);
    setField(w, 'addressTh', PROFILE.addressTh);
    setField(w, 'branches.khonkaen.code', '00002');
    setField(w, 'branches.khonkaen.label', 'สาขาขอนแก่น');
    w.ComformReceiptDocument.loadFromReceipt(RECEIPT, { b: 'khonkaen' });
    let changed = 0;
    w.addEventListener('erp:company-profile-changed', () => { changed += 1; });
    clickSave(w);
    await sleep(50);
    const stored = JSON.parse(w.localStorage.getItem(PROFILE_KEY));
    assert.equal(stored.taxId, '0105568123453');
    assert.equal(stored.branches.khonkaen.code, '00002');
    assert.equal(changed, 1);
    assert.equal(w.CurrentUser.companyProfile.custom.nameEn, PROFILE.nameEn);
    assert.equal(w.ComformReceiptDocument.getState().company.companyNameTh, 'บริษัท สยามตัวอย่าง จำกัด (สาขาที่ 00002)', 'open receipt re-derived');
    assert.match(text(w.document.querySelector('#receipt-document-app .rcp-company-mini')), /สยามตัวอย่าง/);
    assert.equal(text(w.document.getElementById('cp-save-state')), 'บันทึกแล้ว');
    // nothing dirty any more → no question when leaving
    asked = '';
    w.go('dashboard');
    await sleep(120);
    assert.equal(asked, '');
    // "ยกเลิก/คืนค่า" puts the saved values back; "Cancel" in the guard discards edits
    w.go('saas-admin');
    setField(w, 'nameTh', 'แก้แล้วไม่บันทึก');
    form(w).querySelector('[data-cp-action="revert"]').click();
    assert.equal(form(w).querySelector('[data-cp-field="nameTh"]').value, PROFILE.nameTh);
    setField(w, 'nameTh', 'แก้แล้วไม่บันทึก');
    w.confirm = () => false;
    w.go('dashboard');
    await sleep(120);
    assert.ok(w.document.getElementById('panel-dashboard').classList.contains('active'));
    assert.equal(form(w).querySelector('[data-cp-field="nameTh"]').value, PROFILE.nameTh);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('company#boot4 logo upload through the real file input: type / size rejected, downscaled PNG saved, quota error saves nothing', async () => {
  const h = await boot();
  const { w } = h;
  try {
    const drawn = stubCanvas(w);
    const png = new Uint8Array(fs.readFileSync(path.join(ROOT, 'logo.png')));
    let result = await upload(w, new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'logo.svg', 'image/svg+xml');
    assert.match(result.error, /SVG/);
    result = await upload(w, new TextEncoder().encode('<svg onload=alert(1)>'), 'renamed.png', 'image/png');
    assert.match(result.error, /ไม่ใช่รูป PNG, JPG หรือ WebP/, 'a renamed non-image is caught by its bytes');
    result = await upload(w, new Uint8Array(5 * 1024 * 1024 + 1), 'huge.png', 'image/png');
    assert.match(result.error, /5 MB/);
    assert.equal(drawn.length, 0, 'nothing rejected was ever drawn');
    result = await upload(w, png, 'my-logo.png', 'image/png');
    assert.equal(result.error, '');
    assert.match(result.status, /พร้อมใช้: 600×300 px/);
    assert.deepEqual(drawn[0], { width: 600, height: 300, canvas: [600, 300] }, '1200×600 → 600×300');
    assert.ok(w.document.getElementById('cp-logo-preview').getAttribute('src').startsWith('data:image/png;erp-logo=custom;base64,'), 'live preview');
    assert.equal(w.localStorage.getItem(LOGO_KEY), null, 'not saved before "บันทึก"');
    // the quota is full: nothing changes, a clear message
    const realSetItem = w.Storage.prototype.setItem;
    w.Storage.prototype.setItem = function (key, value) {
      if (key === LOGO_KEY) { const error = new w.DOMException('full', 'QuotaExceededError'); throw error; }
      return realSetItem.call(this, key, value);
    };
    const userBefore = JSON.stringify(w.CurrentUser);
    clickSave(w);
    await sleep(40);
    w.Storage.prototype.setItem = realSetItem;
    assert.equal(w.localStorage.getItem(LOGO_KEY), null);
    assert.equal(w.localStorage.getItem(PROFILE_KEY), null);
    assert.equal(JSON.stringify(w.CurrentUser), userBefore);
    assert.match(text(w.document.getElementById('cp-save-state')), /พื้นที่จัดเก็บของเบราว์เซอร์เต็ม/);
    assert.ok(h.messages.some(m => /พื้นที่จัดเก็บของเบราว์เซอร์เต็ม.*error/.test(m)));
    // with room: saved, applied to header and documents
    clickSave(w);
    await sleep(40);
    const stored = JSON.parse(w.localStorage.getItem(LOGO_KEY));
    assert.deepEqual([stored.width, stored.height, stored.mime], [600, 300, 'image/png']);
    assert.ok(stored.dataUrl.startsWith('data:image/png;base64,iVBORw0KGgo') && stored.dataUrl.length <= 300000);
    assert.ok(header(w).logo.startsWith('data:image/png;erp-logo=custom;'));
    assert.ok(renderDocuments(w).receipt.includes(header(w).logo));
    // "ใช้โลโก้เดิม" + save → the default logo file again
    form(w).querySelector('[data-cp-action="default-logo"]').click();
    clickSave(w);
    await sleep(40);
    assert.equal(w.localStorage.getItem(LOGO_KEY), null);
    assert.equal(header(w).logo, './logo.png');
    assert.ok(renderDocuments(w).taxInvoice.includes('https://erp.test/logo.png'));
  } finally { h.close(); }
});

test('company#boot5 JSON backup carries the profile + logo; restore applies it; an old backup leaves it untouched; rollback keeps the logo', async () => {
  let exported;
  {
    const h = await boot(seeded());
    const { w } = h;
    try {
      const master = w.testApp.collectLocalMasterBackup();
      assert.deepEqual(JSON.parse(JSON.stringify(master.companyProfile)), { schemaVersion: 1, profile: PROFILE, logo: LOGO });
      const payload = await w.ERPBackup.portable({ meta: { app: 'comform-esan', backupType: 'all' }, data: {}, masterData: master });
      exported = JSON.parse(JSON.stringify(payload));
      assert.equal((await w.ERPBackup.verifyPortable(exported)).verified, true);
      // tampering with it is refused before anything is written
      const tampered = JSON.parse(JSON.stringify(exported));
      tampered.masterData.companyProfile.logo.dataUrl = 'data:image/svg+xml;base64,PHN2Zz4=';
      assert.throws(() => w.ERPBackup.validate(tampered), /ข้อมูลบริษัท\/โลโก้ใน Backup ไม่ถูกต้อง/);
      // raw-storage snapshots (local auto-backups) do not copy the logo; an in-page rollback restores it
      const before = w.ERPBackup.capture();
      assert.ok(!('comform_company_logo_v1' in before) && 'comform_company_profile_v1' in before);
      assert.doesNotMatch(JSON.stringify(before), /iVBORw0KGgo/);
      w.localStorage.removeItem(LOGO_KEY);
      w.ERPBackup.restore(before);
      assert.equal(w.localStorage.getItem(LOGO_KEY), JSON.stringify(LOGO));
      // demo reset keeps the profile and logo (settings, not sample data)
      const reset = await w.ERPDemoSeed.reset({ confirm: () => true });
      assert.equal(reset.status, 'reset');
      assert.ok(!reset.removedKeys.includes(PROFILE_KEY) && !reset.removedKeys.includes(LOGO_KEY));
      assert.equal(w.localStorage.getItem(PROFILE_KEY), JSON.stringify(PROFILE));
      assert.equal(w.CurrentUser.companyProfile.customProfile, true);
    } finally { h.close(); }
  }
  {
    const h = await boot();
    const { w } = h;
    try {
      // an old backup (no companyProfile) restores fine and leaves the current (default) profile alone
      w.testApp.restoreLocalMasterBackup({ contacts: [], settings: {} }, { replace: true });
      assert.equal(w.localStorage.getItem(PROFILE_KEY), null);
      assert.equal(header(w).title, 'ERP Business Platform · Local Demo');
      // the new backup applies the profile + logo (one transaction with the master data)
      w.ERPBackup.validate(exported);
      w.testApp.restoreLocalMasterBackup(exported.masterData, { replace: false });
      await sleep(30);
      assert.equal(w.localStorage.getItem(PROFILE_KEY), JSON.stringify(PROFILE));
      assert.equal(w.localStorage.getItem(LOGO_KEY), JSON.stringify(LOGO));
      assert.equal(header(w).title, PROFILE.nameTh);
      assert.match(renderDocuments(w).taxInvoice, /สาขาที่ 00002/);
      assert.equal(form(w).querySelector('[data-cp-field="nameTh"]').value, PROFILE.nameTh, 'the form follows a restore');
      // an old backup restored over a saved profile leaves it untouched too
      w.testApp.restoreLocalMasterBackup({ contacts: [] }, { replace: true });
      assert.equal(w.localStorage.getItem(PROFILE_KEY), JSON.stringify(PROFILE));
      assert.deepEqual(h.errors, []);
    } finally { h.close(); }
  }
});

test('company#boot6 hostile company values render inert in header, documents, toolbars and the preview', async () => {
  const hostile = {
    ...PROFILE,
    nameTh: '<img src=x onerror="window.__xss=1">บริษัท',
    nameEn: '"><script>window.__xss=2</script>',
    addressTh: "<svg onload=window.__xss=3>' \" &",
    phone: '02<b>1',
    branches: { ubon: { code: '00000', label: '<iframe src=javascript:window.__xss=4>', addressTh: '' }, khonkaen: { code: '00001', label: '', addressTh: '' } }
  };
  const h = await boot(seeded(hostile, null));
  const { w } = h;
  try {
    assert.equal(w.CurrentUser.companyProfile.customProfile, true, 'stored hostile text is still valid text');
    assert.equal(text(w.document.getElementById('tenant-company-title')), hostile.nameTh);
    const box = w.document.createElement('div');
    box.innerHTML = Object.values(renderDocuments(w)).join('') + w.document.getElementById('cp-preview').innerHTML + w.document.querySelector('.doc-entry-toolbar').outerHTML + w.document.querySelector('.comform-topbar').outerHTML;
    assert.equal(box.querySelectorAll('img[src="x"], script, svg[onload], iframe').length, 0);
    assert.ok(box.textContent.includes('02<b>1'));
    assert.ok(box.textContent.includes('<img src=x onerror="window.__xss=1">บริษัท'));
    w.document.body.appendChild(box);
    await sleep(30);
    assert.equal(w.__xss, undefined);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('company#boot7 โหมดง่าย (default): the form is reachable from the sidebar, the header name and the Demo menu', async () => {
  const h = await boot();
  const { w } = h;
  const d = w.document;
  try {
    assert.ok(await waitFor(() => d.getElementById('pe-mode-toggle') && w.ERPUiMenu?.getMenu?.('erp-demo')));
    assert.ok(d.body.classList.contains('erp-simple-mode'), 'default is โหมดง่าย');
    const active = () => d.querySelector('.panel.active')?.id;
    // sidebar: ตั้งค่า › ตั้งค่าบริษัท is visible and opens the page (not bounced to งานของฉัน)
    const nav = d.querySelector('.sidebar .nav-item[data-pe-panel="saas-admin"]');
    assert.ok(nav && !nav.hidden && !nav.dataset.peAdvanced, 'sidebar entry visible in โหมดง่าย');
    assert.equal(nav.closest('.nav-group')?.hidden, false);
    // jsdom runs no inline handlers ('outside-only'): run the entry's own onclick as the browser would.
    w.__cpNav = nav;
    w.eval(`(function () { ${nav.getAttribute('onclick')} }).call(window.__cpNav)`);
    await sleep(120); // past erp-product-experience's 30 ms "leave a hidden screen" check
    assert.equal(nav.classList.contains('active'), true);
    assert.equal(active(), 'panel-saas-admin');
    assert.ok(d.getElementById('company-profile-form'));
    // the SaaS / branch add-on card stays โหมดขั้นสูง-only (CSS in erp-company-profile.css)
    assert.match(fs.readFileSync(path.join(ROOT, 'erp-company-profile.css'), 'utf8'), /body\.erp-simple-mode #panel-saas-admin > \.card:not\(#company-profile-card\)\{display:none\}/);
    // header company name: a button with a tooltip that opens the form (click and keyboard)
    w.go('dashboard');
    await sleep(120);
    const name = d.querySelector('.comform-topbar .company-title-wrap');
    assert.equal(name.getAttribute('role'), 'button');
    assert.equal(name.title, 'แก้ไขข้อมูลบริษัทและโลโก้');
    assert.equal(name.tabIndex, 0);
    name.click();
    await sleep(120);
    assert.equal(active(), 'panel-saas-admin');
    assert.equal(d.activeElement?.dataset?.cpField, 'nameTh');
    w.go('dashboard');
    await sleep(120);
    name.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(120);
    assert.equal(active(), 'panel-saas-admin');
    // ⚙ Demo menu item (ADR-015 registration API)
    w.go('dashboard');
    await sleep(120);
    assert.ok(w.ERPDemoMenu.has('company-profile'));
    const item = d.getElementById('local-demo-company-btn');
    assert.ok(item && /ข้อมูลบริษัทและโลโก้/.test(text(item)));
    item.click();
    await sleep(150);
    assert.equal(active(), 'panel-saas-admin');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});
