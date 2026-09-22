/**
 * MarkAI Converter v3.0 Pro
 * Architecture: IIFE-wrapped classes for file:/// compatibility
 * Modules: AppState (Proxy), QueueManager, FileParserStrategy,
 *          MergeEngine, URLFetcher, ChatFormatter, AIEngine, UIManager
 */
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
      markitdownEndpoint: 'http://localhost:8000',
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

  function loadSettings() {
    try {
      const saved = localStorage.getItem('markai-settings');
      if (saved) Object.assign(_state.settings, JSON.parse(saved));
    } catch(e) {}
  }

  function saveSettings() {
    localStorage.setItem('markai-settings', JSON.stringify(_state.settings));
  }

  return { on, get, set, loadSettings, saveSettings };
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

// ══════════════════════════════════════════════
// 2.5 WORKSPACE — IndexedDB persistence, projects, versions and AI history
// ══════════════════════════════════════════════
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
        sourceType: item.sourceType || 'file', sourceUrl: item.sourceUrl || null
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
        sourceType: d.sourceType, sourceUrl: d.sourceUrl
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

// ══════════════════════════════════════════════
// 3. MARKITDOWN ENGINE — server-side document conversion
// ══════════════════════════════════════════════
const MarkItDownEngine = (() => {
  let healthCache = { ok: false, at: 0 };

  function _endpoint() {
    const s = AppState.get('settings');
    return (s.markitdownEndpoint || 'http://localhost:8000').replace(/\/$/, '');
  }

  async function isAvailable(force = false) {
    const s = AppState.get('settings');
    if (s.markitdownEnabled === false) return false;
    if (!force && Date.now() - healthCache.at < 30000) return healthCache.ok;

    try {
      const resp = await window.fetch(_endpoint() + '/api/health', {
        method: 'GET',
        cache: 'no-store',
        signal: AbortSignal.timeout(1200),
      });
      healthCache = { ok: resp.ok, at: Date.now() };
    } catch (_) {
      healthCache = { ok: false, at: Date.now() };
    }
    return healthCache.ok;
  }

  async function convert(file, onProgress) {
    if (!(await isAvailable())) return null;

    if (onProgress) onProgress(0.15);
    const form = new FormData();
    form.append('file', file, file.name);

    const resp = await window.fetch(_endpoint() + '/api/convert', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(120000),
    });

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body?.detail || `MarkItDown API error ${resp.status}`);
    }

    const data = await resp.json();
    if (!data?.markdown) throw new Error('MarkItDown retornou conteúdo vazio.');
    if (onProgress) onProgress(1);
    return { markdown: data.markdown, meta: data };
  }

  async function convertUrl(url) {
    if (!(await isAvailable(true))) {
      throw new Error('Backend MarkItDown indisponível. Para converter URLs, inicie o backend local antes da conversão.');
    }

    const resp = await window.fetch(_endpoint() + '/api/convert-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(120000),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body?.detail || `MarkItDown URL API error ${resp.status}`);
    if (!body?.markdown) throw new Error('Nenhum conteúdo/transcrição foi retornado pelo MarkItDown.');
    return { markdown: body.markdown, meta: body };
  }

  return { isAvailable, convert, convertUrl };
})();

