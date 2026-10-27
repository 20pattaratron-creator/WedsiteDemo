// ADR-024 (round 8, stage D) in the booted app (jsdom): ใบเพิ่มหนี้ in โหมดง่าย (sidebar entry, list with the sample
// DN690901), issued from the invoice "⋯" menu through the form, the printed document (spec AC4.6 items ก–ฉ, profile,
// baht text), the receivable it adds agreeing on the AR report / dashboard banner / governance aging / Decision Council /
// Customer 360, collected by a receipt, cancel rules (period lock and collected money refused BEFORE any question,
// invoice cancel blocked by a live debit note), Excel without network, backup round trip and one-branch mode.
// Pure rules: tests/debit-note-core.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot } = require('./dom-helper.cjs');

const ROOT = path.resolve(__dirname, '..');
const TENANT = 'erp_tenant::customer-showcase-local::';
const SETTING_KEY = `${TENANT}comform_company_branch_setting_v1`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = el => String(el?.textContent || '').replace(/\s+/g, ' ').trim();
const plain = value => JSON.parse(JSON.stringify(value));
const said = h => [...h.messages, ...[...h.w.document.querySelectorAll('.app-toast-msg')].map(el => el.textContent)].join('\n');
const clearSaid = h => { h.messages.length = 0; h.w.document.querySelectorAll('.app-toast').forEach(el => el.remove()); };
const round2 = n => Math.round(n * 100) / 100;
async function waitFor(check, tries = 120) { for (let i = 0; i < tries && !check(); i++) await sleep(25); return check(); }

async function bootWithSample(options = {}) {
  const h = await boot(options);
  const result = await h.w.ERPDemoSeed.load({ today: '2026-10-04', confirm: () => true });
  assert.equal(result.status, 'loaded', said(h));
  return h;
}
function change(w, el, value) {
  el.value = value;
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
  el.dispatchEvent(new w.Event('change', { bubbles: true }));
}
const menuItems = d => [...(d.querySelector('.erp-menu.erp-rowact-menu')?.querySelectorAll('[role="menuitem"]') || [])];
function invoiceCell(w, no) {
  w.go('invoice-list', null);
  w.document.getElementById('il-year').value = '2026';
  w.document.getElementById('il-month').value = '';
  w.renderIList();
  return [...w.document.querySelectorAll('#itbl .erp-rowact')].find(cell => JSON.parse(cell.dataset.rowFacts).no === no);
}
function chooseFromMenu(w, cell, label) {
  cell.querySelector('[data-row-menu]').click();
  const item = menuItems(w.document).find(el => text(el).endsWith(label));
  assert.ok(item, `menu item ${label} in [${menuItems(w.document).map(text).join(', ')}]`);
  item.click();
}
// Fills the form opened for an invoice and saves; returns the stored note (or false).
async function issueFromForm(w, { increase, reason = 'goods_price_undercharged', date = '2026-10-03' }) {
  const d = w.document;
  change(w, d.getElementById('dn-date'), date);
  change(w, d.getElementById('dn-reason'), reason);
  const input = d.querySelector('[data-dn-line-field="increase"][data-index="0"]');
  assert.ok(input, 'one invoice line in the form');
  change(w, input, String(increase));
  return w.ERPDebitNotes.save();
}

