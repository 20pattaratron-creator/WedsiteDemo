// ============================================================================
// erp-promptpay.js — "QR พร้อมเพย์บนเอกสาร" (ADR-029, round 12)
// ERP DEMO 4.3.1
// ----------------------------------------------------------------------------
// The settings card on ตั้งค่าบริษัท (simple mode too): on / off (default OFF), PromptPay ID (mobile / tax ID /
// e-wallet) or Bill Payment (tag 30, needs a bank agreement), payee name, which documents carry the QR, a live preview
// with its payload, and the scan-test checklist of the main bank apps (the owner must scan-test every one).
// window.ERPPromptPay.decorate(kind, html, ctx) adds the "สแกนจ่ายด้วยพร้อมเพย์" box (QR + amount + payee) to the final page
// of the printed invoice and receipt; billingBoxHtml(billing) to the billing note. With QR off — or a damaged settings
// store, or a cancelled / zero document — decorate() returns the SAME string it was given: the Thai prints stay byte-
// identical (render-golden functions untouched; tests promptpay-app#2). The QR is drawn by erp-qr-core.js (offline SVG).
// ============================================================================
import { normalizePromptPaySettings, defaultPromptPaySettings, payloadForDocument, promptPayIdField, buildPromptPayPayload, buildBillPaymentPayload, untestedBanks, parsePayload, amountToSatang, PROMPTPAY_SCAN_TEST_BANKS, PROMPTPAY_DOCUMENT_KINDS, PROMPTPAY_ID_TYPES } from './erp-promptpay-core.js';
import { encodeQr, qrSvg } from './erp-qr-core.js';
import { PROMPTPAY_KEYS } from './i18n/en-journal.js';
import { translateKey } from './erp-i18n-core.js';
import { escapeHtml, localDateISO } from './erp-shared-core.js';
import { savedProfileOf } from './erp-branches-core.js';
import { PROMPTPAY_SETTINGS_KEY, COMPANY_PROFILE_CHANGED_EVENT, STORAGE_WRITTEN_EVENT } from './erp-storage-contracts.js';
import { icon } from './erp-icons.js';

const PANEL_ID = 'saas-admin';
const WRAP_ID = 'acc-settings-cards';
const CARD_ID = 'promptpay-card';
const esc = value => escapeHtml(String(value ?? ''));
const $ = id => document.getElementById(id);
const storageKey = base => window.ComformTenant?.storageKey?.(base) || base;
const lang = () => (window.ERPI18n?.isEnglish?.() ? 'en' : 'th');
const t = (key, params = {}) => translateKey(PROMPTPAY_KEYS, lang(), key, params);
const say = (message, type = 'info', ms) => (typeof window.notify === 'function' ? window.notify(message, type, ms) : console.info('[PromptPay]', message));
const MONEY = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let previewAmount = '1.00';

// ---------------------------------------------------------------- settings (strict)
function readSettings() {
  return normalizePromptPaySettings(localStorage.getItem(storageKey(PROMPTPAY_SETTINGS_KEY)));
}
function companyName() {
  const user = window.CurrentUser || {};
  return String(savedProfileOf(user)?.nameTh || user.companyProfile?.nameTh || user.companyProfile?.companyNameTh || user.companyName || '').trim();
}
// The ID as printed: a mobile number / e-wallet shows only its last 4 digits; a tax ID is public (it is on the invoice).
function maskedId(settings) {
  const field = promptPayIdField(settings.idType, settings.promptPayId);
  if (!field.ok) return '';
  if (settings.idType === 'tax_id') return field.value;
  const last = field.value.slice(-4);
  return settings.idType === 'mobile' ? `xxx-xxx-${last}` : `xxxxxxxxxxx${last}`;
}

