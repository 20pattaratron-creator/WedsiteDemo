#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const argv = process.argv.slice(2);
const jsonMode = argv.includes('--json');
const failOnWarn = argv.includes('--fail-on-warn');
const positional = argv.filter((x) => !x.startsWith('--'));
const root = path.resolve(positional[0] || process.cwd());

const findings = [];
const add = (severity, code, file, message, detail = '') => {
  findings.push({ severity, code, file: file ? path.relative(root, file) || '.' : '', message, detail });
};

const HIGH = 'HIGH';
const MEDIUM = 'MEDIUM';
const LOW = 'LOW';
const INFO = 'INFO';

const agentControlPatterns = [
  /^\.claude(?:\/|$)/i,
  /^CLAUDE\.md$/i,
  /^\.cursor(?:\/|$)/i,
  /^\.cursorrules$/i,
  /^\.windsurf(?:\/|$)/i,
  /^\.codeium(?:\/|$)/i,
  /^\.mcp\.json$/i,
  /^mcp\.json$/i,
  /^AGENTS\.md$/i,
  /^GEMINI\.md$/i,
  /^\.github\/copilot-instructions\.md$/i,
];

const autoExecutionPatterns = [
  /^\.vscode\/tasks\.json$/i,
  /^\.vscode\/settings\.json$/i,
  /^\.vscode\/launch\.json$/i,
  /^\.devcontainer\/devcontainer\.json$/i,
  /^devcontainer\.json$/i,
  /^\.gitmodules$/i,
];

const shellExtensions = new Set(['.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd']);
const secretNamePatterns = [
  /^\.env(?:\.|$)/i,
  /(?:^|\/)(?:credentials?|secrets?|service[-_]?account)(?:\.|-|_|$)/i,
  /\.(?:pem|p12|pfx|key|jks)$/i,
  /id_(?:rsa|ed25519)(?:\.|$)/i,
];

const secretContentPatterns = [
  { name: 'private key', re: /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/ },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  { name: 'Slack token', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { name: 'generic secret assignment', re: /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"'\n]{16,}["']/i },
];

const suspiciousCommand = /(?:\bcurl\b|\bwget\b|Invoke-WebRequest|iwr\s|Start-BitsTransfer|certutil|bitsadmin|\bnc\b|\bncat\b|bash\s+-c|sh\s+-c|cmd(?:\.exe)?\s+\/c|powershell(?:\.exe)?\b|node\s+-e|python(?:3)?\s+-c|chmod\s+\+x|rm\s+-rf|del\s+\/s|reg\s+add|schtasks|launchctl|systemctl|\/var\/run\/docker\.sock|\.ssh|\.aws|\.config\/gcloud)/i;

const unicodeControl = /[\u202A-\u202E\u2066-\u2069\u200B\u200C\uFEFF]/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'dist-flat') continue;
    const full = path.join(dir, entry.name);
    let stat;
    try { stat = fs.lstatSync(full); } catch { continue; }
    if (stat.isSymbolicLink()) {
      out.push({ full, rel: path.relative(root, full).replaceAll(path.sep, '/'), stat, symlink: true });
      continue;
    }
    if (stat.isDirectory()) walk(full, out);
    else if (stat.isFile()) out.push({ full, rel: path.relative(root, full).replaceAll(path.sep, '/'), stat, symlink: false });
  }
  return out;
}

if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  console.error(`Target is not a directory: ${root}`);
  process.exit(3);
}

const files = walk(root);

// Git worktree/trust boundary check. A repository with an unexpected commondir
// should be reviewed before an AI agent relies on workspace trust.
const gitPath = path.join(root, '.git');
try {
  if (fs.existsSync(gitPath)) {
    const stat = fs.lstatSync(gitPath);
    if (stat.isDirectory()) {
      const common = path.join(gitPath, 'commondir');
      if (fs.existsSync(common)) {
        const raw = fs.readFileSync(common, 'utf8').trim();
        const resolved = path.resolve(gitPath, raw);
        if (!resolved.startsWith(root + path.sep)) {
          add(HIGH, 'GIT_COMMONDIR_OUTSIDE', common, 'Git commondir resolves outside the repository. Review worktree trust before opening an AI agent.', raw);
        } else {
          add(LOW, 'GIT_COMMONDIR', common, 'Git worktree commondir is present; confirm the worktree is expected.', raw);
        }
      }
    } else if (stat.isFile()) {
      const raw = fs.readFileSync(gitPath, 'utf8').trim();
      if (/^gitdir:/i.test(raw)) {
        const target = raw.replace(/^gitdir:\s*/i, '');
        const resolved = path.resolve(root, target);
        if (!resolved.startsWith(root + path.sep)) add(MEDIUM, 'GITDIR_OUTSIDE', gitPath, 'The .git file points outside the working tree; review workspace/worktree trust.', target);
      }
    }
  }
} catch (err) {
  add(MEDIUM, 'GIT_TRUST_CHECK', gitPath, 'Could not fully inspect git workspace trust metadata.', String(err.message || err));
}

