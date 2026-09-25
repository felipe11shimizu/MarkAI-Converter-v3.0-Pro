const assert = require('node:assert/strict');
const createAgent = require('../extension/autonomous_agent.js');

function createChromeMock() {
  const listeners = [];
  const detachListeners = [];
  const removedListeners = [];
  const attached = [];
  const commands = [];
  const messages = [];

  return {
    runtime: { onMessage: { addListener(fn) { listeners.push(fn); } } },
    debugger: {
      onDetach: { addListener(fn) { detachListeners.push(fn); } },
      async attach(target, version) { attached.push({ target, version }); },
      async sendCommand(target, method) { commands.push({ target, method }); },
      async detach(target) { attached.push({ detached: target }); }
    },
    tabs: {
      async get(id) { return { id, url: 'https://example.test/app' }; },
      sendMessage(tabId, message) { messages.push({ tabId, message }); return Promise.resolve(); },
      onRemoved: { addListener(fn) { removedListeners.push(fn); } }
    },
    crypto: { randomUUID: () => 'test-session' },
    __listeners: listeners,
    __detachListeners: detachListeners,
    __removedListeners: removedListeners,
    __attached: attached,
    __commands: commands,
    __messages: messages
  };
}

(async () => {
  const chrome = createChromeMock();
  const agent = createAgent(chrome);

  assert.equal(agent.install(), true);
  assert.equal(agent.install(), false);
  assert.equal(chrome.__listeners.length, 1, 'message listener must be installed once');

  let response;
  const handled = agent.onMessage(
    { type: agent.MESSAGE.START, payload: { targetTabId: 42 } },
    { tab: { id: 99 } },
    value => { response = value; }
  );
  assert.equal(handled, true);
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(response.ok, true);
  assert.equal(agent.state.active, true);
  assert.equal(agent.state.tabId, 42);
  assert.equal(agent.state.phase, agent.PHASE.READY);
  assert.equal(agent.state.limits.maxSessionMs, 15 * 60 * 1000);
  assert.equal(agent.state.limits.maxCycles, 10);
  assert.equal(agent.state.limits.maxActionsTotal, 50);
  assert.equal(chrome.__commands.map(x => x.method).join(','), 'Network.enable,Runtime.enable,Page.enable');

  let status;
  agent.onMessage(
    { type: agent.MESSAGE.STATUS },
    { tab: { id: 99 } },
    value => { status = value; }
  );
  assert.equal(status.ok, true);
  assert.equal(status.state.sessionId, 'test-session');

  const killed = await agent.onMessage(
    { type: agent.MESSAGE.KILL, payload: { reason: 'test-kill' } },
    { tab: { id: 99 } },
    value => { response = value; }
  );
  assert.equal(killed, true);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(response.ok, true);
  assert.equal(agent.state.active, false);

  const restarted = await agent.start({ targetTabId: 42, limits: { maxCycles: 2, maxActionsTotal: 3, maxSessionMs: 5000 } }, { tab: { id: 99 } });
  assert.equal(restarted.ok, true);
  assert.equal(agent.state.limits.maxCycles, 2);
  assert.equal(agent.state.limits.maxActionsTotal, 3);
  assert.equal(agent.state.limits.maxSessionMs, 5000);

  const stopped = await agent.stop('test');
  assert.equal(stopped.ok, true);
  assert.equal(agent.state.active, false);
  assert.equal(agent.state.phase, agent.PHASE.IDLE);

  const invalid = await agent.start({ targetTabId: 42 }, { tab: { id: 99 } });
  assert.equal(invalid.ok, true);

  const second = await agent.start({ targetTabId: 43 }, { tab: { id: 99 } });
  assert.equal(second.ok, false);
  assert.equal(second.code, 'AUTONOMOUS_SESSION_ACTIVE');
  await agent.stop('cleanup');

  const attachFailure = createChromeMock();
  attachFailure.debugger.attach = async () => { throw new Error('already attached'); };
  const attachFailing = createAgent(attachFailure);
  const attachFailureResult = await attachFailing.start({ targetTabId: 7 }, { tab: { id: 8 } });
  assert.equal(attachFailureResult.code, 'CDP_ATTACH_FAILED');
  assert.equal(attachFailure.__attached.some(x => x.detached), false, 'must not detach a debugger owned by another mode');

  const chromeFailure = createChromeMock();
  chromeFailure.debugger.sendCommand = async () => { throw new Error('blocked'); };
  const failing = createAgent(chromeFailure);
  const failure = await failing.start({ targetTabId: 1 }, { tab: { id: 2 } });
  assert.equal(failure.ok, false);
  assert.equal(failure.code, 'CDP_ATTACH_FAILED');
  assert.equal(failing.state.active, false);
  assert.ok(chromeFailure.__attached.some(x => x.detached));

  console.log('devtrail autonomous agent tests: ok');
})();
