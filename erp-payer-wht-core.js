// ============================================================================
// erp-payer-wht-core.js — pure rules of payer-side withholding tax (ภาษีหัก ณ ที่จ่าย ที่เราหักจากผู้ขาย):
// the WHT part of an expense payment, the 50 ทวิ certificate record and its numbering, ใบแนบ ภ.ง.ด.3 /
// ภ.ง.ด.53 with the cover summary, due dates and the filed snapshots (whtFilings).
// ERP DEMO 4.3.1 · ADR-024 (round 8, stage D) — DOM / storage free, deterministic.
// ----------------------------------------------------------------------------
// Sources (docs/TAX_FEATURES_SPEC.md §5, §0.2):
// - Rates: คำสั่งกรมสรรพากร ท.ป.4/2528 (rd.go.th/3479.html) and the RD WHT guide
//   (rd.go.th/fileadmin/download/insight_pasi/wht_3_53_030260.pdf): service / hire of work / professional 3 %,
//   rent 5 %, advertising 2 %, transport 1 %. r13#HIGH-3: the 1,000-baht threshold applies PER CONTRACT, not per
//   payment (สรรพากรภาค 5, ผู้มีหน้าที่หักภาษี ณ ที่จ่ายตามแบบ ภ.ง.ด.3 ข้อ 2.3: "เฉพาะกรณีการจ่ายเงินตามสัญญารายหนึ่ง ๆ
//   ตั้งแต่ 1,000 บาทขึ้นไป"): a payment under a contract whose total is ≥ 1,000 is withheld even when the instalment is
//   smaller; only a payment with no contract is tested on its own amount (+ a "withhold anyway" override). The exact
//   order/clause is [unconfirmed] (the rd.go.th page of ท.ป.4/2528 fetched does not show it).
// - Base = the pre-VAT amount (universal practice; the precise clause is [unconfirmed]). Without a VAT split (the tax
//   invoice is not in hand) the user states whether the amount includes VAT (r8fix#A1). r13#MED-1: there is NO silent
//   default any more — a payee recorded as not VAT-registered, or a payment whose evidence is not a tax invoice (a plain
//   receipt has no VAT to take out), is 'none'; a VAT-registered or unknown payee with a tax-invoice type must be chosen.
// - ภ.ง.ด.3 = payee is an individual (บุคคลธรรมดา, incl. ห้างหุ้นส่วนสามัญ / คณะบุคคล); ภ.ง.ด.53 = a juristic person.
// - 50 ทวิ (form approve_wh3_081156.pdf): เล่มที่ / เลขที่, payer and payee name / address / 13-digit TIN, the
//   form box, income row 5 (คำสั่งที่ออกตามมาตรา 3 เตรส) with the type named, date paid, amount paid, tax withheld,
//   the total in Thai words, payer condition (1) หัก ณ ที่จ่าย (2) ออกให้ตลอดไป (3) ออกให้ครั้งเดียว.
// - ใบแนบ ภ.ง.ด.3 (270360_attach3.pdf) / ภ.ง.ด.53 (290360_attach53.pdf): the columns of §5b2.
// - Due: the 7th of the next month on paper, the 15th by e-filing (extension in force until 31 Jan 2570 —
//   secondary sources, kept as config like TAX_DEADLINES), moved past Saturday / Sunday and the listed government
//   holidays (r13#LOW-1, TAX_PUBLIC_HOLIDAYS). The month is the month the money is PAID (r13#MED-2, ท.ป.115/2545:
//   "ภายในเจ็ดวันนับแต่วันสิ้นเดือนของเดือนที่จ่ายเงินได้") — whtPaymentDate, default the expense date.
// Condition 2 (ออกให้ตลอดไป, the payer bears the tax every time) uses the gross-up the spec gives
// ([unconfirmed official]): amount paid = base ÷ (1 − rate), tax = amount paid − base. Condition 3 (ออกให้ครั้งเดียว):
// amount paid = base + round(base × rate), tax = round(amount paid × rate); the payer bears ONLY round(base × rate) and the
// rest of the tax (the tax on the borne part) is deducted from the payee (r13#HIGH-1: 10,000 @ 3 % + VAT 700 → 50 ทวิ
// 10,300 / 309, company bears 300, payee receives 10,691) — PEAK worked example, a secondary source; an accountant must
// confirm (spec §5c.5, ADR-024 / ADR-030). Condition 4 (อื่น ๆ) is not supported. Money: half-up to the satang (roundMoneyValue, ป.86/2542); report totals are sums of the
// stored per-certificate values. Every user-visible text is in WHT_TEXT; top-level names carry a wht / WHT
// prefix (the vm-based tests load several modules into one lexical scope).
// ============================================================================
import { roundMoneyValue, parseBusinessDate, businessDateOrdinal, bahtText, normalizeBuyerBranchCode, calculateVatSummary, DEFAULT_VAT_RATE, DEFAULT_VAT_DIVISOR } from './erp-shared-core.js';
import { EXPENSE_TAX_INVOICE_DOC_TYPES } from './erp-tax-reports-core.js';
import { isValidThaiTaxId } from './erp-company-profile-core.js';
import { addTaxPeriods, parseTaxPeriod, taxPeriodOfDate, taxThaiDate, taxDueDatePair, normalizeTaxIdText, TAX_DEADLINES } from './erp-tax-reports-core.js';

export const WHT_CORE_VERSION = '1.0.0';
export const WHT_FILING_SCHEMA_VERSION = 1;
export const WHT_CERTIFICATE_COLLECTION = 'whtCertificates';
export const WHT_CERTIFICATE_KIND = 'wht-certificate';
export const WHT_FORMS = Object.freeze(['PND3', 'PND53']);
export const WHT_THRESHOLD_BAHT = 1000;
// Rates the user may pick for a type without a fixed rate (รางวัล / อื่น ๆ).
export const WHT_RATE_CHOICES = Object.freeze([1, 2, 3, 5, 10, 15]);
export const WHT_SUPPORTED_CONDITIONS = Object.freeze([1, 2, 3]);
// Without a VAT split: does the expense amount include VAT ('included' → base = amount ÷ (1 + VAT rate)) or not ('none').
export const WHT_VAT_BASES = Object.freeze(['included', 'none']);
// Shown in the texts; derived from the shared VAT rate (ADR-002, no VAT literal outside erp-shared-core.js).
const WHT_VAT_PERCENT = Math.round(DEFAULT_VAT_RATE * 10000) / 100;
const WHT_VAT_DIVISOR_TEXT = String(Math.round(DEFAULT_VAT_DIVISOR * 10000) / 10000);
// ภ.ง.ด.3 / 53 deadlines (§0.2): day of the month after the payment month; e-filing until the shared extension date.
export const WHT_DEADLINES = Object.freeze({ paper: 7, efiling: 15, efilingExtensionUntil: TAX_DEADLINES.efilingExtensionUntil });

