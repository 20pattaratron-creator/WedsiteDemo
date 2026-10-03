# ADR-012 — Line Budget for the Independent-Review Bug-Fix Rounds

## Status
Accepted for Local Demo.

## Context
After ADR-011 (runtime lines 20,324, limit 20,500) the five new features (credit note, abbreviated tax
invoice, default selling price, receivables/aging reports, overdue alerts) were reviewed line by line by
independent reviewers who had not written the code. Their confirmed findings were fixed in several rounds,
each with a regression test that fails on the pre-fix snapshot and passes afterwards. The fixes include:

- import/restore safety for credit notes (a backup without credit notes must not delete issued ones; an
  imported copy must not revive a voided note — `mergeCreditNoteCopies`, ledger check after import);
- a returned-goods credit note whose product text has extra spaces could no longer be edited;
- the Decision Council, Customer 360 and governance aging now use the same due-date, balance and bucket
  rules as the AR report, so every screen shows the same overdue numbers;
- printed credit notes paginate returned goods instead of clipping totals and signatures;
- a warning before voiding a credit note whose VAT month (ภ.พ.30) may already have been filed;
- a no-VAT invoice is no longer titled or totalled as a tax invoice;
- the credit-note print window no longer adds a blank extra sheet.

Measured runtime lines per snapshot: 20,324 (ADR-011) → 20,499 → 20,740 → 20,996 → 21,124 → 21,200 →
**21,330**. All +1,006 lines are bug fixes and their comments; no new feature was added.

## Decision
- `runtimeLinesMax` 20,500 → **21,800** (21,330 + 470 lines of headroom, the same margin ADR-007/ADR-008 left).
- `runtimeJsFilesMax` (39) and `rootJsFilesMax` (40) are unchanged — no file was added.
- The `app.js` baseline/delta rule is **not relaxed**. `app.js` is 8,280 lines, 19 over the frozen
  baseline (8,261). Before the fix rounds it was 8,258 (passing). The growth is the credit-note
  import/restore safety code, which depends on `app.js` internals (`loadFor`, `normalizeDataPack`,
  `saveFor`). Moving freshly fixed financial code only to satisfy the counter was judged riskier than
  leaving the rule visibly failing; `npm run audit:complexity` therefore still reports
  `appJsLinesDelta=19 exceeds 0` until that code is extracted in a dedicated refactor.

## Consequences
- `npm run audit:complexity` reports one HIGH item (the `app.js` delta) instead of two.
- The next feature needs its own ADR once the 470-line headroom is used.
