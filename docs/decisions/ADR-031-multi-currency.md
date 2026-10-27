# ADR-031 — หลายสกุลเงิน (multi-currency, round 13B)

## Status
Accepted for Local Demo (round 13B, 27 ต.ค. 2569). Implements section 5 "กฎสำหรับหลายสกุลเงิน" of
`/home/claude/reports/ตรวจบัญชีและภาษีรอบ13.md` (facts with sources + design rules 1–9). The demo is **not tax advice**:
the rules that rest on general knowledge (ภ.ง.ด.54 rates, tax treaties) are labelled "ต้องยืนยัน" on screen and listed
under "What still needs a professional".

## Context
Foreign-owned SMEs and exporters invoice and pay in USD / EUR / JPY … but Thai tax figures are in baht. The baht of
every foreign-currency document must be satang-exact, computed once, and the same in the VAT reports, the journal,
AR / AP and the dashboards. A static demo has no server: the Bank of Thailand API cannot be called.

## Decisions

| # | Decision (files) | Source |
|---|---|---|
| 1 | **Pure core `erp-fx-core.js`**: ISO 4217 list with minor units (THB 2, USD 2, EUR 2, JPY 0, CNY 2, SGD 2, GBP 2, MYR 2, LAK 0, MMK 0, VND 0, KRW 0, AUD 2, HKD 2, CHF 2; JPY quoted per 100). All money in integers (satang / minor units, BigInt where a product can exceed 2^53); **one** half-up conversion of the document's currency SUBTOTAL; lines get their share by the largest remainder (Σ lines = subtotal). VAT = round(baht subtotal × 7 %) — VAT is computed on THB. A VAT-inclusive price and an abbreviated tax invoice are not offered in a currency. | report rule 2; ป.86/2542 ข้อ 4(6) (half-up) |
| 2 | **Rate table** `comform_fx_rates_v1` (ADR-003 contract, version 1.14.0 of `erp-storage-contracts.js`): per currency / date / type (`bot_avg_buying`, `bot_avg_selling`, `bank_buying`, `actual`), rate text, per (1 / 100 / 1000), source (`manual` / `csv` / `demo`), evidence note (≥ 5 characters), entered at / by. **Append-only**: a correction is version n+1 that supersedes version n; documents keep the rate id + rate + baht they were issued with (never recomputed). Strict reader: any malformed row stops every FX action (fail-closed). A future rate, a duplicate without "correction", a missing evidence note and the source `bot_api` are refused. | report rule 8 |
| 3 | **Rate-date rule** `fxRateDateFor`: BOT average rates — the rate published on the liability day (that day, or the previous business day on a weekend / holiday from the round-13A holiday table) reflects the PREVIOUS business day, so the rate date = the business day before the announcement day: Fri → Thu, Sat → Thu, Fri 23 Oct 2569 (holiday) → Wed 21 Oct, 31 Jul 2569 → 27 Jul (28–30 Jul holidays). `bank_buying` / `actual` = the announcement / transaction day itself. **No silent guessing**: a missing rate blocks the document with the exact date and type to enter, and a "บันทึกอัตรานี้" button opens the rate form. The company's sales rate type (BOT average buying or the bank's buying) is chosen **once**; after the first FX document it changes only with the Revenue Department's approval reference (history kept). | ป.132/2548; report rule 3 |
| 4 | **CSV import** (Thai or English header, ISO or DD/MM/YYYY พ.ศ./ค.ศ.): every row validated and previewed before anything is written; equal rows skipped; a different value of a stored rate needs "import as corrections"; a ±20 % jump warns. **Fetch adapter** `FX_FETCH_ADAPTER_CONTRACT` (`id, label, available, reason, fetchRates({currency,type,from,to}) → rows`) documented for a future server; the only adapter here (`createUnavailableBotAdapter`) refuses — this module never touches the network. | report rule 8; BOT Exchange Rates API terms unconfirmed |
| 5 | **Documents in a currency**: quotation / proforma, tax invoice, receipt, credit / debit note (at the invoice's own rate), supplier invoice from abroad (expense), purchase order (estimate only) and goods receipt (selling rate of the receipt day → stock cost and payable). Stored fields: `currency, fxRate, fxPer, fxRateType, fxRateDate, fxRateId, fxSource, amountFx` (per line and total) and the baht `amountThb` / `subtotal` / `vatAmt` / `total`. Existing pipelines read only the baht fields, so AR, tax reports, costing, dashboards and analytics are unchanged code paths. An FX invoice is never edited (cancel and re-issue); baht receipts / billing notes of an FX invoice are refused. | report rule 2 |
| 6 | **Tax-invoice gate**: without the setting "อนุมัติให้ออกใบกำกับภาษีเป็นเงินตราต่างประเทศ เลขที่ … ลงวันที่ …" a domestic tax invoice prints its amounts and VAT in **baht**; the currency appears only in a box "ข้อมูลประกอบ (ไม่ใช่ยอดตามใบกำกับภาษี)" with the rate and rate date. With the approval (stored on the invoice at issue) it prints in the currency with the rate, the baht value and the **baht VAT**. Quotations / proformas print fully in the currency. | ป.86/2542 ข้อ 8; ประกาศฯ VAT ฉบับที่ 92, 77 (แก้ไขโดย 186) |
| 7 | **Exports (0 %)**: `vatCategory: 'zero'`, export kind goods / services, export entry number and date; the export invoice prints "ใบกำกับสินค้าส่งออก ใช้แทนใบกำกับภาษีตาม ป.132/2548 ข้อ 6". ภ.พ.30 value (L1 / L2) = the baht actually received for the currency sold in the month + the rest at the BOT average buying rate of the month's last business day, fixed by the month-end close (`exportVat` on the invoice); before the close the report flags the value as provisional (`exportPending`). The books keep the invoice-day baht; the journal check "salesExport" explains the difference. A foreign buyer is not flagged for a missing Thai tax ID. | ป.132/2548; report rule 4 |
| 8 | **AR / AP in a currency**: open items in the currency and in baht (`fxInvoiceOpenItem`, `fxPayableOpenItem`). A receipt settles the carrying baht in proportion (the last one clears it exactly); `receipt.total` = settled baht (so `paymentSummary`, aging and the ledger stay the invoice's baht), `amountThb` = cash at the receipt's rate, `fxRealisedThb` = cash − settled → **4210** realised gain / **5420** realised loss (new accounts, mappable on the chart card). Partial receipts / payments supported. The receivables aging shows baht with an extra "ค้างรับ (สกุลเงิน)" column (screen and CSV — only when an FX item is open). | report rule 5 |
| 9 | **Month end** ("ปิดเดือนสกุลต่างประเทศ", `comform_fx_documents_v1`, one posted close per month, voidable, never in a closed period): open receivables at the BOT average **buying** rate, payables at the average **selling** rate of the month end → unrealised gain **4220** / loss **5430** on the last day, **auto-reversed on day 1** of the next month (the one method — the cumulative method is not offered). No VAT effect. A document dated in a closed FX month is refused until the close is voided. | report rule 6; ม.65 ทวิ(5) |
| 10 | **Payments abroad** (`planFxPayment`, stored append-only on the expense / GR as `fxPayments`): ภ.ง.ด.54 (s.70) at configurable rates — default 15 % (service, royalty, interest, other) and 10 % (dividend), labelled "ต้องยืนยัน / อนุสัญญาภาษีซ้อน (DTA) อาจลดอัตรา" — on the income at the **selling** rate of the payment day; deducted (withheld in the currency, half-up) or **grossed up** (company bears it: income = cash ÷ (1 − r), as WHT condition 2; borne tax → 5410). ภ.พ.36: 7 % of the income (incl. the tax), Dr 1155 / Cr 2142, claimed as input VAT the month after the payment (`pp36_claim`, flagged "assumed paid by the 7th") and listed in the purchase VAT report of the claim month. Monthly ภ.ง.ด.54 / ภ.พ.36 lists on รายงานภาษี (new tabs), due the 7th of the next month moved past weekends / holidays, Excel / CSV. | ป.รัษฎากร ม.70 (ภ.ง.ด.54); ภ.พ.36 self-assessment (section number from general knowledge — to be confirmed); report rule 7 |
| 11 | **UI** `erp-fx.js` / `erp-fx.css` (menu "หลายสกุลเงิน", 7 tabs; a settings card on ตั้งค่าบริษัท: functional currency THB fixed, allowed currencies, rate type, approval number, ภ.ง.ด.54 rates): every control ≥ 42 px (44 px ≤ 900 px); the rate is shown, never typed on a document (only in the rate table); every currency amount has its baht beside it; full English through `i18n/en-fx.js` (415 keys). | ADR-019, ADR-026 |
| 12 | **Journal** (`erp-journal-core.js`): 6 new accounts (2133 ภ.ง.ด.54 payable, 2142 ภ.พ.36 payable, 4210, 4220, 5420, 5430 — chart 45 → 51); entry kinds `fx_payment`, `pp36_claim`, `fx_revaluation`, `fx_revaluation_reverse`; the PND.54 tie and the export-value tie in the month-end checks. | — |
| 13 | **Backup** (ADR-003): `masterData.fx` = settings + rate table + closes, validated strictly before anything is written (one damaged part refuses the whole file); merge = union by id, a different row with the same id refused, a close changed inside a closed period refused. The FX documents themselves are in the month packs (existing backup). The demo reset removes the FX stores (first-run state). | ADR-003 |
| 14 | **Backlog (receipt term)**: a receipt of a credit invoice shows the invoice's credit term and ITS due date; a cash sale shows "เงินสด" and no due date (was "เงินสด" with a due date). | — |

## Sample data (ADR-013 two clocks)
Pinned to S−3 / S−2 (three / two months before the story month S), at the head office: **the THB story of S and S−1,
the receivables open today and every baht document's number, date and amount are unchanged on every load date**
(checked for 2026–2028 with one and two establishments — `tests/r13b-fx-core.test.cjs` r13b#12). Sample rates are
**made-up** ("ข้อมูลตัวอย่าง: อัตราสมมติเพื่อสาธิต ไม่ใช่อัตรา ธปท. จริง").

Hand-worked (load 5 / 26 Oct 2569 → S−3 = มิ.ย. 2569):

| | figure |
|---|---|
| USD export invoice Fri 26 Jun (0 %, goods), 5 × USD 600.00 | USD 3,000.00 × 32.6543 (BOT buying of Thu 25 Jun) = **97,962.90** (cost 59,000) |
| receipt 30 Jun USD 1,000.00 × 33.1000 | cash 33,100.00 − carrying 32,654.30 = **gain 445.70** |
| close 30 Jun: open USD 2,000.00 × 33.0000 | 66,000.00 − 65,308.60 = **unrealised 691.40**, reversed 1 Jul |
| export value (ป.132/2548, mixed) | 33,100.00 + 66,000.00 = **99,100.00** on ภ.พ.30 L1/L2 of June |
| receipt 10 Jul USD 2,000.00 × 32.8000 | 65,600.00 − 65,308.60 = **gain 291.40** (total realised 737.10) |
| JPY service from Japan 5 Jun, JPY 120,000 × 22.3456 / 100 | payable **26,814.72** |
| payment 15 Jun, gross-up 15 %, JPY 120,000 × 22.5011 / 100 | cash 27,001.32 · income 31,766.26 · **ภ.ง.ด.54 4,764.94** (5410) · loss 186.60 · **ภ.พ.36 2,223.64** claimed in July |

Explicit deltas of the whole-history figures (DEMO_SCRIPT): sales 716,010 → 813,972.90; cost 525,700 → 584,700;
expenses 124,915 → 151,729.72; net 44,263.30 → 56,411.48; head office 404,710 / 3,949.90 → 502,672.90 / 16,098.08; the
sample counts 23 → 24 invoices, 11 → 13 receipts, 20 → 21 expenses; the forecast tab's figures (one more month of
sales). A few load dates on days 1–3 of a month move the export sale one month earlier (S−4) so that a baht invoice
92 days back keeps its number (the figures are the same).

## Render golden (THB documents byte-identical)
`delivery-tax-document.js documentPageHtml` and `receipt-document.js documentPageHtml` gained FX branches (columns /
totals / words in the currency, the info / approval / export notes, inline-styled so no CSS hash changes); their
baseline hashes were regenerated. Proof that THB documents are byte-identical: every THB invoice, receipt and quotation
of the sample (both branches, 26 Oct 2569) rendered with round13a-fixes and with this round gives the same HTML
(`/tmp/claude-0/r13b/golden-identity.log`).

## Budget
`QUALITY_BUDGET.json`: runtime files 82 → 85, root JS 71 → 73, window assignments 83 → 84 (`window.ERPFx`), runtime
lines 50,300 → 54,000 (≈53,800 used). A pure core separate from the page keeps the money rules testable in Node; the
English keys are data. `app.js` line-neutral (7,799): two backup lines extended.

## What still needs a professional
- **Approval to issue tax invoices in a foreign currency**: the application to the Director-General (form, conditions,
  what the approval letter allows) — the app only stores the number / date the company enters.
- **ภ.ง.ด.54 rates and tax treaties**: 15 % / 10 % are general knowledge; whether a DTA lowers the rate (and the
  certificate of residence needed), whether the payee has a PE in Thailand, and the income type of each payment.
- **ภ.พ.36**: the claim month assumes the ภ.พ.36 is paid within 7 days (the input VAT exists from the ภ.พ.36 receipt);
  services "used in Thailand" is a judgement.
- **Bank of Thailand API**: registration, cost, rate limits, the 29 currencies removed on 1 Apr 2568 and the one-year
  history — not confirmed; a server-side job is needed (after 18:00, stored immutably).
- **Revaluation method / rate type** (ม.65 ทวิ(5)), import VAT at Customs (not modelled), the export-value rule for
  services (ม.9), and whether the bank's buying rate is acceptable instead of the BOT average.

## Sources
ป.86/2542 ข้อ 8 <https://rd.go.th/3568.html> · ประกาศฯ VAT ฉบับที่ 92 <https://rd.go.th/3371.html> · ฉบับที่ 77
<https://rd.go.th/3385.html> แก้ไขโดย ฉบับที่ 186 <https://rd.go.th/46637.html> · ป.132/2548
<https://www.rd.go.th/28635.html> · FlowAccount <https://flowaccount.com/faq/knowledge-base/multi-currencies-invoice/> ·
PEAK <https://intercom.help/peak/en/articles/6481286> · BOT Exchange Rates revision
<https://www.bot.or.th/en/statistics/Exchange-Rates-Revision.html> (all as cited in the round-13 audit report; not
re-fetched — this demo calls no external URL).
