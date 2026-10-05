// ============================================================================
// erp-row-actions.js — one action list per table row: one primary button + a "⋯" menu
// ERP DEMO 4.3.1 · ADR-016 (round 5, part B of the UI declutter)
// ----------------------------------------------------------------------------
// Every list table used to print all of its actions on every row (the invoice list had
// ~109 buttons). A row now shows at most ONE primary button (the most likely next step
// for the row's state) and a "⋯" button whose menu holds the other actions.
//
// Pure core (no DOM, testable in Node):
//   rowActions(listId, facts)   → [{ id, label, icon, group, kind, call | dataset, … }]
//                                 ordered view/print → edit → create follow-up → other →
//                                 destructive; kind 'primary' | 'normal' | 'danger'
//   splitRowActions(actions)    → { primary, menu }
//   rowActionsHtml(listId, facts) → the cell markup (primary button + "⋯"), '' when none
// `facts` are the few plain values a row renderer already computes (branch, year, month,
// id, number, paid, voided …). They are written into the cell as JSON, and the SAME
// rowActions(listId, facts) call rebuilds the list when a button is clicked or the menu
// opens — so the primary button and the menu can never disagree, no per-row listener
// or closure is kept, and a re-rendered table leaves nothing behind.
//
// An action runs in one of two ways, exactly as its old per-row button did:
//   call    { fn, args }  the global function the old inline onclick called, with the same
//                         arguments (fn may be a path such as 'ERPCreditNotes.startFromInvoice')
//   dataset { … }         the data-* attributes of the old button; the module that owns them
//                         (erp-credit-note.js, erp-order-flow.js, erp-production-core.js,
//                         business-rules.js) handles the click with its own delegated listener.
//                         The primary button and the menu item carry the same attributes.
// Eligibility stays in ONE place: the `when` flags of each list below (the conditions the
// old renderers used). Ineligible actions are hidden, never shown disabled. The handlers
// keep their own guards and confirmations (delDoc, cancelPo, askVoid, …).
//
// DOM glue: one click and one keydown listener on document for every table (installed once
// even when several modules import this file). "⋯" opens a menu of erp-ui-menu.js
// (openMenuFor: body-level, flips above the button near the bottom of the viewport, follows
// scrolling, closes on Escape / outside click, one open menu at a time). A menu whose "⋯"
// button disappears because the table re-rendered closes at once.
// ============================================================================

import { openMenuFor } from './erp-ui-menu.js';
import { icon } from './erp-icons.js';

export const ROW_ACTIONS_VERSION = '1.0.0';

// Menu order of the action groups. 'danger' is always last (and red, after a separator).
export const ROW_ACTION_GROUPS = Object.freeze(['view', 'edit', 'create', 'other', 'danger']);

// Accessible name of the "⋯" button: `การทำงานเพิ่มเติม INV690907`.
export const ROW_MENU_LABEL = 'การทำงานเพิ่มเติม';

// Icon NAMES of erp-icons.js (the one line-icon set, ADR-017); they were emoji. `action.icon` is the
// name; the primary button and the "⋯" menu item draw the same line icon from it.
const ROW_ICON = Object.freeze({
  document: 'document',
  view: 'preview',
  edit: 'edit',
  receipt: 'receipt',
  creditNote: 'credit-note',
  production: 'factory',
  delivery: 'truck',
  receive: 'box',
  print: 'print',
  payment: 'payment',
  delete: 'trash',
  cancel: 'cancel'
});

// { fn, args } of a call action; args are passed exactly as given.
const rowCall = (fn, ...args) => ({ fn, args });

