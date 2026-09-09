# Security Requirements

- **REQ-SEC-001** Untrusted repo agent config with permission bypass/hooks SHALL block preflight
- **REQ-SEC-002** Command-bearing MCP/Cursor/VSCode folder-open config SHALL block preflight
- **REQ-SEC-003** Potential secret files SHALL be detected before trust/deploy
- **REQ-SEC-004** Runtime error listener SHALL have one owner to avoid divergent health counts
- **REQ-SEC-005** Production tenant isolation SHALL be enforced server-side (not satisfied by Local Demo; tracked as production gap)
