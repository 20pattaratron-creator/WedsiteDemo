# ERP DEMO 4.3.0 — Customer Trial Hardening

รุ่นนี้ยังเป็น Local/GitHub Pages Demo ไม่ใช่ Production หลายผู้ใช้

## ปรับปรุงหลัก
- ล็อก Issued Invoice/Receipt ไม่ให้ hard delete ผ่าน workflow ปกติ
- Customer/Supplier/Product ใช้ Archive/ปิดใช้งานแทน hard delete
- ปิด stored HTML/attachment URL surface หลักและบล็อก javascript:/data:text/html
- เปลี่ยน data-driven action ใน Order Flow / Production Core เป็น data-* + event delegation
- เพิ่ม best-effort same-browser write lease สำหรับ Quote/Invoice/Receipt
- แก้ issued-detail modal lifecycle `show` → `open`
- แยก Core quality gate ออกจาก Full release gate
- เพิ่มป้าย DEMO limitation บนหน้าเว็บ

## ข้อจำกัดที่ยังตั้งใจคงไว้
- localStorage/IndexedDB ไม่ใช่ multi-user database
- write lease ไม่ใช่ DB transaction และไม่กันคนละเครื่อง
- Role-based UX ไม่ใช่ server authorization
- เลขเอกสารยังไม่ atomic ข้ามอุปกรณ์

ใช้สำหรับทดลอง workflow/UX ด้วยข้อมูลทดลองเท่านั้น
