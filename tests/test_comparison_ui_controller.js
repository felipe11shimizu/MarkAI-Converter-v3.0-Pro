'use strict';
const assert = require('assert');
const Controller = require('../frontend/modules/comparison_ui_controller.js');

(() => {
  const calls = [];
  const items = [
    { id: '1', name: 'documento.txt', result: '# existente' },
    { id: '2', name: 'outro.txt', result: '# outro' }
  ];
  const queue = {
    getById: id => items.find(item => item.id === id),
    getOrdered: () => items,
    update: (id, patch) => Object.assign(items.find(item => item.id === id), patch)
  };
  const conversion = {
    compareItem: id => { calls.push(['compare', id]); return Promise.resolve({}); }
  };
  let state = {
    currentFileName: 'documento.md',
    compareState: { id: '1', markitdown: '# remote', browser: '# local' }
  };
  const ui = {
    renderQueue: () => calls.push(['render']),
    loadMarkdown: (md, name) => calls.push(['load', md, name]),
    toast: (message, type) => calls.push(['toast', message, type])
  };
  const controller = Controller.create({
    queueManager: queue,
    conversionController: conversion,
    getState: () => state,
    ui,
    elements: {}
  });

  controller.useResult('markitdown');
  assert.strictEqual(items[0].status, 'done');
  assert.strictEqual(items[0].result, '# remote');
  assert.strictEqual(items[0].engine, 'markitdown');
  assert.ok(calls.some(call => call[0] === 'load' && call[1] === '# remote'));

  controller.useResult('browser');
  assert.strictEqual(items[0].engine, 'browser');
  assert.strictEqual(items[0].result, '# local');

  controller.compareCurrent();
  assert.deepStrictEqual(calls.filter(call => call[0] === 'compare'), [['compare', '1']]);

  state.compareState = { id: 'missing', markitdown: '# remote', browser: '# local' };
  controller.useResult('markitdown');
  assert.ok(calls.some(call => call[0] === 'toast'));

  console.log('comparison_ui_controller tests passed');
})();