test('dnui#1 โหมดง่าย: sidebar entry + list with the sample DN690901; "⋯ › ออกใบเพิ่มหนี้" on an invoice fills the form; save → numbered, branch-aware, in the list; AC4.6 printed document', async () => {
  const h = await bootWithSample(); const { w } = h; const d = w.document;
  try {
    assert.equal(w.ERPProductExperience?.mode?.() ?? 'simple', 'simple');
    const entryOf = () => [...d.querySelectorAll('.sidebar .nav-item')].find(item => (item.getAttribute('onclick') || '').includes("go('debit-note-list'"));
    assert.ok(await waitFor(() => entryOf()?.closest('.nav-group')), 'grouped sidebar arranged');
    const entry = entryOf();
    assert.ok(entry && !entry.hidden, 'ใบเพิ่มหนี้ visible in โหมดง่าย');
    assert.equal(text(entry), 'ใบเพิ่มหนี้');
    assert.equal(entry.closest('.nav-group')?.dataset.navSection, 'sales');
    w.go('debit-note-list', entry);
    change(w, d.getElementById('dnl-year'), '2026');
    const rows = [...d.querySelectorAll('#dnltbl tr')];
    assert.equal(rows.length, 1);
    assert.match(text(rows[0]), /DN690901.*บจก\. สยามเกษตรอุบล.*INV690910.*฿1,500\.00.*฿105\.00.*฿1,605\.00.*ใช้งาน/);
    // From the invoice menu (the real handler): INV690904 (U6, full tax invoice of 22 Sept, 13,500 + VAT).
    const cell = invoiceCell(w, 'INV690904');
    assert.ok(cell);
    chooseFromMenu(w, cell, 'ออกใบเพิ่มหนี้');
    assert.ok(d.getElementById('panel-debit-note-form').classList.contains('active'), 'the form opened');
    const state = w.ERPDebitNotes.getFormState();
    assert.deepEqual([state.branch, state.lines.length, state.lines[0].ref.no], ['ubon', 1, 'INV690904']);
    assert.equal(d.getElementById('dn-cust').value, 'รพ.รวมแพทย์อุบล');
    // AC4.3 through the form: a non-positive increase is refused with the spec wording.
    clearSaid(h);
    assert.equal(await issueFromForm(w, { increase: 0 }), false);
    assert.match(said(h), /มูลค่าที่ถูกต้องต้องมากกว่ามูลค่าเดิม/);
    // Increase 2,000.00 (+ VAT 140.00); the number follows the document date (October) even though the date was typed
    // without a change of the auto number.
    clearSaid(h);
    const saved = await issueFromForm(w, { increase: 2000 });
    assert.ok(saved, said(h));
    assert.deepEqual([saved.no, saved.date, saved.branch, saved.subtotal, saved.vatAmt, saved.total, saved.originalValue, saved.correctValue, saved.customerBranch], ['DN691001', '2026-10-03', 'ubon', 2000, 140, 2140, 13500, 15500, 'สำนักงานใหญ่']);
    const stored = w.ERPDebitNotes.allDebitNotes().find(row => row.no === 'DN691001');
    assert.deepEqual([stored._year, stored._month, stored.year, stored.month], [2026, 9, 2026, 9], 'stored in the pack of its own month');
    w.go('debit-note-list', entry);
    change(w, d.getElementById('dnl-year'), '2026');
    assert.deepEqual([...d.querySelectorAll('#dnltbl tr')].map(tr => text(tr.cells[0])), ['DN691001', 'DN690901']);
    // AC4.6: the printed document has (ก) the title, (ข) the issuer's name / address / TIN, (ค) the buyer's name and address,
    // (ง) the date, (จ) the original invoice number, original / correct value, difference, VAT charged in addition, (ฉ) the reason.
    const overlay = w.ERPDebitNotes.previewStored('ubon', 2026, 9, stored.id);
    const page = overlay.querySelector('.doc-preview-modal-page');
    const html = page.innerHTML, all = text(page);
    for (const label of ['ใบเพิ่มหนี้', 'DEBIT NOTE', 'บริษัทตัวอย่างสำหรับทดลองระบบ จำกัด', 'เลขประจำตัวผู้เสียภาษี', 'รพ.รวมแพทย์อุบล', '9 ถนนสรรพสิทธิ์', 'INV690904', '13,500.00', '15,500.00', '2,000.00', 'ภาษีที่เรียกเก็บเพิ่ม', '140.00', '2,140.00', 'คำนวณราคาสินค้าผิดพลาดต่ำกว่าที่เป็นจริง', 'สองพันหนึ่งร้อยสี่สิบบาทถ้วน', 'DN691001']) assert.ok(all.includes(label), `AC4.6: ${label}`);
    assert.match(all, /วันที่ \/ Date\s*03-10-2569/, '(ง) the date (พ.ศ.)');
    assert.match(all, /เลขประจำตัวผู้เสียภาษีอากร 0000000000000 · สำนักงานใหญ่/, '(ข) issuer TIN + establishment');
    assert.doesNotMatch(all, /ใบลดหนี้ \/ CREDIT NOTE|ภาษีที่ใช้คืน/, 'no credit-note wording');
    assert.ok(!/<script/i.test(html));
    overlay.remove();
    assert.deepEqual(h.errors.filter(line => !/action failed/.test(line)), []);
  } finally { h.close(); }
});