// ---------------------------------------------------------------- the lists
// Each list: name(facts) → text naming the row (for the "⋯" label);
//            actions(facts) → action specs, `when: false` = not shown for this row;
//            primary(facts) → action ids in order of preference (first shown one wins).
// Argument lists copy the old inline onclick calls character by character: an id that was
// quoted ('${x.id}') is passed as String(id), an unquoted one (${x.id}) as the raw value.
const ROW_LISTS = {
  // app.js renderQLList — ใบเสนอราคา
  quote: {
    name: f => f.no,
    // Approved and not yet turned into a production order or an invoice → its next step.
    primary: f => (f.approved && !f.converted ? ['production', 'doc'] : ['doc']),
    actions: f => [
      { id: 'doc', group: 'view', icon: ROW_ICON.document, label: 'ต้นฉบับ/สำเนา/PDF', primaryLabel: 'เอกสาร/PDF', title: 'เปิดต้นฉบับ/สำเนาใบเสนอราคา และดาวน์โหลด PDF', call: rowCall('openQuoteDocument', f.b, f.y, f.m, String(f.id)) },
      { id: 'detail', group: 'view', icon: ROW_ICON.view, label: 'ดูรายละเอียด', title: 'ดูรายละเอียดข้อมูล', call: rowCall('showDetailById', 'quote', f.b, f.y, f.m, String(f.id)) },
      { id: 'edit', group: 'edit', icon: ROW_ICON.edit, label: 'แก้ไข', call: rowCall('editQuote', f.b, f.y, f.m, String(f.id)) },
      { id: 'production', group: 'create', icon: ROW_ICON.production, label: 'สั่งผลิต', title: 'สร้างรายการสั่งผลิตจากใบเสนอราคานี้', call: rowCall('useQuoteForProduction', f.b, f.y, f.m, String(f.id)) },
      { id: 'delete', group: 'danger', icon: ROW_ICON.delete, label: 'ลบ', call: rowCall('delDoc', f.b, f.y, f.m, 'quotes', f.id) }
    ]
  },

  // app.js renderIList — ใบส่งสินค้า / ใบกำกับภาษี (actions on the first line of each invoice)
  invoice: {
    name: f => f.no,
    // settled = paid or fully credited (isInvoicePaid): nothing left to collect. A cancelled invoice is view/print only.
    primary: f => (f.settled || f.cancelled ? ['doc'] : ['receipt', 'doc']),
    // ADR-021: an issued invoice is never deleted ("ลบ" removed — there are no draft invoices: a record
    // exists only once saved/issued); it is cancelled with a reason and kept with its number.
    actions: f => [
      { id: 'doc', group: 'view', icon: ROW_ICON.document, label: 'ต้นฉบับ/สำเนา/PDF', primaryLabel: 'เอกสาร/PDF', title: 'เปิดต้นฉบับ/สำเนาใบส่งสินค้า / ใบกำกับภาษีสำหรับพิมพ์และ PDF', call: rowCall('openDeliveryDocumentFromInvoice', f.b, f.y, f.m, String(f.id)) },
      { id: 'detail', group: 'view', icon: ROW_ICON.view, label: 'ดูรายละเอียด', call: rowCall('showDetailById', 'invoice', f.b, f.y, f.m, String(f.id)) },
      { id: 'edit', group: 'edit', icon: ROW_ICON.edit, label: 'แก้ไข', title: 'แก้ไขข้อมูล', when: !f.cancelled, call: rowCall('editInvoice', f.b, f.y, f.m, String(f.id)) },
      { id: 'receipt', group: 'create', icon: ROW_ICON.receipt, label: 'ออกใบเสร็จ', primaryLabel: 'รับชำระ', title: 'ออกใบเสร็จจากบิลนี้', when: !f.cancelled, call: rowCall('issueReceiptFromInvoice', f.b, f.y, f.m, String(f.id)) },
      { id: 'credit-note', group: 'create', icon: ROW_ICON.creditNote, label: 'ลดหนี้', title: 'ออกใบลดหนี้อ้างอิงบิลนี้ (มาตรา 86/10)', when: !f.cancelled, call: rowCall('ERPCreditNotes.startFromInvoice', f.b, f.y, f.m, String(f.id)) },
      { id: 'cancel', group: 'danger', icon: ROW_ICON.cancel, label: f.vatNone ? 'ยกเลิกใบแจ้งหนี้' : 'ยกเลิกใบกำกับภาษี', title: 'เก็บเอกสารและเลขที่ไว้พร้อมตรา “ยกเลิก” (ไม่ลบ)', when: !f.cancelled, call: rowCall('ERPDocumentCancel.open', 'invoices', f.b, f.y, f.m, String(f.id)) }
    ]
  },

  // app.js renderRList — ใบเสร็จรับเงิน. A receipt voided with its payment (erp-order-flow.js
  // voidPayment) is view-only.
  receipt: {
    name: f => f.no,
    primary: () => ['doc'],
    actions: f => [
      { id: 'doc', group: 'view', icon: ROW_ICON.document, label: 'ต้นฉบับ/สำเนา/PDF', primaryLabel: 'เอกสาร/PDF', title: 'เปิดต้นฉบับ/สำเนาใบเสร็จรับเงินสำหรับพิมพ์และ PDF', call: rowCall('openReceiptDocumentFromReceipt', f.b, f.y, f.m, String(f.id)) },
      { id: 'detail', group: 'view', icon: ROW_ICON.view, label: 'ดูรายละเอียด', call: rowCall('showDetailById', 'receipt', f.b, f.y, f.m, String(f.id)) },
      { id: 'edit', group: 'edit', icon: ROW_ICON.edit, label: 'แก้ไข', when: !f.voided, call: rowCall('editReceipt', f.b, f.y, f.m, String(f.id)) },
      // ADR-021: an issued receipt is cancelled (kept, number stays in the sequence), never deleted. A receipt
      // made by a billing payment is voided with that payment; the handler explains it.
      { id: 'cancel', group: 'danger', icon: ROW_ICON.cancel, label: 'ยกเลิกใบเสร็จ', title: 'เก็บเอกสารและเลขที่ไว้พร้อมตรา “ยกเลิก” (ไม่ลบ)', when: !f.voided, call: rowCall('ERPDocumentCancel.open', 'receipts', f.b, f.y, f.m, String(f.id)) }
    ]
  },

  // app.js renderIssuedInvoiceList / renderIssuedReceiptList — ฉบับที่ออกแล้ว (locked)
  issuedInvoice: {
    name: f => f.no,
    primary: () => ['detail'],
    actions: f => [
      { id: 'detail', group: 'view', icon: ROW_ICON.view, label: 'ดู', call: rowCall('showIssuedDocumentDetail', 'issuedInvoices', f.b, f.y, f.m, String(f.id)) }
    ]
  },
  issuedReceipt: {
    name: f => f.no,
    primary: () => ['detail'],
    actions: f => [
      { id: 'detail', group: 'view', icon: ROW_ICON.view, label: 'ดู', call: rowCall('showIssuedDocumentDetail', 'issuedReceipts', f.b, f.y, f.m, String(f.id)) }
    ]
  },

  // app.js renderEList — ค่าใช้จ่าย (the evidence column shows the file count)
  expense: {
    name: f => f.no,
    primary: () => ['detail'],
    actions: f => [
      { id: 'detail', group: 'view', icon: ROW_ICON.view, label: 'ดูหลักฐาน', primaryLabel: 'ดู', title: 'ดูรายละเอียดและไฟล์หลักฐาน', call: rowCall('showDetailById', 'expense', f.b, f.y, f.m, String(f.id)) },
      { id: 'delete', group: 'danger', icon: ROW_ICON.delete, label: 'ลบ', call: rowCall('delDoc', f.b, f.y, f.m, 'expenses', String(f.id)) }
    ]
  },

  // app.js renderPList — รายการสั่งผลิต
  production: {
    name: f => f.no,
    // Not yet invoiced → create the delivery note / tax invoice; otherwise look at it.
    primary: () => ['invoice', 'detail'],
    actions: f => [
      { id: 'detail', group: 'view', icon: ROW_ICON.view, label: 'ดู', call: rowCall('showDetailById', 'production', f.b, f.y, f.m, String(f.id)) },
      { id: 'edit', group: 'edit', icon: ROW_ICON.edit, label: 'แก้ไข', title: 'แก้ไขรายการสั่งผลิต', when: !f.historical, call: rowCall('editProduction', f.b, f.y, f.m, String(f.id)) },
      { id: 'invoice', group: 'create', icon: ROW_ICON.delivery, label: 'สร้างใบส่ง/ภาษี', when: !f.linked && !f.historical, call: rowCall('useProductionForInvoice', f.b, f.y, f.m, String(f.id)) },
      { id: 'delete', group: 'danger', icon: ROW_ICON.delete, label: 'ลบ', call: rowCall('delDoc', f.b, f.y, f.m, 'productions', f.id) }
    ]
  },

  // erp-credit-note.js renderList — ใบลดหนี้ (data-cn-action, handled by erp-credit-note.js)
  creditNote: {
    name: f => f.no,
    primary: () => ['doc'],
    actions: f => {
      const ids = { branch: f.b, year: f.y, month: f.m, id: f.id };
      return [
        { id: 'doc', group: 'view', icon: ROW_ICON.document, label: 'เอกสาร / PDF', title: 'ตัวอย่าง / พิมพ์ / PDF', dataset: { cnAction: 'preview-saved', ...ids } },
        { id: 'edit', group: 'edit', icon: ROW_ICON.edit, label: 'แก้ไข', when: !!f.live, dataset: { cnAction: 'edit', ...ids } },
        { id: 'void', group: 'danger', icon: ROW_ICON.cancel, label: 'ยกเลิกใบลดหนี้', when: !!f.live, dataset: { cnAction: 'void', ...ids } }
      ];
    }
  },

  // erp-production-core.js renderPoList — ใบสั่งซื้อ (data-prodcore-action)
  purchaseOrder: {
    name: f => f.no,
    primary: () => ['receive'],
    actions: f => [
      { id: 'receive', group: 'create', icon: ROW_ICON.receive, label: 'รับสินค้า', title: 'รับสินค้าเข้าคลังจาก PO นี้', when: !['received', 'cancelled'].includes(f.status), dataset: { prodcoreAction: 'use-po', recordId: f.id } },
      { id: 'cancel', group: 'danger', icon: ROW_ICON.cancel, label: 'ยกเลิก PO', when: ['draft', 'ordered'].includes(f.status), dataset: { prodcoreAction: 'cancel-po', recordId: f.id } }
    ]
  },

  // erp-production-core.js renderGoodsReceipts — รับสินค้าเข้าคลัง
  goodsReceipt: {
    name: f => f.no,
    primary: () => [],
    actions: f => [
      { id: 'reverse', group: 'danger', icon: ROW_ICON.cancel, label: 'กลับรายการรับสินค้า', when: !f.reversed, dataset: { prodcoreAction: 'reverse-gr', recordId: f.id } }
    ]
  },

  // app.js renderMasterData — ลูกค้า / ผู้จำหน่าย (role 'customer' | 'supplier') และสินค้า
  contact: {
    name: f => f.name,
    primary: () => ['edit'],
    actions: f => [
      { id: 'edit', group: 'edit', icon: ROW_ICON.edit, label: 'แก้ไข', call: rowCall('editContactMaster', String(f.id), f.role) },
      { id: 'archive', group: 'danger', icon: ROW_ICON.cancel, label: 'ปิดใช้งาน', call: rowCall('archiveContactMaster', String(f.id), f.role) }
    ]
  },
  product: {
    name: f => f.name,
    primary: () => ['edit'],
    actions: f => [
      { id: 'edit', group: 'edit', icon: ROW_ICON.edit, label: 'แก้ไข', call: rowCall('editProductMasterLocal', String(f.key ?? '')) },
      { id: 'archive', group: 'danger', icon: ROW_ICON.cancel, label: 'ปิดใช้งาน', when: !f.seed, call: rowCall('archiveProductMasterLocal', String(f.key ?? '')) }
    ]
  },

  // erp-order-flow.js — ศูนย์งานขาย & ลูกหนี้ (data-order-action). A Sales Order row keeps
  // its "สิ่งที่ควรทำต่อ" button (the next step, in its own column) as its primary action.
  salesOrder: {
    name: f => f.no,
    primary: () => [],
    actions: f => [
      { id: 'open', group: 'view', icon: ROW_ICON.view, label: 'ดูรายละเอียด Sales Order', dataset: { orderAction: 'open-order', recordId: f.id } }
    ]
  },
  billing: {
    name: f => f.no,
    primary: () => ['receive', 'print'],
    actions: f => [
      { id: 'print', group: 'view', icon: ROW_ICON.print, label: 'พิมพ์ใบวางบิล', primaryLabel: 'พิมพ์', dataset: { orderAction: 'print-billing', recordId: f.id } },
      // receiveBillingPayment() itself ignores a cancelled billing note; a paid one was disabled.
      { id: 'receive', group: 'create', icon: ROW_ICON.payment, label: 'รับชำระ', when: !['paid', 'cancelled'].includes(f.status), dataset: { orderAction: 'receive-payment', recordId: f.id } }
    ]
  },
  payment: {
    name: f => f.no,
    primary: () => [],
    actions: f => [
      { id: 'void', group: 'danger', icon: ROW_ICON.cancel, label: 'ยกเลิกรับเงิน', when: !f.voided, dataset: { orderAction: 'void-payment', recordId: f.id } }
    ]
  },

  // business-rules.js — Product / Customer override tables (data-del-product / data-del-customer)
  // business-rules.js — a row is identified by its stable rule `key`, never by its position (the table
  // may show an unsaved preset whose rows are not the saved ones). Rows of an unsaved preset (`draft`)
  // have no delete: the preset is saved — or discarded — as a whole first (the table says so).
  productRule: {
    name: f => f.name,
    primary: () => [],
    actions: f => [
      { id: 'delete', group: 'danger', icon: ROW_ICON.delete, label: 'ลบ Override', when: !f.draft, dataset: { delProduct: f.key } }
    ]
  },
  customerRule: {
    name: f => f.name,
    primary: () => [],
    actions: f => [
      { id: 'delete', group: 'danger', icon: ROW_ICON.delete, label: 'ลบ Override', when: !f.draft, dataset: { delCustomer: f.key } }
    ]
  }
};

