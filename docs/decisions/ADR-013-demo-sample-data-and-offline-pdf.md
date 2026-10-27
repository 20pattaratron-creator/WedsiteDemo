# ADR-013 — One-Click Demo Sample Data and Offline PDF Libraries

## Status
Accepted for Local Demo. Revised in round 3 / phase 1 (load/reset semantics, dataset coverage, fixes the
sample data exposed) and in R9.1 (dates: two clocks, so the tax-month story is the same on every load date); see
"Revision history".

## Context
- The demo opened with every report, dashboard and aging table at zero, so a presenter had to type
  documents in front of the prospect before anything could be shown.
- `index.html` loaded html2canvas 1.4.1 and jsPDF 2.5.1 from two CDNs. On a customer's poor Wi-Fi the
  PDF export failed and the deployment watchdog showed the yellow "โหลดหน้าเว็บไม่ครบ" banner.
- `app.js` is 19 lines over its frozen baseline (ADR-012) and must not grow.

## Decision
### Sample data — "📊 โหลดข้อมูลตัวอย่างสำหรับสาธิต"
- **`erp-demo-seed-core.js`** (pure, DOM/storage free) builds a Thai IT SME's recent history
  **from the business date passed in** (never hardcoded dates; the same date always gives the same
  plan; how each row is dated: "Dates — two clocks" below): 9 customers (8 นิติบุคคล with 13-digit check-digit-valid tax IDs, one of them a buyer **branch**
  "สาขาที่ 00003 (โรงงานขอนแก่น)", 1 sole proprietor) + walk-in "ลูกค้าทั่วไป / เงินสด", 12 products/services
  with standard cost and default price, both branches (ubon = สำนักงานใหญ่, khonkaen = สาขาที่ 00001):
  5 quotations (2 converted, 3 pending), 18 tax invoices (full form in all three VAT modes — บวก VAT,
  ราคารวม VAT, ไม่มี VAT — and 2 abbreviated walk-in sales), 8 receipts (one with 3% WHT + certificate
  number, two produced by one billing payment that settles two invoices), 4 credit notes (price adjustment,
  returned goods back into stock, full cancellation, one voided), 1 billing note + payment, 11 expenses.
- Payment story (T = today): invoices late by exactly **10, 45, 62 and 100 days** on every load date fill every
  aging bucket (1–30 / 31–60 / 61–90 / over 90); a fifth (17 days on a load on the 5th) is always overdue; on days 1–9
  of a month five are not yet due, later the story month's 30-day bills fall due one by one; `paymentSummary`
  statuses `paid`, `partially_paid`, `pending` and `credited` all occur. One unpaid invoice is 130 days old (the
  over-90 bucket); everything else is within ~3 months.
- Every record is built by the app's own pure builders — `calculateVatSummary`, `calculateWhtSummary`,
  `plan{Quote,Invoice,Receipt,Expense}DocumentAction`, `buildBillingAction`, `planBillingPaymentAction`,
  `buildPaymentReceiptDrafts`, `validateCreditNote` + `buildCreditNoteRecord`, `withThaiCalendarMeta`,
  `validateProductMasterRecord` — with the field set the save paths store. Converted quotations use the
  app's own link fields (invoice `sourceQuote*`, quote `invoiceId/invoiceNo/invoiceStatus`), the credit
  note's buyer head office / branch comes from Customer Master exactly as the credit-note form fills it.
  Events run in date order so each receipt / credit note / payment sees the balances of the days before it.
- Numbers use the app formats (QT/INV/REC/CN + BE yy + mm + 2 digits; BL/PAY `-0001`). Ids are numeric
  (inline handlers need numbers) in a range no live save produces. Every record carries `demoSeed: true` +
  `demoSeedBatch` (`demo-seed-v2`).
- **Load never mixes sample data with the user's data and never overwrites it silently**
  (`erp-demo-seed.js`):
  - empty store → loads straight away;
  - only earlier sample data → one confirmation, then the old set is replaced by a fresh one dated from
    today (a set loaded last week would show wrong ages);
  - the user's own documents / customers / products / purchasing ledgers exist → **refuse and offer the
    reset first**: the offer and a second, explicit "ข้อมูลที่คุณบันทึกเองจะถูกลบถาวร" confirmation are both
    required before anything is deleted. *Why not "add next to the user's data" (the first version):*
    every report would then mix real and invented numbers, which defeats the purpose of a demo whose
    figures must agree on every screen. *Why not a silent replace:* a trial user who typed real data
    must never lose it with one click.
  - Strict fail-closed reads, period locks respected (never bypasses `assertPeriodOpen`), sample
    customer/product name or code conflicts refused; master data through
    `BusinessRulesService.seedMasterData()`, all packs + the order-flow store in **one**
    `ERPIntegrity.transaction()`; then re-checked with the app's validators (`validateReceipt`,
    `assertIdempotentPaymentReceipts`, `creditNoteLedgerIssues`, `paymentSummary` against the plan, stock ≥ 0)
    and rolled back on any disagreement; `reconcilePayments()` + `changed()` like every save path; one Audit
    Log row. Runs under the `sales-ledger` write lease.

