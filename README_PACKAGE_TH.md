# ERP 4.3.1 — ALL CODE PACKAGE

แพ็กเกจนี้รวม Source Code ที่ปิด Stable ล่าสุดซึ่งมีอยู่จริงใน workspace ณ วันที่ 2026-09-19

## ฐานของแพ็กเกจ
- ERP 4.3.1 Step 4A — Financial Governance & Reliability Foundation Stable
- รวม source code, tests, audit scripts, configuration และ release documentation ที่อยู่ใน Stable Source
- เพิ่มโฟลเดอร์ `CODEX_HANDOFF/` สำหรับใช้ส่งต่องานไป Codex

## สิ่งที่ไม่รวม
- Step 4B Working State ไม่ถูกรวม เพราะยังไม่เคยปิดเป็น Stable package และไม่มี complete working source tree ที่ยืนยันได้ใน workspace ปัจจุบัน
- ไม่รวม ZIP รุ่นเก่า/โฟลเดอร์ verification ชั่วคราวที่ซ้ำซ้อน

## วิธีเริ่มใช้งาน
1. แตก ZIP นี้
2. เปิดโฟลเดอร์ `example-company-erp-demo-4.3.1`
3. อ่าน `CODEX_HANDOFF/README_HANDOFF_TH.md`
4. ถ้าใช้ Codex ให้วางเนื้อหา `CODEX_HANDOFF/CODEX_START_PROMPT.md` เป็น prompt แรก
5. ก่อนแก้โค้ด ให้รัน test/audit ตาม `CODEX_HANDOFF/ERP_TEST_RELEASE_CHECKLIST.md`

## ข้อควรจำ
แพ็กเกจนี้เป็น Customer Trial / Local Demo baseline ไม่ใช่ Production backend ที่มี server-side RBAC, database tenant isolation, atomic cross-device numbering หรือ e-Tax submission จริง
