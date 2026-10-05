// ADR-020 — customer company profile + logo: the pure rules of erp-company-profile-core.js
// (tax-ID check digit, branch codes, required fields, storage round-trip / atomic quota rollback,
// CurrentUser merge, document mapping, logo pipeline with a stub canvas, backup validation, escaping).
// The app-boot behaviour (documents, header, form, backup, reset, browser upload) is in
// tests/company-profile.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
let core, seed;
test.before(async () => {
  core = await import(pathToFileURL(path.join(ROOT, 'erp-company-profile-core.js')).href);
  seed = await import(pathToFileURL(path.join(ROOT, 'erp-demo-seed-core.js')).href);
});

const KEYS = { profile: 'comform_company_profile_v1', logo: 'comform_company_logo_v1' };
const keyFor = key => `erp_tenant::t1::${key}`;
const VALID = {
  nameTh: 'บริษัท สยามตัวอย่าง จำกัด', nameEn: 'SIAM TUAYANG CO., LTD.', taxId: '0105568123453',
  addressTh: '99/9 ถนนพระราม 9 แขวงห้วยขวาง เขตห้วยขวาง กรุงเทพมหานคร 10310', phone: '02-123-4567',
  email: 'info@siamtuayang.co.th', website: 'www.siamtuayang.co.th',
  branches: { ubon: { code: '00000', label: 'สำนักงานใหญ่' }, khonkaen: { code: '00002', label: 'สาขาขอนแก่น', addressTh: '12 ถนนมิตรภาพ ขอนแก่น 40000' } }
};
const b64 = (signature, length) => {
  let body = signature + 'A'.repeat(Math.max(0, length - signature.length));
  while (body.length % 4) body += 'A';
  return body;
};
const pngUrl = length => `data:image/png;base64,${b64('iVBORw0KGgo', length)}`;
const jpegUrl = length => `data:image/jpeg;base64,${b64('/9j/', length)}`;
const logoRecord = (over = {}) => ({ schemaVersion: 1, dataUrl: pngUrl(4000), width: 600, height: 300, updatedAt: '2026-10-03T10:00:00.000Z', ...over });

function memoryStorage(initial = {}, { failOn = null } = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem(key, value) {
      if (failOn && failOn(key, value)) { const error = new Error('quota'); error.name = 'QuotaExceededError'; error.code = 22; throw error; }
      map.set(key, String(value));
    },
    removeItem: key => { map.delete(key); }
  };
}

test('company#core1 Thai tax ID check digit: valid, invalid, wrong length, placeholder', () => {
  for (const id of ['0105568123453', '0105558012349', '1234567890121', '0999999999991']) assert.equal(core.isValidThaiTaxId(id), true, id);
  for (const id of ['0105568123454', '0105568123450', '010556812345', '01055681234530', 'ABCDEFGHIJKLM', '', null, '0000000000000']) assert.equal(core.isValidThaiTaxId(id), false, String(id));
  assert.equal(core.normalizeTaxIdInput(' 0-1055-68123-45-3 '), '0105568123453');
  const typed = core.validateCompanyProfile({ ...VALID, taxId: '0-1055-68123-45-3' });
  assert.equal(typed.ok, true, JSON.stringify(typed.errors));
  assert.equal(typed.profile.taxId, '0105568123453');
  assert.match(core.validateCompanyProfile({ ...VALID, taxId: '0105568123454' }).errors.taxId, /เลขตรวจสอบ/);
  assert.match(core.validateCompanyProfile({ ...VALID, taxId: '01055681234' }).errors.taxId, /13 หลัก/);
  // The demo placeholder is accepted only while it is still the saved value ("unchanged").
  assert.match(core.validateCompanyProfile({ ...VALID, taxId: core.PLACEHOLDER_TAX_ID }).errors.taxId, /0000000000000/);
  assert.equal(core.validateCompanyProfile({ ...VALID, taxId: core.PLACEHOLDER_TAX_ID }, { allowPlaceholderTaxId: true }).ok, true);
});

