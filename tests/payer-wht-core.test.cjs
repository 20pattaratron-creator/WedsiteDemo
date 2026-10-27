// ADR-024 (round 8, stage D) — pure rules of erp-payer-wht-core.js (payer-side withholding: 50 ทวิ, ภ.ง.ด.3 / ภ.ง.ด.53):
// spec §5e AC5.1–AC5.9, conditions 1 / 2 / 3 (4 refused), the 1,000-baht rule, numbering per establishment and พ.ศ.
// book, ใบแนบ columns (§5b2), due dates, filed snapshots (append-only, fail-closed) and the sample data's hand-worked
// ภ.ง.ด.3 / ภ.ง.ด.53 of September 2569. The booted app (form, print, tabs, filing, backup): tests/payer-wht.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const imp = file => import(pathToFileURL(path.join(ROOT, file)).href);
const plain = value => JSON.parse(JSON.stringify(value));
const JURISTIC = { payeeEntityType: 'company', payeeName: 'บจก. ผู้รับเงิน', payeeTaxId: '0105561007075', payeeBranchCode: '00000', payeeAddress: '1 ถนนทดสอบ' };
const PERSON = { payeeEntityType: 'person', payeeName: 'นายผู้ให้เช่า', payeeTaxId: '3340100123459', payeeAddress: '2 ถนนทดสอบ' };
const PAYER = { name: 'บริษัท สยามตัวอย่าง จำกัด', address: '99/9 กรุงเทพฯ', taxId: '0105568123453', branchCode: '00000' };

async function planned(fields) {
  const core = await imp('erp-payer-wht-core.js');
  // r8fix#A1: these fixtures pay non-VAT payees (amount = base) — say so; without it the planner now derives amount ÷ 1.07.
  return core.planExpenseWhtFields({ whtEnabled: true, date: '2026-09-15', whtCondition: 1, whtVatBasis: 'none', ...fields });
}
async function certificateOf(expense, extra = {}) {
  const core = await imp('erp-payer-wht-core.js');
  return core.buildWhtCertificate({ expense: { id: extra.id ?? 1, docNo: 'X', date: '2026-09-15', ...expense }, branch: extra.branch || 'ubon', payer: PAYER, bookNo: core.whtCertificateBookOf(expense.date || '2026-09-15'), certNo: extra.certNo || '0001', id: `wht-${extra.id ?? 1}`, at: '2026-09-15T03:00:00.000Z', by: 'test' });
}

test('wht#1 AC5.1 juristic service 10,000 + VAT 700, 3 %, condition 1 → WHT 300.00, net 10,400.00, ภ.ง.ด.53, row 5 "ค่าบริการ"', async () => {
  const plan = await planned({ ...JURISTIC, whtIncomeType: 'service', vatMode: 'add', subtotal: 10000, vatAmt: 700, amount: 10700 });
  assert.ok(plan.ok, plan.error);
  const f = plan.fields;
  assert.deepEqual([f.whtForm, f.whtIncomeType, f.whtIncomeLabel, f.whtIncomeRow, f.whtRate, f.whtCondition, f.whtBase, f.whtAmount, f.netPaid, f.whtPayerBorne, f.payeeBranchCode], ['PND53', 'service', 'ค่าบริการ', 5, 3, 1, 10000, 300, 10400, 0, '00000']);
  const cert = await certificateOf({ ...f, date: '2026-09-15' });
  assert.deepEqual([cert.form, cert.incomeRow, cert.incomeLabel, cert.amountPaid, cert.taxWithheld, cert.bookNo, cert.certNo, cert.no, cert.year, cert.month], ['PND53', 5, 'ค่าบริการ', 10000, 300, '2569', '0001', 'WHT2569-0001', 2026, 8]);
  const core = await imp('erp-payer-wht-core.js');
  const report = core.buildWhtFormReport({ period: '2026-09', form: 'PND53', certificates: [cert] });
  assert.deepEqual(plain(report.totals), { count: 1, payees: 1, amountPaid: 10000, taxWithheld: 300 }, 'in ภ.ง.ด.53 of the payment month');
  assert.equal(core.buildWhtFormReport({ period: '2026-10', form: 'PND53', certificates: [cert] }).rows.length, 0);
  assert.equal(core.buildWhtFormReport({ period: '2026-09', form: 'PND3', certificates: [cert] }).rows.length, 0, 'never in the other form');
});

