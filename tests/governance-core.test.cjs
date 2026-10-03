const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
let mod;
async function core(){return mod||(mod=await import(pathToFileURL(path.join(root,'erp-governance-core.js')).href));}

test('period locks are append-only events and block matching scopes through the lock date',async()=>{
  const g=await core();
  const events=[{id:'e1',lockId:'L1',action:'lock',branch:'ubon',scope:'sales',throughDate:'2026-09-30',reason:'close',actor:'a',at:'2026-10-01T00:00:00Z'}];
  assert.equal(g.activePeriodLocks(events).length,1);
  assert.throws(()=>g.assertPeriodOpen(events,{branch:'ubon',scope:'sales',date:'2026-09-15'}),e=>e.code==='period_locked');
  assert.doesNotThrow(()=>g.assertPeriodOpen(events,{branch:'ubon',scope:'purchase',date:'2026-09-15'}));
  assert.doesNotThrow(()=>g.assertPeriodOpen(events,{branch:'ubon',scope:'sales',date:'2026-10-01'}));
  const unlocked=[...events,{id:'e2',lockId:'L1',action:'unlock',branch:'ubon',scope:'sales',throughDate:'2026-09-30',reason:'adjustment',actor:'a',at:'2026-10-02T00:00:00Z'}];
  assert.equal(g.activePeriodLocks(unlocked).length,0);
});

test('AR and AP aging bucket current 1-30 31-60 61-90 and 90+ deterministically',async()=>{
  const g=await core();
  const ar=g.buildArAging([
    {id:'1',no:'I1',date:'2026-09-01',dueDate:'2026-10-01',customer:'A',outstanding:100},
    {id:'2',no:'I2',date:'2026-08-01',dueDate:'2026-09-01',customer:'B',outstanding:200},
    {id:'3',no:'I3',date:'2026-06-01',dueDate:'2026-06-01',customer:'C',outstanding:300}
  ],{today:'2026-09-16'});
  assert.equal(ar.buckets.current,100);assert.equal(ar.buckets['1_30'],200);assert.equal(ar.buckets.over_90,300);assert.equal(ar.total,600);
  const ap=g.buildApAging([{id:'P1',maker:'Supplier',date:'2026-07-01',supplierDueDate:'2026-08-01',supplierPaymentStatus:'partial',costTotal:500,supplierPaidAmount:100}],{today:'2026-09-16'});
  assert.equal(ap.buckets['31_60'],400);assert.equal(ap.total,400);
});

test('approval policy is informative and does not pretend to be server authorization',async()=>{
  const g=await core();
  const q=g.evaluateApprovalPolicy({entityType:'quote',amount:120000,discountRate:12});
  assert.equal(q.requiresApproval,true);assert.equal(q.reasons.length,2);
  const low=g.evaluateApprovalPolicy({entityType:'expense',amount:500});assert.equal(low.requiresApproval,false);
});

test('period close checklist exposes unresolved financial and sync evidence',async()=>{
  const g=await core();
  const out=g.buildPeriodCloseChecklist({throughDate:'2026-09-30',business:{invoices:[{id:'I',date:'2026-09-01',total:100,outstanding:100}],receipts:[{id:'R',date:'2026-09-02',total:50}],expenses:[{id:'E',date:'2026-09-03',taxStatus:'received',attachments:[]}],productions:[]},flow:{payments:[{id:'PAY',date:'2026-09-03',allocations:[]}]},outbox:[{operationId:'O',status:'failed'}]});
  assert.equal(out.ready,false);const codes=new Set(out.issues.map(x=>x.code));
  for(const code of ['open_ar','unlinked_receipt','tax_evidence_missing','payment_allocation','sync_pending'])assert.equal(codes.has(code),true);
});

test('sync operation fingerprint is stable across object key order and changes when payload changes',async()=>{
  const g=await core();
  const a=g.stableOperationFingerprint({method:'saveInvoice',payload:{id:1,total:107,items:[{qty:1,product:'A'}]}});
  const b=g.stableOperationFingerprint({payload:{items:[{product:'A',qty:1}],total:107,id:1},method:'saveInvoice'});
  const c=g.stableOperationFingerprint({method:'saveInvoice',payload:{id:1,total:108,items:[{qty:1,product:'A'}]}});
  assert.equal(a,b);assert.notEqual(a,c);
});

test('outbox normalization and dead-letter threshold are deterministic',async()=>{
  const g=await core();
  const row=g.normalizeOutboxOperation({operationId:'OP1',channel:'business_method',method:'saveInvoice',payload:{id:1},attempts:4,status:'failed'});
  assert.equal(row.operationId,'OP1');assert.equal(g.shouldDeadLetter(row,5),false);assert.equal(g.shouldDeadLetter({...row,attempts:5},5),true);
});

test('e-Tax and WHT helpers are readiness checks, not submission claims',async()=>{
  const g=await core();
  const etax=g.buildETaxReadiness({no:'INV1',date:'2026-09-16',customer:'Customer',customerTaxId:'1234567890123',items:[{product:'A'}],total:107,vatAmt:7},{taxId:'1234567890123',address:'Bangkok'});
  assert.equal(etax.ready,true);assert.match(etax.note,/Readiness/);
  const wht=g.buildWhtReadiness({vendor:'Vendor',whtBase:1000,whtRate:3,whtAmount:30});assert.equal(wht.ready,true);
  const prod=g.buildProductionReadiness({serverRbac:false,tenantIsolation:false,atomicNumbering:false,serverTransactions:false,secureAudit:false,etaxSubmission:false,whtSubmission:false});assert.equal(prod.ready,false);assert.equal(prod.gaps.length,7);
});

