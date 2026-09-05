const {boot}=require('./dom-helper.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const inv=(id,no,qty=10)=>({id,no,branch:'ubon',date:'2026-09-05',customer:'ลูกค้าทดสอบ',subtotal:qty*100,total:qty*107,vatAmt:qty*7,useVat:1,vatMode:'add',items:[{product:'สินค้าทดสอบ',productCode:'AUDIT-P',qty,unit:'ชิ้น',priceUnit:100,saleTotal:qty*100,costTotal:0}],paymentManaged:true});
async function scenario(name,fn){test(name,async()=>{const h=await boot();try{const result=await fn(h);assert.deepEqual(h.errors,[]);assert.ok(!result.error,JSON.stringify(result));
 const expected={restore_invoice_bypasses_stock:{stockBefore:0,stockAfter:0,invoiceCount:1},restore_receipt_bypasses_overpayment:{},invoice_edit_leaves_issued_snapshot_stale:{baseTotal:1070,issuedTotal:1070},billing_does_not_close_after_standalone_receipt:{invoiceOutstanding:0,billingStatus:'paid'},sales_order_delivery_ignores_actual_production_cost:{productionCost:600,invoiceCost:600,invoiceProfit:400,dashboardNet:400},goods_receipt_write_failure_leaves_partial_commit:{thrown:'',goodsReceiptCount:0,movementCount:0,onHand:0}}[name];
 for(const [k,v] of Object.entries(expected))assert.equal(result[k],v,k);
 if(result.summary){assert.equal(result.summary.paid,1070);assert.equal(result.summary.overpaid,0);}
 }finally{h.close()}})}
(async()=>{
 await scenario('restore_invoice_bypasses_stock',async({w,set})=>{
  const p={id:'AUDIT-P',code:'AUDIT-P',name:'สินค้าทดสอบ',flowType:'inventory',fulfillmentType:'stock',openingStockUbon:10,unit:'ชิ้น'};w.testApp.restoreLocalMasterBackup({products:[p]});
  let d=w.loadFor('ubon',2026,8);d.invoices=[inv(111,'INV-A')];w.saveFor('ubon',2026,8,d);await w.delDoc('ubon',2026,8,'invoices',111);
  const trash=w.ERPProductionCore.exportData().trash[0];
  w.selBr('i','ubon');set('i-no','INV-B');set('i-date','2026-09-05');set('i-cust','ลูกค้าทดสอบ');w.document.getElementById('i-items-body').innerHTML='';w.addIItem({product:p.name,productCode:p.code,qty:10,priceUnit:100,unit:'ชิ้น'});await w.saveInvoice();
  const stockBefore=w.productEstimatedStock(p,'ubon');await w.pcRestoreTrash(trash.id);
  return {stockBefore,stockAfter:w.productEstimatedStock(p,'ubon'),invoiceCount:w.loadFor('ubon',2026,8).invoices.length,expected:'restore rejected; stock stays 0'};
 });
 await scenario('restore_receipt_bypasses_overpayment',async({w})=>{
  let d=w.loadFor('ubon',2026,8);d.invoices=[inv(111,'INV-A')];d.receipts=[{id:222,no:'R-A',branch:'ubon',date:'2026-09-05',invNo:'INV-A',customer:'ลูกค้าทดสอบ',total:1070}];w.saveFor('ubon',2026,8,d);await w.delDoc('ubon',2026,8,'receipts',222);const trash=w.ERPProductionCore.exportData().trash[0];
  d=w.loadFor('ubon',2026,8);d.receipts.push({id:333,no:'R-B',branch:'ubon',date:'2026-09-05',invNo:'INV-A',customer:'ลูกค้าทดสอบ',total:1070});w.saveFor('ubon',2026,8,d);await w.pcRestoreTrash(trash.id);return {summary:w.ERPIntegrity.paymentSummary(inv(111,'INV-A')),expected:'restore rejected; paid remains 1070'};
 });
 await scenario('invoice_edit_leaves_issued_snapshot_stale',async({w})=>{
  const i=inv(111,'INV-A');i.items[0].productCode='';let d=w.loadFor('ubon',2026,8);d.invoices=[i];d.issuedInvoices=[{...i,id:222,sourceInvoiceId:111,sourceInvoiceNo:i.no}];w.saveFor('ubon',2026,8,d);
  w.editInvoice('ubon',2026,8,111);const price=w.document.querySelector('#i-items-body [data-field="priceUnit"]');
  if(!price)return {error:'price field missing',fields:[...w.document.querySelectorAll('#i-items-body [data-field]')].map(x=>x.dataset.field)};
  price.value=200;w.calcI();await w.saveInvoice();d=w.loadFor('ubon',2026,8);return {baseTotal:d.invoices[0].total,issuedTotal:d.issuedInvoices[0].total,expected:'linked printed data updated, invalidated or edit blocked'};
 });
 await scenario('billing_does_not_close_after_standalone_receipt',async({w})=>{
  const i=inv(111,'INV-A');let d=w.loadFor('ubon',2026,8);d.invoices=[i];d.receipts=[{id:222,no:'R-A',date:'2026-09-05',invNo:i.no,customer:i.customer,total:1070}];w.saveFor('ubon',2026,8,d);
  w.ERPOrderFlow.importData({billingNotes:[{id:'B1',no:'BL-A',branch:'ubon',customer:i.customer,totalBilled:1070,status:'draft',dueDate:'2026-09-01',lines:[{invoiceId:i.id,invoiceNo:i.no,branch:'ubon',billedAmount:1070}]}]});w.ERPIntegrity.reconcilePayments();w.ERPOrderFlow.openTab('billing');
  return {invoiceOutstanding:w.ERPIntegrity.paymentSummary(i).outstanding,billingStatus:w.ERPOrderFlow.getStore().billingNotes[0].status,expected:'billing reflects settled invoices instead of draft/overdue'};
 });

 await scenario('sales_order_delivery_ignores_actual_production_cost',async({w,set})=>{
  const p={id:'AUDIT-P',code:'AUDIT-P',name:'สินค้าทดสอบ',flowType:'non_inventory',fulfillmentType:'made_to_order',standardCost:0,unit:'ชิ้น'};w.testApp.restoreLocalMasterBackup({products:[p]});
  const o={id:'SO-COST',no:'SO-COST',branch:'ubon',customer:'ลูกค้าทดสอบ',vatMode:'add',useVat:1,items:[{id:'L1',product:p.name,productCode:p.code,qty:10,readyQty:10,productionQty:10,priceUnit:100,unit:'ชิ้น'}]};w.ERPOrderFlow.importData({salesOrders:[o]});
  let d=w.loadFor('ubon',2026,8);d.productions=[{id:444,no:'PROD-COST',date:'2026-09-05',sourceSalesOrderId:o.id,costTotal:600,subtotal:1000,total:1070,items:[{product:p.name,productCode:p.code,qty:10,costUnit:60,costTotal:600,priceUnit:100,saleTotal:1000}]}];w.saveFor('ubon',2026,8,d);
  w.ERPOrderFlow.prepareDelivery(o.id);set('i-no','INV-COST');set('i-date','2026-09-05');await w.saveInvoice();const saved=w.loadFor('ubon',2026,8).invoices[0];return {productionCost:600,invoiceCost:saved.costTotal,invoiceProfit:saved.profit,dashboardNet:w.testApp.branchStats('ubon',2026,8).net,expected:'preserve attributable cost or clearly mark profit incomplete'};
 });
 await scenario('goods_receipt_write_failure_leaves_partial_commit',async({w,set})=>{
  const p={id:'AUDIT-P',code:'AUDIT-P',name:'สินค้าทดสอบ',flowType:'inventory',fulfillmentType:'stock',openingStockUbon:0,unit:'ชิ้น'};w.testApp.restoreLocalMasterBackup({products:[p]});w.ERPProductionCore.importData({purchaseOrders:[{id:'PO-AUDIT',no:'PO-AUDIT',branch:'ubon',date:'2026-09-05',supplier:'ผู้จำหน่ายทดสอบ',status:'open',items:[{productCode:p.code,product:p.name,qty:10,unit:'ชิ้น',unitCost:20}]}]});
  w.pcPopulateOpenPo();set('gr-po','PO-AUDIT');w.pcLoadPoForReceipt();set('gr-date','2026-09-05');set('gr-branch','ubon');set('gr-no','GR-AUDIT');w.document.querySelector('#gr-items-body [data-f="receive"]').value=10;
  const proto=w.Storage.prototype,original=proto.setItem;let thrown='';proto.setItem=function(k,v){if(k.endsWith('comform_inventory_movements_v1'))throw Error('Injected storage quota failure');return original.call(this,k,v)};
  try{w.pcPostGoodsReceipt()}catch(e){thrown=e.message}finally{proto.setItem=original}
  const data=w.ERPProductionCore.exportData();return {thrown,goodsReceiptCount:data.goodsReceipts.length,movementCount:data.inventoryMovements.length,onHand:w.productEstimatedStock(p,'ubon'),expected:'all linked records saved together or rolled back together'};
 });

})()
test('valid invoice and receipt restoration succeeds and removes trash entry',async()=>{const h=await boot(),{w}=h;try{const d=w.loadFor('ubon',2026,8);d.invoices=[inv(111,'INV-A')];w.saveFor('ubon',2026,8,d);await w.delDoc('ubon',2026,8,'invoices',111);await w.pcRestoreTrash(w.ERPProductionCore.exportData().trash[0].id);assert.equal(w.loadFor('ubon',2026,8).invoices.length,1);assert.equal(w.ERPProductionCore.exportData().trash.length,0);const pack=w.loadFor('ubon',2026,8);pack.receipts=[{id:222,no:'R-A',invNo:'INV-A',customer:'ลูกค้าทดสอบ',total:300}];w.saveFor('ubon',2026,8,pack);await w.delDoc('ubon',2026,8,'receipts',222);await w.pcRestoreTrash(w.ERPProductionCore.exportData().trash[0].id);assert.equal(w.ERPIntegrity.paymentSummary(inv(111,'INV-A')).paid,300);assert.deepEqual(h.errors,[]);}finally{h.close();}});
for(const failedKey of ['comform_goods_receipts_v1','comform_purchase_orders_v1','comform_audit_log_v1'])test('GR rolls back and can retry after failure at '+failedKey,async()=>{const h=await boot(),{w,set}=h;try{
 const p={id:'AUDIT-P',code:'AUDIT-P',name:'สินค้าทดสอบ',flowType:'inventory',fulfillmentType:'stock',openingStockUbon:0,unit:'ชิ้น'};w.testApp.restoreLocalMasterBackup({products:[p]});w.ERPProductionCore.importData({purchaseOrders:[{id:'PO1',no:'PO1',branch:'ubon',date:'2026-09-05',supplier:'ทดสอบ',status:'ordered',items:[{productCode:p.code,product:p.name,qty:10,unitCost:20}]}]});w.pcPopulateOpenPo();set('gr-po','PO1');w.pcLoadPoForReceipt();set('gr-date','2026-09-05');set('gr-branch','ubon');set('gr-no','GR1');
 const before=JSON.stringify(w.ERPProductionCore.exportData()),proto=w.Storage.prototype,old=proto.setItem;
 try{proto.setItem=function(k,v){if(k.endsWith(failedKey))throw Error('test write failure');return old.call(this,k,v)};w.pcPostGoodsReceipt();}finally{proto.setItem=old;}
 assert.equal(JSON.stringify(w.ERPProductionCore.exportData()),before);w.pcPostGoodsReceipt();const after=w.ERPProductionCore.exportData();assert.equal(after.goodsReceipts.length,1);assert.equal(after.inventoryMovements.length,1);assert.equal(after.purchaseOrders[0].status,'received');assert.equal(w.productEstimatedStock(p,'ubon'),10);assert.deepEqual(h.errors,[]);
 }finally{h.close();}});
test('printed receipt locks its base against edits as well',async()=>{const h=await boot(),{w,set}=h;try{const d=w.loadFor('ubon',2026,8),r={id:222,no:'R1',date:'2026-09-05',invNo:'INV-A',customer:'ลูกค้าทดสอบ',total:107,subtotal:100,useVat:1,items:[{product:'รับชำระ',qty:1,priceUnit:100,saleTotal:100}]};d.invoices=[inv(111,'INV-A')];d.receipts=[r];d.issuedReceipts=[{...r,id:333,sourceReceiptId:r.id}];w.saveFor('ubon',2026,8,d);w.editReceipt('ubon',2026,8,r.id);set('r-cust','ชื่อที่เปลี่ยน');await w.saveReceipt();assert.equal(w.loadFor('ubon',2026,8).receipts[0].customer,'ลูกค้าทดสอบ');assert.ok(w.document.body.textContent.includes('ล็อกการแก้ไข'));assert.deepEqual(h.errors,[]);}finally{h.close();}});
test('unknown SO costs are visibly marked as preliminary',async()=>{const h=await boot(),{w,set}=h;try{const o={id:'SO1',no:'SO1',branch:'ubon',customer:'ลูกค้าทดสอบ',useVat:1,items:[{id:'L1',product:'งานยังไม่มีต้นทุน',qty:1,readyQty:1,productionQty:1,priceUnit:100}]};w.ERPOrderFlow.importData({salesOrders:[o]});w.ERPOrderFlow.prepareDelivery(o.id);assert.equal(w.document.getElementById('i-cost-status').hidden,false);assert.ok(w.document.getElementById('i-cost-status').textContent.includes('กำไรเบื้องต้น'));set('i-no','INV1');set('i-date','2026-09-05');await w.saveInvoice();const i=w.ERPIntegrity.business().invoices[0];assert.equal(i.costReviewRequired,true);assert.equal(i.items[0].costAllocation.basis,'missing');assert.deepEqual(h.errors,[]);}finally{h.close();}});