// ---------------------------------------------------------------- the printed box
// Bilingual labels in the box itself (the documents already print "เลขที่/No." style labels), inline styles so the
// preview, the PDF stage and the print window (which loads only the document's stylesheet) look the same.
function boxHtml(settings, plan, ctx) {
  const qr = encodeQr(plan.payload, { ecl: 'M' });
  const svg = qrSvg(qr, { size: ctx.size, sizeMm: ctx.sizeMm || 30, label: 'PromptPay QR' });
  const payee = settings.payeeName || ctx.companyName || companyName();
  const amount = amountToSatang(ctx.amount);
  const idLine = plan.kind === 'bill_payment'
    ? `Biller ID ${esc(settings.billPayment.billerId)} · Ref.1 ${esc(plan.ref1)}${plan.ref2 ? ` · Ref.2 ${esc(plan.ref2)}` : ''}`
    : `พร้อมเพย์ / PromptPay ${esc(maskedId(settings))}${ctx.docNo ? ` · อ้างอิง / Ref. ${esc(ctx.docNo)}` : ''}`;
  // data-bilingual: already Thai + English, so the English print layer (erp-i18n-print.js) adds no second label.
  return `<div class="erp-ppqr" data-erp-ppqr="${esc(plan.kind)}" data-bilingual style="display:flex;align-items:center;gap:.8em;border:1.5px solid #0b3a75;border-radius:.6em;padding:.4em .7em;background:#fff;color:#0f172a;break-inside:avoid;page-break-inside:avoid;line-height:1.3">${svg}<div style="min-width:0;font-size:1em"><div style="font-weight:800;color:#0b3a75">สแกนจ่ายด้วยพร้อมเพย์ <span style="font-weight:600">/ Scan to pay (PromptPay)</span></div><div>ยอดชำระ / Amount <b style="font-size:1.15em">${amount === null ? '' : `${MONEY.format(amount / 100)} บาท`}</b></div>${payee ? `<div>ผู้รับเงิน / Payee <b>${esc(payee)}</b></div>` : ''}<div style="color:#475569;font-size:.85em">${idLine}</div></div></div>`;
}
// The full-form invoice and receipt pages have a fixed A4 layout (the items table, then an absolutely placed bottom
// area). The box never moves anything: on the FINAL page of each copy it is laid over the empty filler rows just above
// the bottom area (left, under the description column) when at least MIN_EMPTY_ROWS of them are left; otherwise it
// gets a page of its own right after that page. The QR is sized in em (10em ≈ 26 mm on A4), so it scales with the page.
const MIN_EMPTY_ROWS = 5;
const FULL_FORM_QR_SIZE = '10em';
function placeOnFinalPages(html, prefix, box, docNo) {
  const parts = String(html).split('<article ');
  let placed = 0;
  const out = parts.map((part, index) => {
    if (index === 0) return part;
    const head = part.slice(0, part.indexOf('>') + 1);
    const anchor = `<div class="${prefix}-doc-bottom-area">`;
    const at = part.indexOf(anchor);
    if (head.includes(`${prefix}-continuation-page`) || at < 0) return `<article ${part}`;
    placed += 1;
    const empty = part.split('<tr class="empty">').length - 1;
    if (empty >= MIN_EMPTY_ROWS) {
      const cut = at + anchor.length;
      return `<article ${part.slice(0, cut)}<div style="position:absolute;left:1.4%;bottom:calc(100% + .9em);max-width:64%;z-index:1">${box}</div>${part.slice(cut)}`;
    }
    const pageId = /data-page-id="([^"]*)"/.exec(head)?.[1] || 'original';
    return `<article ${part}<article class="${prefix}-document-page" data-page-id="${esc(pageId)}" data-ppqr-page="1"><div style="padding:12% 8%;display:flex;flex-direction:column;gap:1.2em;align-items:flex-start"><div style="font-weight:800;font-size:1.3em;color:#0b3a75">${esc(docNo || '')}</div>${box}</div></article>`;
  }).join('');
  return placed ? out : html;
}
// The abbreviated invoice (flowing layout): before its signature row, on every copy's final page.
function insertBefore(html, anchor, box) {
  const parts = String(html).split('<article ');
  let inserted = 0;
  const out = parts.map((part, index) => {
    if (index === 0) return part;
    const at = part.indexOf(anchor);
    if (at < 0) return `<article ${part}`;
    inserted += 1;
    return `<article ${part.slice(0, at)}<div style="margin-top:1em">${box}</div>${part.slice(at)}`;
  }).join('');
  return inserted ? out : html;
}
// kind: 'invoice' | 'receipt'; ctx: { amount (baht), docNo, cancelled, companyName }. Unchanged html when QR is off.
function decorate(kind, html, ctx = {}) {
  let settings;
  try { settings = readSettings(); } catch (error) { console.warn('[PromptPay] settings unreadable — printed without QR', error); return html; }
  if (!settings.enabled || !settings.documents[kind] || ctx.cancelled) return html;
  const plan = payloadForDocument(settings, kind, { amount: ctx.amount, ref: ctx.docNo });
  if (!plan.ok) return html;
  const box = boxHtml(settings, plan, { ...ctx, size: FULL_FORM_QR_SIZE });
  if (kind === 'receipt') return placeOnFinalPages(html, 'rcp', box, ctx.docNo);
  if (String(html).includes('data-tax-invoice-form="abbreviated"')) return insertBefore(html, '<div class="dtd-abbr-foot">', box);
  return placeOnFinalPages(html, 'dtd', box, ctx.docNo);
}
// The billing note (erp-order-flow.js printBilling): the amount still open on it; '' when QR is off / nothing is due.
function billingBoxHtml(billing = {}) {
  let settings;
  try { settings = readSettings(); } catch (error) { return ''; }
  if (!settings.enabled || !settings.documents.billing) return '';
  if (billing.status === 'cancelled' || billing.documentStatus === 'cancelled') return '';
  const open = Number(billing.outstandingAmount);
  const amount = Number.isFinite(open) ? open : Number(billing.totalBilled);
  const plan = payloadForDocument(settings, 'billing', { amount, ref: billing.no });
  if (!plan.ok) return '';
  return `<div style="margin-top:18px">${boxHtml(settings, plan, { amount, docNo: billing.no, sizeMm: 30 })}</div>`;
}

