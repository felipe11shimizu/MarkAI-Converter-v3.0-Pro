(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MarkAIWorkspace = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

const WorkspaceStore = (() => {
  const DB_NAME = 'markai-workspace';
  const DB_VERSION = 1;
  const STORES = ['projects', 'documents', 'versions', 'aiHistory'];
  let dbPromise = null;

  function _id(prefix = 'id') {
    if (globalThis.crypto?.randomUUID) return prefix + '_' + globalThis.crypto.randomUUID();
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  }

  function _open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('documents')) {
          const s = db.createObjectStore('documents', { keyPath: 'id' });
          s.createIndex('projectId', 'projectId', { unique: false });
        }
        if (!db.objectStoreNames.contains('versions')) {
          const s = db.createObjectStore('versions', { keyPath: 'id' });
          s.createIndex('projectId', 'projectId', { unique: false });
          s.createIndex('documentId', 'documentId', { unique: false });
          s.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('aiHistory')) {
          const s = db.createObjectStore('aiHistory', { keyPath: 'id' });
          s.createIndex('projectId', 'projectId', { unique: false });
          s.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  function _request(store, mode, action) {
    return _open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const request = action(tx.objectStore(store));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  }

  async function all(store) {
    return _request(store, 'readonly', s => s.getAll());
  }

  async function get(store, id) {
    return _request(store, 'readonly', s => s.get(id));
  }

  async function put(store, value) {
    return _request(store, 'readwrite', s => s.put(value));
  }

  async function remove(store, id) {
    return _request(store, 'readwrite', s => s.delete(id));
  }

  async function byIndex(store, index, value) {
    return _request(store, 'readonly', s => s.index(index).getAll(value));
  }

  async function _deleteByIndex(store, index, value) {
    const records = await byIndex(store, index, value);
    await Promise.all(records.map(r => remove(store, r.id)));
  }

  async function init() {
    const projects = await all('projects');
    if (!projects.length) {
      const project = {
        id: _id('project'),
        name: 'Meu primeiro projeto',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        active: true
      };
      await put('projects', project);
      return project;
    }
    return projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  }

  async function listProjects() {
    return (await all('projects')).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  async function createProject(name) {
    const project = {
      id: _id('project'),
      name: String(name || 'Novo projeto').trim() || 'Novo projeto',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      active: true
    };
    await put('projects', project);
    return project;
  }

  async function updateProject(project) {
    project.updatedAt = Date.now();
    await put('projects', project);
    return project;
  }

  async function deleteProject(projectId) {
    await remove('projects', projectId);
    const [docs, versions, history] = await Promise.all([
      byIndex('documents', 'projectId', projectId),
      byIndex('versions', 'projectId', projectId),
      byIndex('aiHistory', 'projectId', projectId)
    ]);
    await Promise.all(docs.map(x => remove('documents', x.id)));
    await Promise.all(versions.map(x => remove('versions', x.id)));
    await Promise.all(history.map(x => remove('aiHistory', x.id)));
  }

  async function saveQueue(projectId, queue) {
    const oldDocs = await byIndex('documents', 'projectId', projectId);
    await Promise.all(oldDocs.map(x => remove('documents', x.id)));
    for (let index = 0; index < queue.length; index++) {
      const item = queue[index];
      await put('documents', {
        id: item.id,
        projectId,
        name: item.name,
        ext: item.ext,
        size: item.size || item.file?.size || 0,
        status: item.status,
        engine: item.engine || null,
        conversionMeta: item.conversionMeta || null,
        result: item.result || null,
        sourceType: item.sourceType || 'file',
        sourceUrl: item.sourceUrl || null,
        mergeMarker: item.mergeMarker !== false,
        file: item.file || null,
        order: index,
        updatedAt: Date.now()
      });
    }
    const project = await get('projects', projectId);
    if (project) await updateProject(project);
  }

  async function loadQueue(projectId) {
    const docs = await byIndex('documents', 'projectId', projectId);
    return docs.sort((a, b) => (a.order || 0) - (b.order || 0)).map(item => {
      let file = item.file;
      if (!(file instanceof File) && file instanceof Blob) {
        file = new File([file], item.name, { type: file.type || 'application/octet-stream' });
      }
      return {
        id: item.id, file, name: item.name, ext: item.ext, size: item.size,
        status: item.status || 'pending', result: item.result || null,
        engine: item.engine || null, conversionMeta: item.conversionMeta || null,
        sourceType: item.sourceType || 'file', sourceUrl: item.sourceUrl || null,
        mergeMarker: item.mergeMarker !== false
      };
    });
  }

  async function saveVersion(projectId, documentId, name, markdown, source = 'editor', prompt = '') {
    if (!markdown) return null;
    const version = {
      id: _id('version'), projectId, documentId: documentId || null,
      name: name || 'documento.md', markdown, source, prompt: prompt || '',
      createdAt: Date.now()
    };
    await put('versions', version);
    return version;
  }

  async function listVersions(projectId, documentId = null) {
    const records = await byIndex('versions', 'projectId', projectId);
    return records
      .filter(v => !documentId || v.documentId === documentId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async function saveAIHistory(projectId, input) {
    const item = {
      id: _id('ai'),
      projectId,
      createdAt: Date.now(),
      provider: input.provider || '',
      model: input.model || '',
      prompt: input.prompt || '',
      inputMarkdown: input.inputMarkdown || '',
      outputMarkdown: input.outputMarkdown || '',
      documentName: input.documentName || 'documento.md'
    };
    await put('aiHistory', item);
    return item;
  }

  async function listAIHistory(projectId) {
    return (await byIndex('aiHistory', 'projectId', projectId)).sort((a, b) => b.createdAt - a.createdAt);
  }

  async function exportProject(projectId) {
    const project = await get('projects', projectId);
    const [documents, versions, aiHistory] = await Promise.all([
      byIndex('documents', 'projectId', projectId),
      byIndex('versions', 'projectId', projectId),
      byIndex('aiHistory', 'projectId', projectId)
    ]);
    return {
      schema: 'markai-workspace/v1',
      exportedAt: new Date().toISOString(),
      project,
      documents: documents.map(d => ({
        id: d.id, name: d.name, ext: d.ext, size: d.size, status: d.status,
        engine: d.engine, conversionMeta: d.conversionMeta, result: d.result,
        sourceType: d.sourceType, sourceUrl: d.sourceUrl, mergeMarker: d.mergeMarker !== false
      })),
      versions,
      aiHistory
    };
  }

  return {
    init, listProjects, createProject, updateProject, deleteProject,
    saveQueue, loadQueue, saveVersion, listVersions, saveAIHistory,
    listAIHistory, exportProject
  };
})();



  return WorkspaceStore;
});