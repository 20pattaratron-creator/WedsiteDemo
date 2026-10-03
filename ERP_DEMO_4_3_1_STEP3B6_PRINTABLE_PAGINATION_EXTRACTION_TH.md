# ERP DEMO 4.3.1 — Step 3B-6 Printable Items + Pagination Extraction

## เป้าหมาย

Step 3B-6 เปลี่ยน owner ของการเลือกแถวที่พิมพ์ได้และการแบ่งหน้า จาก local functions ที่ซ้ำกันใน Delivery/Tax และ Receipt ไปเป็น pure shared primitives ใน `erp-shared-core.js` หลังจาก Step 3B-5 ล็อก behavior ด้วย Page Partition Regression Harness ก่อนแล้ว

## Runtime ที่เปลี่ยน

เพิ่ม Shared Core exports:

- `selectPrintableDocumentItems(items)`
- `paginateDocumentItems(items, options)`

`SHARED_CORE_VERSION` เปลี่ยนจาก `1.4.0` เป็น `1.5.0`

Controller ทั้งสอง import alias เดิม:

- `selectPrintableDocumentItems as printableItems`
- `paginateDocumentItems as paginateItems`

และส่ง `state.items` กับ `ITEM_UNITS_PER_PAGE` เข้าไป explicit แทนการให้ Shared Core อ่าน controller state

## Invariants ที่ต้องคงเดิม

Page Partition Harness 11 tests ยังคงตรวจ:

- ไม่มีรายการ -> blank printable row 1 แถว / 1 page
- 8 units พอดีอยู่หน้าเดียว
- unit ที่ 9 ขึ้นหน้าใหม่
- multiline/long text ใช้ row-unit estimator เดิม
- ทุกหน้าไม่เกิน 8 units
- ลำดับรายการไม่เปลี่ยน
- final-page metadata ถูกต้อง
- Delivery/Tax และ Receipt partition เหมือนกันเมื่อ input เหมือนกัน

## สิ่งที่ยังคงแยก

ยังไม่ Shared:

- `documentPagesHtml()`
- `documentPageHtml()`
- `renderPreview()`
- `waitForPdfStageAssets()`
- DOM/PDF lifecycle
- layout/CSS และ signature/footer rules

เหตุผลคือส่วนเหล่านี้เริ่มเป็น document presentation/lifecycle context ไม่ใช่ pure page partition

## ผลลด Duplication

- Controller lines: **3,301 -> 3255**
- Same-name pairs: **48 -> 46**
- Exact duplicate pairs: **8 -> 6**
- Normalized duplicate windows: **187 -> 164**
- Cross-controller imports: **0**

Duplication budget ถูกลดตามผลจริงเป็น **6 exact pairs / 164 windows**

## ผลทดสอบก่อนแพ็ก

- Core: **210/210 PASS**
- Full Node/DOM: **210/217**, 7 รายการเป็น `environment_dependency` เดิม
- Code/Deep/Spec/Complexity/Document/Security audits: PASS
- Runtime: 31 JS modules
- `app.js`: 8,240 lines
- Runtime lines: 16,837
- Security: HIGH 0 / MEDIUM 0 / LOW 2 เดิม

## ขอบเขต

Step นี้ไม่เปลี่ยน VAT formula, save workflow, storage contracts, PDF styling, page HTML หรือ document-specific layout.
