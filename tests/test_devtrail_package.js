'use strict';

const assert = require('node:assert/strict');
const pkg = require('../frontend/modules/devtrail_package.js');

const result = pkg.build(
  { metadata: { session_id: 'abc' }, steps: [{ step_id: 1 }] },
  { metrics: { steps: 1, network_calls: 0, diagnostics: 0 } },
  { status: 'adequado', metrics: { selector_coverage: 1, network_correlation_coverage: 0, outcome_coverage: 0 } },
  { objective: 'Consultar', api_contracts: [] },
  { readiness: 'requer_validacao', actions: [], confirmations: [] }
);
assert.equal(result.package_type, 'devtrail-rpa-handoff');
assert.equal(result.session.metadata.session_id, 'abc');
assert.equal(result.readiness.readiness, 'requer_validacao');

const md = pkg.convertToMarkdown(result);
assert.match(md, /# DevTrail — Pacote Técnico para Automação/RPA/);
assert.match(md, /## 3. Sequência para automação/);
assert.match(md, /## 6. Regras de segurança/);

console.log('devtrail package tests: ok');
