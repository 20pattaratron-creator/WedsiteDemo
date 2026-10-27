# ADR-026 — English UI (TH | EN switch), Thai tax help, bilingual commercial prints

## Status
Accepted for Local Demo (round 9, 13 ต.ค. 2569). Thai stays the default and the source language of every screen.
English is a layer on top, for foreign owners and managers of Thai SMEs. Thai mode is unchanged: every existing test
and the render-golden audit pass without regeneration.

## Context
Prospects include foreign owners who run a Thai company with a Thai accountant. They need to read the screens, the
tax reports and the documents, and to understand Thai tax terms (PP.30, 50 Tawi, PND.3/53, head office / branch codes).
The app has about 4,500 Thai UI strings spread over `app.js` (8,267 lines, frozen) and 50+ modules. Rewriting every
render to go through `t(key)` would touch thousands of lines, break the golden documents and the line budget of
`app.js`.

## Decisions
### 1. Design: translate what is drawn, not how it is drawn
- `erp-i18n-core.js` (pure, no DOM, no state): the setting (`comform_ui_language_v1`, ADR-003 key in
  `erp-storage-contracts.js`, record `{schemaVersion:1, language:'th'|'en', updatedAt}`; anything missing or damaged
  reads as Thai), `t(key, params)` for new code, Gregorian dates (`12/10/2569` → `12/10/2026`, `ต.ค. 2569` →
  `Oct 2026`), `฿1,234.50` → `THB 1,234.50`, `taxMonthLabelEn()` ("September 2026 (tax month)"), the phrase
  translator and `englishBahtText()`.
- The phrase translator: an exact dictionary (whitespace-normalised Thai → English), then ordered pattern rules whose
  placeholders keep the dynamic parts (`{n:num}`, `{name}` kept as is, `{x:t}` translated again, `{y:be}` B.E. → A.D.),
  then decorations (bullets, trailing colon, a trailing count), then splits on ` · `, ` — `, ` | ` … where every part
  must translate. A last-resort run fallback is **all or nothing**: if any Thai run is unknown the text stays exactly as
  it was, so a product called "เครื่องพิมพ์ (พิมพ์/สแกน)" is never half translated.
- Dictionaries are plain data in `i18n/`: `en-shell.js`, `en-sales.js`, `en-purchase-stock.js`, `en-tax.js`,
  `en-settings-backup.js`, `en-messages.js` (4,363 entries, 79 patterns), `en-keys.js` (t() keys), `en-tax-help.js`
  (tax explanations and the tax calendar), `en-print.js` (print labels).
- `erp-i18n.js` (DOM layer, `window.ERPI18n`): in English it translates text nodes and the attributes `placeholder`,
  `title`, `aria-label`, `alt` (and `value` of input buttons) of the whole document, `<title>` and `<html lang>`.
  New content arrives through one `MutationObserver`, batched per animation frame (before paint, so Thai never
  flashes). Re-entrancy: own writes are remembered per node (WeakMap) and their records dropped (`takeRecords`); a
  node — or an element whose text keeps being replaced — rewritten in more than 30 batches within 2 s is left alone
  (`stats().loopsStopped`). In Thai the observer does not run at all.
- `confirm` / `alert` / `prompt` are wrapped: Thai passes the call through untouched; English translates only the
  message. Toasts are DOM nodes and go through the observer.
- Switching keeps the page and every typed value: forms are translated in place; list / dashboard panels are re-drawn
  with `go()` and the scroll position restored. Switching back to Thai puts every original text and attribute back —
  the Thai markup is exactly what it was (test `i18n#2`).
- The switch: "TH | EN" in the header before the Demo button (two `<button>`s with `aria-pressed`, 42 px, 44 px at
  ≤ 900 px, reachable at 390 px) and the Demo menu item "English (เปลี่ยนเป็นภาษาอังกฤษ)" / "ภาษาไทย (Switch to Thai)".
- The setting is a per-tenant view preference: it is in JSON backups (`masterData.settings`) and auto-snapshots and the
  demo reset keeps it (`DEMO_RESET_KEPT_BASE_KEYS`), like the simple/advanced mode.

### 2. User-data rule
Never translated: `input` / `textarea` values, `contenteditable`, and anything inside `[data-no-i18n]`. Renders of
user data carry `data-no-i18n` (customer / supplier / product cells of the master tables and lists, chart labels,
datalist / select options of customers, products and suppliers, company names). A document preview is
`data-no-i18n="doc"` (Thai document with English labels, below); a government form viewer is `data-no-i18n="form"`
(Thai only). The only Thai-mode markup change of ADR-026 is these invisible attributes; nothing visible changes.
A user value that equals a dictionary phrase exactly and is shown outside such a cell could be translated; the
coverage report lists every user value shown outside `data-no-i18n` (`userDataOutsideNoI18nCount`).

