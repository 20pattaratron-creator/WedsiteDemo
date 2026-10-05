// ============================================================================
// erp-tax-reports.js — page "รายงานภาษี" (ADR-023, round 8 stage C)
// ERP DEMO 4.3.1
// ----------------------------------------------------------------------------
// Tabs รายงานภาษีขาย / รายงานภาษีซื้อ / ภาษีซื้อต้องห้าม / ภ.พ.30 for one สถานประกอบการ and tax month
// (or the combined view), with the header of the official form, warnings, print (A4 landscape,
// "แผ่นที่ … ในจำนวน … แผ่น"), Excel (vendored SheetJS through app.js loadSheetJS) and CSV; the ภ.พ.30
// worksheet (lines 1–12, 13–16 not computed), "บันทึกว่ายื่นแล้ว" snapshots (vatReturns, append-only:
// amendments = ยื่นเพิ่มเติมครั้งที่ n) and the offer to close the tax period (ERPGovernance).
// All money comes from erp-tax-reports-core.js (one engine; lines 5 / 7 = the report footers).
// Reads are strict (a damaged month stops the page instead of showing wrong totals).
// Every user value is escaped; every text is in TAX_REPORTS_TEXT.
// ============================================================================
import { escapeHtml, fmt, localDateISO } from './erp-shared-core.js';
import { TAX_CORE_TEXT, TAX_COMBINED_KEY, PP30_COMPUTED_LINES, PP30_OUT_OF_SCOPE_LINES, VAT_OVERPAID_ACTIONS, buildSalesTaxReport, buildPurchaseTaxReport, buildPp30Summary, pp30DueDates, taxReportTable, taxCsvText, taxSafeSheetName, taxPeriodLabel, taxPeriodShort, taxPeriodLastDay, taxPeriodOfDate, addTaxPeriods, parseTaxPeriod, taxThaiDate, taxEntryDateOf, normalizeTaxIdText, parseVatReturnsStore, vatReturnsFor, resolveCarryForward, buildVatReturnSnapshot, mergeVatReturnsStores, normalizeVatReturnsStore } from './erp-tax-reports-core.js';
import { VAT_RETURNS_KEY, STORAGE_WRITTEN_EVENT, COMPANY_PROFILE_CHANGED_EVENT } from './erp-storage-contracts.js';
import { savedProfileOf, liveBranchState, liveBranchCode, liveBranchLabel, HEAD_OFFICE_BRANCH_ID } from './erp-branches-core.js';
import { PLACEHOLDER_TAX_ID, isValidThaiTaxId } from './erp-company-profile-core.js';
import { withDemoWriteLease } from './erp-demo-concurrency.js';
import { icon } from './erp-icons.js';

