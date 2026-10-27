// R9.1 — the sample data's dates do not depend on the day it is loaded where the demo scripts quote a fixed figure
// (ADR-013 "Dates (R9.1)"). Found in Chromium on 13 Oct 2569: the September ภ.พ.30 of the sample showed L1 79,070.00 /
// L11 2,894.85 when loaded on 5 Oct but 65,570.00 / 1,949.85 on 12 Oct and 62,070.00 / 1,949.85 on 13 Oct, because
// INV690904 (13,500) and the exempt INV690903 (3,500) were dated "today − n days" and slid into October; every
// earlier test fixed the clock at 4–5 Oct.
// Pure core only (fast suite). The booted page (รายงานภาษี opens on the story month, TH + EN): r91-seed-dates-app.
// Every test here fails on round9-en (/tmp/claude-0/r91-newtests-on-base.log) and passes now.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const imp = file => import(pathToFileURL(path.join(ROOT, file)).href);
const plain = value => JSON.parse(JSON.stringify(value));
const round2 = value => Math.round(value * 100) / 100;

// Every day from 1 Oct 2569 to 31 Jan 2570 (two month changes with 30 / 31 / 31 days, the year end and the พ.ศ.
// change), plus month ends, the first days after a 28- and a 29-day February, 29 Feb 2028 and another year boundary.
function loadDates() {
  const out = [];
  for (let d = new Date(Date.UTC(2026, 9, 1)); d <= new Date(Date.UTC(2027, 0, 31)); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  out.push('2027-02-01', '2027-02-28', '2027-03-01', '2027-03-31', '2027-04-30', '2027-05-31', '2027-07-31', '2027-08-01', '2027-08-31', '2027-09-30', '2027-12-31', '2028-01-01', '2028-01-31', '2028-02-28', '2028-02-29', '2028-03-01', '2028-03-31');
  return out;
}
const DATES = loadDates();
const periodOfRow = d => `${d.year}-${String(d.month + 1).padStart(2, '0')}`;
// The plan as the tax pages read it (the same selection as tests/tax-reports-core.test.cjs planSources): sales
// documents of the month, every expense (a claim may sit in an earlier pack), and the 50 ทวิ.
function planSources(plan, period, branches) {
  const docs = plan.documents.filter(d => branches.includes(d.branch));
  const of = (branch, collection) => docs.filter(d => d.branch === branch && d.collection === collection && periodOfRow(d) === period).map(d => d.record);
  return {
    sales: branches.map(branch => ({ branch, invoices: of(branch, 'invoices'), creditNotes: of(branch, 'creditNotes'), debitNotes: of(branch, 'debitNotes') })),
    purchases: branches.map(branch => ({ branch, expenses: docs.filter(d => d.branch === branch && d.collection === 'expenses').map(d => d.record), goodsReceipts: plan.costing.goodsReceipts.filter(gr => gr.branch === branch) })), // r13#HIGH-2
    certificates: docs.filter(d => d.collection === 'whtCertificates').map(d => d.record)
  };
}
// "INV690901" → "INV{S}01": document numbers carry พ.ศ. yy + mm of their month, which moves with S by design.
function normalizer(period) {
  const [y, m] = period.split('-').map(Number);
  const yymm = `${String(y + 543).slice(-2)}${String(m).padStart(2, '0')}`;
  return value => String(value).split(yymm).join('{S}');
}
// Everything the ภ.พ.30 / ภ.ง.ด. / 50 ทวิ pages show for S, without the dates (a 28-day February moves a day-15 row
// to the 13th — still in S, same figures, same order).
async function storyFigures(plan, branches) {
  const tax = await imp('erp-tax-reports-core.js');
  const wht = await imp('erp-payer-wht-core.js');
  const period = plan.storyPeriod;
  const norm = normalizer(period);
  const src = planSources(plan, period, branches);
  const sales = tax.buildSalesTaxReport({ period, sources: src.sales, entryDate: () => '' });
  const purchases = tax.buildPurchaseTaxReport({ period, sources: src.purchases, entryDate: () => '' });
  const pp30 = tax.buildPp30Summary({ sales, purchases });
  const whtForm = form => wht.buildWhtFormReport({ period, form, certificates: src.certificates });
  const next = tax.addTaxPeriods(period, 1);
  return plain({
    lines: pp30.lines,
    sales: { rows: sales.rows.map(r => [r.kind, norm(r.no), r.party, r.value, r.vat]), totals: sales.totals },
    purchases: {
      rows: purchases.rows.map(r => [r.party, r.taxId, r.branchCode, r.value, r.vat]), totals: purchases.totals,
      forbidden: purchases.forbidden.map(r => [r.party, r.reason, r.value, r.vat]), forbiddenTotals: purchases.forbiddenTotals,
      deferred: purchases.deferred.map(r => [r.party, r.value, r.vat, r.claimPeriod === next ? 'next month' : r.claimPeriod]),
      incomplete: purchases.incomplete.map(r => [r.vendor, r.amount])
    },
    pnd3: { rows: whtForm('PND3').rows.map(r => [r.payeeName, r.rate, r.amountPaid, r.taxWithheld]), totals: whtForm('PND3').totals },
    pnd53: { rows: whtForm('PND53').rows.map(r => [r.payeeName, r.payeeBranchCode, r.rate, r.amountPaid, r.taxWithheld]), totals: whtForm('PND53').totals },
    // r13#MED-7: เลขที่ runs through the พ.ศ. book in payment order and the rent payments of the relative months (dated from
    // today) come before S in some load years — so the certificate NUMBER is not part of the fixed story (its payee and tax are).
    certificates: src.certificates.filter(c => tax.taxPeriodOfDate(c.date) === period).map(c => [c.branch, c.payee?.name, c.taxWithheld])
  });
}

test('r91#1 the story month: ภ.พ.30 (HQ, branch, combined, one-branch mode), ภ.ง.ด.3 / 53, the 50 ทวิ and the debit note are identical for every load date — and equal the hand-worked September 2569 figures', async () => {
  const seed = await imp('erp-demo-seed-core.js');
  const views = [[2, ['ubon']], [2, ['khonkaen']], [2, ['ubon', 'khonkaen']], [1, ['ubon']]];
  const canonical = {};
  for (const [branchCount, branches] of views) canonical[`${branchCount}|${branches}`] = await storyFigures(seed.buildDemoSeedPlan({ today: '2026-10-05', branchCount }), branches);
  // The hand-worked figures (tests/tax-reports-core.test.cjs tax#13, docs/DEMO_SCRIPT_TH.md): HQ L1 79,070 · L3 3,500 · L4 75,570 ·
  // L5 5,289.90 · L6 41,114.95 · L7 2,878.05 · L8 = L11 2,411.85 (r13#HIGH-2: + GR690901 6,900.00 / 483.00); branch L11 3,827.46;
  // combined L11 6,239.31; one branch 7,037.45.
  const hq = canonical['2|ubon'];
  assert.deepEqual(hq.lines, { 1: 79070, 2: 0, 3: 3500, 4: 75570, 5: 5289.9, 6: 41114.95, 7: 2878.05, 8: 2411.85, 9: 0, 10: 0, 11: 2411.85, 12: 0 });
  assert.deepEqual(hq.sales.rows.map(r => [r[1], r[3], r[4]]), [['CN{S}02', -3590, -251.3], ['CN{S}03', -1500, -105], ['INV{S}01', 53900, 3773], ['INV{S}04', 13500, 945], ['DN{S}01', 1500, 105], ['INV{S}06 – INV{S}08', 5260, 368.2], ['INV{S}09', 0, 0], ['INV{S}10', 6500, 455]]);
  assert.deepEqual([hq.purchases.totals, hq.purchases.forbiddenTotals, hq.purchases.deferred, hq.purchases.incomplete], [{ value: 41114.95, vat: 2878.05 }, { value: 1500, vat: 105 }, [['บจก. คลาวด์โซลูชั่น ไทย', 5000, 350, 'next month']], [['บจก. โฆษณาออนไลน์ตัวอย่าง', 8000]]]);
  // r13#MED-7: + rent UL-6803 to the juristic landlord 11,214.95 × 5 % = 560.75 → ภ.ง.ด.53 18,714.95 / 735.75.
  assert.deepEqual([hq.pnd3.totals, hq.pnd53.totals], [{ count: 1, payees: 1, amountPaid: 6000, taxWithheld: 300 }, { count: 3, payees: 3, amountPaid: 18714.95, taxWithheld: 735.75 }]);
  assert.deepEqual(hq.certificates, [['ubon', 'บจก. อุบลแลนด์', 560.75], ['ubon', 'นายสมศักดิ์ ใจงาม', 300], ['ubon', 'หจก. อุบลขนส่งด่วน', 25], ['ubon', 'บจก. คลาวด์โซลูชั่น ไทย', 150]]);
  assert.equal(canonical['2|khonkaen'].lines[11], 3827.46);
  assert.deepEqual(canonical['2|khonkaen'].pnd53.totals, { count: 1, payees: 1, amountPaid: 8411.21, taxWithheld: 420.56 });
  assert.deepEqual([canonical['2|ubon,khonkaen'].lines[1], canonical['2|ubon,khonkaen'].lines[11]], [145150, 6239.31]);
  assert.equal(canonical['1|ubon'].lines[11], 7037.45);

  const drift = [];
  for (const today of DATES) {
    const plans = { 2: seed.buildDemoSeedPlan({ today, branchCount: 2 }), 1: seed.buildDemoSeedPlan({ today, branchCount: 1 }) };
    for (const [branchCount, branches] of views) {
      const key = `${branchCount}|${branches}`;
      const got = await storyFigures(plans[branchCount], branches);
      if (JSON.stringify(got) !== JSON.stringify(canonical[key])) drift.push(`${today} ${key}: L1 ${got.lines[1]} L5 ${got.lines[5]} L11 ${got.lines[11]}`);
    }
  }
  assert.deepEqual(drift, [], `story figures moved with the load date (${DATES.length} dates)`);
});

test('r91#2 dates: nothing is dated after today; the story month is the latest closed month (January → December of the year before); every row sits on its own clock', async () => {
  const seed = await imp('erp-demo-seed-core.js');
  const tax = await imp('erp-tax-reports-core.js');
  const shared = await imp('erp-shared-core.js');
  assert.equal(seed.RELATIVE_MIN_AGE_DAYS, 62);
  assert.deepEqual(['2026-10-05', '2026-10-31', '2027-01-03', '2028-03-01', '2028-02-29'].map(seed.demoSeedStoryPeriod), ['2026-09', '2026-09', '2026-12', '2028-02', '2028-01']);
  for (const today of DATES) for (const branchCount of [2, 1]) {
    const plan = seed.buildDemoSeedPlan({ today, branchCount });
    const S = tax.addTaxPeriods(tax.taxPeriodOfDate(today), -1), before = tax.addTaxPeriods(S, -1), current = tax.taxPeriodOfDate(today);
    assert.equal(plan.storyPeriod, S, today);
    const where = d => `${today} ${d.collection} ${d.record.no || d.record.docNo || d.record.desc} ${d.record.date}`;
    for (const d of plan.documents) {
      const r = d.record, month = tax.taxPeriodOfDate(r.date);
      assert.ok(r.date <= today, `after today: ${where(d)}`);
      assert.equal(periodOfRow(d), month, `stored in its own month: ${where(d)}`);
      for (const field of ['voidedAt', 'taxInvoiceReceivedDate', 'taxInvoiceDate']) if (r[field]) assert.ok(String(r[field]).slice(0, 10) <= today, `${field} after today: ${where(d)}`);
      if (r.claimPeriod) assert.ok(r.claimPeriod <= current, `claim month in the future: ${where(d)}`);
      // The clocks: the story rows in S, the rows of the month before in it, nothing else in S except open quotations.
      if (r.demoSeedStory === 'tax-month') assert.equal(month, S, where(d));
      else if (r.demoSeedStory === 'month-before') assert.equal(month, before, where(d));
      else if (d.collection !== 'quotes') assert.ok(month !== S && month !== before ? true : month === before && shared.businessDaysBetween(r.date, today) >= seed.RELATIVE_MIN_AGE_DAYS, `an undated-story row in S or the month before: ${where(d)}`);
      if (month === S && d.collection !== 'quotes') assert.equal(r.demoSeedStory, 'tax-month', `in S but not pinned: ${where(d)}`);
      // Running numbers follow the document's own month.
      if (r.no && d.collection !== 'whtCertificates') assert.match(r.no, new RegExp(`^[A-Z]+${String(Number(month.slice(0, 4)) + 543).slice(-2)}${month.slice(5)}\\d{2}$`), where(d));
    }
    // The 82/3 case: the cloud invoice arrives at the end of S and is claimed in the month after — today's month, never later.
    const cloud = plan.documents.find(d => d.collection === 'expenses' && d.record.vendor === 'บจก. คลาวด์โซลูชั่น ไทย').record;
    assert.deepEqual([tax.taxPeriodOfDate(cloud.date), tax.taxPeriodOfDate(cloud.taxInvoiceReceivedDate), cloud.claimPeriod], [S, S, current], today);
    // Debit note, its invoice and the 50 ทวิ links stay in S and point at each other.
    const dn = plan.documents.find(d => d.collection === 'debitNotes').record;
    const x2 = plan.documents.find(d => d.collection === 'invoices' && d.record.no === dn.invoiceNos[0]).record;
    assert.deepEqual([tax.taxPeriodOfDate(dn.date), tax.taxPeriodOfDate(x2.date), dn.total, plan.expected.invoices.X2.outstanding], [S, S, 1605, 8560], today);
    // r13#MED-7: 50 ทวิ are also issued for the rent / transport / subcontract payments of earlier months — each one on its
    // expense's payment date, in the pack of that month, in the พ.ศ. book of that date.
    for (const cert of plan.documents.filter(d => d.collection === 'whtCertificates').map(d => d.record)) {
      const expense = plan.documents.find(d => d.collection === 'expenses' && d.record.id === cert.sourceExpenseId).record;
      assert.deepEqual([expense.whtCertId, expense.whtCertNo, cert.date, cert.date <= today], [cert.id, cert.no, expense.whtPaymentDate || expense.date, true], today);
      assert.equal(cert.no.slice(3, 7), String(Number(cert.date.slice(0, 4)) + 543), 'เล่มที่ = พ.ศ. of the payment');
    }
    for (const row of [...plan.flow.billingNotes.map(b => b.billingDate), ...plan.flow.payments.map(p => p.date)]) assert.ok(row <= today && tax.taxPeriodOfDate(row) === S, `${today} billing/payment ${row}`);
    // Supplier numbers and the month in a description name the row's own month (no "เดือนกันยายน" in December).
    const rent = plan.documents.find(d => d.collection === 'expenses' && d.record.vendor === 'นายสมศักดิ์ ใจงาม').record;
    assert.equal(rent.desc, `ค่าเช่าห้องเก็บสินค้า เดือน${tax.TAX_CORE_TEXT.monthNames[Number(S.slice(5)) - 1]} (ผู้ให้เช่าเป็นบุคคลธรรมดา)`);
  }
  // Year boundary: 3 Jan 2570 → the story month is ธันวาคม 2569 (numbers INV6912…), the walk-in sales of 1–2 Jan are in 2570.
  const jan = seed.buildDemoSeedPlan({ today: '2027-01-03' });
  assert.equal(jan.storyPeriod, '2026-12');
  assert.ok(jan.documents.filter(d => d.record.demoSeedStory === 'tax-month').every(d => /^2026-12-/.test(d.record.date)));
  assert.deepEqual(jan.documents.filter(d => d.collection === 'invoices' && d.record.taxInvoiceForm === 'abbreviated' && !d.record.demoSeedStory).map(d => [d.record.date, d.record.no]), [['2027-01-01', 'INV700101'], ['2027-01-02', 'INV700102']]);
  // On the 1st of a month the "yesterday / the day before" walk-in sales are dated today, never in S.
  const first = seed.buildDemoSeedPlan({ today: '2026-11-01' });
  assert.deepEqual(first.documents.filter(d => d.collection === 'invoices' && d.record.taxInvoiceForm === 'abbreviated' && !d.record.demoSeedStory).map(d => d.record.date), ['2026-11-01', '2026-11-01']);
});

test('r91#3 the figures the demo scripts state as fixed: AR total, the four exact-age invoices, never-due / always-overdue bills, the sales of the history and of the story month — and the whole aging on days 1–9 of any month', async () => {
  const seed = await imp('erp-demo-seed-core.js');
  const ar = await imp('erp-receivables-core.js');
  const aging = plan => {
    const byNo = new Map(Object.values(plan.expected.invoices).map(x => [x.no, x]));
    const items = ar.buildReceivableItems(plan.documents.filter(d => d.collection === 'invoices').map(d => d.record), { asOf: plan.today, summarize: inv => byNo.get(inv.no) });
    return plain(ar.summarizeReceivableAging(items).totals);
  };
  const canonical = aging(seed.buildDemoSeedPlan({ today: '2026-10-05' }));
  assert.deepEqual([canonical.total, canonical.overdue, canonical.invoiceCount, canonical.customerCount, canonical.buckets], [436889.4, 278260.8, 11, 8, { current: 158628.6, '1_30': 82836, '31_60': 26750, '61_90': 124933.2, over_90: 43741.6, undated: 0 }]);
  const salesOf = plan => round2(plan.documents.reduce((sum, { collection, record }) => {
    if (collection === 'invoices' && !record.voided) return sum + record.subtotal;
    if (collection === 'creditNotes' && !record.voided) return sum - record.subtotal;
    if (collection === 'debitNotes' && !record.voided) return sum + record.subtotal;
    return sum;
  }, 0));
  const expensesOf = plan => round2(plan.documents.filter(d => d.collection === 'expenses').reduce((sum, d) => sum + d.record.amount, 0));
  // The dashboard's month view of the story month (sales − credit notes + debit notes, expenses): the same on every load
  // date — before R9.1 rows slid in and out of it with the load day. (The month before S also holds the pinned rows, but
  // the old unpaid bills dated from today may fall into it too, so its total is not fixed.)
  const tax = await imp('erp-tax-reports-core.js');
  const monthView = plan => [0].map(k => {
    const period = tax.addTaxPeriods(plan.storyPeriod || tax.addTaxPeriods(tax.taxPeriodOfDate(plan.today), -1), k);
    const inMonth = { ...plan, documents: plan.documents.filter(d => periodOfRow(d) === period) };
    return [salesOf(inMonth), expensesOf(inMonth)];
  });
  const canonicalMonths = monthView(seed.buildDemoSeedPlan({ today: '2026-10-05' }));
  const extraDates = [];
  for (let y = 2026; y <= 2028; y += 1) for (let m = 0; m < 12; m += 1) for (let day = 1; day <= 9; day += 1) extraDates.push(new Date(Date.UTC(y, m, day)).toISOString().slice(0, 10));
  for (const today of [...DATES, ...extraDates]) {
    const plan = seed.buildDemoSeedPlan({ today });
    const e = plan.expected.invoices;
    const totals = aging(plan);
    assert.deepEqual([totals.total, totals.invoiceCount, totals.customerCount], [436889.4, 11, 8], `${today} AR total`);
    assert.deepEqual([e.U0, e.K1, e.U3, e.U2].map(x => x.daysPastDue), [100, 62, 45, 10], `${today} exact-age invoices`);
    assert.ok(e.U4.daysPastDue > 0 && e.U4.daysPastDue <= 60, `${today} U4 always overdue (${e.U4.daysPastDue})`);
    assert.ok(e.K6.daysPastDue <= 0 && e.X2.daysPastDue <= 0, `${today} the 60-day bills are never due in today's month`);
    // Every aging bucket is filled on every load date (ADR-013).
    for (const bucket of ['current', '1_30', '31_60', '61_90', 'over_90']) assert.ok(totals.buckets[bucket] > 0, `${today} bucket ${bucket}`);
    assert.equal(totals.buckets.over_90, 43741.6, `${today} over 90 = บจก. มูลมั่งมี 100 days`);
    assert.equal(totals.buckets['61_90'], 124933.2, `${today} 61–90 = หจก. ขอนแก่นรุ่งเรืองก่อสร้าง 62 days`);
    // Sales before VAT − credit notes + debit notes (the dashboard's "ทุกเดือน" over the whole history) and expenses.
    // r13#MED-7: + the two subcontract payments of jobs J1 (1,500) and J3 (1,600) — expenses 121,815 → 124,915.
    // ADR-031 (r13B): + the multi-currency story of S−3 (USD export 97,962.90 before VAT; JPY service from Japan
    // 26,814.72) — sales 716,010 → 813,972.90, expenses 124,915 → 151,729.72. The aging (all paid) and S do not change.
    assert.deepEqual([salesOf(plan), expensesOf(plan)], [813972.9, 151729.72], `${today} history totals`);
    assert.deepEqual(monthView(plan), canonicalMonths, `${today} the story month on the dashboard`);
    if (Number(today.slice(8, 10)) <= 9) assert.deepEqual(totals, canonical, `${today}: days 1–9 show the script's aging`);
  }
});
