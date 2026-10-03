# Codex Handoff Package — ERP 4.3.1

วันที่จัดทำ: 2026-09-17
ภาษาโครงการหลัก: ไทย
สถานะ: Handoff package แบบ self-contained

## จุดประสงค์
แพ็กเกจนี้ใช้สำหรับนำบริบทการพัฒนา ERP จาก ChatGPT ไปทำงานต่อใน Codex โดยไม่ต้องพึ่ง path หรือไฟล์เก่าที่อาจถูกย้ายออกไปแล้ว

> สำคัญ: เอกสารนี้ **ไม่ได้รวม Source Code ERP** และไม่สมมติว่า ZIP หรือ Repository ใดอยู่ใน path เดิม ผู้ใช้ต้องเปิด Repository/โฟลเดอร์/ZIP ที่ต้องการพัฒนาต่อใน Codex เอง แล้วให้ Codexตรวจสอบว่า source ตรงกับ checkpoint ใดก่อนแก้โค้ด

## สถานะโครงการที่ต้องจำ
- Stable checkpoint ที่ปิด Release แล้วล่าสุด: **ERP 4.3.1 Step 4A — Financial Governance & Reliability Foundation Stable**
- Step ถัดมาที่กำลังพัฒนา: **Step 4B — Operational Storage & Approval Reliability**
- Step 4B **ยังไม่ถือเป็น Stable** เพราะยังพบ Backup fail-closed gap ใน Operational/Order Flow export และต้องปิดก่อน package-level release
- Customer Trial/DEMO ปัจจุบันยังเป็น Local/Browser + GitHub Pages ไม่ใช่ Production backend

## วิธีใช้กับ Codex
1. เปิด Codex และเลือกโฟลเดอร์ Repository/Source ERP ที่คุณต้องการพัฒนาต่อ
2. วางไฟล์ในแพ็กเกจนี้ไว้ที่ root หรือโฟลเดอร์ `docs/handoff/`
3. เปิด `CODEX_START_PROMPT.md` แล้ว copy prompt ทั้งหมดส่งให้ Codex
4. ให้ Codexทำ Source Acquisition Protocol ก่อนแก้ไฟล์ใด ๆ
5. ถ้า source ที่เปิดไม่ใช่ Step 4A/4B ตามบริบท ให้ Codexรายงานความแตกต่างก่อน และห้ามเดาว่า source เป็นเวอร์ชันล่าสุด
6. ทุกครั้งที่แก้ ให้ทำทีละก้อนเล็ก + regression tests + audit + package verification

## ไฟล์ในแพ็กเกจ
- `CODEX_HANDOFF_MASTER.md` — บริบทโครงการและประวัติ architecture สำคัญ
- `CODEX_START_PROMPT.md` — Prompt พร้อมใช้ใน Codex
- `ERP_ARCHITECTURE_RULES.md` — กฎสถาปัตยกรรมที่ห้ามละเมิด
- `ERP_TEST_RELEASE_CHECKLIST.md` — Checklist ก่อน/หลังแก้ และก่อนประกาศ Stable
- `STEP4B_WORK_IN_PROGRESS.md` — งาน Step 4B ที่ทำไปแล้ว/ยังค้าง
- `FILES_TO_READ_FIRST.md` — ลำดับไฟล์ที่ Codex ควรอ่าน
- `HANDOFF_STATE.json` — สถานะ machine-readable
- `README_HANDOFF_TH.md` — ไฟล์นี้
- `SHA256SUMS.txt` — checksum ของไฟล์ในแพ็กเกจ

## หลักใหญ่ที่สุด
**อย่าอ้าง PASS ถ้ายังไม่ได้รันจริง** และ **อย่าเปลี่ยน Business Semantics พร้อมกับ Refactor โดยไม่มี regression evidence**
