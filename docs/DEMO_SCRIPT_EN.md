# 10-minute demo script (English UI) — ERP Local Demo 4.3.1 with sample data

> Flow: **Quotation → Tax invoice → Receipt with withholding tax → Credit note (returned goods) → Receivables aging /
> overdue alerts → Executive dashboard** — the same flow and the same figures as `docs/DEMO_SCRIPT_TH.md`.
>
> Switch the screen to English with **TH | EN** in the header (or **Demo → English (เปลี่ยนเป็นภาษาอังกฤษ)**). The choice
> is remembered in this browser, kept by the demo reset and saved in backups. Everything typed — customer names,
> addresses, notes — stays exactly as typed; printed documents stay Thai documents with small English labels.
>
> Load the sample data with **Demo → Load sample data for the demo**. The dates follow the load date in two ways (R9.1,
> ADR-013):
> - **The tax story of the latest closed tax month (last month) and the month before it is dated on that month's
>   calendar** — PP.30, PND.3, PND.53, the debit note and the 50 Tawi certificates show **the same figures on every load
>   date** (a load in October tells September's story; a load in January tells December's story of the year before).
> - **Four old unpaid bills are dated back from today** — always **100 / 62 / 45 / 10 days** overdue (every aging bucket
>   is filled on every load date).
>
> **Amounts, customer names, the receivables total and the sales / cost / profit of the whole history are always the
> same**, but **document numbers follow the month** (this script was loaded on 05/10/2026, B.E. 2569 — e.g.
> INV690905). Find documents by **customer name + amount**. Figures marked **⏱ depend on the load date**: the value
> written is the one of a load on **days 1–9 of a month** (e.g. 05/10/2026), with how to read it on other days.
> Money is shown as `THB 16,585.00`, dates as `DD/MM/YYYY` (Gregorian). The figures are the ones of the Thai script,
> checked against the store by test `r8fix#C1` (six load dates) and `r91#…` (every day from 01/10/2026 to 31/01/2027,
> month ends and leap days); `i18n-demo-script` checks that this script carries the same figures.

---

## Before you start (~5 minutes before the customer arrives)

- [ ] **Choose the number of establishments before loading the sample data** — Company settings › "Number of
      establishments": a single-site customer → **Head office only** (all sample data goes to the head office). If two
      branches were loaded, reset first.
- [ ] **Load the data on the day of the demo** — **Load sample data for the demo**; if an older set exists answer
      "load again" (an old set has shifted overdue days, and after a month change its tax story is in the wrong month —
      the figures below would not match).
      - On a machine with **real user data** the app never mixes or overwrites: it asks whether to clear everything and
        asks again. Back up first, or use another browser profile.
      - You get: 9 customers + walk-in customer, 12 products / services, 5 quotations, 24 tax invoices (1 cancelled ·
        5 abbreviated · 1 USD export), 13 receipts, 4 credit notes (1 cancelled), 1 debit note, 1 billing note, 21 expenses,
        12 50 Tawi certificates — on both branches (round 13: building rent withheld 5 % every month + the subcontract
        payments of jobs J1 / J3).
- [ ] **Offline check**: open the page, then turn Wi-Fi off. Opened from your own machine: F5 must show no yellow
      "page did not load completely" box. Opened from an internet URL: **do not press F5 offline**, PDF export still works.
      → **Demo → Demo status check** must show PDF (local files) ✓ ready, negative stock 0, runtime errors 0.
- [ ] One **Admin** view: every menu is visible; **Simple mode / Advanced mode** only hides the advanced pages.
- [ ] **Browser zoom 90–100%**; on a 1366×768 projector 80–90%.
- [ ] **Print once**: Receipts / Payments → the receipt of **บจก. อีสานโลจิสติกส์ เอ็กซ์เพรส THB 16,585.00** → original /
      copy / PDF → print. A4 portrait, margins none/default, **Background graphics** on. In English the print is the Thai
      receipt with English labels and "Amount in words: Sixteen thousand five hundred eighty-five baht only".
- [ ] Close other tabs and notifications, open **Executive overview**.

