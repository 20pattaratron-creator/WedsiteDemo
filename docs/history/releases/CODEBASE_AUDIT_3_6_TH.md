# Deep Code Audit — ERP DEMO 3.6.0

วันที่ตรวจ: 7 กันยายน 2569  
ฐาน: ERP DEMO 3.5.0 / Package 1.5.0  
ผลหลังแก้: ERP DEMO 3.6.0 / Package 1.6.0

## สรุปผล

สถานะ Static/Code Safety: **PASS**

- ชื่อไฟล์ซ้ำใน Full Source: **0**
- HTML `id` ซ้ำ: **0**
- `<script src>` โหลดซ้ำ: **0**
- stylesheet reference ซ้ำ: **0**
- local resource ที่อ้างแล้วหาไม่พบ: **0**
- inline handler ที่เรียกฟังก์ชันซึ่งไม่ได้ expose: **0**
- Runtime error listener ซ้ำ: **0** — เหลือ owner เดียวที่ `boot-status.js`
- Production Core / Order Flow ที่เขียนทับ `window.go`: **0**
- transient global `ERPPreparedSalesOrderId/ERPPreparedProductionOrderId`: **0**
- JavaScript/MJS/CJS syntax: **34 ไฟล์ผ่านทั้งหมด**
- CSS brace/parser sanity: **11 ไฟล์ ไม่พบวงเล็บปีกกาผิดสมดุล**
- Core regression + Council + Codebase tests: **39/39 ผ่าน**

ผลเครื่องตรวจสามารถเปิดดูได้ที่ `CODEBASE_AUDIT_RESULTS.json` และรันใหม่ด้วย:

```bash
npm run audit:code
npm run test:codebase
```

## Bug/ความเสี่ยงที่พบและแก้แล้ว

### 1. `q-date` เรียก inline handler ที่ไม่เป็น global

เดิม `index.html` มี:

```html
<input type="date" id="q-date" onchange="refreshAutoQuoteNumber()">
```

แต่ `refreshAutoQuoteNumber()` อยู่ใน ES module scope และไม่ได้ expose สู่ `window` ขณะเดียวกัน `app.js` ผูก `change` listener สำหรับวันที่เอกสารอยู่แล้ว จึงเป็นทั้ง handler ซ้ำและมีโอกาสเกิด `ReferenceError`.

แก้เป็น: เอา inline handler ออก และใช้ `initAutoDocumentNumberControls()` เป็น source เดียว.

### 2. `window.go` ถูก wrapper หลายชั้น

เดิม `erp-production-core.js` และ `erp-order-flow-v3.js` ต่างเก็บ `window.go` ตัวเก่าแล้วเขียน wrapper กลับไป ทำให้ลำดับ load มีผลกับ wrapper chain และเพิ่มความเสี่ยงเมื่อมีโมดูลใหม่.

แก้เป็น: ใช้ event ที่ `app.js` มีอยู่แล้ว:

```text
erp:navigation
```

- Production Core ฟัง event เพื่อ render operational page
- Order Flow ฟัง event เพื่อ clear active nav state
- ไม่เขียนทับ `window.go` อีก

### 3. transient workflow state กระจายบน `window`

เดิมใช้:

```text
window.ERPPreparedSalesOrderId
window.ERPPreparedProductionOrderId
```

หลายโมดูลอ่าน/เขียนชื่อเดียวกันโดยตรง.

แก้เป็น namespace เดียว:

```text
window.ERPWorkflowContext.preparedSalesOrderId
window.ERPWorkflowContext.preparedProductionOrderId
```

ช่วยลด global namespace pollution และทำให้เพิ่ม workflow context ภายหลังได้โดยไม่สร้าง global ใหม่ทุก field.

### 4. Runtime Error ถูกจับซ้ำ 3 ชุด

เดิม `boot-status.js`, `local-demo-health.js`, `erp-decision-council.js` ฟัง `error/unhandledrejection` แยกกัน ทำให้ state และจำนวน error มีโอกาสคลาดกัน.

แก้เป็น:

```text
boot-status.js = Runtime Error Source of Truth
LocalDemoHealth = read-only consumer
Decision Council = read-only consumer
```

### 5. Full Source มีสำเนา runtime อีกชุดใน `pages-source/`

ERP 3.5 มีไฟล์ basename ซ้ำ **37 ชื่อ** เนื่องจาก Full Source ฝัง deployment copy ไว้ใน `pages-source/` เช่น `app.js`, `index.html`, `style.css` และโมดูลทั้งหมด.

ไม่ทำให้ Browser โหลดซ้ำทันที เพราะคนละ directory แต่เสี่ยงมากต่อการแก้ไฟล์ผิดชุดและ deploy source คนละ version.

