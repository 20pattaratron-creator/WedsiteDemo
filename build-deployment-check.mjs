import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';

// Standalone diagnostic: no application JavaScript, CSS, or external CDN required.
for (const folder of ['.', 'dist']) {
  const root=path.resolve(folder);
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const dom=new JSDOM(html);
  const files=new Set(['index.html']);
  for(const el of dom.window.document.querySelectorAll('script[src],link[rel="stylesheet"],img[src]')) {
    const ref=el.getAttribute('src')||el.getAttribute('href');
    if(ref&&!/^https?:/.test(ref)) files.add(ref.replace(/^\.\//,''));
  }
  if(folder==='dist') for(const file of fs.readdirSync(root+'/assets')) files.add('assets/'+file);
  const manifest=[...files].map(file=>({file,sha256:createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')}));
  dom.window.close();
  fs.writeFileSync(path.join(root,'deployment-check.html'),`<!doctype html>
<html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ตรวจไฟล์ ERP DEMO 3.3.0</title>
<style>body{font:16px/1.7 system-ui,sans-serif;background:#eff6ff;color:#172554;margin:0;padding:24px}main{max-width:1000px;margin:auto;background:white;padding:24px;border-radius:14px}button,a{font:inherit;color:#1d4ed8}button{padding:8px 20px;cursor:pointer}.scroll{overflow:auto}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:10px;border-bottom:1px solid #ddd}td:first-child{overflow-wrap:anywhere}.fail{color:#b91c1c}.pass{color:#166534}#site{overflow-wrap:anywhere}</style>
<main><h1>ตรวจไฟล์ ERP DEMO 3.3.0</h1><p>หน้านี้ทำงานแยกจากระบบหลัก ตรวจไฟล์ที่อัปโหลดและเวอร์ชันของชุดเว็บ ไม่มีการแก้ไขข้อมูล ERP</p><p id="site"></p>
<button id="check">ตรวจอีกครั้ง</button> <a href="./">กลับหน้า ERP</a>
<p id="summary" role="status">กำลังตรวจ…</p><div class="scroll"><table><thead><tr><th>ไฟล์</th><th>HTTP</th><th>ผลตรวจ</th></tr></thead><tbody id="rows"></tbody></table></div>
<p>ถ้าพบ 404 หรือไฟล์ไม่ตรงรุ่น ให้อัปโหลดไฟล์จาก ZIP ชุดเดียวกันครบทั้ง index.html, assets และ deployment-check.html แล้วรอเผยแพร่สำเร็จ ผลผ่านหมายถึงไฟล์ครบตามชุดนี้ ยังไม่ใช่การรับรองการทำงานทุกเมนูหรือหน้าพิมพ์</p></main>
<script>
const manifest=${JSON.stringify(manifest)};
document.getElementById('site').textContent=location.href;
async function check(){
 const button=document.getElementById('check'), rows=document.getElementById('rows');button.disabled=true;rows.replaceChildren();let failures=0;
 for(const item of manifest){
  let status='—',message='',ok=false;
  try{
   const response=await fetch(new URL(item.file,location.href),{cache:'no-store',signal:AbortSignal.timeout(12000)});status=response.status;
   if(!response.ok)throw Error('โหลดไม่สำเร็จ');
   const type=response.headers.get('content-type')||'';
   const ext=item.file.split('.').pop();
   const wanted={css:'text/css',js:'javascript',png:'image/png',html:'text/html'}[ext];
   if(wanted&&!type.includes(wanted))throw Error('ชนิดไฟล์ผิด: '+type);
   if(!crypto.subtle)throw Error('ต้องเปิดผ่าน HTTPS หรือ localhost เพื่อตรวจเวอร์ชัน');
   const bytes=await response.arrayBuffer();const digest=await crypto.subtle.digest('SHA-256',bytes);
   const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
   if(hash!==item.sha256)throw Error('ไฟล์ไม่ตรงกับชุด DEMO 3.3.0 นี้');
   ok=true;message='ผ่าน · ไฟล์ตรงรุ่น';
  }catch(error){failures++;message=error.message;}
  const tr=document.createElement('tr');tr.className=ok?'pass':'fail';
  for(const value of [item.file,String(status),message]){const td=document.createElement('td');td.textContent=value;tr.appendChild(td);}rows.appendChild(tr);
 }
 document.getElementById('summary').textContent=failures?'พบปัญหา '+failures+' ไฟล์ — ส่งภาพผลตรวจนี้ให้ผู้ดูแล':'ผ่านครบ '+manifest.length+' ไฟล์ — ไฟล์ตรงกับชุด DEMO 3.3.0';button.disabled=false;
}
document.getElementById('check').addEventListener('click',check);check();
</script></html>`);
}
fs.writeFileSync('dist/.nojekyll','');
console.log('Generated source/build deployment diagnostics and dist/.nojekyll');
