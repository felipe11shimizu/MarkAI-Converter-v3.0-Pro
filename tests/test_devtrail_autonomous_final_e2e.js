const assert = require('node:assert/strict');

global.DevTrailAutonomousNetworkCapture = require('../extension/autonomous_network_capture.js');
global.DevTrailAutonomousEventCorrelator = require('../extension/autonomous_event_correlator.js');
global.DevTrailAutonomousSystemMap = require('../extension/autonomous_system_map.js');
global.DevTrailAutonomousSystemMapMarkdown = require('../extension/autonomous_system_map_markdown.js');
global.DevTrailAutonomousPlanner = require('../extension/autonomous_planner.js');
global.DevTrailAutonomousExecutor = require('../extension/autonomous_executor.js');
global.DevTrailAutonomousDomScanner = require('../extension/autonomous_dom_scanner.js')();
global.DevTrailAutonomousCycle = require('../extension/autonomous_cycle.js');

const createAgent = require('../extension/autonomous_agent.js');

function createChromeMock() {
  const listeners = [];
  const detachListeners = [];
  const removedListeners = [];
  const commands = [];
  const messages = [];
  let inspectionCount = 0;

  return {
    runtime: { onMessage: { addListener(fn) { listeners.push(fn); } } },
    debugger: {
      onDetach: { addListener(fn) { detachListeners.push(fn); } },
      async attach() {},
      async sendCommand(target, method) {
        commands.push({ target, method });
      },
      async detach(target) {
        messages.push({ detached: target });
      }
    },
    tabs: {
      async get(id) { return { id, url: 'https://example.test/app' }; },
      sendMessage(tabId, message) { messages.push({ tabId, message }); return Promise.resolve(); },
      onRemoved: { addListener(fn) { removedListeners.push(fn); } }
    },
    scripting: {
      async executeScript(details) {
        const source = details.func.toString();
        if (source.includes('targetSelector')) {
          inspectionCount += 1;
          const before = inspectionCount === 1;
          return [{ result: {
            url: before ? 'https://example.test/app' : 'https://example.test/next',
            title: before ? 'App' : 'Next',
            targetPresent: true,
            targetTag: 'button',
            targetDisabled: false,
            targetTextLength: before ? 4 : 8,
            targetRect: { x: 10, y: 10, width: 100, height: 30 },
            bodyTextLength: before ? 20 : 32
          } }];
        }

        if (source.includes('querySelectorAll')) {
          return [{ result: {
            version: 1,
            capturedAt: new Date().toISOString(),
            page: {
              url: 'https://example.test/next',
              title: 'Next',
              viewport: { width: 1280, height: 720 }
            },
            counts: { interactive: 1, visible: 1, enabled: 1 },
            controls: [{
              index: 0,
              tag: 'button',
              type: 'button',
              role: null,
              text: 'Continue',
              ariaLabel: null,
              id: 'next',
              name: null,
              placeholder: null,
              selector: '#next',
              href: null,
              disabled: false,
              visible: true
            }]
          } }];
        }

        return [{ result: { ok: true, code: 'CLICK_TRIGGERED' } }];
      }
    },
    crypto: { randomUUID: () => 'e2e-session' },
    __listeners: listeners,
    __detachListeners: detachListeners,
    __removedListeners: removedListeners,
    __commands: commands,
    __messages: messages
  };
}

(async () => {
  const chrome = createChromeMock();
  const agent = createAgent(chrome);
  agent.install();

  let response;
  const handled = agent.onMessage(
    { type: agent.MESSAGE.START, payload: { targetTabId: 42, limits: { maxCycles: 2, maxActionsTotal: 3, maxSessionMs: 5000 } } },
    { tab: { id: 99 } },
    value => { response = value; }
  );
  assert.equal(handled, true);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(response.ok, true);
  assert.equal(agent.state.active, true);
  assert.equal(chrome.__commands.map(x => x.method).join(','), 'Network.enable,Runtime.enable,Page.enable');

  let mapResponse;
  const mapHandled = agent.onMessage(
    {
      type: agent.MESSAGE.BUILD_MAP,
      payload: {
        domSnapshot: {
          page: { url: 'https://example.test/app', title: 'App', viewport: { width: 1280, height: 720 } },
          counts: { interactive: 1, visible: 1, enabled: 1 },
          controls: [{
            index: 0, tag: 'button', type: 'button', text: 'Next',
            selector: '#next', disabled: false, visible: true
          }]
        }
      }
    },
    { tab: { id: 99 } },
    value => { mapResponse = value; }
  );
  assert.equal(mapHandled, false);
  assert.equal(mapResponse.ok, true);
  assert.equal(mapResponse.map.totals.pages, 1);
  assert.equal(mapResponse.map.totals.elements, 1);

  const cycle = await new Promise(resolve => {
    agent.onMessage(
      {
        type: agent.MESSAGE.CYCLE,
        payload: {
          targetTabId: 42,
          options: {
            execute: true,
            executor: { maxActions: 1, validationDelayMs: 0 }
          }
        }
      },
      { tab: { id: 99 } },
      resolve
    );
  });

  assert.equal(cycle.ok, true);
  assert.equal(cycle.plan.actions.length, 1);
  assert.equal(cycle.plan.actions[0].selector, '#next');
  assert.equal(cycle.execution.executed, 1);
  assert.equal(cycle.execution.results[0].ok, true);
  assert.equal(cycle.snapshot.ok, true);
  assert.equal(cycle.snapshot.map.page.url, 'https://example.test/next');
  assert.equal(cycle.limits.cyclesExecuted, 1);
  assert.equal(cycle.limits.actionsExecuted, 1);

  const kill = await new Promise(resolve => {
    agent.onMessage(
      { type: agent.MESSAGE.KILL, payload: { reason: 'e2e-finished' } },
      { tab: { id: 99 } },
      resolve
    );
  });

  assert.equal(kill.ok, true);
  assert.equal(agent.state.active, false);
  assert.equal(agent.state.phase, agent.PHASE.IDLE);

  console.log('devtrail autonomous final e2e: ok');
})();
