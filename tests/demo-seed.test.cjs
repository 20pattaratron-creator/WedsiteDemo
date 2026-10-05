// One-click demo sample data (ADR-013): erp-demo-seed-core.js (pure generator + reset key
// scope) and erp-demo-seed.js (load / reset controller + UI).
//   Part A — core: deterministic per business date, relative dates (aging shifts with the
//            calendar), every aging bucket (10 / 45 / 62 / 100 days late) and payment status,
//            totals from the app's own calculators, collision-free numbers, reset key scope.
//   Part B — jsdom through the real app: every seeded document passes the app's own
//            validators; dashboard / AR banner / AR report / governance aging / Decision
//            Council agree; load never mixes with or silently overwrites user data; reset
//            removes exactly this app's keys (a foreign key survives); period locks; the UI.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { boot } = require('./dom-helper.cjs');

const ROOT = path.resolve(__dirname, '..');
const imp = file => import(pathToFileURL(path.join(ROOT, file)).href + '?t=' + Date.now() + Math.random());
const GENERAL = 'ลูกค้าทั่วไป / เงินสด';
const TENANT = 'customer-showcase-local';
const LOAD_LABEL = '📊 โหลดข้อมูลตัวอย่างสำหรับสาธิต';
const RESET_LABEL = '↺ ล้างข้อมูลสาธิตทั้งหมด (รีเซ็ต)';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function waitFor(check, tries = 80) { for (let i = 0; i < tries && !check(); i++) await new Promise(r => setTimeout(r, 25)); return check(); }
const text = el => String(el?.textContent || '').replace(/\s+/g, ' ').trim();
const plain = value => JSON.parse(JSON.stringify(value));
const round2 = value => Math.round(value * 100) / 100;
const sum = (rows, pick) => round2(rows.reduce((total, row) => total + pick(row), 0));
const invoicesOf = plan => plan.documents.filter(d => d.collection === 'invoices').map(d => d.record);
const recordsOf = (plan, collection) => plan.documents.filter(d => d.collection === collection).map(d => d.record);
const byKey = (plan, key) => plan.expected.invoices[key];
// Every localStorage entry except the short-lived write-lease metadata.
function dumpStorage(w) {
  const out = {};
  for (let i = 0; i < w.localStorage.length; i++) {
    const key = w.localStorage.key(i);
    if (!key.startsWith('erp_demo_write_lease_v1:')) out[key] = w.localStorage.getItem(key);
  }
  return out;
}
function seededCount(w) {
  let count = 0;
  for (const value of Object.values(dumpStorage(w))) count += (String(value).match(/"demoSeed":true/g) || []).length;
  return count;
}
// A user invoice through the real save path (auto number, trial guard, stock guard).
async function saveUserInvoice(h, customer) {
  const { w, set } = h;
  const shared = await imp('erp-shared-core.js');
  await waitFor(() => w.saveInvoice?.__stockGuard);
  w.go('invoice-form', null); w.resetF('invoice'); w.selBr('i', 'ubon');
  set('i-date', shared.localDateISO()); set('i-cust', customer); set('i-address', '1 ถนนจริง'); set('i-sales', 'ผู้ใช้'); set('i-vat', '1');
  w.document.getElementById('i-items-body').innerHTML = '';
  w.addIItem({ product: 'งานของผู้ใช้', qty: 1, unit: 'งาน', priceUnit: 1000 });
  await w.saveInvoice();
  const invoice = w.ERPIntegrity.business().invoices.find(i => i.customer === customer);
  assert.ok(invoice, h.messages.join('\n'));
  return invoice;
}

