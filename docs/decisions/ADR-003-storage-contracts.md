# ADR-003 — Persisted Storage Keys Are Versioned Contracts
Status: Accepted

Persisted browser keys live in `erp-storage-contracts.js`. Runtime release numbers may advance without renaming old storage keys. Renaming requires migration + rollback tests.
