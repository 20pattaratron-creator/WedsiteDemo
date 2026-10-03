# ERP DEMO 4.3.1 — Step 2B Master Data Service Boundary

วันที่ปิดขั้น: 14 กันยายน 2026

## เป้าหมาย

Step 2B ทำต่อจาก Step 2A โดยลดความรับผิดชอบของ `app.js` แบบทีละก้อน และยังไม่ย้าย UI/DOM หรือ Storage/Cloud ออกในครั้งเดียว เป้าหมายหลักคือสร้าง Pure Master Data Core ที่ทดสอบได้โดยไม่ต้องมี browser, localStorage, Firebase หรือ DOM พร้อมยืนยันว่าการ Archive เป็นการคงประวัติ ไม่ใช่การลบข้อมูลโดยอ้อม

## สิ่งที่เพิ่ม

เพิ่ม `erp-master-data-core.js` เป็นเจ้าของ Business Logic สำหรับ Master Data จำนวน 22 public functions ครอบคลุมการ normalize, select/find, validate, upsert, archive, merge, seed, CSV merge/replace, product defaults, credit terms และ supplier lead days

`app.js` ยังทำหน้าที่ orchestration ได้แก่ อ่าน/เขียน storage, cloud synchronization, DOM/form rendering, notifications และการเรียก core functions เท่านั้นในส่วนที่ refactor รอบนี้

## บั๊ก Data Integrity ที่พบและแก้

### 1. Archived contact อาจหายเมื่อบันทึก contact อื่น

ก่อน Step 2B `upsertContactMaster()` ทำงานบนรายการที่ถูก filter เฉพาะ `active !== false` แล้วเขียนผลกลับ local master ทำให้รายการที่ Archive ไว้มีโอกาสถูกตัดออกจาก storage เมื่อมีการบันทึกลูกค้า/ผู้จำหน่ายรายการอื่น

หลัง Step 2B การ upsert ใช้ raw master rows ทั้งหมด และ `upsertContactRows()` รักษารายการ inactive ไว้เสมอ

### 2. Supplier seed อาจขัดกับสถานะ Archive

การ seed ผู้ผลิต/ผู้จำหน่ายต้องไม่ตีความว่า “ไม่มี supplier” เพียงเพราะ supplier เดิมถูก Archive แล้ว Step 2B จึงนับ archived supplier ว่าเป็นประวัติที่มีอยู่ และไม่ resurrect โดยอัตโนมัติ

### 3. Backup/Restore ต้องรวม Archived Master Data

Backup และ Restore ของ Contact Master เปลี่ยนให้ใช้ `includeArchived:true` เพื่อไม่ให้ backup ดูสมบูรณ์แต่จริง ๆ ตัด audit history ออก

### 4. CSV Contact Merge/Replace ต้องไม่ลบ Archive โดยอ้อม

โหมด merge และ replace รักษา archived history และ role อื่นที่ไม่ใช่ target import ไว้ ส่วนรายการ target ที่ถูก import ซ้ำสามารถ reactivate record เดิมได้โดยใช้ ID เดิม

### 5. CSV Product Replace ต้องรักษา Product Tombstone

Product ที่ถูก Archive จะถูกเก็บเป็น local inactive tombstone เพื่อ suppress seed product ที่ชื่อ/SKU ตรงกัน การ CSV replace จึงไม่สามารถทำให้ tombstone หายโดยไม่ตั้งใจ

### 6. Reactivation ต้องไม่สร้าง Duplicate Entity

การกรอก Contact/Product ที่เคย Archive จะ reactivate entity เดิมและล้าง `archivedAt` แทนสร้าง ID ใหม่ ถ้ามี ID ชัดเจน ระบบใช้ ID เป็น identity ก่อน business key

### 7. เปลี่ยน SKU ต้องไม่สร้าง Product ซ้ำ