// ============================================================ Part A: core
test('core: the plan is deterministic for a business date, fully tagged, and covers every document state', async () => {
  const core = await imp('erp-demo-seed-core.js');
  const shared = await imp('erp-shared-core.js');
  const a = core.buildDemoSeedPlan({ today: '2026-09-26' });
  const b = core.buildDemoSeedPlan({ today: '2026-09-26' });
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'same date → byte-identical plan');

  const counts = {};
  a.documents.forEach(d => { counts[d.collection] = (counts[d.collection] || 0) + 1; });
  // ADR-023 added the tax-month story: 3 abbreviated walk-in invoices (+3 cash receipts), 1 cancelled invoice + its
  // replacement, and 5 purchase tax invoices (one claimed next month, two ภาษีซื้อต้องห้าม) — was 18 / 11 / 5 / 8 / 4.
  assert.deepEqual(counts, { invoices: 23, expenses: 16, quotes: 5, receipts: 11, creditNotes: 4 });
  // Customers: 9 named (8 นิติบุคคล + 1 sole proprietor) + walk-in cash sales; one buyer is a BRANCH.
  assert.equal(a.contacts.length, 9);
  assert.ok(a.contacts.every(c => /^\d{13}$/.test(c.taxId)), '13-digit tax IDs');
  const checkDigit = id => { let s = 0; for (let i = 0; i < 12; i++) s += Number(id[i]) * (13 - i); return (11 - s % 11) % 10 === Number(id[12]); };
  assert.ok(a.contacts.every(c => checkDigit(c.taxId)), 'valid Thai tax-ID check digits');
  assert.equal(a.contacts.filter(c => c.taxId.startsWith('0')).length, 8, 'นิติบุคคล');
  assert.deepEqual(a.contacts.filter(c => c.branchCode !== '00000').map(c => [c.name, c.branchCode, c.branchName]), [['บมจ. แก่นนคร ฟู้ดส์', '00003', 'โรงงานขอนแก่น']]);
  assert.ok(a.contacts.filter(c => c.branchCode === '00000').every(c => c.branchName === 'สำนักงานใหญ่'));
  assert.ok(invoicesOf(a).some(i => i.customer === GENERAL), 'walk-in customer');
  // Products / services: 12, each used by at least one invoice or quotation.
  assert.equal(a.products.length, 12);
  const used = new Set([...invoicesOf(a), ...recordsOf(a, 'quotes')].flatMap(doc => doc.items.map(item => item.productCode)));
  assert.deepEqual(a.products.map(p => p.code).filter(code => !used.has(code)), []);
  assert.ok(a.products.every(p => p.defaultPrice > p.standardCost), 'every product has a default price above cost');

  // Tagging, ids and numbers.
  const all = [...a.documents.map(d => d.record), ...a.flow.billingNotes, ...a.flow.payments, ...a.flow.activity, ...a.contacts, ...a.products];
  assert.ok(all.every(core.isDemoSeedRecord), 'every record carries demoSeed');
  assert.ok(all.every(r => r.demoSeedBatch === core.DEMO_SEED_BATCH_ID));
  const ids = a.documents.map(d => d.record.id);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  assert.ok(ids.every(id => Number.isInteger(id) && id > 1e12 && id < 1e12 + 1000), 'numeric ids in the reserved range');
  const numbers = a.documents.map(d => d.record.no).filter(Boolean);
  assert.equal(new Set(numbers).size, numbers.length, 'unique document numbers');
  for (const d of a.documents.filter(x => x.record.no)) {
    const prefix = { quotes: 'QT', invoices: 'INV', receipts: 'REC', creditNotes: 'CN' }[d.collection];
    const [y, m] = d.record.date.split('-').map(Number);
    assert.match(d.record.no, new RegExp(`^${prefix}${String(y + 543).slice(-2)}${String(m).padStart(2, '0')}\\d{2}$`), d.record.no);
  }
  assert.match(a.flow.billingNotes[0].no, /^BL6909-0001$/);
  assert.match(a.flow.payments[0].no, /^PAY6909-0001$/);

  // Dates: never in the future; one old unpaid invoice (130 days) for the "over 90 days" bucket,
  // everything else within ~3 months; each record sits in the pack of its own date.
  for (const d of a.documents) {
    const age = shared.businessDaysBetween(d.record.date, a.today);
    assert.ok(age >= 0 && age <= 130, `${d.record.no || d.record.desc} ${d.record.date}`);
    const [y, m] = d.record.date.split('-').map(Number);
    assert.deepEqual([d.year, d.month], [y, m - 1]);
  }
  assert.equal(a.documents.filter(d => shared.businessDaysBetween(d.record.date, a.today) > 92).length, 1);
  for (const branch of ['ubon', 'khonkaen']) {
    assert.ok(invoicesOf(a).some(i => i.branch === branch));
    assert.ok(recordsOf(a, 'expenses').some(e => e.branch === branch));
  }

  // VAT: all three modes on FULL tax invoices (§86/4), and VAT-inclusive abbreviated walk-in sales.
  const full = invoicesOf(a).filter(i => i.taxInvoiceForm === 'full');
  assert.deepEqual([...new Set(full.map(i => i.vatMode))].sort(), ['add', 'extract', 'none']);
  const walkIn = invoicesOf(a).filter(i => i.taxInvoiceForm === 'abbreviated');
  assert.equal(walkIn.length, 5, 'U7 / K7 + the three of the tax-month story (ADR-023)');
  assert.ok(walkIn.every(i => i.customer === GENERAL && i.vatMode === 'extract' && i.customerTaxId === ''));

  // Payment story: the exact days late the demo relies on, and every bucket.
  const e = a.expected.invoices;
  assert.deepEqual([e.U2, e.U4, e.U3, e.K1, e.U0].map(x => x.daysPastDue), [10, 17, 45, 62, 100]);
  assert.ok([e.U2, e.U4, e.U3, e.K1, e.U0].every(x => x.outstanding > 0));
  const open = Object.values(e).filter(x => x.outstanding > 0);
  const bucket = d => d <= 0 ? 'current' : d <= 30 ? '1_30' : d <= 60 ? '31_60' : d <= 90 ? '61_90' : 'over_90';
  assert.deepEqual([...new Set(open.map(x => bucket(x.daysPastDue)))].sort(), ['1_30', '31_60', '61_90', 'current', 'over_90']);
  assert.ok(Object.values(e).some(x => x.paid === x.total && x.total > 0 && x.credited === 0), 'fully paid');
  assert.ok(Object.values(e).some(x => x.paid > 0 && x.outstanding > 0), 'partially paid');
  assert.deepEqual(plain([e.K9.credited, e.K9.total, e.K9.paid, e.K9.outstanding]), [3745, 3745, 0, 0], 'fully credited');

  // Receipts: one with 3% WHT + certificate; one billing payment settles two invoices.
  const wht = recordsOf(a, 'receipts').filter(r => r.whtAmount > 0);
  assert.equal(wht.length, 1);
  assert.equal(wht[0].whtRate, 3);
  assert.ok(wht[0].whtCertNo && wht[0].whtCertReceived);
  const combined = recordsOf(a, 'receipts').filter(r => r.paymentId === a.flow.payments[0].id);
  assert.equal(combined.length, 2, 'one payment settles two invoices');
  // Credit notes: price adjustment, returned goods, full cancellation and a voided one.
  const notes = recordsOf(a, 'creditNotes');
  assert.deepEqual(notes.map(n => [n.reasonCode, n.status]).sort(), [['price_overcharge', 'issued'], ['returned_goods', 'issued'], ['service_cancelled', 'issued'], ['service_cancelled', 'voided']]);
  assert.equal(notes.find(n => n.reasonCode === 'returned_goods').returnItems[0].qty, 1);
  assert.ok(notes.every(n => n.customerBranch === 'สำนักงานใหญ่'), 'buyer head office from Customer Master (§86/10)');

  // Quotations: approved + pending; two converted, linked with the app's own link fields.
  const quotes = recordsOf(a, 'quotes');
  assert.ok(quotes.some(q => q.approved) && quotes.some(q => !q.approved));
  const converted = quotes.filter(q => q.invoiceNo);
  assert.equal(converted.length, 2);
  for (const q of converted) {
    const inv = invoicesOf(a).find(i => i.no === q.invoiceNo);
    assert.deepEqual([q.approved, q.invoiceId, q.invoiceStatus], [true, inv.id, 'created']);
    assert.deepEqual([inv.sourceQuoteId, inv.sourceQuoteNo, inv.sourceQuoteBranch, inv.sourceQuoteYear, inv.sourceQuoteMonth], [q.id, q.no, q.branch, q.year, q.month]);
    assert.equal(inv.customer, q.customer);
    assert.deepEqual(inv.items.map(i => [i.productCode, i.qty, i.priceUnit]), q.items.map(i => [i.productCode, i.qty, i.priceUnit]));
  }
  assert.ok(invoicesOf(a).filter(i => !converted.some(q => q.invoiceNo === i.no)).every(i => i.sourceQuoteId === ''));
});

