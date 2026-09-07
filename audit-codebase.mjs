import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-flat']);
const text = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const exists = file => fs.existsSync(path.join(ROOT, file));
const rel = p => path.relative(ROOT, p).replaceAll(path.sep, '/');

function walk(dir=ROOT){
  const out=[];
  for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
    if(SKIP_DIRS.has(ent.name)) continue;
    const full=path.join(dir,ent.name);
    if(ent.isDirectory()) out.push(...walk(full)); else out.push(rel(full));
  }
  return out;
}
function uniqDuplicates(items){
  const map=new Map();
  for(const item of items){ const arr=map.get(item)||[]; arr.push(item); map.set(item,arr); }
  return [...map].filter(([,arr])=>arr.length>1).map(([key])=>key);
}
function attrs(html, tag, attr){
  const re=new RegExp(`<${tag}\\b[^>]*\\b${attr}=["']([^"']+)["'][^>]*>`, 'gi');
  return [...html.matchAll(re)].map(m=>m[1]);
}
function localRef(ref){return ref && !/^(?:https?:|data:|#|mailto:|tel:)/i.test(ref);}
function resolveLocal(ref){return decodeURIComponent(String(ref).split(/[?#]/)[0]).replace(/^\.\//,'');}
function exposedWindowSymbols(jsFiles){
  const out=new Set();
  for(const file of jsFiles){
    const src=text(file);
    for(const m of src.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=/g)) out.add(m[1]);
    for(const m of src.matchAll(/\bwindow\[\s*["']([^"']+)["']\s*\]\s*=/g)) out.add(m[1]);
    for(const m of src.matchAll(/Object\.assign\s*\(\s*window\s*,\s*\{([\s\S]*?)\}\s*\)/g)){
      for(const p of m[1].matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*(?=[:,]|$)/g)) out.add(p[1]);
    }
    // app.js exposes a handlers object through a loop; collect its literal keys.
    for(const m of src.matchAll(/const\s+handlers\s*=\s*\{([\s\S]*?)\};/g)){
      for(const p of m[1].matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*(?=[:,]|$)/g)) out.add(p[1]);
    }
  }
  return out;
}

const files=walk();
const runtimeRoot=files.filter(f=>!f.includes('/') && /\.(?:js|css|html|png|json)$/.test(f));
const jsFiles=files.filter(f=>!f.includes('/') && f.endsWith('.js'));
const html=text('index.html');
const issues=[]; const notes=[];
const add=(severity,code,message,detail=[])=>issues.push({severity,code,message,detail});

// Duplicate basenames anywhere in the source package are a packaging hazard.
const byBase=new Map();
for(const file of files){const b=path.posix.basename(file);const arr=byBase.get(b)||[];arr.push(file);byBase.set(b,arr);}
for(const [base,rows] of byBase){if(rows.length>1)add('error','DUPLICATE_BASENAME',`ชื่อไฟล์ซ้ำ: ${base}`,rows);}

// Static HTML ids, scripts/styles, and missing local refs.
const ids=[...html.matchAll(/\bid=["']([^"']+)["']/g)].map(m=>m[1]);
for(const id of new Set(ids)){const count=ids.filter(x=>x===id).length;if(count>1)add('error','DUPLICATE_HTML_ID',`HTML id ซ้ำ: ${id}`,[`count=${count}`]);}
const scripts=attrs(html,'script','src'), styles=attrs(html,'link','href');
for(const ref of uniqDuplicates(scripts))add('error','DUPLICATE_SCRIPT_REF',`script ถูกโหลดซ้ำ: ${ref}`);
for(const ref of uniqDuplicates(styles))add('error','DUPLICATE_STYLE_REF',`stylesheet ถูกโหลดซ้ำ: ${ref}`);
for(const ref of [...scripts,...styles,...attrs(html,'img','src')].filter(localRef)){
  const f=resolveLocal(ref); if(!exists(f))add('error','MISSING_RESOURCE',`อ้างอิงไฟล์ที่ไม่มี: ${ref}`);
}

// Inline handlers must call browser globals or a function explicitly exposed on window.
const exported=exposedWindowSymbols(jsFiles);
const browserBuiltins=new Set(['alert','confirm','prompt','setTimeout','clearTimeout','setInterval','clearInterval','parseInt','parseFloat','Number','String','Boolean','Date','open','close','print','scrollTo','requestAnimationFrame']);
const handlerAttrs=[...html.matchAll(/\bon[a-z]+=["']([^"']*)["']/gi)].map(m=>m[1]);
const inlineCalls=new Map();
for(const code of handlerAttrs){
  for(const m of code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)){
    const name=m[1]; if(['if','for','while','switch','catch','function'].includes(name))continue;
    if(!inlineCalls.has(name))inlineCalls.set(name,[]); inlineCalls.get(name).push(code);
  }
}
for(const [name,rows] of inlineCalls){if(!exported.has(name)&&!browserBuiltins.has(name))add('error','UNEXPOSED_INLINE_HANDLER',`inline handler เรียก ${name} แต่ไม่พบ global function`,rows.slice(0,3));}

// Safety invariants introduced in 3.6.
for(const file of ['erp-production-core.js','erp-order-flow.js']){
  const src=text(file); if(/window\.go\s*=(?!=)/.test(src))add('error','NAVIGATION_WRAPPER',`${file} ยังทับ window.go โดยตรง`);
}
for(const file of jsFiles){
  const src=text(file); if(/ERPPrepared(?:SalesOrder|ProductionOrder)Id/.test(src))add('error','LEGACY_HANDOFF_GLOBAL',`${file} ยังใช้ transient global รุ่นเก่า`);
}
const errorListenerOwners=jsFiles.filter(file=>/window\.addEventListener\(\s*["']error["']/.test(text(file)));
if(errorListenerOwners.length!==1||errorListenerOwners[0]!=='boot-status.js')add('error','RUNTIME_ERROR_LISTENER_DUP','Runtime error listener ควรมี source เดียวที่ boot-status.js',errorListenerOwners);

// Syntax check every root runtime JS file, including modules.
for(const file of jsFiles){
  try{execFileSync(process.execPath,['--check',path.join(ROOT,file)],{stdio:'pipe'});}catch(error){add('error','JS_SYNTAX',`JavaScript syntax error: ${file}`,[String(error.stderr||error.message)]);}
}

// CSS overlap is not automatically an error; report cross-file un-namespaced collisions.
const selectorFiles=new Map();
for(const file of files.filter(f=>!f.includes('/')&&f.endsWith('.css'))){
  let src=text(file).replace(/\/\*[\s\S]*?\*\//g,'');
  for(const m of src.matchAll(/([^{}]+)\{/g)){
    const raw=m[1].trim(); if(!raw||raw.startsWith('@')||raw.includes(';'))continue;
    for(const sel of raw.split(',').map(x=>x.trim()).filter(Boolean)){
      if(/^(?:from|to|\d+%)$/.test(sel))continue;
      const set=selectorFiles.get(sel)||new Set();set.add(file);selectorFiles.set(sel,set);
    }
  }
}
const crossCss=[...selectorFiles].filter(([,set])=>set.size>1).map(([selector,set])=>({selector,files:[...set]}));
notes.push({code:'CSS_CROSS_FILE_OVERLAP',count:crossCss.length,detail:crossCss.slice(0,40)});

const result={version:'3.8.0',packageVersion:'1.8.0',checkedAt:new Date().toISOString(),runtimeRootFiles:runtimeRoot.length,jsFiles:jsFiles.length,inlineHandlerFunctions:inlineCalls.size,issues,notes,status:issues.some(x=>x.severity==='error')?'FAIL':'PASS'};
fs.writeFileSync(path.join(ROOT,'CODEBASE_AUDIT_RESULTS.json'),JSON.stringify(result,null,2));
console.log(`ERP Codebase Audit 3.8.0: ${result.status}`);
console.log(`Files=${files.length} JS=${jsFiles.length} inlineFunctions=${inlineCalls.size}`);
if(issues.length){for(const i of issues)console.log(`[${i.severity.toUpperCase()}] ${i.code}: ${i.message}${i.detail?.length?' :: '+i.detail.join(' | '):''}`);}else console.log('No blocking duplication/reference/global-collision issues found.');
console.log(`CSS cross-file selector overlaps (review-only): ${crossCss.length}`);
process.exitCode=result.status==='PASS'?0:1;
