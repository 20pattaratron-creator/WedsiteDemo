# ERP 4.3.1 — Step 3B-1 Document Controller Duplication Map

## ภาพรวมหลัง Pure Helper Extraction

- Controller รวม: **3,413 บรรทัด** (Step 3A = 3,580; ลด 167)
- Same-name function pairs: **54** (เดิม 69)
- Exact same-name function pairs: **14** (เดิม 27)
- Normalized duplicate 10-line groups: **221** (เดิม 275)
- Cross-controller imports: **0**

## ราย Controller

| Controller | บรรทัด | Top-level functions |
|---|---:|---:|
| `quotation-document.js` | 478 | 27 |
| `delivery-tax-document.js` | 1,394 | 60 |
| `receipt-document.js` | 1,541 | 64 |

## คู่ Controller หลัง Step 3B-1

| คู่ | Same-name | Exact |
|---|---:|---:|
| `quotation-document.js` ↔ `delivery-tax-document.js` | 2 | 0 |
| `quotation-document.js` ↔ `receipt-document.js` | 2 | 0 |
| `delivery-tax-document.js` ↔ `receipt-document.js` | 50 | 14 |

## Helper ที่ย้ายออกแล้ว

ย้ายไป `erp-shared-core.js` และลบ local definition จาก controllers:

- `escapeHtml`
- `parseMoney`
- `fmt`
- `formatDate`
- `thaiIntegerText`
- `bahtText`
- `safeFilename`

Quotation ใช้ 4 ตัวที่จำเป็น; Delivery/Tax และ Receipt ใช้ครบ 7 ตัว การย้ายนี้ลด exact duplicate pairs 13 คู่ และ normalized windows 54 กลุ่มโดยไม่รวม controller เข้าหากัน

## Candidate ที่ยังเหลือสำหรับ Step 3B-2

- `getNestedValue`
- `setNestedValue`
- `resolveStoragePeriod`

สามตัวนี้ยังไม่ย้ายใน Step 3B-1 เพราะควรมี edge-case tests เรื่อง nested path, array/object mutation และการแปลงช่วงปี/เดือนก่อน

## Contextual helpers ที่ยังไม่ควรรวม

- `totals`
- `getLockedBranch`
- `addItem` / `removeItem`
- `printableItems`
- `itemRowUnits`
- `paginateItems`
- `documentPagesHtml`
- `waitForPdfStageAssets`

ฟังก์ชันกลุ่มนี้ยังอาศัย controller state, DOM, constants หรือ print lifecycle จึงควร parameterize ก่อน extraction

## ห้ามรวมเพียงเพื่อลดบรรทัด

- `documentPageHtml`
- `renderAppShell`
- `validateBeforeSave`
- `saveDocumentToSystem`
- source-link logic
- document-specific CSS / copy labels / signatures

เป้าหมายคือ Shared Primitive ที่เล็กและ deterministic ไม่ใช่ Mega Controller ที่มี `if(type===...)` จำนวนมาก

## Baseline ใหม่

จาก Step 3B-1 เป็นต้นไป Quality Guard ใช้ ceiling:

- Exact same-name pairs **≤ 14**
- Normalized duplicate 10-line groups **≤ 221**
- Cross-controller imports **= 0**

ค่าดังกล่าวเป็นเพดาน ไม่ใช่เป้าหมาย ขั้นถัดไปต้องลดหรือคงไว้เท่านั้น เว้นแต่มี architecture decision ที่ review ชัดเจน
