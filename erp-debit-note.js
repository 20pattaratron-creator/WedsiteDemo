// ============================================================================
// erp-debit-note.js — ใบเพิ่มหนี้ (Debit Note, มาตรา 86/9) form + list controller
// ERP DEMO 4.3.1 · ADR-024 (round 8, stage D) · Local demo only (browser storage).
// ----------------------------------------------------------------------------
// Mirror of erp-credit-note.js (ADR-008): the rules are pure in erp-debit-note-core.js; this module reads
// the form, calls the core and persists through the strict, rollback-capable write session the invoice /
// receipt / credit-note flows use (window.ComformDocumentWriteStore). Debit notes are stored in the
// `debitNotes` collection of the biz2_{branch}_{year}_{month} pack of the debit note's OWN date, so they add
// to sales / output VAT in their own month (รายงานภาษีขาย, ภ.พ.30 line 5 — erp-tax-reports-core.js).
// The extra amount is collected ON THE ORIGINAL INVOICE: ERPIntegrity.paymentSummary() adds `debited` to the
// invoice's balance, so the AR report, aging, dashboard, Decision Review, Customer 360, billing and receipts
// (validateReceipt: amount ≤ outstanding) all see it from one place.
// Issued notes are never edited or deleted: cancel (keeps the number, reason, audit) and issue a new one.
// The form and the list are built here (index.html holds empty roots); every text is in DEBIT_NOTE_UI_TEXT.
// Buttons use data-dn-action delegation (no inline handlers); every user value is escaped.
// ============================================================================
import { DEBIT_NOTE_TEXT, DEBIT_NOTE_REASONS, calculateDebitNote, validateDebitNote, buildDebitNoteRecord, applyDebitNoteVoid, debitNotePriorAdjustments, debitNoteInvoiceEligible, debitNoteBuyerBranchOf, debitNoteTotals, debitNoteExportRows, debitNoteLedgerIssues, isDebitNoteLive, debitNoteStatusLabel, debitNoteVoidCreditRefusal } from './erp-debit-note-core.js';
import { creditNoteInvoiceBasis, creditNoteVatModeOf, creditNoteParseAmount, findCreditNoteInvoice, summarizeOutputVat } from './erp-credit-note-core.js';
import { escapeHtml, fmt, bahtText, formatDate, localDateISO, roundMoneyValue, RECONCILE_TOLERANCE } from './erp-shared-core.js';
import { runDocumentAction, documentActionFeedback, FinanceActionError, FINANCE_ACTION_ERROR_CODES } from './erp-document-finance-core.js';
import { withThaiCalendarMeta } from './erp-date-core.js';
import { withDemoWriteLease, SALES_LEDGER_WRITE_LEASE } from './erp-demo-concurrency.js';
import { rowActionsHtml } from './erp-row-actions.js';
import { branchLabelMap, isMultiBranchUi } from './erp-branches-core.js';
import { icon } from './erp-icons.js';

