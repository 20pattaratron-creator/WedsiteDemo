# ERP DEMO 3.5.0 — Decision Council & Governance Upgrade

วันที่ 7 กันยายน 2569 · รุ่นแพ็กเกจ 1.5.0 · พัฒนาต่อจาก DEMO 3.4.0

## เป้าหมาย

รอบนี้ไม่เพิ่มเอกสารธุรกิจใหม่ แต่เพิ่มชั้น “ทบทวนการตัดสินใจ” ให้ระบบช่วยชี้งานค้าง ความเสี่ยง และคุณภาพข้อมูลจากหลายมุม โดยยึดข้อมูลจริงใน Local Demo และกฎแบบ deterministic ไม่ส่งข้อมูลไป AI/API ภายนอก

## สิ่งที่เพิ่ม

- `erp-decision-council-core.js` — Pure business review engine ทดสอบได้โดยไม่ต้องเปิด Browser
- `erp-decision-council.js` — Adapter/UI สำหรับข้อมูล ERP ปัจจุบัน
- `erp-decision-council.css` — Dashboard card + Review dialog
- `tests/decision-council.test.cjs` — Unit tests 6 กรณี
- Rule Registry ระบุ Rule ID, Reviewer, สูตร/หลักการ และแหล่งข้อมูลของทุกคำเตือน
- Chairman Synthesis จัดลำดับสูงสุด 3 งานตาม severity โดยไม่สร้าง confidence % ปลอม

## Reviewer 6 มุม

1. ฝ่ายขาย / Pipeline — Quote ที่อนุมัติแล้วแต่ยังไม่เป็น SO และ Quote ที่ค้างติดตาม
2. บัญชีลูกหนี้ — Overdue, Invoice ค้างรับยังไม่วางบิล, Overpayment
3. Fulfillment — SO เลยกำหนด, แผน Stock/ผลิต/ซื้อไม่ครบ, ของพร้อมส่งแต่ยังไม่ส่ง
4. Inventory — Negative Stock และ Reorder Point
5. Data Quality / Governance — เอกสารข้อมูลสำคัญไม่ครบ, Runtime Error, Formula Version
6. Contrarian / Evidence Check — เตือนเมื่อข้อมูลน้อย และย้ำว่า Local Demo ไม่ใช่ Production Control

## หลักการสำคัญ

Decision Council v1 เป็น **rule-based multi-perspective review** ไม่ใช่ Multi-LLM Council และ UI ระบุเรื่องนี้ชัดเจน ไม่มีการส่งข้อมูลบริษัทออกภายนอก ไม่มีการให้ LLM เดา VAT/ภาษี/ตัวเลขธุรกิจ และไม่แทนการอนุมัติของผู้รับผิดชอบ

Architecture นี้ตั้งใจเตรียม seam สำหรับอนาคต: Reviewer บางตัวสามารถเปลี่ยนเป็น Model/Agent จริงได้ แต่ deterministic calculator, source registry และ human approval ต้องยังคงอยู่

## การใช้งาน

หน้า Dashboard จะมีการ์ด `DECISION REVIEW` แสดงประเด็นระดับกลางขึ้นไปสูงสุด 3 รายการ กด `เปิด Council` เพื่อดู Reviewer ทั้งหมด หลักฐาน และ Rule Registry หรือกดปุ่ม `🧭 ตรวจ Decision Council` ที่หัว Dashboard

## Version consistency

- UI: DEMO 3.5.0
- `package.json`: 1.5.0
- build label: `3.5.0-pages-review`
- build scripts และ deployment diagnostic ปรับเป็น 3.5.0
- README หลัก/คู่มือ GitHub Pages/FLAT ปรับเลขรุ่นปัจจุบันให้ตรงกัน เอกสารชื่อ `DEMO_V3_3...` และ `ERP_DEMO_3_4...` เก็บไว้เป็นประวัติรุ่นก่อน

## การทดสอบใน environment นี้

ผ่าน:
- JavaScript syntax ของ Council/Core
- Decision Council unit tests 6/6
- Test logic ที่ไม่พึ่ง DOM ในชุด Integrity เดิมยังทำงานระหว่าง regression invocation

ข้อจำกัด:
- `npm ci` ใน environment ที่ใช้สร้างแพ็กเกจนี้ไม่สามารถติดตั้ง `jsdom` และ `fake-indexeddb` จนครบภายใน runtime จึงไม่รับรองว่า Full Suite 3.5 ผ่านในเครื่องนี้
- ก่อนนำเสนอ/Deploy ให้รันบนเครื่องผู้ใช้: `npm ci && npm test && npm run build && npm run test:deployment`

## สิ่งที่ยังไม่ใช่ Production

- Council ยังรันใน Browser
- Tenant/Security ยังเป็น Local Demo layer
- ไม่มี Multi-user transaction / server-side RBAC / atomic document number
- ไม่ใช่ระบบ Multi-LLM จริง
- Rule Registry รอบนี้ใช้เฉพาะกฎเชิงข้อมูลภายใน ไม่เพิ่มอัตราภาษี/ค่าธรรมเนียมภายนอกแบบ hard-code
