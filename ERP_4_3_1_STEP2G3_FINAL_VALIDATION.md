# ERP 4.3.1 — Step 2G-3 Final Validation

- Step: **Expense Action Boundary**
- Status: **CUSTOMER_TRIAL_STABLE_CORE_VALIDATED_FULL_ENV_BLOCKED**
- Core portable: **189/189 PASS**
- Full Node/DOM: **189/196** · `environment_dependency`
- Syntax: **71 checked / 0 failed**
- Codebase / Deep / Spec / Complexity: **PASS**
- Security: **PASS** · HIGH 0 · MEDIUM 0 · LOW 2 (review-only เดิม)
- Runtime manifest: **46 files** · Source↔Pages hash mismatch **0**
- HTTP smoke: **47/47 PASS**

## Expense invariants validated

1. Expense create ใช้ `validate → plan → commit → after_commit` ผ่าน central Action Runner
2. Local Expense write ใช้ strict financial pack และ rollback-capable write session; corrupted JSON ห้ามกลายเป็น empty store
3. จำนวนเงินต้อง > 0 และ taxonomy ของ `docType`, `taxStatus`, `purpose` ต้องถูกต้อง
4. สถานะ `received` ต้องเป็นประเภทเอกสารใบกำกับภาษีและต้องมีเลขเอกสาร
5. เลขเอกสารซ้ำของร้านค้า/ผู้ขายเดียวกันภายในปีหยุดก่อน commit และ duplicate scan ใช้ strict storage
6. Received tax document ที่ยังไม่มีไฟล์แนบคืน warning โดยไม่ปลอมว่า Local save ล้ม
7. Expense save ใช้ same-browser write lease
8. Cloud save failure ที่มีหลักฐานจะ retry เก็บไฟล์ผ่าน LocalFileStore/IndexedDB fallback
9. Evidence fallback และ Cloud-success local-cache update ใช้ strict financial read ไม่ใช้ tolerant `loadFor()`
10. Cloud สำเร็จแต่ local cache update ล้มถูกรายงานเป็น post-commit/local-cache warning ไม่ย้อนกลับไปอ้างว่า Cloud save ล้ม

## Scope decision

Expense form รุ่นนี้ยังไม่มี Edit Expense และไม่มีช่องฐานภาษี/VAT amount แยก Step 2G-3 จึงไม่เพิ่ม Edit/Void lifecycle หรือสูตร Input VAT โดยเดาเอง งานดังกล่าวต้องออกแบบเป็น Accounting/Tax lifecycle แยกภายหลัง

## Audit truthfulness

Full suite ยังไม่ถูกเรียกว่า Full PASS เพราะ 7 tests ถูกจัดเป็น environment dependency จาก `jsdom` / `fake-indexeddb` ใน environment นี้ ไม่ใช่ Business Logic failure ของ Step 2G-3

> หมายเหตุ: SHA-256 ของ ZIP ถูกเก็บใน bundle manifest ภายนอก ZIP เพื่อหลีกเลี่ยง self-referential checksum; archive integrity ถูกตรวจอีกครั้งหลังสร้างแพ็กเกจตัวสุดท้าย