### Dates — two clocks (R9.1, 13 Oct 2569)
**Problem.** Every row except the ADR-023/024 tax story was dated "today − n days". The story month's ภ.พ.30 also
counted those rows, so its figures depended on the load day (found in Chromium: HQ September L1 / L5 / L11 =
79,070.00 / 5,289.90 / 2,894.85 when loaded on 5 Oct, 65,570.00 / 4,344.90 / 1,949.85 on 12 Oct — INV690904 13,500
slid into October — and 62,070.00 / 4,344.90 / 1,949.85 on 13 Oct — the exempt INV690903 3,500 too). Every test fixed
the clock at 4–5 Oct, so it was never caught.

**Rule.** The **story month S = the latest fully closed calendar month before `today`** (`demoSeedStoryPeriod`:
the month before today's month; in January, December of the year before). It is the month whose ภ.พ.30 / ภ.ง.ด.3 /
ภ.ง.ด.53 the presenter files now, and the month รายงานภาษี opens on. Each scenario row has exactly one clock:
- **story** (`monthDay: n` 1–28 / `monthEnd: n` 0–27 days before the last day, `storyMonth: 0 | −1`): pinned to the
  calendar of S or of the month before it — every invoice, credit / debit note, receipt, billing / payment, expense
  and 50 ทวิ of those two months. Rule for the day: a canonical day ≤ 14 (load on 5 Oct 2569: S = September, the
  month before = August) counts from the 1st, a later one back from the month end, so the last-day rows stay on the
  last day and the order holds in a 28-day February. On 5 Oct 2569 the plan is byte-identical to the one before
  R9.1 (checked: both branch modes), so the hand-worked figures (L1 79,070 · L5 5,289.90 · L11 2,894.85 HQ;
  3,827.46 branch; 6,722.31 combined; 7,520.45 one branch; ภ.ง.ด.3 6,000 / 300; ภ.ง.ด.53 7,500 / 175; DN 1,605) are
  the canonical story on every date.
- **relative** (`offset: n`): today − n days, only for rows at least `RELATIVE_MIN_AGE_DAYS` = 62 days old (S
  starts at most 61 days back: the 31st, after a 31-day month), so they can never be in S — the four old unpaid
  bills keep their exact days late — and for open quotations (in no tax figure).
- **recent** (`recent: n`): today − n days but never before the 1st of today's month (the last walk-in sales; on the
  1st they are dated that day).
- The 82/3 case (cloud invoice received at the end of S, claimed the month after) claims in today's month — never
  a future month. Supplier numbers and "เดือน…" in two descriptions follow the row's month (`storyText`), so a
  December load does not show "เดือนกันยายน".
- `buildDemoSeedPlan` throws when a row breaks its clock (relative row in S, recent row before the month, pinned
  row outside its month) or anything — date, cancel / void instant, purchase tax invoice received, claim month,
  billing, payment — is after `today`. `plan.storyPeriod` is returned; the loader opens รายงานภาษี on it (also for an
  explicit `load({ today })`), and the page says "เดือนภาษีล่าสุดที่ปิดแล้ว (เดือนก่อน) …" while it shows that month.

**Fixed vs date-dependent figures** (docs/DEMO_SCRIPT_TH/EN.md mark the latter ⏱ with how to read them): fixed on
every load date — the whole story month (ภ.พ.30 lines and reports of both establishments / combined / one-branch
mode, ภ.ง.ด.3 / 53, 50 ทวิ, debit note), AR total 436,889.40 / 11 bills / 8 customers, the over-90 and 61–90 buckets,
the days late 100 / 62 / 45 / 10, sales / cost / commission / expenses / profit of the history (716,010 / 525,700 /
21,131.70 / 121,815 / 47,363.30), the live-step figures and the AR total after them (439,329.00). The whole year view
equals the history for loads from 11 May to 31 Dec (10 May in a leap year). Date-dependent — and equal to the
script on days 1–9 of any month: overdue total / count (278,260.80 / 5), the other buckets, "not yet due" after the
live steps (161,068.20); and the target chart's months / this month's target (S always beats its target, the month
before always misses).