export const ROW_ACTION_LIST_IDS = Object.freeze(Object.keys(ROW_LISTS));

// ---------------------------------------------------------------- pure core
function rowGroupRank(group) {
  const index = ROW_ACTION_GROUPS.indexOf(group);
  return index < 0 ? ROW_ACTION_GROUPS.indexOf('other') : index;
}

function rowCleanDataset(dataset) {
  const out = {};
  for (const [key, value] of Object.entries(dataset)) {
    if (value === undefined || value === null) continue;
    out[key] = String(value);
  }
  return out;
}

// The actions of one row, in menu order, each marked 'primary', 'normal' or 'danger'.
// Unknown list → TypeError (a typo must fail loudly in tests, not render an empty cell).
export function rowActions(listId, facts) {
  const definition = Object.prototype.hasOwnProperty.call(ROW_LISTS, listId) ? ROW_LISTS[listId] : null;
  if (!definition) throw new TypeError(`erp-row-actions: unknown list "${listId}"`);
  const f = facts && typeof facts === 'object' ? facts : {};
  const shown = definition.actions(f)
    .filter(spec => spec && spec.when !== false)
    .map((spec, position) => ({ spec, position }));
  shown.sort((a, b) => (rowGroupRank(a.spec.group) - rowGroupRank(b.spec.group)) || (a.position - b.position));
  const ordered = shown.map(entry => entry.spec);
  const preferred = typeof definition.primary === 'function' ? definition.primary(f) : [];
  const primaryId = (Array.isArray(preferred) ? preferred : [])
    .find(id => ordered.some(spec => spec.id === id && spec.group !== 'danger')) ?? null;
  return ordered.map(spec => {
    const group = ROW_ACTION_GROUPS.includes(spec.group) ? spec.group : 'other';
    const action = {
      id: String(spec.id),
      label: String(spec.label),
      primaryLabel: spec.primaryLabel ? String(spec.primaryLabel) : String(spec.label),
      icon: spec.icon ? String(spec.icon) : '',
      title: spec.title ? String(spec.title) : '',
      group,
      kind: spec.id === primaryId ? 'primary' : (group === 'danger' ? 'danger' : 'normal')
    };
    if (spec.call) action.call = Object.freeze({ fn: String(spec.call.fn), args: Object.freeze([...spec.call.args]) });
    else if (spec.dataset) action.dataset = Object.freeze(rowCleanDataset(spec.dataset));
    else throw new TypeError(`erp-row-actions: action "${spec.id}" of "${listId}" has neither call nor dataset`);
    return Object.freeze(action);
  });
}

