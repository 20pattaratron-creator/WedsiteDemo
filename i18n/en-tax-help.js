// i18n/en-tax-help.js — short English explanations of Thai tax concepts for foreign owners (ADR-026).
// Plain data only. Shown on screen in English behind a "?" button next to each concept; never printed.
// Content follows docs/TAX_FEATURES_SPEC.md and ADR-021 to ADR-025 and gives no advice beyond them: it says what the
// demo does and why. Every popover ends with TAX_HELP_FOOTER.
// Each concept: { title, question (the button's accessible name), paragraphs: [...] }.
export const TAX_HELP_FOOTER = 'This is a summary of how the demo applies Thai tax rules, not legal or tax advice. Please confirm the details with a Thai accountant before relying on them.';

export const TAX_HELP_EN = Object.freeze({
  vat: Object.freeze({
    title: 'VAT 7% — output VAT and input VAT',
    question: 'What are VAT, output VAT and input VAT?',
    paragraphs: Object.freeze([
      'Thailand charges value added tax (VAT) at 7% on most sales of goods and services by VAT-registered businesses.',
      'Output VAT (ภาษีขาย) is the VAT you charge customers on your tax invoices. Input VAT (ภาษีซื้อ) is the VAT suppliers charge you on their tax invoices.',
      'Each month you report both per establishment on the PP.30 return: output VAT minus claimable input VAT is the VAT you pay (or the overpayment you carry forward or claim back).',
      'Prices can be entered "VAT added" (7% on top) or "VAT included" (the tax is split out); the demo rounds VAT to the satang as the Revenue Department rules require.'
    ])
  }),
  taxInvoiceForms: Object.freeze({
    title: 'Full vs abbreviated tax invoice',
    question: 'What is the difference between a full and an abbreviated tax invoice?',
    paragraphs: Object.freeze([
      'A full tax invoice (ใบกำกับภาษีเต็มรูป, Revenue Code s.86/4) shows the seller, the buyer\'s name, address, tax ID and head office / branch, the items, the value and the VAT separately. A VAT-registered buyer needs it to claim input VAT.',
      'An abbreviated tax invoice (ใบกำกับภาษีอย่างย่อ, s.86/6) may only be issued by a retailer; prices include VAT and the buyer\'s details are not required. The buyer cannot claim input VAT with it.',
      'Issued tax invoices are never deleted: a wrong one is cancelled (its number and a "CANCELLED" stamp are kept) and a new one is issued.'
    ])
  }),
  branchCodes: Object.freeze({
    title: 'Head office (00000) and branch numbers',
    question: 'What are the head office and branch codes?',
    paragraphs: Object.freeze([
      'Every place of business (สถานประกอบการ) registered for VAT has a 5-digit code: the head office is 00000 (สำนักงานใหญ่), branches are 00001, 00002 … (สาขาที่).',
      'A full tax invoice states the seller\'s establishment and, when the buyer is VAT-registered, the buyer\'s "Head office" or "Branch no." as shown on the buyer\'s PP.20 registration (Director-General\'s Notification on VAT No. 199).',
      'VAT reports and PP.30 are prepared per establishment unless the Revenue Department has approved combined filing. This demo supports a head office plus at most one branch.'
    ])
  }),
  creditNote: Object.freeze({
    title: 'Credit note (s.86/10)',
    question: 'What is a credit note?',
    paragraphs: Object.freeze([
      'A credit note (ใบลดหนี้, Revenue Code s.86/10) is issued when the value of goods or services goes down after the tax invoice was issued — for example returned or damaged goods, or a price charged too high.',
      'It must show the original tax invoice number, the original value, the correct value, the difference, the VAT on the difference and a short reason.',
      'It reduces output VAT in the tax month the credit note is issued, not in the month of the original invoice.'
    ])
  }),
  debitNote: Object.freeze({
    title: 'Debit note (s.86/9)',
    question: 'What is a debit note?',
    paragraphs: Object.freeze([
      'A debit note (ใบเพิ่มหนี้, Revenue Code s.82/9 and 86/9) is issued when the value goes up after the tax invoice was issued — more goods or services than agreed, or a price charged too low.',
      'Like a credit note it shows the original tax invoice, original value, correct value, difference and the additional VAT, with the reason. It is issued in the tax month the event happens and its VAT is output VAT of that month.',
      'In this demo the extra amount is collected together with the original invoice.'
    ])
  }),
  pp30: Object.freeze({
    title: 'PP.30 — the monthly VAT return',
    question: 'What is PP.30 and when is it due?',
    paragraphs: Object.freeze([
      'PP.30 (ภ.พ.30) is the monthly VAT return. Line 1 is sales of the month, lines 2–3 take out 0%-rated and exempt sales, line 5 is output VAT and line 7 input VAT; line 8 or 9 is the VAT payable or overpaid, line 10 an overpayment brought forward, lines 11–12 the result. The demo fills lines 1–12; lines 5 and 7 equal the totals of the output and input VAT reports.',
      'It is due by the 15th of the following month on paper, or by the 23rd when filed online (e-filing extension, configured until 31 Jan 2027). The demo moves a due date that falls on a Saturday, a Sunday or a listed government holiday (2026 official, 2027 provisional) to the next working day.',
      'The demo does not file anything with the Revenue Department: use its worksheet to file at efiling.rd.go.th, then record the filing. A change after filing needs an additional (amended) return.'
    ])
  }),
  nonClaimable: Object.freeze({
    title: 'Non-claimable input VAT (s.82/5)',
    question: 'What is non-claimable input VAT?',
    paragraphs: Object.freeze([
      'Some input VAT may not be deducted (ภาษีซื้อต้องห้าม, Revenue Code s.82/5): no tax invoice or an incomplete one, purchases not related to the business, entertainment, passenger cars and vans up to 10 seats (purchase, hire, fuel, repairs), abbreviated tax invoices, and sellers who are not VAT-registered.',
      'That VAT becomes part of the expense cost. The demo lists it on its own tab and keeps it out of the input VAT report and PP.30.'
    ])
  }),
  claimWindow: Object.freeze({
    title: 'The 6-month window to claim input VAT (s.82/3)',
    question: 'How long can input VAT be claimed?',
    paragraphs: Object.freeze([
      'Input VAT is normally claimed in the tax month the tax invoice is received. Under Revenue Code s.82/3 it may be claimed in a later month, but not more than 6 months after the month on the tax invoice.',
      'The demo warns when the chosen claim month is past that window, refuses a claim month that is locked, and refuses the same supplier tax ID + invoice number twice.'
    ])
  }),
  wht: Object.freeze({
    title: 'Withholding tax — 50 Tawi, PND.3 and PND.53',
    question: 'How does withholding tax work?',
    paragraphs: Object.freeze([
      'When a company pays for services, hire of work, professional fees (3%), rent (5%), advertising (2%) or transport (1%), it withholds that percentage of the amount before VAT and pays it to the Revenue Department (rates under Order Tor.Por.4/2528). Payments under 1,000 THB are not withheld unless you choose to.',
      'The payee receives a withholding-tax certificate, the 50 Tawi (หนังสือรับรองการหักภาษี ณ ที่จ่าย, s.50 bis), at the time of payment: copy 1 to attach to their tax return, copy 2 for their records.',
      'The monthly return is PND.3 when the payee is an individual and PND.53 when the payee is a company or other juristic person; it is due by the 7th of the following month on paper or the 15th online, and only for months with withholding.',
      'Payer conditions: 1 = tax withheld from the payment; 2 = the payer bears the tax every time (the amount is grossed up); 3 = the payer bears the tax once (the borne tax is added to the income and taxed once). Condition 3 follows a secondary source; confirm it before live use.'
    ])
  }),
  periodLock: Object.freeze({
    title: 'Period locks',
    question: 'What is a period lock?',
    paragraphs: Object.freeze([
      'Locking a period (ปิดงวด) stops documents dated up to that day from being added, edited, cancelled or restored — for sales / output VAT, purchases / input VAT, or both — so filed figures cannot change silently.',
      'After a PP.30 or PND filing is recorded, the demo offers to lock that month. Unlocking needs a reason and is written to the audit log; a backup restore can add locks but never remove them.',
      'Corrections to a locked month should be made with a credit or debit note, or an additional return, as your accountant advises.'
    ])
  })
});

// The monthly due dates for the "Thai tax calendar" panel (tax reports page, English only).
export const TAX_CALENDAR_EN = Object.freeze({
  title: 'Thai tax calendar',
  intro: 'Monthly filing deadlines for the tax month shown (rules as configured in this demo).',
  rows: Object.freeze([
    Object.freeze({ form: 'PND.3 / PND.53', meaning: 'monthly withholding-tax returns for individuals / companies', paperDay: 7, onlineDay: 15 }),
    Object.freeze({ form: 'PP.30', meaning: 'monthly VAT return', paperDay: 15, onlineDay: 23 })
  ]),
  weekendNote: 'A due date on a Saturday, a Sunday or a listed government holiday moves to the next working day (holiday list: 2026 official, 2027 provisional; other years weekends only) — check the Revenue Department calendar.',
  extensionNote: 'The extra days for online filing are configured until 31 Jan 2027.'
});
