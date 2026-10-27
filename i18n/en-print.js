// i18n/en-print.js — English secondary labels of the printed commercial documents (ADR-026). Plain data only.
// Used only when the screen language is English: quotation, delivery order / tax invoice (full and abbreviated),
// receipt, credit note and debit note print with Thai as the primary language and these English labels next to
// the Thai labels that do not already carry English. Government forms (50 Tawi, PP.30 worksheet, PND
// attachments) are never annotated: they stay exactly as the Revenue Department expects them, in Thai.
// Only text the document code itself writes is listed — names, addresses, notes, items and numbers (user data)
// are never matched, except by the PRINT_PREFIXES_EN labels in front of them ("เลขประจำตัวผู้เสียภาษี 0105…").

// The whole text of one node (whitespace-normalised) → English.
export const PRINT_LABELS_EN = Object.freeze([
  // headings and page notes
  ['(เอกสารออกเป็นชุด)', '(issued as a set)'],
  // ADR-031 multi-currency print
  ['ข้อมูลประกอบ (ไม่ใช่ยอดตามใบกำกับภาษี)', 'For information (not the tax-invoice amounts)'],
  ['มูลค่าเป็นเงินบาท', 'Value in baht'],
  ['ใบกำกับสินค้าส่งออก ใช้แทนใบกำกับภาษีตาม ป.132/2548 ข้อ 6 · ภาษีมูลค่าเพิ่มอัตราร้อยละ 0', 'Export invoice, used instead of a tax invoice (Por. 132/2548 clause 6) · VAT at 0%'],
  ['(เอกสารออกภายใน)', '(internal document)'],
  ['สำหรับพนักงานส่งภายใน', 'For internal delivery staff'],
  ['สำเนาใบส่งสินค้า/สำเนาใบกำกับภาษี', 'Delivery order copy / tax invoice copy'],
  ['สำเนาใบส่งสินค้า/สำเนาใบแจ้งหนี้', 'Delivery order copy / invoice copy'],
  ['มีรายการต่อหน้าถัดไป', 'Continued on the next page'],
  ['ไม่มีหมายเหตุเพิ่มเติม', 'No further remarks'],
  // party / document data labels
  ['เลขประจำตัวผู้เสียภาษีอากร', 'Tax ID'],
  ['เลขประจำตัวผู้เสียภาษี', 'Tax ID'],
  ['สำนักงานใหญ่', 'Head office'],
  ['ชื่อลูกค้า', 'Customer name'],
  ['ที่อยู่', 'Address'],
  ['เลขผู้เสียภาษี', 'Tax ID'],
  ['ผู้ติดต่อ', 'Contact'],
  ['ประเภทหน่วยงาน', 'Organization type'],
  ['เลขที่ใบเสนอราคา', 'Quotation no.'],
  ['วันที่เสนอราคา', 'Quotation date'],
  ['พนักงานขาย', 'Salesperson'],
  ['สถานะ', 'Status'],
  ['เงินสด', 'Cash'],
  ['อนุมัติแล้ว', 'Approved'],
  ['รอการอนุมัติ', 'Pending approval'],
  // item tables (where the header has no English yet)
  ['จำนวน', 'Qty'],
  ['หน่วย', 'Unit'],
  ['ราคา/หน่วย', 'Unit price'],
  ['จำนวนเงิน', 'Amount'],
  ['ใบกำกับภาษีเดิมเลขที่', 'Original tax invoice no.'],
  ['ลงวันที่', 'Dated'],
  ['มูลค่าตามใบกำกับภาษีเดิม', 'Value per original tax invoice'],
  ['มูลค่าที่ถูกต้อง', 'Correct value'],
  ['ผลต่าง', 'Difference'],
  // totals
  ['ยอดรวมก่อนภาษี', 'Subtotal before VAT'],
  ['ภาษีมูลค่าเพิ่ม 7%', 'VAT 7%'],
  ['ยอดรวมทั้งสิ้น', 'Grand total'],
  ['ภาษีมูลค่าเพิ่ม 7% ของผลต่าง', 'VAT 7% on the difference'],
  ['ภาษีที่เรียกเก็บเพิ่ม (VAT 7% ของผลต่าง)', 'Additional VAT (7% of the difference)'],
  ['ไม่มีภาษีมูลค่าเพิ่ม', 'No VAT'],
  ['ราคานี้ยังไม่รวมภาษีมูลค่าเพิ่ม 7% และแสดง VAT แยกด้านขวา', 'Prices exclude VAT 7%, shown separately on the right'],
  ['เอกสารฉบับนี้ไม่มีการคิด VAT เพิ่มจากยอดสินค้า', 'No VAT is added to the item amounts in this document'],
  ['ราคารวมภาษีมูลค่าเพิ่มแล้ว (VAT Included)', 'Prices include VAT'],
  ['ฐานราคาตามใบกำกับภาษีเดิม: ราคายังไม่รวม VAT — บวกเพิ่ม 7% · มูลค่าในตารางเป็นมูลค่าก่อนภาษีมูลค่าเพิ่ม', 'Price basis of the original tax invoice: VAT added on top (7%) · values in the table are before VAT'],
  ['ฐานราคาตามใบกำกับภาษีเดิม: ราคารวม VAT แล้ว — แยกภาษี · มูลค่าในตารางเป็นมูลค่าก่อนภาษีมูลค่าเพิ่ม', 'Price basis of the original tax invoice: VAT included (split out) · values in the table are before VAT'],
  ['ฐานราคาตามใบกำกับภาษีเดิม: ไม่มี VAT · มูลค่าในตารางเป็นมูลค่าก่อนภาษีมูลค่าเพิ่ม', 'Price basis of the original tax invoice: no VAT · values in the table are before VAT'],
  // payment notes and terms
  ['โปรดชำระเงินเข้าบัญชีของบริษัท', 'Please pay into the account of'],
  ['• สินค้าตามรายการข้างต้นยังเป็นกรรมสิทธิ์ของบริษัทฯ จนกว่าจะได้รับชำระเงินครบถ้วน', 'The goods listed above remain the property of the company until paid in full.'],
  ['หากมีข้อผิดพลาดใด ๆ ของสินค้าหรือเอกสาร โปรดแจ้งภายใน 7 วัน นับจากวันที่ส่งสินค้า มิฉะนั้นทางบริษัทฯ จะไม่รับผิดชอบ', 'Please report any error in the goods or this document within 7 days of delivery; after that the company accepts no liability.'],
  ['กรณีชำระเงินเกินกำหนด บริษัทฯ ขอสงวนสิทธิ์คิดดอกเบี้ยในอัตรา 2% ต่อเดือน นับจากวันที่ครบกำหนด', 'Late payment: the company reserves the right to charge interest at 2% per month from the due date.'],
  ['กรณีชำระเงินล่าช้า บริษัทฯ ขอสงวนสิทธิ์คิดดอกเบี้ยในอัตรา 2% ต่อเดือน นับจากวันที่ครบกำหนด', 'Late payment: the company reserves the right to charge interest at 2% per month from the due date.'],
  ['กรณีชำระเงินด้วยเช็ค ใบเสร็จรับเงินฉบับนี้จะสมบูรณ์เมื่อธนาคารเรียกเก็บเงินตามเช็คได้เรียบร้อยแล้ว', 'Payment by cheque: this receipt is valid only once the cheque has been cleared.'],
  ['ได้รับชำระเงินตามรายการข้างต้นเรียบร้อยแล้ว', 'Payment for the items above received in full.'],
  ['ขอบคุณที่ให้ความไว้วางใจในสินค้าและบริการของเรา', 'Thank you for your trust in our products and services.'],
  // signature boxes
  ['ได้รับสินค้าตามรายการข้างต้นไว้เรียบร้อยแล้วพร้อมต้นฉบับใบกำกับภาษี', 'Goods above received in good order, with the original tax invoice'],
  ['ได้รับสินค้าตามรายการข้างต้นไว้เรียบร้อยแล้วพร้อมสำเนาใบกำกับภาษี', 'Goods above received in good order, with a copy of the tax invoice'],
  ['ได้รับสินค้าตามรายการข้างต้นไว้เรียบร้อยแล้วพร้อมต้นฉบับใบแจ้งหนี้', 'Goods above received in good order, with the original invoice'],
  ['ได้รับสินค้าตามรายการข้างต้นไว้เรียบร้อยแล้วพร้อมสำเนาใบแจ้งหนี้', 'Goods above received in good order, with a copy of the invoice'],
  ['ได้รับต้นฉบับใบเสร็จรับเงินไว้เรียบร้อยแล้ว', 'Original receipt received'],
  ['ได้รับต้นฉบับใบลดหนี้ไว้เรียบร้อยแล้ว', 'Original credit note received'],
  ['ได้รับต้นฉบับใบเพิ่มหนี้ไว้เรียบร้อยแล้ว', 'Original debit note received']
]);

