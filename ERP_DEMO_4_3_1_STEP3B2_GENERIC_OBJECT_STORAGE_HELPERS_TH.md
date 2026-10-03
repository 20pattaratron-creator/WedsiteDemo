# ERP DEMO 4.3.1 — Step 3B-2 Generic Object / Storage-Period Helper Extraction

## เป้าหมาย
ลด duplication ต่อจาก Step 3B-1 โดยย้ายเฉพาะ helper ที่ deterministic และไม่มี DOM/storage side effect ได้แก่ `getNestedValue`, `setNestedValue`, `resolveStoragePeriod` ไปไว้ใน `erp-shared-core.js` โดยคงพฤติกรรมเดิมของ controller

## สิ่งที่เปลี่ยน
- `SHARED_CORE_VERSION` 1.1.0 → 1.2.0
- Delivery/Tax และ Receipt import helper ทั้งสามจาก Shared Core
- ลบ local implementation ที่ซ้ำกันจาก controller ทั้งสอง
- เพิ่ม edge-case regression สำหรับ missing/null/falsy nested values, primitive replacement, array path และ storage-period fallback
- ลด duplication budget เป็น 11 exact pairs / 202 normalized groups

## ผลการลด duplication
| Metric | Step 3B-1 | Step 3B-2 | เปลี่ยนแปลง |
|---|---:|---:|---:|
| Controller lines | 3,413 | 3,363 | -50 |
| Same-name function pairs | 54 | 51 | -3 |
| Exact duplicate pairs | 14 | 11 | -3 |
| Normalized duplicate 10-line groups | 221 | 202 | -19 |
| Cross-controller imports | 0 | 0 | 0 |

## พฤติกรรมที่ล็อกไว้
- `getNestedValue()` คืน `0`/`false` ตามจริง และคืน `''` เฉพาะ path ที่ nullish/missing
- `setNestedValue()` สร้าง nested object เมื่อ intermediate ไม่มี/เป็น primitive และยังรองรับ array container ที่มีอยู่แล้ว
- `resolveStoragePeriod()` รับ `YYYY-MM-DD`, คืนเดือนแบบ 0-based เช่น `2026-09-14 → {year:2026, month:8}`
- ปี พ.ศ. ใน input เช่น `2569-09-14` ยังคงปี 2569 ตามพฤติกรรมเดิมของ controller; Step นี้ไม่ทำ conversion เพิ่มเพื่อหลีกเลี่ยง semantic change
- input ผิดรูปแบบ fallback เป็นเดือน local ที่กำหนด/ปัจจุบัน

## สิ่งที่ตั้งใจไม่แตะ
Pagination, DOM, PDF/print lifecycle, layout, validation, save/source-link workflow และ CSS ยังแยกเหมือนเดิม

## ขั้นถัดไป
Step 3B-3 ควรประเมิน contextual helpers ทีละตัว เช่น `branchCompany`, `createItem`, `totals`, `printableItems`, `itemRowUnits`, `paginateItems` โดยต้องเขียน behavior-equivalence tests และออกแบบ parameter boundary ก่อน extraction ห้ามรวม controller ทั้งก้อน