### The cast of the sample data

| Customer | Our branch | What it shows |
|---|---|---|
| **บจก. อุบลไอที โซลูชั่น** | Head office | Approved quotation → tax invoice THB 140,170.00 paid · a VAT-inclusive invoice of THB 57,673.00 dated the 10th of last month, 30-day credit (⏱ loaded 05/10: due in 5 days; overdue from about the 10th–13th of the month) |
| **บจก. สยามเกษตรอุบล** | Head office | Project quotation THB 273,385.00 pending · bill THB 91,452.90, paid THB 40,000 + **1 UPS returned (credit note THB 3,841.30)** → THB 47,611.60 outstanding, 10 days overdue |
| **รพ.รวมแพทย์อุบล** | Head office | **Price-adjustment credit note** THB 1,605.00 → THB 26,750.00 outstanding, 45 days overdue · a **cancelled** credit note THB 4,815.00 (number kept) |
| **บจก. มูลมั่งมี วัสดุภัณฑ์** | Head office | Slow payer: **100 days** THB 43,741.60 (every load date) + THB 35,224.40 always overdue (⏱ 17 days when loaded 05/10 — grows with the load date) |
| **หจก. ขอนแก่นรุ่งเรืองก่อสร้าง** | Branch no. 00001 | Largest outstanding THB 124,933.20, 62 days overdue · another bill paid |
| **บจก. อีสานโลจิสติกส์ เอ็กซ์เพรส** | Branch no. 00001 | **Receipt with 3% withholding tax** THB 16,585.00 (withheld THB 465.00, received THB 16,120.00, certificate year/tax month-0457, e.g. 2569/09-0457) · MA bill THB 9,630.00 on the last day of last month (⏱ not yet due, except on a load on the 31st) |
| **รร.ศรีขอนแก่นวิทยา** | Branch no. 00001 | **One billing note, one payment closes 2 bills** (THB 33,897.60 + THB 38,348.80) · cancelled training → full credit note THB 3,745.00 |
| **บมจ. แก่นนคร ฟู้ดส์** | Branch no. 00001 | Buyer is **Branch no. 00003 (Khon Kaen factory)** · quotation → tax invoice THB 64,820.60, 60-day credit |
| **สำนักงานบัญชีวรรณาการบัญชี** | Head office | Invoice **without VAT** THB 3,500.00 (individual) |
| **Walk-in customer / cash** | Both | **Abbreviated tax invoices** THB 9,490.90 and THB 4,900.60 (the day before yesterday / yesterday — never before the 1st of this month) · on the last day of last month, 3 more on a single day THB 1,059.30 + THB 2,450.30 + THB 2,118.60 (one line in the output VAT report) |
| **บจก. สยามเกษตรอุบล** (tax story) | Head office | Last day of last month: tax invoice THB 6,955.00 **cancelled** (wrong buyer establishment) and re-issued with the next number · the new one has **debit note DN690901** (installation THB 1,500.00 + VAT THB 105.00 = THB 1,605.00) → THB 8,560.00 outstanding |
| **Payees we withheld tax from** | Head office | Last month (loaded in October 2026 = September): storage rent THB 6,000 from **นายสมศักดิ์ ใจงาม** (individual 5% = THB 300 → PND.3) · transport THB 2,500 from **หจก. อุบลขนส่งด่วน** (1% = THB 25 → PND.53) · cloud THB 5,350 (pre-VAT base THB 5,000 × 3% = THB 150 → PND.53) — 50 Tawi book = B.E. year of that month (2569), nos. 0001–0003 |
| **10 sample suppliers** | Head office / Branch no. 00001 | Purchase tax invoices with 13-digit tax ID + head office / branch: rent, internet, spare parts THB 21,400, office equipment THB 3,000 + VAT · **non-claimable input VAT** 2 (abbreviated tax invoice THB 535, executive car fuel THB 1,070) · cloud THB 5,350 received late, **claimed next month** · advertising THB 8,000 recorded the old way ("VAT data incomplete") |

---

## The 10 minutes

