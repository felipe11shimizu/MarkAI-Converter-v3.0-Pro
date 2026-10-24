'use strict';

const assert = require('node:assert/strict');
const WorkspaceUIController = require('../frontend/modules/workspace_ui_controller.js');

const calls = [];
const store = {
  async listProjects() { return []; },
  async listVersions() { return []; },
  async importProject() { return { project: { id: 'restored-1' }, documents: 2, versions: 1, aiHistory: 3 }; }
};
const controller = {
  async listProjects() { calls.push('projects'); },
  async listHistory(mode) { calls.push('history:' + mode); },
  async createProject(name) { calls.push('create:' + name); },
  async renameProject() {},
  async deleteProject() {},
  async syncQueue() {},
  async saveVersion() {},
  async selectProject(id) { calls.push('select:' + id); },
  async exportProject() { return { project: { name: 'Teste' }, documents: [], versions: [], aiHistory: [] }; }
};

const documentRef = {
  getElementById() { return null; }
};

const ui = {
  getHistoryMode: () => 'versions',
  toast: (message, type) => calls.push(['toast', message, type])
};

const workspaceUi = WorkspaceUIController.create({
  workspaceController: controller,
  workspaceStore: store,
  getState: () => ({ currentProjectId: 'p1' }),
  ui,
  documentRef
});

assert.ok(workspaceUi);
assert.equal(typeof workspaceUi.bind, 'function');
assert.equal(typeof workspaceUi.openWorkspace, 'function');
assert.equal(typeof workspaceUi.exportJson, 'function');
assert.equal(typeof workspaceUi.importJson, 'function');

(async () => {
  await workspaceUi.openWorkspace();
  assert.deepEqual(calls, ['projects', 'history:versions']);

  const importUi = WorkspaceUIController.create({
    workspaceController: controller,
    workspaceStore: store,
    getState: () => ({ currentProjectId: 'p1' }),
    ui,
    documentRef,
    windowRef: { confirm: () => true }
  });
  const input = {
    files: [{ size: 10, text: async () => JSON.stringify({ schema: 'markai-workspace/v1' }) }],
    value: 'backup.json'
  };
  await importUi.importJson({ target: input });
  assert.equal(input.value, '');
  assert.ok(calls.includes('select:restored-1'));
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'toast' && /Backup restaurado/.test(call[1])));
  console.log('workspace_ui_controller module tests: ok');
})();
