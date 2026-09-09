import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {releaseMeta} from './release-meta.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const META=releaseMeta(ROOT);
const files=['tests/integrity.test.cjs','tests/decision-council.test.cjs','tests/executive-charts.test.cjs','tests/product-experience.test.cjs','tests/refactor-4-1.test.cjs','tests/codebase-audit.test.cjs','tests/agent-security.test.cjs','tests/spec-governance.test.cjs'];
const run=spawnSync(process.execPath,['--test',...files],{cwd:ROOT,encoding:'utf8',maxBuffer:20*1024*1024});
const output=(run.stdout||'')+(run.stderr?`\n${run.stderr}`:'');
const num=key=>Number(new RegExp(`# ${key} (\\d+)`).exec(output)?.[1]||0);
let classification='pass';
if(run.status!==0){
  if(/ERR_MODULE_NOT_FOUND|Cannot find module|jsdom|fake-indexeddb/i.test(output))classification='environment_dependency';
  else if(/SyntaxError|ReferenceError|TypeError/i.test(output))classification='application_or_test_infrastructure_bug';
  else if(/AssertionError|not ok/i.test(output))classification='behavior_mismatch_requires_review';
  else classification='unknown_failure';
}
const dir=path.join(ROOT,'evidence');fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'CORE_TESTS_4_2.tap'),output);
const evidence={release:META.release,packageVersion:META.packageVersion,executedAt:new Date().toISOString(),command:`node --test ${files.join(' ')}`,exitCode:run.status??1,tests:num('tests'),pass:num('pass'),fail:num('fail'),cancelled:num('cancelled'),skipped:num('skipped'),classification,log:'evidence/CORE_TESTS_4_2.tap'};
fs.writeFileSync(path.join(dir,'CORE_TEST_EVIDENCE_4_2.json'),JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence,null,2));
process.exitCode=run.status??1;
