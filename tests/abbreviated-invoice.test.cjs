// Abbreviated tax invoice (ใบกำกับภาษีอย่างย่อ — Revenue Code §86/6) coverage:
//   * shared-core rules: form normalization (legacy records = full), walk-in
//     customer fallback, §86/10 "credit note needs a buyer" detection
//   * finance core: abbreviated invoices must be VAT-inclusive; the tax invoice
//     form is part of the financial fingerprint; legacy records stay editable
//   * credit note validation for walk-in abbreviated invoices
//   * printed document: §86/6 contents, optional buyer, escaping, and full-form
//     output unchanged for legacy / explicit-full records
//   * jsdom flows: selector + VAT lock/restore, save with empty buyer, list
//     badge, edit restore, reset, credit note (buyer required) and receipt
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { boot } = require('./dom-helper.cjs');

const ROOT = path.resolve(__dirname, '..');
const imp = file => import(pathToFileURL(path.join(ROOT, file)).href);
const GENERAL = 'ลูกค้าทั่วไป / เงินสด';

// A saved walk-in abbreviated invoice: 2 × 535 VAT-inclusive = 1,000 + 70 VAT.
const abbrInvoice = (over = {}) => ({ id: 501, no: 'INV-AB-1', branch: 'ubon', date: '2026-09-05', taxInvoiceForm: 'abbreviated', customer: GENERAL, customerAddress: '', customerTaxId: '', salesPerson: 'แคชเชียร์', items: [{ product: 'สินค้าหน้าร้าน', productCode: '', qty: 2, unit: 'ชิ้น', priceUnit: 535, saleTotal: 1070, costTotal: 0 }], itemSaleTotal: 1070, subtotal: 1000, vatAmt: 70, total: 1070, useVat: 0, vatMode: 'extract', paymentManaged: true, ...over });
// A pre-feature record: no taxInvoiceForm field at all.
const legacyInvoice = (over = {}) => ({ id: 601, no: 'INV-OLD-1', branch: 'ubon', date: '2026-09-04', customer: 'บริษัท ลูกค้าเดิม จำกัด', customerAddress: '9 ถนนเดิม', customerTaxId: '0105555555555', salesPerson: 'ขายเดิม', items: [{ product: 'สินค้าเดิม', productCode: 'OLD-1', qty: 1, unit: 'ชิ้น', priceUnit: 1000, saleTotal: 1000, costTotal: 0 }], itemSaleTotal: 1000, subtotal: 1000, vatAmt: 70, total: 1070, useVat: 1, vatMode: 'add', paymentManaged: true, ...over });
const cnDraft = (over = {}) => ({ no: 'CN690901', date: '2026-09-10', branch: 'ubon', customer: '', reasonCode: 'price_overcharge', reasonText: '', lines: [{ invoiceId: 501, invoiceNo: 'INV-AB-1', invoiceBranch: 'ubon', differenceAmount: 100 }], ...over });
function fire(w, el, type = 'change') { el.dispatchEvent(new w.Event(type, { bubbles: true })); }
async function waitFor(check, tries = 60) { for (let i = 0; i < tries && !check(); i++) await new Promise(r => setTimeout(r, 25)); return check(); }

// ============================================================ shared core
test('shared core: tax invoice form defaults to full for legacy / unknown values', async () => {
  const s = await imp('erp-shared-core.js');
  assert.equal(s.TAX_INVOICE_FORM_FULL, 'full');
  assert.equal(s.TAX_INVOICE_FORM_ABBREVIATED, 'abbreviated');
  for (const value of [undefined, null, '', 'full', 'FULL', 'Abbreviated', 'short', 0, 1, {}]) assert.equal(s.normalizeTaxInvoiceForm(value), 'full', String(value));
  assert.equal(s.normalizeTaxInvoiceForm('abbreviated'), 'abbreviated');
  assert.equal(s.isAbbreviatedTaxInvoice(legacyInvoice()), false);
  assert.equal(s.isAbbreviatedTaxInvoice({ taxInvoiceForm: 'full' }), false);
  assert.equal(s.isAbbreviatedTaxInvoice(abbrInvoice()), true);
  assert.equal(s.isAbbreviatedTaxInvoice(null), false);
  assert.equal(s.ABBREVIATED_TAX_INVOICE_USE_VAT, 0, 'abbreviated = VAT-inclusive (useVat 0 → extract)');
  assert.equal(s.calculateVatSummary(1070, s.ABBREVIATED_TAX_INVOICE_USE_VAT).vatMode, 'extract');
});

test('shared core: walk-in customer fallback and §86/10 buyer detection', async () => {
  const s = await imp('erp-shared-core.js');
  assert.equal(s.GENERAL_CUSTOMER_NAME, GENERAL);
  assert.equal(s.invoiceCustomerName('abbreviated', ''), GENERAL);
  assert.equal(s.invoiceCustomerName('abbreviated', '   '), GENERAL);
  assert.equal(s.invoiceCustomerName('abbreviated', undefined), GENERAL);
  assert.equal(s.invoiceCustomerName('abbreviated', '  คุณสมชาย  '), 'คุณสมชาย', 'a typed buyer always wins');
  assert.equal(s.invoiceCustomerName('full', ''), '', 'full form never invents a customer (save validation rejects it)');
  assert.equal(s.invoiceCustomerName(undefined, ''), '');
  assert.equal(s.invoiceCustomerName('full', 'บริษัท ก'), 'บริษัท ก');
  for (const name of ['', '  ', null, undefined, GENERAL, `  ${GENERAL} `, 'ลูกค้าทั่วไป  /  เงินสด']) assert.equal(s.isGeneralCustomerName(name), true, String(name));
  assert.equal(s.isGeneralCustomerName('ลูกค้าทั่วไป'), false);
  assert.equal(s.taxInvoiceLacksBuyer(abbrInvoice()), true);
  assert.equal(s.taxInvoiceLacksBuyer(abbrInvoice({ customer: 'คุณสมชาย' })), false, 'abbreviated invoice with a named buyer');
  assert.equal(s.taxInvoiceLacksBuyer(legacyInvoice({ customer: GENERAL })), false, 'only abbreviated invoices can lack a buyer');
});

// ============================================================ finance core
test('finance core: abbreviated invoices must be VAT-inclusive; full/legacy invoices keep every VAT mode', async () => {
  const f = await imp('erp-document-finance-core.js');
  assert.doesNotThrow(() => f.planInvoiceDocumentAction({ draft: abbrInvoice() }));
  assert.doesNotThrow(() => f.planInvoiceDocumentAction({ draft: abbrInvoice({ vatMode: undefined, useVat: 0 }) }), 'useVat 0 without vatMode = extract');
  for (const bad of [{ useVat: 1, vatMode: 'add' }, { useVat: 2, vatMode: 'none' }, { useVat: 1, vatMode: undefined }, { useVat: 2, vatMode: undefined }]) {
    assert.throws(() => f.planInvoiceDocumentAction({ draft: abbrInvoice(bad) }), err => err.code === f.FINANCE_ACTION_ERROR_CODES.VALIDATION && /มาตรา 86\/6/.test(err.message), JSON.stringify(bad));
  }
  for (const mode of [{ useVat: 1, vatMode: 'add' }, { useVat: 2, vatMode: 'none' }, { useVat: 0, vatMode: 'extract' }]) {
    assert.doesNotThrow(() => f.planInvoiceDocumentAction({ draft: legacyInvoice(mode) }));
    assert.doesNotThrow(() => f.planInvoiceDocumentAction({ draft: legacyInvoice({ ...mode, taxInvoiceForm: 'full' }) }));
  }
  const planned = f.planInvoiceDocumentAction({ draft: abbrInvoice() }).record;
  assert.equal(planned.taxInvoiceForm, 'abbreviated');
  assert.equal(planned.customer, GENERAL);
});

