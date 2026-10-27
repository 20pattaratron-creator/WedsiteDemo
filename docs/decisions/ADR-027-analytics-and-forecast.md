# ADR-027 — วิเคราะห์และคาดการณ์: comparisons, ABC, Holt / Holt-Winters forecast, reorder points

## Status
Accepted for Local Demo (round 10, 14 ต.ค. 2569). New page `analytics-forecast` in the "ข้อมูลและรายงาน" menu
group, visible in simple mode. Thai default, English through the page's own key table (ADR-026).

## Context
Owners of Thai SMEs ask four questions of their sales data: *what changed* (against last month / last year),
*what matters* (which products make the money), *what is coming* (next months' sales) and *what to buy now*
(stock that will run out). The app had a dashboard forecast (`app.js`, moving average / SES / Holt / HW / linear
regression chosen by rolling-origin CV) that could disagree with any new page. Honest statistics come first: a
forecast must say how it was made, how wrong it was on known data, and when it cannot be made.

## Decisions
### 1. One measure, defined once (`erp-analytics-core.js`)
- Sales of a branch-month = live tax invoices **ex-VAT** (`invoiceNetSales`) + live legacy production orders that no
  invoice delivered − live credit notes + live debit notes, **each note in its own month** (ADR-023/024). Cancelled /
  voided documents count 0 (their count is reported on the page). Receipts are never sales.
- The functions were moved unchanged from `app.js` (`resolveVatMode … dedupeRecords`); the dashboard KPIs
  (`metricFromData`, `branchStats`) and the page both call `packSalesRows`. Test `ap#2`: the page total of July,
  August and September 2569 equals the dashboard for the company, สำนักงานใหญ่ and สาขาที่ 00001 (Sep: ฿145,150 =
  ฿79,070 + ฿66,080), for every dimension, and a quarter equals the sum of its months.
- Lines: each measure row is split over its items with `itemSharesForRow` (integer satang; the lines add up to the
  row exactly, a remainder becomes a "document adjustment" line).

### 2. Periods and comparisons
- Month / quarter / year; only **closed** months (the current month is incomplete and never compared or used to fit).
  A running quarter / year is compared on its closed months against the same months of the previous period and of
  last year ("to date"); for a year, previous period = last year.
- % change = (current − base) / |base| × 100; a zero base gives "—" (never ∞ / NaN). Top 5 growers / decliners in
  baht, ties by key. Net-negative periods (credit notes > sales) are said as such.
- No product cost exists yet: the page shows "ยังไม่มีต้นทุนสินค้า — กำไรขั้นต้นจะแสดงเมื่อเปิดใช้การคิดต้นทุน" instead of a
  gross margin.

### 3. ABC
Positive sales ranked by value (ties by key), class by where an item **starts** on the cumulative curve: < 80 % → A,
< 95 % → B, else C (the item crossing 80 % is still A). Equal values share the class of the first. Integer satang, so
the boundaries are exact. Zero / negative sales: "ไม่มีการขาย" when the product is stock-tracked with stock on hand,
else C. Window 3 / 6 / 12 months (default 12).

### 4. Forecast (`erp-forecast-core.js`, pure)
- Series: monthly, zero-filled from the first month with sales to the last closed month.
- **< 6 months** → no forecast: "ข้อมูลยังไม่พอคาดการณ์ (ต้องมีอย่างน้อย 6 เดือน)". All-zero history → no level to forecast.
- Methods (additive, additive season m = 12):
  - SES: ℓ₁ = y₁.
  - Holt (linear trend, not damped): ℓ₂ = y₂, b₂ = y₂ − y₁.
  - Holt-Winters additive: first two seasons' means μ₁, μ₂; b = (μ₂ − μ₁)/12; ℓ₁₂ = μ₁ + 5.5 b;
    sⱼ = yⱼ − (μ₁ + (j − 6.5) b), j = 1…12 (a centred trend line, so the seasons are not contaminated by trend).
- Parameters: grid search of the one-step SSE on the training months — α ∈ {0.1 … 0.9}, Holt β ∈ {0.05, 0.1, 0.2,
  0.3}, HW β ∈ {0.05, 0.1, 0.2}, γ ∈ {0.05, 0.1, 0.3}; ties keep the first (smallest) values. Deterministic.
- Selection on a **holdout** of the last H months (fit on n − H, forecast 1…H ahead): n ≥ 27 → H = min(6, n − 24)
  (HW needs 24 training months); otherwise H = clamp(⌊n/4⌋, 3, 6). Holt is the default for 6–26 months; SES replaces
  it only when strictly better ("trend makes the back-test worse"). From 27 months HW is also tried and wins only
  when strictly better. Metric: MAPE; sMAPE when any test month is ≤ 0. The chosen method is refitted on all months.
  Deviation from the brief ("24+ months: Holt-Winters"): an honest comparison needs HW fitted on ≥ 24 training months
  (two seasons for the initial state) **and** ≥ 3 test months, so with 24–26 months HW cannot be tested and the page
  says so ("มีข้อมูล n เดือน — Holt-Winters ต้องมีอย่างน้อย 27 เดือน …", reason `hw-not-testable`) instead of choosing it untested.
- Accuracy labels: < 15 % แม่นยำดี, 15–30 % พอใช้, > 30 % ระวัง. Test months all zero → "cannot be judged", never "accurate".
- Interval (~80 %): point ± 1.2816 × σ × √h, σ = RMS of the one-step residuals (≥ 3 needed, else no band); a
  heuristic, not an exact prediction interval (it ignores parameter uncertainty; √h is the random-walk growth). The
  back-test coverage (actuals inside the band) is shown.
- Rails: negative forecasts clamped to 0 and flagged; a forecast above 3 × the historical maximum is capped and flagged;
  residuals more than 3 × the RMS of the others are listed as unusual months (**not removed**).
- Reference: `scripts/forecast-reference.py` is an independent numpy implementation written from this ADR; the JS
  matches it to ~3·10⁻¹⁴ (tests `fc#*`).
- One forecast everywhere: the dashboard "คาดการณ์" tab, วิเคราะห์ธุรกิจ and the Quant views read
  `ERPAnalytics.renderEmbeddedForecast` / `quantForecast`; the old `app.js` engine (rolling-origin CV, Naive, SMA,
  damped Holt, linear regression, MASE) was deleted, with its two method selectors. Quant's Monte-Carlo now uses σ of
  the chosen method; WAPE / bias / tracking signal come from its holdout. Tests in `forecast-governance.test.cjs` were
  restated for the new engine (MASE has no successor; zero-history now says "no sales" instead of forecasting 0).

### 5. Reorder point
Per stock-tracked product × branch, from the quantity forecast of next month: daily demand d = F ÷ days of that month;
σ_daily = σ_month ÷ √days; safety stock SS = z × σ_daily × √L (z: 90 % 1.28, **95 % 1.65** default, 99 % 2.33);
ROP = d × L + SS; order-up-to = d × (L + review) + SS, review 30 days (7/14/30/60); suggested = ⌈max(0, order-up-to −
on hand − open PO)⌉; days of cover = on hand ÷ d; order by = today + ⌊(on hand + open PO − ROP) ÷ d⌋ (today when ≤ 0).
Lead time L: new optional Product Master field `leadTimeDays` (1–365, blank = 7). Open PO = the work queue's
`buildStockAvailability` "incoming". No demand → no alert; negative stock → a "data is wrong" alert; services and
made-to-order items are skipped; a damaged purchasing ledger stops the suggestions (fail-closed). "สร้างใบสั่งซื้อ"
fills a **draft** PO (branch, product, quantity, standard cost, default supplier, expected = today + L); nothing is
saved until the user presses บันทึก. Alerts also appear as a compact card on "งานของฉัน".

### 6. Demo history (ADR-013 two clocks)
Storage key `comform_demo_sales_history_v1` (erp-storage-contracts 1.11.0): summarised monthly rows
`[period, branch, productCode, customer, qty, value]`, generated from the story month S: S − 27 … the month before
each branch's first sales document, so the analysis has 28 closed months. Trend per product, season (Songkran dip in
April, Q4 peak), seeded PRNG (FNV-1a → mulberry32 → Box–Muller) keyed by product|branch|month, so the same date gives
byte-identical data. บจก. มูลมั่งมี วัสดุภัณฑ์ declines 45 % a year. History is used **only for branch-months without
sales documents**, so dashboard, tax reports and receivables are unchanged (r91 tests, render-golden). Not part of the
JSON backup; reset removes it; a damaged history is not used at all (page says so).

