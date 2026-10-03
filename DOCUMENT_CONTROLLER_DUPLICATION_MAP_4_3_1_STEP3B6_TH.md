# Document Controller Duplication Map — ERP 4.3.1 Step 3B-6

## Metrics

| Metric | Step 3B-5 | Step 3B-6 |
|---|---:|---:|
| Controller lines | 3,301 | 3255 |
| Same-name pairs | 48 | 46 |
| Exact duplicate pairs | 8 | 6 |
| Normalized 10-line groups | 187 | 164 |
| Cross-controller imports | 0 | 0 |

## Extracted in Step 3B-6

- `printableItems()` local copies -> `selectPrintableDocumentItems()` in Shared Core
- `paginateItems()` local copies -> `paginateDocumentItems()` in Shared Core

## Remaining exact-duplicate candidates

Exact same-name function pairs ที่เหลือจะต้องประเมินตาม context ก่อน extraction โดยเฉพาะ branch/auth state, DOM/PDF lifecycle และ document-specific page rendering.

## Rule

Baseline ใหม่คือ **6 exact pairs / 164 normalized windows** และเป็น ceiling ไม่ใช่ target.
