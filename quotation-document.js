import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

const COMPANY_LOGO_URL = new URL('./logo.png', import.meta.url).href;
const QUOTE_CSS_URL = new URL('./quotation-document.css', import.meta.url).href;
const ITEMS_PER_PAGE = 10;
let currentQuote = null;

const BRANCH_DEFAULTS = {
  khonkaen: {
    label: 'สาขาที่ 00001',
    companyNameTh: 'บริษัท ตัวอย่าง จำกัด',
    companyNameEn: 'EXAMPLE CO., LTD.',
    addressTh: '22/7 หมู่ 17 ตำบลในเมือง อำเภอเมืองขอนแก่น จังหวัดขอนแก่น 40000',
    phone: '082-3160881, 089-4921941',
    taxId: '0435548000010'
  },
  ubon: {
    label: 'สาขาสำนักงานใหญ่',
    companyNameTh: 'บริษัท ตัวอย่าง จำกัด',
    companyNameEn: 'EXAMPLE CO., LTD.',
    addressTh: '164/3 ถนนอุบล-ตระการ ตำบลในเมือง อำเภอเมือง จังหวัดอุบลราชธานี 34000',
    phone: '0-4524-0661, 0-4524-0662',
    taxId: '0345548000010'
  }
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[ch]));
}

function fmt(value) {
  return Number(value || 0).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatThaiDate(value) {
  if (!value) return '-';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  const months = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  return `${date.getDate()} ${months[date.getMonth()]} พ.ศ. ${date.getFullYear() + 543} (ค.ศ. ${date.getFullYear()})`;
}

function thaiIntegerText(num) {
  const digits = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const positions = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
  const n = Math.floor(Math.abs(Number(num) || 0));
  if (n === 0) return 'ศูนย์';
  if (n >= 1000000) {
    const high = Math.floor(n / 1000000);
    const low = n % 1000000;
    return `${thaiIntegerText(high)}ล้าน${low ? thaiIntegerText(low) : ''}`;
  }
  const text = String(n).padStart(6, '0');
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    const digit = Number(text[i]);
    if (!digit) continue;
    const pos = 5 - i;
    if (pos === 1 && digit === 1) out += '';
    else if (pos === 1 && digit === 2) out += 'ยี่';
    else if (pos === 0 && digit === 1 && n > 10) out += 'เอ็ด';
    else out += digits[digit];
    out += positions[pos];
  }
  return out;
}

function bahtText(value) {
  const amount = Math.round((Number(value) || 0) * 100) / 100;
  const baht = Math.floor(amount);
  const satang = Math.round((amount - baht) * 100);
  return `${thaiIntegerText(baht)}บาท${satang ? `${thaiIntegerText(satang)}สตางค์` : 'ถ้วน'}`;
}

function storageKey(branch, year, month) {
  return `biz2_${branch}_${year}_${String(Number(month) + 1).padStart(2, '0')}`;
}

function loadQuote(branch, year, month, id) {
  try {
    const raw = localStorage.getItem(storageKey(branch, year, month));
    const data = raw ? JSON.parse(raw) : {};
    return (Array.isArray(data.quotes) ? data.quotes : []).find(row =>
      String(row.id) === String(id) || (row.firebaseId && String(row.firebaseId) === String(id))
    ) || null;
  } catch (error) {
    console.error('โหลดใบเสนอราคาไม่สำเร็จ', error);
    return null;
  }
}

function branchInfo(branch) {
  return BRANCH_DEFAULTS[branch] || BRANCH_DEFAULTS.ubon;
}

function agencyLabel(quote) {
  const group = quote.customerAgencyGroupLabel || '';
  const type = quote.customerAgencyTypeLabel || '';
  if (group && type) return `${group} / ${type}`;
  return group || type || '-';
}

function safeItems(quote) {
  const items = Array.isArray(quote?.items) ? quote.items : [];
  return items.map(item => ({
    product: item.product || '',
    qty: Number(item.qty || 0),
    unit: item.unit || '',
    priceUnit: Number(item.priceUnit || 0),
    total: Number(item.total ?? (Number(item.qty || 0) * Number(item.priceUnit || 0)))
  }));
}

function splitItems(items) {
  if (!items.length) return [[]];
  const pages = [];
  for (let i = 0; i < items.length; i += ITEMS_PER_PAGE) pages.push(items.slice(i, i + ITEMS_PER_PAGE));
  return pages;
}

