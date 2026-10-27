// ADR-029 (round 12) — erp-journal-core.js (pure): the derived journal. Every posting type is checked against entries
// worked by hand (satang); a random-document fuzz keeps Dr = Cr for every entry and every establishment; a cancelled
// document is reversed on its cancel date (Bangkok business date) and the original never changes; the period lock over
// derived entries; cost of sales = the costing engine; the trial balance = Σ ledgers; the September story month ties
// to ภ.พ.30 L5 / L7 and ภ.ง.ด.3 / 53 for HQ, branch, combined and one-branch mode on many load dates; the opening
// import, manual entries, overhead close, NRV, CSV, PEAK mapping and the strict stores.
// Every test here fails on round11-cost (no erp-journal-core.js: /tmp/claude-0/r12-newtests-on-base.log).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const imp = file => import(pathToFileURL(path.join(ROOT, file)).href);
const J = () => imp('erp-journal-core.js');
// An entry as [account, branch, debit, credit] rows (satang), in posting order.
const rows = entry => entry.lines.map(line => [line.account, line.branch, line.debit, line.credit]);
const only = (journal, kind) => journal.entries.filter(entry => entry.kind === kind);
const sum = (entries, key) => entries.reduce((total, entry) => total + entry.lines.reduce((s, line) => s + line[key], 0), 0);
const balanced = entries => { for (const entry of entries) assert.equal(sum([entry], 'debit'), sum([entry], 'credit'), entry.id); };

// ---------------------------------------------------------------- hand-worked documents
const credit = (extra = {}) => ({ id: 101, no: 'INV690901', date: '2026-09-05', customer: 'รพ.ทดสอบ', vatMode: 'add', subtotal: 10000, vatAmt: 700, total: 10700, items: [{ product: 'สินค้า', qty: 1, priceUnit: 10000, saleTotal: 10000 }], _branch: 'ubon', ...extra });

test('jcore#1 credit tax invoice: Dr AR 10,700 / Cr sales 10,000, Cr output VAT 700; goods + service split by line value', async () => {
  const j = await J();
  const journal = j.buildJournal({ invoices: [credit()] });
  const [entry] = only(journal, 'invoice');
  assert.deepEqual(rows(entry), [['ar', 'ubon', 1070000, 0], ['sales_goods', 'ubon', 0, 1000000], ['output_vat', 'ubon', 0, 70000]]);
  assert.equal(entry.lines[0].ref.key, 'inv|ubon|101', 'the AR line is an open item of the invoice');
  // 6,000 goods + 4,000 service (flowType service): revenue split exactly by the line values.
  const mixed = j.buildJournal({ invoices: [credit({ items: [{ qty: 1, priceUnit: 6000, saleTotal: 6000 }, { qty: 1, priceUnit: 4000, saleTotal: 4000, flowType: 'service' }] })] });
  assert.deepEqual(rows(only(mixed, 'invoice')[0]), [['ar', 'ubon', 1070000, 0], ['sales_goods', 'ubon', 0, 600000], ['sales_service', 'ubon', 0, 400000], ['output_vat', 'ubon', 0, 70000]]);
  // VAT exempt / no VAT: no output-VAT line at all.
  const exempt = j.buildJournal({ invoices: [credit({ vatMode: 'none', vatAmt: 0, total: 3500, subtotal: 3500, items: [{ qty: 1, priceUnit: 3500 }] })] });
  assert.deepEqual(rows(only(exempt, 'invoice')[0]), [['ar', 'ubon', 350000, 0], ['sales_goods', 'ubon', 0, 350000]]);
});

test('jcore#2 cash sale (ใบกำกับภาษีอย่างย่อ, VAT included): Dr cash 1,070 / Cr sales 1,000, VAT 70; its receipt is not new money', async () => {
  const j = await J();
  const sale = credit({ id: 7, no: 'ABB-01', taxInvoiceForm: 'abbreviated', vatMode: 'extract', subtotal: 1000, vatAmt: 70, total: 1070, customer: 'ลูกค้าทั่วไป' });
  const journal = j.buildJournal({ invoices: [sale], receipts: [{ id: 'r1', no: 'RC-1', date: '2026-09-05', invoiceId: 7, invNo: 'ABB-01', total: 1070, _branch: 'ubon' }] });
  assert.deepEqual(rows(only(journal, 'cash_sale')[0]), [['cash', 'ubon', 107000, 0], ['sales_goods', 'ubon', 0, 100000], ['output_vat', 'ubon', 0, 7000]]);
  assert.equal(only(journal, 'receipt').length, 0, 'the receipt of a cash sale is its slip');
  // The configurable default: the company says cash sales go to the bank.
  const settings = j.normalizeJournalSettings({ schemaVersion: 1, posting: { cashSaleAccount: 'bank' } });
  assert.equal(only(j.buildJournal({ invoices: [sale], settings }), 'cash_sale')[0].lines[0].account, 'bank');
});

test('jcore#3 receipt with WHT deducted by the customer: Dr bank 10,400 + WHT prepaid 300 / Cr AR 10,700 — default account flagged', async () => {
  const j = await J();
  const journal = j.buildJournal({ invoices: [credit()], receipts: [{ id: 'r1', no: 'RC690901', date: '2026-09-20', invoiceId: 101, invNo: 'INV690901', total: 10700, whtAmount: 300, cashReceived: 10400, _branch: 'ubon' }] });
  const [entry] = only(journal, 'receipt');
  assert.deepEqual(rows(entry), [['bank', 'ubon', 1040000, 0], ['wht_prepaid', 'ubon', 30000, 0], ['ar', 'ubon', 0, 1070000]]);
  assert.deepEqual(entry.flags, ['default_receipt_account'], 'the receipt does not say which account: the default + a flag, never a silent guess');
  assert.deepEqual(j.openItems(journal.entries, 'ar', { to: '2026-09-30' }), [], 'the invoice is settled');
  // An order-flow payment says its method: โอนเงิน → bank, no flag; one billing payment can settle two invoices.
  const two = j.buildJournal({ invoices: [credit(), credit({ id: 102, no: 'INV690902', subtotal: 2000, vatAmt: 140, total: 2140 })], payments: [{ id: 'p1', no: 'PAY-1', date: '2026-09-25', branch: 'ubon', method: 'โอนเงิน', amount: 12840, allocations: [{ invoiceId: 101, invoiceNo: 'INV690901', branch: 'ubon', amount: 10700 }, { invoiceId: 102, invoiceNo: 'INV690902', branch: 'ubon', amount: 2140 }] }] });
  const [pay] = only(two, 'payment');
  assert.deepEqual(rows(pay), [['ar', 'ubon', 0, 1070000], ['ar', 'ubon', 0, 214000], ['bank', 'ubon', 1284000, 0]]);
  assert.deepEqual(pay.flags, []);
  // A receipt of another establishment's invoice: each establishment balances through the inter-branch account.
  const cross = j.buildJournal({ invoices: [credit()], receipts: [{ id: 'r2', no: 'RC-K1', date: '2026-09-21', invoiceId: 101, invNo: 'INV690901', invoiceBranch: 'ubon', total: 10700, _branch: 'khonkaen' }] });
  assert.deepEqual(rows(only(cross, 'receipt')[0]), [['bank', 'khonkaen', 1070000, 0], ['ar', 'ubon', 0, 1070000], ['inter_branch', 'khonkaen', 0, 1070000], ['inter_branch', 'ubon', 1070000, 0]]);
});