test('company#core2 branch codes: head office is always 00000, a branch is 5 digits and not 00000', () => {
  assert.equal(core.isValidBranchCode('00000', { headOffice: true }), true);
  assert.equal(core.isValidBranchCode('00001', { headOffice: true }), false);
  for (const code of ['00001', '00002', '12345']) assert.equal(core.isValidBranchCode(code), true, code);
  for (const code of ['00000', '0001', '000001', 'abcde', '', ' 0001']) assert.equal(core.isValidBranchCode(code), false, code);
  const bad = core.validateCompanyProfile({ ...VALID, branches: { ...VALID.branches, khonkaen: { code: '0001' } } });
  assert.equal(bad.ok, false);
  assert.match(bad.errors['branches.khonkaen.code'], /5 หลัก/);
  assert.match(core.validateCompanyProfile({ ...VALID, branches: { ...VALID.branches, khonkaen: { code: '00000' } } }).errors['branches.khonkaen.code'], /00000/);
  assert.match(core.validateCompanyProfile({ ...VALID, branches: { ...VALID.branches, ubon: { code: '00009' } } }).errors['branches.ubon.code'], /00000/);
  assert.equal(core.legalBranchLabel('00000'), 'สำนักงานใหญ่');
  assert.equal(core.legalBranchLabel('00002'), 'สาขาที่ 00002');
  assert.equal(core.branchDocumentLabel({ code: '00002', label: 'สาขาขอนแก่น' }), 'สาขาที่ 00002 (สาขาขอนแก่น)');
  assert.equal(core.branchDocumentLabel({ code: '00000', label: '' }), 'สำนักงานใหญ่');
});

test('company#core3 required fields, formats and lengths are checked; text is cleaned to one line', () => {
  const empty = core.validateCompanyProfile({});
  assert.equal(empty.ok, false);
  assert.deepEqual(Object.keys(empty.errors).sort(), ['addressTh', 'branches.khonkaen.code', 'nameTh', 'taxId'].sort());
  const formats = core.validateCompanyProfile({ ...VALID, email: 'info@', website: 'javascript:alert(1)', phone: 'โทรหาเรา' });
  assert.ok(formats.errors.email && formats.errors.website && formats.errors.phone, JSON.stringify(formats.errors));
  assert.match(core.validateCompanyProfile({ ...VALID, nameTh: 'ก'.repeat(161) }).errors.nameTh, /160/);
  for (const site of ['www.example.co.th', 'https://example.com/th', 'example.com']) assert.equal(core.validateCompanyProfile({ ...VALID, website: site }).ok, true, site);
  const cleaned = core.validateCompanyProfile({ ...VALID, addressTh: '  99 ถนนหนึ่ง\n\tแขวงสอง‮​  ', nameTh: 'บริษัท\u0007 ทดสอบ จำกัด' });
  assert.equal(cleaned.profile.addressTh, '99 ถนนหนึ่ง แขวงสอง');
  assert.equal(cleaned.profile.nameTh, 'บริษัท ทดสอบ จำกัด');
  assert.equal(cleaned.profile.branches.ubon.code, '00000');
});

test('company#core4 storage round-trip: both keys written and read back normalized; damaged records are ignored', () => {
  const storage = memoryStorage();
  const profile = { ...core.validateCompanyProfile(VALID).profile, updatedAt: '2026-10-03T10:00:00.000Z' };
  const logo = core.normalizeLogoRecord(logoRecord());
  core.writeCompanyProfileStorage(storage, keyFor, KEYS, { profile, logo });
  assert.deepEqual(JSON.parse(storage.map.get(keyFor(KEYS.profile))), profile);
  const read = core.readCompanyProfileStorage(storage, keyFor, KEYS);
  assert.deepEqual(read.profile, profile);
  assert.deepEqual(read.logo, logo);
  assert.deepEqual(read.errors, []);
  core.writeCompanyProfileStorage(storage, keyFor, KEYS, { profile: null, logo: null });
  assert.equal(storage.map.size, 0);
  const damaged = memoryStorage({ [keyFor(KEYS.profile)]: '{"schemaVersion":1,"nameTh":"x","taxId":"123"}', [keyFor(KEYS.logo)]: '{"schemaVersion":1,"dataUrl":"data:image/svg+xml;base64,PHN2Zz4=","width":10,"height":10}' });
  const bad = core.readCompanyProfileStorage(damaged, keyFor, KEYS);
  assert.equal(bad.profile, null);
  assert.equal(bad.logo, null);
  assert.equal(bad.errors.length, 2);
  assert.equal(core.readCompanyProfileStorage(memoryStorage({ [keyFor(KEYS.logo)]: 'null' }), keyFor, KEYS).logo, null);
});

