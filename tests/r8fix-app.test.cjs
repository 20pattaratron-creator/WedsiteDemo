// Round 8 review fixes (ADR-025) — regressions in the booted app (jsdom), one test per confirmed finding
// (`r8fix#<id>`). Every test here fails on round8-stageD and passes now (/tmp/claude-0/r8fix-newtests-on-base.log).
// Pure-logic regressions of the same round: tests/r8fix-core.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot } = require('./dom-helper.cjs');

const ROOT = path.resolve(__dirname, '..');
const TENANT = 'erp_tenant::customer-showcase-local::';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = el => String(el?.textContent || '').replace(/\s+/g, ' ').trim();
const said = h => [...h.messages, ...[...h.w.document.querySelectorAll('.app-toast-msg')].map(el => el.textContent)].join('\n');
const plain = value => JSON.parse(JSON.stringify(value));
const fire = (w, el) => { el.dispatchEvent(new w.Event('input', { bubbles: true })); el.dispatchEvent(new w.Event('change', { bubbles: true })); };
async function seeded(options = {}) {
  const h = await boot(options);
  const result = await h.w.ERPDemoSeed.load({ today: '2026-10-04', confirm: () => true });
  assert.equal(result.status, 'loaded', JSON.stringify(result));
  return h;
}

test('r8fix#A3: a credit note sees the debit notes — CN 8,000 on INV690910 (6,500 + DN 1,500) saves, prints original value 8,000.00 with the DN shown, AR → 0; the DN then cannot be voided', async () => {
  const h = await seeded();
  const { w } = h;
  try {
    const I = w.ERPIntegrity;
    const x2 = I.business().invoices.find(row => row.no === 'INV690910');
    assert.equal(I.paymentSummary(x2).outstanding, 8560);
    assert.equal(w.ERPCreditNotes.startFromInvoice('ubon', 2026, 8, String(x2.id)), true);
    // The form table shows the earlier debit note and starts from 8,000 (was 6,500 + "-").
    const row = w.document.querySelector('[data-cn-line="0"]');
    assert.match(text(row), /\+฿1,500\.00/);
    assert.match(text(row), /฿8,000\.00/);
    const input = w.document.querySelector('[data-cn-line-field="diff"]');
    input.value = '8000'; fire(w, input);
    const reason = w.document.getElementById('cn-reason'); reason.value = 'price_overcharge'; fire(w, reason);
    w.document.getElementById('cn-date').value = '2026-10-03';
    assert.equal(w.document.getElementById('cn-original-value').value, '8,000.00');
    const saved = await w.ERPCreditNotes.save();
    assert.ok(saved, said(h));
    assert.deepEqual([saved.originalValue, saved.subtotal, saved.vatAmt, saved.total, saved.lines[0].priorDebitedValue], [8000, 8000, 560, 8560, 1500]);
    // Print: "มูลค่าตามใบกำกับภาษีเดิม" 8,000.00 and the note invoice 6,500 + DN 1,500 (was 6,500.00 alone).
    const html = w.ComformCreditNoteDocument.buildHtml(saved);
    const doc = new w.DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    assert.match(text(doc.querySelector('.cn-doc-totals, body')), /รวมมูลค่าตามใบกำกับภาษีเดิม.*8,000\.00/);
    assert.match(text(doc.body), /ตามใบกำกับภาษี 6,500\.00 · เพิ่มหนี้ก่อนหน้า 1,500\.00/);
    // AR: fully credited, nothing outstanding.
    const after = I.paymentSummary(I.business().invoices.find(row => row.no === 'INV690910'));
    assert.deepEqual([after.outstanding, after.credited, after.debited], [0, 8560, 1605]);
    // Voiding the DN the CN relied on is refused BEFORE the reason question (and in the write path).
    const dn = w.ERPDebitNotes.allDebitNotes().find(row => row.no === 'DN690901');
    let asked = 0; w.prompt = () => { asked += 1; return 'ออกผิด'; };
    assert.equal(await w.ERPDebitNotes.askVoid('ubon', 2026, 8, String(dn.id)), false);
    assert.equal(asked, 0);
    assert.match(said(h), /ยกเลิกใบเพิ่มหนี้ DN690901 ไม่ได้ — ใบลดหนี้ที่ยังใช้งานของใบกำกับภาษี INV690910 ลดไปแล้ว 8,000\.00 บาท ซึ่งเกินมูลค่าที่เหลือหลังยกเลิก \(6,500\.00 บาท\)/);
    assert.equal(await w.ERPDebitNotes.voidDebitNote?.('ubon', 2026, 8, String(dn.id), 'ออกผิด') ?? false, false);
    assert.equal(w.ERPDebitNotes.allDebitNotes().find(row => row.no === 'DN690901').voided, false);
    // A credit note within the invoice's own value leaves the DN voidable (no false refusal).
    w.ERPCreditNotes.voidCreditNote && await w.ERPCreditNotes.voidCreditNote(saved.branch || 'ubon', 2026, 9, String(saved.id), 'ทดสอบ');
    assert.equal(w.ERPCreditNotes.allCreditNotes().find(row => row.no === saved.no).voided, true);
    assert.equal(await w.ERPDebitNotes.askVoid('ubon', 2026, 8, String(dn.id)), true, said(h));
  } finally { h.close(); }
});

test('r8fix#B1: editing an issued invoice / receipt cannot move it OUT of a locked period — refused before any question with the lock text; nothing changes', async () => {
  const h = await seeded();
  const { w, set } = h;
  try {
    const I = w.ERPIntegrity;
    const data = I.business();
    const printedInv = new Set(data.issuedInvoices.filter(I.live).map(r => r.no));
    const inv = data.invoices.find(i => I.live(i) && !printedInv.has(i.no) && i.date < '2026-09-30' && I.paymentSummary(i).paid === 0 && !(I.paymentSummary(i).credited > 0) && !(I.paymentSummary(i).debited > 0));
    const printedRec = new Set(data.issuedReceipts.filter(I.live).map(r => r.no));
    const rec = data.receipts.find(x => I.live(x) && !x.paymentId && !printedRec.has(x.no) && x.date < '2026-09-30');
    w.ERPGovernance.lockPeriod({ branch: 'all', scope: 'all', throughDate: '2026-09-30', reason: 'close Sep' });
    let asked = 0; w.confirm = () => { asked += 1; return true; };
    w.editInvoice(inv._branch, inv._year, inv._month, String(inv.id));
    set('i-date', '2026-10-05'); set('i-note', 'moved out of locked period');
    await w.LocalDemoHealth.whenIdle('saveInvoice'); await w.saveInvoice(); await sleep(50);
    assert.deepEqual(plain(I.business().invoices.filter(i => i.no === inv.no).map(i => [i.date, i._month])), [[inv.date, inv._month]]);
    assert.match(said(h), /งวด บัญชี ถูกปิดถึง 2026-09-30/);
    w.editReceipt(rec._branch, rec._year, rec._month, String(rec.id));
    set('r-date', '2026-10-05'); set('r-note', 'moved');
    h.messages.length = 0;
    await w.LocalDemoHealth.whenIdle('saveReceipt'); await w.saveReceipt(); await sleep(50);
    assert.deepEqual(plain(I.business().receipts.filter(x => x.no === rec.no).map(x => [x.date, x._month])), [[rec.date, rec._month]]);
    assert.match(said(h), /งวด บัญชี ถูกปิดถึง 2026-09-30/);
    assert.equal(asked, 0, 'no confirmation before the refusal');
    // The write path refuses too (another tab locked the period after the form opened).
    assert.throws(() => w.ERPGovernance.assertPeriodOpen({ branch: inv._branch, date: inv.date, scope: 'sales', action: 'invoice_edit' }), /ปิด|lock/i);
  } finally { h.close(); }
});

