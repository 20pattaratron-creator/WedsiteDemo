# CODEX HANDOFF MASTER — ERP 4.3.1

## 1. Product / Project Context
ระบบเป็น ERP Lite สำหรับ B2B ไทย รองรับลูกค้ารัฐ/เอกชน, Stock/MTO, Supplier/Production และ Business Analytics โดยปัจจุบันเน้น **Customer Trial / DEMO** บน GitHub Pages และ Local Browser Storage

เอกสารหลัก:
- Quotation
- Production / Manufacturing Order
- Delivery / Tax Invoice
- Receipt
- Expense
- Billing / Payment flow

Workflow เป้าหมายหลัก:
`Quotation → Production/Stock → Delivery/Tax Invoice → Receipt`

ระบบยัง **ไม่ใช่ Production ERP** เพราะยังไม่มี backend transaction/RBAC/multi-tenant isolation/atomic numbering ที่เชื่อถือได้ข้ามอุปกรณ์

---

## 2. Current Source-of-Truth Status
### Stable release ล่าสุดที่ปิด package verification แล้ว
**ERP 4.3.1 Step 4A — Financial Governance & Reliability Foundation Stable**

คุณสมบัติสำคัญที่ Step 4A เพิ่ม:
- Financial Governance Pure Core + Runtime Adapter
- Accounting / VAT Period Lock
- Append-only governance events
- Local Audit Trail foundation
- Approval Engine Lite
- AR/AP Aging foundation
- Period Close Checklist
- Persistent Sync Outbox
- Deterministic operation fingerprint / idempotency semantics
- synced operation ต้องไม่ยิง cloud ซ้ำ
- in-flight operation ใน browser เดียวกันแชร์ promise
- `uncertain` sync state สำหรับ interrupted cloud result ที่ไม่ปลอดภัยต่อ auto-retry
- Backup schema v4 + SHA-256 content verification ก่อน Restore
- Financial Controls Audit
- Document Render Golden Guard
- Production readiness gate สำหรับ Server RBAC, backend tenant isolation, atomic numbering, server transaction, e-Tax/WHT submission

ผล Stable Step 4A ที่เคยปิด release:
- Core: 228/228 PASS
- Full: 228/235; 7 environment_dependency (`jsdom`, `fake-indexeddb`)
- Syntax: 82/82
- Runtime files: 48
- Source↔Pages mismatch: 0
- HTTP smoke: 49/49
- Security HIGH: 0
- Security MEDIUM: 0

> อย่า hard-code ตัวเลขเหล่านี้เป็นผลของ source ใหม่ Codex ต้องรันใหม่ทุกครั้ง

### Working step หลัง Step 4A
**Step 4B — Operational Storage & Approval Reliability**
สถานะ: WIP / NOT STABLE

เหตุผลที่ยังไม่ Stable:
- Backup export ของ Production/PO/GR/Inventory และ Order Flow ยังมี tolerant-read path บางส่วน
- Business document backup บางส่วนอาจใช้ tolerant `loadFor(...)`
- หาก JSON corruption ถูกตีความเป็น `[]` แล้ว export ต่อ อาจได้ backup ที่ checksum ถูกต้องแต่ข้อมูลขาดหาย
- ต้องทำ Backup export ให้ fail-closed ก่อน packaging

---

## 3. Architectural Evolution ที่ Codex ต้องรักษา
### Step 2F
Central Document Commit & Error Handling Boundary
- `validate → plan → commit → after_commit`
- central `runDocumentAction()`
- typed errors เช่น validation/conflict/dependency/storage/permission/unknown
- `committed=true` แยก post-commit failure ออกจาก commit failure

### Step 2G
Quote / Production / Expense action boundaries
- strict financial reads
- write lease
- transactional local multi-pack writes
- preserve workflow lineage
- block dangerous edits after downstream financial state

### Step 3A–3B
Document Controller duplication reduction
- สร้าง Document Controller Duplication Audit
- ย้าย pure/shared helpers ไป `erp-shared-core.js`
- Pagination pure boundary ถูก extract แต่ rendering/PDF lifecycle ยัง local
- ห้ามสร้าง Mega Controller

### Step 3C-1
Issued Document Transaction & Sync Boundary
- print/issued snapshot ต้องอ้าง Canonical source
- print layer ห้ามเปลี่ยน accounting truth
- Receipt print save ห้าม re-settle Invoice
- Delivery print save ห้ามเปลี่ยน Production lifecycle
- strict multi-key session + action runner
- cloud failure หลัง local commit = `sync_error`, ไม่ใช่ save failed

### Step 4A
Financial Governance & Reliability
- Period Lock
- Approval/Audit
- Aging/Close checklist
- Sync Outbox/idempotency
- Backup SHA verification
- Financial/Render release gates

---

