'use strict';

const assert = require('node:assert/strict');
const validator = require('../video_automation_validator.js');

function step(overrides = {}) {
  return {
    tipo_acao: 'click',
    acao: 'Clique no botão',
    detalhes: 'Clique no botão observado.',
    alvo: {
      descricao: 'Botão',
      texto: 'Continuar',
      controle: 'button',
      x: 100,
      y: 200,
      seletores: ['#continuar'],
      atalho: null,
    },
    dados: { valor: '', campo: '', sensivel: false },
    precondicao: 'Tela pronta',
    poscondicao: 'Próxima tela visível',
    espera_segundos: 0,
    resultado: 'Tela alterada',
    evidencia: { frame_indices: [1], transcript_segment_indices: [1] },
    confianca: 0.95,
    ...overrides,
  };
}

{
  const result = validator.validateStep(step(), 'pyautogui', { transcriptAvailable: true });
  assert.equal(result.status, 'ready');
  assert.equal(result.blocked, false);
}

{
  const result = validator.validateStep(step({ alvo: {} }), 'pyautogui', { transcriptAvailable: true });
  assert.equal(result.status, 'blocked');
  assert.ok(result.issues.some(x => x.code === 'TARGET_MISSING'));
}

{
  const result = validator.validateStep(step({
    tipo_acao: 'type',
    dados: { campo: 'CPF', valor: '***', sensivel: true },
    precondicao: '',
    poscondicao: '',
    confianca: 0.5,
  }), 'pyautogui', { transcriptAvailable: true });
  assert.equal(result.status, 'warning');
  assert.ok(result.issues.some(x => x.code === 'SENSITIVE_DATA'));
  assert.ok(result.issues.some(x => x.code === 'CONFIDENCE_LOW'));
  assert.ok(result.issues.some(x => x.code === 'PRECONDITION_MISSING'));
  assert.ok(result.issues.some(x => x.code === 'POSTCONDITION_MISSING'));
}

{
  const result = validator.validateStep(step({
    tipo_acao: 'type',
    alvo: { texto: 'CPF', seletores: [], x: 100, y: 200 },
    dados: { campo: 'CPF', valor: '{{VALOR}}', sensivel: false },
  }), 'playwright', { transcriptAvailable: true });
  assert.equal(result.status, 'blocked');
  assert.ok(result.issues.some(x => x.code === 'LOCATOR_MISSING'));
}

{
  const result = validator.validateStep(step({
    tipo_acao: 'type',
    alvo: { seletores: ['#cpf'], texto: '', x: null, y: null },
    dados: { campo: 'CPF', valor: '{{VALOR}}', sensivel: false },
  }), 'playwright', { transcriptAvailable: true });
  assert.equal(result.status, 'ready');
}

{
  const result = validator.validateStep(step({
    tipo_acao: 'copy',
  }), 'pyautogui', { transcriptAvailable: true });
  assert.equal(result.status, 'blocked');
  assert.ok(result.issues.some(x => x.code === 'ACTION_PLATFORM_UNSUPPORTED'));
}

{
  const result = validator.validateStep(step({
    tipo_acao: 'wait',
    espera_segundos: 0,
    alvo: {},
  }), 'pyautogui', { transcriptAvailable: false });
  assert.equal(result.status, 'warning');
  assert.ok(result.issues.some(x => x.code === 'WAIT_DURATION_MISSING'));
}

{
  const result = validator.validateStep(step({
    tipo_acao: 'other',
  }), 'pyautogui', { transcriptAvailable: true });
  assert.equal(result.status, 'blocked');
  assert.ok(result.issues.some(x => x.code === 'ACTION_GENERIC'));
}

{
  const result = validator.validateAnalysis({
    etapas: [
      step(),
      step({ alvo: {} }),
      step({ confianca: 0.5, precondicao: '', poscondicao: '' }),
    ],
  }, 'pyautogui', { transcriptAvailable: true });
  assert.equal(result.summary.total, 3);
  assert.equal(result.summary.ready, 1);
  assert.equal(result.summary.blocked, 1);
  assert.equal(result.summary.warning, 1);
}

console.log('video automation validator tests passed');
