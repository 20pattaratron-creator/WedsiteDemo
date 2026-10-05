// ADR-019 (round 6): bigger controls and a more readable sidebar, defined once as tokens in erp-ui.css.
//   1. the button / control tokens (42 / 36 px, 15 / 14 px text, 18 / 16 px icons, 44 px on ≤ 900 px);
//   2. the control families read those tokens instead of fixed sizes;
//   3. the sidebar: 15 px entries, 13 px headings, 20 px icons, ≥ 40 px rows, the drawer uses the same;
//   4. the section headings reach WCAG AA contrast (≥ 4.5:1) on the sidebar background;
//   5. no app stylesheet (not *-document.css) gives an interactive control a font size below 12 px,
//      and no inline style in index.html / the JS templates makes a control's text smaller than 14 px.
// Pure tests over the CSS text: jsdom does not resolve var() or media queries in getComputedStyle, so a
// computed-style test would not see these sizes. The rendered sizes were measured in Chromium (ADR-019).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

// ------------------------------------------------------------------ a small CSS reader
// → [{ selector, body, decls: Map(prop → value), media }] for every style rule, nested in @media or not.
function cssRules(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const stack = [];
  let buf = '';
  for (const c of src) {
    if (c === '{') { stack.push(buf.trim()); buf = ''; continue; }
    if (c === '}') {
      const head = stack.pop();
      if (head !== undefined && !head.startsWith('@') && buf.trim()) {
        const decls = new Map();
        for (const part of buf.split(';')) {
          const i = part.indexOf(':');
          if (i > 0) decls.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim());
        }
        rules.push({ selector: head.replace(/\s+/g, ' '), body: buf.trim(), decls, media: stack.filter(s => s.startsWith('@')).join(' ') });
      }
      buf = '';
      continue;
    }
    buf += c;
  }
  return rules;
}
// Split a selector list on top-level commas (not inside :is() / :not() / [ ]).
function splitSelectors(list) {
  const out = [];
  let depth = 0, cur = '';
  for (const c of list) {
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const ruleFor = (rules, selector, media = '') => rules.filter(r => splitSelectors(r.selector).includes(selector) && r.media === media);
const decl = (rule, prop) => (rule.decls.get(prop) || '').replace(/\s*!important$/, '');
const px = value => { const m = /^(-?[\d.]+)px$/.exec(String(value).trim()); return m ? Number(m[1]) : NaN; };
// The :root custom properties of a stylesheet: { base: {…}, '≤900': {…} }.
function rootTokens(css) {
  const out = { base: {}, phone: {} };
  for (const r of cssRules(css)) {
    if (r.selector !== ':root') continue;
    const target = r.media === '' ? out.base : /max-width:\s*900px/.test(r.media) ? out.phone : null;
    if (!target) continue;
    for (const [k, v] of r.decls) if (k.startsWith('--')) target[k] = v;
  }
  return out;
}
const APP_CSS = fs.readdirSync(ROOT).filter(f => f.endsWith('.css') && !f.endsWith('-document.css')).sort();

// ------------------------------------------------------------------ 1. tokens
test('ADR-019: button and control tokens — 42 / 36 px, 15 / 14 px text, 18 / 16 px icons; 44 px tap targets on ≤ 900 px', () => {
  const { base, phone } = rootTokens(read('erp-ui.css'));
  const expected = {
    '--erp-btn-height': '42px', '--erp-btn-height-sm': '36px',
    '--erp-btn-font-size': '15px', '--erp-btn-font-size-sm': '14px',
    '--erp-btn-icon-size': '18px', '--erp-btn-icon-size-sm': '16px',
    '--erp-touch-target': '44px', '--erp-control-font-size': '14px',
    '--erp-control-height': 'var(--erp-btn-height)', '--erp-control-height-sm': 'var(--erp-btn-height-sm)',
    '--erp-icon-btn-size': 'var(--erp-btn-height-sm)', '--erp-tab-height': '40px', '--erp-menu-item-height': '40px',
    '--erp-check-size': '20px'
  };
  for (const [token, value] of Object.entries(expected)) assert.equal(base[token], value, token);
  // ≤ 900 px: every control family token becomes the 44 px tap target.
  for (const token of ['--erp-control-height', '--erp-control-height-sm', '--erp-tab-height', '--erp-icon-btn-size', '--erp-menu-item-height']) {
    assert.equal(phone[token], 'var(--erp-touch-target)', `${token} on ≤ 900 px`);
  }
  const rules = cssRules(read('erp-ui.css'));
  const btn = ruleFor(rules, '.btn')[0];
  assert.equal(decl(btn, 'min-height'), 'var(--erp-btn-height)');
  assert.equal(decl(btn, 'font-size'), 'var(--erp-btn-font-size)');
  const sm = ruleFor(rules, '.btn.btn-sm')[0];
  assert.equal(decl(sm, 'min-height'), 'var(--erp-btn-height-sm)');
  assert.equal(decl(sm, 'font-size'), 'var(--erp-btn-font-size-sm)');
  assert.equal(decl(ruleFor(rules, '.btn .erp-icon')[0], 'width'), 'var(--erp-btn-icon-size)');
  assert.equal(decl(ruleFor(rules, '.btn.btn-sm .erp-icon')[0], 'width'), 'var(--erp-btn-icon-size-sm)');
  const phoneBtn = rules.find(r => /max-width:900px/.test(r.media) && r.selector === '.btn' && r.decls.has('min-width'));
  assert.ok(phoneBtn && decl(phoneBtn, 'min-width') === 'var(--erp-touch-target)', 'phones: a one-word button is ≥ 44 px wide too');
});

// ------------------------------------------------------------------ 2. families use the tokens
test('ADR-019: tabs, chips, menus, row "⋯", icon buttons, selects and checkboxes read the tokens (no fixed smaller size)', () => {
  const checks = [
    ['erp-ui.css', '.erp-menu-item', { 'min-height': 'var(--erp-menu-item-height)' }],
    ['erp-ui.css', '.erp-menu', { 'font-size': 'var(--erp-btn-font-size)' }],
    ['erp-ui.css', '.erp-rowact-more', { 'min-width': 'var(--erp-icon-btn-size)', height: 'var(--erp-icon-btn-size)' }],
    ['erp-ui.css', '.nav-back-link', { 'min-height': 'var(--erp-btn-height-sm)', 'font-size': 'var(--erp-control-font-size)' }],
    ['erp-ui.css', '.dtab', { 'min-height': 'var(--erp-tab-height)' }],
    ['erp-ui.css', '.erp-check-label', { 'min-height': 'var(--erp-control-height-sm)', 'font-size': 'var(--erp-control-font-size)' }],
    ['style.css', '.dtab', { 'font-size': 'var(--erp-control-font-size)' }],
    ['style.css', '.filter-bar select', { 'min-height': 'var(--erp-control-height-sm)', 'font-size': 'var(--erp-control-font-size)' }],
    ['style.css', '.doc-entry-tabs button', { 'min-height': 'var(--erp-tab-height)', 'font-size': 'var(--erp-control-font-size)' }],
    ['style.css', '.doc-entry-zoom button', { width: 'var(--erp-icon-btn-size)', height: 'var(--erp-icon-btn-size)' }],
    ['style.css', '.doc-entry-zoom button[data-zoom="fit"]', { 'font-size': 'var(--erp-control-font-size)' }],
    ['style.css', '.pay-check input', { width: 'var(--erp-check-size)', height: 'var(--erp-check-size)' }],
    ['style.css', '.doc-number-auto-btn', { 'min-height': 'var(--erp-control-height)', 'font-size': 'var(--erp-control-font-size)' }],
    ['style.css', '.linked-branch-switch button', { 'min-height': 'var(--erp-tab-height)', 'font-size': 'var(--erp-control-font-size)' }],
    ['erp-customer-experience.css', '.erp-dashboard-views button', { 'min-height': 'var(--erp-tab-height)', 'font-size': 'var(--erp-control-font-size)' }],
    ['local-demo-mode.css', '.erp-demo-menu-btn', { 'min-height': 'var(--erp-control-height-sm)', 'font-size': 'var(--erp-control-font-size)' }],
    ['erp-product-experience.css', '.pe-mode-toggle', { 'min-height': 'var(--erp-control-height-sm)', 'font-size': 'var(--erp-control-font-size)' }],
    ['business-rules.css', '.quote-price-rule-btn', { 'min-height': 'var(--erp-control-height-sm)', 'font-size': 'var(--erp-control-font-size)' }],
    ['erp-receivables.css', '.ar-aging-toggle', { 'min-height': 'var(--erp-control-height-sm)' }],
    ['erp-order-flow.css', '.erp-flow-modal-x', { width: 'var(--erp-icon-btn-size)', height: 'var(--erp-icon-btn-size)' }]
  ];
  for (const [file, selector, props] of checks) {
    const rule = ruleFor(cssRules(read(file)), selector).find(r => Object.keys(props).every(p => r.decls.has(p)));
    assert.ok(rule, `${file}: ${selector} declares ${Object.keys(props).join(', ')}`);
    for (const [prop, value] of Object.entries(props)) assert.equal(decl(rule, prop), value, `${file}: ${selector} ${prop}`);
  }
  // The floors: checkboxes 20 px, selects / text fields ≥ a small button, close × buttons = icon buttons.
  const ui = read('erp-ui.css');
  assert.match(ui, /input:is\(\[type="checkbox"\],\[type="radio"\]\)[^{]*\{width:var\(--erp-check-size\);height:var\(--erp-check-size\)/);
  assert.match(ui, /:where\(select,input:not\(\[type\]\),input\[type="text"\][^{]*\{min-height:var\(--erp-control-height-sm\);font-size:var\(--erp-control-font-size\)\}/);
  assert.match(ui, /:is\(\.modal-close,\.ar-alert-close,[^)]*\)\{[^}]*min-width:var\(--erp-icon-btn-size\);min-height:var\(--erp-icon-btn-size\)\}/);
  // The floors leave the document screens and printable pages alone.
  for (const m of ui.matchAll(/:where\(\.main>\.panel:not\(([^)]*)\)/g)) assert.equal(m[1], '#panel-delivery-tax-doc,#panel-receipt-doc,#panel-quotation-document');
});

// ------------------------------------------------------------------ 3. sidebar
test('ADR-019: sidebar entries 15 px / line height 1.45 / ≥ 40 px rows / 20 px icons, headings 13 px, the same in the ☰ drawer', () => {
  const { base, phone } = rootTokens(read('erp-ui.css'));
  assert.equal(base['--erp-nav-font-size'], '15px');
  assert.equal(base['--erp-nav-line-height'], '1.45');
  assert.ok(px(base['--erp-nav-row-height']) >= 40, 'row height');
  assert.equal(base['--erp-nav-icon-size'], '20px');
  assert.equal(base['--erp-nav-heading-font-size'], '13px');
  assert.ok(px(base['--erp-nav-heading-height']) >= 36);
  assert.equal(phone['--erp-nav-heading-height'], 'var(--erp-touch-target)');
  assert.equal(base['--erp-nav-badge-font-size'], '12px');
  const ui = cssRules(read('erp-ui.css'));
  const entry = ui.find(r => r.selector === '.sidebar .nav-item' && /min-width:901px/.test(r.media));
  assert.ok(entry, 'desktop entry rule');
  assert.equal(decl(entry, 'font-size'), 'var(--erp-nav-font-size)');
  assert.equal(decl(entry, 'line-height'), 'var(--erp-nav-line-height)');
  assert.equal(decl(entry, 'min-height'), 'var(--erp-nav-row-height)');
  assert.equal(decl(ruleFor(ui, '.sidebar .nav-item svg')[0], 'width'), 'var(--erp-nav-icon-size)');
  const heading = ruleFor(ui, '.sidebar .nav-group>.nav-group-toggle')[0];
  assert.equal(decl(heading, 'font-size'), 'var(--erp-nav-heading-font-size)');
  assert.equal(decl(heading, 'color'), 'var(--erp-nav-heading-fg)');
  assert.equal(decl(heading, 'min-height'), 'var(--erp-nav-heading-height)');
  // The ☰ drawer (style.css, ≤ 900 px) uses the same tokens instead of its own 15 / 19 / 11 px.
  const drawer = cssRules(read('style.css')).filter(r => /max-width:\s*900px/.test(r.media));
  const item = drawer.filter(r => r.selector === '.sidebar .nav-item' && r.decls.has('font-size')).pop();
  assert.equal(decl(item, 'font-size'), 'var(--erp-nav-font-size)');
  assert.equal(decl(item, 'line-height'), 'var(--erp-nav-line-height)');
  assert.equal(decl(drawer.filter(r => r.selector === '.sidebar .nav-item svg').pop(), 'width'), 'var(--erp-nav-icon-size)');
  const sec = drawer.filter(r => r.selector === '.sidebar .nav-sec').pop();
  assert.equal(decl(sec, 'font-size'), 'var(--erp-nav-heading-font-size)');
  assert.equal(decl(sec, 'color'), 'var(--erp-nav-heading-fg)');
  // The count badge of an entry scales with it.
  const badge = ruleFor(cssRules(read('erp-receivables.css')), '.ar-nav-badge')[0];
  assert.equal(decl(badge, 'font-size'), 'var(--erp-nav-badge-font-size)');
  assert.equal(decl(badge, 'height'), 'var(--erp-nav-badge-size)');
  // 15 px keeps the 245 px sidebar (the longest entry fits on one line at 1366 px — measured, ADR-019).
  assert.match(read('style.css'), /\.layout\{grid-template-columns:245px 1fr;/);
});

// ------------------------------------------------------------------ 4. contrast
function luminance(hex) {
  const [r, g, b] = hex.replace('#', '').match(/../g).map(x => parseInt(x, 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function specificity(selector) {
  const s = selector.replace(/::?[\w-]+(\([^)]*\))?/g, m => (m.startsWith('::') ? ' ' : '.x'));
  return [(s.match(/#[\w-]+/g) || []).length, (s.match(/\.[\w-]+|\[[^\]]+\]/g) || []).length, (s.match(/(^|[\s>+~])[a-z]+/gi) || []).length];
}
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

test('ADR-019: sidebar section headings reach WCAG AA contrast (≥ 4.5:1) on the sidebar background; no other heading colour wins', () => {
  const fg = rootTokens(read('erp-ui.css')).base['--erp-nav-heading-fg'];
  assert.match(fg || '', /^#[0-9a-f]{6}$/i, 'a plain hex colour');
  // Sidebar background: white at the top → rgba(249,253,254,.98) at the bottom (style.css); hover is #f1f5f9 with #0f172a text.
  for (const bg of ['#ffffff', '#f9fdfe']) assert.ok(contrast(fg, bg) >= 4.5, `${fg} on ${bg}: ${contrast(fg, bg).toFixed(2)}:1`);
  assert.ok(contrast('#0f172a', '#f1f5f9') >= 4.5, 'hover');
  // Every rule that colours the headings with !important is weaker than the token rule of erp-ui.css.
  const winner = specificity('.sidebar .nav-group>.nav-group-toggle');
  for (const file of APP_CSS) {
    for (const r of cssRules(read(file))) {
      const color = r.decls.get('color') || '';
      if (!/!important/.test(color) || /var\(--erp-nav-heading-fg\)/.test(color)) continue;
      for (const sel of splitSelectors(r.selector)) {
        if (!/\.nav-sec\b|\.nav-group-toggle\b/.test(sel) || /:hover|:focus/.test(sel)) continue;
        assert.ok(cmp(specificity(sel), winner) < 0 || (file === 'erp-ui.css'), `${file}: "${sel}" (${color}) must not win over the heading token`);
      }
    }
  }
});

// ------------------------------------------------------------------ 5. no tiny control text
// A selector targets an interactive control when its last compound (after the last combinator) is one.
const CONTROL_COMPOUND = /^(button|select|input|textarea)\b|\.btn\b|\[role=["']?(button|tab|menuitem)|\.(nav-item|nav-sec|nav-group-toggle|dtab|br-opt|erp-menu-item|erp-rowact-[\w-]+|erp-item-remove|erp-search-result|erp-check-label|pe-action|brules-preset|brules-mini-btn|erp-flow-queue-metric|erp-next-action|ar-aging-link|ar-aging-toggle)\b|-(btn|button|toggle|close|x)\b/;
function lastCompound(selector) {
  const parts = selector.replace(/\([^)]*\)/g, m => m.replace(/[\s>+~]/g, '')).split(/\s*[\s>+~]\s*/).filter(Boolean);
  return parts[parts.length - 1] || '';
}
function isControlSelector(selector) {
  if (/::(before|after|placeholder|marker)/.test(selector)) return false;
  return CONTROL_COMPOUND.test(lastCompound(selector));
}
function fontPx(value) {
  const v = String(value || '').replace(/!important/, '').trim();
  let m = /(?:^|\s)([\d.]+)px\b/.exec(v);
  if (m) return Number(m[1]);
  m = /(?:^|\s)([\d.]+)rem\b/.exec(v);
  return m ? Number(m[1]) * 16 : NaN;
}

test('ADR-019: no app stylesheet (not *-document.css) gives an interactive control a font size below 12 px', () => {
  const offenders = [];
  for (const file of APP_CSS) {
    for (const r of cssRules(read(file))) {
      const size = Math.min(...[fontPx(r.decls.get('font-size')), fontPx(r.decls.get('font'))].filter(Number.isFinite));
      if (!(size < 12)) continue;
      for (const sel of splitSelectors(r.selector)) if (isControlSelector(sel)) offenders.push(`${file}: ${sel} → ${size}px`);
    }
  }
  assert.deepEqual(offenders, []);
  // The guard itself recognises controls and ignores their parts.
  assert.ok(isControlSelector('.quote-price-rule-btn') && isControlSelector('#panel-x .filter-bar select') && isControlSelector('.erp-dashboard-views button[aria-selected="true"]'));
  assert.ok(!isControlSelector('.erp-global-search-btn kbd') && !isControlSelector('.audit-action') && !isControlSelector('.nav-group-toggle::after'));
});

test('ADR-019: inline styles in index.html and the JS templates do not make a control\'s text smaller than 14 px', () => {
  const sources = ['index.html', ...fs.readdirSync(ROOT).filter(f => f.endsWith('.js') && !f.endsWith('-document.js') && f !== 'vite.config.js')];
  const offenders = [];
  for (const file of sources) {
    const src = read(file);
    // <button|select|input …style="…font-size:Npx…"> and a <label style="…"> that wraps a checkbox / radio.
    for (const m of src.matchAll(/<(button|select|input|label)\b([^>]*?)\bstyle="([^"]*)"([^>]*)>/g)) {
      const size = fontPx((/font-size:\s*([^;]+)/.exec(m[3]) || [])[1]);
      if (!(size < 14)) continue;
      if (m[1] === 'label' && !/^\s*<input[^>]*type="(checkbox|radio)"/.test(src.slice(m.index + m[0].length, m.index + m[0].length + 200))) continue;
      offenders.push(`${file}: <${m[1]} style="${m[3]}">`);
    }
  }
  assert.deepEqual(offenders, []);
});
