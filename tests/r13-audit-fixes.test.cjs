// Round 13A (ADR-030) — one regression test per finding of the round-13 accounting / Thai tax audit
// (/home/claude/reports/ตรวจบัญชีและภาษีรอบ13.md, repro scripts /tmp/claude-0/audit-tax/audit-r13/) and of the language
// audit (ตรวจภาษาไทยอังกฤษรอบ13.md). Pure cores only (fast suite); the printed documents (0 % tax invoice, abbreviated
// invoice with POS ID, receipt / tax invoice at payment, replacement line, EN print mapping) are in r13-audit-fixes-app.
// Every test here fails on round12-journal (/tmp/claude-0/r13a-newtests-on-base.log) and passes now.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const imp = file => import(pathToFileURL(path.join(ROOT, file)).href);
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const rows = entry => entry.lines.map(line => [line.account, line.branch, line.debit, line.credit]);
const only = (journal, kind) => journal.entries.filter(entry => entry.kind === kind);
const balanced = entry => entry.lines.reduce((s, l) => s + l.debit, 0) === entry.lines.reduce((s, l) => s + l.credit, 0);

// A withholding draft (hire of work 3 %, a person, VAT-registered payee unless overridden).
const whtDraft = (over = {}) => ({
  date: '2026-09-20', branch: 'ubon', vendor: 'นายวิชัย ช่างไฟฟ้า', amount: 10700, vatMode: 'add', subtotal: 10000, vatAmt: 700,
  whtEnabled: true, payeeEntityType: 'person', whtIncomeType: 'hire_of_work', whtCondition: 1, payeeName: 'นายวิชัย ช่างไฟฟ้า',
  payeeTaxId: '3409900345674', payeeAddress: 'อุบลราชธานี', ...over
});
const expenseOf = (draft, fields) => ({ id: 'e1', branch: 'ubon', date: draft.date, docNo: 'EXP-1', cat: 'ค่าจ้างเหมา/ค่าบริการ', desc: 'งานติดตั้ง', vendor: draft.vendor, amount: draft.amount, vatMode: draft.vatMode, subtotal: draft.subtotal, vatAmt: draft.vatAmt, docType: 'receipt', ...fields });

test('r13#HIGH-1 condition 3 (ออกให้ครั้งเดียว): 10,000 + VAT 700 @3% → pay 10,691, company bears 300, 9 from the payee; 50 ทวิ 10,300 / 309', async () => {
  const w = await imp('erp-payer-wht-core.js');
  const figures = w.calculateWht({ base: 10000, rate: 3, condition: 3, total: 10700 });
  assert.deepEqual([figures.amountPaid, figures.whtAmount, figures.payerBorne, figures.fromPayee, figures.netPaid], [10300, 309, 300, 9, 10691]);
  const noVat = w.calculateWht({ base: 10000, rate: 3, condition: 3, total: 10000 });
  assert.deepEqual([noVat.netPaid, noVat.payerBorne], [9991, 300], 'PEAK example without VAT: the payee receives 9,991.00');
  const plan = w.planExpenseWhtFields(whtDraft({ whtCondition: 3 }));
  assert.equal(plan.ok, true, plan.error);
  assert.deepEqual([plan.fields.whtBase, plan.fields.whtAmount, plan.fields.whtPayerBorne, plan.fields.whtFromPayee, plan.fields.netPaid], [10300, 309, 300, 9, 10691]);
  assert.match(plan.warnings.join('\n'), /300\.00/);
  // The journal: Dr 5410 300 (only the first-round tax is the company's cost) / Cr bank 10,691 / Cr WHT payable 309.
  const j = await imp('erp-journal-core.js');
  const journal = j.buildJournal({ expenses: [expenseOf(whtDraft(), plan.fields)] });
  const [entry] = only(journal, 'expense');
  const by = account => entry.lines.filter(l => l.account === account).reduce((s, l) => s + l.debit - l.credit, 0);
  assert.deepEqual([by('exp_wht_borne'), by('wht_pnd3'), by(j.DEFAULT_POSTING.expensePaidFrom)], [30000, -30900, -1069100]);
  assert.equal(balanced(entry), true);
});

