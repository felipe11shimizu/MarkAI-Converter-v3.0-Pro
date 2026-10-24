'use strict';

const assert = require('node:assert/strict');
const WorkspaceStore = require('../frontend/modules/workspace_store.js');

async function main() {
  assert.ok(WorkspaceStore);
  const required = [
    'init', 'listProjects', 'createProject', 'updateProject', 'deleteProject',
    'saveQueue', 'loadQueue', 'saveVersion', 'listVersions', 'saveAIHistory',
    'listAIHistory', 'exportProject'
  ];
  for (const method of required) {
    assert.equal(typeof WorkspaceStore[method], 'function', method + ' should be exported');
  }

  await assert.rejects(
    WorkspaceStore.saveQueue('project-1', [{ id: 'same' }, { id: 'same' }]),
    error => error instanceof TypeError && /duplicados/.test(error.message)
  );
  await assert.rejects(
    WorkspaceStore.saveQueue('project-1', [{ name: 'missing-id' }]),
    error => error instanceof TypeError && /identificador válido/.test(error.message)
  );
  await assert.rejects(
    WorkspaceStore.saveQueue('project-1', null),
    error => error instanceof TypeError && /lista/.test(error.message)
  );

  console.log('workspace_store module and queue validation tests: ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
