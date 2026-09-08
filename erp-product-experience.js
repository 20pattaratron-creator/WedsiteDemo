// =====================================================================
// erp-product-experience.js — simpler daily UX + workflow + approvals
// DEMO 4.2.0 · local UX layer, not authorization/security
// =====================================================================
import {PRODUCT_EXPERIENCE_VERSION,ROLE_CONFIG,normalizeRole,buildWorkQueue,buildStockAvailability,approvalRows} from './erp-product-experience-core.js';
import { localDateISO, parseBusinessDate } from './erp-shared-core.js';
import { ORDER_TO_CASH_STEPS, workflowStageForNavigation } from './erp-workflow-definitions.js';

const VERSION='4.2.0';
const STORAGE_ROLE='erp_product_experience_role_v1';
const STORAGE_MODE='erp_product_experience_mode_v1';
const BRANCH_LABEL={ubon:'สำนักงานใหญ่',khonkaen:'สาขาที่ 00001'};
const PANEL_LABEL={
  'work-home':'งานของฉัน',dashboard:'ภาพรวมผู้บริหาร',analytics:'วิเคราะห์ธุรกิจ','master-data':'ลูกค้า / ผู้จำหน่าย / สินค้า','business-rules':'สูตรและกฎธุรกิจ',
  'quote-form':'สร้างใบเสนอราคา','quote-list':'รายการใบเสนอราคา','invoice-form':'สร้างใบส่งสินค้า / ใบกำกับภาษี','invoice-list':'รายการใบส่งสินค้า / ใบกำกับภาษี',
  'receipt-form':'รับชำระ / ใบเสร็จ','receipt-list':'รายการใบเสร็จ','production-form':'สั่งผลิต','production-list':'ติดตามงานสั่งผลิต','purchase-order':'จัดซื้อ / PO',
  'goods-receipt':'รับสินค้าเข้าคลัง',inventory:'คลังสินค้า','expense-form':'บันทึกค่าใช้จ่าย','expense-list':'รายการค่าใช้จ่าย','linked-flow':'Trace เอกสาร',
  'order-flow':'ขาย → ส่ง → วางบิล → รับเงิน','approval-center':'ศูนย์อนุมัติ','customer-portal':'พอร์ทัลลูกค้า (Preview)','audit-log':'ศูนย์ควบคุม','saas-admin':'ตั้งค่าบริษัท',files:'สำรอง / นำเข้าข้อมูล'
};
const ROLE_PANELS={
  management:['work-home','dashboard','analytics','approval-center','order-flow','linked-flow','master-data','customer-portal','quote-list','invoice-list','production-list','inventory','purchase-order','files'],
  sales:['work-home','quote-form','quote-list','order-flow','linked-flow','master-data','customer-portal','invoice-list','production-list'],
  purchasing:['work-home','approval-center','purchase-order','goods-receipt','inventory','master-data','production-list','order-flow'],
  warehouse:['work-home','goods-receipt','inventory','production-list','order-flow','linked-flow','invoice-list'],
  accounting:['work-home','approval-center','order-flow','invoice-list','invoice-form','receipt-list','receipt-form','expense-form','expense-list','customer-portal','files'],
  admin:['*']
};
const ADVANCED_PANELS=new Set(['analytics','business-rules','audit-log','saas-admin','files']);
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const money=v=>new Intl.NumberFormat('th-TH',{minimumFractionDigits:0,maximumFractionDigits:2}).format(n(v));
const norm=v=>String(v??'').trim().toLowerCase();
const storageKey=key=>window.ComformTenant?.storageKey?.(key)||key;
const today=()=>localDateISO();

function readSetting(key,fallback){try{return localStorage.getItem(storageKey(key))||fallback;}catch{return fallback;}}
function writeSetting(key,value){try{localStorage.setItem(storageKey(key),String(value));}catch{}}
function currentRole(){return normalizeRole(readSetting(STORAGE_ROLE,'management'));}
function isAdvanced(){return readSetting(STORAGE_MODE,'simple')==='advanced';}
function itemKey(x){return norm(x?.productCode||x?.code||x?.sku||x?.product||x?.name);}

