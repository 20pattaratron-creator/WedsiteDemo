# GitHub Pages Deployment — ERP DEMO 4.2.0

ใช้ ZIP `example-company-erp-demo-4.2-pages.zip` สำหรับ Static Demo

## วิธีอัป
1. สำรอง branch เดิมก่อน
2. ลบ runtime รุ่นเก่าที่ชื่อไม่อยู่ใน ZIP ใหม่ เพื่อลด stale-file risk
3. อัปไฟล์จาก ZIP 4.2 ทั้งชุดพร้อมกัน
4. เปิดหน้า `/deployment-check.html`
5. ต้องเห็นทุก runtime file เป็น HTTP 200 และ SHA-256 ตรงรุ่น
6. จากนั้นค่อยเปิด `index.html`

อย่าอัปเฉพาะ `app.js` หรือ `index.html` เพราะ ES module dependencies ต้องเป็นรุ่นเดียวกัน

## สิ่งที่ Pages ZIP ไม่รวม
- tests
- specs/engineering docs
- security scanners
- node_modules
- history
- developer evidence

สิ่งเหล่านี้อยู่ใน Full Source เท่านั้น