test('r8fix#B7: editing a document of a past tax month whose ภ.พ.30 is filed asks the cancel-flow confirmation first; "no" leaves it unchanged; an unreadable ภ.พ.30 store refuses', async () => {
  const h = await seeded();
  const { w, set } = h;
  try {
    const I = w.ERPIntegrity;
    const KEY = `${TENANT}comform_vat_returns_v1`;
    w.localStorage.setItem(KEY, JSON.stringify({ schemaVersion: 1, returns: [] }));
    // File September (HQ) through the real page.
    const asked = []; w.confirm = message => { asked.push(message); return !/ปิดงวด/.test(message); };
    w.go('tax-reports', null); await sleep(30);
    const root = w.document.getElementById('tax-reports-root');
    root.querySelector('[data-tax-tab="pp30"]').click();
    for (const [id, value] of [['tax-rpt-month', '9'], ['tax-rpt-year', '2026'], ['tax-rpt-branch', 'ubon']]) { const el = w.document.getElementById(id); el.value = value; el.dispatchEvent(new w.Event('change', { bubbles: true })); }
    await sleep(20);
    root.querySelector('[data-tax-action="file"]').click(); await sleep(300);
    assert.equal(JSON.parse(w.localStorage.getItem(KEY)).returns.length, 1);
    const data = I.business();
    const printed = new Set(data.issuedInvoices.filter(I.live).map(r => r.no));
    const t = data.invoices.find(i => I.live(i) && i._branch === 'ubon' && !printed.has(i.no) && i.date.startsWith('2026-09') && I.paymentSummary(i).paid === 0 && !(I.paymentSummary(i).credited > 0) && !(I.paymentSummary(i).debited > 0));
    asked.length = 0; w.confirm = message => { asked.push(message); return false; };
    w.editInvoice(t._branch, t._year, t._month, String(t.id)); set('i-date', '2026-10-02');
    await w.LocalDemoHealth.whenIdle('saveInvoice'); await w.saveInvoice(); await sleep(50);
    assert.equal(asked.length, 1);
    assert.match(asked[0], new RegExp(`แก้ไขใบกำกับภาษี ${t.no} — เดือนภาษี กันยายน 2569 ผ่านไปแล้ว และ ภ.พ.30 เดือน กันยายน 2569 บันทึกว่ายื่นแล้ว`));
    assert.deepEqual(plain(I.business().invoices.filter(i => i.no === t.no).map(i => i.date)), [t.date], 'declined → unchanged');
    // Unreadable filing store → refused (fail-closed), no question.
    w.localStorage.setItem(KEY, '{broken');
    asked.length = 0; h.messages.length = 0;
    await w.LocalDemoHealth.whenIdle('saveInvoice'); await w.saveInvoice(); await sleep(50);
    assert.equal(asked.length, 0);
    assert.match(said(h), /อ่านข้อมูล ภ.พ.30 ที่บันทึกไว้ไม่ได้/);
    assert.deepEqual(plain(I.business().invoices.filter(i => i.no === t.no).map(i => i.date)), [t.date]);
  } finally { h.close(); }
});

// JSON backup helpers (the reviewer's p3_backup.cjs): export everything, import through the real file input handler.
async function exportAll(w) {
  const payload = { meta: { app: 'comform-esan', backupType: 'all', branch: 'all', exportedAt: new Date().toISOString() }, data: w.testApp.collectBackupData({}), masterData: w.testApp.collectLocalMasterBackup() };
  await w.ERPBackup.portable(payload);
  return JSON.parse(JSON.stringify(payload));
}
async function importObj(w, obj, mode) {
  w.document.getElementById('import-mode').value = mode;
  const body = JSON.stringify(obj);
  await w.importJSON({ target: { files: [{ text: async () => body }], value: 'x' } });
  await sleep(50);
}
async function resign(w, backup) { backup.meta.contentSha256 = ''; backup.meta.contentSha256 = await w.ERPBackup.digest({ ...backup, meta: { ...backup.meta, contentSha256: '' } }); return backup; }
function findInPacks(backup, predicate) {
  for (const branches of Object.values(backup.data)) for (const months of Object.values(branches)) for (const pack of Object.values(months)) for (const inv of pack.invoices || []) if (predicate(inv)) return { pack, inv };
  return null;
}
const lastSaid = h => said(h).split('\n').filter(Boolean).slice(-3).join(' | ');

test('r8fix#B2: JSON import — a stripped checksum ("downgraded" schema) is refused, an unverified old file asks first, issued invoices keep their money on merge, and changes in a locked period refuse the whole import', async () => {
  const h = await seeded();
  const { w } = h;
  try {
    const I = w.ERPIntegrity;
    const B0 = await exportAll(w);
    // (a) checksum stripped + backupSchemaVersion 3 while the file carries v4-only data → refused, nothing written.
    const tampered = JSON.parse(JSON.stringify(B0));
    const t = findInPacks(tampered, inv => inv.date < '2026-09-01' && !inv.voided);
    t.inv.total = 999999; t.inv.note = 'tampered';
    delete tampered.meta.contentSha256; tampered.meta.backupSchemaVersion = 3;
    await importObj(w, tampered, 'merge');
    assert.match(lastSaid(h), /ไม่มี checksum แต่มีข้อมูลที่มีเฉพาะใน Backup รุ่นที่ต้องมี checksum/);
    assert.notEqual(I.business().invoices.find(i => i.no === t.inv.no).total, 999999);
    // (b) a genuine old file (no checksum, no v4-only data): the user is told and asked; "no" writes nothing.
    const old = JSON.parse(JSON.stringify(tampered));
    for (const key of ['companyProfile', 'vatReturns', 'whtFilings', 'periodLocks']) delete old.masterData[key];
    for (const branches of Object.values(old.data)) for (const months of Object.values(branches)) for (const pack of Object.values(months)) { delete pack.debitNotes; delete pack.whtCertificates; }
    const asked = []; w.confirm = message => { asked.push(message); return false; };
    await importObj(w, old, 'merge');
    assert.match(asked[0] || '', /ไม่มี checksum \(Backup รุ่นเก่า\)/);
    assert.match(lastSaid(h), /ยกเลิกการนำเข้าแล้ว \(ไฟล์ไม่มี checksum\)/);
    assert.notEqual(I.business().invoices.find(i => i.no === t.inv.no).total, 999999);
    // (c) a signed file that changes a live issued invoice's money (open period) → the device copy is kept and named.
    w.confirm = () => true;
    const signed = JSON.parse(JSON.stringify(B0));
    const s = findInPacks(signed, inv => inv.no === t.inv.no);
    const before = I.business().invoices.find(i => i.no === t.inv.no);
    s.inv.total = 1; s.inv.subtotal = 1; s.inv.date = '2026-08-30';
    await importObj(w, await resign(w, signed), 'merge');
    const after = I.business().invoices.filter(i => i.no === t.inv.no);
    assert.deepEqual(plain(after.map(i => [i.total, i.date])), [[before.total, before.date]]);
    assert.match(lastSaid(h), new RegExp(`ใช้ฉบับในเครื่อง 1 ฉบับที่ยอด/เลขที่/วันที่ในไฟล์ต่างกัน .*${t.inv.no}`));
    // (d) a signed file that changes ANY document of a closed period → refused with a Thai list; nothing written.
    w.ERPGovernance.lockPeriod({ branch: 'all', scope: 'all', throughDate: '2026-09-30', reason: 'close' });
    const locked = JSON.parse(JSON.stringify(B0));
    const l = findInPacks(locked, inv => inv.date < '2026-09-30' && inv.no !== t.inv.no);
    l.inv.note = 'แก้หมายเหตุในไฟล์';
    await importObj(w, await resign(w, locked), 'merge');
    assert.match(said(h), new RegExp(`ไฟล์ Backup จะเพิ่ม/แก้/ลบเอกสาร 1 รายการในงวดที่ปิดแล้ว ระบบจึงไม่นำเข้าเลย`));
    assert.match(said(h), new RegExp(`• ใบกำกับภาษี ${l.inv.no} \\(${l.inv.date}\\) — แก้ไข`));
    assert.notEqual(I.business().invoices.find(i => i.no === l.inv.no).note, 'แก้หมายเหตุในไฟล์');
    // An unchanged round trip of the same file is still accepted under the lock (nothing in the closed period changes).
    h.messages.length = 0;
    await importObj(w, B0, 'merge');
    assert.match(lastSaid(h), /นำเข้า \d+ ชุดข้อมูล/);
  } finally { h.close(); }
});

