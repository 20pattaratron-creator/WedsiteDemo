// =====================================================================
// local-demo-mode.js — CUSTOMER SHOWCASE / LOCAL-ONLY MODE
// =====================================================================
// This build intentionally does NOT load Firebase Authentication, Firestore,
// Firebase Storage, Vercel APIs or Google Drive. All ERP business data stays
// in this browser (localStorage / IndexedDB) until the user exports a backup.

const DEMO_TENANT_ID = 'customer-showcase-local';

const demoProfile = {
  uid: 'local-demo-user',
  email: 'demo@local.invalid',
  displayName: 'ผู้ทดลองใช้งาน',
  tenantId: DEMO_TENANT_ID,
  companyId: DEMO_TENANT_ID,
  tenantName: 'บริษัทตัวอย่างสำหรับทดลองระบบ',
  companyName: 'บริษัทตัวอย่างสำหรับทดลองระบบ',
  companyProfile: {
    nameTh: 'บริษัทตัวอย่างสำหรับทดลองระบบ จำกัด',
    nameEn: 'LOCAL DEMO COMPANY CO., LTD.',
    taxId: '0000000000000',
    phone: '000-000-0000',
    addressTh: 'ข้อมูลตัวอย่าง — สามารถแก้ไขเพื่อทดลองได้'
  },
  role: 'owner',
  allowedBranches: ['*'],
  branch: 'all',
  subscriptionStatus: 'local-demo',
  branchLimit: 2,
  activeBranchCount: 2,
  localDemo: true
};

window.ERP_LOCAL_DEMO = true;
window.CurrentUser = demoProfile;
window.ComformTenant?.setActiveTenantId?.(DEMO_TENANT_ID);
window.ComformAuth = {
  auth: null,
  getCurrentProfile: () => demoProfile
};
// Explicit cloud-off sentinel used by modules that support optional cloud sync.
window.FirebaseService = Object.freeze({ configured: false, localOnly: true });

function escapeHtml(v='') {
  return String(v).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}

function applyDemoBranding() {
  const title = document.getElementById('tenant-company-title');
  const subtitle = document.getElementById('tenant-company-subtitle');
  if (title) title.textContent = 'ERP Business Platform · Local Demo';
  if (subtitle) subtitle.textContent = 'ทดลองกรอกข้อมูลได้ · ข้อมูลอยู่เฉพาะ Browser เครื่องนี้ · ไม่เชื่อม Firebase/Cloud';
  document.title = 'ERP Local Demo — Customer Showcase';
  document.body.classList.add('firebase-local-mode','erp-local-demo');
}

function tenantPrefix() {
  return `erp_tenant::${DEMO_TENANT_ID}::`;
}

function clearDemoData() {
  const ok = confirm('ล้างข้อมูลทดลองทั้งหมดใน Browser เครื่องนี้ใช่หรือไม่?\n\nข้อมูลที่กรอกใน Local Demo จะถูกล้างและไม่สามารถกู้คืนได้ หากยังไม่ได้ Export Backup JSON');
  if (!ok) return;
  const prefix = tenantPrefix();
  const remove=[];
  for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i)||'';
    if(key.startsWith(prefix) || key.startsWith(`trial::${DEMO_TENANT_ID}::`) || key.startsWith('business_rules::customer-showcase-local')) remove.push(key);
  }
  remove.forEach(k=>localStorage.removeItem(k));
  try { sessionStorage.removeItem('erp_active_tenant_v1'); } catch (_) {}
  alert('ล้างข้อมูล Local Demo แล้ว ระบบจะโหลดหน้าใหม่');
  location.reload();
}

function injectDemoBanner() {
  if(document.getElementById('local-demo-banner')) return;
  const top=document.querySelector('.comform-topbar');
  if(!top) return;
  const banner=document.createElement('section');
  banner.id='local-demo-banner';
  banner.className='local-demo-banner';
  banner.innerHTML=`
    <div class="local-demo-banner-main">
      <span class="local-demo-lock">🔒</span>
      <div><b>LOCAL DEMO · ไม่เชื่อม Firebase / Cloud</b><small>ข้อมูลที่กรอกจะถูกบันทึกเฉพาะ Browser เครื่องนี้ เหมาะสำหรับให้ลูกค้าทดลองระบบก่อนตัดสินใจ</small></div>
    </div>
    <div class="local-demo-banner-actions">
      <button type="button" id="local-demo-backup-btn">⬇ Backup JSON</button>
      <button type="button" id="local-demo-clear-btn" class="danger">ล้างข้อมูลทดลอง</button>
    </div>`;
  top.insertAdjacentElement('afterend',banner);
  banner.querySelector('#local-demo-backup-btn')?.addEventListener('click',()=>{
    if(typeof window.exportAllJSON==='function') window.exportAllJSON();
    else window.notify?.('ฟังก์ชัน Backup กำลังโหลด กรุณาลองอีกครั้ง','info');
  });
  banner.querySelector('#local-demo-clear-btn')?.addEventListener('click',clearDemoData);
}

function injectDemoSaaSService(){
  window.SaaSService = {
    async getTenantSummary(){return {ok:true,tenant:{id:DEMO_TENANT_ID,name:demoProfile.tenantName,subscriptionStatus:'local-demo',plan:'showcase',branchLimit:2,activeBranchCount:2,branches:[{id:'ubon',name:'สาขาสำนักงานใหญ่',active:true},{id:'khonkaen',name:'สาขาที่ 00001',active:true}]},member:{uid:demoProfile.uid,role:'owner',allowedBranches:['*']}}},
    isBranchActive(){return true},
    applyBranchAvailability(){},
    async renderPanel(){
      const cards=document.getElementById('saas-summary-cards');
      const list=document.getElementById('saas-branch-list');
      const status=document.getElementById('saas-action-status');
      if(cards)cards.innerHTML='<div class="mc"><div class="lbl">โหมด</div><div class="val">LOCAL DEMO</div><div class="sub">ยังไม่เชื่อม Firebase หรือระบบสมาชิกจริง</div></div><div class="mc"><div class="lbl">ข้อมูล</div><div class="val">Browser only</div><div class="sub">LocalStorage / IndexedDB</div></div>';
      if(list)list.innerHTML='<div class="saas-branch-row"><div><b>สาขาสำนักงานใหญ่</b><small>ตัวอย่าง</small></div><span class="saas-status-pill">Demo</span></div><div class="saas-branch-row"><div><b>สาขาที่ 00001</b><small>ตัวอย่าง</small></div><span class="saas-status-pill">Demo</span></div>';
      if(status)status.textContent='Local Demo ไม่สามารถเพิ่มแพ็กเกจ/สาขาจริงได้ จนกว่าจะเปิดระบบ SaaS Production';
    },
    async createBranchFromPanel(){window.notify?.('Local Demo ยังไม่เชื่อมระบบสมาชิก/ชำระเงิน จึงไม่สร้างสาขาผ่าน Server','info')}
  };
}

function ready(){
  applyDemoBranding();
  injectDemoSaaSService();
  injectDemoBanner();
  // Fire once now and again after the application modules have attached listeners.
  try{window.dispatchEvent(new CustomEvent('comform-auth-ready',{detail:demoProfile}));}catch(_){}
  setTimeout(()=>{try{window.dispatchEvent(new CustomEvent('comform-auth-ready',{detail:demoProfile}));}catch(_){}},900);
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',ready,{once:true});
else ready();
