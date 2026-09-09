const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const cp=require('node:child_process');
const {pathToFileURL}=require('node:url');
const ROOT=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const imp=async f=>import(pathToFileURL(path.join(ROOT,f)).href+'?t='+Date.now()+Math.random());

test('local business date does not depend on UTC ISO slicing',async()=>{
  const c=await imp('erp-shared-core.js');
  const d=new Date(2026,8,8,1,30,0);
  assert.equal(c.localDateISO(d),'2026-09-08');
  assert.equal(c.compareBusinessDates('2026-09-07','2026-09-08'),-1);
  assert.equal(c.businessDaysBetween('2026-09-01','2026-09-08'),7);
  assert.equal(c.addBusinessCalendarDays('2026-09-08',30),'2026-10-08');
  assert.equal(c.isBusinessDateBefore('2026-09-07','2026-09-08'),true);
});

test('VAT calculation has one deterministic source of truth',async()=>{
  const c=await imp('erp-shared-core.js');
  const add=c.calculateVatSummary(100,1);assert.equal(add.subtotal,100);assert.equal(add.vatAmt,7);assert.equal(add.total,107);
  const extract=c.calculateVatSummary(107,0);assert.equal(extract.subtotal,100);assert.equal(extract.vatAmt,7);assert.equal(extract.total,107);
  const none=c.calculateVatSummary(107,2);assert.equal(none.vatAmt,0);assert.equal(none.total,107);
  for(const f of fs.readdirSync(ROOT).filter(x=>x.endsWith('.js')&&x!=='erp-shared-core.js'))assert.doesNotMatch(read(f),/(?:\b0\.07\b|\b1\.07\b|100\s*\/\s*107)/,f);
});

test('storage contracts are imported instead of copied',async()=>{
  const c=await imp('erp-storage-contracts.js');
  assert.equal(c.ORDER_FLOW_STORE_KEY,'example_erp_order_flow_v3');
  assert.equal(c.CONTACT_MASTER_KEY,'comform_contact_master_v1');
  const checks={
    'erp-order-flow.js':['ORDER_FLOW_STORE_KEY','ORDER_FLOW_PREFERENCES_KEY'],
    'erp-integrity.js':['ORDER_FLOW_STORE_KEY'],
    'business-rules.js':['BUSINESS_RULES_KEY','CONTACT_MASTER_KEY','PRODUCT_MASTER_KEY'],
    'tenant-context.js':['ACTIVE_TENANT_SESSION_KEY'],
    'local-demo-mode.js':['ACTIVE_TENANT_SESSION_KEY']
  };
  for(const [f,names] of Object.entries(checks)){const src=read(f);assert.match(src,/erp-storage-contracts\.js/,f);for(const n of names)assert.match(src,new RegExp(`\\b${n}\\b`),`${f}:${n}`);}
  const literals=Object.values(c).filter(v=>typeof v==='string'&&/_v\d+$/.test(v));
  for(const f of fs.readdirSync(ROOT).filter(x=>x.endsWith('.js')&&x!=='erp-storage-contracts.js'))for(const literal of literals)assert.equal(read(f).includes(`'${literal}'`)||read(f).includes(`"${literal}"`),false,`${f} duplicates ${literal}`);
});

test('workflow graph fails closed on missing guards and unmatched routes',async()=>{
  const {runWorkflow}=await imp('erp-workflow-graph-core.js');
  const {ORDER_TO_CASH_GRAPH}=await imp('erp-workflow-definitions.js');
  assert.throws(()=>runWorkflow(ORDER_TO_CASH_GRAPH,{}),/missing guard: creditSale/);
  assert.throws(()=>runWorkflow(ORDER_TO_CASH_GRAPH,{},{guards:{creditSale:()=>false,cashSale:()=>false}}),/no matching route from invoice/);
  const cash=runWorkflow(ORDER_TO_CASH_GRAPH,{amountSatang:123n},{guards:{creditSale:()=>false,cashSale:()=>true}});
  assert.equal(cash.context.amountSatang,123n);assert.ok(cash.trace.some(x=>x.nodeId==='payment'));assert.ok(!cash.trace.some(x=>x.nodeId==='billing'));
  const credit=runWorkflow(ORDER_TO_CASH_GRAPH,{},{guards:{creditSale:()=>true,cashSale:()=>false}});
  assert.ok(credit.trace.some(x=>x.nodeId==='billing'));assert.ok(credit.trace.some(x=>x.nodeId==='payment'));
});

test('workflow graph enforces max step budget',async()=>{
  const {defineWorkflow,runWorkflow}=await imp('erp-workflow-graph-core.js');
  const wf=defineWorkflow({id:'loop',start:'a',nodes:{a:{},b:{}},edges:[{from:'a',to:'b'},{from:'b',to:'a'}]});
  assert.throws(()=>runWorkflow(wf,{}, {maxSteps:5}),/exceeded maxSteps=5/);
});

test('workflow ribbon stage respects order-flow subview',async()=>{
  const {workflowStageForNavigation}=await imp('erp-workflow-definitions.js');
  assert.equal(workflowStageForNavigation('order-flow','sales-orders'),1);
  assert.equal(workflowStageForNavigation('order-flow','fulfillment'),2);
  assert.equal(workflowStageForNavigation('order-flow','billing'),4);
  assert.equal(workflowStageForNavigation('receipt-form'),5);
});

test('SO to invoice preparation uses business dueDate helper without stale variable',()=>{
  const src=read('erp-order-flow.js');
  assert.match(src,/addBusinessCalendarDays\(date,/);
  assert.match(src,/set\('i-due-date',dueDate\)/);
  assert.doesNotMatch(src,/\bdue\.getFullYear\(/);
});

test('deep static audit passes',()=>{
  cp.execFileSync(process.execPath,['scripts/audit-deep.mjs'],{cwd:ROOT,stdio:'pipe'});
  const report=JSON.parse(read('DEEP_CODE_AUDIT_RESULTS.json'));
  assert.equal(report.status,'PASS',JSON.stringify(report.issues,null,2));
});

test('fulfillment graph supports stock production and purchase in one plan',async()=>{
  const [{FULFILLMENT_GRAPH},{runWorkflow}]=await Promise.all([imp('erp-workflow-definitions.js'),imp('erp-workflow-graph-core.js')]);
  const out=runWorkflow(FULFILLMENT_GRAPH,{}, {guards:{needsStock:()=>true,needsProduction:()=>true,needsPurchase:()=>true}});
  const nodes=out.trace.map(x=>x.nodeId);
  assert.deepEqual(nodes,['check','reserveStock','production','purchase']);
});
