'use strict';

const assert = require('node:assert/strict');
const { generate, convertToMarkdown } = require('../frontend/modules/devtrail_specification');

const session = {
  metadata: { url_alvo: 'https://example.test/veiculos' },
  steps: [
    {
      step_id: 1,
      tipo_evento: 'input',
      elemento: {
        tag: 'INPUT',
        texto_visivel: 'Placa',
        seletores: { id: 'placa' }
      },
      valor_entrada: 'ABC1D23'
    },
    {
      step_id: 2,
      tipo_evento: 'click',
      elemento: {
        tag: 'BUTTON',
        texto_visivel: 'Consultar',
        seletores: { testid: 'btn-consultar' }
      },
      chamadas_rede: [{
        metodo: 'GET',
        url: 'https://example.test/api/veiculos/consulta',
        status: 200,
        payload: { placa: 'ABC1D23' },
        response_preview: { ok: true }
      }]
    }
  ]
};

const spec = generate(session);
assert.equal(spec.schema_version, '1.0');
assert.equal(spec.functional_requirements.length, 2);
assert.equal(spec.functional_requirements[0].selector, '#placa');
assert.equal(
  spec.functional_requirements[1].selector,
  '[data-testid="btn-consultar"]'
);
assert.equal(spec.api_contracts[0].endpoint, 'GET /api/veiculos/consulta');
assert.equal(spec.source.network_calls, 1);
assert.ok(spec.automation_sequence.length === 2);

const markdown = convertToMarkdown(spec);
assert.match(markdown, /## Especificação de desenvolvimento e RPA/);
assert.match(markdown, /RF01/);
assert.match(markdown, /### 3\. Regras de negócio/);

console.log('devtrail specification tests: ok');