test('wht#2 AC5.2 rent 20,000 to an individual (no VAT), 5 % → 1,000.00, ภ.ง.ด.3 (no payee branch); AC5.5 transport 1 %, advertising 2 %', async () => {
  const rent = await planned({ ...PERSON, whtIncomeType: 'rent', amount: 20000 });
  assert.deepEqual([rent.fields.whtForm, rent.fields.whtRate, rent.fields.whtAmount, rent.fields.netPaid, rent.fields.payeeBranchCode], ['PND3', 5, 1000, 19000, '']);
  const transport = await planned({ ...JURISTIC, whtIncomeType: 'transport', amount: 5000 });
  const ads = await planned({ ...JURISTIC, whtIncomeType: 'advertising', amount: 5000 });
  assert.deepEqual([transport.fields.whtAmount, transport.fields.whtRate, ads.fields.whtAmount, ads.fields.whtRate], [50, 1, 100, 2]);
  // Half-up to the satang: 3 % of 1,234.50 = 37.035 → 37.04.
  assert.equal((await planned({ ...JURISTIC, whtIncomeType: 'service', amount: 1234.5 })).fields.whtAmount, 37.04);
});

test('wht#3 AC5.3 condition 2 (ออกให้ตลอดไป) base 9,700 at 3 % → amount paid 10,000.00, WHT 300.00 borne by the payer; condition 3; condition 4 refused', async () => {
  const two = await planned({ ...JURISTIC, whtIncomeType: 'service', amount: 9700, whtCondition: 2 });
  assert.deepEqual([two.fields.whtCondition, two.fields.whtAgreedBase, two.fields.whtBase, two.fields.whtAmount, two.fields.whtPayerBorne, two.fields.netPaid], [2, 9700, 10000, 300, 300, 9700]);
  assert.match(two.warnings.join(' '), /ผู้จ่ายออกให้ \(ออกให้ตลอดไป\)/);
  const cert = await certificateOf({ ...two.fields });
  const core = await imp('erp-payer-wht-core.js');
  const table = core.whtReportTable(core.buildWhtFormReport({ period: '2026-09', form: 'PND53', certificates: [cert] }));
  assert.equal(table.body[0].at(-1), 2, 'ใบแนบ เงื่อนไข = 2');
  assert.deepEqual(table.body[0].slice(-3, -1), [10000, 300]);
  const three = await planned({ ...JURISTIC, whtIncomeType: 'service', amount: 9700, whtCondition: 3 });
  // r8fix#A2: was [9700, 291, 291, 9700] (tax on the base only) — ออกให้ครั้งเดียว taxes base + 291 once: 9,991.00 / 299.73.
  // r13#HIGH-1: the payer bears only the first 291.00; the 8.73 of tax on it is deducted from the payee (9,700 − 8.73).
  assert.deepEqual([three.fields.whtBase, three.fields.whtAmount, three.fields.whtPayerBorne, three.fields.whtFromPayee, three.fields.netPaid], [9991, 299.73, 291, 8.73, 9691.27]);
  const four = await planned({ ...JURISTIC, whtIncomeType: 'service', amount: 9700, whtCondition: 4 });
  assert.deepEqual([four.ok, four.error], [false, 'เงื่อนไข (4) อื่น ๆ ยังไม่รองรับในเดโม']);
});