## 4. Bugs ที่เคยพบและห้ามให้กลับมา
1. Tolerant read คืน `[]` แล้ว write ทับ corrupted financial/master data
2. Archive record หายหรือ seed resurrect archived product
3. Multi-key write สำเร็จบาง key แล้วอีก key ล้มโดยไม่มี rollback
4. UI render failure ถูกตีความเป็น financial commit failure
5. Receipt print layer re-settle invoice
6. Delivery print layerเปลี่ยน Production workflow
7. `paidAt = new Date()` ถูกสร้างใน print layer ทั้งที่ canonical source ไม่มี evidence
8. Direct `localStorage.setItem()` ใน financial issued-document save
9. Billing payment transaction สำเร็จแล้วมี `saveStore()` ซ้ำตามหลัง
10. `ERPIntegrity.transaction(...) || localStorage.setItem(...)` ทำให้เขียนซ้ำเพราะ transaction return `undefined`
11. Outbox operation ID ใส่ `Date.now()` ทำให้ retry payload เดิมกลายเป็น operation ใหม่
12. `synced` operation ถูกยิง cloud ซ้ำ
13. browser ปิดระหว่าง sync แล้วสถานะ `syncing` ค้างถาวร
14. auto-retry ambiguous interrupted cloud operation ทั้งที่ cloud อาจสำเร็จแล้ว
15. Period Lock validation ถูก bypass เพราะ active-lock reader swallow invalid event
16. Period/Approval state ถูก commit แยกจาก audit evidence
17. Customer Trial validator ลืมเรียก Financial Controls / Render Golden gates
18. Backup มี checksum แต่ export ต้นทาง tolerant-read ทำให้ backup ที่ “integrity ถูกต้องแต่ข้อมูลขาด” ได้
19. GR reversal ส่ง cloud side effect ก่อน local transaction commit
20. Quote Approval bypass strict storage / governance transaction
21. Delete mutation แยก business pack / recycle bin / audit เป็นคนละ write

---

## 5. Financial / Operational Invariants
- `corrupted/unknown != empty`
- Financial/Operational write paths ต้อง fail-closed
- Strict read ก่อน mutate
- Local source-of-truth commit ก่อน external/cloud side effects
- Multi-key local mutation ต้อง transaction + rollback เมื่อทำได้
- Cloud retry ต้อง idempotent
- Ambiguous cloud result ต้องเป็น `uncertain` ไม่ auto-retry จนกว่าจะ reconcile
- Canonical document เป็น source of truth; printable snapshot ห้ามสร้าง accounting evidence ใหม่
- Settlement state มี owner ที่ชัดเจน
- Period Lock ต้องตรวจ source date/branch/scope ก่อน write
- Unlock ต้องมี reason + append-only event
- Approval decision + audit evidence ควร commit atomic ใน Local Demo
- Backup ต้อง fail-closed เมื่อ source pack อ่านไม่ได้
- Restore ต้อง verify checksum ก่อน mutation

---

## 6. Environment Truth
Current demo architecture:
- Browser/localStorage / IndexedDB
- GitHub Pages customer trial
- optional cloud/firebase bridges บางส่วน

ห้ามอ้างว่าเป็น Production security เพราะยังขาด:
- Server-side RBAC
- Database-backed tenant isolation
- Atomic numbering across users/devices
- Server/database transactions
- Tamper-resistant server audit trail
- Secure secrets/backend signing
- Production e-Tax/e-Receipt submission
- Production e-Withholding submission

---

## 7. Development Method
ทุกก้อนงาน:
1. Establish baseline tests
2. Audit affected source line-by-line
3. Write failing/guard tests before or alongside fix
4. Change smallest coherent boundary
5. Run targeted tests
6. Run full Core
7. Run Code/Deep/Spec/Complexity/Document/Financial/Render/Security audits
8. Run Full evidence
9. Build runtime Pages set from manifest
10. Source↔Pages hash comparison
11. HTTP smoke
12. ZIP source/pages
13. unzip and re-run Core/Security/runtime verification
14. Only then mark Stable

ถ้า command timeout:
- ห้ามตีความเป็น PASS/FAIL
- แยก gate ออกเป็นคำสั่งย่อยแล้วรันซ้ำ

---

## 8. Immediate Next Priority
### Step 4B — ปิด Backup Fail-Closed Boundary ก่อน
ต้องตรวจอย่างน้อย:
- `collectBackupData()`
- Business document packs
- `ERPProductionCore.exportData()`
- PO / GR / Inventory movement storage
- `ERPOrderFlow.exportData()`
- backup manifest / restore validation

Desired behavior:
```
corrupted business/production/order-flow storage
        ↓
strict export throws
        ↓
BACKUP ABORT
        ↓
report subsystem/key
        ↓
NO successful backup artifact
```

ห้าม:
```
corruption → [] → backup success → checksum valid
```

หลังปิด Backup boundary ค่อยรัน Step 4B gates และ package Step 4B Stable
