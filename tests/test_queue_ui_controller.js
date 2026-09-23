'use strict';

const assert = require('node:assert/strict');
const QueueUIController = require('../frontend/modules/queue_ui_controller.js');

const calls = [];
const queue = [];
const timers = { setTimeout(fn) { calls.push('timer'); fn(); } };
const queueManager = {
  add(files) {
    const item = { id: 'q1', name: files[0].name, status: 'queued', result: '# resultado' };
    queue.push(item);
    return [item];
  },
  getOrdered() { return queue.slice(); },
  getById(id) { return queue.find(item => item.id === id) || null; },
  remove(id) { const i = queue.findIndex(item => item.id === id); if (i >= 0) queue.splice(i, 1); },
  clear() { queue.length = 0; }
};

const controller = {
  async convertItem(id) { calls.push('convert:' + id); },
  async convertAll() { calls.push('convertAll'); },
  async compareItem(id) { calls.push('compare:' + id); }
};
const mergeEngine = {
  async merge(progress) {
    progress(100, 'teste.md');
    return '# combinado';
  }
};
const workspaceController = {
  scheduleSave() { calls.push('save'); }
};

function button(id, ...classes) {
  return {
    dataset: { id },
    classList: { contains(name) { return classes.includes(name); } }
  };
}

const documentRef = {
  getElementById(id) {
    if (id === 'queueList') return { querySelectorAll() { return []; } };
    return null;
  }
};
const ui = {
  renderQueue() { calls.push('render'); },
  loadMarkdown(md, name) { calls.push(['load', md, name]); },
  showProcessing(label) { calls.push('show:' + label); },
  hideProcessing() { calls.push('hide'); },
  setStatus(text) { calls.push('status:' + text); },
  setProcessingSub(text) { calls.push('sub:' + text); },
  setEmptyState(empty) { calls.push('empty:' + empty); },
  toast(message, type) { calls.push(['toast', message, type]); }
};

const workspaceUi = QueueUIController.create({
  queueManager,
  conversionController: controller,
  mergeEngine,
  workspaceController,
  editorController: { previewItem(id) { calls.push('preview:' + id); } },
  getState: () => ({ queue }),
  ui,
  documentRef,
  windowRef: {},
  timers
});

assert.ok(workspaceUi);
assert.equal(typeof workspaceUi.bind, 'function');
assert.equal(typeof workspaceUi.onFilesSelected, 'function');
assert.equal(typeof workspaceUi.mergeAll, 'function');
assert.equal(typeof workspaceUi.convertAll, 'function');
assert.equal(typeof workspaceUi.handleQueueAction, 'function');

(async () => {
  workspaceUi.onFilesSelected([{ name: 'teste.md' }]);
  assert.equal(queue.length, 1);
  assert.ok(calls.includes('timer'));
  assert.ok(calls.includes('convert:q1'));
  assert.deepEqual(calls.slice(0, 2), ['save', 'render']);

  await workspaceUi.mergeAll();
  assert.ok(calls.includes('status:Fazendo merge…'));
  assert.ok(calls.includes('save'));
  assert.ok(calls.some(item => Array.isArray(item) && item[0] === 'load'));

  await workspaceUi.convertAll();
  assert.ok(calls.includes('convertAll'));

  workspaceUi.handleQueueAction({ target: { closest: () => button('q1', 'qi-btn-compare') } });
  assert.ok(calls.includes('compare:q1'));

  workspaceUi.handleQueueAction({ target: { closest: () => button('q1', 'qi-btn-preview') } });
  assert.ok(calls.includes('preview:q1'));

  workspaceUi.handleQueueAction({ target: { closest: () => button('q1', 'qi-btn-remove') } });
  assert.ok(calls.includes('empty:true'));
  assert.ok(calls.filter(call => call === 'save').length >= 2);

  console.log('queue_ui_controller module tests: ok');
})().catch(err => { console.error(err); process.exit(1); });
