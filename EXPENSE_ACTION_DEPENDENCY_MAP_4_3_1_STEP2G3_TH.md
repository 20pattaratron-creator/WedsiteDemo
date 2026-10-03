# Expense Action Dependency Map — ERP 4.3.1 Step 2G-3

## ก่อน Step 2G-3

```text
saveExpense()
 ├─ getBr()
 ├─ read DOM
 ├─ loadFor()                 [tolerant]
 ├─ build expense object
 ├─ d.expenses.push()
 ├─ saveFor()
 ├─ saveCloudRecord()
 ├─ clear attachments
 ├─ reset form
 └─ render dashboard/list
```

ความเสี่ยงหลัก:

- JSON เสียอาจถูก `loadFor()` แปลงเป็น empty pack ใน write path
- ไม่มี duplicate supplier document guard
- tax/document state ขัดกันได้
- Local commit, Cloud evidence, UI reset ไม่มี stage boundary
- Cloud save failure ไม่ retry attachment IndexedDB fallback เมื่อ Firebase service มีอยู่
- attachment fallback อ่าน local pack แบบ tolerant

## หลัง Step 2G-3

```text
saveExpense()
 └─ withDemoWriteLease('expense')
     └─ saveExpenseUnlocked()
         └─ runDocumentAction()
             ├─ VALIDATE
             │   ├─ parseFlexibleBusinessDate()
             │   ├─ createFinancialDocumentWriteSession()
             │   ├─ strict pack parse
             │   └─ expenseDocumentExistsForWrite()
             │
             ├─ PLAN
             │   └─ planExpenseDocumentAction()
             │       ├─ required fields
             │       ├─ positive amount
             │       ├─ docType taxonomy
             │       ├─ taxStatus taxonomy
             │       ├─ purpose taxonomy
             │       ├─ tax-document consistency
             │       ├─ duplicate conflict
             │       └─ evidence warning
             │
             ├─ COMMIT
             │   ├─ expenses.push(record)
             │   ├─ writeSession.mark()
             │   ├─ writeSession.commit()
             │   └─ ERPIntegrity.changed()
             │
             └─ AFTER_COMMIT
                 ├─ saveCloudRecord()
                 │   └─ Cloud failure → LocalFileStore fallback
                 ├─ clearAttachedFiles()
                 ├─ resetF('expense')
                 ├─ renderDash()
                 └─ renderEList()
```

## Storage / Evidence Boundary

```text
Cloud save success
 ├─ strict local cache read
 ├─ update firebaseId / attachment metadata
 └─ cache write

Cloud save failure
 ├─ no evidence → warning only
 └─ evidence exists
      └─ LocalFileStore.saveLocalAttachment()
          └─ strict financial pack read
              └─ update attachments + storageProvider=local-only
```

## Invariants

- Expense write ห้ามเปลี่ยน corrupted storage เป็น empty store
- Amount ต้องมากกว่า 0
- Received tax invoice ต้องมี tax-capable document type และ document number
- Duplicate vendor document reference ต้องหยุดก่อน commit
- Local commit สำเร็จแล้ว Cloud/UI failure ต้องไม่ถูกอธิบายว่า local save ล้ม
- Evidence fallback ห้ามใช้ tolerant storage read
- Same-browser repeated write ถูกครอบด้วย write lease
