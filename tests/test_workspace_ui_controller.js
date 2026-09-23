'use strict';

const assert = require('node:assert/strict');
const WorkspaceUIController = require('../frontend/modules/workspace_ui_controller.js');

const calls = [];
const store = {
  async listProjects() { return []; },
  async listVersions() { return []; }
};
const controller = {
  async listProjects() { calls.push('projects'); },
  async listHistory(mode) { calls.push('history:' + mode); },
  async createProject(name) { calls.push('create:' + name); },
  async renameProject() {},
  async deleteProject() {},
  async syncQueue() {},
  async saveVersion() {},
  async selectProject() {},
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

(async () => {
  await workspaceUi.openWorkspace();
  assert.deepEqual(calls, ['projects', 'history:versions']);
  console.log('workspace_ui_controller module tests: ok');
})();
