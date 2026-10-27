// ADR-029 (round 12) — the page "สมุดบัญชีและปิดเดือน", the card "ผังบัญชีและการลงบัญชีอัตโนมัติ" and the card "QR พร้อมเพย์
// บนเอกสาร" in the booted app (jsdom) with the sample data loaded on 21 Oct 2569 (clock pinned): the menu entry and the
// cards in simple mode; the September trial balance / ledger / checks tie to ภ.พ.30 and ภ.ง.ด. in the DOM; the account
// mapping changes codes and names everywhere and refuses a bad chart; exports (general journal CSV with its documented
// columns, PEAK through the editable mapping, the multi-sheet month-end Excel, the COGS-at-month-end option) with the
// network blocked; manual entries (DOM form, cancel = reversal) and every journal-producing change refused in a closed
// period with nothing written; the opening-balance import (preview → commit → refused when closed); the red banner;
// English with no Thai UI text; the JSON backup round trip (fail-closed) and the reset; one establishment; the QR on the
// invoice / receipt / billing note — off: the prints are byte-identical to the build without the module; on: the box
// reads back (tests/qr-reader-helper.cjs) to the PromptPay payload of the amount due.
// Every test here fails on round11-cost (/tmp/claude-0/r12-newtests-on-base.log).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot } = require('./dom-helper.cjs');
const { bootEnglish, settle, THAI_RE } = require('./i18n-helper.cjs');
const { readQr, matrixFromSvg } = require('./qr-reader-helper.cjs');

const ROOT = path.resolve(__dirname, '..');
const TENANT = 'erp_tenant::customer-showcase-local::';
const SETTINGS_KEY = `${TENANT}comform_journal_settings_v1`;
const DOCS_KEY = `${TENANT}comform_journal_documents_v1`;
const PP_KEY = `${TENANT}comform_promptpay_settings_v1`;
const PRODUCTS_KEY = `${TENANT}comform_product_master_v1`;
const COSTING_KEY = `${TENANT}comform_costing_settings_v1`;
const BRANCH_SETTING_KEY = `${TENANT}comform_company_branch_setting_v1`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = el => String(el?.textContent || '').replace(/\s+/g, ' ').trim();
const DAY = '2026-10-21';
const pinClock = day => w => {
  const fixed = Date.parse(`${day}T10:00:00+07:00`);
  const Real = w.Date;
  w.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(fixed); } static now() { return fixed; } };
};
async function seeded(options = {}) {
  const before = w => { pinClock(DAY)(w); if (options.single) w.localStorage.setItem(BRANCH_SETTING_KEY, JSON.stringify({ schemaVersion: 1, count: 1, updatedAt: '2026-10-04T00:00:00.000Z' })); };
  const h = await (options.english ? bootEnglish : boot)({ beforeScripts: before });
  try {
    const result = await h.w.ERPDemoSeed.load({ confirm: () => true });
    assert.equal(result.status, 'loaded', `${h.messages.join('\n')} ${JSON.stringify(result.issues || '')}`);
    h.plan = result.plan;
    h.w.ERPCosting.invalidate();
    h.w.ERPJournal.invalidate();
    return h;
  } catch (error) { h.close(); throw error; }
}
async function openBooks(w, options = {}) {
  w.go('accounting', null);
  await sleep(10);
  return w.ERPJournal.select({ tab: 'trial', branch: 'all', period: '2026-09', ...options });
}
function thaiOutsideUserData(root) {
  const out = [];
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (THAI_RE.test(node.data) && !node.parentElement.closest('[data-no-i18n]')) out.push(node.data.trim());
  for (const el of root.querySelectorAll('[title],[aria-label],[placeholder]')) {
    if (el.closest('[data-no-i18n]')) continue;
    for (const name of ['title', 'aria-label', 'placeholder']) if (THAI_RE.test(el.getAttribute(name) || '')) out.push(`@${name} ${el.getAttribute(name)}`);
  }
  return out;
}
// Values made in the page's realm (jsdom) compared by value, as plain JSON.
const plain = value => JSON.parse(JSON.stringify(value));
const deepEqual = (actual, expected, message) => assert.deepEqual(plain(actual), plain(expected), message);
const csvRows = content => content.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
const blockNetwork = w => { w.fetch = () => { throw new Error('network blocked'); }; w.URL.createObjectURL = () => 'blob:test'; w.URL.revokeObjectURL = () => {}; };
const loadSheet = w => w.eval(fs.readFileSync(path.join(ROOT, 'vendor/xlsx-0.18.5.full.min.js'), 'utf8'));
const checkOf = (checks, id, branch) => checks.checks.find(check => check.id === id && (!branch || check.values.branch === branch));

