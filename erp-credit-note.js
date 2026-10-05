// ============================================================================
// erp-credit-note.js — Credit Note (ใบลดหนี้) form + list controller
// ERP DEMO 4.3.1 · Local demo only (browser storage, no server transaction).
//
// Business rules live in erp-credit-note-core.js (pure). This module only reads
// the form, calls the core, and persists through the same strict, rollback-
// capable write session the invoice/receipt flows use
// (window.ComformDocumentWriteStore). Credit notes are stored in the
// `creditNotes` collection of the biz2_{branch}_{year}_{month} pack of the
// credit note's OWN date, so they reduce sales/output VAT in their own month.
// Buttons use data-cn-action delegation instead of inline onclick handlers.
// ============================================================================
import { CREDIT_NOTE_REASONS, CREDIT_NOTE_VAT_MODE_LABELS, calculateCreditNote, validateCreditNote, buildCreditNoteRecord, creditedByInvoice, creditNoteInvoiceBasis, creditNoteVatModeOf, creditNoteParseAmount, creditNoteProductKey, creditNoteStatusLabel, creditNoteTotals, summarizeOutputVat, isCreditNoteLive, isCreditNoteReturnReason, findCreditNoteInvoice, creditNoteRequiresBuyerName, applyCreditNoteEdit, creditNoteBuyerBranchLabel } from './erp-credit-note-core.js';
import { escapeHtml, fmt, bahtText, formatDate, localDateISO, roundMoneyValue, taxInvoiceLacksBuyer } from './erp-shared-core.js';
import { runDocumentAction, documentActionFeedback, FinanceActionError, FINANCE_ACTION_ERROR_CODES } from './erp-document-finance-core.js';
import { withThaiCalendarMeta } from './erp-date-core.js';
import { withDemoWriteLease, SALES_LEDGER_WRITE_LEASE } from './erp-demo-concurrency.js';
import { normalizeProductKey } from './erp-master-data-core.js';
import { rowActionsHtml } from './erp-row-actions.js';
import { branchLabelMap, isMultiBranchUi } from './erp-branches-core.js';
import { icon } from './erp-icons.js';

