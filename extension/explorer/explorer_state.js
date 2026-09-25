(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarkAIDevTrailExplorerState = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function create(options = {}) {
    const policy = options.policy || {};
    return {
      sessionId: options.sessionId || crypto.randomUUID(),
      portalTabId: options.portalTabId ?? null,
      targetTabId: options.targetTabId ?? null,
      startedAt: Date.now(),
      pages: [],
      actions: [],
      network: [],
      diagnostics: [],
      visitedUrls: new Set(),
      status: 'starting',
      policy,
      timer: null
    };
  }

  function addBounded(list, item, limit) {
    list.push(item);
    if (list.length > limit) list.splice(0, list.length - limit);
  }

  function snapshot(state) {
    return {
      session_id: state.sessionId,
      status: state.status,
      started_at: new Date(state.startedAt).toISOString(),
      portal_tab_id: state.portalTabId,
      target_tab_id: state.targetTabId,
      pages: state.pages.slice(),
      actions: state.actions.slice(),
      network: state.network.slice(),
      diagnostics: state.diagnostics.slice(),
      visited_urls: [...state.visitedUrls],
      policy: { ...state.policy }
    };
  }

  return { create, addBounded, snapshot };
});
