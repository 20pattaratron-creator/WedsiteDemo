import { localDateISO, businessDateOrdinal } from './erp-shared-core.js';
// =====================================================================
// erp-product-experience-core.js — product/UX decision helpers
// DEMO 4.2.0 · deterministic, local-only
// =====================================================================

export const PRODUCT_EXPERIENCE_VERSION = '1.0.0';

export const ROLE_CONFIG = Object.freeze({
  management:{label:'ผู้บริหาร',short:'บริหาร'},
  sales:{label:'ฝ่ายขาย',short:'ขาย'},
  purchasing:{label:'จัดซื้อ',short:'จัดซื้อ'},
  warehouse:{label:'คลัง/จัดส่ง',short:'คลัง'},
  accounting:{label:'บัญชี/ลูกหนี้',short:'บัญชี'},
  admin:{label:'ผู้ดูแลระบบ',short:'Admin'}
});

const n=v=>Number.isFinite(Number(v))?Number(v):0;
const norm=v=>String(v??'').trim().toLowerCase();
const live=x=>x && !x.voided && !x.deleted && !['cancelled','void','reversed'].includes(norm(x.status));
const keyOf=x=>norm(x?.productCode||x?.code||x?.sku||x?.product||x?.name);
const dateValue=v=>businessDateOrdinal(v);

export function normalizeRole(role){return ROLE_CONFIG[role]?role:'management';}

export function orderRemaining(order={}){
  return (order.items||[]).reduce((sum,item)=>sum+Math.max(0,n(item.remainingQty??(n(item.qty)-n(item.deliveredQty)))),0);
}

export function orderReadyToShip(order={}){
  return (order.items||[]).reduce((sum,item)=>sum+Math.max(0,n(item.readyQty)-n(item.deliveredQty)),0);
}

export function orderPlanningGap(order={}){
  return (order.items||[]).reduce((sum,item)=>{
    const qty=n(item.qty),planned=n(item.stockQty)+n(item.productionQty)+n(item.purchaseQty);
    return sum+Math.max(0,qty-planned);
  },0);
}

export function buildWorkQueue(snapshot={},role='management',options={}){
  role=normalizeRole(role);
  const today=options.today||localDateISO();
  const business=snapshot.business||{};
  const flow=snapshot.flow||{};
  const ops=snapshot.ops||{};
  const quotes=(business.quotes||[]).filter(live);
  const invoices=(business.invoices||[]).filter(live);
  const orders=(flow.salesOrders||[]).filter(live);
  const billings=(flow.billingNotes||[]).filter(live);
  const pos=(ops.purchaseOrders||[]).filter(live);
  const stock=Array.isArray(snapshot.stock)?snapshot.stock:[];
  const out=[];
  const push=(item)=>out.push({severity:'info',roles:['management'],...item});

  const converted=new Set(orders.flatMap(o=>[String(o.sourceQuoteId||''),String(o.sourceQuoteNo||'')]).filter(Boolean));
  const pendingQuotes=quotes.filter(q=>!q.approved);
  if(pendingQuotes.length)push({id:'quote-approval',severity:'medium',roles:['management','sales'],title:`ใบเสนอราคารออนุมัติ ${pendingQuotes.length} ใบ`,detail:'ตรวจราคา เงื่อนไข และลูกค้าก่อนยืนยันคำสั่งขาย',action:'เปิดศูนย์อนุมัติ',panel:'approval-center'});
  const approvedNoSo=quotes.filter(q=>q.approved&&!converted.has(String(q.id||''))&&!converted.has(String(q.no||'')));
  if(approvedNoSo.length)push({id:'quote-to-so',severity:'medium',roles:['sales','management'],title:`ใบเสนอราคาอนุมัติแล้ว ยังไม่สร้าง Sales Order ${approvedNoSo.length} ใบ`,detail:'เปลี่ยนเอกสารที่ลูกค้ายืนยันแล้วเข้าสู่ขั้นจัดสินค้า',action:'เปิดศูนย์งานขาย',panel:'order-flow'});

  const planGap=orders.filter(o=>orderPlanningGap(o)>0.000001);
  if(planGap.length)push({id:'order-plan',severity:'high',roles:['sales','purchasing','warehouse','management'],title:`Sales Order วางแผนสินค้าไม่ครบ ${planGap.length} รายการ`,detail:'เลือก Stock / ผลิต / จัดซื้อให้ครบก่อนกำหนดส่ง',action:'เปิด Sales Order',panel:'order-flow'});
  const ready=orders.filter(o=>orderReadyToShip(o)>0.000001&&orderRemaining(o)>0.000001);
  if(ready.length)push({id:'ready-ship',severity:'medium',roles:['warehouse','sales','management'],title:`มี Sales Order พร้อมส่ง ${ready.length} รายการ`,detail:'มีสินค้าพร้อม แต่ยังส่งมอบไม่ครบตาม Order',action:'เตรียมการส่งสินค้า',panel:'order-flow'});
  const overdueOrders=orders.filter(o=>orderRemaining(o)>0.000001&&o.requiredDate&&dateValue(o.requiredDate)<dateValue(today));
  if(overdueOrders.length)push({id:'order-overdue',severity:'high',roles:['sales','warehouse','purchasing','management'],title:`Sales Order เลยกำหนดส่ง ${overdueOrders.length} รายการ`,detail:'ตรวจ Stock, PO และงานสั่งผลิตเพื่อหาสาเหตุที่ยังส่งไม่ครบ',action:'ตรวจงานส่งมอบ',panel:'order-flow'});

  const overdueInvoices=invoices.filter(i=>n(i.outstanding)>0.000001&&i.dueDate&&dateValue(i.dueDate)<dateValue(today));
  const overdueAmount=overdueInvoices.reduce((s,i)=>s+n(i.outstanding),0);
  if(overdueInvoices.length)push({id:'ar-overdue',severity:'high',roles:['accounting','management'],title:`ลูกหนี้เกินกำหนด ${overdueInvoices.length} ใบ`,detail:`ยอดคงค้าง ${overdueAmount.toLocaleString('th-TH',{maximumFractionDigits:2})} บาท`,action:'เปิดศูนย์งานขายและลูกหนี้',panel:'order-flow'});
  const billedInvoiceIds=new Set(billings.filter(live).flatMap(b=>(b.lines||[]).flatMap(l=>[String(l.invoiceId||''),String(l.invoiceNo||'')])).filter(Boolean));
  const unbilled=invoices.filter(i=>n(i.outstanding)>0.000001&&(i.dueDate||n(i.creditTerm)>0)&&!billedInvoiceIds.has(String(i.id||''))&&!billedInvoiceIds.has(String(i.no||'')));
  if(unbilled.length)push({id:'billing-pending',severity:'medium',roles:['accounting','management'],title:`Invoice เครดิตยังไม่เข้ารอบวางบิล ${unbilled.length} ใบ`,detail:'รวมรายการตามลูกค้าและรอบวางบิล เพื่อลดการติดตามด้วยมือ',action:'เปิดใบวางบิล',panel:'order-flow'});

  const draftPo=pos.filter(p=>norm(p.status)==='draft');
  if(draftPo.length)push({id:'po-approval',severity:'medium',roles:['purchasing','management'],title:`PO รอตรวจและอนุมัติ ${draftPo.length} ใบ`,detail:'ตรวจผู้จำหน่าย ราคา จำนวน และกำหนดรับก่อนส่งคำสั่งซื้อ',action:'เปิดศูนย์อนุมัติ',panel:'approval-center'});
  const overduePo=pos.filter(p=>!['received','cancelled'].includes(norm(p.status))&&p.expectedDate&&dateValue(p.expectedDate)<dateValue(today));
  if(overduePo.length)push({id:'po-overdue',severity:'high',roles:['purchasing','warehouse','management'],title:`PO เลยกำหนดรับ ${overduePo.length} ใบ`,detail:'ติดตาม Supplier และปรับกำหนดส่งของ Sales Order ที่เกี่ยวข้อง',action:'เปิดจัดซื้อ',panel:'purchase-order'});

  const negative=stock.filter(r=>n(r.available)<-0.000001);
  if(negative.length)push({id:'stock-negative',severity:'critical',roles:['warehouse','purchasing','management'],title:`Stock พร้อมใช้ติดลบ ${negative.length} SKU/สาขา`,detail:'ตรวจรับเข้า การจอง การส่ง และ Adjustment ก่อนทำรายการต่อ',action:'เปิดคลังสินค้า',panel:'inventory'});
  const reorder=stock.filter(r=>n(r.available)>=0&&n(r.reorderPoint)>0&&n(r.available)<=n(r.reorderPoint));
  if(reorder.length)push({id:'stock-low',severity:'medium',roles:['purchasing','warehouse','management'],title:`สินค้าแตะ Reorder Point ${reorder.length} SKU/สาขา`,detail:'ดู Incoming PO และ Demand ก่อนสั่งซื้อเพิ่ม',action:'เปิดคลังสินค้า',panel:'inventory'});

  const rank={critical:4,high:3,medium:2,low:1,info:0};
  return out.filter(x=>role==='admin'||role==='management'||x.roles.includes(role)).sort((a,b)=>rank[b.severity]-rank[a.severity]||a.title.localeCompare(b.title,'th'));
}

