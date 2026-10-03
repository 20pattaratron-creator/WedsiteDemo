# AI-Agent / Repo Security Audit — ERP DEMO 3.9.0

วันที่ตรวจ: 7 กันยายน 2569

## ผลปัจจุบัน

**PASS — ไม่พบ HIGH หรือ MEDIUM finding ใน Repo 3.9**

สิ่งที่ยืนยันจาก Source ปัจจุบัน:

- ไม่พบ `.claude/`, `CLAUDE.md`
- ไม่พบ `.cursor/`, `.cursorrules`
- ไม่พบ `.vscode/` project task/settings
- ไม่พบ `.mcp.json` / `mcp.json`
- ไม่พบ Dev Container auto-run config
- ไม่พบ root npm `preinstall/install/postinstall/prepare`
- ไม่พบ secret file ตาม pattern ที่ scanner ตรวจ
- ไม่พบ symlink ออกนอก repo
- ไม่พบ Git commondir trust anomaly ในแพ็กเกจ Source

LOW findings ที่ตั้งใจคงไว้:

1. `package-lock.json` มี `fsevents` ซึ่ง lockfile ระบุ `hasInstallScript`; เป็น optional dependency สำหรับ Darwin/macOS และถูกบันทึกเพื่อให้ผู้ใช้ตระหนักถึง dependency lifecycle scripts
2. `SAFE_AGENT_PREFLIGHT_WINDOWS.bat` เป็น Batch file ที่เราเพิ่มเอง มีหน้าที่เรียก scanner เท่านั้นและ **ไม่เปิด AI agent**

## การป้องกันที่เพิ่ม

- Agent repo preflight scanner
- Security baseline SHA-256
- Secret/credential guard
- AI-agent config/hook/MCP detection
- Cursor/Claude permission bypass detection
- VS Code folder-open / Dev Container lifecycle detection
- npm lifecycle script detection
- Git worktree commondir anomaly detection
- 9 security regression tests
- Vercel ใช้ `npm ci` เพื่อยึด package-lock

## ข้อจำกัด

ผล PASS ไม่ใช่การรับรองว่าโค้ด/Dependency ปลอดภัย 100% Prompt injection สามารถอยู่ใน source/document ทั่วไปได้ และ supply-chain compromise อาจเกิดโดยไม่มี hidden config ดังนั้น Repo ภายนอกยังควรเปิดใน sandbox/VM และใช้ least privilege
