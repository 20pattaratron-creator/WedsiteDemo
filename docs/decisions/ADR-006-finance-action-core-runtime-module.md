# ADR-006 — Billing / Payment Actions Use a Dedicated Pure Runtime Core
Status: Accepted

## Context
Step 2D separates high-risk Billing, Payment allocation and Payment→Receipt planning from DOM/storage orchestration. Keeping these rules inside `erp-order-flow.js` or `erp-integrity.js` would preserve the previous runtime file count but would keep financial validation and mutation planning coupled to browser side effects.

## Decision
Use one dedicated runtime module, `erp-document-finance-core.js`, for deterministic finance action planning. It must remain free of DOM, browser storage, Firebase and UI notification dependencies. `erp-order-flow.js` owns orchestration/persistence and `erp-integrity.js` owns reconciliation and transactional receipt persistence.

The complexity budget `runtimeJsFilesMax` is deliberately raised from 30 to 31 for this boundary only. Other hard limits are unchanged. In particular, this ADR does **not** raise runtime line count, `app.js` line count, dev-dependency, global assignment or inline-handler budgets.

## Required evidence
- Portable finance-core tests must pass.
- Stateful integration tests must show payment does not rewrite invoice sale/VAT totals.
- Payment receipt replay must be idempotent or fail closed on mismatched prior evidence.
- Financial writes must fail closed when the Order Flow store cannot be trusted.
- Complexity, code, deep, specification and security audits must pass after the budget change.

## Consequences
A single additional runtime JS file is accepted in exchange for a testable deterministic finance boundary. Future runtime-module growth still requires a separate deliberate ADR or consolidation/refactor.
