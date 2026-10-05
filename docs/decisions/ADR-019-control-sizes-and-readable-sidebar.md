# ADR-019 — Bigger controls and a more readable sidebar (one size scale)

## Status
Accepted for Local Demo (round 6). Changes the sizes of ADR-017 §1 (button levels) and of the ADR-015
sidebar; the levels, colours, icons and behaviour stay as they were. Tests: `tests/ui-control-sizes.test.cjs`.

## Context
The demo is shown to customers on laptops (1366×768 to 1920×1080) and phones. Measured in Chromium with
the sample data on all 29 screens plus the Demo menu, a row "⋯" menu, the detail dialog, global search and
the ☰ drawer (597 controls at 1440×900, 596 at 390×844): 354 desktop controls were under 36 px tall or had
text under 14 px, and 443 phone controls had a hit area under 44×44 px. Small buttons were 32 px with 13 px
text, row "⋯" 32 px, preview zoom 28×28 px, close × 22–26 px, filter selects 31 px with 13 px text,
checkboxes 13–15 px (one was 235 px wide), tabs 12–13 px text, the quote "ราคาแนะนำ" button 10 px. Many
of these were local rules that set their own smaller size, and many buttons had no font size at all (the
browser's 13.3 px). The sidebar used 14 px entries (body text is 16 px) and 12 px headings in `#6b7a93`
(4.35:1 on white — under WCAG AA 4.5:1), 18 px icons, 32–34 px rows.

## Decision
1. **One scale, as tokens in `erp-ui.css`.** Buttons 42 px / 15 px text / 18 px icon (was 38 / 14 / 16);
   small buttons 36 px / 14 px / 16 px icon (was 32 / 13 / 16). The other families use the same scale:
   `--erp-control-font-size` 14 px (smallest text on any control), `--erp-control-height(-sm)` = the
   button heights (selects / text fields line up with the toolbar beside them), `--erp-tab-height` 40 px
   (tabs, chips, branch switches), `--erp-icon-btn-size` 36 px (close ×, row "⋯", line-item remove, zoom),
   `--erp-menu-item-height` 40 px, `--erp-check-size` 20 px. **≤ 900 px:** `--erp-touch-target` 40 → 44 px
   and every family token becomes 44 px in one `:root` block, so each rule that reads a token follows.
2. **Fixed at the source.** Local rules that set a smaller size now read the tokens (`style.css`
   filter bar, dtab, preview tabs / zoom, doc-number button, pay checkbox, CSV / import selects, form
   labels 13 → 14 px, the drawer; `business-rules.css`, `erp-order-flow.css`, `erp-receivables.css`,
   `erp-product-experience.css`, `erp-customer-experience.css`, `local-demo-mode.css`, `trial-mode.css`,
   `executive-charts.css`); buttons that had no font size get the token. Two dead `#auth-userbar button`
   rules (element removed in ADR-015) are gone. The 46 px look of form fields no longer applies to
   checkboxes / radios. Three floors in `erp-ui.css` have no specificity (`:where`), so a screen's own rule
   still decides — it only cannot go smaller: checkboxes / radios 20 px, selects / text fields ≥ a small
   button, close × buttons = icon buttons; on ≤ 900 px a checkbox label is ≥ 44 px. The quote-approval and
   billing-pick checkboxes in tables use `.erp-check-label` (the billing one gained a label and an
   `aria-label`; same input, same handler). No `!important` was added except where the rule already had it.
3. **Sidebar.** Entries 15 px, line height 1.45 (stacked Thai vowels / tone marks), rows ≥ 40 px, 20 px
   icons; headings 13 px in `#52617a` (6.27:1 on white, 6.07:1 on the sidebar's bottom tint) and ≥ 36 px
   (44 px in the drawer); the overdue badge 12 px / 22 px. 15 px rather than 16 px: the longest entries
   ("ใบส่งสินค้า / ใบกำกับภาษี", "ลูกค้า / ผู้จำหน่าย / สินค้า") stay on one line in the 245 px sidebar at
   1366 px, so the content area keeps its width; 16 px would need ~265 px. The drawer uses the same tokens.
4. **Not touched:** printed / PDF pages and the document screens (`*-document.js`, `*-document.css`, the
   inline preview, `#panel-delivery-tax-doc`, `#panel-receipt-doc`, `#panel-quotation-document` are outside
   the floors) — `audit:render-golden` PASS with the baseline unchanged. Status badges, hint text and
   table text keep their sizes. No behaviour changed.

## Consequences
- Flagged controls (sample data, all screens): desktop 354 → 6, phone 443 → 6. The 6 are the sidebar
  section headings at 13 px (by this decision: a level below the 15 px entries; 36 / 44 px tall).
- No horizontal page scroll at 1366, 1440, 1920, 768 or 390 px; the sticky action column (ADR-017) still
  holds the row primary + "⋯" on one line (36 px; 44 px on phones). Dashboard ภาพรวม 1,448 → 1,452 px at
  1440×900 (+0.3 %), 2,785 → 2,814 px at 390×844. The sidebar's list is taller (953 → 1,176 px) and
  scrolls on short screens, as it already did at 1366×768.
- `app.js` +0 lines (one inline style became a class). Quality budget unchanged.