// { primary: the one visible button or null, menu: every other action in menu order }.
export function splitRowActions(actions) {
  const list = Array.isArray(actions) ? actions : [];
  const primary = list.find(action => action?.kind === 'primary') || null;
  return { primary, menu: list.filter(action => action && action !== primary) };
}

export function rowActionName(listId, facts) {
  const definition = Object.prototype.hasOwnProperty.call(ROW_LISTS, listId) ? ROW_LISTS[listId] : null;
  const name = definition?.name?.(facts && typeof facts === 'object' ? facts : {});
  return String(name ?? '').trim();
}

export function rowMenuLabel(listId, facts) {
  const name = rowActionName(listId, facts);
  return name ? `${ROW_MENU_LABEL} ${name}` : ROW_MENU_LABEL;
}

function rowEscapeAttr(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

// camelCase dataset key → data-kebab-case attribute name (cnAction → data-cn-action).
function rowDataAttributeName(key) {
  return `data-${String(key).replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`;
}

function rowPrimaryButtonHtml(action) {
  const dataAttributes = action.dataset
    ? Object.entries(action.dataset).map(([key, value]) => ` ${rowDataAttributeName(key)}="${rowEscapeAttr(value)}"`).join('')
    : '';
  const title = action.title ? ` title="${rowEscapeAttr(action.title)}"` : '';
  // Secondary level (ADR-017): lighter than the page's one solid "+ สร้าง…" button.
  return `<button type="button" class="btn btn-secondary btn-sm erp-rowact-primary" data-row-action="${rowEscapeAttr(action.id)}"${dataAttributes}${title}>${icon(action.icon)}<span class="erp-rowact-label">${rowEscapeAttr(action.primaryLabel)}</span></button>`;
}

// Markup of an action cell: '' when the row has no action, otherwise one wrapper holding the
// primary button (if any) and the "⋯" button (if any action is left for the menu).
export function rowActionsHtml(listId, facts) {
  const actions = rowActions(listId, facts);
  if (!actions.length) return '';
  const { primary, menu } = splitRowActions(actions);
  const parts = [];
  if (primary) parts.push(rowPrimaryButtonHtml(primary));
  if (menu.length) {
    const label = rowEscapeAttr(rowMenuLabel(listId, facts));
    parts.push(`<button type="button" class="erp-rowact-more" data-row-menu aria-haspopup="menu" aria-expanded="false" aria-label="${label}" title="${rowEscapeAttr(ROW_MENU_LABEL)}">${icon('more')}</button>`);
  }
  return `<div class="erp-rowact" data-row-actions="${rowEscapeAttr(listId)}" data-row-facts="${rowEscapeAttr(JSON.stringify(facts ?? {}))}">${parts.join('')}</div>`;
}

// Menu entries (erp-ui-menu.js item format) for the actions that are not the primary one.
// `run(action)` is called for a `call` action; a `dataset` action has no onSelect — its data-*
// attributes are on the menu item and the owning module's delegated listener handles the click.
export function rowMenuItems(actions, run) {
  return splitRowActions(actions).menu.map((action, index) => ({
    key: action.id,
    label: action.label,
    iconSvg: icon(action.icon),
    title: action.title,
    order: index,
    danger: action.kind === 'danger',
    dataset: { ...(action.dataset || {}), rowactId: action.id },
    onSelect: action.call && typeof run === 'function' ? () => run(action) : undefined
  }));
}

// Resolves 'ERPCreditNotes.startFromInvoice' on `root` → { fn, owner } or null.
export function resolveRowActionCall(path, root) {
  const parts = String(path || '').split('.').filter(Boolean);
  if (!parts.length || !root) return null;
  let owner = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    owner = owner?.[parts[index]];
    if (owner == null) return null;
  }
  const fn = owner?.[parts[parts.length - 1]];
  return typeof fn === 'function' ? { fn, owner } : null;
}