function headerHtml(quote, pageNo, totalPages) {
  const branch = branchInfo(quote.branch);
  return `
    <header class="qdoc-header">
      <div class="qdoc-brand-block">
        <img class="qdoc-logo" src="${COMPANY_LOGO_URL}" alt="โลโก้บริษัท ตัวอย่าง จำกัด">
        <div class="qdoc-company-copy">
          <div class="qdoc-company-th">${escapeHtml(branch.companyNameTh)}</div>
          <div class="qdoc-company-en">${escapeHtml(branch.companyNameEn)}</div>
          <div class="qdoc-branch-pill">${escapeHtml(branch.label)}</div>
          <div class="qdoc-company-meta">${escapeHtml(branch.addressTh)}</div>
          <div class="qdoc-company-meta">เลขประจำตัวผู้เสียภาษี ${escapeHtml(branch.taxId)} · โทร. ${escapeHtml(branch.phone)}</div>
        </div>
      </div>
      <div class="qdoc-title-block">
        <div class="qdoc-title-th">ใบเสนอราคา</div>
        <div class="qdoc-title-en">QUOTATION</div>
        <div class="qdoc-page-counter">หน้า ${pageNo} / ${totalPages}</div>
      </div>
    </header>`;
}

function infoHtml(quote) {
  return `
    <section class="qdoc-info-grid">
      <div class="qdoc-info-card">
        <div class="qdoc-card-title"><span>●</span> ข้อมูลลูกค้า / Customer</div>
        <dl class="qdoc-data-list">
          <div><dt>ชื่อลูกค้า</dt><dd>${escapeHtml(quote.customer || '-')}</dd></div>
          <div><dt>ประเภทหน่วยงาน</dt><dd>${escapeHtml(agencyLabel(quote))}</dd></div>
        </dl>
      </div>
      <div class="qdoc-info-card qdoc-doc-info">
        <div class="qdoc-card-title qdoc-card-title-blue"><span>◆</span> ข้อมูลเอกสาร / Document Info</div>
        <dl class="qdoc-data-list">
          <div><dt>เลขที่ใบเสนอราคา</dt><dd><b>${escapeHtml(quote.no || '-')}</b></dd></div>
          <div><dt>วันที่เสนอราคา</dt><dd>${escapeHtml(formatThaiDate(quote.date))}</dd></div>
          <div><dt>พนักงานขาย</dt><dd>${escapeHtml(quote.salesPerson || '-')}</dd></div>
          <div><dt>สถานะ</dt><dd><span class="qdoc-status ${quote.approved ? 'approved' : 'pending'}">${quote.approved ? 'อนุมัติแล้ว' : 'รอการอนุมัติ'}</span></dd></div>
        </dl>
      </div>
    </section>`;
}

function itemsTableHtml(items, pageNo) {
  const fillRows = Math.max(0, Math.min(4, ITEMS_PER_PAGE - items.length));
  const rows = items.map((item, index) => `
    <tr>
      <td class="qdoc-center">${((pageNo - 1) * ITEMS_PER_PAGE) + index + 1}</td>
      <td class="qdoc-product">${escapeHtml(item.product || '-')}</td>
      <td class="qdoc-center">${fmt(item.qty)}</td>
      <td class="qdoc-center">${escapeHtml(item.unit || '-')}</td>
      <td class="qdoc-money">${fmt(item.priceUnit)}</td>
      <td class="qdoc-money"><b>${fmt(item.total)}</b></td>
    </tr>`).join('');
  const blanks = Array.from({ length: fillRows }, () => `
    <tr class="qdoc-empty-row"><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td></tr>`).join('');
  return `
    <section class="qdoc-items-section">
      <table class="qdoc-items-table">
        <thead><tr>
          <th>ลำดับ<br><small>No.</small></th>
          <th>รายการสินค้า / บริการ<br><small>Description</small></th>
          <th>จำนวน<br><small>Qty</small></th>
          <th>หน่วย<br><small>Unit</small></th>
          <th>ราคาต่อหน่วย<br><small>Unit Price</small></th>
          <th>จำนวนเงิน<br><small>Amount</small></th>
        </tr></thead>
        <tbody>${rows}${blanks}</tbody>
      </table>
    </section>`;
}

