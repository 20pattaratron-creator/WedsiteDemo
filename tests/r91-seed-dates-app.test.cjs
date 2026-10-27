// R9.1 in the booted app (jsdom): load the sample data on different days (the browser clock pinned, as on the
// presenter's laptop) and the รายงานภาษี page opens on the story month — the latest closed month, also across the
// year end — says so, and shows the hand-worked ภ.พ.30 / ภ.ง.ด.3 / ภ.ง.ด.53 of the demo scripts, in Thai and in
// English. A load with an explicit date (ERPDemoSeed.load({ today })) opens the page on that date's story month.
// Pure rules (every load date from 1 Oct 2569 to 31 Jan 2570 and more): tests/r91-seed-dates.test.cjs.
// Every test here fails on round9-en (/tmp/claude-0/r91-newtests-on-base.log) and passes now.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./dom-helper.cjs');
const { bootEnglish, settle } = require('./i18n-helper.cjs');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = el => String(el?.textContent || '').replace(/\s+/g, ' ').trim();
// The browser clock of the demo laptop: `new Date()` / Date.now() answer `day` 10:00 Bangkok time.
const pinClock = day => w => {
  const fixed = Date.parse(`${day}T10:00:00+07:00`);
  const Real = w.Date;
  w.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(fixed); } static now() { return fixed; } };
};
// r13#HIGH-2: + GR690901 6,900.00 / VAT 483.00 (L6 / L7), L8 = L11 5,289.90 − 2,878.05 = 2,411.85.
const HQ = { 1: 79070, 2: 0, 3: 3500, 4: 75570, 5: 5289.9, 6: 41114.95, 7: 2878.05, 8: 2411.85, 9: 0, 10: 0, 11: 2411.85, 12: 0 };
const NOTE_TH = 'เดือนภาษีล่าสุดที่ปิดแล้ว (เดือนก่อน) — หน้านี้เปิดที่เดือนนี้ให้อัตโนมัติ เลือกเดือน/ปีอื่นได้';

async function openTab(w, tab) {
  w.go('tax-reports', null);
  await sleep(30);
  w.document.querySelector(`#tax-reports-root [data-tax-tab="${tab}"]`).click();
  await sleep(10);
  return w.ERPTaxReports.view();
}
function selected(w) {
  const value = id => w.document.getElementById(id)?.value;
  return { month: value('tax-rpt-month'), year: value('tax-rpt-year'), branch: value('tax-rpt-branch') };
}
async function checkStory(h, period) {
  const { w } = h;
  const view = await openTab(w, 'pp30');
  assert.equal(view.period, period);
  assert.deepEqual(selected(w), { month: String(Number(period.slice(5))), year: period.slice(0, 4), branch: 'ubon' }, 'month / year selectors on the story month');
  assert.deepEqual(JSON.parse(JSON.stringify(view.pp30.lines)), HQ, `ภ.พ.30 ${period}`);
  assert.equal(text(w.document.querySelector('#tax-reports-root [data-pp30-line="11"]')), '2,411.85');
  assert.deepEqual([view.wht.reports.PND3.totals.taxWithheld, view.wht.reports.PND53.totals.amountPaid, view.wht.reports.PND53.totals.taxWithheld, view.wht.certificates.length], [300, 18714.95, 735.75, 4]); // r13#MED-7: + rent to the juristic landlord 11,214.95 / 560.75
  w.ERPTaxReports.select({ branch: 'khonkaen' });
  assert.equal(w.ERPTaxReports.view().pp30.lines[11], 3827.46, 'สาขาที่ 00001');
  w.ERPTaxReports.select({ branch: 'ubon' });
}

test('r91#4 the presenter loads the sample on 13 Oct 2569, 20 Nov 2569 or 3 Jan 2570: รายงานภาษี opens on the latest closed month (ธันวาคม 2569 in January), says so, and ภ.พ.30 / ภ.ง.ด. are the scripts\' figures', async () => {
  for (const [day, period] of [['2026-10-13', '2026-09'], ['2026-11-20', '2026-10'], ['2027-01-03', '2026-12']]) {
    const h = await boot({ beforeScripts: pinClock(day) });
    const { w } = h;
    try {
      const result = await w.ERPDemoSeed.load({ confirm: () => true });
      assert.equal(result.status, 'loaded', h.messages.join('\n'));
      assert.deepEqual([result.plan.today, result.plan.storyPeriod], [day, period]);
      await checkStory(h, period);
      assert.equal(text(w.document.querySelector('[data-tax-period-note]')), NOTE_TH, `${day}: the page says it opened on the latest closed month`);
      // Another month: the note is not shown (it describes the default month only).
      w.ERPTaxReports.select({ period: '2026-08' });
      assert.equal(w.document.querySelector('[data-tax-period-note]'), null);
      assert.deepEqual(h.errors, []);
    } finally { h.close(); }
  }
});

test('r91#5 a load with an explicit date opens รายงานภาษี on THAT date\'s story month (the device clock says another month); English shows the note in English and the same figures', async () => {
  const h = await boot({ beforeScripts: pinClock('2026-10-13') });
  try {
    const result = await h.w.ERPDemoSeed.load({ today: '2026-11-20', confirm: () => true });
    assert.equal(result.status, 'loaded', h.messages.join('\n'));
    await checkStory(h, '2026-10');
    assert.equal(h.w.document.querySelector('[data-tax-period-note]'), null, 'October is not the latest closed month of the device clock (13 Oct): no note');
    assert.deepEqual(h.errors, []);
  } finally { h.close(); }

  const en = await bootEnglish({ beforeScripts: pinClock('2027-01-03') });
  const { w } = en;
  try {
    const result = await w.ERPDemoSeed.load({ confirm: () => true });
    assert.equal(result.status, 'loaded');
    await checkStory(en, '2026-12');
    await settle(w, 120);
    assert.equal(text(w.document.querySelector('[data-tax-period-note]')), 'The latest closed tax month (last month) — this page opens on it automatically; choose another month or year if needed');
    // December 2569's online PP.30 date (23 Jan, a Saturday) moves to Monday: the moved line is English too (it was the one
    // due-date line without a pattern; with the story month following the load date it now shows in demos).
    const due = [...w.document.querySelectorAll('#tax-reports-root .tax-due li')].slice(0, 2).map(text);
    assert.deepEqual(due, ['Paper filing by 15/01/2027', 'Online filing by 25/01/2027 (moved past Saturday / Sunday)']);
    assert.deepEqual(en.errors, []);
  } finally { en.close(); }
});
