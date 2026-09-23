'use strict';

const assert = require('node:assert/strict');
const VideoAutomationController = require('../frontend/modules/video_automation_controller.js');
const Validator = require('../video_automation_validator.js');
const EvidenceTimeline = require('../frontend/modules/video_evidence_timeline.js');

const controller = VideoAutomationController.create({
  getSettings: () => ({ markitdownEndpoint: 'http://localhost:8000' }),
  urlService: { isYouTubeUrl: url => /youtube\\.com|youtu\\.be/i.test(String(url || '')) },
  validator: Validator,
  evidenceTimeline: EvidenceTimeline,
  ui: { toast: () => {} },
  fetchImpl: async () => {
    throw new Error('fetch should not be called by deterministic tests');
  },
  documentRef: null,
  windowRef: {}
});

assert.equal(controller.isVideo({ type: 'video/mp4', name: 'screen.mp4' }), true);
assert.equal(controller.isVideo({ type: '', name: 'screen.webm' }), true);
assert.equal(controller.isVideo({ type: 'text/plain', name: 'notes.txt' }), false);
assert.equal(controller.normalizeEvidenceTimeline({
  timeline: [{ frame_index: 1, timestamp: 3 }],
  transcript_segments: [{ index: 1, start: 3, duration: 2, text: 'Confirmação' }],
  analysis: { etapas: [{
    ordem: 1,
    timestamp: '00:03',
    acao: 'Clicar',
    tipo_acao: 'click',
    evidencia: { frame_indices: [1], transcript_segment_indices: [1] }
  }] }
}).steps[0].timestamp, 3);
assert.equal(controller.automationFilename('pyautogui', { filename: 'Meu video.mp4' }), 'Meu_video-automacao-pyautogui.py');

const readyStep = {
  ordem: 1,
  acao: 'Clicar no botão',
  detalhes: 'Clique observado no botão',
  tipo_acao: 'click',
  alvo: { texto: 'Confirmar', x: 120, y: 80 },
  dados: {},
  precondicao: 'Tela de confirmação aberta',
  poscondicao: 'Botão acionado',
  evidencia: { frame_indices: [1] },
  confianca: 0.95,
  review_status: 'approved'
};
const data = {
  filename: 'processo.mp4',
  transcript: '',
  analysis: {
    objetivo: 'Confirmar processo',
    etapas: [readyStep]
  }
};

const normalizedTimeline = controller.normalizeEvidenceTimeline(data);
assert.equal(normalizedTimeline.steps.length, 1);
assert.deepEqual(normalizedTimeline.steps[0].frameIndices, [1]);
assert.deepEqual(normalizedTimeline.steps[0].transcriptSegmentIndices, []);
assert.equal(normalizedTimeline.steps[0].reviewStatus, 'approved');

const validation = controller.validateAnalysis(data, 'pyautogui');
assert.equal(validation.summary.total, 1);
assert.equal(validation.summary.ready, 1);
assert.equal(validation.summary.warning, 0);
assert.equal(validation.summary.blocked, 0);

const code = controller.generateAutomation(data, 'pyautogui');
assert.match(code, /import pyautogui/);
assert.match(code, /pyautogui\.click\(120, 80\)/);
assert.doesNotMatch(code, /DADO_SENSIVEL/);

const sensitiveData = JSON.parse(JSON.stringify(data));
sensitiveData.analysis.etapas[0].tipo_acao = 'type';
sensitiveData.analysis.etapas[0].alvo = { x: 10, y: 20 };
sensitiveData.analysis.etapas[0].dados = { sensivel: true, valor: 'segredo', campo: 'senha' };
sensitiveData.analysis.etapas[0].validation_overrides = { pyautogui: true };
const sensitiveValidation = controller.validateAnalysis(sensitiveData, 'pyautogui');
assert.equal(sensitiveValidation.summary.warning, 1);
const sensitiveCode = controller.generateAutomation(sensitiveData, 'pyautogui');
assert.ok(sensitiveCode.includes('{{DADO_SENSIVEL}}'));

console.log('video_automation_controller module tests: ok');