test('jcore#4 credit note reverses sales + VAT (Dr returns 1,000, VAT 70 / Cr AR 1,070); debit note adds (Dr AR / Cr revenue, VAT)', async () => {
  const j = await J();
  const cn = { id: 'cn1', no: 'CN690901', date: '2026-09-15', customer: 'รพ.ทดสอบ', subtotal: 1000, vatAmt: 70, total: 1070, lines: [{ invoiceId: 101, invoiceNo: 'INV690901', total: 1070 }], _branch: 'ubon' };
  const dn = { id: 'dn1', no: 'DN690901', date: '2026-09-16', customer: 'รพ.ทดสอบ', subtotal: 1500, vatAmt: 105, total: 1605, lines: [{ invoiceId: 101, invoiceNo: 'INV690901', total: 1605 }], _branch: 'ubon' };
  const journal = j.buildJournal({ invoices: [credit()], creditNotes: [cn], debitNotes: [dn] });
  assert.deepEqual(rows(only(journal, 'credit_note')[0]), [['sales_returns', 'ubon', 100000, 0], ['output_vat', 'ubon', 7000, 0], ['ar', 'ubon', 0, 107000]]);
  assert.deepEqual(rows(only(journal, 'debit_note')[0]), [['sales_debit', 'ubon', 0, 150000], ['output_vat', 'ubon', 0, 10500], ['ar', 'ubon', 160500, 0]]);
  const [item] = j.openItems(journal.entries, 'ar', { to: '2026-09-30' });
  assert.equal(item.balance, 1070000 - 107000 + 160500, 'the invoice item: 10,700 − 1,070 + 1,605');
  // A credit note on a cash sale is a refund: paid from the configured refund account (flagged).
  const sale = credit({ id: 7, no: 'ABB-01', taxInvoiceForm: 'abbreviated', vatMode: 'extract' });
  const refund = j.buildJournal({ invoices: [sale], creditNotes: [{ ...cn, lines: [{ invoiceId: 7, invoiceNo: 'ABB-01', total: 1070 }] }] });
  const [entry] = only(refund, 'credit_note');
  assert.deepEqual(rows(entry).slice(-1)[0], ['cash', 'ubon', 0, 107000]);
  assert.deepEqual(entry.flags, ['refund_account']);
});

test('jcore#5 expenses: claimable VAT, non-claimable VAT in the expense, WHT PND3 / PND53, VAT claimed next month, paid-from default flagged', async () => {
  const j = await J();
  const base = { id: 'e1', date: '2026-09-10', vendor: 'บจก. บริการ', desc: 'ค่าบริการ', cat: 'ค่าขนส่ง/จัดส่ง', vatMode: 'add', docType: 'tax_invoice', inputVatClaimable: true, subtotal: 10000, vatAmt: 700, amount: 10700, _branch: 'ubon' };
  // 10,000 + VAT 700, WHT 3 % = 300 (ภ.ง.ด.53): Dr freight 10,000, input VAT 700 / Cr WHT 53 300, Cr bank 10,400.
  const wht = j.buildJournal({ expenses: [{ ...base, whtEnabled: true, whtAmount: 300, whtForm: 'PND53', netPaid: 10400 }] });
  const [entry] = only(wht, 'expense');
  assert.deepEqual(rows(entry), [['exp_freight', 'ubon', 1000000, 0], ['input_vat', 'ubon', 70000, 0], ['wht_pnd53', 'ubon', 0, 30000], ['bank', 'ubon', 0, 1040000]]);
  assert.deepEqual(entry.flags, ['default_payment_account', 'wht_certificate_missing']);
  assert.equal(entry.memo, 'ค่าบริการ', 'the typed description is user data (memo), never translated');
  // ภ.ง.ด.3 with the WHT borne by the company (gross-up): Dr rent 6,000 + WHT borne 300 / Cr WHT 3 300, bank 6,000.
  const borne = j.buildJournal({ expenses: [{ ...base, id: 'e2', cat: 'ค่าเช่าสถานที่', vatMode: 'none', docType: 'receipt', inputVatClaimable: false, subtotal: 6000, vatAmt: 0, amount: 6000, whtEnabled: true, whtAmount: 300, whtPayerBorne: 300, whtForm: 'PND3' }] });
  assert.deepEqual(rows(only(borne, 'expense')[0]), [['exp_rent', 'ubon', 600000, 0], ['exp_wht_borne', 'ubon', 30000, 0], ['wht_pnd3', 'ubon', 0, 30000], ['bank', 'ubon', 0, 600000]]);
  // VAT not claimable (ใบกำกับภาษีอย่างย่อ): the 35 stays in the expense — 535 to office supplies.
  const abbreviated = j.buildJournal({ expenses: [{ ...base, id: 'e3', cat: 'ค่าอุปกรณ์สำนักงาน', docType: 'abbreviated_tax_invoice', inputVatClaimable: false, subtotal: 500, vatAmt: 35, amount: 535 }] });
  assert.deepEqual(rows(only(abbreviated, 'expense')[0]), [['exp_office', 'ubon', 53500, 0], ['bank', 'ubon', 0, 53500]]);
  // Claimed in October (ม.82/3): Sept → "not yet claimable"; 1 Oct the reclass → input VAT. Each month = ภ.พ.30 L7.
  const later = j.buildJournal({ expenses: [{ ...base, id: 'e4', claimPeriod: '2026-10' }] });
  assert.deepEqual(rows(only(later, 'expense')[0]).slice(0, 2), [['exp_freight', 'ubon', 1000000, 0], ['input_vat_undue', 'ubon', 70000, 0]]);
  const [reclass] = only(later, 'vat_reclass');
  assert.equal(reclass.date, '2026-10-01');
  assert.deepEqual(rows(reclass), [['input_vat', 'ubon', 70000, 0], ['input_vat_undue', 'ubon', 0, 70000]]);
  assert.equal(j.movement(later.entries, ['input_vat'], { ...j.periodRange('2026-09'), branch: 'ubon' }), 0);
  assert.equal(j.movement(later.entries, ['input_vat'], { ...j.periodRange('2026-10'), branch: 'ubon' }), 70000);
  // A received credit note reverses; a category the chart does not know goes to other expenses — flagged; on credit (AP).
  const settings = j.normalizeJournalSettings({ schemaVersion: 1, posting: { expensePaidFrom: 'ap' } });
  const odd = j.buildJournal({ settings, expenses: [{ ...base, id: 'e5', cat: 'หมวดใหม่', docType: 'credit_note_received' }] });
  const [back] = only(odd, 'expense');
  assert.deepEqual(rows(back), [['exp_other', 'ubon', 0, 1000000], ['input_vat', 'ubon', 0, 70000], ['ap', 'ubon', 1070000, 0]]);
  assert.ok(back.flags.includes('unknown_category'));
  // The company maps the category to marketing: the same document now posts there (derived, never hand-edited).
  const mapped = j.normalizeJournalSettings({ schemaVersion: 1, categories: { 'หมวดใหม่': 'exp_marketing' } });
  assert.equal(only(j.buildJournal({ settings: mapped, expenses: [{ ...base, id: 'e5', cat: 'หมวดใหม่' }] }), 'expense')[0].lines[0].account, 'exp_marketing');
});