test('r8fix#B3: replace import asks before removing (or changing) issued invoices / receipts; "no" keeps them; a removal in a locked period is refused', async () => {
  const h = await seeded();
  const { w } = h;
  try {
    const I = w.ERPIntegrity;
    const B0 = await exportAll(w);
    const B2 = JSON.parse(JSON.stringify(B0));
    let removed = null, removedReceipt = null;
    for (const branches of Object.values(B2.data)) for (const months of Object.values(branches)) for (const pack of Object.values(months)) {
      if (!removed) { const i = (pack.invoices || []).findIndex(v => v.date >= '2026-08-01' && !v.voided); if (i >= 0) { removed = pack.invoices[i].no; pack.invoices.splice(i, 1); pack.issuedInvoices = (pack.issuedInvoices || []).filter(v => v.no !== removed); } }
      if (!removedReceipt) { const r = (pack.receipts || []).findIndex(v => !v.paymentId); if (r >= 0) { removedReceipt = pack.receipts[r].no; pack.receipts.splice(r, 1); pack.issuedReceipts = (pack.issuedReceipts || []).filter(v => v.no !== removedReceipt); } }
    }
    await resign(w, B2);
    const asked = []; w.confirm = message => { asked.push(message); return false; };
    await importObj(w, B2, 'replace');
    assert.equal(asked.length, 1, said(h));
    assert.match(asked[0], /โหมดแทนที่จะลบหรือเปลี่ยนเอกสารที่ออกแล้วในเครื่อง \(ใบกำกับภาษี\/ใบเสร็จ/);
    assert.ok(asked[0].includes(removed) && asked[0].includes(removedReceipt), asked[0]);
    assert.equal(I.business().invoices.filter(i => i.no === removed).length, 1);
    assert.equal(I.business().receipts.filter(r => r.no === removedReceipt).length, 1);
    // Locked period: refused before any question.
    w.ERPGovernance.lockPeriod({ branch: 'all', scope: 'all', throughDate: '2026-12-31', reason: 'close' });
    asked.length = 0; w.confirm = message => { asked.push(message); return true; };
    await importObj(w, B2, 'replace');
    assert.equal(asked.length, 0);
    assert.match(said(h), /ในงวดที่ปิดแล้ว ระบบจึงไม่นำเข้าเลย/);
    assert.equal(I.business().invoices.filter(i => i.no === removed).length, 1);
  } finally { h.close(); }
});

test('r8fix#B4: a replace import never drops filed ภ.ง.ด. / ภ.พ.30 history — the filed 50 ทวิ stays non-cancellable', async () => {
  const h = await seeded();
  const { w } = h;
  try {
    const P = w.ERPPayerWht;
    const B0 = await exportAll(w); // made BEFORE the filings
    w.confirm = message => !/ปิดงวด/.test(message);
    assert.ok(await P.fileReturn({ branch: 'ubon', period: '2026-09', form: 'PND3' }));
    const VAT = `${TENANT}comform_vat_returns_v1`;
    w.ERPTaxReports.select({ tab: 'pp30', branch: 'ubon', period: '2026-09' });
    w.document.querySelector('#tax-reports-root [data-tax-action="file"]')?.click(); await sleep(200);
    const vatBefore = JSON.parse(w.localStorage.getItem(VAT) || '{"returns":[]}').returns.length;
    assert.equal(P.readFilings().filings.length, 1);
    await importObj(w, B0, 'replace');
    assert.match(lastSaid(h), /แทนที่ชุดที่อยู่ในไฟล์/);
    assert.equal(P.readFilings().filings.length, 1, 'filed ภ.ง.ด.3 kept');
    assert.equal(JSON.parse(w.localStorage.getItem(VAT) || '{"returns":[]}').returns.length, vatBefore, 'filed ภ.พ.30 kept');
    // r13#MED-7: the head office also has a July ภ.ง.ด.3 certificate (J1 subcontract) — the one in the FILED month is meant.
    const cert = P.readCertificates({ branches: ['ubon'] }).find(c => c.form === 'PND3' && String(c.date).startsWith('2026-09'));
    w.prompt = () => 'test'; h.messages.length = 0;
    assert.equal(await P.askVoidCertificate('ubon', cert._year, cert._month, cert.id), false);
    assert.match(said(h), /ที่บันทึกว่ายื่นแล้ว/);
  } finally { h.close(); }
});

test('r8fix#B8: period locks are in the JSON backup; a restore adds them (append-only), never removes an active one, and a damaged lock row refuses the file', async () => {
  const h = await seeded();
  const { w } = h;
  try {
    const KEY = `${TENANT}comform_governance_period_locks_v1`;
    const lock = w.ERPGovernance.lockPeriod({ branch: 'ubon', scope: 'sales', throughDate: '2026-08-31', reason: 'ปิด ส.ค.' });
    const B = await exportAll(w);
    assert.equal(B.masterData.periodLocks.length, 1);
    assert.equal(B.masterData.periodLocks[0].lockId, lock.lockId);
    // Restore onto a device without the lock → the lock comes back (merge and replace alike).
    w.localStorage.setItem(KEY, '[]');
    await importObj(w, B, 'replace');
    assert.deepEqual(plain(w.ERPGovernance.listPeriodLocks().map(row => row.lockId)), [lock.lockId]);
    // A file that "unlocks" it cannot open the period on this device.
    const unlock = JSON.parse(JSON.stringify(B));
    unlock.masterData.periodLocks.push({ ...unlock.masterData.periodLocks[0], id: 'evt-unlock', action: 'unlock', reason: 'จากไฟล์', at: new Date().toISOString() });
    await importObj(w, await resign(w, unlock), 'merge');
    assert.deepEqual(plain(w.ERPGovernance.listPeriodLocks().map(row => row.lockId)), [lock.lockId]);
    // A damaged row → the whole file is refused before any write.
    const bad = JSON.parse(JSON.stringify(B));
    bad.masterData.periodLocks.push({ id: 'x1', lockId: 'x1', action: 'lock', branch: 'ubon', scope: 'everything', throughDate: '2026-01-31' });
    h.messages.length = 0;
    await importObj(w, await resign(w, bad), 'merge');
    assert.match(lastSaid(h), /ข้อมูลการปิดงวด \(Period Lock\) ใน Backup ไม่ถูกต้อง/);
    // Export of a damaged lock store fails (fail-closed) instead of silently omitting the locks.
    w.localStorage.setItem(KEY, '{broken');
    assert.throws(() => w.testApp.collectLocalMasterBackup(), /period_locks/);
  } finally { h.close(); }
});

test('r8fix#B5: Recycle-bin restore runs the create checks BEFORE the question — closed period, filed ภ.พ.30 claim month, a payment with withholding', async () => {
  const h = await seeded();
  const { w } = h;
  try {
    const I = w.ERPIntegrity;
    const e = I.business().expenses.find(x => !(Number(x.whtAmount) > 0) && String(x.date).startsWith('2026-09') && x.inputVatClaimable !== true);
    const b = e._branch || e.branch;
    await w.delDoc(b, e._year, e._month, 'expenses', String(e.id));
    assert.equal(I.business().expenses.some(x => String(x.id) === String(e.id)), false);
    w.ERPGovernance.lockPeriod({ branch: 'all', scope: 'all', throughDate: '2026-09-30', reason: 'close Sep' });
    const trash = () => w.ERPProductionCore.exportData().trash;
    const entry = trash().find(x => String(x.record?.id) === String(e.id));
    let asked = 0; w.confirm = () => { asked += 1; return true; }; h.messages.length = 0;
    await w.pcRestoreTrash(entry.id); await sleep(30);
    assert.equal(asked, 0, 'refused before the question');
    assert.equal(I.business().expenses.some(x => String(x.id) === String(e.id)), false, 'not restored into the closed period (was restored)');
    assert.match(said(h), /งวด บัญชี ถูกปิดถึง 2026-09-30/);
    assert.ok(trash().some(x => x.id === entry.id), 'still in the bin');
    // Pure check, the other create rules: a payment with withholding, a claim month whose ภ.พ.30 is filed.
    assert.match(w.ERPGovernance.restoreRefusal({ type: 'expenses', branch: 'ubon', record: { date: '2026-11-02', whtAmount: 30, whtCertId: 'x' } }), /หัก ณ ที่จ่าย/);
    w.localStorage.setItem(`${TENANT}comform_vat_returns_v1`, '{broken');
    assert.match(w.ERPGovernance.restoreRefusal({ type: 'invoices', branch: 'ubon', record: { date: '2026-11-02', no: 'X' } }), /อ่านข้อมูล ภ.พ.30/);
  } finally { h.close(); }
});

test('r8fix#B6: a damaged saved company profile → red banner, backup refused, tax documents refused (never the sample TIN), reset back to the sample works', async () => {
  const KEY = `${TENANT}comform_company_profile_v1`;
  const h = await seeded({ beforeScripts: w => w.localStorage.setItem(KEY, '{"schemaVersion":1,"nameTh":"บริษัท สยาม') });
  const { w } = h;
  try {
    const banner = w.document.getElementById('erp-company-profile-damaged');
    assert.ok(banner, 'banner shown');
    assert.match(text(banner), /ข้อมูลบริษัทที่บันทึกไว้ .* อ่านไม่ได้/);
    assert.ok(banner.querySelector('[data-cp-damaged="reset"]') && banner.querySelector('[data-cp-damaged="restore"]'));
    assert.throws(() => w.testApp.collectLocalMasterBackup(), /สำรองข้อมูลไม่ได้ — ข้อมูลบริษัทที่บันทึกไว้อ่านไม่ได้/);
    assert.match(w.ERPCompanyProfile.issueRefusal(), /ออกเอกสารภาษีไม่ได้/);
    // Invoice save refused (nothing written).
    const before = w.ERPIntegrity.business().invoices.length;
    w.go('invoice-form', null); w.resetF('invoice'); w.selBr('i', 'ubon');
    h.messages.length = 0;
    await w.LocalDemoHealth.whenIdle('saveInvoice'); await w.saveInvoice(); await sleep(30);
    assert.match(said(h), /ออกเอกสารภาษีไม่ได้/);
    assert.equal(w.ERPIntegrity.business().invoices.length, before);
    // 50 ทวิ: the certificate hook refuses inside the write session.
    assert.throws(() => w.ERPPayerWht.attachCertificate({ get: () => ({}), mark() {} }, { id: 1, whtAmount: 30, date: '2026-10-02' }, 'ubon', 2026, 9), /ออกเอกสารภาษีไม่ได้/);
    // Reset to the sample: banner gone, documents allowed again.
    w.confirm = () => true;
    assert.equal(w.ERPCompanyProfile.resetDamaged(), true);
    assert.equal(w.document.getElementById('erp-company-profile-damaged'), null);
    assert.equal(w.ERPCompanyProfile.issueRefusal(), '');
    assert.equal(w.localStorage.getItem(KEY), null);
  } finally { h.close(); }
});

test('r8fix#B9: a month pack that cannot be read shows "อ่านข้อมูลเดือน … ไม่ได้" (banner, dashboard, lists, governance) — never zeros / READY, never an uncaught error', async () => {
  const h1 = await seeded();
  const store = {}; for (let i = 0; i < h1.w.localStorage.length; i += 1) { const k = h1.w.localStorage.key(i); store[k] = h1.w.localStorage.getItem(k); }
  h1.close();
  store[`${TENANT}biz2_ubon_2026_09`] = '{"broken":';
  const uncaught = [];
  const h = await boot({ beforeScripts: w => { for (const [k, v] of Object.entries(store)) w.localStorage.setItem(k, v); w.addEventListener('error', e => uncaught.push(String(e.message))); } });
  const { w } = h;
  try {
    for (const id of ['dashboard', 'invoice-list', 'receipt-list', 'expense-list', 'work-home', 'customer-portal', 'audit-log']) { w.go(id, null); await sleep(20); }
    await sleep(400);
    assert.deepEqual(uncaught, []);
    assert.equal(h.errors.filter(line => /Uncaught/.test(line)).length, 0, h.errors.filter(line => /Uncaught/.test(line)).join('\n'));
    assert.match(text(w.document.getElementById('erp-data-health-banner')), /อ่านข้อมูลเดือน กันยายน 2569 \(.*\) ไม่ได้/);
    w.go('invoice-list', null);
    assert.match(text(w.document.querySelector('#panel-invoice-list > .erp-read-error')), /อ่านข้อมูลเดือน กันยายน 2569/);
    w.go('audit-log', null); w.ERPGovernance.render();
    const gov = text(w.document.getElementById('governance-summary'));
    assert.match(gov, /อ่านข้อมูลเดือน กันยายน 2569/);
    assert.doesNotMatch(gov, /READY|฿0\.00/);
    assert.throws(() => w.ERPIntegrity.business(), e => e.code === 'pack_unreadable');
  } finally { h.close(); }
});

test('r8fix#B10: GR post / reverse, stock adjustment and transfer respect period locks; delDoc refuses CN / DN / 50 ทวิ; branch-2 census counts filings and locks; a damaged lock store never throws at boot', async () => {
  const h = await seeded();
  const { w } = h;
  try {
    const I = w.ERPIntegrity;
    w.ERPGovernance.lockPeriod({ branch: 'all', scope: 'purchase', throughDate: '2026-09-30', reason: 'close purchase' });
    const msgs = () => said(h);
    // Stock adjustment dated in the closed period.
    const product = (w.contactMasterRows ? null : null) || JSON.parse(w.localStorage.getItem(`${TENANT}comform_product_master_v1`) || '[]').find(p => p.fulfillmentType === 'stock' && p.flowType === 'inventory');
    const movesBefore = w.ERPProductionCore.exportData().inventoryMovements.length;
    w.go('inventory', null); await sleep(20);
    const setv = (id, v) => { const el = w.document.getElementById(id); if (el) el.value = v; };
    setv('adj-date', '2026-09-15'); setv('adj-branch', 'ubon'); setv('adj-product', product.name); setv('adj-type', 'increase'); setv('adj-qty', '1'); setv('adj-reason', 'นับสต็อก');
    h.messages.length = 0; w.pcPostAdjustment();
    assert.match(msgs(), /ซื้อ\/ภาษีซื้อ ถูกปิดถึง 2026-09-30/);
    setv('transfer-date', '2026-09-15'); setv('transfer-product', product.name); setv('transfer-from', 'ubon'); setv('transfer-to', 'khonkaen'); setv('transfer-qty', '1');
    h.messages.length = 0; w.pcPostTransfer();
    assert.match(msgs(), /ถูกปิดถึง 2026-09-30/);
    assert.equal(w.ERPProductionCore.exportData().inventoryMovements.length, movesBefore);
    // Goods receipt dated in the closed period (any open PO), and reversing a GR of the closed period.
    // (the sample data has no goods receipt: one posted on 10 Sep is stored as the GR screen would store it)
    const gr = { id: 'gr-r8fix', no: 'GR6909-001', date: '2026-09-10', branch: 'ubon', poId: 'po-x', poNo: 'PO-X', supplier: 'ผู้จำหน่าย', items: [{ productCode: product.code || '', product: product.name, unit: product.unit || 'ชิ้น', unitCost: 10, qty: 1 }], subtotal: 10, status: 'posted' };
    w.localStorage.setItem(`${TENANT}comform_goods_receipts_v1`, JSON.stringify([gr]));
    let asked = 0; w.confirm = () => { asked += 1; return true; }; h.messages.length = 0;
    w.pcReverseGr(gr.id);
    assert.equal(asked, 0, 'GR reversal refused before the question');
    assert.match(msgs(), /ถูกปิดถึง 2026-09-30/);
    assert.equal(w.ERPProductionCore.exportData().goodsReceipts[0].reversed, undefined);
    // delDoc cannot remove an issued credit note / debit note / 50 ทวิ, even when called directly.
    for (const type of ['creditNotes', 'debitNotes', 'whtCertificates']) {
      const row = I.business()[type]?.[0] || w.ERPPayerWht.readCertificates()[0];
      const before = JSON.stringify(w.loadFor(row._branch || row.branch, row._year, row._month)[type]);
      h.messages.length = 0;
      await w.delDoc(row._branch || row.branch, row._year, row._month, type, String(row.id));
      assert.equal(JSON.stringify(w.loadFor(row._branch || row.branch, row._year, row._month)[type]), before, type);
      assert.match(msgs(), /ลบไม่ได้ — ใช้การยกเลิก/);
    }
    // Branch-2 census: filings and branch locks are branch-2 records.
    const core = await import(require('node:url').pathToFileURL(path.join(ROOT, 'erp-branches-core.js')).href);
    const census = core.branchDataCensus({ vatReturns: [{ branchKey: 'khonkaen', branches: ['khonkaen'] }], whtFilings: [{ branch: 'khonkaen' }, { branch: 'ubon' }], periodLocks: [{ id: 'a', lockId: 'a', action: 'lock', branch: 'khonkaen' }, { id: 'b', lockId: 'b', action: 'lock', branch: 'all' }] });
    assert.deepEqual([census.counts.vatReturns, census.counts.whtFilings, census.counts.periodLocks, census.total], [1, 1, 1, 3]);
  } finally { h.close(); }
  // A damaged lock store: boot completes without an uncaught error, saves stay refused (fail-closed).
  const uncaught = [];
  const h2 = await boot({ beforeScripts: w => { w.localStorage.setItem(`${TENANT}comform_governance_period_locks_v1`, '{broken'); w.addEventListener('error', e => uncaught.push(String(e.message))); } });
  try {
    await sleep(300);
    assert.deepEqual(uncaught, []);
    assert.equal(h2.errors.filter(line => /Uncaught/.test(line)).length, 0);
    assert.throws(() => h2.w.ERPGovernance.assertPeriodOpen({ branch: 'ubon', date: '2026-10-05', scope: 'sales' }), /period_locks/);
    assert.notEqual(h2.w.ERPGovernance.periodLockRefusal({ type: 'invoices', branch: 'ubon', date: '2026-10-05' }), '');
  } finally { h2.close(); }
});

const PROFILE_KEY = `${TENANT}comform_company_profile_v1`;
const LOGO_KEY = `${TENANT}comform_company_logo_v1`;
const SAVED_PROFILE = {
  schemaVersion: 1, nameTh: 'บริษัท สยามตัวอย่าง จำกัด', nameEn: '', taxId: '0105568123453', addressTh: '99/9 ถนนพระราม 9 กรุงเทพมหานคร 10310', phone: '02-123-4567', email: '', website: '',
  branches: { ubon: { code: '00000', label: '', addressTh: '' }, khonkaen: { code: '00001', label: 'สาขาขอนแก่น', addressTh: '' } }, updatedAt: '2026-10-03T10:00:00.000Z'
};
const b64 = (signature, length) => { let body = signature + 'A'.repeat(Math.max(0, length - signature.length)); while (body.length % 4) body += 'A'; return body; };
const LOGO = { schemaVersion: 1, dataUrl: `data:image/png;base64,${b64('iVBORw0KGgo', 4000)}`, mime: 'image/png', width: 600, height: 300, updatedAt: '2026-10-03T10:00:00.000Z' };

test('r8fix#C2: a SAMPLE 50 ทวิ prints the payer from the current company profile; a real certificate keeps its issued snapshot', async () => {
  const h = await seeded();
  const { w } = h;
  try {
    // The customer types their company in AFTER the sample data was loaded.
    w.localStorage.setItem(PROFILE_KEY, JSON.stringify(SAVED_PROFILE));
    w.ERPCompanyProfile.refresh();
    const sample = w.ERPPayerWht.readCertificates({ branches: ['ubon'] })[0];
    assert.equal(sample.demoSeed, true);
    assert.equal(sample.payer.taxId, '0000000000000', 'the stored snapshot is the sample payer');
    const overlay = w.ERPPayerWht.openCertificate(sample);
    const party = text(overlay.querySelector('.wht-cert-party'));
    assert.match(party, /0 1 0 5 5 6 8 1 2 3 4 5 3/);
    assert.match(party, /บริษัท สยามตัวอย่าง จำกัด/);
    assert.doesNotMatch(text(overlay), /0 0 0 0 0 0 0 0 0 0 0 0 0|บริษัทตัวอย่างสำหรับทดลองระบบ/);
    overlay.querySelector('.doc-preview-modal-close').click();
    // A real (non-sample) certificate is a legal record: it keeps the payer it was issued with.
    const real = { ...sample, demoSeed: undefined, payer: { name: 'บริษัท เดิม จำกัด', address: 'ที่อยู่เดิม', taxId: '0105561007075', branchCode: '00000' } };
    const html = w.ERPPayerWht.certificateHtml(real, 1, { livePayer: w.ERPPayerWht.payerInfo('ubon') });
    assert.match(html, /บริษัท เดิม จำกัด/);
    assert.doesNotMatch(html, /บริษัท สยามตัวอย่าง จำกัด/);
  } finally { h.close(); }
});

async function dialogContract(h, overlay, opener) {
  const { w } = h;
  const dialog = overlay.querySelector('.doc-preview-modal');
  assert.equal(dialog.getAttribute('role'), 'dialog');
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  assert.ok(dialog.contains(w.document.activeElement), 'focus moved into the dialog');
  const tabs = [...overlay.querySelectorAll('.doc-preview-modal-tabs button')];
  assert.deepEqual(tabs.map(b => b.getAttribute('aria-pressed')), ['true', ...tabs.slice(1).map(() => 'false')]);
  tabs[1].click();
  assert.deepEqual([...overlay.querySelectorAll('.doc-preview-modal-tabs button')].map(b => b.getAttribute('aria-pressed')).slice(0, 2), ['false', 'true']);
  // Tab from the last control wraps to the first; Shift+Tab from the first wraps to the last.
  const focusables = [...dialog.querySelectorAll('button:not([disabled])')];
  focusables.at(-1).focus();
  focusables.at(-1).dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  assert.equal(w.document.activeElement, dialog.querySelector('button:not([disabled])'));
  w.document.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  assert.equal(w.document.activeElement, [...dialog.querySelectorAll('button:not([disabled])')].at(-1));
  // Escape closes and focus goes back to what opened it.
  w.document.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(w.document.getElementById('doc-preview-modal-overlay'), null);
  assert.equal(w.document.activeElement, opener);
}

test('r8fix#C3: the 50 ทวิ, credit-note and debit-note viewers are real modal dialogs — focus in, trapped, Escape closes, focus restored, copy tabs aria-pressed', async () => {
  const h = await seeded();
  const { w } = h;
  try {
    const opener = w.document.createElement('button'); opener.textContent = 'opener'; w.document.body.append(opener);
    opener.focus();
    await dialogContract(h, w.ERPPayerWht.openCertificate(w.ERPPayerWht.readCertificates({ branches: ['ubon'] })[0]), opener);
    opener.focus();
    const cn = w.ERPCreditNotes.allCreditNotes().find(n => !n.voided);
    w.ERPCreditNotes.previewStored(cn.branch, cn._year, cn._month, String(cn.id));
    await dialogContract(h, w.document.getElementById('doc-preview-modal-overlay'), opener);
    opener.focus();
    const dn = w.ERPDebitNotes.allDebitNotes()[0];
    w.ERPDebitNotes.previewStored(dn.branch, dn._year, dn._month, String(dn.id));
    await dialogContract(h, w.document.getElementById('doc-preview-modal-overlay'), opener);
  } finally { h.close(); }
});

test('r8fix#C4: the simple / advanced switch is reachable without the header toggle (hidden ≤ 560 px): a Demo-menu item that flips the mode', async () => {
  const css = fs.readFileSync(path.join(ROOT, 'erp-product-experience.css'), 'utf8');
  assert.match(css, /@media\(max-width:560px\)\{(?:[^{}]*\{[^}]*\})*?\.pe-mode-toggle\{display:none\}/, 'the header toggle is still hidden on phones');
  const h = await boot();
  const { w } = h;
  try {
    const advanced = () => w.document.body.classList.contains('erp-advanced-mode');
    const item = () => [...w.document.querySelectorAll('#erp-demo-menu [role="menuitem"]')].find(el => /สลับเป็นโหมด/.test(el.textContent));
    for (let i = 0; i < 200 && !(w.ERPDemoMenu?.has?.('experience-mode') && w.document.getElementById('erp-demo-menu')); i += 1) await sleep(25);
    w.document.getElementById('erp-demo-menu-btn').click();
    const first = item();
    assert.ok(first, 'mode item in the Demo menu');
    const before = advanced();
    assert.match(text(first), before ? /สลับเป็นโหมดง่าย/ : /สลับเป็นโหมดขั้นสูง/);
    first.click(); await sleep(20);
    assert.equal(advanced(), !before);
    w.document.getElementById('erp-demo-menu-btn').click();
    assert.match(text(item()), !before ? /สลับเป็นโหมดง่าย/ : /สลับเป็นโหมดขั้นสูง/);
  } finally { h.close(); }
});

function longInvoice(n, product = i => `สินค้าทดสอบรายการที่ ${i + 1}`) {
  const items = Array.from({ length: n }, (_, i) => ({ productCode: `P${i + 1}`, product: product(i), qty: 1, unit: 'ชิ้น', priceUnit: 100, saleTotal: 100, costTotal: 0 }));
  return { id: 77, no: 'INVLONG', date: '2026-10-05', branch: 'ubon', customer: 'บริษัท ทดสอบ จำกัด', customerTaxId: '0105536000315', items, subtotal: 100 * n, vatAmt: 7 * n, total: 107 * n, useVat: 1, vatMode: 'add', creditTerm: 'credit30', dueDate: '2026-11-04' };
}

test('r8fix#C6: a 35-line tax invoice fits 16 single-line rows per A4 page (3 pages, was 5; mixed long names 4, was 9–11); rows are 1.8em per unit; a custom logo is in the print HTML once', async () => {
  const h = await boot({ beforeScripts: w => { w.localStorage.setItem(PROFILE_KEY, JSON.stringify(SAVED_PROFILE)); w.localStorage.setItem(LOGO_KEY, JSON.stringify(LOGO)); } });
  const { w } = h;
  try {
    const pagesOf = html => { const doc = new w.DOMParser().parseFromString(`<div>${html}</div>`, 'text/html'); return [...doc.querySelectorAll('.dtd-document-page')].map(pg => [...pg.querySelectorAll('tr.dtd-data-row')]); };
    const short = pagesOf(w.ComformDeliveryTaxDocument.buildInlineHtml(longInvoice(35), { b: 'ubon' }));
    assert.deepEqual(short.map(rows => rows.length), [16, 16, 3]);
    assert.equal(short[0][0].getAttribute('style'), 'height:1.80em');
    const names = ['บริการติดตั้งและตั้งค่าระบบเครือข่าย', 'Microsoft 365 Business Standard (1 ปี)', 'บริการบำรุงรักษาระบบรายเดือน (MA)', 'บริการติดตั้งและตั้งค่าระบบเครือข่าย (งานเพิ่มเติมนอกเวลาทำการ ชั้น 2-5 อาคาร B พร้อมเดินสาย LAN Cat6 ใหม่ทั้งหมด)', 'Microsoft 365 Business Standard (1 ปี)'];
    const mixed = pagesOf(w.ComformDeliveryTaxDocument.buildInlineHtml(longInvoice(35, i => names[i % 5]), { b: 'ubon' }));
    assert.equal(mixed.length, 4);
    assert.ok(mixed.slice(0, -1).every(rows => rows.length >= 10), mixed.map(r => r.length).join('/'));
    const longRow = mixed[0].find(row => /LAN Cat6/.test(row.textContent));
    assert.equal(longRow.getAttribute('style'), 'height:5.40em', 'a 3-line name takes 3 units and wraps inside its cell');
    // Print HTML (original + copies): the 4 KB logo data URL appears once, not twice per page.
    const printed = [];
    w.open = () => ({ opener: null, document: { write: html => printed.push(html), close() {} } });
    w.ComformDeliveryTaxDocument.loadFromInvoice(longInvoice(35), { b: 'ubon' });
    w.ComformDeliveryTaxDocument.print('all');
    assert.equal(printed.length, 1);
    const html = printed[0];
    const logo = w.CurrentUser.companyProfile.logoDataUrl || '';
    assert.ok(logo.startsWith('data:image/png'), 'custom logo in use');
    assert.ok((html.match(/<img[^>]*data-erp-logo/g) || []).length >= 6, 'every page still has its logo');
    assert.equal(html.split(logo).length - 1, 1, 'the data URL is written once');
    // In the app (PDF stage + on-screen preview) the document tables use the page font, not style.css's 13 px
    // table font, and the preview scales with its width like the 794 px PDF page (Chromium: 0 rows past the
    // totals box at 1440 / 1280 px, /tmp/claude-0/r8fix-c6-preview-*.png).
    for (const [file, p] of [['delivery-tax-document.css', 'dtd'], ['receipt-document.css', 'rcp']]) {
      const css = fs.readFileSync(path.join(ROOT, file), 'utf8');
      const block = css.slice(css.lastIndexOf('r8fix#C6'));
      assert.ok(block.includes(`.${p}-document-page table { font-size: inherit; }`), file);
      assert.ok(block.includes(`#${p}-live-preview { container-type: inline-size; }`), file);
      assert.ok(block.includes(`#${p}-live-preview .${p}-document-page:not(.${p}-pdf-page) { font-size: calc(100cqi * 10.9 / 794); }`), file);
    }
  } finally { h.close(); }
});

test('r8fix#C7: no ReferenceError on load — the auth-ready refresh calls the real dashboard renderer', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  assert.doesNotMatch(src, /renderDashboard\?\.\(\)/);
  const h = await boot();
  const { w } = h;
  try {
    const warnings = [];
    const original = w.console.warn;
    w.console.warn = (...args) => { warnings.push(args.map(String).join(' ')); };
    let rendered = 0;
    w.document.addEventListener('erp:dashboard-rendered', () => { rendered += 1; });
    w.dispatchEvent(new w.CustomEvent('comform-auth-ready'));
    await sleep(80);
    w.console.warn = original;
    assert.equal(warnings.filter(text => /ReferenceError|renderDashboard/.test(text)).length, 0, warnings.join('\n'));
    assert.ok(rendered >= 1, 'the dashboard was re-rendered');
  } finally { h.close(); }
});