**Year boxes.** `index.html` typed 2026 into the year filters of the bill / production / quotation reference lists
(the receipt form's list would have shown 2026 bills in 2027); they now start on the current year (`initDropdowns`,
the existing line). In January the story month's bills are in the year before — the script says to type that year.

**Tests.** `tests/r91-seed-dates.test.cjs` (every day 1 Oct 2569 – 31 Jan 2570, month ends, 29 Feb 2028, two year
boundaries; days 1–9 of every month 2026–2028) and `tests/r91-seed-dates-app.test.cjs` (the page in TH / EN on 13 Oct,
20 Nov, 3 Jan and an explicit date); `r8fix#C1` checks the Thai script on six load dates.

### Reset — "↺ ล้างข้อมูลสาธิตทั้งหมด (รีเซ็ต)"
- Removes **exactly this app's data keys for the active tenant**, defined once in
  `demoResetStorageKeys()` (core, unit tested): the tenant's `erp_tenant::<tenant>::*` keys (documents,
  master data, settings, targets, period locks, audit/outbox, drafts, local auto-backups) except the view
  preferences (`erp_product_experience_role_v1/_mode_v1`; since ADR-014 only `_mode_v1` — the retired role key is removed), its `trial::<tenant>::*` checklist keys, the legacy
  `business_rules::<tenant>` key and the legacy un-prefixed `example_erp_order_flow_v2` key (erp-order-flow.js
  copies it into an empty store — left behind it would bring old Sales Orders back). Other tenants' keys,
  other apps' keys and the write-lease keys are never touched. IndexedDB attachment bytes are not removed
  (only referenced by id; the former clear button did not remove them either).
- Asks first; a second confirmation when the user's own data would be lost (or cannot be counted because a
  month is unreadable — a damaged month must not block the reset).
- Resets **in place** (no page reload): `STORAGE_WRITTEN_EVENT` drops render caches, the first-run Supplier
  Master seed is re-created (`window.initMasterData`, exposed by adding it to app.js's existing
  `Object.assign(window, …)` line — 0 lines), one Audit Log row, and the page the user is on is re-rendered
  through the app's router (`go(activePanel)`), like after load.
- Key names are storage contracts: `erp-storage-contracts.js` (1.2.0) now also exports
  `LEGACY_ORDER_FLOW_STORE_KEY`, `PRODUCT_EXPERIENCE_ROLE_KEY` and `PRODUCT_EXPERIENCE_MODE_KEY`, imported by
  `erp-order-flow.js`, `erp-product-experience.js` and the seed core instead of copied literals.
- The former separate "ล้างข้อมูลทดลอง" button of `local-demo-mode.js` (same job, own key list, page reload)
  is merged into this one: one definition of "this app's data".
- UI: both buttons in the always-visible Local Demo banner next to "วิธีเริ่มทดลอง" / "สำรองข้อมูล", plus a
  load shortcut in the dashboard empty state. Buttons are disabled only while an action runs.
- **Trial usage ignores sample data** (`trial-mode.js`): Local Demo caps invoices at 20, and the sample set
  alone has 18 — a presenter creating documents live would have been blocked mid-demo. Records tagged
  `demoSeed` no longer count toward Trial limits or tick onboarding steps.

### Fixes found with the sample data (each with a regression test that fails on the previous code)
- **Decision Council / role work queue**: approved quotations already linked to an invoice or production
  order (the app's `invoiceNo` / `productionNo` stamp, 🚚 / 🏭 in the quote list) were still listed as
  "พร้อมเปลี่ยนเป็น Sales Order" (`erp-decision-council-core.js` `quoteLinkedDownstream`,
  `erp-product-experience-core.js`).
- **Governance AR aging total** was the raw float sum of the satang-rounded buckets (428329.39999999997 for
  the sample data) and so did not equal the AR report total; it is now rounded to satang like the buckets
  (`erp-governance-core.js` `buildAging`).
- **Printed receipt buyer details** (`receipt-document.js` `loadFromReceipt`, the receipt list's
  "📄 ต้นฉบับ/สำเนา/PDF"): address, tax ID, contact, phone, D/O no. and due date were not taken from the
  receipt — the printout showed them blank or, because the editor state is a persisted draft, **those of the
  receipt opened before**. Now mapped from the receipt exactly as `buildStateFromReceiptPreview()` does.
- **WHT receipts clipped in print/PDF** — a render-golden change, justified here: a receipt with
  หัก ณ ที่จ่าย shows five total rows and a WHT note in the fixed-height bottom area under the 8-unit item
  table; in Chromium (print and html2canvas PDF) the "หัก ณ ที่จ่าย" and "รับเงินสด/โอนจริง" rows, the WHT note
  and the amount in words were cut off. CSS rules appended to `receipt-document.css`, all scoped to
  `.rcp-doc-totals-wht` / `:has(.rcp-doc-totals-wht)`, compact only WHT receipts (Thai one-line labels,
  tighter notes). The render functions `documentPagesHtml` / `documentPageHtml` are unchanged. Reviewed as
  real PDFs from the app's own `downloadPdf` in Chromium: the seeded WHT receipt and a worst case (WHT + full
  8-unit page + two-line note) show all five rows, the WHT note and the amount in words; a receipt without
  WHT is **pixel-identical** to before. Only `receipt.cssSha256` in `DOCUMENT_RENDER_GOLDEN_BASELINE.json`
  was updated (with a `changes` entry).

