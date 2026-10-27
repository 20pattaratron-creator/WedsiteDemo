// ADR-028 (round 11) — the page "ต้นทุนและกำไรต่องาน" in the booted app (jsdom) with the sample data loaded on
// 21 Oct 2569 (clock pinned): the job cost sheet in simple mode (J1 the loss, budget vs actual), the quick-entry
// forms through the DOM on an open job (issue / labour) and the API (return / other / completion / void), refusals,
// reports and CSV / Excel with the network blocked, English, the JSON backup round trip (fail-closed), the reset,
// one establishment, closed periods (same Thai text as every period lock, nothing written), the analytics / dashboard
// agreement, the method lock (ประมวลรัษฎากร มาตรา 65 ทวิ (6)). Pure rules: costing-core / costing-seed tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot } = require('./dom-helper.cjs');
const { bootEnglish, settle, THAI_RE } = require('./i18n-helper.cjs');

const ROOT = path.resolve(__dirname, '..');
const TENANT = 'erp_tenant::customer-showcase-local::';
const SETTINGS_KEY = `${TENANT}comform_costing_settings_v1`;
const JOBS_KEY = `${TENANT}comform_job_costing_v1`;
const MOVES_KEY = `${TENANT}comform_inventory_movements_v1`;
const BRANCH_SETTING_KEY = `${TENANT}comform_company_branch_setting_v1`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = el => String(el?.textContent || '').replace(/\s+/g, ' ').trim();
const plain = value => JSON.parse(JSON.stringify(value));
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
    return h;
  } catch (error) { h.close(); throw error; }
}
const jobKeyOf = (w, plan, key) => w.ERPCosting.dataset().jobs.find(job => job.no === plan.expected.jobs[key].no).key;
async function openCosting(w, options = {}) {
  w.go('job-costing', null);
  await sleep(10);
  return w.ERPCosting.select({ tab: 'jobs', branch: 'all', jobKey: '', ...options });
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
// An open job (a production order made from a sales order, so the analytics measure counts its invoice, not it).
function addOpenJob(w) {
  const pack = w.ComformDocumentWriteStore.loadForWrite('ubon', 2026, 9);
  const record = { id: 1760000000777, schemaVersion: 3, no: 'PD691099', date: '2026-10-10', branch: 'ubon', maker: 'ทีมช่างของบริษัท', customer: 'รพ.รวมแพทย์อุบล', job: 'งานทดสอบต้นทุน', items: [{ product: 'บริการบำรุงรักษาระบบรายเดือน (MA)', productCode: 'DEMO-SV02', qty: 1, unit: 'ครั้ง', priceUnit: 4500, total: 4500 }], qty: 1, subtotal: 4500, total: 4500, costTotal: 0, sourceSalesOrderId: 'so-test-1', sourceSalesOrderNo: 'SO6910-0099', _year: 2026, _month: 9 };
  pack.productions.push(record);
  w.ERPIntegrity.transaction([[w.ComformTenant.storageKey('biz2_ubon_2026_10'), pack]]);
  w.ERPIntegrity.changed?.();
  w.ERPCosting.invalidate();
  return `ubon|${record.id}`;
}
// The cost sheet as lines: one per table row (cells joined by a space; the hours note left out), then the result box.
function sheetText(d) {
  const rows = [...d.querySelectorAll('#jc-sheet .jc-sheet-table tr')].map(tr => [...tr.children].map(cell => { const copy = cell.cloneNode(true); copy.querySelectorAll('small').forEach(el => el.remove()); return text(copy); }).join(' '));
  const result = [...d.querySelectorAll('#jc-sheet .jc-result b')].map(text).join(' ');
  return `${rows.join('\n')}\n${result}`;
}
function submit(w, kind) {
  const form = w.document.querySelector(`#jc-root [data-jc-form="${kind}"]`);
  assert.ok(form, `form ${kind}`);
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
}

test('capp#1 simple-mode menu; the J1 cost sheet: budget vs actual, the loss in red; J2 green, J3 amber; the production row action', async () => {
  const h = await seeded(); const { w } = h; const d = w.document;
  try {
    const find = () => [...d.querySelectorAll('.sidebar .nav-item')].find(el => el.dataset.pePanel === 'job-costing' && el.closest('.nav-group'));
    for (let i = 0; i < 160 && !find(); i += 1) await sleep(25);
    const item = find();
    assert.ok(item && !item.hidden && !item.closest('.nav-group').hidden, 'visible in simple mode');
    assert.equal(item.closest('.nav-group').dataset.navSection, 'operations');
    const J1 = jobKeyOf(w, h.plan, 'J1');
    await openCosting(w, { jobKey: J1 });
    assert.ok(d.getElementById('panel-job-costing').classList.contains('active'));
    assert.equal(d.querySelectorAll('#jc-root [role="tab"]').length, 6);
    const sheet = sheetText(d);
    // วัสดุ budget 9,800 / actual 17,500 / +7,700 · แรงงาน 2,400 / 7,120 · โสหุ้ย 1,200 / 3,000 · อื่น ๆ 0 / 1,500 · รวม 13,400 / 29,120 / +15,720
    assert.match(sheet, /฿9,800\.00 ฿17,500\.00 \+฿7,700\.00/);
    assert.match(sheet, /฿2,400\.00 ฿7,120\.00 \+฿4,720\.00/);
    assert.match(sheet, /฿1,200\.00 ฿3,000\.00 \+฿1,800\.00/);
    assert.match(sheet, /฿0\.00 ฿1,500\.00 \+฿1,500\.00/);
    assert.match(sheet, /฿13,400\.00 ฿29,120\.00 \+฿15,720\.00/);
    assert.match(sheet, /฿25,000\.00 ฿29,120\.00 −฿4,120\.00 −16\.5%/);
    assert.ok(d.querySelector('#jc-sheet .jc-result').classList.contains('jc-loss'));
    for (const [key, cls, line] of [['J2', 'jc-good', /฿13,500\.00 ฿3,750\.00 ฿9,750\.00 72\.2%/], ['J3', 'jc-thin', /฿15,500\.00 ฿14,430\.00 ฿1,070\.00 6\.9%/], ['J4', 'jc-thin', /฿9,000\.00 ฿8,450\.00 ฿550\.00 6\.1%/]]) {
      w.ERPCosting.select({ jobKey: jobKeyOf(w, h.plan, key) });
      assert.match(sheetText(d), line, key);
      assert.ok(d.querySelector('#jc-sheet .jc-result').classList.contains(cls), key);
    }
    // Controls of the page: 42 px (the ADR-019 token), 44 px on a touch screen ≤ 900 px — the stylesheet says so.
    const css = fs.readFileSync(path.join(ROOT, 'erp-costing.css'), 'utf8');
    assert.match(css, /\.jc-form input,\.jc-form select,[^{]*\{min-height:var\(--erp-control-height,42px\)/);
    assert.match(css, /@media \(max-width:900px\)\{\s*[^}]*\.jc-form \.btn[^{]*\{min-height:var\(--erp-touch-target,44px\)\}/);
    // The production list: every row has "ใบต้นทุนงาน", which opens the sheet of that job.
    w.go('production-list', null);
    await settle(w, 20);
    const job = w.ERPCosting.dataset().jobs.find(row => row.key === J1);
    w.ERPCosting.select({ jobKey: '' });
    w.ERPCosting.openJobSheet(job.branch, job.id);
    assert.ok(d.getElementById('panel-job-costing').classList.contains('active'));
    assert.equal(w.ERPCosting.state().jobKey, J1);
    assert.match(text(d.getElementById('jc-sheet-title')), new RegExp(job.no));
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('capp#2 quick entry on an open job: DOM forms (issue, labour) + return, other, completion, void; refusals say why', async () => {
  const h = await seeded(); const { w } = h; const d = w.document;
  try {
    const key = addOpenJob(w);
    await openCosting(w, { jobKey: key });
    assert.ok(d.querySelector(`#jc-root [data-jc-job-forms="${key}"]`), 'forms of the open job');
    // Issue 2 × RM-CLEAN at the head office: opening 10 at 350, J2 took 3 → still 350 → 700.
    d.getElementById('jc-issue-product').value = 'RM-CLEAN';
    d.getElementById('jc-issue-qty').value = '2';
    d.getElementById('jc-issue-date').value = '2026-10-15';
    submit(w, 'issue');
    await settle(w, 10);
    let sheet = w.ERPCosting.dataset().sheets.get(key);
    assert.equal(sheet.materials.net, 70000, h.messages.join('\n'));
    // Labour 5 h of ทีมติดตั้ง A: 5 × 220 = 1,100 + overhead 5 × 75 = 375.
    w.ERPCosting.select({ jobKey: key });
    d.getElementById('jc-labour-person').value = 'ทีมติดตั้ง A';
    d.getElementById('jc-labour-hours').value = '5';
    d.getElementById('jc-labour-date').value = '2026-10-16';
    submit(w, 'labour');
    await settle(w, 10);
    sheet = w.ERPCosting.dataset().sheets.get(key);
    assert.deepEqual([sheet.labour.amount, sheet.overhead.amount], [110000, 37500]);
    const C = w.ERPCosting;
    // Refusals (nothing written): more than the stock, no person, before the job, a wrong category.
    const before = [w.localStorage.getItem(JOBS_KEY), w.localStorage.getItem(MOVES_KEY)];
    assert.match(C.postMaterialIssue({ jobKey: key, productCode: 'RM-CLEAN', qty: 100, date: '2026-10-17' }).message, /สต็อก|คงเหลือ/);
    assert.equal(C.postLabour({ jobKey: key, person: '', hours: 2, date: '2026-10-17' }).ok, false);
    assert.equal(C.postOtherCost({ jobKey: key, category: 'x', description: 'a', amount: 1, date: '2026-10-17' }).ok, false);
    assert.equal(C.postLabour({ jobKey: key, person: 'ช่างสมศักดิ์', hours: 1, date: '2026-10-01' }).ok, false, 'before the job');
    assert.deepEqual([w.localStorage.getItem(JOBS_KEY), w.localStorage.getItem(MOVES_KEY)], before);
    // Return 1 of the 2 (at the issue's own cost 350), a subcontract 250, then complete to cost of sales.
    const issueId = sheet.materials.issues[0].movementId;
    assert.equal(C.postMaterialReturn({ jobKey: key, issueMovementId: issueId, qty: 1, date: '2026-10-18' }).ok, true);
    assert.equal(C.postMaterialReturn({ jobKey: key, issueMovementId: issueId, qty: 5, date: '2026-10-18' }).ok, false, 'more than issued');
    assert.equal(C.postOtherCost({ jobKey: key, category: 'subcontract', description: 'ค่าขนส่งอุปกรณ์', amount: 250, date: '2026-10-18' }).ok, true);
    assert.equal(C.postCompletion({ jobKey: key, goodQty: 1, scrapQty: 0, destination: 'cost_of_sales', date: '2026-10-20' }).ok, true);
    sheet = C.dataset().sheets.get(key);
    // 350 + 1,100 + 375 + 250 = 2,075
    assert.deepEqual([sheet.status, sheet.materials.net, sheet.total], ['completed', 35000, 207500]);
    assert.equal(C.postLabour({ jobKey: key, person: 'ช่างสมศักดิ์', hours: 1, date: '2026-10-20' }).ok, false, 'a completed job takes no more cost');
    // Void the completion (with a reason) → open again; the voided row stays with who / when / why.
    const completion = sheet.completion;
    assert.equal(C.voidCostEntry({ jobKey: key, id: completion.id, reason: '' }).ok, false, 'a reason is required');
    assert.equal(C.voidCostEntry({ jobKey: key, id: completion.id, reason: 'นับจำนวนผิด' }).ok, true);
    const stored = JSON.parse(w.localStorage.getItem(JOBS_KEY)).entries.find(e => e.id === completion.id);
    assert.deepEqual([stored.status, stored.voidReason], ['voided', 'นับจำนวนผิด']);
    assert.equal(C.dataset().sheets.get(key).status, 'open');
    // Stock card of RM-CLEAN at HQ: 10 − 3 (J2) − 2 + 1 = 6 at 350 = 2,100.
    C.select({ tab: 'stock', stockSku: 'RM-CLEAN', stockBranch: 'ubon' });
    const card = C.view().card;
    assert.deepEqual([card.closing.qm, card.closing.value], [6000, 210000]);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('capp#3 reports and exports with the network blocked: profit by job / customer / product / month, stock card, valuation, NRV, overhead', async () => {
  const h = await seeded(); const { w } = h; const d = w.document;
  try {
    w.fetch = () => { throw new Error('network blocked'); };
    w.URL.createObjectURL = () => 'blob:test';
    w.URL.revokeObjectURL = () => {};
    await openCosting(w);
    const C = w.ERPCosting;
    C.select({ tab: 'profit', dimension: 'customer', periodType: 'all', period: '' });
    const csv = C.exportCsv('profit').replace(/^﻿/, '');
    // อีสานโลจิสติกส์: revenue 24,500, cost 22,880, GP 1,620 (6.6 %) — only the job sales of this customer have a cost.
    const isan = csv.split(/\r?\n/).find(line => line.startsWith('บจก. อีสานโลจิสติกส์ เอ็กซ์เพรส,'));
    assert.ok(isan, csv.slice(0, 400));
    for (const dimension of ['job', 'product', 'month']) {
      C.select({ tab: 'profit', dimension });
      const table = C.exportRows('profit');
      assert.ok(table.rows.length > 2, dimension);
      assert.ok(table.sheet.length <= 31 && !/[\\/?*[\]:]/.test(table.sheet), `valid sheet name ${table.sheet}`);
    }
    C.select({ tab: 'profit', dimension: 'job' });
    const jobRows = C.exportRows('profit').rows;
    const j1 = jobRows.find(row => String(row[0]).includes(h.plan.expected.jobs.J1.no));
    assert.ok(j1 && j1.includes(25000) && j1.includes(29120) && j1.includes(-4120), JSON.stringify(j1));
    C.select({ tab: 'stock', stockSku: 'RM-CAB6', stockBranch: 'khonkaen' });
    const stock = C.exportRows('stock');
    // สาขา: opening 5 at 3,200 = 16,000; receipt 10 at 3,350 = 33,500 → 15 at 3,300; J3 takes 1 = 3,300 → 14 = 46,200.
    assert.deepEqual([C.view().card.closing.qm, C.view().card.closing.value], [14000, 4620000]);
    assert.ok(stock.rows.length >= 4);
    C.select({ tab: 'valuation', valuationDate: DAY });
    const valuation = C.view();
    assert.equal(valuation.total, valuation.valuation.reduce((sum, row) => sum + row.value, 0), 'total = Σ rows');
    assert.equal(valuation.nrv.totals.writeDown, 120000, 'the two 9U racks: 2 × 600');
    for (const name of ['valuation', 'nrv']) assert.ok(C.exportRows(name).rows.length > 3, name);
    C.select({ tab: 'overhead' });
    assert.ok(C.exportRows('overhead').rows.length >= 2);
    assert.equal(C.exportCsv('jobs'), null, 'another tab cannot be exported from this one');
    // Excel: the vendored SheetJS, appended locally; nothing from the network.
    C.select({ tab: 'profit', dimension: 'customer' });
    const appended = [];
    const original = d.head.appendChild.bind(d.head);
    d.head.appendChild = node => { if (node.tagName === 'SCRIPT') appended.push(node); return original(node); };
    d.querySelector('#jc-root [data-jc-export="xlsx"]').click();
    assert.equal(appended.length, 1);
    assert.equal(appended[0].getAttribute('src'), './vendor/xlsx-0.18.5.full.min.js');
    w.eval(fs.readFileSync(path.join(ROOT, 'vendor/xlsx-0.18.5.full.min.js'), 'utf8'));
    const books = [];
    w.XLSX.writeFile = (wb, file) => books.push({ wb, file });
    appended[0].onload();
    assert.equal(books.length, 1);
    const back = w.XLSX.read(w.XLSX.write(books[0].wb, { type: 'array', bookType: 'xlsx' }), { type: 'array' });
    const rows = plain(w.XLSX.utils.sheet_to_json(back.Sheets[back.SheetNames[0]], { header: 1, defval: '' }));
    assert.ok(rows.some(row => row[0] === 'บจก. อีสานโลจิสติกส์ เอ็กซ์เพรส'));
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('capp#4 English: every tab and the J1 sheet in English (THB, A.D. dates), the same figures, no Thai UI text', async () => {
  const h = await seeded({ english: true }); const { w } = h; const d = w.document;
  try {
    await openCosting(w, { jobKey: jobKeyOf(w, h.plan, 'J1') });
    await settle(w, 20);
    for (const tab of ['jobs', 'profit', 'stock', 'valuation', 'overhead', 'settings']) {
      w.ERPCosting.select({ tab });
      await settle(w, 10);
      assert.deepEqual(thaiOutsideUserData(d.getElementById('jc-root')), [], `${tab}: no Thai UI text`);
      assert.doesNotMatch(text(d.getElementById('jc-root')), /฿/, `${tab}: THB`);
    }
    w.ERPCosting.select({ tab: 'jobs' });
    assert.match(text(d.getElementById('jc-sheet-title')), /Job cost sheet/);
    const sheet = sheetText(d);
    assert.match(sheet, /THB 25,000\.00 THB 29,120\.00 −THB 4,120\.00 −16\.5%/);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('capp#5 JSON backup: costing settings and job entries round-trip; a damaged costing part refuses the whole file (fail-closed)', async () => {
  let exported;
  let settings;
  let jobs;
  {
    const h = await seeded(); const { w } = h;
    try {
      const master = w.testApp.collectLocalMasterBackup();
      assert.equal(master.costing.settings.method, 'moving_average');
      assert.equal(master.costing.jobs.entries.length, 15);
      settings = w.localStorage.getItem(SETTINGS_KEY);
      jobs = w.localStorage.getItem(JOBS_KEY);
      exported = JSON.parse(JSON.stringify(await w.ERPBackup.portable({ meta: { app: 'comform-esan', backupType: 'all' }, data: {}, masterData: master })));
      assert.equal((await w.ERPBackup.verifyPortable(exported)).verified, true);
      for (const [label, damage] of [
        ['unknown field', b => { b.masterData.costing.jobs.entries[0].hacked = 1; }],
        ['negative hours', b => { b.masterData.costing.jobs.entries.find(e => e.kind === 'labour').hours = -3; }],
        ['bad method', b => { b.masterData.costing.settings.method = 'lifo'; }],
        ['not an object', b => { b.masterData.costing = [1]; }]
      ]) {
        const tampered = JSON.parse(JSON.stringify(exported));
        damage(tampered);
        assert.throws(() => w.ERPBackup.validate(tampered), /ต้นทุน/, label);
      }
      assert.deepEqual(h.errors, []);
    } finally { h.close(); }
  }
  {
    const h = await boot({ beforeScripts: pinClock(DAY) }); const { w } = h;
    try {
      assert.equal(w.localStorage.getItem(JOBS_KEY), null);
      w.ERPBackup.validate(exported);
      w.testApp.restoreLocalMasterBackup(exported.masterData, { replace: true });
      assert.deepEqual(JSON.parse(w.localStorage.getItem(JOBS_KEY)), JSON.parse(jobs));
      assert.deepEqual(JSON.parse(w.localStorage.getItem(SETTINGS_KEY)), JSON.parse(settings));
      // An older backup without the costing part leaves this device's costing alone.
      const kept = w.localStorage.getItem(JOBS_KEY);
      w.testApp.restoreLocalMasterBackup({ contacts: [] }, { replace: false });
      assert.equal(w.localStorage.getItem(JOBS_KEY), kept);
      assert.deepEqual(h.errors, []);
    } finally { h.close(); }
  }
});

test('capp#6 reset removes the costing stores; the page then says there is no job; the dashboard card disappears', async () => {
  const h = await seeded(); const { w } = h; const d = w.document;
  try {
    assert.ok(w.localStorage.getItem(SETTINGS_KEY) && w.localStorage.getItem(JOBS_KEY));
    const result = await w.ERPDemoSeed.reset({ confirm: () => true });
    assert.equal(result.status, 'reset');
    assert.equal(w.localStorage.getItem(SETTINGS_KEY), null);
    assert.equal(w.localStorage.getItem(JOBS_KEY), null);
    w.ERPCosting.invalidate();
    await openCosting(w);
    assert.equal(w.ERPCosting.dataset().jobs.length, 0);
    assert.match(text(d.getElementById('jc-root')), /ยังไม่มี/);
    w.go('dashboard', null); w.renderDash();
    await settle(w, 30);
    assert.equal(text(d.getElementById('dash-gp')), '');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('capp#7 one establishment: every job, receipt and movement at the head office; J1 / J2 unchanged, J3 at the pooled average', async () => {
  const h = await seeded({ single: true }); const { w } = h; const d = w.document;
  try {
    const data = w.ERPCosting.dataset();
    assert.ok(data.jobs.every(job => job.branch === 'ubon'));
    assert.equal(data.costing.negatives.length, 0);
    assert.equal(data.sheets.get(jobKeyOf(w, h.plan, 'J1')).total, 2912000);
    assert.equal(data.sheets.get(jobKeyOf(w, h.plan, 'J2')).total, 375000);
    assert.equal(data.sheets.get(jobKeyOf(w, h.plan, 'J3')).total, 1440500);
    await openCosting(w);
    for (const tab of ['jobs', 'profit', 'stock', 'valuation', 'overhead', 'settings']) {
      w.ERPCosting.select({ tab });
      assert.equal(d.getElementById('jc-branch') || d.getElementById('jc-stock-branch'), null, `${tab}: no branch filter with one establishment`);
      assert.doesNotMatch(text(d.getElementById('jc-root')), /สาขาที่ 00001|khonkaen/, tab);
    }
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('capp#8 closed periods: refused with the period-lock text and nothing written (entry date, reopening a job, opening costs)', async () => {
  const h = await seeded(); const { w } = h;
  try {
    const key = addOpenJob(w);
    const C = w.ERPCosting;
    // The stock / purchase side of the head office closed through 16 Oct: labour on the 16th is refused.
    w.ERPGovernance.lockPeriod({ branch: 'ubon', scope: 'purchase', throughDate: '2026-10-16', reason: 'ปิดงวดสต็อก' });
    const lockText = w.ERPGovernance.periodLockRefusal({ type: 'stock', scope: 'purchase', branch: 'ubon', date: '2026-10-16', action: 'costing' });
    assert.ok(lockText, 'the governance text');
    const snapshot = () => [w.localStorage.getItem(JOBS_KEY), w.localStorage.getItem(MOVES_KEY), w.localStorage.getItem(SETTINGS_KEY)];
    const before = snapshot();
    const labour = C.postLabour({ jobKey: key, person: 'ช่างสมศักดิ์', hours: 2, date: '2026-10-16' });
    assert.deepEqual([labour.ok, labour.message], [false, lockText]);
    // Opening costs would recompute every closed cost → refused with the text of the first closed date it touches.
    const settings = C.dataset().settings;
    const changed = C.saveSettings({ openingCosts: { ...settings.openingCosts, 'code:rm-clean': 400 } });
    assert.equal(changed.ok, false);
    assert.match(changed.message, /ปิด/);
    // The sales side of สาขา closed through August (ภ.พ.30 filed): J3's revenue is there → J3 cannot be reopened.
    w.ERPGovernance.lockPeriod({ branch: 'khonkaen', scope: 'sales', throughDate: '2026-08-31', reason: 'ยื่น ภ.พ.30 แล้ว' });
    const j3 = C.dataset().sheets.get(jobKeyOf(w, h.plan, 'J3'));
    const reopen = C.voidCostEntry({ jobKey: j3.job.key, id: j3.completion.id, reason: 'ทดสอบ' });
    assert.equal(reopen.ok, false);
    assert.equal(reopen.message, w.ERPGovernance.periodLockRefusal({ type: 'stock', scope: 'sales', branch: 'khonkaen', date: j3.completion.date <= '2026-08-31' ? h.plan.documents.find(x => x.collection === 'invoices' && x.record.no === h.plan.expected.jobs.J3.invoice).record.date : '2026-08-31', action: 'costing' }));
    assert.deepEqual(snapshot(), before, 'nothing written');
    // After the closed date it is accepted.
    assert.equal(C.postLabour({ jobKey: key, person: 'ช่างสมศักดิ์', hours: 2, date: '2026-10-17' }).ok, true);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('capp#9 the gross profit agrees with วิเคราะห์และคาดการณ์ (same sales measure) and the dashboard; job revenue = its invoice − CN', async () => {
  const h = await seeded(); const { w } = h; const d = w.document;
  try {
    w.go('analytics-forecast', null);
    await sleep(10);
    const A = w.ERPAnalytics;
    for (const [periodType, period, months] of [['month', '2026-09', ['2026-09']], ['month', '2026-08', ['2026-08']], ['quarter', '2026-Q3', ['2026-07', '2026-08', '2026-09']]]) {
      for (const branch of ['all', 'ubon', 'khonkaen']) {
        A.select({ tab: 'compare', branch, periodType, period, dimension: 'customer', search: '' });
        const view = A.view();
        const summary = w.ERPCosting.grossProfitSummary({ months, branch });
        assert.equal(summary.sales, Math.round(view.split.current.documents * 100), `${period} ${branch}`);
        assert.ok(summary.coveredSales <= summary.sales && summary.cost >= 0);
        assert.equal(summary.grossProfit, summary.coveredSales - summary.cost);
      }
    }
    A.select({ tab: 'compare', branch: 'all', periodType: 'month', period: '2026-09' });
    assert.match(text(d.getElementById('afc-root')), /กำไรขั้นต้น \(ต้นทุนจริง\): ฿20,200\.00 \(27\.9%\) จากยอดขายที่มีต้นทุน ฿72,470\.00 · มีต้นทุน 50% ของยอดขาย/);
    // Each job's revenue = the measure lines that carry it (J1: 26,500 in its month − the 1,500 credit note later).
    const data = w.ERPCosting.dataset();
    for (const key of ['J1', 'J2', 'J3', 'J4']) {
      const jobKey = jobKeyOf(w, h.plan, key);
      const lines = data.gp.byJob.get(jobKey).lines;
      assert.equal(lines.reduce((sum, line) => sum + line.valueSatang, 0), data.sheets.get(jobKey).revenue, key);
    }
    assert.equal(data.sheets.get(jobKeyOf(w, h.plan, 'J1')).revenue, 2500000);
    // The dashboard card (year 2569, the company) shows the same summary as the page computes for those months.
    w.go('dashboard', null); w.renderDash();
    await settle(w, 30);
    const year = Number(d.getElementById('dash-year').value);
    const summary = w.ERPCosting.grossProfitSummary({ months: Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`), branch: 'all' });
    const card = text(d.getElementById('dash-gp'));
    const fmt = satang => (satang / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    assert.ok(card.includes(`฿${fmt(summary.grossProfit)}`) && card.includes(`฿${fmt(summary.coveredSales)}`), card);
    assert.match(card, /มีต้นทุน \d+% ของยอดขาย/);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('capp#10 the method lock: a change needs the Revenue Department approval and an open effective date; earlier costs stay', async () => {
  const h = await seeded(); const { w } = h; const d = w.document;
  try {
    const C = w.ERPCosting;
    await openCosting(w, { tab: 'settings' });
    assert.match(text(d.getElementById('jc-root')), /65 ทวิ \(6\)/);
    const before = C.dataset().sheets.get(jobKeyOf(w, h.plan, 'J3')).total;
    const refused = C.changeMethod({ method: 'fifo' });
    assert.equal(refused.ok, false);
    assert.match(refused.message, /อนุมัติ/);
    assert.equal(C.changeMethod({ method: 'fifo', approvalRef: 'กค 0702/1234', approvalDate: '2026-10-25', effectiveFrom: '2026-10-26' }).ok, false, 'approval in the future');
    const ok = C.changeMethod({ method: 'fifo', approvalRef: 'กค 0702/1234', approvalDate: '2026-10-15', effectiveFrom: '2026-10-16', note: 'ทดสอบ' });
    assert.equal(ok.ok, true, ok.message);
    const settings = JSON.parse(w.localStorage.getItem(SETTINGS_KEY));
    assert.deepEqual(settings.methodHistory.map(row => row.method), ['moving_average', 'fifo']);
    assert.equal(settings.methodHistory[1].approvalRef, 'กค 0702/1234');
    assert.equal(C.dataset().sheets.get(jobKeyOf(w, h.plan, 'J3')).total, before, 'costs before the effective date are not recomputed');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});
