// ============================================================================
// erp-company-profile.js — ตั้งค่าบริษัท › "ข้อมูลบริษัทและโลโก้" (ADR-020)
// ERP DEMO 4.3.1 · round 7
// ----------------------------------------------------------------------------
// The customer types their own company name / address / tax ID / branch codes and uploads their
// logo; after "บันทึก" the header, the document-entry toolbars and every printed / PDF document
// (quotation, delivery / tax invoice incl. abbreviated, receipt, credit note) use them at once,
// and after a reload. Rules and storage live in erp-company-profile-core.js (pure); this file is
// the form, the logo upload (browser canvas), the change signal and the backup hooks:
//   - save → writeCompanyProfileStorage (atomic, QuotaExceededError = nothing saved) → apply to
//     window.CurrentUser → COMPANY_PROFILE_CHANGED_EVENT (documents / header re-render) +
//     STORAGE_WRITTEN_EVENT
//   - re-applies after any other write of the two keys: backup import / rollback
//     (STORAGE_WRITTEN_EVENT) and other tabs (`storage` event)
//   - window.ERPCompanyProfile: exportBackup() / backupWrites() for app.js JSON backups,
//     prepareLogo(file) and refresh()
// The boot-time merge is in local-demo-mode.js (it must run before the document modules).
// ADR-022: the same form chooses 1 or 2 establishments (COMPANY_BRANCH_SETTING_KEY, saved in the same
// all-or-nothing write, refused while branch 2 holds data), and this file applies the choice and the
// branch labels to the static screens (forms, filters, dashboard tabs) + the "data hidden?" warning.
// ============================================================================
import { escapeHtml } from './erp-shared-core.js';
import { icon } from './erp-icons.js';
import { COMPANY_PROFILE_KEY, COMPANY_LOGO_KEY, COMPANY_BRANCH_SETTING_KEY, COMPANY_PROFILE_CHANGED_EVENT, STORAGE_WRITTEN_EVENT, notifyStorageWritten } from './erp-storage-contracts.js';
import { PLACEHOLDER_TAX_ID, COMPANY_BRANCHES, FIELD_LIMITS, CUSTOM_LOGO_CSS, DEFAULT_COMPANY_LOGO_URL, validateCompanyProfile, companyProfileFormValues, readCompanyProfileStorage, writeCompanyProfileStorage, applyCompanyProfileToUser, baseCompanyProfile, companyLogoUrl, markCustomLogo, companyHeaderPreviewHtml, companyProfileBackupPayload, companyProfileBackupWrites, checkLogoFile, sniffImageType, imageSizeFromBytes, checkLogoDimensions, encodeLogoImage, isQuotaError } from './erp-company-profile-core.js';
import { DEFAULT_BRANCH_COUNT, branchSettingRecord, readBranchSetting, liveBranchCensus, liveBranchState, liveBranchLabel, invalidateBranchState, singleBranchRefusal } from './erp-branches-core.js';

const KEYS = Object.freeze({ profile: COMPANY_PROFILE_KEY, logo: COMPANY_LOGO_KEY, branchSetting: COMPANY_BRANCH_SETTING_KEY });
const keyFor = key => window.ComformTenant?.storageKey?.(key) || key;
const PANEL_ID = 'saas-admin';
const QUOTA_MESSAGE = 'พื้นที่จัดเก็บของเบราว์เซอร์เต็ม จึงบันทึกไม่สำเร็จ — ข้อมูลเดิมยังอยู่ครบ ไม่มีอะไรถูกบันทึกครึ่ง ๆ กลาง ๆ ลองใช้โลโก้ที่เล็ก/เรียบกว่านี้ หรือสำรองข้อมูลแล้วล้างข้อมูลเก่าที่ไม่ใช้';

const say = (message, type = 'info') => { if (typeof window.notify === 'function') window.notify(message, type); else console.info('[CompanyProfile]', message); };
// { profile, logo, raw, errors } + branch: { count, record, raw, error } (ADR-022)
const readSaved = () => ({ ...readCompanyProfileStorage(localStorage, keyFor, KEYS), branch: readBranchSetting(localStorage, keyFor) });

// ---------------------------------------------------------------- apply + change signal
let applied = { profile: null, logo: null, raw: { profile: null, logo: null }, errors: [], branch: { count: DEFAULT_BRANCH_COUNT, record: null, raw: null, error: '' } };

// Re-reads both keys; when they differ from what is applied, merges them into CurrentUser and tells
// the screens. Cheap when nothing changed (two getItem + string compare), so it can follow every
// STORAGE_WRITTEN_EVENT.
function syncFromStorage({ force = false } = {}) {
  let saved;
  try { saved = readSaved(); } catch (error) { console.warn('[CompanyProfile] storage read failed', error); return false; }
  if (!force && saved.raw.profile === applied.raw.profile && saved.raw.logo === applied.raw.logo && saved.branch.raw === applied.branch.raw) return false;
  if (saved.errors.length) console.warn('[CompanyProfile] saved company profile ignored:', saved.errors.join(' · '));
  if (saved.branch.error) console.warn('[CompanyProfile] saved branch setting ignored (2 branches shown):', saved.branch.error);
  applied = saved;
  applyCompanyProfileToUser(window.CurrentUser, saved);
  window.dispatchEvent(new CustomEvent(COMPANY_PROFILE_CHANGED_EVENT, { detail: { custom: !!saved.profile, customLogo: !!saved.logo, branchCount: saved.branch.count } }));
  return true;
}