test('finance core: fingerprint treats legacy = full and locks the form once paid or credited', async () => {
  const f = await imp('erp-document-finance-core.js');
  const legacy = legacyInvoice();
  assert.equal(f.invoiceFinancialFingerprint(legacy), f.invoiceFinancialFingerprint({ ...legacy, taxInvoiceForm: 'full' }), 'saving an old record with the new field is not a financial change');
  // An old paid invoice re-saved from the form (which now always sends 'full') is not blocked.
  assert.doesNotThrow(() => f.planInvoiceDocumentAction({ draft: { ...legacy, taxInvoiceForm: 'full', note: 'แก้หมายเหตุ' }, original: legacy, paymentSummary: { paid: 1070, credited: 0 } }));
  const extractLegacy = legacyInvoice({ useVat: 0, vatMode: 'extract', subtotal: 1000, total: 1070, items: [{ product: 'สินค้าเดิม', qty: 1, unit: 'ชิ้น', priceUnit: 1070 }] });
  assert.throws(() => f.planInvoiceDocumentAction({ draft: { ...extractLegacy, taxInvoiceForm: 'abbreviated' }, original: extractLegacy, paymentSummary: { paid: 100, credited: 0 } }), /รับเงินจริงแล้ว/);
  assert.throws(() => f.planInvoiceDocumentAction({ draft: { ...extractLegacy, taxInvoiceForm: 'abbreviated' }, original: extractLegacy, paymentSummary: { paid: 0, credited: 10.7 } }), /ใบลดหนี้อ้างอิงแล้ว/);
  assert.doesNotThrow(() => f.planInvoiceDocumentAction({ draft: { ...extractLegacy, taxInvoiceForm: 'abbreviated' }, original: extractLegacy, paymentSummary: { paid: 0, credited: 0 } }), 'unpaid invoices may change form');
});

test('finance core: issued (printed) abbreviated invoice must match its canonical source', async () => {
  const f = await imp('erp-document-finance-core.js');
  const inv = abbrInvoice();
  assert.doesNotThrow(() => f.assertIssuedDocumentMatchesCanonical({ kind: 'invoice', draft: { ...inv }, canonical: inv }));
  assert.throws(() => f.assertIssuedDocumentMatchesCanonical({ kind: 'invoice', draft: { ...inv, customer: 'คนอื่น' }, canonical: inv }), /ชื่อลูกค้า/);
});

// ====================================================== credit note core
test('credit note: a walk-in abbreviated invoice requires the buyer name on the credit note (§86/10)', async () => {
  const c = await imp('erp-credit-note-core.js');
  const invoices = [abbrInvoice()];
  assert.equal(c.creditNoteRequiresBuyerName(invoices), true);
  assert.equal(c.creditNoteRequiresBuyerName([abbrInvoice({ customer: 'คุณสมชาย' })]), false);
  assert.equal(c.creditNoteRequiresBuyerName([legacyInvoice()]), false);
  assert.equal(c.creditNoteRequiresBuyerName(null), false);
  for (const customer of ['', '   ', GENERAL]) {
    const v = c.validateCreditNote(cnDraft({ customer }), invoices, []);
    assert.equal(v.ok, false, `customer=${JSON.stringify(customer)}`);
    assert.ok(v.errors.some(e => /ใบกำกับภาษีอย่างย่อที่อ้างอิงไม่มีชื่อผู้ซื้อ/.test(e) && /86\/10/.test(e) && /กรุณากรอกชื่อผู้ซื้อ/.test(e)), v.errors.join('\n'));
  }
  const named = c.validateCreditNote(cnDraft({ customer: 'คุณสมชาย ใจดี' }), invoices, []);
  assert.equal(named.ok, true, named.errors.join('\n'));
  assert.ok(named.warnings.some(w => /ที่อยู่ผู้ซื้อ/.test(w)), 'missing buyer address is a warning, not an error');
  const withAddress = c.validateCreditNote(cnDraft({ customer: 'คุณสมชาย ใจดี', customerAddress: '1 ถนนสุขุมวิท' }), invoices, []);
  assert.equal(withAddress.ok, true);
  assert.equal(withAddress.warnings.some(w => /ที่อยู่ผู้ซื้อ/.test(w)), false);
  // Money is still computed from the VAT-inclusive invoice.
  assert.deepEqual([withAddress.calculation.subtotal, withAddress.calculation.vatAmt, withAddress.calculation.total], [93.46, 6.54, 100]);
  const record = c.buildCreditNoteRecord(cnDraft({ customer: 'คุณสมชาย ใจดี', customerAddress: '1 ถนนสุขุมวิท' }), invoices, []);
  assert.equal(record.customer, 'คุณสมชาย ใจดี', 'the typed buyer is stored on the credit note');
});

test('credit note: named abbreviated and full invoices keep the same-customer rule', async () => {
  const c = await imp('erp-credit-note-core.js');
  const named = [abbrInvoice({ customer: 'คุณสมชาย' })];
  assert.equal(c.validateCreditNote(cnDraft({ customer: 'คุณสมชาย' }), named, []).ok, true);
  assert.match(c.validateCreditNote(cnDraft({ customer: 'คนอื่น' }), named, []).errors.join('\n'), /ไม่ตรงกับใบกำกับภาษีที่อ้างอิง/);
  const full = [legacyInvoice({ id: 501, no: 'INV-AB-1' })];
  assert.equal(c.validateCreditNote(cnDraft({ customer: 'บริษัท ลูกค้าเดิม จำกัด' }), full, []).ok, true);
  assert.match(c.validateCreditNote(cnDraft({ customer: 'คนอื่น' }), full, []).errors.join('\n'), /ไม่ตรงกับใบกำกับภาษีที่อ้างอิง/);
  // A full invoice whose customer happens to be the general name is not "buyerless".
  assert.equal(c.creditNoteRequiresBuyerName([legacyInvoice({ customer: GENERAL })]), false);
});

