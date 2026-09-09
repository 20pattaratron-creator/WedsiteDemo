# ความปลอดภัยก่อนเปิด AI Coding Agent — ERP DEMO 3.9

เอกสารนี้ใช้กับ Claude Code, Cursor, Gemini CLI, Copilot/Agent, Codex/Agent และเครื่องมือที่สามารถอ่านไฟล์ แก้ไฟล์ หรือรันคำสั่งจากโฟลเดอร์โปรเจกต์ได้

## กฎสำคัญที่สุด

**อย่าเปิด AI Agent ใน Repo ที่เพิ่ง Clone ก่อนตรวจไฟล์ควบคุม Agent และสคริปต์ของ Repo**

Repo ที่ยังไม่เชื่อถือให้ถือเป็นข้อมูลจากภายนอก เช่นเดียวกับไฟล์แนบหรือสคริปต์ที่ดาวน์โหลดจากอินเทอร์เน็ต

## ขั้นตอนสำหรับ Repo นี้

ก่อนเปิด Agent:

```bash
npm run security:preflight
npm run security:verify-baseline
```

ผลที่เหมาะสมคือ `PASS` หรือมีเพียง `LOW` ที่เข้าใจเหตุผลแล้ว หากเป็น `BLOCK` ห้ามเปิด Agent จนกว่าจะตรวจ finding ครบ

## ขั้นตอนสำหรับ Repo แปลก/Repo จากอินเทอร์เน็ต

1. อย่า `cd` เข้า Repo แล้วเปิด Agent ทันที
2. เปิดดูบน GitHub/GitLab Web ก่อน โดยเฉพาะไฟล์ต่อไปนี้
   - `.claude/`, `CLAUDE.md`
   - `.cursor/`, `.cursorrules`
   - `.mcp.json`, `mcp.json`
   - `.vscode/tasks.json`, `.vscode/settings.json`
   - `.devcontainer/devcontainer.json`
   - `AGENTS.md`, `GEMINI.md`, Copilot instructions
   - `package.json` scripts
   - Shell/PowerShell/Batch files
3. ใช้ scanner จาก Repo ที่เชื่อถือได้ (โปรเจกต์นี้) โดย **ไม่รัน script จาก Repo เป้าหมาย**:

```bash
node scripts/security/agent-repo-audit.mjs "../untrusted-repo"
```

4. ถ้าจำเป็นต้องติดตั้ง dependency เพื่อวิเคราะห์ ให้ตรวจ lockfile ก่อน และในรอบแรกพิจารณา:

```bash
npm ci --ignore-scripts
```

`--ignore-scripts` ปิด lifecycle scripts แต่ package บางตัวอาจใช้งานไม่ได้จนกว่าจะติดตั้งแบบปกติ ดังนั้นใช้เพื่อ “inspection รอบแรก” ไม่ใช่รับประกันว่าเป็นวิธีรันโปรเจกต์ถาวร

5. ถ้าต้องทดลอง Repo ไม่รู้จัก ให้ใช้ VM/Container/Sandbox ที่ไม่มี:
   - SSH key ของเครื่องหลัก
   - AWS/GCP/Azure credentials
   - Production API keys
   - GitHub token สิทธิ์กว้าง
   - Browser profile หลัก
   - mounted home directory หรือ Docker socket
6. ห้ามใช้โหมด bypass/auto-run กว้าง ๆ กับ Repo ที่ยังไม่ตรวจ
7. อัปเดต AI coding tools สม่ำเสมอ

## Scanner ตรวจอะไร

`security:preflight` ตรวจอย่างน้อย:

- AI-agent configs/instructions
- permission bypass / hooks
- MCP commands / helpers
- VS Code auto-run tasks
- Dev Container lifecycle commands
- npm install lifecycle scripts
- shell / PowerShell / batch files
- dependency URLs ที่ไม่ใช่ registry ปกติ
- symlink ออกนอก repo
- potential secret files / private keys / tokens
- invisible/bidirectional Unicode control characters
- Docker mounts ที่เสี่ยง เช่น Docker socket, `.ssh`, `.aws`

## สิ่งที่ scanner ไม่สามารถรับประกัน

PASS ไม่ได้แปลว่า Repo ปลอดภัย 100% เพราะ prompt injection อาจซ่อนใน source/doc ทั่วไป, dependency ที่ถูก compromise อาจไม่มีสัญญาณใน package.json และโค้ดที่ดูปกติอาจมี logic อันตราย

ดังนั้นการป้องกันที่ถูกต้องคือหลายชั้น:

**Review → Sandbox → Least privilege → Updated tools → Dependency review → Tests**

## Policy ของ ERP Repo นี้

- Repo นี้ไม่ควร commit `.claude/`, `.cursor/`, `.mcp.json` หรือ workspace auto-run config โดยไม่มี Security Review
- ถ้าต้องเพิ่ม Agent config ภายหลัง ต้องส่ง review แยกและรัน `security:preflight`
- ห้าม commit secrets; ใช้ `.env.example` เฉพาะชื่อ variable และ placeholder
- Security-sensitive config ที่ผ่าน review จะถูกบันทึก hash ใน `SECURITY_BASELINE_SHA256.json`
- ถ้า baseline เปลี่ยน ให้ตรวจ diff ก่อนสร้าง baseline ใหม่ ห้าม regenerate เพื่อให้ test ผ่านโดยไม่ review