`upsertProductRows()` ให้ explicit record ID มี priority เหนือ SKU key จึงสามารถแก้ SKU/code ของ product เดิมโดยไม่เพิ่มแถวใหม่โดยไม่ตั้งใจ

## APIs ที่ย้ายเข้า Pure Core

- Product identity/defaults: `normalizeProductKey`, `defaultProductFlowType`, `defaultProductFulfillment`
- Contact role/query: `contactHasRole`, `selectContactRows`, `findContactRow`
- Validation: `validateContactMasterRecord`, `validateProductMasterRecord`
- Master mutation: `upsertContactRows`, `archiveContactRows`, `upsertProductRows`, `archiveProductRows`
- Merge/build: `mergeMasterRows`, `buildProductMasterRows`, `mergeContactImportRows`, `mergeProductImportRows`
- Product query/meta: `findProductMasterRow`, `productMasterMetaFromRows`
- Business normalization: `normalizeSupplierLeadDays`, `customerCreditDaysFromTerm`, `customerCreditTermFromDays`
- Seed policy: `ensureSupplierSeedRows`

## สิ่งที่ตั้งใจยังไม่เปลี่ยน

- Layout/UI ของ Customer, Supplier และ Product
- CSS/Design System
- Local Storage keys และ tenant key convention
- Firebase/Cloud schema
- VAT/Finance/Document workflow
- Quotation/Invoice/Receipt controllers
- การย้าย `readLocalMaster()` / `writeLocalMaster()` / cloud hydration ออกจาก `app.js` (กำหนดไว้สำหรับ Step 2C)

## Regression Coverage

เพิ่ม `tests/master-data-core.test.cjs` จำนวน 24 tests และปรับ Trial Hardening test ให้ตรวจเจ้าของ Archive Logic ตาม architecture ใหม่ แทนการบังคับว่า literal `active:false` ต้องอยู่ใน `app.js`

ผล Core Suite หลัง Step 2B: **121/121 PASS**

Full Node/DOM Suite: **121/128 PASS, 7 environment_dependency** เพราะ environment นี้ยังไม่มี `jsdom`/`fake-indexeddb` จึงไม่รายงานเป็น Full PASS

## Audit ล่าสุด

- Codebase Audit: PASS — Files 201, JS 30
- Deep Static Audit: PASS — Runtime JS 29, Issues 0
- Specification Audit: PASS — 32/32
- Complexity Audit: PASS — `app.js` audit lines 8,141
- Agent Repo Security: PASS — HIGH 0, MEDIUM 0, LOW 2
- Security Baseline: PASS — 12 sensitive files unchanged

LOW findings ที่เหลือเป็น review-only เดิม: transitive `fsevents` install script ใน lockfile และ Windows preflight batch script

## Architecture หลัง Step 2B

```text
app.js
  ├─ DOM / forms / rendering
  ├─ localStorage + tenant storage orchestration
  ├─ cloud hydrate/sync orchestration
  ├─ notification / workflow glue
  └─ imports
       ├─ erp-date-core.js
       └─ erp-master-data-core.js
            ├─ normalize / validate
            ├─ find / select
            ├─ upsert / archive
            ├─ seed / merge
            └─ CSV merge / replace policy
```

## ขั้นต่อไปที่เสนอ: Step 2C Storage Boundary

Step 2C ควรแยกเฉพาะ storage/cloud boundary ก่อน ไม่ย้าย UI Master Data ไปพร้อมกัน โดย candidate functions หลักคือ `readLocalMaster`, `writeLocalMaster`, local master snapshot, tenant-aware master keys, cloud queue/sync และ `hydrateTenantMasterFromCloud`

เป้าหมายคือให้ `app.js` เรียก service/store API แทนแตะ storage implementation โดยตรง และต้องมี Stateful tests สำหรับ corrupted storage, tenant isolation, write rollback/fail-closed, cloud/local merge และ archive persistence ก่อน/หลัง refactor
