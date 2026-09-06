const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'..'),dist=path.join(root,'dist');
async function page({execute=true,breakBoot=false}={}){
 const errors=[],vc=new VirtualConsole();vc.on('error',(...args)=>errors.push(args.join(' ')));vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(fs.readFileSync(dist+'/index.html','utf8'),{url:'https://example.test/demo-repo/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});
 const w=dom.window;w.alert=()=>{};w.confirm=()=>true;w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.ResizeObserver=class{observe(){} disconnect(){}};
 w.indexedDB=new (require('fake-indexeddb').IDBFactory)();w.structuredClone=structuredClone;
 let watchdog;
 const timer=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>{if(ms===8000){watchdog=fn;return 0;}return timer(fn,ms,...args);};
 w.eval(w.document.getElementById('deployment-watchdog').textContent);
 if(breakBoot)w.document.getElementById('q-items-body').remove();
 if(execute){
  const script=w.document.querySelector('script[type="module"][src]');
  const file=script.getAttribute('src').replace(/^\.\//,'');
  const mod=new vm.SourceTextModule(fs.readFileSync(path.join(dist,file),'utf8'),{context:dom.getInternalVMContext(),initializeImportMeta(meta){meta.url=new URL(file,w.location.href).href;}});
  await mod.link(()=>{throw Error('Unexpected external module dependency');});await mod.evaluate();
  await new Promise(r=>setTimeout(r,700));
 }
 return {w,dom,errors,watchdog,close:()=>w.close()};
}
test('compiled ESM bundle starts under repository prefix and can save after delayed wrappers',async()=>{
 const h=await page();try{
  assert.equal(h.w.ComformAppReady,true);assert.deepEqual(h.errors,[]);
  await new Promise(r=>setTimeout(r,1900));
  const w=h.w;const messages=[];w.notify=(...a)=>messages.push(a.join(' '));w.selBr('q','ubon');for(const [id,value] of Object.entries({'q-no':'QT-DEPLOY','q-date':'2026-09-05','q-cust':'ทดสอบ build','q-vat':'1'}))w.document.getElementById(id).value=value;
  w.document.getElementById('q-items-body').innerHTML='';w.addQItem({product:'บริการ',qty:1,priceUnit:100,unit:'ชิ้น'});w.calcQ();await w.saveQuote();
  assert.equal(w.docsForYear('quotes',2026,'ubon').filter(x=>x.no==='QT-DEPLOY').length,1,JSON.stringify({messages,errors:h.errors,tags:Object.keys(w.saveQuote),rows:w.docsForYear('quotes',2026,'ubon')}));assert.deepEqual(h.errors,[]);
 }finally{h.close();}
});
test('all three print forms use emitted CSS and keep a writable popup handle',async()=>{
 const h=await page();try{
  const w=h.w,outputs=[];w.open=(url,target,features)=>{if(/noopener|noreferrer/.test(features||''))return null;const popup={opener:w,document:{write(html){outputs.push({html,popup});},close(){}}};return popup;};
  const row={no:'TEST-PRINT',date:'2026-09-05',customer:'ลูกค้าทดสอบ',branch:'ubon',useVat:1,items:[{product:'งานบริการ',qty:1,priceUnit:100,saleTotal:100}]};
  w.ComformDeliveryTaxDocument.loadFromInvoice(row,{b:'ubon',previewOnly:true});w.ComformDeliveryTaxDocument.print('current');
  w.ComformReceiptDocument.loadFromReceipt(row,{b:'ubon',previewOnly:true});w.ComformReceiptDocument.print('current');
  w.ComformQuotationDocument.loadFromData(row,{b:'ubon',previewOnly:true});w.printQuote('current');
  assert.equal(outputs.length,3);
  for(const {html,popup} of outputs){assert.equal(popup.opener,null);const doc=new JSDOM(html);const url=new URL(doc.window.document.querySelector('link').href);assert.ok(url.pathname.startsWith('/demo-repo/assets/'));assert.ok(fs.existsSync(path.join(dist,url.pathname.replace('/demo-repo/',''))));doc.window.close();}
 }finally{h.close();}
});
test('missing main bundle and stylesheet are reported without application JavaScript',async()=>{
 const h=await page({execute:false});try{
  const script=h.w.document.querySelector('script[type="module"][src]');script.dispatchEvent(new h.w.Event('error'));h.watchdog();
  const box=h.w.document.getElementById('deployment-load-error');assert.ok(box);assert.match(box.textContent,/main-.*\.js/);assert.match(box.textContent,/main-.*\.css/);assert.match(box.textContent,/3\.3\.0/);
  assert.equal(h.w.getComputedStyle(h.w.document.querySelector('.sidebar svg')).width,'18px');
 }finally{h.close();}
});
test('late initialization failure does not report ready',async()=>{
 const h=await page({breakBoot:true});try{assert.equal(h.w.ComformAppReady,false);assert.ok(h.errors.some(x=>x.includes('Comform app boot failed')));assert.ok(h.w.document.getElementById('runtime-status-banner'));}finally{h.close();}
});

// Model the real late Trial decorator around the already-installed health guard.
test('late decorator cannot make single-flight guard block its own first save',async()=>{
 const dom=new JSDOM('<body></body>',{url:'https://erp.test',runScripts:'outside-only'}),w=dom.window;
 let saves=0;const messages=[];w.saveQuote=async()=>++saves;w.notify=(...a)=>messages.push(a.join(' '));
 try{
  w.eval(fs.readFileSync(root+'/local-demo-health.js','utf8'));
  await new Promise(r=>setTimeout(r,750));const previous=w.saveQuote;w.saveQuote=async(...args)=>previous(...args);
  await new Promise(r=>setTimeout(r,450));await w.saveQuote();assert.equal(saves,1);assert.deepEqual(messages,[]);
  await w.saveQuote();assert.equal(saves,1,'immediate duplicate still blocked');
  await new Promise(r=>setTimeout(r,300));await w.saveQuote();assert.equal(saves,2,'subsequent intentional save works');
 }finally{w.close();}
});
