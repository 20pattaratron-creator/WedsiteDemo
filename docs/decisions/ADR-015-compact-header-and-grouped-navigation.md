# ADR-015 — Compact header, one "Demo" menu and a grouped sidebar

## Status
Accepted for Local Demo (round 5, part A of the UI declutter). Parts B (row "⋯" menus in tables) and C
(button levels, one icon set, shorter dashboard) follow separately and are not part of this decision.

## Context
Every screen stacked three bars before any content (measured in Chromium, sample data loaded: 166 px at
1440×900, 326 px at 390×844): the sticky orange strip `#erp-trial-safety-banner`, the dark header and a
green Local Demo banner with five buttons (ตรวจสถานะ Demo, โหลดข้อมูลตัวอย่างสำหรับสาธิต, วิธีเริ่มทดลอง,
สำรองข้อมูล, ล้างข้อมูลสาธิตทั้งหมด). Three modules wrote into that banner by DOM position
(`local-demo-mode.js`, `local-demo-health.js`, `erp-demo-seed.js`). The sidebar was a flat list of 27 entries
(22 in โหมดง่าย) whose section headings were all hidden, with separate "create" and "list" entries per
document.

## Decision
1. **One slim notice.** `#erp-trial-safety-banner` stays the single warning, one line, not sticky, on every
   page: "DEMO 4.3.1 · ข้อมูลทดลองเก็บในเบราว์เซอร์นี้เท่านั้น · ยังไม่ใช่ระบบ Production หลายผู้ใช้". Phones
   (≤560 px) show a short line that keeps both warnings; the full sentence is also its `title`. The green
   banner is gone; the floating "DEMO · Local data" pill of `boot-status.js` is hidden in Local Demo (it
   repeated the notice). The runtime error banner is unchanged. Nothing wrote status text into the green
   banner; the health check (runtime errors, PDF, storage) stays in the "ตรวจสถานะ Demo" dialog.
2. **"⚙ Demo" menu.** The last header control is a menu button (`aria-haspopup="menu"`,
   `aria-expanded`, `aria-controls`) built by the new reusable `erp-ui-menu.js` (menu-button pattern:
   Enter/Space/ArrowDown/ArrowUp open, arrows/Home/End move, Esc closes and returns focus, Tab and a click
   outside close; the menu is `position:fixed` in `<body>` so no container clips it — part B reuses it via
   `openMenuFor()` for table rows). Modules add their items with
   `window.ERPDemoMenu.register({ key|id, label, icon|iconSvg, order, danger, title, dataset, onSelect })`:
   same key = replace (idempotent), items registered before the header exists are queued, danger items
   always come last after one separator. Every item keeps its former id / `data-demo-seed-action` and calls
   the same handler as its banner button (health dialog, `TrialService.toggleOnboarding(false)`,
   `exportAllJSON()`, the seed load/reset delegation with its existing confirmations).
3. **Grouped, collapsible sidebar** (`NAV_SECTIONS` in `erp-product-experience-core.js`, built by
   `erp-product-experience.js`): หน้าหลัก (งานของฉัน, ภาพรวมผู้บริหาร, ศูนย์อนุมัติ) · ขายและรับเงิน
   (ใบเสนอราคา, ใบส่งสินค้า / ใบกำกับภาษี, ใบเสร็จ / รับชำระ, ใบลดหนี้, ศูนย์งานขาย & ลูกหนี้) · ซื้อ / ผลิต / คลัง
   (สั่งผลิต, จัดซื้อ / PO, รับสินค้าเข้าคลัง, คลังสินค้า) · ค่าใช้จ่าย · ข้อมูลและรายงาน (ลูกค้า / ผู้จำหน่าย /
   สินค้า, Trace เอกสาร, วิเคราะห์ธุรกิจ, พอร์ทัลลูกค้า) · ตั้งค่า (สูตรและกฎธุรกิจ, ศูนย์ควบคุม, ตั้งค่าบริษัท,
   สำรอง / นำเข้าข้อมูล). รับเงิน shares the sales section because it has one entry besides the order-flow
   centre; ศูนย์อนุมัติ is a daily inbox, so it is on หน้าหลัก. Headings are buttons (`aria-expanded`); the
   collapsed set is stored per tenant in `NAV_COLLAPSED_SECTIONS_KEY` (`erp_nav_collapsed_sections_v1`,
   storage contracts 1.4.0) and, like the โหมดง่าย/ขั้นสูง key, kept by the demo reset
   (`DEMO_RESET_KEPT_BASE_KEYS`). Arriving at an entry of a collapsed section opens it (and remembers that);
   a section the user folds while on one of its pages stays folded and still shows that page's entry.
   `ADVANCED_PANELS` still hide in โหมดง่าย, and a section with no visible entry hides its heading
   (ตั้งค่า in โหมดง่าย). 21 entries (16 in โหมดง่าย). — ADR-020: ตั้งค่าบริษัท is no longer advanced, so
   โหมดง่าย has 17 entries and shows ตั้งค่า with that one entry; the Demo menu gained "ข้อมูลบริษัทและโลโก้" (order 15).
4. **One entry per document.** The entry opens the list; each list header has one primary "+ สร้าง…"
   button; each form has a "← รายการ…" link back to its list (added by `erp-product-experience.js`); a form,
   and the issued-document lists, highlight their document's entry (`NAV_ENTRY_FOR_PANEL`). No `go()`
   route changed; a test scans every route the code uses and opens it.
5. **Phones/tablets.** Header controls, menu items, section headings and the back link are ≥ 40 px tall
   (≤900 px); the header no longer reserves space for the removed user bar; the ☰ drawer now also closes
   for entries added by modules (delegated handler in `click-fallback.js`); a heading click leaves it open.
6. New CSS lives in `erp-ui.css` (loaded last) and the Demo button in `local-demo-mode.css`. Button levels,
   icon set and table row actions are left to parts B/C.

## Consequences
- Top chrome 166 → 97 px (1440×900), 326 → 88 px (390×844), 220 → 87 px (768×1024); header buttons 7 → 3
  (desktop), sidebar 27 → 21 entries (22 → 16 in โหมดง่าย).
- `app.js` +0 lines (only `issueReceiptFromInvoice` added to the existing `Object.assign(window, …)`, so the
  invoice-list row button keeps working once the receipt form has no menu entry of its own).
- Quality budget: runtime JS 41 → 42 files (`erp-ui-menu.js`, root JS 42 → 43) and 22,651 → ~23,460 lines.
  The menu is a shared accessible component that part B reuses for every table instead of each list
  building its own; the rest is the sidebar grouping and registration API, written one statement per line.
  `QUALITY_BUDGET.json`: `runtimeJsFilesMax` 42, `rootJsFilesMax` 43, `runtimeLinesMax` 23,500 — nothing
  else changed. (The pre-existing `appJsLinesDelta` = 19 of `audit:complexity` is unrelated and unchanged.)
