> เอกสารเดิมจาก Integrated v3: สำหรับการเปลี่ยนแปลงรุ่น v3.1 ให้อ่าน README.md และ VALIDATION_TH.md ก่อน

# รายงานการรวมและปรับปรุงระบบ — Integrated v3

## ฐานที่ใช้

ฐานหลักคือ `example-company-erp-local-demo-dashboard-insights.zip` ซึ่งมี Local Demo, Tenant Context, Trial Mode, Business Rules, Dashboard/Forecast, Master Data, Quotation, Production, Invoice, Receipt, Expense, PO, Goods Receipt, Stock และ Audit อยู่แล้ว

## ปัญหาที่พบก่อนรวม

1. Order Flow v2 เดิมอ่าน `biz2_*` โดยตรง แต่ฐาน Local Demo ปัจจุบันเก็บเป็น `erp_tenant::<tenant>::biz2_*` จึงมีความเสี่ยงหา Quote/Invoice ไม่พบ
2. Proposal Hardening เดิมตรวจ Firebase แต่ฐานนี้ตั้งใจปิด Firebase จึงไม่ควรแสดงเป็นความผิดปกติ
3. Backup JSON เดิมยังไม่รวม Sales Order / Billing Note / Payment Allocation
4. Fulfillment v2 ให้ผู้ใช้กรอก Stock พร้อมใช้เอง ซึ่งเสี่ยงกรอกผิดและเพิ่มภาระผู้ใช้
5. Fulfillment ระบุจำนวนที่ต้องซื้อ แต่ยังไม่มีทางลัดไป PO เดิม
6. ระบบมีเมนูจำนวนมาก แต่ยังไม่มี Global Search และ Customer 360°

## สิ่งที่แก้

- Order Flow v3 ใช้ `ComformTenant.storageKey()` และ `unwrapStorageKey()`
- รองรับ migration จาก Store v2 ถ้าพบข้อมูลเดิม
- Stock ใน Fulfillment อ่านจาก Inventory/Product Master อัตโนมัติ
- เพิ่มปุ่ม `เตรียม PO จากส่วนที่ต้องซื้อ`
- เพิ่ม Ready Qty / Demo Ready action เพื่อแยกของที่วางแผนแล้วกับของพร้อมส่ง
- Backup / Restore หลักรวม Order Flow
- เพิ่ม Global Search (`Ctrl+K`)
- เพิ่ม Customer 360°
- เพิ่ม Local Demo Health และ Single-flight Guard ป้องกันการกด Save ซ้ำ
- Trial Onboarding จาก 5 → 7 ขั้นตอน

## สิ่งที่จงใจไม่ทำ

ยังไม่เปลี่ยน Local Demo ให้เป็น Production และยังไม่บังคับ Server-side Security, Atomic Counter, Trusted Audit หรือ Transaction Lock เพราะรอบนี้ออกแบบเพื่อการเสนอหัวหน้าและ UAT
