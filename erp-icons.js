// ============================================================================
// erp-icons.js — the one line-icon set of the app's controls
// ERP DEMO 4.3.1 · ADR-017 (round 5, part C of the UI declutter)
// ----------------------------------------------------------------------------
// Buttons, menu items, toolbars, the sidebar and the header "Demo" menu used to mix emoji
// (💾 👁 🖨️ ⬇ 📄 ✏️ …) with the line SVG icons of part A (ADR-015). Every control icon now
// comes from here: 24×24 viewBox, no fill, 2 px round stroke in currentColor — the style of
// part A's sidebar icons, whose drawings moved into this file (no second copy is kept).
//
//   icon(name, className?) → '<svg class="erp-icon …" aria-hidden="true" focusable="false">
//                              <use href="#erp-i-NAME"></use></svg>'   ('' for an unknown name)
//   ICON_NAMES              → every name, e.g. for tests
//   ensureIconSprite(doc)   → puts the 0×0 <svg id="erp-icon-sprite"> with one <symbol> per
//                             icon at the end of <body> once (idempotent; also run on import)
//
// Icons are decorative: the control keeps its text label (or its aria-label), so the icon is
// always aria-hidden and never focusable. Static markup in index.html uses the same
// <svg class="erp-icon" …><use href="#erp-i-NAME"/></svg> form, so one drawing serves both.
// Out of scope (ADR-017): the printed / PDF document pages (*-document.js page HTML and
// *-document.css are guarded by `npm run audit:render-golden`), toast message text and data.
// Plain script users (erp-production-core.js runs in vm tests without imports) read
// window.ERPIcons.icon.
// ============================================================================

export const ICONS_VERSION = '1.0.0';
export const ICON_SPRITE_ID = 'erp-icon-sprite';
const ICON_ID_PREFIX = 'erp-i-';

// name → the inner SVG drawing (constant markup, never user data).
const ICON_PATHS = Object.freeze({
  // --- actions
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
  preview: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  print: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/>',
  // part A: the "สำรองข้อมูล" item of the Demo menu
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  // part A: "ล้างข้อมูลสาธิตทั้งหมด (รีเซ็ต)"
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  back: '<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>',
  forward: '<path d="M5 12h14"/><path d="M12 5l7 7-7 7"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  attach: '<path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  cancel: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  payment: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  // DECISION REVIEW (Decision Council)
  review: '<circle cx="12" cy="12" r="10"/><path d="M16.2 7.8l-2.1 6.3-6.3 2.1 2.1-6.3z"/>',
  // --- documents and screens (part A sidebar drawings)
  dashboard: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  analytics: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-7"/>',
  document: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>',
  truck: '<path d="M1 3h15v13H1z"/><path d="M16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  receipt: '<path d="M5 2h14v20l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
  'credit-note': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 15h6"/>',
  factory: '<path d="M3 21h18"/><path d="M5 21V7l8 4V7l8 4v10"/><path d="M9 17h1M14 17h1M19 17h1"/>',
  cart: '<path d="M6 2l1 4h12l-2 8H8L6 2H3"/><circle cx="9" cy="20" r="1"/><circle cx="17" cy="20" r="1"/>',
  box: '<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>',
  inventory: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v5M16 4v5"/>',
  wallet: '<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  trace: '<circle cx="5" cy="12" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="12" cy="19" r="2"/><path d="M7 11l3.5-4M13.5 7L17 11M17 13l-3.5 4M10.5 17L7 13"/>',
  contacts: '<circle cx="8" cy="8" r="3"/><path d="M2 21v-2a6 6 0 0 1 12 0v2"/><rect x="15" y="4" width="7" height="7" rx="1"/><path d="M16 16h6M16 20h6"/>',
  rules: '<path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h3M14 12h2M8 16h8"/>',
  company: '<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/><path d="M9 9h.01M15 9h.01"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  // part A: entries created by erp-product-experience.js / erp-order-flow.js
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
  approval: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 14 0v1"/>',
  transfer: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  // part A: the header "Demo" menu
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  guide: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  health: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  // part A: "โหลดข้อมูลตัวอย่างสำหรับสาธิต"
  chart: '<path d="M3 3v18h18"/><path d="M7 16v-4M12 16V8M17 16v-6"/>'
});

export const ICON_NAMES = Object.freeze(Object.keys(ICON_PATHS));

// Stroke style on the outer <svg>: the <use>d drawing inherits it (fill, stroke, width, caps).
const ICON_SVG_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';

export function hasIcon(name) {
  return Object.prototype.hasOwnProperty.call(ICON_PATHS, String(name ?? ''));
}

// Markup of one icon, '' for an unknown name (a control then simply shows its label).
// `className` adds classes after "erp-icon" (constant strings from our own code only).
export function icon(name, className = '') {
  const key = String(name ?? '');
  if (!hasIcon(key)) return '';
  const extra = String(className || '').replace(/[^\w -]/g, '').trim();
  return `<svg class="erp-icon${extra ? ` ${extra}` : ''}" ${ICON_SVG_ATTRS}><use href="#${ICON_ID_PREFIX}${key}"></use></svg>`;
}

// The sprite: one <symbol> per icon, in a 0×0 <svg> (not display:none, which some browsers
// treat as "no drawing" for <use> references).
export function iconSpriteMarkup() {
  const symbols = ICON_NAMES.map(name => `<symbol id="${ICON_ID_PREFIX}${name}" viewBox="0 0 24 24">${ICON_PATHS[name]}</symbol>`).join('');
  return `<svg id="${ICON_SPRITE_ID}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" style="position:absolute;width:0;height:0;overflow:hidden">${symbols}</svg>`;
}

// Adds the sprite once to `doc` (at the end of <body>). Safe to call often.
export function ensureIconSprite(doc = typeof document === 'undefined' ? null : document) {
  // Plain-object stand-ins for document (vm tests) have no DOM methods: nothing to do there.
  if (typeof doc?.body?.insertAdjacentHTML !== 'function' || typeof doc.getElementById !== 'function') return false;
  if (doc.getElementById(ICON_SPRITE_ID)) return false;
  doc.body.insertAdjacentHTML('beforeend', iconSpriteMarkup());
  return true;
}

export const ERPIcons = Object.freeze({ VERSION: ICONS_VERSION, NAMES: ICON_NAMES, icon, hasIcon, ensureIconSprite });

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.body) ensureIconSprite(document);
  else document.addEventListener?.('DOMContentLoaded', () => ensureIconSprite(document), { once: true });
  if (!window.ERPIcons) window.ERPIcons = ERPIcons;
}
