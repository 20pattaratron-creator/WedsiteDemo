# Document Controller Duplication Map — ERP 4.3.1 Step 3B-5

Step 3B-5 เป็น test/governance checkpoint ดังนั้น duplication metrics คงจาก Step 3B-4:

- Controller lines: **3301**
- Same-name pairs: **48**
- Exact duplicate pairs: **8 / 8**
- Normalized duplicate 10-line groups: **187 / 187**
- Cross-controller imports: **0**

## Exact duplicates ที่ยังเหลือ

Delivery/Tax ↔ Receipt ยังมี exact same-name helpers ที่เกี่ยวกับ branch/auth, mutable UI state และ page/PDF context เช่น `branchCompany`, `getLockedBranch`, `addItem`, `removeItem`, `printableItems`, `paginateItems`, `documentPagesHtml`, `waitForPdfStageAssets` ตามผล audit ล่าสุด

## Step 3B-5 Decision

`printableItems` และ `paginateItems` ยังคง local แต่ถูกครอบด้วย source-executed Page Partition Harness แล้ว การลด duplication รอบถัดไปต้องทำโดยรักษา Harness นี้ให้ผ่านโดยไม่แก้ expected behavior เพื่อให้เห็น regression จริงหาก page partition เปลี่ยน
