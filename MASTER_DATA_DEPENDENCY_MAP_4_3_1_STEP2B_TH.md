# Master Data Dependency Map — ERP 4.3.1 Step 2B

## Pure Core ที่แยกแล้ว

`erp-master-data-core.js` ไม่มีการอ้าง `window`, `document`, `localStorage`, Firebase หรือ Cloud adapter โดยตรง จึงสามารถทดสอบ deterministically ใน Node ได้

| Boundary | เจ้าของหลัง Step 2B | ตัวอย่าง |
|---|---|---|
| Normalize / Validate | `erp-master-data-core.js` | product key, lead days, credit terms, master record validation |
| Select / Find | `erp-master-data-core.js` | active/archive filter, role matching, product lookup |
| Mutation policy | `erp-master-data-core.js` | upsert, reactivate, archive, tombstone |
| Merge / Seed / Import policy | `erp-master-data-core.js` | local-cloud merge, supplier seed, CSV merge/replace |
| Storage implementation | `app.js` (ยังไม่ย้าย) | local master read/write, tenant-scoped keys |
| Cloud orchestration | `app.js` (ยังไม่ย้าย) | queue sync, hydrate/merge |
| UI / DOM | `app.js` (ยังไม่ย้าย) | datalist, edit/reset forms, notifications, render master |

## Coupling ที่ตั้งใจเหลือไว้สำหรับ Step 2C

Storage/Cloud functions ยังอยู่ใน `app.js` เพื่อไม่ให้ Step 2B เปลี่ยน pure logic, persistence implementation และ UI พร้อมกัน การแยกครั้งต่อไปควรสร้าง store/service boundary ที่คืนผลสำเร็จ/ความผิดพลาดแบบชัดเจน โดย Core ไม่รู้ว่า persistence เป็น localStorage หรือ cloud

## Invariants ที่ Step 2C ห้ามทำพัง

1. Archived row ต้องไม่หายจาก save/seed/backup/restore/import
2. Tenant A ห้ามอ่าน/เขียน Master ของ Tenant B
3. Corrupted storage ต้อง fail closed ห้ามแทนด้วย `[]` แล้วเขียนทับข้อมูลเดิม
4. Cloud/local merge ต้องเลือก revision ที่ถูกต้องโดยไม่ resurrect inactive row จากข้อมูลเก่า
5. Product tombstone ต้อง suppress matching seed product จนกว่าจะ reactivate อย่างตั้งใจ
6. Storage write failure ต้องไม่ทำให้ UI รายงานว่าสำเร็จ