test('r8fix#C8: the debit / credit-note lists, the 50 ทวิ register actions and the document viewers use the full control height (ADR-019 token, 42 px / 44 px on phones)', () => {
  const tax = fs.readFileSync(path.join(ROOT, 'erp-tax-reports.css'), 'utf8');
  assert.match(tax, /\.tax-wht-actions \.btn\{min-height:var\(--erp-control-height,42px\)\}/);
  const cn = fs.readFileSync(path.join(ROOT, 'credit-note-document.css'), 'utf8');
  assert.match(cn, /\.doc-preview-modal \.cn-doc-preview-actions \.btn,[\s\S]*?\{ min-height: var\(--erp-control-height\); \}/);
  assert.match(cn, /\.wht-cert-overlay \.doc-preview-modal-tabs button/);
  assert.ok(cn.includes('#panel-debit-note-list :is(.btn, select, input:not([type=checkbox]):not([type=radio]), .erp-rowact-more)'));
  // The tokens themselves (ADR-019): control height 42 px, raised to 44 px ≤ 900 px.
  const ui = fs.readFileSync(path.join(ROOT, 'erp-ui.css'), 'utf8');
  assert.match(ui, /--erp-control-height:var\(--erp-btn-height\)/);
  assert.match(ui, /--erp-btn-height:42px/);
});

