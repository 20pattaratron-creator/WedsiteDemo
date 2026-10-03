# ERP DEMO 4.2.0 — Release Validation

วันที่ตรวจ: 8 กันยายน 2569
Package: 2.2.0

## สถานะ

**Validated static/local-demo release** — Core/Static/Security/Spec gates ผ่านทั้งหมดที่รันได้ใน environment นี้

## ผลตรวจล่าสุด

- Quality Gate: PASS
- Core Regression: **74/74 PASS, 0 FAIL**
- Codebase Audit: PASS
- Deep Static Audit: PASS (Runtime JS 25 ไฟล์ / 15,434 บรรทัด / blocking issues 0)
- Spec Audit: PASS (**28 requirements / 28 traceability / 0 untraced**)
- Complexity Gate: PASS
- Agent Repo Security: PASS (HIGH 0 / MEDIUM 0 / LOW 2 ที่ตรวจสอบแล้ว)
- Security SHA-256 Baseline: PASS (12 sensitive files)
- JS/MJS/CJS syntax: **54/54 PASS**
- Duplicate filename/basename: **0** ใน Full Source และ Static Pages package
- Static HTTP smoke: **41/41 HTTP 200**
- Source → Pages SHA-256 runtime comparison: **40/40 ตรงกัน**
- Core execution evidence: PASS (`evidence/CORE_TEST_EVIDENCE_4_2.json`)

## บัค/Regression สำคัญที่แก้แล้ว

1. Business date จาก UTC (`toISOString().slice(0,10)`) ถูกย้ายไป Local Business Date Core
2. Date-only comparison ของ Due/Required date ใช้ business-calendar helper แทน UTC instant
3. `SO → Delivery/Invoice` stale variable `due` ที่อาจเกิด `ReferenceError` ถูกแก้และมี regression test
4. VAT calculation มี deterministic source of truth กลาง
5. Persisted storage keys ย้ายเป็น Storage Contract กลางโดยไม่เปลี่ยน key เดิมให้ข้อมูลหาย
6. Workflow Graph fail closed เมื่อ guard หายหรือไม่มี route
7. Test Harness ถูกซ่อมให้รองรับ ES Module/shared core เพื่อลด false regression
8. Storage-contract test false-positive (`undefined === undefined`) ถูกแก้ให้ตรวจ contract จริง

## สิ่งที่ยังไม่รับรอง

### Full DOM/E2E Suite
Environment นี้ไม่มี `node_modules` และไม่สามารถติดตั้ง `jsdom` / `fake-indexeddb` / `vite` สำเร็จภายในเวลาที่ให้ได้ ดังนั้น:

- `vite build` ใน environment นี้รันไม่ได้ (`vite: not found`)
- Full DOM/IndexedDB tests ยังไม่ถูกนับว่า PASS

นี่เป็น **environment/dependency limitation** ไม่ใช่ application failure แต่ก่อน Production/Pilot จริงควรรันบนเครื่อง Development/CI ที่ติดตั้ง dependencies ได้:

```bash
npm ci
npm test
npm run build
npm run test:deployment
npm run security:verify-baseline
```

## Technical Debt ที่ยังตั้งใจคงไว้

- `app.js` ~8,256 บรรทัด: ต้องทยอยแยก domain ไม่ rewrite ครั้งเดียว
- Document controllers มี structural duplication บางส่วนระหว่าง Receipt / Delivery-Tax; business primitives (VAT/date/storage) ถูกย้ายออกแล้ว จึงยังไม่รวม controller แบบฝืน ๆ
- `style.css` และ document CSS มี cascade/override จำนวนมาก: ควร refactor พร้อม visual regression ไม่ใช้ auto-merge

## ขอบเขตการรับรอง

เวอร์ชันนี้เหมาะสำหรับ **Demo / Static Trial / Manager Presentation** มากขึ้น แต่ยังไม่ใช่ Production SaaS ที่รับรอง multi-user, server RBAC, database transactions, tenant isolation ฝั่ง server, central backup และ audit server-side
