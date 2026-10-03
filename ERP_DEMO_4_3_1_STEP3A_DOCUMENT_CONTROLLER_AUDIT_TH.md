# ERP DEMO 4.3.1 — Step 3A Document Controller Duplication Audit & Shared Boundary Design

## เป้าหมาย

Step 3A **ยังไม่รวม controller** ของใบเสนอราคา ใบส่งสินค้า/ใบกำกับภาษี และใบเสร็จรับเงินเข้าด้วยกัน จุดประสงค์คือสร้าง baseline ที่วัดซ้ำได้ก่อน refactor เพื่อให้ Step 3B ลด duplication อย่างมีหลักฐานและไม่สร้าง Mega Controller ใหม่

## Controller ที่ตรวจ

- `quotation-document.js`
- `delivery-tax-document.js`
- `receipt-document.js`

ผล baseline ปัจจุบัน:

- Controller รวม **3,580 บรรทัด**
- Same-name function pairs: **69 คู่**
- Exact same-name function pairs: **27 คู่**
- Normalized duplicate 10-line groups: **275 กลุ่ม**
- Cross-controller imports: **0**

คู่ที่ซ้ำหนักที่สุดคือ `delivery-tax-document.js` ↔ `receipt-document.js` ส่วน Quotation แชร์ helper พื้นฐานเพียงบางส่วน

## สิ่งที่เพิ่มใน Step 3A

1. `scripts/audit-document-controllers.mjs` — audit เฉพาะ document controllers
2. `DOCUMENT_CONTROLLER_DUPLICATION_BUDGET.json` — baseline ceiling; จากนี้ duplication ห้ามเพิ่มแบบเงียบ ๆ
3. `DOCUMENT_CONTROLLER_DUPLICATION_AUDIT_RESULTS.json` — ผล audit ที่สร้างซ้ำได้
4. `tests/document-controller-duplication.test.cjs` — regression guard
5. ผูก `audit:documents` เข้า `quality:core`, `audit:all` และ Customer Trial Release Closure
6. `DOCUMENT_CONTROLLER_BOUNDARY_4_3_1_STEP3A.json` — แผน extraction ทีละชั้น

## กลุ่มที่เหมาะกับการแยกก่อนใน Step 3B

### A. Pure / Value helpers

เหมาะเป็นก้อนแรก เพราะไม่ควรเป็นเจ้าของ DOM หรือ document workflow:

- `escapeHtml`
- `parseMoney`
- `fmt`
- `formatDate`
- `thaiIntegerText`
- `bahtText`
- `safeFilename`

### B. Generic helpers ที่ต้องมี edge-case tests ก่อน

- `getNestedValue`
- `setNestedValue`
- `resolveStoragePeriod`

### C. Contextual helpers — ยังไม่ควรย้ายทันที

แม้บาง body เหมือนกัน แต่ยังจับ controller state/DOM:

- `totals`
- `getLockedBranch`
- `addItem` / `removeItem`
- `printableItems`
- `itemRowUnits`
- `paginateItems`
- `documentPagesHtml`
- `waitForPdfStageAssets`

## สิ่งที่ตั้งใจ “ไม่รวม”

ต่อให้โค้ดคล้ายกันก็ยังควรแยกตามเอกสารจนกว่าจะมีหลักฐานชัดเจน:

- `documentPageHtml`
- `renderAppShell`
- `validateBeforeSave`
- `saveDocumentToSystem`
- Source-link logic ของ Production/Invoice
- Layout ของตาราง ลายเซ็น สำเนา/ต้นฉบับ
- CSS/print class ของแต่ละเอกสาร

เหตุผลคือความเหมือนด้านโครงสร้างไม่ได้แปลว่ามี business invariant เดียวกัน การรวมเพื่อลดบรรทัดอย่างเดียวเสี่ยงสร้าง Mega Controller ที่แก้เอกสารหนึ่งแล้วอีกเอกสารพัง

## Quality Rule ใหม่

Step 3A ตั้ง ceiling:

- `normalizedDuplicate10LineGroups <= 275`
- `exactSameNameFunctionPairs <= 27`
- `crossControllerImports = 0`

ค่าพวกนี้เป็น **เพดาน ไม่ใช่เป้าหมาย** Step 3B เป็นต้นไปควรลดลง ไม่ควรเพิ่ม

## Runtime Impact

Step 3A เป็น architecture/audit checkpoint เท่านั้น จึงตั้งใจ **ไม่เปลี่ยน runtime controller behavior** และไม่เพิ่ม runtime module ใหม่ เป้าหมายคือให้ Step 3B เริ่ม extraction จาก baseline ที่พิสูจน์ได้
