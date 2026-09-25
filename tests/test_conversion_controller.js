'use strict';
const assert = require('assert');
const Controller = require('../frontend/modules/conversion_controller.js');

(async () => {
  const items = [
    { id: '1', name: 'a.txt', ext: 'txt', file: {} },
    { id: '2', name: 'b.txt', ext: 'txt', file: {} },
    { id: '3', name: 'apresentacao.pptx', ext: 'pptx', file: {} }
  ];
  const calls = [];
  const queue = {
    getById: id => items.find(x => x.id === id),
    getOrdered: () => items,
    update: (id, patch) => Object.assign(items.find(x => x.id === id), patch)
  };
  const markitdown = {
    isAvailable: async () => true,
    convert: async () => ({ markdown: '# remote', meta: { engine: 'test' } }),
    deepExtract: async () => ({ markdown: '# OCR profundo', meta: { engine: 'markitdown-ocr-deep', mode: 'deep-ocr-ai' } })
  };
  const parser = { parseBrowser: async () => '# local' };
  let mergeOptions = null;
  const quality = { metrics: x => ({ characters:x.length, lines:1, headings:1, tables:0, links:0 }), diffScore: () => 3 };
  const ui = {
    renderQueue(){}, setStatus(){}, setProgress(){}, loadMarkdown(md){ calls.push(['load',md]); },
    toast(){}, showProcessing(){}, hideProcessing(){}, setProcessingSub(){},
    showComparison(){ calls.push(['compare']); }
  };
  const controller = Controller.create({
    queueManager: queue, markItDownEngine: markitdown, fileParserStrategy: parser,
    conversionQuality: quality, mergeEngine: { merge: async (_progress, options) => { mergeOptions = options; return '# merged'; } }, getState: () => ({}),
    setState: patch => calls.push(['state', patch]), ui, workspace: { scheduleSave() { calls.push(['save']); } }
  });
  const deepResult = await controller.deepExtractItem('3');
  assert.strictEqual(deepResult, '# OCR profundo');
  assert.strictEqual(items[2].engine, 'markitdown-ocr-deep');
  assert.strictEqual(items[2].extractionMode, 'deep-ocr-ai');

  const result = await controller.convertItem('1');
  assert.strictEqual(result, '# remote');
  assert.strictEqual(items[0].status, 'done');
  assert.ok(calls.some(x => x[0] === 'load'));
  await controller.convertAll();
  assert.strictEqual(items[1].status, 'done');

  const compareResult = await controller.compareItem('3');
  assert.deepStrictEqual(compareResult, { markitdown: '# remote', browser: '# local', diff: 3 });
  assert.ok(calls.some(x => x[0] === 'compare'));

  const mergeResult = await controller.mergeAll({ markFiles: false });
  assert.deepStrictEqual(mergeResult, { markdown: '# merged', fileName: 'documento_combinado.md' });
  assert.ok(calls.some(x => x[0] === 'load' && x[1] === '# merged'));
  assert.ok(calls.some(x => x[0] === 'save'));
  assert.deepStrictEqual(mergeOptions, { markFiles: false });
  console.log('conversion_controller tests passed');
})().catch(err => { console.error(err); process.exit(1); });