> ✍️ = done live (use **Branch no. 00001** and **บจก. อีสานโลจิสติกส์ เอ็กซ์เพรส** throughout).

### Before the story (~1 min) · the customer's logo and company details ✍️
- Click the company name in the header (or **Demo → Company details and logo**). ✍️ Upload the logo, type the company
  name, address and 13-digit tax ID (the last digit is checked) → the **Document header preview** follows → **Save**.
- **Say**: "Set once, the customer can change it any time; it is stored on this machine and in the backup."

### 0:00–1:00 · **Executive overview**
- **Point** (tab **Overview**): sales **813,972.90** · net profit **56,411.48** · receivables outstanding **436,889.40**
  (11 bills) · overdue **278,260.80** ⏱ — then **To do** and the sales-vs-target / customer charts.
  (The red bar "Overdue invoices: 5 …" ⏱ is on the **Receivables** tab and **My work**.)
  - Sales / net profit = this whole year: these figures on loads from 11 May to 31 Dec (the 130-day history is inside
    one year; from 10 May in a leap year). A load from 1 Jan to 10 May has part of it in the year before: look at that
    year too — both years together give the same figures.
  - ⏱ Overdue THB 278,260.80 / 5 bills = a load on days 1–9 of a month · receivables THB 436,889.40 (11 bills) on every
    load date — see how to read it under Receivables aging.
- **Say**: "In the morning the owner sees who owes money, how much and for how long — no waiting for month-end."

### 1:00–2:30 · Quotation ✍️
- **Sales & collections → Quotations**: **บจก. อุบลไอที โซลูชั่น THB 140,170.00 approved 🚚 INV…** (sold) and
  **บจก. สยามเกษตรอุบล THB 273,385.00 pending approval**.
- ✍️ **+ New quotation** → **Branch no. 00001** → type "อีสาน", pick **บจก. อีสานโลจิสติกส์ เอ็กซ์เพรส** (address / tax ID
  filled) → product **เครื่องพิมพ์เลเซอร์มัลติฟังก์ชัน** ×1 → price **8,990.00** filled → add VAT → total **THB 9,619.30** → save.
- **Say**: "Standard prices come from the product file, numbers never repeat, and you see at once which quotation sold."

### 2:30–4:00 · Tax invoice ✍️
- ✍️ **Delivery notes / Tax invoices → + New delivery note / tax invoice** → Branch no. 00001 → same customer →
  **30-day credit** (due date computed) → **เครื่องพิมพ์เลเซอร์** ×1 + **ตลับหมึกเลเซอร์** ×2 → **VAT 7%** = **Prices exclude
  VAT — add 7%** (the default is "Prices include VAT"; unit prices become 8,990.00 / 2,290.00) → before VAT **13,570.00**
  VAT **949.90** total **THB 14,519.90** → save.
- **Show** (do not save): **Tax invoice type = Abbreviated (s.86/6)** → buyer fields optional, VAT-included locked.
  Click the "?" next to the field: full vs abbreviated tax invoice in plain English.
- **In the list**: the **abbreviated** invoice of the walk-in customer, the **VAT-included** invoice THB 57,673.00, the
  **no-VAT** invoice THB 3,500.00.
- **Say**: "Company sales (full, s.86/4), shop sales (abbreviated, s.86/6), VAT added / included / none — one system,
  one VAT formula."

### 4:00–5:30 · Receipt + withholding tax ✍️
- **Receipts / Payments** → **บจก. อีสานโลจิสติกส์ เอ็กซ์เพรส THB 16,585.00** → **Original / copy / PDF**: withholding
  **−465.00**, net cash **16,120.00**, the certificate number, and the English amount in words under the Thai one.
- ✍️ **+ Receive payment / issue receipt** → Branch no. 00001 → the **MA bill of บจก. อีสานโลจิสติกส์ เอ็กซ์เพรส THB 9,630.00**
  (⏱ loaded in January: this bill is dated December of the year before — type that year (A.D., e.g. 2026) into the
  **Year** box above the bill list)
  → **Withholding rate = 3% — services / hire of work / professional fees** → withheld **270.00** (on the pre-VAT
  9,000) received **9,360.00** → certificate number → save.
