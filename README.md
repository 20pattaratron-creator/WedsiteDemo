# ERP Integrated v4.3.1 — Customer Trial Step 1

Package **2.3.1** · Correctness / fail-closed / audit-truthfulness hardening.

เวอร์ชันนี้ยังเป็น **DEMO สำหรับทดลอง Workflow** ไม่ใช่ Production หลายผู้ใช้ ข้อมูลหลักยังอยู่ใน Browser, ทุกคนเห็นเมนูครบแบบ Admin (ไม่มีตัวเลือกมุมมองตามฝ่าย — ADR-014) และ Tenant UI ยังไม่ใช่ server-side authorization.

เริ่มอ่านจาก:
- `ERP_DEMO_4_3_1_STEP1_TH.md`
- `RELEASE_VALIDATION_4_3_1_TH.md`
- `LOCAL_DEMO_GUIDE.md`

## รันเทสต์ (รายละเอียด: `docs/TESTING_TH.md`)
```bash
npm run test:fast   # ค่าเริ่มต้นระหว่างแก้โค้ด — เทสต์ตรรกะล้วน ไม่ boot แอป (~5 วินาที)
npm test            # ทุกเทสต์ รวมเทสต์ที่ boot แอปใน jsdom (~2.5–3 นาที)
npm run verify      # ก่อนส่งงานทุกครั้ง: audit + ทุกเทสต์ + build + build:flat + deployment checks (CI รันคำสั่งนี้)
```

ตรวจ Core:
```bash
npm run quality:core
npm run evidence:core
```

Full release gate (ต้องมี dev dependencies ครบ):
```bash
npm ci
npm run quality:gate
```

ผล `Core PASS` ไม่ได้หมายถึง Full Browser/E2E PASS; ดู evidence ของแต่ละ scope แยกกัน.

## Refactor track — Step 2A

Customer Trial Stable 4.3.1 now includes a low-risk extraction of Thai business-date/calendar helpers into `erp-date-core.js`. See `ERP_DEMO_4_3_1_STEP2A_DATE_CORE_EXTRACTION_TH.md` and `APP_JS_DEPENDENCY_MAP_4_3_1_STEP2A_TH.md` for the validation and next-step guardrails.
