(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarkAIDevTrailReplayValidator = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SENSITIVE = /^(authorization|cookie|set-cookie|password|senha|token|access_token|refresh_token)$/i;

  function safe(value) {
    return value == null ? '' : String(value);
  }

  function normalizeSelector(element) {
    const s = element?.seletores || {};
    if (s.id) return '#' + safe(s.id);
    if (s.testid) return '[data-testid="' + safe(s.testid) + '"]';
    if (s.cy) return '[data-cy="' + safe(s.cy) + '"]';
    if (s.name) return '[name="' + safe(s.name) + '"]';
    return safe(s.css || s.xpath);
  }

  function endpointPath(url) {
    try { return new URL(url, 'https://markai.invalid').pathname || '/'; }
    catch (_) { return safe(url); }
  }

  function comparableInput(value) {
    if (value == null) return null;
    if (typeof value === 'object') return '[OBJECT]';
    return safe(value);
  }

  function isSensitiveKey(key) {
    return SENSITIVE.test(safe(key).replace(/^x-/i, ''));
  }

  function sanitizeInput(value) {
    if (value && typeof value === 'object') {
      const out = {};
      Object.entries(value).forEach(([key, item]) => {
        out[key] = isSensitiveKey(key) ? '[REDACTED]' : sanitizeInput(item);
      });
      return out;
    }
    return value;
  }

  function networkCalls(step) {
    return Array.isArray(step?.chamadas_rede) ? step.chamadas_rede : [];
  }

  function sameNetwork(expected, observed) {
    return safe(expected?.metodo || expected?.method).toUpperCase() === safe(observed?.metodo || observed?.method).toUpperCase()
      && endpointPath(expected?.endpoint || expected?.url) === endpointPath(observed?.endpoint || observed?.url)
      && (expected?.status == null || Number(expected.status) === Number(observed?.status));
  }

  function validate(session, replayPlan) {
    const plan = replayPlan || {};
    const steps = Array.isArray(session?.steps) ? session.steps : [];
    const actions = Array.isArray(plan.actions) ? plan.actions : [];
    const results = [];
    const expectedCalls = [];
    const observedCalls = [];

    actions.forEach(action => {
      (action.network_assertions || []).forEach(assertion => expectedCalls.push(assertion));
    });
    steps.forEach(step => {
      networkCalls(step).forEach(call => observedCalls.push({
        method: call.metodo || call.method,
        endpoint: endpointPath(call.url || call.endpoint),
        status: call.status,
        step_id: step.step_id
      }));
    });

    actions.forEach((action, index) => {
      const step = steps[index];
      if (!step) {
        results.push({ order: action.order ?? index + 1, step_id: null, verdict: 'nao_observado', reasons: ['Etapa esperada não foi observada.'], expected: action, observed: null });
        return;
      }

      const reasons = [];
      const observedSelector = normalizeSelector(step.elemento);
      if (action.target && observedSelector && action.target !== observedSelector) reasons.push('Seletor divergente.');
      if (action.target && !observedSelector) reasons.push('Seletor esperado não foi observado.');

      if (action.action && safe(action.action) !== safe(step.tipo_evento)) reasons.push('Tipo de evento divergente.');

      if (action.input != null && comparableInput(action.input) !== comparableInput(step.valor_entrada)) {
        const expectedRedacted = safe(action.input).includes('[REDACTED]') || safe(step.valor_entrada).includes('[REDACTED]');
        if (!expectedRedacted) reasons.push('Entrada divergente.');
      }

      const calls = networkCalls(step);
      (action.network_assertions || []).forEach(expected => {
        if (!calls.some(observed => sameNetwork(expected, observed))) {
          reasons.push('Chamada de rede esperada não observada: ' + safe(expected.method || expected.metodo) + ' ' + endpointPath(expected.endpoint || expected.url));
        }
      });

      const observedEndpointKeys = new Set(calls.map(call => safe(call.metodo || call.method).toUpperCase() + ' ' + endpointPath(call.url || call.endpoint)));
      const expectedEndpointKeys = new Set((action.network_assertions || []).map(call => safe(call.method || call.metodo).toUpperCase() + ' ' + endpointPath(call.endpoint || call.url)));
      const unexpected = [...observedEndpointKeys].filter(key => !expectedEndpointKeys.has(key));
      if (unexpected.length) reasons.push('Chamadas adicionais observadas: ' + unexpected.join(', '));

      const verdict = reasons.length ? 'divergente' : 'conforme';
      results.push({
        order: action.order ?? index + 1,
        step_id: step.step_id ?? index + 1,
        verdict,
        reasons,
        expected: { action: action.action || null, target: action.target || null, input: sanitizeInput(action.input), network_assertions: action.network_assertions || [] },
        observed: { event: step.tipo_evento || null, target: observedSelector || null, input: sanitizeInput(step.valor_entrada), network_calls: calls }
      });
    });

    const matchedExpected = new Set();
    results.forEach(result => (result.expected.network_assertions || []).forEach(expected => {
      const key = safe(expected.method || expected.metodo).toUpperCase() + ' ' + endpointPath(expected.endpoint || expected.url);
      matchedExpected.add(key);
    }));
    const unexpectedGlobal = observedCalls.filter(call => !matchedExpected.has(safe(call.method).toUpperCase() + ' ' + call.endpoint));

    const divergent = results.filter(item => item.verdict === 'divergente').length;
    const notObserved = results.filter(item => item.verdict === 'nao_observado').length;
    const status = notObserved ? 'nao_observado' : divergent ? 'divergente' : 'conforme';

    return {
      schema_version: '1.0',
      validation_type: 'devtrail-replay-validation',
      source_session_id: session?.metadata?.session_id || null,
      source_plan_session_id: plan.source_session_id || null,
      status,
      metrics: {
        expected_steps: actions.length,
        observed_steps: steps.length,
        conforme_steps: results.filter(item => item.verdict === 'conforme').length,
        divergent_steps: divergent,
        not_observed_steps: notObserved,
        expected_network_assertions: expectedCalls.length,
        observed_network_calls: observedCalls.length,
        unexpected_network_calls: unexpectedGlobal.length
      },
      steps: results,
      unexpected_network_calls: unexpectedGlobal,
      security: { credentials_stored: false, sensitive_values_compared: false }
    };
  }

  function convertToMarkdown(report) {
    const lines = ['## Validação de reprodução DevTrail', '', '**Status:** ' + safe(report?.status || 'nao_observado'), ''];
    const m = report?.metrics || {};
    lines.push('### 1. Resumo');
    lines.push('- Etapas esperadas: ' + (m.expected_steps ?? 0));
    lines.push('- Etapas observadas: ' + (m.observed_steps ?? 0));
    lines.push('- Conformes: ' + (m.conforme_steps ?? 0));
    lines.push('- Divergentes: ' + (m.divergent_steps ?? 0));
    lines.push('- Não observadas: ' + (m.not_observed_steps ?? 0));
    lines.push('');
    lines.push('### 2. Validação por etapa');
    (report?.steps || []).forEach(item => {
      lines.push('');
      lines.push('#### Etapa ' + item.order + ' — **' + item.verdict + '**');
      (item.reasons || []).forEach(reason => lines.push('- ' + reason));
      if (!item.reasons?.length) lines.push('- Sem divergências observadas.');
    });
    lines.push('');
    lines.push('### 3. Comunicações inesperadas');
    if (report?.unexpected_network_calls?.length) report.unexpected_network_calls.forEach(call => lines.push('- ' + safe(call.method).toUpperCase() + ' ' + safe(call.endpoint) + (call.status != null ? ' (' + call.status + ')' : '')));
    else lines.push('- Nenhuma.');
    lines.push('');
    lines.push('### 4. Segurança');
    lines.push('- Credenciais não armazenadas.');
    lines.push('- Valores sensíveis não são comparados como conteúdo.');
    return lines.join('\n');
  }

  return { validate, convertToMarkdown };
});
