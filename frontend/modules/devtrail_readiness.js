(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarkAIDevTrailReadiness = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function safe(value) { return value == null ? '' : String(value); }

  function generate(session, analysis, quality, specification) {
    const data = typeof session === 'string' ? JSON.parse(session) : (session || {});
    const a = analysis || {};
    const q = quality || {};
    const spec = specification || {};
    const flow = Array.isArray(a.execution_flow) ? a.execution_flow : [];
    const confirmations = Array.isArray(spec.confirmations) ? spec.confirmations : [];
    const gaps = Array.isArray(q.gaps) ? q.gaps : [];
    const blockingGaps = gaps.filter(g => /^GSEC/.test(g.id) || g.id === 'G01');
    const selectorGaps = gaps.filter(g => g.id === 'G02');
    const readiness = q.status === 'adequado' && blockingGaps.length === 0 && confirmations.length === 0
      ? 'pronto_para_automacao'
      : blockingGaps.length ? 'bloqueado' : 'requer_validacao';

    const preconditions = [
      'A página/serviço alvo deve estar acessível.',
      'Os seletores registrados devem continuar válidos no ambiente de execução.',
      'Credenciais e dados sensíveis devem ser fornecidos pelo mecanismo seguro do executor, nunca pelo playbook.'
    ];
    if (selectorGaps.length) preconditions.push('Revisar etapas sem seletor estável antes da execução.');

    const actions = flow.map(item => ({
      order: item.order,
      action: item.event,
      target: item.selector,
      input: item.input || null,
      wait_after_ms: item.wait_until_next_step_ms,
      expected: item.outcome === 'sucesso_rede'
        ? 'Observar chamada ' + item.network_calls.map(c => c.method + ' ' + c.endpoint).join(', ') + ' com resultado HTTP bem-sucedido.'
        : item.outcome === 'sem_rede_associada'
          ? 'Validar alteração de estado/interface observada.'
          : 'Reproduzir a etapa e validar o resultado observado antes de prosseguir.'
    }));

    const validations = flow.map(item => ({
      order: item.order,
      check: item.network_calls.length
        ? item.network_calls.map(c => c.method + ' ' + c.endpoint + ' → ' + (c.status ?? 'status não observado')).join('; ')
        : 'Validar estado da interface após a ação.'
    }));

    return {
      schema_version: '1.0',
      readiness,
      objective: safe(spec.objective || data.objetivo || 'Reproduzir o fluxo observado.'),
      preconditions,
      actions,
      validations,
      failure_handling: [
        'Interromper a execução quando um seletor não for encontrado.',
        'Interromper quando a resposta HTTP observada divergir do contrato esperado.',
        'Registrar evidência do erro e preservar a etapa que falhou.',
        'Não registrar ou expor credenciais, cookies, tokens ou senhas.'
      ],
      confirmations,
      evidence: {
        steps: a.metrics?.steps || 0,
        selector_coverage: q.metrics?.selector_coverage ?? 0,
        network_correlation_coverage: q.metrics?.network_correlation_coverage ?? 0,
        outcome_coverage: q.metrics?.outcome_coverage ?? 0,
        quality_status: q.status || 'não avaliado',
        gaps: gaps.length
      }
    };
  }

  function convertToMarkdown(packageData) {
    const p = packageData || generate({});
    const lines = [
      '## Prontidão para automação/RPA', '',
      '**Status:** ' + safe(p.readiness), '',
      '### 1. Pré-condições', ''
    ];
    (p.preconditions || []).forEach(item => lines.push('- ' + item));
    lines.push('', '### 2. Sequência executável', '',
      '| Ordem | Ação | Alvo | Entrada | Espera (ms) |',
      '|---:|---|---|---|---:|');
    (p.actions || []).forEach(item => lines.push('| ' + item.order + ' | ' + safe(item.action) + ' | ' + safe(item.target).replace(/|/g, '\|') + ' | ' + safe(item.input || '—').replace(/|/g, '\|') + ' | ' + (item.wait_after_ms ?? '—') + ' |'));
    if (!(p.actions || []).length) lines.push('| — | Nenhuma ação disponível | — | — | — |');
    lines.push('', '### 3. Validações', '');
    (p.validations || []).forEach(item => lines.push('- **Passo ' + item.order + '** — ' + item.check));
    lines.push('', '### 4. Tratamento de falhas', '');
    (p.failure_handling || []).forEach(item => lines.push('- ' + item));
    lines.push('', '### 5. Pontos a confirmar', '');
    if (p.confirmations?.length) p.confirmations.forEach(item => lines.push('- **' + item.id + '** — ' + item.statement));
    else lines.push('- Nenhum ponto adicional identificado.');
    lines.push('', '### 6. Evidência utilizada', '',
      '- Etapas: ' + (p.evidence?.steps || 0),
      '- Cobertura de seletores: ' + (p.evidence?.selector_coverage ?? 0),
      '- Correlação de rede: ' + (p.evidence?.network_correlation_coverage ?? 0),
      '- Cobertura de resultados: ' + (p.evidence?.outcome_coverage ?? 0),
      '- Status da qualidade: ' + safe(p.evidence?.quality_status || 'não avaliado'),
      '- Lacunas: ' + (p.evidence?.gaps || 0));
    return lines.join('\n');
  }

  return { generate, convertToMarkdown };
});