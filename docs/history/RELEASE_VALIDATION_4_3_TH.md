# ERP DEMO 4.3.0 — Customer Trial Validation

Package 2.3.0

## ผ่านแล้ว
- Quality Core Gate: PASS
- Core/portable automated tests: 82/82 PASS
- Codebase audit: PASS
- Deep static audit: PASS
- Spec traceability: 28/28, Issues 0
- Complexity audit: PASS
- Agent/repo security: HIGH 0 / MEDIUM 0
- Security SHA-256 baseline: PASS 12/12
- GitHub Pages runtime manifest: 42 files
- Source → Pages SHA-256: 42/42 match
- Local HTTP smoke: 42/42 HTTP 200
- Trial hardening tests: 8/8 PASS

## Full suite
Full `npm test` ใน environment นี้ได้ 82/89 โดย 7 test files เริ่มไม่ได้เพราะ `jsdom` / `fake-indexeddb` ไม่ได้ติดตั้งใน runtime ปัจจุบัน จัดเป็น environment dependency limitation และ **ไม่ถูกนับเป็น Full Browser/E2E PASS**.

## Hardening สำคัญใน 4.3
- Issued Invoice/Receipt ถูกล็อกไม่ให้ hard delete ผ่าน workflow ปกติ
- Master Data ใช้ Archive/ปิดใช้งานแทน hard delete
- Attachment URL allowlist และ preview แบบไม่ใช้ document.write ใน app detail
- Data-driven actions ใน Order Flow/Production Core เปลี่ยนเป็น data-* + event delegation
- Same-browser write lease สำหรับ Quote/Invoice/Receipt (best effort เท่านั้น)
- แก้ issued-detail modal lifecycle `show` → `open`
- แสดงป้าย DEMO limitation ชัดเจน

## ข้อจำกัด
รุ่นนี้เหมาะสำหรับ Customer Trial ด้วยข้อมูลทดลอง ไม่ใช่ Production หลายผู้ใช้: localStorage/IndexedDB ไม่ใช่ server DB, write lease ไม่ใช่ DB transaction, Role UX ไม่ใช่ server RBAC และเลขเอกสารยังไม่ atomic ข้ามเครื่อง/ผู้ใช้.
