'use strict';

const assert = require('node:assert/strict');
const readiness = require('../frontend/modules/devtrail_readiness.js');

const sample = {
  metadata: { url_alvo: 'https://example.test/app' },
  steps: [
    { step_id: 1, timestamp_relativo_ms: 100, tipo_evento: 'input', elemento: { texto_visivel: 'Placa', seletores: { id: 'placa' } }, chamadas_rede: [] },
    { step_id: 2, timestamp_relativo_ms: 500, tipo_evento: 'click', elemento: { texto_visivel: 'Consultar', seletores: { testid: 'btn-consultar' } }, chamadas_rede: [{ url: 'https://api.example.test/v1/veiculos', metodo: 'GET', status: 200 }] }
  ]
};
const analysis = {
  metrics: { steps: 2, selector_coverage: 1, network_correlation_coverage: 0.5, outcome_coverage: 0.5 },
  execution_flow: [
    { order: 1, event: 'input', selector: '#placa', input: 'ABC1234', wait_until_next_step_ms: 400, outcome: 'sem_rede_associada', network_calls: [] },
    { order: 2, event: 'click', selector: '[data-testid="btn-consultar"]', wait_until_next_step_ms: null, outcome: 'sucesso_rede', network_calls: [{ method: 'GET', endpoint: '/v1/veiculos', status: 200 }] }
  ]
};
const quality = { status: 'adequado', metrics: analysis.metrics, gaps: [] };
const specification = { objective: 'Consultar veículo', confirmations: [] };

const result = readiness.generate(sample, analysis, quality, specification);
assert.equal(result.readiness, 'pronto_para_automacao');
assert.equal(result.actions.length, 2);
assert.equal(result.actions[1].target, '[data-testid="btn-consultar"]');
assert.match(result.actions[1].expected, /GET \/v1\/veiculos/);
assert.equal(result.validations.length, 2);

const blocked = readiness.generate(sample, analysis, { status: 'bloqueado', metrics: analysis.metrics, gaps: [{ id: 'GSEC01', statement: 'token' }] }, specification);
assert.equal(blocked.readiness, 'bloqueado');

const md = readiness.convertToMarkdown(result);
assert.match(md, /## Prontidão para automação/RPA/);
assert.match(md, /### 2. Sequência executável/);
assert.match(md, /### 4. Tratamento de falhas/);

console.log('devtrail readiness tests: ok');
