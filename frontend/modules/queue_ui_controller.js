(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MarkAIQueueUIController = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function create({
    queueManager,
    conversionController,
    workspaceController,
    editorController,
    getState,
    ui = {},
    documentRef = globalThis.document,
    windowRef = globalThis,
    timers = {}
  } = {}) {
    if (!queueManager) throw new Error('QueueUIController requires queueManager');
    if (!conversionController) throw new Error('QueueUIController requires conversionController');
    if (!workspaceController) throw new Error('QueueUIController requires workspaceController');
    if (typeof getState !== 'function') throw new Error('QueueUIController requires getState');

    const $ = id => documentRef?.getElementById(id);
    const setTimeoutFn = timers.setTimeout || globalThis.setTimeout;
    const toast = (message, type) => ui.toast?.(message, type);
    const renderQueue = () => ui.renderQueue?.();
    const loadMarkdown = (markdown, name) => ui.loadMarkdown?.(markdown, name);
    const showProcessing = (label, sub) => ui.showProcessing?.(label, sub);
    const hideProcessing = () => ui.hideProcessing?.();
    const setStatus = (text, state) => ui.setStatus?.(text, state);
    const setProcessingSub = text => ui.setProcessingSub?.(text);

    function onFilesSelected(files) {
      const selected = Array.from(files || []).filter(file => file && typeof file.name === 'string');
      if (!selected.length) return [];

      try {
        const addedItems = queueManager.add(selected);

        workspaceController.scheduleSave();
        renderQueue();

        toast(
          `${addedItems.length} arquivo(s) adicionado(s) à fila.`,
          'success'
        );

        // Conversion is deliberately scheduled only after persistence,
        // rendering and the success toast. The test harness executes
        // setTimeout immediately, so this ordering is part of the contract.
        addedItems.forEach(item => {
          setTimeoutFn(() => {
            Promise.resolve(conversionController.convertItem(item.id)).catch(error => {
              console.warn('[MarkAI] Conversão automática falhou:', error);
              toast('Arquivo importado, mas a conversão falhou: ' + error.message, 'error');
            });
          });
        });

        return addedItems;
      } catch (error) {
        console.error('[MarkAI] Falha ao importar arquivo:', error);
        toast('Não foi possível importar o arquivo: ' + (error?.message || error), 'error');
        return [];
      }
    }

    async function mergeAll() {
      return conversionController.mergeAll();
    }

    async function downloadZip() {
      const queueList = $('queueList');
      const checkedBoxes = queueList
        ? Array.from(queueList.querySelectorAll('.qi-check:checked'))
        : [];
      let items;
      if (checkedBoxes.length > 0) {
        const checkedIds = checkedBoxes.map(cb => cb.dataset.id);
        items = queueManager.getOrdered().filter(item =>
          checkedIds.includes(item.id) && item.status === 'done' && item.result
        );
        if (!items.length) {
          toast('Nenhum arquivo convertido entre os selecionados.', 'warning');
          return;
        }
      } else {
        items = queueManager.getOrdered().filter(item => item.status === 'done' && item.result);
      }
      if (!items.length) {
        toast('Nenhum arquivo convertido na fila para baixar.', 'warning');
        return;
      }
      if (!windowRef.JSZip) {
        toast('Carregando biblioteca ZIP, tente novamente em instantes.', 'info');
        return;
      }

      const zip = new windowRef.JSZip();
      const usedNames = new Set();
      items.forEach(item => {
        const baseName = item.name.replace(/\.[^.]+$/, '') + '.md';
        let safeName = baseName;
        let suffix = 2;
        while (usedNames.has(safeName)) {
          safeName = baseName.replace(/\.md$/, '') + ' (' + suffix + ').md';
          suffix += 1;
        }
        usedNames.add(safeName);
        zip.file(safeName, item.result);
      });

      showProcessing('Compactando arquivos...', items.length + ' arquivos');
      try {
        const content = await zip.generateAsync({ type: 'blob' });
        const anchor = documentRef.createElement('a');
        anchor.href = windowRef.URL.createObjectURL(content);
        anchor.download = 'arquivos_convertidos.zip';
        anchor.click();
        windowRef.URL.revokeObjectURL(anchor.href);
        toast('✓ ZIP com ' + items.length + ' arquivos baixado!', 'success');
      } catch (error) {
        toast('Erro ao criar ZIP: ' + error.message, 'error');
      } finally {
        hideProcessing();
      }
    }

    async function convertAll() {
      return conversionController.convertAll();
    }

    function downloadItem(item) {
      if (!item?.result) {
        toast('Converta o arquivo primeiro.', 'warning');
        return;
      }
      const blob = new windowRef.Blob([item.result], { type: 'text/markdown;charset=utf-8' });
      const url = windowRef.URL.createObjectURL(blob);
      const anchor = documentRef.createElement('a');
      anchor.href = url;
      anchor.download = item.name.replace(/\.[^.]+$/, '') + '.md';
      documentRef.body?.appendChild(anchor);
      anchor.click();
      documentRef.body?.removeChild(anchor);
      windowRef.URL.revokeObjectURL(url);
      toast('✓ ' + anchor.download + ' baixado!', 'success');
    }

    function handleQueueAction(event) {
      const btn = event.target.closest?.('button[data-id]');
      if (!btn) return;
      const id = btn.dataset.id;
      if (btn.classList.contains('qi-btn-remove')) {
        queueManager.remove(id);
        renderQueue();
        workspaceController.scheduleSave();
        if (!getState().queue.length) ui.setEmptyState?.(true);
      } else if (btn.classList.contains('qi-btn-convert')) {
        void conversionController.convertItem(id);
      } else if (btn.classList.contains('qi-btn-compare')) {
        void conversionController.compareItem(id);
      } else if (btn.classList.contains('qi-btn-download')) {
        downloadItem(queueManager.getById(id));
      } else if (btn.classList.contains('qi-btn-preview')) {
        editorController?.previewItem(id);
      }
    }

    function openFilePicker(fileInput) {
      if (!fileInput || typeof fileInput.click !== 'function') return false;
      fileInput.click();
      return true;
    }

    function bind() {
      const dropZone = $('dropZone');
      const fileInput = $('fileInput');
      const browseBtn = $('browseBtn');
      const clearQueue = $('btnClearQueue');
      const mergeAllButton = $('btnMergeAll');
      const downloadZipButton = $('btnDownloadZip');
      const convertAllButton = $('btnConvertAll');
      const queueList = $('queueList');

      dropZone?.addEventListener('dragover', event => {
        event.preventDefault();
        dropZone.classList.add('drag-over');
      });
      dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
      dropZone?.addEventListener('drop', event => {
        event.preventDefault();
        dropZone.classList.remove('drag-over');
        onFilesSelected(event.dataTransfer?.files);
      });
      dropZone?.addEventListener('click', () => openFilePicker(fileInput));
      dropZone?.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          fileInput?.click();
        }
      });
      browseBtn?.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();

        if (typeof fileInput?.showPicker === 'function') {
          fileInput.showPicker();
        } else {
          fileInput?.click();
        }
      });
      const handleFileInput = event => {
        const input = event.currentTarget || event.target;
        const files = input?.files ? Array.from(input.files) : [];
        onFilesSelected(files);
        // Clear only after the current event has been processed so Android
        // has completed its native FileList hand-off.
        setTimeoutFn(() => {
          try { input.value = ''; } catch (_) {}
        }, 0);
      };
      fileInput?.addEventListener('change', handleFileInput);

      clearQueue?.addEventListener('click', () => {
        queueManager.clear();
        renderQueue();
        workspaceController.scheduleSave();
        ui.setEmptyState?.(true);
        toast('Fila limpa.', 'info');
      });
      mergeAllButton?.addEventListener('click', mergeAll);
      downloadZipButton?.addEventListener('click', downloadZip);
      convertAllButton?.addEventListener('click', convertAll);
      queueList?.addEventListener('click', handleQueueAction);
    }

    return { bind, onFilesSelected, openFilePicker, mergeAll, downloadZip, convertAll, handleQueueAction };
  }

  return { create };
});