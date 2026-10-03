# ERP DEMO 4.3.1 — Step 1.2: Customer Trial Stable

เอกสารนี้บันทึกการพัฒนาแบบ “ทีละก้อนเล็ก + ตรวจทุกครั้ง” สำหรับขั้นที่ 1 ก่อนเริ่ม refactor `app.js` ในขั้นที่ 2

## เป้าหมาย

ปิดฐาน 4.3.1 ให้เป็นชุด Customer Trial ที่ตรวจซ้ำได้ โดยไม่แก้ Business Logic เพิ่มโดยไม่จำเป็น

## การเปลี่ยนแปลง

### A. Release-version hygiene

เดิม deployment test บางจุดยังฝัง `3.4.0` ไว้ ทำให้ test มีโอกาส fail เพราะข้อความเวอร์ชันเก่าเมื่อ dependency พร้อมรันในอนาคต

แก้เป็นอ่าน `erpRelease` จาก `package.json` ทำให้ test ตาม release ปัจจุบันอัตโนมัติ

### B. One-command trial validation

เพิ่ม:

```bash
npm run validate:trial -- --pages-dir <pages-folder> --pages-zip <pages.zip>
```

Gate จะตรวจ:

- JavaScript syntax
- Codebase / Deep / Spec / Complexity audits
- Security preflight
- Security baseline
- Core evidence
- Full-suite evidence และ classification
- Runtime manifest SHA-256
- Source ↔ Pages runtime hashes
- Local refs จาก `index.html`
- Local HTTP smoke
- ZIP integrity เมื่อส่ง path ZIP เข้ามา

### C. Fail-truthful release status

สถานะจะไม่ถูกสรุปเป็น Full PASS หาก Full Node/DOM suite ไม่ผ่านจริง

ใน environment ปัจจุบันผลคือ:

`CUSTOMER_TRIAL_STABLE_CORE_VALIDATED_FULL_ENV_BLOCKED`

เนื่องจาก `jsdom` / `fake-indexeddb` ไม่พร้อม ไม่ใช่เพราะ core assertions fail

## สิ่งที่ยังไม่ได้ทำในขั้นนี้

- ยังไม่แยก `app.js`
- ยังไม่รวม controller ของเอกสาร
- ยังไม่ refactor CSS
- ยังไม่เพิ่ม feature ใหม่
- ยังไม่เพิ่ม backend / database

การตั้งใจ “ไม่ทำ” เหล่านี้ช่วยให้ Step 1 ปิดความเสี่ยงด้าน release correctness ก่อน แล้ว Step 2 จึงเริ่มแยก `app.js` อย่างมี regression baseline
