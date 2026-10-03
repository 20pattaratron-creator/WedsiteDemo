# ERP DEMO 4.3.1 — Step 2E: Invoice / Receipt Action Boundary

## เป้าหมาย

Step 2E ต่อจาก Step 2D โดยย้ายกฎสำคัญของ Invoice และ Receipt เข้าสู่ `erp-document-finance-core.js` ซึ่งเป็น pure action planner และทำให้เส้นทางเขียนเอกสารการเงินอ่าน Storage แบบ fail-closed แทนการตีความข้อมูลเสียว่าเป็น store ว่าง

## ปัญหาที่พบก่อนแก้

1. `loadFor()` เหมาะกับ read UI เพราะคืน empty store เมื่อ JSON เสีย แต่ไม่เหมาะกับ financial write เพราะ Save ใหม่อาจเขียนทับข้อมูลทั้งเดือน
2. Invoice ที่รับเงินจริงแล้วเดิมยังแก้ยอด/รายการได้ ตราบใดที่ยอดใหม่ไม่ต่ำกว่าเงินที่รับ ซึ่งยังเปิดโอกาสให้ประวัติทางการเงินเปลี่ยนหลัง Settlement
3. Receipt มี guard กระจายทั้ง UI และ `erp-integrity.js` แต่ยังไม่มี pure action plan ที่แยก validation ก่อน persistence
4. `reconcilePayments()` เดิมเขียน Invoice packs และ Order Flow ทีละ key หาก write หลังล้มอาจเกิด state ครึ่งหนึ่ง
5. Invoice create + link Production/Quotation ใน Local Demo เดิมใช้หลาย `saveFor()` แยกกัน

## Architecture หลัง Step 2E

```text
Invoice / Receipt Form
        │
        ▼
app.js orchestration
        │
        ├── strict financial pack read
        │
        ▼
erp-document-finance-core.js
  ├── planInvoiceDocumentAction()
  ├── planReceiptDocumentAction()
  ├── parseFinancialDocumentPackForWrite()
  └── invoiceFinancialFingerprint()
        │
        ▼
ERPIntegrity / transaction boundary
        │
        ▼
localStorage + optional cloud side effect
```

## Invariants ที่เพิ่ม

### Invoice
- เลขเอกสารซ้ำ = `conflict_error`
- new Invoice ไม่เชื่อ `paid/isPaid/paymentStatus` จาก form; เริ่ม settlement เป็น pending เสมอ
- เมื่อมี `paymentSummary.paid > 0` แล้ว ห้ามแก้เลขที่ วันที่ สาขา ลูกค้า รายการสินค้า ยอด VAT/Total ต้นทุน/Commission
- metadata ที่ไม่กระทบยอด เช่น note สามารถแก้ได้ และ settlement fields เดิมต้องถูก preserve
- lineage ไป Production / Quote / Sales Order ต้องไม่ถูก form overwrite ระหว่าง edit

### Receipt
- เลข Receipt ซ้ำ = `conflict_error`
- Receipt ที่อ้าง Invoice แต่หา Invoice ไม่พบ = `dependency_error`
- ลูกค้า/สาขา/เลข Invoice/ID ต้องตรง reference
- ยอด Receipt ห้ามเกิน current outstanding
- Edit Receipt ห้ามเปลี่ยน Invoice reference
- Receipt ที่สร้างจาก Payment ห้ามแก้ในฟอร์ม manual = `permission_error`

### Storage / Commit
- malformed `biz2_*` JSON หรือ collection shape ผิด = `storage_error`
- financial write ห้าม fallback เป็น empty pack
- `reconcilePayments()` รวม changed Invoice packs + Order Flow เป็น transaction เดียวที่ rollback ได้
- Local Demo new Invoice + source Production/Quote linkage ใช้ multi-key write session เดียว

## Stateful Benchmark ที่เพิ่ม

- paid invoice financial mutation → blocked
- metadata-only edit after payment → allowed, settlement preserved
- receipt overpayment → blocked before persistence
- reference mismatch / missing reference → blocked
- payment-generated receipt manual edit → blocked
- corrupted financial pack → no empty overwrite
- failed second key during settlement reconciliation → first key rolled back

## Scope ที่ยังไม่แตะ

- ยังไม่รวม Quotation / Production controller เป็น mega controller
- ยังไม่ refactor CSS
- ยังไม่ทำ server transaction / atomic numbering ข้าม device
- Cloud write ยังเป็น optional side effect ของ Local Demo ไม่ใช่ distributed transaction
- Full DOM suite ยังขึ้นกับ `jsdom` / `fake-indexeddb`