test('core: dates are relative — another business date gives the same story, and aging moves with the calendar', async () => {
  const core = await imp('erp-demo-seed-core.js');
  const shared = await imp('erp-shared-core.js');
  const ar = await imp('erp-receivables-core.js');
  const t1 = '2026-09-26', t2 = '2027-01-10'; // t2 crosses the year end and the BE year (2569 → 2570)
  const p1 = core.buildDemoSeedPlan({ today: t1 });
  const p2 = core.buildDemoSeedPlan({ today: t2 });
  const shift = shared.businessDaysBetween(t1, t2);
  assert.equal(p1.documents.length, p2.documents.length);
  // ADR-023: the tax-month story (demoSeedStory 'tax-month') sits in the last closed month at the same distance from its
  // last day (so the ภ.พ.30 to file always has it); every other row keeps its distance from today. (Ids and numbers
  // follow the calendar order of the events, so rows are compared by what they are, not by id.)
  const lastDayBefore = today => { const [y, m] = today.split('-').map(Number); return shared.localDateISO(new Date(y, m - 1, 0)); };
  const isStory = d => d.record.demoSeedStory === 'tax-month';
  const keyOf = (d, base) => `${d.collection}|${shared.businessDaysBetween(d.record.date, base)}|${d.record.total ?? d.record.amount}|${d.record.customer || d.record.desc || ''}`;
  const keys = (plan, story, base) => plan.documents.filter(d => isStory(d) === story).map(d => keyOf(d, base)).sort();
  assert.equal(p1.documents.filter(isStory).length, 13, '5 invoices + 3 receipts + 5 expenses');
  assert.deepEqual(keys(p1, true, lastDayBefore(t1)), keys(p2, true, lastDayBefore(t2)));
  assert.deepEqual(keys(p1, false, t1), keys(p2, false, t2));
  assert.ok(p1.documents.filter(isStory).every(d => d.record.date.slice(0, 7) === lastDayBefore(t1).slice(0, 7)), 'in the month before today');
  // Same balances per scenario invoice; the same days late except the tax-month story (dated from the month's end).
  const storyKeys = ['A1', 'A2', 'A3', 'X1', 'X2'];
  const byKey = plan => Object.entries(plan.expected.invoices).sort(([a], [b]) => a.localeCompare(b));
  assert.deepEqual(byKey(p1).map(([key]) => key), byKey(p2).map(([key]) => key));
  byKey(p1).forEach(([key, x], i) => {
    const y = byKey(p2)[i][1];
    assert.equal(x.outstanding, y.outstanding, key);
    if (!storyKeys.includes(key)) assert.equal(x.daysPastDue, y.daysPastDue, key);
  });
  assert.ok(invoicesOf(p2).some(i => /^INV7001\d{2}$/.test(i.no)) && invoicesOf(p2).some(i => /^INV6912\d{2}$/.test(i.no)), 'numbers follow each document month (BE year)');

  // Aging with the receivables core, using the plan's balances (hand-checked figures).
  const aging = (plan, asOf) => {
    const byNo = new Map(Object.values(plan.expected.invoices).map(x => [x.no, x]));
    const items = ar.buildReceivableItems(invoicesOf(plan), { asOf, summarize: inv => byNo.get(inv.no) });
    return ar.summarizeReceivableAging(items).totals.buckets;
  };
  const b1 = aging(p1, t1);
  assert.deepEqual(plain(b1), plain(aging(p2, t2)), 'same buckets on each plan\'s own date');
  // current: U5 57,673 + K6 64,820.60 + U8 3,500 + U6 14,445 + K8 9,630 + X2 6,955 (ADR-023 replacement invoice,
  // 60-day credit) · 1–30: U2 47,611.60 + U4 35,224.40 · 31–60: U3 26,750 · 61–90: K1 124,933.20 · over 90: U0 43,741.60
  // (the cancelled X1 owes nothing; the abbreviated A1–A3 are paid in cash the same day)
  assert.deepEqual(plain(b1), { current: 157023.6, '1_30': 82836, '31_60': 26750, '61_90': 124933.2, over_90: 43741.6, undated: 0 });
  // The same data viewed 30 days later: K6 (due +40) and X2 (due +60 from the last day of the previous month) are still
  // current; the rest moves one bucket.
  const later = aging(p1, shared.addBusinessCalendarDays(t1, 30));
  assert.deepEqual(plain(later), { current: 71775.6, '1_30': 85248, '31_60': 82836, '61_90': 26750, over_90: 168674.8, undated: 0 });
  assert.throws(() => core.buildDemoSeedPlan({ today: '26/09/2026' }), /วันที่อ้างอิง/);
});