test('r13#HIGH-2 goods receipt with VAT: AP = gross, input VAT in ภ.พ.30 L7 via the purchase tax report, pending until the tax invoice arrives', async () => {
  const tax = await imp('erp-tax-reports-core.js');
  const j = await imp('erp-journal-core.js');
  const draft = { date: '2026-09-12', subtotal: 6900, supplier: 'บจก. ไอทีซัพพลาย อีสาน', vatMode: 'add', taxStatus: 'received', vendorTaxId: '0105558004044', vendorBranchCode: '00000', taxInvoiceNo: 'ITS-6909-0172', taxInvoiceDate: '2026-09-12' };
  const plan = tax.planGoodsReceiptVatFields(draft);
  assert.equal(plan.ok, true, plan.error);
  assert.deepEqual([plan.fields.vatAmt, plan.fields.total, plan.fields.claimPeriod, plan.fields.inputVatClaimable], [483, 7383, '2026-09', true]);
  const gr = { id: 'g1', no: 'GR690901', branch: 'ubon', date: '2026-09-12', supplier: draft.supplier, subtotal: 6900, ...plan.fields };
  const purchase = tax.buildPurchaseTaxReport({ period: '2026-09', sources: [{ branch: 'ubon', expenses: [], goodsReceipts: [gr] }], entryDate: () => '' });
  assert.deepEqual(purchase.rows.map(r => [r.no, r.value, r.vat]), [['ITS-6909-0172', 6900, 483]]);
  assert.equal(tax.buildPp30Summary({ sales: tax.buildSalesTaxReport({ period: '2026-09', sources: [{ branch: 'ubon', invoices: [] }], entryDate: () => '' }), purchases: purchase }).lines[7], 483);
  const [vatEntry] = only(j.buildJournal({ goodsReceipts: [gr] }), 'gr_vat');
  assert.deepEqual(rows(vatEntry), [['input_vat', 'ubon', 48300, 0], ['ap', 'ubon', 0, 48300]]);
  assert.equal(vatEntry.lines[1].ref.key, 'gr|ubon|g1', 'the same AP open item as the goods: AP = 7,383.00');
  // No tax invoice yet: VAT waits in 1155, not in the report; the month-end pack lists it.
  const pendingPlan = tax.planGoodsReceiptVatFields({ ...draft, taxStatus: 'pending', taxInvoiceNo: '', taxInvoiceDate: '' });
  assert.equal(pendingPlan.ok, true, pendingPlan.error);
  const pending = { ...gr, ...pendingPlan.fields };
  assert.deepEqual(tax.goodsReceiptVatOf(pending), { vat: 483, value: 6900, pending: true, claimable: false, claimPeriod: '' });
  const pendingReport = tax.buildPurchaseTaxReport({ period: '2026-09', sources: [{ branch: 'ubon', expenses: [], goodsReceipts: [pending] }], entryDate: () => '' });
  assert.deepEqual([pendingReport.rows.length, pendingReport.pendingReceipts.length], [0, 1]);
  const [pendingEntry] = only(j.buildJournal({ goodsReceipts: [pending] }), 'gr_vat');
  assert.deepEqual([rows(pendingEntry)[0][0], pendingEntry.flags], ['input_vat_undue', ['gr_tax_invoice_pending']]);
  // Missing seller TIN on a received invoice is refused (ม.82/3, 86/4); a non-VAT supplier carries no VAT.
  assert.equal(tax.planGoodsReceiptVatFields({ ...draft, vendorTaxId: '' }).ok, false);
  assert.deepEqual([tax.planGoodsReceiptVatFields({ ...draft, vatMode: 'none' }).fields.vatAmt, tax.planGoodsReceiptVatFields({ subtotal: 1 }).ok], [0, false]);
});