- **Say**: "Withholding tax is computed on the amount before VAT; the bill is fully paid, no false 270-baht balance."

### 5:30–6:45 · Credit note (returned goods) ✍️
- **Credit notes**: UPS return **THB 3,841.30**, price adjustment **THB 1,605.00**, full credit **THB 3,745.00**, and a
  **cancelled** one THB 4,815.00 (number kept).
- ✍️ **+ Issue credit note** → Branch no. 00001 → the invoice just issued (THB 14,519.90) → reason **Goods returned
  under a trade agreement** → **difference (before VAT) 2,290.00** (original value 13,570.00 · correct value 11,280.00)
  → **Returned goods**: ตลับหมึกเลเซอร์ 1 → VAT on the difference **160.30**, total credited **THB 2,450.30** → save.
  (On a VAT-included bill the difference is VAT-included: type **2,450.30** to get the same 2,290.00 + 160.30 —
  typing 2,290 gives only 2,140.19 + 149.81.)
- **Say**: "A credit note under s.86/10 reduces the receivable, the sales and the output VAT of the month it is issued;
  returned goods go back to stock."

### 6:45–8:15 · Receivables aging and overdue alerts
- **Executive overview → Receivables**: outstanding **THB 436,889.40** (11 bills · 8 customers — every load date) ·
  ⏱ overdue **THB 278,260.80 (63.7%)** · over 90 days **THB 43,741.60** (every load date); ⏱ buckets (a load on days 1–9
  of a month) not yet due THB 158,628.60 · 1–30 days THB 82,836.00 · 31–60 days THB 26,750.00 · 61–90 days
  THB 124,933.20 · over 90 days THB 43,741.60.
  After the live steps the total is **THB 439,329.00** (every load date) and ⏱ "not yet due" **THB 161,068.20**; overdue
  stays 5 bills THB 278,260.80 ⏱.
  - ⏱ **The figures depend on the load date — read them like this from the 10th of a month on**: the total
    THB 436,889.40 / 11 bills / 8 customers does not change · over 90 days THB 43,741.60 (บจก. มูลมั่งมี, 100 days) and
    61–90 days THB 124,933.20 (หจก. ขอนแก่นรุ่งเรืองก่อสร้าง, 62 days) do not change · last month's 30-day bills move
    from "not yet due" to "1–30 days" when due: บจก. อุบลไอที THB 57,673.00 (about the 10th–13th), the accounting office
    THB 3,500.00 (the 24th), รพ.รวมแพทย์อุบล THB 14,445.00 (the 28th), บจก. อีสานโลจิสติกส์ THB 9,630.00 (the 31st) · the
    THB 35,224.40 bill of บจก. มูลมั่งมี moves from "1–30 days" to "31–60 days" about the 18th–21st — e.g. loaded on
    13/10/2026: 6 bills overdue, THB 335,933.80.
- Open **บจก. มูลมั่งมี วัสดุภัณฑ์** (100 days, THB 78,966.00 in total) → **Export CSV** (English column headers).
- **Say**: "The same figures as the KPIs, the red bar, Decision Council and the audit log — one formula everywhere."

### 8:15–9:30 · Executive dashboard
- Tab **Sales and targets** → **All months**, this year → **Both branches** (the figures = the whole 130-day history:
  every load from 11 May to 31 Dec; from 1 Jan to 10 May add the year before): sales before VAT **813,972.90** · cost
  **584,700.00** · commission **21,131.70** · expenses **151,729.72** · net profit **56,411.48**
  (after the live steps **825,252.90** and **67,691.48**). *Round 13B (ADR-031)*: up from 716,010.00 / 525,700.00 / 124,915.00 / 44,263.30 (net +12,148.18) — the head office's USD export 97,962.90
  (cost 59,000) and the JPY cloud service from Japan 26,814.72 (exchange differences and the borne tax are in the books, not the dashboard). *Round 13 (ADR-030)*: expenses + 3,100 — the electrician of job
  J1 (1,500, head office) and the crane hire of job J3 (1,600, branch), paid and withheld 3 %.
