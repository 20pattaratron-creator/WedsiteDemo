# วิธีรันเทสต์ (ERP DEMO 4.3.1)

สรุปสั้น: **ระหว่างแก้โค้ดให้รัน `npm run test:fast` ทุกครั้ง** (ไม่กี่วินาที) และ **ก่อนส่งงาน/ส่ง zip ให้รัน `npm run verify`** (ประมาณ 3–5 นาที)

## คำสั่งที่ใช้ และใช้เมื่อไร

| คำสั่ง | ใช้เมื่อไร | รันอะไร | เวลาโดยประมาณ (เครื่อง 2 CPU) |
|---|---|---|---|
| `npm run test:fast` | **ค่าเริ่มต้นระหว่างทำงาน** — หลังแก้ไฟล์ทุกครั้ง | ไฟล์เทสต์ที่ไม่ boot ทั้งแอป (core, calculator, validator, pagination, report pure functions, audit) | ~5 วินาที |
| `npm test` | ก่อน commit / เมื่อแก้ UI, app.js หรือ flow ที่ผู้ใช้กดจริง | **ทุกไฟล์** `tests/*.test.cjs` (fast + app-boot ใน jsdom) | ~2.5–3 นาที |
| `npm run verify` | **ก่อนส่งงานทุกครั้ง** (คำสั่งเดียวจบ) — CI ก็รันคำสั่งนี้ | audit ที่ต้องผ่าน + `npm test` + `build` + `build:flat` + `test:deployment` + `test:deployment:flat` | ~3–5 นาที |
| `npm run test:list` | อยากรู้ว่าไฟล์ไหนอยู่ชุดไหน | แสดงรายการ ไม่รันเทสต์ | ทันที |

ส่งอาร์กิวเมนต์ต่อให้ `node --test` ได้ เช่น
`npm test -- --test-reporter=spec` หรือ `npm test -- --test-name-pattern="credit note"`

จำนวนไฟล์ที่รันพร้อมกันตั้งผ่าน `TEST_CONCURRENCY` (ค่าเริ่มต้น = จำนวน CPU)
**อย่าตั้งเกินจำนวน CPU** — เทสต์ app-boot บางตัวรอ timer ตอนเริ่มแอป (ดูหัวข้อ "ข้อควรระวัง") เมื่อ CPU ถูกแย่งมากเกินไปอาจล้มแบบสุ่ม

`verify` **ไม่รวม** 2 รายการที่รู้อยู่แล้วว่าไม่ผ่านและต้องให้คนตัดสินใจ:
- `npm run audit:complexity` — `appJsLinesDelta` เกิน baseline ตาม ADR-012 (รอ refactor แยก app.js)
- `npm run security:verify-baseline` — ไฟล์ที่ป้องกันไว้ (เช่น `index.html`, `vite.config.js`, `package.json`, `.github/`) เปลี่ยนแล้ว ต้องให้คนตรวจแล้วรัน `npm run security:baseline` เอง (ห้ามให้ AI re-baseline เอง)

`test:core` / `quality:core` / `quality:gate` เดิมยังอยู่และทำงานเหมือนเดิม (เป็นรายการไฟล์ตายตัวสำหรับ evidence ของ release)

## ชุด fast กับชุด full แบ่งกันอย่างไร

แบ่ง **ตามไฟล์** โดยอัตโนมัติ (`scripts/run-tests.mjs`):

- ไฟล์ที่มี `require('./dom-helper.cjs')` (เรียก `boot()` เปิดทั้งแอปใน jsdom) → อยู่ใน **full เท่านั้น**
- ไฟล์ที่มีบรรทัดคอมเมนต์ `// test-suite: full` → อยู่ใน **full เท่านั้น** (ใช้กับเทสต์ที่ช้าด้วยเหตุผลอื่น)
- ไฟล์อื่นทั้งหมด → อยู่ใน **fast** (และ full ก็รันด้วย)

`npm test` รันทุกไฟล์เสมอ จึงไม่มีเทสต์ถูกข้ามหรือรันซ้ำ

## เพิ่มเทสต์ใหม่

1. **ตรรกะล้วน (แนะนำ)** — ฟังก์ชันคำนวณ/ตรวจสอบ/แบ่งหน้า/รายงาน ที่ import จาก `erp-*-core.js` ได้โดยตรง:
   สร้างหรือเพิ่มใน `tests/<ชื่อ>.test.cjs` ที่ **ไม่** require `dom-helper.cjs` แล้วไฟล์จะเข้าชุด fast เอง ไม่ต้องลงทะเบียนที่ไหน
   ตัวอย่างการ import ES module: ดู `tests/date-core.test.cjs`, `tests/document-finance-core.test.cjs`
2. **ต้องกดหน้าจอจริง / ผ่าน app.js** — ใช้ `const { boot } = require('./dom-helper.cjs')` แล้ว `const h = await boot(); try { ... } finally { h.close(); }`
   (ต้อง `close()` ทุกครั้ง ไม่เช่นนั้น timer ของแอป เช่น interval 60 วินาที จะค้างและทำให้ไฟล์ไม่จบ)
   ถ้าต้องเตรียม localStorage ก่อนแอปเริ่ม (เหมือน Browser ที่เคยใช้มาแล้ว) ใช้ `boot({ beforeScripts: w => w.localStorage.setItem(...) })` — ตัวอย่าง `tests/single-admin-view.test.cjs`
   ไฟล์นี้จะเข้าชุด full อัตโนมัติ — **อย่าใส่เทสต์ตรรกะล้วนในไฟล์ app-boot** เพราะจะไม่ถูกรันใน fast