test('dnui#2 AR with a debit note agrees on the AR report, dashboard banner, governance aging, Decision Council and Customer 360; a receipt collects it', async () => {
  const h = await bootWithSample(); const { w } = h; const d = w.document;
  try {
    const I = w.ERPIntegrity;
    const find = no => I.business().invoices.find(row => row.no === no);
    const today = w.localDateISO ? w.localDateISO() : new Date().toISOString().slice(0, 10);
    // INV690910 (X2) carries the sample DN690901: 6,955.00 + 1,605.00.
    const x2 = I.paymentSummary(find('INV690910'));
    assert.deepEqual([x2.total, x2.debited, x2.outstanding, x2.status], [6955, 1605, 8560, 'pending']);
    // A debit note on an OVERDUE invoice: INV69071? (U4, late) — pick the late invoice of บจก. มูลมั่งมี วัสดุภัณฑ์.
    const late = I.business().invoices.filter(inv => inv.customer === 'บจก. มูลมั่งมี วัสดุภัณฑ์' && I.paymentSummary(inv).outstanding > 0).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    const before = { ar: w.ERPReceivables.snapshot('').aging.totals.total, alert: w.ERPReceivables.snapshot('').alert.overdueTotal, gov: w.ERPGovernance.agingSnapshot(today).ar.total, c360: w.ERPCustomerExperience.customerSnapshot(late.customer).ar, inv: I.paymentSummary(late).outstanding };
    const cell = invoiceCell(w, late.no);
    chooseFromMenu(w, cell, 'ออกใบเพิ่มหนี้');
    const saved = await issueFromForm(w, { increase: 1000, reason: 'goods_over_quantity' });
    assert.ok(saved, said(h));
    assert.equal(saved.total, 1070);
    const after = { ar: w.ERPReceivables.snapshot('').aging.totals.total, alert: w.ERPReceivables.snapshot('').alert.overdueTotal, gov: w.ERPGovernance.agingSnapshot(today).ar.total, c360: w.ERPCustomerExperience.customerSnapshot(late.customer).ar, inv: I.paymentSummary(late).outstanding };
    // ADR-024: the debit note is collected with its invoice (same due date) → +1,070.00 everywhere, also in "overdue".
    for (const key of Object.keys(before)) assert.equal(round2(after[key] - before[key]), 1070, key);
    assert.equal(after.ar, after.gov, 'AR report = governance aging');
    const council = w.ERPDecisionCouncil.run();
    const ar1 = council.reviews.find(r => r.name === 'collections').findings.find(f => f.ruleId === 'AR_001');
    assert.match(ar1.summary, new RegExp(after.alert.toLocaleString('th-TH', { maximumFractionDigits: 2 }).replace(/[.,]/g, '\\$&')));
    w.go('dashboard'); w.renderDash();
    await waitFor(() => !!d.getElementById('ar-overdue-banner') && !d.getElementById('ar-overdue-banner').hidden);
    const money = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    assert.match(text(d.getElementById('ar-overdue-banner')), new RegExp(money(after.alert).replace(/[.,]/g, '\\$&')));
    const c360 = w.ERPCustomerExperience.customerSnapshot(late.customer);
    assert.equal(c360.debited, 1070);
    assert.ok(c360.debitNotes.some(n => n.no === saved.no) && c360.timeline.some(t => t.no === saved.no && t.amount === 1070));
    // The invoice list shows the debit amount; the receipt from the invoice collects the whole balance incl. the DN.
    assert.match(text(invoiceCell(w, late.no).closest('tr')), /เพิ่มหนี้ ฿1,070\.00/);
    const owed = I.paymentSummary(late).outstanding;
    w.issueReceiptFromInvoice(late.branch || 'ubon', late.year, late.month, String(late.id));
    await sleep(30);
    assert.ok(d.getElementById('panel-receipt-form').classList.contains('active'));
    change(w, d.getElementById('r-date'), '2026-10-04');
    await w.LocalDemoHealth?.whenIdle?.('saveReceipt');
    clearSaid(h);
    await w.saveReceipt();
    await sleep(30);
    const paid = I.paymentSummary(I.business().invoices.find(row => row.no === late.no));
    assert.deepEqual([paid.status, paid.outstanding, round2(paid.paid)], ['paid', 0, round2(owed + Number(I.business().receipts.filter(r => r.invNo === late.no && r.date < '2026-10-04').reduce((s, r) => s + Number(r.total), 0)))], said(h));
    // Collected money blocks the void before the reason question.
    let asked = 0;
    w.prompt = () => { asked += 1; return 'x'; };
    clearSaid(h);
    assert.equal(w.ERPDebitNotes.askVoid('ubon', 2026, 9, String(saved.id)), false);
    assert.equal(asked, 0, 'refused before the question');
    assert.match(said(h), /ยกเลิก|ชำระ/);
    assert.deepEqual(h.errors.filter(line => !/action failed/.test(line)), []);
  } finally { h.close(); }
});

