# ADR-021 — Pre-sales compliance fixes: buyer branch, cancel-not-delete, sample targets, offline Excel

## Status
Accepted for Local Demo (round 8, stage 1). Tests: `tests/presales-compliance-core.test.cjs` (7, fast),
`tests/presales-compliance.test.cjs` (6, app boot) — all 13 fail on round8-base and pass now.

## Sources
- ประกาศอธิบดีกรมสรรพากรเกี่ยวกับภาษีมูลค่าเพิ่ม **ฉบับที่ 199** (26 ธ.ค. 2556, ใช้กับใบกำกับภาษีที่ออกตั้งแต่ 1 ม.ค. 2558),
  rd.go.th/27982.html: ตามมาตรา 86/4(8) เมื่อผู้ซื้อเป็นผู้ประกอบการจดทะเบียน VAT ต้องระบุ "สำนักงานใหญ่" หรือ
  "สาขาที่ …" ของผู้ซื้อตามที่ปรากฏใน ภ.พ.20.
- คำสั่งกรมสรรพากรที่ **ป.86/2542** (rd.go.th/3568.html): ใบกำกับภาษีที่ผิดให้ "ยกเลิกใบกำกับภาษีฉบับเดิมและจัดทำใบกำกับภาษี
  ฉบับใหม่"; หนังสือตอบข้อหารือ 0702(กม.05)/1041 (rd.go.th/41087.html): เก็บฉบับที่ยกเลิก (ต้นฉบับ + สำเนา) ไว้;
  มาตรา 87/3 เก็บเอกสารไม่น้อยกว่า 5 ปี; docs/TAX_FEATURES_SPEC.md §1 ข้อ 5 / gap G1, G3 (รายงานภาษีขายแสดงฉบับที่
  ยกเลิกเป็น "ยกเลิก" เพื่อไม่ให้เลขที่ขาดช่วง). *Practice, not a quoted rule:* the replacement uses a new running
  number (RD rulings also allow re-issuing under the old number/date; a new number keeps one record per number).
- SheetJS `xlsx@0.18.5` (Apache-2.0) from the npm registry (`npm pack`, integrity in `vendor/vendor-manifest.json`).

