# ERP DEMO 4.3.1 — Step 3B-5 Page Partition Regression Harness

## เป้าหมาย

Step 3B-5 ไม่เปลี่ยน Runtime pagination แต่สร้าง regression harness ก่อนย้าย `printableItems()` และ `paginateItems()` ในอนาคต เพื่อแยก **การพิสูจน์พฤติกรรม** ออกจาก **การเปลี่ยน owner ของ runtime logic**

## สิ่งที่เพิ่ม

- `tests/page-partition-regression.test.cjs` ถูกเพิ่มเข้า canonical Core suite
- Test ดึง source ของ `printableItems()`, `paginateItems()` และ `documentPagesHtml()` จาก Delivery/Tax และ Receipt controller จริง แล้ว execute ด้วย pure dependencies เดิม
- เพิ่ม `DOCUMENT_PAGE_PARTITION_MATRIX_4_3_1_STEP3B5.json` เพื่อบันทึก invariant และเหตุผลที่ยัง defer extraction
- Document Controller duplication budget คง hard ceiling จาก Step 3B-4 ที่ 8 exact pairs / 187 normalized windows เพราะ runtime ไม่ได้เปลี่ยน

## Invariants ที่ล็อกแล้ว

1. ไม่มีรายการที่ printable ได้ ต้องสร้าง blank fallback 1 row และ 1 page
2. Page budget = 8 row-units; 8 units พอดีต้องอยู่หน้าเดียว
3. Row ถัดไปที่ทำให้เกิน 8 ต้องเริ่มหน้าใหม่
4. ข้อความหลายบรรทัด/ยาวต้องใช้ shared `estimateDocumentItemRowUnits()` ก่อนแบ่งหน้า
5. ทุก page ต้องไม่เกิน 8 units และรักษาลำดับรายการ
6. `documentPagesHtml()` ต้องส่ง `isFinalPage=false` ทุกหน้าก่อนหน้า และ `true` เฉพาะหน้าสุดท้าย
7. Delivery/Tax และ Receipt ต้องให้ partition signature เหมือนกันเมื่อรับ rows ชุดเดียวกัน

## เหตุผลที่ยังไม่ Extract Pagination

Step นี้ตั้งใจเป็น checkpoint ที่ Runtime byte-for-byte ไม่เปลี่ยนจาก Step 3B-4 หากย้าย pagination พร้อมกับสร้าง tests จะทำให้แยกสาเหตุยากเมื่อจำนวนหน้า PDF เปลี่ยน ดังนั้น Step 3B-6 จึงเป็น checkpoint ที่เหมาะกว่าในการเปลี่ยน owner ของ helper โดยใช้ Harness นี้เป็น guard

## Structural Baseline

- Controller lines: **3301**
- Exact duplicate pairs: **8 / 8**
- Normalized duplicate windows: **187 / 187**
- Cross-controller imports: **0**

## Runtime Scope

ไม่มีการแก้ Runtime business behavior, VAT, DOM, PDF, page budget, document CSS, save workflow หรือ source-link logic ใน Step 3B-5
