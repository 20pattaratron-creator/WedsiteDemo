import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {releaseMeta} from './release-meta.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const META=releaseMeta(ROOT);
const args=process.argv.slice(2);
const value=(name,def='')=>{const i=args.indexOf(name);return i>=0?args[i+1]:def;};
const pagesDir=path.resolve(value('--pages-dir',path.join(ROOT,'dist-flat')));
const sourceZip=value('--source-zip','');
const pagesZip=value('--pages-zip','');
const slug=META.release.replace(/\./g,'_');
const evidenceDir=path.join(ROOT,'evidence','release');
fs.mkdirSync(evidenceDir,{recursive:true});

function sha(file){return createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function run(label,cmd,cmdArgs,{allowFailure=false}={}){
  const out=spawnSync(cmd,cmdArgs,{cwd:ROOT,encoding:'utf8',maxBuffer:30*1024*1024});
  const stdout=(out.stdout||'')+(out.stderr?`\n${out.stderr}`:'');
  return {label,command:[cmd,...cmdArgs].join(' '),exitCode:out.status??1,pass:out.status===0||allowFailure,outputTail:stdout.trim().split(/\r?\n/).slice(-20)};
}
function listCodeFiles(dir){
  const out=[];
  function walk(cur){for(const e of fs.readdirSync(cur,{withFileTypes:true})){
    if(['node_modules','dist','dist-flat','.git'].includes(e.name))continue;
    const full=path.join(cur,e.name);if(e.isDirectory())walk(full);else if(/\.(?:js|mjs|cjs)$/.test(e.name))out.push(full);
  }}walk(dir);return out.sort();
}
function syntaxCheck(){
  const files=listCodeFiles(ROOT);const failures=[];
  for(const file of files){const r=spawnSync(process.execPath,['--check',file],{cwd:ROOT,encoding:'utf8'});if(r.status!==0)failures.push({file:path.relative(ROOT,file),message:(r.stderr||r.stdout||'').trim()});}
  return {checked:files.length,failures,pass:failures.length===0};
}
function htmlRefs(){
  const html=fs.readFileSync(path.join(pagesDir,'index.html'),'utf8');
  const refs=new Set();
  for(const m of html.matchAll(/<(?:script|img)\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi))refs.add(m[1]);
  for(const m of html.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi))refs.add(m[1]);
  return [...refs].filter(r=>r&&!/^(?:https?:|data:|#|mailto:|tel:)/i.test(r)).map(r=>decodeURIComponent(r.split(/[?#]/)[0]).replace(/^\.\//,''));
}
function manifestCheck(){
  const manifestFile=path.join(pagesDir,`RUNTIME_MANIFEST_${slug}.json`);
  if(!fs.existsSync(manifestFile))return {pass:false,error:`missing ${path.basename(manifestFile)}`};
  const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
  const rows=[];
  for(const item of manifest){
    const pageFile=path.join(pagesDir,item.file),sourceFile=path.join(ROOT,item.file);
    const pageExists=fs.existsSync(pageFile),sourceExists=fs.existsSync(sourceFile);
    const pageSha=pageExists?sha(pageFile):null,sourceSha=sourceExists?sha(sourceFile):null;
    rows.push({file:item.file,pageExists,sourceExists,manifestMatch:pageSha===item.sha256,sourcePagesMatch:pageSha===sourceSha,pageSha,sourceSha,manifestSha:item.sha256});
  }
  const refs=htmlRefs().map(file=>({file,exists:fs.existsSync(path.join(pagesDir,file))}));
  return {manifestFile:path.basename(manifestFile),runtimeFiles:rows.length,hashMismatch:rows.filter(r=>!r.manifestMatch||!r.sourcePagesMatch).length,missingHtmlRefs:refs.filter(r=>!r.exists),rows,pass:rows.every(r=>r.pageExists&&r.sourceExists&&r.manifestMatch&&r.sourcePagesMatch)&&refs.every(r=>r.exists)};
}
async function httpSmoke(files){
  const server=http.createServer((req,res)=>{
    const rel=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname).replace(/^\/+/, '')||'index.html';
    const full=path.resolve(pagesDir,rel);
    if(!full.startsWith(pagesDir+path.sep)&&full!==pagesDir){res.statusCode=403;return res.end('forbidden');}
    if(!fs.existsSync(full)||!fs.statSync(full).isFile()){res.statusCode=404;return res.end('not found');}
    res.statusCode=200;fs.createReadStream(full).pipe(res);
  });
  await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',e=>e?reject(e):resolve()));
  const port=server.address().port;const rows=[];
  try{for(const file of files){try{const r=await fetch(`http://127.0.0.1:${port}/${encodeURI(file)}`,{cache:'no-store'});rows.push({file,status:r.status,pass:r.ok});await r.arrayBuffer();}catch(e){rows.push({file,status:0,pass:false,error:e.message});}}}
  finally{await new Promise(resolve=>server.close(resolve));}
  return {checked:rows.length,failures:rows.filter(r=>!r.pass),rows,pass:rows.every(r=>r.pass)};
}
function zipCheck(file){
  if(!file)return {provided:false,pass:true};
  const abs=path.resolve(file);if(!fs.existsSync(abs))return {provided:true,file:abs,pass:false,error:'zip not found'};
  const r=spawnSync('unzip',['-t',abs],{encoding:'utf8',maxBuffer:20*1024*1024});
  return {provided:true,file:abs,bytes:fs.statSync(abs).size,sha256:sha(abs),exitCode:r.status??1,pass:r.status===0,outputTail:((r.stdout||'')+(r.stderr||'')).trim().split(/\r?\n/).slice(-8)};
}
function evidenceJson(name){const p=path.join(ROOT,'evidence',name);return fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):null;}

