# ERP DEMO 4.3.1 — Step 2D: Document / Finance Action Boundary

## เป้าหมาย
Step 2D ลดความเสี่ยงของ Order-to-Cash โดยแยก “การวางแผนธุรกรรม” ออกจาก DOM / localStorage / Firebase ก่อน โดยเริ่มจาก Billing Note → Payment → Receipt ซึ่งเป็นส่วนที่มีผลต่อยอดลูกหนี้และหลักฐานรับเงินจริงสูงที่สุด

## Architecture หลัง Step 2D

```text
UI / erp-order-flow.js
  ├─ อ่านค่าฟอร์ม
  ├─ loadStoreForFinancialWrite()  (strict / fail-closed)
  ├─ commit store
  └─ notify / render
             │
             ▼
erp-document-finance-core.js       (pure planner)
  ├─ buildBillingAction()
  ├─ planBillingPaymentAction()
  ├─ buildPaymentReceiptDrafts()
  └─ assertIdempotentPaymentReceipts()
             │
             ▼
erp-integrity.js
  ├─ paymentSummary / reconcilePayments
  ├─ reconcileBillings
  ├─ transaction()
  └─ createPaymentReceipts()       (persistence + replay guard)
```

## สิ่งที่เปลี่ยน
1. เพิ่ม `erp-document-finance-core.js` เป็น deterministic pure core ไม่มี DOM, localStorage, Firebase หรือ UI notification
2. `saveBilling()` ใช้ `buildBillingAction()` ตรวจสาขา ลูกค้า Invoice ซ้ำ Billing ซ้ำ ยอดเกินคงค้าง และสร้าง Billing record
3. `saveBillingPayment()` ใช้ `planBillingPaymentAction()` จัดสรรยอดแบบ FIFO และห้ามรับเกินยอดคงค้าง
4. `createPaymentReceipts()` ใช้ `buildPaymentReceiptDrafts()` เพื่อสร้าง Receipt draft และใช้ `assertIdempotentPaymentReceipts()` ป้องกัน replay สร้างใบเสร็จซ้ำ
5. เพิ่ม `loadStoreForFinancialWrite()` ซึ่ง fail-closed เมื่อ Order Flow JSON เสียหรือ schema collection ไม่ใช่ array
6. UI read path ยังคง tolerant เพื่อให้หน้าจอเปิดได้ แต่ financial write path ต้องเชื่อถือ state ได้ก่อนเท่านั้น
7. เพิ่ม ADR-006 เพื่อยอมรับ runtime module เพิ่ม 1 ไฟล์อย่างมีเหตุผล โดยไม่เพิ่ม complexity budget อื่น

## Stateful Invariants ที่ล็อกด้วย Test
- Billing Note เป็นเอกสารเรียกเก็บเงิน ไม่เพิ่ม Sales / VAT / Stock
- Payment ลด Outstanding แต่ไม่แก้ `Invoice.total`, `subtotal`, `vatAmt` หรือรายการสินค้า
- Payment เกิน Outstanding ต้องถูกปฏิเสธ
- Payment number ซ้ำต้องถูกปฏิเสธ
- Payment → Receipt replay ด้วย Payment เดิมต้องคืนหลักฐานเดิม ไม่สร้าง Receipt เพิ่ม
- ถ้าพบ Receipt เดิมของ Payment ไม่ครบหรือยอดไม่ตรง ต้อง fail-closed (`conflict_error`)
- Reservation ลด Available-to-Promise แต่ไม่ลด physical On Hand source
- Corrupt Order Flow JSON ต้องหยุด Financial Save (`storage_error`) แทนการตีความเป็น store ว่าง

## Error categories ที่เริ่มใช้งาน
- `validation_error` — input หรือ business requirement ไม่ครบ/ไม่ถูกต้อง
- `conflict_error` — state ปัจจุบันขัดกับ action เช่น เลขซ้ำ ยอดเกิน หรือ replay evidence ไม่ตรง
- `dependency_error` — เอกสารต้นทางที่จำเป็นหาไม่พบ/ไม่พร้อม
- `storage_error` — persisted Order Flow state อ่านไม่ได้หรือ schema ไม่เชื่อถือได้

## Scope ที่ยังไม่แตะใน Step 2D
- ไม่ refactor `saveQuoteUnlocked()` / `saveInvoiceUnlocked()` / `saveReceiptUnlocked()` ทั้งก้อน
- ไม่เปลี่ยน VAT source of truth
- ไม่เปลี่ยน document numbering
- ไม่เปลี่ยน CSS / UI layout
- ไม่เปลี่ยน storage key หรือ tenant schema
- ไม่เพิ่ม backend / server RBAC

## ผลทดสอบ ณ ตอนปิด logic
- Core portable: 155/155 PASS
- Full Node suite: 155/162; 7 environment dependency (`jsdom`, `fake-indexeddb`)
- Codebase Audit: PASS
- Deep Static Audit: PASS
- Spec Audit: 32/32 PASS
- Complexity Audit: PASS หลัง ADR-006
- Security Preflight: PASS (HIGH 0 / MEDIUM 0 / LOW 2 เดิม)
- Security Baseline: PASS

## ขั้นถัดไปที่แนะนำ
Step 2E ควรแยก Invoice / Receipt document action validation ออกจาก `app.js` โดยเริ่มจาก pure validation + action plan ก่อน mutation และเพิ่ม idempotency/document-state benchmark โดยยังคง API form เดิม เพื่อลด blast radius
