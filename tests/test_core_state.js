'use strict';

const assert = require('node:assert/strict');

require('../frontend/modules/core_state.js');

assert.ok(global.MarkAICore);
assert.ok(global.MarkAICore.AppState);
assert.ok(global.MarkAICore.QueueManager);

const AppState = global.MarkAICore.AppState;
const QueueManager = global.MarkAICore.QueueManager;

assert.equal(AppState.get('currentFileName'), 'documento.md');
assert.deepEqual(AppState.get('queue'), []);

const file = { name: 'teste.md', size: 10 };
const added = QueueManager.add([file]);
assert.equal(added.length, 1);
assert.equal(QueueManager.getById(added[0].id).name, 'teste.md');
QueueManager.clear();
assert.deepEqual(AppState.get('queue'), []);

console.log('core_state module tests: ok');