test('jcore#6 a cancelled document is reversed on its cancel date (Bangkok) — a tax document cancelled in a later month is reversed in its own month (r13#MED-3); the original entry is not touched; Dr = Cr or it throws', async () => {
  const j = await J();
  const live = j.buildJournal({ invoices: [credit()] });
  // Cancelled at 20:30 UTC on 25 Sept = 03:30 on 26 Sept in Bangkok → the reversal is dated 26 Sept (same tax month).
  const sameMonth = j.buildJournal({ invoices: [credit({ status: 'cancelled', voided: true, voidedAt: '2026-09-25T20:30:00.000Z' })] });
  assert.equal(sameMonth.entries.find(entry => entry.reversalOf).date, '2026-09-26');
  // Cancelled on 3 Oct (Bangkok) for a September tax invoice: like รายงานภาษีขาย (the cancelled invoice shows 0 in its
  // own month, ป.86/2542 ข้อ 10–11) the reversal sits on 30 Sept, flagged (an amended ภ.พ.30 may be needed).
  const cancelled = j.buildJournal({ invoices: [credit({ status: 'cancelled', voided: true, voidedAt: '2026-10-02T20:30:00.000Z' })] });
  const [original] = only(cancelled, 'invoice').filter(entry => !entry.reversalOf);
  const [reversal] = only(cancelled, 'invoice').filter(entry => entry.reversalOf);
  assert.deepEqual(original, only(live, 'invoice')[0], 'the original entry is identical to the live one');
  assert.equal(reversal.date, '2026-09-30');
  assert.deepEqual(reversal.flags, ['cancel_backdated']);
  assert.equal(cancelled.flags.find(flag => flag.code === 'cancel_backdated').params.cancelDate, '2026-10-03');
  assert.equal(reversal.reversalOf, original.id);
  assert.deepEqual(rows(reversal), [['ar', 'ubon', 0, 1070000], ['sales_goods', 'ubon', 1000000, 0], ['output_vat', 'ubon', 0 + 70000, 0]]);
  assert.equal(j.movement(cancelled.entries, ['output_vat'], j.periodRange('2026-09')), 0, 'September nets to zero, as its sales tax report');
  assert.equal(j.movement(cancelled.entries, ['output_vat'], j.periodRange('2026-10')), 0, 'October is untouched');
  // Without a cancel time: reversed on the document date, flagged.
  const unknown = j.buildJournal({ invoices: [credit({ status: 'cancelled' })] });
  const rev = unknown.entries.find(entry => entry.reversalOf);
  assert.equal(rev.date, '2026-09-05');
  assert.deepEqual(rev.flags, ['void_date_unknown']);
  // Receipts and credit notes too.
  const receipt = j.buildJournal({ invoices: [credit()], receipts: [{ id: 'r1', no: 'RC1', date: '2026-09-20', invoiceId: 101, total: 10700, voided: true, voidedAt: '2026-09-22T03:00:00Z', _branch: 'ubon' }] });
  assert.deepEqual(only(receipt, 'receipt').map(entry => entry.date), ['2026-09-20', '2026-09-22']);
  // An unbalanced manual document is refused by the store and by the generator.
  assert.throws(() => j.normalizeJournalDocuments({ schemaVersion: 1, manual: [{ id: 'm1', no: 'JV1', date: '2026-09-01', branch: 'ubon', memo: '', status: 'posted', lines: [{ account: 'cash', debit: 100, credit: 0 }, { account: 'bank', debit: 0, credit: 99 }] }] }), /เดบิตไม่เท่าเครดิต/);
  // The generator's own check (every entry goes through it): Dr ≠ Cr throws, and so does Dr = Cr that is unbalanced
  // inside one establishment once the inter-branch lines are in.
  const entry = (lines) => ({ id: 'x', date: '2026-09-01', branch: 'ubon', lines: lines.map(([account, branch, debit, credit]) => ({ account, branch, debit, credit })) });
  assert.throws(() => j.finalizeEntry(entry([['cash', 'ubon', 100, 0], ['bank', 'ubon', 0, 99]])), error => error instanceof j.JournalBalanceError);
  assert.throws(() => j.finalizeEntry(entry([['cash', 'ubon', 100, 100]])), error => error instanceof j.JournalBalanceError);
  assert.throws(() => j.finalizeEntry(entry([['cash', 'ubon', 1.5, 0], ['bank', 'ubon', 0, 1.5]])), error => error instanceof j.JournalBalanceError);
  assert.deepEqual(rows(j.finalizeEntry(entry([['cash', 'ubon', 100, 0], ['bank', 'khonkaen', 0, 100]]))), [['cash', 'ubon', 100, 0], ['bank', 'khonkaen', 0, 100], ['inter_branch', 'ubon', 0, 100], ['inter_branch', 'khonkaen', 100, 0]]);
});

