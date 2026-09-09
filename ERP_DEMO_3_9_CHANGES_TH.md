# ERP DEMO 3.9.0 — AI-Agent / Repo Security Hardening

รุ่นแพ็กเกจ 1.9.0 · 7 กันยายน 2569

## เป้าหมาย

ลดความเสี่ยงจากการเปิด AI Coding Agent ใน Repo ที่มี project-controlled instructions/config/hook/MCP/script โดยไม่เปลี่ยน Business Workflow ของ ERP 3.8

## สิ่งที่เพิ่ม

- `scripts/security/agent-repo-audit.mjs`
  - ตรวจ `.claude/`, `CLAUDE.md`, `.cursor/`, MCP, AGENTS/GEMINI/Copilot instructions
  - ตรวจ permission bypass, hooks, command-bearing MCP/CLI config
  - ตรวจ VS Code folder-open tasks และ Dev Container lifecycle commands
  - ตรวจ npm install lifecycle (`preinstall/install/postinstall/prepare`)
  - ตรวจ script files, dependency source, symlink, Docker sensitive mounts
  - ตรวจ secret filename/content แบบไม่พิมพ์ secret ออก log
  - ตรวจ bidirectional/invisible Unicode control characters โดยไม่ false-positive emoji ZWJ
  - ตรวจ Git worktree `.git/commondir` ที่ชี้ออกนอก repo
- `scripts/security/create-security-baseline.mjs` และ `verify-security-baseline.mjs`
- `SECURITY_AGENT_GUIDE_TH.md` และ `SECURITY.md`
- `.gitignore` สำหรับ secret/local agent settings
- `SAFE_AGENT_PREFLIGHT_WINDOWS.bat` เป็นตัวช่วยตรวจอย่างเดียว ไม่ launch AI agent
- `tests/agent-security.test.cjs`
- Vercel ใช้ `npm ci` เพื่อบังคับ lockfile

## คำสั่งใหม่

```bash
npm run security:preflight
npm run security:preflight:strict
npm run security:scan -- ../untrusted-repo
npm run security:verify-baseline
npm run test:security
npm run audit:all
```

## Security gate

- `HIGH` → BLOCK: ห้ามเปิด AI agent จนกว่าจะ review/remove finding
- `MEDIUM` → REVIEW: ตรวจ config/instruction ก่อน trust
- `LOW` → Informational: มีสิ่งที่ควรรู้แต่ไม่ block

## ขอบเขต

Scanner ลดความเสี่ยงแต่ไม่สามารถพิสูจน์ว่า Repo ปลอดภัย 100% ได้ Prompt injection อาจอยู่ใน source/doc ปกติ และ dependency supply-chain สามารถเกิดโดยไม่มี config พิเศษ ดังนั้น Repo ไม่รู้จักยังควรใช้ VM/Container/Sandbox + least privilege + updated tools
