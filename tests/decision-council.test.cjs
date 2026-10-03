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

// ================================================= fix6 regressions (4.3.1 review 6)
test('fix6#2: Decision Council overdue receivables use the AR report due-date rule and equal the AR banner', async()=>{
  const {analyzeCouncil}=await core();
  const rc=await import(pathToFileURL(path.resolve(__dirname,'../erp-receivables-core.js')).href+'?t='+Date.now());
  const today='2026-09-22';
  const invs=[
    {id:1,no:'INV-TERM',date:'2026-07-01',creditTerm:'credit30',customer:'A',total:1070,items:[{product:'X',qty:1}]},                      // no stored dueDate → due 2026-07-31 by term
    {id:2,no:'AB-1',date:'2026-09-10',taxInvoiceForm:'abbreviated',customer:'ลูกค้าทั่วไป / เงินสด',total:535,items:[{product:'X',qty:1}]}, // walk-in: due on the invoice date
    {id:3,no:'INV-DUE',date:'2026-07-01',creditTerm:'credit30',dueDate:'2026-07-31',customer:'B',total:2140,items:[{product:'X',qty:1}]},
    {id:4,no:'INV-FUTURE',date:'2026-09-20',creditTerm:'credit30',customer:'C',total:999,items:[{product:'X',qty:1}]},                      // due 2026-10-20 → not overdue
    {id:5,no:'INV-DUST',date:'2026-07-01',creditTerm:'credit30',customer:'D',total:100,outstanding:0.01,items:[{product:'X',qty:1}]}        // rounding dust is not owed
  ];
  const s=base();s.now=today;s.invoices=invs.map(i=>({outstanding:i.total,overpaid:0,...i}));
  const ar001=analyzeCouncil(s).reviews.find(x=>x.name==='collections').findings.find(x=>x.ruleId==='AR_001');
  const alert=rc.receivableAlertSummary(rc.buildReceivableItems(s.invoices,{asOf:today,summarize:i=>({total:i.total,paid:0,outstanding:i.outstanding})}));
  assert.equal(alert.overdueCount,3);assert.equal(alert.overdueTotal,3745);
  assert.ok(ar001,'AR_001 raised');
  // Baht amounts always carry 2 decimals (round 4): ฿3,745.00, not ฿3,745.
  assert.equal(ar001.summary,`ลูกหนี้เกินกำหนด ${alert.overdueCount} ใบ รวม ฿${alert.overdueTotal.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})}`);
  assert.match(ar001.summary,/3 ใบ รวม ฿3,745\.00$/);
  assert.deepEqual(ar001.evidence.map(x=>x.split(' · ')[0]).sort(),['AB-1','INV-DUE','INV-TERM']);
});

test('fix6#2: Decision Council card and AR banner show the same overdue figures on the running app (shared payment context)', async()=>{
  const {boot}=require('./dom-helper.cjs');
  const h=await boot();const {w}=h;
  try{
    const sh=await import(pathToFileURL(path.resolve(__dirname,'../erp-shared-core.js')).href+'?t='+Date.now());
    const today=sh.localDateISO(),old=sh.addBusinessCalendarDays(today,-60),recent=sh.addBusinessCalendarDays(today,-10);
    const put=(col,row)=>{const [y,m]=row.date.split('-').map(Number);const p=w.loadFor('ubon',y,m-1);p[col]=[...(p[col]||[]),row];w.saveFor('ubon',y,m-1,p);};
    const inv=(id,no,date,over={})=>({id,no,branch:'ubon',date,customer:'บริษัท ก',subtotal:1000,vatAmt:70,total:1070,useVat:1,vatMode:'add',paymentManaged:true,items:[{product:'X',qty:1,priceUnit:1000}],...over});
    put('invoices',inv(8101,'INV-T30',old,{creditTerm:'credit30'}));                       // no stored dueDate: due by term, overdue
    put('invoices',inv(8102,'AB-8102',recent,{customer:'ลูกค้าทั่วไป / เงินสด',taxInvoiceForm:'abbreviated',useVat:0,vatMode:'extract',subtotal:500,vatAmt:35,total:535})); // walk-in: due on its date
    put('invoices',inv(8103,'INV-PAID',old,{creditTerm:'credit30'}));
    put('receipts',{id:8104,no:'R-8104',branch:'ubon',date:recent,invoiceId:8103,invNo:'INV-PAID',customer:'บริษัท ก',total:1070});
    put('invoices',inv(8105,'INV-VOID',old,{creditTerm:'credit30',voided:true}));        // voided: not a receivable anywhere
    const banner=w.ERPReceivables.snapshot('').alert;
    assert.equal(banner.overdueCount,2);assert.equal(banner.overdueTotal,1605);
    const ar001=w.ERPDecisionCouncil.run().reviews.find(x=>x.name==='collections').findings.find(x=>x.ruleId==='AR_001');
    assert.ok(ar001,'AR_001 raised');
    assert.match(ar001.summary,new RegExp(`ลูกหนี้เกินกำหนด ${banner.overdueCount} ใบ รวม ฿${banner.overdueTotal.toLocaleString('th-TH')}`));
    // One business()/paymentContext for the whole council snapshot (no storage re-read per invoice).
    const I=w.ERPIntegrity,real=I.business;let calls=0;I.business=(...a)=>{calls+=1;return real(...a);};
    try{w.ERPDecisionCouncil.run();}finally{I.business=real;}
    assert.ok(calls<=1,`council read business() ${calls}×`);
  }finally{h.close();}
});

