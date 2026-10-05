// ============================================================================
// erp-document-cancel.js — "ยกเลิกใบกำกับภาษี" / "ยกเลิกใบเสร็จรับเงิน" (cancel, never delete)
// ERP DEMO 4.3.1 · ADR-021
// ----------------------------------------------------------------------------
// Runtime layer around erp-document-cancel-core.js (pure rules):
// - open(kind, branch, year, month, id) — the row "⋯" menu action. Refuses BEFORE asking anything
//   when the period is closed (same check + message as every locked-period refusal, ADR-018) or
//   when live receipts / payments / credit notes / an open billing note still reference the invoice
//   (the message names them); otherwise shows a dialog: reason (list + free text, required).
// - cancel(kind, branch, year, month, id, {code, text}) — the write: re-checks everything inside the
//   sales-ledger write lease, keeps the record with status 'cancelled' + voided: true + voidedAt /
//   voidedBy / voidReason, marks its saved printed copy (issuedInvoices / issuedReceipts) the same
//   way, releases a source quotation / production order that pointed at the invoice, commits all of
//   it in one write session (ERPIntegrity.transaction), then writes the Audit Log row.
// Stock comes back by itself: the stock ledger derives sales from live invoices only.
// One window global: window.ERPDocumentCancel. No inline handlers.
// ============================================================================
import { runDocumentAction, documentActionFeedback, FinanceActionError, FINANCE_ACTION_ERROR_CODES } from './erp-document-finance-core.js';
import { withDemoWriteLease, SALES_LEDGER_WRITE_LEASE } from './erp-demo-concurrency.js';
import { isDocumentCancelled, escapeHtml, fmt, formatDate, localDateISO } from './erp-shared-core.js';
import { isCreditNoteLive } from './erp-credit-note-core.js';
import { documentCancelKind, cancelReasonText, cancelBlockers, applyDocumentCancel, releaseInvoiceLink } from './erp-document-cancel-core.js';

