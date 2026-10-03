# ERP 4.3.1 Step 3B-4 — Document Controller Duplication Map

## Baseline หลัง extraction

- Controller รวม: **3301 บรรทัด**
- Same-name function pairs: **48**
- Exact same-name pairs: **8**
- Normalized duplicate 10-line windows: **187**
- Cross-controller imports: **0**

## เทียบ Step 3B-3

- Controller lines: 3,329 → **3301** (-28)
- Exact pairs: 9 → **8** (-1)
- Duplicate windows: 193 → **187** (-6)

## Pair breakdown

- `quotation-document.js` ↔ `delivery-tax-document.js`: same-name 2, exact 0
- `quotation-document.js` ↔ `receipt-document.js`: same-name 2, exact 0
- `delivery-tax-document.js` ↔ `receipt-document.js`: same-name 44, exact 8

## สิ่งที่ย้ายใน Step 3B-4

`totals()` ของ Delivery/Tax และ Receipt ถูกแทนด้วย `calculateDocumentTotals(items, {vatNone, vatEnabled})` จาก `erp-shared-core.js` และ VAT ยังใช้ `calculateVatSummary()` เป็น source of truth เดิม

## สิ่งที่ยังไม่ย้าย

`printableItems()` และ `paginateItems()` ยังอยู่ใน controller เพราะมีผลต่อ page partition/PDF page break โดยตรง จึงต้องมี page-level regression ก่อน extraction