test('core: every total comes from the app calculators (VAT add / extract / none, WHT, partial receipt, credit notes, billing)', async () => {
  const core = await imp('erp-demo-seed-core.js');
  const shared = await imp('erp-shared-core.js');
  const cn = await imp('erp-credit-note-core.js');
  const plan = core.buildDemoSeedPlan({ today: '2026-09-26' });
  for (const inv of invoicesOf(plan)) {
    const vat = shared.calculateVatSummary(inv.items.reduce((s, i) => s + i.qty * i.priceUnit, 0), inv.useVat);
    assert.deepEqual([inv.subtotal, inv.vatAmt, inv.total, inv.vatMode], [vat.subtotal, vat.vatAmt, vat.total, vat.vatMode], inv.no);
    assert.equal(inv.costTotal, inv.items.reduce((s, i) => s + i.qty * i.costUnit, 0));
    assert.equal(inv.dueDate, inv.creditTerm ? shared.addBusinessCalendarDays(inv.date, Number(inv.creditTerm.replace(/\D/g, ''))) : '');
    assert.equal(inv.paymentStatus, 'pending', 'as the save planner creates it (reconciled after load)');
  }
  // The VAT-inclusive full invoice: price typed incl. VAT (5,390 × 1.07 = 5,767.30), VAT extracted.
  const inclusive = invoicesOf(plan).find(i => i.no === byKey(plan, 'U5').no);
  assert.deepEqual([inclusive.taxInvoiceForm, inclusive.vatMode, inclusive.items[0].priceUnit, inclusive.total, inclusive.subtotal, inclusive.vatAmt], ['full', 'extract', 5767.3, 57673, 53900, 3773]);
  for (const r of recordsOf(plan, 'receipts').filter(x => !x.paymentId)) {
    const vat = shared.calculateVatSummary(r.items.reduce((s, i) => s + i.saleTotal, 0), r.useVat);
    assert.deepEqual([r.subtotal, r.vatAmt, r.total], [vat.subtotal, vat.vatAmt, vat.total], r.no);
    const wht = shared.calculateWhtSummary(r.subtotal, r.whtRate, r.total);
    assert.deepEqual([r.whtAmount, r.cashReceived], [wht.whtAmount, wht.cashReceived]);
    assert.equal(round2(r.cashReceived + r.whtAmount), r.total, 'cash + WHT settles the full total');
  }
  const whtReceipt = recordsOf(plan, 'receipts').find(r => r.whtAmount > 0);
  assert.deepEqual([whtReceipt.subtotal, whtReceipt.whtAmount, whtReceipt.cashReceived, whtReceipt.total], [15500, 465, 16120, 16585]);
  const partial = recordsOf(plan, 'receipts').find(r => /บางส่วน/.test(r.items[0].product));
  assert.deepEqual([partial.total, partial.vatMode, partial.subtotal, partial.vatAmt], [40000, 'extract', 37383.18, 2616.82]);
  // Credit notes: stored figures equal calculateCreditNote() on the referenced invoice.
  const invoices = invoicesOf(plan);
  for (const note of recordsOf(plan, 'creditNotes')) {
    const inv = invoices.find(i => i.no === note.invoiceNos[0]);
    const calc = cn.calculateCreditNote({ lines: [{ invoice: { ...inv, _year: inv.year, _month: inv.month }, differenceAmount: note.lines[0].differenceAmount }] });
    assert.deepEqual([note.subtotal, note.vatAmt, note.total], [calc.subtotal, calc.vatAmt, calc.total], note.no);
  }
  assert.deepEqual(recordsOf(plan, 'creditNotes').map(n => n.total).sort((x, y) => x - y), [1605, 3745, 3841.3, 4815]);
  // Billing payment: allocations = the two invoices' totals, receipts carry the invoice VAT split.
  const payment = plan.flow.payments[0];
  const billed = plan.flow.billingNotes[0].lines.map(l => invoices.find(i => i.no === l.invoiceNo));
  assert.deepEqual(payment.allocations.map(a => a.amount), billed.map(i => i.total));
  assert.deepEqual(billed.map(i => i.total), [33897.6, 38348.8]);
  assert.equal(payment.amount, sum(billed, i => i.total));
  assert.deepEqual(plan.flow.billingNotes[0].status, 'paid');
});

test('core: document numbers continue after the highest stored number and never collide', async () => {
  const core = await imp('erp-demo-seed-core.js');
  const existing = core.collectNumberSequences({
    invoices: [{ no: 'INV690907' }, { no: 'inv690903' }, { no: 'INV-MANUAL' }, { no: 'INV690812' }],
    receipts: [{ no: 'REC690901' }], quotes: [{ no: 'QT690911' }], creditNotes: [{ no: 'CN690902' }],
    billingNotes: [{ no: 'BL6909-0003' }], payments: [{ no: 'PAY69090002' }]
  });
  assert.deepEqual(plain(existing), { QT6909: 11, INV6909: 7, INV6908: 12, REC6909: 1, CN6909: 2, BL6909: 3, PAY6909: 2 });
  const plan = core.buildDemoSeedPlan({ today: '2026-09-26', numberStart: existing });
  const inSept = prefix => plan.documents.map(d => d.record.no).filter(no => no && no.startsWith(prefix)).sort();
  assert.equal(inSept('INV6909')[0], 'INV690908');
  assert.equal(inSept('INV6908')[0], 'INV690813');
  assert.equal(inSept('QT6909')[0], 'QT690912');
  assert.equal(inSept('CN6909')[0], 'CN690903');
  assert.deepEqual(inSept('REC6909').slice(0, 2), ['REC690902', 'REC690903']);
  assert.equal(plan.flow.billingNotes[0].no, 'BL6909-0004');
  assert.equal(plan.flow.payments[0].no, 'PAY6909-0003');
  assert.deepEqual(plain(plan.flow.payments[0].receiptNos), inSept('REC6909').filter(no => plan.documents.some(d => d.record.no === no && d.record.paymentId)));
});

test('core: the reset key scope is exactly this app\'s keys for the active tenant', async () => {
  const core = await imp('erp-demo-seed-core.js');
  const t = `erp_tenant::${TENANT}::`;
  const keys = [
    `${t}biz2_ubon_2026_09`, `${t}example_erp_order_flow_v3`, `${t}comform_contact_master_v1`, `${t}comform_governance_period_locks_v1`,
    `${t}comform_auto_backup_v1_x`, `${t}comform_receipt_document_draft_v1`,
    `${t}erp_product_experience_role_v1`, // retired per-role view (ADR-014): removed
    `${t}erp_product_experience_mode_v1`, // simple/advanced mode preference: kept
    `trial::${TENANT}::quote-pdf-viewed`, `business_rules::${TENANT}`, 'example_erp_order_flow_v2', // this app, legacy / trial
    `erp_tenant::other-company::biz2_ubon_2026_09`, `trial::other-company::quote-pdf-viewed`, `business_rules::${TENANT}-2`, // other tenants
    'erp_demo_write_lease_v1:sales-ledger', 'another_app_setting', `x${t}biz2`, '' // lease (held by the reset) / foreign keys
  ];
  assert.deepEqual(plain(core.demoResetStorageKeys(keys, TENANT)), [
    `business_rules::${TENANT}`, `${t}biz2_ubon_2026_09`, `${t}comform_auto_backup_v1_x`, `${t}comform_contact_master_v1`,
    `${t}comform_governance_period_locks_v1`, `${t}comform_receipt_document_draft_v1`, `${t}erp_product_experience_role_v1`, `${t}example_erp_order_flow_v3`,
    'example_erp_order_flow_v2', `trial::${TENANT}::quote-pdf-viewed`
  ].sort());
  assert.deepEqual(plain(core.demoResetStorageKeys([...keys, ...keys], TENANT)), plain(core.demoResetStorageKeys(keys, TENANT)), 'no duplicates');
  for (const bad of ['', '  ', 'a::b', undefined]) assert.throws(() => core.demoResetStorageKeys(keys, bad), /tenant/, String(bad));
});

