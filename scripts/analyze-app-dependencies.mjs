import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');
const appPath = path.join(root, 'app.js');
const htmlPath = path.join(root, 'index.html');
const app = fs.readFileSync(appPath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');

function lineOf(index) {
  return app.slice(0, index).split('\n').length;
}

// Function boundaries are estimated from the next top-level declaration.
// This intentionally avoids pretending to be a full JavaScript parser.

const matches = [];
const re = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
let match;
while ((match = re.exec(app))) matches.push({ name: match[1], index: match.index });
const declarations = matches.map((row, i) => {
  const end = matches[i + 1]?.index ?? app.length;
  return {
    name: row.name,
    line: lineOf(row.index),
    endLine: Math.max(lineOf(row.index), lineOf(end) - 1),
    body: app.slice(row.index, end)
  };
});
const names = new Set(declarations.map(x => x.name));
const inlineHandlerText = [...html.matchAll(/\bon(?:click|change|input|submit|keyup|keydown)\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]).join('\n');

function occurrences(name) {
  const rx = new RegExp(`\\b${name.replace(/[$]/g, '\\$&')}\\b`, 'g');
  return (app.match(rx) || []).length;
}
function callsWithin(body) {
  const out = [];
  for (const name of names) {
    if (new RegExp(`\\b${name.replace(/[$]/g, '\\$&')}\\s*\\(`).test(body.replace(new RegExp(`function\\s+${name}\\s*\\(`), ''))) out.push(name);
  }
  return out;
}
function flags(body) {
  return {
    dom: /\bdocument\.|\bHTMLElement\b|querySelector|getElementById/.test(body),
    storage: /\blocalStorage\b|readLocalMaster|writeLocalMaster|tenantLocalKey/.test(body),
    window: /\bwindow\./.test(body),
    networkCloud: /Firebase|Firestore|fetch\(|syncFromFirebase|Cloud/.test(body),
    userInteraction: /\bnotify\(|\bconfirm\(|\bprompt\(/.test(body),
    finance: /VAT|vat|subtotal|total|price|cost|margin|payment|invoice/i.test(body)
  };
}
const rows = declarations.map(fn => {
  const f = flags(fn.body);
  const externalFlags = Object.values(f).filter(Boolean).length;
  const inline = new RegExp(`\\b${fn.name.replace(/[$]/g, '\\$&')}\\s*\\(`).test(inlineHandlerText);
  return {
    name: fn.name,
    line: fn.line,
    endLine: fn.endLine,
    lines: Math.max(1, fn.endLine - fn.line + 1),
    referencesInApp: occurrences(fn.name),
    calledFromInlineHtml: inline,
    calls: callsWithin(fn.body),
    coupling: f,
    couplingScore: externalFlags + (inline ? 2 : 0)
  };
}).sort((a,b) => a.line - b.line);

const calendarNames = ['toCEYear','toBEYear','yearLabelBE','yearLabelDual','parseFlexibleBusinessDate','isoDateCEFromValue','formatThaiDate','makeThaiCalendarMeta','withThaiCalendarMeta'];
const calendarRefs = Object.fromEntries(calendarNames.map(name => [name, (app.match(new RegExp(`\\b${name}\\b`, 'g')) || []).length]));

const masterRange = app.slice(app.indexOf('function normalizeProductKey'), app.indexOf('const CUSTOMER_AGENCY_GROUPS'));
const masterSummary = {
  approximateLines: masterRange.split('\n').length,
  touchesDom: /document\.|getElementById/.test(masterRange),
  touchesStorage: /localStorage|readLocalMaster|writeLocalMaster/.test(masterRange),
  touchesWindow: /window\./.test(masterRange),
  touchesCloud: /Cloud|cloud|Firebase|Firestore/.test(masterRange),
  userInteraction: /notify\(|confirm\(/.test(masterRange)
};

const result = {
  generatedAt: new Date().toISOString(),
  release: '4.3.1-step2a',
  appJsLines: app.split('\n').length,
  topLevelFunctionCount: rows.length,
  inlineHandlerCount: [...html.matchAll(/\bon(?:click|change|input|submit|keyup|keydown)\s*=/gi)].length,
  selectedFirstExtraction: {
    module: 'erp-date-core.js',
    reason: 'Low coupling: business-date/calendar logic is DOM/storage independent and heavily reused inside app.js.',
    appReferencesAfterExtraction: calendarRefs
  },
  deferredCandidate: {
    domain: 'master-data',
    reason: 'Deferred until a later micro-step because it currently couples storage, DOM, cloud sync and analytics refresh behavior.',
    coupling: masterSummary
  },
  functions: rows
};
fs.writeFileSync(path.join(root, 'APP_JS_DEPENDENCY_MAP_4_3_1_STEP2A.json'), JSON.stringify(result, null, 2) + '\n');

const risky = [...rows].sort((a,b) => b.couplingScore - a.couplingScore || b.lines - a.lines).slice(0, 20);
const md = `# APP.JS Dependency Map — ERP 4.3.1 Step 2A\n\n` +
`Generated: ${result.generatedAt}\n\n` +
`## Baseline\n\n- app.js: ${result.appJsLines} lines after first extraction\n- Top-level function declarations: ${result.topLevelFunctionCount}\n- Inline HTML handlers detected: ${result.inlineHandlerCount}\n\n` +
`## First extraction decision\n\n` +
`Selected **erp-date-core.js** first because the date/calendar helpers are reusable business logic with no direct DOM/localStorage dependency. Existing function names are imported back into app.js so call sites stay unchanged.\n\n` +
`The **master-data** domain is intentionally deferred: the current block touches DOM=${masterSummary.touchesDom}, storage=${masterSummary.touchesStorage}, window=${masterSummary.touchesWindow}, cloud=${masterSummary.touchesCloud}, user interaction=${masterSummary.userInteraction}. It should be split behind a storage/service boundary before UI code is moved.\n\n` +
`## Highest-coupling functions (static heuristic)\n\n| Function | Lines | App refs | Inline HTML | Coupling score |\n|---|---:|---:|:---:|---:|\n` +
 risky.map(r => `| \`${r.name}\` | ${r.lines} | ${r.referencesInApp} | ${r.calledFromInlineHtml ? 'yes' : 'no'} | ${r.couplingScore} |`).join('\n') +
`\n\n## Guardrail for the next extraction\n\n1. Add regression tests before moving a domain.\n2. Keep old public function names/call signatures stable.\n3. Move pure/service logic before DOM rendering code.\n4. Run core tests + code/deep/spec/complexity/security audits after every micro-step.\n5. Do not combine CSS cleanup or new product features with app.js extraction.\n`;
fs.writeFileSync(path.join(root, 'APP_JS_DEPENDENCY_MAP_4_3_1_STEP2A_TH.md'), md);
console.log(`Dependency map written: functions=${rows.length}, appLines=${result.appJsLines}`);
