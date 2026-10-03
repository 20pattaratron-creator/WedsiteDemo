# Document Controller Duplication Map — ERP 4.3.1 Step 3A

## ภาพรวม

| คู่ Controller | Same-name functions | Exact same-name bodies | Normalized duplicate 10-line groups |
|---|---:|---:|---:|
| Quotation ↔ Delivery/Tax | 6 | 3 | 26 |
| Quotation ↔ Receipt | 6 | 3 | 26 |
| Delivery/Tax ↔ Receipt | 57 | 21 | 275 |

> 10-line windows เป็นตัวชี้วัดเชิง maintenance และมี window ซ้อนกัน จึงห้ามตีความว่าเป็น 275 feature ที่ต้องรวม

## Exact helpers ที่พบร่วมทั้งสาม Controller

- `escapeHtml`
- `fmt`
- `thaiIntegerText`

## Exact helpers ที่เด่นใน Delivery/Tax ↔ Receipt

- `createItem`
- `parseMoney`
- `formatDate`
- `totals`
- `bahtText`
- `getLockedBranch`
- `getNestedValue`
- `setNestedValue`
- `addItem`
- `removeItem`
- `printableItems`
- `itemRowUnits`
- `paginateItems`
- `documentPagesHtml`
- `resolveStoragePeriod`
- `waitForPdfStageAssets`
- `safeFilename`

## Interpretation

### แยกก่อน

Pure formatting/value helpers เพราะ behavior คงที่และไม่ควรรู้จัก controller state

### Parameterize ก่อนค่อยแยก

Pagination/PDF wait/item helpers เพราะแม้ body เหมือนกัน แต่จับ state/DOM/constants ของ controller

### คงแยก

Render shell, page layout, source-link validation, save workflow, print CSS และ evidence blocks เพราะมีความหมายเฉพาะเอกสาร

## Step 3B Success Criteria

Step 3B-1 ควร:

1. ลด exact same-name function pairs จาก baseline 27
2. ไม่เพิ่ม normalized duplicate window groups
3. Runtime behavior/preview/PDF/save tests เดิมต้องผ่าน
4. ไม่สร้าง cross-controller imports
5. Shared module ใหม่ต้องไม่มี implicit access ถึง `state`, DOM หรือ cloud/storage