const DEBIT_NOTE_UI_TEXT = Object.freeze({
  formTitle: 'ใบเพิ่มหนี้ / Debit Note',
  steps: Object.freeze(['1 เลือกใบกำกับภาษีเดิม', '2 ระบุมูลค่าที่ถูกต้องและสาเหตุ', '3 บันทึก / พิมพ์ / PDF']),
  legal: 'ออกได้เมื่อมูลค่าสินค้า/บริการเพิ่มขึ้นหลังออกใบกำกับภาษีแล้ว (มาตรา 82/9, 86/9) · ออกในเดือนภาษีที่เกิดเหตุ · หนึ่งฉบับอ้างอิงได้หลายใบกำกับภาษีเต็มรูปของลูกค้ารายเดียวกัน · ภาษีที่เรียกเก็บเพิ่มเป็นภาษีขายของเดือนที่ออกใบเพิ่มหนี้ · ยอดเพิ่มหนี้เก็บเงินพร้อมใบกำกับภาษีเดิม (รับชำระ/วางบิลที่บิลเดิม)',
  no: 'เลขที่ใบเพิ่มหนี้ *',
  autoNo: 'ใช้เลขอัตโนมัติ',
  autoNoTitle: 'สร้างเลขถัดไปอัตโนมัติ (DN + ปี พ.ศ. 2 หลัก + เดือน + ลำดับ)',
  date: 'วันที่ออกใบเพิ่มหนี้ *',
  branch: 'สาขาที่ออก *',
  branchHint: '— ต้องเป็นสาขาเดียวกับใบกำกับภาษีเดิม',
  branchWarn: 'กรุณาเลือกสาขาก่อนบันทึก',
  refTitle: 'อ้างอิงใบกำกับภาษีเดิม (ใบกำกับภาษีเต็มรูป เลือกได้หลายใบ)',
  refHelp: 'กรองตามปี/เดือน แล้วกด “เพิ่มใบกำกับภาษี” — ชื่อ ที่อยู่ เลขประจำตัวผู้เสียภาษี และสาขาของผู้ซื้อดึงจากใบกำกับภาษีอัตโนมัติ',
  year: 'ปี (พ.ศ.)',
  month: 'เดือน',
  allMonths: 'ทุกเดือน',
  months: Object.freeze(['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']),
  yearOption: year => `พ.ศ. ${year + 543} (${year})`,
  monthYear: (month, year) => `${month} พ.ศ. ${year + 543}`,
  branchFilter: 'สาขา',
  search: 'ค้นหา',
  searchPlaceholder: 'เลขที่ / ลูกค้า / สินค้า',
  refresh: 'รีเฟรช',
  pickInvoice: '-- เลือกใบกำกับภาษีที่ต้องการเพิ่มหนี้ --',
  addInvoice: 'เพิ่มใบกำกับภาษี',
  noLines: 'ยังไม่ได้เลือกใบกำกับภาษีเดิม',
  removeLine: no => `นำใบกำกับภาษี ${no} ออก`,
  pickBranchFirst: 'กรุณาเลือกสาขาก่อน ระบบจะแสดงเฉพาะใบกำกับภาษีของสาขานั้น',
  found: (count, search) => `พบใบกำกับภาษี ${count} รายการ${search ? ` (ค้นหา: ${search})` : ''} — เลือกได้หลายใบ ต้องเป็นลูกค้ารายเดียวกันและรูปแบบ VAT เดียวกัน (ใบกำกับภาษีอย่างย่อออกใบเพิ่มหนี้ไม่ได้)`,
  optionLabel: (no, customer, date, total, adjusted) => `${no} | ${customer} | ${date} | ยอด ฿${total}${adjusted}`,
  optionAdjusted: (debited, credited) => `${debited > 0 ? ` | เพิ่มหนี้แล้ว ฿${fmt(debited)}` : ''}${credited > 0 ? ` | ลดหนี้แล้ว ฿${fmt(credited)}` : ''}`,
  otherCustomer: 'ลูกค้าต่างราย',
  otherVatMode: 'รูปแบบ VAT ต่างกัน',
  buyer: 'ชื่อผู้ซื้อ (ลูกค้า) *',
  buyerPlaceholder: 'ดึงจากใบกำกับภาษีเดิม',
  buyerTaxId: 'เลขประจำตัวผู้เสียภาษีผู้ซื้อ',
  buyerBranch: 'สำนักงานใหญ่ / สาขาของผู้ซื้อ',
  buyerBranchPlaceholder: 'เช่น สำนักงานใหญ่ หรือ สาขาที่ 00001',
  buyerAddress: 'ที่อยู่ผู้ซื้อ',
  linesTitle: 'มูลค่าตามใบกำกับภาษีเดิม / มูลค่าที่ถูกต้อง / ผลต่าง',
  colInvoice: 'ใบกำกับภาษีเดิม',
  colDate: 'ลงวันที่',
  colInvoiceAmount: 'มูลค่าตามใบกำกับ',
  colPrior: 'ปรับปรุงก่อนหน้า',
  colOriginal: 'มูลค่าก่อนครั้งนี้',
  colCorrect: 'มูลค่าที่ถูกต้อง',
  colIncrease: 'ยอดที่เพิ่มขึ้น (ผลต่าง)',
  emptyLines: 'เลือกใบกำกับภาษีเดิมจากรายการด้านบน แล้วกด “เพิ่มใบกำกับภาษี”',
  lineMissing: no => `ไม่พบใบกำกับภาษี ${no} (อาจถูกยกเลิกหรือย้ายเดือน)`,
  priorText: (debited, credited) => [debited > 0 ? `+฿${fmt(debited)}` : '', credited > 0 ? `−฿${fmt(credited)}` : ''].filter(Boolean).join(' ') || '-',
  lineNote: (value, vat, total) => `ก่อน VAT ฿${value} · ภาษีที่เรียกเก็บเพิ่ม ฿${vat} · รวม ฿${total}`,
  correctAria: no => `มูลค่าที่ถูกต้องของ ${no}`,
  increaseAria: no => `ยอดที่เพิ่มขึ้นของ ${no}`,
  basisHint: Object.freeze({
    extract: 'ใบกำกับภาษีเดิมเป็นราคารวม VAT — ช่องในตารางเป็นยอดรวม VAT ระบบถอดภาษีจากผลต่างรวมของทั้งเอกสารครั้งเดียว',
    add: 'ใบกำกับภาษีเดิมเป็นราคายังไม่รวม VAT — ช่องในตารางเป็นมูลค่าก่อน VAT ระบบคำนวณ VAT 7% จากผลต่างรวมของทั้งเอกสารครั้งเดียว',
    none: 'ใบกำกับภาษีเดิมไม่มี VAT — ผลต่างไม่มีภาษีมูลค่าเพิ่ม',
    '': 'ตัวเลขในตารางใช้ฐานราคาเดียวกับใบกำกับภาษีเดิม'
  }),
  reasonTitle: 'สาเหตุการเพิ่มหนี้ (แสดงในใบเพิ่มหนี้)',
  reason: 'สาเหตุ *',
  reasonPick: '-- เลือกสาเหตุ --',
  reasonText: 'คำอธิบายสาเหตุโดยย่อ',
  reasonTextPlaceholder: 'เช่น ติดตั้งเพิ่ม 2 จุดเกินขอบเขตงาน / คิดราคาต่ำกว่าที่ตกลง 500 บาท',
  vatMode: 'รูปแบบ VAT (ตามใบกำกับภาษีเดิม)',
  originalValue: 'มูลค่าตามใบกำกับภาษีเดิม (ก่อน VAT)',
  correctValue: 'มูลค่าที่ถูกต้อง (ก่อน VAT)',
  difference: 'ผลต่าง (ก่อน VAT)',
  vat: 'ภาษีที่เรียกเก็บเพิ่ม',
  total: 'รวมเพิ่มหนี้ทั้งสิ้น (บาท)',
  bahtText: 'จำนวนเงินตัวอักษร',
  note: 'หมายเหตุ',
  notePlaceholder: '(ไม่บังคับ)',
  printHint: '<b>เอกสารพร้อมพิมพ์:</b> ใบเพิ่มหนี้แสดงเลขที่ใบกำกับภาษีเดิม มูลค่าเดิม มูลค่าที่ถูกต้อง ผลต่าง ภาษีที่เรียกเก็บเพิ่ม และเหตุผล ครบตามมาตรา 86/9 พร้อมต้นฉบับ/สำเนา พิมพ์ และ PDF',
  reset: 'ล้างฟอร์ม',
  preview: 'ตัวอย่าง / พิมพ์ / PDF',
  save: 'บันทึกใบเพิ่มหนี้',
  saving: 'กำลังบันทึกใบเพิ่มหนี้อยู่ กรุณารอสักครู่',
  backToList: 'รายการใบเพิ่มหนี้',
  // list
  listTitle: 'รายการใบเพิ่มหนี้',
  newNote: '+ ออกใบเพิ่มหนี้',
  excel: 'Excel',
  allBranches: 'ทุกสาขา',
  status: 'สถานะ',
  allStatus: 'ทุกสถานะ',
  statusActive: 'ใช้งาน',
  statusVoided: 'ยกเลิกแล้ว',
  listSearchPlaceholder: 'เลขที่ / ใบกำกับภาษี / ลูกค้า / สาเหตุ',
  listHead: Object.freeze(['เลขที่', 'สาขา', 'วันที่', 'ลูกค้า', 'อ้างอิงใบกำกับภาษี', 'สาเหตุ', 'ผลต่าง (ก่อน VAT)', 'ภาษีที่เรียกเก็บเพิ่ม', 'รวมเพิ่มหนี้', 'สถานะ', '']),
  empty: 'ไม่พบรายการ',
  sumCount: 'ใบเพิ่มหนี้ที่ใช้งาน',
  sumCountNote: count => `จากที่แสดง ${count} รายการ`,
  sumValue: 'ผลต่างก่อน VAT',
  sumValueNote: 'เพิ่มยอดขายสุทธิในเดือนที่ออกใบเพิ่มหนี้',
  sumVat: 'ภาษีที่เรียกเก็บเพิ่ม',
  sumVatNote: total => `รวมเพิ่มหนี้ ฿${total}`,
  sumOutput: 'ภาษีขายสุทธิของช่วงที่เลือก',
  sumOutputNote: (output, debit, credit) => `ภาษีขาย ฿${output} + ใบเพิ่มหนี้ ฿${debit} − ใบลดหนี้ ฿${credit}`,
  sheetName: 'ใบเพิ่มหนี้',
  exportFile: scope => `export_debit-notes_${scope}.xlsx`,
  excelMissing: 'ยังโหลดตัวส่งออก Excel ไม่ได้ กรุณาโหลดหน้าเว็บใหม่',
  // messages
  branchLocked: label => `บัญชีนี้ถูกผูกกับ ${label} จึงออกใบเพิ่มหนี้ได้เฉพาะสาขานี้`,
  branchInactive: 'สาขานี้ยังไม่เปิดใช้งานในแพ็กเกจ กรุณาเพิ่มสิทธิ์สาขาก่อน',
  branchChangeConfirm: 'เปลี่ยนสาขาจะล้างใบกำกับภาษีที่เลือกไว้ ต้องการดำเนินการต่อหรือไม่?',
  pickInvoiceFirst: 'กรุณาเลือกใบกำกับภาษีจากรายการก่อนกดเพิ่ม',
  wrongBranch: 'ใบกำกับภาษีที่เลือกอยู่คนละสาขากับใบเพิ่มหนี้',
  alreadyPicked: 'เลือกใบกำกับภาษีนี้ไว้แล้ว',
  previewNeedsLines: 'กรุณาเลือกใบกำกับภาษีเดิมอย่างน้อย 1 ใบก่อนดูตัวอย่าง',
  previewBlocked: errors => `ยังเปิดตัวอย่างไม่ได้:\n${errors.join('\n')}`,
  docMissing: 'ไม่พบโมดูลเอกสารใบเพิ่มหนี้ กรุณาโหลดหน้าเว็บใหม่',
  notFound: 'ไม่พบใบเพิ่มหนี้นี้',
  invoiceNotFound: 'ไม่พบใบกำกับภาษีนี้',
  saved: (no, total, warnings) => `บันทึกใบเพิ่มหนี้ ${no} เรียบร้อย · เพิ่มหนี้ ${fmt(total)} บาท (เก็บเงินพร้อมใบกำกับภาษีเดิม)${warnings.length ? `\n⚠️ ${warnings.join('\n⚠️ ')}` : ''}`,
  saveFailed: 'ยังบันทึกใบเพิ่มหนี้ไม่ได้ กรุณาลองใหม่',
  storageFailed: 'บันทึกใบเพิ่มหนี้ในเครื่องไม่สำเร็จ',
  auditCreate: (refs, total, vat, reason) => `ออกใบเพิ่มหนี้ อ้างอิง ${refs} · เพิ่มหนี้ ${fmt(total)} บาท (ภาษีที่เรียกเก็บเพิ่ม ${fmt(vat)}) · ${reason}`,
  auditVoid: reason => `ยกเลิกใบเพิ่มหนี้ (เก็บเลขที่ไว้ ไม่ลบเอกสาร) · เหตุผล: ${reason}`,
  voidPrompt: no => `ยกเลิกใบเพิ่มหนี้ ${no}? เอกสารจะถูกเก็บไว้พร้อมสถานะ “ยกเลิก” (ไม่ลบเลขที่)\nกรุณาระบุเหตุผล:`,
  voidReasonRequired: 'กรุณาระบุเหตุผลการยกเลิกใบเพิ่มหนี้',
  voidAlready: 'ใบเพิ่มหนี้นี้ถูกยกเลิกไปแล้ว',
  voidPaid: (no, invoiceNo, paid, after) => `ยกเลิกใบเพิ่มหนี้ ${no} ไม่ได้ — ลูกค้าชำระใบกำกับภาษี ${invoiceNo} แล้ว ${fmt(paid)} บาท ซึ่งเกินยอดหลังยกเลิก (${fmt(after)} บาท) ยกเลิกใบเสร็จ/รายการรับเงินส่วนที่เก็บตามใบเพิ่มหนี้ก่อน`,
  voidDeclined: 'ยังไม่ได้ยกเลิกใบเพิ่มหนี้ (ผู้ใช้ไม่ยืนยันการยกเลิกย้อนหลังเดือนภาษี)',
  voidNotDone: 'ยังไม่ได้ยกเลิกใบเพิ่มหนี้',
  voided: no => `ยกเลิกใบเพิ่มหนี้ ${no} เรียบร้อย ยอดคงค้างของใบกำกับภาษีถูกคำนวณใหม่แล้ว`,
  voidFailed: 'ยังยกเลิกใบเพิ่มหนี้ไม่ได้ กรุณาลองใหม่',
  voidStorageFailed: 'ยกเลิกใบเพิ่มหนี้ในเครื่องไม่สำเร็จ',
  pastMonthConfirm: (no, date, month, vat) => `⚠️ ใบเพิ่มหนี้ ${no} ลงวันที่ ${date} อยู่ในเดือนภาษี ${month} ซึ่งผ่านไปแล้ว\n\nการยกเลิกจะทำให้ยอดขายและภาษีขายของเดือน ${month} ลดลง (ภาษีขายลดลง ${fmt(vat)} บาท) หากยื่นแบบ ภ.พ.30 ของเดือนนั้นแล้ว ต้องยื่นแบบ ภ.พ.30 เพิ่มเติม\n\nต้องการยกเลิกใบเพิ่มหนี้นี้ต่อหรือไม่?`,
  missingOriginal: 'ไม่พบใบเพิ่มหนี้ในเครื่อง กรุณารีเฟรชแล้วลองใหม่'
});

