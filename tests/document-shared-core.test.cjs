const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const ROOT=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const imp=async f=>import(pathToFileURL(path.join(ROOT,f)).href+'?t='+Date.now()+Math.random());

const CONTROLLERS=['quotation-document.js','delivery-tax-document.js','receipt-document.js'];
const EXTRACTED=['escapeHtml','parseMoney','fmt','formatDate','thaiIntegerText','bahtText','safeFilename','getNestedValue','setNestedValue','resolveStoragePeriod','createDocumentLineItem','estimateDocumentItemRowUnits','calculateDocumentTotals','selectPrintableDocumentItems','paginateDocumentItems'];

test('Step 3B-1 shared document primitives preserve formatting behavior',async()=>{
  const c=await imp('erp-shared-core.js');
  assert.equal(c.SHARED_CORE_VERSION,'1.5.0');
  assert.equal(c.escapeHtml(`<a x='1'>&\"`),'&lt;a x=&#39;1&#39;&gt;&amp;&quot;');
  assert.equal(c.parseMoney('1,234.50'),1234.5);
  assert.equal(c.parseMoney('not-a-number'),0);
  assert.equal(c.fmt(1234.5),'1,234.50');
  assert.equal(c.formatDate('2026-09-14'),'14-09-2569');
  assert.equal(c.formatDate('bad'),'bad');
  assert.equal(c.thaiIntegerText(0),'ศูนย์');
  assert.equal(c.thaiIntegerText(11),'สิบเอ็ด');
  assert.equal(c.thaiIntegerText(21),'ยี่สิบเอ็ด');
  assert.equal(c.thaiIntegerText(1000001),'หนึ่งล้านหนึ่ง');
  assert.equal(c.bahtText(0),'ศูนย์บาทถ้วน');
  assert.equal(c.bahtText(21.25),'ยี่สิบเอ็ดบาทยี่สิบห้าสตางค์');
  assert.equal(c.safeFilename('INV 001/2026?.pdf'),'INV_001_2026_.pdf');
});

