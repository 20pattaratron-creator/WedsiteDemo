> สเปกฟีเจอร์ภาษีรอบถัดไป (รายงานภาษีขาย/ซื้อ, ภ.พ.30, ใบเพิ่มหนี้, 50 ทวิ, ภ.ง.ด.3/53) — ค้นคว้าเมื่อ 26 ก.ย. 2569 ยังไม่ได้พัฒนา

# ROUND 3 SPEC — Thai VAT reports, ใบเพิ่มหนี้, payer-side WHT (50 ทวิ / ภ.ง.ด.3 / ภ.ง.ด.53)

Target app: `` (plain JS, localStorage packs `biz2_{branch}_{year}_{month}`).
Research date: 2026-09-26 (พ.ศ. 2569). Thai legal terms and form labels are kept in Thai as they appear on the official forms.
Anything not confirmed from an official (rd.go.th) source is marked **[unconfirmed]**.

---

## 0. Cross-cutting facts and app baseline (read first)

### 0.1 App facts that every feature depends on
| Topic | Current state (file:line) | Consequence |
|---|---|---|
| Establishments | Two branch keys: `ubon` = "สาขาสำนักงานใหญ่", `khonkaen` = "สาขาที่ 00001" (`delivery-tax-document.js` `BRANCH_DEFAULTS`, `index.html` e-br radios) | Reports/ภ.พ.30 must run **per สถานประกอบการ** with an optional combined view. |
| Seller tax ID | `companyProfile.taxId` / `companyProfile.branches[b].taxId`, fallback placeholder `0000000000000` (`delivery-tax-document.js` `branchCompany()`, same in `receipt-document.js`) | Report header must show a warning when the tax ID is the placeholder. |
| Seller branch **code** | Not stored; only a label string. | **Gap** `companyProfile.branches[b].branchCode` (`'00000'` for HQ, `'00001'`…). Derive fallback `ubon→'00000'`, `khonkaen→'00001'`. |
| Customer master | `taxId`, `branchName`, `branchCode`, `entityType` (`company`/`person`) (`app.js` `saveCustomerMaster`, line 392) | Good source for sales-report buyer TIN/branch. |
| Supplier master | `taxId`, `entityType`, `address` — **no** `branchCode/branchName` (`app.js` `saveSupplierMaster`, line 393) | **Gap** add `branchCode`, `branchName` to supplier form (`md-s-branch-code`, `md-s-branch-name`). |
| Invoice record | `no, date (ISO CE), taxInvoiceForm ('full'|'abbreviated'), customer, customerAddress, customerTaxId, subtotal, vatAmt, total, vatMode ('add'|'extract'|'none'), useVat, branch` (`app.js` `saveInvoiceUnlocked` ~5640) | No buyer branch snapshot. **Gap** `customerBranchCode`, `customerBranchName` (credit-note UI already reads these names at `erp-credit-note.js:209` but they are never written). |
| Invoice void | Invoices are **hard-deleted** to recycle bin via `delDoc` (`app.js:6531`); no void action. `erp-integrity.js:19` already treats `voided/cancelled/status==='cancelled'` as not live. | **Gap**: issued tax invoices must be voided, not deleted: `voided, voidedAt, voidedBy, voidReason, replacedByNo`. |
| Credit note (86/10) | `creditNotes` collection; `buildCreditNoteRecord` stores `no, date, branch, customer, customerTaxId, customerBranch (label text), invoiceNos, originalValue, correctValue, differenceAmount, subtotal, vatAmt, total, voided, status` — amounts are **positive** (`erp-credit-note-core.js:541`) | Report negates them. |
| Output VAT helper | `summarizeOutputVat({invoices, creditNotes})` (`erp-credit-note-core.js:786`) nets CN VAT, uses `creditNoteInvoiceBasis` | Extend to debit notes; reuse as ภ.พ.30 line 1/5 engine. |
| Receipt WHT (customer withheld from us) | `whtRate, whtBase, whtAmount, cashReceived, whtCertNo, whtCertReceived` (`app.js:5733`), computed by `calculateWhtSummary` (base = pre-VAT) (`erp-shared-core.js:237`) | Receivable side only. Payer-side WHT needs new fields on expenses. |
| Expense record | `id, date, branch, cat, vendor (free text), desc, amount (one gross number), by, docType, taxStatus, docNo, purpose, note, attachments` (`app.js:5767`) | Missing everything needed for ภาษีซื้อ and 50 ทวิ (see §2d, §4d). |
| PO / GR | `purchaseOrders`: `supplier, supplierAddress, supplierTaxId, items, subtotal` (no VAT); `goodsReceipts`: `poNo, supplier, items, subtotal` (`erp-production-core.js:180, 205`) | No supplier tax invoice is captured for stock purchases. |
| Rounding | `roundMoneyValue` = half-up to satang per ป.86/2542 (`erp-shared-core.js`) | Reuse for every tax figure. Never recompute VAT in reports; sum stored per-document values. |
| Period lock | `ERPGovernance.assertPeriodOpen({scope:'sales'|'purchase'})` exists | Offer "ปิดงวดภาษี" after the user marks a ภ.พ.30 as filed. |
| Doc numbering | `AUTO_DOCUMENT_NUMBER_SPECS` (`app.js:5442`): QT, INV, REC, CN (`allPeriods:true`) | Add `debitNote:{prefix:'DN', collections:['debitNotes'], allPeriods:true}` and `whtCert:{prefix:'WHT', …}`. |