test('company#core5 a quota error leaves storage exactly as it was (nothing half-saved)', () => {
  const oldProfile = JSON.stringify({ ...core.validateCompanyProfile(VALID).profile, nameTh: 'บริษัท เดิม จำกัด' });
  const oldLogo = JSON.stringify(core.normalizeLogoRecord(logoRecord()));
  const profile = core.validateCompanyProfile(VALID).profile;
  const bigLogo = core.normalizeLogoRecord(logoRecord({ dataUrl: pngUrl(290000) }));
  // 1) the logo (written first) does not fit
  let storage = memoryStorage({ [keyFor(KEYS.profile)]: oldProfile, [keyFor(KEYS.logo)]: oldLogo }, { failOn: key => key === keyFor(KEYS.logo) });
  assert.throws(() => core.writeCompanyProfileStorage(storage, keyFor, KEYS, { profile, logo: bigLogo }), error => core.isQuotaError(error));
  assert.equal(storage.map.get(keyFor(KEYS.profile)), oldProfile);
  assert.equal(storage.map.get(keyFor(KEYS.logo)), oldLogo);
  // 2) the logo fits but the profile does not → the logo is put back
  storage = memoryStorage({ [keyFor(KEYS.profile)]: oldProfile, [keyFor(KEYS.logo)]: oldLogo }, { failOn: key => key === keyFor(KEYS.profile) });
  assert.throws(() => core.writeCompanyProfileStorage(storage, keyFor, KEYS, { profile, logo: bigLogo }), error => core.isQuotaError(error));
  assert.equal(storage.map.get(keyFor(KEYS.profile)), oldProfile);
  assert.equal(storage.map.get(keyFor(KEYS.logo)), oldLogo);
  // 3) first save ever: no key appears
  storage = memoryStorage({}, { failOn: key => key === keyFor(KEYS.profile) });
  assert.throws(() => core.writeCompanyProfileStorage(storage, keyFor, KEYS, { profile, logo: bigLogo }));
  assert.equal(storage.map.size, 0);
});

