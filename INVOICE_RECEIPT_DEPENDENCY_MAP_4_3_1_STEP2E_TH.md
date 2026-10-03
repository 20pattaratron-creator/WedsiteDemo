# Invoice / Receipt Dependency Map — ERP 4.3.1 Step 2E

## Invoice Save

`saveInvoice()` → same-browser write lease → `saveInvoiceUnlocked()`

1. DOM/Form → items/VAT/cost/commission/source references
2. strict target/source pack read → `parseFinancialDocumentPackForWrite()`
3. stock + SO delivery validation → `ERPProductionCore` / `ERPIntegrity`
4. action planning → `planInvoiceDocumentAction()`
5. Local Demo create → `createFinancialDocumentWriteSession()` → `ERPIntegrity.transaction()`
6. edit → `commitDocumentEdit()`
7. optional cloud/attachment persistence → `saveCloudRecord()`

### High-risk dependencies
- `ERPProductionCore.validateInvoiceStock`
- `ERPIntegrity.validateDelivery`
- `ERPIntegrity.paymentSummary`
- source Production / Quote linkage
- business pack `biz2_{branch}_{year}_{month}`

## Receipt Save

`saveReceipt()` → same-browser write lease → `saveReceiptUnlocked()`

1. DOM/Form → receipt draft
2. strict target pack + invoice reference read
3. `ERPIntegrity.paymentSummary(..., excludeReceiptId)`
4. action planning → `planReceiptDocumentAction()`
5. defense-in-depth → `ERPIntegrity.validateReceipt()`
6. Local Demo commit → financial write session
7. settlement reconciliation → atomic `ERPIntegrity.reconcilePayments()`
8. optional cloud/attachment persistence

### High-risk dependencies
- Invoice identity across issued/unissued collections
- outstanding calculation
- Payment-generated Receipt identity
- multi-key settlement writes

## Boundary decisions

- UI read remains tolerant where appropriate.
- Invoice/Receipt financial write is strict/fail-closed.
- Pure action planner owns deterministic validation/mutation planning.
- persistence orchestration stays outside pure core.