const syntax=syntaxCheck();
const commands=[
  run('codebase_audit',process.execPath,['scripts/audit-codebase.mjs']),
  run('deep_audit',process.execPath,['scripts/audit-deep.mjs']),
  run('spec_audit',process.execPath,['scripts/audit-specs.mjs']),
  run('complexity_audit',process.execPath,['scripts/audit-complexity.mjs']),
  run('document_controller_audit',process.execPath,['scripts/audit-document-controllers.mjs']),
  run('financial_controls_audit',process.execPath,['scripts/audit-financial-controls.mjs']),
  run('render_golden_audit',process.execPath,['scripts/audit-document-render-golden.mjs']),
  run('security_preflight',process.execPath,['scripts/security/agent-repo-audit.mjs','.']),
  run('security_baseline',process.execPath,['scripts/security/verify-security-baseline.mjs','.']),
  run('core_evidence',process.execPath,['scripts/run-core-evidence.mjs']),
  run('full_evidence',process.execPath,['scripts/run-full-evidence.mjs'],{allowFailure:true})
];
const manifest=manifestCheck();
const smokeFiles=manifest.pass?[...new Set(['index.html','deployment-check.html',...manifest.rows.map(r=>r.file)])]:['index.html'];
const httpResult=await httpSmoke(smokeFiles);
const core=evidenceJson(`CORE_TEST_EVIDENCE_${slug}.json`);
const full=evidenceJson(`FULL_TEST_EVIDENCE_${slug}.json`);
const zips={source:zipCheck(sourceZip),pages:zipCheck(pagesZip)};
const hardPass=syntax.pass&&commands.filter(x=>!['full_evidence'].includes(x.label)).every(x=>x.exitCode===0)&&manifest.pass&&httpResult.pass&&zips.source.pass&&zips.pages.pass&&core?.classification==='pass';
const fullState=full?.classification||'missing';
const status=!hardPass?'FAIL':fullState==='pass'?'CUSTOMER_TRIAL_STABLE_FULL_NODE_PASS':fullState==='environment_dependency'?'CUSTOMER_TRIAL_STABLE_CORE_VALIDATED_FULL_ENV_BLOCKED':'REVIEW_FULL_SUITE';
const report={release:META.release,packageVersion:META.packageVersion,phase:'Customer Trial Stable closure',executedAt:new Date().toISOString(),status,syntax,commands:commands.map(({outputTail,...x})=>x),core,full,deployment:{pagesDir,manifest:{runtimeFiles:manifest.runtimeFiles||0,hashMismatch:manifest.hashMismatch??null,missingHtmlRefs:manifest.missingHtmlRefs||[],pass:manifest.pass},http:{checked:httpResult.checked,failures:httpResult.failures,pass:httpResult.pass}},zips,limitations:fullState==='environment_dependency'?['Full Node/DOM suite is not certified in this environment because jsdom/fake-indexeddb are unavailable.','Static HTTP/hash/syntax/core/security checks passed only if status is CUSTOMER_TRIAL_STABLE_CORE_VALIDATED_FULL_ENV_BLOCKED.']:[]};
const outJson=path.join(evidenceDir,`CUSTOMER_TRIAL_VALIDATION_${slug}.json`);fs.writeFileSync(outJson,JSON.stringify(report,null,2));
const md=`# ERP DEMO ${META.release} — Customer Trial Stable Closure\n\n- Status: **${status}**\n- Executed: ${report.executedAt}\n- Syntax: ${syntax.checked} checked / ${syntax.failures.length} failed\n- Core: ${core?`${core.pass}/${core.tests} pass · ${core.classification}`:'missing'}\n- Full Node/DOM: ${full?`${full.pass}/${full.tests} pass · ${full.classification}`:'missing'}\n- Runtime manifest: ${manifest.runtimeFiles||0} files · mismatches ${manifest.hashMismatch??'n/a'}\n- HTTP smoke: ${httpResult.checked} files · failures ${httpResult.failures.length}\n- Source ZIP integrity: ${zips.source.provided?(zips.source.pass?'PASS':'FAIL'):'not supplied'}\n- Pages ZIP integrity: ${zips.pages.provided?(zips.pages.pass?'PASS':'FAIL'):'not supplied'}\n\n## Meaning\n\n${status==='CUSTOMER_TRIAL_STABLE_CORE_VALIDATED_FULL_ENV_BLOCKED'?'Customer-trial static package is validated by portable core, audits, security, source↔pages hashes and HTTP smoke. Full DOM certification remains blocked by missing test dependencies; this is not reported as Full PASS.':status==='CUSTOMER_TRIAL_STABLE_FULL_NODE_PASS'?'All configured gates including the Full Node/DOM suite passed.':'One or more closure gates need review before calling this package Customer Trial Stable.'}\n`;
fs.writeFileSync(path.join(evidenceDir,`CUSTOMER_TRIAL_VALIDATION_${slug}.md`),md);
console.log(JSON.stringify(report,null,2));
if(!hardPass)process.exitCode=1;