test('r8fix#C9: the sample phone 000-000-0000 is never printed; the printed payment term follows the credit term; CN year filter in พ.ศ.; buyer name full width; an empty target chart shows an empty state', async () => {
  const h = await seeded();
  const { w } = h;
  try {
    const inv = w.ERPIntegrity.business().invoices.find(i => i.no === 'INV690704');
    const html = w.ComformDeliveryTaxDocument.buildInlineHtml(inv, { b: inv._branch });
    assert.doesNotMatch(html, /000-000-0000/);
    const doc = new w.DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    const meta = [...doc.querySelectorAll('.dtd-doc-meta-table tbody td')].map(td => td.textContent.trim());
    assert.ok(meta.includes('เครดิต 60 วัน'), meta.join(' | '));
    assert.ok(!meta.includes('เงินสด'));
    // A saved profile whose phone is still the placeholder is not printed either; a real number is.
    const core = await import(require('node:url').pathToFileURL(path.join(ROOT, 'erp-company-profile-core.js')).href);
    assert.equal(core.printableContactLine('Tel: 000-000-0000   Fax: 000-000-0000'), '');
    assert.equal(core.printableContactLine('Tel: 02-123-4567   Fax: 000-000-0000'), 'Tel: 02-123-4567');
    assert.equal(core.companyProfileFormValues(null, { phone: '000-000-0000' }).phone, '', 'the form shows the placeholder as a hint, not a value');
    // Credit-note invoice filter shows the year in พ.ศ. (a ค.ศ. value still works).
    w.ERPCreditNotes.reset();
    assert.equal(w.document.getElementById('cn-inv-filter-year').value, String(new Date().getFullYear() + 543));
    assert.equal(w.document.getElementById('cn-cust').closest('.ff').classList.contains('ff-full'), true);
    // Seed walk-in cash invoice: term เงินสด, no due date.
    const cash = w.ERPIntegrity.business().invoices.find(i => /เงินสด/.test(i.note || '') && i.taxInvoiceForm === 'abbreviated');
    assert.equal(cash.dueDate, '');
  } finally { h.close(); }
  // Empty store: the target chart is an empty state, not 0.27 / 0.54 / 1.08 ticks.
  const h2 = await boot();
  try {
    h2.w.go('dashboard', null); await sleep(30);
    const chart = h2.w.document.getElementById('exec-sales-target-chart');
    assert.match(text(chart), /ยังไม่มียอดหรือเป้าหมายในช่วงที่เลือก/);
    assert.doesNotMatch(text(chart), /0\.27|0\.54|1\.08/);
  } finally { h2.close(); }
});

