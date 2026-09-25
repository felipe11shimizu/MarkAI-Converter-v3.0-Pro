const assert = require('node:assert/strict');
const renderer = require('../extension/autonomous_system_map_markdown.js');

(() => {
  const markdown = renderer.render({
    schema_version: '1.0', session_id: 'session-1', target_url: 'https://example.test/app', generated_at: '2026-09-25T12:00:00.000Z',
    pages: [{ url: 'https://example.test/app', title: 'Example', viewport: { width: 1200, height: 800 } }],
    elements: [{ page_id: 'https://example.test/app', selector: '#save', tag: 'button', text: 'Salvar', visible: true, disabled: false }],
    actions: [{ action_id: 'click-save', tipo_evento: 'click', elemento: '#save', network_refs: ['r1'] }],
    network: [{ network_id: 'r1', metodo: 'POST', status: 200, url: 'https://example.test/api/save', mimeType: 'application/json' }],
    flows: [{ flow_id: 'flow-1', name: 'Salvar registro' }],
    diagnostics: [{ id: 'd1', type: 'info', message: 'ok' }],
    totals: { pages: 1, elements: 1, actions: 1, network: 1, flows: 1, diagnostics: 1 }
  });
  assert.match(markdown, /^# DevTrail Autonomous System Map/m);
  assert.match(markdown, /Session ID.*session-1/);
  assert.match(markdown, /Páginas.*1/);
  assert.match(markdown, /#save/);
  assert.match(markdown, /click-save/);
  assert.match(markdown, /r1/);
  assert.match(markdown, /Salvar registro/);
  assert.match(markdown, /Credenciais, cookies, tokens e chaves/);
  assert.doesNotMatch(markdown, /password=/i);
  const escaped = renderer.render({ elements: [{ selector: 'a|b', text: 'linha\num' }] });
  assert.match(escaped, /a\\|b/);
  assert.match(escaped, /linha um/);
  console.log('devtrail autonomous system map markdown tests: ok');
})();