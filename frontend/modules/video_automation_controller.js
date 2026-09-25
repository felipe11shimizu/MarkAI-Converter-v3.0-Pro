(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MarkAIVideoAutomationController = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

function create({
    getSettings,
    urlService,
    validator,
    ui = {},
    fetchImpl = globalThis.fetch,
    documentRef = globalThis.document,
    windowRef = globalThis,
    abortSignal = globalThis.AbortSignal,
    signalTimeout: injectedSignalTimeout,
    zipImpl = globalThis.JSZip,
    cryptoImpl = globalThis.crypto,
    evidenceTimeline = globalThis.MarkAIVideoEvidenceTimeline
  } = {}) {
  let lastAnalysis = null;
  let originalAnalysisSnapshot = null;
  let reviewHistory = [];
  let reviewFinalizedAt = null;
  let finalizedReviewSnapshot = null;
  const $ = id => documentRef ? documentRef.getElementById(id) : null;
  const signalTimeout = injectedSignalTimeout || ((ms) =>
    typeof abortSignal?.timeout === 'function' ? abortSignal.timeout(ms) : undefined
  );
  if (!evidenceTimeline || typeof evidenceTimeline.normalize !== 'function') {
    throw new TypeError('VideoAutomationController requires a VideoEvidenceTimeline dependency.');
  }
  if (!validator || typeof validator.normalizePlatform !== 'function' ||
      typeof validator.validateStep !== 'function' || typeof validator.validateAnalysis !== 'function') {
    throw new TypeError('VideoAutomationController requires an AutomationValidator dependency.');
  }
  if (!urlService || typeof urlService.isYouTubeUrl !== 'function') {
    throw new TypeError('VideoAutomationController requires a URL service.');
  }
  if (typeof getSettings !== 'function') {
    throw new TypeError('VideoAutomationController requires getSettings.');
  }

  const endpoint = () => {
    const s = getSettings() || {};
    return (s.markitdownEndpoint || 'http://localhost:8000').replace(/\/$/, '');
  };

  function openModal() {
    const modal = $('modalVideoAnalysis');
    if (modal && !modal.open) modal.showModal();
  }

  const REVIEW_STATUSES = {
    pending: { label: 'Para revisar', className: 'pending' },
    approved: { label: 'Aprovada', className: 'approved' },
    ignored: { label: 'Ignorada', className: 'ignored' }
  };

  const ACTION_OPTIONS = [
    ['click', 'Clique'], ['double_click', 'Duplo clique'], ['type', 'Digitação'],
    ['select', 'Seleção'], ['hotkey', 'Atalho'], ['keypress', 'Tecla'],
    ['scroll', 'Scroll'], ['drag', 'Arrastar'], ['wait', 'Espera'],
    ['open', 'Abrir'], ['navigate', 'Navegar'], ['download', 'Download'],
    ['upload', 'Upload'], ['copy', 'Copiar'], ['paste', 'Colar'],
    ['check', 'Validar'], ['submit', 'Enviar'], ['other', 'Outra']
  ];

  function _currentAutomationPlatform(data = lastAnalysis) {
    const select = $('videoAutomationTarget');
    const selected = select?.value || '';
    if (selected) return validator.normalizePlatform(selected);
    return validator.normalizePlatform(data?.analysis?.automacao?.plataforma_sugerida || 'pyautogui');
  }

  function _validateStepForPlatform(step, platform = _currentAutomationPlatform()) {
    const context = {
      transcriptAvailable: Array.isArray(lastAnalysis?.transcript_segments)
        ? lastAnalysis.transcript_segments.length > 0
        : !!String(lastAnalysis?.transcript || '').trim()
    };
    const result = validator.validateStep(step, platform, context);
    step.validacao_automacao = result;
    return result;
  }

  function _validateAnalysis(data = lastAnalysis, platform = _currentAutomationPlatform(data)) {
    const analysis = data?.analysis || {};
    const context = {
      transcriptAvailable: Array.isArray(data?.transcript_segments)
        ? data.transcript_segments.length > 0
        : !!String(data?.transcript || '').trim()
    };
    const validation = validator.validateAnalysis(analysis, platform, context);
    if (Array.isArray(analysis.etapas)) {
      analysis.etapas.forEach((step, index) => {
        if (step && validation.steps[index]) step.validacao_automacao = validation.steps[index];
      });
    }
    analysis.validacao_resumo = validation.summary;
    analysis.validacao_plataforma = platform;
    return validation;
  }

  function _snapshot(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return value;
    }
  }

  function _reviewIntegrityPayload(data) {
    const clone = _snapshot(data);
    const analysis = clone?.analysis;
    if (analysis && typeof analysis === 'object') {
      delete analysis.validacao_resumo;
      delete analysis.validacao_plataforma;
      if (Array.isArray(analysis.etapas)) {
        analysis.etapas.forEach(step => {
          if (step && typeof step === 'object') delete step.validacao_automacao;
        });
      }
    }
    return clone;
  }

  function _reviewIntegrityKey(data) {
    try {
      return JSON.stringify(_reviewIntegrityPayload(data));
    } catch (_) {
      return null;
    }
  }

  function _recordReviewChange(index, before, after, reason) {
    reviewHistory.push({
      timestamp: new Date().toISOString(),
      stepIndex: index,
      stepOrder: after?.ordem ?? before?.ordem ?? index + 1,
      reason: reason || 'review',
      before: _snapshot(before),
      after: _snapshot(after)
    });
  }

  function _ensureReviewState(data) {
    const analysis = data?.analysis;
    if (!analysis || !Array.isArray(analysis.etapas)) return;
    analysis.etapas.forEach(step => {
      if (!step || typeof step !== 'object') return;
      if (!REVIEW_STATUSES[step.review_status]) step.review_status = 'pending';
      if (typeof step.review_note !== 'string') step.review_note = '';
      if (!step.validation_overrides || typeof step.validation_overrides !== 'object' || Array.isArray(step.validation_overrides)) {
        step.validation_overrides = {};
      }
    });
  }

  function _reviewCounts(data = lastAnalysis) {
    const steps = Array.isArray(data?.analysis?.etapas) ? data.analysis.etapas : [];
    return steps.reduce((counts, step) => {
      const status = REVIEW_STATUSES[step.review_status] ? step.review_status : 'pending';
      counts[status] += 1;
      counts.total += 1;
      return counts;
    }, { pending: 0, approved: 0, ignored: 0, total: 0 });
  }

  function _validationCounts(data = lastAnalysis, platform = _currentAutomationPlatform(data)) {
    const validation = _validateAnalysis(data, platform);
    const approvedSteps = Array.isArray(data?.analysis?.etapas)
      ? data.analysis.etapas.filter(step => step.review_status === 'approved')
      : [];
    const approvedBlocked = approvedSteps.filter(step => step.validacao_automacao?.status === 'blocked').length;
    const approvedWarningsPendingOverride = approvedSteps.filter(step =>
      step.validacao_automacao?.status === 'warning' && !step.validation_overrides?.[platform]
    ).length;
    return {
      ...validation.summary,
      approvedBlocked,
      approvedWarningsPendingOverride,
      generationEligible: approvedSteps.filter(step =>
        step.validacao_automacao?.status === 'ready' ||
        (step.validacao_automacao?.status === 'warning' && step.validation_overrides?.[platform])
      ).length
    };
  }

  function _visibleReviewedSteps(data = lastAnalysis) {
    const steps = Array.isArray(data?.analysis?.etapas) ? data.analysis.etapas : [];
    const filter = $('videoReviewFilter')?.value || 'all';
    return steps
      .map((step, index) => ({ step, index }))
      .filter(item => {
        if (filter === 'all') return true;
        if (filter === 'validation_ready') return item.step.validacao_automacao?.status === 'ready';
        if (filter === 'validation_warning') return item.step.validacao_automacao?.status === 'warning';
        if (filter === 'validation_blocked') return item.step.validacao_automacao?.status === 'blocked';
        return item.step.review_status === filter;
      });
  }

  function _setReviewStatus(index, status, options = {}) {
    const step = lastAnalysis?.analysis?.etapas?.[index];
    if (!step || !REVIEW_STATUSES[status] || reviewFinalizedAt) return;
    const before = _snapshot(step);
    const platform = _currentAutomationPlatform();
    step.review_status = status;
    step.validation_overrides = step.validation_overrides || {};
    if (status === 'approved' && options.explicit) {
      const validation = _validateStepForPlatform(step, platform);
      step.validation_overrides[platform] = validation.status === 'warning';
    } else if (status !== 'approved') {
      step.validation_overrides[platform] = false;
    }
    _recordReviewChange(index, before, step, 'status');
    render(lastAnalysis, { open: false });
  }

  function _approveAllVideoSteps() {
    if (!lastAnalysis?.analysis?.etapas || reviewFinalizedAt) return;
    lastAnalysis.analysis.etapas.forEach((step, index) => {
      const before = _snapshot(step);
      step.review_status = 'approved';
      step.validation_overrides = {};
      _recordReviewChange(index, before, step, 'approve_all');
    });
    render(lastAnalysis, { open: false });
  }

  function _persistStepEdit(index, values) {
    if (reviewFinalizedAt) return;
    const step = lastAnalysis?.analysis?.etapas?.[index];
    if (!step) return;
    const before = _snapshot(step);
    step.acao = values.acao;
    step.detalhes = values.detalhes;
    step.tipo_acao = values.tipo_acao;
    step.alvo = step.alvo || {};
    step.alvo.texto = values.alvoTexto;
    step.alvo.descricao = values.alvoDescricao;
    step.alvo.controle = values.alvoControle;
    step.alvo.seletores = values.seletor ? [values.seletor] : [];
    step.alvo.x = values.x === '' ? null : Number(values.x);
    step.alvo.y = values.y === '' ? null : Number(values.y);
    step.alvo.atalho = values.atalho || null;
    step.dados = step.dados || {};
    step.dados.campo = values.dataCampo || '';
    step.dados.sensivel = values.dadosSensivel === 'sim';
    step.dados.valor = step.dados.sensivel ? '{{DADO_SENSIVEL}}' : (values.dataValor || '');
    step.precondicao = values.precondicao || '';
    step.poscondicao = values.poscondicao || '';
    step.confianca = values.confianca === '' ? null : Math.max(0, Math.min(1, Number(values.confianca)));
    step.review_note = values.review_note || '';
    step.review_status = 'approved';

    const platform = _currentAutomationPlatform();
    const validation = _validateStepForPlatform(step, platform);
    step.validation_overrides = {};
    if (validation.status === 'warning') step.validation_overrides[platform] = true;

    _recordReviewChange(index, before, step, 'edit');
    render(lastAnalysis, { open: false });
  }

  function _createInput(label, value, options = {}) {
    const group = documentRef.createElement('label');
    group.className = 'form-group' + (options.full ? ' full' : '');
    const caption = documentRef.createElement('span');
    caption.className = 'form-label';
    caption.textContent = label;
    const input = options.type === 'select' ? documentRef.createElement('select') : documentRef.createElement('input');
    input.className = 'input-field input-field-sm';
    input.value = value ?? '';
    if (options.type !== 'select') {
      input.type = options.type || 'text';
      if (options.step) input.step = options.step;
      if (options.min !== undefined) input.min = options.min;
      if (options.max !== undefined) input.max = options.max;
      if (options.placeholder) input.placeholder = options.placeholder;
      if (options.readOnly) input.readOnly = true;
    }
    if (options.type === 'select') {
      (options.options || []).forEach(([optionValue, optionLabel]) => {
        const option = documentRef.createElement('option');
        option.value = optionValue;
        option.textContent = optionLabel;
        input.appendChild(option);
      });
      input.value = value || options.options?.[0]?.[0] || '';
    }
    group.append(caption, input);
    return { group, input };
  }

  function _reviewStepEditor(step, index) {
    const editor = documentRef.createElement('div');
    editor.className = 'video-review-editor';

    const action = _createInput('Ação', step.acao || '', { full: true });
    const details = _createInput('Detalhes', step.detalhes || '', { full: true });
    const type = _createInput('Tipo de ação', step.tipo_acao || 'other', { type: 'select', options: ACTION_OPTIONS });
    const targetText = _createInput('Texto / alvo', step.alvo?.texto || '', {});
    const targetDescription = _createInput('Descrição do alvo', step.alvo?.descricao || '', {});
    const targetControl = _createInput('Controle', step.alvo?.controle || '', {});
    const selector = _createInput('Seletor', step.alvo?.seletores?.[0] || '', {});
    const x = _createInput('X', step.alvo?.x ?? '', { type: 'number', step: '1' });
    const y = _createInput('Y', step.alvo?.y ?? '', { type: 'number', step: '1' });
    const shortcut = _createInput('Atalho / tecla', step.alvo?.atalho || '', {});
    const dataField = _createInput('Campo de dados', step.dados?.campo || '', {});
    const sensitive = Boolean(step.dados?.sensivel);
    const dataValue = _createInput(
      'Valor de entrada',
      sensitive ? '{{DADO_SENSIVEL}}' : (step.dados?.valor || ''),
      { readOnly: sensitive, placeholder: sensitive ? 'Valor sensível não é exibido' : '' }
    );
    const sensitiveSelect = _createInput(
      'Dado sensível',
      sensitive ? 'sim' : 'nao',
      { type: 'select', options: [['nao', 'Não'], ['sim', 'Sim']] }
    );
    const precondition = _createInput('Pré-condição', step.precondicao || '', { full: true });
    const postcondition = _createInput('Pós-condição', step.poscondicao || '', { full: true });
    const confidence = _createInput('Confiança', step.confianca ?? '', { type: 'number', step: '0.01', min: '0', max: '1' });
    const note = _createInput('Observação da revisão', step.review_note || '', { full: true });

    editor.append(
      action.group, details.group, type.group, targetText.group,
      targetDescription.group, targetControl.group, selector.group,
      x.group, y.group, shortcut.group, dataField.group, dataValue.group,
      sensitiveSelect.group, precondition.group, postcondition.group,
      confidence.group, note.group
    );

    const actions = documentRef.createElement('div');
    actions.className = 'video-review-actions full';

    const approve = documentRef.createElement('button');
    approve.className = 'btn btn-primary btn-sm';
    approve.type = 'button';
    approve.textContent = 'Aprovar revisão';
    approve.addEventListener('click', () => _persistStepEdit(index, {
      acao: action.input.value.trim(),
      detalhes: details.input.value.trim(),
      tipo_acao: type.input.value,
      alvoTexto: targetText.input.value.trim(),
      alvoDescricao: targetDescription.input.value.trim(),
      alvoControle: targetControl.input.value.trim(),
      seletor: selector.input.value.trim(),
      x: x.input.value,
      y: y.input.value,
      atalho: shortcut.input.value.trim(),
      dataCampo: dataField.input.value.trim(),
      dataValor: dataValue.input.readOnly ? '' : dataValue.input.value.trim(),
      dadosSensivel: sensitiveSelect.input.value,
      precondicao: precondition.input.value.trim(),
      poscondicao: postcondition.input.value.trim(),
      confianca: confidence.input.value,
      review_note: note.input.value.trim()
    }));

    const pending = documentRef.createElement('button');
    pending.className = 'btn btn-ghost btn-sm';
    pending.type = 'button';
    pending.textContent = 'Manter para revisar';
    pending.addEventListener('click', () => _setReviewStatus(index, 'pending'));

    const ignore = documentRef.createElement('button');
    ignore.className = 'btn btn-ghost btn-sm';
    ignore.type = 'button';
    ignore.textContent = 'Ignorar';
    ignore.addEventListener('click', () => _setReviewStatus(index, 'ignored'));

    actions.append(approve, pending, ignore);
    editor.appendChild(actions);
    if (reviewFinalizedAt) {
      [action.input, details.input, type.input, targetText.input, targetDescription.input,
        targetControl.input, selector.input, x.input, y.input, shortcut.input, dataField.input,
        dataValue.input, sensitiveSelect.input, precondition.input, postcondition.input,
        confidence.input, note.input, approve, pending, ignore].forEach(control => {
        control.disabled = true;
      });
    }
    return editor;
  }

  function _updateReviewSummary(platform = _currentAutomationPlatform()) {
    const summary = $('videoReviewSummary');
    if (!summary) return;
    const counts = _reviewCounts();
    const validation = _validationCounts(lastAnalysis, platform);
    summary.textContent =
      counts.approved + ' aprovadas · ' +
      counts.pending + ' para revisar · ' +
      counts.ignored + ' ignoradas · ' +
      validation.ready + ' prontas · ' +
      validation.warning + ' com alertas · ' +
      validation.blocked + ' bloqueadas';
  }

  function finalizeReview() {
    if (!lastAnalysis?.analysis || !Array.isArray(lastAnalysis.analysis.etapas)) return false;
    const counts = _reviewCounts(lastAnalysis);
    if (counts.pending > 0) return false;
    if (!reviewFinalizedAt) {
      finalizedReviewSnapshot = _reviewIntegrityPayload(lastAnalysis);
      reviewFinalizedAt = new Date().toISOString();
    }
    render(lastAnalysis, { open: false });
    return true;
  }

  function _safeJsonData(data) {
    try {
      const clone = JSON.parse(JSON.stringify(data));
      const steps = clone?.analysis?.etapas;
      if (Array.isArray(steps)) {
        steps.forEach(step => {
          if (step?.dados?.sensivel) step.dados.valor = '{{DADO_SENSIVEL}}';
        });
      }
      return clone;
    } catch (_) {
      return data;
    }
  }

  function _renderValidationDetails(step, platform) {
    const validation = step.validacao_automacao || _validateStepForPlatform(step, platform);
    const meta = {
      ready: { label: 'Pronta', className: 'ready' },
      warning: { label: 'Revisar', className: 'warning' },
      blocked: { label: 'Bloqueada', className: 'blocked' }
    }[validation.status] || { label: 'Revisar', className: 'warning' };

    const panel = documentRef.createElement('div');
    panel.className = 'video-validation';

    const head = documentRef.createElement('div');
    head.className = 'video-validation-head';
    const badge = documentRef.createElement('span');
    badge.className = 'video-validation-badge ' + meta.className;
    badge.textContent = 'Validação: ' + meta.label;
    const score = documentRef.createElement('span');
    score.className = 'video-validation-score';
    score.textContent = 'Score operacional: ' + Math.round(Number(validation.score || 0) * 100) + '%';
    head.append(badge, score);
    panel.appendChild(head);

    if (!validation.issues.length) {
      const ok = documentRef.createElement('small');
      ok.textContent = 'Nenhum alerta identificado para a plataforma ' + platform + '.';
      panel.appendChild(ok);
      return panel;
    }

    const list = documentRef.createElement('ul');
    list.className = 'video-validation-list';
    validation.issues.forEach(issue => {
      const item = documentRef.createElement('li');
      item.className = 'video-validation-item ' + (issue.severity === 'error' ? 'error' : 'warning');
      item.textContent = '[' + issue.code + '] ' + issue.message;
      if (issue.suggestion) {
        const suggestion = documentRef.createElement('span');
        suggestion.className = 'video-validation-suggestion';
        suggestion.textContent = 'Sugestão: ' + issue.suggestion;
        item.appendChild(suggestion);
      }
      list.appendChild(item);
    });
    panel.appendChild(list);

    const override = step.validation_overrides?.[platform] === true;
    if (validation.status === 'warning' && override) {
      const note = documentRef.createElement('small');
      note.textContent = 'Alertas revisados explicitamente; a etapa pode entrar na geração desta plataforma.';
      panel.appendChild(note);
    } else if (validation.status !== 'ready') {
      const note = documentRef.createElement('small');
      note.textContent = 'A geração não incluirá esta etapa enquanto os bloqueios/alertas não forem resolvidos ou explicitamente revisados.';
      panel.appendChild(note);
    }
    return panel;
  }

  function reviewAuditManifest(data = lastAnalysis, platform = _currentAutomationPlatform(data)) {
    if (data !== lastAnalysis) {
      lastAnalysis = data;
      originalAnalysisSnapshot = _snapshot(data);
      reviewHistory = [];
      reviewFinalizedAt = null;
      finalizedReviewSnapshot = null;
    }
    _ensureReviewState(data);

    const normalizedPlatform = validator.normalizePlatform(platform);
    const counts = _reviewCounts(data);
    const validation = _validationCounts(data, normalizedPlatform);
    const eligibleStepOrders = (Array.isArray(data?.analysis?.etapas) ? data.analysis.etapas : [])
      .filter(step => step.review_status === 'approved')
      .filter(step =>
        step.validacao_automacao?.status === 'ready' ||
        (step.validacao_automacao?.status === 'warning' && step.validation_overrides?.[normalizedPlatform] === true)
      )
      .map((step, index) => step.ordem ?? index + 1);

    return {
      schema_version: '1.0',
      generated_at: new Date().toISOString(),
      filename: data?.filename || null,
      platform: normalizedPlatform,
      original_analysis: {
        preserved: Boolean(originalAnalysisSnapshot),
        raw_snapshot_exported: false
      },
      review: {
        finalized: Boolean(reviewFinalizedAt),
        finalized_at: reviewFinalizedAt,
        integrity_protected: Boolean(finalizedReviewSnapshot),
        integrity_match: Boolean(
          finalizedReviewSnapshot &&
          _reviewIntegrityKey(data) === _reviewIntegrityKey(finalizedReviewSnapshot)
        ),
        counts,
        changes: reviewHistory.map(change => ({
          timestamp: change.timestamp,
          stepIndex: change.stepIndex,
          stepOrder: change.stepOrder,
          reason: change.reason,
          beforeStatus: change.before?.review_status || null,
          afterStatus: change.after?.review_status || null,
          hasReviewNote: Boolean(String(change.after?.review_note || '').trim())
        }))
      },
      validation: {
        summary: {
          total: validation.total,
          ready: validation.ready,
          warning: validation.warning,
          blocked: validation.blocked
        },
        approvedBlocked: validation.approvedBlocked,
        approvedWarningsPendingOverride: validation.approvedWarningsPendingOverride,
        generationEligible: validation.generationEligible
      },
      generation: {
        policy: 'approved + ready, or approved + warning with explicit platform override',
        eligibleStepOrders
      },
      sensitive_data_policy: 'Sensitive values are not included in this audit manifest; exported automation uses {{DADO_SENSIVEL}}.'
    };
  }

  function normalizeEvidenceTimeline(data) {
    return evidenceTimeline.normalize(data);
  }

  function reviewPackageReadiness(data = lastAnalysis) {
    if (!data) return { ready: false, reason: 'Nenhuma análise de vídeo disponível.' };
    if (!reviewFinalizedAt) return { ready: false, reason: 'Finalize a revisão humana para habilitar o pacote auditável.' };
    if (finalizedReviewSnapshot && _reviewIntegrityKey(data) !== _reviewIntegrityKey(finalizedReviewSnapshot)) {
      return { ready: false, reason: 'A análise foi alterada após a finalização; revise e finalize novamente.' };
    }
    return { ready: true, reason: 'Pacote auditável pronto para exportação.' };
  }

  function isReviewPackageReady(data = lastAnalysis) {
    return reviewPackageReadiness(data).ready;
  }

  function reviewPackageManifest(data = lastAnalysis, platform = _currentAutomationPlatform(data)) {
    if (!data || !isReviewPackageReady(data)) return false;
    const normalizedPlatform = validator.normalizePlatform(platform);
    const base = String(data?.filename || 'video').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_') || 'video';
    const automationFilename = _automationFilename(normalizedPlatform, data);
    const auditFilename = base + '-auditoria-revisao.json';
    const analysisFilename = base + '-analise-revisada.json';
    const packageFilename = base + '-pacote-manifesto.json';
    return {
      schema_version: '1.0',
      package_type: 'markai-video-review-package',
      generated_at: new Date().toISOString(),
      source_filename: data?.filename || null,
      platform: normalizedPlatform,
      review_finalized_at: reviewFinalizedAt,
      integrity_match: true,
      sensitive_data_policy: 'Sensitive values are not included in exported analysis; automation uses {{DADO_SENSIVEL}}.',
      files: [
        { name: automationFilename, type: 'automation', description: 'Generated automation for the selected platform.' },
        { name: auditFilename, type: 'review_audit', description: 'Human review, validation and integrity audit manifest.' },
        { name: analysisFilename, type: 'reviewed_analysis', description: 'Sanitized reviewed analysis with sensitive placeholders.' },
        { name: packageFilename, type: 'package_manifest', description: 'Manifest of the package contents and export state.' }
      ]
    };
  }

  async function verifyReviewPackageManifest(manifest, artifacts = {}) {
    if (!manifest || manifest.schema_version !== '1.0' || manifest.package_type !== 'markai-video-review-package') {
      return { valid: false, reason: 'Manifesto de pacote de revisão inválido.', artifacts: [] };
    }
    const entries = Array.isArray(manifest.integrity?.artifacts) ? manifest.integrity.artifacts : [];
    if (manifest.integrity?.algorithm !== 'SHA-256' || !entries.length) {
      return { valid: false, reason: 'Manifesto sem informações de integridade SHA-256.', artifacts: [] };
    }
    const results = [];
    for (const entry of entries) {
      if (!entry?.name || !/^[0-9a-f]{64}$/.test(String(entry.sha256 || ''))) {
        results.push({ name: entry?.name || null, valid: false, reason: 'Hash SHA-256 inválido.' });
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(artifacts, entry.name)) {
        results.push({ name: entry.name, valid: false, reason: 'Artefato não fornecido para verificação.' });
        continue;
      }
      const actual = await _sha256Text(artifacts[entry.name]);
      results.push({ name: entry.name, expected: entry.sha256, actual, valid: actual === entry.sha256 });
    }
    return {
      valid: results.length > 0 && results.every(item => item.valid),
      reason: results.every(item => item.valid) ? 'Integridade SHA-256 confirmada.' : 'Um ou mais artefatos não correspondem ao manifesto.',
      artifacts: results
    };
  }

  async function _sha256Text(value) {
    if (!cryptoImpl?.subtle || typeof cryptoImpl.subtle.digest !== 'function') {
      throw new TypeError('Review package export requires Web Crypto SHA-256 support.');
    }
    const bytes = new TextEncoder().encode(String(value));
    const digest = await cryptoImpl.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function exportReviewPackage(data = lastAnalysis, platform = _currentAutomationPlatform(data)) {
    if (!isReviewPackageReady(data)) return false;
    if (typeof zipImpl !== 'function') throw new TypeError('Review package export requires JSZip.');
    const normalizedPlatform = validator.normalizePlatform(platform);
    const code = _generateAutomation(normalizedPlatform, data);
    const audit = reviewAuditManifest(data, normalizedPlatform);
    const analysis = _safeJsonData(data);
    const base = String(data?.filename || 'video').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_') || 'video';
    const automationFilename = _automationFilename(normalizedPlatform, data);
    const auditFilename = base + '-auditoria-revisao.json';
    const analysisFilename = base + '-analise-revisada.json';
    const manifestFilename = base + '-pacote-manifesto.json';
    const auditJson = JSON.stringify(audit, null, 2);
    const analysisJson = JSON.stringify(analysis, null, 2);
    const packageManifest = reviewPackageManifest(data, normalizedPlatform);
    packageManifest.integrity = {
      algorithm: 'SHA-256',
      scope: 'automation, review audit and reviewed analysis; the manifest itself is excluded to avoid circular hashing.',
      artifacts: [
        { name: automationFilename, sha256: await _sha256Text(code) },
        { name: auditFilename, sha256: await _sha256Text(auditJson) },
        { name: analysisFilename, sha256: await _sha256Text(analysisJson) }
      ]
    };
    const zip = new zipImpl();
    zip.file(automationFilename, code);
    zip.file(auditFilename, auditJson);
    zip.file(analysisFilename, analysisJson);
    zip.file(manifestFilename, JSON.stringify(packageManifest, null, 2));
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = windowRef.URL.createObjectURL(blob);
    const a = documentRef.createElement('a');
    a.href = url;
    a.download = base + '-pacote-revisao.zip';
    documentRef.body.appendChild(a);
    a.click();
    documentRef.body.removeChild(a);
    windowRef.URL.revokeObjectURL(url);
    if (typeof ui.toast === 'function') ui.toast('Pacote de revisão exportado: ' + a.download, 'success');
    return true;
  }

  function _formatTimestamp(seconds) {
    if (seconds == null || !Number.isFinite(Number(seconds))) return '—';
    const total = Math.max(0, Math.round(Number(seconds)));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return hours
      ? String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ':' + String(secs).padStart(2, '0')
      : String(minutes).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
  }

  function _scrollToEvidenceStep(order) {
    const target = documentRef?.querySelector?.('[data-video-step-order="' + String(order) + '"]');
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.focus?.({ preventScroll: true });
    target.classList.add('video-step-evidence-focus');
    windowRef.setTimeout?.(() => target.classList.remove('video-step-evidence-focus'), 1200);
  }

  function _renderReviewHistory() {
    const root = $('videoReviewHistory');
    if (!root) return;
    root.replaceChildren();

    const title = documentRef.createElement('h3');
    title.textContent = 'Auditoria da revisão';
    root.appendChild(title);

    const meta = documentRef.createElement('p');
    meta.className = 'form-hint';
    meta.textContent = reviewHistory.length
      ? 'Análise original preservada · ' + reviewHistory.length + ' alteração(ões) registradas.'
      : 'Análise original preservada · nenhuma alteração de revisão registrada.';
    root.appendChild(meta);

    if (!reviewHistory.length) return;

    const list = documentRef.createElement('ol');
    list.className = 'video-review-history-list';
    reviewHistory.forEach(change => {
      const item = documentRef.createElement('li');
      item.className = 'video-review-history-item';

      const head = documentRef.createElement('strong');
      head.textContent = 'Etapa ' + change.stepOrder + ' · ' + (
        change.reason === 'edit' ? 'edição' :
        change.reason === 'approve_all' ? 'aprovação em lote' :
        'alteração de status'
      );

      const time = documentRef.createElement('time');
      time.dateTime = change.timestamp;
      time.textContent = new Date(change.timestamp).toLocaleString('pt-BR');

      const details = documentRef.createElement('small');
      details.textContent = [
        'Antes: ' + (change.before?.review_status || '—'),
        'Depois: ' + (change.after?.review_status || '—'),
        change.after?.review_note ? 'Observação: ' + change.after.review_note : ''
      ].filter(Boolean).join(' · ');

      item.append(head, time, details);
      list.appendChild(item);
    });
    root.appendChild(list);
  }

  function _renderEvidenceTimeline(data) {
    const root = $('videoEvidenceTimeline');
    if (!root) return;
    root.replaceChildren();

    const timeline = normalizeEvidenceTimeline(data);
    const title = documentRef.createElement('h3');
    title.textContent = 'Timeline operacional de evidências';
    root.appendChild(title);

    const hint = documentRef.createElement('p');
    hint.className = 'form-hint';
    hint.textContent = 'Selecione uma etapa para localizar a evidência correspondente na revisão.';
    root.appendChild(hint);

    if (!timeline.steps.length) {
      const empty = documentRef.createElement('small');
      empty.textContent = 'Nenhuma etapa disponível na timeline.';
      root.appendChild(empty);
      return;
    }

    const track = documentRef.createElement('div');
    track.className = 'video-evidence-timeline-track';

    timeline.steps.forEach(step => {
      const item = documentRef.createElement('button');
      item.type = 'button';
      item.className = 'video-evidence-timeline-item';
      item.dataset.videoStepOrder = String(step.order);
      item.title = 'Localizar etapa ' + step.order;
      item.addEventListener('click', () => _scrollToEvidenceStep(step.order));

      const time = documentRef.createElement('span');
      time.className = 'video-evidence-timeline-time';
      time.textContent = _formatTimestamp(step.timestamp);

      const label = documentRef.createElement('strong');
      label.textContent = 'Etapa ' + step.order;

      const action = documentRef.createElement('span');
      action.className = 'video-evidence-timeline-action';
      action.textContent = step.action || 'Ação não identificada';

      const refs = documentRef.createElement('small');
      refs.textContent =
        'Frame: ' + (step.frameIndices.length ? step.frameIndices.join(', ') : '—') +
        ' · Fala: ' + (step.transcriptSegmentIndices.length ? step.transcriptSegmentIndices.join(', ') : '—');

      item.append(time, label, action, refs);
      track.appendChild(item);
    });

    root.appendChild(track);
  }

  function _renderEvidenceMatrix(data) {
    const root = $('videoEvidenceMatrix');
    if (!root) return;
    root.replaceChildren();

    const analysis = data?.analysis || {};
    const timeline = normalizeEvidenceTimeline(data);
    const steps = timeline.steps;
    const title = documentRef.createElement('h3');
    title.textContent = 'Matriz de evidência · fala × frame × ação × decisão';
    root.appendChild(title);

    const summary = documentRef.createElement('div');
    summary.className = 'video-evidence-matrix-summary';
    const evidenceSummary = analysis.evidencia_resumo || {};
    const stepsWithFrames = steps.filter(step => step.frameIndices.length > 0).length;
    const stepsWithTranscript = steps.filter(step => step.transcriptSegmentIndices.length > 0).length;
    summary.textContent =
      'Etapas: ' + steps.length +
      ' · frames correlacionados: ' + (evidenceSummary.etapas_com_frame ?? stepsWithFrames) +
      ' · fala correlacionada: ' + (evidenceSummary.etapas_com_transcricao ?? stepsWithTranscript) +
      ' · segmentos de transcrição: ' + (evidenceSummary.segmentos_transcricao_total ?? timeline.transcriptSegments.length);
    root.appendChild(summary);

    if (!steps.length) {
      const empty = documentRef.createElement('small');
      empty.textContent = 'Nenhuma etapa estruturada disponível para correlação.';
      root.appendChild(empty);
      return;
    }

    const wrap = documentRef.createElement('div');
    wrap.className = 'video-evidence-table-wrap';
    const table = documentRef.createElement('table');
    table.className = 'video-evidence-table';
    const thead = documentRef.createElement('thead');
    const headerRow = documentRef.createElement('tr');
    ['Etapa', 'Tempo', 'Ação', 'Frame', 'Fala', 'Decisão / resultado', 'Confiança'].forEach(label => {
      const th = documentRef.createElement('th');
      th.textContent = label;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = documentRef.createElement('tbody');
    steps.forEach((step, index) => {
      const row = documentRef.createElement('tr');
      const cells = [
        String(step.order || index + 1),
        step.timestamp == null ? '' : String(step.timestamp),
        String(step.actionType || 'other') + (step.action ? ' · ' + step.action : ''),
        step.frameIndices.join(', '),
        step.transcriptSegmentIndices.join(', '),
        [
          step.precondition ? 'pré: ' + step.precondition : '',
          step.postcondition ? 'pós: ' + step.postcondition : '',
          step.result ? 'resultado: ' + step.result : ''
        ].filter(Boolean).join(' · ') || '—',
        step.confidence == null ? '—' : Math.round(step.confidence * 100) + '%'
      ];
      cells.forEach((value, cellIndex) => {
        const td = documentRef.createElement('td');
        td.textContent = value;
        if (cellIndex === 3 || cellIndex === 4) td.className = 'video-evidence-chip';
        row.appendChild(td);
      });
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    root.appendChild(wrap);
  }

  function _automationValue(step) {
    const data = step?.dados || {};
    if (data.sensivel) return '{{DADO_SENSIVEL}}';
    return data.valor || '';
  }

  function _automationTarget(step) {
    const target = step?.alvo || {};
    const selectors = Array.isArray(target.seletores) ? target.seletores.filter(Boolean) : [];
    const selector = selectors[0] || '';
    const text = target.texto || '';
    const x = Number.isFinite(Number(target.x)) ? Number(target.x) : null;
    const y = Number.isFinite(Number(target.y)) ? Number(target.y) : null;
    return { selector, text, x, y };
  }

  function _automationValue(step) {
    const data = step?.dados || {};
    if (data.sensivel) return '{{DADO_SENSIVEL}}';
    return data.valor || '';
  }

  function _automationTarget(step) {
    const target = step?.alvo || {};
    const selectors = Array.isArray(target.seletores) ? target.seletores.filter(Boolean) : [];
    const selector = selectors[0] || '';
    const text = target.texto || '';
    const x = Number.isFinite(Number(target.x)) ? Number(target.x) : null;
    const y = Number.isFinite(Number(target.y)) ? Number(target.y) : null;
    return { selector, text, x, y };
  }

  function _pyString(value) {
    return JSON.stringify(String(value ?? ''));
  }

  function _seleniumLocator(target) {
    const selector = target.selector;
    if (selector) {
      const match = selector.match(/^(css|xpath|id|name|class|link_text|partial_link_text)=(.*)$/i);
      if (match) {
        const map = {
          css: 'CSS_SELECTOR', xpath: 'XPATH', id: 'ID', name: 'NAME',
          class: 'CLASS_NAME', link_text: 'LINK_TEXT', partial_link_text: 'PARTIAL_LINK_TEXT'
        };
        return { by: map[match[1].toLowerCase()], value: match[2] };
      }
      return { by: 'CSS_SELECTOR', value: selector };
    }
    if (target.text) return { by: 'XPATH', value: '//*[contains(normalize-space(.), ' + _pyString(target.text) + ')]' };
    return null;
  }

  function _playwrightTarget(target) {
    if (target.selector) return `page.locator(${_pyString(target.selector)})`;
    if (target.text) return `page.get_by_text(${_pyString(target.text)})`;
    return null;
  }

  function _pyautoguiStep(step, index) {
    const action = step.tipo_acao || 'other';
    const target = _automationTarget(step);
    const value = _automationValue(step);
    const comment = `# Etapa ${step.ordem || index + 1}: ${String(step.acao || step.detalhes || '').replace(/\\n/g, ' ')}`;
    const lines = [comment];
    const hasPoint = target.x !== null && target.y !== null;
    if (step.espera_segundos) lines.push(`time.sleep(${Number(step.espera_segundos) || 0})`);
    switch (action) {
      case 'click':
        lines.push(hasPoint ? `pyautogui.click(${target.x}, ${target.y})` : '# TODO: confirmar coordenadas do alvo e usar pyautogui.click(x, y)');
        break;
      case 'double_click':
        lines.push(hasPoint ? `pyautogui.doubleClick(${target.x}, ${target.y})` : '# TODO: confirmar coordenadas do alvo e usar pyautogui.doubleClick(x, y)');
        break;
      case 'type':
        if (hasPoint) lines.push(`pyautogui.click(${target.x}, ${target.y})`);
        lines.push(value ? `pyautogui.write(${_pyString(value)})` : `pyautogui.write(${_pyString('{{VALOR_DO_CAMPO}}')})`);
        break;
      case 'select':
        if (hasPoint) lines.push(`pyautogui.click(${target.x}, ${target.y})`);
        lines.push(value ? `pyautogui.write(${_pyString(value)})` : `# TODO: selecionar a opção observada`);
        lines.push('pyautogui.press("enter")');
        break;
      case 'hotkey':
        lines.push(`pyautogui.hotkey(${(step.alvo?.atalho || 'ctrl+s').split(/[+\\s]+/).filter(Boolean).map(k => _pyString(k.lowerCase ? k.lowerCase() : k.toLowerCase())).join(', ')})`);
        break;
      case 'keypress':
        lines.push(`pyautogui.press(${_pyString(step.alvo?.atalho || target.text || 'enter')})`);
        break;
      case 'scroll':
        lines.push(`pyautogui.scroll(${Number(step.detalhes?.match?.(/-?\\d+/)?.[0]) || -1})`);
        break;
      case 'drag':
        lines.push(hasPoint ? `pyautogui.moveTo(${target.x}, ${target.y}); pyautogui.dragRel(100, 0, duration=0.5)  # TODO: confirmar destino` : '# TODO: confirmar origem e destino do arraste');
        break;
      case 'wait':
        lines.push(`time.sleep(${Number(step.espera_segundos) || 1})`);
        break;
      default:
        lines.push(`# TODO: implementar ação "${action}" observada: ${String(step.detalhes || '').replace(/\\n/g, ' ')}`);
    }
    if (step.poscondicao) lines.push(`# Pós-condição observada: ${String(step.poscondicao).replace(/\\n/g, ' ')}`);
    return lines.join('\\n');
  }

  function _playwrightStep(step, index) {
    const action = step.tipo_acao || 'other';
    const target = _automationTarget(step);
    const locator = _playwrightTarget(target);
    const value = _automationValue(step);
    const comment = `# Etapa ${step.ordem || index + 1}: ${String(step.acao || step.detalhes || '').replace(/\\n/g, ' ')}`;
    const lines = [comment];
    if (step.espera_segundos) lines.push(`page.wait_for_timeout(${Math.round((Number(step.espera_segundos) || 0) * 1000)})`);
    switch (action) {
      case 'click': lines.push(locator ? `${locator}.click()` : '# TODO: confirmar locator do elemento'); break;
      case 'double_click': lines.push(locator ? `${locator}.dblclick()` : '# TODO: confirmar locator do elemento'); break;
      case 'type': lines.push(locator ? `${locator}.fill(${_pyString(value || '{{VALOR_DO_CAMPO}}')})` : '# TODO: confirmar locator do campo'); break;
      case 'select': lines.push(locator ? `${locator}.select_option(label=${_pyString(value || '{{OPCAO}}')})` : '# TODO: confirmar locator do select'); break;
      case 'hotkey':
      case 'keypress': lines.push(locator ? `${locator}.press(${_pyString(step.alvo?.atalho || 'Enter')})` : `page.keyboard.press(${_pyString(step.alvo?.atalho || 'Enter')})`); break;
      case 'scroll': lines.push(`page.mouse.wheel(0, ${Number(step.detalhes?.match?.(/-?\\d+/)?.[0]) || 500})`); break;
      case 'upload': lines.push(locator ? `${locator}.set_input_files(${_pyString('{{ARQUIVO}}')})` : '# TODO: confirmar locator do input[type=file]'); break;
      case 'navigate':
      case 'open': lines.push(`page.goto(${_pyString(target.text || '{{URL}}')})`); break;
      case 'check': lines.push(locator ? `assert ${locator}.is_visible()` : '# TODO: implementar validação observada'); break;
      case 'submit': lines.push(locator ? `${locator}.click()` : '# TODO: localizar botão de envio'); break;
      default: lines.push(`# TODO: implementar ação "${action}" observada`);
    }
    if (step.poscondicao) lines.push(`# Pós-condição observada: ${String(step.poscondicao).replace(/\\n/g, ' ')}`);
    return lines.join('\\n');
  }

  function _seleniumStep(step, index) {
    const action = step.tipo_acao || 'other';
    const target = _automationTarget(step);
    const loc = _seleniumLocator(target);
    const value = _automationValue(step);
    const comment = `# Etapa ${step.ordem || index + 1}: ${String(step.acao || step.detalhes || '').replace(/\\n/g, ' ')}`;
    const lines = [comment];
    if (step.espera_segundos) lines.push(`time.sleep(${Number(step.espera_segundos) || 0})`);
    const find = loc ? `driver.find_element(By.${loc.by}, ${_pyString(loc.value)})` : null;
    switch (action) {
      case 'click': lines.push(find ? `${find}.click()` : '# TODO: confirmar locator do elemento'); break;
      case 'double_click': lines.push(find ? `ActionChains(driver).double_click(${find}).perform()` : '# TODO: confirmar locator do elemento'); break;
      case 'type': lines.push(find ? `${find}.clear(); ${find}.send_keys(${_pyString(value || '{{VALOR_DO_CAMPO}}')})` : '# TODO: confirmar locator do campo'); break;
      case 'select': lines.push(find ? `Select(${find}).select_by_visible_text(${_pyString(value || '{{OPCAO}}')})` : '# TODO: confirmar locator do select'); break;
      case 'hotkey': lines.push(find ? `${find}.send_keys(${_pyString(step.alvo?.atalho || 'CTRL+S')})` : `ActionChains(driver).key_down(Keys.CONTROL).send_keys('s').key_up(Keys.CONTROL).perform()  # TODO: confirmar atalho`); break;
      case 'keypress': lines.push(find ? `${find}.send_keys(${_pyString(step.alvo?.atalho || 'ENTER')})` : `ActionChains(driver).send_keys(Keys.ENTER).perform()`); break;
      case 'scroll': lines.push(`driver.execute_script("windowRef.scrollBy(0, ${Number(step.detalhes?.match?.(/-?\\d+/)?.[0]) || 500})")`); break;
      case 'navigate':
      case 'open': lines.push(`driver.get(${_pyString(target.text || '{{URL}}')})`); break;
      case 'upload': lines.push(find ? `${find}.send_keys(${_pyString('{{ARQUIVO_ABSOLUTO}}')})` : '# TODO: confirmar locator do input[type=file]'); break;
      case 'submit': lines.push(find ? `${find}.click()` : '# TODO: localizar botão de envio'); break;
      case 'check': lines.push(find ? `assert ${find}.is_displayed()` : '# TODO: implementar validação observada'); break;
      default: lines.push(`# TODO: implementar ação "${action}" observada`);
    }
    if (step.poscondicao) lines.push(`# Pós-condição observada: ${String(step.poscondicao).replace(/\\n/g, ' ')}`);
    return lines.join('\\n');
  }

  function _rpaStep(step, index) {
    const action = step.tipo_acao || 'other';
    const target = _automationTarget(step);
    const value = _automationValue(step);
    const comment = `    # Etapa ${step.ordem || index + 1}: ${String(step.acao || step.detalhes || '').replace(/\\n/g, ' ')}`;
    const locator = target.x !== null && target.y !== null
      ? `point:${target.x},${target.y}`
      : target.text ? `ocr:${JSON.stringify(target.text)}` : '';
    const lines = [comment];
    switch (action) {
      case 'click': lines.push(locator ? `    Click    ${locator}` : '    # TODO: definir locator (point:, ocr: ou image:)'); break;
      case 'double_click': lines.push(locator ? `    Double Click    ${locator}` : '    # TODO: definir locator'); break;
      case 'type': lines.push(`    Type Text    ${_pyString(value || '{{VALOR_DO_CAMPO}}')}`); break;
      case 'select': lines.push(value ? `    Type Text    ${_pyString(value)}` : '    # TODO: selecionar a opção observada'); break;
      case 'hotkey':
      case 'keypress': lines.push(`    Press Keys    ${(step.alvo?.atalho || 'enter').split(/[+\\s]+/).filter(Boolean).join('    ')}`); break;
      case 'wait': lines.push(`    Sleep    ${Number(step.espera_segundos) || 1}s`); break;
      case 'scroll': lines.push('    Scroll Down'); break;
      case 'open':
      case 'navigate': lines.push('    # TODO: abrir/navegar para a aplicação ou URL observada'); break;
      case 'upload': lines.push('    # TODO: selecionar o arquivo observado no diálogo de upload'); break;
      case 'download': lines.push('    # TODO: validar/aguardar o download observado'); break;
      case 'check': lines.push(`    # TODO: validar: ${String(step.poscondicao || step.resultado || '').replace(/\\n/g, ' ')}`); break;
      default: lines.push(`    # TODO: implementar ação "${action}" observada`);
    }
    return lines.join('\\n');
  }

  function _generateAutomation(platform, data) {
    const analysis = data?.analysis || {};
    _ensureReviewState(data);
    const normalizedPlatform = validator.normalizePlatform(platform);
    _validateAnalysis(data, normalizedPlatform);
    const header = [
      '# Roteiro gerado pelo MarkAI Converter — revisão humana obrigatória.',
      '# As ações abaixo foram derivadas da análise observacional do vídeo.',
      '# Etapas com bloqueios de validação ou sem revisão explícita foram excluídas.',
      '# Dados sensíveis são substituídos por placeholders e nunca devem ser embutidos no código.',
      ''
    ];
    if (!reviewFinalizedAt) {
      return [
        ...header,
        '# Geração bloqueada: a revisão humana ainda não foi finalizada.',
        '# Conclua todas as etapas pendentes, execute a validação e finalize a revisão antes de gerar a automação.'
      ].join('\\n');
    }

    if (finalizedReviewSnapshot && _reviewIntegrityKey(data) !== _reviewIntegrityKey(finalizedReviewSnapshot)) {
      return [
        ...header,
        '# Geração bloqueada: a revisão finalizada foi alterada após o bloqueio.',
        '# A análise precisa permanecer idêntica ao conteúdo revisado antes da geração da automação.'
      ].join('\\n');
    }
    const steps = (Array.isArray(analysis.etapas) ? analysis.etapas : [])
      .filter(step => {
        if (step.review_status !== 'approved') return false;
        const status = step.validacao_automacao?.status;
        if (status === 'ready') return true;
        return status === 'warning' && step.validation_overrides?.[normalizedPlatform] === true;
      });

    if (!steps.length) {
      return [
        ...header,
        '# Nenhuma etapa aprovada e validada está pronta para geração.',
        '# Execute "Validar automação", corrija bloqueios/alertas e aprove explicitamente as etapas.'
      ].join('\n');
    }

    if (normalizedPlatform === 'pyautogui') {
      return [...header, 'import time', 'import pyautogui', '', '# Objetivo: ' + (analysis.objetivo || 'processo observado'), '', ...steps.map(_pyautoguiStep)].join('\n');
    }
    if (normalizedPlatform === 'playwright') {
      return [...header, 'import time', 'from playwright.sync_api import sync_playwright', '', 'with sync_playwright() as p:', '    browser = p.chromium.launch(headless=False)', '    page = browser.new_page()', '    # Objetivo: ' + (analysis.objetivo || 'processo observado'), '', ...steps.map((s,i) => _playwrightStep(s,i).split('\n').map(line => '    ' + line).join('\n')), '', '    # browser.close()  # habilite quando a validação estiver concluída'].join('\n');
    }
    if (normalizedPlatform === 'selenium') {
      return [...header, 'import time', 'from selenium import webdriver', 'from selenium.webdriver.common.by import By', 'from selenium.webdriver.common.keys import Keys', 'from selenium.webdriver.common.action_chains import ActionChains', 'from selenium.webdriver.support.ui import Select', '', 'driver = webdriver.Chrome()', '# Objetivo: ' + (analysis.objetivo || 'processo observado'), '', ...steps.map((s,i) => _seleniumStep(s,i)), '', '# driver.quit()  # habilite quando a validação estiver concluída'].join('\n');
    }
    return [...header, '*** Settings ***', 'Library    RPA.Desktop', '', '*** Tasks ***', 'Executar processo observado', ...steps.map(_rpaStep), ''].join('\n');
  }

  function _automationFilename(platform, data) {
    const base = String(data?.filename || 'video').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_') || 'video';
    return base + '-automacao-' + platform + (platform === 'rpa' ? '.robot' : '.py');
  }

  function renderAutomation(platform = 'pyautogui') {
    const normalizedPlatform = validator.normalizePlatform(platform);
    const code = _generateAutomation(normalizedPlatform, lastAnalysis);
    const output = $('videoAutomationCode');
    const status = $('videoAutomationStatus');
    if (output) output.textContent = code;

    const review = _reviewCounts(lastAnalysis);
    const validation = _validationCounts(lastAnalysis, normalizedPlatform);
    const eligible = validation.generationEligible;
    if (status) {
      status.textContent =
        'Roteiro ' + normalizedPlatform + ': ' + eligible + ' etapa(s) elegíveis. ' +
        review.pending + ' pendente(s), ' +
        validation.warning + ' com alerta(s) e ' +
        validation.blocked + ' bloqueada(s).';
    }
    return code;
  }

  function render(data, options = {}) {
    if (data !== lastAnalysis) {
      lastAnalysis = data;
      originalAnalysisSnapshot = _snapshot(data);
      reviewHistory = [];
      reviewFinalizedAt = null;
      finalizedReviewSnapshot = null;
    }
    _ensureReviewState(data);

    const analysis = data.analysis || {};
    const automationTarget = $('videoAutomationTarget');
    const suggestedPlatform = validator.normalizePlatform(
      analysis?.automacao?.plataforma_sugerida || 'pyautogui'
    );
    if (automationTarget && ['pyautogui', 'playwright', 'selenium', 'rpa'].includes(suggestedPlatform) && !analysis.validacao_plataforma) {
      automationTarget.value = suggestedPlatform;
    }
    const platform = automationTarget?.value || suggestedPlatform;
    _validateAnalysis(data, platform);
    const allSteps = Array.isArray(analysis.etapas) ? analysis.etapas : [];
    const visible = _visibleReviewedSteps(data);
    const summary = $('videoAnalysisSummary');
    const list = $('videoSteps');
    const transcript = $('videoTranscript');
    const json = $('videoJson');

    if (summary) {
      summary.replaceChildren();
      const title = documentRef.createElement('strong');
      title.textContent = analysis.objetivo || data.filename || 'Análise do vídeo';
      const desc = documentRef.createElement('p');
      const evidenceSummary = analysis.evidencia_resumo;
      desc.textContent = analysis.resumo || ((data.frames_analyzed || 0) + ' quadros analisados.');
      const counts = _reviewCounts(data);
      const evidenceText = documentRef.createElement('small');
      evidenceText.textContent =
        'Revisão: ' + counts.approved + ' aprovadas · ' + counts.pending +
        ' pendentes · ' + counts.ignored + ' ignoradas' +
        (evidenceSummary
          ? ' · evidência: ' + (evidenceSummary.etapas_com_frame || 0) + '/' +
            (evidenceSummary.etapas_total || 0) + ' com frame · ' +
            (evidenceSummary.etapas_com_transcricao || 0) + '/' +
            (evidenceSummary.etapas_total || 0) + ' com fala'
          : '') + (data.evidencia_video
          ? ' · vídeo: ' + (data.evidencia_video.frames_selecionados || data.frames_analyzed || 0) +
            ' frames selecionados · redução ' + Math.round((data.evidencia_video.taxa_reducao || data.frame_reduction_rate || 0) * 100) + '%'
          : '');
      summary.append(title, desc, evidenceText);
    }

    _updateReviewSummary(platform);
    const finalizeButton = $('btnFinalizeVideoReview');
    if (finalizeButton) {
      finalizeButton.disabled = Boolean(reviewFinalizedAt);
      finalizeButton.textContent = reviewFinalizedAt ? 'Revisão finalizada' : 'Finalizar revisão';
    }
    const approveAllButton = $('btnApproveAllVideoSteps');
    if (approveAllButton) approveAllButton.disabled = Boolean(reviewFinalizedAt);
    const packageButton = $('btnDownloadVideoReviewPackage');
    const packageStatus = $('videoReviewPackageStatus');
    if (packageButton || packageStatus) {
      const readiness = reviewPackageReadiness(lastAnalysis);
      if (packageButton) {
        packageButton.disabled = !readiness.ready;
        packageButton.title = readiness.reason;
      }
      if (packageStatus) {
        packageStatus.textContent = readiness.reason;
        packageStatus.className = 'form-hint video-review-package-status' + (readiness.ready ? ' ready' : '');
      }
    }
    _renderReviewHistory();
    _renderEvidenceTimeline(data);
    _renderEvidenceMatrix(data);

    if (list) {
      list.replaceChildren();
      if (!visible.length) {
        const empty = documentRef.createElement('div');
        empty.className = 'workspace-empty';
        empty.textContent = allSteps.length
          ? 'Nenhuma etapa corresponde ao filtro selecionado.'
          : 'Nenhuma etapa estruturada foi identificada.';
        list.appendChild(empty);
      }

      visible.forEach(({ step, index }) => {
        const status = REVIEW_STATUSES[step.review_status] || REVIEW_STATUSES.pending;
        const validation = step.validacao_automacao || _validateStepForPlatform(step, platform);
        const card = documentRef.createElement('article');
        card.className = 'video-step-card review-' + status.className;
        card.dataset.videoStepOrder = String(step.ordem || index + 1);
        card.tabIndex = -1;

        const head = documentRef.createElement('div');
        head.className = 'video-step-head';
        const order = documentRef.createElement('span');
        order.className = 'video-step-order';
        order.textContent = String(step.ordem || index + 1);
        const time = documentRef.createElement('span');
        time.className = 'video-step-time';
        time.textContent = step.timestamp || '';

        const reviewStatus = documentRef.createElement('div');
        reviewStatus.className = 'video-review-status';
        const badge = documentRef.createElement('span');
        badge.className = 'video-review-badge ' + status.className;
        badge.textContent = status.label;
        const validationBadge = documentRef.createElement('span');
        validationBadge.className = 'video-review-badge ' + ({ ready: 'validation-ready', warning: 'validation-warning', blocked: 'validation-blocked' }[validation.status] || 'validation-warning');
        validationBadge.textContent = 'Validação: ' + ({ ready: 'Pronta', warning: 'Revisar', blocked: 'Bloqueada' }[validation.status] || 'Revisar');
        const statusSelect = documentRef.createElement('select');
        statusSelect.className = 'input-field input-field-sm';
        Object.entries(REVIEW_STATUSES).forEach(([value, info]) => {
          const option = documentRef.createElement('option');
          option.value = value;
          option.textContent = info.label;
          statusSelect.appendChild(option);
        });
        statusSelect.value = step.review_status;
        statusSelect.addEventListener('change', event => _setReviewStatus(index, event.target.value, { explicit: event.target.value === 'approved' }));
        reviewStatus.append(badge, validationBadge, statusSelect);

        head.append(order, time, reviewStatus);

        const actionHeading = documentRef.createElement('h4');
        actionHeading.textContent = step.acao || 'Ação não identificada';
        const details = documentRef.createElement('p');
        details.textContent = step.detalhes || '';
        card.append(head, actionHeading, details);

        if (Array.isArray(step.elementos) && step.elementos.length) {
          const elements = documentRef.createElement('small');
          elements.textContent = 'Elementos: ' + step.elementos.join(', ');
          card.appendChild(elements);
        }

        if (step.resultado) {
          const result = documentRef.createElement('small');
          result.textContent = 'Resultado: ' + step.resultado;
          card.appendChild(result);
        }

        const action = step.tipo_acao || 'other';
        const actionLabel = {
          click: 'Clique', double_click: 'Duplo clique', type: 'Digitação',
          select: 'Seleção', hotkey: 'Atalho', keypress: 'Tecla',
          scroll: 'Scroll', drag: 'Arrastar', wait: 'Espera',
          open: 'Abrir', navigate: 'Navegar', download: 'Download',
          upload: 'Upload', copy: 'Copiar', paste: 'Colar',
          check: 'Validar', submit: 'Enviar', other: 'Ação'
        }[action] || action;

        const automation = documentRef.createElement('div');
        automation.className = 'video-automation-action';
        const actionTitle = documentRef.createElement('strong');
        actionTitle.textContent = 'Automação: ' + actionLabel;
        automation.appendChild(actionTitle);

        const target = step.alvo || {};
        const targetText = [
          target.descricao || target.texto || target.controle || '',
          target.x != null && target.y != null ? 'posição (' + target.x + ', ' + target.y + ')' : '',
          Array.isArray(target.seletores) && target.seletores.length
            ? 'seletores: ' + target.seletores.join(', ')
            : ''
        ].filter(Boolean).join(' · ');
        if (targetText) {
          const targetEl = documentRef.createElement('small');
          targetEl.textContent = 'Alvo: ' + targetText;
          automation.appendChild(targetEl);
        }

        if (step.dados && (step.dados.campo || step.dados.valor)) {
          const dataEl = documentRef.createElement('small');
          const safeValue = step.dados.sensivel ? '{{DADO_SENSIVEL}}' : (step.dados.valor || '');
          dataEl.textContent =
            'Dados: ' + (step.dados.campo || '') +
            (safeValue ? ' = ' + safeValue : '') +
            (step.dados.sensivel ? ' [sensível]' : '');
          automation.appendChild(dataEl);
        }

        if (step.espera_segundos) {
          const waitEl = documentRef.createElement('small');
          waitEl.textContent = 'Espera: ' + step.espera_segundos + 's';
          automation.appendChild(waitEl);
        }

        if (step.precondicao || step.poscondicao) {
          const verifyEl = documentRef.createElement('small');
          verifyEl.textContent = [
            step.precondicao ? 'Pré: ' + step.precondicao : '',
            step.poscondicao ? 'Pós: ' + step.poscondicao : ''
          ].filter(Boolean).join(' · ');
          automation.appendChild(verifyEl);
        }

        const evidence = step.evidencia || {};
        if ((evidence.frame_indices && evidence.frame_indices.length) ||
            (evidence.transcript_segment_indices && evidence.transcript_segment_indices.length)) {
          const evidenceEl = documentRef.createElement('small');
          const frameLabel = evidence.frame_indices?.length
            ? 'frames: ' + evidence.frame_indices.join(', ')
            : '';
          const transcriptLabel = evidence.transcript_segment_indices?.length
            ? 'fala: ' + evidence.transcript_segment_indices.join(', ')
            : '';
          evidenceEl.textContent = 'Evidência: ' + [frameLabel, transcriptLabel].filter(Boolean).join(' · ');
          automation.appendChild(evidenceEl);
        }

        if (step.confianca != null) {
          const confidence = documentRef.createElement('small');
          confidence.className = 'video-confidence';
          confidence.textContent = 'Confiança informada: ' + Math.round(Number(step.confianca) * 100) + '%';
          automation.appendChild(confidence);
        }

        card.appendChild(automation);
        card.appendChild(_renderValidationDetails(step, platform));

        const editor = _reviewStepEditor(step, index);
        card.appendChild(editor);

        list.appendChild(card);
      });
    }

    if (transcript) transcript.textContent = data.transcript || 'Nenhuma fala identificada.';
    if (json) json.textContent = JSON.stringify(_safeJsonData({ ...data, analysis }), null, 2);

    renderAutomation(platform);
    if (windowRef.lucide?.createIcons) windowRef.lucide.createIcons();
    if (options.open !== false) openModal();
  }

  async function analyzeYoutube(url) {
    const normalized = String(url || '').trim();
    if (!normalized) return;
    const overlay = $('procOverlay');
    const label = $('procLabel');
    const sub = $('procSub');
    if (overlay) overlay.style.display = 'flex';
    if (label) label.textContent = 'Analisando YouTube…';
    if (sub) sub.textContent = 'Obtendo transcrição, vídeo, quadros e eventos de tela.';
    try {
      const endpointUrl = endpoint();
      const languages = $('youtubeLanguage')?.value;
      const languageList = languages && languages !== 'auto'
        ? [languages, 'pt-BR', 'pt', 'en', 'es']
        : ['pt-BR', 'pt', 'en', 'es'];
      const payload = {
        url: normalized,
        languages: [...new Set(languageList)],
        translate_to: $('youtubeTranslate')?.value || null,
        task_prompt: $('videoPrompt')?.value || '',
        analysis_mode: $('videoAnalysisMode')?.value || 'transcript'
      };
      const response = await fetchImpl(endpointUrl + '/api/youtube/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: signalTimeout(600000)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = typeof data.detail === 'object'
          ? (data.detail.message || data.detail.code)
          : data.detail;
        throw new Error(detail || ('Falha HTTP ' + response.status));
      }
      render(data);
      if (typeof ui.toast === 'function') ui.toast(($('videoAnalysisMode')?.value || 'transcript') === 'transcript' ? 'Análise por transcrição do YouTube concluída.' : 'Análise multimodal do YouTube concluída.', 'success');
    } catch (error) {
      if (typeof ui.toast === 'function') ui.toast('Falha no YouTube: ' + error.message, 'error');
      else windowRef.alert('Falha no YouTube: ' + error.message);
    } finally {
      if (overlay) overlay.style.display = 'none';
    }
  }

  async function analyze(file) {
    if (!file) return;
    const form = new FormData();
    form.append('file', file, file.name);
    const analysisMode = $('videoAnalysisMode')?.value || 'transcript';
    form.append('task_prompt', $('videoPrompt')?.value || '');
    form.append('analysis_mode', analysisMode);
    const overlay = $('procOverlay');
    const label = $('procLabel');
    const sub = $('procSub');
    if (overlay) overlay.style.display = 'flex';
    if (label) label.textContent = 'Analisando vídeo…';
    if (sub) sub.textContent = analysisMode === 'transcript' ? 'Extraindo apenas o áudio e analisando a transcrição.' : 'Extraindo áudio, quadros e tarefas realizadas.';
    try {
      const response = await fetchImpl(endpoint() + '/api/analyze-video', {
        method: 'POST',
        body: form,
        signal: signalTimeout(600000)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = typeof data.detail === 'object'
          ? (data.detail.message || data.detail.code)
          : data.detail;
        throw new Error(detail || ('Falha HTTP ' + response.status));
      }
      render(data);
      if (typeof ui.toast === 'function') ui.toast('Análise de vídeo concluída.', 'success');
    } catch (error) {
      if (typeof ui.toast === 'function') ui.toast('Falha na análise: ' + error.message, 'error');
      else windowRef.alert('Falha na análise: ' + error.message);
    } finally {
      if (overlay) overlay.style.display = 'none';
    }
  }

  function isVideo(file) {
    return !!file && (
      String(file.type || '').startsWith('video/') ||
      /\.(mp4|mov|webm|mkv|avi)$/i.test(file.name || '')
    );
  }

  function bind() {
    const input = $('videoInput');
    const button = $('btnVideoAnalyze');
    const drop = $('dropZone');

    // videoInput is activated by the native <label for="videoInput"> in index.html.
    // Do not synthesize input.click(): mobile browsers may reject it as a non-native picker activation.
    input?.addEventListener('change', () => {
      const file = input.files?.[0];
      if (isVideo(file)) analyze(file);
      input.value = '';
    });

    // Capture only video drops; ordinary document drops continue to the existing queue.
    drop?.addEventListener('drop', event => {
      const files = event.dataTransfer?.files;
      if (!Array.from(files || []).some(isVideo)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      analyze(Array.from(files).find(isVideo));
    }, true);

    $('btnYoutubeAnalyze')?.addEventListener('click', () => {
      const url = $('urlInput')?.value?.trim();
      if (!urlService.isYouTubeUrl(url)) {
        ui.toast('Informe uma URL do YouTube antes de analisar o processo.', 'warning');
        return;
      }
      analyzeYoutube(url);
    });

    $('videoReviewFilter')?.addEventListener('change', () => {
      if (lastAnalysis) render(lastAnalysis, { open: false });
    });
    $('btnValidateVideoAutomation')?.addEventListener('click', () => {
      if (!lastAnalysis) return;
      const platform = _currentAutomationPlatform(lastAnalysis);
      const validation = _validateAnalysis(lastAnalysis, platform);
      render(lastAnalysis, { open: false });
      const summary = validation.summary;
      const message =
        'Validação ' + platform + ': ' + summary.ready + ' prontas, ' +
        summary.warning + ' com alertas e ' + summary.blocked + ' bloqueadas.';
      if (typeof ui.toast === 'function') ui.toast(message, summary.blocked ? 'warning' : 'success');
    });
    $('btnFinalizeVideoReview')?.addEventListener('click', () => {
      const finalized = finalizeReview();
      if (typeof ui.toast === 'function') {
        ui.toast(
          finalized ? 'Revisão finalizada e bloqueada para novas alterações.' : 'Finalize a revisão somente após tratar todas as etapas pendentes.',
          finalized ? 'success' : 'warning'
        );
      }
    });
    $('btnApproveAllVideoSteps')?.addEventListener('click', () => {
      _approveAllVideoSteps();
      if (typeof ui.toast === 'function') ui.toast('Todas as etapas foram marcadas como aprovadas; alertas e bloqueios ainda impedem a geração automática.', 'info');
    });

    $('btnGenerateVideoAutomation')?.addEventListener('click', () => {
      renderAutomation($('videoAutomationTarget')?.value || 'pyautogui');
    });
    $('videoAutomationTarget')?.addEventListener('change', event => {
      if (lastAnalysis) render(lastAnalysis, { open: false });
    });
    $('btnCopyVideoAutomation')?.addEventListener('click', async () => {
      if (!lastAnalysis) return;
      const code = renderAutomation($('videoAutomationTarget')?.value || 'pyautogui');
      await windowRef.navigator?.clipboard.writeText(code);
      if (typeof ui.toast === 'function') ui.toast('Roteiro de automação copiado.', 'success');
    });
    $('btnDownloadVideoReviewPackage')?.addEventListener('click', async () => {
      if (!lastAnalysis) return;
      try {
        await exportReviewPackage(lastAnalysis, $('videoAutomationTarget')?.value || 'pyautogui');
      } catch (error) {
        if (typeof ui.toast === 'function') ui.toast('Não foi possível exportar o pacote de revisão: ' + error.message, 'error');
      }
    });

    $('btnDownloadVideoAutomation')?.addEventListener('click', () => {
      if (!lastAnalysis) return;
      const platform = $('videoAutomationTarget')?.value || 'pyautogui';
      const code = renderAutomation(platform);
      const blob = new windowRef.Blob([code], { type: 'text/plain;charset=utf-8' });
      const url = windowRef.URL.createObjectURL(blob);
      const a = documentRef.createElement('a');
      a.href = url;
      a.download = _automationFilename(platform, lastAnalysis);
      documentRef.body.appendChild(a);
      a.click();
      documentRef.body.removeChild(a);
      windowRef.URL.revokeObjectURL(url);
    });

    $('btnCloseVideoAnalysis')?.addEventListener('click', () => $('modalVideoAnalysis')?.close());
    $('btnCloseVideoAnalysis2')?.addEventListener('click', () => $('modalVideoAnalysis')?.close());
    $('btnCopyVideoJson')?.addEventListener('click', async () => {
      if (!lastAnalysis) return;
      await windowRef.navigator?.clipboard.writeText(JSON.stringify(_safeJsonData(lastAnalysis), null, 2));
      if (typeof ui.toast === 'function') ui.toast('JSON copiado.', 'success');
    });
    $('btnDownloadVideoReviewAudit')?.addEventListener('click', () => {
      if (!lastAnalysis) return;
      const platform = $('videoAutomationTarget')?.value || 'pyautogui';
      const manifest = reviewAuditManifest(lastAnalysis, platform);
      const blob = new windowRef.Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = windowRef.URL.createObjectURL(blob);
      const a = documentRef.createElement('a');
      a.href = url;
      const base = String(lastAnalysis.filename || 'video').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_') || 'video';
      a.download = base + '-auditoria-revisao.json';
      a.click();
      windowRef.URL.revokeObjectURL(url);
      if (typeof ui.toast === 'function') ui.toast('Auditoria da revisão exportada.', 'success');
    });

    $('btnDownloadVideoJson')?.addEventListener('click', () => {
      if (!lastAnalysis) return;
      const blob = new windowRef.Blob([JSON.stringify(_safeJsonData(lastAnalysis), null, 2)], { type: 'application/json;charset=utf-8' });
      const url = windowRef.URL.createObjectURL(blob);
      const a = documentRef.createElement('a');
      a.href = url;
      a.download = (lastAnalysis.filename || 'video').replace(/\.[^.]+$/, '') + '-analise.json';
      a.click();
      windowRef.URL.revokeObjectURL(url);
    });
  }

  function generateAutomation(data, platform = 'pyautogui') {
    if (data !== lastAnalysis) {
      lastAnalysis = data;
      originalAnalysisSnapshot = _snapshot(data);
      reviewHistory = [];
      reviewFinalizedAt = null;
      finalizedReviewSnapshot = null;
    }
    _ensureReviewState(data);
    return _generateAutomation(platform, data);
  }

  function getOriginalAnalysis() {
    return _snapshot(originalAnalysisSnapshot);
  }

  function getReviewHistory() {
    return _snapshot(reviewHistory);
  }

  function validateAnalysis(data, platform = _currentAutomationPlatform(data)) {
    if (data !== lastAnalysis) {
      lastAnalysis = data;
      originalAnalysisSnapshot = _snapshot(data);
      reviewHistory = [];
      reviewFinalizedAt = null;
      finalizedReviewSnapshot = null;
    }
    _ensureReviewState(data);
    return _validateAnalysis(data, platform);
  }

  function automationFilename(platform, data) {
    return _automationFilename(validator.normalizePlatform(platform), data);
  }

  return {
    bind, analyze, analyzeYoutube, render, renderAutomation,
    generateAutomation, validateAnalysis, automationFilename, reviewAuditManifest, finalizeReview, isVideo,
    normalizeEvidenceTimeline, exportReviewPackage, isReviewPackageReady, reviewPackageReadiness, reviewPackageManifest, verifyReviewPackageManifest, getOriginalAnalysis, getReviewHistory
  };
}

  return { create };
});