// The app.js document-entry toolbars (ใบเสนอราคา / ใบกำกับภาษี / ใบเสร็จ forms) and their live
// previews; the document modules re-render themselves on the same event.
function refreshEntryToolbars() {
  const logo = companyLogoUrl();
  const name = window.CurrentUser?.tenantName || window.CurrentUser?.companyName || 'บริษัท';
  document.querySelectorAll('.doc-entry-toolbar').forEach(toolbar => {
    toolbar.querySelector('.doc-entry-brand img')?.setAttribute('src', logo);
    const small = toolbar.querySelector('.doc-entry-brand small');
    if (small) small.textContent = name;
    // The form panel re-renders its preview on any `change` (app.js setupDocumentEntryWorkspace).
    toolbar.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

// ---------------------------------------------------------------- form markup
function fieldHtml({ field, label, required = false, hint = '', textarea = false, readonly = false, span = false, type = 'text', placeholder = '', inputmode = '', maxlength = 0, autocomplete = 'off' }) {
  const id = `cp-${field.replace(/\./g, '-')}`;
  const describedBy = [hint ? `${id}-hint` : '', `${id}-error`].filter(Boolean).join(' ');
  const attrs = [
    `id="${id}"`, `data-cp-field="${field}"`, `aria-describedby="${describedBy}"`, `autocomplete="${autocomplete}"`,
    placeholder ? `placeholder="${escapeHtml(placeholder)}"` : '', inputmode ? `inputmode="${inputmode}"` : '',
    maxlength ? `maxlength="${maxlength}"` : '', readonly ? 'readonly' : '', required ? 'aria-required="true"' : ''
  ].filter(Boolean).join(' ');
  const control = textarea ? `<textarea ${attrs} rows="2"></textarea>` : `<input type="${type}" ${attrs}>`;
  return `<div class="ff cp-field${span ? ' cp-span-2' : ''}">
    <label for="${id}">${escapeHtml(label)}${required ? ' <span class="cp-required" aria-hidden="true">*</span>' : ''}</label>
    ${control}
    ${hint ? `<small class="cp-hint" id="${id}-hint">${escapeHtml(hint)}</small>` : ''}
    <div class="cp-field-error" id="${id}-error" hidden></div>
  </div>`;
}

function formHtml() {
  const [head, second] = COMPANY_BRANCHES;
  return `
  <div class="cp-head">
    <h2 class="card-title" id="cp-title">${icon('company')}ข้อมูลบริษัทและโลโก้</h2>
    <span class="cp-badge" id="cp-badge"></span>
  </div>
  <p class="cp-intro">ใส่ชื่อ ที่อยู่ เลขประจำตัวผู้เสียภาษี และโลโก้ของบริษัทคุณ — ใช้บนหัวโปรแกรมและเอกสารที่พิมพ์ทุกชนิด (ใบเสนอราคา · ใบส่งสินค้า/ใบกำกับภาษี · ใบกำกับภาษีอย่างย่อ · ใบเสร็จ · ใบลดหนี้) เก็บไว้ใน Browser เครื่องนี้ และอยู่ในไฟล์สำรองข้อมูล</p>
  <form id="company-profile-form" class="cp-layout" novalidate>
    <div class="cp-fields">
      <fieldset class="cp-section">
        <legend>โลโก้บริษัท</legend>
        <div class="cp-logo-row">
          <div class="cp-logo-frame"><img id="cp-logo-preview" src="${escapeHtml(DEFAULT_COMPANY_LOGO_URL)}" alt="โลโก้ที่จะใช้บนเอกสาร"></div>
          <div class="cp-logo-actions">
            <div class="cp-logo-buttons">
              <input type="file" id="cp-logo-file" class="cp-file-input" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" aria-describedby="cp-logo-hint cp-logo-error">
              <label class="btn btn-secondary btn-sm cp-file-label" for="cp-logo-file">${icon('upload')}อัปโหลดโลโก้</label>
              <button type="button" class="btn btn-tertiary btn-sm" data-cp-action="default-logo">${icon('reset')}ใช้โลโก้เดิม</button>
            </div>
            <small class="cp-hint" id="cp-logo-hint">PNG, JPG หรือ WebP ไม่เกิน 5 MB · ระบบย่อให้ด้านยาวไม่เกิน 600 px และเก็บพื้นหลังโปร่งใสไว้ · ไม่รับ SVG</small>
            <div class="cp-logo-status" id="cp-logo-status" aria-live="polite"></div>
            <div class="cp-field-error" id="cp-logo-error" role="alert" hidden></div>
          </div>
        </div>
      </fieldset>
      <fieldset class="cp-section">
        <legend>ข้อมูลบริษัท (สำนักงานใหญ่)</legend>
        <div class="cp-grid">
          ${fieldHtml({ field: 'nameTh', label: 'ชื่อบริษัท (ภาษาไทย)', required: true, span: true, placeholder: 'เช่น บริษัท สยามตัวอย่าง จำกัด', maxlength: FIELD_LIMITS.nameTh, autocomplete: 'organization' })}
          ${fieldHtml({ field: 'nameEn', label: 'ชื่อบริษัท (ภาษาอังกฤษ)', span: true, placeholder: 'เช่น SIAM TUAYANG CO., LTD. (ไม่บังคับ)', maxlength: FIELD_LIMITS.nameEn })}
          ${fieldHtml({ field: 'taxId', label: 'เลขประจำตัวผู้เสียภาษี (13 หลัก)', required: true, hint: 'ระบบตรวจเลขหลักสุดท้ายให้ · ใส่ขีดได้', inputmode: 'numeric', maxlength: 20 })}
          ${fieldHtml({ field: 'phone', label: 'โทรศัพท์', type: 'tel', placeholder: 'เช่น 02-123-4567', maxlength: FIELD_LIMITS.phone, autocomplete: 'tel' })}
          ${fieldHtml({ field: 'email', label: 'อีเมล', type: 'email', placeholder: 'เช่น info@example.co.th (ไม่บังคับ)', inputmode: 'email', maxlength: FIELD_LIMITS.email, autocomplete: 'email' })}
          ${fieldHtml({ field: 'website', label: 'เว็บไซต์', placeholder: 'เช่น www.example.co.th (ไม่บังคับ)', inputmode: 'url', maxlength: FIELD_LIMITS.website, autocomplete: 'url' })}
          ${fieldHtml({ field: 'addressTh', label: 'ที่อยู่สำนักงานใหญ่ (ภาษาไทย)', required: true, span: true, textarea: true, placeholder: 'เลขที่ ถนน ตำบล/แขวง อำเภอ/เขต จังหวัด รหัสไปรษณีย์', maxlength: FIELD_LIMITS.addressTh, autocomplete: 'street-address' })}
        </div>
      </fieldset>
      <fieldset class="cp-section cp-branch-count" id="cp-branch-count" aria-describedby="cp-branch-count-hint cp-branch-count-error">
        <legend>จำนวนสถานประกอบการ</legend>
        <div class="cp-radio-row">
          <label class="cp-radio"><input type="radio" name="cp-branch-count" value="1"> สำนักงานใหญ่อย่างเดียว</label>
          <label class="cp-radio"><input type="radio" name="cp-branch-count" value="2"> สำนักงานใหญ่ + 1 สาขา</label>
        </div>
        <small class="cp-hint" id="cp-branch-count-hint">บริษัทที่มีที่เดียวเลือก "สำนักงานใหญ่อย่างเดียว" — ฟอร์ม ตัวกรอง แดชบอร์ด และรายงานจะไม่มีสาขาที่ 2 · เปลี่ยนเป็นที่เดียวได้เมื่อสาขาที่ 2 ยังไม่มีข้อมูล · ควรเลือกก่อนโหลดข้อมูลตัวอย่าง</small>
        <div class="cp-field-error" id="cp-branch-count-error" role="alert" hidden></div>
        <div class="ff cp-field cp-vat-filing">
          <label for="cp-vatFilingMode">การยื่น ภ.พ.30 (เมื่อมีมากกว่า 1 สถานประกอบการ)</label>
          <select id="cp-vatFilingMode" data-cp-field="vatFilingMode" aria-describedby="cp-vatFilingMode-hint cp-vatFilingMode-error"><option value="separate">แยกยื่นเป็นรายสถานประกอบการ (ปกติ)</option><option value="combined">ยื่นรวมกัน (ได้รับอนุมัติจากกรมสรรพากรแล้ว)</option></select>
          <small class="cp-hint" id="cp-vatFilingMode-hint">ใช้ในหน้า รายงานภาษี › ภ.พ.30 · บริษัทที่มีที่เดียวไม่ต้องเปลี่ยน</small>
          <div class="cp-field-error" id="cp-vatFilingMode-error" hidden></div>
        </div>
      </fieldset>
      <fieldset class="cp-section">
        <legend>สาขาที่พิมพ์บนเอกสาร</legend>
        <p class="cp-hint cp-branch-note">ใบกำกับภาษีต้องระบุ "สำนักงานใหญ่" หรือ "สาขาที่ xxxxx" — ระบบพิมพ์ให้ตามรหัสสาขา</p>
        <div class="cp-branches">
          <div class="cp-branch" data-cp-branch="${head.id}">
            <h3>สำนักงานใหญ่ <small>(เมนูและตัวกรองใช้ชื่อเรียกนี้)</small></h3>
            ${fieldHtml({ field: `branches.${head.id}.code`, label: 'รหัสสาขา', readonly: true, hint: 'สำนักงานใหญ่ใช้ 00000 เสมอ · ที่อยู่ = ที่อยู่สำนักงานใหญ่ด้านบน' })}
            ${fieldHtml({ field: `branches.${head.id}.label`, label: 'ชื่อเรียกสาขา (ไม่บังคับ)', placeholder: 'เช่น สำนักงานใหญ่ อุบลราชธานี', maxlength: FIELD_LIMITS.branchLabel })}
          </div>
          <div class="cp-branch" data-cp-branch="${second.id}">
            <h3>สาขาที่ 2 <small>(เมนูและตัวกรองแสดง "สาขาที่ รหัส · ชื่อเรียก")</small></h3>
            ${fieldHtml({ field: `branches.${second.id}.code`, label: 'รหัสสาขา (5 หลัก)', required: true, inputmode: 'numeric', maxlength: 5, hint: 'ตามที่จดทะเบียนกับกรมสรรพากร เช่น 00001' })}
            ${fieldHtml({ field: `branches.${second.id}.label`, label: 'ชื่อเรียกสาขา (ไม่บังคับ)', placeholder: 'เช่น สาขาขอนแก่น', maxlength: FIELD_LIMITS.branchLabel })}
            ${fieldHtml({ field: `branches.${second.id}.addressTh`, label: 'ที่อยู่สาขา', textarea: true, placeholder: 'เว้นว่าง = ใช้ที่อยู่สำนักงานใหญ่', maxlength: FIELD_LIMITS.addressTh })}
          </div>
        </div>
      </fieldset>
    </div>
    <aside class="cp-preview" aria-labelledby="cp-preview-title">
      <div class="cp-preview-title" id="cp-preview-title">${icon('preview')}ตัวอย่างหัวเอกสาร<small>เปลี่ยนตามที่พิมพ์ทันที · ใช้จริงเมื่อกด "บันทึก"</small></div>
      <div class="cp-preview-paper" id="cp-preview"></div>
    </aside>
    <div class="cp-actions">
      <button type="submit" class="btn btn-primary" data-cp-action="save">${icon('save')}บันทึก</button>
      <button type="button" class="btn btn-secondary" data-cp-action="revert">${icon('cancel')}ยกเลิก/คืนค่า</button>
      <span class="cp-save-state" id="cp-save-state" aria-live="polite"></span>
      <button type="button" class="btn btn-danger btn-sm cp-reset-all" data-cp-action="reset-all" hidden>${icon('trash')}กลับไปใช้ข้อมูลตัวอย่าง</button>
    </div>
  </form>`;
}

// ---------------------------------------------------------------- form state
const ui = {
  root: null,
  form: null,
  baseline: '',          // JSON of the form values as last filled from storage
  draftLogo: undefined,  // undefined = unchanged · null = back to the default logo · record = new logo
  logoBusy: false,
  touched: new Set(),
  submitted: false
};

const fieldEls = () => [...(ui.form?.querySelectorAll('[data-cp-field]') || [])];

function readForm() {
  const values = { branches: {} };
  for (const el of fieldEls()) {
    const path = el.dataset.cpField.split('.');
    if (path[0] === 'branches') (values.branches[path[1]] ||= {})[path[2]] = el.value;
    else values[path[0]] = el.value;
  }
  return values;
}

function fillForm(values) {
  for (const el of fieldEls()) {
    const path = el.dataset.cpField.split('.');
    el.value = path[0] === 'branches' ? (values.branches?.[path[1]]?.[path[2]] ?? '') : (values[path[0]] ?? '');
  }
}

const savedTaxId = () => applied.profile?.taxId ?? baseCompanyProfile(window.CurrentUser).taxId ?? PLACEHOLDER_TAX_ID;
const validate = () => validateCompanyProfile(readForm(), { allowPlaceholderTaxId: savedTaxId() === PLACEHOLDER_TAX_ID });
// ADR-022: the chosen number of establishments (radio) — the saved one until the user picks.
const savedBranchCount = () => applied.branch?.count ?? DEFAULT_BRANCH_COUNT;
const draftBranchCount = () => Number(ui.form?.querySelector('input[name="cp-branch-count"]:checked')?.value) || savedBranchCount();
const isDirty = () => !!ui.form && (ui.draftLogo !== undefined || JSON.stringify(readForm()) !== ui.baseline || draftBranchCount() !== savedBranchCount());

function setBranchCountError(message = '') {
  const box = document.getElementById('cp-branch-count-error');
  if (box) { box.textContent = message; box.hidden = !message; }
}
// Single = the second branch's card (code / name / address) is not shown — unless it holds an input
// error, which must stay visible so it can be fixed.
function syncBranchCards(errors = {}) {
  const single = draftBranchCount() === 1;
  const second = ui.form?.querySelector(`[data-cp-branch="${COMPANY_BRANCHES[1].id}"]`);
  const hasError = Object.keys(errors).some(field => field.startsWith(`branches.${COMPANY_BRANCHES[1].id}.`));
  if (second) second.toggleAttribute('data-erp-branch-hidden', single && !hasError);
  ui.form?.querySelector('.cp-branches')?.classList.toggle('is-single', single && !hasError);
}

function draftLogoUrl() {
  if (ui.draftLogo === null) return DEFAULT_COMPANY_LOGO_URL;
  const record = ui.draftLogo || applied.logo;
  return record ? markCustomLogo(record.dataUrl) : DEFAULT_COMPANY_LOGO_URL;
}

function showErrors(errors) {
  for (const el of fieldEls()) {
    const field = el.dataset.cpField;
    const message = (ui.submitted || ui.touched.has(field)) ? errors[field] || '' : '';
    const box = document.getElementById(`${el.id}-error`);
    if (box) { box.textContent = message; box.hidden = !message; }
    if (message) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
  }
  syncBranchCards(ui.submitted ? errors : {});
}

function setSaveState(message = '', kind = '') {
  const box = document.getElementById('cp-save-state');
  if (!box) return;
  box.textContent = message;
  box.className = `cp-save-state${kind ? ` is-${kind}` : ''}`;
}

function setLogoMessage({ status = '', error = '' } = {}) {
  const statusEl = document.getElementById('cp-logo-status');
  const errorEl = document.getElementById('cp-logo-error');
  if (statusEl) statusEl.textContent = status;
  if (errorEl) { errorEl.textContent = error; errorEl.hidden = !error; }
}

let previewTimer = 0;
function renderPreview() {
  clearTimeout(previewTimer);
  previewTimer = 0;
  const box = document.getElementById('cp-preview');
  const logo = draftLogoUrl();
  if (box) box.innerHTML = companyHeaderPreviewHtml(validate().profile, logo, { branchCount: draftBranchCount() });
  document.getElementById('cp-logo-preview')?.setAttribute('src', logo);
}
const schedulePreview = () => { clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, 80); };

function renderStatus() {
  const badge = document.getElementById('cp-badge');
  const custom = !!(applied.profile || applied.logo);
  if (badge) {
    badge.textContent = custom ? 'ใช้ข้อมูลบริษัทของคุณ' : 'ยังเป็นข้อมูลตัวอย่าง';
    badge.classList.toggle('is-custom', custom);
  }
  const resetAll = ui.form?.querySelector('[data-cp-action="reset-all"]');
  if (resetAll) resetAll.hidden = !custom;
  if (isDirty()) setSaveState('มีการแก้ไขที่ยังไม่บันทึก', 'dirty');
  else if (!document.getElementById('cp-save-state')?.classList.contains('is-error')) setSaveState('');
}

// Back to what is saved (or to the demo profile when nothing is saved).
function fillFromSaved() {
  if (!ui.form) return;
  fillForm(companyProfileFormValues(applied.profile, baseCompanyProfile(window.CurrentUser)));
  ui.form.querySelectorAll('input[name="cp-branch-count"]').forEach(radio => { radio.checked = Number(radio.value) === savedBranchCount(); });
  setBranchCountError();
  ui.baseline = JSON.stringify(readForm());
  ui.draftLogo = undefined;
  ui.touched.clear();
  ui.submitted = false;
  showErrors({});
  setLogoMessage();
  setSaveState('');
  renderPreview();
  renderStatus();
}

// ---------------------------------------------------------------- logo upload
async function decodeImage(blob) {
  if (typeof window.createImageBitmap === 'function') {
    try { return await window.createImageBitmap(blob); }
    catch (error) { console.warn('[CompanyProfile] createImageBitmap failed, trying <img>', error); }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } catch (error) {
    throw new Error('เบราว์เซอร์อ่านรูปนี้ไม่ได้ ไฟล์อาจเสีย — กรุณาลองไฟล์อื่น');
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Blob.arrayBuffer() is missing in older Safari (< 14); FileReader works everywhere.
function readBytes(file) {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('อ่านไฟล์ไม่ได้'));
    reader.readAsArrayBuffer(file);
  });
}

// File → logo record ({ dataUrl, width, height, … }). The uploaded bytes are only decoded as the
// type found in their first bytes and redrawn on our own canvas; the file itself is never stored.
async function prepareLogo(file) {
  const problem = checkLogoFile(file);
  if (problem) throw new Error(problem);
  const bytes = new Uint8Array(await readBytes(file));
  const type = sniffImageType(bytes);
  if (!type) throw new Error('ไฟล์นี้ไม่ใช่รูป PNG, JPG หรือ WebP (อาจเปลี่ยนนามสกุลไฟล์มา) — กรุณาเลือกไฟล์รูปจริง');
  const sizeProblem = checkLogoDimensions(imageSizeFromBytes(bytes, type));
  if (sizeProblem) throw new Error(sizeProblem);
  const image = await decodeImage(new Blob([bytes], { type }));
  try {
    const size = { width: image.width || image.naturalWidth || 0, height: image.height || image.naturalHeight || 0 };
    if (!size.width || !size.height) throw new Error('อ่านขนาดรูปไม่ได้ — กรุณาลองไฟล์อื่น');
    return encodeLogoImage(image, size, (width, height) => Object.assign(document.createElement('canvas'), { width, height }));
  } finally {
    image.close?.();
  }
}

async function onLogoFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  ui.logoBusy = true;
  setLogoMessage({ status: 'กำลังเตรียมโลโก้…' });
  try {
    const record = await prepareLogo(file);
    ui.draftLogo = record;
    const kb = Math.max(1, Math.round((record.dataUrl.length - record.dataUrl.indexOf(',') - 1) * 0.75 / 1024));
    setLogoMessage({ status: `พร้อมใช้: ${record.width}×${record.height} px · ${kb} KB (${record.mime === 'image/png' ? 'PNG' : 'JPEG'}) — กด "บันทึก" เพื่อใช้งาน` });
  } catch (error) {
    setLogoMessage({ error: error?.message || 'อ่านรูปไม่ได้ — กรุณาลองไฟล์อื่น' });
  } finally {
    ui.logoBusy = false;
    input.value = '';
    renderPreview();
    renderStatus();
  }
}

