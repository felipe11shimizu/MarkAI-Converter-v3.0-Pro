'use strict';

const assert = require('node:assert/strict');
const plan = require('../frontend/modules/devtrail_replay_plan.js');

const result = plan.build(
  { metadata: { session_id: 's1', url_alvo: 'https://example.test/app' } },
  { execution_flow: [
    { order: 1, event: 'input', selector: '#placa', input: 'ABC1234', wait_until_next_step_ms: 400, outcome: 'sem_rede_associada', network_calls: [] },
    { order: 2, event: 'click', selector: '[data-testid="btn-consultar"]', wait_until_next_step_ms: null, outcome: 'sucesso_rede', network_calls: [{ method: 'GET', endpoint: '/v1/veiculos', status: 200 }] }
  ] },
  { readiness: 'requer_validacao' }
);
assert.equal(result.plan_type, 'devtrail-replay-plan');
assert.equal(result.actions.length, 2);
assert.equal(result.actions[1].wait_before_ms, 400);
assert.equal(result.actions[1].network_assertions[0].endpoint, '/v1/veiculos');
assert.equal(result.execution_policy.never_store_credentials, true);
assert.match(plan.convertToMarkdown(result), /## Plano de reprodução DevTrail/);
assert.match(plan.convertToMarkdown(result), /HTTP 200/);

console.log('devtrail replay plan tests: ok');
