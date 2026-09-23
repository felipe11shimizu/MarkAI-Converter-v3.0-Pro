(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarkAIComparisonUIController = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function create({ queueManager, conversionController, getState, ui, elements }) {
    if (!queueManager || !conversionController || !getState || !ui || !elements) {
      throw new Error('ComparisonUIController requires queue, conversion, state, UI and DOM dependencies.');
    }

    function close() {
      elements.modalCompare?.close();
    }

    function useResult(engine) {
      const state = getState().compareState;
      const item = state?.id ? queueManager.getById(state.id) : null;
      const markdown = engine === 'markitdown' ? state?.markitdown : state?.browser;
      if (!markdown || !item) {
        ui.toast(
          engine === 'markitdown'
            ? 'Resultado MarkItDown indisponível.'
            : 'Resultado local indisponível.',
          'warning'
        );
        return;
      }
      queueManager.update(item.id, {
        status: 'done',
        result: markdown,
        engine
      });
      ui.renderQueue();
      ui.loadMarkdown(markdown, item.name.replace(/\.[^.]+$/, '') + '.md');
      close();
    }

    function compareCurrent() {
      const current = getState().currentFileName || '';
      const base = current.replace(/\.[^.]+$/, '');
      const item = queueManager.getOrdered().find(i =>
        i.name.replace(/\.[^.]+$/, '') === base
      ) || queueManager.getOrdered().find(i => i.result);
      if (!item) {
        ui.toast('Nenhum arquivo disponível para comparação.', 'warning');
        return;
      }
      return conversionController.compareItem(item.id);
    }

    function bind() {
      elements.btnCloseCompare?.addEventListener('click', close);
      elements.modalCompare?.addEventListener('click', event => {
        if (event.target === elements.modalCompare) close();
      });
      elements.btnUseMarkItDown?.addEventListener('click', () => useResult('markitdown'));
      elements.btnUseBrowser?.addEventListener('click', () => useResult('browser'));
      elements.btnCompare?.addEventListener('click', compareCurrent);
    }

    return { bind, close, useResult, compareCurrent };
  }

  return { create };
});
