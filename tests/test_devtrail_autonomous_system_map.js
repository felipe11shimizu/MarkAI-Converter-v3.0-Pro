const assert = require('node:assert/strict');
const systemMap = require('../extension/autonomous_system_map.js');

(() => {
  const map = systemMap.create({
    session_id: 'session-1',
    target_url: 'https://example.test/app'
  });

  systemMap.addDomSnapshot(map, {
    page: {
      url: 'https://example.test/app',
      title: 'Example',
      viewport: { width: 1200, height: 800 }
    },
    counts: { interactive: 2, visible: 2, enabled: 2 },
    controls: [
      { index: 0, selector: '#save', tag: 'button', text: 'Salvar', visible: true, disabled: false },
      { index: 1, selector: '#name', tag: 'input', type: 'text', visible: true, disabled: false }
    ]
  });

  systemMap.addDomSnapshot(map, {
    page: { url: 'https://example.test/app', title: 'Example' },
    controls: [{ index: 0, selector: '#save', tag: 'button', text: 'Salvar agora', visible: true, disabled: false }]
  });

  systemMap.addCorrelatedSteps(map, [{
    step_id: 1,
    event_id: 'click-save',
    tipo_evento: 'click',
    timestamp_epoch_ms: 1000,
    elemento: '#save',
    chamadas_rede: [{
      requestId: 'r1',
      url: '/api/save',
      metodo: 'POST',
      status: 200,
      timestamp_epoch_ms: 1100
    }]
  }]);

  systemMap.addCorrelatedSteps(map, [{
    step_id: 2,
    event_id: 'click-next',
    tipo_evento: 'click',
    elemento: '#next',
    chamadas_rede: [{
      requestId: 'r2',
      url: '/api/next',
      metodo: 'GET',
      status: 204,
      timestamp_epoch_ms: 1200
    }]
  }]);

  const result = systemMap.finalize(map);
  assert.equal(result.pages.length, 1);
  assert.equal(result.elements.length, 2);
  assert.equal(result.actions.length, 2);
  assert.equal(result.network.length, 2);
  assert.equal(result.actions[0].network_refs[0], 'r1');
  assert.deepEqual(result.totals, {
    pages: 1, elements: 2, actions: 2, network: 2, flows: 0, diagnostics: 0
  });

  console.log('devtrail autonomous system map tests: ok');
})();