// Which row a set of facts describes, independent of its state: the record key (id, else key / index /
// number / name) and its period. A row whose status changed after an action (paid, voided …) keeps it.
export function rowIdentity(facts) {
  const f = facts && typeof facts === 'object' ? facts : {};
  const key = [f.id, f.key, f.index, f.no, f.name].find(value => value !== undefined && value !== null && value !== '');
  const part = value => (value === undefined || value === null ? null : String(value));
  return JSON.stringify([part(key), part(f.b), part(f.y), part(f.m)]);
}

// ---------------------------------------------------------------- DOM glue
const rowActionsHasDom = typeof window !== 'undefined' && typeof document !== 'undefined';
const ROW_ACTIONS_BOUND_FLAG = '__ERP_ROW_ACTIONS_BOUND__';
const rowMenuHandles = new WeakMap();
let rowMenuWatch = null; // { button, observer } of the open row menu
// After a row action the list usually re-renders, which removes the focused button and drops keyboard
// focus to <body>. For a short while the same row's button (same kind: primary or "⋯") gets focus back
// once it is on the page again (ADR-017) — only while focus is really lost, never taken from a dialog,
// a form or another page the action opened.
const ROW_FOCUS_WATCH_MS = 3000;
let rowFocusWatch = null; // { listId, identity, kind, button, observer, timer }

