(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarkAIEditorUIController = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function create({ editorController, elements } = {}) {
    if (!editorController || !elements) {
      throw new TypeError('EditorUIController requires editorController and elements.');
    }

    function bind() {
      const tabs = elements.tabs || [];
      tabs.forEach(tab => {
        tab.addEventListener('click', () => editorController.switchTab(tab.dataset.panel));
      });

      elements.markdownEditor.addEventListener('input', () => {
        editorController.handleInput(elements.markdownEditor.value);
      });

      elements.markdownEditorSplit.addEventListener('input', () => {
        editorController.handleInput(elements.markdownEditorSplit.value);
      });

      elements.btnPreviewRaw.addEventListener('click', () => editorController.togglePreviewRaw());
    }

    return { bind };
  }

  return { create };
});