const TAX_REPORTS_TEXT = Object.freeze({
  pageTitle: 'รายงานภาษี',
  pageIntro: 'รายงานภาษีขาย รายงานภาษีซื้อ และสรุป ภ.พ.30 จากเอกสารที่บันทึกในระบบ — รายสถานประกอบการและเดือนภาษี (มาตรา 87)',
  tabs: Object.freeze({ sales: 'รายงานภาษีขาย', purchase: 'รายงานภาษีซื้อ', forbidden: 'ภาษีซื้อต้องห้าม', pp30: 'ภ.พ.30' }),
  establishment: 'สถานประกอบการ',
  combinedOption: 'รวมทุกสถานประกอบการ (ข้อมูลประกอบ)',
  combinedFiling: 'ยื่นรวมกัน (ทุกสถานประกอบการ)',
  combinedEstablishment: 'รวมทุกสถานประกอบการ',
  combinedNote: 'มุมมองรวมทุกสถานประกอบการเป็นข้อมูลประกอบ — รายงานตามแบบต้องแยกรายสถานประกอบการ',
  month: 'เดือนภาษี',
  year: 'ปี (พ.ศ.)',
  abbreviatedMode: 'ใบกำกับภาษีอย่างย่อ',
  abbreviatedDaily: 'สรุปวันละ 1 บรรทัด',
  abbreviatedEach: 'ลงรายการแยกรายใบ',
  print: 'พิมพ์',
  excel: 'Excel',
  csv: 'CSV',
  formTaxMonth: (month, year) => `เดือนภาษี ${month} ปี ${year}`,
  formOperator: 'ชื่อผู้ประกอบการ',
  formTaxId: 'เลขประจำตัวผู้เสียภาษีอากร',
  formEstablishment: 'ชื่อสถานประกอบการ',
  formHeadOffice: 'สำนักงานใหญ่',
  formBranch: 'สาขาที่',
  formPage: (page, pages) => `แผ่นที่ ${page} ในจำนวน ${pages} แผ่น`,
  emptyRows: 'ไม่มีรายการในเดือนภาษีนี้',
  totalRow: 'รวม',
  readError: detail => `อ่านข้อมูลเอกสารบางเดือนไม่ได้ จึงยังไม่แสดงตัวเลขภาษี (ป้องกันยอดผิด): ${detail} — กู้ข้อมูลจาก Backup หรือแจ้งผู้ดูแลระบบ`,
  returnsReadError: 'ข้อมูล ภ.พ.30 ที่บันทึกไว้อ่านไม่ได้ — ยังบันทึกการยื่นเพิ่มไม่ได้จนกว่าจะกู้ข้อมูลจาก Backup',
  placeholderTaxId: 'เลขประจำตัวผู้เสียภาษีของบริษัทยังเป็นค่าตัวอย่าง (0000000000000) หรือไม่ถูกต้อง — แก้ที่ ตั้งค่า › ตั้งค่าบริษัท ก่อนใช้รายงานจริง',
  openSettings: 'ไปที่ตั้งค่าบริษัท',
  warnTitle: 'ควรตรวจสอบ',
  infoTitle: 'ข้อมูลเพิ่มเติม',
  missingBuyerTaxId: count => `ใบกำกับภาษีเต็มรูป ${count} ฉบับไม่มีเลขประจำตัวผู้เสียภาษีของผู้ซื้อ (ต้องมีเมื่อผู้ซื้อจด VAT — ประกาศฯ ฉบับที่ 202) — รายงานยังออกได้`,
  legacyNoVatTitle: 'ยอดขายไม่มี VAT – ตรวจสอบ (ไม่อยู่ในรายงานภาษีขาย)',
  legacyNoVatHint: 'บันทึกก่อนมีการเลือกประเภท — ระบบนับเป็น "ยกเว้น VAT" ใน ภ.พ.30 บรรทัด 3 ถ้าเป็นการส่งออก (ร้อยละ 0) ให้แก้ไขใบนี้แล้วเลือก "อัตราร้อยละ 0"',
  exemptTitle: 'ยอดขายที่ได้รับยกเว้น VAT (ไม่อยู่ในรายงานภาษีขาย — นับใน ภ.พ.30 บรรทัด 1 และ 3)',
  lateEntries: count => `${count} รายการลงบันทึกเกิน 3 วันทำการนับจากวันที่ในเอกสาร (มาตรา 87 / ประกาศฯ ฉบับที่ 89) — ข้อมูลเพื่อทราบ`,
  skippedCopies: count => `ไม่นับสำเนาเอกสารพิมพ์ ${count} รายการ (นับเฉพาะใบกำกับภาษีต้นทาง)`,
  incompleteTitle: `${TAX_CORE_TEXT.incompleteBadge} — ไม่อยู่ในรายงานภาษีซื้อ`,
  deferredTitle: 'ใบกำกับภาษีเดือนนี้ที่เลือกใช้สิทธิ์เดือนอื่น',
  deferredItem: period => `ใช้สิทธิ์เดือน ${period}`,
  forbiddenIntro: 'VAT ของเอกสารเหล่านี้ใช้หักเป็นภาษีซื้อไม่ได้ (มาตรา 82/5) — บันทึกเป็นต้นทุนค่าใช้จ่าย ไม่อยู่ในรายงานภาษีซื้อ',
  forbiddenEmpty: 'ไม่มีภาษีซื้อต้องห้ามในเดือนนี้',
  // ภ.พ.30
  pp30Worksheet: 'กระดาษทำการ ภ.พ.30 (สรุปเพื่อกรอกแบบ — ไม่ใช่แบบฟอร์มทางการของกรมสรรพากร)',
  pp30NotSubmitted: 'เดโมนี้ไม่ได้ยื่นแบบหรือส่งข้อมูลไปกรมสรรพากร — ใช้ตัวเลขนี้กรอกแบบ ภ.พ.30 เองที่ efiling.rd.go.th หรือสำนักงานสรรพากร',
  filingSeparate: 'แยกยื่นเป็นรายสถานประกอบการ',
  filingCombined: 'ยื่นรวมกัน',
  filingModeNote: mode => `วิธียื่น: ${mode} (เปลี่ยนได้ที่ ตั้งค่าบริษัท — ยื่นรวมกันได้เมื่อได้รับอนุมัติจากกรมสรรพากรแล้ว)`,
  filingNormal: 'ยื่นปกติ',
  filingAmendment: n => `ยื่นเพิ่มเติมครั้งที่ ${n}`,
  lineCol: 'บรรทัด',
  itemCol: 'รายการ',
  amountCol: 'จำนวนเงิน (บาท)',
  line5Source: '= ยอดรวมภาษีในรายงานภาษีขาย',
  line6Source: '= ยอดรวมมูลค่าในรายงานภาษีซื้อ',
  line7Source: '= ยอดรวมภาษีในรายงานภาษีซื้อ',
  carryManual: 'กรอกยอดยกมาเอง (ยังไม่มี ภ.พ.30 เดือนก่อนในระบบ)',
  carryFromPrevious: period => `จาก ภ.พ.30 เดือน ${period} ที่เลือก "ขอนำไปชำระในเดือนถัดไป"`,
  carryNone: period => `ภ.พ.30 เดือน ${period} ไม่ได้ยกยอดชำระเกินมา`,
  carryManualFiled: 'กรอกยอดยกมาเองตอนบันทึกการยื่น',
  overpaidQuestion: 'ยอดชำระเกิน (บรรทัด 12) ต้องการ',
  overpaid: Object.freeze({ refund: 'ขอคืนเป็นเงินสด', carry: 'ขอนำไปชำระในเดือนถัดไป' }),
  channel: 'ช่องทางยื่น',
  channels: Object.freeze({ paper: 'ยื่นแบบกระดาษ', efiling: 'ยื่นทางอินเทอร์เน็ต (e-filing)' }),
  dueTitle: 'กำหนดยื่น',
  duePaper: date => `ยื่นแบบกระดาษ ภายใน ${date}`,
  dueEfiling: date => `ยื่นทางอินเทอร์เน็ต ภายใน ${date}`,
  dueRolled: '(เลื่อนจากวันเสาร์-อาทิตย์)',
  overdue: 'เลยกำหนดยื่นแล้ว — มีเงินเพิ่ม/เบี้ยปรับ (บรรทัด 13–14 ไม่คำนวณในเดโม)',
  payable: amount => `ต้องชำระ ${amount} บาท`,
  overpaidResult: amount => `ชำระเกิน ${amount} บาท`,
  nothingDue: 'ไม่มีภาษีต้องชำระ',
  markFiled: 'บันทึกว่ายื่นแล้ว',
  markAmendment: n => `บันทึกว่ายื่นเพิ่มเติมครั้งที่ ${n} แล้ว`,
  printPp30: 'พิมพ์สรุป ภ.พ.30',
  history: 'ประวัติการยื่นที่บันทึกไว้',
  historyEmpty: 'ยังไม่ได้บันทึกการยื่นของเดือนนี้',
  historyRow: (label, at, channel) => `${label} · บันทึกเมื่อ ${at} · ${channel}`,
  historyDiffers: 'ตัวเลขปัจจุบันต่างจากที่ยื่นไว้ล่าสุด — ถ้าแก้เอกสารหลังยื่น ให้ยื่นเพิ่มเติมและบันทึกอีกครั้ง',
  periodNotEnded: 'เดือนภาษีนี้ยังไม่สิ้นสุด — บันทึกการยื่นได้ตั้งแต่วันที่ 1 ของเดือนถัดไป',
  confirmFile: (kind, period, place, payable) => `${kind} ภ.พ.30 เดือน ${period}\n${place}\n${payable}\n\nบันทึกไว้เป็นหลักฐานในระบบ (ไม่แก้ไขย้อนหลัง — ถ้าต้องแก้ ให้ยื่นเพิ่มเติม)\nเดโมนี้ไม่ได้ส่งข้อมูลไปกรมสรรพากร\n\nยืนยันหรือไม่?`,
  confirmPlaceholder: '\n\n⚠️ เลขประจำตัวผู้เสียภาษีของบริษัทยังเป็นค่าตัวอย่าง',
  filedOk: label => `บันทึกแล้ว: ${label}`,
  offerLock: (period, date) => `ปิดงวดภาษีเดือน ${period} ด้วยหรือไม่?\n\nเอกสารขายและค่าใช้จ่ายที่ลงวันที่ถึง ${date} จะแก้ไข/ยกเลิก/เพิ่มไม่ได้ จนกว่าจะปลดล็อกพร้อมเหตุผล (ศูนย์ควบคุม › Period Lock)`,
  lockReason: (period, label) => `ยื่น ภ.พ.30 เดือน ${period} แล้ว (${label})`,
  lockedOk: period => `ปิดงวดภาษีเดือน ${period} แล้ว (ขาย + ซื้อ)`,
  lockFailed: message => `บันทึกการยื่นแล้ว แต่ปิดงวดไม่สำเร็จ: ${message}`,
  alreadyLocked: 'งวดนี้ปิดแล้ว',
  saveFailed: message => `บันทึกการยื่นไม่สำเร็จ: ${message}`,
  popupBlocked: 'เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต Pop-up สำหรับเว็บไซต์นี้',
  excelMissing: 'ยังโหลดตัวส่งออก Excel ไม่ได้ กรุณาโหลดหน้าเว็บใหม่',
  exportBlocked: 'ยังส่งออกไม่ได้ เพราะอ่านข้อมูลไม่ครบ',
  printedAt: date => `พิมพ์จาก ERP DEMO (ข้อมูลในเครื่องนี้) เมื่อ ${date}`,
  printPp30Note: 'สรุปเพื่อกรอกแบบ ภ.พ.30 — ไม่ใช่แบบฟอร์มทางการ · ตัวเลขบรรทัด 5 และ 7 มาจากรายงานภาษีขาย/ซื้อของเดือนเดียวกัน',
  draftStatus: 'ยังไม่ได้บันทึกว่ายื่น (ร่าง)',
  sheetSales: period => `ภาษีขาย ${period}`,
  sheetPurchase: period => `ภาษีซื้อ ${period}`,
  sheetForbidden: period => `ภาษีซื้อต้องห้าม ${period}`,
  sheetPp30: period => `ภพ30 ${period}`,
  pp30Line: 'บรรทัด',
  combinedFilingNote: 'ยื่นรวมกัน — รวมทุกสถานประกอบการ',
  checked: '☑',
  unchecked: '☐'
});

const PANEL_ID = 'tax-reports';
const ROWS_PER_PRINT_PAGE = 18;
const $ = id => document.getElementById(id);
const ui = { tab: 'sales', branch: HEAD_OFFICE_BRANCH_ID, period: '', abbreviatedMode: 'daily', channel: 'paper', overpaidAction: '', carryManual: '' };
let current = null; // the last computed view (also what print / export use)
const storageKey = base => window.ComformTenant?.storageKey?.(base) || base;
const say = (message, type = 'info', ms) => (typeof window.notify === 'function' ? window.notify(message, type, ms) : console.info('[TaxReports]', message));
const money = value => fmt(value);
const localDate = instant => localDateISO(instant);

