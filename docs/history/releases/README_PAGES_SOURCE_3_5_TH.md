# ERP DEMO 3.5.0 — Source Pages Package

โฟลเดอร์ `pages-source/` เป็นชุด Local Demo ที่เสิร์ฟไฟล์ JavaScript modules ตรงจาก source โดยไม่ต้องมี bundle เดิม 3.4.0 จึงไม่เสี่ยงปน build เก่า และสามารถใช้กับ GitHub Pages/static web server ที่ให้ MIME ของ `.js`/`.css` ถูกต้องได้

## วิธีทดลองบนเครื่อง

วิธีที่แนะนำคือใช้ Vite จาก root project หลัง `npm ci` แล้ว `npm run dev` เพื่อให้ Test/Build ใช้กระบวนการมาตรฐาน

หากต้องการตรวจ source package แบบง่าย ใช้ static HTTP server แล้วเปิด `pages-source/index.html` ผ่าน HTTP/HTTPS (ไม่ควรดับเบิลคลิกไฟล์ด้วย `file://` เพราะระบบใช้ ES modules)

## GitHub Pages

สามารถอัปโหลด **เนื้อหาภายใน `pages-source/`** ไปที่ root ของ branch สำหรับ Demo ได้โดยตรง ระบบนี้ยังเป็น Local Demo และข้อมูลอยู่ใน Browser ของผู้ใช้ ไม่ใช่ Production database

ก่อนนำเสนอจริง ถ้าเครื่องพัฒนาติดตั้ง dependency ได้ ให้รัน Full Gate จาก root project:

```sh
npm ci
npm test
npm run build
npm run test:deployment
```

Decision Council v1 ไม่ส่งข้อมูลออกไป AI/API ภายนอก
