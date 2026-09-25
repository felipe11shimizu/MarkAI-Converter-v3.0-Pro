(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DevTrailAutonomousSystemMapMarkdown = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = '1.0';
  function text(value, fallback = '') { return value == null || value === '' ? fallback : String(value); }
  function escape(value) { return text(value).replace(/([\\|])/g, '\\$1').replace(/\r?\n/g, ' '); }
  function cell(value, fallback = '—') { const result = text(value, fallback); return escape(result) || fallback; }
  function link(url) { const value = text(url); if (!value) return '—'; return '[' + value.replace(/\]/g, '\\]') + '](' + value.replace(/[()\s]/g, encodeURIComponent) + ')'; }
  function table(headers, rows) {
    if (!rows.length) return '_Nenhum registro._';
    const head = '| ' + headers.join(' | ') + ' |\n| ' + headers.map(() => '---').join(' | ') + ' |';
    return head + '\n' + rows.map(row => '| ' + row.join(' | ') + ' |').join('\n');
  }
  function render(map = {}) {
    const totals = map.totals || { pages:(map.pages||[]).length, elements:(map.elements||[]).length, actions:(map.actions||[]).length, network:(map.network||[]).length, flows:(map.flows||[]).length, diagnostics:(map.diagnostics||[]).length };
    const lines = [
      '# DevTrail Autonomous System Map','',
      '> Mapa gerado automaticamente a partir da sessão de exploração autônoma. Dados sensíveis devem permanecer redigidos na origem.','',
      '## Sessão','', table(['Campo','Valor'], [['Schema',cell(map.schema_version||VERSION)],['Session ID',cell(map.session_id)],['Target URL',map.target_url?link(map.target_url):'—'],['Gerado em',cell(map.generated_at)]]),'',
      '## Resumo','', table(['Entidade','Quantidade'], [['Páginas',String(totals.pages)],['Elementos',String(totals.elements)],['Ações',String(totals.actions)],['Network',String(totals.network)],['Fluxos',String(totals.flows)],['Diagnósticos',String(totals.diagnostics)]]),'',
      '## Páginas','', table(['Página','Título','Viewport'], (map.pages||[]).map(page => [cell(page.url),cell(page.title),cell(page.viewport ? (page.viewport.width||'?')+'×'+(page.viewport.height||'?') : null)])),'',
      '## Elementos descobertos','', table(['Página','Seletor','Tipo','Texto/ARIA','Estado'], (map.elements||[]).map(element => [cell(element.page_id),cell(element.selector),cell(element.type||element.tag),cell(element.text||element.ariaLabel),element.disabled?'disabled':(element.visible?'visible':'hidden')])),'',
      '## Ações correlacionadas','', table(['Evento','Tipo','Elemento','URL','Network refs'], (map.actions||[]).map(action => [cell(action.action_id),cell(action.tipo_evento),cell(action.elemento),cell(action.url),cell((action.network_refs||[]).join(', '))])),'',
      '## Network observado','', table(['ID','Método','Status','URL','MIME'], (map.network||[]).map(item => [cell(item.network_id),cell(item.metodo||item.method),cell(item.status),cell(item.url),cell(item.mimeType||item.mime)])),'',
      '## Fluxos','', table(['ID','Nome/Descrição'], (map.flows||[]).map(flow => [cell(flow.flow_id),cell(flow.name||flow.description||flow.tipo||JSON.stringify(flow))])),'',
      '## Diagnósticos','', table(['ID','Tipo','Mensagem'], (map.diagnostics||[]).map(item => [cell(item.id),cell(item.type||item.tipo),cell(item.message||item.mensagem||JSON.stringify(item))])),'',
      '## Critérios de exploração','',
      '- O mapa é descritivo; esta fase não executa ações no alvo.',
      '- Elementos de senha não devem conter valor, placeholder ou texto sensível.',
      '- Credenciais, cookies, tokens e chaves devem permanecer redigidos pela camada de captura Network.',
      '- O próximo estágio usa este mapa como entrada do Planner, antes de qualquer execução autônoma.',''
    ];
    return lines.join('\n');
  }
  return Object.freeze({ VERSION, render });
});