// ============================================================================
// erp-storage-contracts.js — persisted key contracts; do not rename casually.
// DEMO 4.3.1
// ============================================================================
export const STORAGE_CONTRACT_VERSION = '1.14.0';
export const ORDER_FLOW_STORE_KEY = 'example_erp_order_flow_v3';
export const ORDER_FLOW_PREFERENCES_KEY = 'example_erp_order_flow_preferences_v3';
export const BUSINESS_RULES_KEY = 'comform_business_rules_v1';
export const CONTACT_MASTER_KEY = 'comform_contact_master_v1';
export const PRODUCT_MASTER_KEY = 'comform_product_master_v1';
export const ACTIVE_TENANT_SESSION_KEY = 'erp_active_tenant_v1';
export const SALES_TARGETS_KEY = 'comform_sales_targets_v1';
export const DELIVERY_TARGETS_KEY = 'comform_delivery_targets_v2';
// Per-month targets the dashboard target UI writes (app.js setTargetPeriodOverride): JSON object
// { "<scope>:<YYYY>-<MM>": baht } with scope all | ubon | khonkaen. They win over the per-scope default
// of SALES_TARGETS_KEY / DELIVERY_TARGETS_KEY (ADR-021: the default is now 0 = "ยังไม่ได้ตั้งเป้า").
// Moved here unchanged from app.js literals (ADR-021) — no data migration.
export const SALES_TARGET_PERIODS_KEY = 'comform_sales_target_period_overrides_v1';
export const DELIVERY_TARGET_PERIODS_KEY = 'comform_delivery_target_period_overrides_v1';
// ADR-021: which per-month targets the sample-data load wrote: { batch, sales: {key: baht}, delivery:
// {key: baht} }. "ล้างข้อมูลสาธิตทั้งหมด (รีเซ็ต)" removes only those entries that still hold the seeded
// value (targets the user typed are kept), then this key.
export const DEMO_SEED_TARGETS_KEY = 'comform_demo_seed_targets_v1';
// Legacy order-flow store (before v3); erp-order-flow.js still migrates it into an empty store.
export const LEGACY_ORDER_FLOW_STORE_KEY = 'example_erp_order_flow_v2';
// View preference (erp-product-experience.js): โหมดง่าย / โหมดขั้นสูง, not business data —
// "ล้างข้อมูลสาธิตทั้งหมด (รีเซ็ต)" keeps it (erp-demo-seed-core.js demoResetStorageKeys).
export const PRODUCT_EXPERIENCE_MODE_KEY = 'erp_product_experience_mode_v1';
// View preference (erp-product-experience.js, ADR-015): JSON array of the sidebar section ids the
// user collapsed, e.g. ["data","settings"] (ids: NAV_SECTIONS in erp-product-experience-core.js).
// Kept by the demo reset like the mode key.
export const NAV_COLLAPSED_SECTIONS_KEY = 'erp_nav_collapsed_sections_v1';
// RETIRED (ADR-014, single Admin view): the former per-role "มุมมอง" choice. Nothing reads it;
// erp-product-experience.js removes it on startup and a demo reset removes it too. The name stays
// reserved so it is never reused for a different meaning.
export const PRODUCT_EXPERIENCE_ROLE_KEY = 'erp_product_experience_role_v1';
// View preference (erp-i18n.js, ADR-026): the screen language, JSON { schemaVersion: 1, language: 'th' | 'en',
// updatedAt } (the bare words 'th' / 'en' are read too); absent or damaged = 'th', the default. Printed tax documents
// stay Thai (bilingual for commercial documents in English). Carried by JSON backups under masterData.settings and
// by the in-browser auto-snapshots; kept by the demo reset (DEMO_RESET_KEPT_BASE_KEYS) like the mode key.
export const UI_LANGUAGE_KEY = 'comform_ui_language_v1';

// The customer's own company profile and logo (ADR-020, erp-company-profile.js): printed on every
// document and in the header. Settings, not demo data — "ล้างข้อมูลสาธิตทั้งหมด (รีเซ็ต)" keeps both
// (DEMO_RESET_KEPT_BASE_KEYS). PROFILE: JSON { schemaVersion: 1, nameTh, nameEn, taxId, addressTh,
// phone, email, website, branches: { ubon|khonkaen: { code, label, addressTh } }, updatedAt }.
// LOGO: JSON { schemaVersion: 1, dataUrl ('data:image/png|jpeg;base64,…' ≤ 300,000 chars, made by our
// own canvas), mime, width, height (≤ 600 px), updatedAt } — absent or 'null' = the default logo.png.
// The logo key stays out of ERPBackup.capture() snapshots (kept in memory only, erp-backup.js);
// JSON backups carry both under masterData.companyProfile.
export const COMPANY_PROFILE_KEY = 'comform_company_profile_v1';
export const COMPANY_LOGO_KEY = 'comform_company_logo_v1';
// How many establishments the company has (ADR-022, erp-branches-core.js): JSON { schemaVersion: 1,
// count: 1 (สำนักงานใหญ่อย่างเดียว) | 2 (สำนักงานใหญ่ + 1 สาขา), updatedAt }. Absent = 2 (the behaviour of
// every store before ADR-022). Saved by the company-profile form, carried by JSON backups under
// masterData.companyProfile.branchSetting, kept by the demo reset (a setting, not sample data).
// Internal branch ids stay ubon / khonkaen: document packs (biz2_<branch>_YYYY_MM) are keyed by them.
export const COMPANY_BRANCH_SETTING_KEY = 'comform_company_branch_setting_v1';
// In-page signal after the applied profile / logo changed (save, reset, backup restore, other tab).
// window.CurrentUser.companyProfile is already updated when it fires.
export const COMPANY_PROFILE_CHANGED_EVENT = 'erp:company-profile-changed';