// ADR-013: a quotation the app already linked to an invoice / production order (its own
// invoiceNo / productionNo stamp, shown as 🚚 / 🏭 in the quote list) is not "ready for a
// Sales Order" — the Decision Council and the role work queue must not list it again.
test('quotes already linked downstream are not listed as ready for a Sales Order',async()=>{
  const {analyzeCouncil,quoteLinkedDownstream}=await core();
  const pe=await import(pathToFileURL(path.resolve(__dirname,'../erp-product-experience-core.js')).href+'?t='+Date.now());
  const s=base();
  s.quotes=[
    {id:'q1',no:'QT1',customer:'A',date:'2026-09-01',approved:true,total:1000,items:[{product:'X',qty:1}],invoiceId:9,invoiceNo:'INV9',invoiceStatus:'created'},
    {id:'q2',no:'QT2',customer:'B',date:'2026-09-01',approved:true,total:2000,items:[{product:'X',qty:1}],productionId:7,productionNo:'PD7'},
    {id:'q3',no:'QT3',customer:'C',date:'2026-09-01',approved:true,total:3000,items:[{product:'X',qty:1}]}
  ];
  assert.deepEqual(s.quotes.map(quoteLinkedDownstream),[true,true,false]);
  const sales=analyzeCouncil(s).reviews.find(x=>x.name==='sales').findings.find(x=>x.ruleId==='SALES_001');
  assert.equal(sales.summary,'1 ใบพร้อมเปลี่ยนเป็น Sales Order');
  assert.deepEqual(sales.evidence,['QT3 · C · ฿3,000.00']); // 2 decimals (round 4)
  const queue=pe.buildWorkQueue({business:{quotes:s.quotes,invoices:[]},flow:{salesOrders:[],billingNotes:[]},ops:{}},{today:'2026-09-07'});
  const toSo=queue.find(x=>x.id==='quote-to-so');
  assert.match(toSo.title,/ยังไม่สร้าง Sales Order 1 ใบ/);
});

test('round4: council money always shows 2 decimals (฿278,260.80, never ฿278,260.8)',async()=>{
  const {analyzeCouncil}=await core();
  const s=base();
  s.invoices=[{id:'i1',no:'INV-A',customer:'A',date:'2026-07-01',dueDate:'2026-07-31',total:278260.8,outstanding:278260.8,overpaid:0,items:[{product:'X',qty:1}]}];
  const ar001=analyzeCouncil(s).reviews.find(x=>x.name==='collections').findings.find(x=>x.ruleId==='AR_001');
  assert.ok(ar001,'AR_001 raised');
  assert.match(ar001.summary,/รวม ฿278,260\.80$/);
  assert.match(ar001.evidence[0],/ค้าง ฿278,260\.80$/);
});