test('company#core6 CurrentUser merge: saved values in, the original demo object back on reset', () => {
  const demo = { tenantName: 'บริษัทตัวอย่าง', companyName: 'บริษัทตัวอย่าง', companyProfile: { nameTh: 'บริษัทตัวอย่าง จำกัด', nameEn: 'DEMO CO., LTD.', taxId: '0000000000000', phone: '000', addressTh: 'ตัวอย่าง' } };
  const original = JSON.parse(JSON.stringify(demo));
  const profile = core.normalizeStoredProfile({ ...VALID, schemaVersion: 1 });
  const logo = core.normalizeLogoRecord(logoRecord());
  assert.equal(core.applyCompanyProfileToUser(demo, { profile, logo }), true);
  assert.equal(demo.tenantName, VALID.nameTh);
  assert.equal(demo.companyProfile.customProfile, true);
  assert.equal(demo.companyProfile.taxId, '0105568123453');
  assert.equal(demo.companyProfile.branches.khonkaen.companyNameTh, 'บริษัท สยามตัวอย่าง จำกัด (สาขาที่ 00002)');
  assert.equal(demo.companyProfile.branches.khonkaen.code, '00002');
  assert.ok(Object.isFrozen(demo.companyProfile.custom));
  assert.ok(core.companyLogoUrl(demo).startsWith('data:image/png;erp-logo=custom;base64,iVBORw0KGgo'));
  assert.equal(core.companyHeaderBranding(demo).title, VALID.nameTh);
  core.applyCompanyProfileToUser(demo, { profile: null, logo: null });
  assert.deepEqual(JSON.parse(JSON.stringify(demo)), original);
  assert.equal(core.companyLogoUrl(demo), core.DEFAULT_COMPANY_LOGO_URL);
  assert.equal(core.companyHeaderBranding(demo), null);
  assert.equal(core.documentCompany(demo, 'ubon', 'tax-invoice', 'ubon'), null, 'no saved profile → documents keep their own defaults');
  // logo only (e.g. restored from a backup): demo text stays, logo changes
  core.applyCompanyProfileToUser(demo, { profile: null, logo });
  assert.equal(demo.companyProfile.nameTh, 'บริษัทตัวอย่าง จำกัด');
  assert.notEqual(core.companyLogoUrl(demo), core.DEFAULT_COMPANY_LOGO_URL);
  // a logo URL that was not made by us is never used
  assert.equal(core.companyLogoUrl({ companyProfile: { logoDataUrl: 'data:image/svg+xml;erp-logo=custom;base64,PHN2Zz4=' } }), core.DEFAULT_COMPANY_LOGO_URL);
  assert.equal(core.companyLogoUrl({ companyProfile: { logoDataUrl: 'javascript:alert(1)' } }), core.DEFAULT_COMPANY_LOGO_URL);
});

test('company#core7 document mapping per document style (tax invoice / quotation / credit note)', () => {
  const user = {};
  core.applyCompanyProfileToUser(user, { profile: core.normalizeStoredProfile({ ...VALID, schemaVersion: 1 }) });
  const tax = core.documentCompany(user, 'khonkaen', 'tax-invoice', 'khonkaen');
  assert.equal(tax.companyNameTh, 'บริษัท สยามตัวอย่าง จำกัด (สาขาที่ 00002)');
  assert.equal(tax.companyNameEn, 'SIAM TUAYANG CO., LTD. (BRANCH 00002)');
  assert.equal(tax.addressTh, '12 ถนนมิตรภาพ ขอนแก่น 40000');
  assert.equal(tax.addressEn, '', 'no example English address leaks onto the customer invoice');
  assert.equal(tax.phone, 'Tel: 02-123-4567   Email: info@siamtuayang.co.th   Web: www.siamtuayang.co.th');
  assert.equal(tax.taxId, '0105568123453');
  const head = core.documentCompany(user, 'ubon', 'tax-invoice', 'khonkaen');
  assert.equal(head.companyNameTh, 'บริษัท สยามตัวอย่าง จำกัด (สำนักงานใหญ่)');
  assert.equal(head.addressTh, VALID.addressTh, 'empty branch address → head-office address');
  const quote = core.documentCompany(user, 'khonkaen', 'quotation', 'ubon');
  assert.equal(quote.companyNameTh, 'บริษัท สยามตัวอย่าง จำกัด');
  assert.equal(quote.label, 'สาขาที่ 00002 (สาขาขอนแก่น)');
  assert.equal(quote.phone, '02-123-4567 · อีเมล info@siamtuayang.co.th · เว็บไซต์ www.siamtuayang.co.th');
  const credit = core.documentCompany(user, 'ubon', 'credit-note', 'ubon');
  assert.equal(credit.companyNameTh, 'บริษัท สยามตัวอย่าง จำกัด');
  assert.equal(credit.label, 'สำนักงานใหญ่');
  assert.equal(core.documentCompany(user, 'unknown', 'tax-invoice', 'khonkaen').companyNameTh, tax.companyNameTh, 'unknown branch → the module fallback branch');
});

