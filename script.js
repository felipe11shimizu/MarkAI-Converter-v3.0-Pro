/**
 * MarkAI Converter v3.0 Pro
 * Architecture: IIFE-wrapped classes for file:/// compatibility
 * Modules: AppState (Proxy), QueueManager, FileParserStrategy,
 *          MergeEngine, URLFetcher, ChatFormatter, AIEngine, UIManager
 */
'use strict';

// Core state/queue modules are loaded before this legacy-compatible controller.
const AppState = globalThis.MarkAICore.AppState;
const QueueManager = globalThis.MarkAICore.QueueManager;

// Workspace persistence is provided by frontend/modules/workspace_store.js.
const WorkspaceStore = globalThis.MarkAIWorkspace;
let WorkspaceController = null;
let YouTubeController = null;
let EditorController = null;
let VideoAutomationController = null;
let SettingsController = null;
let WorkspaceUIController = null;
let QueueUIController = null;
let EditorUIController = null;
let UrlUIController = null;
let AIUIController = null;
let ComparisonUIController = null;
let FileActionsUIController = null;

// MarkItDown service is provided by frontend/modules/markitdown_engine.js.
const MarkItDownEngine = globalThis.MarkAIConversion.MarkItDownEngine;

// File parser strategy is provided by frontend/modules/file_parser.js.
const FileParserStrategy = globalThis.MarkAIFileParser;

// DOM/presentation primitives are provided by frontend/modules/ui_dom.js.
const UIDom = globalThis.MarkAIUIDom;
const MergeEngine = globalThis.MarkAIMergeEngine.create({
  queueManager: QueueManager,
  fileParserStrategy: FileParserStrategy,
  renderQueue: () => UIManager.renderQueue(),
});

// URL ingestion service is provided by frontend/modules/url_fetcher.js.
const URLFetcher = globalThis.MarkAIUrlService;

// ChatFormatter is provided by frontend/modules/chat_formatter.js.
const ChatFormatter = globalThis.MarkAIChatFormatter;

// AI service is provided by frontend/modules/ai_engine.js.
const AIEngine = globalThis.MarkAIAIEngine.create({
  getSettings: () => AppState.get('settings'),
});
 
// Conversion quality is provided by frontend/modules/conversion_quality.js.
const ConversionQuality = globalThis.MarkAIConversionQuality;
const ConversionController = globalThis.MarkAIConversionController.create({
  queueManager: QueueManager,
  markItDownEngine: MarkItDownEngine,
  fileParserStrategy: FileParserStrategy,
  conversionQuality: ConversionQuality,
  mergeEngine: MergeEngine,
  getState: () => ({
  }),
  setState: patch => Object.entries(patch).forEach(([key, value]) => AppState.set(key, value)),
  ui: {
    renderQueue: () => UIManager.renderQueue(),
    setStatus: (text, state) => UIManager.setStatus(text, state),
    setProgress: (pct, show) => UIManager.setProgress(pct, show),
    loadMarkdown: (md, name) => UIManager.loadMarkdown(md, name),
    toast: (msg, type) => UIManager.toast(msg, type),
    showProcessing: (label, sub) => UIManager.showProcessing(label, sub),
    hideProcessing: () => UIManager.hideProcessing(),
    setProcessingSub: sub => UIManager.setProcessingSub(sub),
    showComparison: (item, rmd, bmd, rm, bm, diff) => UIManager.showComparison(item, rmd, bmd, rm, bm, diff),
  },
  workspace: { scheduleSave: () => UIManager.scheduleWorkspaceSave() },
});


