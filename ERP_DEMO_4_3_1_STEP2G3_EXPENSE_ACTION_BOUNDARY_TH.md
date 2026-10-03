# ERP DEMO 4.3.1 — Step 2G-3 Expense Action Boundary

## เป้าหมาย

Step 2G-3 ย้ายเส้นทาง **บันทึกค่าใช้จ่ายองค์กร (Expense Create)** เข้าสู่ Document Action architecture เดียวกับ Quotation, Production, Invoice และ Receipt โดยไม่เพิ่ม Expense Edit workflow ใหม่ในรอบนี้

โครงสร้างใหม่:

```text
Expense Form
  → same-browser write lease
  → VALIDATE
  → PLAN
  → COMMIT
  → AFTER_COMMIT
```

Business rule หลักอยู่ใน `planExpenseDocumentAction()` ภายใน `erp-document-finance-core.js` ซึ่งเป็น pure core และไม่อ้าง `window`, `document`, `localStorage` หรือ Firebase

## สิ่งที่เปลี่ยน

### 1. Strict storage สำหรับ Expense write

`saveExpenseUnlocked()` ไม่ใช้ `loadFor()` แบบ tolerant อีกต่อไป แต่สร้าง `createFinancialDocumentWriteSession()` และ parse persisted pack ผ่าน `parseFinancialDocumentPackForWrite()` หาก JSON หรือ schema ของเดือนนั้นเสีย ระบบจะเกิด `storage_error` และหยุดก่อนเขียน

หลักการ: **อ่านไม่ได้ ≠ ไม่มีข้อมูล**

### 2. Duplicate evidence document guard

เพิ่ม `expenseDocumentExistsForWrite()` ตรวจเลขใบเสร็จ/ใบกำกับภาษีภายในปีเอกสาร โดยเปรียบเทียบเลขเอกสาร + ร้านค้า/ผู้ขาย และใช้ strict pack ทุกเดือน หาก history อ่านไม่ได้จะ fail closed แทนการตอบว่า “ไม่ซ้ำ”

### 3. Expense taxonomy validation

Pure planner ตรวจว่า:

- วันที่ / สาขา / หมวดหมู่ / รายละเอียด ต้องมี
- จำนวนเงินต้อง > 0
- `docType`, `taxStatus`, `purpose` ต้องเป็นค่าที่ระบบรองรับ
- หากเลือก `ไม่มีเอกสาร` ห้ามมีเลขเอกสาร
- หากสถานะเป็น `ได้รับใบกำกับภาษีแล้ว` ต้องใช้ประเภทใบกำกับภาษี (`tax_invoice`, `receipt_tax_invoice`, `abbreviated_tax_invoice`) และต้องมีเลขเอกสาร

รอบนี้ **ยังไม่คำนวณ Input VAT** เพราะ Expense form ปัจจุบันไม่มีช่องฐานภาษี/VAT amount แยก จึงไม่สร้างสูตรภาษีจากข้อมูลที่ไม่มี

### 4. Evidence warning ไม่ปลอมเป็น Save failure

ถ้าระบุว่าได้รับใบกำกับภาษีแล้วแต่ยังไม่แนบรูป/PDF ระบบยังอนุญาตให้บันทึก Expense หลัก แต่ planner คืน warning ให้ UI แจ้งผู้ใช้ว่า “ยังไม่มีหลักฐานแนบ” แทนการอ้างว่าบันทึกล้ม

### 5. Attachment snapshot ก่อน commit

Expense record copy attachment metadata เป็น snapshot ใหม่ก่อน commit เพื่อไม่ผูก persisted draft กับ array UI ที่จะถูก reset หลัง save

### 6. Local transaction boundary

Expense local record ถูก push เข้า pack และ commit ผ่าน rollback-capable `createFinancialDocumentWriteSession()` / `ERPIntegrity.transaction()` หาก local write ล้ม Action Runner คืน `storage_error` และไม่เข้าสู่ after-commit

### 7. Cloud / evidence persistence อยู่หลัง Local commit

หลัง Local commit สำเร็จจึงเรียก `saveCloudRecord()` และ reset/render UI ทำให้ Cloud/UI failure ไม่ถูกตีความย้อนกลับว่า Expense หลักยังไม่ถูกบันทึก

### 8. Evidence fallback hardening

พบ bug เดิม: เมื่อ Firebase service มีอยู่แต่ Cloud save ล้ม ระบบแจ้งเตือนอย่างเดียวและไม่ได้ลองเก็บไฟล์หลักฐานลง IndexedDB fallback ทำให้ไฟล์จริงอาจสูญหลัง reset form

แก้เป็น:

- Cloud fail + มีไฟล์แนบ → พยายาม `persistAttachmentsLocalFallback()`
- Fallback ใช้ `loadForFinancialDocumentWrite()` ไม่ใช้ tolerant `loadFor()`
- Cloud สำเร็จแต่ local cache update ล้ม → แจ้งว่า Cloud สำเร็จแล้วและเตือนให้ refresh; ไม่รายงานว่า Cloud ล้ม
- ไม่มีไฟล์แนบ → ไม่แจ้งข้อความเท็จว่าเก็บหลักฐาน local-only แล้ว

## สิ่งที่ตั้งใจยังไม่ทำ

1. ไม่เพิ่ม Expense Edit workflow ใหม่
2. ไม่เพิ่ม Void/Approval/Posting lifecycle ในรอบนี้
3. ไม่คำนวณ Input VAT หรือภาษีซื้อ เนื่องจาก form ยังไม่มีข้อมูลภาษีเชิงตัวเลขครบ
4. ไม่ refactor CSS / Expense UI
5. ไม่รวม document controllers

## Regression ใหม่

เพิ่ม 6 tests ใน `tests/document-finance-core.test.cjs`:

1. Valid Expense plan + attachment snapshot
2. Amount / taxonomy / tax-document consistency validation
3. Duplicate vendor document conflict
4. Received-tax-document without evidence returns warning
5. Runtime route ผ่าน strict storage + Action Runner + write lease + rollback session
6. Attachment fallback ใช้ strict storage และ Cloud failure retry local evidence persistence

ผล Core หลัง Step 2G-3: **189/189 PASS**
