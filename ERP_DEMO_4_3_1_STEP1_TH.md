# ERP DEMO 4.3.1 — ขั้นที่ 1.1 Correctness & Audit Truthfulness

เป้าหมายของ patch นี้คือทำฐาน 4.3 ให้ตรวจสอบได้ตรงกับของจริงมากขึ้นก่อนเพิ่มฟีเจอร์ใหม่

## สิ่งที่แก้

- จัด `package.json` และ `package-lock.json` ให้เป็น Package 2.3.1 / ERP 4.3.1 ตรงกัน
- Quote preview เลิกคำนวณ VAT ด้วย `.07` และใช้ `calculateVatSummary()` จาก Shared Core
- Business Rules/Trial seed ถ้า Master Data เดิมอ่านไม่ได้จะ **หยุด (fail closed)** แทนการตีความเป็นรายการว่าง
- การตรวจใบเสร็จซ้ำ ถ้าอ่านประวัติไม่ได้จะ **บล็อกการบันทึก** แทนการถือว่าไม่พบใบเสร็จซ้ำ
- ลบ dead branch `if (false && ...)` ใน Delivery/Receipt controller
- ยกเลิก truly-empty catches ใน runtime: critical path รายงาน error, best-effort path มีเหตุผลกำกับ
- Deep Auditor ตรวจ `.07`, dead branch, empty catch และ empty promise catch เพิ่มเติม
- Core Test Gate และ Core Evidence ใช้ `CORE_TEST_FILES` ชุดเดียวกัน
- Core Evidence ใช้ชื่อไฟล์ตาม release จริง ไม่ใช้ชื่อ `4_2` ค้างจากรุ่นเก่า
- Complexity Gate เพิ่มการเทียบ `app.js` กับ frozen baseline เพื่อห้ามไฟล์หลักโตเกิน baseline โดยไม่มีการตัดสินใจชัดเจน
- เพิ่ม Requirement/Traceability สำหรับ QA truthfulness และ fail-closed behavior

## ผลตรวจของขั้นนี้

- Syntax: 59 ไฟล์ / 0 syntax failure
- Core/Portable: 87/87 PASS
- Core Evidence: 87/87 PASS, scope `core-portable`
- Spec/Traceability: 32/32
- Codebase Audit: PASS
- Deep Static Audit: PASS
- Complexity Audit: PASS
- Agent/Repo Security: HIGH 0 / MEDIUM 0 / LOW 2
- Full Node Suite: 94 tests, 87 pass, 7 fail
- Full Suite classification: `environment_dependency` เพราะ environment นี้ไม่มี `jsdom` / `fake-indexeddb`

> 87/87 คือ Core/Portable scope เท่านั้น ไม่ใช่ Full Browser certification

## สิ่งที่ยังไม่แก้ในขั้นนี้

- DOM test harness ยังต้องยกระดับให้รองรับ ES Module แบบจริงเมื่อ dependency พร้อม
- `app.js` ยังมีขนาดใหญ่และต้องแยกทีละ domain
- CSS cascade / document-controller duplication ยังเป็น technical debt
- Production multi-user ยังต้องมี DB/Auth/RBAC/Transaction/Atomic numbering
