import { localDateISO } from './erp-shared-core.js';
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
  function outstanding(inv){return window.ERPIntegrity.paymentSummary(inv).outstanding;}

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
  const kindIcon={customer:'👤',product:'📦',quote:'📄',invoice:'🧾',receipt:'💰',production:'🏭','sales-order':'🛒',billing:'📑'};

  function ensureButton(){
    const top=document.querySelector('.comform-topbar'); if(!top||document.getElementById('erp-global-search-btn'))return;
    const btn=document.createElement('button'); btn.id='erp-global-search-btn'; btn.type='button'; btn.className='erp-global-search-btn';
    btn.innerHTML='<span>🔎 ค้นหาทั้งระบบ</span><kbd>Ctrl K</kbd>'; btn.addEventListener('click',()=>openPalette());
    const ctx=document.getElementById('topbar-ctx'); top.insertBefore(btn,ctx||null);
  }

  function openPalette(query=''){
    closePalette();
    searchReturnFocus=document.activeElement;
    query=typeof query==='string'?query:'';
    palette=document.createElement('div'); palette.className='erp-search-overlay';
    palette.innerHTML=`<section class="erp-search-dialog" role="dialog" aria-modal="true" aria-label="ค้นหาทั้งระบบ"><div class="erp-search-input-wrap"><span>🔎</span><input id="erp-global-search-input" autocomplete="off" placeholder="ค้นหา ลูกค้า เลขเอกสาร Customer PO หรือสินค้า..."><kbd>Esc</kbd></div><div id="erp-global-search-results" class="erp-search-results"></div><footer>พิมพ์อย่างน้อย 1 ตัวอักษร · Enter เพื่อเปิดผลลัพธ์แรก · Ctrl+K เปิดจากทุกหน้า</footer></section>`;
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
    root.innerHTML=result.map((r,i)=>`<button type="button" class="erp-search-result" data-search-index="${i}"><span class="erp-search-icon">${kindIcon[r.kind]||'•'}</span><span><b>${esc(r.title)}</b><small>${esc(r.sub||'')}</small></span><em>${esc(kindLabel[r.kind]||r.kind)}</em></button>`).join('');
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
    const quotes=(b.quotes||[]).filter(x=>sameCustomer(x,name));
    const orders=(f.salesOrders||[]).filter(x=>sameCustomer(x,name));
    const invoices=(b.invoices||[]).filter(x=>sameCustomer(x,name));
    const receipts=(b.receipts||[]).filter(x=>sameCustomer(x,name));
    const billings=(f.billingNotes||[]).filter(x=>sameCustomer(x,name));
    const payments=(f.payments||[]).filter(x=>sameCustomer(x,name));
    const sales=invoices.reduce((s,x)=>s+num(x.total??x.saleTotal??x.subtotal),0);
    const ar=invoices.reduce((s,x)=>s+outstanding(x,f),0);
    const overdue=invoices.reduce((s,x)=>{const due=x.dueDate||x.paymentDueDate||'';return s+((due&&due<localDateISO())?outstanding(x,f):0)},0);
    const timeline=[];
    quotes.forEach(x=>timeline.push({date:x.date,label:'Quotation',no:x.no,amount:x.total||x.subtotal}));
    orders.forEach(x=>timeline.push({date:x.orderDate,label:'Sales Order',no:x.no,amount:x.total}));
    invoices.forEach(x=>timeline.push({date:x.date,label:'Invoice',no:x.no,amount:x.total||x.saleTotal||x.subtotal}));
    billings.forEach(x=>timeline.push({date:x.billingDate,label:'Billing',no:x.no,amount:x.totalBilled}));
    receipts.forEach(x=>timeline.push({date:x.date,label:'Receipt',no:x.no,amount:x.total||x.saleTotal||x.subtotal}));
    payments.forEach(x=>timeline.push({date:x.date,label:'Payment',no:x.no,amount:x.amount}));
    timeline.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
    return {c,quotes,orders,invoices,receipts,billings,payments,sales,ar,overdue,timeline};
  }

  function openCustomer360(name){
    closeCustomer360(); const x=customerSnapshot(name);
    customerModal=document.createElement('div'); customerModal.className='erp-c360-overlay';
    const invOpen=x.invoices.filter(i=>outstanding(i,flowStore())>0);
    customerModal.innerHTML=`<section class="erp-c360-dialog"><header><div><small>CUSTOMER 360°</small><h2>${esc(x.c.name||name)}</h2><p>${esc([x.c.taxId,x.c.phone,x.c.email].filter(Boolean).join(' · ')||'ข้อมูลลูกค้าใน Master')}</p></div><button type="button" data-c360-close>×</button></header>
      <div class="erp-c360-kpis"><div><small>ยอด Invoice</small><b>฿${money(x.sales)}</b></div><div class="warn"><small>ยอดค้างรับ</small><b>฿${money(x.ar)}</b></div><div class="${x.overdue>0?'risk':''}"><small>เกินกำหนด</small><b>฿${money(x.overdue)}</b></div><div><small>Order กำลังติดตาม</small><b>${x.orders.filter(o=>o.status!=='cancelled'&&window.ERPIntegrity.orderProgress(o).items.some(i=>i.remainingQty>0)).length}</b></div></div>
      <div class="erp-c360-grid"><article><h3>ภาพรวมความสัมพันธ์</h3><div class="erp-c360-stats"><span>Quotation <b>${x.quotes.length}</b></span><span>Sales Order <b>${x.orders.length}</b></span><span>Invoice <b>${x.invoices.length}</b></span><span>ค้างชำระ <b>${invOpen.length}</b></span><span>Billing <b>${x.billings.length}</b></span><span>Receipt <b>${x.receipts.length}</b></span></div><div class="erp-c360-actions"><button data-c360-quote class="btn btn-primary">+ สร้างใบเสนอราคา</button><button data-c360-flow class="btn btn-ghost">เปิดศูนย์งานขาย</button></div></article>
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
    if(e.key==='Escape'){closePalette();closeCustomer360();const guide=document.getElementById('trial-onboarding');if(guide&&!guide.classList.contains('collapsed')){window.TrialService?.toggleOnboarding(true);document.getElementById('local-demo-guide-btn')?.focus();}}
  }

  function enhanceNavigation(){
    const labels={'quote-form':'สร้างใบเสนอราคา','invoice-form':'สร้างใบส่งสินค้า / ใบกำกับภาษี','receipt-form':'สร้างใบเสร็จรับเงิน','quote-list':'รายการใบเสนอราคา','invoice-list':'รายการใบส่งสินค้า / ใบกำกับภาษี','receipt-list':'รายการใบเสร็จรับเงิน','expense-list':'รายการค่าใช้จ่าย'};
    document.querySelectorAll('.sidebar .nav-item').forEach(item=>{
      const target=(item.getAttribute('onclick')||'').match(/go\('([^']+)'/ )?.[1];
      if(labels[target]&&!item.dataset.uxNamed){
        [...item.childNodes].filter(node=>node.nodeType===3).forEach(node=>node.remove());
        item.append(document.createTextNode(labels[target]));item.dataset.uxNamed='1';
      }
      item.setAttribute('role','button');item.tabIndex=0;
      if(item.classList.contains('active'))item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');
    });
  }
  function initDashboardViews(){
    const dash=document.getElementById('panel-dashboard');if(!dash||document.getElementById('erp-dashboard-welcome'))return;
    const welcome=document.createElement('section');welcome.id='erp-dashboard-welcome';welcome.className='erp-dashboard-welcome';
    welcome.innerHTML='<div><span class="erp-demo-label">DEMO 4.2.0 · พื้นที่ทดลอง</span><h1>ภาพรวมธุรกิจ</h1><p>เริ่มงานขาย ติดตามเอกสาร และเลือกดูข้อมูลที่ต้องใช้</p></div><div class="erp-welcome-actions"><button type="button" class="btn btn-primary" data-ux-go="quote-form">+ สร้างใบเสนอราคา</button><button type="button" class="btn btn-ghost" data-ux-go="master-data">ข้อมูลลูกค้าและสินค้า</button><button type="button" class="btn btn-ghost" data-ux-guide>วิธีเริ่มทดลอง</button></div>';
    dash.prepend(welcome);
    const empty=document.createElement('div');empty.id='erp-dashboard-empty';empty.className='erp-dashboard-empty';
    empty.innerHTML='<b>ยังไม่มีเอกสารในพื้นที่ทดลองนี้</b><p>เพิ่มลูกค้าและสินค้า แล้วทดลองสร้างใบเสนอราคา ตัวเลข 0 ด้านล่างหมายถึงยังไม่มีรายการบันทึก ไม่ใช่ผลประกอบการจริง</p><button type="button" class="btn btn-ghost btn-sm" data-ux-go="files">นำเข้าข้อมูล / สำรองข้อมูล</button>';
    welcome.after(empty);
    const views=[['summary','ภาพรวม'],['sales','ยอดขายและเป้าหมาย'],['forecast','คาดการณ์'],['risk','ความเสี่ยง (Quant)']];
    const nav=document.createElement('div');nav.className='erp-dashboard-views';nav.id='erp-dashboard-views';nav.setAttribute('role','group');nav.setAttribute('aria-label','เลือกหมวด Dashboard');
    nav.innerHTML=views.map(([id,label])=>`<button type="button" data-dashboard-view="${id}" aria-pressed="${id==='summary'}">${label}</button>`).join('');
    dash.querySelector('.filter-bar').after(nav);
    dash.dataset.dashboardView='summary';
    dash.addEventListener('click',event=>{
      const view=event.target.closest('button[data-dashboard-view]');
      if(view){dash.dataset.dashboardView=view.dataset.dashboardView;renderDashboardExperience();return;}
      const go=event.target.closest('[data-ux-go]');if(go)window.go?.(go.dataset.uxGo);
      if(event.target.closest('[data-ux-guide]'))window.TrialService?.toggleOnboarding(false);
    });
    // Group the branch comparison as optional detail; its original nodes and IDs are retained.
    const compare=dash.querySelector('#dash-combined .compare-grid');
    if(compare){const detail=document.createElement('details');detail.className='erp-branch-detail';const summary=document.createElement('summary');summary.textContent='เปรียบเทียบสำนักงานใหญ่และสาขา';compare.before(detail);detail.append(summary,compare);}
    renderDashboardExperience();
  }
  function renderDashboardExperience(){
    const dash=document.getElementById('panel-dashboard');if(!dash||!document.getElementById('erp-dashboard-views'))return;
    const view=dash.dataset.dashboardView||'summary';
    const groups=[['summary','#dash-combined,#dash-single,.prodcore-dashboard-ops,#erp-flow-dashboard-queue'],['sales','.dash-decision-section,.target-section,.flow-section,.dash-chart-grid'],['forecast','.forecast-section'],['risk','.quant-section']];
    groups.forEach(([name,selector])=>dash.querySelectorAll(selector).forEach(el=>{el.classList.toggle('erp-view-hidden',name!==view);}));
    const recent=document.getElementById('dash-quotes')?.parentElement?.parentElement;
    if(recent&&recent.parentElement===dash)recent.classList.toggle('erp-view-hidden',view!=='summary');
    dash.querySelectorAll('[data-dashboard-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.dashboardView===view)));
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
  window.ERPCustomerExperience={VERSION,openSearch:openPalette,openCustomer360,indexRows,renderDashboardExperience};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,120));else setTimeout(init,120);
})();