test('r13#HIGH-3 the 1,000-baht threshold is per contract: an 800 instalment of a 3,000 contract is withheld; no "ไม่ต้องหัก" wording', async () => {
  const w = await imp('erp-payer-wht-core.js');
  const small = whtDraft({ amount: 800, vatMode: 'none', subtotal: 800, vatAmt: 0 });
  const alone = w.planExpenseWhtFields(small);
  assert.equal(alone.fields, null, 'no contract: the per-payment rule');
  assert.doesNotMatch(alone.warnings.join('\n'), /ไม่ต้องหัก/);
  assert.match(alone.warnings.join('\n'), /สัญญา/, 'the message asks whether the payment is part of a contract');
  const contract = w.planExpenseWhtFields({ ...small, whtContract: true, whtContractTotal: 3000, whtContractRef: 'สัญญา 12/2569' });
  assert.equal(contract.ok, true, contract.error);
  assert.deepEqual([contract.fields.whtAmount, contract.fields.whtContract, contract.fields.whtContractTotal, contract.fields.whtContractRef], [24, true, 3000, 'สัญญา 12/2569']);
  assert.equal(w.planExpenseWhtFields({ ...small, whtContract: true, whtContractTotal: 900 }).fields, null, 'a contract under 1,000 is still below the threshold');
  assert.equal(w.planExpenseWhtFields({ ...small, whtContract: true, whtContractTotal: 500 }).ok, false, 'the contract total cannot be below this payment');
});

test('r13#MED-1 VAT-inclusive base depends on the payee: non-VAT payee → no extraction; VAT payee or unknown with a tax invoice → asked, never guessed', async () => {
  const w = await imp('erp-payer-wht-core.js');
  const base = { amount: 1070 };
  assert.deepEqual([w.whtPreVatOf({ ...base, payeeVatRegistered: 'no' }).preVat, w.whtPreVatOf({ ...base, payeeVatRegistered: 'no' }).assumed], [1070, 'payee']);
  assert.equal(w.whtPreVatOf({ ...base, payeeVatRegistered: 'yes' }).ok, false);
  assert.equal(w.whtPreVatOf({ ...base, docType: 'tax_invoice' }).ok, false, 'unknown payee VAT status with a tax invoice: no silent default');
  assert.deepEqual([w.whtPreVatOf({ ...base, whtVatBasis: 'included' }).preVat, w.whtPreVatOf({ ...base, docType: 'receipt' }).preVat], [1000, 1070]);
});

test('r13#MED-2 a separate payment date drives the ภ.ง.ด. month, the 50 ทวิ date and the payment entry', async () => {
  const w = await imp('erp-payer-wht-core.js');
  const j = await imp('erp-journal-core.js');
  const draft = whtDraft({ date: '2026-09-28', whtPaymentDate: '2026-10-02' });
  const plan = w.planExpenseWhtFields(draft);
  assert.equal(plan.ok, true, plan.error);
  assert.equal(plan.fields.whtPaymentDate, '2026-10-02');
  const expense = expenseOf(draft, plan.fields);
  assert.equal(w.whtPaymentDateOf(expense), '2026-10-02');
  assert.equal(w.whtDueDates('2026-10').paper > '2026-11-01', true);
  const journal = j.buildJournal({ expenses: [expense] });
  const [exp] = only(journal, 'expense'), [pay] = only(journal, 'expense_payment');
  assert.deepEqual([exp.date, pay.date], ['2026-09-28', '2026-10-02']);
  assert.equal(pay.lines.some(l => l.account === 'wht_pnd3' && l.credit === 30000), true, 'WHT payable in the payment month');
  assert.equal(w.planExpenseWhtFields({ ...draft, whtPaymentDate: '2026-13-01' }).ok, false);
});

