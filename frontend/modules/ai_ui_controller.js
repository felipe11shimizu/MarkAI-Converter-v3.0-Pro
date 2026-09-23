(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarkAIAIUIController = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function create({ aiEngine, getState, workspaceStore, workspaceController, elements, ui } = {}) {
    if (!aiEngine || typeof aiEngine.enhance !== 'function') throw new TypeError('AIUIController requires aiEngine.');
    if (typeof getState !== 'function') throw new TypeError('AIUIController requires getState.');
    if (!workspaceController?.saveVersion) throw new TypeError('AIUIController requires workspaceController.');
    if (!elements?.btnEnhanceAI) throw new TypeError('AIUIController requires btnEnhanceAI.');

    async function enhance() {
      const markdown = getState().currentMd || '';
      if (!markdown) {
        ui.toast('Sem conteúdo para melhorar.', 'warning');
        return null;
      }

      const settings = getState().settings || {};
      if (!settings.apiKey) {
        ui.toast('Configure sua API Key em Configurações.', 'warning');
        ui.openSettings();
        return null;
      }

      elements.btnEnhanceAI.classList.add('loading');
      elements.btnEnhanceAI.disabled = true;
      ui.setStatus('IA processando…', 'busy');

      try {
        const customPrompt = elements.workspaceAIPrompt?.value?.trim() || '';
        const improved = await aiEngine.enhance(markdown, customPrompt);
        const projectId = getState().currentProjectId;
        if (projectId && workspaceStore?.saveAIHistory) {
          await workspaceStore.saveAIHistory(projectId, {
            provider: settings.aiProvider,
            model: settings.aiModel,
            prompt: customPrompt || 'SYSTEM_PROMPT: formatação e normalização de Markdown',
            inputMarkdown: markdown,
            outputMarkdown: improved,
            documentName: getState().currentFileName
          });
        }
        ui.loadMarkdown(improved, getState().currentFileName);
        await workspaceController.saveVersion('ai');
        ui.toast('✓ Markdown melhorado pela IA!', 'success');
        ui.setStatus('IA concluída', 'idle');
        return improved;
      } catch (error) {
        ui.toast(`Erro IA: ${error.message}`, 'error');
        ui.setStatus('Erro na IA', 'error');
        return null;
      } finally {
        elements.btnEnhanceAI.classList.remove('loading');
        elements.btnEnhanceAI.disabled = false;
      }
    }

    function bind() {
      elements.btnEnhanceAI.addEventListener('click', enhance);
    }

    return { bind, enhance };
  }

  return { create };
});
