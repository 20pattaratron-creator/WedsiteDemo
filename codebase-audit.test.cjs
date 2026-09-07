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
  const flow=read('erp-order-flow.js');
  const integrity=read('erp-integrity.js');
  const app=read('app.js');
  const rules=read('business-rules.js');
  const flowKey=/STORE_BASE_KEY\s*=\s*['"]([^'"]+)/.exec(flow)?.[1];
  const integrityKey=/FLOW_KEY\s*=\s*['"]([^'"]+)/.exec(integrity)?.[1];
  assert.equal(flowKey,integrityKey,'Order Flow/Integrity storage key drift');
  const appContact=/CONTACT_MASTER_KEY\s*=\s*['"]([^'"]+)/.exec(app)?.[1];
  const rulesContact=/CONTACT_KEY\s*=\s*['"]([^'"]+)/.exec(rules)?.[1];
  const appProduct=/PRODUCT_MASTER_LOCAL_KEY\s*=\s*['"]([^'"]+)/.exec(app)?.[1];
  const rulesProduct=/PRODUCT_KEY\s*=\s*['"]([^'"]+)/.exec(rules)?.[1];
  assert.equal(appContact,rulesContact,'Customer/Supplier master storage key drift');
  assert.equal(appProduct,rulesProduct,'Product master storage key drift');
});