// ---------------------------------------------------------------- texts (i18n-ready)
export const WHT_TEXT = Object.freeze({
  forms: Object.freeze({ PND3: 'ภ.ง.ด.3', PND53: 'ภ.ง.ด.53' }),
  formPayee: Object.freeze({ PND3: 'บุคคลธรรมดา', PND53: 'นิติบุคคล' }),
  entityTypes: Object.freeze({ person: 'บุคคลธรรมดา (ภ.ง.ด.3)', company: 'นิติบุคคล (ภ.ง.ด.53)' }),
  incomeTypes: Object.freeze({
    service: 'ค่าบริการ',
    hire_of_work: 'ค่าจ้างทำของ',
    professional: 'ค่าวิชาชีพอิสระ (มาตรา 40(6))',
    rent: 'ค่าเช่า',
    advertising: 'ค่าโฆษณา',
    transport: 'ค่าขนส่ง (ไม่ใช่ขนส่งสาธารณะ)',
    prize: 'รางวัล / ส่วนลดหรือประโยชน์จากการส่งเสริมการขาย',
    other: 'เงินได้อื่น ๆ (ระบุ)'
  }),
  conditions: Object.freeze({ 1: 'หัก ณ ที่จ่าย', 2: 'ออกให้ตลอดไป', 3: 'ออกให้ครั้งเดียว', 4: 'อื่น ๆ (ระบุ)' }),
  conditionUnsupported: 'เงื่อนไข (4) อื่น ๆ ยังไม่รองรับในเดโม',
  vatBases: Object.freeze({ included: `ยอดนี้รวม VAT ${WHT_VAT_PERCENT}% แล้ว (ผู้รับเงินจด VAT) — ฐาน = ยอด ÷ ${WHT_VAT_DIVISOR_TEXT}`, none: 'ยอดนี้ไม่มี VAT (ผู้รับเงินไม่ได้จด VAT) — ฐาน = ยอดเต็ม' }),
  vatBasisPick: '— เลือก (ต้องตอบ) —',
  // 50 ทวิ (form wording)
  certTitle: 'หนังสือรับรองการหักภาษี ณ ที่จ่าย',
  certSubtitle: 'ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร',
  copy1: 'ฉบับที่ 1 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย ใช้แนบพร้อมกับแบบแสดงรายการภาษี)',
  copy2: 'ฉบับที่ 2 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย เก็บไว้เป็นหลักฐาน)',
  bookNo: 'เล่มที่',
  certNo: 'เลขที่',
  payer: 'ผู้มีหน้าที่หักภาษี ณ ที่จ่าย',
  payee: 'ผู้ถูกหักภาษี ณ ที่จ่าย',
  name: 'ชื่อ',
  address: 'ที่อยู่',
  taxId: 'เลขประจำตัวผู้เสียภาษีอากร (13 หลัก)',
  branchNo: 'สาขาที่',
  seqInForm: 'ลำดับที่',
  inForm: 'ในแบบ',
  formBoxes: Object.freeze(['ภ.ง.ด.1ก', 'ภ.ง.ด.1ก พิเศษ', 'ภ.ง.ด.2', 'ภ.ง.ด.3', 'ภ.ง.ด.2ก', 'ภ.ง.ด.3ก', 'ภ.ง.ด.53']),
  incomeHead: 'ประเภทเงินได้พึงประเมินที่จ่าย',
  dateHead: 'วัน เดือน หรือปีภาษี ที่จ่าย',
  paidHead: 'จำนวนเงินที่จ่าย',
  taxHead: 'ภาษีที่หักและนำส่งไว้',
  incomeRows: Object.freeze({
    1: '1. เงินเดือน ค่าจ้าง เบี้ยเลี้ยง โบนัส ฯลฯ ตามมาตรา 40 (1)',
    2: '2. ค่าธรรมเนียม ค่านายหน้า ฯลฯ ตามมาตรา 40 (2)',
    3: '3. ค่าแห่งลิขสิทธิ์ ฯลฯ ตามมาตรา 40 (3)',
    4: '4. (ก) ดอกเบี้ย ฯลฯ ตามมาตรา 40 (4) (ก) · (ข) เงินปันผล เงินส่วนแบ่งกำไร ฯลฯ ตามมาตรา 40 (4) (ข)',
    5: '5. การจ่ายเงินได้ที่ต้องหักภาษี ณ ที่จ่าย ตามคำสั่งกรมสรรพากรที่ออกตามมาตรา 3 เตรส เช่น รางวัล ส่วนลดหรือประโยชน์ใด ๆ เนื่องจากการส่งเสริมการขาย ค่าจ้างทำของ ค่าโฆษณา ค่าเช่า ค่าขนส่ง ค่าบริการ ค่าเบี้ยประกันวินาศภัย ฯลฯ',
    6: '6. อื่น ๆ (ระบุ)'
  }),
  specify: 'ระบุ',
  totalRow: 'รวมเงินที่จ่ายและภาษีที่หักนำส่ง',
  totalWords: 'รวมเงินภาษีที่หักนำส่ง (ตัวอักษร)',
  funds: 'เงินที่จ่ายเข้า กบข./กสจ./กองทุนสงเคราะห์ครูโรงเรียนเอกชน ........ บาท · กองทุนประกันสังคม ........ บาท · กองทุนสำรองเลี้ยงชีพ ........ บาท',
  payerCondition: 'ผู้จ่ายเงิน',
  certify: 'ขอรับรองว่าข้อความและตัวเลขดังกล่าวข้างต้นถูกต้องตรงกับความจริงทุกประการ',
  signature: 'ลงชื่อ ................................................ ผู้จ่ายเงิน',
  issueDate: 'วัน เดือน ปี ที่ออกหนังสือรับรองฯ',
  seal: 'ประทับตรานิติบุคคล (ถ้ามี)',
  // ใบแนบ ภ.ง.ด.3 / 53 (§5b2)
  attachTitle: form => `ใบแนบ ${WHT_TEXT.forms[form] || form}`,
  colSeq: 'ลำดับที่',
  colTaxId: 'เลขประจำตัวผู้เสียภาษีอากร',
  colBranch: 'สาขาที่',
  colNameAddress3: 'ชื่อผู้มีเงินได้ / ที่อยู่ของผู้มีเงินได้',
  colNameAddress53: 'ชื่อและที่อยู่ของผู้มีเงินได้',
  colPaidDate: 'วัน เดือน ปี ที่จ่าย',
  colIncome3: 'ประเภทเงินได้',
  colIncome53: 'ประเภทเงินได้พึงประเมินที่จ่าย',
  colRate: 'อัตราภาษีร้อยละ',
  colAmount3: 'จำนวนเงินที่จ่ายแต่ละประเภท',
  colAmount53: 'จำนวนเงินที่จ่ายในครั้งนี้',
  colTax: 'จำนวนเงินภาษีที่หักและนำส่ง',
  colCondition: 'เงื่อนไข',
  totalLabel: 'รวม',
  conditionKey: '1 = หัก ณ ที่จ่าย · 2 = ออกให้ตลอดไป · 3 = ออกให้ครั้งเดียว',
  sectionNote: Object.freeze({ PND3: 'ยื่นตามมาตรา 3 เตรส แห่งประมวลรัษฎากร', PND53: 'ยื่นตามมาตรา 3 เตรส แห่งประมวลรัษฎากร' }),
  // plan / validation
  errType: 'กรุณาเลือกประเภทเงินได้ที่หัก ณ ที่จ่าย',
  errRate: 'กรุณาเลือกอัตราภาษีหัก ณ ที่จ่าย',
  errIncomeText: 'กรุณาระบุประเภทเงินได้ (อื่น ๆ)',
  errCondition: 'เงื่อนไขการหักภาษีไม่ถูกต้อง',
  errEntity: 'กรุณาเลือกประเภทผู้ถูกหักภาษี: บุคคลธรรมดา (ภ.ง.ด.3) หรือนิติบุคคล (ภ.ง.ด.53)',
  errPayeeName: 'กรุณาระบุชื่อผู้ถูกหักภาษี ณ ที่จ่าย',
  // AC5.8 — the exact wording of the spec, + where to fix it.
  errPayeeTaxId: 'ต้องมีเลขประจำตัวผู้เสียภาษี 13 หลัก ของผู้ถูกหักภาษี จึงจะออกหนังสือรับรอง 50 ทวิ ได้ — แก้ที่ทะเบียนผู้จำหน่ายหรือช่องเลขประจำตัวในส่วนหัก ณ ที่จ่าย',
  errPayeeBranch: 'สาขาของผู้ถูกหักภาษี (นิติบุคคล) ต้องเป็นเลข 5 หลัก เช่น 00000 = สำนักงานใหญ่',
  errBase: 'ฐานภาษีหัก ณ ที่จ่ายต้องมากกว่า 0',
  errVatBasis: 'กรุณาเลือกว่ายอดค่าใช้จ่ายนี้รวม VAT แล้วหรือไม่ (ฐานภาษีหัก ณ ที่จ่ายต้องเป็นยอดก่อน VAT) — ผู้รับเงินจด VAT หรือยังไม่ทราบ ระบบจึงไม่เดาให้',
  warnDerivedBase: (gross, base) => `ยังไม่มีใบกำกับภาษี (ไม่มียอดแยก VAT) — คุณเลือกว่ายอด ${gross} บาทรวม VAT ${WHT_VAT_PERCENT}% แล้ว: ฐานภาษีหัก ณ ที่จ่าย = ${gross} ÷ ${WHT_VAT_DIVISOR_TEXT} = ${base} บาท (ไม่ใช้ยอดรวม VAT) · ถ้าผู้รับเงินไม่ได้จด VAT ให้เลือก "ยอดนี้ไม่มี VAT"`,
  warnAssumedNoVat: reason => `ถือว่ายอดนี้ไม่มี VAT (ฐาน = ยอดเต็ม) เพราะ${reason === 'payee' ? 'ทะเบียนผู้จำหน่ายระบุว่าผู้รับเงินไม่ได้จด VAT' : 'เอกสารไม่ใช่ใบกำกับภาษี (ใบเสร็จธรรมดาไม่มี VAT ให้แยก)'} — ถ้าไม่ใช่ ให้เลือกในช่อง "ยอดค่าใช้จ่ายนี้รวม VAT แล้วหรือไม่"`,
  errVatBasisPayeeVat: 'ผู้รับเงินจด VAT แต่ยังไม่มียอดแยก VAT — กรุณาเลือกว่ายอดนี้รวม VAT แล้วหรือไม่',
  errBaseAboveAmount: amount => `ฐานภาษีหัก ณ ที่จ่ายต้องไม่เกินยอดก่อน VAT ของค่าใช้จ่ายนี้ (${amount} บาท)`,
  errPaymentDate: 'กรุณาระบุวันที่จ่ายเงินให้ถูกต้อง',
  errContractTotal: 'จ่ายตามสัญญา: กรุณากรอกยอดเงินทั้งสัญญา (บาท) เป็นตัวเลขมากกว่า 0',
  errContractBelowPayment: total => `ยอดทั้งสัญญาต้องไม่น้อยกว่ายอดที่จ่ายครั้งนี้ (${total} บาท)`,
  paymentDateNote: (paid, period) => `วันที่จ่ายเงิน ${paid} — หนังสือรับรอง 50 ทวิ ลงวันที่นี้ และยื่นใน ภ.ง.ด. เดือน ${period}`,
  warnTaxIdCheck: taxId => `เลขประจำตัวผู้เสียภาษีของผู้ถูกหักภาษี ${taxId} หลักสุดท้ายไม่ตรงกับเลขตรวจสอบ — ตรวจอีกครั้ง`,
  warnCompanyTaxId: 'เลขประจำตัวของนิติบุคคลมักขึ้นต้นด้วย 0 — ตรวจประเภทผู้ถูกหักภาษี (ภ.ง.ด.53)',
  warnPersonTaxId: 'เลขที่ขึ้นต้นด้วย 0 มักเป็นนิติบุคคล — ถ้าเป็นบริษัท/ห้างหุ้นส่วนนิติบุคคล ให้เลือก ภ.ง.ด.53',
  warnNoAddress: 'ยังไม่มีที่อยู่ผู้ถูกหักภาษี — หนังสือรับรอง 50 ทวิ ควรมีที่อยู่ครบ',
  // r13#HIGH-3: never "ไม่ต้องหัก" for a payment that may belong to a contract — the threshold is per contract.
  warnBelowThreshold: (base, threshold) => `ยอดครั้งนี้ (ก่อน VAT) ${base} บาท ต่ำกว่า ${threshold} บาท และไม่ได้ระบุว่าจ่ายตามสัญญา — ยังไม่ได้หักและยังไม่ออก 50 ทวิ · ถ้าจ่ายตามสัญญาที่ยอดทั้งสัญญาตั้งแต่ ${threshold} บาทขึ้นไป (เช่น ค่าเช่ารายเดือน) ต้องหัก ณ ที่จ่าย: ติ๊ก "จ่ายตามสัญญา" แล้วกรอกยอดทั้งสัญญา (หรือเลือก "หักแม้ยอดต่ำกว่า 1,000 บาท")`,
  warnBelowThresholdContract: (total, threshold) => `ยอดทั้งสัญญา ${total} บาท ต่ำกว่า ${threshold} บาท — ไม่ถึงเกณฑ์หัก ณ ที่จ่าย จึงไม่ได้หักและไม่ออก 50 ทวิ (ถ้าต้องการหัก ให้เลือก "หักแม้ยอดต่ำกว่า 1,000 บาท")`,
  contractWithheld: (base, total) => `จ่ายตามสัญญา: ยอดครั้งนี้ ${base} บาท แต่ยอดทั้งสัญญา ${total} บาท ถึงเกณฑ์ 1,000 บาท — ต้องหัก ณ ที่จ่ายทุกงวด`,
  warnPayerBorne: (amount, condition) => `ภาษี ${amount} บาท ผู้จ่ายออกให้ (${condition}) — เป็นค่าใช้จ่ายเพิ่มของบริษัท ไม่ได้หักจากผู้รับเงิน`,
  warnPayerBorneOnce: (borne, fromPayee, tax) => `ออกให้ครั้งเดียว: บริษัทออกภาษีให้ ${borne} บาท (ค่าใช้จ่ายของบริษัท) · ภาษีอีก ${fromPayee} บาทที่เกิดจากเงินได้ส่วนที่ออกให้ หักจากผู้รับเงิน · นำส่งรวม ${tax} บาท — สูตรนี้อ้างอิงแหล่งรอง (PEAK) ให้นักบัญชียืนยันก่อนใช้จริง`,
  // r13 "ยืนยันไม่ได้": shown on the WHT tabs — questions for an accountant, never a silent guess.
  expertNotes: Object.freeze([
    'e-Withholding Tax (หัก 1% เมื่อจ่ายผ่านธนาคารที่ร่วมโครงการ ช่วง 1 ม.ค. 2569 – 31 ธ.ค. 2570) ยังไม่รองรับ — ถ้าจ่ายด้วย e-WHT ให้ถามนักบัญชีว่าต้องออก 50 ทวิ / ยื่น ภ.ง.ด. หรือไม่',
    'ภ.ง.ด.3/53 ในเดโมแยกตามสถานประกอบการผู้จ่าย — ถามนักบัญชีว่าสำนักงานใหญ่ยื่นแทนสาขาได้หรือไม่',
    'ผู้จ่ายควรเก็บสำเนา 50 ทวิ (ฉบับที่ 3 / สำเนา) ไว้เป็นหลักฐาน — ระบบเก็บข้อมูลทุกฉบับไว้ให้พิมพ์ซ้ำได้',
    'ค่าบริการอินเทอร์เน็ต / โทรคมนาคมที่จ่ายให้ผู้ให้บริการเอกชน อาจต้องหัก 3% — ตรวจกับนักบัญชี (ข้อมูลตัวอย่างไม่หัก)',
    'เกณฑ์ 1,000 บาทใช้ต่อสัญญา (ไม่ใช่ต่อครั้ง) และฐานภาษีไม่รวม VAT — ตามแนวปฏิบัติและเอกสารสรรพากรภาค 5 ยังไม่ได้อ้างข้อคำสั่งฉบับจริง'
  ]),
  // filings
  errFilingsStore: 'ข้อมูลการยื่น ภ.ง.ด.3/53 ที่บันทึกไว้อ่านไม่ได้หรือไม่ถูกต้อง',
  errFilingField: field => `ข้อมูลการยื่น ภ.ง.ด. ช่อง ${field} ไม่ถูกต้อง`,
  errNothingToFile: 'เดือนนี้ไม่มีรายการหัก ณ ที่จ่าย — ไม่ต้องยื่นแบบ (ยื่นเฉพาะเดือนที่มีการหักภาษี)',
  efilingCheckLatest: 'พ้นช่วงขยายเวลายื่นทางอินเทอร์เน็ต (ถึง 31 ม.ค. 2570) — ตรวจสอบประกาศกรมสรรพากรล่าสุด',
  dueDateNote: 'วันครบกำหนดเลื่อนพ้นวันเสาร์-อาทิตย์และวันหยุดราชการตามตารางในระบบ (ปี 2569 ตามประกาศวันหยุดราชการ · ปี 2570 ตามประกาศ ธปท. ที่ 37/2569 ยังรอมติ ครม.) — ตรวจปฏิทินภาษีของกรมสรรพากรอีกครั้ง',
  ledgerDuplicate: (branch, no, count) => `เลขที่หนังสือรับรอง 50 ทวิ ${no} (${branch}) ถูกใช้ซ้ำ ${count} ฉบับ — เลขที่ต้องไม่ซ้ำ รวมฉบับที่ยกเลิก`
});