test('jcore#7 fuzz: 400 random documents (both establishments, cancels, WHT, CN / DN, payments) → every entry and establishment Dr = Cr; TB = Σ ledgers', async () => {
  const j = await J();
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = list => list[Math.floor(rnd() * list.length)];
  const money = max => Math.round(rnd() * max * 100) / 100;
  const day = () => `2026-${pick(['08', '09', '10'])}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`;
  const invoices = [];
  const receipts = [];
  const creditNotes = [];
  const debitNotes = [];
  const expenses = [];
  const payments = [];
  for (let i = 0; i < 400; i += 1) {
    const branch = pick(['ubon', 'khonkaen']);
    const kind = pick(['inv', 'inv', 'cash', 'rcp', 'cn', 'dn', 'exp', 'exp', 'pay']);
    if (kind === 'inv' || kind === 'cash') {
      const subtotal = money(50000);
      const vatMode = pick(['add', 'none', 'extract']);
      const vat = vatMode === 'none' ? 0 : Math.round(subtotal * 7) / 100;
      invoices.push({ id: `i${i}`, no: `INV${i}`, date: day(), customer: `C${i % 7}`, vatMode, taxInvoiceForm: kind === 'cash' ? 'abbreviated' : 'full', subtotal, vatAmt: vat, total: Math.round((subtotal + vat) * 100) / 100, items: [{ qty: 1, priceUnit: subtotal, flowType: rnd() < 0.3 ? 'service' : 'inventory' }], status: rnd() < 0.1 ? 'cancelled' : 'issued', voidedAt: rnd() < 0.5 ? '2026-10-15T01:00:00Z' : '', _branch: branch });
    } else if (kind === 'rcp' && invoices.length) {
      const inv = pick(invoices);
      receipts.push({ id: `r${i}`, no: `RC${i}`, date: day(), invoiceId: inv.id, invNo: inv.no, invoiceBranch: inv._branch, total: inv.total, whtAmount: rnd() < 0.3 ? Math.round(inv.subtotal * 3) / 100 : 0, voided: rnd() < 0.05, _branch: branch });
    } else if ((kind === 'cn' || kind === 'dn') && invoices.length) {
      const inv = pick(invoices);
      const subtotal = money(2000);
      const vat = Math.round(subtotal * 7) / 100;
      (kind === 'cn' ? creditNotes : debitNotes).push({ id: `${kind}${i}`, no: `${kind}${i}`, date: day(), subtotal, vatAmt: vat, total: Math.round((subtotal + vat) * 100) / 100, lines: [{ invoiceId: inv.id, invoiceNo: inv.no, invoiceBranch: inv._branch, total: Math.round((subtotal + vat) * 100) / 100 }], status: rnd() < 0.1 ? 'voided' : 'issued', voidedAt: '2026-10-20T10:00:00Z', _branch: branch });
    } else if (kind === 'exp') {
      const subtotal = money(30000);
      const hasVat = rnd() < 0.6;
      const vat = hasVat ? Math.round(subtotal * 7) / 100 : 0;
      const wht = rnd() < 0.4 ? Math.round(subtotal * pick([1, 3, 5])) / 100 : 0;
      expenses.push({ id: `e${i}`, date: day(), cat: pick(['ค่าเช่าสถานที่', 'ค่าขนส่ง/จัดส่ง', 'อื่น ๆ', 'ใหม่']), vendor: 'V', vatMode: hasVat ? 'add' : 'none', docType: pick(['tax_invoice', 'receipt', 'credit_note_received', 'abbreviated_tax_invoice']), inputVatClaimable: hasVat && rnd() < 0.8, claimPeriod: pick(['', '2026-10', '2026-11']), subtotal, vatAmt: vat, amount: Math.round((subtotal + vat) * 100) / 100, whtEnabled: wht > 0, whtAmount: wht, whtPayerBorne: rnd() < 0.2 ? wht : 0, whtForm: pick(['PND3', 'PND53', '']), _branch: branch });
    } else if (kind === 'pay' && invoices.length) {
      const a = pick(invoices);
      const b = pick(invoices);
      payments.push({ id: `p${i}`, no: `PAY${i}`, date: day(), branch, method: pick(['โอนเงิน', 'เงินสด', 'เช็ค', 'อื่น']), allocations: [{ invoiceId: a.id, invoiceNo: a.no, branch: a._branch, amount: a.total }, { invoiceId: b.id, invoiceNo: b.no, branch: b._branch, amount: Math.round(b.total * 50) / 100 }], voided: rnd() < 0.05, voidedAt: '2026-10-22T09:00:00Z' });
    }
  }
  const journal = j.buildJournal({ invoices, receipts, creditNotes, debitNotes, expenses, payments });
  assert.ok(journal.entries.length > 300, `${journal.entries.length} entries`);
  for (const entry of journal.entries) {
    assert.equal(sum([entry], 'debit'), sum([entry], 'credit'), entry.id);
    for (const branch of ['ubon', 'khonkaen']) {
      const lines = entry.lines.filter(line => line.branch === branch);
      assert.equal(lines.reduce((s, l) => s + l.debit, 0), lines.reduce((s, l) => s + l.credit, 0), `${entry.id} ${branch}`);
    }
    for (const line of entry.lines) assert.ok(Number.isSafeInteger(line.debit) && Number.isSafeInteger(line.credit) && (line.debit === 0) !== (line.credit === 0), entry.id);
  }
  const chart = j.effectiveChart();
  for (const period of ['2026-08', '2026-09', '2026-10']) {
    for (const branch of ['ubon', 'khonkaen', 'all']) {
      const filter = { ...j.periodRange(period), branch };
      const tb = j.trialBalance(journal.entries, filter, chart);
      assert.equal(tb.balanced, true, `${period} ${branch}`);
      for (const row of tb.rows) {
        const ledger = j.generalLedger(journal.entries, filter, chart, row.code);
        assert.deepEqual([ledger.opening, ledger.debit, ledger.credit, ledger.closing], [row.opening, row.debit, row.credit, row.closing], `${period} ${branch} ${row.code}`);
        if (ledger.rows.length) assert.equal(ledger.rows[ledger.rows.length - 1].balance, ledger.closing);
      }
    }
  }
  // The inter-branch account nets to zero for the company.
  assert.equal(j.accountBalances(journal.entries, { branch: 'all' }).get('inter_branch')?.closing || 0, 0);
});

