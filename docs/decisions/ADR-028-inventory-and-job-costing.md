# ADR-028 — ต้นทุนสินค้าคงเหลือ (ถัวเฉลี่ยเคลื่อนที่ / FIFO), ต้นทุนงาน และกำไรต่องาน

## Status
Accepted for Local Demo (round 11, 22 ต.ค. 2569). New page `job-costing` "ต้นทุนและกำไรต่องาน" in the
"ซื้อ / ผลิต / คลัง" menu group, visible in simple mode. Thai default, English through the page's own key table
(`i18n/en-costing.js`, ADR-026). Nothing is posted to a journal in this round (round 12 adds journals).

## Context
The demo sold documents and tax well but had no cost: the analytics page said "ยังไม่มีต้นทุนสินค้า" and a job-shop
owner could not see which job made money. The research report (`/home/claude/reports/แผนสร้างระบบ ERP สู้คู่แข่ง.md`,
ระยะ 1 · 1.1 and 1.2) sets the scope. Sources it cites, used here:
- **TFRS for NPAEs** allows specific identification, FIFO and weighted average — no LIFO — and measures inventory at the
  lower of cost and NRV, cost including conversion costs ([PwC pocket guide 2014](https://www.pwc.com/th/en/services/assets/jp-business/pdf/tfrs-for-npaes-pocket-guide2014-jp.pdf);
  [RSM on the 2022 revision](https://www.rsm.global/thailand/insights/thai-financial-reporting-standard-non-publicly-accountable-entities-revised-2022) reports no change to cost formulas).
- **ประมวลรัษฎากร มาตรา 65 ทวิ (6)** (not (5)): value inventory at cost or market, whichever is lower; once a method is
  used, change it only with the Director-General's approval ([rd.go.th/5939](https://rd.go.th/5939.html)).
- Moving average formula (report 1.1): new average = (qty on hand × average + qty received × unit cost) ÷ (qty on hand + qty received).
- Job-order costing (report 1.2, [OpenStax, Principles of Managerial Accounting ch. 4](https://openstax.org/books/principles-managerial-accounting/pages/4-summary)):
  materials requisitions and time tickets per job; predetermined overhead rate = estimated overhead ÷ the activity base;
  over / under-applied overhead is adjusted to cost of sales. Worked example: materials 8,200 + labour 3,200 + overhead
  40 h × 50 = 2,000 → 13,400; sold for 20,000 → GP 6,600 (33.0 %) — test cost#6.
- Competitors: PEAK (FIFO, automatic COGS) and FlowAccount (FIFO) have inventory costing; PEAK has no job cost
  (production via a 0-baht receipt workaround).

## Decisions
### 1. Pure cores, integers only
- `erp-costing-core.js` (inventory) and `erp-job-costing-core.js` (jobs, GP lines, overhead report): no DOM, storage or
  clock. Quantities in thousandths (`qm`), money in satang, unit cost in 1/10,000 baht (4 decimals). Products and
  divisions round **half away from zero** (= half-up for positive values), with a BigInt fallback beyond 2^53.
- Every movement value is rounded to the satang once; the balance value is the running sum, so **valuation = Σ layers =
  Σ movements** exactly (test cost#5: 100 ÷ 3 → 33.33 / 33.34 / 33.33, the remainder goes to the last unit out).
- Order: date, then a fixed rank within the day (opening, receipts, returns, job returns / completions, adjust-in,
  transfers, receipt reversals, job issues, sales, adjust-out), then a stable text key (created time, id). The same
  input always gives the same result. 600,000 movements (300 SKUs × 2,000) recompute in ~150–230 ms in Node (cost#13 < 300 ms).

### 2. Methods
- **Moving weighted average** per SKU **per branch** is the default; **FIFO** per company is the option; no LIFO;
  specific identification is not offered (it needs serial / lot tracking the demo does not have).
- Inputs: opening stock (Product Master opening qty × the opening cost in settings, else the standard cost), goods
  receipts at the PO price before VAT, sales (invoice lines, the same rule as `productEstimatedStock`), job issues /
  returns / completions, stock adjustments, transfers, receipt reversals and returned goods on credit notes.
- **Transfers** leave at the sender's cost and arrive at that value (cost#3). **Returns** (credit note with returned
  goods) come back at the cost the goods left with; a **receipt reversal** goes out at the receipt's own cost (moving
  average falls back to the average if the stock value would go negative; FIFO takes the receipt's own layer first).
- **Negative stock**: an outflow beyond the balance is costed provisionally at the last known cost (else the standard
  cost) and flagged; when stock arrives the owed units are revalued at the receipt cost and the difference is booked as a
  `correction` on that receipt, in the receipt's own period (cost#4). The page marks such rows "สต็อกติดลบ".

### 3. Method lock and closed periods
- The method locks with the first costed movement. A change needs the **Revenue Department approval letter number and
  date** (not in the future) and an effective date after the approval, after the previous change and in an open period;
  the history keeps every change; figures before the effective date are not recomputed (cost#8, capp#10).
- A back-dated document recomputes everything after it. Any change (movement, invoice, opening cost, method, void) is
  compared before / after with `lockedCostChanges`; if a cost inside a **closed period** would move it is refused with
  the **same Thai text as every period lock** (`ERPGovernance.periodLockRefusal`, type `stock`; sales-side rows use the
  sales scope). The opening balance is checked as of 2 Jan 1970 (every lock of its branch covers it). Hooks: goods
  receipt post / reverse, stock adjustment, transfer, the invoice stock guard, and every write of the costing page.

### 4. NRV
Lower of cost and NRV at a chosen date: NRV per unit = expected selling price (entered, else the product's default
price — the report says which) − cost to sell; write-down = cost − NRV when positive, capped at cost. Report + Excel
only, no posting (cost#10; demo: the 9U rack 4,800 vs 4,500 − 300 → 600 per rack, 1,200 total).

### 5. Jobs
- A job is an existing **production order** (key `branch|id`). Costs: materials issued / returned at costing cost
  (stored as `job_issue` / `job_return` rows of the inventory-movement ledger); labour (date, person or team, hours, the
  rate fixed on the entry: person rate from settings, else the company rate); overhead = hours × the predetermined rate
  (estimated overhead ÷ estimated labour hours, fixed on each labour entry); subcontract / other; completion with good
  qty and scrap to **cost of sales** or **finished goods** (a `job_completion` stock receipt at the job's cost).
- Entries are never deleted: a void keeps who / when / why. A completed job takes no more cost; reopening is refused
  while its revenue sits in a closed sales period.
- Budget for budget-vs-actual: entered on the sheet, else the source quotation's cost estimate, else the production
  order's cost estimate.
- **Profit per job** = revenue of the analytics measure (invoice before VAT − live credit notes + debit notes, each in its
  own month, the documents linked to the job) − job cost, shown once the job is completed to cost of sales. Margin
  colours: ≥ 20 % green, 0–20 % amber, < 0 red.
- **Gross profit elsewhere** (analytics compare tab, dashboard card): only sales whose cost is known count in the
  margin — stock items (moving-average / FIFO cost of the invoice line) and completed jobs (job cost allocated over the
  job's lines by value, largest remainder); the box shows the **coverage** ("มีต้นทุน 50% ของยอดขาย"). No cost → the old
  note stays. Never a made-up margin (cost#7, capp#9).
- Over / under-applied overhead: actual overhead = expenses in the chosen categories (before VAT when the input VAT is
  claimable) vs hours × rate per month — information only (cost#12).

### 6. Storage, backup, reset (ADR-003 contracts)
`comform_costing_settings_v1` (method + history, rates, overhead estimate and categories, opening costs, NRV inputs) and
`comform_job_costing_v1` (entries, budgets), both in `erp-storage-contracts.js` 1.12.0, strict fail-closed readers (an
unknown field or a bad number stops the page with a message — never zeros). JSON backup carries them in
`masterData.costing`; `ERPBackup.validate` checks them before anything is written; restore merges by id (replace takes
the file). The reset removes them with the tenant's keys.

### 7. Sample data (ADR-013 two clocks)
Four of the existing sample invoices are delivered by a job: each gets a **legacy production order** (no sales order)
with exactly the invoice's lines, value, cost estimate and commission in the same month — so every dashboard, tax,
AR, forecast and ABC figure stays as it was (the measure counts the order instead of the invoice, same value). Raw
materials RM-CAB6 / RJ45 / RACK / PATCH / CLEAN (opening stock, 3 POs + goods receipts), labour, overhead 75 / h,
subcontract. J1 follows its invoice U3; J2–J4 and the receipts are pinned to the story month and the month before; every
receipt of a material J1 uses is dated after U3 on every load date. Figures (all load dates, tests cseed#1–3):
J1 loss −4,120 (−16.5 %, materials 7,700 over budget) · J2 9,750 (72.2 %) · J3 1,070 (6.9 %) · J4 550 (6.1 %) ·
customer อีสานโลจิสติกส์ 1,620 (6.6 %). With one establishment J3 takes the pooled head-office average (14,405).

### 8. Round-10 polish
Reorder table: compact cells and the last column (status + actions) pinned at the right edge, so it is never cut at
1440 px. Forecast chart: the last x-axis label is anchored at its end (and a label too close to it is skipped).
Forecast tab: "คาดการณ์ระดับหมวดสินค้า" — per category, a 3-month back-test of the category total forecast directly vs
the sum of its products' forecasts (WAPE; < 0.5 point = tie; one product = the same), with export.

## Not modelled (said here, and where relevant on the page)
Journals / GL posting, closing the overhead variance and the NRV write-down to the books (round 12) · specific
identification, lots, serials, landed cost (freight / duty on receipts), standard costing and variances by price /
usage · routing, capacity, MRP · labour from a time clock (hours are typed) · costs of non-stock (service) sales ·
multiple warehouses inside a branch · partial completion of a job.

## Budget (QUALITY_BUDGET.json)
runtimeJsFilesMax 72 → 76, rootJsFilesMax 63 → 66, runtimeLinesMax 41,100 → 44,700 (measured 44,535), windowAssignmentsMax
80 → 81. Why: costing is a new domain with two pure cores (kept out of the UI file so they are testable and fast), one
page module and one key table; the only new global is `window.ERPCosting`, which the analytics page, the dashboard, the
production row action, the stock-posting guards and the JSON backup call. app.js is unchanged in size (two backup lines
edited in place).

## Tests
`tests/costing-core.test.cjs` (cost#1–13, hand-worked numbers), `tests/costing-seed.test.cjs` (cseed#1–3, 8 load dates),
`tests/costing-app.test.cjs` (capp#1–10, jsdom), i18n-dict#8, the English coverage audit (every costing tab, branch,
dimension, period type, job sheet and stock card), plus adjusted assertions in demo-seed, analytics-page and
row-actions-core (each commented with the reason).

## What an accountant must confirm
1. Moving average (perpetual, per branch) is acceptable under TFRS for NPAEs **and** มาตรา 65 ทวิ (6), and the procedure /
   wording to request a method change from the Revenue Department.
2. Negative-stock rule (provisional last cost, correction in the receipt's period) and that the correction may sit in a
   later period than the sale.
3. The predetermined overhead rate basis (labour hours), which expense categories are overhead, and how the variance is
   closed (all to cost of sales vs pro-rata).
4. NRV inputs (expected price, cost to sell) and when a write-down must be booked.
5. Whether a job's cost should follow its revenue into the revenue month when they differ (here: cost at completion,
   revenue in its invoice / credit-note months).
