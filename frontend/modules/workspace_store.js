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
      let settled = false;
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
      request.onsuccess = () => {
        settled = true;
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        dbPromise = null;
        reject(request.error || new Error('Falha ao abrir o banco IndexedDB.'));
      };
      request.onblocked = () => {
        dbPromise = null;
        if (!settled) reject(new Error('Atualização do banco bloqueada por outra aba. Feche outras abas do MarkAI e tente novamente.'));
      };
    });
    return dbPromise;
  }

  function _transaction(stores, mode, action) {
    return _open().then(db => new Promise((resolve, reject) => {
      let result;
      let finished = false;
      let tx;
      try {
        tx = db.transaction(stores, mode);
        result = action(tx);
      } catch (error) {
        try { tx?.abort(); } catch (_) {}
        reject(error);
        return;
      }
      tx.oncomplete = () => {
        finished = true;
        resolve(result);
      };
      tx.onerror = () => {
        if (finished) return;
        finished = true;
        reject(tx.error || new Error('Transação IndexedDB falhou.'));
      };
      tx.onabort = () => {
        if (finished) return;
        finished = true;
        reject(tx.error || new Error('Transação IndexedDB foi cancelada.'));
      };
    }));
  }

  function _request(store, mode, action) {
    return _transaction(store, mode, tx => {
      const result = { value: undefined };
      const request = action(tx.objectStore(store));
      request.onsuccess = () => { result.value = request.result; };
      return result;
    }).then(result => result.value);
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
    await _transaction(['projects', 'documents', 'versions', 'aiHistory'], 'readwrite', tx => {
      tx.objectStore('projects').delete(projectId);
      for (const storeName of ['documents', 'versions', 'aiHistory']) {
        const store = tx.objectStore(storeName);
        const request = store.index('projectId').getAll(projectId);
        request.onsuccess = () => {
          try {
            for (const record of request.result || []) store.delete(record.id);
          } catch (error) {
            try { tx.abort(); } catch (_) {}
          }
        };
      }
    });
  }

  async function saveQueue(projectId, queue) {
    if (!Array.isArray(queue)) throw new TypeError('A fila precisa ser uma lista.');
    const ids = new Set();
    for (const item of queue) {
      if (!item || typeof item.id !== 'string' || !item.id.trim()) {
        throw new TypeError('Cada item da fila precisa ter um identificador válido.');
      }
      if (ids.has(item.id)) throw new TypeError('A fila contém identificadores duplicados: ' + item.id);
      ids.add(item.id);
    }

    // Replaces the queue atomically: if any write fails (including quota), the
    // browser rolls back deletes and writes together, preserving the previous queue.
    await _transaction(['documents', 'projects'], 'readwrite', tx => {
      const documents = tx.objectStore('documents');
      const projectStore = tx.objectStore('projects');
      const oldRequest = documents.index('projectId').getAll(projectId);
      oldRequest.onsuccess = () => {
        try {
          for (const old of oldRequest.result || []) documents.delete(old.id);
          const now = Date.now();
          queue.forEach((item, index) => {
            documents.put({
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
              updatedAt: now
            });
          });
          const projectRequest = projectStore.get(projectId);
          projectRequest.onsuccess = () => {
            if (projectRequest.result) {
              const project = projectRequest.result;
              project.updatedAt = now;
              projectStore.put(project);
            }
          };
        } catch (error) {
          try { tx.abort(); } catch (_) {}
        }
      };
    });
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