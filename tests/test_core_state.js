'use strict';

const assert = require('node:assert/strict');

require('../frontend/modules/core_state.js');
require('../frontend/modules/markitdown_engine.js');

assert.ok(global.MarkAICore);
assert.ok(global.MarkAICore.AppState);
assert.ok(global.MarkAICore.QueueManager);
assert.ok(global.MarkAIConversion);
assert.ok(global.MarkAIConversion.MarkItDownEngine);

const AppState = global.MarkAICore.AppState;
const QueueManager = global.MarkAICore.QueueManager;

assert.equal(AppState.get('currentFileName'), 'documento.md');
assert.deepEqual(AppState.get('queue'), []);

const file = { name: 'teste.md', size: 10 };
const added = QueueManager.add([file, { name: 'outro.pdf', size: 20 }, { name: 'terceiro.docx', size: 30 }]);
assert.equal(added.length, 3);
assert.equal(QueueManager.getById(added[0].id).name, 'teste.md');
assert.equal(QueueManager.getById(added[0].id).mergeMarker, true);

QueueManager.move(added[2].id, 'up');
assert.deepEqual(QueueManager.getOrdered().map(item => item.name), ['teste.md', 'terceiro.docx', 'outro.pdf']);

QueueManager.reorder([added[1].id, added[0].id, added[2].id]);
assert.deepEqual(QueueManager.getOrdered().map(item => item.name), ['outro.pdf', 'teste.md', 'terceiro.docx']);

QueueManager.clear();
assert.deepEqual(AppState.get('queue'), []);

console.log('core_state module tests: ok');
