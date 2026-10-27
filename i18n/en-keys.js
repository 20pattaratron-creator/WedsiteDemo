// i18n/en-keys.js — t(key, params) texts for code written for the language switch (ADR-026). Plain data only.
// Each key has the Thai text (the default language) and the English text; {name} = a parameter.
export const UI_KEYS = Object.freeze({
  'switch.group': Object.freeze({ th: 'ภาษา / Language', en: 'ภาษา / Language' }),
  'switch.menuToEnglish': Object.freeze({ th: 'English (เปลี่ยนเป็นภาษาอังกฤษ)', en: 'English (เปลี่ยนเป็นภาษาอังกฤษ)' }),
  'switch.menuToThai': Object.freeze({ th: 'ภาษาไทย (Switch to Thai)', en: 'ภาษาไทย (Switch to Thai)' }),
  'switch.menuTitleToEnglish': Object.freeze({ th: 'แสดงระบบเป็นภาษาอังกฤษ — ข้อมูลที่กรอกไม่ถูกแปล', en: 'Show the app in English — data you entered is not translated' }),
  'switch.menuTitleToThai': Object.freeze({ th: 'แสดงระบบเป็นภาษาไทย', en: 'Show the app in Thai' }),
  'help.close': Object.freeze({ th: 'ปิด', en: 'Close' }),
  'help.dialog': Object.freeze({ th: 'คำอธิบายภาษี', en: 'Thai tax explained' }),
  'calendar.form': Object.freeze({ th: 'แบบ', en: 'Return' }),
  'calendar.paper': Object.freeze({ th: 'ยื่นแบบกระดาษ', en: 'Paper filing by' }),
  'calendar.online': Object.freeze({ th: 'ยื่นทางอินเทอร์เน็ต', en: 'Online filing by' }),
  'calendar.month': Object.freeze({ th: 'เดือนภาษี {month}', en: 'For {month}' }),
  'calendar.moved': Object.freeze({ th: '(เลื่อนจากวันหยุดสุดสัปดาห์)', en: '(moved from a weekend)' }),
  'calendar.movedHoliday': Object.freeze({ th: '(เลื่อนพ้นวันหยุดราชการ)', en: '(moved past a government holiday)' }), // r13#LOW-1
  'calendar.checkLatest': Object.freeze({ th: 'พ้นช่วงขยายเวลายื่นทางอินเทอร์เน็ตที่ตั้งไว้ — ตรวจสอบประกาศกรมสรรพากรล่าสุด', en: 'Past the configured online-filing extension — check the latest Revenue Department announcement.' }),
  // Tax-report tabs in English: the Thai form name in Latin letters with a short explanation (the Thai tab text is unchanged).
  'tax.tab.sales': Object.freeze({ th: 'รายงานภาษีขาย', en: 'Output VAT report' }),
  'tax.tab.purchase': Object.freeze({ th: 'รายงานภาษีซื้อ', en: 'Input VAT report' }),
  'tax.tab.forbidden': Object.freeze({ th: 'ภาษีซื้อต้องห้าม', en: 'Non-claimable input VAT' }),
  'tax.tab.pp30': Object.freeze({ th: 'ภ.พ.30', en: 'PP.30 (monthly VAT return)' }),
  'tax.tab.pnd3': Object.freeze({ th: 'ภ.ง.ด.3', en: 'PND.3 (WHT return, individuals)' }),
  'tax.tab.pnd53': Object.freeze({ th: 'ภ.ง.ด.53', en: 'PND.53 (WHT return, companies)' }),
  'tax.tab.wht': Object.freeze({ th: 'หนังสือรับรอง 50 ทวิ', en: '50 Tawi (withholding-tax certificates)' }),
  'tax.tab.pnd54': Object.freeze({ th: 'ภ.ง.ด.54', en: 'PND.54 (WHT on payments abroad)' }),
  'tax.tab.pp36': Object.freeze({ th: 'ภ.พ.36', en: 'PP.36 (self-assessed VAT on foreign services)' })
});