test('jcore#8 stock and job costs from the costing engine: opening, goods receipt (Dr inventory / Cr AP), COGS = the engine, WIP → COGS', async () => {
  const j = await J();
  const c = await imp('erp-costing-core.js');
  const products = [{ code: 'A', name: 'สินค้า A', flowType: 'inventory', fulfillmentType: 'stock', standardCost: 100, openingStockUbon: 10, openingStockKhonkaen: 0 }];
  const sale = { id: 1, no: 'INV1', date: '2026-01-10', customer: 'X', vatMode: 'add', subtotal: 2000, vatAmt: 140, total: 2140, items: [{ productCode: 'A', product: 'สินค้า A', qty: 5, priceUnit: 400 }], branch: 'ubon', _branch: 'ubon' };
  const built = c.buildCostingMovements({ products, stockMovements: [{ id: 1, kind: 'receipt', qty: 10, date: '2026-01-05', productCode: 'A', branch: 'ubon', unitCost: 130, refId: 'GR1', refNo: 'GR6901-01', createdAt: '2026-01-01T00:00:01Z' }], invoices: [sale] });
  const result = c.runCosting(built.groups, { settings: { method: 'moving_average' }, fallbackUc: built.fallbackUc });
  const journal = j.buildJournal({ invoices: [sale], costing: result, goodsReceipts: [{ id: 'GR1', no: 'GR6901-01', date: '2026-01-05', supplier: 'บจก. ผู้ขาย' }] });
  // Opening 10 × 100 = 1,000 on the day before the first entry; receipt 10 × 130 = 1,300 → average 115; sale 5 × 115 = 575.
  const [opening] = only(journal, 'opening');
  assert.equal(opening.date, '2026-01-04');
  assert.deepEqual(rows(opening), [['inventory', 'ubon', 100000, 0], ['opening_equity', 'ubon', 0, 100000]]);
  const [gr] = only(journal, 'goods_receipt');
  assert.deepEqual(rows(gr), [['inventory', 'ubon', 130000, 0], ['ap', 'ubon', 0, 130000]]);
  assert.equal(gr.party, 'บจก. ผู้ขาย');
  const [cogs] = only(journal, 'cogs');
  assert.deepEqual(rows(cogs), [['inventory', 'ubon', 0, 57500], ['cogs', 'ubon', 57500, 0]]);
  assert.equal(c.cogsByInvoiceLine(result).get('ubon|1|0').value, 57500, 'the same cost as the costing engine');
  assert.equal(j.accountBalances(journal.entries, { to: '2026-01-31', branch: 'ubon' }).get('inventory').closing, c.valuationTotal(c.valuationAt(result, '2026-01-31', { branch: 'ubon' })));
  // The sample's jobs: labour + overhead applied (Dr WIP / Cr applied), other costs, materials, completion → COGS; WIP 0.
  const seedCore = await imp('erp-demo-seed-core.js');
  const plan = seedCore.buildDemoSeedPlan({ today: '2026-10-21' });
  const jc = seedCore.demoSeedJobCosts(plan);
  const of = col => plan.documents.filter(d => d.collection === col).map(d => ({ ...d.record, _branch: d.branch, branch: d.branch }));
  const story = j.buildJournal({ invoices: of('invoices'), creditNotes: of('creditNotes'), costing: jc.result, sheets: jc.sheets, jobEntries: plan.costing.jobStore.entries, goodsReceipts: plan.costing.goodsReceipts });
  const j1 = jc.jobs.find(job => job.no === plan.expected.jobs.J1.no);
  const wipJ1 = story.entries.flatMap(entry => entry.lines).filter(line => line.account === 'wip' && line.jobKey === j1.key);
  // Into WIP: materials issued 20,700 + labour 7,120 + overhead 3,000 + subcontract 1,500 = 32,320; out: the returned
  // cable 3,200 and the completion 29,120 (the job cost) → WIP 0.
  assert.equal(wipJ1.reduce((s, l) => s + l.debit, 0), 3232000);
  assert.deepEqual(wipJ1.filter(l => l.credit).map(l => l.credit).sort((a, b) => a - b), [320000, 2912000]);
  assert.equal(wipJ1.reduce((s, l) => s + l.debit - l.credit, 0), 0, 'and out to cost of sales at completion');
  const complete = story.entries.find(entry => entry.kind === 'job_complete' && entry.lines.some(line => line.jobKey === j1.key));
  assert.deepEqual(rows(complete), [['cogs', 'ubon', 2912000, 0], ['wip', 'ubon', 0, 2912000]]);
  const labour = story.entries.filter(entry => entry.kind === 'job_labour');
  assert.ok(labour.every(entry => entry.lines[0].account === 'wip' && entry.lines.some(line => line.account === 'overhead_applied' && line.credit > 0)));
  // COGS of every sold stock line = the engine's cost of that line (sum over the story).
  const engine = [...c.cogsByInvoiceLine(jc.result).values()].reduce((s, row) => s + row.value, 0);
  const booked = story.entries.filter(entry => entry.kind === 'cogs').reduce((s, entry) => s + entry.lines.filter(line => line.account === 'cogs').reduce((t, line) => t + line.debit - line.credit, 0), 0);
  assert.equal(booked, engine);
  assert.deepEqual([...j.sheetWipAsOf(jc.sheets, '2026-10-21').values()].filter(Boolean), []);
});

// ---------------------------------------------------------------- the story month ties (pure seed, many load dates)
const periodOfRow = d => `${d.year}-${String(d.month + 1).padStart(2, '0')}`;
async function story(today, branchCount) {
  const seedCore = await imp('erp-demo-seed-core.js');
  const j = await J();
  const plan = seedCore.buildDemoSeedPlan({ today, branchCount });
  const of = col => plan.documents.filter(d => d.collection === col).map(d => ({ ...d.record, _branch: d.branch, branch: d.branch }));
  const jc = seedCore.demoSeedJobCosts(plan);
  const journal = j.buildJournal({ invoices: of('invoices'), receipts: of('receipts'), creditNotes: of('creditNotes'), debitNotes: of('debitNotes'), expenses: of('expenses'), certificates: of('whtCertificates'), payments: plan.flow.payments, goodsReceipts: plan.costing.goodsReceipts, costing: jc.result, sheets: jc.sheets, jobEntries: plan.costing.jobStore.entries, options: { today } });
  return { plan, journal, jc };
}
async function taxOf(plan, branches) {
  const tax = await imp('erp-tax-reports-core.js');
  const wht = await imp('erp-payer-wht-core.js');
  const period = plan.storyPeriod;
  const docs = plan.documents.filter(d => branches.includes(d.branch));
  const of = (branch, col) => docs.filter(d => d.branch === branch && d.collection === col && periodOfRow(d) === period).map(d => d.record);
  const sales = tax.buildSalesTaxReport({ period, sources: branches.map(branch => ({ branch, invoices: of(branch, 'invoices'), creditNotes: of(branch, 'creditNotes'), debitNotes: of(branch, 'debitNotes') })), entryDate: () => '' });
  const purchases = tax.buildPurchaseTaxReport({ period, sources: branches.map(branch => ({ branch, expenses: docs.filter(d => d.branch === branch && d.collection === 'expenses').map(d => d.record), goodsReceipts: plan.costing.goodsReceipts.filter(gr => gr.branch === branch) })), entryDate: () => '' });
  const pp30 = tax.buildPp30Summary({ sales, purchases });
  const certificates = docs.filter(d => d.collection === 'whtCertificates').map(d => d.record);
  return { lines: pp30.lines, pnd3: wht.buildWhtFormReport({ period, form: 'PND3', certificates }).totals.taxWithheld, pnd53: wht.buildWhtFormReport({ period, form: 'PND53', certificates }).totals.taxWithheld };
}
const toSat = value => Math.round(Number(value) * 100);
function figures(j, journal, period, branch) {
  const f = { ...j.periodRange(period), branch };
  return {
    sales: 0 - j.movement(journal.entries, ['sales_goods', 'sales_service', 'sales_returns', 'sales_debit'], f),
    output: 0 - j.movement(journal.entries, ['output_vat'], f),
    input: j.movement(journal.entries, ['input_vat'], f),
    pnd3: 0 - j.movement(journal.entries, ['wht_pnd3'], f),
    pnd53: 0 - j.movement(journal.entries, ['wht_pnd53'], f),
    balanced: j.trialBalance(journal.entries, f).balanced
  };
}