// ---------------------------------------------------------------- settings card
function errorText(code) {
  return t(`error.${code}`);
}
function previewHtml(settings) {
  const draft = { ...settings, enabled: true, documents: { invoice: true, billing: true, receipt: true } };
  const plan = payloadForDocument(draft, 'invoice', { amount: previewAmount, ref: 'INV-TEST' });
  if (!plan.ok) return `<div class="afc-box afc-box-warn" role="status">${esc(errorText(plan.error))}</div>`;
  const parsed = parsePayload(plan.payload);
  // The preview is a piece of a printed document: Thai + English as printed, never translated (data-no-i18n="doc").
  return `<div class="pp-preview"><div data-no-i18n="doc">${boxHtml(draft, plan, { amount: previewAmount, docNo: 'INV-TEST', sizeMm: 34 })}</div><div class="pp-payload"><b>${esc(t('card.payload'))}</b><code data-no-i18n>${esc(plan.payload)}</code><span class="${parsed.crcOk ? 'jc-good' : 'jc-loss'}">${esc(t(parsed.crcOk ? 'card.crcOk' : 'card.crcBad'))}</span></div></div>`;
}
function cardHtml() {
  let settings;
  let damaged = '';
  try { settings = readSettings(); } catch (error) { settings = defaultPromptPaySettings(); damaged = error.message; }
  const field = (id, label, input, hint = '') => `<div class="jc-field"><label for="${id}">${esc(label)}</label>${input}${hint ? `<small class="afc-muted">${esc(hint)}</small>` : ''}</div>`;
  const typeOptions = PROMPTPAY_ID_TYPES.map(type => `<option value="${type}"${settings.idType === type ? ' selected' : ''}>${esc(t(`idType.${type}`))}</option>`).join('');
  const docs = PROMPTPAY_DOCUMENT_KINDS.map(kind => `<label class="jc-check"><input type="checkbox" data-pp-doc="${kind}"${settings.documents[kind] ? ' checked' : ''}><span>${esc(t(`doc.${kind}`))}</span></label>`).join('');
  const banks = PROMPTPAY_SCAN_TEST_BANKS.map(bank => `<label class="jc-check"><input type="checkbox" data-pp-bank="${bank}"${settings.scanTests[bank] ? ' checked' : ''}><span>${esc(t(`bank.${bank}`))}${settings.scanTests[bank] ? ` <small>(${esc(settings.scanTests[bank])})</small>` : ''}</span></label>`).join('');
  const missing = untestedBanks(settings);
  return `<div class="card-title"><span>${icon('payment')}${esc(t('card.title'))}</span></div>
    <p class="afc-note">${esc(t('card.intro'))}</p>
    ${damaged ? `<div class="afc-box afc-box-error" role="alert">${esc(t('card.damaged'))}</div>` : ''}
    <form id="pp-form" novalidate>
      <label class="jc-check pp-enable"><input type="checkbox" id="pp-enabled"${settings.enabled ? ' checked' : ''}><span><b>${esc(t('card.enabled'))}</b></span></label>
      <div class="jc-form-grid">
        ${field('pp-id-type', t('card.idType'), `<select id="pp-id-type">${typeOptions}</select>`)}
        ${field('pp-id', t('card.id'), `<input id="pp-id" autocomplete="off" inputmode="numeric" value="${esc(settings.promptPayId)}" data-no-i18n>`, t('card.idHint'))}
        ${field('pp-payee', t('card.payee'), `<input id="pp-payee" autocomplete="off" value="${esc(settings.payeeName)}" placeholder="${esc(companyName())}" data-no-i18n>`, t('card.payeeHint'))}
      </div>
      <fieldset class="jc-radios"><legend>${esc(t('card.documents'))}</legend>${docs}</fieldset>
      <details class="jc-details pp-bill"${settings.billPayment.enabled ? ' open' : ''}><summary>${esc(t('card.billTitle'))}</summary>
        <div class="afc-box afc-box-warn">${esc(t('card.billWarn'))}</div>
        <label class="jc-check"><input type="checkbox" id="pp-bill-enabled"${settings.billPayment.enabled ? ' checked' : ''}><span>${esc(t('card.billEnabled'))}</span></label>
        <div class="jc-form-grid">${field('pp-biller', t('card.billerId'), `<input id="pp-biller" autocomplete="off" inputmode="numeric" value="${esc(settings.billPayment.billerId)}" data-no-i18n>`)}${field('pp-ref2', t('card.ref2'), `<input id="pp-ref2" autocomplete="off" value="${esc(settings.billPayment.ref2)}" data-no-i18n>`, t('card.refHint'))}</div>
      </details>
      <fieldset class="jc-radios pp-banks"><legend>${esc(t('card.scanTests'))}</legend>${banks}</fieldset>
      <div class="afc-box ${missing.length ? 'afc-box-warn' : 'afc-box-info'}" role="status">${esc(missing.length ? t('card.scanMissing', { n: missing.length }) : t('card.scanDone'))}</div>
      <div class="jc-actions"><button type="submit" class="btn btn-primary">${icon('save')}${esc(t('card.save'))}</button></div>
    </form>
    <div class="pp-preview-wrap"><div class="jc-field pp-amount">${`<label for="pp-preview-amount">${esc(t('card.previewAmount'))}</label><input id="pp-preview-amount" type="number" min="0.01" step="0.01" inputmode="decimal" value="${esc(previewAmount)}">`}</div><div id="pp-preview" aria-live="polite">${previewHtml(settings)}</div></div>
    <p class="afc-note">${esc(t('card.note'))}</p>`;
}
function formSettings(base) {
  const value = id => $(id)?.value ?? '';
  const checked = id => !!$(id)?.checked;
  const today = localDateISO();
  const scanTests = {};
  document.querySelectorAll('#pp-form [data-pp-bank]').forEach(input => { if (input.checked) scanTests[input.dataset.ppBank] = base.scanTests[input.dataset.ppBank] || today; });
  const documents = {};
  document.querySelectorAll('#pp-form [data-pp-doc]').forEach(input => { documents[input.dataset.ppDoc] = input.checked; });
  return { schemaVersion: 1, enabled: checked('pp-enabled'), idType: value('pp-id-type'), promptPayId: value('pp-id').trim(), payeeName: value('pp-payee'), documents, billPayment: { enabled: checked('pp-bill-enabled'), billerId: value('pp-biller').trim(), ref2: value('pp-ref2').trim() }, scanTests, updatedAt: new Date().toISOString() };
}
// Saves the settings (refused with the reason when the switch is on and the ID / biller ID is not valid).
function saveSettings(draft) {
  let base;
  try { base = readSettings(); } catch (error) { base = defaultPromptPaySettings(); }
  const raw = draft || formSettings(base);
  if (raw.enabled) {
    if (raw.billPayment?.enabled) {
      const check = buildBillPaymentPayload({ billerId: raw.billPayment.billerId, ref1: 'TEST', ref2: raw.billPayment.ref2 });
      if (!check.ok) return refuse(errorText(check.error));
    } else {
      const field = promptPayIdField(raw.idType, raw.promptPayId);
      if (!field.ok) return refuse(errorText(field.error));
    }
  }
  let next;
  try { next = normalizePromptPaySettings(raw); } catch (error) { return refuse(t('error.invalid')); }
  try { window.ERPIntegrity.transaction([[storageKey(PROMPTPAY_SETTINGS_KEY), next]]); } catch (error) { return refuse(t('error.save', { message: error.message })); }
  window.ERPProductionCore?.audit?.('update', 'promptpay', 'PROMPTPAY', t('audit.saved', { state: t(next.enabled ? 'state.on' : 'state.off') }), {});
  render();
  say(t('done.saved'), 'success');
  return { ok: true, settings: next };
}
function refuse(message) {
  say(message, 'error', 7000);
  const box = $('pp-message');
  if (box) box.textContent = message;
  return { ok: false, message };
}
function updatePreview() {
  const host = $('pp-preview');
  if (!host) return;
  let base;
  try { base = readSettings(); } catch (error) { base = defaultPromptPaySettings(); }
  const draft = formSettings(base);
  let settings;
  try { settings = normalizePromptPaySettings({ ...draft, enabled: false }); } catch (error) { settings = defaultPromptPaySettings(); }
  host.innerHTML = previewHtml({ ...settings, promptPayId: draft.promptPayId });
}
function mount() {
  const panel = $(`panel-${PANEL_ID}`);
  if (!panel) return null;
  let wrap = $(WRAP_ID);
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = WRAP_ID;
    wrap.className = 'acc-settings-cards';
    const saasCard = [...panel.children].find(el => el.classList.contains('card') && el.id !== 'company-profile-card');
    panel.insertBefore(wrap, saasCard || null);
  }
  let card = $(CARD_ID);
  if (!card) {
    card = document.createElement('section');
    card.id = CARD_ID;
    card.className = 'card pp-card';
    card.setAttribute('aria-labelledby', 'pp-card-title');
    wrap.appendChild(card);
    card.addEventListener('submit', event => { if (event.target.id === 'pp-form') { event.preventDefault(); saveSettings(); } });
    card.addEventListener('input', event => {
      if (event.target.id === 'pp-preview-amount') previewAmount = event.target.value;
      if (event.target.closest('#pp-form') || event.target.id === 'pp-preview-amount') updatePreview();
    });
    card.addEventListener('change', event => { if (event.target.closest('#pp-form')) updatePreview(); });
  }
  return card;
}
function render() {
  const card = mount();
  if (!card) return null;
  card.innerHTML = `${cardHtml()}<p id="pp-message" class="afc-note" role="status" aria-live="polite"></p>`;
  const title = card.querySelector('.card-title span');
  if (title) title.id = 'pp-card-title';
  return card;
}