// ---------------------------------------------------------------- save / revert / reset
function audit(detail) {
  try { window.ERPProductionCore?.audit?.('update', 'company_profile', COMPANY_PROFILE_KEY, detail, {}); }
  catch (error) { console.warn('[CompanyProfile] audit log write failed (profile already saved)', error); }
}

function writeRecord(record) {
  writeCompanyProfileStorage(localStorage, keyFor, KEYS, record);
  syncFromStorage();
  notifyStorageWritten();
}

// Money rule (ADR-022): "สำนักงานใหญ่อย่างเดียว" is refused while branch 2 holds anything (documents,
// order flow, stock) — the census is read fresh from storage, nothing is saved, the reason is named.
function branchCountRefusal(count) {
  if (count !== 1 || savedBranchCount() === 1) return '';
  invalidateBranchState(window);
  return singleBranchRefusal(liveBranchCensus(window, { fresh: true }), liveBranchLabel(COMPANY_BRANCHES[1].id, undefined, window));
}

function save() {
  if (!ui.form) return false;
  if (ui.logoBusy) { say('กำลังเตรียมโลโก้ กรุณารอสักครู่แล้วกดบันทึกอีกครั้ง', 'info'); return false; }
  ui.submitted = true;
  const branchCount = draftBranchCount();
  const refusal = branchCountRefusal(branchCount);
  setBranchCountError(refusal);
  if (refusal) {
    ui.form.querySelector('input[name="cp-branch-count"][value="1"]')?.focus();
    setSaveState('ยังบันทึกไม่ได้ — สาขาที่ 2 ยังมีข้อมูล (ดูรายละเอียดใต้ "จำนวนสถานประกอบการ")', 'error');
    say(refusal, 'error');
    return false;
  }
  const result = validate();
  showErrors(result.errors);
  if (!result.ok) {
    const first = fieldEls().find(el => result.errors[el.dataset.cpField]);
    first?.focus();
    setSaveState('ยังบันทึกไม่ได้ — กรุณาแก้ช่องที่มีข้อความสีแดง', 'error');
    say('ยังบันทึกไม่ได้ — กรุณาแก้ช่องที่มีข้อความสีแดง', 'error');
    return false;
  }
  const now = new Date().toISOString();
  const logoChanged = ui.draftLogo !== undefined;
  const logo = logoChanged ? ui.draftLogo : applied.logo;
  const countChanged = branchCount !== savedBranchCount();
  // Only the number of establishments changed on a store still showing the sample company: the
  // company profile stays "ข้อมูลตัวอย่าง" (printed documents unchanged); otherwise as before.
  const profileWrite = !!applied.profile || logoChanged || !countChanged || JSON.stringify(readForm()) !== ui.baseline;
  const record = { branchSetting: countChanged ? branchSettingRecord(branchCount, new Date(now)) : undefined };
  if (profileWrite) Object.assign(record, { profile: { ...result.profile, updatedAt: now }, logo: logo ? { ...logo, updatedAt: logoChanged ? now : (logo.updatedAt || now) } : null });
  try {
    writeRecord(record);
  } catch (error) {
    const message = isQuotaError(error) ? QUOTA_MESSAGE : `บันทึกไม่สำเร็จ: ${error?.message || error} — ข้อมูลเดิมยังอยู่ครบ`;
    console.error('[CompanyProfile] save failed', error);
    setSaveState(message, 'error');
    say(message, 'error');
    return false;
  }
  const countText = branchCount === 1 ? 'สำนักงานใหญ่อย่างเดียว' : 'สำนักงานใหญ่ + 1 สาขา';
  audit(profileWrite
    ? `บันทึกข้อมูลบริษัท: ${result.profile.nameTh} · เลขประจำตัวผู้เสียภาษี ${result.profile.taxId}${logoChanged ? (logo ? ' · เปลี่ยนโลโก้' : ' · กลับไปใช้โลโก้เดิม') : ''}${countChanged ? ` · จำนวนสถานประกอบการ: ${countText}` : ''}`
    : `เปลี่ยนจำนวนสถานประกอบการ: ${countText}`);
  fillFromSaved();
  setSaveState('บันทึกแล้ว', 'saved');
  say(countChanged
    ? `บันทึกแล้ว — ใช้แบบ "${countText}" ทุกหน้าจอทันที`
    : 'บันทึกข้อมูลบริษัทและโลโก้แล้ว — หัวโปรแกรมและเอกสารทุกชนิดใช้ข้อมูลใหม่ทันที', 'success');
  return true;
}