// ---------------------------------------------------------------- settings / company
function filingModeSetting() {
  return savedProfileOf(window.CurrentUser)?.vatFilingMode === 'combined' ? 'combined' : 'separate';
}
function uiBranchIds() {
  const ids = liveBranchState(window).ids;
  return Array.isArray(ids) && ids.length ? ids : [HEAD_OFFICE_BRANCH_ID];
}
// The establishments the selected key covers.
function branchesOf(key) {
  return key === TAX_COMBINED_KEY ? uiBranchIds() : [key];
}
function branchOptions(tab) {
  const ids = uiBranchIds();
  if (tab === 'pp30') {
    if (filingModeSetting() === 'combined') return [{ value: TAX_COMBINED_KEY, label: TAX_REPORTS_TEXT.combinedFiling }];
    return ids.map(id => ({ value: id, label: liveBranchLabel(id, undefined, window) }));
  }
  const options = ids.map(id => ({ value: id, label: liveBranchLabel(id, undefined, window) }));
  if (ids.length > 1) options.push({ value: TAX_COMBINED_KEY, label: TAX_REPORTS_TEXT.combinedOption });
  return options;
}
function sellerInfo(key) {
  const user = window.CurrentUser || {};
  const saved = savedProfileOf(user);
  const profile = user.companyProfile || {};
  const name = String(saved?.nameTh || profile.nameTh || profile.companyNameTh || user.companyName || '').trim();
  const taxId = normalizeTaxIdText(saved?.taxId || profile.taxId || '');
  const placeholder = !/^\d{13}$/.test(taxId) || taxId === PLACEHOLDER_TAX_ID || !isValidThaiTaxId(taxId);
  if (key === TAX_COMBINED_KEY) return { name, taxId, placeholder, combined: true, branchCode: '', establishment: `${name} — ${TAX_REPORTS_TEXT.combinedEstablishment}` };
  // The form's wording: "สำนักงานใหญ่" / "สาขาที่ 00001", plus the saved branch name when there is one.
  const branchCode = liveBranchCode(key, window);
  const legal = branchCode === '00000' ? TAX_REPORTS_TEXT.formHeadOffice : `${TAX_REPORTS_TEXT.formBranch} ${branchCode}`;
  const label = saved ? liveBranchLabel(key, undefined, window) : '';
  return { name, taxId, placeholder, combined: false, branchCode, establishment: `${name} (${label && label.includes(legal) ? label : legal})` };
}

