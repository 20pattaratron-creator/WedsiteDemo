const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.resolve(__dirname, '..', 'erp-date-core.js')).href;
let corePromise;
function core() {
  if (!corePromise) corePromise = import(moduleUrl);
  return corePromise;
}

test('Thai/CE year conversion remains deterministic', async () => {
  const m = await core();
  assert.equal(m.toCEYear(2569), 2026);
  assert.equal(m.toCEYear(2026), 2026);
  assert.equal(m.toBEYear(2026), 2569);
  assert.equal(m.toBEYear(2569), 2569);
  assert.equal(m.yearLabelBE(2026), '2569');
  assert.equal(m.yearLabelDual(2026), '2569');
});

test('business date parser accepts CE and BE ISO-like inputs', async () => {
  const m = await core();
  const ce = m.parseFlexibleBusinessDate('2026-09-12');
  const be = m.parseFlexibleBusinessDate('2569-09-12');
  assert.equal(ce.getFullYear(), 2026);
  assert.equal(be.getFullYear(), 2026);
  assert.equal(ce.getMonth(), 8);
  assert.equal(be.getDate(), 12);
});

test('business date parser accepts Thai/Excel DD/MM/YYYY inputs', async () => {
  const m = await core();
  const be = m.parseFlexibleBusinessDate('12/09/2569');
  const ce = m.parseFlexibleBusinessDate('12-09-2026');
  assert.equal(be.getFullYear(), 2026);
  assert.equal(be.getMonth(), 8);
  assert.equal(be.getDate(), 12);
  assert.equal(ce.getFullYear(), 2026);
});

test('business date parser retains Firestore timestamp compatibility', async () => {
  const m = await core();
  const direct = m.parseFlexibleBusinessDate({ toDate: () => new Date(2026, 8, 12) });
  const seconds = m.parseFlexibleBusinessDate({ seconds: Math.floor(new Date(2026, 8, 12).getTime() / 1000) });
  assert.equal(direct.getFullYear(), 2026);
  assert.equal(seconds.getFullYear(), 2026);
});

test('ISO and Thai display formatting keep CE storage and BE display separate', async () => {
  const m = await core();
  assert.equal(m.isoDateCEFromValue('12/09/2569'), '2026-09-12');
  assert.equal(m.formatThaiDate('2026-09-12'), '12/09/2569');
  assert.equal(m.formatThaiDate(''), '-');
});

test('calendar metadata preserves record fields and normalizes year/month', async () => {
  const m = await core();
  const meta = m.makeThaiCalendarMeta('12/09/2569', 2025, 0);
  assert.equal(meta.date, '2026-09-12');
  assert.equal(meta.yearCE, 2026);
  assert.equal(meta.yearBE, 2569);
  assert.equal(meta.monthIndex, 8);
  assert.equal(meta.monthNumber, 9);
  assert.equal(meta.displayDate, '12/09/2569');

  const row = m.withThaiCalendarMeta({ id: 'A', date: '2026-09-12' }, 2025, 0);
  assert.equal(row.id, 'A');
  assert.equal(row.yearBE, 2569);
});

test('invalid/fallback values preserve previous trial behavior', async () => {
  const m = await core();
  assert.equal(m.parseFlexibleBusinessDate(''), null);
  assert.equal(m.isoDateCEFromValue('not-a-date'), 'not-a-date');
  assert.equal(m.formatThaiDate('not-a-date'), 'not-a-date');
  const meta = m.makeThaiCalendarMeta('', 2569, 7);
  assert.equal(meta.yearCE, 2026);
  assert.equal(meta.yearBE, 2569);
  assert.equal(meta.monthIndex, 7);
  assert.equal(meta.monthNumber, 8);
});
