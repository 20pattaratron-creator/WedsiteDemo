# ADR-017 — Button levels, one icon set, a one-screen executive dashboard

## Status
Accepted for Local Demo (round 5, part C — last part of the UI declutter). Builds on ADR-015 (header,
Demo menu, grouped sidebar) and ADR-016 (row "⋯" menus).
**Sizes updated by ADR-019 (round 6):** buttons 38 → 42 px (15 px text, 18 px icons), small 32 → 36 px
(14 px text), touch targets 40 → 44 px on ≤ 900 px; levels, colours and rules below are unchanged.

## Context
Measured in Chromium with the sample data (1440×900): the executive dashboard was 4,470 px tall (~5
screens) with 70 buttons; screens mixed solid buttons in four colours (blue, green, purple, red, plus
gradient tabs) — the receipt form showed 7 solid controls — and `!important` theme rules in
`style.css` / `erp-product-experience.css` fought each other. Controls mixed emoji (💾 👁 🖨️ ⬇ 📄 ✏️ 🧾
🔎 ↻ ＋ ☰ …) with part A's line icons.

## Decision
1. **Button levels, defined once in `erp-ui.css`** (tokens `--erp-btn-*`): `.btn-primary` solid brand
   `#155886`, `.btn-secondary` outline, `.btn-tertiary` text/link, `.btn-danger` red outline; one
   height (38 / 32 px small), radius, padding, focus-visible ring, disabled state; ≥ 40 px on ≤ 900 px.
   Rule: **at most one solid primary per visible area** (page header toolbar, form toolbar or footer,
   card, dialog). Forms: "บันทึก" primary, ดูตัวอย่าง / พิมพ์ / PDF secondary; lists: "+ สร้าง…" primary,
   Excel tertiary; row primaries (ADR-016) secondary. `btn-ghost/green/purple/red/amber/view` are kept
   only as aliases of secondary. Selected tabs (branch tabs, preview tabs, master-data tabs) now look
   selected, not like a second primary. Removed as redundant: the two gradient `.btn-primary`
   `!important` themes, `.btn{border-radius/font-weight !important}`, the invoice/receipt toolbar
   `!important` block, the analytics-head and hero search-button overrides, the planner's own button
   styles, `.target-input-wrap button`, `.expense-camera-btn` colours. What a button does is unchanged.
2. **One icon set — `erp-icons.js`**: named 24×24 line icons (stroke 2, round caps — part A's style;
   part A's sidebar/Demo-menu drawings moved here, no copy kept), injected once as an SVG sprite;
   `icon(name)` returns `<svg class="erp-icon" aria-hidden="true" focusable="false"><use …/></svg>`; the
   label stays. Used by buttons, toolbars, the Demo menu, the sidebar, row actions (`ROW_ICON` now holds
   names), search results, the document editor toolbars. `local-demo-health.js` and
   `erp-production-core.js` read `window.ERPIcons` (they are run as plain scripts by tests). Section
   headers drop their emoji (the card-title accent bar marks them). **Not touched:** printed/PDF pages
   (`*-document.js` page functions, `*-document.css`; `audit:render-golden` PASS unchanged), toast and
   message text, status badges, `<option>` text, fixtures.
3. **Dashboard** (`DASHBOARD_VIEW_BLOCKS`, `erp-customer-experience.js`): ภาพรวม = compact title,
   branch tabs + month/year (every view), view tabs (`role="tablist"`, `aria-selected`, roving tabindex,
   ←/→/Home/End), 4 KPIs (ยอดขาย and กำไรสุทธิ = 2 of renderDash's 5 cards; ลูกหนี้คงค้าง and เกินกำหนด =
   `#dash-ar-kpis` rendered by `erp-receivables.js` from the same snapshot as the aging report),
   "สิ่งที่ต้องทำ" (order-flow work queue + Decision Review top actions) and 2 charts (sales vs target,
   customer mix). AR banner/report → ลูกหนี้ค้างรับ; the 5 cards, branch detail, operations, comparison,
   planner, executive charts, targets, production-vs-delivery, chart grid and recent documents →
   ยอดขายและเป้าหมาย; forecast/quant stay advanced-only. Removed duplicates: "+ สร้างใบเสนอราคา",
   "ข้อมูลลูกค้าและสินค้า", "วิธีเริ่มทดลอง", "ตรวจ Decision Council", "เปิดศูนย์งานขาย". No new
   calculation.
4. **Leftovers:** `delDoc` checks every refusal before `confirm()`; after a row action re-renders its
   list, focus returns to the same row's primary/"⋯" (`armRowFocusRestore`/`restoreRowFocus`, 3 s,
   only while focus is lost and the row is on the active page); the last action column of `.tbl-wrap`
   tables is sticky on the right with a shadow (desktop too); unused `.brules-delete`,
   `.prodcore-actions`, `.expense-evidence-view`, `.erp-row-actions` removed (`.cn-row-actions` stays:
   it is in the golden-hashed `credit-note-document.css`).

## Consequences
- Dashboard 4,470 → 1,282 px (≈1.4 screens) and 70 → 33 buttons at 1440×900; 8,154 → 2,696 px on 390×844.
- Visible `.btn-primary`: dashboard 3 → 0, work-home 1 → 0, lists 1, forms 1 per area (toolbar + footer).
- Contrast (label on background): primary 7.58:1, secondary 7.58:1, tertiary 7.58:1, danger 6.47:1.
- `app.js` +0 lines (8,268). Quality budget: a shared icon module instead of per-file SVG copies →
  runtime JS 43 → 44 files (root 44 → 45) and 23,957 → 24,242 lines: `runtimeJsFilesMax` 44,
  `rootJsFilesMax` 45, `runtimeLinesMax` 24,300; nothing else changed.
- Test stability (pre-existing, reproduced on the part B snapshot): `local-demo-health.js`'s single-flight
  wrapper now keeps the flags of the function it wraps (`__stockGuard`), and two tests wait 300 ms before a
  second save instead of racing the guard's 250 ms window.
