// ============================================================================
// erp-sales-form-assist.js — sales form helpers (Local Demo UI layer)
// ERP DEMO 4.3.1
//
// 1) Invoice "รูปแบบใบกำกับภาษี" selector (#i-tax-form): full (§86/4, default)
//    or abbreviated (§86/6). While abbreviated is selected the VAT select is
//    locked to VAT-inclusive (useVat 0) and the user's previous VAT choice is
//    restored when switching back to full. The buyer name becomes optional
//    (app.js stores GENERAL_CUSTOMER_NAME when it is left empty).
// 2) Product-master default price: when the user picks a product in a quote or
//    invoice item row, an empty unit-price cell is filled from the
//    product's pre-VAT default price converted to the form's VAT mode, and an
//    unchosen unit is filled from the product unit. A typed price is never
//    overwritten (see planProductDefaultPriceFill in erp-master-data-core.js).
//    Precedence: a price the user typed, or took from the quote's
//    "⚙ ราคาแนะนำ" (Business Rules) button, always wins (a typed 0 too); the
//    master default only fills an empty cell, or a cell that still holds the value the
//    autofill itself wrote and that the user has not typed in (typing — even
//    the same number — removes data-master-filled and marks the cell
//    data-price-owner="user"; a suggested price clears the markers too). The
//    suggestion button is never run automatically, so the two never compete.
//
// Rules are pure helpers in erp-shared-core.js / erp-master-data-core.js.
// Events use addEventListener delegation — no new inline handlers. app.js only
// calls window.ERPSalesFormAssist from resetF / editInvoice / fillFromProduction.
// ============================================================================
import { TAX_INVOICE_FORM_ABBREVIATED, TAX_INVOICE_FORM_FULL, ABBREVIATED_TAX_INVOICE_USE_VAT, GENERAL_CUSTOMER_NAME, normalizeTaxInvoiceForm, convertUnitPriceBetweenVatModes, vatModeGrossFactor } from './erp-shared-core.js';
import { findProductMasterRow, planProductDefaultPriceFill, normalizeProductDefaultPrice } from './erp-master-data-core.js';