test('r13#MED-3 an invoice cancelled in a later month is reversed in its own month (books = sales tax report); a replacement cites the original', async () => {
  const j = await imp('erp-journal-core.js');
  const f = await imp('erp-document-finance-core.js');
  const invoice = { id: 101, no: 'INV690901', date: '2026-09-05', customer: 'รพ.ทดสอบ', vatMode: 'add', subtotal: 10000, vatAmt: 700, total: 10700, items: [{ product: 'สินค้า', qty: 1, priceUnit: 10000, saleTotal: 10000 }], _branch: 'ubon', branch: 'ubon', status: 'cancelled', cancelled: true, voided: true, voidedAt: '2026-10-03T03:00:00.000Z' };
  const journal = j.buildJournal({ invoices: [invoice] });
  const reversal = journal.entries.find(e => e.kind === 'invoice' && e.id !== `inv|ubon|101`) || journal.entries.filter(e => e.kind === 'invoice')[1];
  assert.equal(reversal.date, '2026-09-30');
  assert.equal(reversal.flags.includes('cancel_backdated'), true);
  assert.equal(journal.flags.find(fl => fl.code === 'cancel_backdated').params.cancelDate, '2026-10-03');
  const september = j.movement(journal.entries, ['output_vat'], { ...j.periodRange('2026-09'), branch: 'ubon' });
  assert.equal(september, 0, 'September output VAT 0 — as the sales tax report shows the cancelled invoice');
  const draft = { ...invoice, id: 102, no: 'INV690905', status: '', cancelled: false, voided: false, voidedAt: '', replacesNo: 'INV690901', replacesId: '101', replacesDate: '2026-09-05' };
  const { record } = f.planInvoiceDocumentAction({ draft });
  assert.deepEqual([record.replacesNo, record.replacesDate], ['INV690901', '2026-09-05']);
  assert.throws(() => f.planInvoiceDocumentAction({ draft: { ...draft, replacesNo: 'INV690905' } }), /เลขที่ต่างจาก/);
});

test('r13#MED-4 a 0 % (export) sale of a VAT registrant keeps the export declaration number and is reported as a 0 % sale', async () => {
  const f = await imp('erp-document-finance-core.js');
  const tax = await imp('erp-tax-reports-core.js');
  const draft = { id: 9, no: 'INV690909', date: '2026-09-09', branch: 'ubon', customer: 'Lao Trading Co.', vatMode: 'none', vatCategory: 'zero', subtotal: 5000, vatAmt: 0, total: 5000, items: [{ product: 'จอ', qty: 1, priceUnit: 5000, saleTotal: 5000 }], exportDeclarationNo: 'A001-1-6909-00001' };
  const { record } = f.planInvoiceDocumentAction({ draft });
  assert.deepEqual([record.vatCategory, record.exportDeclarationNo], ['zero', 'A001-1-6909-00001']);
  assert.equal(f.planInvoiceDocumentAction({ draft: { ...draft, vatCategory: 'exempt' } }).record.exportDeclarationNo, undefined, 'only a 0 % sale carries it');
  const sales = tax.buildSalesTaxReport({ period: '2026-09', sources: [{ branch: 'ubon', invoices: [record] }], entryDate: () => '' });
  assert.equal(tax.buildPp30Summary({ sales, purchases: tax.buildPurchaseTaxReport({ period: '2026-09', sources: [{ branch: 'ubon', expenses: [] }], entryDate: () => '' }) }).lines[2], 5000, 'ภ.พ.30 L2 (0 % sales)');
});

test('r13#MED-5 abbreviated tax invoice: approval no. (ภ.พ.06) + POS ID per branch from the company profile, warning when not approved', async () => {
  const p = await imp('erp-company-profile-core.js');
  const none = p.abbreviatedInvoiceApproval({}, 'ubon');
  assert.equal(none.approved, false);
  assert.match(none.warnings.join('\n'), /อนุมัติ/);
  const user = { companyProfile: { customProfile: true, custom: { abbreviatedApproval: 'approved', abbreviatedApprovalNo: 'อบ.06-123/2569', branches: { ubon: { code: '00000', posId: 'E051234567890' }, khonkaen: { code: '00001', posId: '' } } } } };
  assert.deepEqual(p.abbreviatedInvoiceApproval(user, 'ubon'), { approved: true, approvalNo: 'อบ.06-123/2569', posId: 'E051234567890', warnings: [] });
  assert.match(p.abbreviatedInvoiceApproval(user, 'khonkaen').warnings.join('\n'), /POS/);
  assert.ok(p.FIELD_LIMITS.posId > 0 && p.FIELD_LIMITS.approvalNo > 0);
});

