const assert = require('node:assert/strict');
const planner = require('../extension/autonomous_planner.js');

(() => {
  const map = {
    session_id: 's1',
    target_url: 'https://example.test',
    elements: [
      { page_id: 'p1', selector: '#name', tag: 'input', visible: true, disabled: false },
      { page_id: 'p1', selector: '#save', tag: 'button', type: 'submit', visible: true, disabled: false },
      { page_id: 'p1', selector: '#next', tag: 'a', href: '/next', visible: true, disabled: false },
      { page_id: 'p1', selector: '#hidden', tag: 'button', visible: false, disabled: false }
    ],
    actions: []
  };

  const result = planner.plan(map, { maxActions: 3, allowInputs: true });
  assert.equal(result.executable, false);
  assert.equal(result.mode, 'observe-plan-only');
  assert.equal(result.actions.length, 3);
  assert.equal(result.actions[0].selector, '#save');
  assert.equal(result.actions[0].action, 'click');
  assert.equal(result.actions[1].selector, '#next');
  assert.equal(result.actions[1].action, 'navigate');
  assert.equal(result.actions[2].selector, '#name');
  assert.equal(result.actions[2].action, 'input');
  assert.equal(result.actions.every(action => action.requires_validation), true);

  const observed = planner.plan(
    { ...map, actions: [{ elemento: '#save' }] },
    { maxActions: 10, allowInputs: false }
  );
  assert.equal(observed.actions.some(action => action.selector === '#save'), false);
  assert.equal(observed.actions.some(action => action.selector === '#name'), false);
  assert.equal(observed.actions.length, 1);

  console.log('devtrail autonomous planner tests: ok');
})();