test('wht#4 AC5.4 service 800 → nothing withheld by default (a note), override → 24.00; a typed base above the pre-VAT amount refused', async () => {
  const below = await planned({ ...JURISTIC, whtIncomeType: 'service', amount: 800 });
  assert.deepEqual([below.ok, below.fields], [true, null]);
  assert.match(below.warnings[0], /ต่ำกว่า 1,000 บาท/);
  const forced = await planned({ ...JURISTIC, whtIncomeType: 'service', amount: 800, whtBelowThresholdOverride: true });
  assert.deepEqual([forced.fields.whtAmount, forced.fields.whtBelowThresholdOverride], [24, true]);
  const partial = await planned({ ...JURISTIC, whtIncomeType: 'service', vatMode: 'extract', subtotal: 5000, vatAmt: 350, amount: 5350, whtBaseInput: '2000' });
  assert.deepEqual([partial.fields.whtBase, partial.fields.whtAmount, partial.fields.netPaid], [2000, 60, 5290]);
  const over = await planned({ ...JURISTIC, whtIncomeType: 'service', vatMode: 'extract', subtotal: 5000, vatAmt: 350, amount: 5350, whtBaseInput: '5350' });
  assert.match(over.error, /ไม่เกินยอดก่อน VAT ของค่าใช้จ่ายนี้ \(5000\.00 บาท\)/);
  const notTicked = await planned({ whtEnabled: false });
  assert.deepEqual([notTicked.ok, notTicked.fields], [true, null]);
  const other = await planned({ ...JURISTIC, whtIncomeType: 'other', amount: 5000 });
  assert.equal(other.error, 'กรุณาเลือกอัตราภาษีหัก ณ ที่จ่าย');
  const otherOk = await planned({ ...JURISTIC, whtIncomeType: 'other', whtRate: '2', whtIncomeText: 'ค่านายหน้าขาย', amount: 5000 });
  assert.deepEqual([otherOk.fields.whtIncomeRow, otherOk.fields.whtIncomeLabel, otherOk.fields.whtAmount], [6, 'ค่านายหน้าขาย', 100]);
});

test('wht#5 AC5.8 a payee without a 13-digit TIN cannot get a 50 ทวิ (spec wording); check digit / TIN prefix only warn; payee type required', async () => {
  for (const taxId of ['', '12345', '01055610070']) {
    const plan = await planned({ ...JURISTIC, payeeTaxId: taxId, whtIncomeType: 'service', amount: 5000 });
    assert.equal(plan.ok, false);
    assert.match(plan.error, /^ต้องมีเลขประจำตัวผู้เสียภาษี 13 หลัก/);
  }
  const badDigit = await planned({ ...JURISTIC, payeeTaxId: '0105561007070', whtIncomeType: 'service', amount: 5000 });
  assert.ok(badDigit.ok);
  assert.match(badDigit.warnings.join(' '), /หลักสุดท้ายไม่ตรงกับเลขตรวจสอบ/);
  const personAsCompany = await planned({ ...PERSON, payeeEntityType: 'company', whtIncomeType: 'rent', amount: 5000 });
  assert.match(personAsCompany.warnings.join(' '), /มักขึ้นต้นด้วย 0/);
  assert.equal((await planned({ ...JURISTIC, payeeEntityType: '', whtIncomeType: 'service', amount: 5000 })).error, 'กรุณาเลือกประเภทผู้ถูกหักภาษี: บุคคลธรรมดา (ภ.ง.ด.3) หรือนิติบุคคล (ภ.ง.ด.53)');
  const core = await imp('erp-payer-wht-core.js');
  assert.deepEqual([core.whtFormOf('company'), core.whtFormOf('person'), core.whtFormOf('individual'), core.whtFormOf('')], ['PND53', 'PND3', 'PND3', '']);
  assert.deepEqual([core.whtPayeeEntityOf({ entityType: 'individual' }), core.whtPayeeEntityOf({ entityType: 'company' }), core.whtPayeeEntityOf({})], ['person', 'company', '']);
});

