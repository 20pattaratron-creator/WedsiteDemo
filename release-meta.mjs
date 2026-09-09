import fs from 'node:fs';
import path from 'node:path';

export function releaseMeta(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const release = String(pkg.erpRelease || '').trim();
  if (!/^\d+\.\d+\.\d+$/.test(release)) throw new Error('package.json must define erpRelease as x.y.z');
  return Object.freeze({ release, packageVersion: String(pkg.version || '') });
}