// ---------------------------------------------------------------- JSON backup (masterData.promptpay)
function exportBackup() {
  return readSettings();
}
function validateBackup(value) {
  if (value === undefined || value === null) return null;
  return normalizePromptPaySettings(value);
}
function backupWrites(value, options = {}) {
  const incoming = validateBackup(value);
  if (!incoming) return [];
  const here = localStorage.getItem(storageKey(PROMPTPAY_SETTINGS_KEY));
  return options.replace || here === null ? [[storageKey(PROMPTPAY_SETTINGS_KEY), incoming]] : [];
}

window.ERPPromptPay = Object.freeze({
  decorate,
  billingBoxHtml,
  readSettings,
  saveSettings,
  render,
  payloadFor: (kind, input) => payloadForDocument(readSettings(), kind, input),
  buildPromptPayPayload,
  exportBackup,
  validateBackup,
  backupWrites,
  t
});

// Re-drawn when its data may have changed (backup restore, reset, another tab): at once while the settings page is open
// and nobody is typing in the card, else when the page is opened next.
let stale = false;
function safeRender() {
  stale = false;
  try { render(); } catch (error) { console.error('[PromptPay] render failed', error); }
}
function boot() {
  safeRender();
  window.addEventListener(COMPANY_PROFILE_CHANGED_EVENT, safeRender);
  window.addEventListener('erp:language-changed', safeRender);
  window.addEventListener(STORAGE_WRITTEN_EVENT, () => {
    const open = $(`panel-${PANEL_ID}`)?.classList.contains('active');
    if (open && !$(CARD_ID)?.contains(document.activeElement)) safeRender(); else stale = true;
  });
  document.addEventListener('erp:navigation', event => { if (event.detail?.id === PANEL_ID && stale) safeRender(); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
