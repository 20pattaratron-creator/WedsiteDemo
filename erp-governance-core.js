import { businessDateOrdinal, localDateISO } from './erp-shared-core.js';

// ============================================================================
// ERP Governance Core — pure financial-control helpers
// Local Demo foundation only; server authorization/atomic transactions remain
// mandatory before production.
// ============================================================================
export const GOVERNANCE_CORE_VERSION = '1.0.0';
export const GOVERNANCE_SCOPES = Object.freeze(['sales','purchase','all']);
export const DEMO_APPROVAL_POLICY = Object.freeze({
  quoteAmount: 100000,
  quoteDiscountRate: 10,
  purchaseOrderAmount: 100000,
  expenseAmount: 20000,
  productionCost: 100000
});

export class GovernanceError extends Error {
  constructor(code,message,details={}){super(message);this.name='GovernanceError';this.code=code;this.details=details;}
}

const n=v=>Number.isFinite(Number(v))?Number(v):0;
const norm=v=>String(v??'').trim().toLowerCase();
const live=x=>x&&!x.voided&&!x.deleted&&!x.cancelled&&!x.reversed&&!['cancelled','void','reversed'].includes(norm(x.status));
const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
const validScope=scope=>GOVERNANCE_SCOPES.includes(String(scope||''))?String(scope):'all';
const validDate=value=>businessDateOrdinal(value)>0?String(value).slice(0,10):'';

export function normalizePeriodLockEvent(input={}){
  const action=input.action==='unlock'?'unlock':'lock';
  const branch=String(input.branch||'all').trim()||'all';
  const throughDate=validDate(input.throughDate);
  if(action==='lock'&&!throughDate)throw new GovernanceError('validation_error','วันที่ปิดงวดไม่ถูกต้อง');
  const lockId=String(input.lockId||input.id||'').trim();
  if(!lockId)throw new GovernanceError('validation_error','Period Lock ต้องมี lockId');
  return Object.freeze({
    id:String(input.id||lockId),lockId,action,branch,scope:validScope(input.scope),throughDate,
    reason:String(input.reason||'').trim(),actor:String(input.actor||'').trim(),at:String(input.at||''),
    operationId:String(input.operationId||'').trim()
  });
}

export function activePeriodLocks(events=[]){
  const active=new Map();
  for(const raw of Array.isArray(events)?events:[]){
    let event;try{event=normalizePeriodLockEvent(raw);}catch{continue;}
    if(event.action==='unlock'){active.delete(event.lockId);continue;}
    active.set(event.lockId,event);
  }
  return [...active.values()];
}


export function compactPeriodLockEvents(events=[],maxEvents=1000){
  const rows=[];
  for(const [index,raw] of (Array.isArray(events)?events:[]).entries()){
    try{rows.push({index,event:normalizePeriodLockEvent(raw)});}catch{continue;}
  }
  const activeIds=new Set(activePeriodLocks(rows.map(x=>x.event)).map(x=>x.id));
  const keep=Math.max(0,Math.trunc(n(maxEvents))||1000);
  const selected=new Map();
  for(const row of rows.slice(-keep))selected.set(row.index,row);
  for(const row of rows)if(activeIds.has(row.event.id))selected.set(row.index,row);
  return [...selected.values()].sort((a,b)=>a.index-b.index).map(x=>x.event);
}

export function findBlockingPeriodLock(events=[],transaction={}){
  const branch=String(transaction.branch||'').trim();
  const scope=validScope(transaction.scope);
  const date=validDate(transaction.date);
  if(!branch||!date)throw new GovernanceError('validation_error','ตรวจ Period Lock ต้องมีสาขาและวันที่รายการ');
  const dateOrd=businessDateOrdinal(date);
  return activePeriodLocks(events).find(lock=>{
    if(lock.branch!=='all'&&lock.branch!==branch)return false;
    if(lock.scope!=='all'&&lock.scope!==scope)return false;
    return dateOrd<=businessDateOrdinal(lock.throughDate);
  })||null;
}