// ============================================================ jsdom: print
test('print: abbreviated layout has the §86/6 contents, optional buyer and escaped text', async () => {
  const h = await boot(); const { w } = h;
  try {
    const doc = w.ComformDeliveryTaxDocument;
    const html = doc.buildInlineHtml(abbrInvoice(), { b: 'ubon' });
    for (const needle of ['ใบกำกับภาษีอย่างย่อ', 'ABBREVIATED TAX INVOICE', 'ราคารวมภาษีมูลค่าเพิ่มแล้ว', 'เลขประจำตัวผู้เสียภาษี 0000000000000', 'INV-AB-1', 'สินค้าหน้าร้าน', '1,070.00', '1,000.00', '70.00', 'หนึ่งพันเจ็ดสิบบาทถ้วน', 'data-tax-invoice-form="abbreviated"']) assert.ok(html.includes(needle), needle);
    assert.equal(html.includes(GENERAL), false, 'walk-in: no buyer block');
    assert.equal(html.includes('ใบส่งสินค้า/ใบกำกับภาษี'), false, 'not the full-form title');
    const box = w.document.createElement('div'); box.innerHTML = html;
    assert.equal(box.querySelectorAll('article.dtd-document-page').length, 1);
    assert.match(box.querySelector('.dtd-abbr-meta').textContent, /05-09-2569/, 'issue date printed');
    // Seller name is the same one the full-form document prints for that branch.
    const fullBox = w.document.createElement('div'); fullBox.innerHTML = doc.buildInlineHtml(abbrInvoice({ taxInvoiceForm: 'full' }), { b: 'ubon' });
    const seller = box.querySelector('.dtd-abbr-seller b').textContent.trim();
    assert.ok(seller.length > 0);
    assert.equal(seller, fullBox.querySelector('.dtd-doc-company-th').textContent.trim());
    const buyer = doc.buildInlineHtml(abbrInvoice({ customer: 'คุณสมชาย', customerTaxId: '1234567890123' }), { b: 'ubon' });
    assert.ok(buyer.includes('คุณสมชาย') && buyer.includes('1234567890123'), 'a named buyer is printed');
    const xss = doc.buildInlineHtml(abbrInvoice({ customer: '<img src=x onerror=alert(1)>', note: '<script>x</script>', items: [{ product: '<b>bold</b>', productCode: '"><svg>', unit: '<i>', qty: 1, priceUnit: 107 }] }), { b: 'ubon' });
    for (const raw of ['<img src=x', '<script>x', '<b>bold', '"><svg>', '<i>']) assert.equal(xss.includes(raw), false, raw);
    assert.ok(xss.includes('&lt;img src=x onerror=alert(1)&gt;'));
    // Long item lists paginate; only the last page carries the total.
    const many = Array.from({ length: 20 }, (_, i) => ({ product: `สินค้า ${i + 1}`, qty: 1, unit: 'ชิ้น', priceUnit: 107 }));
    const paged = w.document.createElement('div'); paged.innerHTML = doc.buildInlineHtml(abbrInvoice({ items: many, total: 2140, subtotal: 2000, vatAmt: 140 }), { b: 'ubon' });
    const pages = paged.querySelectorAll('article.dtd-abbr-page');
    assert.equal(pages.length, 2);
    assert.equal(pages[0].querySelector('.dtd-abbr-total'), null);
    assert.match(pages[1].querySelector('.dtd-abbr-total').textContent, /2,140\.00/);
    assert.equal(paged.querySelectorAll('.dtd-abbr-items tbody tr').length, 20);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('print: full-form output is unchanged for legacy records and explicit full', async () => {
  const h = await boot(); const { w } = h;
  try {
    const doc = w.ComformDeliveryTaxDocument;
    const legacy = doc.buildInlineHtml(legacyInvoice(), { b: 'ubon' });
    assert.equal(doc.buildInlineHtml(legacyInvoice({ taxInvoiceForm: 'full' }), { b: 'ubon' }), legacy);
    assert.equal(doc.buildInlineHtml(legacyInvoice({ taxInvoiceForm: 'unknown' }), { b: 'ubon' }), legacy);
    assert.ok(legacy.includes('ใบส่งสินค้า/ใบกำกับภาษี'));
    assert.ok(legacy.includes('บริษัท ลูกค้าเดิม จำกัด'));
    for (const needle of ['ใบกำกับภาษีอย่างย่อ', 'dtd-abbr', '<style>']) assert.equal(legacy.includes(needle), false, needle);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

// ============================================================ jsdom: form
test('UI: selector locks VAT to inclusive, restores the previous VAT choice and makes the buyer optional', async () => {
  const h = await boot(); const { w, set } = h;
  try {
    const $ = id => w.document.getElementById(id);
    w.go('invoice-form', null); w.resetF('invoice');
    assert.equal($('i-tax-form').value, 'full', 'default is the full form');
    assert.equal($('i-tax-form-hint').style.display, 'none');
    assert.equal($('i-cust-required').textContent, '*');
    set('i-vat', '1'); fire(w, $('i-vat'));
    set('i-tax-form', 'abbreviated'); fire(w, $('i-tax-form'));
    assert.equal($('i-vat').value, '0', 'locked to VAT-inclusive');
    assert.equal($('i-vat').disabled, true);
    assert.equal($('i-tax-form-hint').style.display, '', 'retail-only §86/6 hint visible');
    assert.match($('i-tax-form-hint').textContent, /ขายปลีก/);
    assert.equal($('i-cust-required').textContent, '(ไม่บังคับ)');
    assert.match($('i-cust').placeholder, /ลูกค้าทั่วไป/);
    set('i-tax-form', 'full'); fire(w, $('i-tax-form'));
    assert.equal($('i-vat').value, '1', 'previous VAT choice restored');
    assert.equal($('i-vat').disabled, false);
    assert.equal($('i-tax-form-hint').style.display, 'none');
    assert.equal($('i-cust-required').textContent, '*');
    assert.equal($('i-cust').placeholder, 'เลือกหรือพิมพ์ชื่อลูกค้า');
    // Selecting abbreviated twice does not overwrite the remembered choice with the locked value.
    set('i-vat', '2'); fire(w, $('i-vat'));
    set('i-tax-form', 'abbreviated'); fire(w, $('i-tax-form'));
    set('i-tax-form', 'abbreviated'); fire(w, $('i-tax-form'));
    set('i-tax-form', 'full'); fire(w, $('i-tax-form'));
    assert.equal($('i-vat').value, '2');
    // A source document priced VAT-exclusive (e.g. a production order) switches the form back to full.
    set('i-tax-form', 'abbreviated'); fire(w, $('i-tax-form'));
    assert.equal(w.ERPSalesFormAssist.enforceInvoiceTaxForm(), 'abbreviated', 'VAT-inclusive source keeps abbreviated');
    $('i-vat').value = '1';
    assert.equal(w.ERPSalesFormAssist.enforceInvoiceTaxForm(), 'full');
    assert.equal($('i-tax-form').value, 'full');
    assert.equal($('i-vat').value, '1', 'the source VAT mode is kept');
    assert.equal($('i-vat').disabled, false);
    assert.ok(h.messages.some(m => /เปลี่ยนกลับเป็นใบกำกับภาษีเต็มรูป/.test(m)));
    // resetF always returns to the full form and unlocks VAT.
    set('i-tax-form', 'abbreviated'); fire(w, $('i-tax-form'));
    w.resetF('invoice');
    assert.equal($('i-tax-form').value, 'full');
    assert.equal($('i-vat').value, '0');
    assert.equal($('i-vat').disabled, false);
    assert.equal($('i-vat').dataset.taxFormLocked, undefined);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('UI: save a walk-in abbreviated invoice, list badge, edit restore, credit note needs a buyer, receipt settles it', async () => {
  const h = await boot(); const { w, set } = h;
  try {
    const $ = id => w.document.getElementById(id);
    await waitFor(() => w.saveInvoice?.__stockGuard);
    w.go('invoice-form', null); w.resetF('invoice'); w.selBr('i', 'ubon');
    set('i-no', 'INV-AB-UI'); set('i-date', '2026-09-05'); set('i-sales', 'แคชเชียร์');
    set('i-vat', '1'); fire(w, $('i-vat'));
    set('i-tax-form', 'abbreviated'); fire(w, $('i-tax-form'));
    $('i-items-body').innerHTML = '';
    w.addIItem({ product: 'สินค้าหน้าร้าน', qty: 2, unit: 'ชิ้น', priceUnit: 535 });
    assert.equal($('i-grand-total').value, '1,070.00');
    assert.equal($('i-st').value, '1,000.00');
    assert.equal($('i-cust').value, '', 'buyer left empty');
    await w.saveInvoice();
    const data = w.ERPIntegrity.business();
    assert.equal(data.invoices.length, 1, h.messages.join('\n'));
    const inv = data.invoices[0];
    assert.equal(inv.taxInvoiceForm, 'abbreviated');
    assert.equal(inv.customer, GENERAL);
    assert.deepEqual([inv.useVat, inv.vatMode, inv.subtotal, inv.vatAmt, inv.total], [0, 'extract', 1000, 70, 1070]);
    assert.equal(w.contactMasterRows().some(r => r.name === GENERAL), false, 'the walk-in placeholder is not added to Customer Master');
    assert.equal($('i-tax-form').value, 'full', 'form resets to full after save');
    assert.equal($('i-vat').disabled, false);

    // List badge (and none on a legacy record).
    const d = w.loadFor('ubon', 2026, 8); d.invoices.push(legacyInvoice()); w.saveFor('ubon', 2026, 8, d);
    w.onYearChange(false); set('il-year', '2026'); w.go('invoice-list', null); w.renderIList();
    const rows = [...$('itbl').querySelectorAll('tr')];
    const abbrRow = rows.find(r => r.textContent.includes('INV-AB-UI')), oldRow = rows.find(r => r.textContent.includes('INV-OLD-1'));
    assert.ok(abbrRow && oldRow);
    assert.match(abbrRow.textContent, /อย่างย่อ/);
    assert.doesNotMatch(oldRow.textContent, /อย่างย่อ/);

    // Edit restores the selector, the VAT lock and an empty buyer field.
    w.editInvoice('ubon', 2026, 8, inv.id);
    assert.equal($('i-tax-form').value, 'abbreviated');
    assert.equal($('i-vat').value, '0');
    assert.equal($('i-vat').disabled, true);
    assert.equal($('i-cust').value, '', 'walk-in placeholder is shown as an empty optional field');
    assert.equal($('i-tax-form-hint').style.display, '');
    set('i-note', 'แก้หมายเหตุ');
    await w.LocalDemoHealth.whenIdle('saveInvoice'); // r5fix#5: the single-flight guard drops a 2nd save within 250 ms of the 1st (double-click protection) — wait for it instead of sleeping
    await w.saveInvoice();
    const edited = w.ERPIntegrity.business().invoices.find(x => x.no === 'INV-AB-UI');
    assert.deepEqual([edited.taxInvoiceForm, edited.customer, edited.total, edited.note], ['abbreviated', GENERAL, 1070, 'แก้หมายเหตุ'], h.messages.join('\n'));
    // Editing a legacy record shows the full form and does not lock VAT.
    w.editInvoice('ubon', 2026, 8, 601);
    assert.equal($('i-tax-form').value, 'full');
    assert.equal($('i-vat').value, '1');
    assert.equal($('i-vat').disabled, false);
    assert.equal($('i-cust').value, 'บริษัท ลูกค้าเดิม จำกัด');
    w.cancelDocumentEdit('invoice');

    // Credit note: the buyer name is editable and required.
    w.go('credit-note-form', null);
    $('cn-br-ub').click();
    set('cn-inv-filter-year', '2026'); fire(w, $('cn-inv-filter-year'), 'input');
    const option = [...$('cn-inv-ref').options].find(o => o.textContent.includes('INV-AB-UI'));
    assert.ok(option, 'abbreviated invoice is offered for a credit note');
    $('cn-inv-ref').value = option.value;
    w.document.querySelector('[data-cn-action="add-invoice"]').click();
    assert.equal($('cn-cust').value, '', 'no walk-in placeholder is copied onto the credit note');
    assert.equal($('cn-cust').readOnly, false);
    assert.match($('cn-cust').placeholder, /86\/10/);
    const correct = w.document.querySelector('[data-cn-line-field="correct"]');
    correct.value = '856'; fire(w, correct, 'input');
    set('cn-date', '2026-09-12');
    set('cn-reason', 'price_overcharge'); fire(w, $('cn-reason'));
    assert.equal(await w.ERPCreditNotes.save(), false);
    assert.match($('cn-feedback').textContent, /ไม่มีชื่อผู้ซื้อ/);
    assert.equal(w.ERPCreditNotes.allCreditNotes().length, 0);
    set('cn-cust', 'คุณสมชาย ใจดี'); set('cn-address', '1 ถนนสุขุมวิท');
    assert.notEqual(await w.ERPCreditNotes.save(), false, $('cn-feedback').textContent);
    await waitFor(() => w.ERPCreditNotes.allCreditNotes().length === 1);
    const cn = w.ERPCreditNotes.allCreditNotes()[0];
    assert.deepEqual([cn.customer, cn.total], ['คุณสมชาย ใจดี', 214]);
    const invNow = w.ERPIntegrity.business().invoices.find(x => x.no === 'INV-AB-UI');
    assert.equal(w.ERPIntegrity.paymentSummary({ ...invNow, branch: 'ubon' }).outstanding, 856);
    assert.equal($('cn-cust').readOnly, true, 'form reset re-locks the buyer field');

    // Receipt for the remaining balance works with the walk-in customer.
    w.go('receipt-form', null); w.resetF('receipt'); w.selBr('r', 'ubon');
    const ref = $('r-inv-ref'); ref.innerHTML = `<option value='${JSON.stringify({ b: 'ubon', y: 2026, m: 8, id: invNow.id, no: invNow.no })}'>x</option>`; ref.selectedIndex = 0;
    w.fillFromInv();
    assert.equal($('r-cust').value, GENERAL);
    set('r-no', 'R-AB-1'); set('r-date', '2026-09-15');
    await w.saveReceipt();
    const after = w.ERPIntegrity.business();
    assert.equal(after.receipts.length, 1, h.messages.join('\n'));
    assert.equal(after.receipts[0].customer, GENERAL);
    const summary = w.ERPIntegrity.paymentSummary({ ...after.invoices.find(x => x.no === 'INV-AB-UI'), branch: 'ubon' });
    assert.deepEqual([summary.paid, summary.credited, summary.outstanding, summary.status], [856, 214, 0, 'paid']);
    assert.equal(w.contactMasterRows().some(r => r.name === GENERAL), false);
    // Dashboard / analytics still render with the walk-in customer bucket.
    assert.doesNotThrow(() => w.renderDash());
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

// ============================================================ review fixes
test('review#1: switching the tax invoice form converts typed prices so the invoice total is unchanged', async () => {
  const h = await boot(); const { w, set } = h;
  try {
    const $ = id => w.document.getElementById(id);
    const priceOf = row => row.querySelector('[data-field="priceUnit"]');
    w.go('invoice-form', null); w.resetF('invoice'); w.selBr('i', 'ubon');
    set('i-vat', '1'); fire(w, $('i-vat'));
    $('i-items-body').innerHTML = '';
    w.addIItem({ product: 'สินค้าพิมพ์เอง', qty: 1, unit: 'ชิ้น', priceUnit: 1000 });
    const row = $('i-items-body').lastElementChild;
    assert.equal($('i-grand-total').value, '1,070.00');
    set('i-tax-form', 'abbreviated'); fire(w, $('i-tax-form'));
    assert.equal(priceOf(row).value, '1070.00', 'typed pre-VAT price converted to VAT-inclusive');
    assert.equal($('i-grand-total').value, '1,070.00', 'total unchanged');
    assert.equal($('i-vat-amt').value, '70.00');
    assert.ok(h.messages.some(m => /แปลงราคาต่อหน่วย.*รวม VAT 7% แล้ว/.test(m) && /ยอดรวมทั้งสิ้นคงเดิม/.test(m)), h.messages.join('\n'));
    // Round trip restores the exact typed value (no drift), twice.
    for (let i = 0; i < 2; i++) {
      set('i-tax-form', 'full'); fire(w, $('i-tax-form'));
      assert.equal($('i-vat').value, '1');
      assert.equal(priceOf(row).value, '1000');
      assert.equal($('i-grand-total').value, '1,070.00');
      set('i-tax-form', 'abbreviated'); fire(w, $('i-tax-form'));
      assert.equal(priceOf(row).value, '1070.00');
      assert.equal($('i-grand-total').value, '1,070.00');
    }
    // A price the user edits after the switch is converted back with ÷1.07.
    priceOf(row).value = '535'; fire(w, priceOf(row), 'input');
    set('i-tax-form', 'full'); fire(w, $('i-tax-form'));
    assert.equal(priceOf(row).value, '500.00');
    assert.equal($('i-grand-total').value, '535.00');

    // Satang rounding cannot always keep the total: the message says so.
    w.resetF('invoice'); w.selBr('i', 'ubon'); h.messages.length = 0;
    set('i-vat', '1'); fire(w, $('i-vat'));
    $('i-items-body').innerHTML = '';
    w.addIItem({ product: 'สินค้าปัดเศษ', qty: 3, unit: 'ชิ้น', priceUnit: 333.33 });
    const row2 = $('i-items-body').lastElementChild;
    assert.equal($('i-grand-total').value, '1,069.99');
    set('i-tax-form', 'abbreviated'); fire(w, $('i-tax-form'));
    assert.equal(priceOf(row2).value, '356.66');
    assert.equal($('i-grand-total').value, '1,069.98');
    assert.ok(h.messages.some(m => /1,069\.99 เป็น 1,069\.98/.test(m) && /ปัดราคาต่อหน่วย/.test(m)), h.messages.join('\n'));
    set('i-tax-form', 'full'); fire(w, $('i-tax-form'));
    assert.equal(priceOf(row2).value, '333.33', 'back to the exact typed price');
    assert.equal($('i-grand-total').value, '1,069.99');

    // Non-VAT → abbreviated keeps the number and the total but warns that VAT is now inside it.
    w.resetF('invoice'); w.selBr('i', 'ubon'); h.messages.length = 0;
    set('i-vat', '2'); fire(w, $('i-vat'));
    $('i-items-body').innerHTML = '';
    w.addIItem({ product: 'สินค้าไม่มี VAT', qty: 1, unit: 'ชิ้น', priceUnit: 500 });
    set('i-tax-form', 'abbreviated'); fire(w, $('i-tax-form'));
    assert.equal($('i-items-body').lastElementChild.querySelector('[data-field="priceUnit"]').value, '500');
    assert.equal($('i-grand-total').value, '500.00');
    assert.ok(h.messages.some(m => /ไม่มี VAT/.test(m) && /รวม VAT 7% แล้ว/.test(m)), h.messages.join('\n'));
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('review#2: an abbreviated record that is not VAT-inclusive prints, edits and imports as full form', async () => {
  const s = await imp('erp-shared-core.js');
  const f = await imp('erp-document-finance-core.js');
  // Books: 1,000 + 70 VAT = 1,070 (VAT added) but flagged abbreviated (bypassed the planner).
  const bad = abbrInvoice({ useVat: 1, vatMode: 'add', items: [{ product: 'สินค้าหน้าร้าน', qty: 1, unit: 'ชิ้น', priceUnit: 1000, saleTotal: 1000, costTotal: 0 }], itemSaleTotal: 1000, subtotal: 1000, vatAmt: 70, total: 1070 });
  const h = await boot(); const { w } = h;
  try {
    const $ = id => w.document.getElementById(id);
    const html = w.ComformDeliveryTaxDocument.buildInlineHtml(bad, { b: 'ubon' });
    assert.equal(html.includes('ใบกำกับภาษีอย่างย่อ'), false, 'not printed as abbreviated');
    assert.ok(html.includes('ใบส่งสินค้า/ใบกำกับภาษี'), 'full-form layout');
    assert.ok(html.includes('1,070.00') && html.includes('70.00'), 'stored totals printed');
    assert.equal(html.includes('65.42'), false, 'VAT is not re-read as included');
    // Edit keeps the stored VAT mode and prices.
    const d = w.loadFor('ubon', 2026, 8); d.invoices = [bad]; w.saveFor('ubon', 2026, 8, d);
    w.editInvoice('ubon', 2026, 8, bad.id);
    assert.equal($('i-tax-form').value, 'full');
    assert.equal($('i-vat').value, '1');
    assert.equal($('i-vat').disabled, false);
    assert.equal($('i-items-body').lastElementChild.querySelector('[data-field="priceUnit"]').value, '1000');
    w.calcI();
    assert.equal($('i-grand-total').value, '1,070.00');
    w.cancelDocumentEdit('invoice');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
  assert.equal(s.effectiveTaxInvoiceForm(bad), 'full');
  assert.equal(s.effectiveTaxInvoiceForm(abbrInvoice()), 'abbreviated');
  assert.equal(s.effectiveTaxInvoiceForm(legacyInvoice()), 'full');
  // Import / restore normalization: form becomes full, amounts untouched.
  const pack = f.parseFinancialDocumentPackForWrite(JSON.stringify({ invoices: [bad, abbrInvoice({ id: 502 })], issuedInvoices: [bad] }));
  assert.deepEqual(pack.invoices.map(r => r.taxInvoiceForm), ['full', 'abbreviated']);
  assert.equal(pack.issuedInvoices[0].taxInvoiceForm, 'full');
  assert.deepEqual([pack.invoices[0].total, pack.invoices[0].vatAmt, pack.invoices[0].useVat], [1070, 70, 1]);
  const same = { invoices: [abbrInvoice()] };
  assert.equal(f.normalizeInvoiceTaxFormsInPack(same), same, 'a consistent pack is returned unchanged');
  // A paid bad record can be re-saved as full (the form fix is not a financial change).
  assert.doesNotThrow(() => f.planInvoiceDocumentAction({ draft: { ...bad, taxInvoiceForm: 'full', note: 'x' }, original: bad, paymentSummary: { paid: 1070, credited: 0 } }));
});

test('review#3: one credit note cannot cover several walk-in abbreviated invoices', async () => {
  const c = await imp('erp-credit-note-core.js');
  const invoices = [abbrInvoice(), abbrInvoice({ id: 502, no: 'INV-AB-2' })];
  const draft = cnDraft({ customer: 'คุณสมชาย ใจดี', customerAddress: '1 ถนนสุขุมวิท', lines: [
    { invoiceId: 501, invoiceNo: 'INV-AB-1', invoiceBranch: 'ubon', differenceAmount: 100 },
    { invoiceId: 502, invoiceNo: 'INV-AB-2', invoiceBranch: 'ubon', differenceAmount: 100 }
  ] });
  const v = c.validateCreditNote(draft, invoices, []);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => /แยกฉบับละ 1 ใบกำกับภาษี/.test(e)), v.errors.join('\n'));
  // One walk-in invoice per credit note is still fine.
  assert.equal(c.validateCreditNote(cnDraft({ customer: 'คุณสมชาย ใจดี' }), invoices, []).ok, true);
  // Two invoices of the same named buyer keep working.
  const named = invoices.map(inv => ({ ...inv, customer: 'คุณสมชาย ใจดี' }));
  assert.equal(c.validateCreditNote(draft, named, []).ok, true, c.validateCreditNote(draft, named, []).errors.join('\n'));
});

test('review#4: a full-form invoice cannot use the walk-in placeholder as the buyer', async () => {
  const f = await imp('erp-document-finance-core.js');
  for (const customer of [GENERAL, `  ${GENERAL} `, 'ลูกค้าทั่วไป  /  เงินสด']) {
    for (const form of [{ taxInvoiceForm: 'full' }, {}]) {
      assert.throws(() => f.planInvoiceDocumentAction({ draft: legacyInvoice({ customer, ...form }) }),
        err => err.code === f.FINANCE_ACTION_ERROR_CODES.VALIDATION && /86\/4/.test(err.message) && /อย่างย่อ/.test(err.message), customer);
    }
  }
  assert.doesNotThrow(() => f.planInvoiceDocumentAction({ draft: abbrInvoice() }), 'abbreviated walk-in is fine');
  assert.doesNotThrow(() => f.planInvoiceDocumentAction({ draft: legacyInvoice({ customer: 'บริษัท ก จำกัด' }) }));
  // A legacy record that already carries the placeholder can still be re-saved (e.g. a note change on a paid invoice).
  const old = legacyInvoice({ customer: GENERAL });
  assert.doesNotThrow(() => f.planInvoiceDocumentAction({ draft: { ...old, note: 'x' }, original: old, paymentSummary: { paid: 1070, credited: 0 } }));
  // UI: typing the placeholder on a full-form invoice is rejected with the Thai message.
  const h = await boot(); const { w, set } = h;
  try {
    const $ = id => w.document.getElementById(id);
    await waitFor(() => w.saveInvoice?.__stockGuard);
    w.go('invoice-form', null); w.resetF('invoice'); w.selBr('i', 'ubon');
    set('i-no', 'INV-FULL-GEN'); set('i-date', '2026-09-05'); set('i-sales', 'ขาย'); set('i-cust', GENERAL);
    $('i-items-body').innerHTML = '';
    w.addIItem({ product: 'สินค้า', qty: 1, unit: 'ชิ้น', priceUnit: 107 });
    await w.saveInvoice();
    assert.equal(w.ERPIntegrity.business().invoices.length, 0);
    const text = `${h.messages.join('\n')}\n${$('app-toast-container')?.textContent || ''}`;
    assert.match(text, /ต้องระบุชื่อผู้ซื้อจริง/);
  } finally { h.close(); }
});

// ============================================================ fix5 (review B)
const MASTER = { id: 'DP-1', code: 'DP-1', name: 'สินค้าราคามาตรฐาน', category: 'ทดสอบ', unit: 'ชุด', flowType: 'non_inventory', fulfillmentType: 'made_to_order', defaultPrice: 1000 };
const MASTER_ROUNDING = { id: 'DP-9', code: 'DP-9', name: 'สินค้าปัดเศษ', category: 'ทดสอบ', unit: 'ชุด', flowType: 'non_inventory', fulfillmentType: 'made_to_order', defaultPrice: 333.33 };
function autofillRow(w, qty, name) {
  w.addIItem();
  const row = w.document.getElementById('i-items-body').lastElementChild;
  row.querySelector('[data-field="qty"]').value = String(qty);
  const input = row.querySelector('[data-field="product"]'); input.value = name; fire(w, input);
  return row;
}

test('fix5#1: a walk-in abbreviated invoice cannot be re-saved as a full tax invoice with the placeholder buyer', async () => {
  const f = await imp('erp-document-finance-core.js');
  const abbr = abbrInvoice();
  for (const customer of [GENERAL, '', `  ${GENERAL} `]) {
    assert.throws(() => f.planInvoiceDocumentAction({ draft: { ...abbr, taxInvoiceForm: 'full', customer: customer || GENERAL }, original: abbr, paymentSummary: { paid: 0, credited: 0 } }),
      err => err.code === f.FINANCE_ACTION_ERROR_CODES.VALIDATION && /86\/4/.test(err.message), JSON.stringify(customer));
  }
  // Same with a VAT-added draft (full form may use any VAT mode).
  assert.throws(() => f.planInvoiceDocumentAction({ draft: { ...abbr, taxInvoiceForm: 'full', useVat: 1, vatMode: 'add' }, original: abbr }), /86\/4/);
  // Still allowed: staying abbreviated, naming the buyer, and a legacy full-form record that already had the placeholder.
  assert.doesNotThrow(() => f.planInvoiceDocumentAction({ draft: { ...abbr, note: 'x' }, original: abbr }));
  assert.doesNotThrow(() => f.planInvoiceDocumentAction({ draft: { ...abbr, taxInvoiceForm: 'full', customer: 'บริษัท ผู้ซื้อ จำกัด', customerAddress: '1 ถนนสุขุมวิท' }, original: abbr }));
  const legacyFull = legacyInvoice({ customer: GENERAL });
  assert.doesNotThrow(() => f.planInvoiceDocumentAction({ draft: { ...legacyFull, taxInvoiceForm: 'full', note: 'x' }, original: legacyFull }));
  // UI: edit the walk-in invoice, switch to full, type the placeholder, save → rejected, record unchanged.
  const h = await boot(); const { w, set } = h;
  try {
    const $ = id => w.document.getElementById(id);
    await waitFor(() => w.saveInvoice?.__stockGuard);
    const d = w.loadFor('ubon', 2026, 8); d.invoices = [abbrInvoice()]; w.saveFor('ubon', 2026, 8, d);
    w.editInvoice('ubon', 2026, 8, 501);
    set('i-tax-form', 'full'); fire(w, $('i-tax-form')); set('i-cust', GENERAL);
    await w.saveInvoice();
    const inv = w.ERPIntegrity.business().invoices.find(x => x.no === 'INV-AB-1');
    assert.equal(inv.taxInvoiceForm, 'abbreviated', 'not re-saved as a full tax invoice');
    assert.match(`${h.messages.join('\n')}\n${$('app-toast-container')?.textContent || ''}`, /ต้องระบุชื่อผู้ซื้อจริง/);
  } finally { h.close(); }
});

test('fix5#2: none → abbreviated keeps autofilled prices like typed ones and reports the real total', async () => {
  const h = await boot(); const { w, set } = h;
  try {
    const $ = id => w.document.getElementById(id);
    const prices = () => [...$('i-items-body').querySelectorAll('[data-field="priceUnit"]')].map(i => i.value);
    w.testApp.restoreLocalMasterBackup({ products: [MASTER] });
    // Mixed rows: one autofilled from the master, one typed.
    w.go('invoice-form', null); w.resetF('invoice'); w.selBr('i', 'ubon');
    set('i-vat', '2'); fire(w, $('i-vat')); $('i-items-body').innerHTML = '';
    autofillRow(w, 1, MASTER.name);
    w.addIItem({ product: 'พิมพ์เอง', qty: 1, unit: 'ชิ้น', priceUnit: 500 });
    w.calcI();
    assert.deepEqual(prices(), ['1000.00', '500']);
    assert.equal($('i-grand-total').value, '1,500.00');
    h.messages.length = 0;
    set('i-tax-form', 'abbreviated'); fire(w, $('i-tax-form'));
    assert.deepEqual(prices(), ['1000.00', '500'], 'both rows keep their number (gross factor ×1 → ×1)');
    assert.equal($('i-grand-total').value, '1,500.00', 'total really unchanged');
    assert.equal(h.messages.length, 1, h.messages.join('\n'));
    assert.match(h.messages[0], /ไม่มี VAT/);
    assert.match(h.messages[0], /รวม VAT 7% แล้ว/);
    assert.match(h.messages[0], /ยอดรวมทั้งสิ้นคงเดิม/);
    // And back: VAT restored to none, numbers and total unchanged.
    h.messages.length = 0;
    set('i-tax-form', 'full'); fire(w, $('i-tax-form'));
    assert.equal($('i-vat').value, '2');
    assert.deepEqual(prices(), ['1000.00', '500']);
    assert.equal($('i-grand-total').value, '1,500.00');
    assert.ok(h.messages.some(m => /กลับเป็นแบบไม่มี VAT/.test(m) && /ยอดรวมทั้งสิ้นคงเดิม/.test(m)), h.messages.join('\n'));

    // Only autofilled rows: previously +7% with no message at all.
    w.resetF('invoice'); w.selBr('i', 'ubon');
    set('i-vat', '2'); fire(w, $('i-vat')); $('i-items-body').innerHTML = '';
    autofillRow(w, 1, MASTER.name); w.calcI();
    assert.equal($('i-grand-total').value, '1,000.00');
    h.messages.length = 0;
    set('i-tax-form', 'abbreviated'); fire(w, $('i-tax-form'));
    assert.deepEqual(prices(), ['1000.00']);
    assert.equal($('i-grand-total').value, '1,000.00');
    assert.ok(h.messages.some(m => /รวม VAT 7% แล้ว/.test(m) && /ยอดรวมทั้งสิ้นคงเดิม/.test(m)), `the meaning change is reported: ${h.messages.join('\n')}`);
    // Gross-changing switches still re-base autofilled rows (VAT added → inclusive keeps the gross).
    w.resetF('invoice'); w.selBr('i', 'ubon');
    set('i-vat', '1'); fire(w, $('i-vat')); $('i-items-body').innerHTML = '';
    autofillRow(w, 2, MASTER.name); w.calcI();
    assert.equal($('i-grand-total').value, '2,140.00');
    set('i-tax-form', 'abbreviated'); fire(w, $('i-tax-form'));
    assert.deepEqual(prices(), ['1070.00']);
    assert.equal($('i-grand-total').value, '2,140.00');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('fix5#3: satang drift on autofilled rows is reported when the VAT mode changes', async () => {
  const h = await boot(); const { w, set } = h;
  try {
    const $ = id => w.document.getElementById(id);
    w.testApp.restoreLocalMasterBackup({ products: [MASTER_ROUNDING] });
    w.go('invoice-form', null); w.resetF('invoice'); w.selBr('i', 'ubon');
    set('i-vat', '1'); fire(w, $('i-vat')); $('i-items-body').innerHTML = '';
    const row = autofillRow(w, 3, MASTER_ROUNDING.name); w.calcI();
    assert.equal(row.querySelector('[data-field="priceUnit"]').value, '333.33');
    assert.equal($('i-grand-total').value, '1,069.99');
    h.messages.length = 0;
    set('i-tax-form', 'abbreviated'); fire(w, $('i-tax-form'));
    assert.equal(row.querySelector('[data-field="priceUnit"]').value, '356.66');
    assert.equal($('i-grand-total').value, '1,069.98');
    assert.ok(h.messages.some(m => /1,069\.99 เป็น 1,069\.98/.test(m) && /ปัดราคาต่อหน่วย/.test(m)), h.messages.join('\n'));
    assert.equal(h.messages.some(m => /คงเดิม/.test(m)), false, 'never claims the total is unchanged');
    h.messages.length = 0;
    set('i-tax-form', 'full'); fire(w, $('i-tax-form'));
    assert.equal(row.querySelector('[data-field="priceUnit"]').value, '333.33');
    assert.equal($('i-grand-total').value, '1,069.99');
    assert.ok(h.messages.some(m => /1,069\.98 เป็น 1,069\.99/.test(m)), h.messages.join('\n'));
    // No drift, only autofilled rows: nothing to report (unchanged behaviour).
    w.testApp.restoreLocalMasterBackup({ products: [MASTER] });
    w.resetF('invoice'); w.selBr('i', 'ubon');
    set('i-vat', '1'); fire(w, $('i-vat')); $('i-items-body').innerHTML = '';
    autofillRow(w, 1, MASTER.name); w.calcI();
    h.messages.length = 0;
    set('i-tax-form', 'abbreviated'); fire(w, $('i-tax-form'));
    assert.equal($('i-grand-total').value, '1,070.00');
    assert.deepEqual(h.messages, []);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('fix5#6: saving warns (without blocking) about a full invoice without buyer address and an abbreviated invoice with a buyer tax ID', async () => {
  const f = await imp('erp-document-finance-core.js');
  const full = legacyInvoice({ taxInvoiceForm: 'full', customerAddress: '' });
  for (const mode of [{ useVat: 1, vatMode: 'add' }, { useVat: 0, vatMode: 'extract' }]) {
    const warnings = f.planInvoiceDocumentAction({ draft: { ...full, ...mode } }).warnings;
    assert.equal(warnings.length, 1, JSON.stringify(mode));
    assert.match(warnings[0], /ที่อยู่ผู้ซื้อ/);
    assert.match(warnings[0], /86\/4/);
    assert.match(warnings[0], /ชื่อและที่อยู่/);
  }
  assert.deepEqual(f.planInvoiceDocumentAction({ draft: legacyInvoice() }).warnings, [], 'full invoice with an address');
  assert.deepEqual(f.planInvoiceDocumentAction({ draft: { ...full, useVat: 2, vatMode: 'none' } }).warnings, [], 'a non-VAT document is not a tax invoice');
  assert.deepEqual(f.planInvoiceDocumentAction({ draft: abbrInvoice() }).warnings, []);
  const withTaxId = f.planInvoiceDocumentAction({ draft: abbrInvoice({ customer: 'บริษัท ผู้ซื้อ จำกัด', customerTaxId: '0105555555555' }) }).warnings;
  assert.equal(withTaxId.length, 1);
  assert.match(withTaxId[0], /เลขประจำตัวผู้เสียภาษี/);
  assert.match(withTaxId[0], /ภาษีซื้อ/);
  assert.match(withTaxId[0], /ใบกำกับภาษีเต็มรูป/);
  // UI: the invoice is saved and the warning is shown with the success message.
  const h = await boot(); const { w, set } = h;
  try {
    const $ = id => w.document.getElementById(id);
    const toast = () => `${h.messages.join('\n')}\n${$('app-toast-container')?.textContent || ''}`;
    await waitFor(() => w.saveInvoice?.__stockGuard);
    w.go('invoice-form', null); w.resetF('invoice'); w.selBr('i', 'ubon');
    set('i-no', 'INV-FULL-NOADDR'); set('i-date', '2026-09-05'); set('i-sales', 'ขาย'); set('i-cust', 'บริษัท ผู้ซื้อ จำกัด');
    $('i-items-body').innerHTML = '';
    w.addIItem({ product: 'สินค้า', qty: 1, unit: 'ชิ้น', priceUnit: 107 });
    await w.saveInvoice();
    assert.equal(w.ERPIntegrity.business().invoices.filter(x => x.no === 'INV-FULL-NOADDR').length, 1, toast());
    assert.match(toast(), /บันทึกใบส่งสินค้า \/ ใบกำกับภาษีเรียบร้อย/);
    assert.match(toast(), /ยังไม่ได้ระบุที่อยู่ผู้ซื้อ/);
    w.resetF('invoice'); w.selBr('i', 'ubon');
    set('i-no', 'INV-ABBR-TAXID'); set('i-date', '2026-09-05'); set('i-sales', 'ขาย');
    set('i-tax-form', 'abbreviated'); fire(w, $('i-tax-form'));
    set('i-tax-id', '0105555555555');
    $('i-items-body').innerHTML = '';
    w.addIItem({ product: 'สินค้า', qty: 1, unit: 'ชิ้น', priceUnit: 107 });
    await w.LocalDemoHealth.whenIdle('saveInvoice'); // r5fix#5: the single-flight guard drops a 2nd save within 250 ms of the 1st (double-click protection) — wait for it instead of sleeping
    await w.saveInvoice();
    assert.equal(w.ERPIntegrity.business().invoices.filter(x => x.no === 'INV-ABBR-TAXID').length, 1, toast());
    assert.match(toast(), /ใบกำกับภาษีอย่างย่อ — ผู้ซื้อที่จดทะเบียน VAT/);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

// ================================================= fix6 regressions (4.3.1 review 6)
test('fix6#10: a "ไม่มี VAT" invoice is printed as ใบส่งสินค้า/ใบแจ้งหนี้, never titled a tax invoice; VAT invoices keep their titles', async () => {
  const h = await boot(); const { w } = h;
  try {
    const doc = w.ComformDeliveryTaxDocument;
    const base = { id: 1001, no: 'INV-NV', branch: 'ubon', date: '2026-09-05', customer: 'บริษัท ลูกค้า จำกัด', customerTaxId: '0105555555555', items: [{ product: 'บริการ', qty: 1, unit: 'งาน', priceUnit: 500 }] };
    const none = { ...base, useVat: 2, vatMode: 'none', subtotal: 500, vatAmt: 0, total: 500 };
    for (const pageId of ['original', 'copy', 'delivery-copy']) {
      const html = doc.buildInlineHtml(none, { b: 'ubon' }, pageId);
      const box = w.document.createElement('div'); box.innerHTML = html;
      const title = box.querySelector('.dtd-doc-title').textContent;
      assert.doesNotMatch(title, /ใบกำกับภาษี|TAX INVOICE/, `${pageId}: ${title}`);
      assert.match(title, /ใบแจ้งหนี้/); assert.match(title, /INVOICE/);
      assert.doesNotMatch(box.querySelector('.dtd-doc-signatures').textContent, /ใบกำกับภาษี/, pageId);
    }
    assert.match(doc.buildInlineHtml(none, { b: 'ubon' }, 'original'), /<h2>ใบส่งสินค้า\/ใบแจ้งหนี้<\/h2>\s*<div>\(DELIVERY ORDER \/ INVOICE\)<\/div>/);
    // VAT add / extract keep the tax-invoice titles and receipt notes.
    for (const inv of [{ ...base, useVat: 1, vatMode: 'add', subtotal: 500, vatAmt: 35, total: 535 }, { ...base, useVat: 0, vatMode: 'extract', subtotal: 467.29, vatAmt: 32.71, total: 500 }]) {
      const original = doc.buildInlineHtml(inv, { b: 'ubon' }, 'original'), copy = doc.buildInlineHtml(inv, { b: 'ubon' }, 'delivery-copy');
      assert.match(original, /<h2>ใบส่งสินค้า\/ใบกำกับภาษี<\/h2>\s*<div>\(DELIVERY ORDER \/ TAX INVOICE\)<\/div>/);
      assert.ok(original.includes('ได้รับสินค้าตามรายการข้างต้นไว้เรียบร้อยแล้วพร้อมต้นฉบับใบกำกับภาษี'));
      assert.match(copy, /<h3>สำเนาใบส่งสินค้า\/สำเนาใบกำกับภาษี<\/h3>\s*<h2>ใบส่งสินค้า\/สำเนาใบกำกับภาษี<\/h2>/);
      assert.ok(copy.includes('พร้อมสำเนาใบกำกับภาษี'));
      assert.doesNotMatch(original, /ใบแจ้งหนี้/);
    }
  } finally { h.close(); }
});

test('fix7#1: a "ไม่มี VAT" invoice shows a No-VAT totals row instead of "VAT 7% 0.00"; VAT invoices keep the VAT 7% row', async () => {
  const h = await boot(); const { w } = h;
  try {
    const doc = w.ComformDeliveryTaxDocument;
    const base = { id: 1002, no: 'INV-NV2', branch: 'ubon', date: '2026-09-05', customer: 'บริษัท ลูกค้า จำกัด', customerTaxId: '0105555555555', items: [{ product: 'บริการ', qty: 1, unit: 'งาน', priceUnit: 500 }] };
    const totalsOf = inv => { const box = w.document.createElement('div'); box.innerHTML = doc.buildInlineHtml(inv, { b: 'ubon' }, 'original'); return box.querySelector('.dtd-doc-totals').textContent.replace(/\s+/g, ' '); };
    const none = totalsOf({ ...base, useVat: 2, vatMode: 'none', subtotal: 500, vatAmt: 0, total: 500 });
    assert.doesNotMatch(none, /VAT 7%|ภาษีมูลค่าเพิ่ม 7%/, none);
    assert.match(none, /ไม่คิดภาษีมูลค่าเพิ่ม\s*No VAT\s*-/, none);
    assert.match(none, /500\.00/, none);
    const add = totalsOf({ ...base, useVat: 1, vatMode: 'add', subtotal: 500, vatAmt: 35, total: 535 });
    assert.match(add, /ภาษีมูลค่าเพิ่ม 7%\s*VAT 7%\s*35\.00/, add);
    assert.doesNotMatch(add, /No VAT/, add);
  } finally { h.close(); }
});
