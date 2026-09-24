(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarkAIDevTrailPackage = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function safe(value) { return value == null ? '' : String(value); }

  function build(session, analysis, quality, specification, readiness) {
    const data = typeof session === 'string' ? JSON.parse(session) : (session || {});
    return {
      package_version: '1.0',
      package_type: 'devtrail-rpa-handoff',
      generated_at: new Date().toISOString(),
      session: data,
      analysis: analysis || null,
      quality: quality || null,
      specification: specification || null,
      readiness: readiness || null
    };
  }

  function convertToMarkdown(pkg) {
    const p = pkg || {};
    const r = p.readiness || {};
    const q = p.quality || {};
    const s = p.specification || {};
    const lines = [
      '# DevTrail — Pacote Técnico para Automação/RPA', '',
      '**Versão do pacote:** ' + safe(p.package_version || '1.0'),
      '**Status de prontidão:** ' + safe(r.readiness || 'não avaliado'),
      '**Qualidade da evidência:** ' + safe(q.status || 'não avaliada'),
      '',
      '## 1. Objetivo', '',
      safe(s.objective || r.objective || 'Não informado'), '',
      '## 2. Evidência da sessão', '',
      '- Etapas capturadas: ' + (p.analysis?.metrics?.steps || 0),
      '- Chamadas de rede: ' + (p.analysis?.metrics?.network_calls || 0),
      '- Diagnósticos: ' + (p.analysis?.metrics?.diagnostics || 0),
      '- Cobertura de seletores: ' + (q.metrics?.selector_coverage ?? 0),
      '- Correlação de rede: ' + (q.metrics?.network_correlation_coverage ?? 0),
      '- Cobertura de resultados: ' + (q.metrics?.outcome_coverage ?? 0),
      '',
      '## 3. Sequência para automação', ''
    ];
    (r.actions || []).forEach(a => lines.push(a.order + '. **' + safe(a.action) + '** — ' + safe(a.target) + (a.input ? ' → ' + safe(a.input) : '') + ' — espera: ' + (a.wait_after_ms ?? '—') + ' ms'));
    if (!(r.actions || []).length) lines.push('- Nenhuma ação disponível.');
    lines.push('', '## 4. Contratos observados', '');
    (s.api_contracts || []).forEach(api => lines.push('- **' + safe(api.endpoint) + '** — HTTP ' + (api.status ?? 'não informado')));
    if (!(s.api_contracts || []).length) lines.push('- Nenhum contrato de API observado.');
    lines.push('', '## 5. Pontos a confirmar', '');
    const confirmations = r.confirmations || s.confirmations || [];
    if (confirmations.length) confirmations.forEach(item => lines.push('- **' + safe(item.id) + '** — ' + safe(item.statement)));
    else lines.push('- Nenhum ponto adicional.');
    lines.push('', '## 6. Regras de segurança', '',
      '- Dados sensíveis devem permanecer mascarados.',
      '- Credenciais devem ser fornecidas somente pelo mecanismo seguro do executor.',
      '- O pacote descreve evidência observada; não substitui validação funcional do processo.');
    return lines.join('\n');
  }

  return { build, convertToMarkdown };
});