test('r13#MED-6 service invoice with the tax point at payment (ม.78/1): VAT reported on the receipt dates, shares add up exactly', async () => {
  const tax = await imp('erp-tax-reports-core.js');
  const f = await imp('erp-document-finance-core.js');
  const invoice = { id: 31, no: 'INV690931', date: '2026-08-25', branch: 'ubon', customer: 'รพ.ทดสอบ', customerTaxId: '0994000123456', vatMode: 'add', subtotal: 1000, vatAmt: 70, total: 1070, taxPoint: 'payment', items: [{ product: 'บริการ', qty: 1, priceUnit: 1000, saleTotal: 1000, flowType: 'service' }] };
  assert.equal(tax.invoiceTaxPointAtPayment(invoice), true);
  const receipts = [{ no: 'RC690902', date: '2026-09-20', total: 357, invNo: 'INV690931', _branch: 'ubon' }, { no: 'RC690801', date: '2026-08-30', total: 356.67, invNo: 'INV690931', _branch: 'ubon' }, { no: 'RC691001', date: '2026-10-05', total: 356.33, invNo: 'INV690931', _branch: 'ubon' }];
  const points = tax.paymentTaxPoints(invoice, receipts);
  assert.deepEqual(points.map(p => [p.date, p.vat]), [['2026-08-30', 23.33], ['2026-09-20', 23.36], ['2026-10-05', 23.31]]);
  assert.equal(Math.round(points.reduce((s, p) => s + p.vat, 0) * 100), 7000);
  const sources = [{ branch: 'ubon', invoices: [invoice] }];
  const august = tax.buildSalesTaxReport({ period: '2026-08', sources, serviceReceipts: receipts, invoiceLookup: () => invoice, entryDate: () => '' });
  assert.deepEqual([august.rows.map(r => [r.kind, r.no, r.vat]), august.totals.vat, august.warnings.deferredService.length], [[['payment_tax_invoice', 'RC690801', 23.33]], 23.33, 1]);
  const september = tax.buildSalesTaxReport({ period: '2026-09', sources: [{ branch: 'ubon', invoices: [] }], serviceReceipts: receipts, invoiceLookup: () => invoice, entryDate: () => '' });
  assert.deepEqual(september.rows.map(r => [r.no, r.vat]), [['RC690902', 23.36]]);
  assert.throws(() => f.planInvoiceDocumentAction({ draft: { ...invoice, items: [{ product: 'จอ', qty: 1, priceUnit: 1000, saleTotal: 1000 }] } }), /บริการ/);
});

test('r13#MED-7 sample data: rent to a juristic landlord withheld 5 % → HQ ภ.ง.ด.53 Sept 18,714.95 / 735.75 (3 payees)', async () => {
  const seed = await imp('erp-demo-seed-core.js');
  const w = await imp('erp-payer-wht-core.js');
  const plan = seed.buildDemoSeedPlan({ today: '2026-10-25' });
  const certificates = plan.documents.filter(d => d.collection === 'whtCertificates' && d.branch === 'ubon').map(d => d.record);
  const pnd53 = w.buildWhtFormReport({ period: '2026-09', form: 'PND53', certificates });
  assert.deepEqual(pnd53.totals, { count: 3, payees: 3, amountPaid: 18714.95, taxWithheld: 735.75 });
  const rents = plan.documents.filter(d => d.collection === 'expenses' && d.record.cat === 'ค่าเช่าสถานที่').map(d => d.record);
  assert.ok(rents.length >= 7 && rents.every(r => r.whtEnabled === true && r.whtIncomeType === 'rent' && r.whtRate === 5), 'every rent payment withholds 5 %');
  assert.deepEqual(rents.filter(r => r.whtForm === 'PND3').map(r => r.desc), ['ค่าเช่าห้องเก็บสินค้า เดือนกันยายน (ผู้ให้เช่าเป็นบุคคลธรรมดา)'], 'only the person landlord is ภ.ง.ด.3; the building landlords are ภ.ง.ด.53');
  assert.ok(plan.documents.some(d => d.collection === 'expenses' && d.record.whtIncomeType === 'transport' && d.record.whtRate === 1), 'transport 1 %');
});

