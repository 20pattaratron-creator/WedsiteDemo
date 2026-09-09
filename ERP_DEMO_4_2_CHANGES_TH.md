# ERP DEMO 4.2.0 — Specification & Quality Governance Release

Package 2.2.0 · 8 กันยายน 2569

## เป้าหมาย
ลดความเสี่ยงจากการพัฒนาเร็ว/AI-assisted development โดยทำให้ Requirement, Source of Truth, Workflow, Tests และ Release Evidence เชื่อมกันชัดเจน พร้อมปิด regression ที่พบใน 4.1 RC

## แก้ไขความเสี่ยงจาก 4.1 RC

1. ซ่อม Test Harness เก่าที่อ่าน ES Module เป็น classic script จนเกิด `Cannot use import statement outside a module`
2. Integrity regression กลับมาทดสอบได้ครบ Payment / Delivery / Stock / Billing / VAT / Cost
3. แก้ SO → Delivery preparation ที่เคยมีตัวแปร `due` เก่าหลงเหลือหลัง refactor และอาจเกิด ReferenceError
4. ใช้ Business Date helper สำหรับ date-only logic แทน UTC date parsing
5. Decision Council เปรียบเทียบ due/required dates ด้วย `businessDateOrdinal()`
6. Product UX อ่านปี/เดือนของ date-only โดยไม่พึ่ง UTC parsing
7. Release metadata ของ audit/build script ถูกดึงจาก `package.json`

## Spec-driven foundation

เพิ่ม:
- `specs/constitution/ERP_CONSTITUTION.md`
- Spec ของ Order-to-Cash, Inventory, Money/Tax, Security และ Quality
- `specs/TRACEABILITY.json`
- `specs/FEATURE_CHANGE_TEMPLATE.md`
- ADR 5 ฉบับใน `docs/decisions/`

ปัจจุบันมี Requirement IDs 28 รายการ และ Traceability 28 รายการ

## Context Ledger

เพิ่ม `DEVELOPMENT_CONTEXT.json` เพื่อเก็บ:
- release/package ปัจจุบัน
- source of truth
- งานที่เสร็จแล้ว
- technical debt ที่ยังเปิดอยู่
- กฎ `doNotRegress`

เป้าหมายคือไม่ให้ Coding Agent/Developer กลับไปใช้ decision เก่าหลัง context ยาวหรือมีการ handoff

## Complexity / Minimal-change Gate

เพิ่ม `QUALITY_BUDGET.json` และ `npm run audit:complexity`

Baseline ปัจจุบัน:
- Runtime JS 25 ไฟล์
- Runtime JS ~15.4k lines
- Root JS 26 ไฟล์
- `app.js` 8,256 lines
- Dev dependencies 3
- direct `window.* =` assignments 51
- inline handler function names 102

ถ้าเกิน Hard Budget ต้อง refactor หรือมี ADR แทนการเพิ่มความซับซ้อนโดยเงียบ ๆ

## Evidence-based QA

เพิ่ม `npm run evidence:core`

Output:
- `evidence/CORE_TESTS_4_2.tap`
- `evidence/CORE_TEST_EVIDENCE_4_2.json`

เพื่อให้ Release มี execution evidence ไม่ใช่เพียงคำบอกว่า "AI ตรวจแล้วผ่าน"

## สิ่งที่ตั้งใจไม่ทำ

- ไม่เพิ่ม Framework AI/MCP/Agent ลง Runtime ERP
- ไม่รวม Delivery/Receipt controller เพียงเพื่อให้ duplicate metric เป็นศูนย์
- ไม่ rewrite `app.js` ทั้งไฟล์ในรอบเดียว
- ไม่ถือ UX Role เป็น Production authorization
- ไม่ถือ Full DOM suite ว่าผ่านเมื่อ dependency ติดตั้งไม่ครบ
