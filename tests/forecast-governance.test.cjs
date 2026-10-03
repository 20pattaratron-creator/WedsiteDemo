const {boot}=require('./dom-helper.cjs');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
let h,a;
before(async()=>{h=await boot();a=h.w.testApp;});
after(()=>h?.close());
const plain=x=>JSON.parse(JSON.stringify(x));
test('forecast preserves zero months at both boundaries and in the middle',()=>{
 assert.deepEqual(plain(a.forecastActiveSeries([0,100,0,50,0])),[0,100,0,50,0]);
 assert.deepEqual(plain(a.forecastActiveSeries([0,0,0])),[0,0,0]);
});
test('missing, negative and nonfinite observations invalidate rather than compress a series',()=>{
 for(const invalid of [null,undefined,NaN,Infinity,-5,'10'])assert.equal(a.forecastActiveSeries([20,invalid,30]).length,0);
 const model=a.buildStandardForecastModel([10,null,20]);assert.equal(model.valid,false);assert.equal(model.forecast,null);
});
test('missing monthly storage differs from a stored empty month and corrupt data',()=>{
 const w=h.w,rows=[0,1,2,3].map(month=>({year:2020,month,value:0}));
 w.saveFor('ubon',2020,1,w.loadFor('ubon',2020,1));
 w.saveFor('ubon',2020,3,w.loadFor('ubon',2020,3));
 const checked=a.forecastStoredHistory(rows,['ubon']);
 assert.deepEqual(plain(checked.map(r=>r.value)),[0,null,0]);
 assert.equal(a.buildStandardForecastModel(checked.map(r=>r.value)).valid,false);
 assert.equal(a.forecastStoredHistory(rows,['ubon','missing-branch']).length,0);
 for(const corrupt of ['{broken','[]','{"quotes":[]}']){
  w.localStorage.setItem(a.keyFor('ubon',2020,2),corrupt);
  assert.equal(a.forecastStoredHistory(rows,['ubon'])[1].value,null);
 }
 w.localStorage.removeItem(a.keyFor('ubon',2020,2));
});
test('all eligible models including Naive share identical rolling-origin test months',()=>{
 for(const length of [8,12,26,27,36]){
  const m=a.buildStandardForecastModel(Array.from({length},(_,i)=>100+i*5+(i%3)*7));
  const rows=m.candidates.filter(x=>x.eligible);assert.ok(rows.length>=2);
  for(const row of rows){assert.deepEqual(plain(row.origins),plain(rows[0].origins));assert.ok(row.n>=3);}
  assert.equal(m.candidates.find(x=>x.id==='hw').eligible,length>=27);
  assert.equal(m.cv.rmse,Math.min(...rows.map(x=>x.rmse)));
 }
});
test('MASE uses training data at each fold, excluding the new actual',()=>{
 const v=[1,2,100,101,102,103],cv=a.forecastRollingCv(v,'naive',2);
 const expected=(98/1+1/49.5+1/(100/3)+1/(101/4))/4;
 assert.ok(Math.abs(cv.mase-expected)<1e-10);
});
test('zero denominators produce unavailable WAPE/MASE rather than perfect accuracy',()=>{
 const m=a.buildStandardForecastModel(Array(12).fill(0));
 assert.equal(m.cv.wape,Infinity);assert.equal(m.cv.mase,Infinity);
 assert.equal(a.quantForecastDecision(m.cv).cls,'muted');
 assert.equal(a.quantCompositeRiskScore({cv:0,hhi:0,drawdown:0,overdueRate:0,wape:Infinity,trackingSignal:0}).cls,'muted');
 assert.equal(a.forecastSmape([0,10],[0,0]),100);
});
test('few observations have no accuracy percentage or invented zero-width intervals',()=>{
 const m=a.buildStandardForecastModel([100,120]);
 assert.equal(m.cv.eligible,false);assert.equal(m.confidence,undefined);
 assert.ok(m.intervals.every(x=>x.lower===null&&x.upper===null));
});
test('residual scenarios require eight errors and are not extrapolated to longer horizons',()=>{
 const m=a.buildStandardForecastModel(Array.from({length:36},(_,i)=>100+i*2+(i%4)*20),'auto',6);
 assert.ok(m.cv.n>=8);assert.equal(m.intervals[0].available,true);
 assert.ok(m.intervals.slice(1).every(x=>x.lower===null&&x.upper===null));
 assert.equal(m.intervals[0].p50,null,'point forecast is not claimed to be a median');
});
test('forecast table renders unavailable ranges as a dash and does not call base P50',()=>{
 const html=a.forecastFutureTableHtml({future:[{year:2026,month:8,value:100,lower:null,upper:null,p50:null}]});
 assert.match(html,/—/);assert.doesNotMatch(html,/P50/);assert.equal(a.forecastMoney(null),'—');
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
 const f=a.buildSalesForecast();assert.equal(f.model.valid,false);assert.equal(f.next,null);
 h.w.renderSalesForecast();h.w.renderDataAnalytics();
 assert.match(h.w.document.getElementById('forecast-metrics').textContent,/—/);
 assert.doesNotMatch(h.w.document.getElementById('forecast-metrics').textContent,/คะแนนความน่าเชื่อถือ/);
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
test('complete stored zero-sales months remain usable history in the dashboard',()=>{
 const first=a.buildSalesForecast(),end=a.forecastMonthKey(first.ref.year,first.ref.month);
 for(let off=11;off>=0;off--){
  const d=a.forecastMonthFromKey(end-off);
  for(const b of a.dashBranches())h.w.saveFor(b,d.year,d.month,h.w.loadFor(b,d.year,d.month));
 }
 const f=a.buildSalesForecast();assert.equal(f.model.valid,true);assert.equal(f.next,0);assert.equal(f.model.historyCount,12);
});
