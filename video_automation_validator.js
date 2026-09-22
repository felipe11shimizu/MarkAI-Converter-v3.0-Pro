(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MarkAIAutomationValidator = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CONFIDENCE_THRESHOLD = 0.75;

  const SUPPORTED_ACTIONS = new Set([
    'click', 'double_click', 'type', 'select', 'hotkey', 'keypress',
    'scroll', 'drag', 'wait', 'open', 'navigate', 'download',
    'upload', 'copy', 'paste', 'check', 'submit', 'other'
  ]);

  const TARGET_ACTIONS = new Set([
    'click', 'double_click', 'type', 'select', 'drag',
    'download', 'upload', 'copy', 'paste', 'check', 'submit'
  ]);

  const PLATFORM_ACTIONS = {
    pyautogui: new Set(['click', 'double_click', 'type', 'select', 'hotkey', 'keypress', 'scroll', 'wait']),
    playwright: new Set(['click', 'double_click', 'type', 'select', 'hotkey', 'keypress', 'scroll', 'upload', 'open', 'navigate', 'check', 'submit']),
    selenium: new Set(['click', 'double_click', 'type', 'select', 'hotkey', 'keypress', 'scroll', 'upload', 'open', 'navigate', 'submit']),
    rpa: new Set(['click', 'double_click', 'type', 'select', 'hotkey', 'keypress', 'scroll', 'wait']),
  };

  function text(value) {
    return String(value ?? '').trim();
  }

  function hasText(value) {
    return text(value).length > 0;
  }

  function finiteNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function clamp01(value, fallback = 0.5) {
    const n = finiteNumber(value);
    if (n === null) return fallback;
    return Math.max(0, Math.min(1, n));
  }

  function normalizePlatform(platform) {
    const value = text(platform).toLowerCase();
    return value === 'rpa_desktop' ? 'rpa' : value || 'pyautogui';
  }

  function getTarget(step) {
    const target = step && typeof step.alvo === 'object' && step.alvo ? step.alvo : {};
    const selectors = Array.isArray(target.seletores)
      ? target.seletores.map(text).filter(Boolean)
      : [];
    const x = finiteNumber(target.x);
    const y = finiteNumber(target.y);
    const normalizedX = finiteNumber(target.x_normalizado);
    const normalizedY = finiteNumber(target.y_normalizado);
    return {
      selector: selectors[0] || '',
      selectors,
      text: text(target.texto),
      description: text(target.descricao),
      control: text(target.controle),
      shortcut: text(target.atalho),
      x,
      y,
      normalizedX,
      normalizedY
    };
  }

  function hasPoint(target) {
    return target.x !== null && target.y !== null;
  }

  function hasTargetText(target) {
    return target.selector || target.text || target.description || target.control || hasPoint(target);
  }

  function pushIssue(issues, severity, code, message, suggestion) {
    issues.push({ severity, code, message, suggestion: suggestion || '' });
  }

  function actionSupportIssue(step, platform, issues) {
    const action = text(step?.tipo_acao) || 'other';
    const supported = PLATFORM_ACTIONS[platform] || PLATFORM_ACTIONS.pyautogui;
    if (!SUPPORTED_ACTIONS.has(action)) {
      pushIssue(
        issues,
        'error',
        'ACTION_UNSUPPORTED',
        'Ação não reconhecida pelo validador.',
        'Selecione uma ação compatível com a lista suportada.'
      );
      return;
    }
    if (action === 'other') {
      pushIssue(
        issues,
        'error',
        'ACTION_GENERIC',
        'Ação genérica não pode ser considerada pronta para geração.',
        'Classifique a etapa como uma ação específica antes de gerar o código.'
      );
      return;
    }
    if (!supported.has(action)) {
      pushIssue(
        issues,
        'error',
        'ACTION_PLATFORM_UNSUPPORTED',
        'A ação ' + action + ' não possui implementação segura na plataforma ' + platform + '.',
        'Troque a plataforma ou ajuste a etapa para uma ação implementada.'
      );
    }
  }

  function targetIssues(step, platform, issues) {
    const action = text(step?.tipo_acao) || 'other';
    const target = getTarget(step);

    if (platform === 'pyautogui' && ['click', 'double_click', 'type', 'select'].includes(action) && !hasPoint(target)) {
      pushIssue(
        issues,
        'error',
        'COORDINATE_MISSING',
        'A ação PyAutoGUI não possui coordenadas confirmadas para o elemento alvo.',
        'Informe X/Y observáveis no vídeo ou revise a etapa para uma estratégia de foco previamente validada.'
      );
    }

    if (TARGET_ACTIONS.has(action) && !hasTargetText(target)) {
      pushIssue(
        issues,
        'error',
        'TARGET_MISSING',
        'Ação de automação sem alvo, seletor, texto ou coordenada.',
        'Informe um seletor, texto visível, controle ou coordenadas observáveis.'
      );
      return;
    }

    if ((action === 'open' || action === 'navigate') && !hasTargetText(target)) {
      pushIssue(
        issues,
        'error',
        'NAV_TARGET_MISSING',
        'Abertura/navegação sem aplicação, URL ou destino identificável.',
        'Informe o URL, aplicação ou destino observado.'
      );
      return;
    }

    if ((action === 'hotkey' || action === 'keypress') && !target.shortcut && !target.text) {
      pushIssue(
        issues,
        'warning',
        'KEY_TARGET_MISSING',
        'Atalho/tecla não foi identificado de forma explícita.',
        'Confirme o atalho ou a tecla observada antes da execução.'
      );
    }

    if (platform === 'playwright' || platform === 'selenium') {
      if ((TARGET_ACTIONS.has(action) || action === 'open' || action === 'navigate') && !target.selector && !target.text) {
        pushIssue(
          issues,
          'error',
          'LOCATOR_MISSING',
          'A ação web não possui um locator ou texto utilizável pelo gerador.',
          'Informe um seletor verificável ou um texto visível utilizável como locator.'
        );
      }
      if (action === 'type' || action === 'select' || action === 'upload') {
        if (!target.selector) {
          pushIssue(
            issues,
            'error',
            'LOCATOR_MISSING',
            'A ação requer um locator confiável para a plataforma web.',
            'Informe um seletor verificável do campo ou elemento.'
          );
        }
      }
    }
  }

  function dataIssues(step, issues) {
    const action = text(step?.tipo_acao) || 'other';
    const data = step && typeof step.dados === 'object' && step.dados ? step.dados : {};
    const value = text(data.valor);
    const field = text(data.campo);
    const sensitive = Boolean(data.sensivel);

    if (action === 'type' || action === 'select') {
      if (!field && !value) {
        pushIssue(
          issues,
          'warning',
          'INPUT_VALUE_MISSING',
          'A ação de entrada não possui campo ou valor identificado.',
          'Confirme o campo e use um placeholder seguro quando o valor for dinâmico.'
        );
      }
    }

    if (sensitive) {
      pushIssue(
        issues,
        'warning',
        'SENSITIVE_DATA',
        'A etapa contém ou foi marcada como dado sensível.',
        'Não exporte credenciais ou segredos. Use {{DADO_SENSIVEL}} e valide manualmente.'
      );
    }
  }

  function conditionIssues(step, issues) {
    if (!hasText(step?.precondicao)) {
      pushIssue(
        issues,
        'warning',
        'PRECONDITION_MISSING',
        'Pré-condição não foi registrada.',
        'Descreva o estado que deve existir antes da etapa.'
      );
    }
    if (!hasText(step?.poscondicao)) {
      pushIssue(
        issues,
        'warning',
        'POSTCONDITION_MISSING',
        'Pós-condição não foi registrada.',
        'Descreva como confirmar que a etapa terminou corretamente.'
      );
    }
  }

  function evidenceIssues(step, context, issues) {
    const evidence = step && typeof step.evidencia === 'object' && step.evidencia ? step.evidencia : {};
    const hasFrame = Array.isArray(evidence.frame_indices) && evidence.frame_indices.length > 0;
    const hasTranscript = Array.isArray(evidence.transcript_segment_indices) && evidence.transcript_segment_indices.length > 0;
    const transcriptAvailable = context && context.transcriptAvailable !== false;

    if (!hasFrame && !hasTranscript) {
      pushIssue(
        issues,
        'warning',
        'EVIDENCE_MISSING',
        'A etapa não possui frame nem segmento de transcrição associado.',
        'Confirme manualmente a etapa e vincule uma evidência observável.'
      );
    } else if (transcriptAvailable && !hasTranscript) {
      pushIssue(
        issues,
        'warning',
        'SPEECH_EVIDENCE_MISSING',
        'Há transcrição disponível, mas esta etapa não está correlacionada com uma fala.',
        'Revise a linha do tempo e confirme se existe fala relacionada.'
      );
    }
  }

  function confidenceIssues(step, issues) {
    const raw = step?.confianca;
    const n = finiteNumber(raw);
    if (n === null) {
      pushIssue(
        issues,
        'warning',
        'CONFIDENCE_MISSING',
        'Confiança da análise não foi informada.',
        'Confirme a etapa antes de considerá-la automatizável.'
      );
      return;
    }
    if (n < 0 || n > 1) {
      pushIssue(
        issues,
        'error',
        'CONFIDENCE_INVALID',
        'Confiança deve estar entre 0 e 1.',
        'Corrija a confiança informada para um valor entre 0 e 1.'
      );
      return;
    }
    if (n < CONFIDENCE_THRESHOLD) {
      pushIssue(
        issues,
        'warning',
        'CONFIDENCE_LOW',
        'Confiança abaixo do limiar operacional de ' + Math.round(CONFIDENCE_THRESHOLD * 100) + '%.',
        'Revise a etapa e confirme alvo, ação e evidências.'
      );
    }
  }

  function waitIssues(step, issues) {
    const action = text(step?.tipo_acao) || 'other';
    if (action !== 'wait') return;
    const seconds = finiteNumber(step?.espera_segundos);
    if (seconds === null || seconds <= 0) {
      pushIssue(
        issues,
        'warning',
        'WAIT_DURATION_MISSING',
        'A espera não possui duração positiva explícita.',
        'Informe o tempo observado ou confirme um wait adequado.'
      );
    }
  }

  function targetQuality(target) {
    if (target.selector) return 1;
    if (hasPoint(target)) return 0.8;
    if (target.text) return 0.7;
    if (target.control) return 0.65;
    if (target.description) return 0.5;
    return 0;
  }

  function evidenceQuality(step, context) {
    const evidence = step && typeof step.evidencia === 'object' && step.evidencia ? step.evidencia : {};
    const hasFrame = Array.isArray(evidence.frame_indices) && evidence.frame_indices.length > 0;
    const hasTranscript = Array.isArray(evidence.transcript_segment_indices) && evidence.transcript_segment_indices.length > 0;
    if (!hasFrame && !hasTranscript) return 0;
    if (hasFrame && hasTranscript) return 1;
    if (hasFrame) return 0.75;
    return context && context.transcriptAvailable === false ? 0.75 : 0.6;
  }

  function operationalConfidence(step, context) {
    const model = clamp01(step?.confianca, 0.5);
    const target = targetQuality(getTarget(step));
    const evidence = evidenceQuality(step, context);
    const conditions = (hasText(step?.precondicao) ? 0.5 : 0) + (hasText(step?.poscondicao) ? 0.5 : 0);
    const score = (model * 0.45) + (target * 0.20) + (evidence * 0.25) + (conditions * 0.10);
    return Math.round(Math.max(0, Math.min(1, score)) * 100) / 100;
  }

  function validateStep(step, platform, context = {}) {
    const normalizedPlatform = normalizePlatform(platform);
    const safeStep = step && typeof step === 'object' ? step : {};
    const issues = [];

    actionSupportIssue(safeStep, normalizedPlatform, issues);
    targetIssues(safeStep, normalizedPlatform, issues);
    dataIssues(safeStep, issues);
    conditionIssues(safeStep, issues);
    evidenceIssues(safeStep, context, issues);
    confidenceIssues(safeStep, issues);
    waitIssues(safeStep, issues);

    const hasErrors = issues.some(issue => issue.severity === 'error');
    const hasWarnings = issues.some(issue => issue.severity === 'warning');
    const status = hasErrors ? 'blocked' : (hasWarnings ? 'warning' : 'ready');

    return {
      status,
      ready: status === 'ready',
      blocked: status === 'blocked',
      requiresOverride: status === 'warning',
      platform: normalizedPlatform,
      issues,
      score: operationalConfidence(safeStep, context)
    };
  }

  function validateAnalysis(analysis, platform, context = {}) {
    const steps = Array.isArray(analysis?.etapas) ? analysis.etapas : [];
    const details = steps.map(step => validateStep(step, platform, context));
    const summary = details.reduce((acc, result) => {
      acc[result.status] += 1;
      acc.total += 1;
      return acc;
    }, { ready: 0, warning: 0, blocked: 0, total: 0 });
    return { steps: details, summary };
  }

  return {
    CONFIDENCE_THRESHOLD,
    SUPPORTED_ACTIONS: Array.from(SUPPORTED_ACTIONS),
    normalizePlatform,
    validateStep,
    validateAnalysis
  };
});
