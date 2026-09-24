(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarkAIDevTrailAudit = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function safe(value) {
    return value == null ? '' : String(value);
  }

  function build(session, analysis, quality, readiness, replayPlan, validation) {
    const metadata = session?.metadata || {};
    const metrics = validation?.metrics || {};
    const qualityMetrics = quality?.metrics || {};
    const actions = Array.isArray(replayPlan?.actions) ? replayPlan.actions : [];
    const validationSteps = Array.isArray(validation?.steps) ? validation.steps : [];
    const confirmations = [
      ...(Array.isArray(readiness?.confirmations) ? readiness.confirmations : []),
      ...(Array.isArray(readiness?.preconditions) ? readiness.preconditions.filter(item => item?.status === 'a_confirmar') : [])
    ];

    const traceability = actions.map((action, index) => {
      const result = validationSteps[index];
      return {
        order: action.order ?? index + 1,
        step_id: result?.step_id ?? null,
        action: action.action || null,
        target: action.target || null,
        expected: action.expected_outcome || null,
        replay_verdict: result?.verdict || 'nao_observado',
        reasons: result?.reasons || []
      };
    });

    const gaps = [];
    if ((metrics.not_observed_steps || 0) > 0) gaps.push('Há etapas do plano de reprodução não observadas.');
    if ((metrics.divergent_steps || 0) > 0) gaps.push('Há etapas com divergências entre o plano e a sessão observada.');
    if ((metrics.unexpected_network_calls || 0) > 0) gaps.push('Há chamadas de rede adicionais em relação às asserções do plano.');
    if (confirmations.length) gaps.push('Existem pontos que permanecem dependentes de confirmação.');
    if (quality?.status === 'bloqueado') gaps.push('A qualidade da evidência está bloqueada.');

    return {
      schema_version: '1.0',
      audit_type: 'devtrail-audit-traceability',
      generated_at: new Date().toISOString(),
      session: {
        session_id: metadata.session_id || null,
        url: metadata.url_alvo || null,
        started_at: metadata.timestamp_inicio || null,
        duration_ms: metadata.duracao_total_ms ?? null
      },
      source_chain: {
        analysis_available: !!analysis,
        quality_available: !!quality,
        readiness: readiness?.readiness || null,
        replay_plan_available: !!replayPlan,
        replay_validation_available: !!validation
      },
      evidence: {
        steps: analysis?.metrics?.steps ?? session?.steps?.length ?? 0,
        selectors_coverage: qualityMetrics.selector_coverage ?? analysis?.metrics?.selector_coverage ?? null,
        network_correlation_coverage: qualityMetrics.network_correlation_coverage ?? null,
        outcome_coverage: qualityMetrics.outcome_coverage ?? null
      },
      replay: {
        expected_steps: metrics.expected_steps ?? actions.length,
        observed_steps: metrics.observed_steps ?? 0,
        conforme_steps: metrics.conforme_steps ?? 0,
        divergent_steps: metrics.divergent_steps ?? 0,
        not_observed_steps: metrics.not_observed_steps ?? 0,
        unexpected_network_calls: metrics.unexpected_network_calls ?? 0,
        status: validation?.status || 'nao_observado'
      },
      traceability,
      open_points: gaps.concat(confirmations.map(item => safe(item))),
      security: {
        credentials_stored: false,
        sensitive_values_compared: false,
        policy: 'Não armazenar credenciais, tokens, cookies ou senhas.'
      }
    };
  }

  function convertToMarkdown(audit) {
    const lines = [
      '# Auditoria e rastreabilidade DevTrail',
      '',
      '**Status da reprodução:** ' + safe(audit?.replay?.status || 'nao_observado'),
      '',
      '## 1. Cadeia de evidências',
      '- Sessão: ' + safe(audit?.session?.session_id || 'não informado'),
      '- URL alvo: ' + safe(audit?.session?.url || 'não informado'),
      '- Análise disponível: ' + (audit?.source_chain?.analysis_available ? 'sim' : 'não'),
      '- Qualidade disponível: ' + (audit?.source_chain?.quality_available ? 'sim' : 'não'),
      '- Prontidão: ' + safe(audit?.source_chain?.readiness || 'não informado'),
      '- Plano de reprodução: ' + (audit?.source_chain?.replay_plan_available ? 'sim' : 'não'),
      '- Validação de reprodução: ' + (audit?.source_chain?.replay_validation_available ? 'sim' : 'não'),
      '',
      '## 2. Evidência quantitativa',
      '- Etapas observadas: ' + (audit?.evidence?.steps ?? 0),
      '- Cobertura de seletores: ' + safe(audit?.evidence?.selectors_coverage ?? 'não calculada'),
      '- Cobertura de correlação de rede: ' + safe(audit?.evidence?.network_correlation_coverage ?? 'não calculada'),
      '- Cobertura de resultados: ' + safe(audit?.evidence?.outcome_coverage ?? 'não calculada'),
      '',
      '## 3. Rastreabilidade etapa a etapa'
    ];

    (audit?.traceability || []).forEach(item => {
      lines.push('');
      lines.push('### Etapa ' + item.order + ' — ' + safe(item.replay_verdict));
      lines.push('- Ação: ' + safe(item.action || 'não informado'));
      lines.push('- Alvo: ' + safe(item.target || 'não informado'));
      lines.push('- Resultado esperado: ' + safe(item.expected || 'não informado'));
      if (item.reasons?.length) item.reasons.forEach(reason => lines.push('- Divergência: ' + safe(reason)));
    });

    lines.push('', '## 4. Pontos em aberto');
    if (audit?.open_points?.length) audit.open_points.forEach(item => lines.push('- ' + safe(item)));
    else lines.push('- Nenhum ponto em aberto identificado na cadeia observada.');

    lines.push('', '## 5. Segurança e governança');
    lines.push('- Credenciais armazenadas: não.');
    lines.push('- Valores sensíveis comparados como conteúdo: não.');
    lines.push('- Política: não armazenar credenciais, tokens, cookies ou senhas.');

    return lines.join('\n');
  }

  return { build, convertToMarkdown };
});
