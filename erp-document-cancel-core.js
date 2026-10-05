// ============================================================================
// erp-document-cancel-core.js — rules for cancelling (voiding) an issued tax invoice / receipt
// ERP DEMO 4.3.1 · ADR-021
// ----------------------------------------------------------------------------
// An issued tax invoice is never deleted. To cancel it the record is KEPT with
// status 'cancelled' + voided: true (the flags ERPIntegrity.live() and every report
// already honour), the reason, who and when; its number stays in the running
// sequence (the next invoice gets the next number — never this one again) and a
// replacement, if needed, is issued under a NEW number. The same applies to a
// receipt (ใบเสร็จรับเงิน) that is not part of a recorded payment.
// Sources (ADR-021): ป.86/2542 (rd.go.th/3568.html) — "ยกเลิกใบกำกับภาษีฉบับเดิมและจัดทำ
// ใบกำกับภาษีฉบับใหม่"; RD ruling 0702(กม.05)/1041 (rd.go.th/41087.html); records kept
// ≥ 5 years — มาตรา 87/3; sales report keeps a cancelled invoice as "ยกเลิก"
// (docs/TAX_FEATURES_SPEC.md §1 rule 5).
//
// Pure: no DOM, no storage. erp-document-cancel.js reads the data, asks the user and writes.
// ============================================================================
import { isDocumentCancelled } from './erp-shared-core.js';

export const DOCUMENT_CANCEL_CORE_VERSION = '1.0.0';

export const INVOICE_CANCEL_REASONS = Object.freeze([
  Object.freeze({ code: 'wrong_details', label: 'ออกผิด: ชื่อ/ที่อยู่/เลขผู้เสียภาษี/สาขาของผู้ซื้อ หรือรายการ/ยอดเงินไม่ถูกต้อง (จะออกฉบับใหม่แทน)' }),
  Object.freeze({ code: 'duplicate', label: 'ออกซ้ำกับฉบับอื่น' }),
  Object.freeze({ code: 'order_cancelled', label: 'ลูกค้ายกเลิกการซื้อก่อนส่งมอบสินค้า/บริการ' }),
  Object.freeze({ code: 'wrong_form', label: 'ออกผิดรูปแบบ (เต็มรูป/อย่างย่อ) หรือผิดสาขาผู้ขาย' }),
  Object.freeze({ code: 'other', label: 'อื่น ๆ (ระบุรายละเอียด)' })
]);
export const RECEIPT_CANCEL_REASONS = Object.freeze([
  Object.freeze({ code: 'wrong_details', label: 'ออกผิด: ผู้ชำระ/ยอดเงิน/บิลอ้างอิงไม่ถูกต้อง (จะออกฉบับใหม่แทน)' }),
  Object.freeze({ code: 'duplicate', label: 'ออกซ้ำกับใบเสร็จฉบับอื่น' }),
  Object.freeze({ code: 'payment_failed', label: 'รับเงินไม่สำเร็จ (เช็คคืน/โอนไม่เข้า)' }),
  Object.freeze({ code: 'other', label: 'อื่น ๆ (ระบุรายละเอียด)' })
]);

// kind 'invoices' | 'receipts' (the pack collection) → labels used in messages and the dialog.
export function documentCancelKind(kind) {
  if (kind === 'invoices') return { collection: 'invoices', issued: 'issuedInvoices', title: 'ใบกำกับภาษี', action: 'ยกเลิกใบกำกับภาษี', reasons: INVOICE_CANCEL_REASONS, auditEntity: 'invoice' };
  if (kind === 'receipts') return { collection: 'receipts', issued: 'issuedReceipts', title: 'ใบเสร็จรับเงิน', action: 'ยกเลิกใบเสร็จรับเงิน', reasons: RECEIPT_CANCEL_REASONS, auditEntity: 'receipt' };
  return null;
}

const MAX_REASON_TEXT = 300;
const clean = value => String(value ?? '').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();

