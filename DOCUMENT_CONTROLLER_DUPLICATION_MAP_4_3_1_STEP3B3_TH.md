# Document Controller Duplication Map — ERP 4.3.1 Step 3B-3

## Baseline ล่าสุด
- Controller รวม: **3,329 บรรทัด**
- Same-name pairs: **49**
- Exact same-name pairs: **9**
- Normalized duplicate 10-line groups: **193**
- Cross-controller imports: **0**

## Exact duplicates ที่เหลือระหว่าง Delivery/Tax ↔ Receipt
- `branchCompany` — Delivery line 39 / Receipt line 42
- `totals` — Delivery line 158 / Receipt line 163
- `getLockedBranch` — Delivery line 172 / Receipt line 177
- `addItem` — Delivery line 740 / Receipt line 867
- `removeItem` — Delivery line 751 / Receipt line 878
- `printableItems` — Delivery line 790 / Receipt line 917
- `paginateItems` — Delivery line 795 / Receipt line 922
- `documentPagesHtml` — Delivery line 813 / Receipt line 940
- `waitForPdfStageAssets` — Delivery line 1180 / Receipt line 1329

## การตัดสินใจ Step 3B-3
ย้ายเฉพาะ `createItem` และ `itemRowUnits` เพราะสามารถแยกเป็น context-free primitives ได้โดยคง behavior เดิม ส่วน exact duplicates ที่เหลือถูกจัดเป็น state/profile/pagination/DOM-PDF context และยังไม่ควรถูกรวมเพียงเพราะ body เหมือนกัน

ดูเหตุผลราย helper ที่ `DOCUMENT_CONTEXTUAL_HELPER_MATRIX_4_3_1_STEP3B3.json`
