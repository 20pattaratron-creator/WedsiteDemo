// ============================================================================
// erp-company-profile-core.js — the customer's own company profile and logo (ADR-020)
// ERP DEMO 4.3.1 · round 7
// ----------------------------------------------------------------------------
// Pure helpers, no module state (the jsdom test harness gives every importer its own copy of
// an imported module, so anything shared lives on window.CurrentUser or in localStorage):
//   - validation: Thai tax ID check digit, 5-digit branch codes, required fields, lengths
//   - storage records under two tenant keys (erp-storage-contracts.js): the profile text
//     (COMPANY_PROFILE_KEY) and the logo (COMPANY_LOGO_KEY); atomic write with rollback
//   - applyCompanyProfileToUser(): merges a saved profile into window.CurrentUser.companyProfile
//     (and puts the original demo profile back when nothing is saved)
//   - documentCompany(): the company block one printed document shows for one branch, in the
//     field names the document modules' branchCompany() / branchInfo() already return
//   - companyLogoUrl(): the one logo getter (custom data URL, or the default ./logo.png)
//   - the logo pipeline: file checks, magic-byte sniffing, size from the file header (no
//     decode of huge images), canvas downscale to ≤ 600 px and PNG / JPEG encoding ≤ 300 KB
//   - backup payload validation (fail-closed) and the writes a restore makes
// Nothing here renders a user value without escapeHtml(); a logo is only ever a validated
// PNG / JPEG base64 data URL drawn by our own canvas — never the uploaded file, never SVG.
// With nothing saved every function returns the demo defaults, so documents render exactly as
// before (npm run audit:render-golden, tests/company-profile.test.cjs).
// ============================================================================
import { escapeHtml } from './erp-shared-core.js';
import { normalizeBranchSetting } from './erp-branches-core.js';

export const COMPANY_PROFILE_SCHEMA_VERSION = 1;
export const PLACEHOLDER_TAX_ID = '0000000000000';
export const HEAD_OFFICE_BRANCH_CODE = '00000';
// The system's two branch ids (index.html, every document module): ubon = head office,
// khonkaen = the second branch. Only the code / label / address printed for them is editable.
export const COMPANY_BRANCHES = Object.freeze([
  Object.freeze({ id: 'ubon', headOffice: true, defaultCode: HEAD_OFFICE_BRANCH_CODE }),
  Object.freeze({ id: 'khonkaen', headOffice: false, defaultCode: '00001' })
]);
// (typeof guard: the minimal vm contexts of some tests have no URL; Vite still sees the pattern.)
export const DEFAULT_COMPANY_LOGO_URL = typeof URL === 'function' ? new URL('./logo.png', import.meta.url).href : './logo.png';
// MIME parameter added to a custom logo's data URL when it is applied. Browsers ignore it when
// decoding, and CSS can tell a customer logo from the default one (CUSTOM_LOGO_CSS) — even in
// PDF mode, where the default logo is a data URL too.
export const CUSTOM_LOGO_MARKER = 'erp-logo=custom';
export const LOGO_LIMITS = Object.freeze({
  maxFileBytes: 5 * 1024 * 1024,   // the uploaded file
  maxSide: 600,                    // longest side after the downscale
  maxDataUrlChars: 300000,         // stored data URL (≈ 220 KB of image bytes)
  minSide: 32,                     // smaller would print as a smudge
  maxSourceSide: 12000,            // read from the file header before decoding
  maxSourcePixels: 50000000
});
export const LOGO_ACCEPTED_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);
export const FIELD_LIMITS = Object.freeze({ nameTh: 160, nameEn: 160, addressTh: 300, phone: 60, email: 120, website: 160, branchLabel: 60 });
const PROFILE_FIELDS = Object.freeze(['nameTh', 'nameEn', 'taxId', 'addressTh', 'phone', 'email', 'website']);
const BASE_PROP = '__erpCompanyProfileBase';

// Kept away from customer logos only: the quotation's round frame would crop a wide logo and the
// receipt tints its logo (hue-rotate). Injected into the page and into the quotation / receipt
// print windows (customLogoStyleTag), which load only their own stylesheet.
export const CUSTOM_LOGO_CSS = `.qdoc-logo[src*="${CUSTOM_LOGO_MARKER}"],.qdoc-toolbar-brand img[src*="${CUSTOM_LOGO_MARKER}"]{object-fit:contain;border-radius:0;border:0;box-shadow:none;background:transparent}`
  + `.rcp-document-page .rcp-doc-company img[src*="${CUSTOM_LOGO_MARKER}"],.rcp-document-page .rcp-doc-watermark[src*="${CUSTOM_LOGO_MARKER}"]{filter:none}`;

// ---------------------------------------------------------------- text + field rules
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

