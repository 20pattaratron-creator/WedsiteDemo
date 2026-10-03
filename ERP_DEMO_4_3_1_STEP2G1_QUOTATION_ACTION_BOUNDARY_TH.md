# ERP DEMO 4.3.1 — Step 2G-1 Quotation Action Boundary

## เป้าหมาย

Step 2G ถูกแบ่งย่อยเพื่อไม่ให้ Quotation, Production และ Expense เปลี่ยนพร้อมกัน รอบนี้ทำเฉพาะ Quotation และยึด pattern เดียวกับ Invoice / Receipt จาก Step 2F:

`validate → plan → commit → after_commit`

## สิ่งที่เปลี่ยน

1. `saveQuoteUnlocked()` ใช้ `runDocumentAction()` แทน try/catch ที่รวมทุก stage ไว้ด้วยกัน
2. เพิ่ม `planQuoteDocumentAction()` ใน `erp-document-finance-core.js`
3. เพิ่ม `quoteCommercialFingerprint()` เพื่อแยกการแก้ไขสาระการค้าออกจาก metadata ที่ปลอดภัย
4. Quotation create/edit ใช้ strict document storage สำหรับ write path
5. เพิ่ม `documentNumberExistsForWrite()` เพื่อให้การตรวจเลขซ้ำ fail-closed หาก document pack ใดอ่านไม่ได้
6. `commitDocumentEdit()` ใช้ strict record lookup สำหรับ Quote / Invoice / Receipt เพื่อไม่ให้ corrupted pack ถูกตีความเป็น record หาย
7. รักษา approval/workflow lineage ของ Quote เดิมเมื่อแก้ metadata

## Invariants ใหม่

### Quote ใหม่

- ต้องมีเลขที่ วันที่ ลูกค้า สาขา และรายการสินค้า
- เลขที่ Quote ซ้ำต้องหยุดก่อน commit
- storage corruption ในช่วง duplicate scan / create ต้องกลายเป็น `storage_error` ไม่ใช่ข้อมูลว่าง

### Quote ที่อนุมัติแล้ว

อนุญาตให้แก้ metadata ที่ไม่เปลี่ยนสาระการค้า เช่น note/contact แต่ห้ามเปลี่ยน:

- เลขที่เอกสาร
- วันที่เอกสาร
- สาขา
- ลูกค้า / ที่อยู่ / Tax ID
- รายการสินค้า จำนวน หน่วย ราคา
- Subtotal / VAT / Total / VAT mode

หากพยายามแก้ จะเป็น `conflict_error`

### Quote ที่มีเอกสารต่อเนื่อง

ถ้ามี `productionId/productionNo` หรือ `invoiceId/invoiceNo` แล้ว ใช้กฎ commercial lock แบบเดียวกับ approved quote เพื่อป้องกันต้นทางเปลี่ยนย้อนหลังหลัง downstream document ถูกสร้าง

### Workflow lineage

ค่าต่อไปนี้ไม่ให้ form draft เขียนทับโดยไม่ตั้งใจ:

- approval fields (`approved`, `approvedAt`, `approvedBy`, ...)
- production lineage (`productionId`, `productionNo`, `productionStatus`)
- invoice lineage (`invoiceId`, `invoiceNo`, `invoiceStatus`)
- `workflowUpdatedAt`

## Strict storage

Read สำหรับ Dashboard/List ยังใช้ tolerant mode ได้ แต่ Quotation write ใช้ strict mode:

- malformed JSON → fail closed
- invalid document pack shape → fail closed
- strict duplicate scan หากเจอ pack เสีย → ไม่อนุญาตให้สร้าง Quote ใหม่จนกว่าจะตรวจข้อมูล
- edit source record ถูกอ่านด้วย strict path ก่อน mutation

## การทดสอบที่เพิ่ม

เพิ่ม 5 tests ใน `tests/document-finance-core.test.cjs`:

1. Quote create + duplicate conflict
2. Approved quote commercial lock + safe metadata edit
3. Linked quote commercial lock + lineage preservation
4. Commercial fingerprint semantics
5. App routing ผ่าน strict storage + central action runner

Core portable เพิ่มจาก 172 → 177 tests และผ่าน 177/177

## สิ่งที่ยังไม่ทำใน Step นี้

- ยังไม่ refactor Production save
- ยังไม่ refactor Expense save
- ยังไม่เปลี่ยน CSS / print controller
- ยังไม่เปลี่ยน schema/localStorage key
- ยังไม่เพิ่ม backend หรือ server transaction

ขั้นถัดไปควรเป็น **Step 2G-2 Production Action Boundary** หลังจาก Step 2G-1 ผ่าน release closure และถูกเก็บเป็น checkpoint แยกแล้ว