test('jcore#9 September story: TB balances; output VAT = ภ.พ.30 L5 5,289.90, input VAT = L7 2,878.05, WHT = PND3 300 + PND53 735.75 (HQ); branch, combined, one-branch tie too', async () => {
  const j = await J();
  const { plan, journal } = await story('2026-10-21', 2);
  assert.equal(plan.storyPeriod, '2026-09');
  const hq = figures(j, journal, '2026-09', 'ubon');
  // The hand-worked figures of docs/DEMO_SCRIPT_TH.md (tax#13 / r91#1).
  // r13: input VAT + 483.00 (GR690901, HIGH-2) → 2,878.05; PND.53 + 560.75 (rent to the juristic landlord, MED-7) → 735.75.
  assert.deepEqual(hq, { sales: 7907000, output: 528990, input: 287805, pnd3: 30000, pnd53: 73575, balanced: true });
  for (const [branchCount, branches, key] of [[2, ['ubon'], 'ubon'], [2, ['khonkaen'], 'khonkaen'], [2, ['ubon', 'khonkaen'], 'all'], [1, ['ubon'], 'ubon']]) {
    const s = branchCount === 2 ? { plan, journal } : await story('2026-10-21', 1);
    const tax = await taxOf(s.plan, branches);
    const got = figures(j, s.journal, '2026-09', key);
    const where = `${branchCount} ${branches}`;
    assert.equal(got.balanced, true, where);
    assert.equal(got.output, toSat(tax.lines[5]), `${where} L5`);
    assert.equal(got.input, toSat(tax.lines[7]), `${where} L7`);
    assert.equal(got.sales, toSat(tax.lines[1]), `${where} L1`);
    assert.equal(got.pnd3, toSat(tax.pnd3), `${where} PND3`);
    assert.equal(got.pnd53, toSat(tax.pnd53), `${where} PND53`);
  }
  // Combined: HQ 5,289.90 + branch 4,625.60 = 9,915.50 output; 2,878.05 + 798.14 = 3,676.19 input.
  const all = figures(j, journal, '2026-09', 'all');
  assert.deepEqual([all.output, all.input], [991550, 367619]);
  // Inventory in the books = the costing engine's stock valuation; inter-branch nets to zero; WIP 0 (all jobs done).
  const c = await imp('erp-costing-core.js');
  const { jc } = await story('2026-10-21', 2);
  for (const branch of ['ubon', 'khonkaen', 'all']) {
    const balances = j.accountBalances(journal.entries, { to: '2026-09-30', branch });
    assert.equal(balances.get('inventory').closing, c.valuationTotal(c.valuationAt(jc.result, '2026-09-30', { branch })), branch);
  }
  assert.equal(j.accountBalances(journal.entries, { branch: 'all' }).get('inter_branch')?.closing || 0, 0);
});

test('jcore#10 the September trial balance is the same on every load date (ADR-013 two clocks), both branch modes', async () => {
  const j = await J();
  const dates = ['2026-10-01', '2026-10-05', '2026-10-12', '2026-10-21', '2026-10-31', '2026-11-15', '2026-12-31', '2027-01-01', '2027-02-28', '2028-02-29', '2028-03-01'];
  for (const branchCount of [2, 1]) {
    let canonical = null;
    for (const today of dates) {
      const { plan, journal } = await story(today, branchCount);
      const range = j.periodRange(plan.storyPeriod);
      const out = ['ubon', 'khonkaen', 'all'].map(branch => j.trialBalance(journal.entries, { ...range, branch }).rows.map(row => [row.code, row.opening, row.debit, row.credit, row.closing]));
      assert.ok(out.every((_, i) => j.trialBalance(journal.entries, { ...range, branch: ['ubon', 'khonkaen', 'all'][i] }).balanced), today);
      if (!canonical) canonical = JSON.stringify(out);
      else assert.equal(JSON.stringify(out), canonical, `${branchCount} ${today}`);
    }
  }
});

// ---------------------------------------------------------------- the journal's own documents
test('jcore#11 manual entries: plan validation, numbering never reused, cancel = reversal on the cancel date', async () => {
  const j = await J();
  const chart = j.effectiveChart();
  const draft = { date: '2026-09-30', branch: 'ubon', memo: 'ค่าเสื่อมราคา ก.ย.', lines: [{ account: 'exp_other', debit: '1,250.50', credit: '' }, { account: 'bank', debit: '', credit: '1250.50' }] };
  const plan = j.planManualEntry(draft, chart);
  assert.deepEqual([plan.ok, plan.total, plan.lines.map(line => [line.account, line.debit, line.credit])], [true, 125050, [['exp_other', 125050, 0], ['bank', 0, 125050]]]);
  for (const [bad, error] of [[{ ...draft, date: '' }, 'date'], [{ ...draft, branch: 'x' }, 'branch'], [{ ...draft, lines: [draft.lines[0]] }, 'lines'], [{ ...draft, lines: [{ account: 'nope', debit: '1' }, draft.lines[1]] }, 'line_account'], [{ ...draft, lines: [{ account: 'cash', debit: '1', credit: '1' }, draft.lines[1]] }, 'line_amount'], [{ ...draft, lines: [{ account: 'cash', debit: '1.005' }, draft.lines[1]] }, 'line_amount'], [{ ...draft, lines: [{ account: 'cash', debit: '100' }, { account: 'bank', credit: '99' }] }, 'unbalanced']]) {
    assert.equal(j.planManualEntry(bad, chart).error, error, error);
  }
  const manual = [{ id: 'm1', no: 'JV6909-0001', date: '2026-09-30', branch: 'ubon', memo: '', status: 'voided', voidDate: '2026-10-02', lines: plan.lines }];
  assert.equal(j.nextManualNo(manual, '2026-09-15'), 'JV6909-0002', 'a cancelled number is never reused');
  const documents = j.normalizeJournalDocuments({ schemaVersion: 1, manual });
  const journal = j.buildJournal({ documents });
  assert.deepEqual(only(journal, 'manual').map(entry => [entry.date, entry.reversalOf ? 'rev' : '', rows(entry)]), [['2026-09-30', '', [['exp_other', 'ubon', 125050, 0], ['bank', 'ubon', 0, 125050]]], ['2026-10-02', 'rev', [['exp_other', 'ubon', 0, 125050], ['bank', 'ubon', 125050, 0]]]]);
});

test('jcore#12 period lock over derived entries: a change that alters an entry dated in a closed period is found; one after it is not', async () => {
  const j = await J();
  const before = j.buildJournal({ invoices: [credit()] }).entries;
  const lockedSept = (branch, date) => branch === 'ubon' && date <= '2026-09-30';
  // Posting default changed (cash sale / receipts) → the September entry would change → refused.
  const changed = j.buildJournal({ invoices: [credit({ customer: 'อื่น' })], receipts: [{ id: 'r', no: 'R', date: '2026-09-20', invoiceId: 101, total: 10700, _branch: 'ubon' }] }).entries;
  assert.deepEqual(j.lockedJournalChanges(before, changed, lockedSept).map(row => [row.id, row.date]), [['rcp|ubon|r', '2026-09-20']]);
  // A receipt in October only adds an October entry → allowed.
  const october = j.buildJournal({ invoices: [credit()], receipts: [{ id: 'r', no: 'R', date: '2026-10-02', invoiceId: 101, total: 10700, _branch: 'ubon' }] }).entries;
  assert.deepEqual(j.lockedJournalChanges(before, october, lockedSept), []);
  // Removing a closed entry is a change too (cancel-not-delete).
  assert.equal(j.lockedJournalChanges(before, [], lockedSept).length, 1);
  // Renaming / recoding accounts changes no entry (presentation only).
  const settings = j.normalizeJournalSettings({ schemaVersion: 1, accounts: { ar: { code: '1131', name: 'ลูกหนี้ในประเทศ' } } });
  assert.deepEqual(j.lockedJournalChanges(before, j.buildJournal({ invoices: [credit()], settings }).entries, lockedSept), []);
});

