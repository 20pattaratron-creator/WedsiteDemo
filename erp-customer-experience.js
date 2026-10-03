import { localDateISO, isBusinessDateBefore, roundMoneyValue } from './erp-shared-core.js';
import { invoiceDueDate } from './erp-receivables-core.js';
import { creditedByInvoice } from './erp-credit-note-core.js';
import { icon } from './erp-icons.js';
/*
 * ERP Customer Experience v1
 * Local Demo / Proposal UX layer
 * Adds global search (Ctrl+K) and Customer 360 without changing core app.js screens.
 */
(() => {
  'use strict';
  const VERSION = '1.1.0';
  let palette = null;
  let customerModal = null;
  let searchReturnFocus = null;
  const esc = (v='') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
  const money = v => num(v).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2});
  const norm = v => String(v||'').trim().toLowerCase();
  const dateTh = v => { if(!v)return '-'; const d=new Date(v); return Number.isNaN(d.getTime())?esc(v):d.toLocaleDateString('th-TH'); };

  function business(){
    if(window.ERPOrderFlow?.scanBusinessData) return window.ERPOrderFlow.scanBusinessData();
    const out={quotes:[],invoices:[],receipts:[],productions:[]};
    const years=window.allYears?.()||[];
    for(const y of years){
      for(const type of Object.keys(out)) out[type].push(...(window.docsForYear?.(type,Number(y),null)||[]).map(r=>({...r,_year:Number(y),_month:r._month??0,_branch:r.branch||''})));
    }
    return out;
  }
  function flowStore(){ return window.ERPOrderFlow?.getStore?.() || {salesOrders:[],billingNotes:[],payments:[]}; }
  function customers(){ return (window.contactMasterRows?.()||[]).filter(r=>r?.role==='customer'||r?.role==='both'); }
  function products(){ return window.productMasterRows?.()||[]; }
  function sameCustomer(row,name){ return norm(row?.customer||row?.name)===norm(name); }

  function paymentAllocated(inv){return window.ERPIntegrity.paymentSummary(inv).paid;}

  function indexRows(){
    const b=business(), f=flowStore(), rows=[];
    customers().forEach(c=>rows.push({kind:'customer',title:c.name,sub:[c.taxId,c.phone,c.email].filter(Boolean).join(' · '),key:`${c.name} ${c.taxId||''} ${c.phone||''} ${c.email||''}`,data:c}));
    products().forEach(p=>rows.push({kind:'product',title:p.name||p.code,sub:[p.code,p.category].filter(Boolean).join(' · '),key:`${p.name||''} ${p.code||''} ${p.category||''}`,data:p}));
    const addDocs=(type,label,list)=>list.forEach(d=>rows.push({kind:type,title:d.no||d.id||label,sub:`${label} · ${d.customer||''} · ${d.date||''}`,key:`${d.no||''} ${d.customer||''} ${d.date||''} ${(d.items||[]).map(i=>i.product).join(' ')}`,data:d}));
    addDocs('quote','ใบเสนอราคา',b.quotes||[]); addDocs('invoice','ใบส่งสินค้า/ใบกำกับภาษี',b.invoices||[]); addDocs('receipt','ใบเสร็จ',b.receipts||[]); addDocs('production','สั่งผลิต',b.productions||[]);
    (f.salesOrders||[]).forEach(o=>rows.push({kind:'sales-order',title:o.no,sub:`Sales Order · ${o.customer||''} · ${o.requiredDate||''}`,key:`${o.no||''} ${o.customer||''} ${o.customerPoNo||''} ${o.sourceQuoteNo||''}`,data:o}));
    (f.billingNotes||[]).forEach(bill=>rows.push({kind:'billing',title:bill.no,sub:`ใบวางบิล · ${bill.customer||''} · ฿${money(bill.totalBilled)}`,key:`${bill.no||''} ${bill.customer||''} ${(bill.lines||[]).map(x=>x.invoiceNo).join(' ')}`,data:bill}));
    return rows;
  }

  const kindLabel={customer:'ลูกค้า',product:'สินค้า',quote:'ใบเสนอราคา',invoice:'Invoice',receipt:'ใบเสร็จ',production:'ผลิต','sales-order':'Sales Order',billing:'ใบวางบิล'};
  // Line icons of the search results (erp-icons.js, ADR-017; they were emoji).
  const kindIcon={customer:'user',product:'box',quote:'document',invoice:'truck',receipt:'receipt',production:'factory','sales-order':'cart',billing:'document'};

  function ensureButton(){
    const top=document.querySelector('.comform-topbar'); if(!top||document.getElementById('erp-global-search-btn'))return;
    const btn=document.createElement('button'); btn.id='erp-global-search-btn'; btn.type='button'; btn.className='erp-global-search-btn';
    btn.innerHTML=`${icon('search')}<span>ค้นหาทั้งระบบ</span><kbd>Ctrl K</kbd>`; btn.addEventListener('click',()=>openPalette());
    const ctx=document.getElementById('topbar-ctx'); top.insertBefore(btn,ctx||null);
  }

  function openPalette(query=''){
    closePalette();
    searchReturnFocus=document.activeElement;
    query=typeof query==='string'?query:'';
    palette=document.createElement('div'); palette.className='erp-search-overlay';
    palette.innerHTML=`<section class="erp-search-dialog" role="dialog" aria-modal="true" aria-label="ค้นหาทั้งระบบ"><div class="erp-search-input-wrap">${icon('search')}<input id="erp-global-search-input" autocomplete="off" placeholder="ค้นหา ลูกค้า เลขเอกสาร Customer PO หรือสินค้า..."><kbd>Esc</kbd></div><div id="erp-global-search-results" class="erp-search-results"></div><footer>พิมพ์อย่างน้อย 1 ตัวอักษร · Enter เพื่อเปิดผลลัพธ์แรก · Ctrl+K เปิดจากทุกหน้า</footer></section>`;
    palette.addEventListener('click',e=>{if(e.target===palette)closePalette();}); document.body.appendChild(palette);
    const input=palette.querySelector('input'); input.value=query; input.focus();
    input.addEventListener('input',()=>renderResults(input.value));
    palette.addEventListener('keydown',e=>{
      const results=[...palette.querySelectorAll('.erp-search-result')];
      if(e.key==='ArrowDown'||e.key==='ArrowUp'){
        e.preventDefault();const i=results.indexOf(document.activeElement);
        if(results.length)results[e.key==='ArrowDown'?(i+1)%results.length:(i<=0?results.length-1:i-1)].focus();
      }
      if(e.key==='Enter'&&e.target===input){e.preventDefault();results[0]?.click();}
      if(e.key==='Tab'){
        const focusable=[input,...results],i=focusable.indexOf(document.activeElement);
        if(e.shiftKey&&i<=0){e.preventDefault();focusable.at(-1).focus();}
        else if(!e.shiftKey&&i===focusable.length-1){e.preventDefault();input.focus();}
      }
    });
    renderResults(query);
  }
  function closePalette(){const wasOpen=Boolean(palette);palette?.remove();palette=null;if(wasOpen)searchReturnFocus?.focus?.();searchReturnFocus=null;}

  function renderResults(query){
    const root=document.getElementById('erp-global-search-results'); if(!root)return;
    const q=norm(query);
    if(!q){root.innerHTML='<div class="erp-search-empty"><b>ค้นหาได้จากทุกโมดูล</b><span>เช่น ABC, QT6909, INV6909, SO6909, เลข PO ลูกค้า หรือชื่อสินค้า</span></div>';return;}
    const terms=q.split(/\s+/).filter(Boolean);
    const result=indexRows().filter(r=>terms.every(t=>norm(`${r.title} ${r.sub} ${r.key}`).includes(t))).slice(0,30);
    if(!result.length){root.innerHTML='<div class="erp-search-empty">ไม่พบข้อมูลที่ตรงกับคำค้น</div>';return;}
    root.innerHTML=result.map((r,i)=>`<button type="button" class="erp-search-result" data-search-index="${i}"><span class="erp-search-icon">${icon(kindIcon[r.kind])||'•'}</span><span><b>${esc(r.title)}</b><small>${esc(r.sub||'')}</small></span><em>${esc(kindLabel[r.kind]||r.kind)}</em></button>`).join('');
    [...root.querySelectorAll('.erp-search-result')].forEach((el,i)=>el.addEventListener('click',()=>activateResult(result[i])));
  }

  function activateResult(r){
    closePalette(); if(!r)return;
    if(r.kind==='customer') return openCustomer360(r.data.name);
    if(r.kind==='sales-order') return window.ERPOrderFlow?.openOrder?.(r.data.id);
    if(r.kind==='billing'){window.ERPOrderFlow?.openTab?.('billing');return;}
    if(r.kind==='product'){window.go?.('master-data'); setTimeout(()=>window.switchMasterTab?.('product',document.querySelector('[data-master-tab="product"]')),80); return;}
    if(['quote','invoice','receipt','production'].includes(r.kind)){
      const d=r.data; window.showDetailById?.(r.kind,d._branch||d.branch,Number(d._year||new Date(d.date||Date.now()).getFullYear()),Number(d._month??new Date(d.date||Date.now()).getMonth()),d.id||d.firebaseId);
    }
  }

  function customerSnapshot(name){
    const b=business(), f=flowStore(), c=customers().find(x=>norm(x.name)===norm(name))||{name};
    const I=window.ERPIntegrity;
    const quotes=(b.quotes||[]).filter(x=>sameCustomer(x,name));
    const orders=(f.salesOrders||[]).filter(x=>sameCustomer(x,name));
    const invoices=(b.invoices||[]).filter(x=>sameCustomer(x,name));
    // Money figures use live invoices only (same filter as the AR report); a voided invoice stays on the timeline.
    const liveInvoices=invoices.filter(x=>I.live(x));
    const receipts=(b.receipts||[]).filter(x=>sameCustomer(x,name));
    const billings=(f.billingNotes||[]).filter(x=>sameCustomer(x,name));
    const payments=(f.payments||[]).filter(x=>sameCustomer(x,name));
    // One paymentContext for the whole snapshot, built on the same business() rows (no extra storage read).
    const context=I.paymentContext(b);
    const summaries=new Map(liveInvoices.map(x=>[x,I.paymentSummary(x,context)]));
    // ADR-010: a credit note (ใบลดหนี้) nets against the ORIGINAL INVOICE's customer, not the buyer
    // name typed on the note (a walk-in abbreviated invoice's note carries the walk-in buyer's name).
    // credited = paymentSummary().credited of this customer's live invoices; refundDue is money owed back.
    // A cancelled/voided invoice is not a receivable (paymentSummary itself does not look at the invoice's own status).
    const credited=roundMoneyValue(liveInvoices.reduce((s,x)=>s+num(summaries.get(x).credited),0));
    const sales=roundMoneyValue(liveInvoices.reduce((s,x)=>s+num(x.total??x.saleTotal??x.subtotal),0)-credited);
    const refundDue=roundMoneyValue(liveInvoices.reduce((s,x)=>s+num(summaries.get(x).refundDue),0));
    const ar=roundMoneyValue(liveInvoices.reduce((s,x)=>s+num(summaries.get(x).outstanding),0));
    const overdue=roundMoneyValue(liveInvoices.reduce((s,x)=>{const due=invoiceDueDate(x);return s+((due&&isBusinessDateBefore(due,localDateISO()))?num(summaries.get(x).outstanding):0)},0));
    // Credit notes on this customer's invoices (same matcher as paymentSummary), one entry per note with
    // the part of the note that falls on this customer's invoices.
    const noteMap=new Map();
    liveInvoices.forEach(inv=>creditedByInvoice(inv,b.creditNotes||[],{matches:I.creditNoteMatches}).creditNotes.forEach(doc=>{
      const key=String(doc.id??doc.no),row=noteMap.get(key)||{id:doc.id,no:doc.no,date:doc.date,total:0};
      row.total+=num(doc.total);noteMap.set(key,row);
    }));
    const creditNotes=[...noteMap.values()];
    const timeline=[];
    quotes.forEach(x=>timeline.push({date:x.date,label:'Quotation',no:x.no,amount:x.total||x.subtotal}));
    orders.forEach(x=>timeline.push({date:x.orderDate,label:'Sales Order',no:x.no,amount:x.total}));
    invoices.forEach(x=>timeline.push({date:x.date,label:I.live(x)?'Invoice':'Invoice (ยกเลิก)',no:x.no,amount:x.total||x.saleTotal||x.subtotal}));
    billings.forEach(x=>timeline.push({date:x.billingDate,label:'Billing',no:x.no,amount:x.totalBilled}));
    receipts.forEach(x=>timeline.push({date:x.date,label:'Receipt',no:x.no,amount:x.total||x.saleTotal||x.subtotal}));
    creditNotes.forEach(x=>timeline.push({date:x.date,label:'Credit Note',no:x.no,amount:-roundMoneyValue(x.total)}));
    payments.forEach(x=>timeline.push({date:x.date,label:'Payment',no:x.no,amount:x.amount}));
    timeline.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
    return {c,quotes,orders,invoices,liveInvoices,receipts,billings,payments,creditNotes,credited,sales,ar,overdue,refundDue,timeline,context,summaries};
  }

  function openCustomer360(name){
    closeCustomer360(); const x=customerSnapshot(name);
    customerModal=document.createElement('div'); customerModal.className='erp-c360-overlay';
    const invOpen=x.liveInvoices.filter(i=>num(x.summaries.get(i).outstanding)>0);
    customerModal.innerHTML=`<section class="erp-c360-dialog"><header><div><small>CUSTOMER 360°</small><h2>${esc(x.c.name||name)}</h2><p>${esc([x.c.taxId,x.c.phone,x.c.email].filter(Boolean).join(' · ')||'ข้อมูลลูกค้าใน Master')}</p></div><button type="button" data-c360-close aria-label="ปิด">${icon('close')}</button></header>
      <div class="erp-c360-kpis"><div><small>ยอด Invoice${x.credited>0?' (หักใบลดหนี้)':''}</small><b>฿${money(x.sales)}</b></div><div class="warn"><small>ยอดค้างรับ</small><b>฿${money(x.ar)}</b></div><div class="${x.overdue>0?'risk':''}"><small>เกินกำหนด</small><b>฿${money(x.overdue)}</b></div>${x.refundDue>0?`<div class="warn"><small>ต้องคืน / เครดิตให้ลูกค้า</small><b>฿${money(x.refundDue)}</b></div>`:''}<div><small>Order กำลังติดตาม</small><b>${x.orders.filter(o=>o.status!=='cancelled'&&window.ERPIntegrity.orderProgress(o).items.some(i=>i.remainingQty>0)).length}</b></div></div>
      <div class="erp-c360-grid"><article><h3>ภาพรวมความสัมพันธ์</h3><div class="erp-c360-stats"><span>Quotation <b>${x.quotes.length}</b></span><span>Sales Order <b>${x.orders.length}</b></span><span>Invoice <b>${x.invoices.length}</b></span><span>ค้างชำระ <b>${invOpen.length}</b></span><span>Billing <b>${x.billings.length}</b></span><span>Receipt <b>${x.receipts.length}</b></span><span>ใบลดหนี้ <b>${x.creditNotes.length}</b></span></div><div class="erp-c360-actions"><button data-c360-quote class="btn btn-primary">+ สร้างใบเสนอราคา</button><button data-c360-flow class="btn btn-secondary">เปิดศูนย์งานขาย</button></div></article>
      <article><h3>ข้อมูลลูกค้า</h3><dl><div><dt>ที่อยู่</dt><dd>${esc(x.c.address||'-')}</dd></div><div><dt>ผู้ติดต่อ</dt><dd>${esc(x.c.contactPerson||'-')}</dd></div><div><dt>เครดิต</dt><dd>${esc(String(x.c.creditDays??'-'))} วัน</dd></div><div><dt>กลุ่ม</dt><dd>${esc(x.c.agencyGroup||x.c.entityType||'-')}</dd></div></dl></article></div>
      <article class="erp-c360-timeline"><h3>Timeline ล่าสุด</h3>${x.timeline.length?x.timeline.slice(0,12).map(t=>`<div><time>${dateTh(t.date)}</time><span>${esc(t.label)}</span><b>${esc(t.no||'-')}</b><em>฿${money(t.amount)}</em></div>`).join(''):'<p>ยังไม่มี Transaction ของลูกค้านี้</p>'}</article>
    </section>`;
    customerModal.addEventListener('click',e=>{if(e.target===customerModal)closeCustomer360();});
    customerModal.querySelectorAll('[data-c360-close]').forEach(b=>b.addEventListener('click',closeCustomer360));
    customerModal.querySelector('[data-c360-quote]')?.addEventListener('click',()=>{closeCustomer360();window.go?.('quote-form');setTimeout(()=>{const el=document.getElementById('q-cust');if(el){el.value=name;el.dispatchEvent(new Event('change',{bubbles:true}));}},100)});
    customerModal.querySelector('[data-c360-flow]')?.addEventListener('click',()=>{closeCustomer360();window.ERPOrderFlow?.open?.();});
    document.body.appendChild(customerModal);
  }
  function closeCustomer360(){customerModal?.remove();customerModal=null;}

  function keydown(e){
    if((e.ctrlKey||e.metaKey)&&String(e.key).toLowerCase()==='k'){e.preventDefault();openPalette();return;}
    if(e.key==='Escape'){
      closePalette();
      closeCustomer360();
      const guide=document.getElementById('trial-onboarding');
      if(guide&&!guide.classList.contains('collapsed')){
        window.TrialService?.toggleOnboarding(true);
        // The guide is opened from the header "Demo" menu (ADR-015); focus returns to its button.
        document.getElementById('erp-demo-menu-btn')?.focus();
      }
    }
  }

  // Keyboard access + aria-current for the menu entries. Their text is set in one place,
  // PANEL_LABEL in erp-product-experience.js (one entry per document type since ADR-015).
  function enhanceNavigation(){
    document.querySelectorAll('.sidebar .nav-item').forEach(item=>{
      item.setAttribute('role','button');
      item.tabIndex=0;
      if(item.classList.contains('active'))item.setAttribute('aria-current','page');
      else item.removeAttribute('aria-current');
    });
  }
  // ADR-017: which dashboard blocks show in which view. The default "ภาพรวม" keeps the page to about one
  // screen: 4 KPIs (sales and net profit of app.js renderDash + receivables of erp-receivables.js),
  // "สิ่งที่ต้องทำ" and 2 charts. Every other block moved to the view it belongs to; nothing is recomputed.
  // The branch tabs and the month / year filter (.erp-dash-controls) are in no list: they show in every view.
  // A block of more than one view: #dash-combined / #dash-single (all 5 cards + branch detail in "sales").
  const DASHBOARD_VIEWS=[['summary','ภาพรวม'],['receivables','ลูกหนี้ค้างรับ'],['sales','ยอดขายและเป้าหมาย'],['forecast','คาดการณ์'],['risk','ความเสี่ยง (Quant)']];
  const DASHBOARD_VIEW_BLOCKS=[
    ['#erp-dash-kpi-row,#dash-combined,#dash-single','summary sales'],
    ['#dash-ar-kpis,#erp-dash-summary','summary'],
    ['#ar-overdue-banner,#ar-aging-card','receivables'],
    ['.prodcore-dashboard-ops,.dash-decision-section,.monthly-target-planner,.executive-visual-section,.target-section,.flow-section,.dash-chart-grid,#dash-recent','sales'],
    ['.forecast-section','forecast'],
    ['.quant-section','risk']
  ];
  function dashboardViewButtons(){return [...document.querySelectorAll('#erp-dashboard-views [role="tab"]')];}
  function selectDashboardView(id,{focus=false}={}){
    const dash=document.getElementById('panel-dashboard');if(!dash)return;
    if(!DASHBOARD_VIEWS.some(([view])=>view===id))id='summary';
    dash.dataset.dashboardView=id;
    renderDashboardExperience();
    if(focus)document.querySelector(`#erp-dashboard-views [data-dashboard-view="${id}"]`)?.focus();
  }
  // Tabs pattern: ArrowLeft / ArrowRight (wrapping) and Home / End move to the next visible tab and show it.
  function onDashboardViewKeydown(event){
    const current=event.target.closest?.('#erp-dashboard-views [role="tab"]');if(!current)return;
    const tabs=dashboardViewButtons().filter(tab=>!tab.hidden);const index=tabs.indexOf(current);if(index<0)return;
    let next=null;
    if(event.key==='ArrowRight')next=tabs[(index+1)%tabs.length];
    else if(event.key==='ArrowLeft')next=tabs[(index-1+tabs.length)%tabs.length];
    else if(event.key==='Home')next=tabs[0];
    else if(event.key==='End')next=tabs[tabs.length-1];
    if(!next)return;
    event.preventDefault();
    selectDashboardView(next.dataset.dashboardView,{focus:true});
  }
  function initDashboardViews(){
    const dash=document.getElementById('panel-dashboard');if(!dash||document.getElementById('erp-dashboard-welcome'))return;
    // A compact page title only: creating documents, master data and the trial guide are in the sidebar and
    // the header "Demo" menu (ADR-015), so the former header buttons were duplicates (ADR-017).
    const welcome=document.createElement('section');welcome.id='erp-dashboard-welcome';welcome.className='erp-dashboard-welcome';
    welcome.innerHTML='<div><span class="erp-demo-label">DEMO 4.3.1 · พื้นที่ทดลอง</span><h1>ภาพรวมธุรกิจ</h1></div>';
    dash.prepend(welcome);
    const empty=document.createElement('div');empty.id='erp-dashboard-empty';empty.className='erp-dashboard-empty';
    empty.innerHTML='<b>ยังไม่มีเอกสารในพื้นที่ทดลองนี้</b><p>เพิ่มลูกค้าและสินค้า แล้วทดลองสร้างใบเสนอราคา ตัวเลข 0 ด้านล่างหมายถึงยังไม่มีรายการบันทึก ไม่ใช่ผลประกอบการจริง</p><button type="button" class="btn btn-secondary btn-sm" data-ux-go="files">นำเข้าข้อมูล / สำรองข้อมูล</button>';
    welcome.after(empty);
    const nav=document.createElement('div');nav.className='erp-dashboard-views';nav.id='erp-dashboard-views';nav.setAttribute('role','tablist');nav.setAttribute('aria-label','เลือกหมวด Dashboard');
    nav.innerHTML=DASHBOARD_VIEWS.map(([id,label])=>`<button type="button" role="tab" id="erp-dashboard-view-${id}" data-dashboard-view="${id}" aria-controls="panel-dashboard" aria-selected="${id==='summary'}" tabindex="${id==='summary'?0:-1}">${label}</button>`).join('');
    (dash.querySelector('.erp-dash-controls')||dash.querySelector('.filter-bar')).after(nav);
    dash.dataset.dashboardView='summary';
    nav.addEventListener('keydown',onDashboardViewKeydown);
    dash.addEventListener('click',event=>{
      const view=event.target.closest('button[data-dashboard-view]');
      if(view){selectDashboardView(view.dataset.dashboardView);return;}
      const go=event.target.closest('[data-ux-go]');if(go)window.go?.(go.dataset.uxGo);
    });
    // Group the branch comparison as optional detail; its original nodes and IDs are retained.
    const compare=dash.querySelector('#dash-combined .compare-grid');
    if(compare){const detail=document.createElement('details');detail.className='erp-branch-detail';const summary=document.createElement('summary');summary.textContent='เปรียบเทียบสำนักงานใหญ่และสาขา';compare.before(detail);detail.append(summary,compare);}
    renderDashboardExperience();
  }
  // Tabs ↔ panels (ADR-018). The blocks of a view are siblings shared between views (the KPI row is in
  // two), so they are not moved into one container: each block is a role="tabpanel" (unless it already
  // has a role, e.g. the AR banner's live "status") labelled by the tab now showing it — its own label is
  // kept after it — and each tab's aria-controls lists the ids of its view's blocks.
  let dashboardBlockSeq=0;
  function linkDashboardTabPanels(dash,view){
    const owners=new Map();
    DASHBOARD_VIEW_BLOCKS.forEach(([selector,views])=>dash.querySelectorAll(selector).forEach(el=>{
      if(el.hasAttribute('role')&&el.getAttribute('role')!=='tabpanel')return;
      if(!el.id)el.id=`erp-dashboard-block-${++dashboardBlockSeq}`;
      owners.set(el,[...(owners.get(el)||[]),...views.split(' ')]);
    }));
    dashboardViewButtons().forEach(tab=>{const ids=[...owners].filter(([,views])=>views.includes(tab.dataset.dashboardView)).map(([el])=>el.id);tab.setAttribute('aria-controls',ids.join(' ')||'panel-dashboard');});
    owners.forEach((views,el)=>{
      if(!('erpOwnLabel' in el.dataset))el.dataset.erpOwnLabel=el.getAttribute('aria-labelledby')||'';
      const tabView=views.includes(view)?view:views[0];
      el.setAttribute('role','tabpanel');
      el.setAttribute('aria-labelledby',[`erp-dashboard-view-${tabView}`,el.dataset.erpOwnLabel].filter(Boolean).join(' '));
    });
  }
  // Phones (ADR-018): the sales-vs-target chart keeps a readable width and scrolls inside its card; it opens
  // at the latest month with sales — or the current month when the current year is shown — not at January.
  function scrollTargetChartToLatest(){
    const scroller=document.querySelector('#exec-sales-target-chart .exec-chart-scroll'),svg=scroller?.querySelector('svg');
    if(!scroller||!svg||scroller.scrollWidth<=scroller.clientWidth+1)return;
    const labels=[...svg.querySelectorAll('text[text-anchor="middle"]')];
    let index=-1;[...svg.querySelectorAll('rect.exec-series-0')].forEach((bar,i)=>{if(Number(bar.getAttribute('height'))>0)index=i;});
    const today=new Date();if(Number(document.getElementById('dash-year')?.value)===today.getFullYear())index=Math.max(index,today.getMonth());
    const label=labels[index],box=svg.viewBox?.baseVal;if(!label||!box?.width)return;
    const scale=svg.getBoundingClientRect().width/box.width,slot=(box.width-76)/labels.length; // 76 = the chart's left + right padding
    scroller.scrollLeft=Math.max(0,(Number(label.getAttribute('x'))+slot/2)*scale-scroller.clientWidth+8);
  }
  function renderDashboardExperience(){
    const dash=document.getElementById('panel-dashboard');if(!dash||!document.getElementById('erp-dashboard-views'))return;
    const view=dash.dataset.dashboardView||'summary';
    DASHBOARD_VIEW_BLOCKS.forEach(([selector,views])=>{const shown=views.split(' ').includes(view);dash.querySelectorAll(selector).forEach(el=>el.classList.toggle('erp-view-hidden',!shown));});
    dashboardViewButtons().forEach(tab=>{const selected=tab.dataset.dashboardView===view;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;});
    linkDashboardTabPanels(dash,view);
    if(view==='summary')scrollTargetChartToLatest();
    const data=business();const hasDocuments=['quotes','invoices','receipts','productions'].some(key=>(data[key]||[]).length>0);
    const empty=document.getElementById('erp-dashboard-empty');if(empty)empty.hidden=hasDocuments;
  }

  function init(){
    if(window.__ERP_CUSTOMER_EXPERIENCE__)return; window.__ERP_CUSTOMER_EXPERIENCE__=true;
    ensureButton(); initDashboardViews(); enhanceNavigation();document.addEventListener('keydown',keydown);
    document.querySelector('.sidebar')?.addEventListener('keydown',event=>{
      if((event.key==='Enter'||event.key===' ')&&event.target.matches('.nav-item')){event.preventDefault();event.target.click();}
    });
    document.addEventListener('erp:navigation',enhanceNavigation);
    document.addEventListener('erp:dashboard-rendered',renderDashboardExperience);
    document.addEventListener('erp:flow-ready',()=>{enhanceNavigation();renderDashboardExperience();});
  }
  window.ERPCustomerExperience={VERSION,openSearch:openPalette,openCustomer360,customerSnapshot,indexRows,renderDashboardExperience,selectDashboardView,DASHBOARD_VIEW_BLOCKS};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,120));else setTimeout(init,120);
})();