test('dnui#3 cancel: period lock refused before any question (same text as every lock); live DN blocks the invoice cancel; voided DN leaves ภ.พ.30 and keeps its number', async () => {
  const h = await bootWithSample(); const { w } = h;
  try {
    const I = w.ERPIntegrity;
    const dn = w.ERPDebitNotes.allDebitNotes().find(row => row.no === 'DN690901');
    // The invoice it references cannot be cancelled while the DN is live.
    const x2 = I.business().invoices.find(row => row.no === 'INV690910');
    clearSaid(h);
    w.ERPDocumentCancel.open('invoices', 'ubon', 2026, 8, String(x2.id));
    await sleep(20);
    assert.match(said(h) + text(w.document.body), /ใบเพิ่มหนี้ที่ยังใช้งาน: DN690901 — ยกเลิกใบเพิ่มหนี้ก่อน/);
    w.document.querySelectorAll('.erp-cancel-overlay,.doc-preview-modal-overlay,[data-cancel-dialog]').forEach(el => el.remove());
    // Locked September (sales): refused before the reason prompt, with the governance text.
    w.ERPGovernance.lockPeriod({ branch: 'ubon', scope: 'sales', throughDate: '2026-09-30', reason: 'ยื่น ภ.พ.30 แล้ว' });
    let asked = 0;
    w.prompt = () => { asked += 1; return 'ออกผิด'; };
    w.confirm = () => { asked += 1; return true; };
    clearSaid(h);
    assert.equal(w.ERPDebitNotes.askVoid('ubon', 2026, 8, String(dn.id)), false);
    assert.equal(asked, 0, 'no question in a closed period');
    const lockText = w.ERPGovernance.periodLockRefusal({ type: 'debitNotes', branch: 'ubon', date: dn.date, action: 'debit_note_void' });
    assert.ok(lockText && said(h).includes(lockText), said(h));
    // Saving a new DN dated in the closed month is refused with the same lock text.
    w.ERPDebitNotes.startFromInvoice('ubon', 2026, 8, String(x2.id));
    const d = w.document;
    change(w, d.getElementById('dn-date'), '2026-09-30');
    change(w, d.getElementById('dn-reason'), 'service_over_scope');
    change(w, d.querySelector('[data-dn-line-field="increase"][data-index="0"]'), '100');
    clearSaid(h);
    assert.equal(await w.ERPDebitNotes.save(), false);
    assert.match(said(h), /ถูกปิดถึง 2026-09-30/);
    // Unlock → void with a reason (past VAT month asks once more) → excluded from รายงานภาษีขาย; the number stays taken.
    const lock = w.ERPGovernance.listPeriodLocks().find(l => l.branch === 'ubon' && l.scope === 'sales');
    w.ERPGovernance.unlockPeriod(lock.lockId, 'ทดสอบ');
    asked = 0;
    assert.equal(await w.ERPDebitNotes.askVoid('ubon', 2026, 8, String(dn.id)), true, said(h));
    assert.equal(asked, 2, 'reason + past-month confirmation');
    const voided = w.ERPDebitNotes.allDebitNotes().find(row => row.no === 'DN690901');
    assert.deepEqual([voided.voided, voided.status, voided.voidReason], [true, 'voided', 'ออกผิด']);
    assert.equal(I.paymentSummary(I.business().invoices.find(row => row.no === 'INV690910')).outstanding, 6955);
    w.go('tax-reports', null); await sleep(20);
    const view = w.ERPTaxReports.view();
    const root = w.document.getElementById('tax-reports-root');
    root.querySelector('[data-tax-tab="sales"]').click();
    for (const [id, value] of [['tax-rpt-month', '9'], ['tax-rpt-year', '2026'], ['tax-rpt-branch', 'ubon']]) { const el = w.document.getElementById(id); el.value = value; el.dispatchEvent(new w.Event('change', { bubbles: true })); }
    const sales = w.ERPTaxReports.view().sales;
    assert.ok(!sales.rows.some(r => r.no === 'DN690901'));
    assert.deepEqual(plain(sales.totals), { value: 74070, vat: 5184.9, total: 79254.9 }, 'back to the figures without the debit note');
    assert.ok(view);
    // The next DN of September does not reuse DN690901.
    w.ERPDebitNotes.startFromInvoice('ubon', 2026, 8, String(x2.id));
    change(w, d.getElementById('dn-date'), '2026-09-30');
    change(w, d.getElementById('dn-reason'), 'service_over_scope');
    change(w, d.querySelector('[data-dn-line-field="increase"][data-index="0"]'), '100');
    const again = await w.ERPDebitNotes.save();
    assert.equal(again.no, 'DN690902', said(h));
  } finally { h.close(); }
});

