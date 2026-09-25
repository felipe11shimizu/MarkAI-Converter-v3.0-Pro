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
  assert.deepEqual(executor.compareSnapshots(
    { url: 'https://a.test', targetPresent: true, targetDisabled: false, targetTextLength: 3, targetRect: { x: 1, y: 1, width: 10, height: 10 }, bodyTextLength: 10 },
    { url: 'https://b.test', targetPresent: true, targetDisabled: false, targetTextLength: 3, targetRect: { x: 1, y: 1, width: 10, height: 10 }, bodyTextLength: 10 }
  ), {
    changed: true, urlChanged: true, targetPresenceChanged: false, targetStateChanged: false, bodyChanged: false
  });

  const calls = [];
  let inspectCount = 0;
  const api = {
    scripting: {
      async executeScript(details) {
        calls.push(details);
        if (details.func.toString().includes('targetSelector')) {
          inspectCount += 1;
          return [{
            result: inspectCount === 1
              ? { url: 'https://a.test', targetPresent: true, targetTag: 'button', targetDisabled: false, targetTextLength: 4, targetRect: { x: 1, y: 1, width: 10, height: 10 }, bodyTextLength: 10 }
              : { url: 'https://a.test', targetPresent: false, targetTag: null, targetDisabled: false, targetTextLength: 0, targetRect: null, bodyTextLength: 20 }
          }];
        }
        return [{ result: { ok: true, code: 'CLICK_TRIGGERED' } }];
      }
    }
  };

  const result = await executor.execute(api, state, plan, { execute: true, validationDelayMs: 0 });
  assert.equal(result.ok, true);
  assert.equal(result.executed, 1);
  assert.equal(result.loop_detected, false);
  assert.equal(result.results[0].validation.changed, true);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].target, { tabId: 7 });
  assert.deepEqual(calls[1].target, { tabId: 7 });
  assert.equal(calls[1].args[0], '#save');

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

  const loopState = { active: true, sessionId: 's1', tabId: 7 };
  const loopApi = {
    scripting: {
      async executeScript(details) {
        if (details.func.toString().includes('targetSelector')) {
          return [{ result: { url: 'https://a.test', targetPresent: true, targetTag: 'button', targetDisabled: false, targetTextLength: 4, targetRect: { x: 1, y: 1, width: 10, height: 10 }, bodyTextLength: 10 } }];
        }
        return [{ result: { ok: true, code: 'CLICK_TRIGGERED' } }];
      }
    }
  };
  const loopPlan = {
    ...plan,
    actions: [
      plan.actions[0],
      { ...plan.actions[0], plan_id: 'p2' }
    ]
  };
  const loopResult = await executor.execute(loopApi, loopState, loopPlan, { execute: true, validationDelayMs: 0, maxRepeatedState: 2 });
  assert.equal(loopResult.ok, false);
  assert.equal(loopResult.loop_detected, true);
  assert.equal(loopResult.results.at(-1).code, 'LOOP_DETECTED');

  console.log('devtrail autonomous executor tests: ok');
})();
