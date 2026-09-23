'use strict';

const assert = require('node:assert/strict');

const WorkspaceStore = require('../frontend/modules/workspace_store.js');

assert.ok(WorkspaceStore);
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
  assert.equal(typeof WorkspaceStore[method], 'function', method + ' should be exported');
}

console.log('workspace_store module tests: ok');

