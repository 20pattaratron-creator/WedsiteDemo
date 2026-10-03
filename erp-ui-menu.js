// ============================================================================
// erp-ui-menu.js — accessible dropdown menu ("menu button" pattern)
// ERP DEMO 4.3.1 · ADR-015
// ----------------------------------------------------------------------------
// Used by the header "Demo" menu (local-demo-mode.js) and meant to be reused for "⋯"
// row-action menus in tables. The menu element lives in <body> and is placed with
// position:fixed from the trigger button's rectangle, so no overflow:auto/hidden
// container (table wrapper, card, sidebar) can clip it; it follows the button while the
// page or a scrollable container scrolls and closes when the button leaves the screen.
//
//   const menu = attachMenu(button, {
//     items,          // array, or a function returning an array (called on every open)
//     name,           // optional: registers the menu for getMenu(name)
//     label,          // optional accessible name (default: labelled by the button)
//     align,          // 'end' (default: right edges aligned) | 'start'
//     className,      // extra class on the menu element
//     keepMounted,    // default true; false = the element is created on open and
//                     // removed on close (use for one menu per table row)
//     bindButton,     // default true; false = the caller opens/closes it (openMenuFor)
//     onOpen, onClose
//   });
//   openMenuFor(button, options) — for "⋯" buttons in table rows (see below).
//   item = { key, label, icon, iconSvg, order, danger, disabled, onSelect(event, item),
//            id, title, dataset }
//     icon     plain text (emoji / symbol), rendered with textContent
//     iconSvg  TRUSTED constant SVG markup from our own code — never user data
//     disabled true / false; leave it out when another module toggles the button's
//              .disabled itself (the menu then keeps the element's current state)
//     danger   red, always after the other items, behind one separator
//   menu: open({ focus }), close({ restoreFocus }), toggle(), isOpen(), setItems(items),
//         addItem(item) (adds or replaces by key), hasItem(key), element, button, destroy()
//
// Behaviour: a click on the button toggles the menu; Escape closes it and returns focus
// to the button; a click outside, Tab, or choosing an item closes it; ArrowDown/ArrowUp/
// Home/End move between enabled items (ArrowDown/ArrowUp on the button open it); opening
// one menu closes any other open menu, also one created by another copy of this module.
// Choosing an item first closes the menu (focus back on the button), then runs onSelect;
// the click still bubbles, so document-level delegation (data-* attributes) keeps working.
// ============================================================================

export const UI_MENU_VERSION = '1.0.0';
// Fired on document when a menu opens; every other open menu closes itself.
const OPEN_EVENT = 'erp-ui-menu:open';
const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 4;
// Below this height a menu is not squeezed next to its button; it gets the whole viewport.
const MIN_SCROLL_HEIGHT = 120;

// ------------------------------------------------------------------ pure helpers
// Caller items → a new, clean list: entries without a label are dropped, defaults filled
// in, items ordered by `order` (then by their position in the input) and every danger
// item moved after the ordinary ones, so a destructive action is always last.
export function normalizeMenuItems(items) {
  const list = Array.isArray(items) ? items : [];
  const normalized = [];
  list.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return;
    const label = String(raw.label ?? '').trim();
    if (!label) return;
    normalized.push({
      key: String(raw.key ?? raw.id ?? `item-${index}`),
      label,
      icon: raw.icon == null ? '' : String(raw.icon),
      iconSvg: typeof raw.iconSvg === 'string' ? raw.iconSvg : '',
      order: Number.isFinite(raw.order) ? raw.order : 0,
      position: index,
      danger: raw.danger === true,
      // null = "not managed by the caller": the rendered element keeps its current state.
      disabled: typeof raw.disabled === 'boolean' ? raw.disabled : null,
      onSelect: typeof raw.onSelect === 'function' ? raw.onSelect : null,
      id: raw.id == null ? '' : String(raw.id),
      title: raw.title == null ? '' : String(raw.title),
      dataset: raw.dataset && typeof raw.dataset === 'object' ? { ...raw.dataset } : {}
    });
  });
  normalized.sort((a, b) => (Number(a.danger) - Number(b.danger)) || (a.order - b.order) || (a.position - b.position));
  return normalized;
}

