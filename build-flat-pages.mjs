import {build} from 'vite';
import {execFileSync} from 'node:child_process';

// Emit every runtime file beside index.html for browser uploads that flatten folders.
// Vite rewrites HTML, logo and import.meta.url references together, including print CSS.
await build({
  base:'./',
  plugins:[{
    name:'erp-flat-deployment-label',
    transformIndexHtml(html){return html
      .replace('3.8.0-source','3.8.0-flat')
      .replace('DEMO 3.8.0 · โหลดหน้าเว็บไม่ครบ','DEMO 3.8.0 FLAT · โหลดหน้าเว็บไม่ครบ')
      .replace('ตรวจว่าได้อัปโหลด index.html และ assets จากชุดเดียวกัน แล้วเปิดหน้าตรวจไฟล์เว็บเพื่อดูรายละเอียด','อัปโหลดไฟล์จากชุด FLAT ทั้งหมดไว้ระดับเดียวกับ index.html แล้วเปิดหน้าตรวจไฟล์เว็บเพื่อดูรายละเอียด');}
  }],
  build:{outDir:'dist-flat',assetsDir:'',emptyOutDir:true}
});
execFileSync(process.execPath,['scripts/build-deployment-check.mjs','dist-flat'],{stdio:'inherit'});
