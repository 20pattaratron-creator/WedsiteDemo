# ADR-020 — Customer-editable company profile and logo

## Status
Accepted for Local Demo (round 7). Tests: `tests/company-profile-core.test.cjs` (12, fast),
`tests/company-profile.test.cjs` (6, app boot).

## Context
Prospective customers want to see **their own** logo and company on the screens and on the printed
tax invoice. The company was hard-coded in `local-demo-mode.js` (`demoProfile.companyProfile`) and the
logo was a fixed `logo.png` (`COMPANY_LOGO_URL` in the 4 document modules, the app.js entry toolbar, the
header). Constraints: printed pages are guarded by `audit:render-golden` (their render functions and CSS
may not change); `app.js` may not grow; storage keys are contracts (ADR-003); backups are fail-closed.

## Decision
1. **Data.** Two tenant keys (`erp-storage-contracts.js` 1.5.0): `comform_company_profile_v1` (name TH/EN,
   tax ID, head-office address, phone, email, website, per branch code / label / address) and
   `comform_company_logo_v1` (a PNG/JPEG data URL made by our canvas). Rules are pure in
   `erp-company-profile-core.js`: 13-digit tax ID with the check digit (the placeholder `0000000000000` only
   while still the saved value), head office `00000`, branch 5 digits ≠ `00000`, required name / tax ID /
   address, lengths, one-line text without control / bidi characters. Save is all-or-nothing (logo first,
   then profile; a `QuotaExceededError` rolls back, a clear Thai message, nothing changed).
2. **Applied once, read everywhere.** `local-demo-mode.js` merges the saved profile into
   `window.CurrentUser.companyProfile` before any document module runs; `erp-company-profile.js` re-applies
   after a save / restore / other tab and fires `erp:company-profile-changed` (+ `erp:storage-written`).
   Documents keep their templates: `branchCompany()` / `branchInfo()` first ask `documentCompany()` and
   get the same field names they always returned; `COMPANY_LOGO_URL` became a `let` set from
   `companyLogoUrl()` (the one getter: custom data URL or `./logo.png`), also used by PDF mode
   (`pdfLogoDataUrl`), the header and the entry toolbars. Tax-invoice / receipt print the branch after the
   name ("… จำกัด (สาขาที่ 00001)", as their built-in defaults did); quotation / credit note print it as their
   label. No example English address leaks onto a customer's invoice (addressEn is empty).
3. **Default unchanged.** With nothing saved no code path differs: render-golden PASS without regenerating,
   and the HTML of 16 renders (all types, both branches, original/copy) is byte-identical to round7-base.
   The print window gets an extra `<style>` only for a custom logo; a custom logo carries the MIME
   parameter `erp-logo=custom` so CSS keeps it uncropped (quotation's round frame) and untinted (receipt's
   hue-rotate) without touching the guarded CSS.
4. **Logo pipeline.** PNG/JPEG/WebP only (SVG/GIF/other rejected), ≤ 5 MB, real type sniffed from the bytes,
   pixel size read from the header before decoding (≤ 12,000 px / 50 MP, ≥ 32 px), redrawn on our canvas to
   ≤ 600 px, PNG (transparency kept) — JPEG only for an opaque logo when ≥ 30 % smaller — stepping quality
   then size down until the data URL is ≤ 300,000 chars. The uploaded file is never stored or rendered.
5. **Backup / reset.** JSON backups carry `masterData.companyProfile` `{schemaVersion, profile, logo}`,
   validated in `ERPBackup.validate()` before any write and restored in the same transaction as the master
   data (replace: always; merge: unless the local copy is newer). Old backups have none → the current
   profile is untouched. The logo key is **kept out of `ERPBackup.capture()`** (8 local auto-snapshots would
   copy ≤ 300 KB each); capture still carries it in memory (non-enumerable) so an in-page rollback restores it.
   **"ล้างข้อมูลสาธิตทั้งหมด (รีเซ็ต)" keeps profile and logo** (`DEMO_RESET_KEPT_BASE_KEYS`): they are the
   customer's settings, not sample data, and a presenter resets sample data between runs; the form has its
   own "กลับไปใช้ข้อมูลตัวอย่าง" (confirm), and the reset confirmation says so.
6. **UI.** ตั้งค่าบริษัท top card "ข้อมูลบริษัทและโลโก้": form + live document-header preview, one solid
   "บันทึก" (the page's former "+ เพิ่มสาขา" primary became secondary), "ยกเลิก/คืนค่า", inline errors,
   success toast, a confirm when leaving with unsaved edits and `beforeunload`.
7. **Reachable in โหมดง่าย (the default).** `saas-admin` left `ADVANCED_PANELS` (ADR-014 list), so the sidebar
   shows ตั้งค่า › ตั้งค่าบริษัท in both modes (17 entries in โหมดง่าย, ADR-015); in โหมดง่าย that page shows only
   this card — the SaaS / branch add-on card stays โหมดขั้นสูง (CSS). Shortcuts: the header company name is a
   button ("แก้ไขข้อมูลบริษัทและโลโก้", click / Enter / Space; the logo keeps its dashboard shortcut) and the
   ⚙ Demo menu has "ข้อมูลบริษัทและโลโก้" (ADR-015 registration API, order 15). Tests that encoded the old
   gating (single-admin-view, ui-declutter: hidden list, 16 → 17 entries, ตั้งค่า visible, Demo menu 5 → 6)
   were updated; `company#boot7` proves the sidebar / header / menu paths in โหมดง่าย.

## Consequences
- Quality budget (deliberate): runtime files 44 → 46, root JS 45 → 47, runtime lines 24,500 → 25,700
  (two new modules ≈ 1,080 lines: validation, logo pipeline, form). `app.js` +0 lines (the import took a blank
  line). The pre-existing `appJsLinesDelta=7` of `audit:complexity` (not part of `verify`) is unchanged.
- Duplication of the document controllers went down (exact pairs 6 → 5, 10-line groups 140 → 131);
  `tests/document-shared-core.test.cjs` records the new values. `tests/vm-esm-helper.cjs` now substitutes
  `import.meta.url` like `dom-helper.cjs` (erp-backup.js imports the core).
- Limits: in-app labels (branch selects, menus) still say
  "สาขาที่ 00001" — only printed documents use the edited code; no English address field; one logo for
  both branches; data stays in this browser (and in exported backups).