// Runs a `call` action: the same global function with the same arguments as the old button.
// Errors are not swallowed (they reach the page's error reporting as before).
export function runRowAction(action) {
  if (!action?.call) return undefined;
  const target = rowActionsHasDom ? resolveRowActionCall(action.call.fn, window) : null;
  if (!target) {
    console.error(`[ERPRowActions] ${action.call.fn} is not available`);
    if (rowActionsHasDom) window.notify?.('คำสั่งนี้ยังไม่พร้อม กรุณาโหลดหน้าเว็บใหม่', 'error');
    return undefined;
  }
  return target.fn.apply(target.owner, action.call.args);
}

// { listId, facts, actions } of the row a button belongs to, or null.
export function rowFromElement(element) {
  const wrapper = element?.closest?.('[data-row-actions]');
  if (!wrapper) return null;
  const listId = wrapper.dataset.rowActions;
  let facts;
  try {
    facts = JSON.parse(wrapper.dataset.rowFacts || '{}');
  } catch (error) {
    console.error('[ERPRowActions] unreadable row facts', error);
    return null;
  }
  try {
    return { listId, facts, actions: rowActions(listId, facts) };
  } catch (error) {
    console.error('[ERPRowActions]', error);
    return null;
  }
}

function stopRowMenuWatch() {
  rowMenuWatch?.observer.disconnect();
  rowMenuWatch = null;
}

