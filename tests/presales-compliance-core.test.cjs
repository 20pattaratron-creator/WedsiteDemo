// ADR-021 (round 8, stage 1) — pure rules, no app boot:
//   r8a#1 buyer establishment helpers (ประกาศอธิบดีฯ VAT ฉบับที่ 199) + seeded invoices carry it
//   r8a#2 cancel (void) rules: reason required, blockers, kept record, released source links
//   r8a#3 sample-data sales / delivery targets near the seeded actuals; reset strips only seeded ones
//   r8a#4 SheetJS ships in vendor/ (no runtime CDN reference left)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const imp = file => import(pathToFileURL(path.join(ROOT, file)).href + '?t=' + Date.now() + Math.random());
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('r8a#1 buyer establishment: labels, form input parsing, Customer Master mapping', async () => {
  const c = await imp('erp-shared-core.js');
  assert.equal(c.buyerBranchLabel('00000'), 'สำนักงานใหญ่');
  assert.equal(c.buyerBranchLabel('00003'), 'สาขาที่ 00003');
  for (const bad of ['', '3', '0003', '000003', 'abcde', null, undefined]) assert.equal(c.buyerBranchLabel(bad), '', String(bad));
  assert.deepEqual(c.parseBuyerBranchInput('', ''), { ok: true, code: '' });
  assert.deepEqual(c.parseBuyerBranchInput('hq', '12345'), { ok: true, code: '00000' });
  assert.deepEqual(c.parseBuyerBranchInput('branch', '00003'), { ok: true, code: '00003' });
  for (const bad of ['', '3', '1234', '123456', '00000', '12a45']) assert.equal(c.parseBuyerBranchInput('branch', bad).ok, false, bad);
  assert.match(c.parseBuyerBranchInput('branch', '12').error, /5 หลัก/);
  // Master rows: only with a tax ID; short numeric codes padded; head-office name without code → 00000.
  assert.deepEqual(c.buyerBranchFromContact({ taxId: '0107537008786', branchCode: '00003', branchName: 'โรงงานขอนแก่น' }), { code: '00003', name: 'โรงงานขอนแก่น' });
  assert.deepEqual(c.buyerBranchFromContact({ taxId: '0107537008786', branchCode: '3' }), { code: '00003', name: '' });
  assert.deepEqual(c.buyerBranchFromContact({ taxId: '0107537008786', branchCode: '', branchName: 'สำนักงานใหญ่' }), { code: '00000', name: '' });
  assert.deepEqual(c.buyerBranchFromContact({ taxId: '', branchCode: '00003' }), { code: '', name: '' });
  assert.deepEqual(c.buyerBranchFromContact({ taxId: '1', branchCode: 'สาขา' }), { code: '', name: '' });
});

test('r8a#1 seeded invoices carry the buyer establishment from Customer Master; walk-in / abbreviated do not', async () => {
  const seed = await imp('erp-demo-seed-core.js');
  const plan = seed.buildDemoSeedPlan({ today: '2026-10-04' });
  const invoices = plan.documents.filter(d => d.collection === 'invoices').map(d => d.record);
  const branchBuyer = invoices.find(i => i.customer === 'บมจ. แก่นนคร ฟู้ดส์');
  assert.deepEqual([branchBuyer.customerBranchCode, branchBuyer.customerBranchName], ['00003', 'โรงงานขอนแก่น']);
  for (const inv of invoices) {
    if (inv.taxInvoiceForm === 'abbreviated') assert.equal(inv.customerBranchCode, '', inv.no);
    else assert.match(inv.customerBranchCode, /^\d{5}$/, inv.no);
  }
  const receipts = plan.documents.filter(d => d.collection === 'receipts').map(d => d.record);
  for (const r of receipts) assert.equal(r.customerBranchCode, invoices.find(i => i.no === r.invNo).customerBranchCode, r.no);
});

