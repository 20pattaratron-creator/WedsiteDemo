/*
 * Example Company ERP — Order Flow Upgrade v3
 * Proposal / UAT additive module. Does not replace app.js.
 * Adds: Sales Order, Fulfillment Planner, Work Queue, Billing Note,
 * Payment Allocation overlay, document trace, and beginner-friendly next actions.
 */
(function () {
  'use strict';

  const VERSION = '3.2.0';
  const STORE_BASE_KEY = 'example_erp_order_flow_v3';
  const PREF_BASE_KEY = 'example_erp_order_flow_preferences_v3';
  const BRANCH_LABEL = { khonkaen: 'สาขาที่ 00001', ubon: 'สาขาสำนักงานใหญ่' };
  const VALID_BRANCHES = new Set(Object.keys(BRANCH_LABEL));
  const STATUS_LABEL = {
    confirmed: 'ยืนยันคำสั่งซื้อ',
    planning: 'วางแผนสินค้า',
    ready: 'พร้อมส่ง',
    partial: 'ส่งบางส่วน',
    completed: 'ส่งครบและรับเงินครบ',
    delivered: 'ส่งครบ / รอรับเงิน',
    cancelled: 'ยกเลิก',
    draft: 'ร่าง',
    submitted: 'ส่งวางบิลแล้ว',
    accepted: 'รับวางบิลแล้ว',
    overdue: 'เกินกำหนด',
    paid: 'ชำระแล้ว',
    partially_paid: 'ชำระบางส่วน'
  };

  const esc = (value = '') => String(value).replace(/[&<>'"]/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[ch]));
  const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const money = value => num(value).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const today = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const nowIso = () => new Date().toISOString();
  const uid = prefix => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const dateTh = value => {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return esc(value);
    return d.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };
  const notify = (message, type = 'info') => {
    if (typeof window.notify === 'function') return window.notify(message, type);
    console[type === 'error' ? 'error' : 'log'](message);
  };

  function storageKey(baseKey) {
    return window.ComformTenant?.storageKey?.(baseKey) || String(baseKey || '');
  }

  function unwrapStorageKey(key) {
    return window.ComformTenant?.unwrapStorageKey?.(key) || String(key || '');
  }

  function isBusinessStorageKey(key) {
    return unwrapStorageKey(key).startsWith('biz2_');
  }

  function blankStore() {
    return {
      schemaVersion: 2,
      salesOrders: [],
      billingNotes: [],
      payments: [],
      reservations: [],
      activity: []
    };
  }

  function loadStore() {
    try {
      const currentKey = storageKey(STORE_BASE_KEY);
      let raw = localStorage.getItem(currentKey);
      if (!raw) {
        const legacyKeys = [storageKey('example_erp_order_flow_v2'), 'example_erp_order_flow_v2'];
        for (const legacyKey of legacyKeys) {
          const legacy = localStorage.getItem(legacyKey);
          if (legacy) { raw = legacy; localStorage.setItem(currentKey, legacy); break; }
        }
      }
      if (!raw) return blankStore();
      const data = JSON.parse(raw);
      return window.ERPIntegrity.reconcileBillings({
        ...blankStore(),
        ...data,
        salesOrders: Array.isArray(data.salesOrders) ? data.salesOrders : [],
        billingNotes: Array.isArray(data.billingNotes) ? data.billingNotes : [],
        payments: Array.isArray(data.payments) ? data.payments : [],
        reservations: Array.isArray(data.reservations) ? data.reservations : [],
        activity: Array.isArray(data.activity) ? data.activity : []
      });
    } catch (error) {
      console.error('[ERP Flow] load store failed', error);
      return blankStore();
    }
  }

  function saveStore(store) {
    store.schemaVersion = 2;window.ERPIntegrity.reconcileBillings(store);
    localStorage.setItem(storageKey(STORE_BASE_KEY), JSON.stringify(store));
    window.dispatchEvent(new CustomEvent('erp-flow:changed'));
  }

  function logActivity(action, details = {}) {
    const store = loadStore();
    store.activity.unshift({ id: uid('act'), action, at: nowIso(), ...details });
    store.activity = store.activity.slice(0, 500);
    saveStore(store);
  }

  function getPrefs() {
    try { return { guideMode: true, ...(JSON.parse(localStorage.getItem(storageKey(PREF_BASE_KEY)) || '{}')) }; }
    catch (_) { return { guideMode: true }; }
  }

  function setPrefs(next) {
    localStorage.setItem(storageKey(PREF_BASE_KEY), JSON.stringify({ ...getPrefs(), ...next }));
  }

  function scanBusinessData() { return window.ERPIntegrity.business(); }

  function dedupeDocs(rows) {
    const map = new Map();
    rows.forEach(row => {
      const key = row.firebaseId || `${row._branch}|${row.no || row.id}|${row.date || ''}|${row.customer || ''}`;
      const old = map.get(key);
      if (!old || row._type?.startsWith('issued')) map.set(key, row);
    });
    return [...map.values()];
  }

  function quoteRef(q) {
    return { b: q._branch, y: q._year, m: q._month, id: q.id, no: q.no, firebaseId: q.firebaseId || '' };
  }

  function invoiceRef(inv) {
    return { b: inv._branch, y: inv._year, m: inv._month, id: inv.id, no: inv.no, firebaseId: inv.firebaseId || '', collection: inv._type || 'invoices' };
  }

  function nextNumber(prefix, records, date = new Date()) {
    const yy = String(date.getFullYear() + 543).slice(-2);
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const base = `${prefix}${yy}${mm}`;
    let max = 0;
    records.forEach(row => {
      const m = new RegExp(`^${base}[-]?(\\d+)$`, 'i').exec(String(row.no || ''));
      if (m) max = Math.max(max, Number(m[1]) || 0);
    });
    return `${base}-${String(max + 1).padStart(4, '0')}`;
  }

  function getOrder(orderId) { const o=loadStore().salesOrders.find(x => x.id === orderId); return o ? window.ERPIntegrity.orderProgress(o) : null; }
  function getBilling(id) { return loadStore().billingNotes.find(x => x.id === id) || null; }


  function productForItem(item = {}) {
    const rows = typeof window.productMasterRows === 'function' ? window.productMasterRows() : [];
    const code = String(item.productCode || '').trim().toLowerCase();
    const name = String(item.product || '').trim().toLowerCase();
    return rows.find(p => (code && String(p.code || '').trim().toLowerCase() === code) || (name && String(p.name || '').trim().toLowerCase() === name)) || null;
  }

  function currentStockForItem(item = {}, branch = '', orderId = '') {
    const product=productForItem(item); return product ? window.ERPIntegrity.availableStock(product,branch,orderId) : 0;
  }

  function allocatedToInvoice(invoice) { return window.ERPIntegrity.paymentSummary(invoice).paid; }

  function invoiceOutstanding(inv) { return window.ERPIntegrity.live(inv) ? window.ERPIntegrity.paymentSummary(inv).outstanding : 0; }

  function billingForInvoice(inv) { return loadStore().billingNotes.filter(b=>(b.lines||[]).some(l=>window.ERPIntegrity.matchesAllocation(l,inv,b))); }

  function linkedDocs(order, business = scanBusinessData()) {
    const prods=business.productions.filter(p=>window.ERPIntegrity.live(p)&&p._branch===order.branch&&((p.sourceSalesOrderId&&String(p.sourceSalesOrderId)===String(order.id))||(order.sourceQuoteNo&&p.sourceQuoteNo===order.sourceQuoteNo)));
    const invoices=window.ERPIntegrity.orderInvoices(order,business);
    const receipts=business.receipts.filter(r=>window.ERPIntegrity.live(r)&&invoices.some(i=>window.ERPIntegrity.receiptMatches(r,i)));
    const billings=loadStore().billingNotes.filter(b=>b.status!=='cancelled'&&(b.lines||[]).some(l=>invoices.some(i=>window.ERPIntegrity.matchesAllocation(l,i,b))));
    return {prods,invoices,receipts,billings};
  }

  function derivedOrderStage(order, business = scanBusinessData()) {
    if(order.status==='cancelled')return 'cancelled';
    const p=window.ERPIntegrity.orderProgress(order,business);
    const delivered=p.items.length>0&&p.items.every(i=>i.remainingQty<=0.000001);
    if(delivered)return p.invoices.length&&p.invoices.every(i=>invoiceOutstanding(i)<=0)?'completed':'delivered';
    if(p.items.some(i=>i.deliveredQty>0))return 'partial';
    if(p.items.length&&p.items.every(i=>num(i.readyQty)>=num(i.qty)))return 'ready';
    if(p.items.some(i=>num(i.stockQty)+num(i.productionQty)+num(i.purchaseQty)>0))return 'planning';
    return 'confirmed';
  }

  function suggestedNextAction(order, business) {
    const stage = derivedOrderStage(order, business);
    const links = linkedDocs(order, business);
    if(stage==='partial')return {text:'จัดสินค้าส่วนที่เหลือ / ส่งบางส่วน',tone:'blue',action:`ERPOrderFlow.openFulfillment('${order.id}')`};
    if (stage === 'cancelled') return { text: 'คำสั่งซื้อนี้ยกเลิกแล้ว', tone: 'gray' };
    if (stage === 'confirmed') return { text: 'วางแผนว่าจะหยิบ Stock / ผลิต / จัดซื้อ', tone: 'amber', action: `ERPOrderFlow.openFulfillment('${order.id}')` };
    if (stage === 'planning' && !links.invoices.length) return { text: 'ติดตามสินค้าให้พร้อม แล้วสร้างใบส่งสินค้า', tone: 'blue', action: `ERPOrderFlow.prepareDelivery('${order.id}')` };
    if (links.invoices.length) {
      const outstanding = links.invoices.reduce((s, inv) => s + invoiceOutstanding(inv), 0);
      const hasBilling = links.billings.length > 0;
      if (outstanding > 0 && order.paymentTerm !== 'cash' && !hasBilling) return { text: 'สร้างใบวางบิลจาก Invoice ที่ค้างชำระ', tone: 'purple', action: `ERPOrderFlow.openBillingForOrder('${order.id}')` };
      if (outstanding > 0) return { text: 'ติดตามรับชำระเงิน', tone: 'red', action: `ERPOrderFlow.openTab('billing')` };
      return { text: 'ปิดงานแล้ว — ตรวจเอกสารและกำไร', tone: 'green' };
    }
    return { text: 'ตรวจความพร้อมก่อนส่งสินค้า', tone: 'blue', action: `ERPOrderFlow.openFulfillment('${order.id}')` };
  }

  function computeWorkQueue(business) {
    const store = loadStore();
    const quoteConverted = new Set(store.salesOrders.map(o => String(o.sourceQuoteId || o.sourceQuoteNo || '')));
    const acceptedQuotes = business.quotes.filter(q => q.approved && !quoteConverted.has(String(q.id)) && !quoteConverted.has(String(q.no)));
    const activeOrders = store.salesOrders.filter(o => !['completed', 'cancelled'].includes(derivedOrderStage(o, business)));
    const outstandingInvoices = business.invoices.filter(inv => invoiceOutstanding(inv) > 0);
    const unbilled = outstandingInvoices.filter(inv => !billingForInvoice(inv).some(b => !['cancelled', 'paid'].includes(b.status)));
    const overdue = outstandingInvoices.filter(inv => inv.dueDate && new Date(inv.dueDate) < new Date(today()));
    const dueBilling = store.billingNotes.filter(b => !['paid', 'cancelled'].includes(b.status) && b.dueDate && new Date(b.dueDate) < new Date(today()));
    return { acceptedQuotes, activeOrders, outstandingInvoices, unbilled, overdue, dueBilling };
  }

  function ensureNavAndPanel() {
    const sidebar = document.querySelector('.sidebar');
    const main = document.querySelector('.main');
    if (!sidebar || !main) return false;
    if (!document.getElementById('erp-flow-nav')) {
      const sec = document.createElement('div');
      sec.className = 'nav-sec erp-flow-nav-section';
      sec.textContent = 'งานขายแบบ Workflow';
      const nav = document.createElement('div');
      nav.id = 'erp-flow-nav';
      nav.className = 'nav-item';
      nav.innerHTML = '<span class="erp-flow-nav-icon">⇄</span><span>ศูนย์งานขาย & ลูกหนี้</span><span id="erp-flow-nav-badge" class="erp-flow-nav-badge">0</span>';
      nav.addEventListener('click', () => showPanel());
      const anchor = [...sidebar.querySelectorAll('.nav-sec')].find(el => /ติดตามงาน|ค้นหา/.test(el.textContent || ''));
      if (anchor) sidebar.insertBefore(sec, anchor);
      else sidebar.appendChild(sec);
      sidebar.insertBefore(nav, anchor || null);
    }
    if (!document.getElementById('panel-order-flow')) {
      const panel = document.createElement('div');
      panel.id = 'panel-order-flow';
      panel.className = 'panel erp-flow-panel';
      panel.innerHTML = '<div id="erp-flow-root"></div>';
      main.appendChild(panel);
    }
    injectDashboardQueue();
    return true;
  }

  function showPanel(tab) {
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById('panel-order-flow')?.classList.add('active');
    document.getElementById('erp-flow-nav')?.classList.add('active');
    document.body.classList.remove('mobile-menu-open');
    render(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openTab(tab) { showPanel(tab); }

  function injectDashboardQueue() {
    const dash = document.getElementById('panel-dashboard');
    if (!dash || document.getElementById('erp-flow-dashboard-queue')) return;
    const box = document.createElement('section');
    box.id = 'erp-flow-dashboard-queue';
    box.className = 'erp-flow-dashboard-queue';
    const insertAfter = dash.querySelector('.filter-bar');
    if (insertAfter?.nextSibling) dash.insertBefore(box, insertAfter.nextSibling);
    else dash.prepend(box);
    renderDashboardQueue();
  }

  function renderDashboardQueue() {
    const box = document.getElementById('erp-flow-dashboard-queue');
    if (!box) return;
    const business = scanBusinessData();
    const q = computeWorkQueue(business);
    const total = q.acceptedQuotes.length + q.activeOrders.length + q.unbilled.length + q.overdue.length;
    const badge = document.getElementById('erp-flow-nav-badge');
    if (badge) badge.textContent = String(total);
    box.innerHTML = `
      <div class="erp-flow-queue-head">
        <div><strong>🧭 งานที่ควรดำเนินการต่อ</strong><small>ระบบสรุปจาก Quote → Order → Fulfillment → Invoice → Billing → Payment</small></div>
        <button type="button" class="btn btn-primary btn-sm" onclick="ERPOrderFlow.open()">เปิดศูนย์งานขาย</button>
      </div>
      <div class="erp-flow-queue-grid">
        ${queueMetric('ใบเสนอราคาพร้อมยืนยัน', q.acceptedQuotes.length, 'สร้าง Sales Order', 'sales-orders')}
        ${queueMetric('Sales Order ที่กำลังดำเนินการ', q.activeOrders.length, 'วางแผน/ติดตามสินค้า', 'sales-orders')}
        ${queueMetric('Invoice ยังไม่วางบิล', q.unbilled.length, 'เตรียมใบวางบิล', 'billing')}
        ${queueMetric('ลูกหนี้เกินกำหนด', q.overdue.length + q.dueBilling.length, 'ติดตามรับชำระ', 'billing', true)}
      </div>`;
  }

  function queueMetric(label, value, hint, tab, danger = false) {
    return `<button type="button" class="erp-flow-queue-metric ${danger && value ? 'is-danger' : ''}" onclick="ERPOrderFlow.openTab('${tab}')">
      <span>${esc(label)}</span><b>${value}</b><small>${esc(hint)}</small>
    </button>`;
  }

  function render(requestedTab) {
    if (!ensureNavAndPanel()) return;
    const root = document.getElementById('erp-flow-root');
    if (!root) return;
    const tab = requestedTab || root.dataset.tab || 'overview';
    root.dataset.tab = tab;
    const business = scanBusinessData();
    const queue = computeWorkQueue(business);
    const store = loadStore();
    const guide = getPrefs().guideMode;
    root.innerHTML = `
      <header class="erp-flow-header">
        <div>
          <span class="erp-flow-kicker">ORDER-TO-CASH WORKSPACE · PROPOSAL V${VERSION}</span>
          <h2>ศูนย์งานขาย & ลูกหนี้</h2>
          <p>หน้าเดียวสำหรับติดตามงานตั้งแต่ใบเสนอราคา → Sales Order → Stock/ผลิต/จัดซื้อ → ส่งสินค้า → วางบิล → รับชำระ</p>
        </div>
        <label class="erp-flow-guide-toggle"><input id="erp-flow-guide-toggle" type="checkbox" ${guide ? 'checked' : ''}> โหมดแนะนำสำหรับผู้ใช้ใหม่</label>
      </header>
      ${guide ? beginnerGuide() : ''}
      <nav class="erp-flow-tabs" aria-label="Order workflow tabs">
        ${tabButton('overview', 'ภาพรวมงาน', tab, queue.acceptedQuotes.length + queue.overdue.length)}
        ${tabButton('sales-orders', 'Sales Order', tab, store.salesOrders.length)}
        ${tabButton('billing', 'วางบิล & รับชำระ', tab, queue.outstandingInvoices.length)}
        ${tabButton('trace', 'ติดตามเอกสาร', tab, 0)}
      </nav>
      <section class="erp-flow-tab-content">
        ${tab === 'overview' ? overviewHtml(business, queue, store) : ''}
        ${tab === 'sales-orders' ? salesOrderHtml(business, store) : ''}
        ${tab === 'billing' ? billingHtml(business, store) : ''}
        ${tab === 'trace' ? traceHtml(business, store) : ''}
      </section>`;
    document.getElementById('erp-flow-guide-toggle')?.addEventListener('change', event => {
      setPrefs({ guideMode: !!event.target.checked }); render(tab);
    });
    bindDynamicEvents(tab);
    renderDashboardQueue();
  }

  function beginnerGuide() {
    return `<div class="erp-flow-guide">
      <b>💡 วิธีคิดของระบบ</b>
      <div class="erp-flow-guide-steps">
        <span><i>1</i>เสนอราคา</span><em>→</em><span><i>2</i>ลูกค้ายืนยัน</span><em>→</em><span><i>3</i>จัดสินค้า</span><em>→</em><span><i>4</i>ส่ง/ออก Invoice</span><em>→</em><span><i>5</i>วางบิล</span><em>→</em><span><i>6</i>รับเงิน/Receipt</span>
      </div>
      <small>ระบบจะแนะนำ “สิ่งที่ควรทำต่อ” ให้แต่ละรายการ คุณไม่จำเป็นต้องจำลำดับเมนูทั้งหมด</small>
    </div>`;
  }

  function tabButton(id, label, active, count) {
    return `<button type="button" class="erp-flow-tab ${id === active ? 'active' : ''}" data-flow-tab="${id}">${esc(label)}${count ? `<b>${count}</b>` : ''}</button>`;
  }

  function overviewHtml(business, queue, store) {
    const outstanding = queue.outstandingInvoices.reduce((s, inv) => s + invoiceOutstanding(inv), 0);
    const billed = store.billingNotes.filter(b => !['cancelled', 'paid'].includes(b.status)).reduce((s, b) => s + num(b.outstandingAmount), 0);
    return `
      <div class="erp-flow-metrics">
        ${metricCard('พร้อมสร้าง Sales Order', queue.acceptedQuotes.length, 'ใบเสนอราคาที่อนุมัติแล้ว', 'blue')}
        ${metricCard('Order กำลังทำ', queue.activeOrders.length, 'ยังไม่ปิดงาน', 'amber')}
        ${metricCard('ลูกหนี้คงค้าง', `฿${money(outstanding)}`, `${queue.outstandingInvoices.length} Invoice`, 'red')}
        ${metricCard('ยอดอยู่ในรอบวางบิล', `฿${money(billed)}`, `${store.billingNotes.filter(b => !['cancelled','paid'].includes(b.status)).length} ใบ`, 'purple')}
      </div>
      <div class="erp-flow-two-col">
        <div class="erp-flow-card">
          <div class="erp-flow-card-head"><div><h3>งานที่ควรทำต่อ</h3><p>เรียงจากงานที่มีผลต่อการส่งสินค้าและกระแสเงินสด</p></div></div>
          ${workQueueRows(queue)}
        </div>
        <div class="erp-flow-card">
          <div class="erp-flow-card-head"><div><h3>เส้นทางเอกสารที่แนะนำ</h3><p>แยก “ขาย” ออกจาก “การจัดสินค้า” เพื่อรองรับ Stock / ผลิต / จัดซื้อ</p></div></div>
          <div class="erp-flow-process-map">
            <div class="erp-process-row"><span>Quotation</span><b>→</b><span class="highlight">Sales Order</span><b>→</b><span>Delivery / Tax Invoice</span><b>→</b><span>Billing</span><b>→</b><span>Payment / Receipt</span></div>
            <div class="erp-process-branch"><i>↳ Fulfillment</i><span>Stock Reservation</span><span>Production</span><span>Purchase / GR</span><i>↲ กลับมารวมก่อนส่งสินค้า</i></div>
          </div>
        </div>
      </div>
      <div class="erp-flow-card">
        <div class="erp-flow-card-head"><div><h3>Sales Order ล่าสุด</h3><p>ทุก Order แสดงสถานะและ Next Best Action</p></div><button class="btn btn-primary btn-sm" data-flow-tab-jump="sales-orders">ดูทั้งหมด</button></div>
        ${orderTable(store.salesOrders.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 8), business)}
      </div>`;
  }

  function metricCard(label, value, sub, tone) {
    return `<article class="erp-flow-metric tone-${tone}"><span>${esc(label)}</span><b>${value}</b><small>${esc(sub)}</small></article>`;
  }

  function workQueueRows(queue) {
    const rows = [];
    if (queue.overdue.length || queue.dueBilling.length) rows.push({ icon: '🔴', title: 'ลูกหนี้เกินกำหนด', desc: `${queue.overdue.length + queue.dueBilling.length} รายการต้องติดตาม`, tab: 'billing', tone: 'red' });
    if (queue.acceptedQuotes.length) rows.push({ icon: '🟢', title: 'ใบเสนอราคาได้รับอนุมัติ', desc: `${queue.acceptedQuotes.length} ใบรอเปลี่ยนเป็น Sales Order`, tab: 'sales-orders', tone: 'green' });
    if (queue.activeOrders.length) rows.push({ icon: '🟠', title: 'Order กำลังจัดสินค้า', desc: `${queue.activeOrders.length} Order รอ Stock / ผลิต / จัดซื้อ / ส่ง`, tab: 'sales-orders', tone: 'amber' });
    if (queue.unbilled.length) rows.push({ icon: '🟣', title: 'Invoice ยังไม่วางบิล', desc: `${queue.unbilled.length} Invoice พร้อมเข้ารอบวางบิล`, tab: 'billing', tone: 'purple' });
    if (!rows.length) return '<div class="erp-flow-empty">✅ ไม่มีงานเร่งด่วนจากข้อมูลปัจจุบัน</div>';
    return `<div class="erp-flow-work-list">${rows.map(r => `<button type="button" class="erp-work-row tone-${r.tone}" data-flow-tab-jump="${r.tab}"><span>${r.icon}</span><div><b>${esc(r.title)}</b><small>${esc(r.desc)}</small></div><em>ดูงาน →</em></button>`).join('')}</div>`;
  }

  function salesOrderHtml(business, store) {
    const converted = new Set(store.salesOrders.flatMap(o => [String(o.sourceQuoteId || ''), String(o.sourceQuoteNo || '')]));
    const availableQuotes = business.quotes.filter(q => !converted.has(String(q.id)) && !converted.has(String(q.no))).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
    return `
      <div class="erp-flow-card">
        <div class="erp-flow-card-head">
          <div><h3>1) เปลี่ยนใบเสนอราคาเป็น Sales Order</h3><p>Sales Order คือจุดยืนยันว่าลูกค้าตกลงซื้อแล้ว จึงเริ่มจอง Stock / ผลิต / จัดซื้อ</p></div>
        </div>
        ${availableQuotes.length ? `<div class="erp-flow-quote-grid">${availableQuotes.slice(0, 12).map(q => quoteCard(q)).join('')}</div>` : '<div class="erp-flow-empty">ไม่มีใบเสนอราคาที่ยังไม่ถูกสร้าง Sales Order</div>'}
      </div>
      <div class="erp-flow-card">
        <div class="erp-flow-card-head"><div><h3>2) Sales Order ทั้งหมด</h3><p>หนึ่ง Order สามารถแบ่งสินค้าไป Stock + ผลิต + จัดซื้อพร้อมกันได้</p></div></div>
        ${orderTable(store.salesOrders.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))), business)}
      </div>`;
  }

  function quoteCard(q) {
    const approved = !!q.approved;
    return `<article class="erp-flow-quote-card ${approved ? 'is-approved' : ''}">
      <div class="erp-flow-quote-top"><b>${esc(q.no || '-')}</b><span class="erp-pill ${approved ? 'green' : 'gray'}">${approved ? 'อนุมัติแล้ว' : 'ยังไม่อนุมัติ'}</span></div>
      <h4>${esc(q.customer || '-')}</h4>
      <p>${dateTh(q.date)} · ${esc(BRANCH_LABEL[q._branch] || q._branch)}</p>
      <strong>฿${money(q.total ?? q.subtotal)}</strong>
      <button type="button" class="btn ${approved ? 'btn-primary' : 'btn-ghost'} btn-sm" ${approved ? '' : 'disabled'} data-create-so='${esc(JSON.stringify(quoteRef(q)))}'>${approved ? 'สร้าง Sales Order →' : 'อนุมัติ Quote ก่อน'}</button>
    </article>`;
  }

  function orderTable(orders, business) {
    if (!orders.length) return '<div class="erp-flow-empty">ยังไม่มี Sales Order</div>';
    return `<div class="tbl-wrap"><table class="erp-flow-table"><thead><tr><th>Sales Order</th><th>ลูกค้า</th><th>กำหนดส่ง</th><th>Fulfillment</th><th>สถานะ</th><th>สิ่งที่ควรทำต่อ</th><th></th></tr></thead><tbody>${orders.map(o => {
      const stage = derivedOrderStage(o, business);
      const next = suggestedNextAction(o, business);
      const mix = fulfillmentSummary(o);
      return `<tr>
        <td><b>${esc(o.no)}</b><small>จาก ${esc(o.sourceQuoteNo || '-')}</small></td>
        <td>${esc(o.customer || '-')}<small>${esc(BRANCH_LABEL[o.branch] || o.branch || '')}</small></td>
        <td>${dateTh(o.requiredDate)}</td>
        <td>${mix}</td>
        <td><span class="erp-pill ${statusTone(stage)}">${esc(STATUS_LABEL[stage] || stage)}</span></td>
        <td><button type="button" class="erp-next-action tone-${next.tone}" ${next.action ? `onclick="${next.action}"` : 'disabled'}>${esc(next.text)}</button></td>
        <td><button type="button" class="btn btn-ghost btn-sm" onclick="ERPOrderFlow.openOrder('${o.id}')">ดู</button></td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function fulfillmentSummary(order) {
    const totals = (order.items || []).reduce((a, i) => {
      a.stock += num(i.stockQty); a.production += num(i.productionQty); a.purchase += num(i.purchaseQty); return a;
    }, { stock: 0, production: 0, purchase: 0 });
    const chips = [];
    if (totals.stock) chips.push(`<span class="erp-mini-chip stock">Stock ${totals.stock}</span>`);
    if (totals.production) chips.push(`<span class="erp-mini-chip production">ผลิต ${totals.production}</span>`);
    if (totals.purchase) chips.push(`<span class="erp-mini-chip purchase">ซื้อ ${totals.purchase}</span>`);
    return chips.join(' ') || '<span class="erp-mini-chip gray">ยังไม่วางแผน</span>';
  }

  function statusTone(status) {
    if (['completed','paid','ready','accepted'].includes(status)) return 'green';
    if (['cancelled'].includes(status)) return 'gray';
    if (['partial','partially_paid','planning'].includes(status)) return 'amber';
    if (['overdue'].includes(status)) return 'red';
    if (['submitted'].includes(status)) return 'purple';
    return 'blue';
  }

  function billingHtml(business, store) {
    const outstanding = business.invoices.filter(inv => invoiceOutstanding(inv) > 0).sort((a,b)=>String(a.dueDate||a.date||'').localeCompare(String(b.dueDate||b.date||'')));
    return `
      <div class="erp-flow-card">
        <div class="erp-flow-card-head">
          <div><h3>Invoice ที่ยังค้างชำระ</h3><p>เลือกหลาย Invoice ของลูกค้ารายเดียวเพื่อรวมเป็นใบวางบิลหนึ่งใบได้</p></div>
          <button type="button" class="btn btn-purple btn-sm" id="erp-create-billing-selected">+ สร้างใบวางบิลจากรายการที่เลือก</button>
        </div>
        ${outstandingInvoiceTable(outstanding)}
      </div>
      <div class="erp-flow-card">
        <div class="erp-flow-card-head"><div><h3>ใบวางบิล</h3><p>ใบวางบิลเป็นเอกสารบริหารลูกหนี้ ไม่เพิ่มยอดขาย ไม่เพิ่ม VAT และไม่ตัด Stock ซ้ำ</p></div></div>
        ${billingTable(store.billingNotes)}
      </div>
      <div class="erp-flow-card">
        <div class="erp-flow-card-head"><div><h3>ประวัติรับชำระ / Payment Allocation</h3><p>รองรับชำระบางส่วนและหนึ่ง Payment จัดสรรได้หลาย Invoice ในชั้น Demo</p></div></div>
        ${paymentTable(store.payments)}
      </div>`;
  }

  function outstandingInvoiceTable(invoices) {
    if (!invoices.length) return '<div class="erp-flow-empty">✅ ไม่มี Invoice ค้างชำระ</div>';
    return `<div class="tbl-wrap"><table class="erp-flow-table"><thead><tr><th></th><th>Invoice</th><th>ลูกค้า</th><th>วันที่/ครบกำหนด</th><th>ยอดเอกสาร</th><th>รับแล้ว</th><th>คงค้าง</th><th>วางบิล</th></tr></thead><tbody>${invoices.map(inv => {
      const allocated = allocatedToInvoice(inv);
      const bills = billingForInvoice(inv).filter(b => b.status !== 'cancelled');
      return `<tr>
        <td><input type="checkbox" class="erp-billing-invoice-check" data-invoice-ref='${esc(JSON.stringify(invoiceRef(inv)))}'></td>
        <td><b>${esc(inv.no || '-')}</b></td><td>${esc(inv.customer || '-')}</td>
        <td>${dateTh(inv.date)}<small>${inv.dueDate ? `ครบ ${dateTh(inv.dueDate)}` : 'ไม่ระบุกำหนด'}</small></td>
        <td class="tn">฿${money(inv.total ?? inv.saleTotal)}</td><td class="tn">฿${money(allocated)}</td><td class="tn neg">฿${money(invoiceOutstanding(inv))}</td>
        <td>${bills.length ? bills.map(b => `<span class="erp-pill ${statusTone(b.status)}">${esc(b.no)}</span>`).join(' ') : '<span class="erp-pill gray">ยังไม่วางบิล</span>'}</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function billingTable(rows) {
    if (!rows.length) return '<div class="erp-flow-empty">ยังไม่มีใบวางบิล</div>';
    return `<div class="tbl-wrap"><table class="erp-flow-table"><thead><tr><th>เลขที่</th><th>ลูกค้า</th><th>วันที่</th><th>กำหนด</th><th>Invoice</th><th>ยอดวางบิล / คงค้าง</th><th>สถานะ</th><th></th></tr></thead><tbody>${rows.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).map(b => `<tr>
      <td><b>${esc(b.no)}</b></td><td>${esc(b.customer)}</td><td>${dateTh(b.billingDate)}</td><td>${dateTh(b.dueDate)}</td>
      <td>${(b.lines||[]).map(l=>`<span class="erp-mini-chip gray">${esc(l.invoiceNo)}</span>`).join(' ')}</td><td class="tn">฿${money(b.totalBilled)}<small>คงค้าง ฿${money(b.outstandingAmount)}</small></td>
      <td><span class="erp-pill ${statusTone(b.status)}">${esc(STATUS_LABEL[b.status] || b.status)}</span></td>
      <td class="erp-row-actions"><button class="btn btn-ghost btn-sm" onclick="ERPOrderFlow.printBilling('${b.id}')">พิมพ์</button><button class="btn btn-green btn-sm" onclick="ERPOrderFlow.receiveBillingPayment('${b.id}')" ${b.status==='paid'?'disabled':''}>รับชำระ</button></td>
    </tr>`).join('')}</tbody></table></div>`;
  }

  function paymentTable(rows) {
    if (!rows.length) return '<div class="erp-flow-empty">ยังไม่มี Payment Allocation ในโมดูลนี้</div>';
    return `<div class="tbl-wrap"><table class="erp-flow-table"><thead><tr><th>เลขอ้างอิง</th><th>วันที่</th><th>ลูกค้า</th><th>วิธีชำระ</th><th>ยอดรับ</th><th>จัดสรร</th><th>จัดการ</th></tr></thead><tbody>${rows.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).map(p => `<tr>
      <td><b>${esc(p.no)}</b></td><td>${dateTh(p.date)}</td><td>${esc(p.customer||'-')}</td><td>${esc(p.method||'-')}</td><td class="tn">฿${money(p.amount)}</td>
      <td>${(p.allocations||[]).map(a=>`<span class="erp-mini-chip green">${esc(a.invoiceNo)} ฿${money(a.amount)}</span>`).join(' ')}</td>
      <td>${p.voided?'ยกเลิกแล้ว':`<button class="btn btn-danger btn-sm" onclick="ERPOrderFlow.voidPayment('${p.id}')">ยกเลิกรับเงิน</button>`}</td>
    </tr>`).join('')}</tbody></table></div>`;
  }

  function traceHtml(business, store) {
    if (!store.salesOrders.length) return '<div class="erp-flow-card"><div class="erp-flow-empty">สร้าง Sales Order ก่อน แล้วระบบจะแสดง Trace ตั้งแต่ Quote ถึง Receipt</div></div>';
    return `<div class="erp-flow-card"><div class="erp-flow-card-head"><div><h3>Document Trace</h3><p>ตรวจย้อนหลังว่าเอกสารแต่ละใบมาจากไหนและขั้นต่อไปคืออะไร</p></div></div><div class="erp-trace-list">${store.salesOrders.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).map(o => traceCard(o, business)).join('')}</div></div>`;
  }

  function traceCard(order, business) {
    const links = linkedDocs(order, business);
    const nodes = [
      { label: 'Quotation', value: order.sourceQuoteNo || '-', done: !!order.sourceQuoteNo },
      { label: 'Sales Order', value: order.no, done: true },
      { label: 'Production', value: links.prods.map(x=>x.no).join(', ') || '-', done: !!links.prods.length, optional: true },
      { label: 'Delivery / Invoice', value: links.invoices.map(x=>x.no).join(', ') || '-', done: !!links.invoices.length },
      { label: 'Billing', value: links.billings.map(x=>x.no).join(', ') || '-', done: !!links.billings.length, optional: order.paymentTerm==='cash' },
      { label: 'Receipt', value: links.receipts.map(x=>x.no).join(', ') || '-', done: !!links.receipts.length }
    ];
    return `<article class="erp-trace-card"><div class="erp-trace-title"><b>${esc(order.no)}</b><span>${esc(order.customer)}</span></div><div class="erp-trace-nodes">${nodes.map((n,i)=>`${i?'<em>→</em>':''}<div class="erp-trace-node ${n.done?'done':''} ${n.optional?'optional':''}"><small>${esc(n.label)}</small><b>${esc(n.value)}</b></div>`).join('')}</div></article>`;
  }

  function bindDynamicEvents(tab) {
    document.querySelectorAll('[data-flow-tab]').forEach(btn => btn.addEventListener('click', () => render(btn.dataset.flowTab)));
    document.querySelectorAll('[data-flow-tab-jump]').forEach(btn => btn.addEventListener('click', () => render(btn.dataset.flowTabJump)));
    document.querySelectorAll('[data-create-so]').forEach(btn => btn.addEventListener('click', () => {
      try { openCreateSalesOrder(JSON.parse(btn.dataset.createSo)); }
      catch (error) { notify('ไม่สามารถเปิดใบเสนอราคานี้ได้', 'error'); }
    }));
    if (tab === 'billing') document.getElementById('erp-create-billing-selected')?.addEventListener('click', createBillingFromSelected);
  }

  function findQuoteByRef(ref) {
    return scanBusinessData().quotes.find(q => q._branch === ref.b && Number(q._year) === Number(ref.y) && Number(q._month) === Number(ref.m) && (String(q.id) === String(ref.id) || String(q.no) === String(ref.no)));
  }

  function openCreateSalesOrder(ref) {
    const q = findQuoteByRef(ref);
    if (!q) return notify('ไม่พบใบเสนอราคาต้นทาง', 'error');
    const store = loadStore();
    const modal = makeModal('ยืนยันคำสั่งซื้อ / Create Sales Order', `
      <div class="erp-modal-note">Sales Order จะถูกสร้างหลังลูกค้ายืนยันซื้อ และเป็นจุดเริ่มการจอง Stock / สั่งผลิต / จัดซื้อ</div>
      <div class="erp-flow-form-grid">
        <label>เลข Sales Order<input id="erp-so-no" value="${esc(nextNumber('SO', store.salesOrders))}"></label>
        <label>วันที่ Order<input id="erp-so-date" type="date" value="${today()}"></label>
        <label>ลูกค้า<input value="${esc(q.customer || '')}" readonly></label>
        <label>Customer PO / เลขที่สั่งซื้อ<input id="erp-so-customer-po" placeholder="ถ้ามี"></label>
        <label>กำหนดส่ง<input id="erp-so-required" type="date"></label>
        <label>เงื่อนไขชำระ<select id="erp-so-payment"><option value="credit">เครดิต / วางบิล</option><option value="cash">เงินสด / ชำระทันที</option></select></label>
        <label>เครดิต (วัน)<input id="erp-so-credit" type="number" min="0" value="30"></label>
        <label>ผู้รับผิดชอบ<input id="erp-so-owner" value="${esc(q.salesPerson || '')}"></label>
      </div>
      <h4 class="erp-modal-subtitle">รายการจาก ${esc(q.no)}</h4>
      <div class="tbl-wrap"><table class="erp-flow-table"><thead><tr><th>สินค้า</th><th>จำนวน</th><th>หน่วย</th><th>ราคาขาย</th></tr></thead><tbody>${(q.items||[]).map(it=>`<tr><td>${esc(it.product||'-')}</td><td>${num(it.qty)}</td><td>${esc(it.unit||'')}</td><td class="tn">฿${money(it.priceUnit ?? (num(it.qty)?num(it.total)/num(it.qty):0))}</td></tr>`).join('')}</tbody></table></div>
      <label class="erp-flow-note-label">หมายเหตุ<textarea id="erp-so-note" rows="2" placeholder="ข้อกำหนดการส่งสินค้า / ผู้ติดต่อ / เงื่อนไขพิเศษ"></textarea></label>
    `, [
      { label: 'ยกเลิก', cls: 'btn btn-ghost', action: closeModal },
      { label: 'ยืนยันและวางแผนสินค้า →', cls: 'btn btn-primary', action: () => saveSalesOrderFromQuote(q, ref) }
    ]);
    modal.querySelector('#erp-so-required').value = q.dueDate || '';
  }

  function saveSalesOrderFromQuote(q, ref) {
    const no = document.getElementById('erp-so-no')?.value.trim();
    const orderDate = document.getElementById('erp-so-date')?.value;
    if (!no || !orderDate) return notify('กรุณาระบุเลข Sales Order และวันที่', 'error');
    const store = loadStore();
    if(!q.approved)return notify('กรุณาอนุมัติใบเสนอราคาก่อน','error');
    if(store.salesOrders.some(o=>o.status!=='cancelled'&&o.branch===ref.b&&String(o.sourceQuoteId)===String(q.id)))return notify('ใบเสนอราคานี้มี Sales Order แล้ว','error');
    try{window.ERPIntegrity.validateItems(q.items);}catch(e){return notify(e.message,'error');}
    if (store.salesOrders.some(o => String(o.no).toLowerCase() === no.toLowerCase())) return notify('เลข Sales Order ซ้ำในโมดูล Demo', 'error');
    const items = (q.items || []).map((it, index) => ({
      id: uid(`sol${index}`), product: it.product || '', productCode: it.productCode || '', category: it.productCategory || '',
      qty: num(it.qty), unit: it.unit || 'ชิ้น', priceUnit: num(it.priceUnit ?? (num(it.qty) ? num(it.total) / num(it.qty) : 0)),
      onHand: 0, stockQty: 0, productionQty: 0, purchaseQty: 0, readyQty: 0, deliveredQty: 0
    }));
    const order = {
      id: uid('so'), no, orderDate, customer: q.customer || '', customerAddress:q.customerAddress||'',customerTaxId:q.customerTaxId||'',contact:q.contact||'',phone:q.phone||'',email:q.email||'',salesPerson:q.salesPerson||'',customerId:q.customerId||'',branch: ref.b,
      sourceQuoteId: q.id, sourceQuoteNo: q.no, sourceQuoteBranch: ref.b, sourceQuoteYear: ref.y, sourceQuoteMonth: ref.m,
      customerPoNo: document.getElementById('erp-so-customer-po')?.value.trim() || '',
      requiredDate: document.getElementById('erp-so-required')?.value || '',
      paymentTerm: document.getElementById('erp-so-payment')?.value || 'credit',
      creditDays: num(document.getElementById('erp-so-credit')?.value),
      owner: document.getElementById('erp-so-owner')?.value.trim() || '',
      note: document.getElementById('erp-so-note')?.value.trim() || '',
      subtotal: num(q.subtotal), vatAmt: num(q.vatAmt), total: num(q.total ?? q.subtotal), vatMode:q.vatMode||(num(q.useVat)===1?'add':'none'), useVat:q.vatMode==='extract'?0:(num(q.useVat)===1?1:2),
      items, status: 'confirmed', createdAt: nowIso(), updatedAt: nowIso()
    };
    store.salesOrders.push(order);
    store.activity.unshift({ id: uid('act'), action: 'sales_order_created', at: nowIso(), orderId: order.id, orderNo: order.no, quoteNo: q.no });
    saveStore(store); closeModal(); notify(`สร้าง ${order.no} เรียบร้อย`, 'success'); openFulfillment(order.id);
  }

  function openFulfillment(orderId) {
    const order = getOrder(orderId);
    if (!order) return notify('ไม่พบ Sales Order', 'error');
    makeModal(`วางแผนสินค้า · ${order.no}`, `
      <div class="erp-modal-note"><b>${esc(order.customer)}</b> · ต้องการส่ง ${dateTh(order.requiredDate)}<br>ยอดพร้อมใช้หักการจองของงานอื่นแล้ว · ระบุจำนวนพร้อมส่งหลังตรวจรับสินค้า</div>
      <div class="tbl-wrap"><table class="erp-flow-table erp-fulfillment-table"><thead><tr><th>สินค้า</th><th>ต้องการ</th><th>Stock พร้อมใช้</th><th>วิธีจัดสินค้า</th><th>จาก Stock</th><th>ผลิต</th><th>จัดซื้อ</th><th>พร้อมส่งสะสม</th></tr></thead><tbody>${(order.items||[]).map((it,idx)=>fulfillmentRow(it,idx,order.branch,order.id)).join('')}</tbody></table></div>
      <div class="erp-flow-callout"><b>หลักการ:</b> Stock เป็นทรัพยากร ไม่ใช่เอกสารขาย — เมื่อ Order ยืนยันจึง “จอง” และเมื่อลง Delivery จึง “ตัดจริง”</div>
    `, [
      { label: 'ปิด', cls: 'btn btn-ghost', action: closeModal },
      { label: 'บันทึกแผน Fulfillment', cls: 'btn btn-primary', action: () => saveFulfillment(orderId) }
    ]);
    document.querySelectorAll('.erp-fulfillment-method').forEach(sel => sel.addEventListener('change', recalcFulfillmentRows));
    recalcFulfillmentRows();
  }

  function fulfillmentRow(it, idx, branch, orderId) {
    const method = it.fulfillmentMethod || 'stock_purchase';
    const liveStock = currentStockForItem(it, branch, orderId);
    const onHand = liveStock + num(it.deliveredQty);
    return `<tr data-fulfillment-row="${idx}" data-qty="${num(it.qty)}" data-delivered="${num(it.deliveredQty)}">
      <td><b>${esc(it.product||'-')}</b><small>${esc(it.productCode||'')}</small></td><td>${num(it.qty)} ${esc(it.unit||'')}</td>
      <td><input class="erp-fulfillment-onhand ro" type="number" readonly value="${num(onHand)}"><small class="erp-flow-stock-hint">พร้อมใช้ + ส่งไปแล้ว ${num(it.deliveredQty)}</small></td>
      <td><select class="erp-fulfillment-method">
        <option value="stock_purchase" ${method==='stock_purchase'?'selected':''}>Stock ก่อน → ซื้อส่วนขาด</option>
        <option value="stock_production" ${method==='stock_production'?'selected':''}>Stock ก่อน → ผลิตส่วนขาด</option>
        <option value="purchase" ${method==='purchase'?'selected':''}>จัดซื้อทั้งหมด</option>
        <option value="production" ${method==='production'?'selected':''}>ผลิตทั้งหมด</option>
        <option value="stock" ${method==='stock'?'selected':''}>ใช้ Stock เท่านั้น</option>
      </select></td>
      <td><b data-stock>${num(it.stockQty)}</b></td><td><b data-production>${num(it.productionQty)}</b></td><td><b data-purchase>${num(it.purchaseQty)}</b></td><td><input class="erp-fulfillment-ready" aria-label="จำนวนพร้อมส่งสะสม" type="number" min="${num(it.deliveredQty)}" max="${num(it.qty)}" step="0.01" value="${num(it.readyQty)}"><small>ส่งแล้ว ${num(it.deliveredQty)}</small></td>
    </tr>`;
  }

  function recalcFulfillmentRows() {
    document.querySelectorAll('[data-fulfillment-row]').forEach(row => {
      const qty = num(row.dataset.qty);
      const onHand = Math.max(0, num(row.querySelector('.erp-fulfillment-onhand')?.value));
      const method = row.querySelector('.erp-fulfillment-method')?.value || 'stock_purchase';
      let stock = 0, production = 0, purchase = 0;
      if (method === 'stock') stock = Math.min(qty, onHand);
      if (method === 'purchase') purchase = qty;
      if (method === 'production') production = qty;
      if (method === 'stock_purchase') { stock = Math.min(qty, onHand); purchase = Math.max(0, qty - stock); }
      if (method === 'stock_production') { stock = Math.min(qty, onHand); production = Math.max(0, qty - stock); }
      row.querySelector('[data-stock]').textContent = stock;
      row.querySelector('[data-production]').textContent = production;
      row.querySelector('[data-purchase]').textContent = purchase;
    });
  }

  function saveFulfillment(orderId) {
    const store=loadStore(),order=store.salesOrders.find(o=>o.id===orderId);if(!order)return;
    const progress=window.ERPIntegrity.orderProgress(order), requests=new Map();
    try{
      document.querySelectorAll('[data-fulfillment-row]').forEach(row=>{
        const i=order.items[Number(row.dataset.fulfillmentRow)],old=progress.items[Number(row.dataset.fulfillmentRow)];if(!i)return;
        i.stockQty=num(row.querySelector('[data-stock]')?.textContent);i.productionQty=num(row.querySelector('[data-production]')?.textContent);i.purchaseQty=num(row.querySelector('[data-purchase]')?.textContent);
        if(Math.abs(i.stockQty+i.productionQty+i.purchaseQty-num(i.qty))>0.000001)throw new Error('แผนจัดสินค้าต้องครบจำนวนสั่งซื้อ');
        i.fulfillmentMethod=row.querySelector('.erp-fulfillment-method').value;
        const entered=num(row.querySelector('.erp-fulfillment-ready')?.value);
        i.readyQty=Math.max(entered,i.stockQty,old.deliveredQty);i.deliveredQty=old.deliveredQty;
        if(i.readyQty>num(i.qty))throw new Error('จำนวนพร้อมส่งเกินจำนวนสั่งซื้อ');
        const p=productForItem(i),k=window.ERPIntegrity.productKey(i);
        if(p?.flowType==='inventory'&&p?.fulfillmentType==='stock')requests.set(k,{p,qty:(requests.get(k)?.qty||0)+Math.max(0,Math.max(i.stockQty,i.readyQty)-old.deliveredQty)});
        i.stockCheckedAt=nowIso();delete i.onHandSnapshot;
      });
      requests.forEach(({p,qty})=>{if(qty>window.ERPIntegrity.availableStock(p,order.branch,order.id)+0.000001)throw new Error('สต๊อกพร้อมใช้เปลี่ยนแปลงหรือไม่เพียงพอ กรุณาเปิดแผนใหม่');});
      order.updatedAt=nowIso();order.status='planning';
      store.reservations=store.reservations.filter(r=>r.orderId!==orderId);
      order.items.forEach(i=>{if(i.stockQty>0)store.reservations.push({id:uid('res'),orderId,branch:order.branch,product:i.product,productCode:i.productCode,qty:i.stockQty,status:'reserved'});});
      saveStore(store);closeModal();notify('บันทึกแผนและจำนวนพร้อมส่งแล้ว','success');render('sales-orders');
    }catch(e){notify(e.message,'error');}
  }

  function openOrder(orderId) {
    const order = getOrder(orderId); if (!order) return;
    const business = scanBusinessData(); const links = linkedDocs(order, business); const next = suggestedNextAction(order, business);
    makeModal(`${order.no} · ${order.customer}`, `
      <div class="erp-order-detail-grid">
        <div><small>จากใบเสนอราคา</small><b>${esc(order.sourceQuoteNo||'-')}</b></div><div><small>Customer PO</small><b>${esc(order.customerPoNo||'-')}</b></div>
        <div><small>Order Date</small><b>${dateTh(order.orderDate)}</b></div><div><small>Required Date</small><b>${dateTh(order.requiredDate)}</b></div>
        <div><small>Payment</small><b>${order.paymentTerm==='cash'?'เงินสด':`เครดิต ${num(order.creditDays)} วัน`}</b></div><div><small>ยอด Order</small><b>฿${money(order.total)}</b></div>
      </div>
      <div class="erp-flow-callout tone-${next.tone}"><b>สิ่งที่ควรทำต่อ:</b> ${esc(next.text)}</div>
      <h4 class="erp-modal-subtitle">Fulfillment</h4>
      <div class="tbl-wrap"><table class="erp-flow-table"><thead><tr><th>สินค้า</th><th>Order</th><th>Stock</th><th>ผลิต</th><th>ซื้อ</th></tr></thead><tbody>${(order.items||[]).map(it=>`<tr><td>${esc(it.product)}</td><td>${num(it.qty)} ${esc(it.unit||'')}</td><td>${num(it.stockQty)}</td><td>${num(it.productionQty)}</td><td>${num(it.purchaseQty)}</td></tr>`).join('')}</tbody></table></div>
      <h4 class="erp-modal-subtitle">เอกสารที่เชื่อมแล้ว</h4>
      <div class="erp-linked-summary"><span>Production <b>${links.prods.length}</b></span><span>Invoice <b>${links.invoices.length}</b></span><span>Billing <b>${links.billings.length}</b></span><span>Receipt <b>${links.receipts.length}</b></span></div>
      <div class="erp-order-actions">
        <button class="btn btn-primary" onclick="ERPOrderFlow.openFulfillment('${order.id}')">วางแผน Fulfillment</button>
        ${order.items.some(i=>num(i.productionQty)>0) && order.sourceQuoteId ? `<button class="btn btn-purple" onclick="ERPOrderFlow.createProduction('${order.id}')">เปิดฟอร์มสั่งผลิตจาก Quote</button>` : ''}
        ${order.items.some(i=>num(i.purchaseQty)>0) ? `<button class="btn btn-amber" onclick="ERPOrderFlow.createPurchaseOrder('${order.id}')">เตรียม PO จากส่วนที่ต้องซื้อ</button>` : ''}
        <button class="btn btn-ghost" onclick="ERPOrderFlow.markReady('${order.id}')">✓ ยืนยันตรวจรับและพร้อมส่งครบ</button>
        <button class="btn btn-green" onclick="ERPOrderFlow.prepareDelivery('${order.id}')">เตรียมใบส่งสินค้า</button>
        ${links.invoices.length && order.paymentTerm!=='cash' ? `<button class="btn btn-ghost" onclick="ERPOrderFlow.openBillingForOrder('${order.id}')">วางบิล</button>` : ''}
      </div>
    `, [{ label: 'ปิด', cls: 'btn btn-ghost', action: closeModal }]);
  }

  function createProduction(orderId) {
    const order = getOrder(orderId); if (!order) return;
    if (typeof window.useQuoteForProduction === 'function' && order.sourceQuoteId) {
      if(scanBusinessData().productions.some(p=>window.ERPIntegrity.live(p)&&p.sourceSalesOrderId===order.id))return notify('มีใบสั่งผลิตของ SO นี้แล้ว กรุณาเปิดแก้ไขรายการเดิม','error');
      closeModal();window.resetProduction?.();
      window.useQuoteForProduction(order.sourceQuoteBranch || order.branch, Number(order.sourceQuoteYear), Number(order.sourceQuoteMonth), order.sourceQuoteId);
      window.ERPPreparedProductionOrderId=order.id;
      const body=document.getElementById('p-items-body');if(body)body.innerHTML='';
      order.items.filter(i=>num(i.productionQty)>0).forEach(i=>window.addPItem?.({...i,salesOrderLineId:i.id,qty:num(i.productionQty),saleValue:i.priceUnit,costMode:'unit',costValue:num(productForItem(i)?.standardCost)}));window.calcP?.();
      setTimeout(() => {
        const note = document.getElementById('p-note');
        if (note && !String(note.value).includes(order.no)) note.value = `${note.value ? note.value + ' — ' : ''}Sales Order ${order.no}`;
        notify(`เปิดฟอร์มสั่งผลิตจาก ${order.sourceQuoteNo} แล้ว เติมเฉพาะรายการและจำนวนที่ต้องผลิตตาม ${order.no}`, 'info');
      }, 100);
    } else notify('เวอร์ชัน app.js นี้ยังไม่รองรับการดึง Quote ไปฟอร์มสั่งผลิตอัตโนมัติ', 'error');
  }

  function createPurchaseOrder(orderId) {
    const order = getOrder(orderId); if (!order) return;
    const items = (order.items || []).filter(i => num(i.purchaseQty) > 0);
    if (!items.length) return notify('Sales Order นี้ไม่มีรายการที่ต้องจัดซื้อ', 'info');
    closeModal();
    if (typeof window.go === 'function') window.go('purchase-order');
    setTimeout(() => {
      try { window.pcResetPo?.(); const br=document.getElementById('po-branch');if(br)br.value=order.branch; } catch (_) {}
      const branch = document.getElementById('po-branch'); if (branch) branch.value = order.branch || 'ubon';
      const expected = document.getElementById('po-expected'); if (expected && order.requiredDate) expected.value = order.requiredDate;
      const body = document.getElementById('po-items-body'); if (body) body.innerHTML = '';
      items.forEach(it => window.pcAddPoItem?.({ product: it.product, productCode:it.productCode, qty: num(it.purchaseQty), unit: it.unit || 'ชิ้น' }));
      const note = document.getElementById('po-note');
      if (note) note.value = `อ้างอิง Sales Order ${order.no} / ลูกค้า ${order.customer}${order.sourceQuoteNo ? ` / Quote ${order.sourceQuoteNo}` : ''}`;
      window.pcCalcPo?.();
      notify(`เตรียม PO จาก ${order.no} แล้ว กรุณาเลือกผู้จำหน่ายและตรวจต้นทุนก่อนบันทึก`, 'success');
    }, 100);
  }

  function markReady(orderId) {
    const store=loadStore(),order=store.salesOrders.find(o=>o.id===orderId);if(!order)return;
    const progress=window.ERPIntegrity.orderProgress(order), requests=new Map();
    for(const i of progress.items){
      if(num(i.stockQty)+num(i.productionQty)+num(i.purchaseQty)<num(i.qty))return notify('กรุณาบันทึกแผนจัดสินค้าให้ครบก่อน','error');
      const p=productForItem(i),k=window.ERPIntegrity.productKey(i);
      if(p?.flowType==='inventory'&&p?.fulfillmentType==='stock')requests.set(k,{p,qty:(requests.get(k)?.qty||0)+i.remainingQty});
    }
    for(const {p,qty} of requests.values())if(qty>window.ERPIntegrity.availableStock(p,order.branch,order.id)+0.000001)return notify('สต๊อกยังไม่ครบ กรุณารับสินค้าหรือผลิตและรับเข้าคลังก่อน','error');
    if(!confirm('ยืนยันว่าสินค้าผ่านการตรวจรับ/ผลิตเสร็จ และพร้อมส่งครบตามใบสั่งขายแล้ว?'))return;
    order.items.forEach(i=>i.readyQty=num(i.qty));order.updatedAt=nowIso();order.status='ready';saveStore(store);closeModal();render('sales-orders');
  }

  function prepareDelivery(orderId) {
    const order=getOrder(orderId);if(!order||order.status==='cancelled')return;
    const rows=order.items.map(it=>({it,qty:Math.min(it.remainingQty,Math.max(0,num(it.readyQty)-it.deliveredQty))})).filter(x=>x.qty>0);
    if(!rows.length)return notify('ยังไม่มีจำนวนพร้อมส่งที่เหลือ กรุณาตรวจแผนและจำนวนพร้อมส่ง','info');
    window.resetF?.('invoice');window.go?.('invoice-form');window.selBr?.('i',order.branch);
    window.ERPPreparedSalesOrderId=order.id;
    const set=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v??'';};
    for(const [id,field] of [['i-cust','customer'],['i-address','customerAddress'],['i-tax-id','customerTaxId'],['i-contact','contact'],['i-phone','phone'],['i-email','email'],['i-sales','salesPerson']])set(id,order[field]||'');
    set('i-vat',order.vatMode==='none'?2:order.useVat);
    set('i-credit-term',order.paymentTerm==='cash'?'cash':'credit'+String(order.creditDays));
    const date=document.getElementById('i-date')?.value||today(),due=new Date(`${date}T00:00:00`);due.setDate(due.getDate()+(order.paymentTerm==='cash'?0:num(order.creditDays)));
    set('i-due-date',`${due.getFullYear()}-${String(due.getMonth()+1).padStart(2,'0')}-${String(due.getDate()).padStart(2,'0')}`);
    const body=document.getElementById('i-items-body');if(body)body.innerHTML='';
    rows.forEach(({it,qty})=>window.addIItem?.({...it,qty,salesOrderLineId:it.id,costMode:'unit',costValue:num(productForItem(it)?.standardCost)}));
    set('i-note',`อ้างอิง Sales Order ${order.no} / Quote ${order.sourceQuoteNo||'-'}`);window.calcI?.();closeModal();notify('เตรียมใบส่งสินค้าจากจำนวนค้างส่งแล้ว','success');
  }

  function openBillingForOrder(orderId) {
    const order = getOrder(orderId); if (!order) return;
    const links = linkedDocs(order, scanBusinessData());
    render('billing'); showPanel('billing');
    setTimeout(() => {
      document.querySelectorAll('.erp-billing-invoice-check').forEach(chk => {
        try { const ref = JSON.parse(chk.dataset.invoiceRef); chk.checked = links.invoices.some(inv => String(inv.id) === String(ref.id) || String(inv.no) === String(ref.no)); }
        catch (_) {}
      });
      document.getElementById('erp-create-billing-selected')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  }

  function findInvoiceByRef(ref) {
    return scanBusinessData().invoices.find(inv => inv._branch === ref.b && (String(inv.id) === String(ref.id) || String(inv.no) === String(ref.no)));
  }

  function createBillingFromSelected() {
    const refs = [...document.querySelectorAll('.erp-billing-invoice-check:checked')].map(chk => {
      try { return JSON.parse(chk.dataset.invoiceRef); } catch (_) { return null; }
    }).filter(Boolean);
    if (!refs.length) return notify('กรุณาเลือก Invoice อย่างน้อย 1 ใบ', 'error');
    const invoices = refs.map(findInvoiceByRef).filter(Boolean);
    if (!invoices.length) return notify('ไม่พบ Invoice ที่เลือก', 'error');
    if(new Set(invoices.map(i=>i._branch)).size!==1)return notify('กรุณาเลือกบิลจากสาขาเดียวกัน','error');
    const customers = new Set(invoices.map(inv => String(inv.customer || '').trim()));
    if (customers.size !== 1) return notify('ใบวางบิลหนึ่งใบควรรวม Invoice ของลูกค้ารายเดียวกัน', 'error');
    const store = loadStore(); const customer = invoices[0].customer || '';
    makeModal('สร้างใบวางบิล / Billing Note', `
      <div class="erp-modal-note">ใบวางบิลนี้เป็นเอกสารเรียกเก็บเงินเท่านั้น <b>ไม่เพิ่มยอดขาย / VAT / Stock</b></div>
      <div class="erp-flow-form-grid">
        <label>เลขที่ใบวางบิล<input id="erp-bill-no" value="${esc(nextNumber('BL', store.billingNotes))}"></label>
        <label>วันที่วางบิล<input id="erp-bill-date" type="date" value="${today()}"></label>
        <label>ลูกค้า<input value="${esc(customer)}" readonly></label>
        <label>วันนัดรับวางบิล<input id="erp-bill-appointment" type="date"></label>
        <label>กำหนดชำระ<input id="erp-bill-due" type="date"></label>
        <label>ผู้รับเอกสาร/แผนก<input id="erp-bill-recipient" placeholder="เช่น ฝ่ายการเงิน"></label>
      </div>
      <div class="tbl-wrap"><table class="erp-flow-table"><thead><tr><th>Invoice</th><th>วันที่</th><th>ยอดเดิม</th><th>คงค้าง</th><th>ยอดวางบิล</th></tr></thead><tbody>${invoices.map((inv,idx)=>`<tr data-billing-line="${idx}"><td><b>${esc(inv.no)}</b></td><td>${dateTh(inv.date)}</td><td class="tn">฿${money(inv.total??inv.saleTotal)}</td><td class="tn">฿${money(invoiceOutstanding(inv))}</td><td><input class="erp-bill-amount" type="number" min="0" max="${invoiceOutstanding(inv)}" step="0.01" value="${invoiceOutstanding(inv)}"></td></tr>`).join('')}</tbody></table></div>
      <label class="erp-flow-note-label">หมายเหตุ<textarea id="erp-bill-note" rows="2"></textarea></label>
    `, [
      { label: 'ยกเลิก', cls: 'btn btn-ghost', action: closeModal },
      { label: 'บันทึกใบวางบิล', cls: 'btn btn-purple', action: () => saveBilling(invoices) }
    ]);
  }

  function saveBilling(invoices) {
    invoices=invoices.map(i=>window.ERPIntegrity.resolveInvoice(i)).filter(Boolean);
    if(!invoices.length)return notify('ไม่พบบิลต้นทาง','error');
    if(new Set(invoices.map(i=>i._branch+'|'+String(i.customer).trim())).size!==1)return notify('ใบวางบิลต้องเป็นลูกค้าและสาขาเดียวกัน','error');
    if(invoices.some(i=>!window.ERPIntegrity.live(i)))return notify('มีบิลที่ยกเลิกแล้ว กรุณาเลือกใหม่','error');
    if(loadStore().billingNotes.some(b=>!['cancelled','paid'].includes(b.status)&&(b.lines||[]).some(l=>invoices.some(i=>window.ERPIntegrity.matchesAllocation(l,i,b)))))return notify('มี Invoice อยู่ในใบวางบิลที่ยังไม่ปิดแล้ว กรุณาใช้ใบวางบิลเดิม','error');
    const no = document.getElementById('erp-bill-no')?.value.trim(); if (!no) return notify('กรุณาระบุเลขใบวางบิล', 'error');
    const store = loadStore(); if (store.billingNotes.some(b => String(b.no).toLowerCase() === no.toLowerCase())) return notify('เลขใบวางบิลซ้ำ', 'error');
    const lines = invoices.map((inv, idx) => ({
      invoiceId: inv.id, invoiceNo: inv.no, branch: inv._branch, year: inv._year, month: inv._month, invoiceDate: inv.date,
      originalAmount: num(inv.total ?? inv.saleTotal), outstandingAmount: invoiceOutstanding(inv),receiptPaidAtCreation:window.ERPIntegrity.receiptPaidAmount(inv),
      billedAmount: Math.min(invoiceOutstanding(inv), Math.max(0, num(document.querySelector(`[data-billing-line="${idx}"] .erp-bill-amount`)?.value)))
    })).filter(line => line.billedAmount > 0);
    if (!lines.length) return notify('ยอดวางบิลต้องมากกว่า 0', 'error');
    const billing = {
      id: uid('bill'), no, customer: invoices[0].customer || '', branch: invoices[0]._branch,
      billingDate: document.getElementById('erp-bill-date')?.value || today(),
      appointmentDate: document.getElementById('erp-bill-appointment')?.value || '',
      dueDate: document.getElementById('erp-bill-due')?.value || invoices.map(i=>i.dueDate).filter(Boolean).sort().slice(-1)[0] || '',
      recipient: document.getElementById('erp-bill-recipient')?.value.trim() || '',
      note: document.getElementById('erp-bill-note')?.value.trim() || '',
      lines, totalBilled: lines.reduce((s,l)=>s+l.billedAmount,0), status: 'draft', createdAt: nowIso(), updatedAt: nowIso()
    };
    store.billingNotes.push(billing); store.activity.unshift({ id: uid('act'), action: 'billing_created', at: nowIso(), billingId: billing.id, billingNo: billing.no }); saveStore(store);
    closeModal(); notify(`สร้างใบวางบิล ${billing.no} แล้ว`, 'success'); render('billing');
  }

  function receiveBillingPayment(billingId) {
    const billing=getBilling(billingId);if(!billing||billing.status==='cancelled')return;
    const store=loadStore();
    const lines=(billing.lines||[]).map(l=>{
      const inv=window.ERPIntegrity.resolveInvoice(l);
      const paid=store.payments.filter(p=>window.ERPIntegrity.live(p)&&p.billingId===billing.id).reduce((s,p)=>s+(p.allocations||[]).filter(a=>inv&&window.ERPIntegrity.matchesAllocation(a,inv,p)).reduce((v,a)=>v+num(a.amount),0),0);
      return {...l,currentOutstanding:inv?Math.max(0,Math.min(num(l.outstandingAmount),invoiceOutstanding(inv))):0};
    });
    const max=lines.reduce((s,l)=>s+l.currentOutstanding,0);if(max<=0)return notify('ใบวางบิลนี้ไม่มีคงค้างแล้ว','info');
    makeModal(`รับชำระ · ${billing.no}`,`<div class="erp-flow-form-grid"><label>เลขอ้างอิง Payment<input id="erp-pay-no" value="${esc(nextNumber('PAY',store.payments))}"></label><label>วันที่รับเงิน<input id="erp-pay-date" type="date" value="${today()}"></label><label>วิธีชำระ<select id="erp-pay-method"><option>โอนเงิน</option><option>เช็ค</option><option>เงินสด</option></select></label><label>ยอดรับรวม<input id="erp-pay-total" type="number" min="0.01" max="${max}" step="0.01" value="${max}"></label></div><p>จัดสรรเงินให้แต่ละบิลตามลำดับ และสร้างใบเสร็จจากยอดรับจริงอัตโนมัติ</p>`,[{label:'ยกเลิก',cls:'btn btn-ghost',action:closeModal},{label:'บันทึกรับชำระและใบเสร็จ',cls:'btn btn-green',action:()=>saveBillingPayment(billing,lines)}]);
  }

  function saveBillingPayment(billing, lines) {
    try{
      const amount=window.ERPIntegrity.round(document.getElementById('erp-pay-total')?.value),store=loadStore();
      if(amount<=0)throw new Error('ยอดรับชำระต้องมากกว่า 0');
      const target=store.billingNotes.find(b=>b.id===billing.id);if(!target||target.status==='cancelled')throw new Error('ไม่พบใบวางบิลที่รับชำระได้');
      const no=document.getElementById('erp-pay-no')?.value.trim();if(!no||store.payments.some(p=>p.no===no))throw new Error('เลข Payment ว่างหรือซ้ำ');
      let left=amount;const allocations=[];
      target.lines.forEach(line=>{
        const inv=window.ERPIntegrity.resolveInvoice(line);if(!inv)return;
        const paid=store.payments.filter(p=>window.ERPIntegrity.live(p)&&p.billingId===target.id).reduce((s,p)=>s+(p.allocations||[]).filter(a=>window.ERPIntegrity.matchesAllocation(a,inv,p)).reduce((v,a)=>v+num(a.amount),0),0);
        const available=Math.max(0,Math.min(num(line.outstandingAmount),invoiceOutstanding(inv)));
        const value=window.ERPIntegrity.round(Math.min(left,available));
        if(value>0)allocations.push({invoiceId:inv.id,invoiceNo:inv.no,branch:inv._branch,year:inv._year,month:inv._month,amount:value});
        left=window.ERPIntegrity.round(left-value);
      });
      if(left>0)throw new Error('ยอดรับเกินยอดค้างปัจจุบัน กรุณาเปิดหน้ารับเงินใหม่');
      const payment={id:uid('pay'),no,date:document.getElementById('erp-pay-date')?.value||today(),branch:target.branch,customer:target.customer,billingId:target.id,billingNo:target.no,method:document.getElementById('erp-pay-method')?.value||'โอนเงิน',amount,allocations,createdAt:nowIso()};
      store.payments.push(payment);target.paidAmount=window.ERPIntegrity.round(store.payments.filter(p=>window.ERPIntegrity.live(p)&&p.billingId===target.id).reduce((s,p)=>s+num(p.amount),0));target.status=target.paidAmount>=num(target.totalBilled)?'paid':'partially_paid';target.updatedAt=nowIso();
      const receipts=window.ERPIntegrity.createPaymentReceipts(payment,store);window.ERPIntegrity.reconcilePayments();saveStore(store);closeModal();window.onYearChange?.();window.renderDash?.();notify(`รับเงินและสร้างใบเสร็จ ${receipts.map(r=>r.no).join(', ')} แล้ว`,'success');render('billing');
    }catch(e){notify(e.message,'error');}
  }

  function printBilling(billingId) {
    const b = getBilling(billingId); if (!b) return;
    const popup = window.open('', '_blank', 'width=980,height=760');
    if (!popup) return notify('Browser บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต Pop-up', 'error');
    popup.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(b.no)}</title><style>body{font-family:Tahoma,sans-serif;color:#1f2937;margin:32px}.head{display:flex;justify-content:space-between;border-bottom:3px solid #6b21a8;padding-bottom:12px}.head h1{margin:0;color:#6b21a8}.meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:20px 0}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d1d5db;padding:9px}th{background:#f5f3ff}.num{text-align:right}.total{font-size:20px;font-weight:bold;text-align:right;margin-top:18px}.note{margin-top:24px;padding:12px;background:#f8fafc}@media print{button{display:none}}</style></head><body><div class="head"><div><small>EXAMPLE COMPANY ERP · DEMO</small><h1>ใบวางบิล / BILLING NOTE</h1></div><div><b>${esc(b.no)}</b><br>${dateTh(b.billingDate)}</div></div><div class="meta"><div><b>ลูกค้า:</b> ${esc(b.customer)}</div><div><b>กำหนดชำระ:</b> ${dateTh(b.dueDate)}</div><div><b>ผู้รับเอกสาร:</b> ${esc(b.recipient||'-')}</div><div><b>วันนัดวางบิล:</b> ${dateTh(b.appointmentDate)}</div></div><table><thead><tr><th>Invoice</th><th>วันที่</th><th>ยอดเดิม</th><th>ยอดวางบิล</th></tr></thead><tbody>${(b.lines||[]).map(l=>`<tr><td>${esc(l.invoiceNo)}</td><td>${dateTh(l.invoiceDate)}</td><td class="num">${money(l.originalAmount)}</td><td class="num">${money(l.billedAmount)}</td></tr>`).join('')}</tbody></table><div class="total">รวมยอดวางบิล ฿${money(b.totalBilled)}</div><div class="note">หมายเหตุ: ${esc(b.note||'-')}<br><small>เอกสารนี้เป็น Demo Billing Note และไม่เพิ่มยอดขาย/VAT/Stock</small></div><p><button onclick="window.print()">พิมพ์</button></p></body></html>`);
    popup.document.close();
  }

  let activeModal = null;
  function makeModal(title, bodyHtml, actions = []) {
    closeModal();
    const overlay = document.createElement('div'); overlay.className = 'erp-flow-modal-overlay';
    overlay.innerHTML = `<div class="erp-flow-modal" role="dialog" aria-modal="true"><button type="button" class="erp-flow-modal-x" aria-label="ปิด">×</button><div class="erp-flow-modal-head"><h3>${esc(title)}</h3></div><div class="erp-flow-modal-body">${bodyHtml}</div><div class="erp-flow-modal-actions"></div></div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
    overlay.querySelector('.erp-flow-modal-x').addEventListener('click', closeModal);
    const footer = overlay.querySelector('.erp-flow-modal-actions');
    actions.forEach(item => { const btn = document.createElement('button'); btn.type='button'; btn.className=item.cls||'btn btn-ghost'; btn.textContent=item.label; btn.addEventListener('click', item.action); footer.appendChild(btn); });
    document.body.appendChild(overlay); activeModal = overlay; document.body.classList.add('erp-flow-modal-open');
    return overlay;
  }
  function closeModal() { if (activeModal) activeModal.remove(); activeModal = null; document.body.classList.remove('erp-flow-modal-open'); }

  function exportFlowJson() {
    const data = loadStore(); const blob = new Blob([JSON.stringify({ exportedAt: nowIso(), version: VERSION, data }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `erp-order-flow-backup-${today()}.json`; a.click(); URL.revokeObjectURL(url);
  }

  function init() {
    if (window.__ERP_ORDER_FLOW_V3__) return;
    window.__ERP_ORDER_FLOW_V3__ = true;
    if (!ensureNavAndPanel()) { setTimeout(init, 300); return; }
    window.addEventListener('erp-flow:changed', () => { renderDashboardQueue(); const root=document.getElementById('erp-flow-root'); if(root && document.getElementById('panel-order-flow')?.classList.contains('active')) render(root.dataset.tab); });
    window.addEventListener('storage', event => { if (event.key === storageKey(STORE_BASE_KEY) || isBusinessStorageKey(event.key)) { renderDashboardQueue(); } });
    const originalGo = window.go;
    if (typeof originalGo === 'function' && !originalGo.__erpFlowWrapped) {
      const wrapped = function(...args){ const result=originalGo.apply(this,args); document.getElementById('erp-flow-nav')?.classList.remove('active'); return result; };
      wrapped.__erpFlowWrapped = true; window.go = wrapped;
    }
    renderDashboardQueue();
  }

  function voidPayment(paymentId){
    if(!confirm('ยกเลิกรับเงินรายการนี้และใบเสร็จที่สร้างจากรายการนี้? ยอดค้างรับจะคำนวณใหม่'))return;
    const store=loadStore(),p=store.payments.find(x=>x.id===paymentId);if(!p||p.voided)return;
    p.voided=true;p.voidedAt=nowIso();const writes=[];
    window.ERPIntegrity.packs().forEach(pack=>{let changed=false;['receipts','issuedReceipts'].forEach(t=>(pack.data[t]||[]).forEach(r=>{if(r.paymentId===p.id||(p.receiptNos||[]).includes(r.sourceReceiptNo)){r.voided=true;changed=true;}}));if(changed)writes.push([pack.key,pack.data]);});
    const b=store.billingNotes.find(x=>x.id===p.billingId);if(b){b.paidAmount=store.payments.filter(x=>!x.voided&&x.billingId===b.id).reduce((s,x)=>s+num(x.amount),0);b.status=b.paidAmount>0?'partially_paid':'draft';}
    writes.push([storageKey(STORE_BASE_KEY),store]);window.ERPIntegrity.transaction(writes);window.ERPIntegrity.changed();render('billing');
  }
  function importFlow(data={},options={}){
    const old=options.replace?blankStore():loadStore(),next={...old};
    for(const k of ['salesOrders','billingNotes','payments','reservations','activity'])if(data[k]!==undefined)next[k]=window.ERPIntegrity.mergeRows(old[k]||[],data[k],!!options.replace);
    saveStore(next);
  }
  window.ERPOrderFlow = {
    VERSION, voidPayment, open: () => showPanel('overview'), openTab, render, openOrder, openFulfillment,
    createProduction, createPurchaseOrder, markReady, prepareDelivery, openBillingForOrder, receiveBillingPayment, printBilling,
    exportFlowJson, scanBusinessData, getStore: loadStore, exportData: loadStore, importData: importFlow,
    resetDemoData: () => { if (confirm('ล้างเฉพาะ Sales Order / Billing / Payment ที่สร้างโดยโมดูล Workflow นี้?')) { localStorage.removeItem(storageKey(STORE_BASE_KEY)); render('overview'); } }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
