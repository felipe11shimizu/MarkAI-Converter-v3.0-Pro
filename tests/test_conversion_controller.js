'use strict';
const assert = require('assert');
const Controller = require('../frontend/modules/conversion_controller.js');

(async () => {
  const items = [{ id: '1', name: 'a.txt', ext: 'txt', file: {} }, { id: '2', name: 'b.txt', ext: 'txt', file: {} }];
  const calls = [];
  const queue = {
    getById: id => items.find(x => x.id === id),
    getOrdered: () => items,
    update: (id, patch) => Object.assign(items.find(x => x.id === id), patch)
  };
  const markitdown = {
    isAvailable: async () => true,
    convert: async () => ({ markdown: '# remote', meta: { engine: 'test' } })
  };
  const parser = { parseBrowser: async () => '# local' };
  const quality = { metrics: x => ({ characters:x.length, lines:1, headings:1, tables:0, links:0 }), diffScore: () => 3 };
  const ui = {
    renderQueue(){}, setStatus(){}, setProgress(){}, loadMarkdown(md){ calls.push(['load',md]); },
    toast(){}, showProcessing(){}, hideProcessing(){}, setProcessingSub(){},
    showComparison(){ calls.push(['compare']); }
  };
  const controller = Controller.create({
    queueManager: queue, markItDownEngine: markitdown, fileParserStrategy: parser,
    conversionQuality: quality, getState: () => ({ mergeEngine: { merge: async () => ({markdown:'# merged',fileName:'merged.md'}) } }),
    setState: patch => calls.push(['state', patch]), ui, workspace: { scheduleSave() { calls.push(['save']); } }
  });
  const result = await controller.convertItem('1');
  assert.strictEqual(result, '# remote');
  assert.strictEqual(items[0].status, 'done');
  assert.ok(calls.some(x => x[0] === 'load'));
  await controller.convertAll();
  assert.strictEqual(items[1].status, 'done');
  console.log('conversion_controller tests passed');
})().catch(err => { console.error(err); process.exit(1); });
