# ERP DEMO 4.3.1 — Step 2G-2 Production Action Boundary

## เป้าหมาย

Step 2G ถูกแบ่งเป็นก้อนย่อยเพื่อไม่ให้ Quotation, Production และ Expense เปลี่ยนพร้อมกัน รอบนี้ทำเฉพาะ Production และยึด pattern เดียวกับ Quote / Invoice / Receipt:

`validate → plan → commit → after_commit`

เป้าหมายหลักคือทำให้ใบสั่งผลิตเป็น write workflow ที่ fail-closed และรักษาความสัมพันธ์ระหว่าง Production, Quote, Sales Order, Supplier settlement และ Invoice ให้คงที่เมื่อเอกสารถูกใช้งานต่อแล้ว

## สิ่งที่เปลี่ยน

1. `saveProduction()` กลายเป็น write-lease wrapper และย้าย implementation ไป `saveProductionUnlocked()`
2. `saveProductionUnlocked()` ใช้ `runDocumentAction()` แยก validate / plan / commit / after_commit
3. เพิ่ม `planProductionDocumentAction()` และ `productionCommercialFingerprint()` ใน `erp-document-finance-core.js`
4. Production create/edit ใช้ strict `biz2_*` write path แทน tolerant `loadFor()`
5. เพิ่ม `productionNumberExistsForWrite()` ให้เลข Production ซ้ำ fail-closed เมื่อ history อ่านไม่ได้
6. `findLocalRecordForDocumentWrite()` และ `commitDocumentEdit()` ถือ `productions` เป็น strict financial/document collection
7. Local Demo create ที่มี source Quote ใช้ `createFinancialDocumentWriteSession()` เดียวเพื่อ commit Production + Quote workflow link พร้อมกัน
8. Production ที่มี Sales Order lineage ต้องอ่าน Order Flow ผ่าน `getStoreForFinancialWrite()` และต้องพบ Sales Order จริงก่อนบันทึก
9. `updateProductionSupplierPaymentStatus()` เปลี่ยนมาอ่าน Production pack แบบ strict
10. same-browser write lease ครอบคลุม Production เพิ่มจาก Quote/Invoice/Receipt เดิม
11. Quote cloud workflow link แยก helper `syncQuoteChildLinkCloud()` เพื่อไม่ให้ local transaction logic กับ cloud side effect ปะปนกัน

## Invariants ใหม่

### Production ใหม่

- ต้องมีเลขที่ วันที่ ผู้ผลิต/ผู้รับผลิต ลูกค้า ชื่องาน สาขา และรายการสินค้า
- เลข Production ซ้ำต้องหยุดก่อน commit
- รายการต้องผ่าน `ERPIntegrity.validateItems()`
- ต้นทุน/ราคาขายที่จำเป็นต้องครบและมากกว่า 0 ตามกฎเดิม
- ถ้ามี source Quote ต้องตรวจพบ Quote จริงด้วย strict document read
- ถ้ามี source Sales Order ต้องตรวจพบ Order จริงผ่าน strict Order Flow read
- storage corruption ระหว่าง duplicate/source validation ต้อง fail closed

### Production ที่เชื่อม Invoice แล้ว

ถ้ามี `invoiceId`, `invoiceNo` หรือ invoice status ที่ถือว่า downstream document ถูกสร้างแล้ว จะล็อก commercial fingerprint และไม่อนุญาตให้เปลี่ยน:

- เลขที่ / วันที่ / สาขา
- ผู้ผลิต / ที่อยู่ / Tax ID
- ลูกค้า / ชื่องาน
- รายการสินค้า / จำนวน / หน่วย
- ต้นทุนสินค้าและต้นทุนรวม
- ราคาขาย / Subtotal / VAT / Total
- Commission fields
- Delivery lead / due date
- Supplier credit term / supplier due date

Metadata ที่ไม่กระทบสาระ เช่น note หรือ supplier payment note ยังแก้ได้

### Production ที่เริ่มชำระผู้ผลิตแล้ว

ถ้า `supplierPaymentStatus` เป็น `partial` หรือ `paid` หรือมี `supplierPaidAt` จะใช้ commercial lock เช่นเดียวกับ Production ที่เชื่อม Invoice เพื่อป้องกันการแก้ payable basis ย้อนหลัง

