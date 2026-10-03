# ERP DEMO 4.3.1 — Step 2C Master Data Storage Boundary

## เป้าหมาย

Step 2C แยกความรับผิดชอบเรื่องการเก็บ Customer / Supplier / Product Master ออกจาก `app.js` โดยไม่เปลี่ยน persisted key, tenant prefix, UI layout, document schema หรือ business workflow เดิม

หลักที่ใช้คือ **Fail Closed**: ถ้าระบบอ่าน Master Data ไม่ได้ ระบบต้องหยุดการแก้ไขส่วนที่เกี่ยวข้อง แทนการตีความเป็น `[]` แล้วมีโอกาสเขียนข้อมูลว่างทับของเดิม

## โมดูลใหม่

`erp-master-data-store.js`

หน้าที่หลัก:

- tenant-aware key resolution
- strict JSON/Array validation
- read/write row API
- full Master snapshot API
- pre-serialization ก่อน write
- rollback เมื่อ multi-key snapshot เขียนได้ไม่ครบ
- Cloud hydration handshake
- delayed Cloud sync หลัง hydrate สำเร็จเท่านั้น
- classification เบื้องต้นเป็น `storage_error` และ `dependency_error`

## กฎสำคัญหลัง Step 2C

1. Key ที่ไม่มีจริงสามารถคืน fallback ที่ระบุได้
2. JSON เสีย / storage ถูก block / payload ไม่ใช่ array ต้อง throw `storage_error`
3. ห้ามเปลี่ยน read error เป็น `[]`
4. `writeSnapshot()` ต้องมีทั้ง `contacts` และ `products`
5. snapshot ต้อง serialize/validate ครบก่อนแก้ storage
6. ถ้าเขียน key ที่สองไม่สำเร็จ ระบบ rollback key แรก
7. Archive rows เก็บเหมือนข้อมูลปกติ ห้ามถูก filter ใน storage layer
8. Cloud hydration ต้องอ่าน Local snapshot ได้ครบก่อนเรียก Cloud load/merge/write
9. ถ้า Cloud load fail bridge ต้องปิด (`ready=false`)
10. Local writes หลัง Cloud load fail ต้องไม่ auto-sync ไปทับ Cloud state ที่ยังไม่ทราบ
11. Business Rules preset ห้ามเรียก `FirebaseService.saveMasterSnapshot()` ตรง
12. Backup/Restore และ CSV ต้องใช้ Master storage boundary เดียวกัน

## Compatibility

Storage contract ไม่เปลี่ยน:

- `comform_contact_master_v1`
- `comform_product_master_v1`

Tenant key format ไม่เปลี่ยน:

`erp_tenant::<tenantId>::<baseKey>`

ดังนั้นข้อมูล Trial เดิมควรยังอ่านต่อได้โดยไม่ต้อง migration

## สิ่งที่ไม่ได้ทำใน Step 2C

- ไม่เปลี่ยน UI Master Data
- ไม่ย้าย DOM rendering
- ไม่เปลี่ยน Firebase schema
- ไม่เพิ่ม server-side RBAC
- ไม่เพิ่ม production database
- ไม่ refactor CSS
- ไม่เปลี่ยนเอกสาร Quotation / Delivery / Receipt

## Regression ใหม่

`tests/master-data-store.test.cjs`

ครอบคลุม:

- malformed JSON fail closed
- non-array payload fail closed
- blocked storage read
- tenant isolation
- write failure preserving old data
- snapshot rollback
- partial snapshot rejection
- archived row preservation
- local archive vs older Cloud active row
- corrupt local blocks Cloud hydration
- malformed Cloud snapshot
- Cloud sync only after hydrate
- Cloud load failure keeps bridge closed
- app orchestration uses storage/cloud bridge
- Business Rules cannot bypass Cloud handshake

## ขั้นต่อไปที่แนะนำ

Step 2D ไม่ควรรีบย้าย UI ทั้งหมด แต่ควรเริ่มจาก Document/Finance action orchestration ที่มี side effects สูง เช่น save/issue/payment/related-document operations โดยใช้ Stateful Workflow Benchmark ก่อนย้ายโค้ด
