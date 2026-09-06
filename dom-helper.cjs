const {JSDOM,VirtualConsole}=require('jsdom');const fs=require('fs'),path=require('path');const root=path.resolve(__dirname,'..');
async function boot(){
 const errors=[],messages=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));vc.on('error',(...a)=>errors.push(a.join(' ')));
 const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:'https://erp.test',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc}),w=dom.window;
 w.confirm=()=>true;w.alert=()=>{};w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.ResizeObserver=class{observe(){} disconnect(){}};w.indexedDB=new (require('fake-indexeddb').IDBFactory)();w.structuredClone=structuredClone;w.fetch=fetch;
 for(const script of w.document.querySelectorAll('script[src]')){
  const name=script.getAttribute('src');if(/^https?:/.test(name))continue;
  let s=fs.readFileSync(path.join(root,name),'utf8').replace(/^export\s+(?=(async\s+)?function|const|class|let)/gm,'').replace(/^export\s*\{[^}]*\};?/gm,'').replaceAll('import.meta.url',JSON.stringify('https://erp.test/'+name));
  if(name==='erp-order-flow-v3.js')s=s.replace('  window.ERPOrderFlow = {','  window.testFlow={saveSalesOrderFromQuote,saveFulfillment,saveBilling,saveBillingPayment,derivedOrderStage};\n  window.ERPOrderFlow = {');
  if(name==='app.js')s+='\nwindow.testApp={keyFor,now,analyticsForecastHistorySeries,dashBranches,forecastMonthKey,forecastMonthFromKey,forecastActiveSeries,forecastStoredHistory,forecastRollingCv,forecastMaseScale,forecastSmape,forecastWape,buildStandardForecastModel,forecastFutureTableHtml,forecastMoney,analyticsTrendSummary,quantBusinessRegime,quantRevenueAnomalies,quantMaxDrawdown,quantMonteCarlo,quantCompositeRiskScore,quantForecastDecision,quantDecisionTableRows,buildSalesForecast,collectDashboardSalesRows,buildDashboardProductCompare,buildMonthlyCustomerLeaderRows,dashboardAgencyRows,customerRows,collectLocalMasterBackup,restoreLocalMasterBackup,branchStats,buildReceivableAgingRows,createLocalBackupSnapshot};';
  w.eval(`(()=>{${s}\n})();`);
 }
 await new Promise(r=>setTimeout(r,450));w.notify=(...a)=>messages.push(a.join(' '));
 const set=(id,value)=>{const el=w.document.getElementById(id);if(!el)throw Error('missing '+id);el.value=value;};
 return {w,dom,errors,messages,set,close:()=>w.close()};
}
module.exports={boot};
