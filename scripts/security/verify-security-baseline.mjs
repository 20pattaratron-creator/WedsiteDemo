#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve(process.argv[2]||process.cwd());
const baselinePath=path.resolve(process.argv[3]||path.join(root,'SECURITY_BASELINE_SHA256.json'));
if(!fs.existsSync(baselinePath)){console.error('Security baseline not found:',baselinePath);process.exit(3);}
const baseline=JSON.parse(fs.readFileSync(baselinePath,'utf8'));
const sha=(f)=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
let bad=0;
for(const row of baseline.files||[]){
  const file=path.join(root,row.path);
  if(!fs.existsSync(file)){console.error('[MISSING]',row.path);bad++;continue;}
  const actual=sha(file);
  if(actual!==row.sha256){console.error('[CHANGED]',row.path);bad++;}
}
if(bad){console.error(`Security baseline FAILED: ${bad} change(s). Review before trusting an AI agent.`);process.exit(2);}
console.log(`Security baseline PASS: ${(baseline.files||[]).length} sensitive file(s) unchanged.`);
