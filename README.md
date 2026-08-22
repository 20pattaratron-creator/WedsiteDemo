# Example Company ERP — Clean Template

เวอร์ชันนี้เป็นชุดไฟล์ที่ลดความซ้ำซ้อนแล้วสำหรับพัฒนาและ Build ขึ้นเว็บ เช่น GitHub Pages

## ไฟล์หลักที่ต้องใช้

- `index.html` — หน้าเว็บหลักและฟอร์มทั้งหมด
- `style.css` — รูปแบบ UI หลัก
- `app.js` — Business Logic, Dashboard, Analytics และการจัดการข้อมูล
- `logo.png` — โลโก้บริษัทตัวอย่าง
- `firebase.config.js` — อ่านค่า Firebase จาก Environment Variables
- `firebase-auth.js` — ระบบ Login
- `firebase-bridge.js` — อ่าน/เขียนข้อมูลกับ Firestore
- `firebase-dashboard.js` — เชื่อมข้อมูล Dashboard กับ Firebase
- `firestore.rules` — Firestore Security Rules
- `google-drive.js` — การเชื่อม Google Drive ที่ระบบเรียกใช้
- `local-file-store.js` — การจัดเก็บไฟล์ฝั่งเครื่อง
- `click-fallback.js` — Fallback สำหรับ Event/ปุ่มบางส่วน
- `quotation-document.js/css` — เอกสารใบเสนอราคา
- `delivery-tax-document.js/css` — ใบส่งสินค้า / ใบกำกับภาษี
- `receipt-document.js/css` — ใบเสร็จรับเงิน
- `.env.example` — ตัวอย่างตัวแปร Environment
- `package.json` — Dependency และคำสั่ง Build
- `vite.config.js` — การตั้งค่า Vite
- `.gitignore` — ป้องกันไฟล์ที่ไม่ควร Commit

## เริ่มใช้งานสำหรับพัฒนา

1. ติดตั้ง Node.js 20.19 ขึ้นไป
2. รัน `npm install`
3. คัดลอก `.env.example` เป็น `.env.local`
4. ใส่ค่า Firebase ของโปรเจกต์ตัวเองใน `.env.local`
5. รัน `npm run dev`

## Build สำหรับนำขึ้นเว็บ

รัน:

```bash
npm run build
```

ไฟล์เว็บที่ Build แล้วจะอยู่ในโฟลเดอร์ `dist/`

> หมายเหตุ: อย่า Commit `.env.local` หรือ Secret/API credentials ที่ไม่ควรเปิดเผยขึ้น GitHub

## การปรับแต่งเวอร์ชัน Theme Logo

- UI หลักใช้โทนกรมท่า + ฟ้าอมเขียว + ชมพู + พื้นครีม ให้ใกล้เคียงโลโก้
- ใบส่งสินค้า / ใบกำกับภาษี ใช้ธีมสีฟ้า
- ใบเสร็จรับเงิน ใช้ธีมสีชมพู
- ใบเสนอราคาใช้เลขอัตโนมัติรูปแบบ `QTYYMMNN`
  - `QT` = Prefix ใบเสนอราคา
  - `YY` = ปี พ.ศ. 2 หลัก เช่น 2569 → `69`
  - `MM` = เดือน 2 หลัก เช่น สิงหาคม → `08`
  - `NN` = Running Number ของเดือน เริ่ม `01`
  - ตัวอย่าง: `QT690801`, `QT690802`, `QT690803`
- Running Number ใช้ร่วมกันทั้ง 2 สาขา เพื่อป้องกันเลขใบเสนอราคาซ้ำระหว่างสาขา
- ปีที่แสดงบนหน้าเว็บใช้รูปแบบ `พ.ศ. 2569 (ค.ศ. 2026)` ขณะที่ค่าปีภายในระบบยังเก็บเป็น ค.ศ. เพื่อไม่กระทบ Date, Storage และ Firebase


## Product Master และวิเคราะห์ฤดูกาลสินค้า

ระบบมี Product Master ตัวอย่างใน `app.js` (`PRODUCT_MASTER`) สำหรับ Auto-complete ชื่อสินค้า พร้อมรหัสและหมวดสินค้า ฟอร์มยังพิมพ์ชื่อสินค้าเองได้ ข้อมูล Analytics สามารถเลือกสินค้าเพื่อดูยอดรายเดือนและรายไตรมาส รวมถึงเดือน/ไตรมาสที่ขายดีที่สุดได้
