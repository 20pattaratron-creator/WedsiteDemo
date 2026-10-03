# ADR-011 — Readable Layout for the Receivables Modules (runtime line budget)

## Status
Accepted for Local Demo. Supersedes the "Complexity budget change" layout note of ADR-010.

## Context
ADR-010 added `erp-receivables-core.js` and `erp-receivables.js`. To stay under the unchanged
`runtimeLinesMax` of 19,600, both modules were rewritten in a compressed one-function-per-line layout
(46 + 31 lines). That compressed layout existed **only** to fit the old limit. It works against the
user's explicit requirement: very detailed, readable code that can be reviewed line by line for bugs.
AR aging, credit-note allocation and satang rounding are exactly the logic reviewers need to read.

## Decision
- Replace the compressed layout with a normal readable one: one statement per line, descriptive names,
  short comments where the accounting logic is not obvious. **Layout only — no behaviour change**
  (same exports, same results; the full test suite is unchanged and passes).
  - `erp-receivables-core.js`: 46 → 505 lines.
  - `erp-receivables.js`: 31 → 299 lines.
- The `app.js` baseline/delta rule is unchanged and was not relaxed.

## Complexity budget change
`runtimeLinesMax` 19,600 → **20,500**. Runtime lines with the readable layout are 20,324
(19,597 compressed + 727 lines of layout), so the raise covers that plus 176 lines of headroom —
less than the ≈500-line margin ADR-007/ADR-008 left. `runtimeJsFilesMax` (39) and `rootJsFilesMax` (40)
stay as set in ADR-010.

## Consequences
- The receivables rules can be reviewed line by line; tests (`tests/receivables-reporting.test.cjs`) are unchanged.
- Future features still need their own ADR once the 176-line headroom is used.
