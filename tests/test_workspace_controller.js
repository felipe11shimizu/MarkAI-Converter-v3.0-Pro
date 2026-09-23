'use strict';

const assert = require('node:assert/strict');
const WorkspaceController = require('../frontend/modules/workspace_controller.js');

function makeStore() {
  let projectSeq = 0;
  const projects = [{
    id: 'p1', name: 'Projeto 1', createdAt: 1, updatedAt: 1
  }];
  const queues = { p1: [] };
  const versions = { p1: [] };
  return {
    projects,
    queues,
    versions,
    async init() { return projects[0]; },
    async listProjects() { return projects.map(p => ({ ...p })); },
    async createProject(name) {
      const project = { id: 'p' + (++projectSeq + 1), name, createdAt: 2, updatedAt: 2 };
      projects.push(project);
      queues[project.id] = [];
      versions[project.id] = [];
      return project;
    },
    async updateProject(project) {
      const index = projects.findIndex(p => p.id === project.id);
      projects[index] = { ...project };
      return projects[index];
    },
    async deleteProject(id) {
      const index = projects.findIndex(p => p.id === id);
      if (index >= 0) projects.splice(index, 1);
      delete queues[id];
      delete versions[id];
    },
    async saveQueue(id, queue) { queues[id] = queue.slice(); },
    async loadQueue(id) { return (queues[id] || []).slice(); },
    async saveVersion(id, documentId, name, markdown, source) {
      const version = { id: 'v1', projectId: id, documentId, name, markdown, source, createdAt: 3 };
      versions[id].push(version);
      return version;
    },
    async listVersions(id) { return (versions[id] || []).slice(); },
    async listAIHistory() { return []; },
    async exportProject(id) { return { project: projects.find(p => p.id === id), documents: [], versions: versions[id] || [], aiHistory: [] }; }
  };
}

const store = makeStore();
const state = {
  currentProjectId: 'p1',
  queue: [{ id: 'doc1', name: 'a.txt', status: 'done', result: '# A' }],
  currentMd: '# A',
  currentFileName: 'a.md'
};
const events = [];
const controller = WorkspaceController.create({
  workspaceStore: store,
  getState: () => ({ ...state }),
  setState: patch => Object.assign(state, patch),
  ui: {
    setWorkspaceStatus: text => events.push(['status', text]),
    renderQueue: () => events.push(['queue']),
    refreshProjects: projects => events.push(['projects', projects.length]),
    renderHistory: records => events.push(['history', records.length]),
    toast: (message, type) => events.push(['toast', message, type]),
    showCurrentDocument: item => events.push(['document', item.id]),
    showEmptyWorkspace: () => events.push(['empty'])
  },
  timers: {
    setTimeout: fn => { events.push(['timer']); return { fn }; },
    clearTimeout: () => {}
  }
});

(async () => {
  const project = await controller.init();
  assert.equal(project.id, 'p1');
  assert.equal(state.currentProjectId, 'p1');
  assert.deepEqual(store.queues.p1, []);
  
  state.queue = [{ id: 'doc2', name: 'b.txt', status: 'pending' }];
  await controller.syncQueue();
  assert.equal(store.queues.p1.length, 1);

  const created = await controller.createProject('Novo');
  assert.equal(state.currentProjectId, created.id);
  assert.deepEqual(state.queue, []);

  await controller.renameProject(created.id, 'Renomeado');
  assert.equal((await store.listProjects()).find(p => p.id === created.id).name, 'Renomeado');

  state.currentMd = '# Documento';
  state.currentFileName = 'doc.md';
  const version = await controller.saveVersion('manual');
  assert.equal(version.markdown, '# Documento');

  const exported = await controller.exportProject(created.id);
  assert.equal(exported.project.name, 'Renomeado');

  await controller.deleteProject(created.id);
  assert.equal(state.currentProjectId, 'p1');

  controller.scheduleSave();
  assert.ok(events.some(e => e[0] === 'timer'));
  console.log('workspace_controller module tests: ok');
})();