for (const f of files) {
  if (f.symlink) {
    let target = '';
    try { target = fs.readlinkSync(f.full); } catch {}
    const resolved = path.resolve(path.dirname(f.full), target || '.');
    const outside = resolved !== root && !resolved.startsWith(root + path.sep);
    add(outside ? HIGH : MEDIUM, 'SYMLINK', f.full,
      outside ? 'Symlink points outside the repository.' : 'Repository contains a symlink; review before trusting an agent.', target);
    continue;
  }

  if (agentControlPatterns.some((re) => re.test(f.rel))) {
    let severity = MEDIUM;
    let message = 'AI-agent/project instruction file can change agent context or behavior; review before trust.';
    let detail = '';
    try {
      const text = fs.readFileSync(f.full, 'utf8');
      if (/bypassPermissions|dangerously[-_]skip[-_]permissions|"hooks"\s*:|SessionStart|PreToolUse|PostToolUse/i.test(text)) {
        severity = HIGH;
        message = 'AI-agent configuration contains permission bypass or hook-like behavior.';
      }
      if (/"command"\s*:|headersHelper|shell|terminal/i.test(text) && /mcp|\.mcp\.json|settings\.json|cli\.json/i.test(f.rel)) {
        severity = HIGH;
        message = 'AI-agent/MCP configuration may execute commands or helpers.';
      }
      detail = text.slice(0, 500).replace(/\s+/g, ' ');
    } catch {}
    add(severity, 'AGENT_CONFIG', f.full, message, detail);
  }

  if (autoExecutionPatterns.some((re) => re.test(f.rel))) {
    let text = '';
    try { text = fs.readFileSync(f.full, 'utf8'); } catch {}
    if (/"runOn"\s*:\s*"folderOpen"|initializeCommand|onCreateCommand|updateContentCommand|postCreateCommand|postStartCommand|postAttachCommand/i.test(text)) {
      add(HIGH, 'AUTO_EXEC_CONFIG', f.full, 'Project configuration contains command(s) that may run automatically when the workspace/container opens.');
    } else if (suspiciousCommand.test(text)) {
      add(MEDIUM, 'WORKSPACE_CONFIG', f.full, 'Workspace configuration contains shell/credential-sensitive command patterns; review before trust.');
    } else {
      add(LOW, 'WORKSPACE_CONFIG', f.full, 'Workspace configuration can affect editor/container behavior; review before trust.');
    }
  }

  if (shellExtensions.has(path.extname(f.rel).toLowerCase())) {
    let text = '';
    try { text = fs.readFileSync(f.full, 'utf8'); } catch {}
    add(suspiciousCommand.test(text) ? HIGH : LOW, 'SCRIPT_FILE', f.full,
      suspiciousCommand.test(text) ? 'Executable/script file contains sensitive or high-impact command patterns.' : 'Executable/script file should be reviewed before running.');
  }

  if (secretNamePatterns.some((re) => re.test(f.rel))) {
    add(HIGH, 'SECRET_FILENAME', f.full, 'Potential secret/credential file is present in the repository.');
  }

  const textLike = /\.(?:js|mjs|cjs|json|md|txt|yml|yaml|toml|ini|conf|config|html|css|xml|env|sh|bash|ps1|bat|cmd)$/i.test(f.rel) || !path.extname(f.rel);
  if (textLike && f.stat.size <= 2_000_000) {
    let text = '';
    try { text = fs.readFileSync(f.full, 'utf8'); } catch {}
    const textForUnicode = text.startsWith('\uFEFF') ? text.slice(1) : text;
    if (unicodeControl.test(textForUnicode)) add(MEDIUM, 'UNICODE_CONTROL', f.full, 'Contains invisible/bidirectional Unicode control characters; inspect for obfuscated instructions/code.');
    for (const sig of secretContentPatterns) {
      if (sig.re.test(text)) add(HIGH, 'SECRET_CONTENT', f.full, `Potential ${sig.name} found in file content.`, 'Value intentionally not printed.');
    }
  }
}

