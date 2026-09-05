/* Versioned local backup validation and rollback. File bytes are kept in IndexedDB. */
(() => {
  'use strict';
  function rawKey(k){return window.ComformTenant?.unwrapStorageKey?.(k)||'';}
  function included(k){const base=rawKey(k);return !!base&&!base.startsWith('comform_auto_backup');}
  function capture(){
    const out={};for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(included(k))out[rawKey(k)]=localStorage.getItem(k);}return out;
  }
  function restore(snapshot){
    const before=capture(),keys=Object.keys(before),write=()=>{
      keys.forEach(k=>{if(!(k in snapshot))localStorage.removeItem(window.ComformTenant.storageKey(k));});
      Object.entries(snapshot).forEach(([k,v])=>localStorage.setItem(window.ComformTenant.storageKey(k),v));
    };
    try{write();}catch(e){Object.keys(capture()).forEach(k=>{if(!(k in before))localStorage.removeItem(window.ComformTenant.storageKey(k));});Object.entries(before).forEach(([k,v])=>localStorage.setItem(window.ComformTenant.storageKey(k),v));throw e;}
    window.ERPIntegrity.changed();
  }
  function validate(raw){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('ไฟล์ Backup ต้องเป็น JSON object');
    if(Number(raw.meta?.backupSchemaVersion||0)>4)throw new Error('ไฟล์ Backup เป็นเวอร์ชันใหม่กว่าระบบนี้');
    const arrays=new Set(['quotes','invoices','issuedInvoices','receipts','issuedReceipts','productions','expenses','contacts','products','salesOrders','billingNotes','payments','reservations','activity','purchaseOrders','goodsReceipts','inventoryMovements','audit','trash','localFiles']);
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
  async function portable(payload){
    payload.meta={...payload.meta,backupSchemaVersion:4,attachmentsIncluded:true};
    payload.localFiles=await window.LocalFileStore.exportAttachments(attachmentIds(payload));
    payload.meta.attachmentCount=payload.localFiles.length;return payload;
  }
  window.ERPBackup={capture,restore,validate,attachmentIds,portable};
})();
