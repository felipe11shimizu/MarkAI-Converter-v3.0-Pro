(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DevTrailAutonomousSystemMap = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '1.0';

  function key(value, fallback) {
    return value == null || value === '' ? fallback : String(value);
  }

  function create(metadata = {}) {
    return {
      schema_version: VERSION,
      session_id: metadata.session_id || null,
      target_url: metadata.target_url || null,
      generated_at: metadata.generated_at || new Date().toISOString(),
      pages: [],
      elements: [],
      actions: [],
      network: [],
      flows: [],
      diagnostics: []
    };
  }

  function upsert(list, item, identity) {
    const index = list.findIndex(entry => identity(entry) === identity(item));
    if (index >= 0) list[index] = { ...list[index], ...item };
    else list.push(item);
  }

  function addDomSnapshot(map, snapshot = {}) {
    const page = snapshot.page || {};
    const pageId = key(page.url, 'unknown-page');
    upsert(map.pages, {
      page_id: pageId,
      url: page.url || null,
      title: page.title || null,
      viewport: page.viewport || null,
      counts: snapshot.counts || null
    }, item => item.page_id);

    for (const control of snapshot.controls || []) {
      const selector = key(control.selector, 'element-' + (control.index ?? 0));
      upsert(map.elements, {
        element_id: pageId + '|' + selector,
        page_id: pageId,
        selector,
        tag: control.tag || null,
        type: control.type || null,
        role: control.role || null,
        text: control.text || null,
        ariaLabel: control.ariaLabel || null,
        id: control.id || null,
        name: control.name || null,
        href: control.href || null,
        disabled: Boolean(control.disabled),
        visible: Boolean(control.visible),
        rect: control.rect || null
      }, item => item.element_id);
    }
    return map;
  }

  function addCorrelatedSteps(map, steps = []) {
    for (const step of steps) {
      const actionId = key(step.event_id, 'step-' + (step.step_id ?? map.actions.length + 1));
      const networkRefs = (step.chamadas_rede || []).map(network => {
        const networkId = key(network.requestId, network.url || 'network-' + map.network.length);
        upsert(map.network, { network_id: networkId, ...network }, item => item.network_id);
        return networkId;
      });
      upsert(map.actions, {
        action_id: actionId,
        step_id: step.step_id ?? null,
        tipo_evento: step.tipo_evento || 'unknown',
        timestamp_epoch_ms: step.timestamp_epoch_ms ?? null,
        elemento: step.elemento || null,
        valor_entrada: step.valor_entrada ?? null,
        url: step.url || null,
        network_refs: networkRefs
      }, item => item.action_id);
    }
    return map;
  }

  function addFlow(map, flow = {}) {
    const flowId = key(flow.flow_id, 'flow-' + (map.flows.length + 1));
    upsert(map.flows, { ...flow, flow_id: flowId }, item => item.flow_id);
    return map;
  }

  function addDiagnostics(map, diagnostics = []) {
    for (const diagnostic of diagnostics) {
      const id = key(diagnostic.id, JSON.stringify(diagnostic));
      upsert(map.diagnostics, { ...diagnostic, id }, item => item.id);
    }
    return map;
  }

  function finalize(map) {
    return {
      ...map,
      totals: {
        pages: map.pages.length,
        elements: map.elements.length,
        actions: map.actions.length,
        network: map.network.length,
        flows: map.flows.length,
        diagnostics: map.diagnostics.length
      }
    };
  }

  return Object.freeze({
    VERSION,
    create,
    addDomSnapshot,
    addCorrelatedSteps,
    addFlow,
    addDiagnostics,
    finalize
  });
});