// Rows to render for normalized items: one separator before the first danger item when
// ordinary items come before it.
export function menuRows(items) {
  const list = Array.isArray(items) ? items : [];
  const firstDanger = list.findIndex(item => item?.danger);
  const rows = [];
  list.forEach((item, index) => {
    if (index === firstDanger && index > 0) rows.push({ type: 'separator' });
    rows.push({ type: 'item', item });
  });
  return rows;
}

// Index of the next enabled item when moving by `step` (+1 down / -1 up) from `current`,
// wrapping around. `current` -1 (focus not on an item) starts before the first item for
// +1 and after the last item for -1. Returns -1 when every item is disabled.
export function nextEnabledIndex(disabledFlags, current, step) {
  const count = Array.isArray(disabledFlags) ? disabledFlags.length : 0;
  if (!count) return -1;
  const direction = step < 0 ? -1 : 1;
  let index = Number.isInteger(current) && current >= 0 && current < count ? current : -1;
  if (index < 0 && direction < 0) index = count;
  for (let tries = 0; tries < count; tries += 1) {
    index = (index + direction + count) % count;
    if (!disabledFlags[index]) return index;
  }
  return -1;
}

// Where a position:fixed menu of `size` ({width, height}) goes next to the `anchor`
// rectangle ({top, bottom, left, right}) inside `viewport` ({width, height}):
// - below the anchor; above it only when it does not fit below and there is more room above;
// - right edges aligned ('end', default) or left edges aligned ('start');
// - always inside the viewport with a small margin;
// - `maxHeight` (px) when the chosen side is too short, so the menu scrolls instead of
//   running off the screen; on a very short screen it uses the whole viewport height.
export function menuPosition(anchor, size, viewport, options = {}) {
  const margin = Number.isFinite(options.margin) ? options.margin : VIEWPORT_MARGIN;
  const gap = Number.isFinite(options.gap) ? options.gap : ANCHOR_GAP;
  const width = Math.max(0, Number(size?.width) || 0);
  const height = Math.max(0, Number(size?.height) || 0);
  const viewWidth = Math.max(0, Number(viewport?.width) || 0);
  const viewHeight = Math.max(0, Number(viewport?.height) || 0);
  const anchorTop = Number(anchor?.top) || 0;
  const anchorBottom = Number(anchor?.bottom) || 0;
  const anchorLeft = Number(anchor?.left) || 0;
  const anchorRight = Number(anchor?.right) || 0;

  let left = options.align === 'start' ? anchorLeft : anchorRight - width;
  left = Math.min(left, viewWidth - margin - width);
  left = Math.max(left, margin);

  const spaceBelow = viewHeight - anchorBottom - gap - margin;
  const spaceAbove = anchorTop - gap - margin;
  const placeAbove = height > spaceBelow && spaceAbove > spaceBelow;
  const available = Math.max(0, placeAbove ? spaceAbove : spaceBelow);
  if (height <= available) {
    const top = placeAbove ? anchorTop - gap - height : anchorBottom + gap;
    return { top: Math.round(top), left: Math.round(left), placement: placeAbove ? 'top' : 'bottom', maxHeight: null };
  }
  if (available >= MIN_SCROLL_HEIGHT) {
    const top = placeAbove ? anchorTop - gap - available : anchorBottom + gap;
    return { top: Math.round(top), left: Math.round(left), placement: placeAbove ? 'top' : 'bottom', maxHeight: Math.floor(available) };
  }
  const fullHeight = Math.max(0, viewHeight - 2 * margin);
  return { top: margin, left: Math.round(left), placement: 'viewport', maxHeight: height > fullHeight ? Math.floor(fullHeight) : null };
}

// ------------------------------------------------------------------ DOM controller
const hasDom = typeof window !== 'undefined' && typeof document !== 'undefined';
const namedMenus = new Map();
const attachedMenus = new WeakMap();

function uniqueMenuId() {
  // Random part: two copies of this module (e.g. the jsdom test harness) must not collide.
  return `erp-menu-${Math.random().toString(36).slice(2, 9)}`;
}

