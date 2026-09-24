/**
 * MarkAI Converter — core frontend state modules
 * Extracted from the legacy script to establish explicit module boundaries.
 */
(function (root) {
  'use strict';

// ══════════════════════════════════════════════
// 1. APP STATE — Proxy-based reactive store
// ══════════════════════════════════════════════
const AppState = (() => {
  const _watchers = {};
  const _state = {
    queue: [],          // [{ id, file, name, ext, size, status, result }]
    currentMd: '',
    currentFileName: 'documento.md',
    activePanel: 'panelRaw',
    settings: {
      aiProvider: 'gemini',
      aiModel: 'gemini-1.5-flash',
      apiKey: '',
      markitdownEnabled: true,
      markitdownEndpoint: getDefaultBackendEndpoint(),
      syntaxHL: true,
      autoPreview: true,
    },
    previewItemId: null,
    compareState: null,
    currentProjectId: null,
  };

  const proxy = new Proxy(_state, {
    set(target, key, value) {
      target[key] = value;
      if (_watchers[key]) _watchers[key].forEach(fn => fn(value));
      return true;
    }
  });

  function on(key, fn) {
    if (!_watchers[key]) _watchers[key] = [];
    _watchers[key].push(fn);
  }

  function get(key) { return proxy[key]; }
  function set(key, value) { proxy[key] = value; }

  function getDefaultBackendEndpoint() {
    const configured = globalThis.MARKAI_CONFIG?.backendUrl;
    if (configured) return String(configured).replace(/\/$/, '');
    try {
      const fromQuery = new URL(globalThis.location?.href || '').searchParams.get('backend');
      if (fromQuery) return String(fromQuery).trim().replace(/\/$/, '');
    } catch (_) {}
    return 'http://localhost:8000';
  }

  function loadSettings() {
    try {
      const saved = localStorage.getItem('markai-settings');
      if (saved) Object.assign(_state.settings, JSON.parse(saved));
    } catch(e) {}
  }

  function saveSettings() {
    localStorage.setItem('markai-settings', JSON.stringify(_state.settings));
  }

  return { on, get, set, loadSettings, saveSettings, getDefaultBackendEndpoint };
})();

// ══════════════════════════════════════════════
// 2. QUEUE MANAGER
// ══════════════════════════════════════════════
const QueueManager = (() => {
  let _sortable = null;

  function _genId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return Math.random().toString(36).slice(2, 9);
  }

  function add(files) {
    const existing = AppState.get('queue');
    const newItems = Array.from(files).map(file => ({
      id: _genId(),
      file,
      name: file.name,
      ext: file.name.split('.').pop().toLowerCase(),
      size: file.size,
      status: 'pending',
      result: null,
    }));
    AppState.set('queue', [...existing, ...newItems]);
    return newItems;
  }

  function remove(id) {
    AppState.set('queue', AppState.get('queue').filter(i => i.id !== id));
  }

  function update(id, patch) {
    AppState.set('queue', AppState.get('queue').map(i =>
      i.id === id ? { ...i, ...patch } : i
    ));
  }

  function getById(id) {
    return AppState.get('queue').find(i => i.id === id);
  }

  function getOrdered() {
    const listEl = document.getElementById('queueList');
    if (!listEl) return AppState.get('queue');
    const ids = Array.from(listEl.querySelectorAll('.queue-item')).map(el => el.dataset.id);
    const map = {};
    AppState.get('queue').forEach(i => { map[i.id] = i; });
    return ids.map(id => map[id]).filter(Boolean);
  }

  function clear() { AppState.set('queue', []); }

  function initSortable(listEl) {
    if (_sortable) _sortable.destroy();
    _sortable = Sortable.create(listEl, {
      animation: 180,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      handle: '.qi-drag',
      easing: 'cubic-bezier(0.4,0,0.2,1)',
    });
  }

  return { add, remove, update, getById, getOrdered, clear, initSortable };
})();



  root.MarkAICore = {
    AppState,
    QueueManager
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