### Supplier settlement ownership

Production form draft ไม่สามารถ reset settlement state ที่ถูกจัดการโดย dedicated supplier-payment action ได้ ค่าต่อไปนี้ preserve จาก original:

- `supplierPaymentStatus`
- `supplierPaidAt`
- `supplierPaidBy`

Production ใหม่เริ่มที่ `pending`

### Workflow lineage

ค่าต่อไปนี้ preserve จาก original ระหว่าง Production edit:

- Quote lineage: `sourceQuoteId`, `sourceQuoteNo`, branch/year/month/firebase id
- Sales Order lineage: `sourceSalesOrderId`, `sourceSalesOrderNo`
- Invoice lineage: `invoiceStatus`, `invoiceId`, `invoiceNo`, `invoiceCreatedAt`

Form draft จึงไม่สามารถเปลี่ยนต้นทาง/ปลายทางของเอกสารด้วยการ overwrite field ธรรมดาได้

## Atomic local Quote linkage

ก่อน Step นี้ Production create และ Quote update เป็นคนละ local write:

`save Production → save Quote link`

ถ้า write ที่สองล้ม อาจเหลือ Production ที่ Quote ยังไม่รู้จัก

Step 2G-2 ใน Local Demo ใช้ write session เดียว:

1. strict-read target Production pack
2. strict-read source Quote pack
3. push Production
4. patch Quote `productionId/productionNo/productionStatus`
5. mark ทั้งสอง key
6. commit ผ่าน rollback-capable `ERPIntegrity.transaction()`

ถ้า transaction ล้ม จะไม่ถือว่า Production ถูกบันทึกสำเร็จ

## Strict Sales Order dependency

ถ้า Production มาจาก Sales Order ระบบใช้ `ERPOrderFlow.getStoreForFinancialWrite()` แทน tolerant `getStore()`

- JSON Order Flow เสีย → `storage_error`
- Sales Order id หาไม่พบ → `dependency_error`
- ไม่ตีความว่า source order ไม่มีเพียงเพราะ storage อ่านไม่ได้

## Same-browser concurrency

`saveProduction()` ใช้ `withDemoWriteLease('production', saveProductionUnlocked)` เช่นเดียวกับ Quote/Invoice/Receipt เพื่อลด duplicate save จาก tab/browser context เดียวกันใน DEMO

ข้อจำกัดยังเหมือนเดิม: write lease นี้ไม่ใช่ server/database transaction และไม่ป้องกันหลาย device

## การทดสอบที่เพิ่ม

เพิ่ม 6 Production-oriented checks ใน core suite:

1. duplicate production number conflict before persistence
2. invoice-linked production commercial immutability + safe metadata edit + lineage preservation
3. supplier-settled production commercial immutability
4. unpaid/unlinked production commercial edit + source/settlement preservation
5. production commercial fingerprint semantics
6. app routing ผ่าน strict storage, Action Runner, write session, strict Sales Order read และ supplier-payment strict read

นอกจากนี้ test write lease เดิมถูกขยายจาก Quote/Invoice/Receipt เป็น Quote/Invoice/Receipt/Production

Core portable เพิ่มจาก **177 → 183 tests** และผ่าน **183/183**

## สิ่งที่ยังไม่ทำใน Step นี้

- ยังไม่ refactor Expense action
- ยังไม่สร้าง server-side transaction / atomic numbering
- ยังไม่ refactor Production list/read UI ให้ strict เพราะ read/display path ยังใช้ tolerant mode ตาม design
- ยังไม่ refactor `updateProductionSupplierPaymentStatus()` เป็น multi-system backend transaction; รอบนี้ทำ strict local read และรักษา rollback behavior เดิม
- ยังไม่ cleanup CSS / print controllers
- ยังไม่เปลี่ยน persisted storage keys หรือ business schema

ขั้นถัดไปควรเป็น **Step 2G-3 Expense Action Boundary** หลัง Step 2G-2 ผ่าน release closure และถูกเก็บเป็น checkpoint แยกแล้ว
