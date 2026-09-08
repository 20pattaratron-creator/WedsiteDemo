// ============================================================================
// erp-workflow-definitions.js — explicit workflow definitions for ERP UX/rules
// DEMO 4.2.0
// ============================================================================
import { defineWorkflow } from './erp-workflow-graph-core.js';
export const WORKFLOW_DEFINITIONS_VERSION = '1.0.0';

const step = (label, panel, subview = '') => Object.freeze({ label, panel, subview });

export const ORDER_TO_CASH_STEPS = Object.freeze([
  step('เสนอราคา', 'quote-form'),
  step('ยืนยัน Order', 'order-flow', 'sales-orders'),
  step('จัดสินค้า', 'order-flow', 'fulfillment'),
  step('ส่ง / Invoice', 'invoice-form'),
  step('วางบิล', 'order-flow', 'billing'),
  step('รับเงิน', 'receipt-form')
]);

export const ORDER_TO_CASH_GRAPH = defineWorkflow({
  id: 'order-to-cash', version: '1.0.0', start: 'quote', terminal: ['payment'],
  nodes: {
    quote: { label: 'เสนอราคา' },
    salesOrder: { label: 'ยืนยัน Order' },
    fulfillment: { label: 'จัดสินค้า' },
    invoice: { label: 'ส่ง / Invoice' },
    billing: { label: 'วางบิล' },
    payment: { label: 'รับเงิน' }
  },
  edges: [
    { from: 'quote', to: 'salesOrder' },
    { from: 'salesOrder', to: 'fulfillment' },
    { from: 'fulfillment', to: 'invoice' },
    { from: 'invoice', to: 'billing', guard: 'creditSale' },
    { from: 'invoice', to: 'payment', guard: 'cashSale' },
    { from: 'billing', to: 'payment' }
  ]
});

export const FULFILLMENT_GRAPH = defineWorkflow({
  id: 'fulfillment', version: '1.0.0', start: 'check', terminal: ['reserveStock','production','purchase'],
  nodes: {
    check: { label: 'ตรวจความต้องการ' },
    reserveStock: { label: 'จอง Stock' },
    production: { label: 'สั่งผลิต' },
    purchase: { label: 'จัดซื้อ' }
  },
  edges: [
    { from: 'check', to: 'reserveStock', guard: 'needsStock' },
    { from: 'check', to: 'production', guard: 'needsProduction' },
    { from: 'check', to: 'purchase', guard: 'needsPurchase' }
  ]
});

export function workflowStageForNavigation(panel, subview = '') {
  if (['quote-form','quote-list'].includes(panel)) return 0;
  if (panel === 'order-flow') {
    if (subview === 'billing') return 4;
    if (subview === 'fulfillment') return 2;
    return 1;
  }
  if (['production-form','production-list','purchase-order','goods-receipt','inventory'].includes(panel)) return 2;
  if (['invoice-form','invoice-list','linked-flow'].includes(panel)) return 3;
  if (['receipt-form','receipt-list'].includes(panel)) return 5;
  return -1;
}
