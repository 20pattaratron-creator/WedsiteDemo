# Document Controller Duplication Map — ERP 4.3.1 Step 3B-2

- Controller lines: **3363**
- Exact same-name pairs: **11**
- Normalized 10-line groups: **202**
- Cross-controller imports: **0**

## คู่ Controller
- `quotation-document.js` ↔ `delivery-tax-document.js`: same-name 2, exact 0
- `quotation-document.js` ↔ `receipt-document.js`: same-name 2, exact 0
- `delivery-tax-document.js` ↔ `receipt-document.js`: same-name 47, exact 11

## Shared ใน Step 3B-2
- `getNestedValue`
- `setNestedValue`
- `resolveStoragePeriod`

## ยังคงแยก
- DOM / render / PDF / save / source-link logic
- Pagination/stateful helpers จนกว่าจะมี regression-backed parameter boundary
