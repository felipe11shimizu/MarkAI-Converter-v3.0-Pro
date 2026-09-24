(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarkAIDevTrailFormatters = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function escapeMarkdown(value) { return String(value ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' '); }
  function safeJson(value) { try { return JSON.stringify(value, null, 2); } catch (_) { return JSON.stringify(String(value)); } }
  function formatMs(value) { const ms = Number(value || 0); return Math.floor(ms / 60000) + 'm ' + Math.floor((ms % 60000) / 1000) + 's ' + (ms % 1000) + 'ms'; }
  function iconFor(type) { return ({ click: '🖱️', input: '⌨️', submit: '📨', keyboard: '🔑' })[type] || '•'; }
  function labelFor(type) { return ({ click: 'Clique', input: 'Preenchimento', submit: 'Envio de formulário', keyboard: 'Teclado' })[type] || String(type || 'Evento'); }
  function isSensitiveValue(value) { return /\[REDACTED\]/i.test(String(value ?? '')); }
  function pathFromUrl(url) { try { return new URL(url).pathname || '/'; } catch (_) { return url || ''; } }
  function unique(values) { return [...new Set(values.filter(Boolean))]; }

  function convertJsonToTechnicalReport(jsonData) {
    const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : (jsonData || {});
    const meta = data.metadata || {};
    const steps = Array.isArray(data.steps) ? data.steps : [];
    const calls = steps.flatMap(step => Array.isArray(step.chamadas_rede) ? step.chamadas_rede : []);
    const diagnostics = Array.isArray(data.diagnostics) ? data.diagnostics : [];
    const captures = Array.isArray(data.capturas_visuais) ? data.capturas_visuais : [];
    const lines = [
      '# Relato Técnico da Atividade', '',
      '## 1. Resumo', '',
      '- **Objetivo da captura:** Documentar a atividade observada no sistema a partir dos eventos capturados.',
      '- **URL inicial:** ' + escapeMarkdown(meta.url_alvo || 'não informada'),
      '- **Início:** ' + escapeMarkdown(meta.timestamp_inicio || 'não informado'),
      '- **Duração:** ' + formatMs(meta.duracao_total_ms),
      '- **Passos registrados:** ' + steps.length,
      '- **Chamadas de rede associadas:** ' + calls.length,
      '- **Diagnósticos:** ' + diagnostics.length,
      '- **Evidências visuais:** ' + captures.length,
      '- **Motivo da finalização:** ' + escapeMarkdown(meta.motivo_finalizacao || 'não informado'), ''
    ];
    if (data.area_captura) {
      const a = data.area_captura;
      lines.push('### Área de evidência', '',
        '- **Posição:** (' + Math.round(a.x || 0) + ', ' + Math.round(a.y || 0) + ') px',
        '- **Dimensão:** ' + Math.round(a.width || 0) + ' × ' + Math.round(a.height || 0) + ' px', '');
    }
    lines.push('## 2. Fluxo executado', '');
    if (!steps.length) lines.push('Nenhum evento DOM foi registrado durante a sessão.', '');
    steps.forEach(step => {
      const el = step.elemento || {};
      lines.push('### Passo ' + step.step_id + ' — ' + iconFor(step.tipo_evento) + ' ' + labelFor(step.tipo_evento));
      lines.push('- **Tempo relativo:** ' + formatMs(step.timestamp_relativo_ms));
      if (el.tag) lines.push('- **Elemento:** ' + el.tag + (el.texto_visivel ? ' — ' + escapeMarkdown(el.texto_visivel) : ''));
      const selectors = el.seletores || {};
      for (const key of ['testid', 'cy', 'id', 'name', 'css', 'xpath']) if (selectors[key]) lines.push('- **Seletor ' + key + ':** ' + escapeMarkdown(selectors[key]));
      if (step.valor_entrada != null && !isSensitiveValue(step.valor_entrada)) lines.push('- **Valor observado:** ' + escapeMarkdown(step.valor_entrada));
      if (step.detalhes?.tecla) lines.push('- **Tecla:** ' + escapeMarkdown(step.detalhes.tecla));
      const stepCalls = Array.isArray(step.chamadas_rede) ? step.chamadas_rede : [];
      if (stepCalls.length) {
        lines.push('- **Comunicação de rede associada:**');
        stepCalls.forEach(call => {
          lines.push('  - ' + escapeMarkdown(call.metodo || '') + ' ' + escapeMarkdown(pathFromUrl(call.url || '')) + ' — HTTP ' + escapeMarkdown(call.status ?? ''));
          if (call.tempo_resposta_ms != null) lines.push('    - Tempo de resposta: ' + formatMs(call.tempo_resposta_ms));
          if (call.payload != null) lines.push('    - Payload: ' + safeJson(call.payload));
        });
      }
      lines.push('');
    });
    lines.push('## 3. Elementos identificados', '');
    const elements = unique(steps.map(step => {
      const el = step.elemento || {};
      const selector = el.seletores?.testid || el.seletores?.id || el.seletores?.name || el.seletores?.css || el.seletores?.xpath;
      return selector ? (el.texto_visivel || el.tag || 'elemento') + ' | ' + selector : null;
    }));
    if (!elements.length) lines.push('Nenhum seletor confiável foi identificado.', '');
    else {
      lines.push('| Elemento | Seletor |', '|---|---|');
      elements.forEach(item => { const p = item.split(' | '); lines.push('| ' + escapeMarkdown(p[0]) + ' | ' + escapeMarkdown(p.slice(1).join(' | ')) + ' |'); });
      lines.push('');
    }
    lines.push('## 4. APIs e comunicações observadas', '');
    const uniqueCalls = []; const seen = new Set();
    calls.forEach(call => { const key = (call.metodo || '') + ' ' + (call.url || '') + ' ' + (call.status ?? ''); if (!seen.has(key)) { seen.add(key); uniqueCalls.push(call); } });
    if (!uniqueCalls.length) lines.push('Nenhuma chamada de rede foi associada aos passos capturados.', '');
    else {
      lines.push('| Método | Endpoint | HTTP |', '|---|---|---:|');
      uniqueCalls.forEach(call => lines.push('| ' + escapeMarkdown(call.metodo || '') + ' | ' + escapeMarkdown(pathFromUrl(call.url || '')) + ' | ' + escapeMarkdown(call.status ?? '') + ' |'));
      lines.push('');
    }
    lines.push('## 5. Comportamentos e diagnósticos', '');
    if (!diagnostics.length) lines.push('Nenhum erro ou warning de console foi registrado.', '');
    else diagnostics.forEach(item => lines.push('- **' + escapeMarkdown(item.tipo_evento) + '** em ' + formatMs(item.timestamp_relativo_ms) + ': ' + escapeMarkdown(item.mensagem || '')));
    lines.push('');
    lines.push('## 6. Especificação para desenvolvimento/RPA', '',
      '### Objetivo funcional',
      'Reproduzir o fluxo observado respeitando a sequência dos passos, os seletores identificados e as comunicações de rede registradas.', '',
      '### Requisitos funcionais derivados');
    if (!steps.length) lines.push('- RF01 — Capturar e documentar os eventos executados pelo usuário.');
    else steps.forEach(step => {
      const el = step.elemento || {};
      const selector = el.seletores?.testid || el.seletores?.id || el.seletores?.name || el.seletores?.css || el.seletores?.xpath || 'seletor não identificado';
      lines.push('- RF' + String(step.step_id).padStart(2, '0') + ' — Executar ' + labelFor(step.tipo_evento) + ' no elemento ' + selector + (el.texto_visivel ? ' (' + el.texto_visivel + ')' : '') + '.');
    });
    lines.push('', '### Dados a parametrizar');
    const values = unique(steps.map(step => step.valor_entrada).filter(v => v != null && !isSensitiveValue(v)).map(String));
    if (values.length) values.forEach((value, i) => lines.push('- Parâmetro ' + (i + 1) + ': ' + escapeMarkdown(value)));
    else lines.push('- Não foram identificados valores de entrada não sensíveis suficientes para parametrização.');
    lines.push('', '### Observações para implementação',
      '- Priorizar data-testid, data-cy, id e name antes de seletores CSS/XPath.',
      '- Validar o status HTTP das chamadas relevantes antes de avançar para o próximo passo.',
      '- Não persistir senhas, cookies, tokens ou cabeçalhos de autenticação.',
      '- Tratar mudanças de URL, carregamento assíncrono e mensagens de erro como pontos de sincronização.', '',
      '## 7. Limitações da observação', '',
      '- O relato representa somente o que foi capturado durante esta sessão.',
      '- Ausência de uma chamada ou elemento no relatório não significa necessariamente que o sistema não o utilize.',
      '- Regras de negócio inferidas a partir da interface devem ser confirmadas com documentação ou testes adicionais.', '');
    return lines.join('\n');
  }
  function convertJsonToMarkdown(jsonData) { return convertJsonToTechnicalReport(jsonData); }
  return { convertJsonToMarkdown, convertJsonToTechnicalReport, formatMs };
});
