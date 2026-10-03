# Master Data Storage Dependency Map — ERP 4.3.1 Step 2C

## ก่อน Step 2C

```text
app.js
 ├─ readLocalMaster -> localStorage.getItem
 ├─ writeLocalMaster -> localStorage.setItem
 ├─ localMasterSnapshot
 ├─ queueMasterCloudSync -> FirebaseService.saveMasterSnapshot
 └─ hydrateTenantMasterFromCloud -> FirebaseService.loadMasterSnapshot

business-rules.js
 ├─ read Master ด้วย localStorage โดยตรง
 ├─ write Master ด้วย localStorage โดยตรง
 └─ saveMasterSnapshot ไป Firebase โดยตรง
```

ความเสี่ยงหลักคือหลายโมดูลสามารถตีความ/เขียน persisted Master Data ด้วยกติกาคนละชุด

## หลัง Step 2C

```text
app.js / business-rules.js
        │
        ▼
erp-master-data-store.js
 ├─ resolve tenant key
 ├─ readRows / writeRows
 ├─ readSnapshot / writeSnapshot
 ├─ validate + serialize
 └─ rollback
        │
        ├──────────────► localStorage
        │
        ▼
MasterDataCloudBridge
 ├─ hydrate handshake
 ├─ merge via erp-master-data-core.js
 ├─ scheduleSync
 └─ pushSnapshot
        │
        ▼
FirebaseService (เมื่อ configured)
```

## Ownership

- `erp-master-data-core.js` = business rules ของ Master Data
- `erp-master-data-store.js` = persistence + Cloud synchronization safety
- `app.js` = UI/orchestration/notification
- `business-rules.js` = Formula Lab และ preset orchestration
- `tenant-context.js` = tenant identity/key namespace
- `erp-storage-contracts.js` = persisted key contracts

## Boundary ที่ยังเหลือ

- Business Rules policy เองยังใช้ localStorage ของตัวเอง (ไม่ใช่ Master Data)
- Sales/Delivery targets ยังอยู่ใน app orchestration
- Document packs ยังมี storage ownership ในโมดูลเอกสาร/Integrity
- Local file attachments ใช้ IndexedDB และมี tenant guard แยก

สิ่งเหล่านี้ไม่ถูกย้ายใน Step 2C เพื่อจำกัด blast radius