test('wht#6 AC5.6 ภ.ง.ด.53 totals = Σ rows, rows by payment date then เลขที่; each certificate\'s ลำดับที่ = its row (filed snapshot first); voided left out', async () => {
  const core = await imp('erp-payer-wht-core.js');
  const mk = async (id, date, amount, rate, extra = {}) => certificateOf({ ...JURISTIC, payeeTaxId: extra.taxId || JURISTIC.payeeTaxId, whtForm: 'PND53', whtIncomeType: 'service', whtIncomeLabel: 'ค่าบริการ', whtIncomeRow: 5, whtRate: rate, whtCondition: 1, whtBase: amount, whtAmount: Math.round(amount * rate) / 100, date }, { id, certNo: String(id).padStart(4, '0') });
  const certs = [await mk(3, '2026-09-20', 2500, 1, { taxId: '0343559008881' }), await mk(1, '2026-09-05', 5000, 3), await mk(2, '2026-09-05', 1200, 3), await mk(4, '2026-09-28', 9999, 3)];
  certs[3] = core.applyWhtCertificateVoid(certs[3], { by: 't', reason: 'ผิด' });
  const report = core.buildWhtFormReport({ period: '2026-09', form: 'PND53', certificates: certs });
  assert.deepEqual(report.rows.map(r => [r.seq, r.certNo]), [[1, 'WHT2569-0001'], [2, 'WHT2569-0002'], [3, 'WHT2569-0003']]);
  assert.deepEqual(plain(report.totals), { count: 3, payees: 2, amountPaid: 8700, taxWithheld: 211 });
  assert.equal(report.totals.amountPaid, report.rows.reduce((s, r) => s + r.amountPaid, 0));
  for (const row of report.rows) assert.equal(core.whtCertificateSequence(certs.find(c => c.id === row.certId), certs, []), row.seq);
  assert.equal(core.whtCertificateSequence(certs[3], certs, []), 0, 'cancelled → not in the form');
  // After filing, the filed ลำดับที่ wins even when a later certificate of an earlier date is added.
  const filing = core.buildWhtFilingSnapshot({ filings: [], id: 'f1', branch: 'ubon', period: '2026-09', form: 'PND53', report, channel: 'efiling', filedAt: '2026-10-05T03:00:00.000Z', filedBy: 't', payer: PAYER });
  const late = await mk(5, '2026-09-01', 3000, 3);
  assert.equal(core.whtCertificateSequence(certs[1], [...certs, late], [filing]), 1);
  assert.equal(core.buildWhtFormReport({ period: '2026-09', form: 'PND53', certificates: [...certs, late] }).rows[0].certNo, 'WHT2569-0005');
  // Numbering per establishment and พ.ศ. book.
  assert.equal(core.nextWhtCertificateNumber(certs, 'ubon', '2569'), '0005');
  assert.equal(core.nextWhtCertificateNumber(certs, 'khonkaen', '2569'), '0001');
  assert.equal(core.nextWhtCertificateNumber(certs, 'ubon', '2570'), '0001');
  assert.equal(core.whtCertificateDisplayNo(certs[0]), 'เล่มที่ 2569 เลขที่ 0003');
  assert.equal(core.whtCertificateLedgerIssues([certs[0], { ...certs[0], id: 'x' }]).length, 1);
});

test('wht#7 §5b2 columns of ใบแนบ ภ.ง.ด.3 / ภ.ง.ด.53 in the official order; AC5.7 due dates of September 2569 (7 / 15 Oct 2026) with the weekend roll', async () => {
  const core = await imp('erp-payer-wht-core.js');
  assert.deepEqual(core.PND3_COLUMNS.map(c => c.label), ['ลำดับที่', 'เลขประจำตัวผู้เสียภาษีอากร', 'ชื่อผู้มีเงินได้ / ที่อยู่ของผู้มีเงินได้', 'วัน เดือน ปี ที่จ่าย', 'ประเภทเงินได้', 'อัตราภาษีร้อยละ', 'จำนวนเงินที่จ่ายแต่ละประเภท', 'จำนวนเงินภาษีที่หักและนำส่ง', 'เงื่อนไข']);
  assert.deepEqual(core.PND53_COLUMNS.map(c => c.label), ['ลำดับที่', 'เลขประจำตัวผู้เสียภาษีอากร', 'สาขาที่', 'ชื่อและที่อยู่ของผู้มีเงินได้', 'วัน เดือน ปี ที่จ่าย', 'ประเภทเงินได้พึงประเมินที่จ่าย', 'อัตราภาษีร้อยละ', 'จำนวนเงินที่จ่ายในครั้งนี้', 'จำนวนเงินภาษีที่หักและนำส่ง', 'เงื่อนไข']);
  const sept = core.whtDueDates('2026-09');
  assert.deepEqual([sept.paper, sept.efiling, sept.paperRolled, sept.efilingRolled], ['2026-10-07', '2026-10-15', false, false]);
  // November 2026 payments: 7 Dec 2026 is a Monday; February 2026 payments: 7 Mar 2026 is a Saturday → Monday 9 Mar,
  // 15 Mar 2026 is a Sunday → Monday 16 Mar.
  const feb = core.whtDueDates('2026-02');
  assert.deepEqual([feb.paper, feb.efiling, feb.paperRolled, feb.efilingRolled], ['2026-03-09', '2026-03-16', true, true]);
  // After the e-filing extension window the e-filing date falls back to the paper date and says "check".
  const late = core.whtDueDates('2027-03');
  assert.deepEqual([late.efiling === late.paper, late.checkLatest], [true, true]);
});

