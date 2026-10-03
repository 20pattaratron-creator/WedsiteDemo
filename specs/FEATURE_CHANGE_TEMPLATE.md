# Feature Change Template

## 1. Intent
ปัญหาที่ผู้ใช้ต้องการแก้คืออะไร และเหตุใดต้องทำตอนนี้

## 2. Scope / Non-scope
ระบุสิ่งที่ทำและสิ่งที่ตั้งใจไม่ทำ เพื่อกัน feature creep

## 3. Requirements
ใช้รหัส `REQ-<DOMAIN>-NNN` และเขียนพฤติกรรมที่ตรวจสอบได้

## 4. Acceptance Criteria
รูปแบบแนะนำ:
- WHEN ... AND ... THEN THE SYSTEM SHALL ...
- Negative/edge cases ต้องระบุด้วย

## 5. Existing Capability Check
ก่อนเพิ่มไฟล์/helper/dependency ใหม่ ให้ตอบ:
- Shared Core เดิมทำได้หรือไม่
- Module เดิมมี function ใกล้เคียงหรือไม่
- Browser/native API ทำได้หรือไม่
- การ reuse จะทำ coupling แย่กว่าการแยกหรือไม่

## 6. Design / Data / Security Impact
ระบุ storage/schema/workflow/permission/tenant/branch/backup impact

## 7. Test Plan
Requirement ID → unit/integration/DOM/E2E/manual evidence

## 8. Rollback / Migration
หาก persisted data เปลี่ยน ต้องมี migration และ rollback

## 9. Release Evidence
แนบผล audit/test/security/deployment ที่ยืนยันว่าการเปลี่ยนแปลงผ่าน gate
