# เผยแพร่ ERP DEMO 4.0.0 บน GitHub Pages

แนะนำให้ใช้ ZIP **Pages/Static 4.0.0** ที่จัดแยกจาก Full Source เพื่อไม่ให้ tests, security tools, history และ source-only files ปะปนกับเว็บที่ลูกค้าเปิดดู

## วิธีอัปโหลด
1. สำรอง branch เว็บไซต์ปัจจุบันก่อน
2. แตก ZIP Pages 4.0.0 แล้วอัปโหลดไฟล์ทั้งหมดที่รากของ branch สำหรับ GitHub Pages
3. อย่าผสม `index.html` ของ 4.0 กับ JavaScript/CSS รุ่นเก่า
4. เปิด `deployment-check.html` หลัง deploy แล้วกดตรวจ SHA-256
5. รีเฟรชแบบ Hard Refresh (`Ctrl+Shift+R`) หลังอัปเดต

## ไฟล์สำคัญของ 4.0
- `index.html`
- `erp-product-experience.js`
- `erp-product-experience-core.js`
- `erp-product-experience.css`
- Runtime ERP/document modules ที่ `deployment-check.html` ระบุ
- `.nojekyll`

## สิ่งที่ควรเห็นเมื่อเปิดเว็บ
- หน้าแรก `งานของฉัน`
- ตัวเลือกมุมมอง ผู้บริหาร / ฝ่ายขาย / จัดซื้อ / คลัง / บัญชี / Admin
- ปุ่ม `โหมดง่าย` / `โหมดขั้นสูง`
- เมนู `ศูนย์อนุมัติ`
- เมนู `พอร์ทัลลูกค้า (Preview)`
- หน้า Stock มี On Hand / Reserved / Available / Incoming PO

> Role และ Portal ใน DEMO 4.0 เป็น UX Preview เท่านั้น ไม่ใช่ระบบสิทธิ์/Portal ฝั่ง Server สำหรับข้อมูลจริง
