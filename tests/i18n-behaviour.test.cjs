// test-suite: full
// ADR-026 — the TH / EN switch in the booted app (jsdom): Thai stays the default and unchanged, switching keeps the
// page and what the user typed, user data is never translated, the setting persists through backups and the demo
// reset, the MutationObserver cannot loop, tax help / calendar / tab labels in English, bilingual commercial prints
// (government forms stay Thai only) and English export headers.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./dom-helper.cjs');
const { LANGUAGE_KEY, THAI_RE, bootEnglish, settle, sleep } = require('./i18n-helper.cjs');

const SEED_DAY = '2026-10-12';
const outsideParentheses = text => String(text).replace(/\([^()]*\)/g, part => (THAI_RE.test(part) ? '' : part));
const ref = row => [row._branch, row._year, row._month, String(row.id)];
const seed = async w => {
  const result = await w.ERPDemoSeed.load({ today: SEED_DAY, confirm: () => true });
  assert.equal(result.status, 'loaded');
  await settle(w, 300);
};
// window.open for print windows: records what each print writes.
function capturePrints(w) {
  const writes = [];
  w.open = () => {
    let html = '';
    return { opener: {}, document: { write: chunk => { html += chunk; }, close: () => { writes.push(html); } }, focus() {}, print() {}, close() {} };
  };
  return writes;
}
// The workbook / CSV calls of the exports: sheet names and rows.
function captureExports(w) {
  const sheets = [];
  w.XLSX = { utils: { book_new: () => ({}), aoa_to_sheet: rows => ({ rows }), book_append_sheet: (wb, ws, name) => sheets.push({ name, rows: ws.rows }) }, writeFile: () => {} };
  const csv = [];
  w.downloadCsvText = (name, rows) => csv.push({ name, rows });
  return { sheets, csv };
}
const runExports = async w => {
  const out = captureExports(w);
  w.exportXLSX('all', {});
  await sleep(50);
  w.ERPDebitNotes.exportExcel();
  await sleep(50);
  w.ERPReceivables.exportCsv();
  return out;
};