(() => {
  'use strict';
  if (window.ERPDocumentCancel) return;
  const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const notifyUser = (message, type = 'info', ms) => { if (typeof window.notify === 'function') window.notify(message, type, ms); else console.warn('[DocumentCancel]', message); };
  const userLabel = () => (window.ComformAuth?.getCurrentProfile?.() || window.CurrentUser || {})?.email || 'Local user';
  let overlay = null;

  function findRecord(kind, branch, year, month, id) {
    const meta = documentCancelKind(kind);
    if (!meta || typeof window.loadFor !== 'function') return null;
    const record = (window.loadFor(branch, Number(year), Number(month))?.[meta.collection] || []).find(row => String(row.id) === String(id));
    return record ? { ...record, branch } : null;
  }
  // Live documents that still reference the invoice (the same matchers as paymentSummary()).
  function linkedLive(kind, record) {
    if (kind !== 'invoices') return {};
    const I = window.ERPIntegrity, data = I.business(), store = I.flow();
    const inv = I.resolveInvoice({ branch: record.branch, id: record.id, no: record.no }, data) || record;
    const billingLive = b => b && b.status !== 'cancelled' && b.documentStatus !== 'cancelled';
    return {
      receipts: (data.receipts || []).filter(r => I.live(r) && I.receiptMatches(r, inv)),
      payments: (store.payments || []).filter(p => I.live(p) && (p.allocations || []).some(a => I.matchesAllocation(a, inv, p))),
      creditNotes: (data.creditNotes || []).filter(cn => isCreditNoteLive(cn) && (cn.lines || []).some(line => I.creditNoteMatches(line, cn, inv))),
      billingNotes: (store.billingNotes || []).filter(b => billingLive(b) && (b.lines || []).some(line => I.matchesAllocation(line, inv, b)))
    };
  }
  function blockersOf(kind, record) {
    if (kind === 'receipts' && record.paymentId) return ['ใบเสร็จนี้สร้างจากรายการรับชำระ (ใบวางบิล) — ยกเลิกรายการรับเงินที่หน้าใบวางบิล ระบบจะยกเลิกใบเสร็จให้เอง'];
    return cancelBlockers(kind, linkedLive(kind, record));
  }
  function periodRefusal(kind, record) {
    return window.ERPGovernance?.periodLockRefusal?.({ type: kind, branch: record.branch, date: record.date, action: `${kind}_cancel` }) || '';
  }
  // A document dated in an earlier month than today changes that month's output VAT (ภ.พ.30 may already be filed).
  function pastVatMonthMessage(meta, record) {
    const match = /^(\d{4})-(\d{2})/.exec(String(record.date || '')), today = /^(\d{4})-(\d{2})/.exec(localDateISO());
    if (!match || !today || Number(match[1]) * 12 + Number(match[2]) >= Number(today[1]) * 12 + Number(today[2])) return '';
    const monthText = `${MONTHS[Number(match[2]) - 1]} พ.ศ. ${Number(match[1]) + 543}`;
    return `⚠️ ${meta.title} ${record.no} ลงวันที่ ${formatDate(record.date)} อยู่ในเดือนภาษี ${monthText} ซึ่งผ่านไปแล้ว\n\n`
      + `การยกเลิกจะทำให้ยอดขาย${record.vatAmt ? `และภาษีขาย (${fmt(record.vatAmt)} บาท)` : ''}ของเดือน ${monthText} ลดลง หากยื่นแบบ ภ.พ.30 ของเดือนนั้นแล้ว ต้องยื่นแบบเพิ่มเติม\n\nต้องการยกเลิกต่อหรือไม่?`;
  }

  // ------------------------------------------------------------- write
  async function cancelUnlocked(kind, branch, year, month, id, input = {}) {
    const meta = documentCancelKind(kind);
    if (!meta) { notifyUser('ไม่รองรับการยกเลิกเอกสารประเภทนี้', 'error'); return { ok: false }; }
    const confirmFn = typeof input.confirm === 'function' ? input.confirm : message => window.confirm(message);
    let declined = false;
    const result = await runDocumentAction({
      action: `${kind}_cancel`,
      context: {},
      validate: () => {
        const reason = cancelReasonText(kind, input.code, input.text);
        if (!reason.ok) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, reason.error);
        const session = window.ComformDocumentWriteStore.createSession();
        const record = (session.get(branch, Number(year), Number(month))[meta.collection] || []).find(row => String(row.id) === String(id));
        if (!record) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.DEPENDENCY, `ไม่พบ${meta.title}ที่ต้องการยกเลิก`);
        if (isDocumentCancelled(record)) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, `${meta.title} ${record.no || ''} ถูกยกเลิกไปแล้ว`);
        window.ERPGovernance?.assertPeriodOpen?.({ branch, date: record.date, scope: 'sales', action: `${kind}_cancel` });
        const blockers = blockersOf(kind, { ...record, branch });
        if (blockers.length) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, `ยกเลิก${meta.title} ${record.no || ''} ไม่ได้ เพราะยังมีเอกสารที่อ้างอิงอยู่:\n${blockers.join('\n')}`);
        const past = pastVatMonthMessage(meta, record);
        if (past && confirmFn(past) !== true) { declined = true; throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, `ยังไม่ได้ยกเลิก${meta.title}`); }
        return { session, record, reason };
      },
      plan: ctx => ({ ...ctx, next: applyDocumentCancel(ctx.record, { at: new Date().toISOString(), by: userLabel(), reason: ctx.reason.reason, code: ctx.reason.code }) }),
      commit: ctx => {
        const { session, record, next } = ctx;
        const cancelFields = { voided: next.voided, status: next.status, voidedAt: next.voidedAt, voidedBy: next.voidedBy, voidReason: next.voidReason, voidReasonCode: next.voidReasonCode, updatedAt: next.updatedAt };
        Object.assign(record, cancelFields);
        session.mark(branch, Number(year), Number(month));
        // Its saved printed copy (ฉบับพิมพ์) carries the same status, wherever it is stored.
        const I = window.ERPIntegrity, type = kind === 'receipts' ? 'Receipt' : 'Invoice';
        const copies = (I.business()[meta.issued] || []).filter(copy => I.sameDoc(copy, { ...record, branch }, type));
        for (const copy of copies) {
          const stored = (session.get(copy._branch, copy._year, copy._month)[meta.issued] || []).find(row => String(row.id) === String(copy.id));
          if (stored && !isDocumentCancelled(stored)) { Object.assign(stored, cancelFields); session.mark(copy._branch, copy._year, copy._month); }
        }
        // The quotation / production order it was made from can be invoiced again (replacement, new number).
        const released = [];
        if (kind === 'invoices') {
          for (const [collection, prefix] of [['quotes', 'sourceQuote'], ['productions', 'sourceProduction']]) {
            if (!record[`${prefix}No`] && !record[`${prefix}Id`]) continue;
            const b = record[`${prefix}Branch`] || branch, y = Number(record[`${prefix}Year`] ?? year), m = Number(record[`${prefix}Month`] ?? month);
            if (!Number.isInteger(y) || !Number.isInteger(m) || m < 0 || m > 11) continue;
            const source = (session.get(b, y, m)[collection] || []).find(row => (record[`${prefix}Id`] !== '' && record[`${prefix}Id`] !== undefined && String(row.id) === String(record[`${prefix}Id`])) || (record[`${prefix}No`] && String(row.no) === String(record[`${prefix}No`])));
            if (source && releaseInvoiceLink(source, record)) { session.mark(b, y, m); released.push(source.no); }
          }
        }
        try { session.commit(); }
        catch (error) { throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.STORAGE, error?.message || `บันทึกการยกเลิก${meta.title}ในเครื่องไม่สำเร็จ`); }
        window.ERPIntegrity?.changed?.();
        return { ...ctx, released };
      },
      afterCommit: ctx => {
        const { record } = ctx;
        try {
          window.ERPProductionCore?.audit?.('void', meta.auditEntity, record.no || String(record.id),
            `${meta.action} (เก็บเอกสารและเลขที่ไว้ ไม่ลบ) · เหตุผล: ${record.voidReason} · ยกเลิกเมื่อ ${record.voidedAt} โดย ${record.voidedBy}${ctx.released.length ? ` · ปลดการเชื่อมกับ ${ctx.released.join(', ')}` : ''}`,
            { branch, entityId: String(record.id), cancelledAt: record.voidedAt, cancelledBy: record.voidedBy, reasonCode: record.voidReasonCode });
        } catch (error) { console.warn('[DocumentCancel] audit log write failed (document already cancelled)', error); }
        for (const name of ['renderIList', 'renderRList', 'renderIssuedInvoiceList', 'renderIssuedReceiptList', 'renderDash', 'renderPList', 'renderQLList', 'pcRenderInventory']) {
          try { window[name]?.(); } catch (error) { console.warn(`[DocumentCancel] ${name} refresh failed`, error); }
        }
        return ctx;
      }
    });
    if (declined) { notifyUser(`ยังไม่ได้${meta.action}`, 'info'); return { ok: false, declined: true }; }
    if (!result.ok) { notifyUser(documentActionFeedback(result).text, 'error', 9000); return { ok: false, error: result.message }; }
    const record = result.value.record;
    notifyUser(`${meta.action} ${record.no} แล้ว — เอกสารและเลขที่ยังอยู่ในระบบพร้อมตรา “ยกเลิก” (เลขนี้ไม่ถูกนำกลับมาใช้) หากต้องออกใหม่ ให้สร้าง${meta.title}ฉบับใหม่ ระบบจะใช้เลขที่ถัดไป`, 'success', 7000);
    return { ok: true, record };
  }
  async function cancel(kind, branch, year, month, id, input = {}) {
    try { return await withDemoWriteLease(SALES_LEDGER_WRITE_LEASE, () => cancelUnlocked(kind, branch, year, month, id, input)); }
    catch (error) { console.warn('[DocumentCancel] write lease', error); notifyUser(error?.message || 'ยังยกเลิกเอกสารไม่ได้ กรุณาลองใหม่', 'error'); return { ok: false }; }
  }

  // -------------------------------------------------------------- dialog
  function close() {
    const previous = overlay?.__returnFocus;
    overlay?.remove();
    overlay = null;
    try { previous?.focus?.(); } catch (_) { /* the row may have been re-rendered */ }
  }
  function open(kind, branch, year, month, id) {
    const meta = documentCancelKind(kind);
    const record = meta && findRecord(kind, branch, year, month, id);
    if (!record) { notifyUser(`ไม่พบ${meta?.title || 'เอกสาร'}นี้`, 'error'); return false; }
    if (isDocumentCancelled(record)) { notifyUser(`${meta.title} ${record.no} ถูกยกเลิกไปแล้ว (${record.voidReason || '-'})`, 'info'); return false; }
    // Refused before any question (ADR-018): closed period first, then documents that must be voided first.
    const lock = periodRefusal(kind, record);
    if (lock) { notifyUser(lock, 'error', 7200); return false; }
    const blockers = blockersOf(kind, record);
    if (blockers.length) { notifyUser(`ยกเลิก${meta.title} ${record.no} ไม่ได้ เพราะยังมีเอกสารที่อ้างอิงอยู่:\n${blockers.join('\n')}`, 'error', 9000); return false; }
    close();
    const returnFocus = document.activeElement;
    overlay = document.createElement('div');
    overlay.className = 'erp-cancel-overlay';
    overlay.__returnFocus = returnFocus;
    const titleId = 'erp-cancel-title';
    overlay.innerHTML = `<div class="erp-cancel-dialog" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
      <h2 id="${titleId}">${escapeHtml(meta.action)} ${escapeHtml(record.no || '')}</h2>
      <p class="erp-cancel-summary">${escapeHtml(record.customer || '-')} · วันที่ ${escapeHtml(formatDate(record.date))} · ยอดรวม ${fmt(record.total)} บาท</p>
      <p class="erp-cancel-rule">เอกสารจะ<b>ไม่ถูกลบ</b>: เก็บไว้พร้อมตรา “ยกเลิก / CANCELLED” และเหตุผล เลขที่ยังอยู่ในลำดับเดิมและจะไม่ถูกนำกลับมาใช้ ถ้าต้องออกใหม่ ให้สร้างฉบับใหม่ (ใช้เลขที่ถัดไป) — ควรเรียกต้นฉบับคืนจากลูกค้ามาเก็บรวมกับสำเนา</p>
      <fieldset class="erp-cancel-reasons"><legend>เหตุผลการยกเลิก <span aria-hidden="true">*</span></legend>
        ${meta.reasons.map((row, index) => `<label><input type="radio" name="erp-cancel-reason" value="${row.code}"${index === 0 ? ' data-first="1"' : ''}> ${escapeHtml(row.label)}</label>`).join('')}
      </fieldset>
      <label class="erp-cancel-text-label" for="erp-cancel-text">รายละเอียด (บังคับเมื่อเลือก “อื่น ๆ”)</label>
      <textarea id="erp-cancel-text" rows="2" maxlength="300" placeholder="เช่น เลขผู้เสียภาษีผู้ซื้อผิด จะออกฉบับใหม่แทน"></textarea>
      <p class="erp-cancel-error" role="alert" hidden></p>
      <div class="erp-cancel-actions"><button type="button" class="btn btn-secondary" data-cancel-dialog="close">ปิด</button><button type="button" class="btn btn-danger" data-cancel-dialog="confirm">ยืนยัน${escapeHtml(meta.action)}</button></div>
    </div>`;
    document.body.appendChild(overlay);
    const errorBox = overlay.querySelector('.erp-cancel-error');
    const showError = message => { errorBox.textContent = message; errorBox.hidden = !message; };
    let busy = false;
    overlay.addEventListener('change', () => showError('')); // a reason was picked / text changed: the old error no longer applies
    overlay.addEventListener('input', () => showError(''));
    overlay.addEventListener('click', async event => {
      if (event.target === overlay) { close(); return; }
      const action = event.target.closest?.('[data-cancel-dialog]')?.dataset.cancelDialog;
      if (action === 'close') { close(); return; }
      if (action !== 'confirm' || busy) return;
      const code = overlay.querySelector('input[name="erp-cancel-reason"]:checked')?.value || '';
      const text = overlay.querySelector('#erp-cancel-text')?.value || '';
      const check = cancelReasonText(kind, code, text);
      if (!check.ok) { showError(check.error); return; }
      busy = true;
      event.target.closest('button').disabled = true;
      const result = await cancel(kind, branch, year, month, id, { code, text });
      busy = false;
      if (result.ok || result.declined) close();
      else if (overlay) { event.target.closest('button').disabled = false; showError(result.error || 'ยกเลิกไม่สำเร็จ'); }
    });
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab') return;
      const items = [...overlay.querySelectorAll('input,textarea,button:not([disabled])')];
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    overlay.querySelector('input[data-first]')?.focus();
    return true;
  }

  window.ERPDocumentCancel = Object.freeze({ open, cancel, close, blockersFor: (kind, branch, year, month, id) => { const r = findRecord(kind, branch, year, month, id); return r ? blockersOf(kind, r) : []; } });
})();
