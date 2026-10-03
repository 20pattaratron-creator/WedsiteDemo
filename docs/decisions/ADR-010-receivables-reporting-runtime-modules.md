# ADR-010 — Receivables & Management Reporting Runtime Modules (อายุลูกหนี้ + แจ้งเตือนเกินกำหนด)

## Status
Accepted for Local Demo.

## Context
Management reports and "which customers owe us money and are late" are what prospects ask about in a demo.
The reporting code predates credit notes (ใบลดหนี้), WHT receipts, abbreviated (walk-in) invoices and billing
payments that settle several invoices, and each report re-derived "what is still owed" and "when is it due" on
its own:

- the analytics AR table recomputed `total − credited − paid` itself and so lost the `RECONCILE_TOLERANCE`
  rule (a 0.01 rounding gap showed as an overdue balance);
- customer / agency "ค้างรับ" was `delivery − receipts` of the selected period (pre-VAT, ignoring credit notes);
- customer / product / salesperson / agency / ABC breakdowns and the sales-target actual ignored credit notes,
  while the dashboard tiles subtracted them — the breakdowns did not add up to the tiles;
- returned-goods credit notes removed the revenue but left the cost of the returned goods in profit;
- the due date was `dueDate`, `dueDate || creditTerm`, or `dueDate || date` depending on the screen, so the
  dashboard, work queue, Customer 360 and governance aging disagreed about what is overdue;
- walk-in cash sales (`ลูกค้าทั่วไป / เงินสด`) were ranked as the #1 "customer", counted as a customer and could
  trigger the "customer concentration" insight;
- there was no per-customer aging screen and no alert for overdue receivables.

Putting the fixes into `app.js` would grow the mega-controller that `QUALITY_BUDGET.json` guards.

## Decision
- **One balance.** Every AR figure reads `ERPIntegrity.paymentSummary()` (erp-integrity.js) — credit notes
  (voided ones ignored), WHT receipts (settle the full total), billing-payment allocations (each invoice gets
  only its own allocation; the printable receipts of a payment are evidence, not extra cash) and the
  `RECONCILE_TOLERANCE` dust rule. `ERPIntegrity.flow` is exported so callers can pass `{business, store}` once
  per report instead of re-reading storage per invoice. Analytics caches the summary per invoice (`_ar`).
- **`erp-receivables-core.js`** (new, pure, DOM/storage free, unit tested):
  - the single due-date rule: stored due date → credit term → *due on the invoice date* for cash / walk-in /
    no-term invoices (the convention the governance AR aging already used); business dates only, no
    `new Date(string)`;
  - open-item aging with the governance-core bucket keys (current / 1–30 / 31–60 / 61–90 / over 90, plus
    `undated` so no amount disappears), per-customer summary summed in satang, alert summary, CSV rows;
  - `buildCreditNoteSalesAdjustments()`: a live credit note becomes negative sales rows **in its own period**,
    attributed to the original invoice's customer and salesperson, split over the invoice's products by value
    (returned-goods notes: by returned qty × invoice unit price, and returned qty × invoice unit cost is reversed
    from cost). The document `subtotal` (what the tiles subtract) is split by line difference with a
    largest-remainder allocation, so the breakdowns add up to the tiles exactly;
  - branch gross profit / margin (`null` → "—" when sales ≤ 0; no division by zero).
- **`erp-receivables.js`** (new, thin DOM controller, event delegation, no inline handlers, one
  `window.ERPReceivables` global): the "รายงานอายุลูกหนี้ตามลูกค้า" report as a new **"ลูกหนี้ค้างรับ" view
  tab of the executive dashboard** (the existing view-tab convention of erp-customer-experience.js — the
  Business Analytics page is hidden in the default simple mode), with total row, expandable open invoices and CSV
  export via the existing `downloadCsvText()`; a dismissible banner on the dashboard and on the "งานของฉัน" home
  page; an overdue-count badge on the dashboard navigation item. It refreshes on load and after data changes
  (`erp-flow:changed`, `erp:dashboard-rendered`) — a microtask coalesces bursts; no timers, no Notification API.
- `app.js` keeps thin wiring only: credit-note rows in the existing sales-row collectors, gross profit/margin in
  the branch comparison, walk-in handling in counts/ABC/leader/insights. Dead AR helpers were removed. Net `app.js`
  change is **−27 lines** versus the pre-change file (8,284 → 8,257), which also clears the pre-existing
  `appJsLinesDelta` failure (+24 → −3 against the frozen 8,261 baseline).
- The work queue, sales & AR centre, Customer 360 and governance aging use the shared due-date rule; Customer 360
  and the role home no longer count cancelled/voided invoices as receivables.

## Choices documented for users
- **No credit term ⇒ due on the invoice date.** Invoices saved without a credit term (and walk-in cash sales)
  are due the day they are issued. Legacy invoices without terms therefore show as overdue in the invoice list
  and alerts if unpaid — consistent across every screen.
- **Walk-in cash sales** are one aggregated row ("ลูกค้าทั่วไป / เงินสด (รวมทุกบิลหน้าร้าน)"): they keep their
  share of sales but are excluded from distinct-customer counts, ABC ranking (class "-"), the monthly #1
  customer and the concentration insight. A credit note on a walk-in invoice nets against that row even when
  the note carries a typed buyer name (§86/10).
- **Cost basis is unchanged** (document cost: standard cost / production actual per SO line). A price reduction
  keeps the cost of goods; a returned-goods note reverses the returned quantity at the invoice line's unit cost.
- **Gross profit** = sales − cost of goods; commission and expenses are below gross profit (net profit).
- **Delivery (ยอดส่งสินค้า) and collection figures are not netted** — they measure shipments and cash.
- **Product breakdowns are pre-VAT**: item lines are scaled to the row's pre-VAT sales, so VAT-inclusive or
  discounted item totals now add up to the sales KPI.

## Complexity budget change
`runtimeJsFilesMax` 37 → 39 and `rootJsFilesMax` 38 → 40 (the two new modules). The `app.js` baseline/delta rule
is unchanged. The runtime line budget for the readable layout of these modules is set by
[ADR-011](ADR-011-receivables-readable-layout-line-budget.md) (`runtimeLinesMax` 19,600 → 20,500).

## Consequences
- `tests/receivables-reporting.test.cjs`: pure core rules plus jsdom flows through the real app (credit note /
  voided note / WHT / combined payment / dust / walk-in / branch profit / breakdowns / ABC / sales target, the
  banner + badge + report, and refresh after a real receipt save and real credit-note saves).
- Aging is "as of today" across all periods (the analytics AR table stays period-scoped). The Local Demo still
  has no server-side AR ledger; figures are computed in the browser from local documents.
