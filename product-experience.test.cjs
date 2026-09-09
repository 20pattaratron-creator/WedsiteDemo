const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const fs=require('node:fs');
const ROOT=path.resolve(__dirname,'..');
let core;
test.before(async()=>{core=await import(pathToFileURL(path.join(ROOT,'erp-product-experience-core.js')).href+'?v='+Date.now());});

test('role normalization is safe',()=>{assert.equal(core.normalizeRole('sales'),'sales');assert.equal(core.normalizeRole('unknown'),'management');});

test('work queue prioritizes operational risks by role',()=>{
  const snapshot={
    business:{quotes:[{id:'q1',no:'QT1',approved:false},{id:'q2',no:'QT2',approved:true}],invoices:[{id:'i1',no:'INV1',outstanding:5000,dueDate:'2026-09-01',creditTerm:30}]},
    flow:{salesOrders:[{id:'so1',sourceQuoteId:'q2',requiredDate:'2026-09-01',items:[{qty:10,stockQty:2,productionQty:0,purchaseQty:0,readyQty:2,deliveredQty:0}]}],billingNotes:[],reservations:[]},
    ops:{purchaseOrders:[{id:'po1',status:'draft',expectedDate:'2026-09-01'}]},
    stock:[{available:-2,reorderPoint:5}]
  };
  const mgmt=core.buildWorkQueue(snapshot,'management',{today:'2026-09-07'});
  assert.equal(mgmt[0].severity,'critical');
  assert.ok(mgmt.some(x=>x.id==='quote-approval'));
  assert.ok(mgmt.some(x=>x.id==='ar-overdue'));
  assert.ok(mgmt.some(x=>x.id==='po-approval'));
  const sales=core.buildWorkQueue(snapshot,'sales',{today:'2026-09-07'});
  assert.ok(sales.some(x=>x.id==='quote-approval'));
  assert.ok(!sales.some(x=>x.id==='po-approval'));
});

test('stock availability calculates on hand reserved available and incoming',()=>{
  const snapshot={products:[{code:'P1',name:'Product 1',flowType:'inventory',fulfillmentType:'stock',reorderPoint:5}],branches:['ubon'],
    flow:{reservations:[{branch:'ubon',productCode:'P1',qty:3,status:'reserved'}]},
    ops:{purchaseOrders:[{id:'po1',branch:'ubon',status:'ordered',items:[{productCode:'P1',product:'Product 1',qty:10}]}],goodsReceipts:[{poId:'po1',branch:'ubon',items:[{productCode:'P1',qty:4}]}]},
    onHand:()=>12};
  const rows=core.buildStockAvailability(snapshot);assert.equal(rows.length,1);assert.equal(rows[0].onHand,12);assert.equal(rows[0].reserved,3);assert.equal(rows[0].available,9);assert.equal(rows[0].incoming,6);
});

test('approval inbox includes pending quotes and draft POs only',()=>{
  const rows=core.approvalRows({business:{quotes:[{id:1,approved:false},{id:2,approved:true}]},ops:{purchaseOrders:[{id:1,status:'draft'},{id:2,status:'ordered'}]}});
  assert.equal(rows.quotes.length,1);assert.equal(rows.purchaseOrders.length,1);
});

test('release wires product UX assets and avoids competitor wording in user UI',()=>{
  const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  const pkg=JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8'));const releaseRx=new RegExp(`erp-demo-build\" content=\"${pkg.erpRelease.replace(/\./g,'\\.')}-source`);assert.match(html,/erp-product-experience\.css/);assert.match(html,/erp-product-experience\.js/);assert.doesNotMatch(html,/FLOWACCOUNT-INSPIRED/);assert.doesNotMatch(html,/ประเภทสินค้าแบบ FlowAccount/);assert.match(html,releaseRx);
});

test('product UX clearly labels role as UX and portal as preview',()=>{
  const js=fs.readFileSync(path.join(ROOT,'erp-product-experience.js'),'utf8');
  assert.match(js,/ไม่ใช่สิทธิ์ฝั่ง Server/);assert.match(js,/CUSTOMER PORTAL PREVIEW/);assert.match(js,/On Hand − Reserved = Available/);assert.match(js,/APPROVAL INBOX/);
});
