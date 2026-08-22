// =====================================================================
// firebase-bridge.js — บันทึกข้อมูลธุรกิจลง Firestore
// โหมดนี้: อัปโหลดไฟล์แนบขึ้น Google Drive ก่อน แล้วเก็บ webViewLink ลง Firestore
// ถ้า Google Drive ยังไม่ได้ตั้งค่า/อัปโหลดไม่สำเร็จ จะ fallback เป็น local-only
// =====================================================================

import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  doc,
  deleteDoc,
  updateDoc,
  writeBatch,
  setDoc
} from "firebase/firestore";
import { firebaseConfig } from "./firebase.config.js";

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);


// Calendar policy:
// - Keep year/date internally as Gregorian (CE) for Firebase queries, HTML date inputs and JS Date.
// - Also store Buddhist Era metadata for Thai display/reporting: yearBE/buddhistYear/dateThai/displayDate.
function toCEYear(year) {
  const y = Number(year);
  if (!Number.isFinite(y)) return new Date().getFullYear();
  return y >= 2400 ? y - 543 : y;
}
function toBEYear(year) {
  const y = Number(year);
  if (!Number.isFinite(y)) return null;
  return y >= 2400 ? y : y + 543;
}
function parseBusinessDateFlexible(value) {
  if (!value) return null;
  if (value?.toDate) {
    const d = value.toDate();
    return d && !Number.isNaN(d.getTime()) ? d : null;
  }
  if (value?.seconds) {
    const d = new Date(Number(value.seconds) * 1000);
    return !Number.isNaN(d.getTime()) ? d : null;
  }
  const raw = String(value || '').trim();
  let match = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) {
    const d = new Date(toCEYear(Number(match[1])), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) {
    const d = new Date(toCEYear(Number(match[3])), Number(match[2]) - 1, Number(match[1]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}
function isoDateCE(value) {
  const d = parseBusinessDateFlexible(value);
  if (!d) return String(value || '');
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function formatThaiDate(value) {
  const d = parseBusinessDateFlexible(value);
  if (!d) return String(value || '');
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${toBEYear(d.getFullYear())}`;
}
function withThaiCalendarMeta(record = {}, fallbackYear, fallbackMonth) {
  const d = parseBusinessDateFlexible(record.date);
  const ceYear = d ? d.getFullYear() : toCEYear(record.year ?? record.yearCE ?? fallbackYear);
  const monthIndex = d ? d.getMonth() : Math.max(0, Math.min(11, Number(record.monthIndex ?? record.month ?? fallbackMonth ?? 0) || 0));
  return {
    ...record,
    date: d ? isoDateCE(record.date) : String(record.date || ''),
    year: ceYear,
    yearCE: ceYear,
    yearBE: toBEYear(ceYear),
    buddhistYear: toBEYear(ceYear),
    month: monthIndex,
    monthIndex,
    monthNumber: monthIndex + 1,
    dateThai: d ? formatThaiDate(record.date) : String(record.dateThai || ''),
    displayDate: d ? formatThaiDate(record.date) : String(record.displayDate || record.date || '')
  };
}

function monthIndexFromBusinessDate(value) {
  const d = parseBusinessDateFlexible(value);
  return d ? d.getMonth() : null;
}

function normalizeMonth(record) {
  // app.js sends record.month as JavaScript month index 0-11.
  // Prefer date as the source of truth so Firestore rows are stored in the same month
  // that users see in the form/list. This prevents local + cloud duplicates.
  let monthIndex = monthIndexFromBusinessDate(record.date);

  if (!Number.isFinite(monthIndex)) {
    monthIndex = Number(record.monthIndex);
  }

  if (!Number.isFinite(monthIndex)) {
    if (record.monthNumber !== undefined && record.monthNumber !== null) {
      const monthNumber = Number(record.monthNumber);
      monthIndex = monthNumber >= 1 && monthNumber <= 12 ? monthNumber - 1 : 0;
    } else {
      const m = Number(record.month ?? 0);
      monthIndex = m >= 0 && m <= 11 ? m : (m >= 1 && m <= 12 ? m - 1 : 0);
    }
  }

  if (!Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) monthIndex = 0;

  return {
    month: monthIndex,
    monthIndex,
    monthNumber: monthIndex + 1
  };
}

function getCurrentProfile() {
  return window.ComformAuth?.getCurrentProfile?.() || window.CurrentUser || null;
}

function withUserMeta(record) {
  const profile = getCurrentProfile();

  // สำคัญมาก: พนักงานสาขาเดียวห้ามบันทึกเป็นสาขาอื่น
  // ถ้า user.branch = khonkaen/ubon ให้บังคับใช้ branch นั้นเสมอ
  // ถ้าเป็น admin branch = all จึงใช้ branch ที่เลือกในฟอร์ม
  const effectiveBranch = profile?.branch && profile.branch !== "all"
    ? profile.branch
    : (record.branch || "");

  return {
    ...record,
    branch: effectiveBranch,
    createdBy: record.createdBy || profile?.uid || "",
    createdByEmail: record.createdByEmail || profile?.email || ""
  };
}

function emitDriveUploadError(message) {
  try {
    window.dispatchEvent(new CustomEvent("comform-drive-upload-error", { detail: { message } }));
  } catch (_) {
    // ignore
  }
}

async function saveFilesLocalOnly(files, record, folder) {
  if (!window.LocalFileStore?.saveLocalAttachment) {
    console.warn("ยังไม่พบ LocalFileStore — จะบันทึกข้อมูลโดยไม่มีไฟล์แนบ");
    return [];
  }

  const saved = [];
  for (const file of files) {
    const result = await window.LocalFileStore.saveLocalAttachment(file, record, folder);
    saved.push(result);
  }
  return saved;
}

async function uploadDataUrlFiles(folder, record) {
  const files = record.attachments || [];
  if (!files.length) return [];

  const driveMeta = {
    branch: record.branch || "",
    docType: folder,
    no: record.no || record.id || "",
    customer: record.customer || record.desc || record.job || "",
    id: record.id || ""
  };

  if (window.GoogleDriveEvidence?.isConfigured?.()) {
    try {
      return await window.GoogleDriveEvidence.uploadEvidenceFiles(files, driveMeta);
    } catch (err) {
      const msg = err?.message || String(err);
      console.error("อัปโหลด Google Drive ไม่สำเร็จ จะใช้ local-only แทน:", err);
      emitDriveUploadError(msg);
      return await saveFilesLocalOnly(files, record, folder);
    }
  }

  console.warn("ยังไม่ได้ตั้งค่า Google Drive — จะบันทึกไฟล์แนบแบบ local-only");
  return await saveFilesLocalOnly(files, record, folder);
}

function detectStorageProvider(files) {
  if (!files.length) return "none";
  const hasDrive = files.some(file => file.provider === "google-drive");
  const hasLocal = files.some(file => file.provider === "local");
  if (hasDrive && hasLocal) return "mixed";
  if (hasDrive) return "google-drive";
  if (hasLocal) return "local-only";
  return "metadata-only";
}


function compactRecordForFirestore(record) {
  // ไม่บันทึก data URL/base64 ของไฟล์ลง Firestore เพื่อลดขนาดข้อมูล
  const cleaned = { ...record };
  if (Array.isArray(cleaned.attachments)) {
    cleaned.attachments = cleaned.attachments.map(file => {
      const copy = { ...file };
      delete copy.data;
      delete copy.file;
      delete copy.blob;
      delete copy.previewUrl;
      delete copy.objectUrl;
      return copy;
    });
  }
  return cleaned;
}

async function saveDoc(collectionName, record, fileFolder = collectionName) {
  // ใช้ recordWithUser ตัวเต็มเพื่อให้ LocalFileStore ยังมี data URL ของไฟล์ไว้บันทึกลง IndexedDB
  const recordWithUser = withUserMeta(record);

  if (!recordWithUser.branch || recordWithUser.branch === "all") {
    throw new Error("missing-branch: กรุณาเลือกสาขาก่อนบันทึก");
  }

  const monthFields = normalizeMonth(recordWithUser);
  const recordWithCalendar = withThaiCalendarMeta(recordWithUser, recordWithUser.year, monthFields.monthIndex);
  const localFiles = await uploadDataUrlFiles(fileFolder, recordWithCalendar);
  const compactRecord = compactRecordForFirestore(recordWithCalendar);

  const payload = {
    ...compactRecord,
    ...monthFields,

    // เก็บเฉพาะ metadata ของไฟล์ใน Firestore
    // ถ้า Google Drive ใช้งานได้ จะมี webViewLink สำหรับเปิดดูข้ามเครื่อง
    attachments: localFiles,
    storageProvider: detectStorageProvider(localFiles),

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  const ref = await addDoc(collection(db, collectionName), payload);
  return {
    id: ref.id,
    attachments: localFiles,
    storageProvider: payload.storageProvider
  };
}

export function saveProduction(record) {
  return saveDoc("productions", record, "productions");
}

export function saveInvoice(record) {
  return saveDoc("invoices", record, "invoices");
}

export function saveQuote(record) {
  return saveDoc("quotes", record, "quotes");
}

export function saveReceipt(record) {
  return saveDoc("receipts", record, "receipts");
}

export function saveIssuedInvoice(record) {
  return saveDoc("issuedInvoices", record, "invoices");
}

export function saveIssuedReceipt(record) {
  return saveDoc("issuedReceipts", record, "receipts");
}


export function saveExpense(record) {
  return saveDoc("expenses", record, "expenses");
}

function inferRecordYear(record = {}) {
  const directYear = Number(record.year ?? record.yearCE ?? record._y ?? record.docYear ?? record.recordYear);
  if (Number.isFinite(directYear) && directYear >= 2020 && directYear <= 2100) return directYear;
  if (Number.isFinite(directYear) && directYear >= 2500 && directYear <= 2700) return directYear - 543;
  const d = parseBusinessDateFlexible(record.date);
  if (d) return d.getFullYear();
  const be = Number(record.yearBE ?? record.buddhistYear);
  if (Number.isFinite(be) && be >= 2500 && be <= 2700) return be - 543;
  return null;
}

function dedupeFirestoreRows(rows = []) {
  const byId = new Map();
  rows.forEach(row => {
    const key = String(row.firebaseId || row.id || `${row.no || ''}|${row.date || ''}|${row.branch || ''}`);
    byId.set(key, { ...(byId.get(key) || {}), ...row });
  });
  return [...byId.values()];
}

export async function loadCollectionByYear(collectionName, year) {
  const profile = getCurrentProfile();
  if (!profile?.uid) throw new Error('กรุณาเข้าสู่ระบบก่อนโหลดข้อมูล');

  const selectedYear = Number(year);
  const branch = profile.branch;

  try {
    // อ่านเอกสารทั้งหมดที่ผู้ใช้มีสิทธิ์ แล้วกรองปีในฝั่งแอป
    // วิธีนี้รองรับข้อมูลเก่าที่ไม่มี year, year เป็น string หรือมีเพียง date
    const sourceQuery = branch && branch !== 'all'
      ? query(collection(db, collectionName), where('branch', '==', branch))
      : collection(db, collectionName);

    const snapshot = await getDocs(sourceQuery);
    return dedupeFirestoreRows(
      snapshot.docs
        .map(snapshotDoc => ({ firebaseId: snapshotDoc.id, ...snapshotDoc.data() }))
        .filter(row => inferRecordYear(row) === selectedYear)
    );
  } catch (err) {
    console.error(`อ่านข้อมูล ${collectionName} จาก Firestore ไม่สำเร็จ`, err);
    throw err;
  }
}

export async function loadAllDashboardDataByYear(year) {
  const collectionNames = [
    'invoices',
    'productions',
    'expenses',
    'quotes',
    'receipts',
    'issuedInvoices',
    'issuedReceipts'
  ];

  const results = await Promise.allSettled(
    collectionNames.map(name => loadCollectionByYear(name, year))
  );

  const pack = { _loadedCollections: [], _errors: {} };
  results.forEach((result, index) => {
    const name = collectionNames[index];
    if (result.status === 'fulfilled') {
      pack[name] = result.value;
      pack._loadedCollections.push(name);
    } else {
      pack[name] = [];
      pack._errors[name] = result.reason?.message || String(result.reason || 'Unknown error');
    }
  });

  // หากอ่านไม่ได้ทุก collection ให้ถือว่า Sync ล้มเหลว ห้ามหน้าเว็บล้าง cache
  if (!pack._loadedCollections.length) {
    throw new Error('ไม่สามารถอ่านข้อมูลจาก Firestore ได้ทุก Collection');
  }

  return pack;
}


async function findBusinessDocs(collectionName, id, branch, year, month) {
  const filters = [where("id", "==", Number(id))];

  if (branch) filters.push(where("branch", "==", branch));
  if (year !== undefined && year !== null && year !== "") filters.push(where("year", "==", Number(year)));
  if (month !== undefined && month !== null && month !== "") {
    const monthIndex = Number(month);
    filters.push(where("monthIndex", "==", monthIndex));
  }

  let snap = await getDocs(query(collection(db, collectionName), ...filters));

  // เผื่อเอกสารเก่าบางรายการเก็บ id เป็น string
  if (snap.empty && String(Number(id)) !== "NaN") {
    const stringFilters = [where("id", "==", String(id))];
    if (branch) stringFilters.push(where("branch", "==", branch));
    if (year !== undefined && year !== null && year !== "") stringFilters.push(where("year", "==", Number(year)));
    if (month !== undefined && month !== null && month !== "") stringFilters.push(where("monthIndex", "==", Number(month)));
    snap = await getDocs(query(collection(db, collectionName), ...stringFilters));
  }

  return snap.docs;
}

export async function deleteBusinessDoc(collectionName, id, branch, year, month, firebaseId = "") {
  if (firebaseId) {
    await deleteDoc(doc(db, collectionName, firebaseId));
    return { deleted: 1 };
  }

  const docs = await findBusinessDocs(collectionName, id, branch, year, month);
  if (!docs.length) return { deleted: 0 };

  await Promise.all(docs.map(d => deleteDoc(d.ref)));
  return { deleted: docs.length };
}

export async function updateBusinessDoc(collectionName, id, branch, year, month, data, firebaseId = "") {
  const recordWithUser = withThaiCalendarMeta(withUserMeta({ ...data, branch, year, monthIndex: Number(month) }), year, Number(month));
  const sourceAttachments = Array.isArray(recordWithUser.attachments) ? recordWithUser.attachments : [];

  // เก็บลิงก์ Drive/ไฟล์ local เดิมไว้ และอัปโหลดเฉพาะไฟล์ใหม่ที่มี bytes จริง
  const existingAttachments = sourceAttachments.filter(file =>
    file && !file.data && !file.file && !file.blob && (file.webViewLink || file.localId || file.provider)
  );
  const newAttachments = sourceAttachments.filter(file =>
    file && (file.data || file.file || file.blob)
  );
  let uploadedAttachments = [];
  if (newAttachments.length) {
    uploadedAttachments = await uploadDataUrlFiles(collectionName, {
      ...recordWithUser,
      attachments: newAttachments
    });
  }

  const finalAttachments = [...existingAttachments, ...uploadedAttachments];
  const compactData = compactRecordForFirestore({
    ...recordWithUser,
    attachments: finalAttachments,
    storageProvider: detectStorageProvider(finalAttachments)
  });
  const payload = {
    ...compactData,
    ...normalizeMonth(compactData),
    updatedAt: serverTimestamp()
  };

  if (firebaseId) {
    await updateDoc(doc(db, collectionName, firebaseId), payload);
    return { updated: 1, attachments: finalAttachments, storageProvider: payload.storageProvider };
  }

  const docs = await findBusinessDocs(collectionName, id, branch, year, month);
  if (!docs.length) return { updated: 0, attachments: finalAttachments, storageProvider: payload.storageProvider };

  await Promise.all(docs.map(d => updateDoc(d.ref, payload)));
  return { updated: docs.length, attachments: finalAttachments, storageProvider: payload.storageProvider };
}


function deterministicImportDocId(prefix, value) {
  const safe = String(value || 'unknown')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'unknown';
  return `${prefix}_${safe}`;
}

function compactImportedRecord(record = {}) {
  // ป้องกันข้อมูลจากเวอร์ชันเก่าที่ถูกครอบทั้งก้อนไว้ใน attachments
  const nested = record?.attachments && !Array.isArray(record.attachments)
    && typeof record.attachments === 'object'
    && (record.attachments.branch || record.attachments.year || record.attachments.historicalSalesImport)
      ? record.attachments
      : null;
  const source = nested ? { ...record, ...nested } : { ...record };
  source.attachments = Array.isArray(source.attachments) ? source.attachments : [];

  const clean = compactRecordForFirestore(source);
  delete clean.firebaseId;
  delete clean._m;
  delete clean._y;
  return clean;
}

function normalizeImportedProductionForFirestore(record = {}, fallbackBranch = '') {
  const clean = compactImportedRecord(record);
  const monthFields = normalizeMonth(clean);
  const branch = String(clean.branch || fallbackBranch || '').trim();
  const year = inferRecordYear(clean) || new Date().getFullYear();
  const withCalendar = withThaiCalendarMeta({ ...clean, ...monthFields, branch, year }, year, monthFields.monthIndex);

  return {
    ...withCalendar,
    attachments: Array.isArray(clean.attachments) ? clean.attachments : [],
    historicalSalesImport: clean.historicalSalesImport === true,
    saleTotal: Number(clean.saleTotal ?? clean.subtotal ?? clean.total ?? 0) || 0,
    subtotal: Number(clean.subtotal ?? clean.saleTotal ?? clean.total ?? 0) || 0,
    total: Number(clean.total ?? clean.subtotal ?? clean.saleTotal ?? 0) || 0,
    costTotal: Number(clean.costTotal ?? clean.costSubtotal ?? 0) || 0
  };
}

async function commitImportWrites(writes = []) {
  const CHUNK_SIZE = 400;
  let committed = 0;
  for (let start = 0; start < writes.length; start += CHUNK_SIZE) {
    const batch = writeBatch(db);
    const chunk = writes.slice(start, start + CHUNK_SIZE);
    chunk.forEach(write => {
      batch.set(doc(db, write.collectionName, write.docId), write.data, { merge: false });
    });
    await batch.commit();
    committed += chunk.length;
  }
  return committed;
}

export async function importHistoricalSalesDataset({ archiveRecords = [], productionRecords = [], metadata = {} } = {}) {
  const profile = getCurrentProfile();
  if (!profile?.uid) throw new Error('กรุณาเข้าสู่ระบบก่อนนำข้อมูลขึ้น Firebase');

  const allowedBranch = profile.branch && profile.branch !== 'all' ? profile.branch : '';
  const nowIso = new Date().toISOString();
  const archiveWrites = archiveRecords.map(record => {
    const clean = compactImportedRecord(record);
    const branch = clean.branch || record.branch || metadata.branch || '';
    if (!branch || (allowedBranch && branch !== allowedBranch)) {
      throw new Error(`ไม่มีสิทธิ์นำเข้าข้อมูลสาขา ${branch || 'ไม่ระบุ'}`);
    }
    const monthFields = normalizeMonth(clean);
    const archiveYear = inferRecordYear(clean) || new Date().getFullYear();
    const normalizedArchive = withThaiCalendarMeta({
      ...clean,
      ...monthFields,
      branch,
      year: archiveYear
    }, archiveYear, monthFields.monthIndex);
    const sourceId = record.id || `${branch}-${archiveYear}-${normalizedArchive.monthNumber}-${record.documentNo || record.no || ''}`;
    return {
      collectionName: 'salesArchive',
      docId: deterministicImportDocId('sale', sourceId),
      data: {
        ...normalizedArchive,
        importedBy: profile.uid,
        importedByEmail: profile.email || '',
        importedAtIso: nowIso,
        datasetMetadata: metadata,
        updatedAt: serverTimestamp()
      }
    };
  });

  const productionWrites = productionRecords.map(record => {
    const branch = record.branch || metadata.branch || '';
    if (!branch || (allowedBranch && branch !== allowedBranch)) {
      throw new Error(`ไม่มีสิทธิ์นำเข้าข้อมูลสาขา ${branch || 'ไม่ระบุ'}`);
    }
    const sourceId = record.sourceDatasetId || record.id || `${branch}-${record.year}-${record.monthNumber}-${record.no}`;
    const normalized = normalizeImportedProductionForFirestore(record, branch);
    return {
      collectionName: 'productions',
      docId: deterministicImportDocId('historical', sourceId),
      data: {
        ...normalized,
        branch,
        importedBy: profile.uid,
        importedByEmail: profile.email || '',
        importedAtIso: nowIso,
        updatedAt: serverTimestamp()
      }
    };
  });

  const archiveCommitted = await commitImportWrites(archiveWrites);
  const productionCommitted = await commitImportWrites(productionWrites);
  return { archiveWrites: archiveCommitted, productionWrites: productionCommitted };
}


const REPAIRABLE_COLLECTIONS = [
  'quotes',
  'invoices',
  'receipts',
  'issuedInvoices',
  'issuedReceipts',
  'productions',
  'expenses',
  'salesArchive'
];

function validBusinessBranch(value) {
  return value === 'khonkaen' || value === 'ubon';
}

function normalizeLegacyBusinessDocument(raw = {}, fallbackBranch = 'khonkaen') {
  const nested = raw?.attachments
    && !Array.isArray(raw.attachments)
    && typeof raw.attachments === 'object'
      ? raw.attachments
      : {};

  // nested ก่อน แล้ว raw ทับ เพื่อรักษาค่าระดับบนสุดที่ถูกต้องอยู่แล้ว
  const source = { ...nested, ...raw };
  const year = inferRecordYear(source) || new Date().getFullYear();
  const monthFields = normalizeMonth(source);
  const branch = validBusinessBranch(source.branch) ? source.branch : fallbackBranch;

  return withThaiCalendarMeta({
    ...source,
    ...monthFields,
    branch,
    year,
    attachments: Array.isArray(source.attachments) ? source.attachments : []
  }, year, monthFields.monthIndex);
}

function documentNeedsRepair(data = {}) {
  const inferredYear = inferRecordYear(data);
  const month = normalizeMonth(data).monthIndex;
  const expectedBE = Number.isFinite(Number(inferredYear)) ? toBEYear(inferredYear) : null;
  return !validBusinessBranch(data.branch)
    || !Number.isFinite(Number(inferredYear))
    || !Number.isFinite(Number(month))
    || (expectedBE && Number(data.yearBE ?? data.buddhistYear) !== expectedBE)
    || (data.date && !data.dateThai)
    || (data.attachments && !Array.isArray(data.attachments));
}

export async function repairLegacyBusinessCollections() {
  const profile = getCurrentProfile();
  if (!profile?.uid) throw new Error('กรุณาเข้าสู่ระบบก่อนซ่อมข้อมูล');
  if (profile.branch !== 'all') throw new Error('ฟังก์ชันซ่อมข้อมูลใช้ได้เฉพาะผู้ดูแลระบบทุกสาขา');

  const stats = { scanned: 0, malformed: 0, repaired: 0, collections: {} };

  for (const collectionName of REPAIRABLE_COLLECTIONS) {
    const snapshot = await getDocs(collection(db, collectionName));
    const malformed = snapshot.docs.filter(snapshotDoc => documentNeedsRepair(snapshotDoc.data()));
    stats.scanned += snapshot.size;
    stats.malformed += malformed.length;
    stats.collections[collectionName] = {
      scanned: snapshot.size,
      malformed: malformed.length,
      repaired: 0
    };

    const CHUNK_SIZE = 350;
    for (let start = 0; start < malformed.length; start += CHUNK_SIZE) {
      const batch = writeBatch(db);
      malformed.slice(start, start + CHUNK_SIZE).forEach(snapshotDoc => {
        const current = snapshotDoc.data();
        const nestedBranch = current?.attachments && !Array.isArray(current.attachments)
          ? current.attachments.branch
          : '';
        const fallbackBranch = validBusinessBranch(nestedBranch) ? nestedBranch : 'khonkaen';
        const normalized = normalizeLegacyBusinessDocument(current, fallbackBranch);
        batch.set(snapshotDoc.ref, {
          ...normalized,
          repairedLegacyDocument: true,
          repairedAt: serverTimestamp(),
          repairedBy: profile.uid
        }, { merge: false });
        stats.repaired += 1;
        stats.collections[collectionName].repaired += 1;
      });
      await batch.commit();
    }
  }

  return stats;
}

// ชื่อเดิมเพื่อรองรับหน้าเว็บที่ Cache JavaScript เก่าไว้ชั่วคราว
export const repairMalformedHistoricalProductions = repairLegacyBusinessCollections;

// ให้ app.js เดิมเรียกใช้งานได้โดยไม่ต้องแปลงทั้งไฟล์ทันที
window.FirebaseService = {
  saveProduction,
  saveInvoice,
  saveQuote,
  saveReceipt,
  saveIssuedInvoice,
  saveIssuedReceipt,
  saveExpense,
  deleteBusinessDoc,
  updateBusinessDoc,
  loadCollectionByYear,
  loadAllDashboardDataByYear,
  importHistoricalSalesDataset,
  repairMalformedHistoricalProductions,
  repairLegacyBusinessCollections
};
