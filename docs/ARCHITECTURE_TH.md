# สถาปัตยกรรมระบบ ERP DEMO 4.3.1 (ฉบับภาษาไทย)

> **ผู้อ่าน:** เจ้าของผลิตภัณฑ์ (อยากเข้าใจว่าระบบประกอบกันอย่างไร) และนักพัฒนาที่จะมาทำต่อ
> **อัปเดต ADR-023 (5 ต.ค. 2569):** รายงานภาษีขาย / ภาษีซื้อ / ภาษีซื้อต้องห้าม และสรุป ภ.พ.30 (บรรทัด 1–12) แยกตามสถานประกอบการ — หน้า "รายงานภาษี" ในหมวดข้อมูล, ข้อมูลใบกำกับภาษีซื้อในค่าใช้จ่าย, สาขาผู้จำหน่าย, `vatCategory` ในบิล, collection `vatReturns` (+3 ไฟล์ runtime `erp-tax-reports-core.js`, `erp-tax-forms.js`, `erp-tax-reports.js`)
>
> **อัปเดต ADR-022 (4 ต.ค. 2569):** บริษัทเลือกได้ว่ามี **สำนักงานใหญ่อย่างเดียว** หรือ **สำนักงานใหญ่ + 1 สาขา** (ตั้งค่าบริษัท) — แหล่งความจริงเดียวของรายชื่อ/ชื่อสาขาบนหน้าจอคือ `erp-branches-core.js` (+1 ไฟล์ runtime); id ภายในยังเป็น `ubon`/`khonkaen` ทุกที่
>
> **อัปเดต ADR-021 (4 ต.ค. 2569):** สาขาผู้ซื้อบนใบกำกับภาษีเต็มรูป/ใบเสร็จ, ยกเลิกแทนการลบ (+2 ไฟล์ `erp-document-cancel*.js`), เป้าตัวอย่างจากข้อมูลตัวอย่าง, ส่งออก Excel แบบออฟไลน์ (SheetJS ใน `vendor/`)
> **สถานะข้อมูล:** ตัวเลขทุกตัวในเอกสารนี้วัดจากโค้ดจริงเมื่อ 30 ก.ย. 2569 (2026-09-30) ด้วย `wc -l`, `grep` และสคริปต์ Node สั้น ๆ ไม่ได้คัดลอกมาจากเอกสารเก่า
> **การนำทาง:** ระบบใช้มุมมองเดียวแบบ Admin แล้ว (ถอดมุมมองตามบทบาทออกตาม ADR-014 เมื่อ 30 ก.ย. 2569) และตั้งแต่ ADR-015 (รอบ 5 ส่วน A) ส่วนหัวเหลือแถบแจ้งเตือนบรรทัดเดียว + เมนู "⚙ Demo" และเมนูซ้ายจัดเป็นหมวดพับได้ — ตัวเลขจำนวนไฟล์/บรรทัดในหัวข้อ 2.1 เป็นค่าก่อน ADR-015 (หลัง ADR-015: 42 ไฟล์, 23,462 บรรทัด)

---

## สารบัญ

