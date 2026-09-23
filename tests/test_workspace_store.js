'use strict';

const assert = require('node:assert/strict');

require('../frontend/modules/workspace_store.js');

assert.ok(global.MarkAIWorkspace);
const required = [
  'init',
  'listProjects',
  'createProject',
  'updateProject',
  'deleteProject',
  'saveQueue',
  'loadQueue',
  'saveVersion',
  'listVersions',
  'saveAIHistory',
  'listAIHistory',
  'exportProject'
];

for (const method of required) {
  assert.equal(typeof global.MarkAIWorkspace[method], 'function', method + ' should be exported');
}

console.log('workspace_store module tests: ok');
