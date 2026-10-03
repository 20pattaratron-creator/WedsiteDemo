# ADR-009 — Sales Form Assist Runtime Module (ใบกำกับภาษีอย่างย่อ + ราคาขายมาตรฐาน)

## Status
Accepted for Local Demo.

## Context
Two sales features need form behaviour on the existing quote/invoice screens:

1. **Abbreviated tax invoice (ใบกำกับภาษีอย่างย่อ, Revenue Code §86/6).** The invoice form gets a
   "รูปแบบใบกำกับภาษี" selector (เต็มรูป §86/4 default / อย่างย่อ §86/6). Abbreviated invoices must state
   "ราคารวมภาษีมูลค่าเพิ่มแล้ว", so the VAT select is locked to VAT-inclusive while อย่างย่อ is selected and the
   user's previous VAT choice is restored when switching back. Buyer fields become optional.
2. **Default selling price (ราคาขายมาตรฐาน) in Product Master.** Choosing a product in a quote/invoice row fills
   an empty/zero unit price (and an unchosen unit) from the master.

Putting this into `app.js` would grow the mega-controller that `QUALITY_BUDGET.json` guards (the
`appJsLinesDelta` rule).

## Decision
- **Pure rules** go into existing core modules (unit tested in isolation):
  - `erp-shared-core.js` — `normalizeTaxInvoiceForm`, `isAbbreviatedTaxInvoice`, `GENERAL_CUSTOMER_NAME`,
    `invoiceCustomerName`, `isGeneralCustomerName`, `taxInvoiceLacksBuyer`, `unitPriceForVatMode`.
  - `erp-master-data-core.js` — `normalizeProductDefaultPrice`, `productMasterValidationMessage`,
    `planProductDefaultPriceFill` (imports `roundMoneyValue` / `unitPriceForVatMode` from shared core; still
    DOM/storage free).
  - `erp-document-finance-core.js` — abbreviated ⇒ VAT-inclusive guard; `taxInvoiceForm` joins the invoice
    financial fingerprint (legacy records normalize to `full`, so old paid invoices are not locked by it).
  - `erp-credit-note-core.js` — `creditNoteRequiresBuyerName`: §86/10 needs the buyer on the credit note, so a
    credit note on a walk-in abbreviated invoice must be given a buyer name.
- **One new runtime module** `erp-sales-form-assist.js` owns the DOM behaviour (selector ↔ VAT lock/restore,
  hint, optional-buyer label, default-price autofill, VAT re-base of autofilled prices). It uses
  `addEventListener` delegation — no new inline handlers, one `window.ERPSalesFormAssist` global.
- `app.js` keeps only thin wiring (store `taxInvoiceForm`, walk-in customer fallback, reset/edit/production
  hooks, list badge, product-master field and CSV column). Net `app.js` change is **−2 lines** versus the
  pre-change file.
- Printing: `delivery-tax-document.js` renders abbreviated invoices with a separate `abbreviatedPagesHtml()`
  layout (scoped `<style>` travels with the markup so preview, print window and PDF all match). The
  golden-guarded `documentPagesHtml()` / `documentPageHtml()` and `delivery-tax-document.css` are unchanged, so
  full-form output is byte-identical.

## Choices documented for users
- **Numbering:** abbreviated invoices use the same invoice number sequence (`INV…`) as full invoices. A separate
  prefix would need a new document-number type, collections and duplicate checks; one sequence is valid for
  §86/6 ("เลขที่ลำดับ") and keeps the demo simple.
- **Walk-in customer:** an abbreviated invoice saved without a buyer stores `customer = "ลูกค้าทั่วไป / เงินสด"` so
  receipts (same-customer match), billing, analytics grouping and the issued-document canonical check keep
  working. The placeholder is never written to Customer Master and is shown as an empty optional field on edit.
- **Default price basis:** ราคาขายมาตรฐาน is stored **before VAT** (same basis as ต้นทุนมาตรฐาน and the Business
  Rules ⚙ ราคาแนะนำ). Autofill converts it to the row basis: ×1.07 (RD half-up to satang) for
  "ราคารวม VAT แล้ว", as-is for "บวก VAT" and "ไม่มี VAT". Autofilled prices follow later VAT-mode changes.
- **Precedence:** user-entered price (typed, or taken with ⚙ ราคาแนะนำ) > master default. The default only fills
  an empty/zero cell or a cell still holding the value the autofill wrote; rows rebuilt from saved documents
  (edit, production, sales order) are never autofilled.

## Complexity budget change
`runtimeJsFilesMax` 36 → 37 and `rootJsFilesMax` 37 → 38 (the one new module). `runtimeLinesMax` stays 19,600
(runtime lines 19,078 → 19,536) and the `app.js` baseline/delta rule is unchanged and was not relaxed; the
pre-existing `appJsLinesDelta` failure (26 before this change) is reduced to 24, not resolved.

## Consequences
- Tests: `tests/abbreviated-invoice.test.cjs`, `tests/product-default-price.test.cjs` (pure rules + jsdom flows).
- Revenue Code compliance for retail eligibility (§86/6 is for VAT-registered retail businesses only) is shown as a
  hint in the form; the demo does not enforce a business-type setting.