### 0.2 Deadlines (confirm current rule for 2026)
- **ภ.พ.30**: by the **15th** of the following month (มาตรา 83; also printed on the form, [ภ.พ.30 form 2568](https://www.rd.go.th/fileadmin/tax_pdf/vat/2568/pp30_010968.pdf)).
- **ภ.ง.ด.3 / ภ.ง.ด.53**: within **7 days** after the end of the month of payment ([RD WHT guide](https://www.rd.go.th/fileadmin/download/insight_pasi/wht_3_53_030260.pdf)).
- **e-filing +8 days**: in force for **1 ก.พ. 2567 – 31 ม.ค. 2570** → ภ.พ.30 by the **23rd**, ภ.ง.ด.3/53 by the **15th** when filed online; a deadline falling on a holiday moves to the next business day ([PEAK](https://www.peakaccount.com/blog/tax/gen-tax/tax-filing-deadline), [Tax-EZ](https://tax-ez.info/Update/View/pD7xi0Ug/), [KPMG 2025 calendar](https://assets.kpmg.com/content/dam/kpmg/th/pdf/2024/12/2025-thailand-tax-calendar-thai.pdf)). The rd.go.th announcement for the 2567–2570 period itself was not retrieved → the *official reference number* is **[unconfirmed]**; dates agree across three secondary sources. Implement as config: `TAX_DEADLINES = {pp30:{paper:15, efiling:23}, pnd3:{paper:7, efiling:15}, pnd53:{paper:7, efiling:15}, efilingExtensionUntil:'2027-01-31'}` and show "ตรวจสอบประกาศล่าสุด" after that date.
- **e-Withholding Tax 1% rate** (5/3/2% → 1% when paid through the e-Withholding Tax system) is extended **1 ม.ค. 2569 – 31 ธ.ค. 2570** ([RD news 14/2569](https://www.rd.go.th/fileadmin/user_upload/news/2569thai/news14_2569.pdf)). The demo does **not** implement e-WHT; show an info note only.

---

## 1. รายงานภาษีขาย (Output tax report)

### 1a. Legal requirements
- มาตรา 87(1) requires a รายงานภาษีขาย; entries within **3 working days** from the date on the tax invoice; records kept ≥ 5 years (มาตรา 87/3) ([rd.go.th มาตรา 87–90](https://www.rd.go.th/5209.html)).
- Form and entry rules: ประกาศอธิบดีฯ เกี่ยวกับภาษีมูลค่าเพิ่ม **ฉบับที่ 89** ([rd.go.th/3374](https://www.rd.go.th/3374.html)) as amended by **ฉบับที่ 202** (buyer TIN + สถานประกอบการ columns for invoices issued from **1 ม.ค. 2558**, required **only when the buyer is a VAT-registered operator**) ([rd.go.th/27985](https://www.rd.go.th/27985.html)); current form: [vat-202-01.pdf](https://www.rd.go.th/fileadmin/images/image_law/images/vat-202-01.pdf).
- ข้อ 7(1): full tax invoices entered per invoice. ข้อ 7(2): **ใบกำกับภาษีอย่างย่อ may be entered as one line per day** (total value + total VAT per day) instead of per invoice. ข้อ 7(10): ใบเพิ่มหนี้/ใบลดหนี้ are entered **per document** in the month they are issued.
- One report per สถานประกอบการ (the header carries the establishment).

### 1b. Exact header and columns (from the official form)
Header: `รายงานภาษีขาย` · `เดือนภาษี ……… ปี ………` · `ชื่อผู้ประกอบการ` · `เลขประจำตัวผู้เสียภาษีอากร` · `ชื่อสถานประกอบการ` · ☐ `สำนักงานใหญ่` ☐ `สาขาที่ …` · page `แผ่นที่ … ในจำนวน … แผ่น` (recommended).

| # | Column (Thai, as on form) | Source |
|---|---|---|
| 1 | `ลำดับที่` | running number |
| 2 | `ใบกำกับภาษี` → `วัน เดือน ปี` | doc date, printed in พ.ศ. |
| 3 | `ใบกำกับภาษี` → `เล่มที่/เลขที่` | `no` |
| 4 | `ชื่อผู้ซื้อสินค้า/ผู้รับบริการ` | `customer` |
| 5 | `เลขประจำตัวผู้เสียภาษีอากรของผู้ซื้อสินค้า/ผู้รับบริการ` | `customerTaxId` (13 digits) |
| 6 | `สถานประกอบการ` → `สำนักงานใหญ่` / `สาขาที่` | `customerBranchCode` |
| 7 | `มูลค่าสินค้าหรือบริการ` | pre-VAT value |
| 8 | `จำนวนเงินภาษีมูลค่าเพิ่ม` | VAT |
| 9 | `รวม` *(on form 202; commonly used as value+VAT)* | total |
| 10 | `หมายเหตุ` | e.g. `ยกเลิก`, `ใบลดหนี้อ้างอิง INV…`, `สรุปใบกำกับภาษีอย่างย่อประจำวัน` |
Footer: totals of columns 7/8/9.

### 1c. Rules
1. **Scope**: live full tax invoices (`taxInvoiceForm!=='abbreviated'`) of the selected `branch`, whose `date` falls in the tax month (use the stored pack year/month; do not re-parse).
2. **Abbreviated invoices**: group by day → one row per day: date, `เลขที่` = `"{firstNo} – {lastNo}"`, name = `ใบกำกับภาษีอย่างย่อ`, TIN/branch blank, sum value & VAT. Toggle `ลงรายการแยกรายใบ` (per invoice) allowed.
3. **Credit notes (86/10)**: one row per live CN in its *issue* month; value and VAT **negative** (`-subtotal`, `-vatAmt`); หมายเหตุ = `ใบลดหนี้ อ้างอิง {invoiceNos}`.
4. **Debit notes (86/9)**: one row per live DN in its issue month; positive; หมายเหตุ = `ใบเพิ่มหนี้ อ้างอิง …`.
5. **Voided invoices**: kept in the report so the number sequence has no gaps: value 0, VAT 0, หมายเหตุ `ยกเลิก – {voidReason}`. A voided CN/DN is omitted *(practice; the ประกาศ has no explicit void rule → **[unconfirmed]**)*. Invoices must never be hard-deleted once issued (see gap G1).
6. **No-VAT sales** (`vatMode==='none'`): not tax invoices → **excluded** from รายงานภาษีขาย but counted in ภ.พ.30 line 1/3 (exempt) *if* `vatCategory==='exempt'`. Legacy `none` rows appear in a separate "ยอดขายไม่มี VAT – ตรวจสอบ" warning box.
7. **0% sales** (export): included, VAT 0, and summed for ภ.พ.30 line 2. Needs `vatCategory:'zero'` (gap).
8. **Buyer TIN/branch**: required only if buyer is VAT-registered. If `customerTaxId` blank on a full invoice → show warning icon, not an error. Branch: code `00000` → "สำนักงานใหญ่" ✓; else "สาขาที่" + 5 digits.
9. **Value basis**: use `creditNoteInvoiceBasis(invoice)` (value=`subtotal`, vat=`total−value`) so `add`/`extract` modes are consistent with the CN module. No recomputation.
10. **Receipts**: `receipts` are **not** listed (the tax invoice is the invoice). Records in the `invoices` pack with `documentKind==='delivery-tax-invoice'` (printed copies surfaced as `issuedInvoices`, `app.js:1026`) must be **de-duplicated** against their source invoice — list the business invoice only.
11. Sort: date, then number. Totals rounded per row already; footer = plain sum then `roundMoneyValue`.
12. Late entry warning: if `createdAt` > doc date + 3 working days, flag "ลงรายการเกิน 3 วันทำการ" (informational).

### 1d. Mapping and gaps
| Need | Existing | Gap / suggested field |
|---|---|---|
| Seller TIN / branch code | `companyProfile.taxId`, label only | G2 `companyProfile.branches[b].branchCode` |
| Buyer branch | customer master `branchCode/branchName` | G3 snapshot `invoice.customerBranchCode`, `invoice.customerBranchName` at save (autofill from master) |
| 0%/exempt split | `vatMode:'none'` only | G4 `invoice.vatCategory: 'standard'|'zero'|'exempt'` (default `standard`; legacy `none`→`exempt`+warning) |
| Void | hard delete | G1 `voided, voidedAt, voidedBy, voidReason` + "ยกเลิกใบกำกับภาษี" action; block `delDoc` for invoices with a number |
| Debit notes | — | new `debitNotes` collection (§3) |

### 1e. Acceptance criteria
- AC1.1 Sept 2569, `ubon`: INV A (subtotal 10,000.00 / VAT 700.00), CN (subtotal 1,000.00 / VAT 70.00) → rows: A = 10,000.00/700.00; CN = −1,000.00/−70.00; footer 9,000.00/630.00.
- AC1.2 Three abbreviated invoices on 2026-09-05 (107.00, 214.00, 53.50 VAT-incl.) → one row dated 05/09/2569, value 350.00, VAT 24.50 (sum of stored per-invoice values: 100.00+200.00+50.00 / 7.00+14.00+3.50).
- AC1.3 A voided invoice appears with 0.00/0.00 and "ยกเลิก"; a voided CN does not appear.
- AC1.4 An invoice dated 2026-09-30 is in September; its CN dated 2026-10-02 appears only in October.
- AC1.5 Invoice with `vatMode:'none'` is absent from the report and listed in the warning box.
- AC1.6 `khonkaen` report header shows "สาขาที่ 00001"; `ubon` shows ☑ สำนักงานใหญ่.
- AC1.7 A buyer with `branchCode:'00003'` prints "สาขาที่ 00003"; blank TIN on a full invoice shows a warning, report still generates.
- AC1.8 Export (XLSX/CSV/print) columns equal §1b order.

---

## 2. รายงานภาษีซื้อ (Input tax report)

### 2a. Legal requirements
- มาตรา 87(2); ประกาศฯ ฉบับที่ 89 ข้อ 8: entries within **3 working days from the day the tax invoice is received**; documents filed by tax month in order received ([rd.go.th/3374](https://www.rd.go.th/3374.html)). Seller TIN + สถานประกอบการ columns required for invoices from VAT-registered sellers (ฉบับที่ 202, [rd.go.th/27985](https://www.rd.go.th/27985.html)). ข้อ 8(7): DN/CN received are entered per document.
- **Claim window**: มาตรา 82/3 — input tax may be claimed in the month of the invoice or, if not possible, within **6 months** after the month shown on the invoice ([rd.go.th หมวด 4](https://www.rd.go.th/2596.html)). Exact counting convention ("6 months from the month following the invoice month") is **[unconfirmed]** — implement as "claim month ≤ invoice month + 6" and warn beyond.
- **ภาษีซื้อต้องห้าม** (มาตรา 82/5, same source), examples to model: (1) no tax invoice / no evidence; (2) tax invoice with incomplete/incorrect particulars; (3) not related to the business; (4) ค่ารับรอง (entertainment); (5) invoice issued by a non-registrant; (6) others prescribed by the Director-General — notably **รถยนต์นั่ง/รถยนต์โดยสารไม่เกิน 10 คน** (purchase, rent, fuel/repair) and **ใบกำกับภาษีอย่างย่อ** (abbreviated invoices cannot support an input-tax claim). The (6) sub-list is from general knowledge; **[unconfirmed]** against the ประกาศ text.
- Debit note received: buyer claims in the month the DN is **received** (คำสั่ง ป.80/2542, [rd.go.th/3574](https://www.rd.go.th/3574.html)); credit note received reduces input VAT in the month received.

### 2b. Header and columns
Header as §1b but title `รายงานภาษีซื้อ`.

| # | Column | Source |
|---|---|---|
| 1 | `ลำดับที่` | |
| 2 | `ใบกำกับภาษี` → `วัน เดือน ปี` | `taxInvoiceDate` |
| 3 | `ใบกำกับภาษี` → `เล่มที่/เลขที่` | `taxInvoiceNo` |
| 4 | `ชื่อผู้ขายสินค้า/ผู้ให้บริการ` | `vendor` |
| 5 | `เลขประจำตัวผู้เสียภาษีอากรของผู้ขายสินค้า/ผู้ให้บริการ` | `vendorTaxId` |
| 6 | `สถานประกอบการ` → `สำนักงานใหญ่` / `สาขาที่` | `vendorBranchCode` |
| 7 | `มูลค่าสินค้าหรือบริการ` | `subtotal` |
| 8 | `จำนวนเงินภาษีมูลค่าเพิ่ม` | `vatAmt` |
| 9 | `หมายเหตุ` | `วันที่ได้รับ`, `ใบลดหนี้/ใบเพิ่มหนี้` |

### 2c. Rules
1. Scope = purchase docs with `inputVatClaimable===true`, `vatAmt>0`, `docType ∈ {tax_invoice, receipt_tax_invoice, debit_note_received, credit_note_received}`, and **`claimPeriod` (YYYY-MM) = report month** (not the invoice date).
2. `claimPeriod` defaults to the month of `taxInvoiceReceivedDate`; user may move it forward; block if > invoice month + 6 (82/3) with message "เกินกำหนดใช้สิทธิ 6 เดือน".
3. Abbreviated invoices, `receipt`, `invoice`, `other`, `none` → never in the report; their VAT (if entered) is **ภาษีซื้อต้องห้าม** → expense cost.
4. Forbidden reasons (`nonClaimableReason`): `no_tax_invoice`, `incomplete_invoice`, `not_business`, `entertainment`, `passenger_car`, `abbreviated`, `seller_not_registered`, `other`. Such rows go to a separate "ภาษีซื้อต้องห้าม" listing (not the official report).
5. Credit note received → negative row in the month received.
6. Duplicate guard: same `vendorTaxId`+`taxInvoiceNo` cannot be claimed twice (extend `expenseDocumentExistsForWrite`).
7. Sort by `taxInvoiceReceivedDate` (order received).

### 2d. Mapping and gaps (expense module → "purchase tax document")
Existing expense fields map as: `vendor`→col 4; `docNo`→col 3 (rename semantic to `taxInvoiceNo` when `docType` is a tax invoice); `docType`/`taxStatus` → eligibility; `amount`→gross total. Missing (suggested names, all on the expense record):

| Field | Purpose |
|---|---|
| `vendorId` | link to supplier master (autofill TIN/branch/address/entityType) |
| `vendorTaxId`, `vendorBranchCode`, `vendorAddress` | snapshot for report and 50 ทวิ |
| `vatMode` (`add`/`extract`/`none`), `subtotal`, `vatAmt` | split of `amount` via `calculateVatSummary`; `amount` stays = total |
| `taxInvoiceDate`, `taxInvoiceReceivedDate` | col 2 and 3-working-day rule |
| `claimPeriod` ('YYYY-MM') | month the input VAT is claimed |
| `inputVatClaimable` (bool), `nonClaimableReason` | 82/5 |
| `sourceGrId`, `sourcePoId` | capture supplier tax invoices for stock purchases (GR has no VAT today) |
| `vatCategory` | `standard` / `zero` / `exempt` |
Supplier master gap: `branchCode`, `branchName` (G5).

### 2e. Acceptance criteria
- AC2.1 Expense 2,140.00 `extract`, full tax invoice, claimable, claimPeriod 2026-09 → row value 2,000.00, VAT 140.00 in Sept.
- AC2.2 Same but `docType:'abbreviated_tax_invoice'` → absent from report; appears in ภาษีซื้อต้องห้าม list with reason `abbreviated`.
- AC2.3 Invoice dated 2026-02-10, claimPeriod 2026-09 → rejected (>6 months); claimPeriod 2026-08 → accepted.
- AC2.4 Duplicate `vendorTaxId`+`taxInvoiceNo` → save blocked.
- AC2.5 `passenger_car` fuel receipt with VAT 70.00 → not in report; `vatAmt` posted to expense cost.
- AC2.6 Legacy expense without `vatAmt` → not in report; badge "ข้อมูล VAT ไม่ครบ".

---

## 3. ภ.พ.30 summary

### 3a. Source
Current form [pp30_010968.pdf (2568)](https://www.rd.go.th/fileadmin/tax_pdf/vat/2568/pp30_010968.pdf); deadline §0.2. Header: `เดือนภาษี`, `พ.ศ.`, ☐ `ยื่นปกติ` ☐ `ยื่นเพิ่มเติมครั้งที่ …`, ☐ `แยกยื่นเป็นรายสถานประกอบการ` ☐ `ยื่นรวมกัน`, seller name/TIN/`สำนักงานใหญ่`/`สาขาที่`. Filing is per establishment unless approved to file combined → default per branch; "ยื่นรวมกัน" = sum of both branches, as a setting (`companyProfile.vatFilingMode:'separate'|'combined'`).

### 3b. Line items (Thai as on form; implement 1–12, show 13–16 as "ไม่คำนวณในเดโม")
| Line | Label | Formula in app |
|---|---|---|
| 1 | ยอดขายในเดือนนี้ | Σ value of live full + abbreviated invoices (all vatCategories) + DN value − CN value |
| 2 | ลบ ยอดขายที่เสียภาษีในอัตราร้อยละ 0 (ถ้ามี) | Σ where `vatCategory==='zero'` |
| 3 | ลบ ยอดขายที่ได้รับยกเว้น (ถ้ามี) | Σ where `vatCategory==='exempt'` |
| 4 | ยอดขายที่ต้องเสียภาษี (1. − 2. − 3.) | |
| 5 | ภาษีขายเดือนนี้ | Σ VAT of sales-report rows (= footer col 8 of §1) |
| 6 | ยอดซื้อที่มีสิทธินำภาษีซื้อมาหักในการคำนวณภาษีเดือนนี้ | footer col 7 of §2 |
| 7 | ภาษีซื้อเดือนนี้ (ตามหลักฐานใบกำกับภาษีของยอดซื้อตาม 6.) | footer col 8 of §2 |
| 8 | ภาษีที่ต้องชำระเดือนนี้ (ถ้า 5. มากกว่า 7.) | max(0, 5−7) |
| 9 | ภาษีที่ชำระเกินเดือนนี้ (ถ้า 5. น้อยกว่า 7.) | max(0, 7−5) |
| 10 | ภาษีที่ชำระเกินยกมา | previous period's line 12 if that period chose "ยกไปเดือนถัดไป"; else manual input `pp30.carryForwardIn` |
| 11 | ต้องชำระ (ถ้า 8. มากกว่า 10.) | max(0, 8−10) |
| 12 | ชำระเกิน (ถ้า 10. มากกว่า 8. หรือ 9. รวมกับ 10.) | if 9>0: 9+10 else max(0, 10−8) |
| 13–16 | เงินเพิ่ม / เบี้ยปรับ / รวมภาษี เงินเพิ่ม และเบี้ยปรับ / รวมภาษีที่ชำระเกิน… | out of scope → 0 with note |
When line 12 > 0 the user picks ☐ ขอคืนเป็นเงินสด ☐ ขอนำไปชำระในเดือนถัดไป (`pp30.overpaidAction:'refund'|'carry'`).

### 3c. Rules
- Lines 5 and 7 must equal the report footers exactly (single source of truth).
- Store a snapshot on "บันทึกว่ายื่นแล้ว": `vatReturns` collection `{id, branch, period:'YYYY-MM', filingMode, lines:{1..12}, carryForwardIn, overpaidAction, filedAt, filedBy, channel:'paper'|'efiling', dueDate}`; then optionally `ERPGovernance` lock scope `sales`+`purchase` through period end. Amendments after filing → "ยื่นเพิ่มเติมครั้งที่ n" snapshot, never overwrite.
- Due date shown = 15th (paper) / 23rd (e-filing) of next month, rolled to the next business day for e-filing (holiday calendar: weekends only in demo; public holidays **[unconfirmed data source]**).

### 3d. Gaps
G4 `vatCategory`; G6 `vatReturns` collection; G7 `companyProfile.vatFilingMode`.

### 3e. Acceptance criteria
- AC3.1 Sept 2569 `ubon`: INV 10,000/700, CN 1,000/70, DN 500/35, purchases 2,000/140 claimable → L1 9,500.00, L4 9,500.00, L5 665.00, L6 2,000.00, L7 140.00, L8 525.00, L9 0, L10 0, L11 525.00.
- AC3.2 Purchases VAT 900 vs output 665 → L9 235.00; with carry 100 → L12 335.00.
- AC3.3 Data of AC3.1 (L8 525.00) plus L10 carry 1,000.00 → L11 0.00, L12 475.00.
- AC3.4 Combined mode sums both branches; separate mode never mixes branches.
- AC3.5 Due date for Sept 2569: paper 15 Oct 2026; e-filing 23 Oct 2026 (Fri).

---

## 4. ใบเพิ่มหนี้ (มาตรา 86/9)

### 4a. Legal
- มาตรา 82/9 events: goods — `เพิ่มราคาสินค้าที่ขายเนื่องจากสินค้าเกินกว่าจำนวนที่ตกลงซื้อขายกัน`, `คำนวณราคาสินค้าผิดพลาดต่ำกว่าที่เป็นจริง`; services — `เพิ่มราคาค่าบริการเนื่องจากให้บริการเกินกว่าข้อกำหนดที่ตกลงกัน`, `คำนวณราคาค่าบริการผิดพลาดต่ำกว่าที่เป็นจริง`; or `เหตุอื่นตามที่อธิบดีกำหนด` ([paseetax 82/9](https://www.paseetax.com/article/%E0%B8%A1%E0%B8%B2%E0%B8%95%E0%B8%A3%E0%B8%B2-82-9-%E0%B9%83%E0%B8%9A%E0%B9%80%E0%B8%9E%E0%B8%B4%E0%B9%88%E0%B8%A1%E0%B8%AB%E0%B8%99%E0%B8%B5%E0%B9%89-6790.html)).
- มาตรา 86/9: issue in the tax month the event occurs; mandatory contents ([Legardy, Revenue Code 86–86/14](https://legardy.com/thai-law/revenue-code/revenue-code-vat-tax-invoices-section-86-14)):
  (ก) คำว่า "ใบเพิ่มหนี้" ในที่ที่เห็นได้เด่นชัด; (ข) ชื่อ ที่อยู่ และเลขประจำตัวผู้เสียภาษีอากรของผู้ออก; (ค) ชื่อ ที่อยู่ของผู้ซื้อสินค้าหรือผู้รับบริการ; (ง) วัน เดือน ปี ที่ออก; (จ) หมายเลขลำดับของใบกำกับภาษีเดิม มูลค่าสินค้าหรือบริการตามใบกำกับภาษีเดิม มูลค่าที่ถูกต้อง ผลต่าง และจำนวนภาษีที่เรียกเก็บเพิ่ม; (ฉ) คำอธิบายสั้น ๆ ถึงสาเหตุ; (ช) ข้อความอื่นที่อธิบดีกำหนด. Same structure as 86/10 except the title and "ภาษีที่เรียกเก็บเพิ่ม" instead of "ภาษีที่ใช้คืน". Seller-side TIN/branch of buyer, and the issuer's `สำนักงานใหญ่/สาขาที่`, follow the tax-invoice rule (ประกาศ ฉบับที่ 199) — **[unconfirmed]** that it applies identically to DN; implement anyway (mirrors current CN).
- VAT effect: seller adds DN VAT to ภาษีขาย **in the month the DN is issued**; buyer claims it as ภาษีซื้อ in the month **received** (ป.80/2542, [rd.go.th/3574](https://www.rd.go.th/3574.html)).

### 4b. Record (`debitNotes` collection, mirror of `buildCreditNoteRecord`)
`id, no (DN-…), date, branch, documentKind:'debit-note', customer, customerAddress, customerTaxId, customerBranchCode, customerBranch, reasonCode, reasonLabel, reasonText, vatMode, lines:[{invoiceId, invoiceNo, invoiceBranch, invoiceDate, originalValue, correctValue, differenceValue, vat}], invoiceNos, originalValue, correctValue, differenceAmount, subtotal, vatAmt, total, note, status:'issued'|'voided', voided, voidedAt, voidedBy, voidReason, createdAt, createdBy, updatedAt, updatedBy`.
`DEBIT_NOTE_REASONS`: `goods_over_quantity`, `goods_price_undercharged`, `service_over_scope`, `service_price_undercharged`, `other` (with Thai labels above).

### 4c. Rules
1. `correctValue > originalValue` for every line; `differenceValue = correct − original`; VAT = `roundMoneyValue(difference × 7%)` for `add`; for `extract`, difference is VAT-inclusive and VAT = diff − diff/1.07 (reuse `calculateCreditNote` math with sign flipped).
2. `originalValue` = invoice basis value + prior DN − prior CN on that invoice (so repeated adjustments chain correctly).
3. One DN may reference several invoices of **one customer** (same rule the CN validator enforces; **[unconfirmed]** legally, conservative).
4. Referenced invoice must be live, full-form, of the same branch; referencing an abbreviated invoice is blocked in the demo (buyer name/address are mandatory on a DN) — mirrors `creditNoteRequiresBuyerName`.
5. DN date ≥ invoice date; DN period must be open (`assertPeriodOpen scope:'sales'`).
6. AR: DN total increases the invoice's receivable (`ERPIntegrity.paymentSummary` gains `debited`); AR aging treats DN as a separate open item due on its date (or append to invoice – choose "separate item", simpler).
7. Void, never delete; numbering never reused (`allPeriods:true`).
8. Print layout = copy of `credit-note-document.js`, title "ใบเพิ่มหนี้ / DEBIT NOTE", column "ภาษีที่เรียกเก็บเพิ่ม".

### 4d. Gaps
G8 `debitNotes` collection + core module `erp-debit-note-core.js`; G9 `paymentSummary.debited`; G10 `summarizeOutputVat` accepts `debitNotes`.

### 4e. Acceptance criteria
- AC4.1 INV 10,000/700 (`add`), DN correct 10,500 → diff 500.00, VAT 35.00, total 535.00; Sept output VAT +35.00.
- AC4.2 `extract` invoice 10,700 incl., DN correct 11,235 incl. → diff value 500.00, VAT 35.00.
- AC4.3 correctValue ≤ originalValue → error "มูลค่าที่ถูกต้องต้องมากกว่ามูลค่าเดิม".
- AC4.4 DN on two customers' invoices → rejected. DN on abbreviated invoice → rejected.
- AC4.5 Voided DN excluded from §1 and ภ.พ.30; its number is not reissued.
- AC4.6 Printed DN contains every item (ก)–(ฉ) (DOM test for each label).
- AC4.7 Invoice with CN 1,000 then DN 300 → DN originalValue 9,000.00.

---

## 5. Payer-side WHT: 50 ทวิ, ภ.ง.ด.3, ภ.ง.ด.53

### 5a. Legal
- Rates (คำสั่ง ท.ป.4/2528, [rd.go.th/3479](https://www.rd.go.th/3479.html); RD guide [wht_3_53](https://www.rd.go.th/fileadmin/download/insight_pasi/wht_3_53_030260.pdf)) — same for individual and juristic payees unless noted:

| `whtIncomeType` code | Thai label | Rate |
|---|---|---|
| `service` | ค่าบริการ | 3% |
| `hire_of_work` | ค่าจ้างทำของ | 3% |
| `professional` | ค่าวิชาชีพอิสระ (40(6)) | 3% |
| `rent` | ค่าเช่า | 5% |
| `advertising` | ค่าโฆษณา | 2% |
| `transport` | ค่าขนส่ง (ไม่ใช่ขนส่งสาธารณะ) | 1% |
| `prize` / `other` | รางวัล/อื่น ๆ | user-entered |
- **1,000-baht rule**: withholding under these clauses applies when the amount paid (per contract/payment) is **≥ 1,000 baht** (RD guide). Whether the threshold also applies to **rent** is **[unconfirmed]** → make it per-type config (`thresholdBaht`), default 1,000 for all, with a manual "หักแม้ต่ำกว่า 1,000" override.
- **Base excludes VAT** when the payee is a VAT registrant and VAT is shown separately — universal practice and already how `calculateWhtSummary` works; the precise official clause was **not retrieved → [unconfirmed]**.
- **ภ.ง.ด.3** = payee is บุคคลธรรมดา (incl. ห้างหุ้นส่วนสามัญ/คณะบุคคล); **ภ.ง.ด.53** = payee is นิติบุคคล (RD guide; [FlowAccount](https://flowaccount.com/blog/wht-pnd3-pnd53-basic-knowledge/)). File only for months with withholding. Deadlines §0.2.
- **50 ทวิ timing**: issue to the payee **at the time of payment/withholding** each time for contractors/suppliers (employees: by Feb 15 — out of scope) ([FlowAccount 50 ทวิ](https://flowaccount.com/blog/withholding-tax-certificate/)). Statutory wording "ในขณะที่หักภาษี" from มาตรา 50 ทวิ is from general knowledge **[unconfirmed quote]**.
- e-WHT 1% (2569–2570) exists; not modelled (§0.2).

### 5b1. 50 ทวิ fields (official form [approve_wh3_081156.pdf](https://www.rd.go.th/fileadmin/tax_pdf/withhold/approve_wh3_081156.pdf) + [Inflow Account](https://inflowaccount.co.th/withholding-tax-certificate/))
- Title `หนังสือรับรองการหักภาษี ณ ที่จ่าย ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร`; `เล่มที่ … เลขที่ …`.
- Copies: `ฉบับที่ 1 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย ใช้แนบพร้อมกับแบบแสดงรายการภาษี)`; `ฉบับที่ 2 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย เก็บไว้เป็นหลักฐาน)`. (Payer keeps its own copy as file evidence — print a 3rd "สำเนา" optional **[unconfirmed]**.)
- `ผู้มีหน้าที่หักภาษี ณ ที่จ่าย`: ชื่อ, ที่อยู่, เลขประจำตัวผู้เสียภาษีอากร (13 หลัก).
- `ผู้ถูกหักภาษี ณ ที่จ่าย`: ชื่อ, ที่อยู่, เลขประจำตัวผู้เสียภาษีอากร (13 หลัก).
- `ลำดับที่ … ในแบบ` ☐ ภ.ง.ด.1ก ☐ ภ.ง.ด.1ก พิเศษ ☐ ภ.ง.ด.2 ☐ ภ.ง.ด.3 ☐ ภ.ง.ด.2ก ☐ ภ.ง.ด.3ก ☐ ภ.ง.ด.53 — the sequence number must match the row on the ใบแนบ.
- Table columns: `ประเภทเงินได้พึงประเมินที่จ่าย` | `วัน เดือน หรือปีภาษี ที่จ่าย` | `จำนวนเงินที่จ่าย` | `ภาษีที่หักและนำส่งไว้`. Rows: 1. เงินเดือน ค่าจ้าง ฯลฯ 40(1); 2. ค่าธรรมเนียม ค่านายหน้า ฯลฯ 40(2); 3. ค่าแห่งลิขสิทธิ์ ฯลฯ 40(3); 4.(ก) ดอกเบี้ย ฯลฯ 40(4)(ก); 4.(ข) เงินปันผล (sub-rows); **5. การจ่ายเงินได้ที่ต้องหักภาษี ณ ที่จ่าย ตามคำสั่งกรมสรรพากรที่ออกตามมาตรา 3 เตรส (ระบุ) เช่น รางวัล … ค่าจ้างทำของ ค่าโฆษณา ค่าเช่า ค่าขนส่ง ค่าบริการ ค่าเบี้ยประกันวินาศภัย ฯลฯ**; 6. อื่น ๆ (ระบุ). SME payments (service, hire, rent, advertising, transport, professional) → **row 5** with the type text in "(ระบุ)" (placing 40(6) professional fees in row 5 vs 6 **[unconfirmed]**; use row 5).
- `รวมเงินที่จ่ายและภาษีที่หักนำส่ง`; `รวมเงินภาษีที่หักนำส่ง (ตัวอักษร)` (Thai baht text — reuse existing baht-text helper).
- Fund fields (`กองทุนสงเคราะห์ครูโรงเรียนเอกชน`, `กองทุนประกันสังคม`, `กองทุนสำรองเลี้ยงชีพ`) — print blank.
- `ผู้จ่ายเงิน` ☐ (1) หัก ณ ที่จ่าย ☐ (2) ออกให้ตลอดไป ☐ (3) ออกให้ครั้งเดียว ☐ (4) อื่น ๆ (ระบุ).
- Certification `ขอรับรองว่าข้อความและตัวเลขดังกล่าวข้างต้นถูกต้องตรงกับความจริงทุกประการ`, `ลงชื่อ … ผู้จ่ายเงิน`, `วัน เดือน ปี ที่ออกหนังสือรับรองฯ`, `ประทับตรานิติบุคคล (ถ้ามี)`.

### 5b2. ใบแนบ ภ.ง.ด.3 / ภ.ง.ด.53 columns ([attach3](https://www.rd.go.th/fileadmin/tax_pdf/withhold/270360_attach3.pdf), [attach53](https://www.rd.go.th/fileadmin/tax_pdf/withhold/290360_attach53.pdf))
Header: payer `เลขประจำตัวผู้เสียภาษีอากร`, `สาขาที่` (payer's 5-digit branch), `แผ่นที่ … ในจำนวน … แผ่น`.
| ภ.ง.ด.3 | ภ.ง.ด.53 |
|---|---|
| ลำดับที่ | ลำดับที่ |
| เลขประจำตัวผู้เสียภาษีอากร (of payee) | เลขประจำตัวผู้เสียภาษีอากร + สาขาที่ (of payee) |
| ชื่อผู้มีเงินได้ / ที่อยู่ของผู้มีเงินได้ | ชื่อและที่อยู่ของผู้มีเงินได้ |
| วัน เดือน ปี ที่จ่าย | วัน เดือน ปี ที่จ่าย |
| ประเภทเงินได้ | ประเภทเงินได้พึงประเมินที่จ่าย |
| อัตราภาษีร้อยละ | อัตราภาษีร้อยละ |
| จำนวนเงินที่จ่ายแต่ละประเภท | จำนวนเงินที่จ่ายในครั้งนี้ |
| จำนวนเงินภาษีที่หักและนำส่ง | จำนวนเงินภาษีที่หักและนำส่ง |
| เงื่อนไข (1 หัก ณ ที่จ่าย, 2 ออกให้ตลอดไป, 3 ออกให้ครั้งเดียว) | เงื่อนไข (same codes) |
Footer: ลงชื่อ … ผู้จ่ายเงิน, ตำแหน่ง, ยื่นวันที่. Main form summary (ภ.ง.ด.3/53 page 1): count of payees, total paid, total tax — generate from rows. (ภ.ง.ด.3 form's "มาตรา 3 เตรส / 48 ทวิ / 50" and ภ.ง.ด.53's "มาตรา 3 เตรส / 65 จัตวา / 69 ทวิ" checkboxes: default 3 เตรส.)

### 5c. Rules
1. WHT is recorded on a **payment** (expense payment), not on the supplier invoice: `paymentDate` determines ภ.ง.ด. month and 50 ทวิ date.
2. `form = payeeEntityType==='company' ? 'PND53' : 'PND3'` (from supplier `entityType`).
3. Condition 1 (หัก ณ ที่จ่าย): `whtAmount = round(base × r)`, `netPaid = subtotal + vat − whtAmount`; `amountPaid` reported = base.
4. Condition 2 (ออกให้ตลอดไป — payer bears tax every time; gross-up): `amountPaid = round(base / (1 − r))`, `whtAmount = amountPaid − base`; the payee receives base + VAT in cash. Formula is accepted practice **[unconfirmed official]**.
5. Condition 3 (ออกให้ครั้งเดียว): `whtAmount = round(base × r)`, `amountPaid = base`, payee receives base + VAT; payer's extra tax is an expense.
6. Threshold: if base < `thresholdBaht` → WHT defaults to 0 with note; user override allowed.
7. Certificate numbering: `whtCertBook` (เล่มที่ = BE year) + running `whtCertNo` per payer branch; `ลำดับที่ในแบบ` assigned when the monthly ภ.ง.ด. is generated (ordered by paymentDate, then certificate no.) and written back to the certificate before printing the final copy.
8. Rounding half-up to satang (`roundMoneyValue`); totals are sums of stored per-payment values.
9. Reports per payer establishment (branch) per month; void certificate → excluded, number kept.
10. Missing payee TIN → block certificate issue ("ต้องมีเลขประจำตัวผู้เสียภาษี 13 หลัก"); validate 13-digit checksum (mod-11) as warning.

### 5d. Mapping and gaps
Existing: supplier master `entityType`, `taxId`, `address` ✔; receipt-side WHT (`calculateWhtSummary`, `WHT_RATE_PRESETS`) ✔ reusable math. Missing on expense/payment (suggested fields): `vendorId`, `payeeEntityType`, `payeeTaxId`, `payeeBranchCode`, `payeeAddress`, `whtIncomeType`, `whtIncomeLabel`, `whtRate`, `whtBase`, `whtAmount`, `whtCondition (1|2|3|4)`, `whtForm ('PND3'|'PND53')`, `paymentDate`, `netPaid`, `whtCertId`. New collection `whtCertificates`: `{id, bookNo, certNo, branch, payer{name,address,taxId,branchCode}, payee{name,address,taxId,branchCode,entityType}, form, seqInForm, rows:[{incomeRow:5, incomeLabel, paidDate, amountPaid, taxWithheld}], totalPaid, totalTax, totalTaxText, condition, issuedAt, sourceExpenseIds, voided…}`. New `whtFilings` snapshot `{branch, period, form, rows, totals, filedAt, channel, dueDate}`. Extend `WHT_RATE_PRESETS` with `code`/`thresholdBaht`.

### 5e. Acceptance criteria
- AC5.1 Pay juristic supplier service 10,000 + VAT 700, 3%, cond 1 → WHT 300.00, netPaid 10,400.00; 50 ทวิ ☑ ภ.ง.ด.53, row 5 "ค่าบริการ" 10,000.00 / 300.00; appears in ภ.ง.ด.53 of the payment month.
- AC5.2 Rent 20,000 to an individual (no VAT), 5% → 1,000.00; ☑ ภ.ง.ด.3.
- AC5.3 Cond 2, base 9,700, 3% → amountPaid 10,000.00, WHT 300.00; ใบแนบ เงื่อนไข = 2.
- AC5.4 Service 800 → WHT 0 by default; override to 3% gives 24.00.
- AC5.5 Transport 5,000 → 50.00 (1%); advertising 5,000 → 100.00 (2%).
- AC5.6 ภ.ง.ด.53 Sept totals = Σ rows; `seqInForm` on each certificate equals its row number.
- AC5.7 Due dates Sept 2569 payments: paper 7 Oct 2026, e-filing 15 Oct 2026.
- AC5.8 Supplier without TIN → cannot issue 50 ทวิ.
- AC5.9 Printed certificate shows both copy captions verbatim and the amount in Thai words.

---

## 6. Minimal double-entry design (for later backend)

Chart of accounts (TFRS for NPAEs style; codes indicative):
`1110 เงินสด` · `1120 เงินฝากธนาคาร` · `1130 ลูกหนี้การค้า` · `1140 สินค้าคงเหลือ` · `1150 ภาษีซื้อ` · `1151 ภาษีซื้อยังไม่ถึงกำหนด` · `1160 ภาษีเงินได้ถูกหัก ณ ที่จ่าย` · `1170 ลูกหนี้กรมสรรพากร (ภาษีชำระเกิน)` · `2110 เจ้าหนี้การค้า` · `2120 ภาษีขาย` · `2121 ภาษีขายยังไม่ถึงกำหนด` · `2130 ภาษีเงินได้หัก ณ ที่จ่ายค้างจ่าย (ภ.ง.ด.3/53)` · `2140 ภาษีมูลค่าเพิ่มค้างจ่าย` · `4110 รายได้จากการขาย` · `4120 รายได้ค่าบริการ` · `4190 รับคืนและส่วนลดจ่าย` · `5110 ต้นทุนขาย` · `5200 ค่าใช้จ่ายในการขายและบริหาร` · `5290 ภาษีซื้อต้องห้าม/ภาษีที่ออกแทน (ไม่ใช่รายจ่ายหักได้ในบางกรณี)`.

| Event | Dr | Cr |
|---|---|---|
| Tax invoice (goods) | 1130 total | 4110 value; 2120 VAT |
| Receipt with customer WHT | 1120 cashReceived; 1160 whtAmount | 1130 total |
| Credit note 86/10 | 4190 value; 2120 VAT | 1130 total |
| Debit note 86/9 | 1130 total | 4110 value; 2120 VAT |
| Expense with full tax invoice, WHT cond 1 | 5200 value; 1150 VAT (claimable) *or* 5200 (+VAT if forbidden) | 1120 netPaid; 2130 WHT |
| WHT cond 2/3 (payer bears) | extra 5200 for WHT borne | 2130 WHT |
| Remit ภ.ง.ด.3/53 | 2130 | 1120 |
| ภ.พ.30 close | 2120 output VAT | 1150 input VAT; 2140 payable (or Dr 1170 overpaid) |
| Pay ภ.พ.30 | 2140 | 1120 |
Services note: VAT tax point for services is on **payment** (มาตรา 78/1) → service invoices issued before payment post VAT to 2121 and move to 2120 on receipt. The current app treats every invoice as a goods tax invoice — flag for backend design.
Implementation hint: generate journals as a pure derived view (`buildJournal(doc)`) from stored documents, balanced per document (Σ Dr = Σ Cr), never edited by hand in the demo.

## 7. ERP sales-demo best practices (brief)
1. Script the demo around the prospect's own processes, not a feature tour ([Panorama](https://www.panorama-consulting.com/erp-demos-tips/), [ERP Focus](https://www.erpfocus.com/erp-demo-scripts-guide.html)).
2. Use industry-realistic data (Thai company names, real-looking 13-digit TIN pattern, sensible amounts, head office + branch 00001) — Panorama recommends demo data that reflects the buyer's business.
3. Show a process end to end: ใบเสนอราคา → ใบกำกับภาษี → รับเงิน/หัก ณ ที่จ่าย → ใบลดหนี้/ใบเพิ่มหนี้ → รายงานภาษีขาย → ภ.พ.30 (Panorama: "data move from the beginning to the end of a process").
4. Demo reports alongside transactions (Panorama); for Thai SMEs the month-end tax pack (รายงานภาษีขาย/ซื้อ, ภ.พ.30, ภ.ง.ด.53, 50 ทวิ) is the "wow".
5. "Do the last thing first": open with the finished month-end dashboard/ภ.พ.30, then show how it was produced (Peter Cohan, *Great Demo!*).
6. Seed a scripted month with deliberate edge cases (voided invoice, CN, DN, forbidden input VAT, below-1,000 payment) so the system's controls are visible.
7. Keep a one-click reset to the known seed state before every meeting; rehearse with a timekeeper and leave time for Q&A (Panorama).
8. Give prospects a short scoring/checklist sheet aligned to the script (Panorama).
9. Clearly label demo-only limitations (no e-filing, localStorage) to preserve trust.

## 8. Consolidated gap list (for the engineering backlog)
G1 invoice void instead of delete · G2 seller `branchCode` · G3 invoice buyer branch snapshot · G4 `vatCategory` on invoices/expenses · G5 supplier `branchCode/branchName` · G6 `vatReturns` snapshots · G7 `vatFilingMode` · G8 `debitNotes` + core · G9 `paymentSummary.debited` · G10 `summarizeOutputVat` with DN · G11 expense VAT split + tax-invoice fields + `claimPeriod` + 82/5 flags · G12 expense payment WHT fields · G13 `whtCertificates` + `whtFilings` · G14 dedupe `documentKind:'delivery-tax-invoice'` rows in reports · G15 capture supplier tax invoices for GR-based stock purchases.

## Sources
rd.go.th: [ประกาศฯ ฉบับที่ 89](https://www.rd.go.th/3374.html) · [ฉบับที่ 202](https://www.rd.go.th/27985.html) · [รายงานภาษีขาย form](https://www.rd.go.th/fileadmin/images/image_law/images/vat-202-01.pdf) · [มาตรา 87–90](https://www.rd.go.th/5209.html) · [หมวด 4 VAT](https://www.rd.go.th/2596.html) · [ป.80/2542](https://www.rd.go.th/3574.html) · [ภ.พ.30 form](https://www.rd.go.th/fileadmin/tax_pdf/vat/2568/pp30_010968.pdf) · [ท.ป.4/2528](https://www.rd.go.th/3479.html) · [WHT guide 3/53](https://www.rd.go.th/fileadmin/download/insight_pasi/wht_3_53_030260.pdf) · [50 ทวิ form](https://www.rd.go.th/fileadmin/tax_pdf/withhold/approve_wh3_081156.pdf) · [ใบแนบ ภ.ง.ด.3](https://www.rd.go.th/fileadmin/tax_pdf/withhold/270360_attach3.pdf) · [ใบแนบ ภ.ง.ด.53](https://www.rd.go.th/fileadmin/tax_pdf/withhold/290360_attach53.pdf) · [RD news 14/2569 e-WHT](https://www.rd.go.th/fileadmin/user_upload/news/2569thai/news14_2569.pdf).
Secondary: [PEAK e-filing extension](https://www.peakaccount.com/blog/tax/gen-tax/tax-filing-deadline) · [Tax-EZ](https://tax-ez.info/Update/View/pD7xi0Ug/) · [KPMG 2025 tax calendar](https://assets.kpmg.com/content/dam/kpmg/th/pdf/2024/12/2025-thailand-tax-calendar-thai.pdf) · [Legardy 86–86/14](https://legardy.com/thai-law/revenue-code/revenue-code-vat-tax-invoices-section-86-14) · [paseetax 82/9](https://www.paseetax.com/article/%E0%B8%A1%E0%B8%B2%E0%B8%95%E0%B8%A3%E0%B8%B2-82-9-%E0%B9%83%E0%B8%9A%E0%B9%80%E0%B8%9E%E0%B8%B4%E0%B9%88%E0%B8%A1%E0%B8%AB%E0%B8%99%E0%B8%B5%E0%B9%89-6790.html) · [FlowAccount ภ.ง.ด.3/53](https://flowaccount.com/blog/wht-pnd3-pnd53-basic-knowledge/) · [FlowAccount 50 ทวิ](https://flowaccount.com/blog/withholding-tax-certificate/) · [Inflow Account 50 ทวิ](https://inflowaccount.co.th/withholding-tax-certificate/) · [Panorama demo tips](https://www.panorama-consulting.com/erp-demos-tips/) · [ERP Focus demo scripts](https://www.erpfocus.com/erp-demo-scripts-guide.html).