function revert() {
  fillFromSaved();
  say('คืนค่าเป็นข้อมูลที่บันทึกไว้แล้ว', 'info');
}

function resetAll() {
  const message = 'กลับไปใช้ข้อมูลบริษัทและโลโก้ตัวอย่าง?\n\nชื่อ ที่อยู่ เลขประจำตัวผู้เสียภาษี รหัสสาขา และโลโก้ที่บันทึกไว้จะถูกลบ เอกสารจะกลับไปแสดงข้อมูลตัวอย่าง\nเอกสาร ลูกค้า สินค้า และข้อมูลอื่นไม่ถูกแตะ';
  if (!window.confirm(message)) return false;
  try {
    writeRecord({ profile: null, logo: null });
  } catch (error) {
    say(`ล้างข้อมูลบริษัทไม่สำเร็จ: ${error?.message || error}`, 'error');
    return false;
  }
  audit('ล้างข้อมูลบริษัท/โลโก้ กลับไปใช้ข้อมูลตัวอย่าง');
  fillFromSaved();
  say('กลับไปใช้ข้อมูลบริษัทและโลโก้ตัวอย่างแล้ว', 'success');
  return true;
}

// ---------------------------------------------------------------- mount + events
function mount() {
  const panel = document.getElementById(`panel-${PANEL_ID}`);
  if (!panel || document.getElementById('company-profile-card')) return;
  const card = document.createElement('section');
  card.className = 'card cp-card';
  card.id = 'company-profile-card';
  card.setAttribute('aria-labelledby', 'cp-title');
  card.innerHTML = formHtml();
  panel.prepend(card);
  ui.root = card;
  ui.form = card.querySelector('#company-profile-form');
  ui.form.addEventListener('submit', event => { event.preventDefault(); save(); });
  ui.form.addEventListener('input', event => {
    if (event.target?.dataset?.cpField && ui.submitted) showErrors(validate().errors);
    if (event.target?.dataset?.cpField) { schedulePreview(); renderStatus(); }
  });
  ui.form.addEventListener('focusout', event => {
    const field = event.target?.dataset?.cpField;
    if (!field || event.target.readOnly) return;
    ui.touched.add(field);
    showErrors(validate().errors);
  });
  ui.form.addEventListener('change', event => {
    if (event.target?.id === 'cp-logo-file') onLogoFile(event.target);
    if (event.target?.name === 'cp-branch-count') { setBranchCountError(); syncBranchCards(); renderPreview(); renderStatus(); }
  });
  ui.form.addEventListener('click', event => {
    const action = event.target.closest?.('[data-cp-action]')?.dataset.cpAction;
    if (action === 'revert') revert();
    else if (action === 'reset-all') resetAll();
    else if (action === 'default-logo') {
      const hadNewLogo = !!ui.draftLogo;
      ui.draftLogo = applied.logo ? null : undefined;
      setLogoMessage({ status: applied.logo ? 'จะกลับไปใช้โลโก้เดิมเมื่อกด "บันทึก"' : hadNewLogo ? 'ยกเลิกโลโก้ที่เลือกแล้ว — ใช้โลโก้เดิม' : 'ใช้โลโก้เดิมอยู่แล้ว' });
      renderPreview();
      renderStatus();
    }
  });
  fillFromSaved();
}

