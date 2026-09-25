(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarkAIDevTrailExplorerEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function create({ policy, stateFactory, now = () => Date.now() } = {}) {
    function start(options = {}) {
      const normalized = policy.normalize(options.policy || {});
      return stateFactory.create({
        sessionId: options.sessionId,
        portalTabId: options.portalTabId,
        targetTabId: options.targetTabId,
        policy: normalized
      });
    }

    function canContinue(state) {
      if (!state || state.status === 'finished' || state.status === 'error') return false;
      if (now() - state.startedAt >= state.policy.maxDurationMs) return false;
      if (state.pages.length >= state.policy.maxPages) return false;
      if (state.actions.length >= state.policy.maxActions) return false;
      return true;
    }

    function recordPage(state, page) {
      if (!state || !canContinue(state)) return false;
      const url = String(page?.url || '');
      if (!url) return false;
      if (!policy.canNavigate(state.pages.at(-1)?.url || url, url, state.policy)) return false;
      if (!state.visitedUrls.has(url)) {
        state.visitedUrls.add(url);
        stateFactory.addBounded(state.pages, {
          url,
          title: String(page?.title || '').slice(0, 300),
          route: String(page?.route || '').slice(0, 500),
          timestamp_epoch_ms: now()
        }, state.policy.maxPages);
      }
      return true;
    }

    function recordAction(state, action) {
      if (!state || !canContinue(state)) return false;
      if (!policy.canExecuteAction(action, state.policy)) return false;
      stateFactory.addBounded(state.actions, { ...action, timestamp_epoch_ms: now() }, state.policy.maxActions);
      return true;
    }

    function finish(state, reason = 'manual') {
      if (!state) return null;
      state.status = 'finished';
      return {
        ...stateFactory.snapshot(state),
        finished_at: new Date(now()).toISOString(),
        finish_reason: reason
      };
    }

    return { start, canContinue, recordPage, recordAction, finish };
  }

  return { create };
});
