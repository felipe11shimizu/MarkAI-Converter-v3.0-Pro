(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarkAIDevTrailAnalyzer = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function safe(value) { return value == null ? '' : String(value); }
  function path(url) { try { return new URL(url).pathname || '/'; } catch (_) { return safe(url); } }
  function unique(values) { return [...new Set(values.filter(Boolean))]; }

  function eventTime(step) { return Number(step?.timestamp_relativo_ms) || 0; }
  function networkForStep(step) { return Array.isArray(step?.chamadas_rede) ? step.chamadas_rede : []; }
  function outcomeFor(step) {
    const calls = networkForStep(step);
    const statuses = calls.map(call => Number(call.status)).filter(Number.isFinite);
    if (statuses.some(status => status >= 500)) return 'erro_servidor';
    if (statuses.some(status => status >= 400)) return 'erro_cliente';
    if (statuses.some(status => status >= 200 && status < 400)) return 'sucesso_rede';
    return calls.length ? 'rede_sem_status' : 'sem_rede_associada';
  }

  function analyze(data) {
    const session = typeof data === 'string' ? JSON.parse(data) : (data || {});
    const steps = Array.isArray(session.steps) ? session.steps : [];
    const calls = steps.flatMap(s => Array.isArray(s.chamadas_rede) ? s.chamadas_rede : []);
    const diagnostics = Array.isArray(session.diagnostics) ? session.diagnostics : [];
    const elements = steps.map(s => s.elemento || {});
    const endpoints = unique(calls.map(c => (c.metodo || 'GET') + ' ' + path(c.url)));
    const selectors = unique(elements.flatMap(e => {
      const s = e.seletores || {};
      return [s.testid && 'data-testid=' + s.testid, s.cy && 'data-cy=' + s.cy, s.id && '#' + s.id, s.name && '[name="' + s.name + '"]', s.css, s.xpath];
    }));
    const observed = [];
    steps.forEach((step, i) => observed.push({
      id: 'OBS' + String(i + 1).padStart(2, '0'),
      type: 'observed',
      statement: 'O usuário executou ' + safe(step.tipo_evento) + ' no passo ' + (step.step_id ?? i + 1) + '.'
    }));
    const derived = [];
    if (calls.length) derived.push({ id: 'DER01', type: 'derived', statement: 'O fluxo depende de comunicação de rede associada a ações do usuário.' });
    if (endpoints.length) derived.push({ id: 'DER02', type: 'derived', statement: 'Foram observados ' + endpoints.length + ' padrão(ões) de endpoint HTTP distintos.' });
    if (selectors.length) derived.push({ id: 'DER03', type: 'derived', statement: 'Existem seletores suficientes para orientar uma automação baseada em DOM.' });
    const confirm = [];
    if (steps.some(s => s.tipo_evento === 'click') && !calls.length) confirm.push({ id: 'CONF01', type: 'confirm', statement: 'Confirmar se os cliques acionam chamadas de backend não capturadas ou lógica local.' });
    if (diagnostics.length) confirm.push({ id: 'CONF02', type: 'confirm', statement: 'Validar os diagnósticos registrados e seu impacto no fluxo antes de automatizar.' });
    if (!steps.length) confirm.push({ id: 'CONF03', type: 'confirm', statement: 'Executar nova sessão com interação efetiva para produzir evidência suficiente.' });
    const executionFlow = steps.map((step, index) => {
      const next = steps[index + 1];
      const calls = networkForStep(step);
      const s = step.elemento?.seletores || {};
      const selector = s.id ? '#' + s.id : s.testid ? '[data-testid="' + s.testid + '"]' : s.cy ? '[data-cy="' + s.cy + '"]' : s.name ? '[name="' + s.name + '"]' : s.css || s.xpath || 'seletor não identificado';
      return {
        order: index + 1,
        step_id: step.step_id ?? index + 1,
        timestamp_relativo_ms: eventTime(step),
        event: safe(step.tipo_evento),
        label: safe(step.elemento?.texto_visivel || step.elemento?.tag || 'elemento'),
        selector,
        input: safe(step.valor_entrada),
        network_calls: calls.map(call => ({ method: safe(call.metodo || 'GET').toUpperCase(), endpoint: path(call.url), status: call.status ?? null, response_time_ms: call.tempo_resposta_ms ?? null })),
        outcome: outcomeFor(step),
        wait_until_next_step_ms: next ? Math.max(0, eventTime(next) - eventTime(step)) : null
      };
    });
    const replay = executionFlow.map(item => ({
      order: item.order,
      action: item.event,
      target: item.selector,
      expected: item.network_calls.length ? item.network_calls.map(call => call.method + ' ' + call.endpoint + ' [' + (call.status ?? '?') + ']').join('; ') : 'validar alteração visual/estado da tela',
      wait_after_ms: item.wait_until_next_step_ms
    }));

    const requirements = steps.map((step, i) => {
      const e = step.elemento || {}, s = e.seletores || {};
      const selector = s.testid || s.cy || s.id || s.name || s.css || s.xpath || 'seletor não identificado';
      return { id: 'RF' + String(i + 1).padStart(2, '0'), action: safe(step.tipo_evento), selector, label: safe(e.texto_visivel || e.tag || 'elemento') };
    });
    return {
      schema_version: '1.0',
      classification: { observed, derived, to_confirm: confirm },
      metrics: { steps: steps.length, network_calls: calls.length, diagnostics: diagnostics.length, endpoints: endpoints.length, selectors: selectors.length },
      endpoints,
      selectors,
      requirements,
      execution_flow: executionFlow,
      replay_playbook: replay
    };
  }

  function convertToMarkdown(analysis) {
    const a = analysis || analyze({});
    const lines = [
      '## Inteligência do processo', '',
      '> As conclusões abaixo separam fatos capturados, derivações técnicas e pontos que ainda precisam de confirmação.', '',
      '### Observado', ''
    ];
    (a.classification?.observed || []).forEach(x => lines.push('- **' + x.id + '** — ' + x.statement));
    if (!(a.classification?.observed || []).length) lines.push('- Nenhum evento observado.');
    lines.push('', '### Derivado', '');
    (a.classification?.derived || []).forEach(x => lines.push('- **' + x.id + '** — ' + x.statement));
    if (!(a.classification?.derived || []).length) lines.push('- Nenhuma conclusão técnica derivada automaticamente.');
    lines.push('', '### A confirmar', '');
    (a.classification?.to_confirm || []).forEach(x => lines.push('- **' + x.id + '** — ' + x.statement));
    if (!(a.classification?.to_confirm || []).length) lines.push('- Nenhum ponto adicional marcado para confirmação.');
    lines.push('', '### Especificação de automação', '', '| ID | Ação | Elemento | Seletor |', '|---|---|---|---|');
    (a.requirements || []).forEach(r => lines.push('| ' + r.id + ' | ' + r.action + ' | ' + r.label.replace(/\|/g, '\\|') + ' | ' + r.selector.replace(/\|/g, '\\|') + ' |'));
    if (!(a.requirements || []).length) lines.push('| — | — | Nenhuma etapa capturada | — |');
    lines.push('', '### Inventário técnico', '',
      '- **Passos:** ' + (a.metrics?.steps || 0),
      '- **Chamadas de rede:** ' + (a.metrics?.network_calls || 0),
      '- **Endpoints:** ' + (a.metrics?.endpoints || 0),
      '- **Seletores:** ' + (a.metrics?.selectors || 0),
      '- **Diagnósticos:** ' + (a.metrics?.diagnostics || 0), '');
    return lines.join('\n');
  }

  return { analyze, convertToMarkdown };
});