# ADR-024 — Debit notes (ใบเพิ่มหนี้) and payer-side withholding (50 ทวิ, ภ.ง.ด.3 / ภ.ง.ด.53)

## Status
Accepted for Local Demo (round 8, stage D). Tests: `tests/debit-note-core.test.cjs` (8) and
`tests/payer-wht-core.test.cjs` (10), pure; `tests/debit-note.test.cjs` (4), `tests/payer-wht.test.cjs` (7) and
`tests/r8d-fixes.test.cjs` (2), app boot. All of them fail on round8-stageC and pass now.

## Context
Spec `docs/TAX_FEATURES_SPEC.md` §4 (debit note, AC4.1–4.7) and §5 (payer WHT, AC5.1–5.9). The app already handled WHT
that customers deduct from us on receipts. It had no debit note and no 50 ทวิ for payments we make.

Sources (rd.go.th): มาตรา 82/9 and 86/9 (DN events and contents), ป.80/2542 ([3574](https://www.rd.go.th/3574.html),
DN VAT in the issue month); คำสั่ง ท.ป.4/2528 ([3479](https://www.rd.go.th/3479.html), rates); RD guide
[wht_3_53](https://www.rd.go.th/fileadmin/download/insight_pasi/wht_3_53_030260.pdf) (1,000-baht rule, ภ.ง.ด.3 vs 53,
due 7th); 50 ทวิ form [approve_wh3_081156.pdf](https://www.rd.go.th/fileadmin/tax_pdf/withhold/approve_wh3_081156.pdf);
ใบแนบ [ภ.ง.ด.3](https://www.rd.go.th/fileadmin/tax_pdf/withhold/270360_attach3.pdf) and
[ภ.ง.ด.53](https://www.rd.go.th/fileadmin/tax_pdf/withhold/290360_attach53.pdf). The e-filing 15th-day window
is from secondary sources only and stays config (`WHT_DEADLINES`, ends 31 ม.ค. 2570).

## Decision
1. **Debit note = mirror of the credit note.** Pure core `erp-debit-note-core.js` (validate, calculate, build, void,
   ledger, export) and UI `erp-debit-note.js` (form, list in the sales group in simple mode, Excel). It is stored in
   the `debitNotes` collection of the month pack. Numbering is `DN` + พ.ศ. yymm, never reused (a voided note keeps its
   number). It is cancel-not-delete, with a reason and an audit row. VAT is computed once on the document increase.
   The original value = invoice + earlier live DNs − earlier live CNs (AC4.7). Credit notes now see debit notes too,
   so crediting up to the raised value is allowed. The print is `credit-note-document.js` with DN labels. Credit-note
   output is byte-identical to before (checked on 14 renders).
2. **AR: a DN is collected with its invoice.** `ERPIntegrity.paymentSummary` gains `debited` and adds it to the
   effective total. Aging uses the invoice's due date. The spec suggested a separate open item. We chose this because
   one AR engine already feeds the AR report, banner, governance aging, Decision Council and Customer 360, so they
   all agree without new code paths. A receipt from the invoice collects the whole balance. An invoice with a live DN
   cannot be cancelled or edited. A DN cannot be voided once its money was collected.
3. **Payer WHT on the expense.** "หักภาษี ณ ที่จ่าย" section of the expense form: payee type (ภ.ง.ด.3 / 53, from
   Supplier Master `entityType`, can be changed), income type with its fixed rate (other/prize: user rate), conditions
   1/2/3 (2 = gross-up base × 100 / (100 − r); 3 = base + round(base × r) taxed once, see ADR-025; 4 refused),
   base = pre-VAT amount unless typed (no VAT split → the user states "รวม VAT" (÷ 1.07, default) or "ไม่มี VAT", ADR-025), half-up to the satang,
   1,000-baht rule with an override, net paid = gross − WHT. The payment date is the expense date. Missing 13-digit TIN
   refuses the save (AC5.8). A wrong check digit only warns. Supplier Master stores a default `whtIncomeType`.
4. **50 ทวิ.** It is created in the same write session as the expense (all or nothing), in the `whtCertificates`
   collection of the payment month. เล่มที่ = พ.ศ. year; เลขที่ runs per payer establishment. The payer is a snapshot
   of the company profile. Print: ฉบับที่ 1 + 2 with the form's wording, the amount in Thai words, every value escaped.
   "ลำดับที่ … ในแบบ" is taken from the latest filed snapshot, else from the live ใบแนบ row. It is computed, not
   written back (a deviation from spec §5c.7). Cancel-not-delete: refused before the question when the period is
   locked or a filed ภ.ง.ด. lists it.
5. **ภ.ง.ด.3 / ภ.ง.ด.53.** Three new tabs on "รายงานภาษี" (ภ.ง.ด.3, ภ.ง.ด.53, register 50 ทวิ). Columns follow §5b2. A
   cover summary holds payees, rows, amount paid and tax. Due dates are the 7th (paper) and 15th (e-filing), moved past
   weekends only, with a holiday note. Also A4 print, Excel and CSV. Filing is "บันทึกว่ายื่นแล้ว": an append-only
   snapshot in `comform_wht_filings_v1`, with "ยื่นเพิ่มเติมครั้งที่ n" and a purchase-side period lock offered. It is
   part of the JSON backup (`masterData.whtFilings`, validated fail-closed: totals must equal the rows) and removed by
   the demo reset. Customer WHT on receipts never enters these forms.
6. **D3 fixes.** (1) Expense delete is refused before the question when a live 50 ทวิ exists, when the claim month is
   locked, or when its ภ.พ.30 is filed (an unreadable store also refuses). Expenses have no edit action. (2) At ≥ 1,240 px
   the report tables use a fixed layout with column shares that add up to 100 %. Phones scroll inside the card, and the
   seven tabs scroll as one row. (3) A cancelled invoice is one row: "ยกเลิก – reason" in the name column, at most two
   lines on screen (full text in the tooltip), and note "ยกเลิก". (4) `companyTaxIdNotice`: the sample number shows an
   amber note; red is only for a non-sample invalid number.
7. **Sample data (September 2569).** DN690901 on INV690910: 1,500.00 + 105.00. WHT 3 % on the existing cloud
   service (5,000 → 150.00, ภ.ง.ด.53). New: warehouse rent 6,000 from an individual (300.00, ภ.ง.ด.3) and transport
   2,500 from a non-VAT partnership (25.00, ภ.ง.ด.53). Three 50 ทวิ, 0001–0003. Hand-worked figures are in the tests.
   Sales report HQ footer is 75,570.00 / 5,289.90, L8 = L11 2,894.85. ภ.ง.ด.3 is 6,000.00 / 300.00. ภ.ง.ด.53 is
   7,500.00 / 175.00. Amounts were chosen so that the head office still shows a profit.

## Not modelled
DN/CN *received* from suppliers; a DN as its own AR item; holidays in due dates; condition 4; e-Withholding Tax (1 %);
ภ.ง.ด.1/1ก/2/3ก/54; sending anything to the RD; writing ลำดับที่ back into certificates; a separate payment date or
partial payments of one expense; editing a saved expense's WHT (cancel the 50 ทวิ, delete and re-enter); voiding the
expense's WHT figures when only the certificate is cancelled; more than two establishments.

## Quality budget
`runtimeJsFilesMax` 52→56 and `rootJsFilesMax` 53→57: four new modules, each a separate scope that `app.js` cannot
absorb under its 0-line delta. Two are pure cores that must not touch the DOM. `runtimeLinesMax` 29,400→32,400
(measured 31,966). `app.js` stays at 8,268 lines, with existing lines edited only. `windowAssignments` is 75 of 75.
The `appJsLinesDelta=7` finding is unchanged from stage C.
