// Forecast governance (round 10, ADR-027). The dashboard, วิเคราะห์ธุรกิจ and Quant now read the single engine of
// erp-forecast-core.js through ERPAnalytics (the old app.js candidate/CV engine was removed so that no screen can
// show a second, different forecast). The governance rules are kept, restated for that engine:
//  * invalid observations invalidate a series instead of being compressed away;      (was: buildStandardForecastModel)
//  * an unreadable month pack fails closed (read-error state), it never becomes 0;   (was: forecastStoredHistory null)
//  * every candidate is scored on the same test months;                              (was: identical rolling origins)
//  * an error figure needs a real denominator — never "perfect" on zeros;            (was: WAPE/MASE = Infinity)
//  * too little history gives no accuracy and no invented zero-width band;
//  * the band widens with √h and is never shown when σ is unknown;                  (was: 8-error residual scenarios)
//  * the dashboard renders "no forecast" without boot errors and never says P50.
// MASE was dropped with the old engine (the brief asks for MAPE / sMAPE); its fold-by-fold test has no successor.
const {boot}=require('./dom-helper.cjs');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const core=()=>import(pathToFileURL(path.join(__dirname,'..','erp-forecast-core.js')).href);
let h,a;
before(async()=>{h=await boot();a=h.w.testApp;});
after(()=>h?.close());
const plain=x=>JSON.parse(JSON.stringify(x));
const fresh=()=>{h.w.ERPAnalytics.invalidate();return h.w.ERPAnalytics;};
test('forecast preserves zero months at both boundaries and in the middle',()=>{
 assert.deepEqual(plain(a.forecastActiveSeries([0,100,0,50,0])),[0,100,0,50,0]);
 assert.deepEqual(plain(a.forecastActiveSeries([0,0,0])),[0,0,0]);
});
test('missing, negative and nonfinite observations invalidate rather than compress a series',async()=>{
 const f=await core();
 for(const invalid of [null,undefined,NaN,Infinity,-5,'10'])assert.equal(a.forecastActiveSeries([20,invalid,30]).length,0);
 for(const invalid of [null,undefined,NaN,Infinity,'10']){
  const r=f.forecastSeries([10,20,30,40,50,60,invalid,80]);
  assert.equal(r.status,'invalid');assert.deepEqual(r.forecast,[]);
 }
 // A negative month is real data (credit notes above sales); the forecast itself is clamped at 0.
 assert.equal(f.forecastSeries([10,20,-5,40,50,60,70]).status,'ok');
});
test('an unreadable month pack fails closed instead of becoming a zero month',()=>{
 const w=h.w,key=a.keyFor('ubon',2020,2);
 try{
  for(const corrupt of ['{broken','[]']){
   w.localStorage.setItem(key,corrupt);
   const out=fresh().forecastForBranches(['ubon']);
   assert.ok(out.error,'read error reported');assert.equal(out.result,undefined,'no forecast from partial data');
   const q=fresh().quantForecast(['ubon']);assert.equal(q.model.valid,false);assert.equal(q.next,null);assert.ok(q.error);
  }
 }finally{w.localStorage.removeItem(key);} // never leave a damaged pack for the next test
 assert.equal(fresh().forecastForBranches(['ubon']).error,null);
});
test('every candidate method is scored on the same test months',async()=>{
 const f=await core();
 for(const length of [8,12,26,27,36]){
  const values=Array.from({length},(_,i)=>100+i*5+(i%3)*7);
  const r=f.forecastSeries(values);assert.equal(r.status,'ok');
  const rows=r.selection.candidates;assert.ok(rows.length>=2);
  for(const row of rows)assert.deepEqual(plain(row.actuals),values.slice(length-r.selection.holdout));
  assert.equal(rows.some(x=>x.method==='hw'),length>=27,'Holt-Winters only from 27 months');
  const best=Math.min(...rows.filter(x=>x.eligible).map(x=>x.error));
  assert.equal(r.accuracy.value,rows.find(x=>x.method===r.method).error);
  assert.ok(Math.abs(r.accuracy.value-best)<1e-12,'the chosen method has the lowest holdout error (Holt kept on ties)');
 }
});
test('holdout diagnostics for the Quant views are hand-checkable',async()=>{
 const f=await core();
 // actual 100, 50, 0, 50; forecast 90, 60, 10, 50 → errors 10, −10, −10, 0; Σ|e| 30, Σ|A| 200.
 const d=f.holdoutDiagnostics([100,50,0,50],[90,60,10,50]);
 assert.equal(d.wape,15);assert.equal(d.biasPct,-5);assert.equal(d.mae,7.5);
 assert.equal(d.trackingSignal,-10/7.5);assert.equal(d.rmse,Math.sqrt(300/4));
});
test('zero denominators produce unavailable accuracy rather than perfect accuracy',async()=>{
 const f=await core();
 const none=f.forecastSeries(Array(12).fill(0));assert.equal(none.status,'insufficient');assert.equal(none.reason,'no-sales');
 // Sales early on, zeros in every test month: a forecast exists but its error cannot be judged.
 const r=f.forecastSeries([50,60,70,80,0,0,0,0]);assert.equal(r.status,'ok');
 assert.equal(r.accuracy.value,null);assert.equal(r.accuracy.label,null);assert.equal(r.accuracy.metric,'smape');
 assert.equal(f.holdoutDiagnostics([0,0],[5,5]).wape,null);
 assert.equal(f.mape([0,10],[0,0]),null,'MAPE is undefined on a zero actual');
 assert.equal(f.smape([0,10],[0,0]),100);
 assert.equal(a.quantForecastDecision({eligible:false,wape:Infinity}).cls,'muted');
 assert.equal(a.quantCompositeRiskScore({cv:0,hhi:0,drawdown:0,overdueRate:0,wape:Infinity,trackingSignal:0}).cls,'muted');
});
test('few observations have no accuracy percentage or invented zero-width intervals',async()=>{
 const f=await core();
 for(const values of [[100,120],[100,120,90,110,105]]){
  const r=f.forecastSeries(values);assert.equal(r.status,'insufficient');assert.equal(r.reason,'too-few-months');
  assert.deepEqual(r.forecast,[]);assert.equal(r.accuracy,undefined);
 }
 assert.equal(f.residualSigma([1,2]),null,'σ needs at least three residuals');
 assert.deepEqual(plain(f.intervalFor(100,null,1,1000)),{lower:null,upper:null});
});
test('the ~80% band widens with √h, stays within [0, cap] and the point is not called a median',async()=>{
 const f=await core();
 const r=f.forecastSeries(Array.from({length:36},(_,i)=>100+i*2+(i%4)*20),{horizon:6});
 assert.equal(r.status,'ok');assert.equal(r.forecast.length,6);assert.ok(r.residualCount>=3);
 for(const row of r.forecast){
  const half=f.INTERVAL_Z80*r.sigma*Math.sqrt(row.h);
  assert.ok(Math.abs(row.upper-Math.min(r.cap,row.value+half))<1e-9);
  assert.ok(Math.abs(row.lower-Math.max(0,row.value-half))<1e-9);
  assert.ok(row.lower>=0&&row.upper<=r.cap);
  assert.equal(row.p50,undefined,'point forecast is not claimed to be a median');
 }
});
test('the embedded forecast renders "no forecast" and dashes, never P50',()=>{
 const host=h.w.document.createElement('div');
 fresh().renderEmbeddedForecast(host,{branches:['ubon']});
 assert.match(host.textContent,/ยังไม่คาดการณ์/);assert.doesNotMatch(host.textContent,/P50/);
 assert.equal(a.forecastMoney(null),'—');
});
test('analytics uses the latest zero month for actual and forecast date',()=>{
 const rows=[100,50,0].map((value,month)=>({year:2026,month,value}));
 const t=a.analyticsTrendSummary(rows,'','value','auto',rows);
 assert.equal(t.current.month,2);assert.equal(t.current.value,0);assert.equal(t.prev.month,1);assert.equal(t.forecastBase.month,2);
 assert.equal(t.worst.value,0);
});
test('Quant includes zero-revenue contractions, drawdowns and low outliers',()=>{
 const rows=[100,102,98,100,101,99,0].map((value,month)=>({value,month}));
 assert.equal(a.quantBusinessRegime(rows).label,'Contraction');
 assert.equal(a.quantMaxDrawdown(rows.map(x=>x.value)).percent,100);
 assert.ok(a.quantRevenueAnomalies(rows).some(x=>x.value===0));
});
test('Monte Carlo does not simulate when error scale is unavailable',()=>{
 for(const sigma of [null,NaN,Infinity,-1]){
  const mc=a.quantMonteCarlo(100,sigma,120);assert.equal(mc.n,0);assert.equal(mc.targetProbability,null);assert.equal(mc.p10,null);
  const row=a.quantDecisionTableRows({selected:{},cv:0,hhi:0,drawdown:0,overdueRate:0,mc,target:120}).at(-1);
  assert.equal(row.status,'N/A');assert.equal(row.cls,'muted');
 }
 const mc=a.quantMonteCarlo(100,20,120,1000,'same');
 assert.equal(mc.n,1000);assert.deepEqual(plain(mc),plain(a.quantMonteCarlo(100,20,120,1000,'same')));
});
test('empty dashboard has unavailable forecast and renders without boot errors',()=>{
 fresh();
 const f=a.buildSalesForecast();assert.equal(f.model.valid,false);assert.equal(f.next,null);
 h.w.renderSalesForecast();h.w.renderDataAnalytics();
 const text=h.w.document.getElementById('forecast-unified').textContent;
 assert.match(text,/ยังไม่คาดการณ์/);
 assert.doesNotMatch(text,/คะแนนความน่าเชื่อถือ/);
 assert.match(h.w.document.getElementById('analytics-forecast-summary').textContent,/ยังไม่คาดการณ์/);
 assert.deepEqual(h.errors,[]);
});
test('January automatic history ends in previous December',()=>{
 const time=a.now.getTime();
 try{
  a.now.setFullYear(2026,0,15);
  h.w.saveFor('ubon',2025,11,h.w.loadFor('ubon',2025,11));
  const rows=a.analyticsForecastHistorySeries(2026,'ubon','','','');
  assert.equal(rows.at(-1).year,2025);assert.equal(rows.at(-1).month,11);
 }finally{a.now.setTime(time);}
});
test('stored zero-sales months give an honest "no sales" state, not a forecast of 0',()=>{
 const first=a.buildSalesForecast(),end=a.forecastMonthKey(first.ref.year,first.ref.month);
 for(let off=11;off>=0;off--){
  const d=a.forecastMonthFromKey(end-off);
  for(const b of a.dashBranches())h.w.saveFor(b,d.year,d.month,h.w.loadFor(b,d.year,d.month));
 }
 fresh();
 const f=a.buildSalesForecast();
 // The old engine forecast 0 from twelve zero months; the new one says there is no level to forecast from.
 assert.equal(f.model.valid,false);assert.equal(f.next,null);
 assert.ok(['no-sales','too-few-months'].includes(f.model.reason));
});
