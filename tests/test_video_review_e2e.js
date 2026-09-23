'use strict';

const assert = require('node:assert/strict');
const VideoAutomationController = require('../frontend/modules/video_automation_controller.js');
const Validator = require('../video_automation_validator.js');
const EvidenceTimeline = require('../frontend/modules/video_evidence_timeline.js');

(async () => {
  class FakeZip {
    constructor() {
      this.files = {};
      FakeZip.last = this;
    }
    file(name, content) {
      this.files[name] = content;
    }
    async generateAsync() {
      return new Blob(['zip']);
    }
  }

  const downloads = { name: null };
  const fakeDocument = {
    createElement() {
      return {
        click() {},
        set download(value) { downloads.name = value; },
        get download() { return downloads.name; },
        set href() {},
        get href() { return ''; }
      };
    },
    body: { appendChild() {}, removeChild() {} },
    getElementById() { return null; }
  };

  const fakeCrypto = {
    subtle: {
      async digest(_algorithm, data) {
        const bytes = new Uint8Array(data);
        let state = 0x811c9dc5;
        for (const byte of bytes) {
          state ^= byte;
          state = Math.imul(state, 0x01000193) >>> 0;
        }
        const digest = new Uint8Array(32);
        for (let index = 0; index < digest.length; index++) {
          state = Math.imul(state ^ (index + 1), 0x01000193) >>> 0;
          digest[index] = state & 0xff;
        }
        return digest.buffer;
      }
    }
  };

  const controller = VideoAutomationController.create({
    getSettings: () => ({
      markitdownEndpoint: 'http://localhost:8000'
    }),
    urlService: {
      isYouTubeUrl: url =>
        /youtube\.com|youtu\.be/i.test(String(url || ''))
    },
    validator: Validator,
    evidenceTimeline: EvidenceTimeline,
    ui: { toast() {} },
    documentRef: fakeDocument,
    windowRef: {
      Blob,
      URL: {
        createObjectURL() { return 'blob:e2e'; },
        revokeObjectURL() {}
      }
    },
    zipImpl: FakeZip,
    cryptoImpl: fakeCrypto
  });

  const data = {
    filename: 'e2e-processo.mp4',
    transcript: 'Usuário abre a tela e confirma o processo.',
    analysis: {
      objetivo: 'Executar processo completo',
      etapas: [{
        ordem: 1,
        timestamp: '00:05',
        acao: 'Clicar no botão Confirmar',
        tipo_acao: 'click',
        alvo: { texto: 'Confirmar', x: 120, y: 80 },
        evidencia: { frame_indices: [2], transcript_segment_indices: [0] },
        confianca: 0.96,
        review_status: 'approved'
      }]
    },
    timeline: [
      { frame_index: 2, timestamp: 5 }
    ],
    transcript_segments: [
      { index: 0, start: 4, duration: 2, text: 'Confirmação' }
    ]
  };

  // 1. Evidence normalization.
  const timeline = controller.normalizeEvidenceTimeline(data);
  assert.equal(timeline.steps.length, 1);
  assert.equal(timeline.steps[0].timestamp, 5);
  assert.deepEqual(timeline.steps[0].frameIndices, [2]);
  assert.deepEqual(timeline.steps[0].transcriptSegmentIndices, [0]);

  // 2. Validation.
  const validation = controller.validateAnalysis(data, 'pyautogui');
  assert.equal(validation.summary.total, 1);
  assert.equal(validation.summary.ready, 1);
  assert.equal(validation.summary.blocked, 0);

  // 3. Generation must remain blocked until formal finalization.
  const blocked = controller.generateAutomation(data, 'pyautogui');
  assert.match(blocked, /Geração bloqueada/);
  assert.doesNotMatch(blocked, /import pyautogui/);

  // 4. Finalization protects the reviewed content.
  assert.equal(controller.finalizeReview(), true);
  const audit = controller.reviewAuditManifest(data, 'pyautogui');
  assert.equal(audit.review.finalized, true);
  assert.equal(audit.review.integrity_protected, true);
  assert.equal(audit.review.integrity_match, true);

  // 5. Generation is enabled after finalization.
  const automation = controller.generateAutomation(data, 'pyautogui');
  assert.match(automation, /import pyautogui/);
  assert.match(automation, /pyautogui\.click\(120, 80\)/);

  // 6. Export the complete auditable package.
  assert.equal(await controller.exportReviewPackage(data, 'pyautogui'), true);
  assert.equal(downloads.name, 'e2e-processo-pacote-revisao.zip');

  const packageFiles = FakeZip.last.files;
  const manifest = JSON.parse(packageFiles['e2e-processo-pacote-manifesto.json']);
  assert.equal(manifest.package_type, 'markai-video-review-package');
  assert.equal(manifest.integrity.algorithm, 'SHA-256');
  assert.equal(manifest.integrity.artifacts.length, 3);

  // 7. Verify package integrity.
  const verification = await controller.verifyReviewPackageManifest(manifest, packageFiles);
  assert.equal(verification.valid, true);
  assert.equal(verification.artifacts.every(item => item.valid), true);

  // 8. Any post-finalization mutation must invalidate the package.
  data.analysis.etapas[0].acao = 'Conteúdo adulterado';
  assert.equal(controller.isReviewPackageReady(data), false);
  const blockedTamper = controller.generateAutomation(data, 'pyautogui');
  assert.match(blockedTamper, /revisão finalizada foi alterada/);

  const tamperedFiles = {
    ...packageFiles,
    [manifest.integrity.artifacts[0].name]:
      packageFiles[manifest.integrity.artifacts[0].name] + '\\ntampered'
  };
  const tamperedVerification =
    await controller.verifyReviewPackageManifest(manifest, tamperedFiles);
  assert.equal(tamperedVerification.valid, false);

  console.log('video_review_e2e module tests: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