3. เทสต์ที่ไม่ boot แต่ใช้เวลานานกว่า ~2 วินาที ให้ใส่ `// test-suite: full` ไว้ต้นไฟล์
4. ตรวจด้วย `npm run test:list` ว่าไฟล์อยู่ชุดที่ตั้งใจ แล้วรัน `npm run test:fast` (ถ้าชุด fast เกิน 120 วินาที ตัวรันจะเตือน)

ข้อควรระวังสำหรับเทสต์ที่รันพร้อมกัน: ไฟล์เทสต์รันคนละ process พร้อมกัน ห้ามเขียนไฟล์ชื่อตายตัวที่ไฟล์เทสต์อื่นอ่าน
(ใช้ `fs.mkdtempSync(os.tmpdir())` แทน) และห้ามเปิด port ตายตัว — script audit ที่เขียน `*_RESULTS.json` ใช้ `scripts/write-file-atomic.mjs` แล้ว

## ทำไมเดิมช้า (~22 นาที) และแก้อะไรไป

วัดรายไฟล์ พบว่าเวลาเกือบทั้งหมดอยู่ในเทสต์ที่ `boot()` แอป
และสาเหตุหลักคือ **selector `label:has(#md-p-flow-type) span` ใน `erp-product-experience.js`**
ซึ่ง jsdom (nwsapi) ประมวลผลช้ามาก (~30–70 วินาทีต่อการ boot หนึ่งครั้ง) และบล็อก event loop —
นี่คือ "stall ~20 วินาทีแบบสุ่ม" ที่เห็นก่อนหน้า (ยาวแค่ไหนขึ้นกับขนาด DOM และว่าเทสต์ปิดแอปก่อน timer init ทำงานหรือไม่)
ในเบราว์เซอร์จริงที่ไม่รองรับ `:has()` (Firefox < 121, Safari < 15.4, Chrome < 105) selector นี้ throw และทำให้ init ของ Product Experience หยุด
แก้เป็น `getElementById(...).closest('label').querySelector('span')` (ผลเหมือนเดิม) พร้อมเทสต์กันถอยหลัง 2 ตัว
(`product-experience.test.cjs` ตรวจว่าไม่มี `:has(` ใน selector ของ runtime JS, `ux-review.test.cjs` ตรวจว่า init เสร็จเร็วหลัง boot)

## ข้อควรระวังที่ยังค้าง (race ในเทสต์ app-boot)

`local-demo-health.js` ครอบ `saveInvoice`/`saveReceipt`/`pcPostGoodsReceipt`/... ด้วย single-flight guard หลังเปิดแอปไม่ถึง 1 วินาที
และ guard นี้ปฏิเสธการเรียกซ้ำภายใน 250 ms หลังเรียกเสร็จ (ตั้งใจไว้กันกดซ้ำ) `boot()` คืนค่าก่อน guard ถูกติดตั้ง
เทสต์ 7 ตัวต่อไปนี้เรียกฟังก์ชันที่ถูกครอบ 2 ครั้งติดกันโดยไม่ปล่อย event loop และผ่านได้เพราะ guard ยังไม่ถูกติดตั้ง หรือถูกติดตั้ง "ระหว่าง" การเรียกครั้งแรกพอดี:

- `abbreviated-invoice.test.cjs` — "UI: save a walk-in abbreviated invoice ..." และ "fix5#6: saving warns ..."
- `audit-fixes.test.cjs` — "GR rolls back and can retry after failure at ..." (3 เทสต์)
- `forms.test.cjs` — "quote → SO → two deliveries → ..." และ "invoice form stock guard ..." (assert `saveInvoice.__stockGuard` ที่ชั้นนอกสุด)

ทดลองให้ `boot()` รอจนแอปเริ่มครบ (`w.__LOCAL_DEMO_HEALTH__`) แล้ว 7 ตัวนี้ล้มทุกครั้ง และถ้า CPU ถูกแย่งหนัก
(เช่น `TEST_CONCURRENCY=4` บนเครื่อง 2 CPU) ก็ล้มบางตัว — **จึงห้ามตั้ง concurrency เกินจำนวน CPU** จนกว่าจะแก้
การแก้ที่แนะนำ (ต้องแก้ตัวเทสต์ จึงยังไม่ได้ทำในรอบนี้): ให้ `boot()` รอจนแอปเริ่มครบ และในเทสต์ให้รอ ≥ 300 ms ระหว่างการบันทึก/ลองใหม่แต่ละครั้ง
(เหมือนผู้ใช้จริงที่กดไม่ทันใน 250 ms) ส่วน assert `__stockGuard` ต้องเปลี่ยนเป็นตรวจพฤติกรรมแทน
เทสต์ใหม่ที่บันทึกเอกสารหลายครั้งควรทำแบบนี้ตั้งแต่แรก