function summaryHtml(quote) {
  const subtotal = Number(quote.subtotal || 0);
  const vat = Number(quote.vatAmt || 0);
  const grand = Number(quote.total || subtotal + vat);
  return `
    <section class="qdoc-bottom-grid">
      <div class="qdoc-remark-card">
        <div class="qdoc-card-title"><span>✦</span> หมายเหตุ / Remark</div>
        <div class="qdoc-remark-text">${escapeHtml(quote.note || 'ไม่มีหมายเหตุเพิ่มเติม')}</div>
        <div class="qdoc-vat-note">${quote.useVat ? 'ราคานี้ยังไม่รวมภาษีมูลค่าเพิ่ม 7% และแสดง VAT แยกด้านขวา' : 'เอกสารฉบับนี้ไม่มีการคิด VAT เพิ่มจากยอดสินค้า'}</div>
      </div>
      <div class="qdoc-summary-card">
        <div class="qdoc-summary-row"><span>ยอดรวมก่อนภาษี</span><strong>${fmt(subtotal)}</strong></div>
        <div class="qdoc-summary-row"><span>ภาษีมูลค่าเพิ่ม 7%</span><strong>${quote.useVat ? fmt(vat) : '0.00'}</strong></div>
        <div class="qdoc-summary-row qdoc-grand"><span>ยอดรวมทั้งสิ้น</span><strong>${fmt(grand)}</strong></div>
        <div class="qdoc-baht-text">( ${escapeHtml(bahtText(grand))} )</div>
      </div>
    </section>
    <section class="qdoc-signatures">
      <div class="qdoc-sign-box">
        <div class="qdoc-sign-label">ผู้เสนอราคา / Prepared by</div>
        <div class="qdoc-sign-line"></div>
        <div class="qdoc-sign-name">${escapeHtml(quote.salesPerson || '................................................')}</div>
        <div class="qdoc-sign-date">วันที่ ${escapeHtml(formatThaiDate(quote.date))}</div>
      </div>
      <div class="qdoc-sign-box">
        <div class="qdoc-sign-label">ผู้อนุมัติ / Approved by</div>
        <div class="qdoc-sign-line"></div>
        <div class="qdoc-sign-name">................................................</div>
        <div class="qdoc-sign-date">วันที่ ................................................</div>
      </div>
    </section>`;
}

function continuationHtml(pageNo, totalPages) {
  return `<div class="qdoc-continuation">มีรายการต่อหน้าถัดไป · Continued on next page (${pageNo}/${totalPages})</div>`;
}

function footerHtml(quote) {
  const branch = branchInfo(quote.branch);
  return `
    <footer class="qdoc-footer">
      <div><b>${escapeHtml(branch.companyNameTh)}</b> · ${escapeHtml(branch.label)}</div>
      <div>ขอบคุณที่ให้ความไว้วางใจในสินค้าและบริการของเรา</div>
    </footer>`;
}

function pageHtml(quote, pageItems, pageNo, totalPages) {
  const isLast = pageNo === totalPages;
  return `
    <article class="qdoc-document-page">
      <div class="qdoc-accent qdoc-accent-top"></div>
      ${headerHtml(quote, pageNo, totalPages)}
      ${infoHtml(quote)}
      ${itemsTableHtml(pageItems, pageNo)}
      ${isLast ? summaryHtml(quote) : continuationHtml(pageNo, totalPages)}
      ${footerHtml(quote)}
      <div class="qdoc-accent qdoc-accent-bottom"></div>
    </article>`;
}

function documentPagesHtml(quote) {
  const pages = splitItems(safeItems(quote));
  return pages.map((pageItems, index) => pageHtml(quote, pageItems, index + 1, pages.length)).join('');
}

