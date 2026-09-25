const assert = require('node:assert/strict');
const createNetwork = require('../extension/autonomous_network_capture.js');

(async () => {
  const listeners = [];
  const commands = [];
  const state = { active: true, tabId: 7, network: [] };
  const api = {
    debugger: {
      onEvent: { addListener(fn) { listeners.push(fn); } },
      async sendCommand(target, method, params) {
        commands.push({ target, method, params });
        return { body: '{"ok":true,"token":"secret"}' };
      }
    }
  };

  let clock = 1000;
  const capture = createNetwork.create(api, { state, now: () => clock });
  assert.equal(capture.install(), true);
  assert.equal(capture.install(), false);
  assert.equal(listeners.length, 1);

  listeners[0](
    { tabId: 7 },
    'Network.requestWillBeSent',
    {
      requestId: 'r1',
      request: {
        url: 'https://example.test/api/data',
        method: 'POST',
        postData: JSON.stringify({ user: 'ok', password: 'secret' }),
        headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' }
      }
    }
  );

  clock = 1100;
  listeners[0](
    { tabId: 7 },
    'Network.responseReceived',
    {
      requestId: 'r1',
      response: {
        url: 'https://example.test/api/data',
        status: 200,
        mimeType: 'application/json'
      }
    }
  );

  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(commands[0].method, 'Network.getResponseBody');
  assert.equal(state.network.length, 1);
  assert.equal(state.network[0].status, 200);
  assert.equal(state.network[0].method, 'POST');
  assert.equal(state.network[0].payload.password, '[REDACTED]');
  assert.equal(state.network[0].headers.Authorization, '[REDACTED]');
  assert.match(state.network[0].response_preview, /ok/);

  listeners[0](
    { tabId: 8 },
    'Network.requestWillBeSent',
    { requestId: 'wrong-tab', request: { url: 'https://example.test/ignored', method: 'GET' } }
  );
  assert.equal(state.network.length, 1);

  console.log('devtrail autonomous network capture tests: ok');
})();
