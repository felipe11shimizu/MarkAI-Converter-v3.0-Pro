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

const auditManifest = controller.reviewAuditManifest(data, 'pyautogui');
assert.equal(auditManifest.schema_version, '1.0');
assert.equal(auditManifest.filename, 'processo.mp4');
assert.equal(auditManifest.platform, 'pyautogui');
assert.equal(auditManifest.original_analysis.preserved, true);
assert.equal(auditManifest.original_analysis.raw_snapshot_exported, false);
assert.equal(auditManifest.review.counts.approved, 1);
assert.equal(auditManifest.review.changes.length, 0);
assert.equal(auditManifest.validation.generationEligible, 1);
assert.deepEqual(auditManifest.generation.eligibleStepOrders, [1]);
assert.match(auditManifest.sensitive_data_policy, /DADO_SENSIVEL/);

const normalizedTimeline = controller.normalizeEvidenceTimeline(data);
assert.equal(normalizedTimeline.steps.length, 1);
assert.deepEqual(normalizedTimeline.steps[0].frameIndices, [1]);
assert.deepEqual(normalizedTimeline.steps[0].transcriptSegmentIndices, []);
assert.equal(normalizedTimeline.steps[0].reviewStatus, 'approved');

const validation = controller.validateAnalysis(data, 'pyautogui');
const originalBeforeReview = controller.getOriginalAnalysis();
assert.equal(originalBeforeReview.analysis.etapas[0].review_status, 'approved');
assert.equal(validation.summary.total, 1);
assert.equal(validation.summary.ready, 1);
assert.equal(validation.summary.warning, 0);
assert.equal(validation.summary.blocked, 0);

const historyAfterValidation = controller.getReviewHistory();
assert.deepEqual(historyAfterValidation, []);

const edited = controller.getOriginalAnalysis();
edited.analysis.etapas[0].acao = 'alteração externa';
assert.equal(controller.getOriginalAnalysis().analysis.etapas[0].acao, 'Clicar no botão');

data.analysis.etapas[0].review_status = 'pending';
const reviewHistoryBefore = controller.getReviewHistory();
assert.deepEqual(reviewHistoryBefore, []);
controller.validateAnalysis(data, 'pyautogui');
const originalStillApproved = controller.getOriginalAnalysis();
assert.equal(originalStillApproved.analysis.etapas[0].review_status, 'approved');

data.analysis.etapas[0].review_status = 'approved';
const blockedBeforeFinalization = controller.generateAutomation(data, 'pyautogui');
assert.match(blockedBeforeFinalization, /Geração bloqueada/);
assert.doesNotMatch(blockedBeforeFinalization, /import pyautogui/);
assert.equal(controller.finalizeReview(), true);
const code = controller.generateAutomation(data, 'pyautogui');
assert.match(code, /import pyautogui/);
assert.match(code, /pyautogui\.click\(120, 80\)/);
assert.doesNotMatch(code, /DADO_SENSIVEL/);

const finalizedIntegrityAudit = controller.reviewAuditManifest(data, 'pyautogui');
assert.equal(finalizedIntegrityAudit.review.integrity_protected, true);
assert.equal(finalizedIntegrityAudit.review.integrity_match, true);

data.analysis.etapas[0].acao = 'alteração externa após finalização';
const integrityBlocked = controller.generateAutomation(data, 'pyautogui');
assert.match(integrityBlocked, /revisão finalizada foi alterada/);
assert.doesNotMatch(integrityBlocked, /pyautogui\.click\(120, 80\)/);
const tamperedAudit = controller.reviewAuditManifest(data, 'pyautogui');
assert.equal(tamperedAudit.review.integrity_protected, true);
assert.equal(tamperedAudit.review.integrity_match, false);

data.analysis.etapas[0].acao = 'Clicar no botão';
controller.validateAnalysis(data, 'pyautogui');
const restoredCode = controller.generateAutomation(data, 'pyautogui');
assert.match(restoredCode, /pyautogui\.click\(120, 80\)/);

const pendingReviewData = JSON.parse(JSON.stringify(data));
pendingReviewData.analysis.etapas[0].review_status = 'pending';
controller.validateAnalysis(pendingReviewData, 'pyautogui');
assert.equal(controller.finalizeReview(), false);
controller.validateAnalysis(data, 'pyautogui');
assert.equal(controller.finalizeReview(), true);
const finalizedAudit = controller.reviewAuditManifest(data, 'pyautogui');
assert.equal(finalizedAudit.review.finalized, true);
assert.match(finalizedAudit.review.finalized_at, /^20/);

const sensitiveData = JSON.parse(JSON.stringify(data));
sensitiveData.analysis.etapas[0].review_status = 'approved';
sensitiveData.analysis.etapas[0].tipo_acao = 'type';
sensitiveData.analysis.etapas[0].alvo = { x: 10, y: 20 };
sensitiveData.analysis.etapas[0].dados = { sensivel: true, valor: 'segredo', campo: 'senha' };
sensitiveData.analysis.etapas[0].validation_overrides = { pyautogui: true };
const sensitiveValidation = controller.validateAnalysis(sensitiveData, 'pyautogui');
assert.equal(sensitiveValidation.summary.warning, 1);
assert.equal(controller.finalizeReview(), true);
const sensitiveCode = controller.generateAutomation(sensitiveData, 'pyautogui');
assert.ok(sensitiveCode.includes('{{DADO_SENSIVEL}}'));
console.log('video_automation_controller module tests: ok');