test('i18n#1 Thai is the default: Thai screens, no English layer, dialogs / prints / exports pass through unchanged', async () => {
  const asked = [];
  const h = await boot({ beforeScripts(w) { w.confirm = message => { asked.push(message); return false; }; } });
  const { w } = h;
  const d = w.document;
  try {
    assert.equal(w.ERPI18n.lang(), 'th');
    assert.equal(d.documentElement.getAttribute('lang'), 'th');
    assert.equal(d.body.classList.contains('erp-lang-en'), false);
    assert.equal(w.ERPI18n.stats().observing, false, 'no observer in Thai');
    assert.equal(w.localStorage.getItem(LANGUAGE_KEY), null, 'nothing stored until the user chooses');
    // The switch: in the header, before the Demo menu button, two real buttons with aria-pressed.
    const group = d.getElementById('erp-lang-switch');
    assert.ok(group, 'TH | EN switch in the header');
    assert.equal(group.getAttribute('role'), 'group');
    assert.equal(group.nextElementSibling?.id, 'erp-demo-menu-btn', 'the Demo menu stays last');
    const [th, en] = [...group.querySelectorAll('button[data-erp-lang]')];
    assert.deepEqual([th.textContent, en.textContent], ['TH', 'EN']);
    assert.deepEqual([th.getAttribute('aria-pressed'), en.getAttribute('aria-pressed')], ['true', 'false']);
    assert.equal(th.type, 'button');
    // Dialogs: the same message, the browser's answer.
    assert.equal(w.confirm('ยืนยันการลบเอกสารนี้?'), false);
    assert.deepEqual(asked, ['ยืนยันการลบเอกสารนี้?']);
    // Print / export helpers are the identity in Thai.
    const html = '<div class="dtd-doc-tax">เลขประจำตัวผู้เสียภาษี 0105568123453</div>';
    assert.equal(w.ERPI18n.bilingualHtml(html), html);
    const stage = d.createElement('div');
    stage.innerHTML = html;
    w.ERPI18n.prepareDocumentStage(stage);
    assert.equal(stage.outerHTML, `<div>${html}</div>`);
    const rows = [['วันที่', 'ลูกค้า']];
    assert.equal(w.ERPI18n.exportRows(rows), rows);
    assert.equal(w.ERPI18n.exportSheetName('ใบเสนอราคา'), 'ใบเสนอราคา');
    await seed(w);
    w.go('tax-reports');
    await sleep(60);
    assert.equal(d.querySelector('.erp-tax-calendar'), null, 'no English tax calendar in Thai');
    assert.equal(d.querySelector('.erp-tax-help'), null, 'no "?" help in Thai');
    assert.equal(d.querySelector('[data-tax-tab="pp30"]').textContent, 'ภ.พ.30');
    const exported = await runExports(w);
    assert.equal(exported.sheets[0].rows[0][0], 'วันที่ขาย', 'Thai export headers unchanged');
    assert.equal(exported.sheets[0].name, 'ใบส่งสินค้า - ใบกำกับภาษี');
    const prints = capturePrints(w);
    const cn = w.ERPCreditNotes.allCreditNotes()[0];
    w.ComformCreditNoteDocument.print(cn, 'all');
    assert.equal(prints.length, 1);
    assert.equal(prints[0].includes('erp-print-en'), false, 'Thai prints get no English layer');
    assert.equal(d.querySelector('.erp-print-en, .erp-print-en-words'), null);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('i18n#2 switching keeps the page and the unsaved form; switching back gives the exact Thai markup again', async () => {
  const h = await boot();
  const { w } = h;
  const d = w.document;
  try {
    w.go('invoice-form');
    const panel = d.getElementById('panel-invoice-form');
    // The form's own start-up timers (branch warning, hints) finish first: wait until its markup stops changing.
    for (let i = 0, last = ''; i < 40 && last !== panel.innerHTML; i += 1) { last = panel.innerHTML; await sleep(250); }
    const cust = d.getElementById('i-cust');
    const note = d.getElementById('i-note');
    cust.value = 'บริษัท ทดสอบภาษา จำกัด';
    note.value = 'ส่งของก่อนเที่ยง';
    const before = panel.innerHTML;
    const titleBefore = d.title;
    d.querySelector('#erp-lang-switch [data-erp-lang="en"]').click();
    await settle(w, 60);
    assert.equal(w.ERPI18n.lang(), 'en');
    assert.equal(d.documentElement.getAttribute('lang'), 'en');
    assert.ok(panel.classList.contains('active'), 'still on the invoice form');
    assert.equal(d.querySelector('.panel.active')?.id, 'panel-invoice-form');
    assert.equal(cust.value, 'บริษัท ทดสอบภาษา จำกัด', 'typed text kept');
    assert.equal(note.value, 'ส่งของก่อนเที่ยง', 'typed text never translated');
    assert.notEqual(panel.innerHTML, before, 'labels translated');
    assert.equal(THAI_RE.test(note.getAttribute('placeholder')), false, 'placeholder translated');
    assert.equal(THAI_RE.test(d.title), false, '<title> translated');
    const [th, en] = [...d.querySelectorAll('#erp-lang-switch [data-erp-lang]')];
    assert.deepEqual([th.getAttribute('aria-pressed'), en.getAttribute('aria-pressed')], ['false', 'true']);
    assert.equal(JSON.parse(w.localStorage.getItem(LANGUAGE_KEY)).language, 'en', 'the choice is stored');
    // Back to Thai with the Demo menu item (keyboard-reachable button in the menu).
    const item = d.getElementById('local-demo-language-btn');
    assert.ok(item, 'Demo menu item');
    assert.match(item.textContent, /ภาษาไทย/);
    item.click();
    await settle(w, 60);
    assert.equal(w.ERPI18n.lang(), 'th');
    assert.equal(panel.innerHTML, before, 'exactly the Thai markup of before');
    assert.equal(d.title, titleBefore);
    assert.equal(cust.value, 'บริษัท ทดสอบภาษา จำกัด');
    assert.equal(note.value, 'ส่งของก่อนเที่ยง');
    assert.equal(d.documentElement.getAttribute('lang'), 'th');
    assert.equal(d.body.classList.contains('erp-lang-en'), false);
    assert.equal(JSON.parse(w.localStorage.getItem(LANGUAGE_KEY)).language, 'th');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('i18n#3 user data stays as typed: names, typed values and a name that is also a dictionary word', async () => {
  const h = await bootEnglish();
  const { w } = h;
  const d = w.document;
  try {
    await seed(w);
    const word = 'บันทึก';
    assert.equal(w.ERPI18n.translateResult(word).translated, true, 'the name used below is a dictionary phrase');
    w.go('master-data');
    await settle(w, 40);
    d.getElementById('md-c-name').value = word;
    w.saveCustomerMaster();
    await settle(w, 80);
    const cells = [...d.querySelectorAll('#panel-master-data td[data-no-i18n]')].map(td => td.textContent.trim());
    assert.ok(cells.includes(word), 'the customer named like a UI word is shown as typed');
    // Seeded customers in the invoice list: Thai, in data-no-i18n cells.
    w.go('invoice-list');
    await settle(w, 60);
    const customer = w.ERPIntegrity.business().invoices[0].customer;
    assert.ok(THAI_RE.test(customer));
    const shown = [...d.querySelectorAll('#panel-invoice-list [data-no-i18n]')].map(el => el.textContent);
    assert.ok(shown.some(text => text.includes(customer)), 'customer name shown in Thai');
    // Typed values are never translated, even when they are dictionary phrases.
    w.go('expense-form');
    await settle(w, 40);
    const desc = d.getElementById('e-desc');
    desc.value = word;
    desc.dispatchEvent(new w.Event('input', { bubbles: true }));
    await settle(w, 40);
    assert.equal(desc.value, word);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('i18n#4 the setting persists, travels in JSON backups and auto-snapshots, and survives the demo reset', async () => {
  const h = await bootEnglish();
  const { w } = h;
  try {
    assert.equal(w.ERPI18n.lang(), 'en', 'a stored English choice is used at start');
    w.ERPI18n.setLanguage('en');
    const stored = JSON.parse(w.localStorage.getItem(LANGUAGE_KEY));
    assert.equal(stored.schemaVersion, 1);
    assert.equal(stored.language, 'en');
    const master = w.testApp.collectLocalMasterBackup();
    assert.equal(master.settings.comform_ui_language_v1.language, 'en', 'JSON backup carries the preference');
    assert.ok('comform_ui_language_v1' in w.ERPBackup.capture(), 'local auto-snapshots carry it');
    const exported = JSON.parse(JSON.stringify(await w.ERPBackup.portable({ meta: { app: 'comform-esan', backupType: 'all' }, data: {}, masterData: master })));
    assert.equal((await w.ERPBackup.verifyPortable(exported)).verified, true);
    // A restore into a browser set to Thai brings English back and the screen follows.
    w.ERPI18n.setLanguage('th');
    w.localStorage.removeItem(LANGUAGE_KEY);
    w.testApp.restoreLocalMasterBackup(exported.masterData, { replace: true });
    await settle(w, 120);
    assert.equal(JSON.parse(w.localStorage.getItem(LANGUAGE_KEY)).language, 'en');
    assert.equal(w.ERPI18n.lang(), 'en', 'the screen follows the restore');
    // A damaged value in a backup is read as Thai (fail-safe), never an error.
    w.localStorage.setItem(LANGUAGE_KEY, '{"language":');
    w.dispatchEvent(new w.CustomEvent('erp:storage-written'));
    await settle(w, 40);
    assert.equal(w.ERPI18n.lang(), 'th', 'damaged value: Thai');
    // The demo reset keeps the view preference.
    w.ERPI18n.setLanguage('en');
    await seed(w);
    const reset = await w.ERPDemoSeed.reset({ confirm: () => true });
    assert.notEqual(reset.status, 'failed');
    await settle(w, 120);
    assert.equal(JSON.parse(w.localStorage.getItem(LANGUAGE_KEY)).language, 'en', 'reset keeps the language');
    assert.equal(w.ERPI18n.lang(), 'en');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('i18n#5 no MutationObserver loop: idle pages stop flushing, a fighting script is left alone after a bounded number of rewrites', async () => {
  const h = await bootEnglish();
  const { w } = h;
  const d = w.document;
  try {
    await seed(w);
    w.go('dashboard');
    await settle(w, 200);
    // The app's own timers may still change a few nodes; a translation loop would flush every frame (~25 in 400 ms).
    const idle = w.ERPI18n.stats().flushes;
    await sleep(400);
    assert.ok(w.ERPI18n.stats().flushes - idle <= 5, `idle page does not keep flushing (${w.ERPI18n.stats().flushes - idle})`);
    assert.equal(w.ERPI18n.stats().loopsStopped, 0, 'the app itself never fights the translator');
    // A script that puts its Thai text back every time it is translated.
    const box = d.createElement('div');
    box.textContent = 'บันทึก';
    d.getElementById('app-content').append(box);
    const fighter = new w.MutationObserver(() => { if (box.textContent !== 'บันทึก') box.textContent = 'บันทึก'; });
    fighter.observe(box, { childList: true, characterData: true, subtree: true });
    const start = w.ERPI18n.stats();
    for (let i = 0; i < 80; i += 1) await sleep(20);
    const end = w.ERPI18n.stats();
    fighter.disconnect();
    assert.ok(end.loopsStopped >= 1, 'the guard stopped the loop');
    assert.ok(end.flushes - start.flushes <= 40, `bounded flushes (${end.flushes - start.flushes})`);
    assert.equal(box.textContent, 'บันทึก', 'the fighting text is left as its script wants it');
    const after = w.ERPI18n.stats().flushes;
    await sleep(300);
    assert.ok(w.ERPI18n.stats().flushes - after <= 5, 'quiet again');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('i18n#6 English: dialogs, tax tabs in Latin with explanations, "?" help popovers and the Thai tax calendar', async () => {
  const h = await bootEnglish({ confirmAnswer: true });
  const { w } = h;
  const d = w.document;
  try {
    await seed(w);
    w.confirm('ลบรายการนี้หรือไม่? ระบบจะเก็บสำเนาไว้ใน Recycle Bin เพื่อกู้คืนภายหลัง'); // an app message (app.js)
    const last = h.dialogs[h.dialogs.length - 1];
    assert.equal(THAI_RE.test(last.message), false, `dialog in English: ${last.message}`);
    w.go('tax-reports');
    const set = (id, value) => { const el = d.getElementById(id); el.value = value; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
    set('tax-rpt-month', '9');
    set('tax-rpt-year', '2026');
    await settle(w, 80);
    const tabs = Object.fromEntries([...d.querySelectorAll('[data-tax-tab]')].map(b => [b.dataset.taxTab, b.textContent.trim()]));
    assert.equal(tabs.pp30, 'PP.30 (monthly VAT return)');
    assert.equal(tabs.wht, '50 Tawi (withholding-tax certificates)');
    assert.match(tabs.pnd3, /^PND\.3 \(/);
    const calendar = d.querySelector('.erp-tax-calendar');
    assert.ok(calendar, 'Thai tax calendar panel');
    const text = calendar.textContent.replace(/\s+/g, ' ');
    assert.match(text, /September 2026 \(tax month\)/);
    assert.match(text, /B\.E\. 2569/);
    assert.match(text, /07\/10\/2026 \(Wed\)/, 'PND paper by the 7th');
    assert.match(text, /15\/10\/2026 \(Thu\)/, 'PP.30 paper by the 15th / PND online by the 15th');
    // r13#LOW-1: Fri 23 Oct 2569 is วันปิยมหาราช — the online ภ.พ.30 date moves to Mon 26 Oct 2569.
    assert.match(text, /26\/10\/2026 \(Mon\) \(moved past a government holiday\)/, 'PP.30 online by the 23rd → 26th');
    assert.equal(THAI_RE.test(text), false);
    const help = d.querySelector('#tax-reports-root .erp-tax-help');
    assert.ok(help, '"?" help buttons');
    assert.ok(help.getAttribute('aria-label'));
    help.focus();
    help.click();
    const pop = d.getElementById('erp-tax-help-popover');
    assert.ok(pop);
    assert.equal(pop.getAttribute('role'), 'dialog');
    assert.match(pop.textContent, /Thai accountant/);
    assert.equal(help.getAttribute('aria-expanded'), 'true');
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(d.getElementById('erp-tax-help-popover'), null, 'Escape closes');
    assert.equal(d.activeElement, help, 'focus back on the "?"');
    // Form labels of Thai tax concepts get their "?" too (expense: input VAT / withholding tax).
    w.go('expense-form');
    await settle(w, 60);
    assert.ok(d.querySelectorAll('#panel-expense-form .erp-tax-help').length >= 1, 'help next to the tax fields of the expense form');
    // Back to Thai: every "?" and the calendar are gone, the tab says ภ.พ.30 again.
    w.ERPI18n.setLanguage('th');
    w.go('tax-reports');
    await settle(w, 80);
    assert.equal(d.querySelector('.erp-tax-help, .erp-tax-calendar, #erp-tax-help-popover'), null);
    assert.equal(d.querySelector('[data-tax-tab="pp30"]').textContent, 'ภ.พ.30');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('i18n#7 prints in English: commercial documents bilingual with the amount in English words; government forms stay Thai only', async () => {
  const h = await bootEnglish();
  const { w } = h;
  const d = w.document;
  try {
    await seed(w);
    const prints = capturePrints(w);
    const biz = w.ERPIntegrity.business();
    // Credit note: Thai text unchanged, English labels and words added.
    const cn = w.ERPCreditNotes.allCreditNotes()[0];
    w.ComformCreditNoteDocument.print(cn, 'all');
    const cnHtml = prints.pop();
    assert.match(cnHtml, /class="erp-print-en"/);
    assert.match(cnHtml, /class="erp-print-en-words"[^>]*>[A-Z][a-z].* (baht only|satang)</);
    assert.match(cnHtml, /บาท(ถ้วน|.*สตางค์)/, 'the Thai amount in words is still there');
    assert.match(cnHtml, /<html lang="th">/, 'still a Thai document');
    // Quotation and tax invoice / receipt (preview builders and the print window).
    const quote = biz.quotes[0];
    w.ComformQuotationDocument.loadFromData(quote, { b: quote._branch, y: quote._year, m: quote._month });
    w.printQuote('current');
    const qHtml = prints.pop();
    assert.match(qHtml, /Quotation no\./);
    assert.match(qHtml, /Grand total/);
    assert.match(qHtml, /\((Zero|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|[A-Z][a-z-]+)[^)]*(baht only|satang)\)/);
    const inv = biz.invoices.find(i => i.taxInvoiceForm !== 'abbreviated' && i.vatMode !== 'none' && !i.voided);
    const invHtml = w.ERPI18n.bilingualHtml(w.ComformDeliveryTaxDocument.buildInlineHtml(inv, {}, 'original'));
    assert.match(invHtml, /Tax ID/);
    assert.match(invHtml, /Please pay into the account of/);
    const rc = biz.receipts[0];
    const rcHtml = w.ERPI18n.bilingualHtml(w.ComformReceiptDocument.buildInlineHtml(rc, {}, 'original'));
    assert.match(rcHtml, /Original receipt received/);
    // The Thai text is untouched: removing the English layer gives the Thai document back.
    const strip = html => {
      const t = d.createElement('template');
      t.innerHTML = html;
      t.content.querySelectorAll('.erp-print-en, .erp-print-en-words').forEach(el => el.remove());
      t.content.querySelectorAll('*').forEach(el => el.normalize());
      return t.innerHTML;
    };
    const thaiInv = w.ComformDeliveryTaxDocument.buildInlineHtml(inv, {}, 'original');
    const parsed = d.createElement('template');
    parsed.innerHTML = thaiInv;
    assert.equal(strip(invHtml), parsed.innerHTML, 'bilingual = Thai document + English labels only');
    // Previews on screen get the same English labels; the 50 Tawi viewer does not.
    w.ERPCreditNotes.previewStored(cn._branch || cn.branch, cn._year, cn._month, cn.id);
    await settle(w, 40);
    assert.ok(d.querySelector('.doc-preview-modal-page .erp-print-en'), 'credit note preview bilingual');
    d.querySelector('.doc-preview-modal-close')?.click();
    const cert = w.ERPPayerWht.readCertificates({ branches: ['ubon'] })[0];
    assert.ok(cert, 'sample data has a 50 Tawi');
    w.ERPPayerWht.openCertificate(cert);
    await settle(w, 40);
    const viewer = d.querySelector('.wht-cert-screen');
    assert.equal(viewer.getAttribute('data-no-i18n'), 'form');
    assert.equal(viewer.querySelector('.erp-print-en, .erp-print-en-words'), null, '50 Tawi viewer stays Thai');
    assert.ok(THAI_RE.test(viewer.textContent));
    // Government form print: identical in English and in Thai.
    w.ERPPayerWht.printCertificate(cert);
    const certEn = prints.pop();
    w.ERPI18n.setLanguage('th');
    await settle(w, 40);
    w.ERPPayerWht.printCertificate(cert);
    const certTh = prints.pop();
    assert.ok(certTh && certTh.length > 1000);
    assert.equal(certEn, certTh, '50 Tawi prints the same in both languages');
    assert.equal(certEn.includes('erp-print-en'), false);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('i18n#8 exports in English: English column headers and sheet names, the data rows exactly as in Thai', async () => {
  const h = await bootEnglish();
  const { w } = h;
  try {
    await seed(w);
    const en = await runExports(w);
    w.ERPI18n.setLanguage('th');
    await settle(w, 40);
    const th = await runExports(w);
    assert.equal(en.sheets.length, th.sheets.length);
    assert.ok(en.sheets.length >= 7);
    en.sheets.forEach((sheet, index) => {
      for (const cell of sheet.rows[0]) assert.equal(THAI_RE.test(outsideParentheses(cell)), false, `${sheet.name}: header "${cell}"`);
      assert.equal(THAI_RE.test(sheet.name), false, `sheet name ${sheet.name}`);
      assert.ok(sheet.name.length <= 31 && !/[\\/?*[\]:]/.test(sheet.name));
      assert.equal(sheet.rows[0].length, th.sheets[index].rows[0].length);
      assert.deepEqual(sheet.rows.slice(1), th.sheets[index].rows.slice(1), `${sheet.name}: data rows unchanged`);
    });
    assert.equal(en.sheets[0].rows[0][0], 'Sale date');
    assert.equal(en.csv.length, 1);
    for (const cell of en.csv[0].rows[0]) assert.equal(THAI_RE.test(outsideParentheses(cell)), false, `AR aging CSV header "${cell}"`);
    assert.deepEqual(en.csv[0].rows.slice(1), th.csv[0].rows.slice(1));
    assert.equal(th.csv[0].rows[0][0], 'ลูกค้า');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});