test('r8a#2 cancel rules: a reason is required, blockers name the documents, the record is kept (never removed)', async () => {
  const core = await imp('erp-document-cancel-core.js');
  const shared = await imp('erp-shared-core.js');
  assert.equal(core.cancelReasonText('invoices', '', '').ok, false);
  assert.equal(core.cancelReasonText('invoices', 'other', '').ok, false, '"อื่น ๆ" needs a detail');
  assert.equal(core.cancelReasonText('invoices', 'bogus', 'x').ok, false);
  assert.equal(core.cancelReasonText('quotes', 'duplicate', '').ok, false, 'only invoices / receipts');
  const ok = core.cancelReasonText('invoices', 'wrong_details', '  เลขผู้เสียภาษี\u202eผิด  ');
  assert.equal(ok.ok, true);
  assert.match(ok.reason, /^ออกผิด: .* — เลขผู้เสียภาษี ผิด$/);
  assert.deepEqual(core.cancelBlockers('invoices', {}), []);
  const blockers = core.cancelBlockers('invoices', { receipts: [{ no: 'REC1' }], payments: [{ no: 'PAY-1' }], creditNotes: [{ no: 'CN1' }], billingNotes: [{ no: 'BL-1' }] });
  assert.equal(blockers.length, 4);
  assert.match(blockers.join('\n'), /REC1[\s\S]*PAY-1[\s\S]*CN1[\s\S]*BL-1/);
  const record = { id: 7, no: 'INV690901', total: 100 };
  const kept = core.applyDocumentCancel(record, { at: '2026-10-04T03:00:00.000Z', by: 'admin@example', reason: 'ออกซ้ำกับฉบับอื่น', code: 'duplicate' });
  assert.deepEqual(record, { id: 7, no: 'INV690901', total: 100 }, 'input untouched');
  assert.equal(kept.no, 'INV690901'); assert.equal(kept.total, 100);
  assert.deepEqual([kept.voided, kept.status, kept.voidedAt, kept.voidedBy, kept.voidReason, kept.voidReasonCode], [true, 'cancelled', '2026-10-04T03:00:00.000Z', 'admin@example', 'ออกซ้ำกับฉบับอื่น', 'duplicate']);
  assert.equal(shared.isDocumentCancelled(kept), true);
  assert.throws(() => core.applyDocumentCancel(kept, {}), /ถูกยกเลิกไปแล้ว/);
  const quote = { no: 'QT1', invoiceId: 7, invoiceNo: 'INV690901', invoiceStatus: 'created' };
  assert.equal(core.releaseInvoiceLink(quote, record), true);
  assert.deepEqual([quote.invoiceId, quote.invoiceNo, quote.invoiceStatus, quote.cancelledInvoiceNos], ['', '', 'cancelled', ['INV690901']]);
  assert.equal(core.releaseInvoiceLink({ invoiceNo: 'OTHER' }, record), false);
  // Stamp: escaped reason, the CANCELLED words, inline styles only.
  const stamp = shared.documentCancelStampHtml({ reason: '<b>x</b>', at: '2026-10-04T03:00:00Z', by: 'a' });
  assert.match(stamp, /ยกเลิก \/ CANCELLED/);
  assert.match(stamp, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.doesNotMatch(stamp, /<b>x/);
});

test('r8a#2 the finance planners refuse to edit a cancelled invoice / receipt', async () => {
  const f = await imp('erp-document-finance-core.js');
  const inv = { id: 1, no: 'INV1', date: '2026-10-01', customer: 'บจก. ก', branch: 'ubon', items: [{ product: 'x', qty: 1, priceUnit: 1, saleTotal: 1 }], taxInvoiceForm: 'full', vatMode: 'add', useVat: 1, total: 1.07 };
  assert.throws(() => f.planInvoiceDocumentAction({ draft: inv, original: { ...inv, voided: true, status: 'cancelled' } }), /ถูกยกเลิกแล้ว/);
  assert.doesNotThrow(() => f.planInvoiceDocumentAction({ draft: inv, original: inv }));
});

test('r8a#3 sample targets: near the seeded actuals (some months beat, some miss), current + later months typical, reset keeps typed targets', async () => {
  const seed = await imp('erp-demo-seed-core.js');
  const plan = seed.buildDemoSeedPlan({ today: '2026-10-04' });
  const targets = seed.buildDemoSeedTargets(plan);
  const all = Object.fromEntries(Object.entries(targets.sales).filter(([key]) => key.startsWith('all:')));
  // Actual sales per month (invoice value before VAT − live credit notes), as the dashboard counts them.
  const actual = {};
  for (const { collection, year, month, record } of plan.documents) {
    const key = `all:${year}-${String(month + 1).padStart(2, '0')}`;
    if (collection === 'invoices') actual[key] = (actual[key] || 0) + record.subtotal;
    if (collection === 'creditNotes' && !record.voided) actual[key] = (actual[key] || 0) - record.subtotal;
  }
  const closed = Object.keys(all).filter(key => key < 'all:2026-10');
  assert.ok(closed.length >= 3, JSON.stringify(all));
  const hits = closed.filter(key => actual[key] >= all[key]).length;
  assert.ok(hits > 0 && hits < closed.length, `some months beat and some miss: ${hits}/${closed.length}`);
  for (const key of closed) assert.ok(Math.abs(all[key] - actual[key]) / actual[key] < 0.25, `${key}: target ${all[key]} near actual ${actual[key]}`);
  assert.equal(all['all:2026-01'], undefined, 'no target before the sample history');
  assert.ok(all['all:2026-10'] > 100000 && all['all:2026-10'] === all['all:2026-12'], 'current and later months carry a typical target');
  assert.ok(Object.keys(targets.delivery).length && Object.keys(targets.sales).some(k => k.startsWith('khonkaen:')));
  // Deterministic.
  assert.deepEqual(seed.buildDemoSeedTargets(seed.buildDemoSeedPlan({ today: '2026-10-04' })), targets);
  // Merge never overwrites the user's months; strip removes only untouched seeded values.
  const user = { sales: { 'all:2026-10': 500000, 'all:2025-01': 1 }, delivery: {} };
  const { maps, written } = seed.mergeSeededTargets(user, targets);
  assert.equal(maps.sales['all:2026-10'], 500000);
  assert.equal(written.sales['all:2026-10'], undefined);
  maps.sales['all:2026-11'] = 999999; // the user changed a seeded month
  const stripped = seed.stripSeededTargets(maps, written);
  assert.deepEqual(stripped.sales, { 'all:2026-10': 500000, 'all:2025-01': 1, 'all:2026-11': 999999 });
  assert.deepEqual(stripped.delivery, {});
});

test('r8a#3 empty store: no built-in 2,000,000 / 1,600,000 target any more', () => {
  const app = read('app.js'), html = read('index.html');
  assert.match(app, /const DEFAULT_COMPANY_MONTHLY_SALES_TARGET=0;/);
  assert.match(app, /const DEFAULT_COMPANY_MONTHLY_TARGET=0;/);
  assert.doesNotMatch(html, /value="2000000"|value="1600000"/);
});

test('r8a#4 Excel export: SheetJS 0.18.5 from vendor/ (Apache-2.0), no runtime CDN / https reference left', () => {
  const manifest = JSON.parse(read('vendor/vendor-manifest.json'));
  const xlsx = manifest.libraries.find(lib => lib.name === 'xlsx');
  assert.deepEqual([xlsx.version, xlsx.license, xlsx.loading, xlsx.file], ['0.18.5', 'Apache-2.0', 'lazy', 'xlsx-0.18.5.full.min.js']);
  assert.match(read('index.html'), /<meta name="erp-vendor-xlsx" content="\.\/vendor\/xlsx-0\.18\.5\.full\.min\.js">/);
  const runtime = fs.readdirSync(ROOT).filter(f => /\.(?:js|html|css)$/.test(f) && f !== 'deployment-check.html');
  const external = runtime.flatMap(f => (read(f).match(/https?:\/\/[^\s'"`)<]+/g) || []).filter(u => !/^http:\/\/www\.w3\.org\//.test(u)).map(u => `${f}: ${u}`));
  assert.deepEqual(external, [], 'no runtime http(s) reference');
  assert.doesNotMatch(read('app.js'), /cdnjs|jsdelivr|unpkg/);
});