test('r13#MED-8 retention: the notice says 5 years (ม.87/3) and a weekly backup; the last backup time is kept for the reminder', async () => {
  const html = read('index.html');
  assert.match(html, /5 ปี \(มาตรา 87\/3\)/);
  assert.match(html, /id="erp-backup-reminder"/);
  const contracts = await imp('erp-storage-contracts.js');
  assert.equal(contracts.LAST_BACKUP_AT_KEY, 'erp_demo_last_backup_at');
  assert.match(read('erp-backup.js'), /renderBackupReminder/);
});

test('r13#MED-9 credit / debit note "other" reason needs a justification of at least 15 characters; discount wording is warned', async () => {
  const cn = await imp('erp-credit-note-core.js');
  assert.equal(cn.ADJUSTMENT_OTHER_MIN_CHARS, 15);
  assert.notEqual(cn.adjustmentOtherReasonCheck('อื่น ๆ', 'credit').error, '');
  assert.equal(cn.adjustmentOtherReasonCheck('ลูกค้าได้รับสินค้าล่าช้าตามสัญญาข้อ 5', 'debit').error, '');
  assert.ok(cn.adjustmentOtherReasonCheck('ให้ส่วนลดการค้าย้อนหลังตามยอดซื้อทั้งปี', 'credit').warnings.length >= 2);
  assert.match(cn.CREDIT_NOTE_REASONS.find(r => r.code === cn.CREDIT_NOTE_OTHER_REASON).label, /อธิบดีกำหนด/);
});

test('r13#LOW-1 government holidays move due dates: ภ.พ.30 Sept 2569 e-filing 23 → 26 Oct 2569 (วันปิยมหาราช)', async () => {
  const tax = await imp('erp-tax-reports-core.js');
  const due = tax.pp30DueDates('2026-09');
  assert.deepEqual([due.paper, due.efiling, due.efilingRolled], ['2026-10-15', '2026-10-26', true]);
  assert.match(tax.taxHolidayName('2026-10-23'), /ปิยมหาราช/);
  assert.equal(tax.taxHolidayYearStatus('2026-10-23'), 'official');
  assert.equal(tax.taxHolidayYearStatus('2028-01-01'), '', 'a year without a list is "unknown", never guessed');
  assert.equal(tax.rollTaxDueDate('2026-12-31') > '2026-12-31', true, 'วันสิ้นปี');
});

test('r13#LOW-2 VAT rate by date: 7 % until 30 Sep 2570 (พ.ร.ฎ. 807), unknown after — a warning, not a guess', async () => {
  const s = await imp('erp-shared-core.js');
  assert.deepEqual([s.vatRateOn('2026-10-25').rate, s.vatRateOn('2026-10-25').known, s.vatRateOn('2027-09-30').known], [0.07, true, true]);
  assert.equal(s.vatRateOn('2027-10-01').known, false);
  assert.equal(s.vatRateNotice('2026-10-25'), '');
  assert.match(s.vatRateNotice('2027-10-01'), /807|30 ก\.ย\. 2570/);
});

test('r13#LOW-3 a late claim month needs a reason (ประกาศฯ ฉบับที่ 4) and gives the endorsement text', async () => {
  const tax = await imp('erp-tax-reports-core.js');
  const draft = { docType: 'tax_invoice', vatMode: 'extract', amount: 2140, vendor: 'บจก. ไอทีซัพพลาย อีสาน', vendorTaxId: '0105558004044', vendorBranchCode: '00000', docNo: 'TI-1', taxInvoiceDate: '2026-07-10', taxInvoiceReceivedDate: '2026-07-11', claimPeriod: '2026-09', inputVatClaimable: true, date: '2026-07-10', taxStatus: 'received' };
  assert.equal(tax.planExpenseVatFields(draft).ok, false);
  assert.equal(tax.planExpenseVatFields({ ...draft, lateClaimReason: 'other', lateClaimNote: 'สั้น' }).ok, false);
  const ok = tax.planExpenseVatFields({ ...draft, lateClaimReason: 'trade_custom' });
  assert.equal(ok.ok, true, ok.error);
  assert.match(ok.warnings.join('\n'), /09\/2569/);
  assert.deepEqual([...tax.LATE_CLAIM_REASON_CODES], ['trade_custom', 'force_majeure', 'other']);
});

