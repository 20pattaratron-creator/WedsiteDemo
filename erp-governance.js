import {activePeriodLocks,assertPeriodOpen as assertPeriodOpenCore,buildArAging,buildApAging,buildPeriodCloseChecklist,buildProductionReadiness,compactPeriodLockEvents,evaluateApprovalPolicy,normalizeApprovalDecision,normalizeOutboxOperation,normalizePeriodLockEvent,shouldDeadLetter,stableOperationFingerprint,DEMO_APPROVAL_POLICY} from './erp-governance-core.js';
import { localDateISO } from './erp-shared-core.js';
import { documentActionFeedback, normalizeDocumentActionError } from './erp-document-finance-core.js';
import { icon } from './erp-icons.js';
import { invoiceDueDate } from './erp-receivables-core.js';
import {GOVERNANCE_PERIOD_LOCKS_KEY,GOVERNANCE_AUDIT_KEY,GOVERNANCE_OUTBOX_KEY,GOVERNANCE_APPROVALS_KEY} from './erp-storage-contracts.js';

// ============================================================================
// ERP Governance Runtime — Local Demo control boundary.
// Not a substitute for server-side authorization, DB transactions or tax APIs.
// ============================================================================
(() => {
  'use strict';
  const MAX_AUDIT=5000,MAX_APPROVALS=1500,MAX_OUTBOX=1500,MAX_ATTEMPTS=5,SYNC_STALE_MS=5*60*1000;
  const nowIso=()=>new Date().toISOString();
  const uid=(prefix='op')=>`${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,10)}`;
  const key=base=>window.ComformTenant?.storageKey?.(base)||String(base||'');
  const actor=()=>window.ComformAuth?.getCurrentProfile?.()?.email||window.CurrentUser?.email||'Local user';
  const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
  function strictArray(base){
    const raw=localStorage.getItem(key(base));if(!raw)return[];let parsed;
    try{parsed=JSON.parse(raw);}catch(error){const e=new Error(`อ่าน ${base} ไม่สำเร็จ ระบบหยุดเพื่อป้องกันข้อมูลเดิมถูกเขียนทับ`);e.code='storage_error';e.cause=error;throw e;}
    if(!Array.isArray(parsed)){const e=new Error(`โครงสร้าง ${base} ไม่ถูกต้อง ระบบหยุดเพื่อป้องกันข้อมูลสูญหาย`);e.code='storage_error';throw e;}return parsed;
  }
  function requireTransaction(writes){
    if(typeof window.ERPIntegrity?.transaction!=='function'){const error=new Error('Financial Governance transaction boundary ยังไม่พร้อม ระบบหยุดเพื่อป้องกัน state และ audit แยกจากกัน');error.code='dependency_error';throw error;}
    window.ERPIntegrity.transaction(writes);
  }
  function writeArray(base,rows){requireTransaction([[key(base),rows]]);}
  function operationId(prefix,seed=''){const token=seed&&typeof seed==='object'?`fp_${stableOperationFingerprint(seed)}`:String(seed||uid('seed')).replace(/[^a-zA-Z0-9_.:-]/g,'_');return `${prefix}_${token}`.slice(0,180);}
  function buildAuditRow(input={}){return {id:uid('gov'),schemaVersion:1,at:input.at||nowIso(),operationId:input.operationId||uid('op'),correlationId:input.correlationId||input.operationId||'',action:String(input.action||'event'),entityType:String(input.entityType||''),entityId:String(input.entityId||''),entityNo:String(input.entityNo||''),branch:String(input.branch||''),actor:String(input.actor||actor()),reason:String(input.reason||''),before:clone(input.before),after:clone(input.after),meta:clone(input.meta||{})};}
  function commitWithAudit(mutations=[],auditInput={}){
    const auditRows=strictArray(GOVERNANCE_AUDIT_KEY),auditRow=buildAuditRow(auditInput);auditRows.unshift(auditRow);
    const writes=mutations.map(([base,rows])=>[key(base),rows]);writes.push([key(GOVERNANCE_AUDIT_KEY),auditRows.slice(0,MAX_AUDIT)]);requireTransaction(writes);return auditRow;
  }
  function appendAudit(input={}){const rows=strictArray(GOVERNANCE_AUDIT_KEY),row=buildAuditRow(input);rows.unshift(row);writeArray(GOVERNANCE_AUDIT_KEY,rows.slice(0,MAX_AUDIT));return row;}

  function periodEvents(){return strictArray(GOVERNANCE_PERIOD_LOCKS_KEY);}
  function listPeriodLocks(){return activePeriodLocks(periodEvents());}
  function lockPeriod(input={}){
    const events=periodEvents(),at=nowIso(),lockId=input.lockId||uid('lock');
    const event=normalizePeriodLockEvent({id:uid('lockevt'),lockId,action:'lock',branch:input.branch||'all',scope:input.scope||'all',throughDate:input.throughDate,reason:input.reason||'',actor:actor(),at,operationId:uid('period')});
    events.push(event);commitWithAudit([[GOVERNANCE_PERIOD_LOCKS_KEY,compactPeriodLockEvents(events,1000)]],{operationId:event.operationId,action:'period_lock',entityType:'accounting_period',entityId:lockId,branch:event.branch,reason:event.reason,after:event});renderGovernance();return event;
  }
  function unlockPeriod(lockId,reason=''){
    const active=listPeriodLocks().find(x=>String(x.lockId)===String(lockId));if(!active)throw new Error('ไม่พบ Period Lock ที่ยังใช้งาน');if(!String(reason||'').trim())throw new Error('กรุณาระบุเหตุผลในการปลดล็อกงวด');
    const events=periodEvents(),event=normalizePeriodLockEvent({id:uid('lockevt'),lockId:active.lockId,action:'unlock',branch:active.branch,scope:active.scope,throughDate:active.throughDate,reason:String(reason).trim(),actor:actor(),at:nowIso(),operationId:uid('period')});events.push(event);commitWithAudit([[GOVERNANCE_PERIOD_LOCKS_KEY,compactPeriodLockEvents(events,1000)]],{operationId:event.operationId,action:'period_unlock',entityType:'accounting_period',entityId:active.lockId,branch:active.branch,reason:event.reason,before:active,after:event});renderGovernance();return event;
  }
  function assertPeriodOpen(input={}){return assertPeriodOpenCore(periodEvents(),input);}
  // Delete / void paths of financial documents (ADR-018) ask this BEFORE their confirmation dialog:
  // '' when the period is open, else the SAME Thai text a save refused by assertPeriodOpen shows
  // (documentActionFeedback of the 'period_locked' error). With no lock covering the branch + scope it
  // is always ''; once one does, an unreadable lock store or a record without a usable date is refused.
  const DOCUMENT_LOCK_SCOPE=Object.freeze({invoices:'sales',issuedInvoices:'sales',receipts:'sales',issuedReceipts:'sales',creditNotes:'sales',payments:'sales',expenses:'purchase'});
  function periodLockRefusal(input={}){
    const scope=DOCUMENT_LOCK_SCOPE[input.type]||input.scope||'';
    if(!scope)return ''; // quotes / production orders: not posted to a period (their saves are not locked either)
    const transaction={branch:String(input.branch||'').trim(),date:input.date,scope,action:input.action||`${input.type||scope}_delete`};
    try{
      const covering=listPeriodLocks().some(lock=>(lock.branch==='all'||lock.branch===transaction.branch)&&(lock.scope==='all'||lock.scope===scope));
      if(!covering)return '';
      assertPeriodOpen(transaction);return '';
    }catch(error){return documentActionFeedback(normalizeDocumentActionError(error,{stage:'validate',action:transaction.action})).text;}
  }

  const syncInflight=new Map();
  const syncCommandFingerprint=row=>stableOperationFingerprint({channel:row.channel,method:row.method,collection:row.collection,payload:row.payload,args:row.args,entityType:row.entityType,entityId:row.entityId,branch:row.branch});
  function syncResultSnapshot(result){
    if(result===null||result===undefined||['string','number','boolean'].includes(typeof result))return result??null;
    if(Array.isArray(result)){try{return clone(result);}catch{return null;}}
    const out={};for(const key of ['id','firebaseId','path','storageProvider'])if(result?.[key]!=null)out[key]=String(result[key]);
    if(Array.isArray(result?.attachments)){try{out.attachments=clone(result.attachments);}catch(error){console.warn('[Governance] sync attachment result snapshot failed',error);}}
    return Object.keys(out).length?out:null;
  }
  function outboxRows(){return strictArray(GOVERNANCE_OUTBOX_KEY);}
  function listOutbox(){return outboxRows();}
  function queueSync(input={}){
    const rows=outboxRows(),normalized=normalizeOutboxOperation({...input,status:'pending',attempts:0,createdAt:input.createdAt||nowIso(),updatedAt:nowIso()}),commandFingerprint=syncCommandFingerprint(normalized);
    const existing=rows.find(x=>x.operationId===normalized.operationId);
    if(existing){const existingFingerprint=existing.commandFingerprint||syncCommandFingerprint(existing);if(existingFingerprint!==commandFingerprint){const error=new Error('operationId เดิมอ้างถึง Sync payload คนละชุด ระบบหยุดเพื่อป้องกัน Cloud เขียนข้อมูลผิดรายการ');error.code='sync_conflict';throw error;}return existing;}
    const row={...normalized,commandFingerprint};rows.unshift(row);commitWithAudit([[GOVERNANCE_OUTBOX_KEY,rows.slice(0,MAX_OUTBOX)]],{operationId:row.operationId,action:'sync_queued',entityType:row.entityType,entityId:row.entityId,branch:row.branch,after:{channel:row.channel,method:row.method,collection:row.collection,commandFingerprint}});renderGovernance();return row;
  }
  function updateOutbox(operationId,patch={},auditInput=null){const rows=outboxRows(),i=rows.findIndex(x=>x.operationId===operationId);if(i<0)return null;rows[i]={...rows[i],...clone(patch),updatedAt:nowIso()};if(auditInput)commitWithAudit([[GOVERNANCE_OUTBOX_KEY,rows]],{...auditInput,operationId});else writeArray(GOVERNANCE_OUTBOX_KEY,rows);renderGovernance();return rows[i];}
  function markSyncSuccess(operationId,result=null){const current=outboxRows().find(x=>x.operationId===operationId);if(!current)return null;return updateOutbox(operationId,{status:'synced',lastError:'',syncedAt:nowIso(),result:syncResultSnapshot(result)},{action:'sync_succeeded',entityType:current.entityType,entityId:current.entityId,branch:current.branch});}
  function markSyncFailure(operationId,error){const current=outboxRows().find(x=>x.operationId===operationId);if(!current)return null;const attempts=(Number(current.attempts)||0)+1,status=shouldDeadLetter({...current,attempts},MAX_ATTEMPTS)?'dead_letter':'failed',lastError=String(error?.code||error?.message||error||'sync failed').slice(0,1000);return updateOutbox(operationId,{status,attempts,lastError},{action:status==='dead_letter'?'sync_dead_letter':'sync_failed',entityType:current.entityType,entityId:current.entityId,branch:current.branch,reason:lastError});}
  function recoverInterruptedSyncs(nowMs=Date.now()){
    const rows=outboxRows(),now=Number(nowMs)||Date.now();let changed=false,recovered=[];
    for(let i=0;i<rows.length;i+=1){const row=rows[i];if(row.status!=='syncing')continue;const stamp=Date.parse(row.updatedAt||row.createdAt||'');if(Number.isFinite(stamp)&&now-stamp<SYNC_STALE_MS)continue;rows[i]={...row,status:'uncertain',updatedAt:nowIso(),lastError:'Browser/session interrupted while sync result was unknown. Verify cloud state before manual retry.'};recovered.push(rows[i]);changed=true;}
    if(!changed)return recovered;
    const auditRows=strictArray(GOVERNANCE_AUDIT_KEY);for(const row of recovered)auditRows.unshift(buildAuditRow({operationId:row.operationId,action:'sync_uncertain',entityType:row.entityType,entityId:row.entityId,branch:row.branch,reason:row.lastError}));requireTransaction([[key(GOVERNANCE_OUTBOX_KEY),rows],[key(GOVERNANCE_AUDIT_KEY),auditRows.slice(0,MAX_AUDIT)]]);return recovered;
  }
  async function executeSync(row){
    const service=window.FirebaseService;if(!service)throw new Error('FirebaseService ยังไม่พร้อม');
    if(row.channel==='business_method'){const fn=service[row.method];if(typeof fn!=='function')throw new Error(`ไม่พบ Firebase method ${row.method}`);return fn(row.payload);}
    if(row.channel==='operational'){if(typeof service.saveOperationalRecord!=='function')throw new Error('Firebase operational sync ยังไม่พร้อม');return service.saveOperationalRecord(row.collection,row.payload);}
    if(row.channel==='business_update'){if(typeof service.updateBusinessDoc!=='function')throw new Error('Firebase updateBusinessDoc ยังไม่พร้อม');return service.updateBusinessDoc(...(row.args||[]));}
    throw new Error(`ไม่รองรับ Sync channel ${row.channel}`);
  }
  async function executeQueued(row){
    if(row.status==='synced')return clone(row.result??null);
    if(row.status==='dead_letter'){const error=new Error('Sync operation อยู่ใน Dead-letter กรุณาตรวจสาเหตุและแก้ข้อมูลก่อน Retry');error.code='sync_dead_letter';throw error;}
    if(row.status==='uncertain'){const error=new Error('ผล Sync ก่อนหน้าไม่แน่นอนจากการปิด/รีเฟรชระหว่างส่งข้อมูล กรุณาตรวจ Cloud ก่อน Retry เพื่อป้องกันรายการซ้ำ');error.code='sync_uncertain';throw error;}
    if(syncInflight.has(row.operationId))return syncInflight.get(row.operationId);
    const promise=(async()=>{updateOutbox(row.operationId,{status:'syncing'});try{const result=await executeSync(row);markSyncSuccess(row.operationId,result);return result;}catch(error){markSyncFailure(row.operationId,error);throw error;}})();
    syncInflight.set(row.operationId,promise);try{return await promise;}finally{syncInflight.delete(row.operationId);}
  }
  async function runSync(input={}){return executeQueued(queueSync(input));}
  async function retrySync(operationId){const row=outboxRows().find(x=>x.operationId===operationId);if(!row)throw new Error('ไม่พบ Sync operation');return executeQueued(row);}
  async function retryPending(){recoverInterruptedSyncs();const rows=outboxRows().filter(x=>['pending','failed'].includes(x.status));const results=[];for(const row of rows){try{await retrySync(row.operationId);results.push({operationId:row.operationId,ok:true});}catch(error){results.push({operationId:row.operationId,ok:false,error:String(error?.message||error)});}}renderGovernance();return results;}

  function approvalRows(){return strictArray(GOVERNANCE_APPROVALS_KEY);}
  function recordApprovalDecision(input={}){
    const op=input.operationId||uid('approval'),policyResult=input.policyResult||evaluateApprovalPolicy(input,DEMO_APPROVAL_POLICY),decision=normalizeApprovalDecision({...input,id:input.id||uid('approvalevt'),actor:input.actor||actor(),at:input.at||nowIso(),operationId:op,policyResult});
    const rows=approvalRows();rows.unshift({...decision});commitWithAudit([[GOVERNANCE_APPROVALS_KEY,rows.slice(0,MAX_APPROVALS)]],{operationId:op,action:`approval_${decision.decision}`,entityType:decision.entityType,entityId:decision.entityId,entityNo:decision.entityNo,reason:decision.reason,after:decision});renderGovernance();return decision;
  }

  function businessSnapshot(){try{return window.ERPIntegrity?.business?.()||{};}catch(error){console.error('[Governance] business snapshot failed',error);return{};}}
  function flowSnapshot(){try{return window.ERPOrderFlow?.getStore?.()||{};}catch(error){console.warn('[Governance] flow snapshot failed',error);return{};}}
  function agingSnapshot(today){const business=businessSnapshot(),context=window.ERPIntegrity?.paymentContext?.(business)||{business},invoices=(business.invoices||[]).map(row=>{let outstanding=row.outstandingAmount??row.outstanding;try{outstanding=window.ERPIntegrity?.paymentSummary?.(row,context)?.outstanding??outstanding;}catch(error){console.warn('[Governance] payment summary fallback',error);}return{...row,outstanding};});return{ar:buildArAging(invoices,{today,dueDateOf:invoiceDueDate,undated:true}),ap:buildApAging(business.productions||[],{today})};}
  function closeChecklist(throughDate){return buildPeriodCloseChecklist({business:businessSnapshot(),flow:flowSnapshot(),outbox:outboxRows(),throughDate});}

  const money=v=>Number(v||0).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2});
  function ensureGovernancePanel(){const panel=document.getElementById('panel-audit-log');if(!panel||document.getElementById('governance-controls'))return;const box=document.createElement('div');box.id='governance-controls';box.className='card';box.innerHTML=`<div class="card-title"><span>Financial Governance · Local Demo Controls</span><span class="analytics-mini-label">Period Lock · Sync Outbox · Aging · Close Checklist</span></div><div id="governance-summary"></div><div class="filter-bar" style="margin-top:12px"><div><label>สาขา</label><select id="gov-lock-branch"><option value="all">ทุกสาขา</option><option value="ubon">สำนักงานใหญ่</option><option value="khonkaen">สาขา 00001</option></select></div><div><label>ขอบเขต</label><select id="gov-lock-scope"><option value="all">บัญชีทั้งหมด</option><option value="sales">ขาย / VAT ขาย</option><option value="purchase">ซื้อ / VAT ซื้อ</option></select></div><div><label>ปิดถึงวันที่</label><input id="gov-lock-date" type="date"></div><div><label>เหตุผล</label><input id="gov-lock-reason" placeholder="เช่น ปิดงวดเดือน 09/2569"></div><div style="align-self:end"><button type="button" class="btn btn-primary" id="gov-lock-btn">${icon('lock')}ปิดงวด</button></div><div style="align-self:end"><button type="button" class="btn btn-secondary" id="gov-sync-retry">${icon('refresh')}Retry Sync</button></div></div><div id="governance-locks" style="margin-top:12px"></div><div id="governance-checklist" style="margin-top:12px"></div>`;panel.insertBefore(box,panel.children[1]||null);box.querySelector('#gov-lock-btn')?.addEventListener('click',()=>{try{lockPeriod({branch:document.getElementById('gov-lock-branch')?.value,scope:document.getElementById('gov-lock-scope')?.value,throughDate:document.getElementById('gov-lock-date')?.value,reason:document.getElementById('gov-lock-reason')?.value});window.notify?.('ปิดงวดใน Local Demo แล้ว');}catch(error){window.notify?.(error?.message||String(error),'error');}});box.querySelector('#gov-sync-retry')?.addEventListener('click',async()=>{const r=await retryPending();window.notify?.(`Retry Sync ${r.filter(x=>x.ok).length}/${r.length} รายการ`);});}
  function renderGovernance(){ensureGovernancePanel();const summary=document.getElementById('governance-summary');if(!summary)return;const aging=agingSnapshot(),out=outboxRows(),pending=out.filter(x=>x.status!=='synced'),locks=listPeriodLocks(),today=localDateISO(),check=closeChecklist(today),prod=buildProductionReadiness({serverRbac:false,tenantIsolation:false,atomicNumbering:false,serverTransactions:false,secureAudit:false,etaxSubmission:false,whtSubmission:false});summary.innerHTML=`<div class="metrics"><div class="metric"><span>AR คงค้าง</span><strong>฿${money(aging.ar.total)}</strong><small>90+ วัน ฿${money(aging.ar.buckets.over_90)}</small></div><div class="metric"><span>AP ผู้ผลิต</span><strong>฿${money(aging.ap.total)}</strong><small>90+ วัน ฿${money(aging.ap.buckets.over_90)}</small></div><div class="metric"><span>Sync ค้าง</span><strong>${pending.length}</strong><small>Dead-letter ${pending.filter(x=>x.status==='dead_letter').length} · Uncertain ${pending.filter(x=>x.status==='uncertain').length}</small></div><div class="metric"><span>Close readiness</span><strong>${check.ready?'READY':'CHECK'}</strong><small>${check.issues.length} ประเด็น</small></div></div><div class="prodcore-control-note"><b>Production Gate:</b> Local Demo ยังไม่ผ่าน ${prod.gaps.length} control(s): ${prod.gaps.join(', ')} — ห้ามใช้ client-side role/lock/outbox แทน Server RBAC/DB transaction</div>`;const lockEl=document.getElementById('governance-locks');if(lockEl)lockEl.innerHTML=locks.length?`<b>Period Locks ที่ใช้งาน</b>${locks.map(l=>`<div class="prodcore-control-note"><b>${l.branch==='all'?'ทุกสาขา':l.branch}</b> · ${l.scope} · ถึง ${l.throughDate} · ${String(l.reason||'-').replace(/[<>]/g,'')} <button type="button" class="btn btn-ghost btn-sm" data-unlock="${l.lockId}">ปลดล็อก</button></div>`).join('')}`:'<div class="prodcore-control-note">ยังไม่มี Period Lock</div>';lockEl?.querySelectorAll('[data-unlock]').forEach(btn=>btn.addEventListener('click',()=>{const reason=prompt('เหตุผลในการปลดล็อกงวด');if(reason===null)return;try{unlockPeriod(btn.dataset.unlock,reason);window.notify?.('ปลดล็อกงวดแล้ว');}catch(error){window.notify?.(error?.message||String(error),'error');}}));const chk=document.getElementById('governance-checklist');if(chk)chk.innerHTML=`<b>Period Close Checklist · ถึง ${check.throughDate}</b>${check.issues.length?check.issues.map(i=>`<div class="prodcore-control-note"><b>${i.severity.toUpperCase()}</b> · ${i.detail} (${i.count})</div>`).join(''):'<div class="prodcore-control-note">ไม่พบ Critical/High จากกฎตรวจ Local Demo ปัจจุบัน</div>'}`;}

  function boot(){try{recoverInterruptedSyncs();}catch(error){console.error('[Governance] interrupted sync recovery failed',error);}ensureGovernancePanel();const date=document.getElementById('gov-lock-date');if(date&&!date.value)date.value=localDateISO();renderGovernance();window.addEventListener('erp-flow:changed',()=>renderGovernance());window.addEventListener('erp:navigation',e=>{if(e.detail?.panel==='audit-log')setTimeout(renderGovernance,0);});}
  window.ERPGovernance=Object.freeze({operationId,appendAudit,listPeriodLocks,lockPeriod,unlockPeriod,assertPeriodOpen,periodLockRefusal,queueSync,listOutbox,markSyncSuccess,markSyncFailure,recoverInterruptedSyncs,runSync,retrySync,retryPending,recordApprovalDecision,approvalRows,agingSnapshot,closeChecklist,evaluateApprovalPolicy:(input,policy)=>evaluateApprovalPolicy(input,policy||DEMO_APPROVAL_POLICY),render:renderGovernance});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