// A label in front of data in the same text ("เลขประจำตัวผู้เสียภาษี 0105568123453", "วันที่ 13 ตุลาคม 2569"):
// the English goes right after the label; the data after it is left exactly as it is.
export const PRINT_PREFIXES_EN = Object.freeze([
  ['เลขประจำตัวผู้เสียภาษีอากร', 'Tax ID'],
  ['เลขประจำตัวผู้เสียภาษี', 'Tax ID'],
  ['สาขาที่', 'Branch no.'],
  ['วันที่', 'Date'],
  ['หน้า', 'Page'],
  ['หมายเหตุ:', 'Note:'],
  ['เหตุผล:', 'Reason:'],
  ['ยกเลิกเมื่อ', 'Cancelled on'],
  ['รายการต่อหน้าถัดไป', 'Continued on the next page']
]);

// Whole texts with data inside (same placeholders as the screen dictionaries: {name} kept, {name:num} a number);
// dates in the kept values are shown the Gregorian way in the English line.
export const PRINT_PATTERNS_EN = Object.freeze([
  // ADR-031 multi-currency print
  ['ใบขนสินค้าขาออกเลขที่ {no}', 'Export declaration no. {no}'],
  ['ใบกำกับสินค้าส่งออก ใช้แทนใบกำกับภาษีตาม ป.132/2548 ข้อ 6 · ภาษีมูลค่าเพิ่มอัตราร้อยละ 0 · วันส่งออก {d}', 'Export invoice, used instead of a tax invoice (Por. 132/2548 clause 6) · VAT at 0% · export date {d}'],
  ['ได้รับอนุมัติให้ออกใบกำกับภาษีเป็นเงินตราต่างประเทศ เลขที่ {no} ลงวันที่ {d}', 'Approved to issue tax invoices in a foreign currency, no. {no} dated {d}'],
  ['ได้รับอนุมัติให้ออกใบกำกับภาษีเป็นเงินตราต่างประเทศ เลขที่ {no}', 'Approved to issue tax invoices in a foreign currency, no. {no}'],
  ['บันทึกบัญชี: ตัดลูกหนี้ตามราคาตามบัญชี {a:num} บาท · กำไรจากอัตราแลกเปลี่ยนที่เกิดขึ้นแล้ว {b:num} บาท', 'Books: receivable settled at its carrying amount THB {a} · realised exchange gain THB {b}'],
  ['บันทึกบัญชี: ตัดลูกหนี้ตามราคาตามบัญชี {a:num} บาท · ขาดทุนจากอัตราแลกเปลี่ยนที่เกิดขึ้นแล้ว {b:num} บาท', 'Books: receivable settled at its carrying amount THB {a} · realised exchange loss THB {b}'],
  ['{a:num} · ภาษีมูลค่าเพิ่ม (บาท) {b:num} · รวม (บาท) {c:num}', '{a} · VAT (THB) {b} · total (THB) {c}'],
  ['ออกตามมาตรา 86/10 แห่งประมวลรัษฎากร · ใช้ปรับลดภาษีขายในเดือนภาษีที่ออกใบลดหนี้ ({d})', 'Issued under section 86/10 of the Revenue Code · reduces output VAT in the tax month it is issued ({d})'],
  ['ออกตามมาตรา 86/9 แห่งประมวลรัษฎากร · เพิ่มภาษีขายในเดือนภาษีที่ออกใบเพิ่มหนี้ ({d})', 'Issued under section 86/9 of the Revenue Code · adds output VAT in the tax month it is issued ({d})'],
  ['มูลค่าสินค้า/บริการ {a:num} บาท · ภาษีมูลค่าเพิ่ม 7% {b:num} บาท', 'Goods / services THB {a} · VAT 7% THB {b}'],
  ['{a:num} บาท', 'THB {a}'],
  ['เครดิต {n:num} วัน', 'Credit {n} days'],
  ['หัก ณ ที่จ่าย {r:num} = {a:num} บาท · เลขที่หนังสือรับรอง {no} · ได้รับหนังสือรับรองการหักภาษี ณ ที่จ่ายแล้ว', 'Withholding tax {r} = THB {a} · certificate no. {no} · withholding-tax certificate (50 Tawi) received'],
  ['หัก ณ ที่จ่าย {r:num} = {a:num} บาท · เลขที่หนังสือรับรอง {no} · รอรับหนังสือรับรองการหักภาษี ณ ที่จ่าย', 'Withholding tax {r} = THB {a} · certificate no. {no} · awaiting the withholding-tax certificate (50 Tawi)'],
  ['หัก ณ ที่จ่าย {r:num} = {a:num} บาท · ได้รับหนังสือรับรองการหักภาษี ณ ที่จ่ายแล้ว', 'Withholding tax {r} = THB {a} · withholding-tax certificate (50 Tawi) received'],
  ['หัก ณ ที่จ่าย {r:num} = {a:num} บาท · รอรับหนังสือรับรองการหักภาษี ณ ที่จ่าย', 'Withholding tax {r} = THB {a} · awaiting the withholding-tax certificate (50 Tawi)'],
  ['ตามใบกำกับภาษี {a:num} หักลดหนี้ก่อนหน้า {b:num}', 'Per tax invoice {a}, less earlier credit notes {b}'],
  ['ตามใบกำกับภาษี {a:num} บวกใบเพิ่มหนี้ก่อนหน้า {b:num}', 'Per tax invoice {a}, plus earlier debit notes {b}'],
  ['ตามใบกำกับภาษี {a:num} · ลดหนี้ก่อนหน้า {b:num} · เพิ่มหนี้ก่อนหน้า {c:num}', 'Per tax invoice {a} · earlier credit notes {b} · earlier debit notes {c}'],
  ['ตามใบกำกับภาษี {a:num} · ลดหนี้ก่อนหน้า {b:num}', 'Per tax invoice {a} · earlier credit notes {b}'],
  ['ตามใบกำกับภาษี {a:num} · เพิ่มหนี้ก่อนหน้า {b:num}', 'Per tax invoice {a} · earlier debit notes {b}']
]);

