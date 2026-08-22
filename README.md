# Comform ERP — Clean Version

เวอร์ชันนี้ตัดไฟล์คู่มือเก่า ไฟล์ทดสอบ ข้อมูลนำเข้าทดลอง และไฟล์สำรองที่ไม่จำเป็นออกแล้ว เหลือเฉพาะไฟล์ที่ใช้กับเว็บไซต์ ระบบเอกสาร Preview/PDF, Firebase, Google Drive และการ Build ด้วย Vite

## เริ่มใช้งาน

```bash
npm install
npm run dev
```

Build สำหรับ Deploy:

```bash
npm run build
```

ไฟล์ที่ Build แล้วจะอยู่ใน `dist/`

## กลุ่มไฟล์หลัก

- `index.html`, `style.css`, `app.js` — หน้าเว็บและ Business Logic หลัก
- `integrated-documents.*` — Preview/PDF แบบฝั่งขวาของฟอร์ม
- `delivery-tax-document.*` — ใบส่งสินค้า / ใบกำกับภาษี
- `receipt-document.*` — ใบเสร็จรับเงิน
- `firebase-*.js`, `firebase.config.js`, `firestore.rules` — Firebase / Authentication / Firestore
- `google-drive.js` — เชื่อม Google Drive
- `local-file-store.js` — จัดการไฟล์ฝั่ง Local
- `logo.png` — โลโก้ที่ใช้งานจริง
- `package.json`, `vite.config.js` — Build/Development
- `.env.example`, `.gitignore` — ตัวอย่าง Environment และ Git settings

> ก่อนนำขึ้น GitHub Pages แนะนำให้ใช้ `npm run build` แล้ว Deploy โฟลเดอร์ `dist/`


## Preview/PDF static-hosting fix
- แก้ `integrated-documents.js` ไม่ให้ใช้ bare import ของ `html2canvas`/`jspdf` ซึ่ง Browser บน GitHub Pages/Live Server resolve ไม่ได้
- Preview HTML ทางขวาโหลดได้โดยไม่ต้องรอ PDF library
- `html2canvas` และ `jsPDF` โหลดเป็น browser globals จาก CDN เฉพาะสำหรับการสร้าง PDF
- เพิ่ม retry อัตโนมัติและปุ่มลองโหลด Preview ใหม่
