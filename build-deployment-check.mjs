import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

function attr(tag,name){const m=new RegExp(`\\b${name}=["']([^"']+)["']`,'i').exec(tag);return m?.[1]||'';}
function isLocal(ref){return ref&&!/^(?:https?:|data:|#|mailto:|tel:)/i.test(ref);}
function cleanRef(ref){return decodeURIComponent(String(ref).split(/[?#]/)[0]).replace(/^\.\//,'');}
function collectHtmlRefs(html){
  const out=new Set(['index.html']);
  for(const tag of html.match(/<script\b[^>]*>/gi)||[]){const ref=attr(tag,'src');if(isLocal(ref))out.add(cleanRef(ref));}
  for(const tag of html.match(/<link\b[^>]*>/gi)||[]){if(!/\brel=["'][^"']*stylesheet/i.test(tag))continue;const ref=attr(tag,'href');if(isLocal(ref))out.add(cleanRef(ref));}
  for(const tag of html.match(/<img\b[^>]*>/gi)||[]){const ref=attr(tag,'src');if(isLocal(ref))out.add(cleanRef(ref));}
  return out;
}
function expandModuleRefs(root,files){
  const queue=[...files].filter(f=>f.endsWith('.js')); const seen=new Set();
  while(queue.length){
    const file=queue.shift(); if(seen.has(file))continue; seen.add(file);
    const full=path.join(root,file); if(!fs.existsSync(full))continue;
    const src=fs.readFileSync(full,'utf8');
    const refs=[];
    for(const m of src.matchAll(/(?:import\s+(?:[^'";]+?\s+from\s+)?|import\s*\()\s*["'](\.[^"']+)["']/g))refs.push(m[1]);
    for(const m of src.matchAll(/new\s+URL\(\s*["'](\.[^"']+)["']\s*,\s*import\.meta\.url\s*\)/g))refs.push(m[1]);
    for(const ref of refs){
      const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(file),cleanRef(ref)));
      if(!files.has(resolved)){files.add(resolved);if(resolved.endsWith('.js'))queue.push(resolved);}
    }
  }
}

const folders=process.argv.slice(2);
for (const folder of (folders.length?folders:['.', 'dist'])) {
  const root=path.resolve(folder);
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const flat=html.includes('3.7.0-flat');
  const release=flat?'3.7.0 FLAT':'3.7.0';
  const files=collectHtmlRefs(html); expandModuleRefs(root,files);
  if(folder!=='.'){
    if(fs.existsSync(path.join(root,'assets')))for(const file of fs.readdirSync(path.join(root,'assets')))files.add('assets/'+file);
    else for(const file of fs.readdirSync(root))if(/\.(?:js|css|png)$/.test(file))files.add(file);
  }
  const missing=[...files].filter(file=>!fs.existsSync(path.join(root,file)));
  if(missing.length)throw new Error(`Deployment manifest references missing files in ${folder}: ${missing.join(', ')}`);
  const manifest=[...files].sort().map(file=>({file,sha256:createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')}));
  fs.writeFileSync(path.join(root,'deployment-check.html'),`<!doctype html>
<html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ตรวจไฟล์ ERP DEMO ${release}</title>
<style>body{font:16px/1.7 system-ui,sans-serif;background:#eff6ff;color:#172554;margin:0;padding:24px}main{max-width:1000px;margin:auto;background:white;padding:24px;border-radius:14px}button,a{font:inherit;color:#1d4ed8}button{padding:8px 20px;cursor:pointer}.scroll{overflow:auto}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:10px;border-bottom:1px solid #ddd}td:first-child{overflow-wrap:anywhere}.fail{color:#b91c1c}.pass{color:#166534}#site{overflow-wrap:anywhere}</style>
<main><h1>ตรวจไฟล์ ERP DEMO ${release}</h1><p>หน้านี้ทำงานแยกจากระบบหลัก ตรวจความครบและ SHA-256 ของไฟล์ runtime รวม module import ที่ระบบใช้งาน ไม่มีการแก้ไขข้อมูล ERP</p><p id="site"></p>
<button id="check">ตรวจอีกครั้ง</button> <a href="./">กลับหน้า ERP</a>
<p id="summary" role="status">กำลังตรวจ…</p><div class="scroll"><table><thead><tr><th>ไฟล์</th><th>HTTP</th><th>ผลตรวจ</th></tr></thead><tbody id="rows"></tbody></table></div>
<p>ถ้าพบ 404 หรือ SHA ไม่ตรง ให้อัปโหลดไฟล์จาก ZIP รุ่นเดียวกันทั้งหมด ผลผ่านหมายถึงไฟล์ deploy ครบและตรงรุ่น ยังไม่ใช่ Full Browser/E2E certification</p></main>
<script>
const manifest=${JSON.stringify(manifest)};
document.getElementById('site').textContent=location.href;
async function check(){const button=document.getElementById('check'),rows=document.getElementById('rows');button.disabled=true;rows.replaceChildren();let failures=0;for(const item of manifest){let status='—',message='',ok=false;try{const response=await fetch(new URL(item.file,location.href),{cache:'no-store',signal:AbortSignal.timeout(12000)});status=response.status;if(!response.ok)throw Error('โหลดไม่สำเร็จ');if(!crypto.subtle)throw Error('ต้องเปิดผ่าน HTTPS หรือ localhost เพื่อตรวจ SHA-256');const bytes=await response.arrayBuffer();const digest=await crypto.subtle.digest('SHA-256',bytes);const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==item.sha256)throw Error('ไฟล์ไม่ตรงกับชุด DEMO ${release} นี้');ok=true;message='ผ่าน · ไฟล์ตรงรุ่น';}catch(error){failures++;message=error.message;}const tr=document.createElement('tr');tr.className=ok?'pass':'fail';for(const value of [item.file,String(status),message]){const td=document.createElement('td');td.textContent=value;tr.appendChild(td);}rows.appendChild(tr);}document.getElementById('summary').textContent=failures?'พบปัญหา '+failures+' ไฟล์ — ส่งภาพผลตรวจนี้ให้ผู้ดูแล':'ผ่านครบ '+manifest.length+' ไฟล์ — ไฟล์ตรงกับชุด DEMO ${release}';button.disabled=false;}
document.getElementById('check').addEventListener('click',check);check();
</script></html>`);
  if(folder!=='.')fs.writeFileSync(path.join(root,'.nojekyll'),'');
  console.log(`Generated ${folder}/deployment-check.html (${manifest.length} files, ERP DEMO ${release})`);
}
