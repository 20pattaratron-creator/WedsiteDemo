const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const ROOT=path.resolve(__dirname,'..');
const CONTROLLERS=['delivery-tax-document.js','receipt-document.js'];
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const imp=async file=>import(pathToFileURL(path.join(ROOT,file)).href+`?pageHarness=${Date.now()}-${Math.random()}`);

function extractFunctionSource(source,name){
  const marker=new RegExp(`function\\s+${name}\\s*\\(`,'g');
  const match=marker.exec(source);
  assert.ok(match,`Missing function ${name}`);
  const start=match.index;
  const braceStart=source.indexOf('{',match.index);
  assert.ok(braceStart>=0,`Missing opening brace for ${name}`);
  let depth=0;
  let quote='';
  let escaped=false;
  for(let i=braceStart;i<source.length;i+=1){
    const ch=source[i];
    if(quote){
      if(escaped){escaped=false;continue;}
      if(ch==='\\'){escaped=true;continue;}
      if(ch===quote){quote='';continue;}
      continue;
    }
    if(ch==='"'||ch==="'"||ch==='`'){quote=ch;continue;}
    if(ch==='{')depth+=1;
    else if(ch==='}'){
      depth-=1;
      if(depth===0)return source.slice(start,i+1);
    }
  }
  assert.fail(`Missing closing brace for ${name}`);
}

function itemForUnits(units,label='X'){
  const widths={1:1,2:43,3:85,4:127};
  const len=widths[units];
  assert.ok(len,`Unsupported units ${units}`);
  return {productCode:label,product:'x'.repeat(len),unit:'ชิ้น',qty:1,priceUnit:10};
}

async function buildHarness(file,stateItems=[]){
  const shared=await imp('erp-shared-core.js');
  const src=read(file);
  assert.doesNotMatch(src,/^function\s+printableItems\s*\(/m,`${file} must not own printableItems after Step 3B-6`);
  assert.doesNotMatch(src,/^function\s+paginateItems\s*\(/m,`${file} must not own paginateItems after Step 3B-6`);
  assert.match(src,/selectPrintableDocumentItems\s+as\s+printableItems/);
  assert.match(src,/paginateDocumentItems\s+as\s+paginateItems/);

  const pagesSource=extractFunctionSource(src,'documentPagesHtml');
  const pageCalls=[];
  const documentPageHtml=(pageType,pdfMode,pageInfo)=>{
    pageCalls.push({pageType,pdfMode,pageInfo});
    return JSON.stringify({pageType,pdfMode,pageNumber:pageInfo.pageNumber,totalPages:pageInfo.totalPages,isFinalPage:pageInfo.isFinalPage});
  };
  const state={items:stateItems};
  const printableItems=(items=state.items)=>shared.selectPrintableDocumentItems(items);
  const paginateItems=(items=printableItems(state.items),options={})=>shared.paginateDocumentItems(items,{unitsPerPage:8,...options});
  const factory=new Function(
    'state','printableItems','paginateItems','ITEM_UNITS_PER_PAGE','documentPageHtml',
    `${pagesSource}\nreturn {documentPagesHtml};`
  );
  const controllerApi=factory(state,printableItems,paginateItems,8,documentPageHtml);
  return {api:{printableItems,paginateItems,documentPagesHtml:controllerApi.documentPagesHtml},pageCalls};
}

function partitionSignature(pages){
  return pages.map(page=>({
    units:page.usedUnits,
    rows:page.rows.map(row=>({units:row.units,productCode:row.item.productCode,product:row.item.product}))
  }));
}

for(const file of CONTROLLERS){
  test(`${file}: empty rows preserve one printable fallback row and one page`,async()=>{
    const {api}=await buildHarness(file,[]);
    const printable=api.printableItems();
    assert.equal(printable.length,1);
    assert.deepEqual(printable[0],{productCode:'',product:'',unit:'ชิ้น',qty:1,priceUnit:0});
    const pages=api.paginateItems(printable);
    assert.equal(pages.length,1);
    assert.equal(pages[0].usedUnits,1);
    assert.equal(pages[0].rows.length,1);
    assert.equal(pages[0].rows[0].units,1);
  });

  test(`${file}: exactly eight row-units stay on one page and the ninth moves to page two`,async()=>{
    const eight=[itemForUnits(2,'A'),itemForUnits(2,'B'),itemForUnits(2,'C'),itemForUnits(2,'D')];
    const oneMore=[...eight,itemForUnits(1,'E')];
    const h1=await buildHarness(file,eight);
    const p1=h1.api.paginateItems();
    assert.equal(p1.length,1);
    assert.equal(p1[0].usedUnits,8);
    const h2=await buildHarness(file,oneMore);
    const p2=h2.api.paginateItems();
    assert.equal(p2.length,2);
    assert.deepEqual(p2.map(p=>p.usedUnits),[8,1]);
    assert.deepEqual(p2.map(p=>p.rows.length),[4,1]);
  });

  test(`${file}: multiline and long descriptions use the shared row-unit estimator before partitioning`,async()=>{
    const items=[
      {productCode:'M',product:'line 1\nline 2\nline 3',unit:'ชิ้น',qty:1,priceUnit:10},
      itemForUnits(4,'LONG'),
      itemForUnits(2,'WRAP')
    ];
    const {api}=await buildHarness(file,items);
    const pages=api.paginateItems();
    assert.deepEqual(pages.map(p=>p.usedUnits),[7,2]);
    assert.deepEqual(pages[0].rows.map(r=>r.units),[3,4]);
    assert.equal(pages[1].rows[0].units,2);
  });

  test(`${file}: multi-page partitioning never exceeds the eight-unit budget`,async()=>{
    const items=[4,4,3,3,2,2,1,1].map((units,index)=>itemForUnits(units,`P${index+1}`));
    const {api}=await buildHarness(file,items);
    const pages=api.paginateItems();
    assert.ok(pages.length>=3);
    for(const page of pages)assert.ok(page.usedUnits<=8,`page exceeds budget: ${page.usedUnits}`);
    assert.deepEqual(pages.map(p=>p.usedUnits),[8,8,4]);
  });

  test(`${file}: documentPagesHtml marks only the final partition as final page`,async()=>{
    const items=[itemForUnits(4,'A'),itemForUnits(4,'B'),itemForUnits(1,'C')];
    const {api,pageCalls}=await buildHarness(file,items);
    const html=api.documentPagesHtml({id:'original'},true);
    assert.ok(html.length>0);
    assert.equal(pageCalls.length,2);
    assert.deepEqual(pageCalls.map(call=>call.pageInfo.pageNumber),[1,2]);
    assert.deepEqual(pageCalls.map(call=>call.pageInfo.totalPages),[2,2]);
    assert.deepEqual(pageCalls.map(call=>call.pageInfo.isFinalPage),[false,true]);
  });
}

test('Delivery/Tax and Receipt partition signatures remain behaviorally identical for the same rows',async()=>{
  const items=[itemForUnits(2,'A'),itemForUnits(4,'B'),itemForUnits(3,'C'),itemForUnits(1,'D'),itemForUnits(4,'E')];
  const left=await buildHarness('delivery-tax-document.js',items);
  const right=await buildHarness('receipt-document.js',items);
  assert.deepEqual(partitionSignature(left.api.paginateItems()),partitionSignature(right.api.paginateItems()));
});
