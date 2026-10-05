// ============================================================================
// erp-storage-contracts.js — persisted key contracts; do not rename casually.
// DEMO 4.3.1
// ============================================================================
export const STORAGE_CONTRACT_VERSION = '1.8.0';
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
