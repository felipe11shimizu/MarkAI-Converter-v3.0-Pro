'use strict';

const assert = require('node:assert/strict');
const { create } = require('../frontend/modules/merge_engine.js');

assert.equal(typeof create, 'function');

const updates = [];
const renders = [];
const queue = [
  { id: '1', name: 'a.txt', result: '# A', status: 'done' },
  { id: '2', name: 'b.txt', result: null, status: 'pending' }
];

const engine = create({
  queueManager: {
    getOrdered: () => queue,
    update: (id, patch) => {
      const item = queue.find(x => x.id === id);
      Object.assign(item, patch);
      updates.push({ id, patch });
    }
  },
  fileParserStrategy: { parse: async () => 'B convertido' },
  renderQueue: () => renders.push(true)
});

(async () => {
  const progress = [];
  const output = await engine.merge((value, name) => progress.push([value, name]));
  assert.match(output, /MARKAI:FILE_START/);
  assert.match(output, /## Arquivo 1 de 2 — a\.txt/);
  assert.match(output, /# A/);
  assert.match(output, /## Arquivo 2 de 2 — b\.txt/);
  assert.match(output, /B convertido/);
  assert.equal(queue[1].status, 'done');
  assert.equal(queue[1].result, 'B convertido');
  assert.match(output, /MARKAI:FILE_END/);
  assert.ok(updates.length >= 2);
  assert.equal(renders.length, 2);
  assert.equal(progress.length, 4);

  const unmarked = await engine.merge(null, { markFiles: false });
  assert.doesNotMatch(unmarked, /MARKAI:FILE_START/);
  await assert.rejects(
    create({ queueManager: { getOrdered: () => [], update: () => {} }, fileParserStrategy: { parse: async () => '' } }).merge(),
    /Fila vazia/
  );
  console.log('merge_engine module tests: ok');
})();
