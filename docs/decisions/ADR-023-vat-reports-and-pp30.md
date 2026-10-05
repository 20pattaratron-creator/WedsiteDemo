# ADR-023 — VAT reports (ภาษีขาย / ภาษีซื้อ) and ภ.พ.30 per establishment

## Status
Accepted for Local Demo (round 8, stage C). Tests: `tests/tax-reports-core.test.cjs` (13, pure) and
`tests/tax-reports.test.cjs` (8, app boot). All 21 fail on round8-stageB and pass now.

## Context
The demo issued tax invoices, credit notes and recorded expenses, but had no รายงานภาษีขาย / รายงานภาษีซื้อ and no
ภ.พ.30. Expenses held only a gross amount, suppliers had no establishment code, and an invoice without VAT did not say
whether it was exempt or zero-rated. Rules and sources: `docs/TAX_FEATURES_SPEC.md` §1–§3 and §8.

Sources (rd.go.th): ประกาศอธิบดีฯ VAT ฉบับที่ 89 ([3374](https://www.rd.go.th/3374.html)) and ฉบับที่ 202
([27985](https://www.rd.go.th/27985.html)); report form [vat-202-01.pdf](https://www.rd.go.th/fileadmin/images/image_law/images/vat-202-01.pdf);
มาตรา 87–90 ([5209](https://www.rd.go.th/5209.html)); หมวด 4 VAT incl. ม.82/3, 82/5 ([2596](https://www.rd.go.th/2596.html));
ป.80/2542 ([3574](https://www.rd.go.th/3574.html)); ภ.พ.30 form 2568
([pp30_010968.pdf](https://www.rd.go.th/fileadmin/tax_pdf/vat/2568/pp30_010968.pdf)). The e-filing +8 days window
(to 31 ม.ค. 2570) is from secondary sources only and is kept as config (`TAX_DEADLINES.efilingExtensionUntil`).

## Decision
1. **Pure core `erp-tax-reports-core.js`.** Tax periods, due dates, TIN check digit, supplier establishment code,
   `planExpenseVatFields`, `buildSalesTaxReport`, `buildPurchaseTaxReport`, `buildPp30Summary`, CSV and the
   `vatReturns` store. It has no DOM or storage access (purity test). Output VAT reuses `summarizeOutputVat`, which
   now also accepts `debitNotes` (sales + DN − CN), so the report footer and ภ.พ.30 line 5 come from one function.
2. **Expense purchase tax.** `amount` stays the gross amount, so existing totals and cash reports do not change. VAT
   fields are stored beside it. The 82/3 rule warns "เกินกำหนดใช้สิทธิ 6 เดือน" when claim month > invoice month + 6
   (the exact counting convention is [unconfirmed]). The 82/5 reasons make the VAT non-claimable; such rows go to the
   ภาษีซื้อต้องห้าม tab. A second expense with the same supplier TIN + invoice number is refused, across all years. The
   claim month must be an open period. Old expenses without a VAT split show "ข้อมูล VAT ไม่ครบ" and stay out of the report.
3. **Sales report.** Columns follow the official order. Credit notes are negative in their own month. Cancelled
   invoices show 0 with the reason. Abbreviated invoices are one daily summary row. Invoices in `none` mode carry
   `vatCategory` (`exempt` / `zero`); old ones count as exempt with a warning.
4. **ภ.พ.30 lines 1–12.** Lines 5 and 7 equal the report footers. Line 9 is the carry-forward from the filed
   return of the month before; otherwise it is entered by hand. Lines 13–16 show "ไม่คำนวณในเดโม". Filing is per
   establishment unless `companyProfile.vatFilingMode = 'combined'`. A repeat filing of the same period is
   "ยื่นเพิ่มเติมครั้งที่ n". After filing, the app offers to lock the sales and purchase periods. Due dates are the
   15th (paper) and 23rd (e-filing), moved past Saturday and Sunday. The page says that the demo submits nothing.
5. **Storage.** `comform_vat_returns_v1` (ADR-003 pattern): it is read strictly, part of the JSON backup
   (`masterData.vatReturns`, validated fail-closed), and removed by the demo reset.
6. **Page.** "รายงานภาษี" in the data group (visible in simple mode) has four tabs, branch/month (พ.ศ.) selectors, A4 print
   ("แผ่นที่ … ในจำนวน … แผ่น", landscape reports, portrait ภ.พ.30), Excel through the existing offline SheetJS loader,
   and CSV. All text is in one `TEXT` object per module.
7. **Demo story.** September 2569 sample data, worked by hand in `tests/tax-reports-core.test.cjs`, plus a step in
   `docs/DEMO_SCRIPT_TH.md`.

## Not modelled
Public holidays in due dates (e.g. 23 ต.ค. is วันปิยมหาราช). Actual e-filing or submission. ภ.พ.30 lines 13–16.
Debit and credit notes *received* from suppliers. Purchase tax from goods receipts (GR, G15). Editing a saved
expense's tax fields (delete and re-enter). Deleting a claimed expense whose claim month is locked is not blocked
separately. A backup merge keeps the device's return when both have the same branch/period/amendment slot. More
than two establishments are not supported.

## Quality budget
`runtimeJsFilesMax` 49→52, `rootJsFilesMax` 50→53 (three new modules: a pure core that must not touch the DOM, the
form hooks and the report page; each one is a separate scope that `app.js` cannot absorb under its 0-line delta).
`runtimeLinesMax` 27,200→29,400 (measured 28,973; about 2,070 new lines plus the seed story). `app.js` stays at
8,268 lines: only existing lines were edited. The `appJsLinesDelta=7` complexity finding was already on round8-stageB
and is unchanged.