export function assertPeriodOpen(events=[],transaction={}){
  const lock=findBlockingPeriodLock(events,transaction);
  if(!lock)return Object.freeze({ok:true,lock:null});
  throw new GovernanceError('period_locked',`งวด ${lock.scope==='sales'?'ขาย/ภาษีขาย':lock.scope==='purchase'?'ซื้อ/ภาษีซื้อ':'บัญชี'} ถูกปิดถึง ${lock.throughDate} สำหรับ ${lock.branch==='all'?'ทุกสาขา':lock.branch} กรุณาใช้รายการย้อนกลับ/ปรับปรุงหรือปลดล็อกพร้อมเหตุผลก่อน`,{lock});
}

export function agingBucket(daysPastDue){
  const days=Math.max(0,Math.trunc(n(daysPastDue)));
  if(days<=0)return 'current';
  if(days<=30)return '1_30';
  if(days<=60)return '31_60';
  if(days<=90)return '61_90';
  return 'over_90';
}

function buildAging(rows=[],options={}){
  const today=validDate(options.today||localDateISO())||localDateISO();
  const todayOrd=businessDateOrdinal(today);
  // options.undated: the due date comes ONLY from dueDateOf (the shared AR rule, invoiceDueDate) and a
  // row without a usable one goes to an `undated` bucket, like the AR report — never silently to `current`.
  const undated=options.undated===true;
  const buckets={current:0,'1_30':0,'31_60':0,'61_90':0,over_90:0,...(undated?{undated:0}:{})};
  const items=[];
  for(const row of Array.isArray(rows)?rows:[]){
    if(!live(row))continue;
    const amount=Math.max(0,n(options.amountOf?.(row)));
    if(amount<=0)continue;
    const due=undated?validDate(options.dueDateOf?.(row)):validDate(options.dueDateOf?.(row)||row.dueDate||row.date)||today;
    const daysPastDue=due?Math.max(0,todayOrd-businessDateOrdinal(due)):null;
    const bucket=due?agingBucket(daysPastDue):'undated';buckets[bucket]+=amount;
    items.push({id:String(row.id||''),no:String(row.no||''),party:String(options.partyOf?.(row)||''),branch:String(row.branch||row._branch||''),dueDate:due,daysPastDue,bucket,amount});
  }
  Object.keys(buckets).forEach(k=>buckets[k]=Math.round((buckets[k]+Number.EPSILON)*100)/100);
  // The total is rounded to satang like the buckets: a raw float sum (e.g. 428329.39999999997)
  // would not equal the AR report total that erp-receivables-core sums in satang.
  const total=Math.round((Object.values(buckets).reduce((s,v)=>s+v,0)+Number.EPSILON)*100)/100;
  return Object.freeze({today,buckets,total,items:items.sort((a,b)=>(b.daysPastDue??-1)-(a.daysPastDue??-1)||b.amount-a.amount)});
}

export function buildArAging(invoices=[],options={}){
  return buildAging(invoices,{...options,amountOf:options.amountOf||((row)=>row.outstandingAmount??row.outstanding??Math.max(0,n(row.total)-n(row.paidAmount))),dueDateOf:options.dueDateOf||((row)=>row.dueDate||row.paymentDueDate||row.date),partyOf:options.partyOf||((row)=>row.customer)});
}

export function buildApAging(productions=[],options={}){
  return buildAging(productions,{...options,amountOf:options.amountOf||((row)=>String(row.supplierPaymentStatus||'pending')==='paid'?0:(row.supplierOutstandingAmount??Math.max(0,n(row.costGrandTotal??row.costTotal)-n(row.supplierPaidAmount)))),dueDateOf:options.dueDateOf||((row)=>row.supplierDueDate||row.deliveryDueDate||row.date),partyOf:options.partyOf||((row)=>row.maker||row.supplier)});
}

