/* Shared local business rules. Browser-only; not a multi-user transaction engine. */
(() => {
  'use strict';
  const FLOW_KEY = 'example_erp_order_flow_v3';
  const n = v => Number.isFinite(Number(v)) ? Number(v) : 0;
  const round = v => Math.round((n(v) + Number.EPSILON) * 100) / 100;
  const norm = v => String(v ?? '').trim().toLowerCase();
  const branch = r => r?._branch || r?.branch || r?.invoiceBranch || '';
  const key = k => window.ComformTenant?.storageKey?.(k) || k;
  const live = r => r && !r.voided && !r.cancelled && !r.reversed && r.status !== 'cancelled';
  const amount = r => round(r?.total ?? r?.saleTotal ?? r?.subtotal ?? 0);
  const productKey = r => norm(r?.productCode || r?.code || r?.product || r?.name);
  function flow() { const r = JSON.parse(localStorage.getItem(key(FLOW_KEY)) || '{}'); return {salesOrders:[],billingNotes:[],payments:[],reservations:[],...r}; }
  function packs() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i), raw = window.ComformTenant?.unwrapStorageKey?.(k) ?? k;
      const m = /^biz2_(ubon|khonkaen)_(\d{4})_(\d{2})$/.exec(raw || '');
      if (!m) continue;
      const data = JSON.parse(localStorage.getItem(k) || '{}');
      out.push({key:k, branch:m[1], year:Number(m[2]), month:Number(m[3])-1, data});
    }
    return out;
  }
  function aliases(r, type = 'Invoice') { return [...new Set([r.id,r.firebaseId,r.no,r[`source${type}Id`],r[`source${type}No`],r[`issuedDocumentId`],r[`issuedDocumentNo`]].filter(v=>v!==undefined&&v!==null&&v!=='').map(String))]; }
  function sameDoc(a, b, type = 'Invoice') {
    if (branch(a) && branch(b) && branch(a) !== branch(b)) return false;
    const ak = aliases(a,type), bk = new Set(aliases(b,type));
    return ak.some(k=>bk.has(k));
  }
  function dedupe(rows, type = 'Invoice') {
    const base = rows.filter(r=>!String(r._type||'').startsWith('issued'));
    const out = base.slice();
    rows.filter(r=>String(r._type||'').startsWith('issued')).forEach(r=>{
      if (out.some(b=>sameDoc(r,b,type))) return;
      out.push(r);
    });
    return out.filter((r,i)=>out.findIndex(b=>branch(b)===branch(r)&&String(b.id||b.no)===String(r.id||r.no))===i);
  }
  function business() {
    const out = {quotes:[],productions:[],invoices:[],issuedInvoices:[],receipts:[],issuedReceipts:[],expenses:[]};
    packs().forEach(p=>Object.keys(out).forEach(type=>(p.data[type]||[]).forEach(r=>out[type].push({...r,branch:p.branch,_branch:p.branch,_year:p.year,_month:p.month,_type:type}))));
    out.invoices=dedupe([...out.invoices,...out.issuedInvoices]);
    out.receipts=dedupe([...out.receipts,...out.issuedReceipts],'Receipt');
    return out;
  }
  function resolveInvoice(ref, data = business()) {
    const br = ref?.branch || ref?.b || ref?.invoiceBranch || ref?._branch;
    const id = String(ref?.invoiceId || ref?.id || ''), no = String(ref?.invoiceNo || ref?.no || ref?.invNo || '');
    const candidates = data.invoices.filter(i=>!br||branch(i)===br);
    const byId = id ? candidates.filter(i=>aliases(i).includes(id)) : [];
    if(byId.length===1)return byId[0];
    const byNo = no ? candidates.filter(i=>aliases(i).includes(no)) : [];
    return byNo.length===1?byNo[0]:null;
  }
  function matchesAllocation(a, inv, parent = {}) {
    const br = a.branch || a.invoiceBranch || parent.branch || parent.invoiceBranch;
    if (br && branch(inv) && br !== branch(inv)) return false;
    const ids = aliases(inv);
    if (a.invoiceId && ids.includes(String(a.invoiceId))) return true;
    return !!a.invoiceNo && ids.includes(String(a.invoiceNo));
  }
  function receiptMatches(r, inv) {
    return matchesAllocation({invoiceId:r.invoiceId||r.sourceInvoiceId,invoiceNo:r.invNo||r.sourceInvoiceNo||r.invoiceNo,branch:r.invoiceBranch||branch(r)},inv,r);
  }
  function paymentSummary(input, options = {}) {
    const data=options.business||business(), store=options.store||flow();
    const inv=resolveInvoice(input,data)||input;
    const excluded=String(options.excludeReceiptId||'');
    let paid=0, evidence=false;
    (store.payments||[]).forEach(p=>(p.allocations||[]).forEach(a=>{
      if(!matchesAllocation(a,inv,p))return;
      evidence=true;if(live(p))paid+=n(a.amount);
    }));
    data.receipts.forEach(r=>{
      if(!receiptMatches(r,inv))return;
      evidence=true;
      if(!live(r)||(excluded&&(String(r.id)===excluded||String(r.sourceReceiptId||'')===excluded)))return;
      // The printable receipt for a payment is evidence, not a second cash entry.
      if(r.paymentId && (store.payments||[]).some(p=>String(p.id)===String(r.paymentId)))return;
      if(r.paymentId)return;
      paid+=amount(r);
    });
    const total=amount(inv);
    const legacy=!evidence&&!inv.paymentManaged&&inv.paymentSource!=='receipt'&&(inv.paid||inv.isPaid||inv.paymentStatus==='paid');
    if(legacy)paid=total;
    paid=round(paid);
    const outstanding=round(Math.max(0,total-paid));
    return {total,paid,outstanding,overpaid:round(Math.max(0,paid-total)),status:total>0&&outstanding===0?'paid':paid>0?'partially_paid':'pending',evidence,legacy};
  }
  function reconcilePayments() {
    const data=business(),store=flow();
    packs().forEach(p=>{
      let changed=false;
      ['invoices','issuedInvoices'].forEach(type=>(p.data[type]||[]).forEach(inv=>{
        const s=paymentSummary({...inv,branch:p.branch},{business:data,store});
        const next={paid:s.status==='paid',isPaid:s.status==='paid',paymentStatus:s.status,paidAmount:s.paid,outstandingAmount:s.outstanding,paymentManaged:!s.legacy};
        if(Object.keys(next).some(k=>inv[k]!==next[k])){Object.assign(inv,next);changed=true;}
      }));
      if(changed)localStorage.setItem(p.key,JSON.stringify(p.data));
    });
    const before=JSON.stringify(store);reconcileBillings(store,data);
    if(JSON.stringify(store)!==before)localStorage.setItem(key(FLOW_KEY),JSON.stringify(store));
  }
  function assertEditable(type, record) {
    const printed=type==='invoice'?'issuedInvoices':type==='receipt'?'issuedReceipts':null;
    if(printed&&business()[printed].some(r=>live(r)&&sameDoc(r,record,type==='receipt'?'Receipt':'Invoice')))
      throw new Error('เอกสารนี้มีฉบับพิมพ์ที่บันทึกแล้ว จึงล็อกการแก้ไขต้นทางใน DEMO เพื่อรักษายอดให้ตรงกัน');
  }
  function receiptPaidAmount(inv,store=flow(),data=business()){
    const allocated=(store.payments||[]).filter(live).reduce((s,p)=>s+(p.allocations||[]).filter(a=>matchesAllocation(a,inv,p)).reduce((s,a)=>s+n(a.amount),0),0);
    return round(Math.max(0,paymentSummary(inv,{business:data,store}).paid-allocated));
  }
  // Explicit allocations belong to their billing; unassigned receipts settle bills FIFO.
  function reconcileBillings(store, data=business()) {
    const entries=[];
    (store.billingNotes||[]).forEach((b,index)=>{
      b.documentStatus=b.documentStatus||(!['paid','partially_paid'].includes(b.status)?b.status:'draft')||'draft';
      if(b.status==='cancelled'||b.documentStatus==='cancelled')return;
      (b.lines||[]).forEach(l=>{
        const inv=resolveInvoice(l,data);
        if(l.receiptPaidAtCreation===undefined){
          const priorWorkflow=(store.payments||[]).filter(p=>live(p)&&Date.parse(p.createdAt)<Date.parse(b.createdAt)).reduce((s,p)=>s+(p.allocations||[]).filter(a=>inv&&matchesAllocation(a,inv,p)).reduce((s,a)=>s+n(a.amount),0),0);
          l.receiptPaidAtCreation=round(Math.max(0,n(l.originalAmount)-n(l.outstandingAmount??l.originalAmount)-priorWorkflow));
        }
        entries.push({b,l,index,inv,paid:0});
      });
    });
    data.invoices.forEach(inv=>{
      const matching=entries.filter(e=>e.inv&&sameDoc(e.inv,inv));
      if(!matching.length)return;
      let explicitlyAssigned=0;
      matching.forEach(e=>{
        const via=(store.payments||[]).filter(p=>live(p)&&p.billingId===e.b.id).reduce((v,p)=>v+(p.allocations||[]).filter(a=>matchesAllocation(a,inv,p)).reduce((v,a)=>v+n(a.amount),0),0);
        e.paid=Math.min(n(e.l.billedAmount),via);explicitlyAssigned+=e.paid;
      });
      const loose=receiptPaidAmount(inv,store,data);let consumed=0;
      matching.sort((a,b)=>String(a.b.billingDate||a.b.createdAt||'').localeCompare(String(b.b.billingDate||b.b.createdAt||''))||a.index-b.index).forEach(e=>{
        const baseline=n(e.l.receiptPaidAtCreation);consumed=Math.max(consumed,baseline);
        const take=Math.min(Math.max(0,loose-consumed),Math.max(0,n(e.l.billedAmount)-e.paid));e.paid+=take;consumed+=take;
      });
    });
    entries.forEach(e=>{e.l.paidAmount=round(e.paid);e.l.outstandingAmount=round(Math.max(0,n(e.l.billedAmount)-e.paid));e.l.unresolvedInvoice=!e.inv||!live(e.inv);});
    (store.billingNotes||[]).filter(b=>b.status!=='cancelled'&&b.documentStatus!=='cancelled').forEach(b=>{
      b.paidAmount=round((b.lines||[]).reduce((s,l)=>s+n(l.paidAmount),0));
      b.outstandingAmount=round((b.lines||[]).reduce((s,l)=>s+n(l.outstandingAmount),0));
      b.paymentStatus=(b.lines||[]).length&&b.outstandingAmount===0?'paid':b.paidAmount>0?'partially_paid':'pending';
      b.status=b.paymentStatus==='pending'?b.documentStatus:b.paymentStatus;
    });
    return store;
  }
  function validateReceipt(r, excludeReceiptId='') {
    if(amount(r)<=0)throw new Error('ยอดรับเงินต้องมากกว่า 0');
    const inv=resolveInvoice({branch:r.invoiceBranch||branch(r),id:r.invoiceId,no:r.invNo||r.sourceInvoiceNo});
    if(!inv && (r.invNo||r.invoiceId||r.sourceInvoiceNo))throw new Error('ไม่พบบิลอ้างอิงในสาขาที่เลือก');
    if(!inv)return null;
    if(!live(inv))throw new Error('บิลอ้างอิงถูกยกเลิกแล้ว');
    if((r.invNo||r.sourceInvoiceNo)&&!aliases(inv).includes(String(r.invNo||r.sourceInvoiceNo)))throw new Error('เลขบิลไม่ตรงกับบิลที่เลือกอ้างอิง');
    if(norm(inv.customer)!==norm(r.customer))throw new Error('ลูกค้าในใบเสร็จไม่ตรงกับบิลอ้างอิง');
    const s=paymentSummary(inv,{excludeReceiptId});
    if(amount(r)>s.outstanding+0.001)throw new Error(`ยอดรับเงินเกินยอดค้างรับ ${s.outstanding.toFixed(2)} บาท`);
    return inv;
  }
  function orderInvoices(order, data=business(), excludeInvoiceId='') {
    const all=flow().salesOrders||[];
    const uniqueQuote=order.sourceQuoteNo&&all.filter(o=>branch(o)===branch(order)&&String(o.sourceQuoteNo)===String(order.sourceQuoteNo)).length===1;
    return data.invoices.filter(i=>live(i)&&branch(i)===branch(order)&&String(i.id)!==String(excludeInvoiceId||'')).filter(i=>{
      if(i.sourceSalesOrderId)return String(i.sourceSalesOrderId)===String(order.id);
      if(i.sourceSalesOrderNo)return String(i.sourceSalesOrderNo)===String(order.no);
      if(uniqueQuote&&i.sourceQuoteNo&&String(i.sourceQuoteNo)===String(order.sourceQuoteNo))return true;
      const tokens=String(i.note||'').split(/\s|\/|—|,/).filter(Boolean);
      return tokens.includes(String(order.no));
    });
  }
  function orderProgress(order, data=business(), excludeInvoiceId='') {
    const items=(order.items||[]).map(i=>({...i,deliveredQty:0}));
    const invoices=orderInvoices(order,data,excludeInvoiceId);
    invoices.forEach(inv=>(inv.items||[]).forEach(it=>{
      let left=Math.max(0,n(it.qty));
      const exact=it.salesOrderLineId?items.filter(x=>String(x.id)===String(it.salesOrderLineId)):items.filter(x=>productKey(x)===productKey(it));
      exact.forEach((line,index)=>{const take=index===exact.length-1?left:Math.min(left,Math.max(0,n(line.qty)-line.deliveredQty));line.deliveredQty+=take;left-=take;});
    }));
    return {...order,items:items.map(i=>({...i,deliveredQty:round(i.deliveredQty),remainingQty:round(Math.max(0,n(i.qty)-i.deliveredQty))})),invoices};
  }
  function reservedQty(product, br, excludeOrderId='') {
    const data=business();let total=0;
    flow().salesOrders.filter(o=>live(o)&&branch(o)===br&&String(o.id)!==String(excludeOrderId)).forEach(o=>{
      orderProgress(o,data).items.filter(i=>productKey(i)===productKey(product)).forEach(i=>total+=Math.max(0,n(i.stockQty)-n(i.deliveredQty)));
    });
    return round(total);
  }
  function availableStock(product, br, excludeOrderId='') {
    return Math.max(0,round(n(window.productEstimatedStock?.(product,br))-reservedQty(product,br,excludeOrderId)));
  }
  function validateDelivery(record, excludeInvoiceId='') {
    if(!record.sourceSalesOrderId)return;
    const order=flow().salesOrders.find(o=>String(o.id)===String(record.sourceSalesOrderId));
    if(!order||!live(order)||branch(order)!==branch(record))throw new Error('ใบสั่งขายอ้างอิงไม่พร้อมใช้งานหรืออยู่คนละสาขา');
    if(record.customer&&norm(record.customer)!==norm(order.customer))throw new Error('ลูกค้าไม่ตรงกับใบสั่งขาย');
    const progress=orderProgress(order,business(),excludeInvoiceId), totals=new Map();
    (record.items||[]).forEach(i=>{const expected=progress.items.find(l=>String(l.id)===String(i.salesOrderLineId));if(expected&&productKey(i)&&productKey(i)!==productKey(expected))throw new Error('สินค้าไม่ตรงกับรายการใบสั่งขาย');if(!i.salesOrderLineId)throw new Error('รายการสินค้าไม่มีรหัสบรรทัดใบสั่งขาย กรุณาเตรียมเอกสารจาก SO ใหม่');totals.set(String(i.salesOrderLineId),(totals.get(String(i.salesOrderLineId))||0)+n(i.qty));});
    totals.forEach((qty,id)=>{
      const line=progress.items.find(i=>String(i.id)===id);
      if(!line||qty<=0||qty>line.remainingQty+0.000001||qty>Math.max(0,n(line.readyQty)-line.deliveredQty)+0.000001)throw new Error('จำนวนส่งเกินจำนวนค้างส่งหรือจำนวนพร้อมส่งของใบสั่งขาย');
    });
  }
  function salesOrderCost(orderId,lineId,qty,excludeInvoiceId='') {
    const order=flow().salesOrders.find(o=>String(o.id)===String(orderId));
    const line=order?.items?.find(i=>String(i.id)===String(lineId));if(!line)return null;
    const data=business(),p=window.productMasterRows?.().find(p=>productKey(p)===productKey(line));
    const standard=n(p?.standardCost);let actualQty=0,actualCost=0;const sources=[];
    const sameSkuLines=order.items.filter(i=>productKey(i)===productKey(line)).length;
    data.productions.filter(d=>live(d)&&branch(d)===branch(order)&&String(d.sourceSalesOrderId)===String(order.id)).forEach(d=>{
      const all=d.items||[],matched=all.filter(i=>i.salesOrderLineId?String(i.salesOrderLineId)===String(line.id):sameSkuLines===1&&productKey(i)===productKey(line));
      const known=v=>v!==undefined&&v!==null&&v!==''&&Number.isFinite(Number(v));
      if(!all.every(i=>known(i.costTotal)||known(i.costUnit))&&!(all.length===1&&known(d.costSubtotal??d.costTotal)))return;
      const itemTotal=all.reduce((s,i)=>s+n(i.costTotal??(n(i.costUnit)*n(i.qty))),0);
      const docTotal=n(d.costSubtotal??d.costTotal??itemTotal);
      matched.forEach(i=>{
        const itemCost=n(i.costTotal??(n(i.costUnit)*n(i.qty)));
        if(n(i.qty)<=0||(itemTotal===0&&docTotal>0&&all.length>1))return;
        const cost=itemTotal>0?itemCost*docTotal/itemTotal:all.length===1?docTotal:itemCost;
        actualQty+=n(i.qty);actualCost+=cost;sources.push(d.id);
      });
    });
    const ordered=n(line.qty),production=n(line.productionQty)||(actualQty>=ordered?ordered:0);
    let budget=standard*ordered,basis=standard>0?'standard_estimate':'missing';
    if(actualQty>0&&production>0){
      budget=(actualCost/actualQty)*production+standard*Math.max(0,ordered-production);
      basis=production===ordered&&actualQty>=production?'production_actual':standard>0?'mixed_estimate':'missing';
    }
    const prior=orderInvoices(order,data,excludeInvoiceId).flatMap(i=>i.items||[]).filter(i=>i.salesOrderLineId?String(i.salesOrderLineId)===String(line.id):sameSkuLines===1&&productKey(i)===productKey(line));
    const delivered=prior.reduce((s,i)=>s+n(i.qty),0),spent=prior.reduce((s,i)=>s+n(i.costTotal),0),remaining=Math.max(0,ordered-delivered);
    const remainder=round(budget)-round(spent);
    const conflict=remainder<-.01;
    const total=round(Math.max(0,remainder)*Math.max(0,n(qty))/Math.max(remaining,0.000001));
    return {total,unitCost:n(qty)>0?total/n(qty):0,basis:conflict?'review_required':basis,sourceProductionIds:[...new Set(sources)],orderLineBudget:round(budget),allocatedBefore:round(spent),conflict};
  }
  function validateItems(items) {
    if(!Array.isArray(items)||!items.length)throw new Error('กรุณาเพิ่มรายการสินค้า');
    if(items.some(i=>!String(i.product||'').trim()||!Number.isFinite(Number(i.qty))||n(i.qty)<=0||(i.priceUnit!=null&&!Number.isFinite(Number(i.priceUnit)))||n(i.priceUnit)<0||(i.costTotal!=null&&!Number.isFinite(Number(i.costTotal)))||n(i.costTotal)<0))throw new Error('กรุณาระบุสินค้า จำนวนมากกว่า 0 และราคาที่ไม่ติดลบให้ครบทุกบรรทัด');
  }
  function mergeRows(oldRows=[],newRows=[],replace=false) {
    if(!Array.isArray(newRows))throw new Error('โครงสร้างข้อมูลต้องเป็นรายการ');
    const map=new Map();
    const identity=r=>`${branch(r)}|${r.id||r.firebaseId||r.code||r.no||norm(r.name)}`;
    const stamp=r=>Date.parse(r.updatedAtIso||r.updatedAtClient||r.updatedAt||r.createdAt||'')||0;
    if(!replace)oldRows.forEach(r=>map.set(identity(r),r));
    newRows.forEach(r=>{if(!r||typeof r!=='object'||Array.isArray(r)||!(r.id||r.firebaseId||r.code||r.no||r.name))throw new Error('พบรายการที่ไม่มีรหัสหรือชื่อ');const k=identity(r),old=map.get(k);if(!old||stamp(r)>=stamp(old))map.set(k,{...old,...r});});
    return [...map.values()];
  }
  function transaction(writes) {
    const old=new Map(writes.map(([k])=>[k,localStorage.getItem(k)])),changed=[];
    try{writes.forEach(([k,v])=>{localStorage.setItem(k,typeof v==='string'?v:JSON.stringify(v));if(!changed.includes(k))changed.push(k);});}
    catch(error){
      let rollbackFailed=false;
      changed.reverse().forEach(k=>{try{const v=old.get(k);if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v);}catch(_){rollbackFailed=true;}});
      if(rollbackFailed)throw new Error('บันทึกและย้อนกลับข้อมูลไม่ครบ กรุณากู้ Backup ก่อนทำรายการต่อ');
      throw error;
    }
  }
  function createPaymentReceipts(payment, store) {
    const data=business(), brs=new Set(payment.allocations.map(a=>a.branch));
    if(brs.size!==1)throw new Error('การรับเงินหนึ่งครั้งต้องอยู่ในสาขาเดียวกัน');
    const br=[...brs][0];
    const d=new Date(`${payment.date}T00:00:00`);if(Number.isNaN(d.getTime()))throw new Error('วันที่รับเงินไม่ถูกต้อง');
    const year=d.getFullYear(),month=d.getMonth(),packKey=key(`biz2_${br}_${year}_${String(month+1).padStart(2,'0')}`);
    const pack=JSON.parse(localStorage.getItem(packKey)||'{}');pack.receipts||=[];
    const prefix=`REC${String(year+543).slice(-2)}${String(month+1).padStart(2,'0')}`;
    let counter=Math.max(0,...data.receipts.map(r=>String(r.no||'').startsWith(prefix)?Number(String(r.no).slice(prefix.length))||0:0));
    const receipts=payment.allocations.map((a,index)=>{
      const inv=resolveInvoice(a,data);if(!inv)throw new Error('ไม่พบ Invoice สำหรับรับเงิน');
      const net=round(n(a.amount)*(n(inv.subtotal??(amount(inv)-n(inv.vatAmt)))/Math.max(amount(inv),0.01))),vat=round(n(a.amount)-net);
      return {id:Date.now()+index,no:prefix+String(++counter).padStart(2,'0'),date:payment.date,branch:br,year,month,customer:inv.customer,customerAddress:inv.customerAddress||'',customerTaxId:inv.customerTaxId||'',contact:inv.contact||'',phone:inv.phone||'',email:inv.email||'',salesPerson:inv.salesPerson||'',invNo:inv.no,invoiceId:inv.id,invoiceBranch:br,invoiceYear:inv._year,invoiceMonth:inv._month,paymentId:payment.id,paymentNo:payment.no,paymentManaged:true,receivedAmount:n(a.amount),items:[{product:`รับชำระ${n(a.amount)<amount(inv)?'บางส่วน ': ' '}ตามบิล ${inv.no}`,qty:1,unit:'ครั้ง',priceUnit:n(a.amount),saleTotal:n(a.amount),costUnit:0}],itemSaleTotal:n(a.amount),saleTotal:n(a.amount),subtotal:net,total:n(a.amount),vatAmt:vat,vatMode:vat>0?'extract':'none',useVat:vat>0?0:2,commAmt:0,costTotal:0,profit:0,note:`รับเงิน ${payment.no} / ${payment.method}`,attachments:[],createdAt:new Date().toISOString()};
    });
    pack.receipts.push(...receipts);payment.receiptNos=receipts.map(r=>r.no);
    transaction([[packKey,pack],[key(FLOW_KEY),store]]);
    return receipts;
  }
  let refreshQueued=false;
  function changed() {
    if(refreshQueued)return;refreshQueued=true;
    queueMicrotask(()=>{refreshQueued=false;try{reconcilePayments();window.dispatchEvent(new CustomEvent('erp-flow:changed'));}catch(e){console.error(e);window.notify?.('ตรวจยอดเชื่อมเอกสารไม่สำเร็จ: '+e.message,'error');}});
  }
  window.ERPIntegrity={receiptPaidAmount,salesOrderCost,assertEditable,reconcileBillings,round,amount,branch,live,productKey,packs,business,dedupe,sameDoc,resolveInvoice,matchesAllocation,receiptMatches,paymentSummary,reconcilePayments,validateReceipt,orderInvoices,orderProgress,reservedQty,availableStock,validateDelivery,validateItems,mergeRows,transaction,createPaymentReceipts,changed};
})();
