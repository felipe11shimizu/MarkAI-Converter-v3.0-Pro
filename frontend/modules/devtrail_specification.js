(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarkAIDevTrailSpecification = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function safe(value) { return value == null ? '' : String(value); }
  function path(url) {
    try {
      const parsed = new URL(url);
      return parsed.pathname || '/';
    } catch (_) { return safe(url); }
  }
  function unique(values) { return [...new Set(values.filter(Boolean))]; }
  function cssAttributeValue(value) {
    return safe(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }
  function cssId(value) {
    return safe(value).replace(/([\\.#:[\],>+~*'"()= ])/g, '\\$1');
  }
  function selectorFor(element) {
    const s = element?.seletores || {};
    if (s.id) return '#' + cssId(s.id);
    if (s.testid) return '[data-testid="' + cssAttributeValue(s.testid) + '"]';
    if (s.cy) return '[data-cy="' + cssAttributeValue(s.cy) + '"]';
    if (s.name) return '[name="' + cssAttributeValue(s.name) + '"]';
    if (s.css) return s.css;
    if (s.xpath) return s.xpath;
    return '';
  }
  function maskValue(value) {
    const text = safe(value);
    return /\[REDACTED\]/i.test(text) ? '[DADO SENSÍVEL]' : text;
  }

  function buildObjective(session, steps) {
    if (session?.objetivo) return safe(session.objetivo);
    const labels = unique(steps.map(step => safe(step.elemento?.texto_visivel || step.elemento?.tag)).filter(Boolean));
    if (!labels.length) return 'Executar e documentar o fluxo observado na aplicação.';
    return 'Executar o fluxo observado envolvendo ' + labels.slice(0, 3).join(', ') + (labels.length > 3 ? ' e demais elementos identificados.' : '.');
  }

  function generate(data, analysis) {
    const session = typeof data === 'string' ? JSON.parse(data) : (data || {});
    const steps = Array.isArray(session.steps) ? session.steps : [];
    const calls = steps.flatMap(step => Array.isArray(step.chamadas_rede) ? step.chamadas_rede : []);
    const diagnostics = Array.isArray(session.diagnostics) ? session.diagnostics : [];
    const analyzer = globalThis.MarkAIDevTrailAnalyzer;
    const a = analysis || (analyzer?.analyze ? analyzer.analyze(session) : null);
    const requirements = steps.map((step, index) => {
      const element = step.elemento || {};
      return {
        id: 'RF' + String(index + 1).padStart(2, '0'),
        action: safe(step.tipo_evento || 'evento'),
        label: safe(element.texto_visivel || element.tag || 'elemento'),
        selector: selectorFor(element) || 'não identificado',
        input: maskValue(step.valor_entrada),
        step_id: step.step_id ?? index + 1
      };
    });
    const businessRules = [];
    const endpointGroups = new Map();
    calls.forEach(call => {
      const key = safe(call.metodo || 'GET').toUpperCase() + ' ' + path(call.url);
      endpointGroups.set(key, (endpointGroups.get(key) || 0) + 1);
    });
    for (const [endpoint, count] of endpointGroups) {
      if (count > 1) {
        businessRules.push({
          id: 'RN' + String(businessRules.length + 1).padStart(2, '0'),
          status: 'inferida',
          statement: 'O fluxo observou mais de uma chamada para ' + endpoint + '; confirmar se representa repetição, consulta complementar ou reprocessamento.'
        });
      }
    }
    if (diagnostics.length) {
      businessRules.push({
        id: 'RN' + String(businessRules.length + 1).padStart(2, '0'),
        status: 'a_confirmar',
        statement: 'Existem diagnósticos técnicos durante a execução; confirmar se são condições esperadas ou tratamento de erro do processo.'
      });
    }
    const dataFields = unique(steps.map(step => {
      const element = step.elemento || {};
      return element.texto_visivel || element.seletores?.name || element.seletores?.id || '';
    }));
    const apiContracts = unique(calls.map(call => safe(call.metodo || 'GET').toUpperCase() + ' ' + path(call.url))).map(endpoint => {
      const call = calls.find(item => safe(item.metodo || 'GET').toUpperCase() + ' ' + path(item.url) === endpoint);
      return {
        endpoint,
        status: call?.status ?? null,
        payload: call?.payload ?? null,
        response_preview: call?.response_preview ?? null
      };
    });
    const confirmations = [
      ...(a?.classification?.to_confirm || []).map(item => ({ id: item.id, source: 'análise', statement: item.statement })),
      ...(requirements.filter(item => item.selector === 'não identificado').map(item => ({
        id: 'CONFSEL' + item.id.slice(2),
        source: 'telemetria',
        statement: 'Identificar seletor estável para ' + item.label + ' antes da automação.'
      })))
    ];
    return {
      schema_version: '1.0',
      objective: buildObjective(session, steps),
      source: {
        url: safe(session.metadata?.url_alvo || session.url_alvo || ''),
        steps: steps.length,
        network_calls: calls.length,
        diagnostics: diagnostics.length
      },
      functional_requirements: requirements,
      business_rules: businessRules,
      data_fields: dataFields,
      api_contracts: apiContracts,
      automation_sequence: requirements.map(item => ({
        order: item.step_id,
        requirement_id: item.id,
        action: item.action,
        selector: item.selector,
        input: item.input || null
      })),
      confirmations: unique(confirmations.map(item => JSON.stringify(item))).map(item => JSON.parse(item))
    };
  }

  function md(value) { return safe(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' '); }
  function json(value) { return value == null ? '—' : '’' + JSON.stringify(value).replace(/\\n/g, ' ') + '’'; }

  function convertToMarkdown(spec) {
    const s = spec || generate({});
    const lines = [
      '## Especificação de desenvolvimento e RPA', '',
      '> Esta especificação é derivada da telemetria observada. Itens marcados como inferidos ou a confirmar não devem ser tratados como regra definitiva.', '',
      '### 1. Objetivo', '',
      safe(s.objective), '',
      '### 2. Requisitos funcionais', '',
      '| ID | Ação | Elemento | Seletor | Entrada |',
      '|---|---|---|---|---|'
    ];
    (s.functional_requirements || []).forEach(r => lines.push('| ' + md(r.id) + ' | ' + md(r.action) + ' | ' + md(r.label) + ' | ' + md(r.selector) + ' | ' + md(r.input || '—') + ' |'));
    if (!(s.functional_requirements || []).length) lines.push('| — | — | Nenhuma etapa capturada | — | — |');
    lines.push('', '### 3. Regras de negócio', '');
    (s.business_rules || []).forEach(r => lines.push('- **' + md(r.id) + '** [' + md(r.status) + '] — ' + md(r.statement)));
    if (!(s.business_rules || []).length) lines.push('- Nenhuma regra de negócio foi inferida automaticamente.');
    lines.push('', '### 4. Campos identificados', '');
    (s.data_fields || []).forEach(field => lines.push('- ' + md(field)));
    if (!(s.data_fields || []).length) lines.push('- Nenhum campo identificado.');
    lines.push('', '### 5. Contratos de API observados', '');
    (s.api_contracts || []).forEach(api => lines.push('- **' + md(api.endpoint) + '** — status: ' + md(api.status ?? 'não informado') + '\n  - payload: ' + json(api.payload) + '\n  - resposta: ' + json(api.response_preview)));
    if (!(s.api_contracts || []).length) lines.push('- Nenhuma chamada de API associada foi observada.');
    lines.push('', '### 6. Sequência para automação', '');
    (s.automation_sequence || []).forEach(item => lines.push(item.order + '. **' + md(item.action) + '** — ' + md(item.selector) + (item.input ? ' → entrada: ' + md(item.input) : '')));
    if (!(s.automation_sequence || []).length) lines.push('- Nenhuma sequência disponível.');
    lines.push('', '### 7. Pontos a confirmar', '');
    (s.confirmations || []).forEach(item => lines.push('- **' + md(item.id) + '** [' + md(item.source) + '] — ' + md(item.statement)));
    if (!(s.confirmations || []).length) lines.push('- Nenhum ponto adicional identificado.');
    lines.push('', '### 8. Rastreabilidade', '',
      '- URL observada: ' + md(s.source?.url || 'não informada'),
      '- Passos capturados: ' + (s.source?.steps || 0),
      '- Chamadas de rede: ' + (s.source?.network_calls || 0),
      '- Diagnósticos: ' + (s.source?.diagnostics || 0), '');
    return lines.join('\n');
  }

  return { generate, convertToMarkdown };
});