test('company#core8 logo file checks: type, size, real bytes and pixel size before decoding', () => {
  const MB = 1024 * 1024;
  assert.match(core.checkLogoFile({ name: 'logo.svg', type: 'image/svg+xml', size: 100 }), /SVG/);
  assert.match(core.checkLogoFile({ name: 'logo.gif', type: 'image/gif', size: 100 }), /PNG, JPG หรือ WebP/);
  assert.match(core.checkLogoFile({ name: 'logo.pdf', type: 'application/pdf', size: 100 }), /PNG, JPG หรือ WebP/);
  assert.match(core.checkLogoFile({ name: 'big.png', type: 'image/png', size: 5 * MB + 1 }), /5 MB/);
  assert.match(core.checkLogoFile({ name: 'empty.png', type: 'image/png', size: 0 }), /ว่าง/);
  assert.equal(core.checkLogoFile({ name: 'ok.png', type: 'image/png', size: 5 * MB }), '');
  assert.equal(core.checkLogoFile({ name: 'ok.JPG', type: '', size: 10 }), '');
  assert.equal(core.checkLogoFile({ name: 'ok.webp', type: 'image/webp', size: 10 }), '');
  const png = new Uint8Array(fs.readFileSync(path.join(ROOT, 'logo.png')));
  assert.equal(core.sniffImageType(png), 'image/png');
  assert.deepEqual(core.imageSizeFromBytes(png), { width: 512, height: 512 });
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0), 0xff, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xf4, 0x03, 0x20, 0x03, 0, 0, 0, 0]);
  assert.equal(core.sniffImageType(jpeg), 'image/jpeg');
  assert.deepEqual(core.imageSizeFromBytes(jpeg), { width: 800, height: 500 });
  const riff = tag => [...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP'), ...Buffer.from(tag), 0, 0, 0, 0];
  const vp8x = new Uint8Array([...riff('VP8X'), 0, 0, 0, 0, 0xe7, 0x03, 0x00, 0x8f, 0x01, 0x00]);
  assert.equal(core.sniffImageType(vp8x), 'image/webp');
  assert.deepEqual(core.imageSizeFromBytes(vp8x), { width: 1000, height: 400 });
  const vp8l = new Uint8Array([...riff('VP8L'), 0x2f, 0x2b, 0xc1, 0x31, 0x00, 0, 0, 0, 0, 0]);
  assert.deepEqual(core.imageSizeFromBytes(vp8l), { width: 300, height: 200 });
  assert.equal(core.sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), '');
  assert.equal(core.imageSizeFromBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), null);
  assert.match(core.checkLogoDimensions({ width: 20000, height: 20000 }), /ใหญ่เกินไป/);
  assert.match(core.checkLogoDimensions({ width: 10, height: 200 }), /เล็กเกินไป/);
  assert.match(core.checkLogoDimensions(null), /อ่านขนาดรูปไม่ได้/);
  assert.equal(core.checkLogoDimensions({ width: 4000, height: 3000 }), '');
});

// Stub canvas: `sizeOf(type, quality, width, height)` decides how long each encoding is.
function stubCanvasFactory({ transparent, sizeOf }) {
  const made = [];
  const create = (width, height) => {
    const canvas = {
      width, height, drawn: null,
      getContext: () => ({
        clearRect() {},
        drawImage: (image, x, y, w, h) => { canvas.drawn = { w, h }; },
        getImageData: (x, y, w, h) => { const data = new Uint8ClampedArray(w * h * 4).fill(255); if (transparent) data[3] = 0; return { data }; }
      }),
      toDataURL: (type = 'image/png', quality) => {
        const length = Math.round(sizeOf(type, quality, width, height));
        return type === 'image/jpeg' ? jpegUrl(length) : pngUrl(length);
      }
    };
    made.push(canvas);
    return canvas;
  };
  return { create, made };
}