function viewportSize() {
  const root = document.documentElement;
  return {
    width: root?.clientWidth || window.innerWidth || 0,
    height: window.innerHeight || root?.clientHeight || 0
  };
}

function renderIcon(item) {
  if (!item.iconSvg && !item.icon) return null;
  const icon = document.createElement('span');
  icon.className = 'erp-menu-icon';
  icon.setAttribute('aria-hidden', 'true');
  if (item.iconSvg) icon.innerHTML = item.iconSvg; // trusted constant markup (see header)
  else icon.textContent = item.icon;
  return icon;
}

// Creates or updates the element of one item. An existing element is reused so a state
// another module set on it (e.g. .disabled while an action runs) survives a re-render.
function renderItemButton(item, existing) {
  const button = existing || document.createElement('button');
  if (!existing) {
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.tabIndex = -1;
  }
  button.className = item.danger ? 'erp-menu-item is-danger' : 'erp-menu-item';
  button.dataset.menuKey = item.key;
  if (item.id) button.id = item.id;
  if (item.title) button.title = item.title;
  else button.removeAttribute('title');
  for (const [name, value] of Object.entries(item.dataset)) button.dataset[name] = String(value);
  if (item.disabled !== null) {
    button.disabled = item.disabled;
    button.setAttribute('aria-disabled', String(item.disabled));
  }
  const label = document.createElement('span');
  label.className = 'erp-menu-label';
  label.textContent = item.label;
  const icon = renderIcon(item);
  button.replaceChildren(...(icon ? [icon, label] : [label]));
  return button;
}

