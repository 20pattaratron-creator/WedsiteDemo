// =====================================================================
// erp-decision-council.js — Local Demo Decision Council UI + adapter
// =====================================================================
import {analyzeCouncil, RULE_REGISTRY, COUNCIL_VERSION} from './erp-decision-council-core.js';

(() => {
  'use strict';
  let modal=null;
  let lastReport=null;
  const esc=(v='')=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=v=>Number.isFinite(Number(v))?Number(v):0;
  const money=v=>n(v).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2});
  const today=()=>new Date().toISOString().slice(0,10);

  function business(){return window.ERPIntegrity?.business?.()||{quotes:[],invoices:[],receipts:[],productions:[]};}
  function flow(){return window.ERPOrderFlow?.getStore?.()||{salesOrders:[],billingNotes:[],payments:[]};}
  function invoiceView(inv){
    const p=window.ERPIntegrity?.paymentSummary?.(inv)||{outstanding:n(inv.total),overpaid:0};
    return {...inv,outstanding:p.outstanding,overpaid:p.overpaid};
  }
  function orderView(order){
    try{return window.ERPIntegrity?.orderProgress?.(order)||order;}catch{return order;}
  }
  function productView(product,branch){
    let stock=0;try{stock=n(window.productEstimatedStock?.(product,branch));}catch{stock=n(product.openingStock||0);}
    return {...product,branch,stock,reorderPoint:n(product.reorderPoint)};
  }
  function snapshot(){
    const data=business(),store=flow(),rules=window.BusinessRulesService?.read?.()||{};
    return {now:today(),demoMode:true,quotes:data.quotes||[],invoices:(data.invoices||[]).map(invoiceView),orders:(store.salesOrders||[]).map(orderView),billingNotes:store.billingNotes||[],payments:store.payments||[],products:(window.productMasterRows?.()||[]).filter(p=>p?.flowType==='inventory'||p?.fulfillmentType==='stock').flatMap(p=>['ubon','khonkaen'].map(br=>productView(p,br))),businessRuleVersion:n(rules.formulaVersion),runtimeErrors:Math.max(n(window.ComformRuntimeStatus?.errorCount),n(window.LocalDemoHealth?.errorCount?.()))};
  }
  function run(){lastReport=analyzeCouncil(snapshot());renderDashboardCard();return lastReport;}
  const sevLabel={critical:'วิกฤต',high:'สูง',medium:'กลาง',low:'ต่ำ',info:'ข้อมูล'};
  const sevIcon={critical:'🔴',high:'🟠',medium:'🟡',low:'🔵',info:'⚪'};
  function findingHtml(f){return `<article class="erp-council-finding ${esc(f.severity)}"><header><span>${sevIcon[f.severity]||'•'} ${esc(sevLabel[f.severity]||f.severity)}</span><b>${esc(f.title)}</b><code>${esc(f.ruleId)}</code></header><p>${esc(f.summary)}</p>${f.evidence?.length?`<details><summary>หลักฐาน ${f.evidence.length} รายการ</summary><ul>${f.evidence.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details>`:''}${f.action?`<div class="erp-council-action"><b>แนะนำ:</b> ${esc(f.action)}</div>`:''}<footer><span>${esc(f.source)}</span><span>${esc(f.formula)}</span></footer></article>`;}
  function reviewHtml(r){return `<section class="erp-council-review"><div class="erp-council-review-head"><h3>${esc(r.label)}</h3><span class="erp-council-sev ${esc(r.severity)}">${sevIcon[r.severity]||'•'} ${esc(sevLabel[r.severity]||r.severity)}</span></div>${r.findings.length?r.findings.map(findingHtml).join(''):`<div class="erp-council-positive">✓ ${esc(r.positive||'ไม่พบสัญญาณผิดปกติ')}</div>`}</section>`;}
  function chairmanHtml(r){const c=r.chairman;return `<section class="erp-council-chair"><div><span class="erp-council-kicker">CHAIRMAN SYNTHESIS · RULE-BASED</span><h2>${esc(c.headline)}</h2><p>ระดับหลักฐาน: <b>${esc(c.evidenceLevel)}</b> · วิเคราะห์ ${r.reviewCount} มุมมอง จากเอกสารหลัก ${r.documentCount} รายการ</p></div>${c.actions.length?`<ol>${c.actions.map(a=>`<li><b>${esc(a.title)}</b><span>${esc(a.action||a.summary)}</span></li>`).join('')}</ol>`:'<div class="erp-council-positive">✓ ยังไม่มีงานระดับกลางขึ้นไปจากกฎชุดนี้</div>'}<small>${esc(c.note)}</small></section>`;}
  function open(){
    const r=run();modal?.remove();modal=document.createElement('div');modal.className='erp-council-overlay';modal.innerHTML=`<section class="erp-council-dialog" role="dialog" aria-modal="true" aria-label="Decision Council"><header class="erp-council-top"><div><span class="erp-council-badge">Decision Council v${esc(COUNCIL_VERSION)}</span><h1>ทบทวนธุรกิจหลายมุมมอง</h1><p>แต่ละ Reviewer ใช้กฎของตนเองกับข้อมูลชุดเดียวกัน แล้ว Chairman จัดลำดับความเสี่ยง</p></div><button type="button" class="erp-council-close" aria-label="ปิด">×</button></header><div class="erp-council-disclaimer"><b>ไม่ใช่ Multi-LLM:</b> รุ่น Demo นี้เป็น deterministic rule-based council ไม่มีการส่งข้อมูลออกไปยัง AI/API ภายนอก และไม่สร้างตัวเลขธุรกิจจากการคาดเดา</div>${chairmanHtml(r)}<div class="erp-council-grid">${r.reviews.map(reviewHtml).join('')}</div><footer class="erp-council-toolbar"><button type="button" class="btn btn-ghost" data-council-rules>ดูกฎที่ใช้</button><button type="button" class="btn btn-ghost" data-council-copy>คัดลอกสรุป</button><button type="button" class="btn btn-primary" data-council-refresh>วิเคราะห์ใหม่</button></footer><div id="erp-council-rules" hidden></div></section>`;
    modal.querySelector('.erp-council-close').onclick=close;modal.addEventListener('click',e=>{if(e.target===modal)close();});
    modal.querySelector('[data-council-refresh]').onclick=()=>{open();};
    modal.querySelector('[data-council-copy]').onclick=copySummary;
    modal.querySelector('[data-council-rules]').onclick=toggleRules;
    document.body.appendChild(modal);modal.querySelector('.erp-council-close').focus();
  }
  function close(){modal?.remove();modal=null;}
  function textSummary(){const r=lastReport||run(),c=r.chairman;return [`ERP Decision Council · ${r.asOf}`,c.headline,`ระดับหลักฐาน: ${c.evidenceLevel}`,...c.actions.map(a=>`${a.priority}. ${a.title} — ${a.action||a.summary}`),'หมายเหตุ: Rule-based Demo review; ไม่ใช่คำแนะนำจากหลาย LLM'].join('\n');}
  async function copySummary(){try{await navigator.clipboard.writeText(textSummary());window.notify?.('คัดลอกสรุป Decision Council แล้ว','success');}catch{window.prompt('คัดลอกข้อความนี้',textSummary());}}
  function toggleRules(){const root=modal?.querySelector('#erp-council-rules');if(!root)return;root.hidden=!root.hidden;if(!root.hidden)root.innerHTML=`<div class="erp-council-rule-table"><h3>Rule Registry</h3><p>กฎทั้งหมดใช้ข้อมูลภายในระบบ ไม่มีอัตราภาษี/ค่าธรรมเนียมภายนอกที่ hard-code เพิ่มในโมดูลนี้</p><table><thead><tr><th>Rule</th><th>Reviewer</th><th>หลักการ</th><th>แหล่งข้อมูล</th></tr></thead><tbody>${Object.entries(RULE_REGISTRY).map(([id,x])=>`<tr><td><code>${esc(id)}</code></td><td>${esc(x.reviewer)}</td><td>${esc(x.formula)}</td><td>${esc(x.source)}</td></tr>`).join('')}</tbody></table></div>`;}
  function renderDashboardCard(){
    const dash=document.getElementById('panel-dashboard'),welcome=document.getElementById('erp-dashboard-welcome');if(!dash||!welcome)return;
    let card=document.getElementById('erp-decision-council-card');if(!card){card=document.createElement('section');card.id='erp-decision-council-card';card.className='erp-decision-council-card';welcome.after(card);}
    const r=lastReport||analyzeCouncil(snapshot()),actions=r.chairman.actions;
    card.innerHTML=`<div class="erp-council-card-title"><div><span>🧭 DECISION REVIEW</span><h2>สิ่งที่ควรตรวจต่อจากข้อมูลปัจจุบัน</h2></div><button type="button" class="btn btn-ghost btn-sm" data-open-council>เปิด Council</button></div>${actions.length?`<div class="erp-council-card-actions">${actions.slice(0,3).map(a=>`<div class="${esc(a.severity)}"><b>${sevIcon[a.severity]} ${esc(a.title)}</b><span>${esc(a.summary)}</span></div>`).join('')}</div>`:`<div class="erp-council-positive">✓ ยังไม่พบประเด็นระดับกลางขึ้นไปจากกฎ Council</div>`}<small>Rule-based · ใช้ข้อมูล Local Demo เท่านั้น · ไม่ส่งข้อมูลออกภายนอก</small>`;
    card.classList.toggle('erp-view-hidden',(dash.dataset.dashboardView||'summary')!=='summary');card.querySelector('[data-open-council]').onclick=open;
  }
  function ensureWelcomeButton(){const actions=document.querySelector('#erp-dashboard-welcome .erp-welcome-actions');if(!actions||actions.querySelector('[data-open-council]'))return;const b=document.createElement('button');b.type='button';b.className='btn btn-ghost';b.dataset.openCouncil='1';b.textContent='🧭 ตรวจ Decision Council';b.onclick=open;actions.appendChild(b);}
  function refresh(){lastReport=null;run();ensureWelcomeButton();}
  function init(){if(window.__ERP_DECISION_COUNCIL__)return;window.__ERP_DECISION_COUNCIL__=true;setTimeout(refresh,220);document.addEventListener('erp:dashboard-rendered',()=>setTimeout(refresh,20));window.addEventListener('erp-flow:changed',()=>setTimeout(refresh,20));window.addEventListener('storage',()=>setTimeout(refresh,50));document.addEventListener('keydown',e=>{if(e.key==='Escape'&&modal)close();});}
  window.ERPDecisionCouncil={VERSION:COUNCIL_VERSION,run,open,close,getReport:()=>lastReport||run(),getRegistry:()=>RULE_REGISTRY};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