// While a row menu is open: when its "⋯" button leaves the page (the table re-rendered after
// a filter, a search or a save), close the menu at once instead of leaving it floating.
function watchRowMenuButton(button) {
  stopRowMenuWatch();
  if (typeof MutationObserver !== 'function') return;
  const observer = new MutationObserver(() => {
    if (button.isConnected) return;
    stopRowMenuWatch();
    const handle = rowMenuHandles.get(button);
    if (handle?.isOpen()) handle.close({ restoreFocus: false });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  rowMenuWatch = { button, observer };
}

function stopRowFocusWatch() {
  if (!rowFocusWatch) return;
  rowFocusWatch.observer?.disconnect();
  clearTimeout(rowFocusWatch.timer);
  rowFocusWatch = null;
}

function rowFocusIsLost() {
  const active = document.activeElement;
  return !active || active === document.body || active === document.documentElement || !active.isConnected;
}

function rowWrapperIdentity(wrapper) {
  try {
    return rowIdentity(JSON.parse(wrapper.dataset.rowFacts || '{}'));
  } catch {
    return '';
  }
}

// Focuses the watched row's button when the list was re-rendered; true when focus was restored.
export function restoreRowFocus() {
  const watch = rowFocusWatch;
  if (!watch || !rowActionsHasDom) return false;
  if (watch.button.isConnected) return false; // not re-rendered (yet)
  if (!rowFocusIsLost()) {
    stopRowFocusWatch(); // the action moved focus on purpose (a dialog, a form field)
    return false;
  }
  const wrapper = [...document.querySelectorAll('[data-row-actions]')]
    .find(element => element.dataset.rowActions === watch.listId && rowWrapperIdentity(element) === watch.identity);
  if (!wrapper) return false; // gone (deleted) or not rendered yet: keep waiting until the timer ends
  const panel = wrapper.closest('.panel');
  if (panel && !panel.classList.contains('active')) return false; // the action went to another page
  if (wrapper.closest('[hidden]')) return false;
  const preferred = watch.kind === 'more' ? '[data-row-menu]' : '[data-row-action]';
  const target = wrapper.querySelector(preferred) || wrapper.querySelector('[data-row-menu], [data-row-action]');
  if (!target) return false;
  stopRowFocusWatch();
  target.focus();
  return document.activeElement === target;
}

// Remembers the row of `button` (a primary button or "⋯") before its action runs.
export function armRowFocusRestore(button) {
  if (!rowActionsHasDom) return;
  const wrapper = button?.closest?.('[data-row-actions]');
  if (!wrapper) return;
  stopRowFocusWatch();
  const watch = {
    listId: wrapper.dataset.rowActions,
    identity: rowWrapperIdentity(wrapper),
    kind: button.matches('[data-row-menu]') ? 'more' : 'primary',
    button,
    observer: null,
    timer: setTimeout(stopRowFocusWatch, ROW_FOCUS_WATCH_MS)
  };
  rowFocusWatch = watch;
  if (typeof MutationObserver === 'function') {
    watch.observer = new MutationObserver(() => { restoreRowFocus(); });
    watch.observer.observe(document.body, { childList: true, subtree: true });
  }
}

export function toggleRowMenu(button, focus = 'first') {
  if (!rowActionsHasDom || !button) return null;
  const handle = openMenuFor(button, {
    focus,
    className: 'erp-rowact-menu',
    items: () => {
      const row = rowFromElement(button);
      // Each item first remembers the row (focus comes back to its "⋯" after a re-render), then runs.
      return row ? rowMenuItems(row.actions, runRowAction).map(item => ({
        ...item,
        onSelect: () => {
          armRowFocusRestore(button);
          item.onSelect?.();
          restoreRowFocus();
        }
      })) : [];
    },
    onOpen: () => watchRowMenuButton(button),
    onClose: () => { if (rowMenuWatch?.button === button) stopRowMenuWatch(); }
  });
  rowMenuHandles.set(button, handle);
  return handle;
}

function onRowActionsClick(event) {
  const target = event.target;
  const more = target?.closest?.('[data-row-menu]');
  if (more && more.closest('[data-row-actions]')) {
    event.preventDefault();
    toggleRowMenu(more, 'first');
    return;
  }
  const button = target?.closest?.('[data-row-action]');
  if (!button || button.disabled || !button.closest('[data-row-actions]')) return;
  armRowFocusRestore(button);
  const row = rowFromElement(button);
  const action = row?.actions.find(item => item.id === button.dataset.rowAction && item.kind === 'primary');
  // A `dataset` action is run by the module that owns its data-* attributes (its listener comes later).
  if (!action?.call) return;
  runRowAction(action);
  restoreRowFocus();
}

function onRowActionsKeydown(event) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const more = event.target?.closest?.('[data-row-menu]');
  if (!more || !more.closest('[data-row-actions]')) return;
  event.preventDefault();
  if (more.getAttribute('aria-expanded') === 'true') return;
  toggleRowMenu(more, event.key === 'ArrowUp' ? 'last' : 'first');
}

// One pair of listeners for the whole page, also when several modules import this file.
function installRowActions() {
  if (!rowActionsHasDom || window[ROW_ACTIONS_BOUND_FLAG]) return;
  window[ROW_ACTIONS_BOUND_FLAG] = true;
  document.addEventListener('click', onRowActionsClick);
  document.addEventListener('keydown', onRowActionsKeydown);
}

export const ERPRowActions = Object.freeze({
  VERSION: ROW_ACTIONS_VERSION,
  LIST_IDS: ROW_ACTION_LIST_IDS,
  rowActions,
  splitRowActions,
  rowActionsHtml,
  rowMenuItems,
  rowMenuLabel,
  rowFromElement,
  resolveRowActionCall,
  runRowAction,
  toggleRowMenu,
  rowIdentity,
  armRowFocusRestore,
  restoreRowFocus
});

if (rowActionsHasDom) {
  installRowActions();
  if (!window.ERPRowActions) window.ERPRowActions = ERPRowActions;
}
