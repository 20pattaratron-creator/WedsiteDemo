// ============================================================================
// erp-promptpay-core.js — PromptPay / Thai QR payment payloads (EMVCo merchant-presented mode) (ADR-029, round 12)
// ERP DEMO 4.3.1 · pure: no DOM, no storage, no clock
// ----------------------------------------------------------------------------
// Sources (research report "ระยะ 2" 2.1; spec summary of the thai-qr-payment library, not yet checked against the
// official BOT / Thai Bankers' Association document — the owner must scan-test every main bank app, ADR-029):
//   00 Payload Format Indicator = "01"
//   01 Point of Initiation = "11" static (no amount) / "12" dynamic (an amount is set)
//   29 PromptPay credit transfer: 00 AID A000000677010111 + 01 mobile ("0066" + 9 digits, the leading 0 removed)
//      | 02 national ID / tax ID (13 digits) | 03 e-wallet ID (15 digits)
//   30 Bill payment (needs a bank agreement): 00 AID A000000677010112 + 01 biller ID (15 digits) + 02 reference 1
//      + 03 reference 2 (optional)
//   53 currency = "764" (THB) · 54 amount, two decimals ("50.00") · 58 country = "TH"
//   63 CRC: CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection, no final XOR) over the whole payload
//      including the "6304" header of the CRC itself, written as 4 upper-case hex digits.
// Order: the IDs ascending (00, 01, 29 | 30, 53, 54, 58, 63) as in the thai-qr-payment examples. EMVCo fixes only
// 00 first and 63 last; other libraries (php-promptpay-qr: 58 before 53) produce equally valid payloads — the tests
// rebuild their published examples with tlvPayload() to check the TLV and CRC code byte for byte.
// Reference 1 / 2 length: up to 20 upper-case letters / digits here (the official limit is not confirmed yet).
// ============================================================================
import { isValidThaiTaxId } from './erp-company-profile-core.js';

export const PROMPTPAY_CORE_VERSION = '1.0.0';
export const PROMPTPAY_AID = 'A000000677010111';
export const BILL_PAYMENT_AID = 'A000000677010112';
export const PROMPTPAY_ID_TYPES = Object.freeze(['mobile', 'tax_id', 'ewallet']);
const ID_SUB_TAG = Object.freeze({ mobile: '01', tax_id: '02', ewallet: '03' });
export const PROMPTPAY_CURRENCY_THB = '764';
export const PROMPTPAY_COUNTRY = 'TH';
export const PROMPTPAY_MAX_SATANG = 999999999999; // 9,999,999,999.99 → tag 54 is at most 13 characters
export const BILL_REF_MAX_LENGTH = 20;
// The main Thai bank apps the owner must scan-test before printing QR codes for customers (ADR-029).
export const PROMPTPAY_SCAN_TEST_BANKS = Object.freeze(['kbank', 'scb', 'bbl', 'ktb', 'bay', 'ttb', 'gsb', 'baac']);
export const PROMPTPAY_DOCUMENT_KINDS = Object.freeze(['invoice', 'billing', 'receipt']);

// ---------------------------------------------------------------- CRC and TLV
function asciiBytes(text) {
  const out = [];
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    if (code > 0x7e || code < 0x20) throw new Error('PromptPay: the payload must be printable ASCII');
    out.push(code);
  }
  return out;
}
// CRC-16/CCITT-FALSE. Known answer: "123456789" → 0x29B1.
export function crc16CcittFalse(text) {
  let crc = 0xffff;
  for (const byte of asciiBytes(text)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i += 1) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}
