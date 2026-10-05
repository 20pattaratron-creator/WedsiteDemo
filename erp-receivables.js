// ============================================================================
// erp-receivables.js — AR aging report + overdue receivable alerts (Local Demo)
// Thin DOM controller over erp-receivables-core.js (see ADR-010 / ADR-011):
//   * "รายงานอายุลูกหนี้ตามลูกค้า" (#ar-aging-report) — the "ลูกหนี้ค้างรับ" view of
//     the executive dashboard (a view tab of erp-customer-experience.js, so it is
//     visible in the default simple mode): standard buckets, total row,
//     expandable open invoices, CSV export through app.js downloadCsvText();
//   * dismissible banner on the dashboard and on the "งานของฉัน" home page, and a
//     count badge on the dashboard navigation item, for overdue / due-soon invoices.
// Every balance comes from ERPIntegrity.paymentSummary() (credit notes, WHT,
// billing-payment allocations, rounding tolerance). Refreshes only on load and
// after data changes (erp-flow:changed / erp:dashboard-rendered) — no timers,
// no browser Notification API. Uses event delegation: no inline handlers.
// ============================================================================
import { buildReceivableLedger, summarizeReceivableAging, receivableAlertSummary, receivableAgingCsvRows, AR_AGING_BUCKETS, AR_DUE_SOON_DAYS, DUE_BASIS_LABELS, invoiceDueDate } from './erp-receivables-core.js';
import { escapeHtml, fmt, localDateISO } from './erp-shared-core.js';
import { formatThaiDate } from './erp-date-core.js';
import { icon } from './erp-icons.js';
import { branchLabelMap, liveBranchAllLabel } from './erp-branches-core.js';

