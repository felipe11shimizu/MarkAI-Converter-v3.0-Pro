(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DevTrailAutonomousCycle = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '1.0';

  async function run(api, state, planner, executor, scanner, map, options = {}) {
    if (!state?.active) return { ok: false, code: 'AUTONOMOUS_SESSION_REQUIRED' };
    if (!planner?.plan || !executor?.execute || !scanner?.scanTab) {
      return { ok: false, code: 'AUTONOMOUS_CYCLE_UNAVAILABLE' };
    }

    const targetTabId = state.tabId;
    const plan = planner.plan(map || {}, options.planner || {});
    if (!Array.isArray(plan.actions) || plan.actions.length === 0) {
      return {
        ok: true,
        schema_version: VERSION,
        plan,
        execution: { ok: true, executed: 0, results: [] },
        snapshot: null,
        network: { before: Array.isArray(state.network) ? state.network.length : 0, after: Array.isArray(state.network) ? state.network.length : 0, delta: 0 }
      };
    }

    const networkBefore = Array.isArray(state.network) ? state.network.length : 0;
    const execution = await executor.execute(
      api,
      state,
      plan,
      { ...(options.executor || {}), execute: options.execute === true }
    );

    if (!execution.ok && execution.code) {
      return {
        ok: false,
        schema_version: VERSION,
        plan,
        execution,
        snapshot: null,
        network: { before: networkBefore, after: Array.isArray(state.network) ? state.network.length : networkBefore, delta: 0 }
      };
    }

    const snapshot = await scanner.scanTab(api, targetTabId);
    const networkAfter = Array.isArray(state.network) ? state.network.length : networkBefore;

    return {
      ok: execution.ok,
      schema_version: VERSION,
      plan,
      execution,
      snapshot,
      network: {
        before: networkBefore,
        after: networkAfter,
        delta: Math.max(0, networkAfter - networkBefore)
      }
    };
  }

  return Object.freeze({ VERSION, run });
});
