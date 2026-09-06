# เผยแพร่ ERP DEMO 3.3.0 บน GitHub Pages

ZIP สำหรับ Pages เป็นชุด build พร้อมใช้ ส่วน ZIP ซอร์สใช้แก้โค้ดหรือ build ใหม่

1. แตก ZIP ชุด Pages จะเห็น index.html, assets/, deployment-check.html และ .nojekyll ที่ระดับเดียวกัน
2. อัปโหลดทั้งหมดนี้ที่รากของ branch สำหรับเผยแพร่ ถ้ามีซอร์สเดิมแนะนำแยก branch สำหรับเผยแพร่ อย่าอัปโหลด ZIP หรือครอบด้วยโฟลเดอร์เพิ่ม
3. ไป Settings → Pages → Deploy from a branch เลือก branch ที่อัปโหลดและ /(root) แล้ว Save ถ้าใช้งาน workflow build เดิมอยู่ให้ตรวจ workflow ก่อนเปลี่ยนการตั้งค่า
4. รอ Actions เผยแพร่สำเร็จ เปิด URL เว็บไซต์แล้วรีเฟรช Ctrl+Shift+R
5. เปิด deployment-check.html ที่อยู่โฟลเดอร์เดียวกับ index.html เช่น URL หน้า ERP ลงท้าย /ชื่อ-repo/ ให้ต่อท้าย deployment-check.html แล้วกดตรวจอีกครั้ง
6. ถ้าพบไฟล์ขาด ชนิดไฟล์ผิด หรือไฟล์ไม่ตรงรุ่น ให้ส่งภาพตารางและ URL เว็บไซต์ให้ผู้ดูแล

ไฟล์ .nojekyll อาจไม่ปรากฏในตัวเลือกไฟล์ของเครื่อง หากจำเป็นให้สร้างไฟล์ชื่อนี้ที่ราก branch ผ่าน Add file → Create new file

หากอัปโหลดเฉพาะ index.html หน้าเว็บจะยังผิดรูปแบบได้ ต้องมีโฟลเดอร์ assets ที่เป็นชุดเดียวกัน ไม่ควรปนไฟล์จาก source หรือ dist รุ่นก่อน

ดูรายละเอียดการตรวจและสิ่งที่แก้ใน DEMO_V3_3_CHANGES_TH.md เลขรุ่นระบบใน meta และหน้า diagnostic คือ 3.3.0 ชื่อ ZIP อาจคงชื่อเดิมเพื่อรักษาประวัติไฟล์

อ้างอิง: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