export function crcHex(text) {
  return crc16CcittFalse(text).toString(16).toUpperCase().padStart(4, '0');
}
// One data object: ID (2 digits) + length (2 digits) + value (1–99 printable ASCII characters).
export function tlv(id, value) {
  const text = String(value ?? '');
  if (!/^\d{2}$/.test(String(id))) throw new Error(`PromptPay: bad tag id ${id}`);
  if (!text.length || text.length > 99) throw new Error(`PromptPay: tag ${id} value length ${text.length}`);
  asciiBytes(text);
  return `${id}${String(text.length).padStart(2, '0')}${text}`;
}
// A complete payload from [id, value] pairs in the given order, closed by the CRC (tag 63).
export function tlvPayload(fields) {
  const body = `${fields.map(([id, value]) => tlv(id, value)).join('')}6304`;
  return `${body}${crcHex(body)}`;
}
// Top-level TLV list of a payload and whether its CRC is right (used by the tests and the settings preview).
export function parseTlv(text) {
  const out = [];
  const source = String(text ?? '');
  for (let at = 0; at < source.length;) {
    const id = source.slice(at, at + 2);
    const length = Number(source.slice(at + 2, at + 4));
    if (!/^\d{2}$/.test(id) || !/^\d{2}$/.test(source.slice(at + 2, at + 4)) || at + 4 + length > source.length) return null;
    out.push({ id, value: source.slice(at + 4, at + 4 + length) });
    at += 4 + length;
  }
  return out;
}
export function parsePayload(payload) {
  const fields = parseTlv(payload);
  if (!fields || !fields.length) return { ok: false, fields: [], crcOk: false };
  const last = fields[fields.length - 1];
  const crcOk = last.id === '63' && last.value.length === 4 && crcHex(String(payload).slice(0, -4)) === last.value;
  return { ok: true, fields, crcOk };
}

// ---------------------------------------------------------------- PromptPay IDs
const digitsOnly = value => String(value ?? '').replace(/[\s\-().]/g, '');
// A Thai mobile number in any usual writing (081-234-5678, +66 81 234 5678, 66812345678, 0066812345678) → the
// 13-character wire form "0066" + 9 digits. Thai mobile numbers start with 06, 08 or 09.
export function normalizeMobile(raw) {
  const text = digitsOnly(raw);
  const match = /^(?:\+66|0066|66|0)(\d{9})$/.exec(text);
  if (!match || !/^[689]/.test(match[1])) return '';
  return `0066${match[1]}`;
}
// → { ok, type, subTag, value } | { ok: false, error } — error codes: id_type, mobile_invalid, tax_id_length,
// tax_id_check, ewallet_invalid.
export function promptPayIdField(type, raw) {
  if (!PROMPTPAY_ID_TYPES.includes(type)) return { ok: false, error: 'id_type' };
  if (type === 'mobile') {
    const value = normalizeMobile(raw);
    return value ? { ok: true, type, subTag: ID_SUB_TAG.mobile, value } : { ok: false, error: 'mobile_invalid' };
  }
  const digits = digitsOnly(raw);
  if (type === 'tax_id') {
    if (!/^\d{13}$/.test(digits)) return { ok: false, error: 'tax_id_length' };
    if (!isValidThaiTaxId(digits)) return { ok: false, error: 'tax_id_check' };
    return { ok: true, type, subTag: ID_SUB_TAG.tax_id, value: digits };
  }
  return /^\d{15}$/.test(digits) ? { ok: true, type, subTag: ID_SUB_TAG.ewallet, value: digits } : { ok: false, error: 'ewallet_invalid' };
}

