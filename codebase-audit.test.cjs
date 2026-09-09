const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');

test('codebase audit passes',()=>{
  cp.execFileSync(process.execPath,['scripts/audit-codebase.mjs'],{cwd:ROOT,stdio:'pipe'});
  const report=JSON.parse(read('CODEBASE_AUDIT_RESULTS.json'));
  assert.equal(report.status,'PASS',JSON.stringify(report.issues,null,2));
});

test('quote date has no duplicate/unexposed inline auto-number handler',()=>{
  const html=read('index.html');
  assert.match(html,/id="q-date"/);
  assert.doesNotMatch(html,/id="q-date"[^>]*refreshAutoQuoteNumber/);
});

test('navigation integrations use erp:navigation instead of replacing window.go',()=>{
  for(const file of ['erp-production-core.js','erp-order-flow.js']){
    const src=read(file);
    assert.doesNotMatch(src,/window\.go\s*=(?!=)/,file);
    assert.match(src,/erp:navigation/,file);
  }
});

test('runtime error capture has one owner',()=>{
  const files=fs.readdirSync(ROOT).filter(f=>f.endsWith('.js'));
  const owners=files.filter(f=>/window\.addEventListener\(\s*['"]error['"]/.test(read(f)));
  assert.deepEqual(owners,['boot-status.js']);
});

test('workflow handoff state is namespaced',()=>{
  for(const file of ['app.js','erp-production-core.js','erp-order-flow.js']){
    assert.doesNotMatch(read(file),/ERPPrepared(?:SalesOrder|ProductionOrder)Id/,file);
  }
  assert.match(read('app.js'),/ERPWorkflowContext/);
});

test('shared storage contracts stay aligned across modules',()=>{
  const contracts=read('erp-storage-contracts.js');
  for(const name of ['ORDER_FLOW_STORE_KEY','ORDER_FLOW_PREFERENCES_KEY','BUSINESS_RULES_KEY','CONTACT_MASTER_KEY','PRODUCT_MASTER_KEY','ACTIVE_TENANT_SESSION_KEY'])assert.match(contracts,new RegExp(`export const ${name}\\s*=`),name);
  for(const file of ['erp-order-flow.js','erp-integrity.js','business-rules.js','tenant-context.js','local-demo-mode.js'])assert.match(read(file),/erp-storage-contracts\.js/,file);
  assert.doesNotMatch(read('erp-order-flow.js'),/['"]example_erp_order_flow_v3['"]/);
  assert.doesNotMatch(read('erp-integrity.js'),/['"]example_erp_order_flow_v3['"]/);
});