(() => {
  'use strict';
  if (window.ERPDebitNotes) return;
  const BRANCH_LABEL = branchLabelMap({ ubon: 'สำนักงานใหญ่', khonkaen: 'สาขาที่ 00001' });
  const ALL_MONTHS = Array.from({ length: 12 }, (_, index) => index);
  const T = DEBIT_NOTE_UI_TEXT;
  const MONTHS = T.months;
  const form = { branch: '', lines: [], context: [], saving: false };
  const esc = escapeHtml;
  const $ = id => document.getElementById(id);
  const value = id => String($(id)?.value ?? '').trim();
  const setValue = (id, next) => { const el = $(id); if (el) el.value = next ?? ''; };
  const say = (message, type) => { if (typeof window.notify === 'function') window.notify(message, type); else console.warn('[DebitNote]', message); };
  const moneyInput = amount => (Number.isFinite(Number(amount)) ? roundMoneyValue(amount).toFixed(2) : '');
  const profile = () => window.ComformAuth?.getCurrentProfile?.() || window.CurrentUser || null;
  const lockedBranch = () => { const branch = profile()?.branch; return branch && branch !== 'all' ? branch : ''; };
  // ADR-022: with one establishment the branch choice is hidden and every note belongs to the head office.
  const defaultBranch = () => lockedBranch() || (isMultiBranchUi() ? '' : 'ubon');
  const branchActive = branch => window.SaaSService?.isBranchActive?.(branch) ?? true;
  const userLabel = () => profile()?.email || 'Local user';
  const matcher = () => window.ERPIntegrity?.creditNoteMatches;

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
  // Tolerant read for screens (a damaged month never breaks the page); strict read for the write path.
  function readPack(branch, year, month, strict) {
    if (strict) return window.ComformDocumentWriteStore.loadForWrite(branch, year, month);
    return typeof window.loadFor === 'function' ? window.loadFor(branch, year, month) : {};
  }
  function scanRows(collection, { strict = false, branches = ['ubon', 'khonkaen'], years = knownYears(), months = ALL_MONTHS } = {}) {
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
  function monthOptions(selected = '') {
    return `<option value="">${esc(T.allMonths)}</option>${MONTHS.map((label, index) => `<option value="${index}"${String(selected) === String(index) ? ' selected' : ''}>${esc(label)}</option>`).join('')}`;
  }

  // ------------------------------------------------------------- form markup
  function formHtml() {
    const multi = isMultiBranchUi();
    const branchRow = multi ? `<div class="ff-full" data-dn-branch-field>
        <label class="dn-branch-label">${esc(T.branch)} <span>${esc(T.branchHint)}</span></label>
        <div class="br-row">${['ubon', 'khonkaen'].map(branch => `<label class="br-opt" id="dn-br-${branch === 'ubon' ? 'ub' : 'kk'}" data-dn-action="branch" data-branch="${branch}"><input type="radio" name="dn-br"> <i class="branch-dot ${branch === 'ubon' ? 'ub' : 'kk'}" aria-hidden="true"></i>${esc(BRANCH_LABEL[branch])}</label>`).join('')}</div>
        <div class="br-warn" id="dn-br-warn">⚠️ ${esc(T.branchWarn)}</div>
      </div>` : '';
    return `<div class="card-title">${esc(T.formTitle)}</div>
    <div class="form-quick-guide pink">${T.steps.map((step, index) => `<span class="guide-step${index ? '' : ' active'}">${esc(step)}</span>`).join('')}</div>
    <div class="cn-legal-note">${esc(T.legal)}</div>
    <div class="fg">
      <div class="ff doc-number-field"><label for="dn-no">${esc(T.no)}</label><div class="doc-number-input-group"><input type="text" id="dn-no" placeholder="DN690901"><button type="button" class="doc-number-auto-btn" data-dn-action="auto-number" title="${esc(T.autoNoTitle)}">${icon('refresh')}${esc(T.autoNo)}</button></div></div>
      <div class="ff"><label for="dn-date">${esc(T.date)}</label><input type="date" id="dn-date"></div>
      ${branchRow}
      <div class="ff ff-full production-invoice-link-card linked-source-card">
        <div class="linked-source-head"><div><label for="dn-inv-ref">${esc(T.refTitle)}</label><small>${esc(T.refHelp)}</small></div><span id="dn-inv-source-branch" class="linked-source-branch-badge"></span></div>
        <div class="linked-source-filter-row">
          <label><span>${esc(T.year)}</span><input id="dn-inv-filter-year" type="number" min="2563" max="2643" data-dn-refresh="refs" aria-label="ปี พ.ศ."></label>
          <label><span>${esc(T.month)}</span><select id="dn-inv-filter-month" data-dn-refresh="refs">${monthOptions()}</select></label>
          <label class="linked-source-search"><span>${esc(T.search)}</span><input id="dn-inv-filter-search" type="search" placeholder="${esc(T.searchPlaceholder)}" data-dn-refresh="refs"></label>
          <button type="button" class="btn btn-secondary" data-dn-action="refresh-refs">${icon('refresh')}${esc(T.refresh)}</button>
        </div>
        <div class="production-invoice-link-row"><select id="dn-inv-ref"><option value="">${esc(T.pickInvoice)}</option></select><button type="button" class="btn btn-secondary" data-dn-action="add-invoice">${icon('add')}${esc(T.addInvoice)}</button></div>
        <div id="dn-inv-chips" class="cn-chip-row" aria-live="polite"></div>
        <small id="dn-inv-link-hint"></small>
      </div>
      <div class="fg-row-break" aria-hidden="true"></div>
      <div class="ff"><label for="dn-cust">${esc(T.buyer)}</label><input type="text" id="dn-cust" class="ro" readonly placeholder="${esc(T.buyerPlaceholder)}"></div>
      <div class="ff"><label for="dn-tax-id">${esc(T.buyerTaxId)}</label><input id="dn-tax-id" inputmode="numeric" placeholder="0000000000000"></div>
      <div class="ff"><label for="dn-buyer-branch">${esc(T.buyerBranch)}</label><input id="dn-buyer-branch" placeholder="${esc(T.buyerBranchPlaceholder)}"></div>
      <div class="ff ff-full"><label for="dn-address">${esc(T.buyerAddress)}</label><textarea id="dn-address" rows="2"></textarea></div>
      <div class="fdiv"></div><div class="fsec">${esc(T.linesTitle)}</div>
      <div class="ff-full">
        <div class="tbl-wrap"><table class="items-table cn-lines-table"><thead><tr><th>${esc(T.colInvoice)}</th><th>${esc(T.colDate)}</th><th class="tn">${esc(T.colInvoiceAmount)}</th><th class="tn">${esc(T.colPrior)}</th><th class="tn">${esc(T.colOriginal)}</th><th>${esc(T.colCorrect)}</th><th>${esc(T.colIncrease)}</th><th></th></tr></thead><tbody id="dn-lines-body"></tbody></table></div>
        <small id="dn-basis-hint" class="section-hint"></small>
      </div>
      <div class="fdiv"></div><div class="fsec">${esc(T.reasonTitle)}</div>
      <div class="ff"><label for="dn-reason">${esc(T.reason)}</label><select id="dn-reason"><option value="">${esc(T.reasonPick)}</option>${DEBIT_NOTE_REASONS.map(row => `<option value="${esc(row.code)}">${esc(row.label)}</option>`).join('')}</select></div>
      <div class="ff ff-full"><label for="dn-reason-text">${esc(T.reasonText)}</label><textarea id="dn-reason-text" rows="2" placeholder="${esc(T.reasonTextPlaceholder)}"></textarea></div>
      <div class="fdiv"></div>
      <div class="ff"><label for="dn-vat-mode">${esc(T.vatMode)}</label><input id="dn-vat-mode" class="ro" readonly></div>
      <div class="ff"><label for="dn-original-value">${esc(T.originalValue)}</label><input id="dn-original-value" class="ro" readonly></div>
      <div class="ff"><label for="dn-correct-value">${esc(T.correctValue)}</label><input id="dn-correct-value" class="ro" readonly></div>
      <div class="ff"><label for="dn-diff">${esc(T.difference)}</label><input id="dn-diff" class="ro" readonly></div>
      <div class="ff"><label for="dn-vat-amt">${esc(T.vat)}</label><input id="dn-vat-amt" class="ro" readonly></div>
      <div class="ff"><label for="dn-total">${esc(T.total)}</label><input id="dn-total" class="ro" readonly></div>
      <div class="ff ff-full"><label for="dn-baht-text">${esc(T.bahtText)}</label><input id="dn-baht-text" class="ro" readonly></div>
      <div class="ff ff-full"><label for="dn-note">${esc(T.note)}</label><input type="text" id="dn-note" placeholder="${esc(T.notePlaceholder)}"></div>
      <div class="ff-full"><div id="dn-feedback" class="erp-flow-callout" role="status" hidden></div></div>
    </div>
    <div class="document-action-hint pink">${T.printHint}</div>
    <div class="form-actions">
      <button type="button" class="btn btn-ghost" data-dn-action="reset">${esc(T.reset)}</button>
      <button type="button" class="btn btn-secondary document-preview-btn" data-dn-action="preview">${icon('preview')}${esc(T.preview)}</button>
      <button type="button" id="dn-save-btn" class="btn btn-primary" data-dn-action="save">${icon('save')}${esc(T.save)}</button>
    </div>`;
  }
  function ensureForm() {
    const root = $('dn-form-root');
    if (!root) return false;
    const multi = isMultiBranchUi() ? '2' : '1';
    if (root.dataset.dnBuilt === multi) return true; // rebuilt only when the branch mode changes
    root.innerHTML = formHtml();
    root.dataset.dnBuilt = multi;
    return true;
  }

  // ----------------------------------------------------------------- branch
  function applyBranch() {
    for (const [branch, id] of [['ubon', 'dn-br-ub'], ['khonkaen', 'dn-br-kk']]) {
      const el = $(id);
      if (!el) continue;
      el.className = `br-opt${form.branch === branch ? (branch === 'ubon' ? ' ub-sel' : ' kk-sel') : ''}`;
      const radio = el.querySelector('input');
      if (radio) radio.checked = form.branch === branch;
    }
    if (form.branch) $('dn-br-warn')?.classList.remove('show');
    const badge = $('dn-inv-source-branch');
    if (badge) badge.textContent = form.branch ? BRANCH_LABEL[form.branch] : T.branchWarn;
  }
  function setBranch(branch) {
    if (!BRANCH_LABEL[branch]) return;
    if (!branchActive(branch)) { say(T.branchInactive); return; }
    const locked = lockedBranch();
    if (locked && branch !== locked) { say(T.branchLocked(BRANCH_LABEL[locked])); branch = locked; }
    if (form.branch === branch) { applyBranch(); return; }
    if (form.lines.length && !window.confirm(T.branchChangeConfirm)) return;
    form.branch = branch;
    form.lines = []; form.context = [];
    applyCustomer(null);
    renderAll();
  }

  // ------------------------------------------------------- invoice picker
  const lineKey = ref => `${ref.branch}|${String(ref.id ?? '') || `no:${String(ref.no ?? '')}`}`;
  function locateInvoice(ref) {
    const pack = readPack(ref.branch, Number(ref.year), Number(ref.month), false);
    const own = (pack.invoices || []).find(inv => (ref.id !== '' && ref.id !== undefined && String(inv.id) === String(ref.id)) || (!ref.id && ref.no && String(inv.no) === String(ref.no)));
    if (own) return { ...own, branch: ref.branch, _branch: ref.branch, _year: Number(ref.year), _month: Number(ref.month) };
    return findCreditNoteInvoice({ invoiceId: ref.id, invoiceNo: ref.no, invoiceBranch: ref.branch }, scanRows('invoices', { branches: [ref.branch] }));
  }
  function refreshContext() {
    const creditNotes = scanRows('creditNotes'), debitNotes = scanRows('debitNotes');
    form.context = form.lines.map(line => {
      const invoice = locateInvoice(line.ref);
      return { invoice, prior: invoice ? debitNotePriorAdjustments(invoice, creditNotes, debitNotes, { matches: matcher() }) : { credited: {}, debited: {} } };
    });
  }
  const firstInvoice = () => form.context.find(row => row.invoice)?.invoice || null;
  function populateInvoiceOptions() {
    const select = $('dn-inv-ref'), hint = $('dn-inv-link-hint');
    if (!select) return;
    const previous = select.value;
    select.innerHTML = `<option value="">${esc(T.pickInvoice)}</option>`;
    if (!form.branch) { select.disabled = true; if (hint) hint.textContent = T.pickBranchFirst; return; }
    select.disabled = false;
    const typedYear = Number(value('dn-inv-filter-year')), yearInput = typedYear >= 2500 ? typedYear - 543 : typedYear; // r8fix#C9: พ.ศ.
    const years = Number.isFinite(yearInput) && yearInput >= 2020 && yearInput <= 2100 ? [yearInput] : knownYears();
    const months = value('dn-inv-filter-month') === '' ? ALL_MONTHS : [Number(value('dn-inv-filter-month'))];
    const search = value('dn-inv-filter-search').toLowerCase();
    const chosen = new Set(form.lines.map(line => lineKey(line.ref)));
    const first = firstInvoice();
    const customer = first ? String(first.customer || '').trim().toLowerCase() : '';
    const vatMode = first ? creditNoteVatModeOf(first) : '';
    const creditNotes = scanRows('creditNotes'), debitNotes = scanRows('debitNotes');
    let shown = 0;
    for (const year of years) for (const month of months) {
      for (const inv of readPack(form.branch, year, month, false).invoices || []) {
        if (inv?.documentKind === 'delivery-tax-invoice' || !debitNoteInvoiceEligible(inv).ok) continue; // cancelled / abbreviated: not offered
        const ref = { branch: form.branch, year, month, id: inv.id ?? '', no: inv.no || '' };
        if (chosen.has(lineKey(ref))) continue;
        const haystack = [inv.no, inv.customer, inv.salesPerson, inv.date, ...(inv.items || []).map(item => item.product)].join(' ').toLowerCase();
        if (search && !haystack.includes(search)) continue;
        const target = { ...inv, branch: form.branch, _branch: form.branch };
        const prior = debitNotePriorAdjustments(target, creditNotes, debitNotes, { matches: matcher() });
        const reasons = [];
        if (customer && String(inv.customer || '').trim().toLowerCase() !== customer) reasons.push(T.otherCustomer);
        if (vatMode && creditNoteVatModeOf(inv) !== vatMode) reasons.push(T.otherVatMode);
        const option = document.createElement('option');
        option.value = JSON.stringify(ref);
        option.textContent = `${T.optionLabel(inv.no || '-', inv.customer || '-', formatDate(inv.date), fmt(creditNoteInvoiceBasis(target).total), T.optionAdjusted(prior.debited.total, prior.credited.total))}${reasons.length ? ` · ${reasons.join(' · ')}` : ''}`;
        option.disabled = reasons.length > 0;
        select.appendChild(option);
        shown += 1;
      }
    }
    if ([...select.options].some(option => option.value === previous && !option.disabled)) select.value = previous;
    if (hint) hint.textContent = T.found(shown, search);
  }
  function addInvoiceRef(ref) {
    if (form.lines.some(line => lineKey(line.ref) === lineKey(ref))) { say(T.alreadyPicked); return false; }
    form.lines.push({ ref: { branch: ref.branch, year: Number(ref.year), month: Number(ref.month), id: ref.id ?? '', no: ref.no || '' }, increaseAmount: null });
    refreshContext();
    if (form.lines.length === 1) applyCustomer(form.context[0]?.invoice || null);
    return true;
  }
  function addSelectedInvoice() {
    if (!form.branch) form.branch = defaultBranch();
    if (!form.branch) { $('dn-br-warn')?.classList.add('show'); say(T.branchWarn); return; }
    const raw = $('dn-inv-ref')?.value || '';
    if (!raw) { say(T.pickInvoiceFirst); return; }
    let ref;
    try { ref = JSON.parse(raw); } catch (error) { console.warn('[DebitNote] invalid invoice option', error); return; }
    if (ref.branch !== form.branch) { say(T.wrongBranch); return; }
    if (addInvoiceRef(ref)) renderAll();
  }
  function removeLine(index) {
    if (!form.lines[index]) return;
    form.lines.splice(index, 1);
    refreshContext();
    if (!form.lines.length) applyCustomer(null);
    renderAll();
  }
  function applyCustomer(invoice) {
    setValue('dn-cust', invoice ? invoice.customer || '' : '');
    setValue('dn-address', invoice ? invoice.customerAddress || invoice.address || '' : '');
    const master = invoice ? window.findContactMaster?.(invoice.customer, 'customer') : null;
    setValue('dn-tax-id', invoice ? invoice.customerTaxId || master?.taxId || '' : '');
    setValue('dn-buyer-branch', invoice ? debitNoteBuyerBranchOf(invoice, master).label : '');
  }

  // --------------------------------------------------------------- figures
  function computeForm() {
    const first = firstInvoice();
    return calculateDebitNote({
      vatMode: first ? creditNoteVatModeOf(first) : undefined,
      lines: form.lines.map((line, index) => ({
        invoice: form.context[index]?.invoice || {},
        increaseAmount: line.increaseAmount === null ? '' : line.increaseAmount,
        priorCredited: form.context[index]?.prior?.credited || {},
        priorDebited: form.context[index]?.prior?.debited || {}
      }))
    });
  }
  function renderChips() {
    const box = $('dn-inv-chips');
    if (!box) return;
    box.innerHTML = form.lines.length
      ? form.lines.map((line, index) => `<span class="cn-chip">${esc(line.ref.no || String(line.ref.id))}<button type="button" data-dn-action="remove-line" data-index="${index}" aria-label="${esc(T.removeLine(line.ref.no || ''))}">×</button></span>`).join('')
      : `<span class="cn-chip-empty">${esc(T.noLines)}</span>`;
  }
  function renderLines(calc) {
    const body = $('dn-lines-body');
    if (!body) return;
    if (!form.lines.length) { body.innerHTML = `<tr><td colspan="8" class="cn-empty-row">${esc(T.emptyLines)}</td></tr>`; return; }
    body.innerHTML = form.lines.map((line, index) => {
      const row = calc.lines[index];
      if (!form.context[index]?.invoice) return `<tr class="cn-line-missing"><td colspan="7">${esc(T.lineMissing(line.ref.no || String(line.ref.id)))}</td><td><button type="button" class="btn btn-danger btn-sm" data-dn-action="remove-line" data-index="${index}">×</button></td></tr>`;
      return `<tr data-dn-line="${index}">
        <td><b>${esc(row.invoiceNo)}</b></td>
        <td>${esc(formatDate(row.invoiceDate))}</td>
        <td class="tn">฿${fmt(row.invoiceAmount)}</td>
        <td class="tn">${esc(T.priorText(row.priorDebitedAmount, row.priorCreditedAmount))}</td>
        <td class="tn"><b>฿${fmt(row.originalAmount)}</b></td>
        <td><input type="number" step="0.01" min="0" inputmode="decimal" data-dn-line-field="correct" data-index="${index}" value="${line.increaseAmount === null ? '' : moneyInput(row.correctAmount)}" aria-label="${esc(T.correctAria(row.invoiceNo))}"></td>
        <td><input type="number" step="0.01" min="0" inputmode="decimal" data-dn-line-field="increase" data-index="${index}" value="${line.increaseAmount === null ? '' : moneyInput(line.increaseAmount)}" aria-label="${esc(T.increaseAria(row.invoiceNo))}"><small class="cn-line-note" data-dn-line-note="${index}"></small></td>
        <td><button type="button" class="btn btn-danger btn-sm" data-dn-action="remove-line" data-index="${index}" aria-label="${esc(T.removeLine(row.invoiceNo))}">×</button></td>
      </tr>`;
    }).join('');
  }
  function updateTotals(calc = computeForm()) {
    const first = firstInvoice();
    const vatMode = first ? creditNoteVatModeOf(first) : '';
    const has = form.lines.length > 0;
    setValue('dn-vat-mode', vatMode ? DEBIT_NOTE_TEXT.vatModes[vatMode] : '');
    setValue('dn-original-value', has ? fmt(calc.originalValue) : '');
    setValue('dn-correct-value', has ? fmt(calc.correctValue) : '');
    setValue('dn-diff', has ? fmt(calc.subtotal) : '');
    setValue('dn-vat-amt', has ? fmt(calc.vatAmt) : '');
    setValue('dn-total', has ? fmt(calc.total) : '');
    setValue('dn-baht-text', calc.total > 0 ? bahtText(calc.total) : '');
    calc.lines.forEach((row, index) => {
      const note = document.querySelector(`[data-dn-line-note="${index}"]`);
      if (note) note.textContent = form.lines[index]?.increaseAmount === null ? '' : T.lineNote(fmt(row.difference), fmt(row.vatOnDifference), fmt(row.total));
    });
    const hint = $('dn-basis-hint');
    if (hint) hint.textContent = T.basisHint[vatMode] || T.basisHint[''];
  }
  function onLineInput(input) {
    const index = Number(input.dataset.index);
    const line = form.lines[index], context = form.context[index];
    if (!line || !context?.invoice) return;
    const calcLine = computeForm().lines[index];
    const originalAmount = calcLine ? calcLine.originalAmount : 0;
    const parsed = creditNoteParseAmount(input.value);
    const other = document.querySelector(`[data-dn-line-field="${input.dataset.dnLineField === 'correct' ? 'increase' : 'correct'}"][data-index="${index}"]`);
    if (!Number.isFinite(parsed)) { line.increaseAmount = null; if (other) other.value = ''; }
    else if (input.dataset.dnLineField === 'correct') { line.increaseAmount = roundMoneyValue(parsed - originalAmount); if (other) other.value = moneyInput(line.increaseAmount); }
    else { line.increaseAmount = roundMoneyValue(parsed); if (other) other.value = moneyInput(originalAmount + line.increaseAmount); }
    updateTotals();
  }

  // ------------------------------------------------------------ form state
  function renderAll() {
    if (!ensureForm()) return;
    if (!form.branch) form.branch = defaultBranch();
    applyBranch();
    renderChips();
    const calc = computeForm();
    renderLines(calc);
    updateTotals(calc);
    populateInvoiceOptions();
  }
  function showFeedback(errors = [], warnings = []) {
    const box = $('dn-feedback');
    if (!box) return;
    const rows = [...errors.map(text => `<li>⛔ ${esc(text)}</li>`), ...warnings.map(text => `<li>⚠️ ${esc(text)}</li>`)];
    box.hidden = !rows.length;
    box.className = `erp-flow-callout ${errors.length ? 'tone-red' : 'tone-amber'}`;
    box.innerHTML = rows.length ? `<ul class="cn-feedback-list">${rows.join('')}</ul>` : '';
  }
  function refreshNumber(force) {
    if (typeof window.refreshAutoDocumentNumber === 'function') return window.refreshAutoDocumentNumber('debitNote', force);
    return value('dn-no');
  }
  function markNumberAuto(auto) {
    const el = $('dn-no');
    if (!el) return;
    el.dataset.manualNumber = auto ? '0' : '1';
    el.dataset.autoNumber = auto ? '1' : '0';
    el.classList.toggle('document-number-manual', !auto);
  }
  function resetForm() {
    if (!ensureForm()) return;
    form.lines = []; form.context = [];
    form.branch = defaultBranch();
    ['dn-cust', 'dn-address', 'dn-tax-id', 'dn-buyer-branch', 'dn-reason', 'dn-reason-text', 'dn-note', 'dn-inv-filter-search'].forEach(id => setValue(id, ''));
    setValue('dn-date', localDateISO());
    setValue('dn-inv-filter-year', String(new Date().getFullYear() + 543));
    setValue('dn-inv-filter-month', '');
    markNumberAuto(true);
    refreshNumber(true);
    showFeedback();
    renderAll();
  }
  function collectDraft() {
    return {
      no: value('dn-no'),
      date: value('dn-date'),
      branch: form.branch,
      customer: value('dn-cust'),
      customerAddress: String($('dn-address')?.value ?? '').trim(),
      customerTaxId: value('dn-tax-id'),
      customerBranchCode: form.context[0]?.invoice ? debitNoteBuyerBranchOf(form.context[0].invoice, window.findContactMaster?.(form.context[0].invoice.customer, 'customer')).code : '',
      customerBranch: value('dn-buyer-branch'),
      reasonCode: value('dn-reason'),
      reasonText: String($('dn-reason-text')?.value ?? '').trim(),
      note: value('dn-note'),
      lines: form.lines.map(line => ({ invoiceId: line.ref.id, invoiceNo: line.ref.no, invoiceBranch: line.ref.branch, increaseAmount: line.increaseAmount === null ? '' : line.increaseAmount }))
    };
  }

  // ------------------------------------------------------------------ save
  function auditEvent(action, record, detail) {
    try { window.ERPProductionCore?.audit?.(action, 'debitNote', record.no || String(record.id), detail, { branch: record.branch, entityId: String(record.id) }); }
    catch (error) { console.warn('[DebitNote] audit log write failed (document already saved)', error); }
  }
  function rerenderDependents() {
    try { renderList(); } catch (error) { console.warn('[DebitNote] list render failed', error); }
    for (const name of ['renderIList', 'renderDash', 'renderRList']) {
      try { window[name]?.(); } catch (error) { console.warn(`[DebitNote] ${name} refresh failed`, error); }
    }
  }
  async function saveUnlocked() {
    const branch = lockedBranch() || form.branch || defaultBranch();
    if (!branch) { $('dn-br-warn')?.classList.add('show'); say(T.branchWarn); return false; }
    // An auto number follows the document date at save time (the date may have been
    // set without a change event); a number the user typed is kept as typed.
    refreshNumber(!value('dn-no'));
    const draft = { ...collectDraft(), branch };
    const result = await runDocumentAction({
      action: 'debit_note_create',
      context: {},
      validate: () => {
        const period = periodOf(draft.date);
        if (!period) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, DEBIT_NOTE_TEXT.errDate);
        const profileRefusal = window.ERPCompanyProfile?.issueRefusal?.(); // r8fix#B6
        if (profileRefusal) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.PERMISSION, profileRefusal);
        // A closed sales period refuses the save (the same Thai text as every other locked refusal).
        window.ERPGovernance?.assertPeriodOpen?.({ branch, date: draft.date, scope: 'sales', action: 'debit_note_create' });
        const session = window.ComformDocumentWriteStore.createSession();
        const invoices = scanRows('invoices', { strict: true, branches: [branch] });
        const existing = scanRows('debitNotes', { strict: true });
        const creditNotes = scanRows('creditNotes', { strict: true });
        const validation = validateDebitNote(draft, invoices, existing, creditNotes, { matches: matcher() });
        if (!validation.ok) {
          const error = new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, validation.errors.join('\n'));
          error.details = { errors: validation.errors, warnings: validation.warnings };
          throw error;
        }
        return { period, session, validation };
      },
      plan: ctx => {
        const at = new Date().toISOString();
        const base = buildDebitNoteRecord(draft, ctx.validation, { id: Date.now(), at, createdBy: userLabel(), user: userLabel() });
        return { ...ctx, record: withThaiCalendarMeta(base, ctx.period.year, ctx.period.month) };
      },
      commit: ctx => {
        const pack = ctx.session.get(branch, ctx.period.year, ctx.period.month);
        pack.debitNotes = Array.isArray(pack.debitNotes) ? pack.debitNotes : [];
        pack.debitNotes.push(ctx.record);
        ctx.session.mark(branch, ctx.period.year, ctx.period.month);
        try { ctx.session.commit(); } catch (error) { throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.STORAGE, error?.message || T.storageFailed); }
        window.ERPIntegrity?.changed?.();
        return ctx;
      },
      afterCommit: ctx => {
        const record = ctx.record;
        auditEvent('create', record, T.auditCreate(record.invoiceNos.join(', '), record.total, record.vatAmt, record.reasonLabel));
        resetForm();
        rerenderDependents();
        return ctx;
      }
    });
    if (!result.ok) {
      const feedback = documentActionFeedback(result);
      showFeedback(result.details?.errors || [feedback.message], result.details?.warnings || []);
      say(feedback.text, feedback.type === 'warning' ? 'info' : 'error');
      return false;
    }
    const warnings = result.value?.validation?.warnings || [];
    say(T.saved(result.value.record.no, result.value.record.total, warnings), warnings.length ? 'info' : 'success');
    return result.value.record;
  }
  async function saveDebitNote() {
    if (form.saving) { say(T.saving, 'info'); return false; }
    form.saving = true;
    const button = $('dn-save-btn');
    if (button) button.disabled = true;
    // Same lease as invoice / receipt / credit-note saves: all of them change an invoice's balance.
    try { return await withDemoWriteLease(SALES_LEDGER_WRITE_LEASE, saveUnlocked); }
    catch (error) { console.warn('[ERP DEMO] debit note write lease', error); say(error?.message || T.saveFailed); return false; }
    finally { form.saving = false; if (button) button.disabled = false; }
  }

  // ------------------------------------------------------------------ void
  function findStored(branch, year, month, id) {
    const pack = readPack(branch, Number(year), Number(month), false);
    const record = (pack.debitNotes || []).find(row => String(row.id) === String(id));
    return record ? { ...record, branch, _branch: branch, _year: Number(year), _month: Number(month) } : null;
  }
  // The amount a void takes off each referenced invoice must not leave money already paid above the rest
  // (a receipt that collected the debit note would turn into an overpayment): refused, receipts first.
  function voidPaymentRefusal(record) {
    const I = window.ERPIntegrity;
    if (!I?.paymentSummary) return '';
    const business = I.business();
    const context = typeof I.paymentContext === 'function' ? I.paymentContext(business) : { business };
    for (const line of Array.isArray(record.lines) ? record.lines : []) {
      const invoice = I.resolveInvoice({ branch: line.invoiceBranch || record.branch, invoiceId: line.invoiceId, invoiceNo: line.invoiceNo }, business);
      if (!invoice) continue;
      const summary = I.paymentSummary(invoice, context);
      const after = roundMoneyValue(Math.max(0, summary.effectiveTotal - Number(line.total || 0)));
      if (summary.paid > after + RECONCILE_TOLERANCE) return T.voidPaid(record.no, invoice.no, summary.paid, after);
    }
    return '';
  }
  // r8fix#A3: live credit notes that used the value this note raised keep it alive (strict = the write path).
  function voidCreditRefusal(record, strict = false) {
    return debitNoteVoidCreditRefusal(record, scanRows('invoices', { strict }), scanRows('creditNotes', { strict }), scanRows('debitNotes', { strict }), { matches: matcher() });
  }
  function confirmPastVatMonth(record) {
    const period = periodOf(record.date), today = periodOf(localDateISO());
    if (!period || !today || period.year * 12 + period.month >= today.year * 12 + today.month) return true;
    return window.confirm(T.pastMonthConfirm(record.no, formatDate(record.date), T.monthYear(MONTHS[period.month], period.year), record.vatAmt)) === true;
  }
  async function voidUnlocked(branch, year, month, id, reason) {
    let declined = false;
    const result = await runDocumentAction({
      action: 'debit_note_void',
      context: {},
      validate: () => {
        const text = String(reason ?? '').trim();
        if (!text) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, T.voidReasonRequired);
        const session = window.ComformDocumentWriteStore.createSession();
        const pack = session.get(branch, Number(year), Number(month));
        const index = (pack.debitNotes || []).findIndex(row => String(row.id) === String(id));
        if (index < 0) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.DEPENDENCY, T.missingOriginal);
        const record = pack.debitNotes[index];
        if (!isDebitNoteLive(record)) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, T.voidAlready);
        window.ERPGovernance?.assertPeriodOpen?.({ branch, date: record.date, scope: 'sales', action: 'debit_note_void' });
        const paid = voidPaymentRefusal({ ...record, branch });
        if (paid) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, paid);
        const credited = voidCreditRefusal({ ...record, branch }, true);
        if (credited) throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.CONFLICT, credited);
        if (!confirmPastVatMonth(record)) { declined = true; throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.VALIDATION, T.voidNotDone); }
        return { session, pack, index, record, text };
      },
      commit: ctx => {
        ctx.pack.debitNotes[ctx.index] = applyDebitNoteVoid(ctx.record, { by: userLabel(), reason: ctx.text });
        ctx.session.mark(branch, Number(year), Number(month));
        try { ctx.session.commit(); } catch (error) { throw new FinanceActionError(FINANCE_ACTION_ERROR_CODES.STORAGE, error?.message || T.voidStorageFailed); }
        window.ERPIntegrity?.changed?.();
        return ctx;
      },
      afterCommit: ctx => {
        auditEvent('void', { ...ctx.record, branch }, T.auditVoid(ctx.text));
        rerenderDependents();
        return ctx;
      }
    });
    if (declined) { say(T.voidDeclined, 'info'); return false; }
    if (!result.ok) { say(documentActionFeedback(result).text, 'error'); return false; }
    say(T.voided(result.value.record.no), 'success');
    return true;
  }
  async function voidDebitNote(branch, year, month, id, reason) {
    try { return await withDemoWriteLease(SALES_LEDGER_WRITE_LEASE, () => voidUnlocked(branch, year, month, id, reason)); }
    catch (error) { console.warn('[ERP DEMO] debit note void lease', error); say(error?.message || T.voidFailed); return false; }
  }
  function askVoid(branch, year, month, id) {
    const record = findStored(branch, year, month, id);
    if (!record) { say(T.notFound); return false; }
    if (!isDebitNoteLive(record)) { say(T.voidAlready, 'info'); return false; }
    // Closed period / money already collected: refused before any question (ADR-018); voidUnlocked re-checks.
    const lockRefusal = window.ERPGovernance?.periodLockRefusal?.({ type: 'debitNotes', branch, date: record.date, action: 'debit_note_void' });
    if (lockRefusal) { say(lockRefusal, 'error'); return false; }
    const paid = voidPaymentRefusal(record);
    if (paid) { say(paid, 'error'); return false; }
    const credited = voidCreditRefusal(record);
    if (credited) { say(credited, 'error'); return false; }
    const reason = typeof window.prompt === 'function' ? window.prompt(T.voidPrompt(record.no)) : null;
    if (reason === null || reason === undefined) return false;
    return voidDebitNote(branch, year, month, id, reason);
  }

  // --------------------------------------------------------------- preview
  function openDocument(record, options = {}) {
    // credit-note-document.js renders a record with documentKind 'debit-note' as a ใบเพิ่มหนี้ (ADR-024).
    if (!window.ComformCreditNoteDocument?.openPreview) { say(T.docMissing); return null; }
    return window.ComformCreditNoteDocument.openPreview(record, options);
  }
  function previewDraft() {
    if (!form.lines.length) { say(T.previewNeedsLines); return null; }
    const branch = lockedBranch() || form.branch;
    const draft = { ...collectDraft(), branch };
    const validation = validateDebitNote(draft, scanRows('invoices', { branches: [branch] }), scanRows('debitNotes'), scanRows('creditNotes'), { matches: matcher() });
    if (!validation.ok) { showFeedback(validation.errors, validation.warnings); say(T.previewBlocked(validation.errors)); return null; }
    showFeedback([], validation.warnings);
    return openDocument(buildDebitNoteRecord(draft, validation, { id: 'preview-debit-note' }), { previewOnly: true });
  }
  function previewStored(branch, year, month, id) {
    const record = findStored(branch, year, month, id);
    if (!record) { say(T.notFound); return null; }
    return openDocument(record);
  }

  // ------------------------------------------------------------------ list
  function listHtml() {
    const multi = isMultiBranchUi();
    return `<div class="card-title"><span>${esc(T.listTitle)}</span>
      <div class="list-toolbar-actions"><button type="button" class="btn btn-tertiary btn-sm" data-dn-action="excel">${icon('download')}${esc(T.excel)}</button><button type="button" class="btn btn-primary btn-sm" data-dn-action="new">${esc(T.newNote)}</button></div></div>
    <div class="filter-bar dn-filter-bar">
      ${multi ? `<div><label for="dnl-br">${esc(T.branchFilter)}</label><select id="dnl-br" data-dn-refresh="list"><option value="">${esc(T.allBranches)}</option>${['ubon', 'khonkaen'].map(branch => `<option value="${branch}">${esc(BRANCH_LABEL[branch])}</option>`).join('')}</select></div>` : ''}
      <div><label for="dnl-month">${esc(T.month)}</label><select id="dnl-month" data-dn-refresh="list">${monthOptions()}</select></div>
      <div><label for="dnl-year">${esc(T.year)}</label><select id="dnl-year" data-dn-refresh="list"></select></div>
      <div><label for="dnl-status">${esc(T.status)}</label><select id="dnl-status" data-dn-refresh="list"><option value="">${esc(T.allStatus)}</option><option value="active">${esc(T.statusActive)}</option><option value="voided">${esc(T.statusVoided)}</option></select></div>
      <div><label for="dnl-search">${esc(T.search)}</label><input type="text" id="dnl-search" placeholder="${esc(T.listSearchPlaceholder)}" data-dn-refresh="list"></div>
    </div>
    <div id="dnl-summary" class="cn-list-summary"></div>
    <div class="tbl-wrap"><table><thead><tr>${T.listHead.map((label, index) => `<th${index >= 6 && index <= 8 ? ' class="tn"' : ''}>${esc(label)}</th>`).join('')}</tr></thead><tbody id="dnltbl"></tbody></table></div>
    <div id="dnlempty" class="empty" hidden>${esc(T.empty)}</div>`;
  }
  function ensureList() {
    const root = $('dn-list-root');
    if (!root) return false;
    const multi = isMultiBranchUi() ? '2' : '1';
    if (root.dataset.dnBuilt === multi) return true;
    root.innerHTML = listHtml();
    root.dataset.dnBuilt = multi;
    return true;
  }
  function listFilter() {
    const locked = lockedBranch();
    const branches = locked ? [locked] : (value('dnl-br') ? [value('dnl-br')] : visibleBranches());
    const year = Number(value('dnl-year')) || new Date().getFullYear();
    const months = value('dnl-month') === '' ? ALL_MONTHS : [Number(value('dnl-month'))];
    return { branches, year, months, status: value('dnl-status'), search: value('dnl-search').toLowerCase() };
  }
  function listRows(filter = listFilter()) {
    let rows = scanRows('debitNotes', { branches: filter.branches, years: [filter.year], months: filter.months });
    if (filter.status === 'active') rows = rows.filter(isDebitNoteLive);
    if (filter.status === 'voided') rows = rows.filter(row => !isDebitNoteLive(row));
    if (filter.search) rows = rows.filter(row => [row.no, row.customer, row.reasonLabel, row.reasonText, ...(row.invoiceNos || [])].join(' ').toLowerCase().includes(filter.search));
    return rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (Number(b.id) || 0) - (Number(a.id) || 0));
  }
  function renderList() {
    if (!ensureList()) return;
    const yearEl = $('dnl-year');
    if (yearEl) {
      const current = yearEl.value;
      yearEl.innerHTML = knownYears().map(year => `<option value="${year}">${esc(T.yearOption(year))}</option>`).join('');
      yearEl.value = current && [...yearEl.options].some(option => option.value === current) ? current : String(new Date().getFullYear());
    }
    const filter = listFilter();
    const rows = listRows(filter);
    const all = scanRows('debitNotes', { branches: filter.branches, years: [filter.year], months: filter.months });
    const vat = summarizeOutputVat({ invoices: scanRows('invoices', { branches: filter.branches, years: [filter.year], months: filter.months }), creditNotes: scanRows('creditNotes', { branches: filter.branches, years: [filter.year], months: filter.months }), debitNotes: all });
    const totals = debitNoteTotals(rows);
    const summary = $('dnl-summary');
    if (summary) summary.innerHTML = `<div><small>${esc(T.sumCount)}</small><b>${totals.count}</b><span>${esc(T.sumCountNote(rows.length))}</span></div>
      <div><small>${esc(T.sumValue)}</small><b>฿${fmt(totals.subtotal)}</b><span>${esc(T.sumValueNote)}</span></div>
      <div><small>${esc(T.sumVat)}</small><b>฿${fmt(totals.vatAmt)}</b><span>${esc(T.sumVatNote(fmt(totals.total)))}</span></div>
      <div><small>${esc(T.sumOutput)}</small><b>฿${fmt(vat.netOutputVat)}</b><span>${esc(T.sumOutputNote(fmt(vat.outputVat), fmt(vat.debitVat), fmt(vat.creditVat)))}</span></div>`;
    const empty = $('dnlempty');
    if (empty) empty.hidden = rows.length > 0;
    const body = $('dnltbl');
    if (!body) return;
    body.innerHTML = rows.map(row => {
      const live = isDebitNoteLive(row);
      return `<tr class="${live ? '' : 'cn-row-voided'}">
        <td><span class="badge b-blue">${esc(row.no || '-')}</span></td>
        <td>${esc(BRANCH_LABEL[row._branch] || row._branch)}</td>
        <td>${esc(formatDate(row.date))}</td>
        <td>${esc(row.customer || '-')}</td>
        <td>${(row.invoiceNos || []).map(no => `<span class="cn-mini-chip">${esc(no)}</span>`).join(' ') || '-'}</td>
        <td title="${esc(row.reasonText || '')}">${esc(row.reasonLabel || '-')}${row.reasonText ? `<small class="cn-list-reason">${esc(row.reasonText)}</small>` : ''}</td>
        <td class="tn">฿${fmt(row.subtotal)}</td>
        <td class="tn">฿${fmt(row.vatAmt)}</td>
        <td class="tn"><b>฿${fmt(row.total)}</b></td>
        <td>${live ? `<span class="badge b-green">${esc(T.statusActive)}</span>` : `<span class="badge b-red" title="${esc(row.voidReason || '')}">${esc(debitNoteStatusLabel(row))}</span>`}</td>
        <td class="erp-rowact-cell">${rowActionsHtml('debitNote', { b: row._branch, y: row._year, m: row._month, id: String(row.id), no: row.no || '', live })}</td>
      </tr>`;
    }).join('');
  }
  function exportExcel() {
    const filter = listFilter();
    const rows = listRows(filter);
    const run = () => {
      const XLSX = window.XLSX;
      if (!XLSX) { say(T.excelMissing, 'error'); return; }
      const data = [[...DEBIT_NOTE_TEXT.exportHeader], ...debitNoteExportRows(rows, { formatDate, branchLabel: branch => BRANCH_LABEL[branch] || branch })];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(window.ERPI18n?.exportRows?.(data) ?? data), window.ERPI18n?.exportSheetName?.(T.sheetName) ?? T.sheetName); // ADR-026: English headers in English
      XLSX.writeFile(wb, T.exportFile(`${filter.year + 543}${filter.months.length === 1 ? `-${String(filter.months[0] + 1).padStart(2, '0')}` : ''}`));
    };
    if (window.XLSX) run();
    else if (typeof window.loadSheetJS === 'function') window.loadSheetJS(run);
    else say(T.excelMissing, 'error');
  }

  // ----------------------------------------------------- navigation/events
  function navigate(panelId) {
    const nav = [...document.querySelectorAll('.nav-item')].find(el => String(el.getAttribute('onclick') || '').includes(`'${panelId}'`));
    window.go?.(panelId, nav || null);
  }
  function startFromInvoice(branch, year, month, id) {
    const pack = readPack(branch, Number(year), Number(month), false);
    const invoice = (pack.invoices || []).find(row => String(row.id) === String(id));
    if (!invoice) { say(T.invoiceNotFound); return false; }
    const eligible = debitNoteInvoiceEligible(invoice);
    if (!eligible.ok) { say(eligible.reason === 'cancelled' ? DEBIT_NOTE_TEXT.errInvoiceCancelled(invoice.no || '') : DEBIT_NOTE_TEXT.errAbbreviated(invoice.no || ''), 'error'); return false; }
    const locked = lockedBranch();
    if (locked && locked !== branch) { say(T.branchLocked(BRANCH_LABEL[locked])); return false; }
    resetForm();
    form.branch = branch;
    setValue('dn-inv-filter-year', String(Number(year) + 543));
    addInvoiceRef({ branch, year: Number(year), month: Number(month), id: invoice.id ?? '', no: invoice.no || '' });
    renderAll();
    navigate('debit-note-form');
    return true;
  }
  function onClick(event) {
    const target = event.target.closest?.('[data-dn-action]');
    if (!target) return;
    const action = target.dataset.dnAction, data = target.dataset;
    const handlers = {
      branch: () => setBranch(data.branch),
      'refresh-refs': populateInvoiceOptions,
      'add-invoice': addSelectedInvoice,
      'remove-line': () => removeLine(Number(data.index)),
      'auto-number': () => { markNumberAuto(true); refreshNumber(true); },
      reset: resetForm,
      preview: previewDraft,
      save: saveDebitNote,
      new: () => { resetForm(); navigate('debit-note-form'); },
      excel: exportExcel,
      'preview-saved': () => previewStored(data.branch, data.year, data.month, data.id),
      void: () => askVoid(data.branch, data.year, data.month, data.id)
    };
    if (!handlers[action]) return;
    event.preventDefault();
    handlers[action]();
  }
  function onInput(event) {
    const el = event.target;
    if (!el?.dataset) return;
    if (el.dataset.dnLineField) { onLineInput(el); return; }
    if (el.id === 'dn-no' && event.type === 'input') { markNumberAuto(false); return; }
    if (el.id === 'dn-date' && event.type === 'change') { refreshNumber(false); return; }
    if (el.dataset.dnRefresh === 'refs') populateInvoiceOptions();
    if (el.dataset.dnRefresh === 'list') renderList();
  }
  function boot() {
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onInput);
    document.addEventListener('erp:navigation', event => {
      const id = event?.detail?.id || '';
      if (id === 'debit-note-form') { if (!value('dn-date')) resetForm(); else { refreshContext(); renderAll(); } }
      if (id === 'debit-note-list') renderList();
    });
    window.addEventListener('erp-flow:changed', () => { if ($('panel-debit-note-list')?.classList.contains('active')) renderList(); });
    resetForm();
  }

  window.ERPDebitNotes = Object.freeze({
    save: saveDebitNote,
    voidDebitNote,
    askVoid,
    startFromInvoice,
    renderList,
    reset: resetForm,
    setBranch,
    addInvoice: addSelectedInvoice,
    preview: previewDraft,
    previewStored,
    exportExcel,
    exportRows: () => debitNoteExportRows(listRows(), { formatDate, branchLabel: branch => BRANCH_LABEL[branch] || branch }),
    ledgerIssues: rows => debitNoteLedgerIssues(rows || scanRows('debitNotes')),
    getFormState: () => JSON.parse(JSON.stringify({ branch: form.branch, lines: form.lines })),
    allDebitNotes: () => scanRows('debitNotes'),
    TEXT: DEBIT_NOTE_UI_TEXT
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
