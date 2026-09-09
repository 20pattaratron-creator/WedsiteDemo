# Order-to-Cash Design

Canonical flow: Quotation → Sales Order → Fulfillment → Delivery/Invoice → optional Billing Note → Payment → Receipt.

- Graph definition: `erp-workflow-definitions.js`
- Runner: `erp-workflow-graph-core.js`
- Integrity rules: `erp-integrity.js`
- Operational UI/store: `erp-order-flow.js`
- Printable documents remain separate controllers to avoid coupling presentation lifecycles.
