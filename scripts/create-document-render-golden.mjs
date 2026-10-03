#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const OUT=path.join(ROOT,'DOCUMENT_RENDER_GOLDEN_BASELINE.json');
const DOCS={
  quotation:{js:'quotation-document.js',css:'quotation-document.css',functions:['pageHtml','documentPagesHtml']},
  deliveryTax:{js:'delivery-tax-document.js',css:'delivery-tax-document.css',functions:['documentPagesHtml','documentPageHtml']},
  receipt:{js:'receipt-document.js',css:'receipt-document.css',functions:['documentPagesHtml','documentPageHtml']}
};
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const normalize=value=>value.replace(/\r\n/g,'\n').replace(/[ \t]+$/gm,'').trim();
function read(file){return fs.readFileSync(path.join(ROOT,file),'utf8');}
function extractFunction(src,name){
  const startRe=new RegExp(`^function\\s+${name.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}\\s*\\(`,'m');
  const m=startRe.exec(src);if(!m)throw new Error(`Missing function ${name}`);
  const start=m.index;const tail=src.slice(start+m[0].length);
  const next=/^function\s+[A-Za-z_$][\w$]*\s*\(/m.exec(tail);
  const end=next?start+m[0].length+next.index:src.length;
  return normalize(src.slice(start,end));
}
const documents={};
for(const [id,cfg] of Object.entries(DOCS)){
  const js=read(cfg.js),css=read(cfg.css);
  documents[id]={
    js:cfg.js,css:cfg.css,
    cssSha256:sha(normalize(css)),
    functions:Object.fromEntries(cfg.functions.map(name=>[name,sha(extractFunction(js,name))]))
  };
}
const payload={version:1,purpose:'Source-level golden guard for printable document rendering. A hash change requires explicit visual/PDF review and deliberate baseline regeneration.',generatedAt:new Date().toISOString(),documents};
fs.writeFileSync(OUT,JSON.stringify(payload,null,2)+'\n');
console.log(`Document render golden baseline written: ${OUT}`);
