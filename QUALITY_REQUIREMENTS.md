# Quality / Governance Requirements

- **REQ-QLT-001** Runtime files SHALL have no duplicate basename in release package
- **REQ-QLT-002** Inline HTML handlers SHALL resolve to exposed browser functions
- **REQ-QLT-003** Shared storage keys SHALL be imported from `erp-storage-contracts.js`, not copied as literals
- **REQ-QLT-004** VAT literals SHALL not be duplicated outside shared core
- **REQ-QLT-005** Requirement IDs SHALL be unique and linked to at least one automated test or explicit manual/production-gap evidence
- **REQ-QLT-006** Release metadata SHALL come from package metadata, not hard-coded independently across build/audit scripts
