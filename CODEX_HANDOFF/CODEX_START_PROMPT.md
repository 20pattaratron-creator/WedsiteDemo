# Prompt สำหรับเริ่มทำงานใน Codex

คุณกำลังรับช่วงพัฒนาโปรเจกต์ **ERP 4.3.1 Customer Trial / DEMO** ต่อจาก ChatGPT

อ่านไฟล์เหล่านี้ก่อนแก้โค้ด:
1. `README_HANDOFF_TH.md`
2. `CODEX_HANDOFF_MASTER.md`
3. `ERP_ARCHITECTURE_RULES.md`
4. `STEP4B_WORK_IN_PROGRESS.md`
5. `FILES_TO_READ_FIRST.md`
6. `ERP_TEST_RELEASE_CHECKLIST.md`

## กฎสำคัญ
- อย่าสมมติว่า repository ที่เปิดอยู่เป็น Step 4A/4B ให้ verify จาก source/tests/docs ก่อน
- Stable checkpoint ล่าสุดตาม handoff คือ **Step 4A Financial Governance & Reliability Foundation Stable**
- Step 4B เป็น WIP และ **ห้ามประกาศ Stable** จนกว่าจะปิด Backup fail-closed gap และผ่าน package-level closure
- Financial/Operational critical read/write/export ต้อง fail-closed
- `corrupted != empty`
- Local source-of-truth commit ต้องมาก่อน external/cloud side effects
- ใช้ transaction/rollback สำหรับ multi-key mutation เมื่อมี `ERPIntegrity.transaction`
- Outbox/idempotency ต้อง deterministic; `synced` ห้าม resend; ambiguous interrupted sync ใช้ `uncertain` และห้าม blind auto-retry
- Printable/issued document ห้ามสร้างหรือเปลี่ยน accounting truth
- Period Lock/Approval/Audit ต้องรักษา append-only/atomic evidence semantics
- Backup export ต้อง strict ทุก subsystem และ Restore verify SHA ก่อน write
- ห้ามสร้าง Mega Controller หรือยัด Governance logic กลับเข้า `app.js`
- ห้ามอ้าง Full PASS หากยังมี `jsdom/fake-indexeddb` environment dependencies
- ถ้าคำสั่ง timeout ให้แยกรัน ไม่ตีความ timeout เป็น PASS/FAIL

## งานแรก: Source Acquisition Protocol
ก่อนแก้ไฟล์ใด ๆ ให้ทำ:
1. ตรวจ `git status`, branch, repository root และรายการไฟล์
2. อ่าน `package.json` scripts
3. ค้นหา `erp-governance-core.js`, `erp-governance.js`, `erp-production-core.js`, `erp-order-flow.js`
4. ค้นหา release docs/validation ที่มีอยู่
5. รัน baseline Core suite
6. รัน audit gates ที่มีอยู่
7. รายงานให้ฉันว่า source นี้ตรงกับ Step 4A Stable / Step 4B WIP / หรือไม่ตรงกับ handoff อย่างไร
8. ห้ามเริ่ม patch หากยังไม่ทราบ baseline

## งานพัฒนาลำดับแรก: Step 4B Backup Fail-Closed Boundary
ตรวจ line-by-line:
- `collectBackupData()` และ business document pack export
- `ERPProductionCore.exportData()`
- PO / GR / Inventory movement export/readers
- `ERPOrderFlow.exportData()`
- backup schema/checksum/restore path

เป้าหมาย:
- corrupted business/production/order-flow store ต้องทำให้ backup abort
- ต้องไม่ตีความ corrupted JSON เป็น `[]`
- error ต้องระบุ subsystem/key ที่เสียได้พอสำหรับ debug
- Backup artifact ต้องไม่ถูกถือว่า success ถ้า source subsystem ใดอ่านไม่ได้
- valid backup ต้องยังสร้าง checksum และ restore verify ได้
- legacy compatibility ต้องไม่ทำให้ v4+ checksum rules อ่อนลง

เพิ่ม targeted regression tests ก่อน/พร้อม fix อย่างน้อย:
1. corrupted business pack → abort
2. corrupted production/PO/GR/inventory → abort
3. corrupted order flow → abort
4. valid backup → checksum valid
5. tampered backup → restore abort before mutation

หลัง targeted tests ผ่าน:
- รัน Core ทั้งระบบ
- รัน Full evidence
- รัน Code/Deep/Spec/Complexity/Document/Financial/Render/Security audits
- review diff line-by-line

ถ้า Step 4B ผ่านทั้งหมด ให้ทำ package closure ตาม `ERP_TEST_RELEASE_CHECKLIST.md` แล้วสร้าง Source + Pages ZIP ใหม่เท่านั้นหลัง verification จาก ZIP ที่แตกกลับออกมาผ่านจริง

## วิธีรายงาน
ทุก checkpoint ให้บอก:
- files changed
- invariants protected
- tests added
- baseline → new test counts
- audit results
- known limitations
- rollback point
- ถ้ายังไม่ Stable ให้พูดว่า WIP ตรง ๆ

อย่ารีบทำ CSS/Design System หรือ feature ใหม่ก่อนปิด Step 4B Data Integrity blocker นี้
