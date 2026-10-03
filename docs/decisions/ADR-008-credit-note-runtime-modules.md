# ADR-008 — Credit Note (ใบลดหนี้) Runtime Modules

## Status
Accepted for Local Demo.

## Context
Credit notes (Revenue Code §86/10) add VAT-sensitive calculation, validation, a form/list controller and a printable A4 document. Putting this into `app.js` would grow the mega-controller that the budget explicitly guards.

## Decision
Add three runtime modules and keep `app.js` changes to thin wiring (net −5 lines versus the pre-change file):

- `erp-credit-note-core.js` — pure, DOM/storage-free rules (VAT on the difference, validation, cumulative limit, totals, export rows).
- `erp-credit-note.js` — Local Demo form/list controller; persists through the existing strict `ComformDocumentWriteStore` session.
- `credit-note-document.js` (+ `credit-note-document.css`) — printable document, preview, print and PDF.

## Complexity budget change
`runtimeJsFilesMax` 33 → 36, `rootJsFilesMax` 34 → 37, `runtimeLinesMax` 17,900 → 19,600 (≈ +1,650 lines of new modules plus ~500 lines headroom, the same margin ADR-007 left). The `app.js` baseline/delta rule is unchanged and was not relaxed; the pre-existing `appJsLinesDelta` failure (31 before this change) is reduced to 26, not resolved.

## Consequences
- Credit-note rules are unit tested in isolation (`tests/credit-note.test.cjs`).
- Credit notes remain local-only (no Firebase sync channel) like the rest of the Local Demo write path.
