// =====================================================================
// local-demo-mode.js — CUSTOMER SHOWCASE / LOCAL-ONLY MODE
// =====================================================================
// This build intentionally does NOT load Firebase Authentication, Firestore,
// Firebase Storage, Vercel APIs or Google Drive. All ERP business data stays
// in this browser (localStorage / IndexedDB) until the user exports a backup.
import { attachMenu } from './erp-ui-menu.js';
import { icon } from './erp-icons.js';
import { applyCompanyProfileToUser, readCompanyProfileStorage, companyHeaderBranding } from './erp-company-profile-core.js';
import { COMPANY_PROFILE_KEY, COMPANY_LOGO_KEY, COMPANY_PROFILE_CHANGED_EVENT } from './erp-storage-contracts.js';
import { createBranchesApi } from './erp-branches-core.js';

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
// ADR-020: the customer's saved company profile / logo (ตั้งค่าบริษัท), merged here — before the
// document modules render. Nothing saved = the demo profile above, unchanged.
try {
  const saved = readCompanyProfileStorage(localStorage, key => window.ComformTenant?.storageKey?.(key) || key, { profile: COMPANY_PROFILE_KEY, logo: COMPANY_LOGO_KEY });
  if (saved.errors.length) console.warn('[LocalDemo] saved company profile ignored:', saved.errors.join(' · '));
  if (saved.profile || saved.logo) applyCompanyProfileToUser(demoProfile, saved);
} catch (error) {
  console.warn('[LocalDemo] saved company profile could not be read', error);
}
// ADR-022: 1 or 2 establishments (labels + which branches the UI shows), for every later script —
// including plain scripts that cannot import erp-branches-core.js. Reads live state on every call.
window.ERPBranches = createBranchesApi(window);
window.ComformAuth = {
  auth: null,
  getCurrentProfile: () => demoProfile
};
// Explicit cloud-off sentinel used by modules that support optional cloud sync.
window.FirebaseService = Object.freeze({ configured: false, localOnly: true });

function escapeHtml(v='') {
  return String(v).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}

const DEMO_SUBTITLE = 'ทดลองกรอกข้อมูลได้ · ข้อมูลอยู่เฉพาะ Browser เครื่องนี้ · ไม่เชื่อม Firebase/Cloud';
// Header: the customer's company name / logo once saved (ADR-020), otherwise the demo title.
// Text only through textContent; the logo is a validated data URL (companyHeaderBranding).
function applyDemoBranding() {
  const branding = companyHeaderBranding(demoProfile);
  const title = document.getElementById('tenant-company-title');
  const subtitle = document.getElementById('tenant-company-subtitle');
  if (title) title.textContent = branding?.custom ? branding.title : 'ERP Business Platform · Local Demo';
  if (subtitle) subtitle.textContent = branding?.custom ? `Local Demo · ${DEMO_SUBTITLE}` : DEMO_SUBTITLE;
  const logo = document.querySelector('.comform-topbar .company-logo');
  if (logo && branding?.customLogo) {
    if (logo.dataset.defaultSrc === undefined) logo.dataset.defaultSrc = logo.getAttribute('src') || '';
    logo.setAttribute('src', branding.logoUrl);
  } else if (logo && logo.dataset.defaultSrc !== undefined) {
    logo.setAttribute('src', logo.dataset.defaultSrc);
  }
  document.title = branding?.custom ? `${branding.title} — ERP Local Demo` : 'ERP Local Demo — Customer Showcase';
  document.body.classList.add('firebase-local-mode','erp-local-demo');
}
window.addEventListener(COMPANY_PROFILE_CHANGED_EVENT, applyDemoBranding);