// Leaving the page with unsaved edits: one question, no silent loss (the edits stay in the form
// either way until "ยกเลิก/คืนค่า"; this makes sure nobody walks away believing they were saved).
// Asked after the other modules finished their own navigation work (some react 30 ms later).
let guardPending = false;
document.addEventListener('erp:navigation', event => {
  if (guardPending || event.detail?.id === PANEL_ID || !isDirty()) return;
  guardPending = true;
  setTimeout(() => {
    guardPending = false;
    if (!isDirty() || document.getElementById(`panel-${PANEL_ID}`)?.classList.contains('active')) return;
    if (window.confirm('ข้อมูลบริษัท/โลโก้ที่แก้ไขยังไม่ได้บันทึก\n\nกด "ตกลง" เพื่อกลับไปบันทึก · กด "ยกเลิก" เพื่อทิ้งการแก้ไข')) window.go?.(PANEL_ID, null);
    else fillFromSaved();
  }, 60);
});
window.addEventListener('beforeunload', event => {
  if (!isDirty()) return;
  event.preventDefault();
  event.returnValue = '';
});

// Writes from elsewhere: JSON backup import / rollback (ERPIntegrity.transaction, ERPBackup.restore)
// and other tabs. The form follows unless the user is in the middle of editing it.
function followExternalWrite() {
  const dirty = isDirty(); // before `applied` changes: the saved branch count is part of the comparison
  if (!syncFromStorage()) return;
  if (!dirty) fillFromSaved(); else renderStatus();
}
window.addEventListener(STORAGE_WRITTEN_EVENT, followExternalWrite);
window.addEventListener('storage', event => {
  if (event.key === null || event.key === keyFor(KEYS.profile) || event.key === keyFor(KEYS.logo) || event.key === keyFor(KEYS.branchSetting)) followExternalWrite();
});
window.addEventListener(COMPANY_PROFILE_CHANGED_EVENT, refreshEntryToolbars);

