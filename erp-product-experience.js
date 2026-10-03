// =====================================================================
// erp-product-experience.js — simpler daily UX + workflow + approvals
// DEMO 4.3.0 · local UX layer, not authorization/security
// =====================================================================
import {PRODUCT_EXPERIENCE_VERSION,buildWorkQueue,buildStockAvailability,approvalRows,NAV_SECTIONS,navEntryPanel,navFormBackTargets,parseCollapsedNavSections} from './erp-product-experience-core.js';
import { localDateISO, parseBusinessDate } from './erp-shared-core.js';
import { ORDER_TO_CASH_STEPS, workflowStageForNavigation } from './erp-workflow-definitions.js';
import { invoiceDueDate } from './erp-receivables-core.js';
import { PRODUCT_EXPERIENCE_ROLE_KEY, PRODUCT_EXPERIENCE_MODE_KEY, NAV_COLLAPSED_SECTIONS_KEY } from './erp-storage-contracts.js';
import { icon } from './erp-icons.js';

const VERSION='4.3.1';
// Single Admin view (ADR-014): the former per-role "มุมมอง" choice is retired; its stored value is only removed.
const RETIRED_ROLE_SETTING=PRODUCT_EXPERIENCE_ROLE_KEY;
const STORAGE_MODE=PRODUCT_EXPERIENCE_MODE_KEY;
const BRANCH_LABEL={ubon:'สำนักงานใหญ่',khonkaen:'สาขาที่ 00001'};
// Menu text of each entry. One entry per document type opens its list (ADR-015); the forms
// (quote-form, invoice-form, …) have no entry — their list's entry is highlighted instead.
// The order-flow entry keeps the text erp-order-flow.js gives it (with its badge).
const PANEL_LABEL={
  'work-home':'งานของฉัน',dashboard:'ภาพรวมผู้บริหาร',analytics:'วิเคราะห์ธุรกิจ','master-data':'ลูกค้า / ผู้จำหน่าย / สินค้า','business-rules':'สูตรและกฎธุรกิจ',
  'quote-list':'ใบเสนอราคา','invoice-list':'ใบส่งสินค้า / ใบกำกับภาษี','receipt-list':'ใบเสร็จ / รับชำระ','credit-note-list':'ใบลดหนี้','production-list':'สั่งผลิต','purchase-order':'จัดซื้อ / PO',
  'goods-receipt':'รับสินค้าเข้าคลัง',inventory:'คลังสินค้า','expense-list':'ค่าใช้จ่าย','linked-flow':'Trace เอกสาร',
  'approval-center':'ศูนย์อนุมัติ','customer-portal':'พอร์ทัลลูกค้า (Preview)','audit-log':'ศูนย์ควบคุม','saas-admin':'ตั้งค่าบริษัท',files:'สำรอง / นำเข้าข้อมูล'
};
// Line icons (erp-icons.js, ADR-017) of the entries created by JavaScript, which used emoji
// before (ADR-015). The static entries in index.html use the same icon set.
const NAV_ICONS={'work-home':'home','approval-center':'approval','customer-portal':'user','order-flow':'transfer'};
const ADVANCED_PANELS=new Set(['analytics','business-rules','audit-log','saas-admin','files']);
// "ทางลัด" on งานของฉัน; advanced screens are offered only in โหมดขั้นสูง (their menu items are hidden in โหมดง่าย).
const QUICK_ACTIONS=[
  ['dashboard','ภาพรวมผู้บริหาร'],
  ['approval-center','อนุมัติงาน'],
  ['order-flow','งานขาย / วางบิล / รับเงิน'],
  ['customer-portal','พอร์ทัลลูกค้า'],
  ['analytics','วิเคราะห์ธุรกิจ'],
  ['audit-log','ศูนย์ควบคุม']
];
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const money=v=>new Intl.NumberFormat('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n(v));
const norm=v=>String(v??'').trim().toLowerCase();
const storageKey=key=>window.ComformTenant?.storageKey?.(key)||key;
const today=()=>localDateISO();

function readSetting(key,fallback){try{return localStorage.getItem(storageKey(key))||fallback;}catch{return fallback;}}
function writeSetting(key,value){try{localStorage.setItem(storageKey(key),String(value));}catch(error){console.warn('[ProductUX] unable to persist local UX preference',error);}}
function removeRetiredRoleSetting(){
  try{
    localStorage.removeItem(storageKey(RETIRED_ROLE_SETTING));
  }catch(error){
    console.warn('[ProductUX] unable to remove the retired view setting',error);
  }
}
function isAdvanced(){return readSetting(STORAGE_MODE,'simple')==='advanced';}
function itemKey(x){return norm(x?.productCode||x?.code||x?.sku||x?.product||x?.name);}

function snapshot(){
  const business=window.ERPIntegrity?.business?.()||{quotes:[],invoices:[],receipts:[],productions:[],expenses:[]};
  const flow=window.ERPOrderFlow?.getStore?.()||{salesOrders:[],billingNotes:[],payments:[],reservations:[]};
  const ops=window.ERPProductionCore?.exportData?.()||{purchaseOrders:[],goodsReceipts:[],inventoryMovements:[]};
  const products=window.productMasterRows?.()||[];
  const branches=['ubon','khonkaen'].filter(b=>window.SaaSService?.isBranchActive?.(b)??true);
  // Cancelled/voided invoices are not receivables; paymentSummary() does not check the invoice's own status.
  // One prebuilt {business, store, index} context instead of re-reading storage for every invoice.
  const paymentContext=window.ERPIntegrity?.paymentContext?.(business);
  const invoices=(business.invoices||[]).filter(inv=>window.ERPIntegrity?.live?.(inv)??true).map(inv=>{
    const summary=window.ERPIntegrity?.paymentSummary?.(inv,paymentContext)||{outstanding:n(inv.total),paid:0};
    return {...inv,outstanding:summary.outstanding,paidAmount:summary.paid,arDueDate:invoiceDueDate(inv)};
  });
  const stock=buildStockAvailability({products,branches,flow,ops,onHand:(p,b)=>window.ERPProductionCore?.stockOnHand?.(p,b)??window.productEstimatedStock?.(p,b)??0});
  return {business:{...business,invoices},flow,ops,products,branches,stock};
}

function navPanel(item){return (item.getAttribute('onclick')||'').match(/go\('([^']+)'/)?.[1]||item.dataset.pePanel||'';}
function navItems(){return [...document.querySelectorAll('.sidebar .nav-item')];}
function navItemFor(panel){return navItems().find(item=>navPanel(item)===panel)||null;}
function makeNavItem(panel,label){
  const el=document.createElement('div');
  el.className='nav-item pe-created-nav';
  el.dataset.pePanel=panel;
  el.setAttribute('onclick',`go('${panel}',this)`);
  el.textContent=label;
  return el;
}
// Replaces an emoji / old icon of a JavaScript-created entry with the line icon of NAV_ICONS.
function setNavIcon(item,panel){
  const name=NAV_ICONS[panel];
  if(!name||item.dataset.navIcon===panel)return;
  [...item.children].filter(child=>child.tagName.toLowerCase()==='svg'||child.classList.contains('pe-nav-icon')||child.classList.contains('erp-flow-nav-icon')).forEach(child=>child.remove());
  item.insertAdjacentHTML('afterbegin',icon(name));
  item.dataset.navIcon=panel;
}
// Replaces the entry's own text (not its icon or badge) with `label`, right after the icon.
function setNavLabel(item,label){
  if(item.dataset.navLabel===label)return;
  [...item.childNodes].filter(node=>node.nodeType===3).forEach(node=>node.remove());
  const text=document.createTextNode(label);
  const icon=[...item.children].find(child=>child.tagName.toLowerCase()==='svg');
  if(icon)icon.after(text);
  else item.prepend(text);
  item.dataset.navLabel=label;
}

function ensurePanels(){
  const main=document.querySelector('.main');if(!main)return;
  if(!document.getElementById('panel-work-home')){const p=document.createElement('div');p.id='panel-work-home';p.className='panel';p.innerHTML='<div id="pe-work-home"></div>';main.prepend(p);}
  if(!document.getElementById('panel-approval-center')){const p=document.createElement('div');p.id='panel-approval-center';p.className='panel';p.innerHTML='<div id="pe-approval-center"></div>';main.appendChild(p);}
  if(!document.getElementById('panel-customer-portal')){const p=document.createElement('div');p.id='panel-customer-portal';p.className='panel';p.innerHTML='<div id="pe-customer-portal"></div>';main.appendChild(p);}
}

function ensureNavigation(){
  const nav=document.querySelector('.sidebar');
  if(!nav)return;
  for(const panel of ['work-home','approval-center','customer-portal']){
    if(!nav.querySelector(`[data-pe-panel="${panel}"]`))nav.append(makeNavItem(panel,PANEL_LABEL[panel]));
  }
  nav.querySelectorAll('.nav-item').forEach(item=>{
    const panel=navPanel(item);
    if(!panel)return;
    item.dataset.pePanel=panel;
    setNavIcon(item,panel);
    if(PANEL_LABEL[panel])setNavLabel(item,PANEL_LABEL[panel]);
    if(ADVANCED_PANELS.has(panel))item.dataset.peAdvanced='1';
  });
  arrangeNavigation(nav);
}

// ---- grouped, collapsible sidebar (ADR-015)
function ensureNavGroup(nav,section){
  const existing=[...nav.querySelectorAll('.nav-group')].find(group=>group.dataset.navSection===section.id);
  if(existing)return existing;
  const group=document.createElement('div');
  group.className='nav-group';
  group.dataset.navSection=section.id;
  const listId=`nav-group-${section.id}`;
  group.innerHTML=`<button type="button" class="nav-sec nav-group-toggle" aria-expanded="true" aria-controls="${listId}"><span>${esc(section.label)}</span></button><div class="nav-group-items" id="${listId}" role="group" aria-label="${esc(section.label)}"></div>`;
  return group;
}
// Moves every entry into its section, in NAV_SECTIONS order. Safe to run again (entries that
// other modules add later, e.g. the order-flow entry, are picked up); an entry that belongs to
// no section stays where it is, so nothing ever disappears from the menu.
function arrangeNavigation(nav=document.querySelector('.sidebar')){
  if(!nav)return;
  const byPanel=new Map();
  nav.querySelectorAll('.nav-item').forEach(item=>{
    const panel=navPanel(item);
    if(panel&&!byPanel.has(panel))byPanel.set(panel,item);
  });
  for(const section of NAV_SECTIONS){
    const group=ensureNavGroup(nav,section);
    nav.append(group);
    const list=group.querySelector('.nav-group-items');
    for(const panel of section.panels){
      const item=byPanel.get(panel);
      if(item)list.append(item);
    }
  }
  applyNavGroups();
}
function collapsedNavSections(){return parseCollapsedNavSections(readSetting(NAV_COLLAPSED_SECTIONS_KEY,'[]'));}
// A collapsed section still shows the entry of the page on screen (CSS: .is-collapsed keeps
// .nav-item.active); a section whose entries are all hidden by the mode hides its heading too.
function applyNavGroups(){
  const collapsed=new Set(collapsedNavSections());
  document.querySelectorAll('.sidebar .nav-group').forEach(group=>{
    const isCollapsed=collapsed.has(group.dataset.navSection);
    group.classList.toggle('is-collapsed',isCollapsed);
    group.querySelector('.nav-group-toggle')?.setAttribute('aria-expanded',String(!isCollapsed));
    group.hidden=!group.querySelector('.nav-item:not([hidden])');
  });
}
function storeCollapsedNavSections(collapsed){
  writeSetting(NAV_COLLAPSED_SECTIONS_KEY,JSON.stringify([...collapsed]));
  applyNavGroups();
}
function toggleNavSection(id){
  if(!id)return;
  const collapsed=new Set(collapsedNavSections());
  if(collapsed.has(id))collapsed.delete(id);
  else collapsed.add(id);
  storeCollapsedNavSections(collapsed);
}
// Opens (and remembers open) the section `id`; nothing happens when it is not collapsed.
function expandNavSection(id){
  const collapsed=new Set(collapsedNavSections());
  if(!id||!collapsed.delete(id))return;
  storeCollapsedNavSections(collapsed);
}
// Highlights the entry of the page on screen. go() (app.js) and ERPOrderFlow highlight the
// clicked entry themselves; a form has no entry, so its list's entry is highlighted here.
// Arriving at an entry of a collapsed section (from the search, a quick action, a link on
// another page…) opens that section. Only a move to another entry does: a section the user
// collapses while on one of its pages stays collapsed (showing just that entry) when the
// page re-renders itself with go().
// Never on start-up (the remembered collapsed sections are the user's choice: the first highlight and
// the start-up redirect to "งานของฉัน" only record the entry) and never for an entry the mode hides
// (an advanced-only page in simple mode): expanding would open — and store — a section for nothing.
let lastActiveEntry='';
let navExpandSuspended=false;
function syncActiveNav(panel,{expand=true}={}){
  const entry=navEntryPanel(panel);
  const target=navItemFor(entry);
  if(!target)return;
  navItems().forEach(item=>{
    const active=item===target;
    item.classList.toggle('active',active);
    if(active)item.setAttribute('aria-current','page');
    else item.removeAttribute('aria-current');
  });
  if(entry===lastActiveEntry)return;
  lastActiveEntry=entry;
  if(!expand||navExpandSuspended||target.hidden||target.closest('[hidden]'))return;
  expandNavSection(target.closest('.nav-group')?.dataset.navSection||'');
}
// "← รายการ…" at the top of each form screen: the way back to the list that its "+ สร้าง…"
// button came from (on phones the menu is behind the ☰ button). Text = the list's own title.
function ensureFormBackLinks(){
  for(const {form,list} of navFormBackTargets()){
    const panel=document.getElementById(`panel-${form}`);
    if(!panel||!document.getElementById(`panel-${list}`)||panel.querySelector(':scope > .nav-back-link'))continue;
    const title=document.querySelector(`#panel-${list} .card-title > span`)?.textContent?.trim()||'กลับไปหน้ารายการ';
    const link=document.createElement('button');
    link.type='button';
    link.className='nav-back-link';
    link.dataset.navBack=list;
    link.innerHTML=icon('back');
    link.append(title);
    link.addEventListener('click',()=>window.go?.(list));
    panel.prepend(link);
  }
}

function ensureTopControls(){
  const top=document.querySelector('.comform-topbar');
  if(!top||document.getElementById('pe-view-controls'))return;
  const wrap=document.createElement('div');
  wrap.id='pe-view-controls';
  wrap.className='pe-view-controls';
  wrap.innerHTML='<button type="button" id="pe-mode-toggle" class="pe-mode-toggle" aria-pressed="false">โหมดง่าย</button>';
  top.insertBefore(wrap,document.getElementById('topbar-ctx'));
  wrap.querySelector('#pe-mode-toggle').addEventListener('click',()=>{writeSetting(STORAGE_MODE,isAdvanced()?'simple':'advanced');applyExperience();renderCurrent();});
}

function applyExperience(){
  const advanced=isAdvanced();
  document.body.classList.toggle('erp-advanced-mode',advanced);
  document.body.classList.toggle('erp-simple-mode',!advanced);
  // Every menu item is shown (single Admin view); โหมดง่าย only hides the advanced screens.
  navItems().forEach(item=>{
    item.hidden=!advanced&&!!item.dataset.peAdvanced;
  });
  // Section headings are the .nav-group-toggle buttons; any other (older) heading stays hidden.
  document.querySelectorAll('.sidebar .nav-sec:not(.nav-group-toggle)').forEach(x=>x.hidden=true);
  applyNavGroups();
  const btn=document.getElementById('pe-mode-toggle');
  if(btn){
    btn.textContent=advanced?'โหมดขั้นสูง':'โหมดง่าย';
    btn.setAttribute('aria-pressed',String(advanced));
  }
  document.querySelectorAll('#erp-dashboard-views [data-dashboard-view="forecast"],#erp-dashboard-views [data-dashboard-view="risk"]').forEach(x=>x.hidden=!advanced);
  document.querySelectorAll('#panel-dashboard .target-section').forEach(x=>x.classList.toggle('pe-legacy-target',!advanced));
  document.querySelectorAll('#panel-dashboard .quant-section,#panel-dashboard .forecast-section').forEach(x=>x.classList.toggle('pe-advanced-block',!advanced));
  // Leave a screen the mode hides. Judged by the screen's menu entry, so a form (no entry of its
  // own, e.g. invoice-form → invoice-list) is never sent to งานของฉัน because it has no item.
  const active=document.querySelector('.panel.active')?.id?.replace('panel-','')||'';
  const activeNav=navItemFor(navEntryPanel(active));
  // That redirect is the app's, not the user's: it does not open (and store) a collapsed section.
  if(activeNav?.hidden){navExpandSuspended=true;try{window.go?.('work-home');}finally{navExpandSuspended=false;}}
}

function quickAction(panel,label,cls=''){return `<button type="button" class="pe-action ${cls}" data-pe-go="${panel}">${label}</button>`;}
function severityIcon(s){return ({critical:'⛔',high:'🔴',medium:'🟠',low:'🟡',info:'🔵'})[s]||'•';}

function homeKpis(s){
  const b=s.business,f=s.flow,o=s.ops;
  const ar=(b.invoices||[]).reduce((sum,x)=>sum+n(x.outstanding),0);
  const openOrders=(f.salesOrders||[]).filter(x=>!['completed','cancelled'].includes(norm(x.status))).length;
  const openPo=(o.purchaseOrders||[]).filter(x=>!['received','cancelled'].includes(norm(x.status))).length;
  const low=(s.stock||[]).filter(x=>n(x.available)>=0&&n(x.reorderPoint)>0&&n(x.available)<=n(x.reorderPoint)).length;
  const negative=(s.stock||[]).filter(x=>n(x.available)<0).length;
  return [['ยอดลูกหนี้',`฿${money(ar)}`],['Sales Order กำลังทำ',openOrders],['Open PO',openPo],['Stock ต่ำ/เสี่ยง',low+negative]];
}

function renderWorkHome(){
  const root=document.getElementById('pe-work-home');
  if(!root)return;
  const s=snapshot();
  const queue=buildWorkQueue(s,{today:today()});
  const kpis=homeKpis(s);
  const advanced=isAdvanced();
  const actions=QUICK_ACTIONS.filter(([panel])=>advanced||!ADVANCED_PANELS.has(panel));
  root.innerHTML=`<section class="pe-home-hero"><div><span class="pe-kicker">DEMO ${VERSION} · Admin</span><h1>วันนี้ควรทำอะไรต่อ?</h1><p>หน้าแรกแบบงานประจำวัน ระบบสรุปงานค้างและพาไปขั้นตอนถัดไป โดย Analytics ขั้นสูงยังเก็บไว้ในโหมดขั้นสูง</p></div><div class="pe-home-search"><button type="button" class="btn btn-secondary" data-pe-search>${icon('search')}ค้นหาลูกค้า / เอกสาร</button></div></section>
  <section class="pe-kpi-grid">${kpis.map(([l,v])=>`<article><small>${esc(l)}</small><b>${esc(v)}</b></article>`).join('')}</section>
  <section class="pe-quick-actions"><h2>ทางลัด</h2><div>${actions.map(([p,l])=>quickAction(p,l)).join('')}</div></section>
  <section class="pe-work-section"><div class="pe-section-head"><div><h2>งานที่ต้องดำเนินการ</h2><p>เรียงจากความเสี่ยงสูงไปต่ำ</p></div><span>${queue.length} รายการ</span></div>${queue.length?`<div class="pe-work-list">${queue.map(q=>`<article class="pe-work-item is-${q.severity}"><div class="pe-work-icon">${severityIcon(q.severity)}</div><div class="pe-work-copy"><b>${esc(q.title)}</b><span>${esc(q.detail)}</span></div><button type="button" class="btn btn-secondary btn-sm" data-pe-go="${esc(q.panel)}">${esc(q.action)}</button></article>`).join('')}</div>`:'<div class="pe-empty-good">✅ ไม่พบงานค้างระดับสำคัญจากกฎ Operational ปัจจุบัน</div>'}</section>
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
  const policy=window.ERPGovernance?.evaluateApprovalPolicy?.({entityType:'purchase_order',amount:po.subtotal||po.total||0});
  if(!confirm(`ตรวจและอนุมัติ ${po.no||'PO'} เพื่อเปลี่ยนสถานะเป็น “ส่งคำสั่งซื้อแล้ว” ใช่หรือไม่?${policy?.requiresApproval?'\nรายการนี้เข้าเกณฑ์ Approval Policy: '+policy.reasons.join(', '):''}`))return;
  const reason=prompt('เหตุผล/หมายเหตุการอนุมัติ PO (ใช้สำหรับ Audit Trail)','ตรวจ Supplier ราคา จำนวน และกำหนดรับแล้ว')??null;if(reason===null)return;
  const updated=(data.purchaseOrders||[]).map(x=>String(x.id)===String(id)?{...x,status:'ordered',approvedAt:new Date().toISOString(),approvedBy:'DEMO:Admin',approvalReason:reason,updatedAt:new Date().toISOString(),updatedAtIso:new Date().toISOString()}:x);
  core.importData({purchaseOrders:updated},{replace:true});core.audit?.('update','purchase_order',po.no||id,'อนุมัติ PO จาก Approval Center (DEMO UX)',{branch:po.branch});window.ERPGovernance?.recordApprovalDecision?.({entityType:'purchase_order',entityId:String(po.id),entityNo:po.no||'',decision:'approved',reason,amount:po.subtotal||po.total||0,policyResult:policy});window.notify?.(`อนุมัติ ${po.no||'PO'} แล้ว`);renderApprovalCenter();renderWorkHome();
}

function renderApprovalCenter(){
  const root=document.getElementById('pe-approval-center');
  if(!root)return;
  const s=snapshot();
  const rows=approvalRows(s);
  root.innerHTML=`<section class="pe-page-head"><div><span>APPROVAL INBOX</span><h1>ศูนย์อนุมัติ</h1><p>รวมงานที่ต้องตรวจไว้หน้าเดียว ลดการไล่เปิดหลายเมนู · โหมดนี้เป็น Workflow Demo ไม่ใช่สิทธิ์ฝั่ง Server</p></div></section>
  <div class="pe-approval-grid"><section class="card"><div class="pe-section-head"><div><h2>ใบเสนอราคา</h2><p>ตรวจราคาและเงื่อนไขก่อนสร้าง Sales Order</p></div><span>${rows.quotes.length}</span></div>${rows.quotes.length?`<div class="pe-approval-list">${rows.quotes.slice(0,30).map(q=>`<article><div><b>${esc(q.no||'-')}</b><span>${esc(q.customer||'-')} · ฿${money(q.total)}</span></div><button type="button" class="btn btn-secondary btn-sm" data-approve-quote="${esc(q.id||q.no)}">${icon('check')}อนุมัติ</button></article>`).join('')}</div>`:'<div class="pe-empty-good">ไม่มีใบเสนอราคารออนุมัติ</div>'}</section>
  <section class="card"><div class="pe-section-head"><div><h2>ใบสั่งซื้อ (PO)</h2><p>ตรวจ Supplier, ราคา และกำหนดรับก่อนส่งคำสั่งซื้อ</p></div><span>${rows.purchaseOrders.length}</span></div>${rows.purchaseOrders.length?`<div class="pe-approval-list">${rows.purchaseOrders.slice(0,30).map(p=>`<article><div><b>${esc(p.no||'-')}</b><span>${esc(p.supplier||'-')} · ฿${money(p.subtotal)} · ${esc(p.expectedDate||'ไม่ระบุกำหนดรับ')}</span></div><button type="button" class="btn btn-secondary btn-sm" data-approve-po="${esc(p.id)}">${icon('check')}ตรวจและอนุมัติ</button></article>`).join('')}</div>`:'<div class="pe-empty-good">ไม่มี PO รออนุมัติ</div>'}</section></div>
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
  root.innerHTML=`<section class="pe-page-head"><div><span>CUSTOMER PORTAL PREVIEW</span><h1>พอร์ทัลลูกค้า</h1><p>มุมมองตัวอย่างที่ตั้งใจให้ลูกค้าเห็นเฉพาะเอกสารและสถานะของตนเอง ไม่แสดงต้นทุน กำไร หรือข้อมูลภายใน</p></div><div class="pe-portal-warning">Preview ในเครื่องนี้ · ยังไม่ใช่ลิงก์ภายนอกที่มี Authentication</div></section>
  <section class="card pe-portal-toolbar"><label>เลือกลูกค้า<select id="pe-portal-customer">${names.length?names.map(x=>`<option ${x===selected?'selected':''}>${esc(x)}</option>`).join(''):'<option>ยังไม่มีลูกค้า</option>'}</select></label><button type="button" class="btn btn-secondary" data-pe-search>${icon('search')}ค้นหาทั้งระบบ</button></section>
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
  root.innerHTML=`<div class="pe-section-head"><div><h2>สินค้าพร้อมใช้</h2><p>On Hand − Reserved = Available · Incoming แสดงจำนวนจาก PO ที่ยังรับไม่ครบ</p></div><span>${filter==='all'?'รวมทุกสาขา':esc(BRANCH_LABEL[filter]||filter)}</span></div><div class="pe-availability-legend"><span>On Hand = มีจริง</span><span>Reserved = จองให้ Order</span><span>Available = ขาย/ส่งได้</span><span>Incoming = กำลังเข้า</span></div><div class="tbl-wrap"><table class="pe-availability-table"><thead><tr><th>สินค้า</th><th>On Hand</th><th>Reserved</th><th>Available</th><th>Incoming PO</th><th>Reorder</th><th>สถานะ</th></tr></thead><tbody>${rows.slice(0,100).map(r=>{const tone=n(r.available)<0?'red':n(r.reorderPoint)>0&&n(r.available)<=n(r.reorderPoint)?'amber':'green';const status=n(r.available)<0?'ผิดปกติ':tone==='amber'?'ควรตรวจจัดซื้อ':'พร้อมใช้';return `<tr><td><b>${esc(r.productCode||'-')}</b><span>${esc(r.product||'')}</span></td><td>${money(r.onHand)}</td><td>${money(r.reserved)}</td><td><b>${money(r.available)}</b></td><td>${money(r.incoming)}</td><td>${money(r.reorderPoint)}</td><td>${statusBadge(status,tone)}</td></tr>`;}).join('')}</tbody></table></div>`;
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
  const flowLabel=document.getElementById('md-p-flow-type')?.closest('label')?.querySelector('span');if(flowLabel)flowLabel.textContent='ประเภทสินค้า';// no CSS :has() — it throws in older browsers (init stopped) and cost ~30-70 s per app boot in jsdom
  const brEye=document.querySelector('.brules-eyebrow');if(brEye)brEye.textContent='BUSINESS RULES · ADVANCED';
  const targetNote=document.querySelector('.monthly-target-planner-note');if(targetNote)targetNote.textContent='เป้าหมายบันทึกแยกบริษัท สาขา ปี และเดือนในพื้นที่ทดลองนี้ โดยคงค่าเดิมเป็น fallback เพื่อไม่ทำข้อมูลเก่าหาย';
}

function init(){
  if(window.__ERP_PRODUCT_EXPERIENCE__)return;
  window.__ERP_PRODUCT_EXPERIENCE__=true;
  removeRetiredRoleSetting();
  ensurePanels();
  ensureNavigation();
  ensureFormBackLinks();
  ensureTopControls();
  ensureWorkflowRibbon();
  patchCopy();
  applyExperience();
  syncActiveNav(document.querySelector('.panel.active')?.id?.replace('panel-','')||'',{expand:false});
  document.querySelector('.sidebar')?.addEventListener('click',e=>{
    const toggle=e.target.closest?.('.nav-group-toggle');
    if(toggle)toggleNavSection(toggle.closest('.nav-group')?.dataset.navSection||'');
  });
  // Entries added later by another module (e.g. the order-flow entry) join their section.
  document.addEventListener('erp:flow-ready',()=>{
    ensureNavigation();
    applyExperience();
  });
  document.addEventListener('erp:navigation',e=>{
    const id=e?.detail?.id||'';
    // Synchronous, right after go() / ERPOrderFlow set their highlight.
    syncActiveNav(id);
    activeWorkflowSubview=e?.detail?.subview||'';
    setTimeout(()=>{applyExperience();renderCurrent(id,activeWorkflowSubview);},30);
  });
  window.addEventListener('erp-flow:changed',()=>setTimeout(()=>renderCurrent(),40));
  document.addEventListener('erp:dashboard-rendered',()=>{if(document.querySelector('.panel.active')?.id==='panel-work-home')renderWorkHome();});
  document.addEventListener('change',e=>{if(e.target?.id==='inv-branch-filter')setTimeout(renderAvailability,20);});
  window.ERPProductExperience={VERSION,PRODUCT_EXPERIENCE_VERSION,isAdvanced,snapshot,renderWorkHome,renderApprovalCenter,renderCustomerPortal,renderAvailability,applyExperience};
  // Make the product-first home the default on a fresh browser session. Existing active work is preserved after navigation.
  // The start-up redirect is not the user's navigation: it must not expand a collapsed section.
  setTimeout(()=>{if(document.querySelector('#panel-dashboard.active')){navExpandSuspended=true;try{window.go?.('work-home');}finally{navExpandSuspended=false;}}else renderCurrent();},220);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,160));else setTimeout(init,160);
