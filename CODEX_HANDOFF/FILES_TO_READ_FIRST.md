# Files To Read First in Codex

> ชื่อไฟล์บางไฟล์อาจต่างใน Repository ที่ผู้ใช้เปิด ให้ค้นหาตาม function/module concept หากไม่พบชื่อ exact

## Priority 0 — Handoff/Governance
1. `CODEX_HANDOFF_MASTER.md`
2. `ERP_ARCHITECTURE_RULES.md`
3. `STEP4B_WORK_IN_PROGRESS.md`
4. `ERP_TEST_RELEASE_CHECKLIST.md`

## Priority 1 — Core action/storage architecture
1. `app.js`
2. `erp-document-finance-core.js`
3. `erp-integrity.js`
4. `erp-governance-core.js`
5. `erp-governance.js`
6. `erp-shared-core.js`
7. master-data core/store modules
8. date core

## Priority 2 — Operational / Backup blocker
1. `erp-production-core.js`
2. `erp-order-flow.js`
3. backup/export/import functions in `app.js` or dedicated module
4. Local File Store / attachment storage
5. Recycle Bin / delete helpers

ค้นหา symbols:
- `collectBackupData`
- `exportData`
- `importBackup`
- `contentSha256`
- `loadFor(`
- `loadForFinancialDocumentWrite`
- `readForWrite`
- `ERPIntegrity.transaction`
- `localStorage.setItem`
- `cloudSave`
- `runSync`
- `operationId`
- `syncing`
- `uncertain`

## Priority 3 — Documents
1. `quotation-document.js`
2. `delivery-tax-document.js`
3. `receipt-document.js`
4. document CSS files

## Priority 4 — Tests / Audit / Release
1. `tests/` all relevant files
2. `scripts/audit-deep.mjs`
3. financial control audit script
4. document controller audit script
5. render golden audit script
6. complexity audit/budget
7. `scripts/validate-customer-trial.mjs`
8. deployment manifest / HTTP smoke scripts
9. security preflight/baseline scripts
10. `package.json`

## Source Acquisition Protocol
ก่อนแก้โค้ด Codex ต้อง:
1. `git status` / list files
2. อ่าน package scripts
3. ตรวจว่า `erp-governance-core.js` และ `erp-governance.js` มีหรือไม่
4. ตรวจ Step/Release docs ที่มีอยู่
5. รัน baseline Core
6. รัน audit baseline
7. รายงานว่า source ตรงกับ Step 4A Stable, Step 4B WIP หรือเวอร์ชันอื่น
8. ถ้าไม่ตรง ห้ามเดาหรือ apply patch ตาม line number จาก handoff