## Decisions
1. **Buyer establishment.** Invoices and receipts store `customerBranchCode` (`'00000'` = สำนักงานใหญ่, 5 digits =
   สาขาที่, `''` = not stated) + `customerBranchName`. Form control "สำนักงานใหญ่ / สาขาที่ [5 หลัก]" next to the buyer
   tax ID on the invoice and receipt forms (`erp-sales-form-assist.js`); picking a Customer Master row fills it;
   an untouched empty control is copied from Customer Master at save; a branch number must be 5 digits; optional
   (no tax ID / walk-in / abbreviated → `''`). Printed after the buyer tax ID on all copies of the full tax invoice
   (print, preview, PDF share `documentPageHtml`) and on the receipt (it shows the buyer tax ID too); payment
   receipts copy it from the invoice; the credit note already read it (`creditNoteBuyerBranchLabel`). The
   abbreviated layout is unchanged. Sample invoices get it from the sample Customer Master (C8 → สาขาที่ 00003).
   Also fixed: `loadFromInvoice()` (invoice list › เอกสาร/PDF) did not take the buyer address / tax ID / contact from
   the invoice (printed blank or the previous draft's buyer) — the same bug ADR-013 fixed for receipts.
2. **Cancel, never delete** (`erp-document-cancel-core.js` pure, `erp-document-cancel.js` UI). Row "⋯" of an
   invoice: "ลบ" → "ยกเลิกใบกำกับภาษี" ("ยกเลิกใบแจ้งหนี้" for a no-VAT invoice); receipts: "ลบ" → "ยกเลิกใบเสร็จ"
   (same rule: issued, numbered evidence; payment receipts are still voided with their payment). There are no draft
   invoices (a record exists only once issued), so nothing invoice/receipt is deletable any more; `delDoc` refuses
   them. Quotations / expenses / production orders keep their delete. Refused before any question when the period
   is closed (same `periodLockRefusal` text) or when live receipts / payments / credit notes / an open billing note
   reference the invoice (named; the demo has no "cancel billing note", so a full credit note is suggested). Dialog:
   reason from a list + free text (required for "อื่น ๆ"); a past VAT month asks for confirmation (ภ.พ.30 เพิ่มเติม).
   The record is kept with `status:'cancelled'`, `voided:true`, `voidedAt/By`, `voidReason`, `voidReasonCode` (its
   printed copy too) in one write session; an Audit Log row "void" carries cancelledAt/by/reason; the source
   quotation / production order is released (`cancelledInvoiceNos`) for the replacement. Everything that counts
   uses `ERPIntegrity.live()`; `paymentSummary()` of a cancelled invoice returns `status:'cancelled'`, outstanding 0,
   so AR, aging, billing, dashboard, council, analytics, Excel status, targets, delivery comparison and stock (sales
   are derived from live invoices) exclude it; the number stays used. Lists keep it with a "ยกเลิก" badge and a
   filter ("ใช้งาน" / "ยกเลิกแล้ว"); print/preview/PDF carry a "ยกเลิก / CANCELLED" stamp with the reason (inline
   styles); edit, receipt, credit note and re-print-save are refused. Old Recycle Bin entries are left as they are.
3. **Targets.** No built-in target any more (was 2,000,000 sales / 1,600,000 delivery per month): an empty store
   shows "ยังไม่ได้ตั้งเป้า". Loading sample data writes per-month sales/delivery targets (scopes all / ubon /
   khonkaen) into the period-target maps the UI uses — near each seeded month's actual, alternating beat / miss,
   the current and later months at the recent average — only into months without a target, and records them in
   `comform_demo_seed_targets_v1`. Reset removes only seeded entries that still hold the seeded value (target keys
   are kept keys now). The period-target key names moved to `erp-storage-contracts.js` (1.6.0, same strings). The
   target summary counts closed months only ("เดือนที่ปิดแล้ว ทำได้ถึง/เกินเป้า 2/4 เดือน" today).
4. **Excel offline.** `vendor/xlsx-0.18.5.full.min.js` + Apache-2.0 LICENSE, manifest `loading:'lazy'`; its URL is in
   `<meta name="erp-vendor-xlsx">`, rewritten by the vite plugin for dist / dist-flat, listed by the deployment
   check, probed by the Demo health dialog ("Excel (ไฟล์ในเครื่อง)"). No runtime `https://` reference remains. Found on
   the way: the invoice export always failed ("Sheet name cannot contain /") — sheet renamed "ใบส่งสินค้า - ใบกำกับภาษี".
   The security preflight skips only its heuristic "generic secret" check for vendor files whose sha256 equals the
   manifest (minified SheetJS error strings matched it).

## Render golden
`deliveryTax:documentPageHtml` and `receipt:documentPageHtml` changed (buyer establishment + cancel stamp); CSS and
all other entries identical. The preview HTML of all 62 seeded invoice/receipt pages without the new fields is
byte-identical to round8-base (empty interpolations add no bytes); reviewed as Chromium print PDFs.

## Consequences
- Quality budget (deliberate): runtime JS files 46 → 48, root JS 47 → 49 (the two cancel modules), runtime lines
  25,700 → 26,700 (measured 26,329). `app.js` stays 8,268 lines (all wiring on existing lines).
- Existing tests that encoded "ลบ" on invoices/receipts or the old reset key list were updated; Recycle-Bin restore
  tests now create legacy trash entries directly. Duplication groups 131 → 133 (two state fields in both documents).
- Not done: buyer-establishment input in the document editor page (it carries the invoice's value); cancel billing
  note; supplier branch (G5); the receipt print's oversized contact line (pre-existing, golden CSS).
