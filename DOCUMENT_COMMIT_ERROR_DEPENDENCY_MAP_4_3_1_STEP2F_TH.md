# Dependency Map — Step 2F Document Commit & Error Boundary

## Invoice
`saveInvoiceUnlocked()`
→ `runDocumentAction()`
→ validate: strict financial pack + source Production/Quotation
→ plan: stock guard + delivery validation + `planInvoiceDocumentAction()`
→ commit: edit transaction หรือ create transaction + source-link mutation
→ after_commit: remember customer + reset form + render lists/dashboard
→ UI message: `documentActionFeedback()`

## Receipt
`saveReceiptUnlocked()`
→ `runDocumentAction()`
→ validate: strict receipt pack + strict Invoice reference lookup
→ plan: `planReceiptDocumentAction()` + receipt validation
→ commit: receipt transaction + settlement reconciliation
→ after_commit: reset form + render Invoice/Receipt + repopulate references
→ UI message: `documentActionFeedback()`

## Boundary rules
1. Business core ไม่แตะ DOM/localStorage/Firebase
2. Commit เท่านั้นที่มี persisted mutation
3. UI refresh ห้ามอยู่ใน commit path
4. Error ต้องมี code หรือถูก normalize เป็น `unknown_error`
5. `after_commit` failure ต้องไม่อ้างว่า local commit ล้ม
6. Financial storage failure ต้อง fail closed
