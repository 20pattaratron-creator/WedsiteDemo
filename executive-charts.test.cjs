const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root,'app.js'),'utf8');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
const css = fs.readFileSync(path.join(root,'executive-charts.css'),'utf8');

test('executive comparison section has all required chart hosts exactly once', () => {
  const ids = ['executive-visual-kpis','exec-product-monthly-chart','exec-agency-pie-chart','exec-gov-private-chart','exec-sales-target-chart','exec-delivery-target-chart'];
  for (const id of ids) {
    const matches = html.match(new RegExp(`id=["']${id}["']`, 'g')) || [];
    assert.equal(matches.length, 1, `${id} should exist exactly once`);
  }
});

test('dashboard render calls executive charts through the shared render pipeline', () => {
  assert.match(app, /function renderDashCharts\(\)[\s\S]*renderExecutiveComparisonCharts\(\)/);
});

test('monthly targets support period-specific overrides while keeping legacy fallbacks', () => {
  assert.match(app, /DELIVERY_TARGET_PERIOD_STORAGE_KEY/);
  assert.match(app, /SALES_TARGET_PERIOD_STORAGE_KEY/);
  assert.match(app, /getTargetPeriodOverride\(DELIVERY_TARGET_PERIOD_STORAGE_KEY/);
  assert.match(app, /getTargetPeriodOverride\(SALES_TARGET_PERIOD_STORAGE_KEY/);
  assert.match(app, /return override!==null\?override:\(readSalesTargets\(\)\[scope\]\|\|0\)/);
});

test('new charts reuse existing dashboard sources instead of maintaining duplicate business totals', () => {
  assert.match(app, /collectDashboardSalesRows\(year,-1,branches\)/);
  assert.match(app, /analyticsItemRows\(/);
  assert.match(app, /customerAgencyForRecord\(/);
  assert.match(app, /rowsForMonthlyChart\(year,dashBranches\(\),metric\)/);
});

test('executive chart stylesheet is balanced and loaded once', () => {
  assert.equal((css.match(/{/g)||[]).length,(css.match(/}/g)||[]).length);
  assert.equal((html.match(/href=["']executive-charts\.css["']/g)||[]).length,1);
});
