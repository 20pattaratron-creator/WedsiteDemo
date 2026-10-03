# ADR-018 — Round 5 review fixes: one dashboard scope, closed periods on delete/void, safer lists

## Status
Accepted for Local Demo (fixes of three independent reviews of round 5, parts A–C). Builds on ADR-015,
ADR-016 and ADR-017. Regression tests: `tests/review-round5-fixes.test.cjs` (`r5fix#1` … `r5fix#12`).

## Decisions
1. **One "quote moved on" rule** — `quoteMovedOnMatcher(orders)` in `erp-shared-core.js`: a quotation has
   moved on when it carries an invoice / production stamp or a *live* Sales Order points at it (by
   `sourceQuoteId`; the number decides only when one side has no id; same branch). Used by the quote list
   row actions (primary becomes เอกสาร/PDF, "สั่งผลิต" stays in "⋯"), both work queues and the Decision
   Council — there were four slightly different copies. With the sample data the dashboard queue's
   "ใบเสนอราคาพร้อมยืนยัน" now shows 0 instead of 2: both quotes are already linked to an invoice /
   production order, which the Decision Council and "งานของฉัน" already treated as moved on.
2. **Dashboard scope.** The "สิ่งที่ต้องทำ" cards follow the dashboard's branch tab exactly like the AR
   KPIs: `window.ERPReceivables.selectedBranch / scopeBranches / scopeLabel` is the one source. The
   Decision Review card (and "เปิด Council") and the order-flow work-queue card are computed for that
   branch and print their scope ("ทุกสาขา" / branch name · ณ วันนี้). AR figures are "as of today, every
   period" (as the KPIs), so the month/year filter does not apply to them. The work queue's
   "ลูกหนี้เกินกำหนด" now counts the AR report's overdue invoices (same `buildReceivableItems` rule); it
   used to add overdue billing notes — the same debt twice — which are now named in the hint. The
   sidebar badge still counts every active branch.
3. **Dashboard layout.** The sales-vs-target chart spans the full width of ภาพรวม (no 760 px minimum
   there), so all 12 months are visible without sideways scrolling; ≥ 1200 px: "สิ่งที่ต้องทำ" (work queue
   above Decision Review) beside the customer-mix donut, the chart below; 901–1199 px: one column. DOM
   order = visual order (donut card before the chart card). Phones keep the 700 px chart in its scroll box,
   opened at the latest month with sales / the current month. Measured (Chromium, sample data): 1440×900
   1,282 → 1,448 px tall, chart 376 → 930 px visible of 760 → 930 px; 1280×800 1,376 → 1,437 px.
4. **Closed periods on delete / void.** `ERPGovernance.periodLockRefusal({type, branch, date})` is asked
   BEFORE any confirmation/prompt by `delDoc` (invoices, receipts → sales scope; expenses → purchase),
   `voidPayment` (the payment and the receipts it created) and the credit-note void (before its reason
   prompt; `voidUnlocked` keeps its own check). It returns the same text as a save refused by
   `assertPeriodOpen` (`documentActionFeedback` of `period_locked`). Quotations and production orders are
   not posted to a period (their saves are not locked either), so their delete is unchanged. Goods-receipt
   reversal and PO cancel are inventory/purchasing records without a period lock today; not changed.
5. **Lists are text.** Quote and receipt lists, the detail modal (`dr()` escapes unless given trusted
   markup) and the order-flow "next action" escape document numbers / names / notes; record ids that go
   into inline handlers are HTML-escaped JS string literals.
6. **Smaller items.** Business-rule overrides are deleted by their stable key; an unsaved preset has no
   delete (the table says to save it first — deleting from a draft would mix "unsaved" with "new formula
   version"). Menus close when focus leaves them and on `erp:navigation`; Escape is theirs only while focus
   is in the menu or on its button. Sidebar: start-up and the app's own redirects never open/store a
   collapsed section. Line-item "ลบรายการ" = labelled trash icon, ≥ 32 / 40 px. KPI link 40 px on phones.
   Dashboard view tabs: `aria-controls` lists the ids of their view's blocks, each a `role="tabpanel"`
   labelled by its tab (own heading label kept; live regions keep their role). The save single-flight
   guard keeps its 250 ms anti double-click window, says "กำลังบันทึกเอกสารก่อนหน้า กรุณารอสักครู่" and
   exposes `LocalDemoHealth.isBusy / whenIdle` (tests await it instead of sleeping).

## Consequences
- `app.js` +0 lines (8,268). Runtime JS 24,242 → ~24,470 lines (shared scope/lock/menu code + comments):
  `runtimeLinesMax` 24,300 → 24,500; file counts unchanged.
- `tests/receivables-reporting.test.cjs` fix6#9 compared the governance aging at a fixed 2026-09-21 with
  the AR report "as of today" — it began failing on 2026-10-01; both are now asked for the same day.