test('jcore#13 overhead close (one click): applied vs actual of the month → COGS; a second click closes only the remainder; NRV delta', async () => {
  const j = await J();
  const expense = { id: 'u1', date: '2026-09-10', cat: 'ค่าสาธารณูปโภค', vendor: 'การไฟฟ้า', vatMode: 'none', docType: 'receipt', subtotal: 1200, vatAmt: 0, amount: 1200, _branch: 'ubon' };
  const labour = { id: 'L1', kind: 'labour', status: 'posted', jobKey: 'ubon|J', jobNo: 'PD1', date: '2026-09-12', branch: 'ubon', hours: 12, rate: 150, overheadRate: 75 };
  const sheets = new Map([['ubon|J', { job: { key: 'ubon|J', customer: 'X' }, total: 0 }]]);
  const journal = j.buildJournal({ expenses: [expense], jobEntries: [labour], sheets });
  // Applied 12 h × 75 = 900; actual utilities 1,200 → under-applied 300 to cost of sales.
  const plan = j.planOverheadClose(journal.entries, { branch: 'ubon', period: '2026-09', categories: ['ค่าสาธารณูปโภค'], closes: [] });
  assert.deepEqual([plan.ok, plan.applied, plan.actual, plan.cogs, plan.date], [true, 90000, { exp_utilities: 120000 }, 30000, '2026-09-30']);
  const doc = { id: 'c1', date: '2026-09-30', branch: 'ubon', period: '2026-09', applied: 90000, actual: { exp_utilities: 120000 }, cogs: 30000, status: 'posted' };
  const documents = j.normalizeJournalDocuments({ schemaVersion: 1, closes: [doc] });
  const closed = j.buildJournal({ expenses: [expense], jobEntries: [labour], sheets, documents });
  assert.deepEqual(rows(only(closed, 'overhead_close')[0]), [['overhead_applied', 'ubon', 90000, 0], ['exp_utilities', 'ubon', 0, 120000], ['cogs', 'ubon', 30000, 0]]);
  const f = { ...j.periodRange('2026-09'), branch: 'ubon' };
  assert.deepEqual([j.movement(closed.entries, ['overhead_applied'], f), j.movement(closed.entries, ['exp_utilities'], f)], [0, 0]);
  assert.equal(j.planOverheadClose(closed.entries, { branch: 'ubon', period: '2026-09', categories: ['ค่าสาธารณูปโภค'], closes: documents.closes }).ok, false, 'nothing left');
  // A later utility bill of September: only its 500 is closed by the second click.
  const more = j.buildJournal({ expenses: [expense, { ...expense, id: 'u2', amount: 500, subtotal: 500 }], jobEntries: [labour], sheets, documents });
  const second = j.planOverheadClose(more.entries, { branch: 'ubon', period: '2026-09', categories: ['ค่าสาธารณูปโภค'], closes: documents.closes });
  assert.deepEqual([second.applied, second.actual, second.cogs], [0, { exp_utilities: 50000 }, 50000]);
  // NRV: allowance 0 → target 1,200 posts 1,200; once booked, a lower target 500 reverses 700.
  assert.deepEqual(j.planNrvEntry([], { branch: 'ubon', date: '2026-09-30', target: 120000 }), { ok: true, delta: 120000, booked: 0, target: 120000 });
  const nrvDocs = j.normalizeJournalDocuments({ schemaVersion: 1, nrv: [{ id: 'n1', date: '2026-09-30', branch: 'ubon', target: 120000, delta: 120000, rows: [{ sku: 'code:a', writeDown: 120000 }], status: 'posted' }] });
  const nrv = j.buildJournal({ documents: nrvDocs });
  assert.deepEqual(rows(only(nrv, 'nrv')[0]), [['nrv_loss', 'ubon', 120000, 0], ['inventory_allowance', 'ubon', 0, 120000]]);
  assert.equal(j.planNrvEntry(nrv.entries, { branch: 'ubon', date: '2026-10-31', target: 120000 }).ok, false);
  assert.equal(j.planNrvEntry(nrv.entries, { branch: 'ubon', date: '2026-10-31', target: 50000 }).delta, -70000);
});

test('jcore#14 opening-balance import: template, validation per line, preview totals; AR / AP entries against the opening clearing account', async () => {
  const j = await J();
  const products = [{ code: 'DEMO-NB01', name: 'โน้ตบุ๊ก', flowType: 'inventory', fulfillmentType: 'stock' }, { code: 'SV', name: 'บริการ', flowType: 'service', fulfillmentType: 'service' }];
  const resolveProduct = code => products.find(row => row.code === code) || null;
  const isStockProduct = row => row.flowType === 'inventory';
  const context = { asOf: '2026-08-31', branchCodes: { '00000': 'ubon', '00001': 'khonkaen' }, resolveProduct, isStockProduct };
  const template = j.openingCsvTemplate();
  const ok = j.planOpeningImport(template, context);
  assert.equal(ok.ok, true, JSON.stringify(ok.rows.map(row => row.errors)));
  assert.deepEqual(ok.totals, { ar: 1070000, ap: 535000, stockValue: 9750000, stockRows: 1 }, '5 × 19,500 = 97,500 stock; AR 10,700; AP 5,350');
  // The CSV reader: a BOM, quotes, a doubled quote, CRLF; dates as D/M/พ.ศ.
  const csv = '﻿ประเภท,สาขา,รหัส,ชื่อ,เลขที่เอกสาร,วันที่เอกสาร,วันครบกำหนด,จำนวน,ต้นทุนต่อหน่วย,ยอดคงค้าง\r\nAR,00001,C-9,"บจก. ""เอ"" จำกัด",INV-1,15/08/2569,14/09/2569,,,"1,500.25"\r\n';
  const parsed = j.planOpeningImport(j.parseCsv(csv), context);
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  assert.deepEqual([parsed.rows[0].name, parsed.rows[0].branch, parsed.rows[0].docDate, parsed.rows[0].amount], ['บจก. "เอ" จำกัด', 'khonkaen', '2026-08-15', 150025]);
  const bad = j.planOpeningImport([template[0], ['XX', '00000', '', '', '', '', '', '', '', ''], ['STOCK', '99999', 'NOPE', '', '', '', '', '-1', 'x', ''], ['STOCK', '00000', 'SV', '', '', '', '', '1', '1', ''], ['AR', '00000', '', '', 'D1', '2026-09-15', '', '', '', '0'], ['AP', '00000', 'S', 'ผู้ขาย', 'D2', '2026-08-01', '', '', '', '10.001']], context);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.rows.map(row => row.errors), [['type'], ['branch', 'product_unknown', 'qty', 'unit_cost'], ['product_not_stock'], ['name', 'amount', 'doc_after_as_of'], ['amount']]);
  // One opening cost per product: the same product at another branch with another cost is refused.
  const twoCosts = j.planOpeningImport([template[0], ['STOCK', '00000', 'DEMO-NB01', '', '', '', '', '2', '19500', ''], ['STOCK', '00001', 'DEMO-NB01', '', '', '', '', '3', '19000', ''], ['STOCK', '00001', 'DEMO-NB01', '', '', '', '', '1', '19500', '']], context);
  assert.deepEqual(twoCosts.rows.map(row => row.errors), [[], ['unit_cost_differs'], ['duplicate']]);
  assert.deepEqual(j.planOpeningImport([['a', 'b']], context).errors, ['empty']);
  assert.deepEqual(j.planOpeningImport([['a', 'b'], ['1', '2']], context).errors, ['header']);
  // Committed as documents: AR / AP entries on the balance date against 3900; a cancelled batch is reversed.
  const documents = j.normalizeJournalDocuments({ schemaVersion: 1, openingDate: '2026-08-31', opening: [{ id: 'o1', kind: 'ar', date: '2026-08-31', rows: [{ branch: 'ubon', name: 'ลูกค้า', code: 'C', docNo: 'OLD-1', docDate: '2026-08-15', dueDate: '2026-09-14', amount: 1070000 }], total: 1070000, status: 'posted' }, { id: 'o2', kind: 'ap', date: '2026-08-31', rows: [{ branch: 'ubon', name: 'ผู้ขาย', code: 'S', docNo: 'PI-1', docDate: '2026-08-20', dueDate: '', amount: 535000 }], total: 535000, status: 'voided', voidDate: '2026-09-02' }] });
  const journal = j.buildJournal({ documents });
  assert.deepEqual(rows(only(journal, 'opening_ar')[0]), [['ar', 'ubon', 1070000, 0], ['opening_equity', 'ubon', 0, 1070000]]);
  assert.deepEqual(only(journal, 'opening_ap').map(entry => [entry.date, rows(entry)[0]]), [['2026-08-31', ['ap', 'ubon', 0, 535000]], ['2026-09-02', ['ap', 'ubon', 535000, 0]]]);
  const [item] = j.openItems(journal.entries, 'ar', { to: '2026-09-30' });
  assert.deepEqual([item.no, item.dueDate, item.party, item.balance], ['OLD-1', '2026-09-14', 'ลูกค้า', 1070000]);
  assert.equal(journal.openingDate, '2026-08-31');
});