// ---------------------------------------------------------------- data (strict reads)
function knownYears() {
  const years = typeof window.allYears === 'function' ? window.allYears() : [];
  return [...new Set([...years, new Date().getFullYear()].map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
}
function readPack(branch, year, month) {
  return window.ComformDocumentWriteStore.loadForWrite(branch, year, month);
}
// Every stored pack of the establishments — the purchase report needs expenses of earlier months
// (a claim may be moved forward) and no-VAT credit notes look up their invoice.
function collectSources(branches, period) {
  const target = parseTaxPeriod(period);
  const out = { packs: new Map(), expenses: new Map(), invoices: new Map() };
  for (const branch of branches) {
    out.expenses.set(branch, []);
    for (const year of knownYears()) for (let month = 0; month < 12; month += 1) {
      let pack;
      try { pack = readPack(branch, year, month); }
      catch (error) {
        const failure = new Error(`${liveBranchLabel(branch, undefined, window)} ${taxPeriodShort(`${year}-${String(month + 1).padStart(2, '0')}`)}: ${error?.message || error}`);
        failure.code = 'storage_error'; throw failure;
      }
      if (target && target.year === year && target.month === month + 1) out.packs.set(branch, pack);
      (pack.expenses || []).forEach(row => out.expenses.get(branch).push(row));
      (pack.invoices || []).forEach(row => { if (row?.documentKind !== 'delivery-tax-invoice') out.invoices.set(`${branch}|${String(row?.no || '').trim()}`, row); });
    }
    if (!out.packs.has(branch) && target) out.packs.set(branch, readPack(branch, target.year, target.month - 1));
  }
  return out;
}
function readReturns() {
  return parseVatReturnsStore(localStorage.getItem(storageKey(VAT_RETURNS_KEY)));
}
// Sales + purchase reports and ภ.พ.30 of one establishment key and month.
function computeView(key, period) {
  const branches = branchesOf(key);
  const view = { key, branches, period, seller: sellerInfo(key), error: '', returnsError: '' };
  try {
    const data = collectSources(branches, period);
    const entryDate = record => taxEntryDateOf(record, localDate);
    view.sales = buildSalesTaxReport({
      period, abbreviatedMode: ui.abbreviatedMode, entryDate,
      sources: branches.map(branch => { const pack = data.packs.get(branch) || {}; return { branch, invoices: pack.invoices || [], creditNotes: pack.creditNotes || [], debitNotes: Array.isArray(pack.debitNotes) ? pack.debitNotes : [] }; }),
      invoiceLookup: (branch, no) => data.invoices.get(`${branch}|${no}`) || null
    });
    view.purchases = buildPurchaseTaxReport({ period, entryDate, sources: branches.map(branch => ({ branch, expenses: data.expenses.get(branch) || [] })) });
  } catch (error) {
    console.warn('[TaxReports] read failed — shown on the page, no figures', error);
    view.error = TAX_REPORTS_TEXT.readError(error?.message || String(error));
    return view;
  }
  let returns = [];
  try { returns = readReturns().returns; }
  catch (error) { console.warn('[TaxReports] vat returns unreadable — filing disabled', error); view.returnsError = TAX_REPORTS_TEXT.returnsReadError; }
  view.returns = vatReturnsFor(returns, key, period);
  view.carry = view.returnsError ? { source: 'manual', amount: 0, editable: false, previous: null } : resolveCarryForward(returns, key, period);
  const manual = Number(String(ui.carryManual).replace(/,/g, ''));
  const carryIn = view.carry.editable ? (Number.isFinite(manual) && manual > 0 ? manual : 0) : view.carry.amount;
  view.pp30 = buildPp30Summary({ period, sales: view.sales, purchases: view.purchases, carryForwardIn: carryIn });
  view.due = pp30DueDates(period);
  return view;
}

// ---------------------------------------------------------------- HTML pieces
const esc = escapeHtml;
const box = (title, items, kind = 'warn') => (items.length ? `<div class="tax-rpt-box tax-rpt-box-${kind}" role="${kind === 'error' ? 'alert' : 'note'}"><b>${esc(title)}</b><ul>${items.map(item => `<li>${item}</li>`).join('')}</ul></div>` : '');
const docItem = row => `${esc(row.no || '-')} · ${esc(taxThaiDate(row.date) || '-')} · ${esc(row.customer || row.vendor || row.party || '-')}${row.value !== undefined ? ` · ฿${money(row.value)}` : ''}${row.amount !== undefined ? ` · ฿${money(row.amount)}` : ''}`;
function periodParts(period) {
  const parsed = parseTaxPeriod(period);
  return parsed ? { month: TAX_CORE_TEXT.monthNames[parsed.month - 1], year: String(parsed.year + 543) } : { month: '', year: '' };
}
// The header of the official form: เดือนภาษี … ปี … · ชื่อผู้ประกอบการ · TIN · สถานประกอบการ ☑/☐.
function formHeaderHtml(title, view, pageText = '') {
  const { month, year } = periodParts(view.period);
  const seller = view.seller;
  const hq = !seller.combined && seller.branchCode === '00000';
  const branch = !seller.combined && !hq;
  return `<div class="tax-form-head">
    <div class="tax-form-title"><h3>${esc(title)}</h3>${pageText ? `<span class="tax-form-page">${esc(pageText)}</span>` : ''}</div>
    <div class="tax-form-month">${esc(TAX_REPORTS_TEXT.formTaxMonth(month, year))}</div>
    <div class="tax-form-grid">
      <div><span>${esc(TAX_REPORTS_TEXT.formOperator)}</span><b>${esc(seller.name || '-')}</b></div>
      <div><span>${esc(TAX_REPORTS_TEXT.formTaxId)}</span><b class="tax-mono">${esc(seller.taxId || '-')}</b></div>
      <div><span>${esc(TAX_REPORTS_TEXT.formEstablishment)}</span><b>${esc(seller.establishment)}</b></div>
      <div class="tax-form-checks"><span>${hq ? TAX_REPORTS_TEXT.checked : TAX_REPORTS_TEXT.unchecked} ${esc(TAX_REPORTS_TEXT.formHeadOffice)}</span><span>${branch ? TAX_REPORTS_TEXT.checked : TAX_REPORTS_TEXT.unchecked} ${esc(TAX_REPORTS_TEXT.formBranch)} <b class="tax-mono">${branch ? esc(seller.branchCode) : '.....'}</b></span></div>
    </div>
    ${seller.combined ? `<div class="tax-form-note">${esc(TAX_REPORTS_TEXT.combinedNote)}</div>` : ''}
    ${seller.placeholder ? `<div class="tax-form-note tax-form-note-warn">${esc(TAX_REPORTS_TEXT.placeholderTaxId)}</div>` : ''}
  </div>`;
}
// Table of the official columns (2-row header), used on screen and in print.
function tableHtml(table, { includeFooter = true, rows = table.body, className = 'tax-rpt-table' } = {}) {
  // Every cell carries its column key (col-…) so widths are set per column in CSS (no content-driven layout).
  const top = table.groups.map(group => (group.grouped ? `<th colspan="${group.span}" scope="colgroup">${esc(group.label)}</th>` : `<th rowspan="2" scope="col" class="col-${table.columns[group.from].key}">${esc(group.label)}</th>`)).join('');
  const sub = table.columns.filter(column => column.group).map(column => `<th scope="col" class="col-${column.key}">${esc(column.label)}</th>`).join('');
  const cell = (value, column) => (column.money ? `<td class="tn col-${column.key}${Number(value) < 0 ? ' neg' : ''}">${esc(money(value))}</td>` : `<td class="col-${column.key}${['headOffice', 'branchNo', 'seq'].includes(column.key) ? ' tc' : ''}">${esc(value)}</td>`);
  const body = rows.length ? rows.map(row => `<tr>${row.map((value, index) => cell(value, table.columns[index])).join('')}</tr>`).join('') : `<tr><td colspan="${table.columns.length}" class="tc tax-empty">${esc(TAX_REPORTS_TEXT.emptyRows)}</td></tr>`;
  const footer = includeFooter ? `<tfoot><tr>${table.footer.map((value, index) => (table.columns[index].money ? `<td class="tn col-${table.columns[index].key}"><b>${esc(money(value))}</b></td>` : `<td class="col-${table.columns[index].key}${index === 0 ? ' tc' : ''}">${index === 0 ? `<b>${esc(value)}</b>` : ''}</td>`)).join('')}</tr></tfoot>` : '';
  return `<table class="${className}"><thead><tr>${top}</tr>${sub ? `<tr>${sub}</tr>` : ''}</thead><tbody>${body}</tbody>${footer}</table>`;
}
function salesWarnings(view) {
  const report = view.sales;
  const w = report.warnings;
  const warn = [];
  if (w.integrity.length) warn.push(...w.integrity.map(esc));
  if (w.outsidePeriod.length) warn.push(...w.outsidePeriod.map(esc));
  if (w.missingBuyerTaxId.length) warn.push(`${esc(TAX_REPORTS_TEXT.missingBuyerTaxId(w.missingBuyerTaxId.length))}: ${w.missingBuyerTaxId.map(row => esc(row.no)).join(', ')}`);
  const info = [];
  if (w.lateEntries.length) info.push(esc(TAX_REPORTS_TEXT.lateEntries(w.lateEntries.length)));
  if (report.skippedCopies) info.push(esc(TAX_REPORTS_TEXT.skippedCopies(report.skippedCopies)));
  return box(TAX_REPORTS_TEXT.warnTitle, warn)
    + (w.legacyNoVat.length ? `<div class="tax-rpt-box tax-rpt-box-warn" data-tax-legacy-box role="note"><b>${esc(TAX_REPORTS_TEXT.legacyNoVatTitle)}</b><p>${esc(TAX_REPORTS_TEXT.legacyNoVatHint)}</p><ul>${w.legacyNoVat.map(row => `<li>${docItem(row)}</li>`).join('')}</ul></div>` : '')
    + box(TAX_REPORTS_TEXT.exemptTitle, w.exemptSales.map(docItem), 'info')
    + box(TAX_REPORTS_TEXT.infoTitle, info, 'info');
}
function purchaseWarnings(view) {
  const report = view.purchases;
  return box(TAX_REPORTS_TEXT.incompleteTitle, report.incomplete.map(row => `${docItem({ ...row, no: row.docNo || row.desc })} <small>${esc(TAX_CORE_TEXT.incompleteHint)}</small>`))
    + box(TAX_REPORTS_TEXT.deferredTitle, report.deferred.map(row => `${docItem(row)} · ${esc(TAX_REPORTS_TEXT.deferredItem(taxPeriodShort(row.claimPeriod)))}`), 'info')
    + box(TAX_REPORTS_TEXT.infoTitle, report.warnings.lateEntries.length ? [esc(TAX_REPORTS_TEXT.lateEntries(report.warnings.lateEntries.length))] : [], 'info');
}

// ---------------------------------------------------------------- ภ.พ.30 screen
function filingLabel(amendment) {
  return amendment ? TAX_REPORTS_TEXT.filingAmendment(amendment) : TAX_REPORTS_TEXT.filingNormal;
}
// Where line 10 comes from: typed (no earlier return), the previous return's "ยกไปเดือนถัดไป", or nothing.
function carrySourceText(carry) {
  const previous = carry.previous?.period ? taxPeriodShort(carry.previous.period) : '';
  if (carry.editable) return TAX_REPORTS_TEXT.carryManual;
  if (carry.source === 'previous') return TAX_REPORTS_TEXT.carryFromPrevious(previous);
  if (carry.source === 'manual') return TAX_REPORTS_TEXT.carryManualFiled;
  return TAX_REPORTS_TEXT.carryNone(previous);
}
function pp30LinesHtml(lines, view, { editable = false } = {}) {
  const sources = { 5: TAX_REPORTS_TEXT.line5Source, 6: TAX_REPORTS_TEXT.line6Source, 7: TAX_REPORTS_TEXT.line7Source };
  const rows = [...PP30_COMPUTED_LINES, ...PP30_OUT_OF_SCOPE_LINES].map(line => {
    const label = TAX_CORE_TEXT.pp30Lines[line];
    let amount;
    if (PP30_OUT_OF_SCOPE_LINES.includes(line)) amount = `<span class="tax-muted">${esc(TAX_CORE_TEXT.pp30NotComputed)}</span>`;
    else if (line === 10 && editable && view.carry?.editable) amount = `<input id="tax-pp30-carry" class="tax-carry-input" inputmode="decimal" aria-label="${esc(label)}" value="${esc(ui.carryManual)}" placeholder="0.00">`;
    else amount = `<b data-pp30-line="${line}">${esc(money(lines[line]))}</b>`;
    let source = sources[line] ? `<small>${esc(sources[line])}</small>` : '';
    if (line === 10 && view.carry) source = `<small>${esc(carrySourceText(view.carry))}</small>`;
    return `<tr${[8, 11, 12].includes(line) ? ' class="tax-pp30-key"' : ''}><td class="tc">${line}.</td><td>${esc(label)}${source}</td><td class="tn">${amount}</td></tr>`;
  }).join('');
  return `<table class="tax-rpt-table tax-pp30-table"><thead><tr><th scope="col">${esc(TAX_REPORTS_TEXT.lineCol)}</th><th scope="col">${esc(TAX_REPORTS_TEXT.itemCol)}</th><th scope="col" class="tax-th-num">${esc(TAX_REPORTS_TEXT.amountCol)}</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function pp30Html(view) {
  const lines = view.pp30.lines;
  const next = view.returns.length;
  const latest = view.returns[next - 1];
  const differs = latest && PP30_COMPUTED_LINES.some(line => Math.abs(Number(latest.lines[line]) - Number(lines[line])) > 0.001);
  const today = localDateISO();
  const ended = view.period && taxPeriodLastDay(view.period) < today;
  const deadline = view.due ? view.due[ui.channel] : '';
  const overdue = deadline && today > deadline;
  const mode = view.key === TAX_COMBINED_KEY ? TAX_REPORTS_TEXT.filingCombined : TAX_REPORTS_TEXT.filingSeparate;
  const result = lines[11] > 0 ? TAX_REPORTS_TEXT.payable(money(lines[11])) : lines[12] > 0 ? TAX_REPORTS_TEXT.overpaidResult(money(lines[12])) : TAX_REPORTS_TEXT.nothingDue;
  const overpaid = lines[12] > 0 ? `<fieldset class="tax-pp30-choice"><legend>${esc(TAX_REPORTS_TEXT.overpaidQuestion)}</legend>${VAT_OVERPAID_ACTIONS.map(action => `<label class="tax-check"><input type="radio" name="tax-pp30-overpaid" value="${action}"${ui.overpaidAction === action ? ' checked' : ''}> <span>${esc(TAX_REPORTS_TEXT.overpaid[action])}</span></label>`).join('')}</fieldset>` : '';
  const history = view.returns.length
    ? `<ul class="tax-history">${view.returns.map(row => `<li><span>${esc(TAX_REPORTS_TEXT.historyRow(filingLabel(row.amendment), taxThaiDate(row.filedAt.slice(0, 10)), TAX_REPORTS_TEXT.channels[row.channel]))} · ${esc(row.lines[11] > 0 ? TAX_REPORTS_TEXT.payable(money(row.lines[11])) : row.lines[12] > 0 ? TAX_REPORTS_TEXT.overpaidResult(money(row.lines[12])) : TAX_REPORTS_TEXT.nothingDue)}</span><button type="button" class="btn btn-tertiary" data-tax-action="print-return" data-return-id="${esc(row.id)}">${icon('print')}${esc(TAX_REPORTS_TEXT.print)}</button></li>`).join('')}</ul>${differs ? `<div class="tax-rpt-box tax-rpt-box-warn" role="note">${esc(TAX_REPORTS_TEXT.historyDiffers)}</div>` : ''}`
    : `<p class="tax-muted">${esc(TAX_REPORTS_TEXT.historyEmpty)}</p>`;
  const due = view.due ? `<ul class="tax-due"><li>${esc(TAX_REPORTS_TEXT.duePaper(taxThaiDate(view.due.paper)))}</li><li>${esc(TAX_REPORTS_TEXT.dueEfiling(taxThaiDate(view.due.efiling)))}${view.due.efilingRolled ? ` ${esc(TAX_REPORTS_TEXT.dueRolled)}` : ''}</li>${view.due.checkLatest ? `<li class="tax-hint-warn">${esc(TAX_CORE_TEXT.efilingCheckLatest)}</li>` : ''}<li class="tax-muted">${esc(TAX_CORE_TEXT.dueDateHolidayNote)}</li>${overdue ? `<li class="tax-hint-warn">${esc(TAX_REPORTS_TEXT.overdue)}</li>` : ''}</ul>` : '';
  const canFile = !view.returnsError && ended;
  return `<div class="tax-pp30">
    <div class="tax-rpt-box tax-rpt-box-info" role="note">${esc(TAX_REPORTS_TEXT.pp30NotSubmitted)}</div>
    <p class="tax-muted">${esc(TAX_REPORTS_TEXT.filingModeNote(mode))} <button type="button" class="btn btn-tertiary" data-tax-action="settings">${icon('settings')}${esc(TAX_REPORTS_TEXT.openSettings)}</button></p>
    ${formHeaderHtml(TAX_REPORTS_TEXT.pp30Worksheet, view)}
    <div class="tax-pp30-status"><span class="tax-badge">${esc(next ? filingLabel(next) : TAX_REPORTS_TEXT.filingNormal)}</span><b data-pp30-result>${esc(result)}</b></div>
    <div class="tbl-wrap">${pp30LinesHtml(lines, view, { editable: true })}</div>
    ${overpaid}
    <div class="tax-pp30-row"><div class="ff"><label for="tax-pp30-channel">${esc(TAX_REPORTS_TEXT.channel)}</label><select id="tax-pp30-channel">${Object.entries(TAX_REPORTS_TEXT.channels).map(([value, label]) => `<option value="${value}"${ui.channel === value ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></div><div><b>${esc(TAX_REPORTS_TEXT.dueTitle)}</b>${due}</div></div>
    ${view.returnsError ? box(TAX_REPORTS_TEXT.warnTitle, [esc(view.returnsError)], 'error') : ''}
    ${!ended ? `<div class="tax-rpt-box tax-rpt-box-info" role="note">${esc(TAX_REPORTS_TEXT.periodNotEnded)}</div>` : ''}
    <div class="tax-rpt-actions"><button type="button" class="btn btn-primary" data-tax-action="file"${canFile ? '' : ' disabled'}>${icon('save')}${esc(next ? TAX_REPORTS_TEXT.markAmendment(next) : TAX_REPORTS_TEXT.markFiled)}</button><button type="button" class="btn btn-secondary" data-tax-action="print">${icon('print')}${esc(TAX_REPORTS_TEXT.printPp30)}</button><button type="button" class="btn btn-tertiary" data-tax-action="excel">${icon('download')}${esc(TAX_REPORTS_TEXT.excel)}</button></div>
    <h4 class="tax-sub">${esc(TAX_REPORTS_TEXT.history)}</h4>${history}
  </div>`;
}

// ---------------------------------------------------------------- page
function yearOptions(selected) {
  const years = knownYears();
  if (!years.includes(selected)) years.push(selected);
  return years.sort((a, b) => b - a).map(year => `<option value="${year}"${year === selected ? ' selected' : ''}>${year + 543}</option>`).join('');
}
function defaultPeriod() {
  return addTaxPeriods(taxPeriodOfDate(localDateISO()), -1);
}
function normalizeUi() {
  if (!parseTaxPeriod(ui.period)) ui.period = defaultPeriod();
  const options = branchOptions(ui.tab);
  if (!options.some(option => option.value === ui.branch)) ui.branch = options[0].value;
  return options;
}
function render() {
  const root = $('tax-reports-root');
  if (!root) return;
  const options = normalizeUi();
  const period = parseTaxPeriod(ui.period);
  current = computeView(ui.branch, ui.period);
  const tabs = Object.entries(TAX_REPORTS_TEXT.tabs).map(([id, label]) => `<button type="button" role="tab" class="tax-tab${ui.tab === id ? ' active' : ''}" aria-selected="${ui.tab === id}" data-tax-tab="${id}">${esc(label)}</button>`).join('');
  const filters = `<div class="filter-bar tax-rpt-filters">
    <div><label for="tax-rpt-branch">${esc(TAX_REPORTS_TEXT.establishment)}</label><select id="tax-rpt-branch">${options.map(option => `<option value="${esc(option.value)}"${option.value === ui.branch ? ' selected' : ''}>${esc(option.label)}</option>`).join('')}</select></div>
    <div><label for="tax-rpt-month">${esc(TAX_REPORTS_TEXT.month)}</label><select id="tax-rpt-month">${TAX_CORE_TEXT.monthNames.map((name, index) => `<option value="${index + 1}"${period.month === index + 1 ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select></div>
    <div><label for="tax-rpt-year">${esc(TAX_REPORTS_TEXT.year)}</label><select id="tax-rpt-year">${yearOptions(period.year)}</select></div>
    ${ui.tab === 'sales' ? `<div><label for="tax-rpt-abbr">${esc(TAX_REPORTS_TEXT.abbreviatedMode)}</label><select id="tax-rpt-abbr"><option value="daily"${ui.abbreviatedMode === 'daily' ? ' selected' : ''}>${esc(TAX_REPORTS_TEXT.abbreviatedDaily)}</option><option value="each"${ui.abbreviatedMode === 'each' ? ' selected' : ''}>${esc(TAX_REPORTS_TEXT.abbreviatedEach)}</option></select></div>` : ''}
  </div>`;
  let body;
  if (current.error) body = box(TAX_REPORTS_TEXT.warnTitle, [esc(current.error)], 'error');
  else if (ui.tab === 'pp30') body = pp30Html(current);
  else {
    const kind = ui.tab;
    const report = kind === 'sales' ? current.sales : current.purchases;
    const title = kind === 'sales' ? TAX_CORE_TEXT.salesTitle : kind === 'purchase' ? TAX_CORE_TEXT.purchaseTitle : TAX_CORE_TEXT.forbiddenTitle;
    const table = taxReportTable(report, kind);
    body = `<div class="tax-rpt-actions"><button type="button" class="btn btn-secondary" data-tax-action="print">${icon('print')}${esc(TAX_REPORTS_TEXT.print)}</button><button type="button" class="btn btn-tertiary" data-tax-action="excel">${icon('download')}${esc(TAX_REPORTS_TEXT.excel)}</button><button type="button" class="btn btn-tertiary" data-tax-action="csv">${icon('table')}${esc(TAX_REPORTS_TEXT.csv)}</button></div>
      ${kind === 'sales' ? salesWarnings(current) : kind === 'purchase' ? purchaseWarnings(current) : `<p class="tax-muted">${esc(TAX_REPORTS_TEXT.forbiddenIntro)}</p>`}
      ${formHeaderHtml(title, current)}
      <div class="tbl-wrap tax-rpt-scroll" tabindex="0" role="region" aria-label="${esc(title)}">${tableHtml(table)}</div>`;
  }
  root.innerHTML = `<div class="tax-rpt-head"><h2 class="card-title">${icon('tax')}${esc(TAX_REPORTS_TEXT.pageTitle)}</h2><p>${esc(TAX_REPORTS_TEXT.pageIntro)}</p></div>
    <div class="tax-tabs" role="tablist" aria-label="${esc(TAX_REPORTS_TEXT.pageTitle)}">${tabs}</div>${filters}<div class="tax-rpt-body" data-tax-tab-body="${esc(ui.tab)}">${body}</div>`;
}

// ---------------------------------------------------------------- print
const PRINT_CSS = `@page{size:A4 landscape;margin:9mm}*{box-sizing:border-box}body{margin:0;font-family:'Sarabun','TH Sarabun New','Noto Sans Thai',Tahoma,sans-serif;color:#111;font-size:12px}
.page{page-break-after:always;padding:0}.page:last-child{page-break-after:auto}.tax-form-head{margin-bottom:6px}.tax-form-title{display:flex;justify-content:center;position:relative}.tax-form-title h3{margin:0;font-size:18px}
.tax-form-page{position:absolute;right:0;top:2px;font-size:12px}.tax-form-month{text-align:center;font-size:14px;margin:2px 0 6px}.tax-form-grid{display:grid;grid-template-columns:1.4fr 1fr;gap:2px 18px}.tax-form-grid div{display:flex;gap:6px}.tax-form-grid span{color:#333}
.tax-form-checks{gap:18px!important}.tax-form-note{margin-top:4px;font-size:11px;color:#444}.tax-form-note-warn{color:#b42318;font-weight:700}.tax-mono{font-variant-numeric:tabular-nums;letter-spacing:.04em}
table{width:100%;border-collapse:collapse;table-layout:auto}th,td{border:1px solid #444;padding:3px 5px;vertical-align:top}th{background:#f1f3f5;font-weight:700;text-align:center;font-size:11.5px}td.tn{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}td.tc{text-align:center}
.neg{color:#b42318}tfoot td{background:#f8f9fa}.foot{margin-top:6px;font-size:10.5px;color:#555;display:flex;justify-content:space-between;gap:12px}.tax-muted{color:#666}.tax-pp30-key td{background:#fffbe6}.tax-empty{color:#666}
.col-party{width:21%}.col-note{width:19%}.col-taxId{width:13%}.col-date{white-space:nowrap}.pp30{max-width:190mm;margin:0 auto}.pp30 table td:nth-child(1){width:14mm}.pp30 table td:nth-child(3){width:42mm}.pp30-meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 18px;margin:6px 0}.pp30-meta div{display:flex;gap:6px;flex-wrap:wrap}`;
function printDocument(title, pagesHtml, { portrait = false } = {}) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) { say(TAX_REPORTS_TEXT.popupBlocked, 'error'); return false; }
  try { printWindow.opener = null; } catch (error) { console.warn('[TaxReports] could not detach the print window', error); }
  const css = portrait ? PRINT_CSS.replace('size:A4 landscape', 'size:A4 portrait') : PRINT_CSS;
  printWindow.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body>${pagesHtml}<script>window.onload=()=>setTimeout(()=>window.print(),400)<\/script></body></html>`);
  printWindow.document.close();
  return true;
}
function reportPrintHtml(view, kind) {
  const report = kind === 'sales' ? view.sales : view.purchases;
  const title = kind === 'sales' ? TAX_CORE_TEXT.salesTitle : kind === 'purchase' ? TAX_CORE_TEXT.purchaseTitle : TAX_CORE_TEXT.forbiddenTitle;
  const table = taxReportTable(report, kind);
  const chunks = [];
  for (let i = 0; i < table.body.length; i += ROWS_PER_PRINT_PAGE) chunks.push(table.body.slice(i, i + ROWS_PER_PRINT_PAGE));
  if (!chunks.length) chunks.push([]);
  const printed = TAX_REPORTS_TEXT.printedAt(taxThaiDate(localDateISO()));
  const pages = chunks.map((rows, index) => `<section class="page" data-page="${index + 1}">${formHeaderHtml(title, view, TAX_REPORTS_TEXT.formPage(index + 1, chunks.length))}${tableHtml(table, { rows, includeFooter: index === chunks.length - 1, className: 'print-table' })}<div class="foot"><span>${esc(printed)}</span><span>${esc(TAX_REPORTS_TEXT.formPage(index + 1, chunks.length))}</span></div></section>`).join('');
  return { title: `${title} ${taxPeriodShort(view.period)}`, html: pages };
}
// One-page ภ.พ.30 worksheet in the order and labels of the official form (a stored snapshot or the draft).
function pp30PrintHtml(view, snapshot = null) {
  const lines = snapshot ? snapshot.lines : view.pp30.lines;
  const amendment = snapshot ? snapshot.amendment : view.returns.length;
  const combined = view.key === TAX_COMBINED_KEY;
  const { month, year } = periodParts(view.period);
  const c = flag => (flag ? TAX_REPORTS_TEXT.checked : TAX_REPORTS_TEXT.unchecked);
  const overpaidAction = snapshot ? snapshot.overpaidAction : ui.overpaidAction;
  const status = snapshot ? TAX_REPORTS_TEXT.historyRow(filingLabel(snapshot.amendment), taxThaiDate(snapshot.filedAt.slice(0, 10)), TAX_REPORTS_TEXT.channels[snapshot.channel]) : TAX_REPORTS_TEXT.draftStatus;
  const due = view.due ? `${TAX_REPORTS_TEXT.duePaper(taxThaiDate(view.due.paper))} · ${TAX_REPORTS_TEXT.dueEfiling(taxThaiDate(view.due.efiling))}` : '';
  const carryView = { ...view, carry: snapshot ? { editable: false, source: snapshot.carryForwardSource, previous: { period: addTaxPeriods(view.period, -1) } } : view.carry };
  return `<section class="page pp30">${formHeaderHtml(TAX_REPORTS_TEXT.pp30Worksheet, view)}
    <div class="pp30-meta"><div>${esc(TAX_REPORTS_TEXT.formTaxMonth(month, year))}</div><div>${c(!amendment)} ${esc(TAX_REPORTS_TEXT.filingNormal)} &nbsp; ${c(amendment > 0)} ${esc(TAX_REPORTS_TEXT.filingAmendment(amendment > 0 ? amendment : '…'))}</div>
    <div>${c(!combined)} ${esc(TAX_REPORTS_TEXT.filingSeparate)} &nbsp; ${c(combined)} ${esc(TAX_REPORTS_TEXT.filingCombined)}</div><div>${esc(status)}</div></div>
    ${pp30LinesHtml(lines, carryView)}
    ${lines[12] > 0 ? `<div class="pp30-meta"><div>${esc(TAX_REPORTS_TEXT.overpaidQuestion)}: ${c(overpaidAction === 'refund')} ${esc(TAX_REPORTS_TEXT.overpaid.refund)} &nbsp; ${c(overpaidAction === 'carry')} ${esc(TAX_REPORTS_TEXT.overpaid.carry)}</div></div>` : ''}
    <div class="foot"><span>${esc(due)}</span></div>
    <div class="foot"><span>${esc(TAX_REPORTS_TEXT.printPp30Note)} · ${esc(TAX_REPORTS_TEXT.pp30NotSubmitted)}</span></div>
    <div class="foot"><span>${esc(TAX_REPORTS_TEXT.printedAt(taxThaiDate(localDateISO())))}</span></div></section>`;
}
function printCurrent(snapshotId = '') {
  if (!current || current.error) { say(TAX_REPORTS_TEXT.exportBlocked, 'error'); return false; }
  if (ui.tab === 'pp30') {
    const snapshot = snapshotId ? current.returns.find(row => row.id === snapshotId) : null;
    return printDocument(`ภ.พ.30 ${taxPeriodShort(current.period)}`, pp30PrintHtml(current, snapshot), { portrait: true });
  }
  const page = reportPrintHtml(current, ui.tab);
  return printDocument(page.title, page.html);
}

// ---------------------------------------------------------------- Excel / CSV
function headerRows(view, title) {
  const { month, year } = periodParts(view.period);
  const s = view.seller;
  const hq = !s.combined && s.branchCode === '00000';
  return [[title], [TAX_REPORTS_TEXT.formTaxMonth(month, year)], [`${TAX_REPORTS_TEXT.formOperator} ${s.name}`], [`${TAX_REPORTS_TEXT.formTaxId} ${s.taxId}`],
    [`${TAX_REPORTS_TEXT.formEstablishment} ${s.establishment}`, `${hq ? TAX_REPORTS_TEXT.checked : TAX_REPORTS_TEXT.unchecked} ${TAX_REPORTS_TEXT.formHeadOffice}  ${!s.combined && !hq ? TAX_REPORTS_TEXT.checked : TAX_REPORTS_TEXT.unchecked} ${TAX_REPORTS_TEXT.formBranch} ${!s.combined && !hq ? s.branchCode : ''}`], []];
}
function exportBase(view) {
  const code = view.key === TAX_COMBINED_KEY ? 'all' : view.seller.branchCode || view.key;
  const p = parseTaxPeriod(view.period);
  return `${code}_${p.year + 543}-${String(p.month).padStart(2, '0')}`;
}
function workbookFor(view, tab) {
  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();
  if (tab === 'pp30') {
    const rows = [...headerRows(view, TAX_REPORTS_TEXT.pp30Worksheet), [TAX_REPORTS_TEXT.pp30Line, TAX_REPORTS_TEXT.itemCol, TAX_REPORTS_TEXT.amountCol]];
    PP30_COMPUTED_LINES.forEach(line => rows.push([line, TAX_CORE_TEXT.pp30Lines[line], view.pp30.lines[line]]));
    PP30_OUT_OF_SCOPE_LINES.forEach(line => rows.push([line, TAX_CORE_TEXT.pp30Lines[line], TAX_CORE_TEXT.pp30NotComputed]));
    rows.push([], [TAX_REPORTS_TEXT.printPp30Note], [TAX_REPORTS_TEXT.pp30NotSubmitted]);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 8 }, { wch: 70 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, taxSafeSheetName(TAX_REPORTS_TEXT.sheetPp30(taxPeriodShort(view.period).replace('/', '-'))));
    return { wb, name: `PP30_${exportBase(view)}.xlsx` };
  }
  const report = tab === 'sales' ? view.sales : view.purchases;
  const title = tab === 'sales' ? TAX_CORE_TEXT.salesTitle : tab === 'purchase' ? TAX_CORE_TEXT.purchaseTitle : TAX_CORE_TEXT.forbiddenTitle;
  const table = taxReportTable(report, tab);
  const head = headerRows(view, title);
  // Two header rows like the form: a group label once over its merged cells, the other columns span both rows.
  const top = table.columns.map((column, index) => (column.group ? (index > 0 && table.columns[index - 1].group === column.group ? '' : column.group) : column.label));
  const sub = table.columns.map(column => (column.group ? column.label : ''));
  const rows = [...head, top, sub, ...table.body, table.footer];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const headerRow = head.length;
  const merges = [];
  table.groups.forEach(group => {
    if (group.grouped) merges.push({ s: { r: headerRow, c: group.from }, e: { r: headerRow, c: group.from + group.span - 1 } });
    else merges.push({ s: { r: headerRow, c: group.from }, e: { r: headerRow + 1, c: group.from } });
  });
  ws['!merges'] = merges;
  ws['!cols'] = table.columns.map(column => ({ wch: column.money ? 16 : column.key === 'party' || column.key === 'note' ? 36 : column.key === 'taxId' ? 18 : 12 }));
  const sheet = tab === 'sales' ? TAX_REPORTS_TEXT.sheetSales : tab === 'purchase' ? TAX_REPORTS_TEXT.sheetPurchase : TAX_REPORTS_TEXT.sheetForbidden;
  XLSX.utils.book_append_sheet(wb, ws, taxSafeSheetName(sheet(taxPeriodShort(view.period).replace('/', '-'))));
  const prefix = tab === 'sales' ? 'VAT-sales-report' : tab === 'purchase' ? 'VAT-purchase-report' : 'VAT-input-disallowed';
  return { wb, name: `${prefix}_${exportBase(view)}.xlsx` };
}
function exportExcel() {
  if (!current || current.error) { say(TAX_REPORTS_TEXT.exportBlocked, 'error'); return; }
  const view = current, tab = ui.tab;
  const run = () => {
    if (!window.XLSX) { say(TAX_REPORTS_TEXT.excelMissing, 'error'); return; }
    const { wb, name } = workbookFor(view, tab);
    window.XLSX.writeFile(wb, name);
  };
  if (window.XLSX) run();
  else if (typeof window.loadSheetJS === 'function') window.loadSheetJS(run);
  else say(TAX_REPORTS_TEXT.excelMissing, 'error');
}
function exportCsv() {
  if (!current || current.error || ui.tab === 'pp30') { say(TAX_REPORTS_TEXT.exportBlocked, 'error'); return; }
  const report = ui.tab === 'sales' ? current.sales : current.purchases;
  const table = taxReportTable(report, ui.tab);
  const header = table.columns.map(column => (column.group ? `${column.group} - ${column.label}` : column.label));
  const text = taxCsvText([header, ...table.body, table.footer]);
  const prefix = ui.tab === 'sales' ? 'VAT-sales-report' : ui.tab === 'purchase' ? 'VAT-purchase-report' : 'VAT-input-disallowed';
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${prefix}_${exportBase(current)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ---------------------------------------------------------------- filing (vatReturns)
const newReturnId = () => `vatret_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
function actorLabel() {
  return String(window.ComformAuth?.getCurrentProfile?.()?.email || window.CurrentUser?.email || window.CurrentUser?.displayName || 'Local user');
}
function lockedThrough(view) {
  const date = taxPeriodLastDay(view.period);
  return view.branches.every(branch => ['sales', 'purchase'].every(scope => { try { window.ERPGovernance?.assertPeriodOpen?.({ branch, date, scope }); return false; } catch { return true; } }));
}
function offerLock(view, label) {
  const governance = window.ERPGovernance;
  if (!governance?.lockPeriod || lockedThrough(view)) return;
  const through = taxPeriodLastDay(view.period);
  if (!window.confirm(TAX_REPORTS_TEXT.offerLock(taxPeriodShort(view.period), taxThaiDate(through)))) return;
  const branch = view.key === TAX_COMBINED_KEY ? 'all' : view.key;
  const reason = TAX_REPORTS_TEXT.lockReason(taxPeriodShort(view.period), label);
  const done = [];
  try {
    for (const scope of ['sales', 'purchase']) done.push(governance.lockPeriod({ branch, scope, throughDate: through, reason }));
    say(TAX_REPORTS_TEXT.lockedOk(taxPeriodShort(view.period)), 'success');
  } catch (error) {
    // all or nothing: a half-closed period (sales locked, purchases open) is undone
    for (const event of done) { try { governance.unlockPeriod(event.lockId, reason); } catch (undoError) { console.error('[TaxReports] lock rollback failed', undoError); } }
    say(TAX_REPORTS_TEXT.lockFailed(error?.message || String(error)), 'error', 8000);
  }
}
async function fileReturn() {
  const view = computeView(ui.branch, ui.period);
  if (view.error || view.returnsError) { say(view.error || view.returnsError, 'error', 8000); return null; }
  if (!(taxPeriodLastDay(view.period) < localDateISO())) { say(TAX_REPORTS_TEXT.periodNotEnded, 'error'); return null; }
  if (view.sales.warnings.integrity.length) { say(view.sales.warnings.integrity.join('\n'), 'error'); return null; }
  const lines = view.pp30.lines;
  if (lines[12] > 0 && !VAT_OVERPAID_ACTIONS.includes(ui.overpaidAction)) { say(TAX_CORE_TEXT.errOverpaidAction, 'error'); return null; }
  if (view.carry.editable && ui.carryManual !== '' && !(Number(String(ui.carryManual).replace(/,/g, '')) >= 0)) { say(TAX_CORE_TEXT.errCarryForward, 'error'); return null; }
  const label = filingLabel(view.returns.length);
  const result = lines[11] > 0 ? TAX_REPORTS_TEXT.payable(money(lines[11])) : lines[12] > 0 ? TAX_REPORTS_TEXT.overpaidResult(money(lines[12])) : TAX_REPORTS_TEXT.nothingDue;
  const question = TAX_REPORTS_TEXT.confirmFile(label, taxPeriodLabel(view.period), view.seller.establishment, result) + (view.seller.placeholder ? TAX_REPORTS_TEXT.confirmPlaceholder : '');
  if (!window.confirm(question)) return null;
  try {
    const snapshot = await withDemoWriteLease('vat-return', () => {
      // re-read inside the lease: another tab may have filed in the meantime (the amendment number follows)
      const store = readReturns();
      const fresh = computeView(ui.branch, ui.period);
      if (fresh.error) throw new Error(fresh.error);
      const record = buildVatReturnSnapshot({
        returns: store.returns, id: newReturnId(), branchKey: fresh.key, branches: fresh.branches, period: fresh.period,
        filingMode: fresh.key === TAX_COMBINED_KEY ? 'combined' : 'separate', summary: fresh.pp30,
        carry: fresh.carry.editable ? { source: fresh.pp30.lines[10] > 0 ? 'manual' : 'none', amount: fresh.pp30.lines[10] } : fresh.carry,
        overpaidAction: ui.overpaidAction, channel: ui.channel, filedAt: new Date().toISOString(), filedBy: actorLabel(),
        seller: { name: fresh.seller.name, taxId: fresh.seller.taxId, branchCode: fresh.seller.branchCode },
        counts: { salesRows: fresh.sales.rows.length, purchaseRows: fresh.purchases.rows.length }
      });
      const next = normalizeVatReturnsStore({ ...store, returns: [...store.returns, record] });
      window.ERPIntegrity.transaction([[storageKey(VAT_RETURNS_KEY), next]]);
      return record;
    });
    const doneLabel = filingLabel(snapshot.amendment);
    try { window.ERPProductionCore?.audit?.('create', 'vat_return', `ภ.พ.30 ${taxPeriodShort(snapshot.period)}`, `${doneLabel} · ${snapshot.branchKey} · บรรทัด 11 ${money(snapshot.lines[11])} · บรรทัด 12 ${money(snapshot.lines[12])}`, { branch: snapshot.branchKey === TAX_COMBINED_KEY ? '' : snapshot.branchKey, entityId: snapshot.id }); }
    catch (error) { console.warn('[TaxReports] audit row not written (the return is saved)', error); }
    say(TAX_REPORTS_TEXT.filedOk(`${doneLabel} ภ.พ.30 ${taxPeriodShort(snapshot.period)}`), 'success');
    ui.carryManual = '';
    render();
    offerLock(view, doneLabel);
    render();
    return snapshot;
  } catch (error) {
    console.error('[TaxReports] filing failed', error);
    say(TAX_REPORTS_TEXT.saveFailed(error?.message || String(error)), 'error', 8000);
    return null;
  }
}

// ---------------------------------------------------------------- backup hooks (app.js JSON backup)
function exportBackup() {
  return readReturns(); // throws on a damaged store: the backup export then fails instead of dropping it
}
function backupWrites(value, options = {}) {
  if (value === undefined || value === null) return [];
  const merged = mergeVatReturnsStores(localStorage.getItem(storageKey(VAT_RETURNS_KEY)) === null ? null : readReturns(), value, { replace: !!options.replace });
  return [[storageKey(VAT_RETURNS_KEY), merged]];
}

// ---------------------------------------------------------------- events
function onClick(event) {
  const tab = event.target.closest?.('[data-tax-tab]');
  if (tab) { ui.tab = tab.dataset.taxTab; render(); $('tax-reports-root')?.querySelector(`[data-tax-tab="${ui.tab}"]`)?.focus(); return; }
  const action = event.target.closest?.('[data-tax-action]');
  if (!action || action.disabled) return;
  const name = action.dataset.taxAction;
  if (name === 'print') printCurrent();
  else if (name === 'print-return') printCurrent(action.dataset.returnId);
  else if (name === 'excel') exportExcel();
  else if (name === 'csv') exportCsv();
  else if (name === 'file') fileReturn();
  else if (name === 'settings') { if (typeof window.ERPCompanyProfile?.open === 'function') window.ERPCompanyProfile.open(); else window.go?.('saas-admin'); }
}
function onChange(event) {
  const id = event.target?.id;
  if (id === 'tax-rpt-branch') { ui.branch = event.target.value; ui.carryManual = ''; ui.overpaidAction = ''; }
  else if (id === 'tax-rpt-month' || id === 'tax-rpt-year') { const year = Number($('tax-rpt-year')?.value), month = Number($('tax-rpt-month')?.value); ui.period = `${year}-${String(month).padStart(2, '0')}`; ui.carryManual = ''; ui.overpaidAction = ''; }
  else if (id === 'tax-rpt-abbr') ui.abbreviatedMode = event.target.value === 'each' ? 'each' : 'daily';
  else if (id === 'tax-pp30-channel') ui.channel = event.target.value === 'efiling' ? 'efiling' : 'paper';
  else if (id === 'tax-pp30-carry') ui.carryManual = String(event.target.value || '').trim();
  else if (event.target?.name === 'tax-pp30-overpaid') ui.overpaidAction = event.target.value;
  else return;
  render();
}
let queued = false;
function scheduleRender() {
  if (queued || !$(`panel-${PANEL_ID}`)?.classList.contains('active')) return;
  queued = true;
  setTimeout(() => { queued = false; try { render(); } catch (error) { console.error('[TaxReports] render failed', error); } }, 0);
}
window.ERPTaxReports = Object.freeze({
  render, fileReturn, exportBackup, backupWrites,
  select: (options = {}) => { Object.assign(ui, Object.fromEntries(Object.entries(options).filter(([key]) => key in ui))); render(); return { ...ui }; },
  view: () => current,
  printHtml: () => (current && !current.error ? (ui.tab === 'pp30' ? pp30PrintHtml(current) : reportPrintHtml(current, ui.tab).html) : ''),
  TEXT: TAX_REPORTS_TEXT
});
function boot() {
  const root = $('tax-reports-root');
  if (!root) return;
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  document.addEventListener('erp:navigation', event => { if (event.detail?.id === PANEL_ID) { try { render(); } catch (error) { console.error('[TaxReports] render failed', error); } } });
  window.addEventListener(STORAGE_WRITTEN_EVENT, scheduleRender);
  window.addEventListener(COMPANY_PROFILE_CHANGED_EVENT, scheduleRender);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
