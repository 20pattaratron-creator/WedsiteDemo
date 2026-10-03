# Step 4B — Operational Storage & Approval Reliability

สถานะ: **WORK IN PROGRESS / NOT STABLE**

## สิ่งที่ทำไปแล้วใน working source ตามบริบทล่าสุด
> Codex ต้อง verify กับ source ที่เปิดจริงก่อนเชื่อว่ามีการเปลี่ยนเหล่านี้อยู่

### Operational mutation
- PO / GR / Inventory Adjustment / Transfer / GR Reversal เปลี่ยนแนวทางเป็น strict write + rollback-capable transaction
- Cloud hydrate ต้องไม่เขียนทับ local storage ที่ corrupt
- GR reversal: Local transaction ต้อง commit ก่อน Cloud movement/reversal side effect

### Quote Approval
- ใช้ strict document pack
- write lease / action runner
- Quote approval state + Governance approval history + audit evidence อยู่ transaction เดียวกันเมื่อ possible
- external sync ผ่าน outbox หลัง local commit

### Business Delete
- strict source snapshot
- Business pack + Recycle Bin + operational audit commit พร้อมกัน
- Cloud delete ผ่าน Outbox หลัง local commit

### Governance reliability fixes
- Period Lock validate ก่อน persist
- Approval/Audit atomic local transaction
- stale syncing ไม่ควรถูก retry แบบ blind; ambiguous status ใช้ `uncertain`
- open AR/AP = review item ไม่ใช่ hard close blocker โดยอัตโนมัติ
- Customer Trial closure ต้องเรียก Financial Controls + Render Golden

## BLOCKER ที่ต้องแก้ก่อน Step 4B Stable
### Backup Export Fail-Closed Gap
ตรวจและแก้:
- Business document backup collection ที่ยังใช้ tolerant `loadFor(...)`
- `ERPProductionCore.exportData()` / operational store export
- `ERPOrderFlow.exportData()`

### Required tests
อย่างน้อย:
1. Corrupted business document pack → backup abort
2. Corrupted Production/PO/GR/Inventory store → backup abort
3. Corrupted Order Flow store → backup abort
4. Backup failure ต้องไม่สร้าง artifact ที่ถูกถือว่า success
5. Error ต้องบอก subsystem/key ที่อ่านไม่ได้
6. Valid backup ยังสร้าง checksum และ restore verify ได้

## หลังแก้ Blocker
รัน:
- targeted backup tests
- core
- full evidence
- audit: code/deep/spec/complexity/document/financial/render/security
- runtime manifest
- Source↔Pages hash
- HTTP smoke
- Source/Pages ZIP integrity
- unpack-and-reverify

จากนั้นเท่านั้นจึงเปลี่ยนสถานะเป็น Step 4B Stable
