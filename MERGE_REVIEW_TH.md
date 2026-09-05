# ผลการเทียบและปรับรวม ERP

วันที่ตรวจ: 5 กันยายน 2569

ฐานหลักคือ `example-company-erp-local-demo-integrated-v3(1).zip` และไฟล์ประกอบที่ตรวจคือ `example-company-erp-trial-business-rules(1).zip`

## ข้อสรุป

ชุด Trial เป็นฐานที่มี Business Rules และส่วน Cloud ส่วน Integrated v3 มี Business Rules อยู่แล้ว พร้อม Dashboard เพิ่มเติม, Sales Order, Fulfillment, Billing, Payment, Customer 360 และ Local Demo Health ดังนั้นการคัดลอก `app.js` หรือ `index.html` จาก Trial ทับทั้งไฟล์จะทำให้ส่วนเพิ่มเติมบางส่วนหายไป

เทียบไฟล์ Trial ทั้ง 52 ไฟล์กับ Integrated เดิมแบบ byte-for-byte:

| ผลเทียบ | จำนวน |
|---|---:|
| มีอยู่แล้วและเหมือนกันทุกไบต์ | 26 |
| ชื่อเดียวกันแต่เนื้อหาต่างกัน | 5 |
| มีเฉพาะชุด Trial | 21 |

ดูครบทุกไฟล์และ SHA-256 ของต้นทางใน `MERGE_FILE_MAP.csv`

## การเลือกใช้แต่ละส่วน

| ไฟล์/กลุ่ม | สิ่งที่พบ | การจัดการในรุ่นนี้ |
|---|---|---|
| `business-rules.js`, `business-rules.css` | เหมือนกับฐาน Integrated | คงโมดูลร่วมและปรับสูตร Margin/Markup, การจับคู่สินค้า และการสำรองนโยบาย |
| `erp-production-core.js` | เหมือนกัน | คงและแก้ตรวจสต๊อกรวม SKU ซ้ำ, รหัสสินค้า PO, รับสินค้าและย้อนรายการ |
| `delivery-tax-document.*`, `receipt-document.*`, `quotation-document.*` | เหมือนกัน | คงหน้าตาและปรับ VAT/การอ้างอิงข้อมูลต้นทาง/การนับฉบับพิมพ์ |
| `local-file-store.js` | เหมือนกัน | เพิ่ม Export/Import เนื้อไฟล์แนบและตรวจ checksum |
| `tenant-context.js`, `style.css`, โลโก้, CSV templates | เหมือนกัน | คงองค์ประกอบเดิม |
| `app.js` | Trial ไม่มี Dashboard เปรียบเทียบบางส่วนและ Backup ของ Order Flow | ใช้ฐาน Integrated แล้วแก้จุดเชื่อมงานตามผลตรวจ ไม่แทนทั้งไฟล์ |
| `index.html` | Trial โหลด Firebase แต่ไม่มีโมดูล Order Flow/Customer 360/Health รุ่นใหม่ | คงหน้า Integrated พร้อมโมดูลแก้ข้อมูลกลางและ Backup |
| `trial-mode.js` | Trial เริ่มต้น 5 ขั้นตอน; Integrated เพิ่ม SO/วางบิลรวม 7 ขั้นตอน | คงขั้นตอนเริ่มใช้ 7 ขั้นตอนและโหมด Local |
| `package.json` | Trial มี Firebase/Admin SDK และคำสั่ง SaaS | คงแพ็กเกจ Local เพิ่มชุดทดสอบและ lockfile ที่ทำซ้ำได้ |
| `README.md` | คำอธิบายต่างรุ่น/ต่างโหมด | เขียนคู่มือของรุ่นที่ส่งใหม่ และเก็บ README เดิมเป็นเอกสารประวัติ |
| Firebase, Google Drive, `api/`, `server/`, scripts ฝั่ง Cloud, Rules และ deploy workflow | 21 ไฟล์เฉพาะ Trial | ตรวจเพื่อวางแผนต่อ ยังไม่ต่อเข้าหน้า Local และไม่แนบโค้ดที่ไม่ได้เปิดใช้ซ้ำในแพ็ก |

## ส่วน Cloud ที่ควรนำไปพัฒนาต่อ

- `firebase-auth.js` และ `tenant-context.js`: ใช้แนวทางสมาชิกและขอบเขตบริษัทเป็นต้นแบบ
- `firebase-bridge.js`: เป็นฐานซิงก์เอกสารเดิม แต่ต้องเพิ่มที่เก็บ/การซิงก์ SO, Billing, Payment และความสัมพันธ์กับใบเสร็จของรุ่นนี้
- `server/firebase-admin.js`, `api/admin/*`: เป็นฐานงานผู้ดูแลฝั่งเซิร์ฟเวอร์ ต้องทดสอบสิทธิ์และผลต่อสมาชิกจริง
- `firestore.rules`, `storage.rules`: ใช้เป็นร่างเริ่มต้น ไม่ควรนำไปเปิดระบบลูกค้าทันที

ข้อสังเกตจากโค้ดที่ตรวจ: กฎเขียนเอกสารธุรกิจปกติของ Firestore เรียก `canCreateBranchRecord` / `canUpdateBranchRecord` แต่ยังไม่ได้ตรวจ `editorRole` ในเส้นทางดังกล่าว จึงต้องทดสอบและแก้กรณีสมาชิก role viewer เขียนข้อมูลได้ ส่วน API สร้างสาขาตรวจสถานะแพ็กเกจ แต่ยังไม่ได้ตรวจวันหมดอายุ Trial แบบเดียวกับ Firestore Rules

การเปิด Cloud ให้สมบูรณ์ต้องกำหนดข้อมูลบริษัท/สาขา, ทดสอบ Rules ด้วย emulator, ใช้ transaction ฝั่งเซิร์ฟเวอร์สำหรับยอดสต๊อกและเงิน และทดสอบหลายผู้ใช้พร้อมกันก่อน รุ่นที่ส่งนี้ไม่ได้ deploy หรือแก้ Firebase project ใด

## ไฟล์ใหม่ที่เพิ่มเพื่อแก้ระบบ

- `erp-integrity.js`: คำนวณการรับเงิน การส่งสะสม ยอดจอง และการอ้างอิงเอกสารร่วมกัน
- `erp-backup.js`: ตรวจ Backup, snapshot/rollback และรวมไฟล์แนบ
- `tests/`: ทดสอบสูตร จุดเชื่อมงาน ฟอร์มจริงใน DOM จำลอง และไฟล์แนบ
- `package-lock.json`: ล็อก dependency สำหรับติดตั้งซ้ำ
- เอกสารรุ่นนี้และตารางเทียบไฟล์

ได้ย้ายเอกสารตั้งค่า Cloud เก่าไป `docs/cloud-reference/` และแทนหน้า `__prodcore_test.html` เดิมด้วยชุดทดสอบที่มี assertion ชัดเจน