(() => {
  'use strict';
  if (window.ERPCreditNotes) return;
  const BRANCH_LABEL = branchLabelMap({ ubon: 'สาขาสำนักงานใหญ่', khonkaen: 'สาขาที่ 00001' }); // ADR-022: live labels
  const MONTH_LABELS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const ALL_MONTHS = Array.from({ length: 12 }, (_, index) => index);
  const SAVE_LABEL = 'บันทึกใบลดหนี้'; // after the save line icon (ADR-017)
  const form = { branch: '', lines: [], context: [], returnItems: [], edit: null, saving: false };

  const $ = id => document.getElementById(id);
  const value = id => String($(id)?.value ?? '').trim();
  const setValue = (id, next) => { const el = $(id); if (el) el.value = next ?? ''; };
  const notifyUser = (message, type) => { if (typeof window.notify === 'function') window.notify(message, type); else console.warn('[CreditNote]', message); };
  const moneyInput = amount => Number.isFinite(Number(amount)) ? roundMoneyValue(amount).toFixed(2) : '';
  const profile = () => window.ComformAuth?.getCurrentProfile?.() || window.CurrentUser || null;
  const lockedBranch = () => { const branch = profile()?.branch; return branch && branch !== 'all' ? branch : ''; };
  // ADR-022: with one establishment the branch choice is hidden and every credit note belongs to the head office.
  const defaultBranch = () => lockedBranch() || (isMultiBranchUi() ? '' : 'ubon');
  const branchActive = branch => window.SaaSService?.isBranchActive?.(branch) ?? true;
  const userLabel = () => profile()?.email || 'Local user';

  function visibleBranches() {
    const locked = lockedBranch();
    if (locked) return [locked];
    const rows = ['ubon', 'khonkaen'].filter(branchActive);
    return rows.length ? rows : ['ubon'];
  }
  function knownYears() {
    const years = typeof window.allYears === 'function' ? window.allYears() : [];
    return [...new Set([...years, new Date().getFullYear()].map(Number).filter(Number.isFinite))].sort((a, b) => b - a);
  }
  // Tolerant read for rendering (a corrupted month never breaks the page) or
  // strict read for the write path (a corrupted month stops the save).
  function readPack(branch, year, month, strict) {
    if (strict) return window.ComformDocumentWriteStore.loadForWrite(branch, year, month);
    return typeof window.loadFor === 'function' ? window.loadFor(branch, year, month) : {};
  }
  function scanRows(collection, { strict = false, branches = visibleBranches(), years = knownYears(), months = ALL_MONTHS } = {}) {
    const rows = [];
    for (const branch of branches) for (const year of years) for (const month of months) {
      const pack = readPack(branch, year, month, strict);
      for (const row of Array.isArray(pack?.[collection]) ? pack[collection] : []) rows.push({ ...row, branch, _branch: branch, _year: year, _month: month });
    }
    return rows;
  }
  function periodOf(date) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
    if (!match) return null;
    const year = Number(match[1]), month = Number(match[2]) - 1;
    return year >= 2020 && year <= 2100 && month >= 0 && month <= 11 ? { year, month } : null;
  }

  // ---------------------------------------------------------------- branch
  function applyBranchClasses() {
    const ub = $('cn-br-ub'), kk = $('cn-br-kk');
    if (ub) { ub.className = 'br-opt' + (form.branch === 'ubon' ? ' ub-sel' : ''); const radio = ub.querySelector('input'); if (radio) radio.checked = form.branch === 'ubon'; }
    if (kk) { kk.className = 'br-opt' + (form.branch === 'khonkaen' ? ' kk-sel' : ''); const radio = kk.querySelector('input'); if (radio) radio.checked = form.branch === 'khonkaen'; }
    if (form.branch) $('cn-br-warn')?.classList.remove('show');
    const badge = $('cn-inv-source-branch');
    if (badge) badge.textContent = form.branch ? BRANCH_LABEL[form.branch] : 'กรุณาเลือกสาขา';
  }
  function setBranch(branch) {
    if (!BRANCH_LABEL[branch]) return;
    if (!branchActive(branch)) { notifyUser('สาขานี้ยังไม่เปิดใช้งานในแพ็กเกจ กรุณาเพิ่มสิทธิ์สาขาก่อน'); return; }
    const locked = lockedBranch();
    if (locked && branch !== locked) { notifyUser(`บัญชีนี้ถูกผูกกับ ${BRANCH_LABEL[locked]} จึงออกใบลดหนี้ได้เฉพาะสาขานี้`); branch = locked; }
    if (form.edit && branch !== form.edit.branch) { notifyUser('ไม่สามารถเปลี่ยนสาขาระหว่างแก้ไขใบลดหนี้ได้'); return; }
    if (form.branch === branch) { applyBranchClasses(); return; }
    if (form.lines.length && !window.confirm('เปลี่ยนสาขาจะล้างใบกำกับภาษีที่เลือกไว้ ต้องการดำเนินการต่อหรือไม่?')) return;
    form.branch = branch;
    form.lines = []; form.context = []; form.returnItems = [];
    applyCustomerFromInvoice(null);
    applyBranchClasses();
    renderAll();
  }

  // ------------------------------------------------------- invoice picker
  function lineKey(ref) { return `${ref.branch}|${String(ref.id ?? '') || 'no:' + String(ref.no ?? '')}`; }
  function locateInvoice(ref) {
    const pack = readPack(ref.branch, Number(ref.year), Number(ref.month), false);
    const own = (pack.invoices || []).find(inv => (ref.id !== '' && ref.id !== undefined && String(inv.id) === String(ref.id)) || (!ref.id && ref.no && String(inv.no) === String(ref.no)));
    if (own) return { ...own, branch: ref.branch, _branch: ref.branch, _year: Number(ref.year), _month: Number(ref.month) };
    // The invoice may have moved month (edited date) — fall back to a branch-wide lookup.
    return findCreditNoteInvoice({ invoiceId: ref.id, invoiceNo: ref.no, invoiceBranch: ref.branch }, scanRows('invoices', { branches: [ref.branch] }));
  }
  function refreshContext() {
    const exclude = form.edit ? String(form.edit.id) : '';
    const creditNotes = scanRows('creditNotes');
    form.context = form.lines.map(line => {
      const invoice = locateInvoice(line.ref);
      return { invoice, prior: invoice ? creditedByInvoice(invoice, creditNotes, { excludeCreditNoteId: exclude }) : { amount: 0, value: 0, total: 0, count: 0 } };
    });
  }
  function selectedCustomer() {
    const first = form.context.find(row => row.invoice)?.invoice;
    return first ? String(first.customer || '').trim().toLowerCase() : '';
  }
  function selectedVatMode() {
    const first = form.context.find(row => row.invoice)?.invoice;
    return first ? creditNoteVatModeOf(first) : '';
  }
  function populateMonthSelect(id, withAllLabel = 'ทุกเดือน') {
    const el = $(id);
    if (!el || el.options.length > 1) return;
    el.innerHTML = `<option value="">${withAllLabel}</option>` + MONTH_LABELS.map((label, index) => `<option value="${index}">${label}</option>`).join('');
  }
  function populateInvoiceOptions() {
    const select = $('cn-inv-ref'), hint = $('cn-inv-link-hint');
    if (!select) return;
    const previous = select.value;
    select.innerHTML = '<option value="">-- เลือกใบกำกับภาษีที่ต้องการลดหนี้ --</option>';
    if (!form.branch) {
      select.disabled = true;
      if (hint) hint.textContent = 'กรุณาเลือกสาขาก่อน ระบบจะแสดงเฉพาะใบกำกับภาษีของสาขานั้น';
      return;
    }
    select.disabled = false;
    const yearInput = Number(value('cn-inv-filter-year'));
    const years = Number.isFinite(yearInput) && yearInput >= 2020 && yearInput <= 2100 ? [yearInput] : knownYears();
    const monthValue = value('cn-inv-filter-month');
    const months = monthValue === '' ? ALL_MONTHS : [Number(monthValue)];
    const search = value('cn-inv-filter-search').toLowerCase();
    const chosen = new Set(form.lines.map(line => lineKey(line.ref)));
    const customer = selectedCustomer(), vatMode = selectedVatMode();
    const business = window.ERPIntegrity?.business?.();
    // Runs on every keystroke: ONE payment context (business + order-flow store + index) for
    // all rows, instead of re-reading the store and scanning every receipt per invoice.
    const payment = !business ? {} : typeof window.ERPIntegrity?.paymentContext === 'function' ? window.ERPIntegrity.paymentContext(business) : { business };
    const creditNotes = scanRows('creditNotes');
    const exclude = form.edit ? String(form.edit.id) : '';
    let shown = 0;
    for (const year of years) for (const month of months) {
      for (const inv of readPack(form.branch, year, month, false).invoices || []) {
        if (inv.voided || inv.cancelled || inv.status === 'cancelled') continue;
        const ref = { branch: form.branch, year, month, id: inv.id ?? '', no: inv.no || '' };
        if (chosen.has(lineKey(ref))) continue;
        const haystack = [inv.no, inv.customer, inv.salesPerson, inv.date, ...(inv.items || []).map(item => item.product)].join(' ').toLowerCase();
        if (search && !haystack.includes(search)) continue;
        const target = { ...inv, branch: form.branch };
        const basis = creditNoteInvoiceBasis(target);
        const prior = creditedByInvoice(target, creditNotes, { excludeCreditNoteId: exclude });
        const remaining = roundMoneyValue(basis.amount - prior.amount);
        const summary = window.ERPIntegrity?.paymentSummary?.(target, payment);
        const reasons = [];
        if (remaining <= 0) reasons.push('ลดหนี้เต็มจำนวนแล้ว');
        if (customer && String(inv.customer || '').trim().toLowerCase() !== customer) reasons.push('ลูกค้าต่างราย');
        if (vatMode && creditNoteVatModeOf(inv) !== vatMode) reasons.push('รูปแบบ VAT ต่างกัน');
        const status = summary?.status === 'credited' ? 'ลดหนี้เต็มจำนวน' : summary?.status === 'paid' ? 'ชำระแล้ว' : summary?.status === 'partially_paid' ? 'ชำระบางส่วน' : 'รอชำระ';
        const option = document.createElement('option');
        option.value = JSON.stringify(ref);
        option.textContent = `${inv.no || '-'} | ${inv.customer || '-'} | ${formatDate(inv.date)} | ยอด ฿${fmt(basis.total)}${prior.total > 0 ? ` | ลดหนี้แล้ว ฿${fmt(prior.total)}` : ''} | ${status}${reasons.length ? ` · ${reasons.join(' · ')}` : ''}`;
        option.disabled = reasons.length > 0;
        select.appendChild(option);
        shown += 1;
      }
    }
    if ([...select.options].some(option => option.value === previous && !option.disabled)) select.value = previous;
    if (hint) hint.textContent = `พบใบกำกับภาษี ${shown} รายการ${search ? ` (ค้นหา: ${search})` : ''} — เลือกได้หลายใบ ต้องเป็นลูกค้ารายเดียวกันและรูปแบบ VAT เดียวกัน`;
  }
  function addSelectedInvoice() {
    if (!form.branch) form.branch = defaultBranch();
    if (!form.branch) { $('cn-br-warn')?.classList.add('show'); notifyUser('กรุณาเลือกสาขาก่อนเลือกใบกำกับภาษี'); return; }
    const raw = $('cn-inv-ref')?.value || '';
    if (!raw) { notifyUser('กรุณาเลือกใบกำกับภาษีจากรายการก่อนกดเพิ่ม'); return; }
    let ref;
    try { ref = JSON.parse(raw); } catch (error) { console.warn('[CreditNote] invalid invoice option', error); return; }
    if (ref.branch !== form.branch) { notifyUser('ใบกำกับภาษีที่เลือกอยู่คนละสาขากับใบลดหนี้'); return; }
    if (form.lines.some(line => lineKey(line.ref) === lineKey(ref))) { notifyUser('เลือกใบกำกับภาษีนี้ไว้แล้ว'); return; }
    form.lines.push({ ref: { branch: ref.branch, year: Number(ref.year), month: Number(ref.month), id: ref.id ?? '', no: ref.no || '' }, differenceAmount: null });
    refreshContext();
    if (form.lines.length === 1) applyCustomerFromInvoice(form.context[0]?.invoice || null);
    renderAll();
  }
  function removeLine(index) {
    const line = form.lines[index];
    if (!line) return;
    form.lines.splice(index, 1);
    // Returned-goods rows of the removed invoice are dropped by renderReturnItems(),
    // which keeps only rows whose product still belongs to a referenced invoice.
    refreshContext();
    if (!form.lines.length) applyCustomerFromInvoice(null);
    renderAll();
  }
  function applyCustomerFromInvoice(invoice) {
    // A walk-in abbreviated invoice has no buyer: leave the name empty so the
    // user types the real buyer instead of saving "ลูกค้าทั่วไป" on a §86/10 note.
    setValue('cn-cust', invoice && !taxInvoiceLacksBuyer(invoice) ? invoice.customer || '' : '');
    setValue('cn-address', invoice ? (invoice.customerAddress || invoice.address || '') : '');
    // Buyer head office / branch (§86/10 buyer identity): from the invoice when it carries
    // one, otherwise from the customer master; left empty when nothing is recorded.
    const master = invoice && !taxInvoiceLacksBuyer(invoice) ? window.findContactMaster?.(invoice.customer, 'customer') : null;
    setValue('cn-tax-id', invoice?.customerTaxId || master?.taxId || '');
    setValue('cn-buyer-branch', invoice ? (invoice.customerBranch || creditNoteBuyerBranchLabel({ branchCode: invoice.customerBranchCode, branchName: invoice.customerBranchName }) || creditNoteBuyerBranchLabel(master || {})) : '');
  }
  // An issued note is edited only for non-financial text; everything that would
  // change the tax document is locked (void and reissue instead).
  const EDIT_LOCKED_ACTIONS = new Set(['branch', 'add-invoice', 'remove-line', 'add-return', 'remove-return', 'refresh-refs']);
  function applyEditLock() {
    const locked = !!form.edit;
    ['cn-no', 'cn-date', 'cn-tax-id', 'cn-reason-text', 'cn-inv-filter-year', 'cn-inv-filter-search'].forEach(id => { const el = $(id); if (el) el.readOnly = locked; });
    ['cn-reason', 'cn-inv-ref', 'cn-inv-filter-month'].forEach(id => { const el = $(id); if (el) el.disabled = locked; });
    document.querySelectorAll('#cn-form-card .doc-number-auto-btn, #cn-form-card [data-cn-action="add-invoice"], #cn-form-card [data-cn-action="refresh-refs"], #cn-form-card [data-cn-action="remove-line"], #cn-form-card [data-cn-action="add-return"], #cn-form-card [data-cn-action="remove-return"], #cn-lines-body input, #cn-return-body input, #cn-return-body select').forEach(el => { el.disabled = locked; });
    const hint = $('cn-edit-lock-hint');
    if (hint) hint.textContent = locked ? 'ใบลดหนี้ที่ออกแล้วแก้ไขได้เฉพาะหมายเหตุ ที่อยู่ และสาขาของผู้ซื้อ — หากต้องแก้เลขที่ วันที่ ใบกำกับภาษีที่อ้างอิง ยอดเงิน/VAT สาเหตุ หรือสินค้าที่รับคืน กรุณายกเลิกใบลดหนี้นี้แล้วออกใบลดหนี้ใหม่' : '';
  }
  // The buyer name is read-only (copied from the invoice) except when a
  // referenced abbreviated tax invoice has no buyer — then it must be typed
  // (same rule as validateCreditNote, via creditNoteRequiresBuyerName).
  function syncBuyerField() {
    const input = $('cn-cust');
    if (!input) return;
    const editable = !form.edit && creditNoteRequiresBuyerName(form.context.map(row => row.invoice).filter(Boolean));
    input.readOnly = !editable;
    input.classList.toggle('ro', !editable);
    input.placeholder = editable ? 'ใบกำกับภาษีอย่างย่อไม่มีชื่อผู้ซื้อ — กรุณากรอกชื่อผู้ซื้อ (มาตรา 86/10)' : 'ดึงจากใบกำกับภาษีเดิม';
  }

  // ------------------------------------------------------------ lines/table
  function computeForm() {
    return calculateCreditNote({
      vatMode: selectedVatMode() || undefined,
      lines: form.lines.map((line, index) => ({
        invoice: form.context[index]?.invoice || {},
        differenceAmount: line.differenceAmount === null ? '' : line.differenceAmount,
        priorCredited: form.context[index]?.prior || {}
      }))
    });
  }
  function renderChips() {
    const box = $('cn-inv-chips');
    if (!box) return;
    box.innerHTML = form.lines.length
      ? form.lines.map((line, index) => `<span class="cn-chip">🧾 ${escapeHtml(line.ref.no || String(line.ref.id))}<button type="button" data-cn-action="remove-line" data-index="${index}" aria-label="นำใบกำกับภาษี ${escapeHtml(line.ref.no || '')} ออก">×</button></span>`).join('')
      : '<span class="cn-chip-empty">ยังไม่ได้เลือกใบกำกับภาษีเดิม</span>';
  }
  function renderLines(calc = computeForm()) {
    const body = $('cn-lines-body');
    if (!body) return;
    if (!form.lines.length) {
      body.innerHTML = '<tr><td colspan="8" class="cn-empty-row">เลือกใบกำกับภาษีเดิมจากรายการด้านบน แล้วกด “เพิ่มใบกำกับภาษี”</td></tr>';
      return;
    }
    body.innerHTML = form.lines.map((line, index) => {
      const row = calc.lines[index];
      const invoice = form.context[index]?.invoice;
      if (!invoice) return `<tr class="cn-line-missing"><td colspan="7">ไม่พบใบกำกับภาษี ${escapeHtml(line.ref.no || String(line.ref.id))} (อาจถูกลบหรือย้ายเดือน)</td><td><button type="button" class="btn btn-danger btn-sm" data-cn-action="remove-line" data-index="${index}">×</button></td></tr>`;
      return `<tr data-cn-line="${index}">
        <td><b>${escapeHtml(row.invoiceNo)}</b></td>
        <td>${escapeHtml(formatDate(row.invoiceDate))}</td>
        <td class="tn">฿${fmt(row.invoiceAmount)}</td>
        <td class="tn">${row.priorCreditedAmount > 0 ? `฿${fmt(row.priorCreditedAmount)}` : '-'}</td>
        <td class="tn"><b>฿${fmt(row.originalAmount)}</b></td>
        <td><input type="number" step="0.01" min="0" inputmode="decimal" data-cn-line-field="correct" data-index="${index}" value="${line.differenceAmount === null ? '' : moneyInput(row.correctAmount)}" aria-label="มูลค่าที่ถูกต้องของ ${escapeHtml(row.invoiceNo)}"></td>
        <td><input type="number" step="0.01" min="0" inputmode="decimal" data-cn-line-field="diff" data-index="${index}" value="${line.differenceAmount === null ? '' : moneyInput(line.differenceAmount)}" aria-label="ยอดที่ลดลงของ ${escapeHtml(row.invoiceNo)}"><small class="cn-line-note" data-cn-line-note="${index}"></small></td>
        <td><button type="button" class="btn btn-danger btn-sm" data-cn-action="remove-line" data-index="${index}" title="นำออก">×</button></td>
      </tr>`;
    }).join('');
  }
  function updateTotals(calc = computeForm()) {
    const vatMode = selectedVatMode();
    setValue('cn-vat-mode', vatMode ? CREDIT_NOTE_VAT_MODE_LABELS[vatMode] : '');
    setValue('cn-original-value', form.lines.length ? fmt(calc.originalValue) : '');
    setValue('cn-correct-value', form.lines.length ? fmt(calc.correctValue) : '');
    setValue('cn-diff', form.lines.length ? fmt(calc.subtotal) : '');
    setValue('cn-vat-amt', form.lines.length ? fmt(calc.vatAmt) : '');
    setValue('cn-total', form.lines.length ? fmt(calc.total) : '');
    setValue('cn-baht-text', calc.total > 0 ? bahtText(calc.total) : '');
    calc.lines.forEach((row, index) => {
      const note = document.querySelector(`[data-cn-line-note="${index}"]`);
      if (note) note.textContent = form.lines[index]?.differenceAmount === null ? '' : `ก่อน VAT ฿${fmt(row.difference)} · VAT ฿${fmt(row.vatOnDifference)} · รวม ฿${fmt(row.total)}`;
    });
    const hint = $('cn-basis-hint');
    if (hint) hint.textContent = vatMode === 'extract'
      ? 'ใบกำกับภาษีเดิมเป็นราคารวม VAT — ช่องในตารางจึงเป็นยอดรวม VAT ระบบถอดภาษีจากผลต่างรวมของทั้งเอกสารครั้งเดียว'
      : vatMode === 'add'
        ? 'ใบกำกับภาษีเดิมเป็นราคายังไม่รวม VAT — ช่องในตารางเป็นมูลค่าก่อน VAT ระบบคำนวณ VAT 7% จากผลต่างรวมของทั้งเอกสารครั้งเดียว'
        : vatMode === 'none' ? 'ใบกำกับภาษีเดิมไม่มี VAT — ผลต่างไม่มีภาษีมูลค่าเพิ่ม' : 'ตัวเลขในตารางใช้ฐานราคาเดียวกับใบกำกับภาษีเดิม';
  }
  function onLineInput(input) {
    const index = Number(input.dataset.index);
    const line = form.lines[index];
    const context = form.context[index];
    if (!line || !context?.invoice) return;
    const originalAmount = roundMoneyValue(creditNoteInvoiceBasis(context.invoice).amount - Number(context.prior?.amount || 0));
    const parsed = creditNoteParseAmount(input.value);
    const other = document.querySelector(`[data-cn-line-field="${input.dataset.cnLineField === 'correct' ? 'diff' : 'correct'}"][data-index="${index}"]`);
    if (!Number.isFinite(parsed)) {
      line.differenceAmount = null;
      if (other) other.value = '';
    } else if (input.dataset.cnLineField === 'correct') {
      line.differenceAmount = roundMoneyValue(originalAmount - parsed);
      if (other) other.value = moneyInput(line.differenceAmount);
    } else {
      line.differenceAmount = roundMoneyValue(parsed);
      if (other) other.value = moneyInput(originalAmount - line.differenceAmount);
    }
    updateTotals();
  }

  // ------------------------------------------------------- returned goods
  // Trimmed exactly like buildCreditNoteRecord() stores return items, so the key of
  // an invoice item with stray spaces ('สินค้า A ') equals the key rebuilt from the
  // stored note on edit; otherwise the stored row is dropped as "no longer valid".
  function returnItemKey(item) {
    const text = field => String(field ?? '').trim();
    return JSON.stringify({ invoiceBranch: text(item.invoiceBranch), invoiceId: text(item.invoiceId), invoiceNo: text(item.invoiceNo), productCode: text(item.productCode), product: text(item.product), unit: text(item.unit) });
  }
  function returnProductOptions() {
    const options = [];
    form.lines.forEach((line, index) => {
      const invoice = form.context[index]?.invoice;
      if (!invoice) return;
      const merged = new Map();
      for (const item of invoice.items || []) {
        const key = creditNoteProductKey(item);
        if (!key) continue;
        const current = merged.get(key) || { invoiceBranch: line.ref.branch, invoiceId: invoice.id ?? '', invoiceNo: invoice.no || '', productCode: item.productCode || '', product: item.product || '', unit: item.unit || '', qty: 0 };
        current.qty += Number(item.qty) || 0;
        merged.set(key, current);
      }
      merged.forEach(item => options.push({ key: returnItemKey(item), label: `${item.invoiceNo} · ${item.product || item.productCode} (ขาย ${fmt(item.qty)} ${item.unit || ''})`, item }));
    });
    return options;
  }
  function renderReturnItems() {
    const section = $('cn-return-section'), body = $('cn-return-body');
    const active = isCreditNoteReturnReason(value('cn-reason'));
    if (section) section.hidden = !active;
    if (!body) return;
    if (!active) { body.innerHTML = ''; return; }
    const options = returnProductOptions();
    const validKeys = new Set(options.map(option => option.key));
    form.returnItems = form.returnItems.filter(row => !row.key || validKeys.has(row.key));
    body.innerHTML = form.returnItems.length ? form.returnItems.map((row, index) => {
      const selected = options.find(option => option.key === row.key);
      return `<tr>
        <td><select data-cn-return-field="product" data-index="${index}"><option value="">-- เลือกสินค้าจากใบกำกับภาษี --</option>${options.map(option => `<option value="${escapeHtml(option.key)}"${option.key === row.key ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select></td>
        <td><input type="number" min="0" step="0.01" inputmode="decimal" data-cn-return-field="qty" data-index="${index}" value="${row.qty === null || row.qty === undefined ? '' : escapeHtml(String(row.qty))}"></td>
        <td>${escapeHtml(selected?.item.unit || '-')}</td>
        <td><button type="button" class="btn btn-danger btn-sm" data-cn-action="remove-return" data-index="${index}">×</button></td>
      </tr>`;
    }).join('') : `<tr><td colspan="4" class="cn-empty-row">${options.length ? 'กด “+ เพิ่มสินค้าที่รับคืน” เพื่อคืนสินค้าเข้าสต็อก' : 'เลือกใบกำกับภาษีเดิมก่อน'}</td></tr>`;
  }
  function collectReturnItems() {
    if (!isCreditNoteReturnReason(value('cn-reason'))) return [];
    // Rows without a chosen product are kept so validation can name them instead
    // of silently dropping a return line the user started.
    return form.returnItems.map(row => {
      let item = {};
      if (row.key) { try { item = JSON.parse(row.key); } catch (error) { console.warn('[CreditNote] invalid return item', error); } }
      return { ...item, qty: row.qty };
    });
  }

  // ----------------------------------------------------------- form state
  function renderAll() {
    if (!form.branch && !form.edit) form.branch = defaultBranch();
    applyBranchClasses();
    syncBuyerField();
    renderChips();
    const calc = computeForm();
    renderLines(calc);
    updateTotals(calc);
    renderReturnItems();
    populateInvoiceOptions();
    applyEditLock();
  }
  function showFeedback(errors = [], warnings = []) {
    const box = $('cn-feedback');
    if (!box) return;
    const rows = [...errors.map(text => `<li>⛔ ${escapeHtml(text)}</li>`), ...warnings.map(text => `<li>⚠️ ${escapeHtml(text)}</li>`)];
    box.hidden = !rows.length;
    box.className = `erp-flow-callout ${errors.length ? 'tone-red' : 'tone-amber'}`;
    box.innerHTML = rows.length ? `<ul class="cn-feedback-list">${rows.join('')}</ul>` : '';
  }
  function setEditBanner() {
    const banner = $('cn-edit-banner'), button = $('cn-save-btn');
    if (banner) {
      banner.style.display = form.edit ? 'flex' : 'none';
      const label = banner.querySelector('[data-edit-label]');
      if (label) label.textContent = form.edit ? `กำลังแก้ไขใบลดหนี้: ${form.edit.no || form.edit.id}` : '';
    }
    if (button) button.innerHTML = icon('save') + (form.edit ? 'บันทึกการแก้ไข' : SAVE_LABEL);
  }
  function refreshNumber(force) {
    if (typeof window.refreshAutoDocumentNumber === 'function') return window.refreshAutoDocumentNumber('creditNote', force);
    return value('cn-no');
  }
  function resetForm() {
    form.lines = []; form.context = []; form.returnItems = []; form.edit = null;
    form.branch = defaultBranch();
    ['cn-cust', 'cn-address', 'cn-tax-id', 'cn-buyer-branch', 'cn-reason', 'cn-reason-text', 'cn-note', 'cn-inv-filter-search'].forEach(id => setValue(id, ''));
    setValue('cn-date', localDateISO());
    setValue('cn-inv-filter-year', String(new Date().getFullYear()));
    setValue('cn-inv-filter-month', '');
    const noEl = $('cn-no');
    if (noEl) { noEl.dataset.manualNumber = '0'; noEl.dataset.autoNumber = '1'; noEl.classList.remove('document-number-manual'); }
    refreshNumber(true);
    showFeedback();
    setEditBanner();
    renderAll();
  }
  function collectDraft() {
    return {
      id: form.edit ? form.edit.id : undefined,
      no: value('cn-no'),
      date: value('cn-date'),
      branch: form.branch,
      customer: value('cn-cust'),
      customerAddress: String($('cn-address')?.value ?? '').trim(),
      customerTaxId: value('cn-tax-id'),
      customerBranch: value('cn-buyer-branch'),
      reasonCode: value('cn-reason'),
      reasonText: String($('cn-reason-text')?.value ?? '').trim(),
      note: value('cn-note'),
      lines: form.lines.map(line => ({ invoiceId: line.ref.id, invoiceNo: line.ref.no, invoiceBranch: line.ref.branch, differenceAmount: line.differenceAmount === null ? '' : line.differenceAmount })),
      returnItems: collectReturnItems()
    };
  }

  // ------------------------------------------------------------------ save
  function auditEvent(action, record, detail) {
    try { window.ERPProductionCore?.audit?.(action, 'creditNote', record.no || String(record.id), detail, { branch: record.branch, entityId: String(record.id) }); }
    catch (error) { console.warn('[CreditNote] audit log write failed (document already saved)', error); }
  }
  function rerenderDependents() {
    try { renderList(); } catch (error) { console.warn('[CreditNote] list render failed', error); }
    for (const name of ['renderIList', 'renderDash', 'renderRList']) {
      try { window[name]?.(); } catch (error) { console.warn(`[CreditNote] ${name} refresh failed`, error); }
    }
  }
  async function saveUnlocked() {
    const branch = lockedBranch() || form.branch || defaultBranch();
    if (!branch) { $('cn-br-warn')?.classList.add('show'); notifyUser('กรุณาเลือกสาขาก่อนบันทึกใบลดหนี้'); return false; }
    const edit = form.edit;
    if (edit && edit.branch !== branch) { notifyUser('ไม่สามารถเปลี่ยนสาขาระหว่างแก้ไขใบลดหนี้ได้'); return false; }
    if (!value('cn-no') && !edit) refreshNumber(true);
    const draft = { ...collectDraft(), branch };
    const result = await runDocumentAction({
      action: edit ? 'credit_note_edit' : 'credit_note_create',
      context: {},
      validate: () => {
        const session = window.ComformDocumentWriteStore.createSession();
        if (edit) {
          // Issued note: only non-financial text may change (same pack, same number/date).
          const original = (session.get(edit.branch, edit.year, edit.month).creditNotes || []).find(row => String(row.id) === String(edit.id)) || null;
          if (!original) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.DEPENDENCY, 'ไม่พบใบลดหนี้เดิมในเครื่อง กรุณารีเฟรชแล้วลองใหม่');
          const applied = applyCreditNoteEdit(original, draft, { user: userLabel() });
          if (applied.errors.length) {
            const error = new FinanceActionError(FINANCE_ACTION_ERROR_CODES.PERMISSION, applied.errors.join('\n'));
            error.details = { errors: applied.errors, warnings: [] };
            throw error;
          }
          window.ERPGovernance?.assertPeriodOpen?.({ branch, date: original.date, scope: 'sales', action: 'credit_note_edit' });
          return { period: { year: edit.year, month: edit.month }, session, original, record: applied.record, validation: { warnings: [] } };
        }
        const period = periodOf(draft.date);
        if (!period) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, 'กรุณาระบุวันที่ใบลดหนี้ให้ถูกต้อง');
        window.ERPGovernance?.assertPeriodOpen?.({ branch, date: draft.date, scope: 'sales', action: 'credit_note_create' });
        const original = null;
        const invoices = scanRows('invoices', { strict: true, branches: [branch] });
        const existing = scanRows('creditNotes', { strict: true, branches: ['ubon', 'khonkaen'] });
        const business = window.ERPIntegrity?.business?.();
        const validation = validateCreditNote(draft, invoices, existing, [], {
          original,
          paidByInvoice: invoice => window.ERPIntegrity?.paymentSummary?.(invoice, business ? { business } : {})?.paid || 0
        });
        if (!validation.ok) {
          const error = new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, validation.errors.join('\n'));
          error.details = { errors: validation.errors, warnings: validation.warnings };
          throw error;
        }
        return { period, session, validation, original };
      },
      plan: ctx => {
        if (ctx.record) return ctx; // edit: record already built by applyCreditNoteEdit()
        const at = new Date().toISOString();
        const base = buildCreditNoteRecord(draft, ctx.validation, {
          id: ctx.original ? ctx.original.id : Date.now(),
          at,
          createdAt: ctx.original?.createdAt,
          createdBy: ctx.original?.createdBy || userLabel(),
          user: userLabel()
        });
        const record = withThaiCalendarMeta({ ...base, editCount: ctx.original ? Number(ctx.original.editCount || 0) + 1 : 0 }, ctx.period.year, ctx.period.month);
        return { ...ctx, record };
      },
      commit: ctx => {
        const { session, period, record } = ctx;
        if (edit) {
          const oldPack = session.get(edit.branch, edit.year, edit.month);
          const index = (oldPack.creditNotes || []).findIndex(row => String(row.id) === String(edit.id));
          if (index < 0) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, 'ใบลดหนี้เดิมเปลี่ยนแปลงระหว่างบันทึก กรุณาลองใหม่');
          oldPack.creditNotes[index] = record;
          session.mark(edit.branch, edit.year, edit.month);
        } else {
          const pack = session.get(branch, period.year, period.month);
          pack.creditNotes = Array.isArray(pack.creditNotes) ? pack.creditNotes : [];
          pack.creditNotes.push(record);
          session.mark(branch, period.year, period.month);
        }
        try { session.commit(); } catch (error) { throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.STORAGE, error?.message || 'บันทึกใบลดหนี้ในเครื่องไม่สำเร็จ'); }
        window.ERPIntegrity?.changed?.();
        return ctx;
      },
      afterCommit: ctx => {
        const record = ctx.record;
        auditEvent(edit ? 'update' : 'create', record, `${edit ? 'แก้ไขข้อมูลประกอบ (หมายเหตุ/ที่อยู่/สาขาผู้ซื้อ) ของ' : 'ออก'}ใบลดหนี้ อ้างอิง ${record.invoiceNos.join(', ')} · ลดหนี้ ${fmt(record.total)} บาท (VAT ${fmt(record.vatAmt)}) · ${record.reasonLabel}`);
        resetForm();
        rerenderDependents();
        return ctx;
      }
    });
    if (!result.ok) {
      const feedback = documentActionFeedback(result);
      showFeedback(result.details?.errors || [feedback.message], result.details?.warnings || []);
      notifyUser(feedback.text, feedback.type === 'warning' ? 'info' : 'error');
      return false;
    }
    const warnings = result.value?.validation?.warnings || [];
    const record = result.value.record;
    notifyUser(`${edit ? 'แก้ไข' : 'บันทึก'}ใบลดหนี้ ${record.no} เรียบร้อย · ลดหนี้ ${fmt(record.total)} บาท${warnings.length ? `\n⚠️ ${warnings.join('\n⚠️ ')}` : ''}`, warnings.length ? 'info' : 'success');
    return record;
  }
  async function saveCreditNote() {
    if (form.saving) { notifyUser('กำลังบันทึกใบลดหนี้อยู่ กรุณารอสักครู่', 'info'); return false; }
    form.saving = true;
    const button = $('cn-save-btn');
    if (button) button.disabled = true;
    // Same lease as invoice/receipt saves: all three change the invoice's credited/outstanding balance.
    try { return await withDemoWriteLease(SALES_LEDGER_WRITE_LEASE, saveUnlocked); }
    catch (error) { console.warn('[ERP DEMO] credit note write lease', error); notifyUser(error?.message || 'ยังบันทึกใบลดหนี้ไม่ได้ กรุณาลองใหม่'); return false; }
    finally { form.saving = false; if (button) button.disabled = false; }
  }

  // ------------------------------------------------------------ edit/void
  function findStored(branch, year, month, id) {
    const pack = readPack(branch, Number(year), Number(month), false);
    const record = (pack.creditNotes || []).find(row => String(row.id) === String(id));
    return record ? { ...record, branch, _branch: branch, _year: Number(year), _month: Number(month) } : null;
  }
  function editCreditNote(branch, year, month, id) {
    const record = findStored(branch, year, month, id);
    if (!record) { notifyUser('ไม่พบใบลดหนี้ที่ต้องการแก้ไข'); return false; }
    if (!isCreditNoteLive(record)) { notifyUser('ใบลดหนี้นี้ถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้'); return false; }
    resetForm();
    form.edit = { branch, year: Number(year), month: Number(month), id: record.id, no: record.no, date: record.date };
    form.branch = branch;
    form.lines = (record.lines || []).map(line => ({
      ref: { branch: line.invoiceBranch || branch, year: Number(line.invoiceYear), month: Number(line.invoiceMonth), id: line.invoiceId ?? '', no: line.invoiceNo || '' },
      differenceAmount: Number.isFinite(Number(line.differenceAmount)) ? roundMoneyValue(line.differenceAmount) : null
    }));
    form.returnItems = (record.returnItems || []).map(item => ({ key: returnItemKey(item), qty: item.qty }));
    refreshContext();
    setValue('cn-no', record.no);
    const noEl = $('cn-no');
    if (noEl) { noEl.dataset.manualNumber = '1'; noEl.dataset.autoNumber = '0'; noEl.classList.add('document-number-manual'); }
    setValue('cn-date', record.date);
    setValue('cn-cust', record.customer);
    setValue('cn-address', record.customerAddress);
    setValue('cn-tax-id', record.customerTaxId);
    setValue('cn-buyer-branch', record.customerBranch);
    setValue('cn-reason', record.reasonCode);
    setValue('cn-reason-text', record.reasonText);
    setValue('cn-note', record.note);
    setEditBanner();
    renderAll();
    navigate('credit-note-form');
    return true;
  }
  // Voiding a returned-goods note takes the returned quantity back out of stock. Like
  // reversing a goods receipt (reverseGr), refuse when that stock is no longer available.
  function returnedStockShortages(record, branch) {
    if (!isCreditNoteReturnReason(record.reasonCode)) return [];
    const products = typeof window.productMasterRows === 'function' ? window.productMasterRows() : [];
    const needed = new Map();
    for (const item of Array.isArray(record.returnItems) ? record.returnItems : []) {
      // Same normaliser as the stock ledger (productSoldQty in app.js), so a return of
      // 'สินค้า  A' is checked against the same master product it is returned to.
      const code = normalizeProductKey(item.productCode), name = normalizeProductKey(item.product);
      const product = products.find(p => (code && normalizeProductKey(p.code) === code) || (name && normalizeProductKey(p.name) === name));
      if (!product) continue; // not a stock-tracked master product: no stock effect
      const entry = needed.get(product) || { product, qty: 0 };
      entry.qty += Number(item.qty) || 0;
      needed.set(product, entry);
    }
    const rows = [];
    needed.forEach(({ product, qty }) => {
      const available = Number(window.ERPIntegrity?.availableStock?.(product, branch)) || 0;
      if (available < qty - 0.000001) rows.push(`${product.name || product.code}: รับคืน ${fmt(qty)} แต่คงเหลือพร้อมใช้ ${fmt(available)} ${product.unit || ''}`.trim());
    });
    return rows;
  }
  // ภ.พ.30 for a month is filed by the 15th of the next month, and period locks are optional:
  // voiding a note dated in an earlier month than today changes that month's output VAT after
  // it may already have been filed, so the user must confirm explicitly. Returns false if declined.
  function confirmPastVatMonthVoid(record) {
    const period = periodOf(record.date), today = periodOf(localDateISO());
    if (!period || !today || period.year * 12 + period.month >= today.year * 12 + today.month) return true;
    const monthText = `${MONTH_LABELS[period.month]} พ.ศ. ${period.year + 543}`;
    return window.confirm(`⚠️ ใบลดหนี้ ${record.no} ลงวันที่ ${formatDate(record.date)} อยู่ในเดือนภาษี ${monthText} ซึ่งผ่านไปแล้ว

`
      + `การยกเลิกจะทำให้ยอดขายและภาษีขายของเดือน ${monthText} เปลี่ยนไป (ภาษีขายเพิ่มขึ้น ${fmt(record.vatAmt)} บาท ตาม VAT ในใบลดหนี้นี้) `
      + `หากยื่นแบบ ภ.พ.30 ของเดือนนั้นแล้ว (กำหนดยื่นภายในวันที่ 15 ของเดือนถัดไป) ต้องยื่นแบบ ภ.พ.30 เพิ่มเติม (ยื่นเพิ่มเติม) เพื่อแก้ไขยอดภาษีขาย และอาจมีเงินเพิ่ม/เบี้ยปรับ

`
      + 'ต้องการยกเลิกใบลดหนี้นี้ต่อหรือไม่?') === true;
  }
  async function voidUnlocked(branch, year, month, id, reason) {
    let declined = false;
    const result = await runDocumentAction({
      action: 'credit_note_void',
      context: {},
      validate: () => {
        const text = String(reason ?? '').trim();
        if (!text) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, 'กรุณาระบุเหตุผลการยกเลิกใบลดหนี้');
        const session = window.ComformDocumentWriteStore.createSession();
        const record = (session.get(branch, Number(year), Number(month)).creditNotes || []).find(row => String(row.id) === String(id));
        if (!record) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.DEPENDENCY, 'ไม่พบใบลดหนี้ที่ต้องการยกเลิก');
        if (!isCreditNoteLive(record)) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, 'ใบลดหนี้นี้ถูกยกเลิกไปแล้ว');
        window.ERPGovernance?.assertPeriodOpen?.({ branch, date: record.date, scope: 'sales', action: 'credit_note_void' });
        const shortages = returnedStockShortages(record, branch);
        if (shortages.length) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, `ไม่สามารถยกเลิกใบลดหนี้ ${record.no} ได้ เพราะสินค้าที่รับคืนถูกขายหรือจองไปแล้ว หากยกเลิกสต็อกจะติดลบ:\n${shortages.join('\n')}`);
        if (!confirmPastVatMonthVoid(record)) { declined = true; throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, 'ยังไม่ได้ยกเลิกใบลดหนี้'); }
        return { session, record, text };
      },
      commit: ctx => {
        Object.assign(ctx.record, { voided: true, status: 'voided', voidedAt: new Date().toISOString(), voidedBy: userLabel(), voidReason: ctx.text, updatedAt: new Date().toISOString() });
        ctx.session.mark(branch, Number(year), Number(month));
        try { ctx.session.commit(); } catch (error) { throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.STORAGE, error?.message || 'ยกเลิกใบลดหนี้ในเครื่องไม่สำเร็จ'); }
        window.ERPIntegrity?.changed?.();
        return ctx;
      },
      afterCommit: ctx => {
        auditEvent('void', { ...ctx.record, branch }, `ยกเลิกใบลดหนี้ (เก็บเลขที่ไว้ ไม่ลบเอกสาร) · เหตุผล: ${ctx.text}`);
        if (form.edit && String(form.edit.id) === String(id)) resetForm();
        rerenderDependents();
        return ctx;
      }
    });
    if (declined) { notifyUser('ยังไม่ได้ยกเลิกใบลดหนี้ (ผู้ใช้ไม่ยืนยันการยกเลิกย้อนหลังเดือนภาษี)', 'info'); return false; }
    if (!result.ok) { const feedback = documentActionFeedback(result); notifyUser(feedback.text, 'error'); return false; }
    notifyUser(`ยกเลิกใบลดหนี้ ${result.value.record.no} เรียบร้อย ยอดคงค้างของใบกำกับภาษีถูกคำนวณใหม่แล้ว`, 'success');
    return true;
  }
  async function voidCreditNote(branch, year, month, id, reason) {
    try { return await withDemoWriteLease(SALES_LEDGER_WRITE_LEASE, () => voidUnlocked(branch, year, month, id, reason)); }
    catch (error) { console.warn('[ERP DEMO] credit note void lease', error); notifyUser(error?.message || 'ยังยกเลิกใบลดหนี้ไม่ได้ กรุณาลองใหม่'); return false; }
  }
  function askVoid(branch, year, month, id) {
    const record = findStored(branch, year, month, id);
    if (!record) { notifyUser('ไม่พบใบลดหนี้ที่ต้องการยกเลิก'); return; }
    // Closed period: refused before the reason prompt (ADR-018); voidUnlocked() still re-checks.
    const lockRefusal = window.ERPGovernance?.periodLockRefusal?.({ type: 'creditNotes', branch, date: record.date, action: 'credit_note_void' });
    if (lockRefusal) { notifyUser(lockRefusal, 'error'); return; }
    const reason = typeof window.prompt === 'function' ? window.prompt(`ยกเลิกใบลดหนี้ ${record.no}? เอกสารจะถูกเก็บไว้พร้อมสถานะ “ยกเลิก” (ไม่ลบเลขที่)\nกรุณาระบุเหตุผล:`) : null;
    if (reason === null || reason === undefined) return;
    return voidCreditNote(branch, year, month, id, reason);
  }

  // ------------------------------------------------------------- preview
  function previewDraft() {
    if (!form.lines.length) { notifyUser('กรุณาเลือกใบกำกับภาษีเดิมอย่างน้อย 1 ใบก่อนดูตัวอย่าง'); return; }
    const branch = lockedBranch() || form.branch;
    const draft = { ...collectDraft(), branch };
    const validation = validateCreditNote(draft, scanRows('invoices', { branches: [branch] }), scanRows('creditNotes', { branches: ['ubon', 'khonkaen'] }), []);
    if (!validation.ok) { showFeedback(validation.errors, validation.warnings); notifyUser(`ยังเปิดตัวอย่างไม่ได้:\n${validation.errors.join('\n')}`); return; }
    showFeedback([], validation.warnings);
    openDocument(buildCreditNoteRecord(draft, validation, { id: 'preview-credit-note' }), { previewOnly: true });
  }
  function openDocument(record, options = {}) {
    if (!window.ComformCreditNoteDocument?.openPreview) { notifyUser('ไม่พบโมดูลเอกสารใบลดหนี้ กรุณาโหลดหน้าเว็บใหม่'); return; }
    window.ComformCreditNoteDocument.openPreview(record, options);
  }
  function previewStored(branch, year, month, id) {
    const record = findStored(branch, year, month, id);
    if (!record) { notifyUser('ไม่พบใบลดหนี้นี้'); return; }
    openDocument(record);
  }

  // ---------------------------------------------------------------- list
  function populateYearSelect(id) {
    const el = $(id);
    if (!el) return;
    const current = el.value;
    el.innerHTML = knownYears().map(year => `<option value="${year}">พ.ศ. ${year + 543} (${year})</option>`).join('');
    el.value = current && [...el.options].some(option => option.value === current) ? current : String(new Date().getFullYear());
  }
  function renderList() {
    const body = $('cnltbl');
    if (!body) return;
    populateYearSelect('cnl-year');
    populateMonthSelect('cnl-month');
    const locked = lockedBranch();
    const branchEl = $('cnl-br');
    if (branchEl && locked) { branchEl.value = locked; branchEl.disabled = true; }
    const branches = locked ? [locked] : (value('cnl-br') ? [value('cnl-br')] : visibleBranches());
    const year = Number(value('cnl-year')) || new Date().getFullYear();
    const months = value('cnl-month') === '' ? ALL_MONTHS : [Number(value('cnl-month'))];
    const status = value('cnl-status'), search = value('cnl-search').toLowerCase();
    let rows = scanRows('creditNotes', { branches, years: [year], months });
    const invoices = scanRows('invoices', { branches, years: [year], months });
    const vat = summarizeOutputVat({ invoices, creditNotes: rows });
    if (status === 'active') rows = rows.filter(isCreditNoteLive);
    if (status === 'voided') rows = rows.filter(row => !isCreditNoteLive(row));
    if (search) rows = rows.filter(row => [row.no, row.customer, row.reasonLabel, row.reasonText, ...(row.invoiceNos || [])].join(' ').toLowerCase().includes(search));
    rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (Number(b.id) || 0) - (Number(a.id) || 0));
    const totals = creditNoteTotals(rows);
    const summary = $('cnl-summary');
    if (summary) summary.innerHTML = `<div><small>ใบลดหนี้ที่ใช้งาน</small><b>${totals.count}</b><span>จากที่แสดง ${rows.length} รายการ</span></div>
      <div><small>ผลต่างก่อน VAT</small><b>฿${fmt(totals.subtotal)}</b><span>ลดยอดขายสุทธิในเดือนที่ออกใบลดหนี้</span></div>
      <div><small>VAT ที่ลดลง</small><b>฿${fmt(totals.vatAmt)}</b><span>รวมลดหนี้ ฿${fmt(totals.total)}</span></div>
      <div><small>ภาษีขายสุทธิของช่วงที่เลือก</small><b>฿${fmt(vat.netOutputVat)}</b><span>ภาษีขาย ฿${fmt(vat.outputVat)} − ใบลดหนี้ ฿${fmt(vat.creditVat)}</span></div>`;
    const empty = $('cnlempty');
    if (empty) empty.style.display = rows.length ? 'none' : 'block';
    body.innerHTML = rows.map(row => {
      const live = isCreditNoteLive(row);
      return `<tr class="${live ? '' : 'cn-row-voided'}">
        <td><span class="badge b-purple">${escapeHtml(row.no || '-')}</span></td>
        <td>${escapeHtml(BRANCH_LABEL[row._branch] || row._branch)}</td>
        <td>${escapeHtml(formatDate(row.date))}</td>
        <td>${escapeHtml(row.customer || '-')}</td>
        <td>${(row.invoiceNos || []).map(no => `<span class="cn-mini-chip">${escapeHtml(no)}</span>`).join(' ') || '-'}</td>
        <td title="${escapeHtml(row.reasonText || '')}">${escapeHtml(row.reasonLabel || '-')}${row.reasonText ? `<small class="cn-list-reason">${escapeHtml(row.reasonText)}</small>` : ''}</td>
        <td class="tn">฿${fmt(row.subtotal)}</td>
        <td class="tn">฿${fmt(row.vatAmt)}</td>
        <td class="tn"><b>฿${fmt(row.total)}</b></td>
        <td>${live ? '<span class="badge b-green">ใช้งาน</span>' : `<span class="badge b-red" title="${escapeHtml(row.voidReason || '')}">${escapeHtml(creditNoteStatusLabel(row))}</span>`}</td>
        <td class="erp-rowact-cell">${rowActionsHtml('creditNote', { b: row._branch, y: row._year, m: row._month, id: String(row.id), no: row.no || '', live })}</td>
      </tr>`;
    }).join('');
  }

  // --------------------------------------------------- navigation/events
  function navigate(panelId) {
    const nav = [...document.querySelectorAll('.nav-item')].find(el => String(el.getAttribute('onclick') || '').includes(`'${panelId}'`));
    window.go?.(panelId, nav || null);
  }
  function startFromInvoice(branch, year, month, id) {
    const pack = readPack(branch, Number(year), Number(month), false);
    const invoice = (pack.invoices || []).find(row => String(row.id) === String(id));
    if (!invoice) { notifyUser('ไม่พบใบกำกับภาษีนี้'); return false; }
    resetForm();
    form.branch = lockedBranch() || branch;
    if (form.branch !== branch) { notifyUser('บัญชีนี้ออกใบลดหนี้ได้เฉพาะสาขาที่ผูกไว้'); renderAll(); return false; }
    setValue('cn-inv-filter-year', String(year));
    form.lines = [{ ref: { branch, year: Number(year), month: Number(month), id: invoice.id ?? '', no: invoice.no || '' }, differenceAmount: null }];
    refreshContext();
    applyCustomerFromInvoice(form.context[0]?.invoice || null);
    renderAll();
    navigate('credit-note-form');
    return true;
  }
  function onClick(event) {
    const target = event.target.closest?.('[data-cn-action]');
    if (!target) return;
    const action = target.dataset.cnAction, data = target.dataset;
    const handlers = {
      branch: () => setBranch(data.branch),
      'refresh-refs': populateInvoiceOptions,
      'add-invoice': addSelectedInvoice,
      'remove-line': () => removeLine(Number(data.index)),
      'add-return': () => { form.returnItems.push({ key: '', qty: null }); renderReturnItems(); },
      'remove-return': () => { form.returnItems.splice(Number(data.index), 1); renderReturnItems(); },
      reset: resetForm,
      'cancel-edit': resetForm,
      preview: previewDraft,
      save: saveCreditNote,
      new: () => { resetForm(); navigate('credit-note-form'); },
      'preview-saved': () => previewStored(data.branch, data.year, data.month, data.id),
      edit: () => editCreditNote(data.branch, data.year, data.month, data.id),
      void: () => askVoid(data.branch, data.year, data.month, data.id)
    };
    if (!handlers[action]) return;
    event.preventDefault();
    if (form.edit && EDIT_LOCKED_ACTIONS.has(action)) { notifyUser($('cn-edit-lock-hint')?.textContent || 'ใบลดหนี้ที่ออกแล้วแก้ได้เฉพาะข้อมูลประกอบ', 'info'); return; }
    handlers[action]();
  }
  function onInput(event) {
    const el = event.target;
    if (!el?.dataset) return;
    if (form.edit && (el.dataset.cnLineField || el.dataset.cnReturnField)) return; // issued note: amounts/returns locked
    if (el.dataset.cnLineField) { onLineInput(el); return; }
    if (el.dataset.cnReturnField) {
      const row = form.returnItems[Number(el.dataset.index)];
      if (!row) return;
      if (el.dataset.cnReturnField === 'product') { row.key = el.value; if (event.type === 'change') renderReturnItems(); }
      else row.qty = el.value;
      return;
    }
    if (el.id === 'cn-reason' && event.type === 'change') { renderReturnItems(); return; }
    if (el.dataset.cnRefresh === 'refs') populateInvoiceOptions();
    if (el.dataset.cnRefresh === 'list') renderList();
  }
  function boot() {
    const reason = $('cn-reason');
    if (reason && reason.options.length <= 1) reason.insertAdjacentHTML('beforeend', CREDIT_NOTE_REASONS.map(row => `<option value="${escapeHtml(row.code)}">${escapeHtml(row.label)}</option>`).join(''));
    populateMonthSelect('cn-inv-filter-month');
    populateMonthSelect('cnl-month');
    populateYearSelect('cnl-year');
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onInput);
    document.addEventListener('erp:navigation', event => {
      const id = event?.detail?.id || '';
      if (id === 'credit-note-form') { if (!value('cn-date')) resetForm(); else { if (!form.branch && lockedBranch()) form.branch = lockedBranch(); refreshContext(); renderAll(); } }
      if (id === 'credit-note-list') renderList();
    });
    window.addEventListener('erp-flow:changed', () => { if ($('panel-credit-note-list')?.classList.contains('active')) renderList(); });
    resetForm();
  }

  window.ERPCreditNotes = Object.freeze({
    save: saveCreditNote,
    voidCreditNote,
    edit: editCreditNote,
    startFromInvoice,
    renderList,
    reset: resetForm,
    setBranch,
    addInvoice: addSelectedInvoice,
    preview: previewDraft,
    previewStored,
    getFormState: () => JSON.parse(JSON.stringify({ branch: form.branch, lines: form.lines, returnItems: form.returnItems, edit: form.edit })),
    allCreditNotes: () => scanRows('creditNotes', { branches: ['ubon', 'khonkaen'] })
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