### 7. Seeded results (load on 14/10/2569)
Company series 2024-06 … 2026-09 (28 months): Holt α 0.4 β 0.2, holdout 4 months, MAPE 26.3 % (พอใช้; SES 29.6 %,
HW 45.7 %), coverage 4/4; October 2569 ฿192,275.63 (80 %: ฿120,162–฿264,389). Reorder alert: โน้ตบุ๊กธุรกิจ 14 นิ้ว at
สาขาที่ 00001 — on hand 4, about 52 days of cover, order 2 by 25/10/2569 (L 21). Decline: มูลมั่งมี −100 % against
September 2568 (−฿77,980). ABC (12 months to Sep 2569): A 5, B 3, C 30 products.

### 8. Export
CSV (UTF-8 with BOM, `taxCsvText`) and Excel through the vendored SheetJS lazy loader (`loadSheetJS`, offline);
sheet names through `taxSafeSheetName` (≤ 31 characters, no `\ / ? * [ ] :`).

### 9. Why not SPSS / SQL / a server
The app is a local-first browser demo (ADR-001/013): data never leaves the browser and there is no server. A few
hundred products × 36 months fit in memory; the pure cores do 200 products × 36 months × 2 branches (aggregation +
forecasts + ABC) in < 200 ms (test `ac#12`). SPSS / R / a SQL engine in the browser would add megabytes, licences or
WASM for no gain at this size, and could not be verified line by line.

## Limits (said on the page in "?" help)
- A forecast is an estimate from past sales, **not a guarantee**; it cannot know new contracts, price changes,
  promotions or supply problems. The ~80 % band is approximate.
- Small products sell a few units a month (intermittent demand): their accuracy is often "ระวัง". Croston-type methods
  are not used.
- No cost of goods: no gross profit or margin analysis until costing exists.
- Demo history is fictitious sample data.

## Budget (QUALITY_BUDGET.json)
Raised deliberately: runtime JS files 68 → 72 and root JS files 60 → 63 (three pure/UI modules + one plain-data
dictionary: the logic cannot live in `app.js`, which is frozen and shrank by 468 lines), runtime lines 39,400 →
41,100 (+≈2,000 lines of new feature code and its dictionary), window assignments 79 → 80 (`window.ERPAnalytics`,
the page API used by the dashboard, Quant, งานของฉัน and tests).

## Tests
`tests/forecast-core.test.cjs` (hand recursions, numpy reference, holdout, rails, determinism),
`tests/analytics-core.test.cjs` (periods, leap 2028, พ.ศ./ค.ศ., measure lines, comparisons, ABC, reorder by hand,
history, performance), `tests/analytics-page.test.cjs` (booted app: menu, empty data TH/EN, agreement, one forecast,
seeded figures, PO draft, CSV/Excel offline, English, fail-closed), `tests/forecast-governance.test.cjs` (restated),
`i18n-dict#7`, coverage audit step "analysis & forecast".
