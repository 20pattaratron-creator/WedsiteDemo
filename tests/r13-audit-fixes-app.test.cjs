// Round 13A (ADR-030) — the printed documents and forms of the round-13 fixes in the booted app (jsdom):
//   r13#MED-3 the replacement tax invoice prints "ออกแทนใบกำกับภาษีเลขที่ … ลงวันที่ …"
//   r13#MED-4 a 0 % sale prints as a tax invoice with a "ภาษีมูลค่าเพิ่ม 0%" row and the export declaration number
//   r13#MED-5 the abbreviated tax invoice prints the POS ID and the approval number from the company profile
//   r13#MED-6 the receipt of a tax-point-at-payment service invoice is "ใบเสร็จรับเงิน/ใบกำกับภาษี" with THIS payment's VAT
//   r13#HIGH-2 the PO / GR forms carry the supplier's VAT; a GR is refused without the VAT choice
//   r13#LANG-print every Thai text of every printed document type has an English label in English mode (user data aside)
// Every test here fails on round12-journal (/tmp/claude-0/r13a-newtests-on-base.log) and passes now.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./dom-helper.cjs');
const { bootEnglish, settle, userDataCorpus, isUserDataPiece, normalize, THAI_RE } = require('./i18n-helper.cjs');

const SEED_DAY = '2026-10-25';
const seed = async w => {
  const result = await w.ERPDemoSeed.load({ today: SEED_DAY, confirm: () => true });
  assert.equal(result.status, 'loaded');
  await settle(w, 300);
  return result;
};
const box = (w, html) => { const el = w.document.createElement('div'); el.innerHTML = html; return el; };
const textOf = (w, html) => normalize(box(w, html).textContent);
const service = (over = {}) => ({ id: 9101, no: 'INV691091', branch: 'ubon', _branch: 'ubon', date: '2026-10-05', customer: 'บริษัท ลูกค้าบริการ จำกัด', customerAddress: '1 ถนนบริการ', customerTaxId: '0105558012349', customerBranchCode: '00000', salesPerson: 'ฝ่ายขาย', vatMode: 'add', useVat: 1, subtotal: 1000, vatAmt: 70, total: 1070, items: [{ product: 'ค่าบริการติดตั้ง', productCode: 'SV-1', qty: 1, unit: 'งาน', priceUnit: 1000, saleTotal: 1000, flowType: 'service', fulfillmentType: 'service' }], ...over });

