# Release Validation — ERP DEMO 4.0.0

## ผ่านใน environment นี้
- Codebase Audit: PASS
- AI-Agent Repo Security: PASS (HIGH 0 / MEDIUM 0)
- Product Experience tests: 6/6 PASS
- Core regression ที่ไม่พึ่ง DOM/IndexedDB: 53/53 PASS
- JavaScript syntax: ตรวจแยกทุกไฟล์ runtime ก่อน package
- Security baseline: PASS
- Deployment manifest: รวม module import ของ Product Experience

## Full Suite
การรัน `node --test tests/*.test.cjs` ใน environment นี้มีบางชุดรันไม่ได้ เพราะไม่มี `jsdom` และ `fake-indexeddb` ติดตั้งอยู่ ไม่ใช่ failure จาก business assertion ของ Product Experience

บนเครื่องพัฒนาที่มี network/package cache ให้รัน:
```bash
npm ci
npm test
npm run audit:code
npm run security:preflight
npm run build
npm run test:deployment
```

## Manual UAT ที่ต้องตรวจ
1. เปิดเว็บ → หน้า `งานของฉัน`
2. เปลี่ยน Role แล้วเมนูเปลี่ยนตามงาน
3. สลับโหมดง่าย/ขั้นสูง
4. อนุมัติ Quote จาก Approval Center → Quote เปลี่ยนเป็นอนุมัติ
5. อนุมัติ PO ร่าง → สถานะเปลี่ยนเป็นส่งคำสั่งซื้อแล้ว
6. เปิด Inventory → ตรวจ On Hand/Reserved/Available/Incoming
7. เปิด Customer Portal Preview → ไม่เห็น Cost/Profit
8. เปิด Quote → SO → Fulfillment → Delivery → Billing → Receipt และดู Workflow Ribbon