// package.json inspection
const pkgPath = path.join(root, 'package.json');
if (fs.existsSync(pkgPath)) {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const scripts = pkg.scripts || {};
    const installLifecycle = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly'];
    for (const name of installLifecycle) {
      if (!scripts[name]) continue;
      const sev = ['preinstall', 'install', 'postinstall', 'prepare'].includes(name) ? HIGH : MEDIUM;
      add(sev, 'NPM_LIFECYCLE', pkgPath, `package.json defines '${name}', which can execute during install/publish workflows.`, scripts[name]);
    }
    for (const [name, command] of Object.entries(scripts)) {
      if (suspiciousCommand.test(String(command))) add(HIGH, 'NPM_SCRIPT_COMMAND', pkgPath, `npm script '${name}' contains a high-impact shell/network/credential command pattern.`, String(command));
      else if (/\bnpx\b/i.test(String(command))) add(MEDIUM, 'NPM_NPX', pkgPath, `npm script '${name}' invokes npx, which may fetch/execute packages if not already installed.`, String(command));
    }
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      for (const [name, version] of Object.entries(pkg[section] || {})) {
        if (/^(?:https?:|git\+|git:|github:|file:|link:)/i.test(String(version))) {
          add(MEDIUM, 'NON_REGISTRY_DEP', pkgPath, `${section}.${name} uses a non-standard registry dependency source.`, String(version));
        }
      }
    }
  } catch (err) {
    add(HIGH, 'PACKAGE_JSON_PARSE', pkgPath, 'package.json cannot be parsed.', String(err.message || err));
  }
}

const lockPath = path.join(root, 'package-lock.json');
if (fs.existsSync(lockPath)) {
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const installScriptPkgs = [];
    for (const [name, meta] of Object.entries(lock.packages || {})) {
      if (meta && meta.hasInstallScript) installScriptPkgs.push(name || '(root)');
      if (meta?.resolved && /^(?!https:\/\/registry\.npmjs\.org\/)/i.test(meta.resolved) && /^https?:/i.test(meta.resolved)) {
        add(MEDIUM, 'LOCK_EXTERNAL_SOURCE', lockPath, 'package-lock contains a dependency resolved outside registry.npmjs.org.', `${name}: ${meta.resolved}`);
      }
    }
    if (installScriptPkgs.length) {
      add(LOW, 'TRANSITIVE_INSTALL_SCRIPTS', lockPath,
        `${installScriptPkgs.length} locked package(s) declare install scripts. Review before installing an untrusted lockfile.`, installScriptPkgs.slice(0, 20).join(', '));
    }
  } catch (err) {
    add(MEDIUM, 'LOCK_PARSE', lockPath, 'package-lock.json could not be parsed.', String(err.message || err));
  }
}

// Additional risky host mounts / docker config
for (const name of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
  const p = path.join(root, name);
  if (!fs.existsSync(p)) continue;
  const text = fs.readFileSync(p, 'utf8');
  if (/docker\.sock|\.ssh|\.aws|\.config\/gcloud|\/home\/|~\//i.test(text)) {
    add(HIGH, 'DOCKER_HOST_MOUNT', p, 'Docker/Compose config appears to mount sensitive host paths or Docker socket.');
  } else add(LOW, 'DOCKER_CONFIG', p, 'Docker/Compose configuration is present; review commands and mounts before use.');
}

const severityRank = { HIGH: 0, MEDIUM: 1, LOW: 2, INFO: 3 };
findings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || a.file.localeCompare(b.file));
const counts = Object.fromEntries([HIGH, MEDIUM, LOW, INFO].map((s) => [s, findings.filter((f) => f.severity === s).length]));
const digest = crypto.createHash('sha256').update(JSON.stringify(findings)).digest('hex');
const result = {
  tool: 'ERP Agent Repo Safety Audit',
  version: '1.0.0',
  target: root,
  generatedAt: new Date().toISOString(),
  counts,
  findingDigestSha256: digest,
  verdict: counts.HIGH ? 'BLOCK' : counts.MEDIUM ? 'REVIEW' : 'PASS',
  findings,
};

if (jsonMode) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log('ERP Agent Repo Safety Audit');
  console.log('===========================');
  console.log(`Target : ${root}`);
  console.log(`Verdict: ${result.verdict}`);
  console.log(`HIGH ${counts.HIGH} | MEDIUM ${counts.MEDIUM} | LOW ${counts.LOW} | INFO ${counts.INFO}`);
  console.log('');
  if (!findings.length) console.log('No risky repository-controlled agent/config/script patterns were detected.');
  for (const f of findings) {
    console.log(`[${f.severity}] ${f.code} ${f.file || '.'}`);
    console.log(`  ${f.message}`);
    if (f.detail) console.log(`  detail: ${String(f.detail).slice(0, 500)}`);
  }
  console.log('');
  console.log('Rule: BLOCK means do not open an AI coding agent in this repo until findings are reviewed/removed.');
}

if (counts.HIGH > 0) process.exit(2);
if (failOnWarn && counts.MEDIUM > 0) process.exit(1);
process.exit(0);
