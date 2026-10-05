// ADR-013 (Task B): PDF export must work at a customer site without internet.
// html2canvas 1.4.1 and jsPDF 2.5.1 ship in vendor/ and index.html loads no script
// from another host. Built outputs are checked by tests/deployment.check.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const manifest = JSON.parse(read('vendor/vendor-manifest.json'));

test('index.html loads no <script src> from an external host', () => {
  const dom = new JSDOM(read('index.html'));
  try {
    const sources = [...dom.window.document.querySelectorAll('script[src]')].map(el => el.getAttribute('src'));
    assert.ok(sources.length > 20);
    const external = sources.filter(src => /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(src));
    assert.deepEqual(external, [], 'every script is served with the app');
    // PDF libraries are eager <script> tags; SheetJS (ADR-021) is lazy: named by a <meta>, loaded on the first Excel export.
    for (const lib of manifest.libraries.filter(lib => lib.loading !== 'lazy')) assert.ok(sources.includes(`./vendor/${lib.file}`), lib.file);
    for (const lib of manifest.libraries.filter(lib => lib.loading === 'lazy')) {
      assert.ok(!sources.some(src => src.includes(lib.file)), `${lib.file} is not loaded at boot`);
      assert.equal(dom.window.document.querySelector(`meta[name="${lib.htmlMeta}"]`)?.getAttribute('content'), `./vendor/${lib.file}`);
    }
    // Classic scripts, before the printable-document modules that read the globals.
    const order = sources.map(src => src.replace(/^\.\//, ''));
    assert.ok(order.indexOf(`vendor/${manifest.libraries[1].file}`) < order.indexOf('delivery-tax-document.js'));
  } finally { dom.window.close(); }
});

test('vendored libraries are the exact npm releases, with their licenses (MIT; SheetJS Apache-2.0)', () => {
  assert.deepEqual(manifest.libraries.map(lib => `${lib.name}@${lib.version}`), ['html2canvas@1.4.1', 'jspdf@2.5.1', 'xlsx@0.18.5']);
  for (const lib of manifest.libraries) {
    const bytes = fs.readFileSync(path.join(ROOT, 'vendor', lib.file));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), lib.sha256, lib.file);
    if (lib.name === 'xlsx') {
      assert.match(bytes.subarray(0, 120).toString('utf8'), /xlsx\.js \(C\) 2013-present SheetJS/, 'SheetJS banner');
      assert.match(bytes.toString('utf8'), /version="0\.18\.5"/, 'version');
      assert.equal(lib.license, 'Apache-2.0');
      assert.match(fs.readFileSync(path.join(ROOT, 'vendor', lib.licenseFile), 'utf8'), /Apache License\s+Version 2\.0, January 2004/);
      continue;
    }
    assert.match(bytes.subarray(0, 400).toString('utf8'), new RegExp(`${lib.name === 'jspdf' ? 'jsPDF' : 'html2canvas'}[\\s\\S]*${lib.version.replace(/\./g, '\\.')}`), 'version banner');
    assert.equal(lib.license, 'MIT');
    assert.match(fs.readFileSync(path.join(ROOT, 'vendor', lib.licenseFile), 'utf8'), /Permission is hereby granted, free of charge/);
  }
});

test('the UMD bundles still define the same globals the document modules use', () => {
  // jsPDF probes <canvas> support while loading; jsdom has none, so its "not implemented" notice is muted.
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  try {
    for (const lib of manifest.libraries) dom.window.eval(read(`vendor/${lib.file}`));
    assert.equal(typeof dom.window.html2canvas, 'function');
    assert.equal(typeof dom.window.jspdf?.jsPDF, 'function');
  } finally { dom.window.close(); }
  for (const file of ['delivery-tax-document.js', 'quotation-document.js', 'receipt-document.js', 'credit-note-document.js']) {
    const src = read(file);
    assert.match(src, /window\.html2canvas/, file);
    assert.match(src, /window\.jspdf\?\.jsPDF/, file);
  }
});

test('build copies the vendor files for dist and dist-flat; audits and the demo health check know them', () => {
  const vite = read('vite.config.js');
  assert.match(vite, /vendor-manifest\.json/);
  assert.match(vite, /emitFile/);
  assert.match(read('scripts/build-deployment-check.mjs'), /js\|css\|png\|txt/);
  for (const file of ['scripts/audit-complexity.mjs', 'scripts/audit-deep.mjs']) assert.match(read(file), /startsWith\('vendor\/'\)/, file);
  assert.match(read('local-demo-health.js'), /typeof window\.html2canvas==='function'&&typeof window\.jspdf\?\.jsPDF==='function'/);
});
