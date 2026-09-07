// =====================================================================
// erp-decision-council-core.js — deterministic multi-perspective review
// =====================================================================
// This is NOT a multi-LLM implementation. It applies independent business
// review lenses to the same ERP snapshot, then synthesizes priorities.

export const COUNCIL_VERSION = '1.0.0';

export const RULE_REGISTRY = Object.freeze({
  SALES_001:{reviewer:'sales',title:'ใบเสนอราคาอนุมัติแล้วยังไม่สร้าง Sales Order',source:'ข้อมูลธุรกรรมภายในระบบ',formula:'count(approved quote without linked sales order)'},
  SALES_002:{reviewer:'sales',title:'ใบเสนอราคารอติดตามนาน',source:'ข้อมูลธุรกรรมภายในระบบ',formula:'pending quote age > staleQuoteDays'},
  AR_001:{reviewer:'collections',title:'ลูกหนี้เกินกำหนด',source:'Invoice + Payment Allocation ภายในระบบ',formula:'sum(outstanding where dueDate < today)'},
  AR_002:{reviewer:'collections',title:'Invoice ค้างรับยังไม่เข้ารอบวางบิล',source:'Invoice + Billing Note ภายในระบบ',formula:'outstanding invoice without active billing note'},
  AR_003:{reviewer:'collections',title:'ยอดรับเงินเกินยอดเอกสาร',source:'Integrity payment summary',formula:'paid - invoice total > 0'},
  OPS_001:{reviewer:'fulfillment',title:'Sales Order เลยกำหนดและยังส่งไม่ครบ',source:'Sales Order ภายในระบบ',formula:'remainingQty > 0 and requiredDate < today'},
  OPS_002:{reviewer:'fulfillment',title:'แผนจัดสินค้าไม่ครบจำนวน Order',source:'Sales Order fulfillment plan',formula:'stock + production + purchase < ordered qty'},
  OPS_003:{reviewer:'fulfillment',title:'มีสินค้าพร้อมส่งแต่ยังค้างส่ง',source:'Sales Order progress',formula:'readyQty > deliveredQty and remainingQty > 0'},
  INV_001:{reviewer:'inventory',title:'Stock ติดลบ',source:'Product master + Inventory movement ภายในระบบ',formula:'estimated stock < 0'},
  INV_002:{reviewer:'inventory',title:'Stock ต่ำกว่า Reorder Point',source:'Product master + Inventory movement ภายในระบบ',formula:'0 <= estimated stock <= reorder point'},
  GOV_001:{reviewer:'governance',title:'ข้อมูลเอกสารสำคัญไม่ครบ',source:'Data-quality checks ภายในระบบ',formula:'missing document no/customer/items or invalid amount'},
  GOV_002:{reviewer:'governance',title:'พบ Runtime Error ระหว่างการใช้งาน',source:'Local demo health/runtime capture',formula:'runtimeErrors > 0'},
  GOV_003:{reviewer:'governance',title:'Business Rules ยังไม่มีเวอร์ชันที่ตรวจสอบได้',source:'Business Rule Registry ภายในระบบ',formula:'formulaVersion missing or < 1'},
  CTR_001:{reviewer:'contrarian',title:'ข้อมูลยังน้อยเกินไปสำหรับข้อสรุปเชิงแนวโน้ม',source:'Data volume check',formula:'business document count < minimumEvidenceDocs'},
  CTR_002:{reviewer:'contrarian',title:'ระบบอยู่ใน Local Demo',source:'Application mode',formula:'demoMode = true'}
});

const n=v=>Number.isFinite(Number(v))?Number(v):0;
const norm=v=>String(v??'').trim().toLowerCase();
const dateValue=v=>{if(!v)return NaN;const d=new Date(String(v).length===10?`${v}T00:00:00`:v);return d.getTime();};
const daysBetween=(a,b)=>Math.floor((dateValue(b)-dateValue(a))/86400000);
const sum=(rows,fn)=>rows.reduce((s,x)=>s+n(fn(x)),0);
const live=x=>x && !x.voided && !x.deleted && !['cancelled','void','reversed'].includes(norm(x.status));

const severityRank={critical:4,high:3,medium:2,low:1,info:0};
const toneByRank=['info','low','medium','high','critical'];