ERP 3.6 แก้เป็น:

- Full Source มี source ชุดเดียว
- Static/GitHub Pages แจกเป็น ZIP แยก
- ไม่ฝัง source clone ใน source package

### 6. Runtime filename มีเลข version ค้าง

เดิม `erp-order-flow-v3.js/.css` ทำให้อนาคตมีโอกาสเก็บ v3/v4 พร้อมกันแล้วอ้างผิดไฟล์.

แก้ชื่อเป็น:

```text
erp-order-flow.js
erp-order-flow.css
```

เลขรุ่นเก็บใน package/changelog แทน.

### 7. Deployment diagnostic เดิมตรวจ module dependency ไม่ครบ

ปรับ `scripts/build-deployment-check.mjs` ให้ไม่ต้องใช้ JSDOM และสแกนเพิ่ม:

- `<script src>`
- `<link rel="stylesheet">`
- `<img src>`
- ES module `import './...'`
- `new URL('./...', import.meta.url)`

ดังนั้น `erp-decision-council-core.js` และ asset ที่ถูกอ้างจาก module สามารถเข้ารายการตรวจ SHA ได้แม้ไม่ได้อยู่ใน `index.html` โดยตรง.

## Shared storage keys

พบ string key ที่ใช้ร่วมกันข้ามโมดูลโดย **ตั้งใจ** ไม่ใช่ collision:

- Order Flow / Integrity: `example_erp_order_flow_v3`
- App / Business Rules customer master: `comform_contact_master_v1`
- App / Business Rules product master: `comform_product_master_v1`

เพิ่ม Regression Test บังคับให้ key คู่เหล่านี้ต้องตรงกัน หากไฟล์หนึ่งถูกเปลี่ยนชื่อ key โดยอีกไฟล์ไม่เปลี่ยน test จะ fail ทันที.

## CSS overlap

Automated scanner พบ cross-file selector overlap 3 กลุ่ม:

1. `:root` — ตัวแปร CSS ใช้ prefix แยกตามโมดูล (`--qdoc-*`, `--dtd-*`, `--rcp-*`) จัดเป็น intentional shared scope.
2. `body` — `quotation-document.css` ใช้เฉพาะ `@media print`; `style.css` เป็น application body theme.
3. `.local-demo-banner-actions` — `local-demo-mode.css` เป็น base; `erp-customer-experience.css` override เฉพาะ mobile breakpoint.

ทั้ง 3 จุดไม่ถูกจัดเป็น blocking error.

อย่างไรก็ตาม `style.css` มี layered theme/responsive overrides จากหลายรุ่นจำนวนมาก จึงควร refactor ในอนาคตเป็น `base.css`, `components.css`, `dashboard.css`, `analytics.css`, `responsive.css`, `theme.css`. รอบ 3.6 **ไม่ทำ automatic merge** เพราะ cascade order มีผลต่อ UI และการรวมโดย regex เสี่ยงสร้าง visual regression.

## Test status

### ผ่านใน environment นี้

- Syntax check: 34/34
- Codebase audit: PASS
- Core regression + Integrity + Council + Codebase: 39/39
- CSS structural check: PASS
- Source deployment manifest generation: PASS
- Static deploy HTTP smoke: **34/34 URL ตอบ 200**
- Static deploy duplicate basename: **0**

### Full DOM/IndexedDB suite

ได้ลอง `npm ci` แต่ environment หมดเวลาก่อนติดตั้ง dependency สมบูรณ์ จึงไม่สามารถรับรอง tests ที่ใช้ `jsdom` และ `fake-indexeddb` ในรอบนี้. เมื่อเรียก `npm test` ด้วย partial install การ fail ที่เกิดขึ้นมาจาก `MODULE_NOT_FOUND` เท่านั้น ไม่ใช่ assertion ของ business logic.

ก่อน release จริงให้รันบนเครื่องพัฒนา:

```bash
npm ci
npm test
npm run audit:code
npm run build
npm run test:deployment
```

## ข้อเสนอระยะถัดไป

1. ลด wrapper chain ของ `saveInvoice/saveReceipt/...` ให้เป็น action pipeline/event middleware กลาง
2. แยก `style.css` ตาม concern โดยใช้ visual regression test ก่อนย้าย
3. ย้าย storage key contract ไป constants module เมื่อ test harness รองรับ ES import ทุกโมดูลแล้ว
4. ลด inline `onclick` ที่เหลือ โดยเปลี่ยนเป็น delegated event + `data-action` ทีละหน้า
5. Production: ย้าย source of truth จาก Browser storage ไป transaction-capable backend หลังหัวหน้าอนุมัติ