- **Head office** / **Branch no. 00001**: sales 502,672.90 net profit 16,098.08 (~3.2%) vs 311,300.00 net profit
  40,313.40 (~13.0%).
- **Say**: "The branch that sells less earns more — decide on real profit, not on sales alone."
- **Monthly sales vs target chart** (Overview tab): **last month (the tax month) beats its target and the month before
  misses it, on every load date**; ⏱ how many months hit and this month's target depend on the load date (loaded
  05/10/2026: "2/4 months", target THB 220,000 from this month to December).

### +2 minutes (if the customer asks "can it help me plan?") · Analysis & Forecast (ADR-027)
- **Data & reports › Analysis & Forecast** (in simple mode) · ⏱ figures below are for a load on **14/10/2026** (latest
  closed month = September 2026); on other load dates the document months are the same, while the sample history and
  the forecast move with the month.
- **Comparisons** (September 2026 · whole company): sales **145,150.00** = the executive overview (head office 79,070.00
  + Branch no. 00001 66,080.00) · last year 266,500.00 · dimension "Customer" → biggest decline "Customer บจก. มูลมั่งมี
  วัสดุภัณฑ์ bought 100% less compared with last year (−THB 77,980.00)" (the customer with the 100-day-late invoice) ·
  gross-profit box "20,200.00 (27.9%) on sales with a known cost of 72,470.00 · cost known for 50% of sales" (ADR-028; it
  was the note "No product cost yet").
- **Sales forecast**, lower part "Forecast by product category: which level is more accurate" — a 3-month backtest of the
  category total forecast directly vs the sum of its products, saying which level is more accurate (one-product categories: the same).
- **ABC products** (12 months Oct 2025 – Sep 2026): A 5 products · B 3 · C 30 · "Stock card" opens the product in Stock.
- **Sales forecast** (total sales): 28 months (Jun 2024 – Sep 2026) · **SES** (level only, α 0.1) chosen because it did best on
  the 4-month backtest (MAPE SES 24.6% · Holt 26.0% · Holt-Winters 28.9%) → accuracy **fair** · October 2026 ≈ **213,662.38** (~80% range
  157,360.23 – 269,964.52; round 13B: the June 2026 USD export changed it from Holt, 192,275.63) · the current month is a hollow point, not used · every "?" explains the method and limits.
- **Reorder points**: 1 alert "โน้ตบุ๊กธุรกิจ 14 นิ้ว (Core i5 / RAM 16GB) (Branch no. 00001) will run out in about 52 days
  — order 2 เครื่อง by 25/10/2026" (the unit as stored; lead time 21 days, 95% service level) — the same card is on **My work** · ✍️
  **Create purchase order** → a draft PO (Branch no. 00001, 2 units, expected 04/11/2026), saved only on "Save PO".
- **Say**: "The same figures as the dashboard, and it always says how many months, which method and how wrong it was on
  past data — an estimate, not a guarantee; with under 6 months it does not guess." · Excel / CSV for the accountant or SPSS.
- Sales history before the document months is **summarised sample data** (not in the dashboard, tax reports or receivables).

### +3 minutes (if the customer asks "which jobs make money?") · Job cost / profit per job (ADR-028)
- **Purchasing / Production / Stock › Costing & profit per job** (in simple mode), or "⋯" on a production order → **Job cost sheet** · the four
  jobs' figures below are **the same on every load date** (each job is tied to its own tax invoice), except where ⏱.
- **Jobs**: 4 jobs, all completed · costing method **Moving weighted average · locked** (badge top right).
- **The loss — network installation, outpatient building (รพ.รวมแพทย์อุบล)**: budget 13,400.00, actual **29,120.00** =
  materials 17,500.00 (budget 9,800.00 → **over budget +7,700.00**: rack 4,800.00 + 4 cable rolls 12,800.00 + RJ45 1,300.00
  + patch cords 1,800.00 − 1 cable roll returned 3,200.00) + labour 7,120.00 (ช่างสมศักดิ์ 24 h × 150 + ทีมติดตั้ง A
  16 h × 220) + overhead 3,000.00 (40 h × 75) + subcontract 1,500.00 · revenue 26,500.00 − credit note 1,500.00 =
  **25,000.00** → gross profit **−4,120.00 (−16.5%)**, red box.