### Offline PDF libraries
- The exact npm releases (`npm pack html2canvas@1.4.1 jspdf@2.5.1`; registry integrity recorded) live in
  `vendor/` with their MIT LICENSE files and `vendor/vendor-manifest.json` (sha256, globals, former URLs).
  `index.html` loads them as the same classic scripts, so `window.html2canvas` / `window.jspdf` and the
  four document modules are unchanged. No npm dependency was added (`devDependenciesMax` stays 3).
  (`vendor/` + a build plugin instead of `public/vendor/`: the dev server serves `./vendor` directly and the
  plugin places the files next to the other assets in both builds, including the flat one.)
- `vite.config.js` has a build-only plugin that copies the files + licenses unchanged into `assets/`
  (dist) or the root (dist-flat) and rewrites the two `<script src>`; `build-deployment-check.mjs` lists
  them (and `.txt` licenses in the flat build); the Local Demo health dialog shows "PDF (ไฟล์ในเครื่อง)".
- `vendor/` is third-party code: excluded from the complexity and deep-code audits' runtime set and from
  the jsdom test boot (which previously skipped the CDN scripts).
- Verified in Chromium with every non-localhost request aborted, for `vite` (dev), `vite preview` (dist) and
  dist-flat: no watchdog / boot banner, `window.html2canvas` and `window.jspdf.jsPDF` defined, the receipt
  `downloadPdf` produced a PDF, zero external requests attempted.

## Complexity budget change
Measured: runtime lines 21,330 → 22,533 (first version) → **22,658** (this revision: +4 sample products and
the scenario rows, reset key scope, load/reset flow; the tagged-record reset and its dependents logic were
removed; +receipt/trial/council/governance fixes); runtime / root JS files +2 (the two modules).
- `runtimeLinesMax` 21,800 → **23,000** (unchanged by the revision: 342 lines of headroom remain).
- `runtimeJsFilesMax` 39 → **41**, `rootJsFilesMax` 40 → **42** (the two new modules).
- `app.js` baseline/delta rule unchanged; `appJsLinesDelta` stays at the pre-existing 19 (not worse).

## Consequences
- `tests/demo-seed.test.cjs` (13 tests: core determinism / coverage / calculators / numbering / reset key
  scope; jsdom load, agreement of dashboard / AR banner / AR report / governance / Decision Council, reset,
  no-mixing, replace, period lock, UI, printed receipt), `tests/offline-pdf-assets.test.cjs` (4), plus
  regression tests in `tests/decision-council.test.cjs` and `tests/governance-core.test.cjs`; the deployment
  check expects 11 files (+2 libraries, +2 licenses) and verifies the emitted copies byte-for-byte.
- Known, not changed here: the Excel export still loads SheetJS from a CDN on demand (`app.js`); the printed
  full tax invoice has no buyer head-office/branch line (golden-guarded layout); the receipt editor's
  payment-term field is not stored on receipts (prints the editor default).

## Revision history
- First version: sample data added next to existing data after a confirmation; reset removed only tagged
  records (and user documents created on sample invoices).
- Round 3 / phase 1: load refuses to mix / offers the reset; reset clears this app's keys (one definition);
  dataset: +4 products, buyer branch, VAT-inclusive full invoice, 100-day and fully-credited invoices,
  linked quotations; Trial counts ignore sample data; the four fixes above.
- R9.1 (13 Oct 2569): two clocks ("Dates — two clocks"); `DEMO_SEED_CORE_VERSION` 1.4.0; the reference-list year
  boxes start on the current year. Runtime lines +139 (38,860 → 38,999, under 39,400); i18n: the PP.30 / PND due-date lines moved past a weekend now have an English pattern; `app.js` unchanged in length.
