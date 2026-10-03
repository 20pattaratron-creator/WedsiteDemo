const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');

test('4.3.1 release metadata and lockfile are aligned',()=>{
  const p=JSON.parse(read('package.json'));
  const lock=JSON.parse(read('package-lock.json'));
  assert.equal(p.erpRelease,'4.3.1');
  assert.equal(p.version,'2.3.1');
  assert.equal(lock.version,p.version);
  assert.equal(lock.packages[''].version,p.version);
  assert.match(read('index.html'),/4\.3\.1-source/);
});

test('issued documents are locked against destructive delete',()=>{
  const s=read('app.js');
  assert.match(s,/type==='issuedInvoices'\|\|type==='issuedReceipts'/);
  assert.doesNotMatch(s,/issuedInvoices'[^\n]{0,220}>ลบ<\/button>/);
  assert.doesNotMatch(s,/issuedReceipts'[^\n]{0,220}>ลบ<\/button>/);
});

test('issued document detail uses open modal lifecycle',()=>{
  const s=read('app.js');const i=s.indexOf('function showIssuedDocumentDetail');const part=s.slice(i,i+1800);
  assert.match(part,/classList\.add\('open'\)/);
  assert.doesNotMatch(part,/classList\.add\('show'\)/);
});

test('attachment URL guard blocks javascript and html data URLs',async()=>{
  const src=read('erp-detail-security.js').replace(/export /g,'');
  assert.match(src,/https:/);assert.match(src,/blob:/);assert.doesNotMatch(src,/javascript:/);
});

test('data-driven order and production ids are not interpolated into known risky inline onclick paths',()=>{
  const a=read('erp-order-flow.js'),b=read('erp-production-core.js');
  assert.doesNotMatch(a,/onclick="ERPOrderFlow\.[^"]*\$\{[^}]*\.id/);
  assert.doesNotMatch(b,/onclick="pc(?:UsePoForReceipt|CancelPo|ReverseGr|RestoreTrash)\('\$\{/);
  assert.match(a,/data-order-action=/);assert.match(b,/data-prodcore-action=/);
});

test('master actions archive rather than hard-delete',()=>{
  const app=read('app.js'),core=read('erp-master-data-core.js');
  assert.match(app,/function archiveContactMaster/);
  assert.match(app,/function archiveProductMasterLocal/);
  assert.match(app,/archiveContactRows\(/);
  assert.match(app,/archiveProductRows\(/);
  assert.match(core,/export function archiveContactRows/);
  assert.match(core,/export function archiveProductRows/);
  assert.match(core,/\.active\s*=\s*false/);
  assert.doesNotMatch(app,/splice\([^)]*master/i);
});

test('same-browser document save lease wraps quote invoice receipt and production',()=>{
  const s=read('app.js');for(const n of ['quote','production'])assert.match(s,new RegExp(`withDemoWriteLease\\('${n}'`));
  // fix4#5: invoice, receipt and credit-note writes share the one sales-ledger lease (they change the same invoice balance).
  for(const n of ['saveInvoice','saveReceipt'])assert.match(s,new RegExp(`async function ${n}\\(\\)\\{try\\{return await withDemoWriteLease\\(SALES_LEDGER_WRITE_LEASE,`));
  assert.match(read('erp-demo-concurrency.js'),/export const SALES_LEDGER_WRITE_LEASE='sales-ledger'/);
});

test('trial banner states multi-user production limitation',()=>assert.match(read('index.html'),/ยังไม่ใช่ระบบ Production หลายผู้ใช้/));

test('quote preview VAT uses shared deterministic calculator instead of raw VAT arithmetic',()=>{
  const s=read('app.js');
  const start=s.indexOf('function previewQuoteDocumentFromForm');
  const part=s.slice(start,start+1800);
  assert.match(part,/calculateVatSummary\(subtotal,useVat\?1:2\)/);
  assert.doesNotMatch(part,/(?:0?\.07|1\.07|100\s*\/\s*107)/);
});

test('critical receipt duplicate verification fails closed when history cannot be parsed',()=>{
  const s=read('receipt-document.js');
  assert.match(s,/function verifyReceiptSourceInvoice/);
  assert.match(s,/ไม่สามารถตรวจสอบประวัติใบเสร็จได้ครบ/);
  assert.match(s,/if \(verification\.error\) return verification\.error/);
});

test('master seed aborts instead of replacing corrupted master data with an empty list',()=>{
  const s=read('business-rules.js');
  assert.match(s,/function seedMasterData/);
  assert.match(s,/createMasterDataStore\(/);
  assert.match(s,/businessMasterStore\.readSnapshot\(\)/);
  assert.match(s,/businessMasterStore\.writeSnapshot\(next\)/);
  assert.doesNotMatch(s,/catch\(_\)\{rows=\[\]\}/);
  assert.doesNotMatch(s,/FirebaseService\?\.saveMasterSnapshot/);
});

test('core test runner and evidence runner share one canonical test-file list',()=>{
  const pkg=JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['test:core'],'node scripts/run-core-tests.mjs');
  assert.equal(pkg.scripts['evidence:core'],'node scripts/run-core-evidence.mjs');
  assert.match(read('scripts/run-core-tests.mjs'),/CORE_TEST_FILES/);
  assert.match(read('scripts/run-core-evidence.mjs'),/CORE_TEST_FILES/);
});

test('deep auditor covers shorthand VAT, dead branches and empty catches',()=>{
  const s=read('scripts/audit-deep.mjs');
  assert.match(s,/\\\.07\\b/);
  assert.match(s,/PERMANENTLY_DISABLED_BRANCH/);
  assert.match(s,/EMPTY_CATCH/);
  assert.match(s,/EMPTY_PROMISE_CATCH/);
  assert.match(s,/ISSUED_DOCUMENT_DIRECT_STORAGE_WRITE/);
  assert.match(s,/ISSUED_DOCUMENT_ACTION_RUNNER_BYPASS/);
  assert.match(s,/ISSUED_DOCUMENT_TRANSACTION_BYPASS/);
  assert.match(s,/PRINT_LAYER_SETTLEMENT_MUTATION/);
  assert.match(s,/PRINT_LAYER_WORKFLOW_MUTATION/);
});
