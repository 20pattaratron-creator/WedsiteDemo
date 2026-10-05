// ============================================================================
// credit-note-document.js — printable A4 Credit Note (ใบลดหนี้) renderer
// ERP DEMO 4.3.1
//
// Renders every field Revenue Code §86/10 requires on a credit note: the words
// "ใบลดหนี้", seller name/address/tax ID (+ branch), buyer name/address/tax ID,
// credit note number and date, the original tax invoice number(s), original
// value, correct value, difference, VAT on the difference and the reason.
// Follows the receipt/delivery-tax renderers: original + copy pages, preview
// modal, print window and html2canvas/jsPDF PDF. Rendering is side-effect free;
// persistence stays in erp-credit-note.js.
// ============================================================================
import { escapeHtml, fmt, formatDate, bahtText, safeFilename } from './erp-shared-core.js';
import { CREDIT_NOTE_VAT_MODE_LABELS, isCreditNoteLive, creditNoteReasonLabel, paginateCreditNoteDocument } from './erp-credit-note-core.js';
import { icon } from './erp-icons.js';
import { companyLogoUrl, documentCompany } from './erp-company-profile-core.js';
import { COMPANY_PROFILE_CHANGED_EVENT } from './erp-storage-contracts.js';

(() => {
  'use strict';
  // ADR-020: customer logo once saved (data URL), else ./logo.png; updated on COMPANY_PROFILE_CHANGED_EVENT.
  let COMPANY_LOGO_URL = companyLogoUrl();
  const PAGE_TYPES = Object.freeze([
    Object.freeze({ id: 'original', tab: 'ต้นฉบับ/ORIGINAL', audience: 'สำหรับลูกค้า / CUSTOMER' }),
    Object.freeze({ id: 'copy', tab: 'สำเนา/COPY', audience: 'สำหรับบัญชี / ACCOUNTING' })
  ]);
  const BRANCH_DEFAULTS = {
    khonkaen: {
      label: 'สาขาที่ 00001',
      companyNameTh: 'บริษัท ตัวอย่าง จำกัด (สาขาที่ 00001)',
      companyNameEn: 'EXAMPLE CO., LTD. (BRANCH 00001)',
      addressTh: '99/1 ถนนตัวอย่าง ตำบลในเมือง อำเภอเมืองขอนแก่น จังหวัดขอนแก่น 40000',
      addressEn: '99/1 Example Rd. T.Nai-Muang A.Muang Khonkaen Khonkaen 40000',
      phone: '000-000-0000',
      taxId: '0000000000000'
    },
    ubon: {
      label: 'สาขาสำนักงานใหญ่',
      companyNameTh: 'บริษัท ตัวอย่าง จำกัด (สาขาสำนักงานใหญ่)',
      companyNameEn: 'EXAMPLE CO., LTD. (HEAD OFFICE)',
      addressTh: '88/2 ถนนตัวอย่าง ตำบลในเมือง อำเภอเมือง จังหวัดอุบลราชธานี 34000',
      addressEn: '88/2 Example Rd. T.Nai-Muang A.Muang Ubonratchathani 34000',
      phone: 'Tel: 000-000-0000   Fax: 000-000-0000',
      taxId: '0000000000000'
    }
  };
  let pdfLogoDataUrl = '';

  const notifyUser = (message, type) => { if (typeof window.notify === 'function') window.notify(message, type); else console.warn('[CreditNoteDocument]', message); };
  const text = value => escapeHtml(String(value ?? '')).replace(/\n/g, '<br>');

  // Same precedence as receipt-document.js: tenant company profile first, demo defaults last.
  function branchCompany(branch) {
    const custom = documentCompany(window.CurrentUser, branch, 'credit-note', 'ubon'); // ADR-020: saved company profile
    if (custom) return custom;
    const fallback = BRANCH_DEFAULTS[branch] || BRANCH_DEFAULTS.ubon;
    const profile = window.CurrentUser?.companyProfile || {};
    const branchProfile = profile?.branches?.[branch] || {};
    const tenantName = window.CurrentUser?.tenantName || window.CurrentUser?.companyName || '';
    return {
      ...fallback,
      ...branchProfile,
      companyNameTh: branchProfile.companyNameTh || branchProfile.nameTh || profile.companyNameTh || profile.nameTh || tenantName || fallback.companyNameTh,
      companyNameEn: branchProfile.companyNameEn || branchProfile.nameEn || profile.companyNameEn || profile.nameEn || fallback.companyNameEn,
      addressTh: branchProfile.addressTh || profile.addressTh || fallback.addressTh,
      addressEn: branchProfile.addressEn || profile.addressEn || fallback.addressEn,
      phone: branchProfile.phone || profile.phone || fallback.phone,
      taxId: branchProfile.taxId || profile.taxId || fallback.taxId,
      label: branchProfile.label || branchProfile.name || fallback.label
    };
  }

  function lineRowHtml(line, number) {
    const prior = Number(line.priorCreditedValue) > 0
      ? `<small class="cn-doc-prior">ตามใบกำกับภาษี ${fmt(line.invoiceValue)} หักลดหนี้ก่อนหน้า ${fmt(line.priorCreditedValue)}</small>`
      : '';
    return `<tr>
      <td class="cn-doc-center">${number}</td>
      <td><b>${text(line.invoiceNo)}</b></td>
      <td class="cn-doc-center">${text(formatDate(line.invoiceDate))}</td>
      <td class="num">${fmt(line.originalValue)}${prior}</td>
      <td class="num">${fmt(line.correctValue)}</td>
      <td class="num">${fmt(line.difference)}</td>
    </tr>`;
  }

  // `items` = this page's share of the returned goods (paginateCreditNoteDocument).
  function returnItemsHtml(items) {
    if (!items.length) return '';
    return `<table class="cn-doc-table cn-doc-return-table">
      <thead><tr><th>สินค้าที่รับคืน<br><span>Returned goods</span></th><th>อ้างอิงใบกำกับภาษี<br><span>Tax invoice</span></th><th>จำนวน<br><span>Qty</span></th><th>หน่วย<br><span>Unit</span></th></tr></thead>
      <tbody>${items.map(item => `<tr><td>${text([item.productCode, item.product].filter(Boolean).join(' · '))}</td><td class="cn-doc-center">${text(item.invoiceNo)}</td><td class="num">${fmt(item.qty)}</td><td class="cn-doc-center">${text(item.unit || '-')}</td></tr>`).join('')}</tbody>
    </table>`;
  }

  function signBox(th, en, note = '') {
    return `<div class="cn-doc-sign-box"><div class="cn-doc-sign-head"><b>${th}</b><span>${en}</span></div><div class="cn-doc-sign-body">${note ? `<small>${note}</small>` : ''}<div class="cn-doc-sign-line"></div><div class="cn-doc-sign-date">วันที่ / Date ____/____/______</div></div></div>`;
  }

  function pageHtml(record, pageType, pageInfo, pdfMode) {
    const company = branchCompany(record.branch);
    const logoSrc = pdfMode && pdfLogoDataUrl ? pdfLogoDataUrl : COMPANY_LOGO_URL;
    const { chunk, returnItems, fillerRows, pageNumber, totalPages, startIndex } = pageInfo;
    const isFinal = pageNumber === totalPages;
    const vatMode = record.vatMode || 'none';
    const reason = record.reasonLabel || creditNoteReasonLabel(record.reasonCode) || '-';
    const invoiceNos = (record.lines || []).map(line => line.invoiceNo).filter(Boolean);
    // Blank filler rows (the familiar 8-row grid) are part of the page's row budget.
    const emptyRows = fillerRows;
    const showLines = chunk.length > 0 || !returnItems.length;
    const money = amount => (isFinal ? fmt(amount) : '');
    return `
    <article class="cn-doc-page${pdfMode ? ' cn-doc-pdf-page' : ''}" data-page-id="${pageType.id}" data-item-page="${pageNumber}">
      ${record.previewOnly ? '<div class="cn-doc-draft-stamp" aria-label="ตัวอย่างเอกสาร">ตัวอย่าง / DRAFT – ยังไม่ออกเอกสาร</div>' : ''}
      ${isCreditNoteLive(record) ? '' : `<div class="cn-doc-void-stamp">ยกเลิก / VOID${record.voidReason ? `<small>${text(record.voidReason)}</small>` : ''}</div>`}
      <header class="cn-doc-header">
        <div class="cn-doc-company">
          <img src="${logoSrc}" alt="Company Logo" crossorigin="anonymous" decoding="sync">
          <div>
            <div class="cn-doc-company-th">${text(company.companyNameTh)}</div>
            <div class="cn-doc-company-en">${text(company.companyNameEn)}</div>
            <div class="cn-doc-contact">${text(company.addressTh)}</div>
            <div class="cn-doc-contact">${text(company.addressEn)}</div>
            <div class="cn-doc-contact">${text(company.phone)}</div>
            <div class="cn-doc-tax">เลขประจำตัวผู้เสียภาษี ${text(company.taxId)} · ${text(company.label)}</div>
          </div>
        </div>
        <div class="cn-doc-title">
          <span class="cn-doc-copy-label">${pageType.tab}</span>
          <h2>ใบลดหนี้</h2>
          <div class="cn-doc-title-en">CREDIT NOTE</div>
          <small>${pageType.audience}</small>
        </div>
      </header>

      <section class="cn-doc-meta">
        <div class="cn-doc-party">
          <div><b>ชื่อผู้ซื้อ / Customer :</b> ${text(record.customer)}</div>
          <div><b>ที่อยู่ / Address :</b> ${text(record.customerAddress || '-')}</div>
          <div><b>เลขประจำตัวผู้เสียภาษี / Tax ID :</b> ${text(record.customerTaxId || '-')}</div>
          ${record.customerBranch ? `<div><b>สาขา / Branch :</b> ${text(record.customerBranch)}</div>` : ''}
        </div>
        <div class="cn-doc-docinfo">
          <div><span>เลขที่ / No.</span><strong>${text(record.no)}</strong></div>
          <div><span>วันที่ / Date</span><strong>${text(formatDate(record.date))}</strong></div>
          <div><span>อ้างอิงใบกำกับภาษีเลขที่ / Ref. Tax Invoice</span><strong>${text(invoiceNos.join(', ') || '-')}</strong></div>
          ${totalPages > 1 ? `<div><span>หน้า / Page</span><strong>${pageNumber}/${totalPages}</strong></div>` : ''}
        </div>
      </section>

      ${showLines ? `<table class="cn-doc-table">
        <thead><tr>
          <th>ลำดับ<br><span>No.</span></th>
          <th>ใบกำกับภาษีเดิมเลขที่<br><span>Original Tax Invoice No.</span></th>
          <th>ลงวันที่<br><span>Date</span></th>
          <th>มูลค่าตามใบกำกับภาษีเดิม<br><span>Original Value</span></th>
          <th>มูลค่าที่ถูกต้อง<br><span>Correct Value</span></th>
          <th>ผลต่าง<br><span>Difference</span></th>
        </tr></thead>
        <tbody>${chunk.map((line, index) => lineRowHtml(line, startIndex + index + 1)).join('')}${Array.from({ length: emptyRows }, () => '<tr class="cn-doc-empty"><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td></tr>').join('')}</tbody>
      </table>` : ''}
      ${returnItemsHtml(returnItems)}

      <section class="cn-doc-bottom">
        <div class="cn-doc-reason">
          <div><b>เหตุผลในการลดหนี้ / Reason :</b> ${text(reason)}${record.reasonText ? ` — ${text(record.reasonText)}` : ''}</div>
          <div class="cn-doc-vat-mode">ฐานราคาตามใบกำกับภาษีเดิม: ${text(CREDIT_NOTE_VAT_MODE_LABELS[vatMode] || '-')} · มูลค่าในตารางเป็นมูลค่าก่อนภาษีมูลค่าเพิ่ม</div>
          ${record.note ? `<div>หมายเหตุ: ${text(record.note)}</div>` : ''}
          ${isFinal ? '' : `<div class="cn-doc-next-page">มีรายการต่อหน้าถัดไป (${pageNumber + 1}/${totalPages})</div>`}
          <div class="cn-doc-baht"><b>ตัวอักษร<br><span>Baht</span></b><strong>${isFinal ? text(bahtText(record.total)) : 'มีรายการต่อหน้าถัดไป'}</strong></div>
        </div>
        <div class="cn-doc-totals">
          <div><span>รวมมูลค่าตามใบกำกับภาษีเดิม<br><em>Total original value</em></span><strong>${money(record.originalValue)}</strong></div>
          <div><span>มูลค่าที่ถูกต้อง<br><em>Correct value</em></span><strong>${money(record.correctValue)}</strong></div>
          <div><span>ผลต่าง (มูลค่าที่ลดลง)<br><em>Difference</em></span><strong>${money(record.subtotal)}</strong></div>
          <div><span>${vatMode === 'none' ? 'ไม่มีภาษีมูลค่าเพิ่ม' : 'ภาษีมูลค่าเพิ่ม 7% ของผลต่าง'}<br><em>VAT on difference</em></span><strong>${money(record.vatAmt)}</strong></div>
          <div class="cn-doc-grand"><span>รวมเงินลดหนี้ทั้งสิ้น<br><em>Total credit amount</em></span><strong>${money(record.total)}</strong></div>
        </div>
      </section>

      <section class="cn-doc-sign">
        ${signBox('ผู้รับใบลดหนี้', 'Received by (Customer)', 'ได้รับต้นฉบับใบลดหนี้ไว้เรียบร้อยแล้ว')}
        ${signBox('ผู้จัดทำ', 'Prepared by')}
        ${signBox('ผู้มีอำนาจลงนาม', 'Authorized signature')}
      </section>
      <footer class="cn-doc-footer">ออกตามมาตรา 86/10 แห่งประมวลรัษฎากร · ใช้ปรับลดภาษีขายในเดือนภาษีที่ออกใบลดหนี้ (${text(formatDate(record.date))})</footer>
    </article>`;
  }

  function pagesHtml(record, pageId = 'original', pdfMode = false) {
    const pageType = PAGE_TYPES.find(page => page.id === pageId) || PAGE_TYPES[0];
    const pages = paginateCreditNoteDocument(record?.lines, record?.returnItems);
    return pages.map((page, index) => pageHtml(record || {}, pageType, { chunk: page.lines, returnItems: page.returnItems, fillerRows: page.fillerRows, pageNumber: index + 1, totalPages: pages.length, startIndex: page.lineStart }, pdfMode)).join('');
  }
  function documentSetHtml(record, mode, pageId, pdfMode) {
    return mode === 'current' ? pagesHtml(record, pageId, pdfMode) : PAGE_TYPES.map(page => pagesHtml(record, page.id, pdfMode)).join('');
  }
  function printable(record) {
    if (!record || !Array.isArray(record.lines) || !record.lines.length) { notifyUser('ไม่พบข้อมูลใบลดหนี้สำหรับพิมพ์'); return false; }
    return true;
  }

  function print(record, mode = 'all', pageId = 'original') {
    if (!printable(record)) return false;
    const printWindow = window.open('', '_blank');
    if (!printWindow) { notifyUser('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต Pop-up สำหรับเว็บไซต์นี้'); return false; }
    // Keep the parent handle for document.write; remove child access to the opener.
    printWindow.opener = null;
    // Re-use the page's own stylesheets (in the Vite build credit-note-document.css is
    // bundled into the main CSS asset, so no extra deployment file is required).
    // style.css gives <body> a 76px !important bottom padding for the mobile nav bar;
    // in the print window that padding pushes an exact-A4 page onto a blank extra sheet.
    const links = [...document.querySelectorAll('link[rel="stylesheet"]')].map(link => `<link rel="stylesheet" href="${escapeHtml(link.href)}">`).join('');
    printWindow.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(record.no || 'credit-note')}</title>${links}<style>body{margin:0;background:#fff;display:block}body.cn-doc-print-body{margin:0!important;padding:0!important}.cn-doc-page{page-break-after:always;margin:0 auto;box-shadow:none}.cn-doc-page:last-child{page-break-after:auto}@page{size:A4 portrait;margin:0}</style></head><body class="cn-doc-print-body">${documentSetHtml(record, mode, pageId, false)}<script>window.onload=()=>setTimeout(()=>window.print(),500)<\/script></body></html>`);
    printWindow.document.close();
    return true;
  }

  async function ensurePdfLogoDataUrl() {
    if (pdfLogoDataUrl) return pdfLogoDataUrl;
    if (COMPANY_LOGO_URL.startsWith('data:')) return (pdfLogoDataUrl = COMPANY_LOGO_URL); // customer logo: already a data URL
    try {
      const response = await fetch(COMPANY_LOGO_URL, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`โหลดโลโก้ไม่สำเร็จ (${response.status})`);
      const blob = await response.blob();
      pdfLogoDataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.warn('ไม่สามารถแปลงโลโก้เป็น Data URL ได้ จะใช้ URL ของไฟล์แทน', error);
      pdfLogoDataUrl = COMPANY_LOGO_URL;
    }
    return pdfLogoDataUrl;
  }
  async function waitForStageAssets(stage) {
    try { if (document.fonts?.ready) await document.fonts.ready; } catch (_) { /* best-effort rendering: fallback fonts remain usable */ }
    await Promise.all([...stage.querySelectorAll('img')].map(async image => {
      if (image.complete && image.naturalWidth > 0) return;
      try {
        if (image.decode) await image.decode();
        else await new Promise(resolve => { image.addEventListener('load', resolve, { once: true }); image.addEventListener('error', resolve, { once: true }); });
      } catch (_) { /* best-effort rendering: a failed logo decode must not abort the PDF */ }
    }));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }
  async function downloadPdf(record, mode = 'all', pageId = 'original', button = null) {
    if (!printable(record)) return false;
    const PdfCtor = window.jspdf?.jsPDF;
    if (typeof window.html2canvas !== 'function' || typeof PdfCtor !== 'function') { notifyUser('ยังโหลดไลบรารีสร้าง PDF ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่ หรือใช้ปุ่มพิมพ์ > Save as PDF'); return false; }
    const originalText = button?.textContent;
    if (button) { button.disabled = true; button.textContent = 'กำลังสร้าง PDF...'; }
    let stage = null;
    try {
      await ensurePdfLogoDataUrl();
      stage = document.createElement('div');
      stage.className = 'cn-doc-pdf-stage';
      stage.setAttribute('aria-hidden', 'true');
      stage.innerHTML = documentSetHtml(record, mode, pageId, true);
      document.body.appendChild(stage);
      await waitForStageAssets(stage);
      const pdf = new PdfCtor({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      const pages = [...stage.querySelectorAll('.cn-doc-page')];
      for (let index = 0; index < pages.length; index += 1) {
        const canvas = await window.html2canvas(pages[index], { scale: 2.5, useCORS: true, backgroundColor: '#ffffff', logging: false, imageTimeout: 15000 });
        if (index > 0) pdf.addPage('a4', 'portrait');
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297, undefined, 'FAST');
      }
      pdf.save(`${safeFilename(record.no || 'credit-note')}${mode === 'current' ? `_${pageId}` : '_original-copy-set'}.pdf`);
      return true;
    } catch (error) {
      console.error(error);
      notifyUser(`สร้าง PDF ไม่สำเร็จ: ${error?.message || error}`);
      return false;
    } finally {
      stage?.remove();
      if (button) { button.disabled = false; button.textContent = originalText; }
    }
  }

  function openPreview(sourceRecord, options = {}) {
    if (!printable(sourceRecord)) return null;
    // A not-yet-saved draft carries a DRAFT stamp on every page of the preview, print and PDF.
    const record = options.previewOnly ? { ...sourceRecord, previewOnly: true } : sourceRecord;
    document.getElementById('doc-preview-modal-overlay')?.remove();
    let activeTab = PAGE_TYPES[0].id;
    const overlay = document.createElement('div');
    overlay.id = 'doc-preview-modal-overlay';
    overlay.className = 'doc-preview-modal-overlay cn-doc-preview-overlay';
    overlay.innerHTML = `<div class="doc-preview-modal" role="dialog" aria-label="ตัวอย่างใบลดหนี้">
      <div class="doc-preview-modal-head">
        <div class="doc-preview-modal-title">ใบลดหนี้ ${escapeHtml(record.no || '')}${options.previewOnly ? ' — ตัวอย่างก่อนบันทึก' : ''}</div>
        <div class="cn-doc-preview-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-cn-doc="print-current">${icon('print')}พิมพ์หน้านี้</button>
          <button type="button" class="btn btn-secondary btn-sm" data-cn-doc="print-all">${icon('print')}พิมพ์ต้นฉบับ+สำเนา</button>
          <button type="button" class="btn btn-primary btn-sm" data-cn-doc="pdf">${icon('download')}PDF</button>
          <button type="button" class="doc-preview-modal-close" aria-label="ปิด">${icon('close')}ปิด</button>
        </div>
      </div>
      <div class="doc-preview-modal-tabs"></div>
      <div class="doc-preview-modal-body"><div class="doc-preview-modal-page"></div></div>
    </div>`;
    document.body.appendChild(overlay);
    const tabs = overlay.querySelector('.doc-preview-modal-tabs');
    const page = overlay.querySelector('.doc-preview-modal-page');
    const render = () => {
      tabs.innerHTML = PAGE_TYPES.map(tab => `<button type="button" data-tab="${tab.id}" class="${tab.id === activeTab ? 'active' : ''}">${tab.tab}</button>`).join('');
      page.innerHTML = pagesHtml(record, activeTab, false);
    };
    render();
    const onEsc = event => { if (event.key === 'Escape') close(); };
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onEsc); };
    tabs.addEventListener('click', event => { const button = event.target.closest('button[data-tab]'); if (!button) return; activeTab = button.dataset.tab; render(); });
    overlay.addEventListener('click', event => {
      if (event.target === overlay || event.target.closest('.doc-preview-modal-close')) { close(); return; }
      const action = event.target.closest('[data-cn-doc]')?.dataset.cnDoc;
      if (action === 'print-current') print(record, 'current', activeTab);
      if (action === 'print-all') print(record, 'all', activeTab);
      if (action === 'pdf') downloadPdf(record, 'all', activeTab, event.target.closest('[data-cn-doc]'));
    });
    document.addEventListener('keydown', onEsc);
    return overlay;
  }

  window.addEventListener(COMPANY_PROFILE_CHANGED_EVENT, () => { COMPANY_LOGO_URL = companyLogoUrl(); pdfLogoDataUrl = ''; });
  window.ComformCreditNoteDocument = Object.freeze({
    pageTypes: PAGE_TYPES,
    buildHtml: (record, pageId = 'original') => pagesHtml(record, pageId, false),
    openPreview,
    print,
    downloadPdf
  });
})();
