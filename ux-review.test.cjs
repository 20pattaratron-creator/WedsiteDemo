const {boot}=require('./dom-helper.cjs');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
let h,w,d;
before(async()=>{h=await boot();w=h.w;d=w.document;for(let i=0;i<60&&!d.getElementById('erp-dashboard-views');i++)await new Promise(r=>setTimeout(r,50));});
after(()=>{assert.deepEqual(h.errors,[]);h.close();});
const key=(el,k,extra={})=>el.dispatchEvent(new w.KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true,...extra}));
const tick=()=>new Promise(r=>setTimeout(r,40));
test('header search starts empty, keyboard cycles results, Escape returns focus',()=>{
 const button=d.getElementById('erp-global-search-btn');button.focus();button.click();
 const input=d.getElementById('erp-global-search-input');assert.equal(input.value,'');assert.equal(d.activeElement,input);
 key(input,'Tab',{shiftKey:true});assert.equal(d.activeElement,input);
 w.testApp.restoreLocalMasterBackup({products:[{id:'UX-P',code:'UX-P',name:'UX Keyboard Product',unit:'ชิ้น'}]});
 input.value='UX Keyboard';input.dispatchEvent(new w.Event('input',{bubbles:true}));
 const result=d.querySelector('.erp-search-result');assert.ok(result);key(input,'ArrowDown');assert.equal(d.activeElement,result);
 key(result,'Tab');assert.equal(d.activeElement,input);key(input,'ArrowUp');assert.equal(d.activeElement,result);
 key(result,'Escape');assert.equal(d.querySelector('.erp-search-overlay'),null);assert.equal(d.activeElement,button);
});
test('guide is initially collapsed and company is not pre-completed; header opens it',()=>{
 let box=d.getElementById('trial-onboarding');assert.ok(box.classList.contains('collapsed'));assert.equal(box.querySelector('.trial-step').classList.contains('done'),false);
 assert.equal(d.getElementById('trial-banner').hidden,true);
 d.getElementById('local-demo-guide-btn').click();box=d.getElementById('trial-onboarding');assert.equal(box.classList.contains('collapsed'),false);
 assert.equal(box.querySelector('.trial-collapse').getAttribute('aria-expanded'),'true');key(box,'Escape');assert.ok(d.getElementById('trial-onboarding').classList.contains('collapsed'));
});
test('create and list navigation labels differ; keyboard and quick action update route',()=>{
 const items=[...d.querySelectorAll('.sidebar .nav-item')];const create=items.find(x=>(x.getAttribute('onclick')||'').includes("go('quote-form'"));const list=items.find(x=>(x.getAttribute('onclick')||'').includes("go('quote-list'"));
 assert.match(create.textContent,/สร้างใบเสนอราคา/);assert.match(list.textContent,/รายการใบเสนอราคา/);
 assert.equal(list.tabIndex,0);list.onclick=new w.Function('event',list.getAttribute('onclick'));key(list,'Enter');assert.ok(d.getElementById('panel-quote-list').classList.contains('active'));assert.equal(list.getAttribute('aria-current'),'page');
 d.querySelector('[data-ux-go="quote-form"]').click();assert.ok(d.getElementById('panel-quote-form').classList.contains('active'));assert.equal(create.getAttribute('aria-current'),'page');
});
test('dashboard hides advanced sections by default and preserves chosen view after refresh',()=>{
 w.go('dashboard');const dash=d.getElementById('panel-dashboard');assert.equal(dash.dataset.dashboardView,'summary');
 assert.ok(dash.querySelector('.forecast-section').classList.contains('erp-view-hidden'));assert.ok(dash.querySelector('.quant-section').classList.contains('erp-view-hidden'));
 assert.equal(d.querySelector('.erp-branch-detail').open,false);
 d.querySelector('[data-dashboard-view="forecast"]').click();w.testApp.renderDash();
 assert.equal(dash.dataset.dashboardView,'forecast');assert.equal(dash.querySelector('.forecast-section').classList.contains('erp-view-hidden'),false);assert.ok(d.getElementById('dash-combined').classList.contains('erp-view-hidden'));
 d.querySelector('[data-dashboard-view="summary"]').click();assert.equal(d.getElementById('dash-combined').classList.contains('erp-view-hidden'),false);
});
test('document fit scales A4 into a narrow preview, zooms and fits again',async()=>{
 w.go('quote-form');await tick();const content=d.getElementById('q-inline-preview');assert.ok(content);assert.equal(content.classList.contains('doc-entry-empty'),false);
 const preview=content.closest('.doc-entry-preview'),frame=preview.querySelector('.doc-entry-preview-frame'),stage=preview.querySelector('.doc-preview-stage');
 Object.defineProperty(frame,'clientWidth',{get:()=>320,configurable:true});Object.defineProperty(content,'scrollHeight',{get:()=>1123,configurable:true});
 preview.querySelector('[data-zoom="fit"]').click();await tick();const fit=Number(preview.dataset.previewScale);assert.ok(fit>0&&fit<1);assert.ok(parseFloat(stage.style.width)<=320);assert.ok(parseFloat(stage.style.height)>0);
 preview.querySelector('[data-zoom="in"]').click();await tick();assert.ok(Number(preview.dataset.previewScale)>fit);
 preview.querySelector('[data-zoom="fit"]').click();await tick();assert.equal(Number(preview.dataset.previewScale),fit);
});
test('monthly sales and profit agree with branch summary and exclude SO work in progress',()=>{
 const branch='ubon',year=2024,month=7;const data=w.loadFor(branch,year,month);
 data.productions=[{id:'LEGACY',no:'P-LEGACY',subtotal:1000,costTotal:400,commAmt:50},{id:'WIP',no:'P-WIP',subtotal:900,sourceSalesOrderId:'SO-1'}];
 data.invoices=[{id:'DIRECT',no:'I-DIRECT',subtotal:300,total:300,costTotal:100},{id:'LINKED',no:'I-LINKED',subtotal:1000,total:1000,sourceProductionId:'LEGACY'},{id:'CANCEL',no:'I-CANCEL',subtotal:500,total:500,status:'cancelled'}];data.expenses=[{amount:70}];w.saveFor(branch,year,month,data);
 const stats=w.testApp.branchStats(branch,year,month);assert.equal(stats.st,1300);assert.equal(stats.net,680);
 assert.equal(w.testApp.metricFromData(data,'sales',year,month,branch),stats.st);assert.equal(w.testApp.metricFromData(data,'profit',year,month,branch),stats.net);
});
test('January historical production does not become delivery without invoice evidence',()=>{
 const data={productions:[{id:'OLD',subtotal:900}],invoices:[]};assert.equal(w.testApp.shouldMirrorHistoricalSalesAsDelivery(2026,0),false);
 assert.equal(w.testApp.metricFromData(data,'delivery',2026,0,'ubon'),0);data.invoices=[{id:'ACTUAL',subtotal:200,total:200}];assert.equal(w.testApp.metricFromData(data,'delivery',2026,0,'ubon'),200);
});
test('loss values remain visible in chart and are marked red',()=>{
 w.testApp.renderBarRows('dash-bar-chart',[{label:'เดือนขาดทุน',value:-250},{label:'เดือนศูนย์',value:0}],{fillClass:'green'});
 const root=d.getElementById('dash-bar-chart');assert.match(root.textContent,/-250/);assert.ok(root.querySelector('.chart-fill.red'));assert.equal(root.querySelectorAll('.chart-bar-row').length,1);
});

test('empty data is unassessed rather than a perfect quality score',()=>{const q=w.testApp.buildAnalyticsQuality({});assert.equal(q.total,0);assert.equal(q.score,null);assert.match(d.getElementById('quant-simulation-count').textContent,/ข้อมูลยังไม่พอ/);});
