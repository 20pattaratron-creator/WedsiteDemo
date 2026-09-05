# ERP DEMO v3.2 — ชุดพร้อมวางบน GitHub Pages

ชุดนี้เป็นไฟล์เว็บที่ build แล้วจาก DEMO v3.2 ไม่มีการเปลี่ยนกฎธุรกิจเพิ่มเติม และไม่ใช่ชุดซอร์สสำหรับแก้โค้ด

## วิธีอัปโหลดผ่านหน้า GitHub

1. แตก ZIP บนคอมพิวเตอร์ จะพบ index.html และโฟลเดอร์ assets อยู่ระดับเดียวกัน
2. เลือก branch สำหรับเผยแพร่ DEMO ใน repository ของคุณ ถ้ามีซอร์สอยู่แล้ว แนะนำใช้ branch สำหรับเผยแพร่แยกไว้ เพื่อเก็บซอร์สเดิม
3. ใช้ Add file → Upload files อัปโหลด index.html และโฟลเดอร์ assets ทั้งโฟลเดอร์ ลงที่รากของ branch ที่เลือก แล้ว Commit changes อย่าอัปโหลด ZIP หรือสร้างโฟลเดอร์ครอบชุดนี้เพิ่ม
4. ชุดนี้มีไฟล์ .nojekyll สำหรับเว็บที่ build แล้ว หากตัวเลือกไฟล์บนคอมพิวเตอร์ไม่แสดงไฟล์นี้ ให้สร้างใน GitHub ด้วย Add file → Create new file ตั้งชื่อ .nojekyll แล้ว Commit changes
5. ไป Settings → Pages → Source: Deploy from a branch เลือก branch เดียวกับข้อ 2 และ /(root) แล้ว Save
6. รอการเผยแพร่สำเร็จในแท็บ Actions แล้วเปิด URL ที่ Settings → Pages แสดง หากยังเห็นหน้าเก่า ให้รีเฟรชแบบไม่ใช้แคช (Ctrl+Shift+R หรือ Cmd+Shift+R)

วิธีนี้ใช้กับการเผยแพร่จาก branch หาก repository ปัจจุบันใช้ GitHub Actions สำหรับ build อยู่แล้ว ให้ตรวจ workflow ก่อนเปลี่ยนการตั้งค่า

## สิ่งที่ต้องวางครบ

- index.html
- assets/main-B0XufB9h.js
- assets/main-COqHZkUH.css
- assets/quotation-document-D1nx9Y5M.css
- assets/logo-FgPzZbhG.png
- .nojekyll

อย่าใช้ index.html จากโฟลเดอร์ซอร์สปนกับ assets จากชุดนี้ ชื่อไฟล์ต้องตรงกันทั้งตัวพิมพ์ใหญ่และเล็ก

## ตรวจอาการตามภาพ

ตัวหนังสือพื้นฐาน ไอคอนใหญ่มาก และโลโก้เสีย สอดคล้องกับ CSS/รูปภาพโหลดไม่สำเร็จ แต่ยังยืนยันสาเหตุของเว็บไซต์จริงไม่ได้จนกว่าจะตรวจ URL และ Network ของเว็บนั้น
เปิด Developer Tools → Network แล้วรีเฟรช ตรวจรายการ CSS, JS และ PNG ว่าได้สถานะ 200 และชนิดเนื้อหาถูกต้อง โดยเฉพาะกรณีตอบกลับเป็นหน้า HTML แทนไฟล์ที่ต้องการ

## ขอบเขตการตรวจ

ตรวจไฟล์ทั้ง 5 ผ่าน HTTP จำลองภายใต้ /demo-repo/ พร้อมสถานะ 200, MIME type และเปรียบเทียบ SHA256 กับ dist ต้นฉบับ รายละเอียดอยู่ใน DEPLOYMENT_CHECK.json
ไม่ได้ตรวจเว็บไซต์ GitHub Pages จริงหรือทดสอบหน้าตาด้วยเบราว์เซอร์ในรอบนี้ ระบบยังเป็น DEMO และใช้ข้อจำกัดเดิมของ v3.2

## เอกสารอ้างอิง

- GitHub: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- Vite: https://vite.dev/guide/static-deploy
