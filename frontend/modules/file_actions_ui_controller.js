(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarkAIFileActionsUIController = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function create({ getState, editorController, ui, document: doc, URL: urlApi, Blob: BlobCtor, elements } = {}) {
    if (typeof getState !== 'function' || !editorController?.reset || !ui?.toast) {
      throw new TypeError('FileActionsUIController requires state, editor controller and UI.');
    }
    if (!elements?.btnDownload || !elements?.btnReset) {
      throw new TypeError('FileActionsUIController requires download and reset buttons.');
    }

    function download() {
      const state = getState();
      const markdown = state.currentMd;
      if (!markdown) {
        ui.toast('Nenhum conteúdo para baixar.', 'warning');
        return false;
      }
      const fileName = state.currentFileName || 'documento.md';
      const blob = new BlobCtor([markdown], { type: 'text/markdown;charset=utf-8' });
      const objectUrl = urlApi.createObjectURL(blob);
      const link = doc.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      doc.body.appendChild(link);
      link.click();
      doc.body.removeChild(link);
      urlApi.revokeObjectURL(objectUrl);
      ui.toast(`✓ ${fileName} baixado!`, 'success');
      return true;
    }

    function reset() {
      return editorController.reset();
    }

    function bind() {
      elements.btnDownload.addEventListener('click', download);
      elements.btnReset.addEventListener('click', reset);
    }

    return { bind, download, reset };
  }

  return { create };
});