export function evaluateApprovalPolicy(input={},policy=DEMO_APPROVAL_POLICY){
  const entity=String(input.entityType||'').trim();
  const amount=Math.max(0,n(input.amount));
  const discountRate=Math.max(0,n(input.discountRate));
  const reasons=[];
  if(entity==='quote'){
    if(amount>=n(policy.quoteAmount))reasons.push(`ยอดใบเสนอราคา ≥ ${n(policy.quoteAmount)}`);
    if(discountRate>=n(policy.quoteDiscountRate))reasons.push(`ส่วนลด ≥ ${n(policy.quoteDiscountRate)}%`);
  }
  if(entity==='purchase_order'&&amount>=n(policy.purchaseOrderAmount))reasons.push(`ยอด PO ≥ ${n(policy.purchaseOrderAmount)}`);
  if(entity==='expense'&&amount>=n(policy.expenseAmount))reasons.push(`ค่าใช้จ่าย ≥ ${n(policy.expenseAmount)}`);
  if(entity==='production'&&amount>=n(policy.productionCost))reasons.push(`ต้นทุนสั่งผลิต ≥ ${n(policy.productionCost)}`);
  return Object.freeze({entityType:entity,amount,discountRate,requiresApproval:reasons.length>0,reasons,policy:{...policy}});
}

export function normalizeApprovalDecision(input={}){
  const decision=['approved','rejected','revoked'].includes(String(input.decision))?String(input.decision):'approved';
  const entityType=String(input.entityType||'').trim(),entityId=String(input.entityId||'').trim();
  if(!entityType||!entityId)throw new GovernanceError('validation_error','Approval ต้องระบุชนิดและรหัสเอกสาร');
  return Object.freeze({id:String(input.id||''),entityType,entityId,entityNo:String(input.entityNo||''),decision,reason:String(input.reason||'').trim(),actor:String(input.actor||''),at:String(input.at||''),operationId:String(input.operationId||''),amount:n(input.amount),policyResult:clone(input.policyResult||{})});
}


function stableOperationValue(value,seen=new WeakSet()){
  if(value===null||value===undefined)return value??null;
  const type=typeof value;
  if(type==='string'||type==='boolean')return value;
  if(type==='number')return Number.isFinite(value)?value:String(value);
  if(type==='bigint')return String(value);
  if(type==='function'||type==='symbol')return String(value);
  if(value instanceof Date)return Number.isNaN(value.getTime())?'Invalid Date':value.toISOString();
  if(type!=='object')return String(value);
  if(seen.has(value))throw new GovernanceError('validation_error','ไม่สามารถสร้าง Idempotency fingerprint จากข้อมูลอ้างอิงวนซ้ำได้');
  seen.add(value);
  let out;
  if(Array.isArray(value))out=value.map(item=>stableOperationValue(item,seen));
  else{
    out={};
    for(const key of Object.keys(value).sort()){
      const item=value[key];
      if(item===undefined||typeof item==='function'||typeof item==='symbol')continue;
      out[key]=stableOperationValue(item,seen);
    }
  }
  seen.delete(value);
  return out;
}

export function stableOperationFingerprint(value={}){
  const text=JSON.stringify(stableOperationValue(value));
  let h1=0x811c9dc5,h2=0x9e3779b9;
  for(let i=0;i<text.length;i+=1){
    const c=text.charCodeAt(i);
    h1^=c;h1=Math.imul(h1,0x01000193)>>>0;
    h2^=c+((i+1)&255);h2=Math.imul(h2,0x85ebca6b)>>>0;
  }
  return `${text.length.toString(36)}-${h1.toString(36)}-${h2.toString(36)}`;
}

export function normalizeOutboxOperation(input={}){
  const operationId=String(input.operationId||'').trim();
  if(!operationId)throw new GovernanceError('validation_error','Sync Outbox ต้องมี operationId');
  const attempts=Math.max(0,Math.trunc(n(input.attempts)));
  const status=['pending','syncing','failed','uncertain','synced','dead_letter'].includes(String(input.status))?String(input.status):'pending';
  return Object.freeze({operationId,channel:String(input.channel||'business'),method:String(input.method||''),collection:String(input.collection||''),payload:clone(input.payload||{}),args:clone(input.args||[]),status,attempts,createdAt:String(input.createdAt||''),updatedAt:String(input.updatedAt||''),lastError:String(input.lastError||''),entityType:String(input.entityType||''),entityId:String(input.entityId||''),branch:String(input.branch||'')});
}

