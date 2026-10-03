# ADR-016 — One primary action + "⋯" menu per table row

## Status
Accepted for Local Demo (round 5, part B of the UI declutter). Builds on ADR-015 (part A); part C (button
levels, one icon set, shorter dashboard) follows.

## Context
List tables printed every action on every row. With the sample data the invoice list had 108 row buttons
(6 per invoice: ต้นฉบับ/สำเนา/PDF, 👁, แก้ไข, ออกใบเสร็จ, ลดหนี้, ลบ), the receipt list 32, the quotation
list 25. The action cells were `<td style="display:flex">` (the credit-note cell `.cn-row-actions`,
also flex), which stops them behaving as table cells: on a 390 px phone the sticky last column
collapsed and its buttons overlapped neighbouring rows. Eligibility rules lived inline in each
renderer's template string, next to inline `onclick` calls.

## Decision
1. **One action list per row** — `erp-row-actions.js`. Each list (quote, invoice, receipt, issued
   invoice/receipt, expense, production, credit note, PO, goods receipt, customer/supplier, product,
   sales order, billing note, payment, product/customer rule override) is defined once:
   `actions(facts)` with the old conditions as `when` flags and `primary(facts)` = ids in order of
   preference. The renderer passes a few plain facts (branch, year, month, id, no, paid, voided …);
   they are written as JSON on the cell and the SAME `rowActions(listId, facts)` rebuilds the list on a
   click or when the menu opens. No closure or listener per row; a re-rendered table leaves nothing.
2. **Same handlers.** An action is either `call {fn, args}` — the global function the old inline
   `onclick` called, same arguments (quoted ids as strings, unquoted as raw values) — or `dataset` —
   the old `data-cn-action` / `data-order-action` / `data-prodcore-action` / `data-del-*` attributes,
   still run by the owning module's delegated listener. Handlers keep their confirmations.
3. **Primary rules** (the row's most likely next step): invoice outstanding → "รับชำระ"
   (`issueReceiptFromInvoice`), settled (paid / fully credited) → เอกสาร/PDF; quotation approved and
   without production order / invoice → "สั่งผลิต", else เอกสาร/PDF; receipt / credit note → เอกสาร;
   production order not yet invoiced → "สร้างใบส่ง/ภาษี", else ดู; PO not received/cancelled →
   "รับสินค้า"; billing note not paid/cancelled → "รับชำระ", else พิมพ์; master data → แก้ไข; issued
   copies / expenses → ดู. A destructive action is never the primary (GR reversal, payment void and rule
   deletes are "⋯" only). The Sales Order row keeps its "สิ่งที่ควรทำต่อ" button as its primary.
4. **Menu order**: view/print/PDF → edit → create follow-up documents → other → separator → destructive
   (red). **Ineligible actions are hidden**, never shown disabled (the paid billing note's disabled
   "รับชำระ" is now hidden). Voided receipts and voided credit notes are view-only.
5. **One menu system.** "⋯" is a `<button>` (`aria-haspopup="menu"`, `aria-expanded`,
   `aria-label="การทำงานเพิ่มเติม <เลขที่>"`) opening part A's `openMenuFor()` menu: body-level, flips above
   near the bottom, follows scrolling, Escape returns focus, outside click / Tab close, one menu open.
   ArrowDown/ArrowUp on "⋯" open it (one delegated `keydown`). A MutationObserver, alive only while a row
   menu is open, closes it when its button leaves the page (table re-rendered).
6. Styling only in the action cell (`erp-ui.css`): primary + "⋯" on one line, ≥ 40 px on ≤ 900 px.

## Consequences
- Row buttons with sample data (1440×900): invoices 108 → 36, receipts 32 → 16, quotations 25 → 10,
  credit notes 10 → 7, production 4 → 2, billing 3 → 2; every row ≤ 2 buttons. No overlap at 390/768 px.
- Bugs fixed on the way: "ปิดใช้งาน" in customer/supplier/product master called functions that were not
  on `window` (ReferenceError; now exported in `app.js`'s existing `Object.assign`); the business-rule
  override "ลบ" had no confirmation (added) and bound one listener per row per render (now one delegated).
- `app.js` 8,280 → 8,268 lines (inline row markup moved out). `erp-production-core.js` reads
  `window.ERPRowActions` instead of importing (it is also run as a plain script by the vm tests).
- Quality budget: a shared module used by 6 renderers instead of per-list copies → runtime JS 42 → 43
  files (root 43 → 44) and ~23,460 → 23,957 lines: `runtimeJsFilesMax` 43, `rootJsFilesMax` 44,
  `runtimeLinesMax` 24,000; nothing else changed. (The pre-existing `appJsLinesDelta` of
  `audit:complexity` drops from 19 to 7.)
