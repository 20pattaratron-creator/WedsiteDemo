# ADR-025 — Round 8 review fixes (tax math, fail-closed data controls, UI/demo)

## Status
Accepted for Local Demo (round 8 review fixes, 12 ต.ค. 2569). Three independent reviews of round8-stageD found 24
confirmed issues (A1–A5 tax math, B1–B10 data integrity/controls, C1–C9 UI/demo). Each has a regression test named
`r8fix#<id>` in `tests/r8fix-core.test.cjs` (pure) or `tests/r8fix-app.test.cjs` (jsdom boot). Every one fails on
round8-stageD and passes now (`/tmp/claude-0/r8fix-newtests-on-base.log`). Layout items (C5, C6, C8) are also proved
in Chromium: screenshots `/tmp/claude-0/r8fix-*.png`.

## Decisions
### Tax math
1. **Payer WHT base is the pre-VAT amount (A1).** If the expense has a VAT split, the base is the split's subtotal.
   If it has none, the WHT section asks "ราคานี้รวม VAT หรือไม่" (`whtVatBasis`):
   - `included` (default): base = gross ÷ (1 + rate), rounded half-up, from the shared VAT rate. The computed base and
     a warning are shown.
   - `none`: base = gross.
   The 1,000-baht threshold is applied to the base. Gross is never used silently.
2. **Condition 3 (ออกให้ครั้งเดียว) (A2).** amountPaid = base + round(base × r); tax = round(amountPaid × r). Worked
   example: 10,000 @ 3% → 10,300 / 309. This follows a secondary source (PEAK), so spec §5c.5 asks for an
   accountant's confirmation. Condition 2 (gross-up) is unchanged and still exact.
   *Round 13 (ADR-030 HIGH-1)*: same 10,300 / 309 on the 50 ทวิ, but the payer bears only 300 and 9 is withheld from
   the payee (pays 10,691 with VAT 700) — same PEAK page; the caveat stays.
3. **Credit notes see debit notes (A3).** The original value is invoice + live DNs − earlier live CNs, read strictly
   from all branches. It is used for validation, the preview, the printed "มูลค่าตามใบกำกับภาษีเดิม" (which shows the
   DN) and the refund warning. A DN cannot be cancelled while a live CN depends on the value it raised. The check runs
   before the reason prompt and again in the write path.
4. **ภ.พ.30 paper due date is weekend-rolled like ภ.ง.ด. (A4)** (`paperRolled`). `bahtText` reads เอ็ด after ล้าน
   (1,000,001 → หนึ่งล้านเอ็ดบาทถ้วน) (A5).

### Data integrity and controls (fail-closed, refused before any question)
5. **Edits of issued invoices/receipts (B1, B7).** Both the original and the new date and branch go through the period
   lock. A filed ภ.พ.30 month or a passed tax month asks the same confirmation as cancelling
   (`ERPGovernance.issuedEditGate`).
6. **JSON import (B2, B3, B4).** `planBackupPackImport` plans every pack before any write. It refuses changes or
   removals of documents in locked periods, with a Thai list of them. Issued live invoices and receipts follow
   `mergeCreditNoteCopies`: a different copy is kept, never overwritten. Replace asks before removing issued documents.
   Filing history (ภ.พ.30, ภ.ง.ด.) is append-only even under replace. A file that claims an older schema but carries
   schema-4 content without a checksum is refused as downgraded. Legacy files without a checksum need an explicit
   confirmation.
7. **Period locks are in the backup (B8).** They merge append-only: a restore can add locks, never remove them.
   Validation is fail-closed.
8. **Recycle-bin restore (B5)** runs the same lock, filed-month and duplicate-number checks as create.
9. **Corrupted company profile (B6).** A banner appears and backup export refuses. Issuing any tax document is blocked
   (`ERPCompanyProfile.issueRefusal`) until the user restores or chooses "รีเซ็ตเป็นค่าตัวอย่าง".
10. **Unreadable month pack (B9).** `ERPIntegrity` raises `pack_unreadable` with a Thai message naming the months.
    Every panel renders through `safeRender` and shows "อ่านข้อมูลเดือน … ไม่ได้", never zeros or READY, with no
    uncaught errors.
11. **B10.**
    - Stock postings (GR post/reverse, adjustment, transfer) check the stock/purchase period lock.
    - `delDoc` refuses the issued collections.
    - The branch-2 census counts vatReturns, whtFilings and branch-2 locks.

### UI and demo
12. **Seeded 50 ทวิ use the live company profile as payer (C2).** Applies to `demoSeed === true` only. Real
    certificates keep their payer snapshot, because it is the legal record.
13. **Viewer dialogs (50 ทวิ / CN / DN) (C3)** use the `erp-cancel-dialog` pattern through `ERPUiMenu.trapDialog`:
    focus in, trap, Esc, focus returned, `aria-modal`, `aria-pressed` copy tabs. The mode toggle is also in the Demo
    menu, so it can be reached on phones (C4).
14. **Printing (C6).** A4 pages hold 16 line units: a row is units × 1.8em, and a long name takes more units and wraps
    in its cell. A 35-line invoice prints on 3 pages (was 5), or 4 with long names (was 9–11), with no overflow in
    print or PDF. The logo data URL is written once.
    - Inside the app, document tables use the page font, not style.css `table{13px}`, which had made PDF rows taller
      than on paper.
    - The on-screen preview is an exact miniature of the PDF page: font = preview width × 10.9/794. Its text is
      smaller than before, but it never shows rows over the totals box.
15. **C8 scope:** the controls the review measured were raised to the ADR-019 tokens (≥ 42 px):
    - DN/CN lists
    - 50 ทวิ tabs and dialog buttons
    - the WHT register
    Other 36 px `--erp-control-height-sm` uses are unchanged by design (ADR-019).
16. **The demo script cannot go stale silently (C1).** `r8fix#C1` re-runs the script's live steps and asserts that
    every key figure is in `docs/DEMO_SCRIPT_TH.md`. The receipt invoice dropdown shows the bill amount (and the
    balance when partly paid).

## Consequences
- `app.js` stays at 8,267 lines (line-neutral). The logic is in modules.
- `QUALITY_BUDGET.json` `runtimeLinesMax` 32,400 → **33,000**: runtime lines 31,968 → 32,533 (+565 lines of fail-closed
  checks and import planning, kept out of `app.js`), leaving 467 lines of headroom like ADR-007/008/012.
- The pre-existing `appJsLinesDelta` (+7 vs the frozen 4.2.0 baseline) is unchanged.
- Render-golden baseline regenerated: only the C6 entries for the delivery/receipt CSS and pagination functions and
  the C9 contact line changed. Each was reviewed in Chromium print/PDF renders.
