# Dependency Map — ERP 4.3.1 Step 2D

## High-risk action chain

```text
Invoice state
   │
   ├─ paymentSummary() ───────────────┐
   │                                  │
   ▼                                  │
Billing UI                            │
   │                                  │
   ▼                                  │
buildBillingAction() [PURE]           │
   │                                  │
   ▼                                  │
Order Flow store: billingNotes        │
   │                                  │
   ▼                                  │
planBillingPaymentAction() [PURE] ◄───┘
   │
   ├─ allocation plan
   ▼
Order Flow store: payments
   │
   ▼
buildPaymentReceiptDrafts() [PURE]
   │
   ▼
createPaymentReceipts()
   ├─ replay/idempotency guard
   ├─ pack.receipts
   └─ transaction(pack + flow store)
   │
   ▼
reconcilePayments()
   ├─ invoice paidAmount/outstandingAmount/status
   └─ reconcileBillings()
```

## Ownership
| Concern | Owner | Side effects |
|---|---|---|
| Billing/Payment validation and plan | `erp-document-finance-core.js` | None |
| UI form extraction / notifications | `erp-order-flow.js` | DOM |
| Order Flow persisted commit | `erp-order-flow.js` | localStorage |
| Payment summary / reconciliation | `erp-integrity.js` | localStorage on reconcile |
| Receipt persistence transaction | `erp-integrity.js` | localStorage |
| VAT calculation | `erp-shared-core.js` | None |
| Tenant storage key | `erp-storage-contracts.js` + tenant context | key resolution |

## Financial write trust boundary
`loadStore()` remains UI-tolerant. It may return a blank view-state when reading fails so the page can render. **It must not be used as evidence that persisted financial state is empty for a new write.**

`loadStoreForFinancialWrite()` is the required write boundary for Billing/Payment in Step 2D:
- malformed JSON => `storage_error`
- collection with wrong type => `storage_error`
- no existing key => valid new blank store
- valid store => reconcile then return trusted state

## Forbidden side effects benchmarked
1. Billing action must not mutate Invoice totals or create VAT/Stock values.
2. Payment action must not rewrite Invoice sale/VAT totals.
3. Receipt generated from workflow payment is evidence, not a second cash entry.
4. Payment replay must not duplicate receipt evidence.
5. Reservation changes ATP only; source on-hand remains unchanged.
