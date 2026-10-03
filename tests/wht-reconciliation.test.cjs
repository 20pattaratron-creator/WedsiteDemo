const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {loadEsmLike}=require('./vm-esm-helper.cjs');
const ROOT=path.resolve(__dirname,'..');
const imp=async f=>import(pathToFileURL(path.join(ROOT,f)).href+'?t='+Date.now()+Math.random());

// ---------------------------------------------------------------------------
// Same harness as tests/integrity.test.cjs, for end-to-end reconciliation
// checks that need localStorage + ERPIntegrity + ERPGovernance-free wiring.
// ---------------------------------------------------------------------------
function context(){
  const memory=new Map(),fields=new Map();
  const c={console,Date,Intl,Math,Number,String,Map,Set,JSON,queueMicrotask:()=>{},setTimeout:()=>0,clearTimeout(){},CustomEvent:class{},addEventListener(){},dispatchEvent(){},notify(){},confirm:()=>true,
  localStorage:{getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k),key:i=>[...memory.keys()][i]??null,get length(){return memory.size}},
  document:{readyState:'loading',addEventListener(){},getElementById:id=>fields.get(id)||null,querySelectorAll:()=>[],querySelector:()=>null,body:{classList:{add(){},remove(){}}}},
  ComformTenant:{storageKey:k=>'test::'+k,unwrapStorageKey:k=>k.startsWith('test::')?k.slice(6):'',getActiveTenantId:()=>'test'},memory,fields};
  c.window=c;vm.createContext(c);c.__loadedModules=new Set();
  loadEsmLike(path.join(ROOT,'erp-shared-core.js'),c,c.__loadedModules);
  loadEsmLike(path.join(ROOT,'erp-integrity.js'),c,c.__loadedModules);
  c.put=(k,v)=>c.localStorage.setItem(c.ComformTenant.storageKey(k),JSON.stringify(v));
  c.pack=(d,br='ubon')=>c.put('biz2_'+br+'_2026_09',d);
  c.flow=d=>c.put('example_erp_order_flow_v3',{salesOrders:[],payments:[],billingNotes:[],...d});
  return c;
}
const invoice=(over={})=>({id:'INV1',no:'INV690901',branch:'ubon',customer:'ลูกค้า ก',date:'2026-09-05',subtotal:1000,total:1070,vatAmt:70,useVat:1,items:[{product:'บริการที่ปรึกษา',productCode:'S1',qty:1,priceUnit:1000}],...over});

// ---------------------------------------------------------------------------
// erp-shared-core.js — roundMoneyValue (RD Order Por.86/2542 half-up rule)
// ---------------------------------------------------------------------------
test('roundMoneyValue rounds half-up correctly even when binary floats misrepresent the exact half-satang value',async()=>{
  const c=await imp('erp-shared-core.js');
  // 2.135 is stored as ~2.1349999999999998 in IEEE754 double; a naive
  // Math.round(value*100)/100 rounds this DOWN to 2.13, which is wrong per
  // the Revenue Department's round-half-up rule (the digit after the 2nd
  // decimal is 5, so it must round UP to 2.14).
  assert.equal(c.roundMoneyValue(2.135),2.14);
  assert.equal(c.roundMoneyValue(4.145),4.15);
  assert.equal(c.roundMoneyValue(1.005),1.01);
  // below-half values still round down
  assert.equal(c.roundMoneyValue(2.134),2.13);
  assert.equal(c.roundMoneyValue(2.1349),2.13);
  // ordinary VAT-extraction values used throughout the app remain unaffected
  assert.equal(c.roundMoneyValue(250/1.07),233.64);
  // Math.round() itself always rounds half-way values toward +Infinity (its
  // documented behavior), so a negative half-satang value rounds toward 0 —
  // this matches the pre-existing implementation's sign convention, which
  // this fix intentionally preserves (only the float-noise bug is fixed).
  assert.equal(c.roundMoneyValue(-2.135),-2.13);
});

test('VAT is computed once from the document total, not summed per line (RD-preferred method avoids rounding drift)',async()=>{
  const c=await imp('erp-shared-core.js');
  // 4 lines of 200 baht each, VAT-inclusive pricing, VAT extracted at 7%.
  const items=[{qty:1,priceUnit:200},{qty:1,priceUnit:200},{qty:1,priceUnit:200},{qty:1,priceUnit:200}];
  const totals=c.calculateDocumentTotals(items,{vatEnabled:false,vatNone:false});
  // Per-line calculation would give 4 * round(200*7/107) = 4*13.08 = 52.32.
  // Calculating VAT once on the 800 baht total gives 800*7/107 = 52.34,
  // which is what the Revenue Department prefers.
  assert.equal(totals.vat,52.34);
  assert.notEqual(totals.vat,52.32);
  assert.equal(totals.subtotal+totals.vat,totals.grand);
});

// ---------------------------------------------------------------------------
// erp-shared-core.js — calculateWhtSummary
// ---------------------------------------------------------------------------
test('calculateWhtSummary withholds tax from the pre-VAT base and keeps cash+WHT equal to the settled total',async()=>{
  const c=await imp('erp-shared-core.js');
  // 1,000 baht service fee + 7% VAT = 1,070 total. Customer withholds 3% of
  // the pre-VAT base (30 baht) and pays the seller the remaining 1,040.
  const s=c.calculateWhtSummary(1000,3,1070);
  assert.equal(s.whtRate,3);
  assert.equal(s.whtBase,1000);
  assert.equal(s.whtAmount,30);
  assert.equal(s.cashReceived,1040);
  assert.equal(s.cashReceived+s.whtAmount,s.total);
  assert.equal(s.settledTotal,s.total);
});

