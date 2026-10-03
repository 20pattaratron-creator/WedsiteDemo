// Test runner for the two suites (see docs/TESTING_TH.md).
//
//   node scripts/run-tests.mjs          → FULL suite: every tests/*.test.cjs (npm test)
//   node scripts/run-tests.mjs --fast   → FAST suite: only files that do NOT boot the whole app (npm run test:fast)
//   node scripts/run-tests.mjs --list   → print which file belongs to which suite, run nothing
//
// A test file is "app-boot" (FULL suite only) when it loads the jsdom harness
// (require('./dom-helper.cjs')) or carries the marker comment `// test-suite: full`
// (use it for any other slow file). Everything else is in the FAST suite too, so a new
// pure-logic test file is picked up automatically — nothing to register.
// The FULL suite always runs every file (fast + app-boot); no test is skipped or duplicated.
//
// Files run in separate processes (node:test default), TEST_CONCURRENCY processes at a
// time (default: number of CPUs — do not go above it, see docs/TESTING_TH.md). Extra arguments are passed to `node --test`,
// e.g. `npm test -- --test-reporter=spec`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const TEST_DIR=path.join(ROOT,'tests');
const APP_BOOT_RE=/require\(\s*['"]\.\/dom-helper(?:\.cjs)?['"]\s*\)/;
const FULL_MARKER_RE=/^\s*\/\/\s*test-suite:\s*full\s*$/m;
const FAST_BUDGET_SECONDS=120;

export function classifyTestFiles(dir=TEST_DIR){
  return fs.readdirSync(dir).filter(name=>name.endsWith('.test.cjs')).sort().map(name=>{
    const source=fs.readFileSync(path.join(dir,name),'utf8');
    const appBoot=APP_BOOT_RE.test(source)||FULL_MARKER_RE.test(source);
    return {file:`tests/${name}`,suite:appBoot?'full':'fast'};
  });
}

function main(argv){
  const fast=argv.includes('--fast'),list=argv.includes('--list');
  const passThrough=argv.filter(arg=>arg!=='--fast'&&arg!=='--list');
  const all=classifyTestFiles();
  if(list){
    for(const {file,suite} of all)console.log(`${suite==='fast'?'fast+full':'full only'}  ${file}`);
    console.log(`\n${all.filter(f=>f.suite==='fast').length} fast files, ${all.filter(f=>f.suite==='full').length} app-boot files, ${all.length} total`);
    return 0;
  }
  const files=(fast?all.filter(f=>f.suite==='fast'):all).map(f=>f.file);
  if(!files.length){console.error('[run-tests] no test files found');return 1;}
  const requested=Number.parseInt(process.env.TEST_CONCURRENCY||'',10);
  const concurrency=Number.isInteger(requested)&&requested>0?requested:Math.max(1,os.availableParallelism?.()??os.cpus().length);
  const args=['--test',`--test-concurrency=${concurrency}`,...passThrough,...files];
  console.error(`[run-tests] ${fast?'FAST':'FULL'} suite: ${files.length} files, concurrency ${concurrency}`);
  const started=Date.now();
  const run=spawnSync(process.execPath,args,{cwd:ROOT,stdio:'inherit'});
  const seconds=(Date.now()-started)/1000;
  if(run.error){console.error('[run-tests] could not start node --test:',run.error.message);return 1;}
  console.error(`[run-tests] ${fast?'FAST':'FULL'} suite finished in ${seconds.toFixed(1)} s (exit ${run.status??run.signal})`);
  if(fast&&seconds>FAST_BUDGET_SECONDS)console.error(`[run-tests] WARNING: the fast suite took longer than ${FAST_BUDGET_SECONDS} s. Move slow files to the full suite (add \`// test-suite: full\`) — see docs/TESTING_TH.md.`);
  return run.status??1;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=main(process.argv.slice(2));
