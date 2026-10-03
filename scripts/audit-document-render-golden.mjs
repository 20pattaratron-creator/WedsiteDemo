#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {releaseMeta} from './release-meta.mjs';
import {writeFileAtomic} from './write-file-atomic.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const META=releaseMeta(ROOT);
const BASELINE_FILE='DOCUMENT_RENDER_GOLDEN_BASELINE.json';
const OUTPUT_FILE='DOCUMENT_RENDER_GOLDEN_AUDIT_RESULTS.json';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const normalize=value=>value.replace(/\r\n/g,'\n').replace(/[ \t]+$/gm,'').trim();
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
function extractFunction(src,name){
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const m=new RegExp(`^function\\s+${escaped}\\s*\\(`,'m').exec(src);
  if(!m)throw new Error(`Missing render function ${name}`);
  const start=m.index;const prefix=m[0];const tail=src.slice(start+prefix.length);
  const next=/^function\s+[A-Za-z_$][\w$]*\s*\(/m.exec(tail);
  const end=next?start+prefix.length+next.index:src.length;
  return normalize(src.slice(start,end));
}
const baseline=JSON.parse(read(BASELINE_FILE));
const checks=[];
for(const [id,cfg] of Object.entries(baseline.documents||{})){
  const js=read(cfg.js),css=read(cfg.css);
  const actualCss=sha(normalize(css));
  checks.push({id:`${id}:css`,ok:actualCss===cfg.cssSha256,expected:cfg.cssSha256,actual:actualCss});
  for(const [name,expected] of Object.entries(cfg.functions||{})){
    const actual=sha(extractFunction(js,name));
    checks.push({id:`${id}:${name}`,ok:actual===expected,expected,actual});
  }
}
const issues=checks.filter(x=>!x.ok);
const status=issues.length?'FAIL':'PASS';
const result={release:META.release,packageVersion:META.packageVersion,checkedAt:new Date().toISOString(),status,baseline:BASELINE_FILE,checks,issues,note:'This is a source-level render golden guard, not a pixel/screenshot browser test. Any change requires explicit document/PDF review before baseline regeneration.'};
writeFileAtomic(path.join(ROOT,OUTPUT_FILE),JSON.stringify(result,null,2)+'\n');
console.log(`ERP Document Render Golden Audit ${META.release}: ${status}`);
for(const issue of issues)console.log(`[CHANGED] ${issue.id}`);
if(status!=='PASS')process.exitCode=1;
