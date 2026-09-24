'use strict';

const assert = require('node:assert/strict');
const formatters = require('../frontend/modules/devtrail_formatters.js');

const sample = {
  metadata: {
    url_alvo: 'https://example.test/app',
    timestamp_inicio: '2026-09-24T12:00:00.000Z',
    duracao_total_ms: 12500,
    motivo_finalizacao: 'manual'
  },
  steps: [{
    step_id: 1,
    tipo_evento: 'click',
    timestamp_relativo_ms: 1200,
    elemento: {
      tag: 'BUTTON',
      texto_visivel: 'Salvar Dados',
      seletores: {
        testid: 'btn-salvar',
        id: 'btnSave',
        css: '#btnSave.btn-primary',
        xpath: "//button[text()='Salvar Dados']"
      }
    },
    chamadas_rede: [{
      url: 'https://api.example.test/v1/salvar',
      metodo: 'POST',
      status: 200,
      payload: { id: 10, nome: 'Teste' },
      tempo_resposta_ms: 140
    }]
  }]
};

const md = formatters.convertJsonToMarkdown(sample);
assert.match(md, /# DevTrail Telemetry Session/);
assert.match(md, /Salvar Dados/);
assert.match(md, /POST https:\/\/api\.example\.test\/v1\/salvar/);
assert.match(md, /"id": 10/);
assert.match(md, /0m 12s 500ms/);

console.log('devtrail formatter tests: ok');
