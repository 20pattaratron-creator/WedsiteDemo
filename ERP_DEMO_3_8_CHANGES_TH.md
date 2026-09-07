# ERP DEMO 3.8.0 — Monthly Target Planner & Interactive Charts

รุ่นแพ็กเกจ 1.8.0 · 7 กันยายน 2569

## เป้าหมายของรุ่นนี้

ทำให้ Dashboard ใช้กำหนดเป้าหมายยอดขายและยอดส่งสินค้าได้ครบ 12 เดือนในหน้าเดียว และทำให้กราฟเปรียบเทียบสามารถกด/แตะเพื่อดูรายละเอียดจากข้อมูลจริงได้ โดยไม่เพิ่ม Chart Library ภายนอกและไม่สร้างยอดธุรกิจซ้ำจากระบบเดิม

## สิ่งที่เพิ่ม

### 1. Monthly Target Planner 12 เดือน
- ตั้งเป้ายอดขายและยอดส่งสินค้าแยกเดือน ม.ค.–ธ.ค.
- แยกตาม Tenant + สาขา + ปี + เดือน
- แสดงยอดจริงและ % ทำได้รายเดือน
- แสดงยอดรวมทั้งปี
- กำหนดเป้ารวมทั้งปีและกระจายเฉลี่ย 12 เดือน
- คัดลอกเป้ายอดขายไปเป็นเป้ายอดส่งสินค้าได้
- บันทึกทั้ง 12 เดือนพร้อมกัน
- ยังใช้ค่าเป้าหมายรุ่นเดิมเป็น fallback เพื่อไม่ทำข้อมูลเดิมหาย

### 2. Interactive Executive Charts
รองรับ Mouse, Keyboard และ Touch:
- Hover/focus บนคอม: tooltip สั้น
- Click/tap: เปิดหน้าต่างรายละเอียด
- Enter/Space: เปิดรายละเอียดสำหรับ keyboard user
- Escape: ปิดรายละเอียด

### 3. รายละเอียดกราฟสินค้าขายดี
เมื่อแตะ/คลิกแท่งสินค้าในแต่ละเดือน แสดง:
- จำนวนสินค้าที่ขาย
- ยอดขายรวมก่อน VAT
- ราคาเฉลี่ยต่อหน่วย
- สัดส่วน % ของยอดขายเดือนนั้น
- จำนวนลูกค้าไม่ซ้ำ

### 4. รายละเอียดกราฟวงกลมกลุ่มลูกค้า
แสดง:
- ยอดขายของกลุ่ม
- % ของกราฟ
- จำนวนลูกค้าไม่ซ้ำ
- จำนวนเอกสาร

### 5. รายละเอียด Actual vs Target
สำหรับยอดขายและยอดส่งสินค้า แสดง:
- ยอดจริง
- เป้าหมาย
- % ทำได้
- ยอดที่ยังขาดหรือเกินเป้า

## Data integrity
กราฟยังอ่านข้อมูลจาก `collectDashboardSalesRows`, `analyticsItemRows`, `customerAgencyForRecord` และ `rowsForMonthlyChart` ชุดเดียวกับ Dashboard เดิม ไม่สร้าง Business Total แยกอีกชุด

## ผลการตรวจใน environment นี้
- Codebase Audit: PASS
- JavaScript syntax: PASS
- Executive/Target tests: 8/8 PASS
- Core regression ที่ไม่พึ่ง DOM package: 47/47 PASS
- CSS brace balance: PASS

Full DOM tests บางชุดยังต้องใช้ `jsdom`/`fake-indexeddb` ซึ่งไม่มีใน runtime ปัจจุบัน จึงควรรัน `npm ci && npm test && npm run build` บนเครื่องพัฒนาก่อน Publish จริง