export function shouldDeadLetter(operation={},maxAttempts=5){return n(operation.attempts)>=Math.max(1,n(maxAttempts));}

export function buildPeriodCloseChecklist(input={}){
  const business=input.business||{},flow=input.flow||{},outbox=Array.isArray(input.outbox)?input.outbox:[];
  const throughDate=validDate(input.throughDate||localDateISO())||localDateISO(),throughOrd=businessDateOrdinal(throughDate),issues=[];
  const inPeriod=row=>{const date=validDate(row?.date||row?.billingDate||row?.createdAt);return date&&businessDateOrdinal(date)<=throughOrd;};
  const invoices=(business.invoices||[]).filter(x=>live(x)&&inPeriod(x));
  const ar=invoices.filter(i=>Math.max(0,n(i.outstandingAmount??i.outstanding??(n(i.total)-n(i.paidAmount))))>0.009);
  if(ar.length)issues.push({code:'open_ar',severity:'medium',count:ar.length,detail:'มี Invoice คงค้าง ควรทบทวน Aged Receivables/การตั้งสำรอง แต่ไม่ใช่เหตุบังคับให้ยอดลูกหนี้ต้องเป็นศูนย์ก่อนปิดงวด'});
  const apRows=(business.productions||[]).filter(p=>live(p)&&inPeriod(p)&&String(p.supplierPaymentStatus||'pending')!=='paid'&&Math.max(0,n(p.supplierOutstandingAmount??(n(p.costGrandTotal??p.costTotal)-n(p.supplierPaidAmount))))>0.009);
  if(apRows.length)issues.push({code:'open_ap',severity:'medium',count:apRows.length,detail:'มีเจ้าหนี้ผู้ผลิตคงค้าง ควรทบทวน Aged Payables/ความครบถ้วนของภาระผูกพันก่อนปิดงวด'});
  const badReceipt=(business.receipts||[]).filter(r=>live(r)&&inPeriod(r)&&!(r.invoiceId||r.sourceInvoiceId||r.invNo||r.sourceInvoiceNo));
  if(badReceipt.length)issues.push({code:'unlinked_receipt',severity:'high',count:badReceipt.length,detail:'มี Receipt ไม่มี Invoice reference'});
  const missingTaxEvidence=(business.expenses||[]).filter(e=>live(e)&&inPeriod(e)&&String(e.taxStatus)==='received'&&!(e.attachments||[]).length);
  if(missingTaxEvidence.length)issues.push({code:'tax_evidence_missing',severity:'medium',count:missingTaxEvidence.length,detail:'มีค่าใช้จ่ายระบุว่าได้รับใบกำกับภาษีแล้วแต่ยังไม่มีไฟล์หลักฐาน'});
  const unresolvedPayments=(flow.payments||[]).filter(p=>live(p)&&inPeriod(p)&&(!(p.allocations||[]).length||(p.allocations||[]).some(a=>n(a.amount)<=0)));
  if(unresolvedPayments.length)issues.push({code:'payment_allocation',severity:'critical',count:unresolvedPayments.length,detail:'มี Payment ที่ไม่มี allocation ที่ตรวจสอบได้'});
  const pendingSync=outbox.filter(o=>['pending','failed','syncing','uncertain','dead_letter'].includes(String(o.status)));
  if(pendingSync.length)issues.push({code:'sync_pending',severity:pendingSync.some(x=>['dead_letter','uncertain'].includes(x.status))?'high':'medium',count:pendingSync.length,detail:'ยังมีรายการ Local → Cloud ที่ยังซิงก์ไม่สมบูรณ์หรือผลการส่งไม่แน่นอน'});
  const rank={critical:4,high:3,medium:2,low:1,info:0};issues.sort((a,b)=>rank[b.severity]-rank[a.severity]||a.code.localeCompare(b.code));
  return Object.freeze({throughDate,ready:!issues.some(i=>['critical','high'].includes(i.severity)),issues});
}

