# ADR-007 — Financial Governance Runtime Boundary

## Status
Accepted for Local Demo hardening.

## Context
Step 3C-1 closed a high-risk issued-document persistence bypass. The remaining roadmap adds period locks, append-only control evidence, persistent sync outbox/idempotency, aging, close checklist and approval history. Putting these concerns into `app.js` or `erp-production-core.js` would increase hidden coupling and reverse the ongoing decomposition work.

## Decision
Add two modules:

- `erp-governance-core.js` — pure deterministic policy/reporting helpers; no DOM/storage/cloud globals.
- `erp-governance.js` — Local Demo runtime adapter for tenant-scoped control storage, Period Lock, append-only governance events, Sync Outbox and Control Center rendering.

The Local Demo module is explicitly **not** server authorization, a database transaction engine, or a tax-submission implementation. Production still requires backend tenant isolation, RBAC, atomic numbering/transactions and secure e-Tax/e-Withholding integrations.

## Complexity budget change
The runtime module ceiling increases from 31 to 33 and root JS ceiling from 32 to 34. Runtime-line ceiling increases from 17,000 to 17,900 to accommodate governance controls without growing `app.js` into a mega-controller. `app.js` baseline/delta remains unchanged.

## Consequences
- Governance rules can be unit tested independently.
- Local Demo gains visible operational controls and retry evidence.
- Production gaps remain explicit and cannot be inferred as solved by client-side controls.

## Step 4A hardening notes

- Period Lock events are normalized by the pure core before persistence.
- Governance state transitions that require evidence (period lock/unlock, approval decisions, sync queue/success/failure) use rollback-capable local transactions so state and audit do not intentionally diverge.
- A browser/session interruption while an outbox operation is `syncing` is classified as `uncertain`, not automatically retried. The remote side may already have committed; only a backend idempotency/reconciliation contract can safely resolve that ambiguity.
- Period close treats open AR/AP as review evidence rather than requiring balances to be zero. Invalid payment allocation, unlinked receipts and high-risk sync states remain blocking controls.
- Local audit/outbox controls remain demo-grade: retention-limited browser storage is not tamper-resistant production evidence.
