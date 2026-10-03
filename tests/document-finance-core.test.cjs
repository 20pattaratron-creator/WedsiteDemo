const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
let core;
test.before(async()=>{core=await import(pathToFileURL(path.join(root,'erp-document-finance-core.js')).href+'?t='+Date.now());});

const inv=(over={})=>({id:'I1',no:'INV-1',branch:'ubon',year:2026,month:8,date:'2026-09-01',customer:'ลูกค้า A',subtotal:1000,vatAmt:70,total:1070,outstanding:1070,receiptPaidAtCreation:0,dueDate:'2026-10-01',...over});
const billingInput=(over={})=>({id:'B1',no:'BL-1',billingDate:'2026-09-10',createdAt:'2026-09-10T00:00:00.000Z',invoices:[inv()],requestedAmounts:[1070],existingBillingNotes:[],...over});

test('finance core is pure and does not reference DOM/storage/cloud globals',()=>{const fs=require('node:fs');const s=fs.readFileSync(path.join(root,'erp-document-finance-core.js'),'utf8');assert.doesNotMatch(s,/\bdocument\b|\blocalStorage\b|FirebaseService|\bwindow\b/);});
test('billing action creates collection document only and never creates sales/VAT/stock mutation fields',()=>{const before=inv(),snapshot=structuredClone(before),b=core.buildBillingAction({...billingInput(),invoices:[before]});assert.equal(b.totalBilled,1070);assert.equal(b.status,'draft');assert.equal(b.lines.length,1);for(const forbidden of ['vatAmt','subtotal','saleTotal','items','stockQty','onHand'])assert.equal(Object.hasOwn(b,forbidden),false);assert.deepEqual(before,snapshot);});
test('billing rejects cross-branch or cross-customer invoices',()=>{assert.throws(()=>core.buildBillingAction(billingInput({invoices:[inv(),inv({id:'I2',no:'INV-2',branch:'khonkaen'})],requestedAmounts:[1,1]})),e=>e.code==='validation_error');assert.throws(()=>core.buildBillingAction(billingInput({invoices:[inv(),inv({id:'I2',no:'INV-2',customer:'ลูกค้า B'})],requestedAmounts:[1,1]})),e=>e.code==='validation_error');});
test('billing rejects duplicate invoice and duplicate billing number',()=>{assert.throws(()=>core.buildBillingAction(billingInput({invoices:[inv(),inv()],requestedAmounts:[100,100]})),e=>e.code==='conflict_error');assert.throws(()=>core.buildBillingAction(billingInput({existingBillingNotes:[{id:'OLD',no:'BL-1',status:'draft',lines:[]}]})),e=>e.code==='conflict_error');});
test('billing refuses amount above invoice outstanding',()=>{assert.throws(()=>core.buildBillingAction(billingInput({invoices:[inv({outstanding:300})],requestedAmounts:[301]})),/เกินยอดคงค้าง/);});
test('billing refuses invoice already in an active billing note',()=>{const old={id:'B0',no:'OLD',status:'draft',lines:[{invoiceId:'I1',invoiceNo:'INV-1',branch:'ubon'}]};assert.throws(()=>core.buildBillingAction(billingInput({existingBillingNotes:[old]})),e=>e.code==='conflict_error');});
test('payment allocation is FIFO and never mutates invoice monetary totals',()=>{const a=inv(),b=inv({id:'I2',no:'INV-2',outstanding:500,total:500,subtotal:467.29,vatAmt:32.71});const before=[structuredClone(a),structuredClone(b)];const billing=core.buildBillingAction(billingInput({invoices:[a,b],requestedAmounts:[1070,500]}));const plan=core.planBillingPaymentAction({billing,invoiceStates:[a,b],existingPayments:[],amount:1200,id:'P1',no:'PAY-1',date:'2026-09-11',method:'โอนเงิน',createdAt:'2026-09-11T00:00:00.000Z'});assert.deepEqual(plan.payment.allocations.map(x=>x.amount),[1070,130]);assert.equal(a.total,before[0].total);assert.equal(a.subtotal,before[0].subtotal);assert.equal(a.vatAmt,before[0].vatAmt);assert.equal(b.total,before[1].total);});
test('payment refuses over-collection and duplicate payment number',()=>{const billing=core.buildBillingAction(billingInput());assert.throws(()=>core.planBillingPaymentAction({billing,invoiceStates:[inv()],existingPayments:[],amount:1071,id:'P1',no:'P1',date:'2026-09-11'}),e=>e.code==='conflict_error');assert.throws(()=>core.planBillingPaymentAction({billing,invoiceStates:[inv()],existingPayments:[{no:'P1'}],amount:100,id:'P2',no:'P1',date:'2026-09-11'}),e=>e.code==='conflict_error');});
test('payment status patch follows outstanding without rewriting billing total',()=>{const billing=core.buildBillingAction(billingInput());const total=billing.totalBilled;const part=core.planBillingPaymentAction({billing,invoiceStates:[inv()],existingPayments:[],amount:300,id:'P1',no:'P1',date:'2026-09-11'});assert.equal(part.billingPatch.status,'partially_paid');assert.equal(part.billingPatch.outstandingAmount,770);assert.equal(billing.totalBilled,total);const full=core.planBillingPaymentAction({billing:{...billing,outstandingAmount:1070},invoiceStates:[inv()],existingPayments:[],amount:1070,id:'P2',no:'P2',date:'2026-09-11'});assert.equal(full.billingPatch.status,'paid');assert.equal(full.billingPatch.outstandingAmount,0);});
test('receipt drafts preserve proportional VAT split for partial payment',()=>{const payment={id:'P1',no:'PAY-1',date:'2026-09-11',method:'โอนเงิน',allocations:[{invoiceId:'I1',invoiceNo:'INV-1',branch:'ubon',amount:535}]};const r=core.buildPaymentReceiptDrafts({payment,invoiceStates:[inv()],receiptPrefix:'REC6909',startingSequence:0,idSeed:100,year:2026,month:8,createdAt:'2026-09-11T00:00:00.000Z'}).receipts[0];assert.equal(r.subtotal,500);assert.equal(r.vatAmt,35);assert.equal(r.total,535);});
test('receipt draft builder rejects mixed branches',()=>{const payment={id:'P1',no:'PAY-1',date:'2026-09-11',allocations:[{invoiceId:'I1',branch:'ubon',amount:1},{invoiceId:'I2',branch:'khonkaen',amount:1}]};assert.throws(()=>core.buildPaymentReceiptDrafts({payment,invoiceStates:[inv(),inv({id:'I2',branch:'khonkaen'})],receiptPrefix:'REC',year:2026,month:8}),e=>e.code==='validation_error');});
test('payment receipt replay is idempotent when evidence matches exactly',()=>{const payment={id:'P1',allocations:[{invoiceId:'I1',invoiceNo:'INV-1',branch:'ubon',amount:535}]};const rows=[{id:'R1',paymentId:'P1',invoiceId:'I1',invNo:'INV-1',invoiceBranch:'ubon',receivedAmount:535}];assert.deepEqual(core.assertIdempotentPaymentReceipts(payment,rows),rows);});
test('partial or mismatched prior payment receipts fail closed',()=>{const payment={id:'P1',allocations:[{invoiceId:'I1',branch:'ubon',amount:500},{invoiceId:'I2',branch:'ubon',amount:200}]};assert.throws(()=>core.assertIdempotentPaymentReceipts(payment,[{paymentId:'P1',invoiceId:'I1',invoiceBranch:'ubon',receivedAmount:500}]),e=>e.code==='conflict_error');assert.throws(()=>core.assertIdempotentPaymentReceipts({id:'P1',allocations:[{invoiceId:'I1',branch:'ubon',amount:500}]},[{paymentId:'P1',invoiceId:'I1',invoiceBranch:'ubon',receivedAmount:499}]),e=>e.code==='conflict_error');});
test('order-flow routes billing and payment writes through the finance action core',()=>{const fs=require('node:fs');const s=fs.readFileSync(path.join(root,'erp-order-flow.js'),'utf8');assert.match(s,/import \{ buildBillingAction, planBillingPaymentAction \} from '\.\/erp-document-finance-core\.js'/);assert.match(s,/function saveBilling\([\s\S]*?buildBillingAction\(/);assert.match(s,/function saveBillingPayment\([\s\S]*?planBillingPaymentAction\(/);assert.match(s,/loadStoreForFinancialWrite\(\)/);});
test('receipt persistence delegates draft creation and replay protection to finance core',()=>{const fs=require('node:fs');const s=fs.readFileSync(path.join(root,'erp-integrity.js'),'utf8');assert.match(s,/import \{[^}]*buildPaymentReceiptDrafts[^}]*assertIdempotentPaymentReceipts[^}]*parseFinancialDocumentPackForWrite[^}]*\} from '\.\/erp-document-finance-core\.js'/);assert.match(s,/function createPaymentReceipts\([\s\S]*?assertIdempotentPaymentReceipts\(/);assert.match(s,/function createPaymentReceipts\([\s\S]*?buildPaymentReceiptDrafts\(/);});


test('financial pack parser is strict for write paths and never turns corrupt JSON into empty data',()=>{
  assert.deepEqual(core.parseFinancialDocumentPackForWrite(null).invoices,[]);
  assert.throws(()=>core.parseFinancialDocumentPackForWrite('{bad json'),e=>e.code==='storage_error');
  assert.throws(()=>core.parseFinancialDocumentPackForWrite(JSON.stringify({invoices:{}})),e=>e.code==='storage_error');
  const pack=core.parseFinancialDocumentPackForWrite(JSON.stringify({invoices:[{id:'A'}],custom:'kept'}));assert.equal(pack.invoices.length,1);assert.equal(pack.custom,'kept');
});

test('new invoice action starts with pending settlement state and does not trust form paid flags',()=>{
  const draft={...inv(),items:[{product:'สินค้า',productCode:'P1',qty:1,priceUnit:1000,saleTotal:1000,costTotal:600}],paid:true,isPaid:true,paymentStatus:'paid'};
  const plan=core.planInvoiceDocumentAction({draft});assert.equal(plan.mode,'create');assert.equal(plan.record.paid,false);assert.equal(plan.record.isPaid,false);assert.equal(plan.record.paymentStatus,'pending');assert.equal(plan.record.outstandingAmount,1070);
});

test('invoice duplicate number is a conflict before persistence',()=>{assert.throws(()=>core.planInvoiceDocumentAction({draft:{...inv(),items:[{product:'สินค้า',qty:1}]},duplicateNumber:true}),e=>e.code==='conflict_error');});

test('paid invoice blocks financial edits but allows metadata-only edits and preserves settlement',()=>{
  const original={...inv(),items:[{product:'สินค้า',productCode:'P1',qty:1,priceUnit:1000,saleTotal:1000,costTotal:600}],paymentStatus:'partially_paid',paid:false,isPaid:false,paidAmount:300,outstandingAmount:770,paymentManaged:true,note:'old'};
  assert.throws(()=>core.planInvoiceDocumentAction({draft:{...original,total:1200,subtotal:1121.5,vatAmt:78.5},original,paymentSummary:{paid:300}}),e=>e.code==='conflict_error');
  const ok=core.planInvoiceDocumentAction({draft:{...original,note:'new note',paidAmount:0,paymentStatus:'pending'},original,paymentSummary:{paid:300}}).record;
  assert.equal(ok.note,'new note');assert.equal(ok.paidAmount,300);assert.equal(ok.outstandingAmount,770);assert.equal(ok.paymentStatus,'partially_paid');
});

test('unpaid invoice edit can change financial values while preserving lineage',()=>{
  const original={...inv(),items:[{product:'สินค้า',qty:1,priceUnit:1000,saleTotal:1000}],sourceProductionId:'P1',sourceQuoteNo:'Q1',paymentStatus:'pending',paymentManaged:true};
  const out=core.planInvoiceDocumentAction({draft:{...original,total:1200,subtotal:1121.5,vatAmt:78.5,sourceProductionId:'HACK'},original,paymentSummary:{paid:0}}).record;
  assert.equal(out.total,1200);assert.equal(out.sourceProductionId,'P1');assert.equal(out.sourceQuoteNo,'Q1');
});


const quoteDraft=(over={})=>({id:'Q1',no:'QT-1',date:'2026-09-14',branch:'ubon',customer:'ลูกค้า A',customerAddress:'123 ถนนตัวอย่าง',customerTaxId:'0000000000000',items:[{product:'สินค้า A',productCode:'P1',qty:2,unit:'ชิ้น',priceUnit:500,total:1000}],subtotal:1000,useVat:1,vatMode:'add',vatAmt:70,total:1070,approved:false,note:'เดิม',...over});

test('new quotation action validates duplicate number and returns a clean create plan',()=>{
  assert.throws(()=>core.planQuoteDocumentAction({draft:quoteDraft(),duplicateNumber:true}),e=>e.code==='conflict_error');
  const out=core.planQuoteDocumentAction({draft:quoteDraft()});
  assert.equal(out.kind,'quote');assert.equal(out.mode,'create');assert.equal(out.record.total,1070);assert.equal(out.record.approved,false);
});

test('approved quotation blocks commercial edits but allows safe metadata changes',()=>{
  const original=quoteDraft({approved:true,approvedAt:'2026-09-14T08:00:00.000Z',approvedBy:'manager@example.com'});
  assert.throws(()=>core.planQuoteDocumentAction({draft:{...original,total:1200,subtotal:1121.5,vatAmt:78.5},original}),e=>e.code==='conflict_error');
  const ok=core.planQuoteDocumentAction({draft:{...original,note:'แก้หมายเหตุ',contact:'คุณทดสอบ',approved:false},original}).record;
  assert.equal(ok.note,'แก้หมายเหตุ');assert.equal(ok.contact,'คุณทดสอบ');assert.equal(ok.approved,true);assert.equal(ok.approvedAt,'2026-09-14T08:00:00.000Z');assert.equal(ok.approvedBy,'manager@example.com');
});

test('linked quotation blocks commercial edits and preserves downstream lineage',()=>{
  const original=quoteDraft({productionId:'P1',productionNo:'PR-1',productionStatus:'created',workflowUpdatedAt:'2026-09-14T09:00:00.000Z'});
  assert.throws(()=>core.planQuoteDocumentAction({draft:{...original,customer:'ลูกค้า B'},original,linkedDownstream:true}),e=>e.code==='conflict_error');
  const ok=core.planQuoteDocumentAction({draft:{...original,note:'safe edit',productionId:'HACK'},original,linkedDownstream:true}).record;
  assert.equal(ok.note,'safe edit');assert.equal(ok.productionId,'P1');assert.equal(ok.productionNo,'PR-1');assert.equal(ok.productionStatus,'created');
});

test('quotation commercial fingerprint treats legal customer and line changes as material',()=>{
  const base=quoteDraft();
  assert.notEqual(core.quoteCommercialFingerprint(base),core.quoteCommercialFingerprint({...base,customerTaxId:'1111111111111'}));
  assert.notEqual(core.quoteCommercialFingerprint(base),core.quoteCommercialFingerprint({...base,items:[{...base.items[0],qty:3,total:1500}],subtotal:1500,vatAmt:105,total:1605}));
  assert.equal(core.quoteCommercialFingerprint(base),core.quoteCommercialFingerprint({...base,note:'new note',phone:'0999999999'}));
});

test('app routes quotation writes through strict storage and central action runner',()=>{
  const fs=require('node:fs');const s=fs.readFileSync(path.join(root,'app.js'),'utf8');
  assert.match(s,/import \{[^}]*planQuoteDocumentAction[^}]*planInvoiceDocumentAction[^}]*runDocumentAction[^}]*\} from '\.\/erp-document-finance-core\.js'/);
  assert.match(s,/function documentNumberExistsForWrite\([\s\S]*?loadForFinancialDocumentWrite\(/);
  assert.match(s,/async function saveQuoteUnlocked\([\s\S]*?runDocumentAction\([\s\S]*?planQuoteDocumentAction\(/);
  assert.match(s,/async function commitDocumentEdit\([\s\S]*?findLocalRecordForDocumentWrite\(/);
});



const productionDraft=(over={})=>({
  id:'P1',no:'PR-1',date:'2026-09-14',branch:'ubon',maker:'ผู้ผลิต A',makerAddress:'1 ถนนตัวอย่าง',makerTaxId:'0000000000000',customer:'ลูกค้า A',job:'งาน A',
  items:[{product:'สินค้า A',productCode:'SKU-A',qty:2,unit:'ชิ้น',costMode:'unit',costValue:200,costTotal:400,saleValue:500,priceUnit:500,saleTotal:1000,fulfillmentType:'production'}],
  costSubtotal:400,costVatAmt:28,costGrandTotal:428,costTotal:400,itemSaleTotal:1000,saleTotal:1000,subtotal:1000,useVat:1,vatMode:'add',vatAmt:70,total:1070,
  commMode:'percent',commRate:0,commAmt:0,deliveryLeadDays:7,deliveryDueDate:'2026-09-21',supplierCreditTerm:'credit30',supplierDueDate:'2026-10-21',supplierPaymentStatus:'pending',supplierPaymentNote:'',
  sourceQuoteId:'Q1',sourceQuoteNo:'QT-1',sourceQuoteBranch:'ubon',sourceQuoteYear:2026,sourceQuoteMonth:8,sourceSalesOrderId:'SO1',invoiceStatus:'pending',invoiceId:'',invoiceNo:'',note:'เดิม',...over
});

test('new production action rejects duplicate number before persistence',()=>{
  assert.throws(()=>core.planProductionDocumentAction({draft:productionDraft(),duplicateNumber:true}),e=>e.code==='conflict_error');
  const out=core.planProductionDocumentAction({draft:productionDraft()});
  assert.equal(out.kind,'production');assert.equal(out.mode,'create');assert.equal(out.record.total,1070);
});

test('invoice-linked production blocks commercial edits but allows safe metadata and preserves lineage',()=>{
  const original=productionDraft({invoiceStatus:'created',invoiceId:'I1',invoiceNo:'INV-1',supplierPaymentStatus:'partial',supplierPaidAt:'2026-09-14T08:00:00.000Z',supplierPaidBy:'buyer@example.com'});
  assert.throws(()=>core.planProductionDocumentAction({draft:{...original,costTotal:500,costSubtotal:500,costGrandTotal:535},original}),e=>e.code==='conflict_error');
  const ok=core.planProductionDocumentAction({draft:{...original,note:'แก้หมายเหตุ',supplierPaymentStatus:'pending',supplierPaidAt:'',supplierPaidBy:'',invoiceId:'HACK',sourceQuoteId:'HACK'},original}).record;
  assert.equal(ok.note,'แก้หมายเหตุ');assert.equal(ok.invoiceId,'I1');assert.equal(ok.invoiceNo,'INV-1');assert.equal(ok.sourceQuoteId,'Q1');assert.equal(ok.supplierPaymentStatus,'partial');assert.equal(ok.supplierPaidBy,'buyer@example.com');
});

test('supplier-settled production is commercially immutable even before invoice',()=>{
  const original=productionDraft({supplierPaymentStatus:'paid',supplierPaidAt:'2026-09-20T08:00:00.000Z',supplierPaidBy:'ap@example.com'});
  assert.throws(()=>core.planProductionDocumentAction({draft:{...original,maker:'ผู้ผลิต B'},original}),e=>e.code==='conflict_error');
  const ok=core.planProductionDocumentAction({draft:{...original,note:'เพิ่มเลขพัสดุ',supplierPaymentStatus:'pending'},original}).record;
  assert.equal(ok.note,'เพิ่มเลขพัสดุ');assert.equal(ok.supplierPaymentStatus,'paid');
});

test('unlinked unpaid production may change commercial values but preserves source lineage and settlement ownership',()=>{
  const original=productionDraft();
  const out=core.planProductionDocumentAction({draft:{...original,costTotal:450,costSubtotal:450,costGrandTotal:481.5,sourceQuoteId:'OTHER',sourceSalesOrderId:'OTHER',supplierPaymentStatus:'paid'},original}).record;
  assert.equal(out.costTotal,450);assert.equal(out.sourceQuoteId,'Q1');assert.equal(out.sourceSalesOrderId,'SO1');assert.equal(out.supplierPaymentStatus,'pending');
});

test('production commercial fingerprint detects item cost and supplier term changes but ignores notes',()=>{
  const base=productionDraft();
  assert.notEqual(core.productionCommercialFingerprint(base),core.productionCommercialFingerprint({...base,items:[{...base.items[0],qty:3,costTotal:600,saleTotal:1500}],costTotal:600,total:1605}));
  assert.notEqual(core.productionCommercialFingerprint(base),core.productionCommercialFingerprint({...base,supplierCreditTerm:'credit60',supplierDueDate:'2026-11-20'}));
  assert.equal(core.productionCommercialFingerprint(base),core.productionCommercialFingerprint({...base,note:'safe',supplierPaymentNote:'ติดตามแล้ว'}));
});

test('app routes production create/edit through strict document storage, action runner and rollback-capable write session',()=>{
  const fs=require('node:fs');const s=fs.readFileSync(path.join(root,'app.js'),'utf8');
  assert.match(s,/import \{[^}]*planProductionDocumentAction[^}]*runDocumentAction[^}]*\} from '\.\/erp-document-finance-core\.js'/);
  assert.match(s,/function findLocalRecordForDocumentWrite\([\s\S]*?\['quotes','invoices','receipts','productions'\]/);
  assert.match(s,/async function saveProductionUnlocked\([\s\S]*?runDocumentAction\([\s\S]*?planProductionDocumentAction\(/);
  assert.match(s,/async function saveProductionUnlocked\([\s\S]*?createFinancialDocumentWriteSession\(\)[\s\S]*?writeSession\.commit\(\)/);
  assert.match(s,/async function saveProduction\(\)[\s\S]*?withDemoWriteLease\('production',saveProductionUnlocked\)/);
  assert.match(s,/async function saveProductionUnlocked\([\s\S]*?ERPOrderFlow\?\.getStoreForFinancialWrite/);
  assert.match(s,/async function updateProductionSupplierPaymentStatus\([\s\S]*?loadForFinancialDocumentWrite\(/);
});

const manualReceipt=(over={})=>({id:'R1',no:'REC-1',date:'2026-09-12',branch:'ubon',customer:'ลูกค้า A',invNo:'INV-1',invoiceId:'I1',invoiceBranch:'ubon',invoiceYear:2026,invoiceMonth:8,items:[{product:'รับชำระ',qty:1,priceUnit:300,saleTotal:300}],subtotal:280.37,vatAmt:19.63,total:300,saleTotal:300,...over});

test('receipt overpayment and reference mismatch fail before persistence',()=>{
  assert.throws(()=>core.planReceiptDocumentAction({draft:manualReceipt({total:800,saleTotal:800}),referenceInvoice:inv(),paymentSummary:{outstanding:770}}),e=>e.code==='conflict_error');
  assert.throws(()=>core.planReceiptDocumentAction({draft:manualReceipt({customer:'ลูกค้า B'}),referenceInvoice:inv(),paymentSummary:{outstanding:770}}),e=>e.code==='conflict_error');
  assert.throws(()=>core.planReceiptDocumentAction({draft:manualReceipt({invoiceBranch:'khonkaen'}),referenceInvoice:inv(),paymentSummary:{outstanding:770}}),e=>e.code==='conflict_error');
});

test('receipt with an explicit missing invoice fails closed with dependency_error',()=>{assert.throws(()=>core.planReceiptDocumentAction({draft:manualReceipt(),referenceInvoice:null,paymentSummary:null}),e=>e.code==='dependency_error');});

test('receipt edit cannot switch invoice reference and payment-generated receipt is immutable here',()=>{
  const original=manualReceipt();
  assert.throws(()=>core.planReceiptDocumentAction({draft:manualReceipt({invoiceId:'I2',invNo:'INV-2'}),original,referenceInvoice:inv({id:'I2',no:'INV-2'}),paymentSummary:{outstanding:500}}),e=>e.code==='conflict_error');
  assert.throws(()=>core.planReceiptDocumentAction({draft:manualReceipt(),original:{...original,paymentId:'PAY1'},referenceInvoice:inv(),paymentSummary:{outstanding:770}}),e=>e.code==='permission_error');
});

test('receipt edit keeps original reference fields even when metadata changes',()=>{
  const original=manualReceipt(),draft={...original,note:'แก้หมายเหตุ'};
  const out=core.planReceiptDocumentAction({draft,original,referenceInvoice:inv(),paymentSummary:{outstanding:1070}}).record;
  assert.equal(out.note,'แก้หมายเหตุ');assert.equal(out.invoiceId,'I1');assert.equal(out.invNo,'INV-1');assert.equal(out.invoiceBranch,'ubon');
});

test('app routes invoice and receipt writes through strict financial boundary and central action runner',()=>{
  const fs=require('node:fs');const s=fs.readFileSync(path.join(root,'app.js'),'utf8');
  assert.match(s,/import \{[^}]*planInvoiceDocumentAction[^}]*planReceiptDocumentAction[^}]*runDocumentAction[^}]*documentActionFeedback[^}]*\} from '\.\/erp-document-finance-core\.js'/);
  assert.match(s,/function loadForFinancialDocumentWrite\([\s\S]*?parseFinancialDocumentPackForWrite/);
  assert.match(s,/async function saveInvoiceUnlocked\([\s\S]*?runDocumentAction\([\s\S]*?planInvoiceDocumentAction\(/);
  assert.match(s,/async function saveReceiptUnlocked\([\s\S]*?runDocumentAction\([\s\S]*?planReceiptDocumentAction\(/);
  assert.match(s,/function notifyDocumentActionResult\([\s\S]*?documentActionFeedback\(/);
  assert.match(s,/function locateInvoiceReferenceForWrite\([\s\S]*?loadForFinancialDocumentWrite\(/);
});

test('payment reconciliation persists all settlement mutations through rollback-capable transaction',()=>{
  const fs=require('node:fs');const s=fs.readFileSync(path.join(root,'erp-integrity.js'),'utf8');
  const block=/function reconcilePayments\(\) \{([\s\S]*?)\n  \}\n  function assertEditable/.exec(s)?.[1]||'';
  assert.match(block,/writes=\[\]/);assert.match(block,/transaction\(writes\)/);assert.doesNotMatch(block,/localStorage\.setItem/);
});

test('document action runner returns typed validation failure without committing',async()=>{
  let committed=false;
  const result=await core.runDocumentAction({
    action:'invoice_create',
    validate:()=>{throw new core.FinanceActionError(core.FINANCE_ACTION_ERROR_CODES.VALIDATION,'ข้อมูลไม่ครบ');},
    commit:()=>{committed=true;}
  });
  assert.equal(result.ok,false);assert.equal(result.code,'validation_error');assert.equal(result.stage,'validate');assert.equal(result.committed,false);assert.equal(committed,false);
});

test('document action runner distinguishes commit failure from after-commit failure',async()=>{
  const commitFail=await core.runDocumentAction({action:'receipt_create',validate:()=>({id:1}),plan:v=>v,commit:()=>{throw new core.FinanceActionError(core.FINANCE_ACTION_ERROR_CODES.STORAGE,'เขียนข้อมูลไม่ได้');}});
  assert.equal(commitFail.ok,false);assert.equal(commitFail.stage,'commit');assert.equal(commitFail.committed,false);assert.equal(commitFail.code,'storage_error');

  const afterFail=await core.runDocumentAction({action:'receipt_create',validate:()=>({id:1}),plan:v=>v,commit:v=>v,afterCommit:()=>{throw new Error('render failed');}});
  assert.equal(afterFail.ok,false);assert.equal(afterFail.stage,'after_commit');assert.equal(afterFail.committed,true);assert.equal(afterFail.code,'unknown_error');
});

test('document action error normalizer recognizes quota failures as storage_error',()=>{
  const error=Object.assign(new Error('quota full'),{name:'QuotaExceededError'});
  const normalized=core.normalizeDocumentActionError(error,{action:'invoice_create',stage:'commit'});
  assert.equal(normalized.code,'storage_error');assert.equal(normalized.action,'invoice_create');assert.equal(normalized.stage,'commit');
});

test('document action feedback is actionable and warns instead of claiming a committed write failed',()=>{
  const blocked=core.documentActionFeedback({ok:false,code:'conflict_error',message:'ยอดเปลี่ยนแล้ว',stage:'plan',committed:false});
  assert.equal(blocked.type,'error');assert.match(blocked.text,/ยอดเปลี่ยนแล้ว/);assert.match(blocked.guidance,/สถานะล่าสุด/);
  const partial=core.documentActionFeedback({ok:false,code:'dependency_error',message:'Cloud unavailable',stage:'after_commit',committed:true});
  assert.equal(partial.type,'warning');assert.match(partial.text,/ข้อมูลหลักถูกบันทึกแล้ว/);
});

test('document action runner propagates values through validate-plan-commit-afterCommit in order',async()=>{
  const order=[];
  const result=await core.runDocumentAction({
    action:'invoice_create',context:{n:0},
    validate:v=>{order.push('validate');return{n:v.n+1};},
    plan:v=>{order.push('plan');return{n:v.n+1};},
    commit:v=>{order.push('commit');return{n:v.n+1};},
    afterCommit:v=>{order.push('after_commit');return{n:v.n+1};}
  });
  assert.equal(result.ok,true);assert.equal(result.value.n,4);assert.deepEqual(order,['validate','plan','commit','after_commit']);
});

const expenseDraft=(over={})=>({
  id:'E1',date:'2026-09-14',branch:'ubon',cat:'ค่าน้ำมันเชื้อเพลิง',vendor:'สถานี A',desc:'เติมน้ำมันรถบริษัท',amount:1070,by:'บัญชี',docType:'receipt_tax_invoice',taxStatus:'received',docNo:'TX-001',purpose:'company',note:'',attachments:[{name:'receipt.jpg',type:'image/jpeg',size:100}],...over
});

test('expense action accepts valid evidence metadata and returns an immutable planning copy',()=>{
  const draft=expenseDraft(),plan=core.planExpenseDocumentAction({draft});
  assert.equal(plan.kind,'expense');assert.equal(plan.mode,'create');assert.equal(plan.record.amount,1070);assert.equal(plan.record.docNo,'TX-001');assert.deepEqual(plan.warnings,[]);
  plan.record.attachments.push({name:'later.pdf'});assert.equal(draft.attachments.length,1);
});

test('expense action validates amount, document taxonomy and received tax-document consistency',()=>{
  assert.throws(()=>core.planExpenseDocumentAction({draft:expenseDraft({amount:0})}),e=>e.code==='validation_error');
  assert.throws(()=>core.planExpenseDocumentAction({draft:expenseDraft({docType:'weird'})}),e=>e.code==='validation_error');
  assert.throws(()=>core.planExpenseDocumentAction({draft:expenseDraft({taxStatus:'received',docType:'receipt'})}),e=>e.code==='validation_error');
  assert.throws(()=>core.planExpenseDocumentAction({draft:expenseDraft({taxStatus:'received',docType:'tax_invoice',docNo:''})}),e=>e.code==='validation_error');
  assert.throws(()=>core.planExpenseDocumentAction({draft:expenseDraft({docType:'none',docNo:'SHOULD-NOT-EXIST',taxStatus:'not_required'})}),e=>e.code==='validation_error');
});

test('expense action blocks duplicate vendor document reference before persistence',()=>{
  assert.throws(()=>core.planExpenseDocumentAction({draft:expenseDraft(),duplicateDocument:true}),e=>e.code==='conflict_error');
});

test('expense received tax document may save without an attachment but returns an evidence warning',()=>{
  const plan=core.planExpenseDocumentAction({draft:expenseDraft({attachments:[]})});
  assert.equal(plan.record.attachments.length,0);assert.equal(plan.warnings.length,1);assert.match(plan.warnings[0],/หลักฐาน/);
});

test('app routes expense create through strict storage, action runner, write lease and strict duplicate scan',()=>{
  const fs=require('node:fs');const s=fs.readFileSync(path.join(root,'app.js'),'utf8');
  assert.match(s,/import \{[^}]*planExpenseDocumentAction[^}]*runDocumentAction[^}]*\} from '\.\/erp-document-finance-core\.js'/);
  assert.match(s,/function expenseDocumentExistsForWrite\([\s\S]*?loadForFinancialDocumentWrite\(/);
  assert.match(s,/async function saveExpenseUnlocked\([\s\S]*?runDocumentAction\([\s\S]*?planExpenseDocumentAction\(/);
  assert.match(s,/async function saveExpense\(\)[\s\S]*?withDemoWriteLease\('expense',saveExpenseUnlocked\)/);
  assert.match(s,/async function saveExpenseUnlocked\([\s\S]*?createFinancialDocumentWriteSession\(\)[\s\S]*?writeSession\.commit\(\)/);
});

test('attachment fallback never rewrites financial storage through tolerant loadFor and cloud failure retries local evidence persistence',()=>{
  const fs=require('node:fs');const s=fs.readFileSync(path.join(root,'app.js'),'utf8');
  const fallback=/async function persistAttachmentsLocalFallback\([\s\S]*?\n\}/.exec(s)?.[0]||'';
  assert.match(fallback,/loadForFinancialDocumentWrite\(/);assert.doesNotMatch(fallback,/\bloadFor\(/);
  const cloud=/function saveCloudRecord\([\s\S]*?\n\}/.exec(s)?.[0]||'';
  assert.match(cloud,/\.catch\([\s\S]*?persistAttachmentsLocalFallback\(/);
});


test('issued document canonical guard rejects missing, cancelled, mismatched and accepts faithful snapshots',()=>{
  const canonical={...inv(),items:[{product:'สินค้า',productCode:'P1',unit:'ชิ้น',qty:1,priceUnit:1000}],subtotal:1000,vatAmt:70,total:1070};
  const draft={...canonical,sourceInvoiceId:'I1',sourceInvoiceNo:'INV-1'};
  assert.throws(()=>core.assertIssuedDocumentMatchesCanonical({kind:'invoice',draft,canonical:null}),e=>e.code==='dependency_error');
  assert.throws(()=>core.assertIssuedDocumentMatchesCanonical({kind:'invoice',draft,canonical:{...canonical,cancelled:true}}),e=>e.code==='conflict_error');
  assert.throws(()=>core.assertIssuedDocumentMatchesCanonical({kind:'invoice',draft:{...draft,no:'INV-OTHER'},canonical}),e=>e.code==='conflict_error');
  assert.throws(()=>core.assertIssuedDocumentMatchesCanonical({kind:'invoice',draft:{...draft,date:'2026-09-16'},canonical}),e=>e.code==='conflict_error');
  assert.throws(()=>core.assertIssuedDocumentMatchesCanonical({kind:'invoice',draft:{...draft,branch:'other'},canonical}),e=>e.code==='conflict_error');
  assert.throws(()=>core.assertIssuedDocumentMatchesCanonical({kind:'invoice',draft:{...draft,total:999},canonical}),e=>e.code==='conflict_error');
  assert.throws(()=>core.assertIssuedDocumentMatchesCanonical({kind:'invoice',draft:{...draft,items:[{...draft.items[0],qty:2}]},canonical}),e=>e.code==='conflict_error');
  assert.equal(core.assertIssuedDocumentMatchesCanonical({kind:'invoice',draft,canonical}),canonical);
});

test('issued receipt canonical guard keeps source invoice identity stable',()=>{
  const canonical={id:'R1',no:'REC-1',branch:'ubon',customer:'ลูกค้า A',invoiceId:'I1',invNo:'INV-1',invoiceBranch:'ubon',items:[{product:'สินค้า',productCode:'P1',unit:'ชิ้น',qty:1,priceUnit:535}],subtotal:500,vatAmt:35,total:535};
  const draft={...canonical,sourceReceiptId:'R1',sourceReceiptNo:'REC-1'};
  assert.equal(core.assertIssuedDocumentMatchesCanonical({kind:'receipt',draft,canonical}),canonical);
  assert.throws(()=>core.assertIssuedDocumentMatchesCanonical({kind:'receipt',draft:{...draft,invoiceId:'I2',invNo:'INV-2'},canonical}),e=>e.code==='conflict_error');
});

test('sync errors have a dedicated actionable classification and preserve committed-warning semantics',async()=>{
  const result=await core.runDocumentAction({action:'issued_invoice_save',commit:()=>({ok:true}),afterCommit:()=>{throw new core.FinanceActionError(core.FINANCE_ACTION_ERROR_CODES.SYNC,'Firebase unavailable');}});
  assert.equal(result.ok,false);assert.equal(result.code,'sync_error');assert.equal(result.stage,'after_commit');assert.equal(result.committed,true);
  const feedback=core.documentActionFeedback(result);assert.equal(feedback.type,'warning');assert.match(feedback.text,/ข้อมูลหลักถูกบันทึกแล้ว/);assert.match(feedback.guidance,/Cloud|เครือข่าย/);
});

test('issued Delivery/Tax and Receipt saves use strict transactional document boundary and never re-settle payment',()=>{
  const fs=require('node:fs');
  const delivery=fs.readFileSync(path.join(root,'delivery-tax-document.js'),'utf8');
  const receipt=fs.readFileSync(path.join(root,'receipt-document.js'),'utf8');
  const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
  assert.match(app,/window\.ComformDocumentWriteStore\s*=\s*Object\.freeze\(\{[\s\S]*?createSession:\s*createFinancialDocumentWriteSession/);
  for(const [name,src] of [['delivery',delivery],['receipt',receipt]]){
    assert.match(src,/import \{[^}]*runDocumentAction[^}]*documentActionFeedback[^}]*assertIssuedDocumentMatchesCanonical[^}]*\} from '\.\/erp-document-finance-core\.js'/,name);
    const block=/async function saveDocumentToSystem\(button\) \{([\s\S]*?)\n\}\n\nfunction createOffscreenPages/.exec(src)?.[1]||'';
    assert.match(block,/runDocumentAction\(/,name);
    assert.match(block,/ComformDocumentWriteStore[\s\S]*?store\?\.createSession/,name);
    assert.match(block,/writeSession\.commit\(\)/,name);
    assert.match(block,/assertIssuedDocumentMatchesCanonical\(/,name);
    assert.doesNotMatch(block,/localStorage\.setItem\(/,name);
  }
  const deliveryBlock=/async function saveDocumentToSystem\(button\) \{([\s\S]*?)\n\}\n\nfunction createOffscreenPages/.exec(delivery)?.[1]||'';
  const receiptBlock=/async function saveDocumentToSystem\(button\) \{([\s\S]*?)\n\}\n\nfunction createOffscreenPages/.exec(receipt)?.[1]||'';
  assert.doesNotMatch(receiptBlock,/markInvoicePaidByReceipt/);
  assert.doesNotMatch(deliveryBlock,/updateBusinessDoc\(\s*['"]productions['"]/);
  assert.match(deliveryBlock,/paymentStatus:\s*ctx\.sourceInvoice\.paymentStatus/);
  assert.match(deliveryBlock,/paidAt:\s*ctx\.sourceInvoice\.paidAt/);
  assert.match(receiptBlock,/paidAt:\s*ctx\.sourceReceipt\.paidAt/);
  assert.doesNotMatch(receiptBlock,/paidAt:[^\n]*new Date\(\)\.toISOString\(\)/);
  assert.match(deliveryBlock,/state\.sourceInvoiceNo && String\(row\.sourceInvoiceNo \|\| row\.no \|\| ''\) === String\(state\.sourceInvoiceNo\)/);
  assert.match(receiptBlock,/state\.sourceReceiptNo && String\(row\.sourceReceiptNo \|\| row\.no \|\| ''\) === String\(state\.sourceReceiptNo\)/);
  assert.doesNotMatch(deliveryBlock,/!state\.sourceInvoiceId && state\.sourceInvoiceNo/);
  assert.doesNotMatch(receiptBlock,/!state\.sourceReceiptId && state\.sourceReceiptNo/);
});
