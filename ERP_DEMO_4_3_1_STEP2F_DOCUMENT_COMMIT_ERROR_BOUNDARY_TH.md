# ERP DEMO 4.3.1 — Step 2F: Central Document Commit & Error Handling Boundary

## เป้าหมาย
Step 2F ทำให้ Invoice/Receipt ใช้เส้นทางการทำงานเดียวกันในรูปแบบ `validate → plan → commit → after_commit` โดยไม่เปลี่ยนหน้าตา UI, schema เอกสาร, storage key หรือ workflow หลักของลูกค้า

## สิ่งที่เปลี่ยน
- เพิ่ม `runDocumentAction()` ใน `erp-document-finance-core.js` เพื่อควบคุม stage และผลลัพธ์ของ document action
- เพิ่ม `normalizeDocumentActionError()` และ error code มาตรฐาน 6 กลุ่ม
- เพิ่ม `documentActionFeedback()` เพื่อแปลง business/storage error เป็นข้อความที่ผู้ใช้แก้ปัญหาได้
- `saveInvoiceUnlocked()` และ `saveReceiptUnlocked()` เปลี่ยนจาก try/catch หลายก้อนไปใช้ action runner กลาง
- commit path แยกจาก UI refresh: state mutation อยู่ใน `commit`, render/reset อยู่ใน `after_commit`
- ถ้า commit สำเร็จแล้วแต่ after-commit ล้ม ระบบจะรายงานว่า “ข้อมูลหลักถูกบันทึกแล้ว” แทนการบอกว่าบันทึกไม่สำเร็จ
- `markInvoicePaidByReceipt()` ไม่ render UI ใน commit path อีกต่อไป
- Local transaction failure ใน Invoice/Receipt create ถูกจัดเป็น `storage_error`
- Missing source Production/Quotation และ missing edit record ถูกจัดเป็น `dependency_error`

## Error taxonomy
| Code | ความหมาย | แนวทางผู้ใช้ |
|---|---|---|
| `validation_error` | ข้อมูลไม่ครบ/รูปแบบไม่ถูก | ตรวจช่องกรอกและยอด |
| `conflict_error` | State เปลี่ยนหรือยอด/เอกสารขัดกัน | เปิดเอกสารใหม่และตรวจสถานะล่าสุด |
| `permission_error` | เอกสารถูกล็อกตาม lifecycle | ใช้ Cancel/Reverse workflow ก่อน |
| `dependency_error` | เอกสารต้นทางหรือ record เดิมหาย | ตรวจ Workflow/reference |
| `storage_error` | เขียน/อ่าน storage ไม่ปลอดภัย | หยุดเพื่อป้องกันข้อมูลสูญหายและตรวจ Backup/พื้นที่ |
| `unknown_error` | ยังจำแนกไม่ได้ | ห้ามกดซ้ำทันที ตรวจ state ล่าสุดก่อน |

## Commit truthfulness
Action result มี `committed` และ `stage` ชัดเจน:
- fail ที่ `validate`/`plan` → `committed=false`
- fail ที่ `commit` → `committed=false`
- fail ที่ `after_commit` → `committed=true`
- สำเร็จครบ → `ok=true`, `stage=completed`, `committed=true`

กติกานี้ลดความเสี่ยง duplicate document จากกรณีที่ข้อมูลบันทึกสำเร็จแล้วแต่ render UI ล้มและผู้ใช้เข้าใจผิดว่าต้องกด Save ซ้ำ

## Scope ที่ยังไม่แตะ
- Quote/Production/Expense ยังไม่ได้ย้ายเข้า action runner ใน Step นี้
- CSS/Design System ไม่เปลี่ยน
- Document print controllers ไม่ถูกรวม
- Backend production/RBAC ยังไม่เปิดใช้

## ผลทดสอบ
- Core portable: **172/172 PASS**
- Full Node suite: **172/179**, อีก 7 เป็น environment dependency (`jsdom`/`fake-indexeddb`)
- Codebase / Deep / Spec / Complexity / Security: **PASS**