// ============================================================ Part B: jsdom
test('load on an empty store: no question; every seeded document passes the app\'s own validators; statuses, stock and Trial usage', async () => {
  const h = await boot(); const { w } = h;
  try {
    const shared = await imp('erp-shared-core.js');
    const finance = await imp('erp-document-finance-core.js');
    const cnCore = await imp('erp-credit-note-core.js');
    let asked = 0;
    const result = await w.ERPDemoSeed.load({ confirm: () => { asked += 1; return true; } });
    assert.equal(result.status, 'loaded', h.messages.join('\n'));
    assert.equal(result.replaced, false);
    assert.equal(asked, 0, 'an empty store is loaded without a question');
    const plan = result.plan;
    assert.equal(plan.today, shared.localDateISO());
    const I = w.ERPIntegrity, data = I.business(), store = I.flow();
    const seeded = rows => rows.filter(r => r.demoSeed === true);
    assert.deepEqual([seeded(data.invoices).length, seeded(data.receipts).length, seeded(data.creditNotes).length, seeded(data.quotes).length, seeded(data.expenses).length], [23, 11, 4, 5, 16]); // ADR-023 tax-month story (was 18 / 8 / 4 / 5 / 11)

    for (const r of seeded(data.receipts).filter(x => !x.paymentId)) assert.doesNotThrow(() => I.validateReceipt(r, r.id), r.no);
    const statuses = {};
    for (const inv of seeded(data.invoices)) {
      const plan1 = finance.planInvoiceDocumentAction({ draft: inv, original: null, duplicateNumber: false });
      assert.deepEqual(plain(plan1.warnings), [], inv.no);
      const expected = Object.values(plan.expected.invoices).find(x => x.no === inv.no);
      const s = I.paymentSummary(inv);
      assert.deepEqual(plain([s.total, s.paid, s.credited, s.outstanding]), plain([expected.total, expected.paid, expected.credited, expected.outstanding]), inv.no);
      // Stored payment fields were reconciled exactly like after a real save.
      assert.deepEqual(plain([inv.paymentStatus, inv.paidAmount, inv.outstandingAmount]), plain([s.status, s.paid, s.outstanding]), inv.no);
      statuses[s.status] = (statuses[s.status] || 0) + 1;
      // Customer-agency fields equal what the app infers from the customer name.
      const agency = w.customerAgencyForRecord({ customer: inv.customer });
      assert.deepEqual([inv.customerAgencyGroup, inv.customerAgencyType], [agency.customerAgencyGroup, agency.customerAgencyType], inv.customer);
    }
    // Every paymentSummary status the app knows: paid · partially paid · unpaid · fully credited · cancelled.
    // ADR-023: + 3 abbreviated cash sales (paid), the replacement X2 (pending) and the cancelled X1.
    assert.deepEqual(plain(statuses), { paid: 10, partially_paid: 1, pending: 10, credited: 1, cancelled: 1 });
    assert.deepEqual(plain(cnCore.creditNoteLedgerIssues(data.invoices, data.creditNotes, { matches: I.creditNoteMatches })), []);
    // Each live credit note re-validates as an edit of itself against the stored ledger.
    const invoiceRows = data.invoices.map(i => ({ ...i }));
    for (const note of seeded(data.creditNotes).filter(n => !n.voided)) {
      const draft = { ...note, lines: note.lines.map(l => ({ invoiceId: l.invoiceId, invoiceNo: l.invoiceNo, invoiceBranch: l.invoiceBranch, differenceAmount: l.differenceAmount })) };
      const v = cnCore.validateCreditNote(draft, invoiceRows, data.creditNotes, [], { matches: I.creditNoteMatches });
      assert.deepEqual(plain(v.errors), [], note.no);
    }
    const payment = seeded(store.payments)[0];
    assert.equal(finance.assertIdempotentPaymentReceipts(payment, data.receipts).length, 2);
    const billing = w.ERPOrderFlow.getStore().billingNotes.find(b => b.demoSeed);
    assert.deepEqual(plain([billing.status, billing.paymentStatus, billing.outstandingAmount]), ['paid', 'paid', 0]);
    // Converted quotations keep their link after the save paths' normalisation.
    assert.equal(seeded(data.quotes).filter(q => q.invoiceNo && data.invoices.some(i => i.no === q.invoiceNo && String(i.sourceQuoteId) === String(q.id))).length, 2);
    // Stock: opening − sold + returned, never negative.
    for (const p of plan.products.filter(x => x.flowType === 'inventory')) {
      for (const [branch, opening] of [['ubon', p.openingStockUbon], ['khonkaen', p.openingStockKhonkaen]]) {
        const sold = sum(seeded(data.invoices).filter(i => i.branch === branch), i => sum(i.items.filter(it => it.productCode === p.code), it => it.qty));
        const returned = sum(seeded(data.creditNotes).filter(n => !n.voided && n.branch === branch), n => sum(n.returnItems.filter(it => it.productCode === p.code), it => it.qty));
        assert.equal(w.productEstimatedStock(p, branch), opening - sold + returned, `${p.code} ${branch}`);
        assert.ok(opening - sold + returned >= 0);
      }
    }
    // Reconciling again changes nothing (the stored state is already the reconciled state).
    const before = dumpStorage(w);
    I.reconcilePayments();
    assert.deepEqual(dumpStorage(w), before);
    // Sample data is not the prospect's Trial usage: a live demo on top of it is never blocked.
    const trial = await w.TrialService.loadTrial({ force: true });
    assert.deepEqual(plain([trial.counts.invoices, trial.counts.receipts, trial.counts.quotes, trial.counts.customers, trial.counts.products, trial.counts.billingNotes]), [0, 0, 0, 0, 0, 0]);
    assert.equal(w.TrialService.canCreate('invoices'), true);
    // The next number a user gets does not collide with any seeded number.
    w.go('invoice-form', null); w.resetF('invoice');
    const next = w.document.getElementById('i-no').value;
    assert.ok(next && !data.invoices.some(i => i.no === next), next);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('load: dashboard tiles, AR banner, AR report, governance aging and Decision Council are non-zero and agree', async () => {
  const h = await boot(); const { w } = h;
  try {
    const shared = await imp('erp-shared-core.js');
    const $ = id => w.document.getElementById(id);
    await waitFor(() => !!w.ERPProductExperience); await new Promise(r => setTimeout(r, 400));
    const { plan } = await w.ERPDemoSeed.load();
    const today = shared.localDateISO();
    const open = Object.values(plan.expected.invoices).filter(x => x.outstanding > 0);
    const overdue = open.filter(x => x.daysPastDue > 0);
    const arTotal = sum(open, x => x.outstanding), overdueTotal = sum(overdue, x => x.outstanding);
    // Hand-checked: 11 open invoices, 5 of them late (U2, U4, U3, K1, U0).
    // 157,023.60 current (ADR-023: + X2 6,955, the replacement of the cancelled X1) + 82,836 + 26,750 + 124,933.20
    // + 43,741.60 = 435,284.40; late = the last four = 278,260.80 (unchanged).
    assert.deepEqual([open.length, overdue.length, arTotal, overdueTotal], [11, 5, 435284.4, 278260.8]);

    // Receivables snapshot (report + banner source) and governance aging.
    const snap = w.ERPReceivables.snapshot('');
    assert.equal(snap.aging.totals.total, arTotal);
    assert.deepEqual([snap.alert.overdueCount, snap.alert.overdueTotal], [overdue.length, overdueTotal]);
    assert.ok(Object.entries(snap.aging.totals.buckets).filter(([k]) => k !== 'undated').every(([, v]) => v > 0), 'every aging bucket is populated');
    assert.equal(w.ERPGovernance.agingSnapshot(today).ar.total, arTotal);
    // Banner text.
    w.go('dashboard'); w.renderDash();
    await waitFor(() => !!$('ar-overdue-banner') && !$('ar-overdue-banner').hidden);
    assert.equal(text($('ar-overdue-banner').querySelector('b')), `มีใบแจ้งหนี้เกินกำหนด ${overdue.length} ใบ รวม ${shared.fmt(overdueTotal)} บาท`);
    // Report footer.
    await waitFor(() => /รวมทั้งหมด/.test(text($('ar-aging-report'))));
    const foot = [...$('ar-aging-report').querySelectorAll('tfoot th')].map(text);
    assert.equal(foot[0], 'รวมทั้งหมด');
    assert.equal(foot[1], String(open.length));
    assert.equal(foot[foot.length - 1], `฿${shared.fmt(arTotal)}`);
    // Decision Council: collections card agrees; converted quotations are not "ready for a Sales Order".
    const council = w.ERPDecisionCouncil.run();
    const ar1 = council.reviews.find(r => r.name === 'collections').findings.find(f => f.ruleId === 'AR_001');
    assert.ok(ar1, 'AR_001 finding');
    assert.match(ar1.title + ' ' + ar1.summary, new RegExp(`${overdue.length} ใบ`));
    assert.match(ar1.summary, new RegExp(overdueTotal.toLocaleString('th-TH', { maximumFractionDigits: 2 }).replace(/[.,]/g, '\\$&')));
    const convertedNos = recordsOf(plan, 'quotes').filter(q => q.invoiceNo).map(q => q.no);
    const sales1 = council.reviews.find(r => r.name === 'sales').findings.find(f => f.ruleId === 'SALES_001');
    assert.ok(!sales1 || convertedNos.every(no => !JSON.stringify(sales1).includes(no)), JSON.stringify(sales1));

    // Dashboard tiles vs per-branch profit, for a year that holds most of the sample data.
    const year = Number(shared.addBusinessCalendarDays(today, -30).slice(0, 4));
    const yearSel = $('dash-year');
    if (![...yearSel.options].some(o => o.value === String(year))) yearSel.add(new w.Option(String(year), String(year)));
    yearSel.value = String(year); $('dash-month').value = '-1';
    w.switchDashTab('all');
    const ub = w.testApp.branchStats('ubon', year, -1), kk = w.testApp.branchStats('khonkaen', year, -1);
    assert.ok(ub.st > 0 && kk.st > 0 && ub.gp > 0 && kk.gp > 0 && ub.net > 0 && kk.net > 0, JSON.stringify({ ub, kk }));
    // Independent recomputation from the plan: invoice subtotals − live credit-note subtotals in that year.
    const inYear = r => Number(r.date.slice(0, 4)) === year;
    for (const [branch, stats] of [['ubon', ub], ['khonkaen', kk]]) {
      // live invoices only: the cancelled sample invoice (ADR-023 / ADR-021) is not a sale
      const sales = sum(invoicesOf(plan).filter(i => i.branch === branch && inYear(i) && !i.voided), i => i.subtotal) - sum(recordsOf(plan, 'creditNotes').filter(n => n.branch === branch && !n.voided && inYear(n)), n => n.subtotal);
      assert.equal(stats.st, round2(sales), branch);
      assert.equal(stats.ex, sum(recordsOf(plan, 'expenses').filter(e => e.branch === branch && inYear(e)), e => e.amount), branch);
    }
    const tiles = text($('metrics-total'));
    assert.match(tiles, new RegExp(shared.fmt(round2(ub.st + kk.st)).replace(/[.,]/g, '\\$&')), tiles);
    assert.match(tiles, new RegExp(shared.fmt(round2(ub.net + kk.net)).replace(/[.,]/g, '\\$&')), tiles);
    assert.match(text($('dash-ub-rows')), new RegExp(`฿${shared.fmt(ub.st).replace(/[.,]/g, '\\$&')}`));
    assert.match(text($('dash-kk-rows')), new RegExp(`฿${shared.fmt(kk.st).replace(/[.,]/g, '\\$&')}`));
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('reset: asks first, removes exactly this app\'s keys (foreign keys survive), returns to first-run state and re-renders the current screen', async () => {
  const h = await boot(); const { w } = h;
  try {
    const $ = id => w.document.getElementById(id);
    const foreign = { 'another_app_setting': '{"keep":true}', [`erp_tenant::other-company::biz2_ubon_2026_09`]: '{"invoices":[{"id":1}]}', [`trial::other-company::x`]: '1' };
    const viewPref = `erp_tenant::${TENANT}::erp_product_experience_mode_v1`;
    Object.entries(foreign).forEach(([k, v]) => w.localStorage.setItem(k, v));
    w.localStorage.setItem(viewPref, 'advanced');
    w.localStorage.setItem(`trial::${TENANT}::quote-pdf-viewed`, '1');
    assert.equal((await w.ERPDemoSeed.load()).status, 'loaded');
    // A legacy (un-prefixed) order-flow key: the order-flow module would copy it into an empty store.
    w.localStorage.setItem('example_erp_order_flow_v2', JSON.stringify({ salesOrders: [{ id: 'legacy-so', no: 'SO-LEGACY' }] }));
    w.go('invoice-list');
    assert.ok(w.document.querySelectorAll('#itbl tr').length > 0, 'invoice list shows the sample invoices');

    // Declined → nothing changes.
    const loaded = dumpStorage(w);
    assert.equal((await w.ERPDemoSeed.reset({ confirm: () => false })).status, 'cancelled');
    assert.deepEqual(dumpStorage(w), loaded, 'reset declined → storage untouched');

    // Only sample data → one confirmation.
    const questions = [];
    const reset = await w.ERPDemoSeed.reset({ confirm: m => { questions.push(m); return true; } });
    assert.equal(reset.status, 'reset', h.messages.join('\n'));
    assert.equal(questions.length, 1);
    assert.match(questions[0], /ล้างข้อมูลสาธิตทั้งหมด \(รีเซ็ต\)\?/);
    assert.match(questions[0], /เอกสารตัวอย่าง 61 รายการ/); // ADR-023: 59 documents + billing note + payment (was 48)
    assert.match(questions[0], /ข้อมูลของเว็บ\/โปรแกรมอื่นใน Browser นี้/);
    // Every removed key was this app's; foreign keys, other tenants and the view preference survive.
    assert.ok(reset.removedKeys.every(k => k.startsWith(`erp_tenant::${TENANT}::`) || k.startsWith(`trial::${TENANT}::`) || k === 'example_erp_order_flow_v2'), reset.removedKeys.join('\n'));
    assert.ok(reset.removedKeys.includes(`trial::${TENANT}::quote-pdf-viewed`) && reset.removedKeys.includes('example_erp_order_flow_v2'));
    const after = dumpStorage(w);
    Object.entries(foreign).forEach(([k, v]) => assert.equal(after[k], v, k));
    assert.equal(after[viewPref], 'advanced');
    assert.equal(after['example_erp_order_flow_v2'], undefined, 'the legacy key cannot bring old Sales Orders back');
    // What is left is the first-run state: supplier seed rows, fresh audit logs — no documents.
    const ownKeys = Object.keys(after).filter(k => k.startsWith(`erp_tenant::${TENANT}::`)).map(k => k.slice(`erp_tenant::${TENANT}::`.length)).sort();
    assert.deepEqual(ownKeys, ['comform_audit_log_v1', 'comform_contact_master_v1', 'comform_governance_audit_v1', 'comform_sync_outbox_v1', 'erp_product_experience_mode_v1']);
    assert.equal(seededCount(w), 0);
    const business = w.ERPIntegrity.business();
    assert.deepEqual(['quotes', 'invoices', 'receipts', 'creditNotes', 'expenses'].map(c => business[c].length), [0, 0, 0, 0, 0]);
    assert.deepEqual(plain(w.ERPOrderFlow.getStore().salesOrders), []);
    assert.ok(w.contactMasterRows().length > 0 && w.contactMasterRows().every(r => r.role === 'supplier' && !r.demoSeed), 'first-run supplier seed is back');
    assert.ok(!w.productMasterRows().some(r => r.demoSeed));
    assert.match(JSON.parse(after[`erp_tenant::${TENANT}::comform_audit_log_v1`]).map(r => r.detail || '').join(' '), /ล้างข้อมูลสาธิตทั้งหมด/);
    // The screen the user is on was re-rendered.
    assert.equal(w.document.querySelector('.panel.active').id, 'panel-invoice-list');
    assert.equal(w.document.querySelectorAll('#itbl tr').length, 0);
    assert.equal($('iempty').style.display, 'block');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('load never mixes with or silently overwrites user data: refuses, offers the reset, needs two confirmations', async () => {
  const h = await boot(); const { w } = h;
  try {
    const userInvoice = await saveUserInvoice(h, 'บริษัท ลูกค้าจริง จำกัด');
    w.localStorage.setItem('another_app_setting', 'keep');
    const before = dumpStorage(w);

    // 1) Offer declined → refused, nothing changed.
    const asked = [];
    const refused = await w.ERPDemoSeed.load({ confirm: m => { asked.push(m); return false; } });
    assert.equal(refused.status, 'refused-user-data');
    assert.equal(asked.length, 1);
    assert.match(asked[0], /เอกสารที่บันทึกเอง 1 รายการ/);
    assert.match(asked[0], /จะไม่ผสมข้อมูลตัวอย่างเข้ากับข้อมูลจริง/);
    assert.match(asked[0], /ล้างข้อมูลสาธิตทั้งหมด \(รีเซ็ต\)/);
    assert.deepEqual(dumpStorage(w), before, 'refused → storage untouched');
    assert.match(h.messages.at(-1), /ข้อมูลของคุณยังอยู่ครบ/);

    // 2) Offer accepted, final confirmation declined → cancelled, nothing changed.
    const answers = [true, false];
    const cancelled = await w.ERPDemoSeed.load({ confirm: m => { asked.push(m); return answers.shift(); } });
    assert.equal(cancelled.status, 'cancelled');
    assert.match(asked.at(-1), /ยืนยันอีกครั้ง: ข้อมูลที่คุณบันทึกเองจะถูกลบถาวร/);
    assert.deepEqual(dumpStorage(w), before, 'final confirmation declined → storage untouched');

    // Reset alone also needs the second confirmation when user data exists.
    const resetAnswers = [true, false];
    assert.equal((await w.ERPDemoSeed.reset({ confirm: () => resetAnswers.shift() })).status, 'cancelled');
    assert.deepEqual(dumpStorage(w), before, 'reset: second confirmation declined → storage untouched');

    // 3) Both accepted → the store is emptied, then the sample data is loaded (not mixed).
    const loaded = await w.ERPDemoSeed.load({ confirm: () => true });
    assert.equal(loaded.status, 'loaded', h.messages.join('\n'));
    assert.equal(loaded.replaced, true);
    const invoices = w.ERPIntegrity.business().invoices;
    assert.equal(invoices.length, 23); // ADR-023 (was 18)
    assert.ok(invoices.every(i => i.demoSeed === true) && !invoices.some(i => i.id === userInvoice.id), 'no mixing');
    assert.ok(!w.findContactMaster('บริษัท ลูกค้าจริง จำกัด'));
    assert.equal(w.localStorage.getItem('another_app_setting'), 'keep', 'foreign key untouched');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('load over earlier sample data: one confirmation replaces it with a fresh set for the new date (no duplicates)', async () => {
  const h = await boot(); const { w } = h;
  try {
    const shared = await imp('erp-shared-core.js');
    const lastWeek = shared.addBusinessCalendarDays(shared.localDateISO(), -7);
    const first = await w.ERPDemoSeed.load({ today: lastWeek });
    assert.equal(first.status, 'loaded');
    const count = seededCount(w);
    const before = dumpStorage(w);
    const asked = [];
    assert.equal((await w.ERPDemoSeed.load({ confirm: m => { asked.push(m); return false; } })).status, 'cancelled');
    assert.equal(asked.length, 1);
    assert.match(asked[0], /ข้อมูลตัวอย่างชุดเดิม/);
    assert.deepEqual(dumpStorage(w), before, 'declined → untouched');

    const second = await w.ERPDemoSeed.load({ confirm: m => { asked.push(m); return true; } });
    assert.equal(second.status, 'loaded');
    assert.equal(asked.length, 2, 'no second confirmation: nothing of the user\'s is deleted');
    assert.equal(seededCount(w), count, 'no duplicates');
    const invoices = w.ERPIntegrity.business().invoices;
    assert.equal(invoices.length, 23); // ADR-023 (was 18)
    // Aging is right for TODAY again: the plan dates come from today, not from last week.
    const newest = invoices.map(i => i.date).sort().at(-1);
    assert.equal(newest, shared.addBusinessCalendarDays(shared.localDateISO(), -1));
    assert.equal(w.ERPReceivables.snapshot('').alert.overdueCount, 5);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

test('period lock on an otherwise empty store: load refuses and explains, nothing changes', async () => {
  const h = await boot(); const { w } = h;
  try {
    const shared = await imp('erp-shared-core.js');
    const today = shared.localDateISO();
    w.ERPGovernance.lockPeriod({ branch: 'khonkaen', scope: 'sales', throughDate: shared.addBusinessCalendarDays(today, -60), reason: 'ปิดงวด' });
    const beforeLoad = dumpStorage(w);
    const blocked = await w.ERPDemoSeed.load({ confirm: () => { throw new Error('an empty store must not ask'); } });
    assert.equal(blocked.status, 'period-locked');
    assert.ok(blocked.blocked.length > 0 && blocked.blocked.every(row => row.branch === 'khonkaen' && row.scope === 'sales'));
    assert.deepEqual(dumpStorage(w), beforeLoad);
    assert.match(h.messages.at(-1), /งวดบัญชีที่ปิดแล้ว/);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

// ADR-015: the five controls of the former green Local Demo banner are items of the header "Demo"
// menu (same order and actions; the ✓ / 📊 / ↺ symbols became line icons next to the same words).
test('UI: labelled controls in the header Demo menu and the dashboard empty state load and reset the sample data', async () => {
  const h = await boot(); const { w } = h;
  try {
    const $ = id => w.document.getElementById(id);
    await waitFor(() => !!$('erp-dashboard-empty')?.querySelector('[data-demo-seed-action="load"]') && !!$('local-demo-health-btn'));
    const bannerButtons = () => [...w.document.querySelectorAll('#erp-demo-menu [role="menuitem"]')];
    // local-demo-health.js adds its check item first; the sample-data controls wrap guide + backup.
    // ADR-020 added "ข้อมูลบริษัทและโลโก้" (order 15) to the Demo menu.
    assert.deepEqual(bannerButtons().map(text), ['ตรวจสถานะ Demo', 'ข้อมูลบริษัทและโลโก้', LOAD_LABEL.replace('📊 ', ''), 'วิธีเริ่มทดลอง', 'สำรองข้อมูล', RESET_LABEL.replace('↺ ', '')]);
    assert.equal($('local-demo-clear-btn'), null, 'the former separate clear button was merged into the reset');
    assert.ok(bannerButtons().every(b => !b.disabled));
    assert.equal($('erp-dashboard-empty').hidden, false);
    assert.match(text($('erp-dashboard-empty')), /โหลดลูกค้า สินค้า และเอกสารตัวอย่างย้อนหลังประมาณ 3 เดือน/);
    $('erp-dashboard-empty').querySelector('[data-demo-seed-action="load"]').click(); // harness confirm() answers yes
    assert.equal(await waitFor(() => w.ERPDemoSeed.isLoaded() && bannerButtons().every(b => !b.disabled)), true, h.messages.join('\n'));
    w.renderDash(); await tick();
    assert.equal($('erp-dashboard-empty').hidden, true, 'hint disappears once there is data');
    bannerButtons().find(b => text(b) === RESET_LABEL.replace('↺ ', '')).click();
    assert.equal(await waitFor(() => !w.ERPDemoSeed.isLoaded() && bannerButtons().every(b => !b.disabled)), true, h.messages.join('\n'));
    assert.equal(w.ERPIntegrity.business().invoices.length, 0);
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});

// Found with the sample data: the receipt list's "📄 ต้นฉบับ/สำเนา/PDF" (loadFromReceipt) did not take the
// buyer's address / tax ID / contact / phone, the settled invoice (D/O no.) or the due date from the
// receipt — the printed receipt showed them blank, or those of the receipt opened before (the editor
// state is a persisted draft).
test('printed receipt shows its own buyer details, never those of the receipt opened before', async () => {
  const h = await boot(); const { w } = h;
  try {
    assert.equal((await w.ERPDemoSeed.load()).status, 'loaded');
    const receipts = w.ERPIntegrity.business().receipts;
    const wht = receipts.find(r => r.whtAmount > 0);
    const walkIn = receipts.find(r => r.customer === GENERAL);
    const open = r => { w.openReceiptDocumentFromReceipt(r._branch, r._year, r._month, r.id); return w.ComformReceiptDocument.getState(); };
    const first = open(wht);
    assert.deepEqual([first.customerName, first.customerAddress, first.customerTaxId, first.contact, first.phone, first.doNo, first.dueDate],
      [wht.customer, wht.customerAddress, wht.customerTaxId, wht.contact, wht.phone, wht.invNo, '']);
    assert.ok(first.customerAddress && /^\d{13}$/.test(first.customerTaxId));
    const second = open(walkIn);
    assert.deepEqual([second.customerName, second.customerAddress, second.customerTaxId, second.contact, second.phone, second.doNo],
      [GENERAL, '', '', '', '', walkIn.invNo], 'nothing carried over from the previous receipt');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }
});
