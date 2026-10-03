# Order-to-Cash Requirements

- **REQ-OTC-001** WHEN ใบเสนอราคาถูกยืนยัน THEN ระบบ SHALL สามารถสร้าง/เชื่อม Sales Order โดยไม่สร้างยอดขายซ้ำ
- **REQ-OTC-002** WHEN ส่งสินค้าเพียงบางส่วน THEN Sales Order SHALL คงสถานะ partial และ remaining quantity ต้องถูกต้อง
- **REQ-OTC-003** WHEN ส่งครบแต่ยังรับเงินไม่ครบ THEN Order SHALL อยู่สถานะ delivered/waiting collection ไม่ใช่ completed
- **REQ-OTC-004** WHEN รับเงินเต็มจำนวน THEN outstanding SHALL เป็นศูนย์ และ reversal SHALL เปิดยอดค้างกลับ
- **REQ-OTC-005** WHEN Invoice เป็นเงินสด THEN ระบบ SHALL ไม่บังคับ Billing Note
- **REQ-OTC-006** WHEN Invoice เป็นเครดิตและเข้าเงื่อนไขวางบิล THEN Billing Note MAY รวมหลาย Invoice โดยห้ามสร้าง Revenue/VAT/Stock ซ้ำ
- **REQ-OTC-007** WHEN workflow guard หายหรือไม่พบ route THEN workflow SHALL fail closed
