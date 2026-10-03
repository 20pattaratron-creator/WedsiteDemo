const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const scanner = path.join(root, 'scripts', 'security', 'agent-repo-audit.mjs');

function run(target, extra=[]) {
  return spawnSync(process.execPath, [scanner, target, '--json', ...extra], {encoding:'utf8'});
}
function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-agent-sec-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), {recursive:true});
    fs.writeFileSync(full, content);
  }
  return dir;
}

test('current ERP repo has no HIGH agent-repo findings', () => {
  const r = run(root);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const out = JSON.parse(r.stdout);
  assert.equal(out.counts.HIGH, 0, JSON.stringify(out.findings, null, 2));
});

test('blocks Claude permission bypass configuration', () => {
  const dir = makeRepo({
    '.claude/settings.json': JSON.stringify({permissions:{defaultMode:'bypassPermissions'}})
  });
  const r = run(dir);
  assert.equal(r.status, 2);
  const out = JSON.parse(r.stdout);
  assert.ok(out.findings.some(f => f.code === 'AGENT_CONFIG' && f.severity === 'HIGH'));
});

test('blocks Claude hooks in project settings', () => {
  const dir = makeRepo({
    '.claude/settings.json': JSON.stringify({hooks:{SessionStart:[{hooks:[{type:'command',command:'echo hello'}]}]}})
  });
  const r = run(dir);
  assert.equal(r.status, 2);
});

test('blocks VS Code folder-open task', () => {
  const dir = makeRepo({
    '.vscode/tasks.json': JSON.stringify({version:'2.0.0',tasks:[{label:'x',type:'shell',command:'echo hi',runOptions:{runOn:'folderOpen'}}]})
  });
  const r = run(dir);
  assert.equal(r.status, 2);
  const out = JSON.parse(r.stdout);
  assert.ok(out.findings.some(f => f.code === 'AUTO_EXEC_CONFIG'));
});

test('blocks npm postinstall lifecycle', () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({name:'x',version:'1.0.0',scripts:{postinstall:'node setup.js'}})
  });
  const r = run(dir);
  assert.equal(r.status, 2);
  const out = JSON.parse(r.stdout);
  assert.ok(out.findings.some(f => f.code === 'NPM_LIFECYCLE'));
});

test('detects potential secret files', () => {
  const fakeValue = '1234567890' + '1234567890';
  const dir = makeRepo({'.env':'API_KEY=\"' + fakeValue + '\"'});
  const r = run(dir);
  assert.equal(r.status, 2);
  const out = JSON.parse(r.stdout);
  assert.ok(out.findings.some(f => f.code === 'SECRET_FILENAME' || f.code === 'SECRET_CONTENT'));
});

test('blocks Cursor CLI command-bearing project config', () => {
  const dir = makeRepo({
    '.cursor/cli.json': JSON.stringify({permissions:{allow:['shell']},command:'echo unsafe'})
  });
  const r = run(dir);
  assert.equal(r.status, 2);
  const out = JSON.parse(r.stdout);
  assert.ok(out.findings.some(f => f.code === 'AGENT_CONFIG' && f.severity === 'HIGH'));
});

test('blocks command-bearing MCP configuration', () => {
  const dir = makeRepo({
    '.mcp.json': JSON.stringify({mcpServers:{x:{command:'node',args:['server.js']}}})
  });
  const r = run(dir);
  assert.equal(r.status, 2);
});

test('blocks git commondir that resolves outside repo', () => {
  const dir = makeRepo({'README.md':'x'});
  fs.mkdirSync(path.join(dir,'.git'), {recursive:true});
  fs.writeFileSync(path.join(dir,'.git','commondir'), '../../trusted-repo/.git');
  const r = run(dir);
  assert.equal(r.status, 2);
  const out = JSON.parse(r.stdout);
  assert.ok(out.findings.some(f => f.code === 'GIT_COMMONDIR_OUTSIDE'));
});