// Filed ภ.พ.30 snapshots (ADR-023, erp-tax-reports.js): JSON { schemaVersion: 1, returns: [ { id, branchKey
// (ubon | khonkaen | combined), branches, period 'YYYY-MM', filingMode, amendment (0 = ยื่นปกติ, n = ยื่นเพิ่มเติม
// ครั้งที่ n), lines {1..12}, carryForwardIn, carryForwardSource, overpaidAction, channel, dueDate, filedAt,
// filedBy, seller, counts, note } ] } — append-only (an amendment is a new row, never an overwrite), validated
// by erp-tax-reports-core.js normalizeVatReturnsStore (fail-closed). Carried by JSON backups under
// masterData.vatReturns. Business data: "ล้างข้อมูลสาธิตทั้งหมด (รีเซ็ต)" removes it with the documents it summarises.
export const VAT_RETURNS_KEY = 'comform_vat_returns_v1';
// r13#MED-8: when this browser last made a JSON backup (NOT tenant-scoped: it is never part of a backup itself; the
// banner reminder of erp-backup.js reads it — a convenience, the 5-year retention duty is the owner's).
export const LAST_BACKUP_AT_KEY = 'erp_demo_last_backup_at';
// Filed ภ.ง.ด.3 / ภ.ง.ด.53 snapshots (ADR-024, erp-payer-wht.js): JSON { schemaVersion: 1, filings: [ { id, branch
// (ubon | khonkaen), period 'YYYY-MM' (the month paid), form ('PND3' | 'PND53'), amendment (0 = ยื่นปกติ, n = ยื่นเพิ่มเติม
// ครั้งที่ n), rows [the ใบแนบ rows: seq, certId, certNo, payee, date, income, rate, amountPaid, taxWithheld, condition],
// totals { count, payees, amountPaid, taxWithheld } (= the sum of the rows), channel, dueDate, filedAt, filedBy, payer,
// note } ] } — append-only, validated by erp-payer-wht-core.js normalizeWhtFilingsStore (fail-closed). Carried by JSON
// backups under masterData.whtFilings; the demo reset removes it with the certificates it lists.
export const WHT_FILINGS_KEY = 'comform_wht_filings_v1';

// Demo monthly sales history (ADR-027, erp-demo-seed-core.js buildDemoSalesHistory): JSON { schemaVersion: 1, kind:
// 'demo-monthly-sales-history', demoSeed: true, demoSeedBatch, generatedFor, storyPeriod, start, columns: ['period',
// 'branch', 'productCode', 'customer', 'qty', 'value'], rows: [['YYYY-MM', 'ubon' | 'khonkaen', code, customer name,
// qty, pre-VAT baht]] }. Written only by "โหลดข้อมูลตัวอย่าง" (same transaction as the documents), read only by
// "วิเคราะห์และคาดการณ์" for a branch-month WITHOUT sales documents (erp-analytics-core.js historyLines), validated
// fail-closed (parseDemoSalesHistory). Sample data: the demo reset removes it; JSON backups do not carry it (reload
// the sample data to get it back).
export const DEMO_SALES_HISTORY_KEY = 'comform_demo_sales_history_v1';

// Inventory and job costing (ADR-028, erp-costing.js; validated fail-closed by erp-costing-core.js
// normalizeCostingSettings and erp-job-costing-core.js normalizeJobStore). Business data: the demo reset removes both;
// JSON backups carry them under masterData.costing { settings, jobs }.
// SETTINGS: JSON { schemaVersion: 1, method: 'moving_average' | 'fifo', methodHistory: [{ method, effectiveFrom ('' for the
// first), approvalRef, approvalDate, note, at, by }] (a change after the first costed movement needs the Revenue
// Department's approval, s.65 ทวิ (6)), labourRate, personRates: [{ name, rate }], overhead: { estimatedOverhead,
// estimatedHours }, overheadCategories: [expense category], openingCosts: { skuKey: baht }, nrv: { skuKey: { expectedPrice,
// costToSell } }, updatedAt }.
// JOBS: JSON { schemaVersion: 1, entries: [labour | other | completion entries of a production order (jobKey =
// '<branch>|<production id>')], budgets: { jobKey: { materials, labourHours, labour, overhead, other, source, sourceRef,
// updatedAt } } }. Material issues / returns / finished-goods receipts of a job are stock movements in the existing
// inventory-movement store (kinds job_issue / job_return / job_completion), so every stock figure stays one ledger.
export const COSTING_SETTINGS_KEY = 'comform_costing_settings_v1';
export const JOB_COSTING_KEY = 'comform_job_costing_v1';

