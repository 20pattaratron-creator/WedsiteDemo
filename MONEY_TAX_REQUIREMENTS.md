# Money / Tax Requirements

- **REQ-MNY-001** VAT add/extract/none SHALL use one deterministic source of truth
- **REQ-MNY-002** Receipt/Payment SHALL NOT double-count printable payment evidence as additional cash
- **REQ-MNY-003** Overpayment SHALL be blocked or surfaced as critical; it must not be hidden by flooring outstanding at zero
- **REQ-MNY-004** Production cost allocation over partial deliveries SHALL retain final rounding difference so allocated total equals actual cost
- **REQ-MNY-005** Business date SHALL use local calendar semantics; UTC timestamp SHALL be reserved for audit/sync metadata
