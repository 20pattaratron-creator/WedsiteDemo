# ERP DEMO 4.3.1 — Step 3B-4 Totals Boundary Extraction & Pagination Assessment

## เป้าหมาย

ลดโค้ดซ้ำของ Document Controller โดยย้ายเฉพาะการรวมยอดที่เป็น deterministic ออกจาก Delivery/Tax และ Receipt โดยไม่เปลี่ยน VAT source of truth, layout, pagination, PDF หรือ save workflow

## สิ่งที่เปลี่ยน

- `erp-shared-core.js` v1.3.0 → **v1.4.0**
- เพิ่ม `calculateDocumentTotals(items, vatOptions)`
- ลบ local `totals()` ออกจาก Delivery/Tax และ Receipt
- call-site ส่งเฉพาะ `items`, `vatNone`, `vatEnabled` ไม่ส่ง controller state ทั้งก้อน
- ใช้ `calculateVatSummary()` เดิมสำหรับ VAT ทุกโหมด

## Behavior ที่ล็อกด้วย Test

- VAT none: subtotal = item total, VAT = 0
- VAT add: VAT 7% ถูกบวกจาก subtotal
- VAT extract: แยกฐาน/VAT จากยอดรวมโดยใช้สูตร shared เดิม
- money parser ยังรองรับ comma และ rounding แบบเดิม
- controller ไม่มี local `totals()` หรือ direct `calculateVatSummary()` wrapper แล้ว

## ผลลด duplication

- Controller lines: 3,329 → **3301**
- Exact duplicate pairs: 9 → **8**
- Duplicate windows: 193 → **187**
- Cross-controller imports: **0**

## สิ่งที่ตั้งใจไม่แตะ

- `printableItems()`
- `paginateItems()`
- `documentPagesHtml()`
- DOM/PDF lifecycle
- Layout/CSS
- save workflow/source links

เหตุผลคือ pagination มีผลต่อการแบ่งหน้า PDF โดยตรง จึงต้องสร้าง page-partition regression harness ก่อน extraction รอบถัดไป