export function attachMenu(button, options = {}) {
  if (!hasDom) throw new Error('attachMenu needs a browser document');
  if (!button || typeof button.addEventListener !== 'function') throw new TypeError('attachMenu needs a button element');
  const previous = attachedMenus.get(button);
  if (previous) return previous;

  const keepMounted = options.keepMounted !== false;
  const align = options.align === 'start' ? 'start' : 'end';
  let itemsSource = options.items ?? [];
  let current = [];
  let open = false;
  const elementsByKey = new Map();
  const itemsByKey = new Map();

  const menu = document.createElement('div');
  menu.id = options.id || uniqueMenuId();
  menu.className = ['erp-menu', options.className].filter(Boolean).join(' ');
  menu.setAttribute('role', 'menu');
  menu.tabIndex = -1;
  menu.hidden = true;
  if (!button.id) button.id = `${menu.id}-button`;
  if (options.label) menu.setAttribute('aria-label', String(options.label));
  else menu.setAttribute('aria-labelledby', button.id);
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');

  function itemButtons() {
    return [...menu.querySelectorAll('[role="menuitem"]')];
  }

  function render() {
    const raw = typeof itemsSource === 'function' ? itemsSource() : itemsSource;
    current = normalizeMenuItems(raw);
    itemsByKey.clear();
    const rows = menuRows(current).map(row => {
      if (row.type === 'separator') {
        const separator = document.createElement('div');
        separator.className = 'erp-menu-separator';
        separator.setAttribute('role', 'separator');
        return separator;
      }
      const element = renderItemButton(row.item, elementsByKey.get(row.item.key));
      elementsByKey.set(row.item.key, element);
      itemsByKey.set(row.item.key, row.item);
      return element;
    });
    // Forget elements of items that are gone.
    for (const key of [...elementsByKey.keys()]) {
      if (!itemsByKey.has(key)) elementsByKey.delete(key);
    }
    menu.replaceChildren(...rows);
  }

  function mount() {
    if (!menu.isConnected) document.body.append(menu);
    button.setAttribute('aria-controls', menu.id);
  }

  function place() {
    menu.style.maxHeight = '';
    const rect = button.getBoundingClientRect();
    const size = { width: menu.offsetWidth, height: menu.offsetHeight };
    const position = menuPosition(rect, size, viewportSize(), { align });
    menu.style.top = `${position.top}px`;
    menu.style.left = `${position.left}px`;
    menu.style.maxHeight = position.maxHeight == null ? '' : `${position.maxHeight}px`;
    menu.dataset.placement = position.placement;
  }

  function focusItem(where) {
    const buttons = itemButtons();
    const flags = buttons.map(element => element.disabled);
    const index = where === 'last' ? nextEnabledIndex(flags, -1, -1) : nextEnabledIndex(flags, -1, 1);
    if (index >= 0) buttons[index].focus();
    else menu.focus();
  }

  // ---- listeners that exist only while the menu is open
  function onDocumentClick(event) {
    const target = event.target;
    if (menu.contains(target) || button.contains(target)) return;
    close({ restoreFocus: false });
  }
  // Focus inside the menu or on its own button: the menu is "where the user is".
  function focusIsHere() {
    const active = document.activeElement;
    return !!active && (menu.contains(active) || button.contains(active));
  }
  function onDocumentKeydown(event) {
    if (event.key !== 'Escape') return;
    // Escape belongs to the open menu only while focus is in it or on its button; when focus has moved
    // on (e.g. Ctrl+K opened the search), that dialog's own Escape handler runs instead.
    if (!focusIsHere()) return;
    event.preventDefault();
    event.stopPropagation();
    close({ restoreFocus: true });
  }
  // Focus moved outside the menu and its button (Tab from the button, a shortcut that opens a dialog,
  // a click elsewhere that focuses a control): the menu closes and leaves focus where it went.
  function onDocumentFocusIn(event) {
    const target = event.target;
    if (target && (menu.contains(target) || button.contains(target))) return;
    close({ restoreFocus: false });
  }
  // Page navigation (go() and the other modules announce it with `erp:navigation`) closes the menu.
  function onNavigation() {
    close({ restoreFocus: false });
  }
  function onViewportChange() {
    if (!button.isConnected) {
      close({ restoreFocus: false });
      return;
    }
    const rect = button.getBoundingClientRect();
    const viewport = viewportSize();
    const gone = (rect.width === 0 && rect.height === 0) || rect.bottom < 0 || rect.top > viewport.height;
    if (gone) close({ restoreFocus: false });
    else place();
  }
  function onOtherMenuOpen(event) {
    if (event.detail?.menu !== menu) close({ restoreFocus: false });
  }
  function listen(on) {
    const method = on ? 'addEventListener' : 'removeEventListener';
    // Capture phase: runs before any handler of the clicked element could stop the event.
    document[method]('click', onDocumentClick, true);
    document[method]('keydown', onDocumentKeydown, true);
    // Capture phase so scrolling inside any container (e.g. a table wrapper) is seen too.
    document[method]('scroll', onViewportChange, true);
    window[method]('resize', onViewportChange);
    document[method](OPEN_EVENT, onOtherMenuOpen);
    document[method]('focusin', onDocumentFocusIn, true);
    document[method]('erp:navigation', onNavigation);
  }

  function openMenu({ focus = 'first' } = {}) {
    if (open) {
      focusItem(focus);
      return;
    }
    if (!button.isConnected) return;
    document.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { menu } }));
    mount();
    render();
    menu.hidden = false;
    open = true;
    button.setAttribute('aria-expanded', 'true');
    button.classList.add('is-open');
    place();
    listen(true);
    focusItem(focus);
    options.onOpen?.();
  }

  function close({ restoreFocus = false } = {}) {
    if (!open) return;
    open = false;
    listen(false);
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    button.classList.remove('is-open');
    if (!keepMounted) {
      menu.remove();
      button.removeAttribute('aria-controls');
    }
    if (restoreFocus && button.isConnected) button.focus();
    options.onClose?.();
  }

  function toggle(openOptions) {
    if (open) close({ restoreFocus: true });
    else openMenu(openOptions);
  }

  // ---- listeners on the button and the menu (for the lifetime of the menu)
  function onButtonClick(event) {
    event.preventDefault();
    toggle({ focus: 'first' });
  }
  function onButtonKeydown(event) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    openMenu({ focus: event.key === 'ArrowUp' ? 'last' : 'first' });
  }
  function onMenuClick(event) {
    const element = event.target.closest?.('[role="menuitem"]');
    if (!element || !menu.contains(element) || element.disabled) return;
    const item = itemsByKey.get(element.dataset.menuKey);
    close({ restoreFocus: true });
    if (!item?.onSelect) return;
    try {
      item.onSelect(event, item);
    } catch (error) {
      console.error(`[ERPUiMenu] "${item.label}" failed`, error);
    }
  }
  function onMenuKeydown(event) {
    const buttons = itemButtons();
    const flags = buttons.map(element => element.disabled);
    const index = buttons.indexOf(document.activeElement);
    let next = -1;
    if (event.key === 'ArrowDown') next = nextEnabledIndex(flags, index, 1);
    else if (event.key === 'ArrowUp') next = nextEnabledIndex(flags, index, -1);
    else if (event.key === 'Home') next = nextEnabledIndex(flags, -1, 1);
    else if (event.key === 'End') next = nextEnabledIndex(flags, -1, -1);
    else if (event.key === 'Tab') {
      // Focus goes back to the button first, so Tab continues from there in page order.
      close({ restoreFocus: true });
      return;
    } else return;
    event.preventDefault();
    if (next >= 0) buttons[next].focus();
  }

  // bindButton:false = the caller opens/closes the menu itself (openMenuFor from a delegated
  // click handler); binding here too would toggle twice per click.
  const bindButton = options.bindButton !== false;
  if (bindButton) {
    button.addEventListener('click', onButtonClick);
    button.addEventListener('keydown', onButtonKeydown);
  }
  menu.addEventListener('click', onMenuClick);
  menu.addEventListener('keydown', onMenuKeydown);
  if (keepMounted) {
    mount();
    render();
  }

  const handle = Object.freeze({
    element: menu,
    button,
    open: openMenu,
    close,
    toggle,
    isOpen: () => open,
    setItems(items) {
      itemsSource = items ?? [];
      if (menu.isConnected) render();
    },
    // Adds an item, or replaces the item with the same key (array item lists only).
    addItem(item) {
      const list = typeof itemsSource === 'function' ? [] : [...itemsSource];
      const key = String(item?.key ?? item?.id ?? '');
      const at = list.findIndex(entry => String(entry?.key ?? entry?.id ?? '') === key);
      if (at >= 0) list[at] = item;
      else list.push(item);
      handle.setItems(list);
    },
    hasItem(key) {
      const list = typeof itemsSource === 'function' ? [] : itemsSource;
      return list.some(entry => String(entry?.key ?? entry?.id ?? '') === String(key));
    },
    destroy() {
      close({ restoreFocus: false });
      if (bindButton) {
        button.removeEventListener('click', onButtonClick);
        button.removeEventListener('keydown', onButtonKeydown);
      }
      menu.remove();
      button.removeAttribute('aria-haspopup');
      button.removeAttribute('aria-expanded');
      button.removeAttribute('aria-controls');
      attachedMenus.delete(button);
      if (options.name && namedMenus.get(options.name) === handle) namedMenus.delete(options.name);
    }
  });
  attachedMenus.set(button, handle);
  if (options.name) namedMenus.set(String(options.name), handle);
  return handle;
}