export function buildStockAvailability(snapshot={}){
  const products=snapshot.products||[];
  const branches=snapshot.branches||[];
  const flow=snapshot.flow||{};
  const ops=snapshot.ops||{};
  const reservations=(flow.reservations||[]).filter(r=>live(r)&&norm(r.status||'reserved')==='reserved');
  const pos=(ops.purchaseOrders||[]).filter(p=>live(p)&&!['received','cancelled'].includes(norm(p.status)));
  const grs=(ops.goodsReceipts||[]).filter(g=>live(g)&&!g.reversed);
  const onHand=snapshot.onHand||(()=>0);
  const rows=[];
  for(const product of products){
    if(norm(product.flowType)!=='inventory'||norm(product.fulfillmentType)!=='stock')continue;
    for(const branch of branches){
      const pKey=keyOf(product);if(!pKey)continue;
      const reserved=reservations.filter(r=>norm(r.branch)===norm(branch)&&keyOf(r)===pKey).reduce((s,r)=>s+n(r.qty),0);
      let incoming=0;
      for(const po of pos.filter(p=>norm(p.branch)===norm(branch))){
        for(const item of po.items||[]){if(keyOf(item)!==pKey)continue;
          const received=grs.filter(g=>String(g.poId||'')===String(po.id||'')).flatMap(g=>g.items||[]).filter(i=>keyOf(i)===pKey).reduce((s,i)=>s+n(i.qty),0);
          incoming+=Math.max(0,n(item.qty)-received);
        }
      }
      const on=n(onHand(product,branch));
      rows.push({branch,productCode:product.code||'',product:product.name||product.product||'',unit:product.unit||'',onHand:on,reserved,available:on-reserved,incoming,reorderPoint:n(product.reorderPoint)});
    }
  }
  return rows;
}

export function approvalRows(snapshot={}){
  const business=snapshot.business||{},ops=snapshot.ops||{};
  return {
    quotes:(business.quotes||[]).filter(q=>live(q)&&!q.approved),
    purchaseOrders:(ops.purchaseOrders||[]).filter(p=>live(p)&&norm(p.status)==='draft')
  };
}