### 3. Thai tax terms and help (English only)
Tax terms are written in Latin with a short explanation on first use: tabs "PP.30 (monthly VAT return)",
"PND.3 (WHT return, individuals)", "PND.53 (WHT return, companies)", "50 Tawi (withholding-tax certificates)",
"Head office (00000)", "Branch no. 00003". "?" buttons next to Thai tax concepts (VAT 7% / output / input, full vs
abbreviated tax invoice, head office / branch codes, credit note s.86/10, debit note s.86/9, PP.30 lines and due dates,
non-claimable input VAT s.82/5, the 6-month claim window s.82/3, withholding tax / 50 Tawi / PND.3 vs PND.53 /
conditions 1–3, period locks) open an English popover (dialog, Esc, focus return) that ends with a line recommending
a Thai accountant. The tax reports page shows a "Thai tax calendar" panel (PND paper 7th / online 15th, PP.30 paper
15th / online 23rd, weekend roll, extension until 31 Jan 2027) with the B.E. year as a hint.

### 4. Legal-language rule for prints
A printed document stays a Thai document. In English mode the **commercial documents** — quotation, delivery order /
tax invoice (full and abbreviated), receipt, credit note, debit note — keep every Thai text byte for byte and get small
English labels next to the Thai labels that have none yet (`erp-i18n-print.js`, `i18n/en-print.js`, inline styles so
the preview, the PDF stage and the print window look the same), plus the amount in English words under the Thai
`bahtText()`; the English words are computed from the amount read back from the Thai words and printed only when
`bahtText(amount)` gives the same Thai text. **Government forms** — 50 Tawi, PP.30 worksheet, PND.3 / PND.53
attachments, and the VAT reports in the Revenue Department format (print and Excel) — are never annotated and print
in Thai only; English is only on screen (test `i18n#7`: the 50 Tawi print is identical in both languages). Thai mode
never calls the print layer; the golden functions (`documentPagesHtml`, `documentPageHtml`, `pageHtml`) are not
changed — the hooks are in the print / PDF-stage functions around them.
Checked in Chromium at A4: same page count in Thai and English, no page overflow, no English label outside its box.

### 5. Exports
In English the Excel / CSV exports of the document lists, debit notes and the AR aging CSV get English column headers
and sheet names (`ERPI18n.exportRows`, `exportSheetName`); the data rows are the stored records, identical in both
languages. Not changed: the tax-report exports (statutory format, see 4) and the CSV import templates (their headers
are the importer's column names).

## What is not translated, and why
- User data (names, addresses, notes, product names, document numbers, payment-term values typed by the user).
- Printed Thai text of every document; government forms and the VAT-report exports (legal language).
- Data values inside exports (B.E. dates, Thai month names, status words) — exports are records, not UI.
- The language switch names itself "ภาษา / Language" and "ภาษาไทย" in Thai script (allowlist of the audit).
- The bundled billing-note popup (`erp-order-flow.js`) prints in Thai (not in the scope of the commercial set above).

## Quality gates
- `tests/i18n-coverage.test.cjs` (full suite): English boot, sample data, every panel, every tax tab and branch, row
  menus, detail / cancel dialogs, CN / DN / 50 Tawi viewers, Customer 360, search, order-flow tabs, Demo menu,
  validation messages, simple mode → `I18N_COVERAGE_RESULTS.json`; fails on any untranslated Thai UI text. Allowlist:
  `ภาษา / Language`, `ภาษาไทย`. A leftover Thai fragment is excused as user data only if it is a stored value and not
  written in the app's own source.
- `tests/i18n-dictionary.test.cjs`: plain data, no conflicting duplicate keys, no empty English, every pattern
  placeholder in the English text, no Thai in English except a term in parentheses, no `฿`.
- `tests/i18n-core.test.cjs`: setting, t(), dates, translator, `englishBahtText` (0, 1, 11, 21, 100, 1,000,001, 0.50,
  1,234.56, 99,999,999.99, negatives / non-finite refused, agreement with `bahtText` on 400+ amounts).
- `tests/i18n-behaviour.test.cjs`: Thai default unchanged, switch keeps page and form, exact Thai markup back, user
  data untouched, persistence + backup + reset, observer loop bound, tax help / calendar, prints, exports.

## Consequences
- `app.js` stays at 8,267 lines (edits are line-neutral: `data-no-i18n` on user-data renders, export headers, backup
  settings list).
- `QUALITY_BUDGET.json`: `runtimeJsFilesMax` 56 → **68** (+3 modules `erp-i18n-core.js`, `erp-i18n.js`,
  `erp-i18n-print.js`, +9 data files in `i18n/`), `runtimeLinesMax` 33,000 → **39,400** (38,854 measured: ~5,000 lines
  are dictionary data, ~1,300 code; ~550 lines headroom as before), `rootJsFilesMax` 57 → **60**,
  `windowAssignmentsMax` 75 → **79** (`window.ERPI18n` and the three dialog wrappers `window.confirm/alert/prompt`,
  which must replace the globals for the app's existing calls). The pre-existing `appJsLinesDelta` (+7 vs 4.2.0) is
  unchanged.
- The dictionaries must grow with new Thai UI text; the coverage test fails until they do.
