# ERP Engineering Constitution — DEMO 4.2+

เอกสารนี้เป็นกติกาหลักของการพัฒนา ERP และมีลำดับความสำคัญสูงกว่า prompt/ad-hoc implementation ใด ๆ หาก requirement ใหม่ขัดกับหลักการนี้ต้องสร้าง Architecture Decision Record (ADR) ก่อนเปลี่ยนโค้ด

## C-01 Issued documents are immutable by default
เอกสารที่ออกแล้วห้าม hard delete หรือแก้สาระสำคัญแบบเงียบ ๆ ต้องใช้ Void/Reverse/Replacement พร้อม Audit trail

## C-02 Money has one deterministic calculation path
สูตรเงิน VAT ส่วนลด ต้นทุน กำไร และยอดค้างต้องมี source of truth ที่ทดสอบได้ ห้ามกระจาย literal/formula ใน UI

## C-03 Business date is a calendar date, timestamp is an instant
วันที่เอกสาร/ครบกำหนด/กำหนดส่งใช้ local calendar semantics ส่วน audit/sync timestamp ใช้ ISO UTC

## C-04 Persisted storage keys are contracts
ห้าม rename persisted key โดยไม่มี migration และ regression test

## C-05 Workflow is explicit and fail-closed
Route สำคัญต้องอยู่ใน workflow graph/state transition ที่ตรวจสอบได้ Unknown route/missing guard ต้อง fail ไม่เดาเอง

## C-06 UI is not a security boundary
การซ่อนเมนูตาม role เป็น UX เท่านั้น Production authorization ต้องบังคับฝั่ง server/database

## C-07 Tenant and branch isolation are mandatory
Transaction และ report ทุกตัวต้องมี tenant/company scope และ branch scope ตามสิทธิ์

## C-08 AI may advise, not mutate accounting/inventory truth directly
AI/LLM สามารถอธิบาย สรุป หรือเสนอ action แต่ transaction สำคัญต้องผ่าน deterministic validation/policy/human approval

## C-09 Reuse before create
ก่อนสร้าง helper/module/dependency ใหม่ ต้องตรวจว่ามี shared core, browser native API หรือ module เดิมรองรับหรือไม่

## C-10 Requirement must be traceable to validation
Business requirement สำคัญต้องมี Requirement ID, Acceptance Criteria และ Test/Evidence ที่อ้างกลับได้

## C-11 Release requires evidence
คำว่า PASS ต้องมาจาก test/audit/security/deployment evidence ไม่ใช่ AI confidence หรือการเปิดหน้าเว็บแล้วดูเหมือนทำงาน

## C-12 Demo limitations must be explicit
Local Demo, preview portal, UX role และ local storage ต้องไม่ถูกนำเสนอว่าเป็น production security/multi-user backend
