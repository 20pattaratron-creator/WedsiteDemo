# ADR-022 — One or two establishments (สำนักงานใหญ่อย่างเดียว / สำนักงานใหญ่ + 1 สาขา)

## Status
Accepted for Local Demo (round 8, stage B). Tests: `tests/branches-core.test.cjs` (5, fast) and
`tests/branch-mode.test.cjs` (7, app boot). All 12 fail on round8-stageA and pass now.

## Context
The app was hard-wired to two branches, internal ids `ubon` (สำนักงานใหญ่) and `khonkaen` (สาขาที่ 00001). These
ids appeared in about 28 places in `app.js` and in many modules: branch radios on every form, label maps, dashboard
tabs, list filters, reports, aging, the council, sample data, backup and export loops. Most Thai SMEs have one
establishment, so they saw a second branch everywhere. The ADR-020 company profile let the customer set branch
codes and names, but the menus and filters still showed "สาขาที่ 00001".

## Decision
1. **One source of truth:** `erp-branches-core.js`. It holds the setting
   `comform_company_branch_setting_v1` = `{schemaVersion, count: 1|2, updatedAt}`, and a missing or damaged value means 2.
   It also provides:
   - the labels from the saved profile, such as "สำนักงานใหญ่" or "สาขาที่ 00003 · สาขาขอนแก่น". With no profile saved,
     each screen keeps its own text from before.
   - `branchLabelMap()`, a live getter object that replaces `BRANCH_TH` / `BRANCH_LABEL(S)` in `app.js`,
     credit-note, order-flow, product-experience, production-core and receivables. Its keys stay the two ids, so the
     validity checks still work.
   - "ทั้งบริษัท" in place of "รวมทั้ง 2 สาขา", the census of branch-2 data, the refusal and warning texts, and the
     branch field of the A4 editors.

   `window.ERPBranches` (installed by `local-demo-mode.js`) serves the plain scripts. The internal ids and storage
   keys are unchanged, and no data is migrated. In `app.js`, only existing lines were edited; the one import line
   took a blank line (8,268 lines, as before).
2. **Setting:** ตั้งค่าบริษัท › "จำนวนสถานประกอบการ". It is saved in the same all-or-nothing write as the profile. If
   only the count changed and no profile is saved, only the setting key is written, so the company stays the sample
   profile and printed documents do not change. JSON backups carry it as `masterData.companyProfile.branchSetting`,
   validated fail-closed. Old backups do not touch it. A merge keeps a newer local setting. Auto-snapshots include it.
   The demo reset keeps it, because it is a setting and not sample data.
   **Defaults:** existing stores and a brand-new empty store both get **2**. A store that never chose cannot be told
   apart from a new one, and 2 keeps every existing screen, test, golden and backup unchanged. The demo script tells
   the presenter to choose before loading sample data.
3. **Money rule (data scope never shrinks):**
   - Totals, reports, aging, the council, numbering, export and backup keep reading **both** ids, through
     `tenantActiveBranchIds()` and the modules' own lists. Only the **screen** changes.
   - Switching to 1 is **refused** while branch 2 holds anything. That covers any record in its document packs
     (cancelled tax documents included), sales orders, billing notes, payments and reservations naming it, PO, GR and
     stock movements, products with branch-2 opening stock, and any store that cannot be read (fail-closed). The Thai
     message names the counts and points to the demo reset. Nothing is saved.
   - The screens are single-branch only while the setting is 1 **and** the census is empty. If branch-2 data appears
     later (a backup or CSV import), the screens show both branches again and a warning banner. The setting is not
     changed silently, and every total still includes the data.
4. **Single-branch screens:**
   - Hidden: the branch radios on the q/i/r/e/p/credit-note forms and the A4 editors (head office auto-selected on
     reset, in `getBr()`, attachments and the editors' defaults and drafts), filters and selects (`[data-erp-branch-hidden]`,
     a branch-2 value falls back to all or head office), dashboard tabs and the branch comparison, the linked-flow branch
     switch, the stock transfer card, branch-2 opening stock, the analytics branch table and the SaaS branch add-on.
   - The KPI and scope labels say "ทั้งบริษัท". CSV history without a branch goes to the head office.
5. **Sample data:** `buildDemoSeedPlan({branchCount: 1})` issues every document from `ubon`:
   - Numbering is per prefix and month, so numbers, billing, payments and receipts stay the same coherent sequence.
   - Branch-2 rent and electricity (that building does not exist) are left out, so there are 7 expenses instead of 11.
   - Opening stock moves to the head office with the same total per product.
   - The targets come out as company and head office only.

   The two-branch plan is unchanged and passes the same seed integrity checks.
6. **Default rendering:** printed documents are not touched. `audit:render-golden` passes without regeneration, and
   labels with no profile saved are byte-identical to before. Document-editor duplication stays at 133 windows,
   because the shared branch field moved into the core.
7. **Scope:** 1 or 2 establishments only. **3 or more branches is out of scope**, because pack keys, two-column
   reports and the transfer UI are built for two ids. Supporting more would need a dynamic-branch refactor and a
   data migration.

## Consequences
- Quality budget (deliberate): runtime JS files 48 → 49, root JS 49 → 50 (`erp-branches-core.js`), and runtime lines
  26,700 → 27,200 (measured 26,906: the core plus the screen applier and form).
- One test updated: `product-experience.test.cjs` kept-keys list (+ the setting key).
- Limits:
  - Labels in the SaaS add-on text and the CSV column aliases stay fixed.
  - Production-store rows are read through `ERPProductionCore.exportData()`, so they join the census only after that
    module loads (the screen re-checks at the end of boot).
  - In the settings form, the second-branch card follows the unsaved radio choice.