// ---------------------------------------------------------------- branch screens (ADR-022)
// The static screens of index.html (and the governance lock form) carry the two branch ids. Here they
// get the current labels (company profile; the original text while none is saved — so a default store
// looks exactly as before) and, while the UI is single-branch, everything branch-2 is hidden and the
// branch choices fall back to the head office. Only the SCREEN changes: totals keep reading both ids
// (app.js tenantActiveBranchIds), and branch-2 data switches the screens back to 2 branches + a banner.
const BRANCH_RADIO_FORMS = Object.freeze(['q', 'i', 'r', 'e', 'p', 'cn']);
// '' / 'all' option = every branch.
const BRANCH_FILTER_SELECTS = Object.freeze(['analytics-branch', 'pl-br', 'ql-br', 'il-br', 'rl-br', 'cnl-br', 'oil-br', 'orl-br', 'el-br', 'ex-branch', 'inv-branch-filter', 'gov-lock-branch']);
const BRANCH_CHOICE_SELECTS = Object.freeze(['po-branch', 'gr-branch', 'adj-branch', 'transfer-from', 'transfer-to']);
const HIDDEN_ATTR = 'data-erp-branch-hidden';
const BANNER_ID = 'erp-branch-warning';

const setHidden = (el, hidden) => { if (el) el.toggleAttribute(HIDDEN_ATTR, !!hidden); };
// The visible text of a control = its last non-empty text node (radios / tabs keep their dot icon).
function setLabelText(el, branchId) {
  if (!el) return;
  const nodes = [...el.childNodes].filter(node => node.nodeType === 3 && node.textContent.trim());
  const node = nodes[nodes.length - 1];
  if (!node) return;
  if (el.dataset.erpBranchDefault === undefined) el.dataset.erpBranchDefault = node.textContent.trim();
  const next = liveBranchLabel(branchId, el.dataset.erpBranchDefault, window);
  if (node.textContent.trim() !== next) node.textContent = next;
}
function setOptionTexts(select) {
  for (const option of select.options) {
    if (option.value !== 'ubon' && option.value !== 'khonkaen') continue;
    if (option.dataset.erpBranchDefault === undefined) option.dataset.erpBranchDefault = option.textContent;
    const next = liveBranchLabel(option.value, option.dataset.erpBranchDefault, window);
    if (option.textContent !== next) option.textContent = next;
  }
}
function applyToSelect(id, single, { filter }) {
  const select = document.getElementById(id);
  if (!select) return;
  setOptionTexts(select);
  const second = [...select.options].find(option => option.value === 'khonkaen');
  if (second) { second.hidden = single; second.disabled = single; }
  setHidden(select.closest('label') || select.parentElement, single);
  if (single && select.value === 'khonkaen') {
    const values = [...select.options].map(option => option.value);
    select.value = filter ? (values.includes('') ? '' : 'all') : 'ubon';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function renderBranchBanner(state) {
  let banner = document.getElementById(BANNER_ID);
  if (!state.warning) { banner?.remove(); return; }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.className = 'erp-branch-warning';
    banner.setAttribute('role', 'alert');
    banner.innerHTML = `<span class="erp-branch-warning-text"></span><button type="button" class="btn btn-secondary btn-sm">${icon('company')}ตั้งค่าบริษัท</button>`;
    banner.querySelector('button').addEventListener('click', openCompanySettings);
    const main = document.querySelector('.main');
    if (main) main.prepend(banner); else document.body.prepend(banner);
  }
  const text = banner.querySelector('.erp-branch-warning-text');
  if (text.textContent !== state.warning) text.textContent = state.warning;
}

function applyBranchScreens() {
  invalidateBranchState(window);
  let state;
  try { state = liveBranchState(window); } catch (error) { console.warn('[CompanyProfile] branch state unreadable, showing 2 branches', error); state = { multi: true, warning: '' }; }
  const single = !state.multi;
  document.documentElement.toggleAttribute('data-erp-single-branch', single);
  // Forms: labels, hidden choice, head office selected.
  for (const form of BRANCH_RADIO_FORMS) {
    const ub = document.getElementById(`${form}-br-ub`), kk = document.getElementById(`${form}-br-kk`);
    setLabelText(ub, 'ubon');
    setLabelText(kk, 'khonkaen');
    setHidden(kk, single);
    setHidden(ub?.closest('.ff-full') || ub?.parentElement?.parentElement, single);
    if (single && kk?.classList.contains('kk-sel') && form !== 'cn' && typeof window.selBr === 'function') window.selBr(form, 'ubon');
  }
  BRANCH_FILTER_SELECTS.forEach(id => applyToSelect(id, single, { filter: true }));
  BRANCH_CHOICE_SELECTS.forEach(id => applyToSelect(id, single, { filter: false }));
  setHidden(document.getElementById('transfer-from')?.closest('.card'), single);
  // Dashboard: branch tabs and the per-branch comparison.
  setLabelText(document.getElementById('dt-ub'), 'ubon');
  setLabelText(document.getElementById('dt-kk'), 'khonkaen');
  setHidden(document.querySelector('#panel-dashboard .dash-tabs'), single);
  document.querySelectorAll('#dash-combined .bc .bname').forEach(name => setLabelText(name, name.closest('.bc')?.classList.contains('kk') ? 'khonkaen' : 'ubon'));
  setHidden(document.querySelector('#dash-combined .compare-grid'), single);
  if (single && document.getElementById('dt-all') && !document.getElementById('dt-all').classList.contains('active') && typeof window.switchDashTab === 'function') window.switchDashTab('all');
  // ห่วงโซ่เอกสาร (linked flow) branch switch.
  document.querySelectorAll('.linked-branch-switch [data-linked-branch]').forEach(button => { if (button.dataset.linkedBranch) setLabelText(button, button.dataset.linkedBranch); });
  const linkedSwitch = document.querySelector('.linked-branch-switch');
  setHidden(linkedSwitch, single);
  const linkedAll = linkedSwitch?.querySelector('[data-linked-branch=""]');
  if (single && linkedAll && !linkedAll.classList.contains('active') && typeof window.setLinkedBranch === 'function') window.setLinkedBranch('', linkedAll);
  // Product master: branch-2 opening stock; analytics branch comparison; SaaS branch add-on (โหมดขั้นสูง).
  const openingKk = document.getElementById('md-p-opening-kk')?.closest('label');
  const openingSpan = openingKk?.querySelector('span');
  if (openingSpan) {
    if (openingSpan.dataset.erpBranchDefault === undefined) openingSpan.dataset.erpBranchDefault = openingSpan.textContent;
    const next = `ยอดตั้งต้น · ${liveBranchLabel('khonkaen', openingSpan.dataset.erpBranchDefault.replace(/^ยอดตั้งต้น · /, ''), window)}`;
    if (openingSpan.textContent !== next) openingSpan.textContent = next;
  }
  setHidden(openingKk, single);
  setHidden(document.getElementById('analytics-branch-table')?.closest('.card'), single);
  setHidden(document.getElementById('saas-branch-list')?.closest('.saas-box'), single);
  setHidden(document.getElementById('saas-new-branch-code')?.closest('.saas-box'), single);
  renderBranchBanner(state);
  return state;
}

// Re-applied after anything that can change the labels, the setting or what branch 2 holds; and on
// navigation (panels / the governance form are built lazily). Coalesced to one run per task.
let screensQueued = false;
function scheduleBranchScreens() {
  if (screensQueued) return;
  screensQueued = true;
  setTimeout(() => {
    screensQueued = false;
    const wasSingle = document.documentElement.hasAttribute('data-erp-single-branch');
    const state = applyBranchScreens();
    // The dashboard figures carry branch wording ("2 สาขา") — redraw them when the mode flipped (other
    // panels redraw on navigation).
    if (wasSingle !== !state.multi) window.renderDash?.();
  }, 40);
}
window.addEventListener(COMPANY_PROFILE_CHANGED_EVENT, scheduleBranchScreens);
window.addEventListener(STORAGE_WRITTEN_EVENT, scheduleBranchScreens);
window.addEventListener('erp-flow:changed', scheduleBranchScreens);
document.addEventListener('erp:navigation', scheduleBranchScreens);

// ---------------------------------------------------------------- shortcuts
// The page is in โหมดง่าย and โหมดขั้นสูง (ADR-020). Reached from the sidebar (ตั้งค่า › ตั้งค่าบริษัท), the
// header company name and the ⚙ Demo menu.
const SHORTCUT_TITLE = 'แก้ไขข้อมูลบริษัทและโลโก้';
function openCompanySettings() {
  if (typeof window.go !== 'function') return false;
  window.go(PANEL_ID, null);
  window.SaaSService?.renderPanel?.();
  const card = document.getElementById('company-profile-card');
  try { card?.scrollIntoView({ block: 'start' }); } catch (error) { console.warn('[CompanyProfile] scroll failed', error); }
  card?.querySelector('[data-cp-field="nameTh"]')?.focus({ preventScroll: true });
  return true;
}
function installShortcuts() {
  const name = document.querySelector('.comform-topbar .company-title-wrap');
  if (name && !name.classList.contains('cp-header-link')) {
    name.classList.add('cp-header-link');
    name.setAttribute('role', 'button');
    name.tabIndex = 0;
    name.title = SHORTCUT_TITLE;
    name.setAttribute('aria-label', `${SHORTCUT_TITLE} (ตั้งค่าบริษัท)`);
    name.addEventListener('click', openCompanySettings);
    name.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openCompanySettings(); } });
  }
  // ADR-015 registration API: one more item, between "ตรวจสถานะ Demo" (10) and "โหลดข้อมูลตัวอย่าง" (20).
  window.ERPDemoMenu?.register?.({ key: 'company-profile', id: 'local-demo-company-btn', order: 15, label: 'ข้อมูลบริษัทและโลโก้', title: SHORTCUT_TITLE, iconSvg: icon('company'), onSelect: openCompanySettings });
}

