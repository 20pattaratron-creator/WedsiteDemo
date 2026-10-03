# ERP 4.3.1 — Improvement Roadmap หลัง Step 3C-1

เอกสารนี้จัดลำดับแนวคิดที่ควรพัฒนาต่อจากมุม Correctness / Auditability / Multi-user readiness / Customer value โดยไม่รีบเปลี่ยน Local Demo ให้เป็น Production ก่อนเวลา

## P0 — ก่อน Production จริง

1. **Financial Storage Boundary Consolidation**
   - ตรวจทุก write path ใน `erp-integrity.js`, reconciliation, issued documents, order flow
   - direct financial storage write ต้องเหลือ owner ที่ชัดเจน
   - corrupt/unknown state ต้อง fail closed

2. **Immutable Audit Trail / Event History**
   - who / when / action / entity / old / new / reason
   - issued/paid/approved recordsควร cancel/reverse/archive มากกว่า delete
   - export audit evidence ได้

3. **Accounting / VAT Period Lock**
   - lock sales/purchase/tax periods ตามวันที่
   - correction หลัง lock ใช้ reversal/adjustment หรือ exception พร้อมเหตุผลและ audit

4. **Server-side Multi-tenant + RBAC**
   - company/branch isolation ที่ backend/security rules
   - role/permission ไม่อาศัยการซ่อนปุ่มใน UI

5. **Atomic Numbering + Server Transactions**
   - quotation/invoice/receipt/payment number ไม่ชนข้าม device
   - write source + child + settlement ผ่าน transaction ฝั่ง server

## P1 — Reliability / Sync

6. **Idempotency Key + Persistent Sync Outbox**
   - operationId ต่อ financial mutation
   - retry Cloud แบบปลอดภัยโดยไม่สร้างเอกสารซ้ำ
   - pending/synced/failed/dead-letter state
   - manual retry จาก Sync Center

7. **Backup / Restore Validation**
   - checksum + schema version
   - dry-run restore
   - partial snapshot guard
   - scheduled backup หลังมี backend

8. **Observability / Error Correlation**
   - action ID / request ID / document ID
   - structured error log
   - user-facing support code ที่ไม่เปิดข้อมูล sensitive

## P1 — Accounting / Management Value

9. **AR/AP Aging + Reconciliation**
   - ลูกหนี้คงค้างตามอายุ
   - เจ้าหนี้ supplier
   - invoice -> receipt/payment reconciliation
   - overdue alerts

10. **Period Close Checklist**
    - unresolved drafts
    - missing tax evidence
    - unreconciled payments
    - negative/abnormal VAT
    - stock/production inconsistencies

11. **Approval Engine**
    - quotation discount / high amount
    - PO / production cost override
    - expense approval
    - role + threshold + reason + history

## P2 — Thailand Localization

12. **e-Tax Invoice / e-Receipt readiness**
    - canonical tax identity/address/branch data
    - immutable issued tax snapshot
    - XML/signature/submission boundary แยกจาก UI
    - submission status + retry/outbox

13. **Withholding Tax / e-Withholding Tax**
    - WHT type/rate/base/tax amount
    - certificate references
    - payment linkage

## P2 — UX / Quality

14. **PDF / Visual Golden Regression**
    - snapshot known documents
    - page count / layout / signature/footer position
    - compare before CSS refactor

15. **CSS Design System Cleanup**
    - tokens, spacing, typography, component states
    - ทำหลัง visual regression พร้อมแล้ว

16. **Accessibility + Mobile Trial**
    - keyboard, focus, contrast, touch targets, responsive document forms

## Suggested next checkpoint

**Step 3C-2 — Financial Storage Boundary Consolidation Audit**

เริ่มแบบ audit-only ก่อน: map ทุก financial write owner, direct localStorage/write helper, tolerant-vs-strict read, rollback scope และ canonical source ownership แล้วเลือกแก้เพียงหนึ่ง high-risk write path ต่อ checkpoint.
