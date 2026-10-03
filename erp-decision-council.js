// =====================================================================
// erp-decision-council.js — Local Demo Decision Council UI + adapter
// =====================================================================
import {analyzeCouncil, RULE_REGISTRY, COUNCIL_VERSION} from './erp-decision-council-core.js';
import { localDateISO } from './erp-shared-core.js';
import { icon } from './erp-icons.js';

(() => {
  'use strict';
  let modal=null;
  let lastReport=null;
  const esc=(v='')=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=v=>Number.isFinite(Number(v))?Number(v):0;
  const money=v=>n(v).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2});
  const today=()=>localDateISO();

  function business(){return window.ERPIntegrity?.business?.()||{quotes:[],invoices:[],receipts:[],productions:[]};}
  function flow(){return window.ERPOrderFlow?.getStore?.()||{salesOrders:[],billingNotes:[],payments:[]};}
  // Scope = the dashboard's branch tab, the SAME selection and branch list as the AR KPIs / aging report
  // (window.ERPReceivables): '' = every active branch. The card and "เปิด Council" show that scope.
  function selectedBranch(){return window.ERPReceivables?.selectedBranch?.()||'';}
  function scopeBranches(branch){
    const shared=window.ERPReceivables?.scopeBranches?.(branch);if(Array.isArray(shared)&&shared.length)return shared;
    if(branch)return [branch];const active=['ubon','khonkaen'].filter(br=>window.SaaSService?.isBranchActive?.(br)??true);return active.length?active:['ubon'];
  }
  const scopeLabel=branch=>window.ERPReceivables?.scopeLabel?.(branch)||(branch?String(branch):'ทุกสาขา');
  const rowBranch=row=>String(row?._branch||row?.branch||row?.lines?.[0]?.branch||'');
  // Outstanding comes from paymentSummary() with ONE shared paymentContext (not a storage
  // re-read per invoice); invoices are the live ones of the scope's branches, the
  // same set the AR report / overdue banner (erp-receivables.js) reads, so the figures agree.
  function invoiceViews(data,store,branches){
    const integrity=window.ERPIntegrity,live=typeof integrity?.live==='function'?integrity.live:()=>true;
    const branchOf=inv=>typeof integrity?.branch==='function'?integrity.branch(inv):(inv._branch||inv.branch);
    const payStore=typeof integrity?.flow==='function'?integrity.flow():store;
    const context=typeof integrity?.paymentContext==='function'?integrity.paymentContext(data,payStore):{business:data,store:payStore};
    return (data.invoices||[]).filter(inv=>live(inv)&&branches.includes(branchOf(inv))).map(inv=>{
      const p=integrity?.paymentSummary?.(inv,context)||{outstanding:n(inv.total),overpaid:0};
      return {...inv,outstanding:p.outstanding,overpaid:p.overpaid};
    });
  }
  function orderView(order){
    try{return window.ERPIntegrity?.orderProgress?.(order)||order;}catch{return order;}
  }
  function productView(product,branch){
    let stock=0;try{stock=n(window.productEstimatedStock?.(product,branch));}catch{stock=n(product.openingStock||0);}
    return {...product,branch,stock,reorderPoint:n(product.reorderPoint)};
  }
  // Every document list is limited to the scope's branches (a row without a branch stays in the
  // all-branch scope only); stock is read per branch of the scope.
  function snapshot(branch=''){
    const data=business(),store=flow(),rules=window.BusinessRulesService?.read?.()||{},branches=scopeBranches(branch);
    const inScope=row=>!branch||rowBranch(row)===branch;
    return {now:today(),demoMode:true,branch,quotes:(data.quotes||[]).filter(inScope),invoices:invoiceViews(data,store,branches),orders:(store.salesOrders||[]).filter(inScope).map(orderView),billingNotes:(store.billingNotes||[]).filter(inScope),payments:(store.payments||[]).filter(p=>!branch||String(p?.allocations?.[0]?.branch||p?.branch||'')===branch),products:(window.productMasterRows?.()||[]).filter(p=>p?.flowType==='inventory'||p?.fulfillmentType==='stock').flatMap(p=>(branch?branches:['ubon','khonkaen']).map(br=>productView(p,br))),businessRuleVersion:n(rules.formulaVersion),runtimeErrors:Math.max(n(window.ComformRuntimeStatus?.errorCount),n(window.LocalDemoHealth?.errorCount?.()))};
  }
  function run(branch=selectedBranch()){lastReport={...analyzeCouncil(snapshot(branch)),branch};renderDashboardCard();return lastReport;}
  const sevLabel={critical:'วิกฤต',high:'สูง',medium:'กลาง',low:'ต่ำ',info:'ข้อมูล'};
  const sevIcon={critical:'🔴',high:'🟠',medium:'🟡',low:'🔵',info:'⚪'};
  function findingHtml(f){return `<article class="erp-council-finding ${esc(f.severity)}"><header><span>${sevIcon[f.severity]||'•'} ${esc(sevLabel[f.severity]||f.severity)}</span><b>${esc(f.title)}</b><code>${esc(f.ruleId)}</code></header><p>${esc(f.summary)}</p>${f.evidence?.length?`<details><summary>หลักฐาน ${f.evidence.length} รายการ</summary><ul>${f.evidence.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details>`:''}${f.action?`<div class="erp-council-action"><b>แนะนำ:</b> ${esc(f.action)}</div>`:''}<footer><span>${esc(f.source)}</span><span>${esc(f.formula)}</span></footer></article>`;}
  function reviewHtml(r){return `<section class="erp-council-review"><div class="erp-council-review-head"><h3>${esc(r.label)}</h3><span class="erp-council-sev ${esc(r.severity)}">${sevIcon[r.severity]||'•'} ${esc(sevLabel[r.severity]||r.severity)}</span></div>${r.findings.length?r.findings.map(findingHtml).join(''):`<div class="erp-council-positive">✓ ${esc(r.positive||'ไม่พบสัญญาณผิดปกติ')}</div>`}</section>`;}
  function chairmanHtml(r){const c=r.chairman;return `<section class="erp-council-chair"><div><span class="erp-council-kicker">CHAIRMAN SYNTHESIS · RULE-BASED</span><h2>${esc(c.headline)}</h2><p>ระดับหลักฐาน: <b>${esc(c.evidenceLevel)}</b> · วิเคราะห์ ${r.reviewCount} มุมมอง จากเอกสารหลัก ${r.documentCount} รายการ</p></div>${c.actions.length?`<ol>${c.actions.map(a=>`<li><b>${esc(a.title)}</b><span>${esc(a.action||a.summary)}</span></li>`).join('')}</ol>`:'<div class="erp-council-positive">✓ ยังไม่มีงานระดับกลางขึ้นไปจากกฎชุดนี้</div>'}<small>${esc(c.note)}</small></section>`;}
  function open(){
    const r=run();modal?.remove();modal=document.createElement('div');modal.className='erp-council-overlay';modal.innerHTML=`<section class="erp-council-dialog" role="dialog" aria-modal="true" aria-label="Decision Council"><header class="erp-council-top"><div><span class="erp-council-badge">Decision Council v${esc(COUNCIL_VERSION)}</span><h1>ทบทวนธุรกิจหลายมุมมอง</h1><p>แต่ละ Reviewer ใช้กฎของตนเองกับข้อมูลชุดเดียวกัน แล้ว Chairman จัดลำดับความเสี่ยง · ขอบเขต: <b>${esc(scopeLabel(r.branch))}</b> (ตามแท็บสาขาของ Dashboard)</p></div><button type="button" class="erp-council-close" aria-label="ปิด">${icon('close')}</button></header><div class="erp-council-disclaimer"><b>ไม่ใช่ Multi-LLM:</b> รุ่น Demo นี้เป็น deterministic rule-based council ไม่มีการส่งข้อมูลออกไปยัง AI/API ภายนอก และไม่สร้างตัวเลขธุรกิจจากการคาดเดา</div>${chairmanHtml(r)}<div class="erp-council-grid">${r.reviews.map(reviewHtml).join('')}</div><footer class="erp-council-toolbar"><button type="button" class="btn btn-ghost" data-council-rules>ดูกฎที่ใช้</button><button type="button" class="btn btn-ghost" data-council-copy>คัดลอกสรุป</button><button type="button" class="btn btn-primary" data-council-refresh>วิเคราะห์ใหม่</button></footer><div id="erp-council-rules" hidden></div></section>`;
    modal.querySelector('.erp-council-close').onclick=close;modal.addEventListener('click',e=>{if(e.target===modal)close();});
    modal.querySelector('[data-council-refresh]').onclick=()=>{open();};
    modal.querySelector('[data-council-copy]').onclick=copySummary;
    modal.querySelector('[data-council-rules]').onclick=toggleRules;
    document.body.appendChild(modal);modal.querySelector('.erp-council-close').focus();
  }
  function close(){modal?.remove();modal=null;}
  function textSummary(){const r=lastReport||run(),c=r.chairman;return [`ERP Decision Council · ${r.asOf} · ${scopeLabel(r.branch)}`,c.headline,`ระดับหลักฐาน: ${c.evidenceLevel}`,...c.actions.map(a=>`${a.priority}. ${a.title} — ${a.action||a.summary}`),'หมายเหตุ: Rule-based Demo review; ไม่ใช่คำแนะนำจากหลาย LLM'].join('\n');}
  async function copySummary(){try{await navigator.clipboard.writeText(textSummary());window.notify?.('คัดลอกสรุป Decision Council แล้ว','success');}catch{window.prompt('คัดลอกข้อความนี้',textSummary());}}
  function toggleRules(){const root=modal?.querySelector('#erp-council-rules');if(!root)return;root.hidden=!root.hidden;if(!root.hidden)root.innerHTML=`<div class="erp-council-rule-table"><h3>Rule Registry</h3><p>กฎทั้งหมดใช้ข้อมูลภายในระบบ ไม่มีอัตราภาษี/ค่าธรรมเนียมภายนอกที่ hard-code เพิ่มในโมดูลนี้</p><table><thead><tr><th>Rule</th><th>Reviewer</th><th>หลักการ</th><th>แหล่งข้อมูล</th></tr></thead><tbody>${Object.entries(RULE_REGISTRY).map(([id,x])=>`<tr><td><code>${esc(id)}</code></td><td>${esc(x.reviewer)}</td><td>${esc(x.formula)}</td><td>${esc(x.source)}</td></tr>`).join('')}</tbody></table></div>`;}
  function renderDashboardCard(){
    // ADR-017: the card is part of "สิ่งที่ต้องทำ" in the dashboard's ภาพรวม view (#erp-dash-todo-body).
    const host=document.getElementById('erp-dash-todo-body');if(!host)return;
    let card=document.getElementById('erp-decision-council-card');if(!card){card=document.createElement('section');card.id='erp-decision-council-card';card.className='erp-decision-council-card';host.append(card);}
    const branch=selectedBranch(),r=lastReport||{...analyzeCouncil(snapshot(branch)),branch},actions=r.chairman.actions;
    card.innerHTML=`<div class="erp-council-card-title"><div><span>DECISION REVIEW</span><h3>สิ่งที่ควรตรวจต่อจากข้อมูลปัจจุบัน</h3></div><button type="button" class="btn btn-tertiary btn-sm" data-open-council>${icon('review')}เปิด Council</button></div>${actions.length?`<div class="erp-council-card-actions">${actions.slice(0,3).map(a=>`<div class="${esc(a.severity)}"><b>${sevIcon[a.severity]} ${esc(a.title)}</b><span>${esc(a.summary)}</span></div>`).join('')}</div>`:`<div class="erp-council-positive">✓ ยังไม่พบประเด็นระดับกลางขึ้นไปจากกฎ Council</div>`}<small class="erp-council-scope" data-council-scope="${esc(r.branch||'all')}">${esc(scopeLabel(r.branch))} · ณ วันนี้ · Rule-based · ใช้ข้อมูล Local Demo เท่านั้น · ไม่ส่งข้อมูลออกภายนอก</small>`;
    card.querySelector('[data-open-council]').onclick=open;
  }
  // The dashboard header's "ตรวจ Decision Council" duplicated the card's "เปิด Council" and is gone (ADR-017).
  function refresh(){lastReport=null;run();}
  function init(){if(window.__ERP_DECISION_COUNCIL__)return;window.__ERP_DECISION_COUNCIL__=true;setTimeout(refresh,220);document.addEventListener('erp:dashboard-rendered',()=>setTimeout(refresh,20));window.addEventListener('erp-flow:changed',()=>setTimeout(refresh,20));window.addEventListener('storage',()=>setTimeout(refresh,50));document.addEventListener('keydown',e=>{if(e.key==='Escape'&&modal)close();});}
  window.ERPDecisionCouncil={VERSION:COUNCIL_VERSION,run,open,close,getReport:()=>lastReport||run(),getRegistry:()=>RULE_REGISTRY};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
