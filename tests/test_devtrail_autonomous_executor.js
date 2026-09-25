const assert = require('node:assert/strict');
const executor = require('../extension/autonomous_executor.js');

(async () => {
  const state = { active: true, sessionId: 's1', tabId: 7 };
  const plan = {
    schema_version: '1.0',
    mode: 'observe-plan-only',
    executable: false,
    source_session_id: 's1',
    actions: [
      { plan_id: 'p1', action: 'click', selector: '#save', requires_validation: true }
    ]
  };

  assert.equal(executor.validatePlan(plan, state, { execute: false }).code, 'EXECUTION_NOT_EXPLICITLY_ENABLED');
  assert.equal(executor.validatePlan(plan, state, { execute: true }).ok, true);

  const calls = [];
  const api = {
    scripting: {
      async executeScript(details) {
        calls.push(details);
        return [{ result: { ok: true, code: 'CLICK_TRIGGERED' } }];
      }
    }
  };
  const result = await executor.execute(api, state, plan, { execute: true });
  assert.equal(result.ok, true);
  assert.equal(result.executed, 1);
  assert.deepEqual(calls[0].target, { tabId: 7 });
  assert.equal(calls[0].args[0], '#save');

  assert.equal(
    executor.validatePlan({ ...plan, source_session_id: 'other' }, state, { execute: true }).code,
    'PLAN_SESSION_MISMATCH'
  );
  assert.equal(
    executor.validatePlan({
      ...plan,
      actions: [{ ...plan.actions[0], action: 'input' }]
    }, state, { execute: true }).code,
    'INPUT_DISABLED'
  );
  assert.equal(
    executor.validatePlan({
      ...plan,
      actions: [{ ...plan.actions[0], selector: '#x', requires_validation: false }]
    }, state, { execute: true }).code,
    'ACTION_REQUIRES_VALIDATION'
  );
  assert.equal(
    executor.validatePlan({
      ...plan,
      actions: [{ ...plan.actions[0], action: 'input', value: 'safe' }]
    }, state, { execute: true, allowInputs: true }).ok,
    true
  );

  console.log('devtrail autonomous executor tests: ok');
})();