// Journals, month-end pack and PromptPay (ADR-029, erp-journal.js / erp-promptpay.js; validated fail-closed by
// erp-journal-core.js normalizeJournalSettings / normalizeJournalDocuments and erp-promptpay-core.js
// normalizePromptPaySettings). JSON backups carry them under masterData.accounting { settings, documents } and
// masterData.promptpay.
// JOURNAL SETTINGS (a company setting — kept by the demo reset): JSON { schemaVersion: 1, accounts: { role: { code, name } }
// (the company's codes / names over the default Thai SME chart), custom: [{ id, code, name, type }], categories: { expense
// category: account role }, posting: { receiptAccount, cashSaleAccount, expensePaidFrom, refundAccount }, peak: { columns:
// [{ header, field }], dateFormat }, export: { cogsMonthEnd }, updatedAt }.
// JOURNAL DOCUMENTS (business data — removed by the demo reset): JSON { schemaVersion: 1, manual: [manual entries], closes:
// [overhead closes], nrv: [NRV write-downs], opening: [opening-balance batches], openingDate } — amounts in satang,
// cancel-not-delete (status 'voided' + voidDate). The journals themselves are never stored: they are derived.
// PROMPTPAY (a company setting — kept by the demo reset): JSON { schemaVersion: 1, enabled (default false), idType, id,
// payeeName, documents: { invoice, billing, receipt }, billPayment: { enabled, billerId, ref2 }, scanTests: { bank: date },
// updatedAt }.
export const JOURNAL_SETTINGS_KEY = 'comform_journal_settings_v1';
export const JOURNAL_DOCUMENTS_KEY = 'comform_journal_documents_v1';
export const PROMPTPAY_SETTINGS_KEY = 'comform_promptpay_settings_v1';

// Multi-currency (ADR-031, round 13B, erp-fx.js; validated fail-closed by erp-fx-core.js normalizeFxSettings /
// normalizeFxRateStore / normalizeFxDocuments). JSON backups carry the three under masterData.fx { settings, rates,
// documents }. Foreign-currency DOCUMENTS stay in their usual collections (invoices, quotes, receipts, credit / debit
// notes, expenses, goods receipts) with the fields currency, fxRate, fxPer, fxRateType, fxRateDate, fxRateId, fxSource,
// amountFx, amountThb (+ per line priceFx / amountFx / amountThb) — their baht fields are computed ONCE when issued.
// SETTINGS (a company setting — kept by the demo reset): JSON { schemaVersion: 1, functionalCurrency: 'THB', allowedCurrencies,
// rateType ('bot_avg_buying' | 'bank_buying', chosen once), rateTypeHistory, taxInvoiceApproval { no, date },
// revaluationMethod: 'reverse', pnd54Rates, updatedAt }.
// RATES (business data — removed by the demo reset): JSON { schemaVersion: 1, rates: [{ id, currency, date, type, rate, per,
// source, sourceNote, version, supersedes, enteredAt, enteredBy }] } — append-only; a correction is a new version.
// DOCUMENTS (business data — removed by the demo reset): JSON { schemaVersion: 1, closes: [month-end closes: export values
// + revaluation rows, posted / voided] }.
export const FX_SETTINGS_KEY = 'comform_fx_settings_v1';
export const FX_RATES_KEY = 'comform_fx_rates_v1';
export const FX_DOCUMENTS_KEY = 'comform_fx_documents_v1';

export const GOVERNANCE_PERIOD_LOCKS_KEY = 'comform_governance_period_locks_v1';
export const GOVERNANCE_AUDIT_KEY = 'comform_governance_audit_v1';
export const GOVERNANCE_OUTBOX_KEY = 'comform_sync_outbox_v1';
export const GOVERNANCE_APPROVALS_KEY = 'comform_approval_history_v1';

// In-page signal fired after writes to business storage that bypass app.js saveFor():
// ERPIntegrity.transaction (incl. reconcilePayments, order-flow and production-core writes),
// ERPBackup.restore, write-session rollback and legacy snapshot restore. app.js drops its
// per-render renderBusiness() cache on it. Listeners must stay cheap.
export const STORAGE_WRITTEN_EVENT = 'erp:storage-written';
export function notifyStorageWritten() {
  const target = typeof window !== 'undefined' ? window : null;
  if (!target || typeof target.dispatchEvent !== 'function' || typeof Event !== 'function') return; // non-browser test contexts
  target.dispatchEvent(new Event(STORAGE_WRITTEN_EVENT));
}
