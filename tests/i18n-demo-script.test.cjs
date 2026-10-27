// ADR-026 — docs/DEMO_SCRIPT_EN.md tells the same story with the same figures as docs/DEMO_SCRIPT_TH.md, whose
// figures r8fix#C1 checks against the seeded store: every amount of the Thai script is in the English one (except
// the history notes of ADR-023 / ADR-024, which give the figures before those rounds), and the English script names
// the labels the English screens really show.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const HISTORY_ONLY = new Set(['54,363.30', '20,936.70', '81,083.30']);

test('i18n-demo-script#1 every amount of the Thai demo script is in the English one', () => {
  const th = read('docs/DEMO_SCRIPT_TH.md');
  const en = read('docs/DEMO_SCRIPT_EN.md');
  const amounts = [...new Set(th.match(/\d{1,3}(?:,\d{3})*\.\d{2}/g))].filter(n => !HISTORY_ONLY.has(n));
  assert.ok(amounts.length > 60, `${amounts.length} amounts`);
  assert.deepEqual(amounts.filter(n => !en.includes(n)), []);
  for (const fixed of ['ใบเสนอราคา 5, ใบกำกับภาษี 24', '5 quotations, 24 tax invoices (1 cancelled' /* language audit S14 */]) assert.ok(th.includes(fixed) || en.includes(fixed), fixed);
  assert.doesNotMatch(en, /฿/, 'English money is written THB');
});

test('i18n-demo-script#2 the English script uses the labels of the English screens', async () => {
  const en = read('docs/DEMO_SCRIPT_EN.md').replace(/\s+/g, ' ');
  const core = await import(pathToFileURL(path.join(ROOT, 'erp-i18n-core.js')).href);
  const files = ['shell', 'sales', 'purchase-stock', 'tax', 'settings-backup', 'messages'];
  const entries = [];
  const patterns = [];
  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(ROOT, `i18n/en-${f}.js`)).href);
    for (const [name, list] of Object.entries(mod)) (name.endsWith('_PATTERNS') ? patterns : entries).push(...list);
  }
  const tr = core.createPhraseTranslator({ entries, patterns, strict: false });
  const labels = ['โหลดข้อมูลตัวอย่างสำหรับสาธิต', 'ข้อมูลบริษัทและโลโก้', 'จำนวนสถานประกอบการ', 'สำนักงานใหญ่อย่างเดียว', 'ภาพรวมผู้บริหาร', 'ลูกหนี้ค้างรับ', 'งานของฉัน', 'ขายและรับเงิน', 'ใบเสนอราคา', '+ สร้างใบเสนอราคา', 'ใบส่งสินค้า / ใบกำกับภาษี', '+ สร้างใบส่งสินค้า / ใบกำกับภาษี', 'เครดิต 30 วัน', 'ราคายังไม่รวม VAT — บวกเพิ่ม 7%', 'รูปแบบใบกำกับภาษี', 'อย่างย่อ (มาตรา 86/6)', 'ใบเสร็จ / รับชำระ', '+ รับชำระ / ออกใบเสร็จ', 'อัตราหัก ณ ที่จ่าย', '3% — ค่าบริการ/ค่าจ้างทำของ/วิชาชีพอิสระ', '+ ออกใบลดหนี้', 'รับคืนสินค้าตามข้อตกลงทางการค้า', 'สินค้าที่รับคืน', 'ยอดขายและเป้าหมาย', 'ทุกเดือน', 'รวมทั้ง 2 สาขา', 'ข้อมูลและรายงาน', 'รายงานภาษี', 'รายงานภาษีขาย', 'รายงานภาษีซื้อ', 'ภาษีซื้อต้องห้าม', 'บันทึกว่ายื่นแล้ว', 'ดู / พิมพ์', 'ล้างข้อมูลสาธิตทั้งหมด (รีเซ็ต)', 'ตัวอย่างหัวเอกสาร', 'สำรองข้อมูล'];
  for (const label of labels) {
    const english = tr.phrase(label);
    assert.notEqual(english, label, `translated: ${label}`);
    assert.ok(en.toLowerCase().includes(english.replace(/^\+ /, '').toLowerCase()), `DEMO_SCRIPT_EN.md names "${english}" (${label})`);
  }
});
