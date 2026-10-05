const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const fs=require('node:fs');
const ROOT=path.resolve(__dirname,'..');
let core;
test.before(async()=>{core=await import(pathToFileURL(path.join(ROOT,'erp-product-experience-core.js')).href+'?v='+Date.now());});

// Single Admin view (ADR-014): one queue for everyone — buildWorkQueue(snapshot, options), no role.
const fullSnapshot={
  business:{quotes:[{id:'q1',no:'QT1',approved:false},{id:'q2',no:'QT2',approved:true}],invoices:[{id:'i1',no:'INV1',outstanding:5000,dueDate:'2026-09-01',creditTerm:30}]},
  flow:{salesOrders:[{id:'so1',sourceQuoteId:'q2',requiredDate:'2026-09-01',items:[{qty:10,stockQty:2,productionQty:0,purchaseQty:0,readyQty:2,deliveredQty:0}]}],billingNotes:[],reservations:[]},
  ops:{purchaseOrders:[{id:'po1',status:'draft',expectedDate:'2026-09-01'}]},
  stock:[{available:-2,reorderPoint:5},{available:1,reorderPoint:5}]
};

test('core has no role concept: no ROLE_CONFIG / normalizeRole exports',()=>{
  assert.equal('ROLE_CONFIG' in core,false);
  assert.equal('normalizeRole' in core,false);
  assert.equal(core.buildWorkQueue.length,0,'both parameters are optional');
});

test('work queue returns every rule item (sales, AR, purchasing, stock together), highest risk first, without role metadata',()=>{
  const queue=core.buildWorkQueue(fullSnapshot,{today:'2026-09-07'});
  assert.deepEqual(queue.map(x=>x.id).sort(),['ar-overdue','billing-pending','order-overdue','order-plan','po-approval','po-overdue','quote-approval','ready-ship','stock-low','stock-negative'].sort());
  assert.equal(queue[0].id,'stock-negative');
  assert.equal(queue[0].severity,'critical');
  const rank={critical:4,high:3,medium:2,low:1,info:0};
  for(let i=1;i<queue.length;i++)assert.ok(rank[queue[i-1].severity]>=rank[queue[i].severity],`${queue[i-1].id} before ${queue[i].id}`);
  for(const item of queue){
    assert.equal('roles' in item,false,item.id);
    assert.ok(item.title&&item.detail&&item.action&&item.panel,item.id);
  }
});

test('work queue reads today from options (second argument)',()=>{
  const before=core.buildWorkQueue(fullSnapshot,{today:'2026-08-15'}).map(x=>x.id);
  assert.ok(!before.includes('ar-overdue'),'invoice due 2026-09-01 is not overdue on 2026-08-15');
  assert.ok(!before.includes('po-overdue'));
  assert.ok(!before.includes('order-overdue'));
  const after=core.buildWorkQueue(fullSnapshot,{today:'2026-09-07'}).map(x=>x.id);
  assert.ok(after.includes('ar-overdue')&&after.includes('po-overdue')&&after.includes('order-overdue'));
  const ar=core.buildWorkQueue(fullSnapshot,{today:'2026-09-07'}).find(x=>x.id==='ar-overdue');
  assert.equal(ar.title,'ลูกหนี้เกินกำหนด 1 ใบ');
  assert.equal(ar.detail,'ยอดคงค้าง 5,000.00 บาท'); // 2 decimals (round 4)
});

test('work queue on empty or partial snapshots',()=>{
  assert.deepEqual(core.buildWorkQueue(),[]);
  assert.deepEqual(core.buildWorkQueue({},{today:'2026-09-07'}),[]);
  assert.deepEqual(core.buildWorkQueue({stock:[{available:0,reorderPoint:0}]},null),[],'no reorder point = no stock item; null options is safe');
  const cancelled={business:{quotes:[{id:'q',approved:false,status:'cancelled'}],invoices:[{id:'i',outstanding:10,dueDate:'2026-01-01',voided:true}]}};
  assert.deepEqual(core.buildWorkQueue(cancelled,{today:'2026-09-07'}),[],'cancelled / voided documents raise no work');
});

// ADR-015 adds the collapsed-sidebar-sections view preference, kept by a reset like the mode.
test('demo reset removes the retired role key and keeps the simple/advanced mode (ADR-014) and collapsed sidebar sections (ADR-015)',async()=>{
  const seed=await import(pathToFileURL(path.join(ROOT,'erp-demo-seed-core.js')).href+'?v='+Date.now());
  const prefix='erp_tenant::customer-showcase-local::';
  const keys=[`${prefix}erp_product_experience_role_v1`,`${prefix}erp_product_experience_mode_v1`,`${prefix}erp_nav_collapsed_sections_v1`];
  assert.deepEqual([...seed.demoResetStorageKeys(keys,'customer-showcase-local')],[`${prefix}erp_product_experience_role_v1`]);
  assert.deepEqual([...seed.DEMO_RESET_KEPT_BASE_KEYS],['erp_product_experience_mode_v1','erp_nav_collapsed_sections_v1','comform_company_profile_v1','comform_company_logo_v1','comform_company_branch_setting_v1','comform_sales_targets_v1','comform_delivery_targets_v2','comform_sales_target_period_overrides_v1','comform_delivery_target_period_overrides_v1']); // + ADR-020 company profile / logo, + ADR-022 branch-count setting (a setting, kept by the reset), + ADR-021 target keys (seeded entries removed separately)
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

test('product UX labels approvals as a demo workflow (not server permission) and the portal as preview',()=>{
  const js=fs.readFileSync(path.join(ROOT,'erp-product-experience.js'),'utf8');
  assert.match(js,/ไม่ใช่สิทธิ์ฝั่ง Server/);assert.doesNotMatch(js,/pe-role-select|ROLE_PANELS|ROLE_CONFIG/);assert.match(js,/CUSTOMER PORTAL PREVIEW/);assert.match(js,/On Hand − Reserved = Available/);assert.match(js,/APPROVAL INBOX/);
});

// Regression (round 3 test-speed work): erp-product-experience.js used
// document.querySelector('label:has(#md-p-flow-type) span'). CSS :has() throws a SyntaxError in
// browsers without :has() support (Firefox < 121, Safari < 15.4, Chrome < 105), which stopped the
// product-experience init, and in jsdom one such query took ~30-70 s per app boot (the main cause of
// the slow suite). Runtime selector calls must not use :has().
test('runtime JS does not pass CSS :has() to selector APIs',()=>{
  const selectorWithHas=/\b(?:querySelector(?:All)?|matches|closest)\(\s*(['"`])(?:(?!\1).)*:has\(/;
  const offenders=fs.readdirSync(ROOT).filter(f=>f.endsWith('.js')).filter(f=>fs.readFileSync(path.join(ROOT,f),'utf8').split('\n').some(line=>selectorWithHas.test(line)));
  assert.deepEqual(offenders,[]);
  assert.equal(selectorWithHas.test(`document.querySelector('label:has(#md-p-flow-type) span')`),true,'the pattern catches the old selector');
});

test('round4: work-queue overdue AR amount always shows 2 decimals',()=>{
  const snap={business:{invoices:[{id:'i1',no:'INV1',outstanding:278260.8,dueDate:'2026-08-01'}]}};
  const item=core.buildWorkQueue(snap,{today:'2026-09-07'}).find(x=>x.id==='ar-overdue');
  assert.ok(item,'ar-overdue item present');
  assert.match(item.detail,/278,260\.80/);
  assert.doesNotMatch(item.detail,/278,260\.8(?!0)/);
});