- **The very profitable job — network maintenance (MA) ×3 (รพ.รวมแพทย์อุบล)**: cost 3,750.00 (materials 1,050.00 + labour
  1,800.00 + overhead 900.00) · revenue 13,500.00 → **9,750.00 (72.2%)**, green.
- **The thin-margin customer — บจก. อีสานโลจิสติกส์ เอ็กซ์เพรส**: warehouse network job 15,500.00 − 14,430.00 = 1,070.00 (6.9%)
  · MA ×2 9,000.00 − 8,450.00 = 550.00 (6.1%) · **Profit** tab, "Customer" → 24,500.00 − 22,880.00 = **1,620.00 (6.6%)**, orange · the all-periods total
  row: sales 813,972.90 (incl. the USD export, which has no job cost) · **sales with a cost 574,490.00** − cost of sales 449,150.00 = gross profit **125,340.00** (21.8%).
- **Overhead**: predetermined rate = estimated yearly overhead 180,000.00 ÷ 2,400 labour hours = **75 per hour** · the
  **Overhead** tab compares the overhead applied to jobs with the month's actual expenses (the difference closes to cost
  of sales in one click on the page Books & month-end).
- **Stock card**, CAT6 cable at Branch no. 00001: opening 5 rolls × 3,200 = 16,000.00 · received 10 × 3,350 → average
  **3,300.0000** · 1 roll issued to the job 3,300.00 · balance 14 rolls **46,200.00**.
- **Stock value / NRV**: the 9U rack is expected to sell for 4,500 − 300 cost to sell = 4,200, below its cost 4,800 →
  write-down 600.00 per rack, one left at each branch = **1,200.00** · button **Post the write-down** (optional: debit
  loss on write-down / credit allowance) · Excel.
- **Analysis & Forecast › Comparisons** (September 2026): the gross-profit box replaces the old note — **gross profit
  20,200.00 (27.9%) on sales with a known cost of 72,470.00 · cost known for 50% of sales** ⏱ (load in October) — sales
  without a cost (services / made-to-order items not tied to a job) never enter the margin.
- **Say**: "Inventory is costed by moving average (or FIFO) under Revenue Code section 65 bis (6) — once chosen it is
  locked and changes only with Revenue Department approval · job cost = materials issued + labour hours + overhead per hour
  + subcontract, against the budget set when the job was accepted, so you see at once which job ran over and why." A
  back-dated entry into a closed period is refused.

### +2 minutes (accountant / owner who files VAT) · Tax reports, PP.30 (monthly VAT return)
- **Data & reports › Tax reports** → the page opens on **the latest closed tax month** by itself and says so under the
  selectors ("The latest closed tax month (last month) …") — loaded in Oct 2026 = **September 2026**, loaded in Jan 2027
  = **December 2026**; establishment **Head office**. The figures below are the same on every load date (only the month
  name and the document numbers change). The **Thai tax calendar** shows the deadlines (for September 2026: PND.3 / PND.53 paper 07/10/2026, online
  15/10/2026; PP.30 paper 15/10/2026, online **26/10/2026** — 23 Oct is Chulalongkorn Day, a government holiday, round 13); every "?" explains a concept in English and recommends a Thai accountant.
- **Output VAT report**: credit notes negative in the month issued · 3 abbreviated invoices on one line · the cancelled
  invoice kept at 0.00 · debit note DN690901 positive · total **75,570.00 / VAT 5,289.90**.
- **Input VAT report**: 4 claimed **41,114.95 / VAT 2,878.05** (round 13: incl. the supplier's tax invoice that came with goods
  receipt GR690901, 6,900.00 / VAT 483.00) · "VAT data incomplete" box · "Claimed in month
  10/2026" (the cloud invoice: claimed the month after = this month, never a future month) · tab **Non-claimable input VAT** 2, VAT 105.00.
