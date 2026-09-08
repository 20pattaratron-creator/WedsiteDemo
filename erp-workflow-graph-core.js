// ============================================================================
// erp-workflow-graph-core.js — deterministic workflow graph runner
// DEMO 4.2.0
// ============================================================================
import { cloneData } from './erp-shared-core.js';
export const WORKFLOW_GRAPH_CORE_VERSION = '1.0.0';

export function defineWorkflow(definition = {}) {
  const id = String(definition.id || '').trim();
  if (!id) throw new Error('Workflow id is required');
  const nodes = Object.freeze({ ...(definition.nodes || {}) });
  const edges = Object.freeze((definition.edges || []).map((edge, index) => Object.freeze({
    id: edge.id || `${edge.from || 'unknown'}:${edge.to || 'unknown'}:${index}`,
    from: edge.from,
    to: edge.to,
    guard: edge.guard || null,
    label: edge.label || ''
  })));
  const start = definition.start || Object.keys(nodes)[0];
  if (!start || !nodes[start]) throw new Error(`Workflow ${id} has invalid start node`);
  for (const edge of edges) {
    if (!nodes[edge.from] || !nodes[edge.to]) throw new Error(`Workflow ${id} has invalid edge ${edge.from} -> ${edge.to}`);
  }
  return Object.freeze({ id, version: definition.version || '1.0.0', start, nodes, edges, terminal: new Set(definition.terminal || []) });
}

export function runWorkflow(workflow, input = {}, options = {}) {
  if (!workflow?.id) throw new Error('A valid workflow is required');
  const guards = options.guards || {};
  const maxSteps = Math.max(1, Number(options.maxSteps || 100));
  const context = cloneData(input);
  const trace = [];
  const queue = [workflow.start];
  const visitedCounts = new Map();
  let steps = 0;

  while (queue.length) {
    if (++steps > maxSteps) throw new Error(`Workflow ${workflow.id} exceeded maxSteps=${maxSteps}`);
    const nodeId = queue.shift();
    const node = workflow.nodes[nodeId];
    if (!node) throw new Error(`Workflow ${workflow.id} missing node ${nodeId}`);
    visitedCounts.set(nodeId, (visitedCounts.get(nodeId) || 0) + 1);
    const result = typeof node.run === 'function' ? node.run(context, { nodeId, workflow }) : undefined;
    trace.push({ nodeId, label: node.label || nodeId, result });

    if (workflow.terminal.has(nodeId)) continue;
    const outgoing = workflow.edges.filter(edge => edge.from === nodeId);
    if (!outgoing.length) continue;
    const matched = [];
    for (const edge of outgoing) {
      if (!edge.guard) { matched.push(edge); continue; }
      const guard = guards[edge.guard];
      if (typeof guard !== 'function') throw new Error(`Workflow ${workflow.id} missing guard: ${edge.guard}`);
      if (guard(context, { edge, workflow, trace })) matched.push(edge);
    }
    if (!matched.length) throw new Error(`Workflow ${workflow.id} has no matching route from ${nodeId}`);
    for (const edge of matched) queue.push(edge.to);
  }

  return { workflowId: workflow.id, workflowVersion: workflow.version, context, trace, visitedCounts: Object.fromEntries(visitedCounts) };
}
