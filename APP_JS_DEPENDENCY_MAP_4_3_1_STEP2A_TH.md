# APP.JS Dependency Map — ERP 4.3.1 Step 2A

Generated: 2026-09-12T14:26:57.220Z

## Baseline

- app.js: 8161 lines after first extraction
- Top-level function declarations: 665
- Inline HTML handlers detected: 255

## First extraction decision

Selected **erp-date-core.js** first because the date/calendar helpers are reusable business logic with no direct DOM/localStorage dependency. Existing function names are imported back into app.js so call sites stay unchanged.

The **master-data** domain is intentionally deferred: the current block touches DOM=true, storage=true, window=true, cloud=true, user interaction=true. It should be split behind a storage/service boundary before UI code is moved.

## Highest-coupling functions (static heuristic)

| Function | Lines | App refs | Inline HTML | Coupling score |
|---|---:|---:|:---:|---:|
| `importJSON` | 79 | 2 | yes | 7 |
| `saveProduction` | 64 | 5 | yes | 7 |
| `saveProductMasterLocal` | 1 | 2 | yes | 7 |
| `previewDeliveryDocumentFromForm` | 33 | 5 | yes | 6 |
| `go` | 32 | 12 | yes | 6 |
| `previewQuoteDocumentFromForm` | 30 | 5 | yes | 6 |
| `previewReceiptDocumentFromForm` | 30 | 5 | yes | 6 |
| `refreshLinkedFlow` | 20 | 2 | yes | 6 |
| `commitCsvImport` | 14 | 2 | yes | 6 |
| `renderDash` | 70 | 16 | yes | 5 |
| `saveInvoiceUnlocked` | 44 | 2 | no | 5 |
| `fillFromProduction` | 42 | 3 | yes | 5 |
| `saveReceiptUnlocked` | 31 | 2 | no | 5 |
| `saveExpense` | 30 | 5 | yes | 5 |
| `renderQLList` | 28 | 8 | yes | 5 |
| `editProduction` | 23 | 3 | no | 5 |
| `saveQuoteUnlocked` | 19 | 2 | no | 5 |
| `fillProductionFromQuote` | 16 | 3 | yes | 5 |
| `fillFromInv` | 14 | 3 | yes | 5 |
| `renderDataAnalytics` | 249 | 9 | yes | 4 |

## Guardrail for the next extraction

1. Add regression tests before moving a domain.
2. Keep old public function names/call signatures stable.
3. Move pure/service logic before DOM rendering code.
4. Run core tests + code/deep/spec/complexity/security audits after every micro-step.
5. Do not combine CSS cleanup or new product features with app.js extraction.