// One line of text: every whitespace run (incl. new lines from a textarea) becomes one space,
// control characters are dropped. Documents print these values on one line each.
// Zero-width and bidi-override characters are removed (they could make a printed name read
// differently from what is stored).
export function cleanText(value) {
  return String(value ?? '').replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '').replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();
}

export function normalizeTaxIdInput(value) {
  return String(value ?? '').replace(/[\s-]/g, '');
}

// Thai 13-digit tax ID (เลขประจำตัวผู้เสียภาษี / บัตรประชาชน): digit 13 = (11 − Σ dᵢ·(14−i) mod 11) mod 10.
export function isValidThaiTaxId(value) {
  const digits = String(value ?? '');
  if (!/^\d{13}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(digits[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(digits[12]);
}

export function isValidBranchCode(code, { headOffice = false } = {}) {
  const value = String(code ?? '');
  if (headOffice) return value === HEAD_OFFICE_BRANCH_CODE;
  return /^\d{5}$/.test(value) && value !== HEAD_OFFICE_BRANCH_CODE;
}

// The wording the Revenue Code asks for on a tax invoice: สำนักงานใหญ่ / สาขาที่ xxxxx.
export function legalBranchLabel(code) {
  return code === HEAD_OFFICE_BRANCH_CODE ? 'สำนักงานใหญ่' : `สาขาที่ ${code}`;
}
export function legalBranchLabelEn(code) {
  return code === HEAD_OFFICE_BRANCH_CODE ? 'HEAD OFFICE' : `BRANCH ${code}`;
}
// What the documents print as the branch "label" (quotation pill, credit-note tax line).
export function branchDocumentLabel(branch) {
  const legal = legalBranchLabel(branch.code);
  const label = cleanText(branch.label);
  if (!label || label === legal || label.includes(legal)) return label || legal;
  return `${legal} (${label})`;
}

const EMAIL_RE = /^[^\s@<>()[\]"',;:]+@[^\s@<>()[\]"',;:]+\.[^\s@<>()[\]"',;:]{2,}$/;
const WEBSITE_RE = /^(?:https?:\/\/)?[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}(?::\d{1,5})?(?:[/?#][^\s<>"'`]*)?$/;

// Form values (strings, as typed) → { ok, errors: { field: Thai message }, profile }.
// `allowPlaceholderTaxId`: 0000000000000 is accepted only while it is still the saved value
// (the demo placeholder the customer has not replaced yet).
export function validateCompanyProfile(input, { allowPlaceholderTaxId = false } = {}) {
  const source = isPlainObject(input) ? input : {};
  const errors = {};
  const text = field => cleanText(source[field]);
  const profile = {
    schemaVersion: COMPANY_PROFILE_SCHEMA_VERSION,
    nameTh: text('nameTh'),
    nameEn: text('nameEn'),
    taxId: normalizeTaxIdInput(source.taxId),
    addressTh: text('addressTh'),
    phone: text('phone'),
    email: text('email'),
    website: text('website'),
    branches: {}
  };
  const tooLong = (field, max, label) => { if (profile[field].length > max) errors[field] = `${label}ยาวเกิน ${max} ตัวอักษร`; };
  if (!profile.nameTh) errors.nameTh = 'กรุณากรอกชื่อบริษัทภาษาไทย';
  else if (profile.nameTh.length < 2) errors.nameTh = 'ชื่อบริษัทสั้นเกินไป';
  else tooLong('nameTh', FIELD_LIMITS.nameTh, 'ชื่อบริษัท');
  tooLong('nameEn', FIELD_LIMITS.nameEn, 'ชื่อภาษาอังกฤษ');
  if (!profile.taxId) errors.taxId = 'กรุณากรอกเลขประจำตัวผู้เสียภาษี 13 หลัก';
  else if (profile.taxId === PLACEHOLDER_TAX_ID) { if (!allowPlaceholderTaxId) errors.taxId = 'กรุณากรอกเลขประจำตัวผู้เสียภาษีจริงของบริษัท (ไม่ใช่ 0000000000000)'; }
  else if (!/^\d{13}$/.test(profile.taxId)) errors.taxId = 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก';
  else if (!isValidThaiTaxId(profile.taxId)) errors.taxId = 'เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง (หลักสุดท้ายไม่ตรงกับเลขตรวจสอบ) กรุณาตรวจอีกครั้ง';
  if (!profile.addressTh) errors.addressTh = 'กรุณากรอกที่อยู่สำนักงานใหญ่';
  else tooLong('addressTh', FIELD_LIMITS.addressTh, 'ที่อยู่');
  if (profile.phone && !/\d/.test(profile.phone)) errors.phone = 'เบอร์โทรต้องมีตัวเลข';
  else tooLong('phone', FIELD_LIMITS.phone, 'เบอร์โทร');
  if (profile.email && !EMAIL_RE.test(profile.email)) errors.email = 'รูปแบบอีเมลไม่ถูกต้อง เช่น info@example.co.th';
  else tooLong('email', FIELD_LIMITS.email, 'อีเมล');
  if (profile.website && !WEBSITE_RE.test(profile.website)) errors.website = 'รูปแบบเว็บไซต์ไม่ถูกต้อง เช่น www.example.co.th';
  else tooLong('website', FIELD_LIMITS.website, 'เว็บไซต์');
  const branchesIn = isPlainObject(source.branches) ? source.branches : {};
  for (const branch of COMPANY_BRANCHES) {
    const raw = isPlainObject(branchesIn[branch.id]) ? branchesIn[branch.id] : {};
    const row = {
      code: branch.headOffice ? HEAD_OFFICE_BRANCH_CODE : String(raw.code ?? '').replace(/\s/g, ''),
      label: cleanText(raw.label),
      addressTh: cleanText(raw.addressTh)
    };
    profile.branches[branch.id] = row;
    const at = field => `branches.${branch.id}.${field}`;
    if (branch.headOffice && raw.code !== undefined && String(raw.code).trim() !== HEAD_OFFICE_BRANCH_CODE) errors[at('code')] = 'รหัสสำนักงานใหญ่ต้องเป็น 00000';
    if (!branch.headOffice && !isValidBranchCode(row.code)) errors[at('code')] = 'รหัสสาขาต้องเป็นตัวเลข 5 หลัก และไม่ใช่ 00000 (00000 = สำนักงานใหญ่)';
    if (row.label.length > FIELD_LIMITS.branchLabel) errors[at('label')] = `ชื่อสาขายาวเกิน ${FIELD_LIMITS.branchLabel} ตัวอักษร`;
    if (row.addressTh.length > FIELD_LIMITS.addressTh) errors[at('addressTh')] = `ที่อยู่ยาวเกิน ${FIELD_LIMITS.addressTh} ตัวอักษร`;
  }
  // ADR-023 (G7): how ภ.พ.30 is filed — 'separate' (แยกยื่นรายสถานประกอบการ, the default: stored as no field,
  // so every profile saved before keeps its exact shape) or 'combined' (ยื่นรวมกัน, after RD approval).
  const filingMode = String(source.vatFilingMode ?? '').trim();
  if (filingMode === 'combined') profile.vatFilingMode = 'combined';
  else if (filingMode && filingMode !== 'separate') errors.vatFilingMode = 'วิธียื่น ภ.พ.30 ต้องเป็น "แยกยื่นรายสถานประกอบการ" หรือ "ยื่นรวมกัน"';
  return { ok: Object.keys(errors).length === 0, errors, profile };
}

// A stored / restored record: must validate as it is (placeholder tax ID allowed — the form
// saves it while unchanged). Returns the normalized profile or throws a Thai message.
export function normalizeStoredProfile(value) {
  if (!isPlainObject(value)) throw new Error('ข้อมูลบริษัทต้องเป็น object');
  const version = Number(value.schemaVersion);
  if (!Number.isInteger(version) || version < 1 || version > COMPANY_PROFILE_SCHEMA_VERSION) throw new Error('ข้อมูลบริษัทเป็นเวอร์ชันที่ระบบนี้ไม่รองรับ');
  for (const field of PROFILE_FIELDS) if (value[field] !== undefined && typeof value[field] !== 'string') throw new Error(`ข้อมูลบริษัท ${field} ต้องเป็นข้อความ`);
  const result = validateCompanyProfile(value, { allowPlaceholderTaxId: true });
  if (!result.ok) throw new Error(`ข้อมูลบริษัทไม่ถูกต้อง: ${Object.values(result.errors)[0]}`);
  const updatedAt = typeof value.updatedAt === 'string' && !Number.isNaN(Date.parse(value.updatedAt)) ? value.updatedAt : '';
  return { ...result.profile, updatedAt };
}

// The form's starting values: the saved profile, or the demo profile currently on CurrentUser.
export function companyProfileFormValues(saved, baseCompanyProfile = {}) {
  const base = isPlainObject(baseCompanyProfile) ? baseCompanyProfile : {};
  const source = saved || {
    nameTh: base.nameTh || base.companyNameTh || '',
    nameEn: base.nameEn || base.companyNameEn || '',
    taxId: base.taxId || PLACEHOLDER_TAX_ID,
    addressTh: base.addressTh || '',
    phone: base.phone || '',
    email: base.email || '',
    website: base.website || '',
    branches: {}
  };
  const values = {};
  for (const field of PROFILE_FIELDS) values[field] = String(source[field] ?? '');
  values.branches = {};
  for (const branch of COMPANY_BRANCHES) {
    const row = source.branches?.[branch.id] || {};
    values.branches[branch.id] = { code: String(row.code || branch.defaultCode), label: String(row.label || ''), addressTh: String(row.addressTh || '') };
  }
  values.vatFilingMode = source.vatFilingMode === 'combined' ? 'combined' : 'separate';
  return values;
}

// ---------------------------------------------------------------- logo records
const LOGO_DATA_URL_RE = /^data:image\/(png|jpeg)(;erp-logo=custom)?;base64,([A-Za-z0-9+/]+={0,2})$/;
// First base64 characters of a real PNG (89 50 4E 47 0D 0A 1A 0A) / JPEG (FF D8 FF) file.
const LOGO_BASE64_SIGNATURE = Object.freeze({ png: 'iVBORw0KGgo', jpeg: '/9j/' });

// The limit counts the data URL as stored (without the marker).
export function isStorableLogoDataUrl(value) {
  if (typeof value !== 'string' || value.length > LOGO_LIMITS.maxDataUrlChars + CUSTOM_LOGO_MARKER.length + 1) return false;
  const match = LOGO_DATA_URL_RE.exec(value);
  if (!match || value.length - (match[2] ? match[2].length : 0) > LOGO_LIMITS.maxDataUrlChars) return false;
  return match[3].length % 4 === 0 && match[3].startsWith(LOGO_BASE64_SIGNATURE[match[1]]);
}
const unmarkedLogo = dataUrl => dataUrl.replace(`;${CUSTOM_LOGO_MARKER};`, ';');
export function markCustomLogo(dataUrl) {
  return unmarkedLogo(dataUrl).replace(/^data:image\/(png|jpeg);base64,/, `data:image/$1;${CUSTOM_LOGO_MARKER};base64,`);
}
export function isCustomLogoUrl(value) {
  return typeof value === 'string' && value.startsWith('data:image/') && value.includes(`;${CUSTOM_LOGO_MARKER};`);
}

export function normalizeLogoRecord(value) {
  if (!isPlainObject(value)) throw new Error('ข้อมูลโลโก้ต้องเป็น object');
  const version = Number(value.schemaVersion);
  if (!Number.isInteger(version) || version < 1 || version > COMPANY_PROFILE_SCHEMA_VERSION) throw new Error('ข้อมูลโลโก้เป็นเวอร์ชันที่ระบบนี้ไม่รองรับ');
  if (!isStorableLogoDataUrl(value.dataUrl)) throw new Error('โลโก้ต้องเป็นรูป PNG หรือ JPEG (data URL) ขนาดไม่เกิน 300 KB');
  const width = Number(value.width), height = Number(value.height);
  const side = n => Number.isInteger(n) && n >= 1 && n <= LOGO_LIMITS.maxSide;
  if (!side(width) || !side(height)) throw new Error(`ขนาดโลโก้ต้องไม่เกิน ${LOGO_LIMITS.maxSide} px`);
  const dataUrl = unmarkedLogo(value.dataUrl);
  const updatedAt = typeof value.updatedAt === 'string' && !Number.isNaN(Date.parse(value.updatedAt)) ? value.updatedAt : '';
  return { schemaVersion: COMPANY_PROFILE_SCHEMA_VERSION, dataUrl, mime: dataUrl.slice(5, dataUrl.indexOf(';')), width, height, updatedAt };
}

// ---------------------------------------------------------------- storage
export function isQuotaError(error) {
  return !!error && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error.code === 22 || error.code === 1014);
}

// Reads both records. A damaged record is ignored (the demo default shows) and reported in
// `errors`, so a bad value can never stop the app from starting.
export function readCompanyProfileStorage(storage, keyFor, keys) {
  const out = { profile: null, logo: null, raw: { profile: null, logo: null }, errors: [] };
  const read = (kind, normalize) => {
    let raw = null;
    try { raw = storage.getItem(keyFor(keys[kind])); } catch (error) { out.errors.push(`${kind}: ${error?.message || error}`); return; }
    out.raw[kind] = raw;
    if (raw === null || raw === 'null') return;
    try { out[kind] = normalize(JSON.parse(raw)); } catch (error) { out.errors.push(`${kind}: ${error?.message || error}`); }
  };
  read('profile', normalizeStoredProfile);
  read('logo', normalizeLogoRecord);
  return out;
}

// Writes { profile, logo } (null = remove) all-or-nothing: on any error — typically
// QuotaExceededError from the logo — the keys written so far get their old values back and the
// error is rethrown, so nothing is ever half-saved. ADR-022: `undefined` leaves that key as it is
// (only the number of establishments changed), and `branchSetting` (with keys.branchSetting) is the
// third record of the same all-or-nothing write.
export function writeCompanyProfileStorage(storage, keyFor, keys, { profile, logo, branchSetting }) {
  const entries = [
    ...(logo === undefined ? [] : [[keyFor(keys.logo), logo ? JSON.stringify(logo) : null]]),
    ...(profile === undefined ? [] : [[keyFor(keys.profile), profile ? JSON.stringify(profile) : null]]),
    ...(branchSetting === undefined || !keys.branchSetting ? [] : [[keyFor(keys.branchSetting), branchSetting ? JSON.stringify(branchSetting) : null]])
  ];
  const before = new Map(entries.map(([key]) => [key, storage.getItem(key)]));
  const done = [];
  try {
    for (const [key, value] of entries) {
      if (value === null) storage.removeItem(key); else storage.setItem(key, value);
      done.push(key);
    }
  } catch (error) {
    // A failed setItem leaves its key unchanged; put back the keys already written.
    for (const key of done.reverse()) {
      const value = before.get(key);
      try { if (value === null) storage.removeItem(key); else storage.setItem(key, value); }
      catch (rollbackError) { console.error('[CompanyProfile] rollback failed', rollbackError); }
    }
    throw error;
  }
}

// ---------------------------------------------------------------- CurrentUser merge
const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const deepFreeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };

function contactLine(profile) {
  const parts = [`Tel: ${profile.phone || '-'}`];
  if (profile.email) parts.push(`Email: ${profile.email}`);
  if (profile.website) parts.push(`Web: ${profile.website}`);
  return parts.join('   ');
}
function quotationContact(profile) {
  return [profile.phone || '-', profile.email ? `อีเมล ${profile.email}` : '', profile.website ? `เว็บไซต์ ${profile.website}` : ''].filter(Boolean).join(' · ');
}

// The company block of one document for one branch. `style`:
//   'tax-invoice' (ใบกำกับภาษี / ใบเสร็จ — they print no separate branch line): the branch goes
//                 after the name, as their built-in defaults did ("… จำกัด (สำนักงานใหญ่)")
//   'quotation' / 'credit-note': plain name; the branch is their printed `label`.
export function companyForDocument(profile, branchId, style, fallbackBranchId = 'ubon') {
  const branches = profile?.branches || {};
  const branch = branches[branchId] || branches[fallbackBranchId];
  if (!branch) return null;
  const taxStyle = style === 'tax-invoice';
  const nameEn = profile.nameEn || '';
  return {
    label: branchDocumentLabel(branch),
    branchCode: branch.code,
    companyNameTh: taxStyle ? `${profile.nameTh} (${legalBranchLabel(branch.code)})` : profile.nameTh,
    companyNameEn: nameEn && taxStyle ? `${nameEn} (${legalBranchLabelEn(branch.code)})` : nameEn,
    addressTh: branch.addressTh || profile.addressTh,
    addressEn: '',
    phone: style === 'quotation' ? quotationContact(profile) : contactLine(profile),
    taxId: profile.taxId,
    email: profile.email || '',
    website: profile.website || ''
  };
}

const globalUser = () => (typeof window !== 'undefined' ? window.CurrentUser : undefined);

// For branchCompany() / branchInfo() of the document modules: null while no profile is saved
// (they then keep their built-in behaviour exactly).
export function documentCompany(user, branchId, style, fallbackBranchId) {
  const profile = user?.companyProfile;
  if (!profile || profile.customProfile !== true || !isPlainObject(profile.custom)) return null;
  return companyForDocument(profile.custom, branchId, style, fallbackBranchId);
}

export function companyLogoUrl(user = globalUser()) {
  const url = user?.companyProfile?.logoDataUrl;
  return isCustomLogoUrl(url) && isStorableLogoDataUrl(url) ? url : DEFAULT_COMPANY_LOGO_URL;
}

// <style> for a print window: empty for the default logo, so its HTML stays as it was.
export function customLogoStyleTag(logoUrl) {
  return isCustomLogoUrl(logoUrl) ? `<style>${CUSTOM_LOGO_CSS}</style>` : '';
}

// Header title / logo, or null while the demo defaults apply (header unchanged).
export function companyHeaderBranding(user = globalUser()) {
  const profile = user?.companyProfile;
  const custom = profile?.customProfile === true && isPlainObject(profile.custom) ? profile.custom : null;
  const logoUrl = companyLogoUrl(user);
  if (!custom && logoUrl === DEFAULT_COMPANY_LOGO_URL) return null;
  return { title: custom ? custom.nameTh : '', logoUrl, custom: !!custom, customLogo: logoUrl !== DEFAULT_COMPANY_LOGO_URL };
}

// Merges { profile, logo } (normalized records, or null) into the user object. The first call
// keeps the original demo values (non-enumerable), so "no profile" always means exactly the
// original object values again. Returns false when the user object cannot be changed.
export function applyCompanyProfileToUser(user, { profile = null, logo = null } = {}) {
  if (!user || typeof user !== 'object') return false;
  try {
    if (!hasOwn(user, BASE_PROP)) {
      Object.defineProperty(user, BASE_PROP, {
        value: Object.freeze({ hasCompanyProfile: hasOwn(user, 'companyProfile'), companyProfile: clone(user.companyProfile), tenantName: user.tenantName, companyName: user.companyName }),
        enumerable: false
      });
    }
    const base = user[BASE_PROP];
    let companyProfile = base.hasCompanyProfile ? clone(base.companyProfile) : undefined;
    if (profile) {
      const custom = deepFreeze(clone(profile));
      const branches = {};
      for (const branch of COMPANY_BRANCHES) branches[branch.id] = { ...companyForDocument(custom, branch.id, 'tax-invoice', branch.id), code: custom.branches[branch.id].code };
      companyProfile = {
        ...(isPlainObject(companyProfile) ? companyProfile : {}),
        nameTh: custom.nameTh, nameEn: custom.nameEn, taxId: custom.taxId, phone: custom.phone,
        addressTh: custom.addressTh, email: custom.email, website: custom.website,
        companyNameTh: custom.nameTh, companyNameEn: custom.nameEn,
        customProfile: true, custom, branches
      };
      user.tenantName = custom.nameTh;
      user.companyName = custom.nameTh;
    } else {
      user.tenantName = base.tenantName;
      user.companyName = base.companyName;
    }
    if (logo) companyProfile = { ...(isPlainObject(companyProfile) ? companyProfile : {}), logoDataUrl: markCustomLogo(logo.dataUrl) };
    if (companyProfile === undefined) delete user.companyProfile; else user.companyProfile = companyProfile;
    return true;
  } catch (error) {
    console.warn('[CompanyProfile] could not apply the company profile', error);
    return false;
  }
}

// The pristine demo profile (what "กลับไปใช้ข้อมูลตัวอย่าง" returns to).
export function baseCompanyProfile(user) {
  if (user && hasOwn(user, BASE_PROP)) return clone(user[BASE_PROP].companyProfile) || {};
  return clone(user?.companyProfile) || {};
}

// ---------------------------------------------------------------- preview (settings page)
// Two document headers (head office + branch) as the tax invoice prints them. Every value is
// escaped; the logo is a validated data URL or the default file URL.
// ADR-022: `branchCount` 1 = the head office header only (the company has no second branch).
export function companyHeaderPreviewHtml(profile, logoUrl, { branchCount = 2 } = {}) {
  const logo = isCustomLogoUrl(logoUrl) || logoUrl === DEFAULT_COMPANY_LOGO_URL ? logoUrl : DEFAULT_COMPANY_LOGO_URL;
  return COMPANY_BRANCHES.filter(branch => branchCount !== 1 || branch.headOffice).map(branch => {
    const company = companyForDocument(profile, branch.id, 'tax-invoice', branch.id);
    if (!company) return '';
    return `<div class="cp-doc-head" data-cp-preview-branch="${branch.id}">
      <img class="cp-doc-logo" src="${escapeHtml(logo)}" alt="">
      <div class="cp-doc-company">
        <div class="cp-doc-name">${escapeHtml(company.companyNameTh || '(ชื่อบริษัท)')}</div>
        ${company.companyNameEn ? `<div class="cp-doc-name-en">${escapeHtml(company.companyNameEn)}</div>` : ''}
        <div class="cp-doc-line">${escapeHtml(company.addressTh || '(ที่อยู่)')}</div>
        <div class="cp-doc-line">${escapeHtml(company.phone)}</div>
        <div class="cp-doc-tax">เลขประจำตัวผู้เสียภาษี ${escapeHtml(company.taxId || '-')} · ${escapeHtml(company.label)}</div>
      </div>
      <div class="cp-doc-title">ใบกำกับภาษี<small>TAX INVOICE</small></div>
    </div>`;
  }).join('');
}

// ---------------------------------------------------------------- backup
// masterData.companyProfile of a JSON backup: { schemaVersion, profile, logo } (each may be
// null = the demo default). Only written when this browser has something saved. ADR-022: plus
// `branchSetting` ({ schemaVersion, count, updatedAt }) once the number of establishments was saved.
export function companyProfileBackupPayload(record) {
  if (!record?.profile && !record?.logo && !record?.branchSetting) return undefined;
  const payload = { schemaVersion: COMPANY_PROFILE_SCHEMA_VERSION, profile: record.profile || null, logo: record.logo || null };
  if (record.branchSetting) payload.branchSetting = record.branchSetting;
  return payload;
}

// Fail-closed check of a backup's companyProfile (run by ERPBackup.validate before anything is
// written). Returns the normalized { profile, logo } or throws a Thai message.
export function validateCompanyProfileBackup(value) {
  try {
    if (!isPlainObject(value)) throw new Error('ต้องเป็น object');
    const version = Number(value.schemaVersion);
    if (!Number.isInteger(version) || version < 1 || version > COMPANY_PROFILE_SCHEMA_VERSION) throw new Error('เวอร์ชันไม่รองรับ');
    for (const key of Object.keys(value)) if (!['schemaVersion', 'profile', 'logo', 'branchSetting'].includes(key)) throw new Error(`มี field ที่ไม่รู้จัก (${key})`);
    const out = {
      profile: value.profile === null || value.profile === undefined ? null : normalizeStoredProfile(value.profile),
      logo: value.logo === null || value.logo === undefined ? null : normalizeLogoRecord(value.logo)
    };
    // Absent = a backup from before ADR-022: the current setting is left as it is.
    if (value.branchSetting !== null && value.branchSetting !== undefined) out.branchSetting = normalizeBranchSetting(value.branchSetting);
    return out;
  } catch (error) {
    throw new Error(`ข้อมูลบริษัท/โลโก้ใน Backup ไม่ถูกต้อง: ${error?.message || error} — ระบบหยุดก่อนเขียนข้อมูล`);
  }
}

// [key, value] writes for ERPIntegrity.transaction when a backup is imported (one transaction
// with the other master data). Same rule as the business rules: "แทนที่" always applies it;
// "รวม" applies it when this browser has none saved or the backup's copy is not older.
// The logo key gets 'null' (= default logo) when the backup's company used the default.
// ADR-022: the backup's number of establishments travels with it (keys.branchSetting). With "รวม" a
// local setting newer than the backup's stays. Restoring "1" next to branch-2 data never hides that
// data: the screens then show both branches and a warning (erp-branches-core.js).
export function companyProfileBackupWrites(value, keyFor, keys, current, { replace = false } = {}) {
  if (value === undefined) return [];
  const incoming = validateCompanyProfileBackup(value);
  const stamp = record => Math.max(Date.parse(record?.profile?.updatedAt || '') || 0, Date.parse(record?.logo?.updatedAt || '') || 0);
  const hasCurrent = !!(current?.profile || current?.logo);
  const writes = [];
  if (replace || !hasCurrent || stamp(incoming) >= stamp(current)) {
    writes.push([keyFor(keys.profile), incoming.profile ? JSON.stringify(incoming.profile) : 'null'], [keyFor(keys.logo), incoming.logo ? JSON.stringify(incoming.logo) : 'null']);
  }
  const settingStamp = record => Date.parse(record?.updatedAt || '') || 0;
  if (incoming.branchSetting && keys.branchSetting && (replace || !current?.branchSetting || settingStamp(incoming.branchSetting) >= settingStamp(current.branchSetting))) {
    writes.push([keyFor(keys.branchSetting), JSON.stringify(incoming.branchSetting)]);
  }
  return writes;
}

// ---------------------------------------------------------------- logo pipeline
// File checks before reading it: Thai message, or '' when it may be read.
export function checkLogoFile(file, limits = LOGO_LIMITS) {
  if (!file) return 'กรุณาเลือกไฟล์รูปโลโก้';
  const name = String(file.name || '').toLowerCase();
  const type = String(file.type || '').toLowerCase();
  if (/svg/.test(type) || /\.svgz?$/.test(name)) return 'ไม่รองรับไฟล์ SVG — กรุณาใช้ไฟล์ PNG, JPG หรือ WebP';
  const typeOk = LOGO_ACCEPTED_TYPES.includes(type) || type === 'image/jpg' || (!type && /\.(png|jpe?g|webp)$/.test(name));
  if (!typeOk) return 'รองรับเฉพาะไฟล์รูป PNG, JPG หรือ WebP';
  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0) return 'ไฟล์ว่างหรืออ่านไม่ได้';
  if (size > limits.maxFileBytes) return `ไฟล์ใหญ่เกิน ${Math.round(limits.maxFileBytes / 1048576)} MB (ไฟล์นี้ ${(size / 1048576).toFixed(1)} MB) — กรุณาย่อรูปก่อน`;
  return '';
}

// Real type from the first bytes (the browser's file.type only trusts the extension).
export function sniffImageType(bytes) {
  const b = bytes || [];
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return '';
}

// Width / height from the file header (PNG IHDR, JPEG SOFn, WebP VP8 / VP8L / VP8X), so a huge
// image is refused before the browser allocates memory to decode it. null = unreadable.
export function imageSizeFromBytes(bytes, type = sniffImageType(bytes)) {
  const b = bytes || [];
  const u16be = i => (b[i] << 8) | b[i + 1];
  const u32be = i => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  const tag = i => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
  const ok = size => (size.width > 0 && size.height > 0 ? size : null);
  if (type === 'image/png') return b.length >= 24 && tag(12) === 'IHDR' ? ok({ width: u32be(16), height: u32be(20) }) : null;
  if (type === 'image/webp') {
    if (b.length < 30) return null;
    const chunk = tag(12);
    if (chunk === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return ok({ width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff });
    if (chunk === 'VP8L' && b[20] === 0x2f) return ok({ width: 1 + (((b[22] & 0x3f) << 8) | b[21]), height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) });
    if (chunk === 'VP8X') return ok({ width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) });
    return null;
  }
  if (type === 'image/jpeg') {
    let i = 2;
    while (i + 3 < b.length) {
      if (b[i] !== 0xff) return null;
      while (b[i + 1] === 0xff && i + 2 < b.length) i += 1; // fill bytes
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      if (marker === 0xd9 || marker === 0xda) return null; // end of image / scan data before any frame header
      const length = u16be(i + 2);
      if (length < 2) return null;
      const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (sof) return i + 8 < b.length ? ok({ width: u16be(i + 7), height: u16be(i + 5) }) : null;
      i += 2 + length;
    }
    return null;
  }
  return null;
}

export function checkLogoDimensions(size, limits = LOGO_LIMITS) {
  if (!size) return 'อ่านขนาดรูปไม่ได้ ไฟล์อาจเสียหรือไม่ใช่รูป PNG / JPG / WebP';
  if (size.width < limits.minSide || size.height < limits.minSide) return `รูปเล็กเกินไป (${size.width}×${size.height} px) — ต้องกว้างและสูงอย่างน้อย ${limits.minSide} px`;
  if (size.width > limits.maxSourceSide || size.height > limits.maxSourceSide || size.width * size.height > limits.maxSourcePixels) return `รูปใหญ่เกินไป (${size.width}×${size.height} px) — กรุณาย่อให้ไม่เกิน ${limits.maxSourceSide} px ก่อน`;
  return '';
}

export function fitWithin(width, height, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// Encoding attempts, best first. Transparent logos stay PNG (smaller sizes until it fits);
// opaque ones try PNG and JPEG at 600 px, then JPEG at lower quality / size.
export function logoEncodingSteps(transparent, limits = LOGO_LIMITS) {
  const max = limits.maxSide;
  if (transparent) return [max, 480, 400, 320, 240].filter(side => side <= max).map(side => ({ side, type: 'image/png' }));
  return [
    { side: max, type: 'best' },
    { side: max, type: 'image/jpeg', quality: 0.8 },
    { side: max, type: 'image/jpeg', quality: 0.7 },
    { side: max, type: 'image/jpeg', quality: 0.6 },
    ...[480, 400, 320, 240].filter(side => side < max).map(side => ({ side, type: 'image/jpeg', quality: 0.7 }))
  ];
}

function canvasHasTransparency(context, width, height) {
  try {
    const data = context.getImageData(0, 0, width, height).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
    return false;
  } catch (error) {
    console.warn('[CompanyProfile] pixel read failed, keeping PNG', error);
    return true;
  }
}

// Draws `image` (an ImageBitmap / <img>, `size` = its decoded size) on our own canvas and returns
// the logo record to store. createCanvas(width, height) → a canvas (injectable for tests).
// Throws an Error with a Thai message when no attempt fits maxDataUrlChars.
export function encodeLogoImage(image, size, createCanvas, limits = LOGO_LIMITS, now = new Date()) {
  const canvases = new Map();
  const draw = side => {
    if (canvases.has(side)) return canvases.get(side);
    const target = fitWithin(size.width, size.height, side);
    const canvas = createCanvas(target.width, target.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('เบราว์เซอร์นี้วาดรูปไม่ได้ (canvas) — ลองใช้ Chrome / Edge / Safari รุ่นใหม่');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.clearRect(0, 0, target.width, target.height);
    context.drawImage(image, 0, 0, target.width, target.height);
    const entry = { canvas, context, ...target };
    canvases.set(side, entry);
    return entry;
  };
  const first = draw(limits.maxSide);
  const transparent = canvasHasTransparency(first.context, first.width, first.height);
  const encode = (canvas, type, quality) => {
    const url = canvas.toDataURL(type, quality);
    return isStorableLogoDataUrl(url) && url.startsWith(`data:${type};`) ? url : '';
  };
  for (const step of logoEncodingSteps(transparent, limits)) {
    const target = draw(step.side);
    let dataUrl;
    if (step.type === 'best') {
      const png = encode(target.canvas, 'image/png');
      const jpeg = encode(target.canvas, 'image/jpeg', 0.9);
      // JPEG only when it is much smaller (≥ 30 %): PNG keeps text and flat colours sharp.
      dataUrl = jpeg && (!png || jpeg.length <= png.length * 0.7) ? jpeg : png;
    } else {
      dataUrl = encode(target.canvas, step.type, step.quality);
    }
    if (dataUrl && dataUrl.length <= limits.maxDataUrlChars) {
      return normalizeLogoRecord({ schemaVersion: COMPANY_PROFILE_SCHEMA_VERSION, dataUrl, width: target.width, height: target.height, updatedAt: now.toISOString() });
    }
  }
  throw new Error('โลโก้นี้มีรายละเอียดมากเกินไป ย่อให้เล็กกว่า 300 KB ไม่ได้ — กรุณาใช้รูปที่เรียบง่ายขึ้นหรือพื้นหลังสีเดียว');
}