// ------------------------------------------------------------ "Demo" menu (ADR-015)
// One "Demo" button (gear line icon) at the right of the header replaces the former green Local Demo banner
// and its five buttons. Each action is still owned by its module, which registers its own item
// with the same label, id / data attribute and function as its former banner button:
//   order 10  ตรวจสถานะ Demo                   local-demo-health.js  #local-demo-health-btn
//   order 15  ข้อมูลบริษัทและโลโก้ (ADR-020)     erp-company-profile.js #local-demo-company-btn
//   order 20  โหลดข้อมูลตัวอย่างสำหรับสาธิต       erp-demo-seed.js      [data-demo-seed-action="load"]
//   order 30  วิธีเริ่มทดลอง                     this file             #local-demo-guide-btn
//   order 40  สำรองข้อมูล                        this file             #local-demo-backup-btn
//   danger    ล้างข้อมูลสาธิตทั้งหมด (รีเซ็ต)      erp-demo-seed.js      [data-demo-seed-action="reset"]
//
// Registration API (so no module depends on where the menu is in the DOM):
//   window.ERPDemoMenu.register({ key, id, label, icon, iconSvg, order, danger, title, dataset, onSelect })
//     key      unique name of the item (default: id). Registering the same key again replaces
//              the item, so a module that runs twice never adds a duplicate.
//     id       optional DOM id of the menu item (kept from the former banner buttons).
//     order    position (lower first); danger items always come last, after a separator.
//     onSelect called after the menu closed; leave it out when a document-level click
//              delegation on a data attribute (dataset) runs the action, as erp-demo-seed.js does.
//   Items registered before the header exists wait and are added when the menu is created.
//   window.ERPDemoMenu.has(key), .open(), .close()
// The "data stays in this browser" notice is the slim #erp-trial-safety-banner in index.html.
const DEMO_MENU_NAME = 'erp-demo';
// Line icons from the shared set (erp-icons.js, ADR-017); the drawings used to live here.
const GEAR_ICON = icon('settings');
const CHEVRON_ICON = icon('chevron', 'erp-demo-menu-caret');
const GUIDE_ICON = icon('guide');
const BACKUP_ICON = icon('download');

// Same two handlers as the former banner's guide and backup buttons.
function openTrialGuide() {
  window.TrialService?.toggleOnboarding(false);
}

function exportBackup() {
  if (typeof window.exportAllJSON === 'function') window.exportAllJSON();
  else window.notify?.('ฟังก์ชัน Backup กำลังโหลด กรุณาลองอีกครั้ง', 'info');
}

let demoMenu = null;
// key → item, in registration order; replayed into the menu when it is created.
const demoMenuItems = new Map();

function demoMenuKey(item) {
  return String(item?.key ?? item?.id ?? '').trim();
}

function registerDemoMenuItem(item) {
  const key = demoMenuKey(item);
  if (!key || !String(item?.label ?? '').trim()) {
    console.warn('[LocalDemo] Demo menu item needs a key (or id) and a label', item);
    return false;
  }
  const entry = { ...item, key };
  demoMenuItems.set(key, entry);
  demoMenu?.addItem(entry);
  return true;
}

function injectDemoMenu() {
  if (demoMenu || document.getElementById('erp-demo-menu-btn')) return;
  const top = document.querySelector('.comform-topbar');
  if (!top) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'erp-demo-menu-btn';
  button.className = 'erp-demo-menu-btn';
  button.title = 'เมนูโหมดสาธิต: ตรวจสถานะ · โหลด/ล้างข้อมูลตัวอย่าง · วิธีเริ่มทดลอง · สำรองข้อมูล';
  button.innerHTML = `${GEAR_ICON}<span>Demo</span>${CHEVRON_ICON}`;
  // Last in the header: after the search, the simple/advanced toggle and the period label.
  top.append(button);
  demoMenu = attachMenu(button, {
    name: DEMO_MENU_NAME,
    id: 'erp-demo-menu',
    label: 'เมนู Demo',
    className: 'erp-demo-menu',
    items: [...demoMenuItems.values()]
  });
}

registerDemoMenuItem({ key: 'guide', id: 'local-demo-guide-btn', order: 30, label: 'วิธีเริ่มทดลอง', iconSvg: GUIDE_ICON, onSelect: openTrialGuide });
registerDemoMenuItem({ key: 'backup', id: 'local-demo-backup-btn', order: 40, label: 'สำรองข้อมูล', title: 'ดาวน์โหลดไฟล์สำรอง — ทำก่อนเปลี่ยนเครื่องหรือเบราว์เซอร์', iconSvg: BACKUP_ICON, onSelect: exportBackup });

window.ERPDemoMenu = Object.freeze({
  register: registerDemoMenuItem,
  has: key => demoMenuItems.has(String(key)),
  open: () => demoMenu?.open(),
  close: () => demoMenu?.close({ restoreFocus: false })
});

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
  injectDemoMenu();
  // Fire once now and again after the application modules have attached listeners.
  try{window.dispatchEvent(new CustomEvent('comform-auth-ready',{detail:demoProfile}));}catch(error){console.warn('[LocalDemo] auth-ready event dispatch failed',error);}
  setTimeout(()=>{try{window.dispatchEvent(new CustomEvent('comform-auth-ready',{detail:demoProfile}));}catch(error){console.warn('[LocalDemo] auth-ready event dispatch failed',error);}},900);
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',ready,{once:true});
else ready();
