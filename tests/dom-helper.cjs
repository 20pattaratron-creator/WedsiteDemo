const {JSDOM,VirtualConsole}=require('jsdom');const fs=require('fs'),path=require('path');const root=path.resolve(__dirname,'..');

// jsdom runs <script src> as classic scripts, not real ES modules. Several source
// files use `import {...} from './x.js'` between each other (ES module syntax).
// Simulate real module scope by wrapping each imported file in its own IIFE and
// destructuring only the imported names into the importing file's scope — so
// same-named (but unexported) top-level variables from two different files never
// collide when combined (closer to real ES module semantics than a single flat scope).
const IMPORT_RE=/^\s*import\s*\{([^}]+)\}\s*from\s*['"](\.\.?\/[^'"]+)['"]\s*;?\s*$/gm;
const EXPORT_DECL_RE=/^\s*export\s+(?:async\s+)?(?:function\*?|class)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_VAR_RE=/^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST_RE=/^\s*export\s*\{([^}]*)\}\s*;?\s*$/gm;
function stripExports(src){
 return src.replace(/^\s*export\s+(?=(?:async\s+)?(?:function|const|let|var|class)\b)/gm,'').replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm,'');
}
// Returns [{name, local}] pairs — `name` is the exported (public) identifier importers
// destructure by, `local` is the variable actually holding the value inside this file.
// Covers both inline declarations (export function/const foo) and list exports
// (export { foo }; or export { foo as bar };), since app.js relies on both forms.
function parseExportedNames(source){
 const entries=[],seen=new Set();
 const add=(name,local)=>{if(!seen.has(name)){seen.add(name);entries.push({name,local});}};
 let m;
 EXPORT_DECL_RE.lastIndex=0;while((m=EXPORT_DECL_RE.exec(source)))add(m[1],m[1]);
 EXPORT_VAR_RE.lastIndex=0;while((m=EXPORT_VAR_RE.exec(source)))add(m[1],m[1]);
 EXPORT_LIST_RE.lastIndex=0;
 while((m=EXPORT_LIST_RE.exec(source))){
  for(const part of m[1].split(',')){
   const token=part.trim();if(!token)continue;
   const aliasMatch=/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(token);
   if(aliasMatch)add(aliasMatch[2],aliasMatch[1]);else add(token,token);
  }
 }
 return entries;
}
function parseImportBindings(bindings){
 return bindings.split(',').map(part=>{
  const token=part.trim();if(!token)return null;
  const aliasMatch=/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(token);
  return aliasMatch?{name:aliasMatch[1],local:aliasMatch[2]}:{name:token,local:token};
 }).filter(Boolean);
}
// Builds a JS expression like "(function(){ ...file body... ; return {exportedName1, exportedName2, ...}; })()"
// for a file being imported — cached by absolute path so the same file isn't re-parsed
// (these files are pure modules with no state, so sharing the factory expression is safe).
function buildModuleFactory(file,cache){
 const abs=path.resolve(file);
 if(cache.has(abs))return cache.get(abs);
 const rawSource=fs.readFileSync(abs,'utf8');
 const exportedEntries=parseExportedNames(rawSource);
 let importPreamble='';
 let body=rawSource.replace(IMPORT_RE,(whole,bindings,ref)=>{
  const dep=path.resolve(path.dirname(abs),ref);
  const factoryExpr=buildModuleFactory(dep,cache);
  const destructure=parseImportBindings(bindings).map(({name,local})=>name===local?name:`${name}: ${local}`).join(', ');
  importPreamble+=`const {${destructure}} = ${factoryExpr};\n`;
  return '';
 });
 body=stripExports(body);
 const relName=path.relative(root,abs).split(path.sep).join('/');
 body=body.replaceAll('import.meta.url',JSON.stringify('https://erp.test/'+relName));
 const returnBody=exportedEntries.map(({name,local})=>name===local?name:`${name}: ${local}`).join(', ');
 const factorySrc=`(function(){\n${importPreamble}${body}\nreturn {${returnBody}};\n})()`;
 cache.set(abs,factorySrc);
 return factorySrc;
}
// For top-level scripts (<script src> in index.html) — resolve imports into const destructures
// from each imported file's buildModuleFactory, then return the file body (not wrapped in its
// own IIFE here, since boot() already wraps one IIFE per <script src>).
function resolveTopLevelSource(file){
 const abs=path.resolve(file);
 const rawSource=fs.readFileSync(abs,'utf8');
 const cache=new Map();
 let importPreamble='';
 let body=rawSource.replace(IMPORT_RE,(whole,bindings,ref)=>{
  const dep=path.resolve(path.dirname(abs),ref);
  const factoryExpr=buildModuleFactory(dep,cache);
  const destructure=parseImportBindings(bindings).map(({name,local})=>name===local?name:`${name}: ${local}`).join(', ');
  importPreamble+=`const {${destructure}} = ${factoryExpr};\n`;
  return '';
 });
 body=stripExports(body);
 const relName=path.relative(root,abs).split(path.sep).join('/');
 body=body.replaceAll('import.meta.url',JSON.stringify('https://erp.test/'+relName));
 return importPreamble+body;
}
// options.beforeScripts(window): runs after the page is parsed and before any app script (e.g. to seed
// localStorage exactly as a returning browser would have it).
async function boot(options={}){
 const errors=[],messages=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));vc.on('error',(...a)=>errors.push(a.join(' ')));
 const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:'https://erp.test',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc}),w=dom.window;
 w.confirm=()=>true;w.alert=()=>{};w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.ResizeObserver=class{observe(){} disconnect(){}};w.indexedDB=new (require('fake-indexeddb').IDBFactory)();w.structuredClone=structuredClone;w.fetch=fetch;if(!w.crypto?.subtle){if(w.crypto)w.crypto.subtle=require('node:crypto').webcrypto.subtle;else w.crypto=require('node:crypto').webcrypto;}if(!w.TextEncoder)w.TextEncoder=TextEncoder;if(!w.TextDecoder)w.TextDecoder=TextDecoder;
 if(typeof options.beforeScripts==='function')options.beforeScripts(w);
 for(const script of w.document.querySelectorAll('script[src]')){
  // Third-party PDF libraries (vendor/, ADR-013) are not needed by the jsdom tests, as before when they came from a CDN.
  const name=script.getAttribute('src');if(/^https?:/.test(name)||/^(?:\.\/)?vendor\//.test(name))continue;
  let s=resolveTopLevelSource(path.join(root,name));
  if(name==='erp-order-flow.js')s=s.replace('  window.ERPOrderFlow = {','  window.testFlow={saveSalesOrderFromQuote,saveFulfillment,saveBilling,saveBillingPayment,derivedOrderStage};\n  window.ERPOrderFlow = {');
  if(name==='app.js')s+='\nwindow.testApp={buildAnalyticsQuality,metricFromData,renderBarRows,renderDash,shouldMirrorHistoricalSalesAsDelivery,keyFor,now,analyticsForecastHistorySeries,dashBranches,forecastMonthKey,forecastMonthFromKey,forecastActiveSeries,forecastStoredHistory,forecastRollingCv,forecastMaseScale,forecastSmape,forecastWape,buildStandardForecastModel,forecastFutureTableHtml,forecastMoney,analyticsTrendSummary,quantBusinessRegime,quantRevenueAnomalies,quantMaxDrawdown,quantMonteCarlo,quantCompositeRiskScore,quantForecastDecision,quantDecisionTableRows,buildSalesForecast,collectDashboardSalesRows,buildDashboardProductCompare,buildMonthlyCustomerLeaderRows,dashboardAgencyRows,customerRows,collectLocalMasterBackup,restoreLocalMasterBackup,branchStats,buildReceivableAgingRows,createLocalBackupSnapshot,collectBackupData,loadForBackupRead,exportSelectedMonthJSON,exportSelectedYearJSON,exportAllJSON,exportXLSX,collectAnalyticsData,buildAnalyticsKpis,buildCustomerDeepRows,buildAgencyRows,buildProductDeepRows,buildSalespersonRows,buildBranchRows,buildAnalyticsInsights,buildSalesTargetDashboard,creditAdjustmentRows,analyticsItemRows,csvEscapeCell,renderBusiness};';
  w.eval(`(()=>{${s}\n})();`);
 }
 await new Promise(r=>setTimeout(r,450));w.notify=(...a)=>messages.push(a.join(' '));
 const set=(id,value)=>{const el=w.document.getElementById(id);if(!el)throw Error('missing '+id);el.value=value;};
 return {w,dom,errors,messages,set,close:()=>w.close()};
}
module.exports={boot};
