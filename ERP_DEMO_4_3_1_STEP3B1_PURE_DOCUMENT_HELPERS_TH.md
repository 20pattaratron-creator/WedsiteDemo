# ERP DEMO 4.3.1 — Step 3B-1 Pure Document Helper Extraction

## เป้าหมาย

Step 3B-1 ลด duplication เฉพาะ helper ที่ deterministic และไม่มี DOM/storage/document workflow โดยไม่แตะ layout, PDF lifecycle, validation หรือ save/source-link logic ของเอกสารแต่ละชนิด

## Helper ที่ย้ายเข้า `erp-shared-core.js`

- `escapeHtml`
- `parseMoney`
- `fmt`
- `formatDate`
- `thaiIntegerText`
- `bahtText`
- `safeFilename`

Quotation import เฉพาะ helper ที่ใช้งานจริง ส่วน Delivery/Tax และ Receipt import ครบทั้ง 7 ตัว โดย local copies ถูกลบออก

## Behavioral regression

เพิ่ม `tests/document-shared-core.test.cjs` เพื่อล็อก output เดิมของ HTML escaping, comma money parsing, Thai locale formatting, พ.ศ. date formatting, Thai integer/baht text และ safe filename รวมถึงตรวจว่า controllers ไม่มี local definition ของ helper ที่ย้ายแล้ว

## ผลการลด duplication

| Metric | Step 3A | Step 3B-1 | เปลี่ยนแปลง |
|---|---:|---:|---:|
| Controller lines | 3,580 | 3,413 | -167 |
| Same-name function pairs | 69 | 54 | -15 |
| Exact same-name function pairs | 27 | 14 | -13 |
| Normalized duplicate 10-line groups | 275 | 221 | -54 |
| Cross-controller imports | 0 | 0 | 0 |

Duplication budget ถูกลดลงทันทีเป็น 14 exact pairs / 221 normalized groups เพื่อป้องกันการเพิ่ม duplication กลับแบบเงียบ ๆ

## สิ่งที่ตั้งใจไม่แตะ

- `documentPageHtml` / `renderAppShell`
- `validateBeforeSave` / `saveDocumentToSystem`
- pagination และ controller-global state
- PDF stage / print lifecycle
- Production / Invoice / Receipt source-link rules
- CSS และ layout ของเอกสาร

## เหตุผลที่ใช้ `erp-shared-core.js`

โมดูลนี้เป็น deterministic shared primitives อยู่แล้ว จึงสามารถรวม pure presentation/value helpers โดยไม่เพิ่ม runtime module ใหม่และไม่ต้องขยาย Quality Budget ขณะเดียวกันยังรักษา dependency direction ให้ controllers พึ่ง shared primitive ไม่พึ่งกันเอง

## ขั้นถัดไป

Step 3B-2 ควรพิจารณา `getNestedValue`, `setNestedValue`, `resolveStoragePeriod` เท่านั้น โดยต้องเขียน edge-case tests ก่อน extraction และยังห้ามรวม document-specific save/layout logic
