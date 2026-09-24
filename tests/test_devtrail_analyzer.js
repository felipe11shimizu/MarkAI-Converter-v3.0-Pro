'use strict';

const assert = require('node:assert/strict');
const analyzer = require('../frontend/modules/devtrail_analyzer.js');

const sample = {
  metadata: { url_alvo: 'https://example.test/app' },
  steps: [
    { step_id: 1, tipo_evento: 'input', elemento: { tag: 'INPUT', texto_visivel: 'Placa', seletores: { id: 'placa' } }, chamadas_rede: [] },
    { step_id: 2, tipo_evento: 'click', elemento: { tag: 'BUTTON', texto_visivel: 'Consultar', seletores: { testid: 'btn-consultar' } }, chamadas_rede: [{ url: 'https://api.example.test/v1/veiculos', metodo: 'GET', status: 200 }] }
  ],
  diagnostics: []
};

const result = analyzer.analyze(sample);
assert.equal(result.metrics.steps, 2);
assert.equal(result.metrics.network_calls, 1);
assert.match(result.classification.observed[0].statement, /input/);
assert.ok(result.classification.derived.length >= 2);
assert.equal(result.classification.to_confirm.length, 0);
assert.equal(result.requirements[0].selector, 'placa');

const md = analyzer.convertToMarkdown(result);
assert.match(md, /## Inteligência do processo/);
assert.match(md, /### Observado/);
assert.match(md, /### Derivado/);
assert.match(md, /### A confirmar/);
assert.match(md, /### Especificação de automação/);
assert.match(md, /RF02/);

console.log('devtrail analyzer tests: ok');
