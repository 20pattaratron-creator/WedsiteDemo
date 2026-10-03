import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseMeta } from './release-meta.mjs';
import {writeFileAtomic} from './write-file-atomic.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const META=releaseMeta(ROOT);
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const exists=f=>fs.existsSync(path.join(ROOT,f));
const normPath=(from,ref)=>path.posix.normalize(path.posix.join(path.posix.dirname(from),ref)).replace(/^\.\//,'');
const issues=[];const notes=[];
const add=(severity,code,file,line,message)=>issues.push({severity,code,file,line,message});

function lineOf(src,index){return src.slice(0,index).split('\n').length;}
function localScriptRefs(){
  const html=read('index.html');
  return [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
    .map(m=>m[1]).filter(r=>!/^https?:/i.test(r)).map(r=>r.replace(/^\.\//,''))
    // vendor/ = third-party minified libraries (vendor/vendor-manifest.json, ADR-013), not project code.
    .filter(r=>!r.startsWith('vendor/'));
}
function importsOf(file){
  const src=read(file);const out=[];
  for(const m of src.matchAll(/(?:import\s+(?:[^'";]+?\s+from\s+)?|import\s*\()\s*["'](\.\.?\/[^"']+)["']/g))out.push(normPath(file,m[1]));
  for(const m of src.matchAll(/new\s+URL\(\s*["'](\.\.?\/[^"']+)["']\s*,\s*import\.meta\.url\s*\)/g))out.push(normPath(file,m[1]));
  return out;
}
function runtimeJs(){
  const seen=new Set(),queue=localScriptRefs().filter(f=>f.endsWith('.js'));
  while(queue.length){const f=queue.shift();if(seen.has(f))continue;seen.add(f);if(!exists(f)){add('high','MISSING_RUNTIME_IMPORT',f,0,'Runtime file referenced but missing');continue;}for(const dep of importsOf(f)){if(dep.endsWith('.js'))queue.push(dep);}}
  return [...seen].sort();
}
const runtime=runtimeJs();

// 1) dangerous dynamic code execution
for(const file of runtime){const src=read(file);for(const re of [/\beval\s*\(/g,/\bnew\s+Function\s*\(/g])for(const m of src.matchAll(re))add('high','DYNAMIC_CODE_EXECUTION',file,lineOf(src,m.index),'Avoid eval/new Function in ERP runtime');}

// 2) business-date UTC hazards
for(const file of runtime){const src=read(file);for(const m of src.matchAll(/new\s+Date\(\)\.toISOString\(\)\.(?:slice\(0\s*,\s*10\)|split\(["']T["']\)\[0\])/g))add('high','UTC_BUSINESS_DATE',file,lineOf(src,m.index),'UTC date used as a calendar business date');
  for(const m of src.matchAll(/new\s+Date\(\s*[^\n)]*(?:dueDate|requiredDate|expectedDate|appointmentDate|billingDate)[^\n)]*\)/g))add('medium','DATE_ONLY_AS_INSTANT',file,lineOf(src,m.index),'Date-only business field is parsed as an instant; use shared business-date helpers');
}

// 3) VAT literals must have one owner
for(const file of runtime){if(file==='erp-shared-core.js')continue;const src=read(file);for(const m of src.matchAll(/(?:\b0\.07\b|(?<![\d.])\.07\b|\b1\.07\b|100\s*\/\s*107)/g))add('high','VAT_LITERAL_DRIFT',file,lineOf(src,m.index),'VAT arithmetic must use erp-shared-core.js');}


// 3b) silently swallowed runtime failures and permanently disabled branches.
// Best-effort failures must be explicit (comment/log); critical state paths must never disappear silently.
for(const file of runtime){
  const src=read(file);
  for(const m of src.matchAll(/if\s*\(\s*false\s*&&/g))add('medium','PERMANENTLY_DISABLED_BRANCH',file,lineOf(src,m.index),'Remove dead if(false && ...) branches instead of leaving misleading runtime code');
  for(const m of src.matchAll(/catch\s*(?:\([^)]*\))?\s*\{\s*\}/g))add('medium','EMPTY_CATCH',file,lineOf(src,m.index),'Empty catch silently hides runtime failure; log, classify, or document a best-effort fallback');
  for(const m of src.matchAll(/\.catch\(\s*\(?[^=)]*\)?\s*=>\s*\{?\s*\}?\s*\)/g))add('medium','EMPTY_PROMISE_CATCH',file,lineOf(src,m.index),'Empty promise catch silently hides runtime failure');
}

// 4) persisted shared keys must have one owner
const contract=read('erp-storage-contracts.js');
const persisted=[...contract.matchAll(/=\s*['"]([^'"]+(?:_v\d+|targets_v\d+))['"]/g)].map(m=>m[1]);
for(const file of runtime){if(file==='erp-storage-contracts.js')continue;const src=read(file);for(const key of persisted){const idx=src.indexOf(`'${key}'`);const idx2=src.indexOf(`"${key}"`);const at=idx>=0?idx:idx2;if(at>=0)add('high','PERSISTED_KEY_DUPLICATED',file,lineOf(src,at),`Persisted key literal duplicated outside contract: ${key}`);}}

// 5) legacy globals / direct navigation wrapper
for(const file of runtime){const src=read(file);for(const [re,code,msg] of [[/ERPPrepared(?:SalesOrder|ProductionOrder)Id/g,'LEGACY_WORKFLOW_GLOBAL','Legacy workflow handoff global remains'],[/__ERP_ORDER_FLOW_V3__/g,'LEGACY_ORDER_FLOW_GUARD','Legacy versioned runtime guard remains']])for(const m of src.matchAll(re))add('high',code,file,lineOf(src,m.index),msg);if(file!=='click-fallback.js')for(const m of src.matchAll(/window\.go\s*=(?!=)/g))add('high','DIRECT_WINDOW_GO_OVERRIDE',file,lineOf(src,m.index),'Module directly replaces window.go');}

// 6) same-file exact function body duplication (simple named declarations)
function extractFunctions(src){
  const out=[];const re=/\bfunction\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;let m;
  while((m=re.exec(src))){let i=re.lastIndex,depth=1,state='code',quote='';for(;i<src.length&&depth>0;i++){const c=src[i],n=src[i+1];if(state==='line'){if(c==='\n')state='code';continue;}if(state==='block'){if(c==='*'&&n==='/'){state='code';i++;}continue;}if(state==='string'){if(c==='\\'){i++;continue;}if(c===quote)state='code';continue;}if(c==='/'&&n==='/'){state='line';i++;continue;}if(c==='/'&&n==='*'){state='block';i++;continue;}if(c==='"'||c==="'"||c==='`'){state='string';quote=c;continue;}if(c==='{')depth++;else if(c==='}')depth--;}
    const body=src.slice(re.lastIndex,i-1).replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'').replace(/\s+/g,' ').trim();out.push({name:m[1],body,line:lineOf(src,m.index)});re.lastIndex=i;}
  return out;
}
for(const file of runtime){const src=read(file),funcs=extractFunctions(src),map=new Map();for(const f of funcs){if(f.body.length<80)continue;const arr=map.get(f.body)||[];arr.push(f);map.set(f.body,arr);}for(const arr of map.values())if(arr.length>1)add('medium','SAME_FILE_DUPLICATE_FUNCTION',file,arr[0].line,`Exact duplicated function bodies: ${arr.map(x=>`${x.name}@${x.line}`).join(', ')}`);}

// 7) normalized 10-line duplicate windows are review-only; count unique groups
const windows=new Map();
for(const file of runtime){const lines=read(file).split('\n');for(let i=0;i<=lines.length-10;i++){const chunk=lines.slice(i,i+10).join('\n').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'').replace(/\s+/g,' ').trim();if(chunk.length<220)continue;const arr=windows.get(chunk)||[];arr.push({file,line:i+1});windows.set(chunk,arr);}}
const duplicateWindows=[...windows.values()].filter(arr=>new Set(arr.map(x=>x.file)).size>1);
notes.push({code:'NORMALIZED_DUPLICATE_10_LINE_WINDOWS',count:duplicateWindows.length,examples:duplicateWindows.slice(0,20)});

// 7b) issued-document UI controllers must not bypass the transactional finance boundary.
for (const file of ['delivery-tax-document.js','receipt-document.js']) {
  if (!runtime.includes(file)) continue;
  const src = read(file);
  const match = /async function saveDocumentToSystem\(button\) \{([\s\S]*?)\n\}\n\nfunction createOffscreenPages/.exec(src);
  const block = match?.[1] || '';
  if (!block) add('high','ISSUED_DOCUMENT_SAVE_MISSING',file,0,'Issued-document save boundary could not be located');
  else {
    const start = match.index;
    for (const m of block.matchAll(/localStorage\.setItem\s*\(/g)) add('high','ISSUED_DOCUMENT_DIRECT_STORAGE_WRITE',file,lineOf(src,start+m.index),'Issued-document saves must use the strict rollback-capable write session');
    if (!/runDocumentAction\s*\(/.test(block)) add('high','ISSUED_DOCUMENT_ACTION_RUNNER_BYPASS',file,lineOf(src,start),'Issued-document saves must use runDocumentAction');
    if (!/ComformDocumentWriteStore/.test(block) || !/writeSession\.commit\s*\(/.test(block)) add('high','ISSUED_DOCUMENT_TRANSACTION_BYPASS',file,lineOf(src,start),'Issued-document saves must use the shared strict write session');
    if (file === 'receipt-document.js' && /markInvoicePaidByReceipt/.test(block)) add('high','PRINT_LAYER_SETTLEMENT_MUTATION',file,lineOf(src,start),'Printable receipt persistence must never mutate accounting settlement truth');
    if (file === 'delivery-tax-document.js' && /updateBusinessDoc\s*\(\s*['"]productions['"]/.test(block)) add('high','PRINT_LAYER_WORKFLOW_MUTATION',file,lineOf(src,start),'Printable invoice persistence must never mutate production workflow truth');
  }
}

// 8) maintenance markers review-only
let markerCount=0;for(const file of runtime){const src=read(file);markerCount+=(src.match(/\b(?:TODO|FIXME|HACK|XXX)\b/g)||[]).length;}notes.push({code:'MAINTENANCE_MARKERS',count:markerCount});

const rank={high:3,medium:2,low:1};
const blocking=issues.some(i=>rank[i.severity]>=2);
const result={version:META.release,packageVersion:META.packageVersion,checkedAt:new Date().toISOString(),runtimeJsFiles:runtime.length,runtimeLines:runtime.reduce((s,f)=>s+read(f).split('\n').length,0),issues,notes,status:blocking?'FAIL':'PASS'};
writeFileAtomic(path.join(ROOT,'DEEP_CODE_AUDIT_RESULTS.json'),JSON.stringify(result,null,2));
console.log(`ERP Deep Static Audit ${META.release}: ${result.status}`);
console.log(`Runtime JS=${result.runtimeJsFiles} Lines=${result.runtimeLines} Issues=${issues.length}`);
for(const i of issues)console.log(`[${i.severity.toUpperCase()}] ${i.code} ${i.file}:${i.line} — ${i.message}`);
console.log(`Duplicate 10-line groups (review-only): ${duplicateWindows.length}`);
process.exitCode=blocking?1:0;
