// =====================================================================
// local-file-store.js — เก็บไฟล์แนบไว้เฉพาะเครื่อง/browser ที่อัปโหลด
// =====================================================================
// ใช้ IndexedDB เพราะเหมาะกับไฟล์ PDF/รูป มากกว่า localStorage
// หมายเหตุ: ไฟล์ที่เก็บด้วยวิธีนี้จะไม่ถูกส่งขึ้น Cloud และเครื่องอื่นเปิดไม่ได้

const DB_NAME = "comform-local-files";
const DB_VERSION = 1;
const STORE_NAME = "attachments";

function activeTenantId() { return window.ComformTenant?.getActiveTenantId?.() || "anonymous"; }

function openLocalFileDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return await response.blob();
}

function safeFileName(name = "file") {
  return String(name).replace(/[\\/:*?"<>|#%{}^~`\[\]\\]/g, "_");
}

function getBlobType(file, blob) {
  return file?.type || blob?.type || "application/octet-stream";
}

async function normalizeAttachmentFile(file) {
  if (file?.file instanceof Blob) {
    const blob = file.file;
    return {
      blob,
      name: file.name || blob.name || "attachment",
      type: file.type || getBlobType(file, blob),
      size: file.size || blob.size || 0
    };
  }

  if (file?.data) {
    const blob = await dataUrlToBlob(file.data);
    return {
      blob,
      name: file.name || "attachment",
      type: getBlobType(file, blob),
      size: file.size || blob.size || 0
    };
  }

  if (file instanceof Blob) {
    return {
      blob: file,
      name: file?.name || "attachment",
      type: file?.type || "application/octet-stream",
      size: file?.size || 0
    };
  }

  throw new Error("ไฟล์แนบไม่ถูกต้องหรือไม่มีข้อมูลไฟล์");
}

export async function saveLocalAttachment(file, record = {}, moduleName = "misc") {
  const db = await openLocalFileDb();
  const normalized = await normalizeAttachmentFile(file);

  const tenantId = activeTenantId();
  const id = [
    "local",
    safeFileName(tenantId),
    safeFileName(moduleName),
    safeFileName(record.branch || "unknown"),
    safeFileName(record.no || record.id || Date.now()),
    Date.now(),
    safeFileName(normalized.name)
  ].join("-");

  const item = {
    id,
    name: normalized.name,
    type: normalized.type,
    size: normalized.size,
    tenantId,
    moduleName,
    docNo: record.no || "",
    branch: record.branch || "",
    createdAt: new Date().toISOString(),
    blob: normalized.blob
  };

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(item);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });

  return {
    provider: "local",
    localOnly: true,
    localId: id,
    name: item.name,
    type: item.type,
    size: item.size,
    note: "ไฟล์นี้เปิดได้เฉพาะเครื่อง/browser ที่อัปโหลด"
  };
}

export async function getLocalAttachmentUrl(localId) {
  const db = await openLocalFileDb();

  const item = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(localId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  if (!item?.blob) return null;
  if (item.tenantId && item.tenantId !== activeTenantId()) {
    console.warn('ปฏิเสธการเปิดไฟล์ Local ของบริษัทอื่น');
    return null;
  }
  return URL.createObjectURL(item.blob);
}

export async function deleteLocalAttachment(localId) {
  const db = await openLocalFileDb();
  const existing = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(localId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  if (existing?.tenantId && existing.tenantId !== activeTenantId()) throw new Error('ไม่มีสิทธิ์ลบไฟล์ของบริษัทอื่น');

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(localId);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

window.LocalFileStore = {
  saveLocalAttachment,
  getLocalAttachmentUrl,
  deleteLocalAttachment
};

// Portable backups include verified file bytes, not just local IDs.
async function attachmentDigest(blob){const hash=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function exportAttachments(ids=[]){
  const db=await openLocalFileDb();
  const rows=await new Promise((resolve,reject)=>{const r=db.transaction(STORE_NAME,'readonly').objectStore(STORE_NAME).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const result=[];
  for(const id of ids){
    const row=rows.find(r=>r.id===id&&(!r.tenantId||r.tenantId===activeTenantId()));
    if(!row?.blob)throw new Error('ไม่พบไฟล์แนบ '+id+' จึงยังสร้าง Backup แบบครบไฟล์ไม่ได้');
    const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(row.blob);});
    const {blob,...meta}=row;result.push({...meta,dataUrl,sha256:await attachmentDigest(blob)});
  }
  return result;
}
async function importAttachments(rows=[]){
  if(!Array.isArray(rows))throw new Error('ไฟล์แนบใน Backup ไม่ถูกต้อง');
  const db=await openLocalFileDb();
  const existing=await new Promise((resolve,reject)=>{const r=db.transaction(STORE_NAME,'readonly').objectStore(STORE_NAME).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const prepared=[],seen=new Set();
  for(const r of rows){
    if(!r.id||seen.has(r.id)||!/^data:[^,]*;base64,/.test(r.dataUrl||''))throw new Error('ข้อมูลไฟล์แนบไม่ถูกต้องหรือรหัสซ้ำ');seen.add(r.id);
    const blob=await dataUrlToBlob(r.dataUrl),digest=await attachmentDigest(blob);
    if(!r.sha256||r.sha256!==digest)throw new Error('ตรวจความสมบูรณ์ไฟล์แนบไม่ผ่าน: '+r.name);
    const old=existing.find(x=>x.id===r.id);
    if(old){if(old.tenantId&&old.tenantId!==activeTenantId())throw new Error('รหัสไฟล์แนบชนกับข้อมูลบริษัทอื่น');if(await attachmentDigest(old.blob)!==digest)throw new Error('ไฟล์แนบรหัสเดียวกันมีเนื้อหาต่างกัน: '+r.name);continue;}
    const {dataUrl,sha256,...meta}=r;prepared.push({...meta,tenantId:activeTenantId(),blob});
  }
  if(prepared.length)await new Promise((resolve,reject)=>{const tx=db.transaction(STORE_NAME,'readwrite');prepared.forEach(r=>tx.objectStore(STORE_NAME).add(r));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('ยกเลิกนำเข้าไฟล์แนบ'));});
  return prepared.map(r=>r.id);
}
Object.assign(window.LocalFileStore,{exportAttachments,importAttachments});
