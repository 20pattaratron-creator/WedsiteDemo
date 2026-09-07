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

test('12-month sales and delivery target planner is present and routed through shared dashboard render', () => {
  for (const id of ['monthly-target-planner-table','annual-sales-target-input','annual-delivery-target-input']) {
    assert.equal((html.match(new RegExp(`id=["']${id}["']`, 'g')) || []).length,1,`${id} should exist once`);
  }
  assert.match(app,/function renderMonthlyTargetPlanner\(/);
  assert.match(app,/function saveMonthlyTargetPlanner\(/);
  assert.match(app,/for\(let month=0;month<12;month\+\+\)/);
  assert.match(app,/function renderDashCharts\(\)[\s\S]*renderMonthlyTargetPlanner\(\)/);
});

test('monthly targets support period-specific overrides while keeping legacy fallbacks', () => {
  assert.match(app, /DELIVERY_TARGET_PERIOD_STORAGE_KEY/);
  assert.match(app, /SALES_TARGET_PERIOD_STORAGE_KEY/);
  assert.match(app, /getTargetPeriodOverride\(DELIVERY_TARGET_PERIOD_STORAGE_KEY/);
  assert.match(app, /getTargetPeriodOverride\(SALES_TARGET_PERIOD_STORAGE_KEY/);
  assert.match(app, /return override!==null\?override:\(readSalesTargets\(\)\[scope\]\|\|0\)/);
});

test('interactive chart marks expose click/tap detail registry and keyboard access', () => {
  assert.match(app,/EXECUTIVE_DETAIL_REGISTRY/);
  assert.match(app,/data-exec-detail-id/);
  assert.match(app,/pointerover/);
  assert.match(app,/event\.key==='Enter'/);
  assert.match(app,/openExecutiveChartDetail/);
  assert.match(css,/\.exec-chart-detail-modal/);
  assert.match(css,/\.exec-chart-tooltip/);
});

test('product monthly details include quantity, total, average price and percentage share', () => {
  assert.match(app,/qty=productItems\.reduce/);
  assert.match(app,/avgPrice:qty>0\?value\/qty:0/);
  assert.match(app,/share:ratioPercent\(value,monthTotal\)/);
  assert.match(app,/จำนวนขาย/);
  assert.match(app,/ยอดขายรวม/);
  assert.match(app,/ราคาเฉลี่ย\/หน่วย/);
  assert.match(app,/สัดส่วนของเดือน/);
});

test('target chart details include actual, target, achievement and gap', () => {
  assert.match(app,/function targetDetail\(/);
  assert.match(app,/ความสำเร็จ/);
  assert.match(app,/ยังขาด/);
  assert.match(app,/เกินเป้า/);
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
