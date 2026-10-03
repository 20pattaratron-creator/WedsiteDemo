# Deep Code Audit — ERP DEMO 4.2.0

## วิธีตรวจ

คำว่า “ตรวจละเอียด” ในรายงานนี้หมายถึง:
1. Runtime JavaScript ทุกไฟล์ถูกเดิน dependency graph จาก `index.html` และ ES module imports
2. Runtime lines ทุกบรรทัดถูกครอบด้วย static rules ที่กำหนด
3. Business-critical blocks ถูก review เชิง semantic เพิ่ม เช่น Payment, Delivery, Stock, VAT, Date, Billing, Storage และ Workflow
4. รัน regression tests แยกจาก static scan

ไม่ได้หมายความว่าสามารถพิสูจน์ทุก expression ทุกบรรทัดว่าถูกต้อง 100% ทางคณิตศาสตร์ และไม่แทน Browser/visual/production testing

## ผลล่าสุด

- Runtime JS: 25 ไฟล์
- Runtime JS lines: 15,434
- Deep blocking issues: 0
- Codebase Audit: PASS
- Spec Audit: PASS
- Complexity Audit: PASS
- Security preflight: PASS (HIGH 0 / MEDIUM 0)
- Core Regression: 74/74 PASS

## จุดที่ตรวจและปิดแล้ว

### วันที่ธุรกิจ
ห้ามใช้ UTC ISO slicing สำหรับ document/due/required date และใช้ shared local calendar helpers

### VAT
`0.07`, `1.07`, `100/107` ถูกบังคับให้มี owner ที่ `erp-shared-core.js`

### Storage Contract
Persisted keys อยู่ที่ `erp-storage-contracts.js` และ consumer import แทน copy literal

### Workflow
- invalid edge ถูกปฏิเสธ
- missing guard → error
- no matching route → error
- max step budget ป้องกัน loop
- Mixed fulfillment สามารถเปิด Stock + Production + Purchase พร้อมกัน

### Navigation / Globals
- ไม่มี module สำคัญ wrap `window.go` ซ้อนกัน
- Runtime error capture มี owner เดียวที่ `boot-status.js`
- transient workflow handoff อยู่ใต้ namespace

### Test Infrastructure
ซ่อม VM-based legacy tests ให้โหลด shared ES modules แบบควบคุมได้ จึงไม่เกิด false failure จาก `import` syntax

## Duplication

Deep normalized 10-line duplicate groups ที่ยังตรวจพบ: 275

การกระจุกตัว:
- Delivery/Tax ↔ Receipt: 275 windows
- Delivery/Tax ↔ Quotation: 26 windows
- Quotation ↔ Receipt: 26 windows

ส่วนใหญ่เป็น document form/preview/print-controller layout ที่ตั้งใจมีโครงคล้ายกัน ไม่ใช่ VAT/Payment/Stock business logic ซ้ำ

การรวม controller ทั้งหมดในตอนนี้ถูกจัดว่า risk สูงกว่าประโยชน์ เพราะเอกสารแต่ละชนิดมี lifecycle/layout ต่างกัน

## Technical Debt ที่ยังเปิด

### `app.js`
ประมาณ 8,256 lines — ใหญ่เกินระยะยาว ควรแยกทีละ domain โดยมี regression tests ก่อน/หลัง

### `style.css`
ประมาณ 2,667 lines และมี cascade overrides สะสม ต้อง refactor พร้อม visual regression ไม่ควรรวม selector อัตโนมัติ

### Inline handlers
ยังมี function names จาก inline HTML handler ประมาณ 102 รายการ แม้ทั้งหมด resolve ได้ใน Audit ปัจจุบัน ควรทยอยย้ายเป็น delegated/event binding ในอนาคต

### Browser/DOM suite
Environment ที่สร้าง release นี้ติดตั้ง `jsdom/fake-indexeddb` ไม่สมบูรณ์ จึงต้องรัน Full Suite บนเครื่องนักพัฒนาอีกครั้ง

## ความเสี่ยง Production ที่ยังไม่แก้ด้วย Local Demo
- Server RBAC
- tenant isolation ที่ database
- atomic document number
- central DB transaction
- server audit
- secure customer portal
- cloud attachment access control
