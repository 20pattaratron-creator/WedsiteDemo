# ERP DEMO 4.3.1 — Step 2A: แยก Business Date / Thai Calendar Core ออกจาก app.js

## เป้าหมาย

ลดความเสี่ยงของ `app.js` แบบทีละก้อนเล็ก โดยไม่ rewrite ทั้งไฟล์และไม่เปลี่ยนพฤติกรรมผู้ใช้ใน Customer Trial

## Baseline ก่อนแก้

- `app.js` ประมาณ 8,239 logical lines ตาม Complexity Audit เดิม
- Core test: 90/90 PASS
- Full Node/DOM suite: 90/97 โดย 7 รายการถูกบล็อกจาก test environment ที่ไม่มี `jsdom`/`fake-indexeddb`
- Security baseline: PASS

## สิ่งที่ทำใน Step 2A

1. สร้าง `erp-date-core.js` เป็นโมดูล pure/shared สำหรับวันที่ธุรกิจและปี พ.ศ./ค.ศ.
2. ย้าย API เดิมออกจาก `app.js` โดยคงชื่อและ call signature เดิม:
   - `toCEYear`
   - `toBEYear`
   - `yearLabelBE`
   - `yearLabelDual`
   - `parseFlexibleBusinessDate`
   - `isoDateCEFromValue`
   - `formatThaiDate`
   - `makeThaiCalendarMeta`
   - `withThaiCalendarMeta`
3. `app.js` import API เหล่านี้กลับมา จึงไม่ต้องไล่แก้ call site เดิม
4. เพิ่ม `tests/date-core.test.cjs` จำนวน 7 regression tests
5. เพิ่ม test file เข้า canonical core test list
6. เพิ่ม `scripts/analyze-app-dependencies.mjs` และรายงาน Dependency Map เพื่อใช้เลือกก้อน refactor ถัดไปจาก coupling จริง

## เหตุผลที่เลือก Date Core ก่อน Master Data

Date Core ไม่มี dependency โดยตรงต่อ DOM, localStorage, Cloud sync หรือ notification และถูกเรียกใช้หลายส่วน เช่น Dashboard, Analytics, document numbering, import/export จึงเหมาะกับการพิสูจน์ pattern การแยกโมดูลครั้งแรก

Master Data ยัง coupling สูง: อ่าน/เขียน storage, DOM form, cloud hydration, analytics refresh และ user interaction อยู่ใน block เดียว จึงยังไม่ย้ายทั้งก้อนใน Step 2A

## ผลหลังแก้

- `app.js`: 8,161 logical lines ตาม Complexity Audit
- Runtime JS files: 28
- Core test: 97/97 PASS
- Codebase Audit: PASS
- Deep Static Audit: PASS
- Spec Audit: 32/32 PASS
- Complexity Audit: PASS
- Security Preflight: PASS (HIGH 0 / MEDIUM 0; LOW 2 เดิม)
- Security Baseline: PASS
- Full Node/DOM suite: 97/104; 7 environment dependency (`jsdom` unavailable) — ไม่รายงานเป็น Full PASS

## สิ่งที่ Step 2A ไม่ได้เปลี่ยน

- ไม่เปลี่ยนสูตร VAT / เงิน / stock / payment
- ไม่เปลี่ยน document lifecycle
- ไม่เปลี่ยน Customer/Supplier/Product Master UI
- ไม่เปลี่ยน CSS
- ไม่เพิ่ม backend หรือ production RBAC
- ไม่รวม Quotation/Delivery/Receipt controllers

## Guardrail สำหรับ Step 2B

ก้อนถัดไปควรเริ่มจาก service/storage boundary ของ Master Data ก่อนย้าย DOM rendering โดยทุก micro-step ต้องมี regression test ก่อนและหลัง และห้ามผสม CSS cleanup หรือ feature ใหม่ใน patch เดียวกัน