1. [ภาพรวมระบบในหน้าเดียว](#1-ภาพรวมระบบในหน้าเดียว)
2. [โครงสร้างไฟล์](#2-โครงสร้างไฟล์)
3. [ลำดับการโหลดและการเริ่มต้นระบบ](#3-ลำดับการโหลดและการเริ่มต้นระบบ)
4. [ข้อมูลและการจัดเก็บ](#4-ข้อมูลและการจัดเก็บ)
5. [กระบวนการธุรกิจหลัก (flow)](#5-กระบวนการธุรกิจหลัก-flow)
6. [กฎบัญชีและภาษีที่ระบบใช้](#6-กฎบัญชีและภาษีที่ระบบใช้)
7. [ความปลอดภัยของข้อมูลและการควบคุม](#7-ความปลอดภัยของข้อมูลและการควบคุม)
8. [การทดสอบและเครื่องมือตรวจคุณภาพ](#8-การทดสอบและเครื่องมือตรวจคุณภาพ)
9. [จุดแข็ง / จุดอ่อนเชิงโครงสร้าง / หนี้ทางเทคนิค](#9-จุดแข็ง--จุดอ่อนเชิงโครงสร้าง--หนี้ทางเทคนิค)
10. [แนวทางต่อยอด](#10-แนวทางต่อยอด)

---

## 1. ภาพรวมระบบในหน้าเดียว

### ระบบนี้คืออะไร

ERP DEMO 4.3.1 เป็น **เว็บแอป ERP สำหรับสาธิตให้ SME ไทย** ที่ทำงานทั้งหมดใน Browser ของผู้ใช้ ครอบคลุมงานขายตั้งแต่ต้นจนจบ:

```
ใบเสนอราคา → ใบสั่งขาย (Sales Order) → วางแผนจัดสินค้า (Stock / สั่งผลิต / จัดซื้อ)
→ ใบส่งสินค้า / ใบกำกับภาษี → ใบวางบิล → รับชำระ / ใบเสร็จ (รวมหัก ณ ที่จ่าย) → ใบลดหนี้
```

และมีงานประกอบ ได้แก่ ลูกหนี้และรายงานอายุลูกหนี้, คลังสินค้า (ใบสั่งซื้อ PO, รับสินค้าเข้าคลัง, ปรับยอด, โอนสาขา), บันทึกค่าใช้จ่าย, แดชบอร์ดผู้บริหาร / วิเคราะห์ธุรกิจ, ศูนย์อนุมัติ, ปิดงวด (Period Lock), Audit Log, สำรอง/นำเข้าข้อมูล และปุ่มโหลดข้อมูลตัวอย่างสำหรับสาธิต

ระบบรองรับ 2 สาขาแบบตายตัวในโค้ด: `ubon` = "สาขาสำนักงานใหญ่" และ `khonkaen` = "สาขาที่ 00001"

### ระบบนี้ไม่ใช่อะไร

| ไม่ใช่ | หลักฐานในโค้ด |
|---|---|
| ไม่มี Server / ฐานข้อมูลกลาง | `local-demo-mode.js` ตั้ง `window.FirebaseService = Object.freeze({ configured: false, localOnly: true })` และคอมเมนต์ระบุว่า "does NOT load Firebase Authentication, Firestore, Firebase Storage, Vercel APIs or Google Drive" |
| ไม่มีระบบผู้ใช้/สิทธิ์จริง | ผู้ใช้ทุกคนคือโปรไฟล์ `local-demo-user` บทบาท `owner` (`local-demo-mode.js`) |
| ไม่ส่ง e-Tax Invoice / ไม่ยื่นภาษีออนไลน์ | ไม่มีโค้ดเชื่อมกรมสรรพากร มีแค่ `buildETaxReadiness()` ใน `erp-governance-core.js` ที่ตรวจความพร้อมของข้อมูล |
| ไม่ใช่ระบบบัญชีคู่ (Double-entry) | ไม่มีสมุดรายวัน/ผังบัญชี ยอดทุกตัวคำนวณจากเอกสาร (ดูแนวทางในหัวข้อ 10) |
| ไม่รองรับหลายคนใช้พร้อมกัน | ข้อมูลอยู่ใน `localStorage` ของเครื่องเดียว มีแค่ "write lease" กันการบันทึกชนกันระหว่างแท็บ (`erp-demo-concurrency.js`) |

README ระบุตรง ๆ ว่า "เวอร์ชันนี้ยังเป็น DEMO สำหรับทดลอง Workflow ไม่ใช่ Production หลายผู้ใช้"

### แผนภาพชั้นของระบบ

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ชั้นหน้าจอ (UI)                                                           │
│  index.html (2,067 บรรทัด, 25 panel, เมนูซ้าย)                           │
│  app.js (ตัวควบคุมหลัก 8,279 บรรทัด) + ตัวควบคุมย่อย:                     │
│  erp-order-flow.js · erp-credit-note.js · erp-receivables.js ·           │
│  erp-production-core.js · erp-sales-form-assist.js · business-rules.js · │
│  erp-product-experience.js · erp-customer-experience.js · ฯลฯ            │
└───────────────┬──────────────────────────────────────────────────────────┘
                │ เรียกฟังก์ชัน pure (import) และ API กลางผ่าน window.*
┌───────────────▼──────────────────────────────────────────────────────────┐
│ ชั้นกฎธุรกิจ (pure — ไม่แตะ DOM/storage, ทดสอบใน Node ได้)                │
│  erp-shared-core.js (VAT/WHT/ปัดเศษ/วันที่) · erp-date-core.js ·          │
│  erp-document-finance-core.js · erp-credit-note-core.js ·                 │
│  erp-receivables-core.js · erp-governance-core.js ·                       │
│  erp-master-data-core.js · erp-demo-seed-core.js · ฯลฯ                    │
└───────────────┬──────────────────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────────────────┐
│ ชั้นการเก็บข้อมูล                                                         │
│  erp-storage-contracts.js (ชื่อ key) · tenant-context.js (prefix tenant) │
│  erp-integrity.js (transaction + rollback, ยอดชำระ, reconcile)            │
│  erp-master-data-store.js · erp-governance.js (audit/lock/outbox)         │
│  erp-backup.js (สำรอง/กู้แบบ fail-closed + SHA-256)                       │
│  local-file-store.js (ไฟล์แนบใน IndexedDB)                                │
│        ↓                                   ↓                              │
│   localStorage (ข้อมูลธุรกิจทั้งหมด)      IndexedDB (ไฟล์แนบ)              │
└──────────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────────┐
│ ชั้นเอกสารพิมพ์ (A4 ต้นฉบับ/สำเนา, Preview, พิมพ์, PDF)                    │
│  quotation-document.js · delivery-tax-document.js ·                      │
│  receipt-document.js · credit-note-document.js                           │
│  + vendor/html2canvas-1.4.1 + vendor/jspdf-2.5.1 (โหลดจากเครื่อง)          │
└──────────────────────────────────────────────────────────────────────────┘
```

หลักการที่ตั้งใจไว้ (ADR-002, 003, 006–010): **ตัวเลขเงินและภาษีคำนวณในไฟล์ `*-core.js` ที่เดียว** ชั้นหน้าจอมีหน้าที่อ่านค่าจากฟอร์ม เรียก core แล้วบันทึก ในความเป็นจริงหลักการนี้ทำได้ดีกับงานใหม่ (ใบลดหนี้, ลูกหนี้, ใบวางบิล/รับชำระ) แต่ `app.js` ยังเป็นก้อนใหญ่ที่รวมหลายหน้าที่ไว้ (ดูหัวข้อ 9)

---

## 2. โครงสร้างไฟล์

### 2.1 ไฟล์ JavaScript ที่ทำงานจริง (runtime) — 41 ไฟล์, 22,651 บรรทัด (ตาม `npm run audit:complexity`)

"runtime" หมายถึงไฟล์ที่ `index.html` โหลดโดยตรง (25 ไฟล์ ไม่นับ vendor 2 ไฟล์) หรือถูก `import` ต่อจากไฟล์เหล่านั้น (16 ไฟล์) ไฟล์ `.js` ที่ root มีทั้งหมด 42 ไฟล์ ไฟล์เดียวที่ไม่ใช่ runtime คือ `vite.config.js`

ชั้น (layer): **UI** = ตัวควบคุมหน้าจอ · **Core** = กฎธุรกิจ pure · **Storage** = อ่าน/เขียนข้อมูล · **Doc** = เอกสารพิมพ์ · **Infra** = ระบบพื้นฐาน
โหลดโดย: **H** = `<script>` ใน `index.html` · **I** = ถูก import

#### ขาย

| ไฟล์ | บรรทัด | ชั้น | โหลดโดย | หน้าที่ |
|---|---:|---|---|---|
| `app.js` | 8,279 | UI (+Storage) | H | ตัวควบคุมหลัก: ฟอร์มใบเสนอราคา/ใบกำกับภาษี/ใบเสร็จ/สั่งผลิต/ค่าใช้จ่าย, รายการเอกสาร, แดชบอร์ด, วิเคราะห์ธุรกิจ, ข้อมูลหลัก, นำเข้า CSV, Export/Import, สำรองในเครื่อง, โค้ดซิงก์ Cloud (ปิดใช้ในเดโม) และ `bootComformApp()` |
| `erp-sales-form-assist.js` | 321 | UI | H | ตัวเลือก "รูปแบบใบกำกับภาษี" (เต็มรูป/อย่างย่อ) ล็อก VAT ให้เป็นราคารวม VAT เมื่อเลือกอย่างย่อ และเติมราคาขายมาตรฐานจากแฟ้มสินค้า |
| `erp-order-flow.js` | 1,009 | UI + Storage | H | "ศูนย์งานขาย & ลูกหนี้": ใบสั่งขาย, วางแผนจัดสินค้า, คิวงาน, ใบวางบิล, รับชำระ (Payment) และยกเลิกรับชำระ |
| `erp-document-finance-core.js` | 875 | Core | I | วางแผนการบันทึกเอกสาร (`plan*DocumentAction`), ตัวรัน `runDocumentAction`, สร้างใบวางบิล/รับชำระ/ร่างใบเสร็จจาก Payment, ตรวจ pack ข้อมูลแบบเข้ม |
| `erp-workflow-definitions.js` | 65 | Core | I | นิยามขั้น Order-to-Cash 6 ขั้น สำหรับแถบความคืบหน้า |
| `erp-workflow-graph-core.js` | 61 | Core | I | ตัวรัน workflow graph (ปัจจุบันถูกใช้แค่ในเทสต์ `refactor-4-1.test.cjs`) |
| `quotation-document.js` | 478 | Doc | H | ใบเสนอราคา A4 (ต้นฉบับ/สำเนา), Preview, พิมพ์, PDF |
| `delivery-tax-document.js` | 1,412 | Doc (+Storage) | H | ใบส่งสินค้า/ใบกำกับภาษี A4 แก้ไขบนหน้าเอกสารได้ และบันทึก "ฉบับพิมพ์" ลง `issuedInvoices` |

#### รับเงิน / ลูกหนี้

| ไฟล์ | บรรทัด | ชั้น | โหลดโดย | หน้าที่ |
|---|---:|---|---|---|
| `receipt-document.js` | 1,449 | Doc (+Storage) | H | ใบเสร็จรับเงิน A4 รวมช่องหัก ณ ที่จ่าย และบันทึกฉบับพิมพ์ลง `issuedReceipts` |
| `erp-integrity.js` | 380 | Storage (+กฎ) | H | `ERPIntegrity`: ตัวเขียนแบบ transaction/rollback, `paymentSummary()` (ยอดชำระ/คงค้างของบิล), `reconcilePayments()`, `reconcileBillings()`, ตรวจใบเสร็จ/การส่งของ, สร้างใบเสร็จจาก Payment |
| `erp-receivables-core.js` | 634 | Core | I | กฎวันครบกำหนด (`invoiceDueDate`), ช่วงอายุลูกหนี้, บัญชีลูกหนี้ต่อลูกค้า, CSV, การปรับยอดขายจากใบลดหนี้, สรุปกำไรตามสาขา |
| `erp-receivables.js` | 353 | UI | H | รายงานอายุลูกหนี้ตามลูกค้า และแถบแจ้งเตือนบิลเกินกำหนด |

#### ใบลดหนี้

| ไฟล์ | บรรทัด | ชั้น | โหลดโดย | หน้าที่ |
|---|---:|---|---|---|
| `erp-credit-note-core.js` | 843 | Core | I | กฎใบลดหนี้ ม.86/10: คำนวณ VAT ของผลต่าง, ตรวจยอดลดสะสมไม่เกินบิล, รับคืนสินค้า, แบ่งหน้า, สรุปภาษีขายสุทธิ |
| `erp-credit-note.js` | 846 | UI + Storage | H | หน้าออกใบลดหนี้/รายการใบลดหนี้, บันทึก, แก้ไข, ยกเลิก (รวมตรวจสต็อกเมื่อยกเลิกใบลดหนี้รับคืน) |
| `credit-note-document.js` | 327 | Doc | H | ใบลดหนี้ A4 ครบช่องตาม ม.86/10 |

#### ผลิต / จัดซื้อ / คลัง

| ไฟล์ | บรรทัด | ชั้น | โหลดโดย | หน้าที่ |
|---|---:|---|---|---|
| `erp-production-core.js` | 344 | UI + Storage (ชื่อ "core" แต่ **ไม่ใช่** pure) | H | `ERPProductionCore`: PO, รับสินค้าเข้าคลัง (GR) และกลับรายการ, ปรับยอด/โอนสต็อก, ความเคลื่อนไหวสินค้า, Audit Log, Recycle Bin, ตรวจสต็อกก่อนออกบิล และห่อ (wrap) ฟังก์ชันบันทึกของ `app.js` เพื่อเขียน audit |

งาน "สั่งผลิตสินค้า" และ "รายการสั่งผลิต" อยู่ใน `app.js` (`saveProduction`, `renderPList`) ไม่มีไฟล์แยก

#### ค่าใช้จ่าย

ไม่มีไฟล์แยก ฟอร์มและการบันทึกอยู่ใน `app.js` (`saveExpense` → `saveExpenseUnlocked`, ใช้ `planExpenseDocumentAction` จาก `erp-document-finance-core.js`)

#### รายงาน / วิเคราะห์ / ประสบการณ์ผู้ใช้

| ไฟล์ | บรรทัด | ชั้น | โหลดโดย | หน้าที่ |
|---|---:|---|---|---|
| `erp-customer-experience.js` | 274 | UI | H | แท็บแดชบอร์ด (ภาพรวม / ลูกหนี้ค้างรับ / ยอดขายและเป้าหมาย / คาดการณ์ / ความเสี่ยง — `role="tablist"`, ลูกศร ←/→) และ (ADR-017) ตาราง `DASHBOARD_VIEW_BLOCKS` ว่าบล็อกใดอยู่แท็บใด: ภาพรวม = KPI 4 ช่อง + "สิ่งที่ต้องทำ" + กราฟ 2 รูป, ค้นหาทั้งระบบ `Ctrl K`, Customer 360 |
| `erp-decision-council-core.js` | 149 | Core | I | "Decision Review": กฎตรวจแบบ deterministic หลายมุมมอง (ไม่ใช่ AI/LLM ตามที่คอมเมนต์ระบุ) |
| `erp-decision-council.js` | 73 | UI | H | กล่อง Decision Review บนแดชบอร์ด |
| `erp-product-experience-core.js` | 118 | Core | I | คิวงาน, ความพร้อมของสต็อก, แถวรายการรออนุมัติ |
| `erp-product-experience.js` | 253 | UI | H | หน้า "งานของฉัน", "ศูนย์อนุมัติ", "พอร์ทัลลูกค้า (Preview)", ปุ่มสลับโหมดง่าย/ขั้นสูง, ตั้งชื่อเมนู และ (ADR-015) จัดเมนูซ้ายเป็นหมวดพับได้ (`NAV_SECTIONS` ใน core), ไฮไลต์เมนูของเอกสารเมื่ออยู่หน้าฟอร์ม, ลิงก์ "← รายการ…" บนฟอร์ม |

#### ธรรมาภิบาล / อนุมัติ / สำรองข้อมูล

| ไฟล์ | บรรทัด | ชั้น | โหลดโดย | หน้าที่ |
|---|---:|---|---|---|
| `erp-governance-core.js` | 258 | Core | I | Period Lock, ช่วงอายุหนี้ (AR/AP), นโยบายอนุมัติ `DEMO_APPROVAL_POLICY`, checklist ปิดงวด, ความพร้อม e-Tax/WHT |
| `erp-governance.js` | 112 | Storage + UI | H | `ERPGovernance`: ล็อก/ปลดล็อกงวด, บันทึก audit, Sync Outbox, บันทึกการอนุมัติ |
| `erp-backup.js` | 58 | Storage | H | `ERPBackup`: capture/restore ทั้ง tenant, ตรวจโครงสร้าง, checksum SHA-256, dry-run |

#### ข้อมูลหลัก

| ไฟล์ | บรรทัด | ชั้น | โหลดโดย | หน้าที่ |
|---|---:|---|---|---|
| `erp-master-data-core.js` | 522 | Core | I | กฎลูกค้า/ผู้จำหน่าย/สินค้า: upsert, archive, merge, นำเข้า CSV, ราคามาตรฐาน, เครดิตเทอม |
| `erp-master-data-store.js` | 293 | Storage | I | อ่าน/เขียนข้อมูลหลักแบบแยก tenant และไม่แปลงข้อมูลเสียเป็นรายการว่าง |
| `business-rules.js` | 230 | UI + Storage | H | `BusinessRulesService`: หน้า "สูตรและกฎธุรกิจ" (Margin/Markup/ค่าคอม เก็บเป็นเวอร์ชัน ไม่รันสูตร JS อิสระ) |

#### ระบบพื้นฐาน

| ไฟล์ | บรรทัด | ชั้น | โหลดโดย | หน้าที่ |
|---|---:|---|---|---|
| `boot-status.js` | 73 | Infra | H | เก็บ error ตอนโหลด แสดงแถบ "ระบบโหลดไม่สมบูรณ์" และป้าย "DEMO · Local data" (ป้ายนี้ถูกซ่อนในโหมด Local Demo ตั้งแต่ ADR-015) |
| `tenant-context.js` | 60 | Infra | H | `ComformTenant`: สร้าง prefix `erp_tenant::{tenantId}::` ให้ทุก key |
| `local-demo-mode.js` | 112 | Infra | H | ตั้งโปรไฟล์ผู้ใช้สาธิต, ปิด Cloud, `SaaSService` จำลอง และ (ADR-015) ปุ่ม "⚙ Demo" ที่ส่วนหัว + `window.ERPDemoMenu.register()` ให้โมดูลอื่นเพิ่มรายการเมนูเอง (แทนแถบเขียวเดิม) |
| `erp-ui-menu.js` (ADR-015) | 484 | UI | I | เมนู dropdown ที่เข้าถึงด้วยคีย์บอร์ดได้ (menu button pattern) ใช้กับเมนู Demo และเมนู "⋯" ของแถวในตาราง (`openMenuFor`, ADR-016) |
| `erp-icons.js` (ADR-017) | 131 | UI | I | ชุดไอคอนเส้นชุดเดียวของปุ่ม/เมนู/แถบเครื่องมือ/เมนูซ้าย (`icon(name)` → `<svg class="erp-icon" aria-hidden="true"><use href="#erp-i-…">`, sprite ใส่ท้าย `<body>` ครั้งเดียว) — รวมไอคอนของ part A ไว้ที่นี่ที่เดียว; ไฟล์ที่รันแบบ script ธรรมดาใช้ `window.ERPIcons` |
| `erp-row-actions.js` (ADR-016, 017) | 599 | UI (+ core pure) | I | ปุ่มของแต่ละแถวในตารางรายการ: รายการการทำงานต่อแถวชุดเดียว (`rowActions(listId, facts)`) กำหนดทั้งปุ่มหลัก 1 ปุ่มและเมนู "⋯" (เรียงดู/พิมพ์ → แก้ไข → สร้างเอกสารต่อ → อื่น ๆ → ลบ/ยกเลิก สีแดงท้ายสุด), เรียกฟังก์ชันเดิมด้วยอาร์กิวเมนต์เดิม, ตัวดักคลิกเดียวต่อหน้า (`window.ERPRowActions`), (ADR-017) คืนโฟกัสคีย์บอร์ดให้ปุ่มของแถวเดิมหลังรายการถูกวาดใหม่ — import โดย `app.js`, `erp-credit-note.js`, `erp-order-flow.js`, `business-rules.js`; `erp-production-core.js` ใช้ผ่าน `window.ERPRowActions` |
| `local-file-store.js` | 193 | Storage | H | `LocalFileStore`: เก็บไฟล์แนบใน IndexedDB `comform-local-files` |
| `click-fallback.js` | 103 | Infra | H | `go()` สำรองสำหรับ `onclick` ในกรณีที่ `app.js` ยังโหลดไม่เสร็จ และเมนู ☰ บนมือถือ (ปิดเมื่อเลือกเมนูใดก็ได้) |
| `erp-storage-contracts.js` | 38 | Infra | I | ชื่อ key ที่เก็บถาวร และ event `erp:storage-written` |
| `erp-shared-core.js` | 431 | Core | I | VAT, WHT, ปัดเศษ ป.86/2542, รูปแบบใบกำกับภาษี, จำนวนเงินเป็นตัวอักษร, แบ่งหน้าเอกสาร, วันที่ธุรกิจ |
| `erp-date-core.js` | 101 | Core | I | แปลง พ.ศ./ค.ศ., แยกวันที่หลายรูปแบบ, ป้ายเดือนไทย |
| `erp-demo-concurrency.js` | 30 | Infra | I | `withDemoWriteLease()` กันสองแท็บบันทึกบัญชีขายพร้อมกัน |
| `erp-detail-security.js` | 13 | Infra | I | กรอง URL ไฟล์แนบ (อนุญาต `blob:`, `https:`, data URL ของรูป/PDF) |
| `local-demo-health.js` | 38 | Infra | H | รายการ "ตรวจสถานะ Demo" ในเมนู Demo และ guard กันกดบันทึกซ้ำ (single-flight) |
| `trial-mode.js` | 137 | Infra | H | `TrialService`: onboarding และโควตาทดลอง (ในโหมดเดโม: ใบเสนอราคา 30, ใบกำกับ 20, ใบเสร็จ 20, ลูกค้า 30, ผู้จำหน่าย 20, สินค้า 50 — ไม่นับข้อมูลตัวอย่าง) |
| `erp-demo-seed-core.js` | 829 | Core | I | สร้างข้อมูลตัวอย่างบริษัท IT ไทย โดยอิงวันที่ปัจจุบัน (ADR-013) |
| `erp-demo-seed.js` | 478 | UI + Storage | H | รายการ "โหลดข้อมูลตัวอย่างสำหรับสาธิต" และ "ล้างข้อมูลสาธิตทั้งหมด (รีเซ็ต)" (สีแดง ล่างสุด) ในเมนู Demo |
| `erp-company-profile-core.js` (ADR-020) | 591 | Core | I | ข้อมูลบริษัท/โลโก้ของลูกค้า: ตรวจเลขผู้เสียภาษี (check digit) รหัสสาขา ช่องบังคับ, อ่าน/เขียน 2 key แบบ all-or-nothing, รวมเข้า `CurrentUser.companyProfile`, `documentCompany()` ให้ `branchCompany()` ของเอกสาร, `companyLogoUrl()` ตัวเดียว, ย่อโลโก้ด้วย canvas, ตรวจ Backup |
| `erp-document-cancel-core.js` (ADR-021) | 104 | Core | I | กติกายกเลิกใบกำกับภาษี/ใบเสร็จ (ไม่ลบ): รายการเหตุผล, ตรวจเหตุผล, ข้อความเอกสารที่ต้องยกเลิกก่อน, `applyDocumentCancel()` (status `cancelled` + `voided`), ปลดการเชื่อมใบเสนอราคา/ใบสั่งผลิต |
| `erp-document-cancel.js` (ADR-021) | 214 | UI + Storage | H | `ERPDocumentCancel`: เมนู ⋯ › "ยกเลิกใบกำกับภาษี / ยกเลิกใบเสร็จ", กล่องเหตุผล, ปฏิเสธเมื่อปิดงวด/มีเอกสารอ้างอิง, บันทึกใน write session เดียว + Audit Log |
| `erp-company-profile.js` (ADR-020, 022) | 716 | UI | H | หน้า ตั้งค่าบริษัท › "ข้อมูลบริษัทและโลโก้": ฟอร์ม + ตัวอย่างหัวเอกสาร, อัปโหลดโลโก้, บันทึก/คืนค่า/กลับไปใช้ข้อมูลตัวอย่าง, `ERPCompanyProfile` (export/restore ใน Backup JSON) และ (ADR-022) "จำนวนสถานประกอบการ" (ปฏิเสธเมื่อสาขา 2 ยังมีข้อมูล) + ตัวปรับหน้าจอสาขา (`applyBranchScreens`: ชื่อสาขาในฟอร์ม/ตัวกรอง/แท็บ, ซ่อนสาขา 2 ในโหมดสาขาเดียว, แถบเตือนเมื่อพบข้อมูลสาขา 2) |
| `erp-tax-reports-core.js` (ADR-023) | 840 | Core | I | pure: งวดภาษี/วันครบกำหนด, ตรวจเลขผู้เสียภาษี, รหัสสถานประกอบการผู้ขาย, `planExpenseVatFields` (ม.82/3, 82/5, ซ้ำ), `buildSalesTaxReport` / `buildPurchaseTaxReport` / `buildPp30Summary`, CSV, `vatReturns` (normalize/parse/merge/ยอดยกมา) |
| `erp-tax-forms.js` (ADR-023) | 408 | UI | H | `ERPTaxForms`: ส่วนใบกำกับภาษีซื้อในฟอร์มค่าใช้จ่าย, สาขาผู้จำหน่าย, `vatCategory` ในฟอร์มบิล, ป้าย "ข้อมูล VAT ไม่ครบ" |
| `erp-tax-reports.js` (ADR-023) | 665 | UI + Storage | H | `ERPTaxReports`: หน้า "รายงานภาษี" 4 แท็บ, พิมพ์ A4 / Excel / CSV, บันทึกการยื่น ภ.พ.30 (`comform_vat_returns_v1`) + เสนอปิดงวด |
| `erp-branches-core.js` (ADR-022) | 342 | Core | I | แหล่งความจริงเดียวของสาขา: การตั้งค่า 1/2 (`comform_company_branch_setting_v1`, ไม่มี = 2), ชื่อสาขาจากข้อมูลบริษัท (`branchLabelMap()` แทน `BRANCH_TH`/`BRANCH_LABEL` ของทุกโมดูล), สำรวจข้อมูลสาขา 2 (`branchDataCensus`), ข้อความปฏิเสธ/เตือน, ช่องเลือกสาขาของหน้าเอกสาร A4 — `window.ERPBranches` ติดตั้งโดย `local-demo-mode.js` สำหรับ script ธรรมดา |

**ไฟล์อื่นที่หน้าเว็บใช้:** `index.html` (2,067 บรรทัด, 201 KB), CSS 15 ไฟล์ (ใหญ่สุด `style.css` 2,667 บรรทัด), `logo.png` (322 KB), `vendor/html2canvas-1.4.1.min.js`, `vendor/jspdf-2.5.1.umd.min.js` และ `deployment-check.html` (หน้าตรวจไฟล์เว็บ)

### 2.2 ใครใช้ใคร (import ระหว่างไฟล์)

ไฟล์ core ที่ถูกใช้มากที่สุดคือ `erp-shared-core.js` (ถูก import โดย 24 ไฟล์) รองลงมา `erp-storage-contracts.js`, `erp-document-finance-core.js`, `erp-credit-note-core.js` และ `erp-receivables-core.js` ความสัมพันธ์สำคัญ:

```
app.js ──import──► erp-shared-core, erp-date-core, erp-master-data-core, erp-master-data-store,
                   erp-storage-contracts, erp-detail-security, erp-demo-concurrency,
                   erp-document-finance-core, erp-credit-note-core, erp-receivables-core
erp-integrity.js ─► erp-document-finance-core, erp-shared-core, erp-credit-note-core
erp-order-flow.js ► erp-document-finance-core, erp-receivables-core, erp-shared-core
erp-receivables-core.js ► erp-shared-core, erp-date-core, erp-credit-note-core, erp-governance-core
erp-document-finance-core.js ► (ไม่ import อะไรเลย — ตั้งใจให้เป็นอิสระ)
```

นอกจาก `import` แล้ว ไฟล์ต่าง ๆ ยังคุยกันผ่านตัวแปรกลาง `window.*` เป็นหลัก (ดูหัวข้อ 3.3)

### 2.3 โฟลเดอร์ที่ไม่ใช่ runtime

| โฟลเดอร์ | ใช้ทำอะไร |
|---|---|
| `tests/` | ไฟล์ `.cjs` 38 ไฟล์: ไฟล์เทสต์ที่ `npm test` รัน 34 ไฟล์, `deployment.check.cjs` / `deployment-flat.check.cjs` และ helper `dom-helper.cjs` (boot แอปใน jsdom), `vm-esm-helper.cjs` (import ES module ใน CommonJS) |
| `scripts/` | ตัวรันเทสต์ (`run-tests.mjs`), สคริปต์ audit 7 ตัว (`audit-*.mjs`), build flat, สร้างหน้าตรวจ deployment, สคริปต์ evidence และ `scripts/security/` (ตรวจไฟล์ควบคุม AI agent และ baseline SHA-256) |
| `docs/` | `TESTING_TH.md`, `DEMO_SCRIPT_TH.md`, `decisions/` (ADR-001…013), `history/` (บันทึกรุ่นเก่า), `code-review/`, `cloud-reference/` (แนวทางตั้ง Firebase ในอนาคต) และเอกสารนี้ |
| `vendor/` | ไลบรารี PDF แบบออฟไลน์ + LICENSE + `vendor-manifest.json` (ADR-013) และ SheetJS 0.18.5 สำหรับส่งออก Excel (Apache-2.0, โหลดเมื่อกดส่งออกครั้งแรกจาก URL ใน `<meta name="erp-vendor-xlsx">`, ADR-021) |
| `specs/` | ข้อกำหนด: `constitution/ERP_CONSTITUTION.md`, order-to-cash, money-tax, inventory, quality, security และ `TRACEABILITY.json` (32 requirement) |
| `evidence/` | ผลเทสต์ (`.tap`/`.json`) ที่เก็บไว้เป็นหลักฐานตอนออก release |
| `csv-templates/` | แม่แบบ CSV สำหรับนำเข้าลูกค้า / ผู้จำหน่าย / สินค้า |
| `CODEX_HANDOFF/` | เอกสารส่งต่องานให้ AI agent รุ่นก่อน |
| `.github/workflows/ci.yml` | CI บน GitHub Actions |
| `dist/`, `dist-flat/` | ผล build (Vite และแบบไฟล์แบน) |

### 2.4 ไฟล์ที่ root จำนวนมาก

root มีไฟล์ `.json` 50 ไฟล์ และ `.md` 58 ไฟล์ แบ่งเป็นกลุ่มได้ดังนี้

| กลุ่ม | ตัวอย่าง | คืออะไร |
|---|---|---|
| ผล audit ล่าสุด (7 ไฟล์) | `CODEBASE_AUDIT_RESULTS.json`, `COMPLEXITY_AUDIT_RESULTS.json`, `DEEP_CODE_AUDIT_RESULTS.json`, `FINANCIAL_CONTROLS_AUDIT_RESULTS.json`, `SPEC_AUDIT_RESULTS.json`, `DOCUMENT_*_AUDIT_RESULTS.json` | สคริปต์ `npm run audit:*` เขียนทับทุกครั้งที่รัน |
| งบประมาณ/baseline | `QUALITY_BUDGET.json`, `QUALITY_BASELINE.json`, `DOCUMENT_CONTROLLER_DUPLICATION_BUDGET.json`, `DOCUMENT_RENDER_GOLDEN_BASELINE.json`, `SECURITY_BASELINE_SHA256.json` | เพดานความซับซ้อนและค่าอ้างอิงที่ audit ใช้เทียบ |
| บันทึกการ refactor ทีละขั้น (81 ไฟล์ที่มีคำว่า `_STEP`) | `ERP_DEMO_4_3_1_STEP2A…STEP4A_*_TH.md`, `*_BOUNDARY_4_3_1_STEP*.json`, `*_DEPENDENCY_MAP_*_TH.md`, `ERP_4_3_1_STEP*_VALIDATION.*` | ประวัติการแยกโค้ดออกจาก `app.js` ทีละขั้น (2A วันที่ → 4A ธรรมาภิบาล) เป็นข้อมูลย้อนหลัง ไม่ได้ถูกโค้ดอ่าน |
| แผนที่ dependency | `APP_JS_DEPENDENCY_MAP_4_3_1_STEP2A.json` (335 KB), `ALL_CODE_PACKAGE_MANIFEST.json` | ผลวิเคราะห์ของ `scripts/analyze-app-dependencies.mjs` |
| คู่มือ/บริบท | `README.md`, `LOCAL_DEMO_GUIDE.md`, `BUSINESS_RULES_TRIAL_GUIDE.md`, `PRESENTATION_DEMO_FLOW_TH.md`, `SECURITY*.md`, `DEVELOPMENT_CONTEXT.json`, `ERP_IMPROVEMENT_ROADMAP_*` | เอกสารสำหรับคนอ่าน |

ข้อสังเกต: ไฟล์ประวัติเหล่านี้ทำให้ root รกและค้นหายาก ควรย้ายไป `docs/history/` ในอนาคต (สคริปต์ audit บางตัวอ่านไฟล์ budget/baseline จาก root จึงต้องย้ายพร้อมแก้ path)

---

## 3. ลำดับการโหลดและการเริ่มต้นระบบ

### 3.1 ลำดับ `<script>` ใน `index.html`

`index.html` มี inline script 1 ตัว (`deployment-watchdog` บรรทัด 13) และ `<script src>` 27 ตัว (module 25 + vendor classic 2) ที่บรรทัด 2036–2063:

| ลำดับ | ไฟล์ | ประเภท |
|---:|---|---|
| 0 | inline `deployment-watchdog` | classic (รันทันที) |
| 1 | `boot-status.js` | module |
| 2 | `tenant-context.js` | module |
| 3 | `local-demo-mode.js` | module |
| 4 | `local-file-store.js` | module |
| 5 | `erp-integrity.js` | module |
| 6 | `erp-governance.js` | module |
| 7 | `erp-backup.js` | module |
| 8 | `click-fallback.js` | module |
| 9 | `vendor/html2canvas-1.4.1.min.js` | classic |
| 10 | `vendor/jspdf-2.5.1.umd.min.js` | classic |
| 11 | `delivery-tax-document.js` | module |
| 12 | `quotation-document.js` | module |
| 13 | `receipt-document.js` | module |
| 14 | **`app.js`** | module |
| 15 | `credit-note-document.js` | module |
| 16 | `erp-credit-note.js` | module |
| 17 | `erp-receivables.js` | module |
| 18 | `erp-sales-form-assist.js` | module |
| 19 | `business-rules.js` | module |
| 20 | `trial-mode.js` | module |
| 21 | `erp-production-core.js` | module |
| 22 | `erp-order-flow.js` | module |
| 23 | `erp-customer-experience.js` | module |
| 24 | `local-demo-health.js` | module |
| 25 | `erp-decision-council.js` | module |
| 26 | `erp-product-experience.js` | module |
| 27 | `erp-demo-seed.js` | module |
| 28 | `erp-company-profile.js` (ADR-020; ข้อมูลที่บันทึกไว้ถูกรวมตอนบูตโดย `local-demo-mode.js` ก่อนเอกสารใด ๆ) | module |

สิ่งที่ควรรู้เรื่องลำดับ:

- `type="module"` ทำงานแบบ **deferred**: รันหลัง HTML parse เสร็จ ตามลำดับในไฟล์ ส่วน vendor 2 ตัวเป็น classic script ที่ไม่มี `defer` จึง **รันก่อน module ทุกตัว** แม้จะอยู่บรรทัดหลัง
- โมดูลที่ถูก import (เช่น `erp-shared-core.js`) ถูกประเมินครั้งเดียว ก่อนไฟล์แรกที่ import มัน
- ตอน build ด้วย Vite ทุก module ถูกรวมเป็น bundle เดียว `dist/assets/main-*.js` ขนาด 1,153,660 ไบต์ (build ล่าสุด 30 ก.ย.) vendor ถูกคัดลอกแยกโดยปลั๊กอินใน `vite.config.js`

### 3.2 อะไรเริ่มทำงานเมื่อไร

1. **`deployment-watchdog`** (inline) ฟัง error ของ `<link>/<script>/<img>` ถ้าผ่านไป 8 วินาทีแล้ว `window.ComformAppReady !== true` จะแสดงกล่องเหลือง "โหลดหน้าเว็บไม่ครบ"
2. **`boot-status.js`** ตั้ง `window.ComformRuntimeStatus` เก็บ error และ unhandled rejection ฟัง `comform-app-ready` / `comform-app-failed` และตรวจอีกครั้งหลัง `DOMContentLoaded` + 6.5 วินาที
3. **`tenant-context.js`** ตั้ง `window.ComformTenant` (ต้องมาก่อนใครเขียน storage)
4. **`local-demo-mode.js`** ตั้ง `window.CurrentUser` (tenant `customer-showcase-local`), `ComformAuth`, `FirebaseService` แบบปิด, `SaaSService` จำลอง แล้วยิง event `comform-auth-ready` **สองครั้ง**: ทันที และอีกครั้งหลัง 900 ms (เพราะโมดูลที่โหลดทีหลังยังไม่ได้ติดตั้ง listener)
5. โมดูลธุรกิจที่อยู่ก่อน `app.js` (`erp-integrity`, `erp-governance`, `erp-backup`, document renderers) **ลงทะเบียนตัวเองบน `window`** ทันทีที่ถูกประเมิน
6. **`app.js`**: เรียก `exposeInlineHandlers()` ทันทีตอนโหลด (ให้ `onclick` ใน HTML ใช้ได้) และเนื่องจาก module รันตอน `document.readyState` ไม่ใช่ `'loading'` แล้ว `bootComformApp()` จึงรันทันที ภายในทำ `migrateLegacyIssuedDocuments()` → `initDropdowns()` → `initMasterData()` … → `renderDash()` → `renderDataAnalytics()` → เพิ่มแถวว่างในฟอร์ม → ตั้ง `window.ComformAppReady = true` แล้วยิง `comform-app-ready` ถ้า error ใดหลุดออกมาจะยิง `comform-app-failed`
7. โมดูลหลัง `app.js` เริ่มงานด้วยตัวจับเวลาหรือ event ของตัวเอง เช่น `erp-production-core.js` boot ที่ `DOMContentLoaded` + 50 ms, `local-demo-health.js` ที่ + 350 ms และลองติดตั้ง guard ซ้ำทุก 300 ms อีก 20 รอบ, `trial-mode.js` หลัง `comform-auth-ready` + 250 ms (หรือ 1.6 วินาที), `erp-order-flow.js` สร้างเมนู/panel ของตัวเอง (ลองใหม่ทุก 300 ms จนกว่า `.sidebar` จะพร้อม)
8. หลัง `comform-auth-ready` `app.js` ตั้ง interval 60 วินาทีเรียก `scheduleCloudSync()` (ในเดโมไม่มี Cloud จึงไม่ได้ทำอะไรจริง)

**ผลที่ตามมา:** เมนูหลายรายการไม่ได้อยู่ใน `index.html` แต่ถูกเสียบเข้าไปทีหลัง เช่น "ศูนย์งานขาย & ลูกหนี้" (`erp-order-flow.js`), "งานของฉัน", "ศูนย์อนุมัติ", "พอร์ทัลลูกค้า (Preview)" (`erp-product-experience.js`) และ `erp-product-experience.js` ยังเปลี่ยนข้อความเมนูเดิมตามตาราง `PANEL_LABEL` ด้วย (เช่น `receipt-form` แสดงเป็น "รับชำระ / ใบเสร็จ", `files` แสดงเป็น "สำรอง / นำเข้าข้อมูล") ชื่อเมนูที่ผู้ใช้เห็นจึงอาจต่างจากข้อความใน `index.html`

**ระดับปุ่มและไอคอน (ADR-017):** ปุ่มมี 3 ระดับ (`.btn-primary` ทึบ · `.btn-secondary` เส้นขอบ · `.btn-tertiary` ข้อความ) + `.btn-danger` กำหนดที่เดียวใน `erp-ui.css` กติกา "ปุ่มทึบได้ไม่เกิน 1 ปุ่มต่อพื้นที่" (แถบหัว/ท้ายฟอร์ม/การ์ด/ไดอะล็อก) ไอคอนทุกปุ่มมาจาก `erp-icons.js` (ไม่ใช้ emoji) ยกเว้นหน้าเอกสารพิมพ์/PDF ซึ่งไม่แตะ · คอลัมน์ปุ่มท้ายตารางรายการตรึงชิดขวาเมื่อเลื่อนตาราง

**เมนูซ้าย (ADR-015):** 6 หมวดพับได้ — หน้าหลัก · ขายและรับเงิน · ซื้อ / ผลิต / คลัง · ค่าใช้จ่าย · ข้อมูลและรายงาน · ตั้งค่า — เอกสารแต่ละชนิดมีเมนูเดียวที่เปิดหน้ารายการ (ปุ่ม "+ สร้าง…" อยู่บนหน้ารายการ) หมวดที่พับเก็บใน `erp_nav_collapsed_sections_v1` และ route ของ `go()` ไม่เปลี่ยน

**การนำทาง:** ระบบมี **มุมมองเดียวแบบ Admin** ทุกคนเห็นเมนูครบ มีปุ่มสลับ **โหมดง่าย / โหมดขั้นสูง** (key `erp_product_experience_mode_v1`) โหมดง่ายซ่อนเฉพาะ 4 หน้าขั้นสูง (`ADVANCED_PANELS`: วิเคราะห์ธุรกิจ, สูตรและกฎธุรกิจ, ศูนย์ควบคุม, สำรอง/นำเข้าข้อมูล — ตั้งค่าบริษัทออกจากรายการตาม ADR-020 และในโหมดง่ายแสดงเฉพาะการ์ด "ข้อมูลบริษัทและโลโก้") รวมถึงแท็บแดชบอร์ด "คาดการณ์" และ "ความเสี่ยง" — เมนู "มุมมอง" ตามบทบาท (ผู้บริหาร/ฝ่ายขาย/จัดซื้อ/คลัง/บัญชี/ผู้ดูแลระบบ) ถูกถอดออกแล้ว (ADR-014)

### 3.3 API กลางบน `window` ที่โมดูลใช้คุยกัน

ไฟล์ส่วนใหญ่เป็น IIFE ที่ **ไม่ export อะไร** แต่ตั้ง object บน `window` ให้ไฟล์อื่นเรียก รายการหลัก:

| ชื่อ | ตั้งโดย | ถูกอ้างถึงใน (จำนวนไฟล์) | ใช้ทำอะไร |
|---|---|---:|---|
| `ComformTenant` | `tenant-context.js` | 16 | สร้าง/ถอด prefix ของ tenant ใน key |
| `ERPIntegrity` | `erp-integrity.js` | 14 | `transaction()`, `paymentSummary()`, `reconcilePayments()`, `business()`, `validateReceipt()`, `validateDelivery()`, `createPaymentReceipts()`, `changed()` |
| `ERPGovernance` | `erp-governance.js` | 10 | `assertPeriodOpen()`, `lockPeriod()`, `appendAudit()`, `recordApprovalDecision()`, Sync Outbox |
| `ERPOrderFlow` | `erp-order-flow.js` | 10 | `getStore()`, `scanBusinessData()`, `openTab()`, `voidPayment()` ฯลฯ |
| `ERPProductionCore` | `erp-production-core.js` | 5 | `audit()`, `trashSnapshot()`, `inventoryMovementNet()`, `stockOnHand()`, `validateInvoiceStock()`, export/import |
| `ComformDocumentWriteStore` | `app.js` | 5 | `createSession()` — "write session" อ่าน/เขียนหลาย pack รายเดือนแล้ว commit ครั้งเดียว |
| `BusinessRulesService` | `business-rules.js` | 4 | สูตรราคา/ค่าคอม |
| `TrialService` | `trial-mode.js` | 4 | โควตาทดลอง, onboarding |
| `ERPCreditNotes` | `erp-credit-note.js` | 3 | ใบลดหนี้ |
| `MasterDataPersistence` | `app.js` | 3 | เขียนข้อมูลหลัก |
| `ERPWorkflowContext` | `app.js` | 3 | ส่งต่อ "SO ที่กำลังเตรียม" ระหว่างหน้าจอ (`preparedSalesOrderId`, `preparedProductionOrderId`) |
| `LocalFileStore` | `local-file-store.js` | 3 | ไฟล์แนบใน IndexedDB |
| `ERPBackup` | `erp-backup.js` | 2 | สำรอง/กู้ |
| `ComformReceiptDocument`, `ComformDeliveryTaxDocument`, `ComformQuotationDocument`, `ComformCreditNoteDocument` | document renderers | 2 ต่อตัว | เปิดเอกสารพิมพ์จากข้อมูล |
| `ERPReceivables`, `ERPDemoSeed`, `ERPDecisionCouncil`, `ERPCustomerExperience`, `ERPProductExperience`, `ERPSalesFormAssist`, `LocalDemoHealth` | ไฟล์ของตัวเอง | 1–2 | API ของแต่ละหน้าจอ |
| `ComformSafety` | `app.js` | – | สร้าง/กู้/แสดงรายการ backup ในเครื่อง |

นอกจากนี้ `app.js` ยังตั้ง **ฟังก์ชันเดี่ยว ๆ บน `window` อีกจำนวนมาก**: 106 ชื่อใน `exposeInlineHandlers()` (เช่น `saveInvoice`, `go`, `renderDash`) และ 56 ชื่อใน `Object.assign(window, {...})` ที่บรรทัด 8205 (เช่น `loadFor`, `saveFor`, `docsForYear`, `productMasterRows`) นับรวมทุกไฟล์ได้ประมาณ 220 ชื่อบน `window`

**Event ที่ใช้สื่อสาร:** `comform-auth-ready`, `comform-app-ready`, `comform-app-failed`, `erp-flow:changed` (หลังข้อมูลขายเปลี่ยน), `erp:storage-written` (หลังเขียน storage นอก `saveFor`), `erp:navigation`, `erp:flow-ready` และ event `storage` ของ Browser (ข้ามแท็บ)

**การห่อฟังก์ชัน (wrapping):** ฟังก์ชันบันทึกของ `app.js` ถูกโมดูลอื่นแทนที่บน `window` ทีละชั้น ตัวอย่าง `window.saveInvoice` ที่ปุ่มกดจริงผ่านทั้งหมดนี้ (เรียงจากนอกเข้าใน ตามลำดับเวลาที่ติดตั้ง):

```
trial-mode.js wrap()                 ← ตรวจโควตาทดลอง
 └ local-demo-health.js singleFlight ← กันกดซ้ำ (ปฏิเสธซ้ำภายใน 250 ms)
    └ erp-production-core installStockValidation ← ตรวจสต็อกก่อนออกบิล
       └ erp-production-core wrapDocumentHandlers ← เขียน Audit Log
          └ app.js saveInvoice → withDemoWriteLease('sales-ledger') → saveInvoiceUnlocked
```

ลำดับชั้นขึ้นกับตัวจับเวลา (50 ms / 350 ms / auth-ready + 250 ms) จึงเปราะบาง `docs/TESTING_TH.md` บันทึกไว้แล้วว่าเทสต์ 7 ตัวผ่านได้เพราะ guard ยังไม่ถูกติดตั้งตอนเทสต์เรียก

---

## 4. ข้อมูลและการจัดเก็บ

### 4.1 ภาพรวม

- **ทุกอย่างอยู่ใน `localStorage`** ยกเว้นไฟล์แนบ (IndexedDB) และ tenant ที่ใช้งาน (`sessionStorage` key `erp_active_tenant_v1`)
- ทุก key ธุรกิจถูกครอบด้วย `ComformTenant.storageKey(base)` → `erp_tenant::{tenantId}::{base}` ในเดโม tenantId คือ `customer-showcase-local` จึงเป็นเช่น `erp_tenant::customer-showcase-local::biz2_ubon_2026_09`
- ชื่อ key ถาวรกำหนดใน `erp-storage-contracts.js` (`STORAGE_CONTRACT_VERSION = '1.5.0'`, ADR-003) แต่ **ไม่ครบทุก key** (ดูตาราง 4.3)
- ขนาด: `localStorage` ของ Browser ส่วนใหญ่ได้ราว 5 MB ต่อ origin ระบบไม่มีการจำกัดเอง แต่ `saveFor()` ใน `app.js` จับ `QuotaExceededError` แล้วแจ้ง "พื้นที่จัดเก็บของเบราว์เซอร์เต็ม" และ `local-demo-health.js` แสดงขนาดที่ใช้ (นับจาก key ของ tenant × 2 ไบต์ และ `navigator.storage.estimate()`) ไฟล์ภาพ/PDF **ไม่ถูกเก็บเป็น Base64** ใน `localStorage` (`localCacheJsonReplacer` ตัด field `data`, `file`, `blob`, `previewUrl`, `objectUrl`)

### 4.2 เอกสารขายเก็บเป็น "pack รายเดือนต่อสาขา"

```
biz2_{branch}_{ปี ค.ศ.}_{เดือน 01–12}      เช่น biz2_khonkaen_2026_09
```

- สร้างโดย `keyFor(branch, year, month)` ใน `app.js` (month ในโค้ดเป็น 0–11 แล้ว +1 ตอนสร้าง key)
- แต่ละ pack เป็น JSON object ที่มี 8 รายการ (`DOCUMENT_PACK_COLLECTIONS` ใน `erp-document-finance-core.js`): `quotes`, `invoices`, `receipts`, `issuedInvoices`, `issuedReceipts`, `expenses`, `productions`, `creditNotes`
- เอกสารอยู่ใน pack ของ **เดือนตามวันที่เอกสาร** ถ้าแก้วันที่ข้ามเดือน `commitDocumentEdit()` จะย้ายเอกสารไป pack ใหม่ใน transaction เดียว
- `issuedInvoices` / `issuedReceipts` คือ "ฉบับพิมพ์" ที่บันทึกจากหน้าเอกสาร A4 (`documentKind: 'delivery-tax-invoice'` / `'receipt-document'`) ส่วน `invoices` / `receipts` คือเอกสารที่บันทึกจากฟอร์ม เวลารวมยอด `ERPIntegrity.dedupe()` จะเอาเอกสารจากฟอร์มก่อน แล้วเติมฉบับพิมพ์ที่ไม่ซ้ำกับใบใดเลย
- การอ่านมี 2 แบบ: `loadFor()` **ทนต่อข้อมูลเสีย** (คืน pack ว่างแล้ว log error เพื่อให้หน้าจอไม่พัง) และ `loadForFinancialDocumentWrite()` / `loadForBackupRead()` ที่ **หยุดทันที** ถ้า pack เสีย (ใช้ `parseFinancialDocumentPackForWrite`) เพื่อไม่ให้บันทึกทับหรือสำรองข้อมูลที่หายไปโดยไม่รู้ตัว

**สาขา (ADR-022):** pack ยังมี 2 ชุดเสมอ (`ubon`, `khonkaen`) และ **ทุกยอดรวม/รายงาน/เลขที่เอกสาร/Backup อ่านทั้ง 2 id เสมอ** (`tenantActiveBranchIds()` ไม่ขึ้นกับโหมด) โหมด "สำนักงานใหญ่อย่างเดียว" เปลี่ยนเฉพาะ *หน้าจอ* และจะเป็นสาขาเดียวก็ต่อเมื่อสาขา 2 ไม่มีข้อมูลเลย ถ้ามีข้อมูลสาขา 2 เข้ามา (นำเข้า Backup/CSV) หน้าจอกลับเป็น 2 สาขา + แถบเตือน

### 4.3 key อื่นทั้งหมด (ไม่รวม prefix tenant)

| key | เจ้าของ | อยู่ใน contracts? | เก็บอะไร |
|---|---|:-:|---|
| `biz2_{branch}_{yyyy}_{mm}` | `app.js` (และสร้างซ้ำใน 8 ไฟล์) | – | pack เอกสารรายเดือน |
| `example_erp_order_flow_v3` | `erp-order-flow.js` | ✓ | `{salesOrders, billingNotes, payments, reservations, activity, schemaVersion}` |
| `example_erp_order_flow_v2` | – | ✓ (legacy) | รุ่นเก่า ย้ายเข้า v3 อัตโนมัติถ้า v3 ว่าง |
| `example_erp_order_flow_preferences_v3` | `erp-order-flow.js` | ✓ | ค่าหน้าจอของศูนย์งานขาย |
| `comform_contact_master_v1` | `erp-master-data-store.js` | ✓ | ลูกค้า + ผู้จำหน่าย |
| `comform_product_master_v1` | `erp-master-data-store.js` | ✓ | สินค้า/บริการ |
| `comform_business_rules_v1` | `business-rules.js` | ✓ | สูตรราคา/ค่าคอม (มีเวอร์ชัน) |
| `comform_sales_targets_v1`, `comform_delivery_targets_v2` | `app.js` | ✓ | เป้ายอดขาย/เป้าส่งของ (ค่าเริ่มต้น 0 = "ยังไม่ได้ตั้งเป้า", ADR-021) |
| `comform_sales_target_period_overrides_v1`, `comform_delivery_target_period_overrides_v1` | `app.js` (ชื่ออยู่ใน `erp-storage-contracts.js` ตั้งแต่ ADR-021) | ✗ | เป้ารายเดือน `{"scope:YYYY-MM": บาท}` — รีเซ็ตเดโมไม่ลบเป้าที่ผู้ใช้ตั้งเอง |
| `comform_demo_seed_targets_v1` | `erp-demo-seed.js` (ADR-021) | ✗ | รายการเป้ารายเดือนที่ข้อมูลตัวอย่างเขียนไว้ (รีเซ็ตลบเฉพาะรายการที่ยังเป็นค่าเดิม) |
| `comform_company_branch_setting_v1` | `erp-company-profile.js` (ADR-022) | ✓ (`masterData.companyProfile.branchSetting`) | `{schemaVersion, count: 1\|2, updatedAt}` จำนวนสถานประกอบการ ไม่มี = 2 — รีเซ็ตเดโมไม่ลบ |
| `comform_purchase_orders_v1`, `comform_goods_receipts_v1`, `comform_inventory_movements_v1` | `erp-production-core.js` | ✗ | PO, ใบรับสินค้า, ความเคลื่อนไหวสินค้า |
| `comform_audit_log_v1` | `erp-production-core.js` | ✗ | Audit Log เชิงปฏิบัติการ (เก็บล่าสุด 2,500 แถว) |
| `comform_recycle_bin_v1` | `erp-production-core.js` | ✗ | สำเนาเอกสารที่ถูกลบ (ล่าสุด 300 แถว) |
| `comform_governance_period_locks_v1` | `erp-governance.js` | ✓ | เหตุการณ์ล็อก/ปลดล็อกงวด |
| `comform_governance_audit_v1` | `erp-governance.js` | ✓ | Audit ของธรรมาภิบาล (ล่าสุด 5,000 แถว) |
| `comform_approval_history_v1` | `erp-governance.js` | ✓ | ประวัติการอนุมัติ (ล่าสุด 1,500) |
| `comform_sync_outbox_v1` | `erp-governance.js` | ✓ | คิวซิงก์ Cloud (ในเดโมแทบไม่ใช้) |
| `comform_auto_backup_index_v1`, `comform_auto_backup_v1_{id}` | `app.js` | ✗ | backup ในเครื่อง สูงสุด 8 ชุด (`CLOUD_SYNC_SAFETY.maxBackups`) |
| `comform_delivery_tax_document_draft_v1`, `comform_receipt_document_draft_v1` | document renderers | ✗ | ฉบับร่างของหน้าเอกสาร A4 |
| `erp_product_experience_mode_v1` | `erp-product-experience.js` | ✓ | โหมดง่าย/ขั้นสูง |
| `erp_nav_collapsed_sections_v1` | `erp-product-experience.js` | ✓ | หมวดเมนูซ้ายที่พับไว้ (ADR-015) |
| `comform_company_profile_v1` | `erp-company-profile.js` (ADR-020) | ✓ | ข้อมูลบริษัทของลูกค้า `{schemaVersion, nameTh, nameEn, taxId, addressTh, phone, email, website, branches:{ubon,khonkaen:{code,label,addressTh}}, updatedAt}` — ไม่มี key = ใช้ข้อมูลตัวอย่างเดิม; รีเซ็ตข้อมูลสาธิต **ไม่ลบ** |
| `comform_company_logo_v1` | `erp-company-profile.js` (ADR-020) | ✓ | โลโก้ `{schemaVersion, dataUrl (PNG/JPEG base64 ≤ 300,000 ตัวอักษร, ≤ 600 px), mime, width, height, updatedAt}` — ไม่มี/`null` = `logo.png`; **ไม่อยู่ใน** `ERPBackup.capture()` (snapshot ในเครื่อง 8 ชุด) แต่อยู่ใน Backup JSON (`masterData.companyProfile`); รีเซ็ตข้อมูลสาธิตไม่ลบ |
| `comform_vat_returns_v1` | `erp-tax-reports.js` (ADR-023) | ✓ (`masterData.vatReturns`, ตรวจแบบ fail-closed) | `{schemaVersion, returns:[{id, schemaVersion, branchKey (ubon/khonkaen/combined), branches[], period YYYY-MM, filingMode, amendment (0 = ยื่นปกติ / n = ยื่นเพิ่มเติมครั้งที่ n), lines{1..12}, carryForwardIn, carryForwardSource, overpaidAction, channel, dueDate, filedAt, filedBy, seller, counts}]}` บันทึกการยื่นในเดโม (ไม่ได้ส่งกรมสรรพากร) — รีเซ็ตข้อมูลสาธิตลบ |
| `erp_product_experience_role_v1` | – | ✓ (retired, ADR-014) | มุมมองตามบทบาทเดิม ถูกลบตอนเริ่มระบบ |
| `trial::{tenantId}::…` | `trial-mode.js` | ✗ | สถานะ onboarding (**ไม่ใช้ prefix `erp_tenant::`**) |
| `erp_demo_write_lease_v1:{scope}` | `erp-demo-concurrency.js` | ✗ | lease ชั่วคราวข้ามแท็บ (**ไม่แยก tenant**) |

**IndexedDB:** ฐาน `comform-local-files` เวอร์ชัน 1, object store `attachments` (keyPath `id`) เก็บไฟล์แนบเป็น Blob พร้อม tenant id เอกสารเก็บแค่ตัวอ้างอิง `localId` เมื่อ Export แบบ portable (`ERPBackup.portable`) ไฟล์แนบจะถูกฝังลงไฟล์ JSON ด้วย

### 4.4 ประเภทข้อมูลหลักและ field สำคัญ

| ประเภท | อยู่ที่ | field สำคัญ | ตัวเชื่อมไปเอกสารอื่น |
|---|---|---|---|
| ใบเสนอราคา | pack `quotes` | `id, no (QTyymm…), date, branch, customer, customerAddress, customerTaxId, items[], subtotal, useVat, vatMode, vatAmt, total, approved, businessRuleVersion, businessRuleCode` | ลูก: `invoiceId/No`, `productionId/No` |
| ใบสั่งขาย | order-flow `salesOrders` | `id, no (SO…), orderDate, customer…, customerPoNo, requiredDate, paymentTerm (credit/cash), creditDays, subtotal, vatAmt, total, vatMode, useVat, status, items[{id, product, qty, stockQty, productionQty, purchaseQty, readyQty, deliveredQty, fulfillmentMethod}]` | `sourceQuoteId/No/Branch/Year/Month` |
| การจองสต็อก | order-flow `reservations` | `orderId, branch, product, productCode, qty, status:'reserved'` | ใบสั่งขาย |
| ใบสั่งผลิต | pack `productions` | `no, date, branch, maker…(ผู้ผลิต/ผู้จำหน่าย), customer, items[], costMode, costSubtotal, costVatAmt, costGrandTotal, deliveryDueDate, supplierDueDate, supplierPaymentStatus, productionStatus` | `sourceQuote*`, `sourceSalesOrderId/No`; รายการมี `salesOrderLineId` |
| ใบส่งสินค้า / ใบกำกับภาษี | pack `invoices` (+ `issuedInvoices`) | `id, no (INVyymm…), date (ISO ค.ศ.), branch, taxInvoiceForm ('full'/'abbreviated'), customer, customerAddress, customerTaxId, items[], itemSaleTotal, subtotal, vatAmt, total, vatMode, useVat, creditTerm, dueDate, costTotal, commRate, commAmt, profit, paymentStatus, paidAmount, outstandingAmount, paymentManaged, legacyPaid, costReviewRequired` | `sourceProduction*`, `sourceQuote*`, `sourceSalesOrderId/No`; รายการมี `salesOrderLineId`, `costAllocation` |
| ใบวางบิล | order-flow `billingNotes` | `id, no (BL…), customer, branch, billingDate, appointmentDate, dueDate, totalBilled, paidAmount, outstandingAmount, paymentStatus, status, documentStatus, lines[{invoiceId, invoiceNo, branch, originalAmount, outstandingAmount, billedAmount, paidAmount, receiptPaidAtCreation}]` | ใบกำกับภาษีใน `lines` |
| รับชำระ (Payment) | order-flow `payments` | `id, no (PAY…), date, method, branch, customer, billingId, billingNo, allocations[{invoiceId, invoiceNo, branch, year, month, amount}], receiptNos, voided` | ใบวางบิล + ใบกำกับภาษี + ใบเสร็จที่สร้างอัตโนมัติ |
| ใบเสร็จรับเงิน | pack `receipts` (+ `issuedReceipts`) | `id, no (RECyymm…), date, customer…, items[], subtotal, vatMode, vatAmt, total, **whtRate, whtBase, whtAmount, cashReceived, whtCertNo, whtCertReceived**, paymentManaged` | `invNo, invoiceId, invoiceBranch, invoiceYear, invoiceMonth`; ใบที่เกิดจาก Payment มี `paymentId` |
| ใบลดหนี้ | pack `creditNotes` (เดือนของวันที่ใบลดหนี้) | `id, no (CN…), date, branch, documentKind, customer, customerAddress, customerTaxId, customerBranch, reasonCode/reasonLabel, reasonText, vatMode, lines[{invoiceId, invoiceNo, originalValue, correctValue, differenceAmount…}], invoiceNos, subtotal, vatAmt, total, returnItems[], status, voided` (ยอดเป็นบวกเสมอ) | ใบกำกับภาษีใน `lines` |
| ค่าใช้จ่าย | pack `expenses` | `id, date, branch, cat, vendor (ข้อความอิสระ), desc, amount (ยอดรวมตัวเดียว), by, docType, taxStatus, docNo, purpose, note, attachments` | – |
| ใบสั่งซื้อ (PO) | `comform_purchase_orders_v1` | `id, no (PO…), date, branch, supplier, supplierAddress, supplierTaxId, expectedDate, status (draft/partial/received/cancelled), items[{product, productCode, qty, unit, unitCost, total}], subtotal` (ไม่มี VAT) | อ้างอิง SO เป็น **ข้อความใน `note` เท่านั้น** |
| ใบรับสินค้า (GR) | `comform_goods_receipts_v1` | `id, no (GR…), date, branch, poId, poNo, supplier, items[], subtotal, status:'posted', reversed` | `poId` |
| ความเคลื่อนไหวสินค้า | `comform_inventory_movements_v1` | `id, date, branch, kind, qty (+/−), productCode, product, unit, unitCost, refType, refId, refNo, voided` | `refType/refId` |
| ลูกค้า / ผู้จำหน่าย | `comform_contact_master_v1` | `role (customer/supplier/both), name, taxId, branchName, branchCode (ลูกค้า), address, postalCode, contactPerson, phone, email, note, entityType, creditTerm` | – |
| สินค้า | `comform_product_master_v1` | `code, name, category, unit, flowType, fulfillmentType (stock/สั่งผลิต/service), standardCost, defaultPrice (ก่อน VAT), openingStock, openingStockUbon, openingStockKhonkaen, reorderPoint` | – |

**สต็อกไม่ได้เก็บเป็นยอดคงเหลือ แต่คำนวณสดทุกครั้ง** (`productEstimatedStock()` ใน `app.js`):

```
ยอดคงเหลือ = ยอดยกมา (openingStock ต่อสาขา)
          + ผลรวมความเคลื่อนไหว (รับเข้า/ปรับ/โอน จาก comform_inventory_movements_v1)
          − จำนวนที่ขายไปแล้ว (productSoldQty จากใบกำกับภาษี หักด้วยของที่รับคืนผ่านใบลดหนี้)
ยอดพร้อมใช้ = ยอดคงเหลือ − จำนวนที่ถูกจองโดยใบสั่งขายที่ยังส่งไม่ครบ (ERPIntegrity.availableStock)
```

---

## 5. กระบวนการธุรกิจหลัก (flow)

ชื่อเมนูด้านล่างคือชื่อที่ผู้ใช้เห็นหลัง `erp-product-experience.js` เปลี่ยนชื่อแล้ว — ตั้งแต่ ADR-015 "สร้าง…" คือปุ่ม "+ สร้าง…" บนหน้ารายการ และ "รายการ…" คือเมนูของเอกสารนั้น (เช่น "ใบเสนอราคา")

### 5.1 Order-to-Cash (ขายเชื่อ)

| ขั้น | เมนู / หน้าจอ | ฟังก์ชันที่บันทึก | เก็บที่ | ตัวเชื่อม |
|---|---|---|---|---|
| 1. เสนอราคา | "สร้างใบเสนอราคา" | `saveQuote` → `saveQuoteUnlocked` (`app.js`) ใช้ `planQuoteDocumentAction` | pack `quotes` | – |
| 2. อนุมัติใบเสนอราคา | "รายการใบเสนอราคา" (ติ๊กอนุมัติ) | `toggleApprove` (`app.js`) + `ERPGovernance.recordApprovalDecision` | `approved: true` ใน quote + `comform_approval_history_v1` | – |
| 3. ยืนยันคำสั่งซื้อ | "ศูนย์งานขาย & ลูกหนี้" → Create Sales Order | `saveSalesOrderFromQuote` (`erp-order-flow.js`) **บังคับว่าใบเสนอราคาต้องอนุมัติแล้ว** และหนึ่งใบเสนอราคามี SO ที่ใช้งานได้ใบเดียว | order-flow `salesOrders` | `sourceQuoteId/No/Branch/Year/Month` |
| 4. วางแผนจัดสินค้า | หน้าต่าง "วางแผนสินค้า" | `saveFulfillment` เลือกวิธีต่อบรรทัด: Stock ก่อน→ซื้อส่วนขาด, Stock ก่อน→ผลิตส่วนขาด, จัดซื้อทั้งหมด, ผลิตทั้งหมด, ใช้ Stock เท่านั้น แผนต้องครบจำนวน และสต็อกพร้อมใช้ต้องพอ | `stockQty/productionQty/purchaseQty/readyQty` ในรายการ SO + `reservations` | – |
| 4a. สั่งผลิต | ปุ่ม "เปิดฟอร์มสั่งผลิตจาก Quote" → "สั่งผลิต" | `createProduction` เติมฟอร์ม แล้ว `saveProduction` (`app.js`) | pack `productions` | `sourceSalesOrderId`, `salesOrderLineId`, `sourceQuote*` |
| 4b. จัดซื้อ | ปุ่ม "เตรียม PO จากส่วนที่ต้องซื้อ" → "จัดซื้อ / PO" | `createPurchaseOrder` เติมฟอร์ม แล้ว `savePo` (`erp-production-core.js`) | `comform_purchase_orders_v1` | อ้างอิง SO แค่ใน `note` |
| 4c. รับของเข้าคลัง | "รับสินค้าเข้าคลัง" | `postGoodsReceipt` เขียน GR + movements + สถานะ PO + audit ใน `ERPIntegrity.transaction` เดียว | GR + movements | `poId` |
| 5. ยืนยันพร้อมส่ง | ปุ่ม "✓ ยืนยันตรวจรับและพร้อมส่งครบ" | `markReady` ตรวจว่าแผนครบและสต็อกพอ | `readyQty = qty`, `status:'ready'` | – |
| 6. ออกใบส่งสินค้า/ใบกำกับภาษี | ปุ่ม "เตรียมใบส่งสินค้า" → "สร้างใบส่งสินค้า / ใบกำกับภาษี" | `prepareDelivery` เติมฟอร์มด้วยจำนวนค้างส่ง แล้ว `saveInvoice` → `saveInvoiceUnlocked` (`app.js`) ผ่าน `runDocumentAction` (validate → plan → commit → afterCommit) | pack `invoices` ผ่าน write session | `sourceSalesOrderId/No`, `salesOrderLineId` ต่อรายการ, `sourceProduction*`, `sourceQuote*` |
| 6a. พิมพ์/บันทึกฉบับพิมพ์ | ปุ่มเปิดเอกสาร A4 | `saveDocumentToSystem` (`delivery-tax-document.js`) ตรวจว่าตรงกับเอกสารต้นทาง (`assertIssuedDocumentMatchesCanonical`) | pack `issuedInvoices` | id/no เดียวกับใบกำกับ |
| 7. วางบิล | "ศูนย์งานขาย & ลูกหนี้" → วางบิล | `createBillingFromSelected` → `saveBilling` ใช้ `buildBillingAction` (ลูกค้าเดียว สาขาเดียว) | order-flow `billingNotes` ผ่าน `saveStoreFinancial` (transaction) | `lines[].invoiceId/invoiceNo` |
| 8. รับชำระตามใบวางบิล | ปุ่มรับชำระในใบวางบิล | `saveBillingPayment` → `planBillingPaymentAction` กระจายเงินให้บิลตามลำดับ → `ERPIntegrity.createPaymentReceipts` สร้างใบเสร็จ 1 ใบต่อบิล (เลข `REC{ปี พ.ศ. 2 หลัก}{เดือน}{ลำดับ}`) แล้วเขียน pack + order-flow store ใน transaction เดียว | `payments` + pack `receipts` (มี `paymentId`) | `billingId`, `allocations[]` |
| 8'. รับชำระโดยตรง (ไม่ผ่านใบวางบิล) | "รับชำระ / ใบเสร็จ" | `saveReceipt` → `saveReceiptUnlocked` (`app.js`) ใช้ `planReceiptDocumentAction` + `ERPIntegrity.validateReceipt` | pack `receipts` | `invNo, invoiceId, invoiceBranch/Year/Month` |
| 9. ลดหนี้ | "ออกใบลดหนี้" | `erp-credit-note.js` → `validateCreditNote` + `buildCreditNoteRecord` (core) → write session | pack `creditNotes` ของเดือนที่ออกใบลดหนี้ | `lines[].invoiceId/No`; `returnItems[]` |

**ขายเงินสด:** ถ้า SO เป็น `paymentTerm: 'cash'` ปุ่ม "วางบิล" จะไม่แสดง ผู้ใช้ออกใบเสร็จโดยตรง (ขั้น 8') ตาม `ORDER_TO_CASH_GRAPH` ที่มีทาง `invoice → payment` เมื่อเป็น `cashSale` ส่วนขายหน้าร้านใช้ใบกำกับภาษีอย่างย่อกับลูกค้า "ลูกค้าทั่วไป / เงินสด" ได้โดยไม่ต้องมีใบเสนอราคา/SO

**ข้อควรรู้:** ขั้น 3–8 เป็นทางเลือก ผู้ใช้สามารถออกใบกำกับภาษีจากฟอร์มโดยตรง หรือดึงจากใบสั่งผลิต (`useProductionForInvoice`) โดยไม่มี SO ก็ได้ ระบบจะเชื่อมกันด้วย field `source*` ที่มี

### 5.2 Procure-to-Stock (ซื้อเข้าคลัง)

1. "ลูกค้า / ผู้จำหน่าย / สินค้า" — ตั้งผู้จำหน่ายและสินค้า (`fulfillmentType: 'stock'` จึงนับสต็อก สินค้าประเภท `service` ออก PO ไม่ได้)
2. "จัดซื้อ / PO" — `savePo` (`erp-production-core.js`) ตรวจว่าไม่มีรหัสสินค้าซ้ำในใบเดียว ไม่มีบริการ และเลข PO ไม่ซ้ำ บันทึกด้วย `write()` ธรรมดา แล้วเขียน audit
3. "รับสินค้าเข้าคลัง" — `postGoodsReceipt` รับได้ไม่เกินยอดค้างรับ สร้าง movement `kind:'receipt'` ต่อรายการ ปรับสถานะ PO เป็น `partial`/`received` ทุกอย่างอยู่ใน `ERPIntegrity.transaction` เดียว
4. กลับรายการ — `reverseGr` ยอมเฉพาะเมื่อสต็อกพร้อมใช้ยังพอ (ไม่ให้สต็อกติดลบ)
5. "คลังสินค้า" — ปรับยอด (`postAdjustment`) และโอนระหว่างสาขา (`postTransfer`) สร้าง movement เช่นกัน
6. ก่อนออกใบกำกับภาษี `validateInvoiceStock()` ตรวจว่าสินค้าสต็อกมีพอ (หักการจองของ SO อื่น)

**ช่องว่าง:** PO/GR ไม่มี VAT และไม่เก็บเลขใบกำกับภาษีของผู้ขาย จึงยังใช้ทำรายงานภาษีซื้อไม่ได้ (`docs/TAX_FEATURES_SPEC.md` G15) ส่วนต้นทุนผลิต/ค่าจ้างผลิตจ่ายผู้ผลิตติดตามผ่าน field `supplierPaymentStatus` ในใบสั่งผลิต (ใช้ทำอายุเจ้าหนี้ `buildApAging`)

### 5.3 การกระทบยอดรับชำระ (อธิบายแบบภาษาคน)

หัวใจอยู่ที่ `ERPIntegrity.paymentSummary(invoice)` ใน `erp-integrity.js` ทุกหน้าจอที่แสดง "ค้างรับ" (ลูกหนี้, แดชบอร์ด, ใบวางบิล, คิวงาน) ต้องเรียกฟังก์ชันนี้ (ADR-010: "One balance") ขั้นตอน:

1. **หาบิลให้ถูกใบ** — `resolveInvoice()` จับคู่ด้วย id ก่อน แล้วค่อยเลขที่ ต้องอยู่สาขาเดียวกัน และต้องพบใบเดียวเท่านั้น
2. **รวมเงินที่รับแล้ว (`paid`)**
   - จาก Payment: เอาเฉพาะ `allocations` ที่ชี้บิลนี้และ Payment ยังไม่ถูกยกเลิก
   - จากใบเสร็จ: เอาใบที่อ้างถึงบิลนี้และยังใช้งานได้ **ยกเว้นใบที่มี `paymentId`** เพราะใบนั้นเป็นแค่ "หลักฐาน" ของ Payment ที่นับไปแล้ว (กันนับเงินซ้ำ)
   - ใบเสร็จที่มี **หัก ณ ที่จ่าย** นับเต็ม `total` (= เงินที่ได้จริง + ภาษีที่ถูกหัก) เพราะภาษีที่ถูกหักเป็นเครดิตภาษีของผู้ขาย ไม่ใช่ส่วนลด
   - บิลเก่าที่ถูกติ๊ก "จ่ายแล้ว" ก่อนมีระบบใบเสร็จ และไม่มีหลักฐานใดเลย ถือว่าจ่ายครบ (`legacy` / `legacyPaid`)
3. **หักใบลดหนี้ (`credited`)** — รวมยอดรวม VAT ของใบลดหนี้ที่ยังไม่ถูกยกเลิก (`creditedByInvoice` ใน `erp-credit-note-core.js`) → **ยอดที่ต้องจ่ายจริง (`effectiveTotal`) = ยอดบิล − ยอดลดหนี้**
4. **คงค้าง (`outstanding`) = ยอดที่ต้องจ่ายจริง − เงินที่รับแล้ว** (ไม่ติดลบ)
5. **ค่าความคลาดเคลื่อน `RECONCILE_TOLERANCE = 0.01` บาท** — ถ้าต่างกันไม่เกิน 1 สตางค์ ถือว่าจ่ายครบ (เศษจากการปัดคนละที่) ไม่ปล่อยให้บิลค้างเพราะ 0.01 บาท
6. **สถานะ:** `credited` (ลดหนี้เต็มใบ) · `paid` · `partially_paid` · `pending` และมี `overpaid` (จ่ายเกินยอดบิลเดิม) กับ `refundDue` (ต้องคืนเงินลูกค้าเพราะออกใบลดหนี้หลังรับเงินแล้ว)

**การป้องกันรับเงินเกิน:** ทั้ง `planReceiptDocumentAction` และ `ERPIntegrity.validateReceipt` ปฏิเสธใบเสร็จที่ยอดเกิน `outstanding + 0.01` และบังคับว่าชื่อลูกค้าต้องตรงกับบิล

**การเขียนสถานะกลับลงบิล:** หลังทุกการเปลี่ยนแปลง `ERPIntegrity.changed()` จะรัน `reconcilePayments()` (ผ่าน `queueMicrotask`) ซึ่งคำนวณ `paymentSummary` ของทุกบิลใหม่ แล้วเขียน `paid, paymentStatus, paidAmount, outstandingAmount` ลง pack เฉพาะที่เปลี่ยน พร้อม `reconcileBillings()` ที่กระจายเงินเข้าบรรทัดใบวางบิล: เงินที่รับผ่านใบวางบิลนั้นนับให้ใบวางบิลนั้นก่อน ส่วนใบเสร็จที่ไม่ได้ผูกกับใบวางบิลจะถูกใช้กับใบวางบิลเรียงตามวันที่ (FIFO) และบรรทัดใบวางบิลจะไม่เรียกเก็บเกินยอดบิลหลังหักใบลดหนี้

**ยกเลิกรับชำระ:** `ERPOrderFlow.voidPayment` ตั้ง `voided` ให้ Payment และใบเสร็จที่สร้างจากมัน แล้วเขียนใน transaction เดียว (เอกสารไม่ถูกลบ)

---

## 6. กฎบัญชีและภาษีที่ระบบใช้

| กฎ | สิ่งที่ระบบทำ | ไฟล์ / ฟังก์ชัน |
|---|---|---|
| **อัตรา VAT** | 7% คงที่ (`DEFAULT_VAT_RATE = 0.07`, `DEFAULT_VAT_DIVISOR = 1.07`) และ audit `VAT_LITERAL` ห้ามไฟล์อื่นเขียน 0.07 / 1.07 เอง (ADR-002) | `erp-shared-core.js`, `scripts/audit-deep.mjs` |
| **3 โหมด VAT** | `useVat` 0 = `extract` ราคารวม VAT แล้ว (ถอด VAT: ก่อน VAT = ยอด ÷ 1.07), 1 = `add` ราคายังไม่รวม (บวก 7%), 2 = `none` ไม่มี VAT คิด VAT จาก **ยอดรวมทั้งเอกสาร** ไม่ใช่รายบรรทัด | `calculateVatSummary()`, `calculateDocumentTotals()` ใน `erp-shared-core.js` |
| **ปัดเศษตาม ป.86/2542** | ปัดทศนิยม 2 ตำแหน่งแบบ "ครึ่งขึ้น" ดูหลักที่ 3 และแก้ปัญหาเลขทศนิยมฐานสองก่อน (เช่น 2.135 ต้องได้ 2.14) | `roundMoneyValue()` ใน `erp-shared-core.js` (และสำเนา `roundFinanceMoney` ใน `erp-document-finance-core.js` เพราะไฟล์นั้นตั้งใจไม่ import อะไร) |
| **แปลงราคาเมื่อเปลี่ยนโหมด VAT** | รักษายอดรวมเดิม เช่น 1,000 "บวก VAT" → 1,070 "รวม VAT แล้ว"; ราคามาตรฐานในแฟ้มสินค้าเก็บเป็น **ก่อน VAT** | `convertUnitPriceBetweenVatModes()`, `unitPriceForVatMode()` |
| **ใบกำกับภาษีเต็มรูป ม.86/4** | ค่าเริ่มต้น (`taxInvoiceForm: 'full'`) ต้องมีชื่อผู้ซื้อจริง ห้ามใช้ "ลูกค้าทั่วไป / เงินสด" ถ้าไม่มีที่อยู่ผู้ซื้อจะเตือน (ไม่บล็อก) | `planInvoiceDocumentAction()` + `invoiceTaxFormWarnings()` ใน `erp-document-finance-core.js` |
| **ใบกำกับภาษีอย่างย่อ ม.86/6** | ต้องเป็นราคารวม VAT (`extract`) เท่านั้น ไม่บังคับชื่อผู้ซื้อ (ใช้ `GENERAL_CUSTOMER_NAME`) ถ้าใส่เลขผู้เสียภาษีผู้ซื้อจะเตือนให้ใช้เต็มรูป ข้อมูลเก่าที่ระบุอย่างย่อแต่ไม่ใช่ราคารวม VAT จะถูกถือเป็นเต็มรูป | `planInvoiceDocumentAction()`, `effectiveTaxInvoiceForm()` (`erp-shared-core.js`), UI ใน `erp-sales-form-assist.js` |
| **ห้ามแก้บิลที่รับเงินหรือลดหนี้แล้ว** | ถ้ามีการรับเงิน (`paid > 0`) หรือมีใบลดหนี้อ้างอิง จะแก้เลขที่/วันที่/ลูกค้า/รายการ/ยอดไม่ได้ (เทียบด้วย `invoiceFinancialFingerprint`) และบิลที่มีฉบับพิมพ์แล้วแก้ต้นทางไม่ได้ | `planInvoiceDocumentAction()`; `ERPIntegrity.assertEditable()` |
| **ใบลดหนี้ ม.86/10** | ต้องมีเลขที่ไม่ซ้ำ (รวมใบที่ยกเลิก เลข CN ไม่ออกซ้ำ), สาเหตุ 5 แบบ (สินค้าชำรุด, คิดราคาเกิน, รับคืน, ยกเลิก/ลดค่าบริการ, อื่น ๆ ต้องอธิบาย), อ้างอิงบิลของลูกค้าเดียว สาขาเดียว โหมด VAT เดียวกัน, วันที่ไม่ก่อนบิล, ยอดลดสะสมไม่เกินบิล, บิลอย่างย่อที่ไม่มีชื่อผู้ซื้อต้องใส่ชื่อผู้ซื้อและออกแยกใบ, VAT ของผลต่างคิดครั้งเดียวจากยอดรวมแล้วกระจายกลับรายบิลด้วยวิธี largest remainder, ใบลดหนี้อยู่ในงวดภาษีของวันที่ใบลดหนี้ | `validateCreditNote()`, `calculateCreditNote()`, `buildCreditNoteRecord()` ใน `erp-credit-note-core.js` |
| **ภาษีขายสุทธิ** | ภาษีขาย = VAT ใบกำกับ + VAT ใบเพิ่มหนี้ (รับ `debitNotes` ไว้แล้ว ยังไม่มีหน้าออกใบ) − VAT ใบลดหนี้; บิลที่ยกเลิกไม่นับ | `summarizeOutputVat()` ใน `erp-credit-note-core.js` |
| **`vatCategory` ของบิล (ADR-023)** | บิลโหมด `none` เลือกได้ `exempt` (ยกเว้น → ภ.พ.30 บรรทัด 3) หรือ `zero` (อัตรา 0% → บรรทัด 2); บิลเก่าที่ไม่มีค่า = ยกเว้น + เตือนในรายงาน | `normalizeInvoiceVatCategory()` (`erp-tax-reports-core.js`), `planInvoiceDocumentAction()` |
| **ภาษีซื้อในค่าใช้จ่าย (ADR-023)** | ยอด `amount` ยังเป็นยอดรวม; เก็บแยก ก่อน VAT/VAT, เลขผู้เสียภาษี + สาขาผู้ขาย, เลข/วันที่ใบกำกับ, เดือนที่ใช้สิทธิ; เตือน ม.82/3 เกิน 6 เดือน, เลือกเหตุต้องห้าม ม.82/5 (ไม่นับเป็นภาษีซื้อ), ห้ามซ้ำ เลขผู้เสียภาษีผู้ขาย + เลขใบกำกับ, เดือนที่ใช้สิทธิต้องยังไม่ปิดงวด; ข้อมูลเก่าที่ไม่มีแยก VAT แสดงป้าย "ข้อมูล VAT ไม่ครบ" และไม่เข้ารายงาน | `planExpenseVatFields()` (`erp-tax-reports-core.js`), `planExpenseDocumentAction()`, `erp-tax-forms.js` |
| **รายงานภาษีขาย / ภาษีซื้อ (ADR-023)** | เรียงคอลัมน์ตามแบบกรมสรรพากร, ใบลดหนี้ติดลบในเดือนของใบลดหนี้, บิลยกเลิกแสดง 0 พร้อมเหตุ, ใบกำกับอย่างย่อรวมเป็นยอดรายวัน, ภาษีซื้อตาม "เดือนที่ใช้สิทธิ" แยกตามสาขาหรือรวม | `buildSalesTaxReport()` / `buildPurchaseTaxReport()` |
| **ภ.พ.30 (ADR-023)** | บรรทัด 1–12 (บรรทัด 5/7 = ยอดรวมของรายงาน, 9 = ยอดยกมาจากการยื่นเดือนก่อน); 13–16 "ไม่คำนวณในเดโม"; แยกยื่น/ยื่นรวมตาม `companyProfile.vatFilingMode`; ครบกำหนด 15 (กระดาษ) / 23 (e-filing ถึง 31 ม.ค. 2570) เลื่อนเสาร์–อาทิตย์ ไม่รวมวันหยุดราชการ; ยื่นซ้ำงวดเดิม = "ยื่นเพิ่มเติมครั้งที่ n" | `buildPp30Summary()`, `pp30DueDates()`, `resolveCarryForward()` |
| **หัก ณ ที่จ่าย (ลูกค้าหักเรา)** | ตัวเลือกอัตรา 0/1/2/3/5/10% ฐานคือ **ยอดก่อน VAT**; เงินที่ได้จริง = ยอดรวม − ภาษีที่ถูกหัก; เก็บเลขหนังสือรับรอง 50 ทวิ และสถานะได้รับแล้ว; ใบเสร็จ WHT นับเป็นชำระเต็มจำนวน | `WHT_RATE_PRESETS`, `calculateWhtSummary()` (`erp-shared-core.js`), `receiptWhtSummary()` + `saveReceiptUnlocked()` (`app.js`), `receipt-document.js` |
| **WHT ในการรับชำระผ่านใบวางบิล** | **ไม่รองรับ** — `planBillingPaymentAction` และหน้ารับชำระของ `erp-order-flow.js` ไม่มีช่อง WHT ต้องออกใบเสร็จจากเมนู "รับชำระ / ใบเสร็จ" แทน | `erp-order-flow.js`, `erp-document-finance-core.js` |
| **วันครบกำหนด** | ลำดับความสำคัญ: `dueDate` ที่ระบุในบิล → คำนวณจาก `creditTerm` (`cash`, `deposit50` = 0 วัน; `credit30/60/90/120/150/180`) → ถ้าไม่มีเลย ครบกำหนดวันออกบิล (ขายหน้าร้าน/ไม่ระบุเครดิต) → ถ้าวันที่บิลใช้ไม่ได้ = "ไม่ระบุวันครบกำหนด" วันที่ผิดจริง (เช่น 30 ก.พ.) ไม่ถูกเลื่อนเอง | `invoiceDueDateInfo()` / `invoiceDueDate()` ใน `erp-receivables-core.js` |
| **อายุลูกหนี้** | ช่วง: ยังไม่ถึงกำหนด / 1–30 / 31–60 / 61–90 / เกิน 90 วัน / ไม่ระบุวันครบกำหนด; "ใกล้ครบกำหนด" = ภายใน 7 วัน (`AR_DUE_SOON_DAYS`); คำนวณเป็นสตางค์เพื่อให้ยอดรวมตรงกันทุกรายงาน | `agingBucket()` (`erp-governance-core.js`), `buildReceivableLedger()`, `summarizeReceivableAging()` (`erp-receivables-core.js`) |
| **วันที่ธุรกิจ** | เก็บเป็น ISO ค.ศ. แสดงเป็น พ.ศ.; ปีที่ ≥ 2400 ถือเป็น พ.ศ.; ห้ามใช้ `new Date().toISOString().slice(0,10)` (เพี้ยนตาม UTC) — audit `UTC_BUSINESS_DATE` ตรวจ | `erp-date-core.js`, `localDateISO()` / `parseBusinessDate()` (`erp-shared-core.js`), ADR-001 |
| **เลขที่เอกสาร** | `{prefix}{ปี พ.ศ. 2 หลัก}{เดือน 2 หลัก}{ลำดับ}`: QT, INV, REC, CN (`AUTO_DOCUMENT_NUMBER_SPECS`, app.js) · SO, BL, PAY (`nextNumber`, erp-order-flow.js) · PO, GR (`docNo`, erp-production-core.js) · REC จาก Payment (`createPaymentReceipts`, erp-integrity.js) ผู้ใช้แก้เลขเองได้ ระบบตรวจซ้ำก่อนบันทึก (`documentNumberExistsForWrite`) | หลายไฟล์ (ดูหัวข้อ 9) |

---

## 7. ความปลอดภัยของข้อมูลและการควบคุม

### 7.1 การเขียนแบบ transaction และ rollback

- **`ERPIntegrity.transaction(writes)`** — รับรายการ `[key, value]` จำ "ค่าเดิม" ของทุก key ก่อน แล้วเขียนทีละ key ถ้าเขียน key ใดล้มเหลว (เช่น พื้นที่เต็ม) จะคืนค่าเดิมให้ทุก key ที่เขียนไปแล้วย้อนกลับ ถ้าการย้อนกลับเองก็ล้ม จะแจ้ง "บันทึกและย้อนกลับข้อมูลไม่ครบ กรุณากู้ Backup ก่อนทำรายการต่อ" — **นี่ไม่ใช่ transaction ระดับฐานข้อมูล** แค่ทำให้โอกาสข้อมูลค้างครึ่ง ๆ ลดลงมากใน Browser เดียว
- **Write session** (`createFinancialDocumentWriteSession` ใน `app.js`, เผยแพร่เป็น `window.ComformDocumentWriteStore`) — อ่าน pack รายเดือนแบบเข้ม แก้ในหน่วยความจำ แล้ว `commit()` ผ่าน `transaction()` ครั้งเดียว มี `rollback()` คืนค่าเดิมได้ ใช้ในการออกใบกำกับ/ใบเสร็จ (ซึ่งต้องแก้ใบเสนอราคา/ใบสั่งผลิตต้นทางพร้อมกัน) ใบลดหนี้ และฉบับพิมพ์
- **`runDocumentAction`** (`erp-document-finance-core.js`) — แบ่งการบันทึกเป็น 4 ขั้น `validate → plan → commit → afterCommit` ถ้า error เกิด **หลัง** commit จะบอกผู้ใช้ว่า "ข้อมูลหลักถูกบันทึกแล้ว แต่ขั้นตอนหลังบันทึกไม่สมบูรณ์" เพื่อกันการกดซ้ำ; error มีรหัสชัดเจน (`validation_error`, `conflict_error`, `dependency_error`, `permission_error`, `storage_error`, `sync_error`)
- **ข้อยกเว้นที่ยังไม่ใช้ transaction:** `saveFor()` (ใช้ใน `delDoc`, `toggleApprove` และเส้นทางแก้ไขนอกโหมดเดโม), `saveStore()` ของ `erp-order-flow.js` (สร้าง SO, วางแผน, markReady), `savePo`/`write()` ของ `erp-production-core.js` — สิ่งเหล่านี้เขียน key เดียวต่อครั้ง ความเสี่ยงต่ำกว่า แต่บางจุดเขียนสองที่ต่อเนื่องกัน (เช่น `toggleApprove` เขียน pack แล้วเขียนประวัติอนุมัติแยก)

### 7.2 สำรองข้อมูลแบบ fail-closed

- **อ่านแบบเข้มตอนสำรอง:** `loadForBackupRead()` (pack เอกสาร), `readStrict()` (`erp-production-core.js`) และ `loadStoreForFinancialWrite()` (order-flow) จะ **หยุดการสำรอง** ถ้าพบข้อมูลเสีย พร้อมบอกชื่อ key แทนที่จะสร้างไฟล์ backup ที่ดู "สำเร็จ" แต่ข้อมูลหาย (มีเทสต์ `backup-fail-closed.test.cjs`)
- **ไฟล์ Export (schema v4):** ฝังไฟล์แนบจาก IndexedDB และ `contentSha256` (SHA-256 ของเนื้อหาแบบเรียง key) ตอนนำเข้า `ERPBackup.verifyPortable()` ตรวจ checksum; schema v4 ที่ไม่มี checksum ถูกปฏิเสธ; ไฟล์เวอร์ชันใหม่กว่าระบบถูกปฏิเสธ
- **ตรวจโครงสร้างก่อนเขียน:** `ERPBackup.validate()` ตรวจว่ารายการที่ควรเป็น array เป็น array, ตัวเลขเป็นตัวเลข, id ไม่มีอักขระแปลก, ไม่มี `__proto__`/`constructor` (กัน prototype pollution), ซ้อนลึกไม่เกิน 35 ชั้น
- **กู้แบบย้อนได้:** `ERPBackup.restore()` จับภาพข้อมูลปัจจุบันก่อน ถ้าเขียนไม่สำเร็จจะคืนภาพเดิม
- **backup อัตโนมัติก่อนนำเข้า JSON:** `importJSON` ต้องสร้าง backup ในเครื่องได้ก่อน (`createLocalBackupSnapshot(..., 'before-json-import')`) มิฉะนั้นไม่นำเข้า

### 7.3 ปิดงวด (Period Lock)

- `ERPGovernance.lockPeriod({branch, scope, throughDate, reason})` บันทึกเป็นเหตุการณ์ (ล็อก/ปลดล็อก ต้องใส่เหตุผลเมื่อปลด) พร้อม audit ใน transaction เดียว scope มี `sales`, `purchase`, `all`
- **ตรวจก่อนบันทึก** (`assertPeriodOpen`) ใน: สร้าง/แก้ใบกำกับภาษี, ใบเสร็จ, ค่าใช้จ่าย (`purchase`), สถานะจ่ายเงินผู้ผลิต, สร้าง/แก้/ยกเลิกใบลดหนี้, รับชำระตามใบวางบิล, ใบเสร็จจาก Payment และการโหลดข้อมูลตัวอย่าง
- **ตรวจก่อนลบ/ยกเลิก (ก่อนถามยืนยัน, ADR-018)** ด้วย `ERPGovernance.periodLockRefusal({type, branch, date})` (ข้อความเดียวกับการบันทึกที่ถูกปฏิเสธ): ลบใบกำกับ/ใบเสร็จ (`sales`) และค่าใช้จ่าย (`purchase`) ใน `delDoc`, ยกเลิกรับชำระ (`voidPayment` รวมใบเสร็จที่สร้างจาก Payment นั้น), ยกเลิกใบลดหนี้ (ก่อนถามเหตุผล)
- **ยังไม่ตรวจ** ใน: ใบเสนอราคา, ใบสั่งผลิต (ไม่ได้ลงงวด — การบันทึกก็ไม่ตรวจ), PO, รับสินค้า/กลับรายการรับสินค้า/ปรับ/โอนสต็อก

### 7.4 ศูนย์อนุมัติ

- นโยบาย `DEMO_APPROVAL_POLICY` (`erp-governance-core.js`): ใบเสนอราคา ≥ 100,000 บาท หรือส่วนลด ≥ 10%, PO ≥ 100,000, ค่าใช้จ่าย ≥ 20,000, ต้นทุนสั่งผลิต ≥ 100,000
- `evaluateApprovalPolicy()` แค่ **บอกว่าต้องอนุมัติ** และ "ศูนย์อนุมัติ" (`erp-product-experience.js`) แสดงรายการ/ให้กดอนุมัติ PO ได้ **แต่ไม่มีจุดใดบล็อกการบันทึก** เอกสารที่เกินวงเงิน กฎบังคับจริงมีข้อเดียวคือ **สร้างใบสั่งขายได้เฉพาะจากใบเสนอราคาที่อนุมัติแล้ว** (`saveSalesOrderFromQuote`)
- การตัดสินใจถูกเก็บใน `comform_approval_history_v1` พร้อม audit

### 7.5 Audit Log

มี **2 ชุดแยกกัน**:
1. `comform_audit_log_v1` — จาก `ERPProductionCore.audit()` (สร้าง/แก้/ลบเอกสาร, PO, GR ฯลฯ) แสดงในหน้า "ศูนย์ควบคุม" เก็บล่าสุด 2,500 แถว
2. `comform_governance_audit_v1` — จาก `ERPGovernance.appendAudit()` / `commitWithAudit()` (ปิดงวด, อนุมัติ, ซิงก์) เก็บล่าสุด 5,000 แถว — `audit()` ข้อ 1 ส่งต่อมาที่นี่ด้วย

audit เก็บใน `localStorage` เดียวกับข้อมูล ผู้ใช้ที่เปิด DevTools แก้หรือลบได้ จึงเป็น "บันทึกเพื่อความโปร่งใสในเดโม" ไม่ใช่หลักฐานที่แก้ไม่ได้

### 7.6 กันบันทึกซ้ำ

- **ข้ามแท็บ:** `withDemoWriteLease(scope, task)` จอง key `erp_demo_write_lease_v1:{scope}` (หมดอายุ 8 วินาที รอได้ 5 วินาที) ใบกำกับ ใบเสร็จ และใบลดหนี้ใช้ scope เดียวกัน `sales-ledger` เพราะแตะยอดลูกหนี้ตัวเดียวกัน
- **ในแท็บเดียว:** `local-demo-health.js` ห่อ `saveQuote`, `saveInvoice`, `saveReceipt`, `saveProduction`, `saveExpense`, `pcSavePo`, `pcPostGoodsReceipt`, `pcPostAdjustment`, `pcPostTransfer` ให้ทำทีละครั้ง และปฏิเสธการเรียกซ้ำภายใน 250 ms หลังเสร็จ
- **เลขซ้ำ:** ตรวจเลขเอกสารซ้ำก่อนบันทึกทุกประเภท; ใบเสร็จจาก Payment ตรวจ idempotency (`assertIdempotentPaymentReceipts`) — ถ้ามีใบเสร็จของ Payment นั้นแล้วจะไม่สร้างซ้ำ
- **ลบ / ยกเลิก (ADR-021):** ใบกำกับภาษีและใบเสร็จที่ออกแล้ว **ลบไม่ได้** — ใช้ ⋯ › "ยกเลิกใบกำกับภาษี / ยกเลิกใบเสร็จ" (`erp-document-cancel.js`): ต้องมีเหตุผล, ปฏิเสธเมื่อปิดงวดหรือยังมีใบเสร็จ/รับชำระ/ใบลดหนี้/ใบวางบิลอ้างอิง, เก็บเอกสารไว้ด้วย `status:'cancelled'` + `voided:true` + ผู้ยกเลิก/เวลา/เหตุผล (Audit Log) เลขที่ยังอยู่ในลำดับ, พิมพ์มีตรา "ยกเลิก / CANCELLED", `paymentSummary()` คืน `status:'cancelled'` ค้าง 0 ทุกรายงานจึงตัดออก, สต็อกคืนเอง (ขายคิดจากบิลที่ live). `delDoc` ยังลบใบเสนอราคา/ค่าใช้จ่าย/ใบสั่งผลิต (ย้ายไป Recycle Bin)

### 7.7 สิ่งที่เป็นแค่ระดับหน้าจอ (ไม่ใช่ความปลอดภัยจริง)

- **Tenant** แยกด้วย prefix ของ key เท่านั้น ไม่มีการเข้ารหัส ใครเข้าถึง Browser ได้ก็อ่านได้ทุก tenant
- **ผู้ใช้/บทบาท** เป็นโปรไฟล์จำลองคนเดียว (`owner`, `allowedBranches: ['*']`) ฟังก์ชันล็อกสาขาสำหรับพนักงาน (`lockBranchForStaff`, `enforceOperationalBranchUi`) มีอยู่แต่ไม่มีผลในเดโม
- **โควตาทดลอง, ปิดงวด, ศูนย์อนุมัติ, audit** ทั้งหมดบังคับด้วย JavaScript ฝั่ง Browser ผู้ใช้ที่รู้เทคนิคข้ามได้
- **การกรองข้อมูลที่แสดง:** มี `escapeHtml`/`esc` ในเกือบทุกไฟล์ และ `safeAttachmentUrl()` กรอง URL ไฟล์แนบ; audit `DYNAMIC_CODE_EXECUTION` ห้าม `eval`/`new Function`; `business-rules.js` ไม่รันสูตร JS ที่ผู้ใช้พิมพ์ — แต่ UI สร้าง HTML ด้วย `innerHTML` (171 จุดใน `app.js` เพียงไฟล์เดียว) การป้องกัน XSS จึงขึ้นกับว่าทุกจุด escape ถูก

---

## 8. การทดสอบและเครื่องมือตรวจคุณภาพ

### 8.1 ชุดเทสต์ (Node test runner + jsdom)

| คำสั่ง | รันอะไร | ผลที่วัดได้ (30 ก.ย. 2569) |
|---|---|---|
| `npm run test:fast` | 21 ไฟล์ที่ไม่ boot แอป (core, คำนวณ, ตรวจ, แบ่งหน้า, audit) | **246 เทสต์ ~3 วินาที** ผ่านทั้งหมด |
| `npm test` | ทุกไฟล์ 34 ไฟล์ (21 fast + 13 app-boot ใน jsdom) | **438 เทสต์ ~2–2.5 นาที** ผ่านทั้งหมด |
| `npm run verify` | audit ที่ต้องผ่าน + `npm test` + `build` + `build:flat` + `test:deployment` + `test:deployment:flat` | ~3–5 นาที (CI รันคำสั่งนี้) |
| `npm run test:list` | แสดงว่าไฟล์ไหนอยู่ชุดไหน | – |

การแบ่ง fast/full ทำอัตโนมัติใน `scripts/run-tests.mjs`: ไฟล์ที่ `require('./dom-helper.cjs')` หรือมีคอมเมนต์ `// test-suite: full` อยู่ชุด full เท่านั้น ห้ามตั้ง `TEST_CONCURRENCY` เกินจำนวน CPU (เทสต์ app-boot บางตัวแข่งกับ timer ของแอป — รายละเอียดใน `docs/TESTING_TH.md`)

เทสต์ที่มีมากที่สุด: `document-finance-core` (52), `credit-note` (41), `integrity` (32), `receivables-reporting` (29), `master-data-core` (24), `abbreviated-invoice` (21)

### 8.2 CI

`.github/workflows/ci.yml` รันทุก push และ pull request บน Ubuntu + Node 22: `npm ci` → `npm run test:fast` → `npm run verify` (timeout 30 นาที, สิทธิ์ `contents: read`)

### 8.3 Audit แต่ละตัวตรวจอะไร

| คำสั่ง | สคริปต์ | ตรวจอะไร | อยู่ใน `verify`? |
|---|---|---|:-:|
| `audit:code` | `audit-codebase.mjs` | ชื่อไฟล์ซ้ำ, HTML id ซ้ำ, script/stylesheet โหลดซ้ำ, ไฟล์ที่อ้างถึงแต่ไม่มี, `onclick` ที่เรียกฟังก์ชันที่ไม่มีบน `window`, การทับ `window.go`, global รุ่นเก่า, error listener ต้องมีที่ `boot-status.js` ที่เดียว, syntax ของทุกไฟล์ JS | ✓ |
| `audit:deep` | `audit-deep.mjs` | `eval`/`new Function`, วันที่ธุรกิจที่เพี้ยนตาม UTC, ตัวเลข VAT ที่เขียนนอก `erp-shared-core.js`, catch ว่าง, `if(false && …)`, key ถาวรที่เขียนซ้ำนอก contracts, ฟังก์ชันซ้ำในไฟล์เดียว, หน้าเอกสารฉบับพิมพ์ต้องบันทึกผ่าน `runDocumentAction` + write session และห้ามแก้ยอดชำระ | ✓ |
| `audit:specs` | `audit-specs.mjs` | มี constitution ≥ 10 ข้อ, requirement ทุกข้อใน `specs/` มี traceability (ปัจจุบัน 32/32) | ✓ |
| `audit:documents` | `audit-document-controllers.mjs` | helper ที่แยกออกไปแล้วต้องไม่ถูกคัดลอกกลับเข้า controller เอกสาร เทียบกับ `DOCUMENT_CONTROLLER_DUPLICATION_BUDGET.json` | ✓ |
| `audit:financial` | `audit-financial-controls.mjs` | 24 ข้อ (FIN-001…024) เช่น ใบกำกับ/ใบเสร็จต้องตรวจเลขซ้ำแบบเข้ม, ต้องตรวจปิดงวด, รับชำระต้องใช้ transaction, backup ต้องตรวจ checksum — **ตรวจด้วย regex บน source code** ไม่ได้รันพฤติกรรมจริง | ✓ |
| `audit:render-golden` | `audit-document-render-golden.mjs` | hash SHA-256 ของ CSS และฟังก์ชัน render ของเอกสาร ต้องตรงกับ `DOCUMENT_RENDER_GOLDEN_BASELINE.json` (กันเอกสารพิมพ์เปลี่ยนโดยไม่ตั้งใจ) | ✓ |
| `security:preflight` | `security/agent-repo-audit.mjs` | หาไฟล์ควบคุม AI agent (`.claude/`, `CLAUDE.md`, `.cursor`, `mcp.json` ฯลฯ) และรูปแบบอันตรายใน repo | ✓ |
| `audit:complexity` | `audit-complexity.mjs` | เทียบกับ `QUALITY_BUDGET.json`: ไฟล์ runtime ≤ 42, บรรทัด runtime ≤ 23,500 (ADR-015), `app.js` ≤ 8,350 และ **ห้ามโตเกิน baseline 8,261** (delta 0), dev dependency ≤ 3, window assignment ≤ 75, inline handler ≤ 110 — **ปัจจุบัน FAIL** เพราะ `app.js` เกิน baseline 19 บรรทัด (ADR-012) | ✗ |
| `security:verify-baseline` | `security/verify-security-baseline.mjs` | hash ของไฟล์ที่ป้องกัน (`index.html`, `vite.config.js`, `package.json`, `.github/`) — ต้องให้คนตรวจแล้วรัน `security:baseline` เอง | ✗ |

### 8.4 งบความซับซ้อนและกระบวนการ ADR

`QUALITY_BUDGET.json` เป็น "เพดาน" ที่ตั้งใจให้การเพิ่มไฟล์/บรรทัด **ต้องมีเหตุผลเป็นลายลักษณ์อักษร** ADR ที่ผ่านมาเพิ่มเพดานทีละครั้งพร้อมเหตุผล เช่น ADR-006 เพิ่มไฟล์ runtime จาก 30 เป็น 31, ADR-012 เพิ่มบรรทัด runtime เป็น 21,800 ปัจจุบันเพดานอยู่ที่ 23,000 บรรทัด / 41 ไฟล์ และจำนวนไฟล์ runtime **ชนเพดานพอดี (41/41)** — การแยกโมดูลใหม่ออกจาก `app.js` จึงต้องมี ADR ปรับเพดานก่อน

ADR ที่มี: 001 วันที่ธุรกิจ · 002 VAT แหล่งเดียว · 003 key เป็นสัญญา · 004 workflow ชัดเจนและ fail-closed · 005 AI เป็นแค่ผู้แนะนำ · 006 finance action core · 007 governance · 008 ใบลดหนี้ · 009 sales form assist · 010 ลูกหนี้ · 011 layout อ่านง่ายของโมดูลลูกหนี้ · 012 งบบรรทัดรอบแก้บั๊ก · 013 ข้อมูลตัวอย่างและ PDF ออฟไลน์ · 014 มุมมอง Admin เดียว · 015 ส่วนหัวกระชับ เมนู Demo และเมนูซ้ายแบบหมวด (เพดานเป็น 42 ไฟล์ / 23,500 บรรทัด)

---

## 9. จุดแข็ง / จุดอ่อนเชิงโครงสร้าง / หนี้ทางเทคนิค

### 9.1 จุดแข็ง

- **กฎเงินและภาษีส่วนใหญ่อยู่ในโค้ด pure ที่ทดสอบได้** — core 12 ไฟล์ (`erp-shared-core`, `erp-document-finance-core`, `erp-credit-note-core`, `erp-receivables-core`, `erp-governance-core` ฯลฯ) ไม่แตะ DOM/storage มีเทสต์ 242 ตัวที่รันใน ~3 วินาที
- **ยอดคงค้างมีแหล่งเดียว** (`paymentSummary`) ที่เข้าใจใบลดหนี้, WHT, การกระจายเงินจากใบวางบิล และเศษสตางค์ — รายงานต่าง ๆ จึงให้ตัวเลขเดียวกัน
- **ออกแบบ fail-closed จริงจัง** — อ่านข้อมูลเสียแล้วหยุด ไม่เขียนทับหรือสำรองข้อมูลขาด, backup มี checksum, บันทึกเอกสารการเงินผ่าน transaction/rollback, error บอกได้ว่าบันทึกไปแล้วหรือยัง
- **ความถูกต้องทางภาษีไทยละเอียด** — ปัดเศษ ป.86/2542 แก้ปัญหาทศนิยมฐานสอง, แยกใบกำกับเต็มรูป/อย่างย่อ, ใบลดหนี้ครบ ม.86/10, WHT ฐานก่อน VAT
- **มีรั้วกันการถอยหลัง** — audit 7 ตัว, golden hash ของเอกสารพิมพ์, งบความซับซ้อน, ADR, CI
- **ทำงานออฟไลน์ได้ทั้งหมด** รวม PDF (vendor อยู่ในเครื่อง)

### 9.2 จุดอ่อนเชิงโครงสร้าง (วัดจากโค้ด)

| ประเด็น | ตัวเลข / หลักฐาน | ผลกระทบ |
|---|---|---|
| **`app.js` เป็นก้อนเดียวขนาดใหญ่** | 8,279 บรรทัด, 609,859 ตัวอักษร (705 KB), 677 ฟังก์ชันระดับบนสุด, คิดเป็น 37% ของบรรทัด runtime และ 40% ของตัวอักษร runtime ทั้งหมด (1,508,038 ตัวอักษร) | แก้จุดหนึ่งกระทบจุดอื่นง่าย, review ยาก, เพดาน `app.js` ถูกล็อกไว้ที่ baseline |
| **บรรทัดยาวมาก** | ใน `app.js` มี 210 บรรทัดที่ยาวเกิน 300 ตัวอักษร (รวม 112,441 ตัวอักษร ≈ 18% ของไฟล์) และ 15 บรรทัดเกิน 1,000 ตัวอักษร (ยาวสุด 2,243); ทั้งระบบมี 427 บรรทัด > 300 และ 27 บรรทัด > 1,000 (ยาวสุด 2,584 ใน `erp-governance.js`) | อ่าน diff/review ยาก, จำนวนบรรทัดใน budget จึงไม่สะท้อนความซับซ้อนจริง |
| **inline event handler** | `index.html` มี attribute `on…=` 260 จุด (`onclick` 127) และ HTML ที่ JS สร้างมีอีก 88 จุด; `app.js` ต้องเปิดฟังก์ชัน 106 ตัวบน `window` ให้ HTML เรียก | ผูก HTML กับชื่อฟังก์ชัน global แน่น, ต้องมี `click-fallback.js` ช่วย |
| **ตัวแปร global บน `window`** | ประมาณ 220 ชื่อ (106 ใน `exposeInlineHandlers`, 56 ใน `Object.assign(window, …)`, API object ~25 ตัว และอื่น ๆ); `ERPIntegrity` ถูกอ้างใน 14 ไฟล์, `ComformTenant` 16 ไฟล์ | ลำดับโหลดสำคัญ, เทสต์ต้อง boot ทั้งแอป, ไม่มี type/ขอบเขตชัด |
| **ห่อฟังก์ชันซ้อนชั้นด้วย timer** | `window.saveInvoice` ถูกห่อ 4 ชั้นจาก 3 ไฟล์ (หัวข้อ 3.3) ลำดับขึ้นกับ `setTimeout` | พฤติกรรมต่างกันระหว่างเทสต์กับของจริง (มีเทสต์ 7 ตัวที่อาศัยจังหวะนี้) |
| **bundle เดียว ~1.15 MB** | `dist/assets/main-*.js` = 1,153,660 ไบต์ ไม่มี code splitting; CSS รวม `main-*.css` 311,119 ไบต์; vendor PDF อีก ~563 KB | โหลดครั้งแรกช้าบนมือถือ/เน็ตช้า |
| **ข้อจำกัด `localStorage`** | ราว 5 MB ต่อ origin; backup ในเครื่องเก็บ **สำเนาเต็มของข้อมูล tenant** ในที่เดียวกันสูงสุด 8 ชุด; เขียนแบบ synchronous | ข้อมูลโตไม่กี่พันเอกสารจะเริ่มชนเพดาน โดยเฉพาะเมื่อมี backup สะสม |
| **อ่านทุกอย่างซ้ำทุกครั้ง** | `ERPIntegrity.business()` / `packs()` วนทุก key ใน `localStorage` แล้ว `JSON.parse` ทุก pack; `reconcilePayments()` รันหลังทุกการบันทึก | ช้าลงตามปริมาณข้อมูล (มี `paymentIndex` ช่วยลดการเทียบ แต่ยังอ่านทั้งหมด) |
| **สต็อกคำนวณสด** | `productEstimatedStock` สแกนทุกปี ทุกเดือน ทุกสาขา ต่อสินค้า | ช้าเมื่อข้อมูลหลายปี; ไม่มีต้นทุนสินค้าคงเหลือ (FIFO/ถัวเฉลี่ย) |
| **สาขาตายตัว** | `'ubon'`/`'khonkaen'` ปรากฏใน 17 ไฟล์ และ regex `/^biz2_(ubon\|khonkaen)_…/` ใน `erp-integrity.js` | เพิ่มสาขาที่ 3 ต้องแก้หลายไฟล์ |
| **เอกสารขายมีสองสำเนา** | `invoices` กับ `issuedInvoices` (และ `receipts` กับ `issuedReceipts`) ต้อง `dedupe` ทุกครั้งที่รวมยอด | ความเสี่ยงนับซ้ำในรายงานใหม่ (`docs/TAX_FEATURES_SPEC.md` G14) |
| **ความสัมพันธ์บางอย่างเป็นแค่ข้อความ** | PO อ้าง SO ผ่าน `note` เท่านั้น; `orderInvoices()` ยังมี fallback หาเลข SO จากข้อความ `note` ของบิล | trace เอกสารไม่แม่น 100% |
| **ชื่อหลอก** | `erp-production-core.js` ชื่อ "core" แต่เป็น UI + storage + wrapper; `erp-workflow-graph-core.js` / `ORDER_TO_CASH_GRAPH` ไม่ถูกใช้ใน runtime (ใช้แค่ในเทสต์) | นักพัฒนาใหม่เข้าใจผิดง่าย |
| **โค้ด Cloud ที่ไม่ได้ใช้** | `app.js` อ้าง `FirebaseService` 24 จุด มี `syncFromFirebaseYear`, `saveCloudRecord`, interval ซิงก์ทุก 60 วินาที ทั้งที่เดโมปิด Cloud | เพิ่มขนาดและความซับซ้อนโดยไม่มีผล |
| **ช่องโหว่ของการควบคุม** | (ปิดแล้วใน ADR-018: ลบ/ยกเลิกในงวดที่ปิดถูกปฏิเสธ), นโยบายอนุมัติไม่บล็อกการบันทึก, audit แก้ได้, `audit:financial` ตรวจแค่ว่ามีข้อความโค้ด (regex) | ผู้ใช้/ผู้ตรวจอาจเข้าใจว่าควบคุมได้มากกว่าที่เป็นจริง |
| **รับชำระผ่านใบวางบิลไม่รองรับ WHT** | ไม่มีช่อง WHT ใน `saveBillingPayment` | ลูกค้านิติบุคคลที่หัก 3% ต้องออกใบเสร็จแยกจากเมนูรับชำระ |

### 9.3 สิ่งที่ทำซ้ำหลายที่ (หนี้ทางเทคนิค)

| เรื่อง | ที่อยู่ |
|---|---|
| สร้าง key `biz2_…` | `app.js` (`keyFor`), `erp-integrity.js` (2 จุด), `delivery-tax-document.js`, `receipt-document.js` (3), `quotation-document.js`, `erp-credit-note.js`, `erp-demo-seed.js` (2), `erp-order-flow.js`, `erp-production-core.js` |
| `RECONCILE_TOLERANCE = 0.01` | `erp-shared-core.js` (export), `erp-integrity.js` (ประกาศเอง), `erp-document-finance-core.js` (`FINANCE_RECONCILE_TOLERANCE`) |
| ปัดเศษเงิน | `roundMoneyValue` (`erp-shared-core.js`) และ `roundFinanceMoney` (`erp-document-finance-core.js`) |
| ออกเลขเอกสาร | `app.js`, `erp-order-flow.js`, `erp-production-core.js`, `erp-integrity.js`, `erp-demo-seed-core.js` |
| escape HTML (`esc`/`escapeHtml`) | 11 ไฟล์ |
| จัดรูปแบบเงิน (`money`) | 9 ไฟล์ |
| ชื่อสาขา (`BRANCH_LABEL`/`BRANCH_DEFAULTS`) | 8 ไฟล์ และข้อความไม่ตรงกัน ("สาขาสำนักงานใหญ่" ใน `erp-order-flow.js` แต่ "สำนักงานใหญ่" ใน `erp-product-experience.js`) |
| key ถาวรนอก `erp-storage-contracts.js` | PO/GR/movements/audit/recycle bin (`erp-production-core.js`), backup (`app.js`), draft ของเอกสาร, trial |
| Audit Log | 2 ชุด (หัวข้อ 7.5) |
| "live" (ยังไม่ถูกยกเลิก) | นิยามแยกใน `erp-integrity.js`, `erp-governance-core.js`, `erp-product-experience-core.js`, `erp-receivables-core.js` และแต่ละที่ดู field ต่างกันเล็กน้อย (`voided`, `cancelled`, `reversed`, `deleted`, `status`) |

### 9.4 root ที่รก

root มี 50 `.json` + 58 `.md` ส่วนใหญ่เป็นบันทึกประวัติการ refactor (81 ไฟล์มี `_STEP` ในชื่อ) ปะปนกับไฟล์ที่ระบบ/สคริปต์ใช้จริง

---

## 10. แนวทางต่อยอด

### 10.1 ฟีเจอร์ภาษีรอบถัดไป (ตาม `docs/TAX_FEATURES_SPEC.md` หัวข้อ 8)

- ~~**รายงานภาษีขาย / ภาษีซื้อ / สรุป ภ.พ.30** แยกตามสถานประกอบการ — G2–G7, G11, G14~~ ทำแล้วใน ADR-023; ยังเหลือ: ภาษีซื้อจากใบรับสินค้า (GR) — G15, ภ.พ.30 บรรทัด 13–16, วันหยุดราชการในวันครบกำหนด
- ~~ยกเลิก (void) ใบกำกับภาษีแทนการลบ — G1~~ ทำแล้วใน ADR-021; snapshot สาขาผู้ซื้อในบิล (G3) ทำแล้วใน ADR-021 (`customerBranchCode`)
- **ใบเพิ่มหนี้ ม.86/9** — collection `debitNotes` คู่กับใบลดหนี้ และให้ `paymentSummary` รู้จักยอดเพิ่มหนี้ — G8–G10
- **หัก ณ ที่จ่ายฝั่งผู้จ่าย: หนังสือรับรอง 50 ทวิ, ภ.ง.ด.3 / ภ.ง.ด.53** — field WHT ในค่าใช้จ่าย และ `whtCertificates` / `whtFilings` — G12–G13
- ควรเพิ่ม WHT ในหน้ารับชำระผ่านใบวางบิลด้วย และให้ `delDoc` / `voidPayment` ตรวจปิดงวด

### 10.2 วิธีแยกโมดูลออกจาก `app.js` อย่างปลอดภัย

แนวทางเดียวกับที่ใช้มาแล้วใน Step 2A–4A และ ADR-006/008/010:

1. **เลือกขอบเขตเล็กที่ชัด** เช่น "ค่าใช้จ่าย" (ฟอร์ม + รายการ + บันทึก), "สั่งผลิต", "Export/Import/Backup", "เป้ายอดขาย", "แดชบอร์ด/วิเคราะห์", "ข้อมูลหลัก + CSV"
2. **แยกกฎ pure ก่อน** ไปไว้ใน `*-core.js` ที่มีอยู่หรือไฟล์ใหม่ แล้วเขียนเทสต์ใน `tests/` แบบไม่ boot แอป (ชุด fast)
3. **ย้าย controller** ไปไฟล์ใหม่ที่ `import` core โดยตรง ลดการเรียกผ่าน `window.*`; ให้ `app.js` เหลือแค่ wiring
4. **เก็บ key ทั้งหมดเข้า `erp-storage-contracts.js`** และสร้างฟังก์ชันกลาง เช่น `documentPackKey(branch, year, month)` ให้ทุกไฟล์ใช้แทนการประกอบ `biz2_…` เอง
5. **แทน inline `onclick`** ด้วย `data-action` + event delegation (แบบที่ `erp-order-flow.js` ใช้ `data-order-action` อยู่แล้ว) เพื่อลดตัวแปร global
6. **แทนการห่อฟังก์ชันด้วย timer** ด้วย hook ที่ชัด เช่นให้ `saveInvoice` เรียกรายการ "ตัวตรวจก่อนบันทึก" / "หลังบันทึก" ที่โมดูลอื่นลงทะเบียน
7. เขียน **ADR ปรับ `QUALITY_BUDGET.json`** (ไฟล์ runtime ชนเพดาน 41 แล้ว) และลด baseline ของ `app.js` ตามที่ย้ายออกได้จริง
8. รัน `npm run verify` และ `audit:render-golden` ทุกขั้น เอกสารพิมพ์ต้องไม่เปลี่ยน

### 10.3 เส้นทางไปสู่ระบบจริงที่มี Backend

1. **ย้ายที่เก็บข้อมูลไป Server** — ชั้น core ที่เป็น pure นำไปใช้ฝั่ง Server ได้เกือบทั้งหมด (`plan*DocumentAction`, `validateCreditNote`, `paymentSummary` ควรย้าย logic ออกจาก `erp-integrity.js` ให้เป็น pure ก่อน) ส่วน `ERPIntegrity.transaction` จะถูกแทนด้วย transaction ของฐานข้อมูลจริง
2. **ระบบผู้ใช้และสิทธิ์ฝั่ง Server** — tenant, สาขา, บทบาท และปิดงวด/อนุมัติต้องบังคับที่ Server (`docs/cloud-reference/` มีแนวทาง Firebase Auth + Firestore Rules อยู่แล้ว และโค้ด `FirebaseService`/Sync Outbox ใน `erp-governance.js` เป็นโครงเริ่มต้น)
3. **บัญชีคู่** — ทำตาม `docs/TAX_FEATURES_SPEC.md` หัวข้อ 6: ผังบัญชีแบบ TFRS for NPAEs (เช่น 1130 ลูกหนี้การค้า, 2120 ภาษีขาย, 1160 ภาษีเงินได้ถูกหัก ณ ที่จ่าย, 4190 รับคืนและส่วนลด) และสร้างรายการบัญชีเป็น **มุมมองที่คำนวณจากเอกสาร** (`buildJournal(doc)`) ที่ Dr = Cr ทุกเอกสาร ไม่ให้แก้ด้วยมือ ข้อควรระวังจาก spec: VAT ของงานบริการเกิดเมื่อรับเงิน (ม.78/1) แต่ระบบปัจจุบันถือทุกบิลเป็นการขายสินค้า
4. **Audit ที่แก้ไม่ได้** — เก็บฝั่ง Server แบบ append-only
5. **ไฟล์แนบ** — ย้ายจาก IndexedDB ไป object storage
6. **e-Tax Invoice / e-Filing** — ทำหลังข้อ 1–3 เสร็จ (`buildETaxReadiness` / `buildWhtReadiness` ใน `erp-governance-core.js` ใช้เป็นตัวตรวจความพร้อมของข้อมูลได้)
