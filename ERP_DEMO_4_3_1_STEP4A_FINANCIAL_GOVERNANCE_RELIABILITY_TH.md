# ERP DEMO 4.3.1 — Step 4A Financial Governance & Reliability Foundation

## เป้าหมาย

ยกระดับ Customer Trial จากระบบเอกสารที่มี strict write boundary ให้มี Financial Governance foundation โดยยังไม่กล่าวอ้างความสามารถ Production ที่ browser-local architecture ทำไม่ได้.

## สิ่งที่เพิ่ม

1. `erp-governance-core.js` Pure Policy Core
2. `erp-governance.js` Local Demo Governance Runtime
3. Period Lock แยก sales / purchase / all
4. Append-only local governance audit evidence
5. Persistent Sync Outbox + deterministic operation fingerprint
6. Dead-letter + interrupted-sync `uncertain` semantics
7. AR/AP aging foundation
8. Period Close Checklist
9. Approval policy/history foundation
10. Backup schema v4 SHA-256 verification before restore mutation
11. e-Tax/e-Receipt + WHT readiness checks (ไม่ใช่ submission)
12. Document Render Golden source guard
13. Financial Controls Audit
14. Customer Trial Closure บังคับ Financial + Render audits

## Bug ที่พบและปิดระหว่าง line-by-line review

### B1 — Redundant financial write after Billing Payment transaction

เดิม transaction สร้าง payment/receipt สำเร็จแล้วมี non-transactional save ตามหลัง. ถ้า write หลังล้ม ผู้ใช้อาจเห็นว่า save ล้มทั้งที่ transaction แรก commit แล้ว. Step 4A เอา redundant write ออก.

### B2 — Invoice/Receipt duplicate number บาง path กลับไป tolerant scan

Step 4A บังคับ strict write scanner เพื่อให้ corrupted history ไม่ถูกตีความว่า “ไม่มีเลขซ้ำ”.

### B3 — Governance transaction fallback เขียนซ้ำ

รูปแบบ `transaction(...) || localStorage.setItem(...)` ผิด semantics เพราะ transaction เดิมคืน `undefined` เมื่อสำเร็จ ทำให้ direct write รอบสองเกิดเสมอ. เปลี่ยนเป็น explicit transaction boundary.

### B4 — Outbox operation ID มีเวลาใน seed

Retry payload เดิมเคยได้ operation ID ใหม่. เปลี่ยนเป็น deterministic fingerprint จาก command/payload.

### B5 — Synced operation สามารถถูก execute ซ้ำ

เพิ่ม replay suppression: `status === synced` คืน cached result โดยไม่ยิง Cloud.

### B6 — Browser interruption ค้าง `syncing` ถาวร

หาก `syncing` เกิน stale timeout จะเปลี่ยนเป็น `uncertain`. ระบบไม่ auto-retry เพราะ remote outcome อาจ commit แล้ว.

### B7 — Period Lock validation ไม่ได้ fail ก่อน persist จริง

เดิมเรียก helper ที่ swallow invalid events. ตอนนี้ `lockPeriod()` ใช้ `normalizePeriodLockEvent()` โดยตรงก่อน transaction.

### B8 — Governance state กับ Audit evidence แยก transaction

Period Lock/Unlock, Approval และ Sync lifecycle สำคัญถูกปรับให้ local state + governance audit commit ผ่าน rollback-capable transaction เดียวกัน.

### B9 — Active Period Lock อาจหายเมื่อ history ถูก trim

เพิ่ม active-lock-preserving compaction: historical inactive events trim ได้ แต่ active lock event ต้องถูกเก็บไว้เสมอ.

### B10 — Open AR ถูกถือเป็น blocker ของ Period Close

แก้เป็น review-level evidence. ลูกหนี้/เจ้าหนี้คงค้างเป็นสิ่งที่ต้อง aged/reconcile/review ไม่จำเป็นต้องเป็นศูนย์ก่อนปิดงวด. Invalid payment allocation, unlinked receipt และ high-risk sync state ยังคง blocker.

### B11 — Backup มี checksum ตอน export แต่ restore ต้อง verify ก่อน write

Schema v4 บังคับ `contentSha256`; import ตรวจ checksum ก่อน capture/write/import attachment. mismatch หยุดก่อน mutation.

### B12 — Stable validator ไม่เรียก Financial/Render audits โดยตรง

เพิ่ม `audit-financial-controls.mjs` และ `audit-document-render-golden.mjs` เข้า `validate-customer-trial.mjs` พร้อม regression test.

## สถานะ Production

ยังเป็น Local/Customer Trial. Server RBAC, backend tenant isolation, atomic numbering, database transactions, secure audit storage, backend idempotency/reconciliation และ tax submission API ยังเป็น Production gaps.
