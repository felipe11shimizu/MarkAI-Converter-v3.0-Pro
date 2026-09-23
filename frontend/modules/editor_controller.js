(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarkAIEditorController = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function create({
    getState,
    setState,
    ui,
    queueManager,
    fileParserStrategy,
    sanitizeMarkdownHtml,
    scheduleSave,
    timers = {}
  } = {}) {
    if (typeof getState !== 'function' || typeof setState !== 'function' || !ui) {
      throw new TypeError('EditorController requires state and UI dependencies.');
    }
    if (typeof sanitizeMarkdownHtml !== 'function') {
      throw new TypeError('EditorController requires sanitizeMarkdownHtml.');
    }

    const setTimer = timers.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    const previewTimer = timers.clearTimeout || ((id) => clearTimeout(id));
    let progressTimer = null;
    let previewRawMode = false;

    function updateStats(markdown) {
      const md = String(markdown ?? '');
      const words = md.trim() ? md.trim().split(/\s+/).length : 0;
      const lines = md.split('\n').length;
      const chars = md.length;
      ui.setStats({
        words: words.toLocaleString('pt-BR') + ' palavras',
        lines: lines.toLocaleString('pt-BR') + ' linhas',
        chars: chars.toLocaleString('pt-BR') + ' chars'
      });
    }

    function renderPreview(markdown) {
      const md = String(markdown ?? '');
      ui.setPreviewHtml(sanitizeMarkdownHtml(md), getState().settings || {});
    }

    function loadMarkdown(markdown, fileName) {
      const md = String(markdown ?? '');
      const name = fileName || 'documento.md';
      setState({ currentMd: md, currentFileName: name });
      ui.setWorkspaceVisible(true);
      ui.setDocumentName(name);
      ui.setEditorValues(md);
      updateStats(md);

      const activePanel = getState().activePanel;
      if (activePanel === 'panelPreview' || activePanel === 'panelSplit') renderPreview(md);

      ui.setProgress(1);
      if (progressTimer !== null) previewTimer(progressTimer);
      progressTimer = setTimer(() => ui.setProgress(0, false), 800);
      return md;
    }

    function switchTab(panelId) {
      ui.setActivePanel(panelId);
      setState({ activePanel: panelId });
      const md = getState().currentMd || '';
      if (panelId !== 'panelRaw') renderPreview(md);
      if (panelId === 'panelSplit') ui.setSplitEditorValue(md);
    }

    function handleInput(markdown) {
      const md = String(markdown ?? '');
      setState({ currentMd: md });
      updateStats(md);
      ui.syncEditorValues(md);
      const settings = getState().settings || {};
      const activePanel = getState().activePanel;
      if (settings.autoPreview && activePanel !== 'panelRaw') renderPreview(md);
      if (activePanel === 'panelSplit') renderPreview(md);
      if (typeof scheduleSave === 'function') scheduleSave();
    }

    function reset() {
      setState({ currentMd: '' });
      ui.clearEditorsAndPreview();
      ui.setWorkspaceVisible(false);
      updateStats('');
      ui.setProgress(0, false);
      ui.setStatus('Pronto', 'idle');
      if (typeof scheduleSave === 'function') scheduleSave();
    }

    async function previewItem(id) {
      if (!queueManager || !fileParserStrategy) throw new Error('EditorController preview requires queue and parser dependencies.');
      const item = queueManager.getById(id);
      if (!item) return null;
      setState({ previewItemId: id });
      ui.setPreviewFileName(item.name);
      ui.clearPreviewContent();

      let result = item.result;
      if (!result) {
        ui.showProcessing('Convertendo para preview…', item.name);
        try {
          result = await fileParserStrategy.parse(item);
          queueManager.update(id, { status: 'done', result });
          ui.renderQueue();
        } catch (e) {
          ui.hideProcessing();
          ui.toast('Erro ao pré-visualizar: ' + e.message, 'error');
          return null;
        }
        ui.hideProcessing();
      }

      ui.setPreviewHtml(sanitizeMarkdownHtml(result), getState().settings || {}, true);
      previewRawMode = false;
      ui.setPreviewRawLabel('Ver Raw');
      ui.showPreviewModal();
      return result;
    }

    function togglePreviewRaw() {
      const id = getState().previewItemId;
      const item = id && queueManager ? queueManager.getById(id) : null;
      if (!item?.result) return previewRawMode;
      previewRawMode = !previewRawMode;
      if (previewRawMode) ui.setPreviewRawContent(item.result);
      else ui.setPreviewHtml(sanitizeMarkdownHtml(item.result), getState().settings || {}, true);
      ui.setPreviewRawLabel(previewRawMode ? 'Ver Preview' : 'Ver Raw');
      return previewRawMode;
    }

    return {
      loadMarkdown,
      updateStats,
      renderPreview,
      switchTab,
      handleInput,
      reset,
      previewItem,
      togglePreviewRaw
    };
  }

  return { create };
});
