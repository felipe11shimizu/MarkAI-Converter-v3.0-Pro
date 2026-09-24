(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarkAIDevTrailReplayPlan = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function safe(value) { return value == null ? '' : String(value); }
  function build(session, analysis, readiness) {
    const data = typeof session === 'string' ? JSON.parse(session) : (session || {});
    const flow = Array.isArray(analysis?.execution_flow) ? analysis.execution_flow : [];
    const actions = flow.map(item => ({
      order: item.order, action: safe(item.event), target: safe(item.selector), input: item.input || null,
      wait_before_ms: item.order === 1 ? 0 : (flow[item.order - 2]?.wait_until_next_step_ms ?? 0),
      wait_after_ms: item.wait_until_next_step_ms ?? 0, expected_outcome: safe(item.outcome),
      network_assertions: (item.network_calls || []).map(call => ({ method: safe(call.method || 'GET').toUpperCase(), endpoint: safe(call.endpoint), status: call.status ?? null }))
    }));
    return {
      schema_version: '1.0', plan_type: 'devtrail-replay-plan',
      source_session_id: safe(data.metadata?.session_id), source_url: safe(data.metadata?.url_alvo || data.url_alvo),
      readiness: safe(readiness?.readiness || 'não avaliado'),
      execution_policy: { mode: 'manual_or_external_rpa', stop_on_unexpected_result: true, stop_on_selector_missing: true, capture_new_evidence: true, never_store_credentials: true },
      actions
    };
  }
  function convertToMarkdown(plan) {
    const p = plan || build({});
    const lines = ['## Plano de reprodução DevTrail', '', '**Status de prontidão:** ' + safe(p.readiness), '**Modo:** ' + safe(p.execution_policy?.mode), '', '### Política de execução', '- Interromper diante de resultado inesperado.', '- Interromper se o seletor não for encontrado.', '- Capturar nova evidência durante a reprodução.', '- Nunca armazenar credenciais.', '', '### Passos'];
    (p.actions || []).forEach(a => {
      lines.push(a.order + '. **' + safe(a.action) + '** — "' + safe(a.target) + '"' + (a.input ? ' → entrada: "' + safe(a.input) + '"' : '') + ' — espera antes: ' + a.wait_before_ms + ' ms; depois: ' + a.wait_after_ms + ' ms.');
      if (a.network_assertions.length) a.network_assertions.forEach(n => lines.push('   - validar **' + n.method + ' ' + n.endpoint + '** → HTTP ' + (n.status ?? '?')));
      else lines.push('   - validar estado da interface após a ação.');
    });
    if (!(p.actions || []).length) lines.push('- Nenhum passo disponível.');
    return lines.join('\n');
  }
  return { build, convertToMarkdown };
});
