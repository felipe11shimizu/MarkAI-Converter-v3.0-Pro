(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarkAIDevTrailFormatters = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function escapeMarkdown(value) { return String(value ?? '').replace(/[\\|`]/g, '\\\\$&').replace(/\n/g, ' '); }
  function safeJson(value) { try { return JSON.stringify(value, null, 2); } catch (_) { return JSON.stringify(String(value)); } }
  function formatMs(value) { const ms = Number(value || 0); return Math.floor(ms / 60000) + 'm ' + Math.floor((ms % 60000) / 1000) + 's ' + (ms % 1000) + 'ms'; }
  function iconFor(type) { return ({ click: '🖱️', input: '⌨️', submit: '📨', keyboard: '🔑' })[type] || '•'; }
  function labelFor(type) { return ({ click: 'Clique', input: 'Entrada', submit: 'Envio de formulário', keyboard: 'Teclado' })[type] || String(type || 'Evento'); }
  function convertJsonToMarkdown(jsonData) {
    const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : (jsonData || {});
    const meta = data.metadata || {};
    const steps = Array.isArray(data.steps) ? data.steps : [];
    const lines = ['# DevTrail Telemetry Session', '', '- **URL:** ' + escapeMarkdown(meta.url_alvo || ''), '- **Início:** ' + escapeMarkdown(meta.timestamp_inicio || ''), '- **Duração:** ' + formatMs(meta.duracao_total_ms), '- **Etapas:** ' + steps.length, '- **Motivo:** ' + escapeMarkdown(meta.motivo_finalizacao || ''), ''];
    steps.forEach(step => {
      lines.push('## ' + step.step_id + '. ' + iconFor(step.tipo_evento) + ' ' + labelFor(step.tipo_evento));
      lines.push('- **Tempo relativo:** ' + formatMs(step.timestamp_relativo_ms));
      const el = step.elemento || {};
      if (el.tag) lines.push('- **Elemento:** `' + escapeMarkdown(el.tag) + '` — ' + escapeMarkdown(el.texto_visivel || ''));
      const selectors = el.seletores || {};
      for (const key of ['testid', 'cy', 'id', 'name', 'css', 'xpath']) if (selectors[key]) lines.push('- **Seletor ' + key + ':** `' + escapeMarkdown(selectors[key]) + '`');
      if (step.valor_entrada != null) lines.push('- **Valor:** `' + escapeMarkdown(step.valor_entrada) + '`');
      if (step.detalhes?.tecla) lines.push('- **Tecla:** `' + escapeMarkdown(step.detalhes.tecla) + '`');
      const calls = Array.isArray(step.chamadas_rede) ? step.chamadas_rede : [];
      if (calls.length) {
        lines.push('- **Chamadas de rede:**');
        calls.forEach(call => {
          lines.push('  - `' + escapeMarkdown(call.metodo || '') + ' ' + escapeMarkdown(call.url || '') + '` — HTTP ' + escapeMarkdown(call.status ?? ''));
          if (call.payload != null) lines.push('    - Payload:', '      ```json', safeJson(call.payload), '      ```');
        });
      }
      lines.push('');
    });
    const diagnostics = Array.isArray(data.diagnostics) ? data.diagnostics : [];
    if (diagnostics.length) {
      lines.push('## Diagnósticos');
      diagnostics.forEach(item => { lines.push('- **' + escapeMarkdown(item.tipo_evento) + '** @ ' + formatMs(item.timestamp_relativo_ms) + ': ' + escapeMarkdown(item.mensagem || '')); if (item.stack) lines.push('  ```text', String(item.stack), '  ```'); });
      lines.push('');
    }
    return lines.join('\n');
  }
  return { convertJsonToMarkdown, formatMs };
});