function injectCustomLogoCss() {
  if (document.getElementById('erp-custom-logo-css')) return;
  const style = document.createElement('style');
  style.id = 'erp-custom-logo-css';
  style.textContent = CUSTOM_LOGO_CSS;
  document.head.appendChild(style);
}

// local-demo-mode.js already merged the saved profile at boot; this records it as "applied"
// (re-applying is idempotent) so later writes are compared against it.
applied = readSaved();
if (applied.profile || applied.logo) applyCompanyProfileToUser(window.CurrentUser, applied);

window.ERPCompanyProfile = Object.freeze({
  // { profile, logo } as saved (null = demo default) + branchCount (ADR-022; 2 when never chosen)
  read: () => { const saved = readSaved(); return { profile: saved.profile, logo: saved.logo, branchCount: saved.branch.count }; },
  // masterData.companyProfile of a JSON backup (undefined when nothing is saved)
  exportBackup: () => { const saved = readSaved(); return companyProfileBackupPayload({ ...saved, branchSetting: saved.branch.record }); },
  // [key, value] writes for a backup restore (validated; [] for an old backup without it)
  backupWrites: (value, options = {}) => { const saved = readSaved(); return companyProfileBackupWrites(value, keyFor, KEYS, { ...saved, branchSetting: saved.branch.record }, options); },
  prepareLogo,
  save,
  open: openCompanySettings,
  refresh: () => syncFromStorage({ force: true })
});

function boot() {
  injectCustomLogoCss();
  mount();
  installShortcuts();
  applyBranchScreens();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
