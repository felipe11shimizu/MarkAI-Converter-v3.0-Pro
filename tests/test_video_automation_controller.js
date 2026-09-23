'use strict';

const assert = require('node:assert/strict');
const VideoAutomationController = require('../frontend/modules/video_automation_controller.js');
const Validator = require('../video_automation_validator.js');
const EvidenceTimeline = require('../frontend/modules/video_evidence_timeline.js');

(async () => {

class FakeZip {
  constructor() { this.files = {}; FakeZip.last = this; }
  file(name, content) { this.files[name] = content; }
  async generateAsync() { return new Blob(['zip']); }
}

const downloadState = { href: null, name: null };
const fakeDocument = {
  createElement(tag) {
    return {
      tagName: tag,
      click() { downloadState.clicked = true; },
      set href(value) { downloadState.href = value; },
      get href() { return downloadState.href; },
      set download(value) { downloadState.name = value; },
      get download() { return downloadState.name; }
    };
  },
  body: { appendChild() {}, removeChild() {} },
  getElementById() { return null; }
};
const fakeCrypto = {
  subtle: {
    async digest() {
      return Uint8Array.from({ length: 32 }, (_, index) => index).buffer;
    }
  }
};

const fakeWindow = {
  Blob,
  URL: {
    createObjectURL() { return 'blob:review-package'; },
    revokeObjectURL() {}
  },
  setTimeout() {}
};

const controller = VideoAutomationController.create({
  getSettings: () => ({ markitdownEndpoint: 'http://localhost:8000' }),
  urlService: { isYouTubeUrl: url => /youtube\\.com|youtu\\.be/i.test(String(url || '')) },
  validator: Validator,
  evidenceTimeline: EvidenceTimeline,
  ui: { toast: () => {} },
  fetchImpl: async () => {
    throw new Error('fetch should not be called by deterministic tests');
  },
  documentRef: fakeDocument,
  windowRef: fakeWindow,
  zipImpl: FakeZip,
  cryptoImpl: fakeCrypto
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

assert.deepEqual(controller.reviewPackageReadiness(), {
  ready: false,
  reason: 'Nenhuma análise de vídeo disponível.'
});
assert.deepEqual(controller.reviewPackageReadiness(data), {
  ready: false,
  reason: 'Finalize a revisão humana para habilitar o pacote auditável.'
});
assert.equal(controller.isReviewPackageReady(data), false);
assert.equal(await controller.exportReviewPackage(data, 'pyautogui'), false);

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
assert.deepEqual(controller.reviewPackageReadiness(data), {
  ready: true,
  reason: 'Pacote auditável pronto para exportação.'
});
assert.equal(controller.isReviewPackageReady(data), true);
const code = controller.generateAutomation(data, 'pyautogui');
assert.match(code, /import pyautogui/);
assert.match(code, /pyautogui\.click\(120, 80\)/);
assert.doesNotMatch(code, /DADO_SENSIVEL/);

const packageData = await controller.exportReviewPackage(data, 'pyautogui');
assert.equal(packageData, true);
assert.equal(downloadState.name, 'processo-pacote-revisao.zip');
const packageManifest = JSON.parse(FakeZip.last.files['processo-pacote-manifesto.json']);
assert.equal(packageManifest.schema_version, '1.0');
assert.equal(packageManifest.package_type, 'markai-video-review-package');
assert.equal(packageManifest.source_filename, 'processo.mp4');
assert.equal(packageManifest.platform, 'pyautogui');
assert.equal(packageManifest.integrity_match, true);
assert.equal(packageManifest.files.length, 4);
assert.match(packageManifest.sensitive_data_policy, /DADO_SENSIVEL/);
assert.equal(packageManifest.integrity.algorithm, 'SHA-256');
assert.equal(packageManifest.integrity.artifacts.length, 3);
assert.equal(packageManifest.integrity.artifacts[0].sha256.length, 64);
assert.match(packageManifest.integrity.artifacts[0].sha256, /^[0-9a-f]{64}$/);
assert.equal(packageManifest.integrity.artifacts[0].name, 'processo-automacao-pyautogui.py');
assert.equal(packageManifest.integrity.artifacts[1].name, 'processo-auditoria-revisao.json');
assert.equal(packageManifest.integrity.artifacts[2].name, 'processo-analise-revisada.json');

const finalizedIntegrityAudit = controller.reviewAuditManifest(data, 'pyautogui');
assert.equal(finalizedIntegrityAudit.review.integrity_protected, true);
assert.equal(finalizedIntegrityAudit.review.integrity_match, true);

data.analysis.etapas[0].acao = 'alteração externa após finalização';
assert.deepEqual(controller.reviewPackageReadiness(data), {
  ready: false,
  reason: 'A análise foi alterada após a finalização; revise e finalize novamente.'
});
assert.equal(controller.isReviewPackageReady(data), false);
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
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