- **PP.30**: line 1 **79,070.00** · 3 **3,500.00** · 4 **75,570.00** · 5 **5,289.90** · 6 **41,114.95** · 7 **2,878.05** ·
  8/11 **payable 2,411.85** (Branch no. 00001: payable 3,827.46 · combined filing 6,239.31). **Record as filed** → offers the period lock.
  The printed PP.30 summary and the PND attachments stay in Thai (they are Revenue Department forms).
- **PND.3**: 1 payee **6,000.00 / 300.00** · **PND.53**: 3 payees **18,714.95 / 735.75** (round 13: + building rent paid to a company, 11,214.95 × 5 % = 560.75) · **50 Tawi** → **View / print**.
- **Say**: "Every line comes from issued documents — the demo does not file with the Revenue Department."

### +3 minutes (exports / services bought abroad) · หลายสกุลเงิน — Multi-currency (ADR-031)
This story sits **three months before the tax month** (load 05/10/2569 → June 2026), so the tax figures of the tax month
and the month before do not change. The sample rates are **made-up rates** (source "sample data"), not real BOT rates.
- **Click**: menu **Multi-currency** → tab **Exchange rates**: every rate has a date, a type (BOT average buying / selling,
  actual), a source and who entered it — rows cannot be edited; a correction is a new version (documents keep their baht).