function mountFeature() {
  if (document.getElementById('panel-quotation-document')) return;
  const main = document.querySelector('.main');
  if (!main) return;
  const panel = document.createElement('div');
  panel.id = 'panel-quotation-document';
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="qdoc-shell">
      <div class="qdoc-toolbar">
        <div class="qdoc-toolbar-brand">
          <img src="${COMPANY_LOGO_URL}" alt="โลโก้">
          <div><small>บริษัท ตัวอย่าง จำกัด</small><h2>ใบเสนอราคา / Quotation</h2><p>ใช้ข้อมูลเดิมจากฟอร์มใบเสนอราคา โดยไม่เพิ่มขั้นตอนการกรอก</p></div>
        </div>
        <div class="qdoc-toolbar-actions">
          <button type="button" class="qdoc-btn" data-qdoc-action="back">← กลับรายการ</button>
          <button type="button" class="qdoc-btn" data-qdoc-action="print">🖨️ พิมพ์</button>
          <button type="button" class="qdoc-btn qdoc-btn-primary" data-qdoc-action="pdf">📄 ดาวน์โหลด PDF</button>
        </div>
      </div>
      <div class="qdoc-preview-wrap"><div id="qdoc-preview"></div></div>
    </div>`;
  main.appendChild(panel);
  panel.addEventListener('click', event => {
    const action = event.target.closest('[data-qdoc-action]')?.dataset.qdocAction;
    if (!action) return;
    if (action === 'back') {
      window.go?.('quote-list', document.querySelector('.nav-item[onclick*="quote-list"]'));
    } else if (action === 'print') {
      printQuote();
    } else if (action === 'pdf') {
      downloadQuotePdf(event.target.closest('button'));
    }
  });
}

function renderCurrentQuote() {
  const preview = document.getElementById('qdoc-preview');
  if (!preview) return;
  if (!currentQuote) {
    preview.innerHTML = '<div class="qdoc-empty">ยังไม่ได้เลือกใบเสนอราคา</div>';
    return;
  }
  preview.innerHTML = `<div class="qdoc-pages-stack">${documentPagesHtml(currentQuote)}</div>`;
}

function openQuoteDocument(branch, year, month, id) {
  mountFeature();
  const quote = loadQuote(branch, Number(year), Number(month), id);
  if (!quote) {
    alert('ไม่พบใบเสนอราคาที่ต้องการแสดง อาจถูกลบหรือย้ายไปเดือนอื่นแล้ว');
    return;
  }
  currentQuote = { ...quote, branch, _y: Number(year), _m: Number(month) };
  renderCurrentQuote();
  window.go?.('quotation-document', null);
  setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 0);
}

async function waitForAssets(root) {
  try { if (document.fonts?.ready) await document.fonts.ready; } catch (_) {}
  const images = [...root.querySelectorAll('img')];
  await Promise.all(images.map(async image => {
    if (image.complete && image.naturalWidth > 0) return;
    try {
      if (image.decode) await image.decode();
      else await new Promise(resolve => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
      });
    } catch (_) {}
  }));
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function downloadQuotePdf(button) {
  if (!currentQuote) return;
  const originalText = button?.textContent || '';
  if (button) { button.disabled = true; button.textContent = 'กำลังสร้าง PDF...'; }
  const stage = document.createElement('div');
  stage.className = 'qdoc-pdf-stage';
  stage.innerHTML = documentPagesHtml(currentQuote);
  document.body.appendChild(stage);
  try {
    await waitForAssets(stage);
    const pages = [...stage.querySelectorAll('.qdoc-document-page')];
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    for (let i = 0; i < pages.length; i += 1) {
      const canvas = await html2canvas(pages[i], {
        scale: 2.35,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        imageTimeout: 15000
      });
      if (i > 0) pdf.addPage('a4', 'portrait');
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297, undefined, 'FAST');
    }
    const safeName = String(currentQuote.no || 'quotation').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 100);
    pdf.save(`${safeName}.pdf`);
  } catch (error) {
    console.error(error);
    alert(`สร้าง PDF ใบเสนอราคาไม่สำเร็จ: ${error?.message || error}`);
  } finally {
    stage.remove();
    if (button) { button.disabled = false; button.textContent = originalText; }
  }
}

function printQuote() {
  if (!currentQuote) return;
  const printWindow = window.open('', '_blank', 'noopener,noreferrer');
  if (!printWindow) {
    alert('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต Pop-up สำหรับเว็บไซต์นี้');
    return;
  }
  const cssUrl = QUOTE_CSS_URL;
  const html = documentPagesHtml(currentQuote);
  printWindow.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(currentQuote.no || 'Quotation')}</title><link rel="stylesheet" href="${cssUrl}"><style>body{margin:0;background:#fff}.qdoc-document-page{page-break-after:always;margin:0 auto}.qdoc-document-page:last-child{page-break-after:auto}@page{size:A4 portrait;margin:0}</style></head><body>${html}<script>window.onload=()=>setTimeout(()=>window.print(),500)<\/script></body></html>`);
  printWindow.document.close();
}

window.openQuoteDocument = openQuoteDocument;
window.downloadQuotePdf = downloadQuotePdf;
window.printQuote = printQuote;

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountFeature);
else mountFeature();