test('dnui#4 list Excel through the vendored SheetJS (no network), backup round trip (fail-closed merge), one-branch mode', async () => {
  const h = await bootWithSample(); const { w } = h; const d = w.document;
  try {
    w.fetch = () => { throw new Error('network blocked'); };
    w.go('debit-note-list', null);
    change(w, d.getElementById('dnl-year'), '2026');
    const appended = [];
    const original = d.head.appendChild.bind(d.head);
    d.head.appendChild = node => { if (node.tagName === 'SCRIPT') appended.push(node); return original(node); };
    d.querySelector('[data-dn-action="excel"]').click();
    assert.equal(appended.length, 1);
    assert.equal(appended[0].getAttribute('src'), './vendor/xlsx-0.18.5.full.min.js');
    w.eval(fs.readFileSync(path.join(ROOT, 'vendor/xlsx-0.18.5.full.min.js'), 'utf8'));
    const books = [];
    w.XLSX.writeFile = (wb, file) => books.push({ wb, file });
    appended[0].onload();
    assert.equal(books.length, 1, said(h));
    const back = w.XLSX.read(w.XLSX.write(books[0].wb, { type: 'array', bookType: 'xlsx' }), { type: 'array' });
    const rows = plain(w.XLSX.utils.sheet_to_json(back.Sheets[back.SheetNames[0]], { header: 1, defval: '' }));
    assert.deepEqual([rows[0][0], rows[0][3], rows[0][13], rows[0][14]], ['สาขา', 'เลขที่ใบเพิ่มหนี้', 'ภาษีที่เรียกเก็บเพิ่ม', 'รวมเพิ่มหนี้']);
    assert.deepEqual([rows[1][3], rows[1][8], rows[1][12], rows[1][13], rows[1][14]], ['DN690901', 'INV690910', 1500, 105, 1605]);
    // Backup: the debit note travels in its month pack; a merge keeps the device copy of an issued note (figures),
    // applies a void from the file (one-way); replace with a backup that lacks it asks first (issued tax document).
    const backup = w.testApp.collectBackupData({ year: 2026, month: 8, branch: 'ubon', includeEmpty: true });
    const MONTH_TH = 'กันยายน';
    assert.deepEqual(plain(backup[2026].ubon[MONTH_TH].debitNotes.map(n => [n.no, n.total])), [['DN690901', 1605]]);
    // r13#MED-7: the head office's four September 50 ทวิ (rent 5 % ×2, transport 1 %, cloud 3 %). Their เลขที่ continue the
    // พ.ศ. 2569 book after the earlier months' rent payments, so they are consecutive but do not start at 0001.
    const septNos = plain(backup[2026].ubon[MONTH_TH].whtCertificates.map(c => c.no)).sort();
    assert.equal(septNos.length, 4);
    const firstNo = Number(septNos[0].slice(-4));
    assert.deepEqual(septNos, septNos.map((_, i) => `WHT2569-${String(firstNo + i).padStart(4, '0')}`));
    // r8fix#B2: an unsigned file carrying ใบเพิ่มหนี้ / 50 ทวิ is now refused as a stripped checksum — sign it like an app export.
    const file = async data => { const payload = { meta: { app: 'comform-esan', backupType: 'month', backupSchemaVersion: 4, contentSha256: '' }, data }; payload.meta.contentSha256 = await w.ERPBackup.digest(payload); return { text: async () => JSON.stringify(payload) }; };
    const importBackup = async (data, mode) => { d.getElementById('import-mode').value = mode; await w.importJSON({ target: { files: [await file(data)], value: 'x' } }); return d.getElementById('import-json-status').textContent; };
    const tampered = plain(backup);
    tampered[2026].ubon[MONTH_TH].debitNotes[0].total = 99999;
    w.confirm = () => true;
    await importBackup(tampered, 'merge');
    const kept = w.ERPDebitNotes.allDebitNotes().find(n => n.no === 'DN690901');
    assert.equal(kept.total, 1605, 'the device copy of an issued debit note wins');
    tampered[2026].ubon[MONTH_TH].debitNotes[0] = { ...tampered[2026].ubon[MONTH_TH].debitNotes[0], voided: true, status: 'voided', voidReason: 'ยกเลิกจากอีกเครื่อง', voidedAt: '2026-10-04T00:00:00.000Z' };
    await importBackup(tampered, 'merge');
    const merged = w.ERPDebitNotes.allDebitNotes().find(n => n.no === 'DN690901');
    assert.deepEqual([merged.voided, merged.voidReason, merged.total], [true, 'ยกเลิกจากอีกเครื่อง', 1605]);
    assert.deepEqual(plain(w.ERPDebitNotes.ledgerIssues()), []);
    // Replace with a backup that has no debit notes: an issued document would disappear → a question; declined = unchanged.
    const without = plain(backup);
    without[2026].ubon[MONTH_TH].debitNotes = [];
    const asked = [];
    w.confirm = message => { asked.push(message); return false; };
    await importBackup(without, 'replace');
    assert.ok(asked.some(m => /DN690901/.test(m)), asked.join('\n---\n'));
    assert.equal(w.ERPDebitNotes.allDebitNotes().length, 1, 'declined → still there');
  } finally { h.close(); }
  const s = await boot({ beforeScripts: win => win.localStorage.setItem(SETTING_KEY, JSON.stringify({ schemaVersion: 1, count: 1, updatedAt: '2026-10-04T00:00:00.000Z' })) });
  try {
    const r = await s.w.ERPDemoSeed.load({ today: '2026-10-04', confirm: () => true });
    assert.equal(r.status, 'loaded', said(s));
    s.w.go('debit-note-list', null);
    assert.equal(s.w.document.getElementById('dnl-br'), null, 'no establishment filter with one establishment');
    s.w.go('debit-note-form', null);
    assert.equal(s.w.ERPDebitNotes.getFormState().branch, 'ubon');
    assert.deepEqual(plain(s.w.ERPDebitNotes.allDebitNotes().map(n => [n.no, n._branch])), [['DN690901', 'ubon']]);
    assert.deepEqual(s.errors, []);
  } finally { s.close(); }
});
