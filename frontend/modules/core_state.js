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
    if (configured) return String(configured).trim().replace(/\/$/, '');
    try {
      const location = globalThis.location;
      const fromQuery = new URL(location?.href || '').searchParams.get('backend');
      if (fromQuery) return String(fromQuery).trim().replace(/\/$/, '');
      const hostname = String(location?.hostname || '').toLowerCase();
      const isLocal = hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1' ||
        hostname.endsWith('.local');
      return isLocal ? 'http://localhost:8000' : '';
    } catch (_) {
      // Node/test environments have no browser location: retain the local default.
      return 'http://localhost:8000';
    }
  }

  function loadSettings() {
    try {
      const saved = localStorage.getItem('markai-settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        Object.assign(_state.settings, parsed);
        // Do not carry a local-machine endpoint into a public portal.
        const defaultEndpoint = getDefaultBackendEndpoint();
        const hostname = String(globalThis.location?.hostname || '').toLowerCase();
        const isPublicBrowser = hostname && hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1' && !hostname.endsWith('.local');
        if (isPublicBrowser && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/?$/i.test(String(_state.settings.markitdownEndpoint || ''))) {
          _state.settings.markitdownEndpoint = defaultEndpoint;
        }
      }
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
      mergeMarker: true,
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
    return AppState.get('queue').slice();
  }

  function reorder(ids) {
    const queue = AppState.get('queue');
    const map = new Map(queue.map(item => [item.id, item]));
    const ordered = [];

    for (const id of Array.isArray(ids) ? ids : []) {
      const item = map.get(id);
      if (item) {
        ordered.push(item);
        map.delete(id);
      }
    }

    // Preserve any item not represented in the DOM/ID list instead of
    // silently dropping it from the canonical queue state.
    for (const item of queue) {
      if (map.has(item.id)) ordered.push(item);
    }

    AppState.set('queue', ordered);
    return ordered;
  }

  function move(id, direction) {
    const queue = AppState.get('queue').slice();
    const index = queue.findIndex(item => item.id === id);
    if (index < 0) return queue;

    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= queue.length) return queue;

    [queue[index], queue[target]] = [queue[target], queue[index]];
    AppState.set('queue', queue);
    return queue;
  }

  function clear() { AppState.set('queue', []); }

  function initSortable(listEl, onOrderChanged) {
    if (_sortable) _sortable.destroy();
    if (!listEl || !globalThis.Sortable) return null;

    _sortable = Sortable.create(listEl, {
      animation: 180,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      handle: '.qi-drag',
      easing: 'cubic-bezier(0.4,0,0.2,1)',
      onEnd() {
        const ids = Array.from(listEl.querySelectorAll('.queue-item')).map(el => el.dataset.id);
        reorder(ids);
        if (typeof onOrderChanged === 'function') onOrderChanged();
      }
    });
    return _sortable;
  }

  return { add, remove, update, getById, getOrdered, reorder, move, clear, initSortable };
})();



  root.MarkAICore = {
    AppState,
    QueueManager
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