test('wht#8 AC5.9 certificate wording: both copy captions verbatim, the tax in Thai words; filed snapshots append-only and fail-closed', async () => {
  const core = await imp('erp-payer-wht-core.js');
  assert.equal(core.WHT_TEXT.copy1, 'ฉบับที่ 1 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย ใช้แนบพร้อมกับแบบแสดงรายการภาษี)');
  assert.equal(core.WHT_TEXT.copy2, 'ฉบับที่ 2 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย เก็บไว้เป็นหลักฐาน)');
  assert.equal(`${core.WHT_TEXT.certTitle} ${core.WHT_TEXT.certSubtitle}`, 'หนังสือรับรองการหักภาษี ณ ที่จ่าย ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร');
  const plan = await planned({ ...JURISTIC, whtIncomeType: 'service', amount: 10000 });
  const cert = await certificateOf(plan.fields);
  assert.equal(cert.taxText, 'สามร้อยบาทถ้วน');
  assert.deepEqual(plain(cert.payer), PAYER);
  // Snapshots: amendment numbers per slot, totals must equal the rows, unknown keys / bad values refused.
  const report = core.buildWhtFormReport({ period: '2026-09', form: 'PND53', certificates: [cert] });
  const first = core.buildWhtFilingSnapshot({ filings: [], id: 'f1', branch: 'ubon', period: '2026-09', form: 'PND53', report, channel: 'paper', filedAt: '2026-10-05T03:00:00.000Z', filedBy: 't', payer: PAYER });
  assert.deepEqual([first.amendment, first.dueDate, first.totals.taxWithheld], [0, '2026-10-07', 300]);
  const second = core.buildWhtFilingSnapshot({ filings: [first], id: 'f2', branch: 'ubon', period: '2026-09', form: 'PND53', report, channel: 'efiling', filedAt: '2026-10-06T03:00:00.000Z', filedBy: 't' });
  assert.deepEqual([second.amendment, second.dueDate], [1, '2026-10-15']);
  const store = core.normalizeWhtFilingsStore({ schemaVersion: 1, filings: [first, second] });
  assert.deepEqual(store.filings.map(f => f.id), ['f1', 'f2']);
  assert.equal(core.latestWhtFiling(store.filings, 'ubon', '2026-09', 'PND53').id, 'f2');
  assert.equal(core.whtPeriodFiled(store.filings, 'ubon', '2026-09'), true);
  assert.throws(() => core.normalizeWhtFilingsStore({ schemaVersion: 1, filings: [first, { ...second, amendment: 0 }] }), /อ่านไม่ได้หรือไม่ถูกต้อง/, 'one slot, one snapshot');
  assert.throws(() => core.normalizeWhtFiling({ ...first, totals: { ...first.totals, taxWithheld: 1 } }), /totals\.taxWithheld/);
  assert.throws(() => core.normalizeWhtFiling({ ...first, rows: [{ ...first.rows[0], amountPaid: -1 }] }), /amountPaid/);
  assert.throws(() => core.normalizeWhtFiling({ ...first, evil: '<script>' }), /evil/);
  assert.throws(() => core.parseWhtFilingsStore('{broken'), /อ่านไม่ได้/);
  assert.deepEqual(plain(core.parseWhtFilingsStore(null)), { schemaVersion: 1, filings: [] });
  assert.throws(() => core.buildWhtFilingSnapshot({ filings: [], id: 'f3', branch: 'ubon', period: '2026-10', form: 'PND53', report: core.buildWhtFormReport({ period: '2026-10', form: 'PND53', certificates: [cert] }), filedAt: '2026-11-01T00:00:00Z' }), /ไม่ต้องยื่นแบบ/);
  // Merge: the device copy wins for the same id / slot; replace = the backup's list.
  const edited = { ...first, filedBy: 'ไฟล์' };
  const merged = core.mergeWhtFilingsStores({ schemaVersion: 1, filings: [first] }, { schemaVersion: 1, filings: [edited, second] });
  assert.deepEqual(merged.filings.map(f => [f.id, f.filedBy]), [['f1', 't'], ['f2', 't']]);
  assert.deepEqual(core.mergeWhtFilingsStores({ schemaVersion: 1, filings: [first, second] }, { schemaVersion: 1, filings: [] }, { replace: true }).filings.map(row => row.id), [first.id, second.id]); // r8fix#B4: was [] — replace dropped filed ภ.ง.ด.; append-only now
  assert.equal(core.whtReportDiffersFromFiling(report, first), false);
  assert.equal(core.whtReportDiffersFromFiling({ rows: [] }, first), true);
});