function snapshot(){
  const business=window.ERPIntegrity?.business?.()||{quotes:[],invoices:[],receipts:[],productions:[],expenses:[]};
  const flow=window.ERPOrderFlow?.getStore?.()||{salesOrders:[],billingNotes:[],payments:[],reservations:[]};
  const ops=window.ERPProductionCore?.exportData?.()||{purchaseOrders:[],goodsReceipts:[],inventoryMovements:[]};
  const products=window.productMasterRows?.()||[];
  const branches=['ubon','khonkaen'].filter(b=>window.SaaSService?.isBranchActive?.(b)??true);
  const invoices=(business.invoices||[]).map(inv=>{
    const summary=window.ERPIntegrity?.paymentSummary?.(inv)||{outstanding:n(inv.total),paid:0};
    return {...inv,outstanding:summary.outstanding,paidAmount:summary.paid};
  });
  const stock=buildStockAvailability({products,branches,flow,ops,onHand:(p,b)=>window.ERPProductionCore?.stockOnHand?.(p,b)??window.productEstimatedStock?.(p,b)??0});
  return {business:{...business,invoices},flow,ops,products,branches,stock};
}

function navPanel(item){return (item.getAttribute('onclick')||'').match(/go\('([^']+)'/)?.[1]||item.dataset.pePanel||'';}
function makeNavItem(panel,label,icon){
  const el=document.createElement('div');el.className='nav-item pe-created-nav';el.dataset.pePanel=panel;el.setAttribute('onclick',`go('${panel}',this)`);el.innerHTML=`<span class="pe-nav-icon" aria-hidden="true">${icon}</span>${esc(label)}`;return el;
}

function ensurePanels(){
  const main=document.querySelector('.main');if(!main)return;
  if(!document.getElementById('panel-work-home')){const p=document.createElement('div');p.id='panel-work-home';p.className='panel';p.innerHTML='<div id="pe-work-home"></div>';main.prepend(p);}
  if(!document.getElementById('panel-approval-center')){const p=document.createElement('div');p.id='panel-approval-center';p.className='panel';p.innerHTML='<div id="pe-approval-center"></div>';main.appendChild(p);}
  if(!document.getElementById('panel-customer-portal')){const p=document.createElement('div');p.id='panel-customer-portal';p.className='panel';p.innerHTML='<div id="pe-customer-portal"></div>';main.appendChild(p);}
}

function ensureNavigation(){
  const nav=document.querySelector('.sidebar');if(!nav)return;
  if(!nav.querySelector('[data-pe-panel="work-home"]')){
    const firstItem=nav.querySelector('.nav-item');const home=makeNavItem('work-home','งานของฉัน','🏠');firstItem?.before(home);
    const approval=makeNavItem('approval-center','ศูนย์อนุมัติ','✅');const flow=[...nav.querySelectorAll('.nav-item')].find(x=>navPanel(x)==='linked-flow');flow?.after(approval);
    const portal=makeNavItem('customer-portal','พอร์ทัลลูกค้า (Preview)','👤');approval.after(portal);
  }
  nav.querySelectorAll('.nav-item').forEach(item=>{
    const panel=navPanel(item);if(panel)item.dataset.pePanel=panel;
    if(PANEL_LABEL[panel]){
      const svg=item.querySelector('svg');const icon=item.querySelector('.pe-nav-icon');item.childNodes.forEach(node=>{if(node.nodeType===3)node.remove();});item.append(document.createTextNode(PANEL_LABEL[panel]));
      if(svg&&!item.contains(svg))item.prepend(svg);if(icon&&!item.contains(icon))item.prepend(icon);
    }
    if(ADVANCED_PANELS.has(panel))item.dataset.peAdvanced='1';
  });
}

function ensureTopControls(){
  const top=document.querySelector('.comform-topbar');if(!top||document.getElementById('pe-role-controls'))return;
  const wrap=document.createElement('div');wrap.id='pe-role-controls';wrap.className='pe-role-controls';
  wrap.innerHTML=`<label class="pe-role-select"><span>มุมมอง</span><select id="pe-role-select">${Object.entries(ROLE_CONFIG).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select></label><button type="button" id="pe-mode-toggle" class="pe-mode-toggle" aria-pressed="false">โหมดง่าย</button>`;
  top.insertBefore(wrap,document.getElementById('topbar-ctx'));
  const select=wrap.querySelector('#pe-role-select');select.value=currentRole();select.addEventListener('change',()=>{writeSetting(STORAGE_ROLE,select.value);applyExperience();renderCurrent();});
  wrap.querySelector('#pe-mode-toggle').addEventListener('click',()=>{writeSetting(STORAGE_MODE,isAdvanced()?'simple':'advanced');applyExperience();renderCurrent();});
}

function applyExperience(){
  const role=currentRole(),advanced=isAdvanced();document.body.dataset.erpRole=role;document.body.classList.toggle('erp-advanced-mode',advanced);document.body.classList.toggle('erp-simple-mode',!advanced);
  const allowed=ROLE_PANELS[role]||ROLE_PANELS.management;
  document.querySelectorAll('.sidebar .nav-item').forEach(item=>{
    const panel=navPanel(item);const roleOk=allowed.includes('*')||allowed.includes(panel);const advOk=advanced||!item.dataset.peAdvanced;
    item.hidden=!(roleOk&&advOk);
  });
  document.querySelectorAll('.sidebar .nav-sec').forEach(x=>x.hidden=true);
  const btn=document.getElementById('pe-mode-toggle');if(btn){btn.textContent=advanced?'โหมดขั้นสูง':'โหมดง่าย';btn.setAttribute('aria-pressed',String(advanced));}
  const select=document.getElementById('pe-role-select');if(select&&select.value!==role)select.value=role;
  document.querySelectorAll('#erp-dashboard-views [data-dashboard-view="forecast"],#erp-dashboard-views [data-dashboard-view="risk"]').forEach(x=>x.hidden=!advanced);
  document.querySelectorAll('#panel-dashboard .target-section').forEach(x=>x.classList.toggle('pe-legacy-target',!advanced));
  document.querySelectorAll('#panel-dashboard .quant-section,#panel-dashboard .forecast-section').forEach(x=>x.classList.toggle('pe-advanced-block',!advanced));
  const active=document.querySelector('.panel.active')?.id?.replace('panel-','')||'';const activeNav=[...document.querySelectorAll('.sidebar .nav-item')].find(x=>navPanel(x)===active);if(activeNav?.hidden)window.go?.('work-home');
}

function quickAction(panel,label,cls=''){return `<button type="button" class="pe-action ${cls}" data-pe-go="${panel}">${label}</button>`;}
function severityIcon(s){return ({critical:'⛔',high:'🔴',medium:'🟠',low:'🟡',info:'🔵'})[s]||'•';}

function homeKpis(s,role){
  const b=s.business,f=s.flow,o=s.ops;
  const ar=(b.invoices||[]).reduce((sum,x)=>sum+n(x.outstanding),0);
  const openOrders=(f.salesOrders||[]).filter(x=>!['completed','cancelled'].includes(norm(x.status))).length;
  const openPo=(o.purchaseOrders||[]).filter(x=>!['received','cancelled'].includes(norm(x.status))).length;
  const low=(s.stock||[]).filter(x=>n(x.available)>=0&&n(x.reorderPoint)>0&&n(x.available)<=n(x.reorderPoint)).length;
  if(role==='sales')return [['Quote รออนุมัติ',(b.quotes||[]).filter(q=>!q.approved).length],['Sales Order กำลังทำ',openOrders],['ยอดลูกหนี้',`฿${money(ar)}`],['พร้อมส่ง',(f.salesOrders||[]).filter(x=>(x.items||[]).some(i=>n(i.readyQty)>n(i.deliveredQty))).length]];
  if(role==='purchasing')return [['Open PO',openPo],['PO ร่าง',(o.purchaseOrders||[]).filter(p=>norm(p.status)==='draft').length],['Stock ต่ำ',low],['งานสั่งผลิต',(b.productions||[]).filter(p=>!['completed','cancelled'].includes(norm(p.status))).length]];
  if(role==='warehouse')return [['พร้อมส่ง',(f.salesOrders||[]).filter(x=>(x.items||[]).some(i=>n(i.readyQty)>n(i.deliveredQty))).length],['รอรับสินค้า',openPo],['Stock ต่ำ',low],['Stock ติดลบ',(s.stock||[]).filter(x=>n(x.available)<0).length]];
  if(role==='accounting')return [['ยอดลูกหนี้',`฿${money(ar)}`],['Invoice ค้าง',(b.invoices||[]).filter(i=>n(i.outstanding)>0).length],['ใบวางบิล',(f.billingNotes||[]).filter(x=>!['paid','cancelled'].includes(norm(x.status))).length],['ค่าใช้จ่าย',(b.expenses||[]).length]];
  return [['ยอดลูกหนี้',`฿${money(ar)}`],['Sales Order กำลังทำ',openOrders],['Open PO',openPo],['Stock ต่ำ/เสี่ยง',low+(s.stock||[]).filter(x=>n(x.available)<0).length]];
}

function renderWorkHome(){
  const root=document.getElementById('pe-work-home');if(!root)return;const role=currentRole(),s=snapshot(),queue=buildWorkQueue(s,role,{today:today()}),kpis=homeKpis(s,role);const roleLabel=ROLE_CONFIG[role]?.label||role;
  const actions={management:[['dashboard','ภาพรวมผู้บริหาร'],['approval-center','อนุมัติงาน'],['analytics','วิเคราะห์ธุรกิจ'],['customer-portal','พอร์ทัลลูกค้า']],sales:[['quote-form','+ ใบเสนอราคา'],['order-flow','Sales Order / งานขาย'],['master-data','ลูกค้าและสินค้า'],['customer-portal','พอร์ทัลลูกค้า']],purchasing:[['purchase-order','+ สร้าง PO'],['goods-receipt','รับสินค้า'],['inventory','ดู Stock'],['approval-center','อนุมัติ']],warehouse:[['goods-receipt','รับสินค้า'],['inventory','Stock พร้อมใช้'],['order-flow','งานพร้อมส่ง'],['linked-flow','Trace เอกสาร']],accounting:[['order-flow','วางบิล / รับเงิน'],['invoice-list','Invoice'],['receipt-form','+ รับชำระ'],['expense-form','+ ค่าใช้จ่าย']],admin:[['dashboard','Dashboard'],['approval-center','Approval'],['analytics','Analytics'],['audit-log','Audit']]};
  root.innerHTML=`<section class="pe-home-hero"><div><span class="pe-kicker">DEMO ${VERSION} · ${esc(roleLabel)}</span><h1>วันนี้ควรทำอะไรต่อ?</h1><p>หน้าแรกแบบงานประจำวัน ระบบสรุปงานค้างและพาไปขั้นตอนถัดไป โดย Analytics ขั้นสูงยังเก็บไว้ในโหมดขั้นสูง</p></div><div class="pe-home-search"><button type="button" class="btn btn-primary" data-pe-search>🔎 ค้นหาลูกค้า / เอกสาร</button></div></section>
  <section class="pe-kpi-grid">${kpis.map(([l,v])=>`<article><small>${esc(l)}</small><b>${esc(v)}</b></article>`).join('')}</section>
  <section class="pe-quick-actions"><h2>ทางลัด</h2><div>${(actions[role]||actions.management).map(([p,l])=>quickAction(p,l)).join('')}</div></section>
  <section class="pe-work-section"><div class="pe-section-head"><div><h2>งานที่ต้องดำเนินการ</h2><p>เรียงจากความเสี่ยงสูงไปต่ำ</p></div><span>${queue.length} รายการ</span></div>${queue.length?`<div class="pe-work-list">${queue.map(q=>`<article class="pe-work-item is-${q.severity}"><div class="pe-work-icon">${severityIcon(q.severity)}</div><div class="pe-work-copy"><b>${esc(q.title)}</b><span>${esc(q.detail)}</span></div><button type="button" data-pe-go="${esc(q.panel)}">${esc(q.action)}</button></article>`).join('')}</div>`:'<div class="pe-empty-good">✅ ไม่พบงานค้างระดับสำคัญจากกฎ Operational ปัจจุบัน</div>'}</section>
  <section class="pe-value-prop"><div><b>ขาย</b><span>Quote → Sales Order</span></div><i>→</i><div><b>จัดสินค้า</b><span>Stock / ผลิต / ซื้อ</span></div><i>→</i><div><b>ส่ง</b><span>Delivery / Tax Invoice</span></div><i>→</i><div><b>เก็บเงิน</b><span>Billing → Payment → Receipt</span></div></section>`;
  bindCommon(root);
}

function bindCommon(root=document){
  root.querySelectorAll('[data-pe-go]').forEach(btn=>btn.addEventListener('click',()=>window.go?.(btn.dataset.peGo)));
  root.querySelectorAll('[data-pe-search]').forEach(btn=>btn.addEventListener('click',()=>window.ERPCustomerExperience?.openSearch?.()));
}

function approveQuote(ref){
  const s=snapshot(),q=(s.business.quotes||[]).find(x=>String(x.id)===String(ref)||String(x.no)===String(ref));if(!q)return window.notify?.('ไม่พบใบเสนอราคา','error');
  if(!confirm(`อนุมัติ ${q.no||'ใบเสนอราคา'} ของ ${q.customer||'-'} ใช่หรือไม่?`))return;
  {const qd=parseBusinessDate(q.date);window.toggleApprove?.(q._branch||q.branch,Number(q._year||qd?.year||new Date().getFullYear()),Number(q._month??(qd?qd.month-1:new Date().getMonth())),q.id,true);}setTimeout(()=>{renderApprovalCenter();renderWorkHome();},80);
}

function approvePo(id){
  const core=window.ERPProductionCore;if(!core?.exportData||!core?.importData)return window.notify?.('Production Core ยังไม่พร้อม','error');const data=core.exportData();const po=(data.purchaseOrders||[]).find(x=>String(x.id)===String(id));if(!po)return window.notify?.('ไม่พบ PO','error');
  if(!confirm(`ตรวจและอนุมัติ ${po.no||'PO'} เพื่อเปลี่ยนสถานะเป็น “ส่งคำสั่งซื้อแล้ว” ใช่หรือไม่?`))return;
  const updated=(data.purchaseOrders||[]).map(x=>String(x.id)===String(id)?{...x,status:'ordered',approvedAt:new Date().toISOString(),approvedBy:`DEMO:${ROLE_CONFIG[currentRole()]?.label||currentRole()}`,updatedAt:new Date().toISOString(),updatedAtIso:new Date().toISOString()}:x);
  core.importData({purchaseOrders:updated},{replace:true});core.audit?.('update','purchase_order',po.no||id,'อนุมัติ PO จาก Approval Center (DEMO UX)',{branch:po.branch});window.notify?.(`อนุมัติ ${po.no||'PO'} แล้ว`);renderApprovalCenter();renderWorkHome();
}

function renderApprovalCenter(){
  const root=document.getElementById('pe-approval-center');if(!root)return;const s=snapshot(),rows=approvalRows(s),role=currentRole();
  root.innerHTML=`<section class="pe-page-head"><div><span>APPROVAL INBOX</span><h1>✅ ศูนย์อนุมัติ</h1><p>รวมงานที่ต้องตรวจไว้หน้าเดียว ลดการไล่เปิดหลายเมนู · โหมดนี้เป็น Workflow Demo ไม่ใช่สิทธิ์ฝั่ง Server</p></div><div class="pe-role-pill">${esc(ROLE_CONFIG[role]?.label||role)}</div></section>
  <div class="pe-approval-grid"><section class="card"><div class="pe-section-head"><div><h2>ใบเสนอราคา</h2><p>ตรวจราคาและเงื่อนไขก่อนสร้าง Sales Order</p></div><span>${rows.quotes.length}</span></div>${rows.quotes.length?`<div class="pe-approval-list">${rows.quotes.slice(0,30).map(q=>`<article><div><b>${esc(q.no||'-')}</b><span>${esc(q.customer||'-')} · ฿${money(q.total)}</span></div><button type="button" data-approve-quote="${esc(q.id||q.no)}">อนุมัติ</button></article>`).join('')}</div>`:'<div class="pe-empty-good">ไม่มีใบเสนอราคารออนุมัติ</div>'}</section>
  <section class="card"><div class="pe-section-head"><div><h2>ใบสั่งซื้อ (PO)</h2><p>ตรวจ Supplier, ราคา และกำหนดรับก่อนส่งคำสั่งซื้อ</p></div><span>${rows.purchaseOrders.length}</span></div>${rows.purchaseOrders.length?`<div class="pe-approval-list">${rows.purchaseOrders.slice(0,30).map(p=>`<article><div><b>${esc(p.no||'-')}</b><span>${esc(p.supplier||'-')} · ฿${money(p.subtotal)} · ${esc(p.expectedDate||'ไม่ระบุกำหนดรับ')}</span></div><button type="button" data-approve-po="${esc(p.id)}">ตรวจและอนุมัติ</button></article>`).join('')}</div>`:'<div class="pe-empty-good">ไม่มี PO รออนุมัติ</div>'}</section></div>
  <section class="pe-policy-note"><b>Production ต่อไป:</b> Approval ต้องบังคับด้วย Role/Permission ฝั่ง Server, เก็บผู้อนุมัติจริง, เวลา Server และ Approval Policy ตามวงเงิน</section>`;
  root.querySelectorAll('[data-approve-quote]').forEach(b=>b.addEventListener('click',()=>approveQuote(b.dataset.approveQuote)));
  root.querySelectorAll('[data-approve-po]').forEach(b=>b.addEventListener('click',()=>approvePo(b.dataset.approvePo)));
}

function customerNames(){return (window.contactMasterRows?.()||[]).filter(r=>['customer','both'].includes(r.role)).map(r=>r.name).filter(Boolean).sort((a,b)=>a.localeCompare(b,'th'));}
function customerMatches(row,name){return norm(row?.customer||row?.name)===norm(name);}
function statusBadge(text,tone='gray'){return `<span class="pe-status ${tone}">${esc(text)}</span>`;}
function renderCustomerPortal(){
  const root=document.getElementById('pe-customer-portal');if(!root)return;const names=customerNames();const selected=root.dataset.customer||names[0]||'';root.dataset.customer=selected;
  const s=snapshot(),b=s.business,f=s.flow;const quotes=(b.quotes||[]).filter(x=>customerMatches(x,selected));const orders=(f.salesOrders||[]).filter(x=>norm(x.customer)===norm(selected));const invoices=(b.invoices||[]).filter(x=>customerMatches(x,selected));const receipts=(b.receipts||[]).filter(x=>customerMatches(x,selected));const billings=(f.billingNotes||[]).filter(x=>norm(x.customer)===norm(selected));const outstanding=invoices.reduce((sum,i)=>sum+n(i.outstanding),0);
  root.innerHTML=`<section class="pe-page-head"><div><span>CUSTOMER PORTAL PREVIEW</span><h1>👤 พอร์ทัลลูกค้า</h1><p>มุมมองตัวอย่างที่ตั้งใจให้ลูกค้าเห็นเฉพาะเอกสารและสถานะของตนเอง ไม่แสดงต้นทุน กำไร หรือข้อมูลภายใน</p></div><div class="pe-portal-warning">Preview ในเครื่องนี้ · ยังไม่ใช่ลิงก์ภายนอกที่มี Authentication</div></section>
  <section class="card pe-portal-toolbar"><label>เลือกลูกค้า<select id="pe-portal-customer">${names.length?names.map(x=>`<option ${x===selected?'selected':''}>${esc(x)}</option>`).join(''):'<option>ยังไม่มีลูกค้า</option>'}</select></label><button type="button" class="btn btn-ghost" data-pe-search>ค้นหาทั้งระบบ</button></section>
  <section class="pe-portal-hero"><div><small>ลูกค้า</small><h2>${esc(selected||'ยังไม่มีข้อมูลลูกค้า')}</h2><span>ยอดค้างชำระ ฿${money(outstanding)}</span></div><div class="pe-portal-kpis"><div><b>${quotes.length}</b><span>ใบเสนอราคา</span></div><div><b>${orders.length}</b><span>Sales Order</span></div><div><b>${invoices.length}</b><span>Invoice</span></div><div><b>${receipts.length}</b><span>Receipt</span></div></div></section>
  <div class="pe-portal-grid"><section class="card"><h3>สถานะคำสั่งซื้อ</h3>${orders.length?orders.slice(0,8).map(o=>{const rem=(o.items||[]).reduce((sum,i)=>sum+Math.max(0,n(i.qty)-n(i.deliveredQty)),0);return `<div class="pe-doc-row"><div><b>${esc(o.no||'-')}</b><span>${esc(o.requiredDate||'')}</span></div>${statusBadge(rem>0?`กำลังดำเนินการ · คงเหลือ ${rem}`:'ส่งครบ',rem>0?'amber':'green')}</div>`;}).join(''):'<div class="pe-empty">ยังไม่มี Sales Order</div>'}</section>
  <section class="card"><h3>Invoice / การชำระ</h3>${invoices.length?invoices.slice(0,10).map(i=>`<div class="pe-doc-row"><div><b>${esc(i.no||'-')}</b><span>${esc(i.date||'')} · ฿${money(i.total)}</span></div>${n(i.outstanding)>0?statusBadge(`คงค้าง ฿${money(i.outstanding)}`,'amber'):statusBadge('ชำระแล้ว','green')}</div>`).join(''):'<div class="pe-empty">ยังไม่มี Invoice</div>'}</section>
  <section class="card"><h3>ใบวางบิล</h3>${billings.length?billings.slice(0,8).map(x=>`<div class="pe-doc-row"><div><b>${esc(x.no||'-')}</b><span>฿${money(x.totalBilled||x.total)}</span></div>${statusBadge(x.status||'draft',x.status==='paid'?'green':'blue')}</div>`).join(''):'<div class="pe-empty">ยังไม่มีใบวางบิล</div>'}</section>
  <section class="card"><h3>เอกสารล่าสุด</h3>${[...quotes.map(x=>({...x,_k:'Quotation'})),...receipts.map(x=>({...x,_k:'Receipt'}))].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).slice(0,8).map(x=>`<div class="pe-doc-row"><div><b>${esc(x.no||'-')}</b><span>${esc(x._k)} · ${esc(x.date||'')}</span></div></div>`).join('')||'<div class="pe-empty">ยังไม่มีเอกสาร</div>'}</section></div>`;
  root.querySelector('#pe-portal-customer')?.addEventListener('change',e=>{root.dataset.customer=e.target.value;renderCustomerPortal();});bindCommon(root);
}

function renderAvailability(){
  const panel=document.getElementById('panel-inventory');if(!panel)return;let root=document.getElementById('pe-stock-availability');if(!root){root=document.createElement('section');root.id='pe-stock-availability';root.className='card pe-stock-availability';panel.prepend(root);}
  const s=snapshot(),filter=document.getElementById('inv-branch-filter')?.value||'all';let rows=s.stock||[];if(filter!=='all')rows=rows.filter(r=>r.branch===filter);
  if(filter==='all'){
    const map=new Map();for(const r of rows){const k=itemKey(r);const old=map.get(k)||{...r,branch:'all',onHand:0,reserved:0,available:0,incoming:0};old.onHand+=n(r.onHand);old.reserved+=n(r.reserved);old.available+=n(r.available);old.incoming+=n(r.incoming);old.reorderPoint=Math.max(n(old.reorderPoint),n(r.reorderPoint));map.set(k,old);}rows=[...map.values()];
  }
  rows.sort((a,b)=>(n(a.available)-n(b.available))||String(a.product).localeCompare(String(b.product),'th'));
  root.innerHTML=`<div class="pe-section-head"><div><h2>📦 สินค้าพร้อมใช้</h2><p>On Hand − Reserved = Available · Incoming แสดงจำนวนจาก PO ที่ยังรับไม่ครบ</p></div><span>${filter==='all'?'รวมทุกสาขา':esc(BRANCH_LABEL[filter]||filter)}</span></div><div class="pe-availability-legend"><span>On Hand = มีจริง</span><span>Reserved = จองให้ Order</span><span>Available = ขาย/ส่งได้</span><span>Incoming = กำลังเข้า</span></div><div class="tbl-wrap"><table class="pe-availability-table"><thead><tr><th>สินค้า</th><th>On Hand</th><th>Reserved</th><th>Available</th><th>Incoming PO</th><th>Reorder</th><th>สถานะ</th></tr></thead><tbody>${rows.slice(0,100).map(r=>{const tone=n(r.available)<0?'red':n(r.reorderPoint)>0&&n(r.available)<=n(r.reorderPoint)?'amber':'green';const status=n(r.available)<0?'ผิดปกติ':tone==='amber'?'ควรตรวจจัดซื้อ':'พร้อมใช้';return `<tr><td><b>${esc(r.productCode||'-')}</b><span>${esc(r.product||'')}</span></td><td>${money(r.onHand)}</td><td>${money(r.reserved)}</td><td><b>${money(r.available)}</b></td><td>${money(r.incoming)}</td><td>${money(r.reorderPoint)}</td><td>${statusBadge(status,tone)}</td></tr>`;}).join('')}</tbody></table></div>`;
}

function workflowStep(panel,subview=''){return workflowStageForNavigation(panel,subview);}
function ensureWorkflowRibbon(){const main=document.querySelector('.main');if(!main||document.getElementById('pe-workflow-ribbon'))return;const bar=document.createElement('div');bar.id='pe-workflow-ribbon';bar.className='pe-workflow-ribbon';main.prepend(bar);}
let activeWorkflowSubview='';
function renderWorkflowRibbon(panel,subview=activeWorkflowSubview){
  const bar=document.getElementById('pe-workflow-ribbon');if(!bar)return;const active=workflowStep(panel,subview);if(active<0||panel==='work-home'){bar.hidden=true;return;}bar.hidden=false;
  bar.innerHTML=`<span class="pe-workflow-label">Order-to-Cash</span>${ORDER_TO_CASH_STEPS.map((step,i)=>`<button type="button" class="${i===active?'active':''}" data-pe-go="${step.panel}"${step.subview?` data-pe-subview="${step.subview}"`:''}><i>${i+1}</i>${step.label}</button>${i<ORDER_TO_CASH_STEPS.length-1?'<b>›</b>':''}`).join('')}`;
  bar.querySelectorAll('[data-pe-subview]').forEach(btn=>btn.addEventListener('click',()=>{const sub=btn.dataset.peSubview;if(btn.dataset.peGo==='order-flow')window.ERPOrderFlow?.openTab?.(sub);}));
  bindCommon(bar);
}

function renderCurrent(panel=document.querySelector('.panel.active')?.id?.replace('panel-','')||'',subview=activeWorkflowSubview){
  if(panel==='work-home')renderWorkHome();if(panel==='approval-center')renderApprovalCenter();if(panel==='customer-portal')renderCustomerPortal();if(panel==='inventory')setTimeout(renderAvailability,40);renderWorkflowRibbon(panel,subview);
}

function patchCopy(){
  const eyebrow=document.querySelector('.master-page-head small');if(eyebrow&&/FLOWACCOUNT/i.test(eyebrow.textContent||''))eyebrow.textContent='MASTER DATA · ใช้ซ้ำ ลดการกรอกข้อมูล';
  const note=document.querySelector('.master-flow-note');if(note&&/FlowAccount/i.test(note.textContent||''))note.innerHTML='<b>รูปแบบสินค้า:</b> Inventory / Non-Inventory / Service และระบบแยกวิธีจัดหาเป็น <b>สินค้าในสต็อก</b> หรือ <b>สินค้าสั่งผลิต</b> เพื่อให้ Fulfillment ชัดเจน';
  const flowLabel=document.querySelector('label:has(#md-p-flow-type) span');if(flowLabel)flowLabel.textContent='ประเภทสินค้า';
  const brEye=document.querySelector('.brules-eyebrow');if(brEye)brEye.textContent='BUSINESS RULES · ADVANCED';
  const targetNote=document.querySelector('.monthly-target-planner-note');if(targetNote)targetNote.textContent='เป้าหมายบันทึกแยกบริษัท สาขา ปี และเดือนในพื้นที่ทดลองนี้ โดยคงค่าเดิมเป็น fallback เพื่อไม่ทำข้อมูลเก่าหาย';
}

function init(){
  if(window.__ERP_PRODUCT_EXPERIENCE__)return;window.__ERP_PRODUCT_EXPERIENCE__=true;ensurePanels();ensureNavigation();ensureTopControls();ensureWorkflowRibbon();patchCopy();applyExperience();
  document.addEventListener('erp:navigation',e=>{const id=e?.detail?.id||'';activeWorkflowSubview=e?.detail?.subview||'';setTimeout(()=>{applyExperience();renderCurrent(id,activeWorkflowSubview);},30);});
  window.addEventListener('erp-flow:changed',()=>setTimeout(()=>renderCurrent(),40));
  document.addEventListener('erp:dashboard-rendered',()=>{if(document.querySelector('.panel.active')?.id==='panel-work-home')renderWorkHome();});
  document.addEventListener('change',e=>{if(e.target?.id==='inv-branch-filter')setTimeout(renderAvailability,20);});
  window.ERPProductExperience={VERSION,PRODUCT_EXPERIENCE_VERSION,currentRole,isAdvanced,snapshot,renderWorkHome,renderApprovalCenter,renderCustomerPortal,renderAvailability,applyExperience};
  // Make the product-first home the default on a fresh browser session. Existing active work is preserved after navigation.
  setTimeout(()=>{if(document.querySelector('#panel-dashboard.active'))window.go?.('work-home');else renderCurrent();},220);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,160));else setTimeout(init,160);
