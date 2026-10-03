const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');

test('spec audit passes and all requirements are traceable',()=>{
  const out=execFileSync(process.execPath,['scripts/audit-specs.mjs'],{cwd:ROOT,encoding:'utf8'});
  assert.match(out,/Spec Audit .*: PASS/);
  const result=JSON.parse(read('SPEC_AUDIT_RESULTS.json'));
  assert.equal(result.status,'PASS');
  assert.equal(result.requirementCount,result.traceabilityCount);
  assert.ok(result.requirementCount>=20);
});

test('release metadata is centralized',()=>{
  const pkg=JSON.parse(read('package.json'));
  assert.match(pkg.erpRelease,/^4\.\d+\.\d+$/);
  for(const file of ['scripts/audit-codebase.mjs','scripts/audit-deep.mjs','scripts/build-deployment-check.mjs','scripts/build-flat-pages.mjs']){
    const src=read(file);
    assert.match(src,/releaseMeta/);
    assert.doesNotMatch(src,/version:'4\.[0-9]+\.[0-9]+'/);
  }
});

test('development context points to current sources of truth',()=>{
  const pkg=JSON.parse(read('package.json'));
  const ctx=JSON.parse(read('DEVELOPMENT_CONTEXT.json'));
  assert.equal(ctx.release,pkg.erpRelease);
  assert.equal(ctx.packageVersion,pkg.version);
  for(const file of Object.values(ctx.sourceOfTruth))assert.ok(fs.existsSync(path.join(ROOT,file)),file);
});