test('r13#MED-3 / MED-4 printed tax invoice: replacement line with the original number + date; 0 % sale shows "VAT 0%" and the export declaration', async () => {
  const h = await boot(); const { w } = h;
  try {
    const doc = w.ComformDeliveryTaxDocument;
    const replacement = textOf(w, doc.buildInlineHtml(service({ replacesNo: 'INV691001', replacesDate: '2026-10-01' }), { b: 'ubon' }));
    assert.match(replacement, /ออกแทนใบกำกับภาษีเลขที่ INV691001 ลงวันที่ 01-10-2569 \(ฉบับเดิมยกเลิกแล้ว\)/);
    const zero = service({ no: 'INV691092', vatMode: 'none', useVat: 0, vatAmt: 0, total: 1000, vatCategory: 'zero', exportDeclarationNo: 'A001-1-6910-00001', items: [{ product: 'จอส่งออก', productCode: 'EX-1', qty: 1, unit: 'ชิ้น', priceUnit: 1000, saleTotal: 1000 }] });
    const text = textOf(w, doc.buildInlineHtml(zero, { b: 'ubon' }));
    assert.match(text, /ใบกำกับภาษี/, 'a 0 % sale of a VAT registrant is a tax invoice');
    assert.match(text, /ภาษีมูลค่าเพิ่ม 0%/);
    assert.match(text, /ใบขนสินค้าขาออกเลขที่ A001-1-6910-00001/);
    const exempt = textOf(w, doc.buildInlineHtml({ ...zero, vatCategory: 'exempt' }, { b: 'ubon' }));
    assert.doesNotMatch(exempt, /ภาษีมูลค่าเพิ่ม 0%/, 'an exempt sale has no 0 % row');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('r13#MED-5 abbreviated tax invoice: POS ID + approval number printed when approved; the invoice form warns when not', async () => {
  const h = await boot(); const { w } = h;
  try {
    const doc = w.ComformDeliveryTaxDocument;
    const sale = service({ no: 'INV-AB-9', taxInvoiceForm: 'abbreviated', vatMode: 'extract', useVat: 0, subtotal: 1000, vatAmt: 70, total: 1070, customer: 'ลูกค้าทั่วไป / เงินสด', customerTaxId: '', items: [{ product: 'สินค้าหน้าร้าน', qty: 1, unit: 'ชิ้น', priceUnit: 1070, saleTotal: 1070 }] });
    assert.doesNotMatch(textOf(w, doc.buildInlineHtml(sale, { b: 'ubon' })), /POS ID/);
    const profile = w.CurrentUser.companyProfile || {};
    w.CurrentUser.companyProfile = { ...profile, customProfile: true, custom: { ...(profile.custom || {}), abbreviatedApproval: 'approved', abbreviatedApprovalNo: 'อบ.06-123/2569', branches: { ubon: { code: '00000', posId: 'E051234567890' } } } };
    const text = textOf(w, doc.buildInlineHtml(sale, { b: 'ubon' }));
    assert.match(text, /POS ID E051234567890 · เลขที่อนุมัติ \/ Approval no\. อบ\.06-123\/2569/);
    w.CurrentUser.companyProfile = profile;
    // The invoice form: choosing the abbreviated form without an approval shows the red notice.
    w.go('invoice', null);
    const form = w.document.getElementById('i-tax-invoice-form') || w.document.querySelector('[name="taxInvoiceForm"]');
    if (form) {
      form.value = 'abbreviated';
      form.dispatchEvent(new w.Event('change', { bubbles: true }));
      await settle(w, 40);
      const note = w.document.getElementById('i-abbr-approval');
      assert.ok(note && !note.hidden, 'not-approved notice');
      assert.match(note.textContent, /ภ\.พ\.06|อนุมัติ/);
    }
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('r13#MED-6 receipt of a tax-point-at-payment service invoice prints as ใบเสร็จรับเงิน/ใบกำกับภาษี with this payment\'s VAT', async () => {
  const h = await boot(); const { w } = h;
  try {
    const invoice = service({ taxPoint: 'payment' });
    const pack = w.loadFor('ubon', 2026, 9);
    pack.invoices = [invoice];
    const receipt = { id: 9201, no: 'REC691001', date: '2026-10-10', branch: 'ubon', _branch: 'ubon', invNo: invoice.no, invoiceId: invoice.id, customer: invoice.customer, total: 535, subtotal: 500, useVat: 1, vatMode: 'add', items: [{ product: 'รับชำระงวดที่ 1', qty: 1, priceUnit: 500, saleTotal: 500 }] };
    pack.receipts = [receipt];
    w.saveFor('ubon', 2026, 9, pack);
    const text = textOf(w, w.ComformReceiptDocument.buildInlineHtml(receipt, { b: 'ubon', y: 2026, m: 9 }, 'original'));
    assert.match(text, /ใบเสร็จรับเงิน\/ใบกำกับภาษี/);
    assert.match(text, /35\.00/, 'VAT of this payment: 535 × 7 / 107 = 35.00');
    assert.match(text, /78\/1/);
    // An ordinary receipt (invoice without the option) keeps its title.
    pack.invoices = [service()];
    w.saveFor('ubon', 2026, 9, pack);
    assert.doesNotMatch(textOf(w, w.ComformReceiptDocument.buildInlineHtml(receipt, { b: 'ubon', y: 2026, m: 9 }, 'original')), /ใบเสร็จรับเงิน\/ใบกำกับภาษี/);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('r13#HIGH-2 PO / GR forms: the supplier VAT choice is on both forms and a GR is refused without it', async () => {
  const h = await boot(); const { w } = h;
  try {
    await settle(w, 80);
    const poVat = w.document.getElementById('po-vat-mode'), grVat = w.document.getElementById('gr-vat-mode');
    assert.ok(poVat && grVat, 'VAT selects on the PO and GR forms');
    assert.deepEqual([...grVat.options].map(o => o.value), ['', 'add', 'none']);
    assert.equal(grVat.value, '', 'no default — asked');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

// ---------------------------------------------------------------- r13#LANG-print
// Thai text nodes of a bilingual (English-mode) printed page that got no English label: not user data (stored values),
// not the Thai amount in words (it has its own English line), not inside the English layer.
function hasEnglishBeside(node) {
  const parent = node.parentElement;
  let outside = '';
  for (const child of parent.childNodes) if (child !== node) outside += child.textContent || '';
  if (/[A-Za-z]{2,}/.test(outside)) return true;
  const next = parent.nextElementSibling;
  return !!next && ['SPAN', 'EM', 'SMALL', 'DIV'].includes(next.tagName) && !THAI_RE.test(next.textContent || '') && /[A-Za-z]{2,}/.test(next.textContent || '');
}
function untranslatedPrintText(w, html, corpus) {
  const root = box(w, w.ERPI18n.bilingualHtml(html));
  const out = [];
  const walker = w.document.createTreeWalker(root, 4);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = normalize(node.data);
    if (!THAI_RE.test(text)) continue;
    const parent = node.parentElement;
    if (parent.closest('.erp-print-en, .erp-print-en-words, script, style, [data-bilingual], [lang="en"]')) continue;
    const next = node.nextSibling;
    if (next?.nodeType === 1 && next.classList.contains('erp-print-en')) continue;
    // The Thai amount in words: its English line is the .erp-print-en-words element (i18n/en-print.js selector).
    if (parent.closest('.dtd-doc-baht, .rcp-doc-baht, .qdoc-baht-text, .cn-doc-baht, .dtd-abbr-baht')) continue;
    if (isUserDataPiece(w, text, corpus)) continue;
    // A label printed in both languages already ("เลขที่/No.", "ต้นฉบับ/ORIGINAL", "รหัสลูกค้า<br>Customer code",
    // "<b>ผู้อนุมัติ</b><span>Authorized signature</span>") — the same rule as erp-i18n-print.js hasEnglishAlready().
    if (/[A-Za-z]{2,}/.test(text) || hasEnglishBeside(node)) continue;
    out.push(text);
  }
  return out;
}

test('r13#LANG-print every printed document type in English: each Thai label has an English mapping (TH + EN shown)', { timeout: 240000 }, async () => {
  const h = await bootEnglish(); const { w } = h;
  try {
    await seed(w);
    const corpus = userDataCorpus(w);
    const biz = w.ERPIntegrity.business();
    const gaps = new Map();
    const check = (label, html) => { for (const text of untranslatedPrintText(w, html, corpus)) { if (!gaps.has(text)) gaps.set(text, label); } };
    const D = w.ComformDeliveryTaxDocument, R = w.ComformReceiptDocument, C = w.ComformCreditNoteDocument;
    const invoices = biz.invoices.filter(i => !i._type || !String(i._type).startsWith('issued'));
    const full = invoices.find(i => i.taxInvoiceForm !== 'abbreviated' && i.vatMode !== 'none' && !i.voided);
    const abbr = invoices.find(i => i.taxInvoiceForm === 'abbreviated');
    const none = invoices.find(i => i.vatMode === 'none');
    const cancelled = invoices.find(i => i.voided || i.status === 'cancelled');
    const replacement = invoices.find(i => i.replacesNo);
    assert.ok(full && abbr && none && cancelled, 'the sample has every invoice kind');
    for (const pageId of ['original', 'copy']) {
      for (const inv of [full, abbr, none, cancelled, replacement].filter(Boolean)) check(`invoice ${inv.no} ${pageId}`, D.buildInlineHtml(inv, {}, pageId));
      check(`zero-rated ${pageId}`, D.buildInlineHtml({ ...none, vatCategory: 'zero', exportDeclarationNo: 'A001-1-6909-00001' }, {}, pageId));
      check(`service ${pageId}`, D.buildInlineHtml({ ...full, taxPoint: 'payment', items: (full.items || []).map(item => ({ ...item, flowType: 'service' })) }, {}, pageId));
      for (const rc of biz.receipts.slice(0, 6)) check(`receipt ${rc.no} ${pageId}`, R.buildInlineHtml(rc, {}, pageId));
    }
    for (const cn of w.ERPCreditNotes.allCreditNotes()) check(`credit note ${cn.no}`, C.buildHtml(cn, 'original'));
    for (const dn of w.ERPDebitNotes.allDebitNotes()) check(`debit note ${dn.no}`, C.buildHtml(dn, 'original'));
    // Quotation: the page builder through the print window.
    const writes = [];
    w.open = () => { let html = ''; return { opener: {}, document: { write: c => { html += c; }, close: () => writes.push(html) }, focus() {}, print() {}, close() {} }; };
    for (const quote of biz.quotes.slice(0, 3)) {
      w.ComformQuotationDocument.loadFromData(quote, { b: quote._branch, y: quote._year, m: quote._month });
      w.printQuote('current');
      const printed = writes.pop() || '';
      const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(printed)?.[1] || printed;
      check(`quotation ${quote.no}`, body);
    }
    const list = [...gaps].map(([text, where]) => `${where}: ${text}`);
    assert.deepEqual(list, [], `printed Thai without an English mapping:\n${list.join('\n')}`);
    assert.ok(replacement, 'the sample replacement invoice cites the cancelled one (r13#MED-3)');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});