test('r13#LOW-4 filed ภ.พ.30 closes output / input VAT into 2141 and pays it; filed ภ.ง.ด. remits WHT', async () => {
  const j = await imp('erp-journal-core.js');
  const vatReturns = [{ id: 'r1', branchKey: 'ubon', branches: ['ubon'], period: '2026-09', amendment: 0, lines: { 5: 700, 7: 140, 8: 560, 9: 0, 11: 560 }, filedAt: '2026-10-20T03:00:00.000Z' }];
  const whtFilings = [{ id: 'w1', branch: 'ubon', period: '2026-09', form: 'PND3', amendment: 0, totals: { taxWithheld: 300 }, filedAt: '2026-10-06T03:00:00.000Z' }];
  const journal = j.buildJournal({ vatReturns, whtFilings });
  const [close] = only(journal, 'vat_close'), [pay] = only(journal, 'vat_payment'), [remit] = only(journal, 'wht_remit');
  assert.deepEqual([close.date, rows(close)], ['2026-09-30', [['output_vat', 'ubon', 70000, 0], ['input_vat', 'ubon', 0, 14000], ['vat_receivable', 'ubon', 0, 0], ['vat_payable', 'ubon', 0, 56000]].filter(r => r[2] || r[3])]);
  assert.deepEqual([pay.date, rows(pay)], ['2026-10-20', [['vat_payable', 'ubon', 56000, 0], ['bank', 'ubon', 0, 56000]]]);
  assert.deepEqual([remit.date, rows(remit)], ['2026-10-06', [['wht_pnd3', 'ubon', 30000, 0], ['bank', 'ubon', 0, 30000]]]);
  assert.deepEqual([...j.SETTLEMENT_KINDS].sort(), ['vat_close', 'vat_payment', 'wht_remit']);
});

test('r13#LOW-5 multi-period service: a straight-line deferred-revenue suggestion (nothing posted) + a warning on the invoice', async () => {
  const j = await imp('erp-journal-core.js');
  const f = await imp('erp-document-finance-core.js');
  const invoice = { id: 5, no: 'INV690905', date: '2026-09-01', branch: 'ubon', customer: 'รพ.ทดสอบ', vatMode: 'add', subtotal: 12000, vatAmt: 840, total: 12840, items: [{ product: 'MA 12 เดือน', qty: 1, priceUnit: 12000, saleTotal: 12000, flowType: 'service' }], servicePeriodFrom: '2026-09-01', servicePeriodTo: '2027-08-31' };
  const [row] = j.deferredRevenueRows([invoice], '2026-09-30');
  assert.deepEqual([row.days, row.remainingDays, row.valueSatang, row.unearnedSatang], [365, 335, 1200000, Math.floor((1200000 * 335 * 2 + 365) / 730)]);
  assert.equal(row.unearnedSatang, 1101370, '12,000 × 335 / 365 = 11,013.70');
  assert.ok(f.planInvoiceDocumentAction({ draft: invoice }).warnings.includes(f.SERVICE_PERIOD_WARNING));
  assert.throws(() => f.planInvoiceDocumentAction({ draft: { ...invoice, servicePeriodTo: '2026-08-01' } }), /ระยะเวลาให้บริการ/);
});

