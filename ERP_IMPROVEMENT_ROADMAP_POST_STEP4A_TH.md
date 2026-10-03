# ERP Improvement Roadmap หลัง Step 4A

## ทำแล้วใน Local Demo

- strict finance/document write boundaries
- transaction-aware issued document persistence
- Period Lock sales/purchase/all
- governance audit evidence
- persistent Sync Outbox / idempotency fingerprint
- dead-letter + uncertain interrupted sync
- AR/AP aging foundation
- close checklist
- approval policy/history foundation
- backup checksum/dry-run
- tax readiness checks
- source-level render golden guard

## P0 ก่อน Production จริง

1. Backend authentication + server RBAC
2. Tenant/company/branch authorization in database rules/server
3. Atomic document numbering transaction/sequence
4. Server/database transaction for financial mutations
5. Durable server audit log with tamper controls
6. Backend idempotency key + reconciliation endpoint for ambiguous network outcomes
7. Secrets/service credentials outside client bundle
8. Production backup/restore with server snapshots and disaster-recovery drill

## P1 Accounting / Operations

1. Real customer/vendor ledger and reconciliation model
2. Bank/cash reconciliation
3. Credit note / debit note / void-reversal workflow instead of destructive edit
4. Period-close exception workflow with authorization and expiry
5. Approval routing with server-side separation of duties
6. AR collection work queue and AP payment proposal
7. Inventory costing policy and immutable stock ledger

## P1 Thai compliance readiness

1. company/customer branch code + tax identity validation
2. formal document type mapping
3. e-Tax/e-Receipt XML mapping + schema validation
4. digital signature boundary
5. submission/status/retry/reconciliation API
6. WHT tax type/rate eligibility mapping
7. e-Withholding submission/status boundary

## P2 UX / Quality

1. Browser screenshot/PDF golden regression
2. CSS Design System cleanup after visual regression exists
3. Mobile workflow refinement
4. Accessibility / keyboard / print QA
5. performance budgets and lazy loading
6. UAT scenario library by role and branch

## Rule

อย่าทำ Production compliance/API หรือ CSS refactor ขนาดใหญ่ก่อน P0 transaction/security และ visual regression foundation พร้อม.
