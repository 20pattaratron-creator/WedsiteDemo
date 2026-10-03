import {build} from 'vite';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {releaseMeta} from './release-meta.mjs';
const META=releaseMeta(path.resolve('.'));

// Emit every runtime file beside index.html for browser uploads that flatten folders.
// Vite rewrites HTML, logo and import.meta.url references together, including print CSS.
await build({
  base:'./',
  plugins:[{
    name:'erp-flat-deployment-label',
    transformIndexHtml(html){return html
      .replace(`${META.release}-source`,`${META.release}-flat`)
      .replace(`DEMO ${META.release} · โหลดหน้าเว็บไม่ครบ`,`DEMO ${META.release} FLAT · โหลดหน้าเว็บไม่ครบ`)
      .replace('ตรวจว่าได้อัปโหลด index.html และ assets จากชุดเดียวกัน แล้วเปิดหน้าตรวจไฟล์เว็บเพื่อดูรายละเอียด','อัปโหลดไฟล์จากชุด FLAT ทั้งหมดไว้ระดับเดียวกับ index.html แล้วเปิดหน้าตรวจไฟล์เว็บเพื่อดูรายละเอียด');}
  }],
  build:{outDir:'dist-flat',assetsDir:'',emptyOutDir:true}
});
execFileSync(process.execPath,['scripts/build-deployment-check.mjs','dist-flat'],{stdio:'inherit'});
