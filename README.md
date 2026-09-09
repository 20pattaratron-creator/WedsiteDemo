# ERP Integrated v4.3.0 — Customer Trial Demo

Package **2.3.0** · QA/Security hardening for controlled customer trial.

> DEMO: ข้อมูลเก็บใน Browser และยังไม่ใช่ระบบ Production หลายผู้ใช้

ดู `ERP_DEMO_4_3_TRIAL_NOTES_TH.md` สำหรับข้อจำกัดและรายการแก้ไข

---

# ERP Integrated v4.2.0 — Local DEMO

Package **2.2.0** · Specification & Quality Governance Release

ระบบนี้เป็น Local Demo สำหรับสาธิต Workflow ERP ของธุรกิจ B2B ไทยที่มี Sales Order, Stock, งานสั่งผลิต/MTO, Supplier/Purchase, Delivery/Invoice, Billing/Payment, Analytics และ Decision Review โดยข้อมูลทดลองยังอยู่ใน Browser ไม่ใช่ Production multi-user backend

## จุดสำคัญของ 4.2

รุ่น 4.2 ไม่ได้เร่งเพิ่มฟีเจอร์ธุรกิจจำนวนมาก แต่ยกระดับ “วิธีที่ระบบถูกพัฒนาและตรวจสอบ” เพื่อลด Bug/Technical Debt จากการพัฒนาเร็วด้วย AI:

- `specs/constitution/ERP_CONSTITUTION.md` — กติกาหลัก 12 ข้อ เช่น Business Date, VAT source-of-truth, Storage Contract, AI boundary และ Release evidence
- `specs/TRACEABILITY.json` — Requirement → Test/Evidence mapping
- `DEVELOPMENT_CONTEXT.json` — Context Ledger สรุป source of truth, งานที่เสร็จ, technical debt และข้อห้าม regression
- `QUALITY_BUDGET.json` — Complexity budget กันการเพิ่มไฟล์/dependency/global/inline handler แบบเงียบ ๆ
- `npm run audit:specs` — ตรวจ Requirement ID, Traceability และ test mapping
- `npm run audit:complexity` — ตรวจ complexity budget
- `npm run audit:deep` — ตรวจ runtime import, date/VAT/storage/global/dynamic-code/duplicate patterns
- `npm run evidence:core` — บันทึกหลักฐานผล Core Test เป็น TAP + JSON
- Release metadata ของ build/audit scripts อ่านจาก `package.json` แทน hard-code หลายจุด

## Business Core ที่รักษาไว้

- Quotation → Sales Order → Fulfillment → Delivery/Invoice → Billing → Payment/Receipt
- Partial delivery / partial payment / reversal
- Stock reservation และ Available = On Hand - Reserved
- Stock / Production / Purchase แบบผสมใน Fulfillment Plan
- PO / Goods Receipt / Inventory Movement
- Billing Note และ Payment Allocation
- Customer/Product/Supplier Master
- Interactive Executive Charts + 12-month Targets
- Forecast / Quant / Decision Council
- Local Backup + Attachment checksum
- Role-based UX / Approval Center / Customer Portal Preview (Demo UX เท่านั้น)

## Shared Sources of Truth

| Concern | Source |
|---|---|
| VAT / Money primitive / Business Date | `erp-shared-core.js` |
| Persisted browser keys | `erp-storage-contracts.js` |
| Workflow definition | `erp-workflow-definitions.js` |
| Graph execution | `erp-workflow-graph-core.js` |
| Transaction integrity | `erp-integrity.js` |
| Engineering constitution | `specs/constitution/ERP_CONSTITUTION.md` |
| Requirement traceability | `specs/TRACEABILITY.json` |

## Quality commands

```bash
npm run audit:code
npm run audit:deep
npm run audit:specs
npm run audit:complexity
npm run security:preflight
npm run test:core
npm run evidence:core
```

รวม Gate ที่ไม่ต้องใช้ DOM dependencies:

```bash
npm run quality:gate
```

Full browser/DOM suite:

```bash
npm ci
npm test
npm run build
npm run test:deployment
```

> ใน environment ที่สร้างแพ็กเกจ 4.2 นี้ Core Gate ผ่าน แต่ `npm ci` ไม่สามารถติดตั้ง `jsdom/fake-indexeddb` จนครบเพราะ network/install timeout ดังนั้น Full DOM/E2E ต้องรันซ้ำบนเครื่องนักพัฒนาก่อน Production/Release จริง

## เปิด Local Demo

```bash
npm ci
npm run dev
```

เปิด URL ที่ Vite แสดง เช่น `http://localhost:5173`

ไม่แนะนำดับเบิลคลิก `index.html` เพราะระบบใช้ ES Modules และ browser storage ที่ผูกกับ origin

## GitHub Pages

สำหรับการสาธิตแบบ Static ให้ใช้ ZIP Pages 4.2 ที่จัดไฟล์ Runtime ชุดเดียวกันทั้งหมด และเปิด `deployment-check.html` หลังอัปโหลดเพื่อตรวจ HTTP + SHA-256 ของ runtime files

ดู `GITHUB_PAGES_DEPLOY_4_2_TH.md`

## ข้อจำกัดที่ต้องเข้าใจก่อน Production

- Role ใน Demo เป็น UX role ไม่ใช่ server authorization
- Customer Portal เป็น Preview ไม่ใช่ secure customer login
- LocalStorage/IndexedDB ไม่ใช่ central transaction database
- ยังไม่มี server-side tenant isolation / atomic document number / DB transaction / server audit
- ยังไม่ใช่ General Ledger/Payroll/Bank Reconciliation เต็มรูปแบบ
- เอกสารบางส่วนใช้ CDN สำหรับ html2canvas/jsPDF
- `app.js` และ `style.css` ยังเป็น technical debt ขนาดใหญ่ ต้อง refactor ทีละ domain พร้อม regression/visual tests

## เอกสารปัจจุบัน

- `ERP_DEMO_4_2_CHANGES_TH.md`
- `DEEP_CODE_AUDIT_4_2_TH.md`
- `RELEASE_VALIDATION_4_2_TH.md`
- `GITHUB_PAGES_DEPLOY_4_2_TH.md`
- `SECURITY_AGENT_GUIDE_TH.md`
- `specs/constitution/ERP_CONSTITUTION.md`
- `specs/FEATURE_CHANGE_TEMPLATE.md`

รายงานรุ่นเก่าเก็บใน `docs/history/` เพื่อไม่ปะปนกับสถานะปัจจุบัน
