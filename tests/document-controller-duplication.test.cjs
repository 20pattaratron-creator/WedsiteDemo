const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');

test('document-controller duplication audit passes the frozen Step 3C-1 ceiling',()=>{
  const run=spawnSync(process.execPath,['scripts/audit-document-controllers.mjs'],{cwd:ROOT,encoding:'utf8'});
  assert.equal(run.status,0,`${run.stdout}\n${run.stderr}`);
  const report=JSON.parse(read('DOCUMENT_CONTROLLER_DUPLICATION_AUDIT_RESULTS.json'));
  assert.equal(report.status,'PASS');
  assert.ok(report.metrics.normalizedDuplicate10LineGroups<=report.budget.maxNormalizedDuplicate10LineGroups);
  assert.ok(report.metrics.exactSameNameFunctionPairs<=report.budget.maxExactSameNameFunctionPairs);
  assert.equal(report.metrics.crossControllerImports,0);
});

test('Step 3C-1 retains shared pagination while hardening issued-document persistence',()=>{
  const report=JSON.parse(read('DOCUMENT_CONTROLLER_DUPLICATION_AUDIT_RESULTS.json'));
  const extracted=new Set(report.boundaryPlan.extractedPureHelpers.map(row=>row.name));
  const remaining=new Set(report.boundaryPlan.safePureCandidates.map(row=>row.name));
  const separate=new Set(report.boundaryPlan.keepSeparate.map(row=>row.name));
  for(const name of ['escapeHtml','parseMoney','fmt','formatDate','thaiIntegerText','bahtText','safeFilename','getNestedValue','setNestedValue','resolveStoragePeriod','createDocumentLineItem','estimateDocumentItemRowUnits','calculateDocumentTotals'])assert.ok(extracted.has(name),name);
  assert.equal(remaining.size,0,'Step 3C-1 should leave no unaudited safe-pure candidate from the current set');
  const contextual=new Set(report.boundaryPlan.contextualCandidates.map(row=>row.name));
  for(const name of ['documentPagesHtml','waitForPdfStageAssets']) assert.ok(contextual.has(name),name);
  assert.ok(!contextual.has('printableItems'),'printableItems should have moved to shared core');
  assert.ok(!contextual.has('paginateItems'),'paginateItems should have moved to shared core');
  assert.ok(!contextual.has('totals'),'totals should have moved to the shared core');
  const coreList=read('scripts/core-test-files.mjs');
  assert.match(coreList,/tests\/page-partition-regression\.test\.cjs/,'page-partition harness must run in the canonical core suite');
  for(const name of ['documentPageHtml','validateBeforeSave','saveDocumentToSystem'])assert.ok(separate.has(name),name);
  for(const file of ['delivery-tax-document.js','receipt-document.js']){
    const src=read(file);
    const start=src.indexOf('async function saveDocumentToSystem');
    assert.ok(start>=0,`${file}: missing saveDocumentToSystem`);
    const end=src.indexOf('\nfunction ',start+1);
    const body=src.slice(start,end>start?end:src.length);
    assert.match(body,/runDocumentAction/);
    assert.match(body,/ComformDocumentWriteStore/);
    assert.match(body,/writeSession\.commit\(\)/);
    assert.doesNotMatch(body,/localStorage\.setItem\(/);
    if(file==='receipt-document.js')assert.doesNotMatch(body,/markInvoicePaidByReceipt/);
  }
});

test('trial release gate includes the document-controller duplication audit',()=>{
  const pkg=JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['audit:documents'],'node scripts/audit-document-controllers.mjs');
  assert.match(pkg.scripts['quality:core'],/audit:documents/);
  assert.match(read('scripts/validate-customer-trial.mjs'),/audit-document-controllers\.mjs/);
});
