# ADR-029 — สมุดรายวันอัตโนมัติ งบทดลอง ชุดปิดเดือนส่งนักบัญชี ยอดยกมา และ QR พร้อมเพย์บนเอกสาร

## Status
Accepted for Local Demo (round 12, 24 ต.ค. 2569). New page `accounting` "สมุดบัญชีและปิดเดือน" in the "ข้อมูลและรายงาน" menu
group (next to รายงานภาษี), visible in simple mode; two new cards on ตั้งค่าบริษัท, visible in simple mode: "ผังบัญชีและการลง
บัญชีอัตโนมัติ" and "QR พร้อมเพย์บนเอกสาร". Thai default, English through the page's own key tables (`i18n/en-journal.js`,
ADR-026). Polish of round 11: the profit tables show "ยอดขายที่มีต้นทุน" next to sales.

## Context
Round 11 (ADR-028) computed cost but posted nothing; an accountant still had to re-key every document. The research report
(`/home/claude/reports/แผนสร้างระบบ ERP สู้คู่แข่ง.md`) sets the scope:
- **1.3 สมุดรายวันอัตโนมัติและไฟล์ส่งนักบัญชี** — every issued document makes append-only journal lines with Dr = Cr; each
  company maps the chart; exports: the general journal CSV/XLSX, the PEAK "บัญชีรายวัน" file, and a month-end pack (sales /
  purchase VAT, PND.3/53, AR/AP aging, stock valuation, WIP by job, trial balance). Sourced facts used here: PEAK imports
  journals only with its own "Excel Format PEAK" template, only on **Pro Plus and above**, and the column list is in the
  sample file **downloadable only inside PEAK** ([PEAK import](https://intercom.help/peak/en/articles/10077154), [PEAK journal
  import](https://intercom.help/peak/en/articles/5784566)); to avoid PEAK computing FIFO a second time, send items as
  **non-stock** (or PEAK set to periodic) and post the cost of sales as a **month-end journal**; competitors do not include
  migration, so an **opening-balance import** (stock, AR, AP) is needed ([QUASA](https://quasa.io/th/media/flowaccount-hruue-peak-raakhaathuukkwaaaacchaephemuuethiimaelastkerimot)).
  The research notes say the 1xxx–5xxx chart numbering is a **software-vendor convention**, not an official standard.
- **2.1 PromptPay QR** — tag 29 with an amount (dynamic) using the seller's 13-digit tax ID; tag 30 (Bill Payment, Ref1 = the
  document number) only for companies with a bank agreement. Facts ([thai-qr-payment spec](https://thai-qr-payment.js.org/reference/spec/)):
  tag 29 AID `A000000677010111`, sub-tag 02 = 13-digit ID; tag 30 AID `A000000677010112` + Biller ID, Ref1, Ref2; currency
  `764`; CRC-16/CCITT-FALSE. promptpay-qr is MIT but has no tag 30 ([GitHub](https://github.com/dtinth/promptpay-qr)). The spec
  summary was **not checked against the official BOT / Thai Bankers' Association document** → **the owner must scan-test
  every main bank app** (the research says so; the settings card keeps the checklist and warns until every app is ticked).

## Decisions
### 1. Journals are derived, never stored or hand-edited (`erp-journal-core.js`, pure)
- `buildJournal(input)` recomputes every entry from the documents on each read (≈10 ms for the sample), so the books always
  agree with the documents, the tax reports and the costing engine. Money in satang integers; each entry is checked by
  `finalize()`: zero lines dropped, each establishment balanced through **1190 บัญชีระหว่างสาขา** (a receipt at the branch for
  an HQ invoice), then Σ Dr = Σ Cr for the entry and for every establishment, else `JournalBalanceError` (the page then shows
  only the red banner).
- **Cancel = reversal, never an edit**: a cancelled invoice / CN / DN / receipt / payment keeps its original entry and gets
  `…|rev` on the **cancel date** (`voidedAt` as a Bangkok business date, ADR-013); unknown → the document date, flagged. A
  cross-month cancel therefore stays in the original month's output VAT and is reversed in the cancel month (the pack shows
  the difference to that month's ภ.พ.30 as "ต่าง (ตรวจ)" with the reason). Expenses have no cancel in the app (they are
  deleted to the trash, which the period lock already guards); a legacy `voided` expense is not posted (as the purchase report).
- **Postings** (account roles → default codes; the hand-worked example of each is a test, `tests/journal-core.test.cjs`):

| Document | Dr | Cr |
|---|---|---|
| Tax invoice (credit) | 1130 AR (open item per invoice) | 4110 goods / 4120 services (split by line value), 2154 output VAT |
| Abbreviated invoice (`effectiveTaxInvoiceForm` = abbreviated) = cash sale | 1111 cash *(default; flagged setting)* | sales, output VAT — its receipt is the slip, not new money |
| Receipt | 1112 bank *(default, flagged)* + 1151 WHT deducted by the customer | 1130 AR (the invoice's item; another branch → 1190) |
| Order-flow payment | by method: โอนเงิน 1112, เงินสด 1111, เช็ค 1113 (else the default, flagged) | AR per allocation |
| Credit note | 4130 returns + 2154 | AR per line (a cash-sale CN = refund from the default account, flagged) |
| Debit note | AR | 4140 + 2154 |
| Expense / purchase | expense by category (14 categories → 5210–5390, company-mappable; unknown → 5390, flagged) **including** non-claimable VAT; 1154 input VAT when claimable (`inputVatClaimable`, a purchase-report document type, VAT > 0); WHT borne by us → 5410 | 2131 / 2132 WHT payable by `whtForm` (unknown → 2190 suspense, flagged); 1112 bank *(default "จ่ายจาก", flagged; or 2111 AP)* |
| Input VAT claimed in a later month (ม.82/3) | 1155 not-yet-claimable, then on the 1st of the claim month 1154 | 1155 |
| Goods receipt / reversal | 1161 inventory | 2111 AP (open item per GR) |
| Sale / return (costing engine) | 5110 COGS = **the engine's value** | 1161 |
| Stock adjustment / transfer | 1161 / 5120 (transfer via 1190) | |
| Job: materials issued / returned | 1163 WIP (job key) | 1161 |
| Job: labour + overhead applied, other costs | 1163 WIP | 5141 labour applied, **5142 overhead applied**, 5143 other applied |
| Job completed to the customer / into stock | 5110 COGS (sheet total) / 1161 | 1163 |
| Overhead close (one click per month and branch) | 5142 applied, 5110 the difference (under-applied) | the actual expense accounts of the overhead categories |
| NRV write-down (optional, from the NRV report) | 5130 loss | 1162 allowance (the entry posts target − booked, so a fall reverses) |
| Opening AR / AP / stock | AR items / 1161 | 3900 opening clearing (the accountant moves it to equity) |

- **Undecided postings** use the company's default (ตั้งค่าบริษัท › ค่าเริ่มต้นเมื่อเอกสารไม่ระบุ: receipts → bank, cash sales →
  cash, expenses paid from → bank, refunds → cash) and **every such entry is flagged** (`flags`) and listed in the pack. No
  silent guess.
- **COGS follows the costing engine**: voided stock movements and cancelled invoices are not costed by the engine (ADR-028),
  so their stock entries simply disappear on recompute — the costing page's own period lock (`lockedCostChanges`) already
  refuses any recompute that changes a closed period.

### 2. Chart of accounts (`comform_journal_settings_v1`, a company setting)
- 41 roles with default codes 1111–5410 (Thai + English names). **The numbering is a vendor convention** (said on the card
  and on the pack's cover). Each company sets its own code / name per role, adds custom accounts (for manual entries), maps
  expense categories and posting defaults, the PEAK column mapping and the export option.
- Validation on save (and as a pack check): every used account has a code; one code = one account — the same code on two
  roles is allowed only when they have the same name and type (a company with one bank account), else `duplicate_code` /
  `type_conflict`. Codes and names are presentation only (they never change an entry); category / posting changes do, so
  they go through the period-lock guard below.

### 3. Manual entries, closes, write-downs, opening balances (`comform_journal_documents_v1`, business data)
- Own documents with numbers (`JV` + พ.ศ. yy mm + 4 digits, never reused), Dr = Cr checked by the plan and again by the strict
  store; **cancel-not-delete** (status `voided` + `voidDate` = today; the reversal is derived).
- **Period lock over every journal-producing change**: before anything is written the page builds the journal before and after
  the change and refuses (`lockedJournalChanges`) when any entry dated in a closed period (sales **or** purchase lock of its
  establishment) would change — the same Thai text as every lock. Applies to manual entries (and their cancel), the overhead
  close, NRV, the opening import (also refused when the balance date is closed), posting / category settings, and a backup
  restore that adds / changes a journal document in a closed period.
- **Opening import**: CSV template (Thai or English header; dates ISO or D/M/Y ค.ศ./พ.ศ.; RFC-4180 quotes); every line checked
  (type, branch code, product exists and is stock-tracked, qty to 3 decimals, money to 2, one cost per product, no duplicate,
  document date ≤ balance date); **preview first, nothing written** until "ยืนยันนำเข้า". Stock goes where the costing engine
  reads it (Product Master opening qty per branch + `openingCosts`), in one transaction with the batch and the opening date;
  AR / AP become open items against 3900.

### 4. Reports, checks, exports (`erp-journal.js`)
- Tabs: general journal (GJ numbers per month in order — the document number is the permanent reference), ledger per account
  (running balance), trial balance (opening / movement / closing by code), month-end pack, manual entries, opening balances.
- **Checks** (pack + cover sheet): entries balanced; TB balanced; TB = every ledger; inventory GL = stock valuation; WIP GL =
  open job sheets; inter-branch nets to zero; chart valid; per establishment: output VAT = ภ.พ.30 L5, input VAT = L7, sales =
  L1, WHT = ภ.ง.ด.3 / 53 totals; AR in the books today = the app's AR report. A failing balance / reconciliation shows the
  **red banner** (`role="alert"`); a tax difference is "ต่าง (ตรวจ)" with its reason; a damaged store says so, never zeros.
- **Exports** (offline: CSV via `taxCsvText`, Excel via the vendored SheetJS):
  - General journal, one row per line. Documented columns: `ลำดับ, เลขที่รายการ, วันที่ (ISO), สาขา (รหัส 5 หลัก), ประเภท
    รายการ, เลขที่เอกสาร, คำอธิบาย, รหัสบัญชี, ชื่อบัญชี, เดบิต, เครดิต, งาน, ข้อสังเกต`, last row = totals (Dr = Cr).
  - **PEAK journal import** through a **column mapping** (header text + field + order + date format, editable on the pack tab,
    stored in the settings). Default best guess: `วันที่เอกสาร (DD/MM/YYYY ค.ศ.), เลขที่เอกสาร (JV number), อ้างอิง (document no.),
    คำอธิบาย, รหัสบัญชี, ชื่อบัญชี, เดบิต, เครดิต, สาขา`. Labelled **"ต้องตรวจกับเทมเพลตจริงของ PEAK ก่อนใช้"** — we do **not**
    claim compatibility.
  - **One-click month-end pack**: one multi-sheet XLSX (cover with totals + every check; sales VAT, purchase VAT, non-claimable
    VAT, PND.3, PND.53 per establishment — the tax pages' own tables; AR aging, AP aging; stock valuation; WIP by job; TB; GJ).
  - Option **"ส่งเป็นรายการไม่นับสต็อก + ต้นทุนขายเป็นสมุดรายวันสิ้นเดือน"** (explained in plain Thai on the page): the exported
    files carry the month's COGS as one entry per establishment on the last day (same totals to the satang); the screen keeps
    one per invoice.

### 5. PromptPay QR (`erp-promptpay-core.js`, `erp-qr-core.js`, `erp-promptpay.js`)
- Pure EMVCo payload: 00 = 01; 01 = 11 static / 12 when an amount is set; 29 = AID + 01 mobile (`0066` + 9 digits, leading 0
  removed; +66 / 66 / 0066 accepted; must start 6/8/9) | 02 tax ID (13 digits, check digit verified) | 03 e-wallet (15); 53 =
  764; 54 = amount `1234.50` (refused ≤ 0, > 2 decimals, > 9,999,999,999.99); 58 = TH; 63 = CRC-16/CCITT-FALSE over the payload
  including "6304". Tags in ascending order (the published examples put 58 before 53; any order is valid EMVCo — test pp#2
  reproduces them byte for byte). Optional **tag 30 Bill Payment** (Biller ID 15 digits, Ref1 = the document number in
  capitals/digits, Ref2) — labelled "ต้องมีสัญญากับธนาคาร".
- **Own QR encoder** (no npm dependency): byte mode, versions 1–10, levels L/M/Q/H (the box uses M), Reed–Solomon over
  GF(256), the 8 masks with the ISO penalty rules; drawn as an inline SVG with a 4-module quiet zone. Verified by an
  independent reader in the tests (own ISO tables; every RS block's syndromes = 0) for every version / level / mask, and by
  OpenCV on screenshots.
- On the **customer's original** of the invoice / tax invoice (full and abbreviated) and the receipt, and on the billing note:
  a box "สแกนจ่ายด้วยพร้อมเพย์ / Scan to pay (PromptPay)" with the amount (invoice total; receipt = cash after the customer's
  WHT; billing = the amount still open) and the payee. Not on copies, cancelled documents or a zero amount.
- **Placement never moves the fixed A4 layout**: on the final page of the full-form invoice / receipt the box (QR 10em ≈
  26 mm on A4, scales with the page) is laid over the empty filler rows just above the absolutely placed bottom area; when
  fewer than 5 filler rows are left it gets a page of its own after that page (items untouched — japp#10). The abbreviated
  invoice (flowing layout) gets it before its signature row. The box carries `data-bilingual`; the English print layer
  (`erp-i18n-print.js`, one guard added) adds no second label inside a block that is already Thai + English.
- **Default OFF.** The hook is outside the render-golden functions: `decorate()` returns the **same string** when off (or the
  store is damaged), so Thai prints are byte-identical (test japp#10 compares with the module absent; render-golden PASS with
  no baseline change). The box is in its own inline styles, so the print window and PDF need no new CSS.
- **The owner must scan-test every main bank app** (KBank, SCB, BBL, KTB, Krungsri, ttb, GSB, BAAC) before real use; the card
  keeps the checklist (date per app) and warns until all are ticked. A tax ID / mobile number that is not linked to PromptPay
  yields a QR the bank rejects — only a real scan proves it.

### 6. Storage, backup, reset (ADR-003)
- `comform_journal_settings_v1`, `comform_journal_documents_v1`, `comform_promptpay_settings_v1` — strict readers
  (`journal_store` / PromptPay errors); JSON backup `masterData.accounting` + `masterData.promptpay`, validated before
  anything is written (`ERPBackup.validate`, fail-closed when the module is not loaded); merge keeps this device's documents
  and adds new ones; replace takes the file. Demo reset keeps both settings (company settings, like the company profile) and
  removes the journal documents.

### 7. Sample data
No new sample documents: the September story already ties — HQ output VAT **5,289.90** (= ภ.พ.30 L5), input VAT **2,395.05**
(L7), WHT payable **300.00** (ภ.ง.ด.3) + **175.00** (ภ.ง.ด.53), sales 79,070.00 (L1); branch 4,625.60 / 798.14; combined 9,915.50 /
3,193.19; one-branch mode ties to the single return. TB balanced (Dr = Cr 436,254.50 for the company); inventory 727,590.00 =
stock valuation; WIP 0. The September TB is identical on every load date tested (jcore#10, both branch modes).

### 8. Round-11 polish
Profit tables: column "ยอดขายที่มีต้นทุน" next to "ยอดขาย"; the total row's gross profit = costed sales − cost (visible).

## Not modelled (said on the page or here)
Year-end closing of revenue / expense to retained earnings; bank reconciliation; fixed assets / depreciation (use a manual JV);
VAT settlement entry (output − input → VAT payable) — the accountant posts it; AP for expenses recorded "paid" (the default
is "paid from bank"; set "จ่ายจาก: เจ้าหนี้" to keep AP); a purchase recorded both as an expense in category
"ค่าซื้อสินค้า/วัสดุ" **and** as a goods receipt would count twice — the accountant should map that category or record stock
purchases only as goods receipts.

## Budget (QUALITY_BUDGET.json)
+6 runtime files (`erp-journal-core.js`, `erp-journal.js`, `erp-promptpay-core.js`, `erp-promptpay.js`, `erp-qr-core.js` at the
root; `i18n/en-journal.js`), +3,992 lines (44,535 → 48,527), +2 window assignments (`window.ERPJournal`, `window.ERPPromptPay`). app.js is
line-neutral (two existing lines extended for the backup). Limits: runtime files 76 → 82, root JS 66 → 71, window
assignments 81 → 83 (exactly these amounts), runtime lines 44,700 → 48,700 (+173 margin, as in round 11);
the module split keeps each pure core testable without the DOM.

## Tests
`tests/journal-core.test.cjs` (16: every posting type hand-worked, 400-document fuzz Dr = Cr per entry and establishment, TB =
Σ ledgers, cancel reversal on the Bangkok cancel date, period lock, COGS = engine, WIP → COGS, story ties HQ / branch / combined
/ one-branch, 11 load dates × 2 modes, manual / close / NRV / opening / stores / exports), `tests/promptpay-core.test.cjs` (8: CRC
known answers, published examples, the Python reference below, amounts, invalid IDs, settings, every QR reads back, SVG),
`tests/qr-reader-helper.cjs` (the independent reader), `tests/journal-app.test.cjs` (11, booted app), i18n-dict#9, the EN
coverage audit visits every tab / branch / period / ledger and both cards. All fail on round11-cost
(`/tmp/claude-0/r12-newtests-on-base.log`).

## What the owner / accountant must confirm
1. **The PEAK template**: subscribe to PEAK Pro Plus, download "Excel Format PEAK" (บัญชีรายวัน), set the mapping (headers,
   order, date format) to match and test an import. Until then the file is a best guess.
2. **The chart of accounts**: every default code and the posting of each document type (especially: undue input VAT 1155, WHT
   borne 5410, the overhead close, opening clearing 3900, cash sales to cash).
3. **Bank scan tests**: every main bank app, with the company's real PromptPay ID (tax ID linked to PromptPay), static and with
   an amount; Bill Payment only with a bank agreement and its Biller ID.
4. **Double COGS**: in PEAK / FlowAccount set products as non-stock (or periodic) when using the month-end COGS option.

## Appendix A — independent Python reference (written apart from the JS; outputs used in pp#3)
```python
def crc(data: bytes) -> str:
    c = 0xFFFF
    for b in data:
        c ^= b << 8
        for _ in range(8):
            c = ((c << 1) ^ 0x1021) if c & 0x8000 else (c << 1)
            c &= 0xFFFF
    return '%04X' % c
def f(i, v): return '%s%02d%s' % (i, len(v), v)
def payload(fields):
    body = ''.join(f(i, v) for i, v in fields) + '6304'
    return body + crc(body.encode('ascii'))
AID = 'A000000677010111'
print(crc(b'123456789'))  # 29B1
print(payload([('00','01'),('01','12'),('29',f('00',AID)+f('01','0066812345678')),('53','764'),('54','50.00'),('58','TH')]))
# 00020101021229370016A000000677010111011300668123456785303764540550.005802TH63045197
print(payload([('00','01'),('01','11'),('29',f('00',AID)+f('01','0066899999999')),('53','764'),('58','TH')]))
# 00020101021129370016A0000006770101110113006689999999953037645802TH63042195
print(payload([('00','01'),('01','12'),('29',f('00',AID)+f('02','0105561007075')),('53','764'),('54','1234.50'),('58','TH')]))
# 00020101021229370016A00000067701011102130105561007075530376454071234.505802TH63040D49
print(payload([('00','01'),('01','12'),('29',f('00',AID)+f('03','123456789012345')),('53','764'),('54','0.01'),('58','TH')]))
# 00020101021229390016A0000006770101110315123456789012345530376454040.015802TH63045B91
print(payload([('00','01'),('01','12'),('30',f('00','A000000677010112')+f('01','010556100707501')+f('02','INV690901')),('53','764'),('54','51284.97'),('58','TH')]))
# 00020101021230520016A00000067701011201150105561007075010209INV6909015303764540851284.975802TH630408F3
```
Published examples reproduced (pp#2): php-promptpay-qr README `…5802TH53037646304FE29` (0899999999, no amount) and
`…5406420.006304CF9E` (420.00); the Thai QR Payment guide's cross-border tag-30 example `…63049D1C`.
