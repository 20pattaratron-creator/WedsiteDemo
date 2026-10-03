# ERP DEMO 4.3.1 — Step 3B-3 Contextual Helper Assessment & Safe Extraction

## เป้าหมาย
ต่อจาก Step 3B-2 โดยประเมิน helper ที่เหลือแบบ **behavior-equivalence ก่อน extraction** และย้ายเฉพาะ helper ที่พิสูจน์แล้วว่าไม่ผูก DOM, storage, auth, VAT state หรือ pagination state

## Helper ที่ย้ายจริง
- `createItem()` ของ Delivery/Tax และ Receipt → `createDocumentLineItem()` ใน `erp-shared-core.js`
- `itemRowUnits()` → `estimateDocumentItemRowUnits()` ใน `erp-shared-core.js`
- Controller import แบบ alias เพื่อคง call-site เดิม (`createItem`, `itemRowUnits`)
- `SHARED_CORE_VERSION` 1.2.0 → **1.3.0**

## Behavioral invariants ที่ล็อกด้วย Test
- item factory ต้องคืน object ใหม่ทุกครั้ง ไม่แชร์ mutable object
- shape เดิม: `productCode`, `product`, `unit='ชิ้น'`, `qty=1`, `priceUnit=0`
- row-unit ของข้อความปกติ = 1
- explicit newline เพิ่มจำนวนหน่วยตามจำนวนบรรทัด
- wrap legacy ที่ 42 ตัวอักษรยังเหมือนเดิม
- cap legacy สูงสุด 4 units ยังเหมือนเดิม
- shared helper รองรับ `wrapAt` / `maxUnits` แบบ explicit parameter แต่ controller ปัจจุบันยังใช้ default เดิม

## ผลลด Duplication
| Metric | Step 3B-2 | Step 3B-3 | เปลี่ยนแปลง |
|---|---:|---:|---:|
| Controller lines | 3,363 | 3,329 | -34 |
| Same-name function pairs | 51 | 49 | -2 |
| Exact duplicate pairs | 11 | 9 | -2 |
| Normalized duplicate 10-line groups | 202 | 193 | -9 |
| Cross-controller imports | 0 | 0 | 0 |

Duplication budget ใหม่ถูกล็อกที่ **9 exact pairs / 193 normalized groups**

## ทำไมไม่ย้าย helper ที่เหลือ
- `branchCompany`: ผูก `window.CurrentUser` + `BRANCH_DEFAULTS`
- `getLockedBranch`: ผูก auth/browser globals
- `totals`: อ่าน `state.items`, `vatNone`, `vatEnabled`; ต้องออกแบบ input boundary ก่อน
- `addItem` / `removeItem`: mutate state และกระตุ้น render lifecycle
- `printableItems`: อ่าน controller state และ fallback factory
- `paginateItems`: ผูก page budget และ empty-page semantics
- `documentPagesHtml`: เรียก `documentPageHtml` เฉพาะเอกสาร
- `waitForPdfStageAssets`: ผูก DOM/fonts/images/requestAnimationFrame และควรมี browser/visual regression ก่อน

## สิ่งที่ตั้งใจไม่แตะ
Pagination behavior, document layout, DOM event lifecycle, PDF/print lifecycle, `validateBeforeSave`, `saveDocumentToSystem`, source-link logic และ CSS ยังคงแยกเหมือนเดิม

## ขั้นถัดไป
Step 3B-4 ควรเริ่มจาก parameter-boundary assessment ของ `totals` / `printableItems` / pagination primitives ทีละตัว โดยห้ามรวม DOM/PDF lifecycle จนกว่าจะมี regression ที่เหมาะสม
