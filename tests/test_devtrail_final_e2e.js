'use strict';

const assert = require('node:assert/strict');

const formatters = require('../frontend/modules/devtrail_formatters.js');
const analyzer = require('../frontend/modules/devtrail_analyzer.js');
const specification = require('../frontend/modules/devtrail_specification.js');
const quality = require('../frontend/modules/devtrail_quality.js');
const readiness = require('../frontend/modules/devtrail_readiness.js');
const replayPlan = require('../frontend/modules/devtrail_replay_plan.js');
const replayValidator = require('../frontend/modules/devtrail_replay_validator.js');
const audit = require('../frontend/modules/devtrail_audit.js');
const drift = require('../frontend/modules/devtrail_drift.js');
const pkg = require('../frontend/modules/devtrail_package.js');

const session = {
  metadata: {
    session_id: 'e2e-original',
    url_alvo: 'https://example.test/process',
    started_at: '2026-09-24T00:00:00Z',
    duracao_total_ms: 2400
  },
  steps: [
    {
      step_id: 1,
      tipo_evento: 'input',
      elemento: { tag: 'input', seletores: { id: 'placa' } },
      valor_entrada: 'ABC1234',
      timestamp: '2026-09-24T00:00:01Z',
      chamadas_rede: []
    },
    {
      step_id: 2,
      tipo_evento: 'click',
      elemento: { tag: 'button', seletores: { testid: 'btn-consultar' } },
      timestamp: '2026-09-24T00:00:02Z',
      chamadas_rede: [
        { metodo: 'GET', url: 'https://api.example.test/v1/veiculos', status: 200 }
      ]
    }
  ]
};

const analysis = analyzer.analyze(session);
assert.ok(analysis);

const spec = specification.generate(session, analysis);
assert.ok(spec);

const q = quality.analyze(session, analysis);
assert.ok(q);

const ready = readiness.generate(session, analysis, q, spec);
assert.ok(ready);

const plan = replayPlan.build(session, analysis, ready);
assert.equal(plan.plan_type, 'devtrail-replay-plan');

const replaySession = JSON.parse(JSON.stringify(session));
replaySession.metadata.session_id = 'e2e-replay';
const validation = replayValidator.validate(replaySession, plan);
assert.equal(validation.status, 'conforme');

const auditReport = audit.build(session, analysis, q, ready, plan, validation);
assert.equal(auditReport.audit_type, 'devtrail-audit-traceability');

const driftReport = drift.compare(session, replaySession);
assert.equal(driftReport.interpretation.status, 'sem_drift_observado');

const handoff = pkg.build(session, analysis, q, spec, ready);
assert.equal(handoff.package_type, 'devtrail-rpa-handoff');

const markdown = [
  formatters.convertJsonToMarkdown(session),
  analyzer.convertToMarkdown(analysis),
  specification.convertToMarkdown(spec),
  quality.convertToMarkdown(q),
  readiness.convertToMarkdown(ready),
  replayPlan.convertToMarkdown(plan),
  replayValidator.convertToMarkdown(validation),
  audit.convertToMarkdown(auditReport),
  drift.toMarkdown(driftReport)
].join('\n');

assert.match(markdown, /Relato Técnico|Fluxo executado/);
assert.match(markdown, /Prontidão para automação\/RPA|Prontidão/);
assert.match(markdown, /Validação de reprodução DevTrail/);
assert.match(markdown, /Auditoria e rastreabilidade DevTrail/);
assert.match(markdown, /Análise de Drift e Regressão DevTrail/);
assert.equal(auditReport.security.credentials_stored, false);
assert.equal(driftReport.security.sensitive_values_compared, false);

console.log('DevTrail final E2E pipeline: ok');
