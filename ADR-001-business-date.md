# ADR-001 — Business Date Uses Local Calendar Semantics
Status: Accepted

Document dates, due dates and required dates are date-only business concepts. They must be parsed/compared with shared business-date helpers. Audit/sync timestamps remain UTC ISO instants.