test('company#core9 logo pipeline: ≤ 600 px, PNG keeps transparency, JPEG only when much smaller, steps down to ≤ 300 KB', () => {
  const image = {};
  const now = new Date('2026-10-03T10:00:00Z');
  // transparent 2400×1200 → PNG 600×300
  let stub = stubCanvasFactory({ transparent: true, sizeOf: (type, q, w, h) => w * h * 0.5 });
  let logo = core.encodeLogoImage(image, { width: 2400, height: 1200 }, stub.create, core.LOGO_LIMITS, now);
  assert.deepEqual([logo.width, logo.height, logo.mime], [600, 300, 'image/png']);
  assert.deepEqual(stub.made[0].drawn, { w: 600, h: 300 });
  assert.ok(logo.dataUrl.length <= core.LOGO_LIMITS.maxDataUrlChars);
  // opaque, JPEG ≥ 30 % smaller → JPEG; JPEG only 10 % smaller → PNG
  stub = stubCanvasFactory({ transparent: false, sizeOf: (type, q, w, h) => (type === 'image/jpeg' ? w * h * 0.3 : w * h * 1.2) });
  assert.equal(core.encodeLogoImage(image, { width: 600, height: 300 }, stub.create).mime, 'image/jpeg');
  stub = stubCanvasFactory({ transparent: false, sizeOf: (type, q, w, h) => (type === 'image/jpeg' ? w * h * 0.9 : w * h) });
  assert.equal(core.encodeLogoImage(image, { width: 600, height: 300 }, stub.create).mime, 'image/png');
  // a small logo is never enlarged
  stub = stubCanvasFactory({ transparent: true, sizeOf: () => 2000 });
  logo = core.encodeLogoImage(image, { width: 200, height: 80 }, stub.create);
  assert.deepEqual([logo.width, logo.height], [200, 80]);
  // a detailed photo: quality and then size go down until it fits
  stub = stubCanvasFactory({ transparent: false, sizeOf: (type, q, w, h) => (type === 'image/jpeg' ? w * h * q * 2 : w * h * 3) });
  logo = core.encodeLogoImage(image, { width: 3000, height: 3000 }, stub.create);
  assert.deepEqual([logo.width, logo.height, logo.mime], [400, 400, 'image/jpeg']);
  assert.ok(logo.dataUrl.length <= 300000);
  // nothing fits → a clear Thai message, no record
  stub = stubCanvasFactory({ transparent: true, sizeOf: (type, q, w, h) => w * h * 6 });
  assert.throws(() => core.encodeLogoImage(image, { width: 3000, height: 3000 }, stub.create), /300 KB/);
  // the encoder output must still be a PNG / JPEG data URL (e.g. a browser that ignores the type)
  stub = { create: (w, h) => ({ getContext: () => ({ clearRect() {}, drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(4).fill(255) }) }), toDataURL: () => 'data:image/svg+xml;base64,PHN2Zz4=' }) };
  assert.throws(() => core.encodeLogoImage(image, { width: 100, height: 100 }, stub.create), /300 KB/);
});

test('company#core10 logo data URLs: only our PNG / JPEG base64 is storable', () => {
  assert.equal(core.isStorableLogoDataUrl(pngUrl(1000)), true);
  assert.equal(core.isStorableLogoDataUrl(jpegUrl(1000)), true);
  assert.equal(core.isStorableLogoDataUrl(core.markCustomLogo(pngUrl(1000))), true);
  for (const bad of [
    'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+',
    'data:image/png;base64,AAAA' /* not a PNG signature */,
    `data:image/png;base64,${b64('iVBORw0KGgo', 1000)}" onerror="alert(1)`,
    'javascript:alert(1)', 'https://evil.example/logo.png', pngUrl(300100), 42, null
  ]) assert.equal(core.isStorableLogoDataUrl(bad), false, String(bad).slice(0, 60));
  assert.throws(() => core.normalizeLogoRecord(logoRecord({ width: 601 })), /600/);
  assert.equal(core.normalizeLogoRecord(logoRecord({ dataUrl: core.markCustomLogo(pngUrl(1000)) })).dataUrl, pngUrl(1000), 'stored without the marker');
  assert.equal(core.customLogoStyleTag(core.DEFAULT_COMPANY_LOGO_URL), '', 'default logo → print HTML unchanged');
  assert.match(core.customLogoStyleTag(core.markCustomLogo(pngUrl(1000))), /^<style>.*erp-logo=custom.*<\/style>$/);
});

