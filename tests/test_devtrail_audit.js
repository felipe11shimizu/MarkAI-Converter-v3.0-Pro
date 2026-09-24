'use strict';

const assert = require('node:assert/strict');
const audit = require('../frontend/modules/devtrail_audit.js');

const session = {
  metadata: { session_id: 'sess-1', url_alvo: 'https://example.test', duracao_total_ms: 1200 },
  steps: [{ step_id: 1 }, { step_id: 2 }]
};
const analysis = { metrics: { steps: 2, selector_coverage: 1 } };
const quality = { status: 'adequado', metrics: { selector_coverage: 1, network_correlation_coverage: 1, outcome_coverage: 1 } };
const readiness = { readiness: 'pronto_para_automacao', confirmations: [] };
const plan = { actions: [
  { order: 1, action: 'click', target: '#a', expected_outcome: 'sucesso' },
  { order: 2, action: 'click', target: '#b', expected_outcome: 'sucesso' }
]};
const validation = {
  status: 'divergente',
  metrics: { expected_steps: 2, observed_steps: 2, conforme_steps: 1, divergent_steps: 1, not_observed_steps: 0, unexpected_network_calls: 1 },
  steps: [
    { step_id: 1, verdict: 'conforme', reasons: [] },
    { step_id: 2, verdict: 'divergente', reasons: ['Seletor divergente.'] }
  ]
};

const result = audit.build(session, analysis, quality, readiness, plan, validation);
assert.equal(result.audit_type, 'devtrail-audit-traceability');
assert.equal(result.traceability.length, 2);
assert.equal(result.traceability[1].replay_verdict, 'divergente');
assert.equal(result.open_points.length, 2);
assert.equal(result.security.credentials_stored, false);

const md = audit.convertToMarkdown(result);
assert.match(md, /# Auditoria e rastreabilidade DevTrail/);
assert.match(md, /## 3. Rastreabilidade etapa a etapa/);
assert.match(md, /## 5. Segurança e governança/);

console.log('devtrail audit tests: ok');