function finding(ruleId,severity,summary,evidence=[],action=''){
  const rule=RULE_REGISTRY[ruleId];
  return {ruleId,reviewer:rule.reviewer,title:rule.title,severity,summary,evidence,action,source:rule.source,formula:rule.formula};
}
function review(name,label,findings,positive=''){
  const rank=Math.max(0,...findings.map(x=>severityRank[x.severity]||0));
  return {name,label,severity:toneByRank[rank],findings,positive};
}
function isPendingQuote(q){return live(q)&&!q.approved&&!['won','lost','expired'].includes(norm(q.status));}
function orderRemaining(order){
  const items=Array.isArray(order.items)?order.items:[];
  return items.reduce((s,item)=>s+Math.max(0,n(item.remainingQty??(n(item.qty)-n(item.deliveredQty)))),0);
}
function orderAllocationGap(order){
  return (order.items||[]).reduce((s,item)=>{
    const qty=n(item.qty),planned=n(item.stockQty)+n(item.productionQty)+n(item.purchaseQty);
    return s+Math.max(0,qty-planned);
  },0);
}
function orderReadyGap(order){
  return (order.items||[]).reduce((s,item)=>s+Math.max(0,n(item.readyQty)-n(item.deliveredQty)),0);
}

export function analyzeCouncil(snapshot={},options={}){
  const cfg={staleQuoteDays:14,dueSoonDays:7,minimumEvidenceDocs:5,...options};
  const now=snapshot.now||new Date().toISOString().slice(0,10);
  const quotes=(snapshot.quotes||[]).filter(live),invoices=(snapshot.invoices||[]).filter(live),orders=(snapshot.orders||[]).filter(live),billings=(snapshot.billingNotes||[]).filter(live),products=snapshot.products||[];
  const reviews=[];

  // 1) Sales lens
  const sales=[];
  const converted=new Set(orders.flatMap(o=>[o.sourceQuoteId,o.sourceQuoteNo].filter(Boolean).map(String)));
  const readyQuotes=quotes.filter(q=>q.approved&&!converted.has(String(q.id||''))&&!converted.has(String(q.no||'')));
  if(readyQuotes.length)sales.push(finding('SALES_001','medium',`${readyQuotes.length} ใบพร้อมเปลี่ยนเป็น Sales Order`,readyQuotes.slice(0,5).map(q=>`${q.no||'-'} · ${q.customer||'-'} · ฿${n(q.total).toLocaleString('th-TH')}`),'สร้าง Sales Order จากใบเสนอราคาที่ลูกค้ายืนยันแล้ว'));
  const stale=quotes.filter(isPendingQuote).filter(q=>Number.isFinite(dateValue(q.date))&&daysBetween(q.date,now)>cfg.staleQuoteDays);
  if(stale.length)sales.push(finding('SALES_002','low',`${stale.length} ใบรอการติดตามเกิน ${cfg.staleQuoteDays} วัน`,stale.slice(0,5).map(q=>`${q.no||'-'} · ${q.customer||'-'} · ${daysBetween(q.date,now)} วัน`),'ให้ฝ่ายขายยืนยันสถานะ: ติดตามต่อ / Won / Lost / Expired'));
  reviews.push(review('sales','ฝ่ายขาย / Pipeline',sales,sales.length?'':'ไม่พบใบเสนอราคาที่ต้องเร่งจัดการตามกฎปัจจุบัน'));

  // 2) Collections lens
  const collections=[];
  const outstanding=invoices.filter(i=>n(i.outstanding)>0);
  const overdue=outstanding.filter(i=>i.dueDate&&dateValue(i.dueDate)<dateValue(now));
  if(overdue.length)collections.push(finding('AR_001','high',`ลูกหนี้เกินกำหนด ${overdue.length} ใบ รวม ฿${sum(overdue,x=>x.outstanding).toLocaleString('th-TH',{maximumFractionDigits:2})}`,overdue.slice(0,5).map(i=>`${i.no||'-'} · ${i.customer||'-'} · ค้าง ฿${n(i.outstanding).toLocaleString('th-TH')}`),'จัดลำดับติดตามจากยอดค้างและจำนวนวันที่เกินกำหนด'));
  const billedIds=new Set(billings.flatMap(b=>(b.lines||[]).flatMap(l=>[l.invoiceId,l.invoiceNo].filter(Boolean).map(String))));
  const isCredit=i=>{const term=norm(i.creditTerm);if(term==='cash'||term==='cod')return false;if(term&&term!=='none')return true;return i.dueDate&&i.date&&dateValue(i.dueDate)>dateValue(i.date);};
  const unbilled=outstanding.filter(i=>isCredit(i)&&!billedIds.has(String(i.id||''))&&!billedIds.has(String(i.no||'')));
  if(unbilled.length)collections.push(finding('AR_002','medium',`${unbilled.length} Invoice ค้างรับยังไม่อยู่ในใบวางบิล`,unbilled.slice(0,5).map(i=>`${i.no||'-'} · ${i.customer||'-'} · ฿${n(i.outstanding).toLocaleString('th-TH')}`),'ตรวจเงื่อนไขลูกค้าเครดิตและสร้าง Billing Note เมื่อถึงรอบวางบิล'));
  const overpaid=invoices.filter(i=>n(i.overpaid)>0);
  if(overpaid.length)collections.push(finding('AR_003','critical',`พบ ${overpaid.length} Invoice ที่ยอดรับเงินสูงกว่ายอดเอกสาร`,overpaid.slice(0,5).map(i=>`${i.no||'-'} · เกิน ฿${n(i.overpaid).toLocaleString('th-TH')}`),'หยุดการแก้ไขเอกสารที่เกี่ยวข้องและตรวจ Payment Allocation/Receipt ก่อนดำเนินการต่อ'));
  reviews.push(review('collections','บัญชีลูกหนี้ / Cash Collection',collections,collections.length?'':'ไม่พบลูกหนี้เกินกำหนดหรือยอดรับเงินผิดปกติตามข้อมูลปัจจุบัน'));

  // 3) Fulfillment lens
  const fulfillment=[];
  const activeOrders=orders.filter(o=>!['completed','paid'].includes(norm(o.status))&&orderRemaining(o)>0);
  const late=activeOrders.filter(o=>o.requiredDate&&dateValue(o.requiredDate)<dateValue(now));
  if(late.length)fulfillment.push(finding('OPS_001','high',`Sales Order เลยกำหนดและยังส่งไม่ครบ ${late.length} รายการ`,late.slice(0,5).map(o=>`${o.no||'-'} · ${o.customer||'-'} · เหลือ ${orderRemaining(o).toLocaleString('th-TH')}`),'ตรวจ Stock/Production/PO ที่ผูกกับ Order และกำหนด Next Action'));
  const allocationGap=activeOrders.filter(o=>orderAllocationGap(o)>0);
  if(allocationGap.length)fulfillment.push(finding('OPS_002','high',`${allocationGap.length} Order มีแผน Stock/ผลิต/ซื้อไม่ครบจำนวน`,allocationGap.slice(0,5).map(o=>`${o.no||'-'} · ยังไม่วางแผน ${orderAllocationGap(o).toLocaleString('th-TH')}`),'เติม Fulfillment Plan ให้ครบก่อนยืนยันกำหนดส่ง'));
  const ready=activeOrders.filter(o=>orderReadyGap(o)>0);
  if(ready.length)fulfillment.push(finding('OPS_003','medium',`${ready.length} Order มีสินค้าพร้อมส่งแต่ยังค้างส่ง`,ready.slice(0,5).map(o=>`${o.no||'-'} · พร้อมส่ง ${orderReadyGap(o).toLocaleString('th-TH')}`),'เตรียม Delivery/Tax Invoice ตามจำนวนที่พร้อมส่ง'));
  reviews.push(review('fulfillment','จัดสินค้า / ส่งมอบ',fulfillment,fulfillment.length?'':'ไม่พบ Order เลยกำหนดหรือแผนจัดสินค้าที่ขาดตามข้อมูลปัจจุบัน'));

  // 4) Inventory lens
  const inventory=[];
  const negative=products.filter(p=>n(p.stock)<0);
  if(negative.length)inventory.push(finding('INV_001','critical',`พบ Stock ติดลบ ${negative.length} SKU`,negative.slice(0,8).map(p=>`${p.code||p.name||'-'}${p.branch?' · '+p.branch:''} · ${n(p.stock).toLocaleString('th-TH')}`),'ตรวจ Goods Receipt / Delivery / Adjustment / Opening Balance และอย่าซ่อนค่าติดลบเป็นศูนย์'));
  const low=products.filter(p=>n(p.stock)>=0&&n(p.reorderPoint)>0&&n(p.stock)<=n(p.reorderPoint));
  if(low.length)inventory.push(finding('INV_002','medium',`Stock ต่ำกว่า/เท่าจุดสั่งซื้อ ${low.length} SKU`,low.slice(0,8).map(p=>`${p.code||p.name||'-'}${p.branch?' · '+p.branch:''} · คงเหลือ ${n(p.stock)} / ROP ${n(p.reorderPoint)}`),'ตรวจ Demand/Incoming PO ก่อนสร้าง Purchase Requirement'));
  reviews.push(review('inventory','คลังสินค้า',inventory,inventory.length?'':'ไม่พบ Stock ติดลบหรือถึง Reorder Point ตาม Product Master'));

  // 5) Governance lens
  const governance=[];
  const broken=[];
  for(const [type,rows] of [['Quote',quotes],['Invoice',invoices]]) for(const row of rows){
    if(!row.no||!row.customer||(!Array.isArray(row.items)||!row.items.length)||n(row.total)<0)broken.push(`${type} ${row.no||row.id||'-'}`);
  }
  if(broken.length)governance.push(finding('GOV_001','high',`พบเอกสารหลักข้อมูลไม่ครบ ${broken.length} รายการ`,broken.slice(0,8),'แก้ข้อมูล Master/Document ก่อนนำตัวเลขไปใช้ใน Dashboard หรือออกเอกสารจริง'));
  if(n(snapshot.runtimeErrors)>0)governance.push(finding('GOV_002','high',`พบ Runtime Error ${n(snapshot.runtimeErrors)} ครั้งใน session/health log`,[],'ตรวจ Console/Health ก่อนสาธิตหรือบันทึกข้อมูลต่อ'));
  if(n(snapshot.businessRuleVersion)<1)governance.push(finding('GOV_003','medium','ยังไม่พบ Formula Version ที่ใช้งาน',[],'บันทึก Business Rules เวอร์ชันแรกเพื่อให้เอกสารใหม่อ้างอิงสูตรที่ตรวจสอบย้อนหลังได้'));
  reviews.push(review('governance','Data Quality / Governance',governance,governance.length?'':`Business Rules BR-${String(n(snapshot.businessRuleVersion)||1).padStart(3,'0')} และเอกสารหลักผ่านกฎข้อมูลพื้นฐาน`));

  // 6) Contrarian lens — protects against overconfidence
  const contrarian=[];
  const docCount=quotes.length+invoices.length+orders.length;
  if(docCount<cfg.minimumEvidenceDocs)contrarian.push(finding('CTR_001','low',`มีเอกสารหลักเพียง ${docCount} รายการ จึงยังไม่ควรสรุปแนวโน้มธุรกิจจากข้อมูลชุดนี้`,[],'ใช้ Council เพื่อหา Data Issue/งานค้างได้ แต่ไม่ใช้แทน Forecast หรือข้อสรุปเชิงสถิติ'));
  if(snapshot.demoMode!==false)contrarian.push(finding('CTR_002','info','ผลนี้มาจาก Local Demo และกฎภายใน Browser ไม่ใช่ Production Control',[],'ใช้สำหรับ Review/นำเสนอเท่านั้น การตัดสินใจสำคัญต้องตรวจข้อมูลจริงและผู้รับผิดชอบอนุมัติ'));
  reviews.push(review('contrarian','ผู้ทักท้วง / Evidence Check',contrarian,'มีข้อมูลเพียงพอสำหรับการตรวจเชิงปฏิบัติการตามกฎที่ตั้งไว้'));

  const all=reviews.flatMap(r=>r.findings);
  const prioritized=[...all].sort((a,b)=>(severityRank[b.severity]-severityRank[a.severity])||a.ruleId.localeCompare(b.ruleId));
  const highest=prioritized[0]?.severity||'info';
  const evidenceLevel=docCount>=20?'เพียงพอสำหรับ Operational Review':docCount>=cfg.minimumEvidenceDocs?'ปานกลาง':'จำกัด';
  const actions=prioritized.filter(x=>severityRank[x.severity]>=2).slice(0,3).map((x,i)=>({priority:i+1,...x}));
  const chairman={
    severity:highest,
    evidenceLevel,
    headline:actions.length?`พบ ${actions.length} ประเด็นที่ควรจัดการก่อนตามลำดับความเสี่ยง`:'ไม่พบประเด็นระดับกลางขึ้นไปจากกฎ Council ปัจจุบัน',
    actions,
    note:'Council นี้เป็น deterministic rule-based review ไม่ใช่เสียงโหวตจากหลาย LLM และไม่แทนการอนุมัติของผู้รับผิดชอบ'
  };
  return {version:COUNCIL_VERSION,generatedAt:new Date().toISOString(),asOf:now,reviewCount:reviews.length,documentCount:docCount,reviews,chairman,registryVersion:'2026.09.07'};
}