export const WHT_INCOME_TYPES = Object.freeze([
  Object.freeze({ code: 'service', rate: 3, row: 5, thresholdBaht: WHT_THRESHOLD_BAHT }),
  Object.freeze({ code: 'hire_of_work', rate: 3, row: 5, thresholdBaht: WHT_THRESHOLD_BAHT }),
  Object.freeze({ code: 'professional', rate: 3, row: 5, thresholdBaht: WHT_THRESHOLD_BAHT }),
  Object.freeze({ code: 'rent', rate: 5, row: 5, thresholdBaht: WHT_THRESHOLD_BAHT }),
  Object.freeze({ code: 'advertising', rate: 2, row: 5, thresholdBaht: WHT_THRESHOLD_BAHT }),
  Object.freeze({ code: 'transport', rate: 1, row: 5, thresholdBaht: WHT_THRESHOLD_BAHT }),
  Object.freeze({ code: 'prize', rate: null, row: 5, thresholdBaht: WHT_THRESHOLD_BAHT }),
  Object.freeze({ code: 'other', rate: null, row: 6, thresholdBaht: WHT_THRESHOLD_BAHT })
]);
// The expense keys this module owns (planExpenseDocumentAction strips them before applying the plan).
export const EXPENSE_WHT_FIELD_KEYS = Object.freeze(['whtEnabled', 'payeeEntityType', 'payeeName', 'payeeTaxId', 'payeeBranchCode', 'payeeAddress', 'payeeVatRegistered', 'whtForm', 'whtIncomeType', 'whtIncomeLabel', 'whtIncomeRow', 'whtRate', 'whtCondition', 'whtVatBasis', 'whtAgreedBase', 'whtBase', 'whtAmount', 'whtPayerBorne', 'whtFromPayee', 'netPaid', 'whtBelowThresholdOverride', 'whtContract', 'whtContractTotal', 'whtContractRef', 'whtPaymentDate', 'whtCertId', 'whtCertNo']);
// r13#MED-1: the payee's VAT registration as Supplier Master records it ('yes' | 'no' | '' unknown).
export const WHT_PAYEE_VAT_STATES = Object.freeze(['yes', 'no', '']);

