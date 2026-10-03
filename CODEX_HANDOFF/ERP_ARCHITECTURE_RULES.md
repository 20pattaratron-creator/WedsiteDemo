# ERP ARCHITECTURE RULES — MUST NOT VIOLATE

## A. Data Integrity
1. Financial/operational mutation ห้ามใช้ tolerant read
2. Parse/storage corruption ต้อง fail-closed
3. ห้าม fallback corrupted store เป็น `[]` แล้ว save ทับ
4. Multi-key mutation ต้อง transaction/rollback เมื่อรองรับ
5. Local commit ต้องมาก่อน cloud side effects
6. Cloud sync failure หลัง commit ห้ามแจ้งว่า local save ล้ม

## B. Canonical Ownership
- Quote canonical owner: Quote action boundary
- Production canonical owner: Production action boundary
- Invoice canonical owner: Invoice action boundary
- Receipt canonical owner: Receipt/payment action boundary
- Issued/print snapshot ห้าม mutate canonical accounting lifecycle
- Supplier payment state ห้ามถูก reset จาก Production edit form

## C. Error Semantics
รักษา typed error taxonomy อย่างน้อย:
- validation_error
- conflict_error
- dependency_error
- permission_error
- storage_error
- sync_error
- unknown_error

หลัง local commit แล้ว post-commit/cloud fail ต้องระบุ committed state ให้ผู้ใช้รู้ว่าอย่ากดสร้างซ้ำ

## D. Governance
- Period Lock event append-only
- Unlock ต้องมี reason
- Approval decision + audit evidence ควร atomic
- Audit log ห้ามสร้างจาก UI-only state โดยไม่มี canonical event
- interrupted/ambiguous sync = uncertain; ห้าม auto-retry แบบ blind

## E. Idempotency
- Operation ID/fingerprint ต้อง deterministic จาก semantic payload/revision
- ห้ามใช้ `Date.now()`/random เป็นส่วนที่ทำให้ retry เดิมกลายเป็น operation ใหม่
- synced operation ต้องไม่ยิง cloud ซ้ำ
- same operation + mismatched payload ต้อง conflict/fail-closed

## F. Backup / Restore
- Backup export ต้อง strict/fail-closed ทุก subsystem
- Schema v4+ ต้องมี content SHA-256
- Restore verify checksum ก่อน write
- ห้ามประกาศ Backup success หาก subsystem ใดอ่านไม่ได้
- Legacy backup อนุญาตตาม policy แต่ต้องระบุ unverified/legacy

## G. Document Rendering
- `documentPageHtml()` และ document-specific layout ยังแยกตามเอกสาร
- Shared Core ควรเป็น pure primitives/partition logic เท่านั้น
- ห้ามสร้าง Mega Renderer/Mega Controller
- ก่อนเปลี่ยน CSS/render source ต้องผ่าน Render Golden review

## H. Production Boundary
ห้ามอ้างว่า Local/GitHub Pages มี:
- Server RBAC
- secure tenant isolation
- atomic multi-device numbering
- DB transaction
- production e-Tax/WHT submission
จนกว่าจะมี backend จริงและ tests รองรับ