test('japp#1 simple mode: the menu entry; the September trial balance balances and ties (ภ.พ.30 L5 / L7, ภ.ง.ด.3 / 53, stock, AR) in the DOM', async () => {
  const h = await seeded(); const { w } = h; const d = w.document;
  try {
    assert.equal(w.localStorage.getItem(`${TENANT}erp_product_experience_mode_v1`), null, 'the default mode (simple)');
    const find = () => [...d.querySelectorAll('.sidebar .nav-item')].find(el => el.dataset.pePanel === 'accounting' && el.closest('.nav-group'));
    for (let i = 0; i < 160 && !find(); i += 1) await sleep(25);
    const entry = find();
    assert.ok(entry && !entry.hidden && !entry.closest('.nav-group').hidden, 'menu entry, visible in simple mode');
    assert.equal(entry.closest('.nav-group').dataset.navSection, 'data');
    assert.equal(text(entry), 'สมุดบัญชีและปิดเดือน');
    w.go('accounting', entry); // what the entry's onclick does (inline handlers do not run in jsdom)
    await sleep(20);
    assert.ok(d.getElementById('panel-accounting').classList.contains('active'));
    const view = await openBooks(w);
    assert.equal(view.tb.balanced, true);
    // r13#HIGH-2: + GR690901's VAT 483.00 (Dr 1154 input VAT / Cr 2111 AP) → 436,254.50 + 483.00 = 436,737.50.
    deepEqual([view.tb.totals.debit, view.tb.totals.credit], [43673750, 43673750]);
    const root = d.getElementById('acc-root');
    assert.match(text(root), /งบทดลอง — ก\.ย\. 2569 สมดุล/);
    assert.equal(root.querySelector('.acc-integrity'), null, 'no red banner when everything balances');
    // r13: input VAT 2,878.05 (HIGH-2: + GR VAT 483.00), PND.53 735.75 (MED-7: + rent 560.75).
    const hq = w.ERPJournal.checks('2026-09', 'ubon');
    deepEqual(['outputVat', 'inputVat', 'pnd3', 'pnd53', 'sales'].map(id => [id, checkOf(hq, id).level, checkOf(hq, id).values.gl]), [['outputVat', 'ok', 528990], ['inputVat', 'ok', 287805], ['pnd3', 'ok', 30000], ['pnd53', 'ok', 73575], ['sales', 'ok', 7907000]]);
    const all = w.ERPJournal.checks('2026-09', 'all');
    deepEqual(all.failed, []);
    deepEqual(['trial', 'ledgers', 'inventory', 'wip', 'interBranch', 'chart', 'ar'].map(id => checkOf(all, id).level), Array(7).fill('ok'));
    assert.equal(checkOf(all, 'inventory').values.gl, checkOf(all, 'inventory').values.report);
    assert.equal(checkOf(checkOf(all, 'outputVat', 'khonkaen') ? all : all, 'outputVat', 'khonkaen').values.gl, 462560);
    // The pack tab lists the same checks with ✓; the ledger of output VAT shows the month's lines with a running balance.
    w.ERPJournal.select({ tab: 'pack' });
    assert.ok(d.querySelectorAll('#acc-root .acc-check-ok').length >= 15);
    assert.match(text(root), /ภาษีขายในบัญชี = ภ\.พ\.30 ช่อง 5 \(฿5,289\.90\) · สำนักงานใหญ่/);
    w.ERPJournal.select({ tab: 'ledger', account: '2154', branch: 'ubon' });
    const ledger = w.ERPJournal.view().ledger;
    assert.equal(ledger.credit - ledger.debit, 528990, 'September output VAT of HQ');
    assert.equal(ledger.rows[ledger.rows.length - 1].balance, ledger.closing);
    // Click from the trial balance to a ledger.
    w.ERPJournal.select({ tab: 'trial', branch: 'all' });
    root.querySelector('[data-acc-ledger="1161"]').click();
    assert.equal(w.ERPJournal.state().tab, 'ledger');
    assert.equal(w.ERPJournal.view().ledger.code, '1161');
    for (const tab of ['journal', 'manual', 'opening']) { w.ERPJournal.select({ tab }); assert.ok(text(root).length > 200, tab); }
    deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('japp#2 the chart of accounts card (ตั้งค่าบริษัท, visible in simple mode): recode + rename shows everywhere; a bad chart is refused', async () => {
  const h = await seeded(); const { w } = h; const d = w.document;
  try {
    w.go('saas-admin', null);
    await sleep(20);
    const card = d.getElementById('acc-coa-card');
    assert.ok(card && card.childElementCount, 'drawn');
    assert.equal(card.parentElement.id, 'acc-settings-cards', 'inside the wrapper: the simple-mode rule hides only direct .card children');
    assert.equal(card.matches('#panel-saas-admin > .card'), false);
    assert.equal(d.getElementById('promptpay-card').matches('#panel-saas-admin > .card'), false);
    assert.match(text(card), /ไม่ใช่ผังบัญชีมาตรฐานของทางราชการ/);
    // AR 1130 → 1131 "ลูกหนี้การค้า-ในประเทศ" through the form.
    card.querySelector('[data-acc-coa-code="ar"]').value = '1131';
    card.querySelector('[data-acc-coa-name="ar"]').value = 'ลูกหนี้การค้า-ในประเทศ';
    card.querySelector('#acc-coa-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    deepEqual(JSON.parse(w.localStorage.getItem(SETTINGS_KEY)).accounts, { ar: { code: '1131', name: 'ลูกหนี้การค้า-ในประเทศ' } });
    await openBooks(w);
    const row = w.ERPJournal.view().tb.rows.find(r => r.ids.includes('ar'));
    assert.equal(row.code, '1131');
    assert.match(text(d.getElementById('acc-root')), /1131 ลูกหนี้การค้า-ในประเทศ/);
    // The account the company named is user data (not translated).
    assert.ok([...d.querySelectorAll('#acc-root [data-no-i18n]')].some(el => el.textContent === 'ลูกหนี้การค้า-ในประเทศ'));
    // AP on the AR code: an asset and a liability on one code → refused with the reason; nothing written.
    const before = w.localStorage.getItem(SETTINGS_KEY);
    const bad = w.ERPJournal.saveSettings({ accounts: { ar: { code: '1131', name: '' }, ap: { code: '1131', name: '' } } });
    assert.equal(bad.ok, false);
    assert.match(bad.message, /รหัส 1131 ใช้กับบัญชีต่างหมวด/);
    assert.equal(w.localStorage.getItem(SETTINGS_KEY), before);
    // An expense category to another account: the derived entries move with it.
    assert.equal(w.ERPJournal.saveSettings({ categories: { 'ค่าการตลาด': 'exp_other' } }).ok, true);
    const f = '2026-09';
    const mkt = w.ERPJournal.dataset().entries.filter(entry => entry.kind === 'expense' && entry.date.startsWith(f)).flatMap(entry => entry.lines).filter(line => line.category === 'ค่าการตลาด');
    assert.ok(mkt.length && mkt.every(line => line.account === 'exp_other'));
    deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('japp#3 exports offline: general journal CSV (documented columns, Dr = Cr), PEAK through the mapping, the month-end Excel pack, COGS at month end', async () => {
  const h = await seeded(); const { w } = h; const d = w.document;
  try {
    blockNetwork(w);
    await openBooks(w, { tab: 'journal' });
    const J = w.ERPJournal;
    const gj = csvRows(J.exportCsv('journal'));
    assert.equal(gj[0], 'ลำดับ,เลขที่รายการ,วันที่,สาขา,ประเภทรายการ,เลขที่เอกสาร,คำอธิบาย,รหัสบัญชี,ชื่อบัญชี,เดบิต,เครดิต,งาน,ข้อสังเกต');
    const table = J.exportRows('journal').sheets[0].rows;
    const total = table[table.length - 1];
    assert.equal(total[9], total[10], 'the total row: debit = credit');
    assert.equal(total[9], 436737.5); // r13#HIGH-2: + GR VAT 483.00
    assert.ok(table.slice(1, -1).every(r => r[1].startsWith('GJ6909-')));
    // PEAK: the documented best guess, then the accountant's own headers / order / date format.
    let peak = J.exportRows('peak').sheets[0].rows;
    deepEqual(peak[0], ['วันที่เอกสาร', 'เลขที่เอกสาร', 'อ้างอิง', 'คำอธิบาย', 'รหัสบัญชี', 'ชื่อบัญชี', 'เดบิต', 'เครดิต', 'สาขา']);
    assert.match(peak[1][0], /^\d{2}\/09\/2026$/);
    J.select({ tab: 'pack' });
    assert.match(text(d.getElementById('acc-root')), /ต้องตรวจกับเทมเพลตจริงของ PEAK ก่อนใช้/);
    assert.equal(J.saveSettings({ peak: { columns: [{ header: 'Date', field: 'date' }, { header: 'JV', field: 'entryNo' }, { header: 'Account', field: 'accountCode' }, { header: 'Dr', field: 'debit' }, { header: 'Cr', field: 'credit' }, { header: 'Memo', field: 'description' }], dateFormat: 'dmy-be' } }).ok, true);
    peak = J.exportRows('peak').sheets[0].rows;
    deepEqual(peak[0], ['Date', 'JV', 'Account', 'Dr', 'Cr', 'Memo']);
    assert.match(peak[1][0], /^\d{2}\/09\/2569$/);
    assert.match(peak[1][1], /^JV6909-0001$/);
    assert.equal(peak.slice(1).reduce((s, r) => s + Math.round(r[3] * 100), 0), peak.slice(1).reduce((s, r) => s + Math.round(r[4] * 100), 0));
    // The one-click month-end pack: one workbook, every report a sheet; written by the vendored SheetJS, offline.
    const appended = [];
    const original = d.head.appendChild.bind(d.head);
    d.head.appendChild = node => { if (node.tagName === 'SCRIPT') appended.push(node); return original(node); };
    J.select({ tab: 'pack' });
    d.querySelector('#acc-root [data-acc-table="pack"]').click();
    assert.equal(appended.length, 1);
    assert.equal(appended[0].getAttribute('src'), './vendor/xlsx-0.18.5.full.min.js');
    loadSheet(w);
    const books = [];
    w.XLSX.writeFile = (wb, file) => books.push({ wb, file });
    appended[0].onload();
    assert.equal(books.length, 1);
    assert.equal(books[0].file, 'month-end-pack_2026-09.xlsx');
    const back = w.XLSX.read(w.XLSX.write(books[0].wb, { type: 'array', bookType: 'xlsx' }), { type: 'array' });
    deepEqual(back.SheetNames, ['ใบปะหน้า', 'ภาษีขาย 00000', 'ภาษีซื้อ 00000', 'ภาษีซื้อต้องห้าม 00000', 'ภ.ง.ด.3 00000', 'ภ.ง.ด.53 00000', 'ภาษีขาย 00001', 'ภาษีซื้อ 00001', 'ภาษีซื้อต้องห้าม 00001', 'ภ.ง.ด.3 00001', 'ภ.ง.ด.53 00001', 'ลูกหนี้ตามอายุ', 'เจ้าหนี้ตามอายุ', 'สินค้าคงเหลือ', 'งานระหว่างทำ', 'งบทดลอง', 'สมุดรายวันทั่วไป', '50 ทวิ ที่ได้รับ', 'ต้องตรวจ', 'เอกสารแนบ']); // r13#LOW-7: + WHT certificates received, follow-ups, checklist
    const sheet = name => JSON.parse(JSON.stringify(w.XLSX.utils.sheet_to_json(back.Sheets[name], { header: 1, defval: '' })));
    const cover = sheet('ใบปะหน้า');
    assert.equal(cover[0][0], 'ชุดปิดเดือนส่งนักบัญชี');
    assert.ok(cover.some(r => r[0] === 'ผ่าน' && /งบทดลองสมดุล/.test(r[1])));
    assert.ok(!cover.some(r => r[0] === 'ไม่ผ่าน'));
    deepEqual(cover.find(r => r[0] === 'ภาษีขาย'), ['ภาษีขาย', 9915.5]);
    deepEqual(cover.find(r => r[0] === 'ภาษีซื้อ'), ['ภาษีซื้อ', 3676.19]); // r13#HIGH-2: + GR VAT 483.00
    const tb = sheet('งบทดลอง');
    deepEqual(tb[tb.length - 1].slice(5, 7), [436737.5, 436737.5]); // r13#HIGH-2
    assert.ok(sheet('ภ.ง.ด.3 00000').length > 1);
    // COGS as one month-end entry per establishment (non-stock items in the accountant's program): same totals.
    const cogsLines = rows => rows.filter(r => r[7] === '5110');
    const before = cogsLines(J.exportRows('journal').sheets[0].rows);
    d.getElementById('acc-cogs-month-end').checked = true;
    d.getElementById('acc-cogs-month-end').dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.equal(JSON.parse(w.localStorage.getItem(SETTINGS_KEY)).export.cogsMonthEnd, true);
    const journal = J.exportRows('journal').sheets[0].rows;
    const after = cogsLines(journal);
    const net = list => list.reduce((s, r) => s + Math.round(r[9] * 100) - Math.round(r[10] * 100), 0);
    assert.equal(net(after), net(before));
    assert.ok(journal.filter(r => r[4] === 'ต้นทุนขาย').every(r => r[2] === '2026-09-30'), 'cost of sales on the last day');
    assert.ok(new Set(journal.filter(r => r[4] === 'ต้นทุนขาย').map(r => r[1])).size <= 2, 'one entry per establishment');
    deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('japp#4 manual entries through the form; cancel = reversal today; every journal-producing change refused in a closed period, nothing written', async () => {
  const h = await seeded(); const { w } = h; const d = w.document;
  try {
    await openBooks(w, { tab: 'manual', branch: 'ubon', period: '2026-10' });
    d.getElementById('acc-m-date').value = '2026-10-20';
    d.getElementById('acc-m-memo').value = 'ค่าเสื่อมราคา ต.ค.';
    const set = (i, key, value) => { const el = d.querySelector(`#acc-manual-form [data-acc-ml="${key}"][data-index="${i}"]`); el.value = value; };
    set(0, 'account', 'exp_other'); set(0, 'debit', '1500');
    set(1, 'account', 'cash'); set(1, 'credit', '1500');
    d.getElementById('acc-manual-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    const docs = JSON.parse(w.localStorage.getItem(DOCS_KEY));
    assert.equal(docs.manual.length, 1);
    deepEqual([docs.manual[0].no, docs.manual[0].memo, docs.manual[0].lines.map(l => [l.account, l.debit, l.credit])], ['JV6910-0001', 'ค่าเสื่อมราคา ต.ค.', [['exp_other', 150000, 0], ['cash', 0, 150000]]]);
    // Cancel (the reason is asked): a reversing entry today (21 Oct), the original stays.
    w.prompt = () => 'บันทึกซ้ำ';
    await sleep(10);
    w.ERPJournal.select({ tab: 'manual' });
    d.querySelector('#acc-root [data-acc-void="manual"]').click();
    const manual = w.ERPJournal.dataset().entries.filter(entry => entry.kind === 'manual');
    deepEqual(manual.map(entry => [entry.date, !!entry.reversalOf]), [['2026-10-20', false], ['2026-10-21', true]]);
    assert.equal(JSON.parse(w.localStorage.getItem(DOCS_KEY)).manual[0].status, 'voided');
    // Close the head office through 30 Sep (sales) — the same Thai text as every period lock.
    w.ERPGovernance.lockPeriod({ branch: 'ubon', scope: 'sales', throughDate: '2026-09-30', reason: 'ยื่น ภ.พ.30 แล้ว' });
    const lockText = w.ERPGovernance.periodLockRefusal({ scope: 'sales', branch: 'ubon', date: '2026-09-30', action: 'journal' });
    assert.ok(lockText);
    const snapshot = () => [w.localStorage.getItem(SETTINGS_KEY), w.localStorage.getItem(DOCS_KEY), w.localStorage.getItem(PRODUCTS_KEY), w.localStorage.getItem(COSTING_KEY)];
    const before = snapshot();
    const J = w.ERPJournal;
    const manualSept = J.saveManual({ date: '2026-09-15', branch: 'ubon', memo: 'x', lines: [{ account: 'cash', debit: '1' }, { account: 'bank', credit: '1' }] });
    deepEqual([manualSept.ok, manualSept.message], [false, lockText]);
    const close = J.closeOverhead({ branch: 'ubon', period: '2026-09' });
    assert.equal(close.ok, false);
    assert.equal(close.message, w.ERPGovernance.periodLockRefusal({ scope: 'sales', branch: 'ubon', date: '2026-09-30', action: 'journal' }));
    const nrv = J.postNrv({ date: '2026-09-30', branch: 'ubon' });
    assert.equal(nrv.ok, false);
    // A posting default that would change closed entries (receipts → cash): refused; renaming an account is not.
    const posting = J.saveSettings({ posting: { receiptAccount: 'cash', cashSaleAccount: 'cash', expensePaidFrom: 'bank', refundAccount: 'cash' } });
    deepEqual([posting.ok, posting.message], [false, J.dataset().entries.length ? posting.message : '']);
    assert.match(posting.message, /ปิด|ล็อก/);
    deepEqual(snapshot(), before, 'nothing written');
    assert.equal(J.saveSettings({ accounts: { cash: { code: '1111', name: 'เงินสดย่อย' } } }).ok, true, 'presentation only: allowed');
    // After the closed date: accepted; the branch (not locked) is accepted in September.
    assert.equal(J.saveManual({ date: '2026-10-01', branch: 'ubon', memo: '', lines: [{ account: 'cash', debit: '1' }, { account: 'bank', credit: '1' }] }).ok, true);
    assert.equal(J.saveManual({ date: '2026-09-15', branch: 'khonkaen', memo: '', lines: [{ account: 'cash', debit: '1' }, { account: 'bank', credit: '1' }] }).ok, true);
    deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('japp#5 opening balances: CSV preview (nothing written) → commit (stock to Product Master + costing, AR / AP items) → refused when closed', async () => {
  const h = await seeded(); const { w } = h; const d = w.document;
  try {
    await openBooks(w, { tab: 'opening' });
    const J = w.ERPJournal;
    // Without an import the opening date is the day before the first entry of the sample.
    const asOf = J.dataset().journal.openingDate;
    const first = J.dataset().entries.filter(entry => entry.kind !== 'opening').map(entry => entry.date).sort()[0];
    assert.ok(asOf < first, `${asOf} < ${first}`);
    const csv = ['ประเภท,สาขา,รหัส,ชื่อ,เลขที่เอกสาร,วันที่เอกสาร,วันครบกำหนด,จำนวน,ต้นทุนต่อหน่วย,ยอดคงค้าง', 'STOCK,00000,DEMO-NB01,,,,,7,19500,', 'AR,00000,C-OLD,บจก. ลูกค้าเก่า,INV-OLD-1,15/05/2569,14/06/2569,,,"10,700.00"', 'AP,00001,S-OLD,บจก. ผู้ขายเก่า,PI-OLD-1,2026-05-20,,,,5350'].join('\r\n');
    const before = [w.localStorage.getItem(DOCS_KEY), w.localStorage.getItem(PRODUCTS_KEY), w.localStorage.getItem(COSTING_KEY)];
    const preview = J.previewOpening(csv, asOf);
    assert.equal(preview.ok, true, JSON.stringify(preview.plan.rows.map(r => r.errors)));
    await sleep(10);
    deepEqual([w.localStorage.getItem(DOCS_KEY), w.localStorage.getItem(PRODUCTS_KEY), w.localStorage.getItem(COSTING_KEY)], before, 'a preview writes nothing');
    assert.match(text(d.getElementById('acc-root')), /ตรวจผ่านทั้ง 3 บรรทัด: ลูกหนี้ ฿10,700\.00 · เจ้าหนี้ ฿5,350\.00 · สินค้า ฿136,500\.00/);
    assert.equal(d.querySelector('#acc-opening-form button[type="submit"]').disabled, false);
    // A bad file: the preview says which lines and why; the commit button stays disabled.
    const bad = J.previewOpening(csv.replace('DEMO-NB01', 'DEMO-SV01'), asOf);
    assert.equal(bad.ok, false);
    await sleep(10);
    assert.match(text(d.getElementById('acc-root')), /สินค้านี้ไม่นับสต็อก/);
    assert.equal(d.querySelector('#acc-opening-form button[type="submit"]').disabled, true);
    J.previewOpening(csv, asOf);
    const done = J.commitOpening();
    assert.equal(done.ok, true, done.message);
    const products = JSON.parse(w.localStorage.getItem(PRODUCTS_KEY));
    const nb = products.find(p => p.code === 'DEMO-NB01');
    deepEqual([nb.openingStockUbon, nb.openingStock], [7, 7 + (nb.openingStockKhonkaen || 0)]);
    assert.equal(JSON.parse(w.localStorage.getItem(COSTING_KEY)).openingCosts['code:demo-nb01'], 19500);
    const data = J.dataset();
    assert.equal(data.journal.openingDate, asOf);
    const ar = data.entries.find(entry => entry.kind === 'opening_ar');
    deepEqual(ar.lines.map(l => [l.account, l.branch, l.debit, l.credit]), [['ar', 'ubon', 1070000, 0], ['opening_equity', 'ubon', 0, 1070000]]);
    const ap = data.entries.find(entry => entry.kind === 'opening_ap');
    deepEqual(ap.lines.map(l => [l.account, l.branch, l.debit, l.credit]), [['ap', 'khonkaen', 0, 535000], ['opening_equity', 'khonkaen', 535000, 0]]);
    assert.equal(w.ERPJournal.checks('2026-09', 'all').failed.length, 0, 'the books still reconcile (stock = valuation)');
    // Closed: an import dated in a closed period is refused with the lock text, nothing written.
    w.ERPGovernance.lockPeriod({ branch: 'all', scope: 'all', throughDate: '2026-08-31', reason: 'ปิดงวด' });
    const snap = [w.localStorage.getItem(DOCS_KEY), w.localStorage.getItem(PRODUCTS_KEY), w.localStorage.getItem(COSTING_KEY)];
    J.previewOpening(csv.replace('INV-OLD-1', 'INV-OLD-2').replace('PI-OLD-1', 'PI-OLD-2'), asOf);
    const refused = J.commitOpening();
    assert.equal(refused.ok, false);
    assert.equal(refused.message, w.ERPGovernance.periodLockRefusal({ scope: 'all', branch: 'ubon', date: asOf, action: 'opening' }) || refused.message);
    assert.match(refused.message, /ปิด|ล็อก/);
    deepEqual([w.localStorage.getItem(DOCS_KEY), w.localStorage.getItem(PRODUCTS_KEY), w.localStorage.getItem(COSTING_KEY)], snap);
    deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('japp#6 the red integrity banner when the books do not reconcile (a damaged chart); a damaged store is said, never shown as zeros', async () => {
  const h = await seeded(); const { w } = h; const d = w.document;
  try {
    // Written behind the page's back (another tab / an old version): AP on the AR code.
    w.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...JSON.parse(JSON.stringify(w.ERPJournal.dataset().settings)), accounts: { ap: { code: '1130', name: '' } } }));
    w.ERPJournal.invalidate();
    await openBooks(w);
    const banner = d.querySelector('#acc-root .acc-integrity');
    assert.ok(banner, 'red banner');
    assert.equal(banner.getAttribute('role'), 'alert');
    assert.match(text(banner), /ข้อมูลบัญชีไม่ลงตัว.*ผังบัญชีมีปัญหา 1 รายการ: รหัส 1130 ใช้กับบัญชีต่างหมวด \(เจ้าหนี้การค้า และ ลูกหนี้การค้า\)/);
    w.localStorage.setItem(DOCS_KEY, '{"schemaVersion":1,"manual":"x"}');
    w.ERPJournal.invalidate();
    w.ERPJournal.render();
    assert.match(text(d.getElementById('acc-root')), /ข้อมูลการตั้งค่าบัญชีเสียหาย|ข้อมูลรายการบัญชีที่บันทึกไว้ไม่ถูกต้อง/);
    assert.equal(d.querySelector('#acc-root .acc-trial-table'), null, 'no table of zeros');
    deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('japp#7 English: every tab, the pack and both settings cards in English (THB, A.D. dates), the same figures, no Thai UI text', async () => {
  const h = await seeded({ english: true }); const { w } = h; const d = w.document;
  try {
    await openBooks(w);
    await settle(w, 20);
    for (const tab of ['journal', 'ledger', 'trial', 'pack', 'manual', 'opening']) {
      w.ERPJournal.select({ tab });
      await settle(w, 10);
      deepEqual(thaiOutsideUserData(d.getElementById('acc-root')), [], `${tab}: no Thai UI text`);
      assert.doesNotMatch(text(d.getElementById('acc-root')), /฿/, `${tab}: THB`);
    }
    w.ERPJournal.select({ tab: 'pack' });
    assert.match(text(d.getElementById('acc-root')), /Output VAT in the books = PP\.30 line 5 \(THB 5,289\.90\) · Head office/);
    w.ERPJournal.select({ tab: 'trial' });
    assert.match(text(d.getElementById('acc-root')), /Trial balance — Sep 2026 Balanced/);
    w.go('saas-admin', null);
    await settle(w, 30);
    deepEqual(thaiOutsideUserData(d.getElementById('acc-coa-card')), []);
    deepEqual(thaiOutsideUserData(d.getElementById('promptpay-card')), []);
    assert.match(text(d.getElementById('acc-coa-card')), /Chart of accounts & automatic posting/);
    // The QR box is printed in Thai and English already: the English print layer adds no second label inside it.
    assert.equal(w.ERPPromptPay.saveSettings({ ...w.ERPPromptPay.readSettings(), enabled: true, idType: 'tax_id', promptPayId: '0105561007075' }).ok, true);
    const invoice = h.plan.documents.find(x => x.collection === 'invoices' && x.record.no === 'INV690904').record;
    const html = w.ERPI18n.bilingualHtml(w.ComformDeliveryTaxDocument.buildInlineHtml(invoice, { b: 'ubon' }));
    const box = /<div class="erp-ppqr"[^]*?<\/svg><div[^]*?<\/div><\/div><\/div>/.exec(html)[0];
    assert.match(box, /data-bilingual/);
    assert.doesNotMatch(box, /lang="en"/, 'no added English label inside the box');
    assert.match(box, /14,445\.00 บาท<\/b>/);
    deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('japp#8 JSON backup: chart, journal documents and PromptPay settings round-trip; a damaged part refuses the whole file; reset keeps settings only', async () => {
  let exported;
  let settings;
  let documents;
  let promptpay;
  {
    const h = await seeded(); const { w } = h;
    try {
      const J = w.ERPJournal;
      assert.equal(J.saveSettings({ accounts: { bank: { code: '1112', name: 'ธ.กสิกรไทย ออมทรัพย์' } } }).ok, true);
      assert.equal(J.saveManual({ date: '2026-10-20', branch: 'ubon', memo: 'ทดสอบ', lines: [{ account: 'cash', debit: '10' }, { account: 'bank', credit: '10' }] }).ok, true);
      assert.equal(w.ERPPromptPay.saveSettings({ ...w.ERPPromptPay.readSettings(), enabled: true, idType: 'tax_id', promptPayId: '0105561007075' }).ok, true);
      const master = w.testApp.collectLocalMasterBackup();
      assert.equal(master.accounting.documents.manual.length, 1);
      assert.equal(master.promptpay.enabled, true);
      settings = w.localStorage.getItem(SETTINGS_KEY);
      documents = w.localStorage.getItem(DOCS_KEY);
      promptpay = w.localStorage.getItem(PP_KEY);
      exported = JSON.parse(JSON.stringify(await w.ERPBackup.portable({ meta: { app: 'comform-esan', backupType: 'all' }, data: {}, masterData: master })));
      assert.equal((await w.ERPBackup.verifyPortable(exported)).verified, true);
      for (const [label, damage, pattern] of [
        ['unknown field', b => { b.masterData.accounting.documents.manual[0].hacked = 1; }, /รายการบัญชี/],
        ['unbalanced', b => { b.masterData.accounting.documents.manual[0].lines[0].debit = 999; }, /เดบิตไม่เท่าเครดิต/],
        ['bad chart', b => { b.masterData.accounting.settings.posting.receiptAccount = 'ar'; }, /ตั้งค่าบัญชี|ไม่ถูกต้อง/],
        ['bad PromptPay', b => { b.masterData.promptpay.idType = 'bank'; }, /พร้อมเพย์|PromptPay/],
        ['not an object', b => { b.masterData.accounting = [1]; }, /บัญชี/]
      ]) {
        const tampered = JSON.parse(JSON.stringify(exported));
        damage(tampered);
        assert.throws(() => w.ERPBackup.validate(tampered), pattern, label);
      }
      // Reset: the chart and the PromptPay settings are company settings (kept); the journal documents are removed.
      const reset = await w.ERPDemoSeed.reset({ confirm: () => true });
      assert.equal(reset.status, 'reset');
      assert.equal(w.localStorage.getItem(SETTINGS_KEY), settings);
      assert.equal(w.localStorage.getItem(PP_KEY), promptpay);
      assert.equal(w.localStorage.getItem(DOCS_KEY), null);
      w.ERPJournal.invalidate();
      assert.equal(w.ERPJournal.dataset().entries.filter(entry => entry.kind === 'manual').length, 0);
      deepEqual(h.errors, []);
    } finally { h.close(); }
  }
  {
    const h = await boot({ beforeScripts: pinClock(DAY) }); const { w } = h;
    try {
      assert.equal(w.localStorage.getItem(DOCS_KEY), null);
      w.ERPBackup.validate(exported);
      w.testApp.restoreLocalMasterBackup(exported.masterData, { replace: true });
      deepEqual(JSON.parse(w.localStorage.getItem(DOCS_KEY)), JSON.parse(documents));
      deepEqual(JSON.parse(w.localStorage.getItem(SETTINGS_KEY)), JSON.parse(settings));
      deepEqual(JSON.parse(w.localStorage.getItem(PP_KEY)), JSON.parse(promptpay));
      // An older backup without these parts leaves this device's alone.
      const kept = w.localStorage.getItem(DOCS_KEY);
      w.testApp.restoreLocalMasterBackup({ contacts: [] }, { replace: false });
      assert.equal(w.localStorage.getItem(DOCS_KEY), kept);
      // A file that would change a journal document inside a closed period is refused (nothing written).
      w.ERPGovernance.lockPeriod({ branch: 'all', scope: 'all', throughDate: '2026-10-31', reason: 'ปิดงวด' });
      const changed = JSON.parse(JSON.stringify(exported.masterData));
      changed.accounting.documents.manual[0].memo = 'แก้ไข';
      assert.throws(() => w.testApp.restoreLocalMasterBackup(changed, { replace: true }), /งวดที่ปิดแล้ว/);
      assert.equal(w.localStorage.getItem(DOCS_KEY), kept);
      deepEqual(h.errors, []);
    } finally { h.close(); }
  }
});

test('japp#9 one establishment: no branch filter, everything at the head office, the books still balance and tie (ภ.พ.30 of the one return)', async () => {
  const h = await seeded({ single: true }); const { w } = h; const d = w.document;
  try {
    await openBooks(w);
    for (const tab of ['journal', 'ledger', 'trial', 'pack', 'manual']) {
      w.ERPJournal.select({ tab });
      assert.equal(d.getElementById('acc-branch'), null, `${tab}: no branch filter with one establishment`);
      assert.doesNotMatch(text(d.getElementById('acc-root')), /สาขาที่ 00001/, tab);
    }
    const checks = w.ERPJournal.checks('2026-09', 'ubon');
    deepEqual(checks.failed, []);
    deepEqual(['outputVat', 'inputVat', 'pnd3', 'pnd53'].map(id => checkOf(checks, id).level), ['ok', 'ok', 'ok', 'ok']);
    assert.equal(checkOf(checks, 'outputVat').values.gl, 991550, 'one return: 5,289.90 + 4,625.60');
    assert.ok(w.ERPJournal.dataset().entries.every(entry => entry.lines.every(line => line.branch === 'ubon')));
    deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('japp#10 PromptPay QR: off → the invoice, receipt and billing prints are byte-identical to the build without it; on → the box reads back to the payload', async () => {
  const h = await seeded(); const { w } = h; const d = w.document;
  try {
    const docs = h.plan.documents;
    const invoice = docs.find(x => x.collection === 'invoices' && x.branch === 'ubon' && x.record.taxInvoiceForm !== 'abbreviated' && x.record.vatMode === 'add' && !x.record.voided).record;
    const abbreviated = docs.find(x => x.collection === 'invoices' && x.record.taxInvoiceForm === 'abbreviated').record;
    const receipt = docs.find(x => x.collection === 'receipts' && x.record.no === 'REC690901').record;
    const billing = { no: 'BL6910-0099', status: 'issued', totalBilled: 21400, outstandingAmount: 21400 };
    const prints = () => ({
      invoice: w.ComformDeliveryTaxDocument.buildInlineHtml(invoice, { b: 'ubon' }),
      copy: w.ComformDeliveryTaxDocument.buildInlineHtml(invoice, { b: 'ubon' }, 'copy'),
      abbreviated: w.ComformDeliveryTaxDocument.buildInlineHtml(abbreviated, { b: abbreviated.branch || 'ubon' }),
      receipt: w.ComformReceiptDocument.buildInlineHtml(receipt, { b: 'khonkaen' })
    });
    // The build without the module (window.ERPPromptPay absent) vs QR off (the default): identical strings.
    const api = w.ERPPromptPay;
    w.ERPPromptPay = undefined;
    const without = prints();
    w.ERPPromptPay = api;
    assert.equal(api.readSettings().enabled, false, 'default OFF');
    deepEqual(prints(), without);
    assert.equal(api.billingBoxHtml(billing), '');
    assert.doesNotMatch(Object.values(without).join(''), /erp-ppqr|สแกนจ่าย/);
    // On, by the tax ID of the company: the box on the final page of the original only; the copy unchanged.
    w.go('saas-admin', null);
    await sleep(20);
    const card = d.getElementById('promptpay-card');
    card.querySelector('#pp-enabled').checked = true;
    card.querySelector('#pp-id-type').value = 'tax_id';
    card.querySelector('#pp-id').value = '0105561007076';
    card.querySelector('#pp-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(w.localStorage.getItem(PP_KEY), null, 'a wrong check digit is refused, nothing written');
    assert.ok(h.messages.some(m => /หลักตรวจสอบไม่ตรง/.test(m)));
    d.getElementById('pp-id').value = '0105561007075';
    d.getElementById('pp-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(JSON.parse(w.localStorage.getItem(PP_KEY)).enabled, true);
    const on = prints();
    assert.equal(on.copy, without.copy, 'the accounting copy has no QR');
    const decode = (html, amount) => {
      assert.match(html, /สแกนจ่ายด้วยพร้อมเพย์/);
      assert.equal((html.match(/class="erp-ppqr"/g) || []).length, 1, 'one box, on the final page');
      const svg = /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^]*?<\/svg>/.exec(html.slice(html.indexOf('erp-ppqr')))[0];
      const payload = readQr(matrixFromSvg(svg).matrix).text;
      assert.equal(payload, w.ERPPromptPay.buildPromptPayPayload({ type: 'tax_id', id: '0105561007075', amount }).payload);
      assert.match(html, new RegExp(`ยอดชำระ / Amount <b[^>]*>${amount.toLocaleString('en-US', { minimumFractionDigits: 2 }).replace(/\./g, '\\.')} บาท`));
      return payload;
    };
    decode(on.invoice, invoice.total);
    decode(on.abbreviated, abbreviated.total);
    // The receipt: the cash received after the customer's withholding (16,585.00 − 465.00 = 16,120.00).
    assert.match(decode(on.receipt, 16120), /540816120\.00/);
    // Laid over the empty filler rows above the fixed bottom area (nothing else moves): removing it gives the print back.
    const overlay = /<div style="position:absolute;left:1\.4%[^>]*><div class="erp-ppqr"[^]*?<\/svg><div[^]*?<\/div><\/div><\/div><\/div>/;
    assert.match(on.invoice, overlay);
    assert.equal(on.invoice.replace(overlay, ''), without.invoice, 'only the box was added');
    assert.equal(on.receipt.replace(overlay, ''), without.receipt, 'receipt: only the box was added');
    // A final page with fewer than 5 empty rows (12 one-line items of 16): the box gets a page of its own, items untouched.
    const long = { ...invoice, id: 'long-1', no: 'INV-LONG', items: Array.from({ length: 12 }, (_, i) => ({ product: `สินค้า ${i + 1}`, productCode: '', qty: 1, unit: 'ชิ้น', priceUnit: 100, total: 100 })), subtotal: 1200, vatAmt: 84, total: 1284 };
    w.ERPPromptPay = undefined;
    const longOff = w.ComformDeliveryTaxDocument.buildInlineHtml(long, { b: 'ubon' });
    w.ERPPromptPay = api;
    const longOn = w.ComformDeliveryTaxDocument.buildInlineHtml(long, { b: 'ubon' });
    assert.equal((longOn.match(/data-ppqr-page="1"/g) || []).length, 1);
    assert.ok(longOn.startsWith(longOff.slice(0, longOff.lastIndexOf('</article>'))), 'the invoice pages are unchanged');
    assert.equal(readQr(matrixFromSvg(/<svg xmlns[^]*?<\/svg>/.exec(longOn.slice(longOn.indexOf('data-ppqr-page')))[0]).matrix).text, w.ERPPromptPay.buildPromptPayPayload({ type: 'tax_id', id: '0105561007075', amount: 1284 }).payload);
    // The billing note: the amount still open; paid → no box. printBilling writes it into the print window.
    assert.match(api.billingBoxHtml(billing), /21,400\.00 บาท/);
    assert.equal(api.billingBoxHtml({ ...billing, status: 'paid', outstandingAmount: 0 }), '');
    let written = '';
    w.open = () => ({ document: { write: html => { written += html; }, close() {} }, focus() {} });
    const seedBilling = h.plan.flow.billingNotes[0];
    w.ERPOrderFlow.printBilling(seedBilling.id);
    assert.match(written, /ใบวางบิล/);
    assert.doesNotMatch(written, /erp-ppqr/, 'the sample billing note is paid: nothing to scan');
    // A cancelled invoice never carries a QR.
    assert.doesNotMatch(w.ComformDeliveryTaxDocument.buildInlineHtml({ ...invoice, status: 'cancelled', voided: true, voidedAt: '2026-10-01T00:00:00Z', cancelReason: 'ทดสอบ' }, { b: 'ubon' }), /erp-ppqr/);
    // Off again: back to the identical prints.
    assert.equal(api.saveSettings({ ...api.readSettings(), enabled: false }).ok, true);
    deepEqual(prints(), without);
    deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('japp#11 round-11 polish: the profit tables show "ยอดขายที่มีต้นทุน" next to sales; the total row GP = costed sales − cost, visibly', async () => {
  const h = await seeded(); const { w } = h; const d = w.document;
  try {
    w.go('job-costing', null);
    await sleep(10);
    for (const dimension of ['job', 'customer', 'product', 'month']) {
      w.ERPCosting.select({ tab: 'profit', branch: 'all', dimension, periodType: 'all', period: '' });
      const heads = [...d.querySelectorAll('#jc-root table thead th')].map(text);
      assert.equal(heads[1], 'ยอดขาย (ก่อน VAT)', dimension);
      assert.equal(heads[2], 'ยอดขายที่มีต้นทุน', dimension);
      const rows = w.ERPCosting.exportRows('profit').rows;
      const total = rows[rows.length - 1];
      assert.equal(Math.round(total[2] * 100) - Math.round(total[3] * 100), Math.round(total[4] * 100), `${dimension}: GP = costed sales − cost`);
    }
    // All periods, by customer: sales 813,972.90 (ADR-031: + the USD export 97,962.90 — a non-stock line without a job, so not
    // in "ยอดขายที่มีต้นทุน") · costed 574,490 − cost 449,150 = GP 125,340 (21.8 %).
    w.ERPCosting.select({ tab: 'profit', dimension: 'customer', periodType: 'all', period: '' });
    assert.match(text(d.querySelector('#jc-root tfoot')), /รวม ?฿813,972\.90 ?฿574,490\.00 ?฿449,150\.00 ?฿125,340\.00 ?21\.8%/);
    // The NRV card's optional posting (Dr 5130 loss / Cr 1162 allowance): the two 9U racks, 2 × 600 = 1,200.00 at today.
    w.ERPCosting.select({ tab: 'valuation', valuationDate: DAY });
    const button = d.querySelector('#jc-root [data-jc-nrv-post]');
    assert.ok(button, 'the post button on the NRV card');
    button.click();
    const nrv = JSON.parse(w.localStorage.getItem(DOCS_KEY)).nrv;
    deepEqual(nrv.map(doc => [doc.date, doc.branch, doc.target, doc.delta]), [[DAY, 'ubon', 60000, 60000], [DAY, 'khonkaen', 60000, 60000]]);
    const entries = w.ERPJournal.dataset().entries.filter(entry => entry.kind === 'nrv');
    deepEqual(entries.map(entry => entry.lines.map(l => [l.account, l.debit, l.credit])), [[['nrv_loss', 60000, 0], ['inventory_allowance', 0, 60000]], [['nrv_loss', 60000, 0], ['inventory_allowance', 0, 60000]]]); // one per establishment (same lines)
    assert.equal(w.ERPJournal.postNrv({ date: DAY, branch: 'all' }).ok, false, 'already booked: nothing to post');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});
