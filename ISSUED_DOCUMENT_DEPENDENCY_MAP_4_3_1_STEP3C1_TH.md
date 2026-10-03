# ERP 4.3.1 Step 3C-1 — Issued Document Dependency Map

## Delivery/Tax printable save

```text
Canonical Invoice
      │
      ├─ identity / branch / customer / date
      ├─ items / subtotal / VAT / total
      └─ settlement snapshot source
      │
      ▼
assertIssuedDocumentMatchesCanonical()
      │
      ▼
runDocumentAction()
      │
      ├─ validate: strict source + target pack
      ├─ plan: build issued snapshot
      ├─ commit: one rollback-capable session
      │      ├─ issuedInvoices[]
      │      └─ canonical Invoice issuedDocument* link
      └─ after_commit
             ├─ UI refresh
             ├─ Cloud issued snapshot sync
             └─ Cloud canonical issuedDocument* link sync
```

**ห้าม** print layer เปลี่ยน Production invoice lifecycle

## Receipt printable save

```text
Canonical Receipt
      │
      ├─ identity / branch / customer / date
      ├─ items / subtotal / VAT / total
      ├─ Invoice reference
      └─ settlement evidence
      │
      ▼
assertIssuedDocumentMatchesCanonical()
      │
      ▼
runDocumentAction()
      │
      ├─ validate: strict source + target pack
      ├─ plan: build issued snapshot
      ├─ commit: one rollback-capable session
      │      ├─ issuedReceipts[]
      │      └─ canonical Receipt issuedDocument* link
      └─ after_commit
             ├─ UI refresh
             ├─ Cloud issued snapshot sync
             └─ Cloud canonical issuedDocument* link sync
```

**ห้าม** print layer:

- เรียก `markInvoicePaidByReceipt()`
- สร้าง `paidAt` ใหม่
- เปลี่ยน Invoice settlement truth

## Error ownership

- validation mismatch -> `validation_error` / `conflict_error`
- source missing -> `dependency_error`
- local transaction failure -> `storage_error`, `committed=false`
- Cloud failure after local success -> `sync_error`, `committed=true`

หลักคือ **Local transaction result กับ Cloud synchronization result ต้องไม่ถูกตีความเป็นเหตุการณ์เดียวกัน**.
