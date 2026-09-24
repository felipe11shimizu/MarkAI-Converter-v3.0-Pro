(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarkAIDevTrailQuality = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SENSITIVE = /^(authorization|cookie|set-cookie|password|senha|token|access[_-]?token|refresh[_-]?token|api[_-]?key)$/i;

  function safe(value) { return value == null ? '' : String(value); }
  function isRedacted(value) { return value === '[REDACTED]' || value === '[DADO SENSÍVEL]'; }

  function scanSensitive(value, path = '$', findings = []) {
    if (!value || typeof value !== 'object') return findings;
    if (Array.isArray(value)) {
      value.forEach((item, i) => scanSensitive(item, path + '[' + i + ']', findings));
      return findings;
    }
    Object.entries(value).forEach(([key, item]) => {
      const current = path + '.' + key;
      if (SENSITIVE.test(key) && item != null && item !== '' && !isRedacted(item)) {
        findings.push({ path: current, issue: 'campo sensível sem mascaramento explícito' });
      }
      scanSensitive(item, current, findings);
    });
    return findings;
  }

  function analyze(session, analysis) {
    const data = typeof session === 'string' ? JSON.parse(session) : (session || {});
    const steps = Array.isArray(data.steps) ? data.steps : [];
    const analyzer = globalThis.MarkAIDevTrailAnalyzer;
    const a = analysis || (analyzer?.analyze ? analyzer.analyze(data) : null);
    const flow = Array.isArray(a?.execution_flow) ? a.execution_flow : [];
    const checks = [];
    const gaps = [];

    const selectorSteps = steps.filter(step => {
      const s = step?.elemento?.seletores || {};
      return Boolean(s.testid || s.cy || s.id || s.name || s.css || s.xpath);
    }).length;
    const correlatedSteps = flow.filter(item => item.network_calls?.length).length;
    const timedSteps = steps.filter(step => Number.isFinite(Number(step?.timestamp_relativo_ms))).length;
    const outcomeSteps = flow.filter(item => item.outcome && item.outcome !== 'rede_sem_status').length;
    const sensitiveFindings = scanSensitive(data);

    checks.push({ id: 'Q01', name: 'eventos_capturados', status: steps.length ? 'ok' : 'gap', observed: steps.length });
    checks.push({ id: 'Q02', name: 'seletores_utilizaveis', status: !steps.length ? 'gap' : selectorSteps === steps.length ? 'ok' : 'parcial', observed: selectorSteps, total: steps.length });
    checks.push({ id: 'Q03', name: 'ordem_temporal', status: !steps.length ? 'gap' : timedSteps === steps.length ? 'ok' : 'parcial', observed: timedSteps, total: steps.length });
    checks.push({ id: 'Q04', name: 'correlacao_rede', status: !steps.length ? 'gap' : correlatedSteps ? 'ok' : 'gap', observed: correlatedSteps });
    checks.push({ id: 'Q05', name: 'resultado_observado', status: !steps.length ? 'gap' : outcomeSteps ? 'ok' : 'parcial', observed: outcomeSteps });
    checks.push({ id: 'Q06', name: 'dados_sensiveis_mascarados', status: sensitiveFindings.length ? 'gap' : 'ok', observed: sensitiveFindings.length });

    if (!steps.length) gaps.push({ id: 'G01', statement: 'Nenhuma etapa foi capturada; a sessão não sustenta uma especificação reproduzível.' });
    if (selectorSteps < steps.length) gaps.push({ id: 'G02', statement: 'Uma ou mais etapas não possuem seletor DOM utilizável.' });
    if (timedSteps < steps.length) gaps.push({ id: 'G03', statement: 'Uma ou mais etapas não possuem timestamp relativo válido.' });
    if (steps.length && !correlatedSteps) gaps.push({ id: 'G04', statement: 'Não foi possível correlacionar chamadas de rede às etapas capturadas.' });
    if (steps.length && !outcomeSteps) gaps.push({ id: 'G05', statement: 'Os resultados das ações não possuem evidência de status de rede suficiente.' });
    sensitiveFindings.forEach((finding, index) => gaps.push({ id: 'GSEC' + String(index + 1).padStart(2, '0'), statement: finding.issue + ': ' + finding.path }));

    const blocking = gaps.some(g => /^GSEC/.test(g.id) || g.id === 'G01');
    const status = blocking ? 'bloqueado' : gaps.length ? 'revisar' : 'adequado';

    return {
      schema_version: '1.0',
      status,
      checks,
      gaps,
      metrics: {
        steps: steps.length,
        selector_coverage: steps.length ? Number((selectorSteps / steps.length).toFixed(3)) : 0,
        timestamp_coverage: steps.length ? Number((timedSteps / steps.length).toFixed(3)) : 0,
        network_correlation_coverage: steps.length ? Number((correlatedSteps / steps.length).toFixed(3)) : 0,
        outcome_coverage: steps.length ? Number((outcomeSteps / steps.length).toFixed(3)) : 0
      },
      sensitive_findings: sensitiveFindings
    };
  }

  function convertToMarkdown(report) {
    const r = report || analyze({});
    const lines = [
      '## Qualidade e suficiência da evidência',
      '',
      '> Esta seção valida a completude técnica da telemetria sem substituir a validação funcional do sistema.',
      '',
      '**Status da evidência:** ' + safe(r.status),
      '',
      '### Verificações',
      '',
      '| ID | Verificação | Status | Observado | Total |',
      '|---|---|---|---:|---:|'
    ];
    (r.checks || []).forEach(check => lines.push('| ' + check.id + ' | ' + check.name + ' | ' + check.status + ' | ' + (check.observed ?? '—') + ' | ' + (check.total ?? '—') + ' |'));
    lines.push('', '### Lacunas e pontos de revisão', '');
    if (r.gaps?.length) r.gaps.forEach(g => lines.push('- **' + g.id + '** — ' + g.statement));
    else lines.push('- Nenhuma lacuna técnica detectada automaticamente.');
    lines.push('', '### Cobertura da sessão', '',
      '- Eventos: ' + (r.metrics?.steps ?? 0),
      '- Seletores: ' + (r.metrics?.selector_coverage ?? 0),
      '- Timestamps: ' + (r.metrics?.timestamp_coverage ?? 0),
      '- Correlação de rede: ' + (r.metrics?.network_correlation_coverage ?? 0),
      '- Resultados: ' + (r.metrics?.outcome_coverage ?? 0));
    return lines.join('\n');
  }

  return { analyze, convertToMarkdown };
});