// ---------------------------------------------------------------- amounts
// Baht (number or "1,234.50") → satang. Refused (null): not finite, ≤ 0, more than two decimals, above the maximum.
export function amountToSatang(amount) {
  const n = typeof amount === 'string' ? Number(amount.replace(/,/g, '').trim()) : Number(amount);
  if (amount === null || amount === undefined || amount === '' || !Number.isFinite(n) || n <= 0) return null;
  const scaled = Number((n * 100).toPrecision(15));
  const satang = Math.round(scaled);
  if (Math.abs(scaled - satang) > 1e-6) return null;
  if (satang < 1 || satang > PROMPTPAY_MAX_SATANG) return null;
  return satang;
}
// Tag 54 text: integer baht, a dot and two decimals, no separators ("1234.50").
export function formatAmount(amount) {
  const satang = amountToSatang(amount);
  if (satang === null) throw new Error('PromptPay: invalid amount');
  return `${Math.floor(satang / 100)}.${String(satang % 100).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- payloads
// { type, id, amount? } → { ok, payload, dynamic } | { ok: false, error }
export function buildPromptPayPayload(input = {}) {
  const id = promptPayIdField(input.type, input.id);
  if (!id.ok) return id;
  const hasAmount = !(input.amount === null || input.amount === undefined || input.amount === '');
  if (hasAmount && amountToSatang(input.amount) === null) return { ok: false, error: 'amount_invalid' };
  const fields = [['00', '01'], ['01', hasAmount ? '12' : '11'], ['29', tlv('00', PROMPTPAY_AID) + tlv(id.subTag, id.value)], ['53', PROMPTPAY_CURRENCY_THB]];
  if (hasAmount) fields.push(['54', formatAmount(input.amount)]);
  fields.push(['58', PROMPTPAY_COUNTRY]);
  return { ok: true, payload: tlvPayload(fields), dynamic: hasAmount, kind: 'promptpay' };
}
// Reference text for tag 30: upper case, letters and digits only ("BL6909-0001" → "BL69090001"); '' when empty.
export function billReference(text) {
  return String(text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
// { billerId (15 digits), ref1, ref2?, amount? } → { ok, payload } | { ok: false, error } — errors: biller_invalid,
// ref1_required, ref_too_long, amount_invalid.
export function buildBillPaymentPayload(input = {}) {
  const billerId = digitsOnly(input.billerId);
  if (!/^\d{15}$/.test(billerId)) return { ok: false, error: 'biller_invalid' };
  const ref1 = billReference(input.ref1);
  const ref2 = billReference(input.ref2);
  if (!ref1) return { ok: false, error: 'ref1_required' };
  if (ref1.length > BILL_REF_MAX_LENGTH || ref2.length > BILL_REF_MAX_LENGTH) return { ok: false, error: 'ref_too_long' };
  const hasAmount = !(input.amount === null || input.amount === undefined || input.amount === '');
  if (hasAmount && amountToSatang(input.amount) === null) return { ok: false, error: 'amount_invalid' };
  const template = tlv('00', BILL_PAYMENT_AID) + tlv('01', billerId) + tlv('02', ref1) + (ref2 ? tlv('03', ref2) : '');
  const fields = [['00', '01'], ['01', hasAmount ? '12' : '11'], ['30', template], ['53', PROMPTPAY_CURRENCY_THB]];
  if (hasAmount) fields.push(['54', formatAmount(input.amount)]);
  fields.push(['58', PROMPTPAY_COUNTRY]);
  return { ok: true, payload: tlvPayload(fields), dynamic: hasAmount, kind: 'bill_payment', ref1, ref2 };
}

// ---------------------------------------------------------------- settings (comform_promptpay_settings_v1)
// { schemaVersion: 1, enabled, idType, promptPayId (not `id`: the JSON-backup walker reads every `id` key as a record
// id), payeeName, documents: { invoice, billing, receipt },
//   billPayment: { enabled, billerId, ref2 }, scanTests: { [bank]: 'YYYY-MM-DD' }, updatedAt }
export const PROMPTPAY_SETTINGS_SCHEMA_VERSION = 1;
export function defaultPromptPaySettings() {
  return { schemaVersion: PROMPTPAY_SETTINGS_SCHEMA_VERSION, enabled: false, idType: 'tax_id', promptPayId: '', payeeName: '', documents: { invoice: true, billing: true, receipt: true }, billPayment: { enabled: false, billerId: '', ref2: '' }, scanTests: {}, updatedAt: '' };
}
const SETTINGS_FIELDS = Object.freeze(['schemaVersion', 'enabled', 'idType', 'promptPayId', 'payeeName', 'documents', 'billPayment', 'scanTests', 'updatedAt']);
const cleanLine = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const isIsoDay = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
// Strict reader (fail-closed): a malformed store throws a Thai message (the settings card shows it; prints then carry
// no QR). null / '' = never saved → the defaults (QR off).
export function normalizePromptPaySettings(raw) {
  const fail = detail => { throw new Error(`ข้อมูลตั้งค่า QR พร้อมเพย์ไม่ถูกต้อง: ${detail} — ระบบไม่พิมพ์ QR จนกว่าจะแก้ไข`); };
  if (raw === null || raw === undefined || raw === '') return defaultPromptPaySettings();
  let value = raw;
  if (typeof raw === 'string') { try { value = JSON.parse(raw); } catch (error) { fail(`อ่าน JSON ไม่ได้ (${error.message})`); } }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('ต้องเป็น object');
  for (const key of Object.keys(value)) if (!SETTINGS_FIELDS.includes(key)) fail(`ช่อง ${key}`);
  if (value.schemaVersion !== PROMPTPAY_SETTINGS_SCHEMA_VERSION) fail('schemaVersion');
  if (typeof value.enabled !== 'boolean') fail('enabled');
  if (!PROMPTPAY_ID_TYPES.includes(value.idType)) fail('ประเภทพร้อมเพย์');
  if (typeof value.promptPayId !== 'string' || value.promptPayId.length > 40) fail('หมายเลขพร้อมเพย์');
  if (typeof value.payeeName !== 'string' || value.payeeName.length > 120) fail('ชื่อผู้รับเงิน');
  const docs = value.documents;
  if (!docs || typeof docs !== 'object' || Array.isArray(docs)) fail('documents');
  for (const key of Object.keys(docs)) if (!PROMPTPAY_DOCUMENT_KINDS.includes(key) || typeof docs[key] !== 'boolean') fail(`documents.${key}`);
  const bill = value.billPayment;
  if (!bill || typeof bill !== 'object' || Array.isArray(bill)) fail('billPayment');
  for (const key of Object.keys(bill)) if (!['enabled', 'billerId', 'ref2'].includes(key)) fail(`billPayment.${key}`);
  if (typeof bill.enabled !== 'boolean' || typeof bill.billerId !== 'string' || typeof bill.ref2 !== 'string') fail('billPayment');
  const tests = value.scanTests;
  if (!tests || typeof tests !== 'object' || Array.isArray(tests)) fail('scanTests');
  for (const [bank, day] of Object.entries(tests)) if (!PROMPTPAY_SCAN_TEST_BANKS.includes(bank) || !isIsoDay(day)) fail(`scanTests.${bank}`);
  const out = {
    schemaVersion: PROMPTPAY_SETTINGS_SCHEMA_VERSION,
    enabled: value.enabled,
    idType: value.idType,
    promptPayId: value.promptPayId.trim(),
    payeeName: cleanLine(value.payeeName),
    documents: Object.fromEntries(PROMPTPAY_DOCUMENT_KINDS.map(kind => [kind, docs[kind] !== false])),
    billPayment: { enabled: bill.enabled, billerId: digitsOnly(bill.billerId), ref2: billReference(bill.ref2) },
    scanTests: Object.fromEntries(PROMPTPAY_SCAN_TEST_BANKS.filter(bank => tests[bank]).map(bank => [bank, tests[bank]])),
    updatedAt: String(value.updatedAt || '')
  };
  // Switched on only with a usable ID (and a usable biller ID when bill payment is chosen).
  if (out.enabled) {
    if (out.billPayment.enabled) { if (!/^\d{15}$/.test(out.billPayment.billerId)) fail('Biller ID ต้องเป็นตัวเลข 15 หลัก'); }
    else if (!promptPayIdField(out.idType, out.promptPayId).ok) fail('หมายเลขพร้อมเพย์ไม่ถูกต้อง');
    if (out.billPayment.ref2.length > BILL_REF_MAX_LENGTH) fail('Ref 2');
  }
  return out;
}
// The QR payload for one document: { amount (baht), ref (document number) } → { ok, payload, kind } | { ok: false,
// error }. 'off' when QR is off or not wanted on this kind of document.
export function payloadForDocument(settings, kind, input = {}) {
  if (!settings?.enabled || !settings.documents?.[kind]) return { ok: false, error: 'off' };
  if (settings.billPayment?.enabled) return buildBillPaymentPayload({ billerId: settings.billPayment.billerId, ref1: input.ref, ref2: settings.billPayment.ref2, amount: input.amount });
  return buildPromptPayPayload({ type: settings.idType, id: settings.promptPayId, amount: input.amount });
}
// Main bank apps not yet scan-tested (the settings card warns until the list is empty).
export function untestedBanks(settings) {
  const tests = settings?.scanTests || {};
  return PROMPTPAY_SCAN_TEST_BANKS.filter(bank => !tests[bank]);
}