test('jcore#15 settings and documents stores are strict (fail-closed); the chart: every used account mapped, one code one account', async () => {
  const j = await J();
  assert.deepEqual(j.normalizeJournalSettings(null), j.defaultJournalSettings());
  for (const bad of ['{', '[]', { schemaVersion: 2 }, { schemaVersion: 1, hacked: 1 }, { schemaVersion: 1, accounts: { ar: { code: '-13', name: '' } } }, { schemaVersion: 1, accounts: { ar: { code: '1130000000000', name: '' } } }, { schemaVersion: 1, posting: { receiptAccount: 'ar' } }, { schemaVersion: 1, categories: { x: 'cash' } }, { schemaVersion: 1, peak: { columns: [{ header: 'x', field: 'nope' }], dateFormat: 'iso' } }]) {
    assert.throws(() => j.normalizeJournalSettings(bad), error => error.code === 'journal_store', JSON.stringify(bad));
  }
  for (const bad of ['x', { schemaVersion: 1, manual: {} }, { schemaVersion: 1, nrv: [{ id: 'n', date: '2026-09-30', branch: 'ubon', target: 1, delta: 0, rows: [], status: 'posted' }] }, { schemaVersion: 1, closes: [{ id: 'c', date: '2026-09-29', branch: 'ubon', period: '2026-09', applied: 1, actual: { exp_utilities: 1 }, cogs: 0, status: 'posted' }] }]) {
    assert.throws(() => j.normalizeJournalDocuments(bad), error => error.code === 'journal_store', JSON.stringify(bad));
  }
  // Every account has a code by default (1xxx–5xxx), unique.
  const chart = j.effectiveChart();
  assert.deepEqual(j.validateChart(chart), []);
  assert.ok([...chart.values()].every(acct => /^[1-5]\d{3}$/.test(acct.code)));
  // Two different accounts on one code → duplicate; an asset and a liability on one code → type conflict.
  const dup = j.effectiveChart(j.normalizeJournalSettings({ schemaVersion: 1, accounts: { cash: { code: '1112', name: '' } } }));
  assert.deepEqual(j.validateChart(dup).map(error => error.code), ['duplicate_code']);
  const clash = j.effectiveChart(j.normalizeJournalSettings({ schemaVersion: 1, accounts: { ap: { code: '1112', name: '' } } }));
  assert.deepEqual(j.validateChart(clash).map(error => error.code), ['type_conflict']);
  // A used account the chart does not have → missing.
  assert.deepEqual(j.validateChart(chart, new Set(['ar', 'cust-gone'])).map(error => [error.code, error.account]), [['missing', 'cust-gone']]);
  // Two roles mapped to one code with the same name merge into one trial-balance row (a company with one bank account).
  const merged = j.effectiveChart(j.normalizeJournalSettings({ schemaVersion: 1, accounts: { cash: { code: '1112', name: 'เงินฝากธนาคาร' }, bank: { code: '1112', name: 'เงินฝากธนาคาร' } } }));
  assert.deepEqual(j.validateChart(merged), []);
  const journal = j.buildJournal({ invoices: [credit({ taxInvoiceForm: 'abbreviated', vatMode: 'extract' })], receipts: [] });
  assert.ok(j.trialBalance(journal.entries, {}, merged).rows.some(row => row.code === '1112' && row.ids.includes('cash')));
});

test('jcore#16 exports: entry numbers per month in order, COGS consolidated per month and branch (same totals), CSV round trip', async () => {
  const j = await J();
  const { journal } = await story('2026-10-21', 2);
  const sept = j.entriesInRange(journal.entries, { ...j.periodRange('2026-09'), branch: 'all' });
  const numbers = j.numberEntries(sept);
  assert.equal(numbers.get(sept[0].id), 'GJ6909-0001');
  assert.equal(numbers.get(sept[sept.length - 1].id), `GJ6909-${String(sept.length).padStart(4, '0')}`);
  const merged = j.consolidateCogs(sept);
  const cogsEntries = merged.filter(entry => entry.kind === 'cogs');
  assert.deepEqual(cogsEntries.map(entry => [entry.date, entry.branch, entry.descKey]), [['2026-09-30', 'khonkaen', 'desc.cogsMonth'], ['2026-09-30', 'ubon', 'desc.cogsMonth']], 'one cost-of-sales entry per establishment, on the last day of the month');
  assert.ok(merged.every(entry => entry.kind !== 'cogs_return'));
  balanced(merged);
  for (const account of ['cogs', 'inventory', 'ar', 'output_vat']) assert.equal(j.movement(merged, [account], {}), j.movement(sept, [account], {}), account);
  assert.deepEqual(j.parseCsv('a,"b ""c""",d\r\n1,,"x\ny"\n'), [['a', 'b "c"', 'd'], ['1', '', 'x\ny']]);
  assert.equal(j.DEFAULT_PEAK_COLUMNS.length, 9);
  assert.ok(j.DEFAULT_PEAK_COLUMNS.every(column => j.PEAK_FIELDS.includes(column.field)));
});