// A reason is required: a listed code, plus free text when the code is 'other' (optional otherwise).
// → { ok: true, code, label, text, reason } or { ok: false, error }. `reason` is what is stored/printed.
export function cancelReasonText(kind, code, text) {
  const meta = documentCancelKind(kind);
  if (!meta) return { ok: false, error: 'ไม่รองรับการยกเลิกเอกสารประเภทนี้' };
  const option = meta.reasons.find(row => row.code === code);
  if (!option) return { ok: false, error: 'กรุณาเลือกเหตุผลการยกเลิก' };
  const detail = clean(text);
  if (detail.length > MAX_REASON_TEXT) return { ok: false, error: `รายละเอียดเหตุผลยาวเกิน ${MAX_REASON_TEXT} ตัวอักษร` };
  if (code === 'other' && detail.length < 3) return { ok: false, error: 'กรุณาระบุรายละเอียดเหตุผลการยกเลิก (อย่างน้อย 3 ตัวอักษร)' };
  const label = option.code === 'other' ? 'อื่น ๆ' : option.label.replace(/\s*\(จะออกฉบับใหม่แทน\)$/, '');
  return { ok: true, code: option.code, label, text: detail, reason: detail ? `${label} — ${detail}` : label };
}

// Live documents that must be voided first. Inputs are the matching records the controller found
// with ERPIntegrity's own matchers: {receipts, payments, creditNotes, billingNotes} (each {no}).
// → [] when the document may be cancelled, else one Thai line per blocking group.
export function cancelBlockers(kind, linked = {}) {
  if (kind !== 'invoices') return [];
  const nos = rows => [...new Set((Array.isArray(rows) ? rows : []).map(row => String(row?.no || row?.id || '').trim()).filter(Boolean))];
  const out = [];
  const receipts = nos(linked.receipts), payments = nos(linked.payments), creditNotes = nos(linked.creditNotes), billings = nos(linked.billingNotes);
  if (receipts.length) out.push(`ใบเสร็จรับเงินที่ยังใช้งาน: ${receipts.join(', ')} — ยกเลิกใบเสร็จก่อน`);
  if (payments.length) out.push(`รายการรับชำระ: ${payments.join(', ')} — ยกเลิกรายการรับเงินที่หน้าใบวางบิลก่อน`);
  if (creditNotes.length) out.push(`ใบลดหนี้ที่ยังใช้งาน: ${creditNotes.join(', ')} — ยกเลิกใบลดหนี้ก่อน`);
  // The demo has no "cancel billing note" action yet, so an invoice on an open billing note is settled with a
  // full credit note instead (a billing line must never point at a cancelled invoice).
  if (billings.length) out.push(`อยู่ในใบวางบิลที่ยังเปิดอยู่: ${billings.join(', ')} — ระบบยังไม่มีการยกเลิกใบวางบิล ให้ออกใบลดหนี้เต็มจำนวนแทนการยกเลิก`);
  return out;
}

// The record as it is kept after cancelling (a copy; the input is not changed).
export function applyDocumentCancel(record, meta = {}) {
  if (!record || typeof record !== 'object') throw new Error('ไม่พบเอกสารที่ต้องการยกเลิก');
  if (isDocumentCancelled(record)) throw new Error(`เอกสาร ${record.no || ''} ถูกยกเลิกไปแล้ว`);
  const at = String(meta.at || new Date().toISOString());
  return {
    ...record,
    voided: true,
    status: 'cancelled',
    voidedAt: at,
    voidedBy: clean(meta.by) || 'Local user',
    voidReason: clean(meta.reason),
    voidReasonCode: String(meta.code || ''),
    updatedAt: at
  };
}

// A source quotation / production order still pointing at the cancelled invoice is released, so the
// replacement invoice can be created from it again (the old link is kept as cancelledInvoiceNos).
export function releaseInvoiceLink(source, invoice) {
  if (!source || !invoice) return false;
  const id = String(invoice.id ?? ''), no = String(invoice.no ?? '');
  const linked = (id && String(source.invoiceId ?? '') === id) || (no && String(source.invoiceNo ?? '') === no);
  if (!linked) return false;
  source.cancelledInvoiceNos = [...new Set([...(Array.isArray(source.cancelledInvoiceNos) ? source.cancelledInvoiceNos : []), no].filter(Boolean))];
  Object.assign(source, { invoiceId: '', invoiceNo: '', invoiceStatus: 'cancelled', workflowUpdatedAt: new Date().toISOString() });
  return true;
}