// ══════════════════════════════════════════════
// 3. FILE PARSER STRATEGY
// ══════════════════════════════════════════════
const FileParserStrategy = (() => {
  const MARKITDOWN_ONLY_EXTS = new Set([
    'pptx','epub','zip','png','jpg','jpeg','gif','webp','wav','mp3','m4a'
  ]);

  const CODE_LANGS = {
    py: 'python', js: 'javascript', ts: 'typescript', jsx: 'javascript', tsx: 'typescript',
    html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
    sql: 'sql', sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
    rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
    cpp: 'cpp', c: 'c', cs: 'csharp', php: 'php', swift: 'swift',
    yaml: 'yaml', yml: 'yaml', xml: 'xml', toml: 'toml', ini: 'ini',
    r: 'r', lua: 'lua', pl: 'perl', ex: 'elixir', exs: 'elixir',
    scala: 'scala', dart: 'dart', vue: 'html', svelte: 'html',
  };

  function _formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function _yieldTick() {
    return new Promise(res => setTimeout(res, 0));
  }

  // ── TEXT / MARKDOWN ──
  async function parseTxt(file) {
    const text = await file.text();
    const name = file.name.replace(/\.[^.]+$/, '');
    if (file.name.endsWith('.md')) return text;
    let md = `# ${name}\n\n`;
    const lines = text.split('\n');
    // Detect paragraph breaks
    let para = [];
    for (const line of lines) {
      if (line.trim() === '') {
        if (para.length) { md += para.join(' ') + '\n\n'; para = []; }
      } else {
        para.push(line.trim());
      }
    }
    if (para.length) md += para.join(' ') + '\n\n';
    return md.trimEnd();
  }

  // ── CODE FILES ──
  async function parseCode(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const lang = CODE_LANGS[ext] || ext;
    const text = await file.text();
    const name = file.name.replace(/\.[^.]+$/, '');
    let title = name;
    let docstring = '';
    let body = text;

    // Python docstring
    const pyDoc = text.match(/^(?:["']{3})([\s\S]*?)(?:["']{3})/m);
    // JS/TS JSDoc or block comment
    const jsDoc = text.match(/^\/\*\*([\s\S]*?)\*\//m);
    // Shell/Python/Ruby # comment block at top
    const hashDoc = text.match(/^(?:#[^\n]*\n){1,10}/);
    // SQL comment block
    const sqlDoc = text.match(/^(?:--[^\n]*\n){1,10}/);

    if (pyDoc) {
      const raw = pyDoc[1].trim().split('\n')[0].replace(/[*\s]+/g, ' ').trim();
      if (raw) title = raw;
      docstring = `> ${pyDoc[1].trim().replace(/\n/g,' ')}\n\n`;
    } else if (jsDoc) {
      const raw = jsDoc[1].trim().split('\n')[0].replace(/[*\s]+/g, ' ').trim();
      if (raw) title = raw;
      docstring = `> ${jsDoc[1].trim().replace(/\n\s*\*/g,' ').trim()}\n\n`;
    } else if ((ext === 'sh' || ext === 'py' || ext === 'rb') && hashDoc) {
      const lines = hashDoc[0].split('\n').filter(l => l.trim().startsWith('#'));
      title = lines[0].replace(/^#\s*/, '').trim() || name;
      if (lines.length > 1) docstring = `> ${lines.slice(1).map(l => l.replace(/^#\s*/, '')).join(' ')}\n\n`;
    } else if (ext === 'sql' && sqlDoc) {
      const lines = sqlDoc[0].split('\n').filter(l => l.startsWith('--'));
      title = lines[0].replace(/^--\s*/, '').trim() || name;
    }

    const md = [
      `# ${title}`,
      '',
      docstring,
      `**Arquivo:** \`${file.name}\` | **Linguagem:** ${lang.charAt(0).toUpperCase()+lang.slice(1)} | **Tamanho:** ${_formatSize(file.size)}`,
      '',
      `\`\`\`${lang}`,
      body,
      '```',
    ].join('\n');
    return md;
  }

  // ── PDF ──
  async function parsePdf(file, onProgress) {
    const pdfjsLib = window['pdfjs-dist/build/pdf'] || window.pdfjsLib;
    if (!pdfjsLib) throw new Error('PDF.js não carregado.');
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const name = file.name.replace(/\.[^.]+$/, '');
    let md = `# ${name}\n\n`;
    md += `**Páginas:** ${pdf.numPages} | **Arquivo:** \`${file.name}\`\n\n---\n\n`;

    for (let i = 1; i <= pdf.numPages; i++) {
      if (onProgress) onProgress(i / pdf.numPages);
      await _yieldTick();

      const page = await pdf.getPage(i);
      const content = await page.getTextContent({ includeMarkedContent: false });
      const viewport = page.getViewport({ scale: 1 });

      // Group items by approximate Y position to form lines
      const lineMap = {};
      for (const item of content.items) {
        if (!item.str || !item.str.trim()) continue;
        const y = Math.round(item.transform[5]);
        if (!lineMap[y]) lineMap[y] = { items: [], height: item.height || 12 };
        lineMap[y].items.push(item);
        if (item.height > lineMap[y].height) lineMap[y].height = item.height;
      }

      const sortedYs = Object.keys(lineMap).map(Number).sort((a, b) => b - a);
      const pageLines = [];

      for (const y of sortedYs) {
        const { items, height } = lineMap[y];
        const lineText = items
          .sort((a, b) => a.transform[4] - b.transform[4])
          .map(i => i.str).join(' ').trim();
        if (!lineText) continue;

        // Heuristic: large font → heading
        if (height >= 20 && lineText.length < 120) {
          pageLines.push(`\n## ${lineText}\n`);
        } else if (height >= 14 && lineText.length < 100) {
          pageLines.push(`\n### ${lineText}\n`);
        } else {
          pageLines.push(lineText);
        }
      }

      // Group consecutive non-heading lines into paragraphs
      let para = [];
      let pageMd = `## Página ${i}\n\n`;
      for (const line of pageLines) {
        if (line.startsWith('\n##') || line.startsWith('\n###')) {
          if (para.length) { pageMd += para.join(' ') + '\n\n'; para = []; }
          pageMd += line + '\n';
        } else {
          para.push(line);
        }
      }
      if (para.length) pageMd += para.join(' ') + '\n\n';
      md += pageMd + '\n';
    }
    return md.trimEnd();
  }

  // ── DOCX ──
  async function parseDocx(file) {
    const buffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
    const html = result.value;
    // Convert HTML to Markdown manually
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    return _htmlToMarkdown(doc.body);
  }

  function _htmlToMarkdown(el) {
    let md = '';
    for (const node of el.childNodes) {
      if (node.nodeType === 3) {
        md += node.textContent;
      } else if (node.nodeType === 1) {
        const tag = node.tagName.toLowerCase();
        const inner = _htmlToMarkdown(node);
        switch (tag) {
          case 'h1': md += `\n# ${inner.trim()}\n\n`; break;
          case 'h2': md += `\n## ${inner.trim()}\n\n`; break;
          case 'h3': md += `\n### ${inner.trim()}\n\n`; break;
          case 'h4': md += `\n#### ${inner.trim()}\n\n`; break;
          case 'h5': md += `\n##### ${inner.trim()}\n\n`; break;
          case 'h6': md += `\n###### ${inner.trim()}\n\n`; break;
          case 'p':  md += `\n${inner.trim()}\n\n`; break;
          case 'strong': case 'b': md += `**${inner}**`; break;
          case 'em': case 'i': md += `*${inner}*`; break;
          case 'u': md += `__${inner}__`; break;
          case 'code': md += `\`${inner}\``; break;
          case 'pre': md += `\n\`\`\`\n${inner}\n\`\`\`\n\n`; break;
          case 'a': md += `[${inner}](${node.href || '#'})`; break;
          case 'br': md += '\n'; break;
          case 'hr': md += '\n---\n\n'; break;
          case 'ul': {
            for (const li of node.querySelectorAll(':scope > li')) {
              md += `\n- ${_htmlToMarkdown(li).trim()}`;
            }
            md += '\n\n'; break;
          }
          case 'ol': {
            let n = 1;
            for (const li of node.querySelectorAll(':scope > li')) {
              md += `\n${n}. ${_htmlToMarkdown(li).trim()}`;
              n++;
            }
            md += '\n\n'; break;
          }
          case 'table': {
            const rows = node.querySelectorAll('tr');
            if (!rows.length) break;
            const headerCells = rows[0].querySelectorAll('th,td');
            const headers = Array.from(headerCells).map(c => c.textContent.trim());
            md += '\n| ' + headers.join(' | ') + ' |\n';
            md += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
            for (let i = 1; i < rows.length; i++) {
              const cells = Array.from(rows[i].querySelectorAll('td')).map(c => c.textContent.trim());
              md += '| ' + cells.join(' | ') + ' |\n';
            }
            md += '\n'; break;
          }
          case 'blockquote': md += `\n> ${inner.trim().replace(/\n/g, '\n> ')}\n\n`; break;
          case 'img': md += `![${node.alt||''}](${node.src||''})`; break;
          default: md += inner;
        }
      }
    }
    return md;
  }

  // ── CSV ──
  async function parseCsv(file) {
    const text = await file.text();
    return _csvToTable(text, file.name.replace(/\.[^.]+$/, ''));
  }

  function _csvToTable(text, title) {
    // Smart CSV parser handling quoted fields
    function parseRow(row) {
      const cells = [];
      let inQuote = false, cur = '';
      for (let i = 0; i < row.length; i++) {
        const c = row[i];
        if (c === '"') {
          if (inQuote && row[i+1] === '"') { cur += '"'; i++; }
          else inQuote = !inQuote;
        } else if ((c === ',' || c === ';' || c === '\t') && !inQuote) {
          cells.push(cur.trim()); cur = '';
        } else { cur += c; }
      }
      cells.push(cur.trim());
      return cells;
    }

    const lines = text.split('\n').filter(l => l.trim());
    if (!lines.length) return `# ${title}\n\n_Arquivo vazio._`;

    // Detect separator
    const firstLine = lines[0];
    const sep = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';

    const headers = parseRow(firstLine);
    const colWidths = headers.map(h => h.length);

    const rows = lines.slice(1).map(line => {
      const cells = parseRow(line);
      cells.forEach((c, i) => { if (c.length > (colWidths[i]||0)) colWidths[i] = c.length; });
      return cells;
    });

    const pad = (str, len) => str.padEnd(len);
    let md = `# ${title}\n\n`;
    md += `**Linhas:** ${rows.length} | **Colunas:** ${headers.length}\n\n`;
    md += '| ' + headers.map((h, i) => pad(h, colWidths[i])).join(' | ') + ' |\n';
    md += '| ' + colWidths.map(w => '-'.repeat(Math.max(w, 3))).join(' | ') + ' |\n';
    for (const row of rows) {
      md += '| ' + headers.map((_, i) => pad(row[i] || '', colWidths[i])).join(' | ') + ' |\n';
    }
    return md;
  }

  // ── XLSX ──
  async function parseXlsx(file) {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const name = file.name.replace(/\.[^.]+$/, '');
    let md = `# ${name}\n\n`;

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (!data.length) continue;

      md += `## ${sheetName}\n\n`;
      const headers = data[0].map(String);
      const colWidths = headers.map(h => h.length);
      const rows = data.slice(1).map(row =>
        headers.map((_, i) => String(row[i] !== undefined ? row[i] : ''))
      );
      rows.forEach(row => row.forEach((c, i) => { if (c.length > (colWidths[i]||0)) colWidths[i] = c.length; }));

      const pad = (s, l) => s.padEnd(l);
      md += '| ' + headers.map((h, i) => pad(h, colWidths[i])).join(' | ') + ' |\n';
      md += '| ' + colWidths.map(w => '-'.repeat(Math.max(w, 3))).join(' | ') + ' |\n';
      for (const row of rows) {
        md += '| ' + headers.map((_, i) => pad(row[i], colWidths[i])).join(' | ') + ' |\n';
      }
      md += '\n';
    }
    return md.trimEnd();
  }

  // ── JSON ──
  async function parseJson(file) {
    const text = await file.text();
    const name = file.name.replace(/\.[^.]+$/, '');
    let md = `# ${name}\n\n`;
    try {
      const obj = JSON.parse(text);
      // If array of objects, render as table
      if (Array.isArray(obj) && obj.length && typeof obj[0] === 'object') {
        const headers = Object.keys(obj[0]);
        md += `**Registros:** ${obj.length} | **Campos:** ${headers.length}\n\n`;
        const colWidths = headers.map(h => h.length);
        const rows = obj.slice(0, 200).map(item =>
          headers.map(h => {
            const v = String(item[h] !== undefined ? item[h] : '');
            if (v.length > (colWidths[headers.indexOf(h)]||0)) colWidths[headers.indexOf(h)] = Math.min(v.length, 50);
            return v;
          })
        );
        const pad = (s, l) => s.slice(0, l).padEnd(l);
        md += '| ' + headers.map((h, i) => pad(h, colWidths[i])).join(' | ') + ' |\n';
        md += '| ' + colWidths.map(w => '-'.repeat(Math.max(w, 3))).join(' | ') + ' |\n';
        for (const row of rows) {
          md += '| ' + headers.map((_, i) => pad(row[i], colWidths[i])).join(' | ') + ' |\n';
        }
        if (obj.length > 200) md += `\n_…e mais ${obj.length - 200} registros_\n`;
        md += '\n---\n\n';
      }
      md += '```json\n' + JSON.stringify(obj, null, 2) + '\n```';
    } catch(e) {
      md += '```json\n' + text + '\n```';
    }
    return md;
  }

  // ── DISPATCH ──
  async function parseBrowser(item, onProgress) {
    const { file, ext } = item;
    if (ext === 'pdf') return parsePdf(file, onProgress);
    if (ext === 'docx' || ext === 'doc') return parseDocx(file);
    if (ext === 'xlsx' || ext === 'xls') return parseXlsx(file);
    if (ext === 'csv') return parseCsv(file);
    if (ext === 'json') return parseJson(file);
    if (MARKITDOWN_ONLY_EXTS.has(ext)) throw new Error(`O formato .${ext} requer o backend Microsoft MarkItDown ativo.`);
    if (ext === 'txt' || ext === 'md') return parseTxt(file);
    if (CODE_LANGS[ext]) return parseCode(file);
    return parseTxt(file);
  }

  async function parse(item, onProgress) {
    const { file, ext } = item;

    // Prefer Microsoft MarkItDown when the optional backend is running.
    // Browser parsers remain the automatic fallback for offline/static usage.
    try {
      const remote = await MarkItDownEngine.convert(file, onProgress);
      if (remote) return remote.markdown;
    } catch (e) {
      console.warn('[MarkAI] MarkItDown conversion failed; using browser fallback:', e);
    }
    return parseBrowser(item, onProgress);
  }

  return { parse, parseBrowser };
})();


// ══════════════════════════════════════════════
// 4. MERGE ENGINE
// ══════════════════════════════════════════════
const MergeEngine = (() => {
  async function merge(onProgress) {
    const items = QueueManager.getOrdered();
    if (!items.length) throw new Error('Fila vazia.');
    let combined = `# Documento Combinado\n\n`;
    combined += `*Gerado por MarkAI Converter v3.0 Pro*\n`;
    combined += `*${new Date().toLocaleString('pt-BR')}*\n\n`;
    combined += `**Arquivos:** ${items.length}\n\n---\n\n`;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (onProgress) onProgress((i + 0.5) / items.length, item.name);
      let result = item.result;
      if (!result) {
        QueueManager.update(item.id, { status: 'converting' });
        UIManager.renderQueue();
        try {
          result = await FileParserStrategy.parse(item);
          QueueManager.update(item.id, { status: 'done', result });
          UIManager.renderQueue();
        } catch(e) {
          QueueManager.update(item.id, { status: 'error' });
          UIManager.renderQueue();
          result = `_Erro ao converter: ${item.name}_`;
        }
      }
      combined += `---\n\n## ${i + 1}. ${item.name}\n\n`;
      combined += result.trim() + '\n\n';
      if (onProgress) onProgress((i + 1) / items.length, item.name);
    }
    return combined.trimEnd();
  }

  return { merge };
})();

// ══════════════════════════════════════════════
// 5. URL FETCHER
// ══════════════════════════════════════════════
const URLFetcher = (() => {
  async function fetch(url) {
    const normalized = String(url || '').trim();
    if (!normalized) throw new Error('Informe uma URL.');

    try {
      const result = await MarkItDownEngine.convertUrl(normalized);
      return result.markdown;
    } catch (error) {
      const message = error?.message || 'Não foi possível converter a URL.';
      if (/Backend MarkItDown indisponível/i.test(message)) {
        throw new Error('O motor de URLs está offline. Inicie o backend MarkItDown e tente novamente.');
      }
      throw new Error(message);
    }
  }

  function isYouTubeUrl(url) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be'].includes(host);
    } catch (_) { return false; }
  }

  return { fetch, isYouTubeUrl };
})();

// ══════════════════════════════════════════════
// 6. CHAT FORMATTER
// ══════════════════════════════════════════════
const ChatFormatter = (() => {
  // Patterns: "User:", "Human:", "You:", "Você:", etc.
  const USER_PATTERN = /^(user|human|you|você|eu|pergunta|question)\s*:\s*/i;
  // Patterns: "AI:", "Assistant:", "Gemini:", "ChatGPT:", "Claude:", "GPT:", etc.
  const AI_PATTERN = /^(ai|assistant|assistente|gemini|chatgpt|gpt|claude|bot|copilot|bing|resposta|answer)\s*:\s*/i;
  // Timestamp
  const TIMESTAMP_PATTERN = /^\[?(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)\]?\s*/i;

  function format(text) {
    const lines = text.split('\n');
    let md = '# Conversa com IA\n\n';
    md += `*Formatado em ${new Date().toLocaleString('pt-BR')}*\n\n---\n\n`;

    let currentSpeaker = null;
    let currentLines = [];
    let codeBlock = false;

    function flush() {
      if (!currentLines.length) return;
      const body = currentLines.join('\n').trim();
      if (!body) { currentLines = []; return; }

      if (currentSpeaker === 'user') {
        md += `> 🧑 **Usuário:**\n>\n> ${body.replace(/\n/g, '\n> ')}\n\n`;
      } else if (currentSpeaker === 'ai') {
        md += `> 🤖 **IA:**\n>\n> ${body.replace(/\n/g, '\n> ')}\n\n`;
      } else {
        md += body + '\n\n';
      }
      currentLines = [];
    }

    for (let line of lines) {
      // Handle code blocks — pass through unmodified
      if (line.trim().startsWith('```')) {
        codeBlock = !codeBlock;
        currentLines.push(line);
        continue;
      }
      if (codeBlock) { currentLines.push(line); continue; }

      // Strip optional timestamp
      line = line.replace(TIMESTAMP_PATTERN, '').trim();
      if (!line) { currentLines.push(''); continue; }

      if (USER_PATTERN.test(line)) {
        flush();
        currentSpeaker = 'user';
        currentLines.push(line.replace(USER_PATTERN, ''));
      } else if (AI_PATTERN.test(line)) {
        flush();
        currentSpeaker = 'ai';
        currentLines.push(line.replace(AI_PATTERN, ''));
      } else {
        currentLines.push(line);
      }
    }
    flush();
    return md.trimEnd();
  }

  return { format };
})();

// ══════════════════════════════════════════════
// 7. AI ENGINE
// ══════════════════════════════════════════════
const AIEngine = (() => {
  const SYSTEM_PROMPT = `You are a professional Markdown formatter and technical writer.
Your task: receive raw text (possibly from OCR, PDFs, or code) and return ONLY clean, well-structured Markdown.
Rules:
- Fix OCR noise (garbled characters, broken words, misread ligatures)
- Organize content with proper heading hierarchy (H1 > H2 > H3)
- Align and fix broken Markdown tables
- Preserve code blocks with correct language tags
- Clean up redundant whitespace and line breaks
- Format lists properly (bulleted and numbered)
- Use blockquotes for important callouts
- Do NOT add commentary, preamble, or explanation — return ONLY the Markdown.`;

  async function enhance(markdown, customPrompt = '') {
    const settings = AppState.get('settings');
    const prompt = String(customPrompt || '').trim();
    if (!settings.apiKey) throw new Error('API Key não configurada. Abra Configurações.');

    if (settings.aiProvider === 'gemini') {
      return _callGemini(markdown, settings.apiKey, settings.aiModel, prompt);
    } else {
      return _callOpenAI(markdown, settings.apiKey, settings.aiModel, prompt);
    }
  }

  async function _callGemini(text, apiKey, model, customPrompt = '') {
    const effectiveSystemPrompt = customPrompt ? SYSTEM_PROMPT + '\n\nAdditional user instructions:\n' + customPrompt : SYSTEM_PROMPT;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const body = {
      system_instruction: { parts: [{ text: effectiveSystemPrompt }] },
      contents: [{ parts: [{ text }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
    };
    const resp = await window.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Gemini API error ${resp.status}`);
    }
    const data = await resp.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || text;
  }

  async function _callOpenAI(text, apiKey, model, customPrompt = '') {
    const effectiveSystemPrompt = customPrompt ? SYSTEM_PROMPT + '\n\nAdditional user instructions:\n' + customPrompt : SYSTEM_PROMPT;
    const resp = await window.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: effectiveSystemPrompt },
          { role: 'user', content: text },
        ],
        temperature: 0.2,
        max_tokens: 8192,
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err?.error?.message || `OpenAI API error ${resp.status}`);
    }
    const data = await resp.json();
    return data?.choices?.[0]?.message?.content || text;
  }

  return { enhance };
})();


// ══════════════════════════════════════════════
const ConversionQuality = (() => {
  function metrics(markdown) {
    const text = String(markdown || '');
    return {
      characters: text.length,
      lines: text ? text.split(/\r?\n/).length : 0,
      headings: (text.match(/^#{1,6}\s+/gm) || []).length,
      tables: (text.match(/^\|.*\|$/gm) || []).length,
      links: (text.match(/\[[^\]]+\]\([^\)]+\)/g) || []).length,
      words: text.trim() ? text.trim().split(/\s+/).length : 0
    };
  }
  function diffScore(a, b) {
    const left = String(a || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const right = String(b || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const max = Math.max(left.length, right.length, 1);
    const same = left.filter((line, i) => line === right[i]).length;
    return Math.round((1 - same / max) * 100);
  }
  return { metrics, diffScore };
})();

// ══════════════════════════════════════════════
// 8. UI MANAGER — DOM, events, toasts, modals
// ══════════════════════════════════════════════
const UIManager = (() => {
  let _previewRawMode = false;

  // ── DOM REFS ──
  const $ = id => document.getElementById(id);
  const els = {
    dropZone: $('dropZone'), fileInput: $('fileInput'), browseBtn: $('browseBtn'),
    queuePanel: $('queuePanel'), queueList: $('queueList'), queueCount: $('queueCount'),
    btnClearQueue: $('btnClearQueue'), btnMergeAll: $('btnMergeAll'), btnConvertAll: $('btnConvertAll'), btnDownloadZip: $('btnDownloadZip'),
    urlInput: $('urlInput'), btnFetchUrl: $('btnFetchUrl'),
    youtubeControls: $('youtubeControls'), youtubeLanguage: $('youtubeLanguage'), youtubeTranslate: $('youtubeTranslate'),
    btnYoutubeTranscribe: $('btnYoutubeTranscribe'), btnYoutubeLanguages: $('btnYoutubeLanguages'), youtubeStatus: $('youtubeStatus'),
    chatInput: $('chatInput'), btnFormatChat: $('btnFormatChat'),
    emptyState: $('emptyState'), workspaceContent: $('workspaceContent'),
    docName: $('docName'),
    statWords: $('statWords'), statLines: $('statLines'), statChars: $('statChars'),
    btnEnhanceAI: $('btnEnhanceAI'), btnCopy: $('btnCopy'), btnCompare: $('btnCompare'),
    btnDownload: $('btnDownload'), btnReset: $('btnReset'),
    progressWrap: $('progressWrap'), progressBar: $('progressBar'),
    markdownEditor: $('markdownEditor'),
    markdownPreview: $('markdownPreview'),
    markdownEditorSplit: $('markdownEditorSplit'),
    markdownPreviewSplit: $('markdownPreviewSplit'),
    panelRaw: $('panelRaw'), panelPreview: $('panelPreview'), panelSplit: $('panelSplit'),
    tabRaw: $('tabRaw'), tabPreview: $('tabPreview'), tabSplit: $('tabSplit'),
    procOverlay: $('procOverlay'), procLabel: $('procLabel'), procSub: $('procSub'),
    statusDot: $('statusDot'), statusText: $('statusText'),
    btnSettings: $('btnSettings'), modalSettings: $('modalSettings'),
    btnCloseSettings: $('btnCloseSettings'), btnSaveSettings: $('btnSaveSettings'),
    btnClearApiKey: $('btnClearApiKey'), btnToggleKey: $('btnToggleKey'),
    btnWorkspace: $('btnWorkspace'), btnWorkspaceToolbar: $('btnWorkspaceToolbar'),
    workspaceProjectSelect: $('workspaceProjectSelect'), btnWorkspaceSave: $('btnWorkspaceSave'),
    btnWorkspaceVersion: $('btnWorkspaceVersion'), btnWorkspaceExport: $('btnWorkspaceExport'), workspaceStatus: $('workspaceStatus'),
    modalWorkspace: $('modalWorkspace'), btnCloseWorkspace: $('btnCloseWorkspace'), btnWorkspaceDone: $('btnWorkspaceDone'),
    workspaceProjectName: $('workspaceProjectName'), btnCreateWorkspaceProject: $('btnCreateWorkspaceProject'),
    workspaceProjectList: $('workspaceProjectList'), btnRenameWorkspaceProject: $('btnRenameWorkspaceProject'),
    btnDeleteWorkspaceProject: $('btnDeleteWorkspaceProject'), btnExportWorkspaceJson: $('btnExportWorkspaceJson'),
    btnExportWorkspaceZip: $('btnExportWorkspaceZip'), workspaceHistoryCount: $('workspaceHistoryCount'),
    workspaceHistoryList: $('workspaceHistoryList'), workspaceTabVersions: $('workspaceTabVersions'), workspaceTabAI: $('workspaceTabAI'),
    aiProvider: $('aiProvider'), aiModel: $('aiModel'), aiApiKey: $('aiApiKey'),
    workspaceAIPrompt: $('workspaceAIPrompt'),
    toggleSyntaxHL: $('toggleSyntaxHL'), toggleAutoPreview: $('toggleAutoPreview'),
    modalPreview: $('modalPreview'), btnClosePreview: $('btnClosePreview'),
    previewFileName: $('previewFileName'), previewContent: $('previewContent'),
    btnUsePreview: $('btnUsePreview'), btnPreviewRaw: $('btnPreviewRaw'),
    modalCompare: $('modalCompare'), btnCloseCompare: $('btnCloseCompare'), compareFileName: $('compareFileName'),
    compareMarkitdown: $('compareMarkitdown'), compareBrowser: $('compareBrowser'),
    compareMarkitdownStats: $('compareMarkitdownStats'), compareBrowserStats: $('compareBrowserStats'),
    btnUseMarkItDown: $('btnUseMarkItDown'), btnUseBrowser: $('btnUseBrowser'),
    toastContainer: $('toastContainer'),
  };

  // ── WORKSPACE UI ──
  let _workspaceHistoryMode = 'versions';
  let _workspaceSaveTimer = null;

  async function _workspaceSyncQueue() {
    const projectId = AppState.get('currentProjectId');
    if (!projectId) return;
    try {
      await WorkspaceStore.saveQueue(projectId, AppState.get('queue'));
      if (els.workspaceStatus) els.workspaceStatus.textContent = 'Salvo localmente · ' + new Date().toLocaleTimeString('pt-BR');
    } catch (e) {
      console.warn('[MarkAI] Workspace save failed:', e);
      if (els.workspaceStatus) els.workspaceStatus.textContent = 'Erro ao salvar workspace';
    }
  }

  function _scheduleWorkspaceSave() {
    clearTimeout(_workspaceSaveTimer);
    _workspaceSaveTimer = setTimeout(_workspaceSyncQueue, 600);
  }

  async function _refreshWorkspaceProjects() {
    const projects = await WorkspaceStore.listProjects();
    const activeId = AppState.get('currentProjectId');
    els.workspaceProjectSelect.innerHTML = projects.map(p =>
      '<option value="' + p.id + '"' + (p.id === activeId ? ' selected' : '') + '>' +
      p.name.replace(/</g, '&lt;') + '</option>'
    ).join('');
    els.workspaceProjectList.innerHTML = projects.length ? projects.map(p => {
      const countLabel = p.id === activeId ? ' · ativo' : '';
      return '<div class="workspace-project-item' + (p.id === activeId ? ' active' : '') + '" data-project-id="' + p.id + '">' +
        '<div class="workspace-project-name">' + p.name.replace(/</g, '&lt;') + '</div>' +
        '<div class="workspace-project-meta">Atualizado ' + new Date(p.updatedAt || p.createdAt).toLocaleString('pt-BR') + countLabel + '</div>' +
      '</div>';
    }).join('') : '<div class="workspace-empty">Nenhum projeto.</div>';
  }

  async function _renderWorkspaceHistory() {
    const projectId = AppState.get('currentProjectId');
    if (!projectId) return;
    const records = _workspaceHistoryMode === 'versions'
      ? await WorkspaceStore.listVersions(projectId)
      : await WorkspaceStore.listAIHistory(projectId);
    els.workspaceHistoryCount.textContent = records.length;
    if (!records.length) {
      els.workspaceHistoryList.innerHTML = '<div class="workspace-empty">Nenhum registro neste projeto.</div>';
      return;
    }
    els.workspaceHistoryList.innerHTML = records.slice(0, 100).map(item => {
      const title = _workspaceHistoryMode === 'versions'
        ? (item.name || 'documento.md')
        : ((item.documentName || 'documento.md') + ' · ' + (item.model || item.provider || 'IA'));
      const preview = _workspaceHistoryMode === 'versions'
        ? (item.source || 'editor') + ' · ' + String(item.markdown || '').slice(0, 140)
        : String(item.prompt || 'Prompt padrão do sistema').slice(0, 140);
      return '<div class="workspace-history-item" data-history-id="' + item.id + '">' +
        '<div class="workspace-history-title">' + title.replace(/</g, '&lt;') + '</div>' +
        '<div class="workspace-history-meta">' + new Date(item.createdAt).toLocaleString('pt-BR') + '</div>' +
        '<div class="workspace-history-preview">' + preview.replace(/</g, '&lt;') + '</div>' +
      '</div>';
    }).join('');
  }

  async function _openWorkspace() {
    try {
      await _refreshWorkspaceProjects();
      await _renderWorkspaceHistory();
      els.modalWorkspace.showModal();
    } catch (e) {
      toast('Erro ao abrir workspace: ' + e.message, 'error');
    }
  }

  async function _selectProject(projectId) {
    if (!projectId || projectId === AppState.get('currentProjectId')) return;
    await _workspaceSyncQueue();
    const queue = await WorkspaceStore.loadQueue(projectId);
    AppState.set('currentProjectId', projectId);
    AppState.set('queue', queue);
    renderQueue();
    const current = queue.find(i => i.status === 'done' && i.result);
    if (current) {
      loadMarkdown(current.result, current.name.replace(/\.[^.]+$/, '') + '.md');
    } else {
      AppState.set('currentMd', '');
      els.workspaceContent.style.display = 'none';
      els.emptyState.style.display = 'flex';
    }
    await _refreshWorkspaceProjects();
    await _renderWorkspaceHistory();
    if (els.workspaceStatus) els.workspaceStatus.textContent = 'Projeto: ' + (els.workspaceProjectSelect.selectedOptions[0]?.textContent || '');
    toast('Projeto carregado.', 'success');
  }

  async function _createProject() {
    await _workspaceSyncQueue();
    const name = els.workspaceProjectName.value.trim();
    if (!name) { toast('Informe o nome do projeto.', 'warning'); return; }
    const project = await WorkspaceStore.createProject(name);
    els.workspaceProjectName.value = '';
    AppState.set('currentProjectId', project.id);
    AppState.set('queue', []);
    AppState.set('currentMd', '');
    renderQueue();
    els.workspaceContent.style.display = 'none';
    els.emptyState.style.display = 'flex';
    await _refreshWorkspaceProjects();
    await _renderWorkspaceHistory();
    toast('Projeto criado e ativado.', 'success');
  }

  async function _saveWorkspaceVersion(source = 'manual') {
    const projectId = AppState.get('currentProjectId');
    const md = AppState.get('currentMd');
    if (!projectId || !md) { toast('Não há conteúdo para versionar.', 'warning'); return; }
    const version = await WorkspaceStore.saveVersion(
      projectId, null, AppState.get('currentFileName'), md, source,
      ''
    );
    await WorkspaceStore.updateProject({ ...(await WorkspaceStore.listProjects()).find(p => p.id === projectId) });
    await _renderWorkspaceHistory();
    if (els.workspaceStatus) els.workspaceStatus.textContent = 'Versão salva · ' + new Date(version.createdAt).toLocaleTimeString('pt-BR');
    toast('Versão do Markdown salva.', 'success');
  }

  async function _exportWorkspaceJson() {
    const projectId = AppState.get('currentProjectId');
    if (!projectId) return;
    const payload = await WorkspaceStore.exportProject(projectId);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    _downloadBlob(blob, (payload.project?.name || 'markai-workspace') + '.json');
    toast('Workspace exportado em JSON.', 'success');
  }

  async function _exportWorkspaceZip() {
    const projectId = AppState.get('currentProjectId');
    if (!projectId) return;
    if (!window.JSZip) { toast('Biblioteca ZIP ainda não carregou.', 'warning'); return; }
    const payload = await WorkspaceStore.exportProject(projectId);
    const zip = new JSZip();
    const safe = String(payload.project?.name || 'workspace').replace(/[^a-z0-9_-]+/gi, '_');
    zip.file('workspace.json', JSON.stringify(payload, null, 2));
    payload.documents.forEach((d, i) => {
      if (d.result) zip.file('markdown/' + String(i + 1).padStart(3, '0') + '_' + String(d.name || 'documento').replace(/[^a-z0-9_.-]+/gi, '_') + '.md', d.result);
    });
    const versions = payload.versions || [];
    versions.forEach((v, i) => {
      if (v.markdown) zip.file('versions/' + String(i + 1).padStart(3, '0') + '_' + String(v.name || 'versao').replace(/[^a-z0-9_.-]+/gi, '_') + '.md', v.markdown);
    });
    const content = await zip.generateAsync({ type: 'blob' });
    _downloadBlob(content, safe + '.zip');
    toast('Workspace exportado em ZIP.', 'success');
  }

  function _downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── FILE TYPE ICON LABELS ──
  const EXT_LABELS = {
    pdf:'PDF', docx:'DOCX', doc:'DOC', pptx:'PPTX', xlsx:'XLSX', xls:'XLS',
    csv:'CSV', json:'JSON', xml:'XML', txt:'TXT', md:'MD', epub:'EPUB', zip:'ZIP',
    png:'IMG', jpg:'IMG', jpeg:'IMG', gif:'IMG', webp:'IMG', wav:'AUDIO', mp3:'AUDIO', m4a:'AUDIO',
    py:'PY', js:'JS', ts:'TS', jsx:'JSX', tsx:'TSX',
    html:'HTML', css:'CSS', scss:'SCSS', sql:'SQL',
    sh:'SH', rb:'RB', go:'GO', rs:'RS', java:'JAVA',
    cpp:'C++', c:'C', cs:'C#', php:'PHP', swift:'SWIFT', kt:'KT',
    yaml:'YAML', yml:'YML', xml:'XML',
  };
  const CODE_EXTS = new Set([
    'py','js','ts','jsx','tsx','html','htm','css','scss','less',
    'sql','sh','bash','rb','go','rs','java','kt','cpp','c','cs',
    'php','swift','yaml','yml','xml','toml','ini','r','lua','pl','vue','svelte'
  ]);

  function _extClass(ext) {
    if (['xlsx','xls'].includes(ext)) return 'ext-xlsx';
    if (CODE_EXTS.has(ext)) return `ext-${ext}`;
    return `ext-${ext}`;
  }

  function _formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes/1024).toFixed(1) + ' KB';
    return (bytes/1048576).toFixed(1) + ' MB';
  }

  // ── HTML / MARKDOWN SAFETY ──
  function _sanitizeMarkdownHtml(markdown) {
    const source = String(markdown || '');
    const rendered = marked.parse(source);
    if (window.DOMPurify) {
      return DOMPurify.sanitize(rendered, {
        USE_PROFILES: { html: true },
        ADD_ATTR: ['target', 'rel']
      });
    }
    // Fail closed if the sanitizer CDN is unavailable: render Markdown as literal text.
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = source;
    pre.appendChild(code);
    return pre.outerHTML;
  }

  function _escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  // ── TOAST ──
  function toast(msg, type = 'info', duration = 3500) {
    const icons = { success: 'check-circle', error: 'alert-circle', info: 'info', warning: 'alert-triangle' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const icon = document.createElement('i');
    icon.dataset.lucide = icons[type] || 'info';
    const text = document.createElement('span');
    text.textContent = String(msg ?? '');
    el.append(icon, text);
    els.toastContainer.appendChild(el);
    lucide.createIcons({ el });
    setTimeout(() => {
      el.classList.add('removing');
      el.addEventListener('animationend', () => el.remove());
    }, duration);
  }

  // ── STATUS ──
  function setStatus(text, state = 'idle') {
    els.statusText.textContent = text;
    els.statusDot.className = 'status-dot' + (state !== 'idle' ? ` ${state}` : '');
  }

  // ── PROGRESS ──
  function setProgress(pct, show = true) {
    els.progressWrap.style.display = show ? 'block' : 'none';
    els.progressBar.style.width = (pct * 100).toFixed(1) + '%';
  }

  // ── PROCESSING OVERLAY ──
  function showProcessing(label = 'Processando…', sub = 'Aguarde') {
    els.procLabel.textContent = label;
    els.procSub.textContent = sub;
    els.procOverlay.style.display = 'flex';
  }
  function hideProcessing() {
    els.procOverlay.style.display = 'none';
  }

  // ── QUEUE RENDER ──
  function renderQueue() {
    const queue = AppState.get('queue');
    els.queueCount.textContent = queue.length;
    els.queuePanel.style.display = queue.length ? 'block' : 'none';

    const ordered = QueueManager.getOrdered();
    const ids = ordered.map(i => i.id);
    // Only re-render if needed
    const existingIds = Array.from(els.queueList.querySelectorAll('.queue-item')).map(e => e.dataset.id);
    const same = ids.length === existingIds.length && ids.every((id, i) => id === existingIds[i]);
    if (same && queue.length === existingIds.length) {
      // Just update statuses
      for (const item of queue) {
        const el = els.queueList.querySelector(`[data-id="${item.id}"]`);
        if (el) {
          const si = el.querySelector('.qi-status');
          si.setAttribute('class', 'qi-status');
          si.setAttribute('data-lucide', _statusIcon(item.status));
          el.className = `queue-item ${item.status}`;
        }
      }
      lucide.createIcons();
      return;
    }

    els.queueList.innerHTML = '';
    for (const item of (ordered.length ? ordered : queue)) {
      const li = document.createElement('li');
      li.className = `queue-item ${item.status}`;
      li.dataset.id = item.id;
      li.innerHTML = `
        <i data-lucide="grip-vertical" class="qi-drag"></i>
        <input type="checkbox" class="qi-check" data-id="${item.id}" title="Selecionar" />
        <div class="qi-icon ${_extClass(item.ext)}">${EXT_LABELS[item.ext] || item.ext.toUpperCase()}</div>
        <div class="qi-info">
          <div class="qi-name" title="${_escapeHtml(item.name)}">${_escapeHtml(item.name)}</div>
          <div class="qi-size">${_formatSize(item.size)}</div>
        </div>
        <div class="qi-actions">
          <button class="btn btn-ghost btn-icon-xs qi-btn-preview" data-id="${item.id}" title="Pré-visualizar">
            <i data-lucide="eye"></i>
          </button>
          <button class="btn btn-ghost btn-icon-xs qi-btn-convert" data-id="${item.id}" title="Converter">
            <i data-lucide="zap"></i>
          </button>
          <button class="btn btn-ghost btn-icon-xs qi-btn-compare" data-id="${item.id}" title="Comparar motores">
            <i data-lucide="columns-2"></i>
          </button>
          <button class="btn btn-ghost btn-icon-xs qi-btn-download" data-id="${item.id}" title="Baixar Arquivo">
            <i data-lucide="download"></i>
          </button>
          <button class="btn btn-ghost btn-icon-xs qi-btn-remove" data-id="${item.id}" title="Remover">
            <i data-lucide="x"></i>
          </button>
        </div>
        <i data-lucide="${_statusIcon(item.status)}" class="qi-status"></i>
      `;
      els.queueList.appendChild(li);
    }
    lucide.createIcons();
    QueueManager.initSortable(els.queueList);
  }

  function _statusIcon(status) {
    return { pending:'clock', converting:'loader-2', done:'check-circle', error:'alert-circle' }[status] || 'clock';
  }

  // ── LOAD MARKDOWN INTO WORKSPACE ──
  function loadMarkdown(md, fileName) {
    AppState.set('currentMd', md);
    AppState.set('currentFileName', fileName || 'documento.md');

    els.emptyState.style.display = 'none';
    els.workspaceContent.style.display = 'flex';
    els.workspaceContent.style.flexDirection = 'column';
    els.workspaceContent.style.height = '100%';

    els.docName.textContent = fileName || 'documento.md';
    els.docName.title = fileName || 'documento.md';

    const activePanel = AppState.get('activePanel');
    els.markdownEditor.value = md;
    els.markdownEditorSplit.value = md;
    _updateStats(md);

    if (activePanel === 'panelPreview' || activePanel === 'panelSplit') {
      _renderPreview(md);
    }

    setProgress(1);
    setTimeout(() => setProgress(0, false), 800);
  }

  function _updateStats(md) {
    const words = md.trim() ? md.trim().split(/\s+/).length : 0;
    const lines = md.split('\n').length;
    const chars = md.length;
    els.statWords.textContent = `${words.toLocaleString('pt-BR')} palavras`;
    els.statLines.textContent = `${lines.toLocaleString('pt-BR')} linhas`;
    els.statChars.textContent = `${chars.toLocaleString('pt-BR')} chars`;
  }

  function _renderPreview(md) {
    const settings = AppState.get('settings');
    const html = _sanitizeMarkdownHtml(md);
    [els.markdownPreview, els.markdownPreviewSplit].forEach(el => {
      el.innerHTML = html;
      if (settings.syntaxHL) {
        el.querySelectorAll('pre code').forEach(block => {
          hljs.highlightElement(block);
        });
      }
    });
  }

  // ── TABS ──
  function _switchTab(tab) {
    const panels = { panelRaw: els.panelRaw, panelPreview: els.panelPreview, panelSplit: els.panelSplit };
    const tabs = [els.tabRaw, els.tabPreview, els.tabSplit];

    tabs.forEach(t => t.classList.remove('active'));
    Object.values(panels).forEach(p => p.style.display = 'none');

    const panelId = tab.dataset.panel;
    panels[panelId].style.display = 'flex';
    tab.classList.add('active');
    AppState.set('activePanel', panelId);

    if (panelId !== 'panelRaw') {
      _renderPreview(AppState.get('currentMd'));
    }
    if (panelId === 'panelSplit') {
      els.markdownEditorSplit.value = AppState.get('currentMd');
    }
  }

  // ── CONVERT SINGLE ITEM ──
  async function convertItem(id) {
    const item = QueueManager.getById(id);
    if (!item) return;

    QueueManager.update(id, { status: 'converting' });
    renderQueue();
    setStatus(`Convertendo ${item.name}…`, 'busy');
    setProgress(0.1);

    try {
      let result = null, engine = 'browser', conversionMeta = null;
      if (await MarkItDownEngine.isAvailable()) {
        try {
          const remote = await MarkItDownEngine.convert(item.file, p => setProgress(p));
          if (remote?.markdown) {
            result = remote.markdown;
            engine = 'markitdown';
            conversionMeta = remote.meta || null;
          }
        } catch (remoteError) {
          console.warn('[MarkAI] Fallback local:', remoteError);
        }
      }
      if (!result) result = await FileParserStrategy.parseBrowser(item, p => setProgress(p));
      QueueManager.update(id, { status: 'done', result, engine, conversionMeta });
      _scheduleWorkspaceSave();
      renderQueue();
      setProgress(1);
      loadMarkdown(result, item.name.replace(/\.[^.]+$/, '') + '.md');
      setStatus(`${item.name} convertido`, 'idle');
      toast(`✓ ${item.name} convertido com sucesso!`, 'success');
    } catch(e) {
      QueueManager.update(id, { status: 'error' });
      renderQueue();
      setProgress(0, false);
      setStatus('Erro na conversão', 'error');
      toast(`Erro: ${e.message}`, 'error');
    }
  }

  // ── MOTOR COMPARISON ──
  async function compareItem(id) {
    const item = QueueManager.getById(id);
    if (!item) return;
    if (['pptx','epub','zip','png','jpg','jpeg','gif','webp','wav','mp3','m4a'].includes(item.ext)) {
      toast('Este formato não possui parser local para comparação.', 'warning');
      return;
    }
    showProcessing('Comparando motores…', item.name);
    try {
      const settled = await Promise.allSettled([
        MarkItDownEngine.convert(item.file),
        FileParserStrategy.parseBrowser(item)
      ]);
      const remote = settled[0].status === 'fulfilled' ? settled[0].value : null;
      const local = settled[1].status === 'fulfilled' ? settled[1].value : null;
      if (!remote?.markdown && !local) throw new Error('Nenhum dos motores conseguiu converter o arquivo.');
      const rmd = remote?.markdown || '';
      const bmd = local || '';
      const rm = ConversionQuality.metrics(rmd);
      const bm = ConversionQuality.metrics(bmd);
      const diff = ConversionQuality.diffScore(rmd, bmd);
      els.compareFileName.textContent = item.name;
      els.compareMarkitdown.value = rmd || 'MarkItDown indisponível ou falhou.';
      els.compareBrowser.value = bmd || 'Conversor local indisponível para este formato.';
      els.compareMarkitdownStats.textContent = rmd
        ? 'chars: ' + rm.characters.toLocaleString('pt-BR') + ' · linhas: ' + rm.lines + ' · headings: ' + rm.headings + ' · tabelas: ' + rm.tables + ' · links: ' + rm.links + ' · divergência: ' + diff + '%'
        : 'Indisponível';
      els.compareBrowserStats.textContent = bmd
        ? 'chars: ' + bm.characters.toLocaleString('pt-BR') + ' · linhas: ' + bm.lines + ' · headings: ' + bm.headings + ' · tabelas: ' + bm.tables + ' · links: ' + bm.links + ' · divergência: ' + diff + '%'
        : 'Indisponível';
      AppState.set('compareState', { id, markitdown: rmd, browser: bmd });
      hideProcessing();
      els.modalCompare.showModal();
    } catch (e) {
      hideProcessing();
      toast('Erro na comparação: ' + e.message, 'error');
    }
  }

  // ── INIT EVENT LISTENERS ──
  async function _initWorkspace() {
    if (!window.indexedDB) {
      if (els.workspaceStatus) els.workspaceStatus.textContent = 'IndexedDB indisponível';
      return;
    }
    try {
      const project = await WorkspaceStore.init();
      AppState.set('currentProjectId', project.id);
      const queue = await WorkspaceStore.loadQueue(project.id);
      AppState.set('queue', queue);
      renderQueue();
      if (els.workspaceStatus) els.workspaceStatus.textContent = 'Projeto: ' + project.name;
      const current = queue.find(i => i.status === 'done' && i.result);
      if (current) loadMarkdown(current.result, current.name.replace(/\.[^.]+$/, '') + '.md');
      await _refreshWorkspaceProjects();
    } catch (e) {
      console.warn('[MarkAI] Workspace init failed:', e);
      if (els.workspaceStatus) els.workspaceStatus.textContent = 'Workspace offline';
    }
  }

  function init() {
    AppState.loadSettings();
    _applySettings();
    _setupMarkdown();
    _initWorkspace();

    // Workspace
    els.btnWorkspace?.addEventListener('click', _openWorkspace);
    els.btnWorkspaceToolbar?.addEventListener('click', _openWorkspace);
    els.btnCloseWorkspace?.addEventListener('click', () => els.modalWorkspace.close());
    els.btnWorkspaceDone?.addEventListener('click', () => els.modalWorkspace.close());
    els.modalWorkspace?.addEventListener('click', e => { if (e.target === els.modalWorkspace) els.modalWorkspace.close(); });
    els.workspaceProjectSelect?.addEventListener('change', e => _selectProject(e.target.value));
    els.btnWorkspaceSave?.addEventListener('click', async () => { await _workspaceSyncQueue(); toast('Workspace salvo.', 'success'); });
    els.btnWorkspaceVersion?.addEventListener('click', () => _saveWorkspaceVersion('manual'));
    els.btnWorkspaceExport?.addEventListener('click', _exportWorkspaceZip);
    els.btnCreateWorkspaceProject?.addEventListener('click', _createProject);
    els.workspaceProjectName?.addEventListener('keydown', e => { if (e.key === 'Enter') _createProject(); });
    els.workspaceProjectList?.addEventListener('click', e => {
      const item = e.target.closest('[data-project-id]');
      if (item) _selectProject(item.dataset.projectId);
    });
    els.btnRenameWorkspaceProject?.addEventListener('click', async () => {
      const projectId = AppState.get('currentProjectId');
      const project = (await WorkspaceStore.listProjects()).find(p => p.id === projectId);
      if (!project) return;
      const name = window.prompt('Novo nome do projeto:', project.name);
      if (!name?.trim()) return;
      project.name = name.trim();
      await WorkspaceStore.updateProject(project);
      await _refreshWorkspaceProjects();
      toast('Projeto renomeado.', 'success');
    });
    els.btnDeleteWorkspaceProject?.addEventListener('click', async () => {
      const projects = await WorkspaceStore.listProjects();
      if (projects.length <= 1) { toast('Mantenha pelo menos um projeto.', 'warning'); return; }
      const projectId = AppState.get('currentProjectId');
      const project = projects.find(p => p.id === projectId);
      if (!project || !window.confirm('Excluir o projeto "' + project.name + '" e todo o histórico local?')) return;
      await WorkspaceStore.deleteProject(projectId);
      const next = (await WorkspaceStore.listProjects())[0];
      AppState.set('currentProjectId', next.id);
      AppState.set('queue', await WorkspaceStore.loadQueue(next.id));
      renderQueue();
      await _refreshWorkspaceProjects();
      await _renderWorkspaceHistory();
      toast('Projeto excluído.', 'success');
    });
    els.btnExportWorkspaceJson?.addEventListener('click', _exportWorkspaceJson);
    els.btnExportWorkspaceZip?.addEventListener('click', _exportWorkspaceZip);
    els.workspaceTabVersions?.addEventListener('click', async () => {
      _workspaceHistoryMode = 'versions';
      els.workspaceTabVersions.classList.add('active');
      els.workspaceTabAI.classList.remove('active');
      await _renderWorkspaceHistory();
    });
    els.workspaceTabAI?.addEventListener('click', async () => {
      _workspaceHistoryMode = 'ai';
      els.workspaceTabAI.classList.add('active');
      els.workspaceTabVersions.classList.remove('active');
      await _renderWorkspaceHistory();
    });

    els.workspaceHistoryList?.addEventListener('click', async e => {
      const item = e.target.closest('[data-history-id]');
      if (!item || _workspaceHistoryMode !== 'versions') return;
      const records = await WorkspaceStore.listVersions(AppState.get('currentProjectId'));
      const version = records.find(v => v.id === item.dataset.historyId);
      if (!version?.markdown) return;
      loadMarkdown(version.markdown, version.name || 'documento.md');
      els.modalWorkspace.close();
      toast('Versão carregada no editor.', 'success');
    });

    // Drop zone
    els.dropZone.addEventListener('dragover', e => {
      e.preventDefault();
      els.dropZone.classList.add('drag-over');
    });
    els.dropZone.addEventListener('dragleave', () => els.dropZone.classList.remove('drag-over'));
    els.dropZone.addEventListener('drop', e => {
      e.preventDefault();
      els.dropZone.classList.remove('drag-over');
      if (e.dataTransfer.files.length) _onFilesSelected(e.dataTransfer.files);
    });
    els.dropZone.addEventListener('click', () => els.fileInput.click());
    els.dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') els.fileInput.click(); });
    els.browseBtn.addEventListener('click', e => { e.stopPropagation(); els.fileInput.click(); });
    els.fileInput.addEventListener('change', e => {
      if (e.target.files.length) _onFilesSelected(e.target.files);
      e.target.value = '';
    });

    // Queue actions
    els.btnClearQueue.addEventListener('click', () => {
      QueueManager.clear();
      renderQueue();
      _scheduleWorkspaceSave();
      toast('Fila limpa.', 'info');
    });

    els.btnMergeAll.addEventListener('click', async () => {
      const items = QueueManager.getOrdered();
      if (!items.length) { toast('Nenhum arquivo na fila.', 'warning'); return; }
      showProcessing('Juntando arquivos…', `Processando ${items.length} arquivos`);
      setStatus('Fazendo merge…', 'busy');
      try {
        const result = await MergeEngine.merge((p, name) => {
          els.procSub.textContent = `Convertendo: ${name}`;
        });
        hideProcessing();
        loadMarkdown(result, 'documento_combinado.md');
        setStatus('Merge concluído', 'idle');
        toast(`✓ ${items.length} arquivos combinados!`, 'success');
      } catch(e) {
        hideProcessing();
        setStatus('Erro no merge', 'error');
        toast(`Erro: ${e.message}`, 'error');
      }
    });

        els.btnDownloadZip.addEventListener('click', async () => {
            const checkedBoxes = Array.from(els.queueList.querySelectorAll('.qi-check:checked'));
      let items;
      if (checkedBoxes.length > 0) {
        const checkedIds = checkedBoxes.map(cb => cb.dataset.id);
        items = QueueManager.getOrdered().filter(i => checkedIds.includes(i.id) && i.status === 'done' && i.result);
        if (!items.length) { toast('Nenhum arquivo convertido entre os selecionados.', 'warning'); return; }
      } else {
        items = QueueManager.getOrdered().filter(i => i.status === 'done' && i.result);
      }
      if (!items.length) { toast('Nenhum arquivo convertido na fila para baixar.', 'warning'); return; }
      if (!window.JSZip) { toast('Carregando biblioteca ZIP, tente novamente em instantes.', 'info'); return; }
      
      const zip = new JSZip();
      items.forEach(item => {
        let safeName = item.name.replace(/\.[^.]+$/, '') + '.md';
        zip.file(safeName, item.result);
      });
      
      showProcessing('Compactando arquivos...', items.length + ' arquivos');
      try {
        const content = await zip.generateAsync({type:"blob"});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(content);
        a.download = 'arquivos_convertidos.zip';
        a.click();
        URL.revokeObjectURL(a.href);
        toast('✓ ZIP com ' + items.length + ' arquivos baixado!', 'success');
      } catch(e) {
        toast('Erro ao criar ZIP: ' + e.message, 'error');
      } finally {
        hideProcessing();
      }
    });

    els.btnConvertAll.addEventListener('click', async () => {
      const items = QueueManager.getOrdered();
      if (!items.length) { toast('Nenhum arquivo na fila.', 'warning'); return; }
      let last = null;
      for (const item of items) {
        if (item.status !== 'done') {
          await convertItem(item.id);
          last = item.id;
        }
      }
      if (!last) toast('Todos os arquivos já convertidos.', 'info');
    });

    // Queue item delegation
    els.queueList.addEventListener('click', e => {
      const btn = e.target.closest('button[data-id]');
      if (!btn) return;
      const id = btn.dataset.id;
      if (btn.classList.contains('qi-btn-remove')) {
        QueueManager.remove(id);
        renderQueue();
        _scheduleWorkspaceSave();
        if (!AppState.get('queue').length) {
          els.emptyState.style.display = 'flex';
          els.workspaceContent.style.display = 'none';
        }
      } else if (btn.classList.contains('qi-btn-convert')) {
        convertItem(id);
      } else if (btn.classList.contains('qi-btn-compare')) {
        compareItem(id);
            } else if (btn.classList.contains('qi-btn-download')) {
        const item = QueueManager.getById(id);
        if (item && item.result) {
          const blob = new Blob([item.result], { type: 'text/markdown;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; 
          a.download = item.name.replace(/\.[^.]+$/, '') + '.md';
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          URL.revokeObjectURL(url);
          toast('✓ ' + a.download + ' baixado!', 'success');
        } else {
          toast('Converta o arquivo primeiro.', 'warning');
        }
      } else if (btn.classList.contains('qi-btn-preview')) {
        _previewItem(id);
      }
    });

    // URL fetch
    els.btnFetchUrl.addEventListener('click', () => {
      if (_updateYoutubeControls() ) _transcribeYoutube();
      else _fetchUrl();
    });
    els.urlInput.addEventListener('input', () => _updateYoutubeControls());
    els.urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') {
      if (_updateYoutubeControls()) _transcribeYoutube();
      else _fetchUrl();
    }});
    els.btnYoutubeTranscribe?.addEventListener('click', () => _transcribeYoutube());
    els.btnYoutubeLanguages?.addEventListener('click', () => _listYoutubeLanguages());
    _updateYoutubeControls();

    // Chat format
    els.btnFormatChat.addEventListener('click', () => {
      const text = els.chatInput.value.trim();
      if (!text) { toast('Cole uma transcrição no campo acima.', 'warning'); return; }
      const md = ChatFormatter.format(text);
      loadMarkdown(md, 'conversa_ia.md');
      toast('✓ Conversa formatada!', 'success');
    });

    // Tabs
    [els.tabRaw, els.tabPreview, els.tabSplit].forEach(tab => {
      tab.addEventListener('click', () => _switchTab(tab));
    });

    // Editor auto-sync
    function _onEditorInput(editor, e) {
      const md = editor.value;
      AppState.set('currentMd', md);
      _updateStats(md);
      // Sync sibling editor
      if (editor === els.markdownEditor) els.markdownEditorSplit.value = md;
      else els.markdownEditor.value = md;
      // Auto preview
      if (AppState.get('settings').autoPreview && AppState.get('activePanel') !== 'panelRaw') {
        _renderPreview(md);
      }
      if (AppState.get('activePanel') === 'panelSplit') _renderPreview(md);
    }
    els.markdownEditor.addEventListener('input', e => { _onEditorInput(els.markdownEditor, e); _scheduleWorkspaceSave(); });
    els.markdownEditorSplit.addEventListener('input', e => { _onEditorInput(els.markdownEditorSplit, e); _scheduleWorkspaceSave(); });
    // Copy
    els.btnCopy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(AppState.get('currentMd'));
        const origHTML = els.btnCopy.innerHTML;
        els.btnCopy.innerHTML = '<i data-lucide="check"></i><span>Copiado!</span>';
        lucide.createIcons();
        setTimeout(() => { els.btnCopy.innerHTML = origHTML; lucide.createIcons(); }, 2000);
        toast('Markdown copiado!', 'success');
      } catch(e) {
        toast('Erro ao copiar.', 'error');
      }
    });

    // Download
    els.btnDownload.addEventListener('click', () => {
      const md = AppState.get('currentMd');
      if (!md) { toast('Nenhum conteúdo para baixar.', 'warning'); return; }
      const fileName = AppState.get('currentFileName') || 'documento.md';
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast(`✓ ${fileName} baixado!`, 'success');
    });

    // Reset
    els.btnReset.addEventListener('click', async () => {
      AppState.set('currentMd', '');
      els.markdownEditor.value = '';
      els.markdownEditorSplit.value = '';
      els.markdownPreview.innerHTML = '';
      els.markdownPreviewSplit.innerHTML = '';
      els.workspaceContent.style.display = 'none';
      els.emptyState.style.display = 'flex';
      _updateStats('');
      setProgress(0, false);
      setStatus('Pronto', 'idle');
      _scheduleWorkspaceSave();
    });

    // AI Enhance
    els.btnEnhanceAI.addEventListener('click', async () => {
      const md = AppState.get('currentMd');
      if (!md) { toast('Sem conteúdo para melhorar.', 'warning'); return; }
      const settings = AppState.get('settings');
      if (!settings.apiKey) {
        toast('Configure sua API Key em Configurações.', 'warning');
        els.modalSettings.showModal();
        return;
      }
      els.btnEnhanceAI.classList.add('loading');
      els.btnEnhanceAI.disabled = true;
      setStatus('IA processando…', 'busy');
      try {
        const customPrompt = els.workspaceAIPrompt?.value?.trim() || '';
        const improved = await AIEngine.enhance(md, customPrompt);
        const projectId = AppState.get('currentProjectId');
        if (projectId) await WorkspaceStore.saveAIHistory(projectId, { provider: settings.aiProvider, model: settings.aiModel, prompt: customPrompt || 'SYSTEM_PROMPT: formatação e normalização de Markdown', inputMarkdown: md, outputMarkdown: improved, documentName: AppState.get('currentFileName') });
        loadMarkdown(improved, AppState.get('currentFileName'));
        await _saveWorkspaceVersion('ai');
        toast('✓ Markdown melhorado pela IA!', 'success');
        setStatus('IA concluída', 'idle');
      } catch(e) {
        toast(`Erro IA: ${e.message}`, 'error');
        setStatus('Erro na IA', 'error');
      } finally {
        els.btnEnhanceAI.classList.remove('loading');
        els.btnEnhanceAI.disabled = false;
      }
    });

    // Settings Modal
    els.btnSettings.addEventListener('click', () => {
      _syncSettingsUI();
      els.modalSettings.showModal();
    });
    els.btnCloseSettings.addEventListener('click', () => els.modalSettings.close());
    els.modalSettings.addEventListener('click', e => { if (e.target === els.modalSettings) els.modalSettings.close(); });

    els.btnSaveSettings.addEventListener('click', () => {
      const s = AppState.get('settings');
      s.aiProvider = els.aiProvider.value;
      s.aiModel = els.aiModel.value;
      s.apiKey = els.aiApiKey.value;
      s.markitdownEnabled = els.toggleMarkItDown.checked;
      s.markitdownEndpoint = els.markitdownEndpoint.value.trim() || 'http://localhost:8000';
      s.syntaxHL = els.toggleSyntaxHL.checked;
      s.autoPreview = els.toggleAutoPreview.checked;
      AppState.set('settings', s);
      AppState.saveSettings();
      els.modalSettings.close();
      toast('✓ Configurações salvas!', 'success');
    });

    els.btnClearApiKey.addEventListener('click', () => {
      els.aiApiKey.value = '';
      const s = AppState.get('settings');
      s.apiKey = '';
      AppState.set('settings', s);
      AppState.saveSettings();
      toast('Chave removida.', 'info');
    });

    els.btnToggleKey.addEventListener('click', () => {
      const isPass = els.aiApiKey.type === 'password';
      els.aiApiKey.type = isPass ? 'text' : 'password';
      els.btnToggleKey.querySelector('i').setAttribute('data-lucide', isPass ? 'eye-off' : 'eye');
      lucide.createIcons();
    });

    els.aiProvider.addEventListener('change', _filterModels);

    // Comparison Modal
    els.btnCloseCompare.addEventListener('click', () => els.modalCompare.close());
    els.modalCompare.addEventListener('click', e => { if (e.target === els.modalCompare) els.modalCompare.close(); });
    els.btnUseMarkItDown.addEventListener('click', () => {
      const s = AppState.get('compareState');
      const item = s?.id ? QueueManager.getById(s.id) : null;
      if (!s?.markitdown || !item) { toast('Resultado MarkItDown indisponível.', 'warning'); return; }
      QueueManager.update(item.id, { status:'done', result:s.markitdown, engine:'markitdown' });
      renderQueue(); loadMarkdown(s.markitdown, item.name.replace(/\.[^.]+$/, '') + '.md');
      els.modalCompare.close();
    });
    els.btnUseBrowser.addEventListener('click', () => {
      const s = AppState.get('compareState');
      const item = s?.id ? QueueManager.getById(s.id) : null;
      if (!s?.browser || !item) { toast('Resultado local indisponível.', 'warning'); return; }
      QueueManager.update(item.id, { status:'done', result:s.browser, engine:'browser' });
      renderQueue(); loadMarkdown(s.browser, item.name.replace(/\.[^.]+$/, '') + '.md');
      els.modalCompare.close();
    });

    els.btnCompare.addEventListener('click', () => {
      const current = AppState.get('currentFileName') || '';
      const base = current.replace(/\.[^.]+$/, '');
      const item = QueueManager.getOrdered().find(i => i.name.replace(/\.[^.]+$/, '') === base) || QueueManager.getOrdered().find(i => i.result);
      if (!item) { toast('Nenhum arquivo disponível para comparação.', 'warning'); return; }
      compareItem(item.id);
    });

    // Preview Modal
    els.btnClosePreview.addEventListener('click', () => els.modalPreview.close());
    els.modalPreview.addEventListener('click', e => { if (e.target === els.modalPreview) els.modalPreview.close(); });
    els.btnUsePreview.addEventListener('click', () => {
      const id = AppState.get('previewItemId');
      const item = id ? QueueManager.getById(id) : null;
      if (item && item.result) {
        loadMarkdown(item.result, item.name.replace(/\.[^.]+$/, '') + '.md');
      }
      els.modalPreview.close();
    });
    els.btnPreviewRaw.addEventListener('click', () => {
      _previewRawMode = !_previewRawMode;
      const id = AppState.get('previewItemId');
      const item = id ? QueueManager.getById(id) : null;
      if (item && item.result) {
        if (_previewRawMode) {
          const pre = document.createElement('pre');
          const code = document.createElement('code');
          code.textContent = item.result;
          pre.appendChild(code);
          els.previewContent.replaceChildren(pre);
          els.btnPreviewRaw.textContent = 'Ver Preview';
        } else {
          els.previewContent.innerHTML = _sanitizeMarkdownHtml(item.result);
          els.btnPreviewRaw.textContent = 'Ver Raw';
        }
      }
    });
  }

  // ── SETTINGS UI ──
  function _syncSettingsUI() {
    const s = AppState.get('settings');
    els.aiProvider.value = s.aiProvider || 'gemini';
    els.aiModel.value = s.aiModel || 'gemini-1.5-flash';
    els.aiApiKey.value = s.apiKey || '';
    els.toggleMarkItDown.checked = s.markitdownEnabled !== false;
    els.markitdownEndpoint.value = s.markitdownEndpoint || 'http://localhost:8000';
    els.toggleSyntaxHL.checked = s.syntaxHL !== false;
    els.toggleAutoPreview.checked = s.autoPreview !== false;
    _filterModels();
  }

  function _filterModels() {
    const provider = els.aiProvider.value;
    const geminiOpts = els.aiModel.querySelectorAll('option[value^="gemini"]');
    const openaiOpts = els.aiModel.querySelectorAll('option[value^="gpt"]');
    geminiOpts.forEach(o => o.style.display = provider === 'gemini' ? '' : 'none');
    openaiOpts.forEach(o => o.style.display = provider === 'openai' ? '' : 'none');
    // Select first visible
    const first = Array.from(els.aiModel.options).find(o => o.style.display !== 'none');
    if (first && !els.aiModel.value.startsWith(provider === 'gemini' ? 'gemini' : 'gpt')) {
      els.aiModel.value = first.value;
    }
  }

  function _applySettings() {
    _syncSettingsUI();
  }

  // ── MARKED + HIGHLIGHT CONFIG ──
  function _setupMarkdown() {
    marked.setOptions({
      gfm: true, breaks: false,
      highlight: (code, lang) => {
        if (!AppState.get('settings').syntaxHL) return code;
        if (lang && hljs.getLanguage(lang)) {
          return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
      }
    });
  }

  // ── FILE SELECTION ──
  function _onFilesSelected(files) {
    const added = QueueManager.add(files);
      _scheduleWorkspaceSave();
    renderQueue();
    toast(`${added.length} arquivo(s) adicionado(s) à fila.`, 'success');

    // Auto-convert single file
    if (AppState.get('queue').length === 1 && added.length === 1) {
      setTimeout(() => convertItem(added[0].id), 100);
    }
  }

  // ── YOUTUBE TRANSCRIPTION ──
  function _updateYoutubeControls(url = els.urlInput.value.trim()) {
    const isYoutube = URLFetcher.isYouTubeUrl(url);
    if (els.youtubeControls) els.youtubeControls.hidden = !isYoutube;
    if (isYoutube && els.youtubeStatus) {
      els.youtubeStatus.textContent = 'YouTube detectado. A transcrição utiliza timestamps e informa se a legenda é manual ou automática.';
    }
    return isYoutube;
  }

  function _youtubeLanguagePriority() {
    const selected = els.youtubeLanguage?.value || 'auto';
    if (selected === 'auto') return ['pt-BR', 'pt', 'en', 'es'];
    return [selected, 'pt-BR', 'pt', 'en', 'es'].filter((value, index, array) => array.indexOf(value) === index);
  }

  async function _transcribeYoutube(url = els.urlInput.value.trim()) {
    if (!URLFetcher.isYouTubeUrl(url)) {
      toast('Informe uma URL válida do YouTube.', 'warning');
      return;
    }

    showProcessing('Transcrevendo YouTube…', url);
    setStatus('Transcrevendo YouTube…', 'busy');
    if (els.youtubeStatus) els.youtubeStatus.textContent = 'Consultando legendas disponíveis…';

    try {
      const endpoint = (AppState.get('settings').markitdownEndpoint || 'http://localhost:8000').replace(/\/$/, '');
      const payload = {
        url,
        languages: _youtubeLanguagePriority(),
        translate_to: els.youtubeTranslate?.value || null,
        preserve_formatting: false,
      };
      const response = await fetch(endpoint + '/api/youtube/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120000),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = typeof body.detail === 'object' ? (body.detail.message || body.detail.code) : body.detail;
        throw new Error(detail || ('Falha HTTP ' + response.status));
      }

      loadMarkdown(body.markdown, 'youtube_' + (body.video_id || 'video') + '_transcricao.md');
      setStatus('Transcrição do YouTube concluída', 'idle');
      if (els.youtubeStatus) {
        const origin = body.is_generated ? 'legenda automática' : 'legenda manual';
        const quality = body.quality || {};
        els.youtubeStatus.textContent =
          origin + ' · ' + (body.language_code || 'idioma desconhecido') +
          ' · ' + (quality.segments || 0) + ' segmentos · ' +
          (quality.words || 0) + ' palavras';
      }
      toast('✓ Transcrição do YouTube concluída!', 'success');
    } catch (error) {
      setStatus('Erro na transcrição YouTube', 'error');
      if (els.youtubeStatus) els.youtubeStatus.textContent = 'Falha: ' + (error.message || 'erro desconhecido');
      toast('Erro no YouTube: ' + error.message, 'error');
    } finally {
      hideProcessing();
    }
  }

  async function _listYoutubeLanguages(url = els.urlInput.value.trim()) {
    if (!URLFetcher.isYouTubeUrl(url)) {
      toast('Informe uma URL válida do YouTube.', 'warning');
      return;
    }
    try {
      const endpoint = (AppState.get('settings').markitdownEndpoint || 'http://localhost:8000').replace(/\/$/, '');
      const response = await fetch(endpoint + '/api/youtube/transcripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(30000),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = typeof body.detail === 'object' ? (body.detail.message || body.detail.code) : body.detail;
        throw new Error(detail || ('Falha HTTP ' + response.status));
      }

      const labels = (body.transcripts || []).map(item => {
        const type = item.is_generated ? 'automática' : 'manual';
        const translatable = item.is_translatable ? ' · traduzível' : '';
        return item.language + ' (' + item.language_code + ') — ' + type + translatable;
      });
      if (els.youtubeStatus) {
        els.youtubeStatus.textContent = labels.length
          ? 'Legendas disponíveis: ' + labels.join(' · ')
          : 'Nenhuma faixa de legenda encontrada.';
      }
    } catch (error) {
      if (els.youtubeStatus) els.youtubeStatus.textContent = 'Não foi possível listar as legendas: ' + error.message;
      toast('Erro ao consultar idiomas: ' + error.message, 'error');
    }
  }

  // ── URL FETCH ──
  async function _fetchUrl() {
    const url = els.urlInput.value.trim();
    if (!url) { toast('Digite uma URL válida.', 'warning'); return; }
    if (!url.startsWith('http')) { toast('URL deve começar com http:// ou https://', 'warning'); return; }

    showProcessing('Buscando URL…', url);
    setStatus('Buscando URL…', 'busy');
    try {
      const md = await URLFetcher.fetch(url);
      hideProcessing();
      loadMarkdown(md, 'pagina_web.md');
      setStatus('URL carregada', 'idle');
      toast('✓ Conteúdo extraído com sucesso!', 'success');
    } catch(e) {
      hideProcessing();
      setStatus('Erro na URL', 'error');
      toast(`Erro: ${e.message}`, 'error');
    }
  }

  // ── PREVIEW MODAL ──
  async function _previewItem(id) {
    const item = QueueManager.getById(id);
    if (!item) return;
    AppState.set('previewItemId', id);

    els.previewFileName.textContent = item.name;
    els.previewContent.innerHTML = '';

    let result = item.result;
    if (!result) {
      showProcessing('Convertendo para preview…', item.name);
      try {
        result = await FileParserStrategy.parse(item);
        QueueManager.update(id, { status: 'done', result });
        renderQueue();
      } catch(e) {
        hideProcessing();
        toast(`Erro ao pré-visualizar: ${e.message}`, 'error');
        return;
      }
      hideProcessing();
    }

    els.previewContent.innerHTML = _sanitizeMarkdownHtml(result);
    if (AppState.get('settings').syntaxHL) {
      els.previewContent.querySelectorAll('pre code').forEach(b => hljs.highlightElement(b));
    }
    els.btnPreviewRaw.textContent = 'Ver Raw';
    _previewRawMode = false;
    els.modalPreview.showModal();
  }

  return { init, renderQueue, loadMarkdown, toast };
})();

// ══════════════════════════════════════════════
// 9. BOOT
// ══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide icons
  lucide.createIcons();

  // PDF.js global worker
  if (window['pdfjs-dist/build/pdf']) {
    window['pdfjs-dist/build/pdf'].GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  // Boot UI
  UIManager.init();

  // Global drag-over-page prevention (only allow on drop zone)
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (files?.length && !e.target.closest('#dropZone')) {
      const added = QueueManager.add(files);
      UIManager.renderQueue();
      UIManager.toast(`${added.length} arquivo(s) adicionado(s)!`, 'success');
      if (AppState.get('queue').length === 1 && added.length === 1) {
        const item = AppState.get('queue')[0];
        if (item) {
          UIManager.toast('Arquivo adicionado à fila. Clique em Converter para iniciar.', 'info');
        }
      }
    }
  });
});





// ══════════════════════════════════════════════
// VIDEO TASK ANALYZER — screen recording → process steps
// ══════════════════════════════════════════════
const VideoTaskAnalyzer = (() => {
  let lastAnalysis = null;
  const $ = id => document.getElementById(id);
  const endpoint = () => {
    const s = AppState.get('settings');
    return (s.markitdownEndpoint || 'http://localhost:8000').replace(/\/$/, '');
  };

  function openModal() {
    const modal = $('modalVideoAnalysis');
    if (modal && !modal.open) modal.showModal();
  }

  const REVIEW_STATUSES = {
    pending: { label: 'Para revisar', className: 'pending' },
    approved: { label: 'Aprovada', className: 'approved' },
    ignored: { label: 'Ignorada', className: 'ignored' }
  };

  const ACTION_OPTIONS = [
    ['click', 'Clique'], ['double_click', 'Duplo clique'], ['type', 'Digitação'],
    ['select', 'Seleção'], ['hotkey', 'Atalho'], ['keypress', 'Tecla'],
    ['scroll', 'Scroll'], ['drag', 'Arrastar'], ['wait', 'Espera'],
    ['open', 'Abrir'], ['navigate', 'Navegar'], ['download', 'Download'],
    ['upload', 'Upload'], ['copy', 'Copiar'], ['paste', 'Colar'],
    ['check', 'Validar'], ['submit', 'Enviar'], ['other', 'Outra']
  ];

  function _ensureReviewState(data) {
    const analysis = data?.analysis;
    if (!analysis || !Array.isArray(analysis.etapas)) return;
    analysis.etapas.forEach(step => {
      if (!step || typeof step !== 'object') return;
      if (!REVIEW_STATUSES[step.review_status]) step.review_status = 'pending';
      if (typeof step.review_note !== 'string') step.review_note = '';
    });
  }

  function _reviewCounts(data = lastAnalysis) {
    const steps = Array.isArray(data?.analysis?.etapas) ? data.analysis.etapas : [];
    return steps.reduce((counts, step) => {
      const status = REVIEW_STATUSES[step.review_status] ? step.review_status : 'pending';
      counts[status] += 1;
      counts.total += 1;
      return counts;
    }, { pending: 0, approved: 0, ignored: 0, total: 0 });
  }

  function _visibleReviewedSteps(data = lastAnalysis) {
    const steps = Array.isArray(data?.analysis?.etapas) ? data.analysis.etapas : [];
    const filter = $('videoReviewFilter')?.value || 'all';
    return steps
      .map((step, index) => ({ step, index }))
      .filter(item => filter === 'all' || item.step.review_status === filter);
  }

  function _setReviewStatus(index, status) {
    const step = lastAnalysis?.analysis?.etapas?.[index];
    if (!step || !REVIEW_STATUSES[status]) return;
    step.review_status = status;
    render(lastAnalysis, { open: false });
  }

  function _approveAllVideoSteps() {
    if (!lastAnalysis?.analysis?.etapas) return;
    lastAnalysis.analysis.etapas.forEach(step => { step.review_status = 'approved'; });
    render(lastAnalysis, { open: false });
  }

  function _persistStepEdit(index, values) {
    const step = lastAnalysis?.analysis?.etapas?.[index];
    if (!step) return;
    step.acao = values.acao;
    step.detalhes = values.detalhes;
    step.tipo_acao = values.tipo_acao;
    step.alvo = step.alvo || {};
    step.alvo.texto = values.alvoTexto;
    step.alvo.seletores = values.seletor ? [values.seletor] : [];
    step.alvo.x = values.x === '' ? null : Number(values.x);
    step.alvo.y = values.y === '' ? null : Number(values.y);
    step.confianca = values.confianca === '' ? null : Math.max(0, Math.min(1, Number(values.confianca)));
    step.review_note = values.review_note || '';
    step.review_status = 'approved';
    render(lastAnalysis, { open: false });
  }

  function _createInput(label, value, options = {}) {
    const group = document.createElement('label');
    group.className = 'form-group' + (options.full ? ' full' : '');
    const caption = document.createElement('span');
    caption.className = 'form-label';
    caption.textContent = label;
    const input = options.type === 'select' ? document.createElement('select') : document.createElement('input');
    input.className = 'input-field input-field-sm';
    input.value = value ?? '';
    if (options.type !== 'select') {
      input.type = options.type || 'text';
      if (options.step) input.step = options.step;
      if (options.min !== undefined) input.min = options.min;
      if (options.max !== undefined) input.max = options.max;
    }
    if (options.type === 'select') {
      (options.options || []).forEach(([optionValue, optionLabel]) => {
        const option = document.createElement('option');
        option.value = optionValue;
        option.textContent = optionLabel;
        input.appendChild(option);
      });
      input.value = value || options.options?.[0]?.[0] || '';
    }
    group.append(caption, input);
    return { group, input };
  }

  function _reviewStepEditor(step, index) {
    const editor = document.createElement('div');
    editor.className = 'video-review-editor';

    const action = _createInput('Ação', step.acao || '', { full: true });
    const details = _createInput('Detalhes', step.detalhes || '', { full: true });
    const type = _createInput('Tipo de ação', step.tipo_acao || 'other', { type: 'select', options: ACTION_OPTIONS });
    const targetText = _createInput('Texto / alvo', step.alvo?.texto || '', {});
    const selector = _createInput('Seletor', step.alvo?.seletores?.[0] || '', {});
    const x = _createInput('X', step.alvo?.x ?? '', { type: 'number', step: '1' });
    const y = _createInput('Y', step.alvo?.y ?? '', { type: 'number', step: '1' });
    const confidence = _createInput('Confiança', step.confianca ?? '', { type: 'number', step: '0.01', min: '0', max: '1' });
    const note = _createInput('Observação da revisão', step.review_note || '', { full: true });

    editor.append(
      action.group, details.group, type.group, targetText.group,
      selector.group, x.group, y.group, confidence.group, note.group
    );

    const actions = document.createElement('div');
    actions.className = 'video-review-actions full';

    const approve = document.createElement('button');
    approve.className = 'btn btn-primary btn-sm';
    approve.type = 'button';
    approve.textContent = 'Aprovar';
    approve.addEventListener('click', () => _persistStepEdit(index, {
      acao: action.input.value.trim(),
      detalhes: details.input.value.trim(),
      tipo_acao: type.input.value,
      alvoTexto: targetText.input.value.trim(),
      seletor: selector.input.value.trim(),
      x: x.input.value,
      y: y.input.value,
      confianca: confidence.input.value,
      review_note: note.input.value.trim()
    }));

    const pending = document.createElement('button');
    pending.className = 'btn btn-ghost btn-sm';
    pending.type = 'button';
    pending.textContent = 'Manter para revisar';
    pending.addEventListener('click', () => _setReviewStatus(index, 'pending'));

    const ignore = document.createElement('button');
    ignore.className = 'btn btn-ghost btn-sm';
    ignore.type = 'button';
    ignore.textContent = 'Ignorar';
    ignore.addEventListener('click', () => _setReviewStatus(index, 'ignored'));

    actions.append(approve, pending, ignore);
    editor.appendChild(actions);
    return editor;
  }

  function _updateReviewSummary() {
    const summary = $('videoReviewSummary');
    if (!summary) return;
    const counts = _reviewCounts();
    summary.textContent =
      counts.approved + ' aprovadas · ' +
      counts.pending + ' para revisar · ' +
      counts.ignored + ' ignoradas';
  }

  function _automationValue(step) {
    const data = step?.dados || {};
    if (data.sensivel) return '{{DADO_SENSIVEL}}';
    return data.valor || '';
  }

  function _automationTarget(step) {
    const target = step?.alvo || {};
    const selectors = Array.isArray(target.seletores) ? target.seletores.filter(Boolean) : [];
    const selector = selectors[0] || '';
    const text = target.texto || '';
    const x = Number.isFinite(Number(target.x)) ? Number(target.x) : null;
    const y = Number.isFinite(Number(target.y)) ? Number(target.y) : null;
    return { selector, text, x, y };
  }

  function _pyString(value) {
    return JSON.stringify(String(value ?? ''));
  }

  function _seleniumLocator(target) {
    const selector = target.selector;
    if (selector) {
      const match = selector.match(/^(css|xpath|id|name|class|link_text|partial_link_text)=(.*)$/i);
      if (match) {
        const map = {
          css: 'CSS_SELECTOR', xpath: 'XPATH', id: 'ID', name: 'NAME',
          class: 'CLASS_NAME', link_text: 'LINK_TEXT', partial_link_text: 'PARTIAL_LINK_TEXT'
        };
        return { by: map[match[1].toLowerCase()], value: match[2] };
      }
      return { by: 'CSS_SELECTOR', value: selector };
    }
    if (target.text) return { by: 'XPATH', value: '//*[contains(normalize-space(.), ' + _pyString(target.text) + ')]' };
    return null;
  }

  function _playwrightTarget(target) {
    if (target.selector) return `page.locator(${_pyString(target.selector)})`;
    if (target.text) return `page.get_by_text(${_pyString(target.text)})`;
    return null;
  }

  function _pyautoguiStep(step, index) {
    const action = step.tipo_acao || 'other';
    const target = _automationTarget(step);
    const value = _automationValue(step);
    const comment = `# Etapa ${step.ordem || index + 1}: ${String(step.acao || step.detalhes || '').replace(/\\n/g, ' ')}`;
    const lines = [comment];
    const hasPoint = target.x !== null && target.y !== null;
    if (step.espera_segundos) lines.push(`time.sleep(${Number(step.espera_segundos) || 0})`);
    switch (action) {
      case 'click':
        lines.push(hasPoint ? `pyautogui.click(${target.x}, ${target.y})` : '# TODO: confirmar coordenadas do alvo e usar pyautogui.click(x, y)');
        break;
      case 'double_click':
        lines.push(hasPoint ? `pyautogui.doubleClick(${target.x}, ${target.y})` : '# TODO: confirmar coordenadas do alvo e usar pyautogui.doubleClick(x, y)');
        break;
      case 'type':
        if (hasPoint) lines.push(`pyautogui.click(${target.x}, ${target.y})`);
        lines.push(value ? `pyautogui.write(${_pyString(value)})` : `pyautogui.write(${_pyString('{{VALOR_DO_CAMPO}}')})`);
        break;
      case 'select':
        if (hasPoint) lines.push(`pyautogui.click(${target.x}, ${target.y})`);
        lines.push(value ? `pyautogui.write(${_pyString(value)})` : `# TODO: selecionar a opção observada`);
        lines.push('pyautogui.press("enter")');
        break;
      case 'hotkey':
        lines.push(`pyautogui.hotkey(${(step.alvo?.atalho || 'ctrl+s').split(/[+\\s]+/).filter(Boolean).map(k => _pyString(k.lowerCase ? k.lowerCase() : k.toLowerCase())).join(', ')})`);
        break;
      case 'keypress':
        lines.push(`pyautogui.press(${_pyString(step.alvo?.atalho || target.text || 'enter')})`);
        break;
      case 'scroll':
        lines.push(`pyautogui.scroll(${Number(step.detalhes?.match?.(/-?\\d+/)?.[0]) || -1})`);
        break;
      case 'drag':
        lines.push(hasPoint ? `pyautogui.moveTo(${target.x}, ${target.y}); pyautogui.dragRel(100, 0, duration=0.5)  # TODO: confirmar destino` : '# TODO: confirmar origem e destino do arraste');
        break;
      case 'wait':
        lines.push(`time.sleep(${Number(step.espera_segundos) || 1})`);
        break;
      default:
        lines.push(`# TODO: implementar ação "${action}" observada: ${String(step.detalhes || '').replace(/\\n/g, ' ')}`);
    }
    if (step.poscondicao) lines.push(`# Pós-condição observada: ${String(step.poscondicao).replace(/\\n/g, ' ')}`);
    return lines.join('\\n');
  }

  function _playwrightStep(step, index) {
    const action = step.tipo_acao || 'other';
    const target = _automationTarget(step);
    const locator = _playwrightTarget(target);
    const value = _automationValue(step);
    const comment = `# Etapa ${step.ordem || index + 1}: ${String(step.acao || step.detalhes || '').replace(/\\n/g, ' ')}`;
    const lines = [comment];
    if (step.espera_segundos) lines.push(`page.wait_for_timeout(${Math.round((Number(step.espera_segundos) || 0) * 1000)})`);
    switch (action) {
      case 'click': lines.push(locator ? `${locator}.click()` : '# TODO: confirmar locator do elemento'); break;
      case 'double_click': lines.push(locator ? `${locator}.dblclick()` : '# TODO: confirmar locator do elemento'); break;
      case 'type': lines.push(locator ? `${locator}.fill(${_pyString(value || '{{VALOR_DO_CAMPO}}')})` : '# TODO: confirmar locator do campo'); break;
      case 'select': lines.push(locator ? `${locator}.select_option(label=${_pyString(value || '{{OPCAO}}')})` : '# TODO: confirmar locator do select'); break;
      case 'hotkey':
      case 'keypress': lines.push(locator ? `${locator}.press(${_pyString(step.alvo?.atalho || 'Enter')})` : `page.keyboard.press(${_pyString(step.alvo?.atalho || 'Enter')})`); break;
      case 'scroll': lines.push(`page.mouse.wheel(0, ${Number(step.detalhes?.match?.(/-?\\d+/)?.[0]) || 500})`); break;
      case 'upload': lines.push(locator ? `${locator}.set_input_files(${_pyString('{{ARQUIVO}}')})` : '# TODO: confirmar locator do input[type=file]'); break;
      case 'navigate':
      case 'open': lines.push(`page.goto(${_pyString(target.text || '{{URL}}')})`); break;
      case 'check': lines.push(locator ? `# TODO: validar estado de ${locator}` : '# TODO: implementar validação observada'); break;
      case 'submit': lines.push(locator ? `${locator}.click()` : '# TODO: localizar botão de envio'); break;
      default: lines.push(`# TODO: implementar ação "${action}" observada`);
    }
    if (step.poscondicao) lines.push(`# Pós-condição observada: ${String(step.poscondicao).replace(/\\n/g, ' ')}`);
    return lines.join('\\n');
  }

  function _seleniumStep(step, index) {
    const action = step.tipo_acao || 'other';
    const target = _automationTarget(step);
    const loc = _seleniumLocator(target);
    const value = _automationValue(step);
    const comment = `# Etapa ${step.ordem || index + 1}: ${String(step.acao || step.detalhes || '').replace(/\\n/g, ' ')}`;
    const lines = [comment];
    if (step.espera_segundos) lines.push(`time.sleep(${Number(step.espera_segundos) || 0})`);
    const find = loc ? `driver.find_element(By.${loc.by}, ${_pyString(loc.value)})` : null;
    switch (action) {
      case 'click': lines.push(find ? `${find}.click()` : '# TODO: confirmar locator do elemento'); break;
      case 'double_click': lines.push(find ? `ActionChains(driver).double_click(${find}).perform()` : '# TODO: confirmar locator do elemento'); break;
      case 'type': lines.push(find ? `${find}.clear(); ${find}.send_keys(${_pyString(value || '{{VALOR_DO_CAMPO}}')})` : '# TODO: confirmar locator do campo'); break;
      case 'select': lines.push(find ? `Select(${find}).select_by_visible_text(${_pyString(value || '{{OPCAO}}')})` : '# TODO: confirmar locator do select'); break;
      case 'hotkey': lines.push(find ? `${find}.send_keys(${_pyString(step.alvo?.atalho || 'CTRL+S')})` : `ActionChains(driver).key_down(Keys.CONTROL).send_keys('s').key_up(Keys.CONTROL).perform()  # TODO: confirmar atalho`); break;
      case 'keypress': lines.push(find ? `${find}.send_keys(${_pyString(step.alvo?.atalho || 'ENTER')})` : `ActionChains(driver).send_keys(Keys.ENTER).perform()`); break;
      case 'scroll': lines.push(`driver.execute_script("window.scrollBy(0, ${Number(step.detalhes?.match?.(/-?\\d+/)?.[0]) || 500})")`); break;
      case 'navigate':
      case 'open': lines.push(`driver.get(${_pyString(target.text || '{{URL}}')})`); break;
      case 'upload': lines.push(find ? `${find}.send_keys(${_pyString('{{ARQUIVO_ABSOLUTO}}')})` : '# TODO: confirmar locator do input[type=file]'); break;
      case 'submit': lines.push(find ? `${find}.click()` : '# TODO: localizar botão de envio'); break;
      case 'check': lines.push(`# TODO: assert/validação: ${String(step.poscondicao || step.resultado || 'condição observada').replace(/\\n/g, ' ')}`); break;
      default: lines.push(`# TODO: implementar ação "${action}" observada`);
    }
    if (step.poscondicao) lines.push(`# Pós-condição observada: ${String(step.poscondicao).replace(/\\n/g, ' ')}`);
    return lines.join('\\n');
  }

  function _rpaStep(step, index) {
    const action = step.tipo_acao || 'other';
    const target = _automationTarget(step);
    const value = _automationValue(step);
    const comment = `    # Etapa ${step.ordem || index + 1}: ${String(step.acao || step.detalhes || '').replace(/\\n/g, ' ')}`;
    const locator = target.x !== null && target.y !== null
      ? `point:${target.x},${target.y}`
      : target.text ? `ocr:${JSON.stringify(target.text)}` : '';
    const lines = [comment];
    switch (action) {
      case 'click': lines.push(locator ? `    Click    ${locator}` : '    # TODO: definir locator (point:, ocr: ou image:)'); break;
      case 'double_click': lines.push(locator ? `    Double Click    ${locator}` : '    # TODO: definir locator'); break;
      case 'type': lines.push(`    Type Text    ${_pyString(value || '{{VALOR_DO_CAMPO}}')}`); break;
      case 'select': lines.push(value ? `    Type Text    ${_pyString(value)}` : '    # TODO: selecionar a opção observada'); break;
      case 'hotkey':
      case 'keypress': lines.push(`    Press Keys    ${(step.alvo?.atalho || 'enter').split(/[+\\s]+/).filter(Boolean).join('    ')}`); break;
      case 'wait': lines.push(`    Sleep    ${Number(step.espera_segundos) || 1}s`); break;
      case 'scroll': lines.push('    Scroll Down'); break;
      case 'open':
      case 'navigate': lines.push('    # TODO: abrir/navegar para a aplicação ou URL observada'); break;
      case 'upload': lines.push('    # TODO: selecionar o arquivo observado no diálogo de upload'); break;
      case 'download': lines.push('    # TODO: validar/aguardar o download observado'); break;
      case 'check': lines.push(`    # TODO: validar: ${String(step.poscondicao || step.resultado || '').replace(/\\n/g, ' ')}`); break;
      default: lines.push(`    # TODO: implementar ação "${action}" observada`);
    }
    return lines.join('\\n');
  }

  function _generateAutomation(platform, data) {
    const analysis = data?.analysis || {};
    _ensureReviewState(data);
    const steps = (Array.isArray(analysis.etapas) ? analysis.etapas : [])
      .filter(step => step.review_status === 'approved');
    const header = [
      '# Roteiro gerado pelo MarkAI Converter — revisão humana obrigatória.',
      '# As ações abaixo foram derivadas da análise observacional do vídeo.',
      '# Não execute em produção sem validar locators, coordenadas, waits e dados.',
      ''
    ];
    if (platform === 'pyautogui') {
      return [...header, 'import time', 'import pyautogui', '', `# Objetivo: ${analysis.objetivo || 'processo observado'}`, '', ...steps.map(_pyautoguiStep)].join('\\n');
    }
    if (platform === 'playwright') {
      return [...header, 'import time', 'from playwright.sync_api import sync_playwright', '', 'with sync_playwright() as p:', '    browser = p.chromium.launch(headless=False)', '    page = browser.new_page()', `    # Objetivo: ${analysis.objetivo || 'processo observado'}`, '', ...steps.map((s,i) => _playwrightStep(s,i).split('\\n').map(line => '    ' + line).join('\\n')), '', '    # browser.close()  # habilite quando a validação estiver concluída'].join('\\n');
    }
    if (platform === 'selenium') {
      return [...header, 'import time', 'from selenium import webdriver', 'from selenium.webdriver.common.by import By', 'from selenium.webdriver.common.keys import Keys', 'from selenium.webdriver.common.action_chains import ActionChains', 'from selenium.webdriver.support.ui import Select', '', 'driver = webdriver.Chrome()', `# Objetivo: ${analysis.objetivo || 'processo observado'}`, '', ...steps.map((s,i) => _seleniumStep(s,i)), '', '# driver.quit()  # habilite quando a validação estiver concluída'].join('\\n');
    }
    return [...header, '*** Settings ***', 'Library    RPA.Desktop', '', '*** Tasks ***', `Executar processo observado`, ...steps.map(_rpaStep), ''].join('\\n');
  }

  function _automationFilename(platform, data) {
    const base = String(data?.filename || 'video').replace(/\\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_') || 'video';
    return base + '-automacao-' + platform + (platform === 'rpa' ? '.robot' : '.py');
  }

  function renderAutomation(platform = 'pyautogui') {
    const code = _generateAutomation(platform, lastAnalysis);
    const output = $('videoAutomationCode');
    const status = $('videoAutomationStatus');
    if (output) output.textContent = code;
    const counts = _reviewCounts(lastAnalysis);
    if (status) status.textContent = `Roteiro ${platform}: ${counts.approved} etapa(s) aprovadas incluídas. ${counts.pending} pendente(s) e ${counts.ignored} ignorada(s).`;
    return code;
  }

  function render(data, options = {}) {
    lastAnalysis = data;
    _ensureReviewState(data);

    const analysis = data.analysis || {};
    const allSteps = Array.isArray(analysis.etapas) ? analysis.etapas : [];
    const visible = _visibleReviewedSteps(data);
    const summary = $('videoAnalysisSummary');
    const list = $('videoSteps');
    const transcript = $('videoTranscript');
    const json = $('videoJson');

    if (summary) {
      summary.replaceChildren();
      const title = document.createElement('strong');
      title.textContent = analysis.objetivo || data.filename || 'Análise do vídeo';
      const desc = document.createElement('p');
      const evidenceSummary = analysis.evidencia_resumo;
      desc.textContent = analysis.resumo || ((data.frames_analyzed || 0) + ' quadros analisados.');
      const counts = _reviewCounts(data);
      const evidenceText = document.createElement('small');
      evidenceText.textContent =
        'Revisão: ' + counts.approved + ' aprovadas · ' + counts.pending +
        ' pendentes · ' + counts.ignored + ' ignoradas' +
        (evidenceSummary
          ? ' · evidência: ' + (evidenceSummary.etapas_com_frame || 0) + '/' +
            (evidenceSummary.etapas_total || 0) + ' com frame · ' +
            (evidenceSummary.etapas_com_transcricao || 0) + '/' +
            (evidenceSummary.etapas_total || 0) + ' com fala'
          : '');
      summary.append(title, desc, evidenceText);
    }

    _updateReviewSummary();

    if (list) {
      list.replaceChildren();
      if (!visible.length) {
        const empty = document.createElement('div');
        empty.className = 'workspace-empty';
        empty.textContent = allSteps.length
          ? 'Nenhuma etapa corresponde ao filtro selecionado.'
          : 'Nenhuma etapa estruturada foi identificada.';
        list.appendChild(empty);
      }

      visible.forEach(({ step, index }) => {
        const status = REVIEW_STATUSES[step.review_status] || REVIEW_STATUSES.pending;
        const card = document.createElement('article');
        card.className = 'video-step-card review-' + status.className;

        const head = document.createElement('div');
        head.className = 'video-step-head';
        const order = document.createElement('span');
        order.className = 'video-step-order';
        order.textContent = String(step.ordem || index + 1);
        const time = document.createElement('span');
        time.className = 'video-step-time';
        time.textContent = step.timestamp || '';

        const reviewStatus = document.createElement('div');
        reviewStatus.className = 'video-review-status';
        const badge = document.createElement('span');
        badge.className = 'video-review-badge ' + status.className;
        badge.textContent = status.label;
        const statusSelect = document.createElement('select');
        statusSelect.className = 'input-field input-field-sm';
        Object.entries(REVIEW_STATUSES).forEach(([value, info]) => {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = info.label;
          statusSelect.appendChild(option);
        });
        statusSelect.value = step.review_status;
        statusSelect.addEventListener('change', event => _setReviewStatus(index, event.target.value));
        reviewStatus.append(badge, statusSelect);

        head.append(order, time, reviewStatus);

        const actionHeading = document.createElement('h4');
        actionHeading.textContent = step.acao || 'Ação não identificada';
        const details = document.createElement('p');
        details.textContent = step.detalhes || '';
        card.append(head, actionHeading, details);

        if (Array.isArray(step.elementos) && step.elementos.length) {
          const elements = document.createElement('small');
          elements.textContent = 'Elementos: ' + step.elementos.join(', ');
          card.appendChild(elements);
        }

        if (step.resultado) {
          const result = document.createElement('small');
          result.textContent = 'Resultado: ' + step.resultado;
          card.appendChild(result);
        }

        const action = step.tipo_acao || 'other';
        const actionLabel = {
          click: 'Clique', double_click: 'Duplo clique', type: 'Digitação',
          select: 'Seleção', hotkey: 'Atalho', keypress: 'Tecla',
          scroll: 'Scroll', drag: 'Arrastar', wait: 'Espera',
          open: 'Abrir', navigate: 'Navegar', download: 'Download',
          upload: 'Upload', copy: 'Copiar', paste: 'Colar',
          check: 'Validar', submit: 'Enviar', other: 'Ação'
        }[action] || action;

        const automation = document.createElement('div');
        automation.className = 'video-automation-action';
        const actionTitle = document.createElement('strong');
        actionTitle.textContent = 'Automação: ' + actionLabel;
        automation.appendChild(actionTitle);

        const target = step.alvo || {};
        const targetText = [
          target.descricao || target.texto || target.controle || '',
          target.x != null && target.y != null ? 'posição (' + target.x + ', ' + target.y + ')' : '',
          Array.isArray(target.seletores) && target.seletores.length
            ? 'seletores: ' + target.seletores.join(', ')
            : ''
        ].filter(Boolean).join(' · ');
        if (targetText) {
          const targetEl = document.createElement('small');
          targetEl.textContent = 'Alvo: ' + targetText;
          automation.appendChild(targetEl);
        }

        if (step.dados && (step.dados.campo || step.dados.valor)) {
          const dataEl = document.createElement('small');
          dataEl.textContent =
            'Dados: ' + (step.dados.campo || '') +
            (step.dados.valor ? ' = ' + step.dados.valor : '') +
            (step.dados.sensivel ? ' [sensível]' : '');
          automation.appendChild(dataEl);
        }

        if (step.espera_segundos) {
          const waitEl = document.createElement('small');
          waitEl.textContent = 'Espera: ' + step.espera_segundos + 's';
          automation.appendChild(waitEl);
        }

        if (step.precondicao || step.poscondicao) {
          const verifyEl = document.createElement('small');
          verifyEl.textContent = [
            step.precondicao ? 'Pré: ' + step.precondicao : '',
            step.poscondicao ? 'Pós: ' + step.poscondicao : ''
          ].filter(Boolean).join(' · ');
          automation.appendChild(verifyEl);
        }

        const evidence = step.evidencia || {};
        if ((evidence.frame_indices && evidence.frame_indices.length) ||
            (evidence.transcript_segment_indices && evidence.transcript_segment_indices.length)) {
          const evidenceEl = document.createElement('small');
          const frameLabel = evidence.frame_indices?.length
            ? 'frames: ' + evidence.frame_indices.join(', ')
            : '';
          const transcriptLabel = evidence.transcript_segment_indices?.length
            ? 'fala: ' + evidence.transcript_segment_indices.join(', ')
            : '';
          evidenceEl.textContent = 'Evidência: ' + [frameLabel, transcriptLabel].filter(Boolean).join(' · ');
          automation.appendChild(evidenceEl);
        }

        if (step.confianca != null) {
          const confidence = document.createElement('small');
          confidence.className = 'video-confidence';
          confidence.textContent = 'Confiança informada: ' + Math.round(Number(step.confianca) * 100) + '%';
          automation.appendChild(confidence);
        }

        card.appendChild(automation);

        const editor = _reviewStepEditor(step, index);
        card.appendChild(editor);

        list.appendChild(card);
      });
    }

    if (transcript) transcript.textContent = data.transcript || 'Nenhuma fala identificada.';
    if (json) json.textContent = JSON.stringify({ ...data, analysis }, null, 2);

    const automationTarget = $('videoAutomationTarget');
    if (automationTarget) {
      automationTarget.value =
        analysis?.automacao?.plataforma_sugerida &&
        ['pyautogui', 'playwright', 'selenium', 'rpa'].includes(analysis.automacao.plataforma_sugerida)
          ? analysis.automacao.plataforma_sugerida
          : 'pyautogui';
    }

    renderAutomation(automationTarget?.value || 'pyautogui');
    if (window.lucide?.createIcons) window.lucide.createIcons();
    if (options.open !== false) openModal();
  }

  async function analyzeYoutube(url) {
    const normalized = String(url || '').trim();
    if (!normalized) return;
    const overlay = $('procOverlay');
    const label = $('procLabel');
    const sub = $('procSub');
    if (overlay) overlay.style.display = 'flex';
    if (label) label.textContent = 'Analisando YouTube…';
    if (sub) sub.textContent = 'Obtendo transcrição, vídeo, quadros e eventos de tela.';
    try {
      const endpointUrl = endpoint();
      const languages = $('youtubeLanguage')?.value;
      const languageList = languages && languages !== 'auto'
        ? [languages, 'pt-BR', 'pt', 'en', 'es']
        : ['pt-BR', 'pt', 'en', 'es'];
      const payload = {
        url: normalized,
        languages: [...new Set(languageList)],
        translate_to: $('youtubeTranslate')?.value || null,
        task_prompt: $('videoPrompt')?.value || ''
      };
      const response = await fetch(endpointUrl + '/api/youtube/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(600000)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = typeof data.detail === 'object'
          ? (data.detail.message || data.detail.code)
          : data.detail;
        throw new Error(detail || ('Falha HTTP ' + response.status));
      }
      render(data);
      if (typeof toast === 'function') toast('Análise multimodal do YouTube concluída.', 'success');
    } catch (error) {
      if (typeof toast === 'function') toast('Falha no YouTube: ' + error.message, 'error');
      else alert('Falha no YouTube: ' + error.message);
    } finally {
      if (overlay) overlay.style.display = 'none';
    }
  }

  async function analyze(file) {
    if (!file) return;
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('task_prompt', $('videoPrompt')?.value || '');
    const overlay = $('procOverlay');
    const label = $('procLabel');
    const sub = $('procSub');
    if (overlay) overlay.style.display = 'flex';
    if (label) label.textContent = 'Analisando vídeo…';
    if (sub) sub.textContent = 'Extraindo áudio, quadros e tarefas realizadas.';
    try {
      const response = await fetch(endpoint() + '/api/analyze-video', {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(300000)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || ('Falha HTTP ' + response.status));
      render(data);
      if (typeof toast === 'function') toast('Análise de vídeo concluída.', 'success');
    } catch (error) {
      if (typeof toast === 'function') toast('Falha na análise: ' + error.message, 'error');
      else alert('Falha na análise: ' + error.message);
    } finally {
      if (overlay) overlay.style.display = 'none';
    }
  }

  function isVideo(file) {
    return !!file && (
      String(file.type || '').startsWith('video/') ||
      /\.(mp4|mov|webm|mkv|avi)$/i.test(file.name || '')
    );
  }

  function bind() {
    const input = $('videoInput');
    const button = $('btnVideoAnalyze');
    const drop = $('dropZone');

    button?.addEventListener('click', () => input?.click());
    input?.addEventListener('change', () => {
      const file = input.files?.[0];
      if (isVideo(file)) analyze(file);
      input.value = '';
    });

    // Capture only video drops; ordinary document drops continue to the existing queue.
    drop?.addEventListener('drop', event => {
      const files = event.dataTransfer?.files;
      if (!Array.from(files || []).some(isVideo)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      analyze(Array.from(files).find(isVideo));
    }, true);

    $('btnYoutubeAnalyze')?.addEventListener('click', () => {
      const url = $('urlInput')?.value?.trim();
      if (!URLFetcher.isYouTubeUrl(url)) {
        toast('Informe uma URL do YouTube antes de analisar o processo.', 'warning');
        return;
      }
      analyzeYoutube(url);
    });

    $('videoReviewFilter')?.addEventListener('change', () => {
      if (lastAnalysis) render(lastAnalysis, { open: false });
    });
    $('btnApproveAllVideoSteps')?.addEventListener('click', () => {
      _approveAllVideoSteps();
      if (typeof toast === 'function') toast('Todas as etapas foram aprovadas para geração.', 'success');
    });

    $('btnGenerateVideoAutomation')?.addEventListener('click', () => {
      renderAutomation($('videoAutomationTarget')?.value || 'pyautogui');
    });
    $('videoAutomationTarget')?.addEventListener('change', event => {
      if (lastAnalysis) renderAutomation(event.target.value);
    });
    $('btnCopyVideoAutomation')?.addEventListener('click', async () => {
      if (!lastAnalysis) return;
      const code = renderAutomation($('videoAutomationTarget')?.value || 'pyautogui');
      await navigator.clipboard.writeText(code);
      if (typeof UIManager !== 'undefined' && UIManager.toast) UIManager.toast('Roteiro de automação copiado.', 'success');
    });
    $('btnDownloadVideoAutomation')?.addEventListener('click', () => {
      if (!lastAnalysis) return;
      const platform = $('videoAutomationTarget')?.value || 'pyautogui';
      const code = renderAutomation(platform);
      const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = _automationFilename(platform, lastAnalysis);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    $('btnCloseVideoAnalysis')?.addEventListener('click', () => $('modalVideoAnalysis')?.close());
    $('btnCloseVideoAnalysis2')?.addEventListener('click', () => $('modalVideoAnalysis')?.close());
    $('btnCopyVideoJson')?.addEventListener('click', async () => {
      if (!lastAnalysis) return;
      await navigator.clipboard.writeText(JSON.stringify(lastAnalysis, null, 2));
      if (typeof toast === 'function') toast('JSON copiado.', 'success');
    });
    $('btnDownloadVideoJson')?.addEventListener('click', () => {
      if (!lastAnalysis) return;
      const blob = new Blob([JSON.stringify(lastAnalysis, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (lastAnalysis.filename || 'video').replace(/\.[^.]+$/, '') + '-analise.json';
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  return { bind, analyze, analyzeYoutube, render };
})();

document.addEventListener('DOMContentLoaded', () => VideoTaskAnalyzer.bind());