test('r8fix#C5: 390 px phones — the analytics filters / trend rows, the backup page, the portal banner and the document editors fit the screen; list action columns are not pinned; the ☰ never covers the last buttons (layout proof: Chromium 390 × 844, every panel scrollWidth = 0, /tmp/claude-0/r8fix-c5-390-*.png)', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'erp-ui.css'), 'utf8');
  const block = ui.slice(ui.indexOf('r8fix#C5'));
  assert.match(block, /@media\(max-width:760px\)\{[\s\S]*?\.analytics-filter-grid\{grid-template-columns:minmax\(0,1fr\)\}[\s\S]*?\.analytics-chart \.chart-bar-row\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(block, /\.export-grid\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(block, /\.main\{padding-bottom:calc\(12px \+ 76px\)\}/);
  assert.match(block, /\.pe-portal-warning\{white-space:normal/);
  assert.match(block, /@media\(max-width:560px\)\{[\s\S]*?td\.erp-rowact-cell:last-child[\s\S]*?\{position:static;box-shadow:none\}/);
  // The block comes AFTER the rules it corrects (same specificity → the later rule wins).
  const style = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(style.indexOf('href="style.css"') < style.indexOf('href="erp-ui.css"'), 'erp-ui.css loads after style.css');
  for (const [file, p] of [['delivery-tax-document.css', 'dtd'], ['receipt-document.css', 'rcp']]) {
    const css = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(css.slice(css.lastIndexOf('r8fix#C5')), new RegExp(`@media \\(max-width: 1250px\\) \\{\\s*\\.${p}-workspace \\{ grid-template-columns: minmax\\(0, 1fr\\); \\}`));
  }
});

// R9.1: run on several load dates, not only 5 Oct 2569 — the script's fixed figures must hold on any of them, and
// its ⏱ (date-dependent) figures hold on days 1–9 of a month and are explained for the other days. Dates: 5 Oct and
// 3 Nov 2569 (story months of 30 / 31 days), 8 Jan 2570 (year end: story month ธันวาคม 2569), 1 Mar 2570 (after a
// 28-day February; the "yesterday" walk-in sales stay on the 1st), 13 Oct 2569 (the day the drift was found) and
// 20 Nov 2569 (late in a month).
const C1_LOAD_DAYS = ['2026-10-05', '2026-11-03', '2027-01-08', '2027-03-01', '2026-10-13', '2026-11-20'];
async function demoScriptFiguresOn(day) {
  const fixed = Date.parse(`${day}T10:00:00+07:00`);
  const h = await boot({ beforeScripts: w => { const Real = w.Date; w.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(fixed); } static now() { return fixed; } }; } });
  const { w, set } = h;
  const $ = id => w.document.getElementById(id);
  const script = fs.readFileSync(path.join(ROOT, 'docs/DEMO_SCRIPT_TH.md'), 'utf8');
  const money = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const inScript = (value, why) => assert.ok(script.includes(value), `DEMO_SCRIPT_TH.md should say ${value} (${why}; load ${day})`);
  const year = Number(day.slice(0, 4)), dayOfMonth = Number(day.slice(8, 10));
  // The window in which the 130-day history sits in one calendar year (11 May – 31 Dec; 10 May in a leap year).
  const oneYear = day.slice(5) >= (year % 4 === 0 ? '05-10' : '05-11');
  try {
    const result = await w.ERPDemoSeed.load({ confirm: () => true });
    assert.equal(result.status, 'loaded');
    assert.equal(result.plan.today, day, 'the load uses the (pinned) clock');
    const I = w.ERPIntegrity, data = I.business();
    // Line 19: what the sample loads.
    const counts = [data.quotes.length, data.invoices.length, data.receipts.length, data.creditNotes.length, data.debitNotes.length, data.expenses.length, (I.flow().billingNotes || []).length];
    assert.deepEqual(counts, [5, 24, 13, 4, 1, 21, 1]); // r13#MED-7: + the J1 / J3 subcontract payments; ADR-031: + USD export invoice, 2 USD receipts, JPY expense
    inScript('ใบเสนอราคา 5, ใบกำกับภาษี 24 (ยกเลิก 1 · อย่างย่อ 5 · ส่งออก USD 1), ใบเสร็จ 13, ใบลดหนี้ 4 (ยกเลิก 1), ใบเพิ่มหนี้ 1, ใบวางบิล 1, ค่าใช้จ่าย 21, หนังสือรับรอง 50 ทวิ 12', 'seed counts');
    assert.equal(data.invoices.filter(i => !I.live(i)).length, 1);
    const masterNames = new Set(w.contactMasterRows().map(r => r.name));
    assert.equal(result.plan.contacts.length, 9); assert.ok(result.plan.contacts.every(c => masterNames.has(c.name)));
    assert.equal(w.productMasterRows().filter(p => /^DEMO-/.test(p.code || '')).length, 12);
    inScript('ลูกค้า 9 ราย + ลูกค้าหน้าร้าน, สินค้า/บริการ 12 รายการ', 'master data');
    assert.equal(data.invoices.filter(i => i.taxInvoiceForm === 'abbreviated').length, 5);
    // Dashboard tiles + branch split (sales/target tab, all months of the sample's history — the year of the load and
    // the year before, so a January load counts the same history).
    const statsOf = (branch, years) => years.map(y => w.testApp.branchStats(branch, y, -1)).reduce((a, s) => ({ st: a.st + s.st, ct: a.ct + s.ct, cm: a.cm + s.cm, ex: a.ex + s.ex, net: a.net + s.net }), { st: 0, ct: 0, cm: 0, ex: 0, net: 0 });
    const stats = branch => statsOf(branch, [year - 1, year]);
    const r2 = n => Math.round(n * 100) / 100;
    const ub = stats('ubon'), kk = stats('khonkaen');
    const all = { st: r2(ub.st + kk.st), ct: r2(ub.ct + kk.ct), cm: r2(ub.cm + kk.cm), ex: r2(ub.ex + kk.ex), net: r2(ub.net + kk.net) };
    // r13#MED-7: expenses + 1,500 (J1 subcontract, head office) + 1,600 (J3 crane hire, branch) → 124,915; net − 3,100.
    // ADR-031: + the head office's USD export (97,962.90 before VAT, cost 5 × 11,800 = 59,000) and JPY service from Japan
    // (26,814.72): sales 716,010 → 813,972.90 · cost 525,700 → 584,700 · expenses 124,915 → 151,729.72 · net + 12,148.18.
    assert.deepEqual(all, { st: 813972.9, ct: 584700, cm: 21131.7, ex: 151729.72, net: 56411.48 });
    assert.deepEqual([r2(ub.st), r2(ub.net), r2(kk.st), r2(kk.net)], [502672.9, 16098.08, 311300, 40313.4]);
    inScript(`ยอดขาย **${money(all.st)}** · กำไรสุทธิ **${money(all.net)}**`, 'overview KPIs');
    inScript(`ยอดขายรวมก่อน VAT 2 สาขา **${money(all.st)}** · ต้นทุน **${money(all.ct)}** · ค่าคอมมิชชัน **${money(all.cm)}** · ค่าใช้จ่าย **${money(all.ex)}** · กำไรสุทธิรวม **${money(all.net)}**`, 'sales tab');
    inScript(`ยอดขาย ${money(ub.st)} กำไรสุทธิ ${money(ub.net)}`, 'HQ'); inScript(`${money(kk.st)} กำไรสุทธิ ${money(kk.net)}`, 'branch 00001');
    // "ปี พ.ศ. ปัจจุบัน" alone shows the same figures inside the one-year window; outside it the script says to add the year before.
    const thisYear = statsOf('ubon', [year]).st + statsOf('khonkaen', [year]).st;
    if (oneYear) assert.equal(r2(thisYear), all.st, 'the current year holds the whole history');
    else { assert.ok(r2(thisYear) < all.st, 'part of the history is in the year before'); inScript('*ถ้าสาธิตช่วง 1 ม.ค. – 10 พ.ค.*: ข้อมูลตัวอย่างบางส่วนอยู่ปีก่อน ให้เลือกปีก่อนหน้าด้วย (ตัวเลข 2 ปีรวมกัน = ตัวเลขด้านบน)', 'January–May loads'); }
    // AR aging before the live steps. Fixed on every load date: the total, 11 bills / 8 customers, over 90 and 61–90.
    const before = w.ERPReceivables.snapshot('').aging.totals;
    assert.deepEqual([before.total, before.invoiceCount, before.customerCount, before.buckets['61_90'], before.buckets.over_90], [436889.4, 11, 8, 124933.2, 43741.6]);
    inScript(`ลูกหนี้คงค้าง **${money(before.total)}** (11 บิล) · เกินกำหนดชำระ **278,260.80** ⏱`, 'overview AR');
    inScript(`ลูกหนี้คงค้างรวม **฿${money(before.total)}** (11 บิล · 8 ราย — ทุกวันที่โหลด) · ⏱ เกินกำหนด **฿278,260.80 (63.7%)** · เกิน 90 วัน **฿${money(before.buckets.over_90)}** (ทุกวันที่โหลด)`, 'AR tab');
    if (dayOfMonth <= 9) {
      // ⏱ figures of the script = a load on days 1–9 of a month.
      assert.deepEqual([before.overdue, w.ERPReceivables.snapshot('').alert.overdueCount, before.buckets.current, before.buckets['1_30'], before.buckets['31_60']], [278260.8, 5, 158628.6, 82836, 26750]);
      inScript(`ยังไม่ถึงกำหนด ฿${money(before.buckets.current)} · 1–30 วัน ฿${money(before.buckets['1_30'])} · 31–60 วัน ฿${money(before.buckets['31_60'])} · 61–90 วัน ฿${money(before.buckets['61_90'])} · เกิน 90 วัน ฿${money(before.buckets.over_90)}`, 'aging buckets');
      inScript(`(${(before.overdue / before.total * 100).toFixed(1)}%)`, 'overdue share');
    } else {
      // Later in the month the 30-day bills of the story month fall due: more is overdue, the script says how to read it.
      assert.ok(before.overdue > 278260.8, `overdue grows after the 9th (${before.overdue})`);
      inScript('⏱ **ตัวเลขขึ้นกับวันที่โหลด — อ่านอย่างนี้เมื่อโหลดวันที่ 10 เป็นต้นไป**', 'how to read a later load');
      if (day === '2026-10-13') {
        assert.deepEqual([w.ERPReceivables.snapshot('').alert.overdueCount, before.overdue], [6, 335933.8]);
        inScript('เช่นโหลด 13/10/2569: เกินกำหนด 6 ใบ ฿335,933.80', 'the example of a later load');
      }
    }

    // Live step: tax invoice, "ราคายังไม่รวม VAT — บวกเพิ่ม 7%".
    inScript('เลือก **ราคายังไม่รวม VAT — บวกเพิ่ม 7%**', 'step 2:30 must say which VAT mode (the default is "ราคารวม VAT แล้ว")');
    await sleep(50);
    w.go('invoice-form', null); w.resetF('invoice'); w.selBr('i', 'khonkaen');
    set('i-cust', 'บจก. อีสานโลจิสติกส์ เอ็กซ์เพรส'); set('i-credit-term', 'credit30'); fire(w, $('i-credit-term'));
    set('i-vat', '1'); fire(w, $('i-vat'));
    $('i-items-body').innerHTML = '';
    w.addIItem({ product: 'เครื่องพิมพ์เลเซอร์มัลติฟังก์ชัน (พิมพ์/สแกน/ถ่ายเอกสาร)', qty: 1, unit: 'เครื่อง', priceUnit: 8990 });
    w.addIItem({ product: 'ตลับหมึกเลเซอร์ (ของแท้) สำหรับ DEMO-PR01', qty: 2, unit: 'ตลับ', priceUnit: 2290 });
    w.calcI();
    assert.deepEqual([$('i-st').value, $('i-vat-amt').value, $('i-grand-total').value], ['13,570.00', '949.90', '14,519.90']);
    inScript('ก่อน VAT **13,570.00** VAT **949.90** รวม **฿14,519.90**', 'invoice step');
    await w.saveInvoice();
    const fresh = I.business().invoices.find(i => i.grandTotal === 14519.9 || i.total === 14519.9);
    assert.ok(fresh, said(h));
    assert.deepEqual([fresh.vatMode, fresh.subtotal, fresh.vatAmt, fresh.date], ['add', 13570, 949.9, day]);

    // Live step: receipt for the MA bill — the dropdown shows the bill amount (step 4:00).
    await sleep(50);
    w.go('receipt-form', null); w.resetF('receipt'); w.selBr('r', 'khonkaen'); w.populateInvRefs();
    // R9.1: the bill list opens on the current year (index.html no longer types 2026 into the year box).
    assert.equal($('r-inv-filter-year').value, String(year));
    let options = [...$('r-inv-ref').options];
    assert.ok(options.some(o => /\| ฿14,519\.90 \| ⏳ รอชำระ$/.test(o.textContent)), `the new invoice is listed with its amount (${day}): ${options.map(o => o.textContent).join(' / ')}`);
    // The MA bill is dated in the story month: in January that is December of the year before — the script says to
    // type that year into the list's year box.
    const storyYear = Number(result.plan.storyPeriod.slice(0, 4));
    if (storyYear !== year) {
      inScript('⏱ โหลดเดือน ม.ค.: บิลนี้ลงวันที่เดือน ธ.ค. ปีก่อน — ช่อง **ปี** เหนือรายการบิลใส่ปีก่อน (ค.ศ. เช่น 2026)', 'January receipt step');
      set('r-inv-filter-year', String(storyYear)); w.populateInvRefs();
      options = [...$('r-inv-ref').options];
    }
    const ma = options.find(o => /อีสานโลจิสติกส์/.test(o.textContent) && /\| ฿9,630\.00 \| ⏳ รอชำระ$/.test(o.textContent));
    assert.ok(ma, options.map(o => o.textContent).join('\n'));
    inScript('บิลค่าบริการ MA ของ บจก. อีสานโลจิสติกส์ เอ็กซ์เพรส ฿9,630.00', 'receipt step');
    $('r-inv-ref').value = ma.value; w.fillFromInv();
    set('r-wht-rate', '3'); fire(w, $('r-wht-rate')); set('r-wht-cert-no', '2569/10-0001');
    w.calcR();
    assert.deepEqual([$('r-grand-total').value, $('r-wht-amt').value, $('r-cash-received').value], ['9,630.00', '270.00', '9,360.00']);
    inScript('หัก **270.00** (คิดจากยอดก่อน VAT 9,000) รับจริง **9,360.00**', 'receipt WHT');
    await w.saveReceipt();
    await sleep(50);
    const maInv = I.business().invoices.find(i => i.no === JSON.parse(ma.value).no);
    assert.equal(I.paymentSummary(maInv).outstanding, 0, said(h));

    // Live step: credit note 2,290 before VAT on the new invoice (step 5:30).
    assert.equal(w.ERPCreditNotes.startFromInvoice(fresh._branch, fresh._year, fresh._month, String(fresh.id)), true);
    const diff = w.document.querySelector('[data-cn-line-field="diff"]');
    diff.value = '2290'; fire(w, diff);
    $('cn-reason').value = 'returned_goods'; fire(w, $('cn-reason'));
    assert.deepEqual(['cn-original-value', 'cn-correct-value', 'cn-diff', 'cn-vat-amt', 'cn-total'].map(id => $(id).value), ['13,570.00', '11,280.00', '2,290.00', '160.30', '2,450.30']);
    inScript('**ผลต่าง (ก่อน VAT) 2,290.00** (มูลค่าเดิม 13,570.00 · "มูลค่าที่ถูกต้อง" 11,280.00)', 'CN step');
    inScript('VAT ของผลต่าง **160.30** รวมลดหนี้ **฿2,450.30**', 'CN totals');
    const cn = await w.ERPCreditNotes.save();
    assert.ok(cn, said(h));
    assert.deepEqual([cn.subtotal, cn.vatAmt, cn.total], [2290, 160.3, 2450.3]);

    // After the live steps: the total on every load date; the ⏱ split on days 1–9.
    const after = w.ERPReceivables.snapshot('').aging.totals;
    assert.deepEqual([after.total, after.buckets.current, after.overdue], [r2(before.total + 14519.9 - 9630 - 2450.3), r2(before.buckets.current + 14519.9 - 9630 - 2450.3), before.overdue]);
    assert.equal(after.total, 439329);
    inScript(`ยอดรวมจะเป็น **฿${money(after.total)}** (ทุกวันที่โหลด; ⏱`, 'AR after');
    if (dayOfMonth <= 9) {
      assert.equal(after.buckets.current, 161068.2);
      inScript(`⏱ ${(after.overdue / after.total * 100).toFixed(1)}% เกินกำหนด) และช่อง "ยังไม่ถึงกำหนด" เป็น **฿${money(after.buckets.current)}** ⏱ — ส่วน **เกินกำหนดยังเป็น 5 ใบ ฿${money(after.overdue)}** เท่าเดิม ⏱`, 'AR after (days 1–9)');
    }
    const ub2 = stats('ubon'), kk2 = stats('khonkaen');
    assert.deepEqual([r2(ub2.st + kk2.st), r2(ub2.net + kk2.net)], [825252.9, 67691.48]);
    inScript('ยอดขายก่อน VAT จะเป็น **825,252.90** = +13,570 จากบิลใหม่ −2,290 จากใบลดหนี้ และกำไรสุทธิรวม **67,691.48**', 'sales after');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
}
test('r8fix#C1: docs/DEMO_SCRIPT_TH.md figures come from the seeded store — KPIs, AR aging, branch split, the live steps (invoice "ราคายังไม่รวม VAT", receipt with WHT 3%, credit note 2,290 + 160.30) and the after-figures; the receipt dropdown shows the bill amount — on six load dates (R9.1)', async () => {
  // The script was written for a load "early in the month" (05/10/2569) and only that clock was tested; R9.1 loads it on
  // six days (C1_LOAD_DAYS above): the fixed figures on all of them, the ⏱ figures on days 1–9 and their reading rule after.
  for (const day of C1_LOAD_DAYS) await demoScriptFiguresOn(day);
});
