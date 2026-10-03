// ============================================================================
// erp-storage-contracts.js — persisted key contracts; do not rename casually.
// DEMO 4.3.1
// ============================================================================
export const STORAGE_CONTRACT_VERSION = '1.4.0';
export const ORDER_FLOW_STORE_KEY = 'example_erp_order_flow_v3';
export const ORDER_FLOW_PREFERENCES_KEY = 'example_erp_order_flow_preferences_v3';
export const BUSINESS_RULES_KEY = 'comform_business_rules_v1';
export const CONTACT_MASTER_KEY = 'comform_contact_master_v1';
export const PRODUCT_MASTER_KEY = 'comform_product_master_v1';
export const ACTIVE_TENANT_SESSION_KEY = 'erp_active_tenant_v1';
export const SALES_TARGETS_KEY = 'comform_sales_targets_v1';
export const DELIVERY_TARGETS_KEY = 'comform_delivery_targets_v2';
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
