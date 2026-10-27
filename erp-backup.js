/* Versioned local backup validation and rollback. File bytes are kept in IndexedDB. */
import { notifyStorageWritten, COMPANY_LOGO_KEY, LAST_BACKUP_AT_KEY } from './erp-storage-contracts.js';
import { validateCompanyProfileBackup } from './erp-company-profile-core.js';
import { normalizeVatReturnsStore } from './erp-tax-reports-core.js';
import { normalizeWhtFilingsStore } from './erp-payer-wht-core.js';
import { normalizePeriodLockBackup } from './erp-governance-core.js';
(() => {
  'use strict';
  // ADR-020: the customer logo (≤ ~300 KB) is kept out of raw-storage snapshots — app.js stores up to
  // 8 of them in localStorage, and 8 copies of a logo could fill the quota. capture() still carries it
  // in memory (a non-enumerable property, so JSON.stringify drops it): an in-page rollback such as
  // restore(capture()) after a failed import puts the logo back too. JSON backups carry the logo in
  // masterData.companyProfile instead.
  const MEMORY_ONLY_KEYS=Object.freeze([COMPANY_LOGO_KEY]);
  const MEMORY_ONLY_PROP='__memoryOnlyKeys';
  const LAST_BACKUP_KEY=LAST_BACKUP_AT_KEY;
  // r13#MED-8 — มาตรา 87/3 / พ.ร.บ.การบัญชี 2543: documents and tax reports are kept at least 5 years; this demo's data is
  // only in this browser, so the slim banner says when the last JSON backup was made and reminds after 7 days.
  const BACKUP_REMINDER_DAYS=7;
  function renderBackupReminder(){
    const box=document.getElementById('erp-backup-reminder');if(!box)return;
    let last='';try{last=localStorage.getItem(LAST_BACKUP_KEY)||'';}catch{last='';}
    const at=Date.parse(last),days=Number.isFinite(at)?Math.floor((Date.now()-at)/86400000):null,due=days===null||days>=BACKUP_REMINDER_DAYS;
    box.hidden=!due;box.textContent=due?(days===null?' · ยังไม่เคยสำรองข้อมูลจากเบราว์เซอร์นี้ — เมนู Demo › สำรองข้อมูล':` · สำรองข้อมูลครั้งล่าสุด ${days} วันก่อน — ควรสำรองใหม่`):'';
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',renderBackupReminder,{once:true});else renderBackupReminder();
  window.addEventListener('erp:backup-made',renderBackupReminder);
  function rawKey(k){return window.ComformTenant?.unwrapStorageKey?.(k)||'';}
  function included(k){const base=rawKey(k);return !!base&&!base.startsWith('comform_auto_backup')&&!MEMORY_ONLY_KEYS.includes(base);}
  function capture(){
    const out={};for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(included(k))out[rawKey(k)]=localStorage.getItem(k);}
    const memory={};MEMORY_ONLY_KEYS.forEach(base=>{memory[base]=localStorage.getItem(window.ComformTenant.storageKey(base));});
    Object.defineProperty(out,MEMORY_ONLY_PROP,{value:Object.freeze(memory),enumerable:false});
    return out;
  }
  function writeMemoryOnly(snapshot){
    if(!Object.prototype.hasOwnProperty.call(snapshot,MEMORY_ONLY_PROP))return; // e.g. a snapshot read back from JSON: the logo stays as it is
    for(const [k,v] of Object.entries(snapshot[MEMORY_ONLY_PROP])){const key=window.ComformTenant.storageKey(k);if(v===null)localStorage.removeItem(key);else localStorage.setItem(key,v);}
  }
  function restore(snapshot){
    validate(snapshot);
    const before=capture(),keys=Object.keys(before),write=()=>{
      keys.forEach(k=>{if(!(k in snapshot))localStorage.removeItem(window.ComformTenant.storageKey(k));});
      Object.entries(snapshot).forEach(([k,v])=>localStorage.setItem(window.ComformTenant.storageKey(k),v));
      writeMemoryOnly(snapshot);
    };
    try{write();}catch(e){Object.keys(capture()).forEach(k=>{if(!(k in before))localStorage.removeItem(window.ComformTenant.storageKey(k));});Object.entries(before).forEach(([k,v])=>localStorage.setItem(window.ComformTenant.storageKey(k),v));writeMemoryOnly(before);throw e;}
    finally{notifyStorageWritten();}
    window.ERPIntegrity.changed();
  }
  // ADR-028: checked by the costing page's own strict readers (ERPCosting.validateBackup). If that module is not
  // loaded the file is refused rather than restored unchecked (its costing part could not be validated).
  function validateCostingBackup(value){
    if(typeof window.ERPCosting?.validateBackup!=='function')throw new Error('ระบบต้นทุนยังโหลดไม่เสร็จ จึงตรวจข้อมูลต้นทุนใน Backup ไม่ได้ — ยังไม่กู้ข้อมูล กรุณาลองใหม่');
    window.ERPCosting.validateBackup(value);
  }
  // ADR-029: the journal documents / chart of accounts (ERPJournal) and the PromptPay settings (ERPPromptPay), the same
  // fail-closed rule: a part that cannot be validated because its module is not loaded refuses the whole file.
  function validateModuleBackup(api,value,what){
    if(typeof api?.validateBackup!=='function')throw new Error(`ระบบ${what}ยังโหลดไม่เสร็จ จึงตรวจข้อมูล${what}ใน Backup ไม่ได้ — ยังไม่กู้ข้อมูล กรุณาลองใหม่`);
    api.validateBackup(value);
  }
  function validate(raw){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('ไฟล์ Backup ต้องเป็น JSON object');
    if(Number(raw.meta?.backupSchemaVersion||0)>4)throw new Error('ไฟล์ Backup เป็นเวอร์ชันใหม่กว่าระบบนี้');
    // Company profile + logo (ADR-020): checked in full before anything is written; older backups have none.
    if(raw.masterData&&typeof raw.masterData==='object'&&raw.masterData.companyProfile!==undefined)validateCompanyProfileBackup(raw.masterData.companyProfile);
    // Filed ภ.พ.30 snapshots (ADR-023): every row validated before anything is written; older backups have none.
    if(raw.masterData&&typeof raw.masterData==='object'&&raw.masterData.vatReturns!==undefined)normalizeVatReturnsStore(raw.masterData.vatReturns);
    // Filed ภ.ง.ด.3 / 53 snapshots (ADR-024): the same fail-closed check; older backups have none.
    if(raw.masterData&&typeof raw.masterData==='object'&&raw.masterData.whtFilings!==undefined)normalizeWhtFilingsStore(raw.masterData.whtFilings);
    // Period locks (r8fix#B8): every event validated before anything is written; older backups have none.
    if(raw.masterData&&typeof raw.masterData==='object'&&raw.masterData.periodLocks!==undefined)normalizePeriodLockBackup(raw.masterData.periodLocks);
    // Costing settings and job cost entries (ADR-028): strict, fail-closed, before anything is written; older backups have none.
    if(raw.masterData&&typeof raw.masterData==='object'&&raw.masterData.costing!==undefined&&raw.masterData.costing!==null)validateCostingBackup(raw.masterData.costing);
    // Journal documents + chart of accounts, PromptPay settings (ADR-029): strict, before anything is written; older backups have none.
    if(raw.masterData&&typeof raw.masterData==='object'&&raw.masterData.accounting!==undefined&&raw.masterData.accounting!==null)validateModuleBackup(window.ERPJournal,raw.masterData.accounting,'บัญชี');
    if(raw.masterData&&typeof raw.masterData==='object'&&raw.masterData.promptpay!==undefined&&raw.masterData.promptpay!==null)validateModuleBackup(window.ERPPromptPay,raw.masterData.promptpay,'QR พร้อมเพย์');
    // Multi-currency settings, the rate table and the month-end closes (ADR-031): strict, before anything is written; older backups have none.
    if(raw.masterData&&typeof raw.masterData==='object'&&raw.masterData.fx!==undefined&&raw.masterData.fx!==null)validateModuleBackup(window.ERPFx,raw.masterData.fx,'หลายสกุลเงิน');
    const arrays=new Set(['quotes','invoices','issuedInvoices','receipts','issuedReceipts','productions','expenses','creditNotes','debitNotes','whtCertificates','returnItems','contacts','products','salesOrders','billingNotes','payments','reservations','activity','purchaseOrders','goodsReceipts','inventoryMovements','audit','trash','localFiles']);
    function walk(value,name='',depth=0){
      if(depth>35)throw new Error('โครงสร้าง Backup ซ้อนลึกเกินไป');
      if(arrays.has(name)&&!Array.isArray(value))throw new Error(`ข้อมูล ${name} ต้องเป็นรายการ`);
      if(value===null||typeof value!=='object')return;
      if(Array.isArray(value)){value.forEach(v=>walk(v,name==='localFiles'?'attachment':'',depth+1));return;}
      for(const [k,v] of Object.entries(value)){
        if(['__proto__','prototype','constructor'].includes(k))throw new Error('พบโครงสร้างที่ไม่รองรับใน Backup');
        if(k==='id'&&name!=='attachment'&&!(typeof v==='number'&&Number.isFinite(v))&&!(typeof v==='string'&&/^[\w.:-]+$/.test(v)))throw new Error('รหัสรายการใน Backup มีอักขระที่ไม่รองรับ');
        if(['qty','amount','total','subtotal','billedAmount','readyQty','stockQty','productionQty','purchaseQty'].includes(k)&&v!==''&&v!==null&&!Number.isFinite(Number(v)))throw new Error(`พบตัวเลข ${k} ไม่ถูกต้อง`);
        walk(v,k,depth+1);
      }
    }
    walk(raw);return raw;
  }
  function attachmentIds(value){
    const ids=new Set();function walk(v){if(!v||typeof v!=='object')return;if(v.localId)ids.add(String(v.localId));Object.values(v).forEach(walk);}walk(value);return [...ids];
  }
  function canonical(value){if(value===null||typeof value!=='object')return value;if(Array.isArray(value))return value.map(canonical);return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));}
  async function digest(value){if(!globalThis.crypto?.subtle)throw new Error('Browser นี้ไม่รองรับ SHA-256 สำหรับตรวจ Backup');const bytes=new TextEncoder().encode(JSON.stringify(canonical(value))),hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');}
  // r8fix#B2: a file WITHOUT a checksum is only accepted as what it claims to be — a backup older than schema v4.
  // Data that only v4 backups (which always carry contentSha256) can contain proves the checksum was stripped
  // (a "downgraded" file): refused. A genuine old file is accepted after the user confirms (confirmUnverified).
  const V4_ONLY_MASTER=Object.freeze(['companyProfile','vatReturns','whtFilings']),V4_ONLY_PACK=Object.freeze(['debitNotes','whtCertificates']);
  function v4OnlyContent(snapshot){
    // Only real content counts (an empty list adds nothing and older test fixtures carry empty keys).
    const found=new Set(V4_ONLY_MASTER.filter(key=>snapshot?.masterData&&typeof snapshot.masterData==='object'&&snapshot.masterData[key]!==undefined&&snapshot.masterData[key]!==null));
    const visit=(value,depth)=>{if(!value||typeof value!=='object'||Array.isArray(value)||depth>4)return;for(const [key,child] of Object.entries(value)){if(V4_ONLY_PACK.includes(key)&&Array.isArray(child)){if(child.length)found.add(key);}else visit(child,depth+1);}};
    visit(snapshot?.data&&typeof snapshot.data==='object'?snapshot.data:snapshot,0);
    return [...found];
  }
  const UNVERIFIED_TEXT=Object.freeze({
    downgraded:keys=>`ไฟล์ Backup นี้ไม่มี checksum แต่มีข้อมูลที่มีเฉพาะใน Backup รุ่นที่ต้องมี checksum (${keys.join(', ')}) — ไฟล์อาจถูกแก้ไขหรือตัด checksum ออก ระบบหยุดก่อนเขียนข้อมูล`,
    confirm:'⚠️ ไฟล์ Backup นี้ไม่มี checksum (Backup รุ่นเก่า) — ระบบตรวจไม่ได้ว่าไฟล์ครบหรือถูกแก้ไขหรือไม่\n\nเอกสารที่ออกแล้วในเครื่องจะไม่ถูกแก้ยอด/เลขที่/วันที่ และงวดที่ปิดแล้วจะไม่ถูกเปลี่ยน แต่ข้อมูลอื่นในไฟล์จะถูกนำเข้าตามที่อยู่ในไฟล์\n\nนำเข้าต่อหรือไม่?'
  });
  function confirmUnverified(){return window.confirm(UNVERIFIED_TEXT.confirm)===true;}
  const LOCKED_LABEL=Object.freeze({invoices:'ใบกำกับภาษี',issuedInvoices:'ฉบับพิมพ์ใบกำกับภาษี',receipts:'ใบเสร็จ',issuedReceipts:'ฉบับพิมพ์ใบเสร็จ',expenses:'ค่าใช้จ่าย',creditNotes:'ใบลดหนี้',debitNotes:'ใบเพิ่มหนี้',whtCertificates:'หนังสือรับรอง 50 ทวิ'});
  const LOCKED_CHANGE=Object.freeze({add:'เพิ่ม',change:'แก้ไข',remove:'ลบ'});
  // r8fix#B2: the Thai list shown when an import would touch documents of a closed period (nothing is written).
  function lockedImportText(rows=[]){
    const list=rows.slice(0,20).map(row=>`• ${LOCKED_LABEL[row.type]||row.type} ${row.no} (${row.date}) — ${LOCKED_CHANGE[row.change]||row.change}`);
    return `ไฟล์ Backup จะเพิ่ม/แก้/ลบเอกสาร ${rows.length} รายการในงวดที่ปิดแล้ว ระบบจึงไม่นำเข้าเลย:\n${list.join('\n')}${rows.length>20?`\n… และอีก ${rows.length-20} รายการ`:''}\n${rows[0]?.text||''}\nปลดล็อกงวดพร้อมเหตุผลก่อน หรือใช้ไฟล์ที่ไม่แตะงวดที่ปิดแล้ว`;
  }
  async function verifyPortable(snapshot){
    validate(snapshot);const expected=String(snapshot?.meta?.contentSha256||'').trim(),schemaVersion=Number(snapshot?.meta?.backupSchemaVersion||0);
    if(!expected){if(schemaVersion>=4)throw new Error('Backup schema v4 ต้องมี contentSha256 แต่ไฟล์นี้ไม่มี checksum ระบบหยุดก่อนเขียนข้อมูล');const v4=v4OnlyContent(snapshot);if(v4.length)throw new Error(UNVERIFIED_TEXT.downgraded(v4));return{ok:true,verified:false,legacy:true,actual:'',expected:''};}
    if(!/^[a-f0-9]{64}$/i.test(expected))throw new Error('Backup checksum มีรูปแบบไม่ถูกต้อง');
    const actual=await digest({...snapshot,meta:{...snapshot.meta,contentSha256:''}});
    if(actual.toLowerCase()!==expected.toLowerCase())throw new Error('Backup checksum ไม่ตรง ไฟล์อาจไม่ครบหรือถูกแก้ไข ระบบหยุดก่อนเขียนข้อมูล');
    return{ok:true,verified:true,legacy:false,actual,expected};
  }
  async function dryRun(snapshot){validate(snapshot);const integrity=await verifyPortable(snapshot);return{ok:true,checksum:await digest(snapshot),checksumVerified:integrity.verified,legacyChecksum:integrity.legacy,topLevelKeys:Object.keys(snapshot).sort(),attachmentReferences:attachmentIds(snapshot).length,backupSchemaVersion:Number(snapshot.meta?.backupSchemaVersion||0)};}
  async function portable(payload){
    payload.meta={...payload.meta,backupSchemaVersion:4,attachmentsIncluded:true};
    payload.localFiles=await window.LocalFileStore.exportAttachments(attachmentIds(payload));
    payload.meta.attachmentCount=payload.localFiles.length;payload.meta.contentSha256=await digest({...payload,meta:{...payload.meta,contentSha256:''}});try{localStorage.setItem(LAST_BACKUP_KEY,new Date().toISOString());window.dispatchEvent(new Event('erp:backup-made'));}catch{/* r13#MED-8: the reminder is a convenience only */}return payload;
  }
  window.ERPBackup={capture,restore,validate,attachmentIds,portable,digest,verifyPortable,dryRun,confirmUnverified,lockedImportText};
})();