test('company#core11 backup: payload validated fail-closed; restore writes follow replace / merge and the dates', () => {
  const profile = core.normalizeStoredProfile({ ...VALID, schemaVersion: 1, updatedAt: '2026-10-03T10:00:00.000Z' });
  const logo = core.normalizeLogoRecord(logoRecord());
  assert.equal(core.companyProfileBackupPayload({ profile: null, logo: null }), undefined, 'nothing saved → no backup entry');
  const payload = core.companyProfileBackupPayload({ profile, logo });
  assert.deepEqual(core.validateCompanyProfileBackup(JSON.parse(JSON.stringify(payload))), { profile, logo });
  for (const bad of [
    null, [], { schemaVersion: 2, profile: null, logo: null }, { schemaVersion: 1, profile: null, logo: null, extra: 1 },
    { schemaVersion: 1, profile: { ...profile, taxId: '0105568123454' }, logo: null },
    { schemaVersion: 1, profile: { ...profile, nameTh: 42 }, logo: null },
    { schemaVersion: 1, profile: null, logo: { ...logo, dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' } },
    { schemaVersion: 1, profile: null, logo: { ...logo, dataUrl: pngUrl(400000) } }
  ]) assert.throws(() => core.validateCompanyProfileBackup(bad), /ระบบหยุดก่อนเขียนข้อมูล/, JSON.stringify(bad)?.slice(0, 80));
  assert.deepEqual(core.companyProfileBackupWrites(undefined, keyFor, KEYS, null), [], 'old backup without it → nothing written');
  const writes = core.companyProfileBackupWrites(payload, keyFor, KEYS, null);
  assert.deepEqual(writes.map(([key]) => key), [keyFor(KEYS.profile), keyFor(KEYS.logo)]);
  assert.deepEqual(JSON.parse(writes[0][1]), profile);
  const newer = { profile: { ...profile, updatedAt: '2026-12-01T00:00:00.000Z' }, logo: null };
  assert.deepEqual(core.companyProfileBackupWrites(payload, keyFor, KEYS, newer), [], 'merge keeps a newer local profile');
  assert.equal(core.companyProfileBackupWrites(payload, keyFor, KEYS, newer, { replace: true }).length, 2, 'replace always applies');
  const noLogo = core.companyProfileBackupWrites({ schemaVersion: 1, profile, logo: null }, keyFor, KEYS, null);
  assert.equal(noLogo[1][1], 'null', 'backup made with the default logo → default logo');
  assert.throws(() => core.companyProfileBackupWrites({ schemaVersion: 1, profile: { nameTh: '' }, logo: null }, keyFor, KEYS, null), /Backup/);
});

test('company#core12 preview and hostile values: every value escaped, demo reset keeps the profile keys', () => {
  const hostile = core.validateCompanyProfile({
    ...VALID,
    nameTh: '<img src=x onerror="window.__xss=1">บริษัท',
    nameEn: '"><script>alert(1)</script>',
    addressTh: "'; alert(1); //<b>",
    branches: { ubon: { code: '00000', label: '<svg onload=alert(1)>' }, khonkaen: { code: '00001' } }
  }).profile;
  const html = core.companyHeaderPreviewHtml(hostile, 'javascript:alert(1)');
  assert.doesNotMatch(html, /<img src=x|<script>|<svg onload|<b>/);
  assert.match(html, /&lt;img src=x onerror=&quot;window.__xss=1&quot;&gt;บริษัท/);
  assert.match(html, /src="[^"]*logo\.png"/, 'a logo URL that is not ours falls back to the default file');
  assert.doesNotMatch(html, /javascript:/);
  const keys = ['erp_tenant::t1::comform_company_profile_v1', 'erp_tenant::t1::comform_company_logo_v1', 'erp_tenant::t1::biz2_ubon_2026_09'];
  assert.deepEqual(seed.demoResetStorageKeys(keys, 't1'), ['erp_tenant::t1::biz2_ubon_2026_09'], 'reset of the demo data keeps the company profile and logo');
});