(() => {
  'use strict';
  if (window.ERPSalesFormAssist) return;
  const $ = id => document.getElementById(id);
  const notifyUser = (message, type) => { if (typeof window.notify === 'function') window.notify(message, type); else console.warn('[SalesFormAssist]', message); };
  const LOCKED_VAT = String(ABBREVIATED_TAX_INVOICE_USE_VAT);

  // Item tables that get the default-price autofill. Receipt rows are left
  // alone on purpose: they copy the invoice being paid.
  const ITEM_TABLES = Object.freeze({
    'q-items-body': { price: '[data-field="price-unit"]', unit: 'select', vat: 'q-vat', recalc: () => window.calcQ?.() },
    'i-items-body': { price: '[data-field="priceUnit"]', unit: 'select[data-field="unit"]', vat: 'i-vat', recalc: () => window.calcI?.() }
  });
  function tableOf(element) {
    const body = element?.closest?.('tbody');
    return body && ITEM_TABLES[body.id] ? { body, ...ITEM_TABLES[body.id] } : null;
  }

  // ------------------------------------------------------ tax invoice form
  function invoiceTaxForm() {
    return normalizeTaxInvoiceForm($('i-tax-form')?.value);
  }
  function renderTaxFormUi(form) {
    const abbreviated = form === TAX_INVOICE_FORM_ABBREVIATED;
    // style.display (not [hidden]): .section-hint sets display:block, which
    // would override the hidden attribute.
    const hint = $('i-tax-form-hint');
    if (hint) hint.style.display = abbreviated ? '' : 'none';
    const mark = $('i-cust-required');
    if (mark) mark.textContent = abbreviated ? '(ไม่บังคับ)' : '*';
    const customer = $('i-cust');
    if (customer) {
      if (customer.dataset.fullPlaceholder === undefined) customer.dataset.fullPlaceholder = customer.placeholder || '';
      customer.placeholder = abbreviated ? `ไม่บังคับ — เว้นว่างจะบันทึกเป็น “${GENERAL_CUSTOMER_NAME}”` : customer.dataset.fullPlaceholder;
    }
    const vat = $('i-vat');
    if (vat) vat.title = abbreviated ? 'ใบกำกับภาษีอย่างย่อใช้ราคารวม VAT แล้วเท่านั้น' : '';
  }
  // options.restoreVat (default true): when leaving abbreviated, put back the
  // VAT mode the user had before it was locked. options.recalc (default true).
  // options.convertPrices (default true): when the VAT mode changes, convert
  // typed prices so the total is unchanged (see convertTypedPrices).
  function setInvoiceTaxForm(value, options = {}) {
    const form = normalizeTaxInvoiceForm(value);
    const select = $('i-tax-form'), vat = $('i-vat');
    if (select) select.value = form;
    // The total shown before anything changes (kept current by calcI()).
    const totalBefore = readGrandTotal();
    let vatChanged = false, before = '';
    if (vat) {
      before = vat.value;
      const locked = vat.dataset.taxFormLocked === '1';
      if (form === TAX_INVOICE_FORM_ABBREVIATED) {
        if (!locked) vat.dataset.userVat = vat.value;
        vat.value = LOCKED_VAT;
        vat.disabled = true;
        vat.dataset.taxFormLocked = '1';
      } else if (locked) {
        if (options.restoreVat !== false && vat.dataset.userVat) vat.value = vat.dataset.userVat;
        vat.disabled = false;
        delete vat.dataset.taxFormLocked;
        delete vat.dataset.userVat;
      }
      vatChanged = vat.value !== before;
    }
    renderTaxFormUi(form);
    if (vatChanged) {
      // Typed / copied prices first (autofilled rows are recognised by
      // data-master-filled and handled afterwards).
      const converted = options.convertPrices === false ? 0 : convertTypedPrices(before, vat.value);
      // Autofilled rows follow the same rule as typed rows: when the gross
      // factor changes (VAT added ↔ inclusive) they are re-based from the
      // master price, which keeps their gross amount; when it does not
      // ('none' ↔ 'extract', both ×1) they keep their number, exactly like a
      // typed price — re-basing would silently raise the total by 7%.
      const rebased = vatModeGrossFactor(before) === vatModeGrossFactor(vat.value) ? 0 : rebaseDefaultPrices('i-items-body', false);
      if (options.convertPrices !== false) notifyVatSwitch(form, before, vat.value, converted, rebased, totalBefore);
    }
    if (options.recalc !== false) ITEM_TABLES['i-items-body'].recalc();
    return form;
  }

  // ---------------------------------------- typed prices on a VAT-mode switch
  // Switching the form (full ↔ abbreviated) changes the VAT mode. A price the
  // user typed (or that was copied from a quote / sales order) means "before
  // VAT" in 'add' mode but "VAT included" in 'extract' mode, so keeping the
  // number would silently change the invoice total by ~7%. Instead the price
  // is converted so its gross amount stays the same (+7% VAT add → inclusive,
  // the reverse back, half-up to satang; see convertUnitPriceBetweenVatModes). The value before the conversion is kept on
  // the input so switching back restores it exactly (no round-trip drift).
  function readGrandTotal() {
    const text = String($('i-grand-total')?.value || '').replace(/,/g, '');
    const total = Number(text);
    return text !== '' && Number.isFinite(total) ? total : null;
  }
  function isAutofilledPrice(input) {
    const base = normalizeProductDefaultPrice(input.dataset.masterPrice);
    return base !== null && input.value === input.dataset.masterFilled;
  }
  function convertTypedPrices(fromVat, toVat) {
    if (vatModeGrossFactor(fromVat) === vatModeGrossFactor(toVat)) return 0;
    const body = $('i-items-body');
    if (!body) return 0;
    let converted = 0;
    body.querySelectorAll(ITEM_TABLES['i-items-body'].price).forEach(input => {
      if (String(input.value).trim() === '' || isAutofilledPrice(input)) return;
      const remembered = input.dataset.vatSwitchFrom === String(toVat)
        && input.dataset.vatSwitchValue === input.value
        && input.dataset.vatSwitchOriginal !== undefined;
      const next = remembered
        ? input.dataset.vatSwitchOriginal
        : convertUnitPriceBetweenVatModes(input.value, fromVat, toVat);
      if (!remembered && !Number.isFinite(next)) return;
      const nextText = remembered ? next : next.toFixed(2);
      if (remembered) {
        delete input.dataset.vatSwitchFrom;
        delete input.dataset.vatSwitchValue;
        delete input.dataset.vatSwitchOriginal;
      } else {
        input.dataset.vatSwitchFrom = String(fromVat);
        input.dataset.vatSwitchOriginal = input.value;
        input.dataset.vatSwitchValue = nextText;
      }
      if (input.value !== nextText) converted += 1;
      input.value = nextText;
    });
    return converted;
  }
  const moneyText = value => Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // One message per VAT-mode switch. The total part is always measured (grand
  // total before vs after the recalculation), never assumed, whichever rows
  // changed: rounding a converted or re-based unit price to satang can move
  // the total by a few satang, and that must be reported too.
  function notifyVatSwitch(form, fromVat, toVat, converted, rebased, totalBefore) {
    ITEM_TABLES['i-items-body'].recalc();
    const totalAfter = readGrandTotal();
    const known = totalBefore !== null && totalAfter !== null;
    const changed = known && Math.abs(totalBefore - totalAfter) >= 0.005;
    const sameGross = vatModeGrossFactor(fromVat) === vatModeGrossFactor(toVat);
    const body = $('i-items-body');
    const priced = !!body && [...body.querySelectorAll(ITEM_TABLES['i-items-body'].price)].some(input => String(input.value).trim() !== '');
    let lead = '';
    if (converted) {
      lead = form === TAX_INVOICE_FORM_ABBREVIATED
        ? `แปลงราคาต่อหน่วยที่กรอกไว้ ${converted} รายการเป็นราคารวม VAT 7% แล้ว เพื่อใช้กับใบกำกับภาษีอย่างย่อ`
        : `แปลงราคาต่อหน่วย ${converted} รายการกลับเป็นราคาก่อน VAT ตามรูปแบบ VAT ที่เลือก`;
    } else if (sameGross && [String(fromVat), String(toVat)].includes('2') && priced) {
      // 'none' ↔ 'extract' keeps every number, but the same price now does (or
      // no longer does) contain 7% VAT — worth telling the user.
      lead = String(toVat) === LOCKED_VAT
        ? 'ราคาต่อหน่วยคงเดิม แต่ราคาที่ตั้งไว้แบบไม่มี VAT จะถือว่ารวม VAT 7% แล้วในใบกำกับภาษีอย่างย่อ'
        : 'กลับเป็นแบบไม่มี VAT: ราคาต่อหน่วยคงเดิมและจะไม่ถูกแยก VAT อีก';
    } else if (changed) {
      lead = rebased
        ? `ปรับราคาต่อหน่วยจากราคาขายมาตรฐาน (Product Master) ${rebased} รายการตามรูปแบบ VAT ที่เลือก`
        : 'เปลี่ยนรูปแบบ VAT แล้ว';
    }
    if (!lead) return;
    const tail = !known ? ''
      : changed
        ? ` — ยอดรวมทั้งสิ้นเปลี่ยนจาก ${moneyText(totalBefore)} เป็น ${moneyText(totalAfter)} บาท${sameGross ? '' : ' เนื่องจากการปัดราคาต่อหน่วยเป็นสตางค์'}`
        : ' — ยอดรวมทั้งสิ้นคงเดิม';
    const check = changed || !converted ? ' กรุณาตรวจสอบราคา' : '';
    notifyUser(lead + tail + check, 'info');
  }
  // Called after another flow wrote #i-vat directly (e.g. filling the invoice
  // from a production order). A source priced VAT-exclusive / non-VAT cannot be
  // printed as an abbreviated invoice ("ราคารวมภาษีมูลค่าเพิ่มแล้ว"), so the form
  // falls back to full instead of silently re-reading those prices as VAT-inclusive.
  function enforceInvoiceTaxForm() {
    const vat = $('i-vat');
    if (invoiceTaxForm() !== TAX_INVOICE_FORM_ABBREVIATED || !vat) return invoiceTaxForm();
    if (vat.value === LOCKED_VAT) return TAX_INVOICE_FORM_ABBREVIATED;
    setInvoiceTaxForm(TAX_INVOICE_FORM_FULL, { restoreVat: false });
    notifyUser('เอกสารต้นทางไม่ได้ใช้ราคารวม VAT จึงเปลี่ยนกลับเป็นใบกำกับภาษีเต็มรูป (ใบกำกับภาษีอย่างย่อต้องใช้ราคารวม VAT แล้วเท่านั้น)', 'info');
    return TAX_INVOICE_FORM_FULL;
  }

  // ---------------------------------------------------- default unit price
  function productRows() {
    try { return typeof window.productMasterRows === 'function' ? window.productMasterRows() : []; }
    catch (error) { console.warn('[SalesFormAssist] product master unavailable', error); return []; }
  }
  function unitWasChosen(select) {
    if (select.dataset.unitSource === 'user') return true;
    if (select.dataset.unitSource === 'master') return false;
    // uSel() marks a unit restored from saved data with the `selected` attribute;
    // a fresh row has none and only *shows* the first option.
    return [...select.options].some(option => option.defaultSelected);
  }
  function fillUnit(select, unit) {
    const text = String(unit || '').trim();
    if (!select || !text || unitWasChosen(select)) return false;
    if (![...select.options].some(option => option.value === text)) select.appendChild(new Option(text, text));
    select.value = text;
    select.dataset.unitSource = 'master';
    return true;
  }
  // Runs on a user's product choice (change event) — never while rows are
  // rebuilt from saved documents, so editing never alters a stored price.
  function applyDefaultPrice(productInput) {
    const table = tableOf(productInput);
    const row = productInput?.closest?.('tr');
    if (!table || !row) return { filled: false, unit: false };
    const product = findProductMasterRow(productRows(), productInput.value, '');
    const priceInput = row.querySelector(table.price);
    let filled = false;
    if (priceInput) {
      const plan = planProductDefaultPriceFill({
        currentValue: priceInput.value,
        lastAutoValue: priceInput.dataset.masterFilled,
        defaultPrice: product?.defaultPrice,
        useVat: $(table.vat)?.value,
        // Free text that is not in the master keeps whatever the cell holds.
        productFound: !!product,
        userOwned: priceInput.dataset.priceOwner === 'user'
      });
      if (plan.fill) {
        priceInput.value = plan.value;
        delete priceInput.dataset.priceOwner;
        if (plan.base === null) { delete priceInput.dataset.masterPrice; delete priceInput.dataset.masterFilled; }
        else { priceInput.dataset.masterPrice = String(plan.base); priceInput.dataset.masterFilled = plan.value; }
        filled = true;
      }
    }
    const unit = product ? fillUnit(row.querySelector(table.unit), product.unit) : false;
    if (filled || unit) table.recalc();
    return { filled, unit };
  }
  // A VAT-mode change re-bases prices that are still exactly what the autofill
  // wrote (pre-VAT master price in the new basis); typed prices are untouched.
  function rebaseDefaultPrices(bodyId, recalc = true) {
    const table = ITEM_TABLES[bodyId];
    const body = $(bodyId);
    if (!table || !body) return 0;
    const useVat = $(table.vat)?.value;
    let changed = 0;
    body.querySelectorAll(table.price).forEach(input => {
      const base = normalizeProductDefaultPrice(input.dataset.masterPrice);
      if (base === null || input.value !== input.dataset.masterFilled) return;
      const plan = planProductDefaultPriceFill({ currentValue: '', defaultPrice: base, useVat });
      if (!plan.fill || plan.value === input.value) return;
      input.value = plan.value;
      input.dataset.masterFilled = plan.value;
      changed += 1;
    });
    if (changed && recalc) table.recalc();
    return changed;
  }

  // ---------------------------------------------------------------- events
  function onChange(event) {
    const el = event.target;
    if (!el) return;
    if (el.id === 'i-tax-form') { setInvoiceTaxForm(el.value); return; }
    if (el.id === 'q-vat') { rebaseDefaultPrices('q-items-body'); return; }
    if (el.id === 'i-vat') { rebaseDefaultPrices('i-items-body'); return; }
    const table = tableOf(el);
    if (!table) return;
    if (el.matches('input[data-field="product"]')) { applyDefaultPrice(el); return; }
    if (el.matches(table.unit)) el.dataset.unitSource = 'user';
  }
  // Typing in a unit-price cell makes it the user's price, even when the typed
  // number equals what the autofill wrote: the autofill markers are removed so
  // a product change, VAT re-base or tax-form switch treats it as typed.
  // Programmatic writes (autofill, VAT conversion, rows rebuilt from saved
  // documents) only set .value and never dispatch 'input', so they do not
  // take ownership away from the autofill.
  function onInput(event) {
    const el = event.target;
    const table = tableOf(el);
    if (!table || !el.matches(table.price)) return;
    el.dataset.priceOwner = 'user';
    delete el.dataset.masterFilled;
    delete el.dataset.masterPrice;
  }
  function boot() {
    document.addEventListener('change', onChange);
    document.addEventListener('input', onInput);
    renderTaxFormUi(invoiceTaxForm());
  }

  window.ERPSalesFormAssist = Object.freeze({
    invoiceTaxForm,
    setInvoiceTaxForm,
    enforceInvoiceTaxForm,
    applyDefaultPrice,
    rebaseDefaultPrices
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
