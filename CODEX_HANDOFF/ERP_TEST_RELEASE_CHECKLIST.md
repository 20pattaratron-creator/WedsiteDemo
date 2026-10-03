# ERP Test / Audit / Release Checklist

## ก่อนแก้โค้ด
- [ ] ระบุ checkpoint ของ source ที่เปิดจริง
- [ ] `git status` สะอาดหรืออธิบาย local changes
- [ ] รัน baseline Core
- [ ] บันทึก baseline Full evidence
- [ ] รัน relevant audit baseline
- [ ] อ่าน architecture rule ของ subsystem ที่จะแก้
- [ ] ระบุ rollback point

## ระหว่างแก้
- [ ] แก้ทีละ boundary เล็ก
- [ ] เพิ่ม targeted test สำหรับ bug/invariant
- [ ] ห้ามเปลี่ยน business semantic พร้อม refactor ถ้าไม่จำเป็น
- [ ] ห้ามเพิ่ม direct financial `localStorage.setItem`
- [ ] ห้าม tolerant read ใน write/export critical path
- [ ] Local commit ก่อน cloud
- [ ] เพิ่ม audit guard ถ้า bug class มีโอกาสกลับมา

## Targeted Verification
- [ ] targeted unit/core tests
- [ ] transaction rollback test
- [ ] corrupted storage fail-closed test
- [ ] duplicate/idempotency test
- [ ] post-commit failure semantics test
- [ ] legacy/backward compatibility test (ถ้ามี schema migration)

## Quality Gates
- [ ] Syntax audit
- [ ] Core suite
- [ ] Codebase audit
- [ ] Deep audit
- [ ] Specification audit
- [ ] Complexity audit
- [ ] Document Controller audit
- [ ] Financial Controls audit
- [ ] Render Golden audit
- [ ] Security Preflight
- [ ] Security Baseline
- [ ] Full evidence

## Full Evidence Rule
- [ ] ถ้ามี `environment_dependency` ให้แยกจาก business failure
- [ ] ห้ามเขียนว่า Full PASS ถ้ายังมี environment dependencies
- [ ] command timeout ≠ PASS/FAIL; ต้อง rerun แยก gate

## Deployment / Package
- [ ] Runtime manifest regenerated
- [ ] HTML refs complete
- [ ] Source↔Pages hash mismatch = 0
- [ ] HTTP smoke ผ่านทุก runtime file + deployment-check
- [ ] Source ZIP `unzip -t` PASS
- [ ] Pages ZIP `unzip -t` PASS
- [ ] แตก Source ZIP แล้ว rerun Core
- [ ] แตก Source ZIP แล้ว rerun Security Baseline
- [ ] แตก Pages ZIP แล้ว compare runtime hashes
- [ ] แตก Pages ZIP แล้ว rerun HTTP smoke
- [ ] สร้าง SHA-256 ภายนอก ZIP
- [ ] Final validation report อ้างแพ็กเกจจริง

## Stable Release Rule
ประกาศ Stable ได้ต่อเมื่อ:
- [ ] ไม่มี business/core failure
- [ ] security HIGH=0 และ MEDIUM=0 (หาก policy เดิมยังใช้)
- [ ] financial/document/render gates ผ่าน
- [ ] package verification ผ่าน
- [ ] known limitations ระบุชัด
