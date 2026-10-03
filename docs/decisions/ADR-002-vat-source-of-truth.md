# ADR-002 — VAT Calculation Has One Source of Truth
Status: Accepted

`erp-shared-core.js` owns VAT constants and add/extract/none calculations. Presentation modules consume results and must not duplicate 0.07/1.07/100÷107 arithmetic.
