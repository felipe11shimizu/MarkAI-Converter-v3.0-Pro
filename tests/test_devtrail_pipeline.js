'use strict';

const assert = require('node:assert/strict');
const analyzer = require('../frontend/modules/devtrail_analyzer.js');
const specification = require('../frontend/modules/devtrail_specification.js');
const quality = require('../frontend/modules/devtrail_quality.js');
const readiness = require('../frontend/modules/devtrail_readiness.js');
const pkg = require('../frontend/modules/devtrail_package.js');
const replay = require('../frontend/modules/devtrail_replay_plan.js');

const session = {
  metadata: {
    session_id: 'pipeline-test-001',
    timestamp_inicio: '2026-09-24T12:00:00.000Z',
    url_alvo: 'https://example.test/app',
    duracao_total_ms: 1200,
    resolucao_tela: { largura: 1920, altura: 1080 }
  },
  steps: [
    {
      step_id: 1,
      tipo_evento: 'input',
      timestamp_relativo_ms: 100,
      elemento: { tag: 'INPUT', texto_visivel: 'Placa', seletores: { id: 'placa' } },
      valor_entrada: 'ABC1234',
      chamadas_rede: []
    },
    {
      step_id: 2,
      tipo_evento: 'click',
      timestamp_relativo_ms: 500,
      elemento: { tag: 'BUTTON', texto_visivel: 'Consultar', seletores: { testid: 'btn-consultar' } },
      chamadas_rede: [{ url: 'https://api.example.test/v1/veiculos', metodo: 'GET', status: 200, tempo_resposta_ms: 140 }]
    }
  ],
  diagnostics: []
};

const analysis = analyzer.analyze(session);
const spec = specification.generate(session, analysis);
const evidence = quality.analyze(session, analysis);
const ready = readiness.generate(session, analysis, evidence, spec);
const handoff = pkg.build(session, analysis, evidence, spec, ready);
const replayPlan = replay.build(session, analysis, ready);

assert.equal(analysis.schema_version, '1.0');
assert.equal(spec.schema_version, '1.0');
assert.equal(evidence.schema_version, '1.0');
assert.equal(ready.schema_version, '1.0');
assert.equal(handoff.package_type, 'devtrail-rpa-handoff');
assert.equal(replayPlan.plan_type, 'devtrail-replay-plan');

assert.equal(analysis.metrics.steps, 2);
assert.equal(spec.functional_requirements.length, 2);
assert.equal(evidence.metrics.selector_coverage, 1);
assert.equal(ready.actions.length, 2);
assert.equal(handoff.analysis.metrics.steps, 2);
assert.equal(replayPlan.actions[1].network_assertions[0].status, 200);

const markdown = [
  analyzer.convertToMarkdown(analysis),
  specification.convertToMarkdown(spec),
  quality.convertToMarkdown(evidence),
  readiness.convertToMarkdown(ready),
  pkg.convertToMarkdown(handoff),
  replay.convertToMarkdown(replayPlan)
].join('\n');

assert.match(markdown, /## Inteligência do processo/);
assert.match(markdown, /## Especificação de desenvolvimento e RPA/);
assert.match(markdown, /## Qualidade e suficiência da evidência/);
assert.match(markdown, /## Prontidão para automação\/RPA/);
assert.match(markdown, /# DevTrail — Pacote Técnico para Automação\/RPA/);
assert.match(markdown, /## Plano de reprodução DevTrail/);

console.log('devtrail pipeline contract: ok');
