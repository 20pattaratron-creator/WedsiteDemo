# ERP Local Demo Showcase

เวอร์ชันนี้ทำขึ้นเพื่อ **ให้ลูกค้าทดลองดูระบบก่อน** โดยตั้งใจไม่เชื่อม Firebase / Firestore / Firebase Auth / Firebase Storage / Vercel API / Google Drive

## การเก็บข้อมูล

ข้อมูลที่ลูกค้ากรอกจะอยู่เฉพาะ Browser ของเครื่องนั้นผ่าน localStorage และ IndexedDB เช่น:

- Customer Master
- Supplier / Manufacturer Master
- Product Master
- Business Rules / Formula Version
- ใบเสนอราคา
- ใบสั่งผลิต
- ใบส่งสินค้า / ใบกำกับภาษี
- ใบเสร็จรับเงิน
- ค่าใช้จ่าย
- Purchase Order
- Goods Receipt
- Stock Movement
- Audit Log

ไม่มีการส่งข้อมูลธุรกิจไป Firebase/Cloud ใน build นี้

## เหมาะสำหรับ

1. เปิดให้ลูกค้าดูหน้าตา ERP
2. ให้ลูกค้าลองเพิ่มลูกค้า/สินค้า/ผู้ผลิต
3. ทดลอง Business Rules ของธุรกิจแต่ละประเภท
4. ทดลองสร้างใบเสนอราคา → เอกสารขาย → ใบเสร็จ
5. ทดลอง Stock / PO / Goods Receipt
6. ทดลอง CSV Import, Dashboard, Analytics และ Quant

## เริ่มใช้งาน

```bash
npm install
npm run dev
```

หรือ Deploy บน Vercel ได้ตามปกติ:

```bash
npm run build
```

Vercel ใช้ `dist/` ตาม `vercel.json`

## ไม่มี Firebase ใน Build นี้

`index.html` ไม่โหลดไฟล์ Firebase Auth / Firestore Bridge / Firebase Dashboard / Google Drive และ package.json ไม่มี dependency `firebase` หรือ `firebase-admin`

ถ้าจะนำระบบไปใช้จริงกับหลายบริษัท ให้กลับไปใช้เวอร์ชัน Multi-tenant Production แล้วเชื่อม Firebase พร้อม Security Rules ภายหลัง ไม่ควรนำ Local Demo นี้ไปใช้เป็นฐานข้อมูลจริงหลายผู้ใช้

## การนำเสนอลูกค้า

แนะนำ Flow ทดลอง:

1. ลูกค้า / ผู้จำหน่าย / สินค้า
2. สูตร / Business Rules
3. ใบเสนอราคา
4. PDF / Preview
5. ใบสั่งผลิต หรือ Stock ตามประเภทสินค้า
6. ใบส่งสินค้า / ใบกำกับภาษี
7. ใบเสร็จรับเงิน
8. Dashboard / Business Analytics

หน้าเว็บจะแสดงข้อความ `LOCAL DEMO · ไม่เชื่อม Firebase / Cloud` ชัดเจน

## Backup ก่อนล้างข้อมูล

กด `Backup JSON` บนแถบ Local Demo หรือหน้า Export / Import ก่อนกด `ล้างข้อมูลทดลอง`

> หมายเหตุ: Local Demo เหมาะสำหรับการสาธิตเท่านั้น การล้าง Browser data / site data ของผู้ใช้สามารถทำให้ข้อมูลทดลองหายได้

---

## Integrated Workflow v3 — เพิ่มจาก Local Demo เดิม

ชุดนี้รวมระบบ Local Demo เดิมเข้ากับ Workflow สำหรับการนำเสนอ โดยยังคงเป็น **Local-only / Proposal / UAT** และไม่ใช้ Firebase เป็นฐานข้อมูลจริง

### สิ่งที่เพิ่ม

- Sales Order หลังใบเสนอราคาได้รับอนุมัติ
- Fulfillment Planner: Stock / ผลิต / จัดซื้อ
- อ่าน Stock จาก Product Master / Inventory โดยอัตโนมัติ
- เตรียม PO จากส่วนที่ Sales Order ต้องจัดซื้อ
- เชื่อมไปฟอร์มสั่งผลิตและใบส่งสินค้าเดิม
- ใบวางบิล (Billing Note) รวมหลาย Invoice ของลูกค้ารายเดียวกัน
- Payment Allocation สำหรับสาธิต Partial Payment
- Document Trace ตั้งแต่ Quote → SO → Fulfillment → Invoice → Billing → Receipt
- Global Search ทั้งระบบด้วย `Ctrl+K`
- Customer 360° รวมยอดขาย ยอดค้าง เอกสาร และ Timeline ของลูกค้า
- Local Demo Health สำหรับตรวจ Backup / Runtime Error / Negative Stock ก่อนนำเสนอ
- Backup JSON หลักของระบบรวม Order Flow v3 แล้ว
- Trial Onboarding ขยายเป็น 7 ขั้นตอน

### ข้อจำกัดที่ยังตั้งใจเก็บไว้

- Sales Order / Billing / Payment Allocation ยังเป็น Local Demo Store
- เลข SO / Billing / Payment ยังไม่ใช่ Atomic Counter
- Stock Reservation เป็น Workflow Demo ไม่ใช่ Transaction Lock สำหรับหลายผู้ใช้
- Payment Allocation ยังไม่แทน Accounting Ledger และยังไม่สร้างใบเสร็จ Partial Payment อัตโนมัติ
- Production SaaS ต้องย้าย Critical Transaction ไป Backend / Firestore Transaction ภายหลัง