(() => {
  'use strict';
  const BRANCH_LABELS = branchLabelMap({ ubon: 'สาขาสำนักงานใหญ่', khonkaen: 'สาขาที่ 00001' }); // ADR-022: live labels, both data ids
  const STATE_TONE = Object.freeze({ overdue: 'red', dueToday: 'amber', soon: 'amber', normal: 'blue', none: 'gray' });
  // One banner per host page: the executive dashboard and the "งานของฉัน" home
  // (panel-work-home is created by erp-product-experience.js and may not exist yet).
  const BANNER_HOSTS = Object.freeze([
    // On the dashboard the banner belongs to the ลูกหนี้ค้างรับ view, right above the report (ADR-017).
    Object.freeze({ id: 'ar-overdue-banner', panel: 'panel-dashboard', anchor: 'ar-aging-card' }),
    Object.freeze({ id: 'ar-overdue-banner-home', panel: 'panel-work-home', anchor: 'pe-work-home' })
  ]);
  const expanded = new Set();
  let dismissedSignature = '';
  let refreshQueued = false;
  let lastAlert = null;
  let lastReport = null;
  let lastAsOf = '';
  // Set when a refresh was skipped because the browser tab was hidden; redone when it is shown again.
  let skippedWhileHidden = false;

  const money = value => `฿${fmt(value)}`;
  const dateText = value => (value ? formatThaiDate(value) : '-');
  const branchLabel = value => BRANCH_LABELS[value] || String(value || '-');

  // Branches of the tenant's package — same rule as app.js tenantActiveBranchIds().
  function activeBranches() {
    const rows = Object.keys(BRANCH_LABELS).filter(branch => window.SaaSService?.isBranchActive?.(branch) ?? true);
    return rows.length ? rows : ['ubon'];
  }

  // The branches a dashboard figure covers: the selected one, or '' = every ACTIVE branch. The work
  // queue (erp-order-flow.js) and Decision Review (erp-decision-council.js) cards use the same scope.
  function scopeBranches(branch = '') {
    return branch ? [branch] : activeBranches();
  }
  const scopeLabel = branch => (branch ? branchLabel(branch) : liveBranchAllLabel('ทุกสาขา'));

  // Open receivables as of today. `branch` '' = every ACTIVE branch.
  function snapshot(branch = '') {
    const integrity = window.ERPIntegrity;
    if (!integrity?.business || !integrity?.paymentSummary) return null;
    const business = integrity.business();
    const store = typeof integrity.flow === 'function' ? integrity.flow() : undefined;
    // One prebuilt index for all invoices: paymentSummary() then only looks at rows that can match
    // (identical figures, O(n) instead of O(n²) for the whole report).
    const options = typeof integrity.paymentContext === 'function' && store ? integrity.paymentContext(business, store) : store ? { business, store } : { business };
    const live = typeof integrity.live === 'function' ? integrity.live : () => true;
    const branches = scopeBranches(branch);
    const invoices = (business.invoices || []).filter(invoice => live(invoice) && branches.includes(integrity.branch?.(invoice)));
    const asOf = localDateISO();
    const ledger = buildReceivableLedger(invoices, { asOf, live, summarize: invoice => integrity.paymentSummary(invoice, options) });
    return { asOf, branch, items: ledger.items, credits: ledger.credits, aging: summarizeReceivableAging(ledger.items, ledger.credits), alert: receivableAlertSummary(ledger.items) };
  }

  // ------------------------------------------------------------ alerts
  function dashboardNavItem() {
    return [...document.querySelectorAll('.sidebar .nav-item')].find(item => (item.getAttribute('onclick') || '').includes("go('dashboard'")) || null;
  }

  function renderBadge(alert) {
    const nav = dashboardNavItem();
    if (!nav) return;
    let badge = nav.querySelector('.ar-nav-badge');
    const count = alert?.overdueCount || 0;
    if (!count) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'ar-nav-badge';
      nav.appendChild(badge);
    }
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.title = `ใบแจ้งหนี้เกินกำหนดชำระ ${count} ใบ`;
    badge.setAttribute('aria-label', badge.title);
  }

  function bannerText(alert) {
    const soon = alert.dueSoonCount ? `ครบกำหนดภายใน ${AR_DUE_SOON_DAYS} วันอีก ${alert.dueSoonCount} ใบ (${money(alert.dueSoonTotal)})` : '';
    if (alert.overdueCount) {
      return {
        title: `มีใบแจ้งหนี้เกินกำหนด ${alert.overdueCount} ใบ รวม ${fmt(alert.overdueTotal)} บาท`,
        detail: [`ค้างนานที่สุด ${alert.oldestDaysPastDue} วัน`, soon].filter(Boolean).join(' · ')
      };
    }
    return {
      title: `มีใบแจ้งหนี้ใกล้ครบกำหนดภายใน ${AR_DUE_SOON_DAYS} วัน ${alert.dueSoonCount} ใบ รวม ${fmt(alert.dueSoonTotal)} บาท`,
      detail: 'ติดตามก่อนถึงกำหนดชำระเพื่อลดหนี้ค้างนาน'
    };
  }

  function renderBanner(alert, host) {
    const panel = document.getElementById(host.panel);
    if (!panel) return;
    let banner = document.getElementById(host.id);
    const visible = !!alert && (alert.overdueCount > 0 || alert.dueSoonCount > 0) && alert.signature !== dismissedSignature;
    if (!visible) {
      if (banner) banner.hidden = true;
      return;
    }
    if (!banner) {
      banner = document.createElement('div');
      banner.id = host.id;
      banner.className = 'ar-alert-banner';
      banner.setAttribute('role', 'status');
      const anchor = document.getElementById(host.anchor);
      if (anchor?.parentElement === panel) panel.insertBefore(banner, anchor);
      else panel.prepend(banner);
    }
    const text = bannerText(alert);
    banner.hidden = false;
    banner.dataset.tone = alert.overdueCount ? 'danger' : 'warning';
    banner.innerHTML = `<span class="ar-alert-icon" aria-hidden="true">${alert.overdueCount ? '⚠️' : '⏰'}</span>
      <div class="ar-alert-text"><b>${escapeHtml(text.title)}</b><small>${escapeHtml(text.detail)}</small></div>
      <button type="button" class="btn btn-sm ar-alert-open" data-ar-action="open-report">ดูรายงานอายุลูกหนี้</button>
      <button type="button" class="ar-alert-close" data-ar-action="dismiss" aria-label="ซ่อนการแจ้งเตือนนี้" title="ซ่อนจนกว่าข้อมูลลูกหนี้จะเปลี่ยน">${icon('close')}</button>`;
  }

  function renderBanners(alert) {
    BANNER_HOSTS.forEach(host => renderBanner(alert, host));
  }

  // ------------------------------------------------------------ report
  // Follows the dashboard branch tabs (รวมทั้ง 2 สาขา / สำนักงานใหญ่ / สาขาที่ 00001); shared with the
  // other cards of the dashboard (window.ERPReceivables.selectedBranch) so every figure has one scope.
  function selectedBranch() {
    const tab = document.querySelector('#panel-dashboard .dash-tabs .dtab.active')?.id || '';
    if (tab === 'dt-ub') return 'ubon';
    if (tab === 'dt-kk') return 'khonkaen';
    return '';
  }

  function visibleBuckets(aging) {
    return AR_AGING_BUCKETS.filter(bucket => bucket.key !== 'undated' || aging.hasUndated);
  }

  // "ดูบิล": invoices that exist only as printed issued invoices open in the issued-document view.
  function openInvoiceButton(record) {
    if (!record.id) return '';
    const kind = record.source?._type === 'issuedInvoices' ? 'issuedInvoices' : 'invoice';
    const year = record.source?._year ?? record.year ?? '';
    const month = record.source?._month ?? record.month ?? '';
    return ` <button type="button" class="ar-aging-link" data-ar-action="open-invoice" data-ar-kind="${kind}" data-ar-branch="${escapeHtml(record.branch)}" data-ar-year="${escapeHtml(year)}" data-ar-month="${escapeHtml(month)}" data-ar-id="${escapeHtml(record.id)}">ดูบิล</button>`;
  }

  function detailHtml(row) {
    const refundColumn = row.refundDue > 0;
    const rows = row.items.map(item => `<tr>
        <td><b>${escapeHtml(item.no)}</b>${openInvoiceButton(item)}</td>
        <td>${escapeHtml(branchLabel(item.branch))}</td>
        <td>${escapeHtml(dateText(item.date))}</td>
        <td>${escapeHtml(dateText(item.dueDate))}<br><small>${escapeHtml(DUE_BASIS_LABELS[item.dueBasis] || '')}</small></td>
        <td><span class="badge b-${STATE_TONE[item.state] || 'gray'}">${escapeHtml(item.stateText)}</span></td>
        <td class="num">${money(item.total)}</td>
        <td class="num">${money(item.paid)}${item.credited > 0 ? `<br><small>ลดหนี้ ${money(item.credited)}</small>` : ''}</td>
        <td class="num"><b>${money(item.outstanding)}</b></td>
      </tr>`).join('');
    // Paid-then-credited invoices: money owed back to the customer, listed separately (not AR).
    const creditRows = (row.credits || []).map(credit => `<tr class="ar-aging-refund">
        <td><b>${escapeHtml(credit.no)}</b>${openInvoiceButton(credit)}</td>
        <td>${escapeHtml(branchLabel(credit.branch))}</td>
        <td>${escapeHtml(dateText(credit.date))}</td>
        <td>-</td>
        <td><span class="badge b-purple">เครดิตค้างคืนลูกค้า</span></td>
        <td class="num" colspan="3"><b>${money(credit.refundDue)}</b></td>
      </tr>`).join('');
    return `<table class="ar-aging-invoices"><thead><tr><th>เลขที่บิล</th><th>สาขา</th><th>วันที่บิล</th><th>ครบกำหนด</th><th>สถานะ</th><th class="num">ยอดบิล (รวม VAT)</th><th class="num">รับแล้ว / ลดหนี้</th><th class="num">ค้างรับ${refundColumn ? ' / คืนลูกค้า' : ''}</th></tr></thead><tbody>${rows}${creditRows}</tbody></table>`;
  }

  function reportHtml(snap) {
    const aging = snap.aging;
    const scope = scopeLabel(snap.branch);
    const exportButton = aging.rows.length ? `<button type="button" class="btn btn-secondary btn-sm" data-ar-action="export">${icon('download')}Export CSV</button>` : '';
    const head = `<div class="ar-aging-toolbar"><span>ณ วันที่ <b>${escapeHtml(dateText(snap.asOf))}</b> · ${escapeHtml(scope)} · รวมบิลทุกงวดที่ยังค้างชำระ (ไม่ขึ้นกับตัวกรองปี/เดือน)</span>${exportButton}</div>`;
    if (!aging.rows.length) return `${head}<div class="empty ar-aging-empty">✅ ไม่มีลูกหนี้คงค้าง ณ วันนี้</div>`;
    const buckets = visibleBuckets(aging);
    const totals = aging.totals;
    const overdueShare = totals.total > 0 ? (totals.overdue / totals.total * 100).toFixed(1) : '0.0';
    const walkInNote = totals.walkInInvoiceCount ? ` + หน้าร้าน ${totals.walkInInvoiceCount} บิล` : '';
    const kpis = `<div class="ar-aging-kpis">
        <div><small>ลูกหนี้คงค้างรวม</small><b>${money(totals.total)}</b><span>${totals.invoiceCount} บิล · ${totals.customerCount} ราย${walkInNote}</span></div>
        <div class="tone-red"><small>เกินกำหนดแล้ว</small><b>${money(totals.overdue)}</b><span>${overdueShare}% ของลูกหนี้คงค้าง</span></div>
        <div class="tone-amber"><small>เกิน 90 วัน</small><b>${money(totals.buckets.over_90)}</b><span>ควรติดตามเป็นลำดับแรก</span></div>
      </div>`;
    // "เครดิตค้างคืนลูกค้า" is a separate column: it never reduces the aging buckets.
    const refunds = !!aging.hasRefunds;
    const columns = 3 + buckets.length + (refunds ? 1 : 0);
    const body = aging.rows.map(row => {
      const open = expanded.has(row.key);
      const cells = buckets.map(bucket => {
        const amount = row.buckets[bucket.key];
        const late = bucket.key !== 'current' && amount > 0 ? ' ar-aging-late' : '';
        return `<td class="num${late}">${amount > 0 ? money(amount) : '–'}</td>`;
      }).join('');
      const notes = [];
      if (row.walkIn) notes.push('ขายเงินสด/ใบกำกับภาษีอย่างย่อ รวมเป็นแถวเดียว');
      if (row.oldestDaysPastDue > 0) notes.push(`ค้างนานสุด ${row.oldestDaysPastDue} วัน`);
      const note = notes.join(' · ');
      return `<tr class="ar-aging-customer${row.overdue > 0 ? ' has-overdue' : ''}">
          <td><button type="button" class="ar-aging-toggle" data-ar-action="toggle" data-ar-key="${escapeHtml(row.key)}" aria-expanded="${open}">${icon('chevron', 'ar-aging-caret')}${escapeHtml(row.label)}</button>${note ? `<small>${escapeHtml(note)}</small>` : ''}</td>
          <td class="num">${row.invoiceCount}</td>${cells}<td class="num"><b>${money(row.total)}</b></td>${refunds ? `<td class="num ar-aging-refund-cell">${row.refundDue > 0 ? money(row.refundDue) : '–'}</td>` : ''}
        </tr>
        <tr class="ar-aging-detail"${open ? '' : ' hidden'}><td colspan="${columns}">${detailHtml(row)}</td></tr>`;
    }).join('');
    const foot = `<tr class="ar-aging-total"><th>รวมทั้งหมด</th><th class="num">${totals.invoiceCount}</th>${buckets.map(bucket => `<th class="num">${money(totals.buckets[bucket.key])}</th>`).join('')}<th class="num">${money(totals.total)}</th>${refunds ? `<th class="num">${money(totals.refundDue)}</th>` : ''}</tr>`;
    const table = `<div class="analytics-table-wrap"><table class="analytics-table ar-aging-table"><thead><tr><th>ลูกค้า</th><th class="num">บิลค้าง</th>${buckets.map(bucket => `<th class="num">${escapeHtml(bucket.label)}</th>`).join('')}<th class="num">รวมค้างรับ</th>${refunds ? '<th class="num">เครดิตค้างคืนลูกค้า</th>' : ''}</tr></thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>`;
    const note = '<div class="chart-summary">อายุหนี้นับจากวันครบกำหนด (ตามบิล หรือคำนวณจากเครดิตการชำระ) · บิลเงินสด/หน้าร้านและบิลที่ไม่ระบุเครดิตครบกำหนดวันที่ออกบิล · ยอดค้างหักใบลดหนี้และเงินที่รับแล้ว (ภาษีหัก ณ ที่จ่ายถือว่ารับชำระแล้ว)</div>';
    return head + kpis + table + note;
  }

  // The 2 receivables KPIs of the dashboard's ภาพรวม view (ADR-017): the SAME totals as the report's
  // "ลูกหนี้คงค้างรวม" / "เกินกำหนดแล้ว" (same snapshot, same branch tab), nothing recomputed.
  function summaryKpisHtml(snap) {
    const totals = snap.aging.totals;
    const overdueTone = totals.overdue > 0 ? 'var(--red)' : 'var(--g)';
    return `<div class="mc dash-ar-kpi" data-ar-kpi="outstanding"><div class="lbl">ลูกหนี้คงค้าง (ณ วันนี้)</div><div class="val" style="color:var(--amber)">${fmt(totals.total)}</div><div class="sub">บาท · ${totals.invoiceCount} บิล · ทุกงวด</div></div>`
      + `<div class="mc dash-ar-kpi" data-ar-kpi="overdue"><div class="lbl">เกินกำหนดชำระ</div><div class="val" style="color:${overdueTone}">${fmt(totals.overdue)}</div><div class="sub">บาท · <button type="button" class="btn btn-tertiary btn-sm dash-ar-kpi-link" data-ar-action="open-report">ดูรายงานอายุลูกหนี้</button></div></div>`;
  }

  // `current` (an all-branch snapshot from refresh) is reused when no branch tab is selected.
  function renderReport(current = null) {
    const root = document.getElementById('ar-aging-report');
    if (!root) return null;
    const kpis = document.getElementById('dash-ar-kpis');
    const branch = selectedBranch();
    const snap = current && current.branch === branch ? current : snapshot(branch);
    if (!snap) {
      root.innerHTML = '<div class="empty ar-aging-empty">ยังอ่านข้อมูลลูกหนี้ไม่ได้</div>';
      if (kpis) kpis.innerHTML = '';
      return null;
    }
    lastReport = snap;
    root.innerHTML = reportHtml(snap);
    if (kpis) kpis.innerHTML = summaryKpisHtml(snap);
    return snap;
  }

  function exportCsv() {
    const snap = lastReport || renderReport();
    if (!snap) return false;
    if (typeof window.downloadCsvText !== 'function') {
      window.notify?.('ส่งออก CSV ไม่ได้ในหน้านี้', 'error');
      return false;
    }
    const rows = receivableAgingCsvRows(snap.aging, { formatDate: dateText, branchLabel });
    window.downloadCsvText(`ar-aging-${snap.asOf}${snap.branch ? `-${snap.branch}` : ''}.csv`, rows);
    return true;
  }

  // The report lives in the dashboard's "ลูกหนี้ค้างรับ" view (the dashboard menu is always shown).
  function openReport() {
    window.go?.('dashboard');
    document.querySelector('#erp-dashboard-views [data-dashboard-view="receivables"]')?.click();
    renderReport();
    document.getElementById('ar-aging-card')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  // ------------------------------------------------------------ refresh
  function isPanelActive(id) {
    return !!document.getElementById(id)?.classList.contains('active');
  }

  // Recomputes only what can be seen: nothing while the tab is hidden (marked stale and redone on
  // return) and the report only while the dashboard is the active page. The banner and badge are
  // always shown (single Admin view, ADR-014).
  function refresh() {
    if (document.hidden) {
      skippedWhileHidden = true;
      return null;
    }
    skippedWhileHidden = false;
    const dashboardActive = isPanelActive('panel-dashboard');
    const snap = snapshot('');
    lastAsOf = snap?.asOf || localDateISO();
    lastAlert = snap?.alert || null;
    renderBadge(lastAlert);
    renderBanners(lastAlert);
    // The report is rebuilt when the dashboard is opened (erp:navigation → refresh).
    if (dashboardActive) renderReport(snap);
    return snap;
  }

  // "As of today" figures go out of date at midnight: re-check the business date whenever the user
  // comes back to the page or clicks (cheap string compare, no polling timer).
  function refreshIfOutdated() {
    if (document.hidden) return;
    if (skippedWhileHidden || (lastAsOf && localDateISO() !== lastAsOf)) scheduleRefresh();
  }

  // Coalesces bursts of change events into one recalculation (a microtask, not a timer).
  function scheduleRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(() => {
      refreshQueued = false;
      try {
        refresh();
      } catch (error) {
        console.error('[Receivables] refresh failed', error);
      }
    });
  }

  function toggleCustomer(target) {
    const key = target.dataset.arKey || '';
    const open = !expanded.has(key);
    if (open) expanded.add(key);
    else expanded.delete(key);
    target.setAttribute('aria-expanded', String(open));
    // The chevron line icon turns with aria-expanded (erp-receivables.css); the label stays as it is.
    const detail = target.closest('tr')?.nextElementSibling;
    if (detail?.classList.contains('ar-aging-detail')) detail.hidden = !open;
  }

  function onClick(event) {
    refreshIfOutdated();
    const target = event.target?.closest?.('[data-ar-action]');
    if (!target) return;
    const action = target.dataset.arAction;
    if (action === 'dismiss') {
      dismissedSignature = lastAlert?.signature || '';
      BANNER_HOSTS.forEach(host => {
        const banner = document.getElementById(host.id);
        if (banner) banner.hidden = true;
      });
    } else if (action === 'open-report') {
      openReport();
    } else if (action === 'export') {
      exportCsv();
    } else if (action === 'toggle') {
      toggleCustomer(target);
    } else if (action === 'open-invoice') {
      const { arKind, arBranch, arYear, arMonth, arId } = target.dataset;
      if (!arBranch || arYear === '' || arMonth === '' || !arId) return;
      if (arKind === 'issuedInvoices') window.showIssuedDocumentDetail?.('issuedInvoices', arBranch, Number(arYear), Number(arMonth), arId);
      else window.showDetailById?.('invoice', arBranch, Number(arYear), Number(arMonth), arId);
    }
  }

  function boot() {
    document.addEventListener('click', onClick);
    document.addEventListener('erp:dashboard-rendered', scheduleRefresh);
    document.addEventListener('erp:navigation', event => {
      if (['dashboard', 'work-home'].includes(event?.detail?.id)) scheduleRefresh();
    });
    window.addEventListener('erp-flow:changed', scheduleRefresh);
    document.addEventListener('visibilitychange', refreshIfOutdated);
    window.addEventListener('focus', refreshIfOutdated);
    scheduleRefresh();
  }

  window.ERPReceivables = Object.freeze({ snapshot, refresh, renderReport, exportCsv, openReport, dueDate: invoiceDueDate, selectedBranch, scopeBranches, scopeLabel });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