test('runtime wiring protects strict financial writes, outbox, backup dry-run and governance deployment',()=>{
  const fs=require('node:fs');const app=fs.readFileSync(path.join(root,'app.js'),'utf8'),flow=fs.readFileSync(path.join(root,'erp-order-flow.js'),'utf8'),integrity=fs.readFileSync(path.join(root,'erp-integrity.js'),'utf8'),index=fs.readFileSync(path.join(root,'index.html'),'utf8'),backup=fs.readFileSync(path.join(root,'erp-backup.js'),'utf8'),pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  assert.match(app,/documentNumberExistsForWrite\('invoice'/);assert.match(app,/documentNumberExistsForWrite\('receipt'/);
  assert.match(app,/saveInvoiceUnlocked\([\s\S]*?assertPeriodOpen/);assert.match(app,/saveExpenseUnlocked\([\s\S]*?scope:'purchase'/);
  assert.match(integrity,/createPaymentReceipts\([\s\S]*?parseFinancialDocumentPackForWrite/);
  const block=/function saveBillingPayment\([\s\S]*?\n  }\n\n  function/.exec(flow)?.[0]||'';assert.doesNotMatch(block,/reconcilePayments\(\);saveStore\(store\)/);
  assert.match(index,/erp-governance\.js/);assert.match(backup,/async function dryRun/);assert.match(backup,/async function verifyPortable/);assert.match(backup,/contentSha256/);assert.match(app,/await window\.ERPBackup\.verifyPortable\(raw\)/);assert.match(pkg.scripts['audit:all'],/audit:render-golden/);assert.match(pkg.scripts['quality:core'],/audit:render-golden/);const gov=fs.readFileSync(path.join(root,'erp-governance.js'),'utf8'),production=fs.readFileSync(path.join(root,'erp-production-core.js'),'utf8');assert.match(gov,/status==='synced'\)return clone\(row\.result/);assert.match(gov,/syncInflight\.has/);assert.doesNotMatch(app,/operationId\?\.\('bizsync'.*Date\.now/);assert.doesNotMatch(production,/operationId\?\.\('opssync'.*Date\.now/);
});


test('period lock compaction never drops an active lock even beyond the retention window',async()=>{
  const g=await core();
  const events=[{id:'active-lock',lockId:'L-active',action:'lock',branch:'ubon',scope:'sales',throughDate:'2026-12-31',at:'2026-01-01T00:00:00Z'}];
  for(let i=0;i<1100;i++)events.push({id:`old-${i}`,lockId:`L-${i}`,action:'lock',branch:'khonkaen',scope:'purchase',throughDate:'2026-01-31',at:`2026-02-01T00:00:${String(i%60).padStart(2,'0')}Z`},{id:`old-u-${i}`,lockId:`L-${i}`,action:'unlock',branch:'khonkaen',scope:'purchase',throughDate:'2026-01-31',at:`2026-02-02T00:00:${String(i%60).padStart(2,'0')}Z`});
  const compact=g.compactPeriodLockEvents(events,1000);
  assert.equal(g.activePeriodLocks(compact).some(x=>x.lockId==='L-active'),true);
  assert.ok(compact.length<=1001);
});

test('open AR and AP are review items, not automatic period-close blockers',async()=>{
  const g=await core();
  const result=g.buildPeriodCloseChecklist({throughDate:'2026-09-30',business:{invoices:[{id:'I1',date:'2026-09-01',total:100,outstanding:100}],productions:[{id:'P1',date:'2026-09-02',costTotal:50,supplierPaymentStatus:'pending'}],receipts:[],expenses:[]},flow:{payments:[]},outbox:[]});
  assert.equal(result.ready,true);
  assert.equal(result.issues.find(x=>x.code==='open_ar')?.severity,'medium');
  assert.equal(result.issues.find(x=>x.code==='open_ap')?.severity,'medium');
});

test('uncertain sync is a high-severity close blocker until reconciled',async()=>{
  const g=await core();
  const result=g.buildPeriodCloseChecklist({throughDate:'2026-09-30',business:{invoices:[],productions:[],receipts:[],expenses:[]},flow:{payments:[]},outbox:[{operationId:'OP',status:'uncertain'}]});
  assert.equal(result.ready,false);
  assert.equal(result.issues.find(x=>x.code==='sync_pending')?.severity,'high');
});

// ADR-013: found with the demo sample data — the bucket amounts below add up (as floats) to
// 428329.39999999997; the total must be rounded to satang like the buckets so it equals the AR
// report total (erp-receivables-core sums in satang).
test('AR aging total is rounded to satang like its buckets',async()=>{
  const g=await core();
  const ar=g.buildArAging([
    {id:'1',no:'I1',dueDate:'2026-10-01',customer:'A',outstanding:150068.6},
    {id:'2',no:'I2',dueDate:'2026-09-16',customer:'B',outstanding:82836},
    {id:'3',no:'I3',dueDate:'2026-08-12',customer:'C',outstanding:26750},
    {id:'4',no:'I4',dueDate:'2026-07-26',customer:'D',outstanding:124933.2},
    {id:'5',no:'I5',dueDate:'2026-06-18',customer:'E',outstanding:43741.6}
  ],{today:'2026-09-26'});
  assert.notEqual(150068.6+82836+26750+124933.2+43741.6,428329.4,'the raw float sum is inexact');
  assert.deepEqual({...ar.buckets},{current:150068.6,'1_30':82836,'31_60':26750,'61_90':124933.2,over_90:43741.6});
  assert.equal(ar.total,428329.4);
});