test('wht#9 sample data: the 50 ทวิ of September 2569 at the head office; hand-worked ภ.ง.ด.3 6,000.00 / 300.00 and ภ.ง.ด.53 18,714.95 / 735.75 (r13#MED-7: + rent 5 % to the juristic landlord); VAT lines untouched', async () => {
  const core = await imp('erp-payer-wht-core.js');
  const seed = await imp('erp-demo-seed-core.js');
  for (const branchCount of [2, 1]) {
    const plan = seed.buildDemoSeedPlan({ today: '2026-10-05', branchCount, payer: () => PAYER });
    const certs = plan.documents.filter(d => d.collection === 'whtCertificates').map(d => ({ ...d.record, _year: d.year, _month: d.month }));
    const sept = certs.filter(c => c.branch === 'ubon' && c.date.startsWith('2026-09'));
    // Hand-worked: rent UL-6803 12,000 incl. VAT → base 11,214.95 × 5 % = 560.75 (juristic → ภ.ง.ด.53, ท.ป.4/2528 ข้อ 6(2));
    // rent 6,000 × 5 % = 300.00 (individual → ภ.ง.ด.3); transport 2,500 × 1 % = 25.00; the cloud service 5,350 incl. VAT →
    // base 5,000 × 3 % = 150.00 (ภ.ง.ด.53): 11,214.95 + 2,500 + 5,000 = 18,714.95 / 560.75 + 25 + 150 = 735.75, three payees.
    assert.deepEqual(sept.map(c => [c.date, c.form, c.payee.name, c.incomeLabel, c.rate, c.amountPaid, c.taxWithheld, c._month]), [
      ['2026-09-07', 'PND53', 'บจก. อุบลแลนด์', 'ค่าเช่า', 5, 11214.95, 560.75, 8],
      ['2026-09-10', 'PND3', 'นายสมศักดิ์ ใจงาม', 'ค่าเช่า', 5, 6000, 300, 8],
      ['2026-09-20', 'PND53', 'หจก. อุบลขนส่งด่วน', 'ค่าขนส่ง (ไม่ใช่ขนส่งสาธารณะ)', 1, 2500, 25, 8],
      ['2026-09-25', 'PND53', 'บจก. คลาวด์โซลูชั่น ไทย', 'ค่าบริการ', 3, 5000, 150, 8]
    ], `branchCount ${branchCount}`);
    // เลขที่ runs per payer establishment and book (พ.ศ. year), in payment-date order, never twice.
    for (const branch of ['ubon', 'khonkaen']) {
      const mine = certs.filter(c => c.branch === branch).sort((a, b) => a.date.localeCompare(b.date));
      assert.deepEqual(mine.map(c => c.certNo), mine.map((_, index) => String(index + 1).padStart(4, '0')), `${branch} numbering`);
    }
    assert.deepEqual(plain(core.buildWhtFormReport({ period: '2026-09', form: 'PND3', certificates: certs.filter(c => c.branch === 'ubon') }).totals), { count: 1, payees: 1, amountPaid: 6000, taxWithheld: 300 });
    assert.deepEqual(plain(core.buildWhtFormReport({ period: '2026-09', form: 'PND53', certificates: certs.filter(c => c.branch === 'ubon') }).totals), { count: 3, payees: 3, amountPaid: 18714.95, taxWithheld: 735.75 });
    if (branchCount === 2) assert.deepEqual(plain(core.buildWhtFormReport({ period: '2026-09', form: 'PND53', certificates: certs.filter(c => c.branch === 'khonkaen') }).totals), { count: 1, payees: 1, amountPaid: 8411.21, taxWithheld: 420.56 }, 'branch: rent KP-6803 9,000 → 8,411.21 × 5 % = 420.56');
    assert.ok(certs.every(c => c.payer.taxId === PAYER.taxId && c.demoSeed === true));
    const expenses = plan.documents.filter(d => d.collection === 'expenses' && d.record.whtAmount > 0 && d.branch === 'ubon' && d.record.date.startsWith('2026-09')).map(d => d.record);
    assert.deepEqual(expenses.map(e => [e.docNo, e.amount, e.netPaid, e.whtCertId === `wht-${e.id}`]), [['UL-6803', 12000, 11439.25, true], ['RC-0910', 6000, 5700, true], ['UT-6909-031', 2500, 2475, true], ['CS-2026-0925', 5350, 5200, true]]);
    // The cloud invoice keeps its purchase VAT (5,000 / 350 claimed in October) — withholding changes no VAT figure.
    const cloud = expenses.find(e => e.docNo === 'CS-2026-0925');
    assert.deepEqual([cloud.subtotal, cloud.vatAmt, cloud.claimPeriod, cloud.lateClaimReason], [5000, 350, '2026-10', 'trade_custom']);
    assert.ok(seed.demoSeedPeriods(plan).filter(row => /^WHT/.test(row.no)).every(row => row.scope === 'purchase'));
    // The payees are in Supplier Master with their WHT income type and VAT registration (r13#MED-1).
    assert.deepEqual(plan.suppliers.filter(s => s.whtIncomeType).map(s => [s.name, s.entityType, s.whtIncomeType, s.vatRegistered]), [['บจก. คลาวด์โซลูชั่น ไทย', 'company', 'service', 'yes'], ['นายสมศักดิ์ ใจงาม', 'person', 'rent', 'no'], ['ขนส่งด่วนอีสาน', 'person', 'transport', 'no'], ['นายวิชัย ช่างไฟฟ้า', 'person', 'hire_of_work', 'no'], ['บจก. อีสานเครนเซอร์วิส', 'company', 'hire_of_work', 'no'], ['หจก. อุบลขนส่งด่วน', 'company', 'transport', 'no']]);
  }
});

