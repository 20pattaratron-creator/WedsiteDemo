# ERP DEMO 4.0.0 — Product Experience / Workflow Release

Package 2.0.0 · 7 กันยายน 2569

## เป้าหมาย
เปลี่ยนจาก “ระบบที่มีฟีเจอร์เยอะ” ให้เป็น “ระบบที่ผู้ใช้รู้ว่าต้องทำอะไรต่อ” โดยรักษา Stock/MTO/Production/Analytics เดิมไว้

## สิ่งที่เพิ่ม
- หน้า **งานของฉัน** เป็นหน้าเริ่มต้น พร้อม Work Queue ตามบทบาท
- มุมมอง ผู้บริหาร / ฝ่ายขาย / จัดซื้อ / คลัง / บัญชี / Admin
- โหมดง่าย/ขั้นสูง เพื่อลด Information Overload
- Approval Center สำหรับ Quote และ PO ใน Local Demo
- Stock Availability: On Hand, Reserved, Available, Incoming PO, Reorder
- Customer Portal Preview แบบ customer-facing only
- Workflow Ribbon แบบ Order-to-Cash
- Home Search เชื่อม Global Search / Customer 360 เดิม

## สิ่งที่ปรับ UX
- เปลี่ยนชื่อเมนูให้เป็นภาษางาน เช่น “วิเคราะห์ธุรกิจ”, “ตั้งค่าบริษัท”, “ขาย → ส่ง → วางบิล → รับเงิน”
- เอาข้อความ `FLOWACCOUNT-INSPIRED` และ `ประเภทสินค้าแบบ FlowAccount` ออกจาก UI หลัก
- เปลี่ยน `TENANT-SCOPED FORMULA SANDBOX` เป็น `BUSINESS RULES · ADVANCED`
- ในโหมดง่าย ซ่อน Target card รุ่นเก่าที่ซ้ำกับ 12-month planner และซ่อน Forecast/Quant เชิงลึกจนกว่าผู้ใช้เลือกโหมดขั้นสูง

## หลักการด้านข้อมูล
- Work Queue อ่านข้อมูลจาก ERPIntegrity / ERPOrderFlow / ERPProductionCore เดิม ไม่สร้างยอดขายหรือ Stock ชุดใหม่
- Available = On Hand − Reserved
- Incoming PO = จำนวน PO ที่ยังรับไม่ครบหลังหัก Goods Receipt ที่ Post แล้ว
- Approval PO เปลี่ยน Draft → Ordered ผ่าน Production Core import/transaction เดิม พร้อม Audit event ใน Demo

## ข้อจำกัดของ DEMO
- Role เป็นการจัด UX เท่านั้น ไม่ใช่ Security/RBAC ฝั่ง Server
- Approval Center ไม่ใช่ Approval Policy ฝั่ง Server และยังไม่มีวงเงินอนุมัติหลายชั้น
- Customer Portal เป็น Preview ใน Browser เครื่องเดียว ยังไม่มี Customer Authentication หรือ URL ภายนอก
- Credit Note / Debit Note / Deposit / e-Tax และ Accounting Connector ยังเป็นงาน Production Phase ถัดไป

## การทดสอบ
- `npm run audit:code`
- `npm run security:preflight`
- `npm run test:product`
- Core regression ชุดที่ไม่พึ่ง jsdom/fake-indexeddb
- Full DOM/IndexedDB suite ต้องรันหลัง `npm ci` บนเครื่องพัฒนา
