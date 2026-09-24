'use strict';

const assert = require('node:assert/strict');
const controllerModule = require('../frontend/modules/devtrail_controller.js');

const listeners = {};
const messages = [];
const fakeWindow = {
  innerWidth: 1920,
  innerHeight: 1080,
  addEventListener(type, fn) { listeners[type] = fn; },
  postMessage(message) { messages.push(message); }
};
const elements = {
  timer: { textContent: '' },
  status: { textContent: '' },
  start: { disabled: false, addEventListener() {} },
  pause: { disabled: false, textContent: '', addEventListener() {} },
  stop: { disabled: false, addEventListener() {} },
  refresh: { addEventListener() {} },
  exportJson: { disabled: false, addEventListener() {} },
  exportMd: { disabled: false, addEventListener() {} },
  extensionStatus: { textContent: '' }
};
let now = 0;
const ctl = controllerModule.create({
  elements,
  formatters: { convertJsonToMarkdown: () => '# ok' },
  windowObj: fakeWindow,
  documentObj: { createElement: () => ({ click() {} }) },
  clock: () => now,
  setIntervalImpl: () => 1,
  clearIntervalImpl: () => {},
  setTimeoutImpl: () => {}
});
ctl.bind();
assert.equal(messages[0].type, 'DEVTRAIL_PING');
assert.equal(messages[1].type, 'DEVTRAIL_LIST_TABS');

listeners.message({ source: fakeWindow, data: { source: 'markai-devtrail', type: 'DEVTRAIL_TABS', payload: { tabs: [{ id: 10, title: 'Teste', url: 'https://example.test' }] } } });
elements.start.addEventListener = (type, fn) => { if (type === 'click') elements.startHandler = fn; };
assert.equal(ctl.getState().status, 'idle');

console.log('devtrail controller tests: ok');
