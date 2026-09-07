# ERP DEMO 3.6.0 — Code Safety & De-duplication Release

Package 1.6.0 · 7 กันยายน 2569

รุ่นนี้ไม่เน้นเพิ่มเมนูธุรกิจใหม่ แต่เน้นทำให้ฐาน 3.5 สะอาดและลดความเสี่ยงจาก code/file overlap ก่อนพัฒนาต่อ.

## เปลี่ยนแปลงหลัก

- Full Source เหลือ runtime source ชุดเดียว; เอา `pages-source/` clone ออก
- Order Flow เปลี่ยนชื่อไฟล์เป็น versionless `erp-order-flow.js/.css`
- แก้ `q-date` inline handler ที่ไม่ expose และซ้ำกับ event listener
- Production Core / Order Flow เลิก wrap `window.go`; ใช้ `erp:navigation`
- รวม workflow handoff ที่ `window.ERPWorkflowContext`
- รวม runtime error capture ให้ `boot-status.js` เป็น source เดียว
- Local Demo Health v1.1 อ่าน runtime error จาก shared status
- Decision Council อ่าน shared runtime status แทนจับ error ซ้ำ
- Deployment diagnostic สแกน ES module imports / `new URL(..., import.meta.url)` เพิ่ม
- เพิ่ม `scripts/audit-codebase.mjs`
- เพิ่ม `tests/codebase-audit.test.cjs`
- เพิ่ม test contract สำหรับ shared LocalStorage keys
- package name ทำให้คงที่เป็น `example-company-erp-local-demo`; version = 1.6.0

## Verification

- Codebase Audit: PASS
- Duplicate basename: 0
- Duplicate HTML ID: 0
- Missing local resource: 0
- Unexposed inline handler: 0
- Root JS global navigation overwrite: 0
- Syntax: 34 files / 0 fail
- Core/Integrity/Council/Codebase regression: 39/39 pass
- CSS structure: PASS

รายละเอียด: `CODEBASE_AUDIT_3_6_TH.md`
