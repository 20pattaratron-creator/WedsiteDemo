const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');

test('deployment test reads current ERP release instead of stale hard-coded release',()=>{
  const s=read('tests/deployment.check.cjs');
  assert.match(s,/package\.json/);
  assert.match(s,/const release=/);
  assert.ok(!s.includes('/3\\.4\\.0/'));
});

test('customer-trial closure validates syntax audits security hashes http and zip integrity',()=>{
  const s=read('scripts/validate-customer-trial.mjs');
  for(const token of ['syntaxCheck','audit-codebase.mjs','audit-deep.mjs','audit-specs.mjs','audit-complexity.mjs','audit-document-controllers.mjs','audit-financial-controls.mjs','audit-document-render-golden.mjs','verify-security-baseline.mjs','RUNTIME_MANIFEST_','sourcePagesMatch','httpSmoke','unzip'])assert.ok(s.includes(token),token);
});

test('trial validation script is exposed through npm scripts',()=>{
  const p=JSON.parse(read('package.json'));
  assert.equal(p.scripts['validate:trial'],'node scripts/validate-customer-trial.mjs');
});
