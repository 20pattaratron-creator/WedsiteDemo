# ERP DEMO 4.3.1 — Step 3C-1 Issued Document Transaction & Sync Boundary

## เป้าหมาย

Step 3C-1 ปิดเส้นทางบันทึก `Delivery/Tax` และ `Receipt` ฉบับพิมพ์ที่เดิมยังสามารถเขียน financial `localStorage` โดยตรงนอก Central Document/Finance Action Boundary ได้

เป้าหมายหลักคือแยกความรับผิดชอบให้ชัด:

- **Canonical Invoice / Receipt** = ความจริงทางธุรกิจและการเงิน
- **Issued/Printable document** = snapshot สำหรับออกเอกสาร/พิมพ์/เก็บหลักฐาน
- **Local commit** = ต้อง strict + rollback-capable
- **Cloud sync** = post-commit side effect และต้องไม่ทำให้ผู้ใช้เข้าใจผิดว่าการบันทึก Local ล้ม

## Runtime ที่เปลี่ยน

### `erp-document-finance-core.js`

เพิ่ม:

- `FINANCE_ACTION_ERROR_CODES.SYNC = 'sync_error'`
- feedback สำหรับกรณี Local commit สำเร็จแต่ Cloud sync ไม่ครบ
- `assertIssuedDocumentMatchesCanonical(input)` สำหรับตรวจว่า printable snapshot ยังตรงกับ Canonical source

Canonical fidelity guard ตรวจอย่างน้อย:

- source ต้องมีอยู่และยัง active
- เลขเอกสาร
- วันที่เอกสาร
- สาขา
- ลูกค้า
- ยอดรวม / subtotal / VAT
- จำนวนและลำดับรายการสินค้า
- รหัสสินค้า / ชื่อ / หน่วย / จำนวน / ราคาต่อหน่วย
- สำหรับ Receipt: Invoice reference identity

### `app.js`

Expose strict write boundary ที่มีอยู่แล้วผ่าน:

`window.ComformDocumentWriteStore`

ประกอบด้วย:

- `createSession`
- `loadForWrite`

Document Controllers จึงไม่ต้อง reimplement financial local-storage parsing หรือ transaction logic เอง

### `delivery-tax-document.js`

`saveDocumentToSystem()` เปลี่ยนเป็น:

`same-browser lease -> validate -> plan -> commit -> after_commit`

ผ่าน `runDocumentAction()` และ strict multi-key write session

Local commit เดียวครอบ:

1. issued invoice snapshot
2. canonical Invoice issued-document linkage

ไม่เขียน `localStorage.setItem()` โดยตรง และไม่แก้ Production lifecycle จาก print layer อีก

Settlement fields ใน snapshot อ่านจาก Canonical Invoice แทน stale printable snapshot

### `receipt-document.js`

ใช้ boundary แบบเดียวกัน:

1. issued receipt snapshot
2. canonical Receipt issued-document linkage

Receipt print layer ไม่เรียก `markInvoicePaidByReceipt()` และไม่สร้าง `paidAt` / `paidBy` เองอีก

Settlement evidence ต้องมาจาก Canonical Receipt เท่านั้น

## Idempotency / Retry hardening

Existing snapshot lookup รองรับทั้ง:

- source ID
- source document number
- document number + date fallback

จึงรองรับ legacy issued snapshot ที่อาจยังไม่มี `sourceInvoiceId` / `sourceReceiptId` และลดความเสี่ยง retry แล้วสร้าง snapshot ซ้ำ

## Cloud semantics

Cloud write อยู่ใน `after_commit`

หาก Local commit สำเร็จแล้วแต่ Cloud ไม่ครบ:

- ผลลัพธ์ = `sync_error`
- `committed = true`
- feedback = warning
- ห้ามบอกผู้ใช้ว่า "บันทึกล้มเหลว" แบบรวม ๆ
- ห้ามแนะนำให้กดบันทึกซ้ำทันที

## Static Architecture Guard

`audit-deep.mjs` จะ FAIL ระดับ HIGH หาก issued-document save:

- มี direct `localStorage.setItem()`
- bypass `runDocumentAction()`
- bypass strict write session / `writeSession.commit()`
- Receipt print layer เรียก `markInvoicePaidByReceipt()`
- Delivery print layer อัปเดต Production workflow ผ่าน Cloud

## ผลลด Duplication โดยผลข้างเคียงจากการจัด boundary

- Controller lines: **3,255 -> 3,183**
- Exact duplicate pairs: **6 -> 6**
- Normalized duplicate 10-line windows: **164 -> 146**
- Cross-controller imports: **0**

Duplication budget ใหม่: **6 exact pairs / 146 windows**

## ผลทดสอบก่อนแพ็ก

- Core: **214/214 PASS**
- Full Node/DOM: **214/221**, 7 รายการเป็น `environment_dependency` เดิม (`jsdom` / `fake-indexeddb`)
- Codebase Audit: PASS
- Deep Static Audit: PASS
- Spec Audit: **32/32 PASS**
- Complexity Audit: PASS
- Document Controller Audit: PASS
- Security Preflight: PASS — HIGH 0 / MEDIUM 0 / LOW 2 เดิม
- Security Baseline: PASS
- Runtime JS modules: **31**
- Runtime lines: **16,830**
- `app.js`: **8,241 lines**

## ขอบเขตที่ยังไม่ทำ

Step นี้ยังไม่ทำ:

- server-side transaction / RBAC / real multi-tenant security
- atomic document number across devices
- persistent Cloud outbox / automatic retry queue
- immutable user-level audit log
- fiscal/accounting period locks
- DOM/PDF rendering refactor
- e-Tax Invoice / e-Receipt integration

สิ่งเหล่านี้ควรเป็น Step ถัดไปแบบแยก checkpoint เพื่อไม่ปะปนกับ issued-document transaction hardening.
