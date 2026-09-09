import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {releaseMeta} from './release-meta.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const META=releaseMeta(ROOT);
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const exists=f=>fs.existsSync(path.join(ROOT,f));
const budget=JSON.parse(read('QUALITY_BUDGET.json'));
const issues=[];
const add=(severity,metric,value,limit)=>issues.push({severity,metric,value,limit,message:`${metric}=${value} exceeds ${limit}`});
if(budget.release!==META.release)add('high','budgetRelease',budget.release,META.release);

function localScriptRefs(){
  const html=read('index.html');
  return [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
    .map(m=>m[1]).filter(r=>!/^https?:/i.test(r)).map(r=>r.replace(/^\.\//,''));
}
function normPath(from,ref){return path.posix.normalize(path.posix.join(path.posix.dirname(from),ref)).replace(/^\.\//,'');}
function importsOf(file){
  const src=read(file),out=[];
  for(const m of src.matchAll(/(?:import\s+(?:[^'";]+?\s+from\s+)?|import\s*\()\s*["'](\.\.?\/[^"']+)["']/g))out.push(normPath(file,m[1]));
  return out;
}
function runtimeJs(){
  const seen=new Set(),queue=localScriptRefs().filter(f=>f.endsWith('.js'));
  while(queue.length){const f=queue.shift();if(seen.has(f))continue;seen.add(f);if(!exists(f))continue;for(const dep of importsOf(f))if(dep.endsWith('.js'))queue.push(dep);}
  return [...seen];
}
const runtime=runtimeJs();
const rootJs=fs.readdirSync(ROOT,{withFileTypes:true}).filter(e=>e.isFile()&&e.name.endsWith('.js')).map(e=>e.name);
const pkg=JSON.parse(read('package.json'));
const metrics={
  runtimeJsFiles:runtime.length,
  runtimeLines:runtime.reduce((n,f)=>n+read(f).split('\n').length,0),
  rootJsFiles:rootJs.length,
  appJsLines:read('app.js').split('\n').length,
  devDependencies:Object.keys(pkg.devDependencies||{}).length,
  windowAssignments:rootJs.reduce((n,f)=>n+(read(f).match(/\bwindow\.[A-Za-z_$][\w$]*\s*=(?!=)/g)||[]).length,0),
  inlineHandlerFunctions:new Set([...read('index.html').matchAll(/\bon[a-z]+=["']([^"']*)["']/gi)].flatMap(m=>[...m[1].matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)].map(x=>x[1]))).size
};
const map={runtimeJsFiles:'runtimeJsFilesMax',runtimeLines:'runtimeLinesMax',rootJsFiles:'rootJsFilesMax',appJsLines:'appJsLinesMax',devDependencies:'devDependenciesMax',windowAssignments:'windowAssignmentsMax',inlineHandlerFunctions:'inlineHandlerFunctionsMax'};
for(const [metric,limitName] of Object.entries(map)){
  const limit=Number(budget.limits?.[limitName]);
  if(Number.isFinite(limit)&&metrics[metric]>limit)add('high',metric,metrics[metric],limit);
}
const status=issues.some(i=>i.severity==='high')?'FAIL':'PASS';
const result={release:META.release,packageVersion:META.packageVersion,checkedAt:new Date().toISOString(),metrics,limits:budget.limits,issues,status};
fs.writeFileSync(path.join(ROOT,'COMPLEXITY_AUDIT_RESULTS.json'),JSON.stringify(result,null,2));
console.log(`ERP Complexity Audit ${META.release}: ${status}`);
console.log(JSON.stringify(metrics));
for(const i of issues)console.log(`[${i.severity.toUpperCase()}] ${i.message}`);
process.exitCode=status==='PASS'?0:1;
