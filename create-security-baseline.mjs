#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(process.argv[2] || process.cwd());
const out = path.resolve(process.argv[3] || path.join(root, 'SECURITY_BASELINE_SHA256.json'));
const protectedNames = new Set([
  'package.json','package-lock.json','vite.config.js','vercel.json','index.html',
  'scripts/security/agent-repo-audit.mjs','scripts/security/create-security-baseline.mjs','scripts/security/verify-security-baseline.mjs',
  'SAFE_AGENT_PREFLIGHT_WINDOWS.bat','SECURITY_AGENT_GUIDE_TH.md','SECURITY.md','.gitignore'
]);
const dynamicPrefixes = ['.claude/','.cursor/','.vscode/','.devcontainer/','.github/'];

function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function walk(dir, outFiles=[]) {
  for (const ent of fs.readdirSync(dir,{withFileTypes:true})) {
    if (['node_modules','.git','dist','dist-flat'].includes(ent.name)) continue;
    const full = path.join(dir,ent.name);
    if (ent.isDirectory()) walk(full,outFiles); else if (ent.isFile()) outFiles.push(full);
  }
  return outFiles;
}
const files = walk(root);
const rows=[];
for (const file of files) {
  const rel=path.relative(root,file).replaceAll(path.sep,'/');
  if (protectedNames.has(rel) || dynamicPrefixes.some(p=>rel.startsWith(p)) || /(?:^|\/)(?:CLAUDE|AGENTS|GEMINI)\.md$/i.test(rel) || /(?:^|\/)mcp\.json$/i.test(rel)) {
    rows.push({path:rel,sha256:sha(file),size:fs.statSync(file).size});
  }
}
rows.sort((a,b)=>a.path.localeCompare(b.path));
const payload={version:1,generatedAt:new Date().toISOString(),root:path.basename(root),files:rows};
fs.writeFileSync(out,JSON.stringify(payload,null,2)+'\n');
console.log(`Security baseline written: ${out}`);
console.log(`Tracked security-sensitive files: ${rows.length}`);
