# ADR-030 — แก้ตามผลตรวจบัญชี/ภาษีและภาษาไทย-อังกฤษ รอบ 13 (round 13A)

## Status
Accepted for Local Demo (round 13A, 26 ต.ค. 2569). The owner approved every fix of the two round-13 audits:
`/home/claude/reports/ตรวจบัญชีและภาษีรอบ13.md` (HIGH-1..3, MED-1..9, LOW-1..8, section 3 "ยืนยันไม่ได้") and
`/home/claude/reports/ตรวจภาษาไทยอังกฤษรอบ13.md` (+ `fixes.json`, 232 items). The demo is **not tax advice**: every rule
below that rests on a secondary source says so on screen and is listed under "What still needs a professional".

## Context
The round-13 independent recompute matched the app on 79 points: the arithmetic was right, **the rules were not**
(withholding condition 3, goods receipts without input VAT, the 1,000-baht threshold per payment, silent VAT-inclusive
default, …). This ADR records the rule changes, their sources, and the figures of the sample's tax story that moved.

## Decisions — tax / accounting

| ID | Decision (files) | Source |
|---|---|---|
| HIGH-1 | `calculateWht` condition 3 ("ออกให้ครั้งเดียว"): the payer bears only the first round `round(base × r)`; the tax on that borne amount is withheld from the payee. 10,000 + VAT 700 @3 %: 50 ทวิ 10,300 / 309 · company expense 300 · payee receives 10,691 (9,991 without VAT). Journal: Dr 5410 300 / Cr bank 10,691 / Cr WHT 309. The on-screen note says the formula comes from a secondary source. (`erp-payer-wht-core.js`, `erp-journal-core.js`) | [PEAK – ออกให้ครั้งเดียว](https://intercom.help/peak/en/articles/6211061) (secondary; ADR-024/025 keep the caveat) |
| HIGH-2 | Purchase orders and goods receipts carry the supplier's VAT (`add` / `none`, asked — no default). A GR stores AP **gross**; input VAT is claimable only with the supplier's tax invoice (TIN 13 digits, branch, number, date, received date, claim month ≤ 6 months, late-claim reason, duplicate TIN + number guard against expenses and other GRs, claim-month lock). Without the invoice yet the VAT waits in 1155 and the month-end pack lists it; "⋯ › บันทึกใบกำกับภาษีที่ได้รับ" records it later. GR VAT flows into รายงานภาษีซื้อ, ภ.พ.30 L6/L7 and the journal (Dr 1154/1155 / Cr 2111, same open item as the goods). A claimed GR cannot be reversed. (`erp-tax-reports-core.js` `planGoodsReceiptVatFields` / `planGoodsReceiptTaxInvoice` / `goodsReceiptVatOf`, `erp-tax-forms.js` §5, `erp-production-core.js`, `erp-journal-core.js`) | ม.82/3, 82/5, ม.86/4; [ประกาศฯ VAT ฉบับที่ 4](https://rd.go.th/3417.html) |
| HIGH-3 | The 1,000-baht threshold is tested on the **contract** total when "จ่ายตามสัญญา" is ticked (contract total + reference stored); an 800 instalment of a 3,000 contract is withheld. Without a contract the per-payment rule stays, and the message no longer says "ไม่ต้องหัก". | [ท.ป.4/2528 ข้อ 6(2)](https://rd.go.th/3479.html); [สรรพากรภาค 5 – ภ.ง.ด.3](https://www.rd.go.th/region/05/fileadmin/163/004_pdf/taxkm/pnd3.pdf) |
| MED-1 | No silent VAT-inclusive default: payee not VAT-registered → no VAT extraction (noted); payee VAT-registered or unknown with a tax-invoice document → the user must choose. Supplier master gains "จดทะเบียน VAT". | [ท.ป.4/2528](https://rd.go.th/3479.html) (base excludes VAT — practice, see "ยืนยันไม่ได้" 3) |
| MED-2 | Optional payment date (`whtPaymentDate`): the 50 ทวิ date, its พ.ศ. book and numbering, and the ภ.ง.ด. month follow the payment; the journal posts the expense to AP on its date and an `expense_payment` entry on the payment date. | ม.50, ม.52 (withhold when paid) |
| MED-3 | A tax invoice / CN / DN cancelled in a later month is reversed on the **last day of its own month** (flag `cancel_backdated`) so the books equal รายงานภาษีขาย of every month. "⋯ › ออกฉบับใหม่แทน" opens a replacement that prints "ออกแทนใบกำกับภาษีเลขที่ … ลงวันที่ … (ฉบับเดิมยกเลิกแล้ว)"; the cancel dialog says to use a credit note after delivery. | [ป.86/2542 ข้อ 10–11](https://rd.go.th/3568.html); [ข้อหารือ กค 0702(กม.05)/1041](https://rd.go.th/41087.html) |
| MED-4 | A 0 % sale (`vatCategory: 'zero'`) of a VAT registrant prints as a tax invoice with a "ภาษีมูลค่าเพิ่ม 0% / VAT 0%" row and the optional export declaration number; it is ภ.พ.30 L2. | ม.80/1, ม.86/4 |
| MED-5 | Company profile: "ได้รับอนุมัติออกใบกำกับภาษีอย่างย่อ (ภ.พ.06)" + approval number + POS ID per establishment; the abbreviated invoice prints "POS ID … · เลขที่อนุมัติ …"; the invoice form shows a red notice (retail only, approval needed) while not approved. | ม.86/6; [ประกาศฯ VAT ฉบับที่ 46](https://rd.go.th/3394.html) |
| MED-6 | Option "ออกใบกำกับภาษีเมื่อได้รับชำระ" for service invoices (VAT, full form, services only; fixed once paid / credited). The invoice prints as "ใบแจ้งหนี้"; each receipt prints as "ใบเสร็จรับเงิน/ใบกำกับภาษี" with that payment's value/VAT (cumulative satang rounding, shares add up exactly); รายงานภาษีขาย uses the receipt date; the journal holds the VAT in 2155 until paid (`vat_due`). CN/DN cannot refer to such an invoice. | ม.78/1(1) |
| MED-7 | Sample data: every building rent withholds 5 % (company landlord → ภ.ง.ด.53, person → ภ.ง.ด.3), the August transport 1 %, and the job subcontract payments J1 (electrician, 3 %) and J3 (crane hire, 3 %) are real expenses with 50 ทวิ. | [ท.ป.4/2528](https://rd.go.th/3479.html) |
| MED-8 | The page notice says the data lives only in this browser, to back up weekly, and that tax documents must be kept ≥ 5 years (ม.87/3); a backup reminder shows the days since the last backup (`erp_demo_last_backup_at`). Cloud storage stays out of scope. | ม.87/3; [DBD](https://www.dbd.go.th/data-storage/attachment/f183f131d7ca2105131b32fef.pdf) |
| MED-9 | CN / DN "เหตุอื่น" needs ≥ 15 characters of explanation and warns on discount / promotion wording; the label is "เหตุอื่นตามที่อธิบดีกำหนด". | ม.82/9, 82/10; [ประกาศฯ VAT ฉบับที่ 199](https://rd.go.th/27982.html) |
| LOW-1 | Government-holiday table (2569 official; 2570 provisional from BOT announcement 37/2569) used by every due-date roll and the 3-working-day rule; the page names the holiday. ภ.พ.30 Sept 2569 e-filing: 23 → **26 ต.ค. 2569** (วันปิยมหาราช). A doubtful day (16 ต.ค. 2569, 1/13 พ.ค.) is left out so a due date is never later than the real one; a year without a list says so. | Thaiger 3 พ.ย. 2568 / InfoQuest "วันหยุดประจำปี 2569" (cabinet list); ประกาศ ธปท. ที่ 37/2569 (ราชกิจจาฯ 25 ส.ค. 2569) |
| LOW-2 | `VAT_RATE_SCHEDULE`: 7 % until 30 ก.ย. 2570; after that the rate is "unknown" and documents get a warning (the demo keeps computing 7 %, never guesses). | [พ.ร.ฎ. (ฉบับที่ 807) พ.ศ. 2569](https://www.thansettakij.com/economy/667217) |
| LOW-3 | A claim month after the received month needs a reason (trade custom / force majeure / other ≥ 10 chars) and shows the endorsement text "ถือเป็นภาษีซื้อในเดือนภาษี …". | [ประกาศฯ VAT ฉบับที่ 4 ข้อ 2](https://rd.go.th/3417.html) |
| LOW-4 | A filed ภ.พ.30 snapshot posts `vat_close` (Dr 2154 L5 / Cr 1154 L7 / Cr 2141 L11 or Dr 1156) and `vat_payment`; a filed ภ.ง.ด. posts `wht_remit`. Payment date = filed date (≥ the 1st of the next month), default account flagged. The tie checks exclude these settlement kinds. | — (standard double entry) |
| LOW-5 | Safe minimal option: optional service period on the invoice; a warning when it spans months; the month-end pack shows a straight-line **suggestion** of unearned revenue — nothing is posted. | [RSM – TFRS for NPAEs 2022](https://www.rsm.global/thailand/insights/thai-financial-reporting-standard-non-publicly-accountable-entities-revised-2022) |
| LOW-6 | A job's "other" direct cost credits 2181 "ค่าใช้จ่ายของงานค้างจ่าย" (was a contra-expense 5143); the expense that pays it (`jobEntryId`) debits 2181, so the cost is not counted twice. A missing link is flagged. | — |
| LOW-7 | Month-end pack: + "50 ทวิ ที่ได้รับ" (customer withholding certificates), "ต้องตรวจ" (pending GR tax invoices, backdated cancels, …) and "เอกสารแนบ" (accountant checklist incl. 5-year retention). | audit §1 LOW-7 |
| LOW-8 | ADR-023 item 4 now says the carry-forward is **line 10** (ภาษีที่ชำระเกินยกมา). | ภ.พ.30 form |

"ยืนยันไม่ได้" (audit §3) — safe defaults, as warnings, never guesses: the condition-3 caveat (1); per-contract threshold
and VAT-exclusive base notes in the WHT due section (2, 3); the abbreviated-invoice approval notice (4); the cancel dialog's
"credit note after delivery / amended return" advice (5); a note that the demo uses one invoice series for the company (6);
the CN/DN "other" warning (7); e-WHT, per-establishment ภ.ง.ด., copy 3 of the 50 ทวิ, and internet / telecom withholding
notes (8–11); the ม.65 ตรี note on non-claimable input VAT (15). Items 12–14 and 16 are documentation only.

## Decisions — language (B)
- `fixes.json`: 232/232 applied (Thai text and dictionary keys together; `dict-delete` duplicates removed;
  `PRINT_PREFIXES_EN` order kept longest-first). Plural fix: `singularizeCounts()` in `erp-i18n-core.js` ("1 items" → "1 item";
  2 / 11 / 21 / decimals unchanged). British spelling (centre, licence) and sentence case on printed labels.
- Report items not in `fixes.json`: S4 backtest, S8 English abbreviations, S14 (DEMO_SCRIPT_EN) applied; S5 curly quotes,
  S7 sentence case of shell menu labels, S11 developer terms and S12 "product master" left for a later round (style only,
  many dictionary keys; no meaning change).
- Every Thai string added in round 13 has an English entry (~170, in the per-area dictionaries); the customer type on the
  quotation and Thai long dates now have English in the print layer (`PRINT_AGENCY_LABELS_EN`). Test `r13#LANG-print`
  checks that every Thai text of every printed document type has an English mapping in English mode.

## Golden renders
Only `deliveryTax:documentPageHtml` and `receipt:documentPageHtml` changed; their hashes were updated alone, with the
justification and the reviewed before/after PNGs stored in `DOCUMENT_RENDER_GOLDEN_BASELINE.json` (`regeneratedEntries`).
CSS hashes are unchanged (the amount-in-words label fits with an inline style).

## The sample's tax story (September 2569, re-derived by hand and by the independent recompute)
| | L1 | L5 | L6 | L7 | L11 | ภ.ง.ด.3 | ภ.ง.ด.53 |
|---|---|---|---|---|---|---|---|
| สำนักงานใหญ่ | 79,070.00 | 5,289.90 | 41,114.95 | 2,878.05 | 2,411.85 | 6,000.00 / 300.00 | 18,714.95 / 735.75 (3 ราย) |
| สาขาที่ 00001 | 66,080.00 | 4,625.60 | 11,401.86 | 798.14 | 3,827.46 | — | 8,411.21 / 420.56 |
| ยื่นรวม | 145,150.00 | 9,915.50 | 52,516.81 | 3,676.19 | 6,239.31 | | |
| สถานประกอบการเดียว | | | | 2,878.05 | 7,037.45 | | |

HQ L6/L7: + GR690901 6,900.00 / 483.00. PND.53 HQ: + rent to บจก. อุบลแลนด์ 11,214.95 × 5 % = 560.75. Trial balance
Sept (all): 436,737.50. Expenses history 124,915.00 (+ J1 1,500, J3 1,600); dashboard net 44,263.30.
`recompute.py` adapted (GR VAT, condition 3, payment month, 2181, backdated cancel): **96 points, 0 mismatches**.

## Consequences
- Certificate numbers (เลขที่) depend on the load date (earlier rent payments of the same พ.ศ. book come first); tests
  compare payee / amount, and numbering is checked gapless per establishment and book.
- Budget: runtime lines 48,700 → 50,300 (50,098 used); no new file or window global; app.js line-neutral (7,799).

## What still needs a professional
Condition-3 formula (PEAK only), the 1,000-baht order clause, the VAT-exclusive base clause, web-ERP abbreviated invoices
and ภ.พ.06, the replacement-invoice date / amended return rule, one invoice series across establishments, the "other"
CN/DN causes, e-WHT, per-branch ภ.ง.ด. filing, internet/telecom withholding, TFRS for NPAEs revenue recognition, ม.65 ตรี,
and the 2570 government holiday list once the cabinet publishes it.
