import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {releaseMeta} from './release-meta.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const META=releaseMeta(ROOT);
const files=fs.readdirSync(path.join(ROOT,'tests')).filter(name=>name.endsWith('.test.cjs')).sort().map(name=>`tests/${name}`);
const run=spawnSync(process.execPath,['--test',...files],{cwd:ROOT,encoding:'utf8',maxBuffer:30*1024*1024});
const output=(run.stdout||'')+(run.stderr?`\n${run.stderr}`:'');
const num=key=>Number(new RegExp(`# ${key} (\\d+)`).exec(output)?.[1]||0);
let classification='pass';
if(run.status!==0){
  if(/Cannot find module ['"](?:jsdom|fake-indexeddb)['"]|ERR_MODULE_NOT_FOUND[^\n]*(?:jsdom|fake-indexeddb)/i.test(output))classification='environment_dependency';
  else if(/Cannot use import statement outside a module/i.test(output))classification='test_harness_module_failure';
  else if(/SyntaxError|ReferenceError|TypeError/i.test(output))classification='application_or_test_infrastructure_bug';
  else if(/AssertionError|not ok/i.test(output))classification='behavior_mismatch_requires_review';
  else classification='unknown_failure';
}
const slug=String(META.release).replace(/\./g,'_');
const dir=path.join(ROOT,'evidence');fs.mkdirSync(dir,{recursive:true});
const tap=`FULL_TESTS_${slug}.tap`,json=`FULL_TEST_EVIDENCE_${slug}.json`;
fs.writeFileSync(path.join(dir,tap),output);
const evidence={release:META.release,packageVersion:META.packageVersion,executedAt:new Date().toISOString(),scope:'full-node-suite',files,exitCode:run.status??1,tests:num('tests'),pass:num('pass'),fail:num('fail'),cancelled:num('cancelled'),skipped:num('skipped'),classification,log:`evidence/${tap}`};
fs.writeFileSync(path.join(dir,json),JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence,null,2));
process.exitCode=0; // Evidence capture itself succeeds; release gate still uses npm test and will fail on nonzero suite status.