test('Step 3B-1 controllers import shared helpers instead of defining local copies',()=>{
  const expected={
    'quotation-document.js':['escapeHtml','fmt','thaiIntegerText','bahtText'],
    'delivery-tax-document.js':EXTRACTED,
    'receipt-document.js':EXTRACTED
  };
  for(const [file,names] of Object.entries(expected)){
    const src=read(file);
    assert.match(src,/from\s+['"]\.\/erp-shared-core\.js['"]/);
    for(const name of names){
      assert.match(src,new RegExp(`\\b${name}\\b`),`${file} should use ${name}`);
      assert.doesNotMatch(src,new RegExp(`^function\\s+${name}\\s*\\(`,'m'),`${file} still defines ${name}`);
    }
  }
});

test('Step 3B-2 generic object and storage-period helpers preserve controller behavior',async()=>{
  const c=await imp('erp-shared-core.js');
  assert.equal(c.getNestedValue({a:{b:0}},'a.b'),0);
  assert.equal(c.getNestedValue({a:{b:false}},'a.b'),false);
  assert.equal(c.getNestedValue({a:null},'a.b'),'');
  assert.equal(c.getNestedValue({},'a.b'),'');

  const nested={};
  c.setNestedValue(nested,'customer.address.city','Bangkok');
  assert.deepEqual(nested,{customer:{address:{city:'Bangkok'}}});
  const replacePrimitive={customer:'legacy'};
  c.setNestedValue(replacePrimitive,'customer.name','Acme');
  assert.deepEqual(replacePrimitive,{customer:{name:'Acme'}});
  const arrayHolder={items:[]};
  c.setNestedValue(arrayHolder,'items.0.name','Item A');
  assert.deepEqual(arrayHolder,{items:[{name:'Item A'}]});

  assert.deepEqual(c.resolveStoragePeriod('2026-09-14',new Date(2030,4,1)),{year:2026,month:8});
  assert.deepEqual(c.resolveStoragePeriod('2569-09-14',new Date(2030,4,1)),{year:2569,month:8});
  assert.deepEqual(c.resolveStoragePeriod('2026-00-14',new Date(2030,4,1)),{year:2030,month:4});
  assert.deepEqual(c.resolveStoragePeriod('',new Date(2030,4,1)),{year:2030,month:4});
});

test('Step 3B-3 line-item primitives preserve delivery/receipt behavior without controller state',async()=>{
  const c=await imp('erp-shared-core.js');
  assert.deepEqual(c.createDocumentLineItem(),{productCode:'',product:'',unit:'ชิ้น',qty:1,priceUnit:0});
  const a=c.createDocumentLineItem(); const b=c.createDocumentLineItem();
  a.product='A'; assert.equal(b.product,'','factory must return a fresh object');
  assert.equal(c.estimateDocumentItemRowUnits({productCode:'P1',product:'สินค้า'}),1);
  assert.equal(c.estimateDocumentItemRowUnits({product:'บรรทัดหนึ่ง\nบรรทัดสอง'}),2);
  assert.equal(c.estimateDocumentItemRowUnits({product:'x'.repeat(43)}),2);
  assert.equal(c.estimateDocumentItemRowUnits({product:'x'.repeat(500)}),4,'legacy cap stays at 4');
  assert.equal(c.estimateDocumentItemRowUnits({product:'x'.repeat(21)},10,3),3,'parameterized helper caps deterministically');
  for(const file of ['delivery-tax-document.js','receipt-document.js']){
    const src=read(file);
    assert.match(src,/createDocumentLineItem\s+as\s+createItem/);
    assert.match(src,/estimateDocumentItemRowUnits\s+as\s+itemRowUnits/);
    assert.doesNotMatch(src,/^function\s+createItem\s*\(/m);
    assert.doesNotMatch(src,/^function\s+itemRowUnits\s*\(/m);
  }
});


test('Step 3B-4 shared totals preserve VAT behavior while removing controller-owned arithmetic',async()=>{
  const c=await imp('erp-shared-core.js');
  const items=[
    {qty:'2',priceUnit:'100'},
    {qty:'1',priceUnit:'50'}
  ];
  assert.deepEqual(c.calculateDocumentTotals(items,{vatNone:true,vatEnabled:true}),{itemTotal:250,subtotal:250,vat:0,grand:250});
  assert.deepEqual(c.calculateDocumentTotals(items,{vatNone:false,vatEnabled:true}),{itemTotal:250,subtotal:250,vat:17.5,grand:267.5});
  assert.deepEqual(c.calculateDocumentTotals(items,{vatNone:false,vatEnabled:false}),{itemTotal:250,subtotal:233.64,vat:16.36,grand:250});
  assert.deepEqual(c.calculateDocumentTotals([{qty:'1,000',priceUnit:'1.005'}],{vatNone:true}),{itemTotal:1005,subtotal:1005,vat:0,grand:1005});
  assert.deepEqual(c.calculateDocumentTotals(null,{vatNone:true}),{itemTotal:0,subtotal:0,vat:0,grand:0});
  for(const file of ['delivery-tax-document.js','receipt-document.js']){
    const src=read(file);
    assert.match(src,/calculateDocumentTotals/);
    assert.doesNotMatch(src,/^function\s+totals\s*\(/m);
    assert.doesNotMatch(src,/calculateVatSummary/);
    assert.match(src,/calculateDocumentTotals\(state\.items,\s*\{\s*vatNone:\s*state\.vatNone,\s*vatEnabled:\s*state\.vatEnabled\s*\}\)/);
  }
});


test('Step 3B-6 shared printable-item and pagination helpers preserve the locked page-partition contract',async()=>{
  const c=await imp('erp-shared-core.js');
  const blank=c.selectPrintableDocumentItems([]);
  assert.deepEqual(blank,[{productCode:'',product:'',unit:'ชิ้น',qty:1,priceUnit:0}]);
  const mixed=[
    {productCode:'',product:'',unit:'ชิ้น',qty:0,priceUnit:0},
    {productCode:'A',product:'Alpha',unit:'ชิ้น',qty:1,priceUnit:10}
  ];
  assert.deepEqual(c.selectPrintableDocumentItems(mixed),[mixed[1]]);
  const item=(units,label)=>({productCode:label,product:'x'.repeat({1:1,2:43,3:85,4:127}[units]),unit:'ชิ้น',qty:1,priceUnit:10});
  const pages=c.paginateDocumentItems([item(4,'A'),item(4,'B'),item(1,'C')],{unitsPerPage:8});
  assert.deepEqual(pages.map(page=>page.usedUnits),[8,1]);
  assert.deepEqual(pages.map(page=>page.rows.length),[2,1]);
  assert.deepEqual(c.paginateDocumentItems([],{unitsPerPage:8}),[{rows:[{item:{productCode:'',product:'',unit:'ชิ้น',qty:1,priceUnit:0},units:1}],usedUnits:1}]);
  for(const file of ['delivery-tax-document.js','receipt-document.js']){
    const src=read(file);
    assert.match(src,/selectPrintableDocumentItems\s+as\s+printableItems/);
    assert.match(src,/paginateDocumentItems\s+as\s+paginateItems/);
    assert.doesNotMatch(src,/^function\s+printableItems\s*\(/m);
    assert.doesNotMatch(src,/^function\s+paginateItems\s*\(/m);
  }
});

test('Step 3C-1 persistence hardening preserves the material controller-duplication reduction',()=>{
  const report=JSON.parse(read('DOCUMENT_CONTROLLER_DUPLICATION_AUDIT_RESULTS.json'));
  assert.ok(report.metrics.exactSameNameFunctionPairs<27,JSON.stringify(report.metrics));
  assert.ok(report.metrics.normalizedDuplicate10LineGroups<275,JSON.stringify(report.metrics));
  assert.equal(report.metrics.exactSameNameFunctionPairs,6);
  // 143 → 140 (ADR-009): delivery-tax-document.js now routes preview/print/PDF
  // through formPagesHtml(), so three 10-line windows no longer match receipt-document.js.
  assert.equal(report.metrics.normalizedDuplicate10LineGroups,140);
  const extracted=new Map(report.boundaryPlan.extractedPureHelpers.map(row=>[row.name,row]));
  for(const name of EXTRACTED){
    const row=extracted.get(name);
    assert.ok(row,`missing extracted helper ${name}`);
    assert.equal(row.sharedCoreExport,true,`${name} not exported by shared core`);
    assert.equal(row.localDefinitions.length,0,`${name} still locally defined in controllers`);
  }
});
