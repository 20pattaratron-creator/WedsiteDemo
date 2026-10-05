/* Versioned local backup validation and rollback. File bytes are kept in IndexedDB. */
import { notifyStorageWritten, COMPANY_LOGO_KEY } from './erp-storage-contracts.js';
import { validateCompanyProfileBackup } from './erp-company-profile-core.js';
import { normalizeVatReturnsStore } from './erp-tax-reports-core.js';
(() => {
  'use strict';
  // ADR-020: the customer logo (≤ ~300 KB) is kept out of raw-storage snapshots — app.js stores up to
  // 8 of them in localStorage, and 8 copies of a logo could fill the quota. capture() still carries it
  // in memory (a non-enumerable property, so JSON.stringify drops it): an in-page rollback such as
  // restore(capture()) after a failed import puts the logo back too. JSON backups carry the logo in
  // masterData.companyProfile instead.
  const MEMORY_ONLY_KEYS=Object.freeze([COMPANY_LOGO_KEY]);
  const MEMORY_ONLY_PROP='__memoryOnlyKeys';
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
  function validate(raw){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('ไฟล์ Backup ต้องเป็น JSON object');
    if(Number(raw.meta?.backupSchemaVersion||0)>4)throw new Error('ไฟล์ Backup เป็นเวอร์ชันใหม่กว่าระบบนี้');
    // Company profile + logo (ADR-020): checked in full before anything is written; older backups have none.
    if(raw.masterData&&typeof raw.masterData==='object'&&raw.masterData.companyProfile!==undefined)validateCompanyProfileBackup(raw.masterData.companyProfile);
    // Filed ภ.พ.30 snapshots (ADR-023): every row validated before anything is written; older backups have none.
    if(raw.masterData&&typeof raw.masterData==='object'&&raw.masterData.vatReturns!==undefined)normalizeVatReturnsStore(raw.masterData.vatReturns);
    const arrays=new Set(['quotes','invoices','issuedInvoices','receipts','issuedReceipts','productions','expenses','creditNotes','returnItems','contacts','products','salesOrders','billingNotes','payments','reservations','activity','purchaseOrders','goodsReceipts','inventoryMovements','audit','trash','localFiles']);
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
  async function verifyPortable(snapshot){
    validate(snapshot);const expected=String(snapshot?.meta?.contentSha256||'').trim(),schemaVersion=Number(snapshot?.meta?.backupSchemaVersion||0);
    if(!expected){if(schemaVersion>=4)throw new Error('Backup schema v4 ต้องมี contentSha256 แต่ไฟล์นี้ไม่มี checksum ระบบหยุดก่อนเขียนข้อมูล');return{ok:true,verified:false,legacy:true,actual:'',expected:''};}
    if(!/^[a-f0-9]{64}$/i.test(expected))throw new Error('Backup checksum มีรูปแบบไม่ถูกต้อง');
    const actual=await digest({...snapshot,meta:{...snapshot.meta,contentSha256:''}});
    if(actual.toLowerCase()!==expected.toLowerCase())throw new Error('Backup checksum ไม่ตรง ไฟล์อาจไม่ครบหรือถูกแก้ไข ระบบหยุดก่อนเขียนข้อมูล');
    return{ok:true,verified:true,legacy:false,actual,expected};
  }
  async function dryRun(snapshot){validate(snapshot);const integrity=await verifyPortable(snapshot);return{ok:true,checksum:await digest(snapshot),checksumVerified:integrity.verified,legacyChecksum:integrity.legacy,topLevelKeys:Object.keys(snapshot).sort(),attachmentReferences:attachmentIds(snapshot).length,backupSchemaVersion:Number(snapshot.meta?.backupSchemaVersion||0)};}
  async function portable(payload){
    payload.meta={...payload.meta,backupSchemaVersion:4,attachmentsIncluded:true};
    payload.localFiles=await window.LocalFileStore.exportAttachments(attachmentIds(payload));
    payload.meta.attachmentCount=payload.localFiles.length;payload.meta.contentSha256=await digest({...payload,meta:{...payload.meta,contentSha256:''}});return payload;
  }
  window.ERPBackup={capture,restore,validate,attachmentIds,portable,digest,verifyPortable,dryRun};
})();