// For row buttons created on every render, called from a delegated click handler:
//   document.addEventListener('click', e => { const b = e.target.closest('[data-row-menu]');
//     if (b) ERPUiMenu.openMenuFor(b, { items: () => rowItems(b.dataset.rowMenu) }); });
// The first call attaches a menu to the button (created on open, removed on close, not
// bound to the button's own events); every call toggles it. `items` given here replaces
// the previous list, so a re-used button always shows the current row's actions.
export function openMenuFor(button, options = {}) {
  const existing = attachedMenus.get(button);
  const handle = existing || attachMenu(button, { keepMounted: false, ...options, bindButton: false });
  if (existing && options.items !== undefined) handle.setItems(options.items);
  if (handle.isOpen()) handle.close({ restoreFocus: true });
  else handle.open({ focus: options.focus || 'first' });
  return handle;
}

export function getMenu(name) {
  return namedMenus.get(String(name)) || null;
}

export const ERPUiMenu = Object.freeze({
  VERSION: UI_MENU_VERSION,
  attachMenu,
  openMenuFor,
  getMenu,
  normalizeMenuItems,
  menuRows,
  nextEnabledIndex,
  menuPosition
});

if (hasDom && !window.ERPUiMenu) window.ERPUiMenu = ERPUiMenu;
