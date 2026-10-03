# ADR-014 — Single Admin View (no per-role "มุมมอง")

## Status
Accepted for Local Demo. Requested by the product owner: "เอามุมมองรายบุคคลออก ให้เป็นมุมมอง Admin อย่างเดียว".

## Context
DEMO 4.0 added a top-bar dropdown "มุมมอง" (`#pe-role-select`) with six personas — ผู้บริหาร (default),
ฝ่ายขาย, จัดซื้อ, คลัง/จัดส่ง, บัญชี/ลูกหนี้, ผู้ดูแลระบบ. It was UX only (no authorization), but it changed a
lot: `ROLE_PANELS` hid sidebar items (the default ผู้บริหาร hid every "create document" screen), the work
queue, KPIs and shortcuts on "งานของฉัน" differed per role, and `erp-receivables.js` showed the overdue AR
banner/badge only to accounting/management/admin. In demos the presenter first had to switch to
"ผู้ดูแลระบบ" (DEMO_SCRIPT_TH.md), and a prospect who picked another role saw missing menus.

## Decision
One view for everyone, equal to the former `admin` role.
- No role selector. The top bar keeps only the **โหมดง่าย / โหมดขั้นสูง** toggle (`#pe-mode-toggle`,
  `ADVANCED_PANELS`, `PRODUCT_EXPERIENCE_MODE_KEY`), which works exactly as before: โหมดง่าย hides
  analytics, business-rules, audit-log, saas-admin, files. (The product owner is told it exists and may ask
  to remove it later.) On phones (≤560 px) the toggle stays hidden, as before; the wrapper is renamed
  `.pe-view-controls` and no longer floats as a button box at the bottom right.
- Work queue: `buildWorkQueue(snapshot, options)` — the `role` parameter and every item's `roles` metadata
  are removed (nothing else used them); it returns every rule's item, highest risk first.
- "งานของฉัน": the management/admin KPIs (ยอดลูกหนี้, Sales Order กำลังทำ, Open PO, Stock ต่ำ/เสี่ยง), header
  "DEMO 4.3.1 · Admin", one shortcut list (ภาพรวมผู้บริหาร, อนุมัติงาน, งานขาย / วางบิล / รับเงิน,
  พอร์ทัลลูกค้า, and in โหมดขั้นสูง also วิเคราะห์ธุรกิจ, ศูนย์ควบคุม — a shortcut is never offered to a
  screen the current mode hides, which previously bounced back to งานของฉัน).
- Overdue AR banner (dashboard + งานของฉัน) and the navigation badge are always shown.
- Approval center: the role pill is removed; a PO approved there records `approvedBy: 'DEMO:Admin'`.

## Stale stored value
The old choice lives in `erp_tenant::<tenant>::erp_product_experience_role_v1`.
- Nothing reads it any more, so a leftover value (e.g. `'warehouse'`) has no effect.
- It is also **removed on startup** (`removeRetiredRoleSetting()` in `erp-product-experience.js`, best
  effort) so a browser does not keep dead data, and a demo reset now removes it too (it was taken out of
  `DEMO_RESET_KEPT_BASE_KEYS`; only the mode key is kept).
- `PRODUCT_EXPERIENCE_ROLE_KEY` **stays** in `erp-storage-contracts.js` (1.3.0), marked RETIRED: the startup
  clean-up needs the name, the contract test forbids copying the literal, and keeping it reserved prevents
  the key from being reused with a different meaning.

## Removed
`ROLE_CONFIG`, `normalizeRole` (core); `ROLE_PANELS`, `currentRole()` (also from
`window.ERPProductExperience`), per-role `homeKpis` branches and action map, the role `<select>` and its
listener, `document.body.dataset.erpRole` (no CSS/JS used `data-erp-role`), the role pill (UI);
`ALERT_ROLES`, `currentRole()`, `alertsAllowed()`, the `pe-role-select` change listener and the
"dashboard hidden → open billing tab" fallback of `openReport()` (receivables — the dashboard menu can no
longer be hidden); `.pe-role-*` CSS. Test "review#4" (role-gated banner) is replaced by
`tests/single-admin-view.test.cjs`; `tests/dom-helper.cjs` `boot()` accepts `{ beforeScripts }` to seed
localStorage before the app starts.

## What stays
- The simple/advanced toggle (above).
- Cloud-mode branch locking in `app.js` (`getLockedUserBranch()` / `lockBranchForStaff()`): it restricts a
  single-branch staff login to its branch in cloud mode. In Local Demo the profile has `branch: 'all'`, so it
  is inert. It is authorization-like behaviour of the cloud login, not a persona view; not changed.
- Document data that stores a person (`salesPerson`, พนักงานขาย, ผู้บันทึก) and printed-copy audiences
  ("สำหรับพนักงานส่งของ", "สำหรับฝ่ายบัญชี") — business data, not views.
- Customer Portal (Preview) — a preview of what an external customer would see, not an internal persona.

## Consequences
- Everyone sees every working screen and all company-wide figures (AR amounts included). This is a Local
  Demo; real permissions must still be enforced server-side (ERP_CONSTITUTION) before production.
- Runtime lines 22,658 → 22,647 (−11) even though touched code was split to one statement per line;
  `app.js` untouched; `QUALITY_BUDGET.json` unchanged.
