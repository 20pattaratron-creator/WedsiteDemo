const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

async function core(){return import(pathToFileURL(path.resolve(__dirname,'../erp-decision-council-core.js')).href+'?t='+Date.now());}

function base(){return {now:'2026-09-07',demoMode:true,quotes:[],invoices:[],orders:[],billingNotes:[],payments:[],products:[],businessRuleVersion:1,runtimeErrors:0};}

test('council keeps reviewers independent and chairman prioritizes critical evidence',async()=>{
  const {analyzeCouncil}=await core();
  const s=base();
  s.quotes=[{id:'q1',no:'QT1',customer:'A',date:'2026-09-01',approved:true,total:1000,items:[{product:'X',qty:1}]}];
  s.invoices=[{id:'i1',no:'INV1',customer:'A',date:'2026-08-01',dueDate:'2026-08-31',total:1000,outstanding:500,overpaid:0,items:[{product:'X',qty:1}]}];
  s.orders=[{id:'so1',no:'SO1',customer:'A',requiredDate:'2026-09-01',status:'confirmed',sourceQuoteId:'other',items:[{product:'X',qty:10,stockQty:2,productionQty:0,purchaseQty:0,deliveredQty:1,readyQty:2,remainingQty:9}]}];
  s.products=[{code:'X',name:'Product X',stock:-2,reorderPoint:5}];
  const r=analyzeCouncil(s);
  assert.equal(r.reviewCount,6);
  assert.equal(r.reviews.find(x=>x.name==='sales').findings[0].ruleId,'SALES_001');
  assert.ok(r.reviews.find(x=>x.name==='collections').findings.some(x=>x.ruleId==='AR_001'));
  assert.ok(r.reviews.find(x=>x.name==='fulfillment').findings.some(x=>x.ruleId==='OPS_002'));
  assert.ok(r.reviews.find(x=>x.name==='inventory').findings.some(x=>x.ruleId==='INV_001'));
  assert.equal(r.chairman.severity,'critical');
  assert.equal(r.chairman.actions[0].ruleId,'INV_001');
});

test('overpayment becomes critical and is never hidden by outstanding floor',async()=>{
  const {analyzeCouncil}=await core();
  const s=base();
  s.invoices=[{id:'i1',no:'INV1',customer:'A',date:'2026-09-01',dueDate:'2026-09-30',total:1000,outstanding:0,overpaid:100,items:[{product:'X',qty:1}]}];
  const r=analyzeCouncil(s);
  const ar=r.reviews.find(x=>x.name==='collections');
  assert.ok(ar.findings.some(x=>x.ruleId==='AR_003'&&x.severity==='critical'));
});

test('healthy snapshot does not invent medium or critical actions',async()=>{
  const {analyzeCouncil}=await core();
  const s=base();
  s.quotes=Array.from({length:3},(_,i)=>({id:'q'+i,no:'Q'+i,customer:'A',date:'2026-09-05',approved:false,total:100,items:[{product:'X',qty:1}]}));
  s.invoices=Array.from({length:3},(_,i)=>({id:'i'+i,no:'I'+i,customer:'A',date:'2026-09-05',dueDate:'2026-09-30',total:100,outstanding:0,overpaid:0,items:[{product:'X',qty:1}]}));
  s.products=[{code:'X',stock:10,reorderPoint:2}];
  const r=analyzeCouncil(s);
  assert.equal(r.chairman.actions.length,0);
  assert.notEqual(r.chairman.severity,'critical');
  assert.notEqual(r.chairman.severity,'high');
});

test('demo and low evidence are explicit contrarian caveats rather than fake confidence',async()=>{
  const {analyzeCouncil}=await core();
  const r=analyzeCouncil(base());
  const c=r.reviews.find(x=>x.name==='contrarian');
  assert.ok(c.findings.some(x=>x.ruleId==='CTR_001'));
  assert.ok(c.findings.some(x=>x.ruleId==='CTR_002'));
  assert.equal(r.chairman.evidenceLevel,'จำกัด');
  assert.match(r.chairman.note,/ไม่ใช่เสียงโหวตจากหลาย LLM/);
});

test('rule registry exposes evidence source and formula for every finding',async()=>{
  const {RULE_REGISTRY}=await core();
  assert.ok(Object.keys(RULE_REGISTRY).length>=10);
  for(const [id,rule] of Object.entries(RULE_REGISTRY)){
    assert.match(id,/^[A-Z]+_\d{3}$/);
    assert.ok(rule.source);
    assert.ok(rule.formula);
    assert.ok(rule.reviewer);
  }
});


test('cash invoices are not incorrectly flagged as missing a billing note',async()=>{
  const {analyzeCouncil}=await core();
  const s=base();
  s.invoices=[{id:'i1',no:'INV-CASH',customer:'A',date:'2026-09-01',dueDate:'2026-09-01',creditTerm:'cash',total:1000,outstanding:1000,overpaid:0,items:[{product:'X',qty:1}]}];
  const r=analyzeCouncil(s);
  const ar=r.reviews.find(x=>x.name==='collections');
  assert.ok(!ar.findings.some(x=>x.ruleId==='AR_002'));
});