// ══════════════════════════════════════════════
// 8. UI MANAGER — DOM, events, toasts, modals
// ══════════════════════════════════════════════
const UIManager = (() => {
  // DOM and presentation helpers are provided by frontend/modules/ui_dom.js.
  const UIDomView = UIDom.create();
  const $ = UIDomView.$;
  const els = UIDomView.els;
  const EXT_LABELS = UIDom.EXT_LABELS;
  const CODE_EXTS = UIDom.CODE_EXTS;
  const _extClass = UIDom.extClass;
  const _formatSize = UIDom.formatSize;
  const _sanitizeMarkdownHtml = UIDom.sanitizeMarkdownHtml;
  const _escapeHtml = UIDom.escapeHtml;

  // ── WORKSPACE PRESENTATION ──
  let _workspaceHistoryMode = 'versions';

  function _refreshWorkspaceProjects(projects = []) {
    const activeId = AppState.get('currentProjectId');
    els.workspaceProjectSelect.innerHTML = projects.map(p =>
      '<option value="' + p.id + '"' + (p.id === activeId ? ' selected' : '') + '>' +
      _escapeHtml(p.name) + '</option>'
    ).join('');
    els.workspaceProjectList.innerHTML = projects.length ? projects.map(p => {
      const countLabel = p.id === activeId ? ' · ativo' : '';
      return '<div class="workspace-project-item' + (p.id === activeId ? ' active' : '') + '" data-project-id="' + p.id + '">' +
        '<div class="workspace-project-name">' + _escapeHtml(p.name) + '</div>' +
        '<div class="workspace-project-meta">Atualizado ' + new Date(p.updatedAt || p.createdAt).toLocaleString('pt-BR') + countLabel + '</div>' +
      '</div>';
    }).join('') : '<div class="workspace-empty">Nenhum projeto.</div>';
  }

  function _renderWorkspaceHistory(records = []) {
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
        '<div class="workspace-history-title">' + _escapeHtml(title) + '</div>' +
        '<div class="workspace-history-meta">' + new Date(item.createdAt).toLocaleString('pt-BR') + '</div>' +
        '<div class="workspace-history-preview">' + _escapeHtml(preview) + '</div>' +
      '</div>';
    }).join('');
  }

  async function _openWorkspace() {
    try {
      await WorkspaceController.listProjects();
      await WorkspaceController.listHistory(_workspaceHistoryMode);
      els.modalWorkspace.showModal();
    } catch (e) {
      toast('Erro ao abrir workspace: ' + e.message, 'error');
    }
  }

  function _showCurrentWorkspaceDocument(item) {
    if (item?.result) loadMarkdown(item.result, item.name.replace(/\.[^.]+$/, '') + '.md');
  }

  function _showEmptyWorkspace() {
    AppState.set('currentMd', '');
    els.workspaceContent.style.display = 'none';
    els.emptyState.style.display = 'flex';
  }

  // ── EDITOR CONTROLLER ADAPTERS ──
  function loadMarkdown(md, fileName) {
    return EditorController ? EditorController.loadMarkdown(md, fileName) : null;
  }

  function _updateStats(md) {
    if (EditorController) EditorController.updateStats(md);
  }

  function _renderPreview(md) {
    if (EditorController) EditorController.renderPreview(md);
  }

  function _switchTab(tab) {
    if (EditorController) EditorController.switchTab(tab.dataset.panel);
  }

  // ── INIT EVENT LISTENERS ──
  function init() {
    AppState.loadSettings();
    SettingsController.sync();
    _setupMarkdown();
    WorkspaceController.init().catch(error => {
      console.warn('[MarkAI] Workspace initialization failed:', error);
      toast('Não foi possível carregar o workspace.', 'error');
    });

    WorkspaceUIController.bind();

    QueueUIController.bind();

    // URL ingestion is delegated to UrlUIController.
    els.urlInput.addEventListener('input', () => YouTubeController.updateControls(els.urlInput.value.trim()));
    els.btnYoutubeTranscribe?.addEventListener('click', () => YouTubeController.transcribe(els.urlInput.value.trim(), _youtubeOptions()));
    els.btnYoutubeLanguages?.addEventListener('click', () => YouTubeController.listLanguages(els.urlInput.value.trim()));
    YouTubeController.updateControls(els.urlInput.value.trim());

    // Chat format
    els.btnFormatChat.addEventListener('click', () => {
      const text = els.chatInput.value.trim();
      if (!text) { toast('Cole uma transcrição no campo acima.', 'warning'); return; }
      const md = ChatFormatter.format(text);
      loadMarkdown(md, 'conversa_ia.md');
      toast('✓ Conversa formatada!', 'success');
    });

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

    // Download/reset actions are delegated to FileActionsUIController.

    // AI enhancement is delegated to AIUIController.

    // Settings events are delegated to SettingsController.

    // Comparison UI binding is performed after controller construction.

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

  // Queue UI interactions are delegated to QueueUIController.

  // ── YOUTUBE PRESENTATION ──
  function _youtubeOptions() {
    return { language: els.youtubeLanguage?.value || 'auto', translateTo: els.youtubeTranslate?.value || null };
  }

  function setProcessingSub(text) {
    if (els.procSub) els.procSub.textContent = String(text ?? '');
  }

  function scheduleWorkspaceSave() {
    WorkspaceController.scheduleSave();
  }

  function showComparison(item, rmd, bmd, rm, bm, diff) {
    els.compareFileName.textContent = item.name;
    els.compareMarkitdown.value = rmd || 'MarkItDown indisponível ou falhou.';
    els.compareBrowser.value = bmd || 'Conversor local indisponível para este formato.';
    els.compareMarkitdownStats.textContent = rmd
      ? 'chars: ' + rm.characters.toLocaleString('pt-BR') + ' · linhas: ' + rm.lines + ' · headings: ' + rm.headings + ' · tabelas: ' + rm.tables + ' · links: ' + rm.links + ' · divergência: ' + diff + '%'
      : 'Indisponível';
    els.compareBrowserStats.textContent = bmd
      ? 'chars: ' + bm.characters.toLocaleString('pt-BR') + ' · linhas: ' + bm.lines + ' · headings: ' + bm.headings + ' · tabelas: ' + bm.tables + ' · links: ' + bm.links + ' · divergência: ' + diff + '%'
      : 'Indisponível';
    els.modalCompare.showModal();
  }

  return { init, renderQueue, loadMarkdown, toast, setStatus, setProgress, showProcessing, hideProcessing,
    setProcessingSub, scheduleWorkspaceSave, showComparison,
    setEditorWorkspaceVisible: visible => {
      els.emptyState.style.display = visible ? 'none' : 'flex';
      els.workspaceContent.style.display = visible ? 'flex' : 'none';
      if (visible) {
        els.workspaceContent.style.flexDirection = 'column';
        els.workspaceContent.style.height = '100%';
      }
    },
    setEmptyState: empty => {
      els.emptyState.style.display = empty ? 'flex' : 'none';
      els.workspaceContent.style.display = empty ? 'none' : 'flex';
    },
    setEditorDocumentName: name => {
      els.docName.textContent = name || 'documento.md';
      els.docName.title = name || 'documento.md';
    },
    setEditorValues: md => {
      els.markdownEditor.value = md;
      els.markdownEditorSplit.value = md;
    },
    syncEditorValues: md => {
      if (document.activeElement === els.markdownEditor) els.markdownEditorSplit.value = md;
      else els.markdownEditor.value = md;
    },
    setEditorStats: stats => {
      els.statWords.textContent = stats.words;
      els.statLines.textContent = stats.lines;
      els.statChars.textContent = stats.chars;
    },
    setEditorPreviewHtml: html => {
      [els.markdownPreview, els.markdownPreviewSplit].forEach(el => { el.innerHTML = html; });
    },
    renderEditorPreview: (html, settings) => {
      [els.markdownPreview, els.markdownPreviewSplit].forEach(el => {
        el.innerHTML = html;
        if (settings.syntaxHL) el.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
      });
    },
    setEditorActivePanel: panelId => {
      const panels = { panelRaw: els.panelRaw, panelPreview: els.panelPreview, panelSplit: els.panelSplit };
      const tabs = [els.tabRaw, els.tabPreview, els.tabSplit];
      tabs.forEach(t => t.classList.remove('active'));
      Object.values(panels).forEach(p => p.style.display = 'none');
      if (panels[panelId]) panels[panelId].style.display = 'flex';
      const tab = tabs.find(t => t.dataset.panel === panelId);
      if (tab) tab.classList.add('active');
    },
    setEditorSplitValue: md => { els.markdownEditorSplit.value = md; },
    clearEditorsAndPreview: () => {
      els.markdownEditor.value = '';
      els.markdownEditorSplit.value = '';
      els.markdownPreview.innerHTML = '';
      els.markdownPreviewSplit.innerHTML = '';
    },
    setPreviewFileName: name => { els.previewFileName.textContent = name || ''; },
    clearPreviewContent: () => { els.previewContent.innerHTML = ''; },
    setPreviewHtml: (html, settings) => {
      els.previewContent.innerHTML = html;
      if (settings.syntaxHL) els.previewContent.querySelectorAll('pre code').forEach(b => hljs.highlightElement(b));
    },
    setPreviewRawContent: value => {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = value;
      pre.appendChild(code);
      els.previewContent.replaceChildren(pre);
    },
    setPreviewRawLabel: label => { els.btnPreviewRaw.textContent = label; },
    showPreviewModal: () => els.modalPreview.showModal(),
    renderWorkspacePreview: () => {},
    getWorkspaceHistoryMode: () => _workspaceHistoryMode,
    setWorkspaceHistoryMode: mode => { _workspaceHistoryMode = mode === 'ai' ? 'ai' : 'versions'; },
    refreshWorkspaceProjects: _refreshWorkspaceProjects,
    renderWorkspaceHistory: _renderWorkspaceHistory,
    showCurrentWorkspaceDocument: _showCurrentWorkspaceDocument,
    showEmptyWorkspace: _showEmptyWorkspace,
    setWorkspaceStatus: text => { if (els.workspaceStatus) els.workspaceStatus.textContent = String(text ?? ''); },
    setYoutubeControlsVisible: visible => { if (els.youtubeControls) els.youtubeControls.hidden = !visible; },
    setYoutubeStatusText: text => { if (els.youtubeStatus) els.youtubeStatus.textContent = String(text ?? ''); },
    setSettingsForm: settings => {
      els.aiProvider.value = settings.aiProvider;
      els.aiModel.value = settings.aiModel;
      els.aiApiKey.value = settings.apiKey;
      els.toggleMarkItDown.checked = settings.markitdownEnabled !== false;
      els.markitdownEndpoint.value = settings.markitdownEndpoint;
      els.toggleSyntaxHL.checked = settings.syntaxHL !== false;
      els.toggleAutoPreview.checked = settings.autoPreview !== false;
    },
    readSettingsForm: () => ({
      aiProvider: els.aiProvider.value,
      aiModel: els.aiModel.value,
      apiKey: els.aiApiKey.value,
      markitdownEnabled: els.toggleMarkItDown.checked,
      markitdownEndpoint: els.markitdownEndpoint.value.trim() || 'http://localhost:8000',
      syntaxHL: els.toggleSyntaxHL.checked,
      autoPreview: els.toggleAutoPreview.checked
    }),
    filterAIModels: provider => {
      const geminiOpts = els.aiModel.querySelectorAll('option[value^="gemini"]');
      const openaiOpts = els.aiModel.querySelectorAll('option[value^="gpt"]');
      geminiOpts.forEach(o => o.style.display = provider === 'gemini' ? '' : 'none');
      openaiOpts.forEach(o => o.style.display = provider === 'openai' ? '' : 'none');
      const first = Array.from(els.aiModel.options).find(o => o.style.display !== 'none');
      if (first && !els.aiModel.value.startsWith(provider === 'gemini' ? 'gemini' : 'gpt')) {
        els.aiModel.value = first.value;
      }
    },
    setApiKeyValue: value => { els.aiApiKey.value = value || ''; },
    toggleApiKeyVisibility: () => {
      const isPass = els.aiApiKey.type === 'password';
      els.aiApiKey.type = isPass ? 'text' : 'password';
      els.btnToggleKey.querySelector('i').setAttribute('data-lucide', isPass ? 'eye-off' : 'eye');
      lucide.createIcons();
      return isPass;
    },
    closeSettings: () => els.modalSettings.close(),
    bindSettingsEvents: handlers => {
      els.btnSettings.addEventListener('click', () => {
        handlers.open();
        els.modalSettings.showModal();
      });
      els.btnCloseSettings.addEventListener('click', handlers.close);
      els.modalSettings.addEventListener('click', e => {
        if (e.target === els.modalSettings) handlers.backdrop();
      });
      els.btnSaveSettings.addEventListener('click', handlers.save);
      els.btnClearApiKey.addEventListener('click', handlers.clearApiKey);
      els.btnToggleKey.addEventListener('click', handlers.toggleApiKey);
      els.aiProvider.addEventListener('change', handlers.providerChange);
    }
  };
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

  // Compose application services before UI boot.
  EditorController = globalThis.MarkAIEditorController.create({
    getState: () => ({
      currentMd: AppState.get('currentMd'),
      currentFileName: AppState.get('currentFileName'),
      activePanel: AppState.get('activePanel'),
      settings: AppState.get('settings'),
      previewItemId: AppState.get('previewItemId')
    }),
    setState: patch => Object.entries(patch).forEach(([key, value]) => AppState.set(key, value)),
    queueManager: QueueManager,
    fileParserStrategy: FileParserStrategy,
    sanitizeMarkdownHtml: md => UIDom.sanitizeMarkdownHtml(md),
    scheduleSave: () => WorkspaceController.scheduleSave(),
    ui: {
      setStats: stats => UIManager.setEditorStats(stats),
      setPreviewHtml: (html, settings) => UIManager.setPreviewHtml(html, settings),
      setWorkspaceVisible: visible => UIManager.setEditorWorkspaceVisible(visible),
      setDocumentName: name => UIManager.setEditorDocumentName(name),
      setEditorValues: md => UIManager.setEditorValues(md),
      setSplitEditorValue: md => UIManager.setEditorSplitValue(md),
      setActivePanel: panelId => UIManager.setEditorActivePanel(panelId),
      syncEditorValues: md => UIManager.syncEditorValues(md),
      clearEditorsAndPreview: () => UIManager.clearEditorsAndPreview(),
      setProgress: (pct, show) => UIManager.setProgress(pct, show),
      setStatus: (text, state) => UIManager.setStatus(text, state),
      setPreviewFileName: name => UIManager.setPreviewFileName(name),
      clearPreviewContent: () => UIManager.clearPreviewContent(),
      showProcessing: (label, sub) => UIManager.showProcessing(label, sub),
      hideProcessing: () => UIManager.hideProcessing(),
      renderQueue: () => UIManager.renderQueue(),
      toast: (message, type) => UIManager.toast(message, type),
      setPreviewRawLabel: label => UIManager.setPreviewRawLabel(label),
      setPreviewRawContent: value => UIManager.setPreviewRawContent(value),
      showPreviewModal: () => UIManager.showPreviewModal()
    }
  });

  EditorUIController = globalThis.MarkAIEditorUIController.create({
    editorController: EditorController,
    elements: {
      tabs: [document.getElementById('tabRaw'), document.getElementById('tabPreview'), document.getElementById('tabSplit')],
      markdownEditor: document.getElementById('markdownEditor'),
      markdownEditorSplit: document.getElementById('markdownEditorSplit'),
      btnPreviewRaw: document.getElementById('btnPreviewRaw')
    }
  });

  AIUIController = globalThis.MarkAIAIUIController.create({
    aiEngine: AIEngine,
    getState: () => ({
      currentMd: AppState.get('currentMd'),
      currentFileName: AppState.get('currentFileName'),
      currentProjectId: AppState.get('currentProjectId'),
      settings: AppState.get('settings')
    }),
    workspaceStore: WorkspaceStore,
    workspaceController: {
      saveVersion: (...args) => WorkspaceController.saveVersion(...args)
    },
    elements: {
      btnEnhanceAI: document.getElementById('btnEnhanceAI'),
      workspaceAIPrompt: document.getElementById('workspaceAIPrompt')
    },
    ui: {
      toast: (message, type) => UIManager.toast(message, type),
      openSettings: () => UIManager.openSettings(),
      setStatus: (text, state) => UIManager.setStatus(text, state),
      loadMarkdown: (md, name) => UIManager.loadMarkdown(md, name)
    }
  });

  UrlUIController = globalThis.MarkAIUrlUIController.create({
    urlService: URLFetcher,
    youtubeController: {
      updateControls: (...args) => YouTubeController.updateControls(...args),
      transcribe: (...args) => YouTubeController.transcribe(...args)
    },
    elements: {
      urlInput: document.getElementById('urlInput'),
      btnFetchUrl: document.getElementById('btnFetchUrl'),
      youtubeLanguage: document.getElementById('youtubeLanguage'),
      youtubeTranslate: document.getElementById('youtubeTranslate')
    },
    ui: {
      showProcessing: (label, sub) => UIManager.showProcessing(label, sub),
      hideProcessing: () => UIManager.hideProcessing(),
      setStatus: (text, state) => UIManager.setStatus(text, state),
      loadMarkdown: (md, name) => UIManager.loadMarkdown(md, name),
      toast: (message, type) => UIManager.toast(message, type)
    }
  });

  WorkspaceController = globalThis.MarkAIWorkspaceController.create({
    workspaceStore: WorkspaceStore,
    queueManager: QueueManager,
    getState: () => ({
      currentProjectId: AppState.get('currentProjectId'),
      queue: AppState.get('queue'),
      currentMd: AppState.get('currentMd'),
      currentFileName: AppState.get('currentFileName')
    }),
    setState: patch => Object.entries(patch).forEach(([key, value]) => AppState.set(key, value)),
    ui: {
      setWorkspaceStatus: text => UIManager.setWorkspaceStatus(text),
      renderQueue: () => UIManager.renderQueue(),
      refreshProjects: projects => UIManager.refreshWorkspaceProjects(projects),
      renderHistory: records => UIManager.renderWorkspaceHistory(records),
      toast: (message, type) => UIManager.toast(message, type),
      showCurrentDocument: item => UIManager.showCurrentWorkspaceDocument(item),
      showEmptyWorkspace: () => UIManager.showEmptyWorkspace()
    }
  });

  QueueUIController = globalThis.MarkAIQueueUIController.create({
    queueManager: QueueManager,
    conversionController: ConversionController,
    workspaceController: WorkspaceController,
    editorController: EditorController,
    getState: () => ({ queue: AppState.get('queue') }),
    ui: {
      renderQueue: () => UIManager.renderQueue(),
      loadMarkdown: (md, name) => UIManager.loadMarkdown(md, name),
      showProcessing: (label, sub) => UIManager.showProcessing(label, sub),
      hideProcessing: () => UIManager.hideProcessing(),
      setStatus: (text, state) => UIManager.setStatus(text, state),
      setProcessingSub: text => UIManager.setProcessingSub(text),
      setEmptyState: empty => UIManager.setEmptyState(empty),
      toast: (message, type) => UIManager.toast(message, type)
    },
    timers: {
      setTimeout: globalThis.setTimeout
    }
  });

  WorkspaceUIController = globalThis.MarkAIWorkspaceUIController.create({
    workspaceController: WorkspaceController,
    workspaceStore: WorkspaceStore,
    getState: () => ({
      currentProjectId: AppState.get('currentProjectId')
    }),
    ui: {
      getHistoryMode: () => UIManager.getWorkspaceHistoryMode(),
      setHistoryMode: mode => UIManager.setWorkspaceHistoryMode(mode),
      loadMarkdown: (md, name) => UIManager.loadMarkdown(md, name),
      toast: (message, type) => UIManager.toast(message, type)
    }
  });

  YouTubeController = globalThis.MarkAIYouTubeController.create({
    urlService: URLFetcher,
    getSettings: () => AppState.get('settings'),
    ui: {
      setControlsVisible: visible => UIManager.setYoutubeControlsVisible(visible),
      setStatusText: text => UIManager.setYoutubeStatusText(text),
      showProcessing: (label, sub) => UIManager.showProcessing(label, sub),
      hideProcessing: () => UIManager.hideProcessing(),
      setStatus: (text, state) => UIManager.setStatus(text, state),
      loadMarkdown: (md, name) => UIManager.loadMarkdown(md, name),
      toast: (msg, type) => UIManager.toast(msg, type)
    }
  });

  VideoAutomationController = globalThis.MarkAIVideoAutomationController.create({
    getSettings: () => AppState.get('settings'),
    urlService: URLFetcher,
    validator: globalThis.MarkAIAutomationValidator,
    ui: {
      toast: (message, type) => UIManager.toast(message, type)
    }
  });
  
  SettingsController = globalThis.MarkAISettingsController.create({
    getSettings: () => AppState.get('settings'),
    setSettings: settings => AppState.set('settings', settings),
    saveSettings: () => AppState.saveSettings(),
    ui: {
      setSettingsForm: settings => UIManager.setSettingsForm(settings),
      readSettingsForm: () => UIManager.readSettingsForm(),
      filterAIModels: provider => UIManager.filterAIModels(provider),
      setApiKeyValue: value => UIManager.setApiKeyValue(value),
      toggleApiKeyVisibility: () => UIManager.toggleApiKeyVisibility(),
      closeSettings: () => UIManager.closeSettings(),
      bindSettingsEvents: handlers => UIManager.bindSettingsEvents(handlers),
      toast: (message, type) => UIManager.toast(message, type)
    }
  });

  // Boot UI
  UIManager.init();
  EditorUIController.bind();
  UrlUIController.bind();
  AIUIController.bind();


  ComparisonUIController = globalThis.MarkAIComparisonUIController.create({
    queueManager: QueueManager,
    conversionController: ConversionController,
    getState: () => ({
      currentFileName: AppState.get('currentFileName'),
      compareState: AppState.get('compareState')
    }),
    ui: {
      renderQueue: () => UIManager.renderQueue(),
      loadMarkdown: (md, name) => UIManager.loadMarkdown(md, name),
      toast: (message, type) => UIManager.toast(message, type)
    },
    elements: {
      btnCloseCompare: document.getElementById('btnCloseCompare'),
      modalCompare: document.getElementById('modalCompare'),
      btnUseMarkItDown: document.getElementById('btnUseMarkItDown'),
      btnUseBrowser: document.getElementById('btnUseBrowser'),
      btnCompare: document.getElementById('btnCompare')
    }
  });

  SettingsController.bind();
  VideoAutomationController.bind();

  FileActionsUIController = globalThis.MarkAIFileActionsUIController.create({
    getState: () => ({
      currentMd: AppState.get('currentMd'),
      currentFileName: AppState.get('currentFileName')
    }),
    editorController: EditorController,
    ui: {
      toast: (message, type) => UIManager.toast(message, type)
    },
    document,
    URL,
    Blob,
    elements: {
      btnDownload: document.getElementById('btnDownload'),
      btnReset: document.getElementById('btnReset')
    }
  });
  FileActionsUIController.bind();
  ComparisonUIController.bind();

  // File ingestion is centralized in QueueUIController.
});





// ══════════════════════════════════════════════
// VIDEO TASK ANALYZER — screen recording → process steps
// ══════════════════════════════════════════════

