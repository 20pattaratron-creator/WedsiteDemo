# ERP 4.3.1 Step 4A — Financial Governance Dependency Map

## 1. Pure policy layer

`erp-governance-core.js`

- Period Lock normalization / active lock / blocking check / compaction
- AR/AP aging
- Approval policy evaluation
- Period Close Checklist
- Sync operation fingerprint / outbox normalization / dead-letter threshold
- e-Tax/e-Receipt readiness checklist
- WHT readiness arithmetic
- Production-readiness gap model

ข้อกำหนด: ไม่มี DOM, localStorage, Firebase หรือ window.

## 2. Runtime adapter

`erp-governance.js`

- tenant-scoped persisted control state
- Period Lock/Unlock
- append-only local audit evidence
- persistent Sync Outbox
- same-browser in-flight deduplication
- interrupted-sync → uncertain state
- approval history
- Governance / Aging / Close Checklist panel

การเขียน control state ที่ต้องมีหลักฐานใช้ `ERPIntegrity.transaction()` เพื่อให้ control state และ audit evidence อยู่ใน rollback-capable write เดียวกัน.

## 3. Financial write enforcement

### Sales side

`app.js`

Invoice / Receipt → `ERPGovernance.assertPeriodOpen()` → strict financial write session → central action runner.

`erp-integrity.js`

Payment receipt creation → strict business pack parse → Period Lock → multi-key transaction.

`erp-order-flow.js`

Billing Payment → strict flow read → Period Lock → payment/receipt transaction; ไม่มี redundant `saveStore()` หลัง commit.

### Purchase side

`app.js`

Expense → purchase Period Lock → strict financial write session.

`erp-production-core.js`

Supplier payment state → purchase Period Lock.

## 4. Cloud reliability

Business/operational document callers create deterministic operation IDs from payload/revision and route through `ERPGovernance.runSync()` when available.

Outbox lifecycle:

`pending → syncing → synced`

or

`pending/syncing → failed → ... → dead_letter`

If browser/session disappears while outcome is unknown:

`syncing → uncertain`

`uncertain` is intentionally **not auto-retried**, because the remote side may already have committed. Production-grade resolution requires backend idempotency/reconciliation.

## 5. Backup / Restore

`erp-backup.js`

- export schema v4 computes `contentSha256`
- import calls `verifyPortable()` before mutation
- checksum mismatch stops restore
- `dryRun()` reports checksum verification and attachment references
- legacy backup remains importable but explicitly unverified

## 6. Release guards

- `audit-financial-controls.mjs`
- `audit-document-render-golden.mjs`
- `audit-codebase.mjs`
- `audit-deep.mjs`
- `audit-specs.mjs`
- `audit-complexity.mjs`
- `audit-document-controllers.mjs`
- Security preflight/baseline

`validate-customer-trial.mjs` directly executes Financial Controls + Render Golden audits before a package can be called Customer Trial Stable.

## 7. Explicit non-goals

Step 4A does **not** claim:

- secure server authorization
- database tenant isolation
- cross-device atomic numbering
- exactly-once distributed transaction semantics
- tamper-proof audit storage
- Revenue Department e-Tax/e-Withholding submission
- browser pixel/PDF visual certification
