const assert = require('node:assert/strict');
const Drift = require('../frontend/modules/devtrail_drift.js');

const baseline = {
  session_id: 'base-1',
  url: 'https://example.test',
  steps: [
    { evento: 'click', label: 'Enviar', seletores: { id: 'btn-enviar' }, network_calls: [{ method: 'POST', url: '/api/send', status: 200 }] }
  ]
};

const current = {
  session_id: 'current-1',
  url: 'https://example.test',
  steps: [
    { evento: 'click', label: 'Enviar', seletores: { id: 'btn-submit' }, network_calls: [{ method: 'POST', url: '/api/send', status: 500 }] },
    { evento: 'click', label: 'Confirmar', seletores: { id: 'btn-confirm' }, network_calls: [] }
  ]
};

const report = Drift.compare(baseline, current);
assert.equal(report.metrics.baseline_steps, 1);
assert.equal(report.metrics.current_steps, 2);
assert.equal(report.metrics.step_delta, 1);
assert.ok(report.metrics.selector_drifts >= 1);
assert.ok(report.metrics.network_drifts >= 1);
assert.ok(report.changes.some(change => change.type === 'step_added'));
assert.ok(report.changes.some(change => change.type === 'network_status_drift'));
assert.equal(report.security.credentials_stored, false);
assert.equal(report.security.sensitive_values_compared, false);
assert.match(Drift.toMarkdown(report), /Análise de Drift e Regressão DevTrail/);

console.log('devtrail drift tests passed');