test('r13#LOW-6 a job\'s direct cost credits 2181 accrued job costs; the expense that pays it clears the accrual (no double cost)', async () => {
  const j = await imp('erp-journal-core.js');
  const seed = await imp('erp-demo-seed-core.js');
  const plan = seed.buildDemoSeedPlan({ today: '2026-10-25' });
  const jc = seed.demoSeedJobCosts(plan);
  const of = col => plan.documents.filter(d => d.collection === col).map(d => ({ ...d.record, _branch: d.branch, branch: d.branch }));
  const journal = j.buildJournal({ invoices: of('invoices'), receipts: of('receipts'), creditNotes: of('creditNotes'), debitNotes: of('debitNotes'), expenses: of('expenses'), certificates: of('whtCertificates'), payments: plan.flow.payments, goodsReceipts: plan.costing.goodsReceipts, costing: jc.result, sheets: jc.sheets, jobEntries: plan.costing.jobStore.entries, options: { today: '2026-10-25' } });
  const other = only(journal, 'job_other');
  assert.ok(other.length >= 2);
  assert.ok(other.every(e => e.lines.some(l => l.account === 'job_cost_accrued' && l.credit > 0)));
  const linked = of('expenses').filter(e => e.jobEntryId);
  assert.ok(linked.length >= 2, 'J1 subcontract + J3 crane');
  for (const e of linked) assert.ok(journal.entries.find(x => x.kind === 'expense' && x.docId === String(e.id)).lines.some(l => l.account === 'job_cost_accrued' && l.debit > 0), e.desc);
  assert.equal(journal.flags.filter(f => f.code === 'job_link_missing').length, 0);
  // 2181 = the job direct costs not paid yet: 1,500 (J1) + 1,600 (J3) paid, PD690902's 1,200 still owed → Cr 1,200.00.
  assert.deepEqual(j.accountBalances(journal.entries, { branch: 'all' }).get('job_cost_accrued'), { opening: 0, debit: 310000, credit: 430000, closing: -120000 });
});

test('r13#LOW-7 month-end pack: WHT received (50 ทวิ from customers), follow-ups and the accountant checklist incl. retention', async () => {
  const src = read('erp-journal.js');
  for (const sheet of ['whtReceived', 'followUp', 'checklist']) assert.match(src, new RegExp(`sheet\\.${sheet}`), sheet);
  const en = read('i18n/en-journal.js');
  for (const key of ['sheet.whtReceived', 'sheet.followUp', 'sheet.checklist', 'checklist.retention', 'checklist.whtReceived']) assert.match(en, new RegExp(`'${key.replace('.', '\\.')}'`), key);
});

test('r13#LOW-8 ADR-023: the ภ.พ.30 carry-forward is line 10 (ภาษีที่ชำระเกินยกมา), not line 9', () => {
  const adr = read('docs/decisions/ADR-023-vat-reports-and-pp30.md');
  assert.match(adr, /Line 10 \("ภาษีที่ชำระเกินยกมา"\) is the\s+carry-forward/);
  assert.doesNotMatch(adr, /Line 9 is the carry-forward/);
});

test('r13#LANG-plural "1 items" → "1 item" in English (1 / 2 / 11 / 21 and decimals untouched)', async () => {
  const i = await imp('erp-i18n-core.js');
  assert.equal(i.singularizeCounts('1 items · 2 items · 11 items · 21 items'), '1 item · 2 items · 11 items · 21 items');
  assert.equal(i.singularizeCounts('1.5 days, 0.1 days'), '1.5 days, 0.1 days');
  assert.equal(i.singularizeCounts('1 documents'), '1 document');
});

test('r13#LANG-fixes the language audit fixes are in the source (fixes.json: new text present, replaced text gone)', () => {
  const fixesPath = '/tmp/claude-0/audit-lang/fixes.json';
  if (!fs.existsSync(fixesPath)) return; // the audit file is outside the project; r13#LANG-print (app) covers the result
  const fixes = JSON.parse(fs.readFileSync(fixesPath, 'utf8'));
  let applied = 0, deleted = 0;
  for (const fix of fixes) {
    const file = path.join(ROOT, fix.file);
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    if (fix.kind === 'dict-delete') { if (!source.includes(fix.old)) deleted++; continue; }
    if (typeof fix.new === 'string' && fix.new && source.includes(fix.new) && (fix.new.includes(fix.old) || !source.includes(fix.old))) applied++;
  }
  assert.ok(applied + deleted >= 200, `fixes verified in the source: ${applied} replaced + ${deleted} deleted of ${fixes.length}`);
});
