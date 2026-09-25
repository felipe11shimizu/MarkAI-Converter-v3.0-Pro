const assert = require('node:assert/strict');
const cycle = require('../extension/autonomous_cycle.js');

(async () => {
  const state = { active: true, sessionId: 's1', tabId: 7, network: [{ id: 1 }] };
  const planner = {
    plan(map) {
      assert.equal(map.target_url, 'https://example.test');
      return {
        schema_version: '1.0',
        mode: 'observe-plan-only',
        executable: false,
        source_session_id: 's1',
        actions: [{ plan_id: 'p1', action: 'click', selector: '#next', requires_validation: true }]
      };
    }
  };
  const calls = [];
  const api = {
    scripting: {
      async executeScript(details) {
        calls.push(details);
        if (details.func.toString().includes('targetSelector')) {
          return [{ result: { url: 'https://example.test/next', targetPresent: false, targetTag: null, targetDisabled: false, targetTextLength: 0, targetRect: null, bodyTextLength: 20 } }];
        }
        return [{ result: { ok: true, code: 'CLICK_TRIGGERED' } }];
      }
    }
  };
  const executor = {
    async execute(apiArg, stateArg, plan, options) {
      assert.equal(apiArg, api);
      assert.equal(stateArg, state);
      assert.equal(options.execute, true);
      state.network.push({ id: 2 });
      return { ok: true, schema_version: '1.1', executed: 1, results: [{ plan_id: 'p1', ok: true }] };
    }
  };
  const scanner = {
    async scanTab(apiArg, tabId) {
      assert.equal(apiArg, api);
      assert.equal(tabId, 7);
      return { ok: true, map: { page: { url: 'https://example.test/next' }, counts: { interactive: 1 } } };
    }
  };

  const result = await cycle.run(
    api,
    state,
    planner,
    executor,
    scanner,
    { target_url: 'https://example.test', session_id: 's1', elements: [] },
    { execute: true }
  );

  assert.equal(result.ok, true);
  assert.equal(result.plan.actions.length, 1);
  assert.equal(result.execution.executed, 1);
  assert.equal(result.snapshot.ok, true);
  assert.deepEqual(result.network, { before: 1, after: 2, delta: 1 });
  assert.equal(calls.length, 0);

  const empty = await cycle.run(
    api,
    state,
    { plan: () => ({ actions: [] }) },
    executor,
    scanner,
    { target_url: 'https://example.test', session_id: 's1', elements: [] },
    { execute: true }
  );
  assert.equal(empty.ok, true);
  assert.equal(empty.execution.executed, 0);
  assert.equal(empty.snapshot, null);

  console.log('devtrail autonomous cycle tests: ok');
})();
