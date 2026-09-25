const assert = require('node:assert/strict');
const correlator = require('../extension/autonomous_event_correlator.js');

(() => {
  const domEvents = [
    {
      event_id: 'click-1',
      tipo_evento: 'click',
      timestamp_epoch_ms: 1000,
      elemento: '#submit',
      url: 'https://example.test/form'
    },
    {
      event_id: 'click-2',
      tipo_evento: 'click',
      timestamp_epoch_ms: 10000,
      elemento: '#other'
    }
  ];

  const networkEvents = [
    { requestId: 'r1', url: '/api/save', method: 'POST', status: 200, timestamp_epoch_ms: 1200 },
    { requestId: 'r2', url: '/api/ignored-before', method: 'GET', status: 200, timestamp_epoch_ms: 900 },
    { requestId: 'r3', url: '/api/ignored-after', method: 'GET', status: 200, timestamp_epoch_ms: 7001 },
    { requestId: 'r4', url: '/api/next', method: 'GET', status: 204, timestamp_epoch_ms: 10200 }
  ];

  const steps = correlator.correlate(domEvents, networkEvents);

  assert.equal(steps.length, 2);
  assert.equal(steps[0].step_id, 1);
  assert.equal(steps[0].chamadas_rede.length, 1);
  assert.equal(steps[0].chamadas_rede[0].requestId, 'r1');
  assert.equal(steps[1].chamadas_rede.length, 1);
  assert.equal(steps[1].chamadas_rede[0].requestId, 'r4');

  const summary = correlator.summarize(steps);
  assert.deepEqual(summary, {
    total_steps: 2,
    steps_with_network: 2,
    total_network_calls: 2
  });

  const limited = correlator.correlate(
    [{ tipo_evento: 'click', timestamp_epoch_ms: 1000 }],
    [
      { requestId: 'a', timestamp_epoch_ms: 1100 },
      { requestId: 'b', timestamp_epoch_ms: 1200 }
    ],
    { windowMs: 300, maxNetworkPerEvent: 1 }
  );

  assert.equal(limited[0].chamadas_rede.length, 1);
  assert.equal(limited[0].chamadas_rede[0].requestId, 'a');

  console.log('devtrail autonomous event correlator tests: ok');
})();
