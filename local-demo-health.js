/* Local Demo Health + interaction safety for proposal/UAT builds. */
(() => {
  'use strict';
  const VERSION='1.0.0';
  const errors=[];
  const inflight=new Set();
  // Trial/production wrappers retain the existing function. Never wrap our own
  // single-flight guard again when another module becomes the outer wrapper.
  const installedGuards=new Set();
  let modal=null;
  const esc=(v='')=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtBytes=n=>{n=Number(n)||0;if(n<1024)return `${n} B`;if(n<1024**2)return `${(n/1024).toFixed(1)} KB`;return `${(n/1024**2).toFixed(1)} MB`;};

  function tenantPrefix(){const id=window.ComformTenant?.getActiveTenantId?.()||window.CurrentUser?.tenantId||'anonymous';return `erp_tenant::${id}::`;}
  function localUsage(){let bytes=0,keys=0;const p=tenantPrefix();for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i)||'';if(!k.startsWith(p))continue;keys++;bytes+=(k.length+(localStorage.getItem(k)||'').length)*2;}return{bytes,keys};}
  function businessCounts(){const b=window.ERPOrderFlow?.scanBusinessData?.()||{};return Object.fromEntries(['quotes','productions','invoices','receipts'].map(k=>[k,(b[k]||[]).length]));}
  function negativeStock(){let count=0;try{const rows=window.productMasterRows?.()||[];for(const p of rows){if(p?.flowType!=='inventory'||p?.fulfillmentType!=='stock')continue;for(const br of ['ubon','khonkaen']){const v=Number(window.productEstimatedStock?.(p,br));if(Number.isFinite(v)&&v<0)count++;}}}catch(_){}return count;}
  async function snapshot(){
    const use=localUsage();let quota=null,usage=null;try{const e=await navigator.storage?.estimate?.();quota=e?.quota;usage=e?.usage;}catch(_){}
    const flow=window.ERPOrderFlow?.getStore?.()||{};const counts=businessCounts();const backups=window.ComformSafety?.listLocalBackups?.()||[];
    return {online:navigator.onLine,appReady:window.ComformAppReady===true,localDemo:window.ERP_LOCAL_DEMO===true,tenant:window.CurrentUser?.tenantName||window.CurrentUser?.tenantId||'-',counts,flow:{salesOrders:(flow.salesOrders||[]).length,billingNotes:(flow.billingNotes||[]).length,payments:(flow.payments||[]).length},negative:negativeStock(),runtimeErrors:errors.length,localBytes:use.bytes,localKeys:use.keys,storageUsage:usage,storageQuota:quota,backups:backups.length,lastBackup:backups[0]?.createdAt||''};
  }
  async function openHealth(){
    closeHealth(); modal=document.createElement('div');modal.className='demo-health-overlay';modal.innerHTML='<section class="demo-health-dialog"><header><div><small>LOCAL DEMO CONTROL</small><h2>สถานะระบบสำหรับสาธิต</h2></div><button data-health-close>×</button></header><div id="demo-health-body" class="demo-health-body">กำลังตรวจ...</div><footer><button class="btn btn-ghost" data-health-backup>สร้าง Backup ในเครื่อง</button><button class="btn btn-primary" data-health-refresh>ตรวจอีกครั้ง</button></footer></section>';modal.addEventListener('click',e=>{if(e.target===modal)closeHealth();});modal.querySelector('[data-health-close]').onclick=closeHealth;modal.querySelector('[data-health-refresh]').onclick=renderHealth;modal.querySelector('[data-health-backup]').onclick=()=>{const x=window.ComformSafety?.createLocalBackupSnapshot?.(undefined,'proposal-demo-manual');window.notify?.(x?'สร้าง Local Backup แล้ว':'ไม่สามารถสร้าง Local Backup ได้',x?'success':'error');renderHealth();};document.body.appendChild(modal);await renderHealth();
  }
  function closeHealth(){modal?.remove();modal=null;}
  async function renderHealth(){const root=document.getElementById('demo-health-body');if(!root)return;const h=await snapshot();const storage=h.storageQuota?`${fmtBytes(h.storageUsage)} / ${fmtBytes(h.storageQuota)}`:fmtBytes(h.localBytes);const risk=!h.appReady||h.negative||h.runtimeErrors;root.innerHTML=`<div class="demo-health-summary ${risk?'warn':'ok'}"><b>${risk?'พบรายการที่ควรตรวจสอบก่อนนำเสนอ':'ไม่พบปัญหาจากรายการตรวจอัตโนมัตินี้'}</b><span>เวอร์ชัน Health ${VERSION} · ไม่ตรวจ Firebase เพราะ build นี้เป็น Local-only โดยตั้งใจ</span></div><div class="demo-health-grid"><div><small>App</small><b>${h.appReady?'✓ Ready':'! Loading'}</b></div><div><small>Storage</small><b>${esc(storage)}</b></div><div><small>Local Backup</small><b>${h.backups}</b></div><div class="${h.negative?'risk':''}"><small>Negative Stock</small><b>${h.negative}</b></div><div><small>Quotation</small><b>${h.counts.quotes||0}</b></div><div><small>Sales Order</small><b>${h.flow.salesOrders}</b></div><div><small>Invoice</small><b>${h.counts.invoices||0}</b></div><div><small>Billing Note</small><b>${h.flow.billingNotes}</b></div><div><small>Receipt</small><b>${h.counts.receipts||0}</b></div><div><small>Payment Overlay</small><b>${h.flow.payments}</b></div><div class="${h.runtimeErrors?'risk':''}"><small>Runtime Error</small><b>${h.runtimeErrors}</b></div><div><small>Tenant</small><b>${esc(h.tenant)}</b></div></div><div class="demo-health-note"><b>ก่อนเสนอหัวหน้า:</b> Backup ข้อมูลทดลอง 1 ครั้ง, ตรวจ Negative Stock ให้เป็น 0 รายการหากไม่ได้ตั้งใจทดสอบ anomaly และเปิด Flow Quote → SO → Fulfillment → Invoice → Billing → Payment ให้ครบอย่างน้อย 1 ชุด</div>${errors.length?`<details><summary>Runtime errors ล่าสุด</summary><pre>${esc(errors.slice(-5).map(x=>x.message).join('\n'))}</pre></details>`:''}`;}

  function ensureButton(){const actions=document.querySelector('#local-demo-banner .local-demo-banner-actions');if(!actions||document.getElementById('local-demo-health-btn'))return;const b=document.createElement('button');b.type='button';b.id='local-demo-health-btn';b.textContent='✓ ตรวจสถานะ Demo';b.addEventListener('click',openHealth);actions.prepend(b);}
  function singleFlight(name){const orig=window[name];if(typeof orig!=='function'||installedGuards.has(name)||orig.__demoSingleFlight)return false;const wrapped=async function(...args){if(inflight.has(name)){window.notify?.(`กำลังดำเนินการ ${name} อยู่ กรุณารอรายการเดิมก่อน`,'info');return;}inflight.add(name);try{return await orig.apply(this,args);}finally{setTimeout(()=>inflight.delete(name),250);}};wrapped.__demoSingleFlight=true;installedGuards.add(name);window[name]=wrapped;return true;}
  function installGuards(){['saveQuote','saveInvoice','saveReceipt','saveProduction','saveExpense','pcSavePo','pcPostGoodsReceipt','pcPostAdjustment','pcPostTransfer'].forEach(singleFlight);}
  function init(){if(window.__LOCAL_DEMO_HEALTH__)return;window.__LOCAL_DEMO_HEALTH__=true;ensureButton();installGuards();let n=0;const t=setInterval(()=>{ensureButton();installGuards();if(++n>20)clearInterval(t);},300);}
  window.addEventListener('error',e=>errors.push({message:e.message||String(e.error||'error'),at:new Date().toISOString()}));
  window.addEventListener('unhandledrejection',e=>errors.push({message:String(e.reason?.message||e.reason||'promise rejection'),at:new Date().toISOString()}));
  window.LocalDemoHealth={VERSION,open:openHealth,snapshot};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,350));else setTimeout(init,350);
})();
