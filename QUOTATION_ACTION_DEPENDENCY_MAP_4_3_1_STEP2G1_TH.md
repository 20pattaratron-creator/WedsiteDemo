# Quotation Action Dependency Map — ERP 4.3.1 Step 2G-1

## ก่อน Step 2G-1

`saveQuoteUnlocked()` ทำ validation, duplicate scan, VAT record build, local persistence, cloud scheduling, UI reset/render และ error notification ใน block เดียว

## หลัง Step 2G-1

```text
Quote Form / DOM
    │
    ▼
saveQuoteUnlocked()
    │
    ├── validate
    │     ├── branch invariant
    │     ├── required fields
    │     ├── date parser
    │     ├── ERPIntegrity.validateItems
    │     ├── strict duplicate scan
    │     └── strict current-record read (edit)
    │
    ├── plan
    │     ├── calculateVatSummary (shared source of truth)
    │     ├── quoteCommercialFingerprint
    │     └── planQuoteDocumentAction
    │
    ├── commit
    │     ├── createFinancialDocumentWriteSession (local demo)
    │     ├── commitDocumentEdit (edit)
    │     ├── ERPIntegrity.transaction
    │     └── saveCloudRecord (best-effort cloud bridge)
    │
    └── after_commit
          ├── remember customer
          ├── clear attachments
          ├── reset form
          ├── refresh year/dashboard
          └── render quote list
```

## Boundary ที่ต้องรักษา

- `erp-document-finance-core.js` ต้องไม่ใช้ `document`, `window`, `localStorage`, Firebase
- UI ต้องไม่เป็นเจ้าของ commercial-lock business rule
- storage read สำหรับ write path ต้อง fail-closed
- approved/downstream-linked Quote ห้ามแก้ commercial fingerprint
- after_commit failure ต้องไม่ทำให้ UI อ้างว่า core commit ไม่เกิด

## ความเสี่ยงที่เหลือ

- Sales Order link อยู่ใน Order Flow store ไม่ได้ถูกเขียนกลับ Quote โดยตรง แต่ Sales Order creation บังคับ approved Quote อยู่แล้ว จึงถูก commercial lock ผ่าน approval invariant
- Cloud mode ยังเป็น best-effort demo architecture ไม่ใช่ server-side transaction
- `documentNumberExists()` แบบ tolerant ยังถูกใช้โดย Invoice/Receipt; strict variant ถูกเปิดใช้กับ Quote ก่อนเพื่อจำกัด blast radius และจะประเมิน migration ต่อใน Step ถัดไป
