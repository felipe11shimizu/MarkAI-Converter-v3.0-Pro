'use strict';

const assert = require('node:assert/strict');
const validator = require('../frontend/modules/devtrail_replay_validator.js');

const plan = {
  source_session_id: 'sess-original',
  actions: [
    { order: 1, action: 'input', target: '#placa', input: 'ABC1234', network_assertions: [] },
    { order: 2, action: 'click', target: '[data-testid="btn-consultar"]', network_assertions: [{ method: 'GET', endpoint: '/v1/veiculos', status: 200 }] }
  ]
};

const session = {
  metadata: { session_id: 'sess-replay' },
  steps: [
    { step_id: 1, tipo_evento: 'input', elemento: { seletores: { id: 'placa' } }, valor_entrada: 'ABC1234', chamadas_rede: [] },
    { step_id: 2, tipo_evento: 'click', elemento: { seletores: { testid: 'btn-consultar' } }, chamadas_rede: [{ metodo: 'GET', url: 'https://api.example.test/v1/veiculos', status: 200 }] }
  ]
};

const result = validator.validate(session, plan);
assert.equal(result.status, 'conforme');
assert.equal(result.metrics.conforme_steps, 2);
assert.equal(result.metrics.divergent_steps, 0);

const divergent = validator.validate({
  ...session,
  steps: session.steps.map(step => step.step_id === 2 ? { ...step, chamadas_rede: [{ metodo: 'POST', url: 'https://api.example.test/v1/outro', status: 500 }] } : step)
}, plan);
assert.equal(divergent.status, 'divergente');
assert.equal(divergent.steps[1].verdict, 'divergente');

const missing = validator.validate({ metadata: session.metadata, steps: [session.steps[0]] }, plan);
assert.equal(missing.status, 'nao_observado');
assert.equal(missing.steps[1].verdict, 'nao_observado');

const md = validator.convertToMarkdown(result);
assert.match(md, /## Validação de reprodução DevTrail/);
assert.match(md, /### 2\. Validação por etapa/);

console.log('devtrail replay validator tests: ok');