test('wht#10 pure core, one TEXT object per module; customer WHT (receipts) never reaches the payer-side forms', async () => {
  const core = fs.readFileSync(path.join(ROOT, 'erp-payer-wht-core.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(core, /\bdocument\.|\blocalStorage\b|\bwindow\.|Date\.now\(|Math\.random\(/);
  assert.equal((fs.readFileSync(path.join(ROOT, 'erp-payer-wht-core.js'), 'utf8').match(/^export const WHT_TEXT = Object\.freeze\(/gm) || []).length, 1);
  const ui = fs.readFileSync(path.join(ROOT, 'erp-payer-wht.js'), 'utf8');
  assert.equal((ui.match(/^const [A-Z_]*TEXT = Object\.freeze\(/gm) || []).length, 1, 'erp-payer-wht.js: one TEXT object');
  // The ภ.ง.ด. report reads certificates only — a receipt with customer WHT (whtAmount on a receipt) is not one.
  const wht = await imp('erp-payer-wht-core.js');
  const receiptLike = { id: 'r1', no: 'REC690901', date: '2026-09-10', whtAmount: 300, whtRate: 3, cashReceived: 10400 };
  assert.equal(wht.buildWhtFormReport({ period: '2026-09', form: 'PND53', certificates: [receiptLike] }).rows.length, 0);
});