- **Point at the USD export invoice** (tab **Sales documents**): 5 CCTV kits × USD 600.00 = **USD 3,000.00** at the BOT
  average buying rate 32.6543 of the business day before the announcement (Friday 26 June uses Thursday 25 June's rate)
  = **97,962.90 baht**, computed once and stored · 0% VAT · export entry number.
- **Receipts**: USD 1,000.00 at the bank's 33.1000 = 33,100.00 baht; carrying 32,654.30 → **realised gain 445.70** (4210)
  · next month USD 2,000.00 × 32.8000 = 65,600.00 against 65,308.60 → gain 291.40.
- **Month end** (June): open USD 2,000.00 × 33.0000 = 66,000.00 → **unrealised gain 691.40** (4220) on the last day,
  reversed automatically on day 1 · export value on PP.30 = 33,100.00 sold in the month + 66,000.00 = **99,100.00**.
- **Payables abroad**: cloud service from Japan **JPY 120,000** (no decimals) at selling 22.3456 per 100 = 26,814.72 baht
  · paid with the tax borne by the company: 27,001.32 sent · income 31,766.26 · **PND.54 15% = 4,764.94** (to be confirmed
  — a tax treaty may lower it) · **PP.36 7% = 2,223.64**, claimed as input VAT next month · exchange loss 186.60.
- **Click**: **Tax reports** → tabs **PND.54** / **PP.36**, June 2026 → due by the 7th of the next month (moved past
  holidays) · Excel / CSV.
- **Say**: "The baht of every document is computed once when it is issued and stored — tax reports, books, receivables
  and the dashboard always agree. If the day's rate is missing, the app does not guess: you enter it with evidence first."

### +3 minutes (if the customer asks "how do I send it to my accountant?") · Month-end pack for the accountant (ADR-029)
- **Data & reports › Books & month-end** (in simple mode) → opens on **September 2026** (last month) · the figures below are
  **the same on every load date**.
- **Trial balance** tab (all branches): **Balanced** · debit = credit **436,737.50** (round 13: + the goods receipt's VAT 483.00) · select any account → its **Ledger**
  with the running balance.
- **Say**: "No re-keying — every issued document posts to the journal automatically, debit = credit on every entry; a
  cancelled document is reversed on its cancel date (a tax invoice cancelled in a later month: in its own tax month, as
  the sales tax report shows it), the original is never edited."
- **Month-end pack** tab: every line ✓ — output VAT in the books = PP.30 line 5 **5,289.90** (head office) · input VAT = line 7
  **2,878.05** · withholding tax payable = PND.3 **300.00** + PND.53 **735.75** · Branch no. 00001 output VAT **4,625.60** / input
  VAT **798.14** · inventory in the books = stock valuation **727,590.00** · WIP 0.00 · entries that used a default (e.g. a
  receipt that does not say which account → bank) are listed for the accountant.
- **Download the month-end pack (multi-sheet Excel)** → one file: cover (totals: output VAT 9,915.50 · input VAT 3,676.19 +
  the checks) · sales VAT / purchase VAT / non-claimable VAT / PND.3 / PND.53 per branch · AR and AP aging · stock valuation ·
  WIP by job · trial balance · general journal · 50 Tawi received · follow-ups (e.g. goods received without a tax invoice yet) ·
  the accountant's checklist (incl. keeping documents 5 years) — made offline.
- Tick **"Send as non-stock items + cost of sales as one month-end journal"** (if the accountant uses PEAK): the month's cost
  of sales becomes one entry per branch on the 30th, the same total to the baht — PEAK will not cost it twice.
- **PEAK import file**: headers, order and date format are editable — yellow label **"Must be checked against PEAK’s real
  template before use"** (the real template is downloadable only in PEAK Pro Plus — **do not promise the import works**).
- **Overhead close** (box below): head office applied 900.00 · actual 2,570.00 → to cost of sales **1,670.00** · Branch no. 00001
  1,500.00 / 2,990.65 → **1,490.65** — one click (refused in a closed period).
- ✍️ (if time) **Company settings › Chart of accounts & automatic posting**: change AR 1130 → 1131 → the trial balance shows
  the new code at once · **Say**: "The default codes follow what Thai accounting software uses — not an official standard;
  the company's accountant changes them to its own chart."
- **Opening balances** tab: a company starting mid-year downloads the CSV template (stock, receivables, payables) → the
  system checks it and shows a preview; nothing is written until "Confirm the import".

### +1 minute (credit sales / billing) · PromptPay QR on documents (ADR-029)
- ✍️ **Company settings › PromptPay QR on documents** (off by default) → tick **Show the PromptPay QR on documents** · type
  **Tax ID** · the company's 13-digit ID linked to PromptPay → **Save QR settings** (a wrong check digit is refused) · the
  preview shows the QR, its payload and "CRC valid".
- **Open tax invoice INV690904 (รพ.รวมแพทย์อุบล)** → the original has the **"Scan to pay (PromptPay)"** box with **14,445.00**
  and the payee · the copy has none · a receipt shows the amount after withholding tax · a billing note the amount still open.
- **Say**: "Your customer scans with any bank app and the amount is filled in." · ⚠️ Before real use **pay a small amount
  with every main bank app** (the card keeps the checklist) · Bill Payment (tag 30) only with a bank agreement.
- Switch off = the printed documents are exactly as before.

### 9:30–10:00 · Close
- **Say**: "It all runs in this browser, PDFs work offline, and the screen speaks English while your documents stay
  proper Thai tax documents. Next step: import your customer and product lists from CSV."

---

## Questions customers ask

| Question | Answer |
|---|---|
| Can my Thai staff and I use different languages? | Yes — each browser keeps its own choice; the data is the same. Names and notes are never translated. |
| Are the printed documents in English? | Commercial documents (quotation, tax invoice, receipt, credit / debit note) print in Thai with English labels and the amount in English words. Revenue Department forms (50 Tawi, PP.30, PND attachments) print in Thai only. |
| Where is the data? | Only in this browser; back up with **Back up data** (JSON). Multi-user cloud is on the roadmap. |
| e-Tax Invoice / e-filing? | Not yet — the demo prepares the figures; file at efiling.rd.go.th. |
| Is the tax right? | One formula everywhere, satang rounding, automatic tests — have your Thai accountant review the documents before live use. |

## After the demo
1. **Demo → Clear all demo data (reset)** — keeps the language, the simple/advanced mode and the company profile.
2. **Demo → Load sample data for the demo** again for the next customer: the old bills are dated from today again (the
   aging is right) and the tax story moves to that day's latest closed month (the same PP.30 / PND figures).