// Where the Thai amount in words (bahtText) is printed; the English amount in words goes right under it.
// r13#LANG-print: the customer type printed on the quotation ("ประเภทหน่วยงาน": group, or "group / type", from
// CUSTOMER_AGENCY_GROUPS / CUSTOMER_AGENCY_TYPES in app.js — the same English as the screens, i18n/en-shell.js and
// en-settings-backup.js). Matched as a whole label or as "group / type".
export const PRINT_AGENCY_LABELS_EN = Object.freeze([
  ['ราชการ / หน่วยงานรัฐ', 'Government / public agency'],
  ['รัฐวิสาหกิจ / สถาบันการเงินของรัฐ', 'State enterprise / state financial institution'],
  ['โรงพยาบาล', 'Hospital'],
  ['โรงเรียน', 'School'],
  ['บริษัทเอกชน', 'Private company'],
  ['อื่น ๆ / ไม่ระบุ', 'Other / not stated'],
  ['หน่วยงานราชการทั่วไป', 'General government agency'],
  ['สหกรณ์ออมทรัพย์', 'Savings cooperative'],
  ['สหกรณ์การเกษตร', 'Agricultural cooperative'],
  ['สมาคมฌาปนกิจสงเคราะห์', 'Cremation welfare association'],
  ['สำนักงานตำรวจแห่งชาติ', 'Royal Thai Police'],
  ['สำนักงานคณะกรรมการป้องกันและปราบปรามการทุจริตแห่งชาติ', 'National Anti-Corruption Commission (NACC)'],
  ['สำนักงานคณะกรรมการป้องกันและปราบปรามยาเสพติด', 'Office of the Narcotics Control Board (ONCB)'],
  ['สำนักงานป้องกันและปราบปรามการฟอกเงิน', 'Anti-Money Laundering Office (AMLO)'],
  ['สำนักงานตรวจคนเข้าเมือง', 'Immigration Bureau'],
  ['สำนักงานประกันสังคม', 'Social Security Office'],
  ['สำนักงานหลักประกันสุขภาพแห่งชาติ', 'National Health Security Office (NHSO)'],
  ['สำนักงานกองทุนสนับสนุนการสร้างเสริมสุขภาพ', 'Thai Health Promotion Foundation'],
  ['สำนักงานคณะกรรมการอาหารและยา', 'Food and Drug Administration (FDA)'],
  ['ธนาคารแห่งประเทศไทย', 'Bank of Thailand'],
  ['สำนักงาน คปภ.', 'Office of Insurance Commission (OIC)'],
  ['บพข.', 'PMU-C (national competitiveness funding unit)'],
  ['สำนักงานคณะกรรมการการศึกษาขั้นพื้นฐาน', 'Office of the Basic Education Commission (OBEC)'],
  ['สำนักงานเลขาธิการสภาการศึกษา', 'Office of the Education Council'],
  ['สำนักงานการวิจัยแห่งชาติ', 'National Research Council of Thailand (NRCT)'],
  ['สำนักงานพัฒนาวิทยาศาสตร์และเทคโนโลยีแห่งชาติ', 'National Science and Technology Development Agency (NSTDA)'],
  ['การไฟฟ้าฝ่ายผลิตแห่งประเทศไทย', 'Electricity Generating Authority of Thailand (EGAT)'],
  ['การไฟฟ้าส่วนภูมิภาค', 'Provincial Electricity Authority (PEA)'],
  ['การไฟฟ้านครหลวง', 'Metropolitan Electricity Authority (MEA)'],
  ['การประปาส่วนภูมิภาค', 'Provincial Waterworks Authority (PWA)'],
  ['การประปานครหลวง', 'Metropolitan Waterworks Authority (MWA)'],
  ['องค์การขนส่งมวลชนกรุงเทพ', 'Bangkok Mass Transit Authority (BMTA)'],
  ['การรถไฟแห่งประเทศไทย', 'State Railway of Thailand (SRT)'],
  ['บรรษัทประกันสินเชื่ออุตสาหกรรมขนาดย่อม', 'Thai Credit Guarantee Corporation (TCG)'],
  ['องค์การสวนสัตว์แห่งประเทศไทย ในพระบรมราชูปถัมภ์', 'Zoological Park Organization of Thailand'],
  ['ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร', 'Bank for Agriculture and Agricultural Cooperatives (BAAC)'],
  ['ธนาคารอาคารสงเคราะห์', 'Government Housing Bank (GHB)'],
  ['ธนาคารพัฒนาวิสาหกิจขนาดกลางและขนาดย่อมแห่งประเทศไทย', 'SME Development Bank of Thailand'],
  ['ธนาคารเพื่อการส่งออกและนำเข้าแห่งประเทศไทย', 'Export-Import Bank of Thailand (EXIM)'],
  ['การทางพิเศษแห่งประเทศไทย', 'Expressway Authority of Thailand (EXAT)'],
  ['การรถไฟฟ้าขนส่งมวลชนแห่งประเทศไทย', 'Mass Rapid Transit Authority of Thailand (MRTA)'],
  ['บริษัท วิทยุการบินแห่งประเทศไทย จำกัด', 'Aeronautical Radio of Thailand (AEROTHAI)'],
  ['บริษัท ท่าอากาศยานไทย จำกัด (มหาชน)', 'Airports of Thailand (AOT)'],
  ['บริษัท ขนส่ง จำกัด', 'Transport Co., Ltd. (BKS)'],
  ['บริษัท ปตท. จำกัด (มหาชน)', 'PTT Public Company Limited'],
  ['การเคหะแห่งชาติ', 'National Housing Authority (NHA)'],
  ['องค์การคลังสินค้า', 'Public Warehouse Organization'],
  ['องค์การส่งเสริมกิจการโคนมแห่งประเทศไทย', 'Dairy Farming Promotion Organization of Thailand'],
  ['การยาสูบแห่งประเทศไทย', 'Tobacco Authority of Thailand'],
  ['องค์การอุตสาหกรรมป่าไม้', 'Forest Industry Organization'],
  ['ห้างหุ้นส่วนจำกัด', 'Limited partnership'],
  ['บริษัทจำกัด', 'Company limited'],
  ['บริษัทมหาชนจำกัด', 'Public company limited']
]);

export const PRINT_AMOUNT_WORDS_SELECTOR = '.dtd-doc-baht strong, .rcp-doc-baht strong, .qdoc-baht-text, .cn-doc-baht strong, .dtd-abbr-baht';
// The label in front of the English words when they stand on their own line.
export const PRINT_AMOUNT_WORDS_LABEL = 'Amount in words';