test('calculateWhtSummary is a no-op at 0% and never produces negative cash received',async()=>{
  const c=await imp('erp-shared-core.js');
  const zero=c.calculateWhtSummary(1000,0,1070);
  assert.equal(zero.whtAmount,0);
  assert.equal(zero.cashReceived,1070);
  // A pathological 100% rate should still clamp cash received at 0, not go negative.
  const extreme=c.calculateWhtSummary(1000,100,1070);
  assert.ok(extreme.cashReceived>=0);
});

test('WHT_RATE_PRESETS exposes the common Thai withholding rates for the receipt form UI',async()=>{
  const c=await imp('erp-shared-core.js');
  const values=c.WHT_RATE_PRESETS.map(r=>r.value);
  assert.deepEqual(values,[0,1,2,3,5,10]);
});

// ---------------------------------------------------------------------------
// erp-integrity.js — WHT-covered receipts settle invoices in full
// ---------------------------------------------------------------------------
test('a WHT-covered receipt (cash + withheld tax) fully settles the invoice even though less cash arrived',()=>{
  const c=context(),i=invoice();
  // Customer withholds 3% of the 1,000 baht base (30) and pays 1,040 cash.
  // The receipt still records the FULL settled total (1,070) — the WHT
  // amount is a prepaid-tax-credit asset, not a discount and not missing
  // revenue — so the invoice must read as fully paid.
  c.pack({invoices:[i],receipts:[{id:'R1',invNo:i.no,customer:i.customer,total:1070,whtRate:3,whtAmount:30,cashReceived:1040}]});
  const s=c.ERPIntegrity.paymentSummary(i);
  assert.equal(s.paid,1070);
  assert.equal(s.outstanding,0);
  assert.equal(s.status,'paid');
});

test('validateReceipt accepts a WHT receipt whose recorded total (cash+WHT) matches the outstanding balance',()=>{
  const c=context(),i=invoice();
  c.pack({invoices:[i]});
  const r={id:'R1',branch:'ubon',customer:i.customer,invNo:i.no,total:1070,whtRate:3,whtAmount:30,cashReceived:1040};
  assert.doesNotThrow(()=>c.ERPIntegrity.validateReceipt(r));
});

// ---------------------------------------------------------------------------
// erp-integrity.js — reconciliation tolerance & partial-payment realism
// ---------------------------------------------------------------------------
test('a receipt within the reconciliation tolerance of the outstanding balance settles the invoice (rounding dust is not left permanently outstanding)',()=>{
  const c=context(),i=invoice();
  // 0.01 baht of independent rounding drift between two documents.
  c.pack({invoices:[i],receipts:[{id:'R1',invNo:i.no,customer:i.customer,total:1069.99}]});
  const s=c.ERPIntegrity.paymentSummary(i);
  assert.equal(s.status,'paid');
  assert.equal(s.outstanding,0);
});

test('a receipt beyond the reconciliation tolerance is still flagged as an overpayment exception, not silently accepted',()=>{
  const c=context(),i=invoice();
  c.pack({invoices:[i],receipts:[{id:'R1',invNo:i.no,customer:i.customer,total:300}]});
  const r={id:'R2',branch:'ubon',customer:i.customer,invNo:i.no,total:900};
  // 300 + 900 = 1200, which exceeds the 1070 invoice total by far more than
  // the reconciliation tolerance, so this must still be rejected clearly.
  assert.throws(()=>c.ERPIntegrity.validateReceipt(r),/เกินยอดค้างรับ/);
});

test('partial payment keeps the invoice partially paid, and a follow-up receipt for the remaining balance completes it',()=>{
  const c=context(),i=invoice();
  c.pack({invoices:[i],receipts:[{id:'R1',invNo:i.no,customer:i.customer,total:400}]});
  let s=c.ERPIntegrity.paymentSummary(i);
  assert.equal(s.status,'partially_paid');
  assert.equal(s.paid,400);
  assert.equal(s.outstanding,670);
  // A second receipt for exactly the remaining outstanding balance should
  // validate cleanly and, once recorded, close the invoice out.
  assert.doesNotThrow(()=>c.ERPIntegrity.validateReceipt({id:'R2',branch:'ubon',customer:i.customer,invNo:i.no,total:670}));
  c.pack({invoices:[i],receipts:[{id:'R1',invNo:i.no,customer:i.customer,total:400},{id:'R2',invNo:i.no,customer:i.customer,total:670}]});
  s=c.ERPIntegrity.paymentSummary(i);
  assert.equal(s.status,'paid');
  assert.equal(s.outstanding,0);
});

test('RECONCILE_TOLERANCE is exported for UI/messaging consumers and is a small, sub-baht band',()=>{
  const c=context();
  assert.ok(c.ERPIntegrity.RECONCILE_TOLERANCE>0);
  assert.ok(c.ERPIntegrity.RECONCILE_TOLERANCE<1);
});
