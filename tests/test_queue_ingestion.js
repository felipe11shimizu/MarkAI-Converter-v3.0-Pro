'use strict';

const assert = require('node:assert/strict');
const QueueUIController = require('../frontend/modules/queue_ui_controller.js');

function element() {
  const listeners = {};
  return {
    classList: {
      added: false,
      add() { this.added = true; },
      remove() { this.added = false; }
    },
    addEventListener(type, handler) { listeners[type] = handler; },
    dispatch(type, event = {}) { listeners[type]?.(event); },
    click() {},
    value: ''
  };
}

function createHarness() {
  const calls = [];
  const queue = [];
  const elements = {
    dropZone: element(),
    fileInput: element(),
    browseBtn: element(),
    btnClearQueue: element(),
    btnMergeAll: element(),
    btnDownloadZip: element(),
    btnConvertAll: element(),
    queueList: element()
  };

  const queueManager = {
    add(files) {
      const items = Array.from(files).map((file, index) => ({
        id: 'q' + (queue.length + index + 1),
        name: file.name,
        status: 'queued'
      }));
      queue.push(...items);
      calls.push(['add', ...items.map(item => item.name)]);
      return items;
    },
    getOrdered() { return queue.slice(); },
    getById(id) { return queue.find(item => item.id === id) || null; },
    remove() {},
    clear() {}
  };

  const controller = QueueUIController.create({
    queueManager,
    conversionController: {
      async convertItem(id) { calls.push(['convert', id]); }
    },
    workspaceController: {
      scheduleSave() { calls.push(['save']); }
    },
    getState: () => ({ queue }),
    ui: {
      renderQueue() { calls.push(['render']); },
      toast(message, type) { calls.push(['toast', message, type]); }
    },
    documentRef: {
      getElementById(id) { return elements[id] || null; }
    },
    timers: {
      setTimeout(fn) { fn(); }
    }
  });

  controller.bind();
  return { calls, queue, elements };
}

// Drop-zone ingestion must use the centralized onFilesSelected path.
{
  const { calls, queue, elements } = createHarness();

  elements.dropZone.dispatch('drop', {
    preventDefault() {},
    dataTransfer: { files: [{ name: 'arrastado.md' }] }
  });

  assert.equal(queue.length, 1);
  assert.deepEqual(calls.slice(0, 4), [
    ['add', 'arrastado.md'],
    ['save'],
    ['render'],
    ['toast', '1 arquivo(s) adicionado(s) à fila.', 'success']
  ]);
  assert.deepEqual(calls.at(-1), ['convert', 'q1']);
}

// File-picker activation must preserve the native <label for="fileInput">
// contract. The controller must not replace the browser's activation with
// showPicker()/click(), because mobile browsers need to dispatch the native
// file-input change event after selection.
{
  const { elements } = createHarness();
  let preventDefaultCalls = 0;
  let stopPropagationCalls = 0;
  elements.browseBtn.dispatch('click', {
    preventDefault() { preventDefaultCalls += 1; },
    stopPropagation() { stopPropagationCalls += 1; }
  });
  assert.equal(preventDefaultCalls, 0);
  assert.equal(stopPropagationCalls, 1);
}

// File-picker ingestion must use the same centralized path.
{
  const { calls, queue, elements } = createHarness();
  const fileInput = {
    files: [{ name: 'selecionado.md' }],
    value: ''
  };

  elements.fileInput.dispatch('change', { target: fileInput });

  assert.equal(queue.length, 1);
  assert.deepEqual(calls.slice(0, 4), [
    ['add', 'selecionado.md'],
    ['save'],
    ['render'],
    ['toast', '1 arquivo(s) adicionado(s) à fila.', 'success']
  ]);
  assert.equal(fileInput.value, '');
  assert.deepEqual(calls.at(-1), ['convert', 'q1']);
}

// Selecting multiple files in one native FileList must enqueue every file,
// not just the first entry.
{
  const { calls, queue, elements } = createHarness();
  const fileInput = {
    files: [
      { name: 'primeiro.md' },
      { name: 'segundo.pdf' },
      { name: 'terceiro.docx' }
    ],
    value: ''
  };

  elements.fileInput.dispatch('change', { target: fileInput });

  assert.equal(queue.length, 3);
  assert.deepEqual(queue.map(item => item.name), [
    'primeiro.md',
    'segundo.pdf',
    'terceiro.docx'
  ]);
  assert.deepEqual(calls.slice(0, 4), [
    ['add', 'primeiro.md', 'segundo.pdf', 'terceiro.docx'],
    ['save'],
    ['render'],
    ['toast', '3 arquivo(s) adicionado(s) à fila.', 'success']
  ]);
  assert.deepEqual(
    calls.filter(call => call[0] === 'convert').map(call => call[1]),
    ['q1', 'q2', 'q3']
  );
  assert.equal(fileInput.value, '');
}

console.log('queue ingestion integration tests: ok');
