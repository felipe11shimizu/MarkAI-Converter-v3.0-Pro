'use strict';

const assert = require('node:assert/strict');
const WorkspaceStore = require('../frontend/modules/workspace_store.js');

async function main() {
  assert.ok(WorkspaceStore);
  const required = [
    'init', 'listProjects', 'createProject', 'updateProject', 'deleteProject',
    'saveQueue', 'loadQueue', 'saveVersion', 'listVersions', 'saveAIHistory',
    'listAIHistory', 'exportProject', 'importProject'
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

  assert.equal(typeof WorkspaceStore.importProject, 'function', 'importProject should be exported');
  await assert.rejects(
    WorkspaceStore.importProject({ schema: 'unknown/v9', project: { name: 'Invalid' } }),
    error => error instanceof TypeError && /incompatível/.test(error.message)
  );
  await assert.rejects(
    WorkspaceStore.importProject({ schema: 'markai-workspace/v1', project: { name: 'Invalid' }, documents: {} }),
    error => error instanceof TypeError && /listas/.test(error.message)
  );
  await assert.rejects(
    WorkspaceStore.importProject({ schema: 'markai-workspace/v1', project: { name: 'Invalid' }, documents: [{ id: 'x' }] }),
    error => error instanceof TypeError && /sem nome válido/.test(error.message)
  );
  await assert.rejects(
    WorkspaceStore.importProject({ schema: 'markai-workspace/v1', project: { name: 'Invalid' }, versions: [{ id: 'v1' }] }),
    error => error instanceof TypeError && /Markdown válido/.test(error.message)
  );
  await assert.rejects(
    WorkspaceStore.importProject({
      schema: 'markai-workspace/v1',
      project: { name: 'Invalid' },
      documents: [{ id: 'duplicate', name: 'one.md' }, { id: 'duplicate', name: 'two.md' }]
    }),
    error => error instanceof TypeError && /duplicados/.test(error.message)
  );
  await assert.rejects(
    WorkspaceStore.importProject({
      schema: 'markai-workspace/v1',
      project: { name: 'Invalid' },
      documents: [{ id: 'd1', name: 'one.md' }],
      versions: [],
      aiHistory: [],
      extra: 'x'.repeat(26 * 1024 * 1024) }),
    error => error instanceof RangeError && /25 MB/.test(error.message)
  );

  await assert.rejects(
    WorkspaceStore.importProject({
      schema: 'markai-workspace/v1',
      project: { name: 'Invalid' },
      versions: [{ markdown: '# Nota', prompt: { injected: true } }]
    }),
    error => error instanceof TypeError && /campo inválido na versão/.test(error.message)
  );
  await assert.rejects(
    WorkspaceStore.importProject({
      schema: 'markai-workspace/v1',
      project: { name: 'Invalid' },
      aiHistory: [{ prompt: ['not', 'a', 'string'] }]
    }),
    error => error instanceof TypeError && /campo inválido no histórico de IA/.test(error.message)
  );

  console.log('workspace_store module, queue validation and backup import validation tests: ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