const whtText = value => String(value ?? '').trim();
const whtFinite = value => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
const whtMoney = value => roundMoneyValue(whtFinite(value));
const whtIsObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const whtHas = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const whtCleanLine = value => whtText(value).replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim();
const whtShow = value => whtFinite(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whtParseNumber = value => { if (value === null || value === undefined) return NaN; const text = String(value).replace(/,/g, '').trim(); if (!text) return NaN; const n = Number(text); return Number.isFinite(n) ? n : NaN; };

export function whtIncomeType(code) {
  return WHT_INCOME_TYPES.find(row => row.code === code) || null;
}
export function whtIncomeLabel(code, text = '') {
  const label = WHT_TEXT.incomeTypes[code] || '';
  return (code === 'other' || code === 'prize') && whtCleanLine(text) ? `${code === 'other' ? '' : `${label} — `}${whtCleanLine(text).slice(0, 80)}` : label;
}
// 'company' → ภ.ง.ด.53; 'person' (incl. the master's 'individual') → ภ.ง.ด.3.
export function whtFormOf(entityType) {
  return entityType === 'company' ? 'PND53' : entityType === 'person' || entityType === 'individual' ? 'PND3' : '';
}
// Supplier Master entityType → the payee type of the form; '' when unknown (the TIN prefix is only a hint).
export function whtPayeeEntityOf(contact = {}) {
  const type = whtText(contact?.entityType);
  if (type === 'company') return 'company';
  if (type === 'person' || type === 'individual') return 'person';
  return '';
}

// The WHT figures of one payment (cond 1 / 2 / 3). `base` is the agreed pre-VAT amount; `total` the money
// the supplier invoiced (VAT included) — what the payee receives in cash is netPaid.
// Invariant for every condition: netPaid = total + payerBorne − whtAmount (the cash leaving the bank), and
// whtAmount = payerBorne + fromPayee (what is remitted = what the company bears + what is deducted from the payee).
export function calculateWht({ base, rate, condition = 1, total } = {}) {
  const agreed = whtMoney(base), pct = whtFinite(rate), gross = whtMoney(total ?? base);
  const cond = Number(condition);
  if (!(pct > 0) || !(agreed > 0)) return { agreedBase: agreed, amountPaid: agreed, whtAmount: 0, netPaid: gross, payerBorne: 0, fromPayee: 0, rate: pct, condition: cond };
  if (cond === 2) {
    // Gross-up: the payee's income is base ÷ (1 − r) (computed in whole percent to avoid binary noise).
    const amountPaid = roundMoneyValue(agreed * 100 / (100 - pct));
    const whtAmount = roundMoneyValue(amountPaid - agreed);
    return { agreedBase: agreed, amountPaid, whtAmount, netPaid: gross, payerBorne: whtAmount, fromPayee: 0, rate: pct, condition: cond };
  }
  const whtAmount = roundMoneyValue(agreed * pct / 100);
  if (cond === 3) {
    // ออกให้ครั้งเดียว: the tax the payer bears once (round(base × r)) is itself income of the payee and is taxed once
    // (no further gross-up): amount paid = base + round(base × r), tax = round(amount paid × r) — 10,000 @ 3 % →
    // 10,300 / 309 on the 50 ทวิ (r8fix#A2). r13#HIGH-1: the company bears ONLY the first 300; the 9 baht of tax on
    // the borne 300 is deducted from the payee, who receives 10,000 − 9 = 9,991 (+ VAT 700 = 10,691). PEAK worked
    // example (intercom.help/peak/en/articles/6211061), a secondary source — an accountant must confirm (§5c.5).
    const first = whtAmount;
    const amountPaid = roundMoneyValue(agreed + first);
    const taxOnce = roundMoneyValue(amountPaid * pct / 100);
    const fromPayee = roundMoneyValue(taxOnce - first);
    return { agreedBase: agreed, amountPaid, whtAmount: taxOnce, netPaid: roundMoneyValue(gross - fromPayee), payerBorne: first, fromPayee, rate: pct, condition: cond };
  }
  return { agreedBase: agreed, amountPaid: agreed, whtAmount, netPaid: roundMoneyValue(gross - whtAmount), payerBorne: 0, fromPayee: whtAmount, rate: pct, condition: 1 };
}

// The pre-VAT money of a payment (r8fix#A1): the purchase-VAT split when the expense has one; otherwise the user's
// statement `whtVatBasis` — 'none' (no VAT: base = the amount) or 'included' (the default: base = amount ÷ (1 + VAT rate),
// half-up to the satang, the same split calculateVatSummary 'extract' gives, flagged `derived` for a warning).
// → { ok, basis 'split' | 'included' | 'none', gross, preVat, derived } | { ok: false, error }.
// r13#MED-1: no silent 'included' default. Without a split and without a stated basis:
//   payee recorded as NOT VAT-registered (payeeVatRegistered 'no')              → 'none' (assumed: 'payee')
//   payee VAT-registered ('yes')                                               → refused: the user must choose
//   unknown payee + evidence that is not a tax-invoice type (plain receipt …)  → 'none' (assumed: 'document')
//   unknown payee + a tax-invoice evidence type (invoice not in hand yet)      → refused: the user must choose
export function whtPreVatOf(draft = {}) {
  const hasSplit = ['add', 'extract', 'none'].includes(draft.vatMode) && Number.isFinite(Number(draft.subtotal)) && draft.subtotal !== '' && draft.subtotal !== null;
  if (hasSplit) {
    const gross = whtMoney(Number.isFinite(Number(draft.vatAmt)) ? whtFinite(draft.subtotal) + whtFinite(draft.vatAmt) : draft.amount);
    return { ok: true, basis: 'split', gross, preVat: whtMoney(draft.subtotal), derived: false, assumed: '' };
  }
  const gross = whtMoney(draft.amount);
  const stated = whtText(draft.whtVatBasis);
  if (stated && !WHT_VAT_BASES.includes(stated)) return { ok: false, error: WHT_TEXT.errVatBasis };
  let choice = stated, assumed = '';
  if (!choice) {
    const vatState = whtText(draft.payeeVatRegistered);
    if (vatState === 'no') { choice = 'none'; assumed = 'payee'; }
    else if (vatState === 'yes') return { ok: false, error: WHT_TEXT.errVatBasisPayeeVat };
    else if (!EXPENSE_TAX_INVOICE_DOC_TYPES.includes(whtText(draft.docType))) { choice = 'none'; assumed = 'document'; }
    else return { ok: false, error: WHT_TEXT.errVatBasis };
  }
  if (choice === 'none') return { ok: true, basis: 'none', gross, preVat: gross, derived: false, assumed };
  return { ok: true, basis: 'included', gross, preVat: whtMoney(calculateVatSummary(gross, 'extract').subtotal), derived: gross > 0, assumed: '' };
}

// The WHT part of an expense draft. Never throws: { ok, fields | null, warnings, error }.
// fields null = no withholding stored (not ticked, or below the threshold without the override).
// draft: the expense (amount, vatMode / subtotal when it carries the purchase-VAT split, vendor, date) +
//   whtEnabled, payeeEntityType, whtIncomeType, whtRate, whtIncomeText, whtCondition, whtBaseInput,
//   whtBelowThresholdOverride, payeeName, payeeTaxId, payeeBranchCode, payeeAddress, whtVatBasis (no split only).
export function planExpenseWhtFields(draft = {}) {
  if (draft.whtEnabled !== true) return { ok: true, fields: null, warnings: [] };
  const warnings = [];
  const type = whtIncomeType(whtText(draft.whtIncomeType));
  if (!type) return { ok: false, error: WHT_TEXT.errType };
  let rate = type.rate;
  if (rate === null) {
    rate = Number(draft.whtRate);
    if (!WHT_RATE_CHOICES.includes(rate)) return { ok: false, error: WHT_TEXT.errRate };
  }
  const incomeText = whtCleanLine(draft.whtIncomeText);
  if (type.code === 'other' && !incomeText) return { ok: false, error: WHT_TEXT.errIncomeText };
  const condition = Number(draft.whtCondition || 1);
  if (condition === 4) return { ok: false, error: WHT_TEXT.conditionUnsupported };
  if (!WHT_SUPPORTED_CONDITIONS.includes(condition)) return { ok: false, error: WHT_TEXT.errCondition };
  if (!parseBusinessDate(draft.date)) return { ok: false, error: WHT_TEXT.errPaymentDate };
  // r13#MED-2: the date the money is paid (default: the expense date) — the 50 ทวิ date and the ภ.ง.ด. month.
  const paymentDate = whtText(draft.whtPaymentDate).slice(0, 10) || whtText(draft.date).slice(0, 10);
  if (!parseBusinessDate(paymentDate) || !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) return { ok: false, error: WHT_TEXT.errPaymentDate };
  const money = whtPreVatOf(draft);
  if (!money.ok) return { ok: false, error: money.error };
  const { gross, preVat } = money;
  if (money.derived) warnings.push(WHT_TEXT.warnDerivedBase(whtShow(gross), whtShow(preVat)));
  if (money.assumed) warnings.push(WHT_TEXT.warnAssumedNoVat(money.assumed));
  const typed = whtParseNumber(draft.whtBaseInput);
  const base = Number.isFinite(typed) ? whtMoney(typed) : preVat;
  if (!(base > 0)) return { ok: false, error: WHT_TEXT.errBase };
  if (base > preVat + 0.001) return { ok: false, error: WHT_TEXT.errBaseAboveAmount(preVat.toFixed(2)) };
  // r13#HIGH-3: a payment under a contract is tested on the CONTRACT total (max(base, total)); without a contract, on
  // this payment's own pre-VAT amount.
  const contract = draft.whtContract === true;
  let contractTotal = 0;
  if (contract) {
    contractTotal = whtParseNumber(draft.whtContractTotal);
    if (!Number.isFinite(contractTotal) || !(contractTotal > 0)) return { ok: false, error: WHT_TEXT.errContractTotal };
    contractTotal = whtMoney(contractTotal);
    if (contractTotal + 0.001 < base) return { ok: false, error: WHT_TEXT.errContractBelowPayment(whtShow(base)) };
  }
  const tested = contract ? Math.max(base, contractTotal) : base;
  const threshold = type.thresholdBaht.toLocaleString('en-US');
  if (tested < type.thresholdBaht && draft.whtBelowThresholdOverride !== true) {
    return { ok: true, fields: null, warnings: [...warnings, contract ? WHT_TEXT.warnBelowThresholdContract(whtShow(contractTotal), threshold) : WHT_TEXT.warnBelowThreshold(base.toFixed(2), threshold)] };
  }
  if (contract && base < type.thresholdBaht) warnings.push(WHT_TEXT.contractWithheld(whtShow(base), whtShow(contractTotal)));
  const entity = whtText(draft.payeeEntityType);
  const form = whtFormOf(entity);
  if (!form) return { ok: false, error: WHT_TEXT.errEntity };
  const payeeName = whtCleanLine(draft.payeeName || draft.vendor);
  if (!payeeName) return { ok: false, error: WHT_TEXT.errPayeeName };
  const taxId = normalizeTaxIdText(draft.payeeTaxId);
  if (!/^\d{13}$/.test(taxId)) return { ok: false, error: WHT_TEXT.errPayeeTaxId };
  if (!isValidThaiTaxId(taxId)) warnings.push(WHT_TEXT.warnTaxIdCheck(taxId));
  if (form === 'PND53' && !taxId.startsWith('0')) warnings.push(WHT_TEXT.warnCompanyTaxId);
  if (form === 'PND3' && taxId.startsWith('0')) warnings.push(WHT_TEXT.warnPersonTaxId);
  let branchCode = '';
  if (form === 'PND53') {
    const raw = whtText(draft.payeeBranchCode) || '00000';
    branchCode = normalizeBuyerBranchCode(/^\d{1,5}$/.test(raw) ? raw.padStart(5, '0') : raw);
    if (!branchCode) return { ok: false, error: WHT_TEXT.errPayeeBranch };
  }
  const address = whtCleanLine(draft.payeeAddress).slice(0, 300);
  if (!address) warnings.push(WHT_TEXT.warnNoAddress);
  const figures = calculateWht({ base, rate, condition, total: gross });
  if (condition === 3) warnings.push(WHT_TEXT.warnPayerBorneOnce(figures.payerBorne.toFixed(2), figures.fromPayee.toFixed(2), figures.whtAmount.toFixed(2)));
  else if (figures.payerBorne > 0) warnings.push(WHT_TEXT.warnPayerBorne(figures.payerBorne.toFixed(2), WHT_TEXT.conditions[condition]));
  if (paymentDate !== whtText(draft.date).slice(0, 10)) warnings.push(WHT_TEXT.paymentDateNote(taxThaiDate(paymentDate), taxThaiDate(paymentDate).slice(3)));
  const vatState = WHT_PAYEE_VAT_STATES.includes(whtText(draft.payeeVatRegistered)) ? whtText(draft.payeeVatRegistered) : '';
  return {
    ok: true,
    warnings,
    fields: {
      whtEnabled: true,
      payeeEntityType: entity === 'individual' ? 'person' : entity,
      payeeName,
      payeeTaxId: taxId,
      payeeBranchCode: branchCode,
      payeeAddress: address,
      payeeVatRegistered: vatState,
      whtForm: form,
      whtIncomeType: type.code,
      whtIncomeLabel: whtIncomeLabel(type.code, incomeText),
      whtIncomeRow: type.row,
      whtRate: rate,
      whtCondition: condition,
      whtVatBasis: money.basis,
      whtAgreedBase: figures.agreedBase,
      whtBase: figures.amountPaid,
      whtAmount: figures.whtAmount,
      whtPayerBorne: figures.payerBorne,
      whtFromPayee: figures.fromPayee,
      netPaid: figures.netPaid,
      whtBelowThresholdOverride: tested < type.thresholdBaht,
      whtContract: contract,
      whtContractTotal: contract ? contractTotal : 0,
      whtContractRef: contract ? whtCleanLine(draft.whtContractRef).slice(0, 80) : '',
      whtPaymentDate: paymentDate
    }
  };
}

// ---------------------------------------------------------------- 50 ทวิ certificate
// r13#MED-2: the date the WHT money was paid (the 50 ทวิ date / ภ.ง.ด. month): whtPaymentDate, else the expense date.
export function whtPaymentDateOf(expense = {}) {
  const paid = whtText(expense?.whtPaymentDate).slice(0, 10);
  return parseBusinessDate(paid) && /^\d{4}-\d{2}-\d{2}$/.test(paid) ? paid : whtText(expense?.date).slice(0, 10);
}
export function isWhtCertificateLive(record) {
  return !!record && !record.voided && !record.cancelled && record.status !== 'voided' && record.status !== 'cancelled';
}
// เล่มที่ = the พ.ศ. year of the payment; the running เลขที่ continues per payer establishment and book.
export function whtCertificateBookOf(date) {
  const parts = parseBusinessDate(date);
  return parts ? String(parts.year + 543) : '';
}
export function nextWhtCertificateNumber(certificates = [], branch = '', bookNo = '') {
  let highest = 0;
  for (const row of Array.isArray(certificates) ? certificates : []) {
    if (whtText(row?.branch || row?._branch) !== whtText(branch) || whtText(row?.bookNo) !== whtText(bookNo)) continue;
    if (/^\d+$/.test(whtText(row?.certNo))) highest = Math.max(highest, Number(row.certNo));
  }
  return String(highest + 1).padStart(4, '0');
}
export function whtCertificateDisplayNo(record = {}) {
  return `${WHT_TEXT.bookNo} ${whtText(record.bookNo) || '-'} ${WHT_TEXT.certNo} ${whtText(record.certNo) || '-'}`;
}
// The stored certificate of an expense planned by planExpenseWhtFields().
//   input: { expense, branch, payer: { name, address, taxId, branchCode }, bookNo, certNo, id, at, by }
export function buildWhtCertificate(input = {}) {
  const expense = input.expense || {};
  const payer = input.payer || {};
  const at = whtText(input.at) || new Date().toISOString();
  const bookNo = whtText(input.bookNo), certNo = whtText(input.certNo);
  // The month pack the certificate lives in = the payment month (year + 0-based month, like every pack record).
  // r13#MED-2: the payment date (whtPaymentDate; older expenses: the expense date) — the date on the 50 ทวิ.
  const paidOn = whtPaymentDateOf(expense);
  const paid = parseBusinessDate(paidOn);
  return {
    id: input.id,
    documentKind: WHT_CERTIFICATE_KIND,
    no: `WHT${bookNo}-${certNo}`,
    bookNo,
    certNo,
    branch: whtText(input.branch),
    date: paidOn,
    year: paid ? paid.year : '',
    month: paid ? paid.month - 1 : '',
    form: expense.whtForm,
    payer: { name: whtCleanLine(payer.name), address: whtCleanLine(payer.address), taxId: normalizeTaxIdText(payer.taxId), branchCode: normalizeBuyerBranchCode(payer.branchCode) },
    payee: { name: expense.payeeName, address: expense.payeeAddress, taxId: expense.payeeTaxId, branchCode: expense.payeeBranchCode || '', entityType: expense.payeeEntityType },
    incomeRow: expense.whtIncomeRow,
    incomeType: expense.whtIncomeType,
    incomeLabel: expense.whtIncomeLabel,
    rate: expense.whtRate,
    condition: expense.whtCondition,
    amountPaid: whtMoney(expense.whtBase),
    taxWithheld: whtMoney(expense.whtAmount),
    taxText: bahtText(whtMoney(expense.whtAmount)),
    sourceExpenseId: expense.id,
    sourceExpenseNo: whtText(expense.docNo || expense.desc).slice(0, 120),
    status: 'issued',
    voided: false,
    createdAt: at,
    createdBy: whtText(input.by),
    updatedAt: at
  };
}
export function applyWhtCertificateVoid(record = {}, meta = {}) {
  const at = whtText(meta.at) || new Date().toISOString();
  return { ...record, voided: true, status: 'voided', voidedAt: at, voidedBy: whtText(meta.by), voidReason: whtText(meta.reason), updatedAt: at };
}
// One stored document per (establishment, number) — cancelled ones included (after a backup import).
export function whtCertificateLedgerIssues(certificates = [], branchLabel = branch => branch) {
  const groups = new Map();
  for (const row of Array.isArray(certificates) ? certificates : []) {
    const key = `${whtText(row?.branch || row?._branch)}|${whtText(row?.no)}`;
    if (!whtText(row?.no)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const issues = [];
  groups.forEach(rows => { if (rows.length > 1) issues.push({ type: 'duplicate_number', no: rows[0].no, message: WHT_TEXT.ledgerDuplicate(branchLabel(whtText(rows[0].branch || rows[0]._branch)), rows[0].no, rows.length) }); });
  return issues;
}

// ---------------------------------------------------------------- ใบแนบ ภ.ง.ด.3 / ภ.ง.ด.53 (§5b2)
// input: { period 'YYYY-MM', form 'PND3' | 'PND53', certificates: every certificate of the establishment }.
// Rows = live certificates of that form paid in the month, by date then เลขที่ (ลำดับที่ = row number; it is
// also the "ลำดับที่ … ในแบบ" printed on each certificate — whtCertificateSequence()).
export function buildWhtFormReport(input = {}) {
  const period = whtText(input.period), form = WHT_FORMS.includes(input.form) ? input.form : 'PND53';
  const rows = (Array.isArray(input.certificates) ? input.certificates : [])
    .filter(cert => isWhtCertificateLive(cert) && cert.form === form && taxPeriodOfDate(cert.date) === period)
    .sort((a, b) => (businessDateOrdinal(a.date) || 0) - (businessDateOrdinal(b.date) || 0) || whtText(a.certNo).localeCompare(whtText(b.certNo), 'en', { numeric: true }) || whtText(a.branch).localeCompare(whtText(b.branch)))
    .map((cert, index) => ({
      seq: index + 1,
      certId: cert.id,
      certNo: whtText(cert.no),
      branch: whtText(cert.branch),
      payeeTaxId: whtText(cert.payee?.taxId),
      payeeBranchCode: whtText(cert.payee?.branchCode),
      payeeName: whtText(cert.payee?.name),
      payeeAddress: whtText(cert.payee?.address),
      date: whtText(cert.date),
      incomeLabel: whtText(cert.incomeLabel),
      rate: whtFinite(cert.rate),
      amountPaid: whtMoney(cert.amountPaid),
      taxWithheld: whtMoney(cert.taxWithheld),
      condition: Number(cert.condition) || 1
    }));
  const payees = new Set(rows.map(row => `${row.payeeTaxId}|${row.payeeBranchCode}`));
  const totals = { count: rows.length, payees: payees.size, amountPaid: whtMoney(rows.reduce((sum, row) => sum + row.amountPaid, 0)), taxWithheld: whtMoney(rows.reduce((sum, row) => sum + row.taxWithheld, 0)) };
  return { kind: form, form, period, rows, totals };
}
// The "ลำดับที่ … ในแบบ" of one certificate: from the latest FILED snapshot that lists it (what the RD received),
// else its row number in the month's live report. 0 when it is not reported (cancelled).
export function whtCertificateSequence(certificate = {}, certificates = [], filings = []) {
  const period = taxPeriodOfDate(certificate.date);
  const filed = latestWhtFiling(filings, whtText(certificate.branch), period, certificate.form);
  const fromFiling = filed?.rows?.find(row => whtText(row.certId) === whtText(certificate.id));
  if (fromFiling) return fromFiling.seq;
  const report = buildWhtFormReport({ period, form: certificate.form, certificates });
  return report.rows.find(row => whtText(row.certId) === whtText(certificate.id))?.seq || 0;
}

const whtCol = (key, label, group = '', money = false) => Object.freeze({ key, label, group, money });
export const PND3_COLUMNS = Object.freeze([
  whtCol('seq', WHT_TEXT.colSeq), whtCol('payeeTaxId', WHT_TEXT.colTaxId), whtCol('nameAddress', WHT_TEXT.colNameAddress3),
  whtCol('date', WHT_TEXT.colPaidDate), whtCol('incomeLabel', WHT_TEXT.colIncome3), whtCol('rate', WHT_TEXT.colRate),
  whtCol('amountPaid', WHT_TEXT.colAmount3, '', true), whtCol('taxWithheld', WHT_TEXT.colTax, '', true), whtCol('condition', WHT_TEXT.colCondition)
]);
export const PND53_COLUMNS = Object.freeze([
  whtCol('seq', WHT_TEXT.colSeq), whtCol('payeeTaxId', WHT_TEXT.colTaxId, WHT_TEXT.colTaxId), whtCol('payeeBranchCode', WHT_TEXT.colBranch, WHT_TEXT.colTaxId),
  whtCol('nameAddress', WHT_TEXT.colNameAddress53), whtCol('date', WHT_TEXT.colPaidDate), whtCol('incomeLabel', WHT_TEXT.colIncome53),
  whtCol('rate', WHT_TEXT.colRate), whtCol('amountPaid', WHT_TEXT.colAmount53, '', true), whtCol('taxWithheld', WHT_TEXT.colTax, '', true), whtCol('condition', WHT_TEXT.colCondition)
]);
// → { columns, header, groups, body, footer } — the shape erp-tax-reports.js renders / prints / exports.
// Name and address share one cell ("ชื่อ / ที่อยู่"; `separator` joins them, a line break on screen and print).
export function whtReportTable(report = {}, separator = ' / ') {
  const columns = report.form === 'PND3' ? PND3_COLUMNS : PND53_COLUMNS;
  const cell = (row, key) => {
    if (key === 'date') return taxThaiDate(row.date);
    if (key === 'nameAddress') return [row.payeeName, row.payeeAddress].filter(Boolean).join(separator);
    if (key === 'rate') return row.rate;
    if (key === 'amountPaid' || key === 'taxWithheld') return whtMoney(row[key]);
    return row[key] ?? '';
  };
  const body = (report.rows || []).map(row => columns.map(column => cell(row, column.key)));
  const totals = report.totals || {};
  const footer = columns.map((column, index) => (index === 0 ? WHT_TEXT.totalLabel : column.key === 'amountPaid' ? whtMoney(totals.amountPaid) : column.key === 'taxWithheld' ? whtMoney(totals.taxWithheld) : ''));
  const groups = [];
  columns.forEach((column, index) => {
    const last = groups[groups.length - 1];
    if (column.group && last && last.label === column.group && last.from + last.span === index) last.span += 1;
    else groups.push({ label: column.group || column.label, from: index, span: 1, grouped: !!column.group });
  });
  return { columns, header: columns.map(column => column.label), groups, body, footer };
}

// ---------------------------------------------------------------- due dates (§0.2, AC5.7)
export function whtDueDates(period, deadlines = WHT_DEADLINES) {
  const next = addTaxPeriods(period, 1);
  if (!next) return null;
  const day = value => `${next}-${String(value).padStart(2, '0')}`;
  const paperBase = day(deadlines.paper), extended = day(deadlines.efiling);
  const withinExtension = businessDateOrdinal(extended) <= businessDateOrdinal(deadlines.efilingExtensionUntil);
  const efilingBase = withinExtension ? extended : paperBase;
  // r13#LOW-1: past weekends AND listed government holidays (taxDueDatePair, the same roll as ภ.พ.30).
  return taxDueDatePair(paperBase, efilingBase, withinExtension);
}

// ---------------------------------------------------------------- whtFilings snapshots
const WHT_FILING_FIELDS = Object.freeze(['id', 'schemaVersion', 'branch', 'period', 'form', 'amendment', 'rows', 'totals', 'channel', 'dueDate', 'filedAt', 'filedBy', 'payer', 'note', 'demoSeed', 'demoSeedBatch']);
const WHT_ROW_FIELDS = Object.freeze(['seq', 'certId', 'certNo', 'branch', 'payeeTaxId', 'payeeBranchCode', 'payeeName', 'payeeAddress', 'date', 'incomeLabel', 'rate', 'amountPaid', 'taxWithheld', 'condition']);
const whtFail = field => { const error = new Error(WHT_TEXT.errFilingField(field)); error.code = 'validation_error'; throw error; };
const whtStoreFail = () => { const error = new Error(WHT_TEXT.errFilingsStore); error.code = 'storage_error'; throw error; };
const whtMoneyField = (value, field) => { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e13) whtFail(field); return whtMoney(value); };
// One stored snapshot, validated field by field (throws a Thai message; the reader, backup validator and writer
// all use it fail-closed).
export function normalizeWhtFiling(value) {
  if (!whtIsObject(value)) whtFail('record');
  for (const key of Object.keys(value)) if (!WHT_FILING_FIELDS.includes(key)) whtFail(key);
  const id = whtText(value.id);
  if (!/^[\w.:-]{1,80}$/.test(id)) whtFail('id');
  if (Number(value.schemaVersion) !== WHT_FILING_SCHEMA_VERSION) whtFail('schemaVersion');
  const branch = whtText(value.branch);
  if (!['ubon', 'khonkaen'].includes(branch)) whtFail('branch');
  const period = whtText(value.period);
  if (!parseTaxPeriod(period)) whtFail('period');
  const form = whtText(value.form);
  if (!WHT_FORMS.includes(form)) whtFail('form');
  const amendment = Number(value.amendment);
  if (!Number.isInteger(amendment) || amendment < 0 || amendment > 99) whtFail('amendment');
  if (!Array.isArray(value.rows) || value.rows.length > 5000) whtFail('rows');
  const rows = value.rows.map((row, index) => {
    if (!whtIsObject(row)) whtFail(`rows.${index}`);
    for (const key of Object.keys(row)) if (!WHT_ROW_FIELDS.includes(key)) whtFail(`rows.${index}.${key}`);
    const seq = Number(row.seq);
    if (seq !== index + 1) whtFail(`rows.${index}.seq`);
    const condition = Number(row.condition);
    if (!WHT_SUPPORTED_CONDITIONS.includes(condition)) whtFail(`rows.${index}.condition`);
    const rate = Number(row.rate);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 100) whtFail(`rows.${index}.rate`);
    if (!/^\d{13}$/.test(whtText(row.payeeTaxId))) whtFail(`rows.${index}.payeeTaxId`);
    if (!parseBusinessDate(row.date) || taxPeriodOfDate(row.date) !== period) whtFail(`rows.${index}.date`);
    return {
      seq, certId: whtCleanLine(row.certId).slice(0, 80), certNo: whtCleanLine(row.certNo).slice(0, 40), branch,
      payeeTaxId: whtText(row.payeeTaxId), payeeBranchCode: normalizeBuyerBranchCode(row.payeeBranchCode), payeeName: whtCleanLine(row.payeeName).slice(0, 200),
      payeeAddress: whtCleanLine(row.payeeAddress).slice(0, 300), date: whtText(row.date), incomeLabel: whtCleanLine(row.incomeLabel).slice(0, 120),
      rate, amountPaid: whtMoneyField(row.amountPaid, `rows.${index}.amountPaid`), taxWithheld: whtMoneyField(row.taxWithheld, `rows.${index}.taxWithheld`), condition
    };
  });
  const totals = whtIsObject(value.totals) ? value.totals : whtFail('totals');
  const expected = { count: rows.length, payees: new Set(rows.map(row => `${row.payeeTaxId}|${row.payeeBranchCode}`)).size, amountPaid: whtMoney(rows.reduce((s, r) => s + r.amountPaid, 0)), taxWithheld: whtMoney(rows.reduce((s, r) => s + r.taxWithheld, 0)) };
  // The cover summary must be the sum of the rows (never a separately typed figure).
  for (const key of Object.keys(expected)) if (Number(totals[key]) !== expected[key]) whtFail(`totals.${key}`);
  const channel = whtText(value.channel);
  if (!['paper', 'efiling'].includes(channel)) whtFail('channel');
  const dueDate = whtText(value.dueDate);
  if (!parseBusinessDate(dueDate) || dueDate.length !== 10) whtFail('dueDate');
  const filedAt = whtText(value.filedAt);
  if (!filedAt || Number.isNaN(Date.parse(filedAt))) whtFail('filedAt');
  const payer = whtIsObject(value.payer) ? value.payer : {};
  const out = {
    id, schemaVersion: WHT_FILING_SCHEMA_VERSION, branch, period, form, amendment, rows, totals: expected, channel, dueDate, filedAt,
    filedBy: whtCleanLine(value.filedBy).slice(0, 120),
    payer: { name: whtCleanLine(payer.name).slice(0, 200), taxId: normalizeTaxIdText(payer.taxId).slice(0, 13), branchCode: normalizeBuyerBranchCode(payer.branchCode) },
    note: whtCleanLine(value.note).slice(0, 300)
  };
  if (value.demoSeed === true) Object.assign(out, { demoSeed: true, demoSeedBatch: whtText(value.demoSeedBatch).slice(0, 60) });
  return out;
}
// The stored collection { schemaVersion, filings } — absent = empty; anything damaged throws (fail-closed).
export function normalizeWhtFilingsStore(value) {
  if (value === null || value === undefined) return { schemaVersion: WHT_FILING_SCHEMA_VERSION, filings: [] };
  if (!whtIsObject(value) || Number(value.schemaVersion) !== WHT_FILING_SCHEMA_VERSION || !Array.isArray(value.filings)) whtStoreFail();
  for (const key of Object.keys(value)) if (!['schemaVersion', 'filings'].includes(key)) whtStoreFail();
  const filings = value.filings.map(normalizeWhtFiling);
  const ids = new Set(), slots = new Set();
  for (const row of filings) {
    const slot = `${row.branch}|${row.period}|${row.form}|${row.amendment}`;
    if (ids.has(row.id) || slots.has(slot)) whtStoreFail();
    ids.add(row.id); slots.add(slot);
  }
  return { schemaVersion: WHT_FILING_SCHEMA_VERSION, filings };
}
export function parseWhtFilingsStore(raw) {
  if (raw === null || raw === undefined || raw === '') return normalizeWhtFilingsStore(null);
  let parsed;
  try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { whtStoreFail(); }
  return normalizeWhtFilingsStore(parsed);
}
export function whtFilingsFor(filings = [], branch, period, form) {
  return (Array.isArray(filings) ? filings : []).filter(row => row.branch === branch && row.period === period && row.form === form).sort((a, b) => a.amendment - b.amendment);
}
export function latestWhtFiling(filings, branch, period, form) {
  const list = whtFilingsFor(filings, branch, period, form);
  return list.length ? list[list.length - 1] : null;
}
// The next snapshot (never overwrites: amendment = the number already filed for the slot).
//   input: { filings, id, branch, period, form, report (buildWhtFormReport), channel, filedAt, filedBy, payer }
export function buildWhtFilingSnapshot(input = {}) {
  const report = input.report || {};
  if (!(report.rows || []).length) { const error = new Error(WHT_TEXT.errNothingToFile); error.code = 'validation_error'; throw error; }
  const filed = whtFilingsFor(input.filings, input.branch, input.period, input.form);
  const due = whtDueDates(input.period);
  const channel = input.channel === 'efiling' ? 'efiling' : 'paper';
  return normalizeWhtFiling({
    id: input.id, schemaVersion: WHT_FILING_SCHEMA_VERSION, branch: input.branch, period: input.period, form: input.form, amendment: filed.length,
    rows: report.rows.map(row => ({ seq: row.seq, certId: String(row.certId ?? ''), certNo: row.certNo, branch: input.branch, payeeTaxId: row.payeeTaxId, payeeBranchCode: row.payeeBranchCode, payeeName: row.payeeName, payeeAddress: row.payeeAddress, date: row.date, incomeLabel: row.incomeLabel, rate: row.rate, amountPaid: row.amountPaid, taxWithheld: row.taxWithheld, condition: row.condition })),
    totals: report.totals, channel, dueDate: due ? due[channel] : '', filedAt: input.filedAt, filedBy: input.filedBy, payer: input.payer || {}, note: input.note || ''
  });
}
// Backup merge: a filed snapshot is immutable — the device copy of the same id / slot wins, rows only in the
// backup are added. r8fix#B4: the same under "replace" (append-only history — dropping a filed ภ.ง.ด. would let
// its 50 ทวิ be cancelled). Both fully validated before anything is written; the option is accepted and ignored.
export function mergeWhtFilingsStores(current, incoming, options = {}) {
  void options;
  const next = normalizeWhtFilingsStore(incoming);
  const base = normalizeWhtFilingsStore(current);
  const ids = new Set(base.filings.map(row => row.id));
  const slots = new Set(base.filings.map(row => `${row.branch}|${row.period}|${row.form}|${row.amendment}`));
  const added = next.filings.filter(row => !ids.has(row.id) && !slots.has(`${row.branch}|${row.period}|${row.form}|${row.amendment}`));
  return normalizeWhtFilingsStore({ schemaVersion: WHT_FILING_SCHEMA_VERSION, filings: [...base.filings, ...added] });
}
// Does the current report differ from the latest filed snapshot (→ "ยื่นเพิ่มเติม")?
export function whtReportDiffersFromFiling(report = {}, filing = null) {
  if (!filing) return false;
  const now = (report.rows || []).map(row => `${row.certId}|${row.amountPaid}|${row.taxWithheld}`).join(',');
  const then = (filing.rows || []).map(row => `${row.certId}|${row.amountPaid}|${row.taxWithheld}`).join(',');
  return now !== then;
}
// A tax month (YYYY-MM) is "filed" for an establishment when any ภ.ง.ด. snapshot of it exists.
export function whtPeriodFiled(filings = [], branch, period, form = '') {
  return (Array.isArray(filings) ? filings : []).some(row => row.branch === branch && row.period === period && (!form || row.form === form));
}
export function whtThaiDate(value) {
  return taxThaiDate(value);
}
