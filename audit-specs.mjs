import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {releaseMeta} from './release-meta.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const META=releaseMeta(ROOT);
const issues=[];
const add=(severity,code,message,detail='')=>issues.push({severity,code,message,detail});
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const exists=f=>fs.existsSync(path.join(ROOT,f));

const constitution='specs/constitution/ERP_CONSTITUTION.md';
if(!exists(constitution)) add('high','MISSING_CONSTITUTION','Missing ERP engineering constitution');
else {
  const rules=[...read(constitution).matchAll(/^##\s+(C-\d{2})\b/gm)].map(m=>m[1]);
  if(rules.length<10)add('medium','CONSTITUTION_TOO_THIN',`Expected >=10 constitution rules, found ${rules.length}`);
  if(new Set(rules).size!==rules.length)add('high','DUPLICATE_CONSTITUTION_RULE','Duplicate constitution rule ids');
}

function walk(dir){
  const out=[];
  for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
    const p=path.join(dir,ent.name);
    if(ent.isDirectory())out.push(...walk(p)); else out.push(p);
  }
  return out;
}
const specRoot=path.join(ROOT,'specs');
const requirementFiles=walk(specRoot).filter(f=>/REQUIREMENTS\.md$/i.test(f));
const reqMap=new Map();
for(const file of requirementFiles){
  const rel=path.relative(ROOT,file).replaceAll(path.sep,'/');
  const src=fs.readFileSync(file,'utf8');
  for(const m of src.matchAll(/\*\*(REQ-[A-Z]+-\d{3})\*\*/g)){
    const arr=reqMap.get(m[1])||[];arr.push(rel);reqMap.set(m[1],arr);
  }
}
for(const [id,files] of reqMap)if(files.length>1)add('high','DUPLICATE_REQUIREMENT_ID',`${id} appears more than once`,files.join(', '));

const traceFile='specs/TRACEABILITY.json';
if(!exists(traceFile))add('high','MISSING_TRACEABILITY','Missing specs/TRACEABILITY.json');
let trace={release:'',requirements:[]};
try{trace=JSON.parse(read(traceFile));}catch(e){add('high','INVALID_TRACEABILITY_JSON','TRACEABILITY.json is not valid JSON',e.message);}
if(trace.release!==META.release)add('high','TRACE_RELEASE_DRIFT',`Traceability release ${trace.release||'-'} != ${META.release}`);
const traceIds=new Set();
for(const row of trace.requirements||[]){
  if(!row?.id){add('high','TRACE_ROW_NO_ID','Traceability row missing id');continue;}
  if(traceIds.has(row.id))add('high','DUPLICATE_TRACE_ROW',`Duplicate traceability row ${row.id}`);traceIds.add(row.id);
  if(!reqMap.has(row.id))add('high','TRACE_UNKNOWN_REQUIREMENT',`Traceability references unknown ${row.id}`);
  if(!row.spec||!exists(row.spec))add('high','TRACE_MISSING_SPEC',`${row.id} spec path is missing`,row.spec||'');
  const status=String(row.status||'');
  if(status.startsWith('automated')){
    if(!row.testFile||!exists(row.testFile))add('high','TRACE_MISSING_TEST_FILE',`${row.id} test file missing`,row.testFile||'');
    else if(!row.testName||!read(row.testFile).includes(row.testName))add('high','TRACE_TEST_NAME_NOT_FOUND',`${row.id} test name not found`,row.testName||'');
  } else if(!['manual','production-gap'].includes(status)) add('medium','TRACE_UNKNOWN_STATUS',`${row.id} has unsupported status ${status}`);
  if(['manual','production-gap'].includes(status)&&!String(row.evidence||'').trim())add('high','TRACE_NO_EVIDENCE',`${row.id} ${status} row requires evidence`);
}
for(const id of reqMap.keys())if(!traceIds.has(id))add('high','UNTRACED_REQUIREMENT',`${id} has no traceability row`);

const contextFile='DEVELOPMENT_CONTEXT.json';
if(!exists(contextFile))add('high','MISSING_DEVELOPMENT_CONTEXT','Missing DEVELOPMENT_CONTEXT.json');
else try{
  const ctx=JSON.parse(read(contextFile));
  if(ctx.release!==META.release)add('high','CONTEXT_RELEASE_DRIFT',`Development context release ${ctx.release||'-'} != ${META.release}`);
  if(ctx.packageVersion!==META.packageVersion)add('high','CONTEXT_PACKAGE_DRIFT',`Development context package ${ctx.packageVersion||'-'} != ${META.packageVersion}`);
  for(const [name,file] of Object.entries(ctx.sourceOfTruth||{}))if(!exists(file))add('high','CONTEXT_SOURCE_MISSING',`Source of truth ${name} missing`,file);
}catch(e){add('high','INVALID_DEVELOPMENT_CONTEXT','DEVELOPMENT_CONTEXT.json is invalid JSON',e.message);}

const blocking=issues.some(i=>['high','medium'].includes(i.severity));
const result={release:META.release,packageVersion:META.packageVersion,checkedAt:new Date().toISOString(),requirementCount:reqMap.size,traceabilityCount:traceIds.size,issues,status:blocking?'FAIL':'PASS'};
fs.writeFileSync(path.join(ROOT,'SPEC_AUDIT_RESULTS.json'),JSON.stringify(result,null,2));
console.log(`ERP Spec Audit ${META.release}: ${result.status}`);
console.log(`Requirements=${result.requirementCount} Traceability=${result.traceabilityCount} Issues=${issues.length}`);
for(const i of issues)console.log(`[${i.severity.toUpperCase()}] ${i.code}: ${i.message}${i.detail?' :: '+i.detail:''}`);
process.exitCode=blocking?1:0;