export function buildETaxReadiness(record={},company={}){
  const checks=[
    ['document_no',!!String(record.no||record.docNo||'').trim(),'เลขที่เอกสาร'],
    ['document_date',!!validDate(record.date),'วันที่เอกสาร'],
    ['seller_tax_id',/^\d{13}$/.test(String(company.taxId||record.companyTaxId||'').replace(/\D/g,'')),'เลขประจำตัวผู้เสียภาษีผู้ขาย 13 หลัก'],
    ['seller_address',!!String(company.address||record.companyAddress||'').trim(),'ที่อยู่ผู้ขาย'],
    ['buyer_name',!!String(record.customer||record.buyerName||'').trim(),'ชื่อผู้ซื้อ'],
    ['buyer_tax_id',/^\d{13}$/.test(String(record.customerTaxId||record.buyerTaxId||'').replace(/\D/g,'')),'เลขประจำตัวผู้เสียภาษีผู้ซื้อ 13 หลัก (เมื่อใช้กับเอกสารที่ต้องระบุ)'],
    ['items',Array.isArray(record.items)&&record.items.length>0,'รายการสินค้า/บริการ'],
    ['total',Number.isFinite(Number(record.total)),'ยอดรวม'],
    ['vat',Number.isFinite(Number(record.vatAmt??0)),'ยอด VAT']
  ].map(([code,ok,label])=>({code,ok,label}));
  return Object.freeze({ready:checks.every(x=>x.ok),checks,note:'Readiness checklist เท่านั้น ไม่ใช่การรับรองว่า XML/ลายมือชื่อดิจิทัลผ่านมาตรฐานกรมสรรพากร'});
}


export function buildWhtReadiness(expense={}){
  const rateRaw=expense.whtRate,baseRaw=expense.whtBase,amountRaw=expense.whtAmount;
  const configured=[rateRaw,baseRaw,amountRaw].some(v=>v!==undefined&&v!==null&&v!=='');
  if(!configured)return Object.freeze({configured:false,ready:false,checks:[],note:'ยังไม่ได้เปิดใช้ข้อมูล WHT ในรายการนี้ — readiness เท่านั้น ไม่ใช่การยื่น e-Withholding Tax'});
  const rate=n(rateRaw),base=n(baseRaw),amount=n(amountRaw),expected=Math.round((base*rate/100+Number.EPSILON)*100)/100;
  const checks=[
    {code:'vendor',ok:!!String(expense.vendor||expense.supplier||'').trim(),label:'ผู้รับเงิน/ผู้ถูกหักภาษี'},
    {code:'base',ok:base>0,label:'ฐานภาษีหัก ณ ที่จ่ายมากกว่า 0'},
    {code:'rate',ok:rate>=0&&rate<=100,label:'อัตรา WHT อยู่ในช่วง 0–100%'},
    {code:'amount',ok:amount>=0&&Math.abs(amount-expected)<=0.01,label:'ยอด WHT สอดคล้องกับฐาน × อัตรา'}
  ];
  return Object.freeze({configured:true,ready:checks.every(x=>x.ok),rate,base,amount,expected,checks,note:'Readiness/check arithmetic only; tax type/rate eligibility and submission must be validated against current Revenue Department rules.'});
}

export function buildProductionReadiness(input={}){
  const checks=[
    ['server_rbac',!!input.serverRbac,'Server-side RBAC / tenant authorization'],
    ['tenant_isolation',!!input.tenantIsolation,'Backend tenant/company/branch isolation'],
    ['atomic_numbering',!!input.atomicNumbering,'Atomic document numbering across devices'],
    ['server_transactions',!!input.serverTransactions,'Server/database transactions for financial writes'],
    ['secure_audit',!!input.secureAudit,'Tamper-resistant server audit trail'],
    ['etax_submission',!!input.etaxSubmission,'e-Tax XML/signature/submission boundary'],
    ['wht_submission',!!input.whtSubmission,'WHT/e-Withholding submission boundary']
  ].map(([code,ok,label])=>({code,ok,label}));
  return Object.freeze({ready:checks.every(x=>x.ok),checks,gaps:checks.filter(x=>!x.ok).map(x=>x.code)});
}
