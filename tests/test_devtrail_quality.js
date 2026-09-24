'use strict';

const assert = require('node:assert/strict');
const quality = require('../frontend/modules/devtrail_quality.js');

const sample = {
  metadata: { url_alvo: 'https://example.test/app' },
  steps: [
    { step_id: 1, timestamp_relativo_ms: 100, tipo_evento: 'input', elemento: { tag: 'INPUT', seletores: { id: 'placa' } }, chamadas_rede: [] },
    { step_id: 2, timestamp_relativo_ms: 500, tipo_evento: 'click', elemento: { tag: 'BUTTON', seletores: { testid: 'btn-consultar' } }, chamadas_rede: [{ url: 'https://api.example.test/v1/veiculos', metodo: 'GET', status: 200 }] }
  ],
  diagnostics: []
};

const result = quality.analyze(sample);
assert.equal(result.status, 'revisar');
assert.equal(result.metrics.steps, 2);
assert.equal(result.metrics.selector_coverage, 1);
assert.equal(result.metrics.timestamp_coverage, 1);
assert.equal(result.metrics.network_correlation_coverage, 0.5);
assert.equal(result.metrics.outcome_coverage, 0.5);
assert.equal(result.sensitive_findings.length, 0);
assert.equal(result.gaps[0].id, 'G04');

const safe = quality.analyze({
  steps: [{ timestamp_relativo_ms: 1, elemento: { seletores: { id: 'x' } }, chamadas_rede: [{ url: '/x', status: 200 }] }]
});
assert.equal(safe.status, 'adequado');

const unsafe = quality.analyze({
  steps: [{ timestamp_relativo_ms: 1, elemento: { seletores: { id: 'x' } }, chamadas_rede: [{ url: '/x', status: 200, headers: { authorization: 'Bearer abc' } }] }]
});
assert.equal(unsafe.status, 'bloqueado');
assert.equal(unsafe.sensitive_findings.length, 1);

const md = quality.convertToMarkdown(result);
assert.match(md, /## Qualidade e suficiência da evidência/);
assert.match(md, /### Verificações/);
assert.match(md, /### Lacunas e pontos de revisão/);
assert.match(md, /G04/);

console.log('devtrail quality tests: ok');
